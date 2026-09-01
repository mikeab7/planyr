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
import { assemblyDigest } from "./assemblyDigest.js";

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

/* isOwnWrite(row, selfUid) — THE single, standalone answer to "did this ROW originate from my own
 * ACCOUNT?" (see docs/DATA.md §3 "One-answer functions" for the fuller picture, incl. why the
 * per-TAB echo question — "have I already sent these exact bytes/this exact rev?" — is a genuinely
 * DIFFERENT question and is deliberately NOT folded in here).
 *
 * Extracted as a pure, module-level function (no closure state) SPECIFICALLY so it can be reused
 * outside one engine instance — `foreignAuthor` below is this same logic, inverted and pre-bound to
 * one engine's `selfUidNow()`, and every one of its ~10 call sites (plus the CI sweep in
 * test/elementSyncOwnWriteGate.test.js that fails the build if a new self-attributable notice skips
 * it) is UNCHANGED by this extraction — this is a pure refactor, verified against the full existing
 * elementSync/conflict-matrix test suite.
 *
 * A tombstone's actor is `deleted_by`, never `updated_by` (site_elements sets ONE of the two per
 * statement) — read `deleted_by` first so a delete row is judged, not silently read as "unknown".
 * Fails OPEN toward "mine" when either side is unknown (no `selfUid`, or a row with no stamped
 * author) — an unattributable row must never be treated as definitively foreign, which is what lets
 * every self-echo guarantee built on this function hold with no selfUid configured at all. */
export function isOwnWrite(row, selfUid) {
  const author = row && (row.deleted_by || row.updated_by);
  return !(selfUid && author && author !== selfUid);
}

const skey = (kind, id) => kind + ":" + id;
const DEFAULT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

/* NEW-1 — a commit result names an ID; an OP names a (kind, id). Those are not the same thing.
 *
 * `site_elements`' primary key is (site_id, kind, id) BY DESIGN — legacy pre-salt ids are reused
 * verbatim across collections, so one id can name two different live rows. That is not theoretical:
 * site `smqh3au6aeb4` (Katz / Plan 1) holds `e6327` as kind `el` AND as kind `markup`, both live,
 * both at the identical `updated_at`, i.e. written by ONE batch. Two places here keyed a batch's
 * results by `r.id` alone (under a comment claiming ids are unique within a batch), so the second
 * result overwrote the first and each op was handed the OTHER row's status and rev, in silence.
 *
 * ⚠ The obvious fix — key by `skey(r.kind, r.id)` — is NOT available: the RPC builds every result
 * from `v_id` alone (`db/site_elements.sql`), so there is no `r.kind` to key on, and keying by a
 * field the server never sends would miss on every op and break the whole write path. What the RPC
 * DOES guarantee is ORDER: it loops over `p_ops` appending exactly one result per op, and `flush()`
 * builds `ops = batch.map(opFor)` — so `results[i]` belongs to `batch[i]`.
 *
 * So pair POSITIONALLY, and VERIFY the pairing rather than trusting it: the ids must agree, and so
 * must the kind whenever a returned `row` names one. A response that fails that check falls back to
 * a per-id FIFO that consumes each result once (preferring one whose row names this op's kind), and
 * says so out loud (LOUD-FAILURE) — a pairing we cannot justify must never look like a clean one.
 */
const resultKindOf = (r) => (r && (r.kind || (r.row && r.row.kind))) || null;

