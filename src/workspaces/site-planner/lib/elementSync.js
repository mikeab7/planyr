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
//
// It must produce EXACTLY what the value looks like AFTER a wire round-trip (JS object → JSON.stringify
// in the RPC → Postgres jsonb → back), because every self-echo / self-dup guard byte-compares a LOCAL
// object's serialization against a SERVER row's. JSON.stringify OMITS undefined-valued object keys and
// functions/symbols, and renders undefined / holes inside arrays as `null`; the old code instead emitted
// a literal `undefined` token for them, so any element carrying an `undefined` property (or a sparse
// array) serialized DIFFERENTLY on the two sides — a permanent mismatch that made a tab's own write look
// foreign (B812 red-team, Angle 2) AND produced spurious no-op diffs/commits. Mirror JSON semantics
// exactly (undefined/function/symbol → dropped in objects, `null` in arrays) so both sides agree.
export function stableStringify(v) {
  if (v === undefined || typeof v === "function" || typeof v === "symbol") return undefined; // JSON drops these
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (typeof v.toJSON === "function") return stableStringify(v.toJSON()); // match JSON (e.g. Date → ISO string)
  if (Array.isArray(v)) {
    let out = "[";
    for (let i = 0; i < v.length; i++) {
      if (i) out += ",";
      const s = stableStringify(v[i]);           // a hole/undefined/function element → `null`, like JSON
      out += s === undefined ? "null" : s;
    }
    return out + "]";
  }
  const parts = [];
  for (const k of Object.keys(v).sort()) {
    const s = stableStringify(v[k]);
    if (s === undefined) continue;               // JSON omits undefined-valued keys
    parts.push(JSON.stringify(k) + ":" + s);
  }
  return "{" + parts.join(",") + "}";
}

