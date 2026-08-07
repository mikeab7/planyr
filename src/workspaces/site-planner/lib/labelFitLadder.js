// NEW-1 / NEW-2 — the ONE ordered fit/fallback ladder for a map label that must sit inside a shape.
//
// WHY THIS MODULE EXISTS
// ---------------------
// The Goose Creek plan showed two different label failures on two ponds at once: the southern
// pond had NO label, the northern pond's label floated OUTSIDE its outline. They came from two
// terminal branches of one ad-hoc chain buried in the collision engine — "too wide → leader it
// out" and "still colliding → hide it". Neither branch is a decision anybody made on purpose,
// and the hide branch is the defect class this repo keeps fixing: the app knowing something
// (this pond's name and size) and saying nothing.
//
// So the decision is extracted here as a named, ordered, pure ladder — the same treatment
// `pondOptimizeAffordance.js` and `pondVerdict.js` got — and every label that must live inside
// a shape consumes it:
//
//   inline   — the label as authored, one line per entry
//   stacked  — a wide "a · b" line broken onto its own lines (narrower, but TALLER)
//   abbrev   — the trailing part of a wide line dropped (e.g. keep acreage, drop square feet)
//   outside  — placed clear of the shape WITH A LEADER back to it, so ownership is unambiguous
//
// Two rules the ladder enforces that the old chain did not:
//
//  1. FIT IS MEASURED AGAINST THE ACTUAL INTERIOR, NOT THE BOUNDING BOX. Ponds are irregular;
//     a bounding box overstates the room and is why one pond passed a width test it had no
//     business passing. `interiorFitter` rasterises the ring and enumerates the maximal
//     axis-aligned rectangles genuinely inside it, so "does it fit" is answered against room
//     that exists, and the label can SLIDE within that room to dodge an obstacle.
//
//  2. A FIT FAILURE MAY NEVER BE TERMINAL. The ladder always ends in an `outside` rung, so
//     "it doesn't fit" can only ever relocate or shorten a label — never blank it. Hiding
//     stays available to the collision engine as a deliberate declutter decision, and for an
//     element marked `mustLabel` (a pond) not even then.
//
// ORIENTATION IS ASPECT-AWARE BY CONSTRUCTION. The rungs are TRIED in order but CHOSEN by
// measured fit, so a long shallow pond keeps the single wide line (stacking it would be taller
// than the shape) while a tall narrow pond takes the stack. Never prefer a rung on principle.
//
// Pure geometry — no React, no DOM — so it unit-tests without a browser and the export sheet
// reasons identically to the screen (PDF-PARITY: `layoutLabels` is the single consumer, and
// both the canvas and `exportSheet` go through it).
import { pointInRing as ringContains } from "./ringMath.js";

// The ordered vocabulary. `outside` is always reachable; there is deliberately no `hidden` rung.
export const LADDER_RUNGS = ["inline", "stacked", "abbrev", "outside"];

// ---------------------------------------------------------------------------------------------
// Label forms
// ---------------------------------------------------------------------------------------------

// A line may be a plain string (nothing to reflow) or a REFLOWABLE spec:
//   { parts: ["footprint 6.11 ac", "266,354 sf"], sep: " · ", keep: 1, stack: true }
// `parts` are the atoms, `sep` joins them on the inline rung, `keep` is how many leading parts
// survive the abbreviated rung, and `stack:false` opts a line out of the stacked rung.
const normLine = (l) =>
  typeof l === "string" || typeof l === "number"
    ? { parts: [String(l)], sep: "", keep: 1, stack: false }
    : { sep: " · ", keep: 1, stack: true, ...l, parts: (l.parts || []).map(String).filter(Boolean) };

// The label as authored, one string per entry — for callers that need plain text before the
// ladder runs (label rotation, world-scaled font sizing). Never let a reflow spec reach a
// `.length` on a string; route it through here.
export const inlineLines = (lines) => (labelForms(lines)[0] || { lines: [] }).lines;