function pairCommitResults(batch, results, onUnaligned) {
  const list = Array.isArray(results) ? results : [];
  const out = new Map();
  let aligned = list.length === batch.length;
  for (let i = 0; aligned && i < batch.length; i++) {
    const r = list[i], e = batch[i];
    const rk = resultKindOf(r);
    if (!r || (r.id != null && r.id !== e.id) || (rk && rk !== e.kind)) aligned = false;
  }
  if (aligned) {
    for (let i = 0; i < batch.length; i++) out.set(skey(batch[i].kind, batch[i].id), list[i]);
    return out;
  }
  const queues = new Map();
  for (const r of list) {
    if (!r || r.id == null) continue;
    const q = queues.get(r.id);
    if (q) q.push(r); else queues.set(r.id, [r]);
  }
  for (const e of batch) {
    const q = queues.get(e.id);
    if (!q || !q.length) continue;
    let i = q.findIndex((r) => resultKindOf(r) === e.kind);      // a result that NAMES this kind wins
    if (i < 0) i = q.findIndex((r) => !resultKindOf(r));         // …else the next result that names none
    if (i < 0) continue;                                        // every one left belongs to another kind
    out.set(skey(e.kind, e.id), q.splice(i, 1)[0]);
  }
  // An EMPTY response is already reported per-op as `element-no-result`; don't say it twice.
  if (list.length && onUnaligned) onUnaligned(list.length);
  return out;
}

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
    // NEW-1 — (summary) => void, called once every batch's result has settled (accepted, refused,
    // rolled back or transport-failed alike). The caller re-runs the bonded-assembly ASSERTION
    // against the live canvas there: "after every assembly write" is the moment a tear is newest
    // and cheapest to name, and it is the moment the previous eight fixes had no observer at all —
    // which is why eight recurrences were only ever noticed by the owner looking at his plan.
    // Optional; never allowed to break the commit path.
    afterCommit = null,
    // NEW-3 — how many consecutive ALL-REJECTED batches before this tab stops re-committing and
    // declares itself out of date. A stale client's ops are rejected by the rev guard forever;
    // re-queueing them on the plain debounce is a ~1 RPC/s hot loop with no exit.
    maxRejectStreak = 4,
    // B1341 stage 2 — () => bool, asked at CALL time. Omitted → group CAS is OFF and every call is
    // byte-for-byte its pre-stage-2 self, which is what makes this stage inert until switched on.
    groupCas = null,
    // NEW-2 (B712225) — () => envelope|null, the operation-envelope tracker's `current()` (see
    // operationEnvelope.js). Read at ENQUEUE time (reconcile()/restore()/closeAssemblies()), the
    // SAME moment `isDirectEdit` is asked — never at flush time, because a batch can bundle ops
    // enqueued under different open operations and each row must carry the envelope that was live
    // when IT was diffed, not whichever gesture happens to be open when the debounce fires. A row
    // enqueued with no tracker wired (omitted, or the getter throws) carries no envelope fields —
    // byte-for-byte the pre-NEW-2 wire shape, so an unwired caller (tests, any site without the
    // tracker) is unaffected.
    envelopeNow = null,
  } = opts;
  const envelopeForEnqueue = () => { try { return envelopeNow ? envelopeNow() : null; } catch (_) { return null; } };

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
  /* ⛔ B712224 (round 3) — ONE-SHOT EXEMPTION for a DELIBERATE re-create over the delete floor.
   * `restore()` (the B673 "deleted by ⟨name⟩" toast) is one such signal and is checked directly
   * (`pend.cls === "restore"`); undo/redo of a delete is the other — `applySnapshot` restores a
   * WHOLE prior canvas snapshot generically (it has no notion of "this specific element used to be
   * deleted"), so it stages every id the snapshot holds here, immediately before its own synchronous
   * `flushElems` call, and `reconcile()`'s `!shad` branch consults it. Cleared at the end of EVERY
   * `reconcile()` call — this is meant to cover exactly the ONE diff pass that follows staging, never
   * to linger and mask an unrelated stale-canvas read on some later, unrelated diff. */
  const pendingResurrect = new Set();
  function allowResurrect(items) {
    for (const it of items || []) { if (it && it.id != null) pendingResurrect.add(skey(it.kind || "el", it.id)); }
  }
  /* NEW-1 — BIRTHS, and the reason this map has to exist.
   *
   * "Delete wins" is the right rule for delete-vs-EDIT and it is the wrong rule for
   * delete-vs-CREATE. Measured on the owner's plan `smsdrvzr9gzx` (13:38:49.543–546): one tab
   * created a building assembly — host + two truck courts + two trailer rows — while another tab
   * still held a delete formed BEFORE those ids existed. The delete lost its rev guard, the
   * conflict branch below stripped the stale rev and re-issued at the fresh one, and three rows
   * that were 1.75 s old died. A delete whose base predates the row's own creation is not a
   * decision about the row that exists; it is a decision about a row that no longer does.
   *
   * Nothing in the wire format says "this row was created at rev N" — `site_elements` has no
   * `created_at` and the RPC returns none — so the client records what it can honestly observe:
   * the moment IT first saw an element come into existence (a realtime row for a key the shadow
   * has never held). That is exactly the signal needed here, because the tab that will issue the
   * stale delete is the one that watched the creation arrive.
   *
   * Never time-pruned to a short window on purpose: a delete can sit in the queue behind a backoff
   * for tens of seconds, and forgetting the birth is precisely how the guard would fail open. One
   * small record per key, dropped when the element is deleted for real. */
  const births = new Map();          // key -> { rev, at }  (when THIS tab first saw the element exist)
  const noteBirth = (kind, id, rev) => {
    const k = skey(kind, id);
    const prev = births.get(k);
    const r = typeof rev === "number" ? rev : 0;
    if (prev && prev.rev >= r) return;             // keep the EARLIEST birth we know of for this incarnation
    births.set(k, { rev: r, at: now() });
  };
  /* NEW-1 — AND THE SIGNAL THAT ACTUALLY CATCHES THE MEASURED CASE, which the rev comparison above
   * cannot: elements the SHADOW learned about from a live remote row that the CANVAS has never
   * shown.
   *
   * The diff mints a delete for exactly one reason — the shadow holds an element and the
   * collections do not — and it cannot tell the two ways that happens apart. One is a user
   * deleting something. The other is a row arriving from another tab and never reaching the
   * canvas: `applyRemoteRow` writes the shadow entry itself, and the upsert it returns can be
   * dropped on the way (a snapshot applied over it, a gesture buffering it, a remount) — after
   * which the very next diff invents a delete for an element this tab never held and issues it
   * against rows that are seconds old. That is the delete "formed before those ids existed": its
   * base is not stale, it has no base at all.
   *
   * A key leaves this map the moment a diff SEES the element in the collections. From then on the
   * canvas has genuinely held it, so a delete for it is a real user intent and is honoured. */
  const remoteOnly = new Map();      // key -> { rev, at }  (server has it, this canvas never showed it)
  /* B1341 stage 2 — key -> assembly id, learned from a group conflict. An adopted-from-conflict
   * member carries a rev but NO data, so its host cannot be read off its json the way every other
   * membership question is answered — and without this it buckets under its own id, drops out of
   * the next digest, and the very deadlock the adoption exists to break stays shut. The server
   * named the assembly in the conflict; that is the honest source, so record it rather than infer. */
  const assemblyOf = new Map();
  /* Keys whose stale delete was DROPPED and whose server row was handed back to the canvas. Until
   * the canvas actually shows the element again, the shadow holds it and the collections do not —
   * which is the exact shape the diff reads as "deleted", so without this the next reconcile would
   * re-mint the very delete we just refused. Cleared the moment the element is seen on the canvas,
   * and time-bounded so a genuine later delete is never held off for long. */
  const readopted = new Map();       // key -> at
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
  // NEW-4 — `selfUid` may be a GETTER, read at CALL time. It used to be snapshotted from
  // `activeUid()` when the engine was built, which is null until the auth session resolves — so on
  // any load where the planner mounted first this predicate answered "possibly ours" for every row
  // for the whole session, silently disabling B1116's and B1099's foreign-author gates. Fails open
  // exactly as before when there is genuinely no id to compare.
  const selfUidNow = () => { try { return typeof selfUid === "function" ? selfUid() : selfUid; } catch (_) { return null; } };
  // NEW-0 — a tombstone's actor is `deleted_by`, never `updated_by` (site_elements sets ONE of the
  // two per statement); a `foreignAuthor` that only reads `updated_by` answers "unknown" for every
  // delete row and fails open toward "possibly ours", which is the right default but must at least
  // be ASKED. Falls back to `updated_by` when the row is not a tombstone, exactly as before.
  // This engine's own instance bound to the standalone `isOwnWrite` above — the field-reading logic
  // lives there now (one definition), this is just `!isOwnWrite(row, selfUidNow())` pre-bound.
  const foreignAuthor = (row) => !isOwnWrite(row, selfUidNow());

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
      if (!r) continue;
      // ⛔ B712224 (round 3) — a tombstoned row is still a STATEMENT: the server holds this element
      // as deleted. Recording it into the never-pruned delete floor (`recordTombstone`) is what lets
      // `reconcile()`'s `!shad` branch below tell "the server has never seen this" from "the server
      // deleted this" — without it, a fresh seed (page load, reconnect, tab wake) forgets every
      // tombstone the instant it was fetched, and a canvas still holding the pre-delete element (an
      // in-flight React update, an un-clobbered heal write, a refetch fold) mints a fresh `create`.
      if (r.deleted_at) { recordTombstone(r.kind, r.id, r.rev); continue; }
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
    const phantomCreates = [];   // ⛔ B712224 (round 3) — a `create` refused because the server holds this id as a tombstone
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
          const isExplicitRestore = pend && pend.cls === "restore";
          /* ⛔ B712224 (round 3) — `!shad` means one of TWO different things: the server has NEVER
           * seen this element, or the server holds it as a TOMBSTONE and this canvas copy is stale (a
           * foreign delete's canvas removal hasn't landed — a direct-apply React lag, an un-clobbered
           * heal write, a refetch fold, or a flush-override snapshot). Round 1 fixed one staleness
           * WINDOW (a buffered mid-gesture drain); this closes the actual gap underneath all of them:
           * unless the user is EXPLICITLY restoring (a queued `restore` op), consult the never-pruned
           * delete floor before minting. `commit_elements` deliberately AUTO-RESTORES a `create` over
           * a same-kind tombstone (site_elements.sql), so ANY stale-canvas window that mints one turns
           * a completed delete into a resurrection under a brand-new, envelope-less operation — the
           * exact shape measured live (op_kind:"unknown", ~1s after the tombstone). Refuse it and hand
           * the removal back through the SAME `onRowsCanonical` channel the delete-side's `fabricated`
           * refusal already uses (an `el: null` adoption means "remove", not "replace"). */
          if (!isExplicitRestore && !pendingResurrect.has(key) && maxDeleteRev.has(key)) {
            phantomCreates.push({ kind, id: el.id });
            continue;
          }
          if (!pend || (pend.cls !== "create" && pend.cls !== "restore") || stableStringify(pend.el) !== stableStringify(elc)) {
            if (!(isExplicitRestore && stableStringify(pend.el) === stableStringify(elc)))
              enqueue(key, { kind, id: el.id, cls: isExplicitRestore ? "restore" : "create", el: elc, z: elc.z, direct: directTag(kind, el.id, elc), envelope: envelopeForEnqueue() });
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
            enqueue(key, { kind, id: el.id, cls: "update", el, z: el.z, direct: directTag(kind, el.id, el), envelope: envelopeForEnqueue() });
          }
        }
      }
    }
    // elements present in the shadow but no longer in any collection → delete
    const fabricated = [];   // NEW-1 — …unless the canvas never held them at all (see below)
    for (const [key, shad] of shadow) {
      if (seen.has(key)) { readopted.delete(key); remoteOnly.delete(key); continue; } // on the canvas → holds spent
      const pend = dirty.get(key);
      const inf = inflightKeys.get(key);
      if (inf && inf.cls === "delete") continue; // the delete is already on the wire
      // NEW-1 — a row we just re-adopted after refusing a stale delete is mid-flight to the canvas.
      // Re-minting the delete here is how the refusal would undo itself one tick later.
      const held = readopted.get(key);
      if (held != null) {
        if (now() - held <= recentWindowMs) continue;
        readopted.delete(key);
      }
      // NEW-1 — the element is in the shadow ONLY because a remote row put it there, and no diff
      // has ever seen it on this canvas. There is no deletion to record, only a canvas that is
      // missing something the server has: hand the row back instead of inventing a delete.
      const arrived = remoteOnly.get(key);
      if (arrived) {
        if (!pend) fabricated.push({ key, kind: shad.kind, id: shad.id, json: shad.json, stale: shad.stale, rev: arrived.rev });
        continue;
      }
      if (!pend || pend.cls !== "delete") {
        /* NEW-0 (round 7, B673 recurrence) — a delete carries no `el`, so `directTag(..., null)`
         * always fell through `isDirectEdit`'s `!el` branch to TRUE — EVERY delete, including every
         * cascaded child of a bonded assembly, was classified direct no matter what the caller's
         * predicate would have said. `recent.set(...)` is gated on `direct !== false` (below), so
         * every tombstoned child stamped its own authorship and answered `authoredRecently: true`
         * for ~15s — the exact shape of the owner's report (one delete, six banners, each reading
         * "…you just edited…" for a bonded child the user never directly touched). B846/B847 built
         * this SAME direct-vs-derived distinction for EDITS ("derived churn never claims
         * authorship") and it was never extended to deletes, because a delete has nothing for the
         * predicate to inspect. Reconstruct the pre-delete element from the shadow's last-known json
         * — the SAME bytes the predicate would see had this been an edit instead — so a delete is
         * judged by the identical rule: the caller's `isDirectEdit` (SitePlanner.jsx) already reads
         * `el.attachedTo` and the live selection/gesture stamp, so a directly-selected-and-deleted
         * building is still direct and a cascaded child swept along with it is derived, exactly as
         * its cascaded relayout WRITES already are. A `stale` shadow entry (a mixed json↔rev
         * pairing) has no trustworthy bytes to reconstruct from — fails open to `null` → direct,
         * the pre-existing behavior, never silently misjudged as derived. */
        let shadEl = null;
        if (shad.json && !shad.stale) { try { shadEl = JSON.parse(shad.json); } catch (_) { shadEl = null; } }
        enqueue(key, { kind: shad.kind, id: shad.id, cls: "delete", el: null, z: shad.z,
          direct: directTag(shad.kind, shad.id, shadEl), baseRev: shad.rev, baseAt: now(), envelope: envelopeForEnqueue() });
        sawCreateOrDelete = true;
      }
    }
    if (fabricated.length) {
      const back = [];
      for (const f of fabricated) {
        if (!f.json || f.stale) continue;                 // a mixed json↔rev pairing is not an adoption source
        try { back.push({ kind: f.kind, id: f.id, el: JSON.parse(f.json) }); } catch (_) { /* unparseable → the next row re-tries */ }
      }
      report("element-delete-fabricated", "a delete for an element this canvas never held was REFUSED", { siteId, count: fabricated.length, ids: fabricated.slice(0, 20).map((f) => f.id) });
      if (back.length && onRowsCanonical) { try { onRowsCanonical(back); } catch (_) { /* adoption is best-effort */ } }
    }
    if (rowsWin && rowsWin.length) {
      report("element-rows-canonical", "stale cached copies overruled by the server's rows on seed", { siteId, count: rowsWin.length, ids: rowsWin.slice(0, 20).map((r) => r.id) });
      if (onRowsCanonical) { try { onRowsCanonical(rowsWin); } catch (_) { /* adoption is best-effort — never break the diff */ } }
    }
    if (phantomCreates.length) {
      report("element-create-fabricated", "a create for an element the server holds as a tombstone was REFUSED", { siteId, count: phantomCreates.length, ids: phantomCreates.slice(0, 20).map((f) => f.id) });
      // `el: null` is the removal shape `onRowsCanonical`'s caller (SitePlanner.jsx) handles as a
      // canvas REMOVE, mirroring `fabricated`'s upsert-shaped adoption above — one channel, two
      // directions, so a caller that only wires the upsert case cannot silently drop a removal.
      if (onRowsCanonical) { try { onRowsCanonical(phantomCreates.map((f) => ({ kind: f.kind, id: f.id, el: null }))); } catch (_) { /* adoption is best-effort */ } }
    }
    pendingResurrect.clear(); // one-shot — consumed by (at most) this single diff pass
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
    enqueue(skey(kind, id), { kind, id, cls: "restore", el, z: el.z, direct: true, envelope: envelopeForEnqueue() }); // an explicit user action is always direct
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
      enqueue(key, { kind: "el", id: m.id, cls: "update", el: m, z: m.z, direct: false, envelope: envelopeForEnqueue() });
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
    const fresh = [...dirty.values()].map((e) => freshen(e, live));  // NEW-1 (b) — state at flush time
    // NEW-1 — never SHIP a delete that has expired. The op is set aside here and its adoption runs
    // below, after `dirty` is cleared: `onRowsCanonical` re-enters the app synchronously, and a
    // re-entrant reconcile while the queue still held this batch would send it twice.
    const expired = fresh.filter((e) => e.cls === "delete" && staleAgainstBirth(e));
    const batch = expired.length ? fresh.filter((e) => !expired.includes(e)) : fresh;
    dirty.clear();
    for (const e of expired) dropStaleDelete(e);
    if (!batch.length) { setState("idle"); return; }                 // the whole batch was expired deletes
    for (const e of batch) { inflightKeys.set(skey(e.kind, e.id), e); recordSent(e.kind, e.id, e.el); } // protected like dirty until the result lands; recentSent survives a transport failure (B757)
    inflight = true;
    setState("syncing");
    // B1117 — ask for ALL-OR-NOTHING semantics when this batch carries more than one member of a
    // single assembly. That is exactly the case the server-side rollback exists for (verified live:
    // a two-op call with one good rev and one stale one left BOTH rows untouched). A single-element
    // batch has nothing to be atomic about, so it keeps the plain 2-arg call and the blast radius
    // of the new overload stays small.
    const atomic = batchSpansAssembly(batch);
    const groups = atomic ? groupsFor(batch, live) : [];   // B1341 stage 2 — groups ride only on atomic
    // NEW-1 — the post-write assertion. Runs on EVERY settle path (ok, rejected, rolled back,
    // transport failure) via the returns below, exactly once per batch, and never throws into the
    // commit path: a detector that can take the write engine down is worse than the bug it watches.
    let asserted = false;
    const assertAssembly = (outcome) => {
      if (asserted || !afterCommit) return;
      asserted = true;
      try { afterCommit({ siteId, outcome, ops: batch.length, ids: batch.map((e) => e.id), atomic }); } catch (_) { /* never break the commit path */ }
    };
    serialize(siteId, async () => {
      const ops = batch.map(opFor);
      let res;
      try { res = await commit(ops, groups.length ? { atomic, groups } : { atomic }); }
      finally {
        inflight = false;
        for (const e of batch) inflightKeys.delete(skey(e.kind, e.id));
        // NEW-1 — fires even when the transport THREW (the assertion must not be reachable only on
        // the happy path); the settle handlers below re-call it and the once-latch keeps it to one.
        if (!res) assertAssembly("threw");
      }
      try {
      // B1120 — LOUD when our own atomicity request does not reach the wire. `sentAtomic` is what
      // the transport actually sent; `atomic` is what we asked for. A silent mismatch is how a
      // 12-op single-assembly batch went out un-atomically in production for a whole release while
      // every unit test stayed green — the adapter had a fixed arity and dropped the option. The
      // ONE legitimate mismatch is the latched PGRST202 fallback on a project without the
      // migration, which reports itself separately; anything else is a wiring bug and says so.
      // `!== true` on purpose, not `=== false`: a FIXED-ARITY adapter never forwards the option at
      // all, so the transport never learns we asked and cannot report on it — `sentAtomic` comes
      // back UNDEFINED. That is precisely the shape of the shipped bug, so silence must not be read
      // as success. Only an explicit `true` counts as "it went out atomically".
      if (atomic && res && res.sentAtomic !== true && !res.fellBack) {
        report("element-atomic-request-lost", "an assembly batch asked for atomic and went out WITHOUT it", { siteId, ops: batch.length, ids: batch.slice(0, 20).map((e) => e.id) });
        onEvent({ type: "atomic-request-lost", ops: batch.length, ids: batch.map((e) => e.id) });
      }
      if (!res || !res.ok) return onTransportFailure(batch, res);
      attempt = 0;
      // B1341 stage 2 — the server refused the call OUTRIGHT: a named assembly moved underneath
      // this batch and NOTHING was written. This is the case B1117's rollback could not see, because
      // every op in the batch may hold a perfectly valid per-row rev.
      if (Array.isArray(res.groupConflict) && res.groupConflict.length) return onGroupConflict(batch, res.groupConflict);
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
      } finally {
        assertAssembly(!res || !res.ok ? "transport-failed" : res.applied === false ? "rolled-back" : "settled");
      }
    });
  }

  /* B1341 stage 2 — the GROUP REVISIONS this batch is betting on.
   *
   * For every assembly the batch touches, the digest of what THIS TAB believes its live members
   * are, built from the shadow — which is the only honest source, because the shadow IS "the rows
   * as I last saw them". The server recomputes the same string from its own rows and refuses the
   * whole call if they differ.
   *
   * ⛔ It must include EVERY live member of the assembly, not just the ones being written. A digest
   * over the written subset would answer "did the rows I am touching move", which is what the
   * per-row rev guard already answers; the question stage 2 exists to ask is "did the ASSEMBLY
   * move" — and the tear this whole family is made of is precisely a SIBLING moving underneath you.
   *
   * Returns [] when the switch is off, when nothing in the batch is bonded, or when the engine has
   * no `liveCollections` to resolve roots with — in each case the call goes out exactly as it does
   * today (B1117 semantics, untouched). */
  /* ⛔ NEW-1 — WHICH ASSEMBLY THE *SERVER* BELIEVES THIS ROW IS IN, which is not always the one the
   * canvas shows. The membership half of a group bet must be answered from here and never from the
   * live canvas; see `groupsFor` below for what that cost. */
  /* ⛔ NEW-1 — "I DO NOT KNOW WHICH ASSEMBLY THIS ROW IS IN" IS A REAL ANSWER, AND BETTING ANYWAY
   * IS THE DEADLOCK. A `stale` shadow entry is one whose json and rev deliberately disagree — the
   * rev came from the server, the json is the last bytes THIS TAB committed — and the bond is read
   * out of the json. On such an entry, with no server statement (`assemblyOf`) to override it, the
   * bond is a GUESS: the row the server handed back may already contradict it. A group bet built on
   * a guess can be refused forever, because the assembly the client claims membership of is not the
   * one the server has the row in, and a conflict on an assembly the server considers EMPTY names
   * no member to learn from.
   *
   * ⛔ ITS RARITY IS THE POINT, NOT A REASON TO DROP IT: this variant appeared on ONE of twenty
   * ordinary hours (seed 14), which is why that exact seed is pinned in `test/sessionGroupCas.test.js`
   * alongside the unit test below. A one-seed gate would have shipped it unguarded.
   *
   * Group CAS is an ADDITIONAL guard over the per-row rev check, so withdrawing a claim we cannot
   * substantiate degrades that group to the per-row path — never to a hole. */
  const UNKNOWN_ROOT = Symbol("unknown-assembly");

  function shadowRootOf(key, shad) {
    /* ⛔ THE SERVER'S OWN STATEMENT WINS. `assemblyOf` is set only from a conflict payload — the
     * server enumerating an assembly — and is DELETED the moment anything fresher lands (our own
     * accepted commit, or a remote row), so preferring it can never mask a newer fact. It used to
     * be consulted only when the json produced no bond, which meant a stale-but-current-rev shadow
     * kept its wrong assembly forever; see the note in `onGroupConflict`. */
    if (assemblyOf.has(key)) return assemblyOf.get(key);
    if (shad.stale) return UNKNOWN_ROOT;      // json↔rev disagree and the server has said nothing
    let root = null;
    try { root = rootIdOf(JSON.parse(shad.json || "null"), shad.id); } catch (_) { root = shad.id; }
    if (root == null) root = shad.id;
    return root;
  }

  function groupsFor(batch, live) {
    if (!groupCas || !groupCas()) return [];
    /* WHICH assemblies to stake a revision on. Both ends of a RE-BOND, deliberately: moving a child
     * from one host to another changes the membership of the assembly it LEFT as well as the one it
     * JOINED, and the batch's canvas roots name only the second. Betting on the source too is what
     * makes an indent/outdent as safe as a drag. */
    const roots = new Set();
    const unsafe = new Set();
    for (const e of batch) {
      if (e.kind !== "el") continue;
      const cur = (live && live.byKey.get(skey("el", e.id))) || e.el;
      const r = rootIdOf(cur, e.id);
      if (r != null) roots.add(r);
      const shad = shadow.get(skey("el", e.id));
      const was = shad ? shadowRootOf(skey("el", e.id), shad) : null;
      if (was === UNKNOWN_ROOT) {
        // We cannot say where the server has this row, so neither the assembly it is JOINING nor
        // the singleton it may still be sitting in can be claimed. Both are withdrawn below.
        unsafe.add(r); unsafe.add(e.id);
      } else if (was != null) roots.add(was);
    }
    for (const u of unsafe) roots.delete(u);
    if (!roots.size) return [];
    /* ⛔ NEW-1 — MEMBERSHIP COMES OFF THE SHADOW, NEVER OFF THE CANVAS, AND THAT IS THE WHOLE BET.
     *
     * `expected` is a claim about what the SERVER currently holds: "refuse me if this assembly is
     * not still exactly this." The canvas holds the state we are trying to CREATE. Those agree for
     * a move, a resize or a delete — none of them change `attachedTo` — and they disagree for
     * exactly one ordinary edit: re-bonding a child to a different host (the indent/outdent
     * gesture). This used to read `live.byKey`, so a pending re-bond put the mover in its
     * DESTINATION assembly's expected digest while the server's `assembly_id` — generated from
     * `data->>'attachedTo'` — still had it in the source. Two digests wrong in opposite directions,
     * the call refused whole, nothing written, and the retry re-derived the identical wrong claim
     * from the same unchanged canvas: a PERMANENT refusal, on a plain edit, with no way out.
     *
     * Measured, on the clean build, the first hour that included a re-bond: 383 refusals, 865 of
     * them spurious, 50 of 433 calls applied. It is the THIRD distinct cause of one symptom in this
     * feature — after B447472 (membership by KIND) and B484336 (ORDERING) — which is the argument
     * for the driver rather than for another reading of the code.
     *
     * The shadow holds only live rows (a delete removes its entry), matching the server's
     * `deleted_at is null` filter — the two definitions of "member" must not drift. An element the
     * server has never seen has no shadow entry and correctly counts toward nothing. */
    const members = new Map();
    for (const [key, shad] of shadow) {
      if (shad.kind !== "el") continue;
      const root = shadowRootOf(key, shad);
      if (root === UNKNOWN_ROOT || root == null || !roots.has(root)) continue;
      let list = members.get(root);
      if (!list) { list = []; members.set(root, list); }
      list.push({ id: shad.id, rev: shad.rev });
    }
    const out = [];
    for (const root of roots) out.push({ assembly: root, expected: assemblyDigest(members.get(root) || []) });
    return out;
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

  /* B1341 stage 2 — a call refused on the GROUP revision. Nothing was written, so — exactly as in
   * `onAtomicRollback` — no shadow json may advance; only the REVS the conflict rows carry are
   * adopted, so the retry is built against the assembly as it actually is. The difference from the
   * rollback path is that the conflict names MEMBERS THIS BATCH NEVER TOUCHED, which is the whole
   * point: those are the siblings that moved, and adopting their revs is what makes the next attempt
   * agree with the server instead of losing the same race again. */
  function onGroupConflict(batch, conflicts) {
    for (const c of conflicts || []) {
      for (const m of (c && c.members) || []) {
        if (!m || m.id == null || typeof m.rev !== "number") continue;
        const key = skey(m.kind || "el", m.id);
        /* ⛔ NEW-1 — ADOPT THE ASSEMBLY FOR *EVERY* MEMBER THE CONFLICT NAMES, NOT ONLY THE ONES
         * THIS TAB HAS NEVER SEEN. The unknown-member case below was the deadlock found by asking
         * "how could turning this on go wrong?"; this is its sibling, found by driving an ordinary
         * hour, and it is the one that actually fires.
         *
         * The shadow's json is the last bytes THIS TAB wrote, and its rev can be advanced past that
         * json by the monotonic guard in `processResults` (a foreign row landing while our op was in
         * flight). So a tab can hold a CURRENT rev alongside a STALE bond — and the bond is the only
         * input to which assembly a row belongs. Measured on the clean build: the client bucketed
         * `e107` under itself while the server had it under `e2e-bldg-1`, at the same rev 5, and the
         * refusal could not teach it otherwise because this branch kept the stale json AND said
         * nothing about the assembly. Every retry re-derived the same wrong membership: permanent.
         *
         * The payload is authoritative about membership — the server just enumerated the assembly —
         * so record it. `assemblyOf` is cleared the moment anything FRESHER arrives (a successful
         * commit of our own, or a remote row), so this can never outlive the fact it describes. */
        if (c.assembly != null) assemblyOf.set(key, c.assembly);
        const cur = shadow.get(key);
        // Keep OUR json as the diff baseline (the canvas still holds it and we still intend to
        // write it); adopt only the rev, flagged `stale` because json and rev now disagree.
        if (cur) { shadow.set(key, { ...cur, rev: m.rev, stale: true }); continue; }
        /* ⛔ A MEMBER WE HAVE NEVER HEARD OF, and without this the guard DEADLOCKS.
         *
         * The server's digest covers every live row of the assembly; ours covers every row in the
         * shadow. If another writer CREATED a member and this tab's realtime has not delivered it
         * yet, the two can never agree — our digest omits it, every retry recomputes the same
         * omission, and after `maxRejectStreak` the tab declares itself stale and stops saving.
         * Loud and recoverable (a reload fixes it), but it is a stuck state reachable by exactly
         * the two-writer case this feature exists for, which is the worst possible place for one.
         *
         * The conflict payload carries what is needed to converge: id, kind and rev. Adopt it as a
         * shadow entry with NO json — a mixed json↔rev pairing, which is already a representable,
         * handled state (`stale` keeps `reconcileSeedRows` from substituting it into a re-seed).
         * The next digest then includes the member at the right rev and the retry can succeed, with
         * no refetch and no extra round trip.
         *
         * ⛔ AND IT MUST BE MARKED `remoteOnly`, or B377888 fires on our own repair: the shadow now
         * holds an element the CANVAS has never shown, which is precisely the shape `reconcile`
         * reads as "the user deleted this". Same fact, same guard — the row is the server's, and
         * this tab has no deletion to express. */
        shadow.set(key, { kind: m.kind || "el", id: m.id, json: "", rev: m.rev, z: 0, stale: true });
        if (!remoteOnly.has(key)) remoteOnly.set(key, { rev: m.rev, at: now() });
        if (c.assembly != null) assemblyOf.set(key, c.assembly);   // the only record of where it belongs
        report("element-group-member-unknown", "the conflict named a member this tab has never seen — adopted so the retry can converge",
          { siteId, id: m.id, kind: m.kind || "el", rev: m.rev });
      }
    }
    for (const e of batch) { const key = skey(e.kind, e.id); if (!dirty.has(key)) enqueue(key, e); }
    splitStreak += 1;
    report("element-group-conflict", "the assembly moved underneath this batch — nothing written, re-committing at fresh revs",
      { siteId, ops: batch.length, streak: splitStreak, assemblies: conflicts.map((c) => c && c.assembly).filter(Boolean).slice(0, 10) });
    onEvent({ type: "assembly-split", ids: batch.map((e) => e.id), streak: splitStreak, rolledBack: true, groupConflict: true });
    if (splitStreak >= maxRejectStreak) {
      setState("stale");
      report("element-group-unresolved", "an assembly would not commit whole against its group revision", { siteId, streak: splitStreak });
      onEvent({ type: "client-stale", streak: splitStreak, pending: dirty.size, reason: "group-conflict" });
      return;
    }
    const wait = backoff[Math.min(splitStreak - 1, backoff.length - 1)];
    if (backoffHandle != null) clearTimer(backoffHandle);
    setState("retrying");
    backoffHandle = setTimer(() => { backoffHandle = null; flush(); }, wait);
  }

  // B1117 — an atomic call the server rolled back. NOTHING was written, so no shadow json may be
  // advanced; only the REVS are adopted (from the conflict rows) so the retry targets the current
  // rows instead of repeating the same stale expectation. The whole batch is re-queued.
  function onAtomicRollback(batch, results) {
    const byKey = pairResults(batch, results);
    for (const e of batch) {
      const key = skey(e.kind, e.id);
      const row = (byKey.get(key) || {}).row;
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

  /* NEW-1 — is this delete op a decision about a row that did not exist when it was formed?
   *
   * Two independent readings, either of which is enough, because they fail in different
   * directions and a guard against losing user data should not depend on only one of them:
   *   • BY REV — the element was seen to come into existence at a rev ABOVE the one this delete
   *     targets. Revs are server-assigned and monotonic per element, so a birth above our base is
   *     unambiguously a later incarnation.
   *   • BY CLOCK — the element was seen to come into existence AFTER the delete was formed. This
   *     is the one that catches the case where the deleting tab never held a shadow entry at all
   *     (`revOf` then answers the default 1, which no birth can be "above").
   * A delete with no recorded birth is untouched: it behaves exactly as it did before this guard,
   * so every pre-existing delete-vs-edit guarantee is unchanged. */
  /* NEW-1 — the SEND-side half of the delete-vs-create guard, and it is not redundant with the
   * conflict-result half below.
   *
   * `opFor` sends a delete at the shadow's CURRENT rev, not at the rev the delete was formed
   * against — so a delete whose shadow was advanced in the meantime (by `applyRemoteRow`'s pending
   * branch, which adopts a foreign rev while an op is queued) does not lose its rev guard at all:
   * it goes out expecting exactly the rev the creating tab just wrote, and the server ACCEPTS it.
   * That path never reaches a conflict branch and would delete the new row in silence. So the
   * question "is this decision still about the row that exists?" is asked before the op is built,
   * as well as after a refusal. */
  function dropStaleDelete(e) {
    const key = skey(e.kind, e.id);
    const shad = shadow.get(key);
    births.delete(key);
    if (shad && shad.json && !shad.stale) {
      readopted.set(key, now());
      try {
        const el = JSON.parse(shad.json);
        if (onRowsCanonical) onRowsCanonical([{ kind: e.kind, id: e.id, el }]);
      } catch (_) { /* unparseable → leave it to the next realtime row / refetch */ }
    }
    report("element-delete-vs-create-dropped", "a delete formed before the row existed was DROPPED before it was sent", { siteId, id: e.id, kind: e.kind, baseRev: e.baseRev, shadowRev: shad ? shad.rev : null });
    onEvent({ type: "delete-vs-create-dropped", id: e.id, kind: e.kind, remote: shad ? { rev: shad.rev } : {}, authoredRecently: isRecent(e.kind, e.id) });
    return true;
  }

  function staleAgainstBirth(e) {
    const key = skey(e.kind, e.id);
    // The canvas never held it → there was no deletion to express (see `remoteOnly`).
    if (remoteOnly.has(key)) return true;
    const born = births.get(key);
    if (!born) return false;
    if (typeof e.baseRev === "number" && born.rev > e.baseRev) return true;
    return typeof e.baseAt === "number" && born.at > e.baseAt;
  }

  // NEW-2 (B712225) — the envelope rides on the wire op as four plain top-level keys, read by the
  // `commit_elements` RPC and written onto the row alongside data/rev (db/commit_elements_op_envelope.sql).
  // An entry enqueued with no tracker wired carries `envelope: null`, so `env` is `{}` and the op is
  // byte-for-byte its pre-NEW-2 shape — no behavior change for a caller that never opts in.
  const envelopeStamp = (e) => {
    const v = e && e.envelope;
    if (!v || typeof v !== "object") return {};
    return { op_id: v.op_id ?? null, op_kind: v.op_kind ?? null, actor_session_id: v.actor_session_id ?? null, client_ts: v.client_ts ?? null };
  };
  function opFor(e) {
    const env = envelopeStamp(e);
    if (e.cls === "create") return { op: "create", id: e.id, kind: e.kind, z: e.z, data: e.el, ...env };
    if (e.cls === "delete") return { op: "delete", id: e.id, kind: e.kind, expected: revOf(e), ...env };
    if (e.cls === "restore") return { op: "restore", id: e.id, kind: e.kind, z: e.z, data: e.el, ...env };
    return { op: "update", id: e.id, kind: e.kind, z: e.z, expected: revOf(e), data: e.el, ...env };
  }
  const revOf = (e) => { const s = shadow.get(skey(e.kind, e.id)); return s ? s.rev : 1; };

  // NEW-1 — pair each op with ITS OWN result (see `pairCommitResults` above: one id can name two
  // live rows, and the results carry no kind). Both settle paths go through this and nothing else.
  const pairResults = (batch, results) => pairCommitResults(batch, results, (n) =>
    report("element-results-unaligned", "the commit response did not pair one result per op — matched by id instead",
      { siteId, ops: batch.length, results: n }));

  // Apply the RPC's per-op results back onto the shadow + emit conflict events.
  // Returns TRUE if at least one op was ACCEPTED (NEW-3 — a batch with none is a stale client).
  function processResults(batch, results) {
    let accepted = false;
    const acceptedKeys = new Set();   // NEW-1 (round 4) — which ops the server actually took…
    const refusedKeys = new Map();    // …and which it refused (key -> entry), for the split check
    const byKey = pairResults(batch, results);
    for (const e of batch) {
      const key = skey(e.kind, e.id);
      const r = byKey.get(key) || {};
      if (r.status === "ok") {
        accepted = true;
        acceptedKeys.add(key);
        if (e.cls === "delete") { shadow.delete(key); births.delete(key); assemblyOf.delete(key); recordTombstone(e.kind, e.id, r.rev); } // remember the delete's rev → a stale pre-delete self-echo can't resurrect it (B757)
        else {
          // keep the shadow rev MONOTONIC: a foreign realtime row may have advanced it past this
          // commit's rev while the op was in flight (applyRemoteRow's in-flight branch) — adopting
          // the older r.rev back would make the next commit a guaranteed spurious conflict.
          const cur = shadow.get(key);
          shadow.set(key, { kind: e.kind, id: e.id, json: stableStringify(e.el), rev: cur && cur.rev > r.rev ? cur.rev : r.rev, z: e.z });
          // NEW-1 — our own accepted bytes are now the freshest statement about this row's bond, so
          // any assembly the server named in an earlier conflict is superseded. Never let a stale
          // `assemblyOf` outlive the json it was standing in for.
          assemblyOf.delete(key);
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
        } else if (e.cls === "delete" && staleAgainstBirth(e)) {
          /* NEW-1 — DELETE-vs-CREATE. The row this delete lost its rev guard to was CREATED after
           * the delete was formed, so re-issuing it would kill an element the delete was never
           * about. That is not the "delete wins" case below it — it is a decision that has expired.
           * Drop the op, adopt the server's row as canonical, and hand it back to the canvas (the
           * deleting tab does not have it, having removed it locally), then say so out loud. */
          shadow.set(key, { kind: e.kind, id: e.id, json: row.data ? stableStringify(row.data) : "", rev: row.rev, z: row.z_index });
          dirty.delete(key);
          clearDeleteFloor(key);
          births.delete(key);                        // this incarnation is settled; a later delete of it is legitimate
          if (row.data) {
            readopted.set(key, now());
            if (onRowsCanonical) { try { onRowsCanonical([{ kind: e.kind, id: e.id, el: row.data }]); } catch (_) { /* adoption is best-effort */ } }
          }
          report("element-delete-vs-create-dropped", "a delete formed before the row existed was DROPPED, not re-issued", { siteId, id: e.id, kind: e.kind, baseRev: e.baseRev, rowRev: row.rev });
          onEvent({ type: "delete-vs-create-dropped", id: e.id, kind: e.kind, remote: row, authoredRecently: isRecent(e.kind, e.id) });
        } else if (e.cls === "delete") {
          // delete-vs-edit: delete WINS — re-issue at the fresh rev (per the B673 matrix).
          // `stale`: the kept json predates the adopted rev — reconcileSeedRows must not
          // substitute this mixed json↔rev pairing into a refetch re-seed (NEW-1 hardening).
          shadow.set(key, { kind: e.kind, id: e.id, json: shadow.get(key)?.json || "", rev: row.rev, z: e.z, stale: true });
          enqueue(key, { kind: e.kind, id: e.id, cls: "delete", el: null, z: e.z, direct: e.direct, baseRev: row.rev, baseAt: e.baseAt });
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
          // NEW-0 — a DERIVED op (e.direct === false) racing a row this SAME account wrote is not
          // news: it is this account's own cascade catching up with itself (an undo racing its own
          // bonded children is the canonical case — see the `foreignAuthor` branch just above). Only
          // a DIRECT edit (something the user actually did) or a genuinely foreign writer earns a
          // toast; the LWW re-commit above still happens either way — this only silences the notice.
          if (e.direct !== false || foreignAuthor(row))
            onEvent({ type: "edit-vs-edit-lost-race", id: e.id, kind: e.kind, remote: row, authoredRecently: isRecent(e.kind, e.id) });
        }
      } else if (r.status === "deleted") {
        // edit-vs-deleted: someone tombstoned it. Do NOT auto-restore — B673 offers a Restore action.
        shadow.delete(key);
        recordTombstone(e.kind, e.id, (r.row && r.row.rev) || 0); // ceiling so a stale echo can't resurrect (B757)
        report("element-edit-vs-deleted", "edit hit a tombstone", { siteId, id: e.id, kind: e.kind });
        // NEW-0 — same carve-out as edit-vs-edit-lost-race above: a DERIVED write (this account's own
        // cascade re-fit) hitting a tombstone this SAME account just wrote is routine propagation, not
        // a conflict — most often this account's own delete, landing on a bonded child whose relayout
        // was already in flight. A DIRECT edit, or a tombstone genuinely authored elsewhere, still tells.
        if (e.direct !== false || foreignAuthor(r.row || {}))
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
  // NEW-1 — the unload path is a send path too, and an expired delete must not ride out on it
  // (the keepalive has no result handler at all, so a delete that lands here is unobservable).
  function pendingOps() { return [...dirty.values()].filter((e) => !(e.cls === "delete" && staleAgainstBirth(e))).map(opFor); }
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
    /* NEW-1 — a NEWER row is the freshest statement there is about which assembly this element is
     * in, so record it here, before any of the branches below decide whether to keep our json.
     * Several of them deliberately do keep it (an in-flight op, a foreign row we are overtaking),
     * and that is exactly how a shadow ends up holding a current rev beside a stale bond — which
     * group CAS then bets on. A tombstone drops the record with the membership it described. */
    if (row.deleted_at) assemblyOf.delete(key);
    else if (row.data) { const r = rootIdOf(row.data, row.id); if (r != null) assemblyOf.set(key, r); }
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
    /* NEW-1 — a LIVE row for a key the shadow has never held is this tab watching the element come
     * into existence. That observation is the only honest "created at" a client can have here (the
     * table stores none, and the RPC returns none), and it is what lets a delete formed before this
     * moment be recognised as a decision about a row that no longer exists. It is recorded BEFORE
     * the pending branch below on purpose: the case that matters most is precisely the one where a
     * delete for this key is already queued. See `births` / `staleAgainstBirth`. */
    if (!shad && !row.deleted_at && row.data) noteBirth(row.kind, row.id, rev);
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
      // NEW-1 — `foreignAuthor(row)` is the SAME correction B1116 made to this rule's twin in
      // `processResults` (the commit-result half), and it was never applied here, to the realtime
      // READ half. The asymmetry is a real tear vector: EVERY bonded child op is derived by
      // construction (`isDirectEdit` returns false for anything `attachedTo` something the gesture
      // did not target), so on an undo of a host move this branch could drop the undo's child ops
      // and upsert the row that is being undone — one tab standing down against its OWN earlier
      // write, which is exactly the "host's revert landed, the children's did not" shape. Yielding
      // to ANOTHER writer's deliberate row is still right and is unchanged; yielding to yourself
      // never is. Fails open like `foreignAuthor` everywhere else (no selfUid / no `updated_by` →
      // treated as possibly ours → local keeps the canvas, as before this change).
      if (!sameData && !semEq && rowJson != null && !pendDirect && foreignAuthor(row)) {
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
        // NEW-0 — the yield branch above already absorbed "derived pending, foreign row" in silence.
        // What lands here is either (a) a DIRECT edit is pending on THIS tab right now — a genuine
        // "something you're doing just got overwritten", worth telling regardless of who wrote the
        // other side — or (b) a derived pending op raced a row this SAME account wrote (routine
        // propagation: this account's other tab catching up with itself). Toast only for (a) or a
        // positively foreign writer; (b) is silent.
        if (pendDirect || foreignAuthor(row))
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
      // ⛔ B712224 (round 3) — a FOREIGN tombstone must leave the SAME durable floor a local delete
      // does. `shadow.delete(key)` below removes the key's rev CEILING but records nothing, so
      // `reconcile()`'s `!shad` branch could not tell "the server never saw this" from "the server
      // just deleted this" for anything deleted by another tab/session — the exact gap that let a
      // stale canvas re-mint a `create` over a row this account's OTHER tab had just tombstoned.
      recordTombstone(row.kind, row.id, rev);
      shadow.delete(key);
      // NEW-0 — this tab has no pending op on this element, so there is no "your current work" to
      // protect; the only question left is who deleted it. A tombstone this SAME account wrote (this
      // account's other tab, or this tab's own delete arriving from a source `applyRemoteRow` didn't
      // already recognize as its own echo) is routine propagation and must be silent — reserve the
      // notice for a genuinely different account.
      if (!ownDeleteEcho && foreignAuthor(row))
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
    // NEW-0 — the missing gate. This tab has no pending op on this element (the `pend` branch above
    // already returned), so `authoredRecently` here means only "I touched this within the last 15s",
    // never "I am doing something right now." A fresh row for it from THIS SAME ACCOUNT — this
    // account's other tab, most commonly this account's own cascade delete propagating and landing
    // back as an update on a bonded sibling — is exactly the reported false alarm ("a building you
    // just edited changed in another tab of yours" ×6, for a delete nobody but this account made) and
    // must be silent. Its sibling emit above (the `pend`/yield branch, ~1418) was already gated on
    // `foreignAuthor(row)`; this one was not, which is the whole bug. `sent`/`semEqShadow` above only
    // catch THIS TAB'S own echo — `foreignAuthor` is what extends that to the whole account.
    if (!sent && !semEqShadow && foreignAuthor(row))
      onEvent({ type: "remote-upsert", id: row.id, kind: row.kind, remote: row, existed: !!shad, authoredRecently: isRecent(row.kind, row.id) });
    // NEW-1 — the shadow has adopted this row; whether the CANVAS does is out of our hands from
    // here. Until a diff proves it did, a delete minted from the difference is fabricated.
    if (!remoteOnly.has(key)) remoteOnly.set(key, { rev, at: now() });
    return { action: "upsert", kind: row.kind, id: row.id, el: row.data, row };
  }

  function stop() {
    stopped = true;
    clearDebounce();
    if (backoffHandle != null) { clearTimer(backoffHandle); backoffHandle = null; }
  }

  return {
    reconcile, flushGesture, retryNow, seed, stop, restore, noteLocalAuthority, allowResurrect,
    pendingOps, pendingCount, dirtyEntries, applyRemoteRow,
    isSeeded: () => ready,
    // introspection for tests / B672-B673
    shadowSnapshot, tombstonedSnapshot, isRecent,
    get state() { return state; },
    get recent() { return recent; },
  };
}
