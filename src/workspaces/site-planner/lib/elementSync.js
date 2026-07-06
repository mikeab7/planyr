// Element-level sync, phase 2 (B671) — the per-element write engine.
//
// Replaces the whole-doc debounced autosave with per-element commits through the B670
// `commit_elements` RPC, WHILE the single-tab edit lock is still on (single writer → safe to
// ship alone). The engine is a diff committer: instead of instrumenting the ~68 scattered
// `setEls` call sites, it diffs the live collections against a shadow map of last-committed
// element serializations on every autosave-effect run — so creates, edits, deletes, undo/redo,
// paste, and generation are all covered by construction.
//
// Fully injectable (client/timers/now) so the diff classes, debounce-vs-immediate boundaries,
// batch coalescing, conflict matrix, and backoff are unit-tested with no real I/O or wall clock.
//
// Boundaries:
//   • create / delete  → committed immediately (a new or removed element is a hard boundary)
//   • update           → ~750ms trailing debounce (coalesces in-progress typing / live pickers)
//   • flushGesture()   → commit now (pointer-up / gesture end / inline-edit commit)
//   • keepaliveFlush() → last-ditch unload flush of whatever is still dirty
// One `commit_elements` RPC runs at a time per site (via makeWriteSerializer), so a group drag or
// a 30-element paste lands as ONE batch and two commits to the same element can never interleave.
//
// Conflict policy is LAST-WRITE-WINS with LOUD notification: a rev-guard miss adopts the returned
// current rev, re-commits local data on top, and emits a typed event that B673 turns into a toast.

import { makeWriteSerializer } from "../../../shared/cloud/serializeWrites.js";
import { KIND_TO_FIELD } from "./elementRows.js";
import { nextZ } from "./zOrder.js";

const FIELDS = Object.entries(KIND_TO_FIELD); // [ [kind, field], ... ]

// Stable JSON (recursively key-sorted) so a diff compares VALUE, not key order — the shadow is
// seeded from Postgres jsonb (which reorders keys) yet the local element keeps insertion order.
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

const skey = (kind, id) => kind + ":" + id;
const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