// Ordered display forms for one priority-ordered line list. Always ≥1 form, always ≥1 line —
// there is no form that renders nothing.
export function labelForms(lines) {
  const specs = (lines || []).filter((l) => l != null && l !== "").map(normLine).filter((s) => s.parts.length);
  if (!specs.length) return [];
  const join = (s, parts) => parts.join(s.sep);
  const forms = [{ rung: "inline", lines: specs.map((s) => join(s, s.parts)) }];
  const reflowable = specs.some((s) => s.parts.length > 1);
  if (reflowable) {
    const stacked = [];
    for (const s of specs) {
      if (s.stack && s.parts.length > 1) stacked.push(...s.parts);
      else stacked.push(join(s, s.parts));
    }
    forms.push({ rung: "stacked", lines: stacked });
    forms.push({
      rung: "abbrev",
      lines: specs.map((s) => join(s, s.parts.length > 1 ? s.parts.slice(0, Math.max(1, s.keep)) : s.parts)),
    });
  }
  return forms;
}

// ---------------------------------------------------------------------------------------------
// Interior fit — largest inscribed axis-aligned rectangles of a polygon ring
// ---------------------------------------------------------------------------------------------

const RASTER_N = 96; // cells across the ring's LONG axis — the interior/bbox error this closes is
                     // tens of percent, so a coarse lattice is plenty and keeps the scan cheap.

const ringBBox = (ring) => {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of ring) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return { x0, x1, y0, y1 };
};

/* Ring-first argument order, kept because this module's callers and tests read it that way;
 * the implementation is the shared one in ringMath.js. */
export const pointInRing = (ring, pt) => ringContains(pt, ring);

// Scanline rasterisation — one row of ring crossings per cell row, so this is O(rows · vertices)
// rather than a point-in-polygon test per cell.
function rasterize(ring, b, cols, rows) {
  const cw = (b.x1 - b.x0) / cols, ch = (b.y1 - b.y0) / rows;
  const mask = new Uint8Array(cols * rows);
  const xs = [];
  for (let r = 0; r < rows; r++) {
    const y = b.y0 + (r + 0.5) * ch;
    xs.length = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i], c = ring[j];
      if ((a.y > y) !== (c.y > y)) xs.push(a.x + ((y - a.y) * (c.x - a.x)) / (c.y - a.y));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.ceil((xs[k] - b.x0) / cw - 0.5), to = Math.floor((xs[k + 1] - b.x0) / cw - 0.5);
      for (let c = Math.max(0, from), end = Math.min(cols - 1, to); c <= end; c++) mask[r * cols + c] = 1;
    }
  }
  return mask;
}

// Every maximal all-inside rectangle, via the classic largest-rectangle-in-histogram sweep.
// Emitting on each stack pop enumerates the maximal rectangles, not just the biggest one —
// which is what lets `place` answer an ASPECT question (a wide-short label vs a tall-narrow one)
// instead of only "how much area is there".
function maximalRects(mask, cols, rows) {
  const h = new Int32Array(cols);
  const out = [];
  const stack = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) h[c] = mask[r * cols + c] ? h[c] + 1 : 0;
    stack.length = 0;
    for (let c = 0; c <= cols; c++) {
      const cur = c < cols ? h[c] : 0;
      let start = c;
      while (stack.length && stack[stack.length - 1].h >= cur) {
        const top = stack.pop();
        out.push({ c0: top.c, c1: c - 1, r0: r - top.h + 1, r1: r });
        start = top.c;
      }
      if (cur > 0) stack.push({ h: cur, c: start });
    }
  }
  return out;
}

const fitterCache = new WeakMap();