// NEW-1 (two-tab cascade false-conflict) — SEMANTIC data equality. Two live writers on one plan
// can hold copies of an element that are byte-DIVERGENT (a rows→canvas→re-derive round trip, float
// relayout noise) yet geometrically IDENTICAL — nothing the user could ever see moved. Byte guards
// (stableStringify equality, sentMatches) read such a copy as a foreign edit and toast. This
// comparator is the tie-breaker: numbers agree within `eps` (geometry is feet — relayout float
// noise is ~1e-12 ft, a real edit moves ≥ ~0.01 ft, so 1e-6 sits 4+ orders clear of both),
// everything else must match exactly, and objects must agree on the whole key set both ways
// (JSON semantics: an undefined-valued key equals an absent one, mirroring stableStringify).
// Used ONLY to decide who gets TOLD (events/toasts) — never to skip a write or drop data.
export function semanticallyEqual(a, b, eps = 1e-6) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    if (Number.isNaN(a) || Number.isNaN(b)) return Number.isNaN(a) && Number.isNaN(b);
    return Math.abs(a - b) <= eps;
  }
  if (a == null || b == null || typeof a !== typeof b || typeof a !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!semanticallyEqual(a[i], b[i], eps)) return false;
    return true;
  }
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (b[k] === undefined) return false;
    if (!semanticallyEqual(a[k], b[k], eps)) return false;
  }
  return true;
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
    // NEW-1 — (kind, id, el|null) => bool: is this op a DIRECT user edit (the element the gesture /
    // inline editor actually targeted), as opposed to an app-DERIVED relayout output (the bonded
    // paving / sidewalks / parking a building edit re-fits)? Only DIRECT ops feed the `recent` map,
    // so authoredRecently — and every "…you just edited" toast built on it — never fires for an
    // element the user never touched. Defaults to "everything is direct" (single-caller opt-in;
    // pre-NEW-1 behavior for tests and any caller that doesn't distinguish).
    isDirectEdit = () => true,
    // NEW-1 — () => the LIVE canvas collections ({ els, markups, … }) at the moment of the write.
    // Two things depend on it, and both are the assembly-tear fix:
    //   • ops are built from the state AT FLUSH TIME, not from the payload captured when the diff
    //     enqueued them — so a queued op can never put PRE-GESTURE coordinates on the wire;
    //   • an assembly (a host + everything `attachedTo` it) is closed over before the batch is
    //     built, so every member lands in the SAME commit instead of dribbling out across two.
    // Optional: omitted (tests, any caller without a canvas) → both behaviours are simply off and
    // the engine is byte-for-byte its pre-NEW-1 self.
    liveCollections = null,
    // NEW-1 (the stale-cache replay) — (adoptions) => void, where each entry is
    // { kind, id, el } carrying the SERVER's row data. Called when the first diff after a seed
    // finds an element the server already has whose canvas copy diverges with nothing pending to
    // explain it — a stale on-device cache replaying an old edit. Rows are canonical there, so the
    // canvas adopts them instead of the divergence being committed as a fresh edit.
    onRowsCanonical = null,
    // NEW-3 — how many consecutive ALL-REJECTED batches before this tab stops re-committing and
    // declares itself out of date. A stale client's ops are rejected by the rev guard forever;
    // re-queueing them on the plain debounce is a ~1 RPC/s hot loop with no exit.
    maxRejectStreak = 4,
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
  // key -> highest delete rev THIS tab committed for the element, NEVER time-pruned (dropped only when the
  // element is genuinely re-created / restored — a monotonic rev above the delete). The `tombstoned` map
  // above ages out at 15s (it feeds the B757 realtime-echo resurrect guard, which only needs the brief
  // in-flight window). But the REFETCH resurrect guard (reconcileSeedRows) needs the floor to outlive that:
  // a reconnect refetch can land LONG after a delete, and if its snapshot still shows the element alive it
  // would re-adopt it. A never-pruned high-water (session-long, mirrors maxOwnRev) keeps a just-deleted
  // element deleted across any in-session reconnect. (Cross-RELOAD is out of scope for this in-memory floor —
  // that needs a durable tombstone.) A genuine re-create always lands ABOVE this rev, so it isn't over-held.
  const maxDeleteRev = new Map();
  function recordTombstone(kind, id, rev) {
    const t = now();
    const k = skey(kind, id);
    const r = typeof rev === "number" ? rev : 0;
    tombstoned.set(k, { at: t, rev: r });
    const cur = maxDeleteRev.get(k);
    if (cur == null || r > cur) maxDeleteRev.set(k, r); // high-water, never time-pruned
    for (const [kk, v] of tombstoned) if (t - v.at > recentWindowMs) tombstoned.delete(kk); // bound the 15s map
  }
  const clearDeleteFloor = (key) => { tombstoned.delete(key); maxDeleteRev.delete(key); }; // element is live again
  // key -> Map(json -> at)  (EVERY data serialization THIS tab put ON THE WIRE for the key within the
  // window — not just the latest). Unlike inflightKeys — cleared the instant an RPC settles — this
  // SURVIVES a transport failure, so a committed-but-unacked write's realtime echo is still recognized
  // as ours even after onTransportFailure clears inflight and a newer edit has queued into dirty (the
  // B757 transport-failure echo variant). It is a SET per key (B812): a burst that re-commits one
  // element several times (a resized building's bonded child refit once per debounced flush) puts
  // DISTINCT jsons on the wire in quick succession; a single-slot cache remembered only the last, so an
  // echo of an INTERMEDIATE version read as foreign. On the SUCCESS path the rev guard / inflight match /
  // ownRevs already suppress the echo; this backstops the ok:false-but-actually-committed case where no
  // rev was ever learned. Pruned per entry to the recent window so it stays tiny.
  const recentSent = new Map();
  // NEW-1 (the straggler re-tear) — LOCAL-AUTHORITY EPOCH. Bumped by noteLocalAuthority() whenever
  // the app applies a whole-canvas snapshot (undo / redo / mid-drag cancel). Every serialization we
  // put on the wire is tagged with the epoch it was sent in, so a late echo of a write the user has
  // since UNDONE is identifiable as "our own bytes, from a world that no longer exists" and can be
  // kept off the canvas. Without it, such an echo re-applied pre-undo geometry to a couple of
  // elements after the restore, and the next diff dutifully committed that torn canvas back
  // (measured live: a 2-op straggler ~4 s after a 12-op undo, carrying pre-undo coordinates).
  let localEpoch = 0;
  function noteLocalAuthority() { localEpoch += 1; }
  function recordSent(kind, id, el) {
    if (!el) return; // deletes carry no data to match an echo against
    const t = now();
    const k = skey(kind, id);
    let m = recentSent.get(k);
    if (!m) { m = new Map(); recentSent.set(k, m); }
    m.set(stableStringify(el), { at: t, epoch: localEpoch });
    for (const [key, jm] of recentSent) { // bound memory: drop aged serializations, then empty keys
      for (const [j, r] of jm) if (t - r.at > recentWindowMs) jm.delete(j);
      if (jm.size === 0) recentSent.delete(key);
    }
  }
  // The in-window send record for these exact bytes ({ at, epoch }), or null.
  const sentRecord = (kind, id, json) => {
    const m = recentSent.get(skey(kind, id));
    if (!m) return null;
    const r = m.get(json);
    return r != null && now() - r.at <= recentWindowMs ? r : null;
  };
  const sentMatches = (kind, id, json) => !!sentRecord(kind, id, json);

  // key -> Map(rev -> at)  (EVERY server rev THIS tab's OWN commits produced within the window). Revs
  // are globally unique + monotonic per element (server-assigned), so an incoming realtime row whose
  // rev is one WE produced is DEFINITIVELY our own echo (B812). This is the one self-echo signal that
  // survives a stale refetch rolling the shadow's rev BACKWARD or DROPPING the entry entirely — the
  // cases the rev guard + shadow can't catch and the data caches missed for intermediate versions. A
  // genuine foreign write always carries a rev we never produced, so it still falls through to the
  // conflict matrix. Pruned per entry to the recent window so it stays tiny.
  const ownRevs = new Map();
  // key -> highest rev THIS tab ever committed for the element (a monotonic HIGH-WATER MARK, NOT time-
  // pruned). ownRevs above is pruned to the 15s window, but a self-echo can land LATER than that: an
  // element created during a burst, edited again >15s on, whose stale-refetch DROPPED its shadow entry —
  // by echo time both the create-rev (ownRevs) and its data (recentSent) have aged out, yet it's still
  // authoredRecently and shadow-less, so a replayed echo of the old create slipped into the pending
  // branch as a false remote-while-dirty (B812 red-team round-2, Angle 4). Because server revs are
  // monotonic per element, ANY non-tombstone row at a rev <= our high-water is our own write (or a
  // foreign write we already superseded with a higher own commit) — never a live foreign change, which
  // always lands ABOVE the current max. One int per key (bounded like the shadow), so no time-pruning.
  const maxOwnRev = new Map();
  function recordOwnRev(kind, id, rev) {
    if (typeof rev !== "number") return;
    const t = now();
    const k = skey(kind, id);
    let m = ownRevs.get(k);
    if (!m) { m = new Map(); ownRevs.set(k, m); }
    m.set(rev, t);
    const cur = maxOwnRev.get(k);
    if (cur == null || rev > cur) maxOwnRev.set(k, rev); // high-water, never rolls back / times out
    for (const [key, rm] of ownRevs) { // bound memory (the time-pruned exact set only)
      for (const [rv, at] of rm) if (t - at > recentWindowMs) rm.delete(rv);
      if (rm.size === 0) ownRevs.delete(key);
    }
  }
  const isOwnRev = (kind, id, rev) => {
    const m = ownRevs.get(skey(kind, id));
    if (!m) return false;
    const at = m.get(rev);
    return at != null && now() - at <= recentWindowMs;
  };
  // rev <= the highest rev we ever committed → definitively ours or already superseded by our own later
  // commit (monotonic revs); a live foreign edit always arrives strictly above it.
  const atOrBelowOwnHighWater = (kind, id, rev) => rev <= (maxOwnRev.get(skey(kind, id)) ?? 0);
  // NEW-3 — a row stamped with a DIFFERENT writer is definitively NOT our echo, whatever its rev.
  // The high-water guard above claims every row at/below our own max rev as ours; that is right for
  // an echo of our own write, but it also swallowed a genuine foreign row whose rev happened to sit
  // below our high-water (an out-of-band repair, or a writer whose rev landed under ours after a
  // stale refetch rolled our shadow backward). Swallowing it is half of why a torn plan never
  // converged: the client ignored the incoming rows and re-pushed its own copy over them. Fails
  // OPEN — no `selfUid` configured, or a row with no `updated_by`, is treated as possibly ours, so
  // every pre-existing self-echo guarantee (B757 / B812) is untouched.
  const foreignAuthor = (row) => !!(selfUid && row && row.updated_by && row.updated_by !== selfUid);

  let debounceHandle = null;
  let backoffHandle = null;
  let inflight = false;
  let attempt = 0;
  let rejectStreak = 0;   // NEW-3 — consecutive batches in which NOT ONE op was accepted
  let splitStreak = 0;    // NEW-1 (round 4) — consecutive batches that landed only PARTLY across an assembly
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
  /* ---- NEW-1: ROWS ARE CANONICAL ACROSS A SEED -------------------------------------------------
   * The rule, written down because it was never decided explicitly and the ambiguity cost a plan:
   *
   *   On the first diff after a seed, an element the SERVER ALREADY HAS wins over the local canvas
   *   unless there is a pending local op to explain the difference. An element the server has NEVER
   *   seen still wins locally — that, and only that, is what the B124 / B756 "never drop local work"
   *   guarantee covers.
   *
   * Why: after `seed(rows)` the shadow holds the server's current bytes AND its current revs. A
   * canvas copy that diverges at that instant is one of exactly two things — a genuine local edit,
   * which is in the dirty/in-flight queue (the refetch substitutes those back deliberately), or a
   * STALE ON-DEVICE CACHE replaying an edit that was already undone or superseded. The engine used
   * to treat both as an edit, and because the shadow had just adopted the FRESH rev, the stale copy
   * committed CLEANLY — the rev guard cannot help, since the client legitimately holds the current
   * rev. Measured on production: a plan opened in a profile with an old cache wrote the cached
   * geometry back over canonical rows in FOUR transactions across six seconds, for four members of a
   * twelve-member assembly, leaving the canvas torn.
   * That is also why the subset was never assembly-closed: `closeAssemblies` folds in members whose
   * live data disagrees with the shadow, and the other eight agreed — so the closure was correct and
   * the divergence was the bug. Adopting rows here fixes the subset problem at the root: nothing is
   * committed at all. */
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
  // B812 red-team — the delete floor, exposed for reconcileSeedRows so a stale refetch can't RESURRECT an
  // element THIS tab just deleted (the delete cleared its shadow entry, so reconcileSeedRows' rev check has
  // nothing to compare a fetched-alive row against). Sourced from the never-pruned high-water (B812 round-4)
  // so an in-session reconnect ARBITRARILY LATER than the delete still keeps it deleted; a genuine re-create
  // clears the floor and lands above the rev.
  const tombstonedSnapshot = () => {
    const out = new Map();
    for (const [k, rev] of maxDeleteRev) out.set(k, { rev });
    return out;
  };
  const isRecent = (kind, id) => {
    const r = recent.get(skey(kind, id));
    return !!r && now() - r.at <= recentWindowMs;
  };

  // NEW-1 — evaluate the direct-vs-derived tag for an op at enqueue time (the predicate reads the
  // caller's live interaction state, so it must run when the op is minted, not when it commits).
  // Fail-open to DIRECT: a predicate error must never silence a genuine "you just edited" heads-up.
  const directTag = (kind, id, el) => {
    try { return isDirectEdit(kind, id, el) !== false; } catch (_) { return true; }
  };

  // ---- diff the live collections against the shadow, enqueue ops --------------
  // `busy` (a gesture is in flight) defers the diff; the caller re-invokes on gesture end.
  // `exempt` — keys ("kind:id") that must diff NORMALLY even under `afterSeed`. NEW-2 (round 4):
  // the load-time bonded heal repairs a torn assembly on the canvas, and rows-canonical-on-seed
  // would immediately adopt the TORN rows back over that repair — the two fixes would fight, and
  // the rows (which are the broken copy in this case) would win. A healed element is not a stale
  // cache replay; it is a deliberate repair that must diff and COMMIT.
  function reconcile(collections, { busy, afterSeed, exempt } = {}) {
    if (stopped || !ready) return;  // not until the shadow is seeded from the DB (avoids load churn)
    if (busy) return;               // mid-drag: the flushGesture() hook re-runs this at gesture end
    const seen = new Set();
    let sawCreateOrDelete = false;
    // NEW-1 — `afterSeed` marks the ONE diff the seeder itself runs against the canvas it just
    // rebuilt (refetchReplace: rows ∪ pending local edits ∪ the never-synced fold). At that instant
    // any divergence on a server-known element with nothing pending is a stale cache replay, not an
    // edit. It is opt-in on purpose: a later, ordinary diff carries genuine post-seed edits that
    // must never be silently reverted, and only the seeder knows which call is which.
    const rowsWin = afterSeed ? [] : null;

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
              enqueue(key, { kind, id: el.id, cls: pend && pend.cls === "restore" ? "restore" : "create", el: elc, z: elc.z, direct: directTag(kind, el.id, elc) });
            sawCreateOrDelete = true;
          }
          continue;
        }
        const json = stableStringify(el);
        if (shad.json !== json) {
          // NEW-1 — rows are canonical across a seed. The server already has this element (it has a
          // shadow entry), and NOTHING is pending to explain the difference, so the canvas copy is a
          // stale cache replay: adopt the row instead of committing the divergence. `shad.stale`
          // marks a mixed json↔rev pairing (a conflict/echo adoption), which is not a trustworthy
          // adoption source — leave those to the normal diff.
          if (rowsWin && !pend && !inf && shad.json && !shad.stale && !(exempt && exempt.has(key))) {
            try { rowsWin.push({ kind, id: el.id, el: JSON.parse(shad.json) }); } catch (_) { /* unparseable → fall through */ }
            continue;
          }
          if (inf && inf.el && stableStringify(inf.el) === json) continue; // this exact data is already in flight
          // changed since last commit → update (unless an identical update is already queued)
          if (!pend || pend.cls === "delete" || stableStringify(pend.el) !== json) {
            enqueue(key, { kind, id: el.id, cls: "update", el, z: el.z, direct: directTag(kind, el.id, el) });
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
        enqueue(key, { kind: shad.kind, id: shad.id, cls: "delete", el: null, z: shad.z, direct: directTag(shad.kind, shad.id, null) });
        sawCreateOrDelete = true;
      }
    }
    if (rowsWin && rowsWin.length) {
      report("element-rows-canonical", "stale cached copies overruled by the server's rows on seed", { siteId, count: rowsWin.length, ids: rowsWin.slice(0, 20).map((r) => r.id) });
      if (onRowsCanonical) { try { onRowsCanonical(rowsWin); } catch (_) { /* adoption is best-effort — never break the diff */ } }
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
    enqueue(skey(kind, id), { kind, id, cls: "restore", el, z: el.z, direct: true }); // an explicit user action is always direct
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

  /* ---- NEW-1: an assembly is ATOMIC on the wire ------------------------------------------
   * A bonded assembly — a building plus every element `attachedTo` it (truck court, trailer
   * parking, sidewalks, side parking, corner bump-outs) — is ONE object as far as the user is
   * concerned: dragging the building moves all of it. The engine had no notion of that. A batch
   * was simply "whatever happened to be dirty", so a move could commit the host and part of its
   * children in one transaction and the rest in another seconds later — and the later one carried
   * whatever payload had been captured earlier. On the owner's plan that shipped the building
   * ~2,000 ft east while its truck court, trailer parking and three dock bump-outs stayed put.
   *
   * Two guarantees, applied in `flush()` immediately before the batch is built:
   *  (a) CLOSURE — if any member of an assembly is dirty, EVERY member whose live data disagrees
   *      with the server joins the same batch. One gesture → one commit → N+1 ops.
   *  (b) FRESHNESS — every op's data is re-read from the live canvas, so the bytes on the wire are
   *      the state at flush time. A payload captured before the gesture can no longer be sent. */
  function liveIndex() {
    if (!liveCollections) return null;
    let c;
    try { c = liveCollections(); } catch (_) { return null; }
    if (!c) return null;
    const byKey = new Map();
    for (const [kind, field] of FIELDS) {
      for (const el of c[field] || []) if (el && typeof el.id === "string") byKey.set(skey(kind, el.id), el);
    }
    return { byKey, els: Array.isArray(c.els) ? c.els : [] };
  }
  // An element's assembly root: its host when it is bonded, itself otherwise. (Same rule as
  // planClipboard's `rootIdOf` and the delete / nudge paths — one definition of "assembly".)
  const rootIdOf = (el, fallbackId) => (el && el.attachedTo != null ? el.attachedTo : (el ? el.id : fallbackId));

  function closeAssemblies(live) {
    if (!live || live.els.length < 2) return;
    const roots = new Set();
    for (const e of dirty.values()) {
      if (e.kind !== "el" || e.cls === "delete") continue; // a delete cascades through TOMBSTONE-DELETES, not here
      const r = rootIdOf(live.byKey.get(skey("el", e.id)) || e.el, e.id);
      if (r != null) roots.add(r);
    }
    if (!roots.size) return;
    for (const m of live.els) {
      if (!m || typeof m.id !== "string" || !roots.has(rootIdOf(m, m.id))) continue;
      const key = skey("el", m.id);
      if (dirty.has(key) || inflightKeys.has(key)) continue;
      const shad = shadow.get(key);
      if (!shad) continue;                        // never seen by the server → the normal diff mints its create
      const json = stableStringify(m);
      if (shad.json === json) continue;           // the server already agrees — nothing to send
      enqueue(key, { kind: "el", id: m.id, cls: "update", el: m, z: m.z, direct: false });
      report("element-assembly-joined", "assembly member folded into the same commit", { siteId, id: m.id, root: rootIdOf(m, m.id) });
    }
  }

  // Re-read an op's data from the live canvas so the bytes committed are the state at flush time.
  function freshen(e, live) {
    if (!live || e.cls === "delete") return e;
    let cur = live.byKey.get(skey(e.kind, e.id));
    if (!cur) return e;                            // gone from the canvas → the delete diff owns it
    // Keep the z the diff ASSIGNED to a z-less new element (patchElement writes it back to the
    // canvas asynchronously, so the live copy can still be missing it) — refreshing geometry must
    // never undo the stacking key this very op is carrying.
    if (typeof cur.z !== "number" && typeof e.z === "number") cur = { ...cur, z: e.z };
    const json = stableStringify(cur);
    if (json === stableStringify(e.el)) return e;  // already current
    report("element-op-refreshed", "queued op re-read from live state at flush time", { siteId, id: e.id, kind: e.kind, cls: e.cls });
    return { ...e, el: cur, z: typeof cur.z === "number" ? cur.z : e.z };
  }

  // Build ops from the dirty queue and commit them as ONE batch, serialized per site.
  function flush() {
    if (stopped || inflight || dirty.size === 0) return;
    clearDebounce();
    const live = liveIndex();
    closeAssemblies(live);                          // NEW-1 (a) — no assembly may straddle two commits
    const batch = [...dirty.values()].map((e) => freshen(e, live)); // NEW-1 (b) — state at flush time
    dirty.clear();
    for (const e of batch) { inflightKeys.set(skey(e.kind, e.id), e); recordSent(e.kind, e.id, e.el); } // protected like dirty until the result lands; recentSent survives a transport failure (B757)
    inflight = true;
    setState("syncing");
    // B1117 — ask for ALL-OR-NOTHING semantics when this batch carries more than one member of a
    // single assembly. That is exactly the case the server-side rollback exists for (verified live:
    // a two-op call with one good rev and one stale one left BOTH rows untouched). A single-element
    // batch has nothing to be atomic about, so it keeps the plain 2-arg call and the blast radius
    // of the new overload stays small.
    const atomic = batchSpansAssembly(batch);
    serialize(siteId, async () => {
      const ops = batch.map(opFor);
      let res;
      try { res = await commit(ops, { atomic }); }
      finally {
        inflight = false;
        for (const e of batch) inflightKeys.delete(skey(e.kind, e.id));
      }
      if (!res || !res.ok) return onTransportFailure(batch, res);
      attempt = 0;
      // B1117 — `applied === false`: the server rolled the WHOLE call back, so nothing landed —
      // including ops whose own per-op status reads "ok". Treating those as committed is precisely
      // the tear this mode exists to prevent, so the entire batch is re-queued at the fresh revs the
      // conflict rows carry, and it is said out loud.
      if (res.applied === false) return onAtomicRollback(batch, res.results || []);
      const accepted = processResults(batch, res.results || []);
      // NEW-3 — a batch in which NOT ONE op was accepted is a client that is out of date: its ops
      // will be rejected on the rev guard again, and again. Re-queueing them on the plain debounce
      // is a ~1 RPC/s hot loop with no exit (measured live: a stale tab issued an 8-op
      // `commit_elements` every ~1 s for at least 7 s, every op rejected, the rows never moving —
      // the CAS did its job, but nothing stopped the client). Back off exponentially, and after
      // `maxRejectStreak` consecutive all-rejected batches STOP and say so.
      if (batch.length && !accepted) {
        rejectStreak += 1;
        if (dirty.size > 0) {
          if (rejectStreak >= maxRejectStreak) {
            setState("stale");
            report("element-client-stale", "every op rejected repeatedly — this tab is out of date", { siteId, streak: rejectStreak, pending: dirty.size });
            onEvent({ type: "client-stale", streak: rejectStreak, pending: dirty.size });
            return;                                    // no further commits until retryNow() / a reload
          }
          const wait = backoff[Math.min(rejectStreak - 1, backoff.length - 1)];
          if (backoffHandle != null) clearTimer(backoffHandle);
          setState("retrying");
          backoffHandle = setTimer(() => { backoffHandle = null; flush(); }, wait);
          return;
        }
      } else if (accepted) {
        rejectStreak = 0;                              // progress — the streak is broken
      }
      // Anything re-queued during processing (a LWW re-commit, a re-applied delete, a missing-row
      // re-create) reschedules through the DEBOUNCE timer, never a synchronous immediate flush — a
      // server that keeps returning conflict must not become a hot re-commit loop (LOUD-FAILURE, not
      // runaway). At the ~debounceMs cadence LWW still converges within a fraction of a second.
      if (dirty.size > 0) schedule(false); else setState("idle");
    });
  }

  // Does this batch carry more than one member of the same assembly? (B1117 — the atomic gate.)
  function batchSpansAssembly(batch) {
    if (batch.length < 2) return false;
    const live = liveIndex();
    const seen = new Set();
    for (const e of batch) {
      if (e.kind !== "el") continue;
      const cur = (live && live.byKey.get(skey("el", e.id))) || e.el;
      const root = rootIdOf(cur, e.id);
      if (root == null) continue;
      if (seen.has(root)) return true;
      seen.add(root);
    }
    return false;
  }

  // B1117 — an atomic call the server rolled back. NOTHING was written, so no shadow json may be
  // advanced; only the REVS are adopted (from the conflict rows) so the retry targets the current
  // rows instead of repeating the same stale expectation. The whole batch is re-queued.
  function onAtomicRollback(batch, results) {
    const byId = new Map();
    for (const r of results) if (r && r.id) byId.set(r.id, r);
    for (const e of batch) {
      const key = skey(e.kind, e.id);
      const row = (byId.get(e.id) || {}).row;
      if (row && typeof row.rev === "number") {
        const cur = shadow.get(key);
        // Keep OUR json as the diff baseline (our data is still what the canvas holds and what we
        // intend to write); adopt only the rev, flagged `stale` because json and rev now disagree.
        if (cur) shadow.set(key, { ...cur, rev: row.rev, stale: true });
      }
      if (!dirty.has(key)) enqueue(key, e);
    }
    splitStreak += 1;
    report("element-atomic-rollback", "the server rolled the whole group back — re-committing at fresh revs", { siteId, ops: batch.length, streak: splitStreak });
    onEvent({ type: "assembly-split", ids: batch.map((e) => e.id), streak: splitStreak, rolledBack: true });
    if (splitStreak >= maxRejectStreak) {
      setState("stale");
      report("element-assembly-split-unresolved", "an assembly would not commit whole", { siteId, streak: splitStreak });
      onEvent({ type: "client-stale", streak: splitStreak, pending: dirty.size, reason: "assembly-split" });
      return;
    }
    const wait = backoff[Math.min(splitStreak - 1, backoff.length - 1)];
    if (backoffHandle != null) clearTimer(backoffHandle);
    setState("retrying");
    backoffHandle = setTimer(() => { backoffHandle = null; flush(); }, wait);
  }

  function opFor(e) {
    if (e.cls === "create") return { op: "create", id: e.id, kind: e.kind, z: e.z, data: e.el };
    if (e.cls === "delete") return { op: "delete", id: e.id, kind: e.kind, expected: revOf(e) };
    if (e.cls === "restore") return { op: "restore", id: e.id, kind: e.kind, z: e.z, data: e.el };
    return { op: "update", id: e.id, kind: e.kind, z: e.z, expected: revOf(e), data: e.el };
  }
  const revOf = (e) => { const s = shadow.get(skey(e.kind, e.id)); return s ? s.rev : 1; };

  // Apply the RPC's per-op results back onto the shadow + emit conflict events.
  // Returns TRUE if at least one op was ACCEPTED (NEW-3 — a batch with none is a stale client).
  function processResults(batch, results) {
    let accepted = false;
    const acceptedKeys = new Set();   // NEW-1 (round 4) — which ops the server actually took…
    const refusedKeys = new Map();    // …and which it refused (key -> entry), for the split check
    const byId = new Map();
    for (const r of results) if (r && r.id) byId.set(r.id, r); // ids are unique within a batch
    for (const e of batch) {
      const r = byId.get(e.id) || {};
      const key = skey(e.kind, e.id);
      if (r.status === "ok") {
        accepted = true;
        acceptedKeys.add(key);
        if (e.cls === "delete") { shadow.delete(key); recordTombstone(e.kind, e.id, r.rev); } // remember the delete's rev → a stale pre-delete self-echo can't resurrect it (B757)
        else {
          // keep the shadow rev MONOTONIC: a foreign realtime row may have advanced it past this
          // commit's rev while the op was in flight (applyRemoteRow's in-flight branch) — adopting
          // the older r.rev back would make the next commit a guaranteed spurious conflict.
          const cur = shadow.get(key);
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(e.el), rev: cur && cur.rev > r.rev ? cur.rev : r.rev, z: e.z });
          clearDeleteFloor(key); // element is live again → drop the stale-delete floor (incl. the never-pruned refetch high-water)
        }
        // NEW-1 — only a DIRECT user edit claims authorship: a cascade-derived relayout write
        // (the paving/sidewalks/parking a building edit re-fit) must never make a later foreign
        // row toast "…changed ⟨element⟩ you just edited". Self-echo identity below is unaffected
        // (recordOwnRev / recordSent are about which BYTES are ours, not who authored them).
        if (e.direct !== false) recent.set(key, { at: now(), rev: r.rev });
        recordOwnRev(e.kind, e.id, r.rev); // B812 — this rev is one OUR commit produced; its echo is ours
      } else if (r.status === "conflict") {
        refusedKeys.set(key, e);
        const row = r.row || {};
        if (e.cls === "restore") {
          // someone restored/edited it first — the live row is the truth; adopt it, don't re-push. BUT
          // if the live row already holds EXACTLY our data, our OWN restore already landed — a timed-out-
          // but-committed restore (COMMIT_TIMEOUT_MS) whose retry now sees its own row — so adopt silently,
          // no toast (B757). Data-equality gated (not updated_by alone) so a genuine race that restored
          // DIFFERENT data still surfaces per the B673 matrix.
          const selfDup = row.data && stableStringify(row.data) === stableStringify(e.el);
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(row.data), rev: row.rev, z: row.z_index });
          clearDeleteFloor(key);
          if (selfDup) {
            if (e.direct !== false) recent.set(key, { at: now(), rev: row.rev }); // NEW-1 — restores are always direct; keep the gate uniform
            recordOwnRev(e.kind, e.id, row.rev); // B812 — our own restore landed at this rev; its echo is ours
            report("element-restore-self-dup", "restore conflict row IS our own committed data — silent", { siteId, id: e.id, kind: e.kind });
          } else {
            report("element-restore-conflict", "restore raced a live row", { siteId, id: e.id, kind: e.kind });
            onEvent({ type: "restore-conflict", id: e.id, kind: e.kind, remote: row });
          }
        } else if (e.cls === "delete") {
          // delete-vs-edit: delete WINS — re-issue at the fresh rev (per the B673 matrix).
          // `stale`: the kept json predates the adopted rev — reconcileSeedRows must not
          // substitute this mixed json↔rev pairing into a refetch re-seed (NEW-1 hardening).
          shadow.set(key, { kind: e.kind, id: e.id, json: shadow.get(key)?.json || "", rev: row.rev, z: e.z, stale: true });
          enqueue(key, { kind: e.kind, id: e.id, cls: "delete", el: null, z: e.z, direct: e.direct });
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
          clearDeleteFloor(key);
          if (e.direct !== false) recent.set(key, { at: now(), rev: row.rev }); // NEW-1 — derived churn never claims authorship
          recordOwnRev(e.kind, e.id, row.rev); // B812 — the "conflict" row IS our data at this rev; its echo is ours
          report("element-conflict-self-dup", "conflict row IS our own committed data — silent", { siteId, id: e.id, kind: e.kind });
        } else if (row.data && semanticallyEqual(row.data, e.el)) {
          // NEW-1 — SEMANTICALLY-EQUAL conflict: the live row is byte-divergent from our data
          // (another window's rows→canvas→re-derive round trip, float relayout noise) but
          // geometrically identical — nothing the user could see differs, so there is nothing
          // to warn about and nothing worth another write. Adopt the remote rev with OUR bytes
          // as the diff baseline (the canvas already holds them, so the next reconcile stays
          // quiet — no re-commit ping-pong between two live tabs), no event, no toast. A row
          // carrying a GENUINE difference still falls through to the loud LWW branch below.
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(e.el), rev: row.rev, z: e.z });
          clearDeleteFloor(key);
          if (e.direct !== false) recent.set(key, { at: now(), rev: row.rev });
          report("element-conflict-sem-eq", "conflict row is semantically identical — silent adopt", { siteId, id: e.id, kind: e.kind });
        } else if (e.direct === false && foreignAuthor(row)) {
          // NEW-1 (round 4) — `foreignAuthor(row)` is the correction that makes this rule safe. The
          // yield below is right when ANOTHER writer's row lost us the race. It is catastrophically
          // wrong when the row is OUR OWN TAB'S earlier write: on an undo, the whole assembly's ops
          // conflict against the move we are undoing, every bonded child is DERIVED, and yielding
          // meant eleven of twelve ops stood down in silence while the host's single accepted op
          // went through — the plan left with the building restored and every child still moved.
          // Never yield to yourself; a self-conflict is a torn write, not a foreign edit.
          //
          // NEW-3 — the commit-result half of the derived-yield rule above. A DERIVED op that lost a
          // race must NOT be re-committed: re-pushing app-derived geometry over a foreign row is
          // exactly the loop that kept the owner's repaired rows from surviving ("queued 3 commit
          // batches to push its own copy back over mine"). Adopt the remote rev with OUR bytes as the
          // diff baseline, so the next reconcile is quiet and there is no ping-pong; the realtime row
          // for that rev now reaches the canvas through the (no-longer-pending) read path above.
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(e.el), rev: row.rev, z: e.z });
          clearDeleteFloor(key);
          report("element-conflict-derived-yield", "derived op lost the race — not re-committed", { siteId, id: e.id, kind: e.kind, remoteRev: row.rev });
          onEvent({ type: "edit-vs-edit-lost-race", id: e.id, kind: e.kind, remote: row, authoredRecently: isRecent(e.kind, e.id) });
        } else {
          // edit-vs-edit: second writer wins — adopt the remote rev and re-commit local on top (LWW).
          // `stale`: json "" at the adopted rev is a mixed pairing — never a re-seed substitution source.
          shadow.set(key, { kind: e.kind, id: e.id, json: "", rev: row.rev, z: e.z, stale: true });
          enqueue(key, { kind: e.kind, id: e.id, cls: "update", el: e.el, z: e.z, direct: e.direct });
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
        shadow.set(key, { kind: e.kind, id: e.id, json: "", rev: row.rev, z: e.z, stale: true });
        enqueue(key, { kind: e.kind, id: e.id, cls: "update", el: e.el, z: e.z, direct: e.direct });
        report("element-create-collision", "create hit a live row (should be impossible)", { siteId, id: e.id, kind: e.kind });
      } else if (r.status === "missing") {
        // server has no such row. An update/delete on a purged row → re-create (update) or drop (delete).
        if (e.cls === "delete") { shadow.delete(key); }
        else { shadow.delete(key); enqueue(key, { kind: e.kind, id: e.id, cls: "create", el: e.el, z: e.z, direct: e.direct }); }
        report("element-missing", "op targeted an absent row", { siteId, id: e.id, kind: e.kind, cls: e.cls });
      } else {
        // no result for this op (malformed response) — requeue to try again
        enqueue(key, e);
        report("element-no-result", "op had no result in the batch response", { siteId, id: e.id, kind: e.kind });
      }
    }
    /* NEW-1 (round 4) — ASSEMBLY SPLIT. A batch that lands only PARTLY is the exact tear this whole
     * effort exists to prevent: measured on production, an undo's 12-op batch had ONE op accepted
     * (the host) and eleven refused, so the plan was left with the building restored and every
     * child still moved — and the client treated the commit as settled and went quiet.
     *
     * Client-side atomicity is not enough on its own, because atomicity has to hold at the SERVER
     * too; `db/commit_elements_atomic.sql` is the all-or-nothing group commit that closes the
     * window properly. This is the half that is ours to enforce unilaterally: if any member of an
     * assembly was accepted while another was refused, the assembly is TORN, so nothing is settled
     * — re-enqueue every refused member of that assembly (the conflict branches above have already
     * adopted the fresh revs, so the retry targets the current rows) and say so out loud. */
    if (acceptedKeys.size && refusedKeys.size) {
      const live = liveIndex();
      const rootOf = (e) => {
        if (e.kind !== "el") return e.kind + ":" + e.id;                 // only elements form assemblies
        const cur = (live && live.byKey.get(skey("el", e.id))) || e.el;
        return "el:" + rootIdOf(cur, e.id);
      };
      const acceptedRoots = new Set();
      for (const e of batch) if (acceptedKeys.has(skey(e.kind, e.id))) acceptedRoots.add(rootOf(e));
      const torn = [];
      for (const [key, e] of refusedKeys) {
        if (!acceptedRoots.has(rootOf(e))) continue;                    // wholly-refused group: the normal paths own it
        torn.push(e.id);
        if (!dirty.has(key)) enqueue(key, { kind: e.kind, id: e.id, cls: "update", el: e.el, z: e.z, direct: e.direct });
      }
      if (torn.length) {
        splitStreak += 1;
        report("element-assembly-split", "a batch landed only partly across an assembly — re-committing the rest", { siteId, ids: torn.slice(0, 20), streak: splitStreak });
        onEvent({ type: "assembly-split", ids: torn, streak: splitStreak });
        // Not converging after several rounds is a genuine dead end — go loud rather than loop.
        if (splitStreak >= maxRejectStreak) {
          setState("stale");
          report("element-assembly-split-unresolved", "an assembly would not commit whole", { siteId, streak: splitStreak });
          onEvent({ type: "client-stale", streak: splitStreak, pending: dirty.size, reason: "assembly-split" });
        }
      }
    } else if (acceptedKeys.size && !refusedKeys.size) {
      splitStreak = 0;                                                   // a clean batch clears the streak
    }
    return accepted;
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
  function retryNow() { attempt = 0; rejectStreak = 0; splitStreak = 0; if (backoffHandle != null) { clearTimer(backoffHandle); backoffHandle = null; } flush(); }

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
    // OWN-ECHO-BY-REV (B812) — the definitive single-tab self-echo guard. An incoming NON-tombstone row
    // whose rev is one THIS tab's own commit produced within the window is unambiguously our realtime
    // echo, EVEN when a stale refetch rolled the shadow's rev BACKWARD or DROPPED the entry (so the rev
    // guard above can't catch it) or a re-create is pending (which would otherwise mis-fire
    // remote-while-dirty). Keep the shadow rev MONOTONIC so the next local commit targets the freshest
    // rev, then ignore with NO event and NO canvas change: our canvas already holds this element's data
    // at least as fresh (the refetch-replace fold re-placed our latest local copy), and an INTERMEDIATE
    // own-echo carries OLDER data than our current state, so upserting it would flicker the canvas back.
    // A foreign write carries an unrecorded rev ABOVE our high-water → falls through to the conflict
    // matrix unchanged. (isOwnRev is the exact-rev, in-window match; the high-water floor also catches a
    // self-echo that outlived the 15s window — Angle-4 — since anything at/below our max is ours.)
    // NEW-3 — `!foreignAuthor(row)`: a row written by somebody else is never our echo, so it must
    // reach the conflict matrix below instead of being ignored on rev arithmetic alone.
    if (!row.deleted_at && !foreignAuthor(row) &&
        (isOwnRev(row.kind, row.id, rev) || atOrBelowOwnHighWater(row.kind, row.id, rev))) {
      const cur = shadow.get(key);
      // `stale` when an existing entry's json is KEPT under the bumped rev (the kept json can be an
      // older copy than the rev now claims — a mixed pairing reconcileSeedRows must never substitute
      // into a refetch re-seed; NEW-1 hardening). A fresh entry built from row.data is authoritative.
      if (!cur || rev > cur.rev)
        shadow.set(key, { kind: row.kind, id: row.id, json: cur ? cur.json : (row.data ? stableStringify(row.data) : ""), rev, z: cur ? cur.z : row.z_index, ...(cur ? { stale: true } : {}) });
      return { action: "ignore" };
    }
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
      // NEW-1 — a byte-divergent but SEMANTICALLY identical row (another window's re-derived copy,
      // float noise apart) is not a conflict worth telling anyone about: keep the normal LWW
      // re-commit (our bytes still land) but skip the remote-while-dirty toast.
      const semEq = !sameData && rowJson != null && (
        (pendInflight && pendInflight.el && semanticallyEqual(row.data, pendInflight.el)) ||
        (pendDirty && pendDirty.el && semanticallyEqual(row.data, pendDirty.el))
      );
      // NEW-3 — DERIVED churn must never beat a genuine foreign row. "Local wins" below is the right
      // rule for an edit the user just made by hand, but most pending ops on a bonded plan are
      // app-DERIVED relayout output (the paving / sidewalks / parking a building edit re-fits). When
      // the only thing pending is derived, re-pushing it over another writer's deliberate row is how
      // a torn assembly stopped converging: whichever client held the stale copy kept winning, so a
      // repaired row was overwritten within seconds, forever. So a foreign row (bytes we never sent,
      // a rev we never produced, and — where the writer is stamped — someone else's) WINS: drop our
      // derived op, adopt the row's bytes and rev, and put it on the canvas.
      const pendDirect = (pendDirty && pendDirty.direct !== false) || (pendInflight && pendInflight.direct !== false);
      if (!sameData && !semEq && rowJson != null && !pendDirect) {
        shadow.set(key, { kind: row.kind, id: row.id, json: rowJson, rev, z: row.z_index });
        dirty.delete(key);
        clearDeleteFloor(key);
        report("element-derived-yield", "derived local op yielded to a foreign row", { siteId, id: row.id, kind: row.kind, rev });
        onEvent({ type: "remote-upsert", id: row.id, kind: row.kind, remote: row, existed: !!shad, authoredRecently: isRecent(row.kind, row.id) });
        return { action: "upsert", kind: row.kind, id: row.id, el: row.data, row };
      }
      // A queued identical update can be dropped outright (server already has it); otherwise local data
      // stays on canvas, the commit re-targets the fresh rev (LWW re-commit), and B673 gets the event.
      // `stale` on the kept-json pairing (NEW-1 hardening — see the own-echo branch above).
      shadow.set(key, { kind: row.kind, id: row.id, json: sameData ? rowJson : (shad ? shad.json : ""), rev, z: row.z_index, ...(sameData ? {} : { stale: true }) });
      if (sameData) {
        const q = dirty.get(key);
        if (q && q.el && stableStringify(q.el) === rowJson) dirty.delete(key); // server already has it
      } else if (!semEq) {
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
    clearDeleteFloor(key); // a genuine higher-rev row (another session re-created it) → element is live again
    const upJson = stableStringify(row.data);
    // NEW-1 — before the shadow adopts the row, test whether it is SEMANTICALLY identical to what
    // the canvas already shows (the pre-adopt shadow json): another same-account window's
    // rows→canvas→re-derive round trip commits byte-divergent copies of cascade-derived elements
    // (paving / sidewalks / parking) whose geometry is unchanged. Those pass the byte guards
    // (recentSent can't match bytes we never produced) and — because the cascade used to stamp
    // `recent` — toasted "you (another window) changed a ⟨paving area⟩ you just edited" in a burst.
    // Nothing visible differs, so: apply the upsert (bytes converge to the server's copy), no event.
    let semEqShadow = false;
    if (shad && shad.json && !shad.stale) {
      try { semEqShadow = semanticallyEqual(row.data, JSON.parse(shad.json)); } catch (_) { semEqShadow = false; }
    }
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
    const sent = sentRecord(row.kind, row.id, upJson);
    // NEW-1 — STALE OWN ECHO: these are bytes THIS TAB put on the wire, sent BEFORE the app applied
    // a whole-canvas snapshot (an undo / redo / mid-drag cancel). The user has explicitly discarded
    // that state, so re-applying it here would resurrect exactly what they just undid — and the next
    // diff would then commit the resurrected geometry back as a fresh edit, which is how a 12-member
    // assembly ended up with 10 members restored and 2 stranded. Adopt the rev (so the next commit
    // still targets the fresh row) but keep it OFF the canvas, with no event. The shadow now
    // disagrees with the canvas, which is correct: the next reconcile re-asserts the SNAPSHOT's
    // geometry — assembly-closed, as one batch. A foreign row, or an own echo from the CURRENT
    // epoch, is untouched by this and still upserts exactly as before.
    if (sent && sent.epoch < localEpoch) {
      report("element-stale-own-echo", "own echo predating an applied snapshot kept off the canvas", { siteId, id: row.id, kind: row.kind, rev });
      return { action: "ignore" };
    }
    if (!sent && !semEqShadow)
      onEvent({ type: "remote-upsert", id: row.id, kind: row.kind, remote: row, existed: !!shad, authoredRecently: isRecent(row.kind, row.id) });
    return { action: "upsert", kind: row.kind, id: row.id, el: row.data, row };
  }

  function stop() {
    stopped = true;
    clearDebounce();
    if (backoffHandle != null) { clearTimer(backoffHandle); backoffHandle = null; }
  }

  return {
    reconcile, flushGesture, retryNow, seed, stop, restore, noteLocalAuthority,
    pendingOps, pendingCount, dirtyEntries, applyRemoteRow,
    isSeeded: () => ready,
    // introspection for tests / B672-B673
    shadowSnapshot, tombstonedSnapshot, isRecent,
    get state() { return state; },
    get recent() { return recent; },
  };
}