export function createElementSync(opts = {}) {
  const {
    siteId,
    commit,                         // async (ops) => { ok, results, error }
    now = () => 0,                  // injected clock (Date.now is banned in this codebase's pure layer)
    setTimer = (fn) => { fn(); return null; },   // (fn, ms) => handle
    clearTimer = () => {},
    serialize = makeWriteSerializer(),
    onEvent = () => {},             // typed conflict events (B673 consumer)
    onStatus = () => {},            // { state, pending, attempt }
    patchElement = null,            // (kind, id, patch) => void — write an assigned z back to canvas state
    report = () => {},              // reportClientEvent-like telemetry
    selfUid = null,
    debounceMs = 750,
    backoff = DEFAULT_BACKOFF,
    maxAttempts = 5,
    recentWindowMs = 15000,         // "authored within ~15s" window feeding B673
  } = opts;

  // key -> { kind, id, json, rev, z }  (last COMMITTED state)
  const shadow = new Map();
  // key -> { kind, id, cls: 'create'|'update'|'delete', el|null, z }  (pending, latest-wins)
  const dirty = new Map();
  // key -> { at, rev }  (elements this tab committed recently; feeds the B673 15s window)
  const recent = new Map();

  let debounceHandle = null;
  let backoffHandle = null;
  let inflight = false;
  let attempt = 0;
  let state = "idle";               // 'idle'|'syncing'|'retrying'|'failed'
  let stopped = false;
  let ready = false;                // true once the shadow is seeded from the DB (or an empty seed)

  const pendingCount = () => dirty.size;
  const emitStatus = () => onStatus({ state, pending: pendingCount(), attempt });
  const setState = (s) => { if (s !== state) { state = s; } emitStatus(); };

  // ---- shadow seeding (used by load / the B672 refetch-replace) ---------------
  // Seeds the shadow from the site's current DB rows so the first diff sees NO change for an
  // unchanged element (no spurious create→'exists'→update churn on every load). Marks the engine
  // ready — reconcile() is a no-op until this runs (even with an empty/failed seed).
  function seed(rows) {
    shadow.clear();
    for (const r of rows || []) {
      if (!r || r.deleted_at) continue;               // only LIVE rows are canonical state
      shadow.set(skey(r.kind, r.id), {
        kind: r.kind, id: r.id, json: stableStringify(r.data), rev: r.rev, z: r.z_index,
      });
    }
    ready = true;
  }
  const shadowSnapshot = () => new Map(shadow);
  const isRecent = (kind, id) => {
    const r = recent.get(skey(kind, id));
    return !!r && now() - r.at <= recentWindowMs;
  };

  // ---- diff the live collections against the shadow, enqueue ops --------------
  // `busy` (a gesture is in flight) defers the diff; the caller re-invokes on gesture end.
  function reconcile(collections, { busy } = {}) {
    if (stopped || !ready) return;  // not until the shadow is seeded from the DB (avoids load churn)
    if (busy) return;               // mid-drag: the flushGesture() hook re-runs this at gesture end
    const seen = new Set();
    let sawCreateOrDelete = false;

    for (const [kind, field] of FIELDS) {
      const list = (collections && collections[field]) || [];
      let zCursor = null; // running "next free z" for this collection, for elements created without one
      for (const el of list) {
        if (!el || typeof el.id !== "string") continue;
        const key = skey(kind, el.id);
        seen.add(key);
        const shad = shadow.get(key);
        const pend = dirty.get(key);
        if (!shad) {
          // brand-new element (or one the shadow never saw) → create. Assign a z ON TOP of its
          // collection if it has none, so the z_index column AND data.z agree (the B672 rebuild
          // reads z from data) and it renders on top like it did under the old array-append order.
          let elc = el;
          if (typeof el.z !== "number") {
            if (zCursor == null) zCursor = nextZ(list);
            const z = zCursor; zCursor += 1024;
            elc = { ...el, z };
            if (patchElement) patchElement(kind, el.id, { z }); // reflect it on the canvas
          }
          if (!pend || pend.cls !== "create" || stableStringify(pend.el) !== stableStringify(elc)) {
            enqueue(key, { kind, id: el.id, cls: "create", el: elc, z: elc.z });
            sawCreateOrDelete = true;
          }
          continue;
        }
        const json = stableStringify(el);
        if (shad.json !== json) {
          // changed since last commit → update (unless an identical update is already queued)
          if (!pend || pend.cls === "delete" || stableStringify(pend.el) !== json) {
            enqueue(key, { kind, id: el.id, cls: "update", el, z: el.z });
          }
        }
      }
    }
    // elements present in the shadow but no longer in any collection → delete
    for (const [key, shad] of shadow) {
      if (seen.has(key)) continue;
      const pend = dirty.get(key);
      if (!pend || pend.cls !== "delete") {
        enqueue(key, { kind: shad.kind, id: shad.id, cls: "delete", el: null, z: shad.z });
        sawCreateOrDelete = true;
      }
    }
    schedule(sawCreateOrDelete);
  }

  // Latest-wins merge into the dirty queue, resolving create/delete transitions.
  function enqueue(key, entry) {
    const prev = dirty.get(key);
    if (prev) {
      // created then deleted before any commit → net no-op (never existed on the server)
      if (prev.cls === "create" && entry.cls === "delete") { dirty.delete(key); return; }
      // was created, now edited → keep 'create' with the newest element
      if (prev.cls === "create" && entry.cls === "update") { dirty.set(key, { ...entry, cls: "create" }); return; }
    }
    dirty.set(key, entry);
  }

  // Decide when to fire: create/delete are immediate; a pure update batch trails by debounceMs.
  function schedule(immediate) {
    if (stopped || dirty.size === 0) { emitStatus(); return; }
    if (immediate) { clearDebounce(); flush(); return; }
    if (debounceHandle == null) {
      debounceHandle = setTimer(() => { debounceHandle = null; flush(); }, debounceMs);
    }
    emitStatus();
  }
  function clearDebounce() { if (debounceHandle != null) { clearTimer(debounceHandle); debounceHandle = null; } }

  // Force a commit of whatever is dirty (gesture end / inline-edit commit).
  function flushGesture() { clearDebounce(); flush(); }

  // Build ops from the dirty queue and commit them as ONE batch, serialized per site.
  function flush() {
    if (stopped || inflight || dirty.size === 0) return;
    clearDebounce();
    const batch = [...dirty.values()];
    dirty.clear();
    inflight = true;
    setState("syncing");
    serialize(siteId, async () => {
      const ops = batch.map(opFor);
      const res = await commit(ops);
      inflight = false;
      if (!res || !res.ok) return onTransportFailure(batch, res);
      attempt = 0;
      processResults(batch, res.results || []);
      // Anything re-queued during processing (a LWW re-commit, a re-applied delete, a missing-row
      // re-create) reschedules through the DEBOUNCE timer, never a synchronous immediate flush — a
      // server that keeps returning conflict must not become a hot re-commit loop (LOUD-FAILURE, not
      // runaway). At the ~debounceMs cadence LWW still converges within a fraction of a second.
      if (dirty.size > 0) schedule(false); else setState("idle");
    });
  }

  function opFor(e) {
    if (e.cls === "create") return { op: "create", id: e.id, kind: e.kind, z: e.z, data: e.el };
    if (e.cls === "delete") return { op: "delete", id: e.id, kind: e.kind, expected: revOf(e) };
    return { op: "update", id: e.id, kind: e.kind, z: e.z, expected: revOf(e), data: e.el };
  }
  const revOf = (e) => { const s = shadow.get(skey(e.kind, e.id)); return s ? s.rev : 1; };

  // Apply the RPC's per-op results back onto the shadow + emit conflict events.
  function processResults(batch, results) {
    const byId = new Map();
    for (const r of results) if (r && r.id) byId.set(r.id, r); // ids are unique within a batch
    for (const e of batch) {
      const r = byId.get(e.id) || {};
      const key = skey(e.kind, e.id);
      if (r.status === "ok") {
        if (e.cls === "delete") { shadow.delete(key); }
        else {
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(e.el), rev: r.rev, z: e.z });
        }
        recent.set(key, { at: now(), rev: r.rev });
      } else if (r.status === "conflict") {
        const row = r.row || {};
        if (e.cls === "delete") {
          // delete-vs-edit: delete WINS — re-issue at the fresh rev (per the B673 matrix)
          shadow.set(key, { kind: e.kind, id: e.id, json: shadow.get(key)?.json || "", rev: row.rev, z: e.z });
          enqueue(key, { kind: e.kind, id: e.id, cls: "delete", el: null, z: e.z });
          report("element-delete-reapplied", "delete re-applied at fresh rev", { siteId, id: e.id, kind: e.kind });
          onEvent({ type: "delete-reapplied", id: e.id, kind: e.kind, remote: row });
        } else {
          // edit-vs-edit: second writer wins — adopt the remote rev and re-commit local on top (LWW)
          shadow.set(key, { kind: e.kind, id: e.id, json: "", rev: row.rev, z: e.z });
          enqueue(key, { kind: e.kind, id: e.id, cls: "update", el: e.el, z: e.z });
          report("element-conflict", "edit-vs-edit LWW re-commit", { siteId, id: e.id, kind: e.kind, remoteRev: row.rev });
          onEvent({ type: "edit-vs-edit-lost-race", id: e.id, kind: e.kind, remote: row, authoredRecently: isRecent(e.kind, e.id) });
        }
      } else if (r.status === "deleted") {
        // edit-vs-deleted: someone tombstoned it. Do NOT auto-restore — B673 offers a Restore action.
        shadow.delete(key);
        report("element-edit-vs-deleted", "edit hit a tombstone", { siteId, id: e.id, kind: e.kind });
        onEvent({ type: "edit-vs-deleted", id: e.id, kind: e.kind, local: e.el, remote: r.row || {} });
      } else if (r.status === "exists") {
        // create-vs-create — impossible with per-tab salted ids (B591). Assert + adopt as an update.
        const row = r.row || {};
        shadow.set(key, { kind: e.kind, id: e.id, json: "", rev: row.rev, z: e.z });
        enqueue(key, { kind: e.kind, id: e.id, cls: "update", el: e.el, z: e.z });
        report("element-create-collision", "create hit a live row (should be impossible)", { siteId, id: e.id, kind: e.kind });
      } else if (r.status === "missing") {
        // server has no such row. An update/delete on a purged row → re-create (update) or drop (delete).
        if (e.cls === "delete") { shadow.delete(key); }
        else { shadow.delete(key); enqueue(key, { kind: e.kind, id: e.id, cls: "create", el: e.el, z: e.z }); }
        report("element-missing", "op targeted an absent row", { siteId, id: e.id, kind: e.kind, cls: e.cls });
      } else {
        // no result for this op (malformed response) — requeue to try again
        enqueue(key, e);
        report("element-no-result", "op had no result in the batch response", { siteId, id: e.id, kind: e.kind });
      }
    }
  }

  // Transport failure: nothing committed. Re-queue the whole batch and back off; give up loudly
  // after maxAttempts (stays queued — retryNow() or the next edit tries again).
  function onTransportFailure(batch, res) {
    for (const e of batch) if (!dirty.has(skey(e.kind, e.id))) dirty.set(skey(e.kind, e.id), e);
    attempt += 1;
    report("element-commit-failed", "batch transport failure", { siteId, attempt, error: (res && res.error) || "" });
    if (attempt >= maxAttempts) { setState("failed"); return; }
    setState("retrying");
    const wait = backoff[Math.min(attempt - 1, backoff.length - 1)];
    if (backoffHandle != null) clearTimer(backoffHandle);
    backoffHandle = setTimer(() => { backoffHandle = null; flush(); }, wait);
  }

  // Manual retry (the badge's "Retry now").
  function retryNow() { attempt = 0; if (backoffHandle != null) { clearTimer(backoffHandle); backoffHandle = null; } flush(); }

  // Ops still pending, for the keepalive unload flush (elementApi.keepaliveCommit).
  function pendingOps() { return [...dirty.values()].map(opFor); }
  // The pending local edits themselves — the B672 refetch-replace substitutes these back into the
  // rebuilt canvas so a full refetch never discards work still in flight.
  function dirtyEntries() { return [...dirty.values()].map((e) => ({ kind: e.kind, id: e.id, cls: e.cls, el: e.el })); }

  // ---- B672: the realtime READ side -------------------------------------------
  // Apply one incoming site_elements row (a postgres_changes event) against the shadow and return
  // the canvas instruction. Idempotent by rev: our own committed changes echoing back are a no-op.
  //   { action:'ignore' }                      — stale / own echo / dirty-local-wins
  //   { action:'remove', kind, id, row }      — tombstoned remotely → take it off the canvas
  //   { action:'upsert', kind, id, el, row }  — new/updated remotely → put row.data on the canvas
  // A row for an element with a PENDING local edit keeps the LOCAL data on canvas (the dirty entry
  // recommits through the normal rev-checked path) but ADOPTS the remote rev so that commit targets
  // the fresh row instead of a guaranteed conflict; emits `remote-while-dirty` for B673.
  function applyRemoteRow(row) {
    if (!row || !row.kind || row.id == null) return { action: "ignore" };
    const key = skey(row.kind, row.id);
    const shad = shadow.get(key);
    const rev = typeof row.rev === "number" ? row.rev : 0;
    if (shad && rev <= shad.rev) return { action: "ignore" }; // own echo or stale replay
    if (dirty.has(key)) {
      // local edit in flight — local data stays on canvas; re-target its commit at the fresh rev
      shadow.set(key, { kind: row.kind, id: row.id, json: shad ? shad.json : "", rev, z: row.z_index });
      onEvent({ type: "remote-while-dirty", id: row.id, kind: row.kind, remote: row, authoredRecently: isRecent(row.kind, row.id) });
      return { action: "ignore" };
    }
    if (row.deleted_at) {
      if (!shad) return { action: "ignore" }; // tombstone for something we never showed
      shadow.delete(key);
      onEvent({ type: "remote-delete", id: row.id, kind: row.kind, remote: row, authoredRecently: isRecent(row.kind, row.id) });
      return { action: "remove", kind: row.kind, id: row.id, row };
    }
    if (!row.data) return { action: "ignore" }; // malformed live row (CHECK should prevent this)
    shadow.set(key, { kind: row.kind, id: row.id, json: stableStringify(row.data), rev, z: row.z_index });
    onEvent({ type: "remote-upsert", id: row.id, kind: row.kind, remote: row, existed: !!shad, authoredRecently: isRecent(row.kind, row.id) });
    return { action: "upsert", kind: row.kind, id: row.id, el: row.data, row };
  }

  function stop() {
    stopped = true;
    clearDebounce();
    if (backoffHandle != null) { clearTimer(backoffHandle); backoffHandle = null; }
  }

  return {
    reconcile, flushGesture, retryNow, seed, stop,
    pendingOps, pendingCount, dirtyEntries, applyRemoteRow,
    isSeeded: () => ready,
    // introspection for tests / B672-B673
    shadowSnapshot, isRecent,
    get state() { return state; },
    get recent() { return recent; },
  };
}