/**
 * Measure a polygon ring's usable INTERIOR (ring units — planner feet).
 *
 * Returns:
 *   maxW / maxH        the widest and tallest inscribed boxes (for reporting/asserting)
 *   place(w, h)        the centre of the best inscribed w×h box, nearest the ring centroid,
 *                      or null when the ring genuinely has no room
 *   spots(w, h, n)     up to `n` distinct centres for a w×h box, nearest-first — so a caller
 *                      can SLIDE the label within the interior to dodge an obstacle instead of
 *                      giving up and leadering out. ⚠ MEMOISED per (w, h, n) — like every memo in
 *                      this tree the returned array is SHARED, so treat it as READ-ONLY.
 *   contains(pt)       exact point-in-ring
 *
 * Memoised per ring array (the mask is in ring units, so it survives pan and zoom).
 */
export function interiorFitter(ring) {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  const cached = fitterCache.get(ring);
  if (cached) return cached;

  const b = ringBBox(ring);
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  if (!(bw > 0) || !(bh > 0)) return null;
  const n = RASTER_N;
  const cols = bw >= bh ? n : Math.max(8, Math.round((bw / bh) * n));
  const rows = bh >= bw ? n : Math.max(8, Math.round((bh / bw) * n));
  const cw = bw / cols, ch = bh / rows;
  const mask = rasterize(ring, b, cols, rows);

  // Cell rectangles → ring-unit rectangles. A rect spanning cells [c0..c1] covers the cell
  // CENTRES, so its safe extent is one cell narrower than the raw span — a deliberately
  // conservative read, because a label that pokes out of the outline is the bug we are fixing.
  const rects = [];
  for (const q of maximalRects(mask, cols, rows)) {
    const w = (q.c1 - q.c0) * cw, h = (q.r1 - q.r0) * ch;
    if (!(w > 0) || !(h > 0)) continue;
    rects.push({
      w, h,
      x0: b.x0 + (q.c0 + 0.5) * cw, x1: b.x0 + (q.c1 + 0.5) * cw,
      y0: b.y0 + (q.r0 + 0.5) * ch, y1: b.y0 + (q.r1 + 0.5) * ch,
    });
  }
  rects.sort((p, q) => q.w * q.h - p.w * p.h);

  let maxW = 0, maxH = 0;
  for (const r of rects) { if (r.w > maxW) maxW = r.w; if (r.h > maxH) maxH = r.h; }

  // Ring centroid — the visual home position a label wants to sit nearest.
  let a2 = 0, gx = 0, gy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const f = p.x * q.y - q.x * p.y;
    a2 += f; gx += (p.x + q.x) * f; gy += (p.y + q.y) * f;
  }
  const home = a2 ? { x: gx / (3 * a2), y: gy / (3 * a2) } : { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };

  const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));

  /* ⛔ NEW-1 — THE ANSWER IS A FUNCTION OF (ring, w, h, want) AND OF NOTHING ELSE, SO IT IS
   * COMPUTED ONCE PER DISTINCT QUESTION RATHER THAN ONCE PER FRAME.
   *
   * `spots` is asked in FEET (`layoutLabels` divides the screen size by ppf before calling), and
   * the mask above is in feet too — which is why the header already says the fitter "survives pan
   * and zoom". The SCAN did not. Every frame of a pan re-asked the identical question: the ring is
   * unchanged, `ppf` is unchanged (a pan is a pure translation at constant scale — B1440), and the
   * label's lines and type metrics are unchanged, so `w`, `h` and `want` are bit-for-bit the same
   * numbers they were on the previous frame. Only the screen ORIGIN moved, and that is applied by
   * the caller with one multiply-add after this returns.
   *
   * What it was costing, measured (ui-audit/diagnose-pond-pan.mjs, the seeded pond-count ladder at
   * 1× CPU, dpr 2, working zoom, Yield docked): "Label layout & collision" rose 16.7 ms → 93.4 ms
   * of main-thread work per pan gesture going from 0 to 16 ponds — a 5.6× rise, and the largest
   * single mover between those two rungs. `labelFitLadder`'s own scan was the hottest application
   * function in the profile at 52.98 ms. A pond is the ONLY element type that reaches this path:
   * it is the only one `SitePlanner.jsx` hands a `ring` AND marks `mustLabel`, and the ladder tries
   * up to nine candidate forms per pond per frame, each one a fresh scan of the enumerated maximal
   * rectangles (a 96-cell raster enumerates thousands).
   *
   * ⛔ BYTE-IDENTICAL BY CONSTRUCTION, which is what lets this ship with no pixel argument at all:
   * same pure function, same arguments, same outputs, moved from "once per frame" to "once per
   * distinct question". There is no threshold, no approximation and no level-of-detail decision
   * here — this is a pure re-association of work already being done, the same justification B1352
   * shipped the neighbour record on.
   *
   * The early-out is the same claim in the other direction: no rectangle in `rects` can be wider
   * than `maxW` or taller than `maxH`, so a request past either bound was already guaranteed to
   * scan every rectangle and return nothing. Returning nothing immediately is the identical answer,
   * and it converts the WORST case (a label that fits nowhere — exactly the case the outside rung
   * exists for) from a full scan into a comparison.
   *
   * Cache lifetime is the fitter's, which is the ring's: `fitterCache` is a WeakMap keyed on the
   * ring array, so when the pond's geometry is edited a NEW array arrives, a new fitter is built,
   * and this cache goes with the old one. It can therefore never serve a stale interior — the
   * failure that would matter, because a label placed against the wrong interior is a WRONG
   * DRAWING, and a wrong drawing is worse than a slow one. Bounded anyway (LRU), because a zoom
   * sweep legitimately asks many distinct sizes of the same pond. */
  const spotsCache = new Map();
  const SPOTS_CACHE_MAX = 64;

  const spotsUncached = (w, h, want) => {
    const out = [], seen = new Set();
    if (!(w <= maxW) || !(h <= maxH)) return out; // no rectangle can hold it — same answer, no scan
    for (const r of rects) {
      if (r.w < w || r.h < h) continue;
      const lox = r.x0 + w / 2, hix = r.x1 - w / 2, loy = r.y0 + h / 2, hiy = r.y1 - h / 2;
      // The clamped-home position first, then the extremes of the allowed range — those are the
      // positions that buy the most clearance when something is parked on the home spot.
      const xs = [clamp(home.x, lox, hix), lox, hix];
      const ys = [clamp(home.y, loy, hiy), loy, hiy];
      for (const x of xs) for (const y of ys) {
        const k = `${Math.round(x / cw)},${Math.round(y / ch)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x, y, d: (x - home.x) ** 2 + (y - home.y) ** 2 });
      }
      if (out.length >= want * 6) break;
    }
    out.sort((p, q) => p.d - q.d);
    return out.slice(0, want).map(({ x, y }) => ({ x, y }));
  };

  const spots = (w, h, want = 1) => {
    /* A non-finite size is a caller bug, not a cache key — answer it directly rather than pinning
     * a NaN entry that every later NaN would then hit. */
    if (!Number.isFinite(w) || !Number.isFinite(h) || !Number.isFinite(want)) return spotsUncached(w, h, want);
    const key = `${w}|${h}|${want}`;
    if (spotsCache.has(key)) {
      const hit = spotsCache.get(key);
      spotsCache.delete(key); spotsCache.set(key, hit); // refresh recency
      return hit;
    }
    const val = spotsUncached(w, h, want);
    spotsCache.set(key, val);
    if (spotsCache.size > SPOTS_CACHE_MAX) spotsCache.delete(spotsCache.keys().next().value);
    return val;
  };

  const fitter = {
    maxW, maxH,
    place: (w, h) => spots(w, h, 1)[0] || null,
    spots,
    contains: (pt) => pointInRing(ring, pt),
  };
  fitterCache.set(ring, fitter);
  return fitter;
}
