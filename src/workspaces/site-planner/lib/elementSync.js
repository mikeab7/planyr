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
  // key -> the batch entry currently IN FLIGHT (sent, no result yet). flush() clears `dirty`
  // up-front, so without this a mid-commit element looks "clean" to applyRemoteRow / the
  // refetch-replace substitution — a foreign row (or the refetch) could clobber the very edit
  // being committed (the V229 #5 lost-update class). In-flight is protected exactly like dirty.
  const inflightKeys = new Map();
  // key -> { at, rev }  (elements this tab committed recently; feeds the B673 15s window)
  const recent = new Map();
  // key -> { at, rev }  (elements THIS tab tombstoned; the delete's rev). A delete does shadow.delete()
  // which removes the element's rev CEILING, so a late self-echo of a PRE-delete write (rev <= this)
  // would sail past the rev guard and RESURRECT the deleted element + raise a false "another window"
  // toast (B757). This memory restores the ceiling: an incoming row at a rev no newer than our delete
  // is a stale self-echo → ignored; a genuine re-create by another session arrives at a HIGHER rev and
  // passes. Pruned to the recent window so it stays tiny.
  const tombstoned = new Map();
  function recordTombstone(kind, id, rev) {
    const t = now();
    tombstoned.set(skey(kind, id), { at: t, rev: typeof rev === "number" ? rev : 0 });
    for (const [k, v] of tombstoned) if (t - v.at > recentWindowMs) tombstoned.delete(k); // bound memory
  }
  // key -> { json, at }  (the last data serialization THIS tab put ON THE WIRE for the key). Unlike
  // inflightKeys — cleared the instant an RPC settles — this SURVIVES a transport failure, so a
  // committed-but-unacked write's realtime echo is still recognized as ours even after onTransportFailure
  // clears inflight and a newer edit has queued into dirty (the B757 transport-failure echo variant).
  // On the SUCCESS path the rev guard / inflight match already suppress the echo; this only backstops
  // the ok:false-but-actually-committed case. Pruned to the recent window so it stays tiny.
  const recentSent = new Map();
  function recordSent(kind, id, el) {
    if (!el) return; // deletes carry no data to match an echo against
    const t = now();
    recentSent.set(skey(kind, id), { json: stableStringify(el), at: t });
    for (const [k, v] of recentSent) if (t - v.at > recentWindowMs) recentSent.delete(k); // bound memory
  }
  const sentMatches = (kind, id, json) => {
    const s = recentSent.get(skey(kind, id));
    return !!s && now() - s.at <= recentWindowMs && s.json === json;
  };

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
        const inf = inflightKeys.get(key); // an identical op already sent needs no re-enqueue
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
          // a queued RESTORE also occupies the no-shadow state — don't downgrade it to a create
          // (though the RPC would auto-restore a create over a same-kind tombstone anyway)
          if (inf && inf.el && stableStringify(inf.el) === stableStringify(elc)) continue; // being created right now
          if (!pend || (pend.cls !== "create" && pend.cls !== "restore") || stableStringify(pend.el) !== stableStringify(elc)) {
            if (!(pend && pend.cls === "restore" && stableStringify(pend.el) === stableStringify(elc)))
              enqueue(key, { kind, id: el.id, cls: pend && pend.cls === "restore" ? "restore" : "create", el: elc, z: elc.z });
            sawCreateOrDelete = true;
          }
          continue;
        }
        const json = stableStringify(el);
        if (shad.json !== json) {
          if (inf && inf.el && stableStringify(inf.el) === json) continue; // this exact data is already in flight
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
      const inf = inflightKeys.get(key);
      if (inf && inf.cls === "delete") continue; // the delete is already on the wire
      if (!pend || pend.cls !== "delete") {
        enqueue(key, { kind: shad.kind, id: shad.id, cls: "delete", el: null, z: shad.z });
        sawCreateOrDelete = true;
      }
    }
    schedule(sawCreateOrDelete);
  }

  // Latest-wins merge into the dirty queue, resolving create/delete/restore transitions.
  function enqueue(key, entry) {
    const prev = dirty.get(key);
    if (prev) {
      // created then deleted before any commit → net no-op (never existed on the server)
      if (prev.cls === "create" && entry.cls === "delete") { dirty.delete(key); return; }
      // was created, now edited → keep 'create' with the newest element
      if (prev.cls === "create" && entry.cls === "update") { dirty.set(key, { ...entry, cls: "create" }); return; }
      // a queued restore that gets edited before sending keeps restoring (with the newest data)
      if (prev.cls === "restore" && entry.cls === "update") { dirty.set(key, { ...entry, cls: "restore" }); return; }
    }
    dirty.set(key, entry);
  }

  // B673 — explicit user action from the "deleted by ⟨name⟩" toast: clear the tombstone and write
  // OUR data at a new rev. Immediate (like create/delete — a deliberate act, never debounced).
  function restore(kind, id, el) {
    if (stopped || !ready || !el) return;
    enqueue(skey(kind, id), { kind, id, cls: "restore", el, z: el.z });
    schedule(true);
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
    for (const e of batch) { inflightKeys.set(skey(e.kind, e.id), e); recordSent(e.kind, e.id, e.el); } // protected like dirty until the result lands; recentSent survives a transport failure (B757)
    inflight = true;
    setState("syncing");
    serialize(siteId, async () => {
      const ops = batch.map(opFor);
      let res;
      try { res = await commit(ops); }
      finally {
        inflight = false;
        for (const e of batch) inflightKeys.delete(skey(e.kind, e.id));
      }
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
    if (e.cls === "restore") return { op: "restore", id: e.id, kind: e.kind, z: e.z, data: e.el };
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
        if (e.cls === "delete") { shadow.delete(key); recordTombstone(e.kind, e.id, r.rev); } // remember the delete's rev → a stale pre-delete self-echo can't resurrect it (B757)
        else {
          // keep the shadow rev MONOTONIC: a foreign realtime row may have advanced it past this
          // commit's rev while the op was in flight (applyRemoteRow's in-flight branch) — adopting
          // the older r.rev back would make the next commit a guaranteed spurious conflict.
          const cur = shadow.get(key);
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(e.el), rev: cur && cur.rev > r.rev ? cur.rev : r.rev, z: e.z });
          tombstoned.delete(key); // element is live again → drop any stale-delete floor
        }
        recent.set(key, { at: now(), rev: r.rev });
      } else if (r.status === "conflict") {
        const row = r.row || {};
        if (e.cls === "restore") {
          // someone restored/edited it first — the live row is the truth; adopt it, don't re-push. BUT
          // if the live row already holds EXACTLY our data, our OWN restore already landed — a timed-out-
          // but-committed restore (COMMIT_TIMEOUT_MS) whose retry now sees its own row — so adopt silently,
          // no toast (B757). Data-equality gated (not updated_by alone) so a genuine race that restored
          // DIFFERENT data still surfaces per the B673 matrix.
          const selfDup = row.data && stableStringify(row.data) === stableStringify(e.el);
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(row.data), rev: row.rev, z: row.z_index });
          tombstoned.delete(key);
          if (selfDup) {
            recent.set(key, { at: now(), rev: row.rev });
            report("element-restore-self-dup", "restore conflict row IS our own committed data — silent", { siteId, id: e.id, kind: e.kind });
          } else {
            report("element-restore-conflict", "restore raced a live row", { siteId, id: e.id, kind: e.kind });
            onEvent({ type: "restore-conflict", id: e.id, kind: e.kind, remote: row });
          }
        } else if (e.cls === "delete") {
          // delete-vs-edit: delete WINS — re-issue at the fresh rev (per the B673 matrix)
          shadow.set(key, { kind: e.kind, id: e.id, json: shadow.get(key)?.json || "", rev: row.rev, z: e.z });
          enqueue(key, { kind: e.kind, id: e.id, cls: "delete", el: null, z: e.z });
          report("element-delete-reapplied", "delete re-applied at fresh rev", { siteId, id: e.id, kind: e.kind });
          onEvent({ type: "delete-reapplied", id: e.id, kind: e.kind, remote: row });
        } else if (row.data && stableStringify(row.data) === stableStringify(e.el)) {
          // SELF-DUPLICATE: the "conflicting" live row already holds EXACTLY our data — this is our OWN
          // write echoing back as a conflict, i.e. a timed-out/aborted commit (COMMIT_TIMEOUT_MS) that
          // actually landed server-side, whose retry now races its own committed row. Adopt the rev
          // silently, do NOT re-commit, do NOT toast — it's not a foreign edit (B757). Gated on DATA
          // equality (not updated_by alone) so a genuine same-account two-window conflict carrying
          // DIFFERENT data still surfaces per the B673 matrix.
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(row.data), rev: row.rev, z: e.z });
          tombstoned.delete(key);
          recent.set(key, { at: now(), rev: row.rev });
          report("element-conflict-self-dup", "conflict row IS our own committed data — silent", { siteId, id: e.id, kind: e.kind });
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
        recordTombstone(e.kind, e.id, (r.row && r.row.rev) || 0); // ceiling so a stale echo can't resurrect (B757)
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
  // rebuilt canvas so a full refetch never discards work still in flight. Includes the batch
  // currently IN FLIGHT (dirty wins on overlap): a refetch landing mid-commit must not rebuild the
  // canvas from rows that predate the commit and then re-commit that stale canvas (V229 #5).
  function dirtyEntries() {
    const out = new Map();
    for (const [k, e] of inflightKeys) out.set(k, e);
    for (const [k, e] of dirty) out.set(k, e);
    // baseRev = the shadow rev this op targets (NEW-F4): the pending-edit journal persists it so
    // a post-reload fold can tell "my edit is newer than this row" (row.rev <= baseRev → fold)
    // from "a foreign writer advanced it" (row.rev > baseRev → rows canonical, discard).
    return [...out.values()].map((e) => ({ kind: e.kind, id: e.id, cls: e.cls, el: e.el, baseRev: revOf(e) }));
  }

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
    // A non-tombstone row for an element THIS tab already deleted, at a rev no newer than our delete,
    // is a stale pre-delete self-echo racing in late — the delete cleared the shadow's rev ceiling, so
    // without this it would resurrect the element + raise a false "another window" toast (B757). A
    // genuine re-create by another session arrives at a HIGHER rev than our delete and falls through.
    const tomb = tombstoned.get(key);
    if (tomb != null) {
      if (now() - tomb.at > recentWindowMs) tombstoned.delete(key); // aged out — bound memory, let it through
      else if (!row.deleted_at && rev <= tomb.rev) return { action: "ignore" };
    }
    const pendDirty = dirty.get(key);
    const pendInflight = inflightKeys.get(key); // an in-flight commit is as "ours" as a dirty one
    const pend = pendDirty || pendInflight;
    if (pend) {
      // A pending local commit exists for this element. Recognize OUR OWN echo: the realtime broadcast
      // of a write races its own RPC result, so the wire can still carry the IN-FLIGHT batch's data (D1)
      // AFTER a newer edit (D2) has queued into `dirty`, or a tombstone for a delete we ourselves have
      // in flight. Comparing only the dirty||inflight WINNER (D2) missed the in-flight echo (D1) and
      // mis-fired a foreign "another window" conflict during active SINGLE-TAB editing (the reported
      // false pop-up, B757). So match the row against EITHER pending serialization — and treat our own
      // delete's tombstone echo as ours. A genuine other-window write matches NEITHER, so it still
      // surfaces as a real conflict; two writes that produce identical data aren't a conflict anyway.
      if (row.deleted_at && ((pendInflight && pendInflight.cls === "delete") || (pendDirty && pendDirty.cls === "delete"))) {
        // our own delete (or a concurrent same-element delete → identical outcome) echoing back while a
        // delete is pending: the canvas already dropped it; processResults owns the shadow transition.
        return { action: "ignore" };
      }
      const rowJson = !row.deleted_at && row.data ? stableStringify(row.data) : null;
      const sameData = rowJson != null && (
        (pendInflight && pendInflight.el && stableStringify(pendInflight.el) === rowJson) ||
        (pendDirty && pendDirty.el && stableStringify(pendDirty.el) === rowJson) ||
        sentMatches(row.kind, row.id, rowJson) // our own committed-but-unacked write echoing back after a transport failure requeued a newer edit (B757)
      );
      // A queued identical update can be dropped outright (server already has it); otherwise local data
      // stays on canvas, the commit re-targets the fresh rev (LWW re-commit), and B673 gets the event.
      shadow.set(key, { kind: row.kind, id: row.id, json: sameData ? rowJson : (shad ? shad.json : ""), rev, z: row.z_index });
      if (sameData) {
        const q = dirty.get(key);
        if (q && q.el && stableStringify(q.el) === rowJson) dirty.delete(key); // server already has it
      } else {
        onEvent({ type: "remote-while-dirty", id: row.id, kind: row.kind, remote: row, authoredRecently: isRecent(row.kind, row.id) });
      }
      return { action: "ignore" };
    }
    if (row.deleted_at) {
      if (!shad) return { action: "ignore" }; // tombstone for something we never showed
      // Our OWN delete echoing back after a refetch re-seeded the shadow from a snapshot that still
      // showed the element ALIVE (the refetch's fetch predated our delete; its seed ran after) — with
      // no pending entry left, the tombstone passes the rev guard and mis-fires "…was deleted by you
      // (another window)". The delete floor remembers our delete's rev, so a tombstone at a rev no
      // newer than ours is our own echo: drop it from the canvas but never toast (B757 recurrence,
      // the delete variant of the no-pending read path below).
      const ownDeleteEcho = tomb != null && now() - tomb.at <= recentWindowMs && rev <= tomb.rev;
      shadow.delete(key);
      if (!ownDeleteEcho)
        onEvent({ type: "remote-delete", id: row.id, kind: row.kind, remote: row, authoredRecently: isRecent(row.kind, row.id) });
      return { action: "remove", kind: row.kind, id: row.id, row };
    }
    if (!row.data) return { action: "ignore" }; // malformed live row (CHECK should prevent this)
    tombstoned.delete(key); // a genuine higher-rev row (another session re-created it) → element is live again
    const upJson = stableStringify(row.data);
    shadow.set(key, { kind: row.kind, id: row.id, json: upJson, rev, z: row.z_index });
    // Our OWN just-committed edit can echo back at a rev ABOVE the shadow when a refetch-replace
    // re-seeded the shadow from a snapshot OLDER than that commit (the refetch's fetch was issued
    // before the commit landed; its seed ran after). With no pending entry left, the echo passes the
    // rev guard and — because we authored the element within the ~15s window — mis-fires "⟨you (another
    // window)⟩ changed ⟨element⟩ you just edited — their version is showing" for the WHOLE just-committed
    // batch (the reported single-tab burst). B757 hardened only the PENDING branch; this is the
    // no-pending read path it left open. Recognize the echo by DATA IDENTITY against what this tab put
    // on the wire in the last ~15s (recentSent) and apply it to the canvas WITHOUT a conflict event —
    // the upsert still runs so a stale-seed canvas re-trues. A genuine foreign write carries DIFFERENT
    // data (→ still toasts per the B673 matrix); a byte-identical write is not a conflict anyway (same
    // LWW result, nothing lost).
    if (!sentMatches(row.kind, row.id, upJson))
      onEvent({ type: "remote-upsert", id: row.id, kind: row.kind, remote: row, existed: !!shad, authoredRecently: isRecent(row.kind, row.id) });
    return { action: "upsert", kind: row.kind, id: row.id, el: row.data, row };
  }

  function stop() {
    stopped = true;
    clearDebounce();
    if (backoffHandle != null) { clearTimer(backoffHandle); backoffHandle = null; }
  }

  return {
    reconcile, flushGesture, retryNow, seed, stop, restore,
    pendingOps, pendingCount, dirtyEntries, applyRemoteRow,
    isSeeded: () => ready,
    // introspection for tests / B672-B673
    shadowSnapshot, isRecent,
    get state() { return state; },
    get recent() { return recent; },
  };
}
