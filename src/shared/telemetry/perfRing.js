/* Preallocated ring buffers for the always-on performance recorder (NEW-1).
 *
 * ⛔ THE ONE RULE THIS FILE EXISTS TO ENFORCE: THE RECORDER MUST NOT BECOME THE DEFECT IT IS
 * LOOKING FOR. The thing being hunted is a session that gets slower the longer it runs, and the
 * classic way to build that is an instrument that allocates a small object per frame — sixty
 * short-lived objects a second, for an hour, is a garbage-collection schedule, and a GC pause
 * shows up as exactly the jank the recorder was installed to explain. So:
 *
 *   • Every buffer is a typed array allocated ONCE at install and written BY INDEX thereafter.
 *   • Every push is a FIXED-ARITY function. No rest args (`...values` allocates an array), no
 *     options object, no destructuring of a caller-built record, no closure created per call.
 *   • Nothing here returns an object on the hot path. Reading back allocates freely — that
 *     happens at most a handful of times per page, at capture time.
 *   • Wrap is `i + 1 === cap ? 0 : i + 1`, not `% cap`: a modulo on a non-power-of-two is a
 *     division, and the capacity is a tuning number that should not have to be a power of two
 *     to stay cheap.
 *
 * `test/perfRecorder.test.js` asserts the allocation property structurally (the backing arrays
 * keep their identity across a hundred thousand pushes) rather than trusting this comment, and
 * `ui-audit/verify-perf-recorder.mjs` measures the per-frame cost in a real browser.
 */

/* ── Frames ────────────────────────────────────────────────────────────────────────────────
 * `t` is ms since the recorder started (performance.now()-based, monotonic), `dt` the delta
 * from the previous frame in the same ACTIVE run. Frames are only recorded while the user is
 * interacting (see perfRecorder.js) — an idle tab's frame deltas describe the browser's
 * throttling policy, not the app, and averaging them into a baseline is how a self-relative
 * trigger gets calibrated against nothing. */
export function createFrameRing(cap) {
  return { cap, count: 0, head: 0, t: new Float64Array(cap), dt: new Float64Array(cap) };
}

export function pushFrame(r, t, dt) {
  const i = r.head;
  r.t[i] = t;
  r.dt[i] = dt;
  r.head = i + 1 === r.cap ? 0 : i + 1;
  if (r.count < r.cap) r.count++;
}

/* ── Long animation frames / long tasks ────────────────────────────────────────────────────
 * `attr` is an index into a caller-owned string table (see internString): the platform gives
 * attribution as strings, and interning is the only way to keep the hot column numeric. These
 * fire at most a few times a second by definition (a "long" task is ≥50 ms), so this ring is
 * small. `blk` is LoAF's blockingDuration where available, 0 otherwise. */
export function createTaskRing(cap) {
  return {
    cap, count: 0, head: 0,
    t: new Float64Array(cap), dur: new Float64Array(cap), blk: new Float64Array(cap),
    attr: new Int16Array(cap),
  };
}

export function pushTask(r, t, dur, blk, attr) {
  const i = r.head;
  r.t[i] = t; r.dur[i] = dur; r.blk[i] = blk; r.attr[i] = attr;
  r.head = i + 1 === r.cap ? 0 : i + 1;
  if (r.count < r.cap) r.count++;
}

/* ── Periodic counters ─────────────────────────────────────────────────────────────────────
 * One row every couple of seconds. Fixed arity, one column per counter — deliberately NOT a
 * `{name: value}` record, for the reason at the top of the file. The column ORDER is part of
 * the wire format (perfCapture.js) and is asserted in the unit tests; append, never reorder. */
export const COUNTER_COLUMNS = [
  "heap",     // usedJSHeapSize, MB (Chromium only; NaN elsewhere)
  "dom",      // document element count
  "cv",       // planner canvas SVG node count
  "el",       // elements drawn (data-el-id)
  "ly",       // leaflet layers present
  "pn",       // panels open
  "tiles",    // retained leaflet tiles
  "ppf",      // pixels per foot — the zoom the user is working at
  "ed",       // edits since load (undo frames pushed)
  "sw",       // plan switches since load
  "act",      // seconds of ACTIVE (interacting) time so far
];

export function createCounterRing(cap) {
  const r = { cap, count: 0, head: 0, t: new Float64Array(cap), cols: [] };
  for (let i = 0; i < COUNTER_COLUMNS.length; i++) r.cols.push(new Float64Array(cap));
  return r;
}

/* `values` is a caller-owned, reused Float64Array of COUNTER_COLUMNS.length — passing the
 * scratch buffer in is what keeps this allocation-free at a call site that has eleven numbers
 * to hand over. The recorder owns exactly one such buffer for the life of the page. */
export function pushCounters(r, t, values) {
  const i = r.head;
  r.t[i] = t;
  for (let c = 0; c < r.cols.length; c++) r.cols[c][i] = values[c];
  r.head = i + 1 === r.cap ? 0 : i + 1;
  if (r.count < r.cap) r.count++;
}

/* ── Reading back (capture time only — allocation is fine here) ────────────────────────────── */

/* Physical indices, oldest → newest. */
export function ringOrder(r) {
  const out = new Array(r.count);
  const start = r.count < r.cap ? 0 : r.head;
  for (let k = 0; k < r.count; k++) out[k] = (start + k) % r.cap;
  return out;
}

/* Physical indices, oldest → newest, restricted to entries at or after `sinceT`. Because the
 * ring is written in time order this is a suffix, but it is computed by comparison rather than
 * by arithmetic so a clock that went backwards (it should not, performance.now() is monotonic)
 * degrades to "fewer rows" rather than to garbage. */
export function ringOrderSince(r, sinceT) {
  const all = ringOrder(r);
  let i = 0;
  while (i < all.length && r.t[all[i]] < sinceT) i++;
  return all.slice(i);
}

/* ── A tiny bounded string table for attribution ───────────────────────────────────────────
 * Interning allocates ONLY when a string is seen for the first time, and the table is capped:
 * a pathological page that produced a fresh script URL every frame would otherwise turn the
 * "no allocation" promise into a slow leak. Past the cap everything maps to the shared
 * "(other)" slot, which is honest and bounded. */
export const STRING_TABLE_MAX = 64;

export function createStringTable() {
  return { list: ["(unknown)", "(other)"], index: new Map([["(unknown)", 0], ["(other)", 1]]) };
}

export function internString(table, s) {
  if (!s) return 0;
  const hit = table.index.get(s);
  if (hit !== undefined) return hit;
  if (table.list.length >= STRING_TABLE_MAX) return 1;
  const id = table.list.length;
  table.list.push(s);
  table.index.set(s, id);
  return id;
}
