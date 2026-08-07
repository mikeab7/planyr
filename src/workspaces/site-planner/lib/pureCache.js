/* pureCache — the two shapes of "do not answer the same question twice" this codebase needs.
 *
 * WHY (NEW-2, 2026-08-06, VIEW-INDEPENDENT-ONCE). The detector
 * (`ui-audit/detect-view-recompute.mjs`) enumerated every computation that runs more than once
 * during a gesture that changes only the view. Most of them are React memo boundaries and are
 * fixed with a `useMemo` keyed on model + settings. But a second family is not reachable that way:
 * PURE LIBRARY LEAVES called per-element from inside a render pass — the road tessellator, the
 * polyline buffer, the canvas text measurer. They have no hook to hang a memo on, they are called
 * from several places, and their answer is a function of their arguments and nothing else.
 *
 * Two caches, because there are two honest ways to key one:
 *
 *   `boundedCache`  — keyed on a STRING SIGNATURE the caller builds. Use when the inputs are
 *                     small and structural (a road's control points and its radius settings) and
 *                     building the signature is much cheaper than the work. Bounded: at the cap it
 *                     CLEARS rather than evicting one entry, because exact-LRU bookkeeping on a
 *                     hot leaf can cost more than the call it is saving, and the price of a clear
 *                     is one recomputation, never a wrong answer.
 *
 *   `identityCache` — keyed on an OBJECT'S IDENTITY (a `WeakMap`) plus a small string. Use when
 *                     the input is a large array that is REBUILT rather than mutated — the dense
 *                     centerline the buffer is taken of. Costs nothing to key and holds nothing
 *                     alive: when the array is collected, so is its entry.
 *
 * ⛔ THE PRECONDITION FOR `identityCache`, stated because getting it wrong is a silent wrong
 * answer rather than a slow one: the keyed object must be treated as IMMUTABLE. Every caller in
 * this repo either builds a fresh array (the tessellators) or replaces model arrays wholesale
 * (the planner's state updates are immutable), so mutating one in place would already be a bug
 * elsewhere — but a future caller that mutates its input and expects a fresh answer will get the
 * old one. Prefer `boundedCache` when that is in any doubt.
 *
 * Pure and dependency-free, so both are unit-tested (test/pureCache.test.js).
 */

export function boundedCache(max = 64) {
  const m = new Map();
  return {
    get: (k) => m.get(k),
    has: (k) => m.has(k),
    set: (k, v) => { if (m.size >= max) m.clear(); m.set(k, v); return v; },
    get size() { return m.size; },
    clear: () => m.clear(),
  };
}

export function identityCache() {
  const wm = new WeakMap();
  return {
    get(obj, k) {
      if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return undefined;
      return wm.get(obj)?.get(k);
    },
    set(obj, k, v) {
      if (!obj || (typeof obj !== "object" && typeof obj !== "function")) return v;
      let inner = wm.get(obj);
      if (!inner) { inner = new Map(); wm.set(obj, inner); }
      // One object rarely carries many variants (a centerline is buffered at two or three
      // widths); a small cap keeps a pathological caller from growing an entry without limit.
      if (inner.size >= 16) inner.clear();
      inner.set(k, v);
      return v;
    },
  };
}

/** A stable, cheap signature for a list of {x,y} points. Rounded to a ten-thousandth of a foot —
 *  four orders finer than anything the app draws, so it can never merge two different alignments,
 *  and short enough that the key costs a fraction of the geometry it stands for. */
export function pointsSignature(pts) {
  if (!Array.isArray(pts)) return "-";
  let s = `${pts.length}`;
  for (const p of pts) s += p ? `|${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}` : "|-";
  return s;
}
