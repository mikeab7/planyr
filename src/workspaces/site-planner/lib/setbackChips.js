/* Setback CHIP grouping — one chip per logical RUN, not one per edge (NEW-1).
 *
 * ── why this is not `edgeRuns.js` ────────────────────────────────────────────────────────────
 * `edgeRuns` (B214, hardened by B216) partitions a boundary into logical SIDES by chaining each
 * edge to the PREVIOUS edge's bearing within ±7°. That is the right model for the EDIT surface:
 * a side is what a setback value applies to, and a genuine corner must break it. B216 explicitly
 * decided that a TIGHT curve — each segment turning beyond the tolerance — "correctly stays
 * per-segment", because each of those segments really is its own straight side.
 *
 * That decision is geometrically true and cartographically wrong, and the owner's Weld County CO
 * report (2026-07-30) is the proof: a subdivision boundary whose corner is a fillet digitized as
 * ~12 short segments produced ~12 runs at that corner, so twelve identical "25′" chips stacked
 * into an unreadable pile, and the whole 32-edge parcel carried thirty-plus. "That's way too
 * many… this is completely ridiculous."
 *
 * So the LABEL layer gets its own, coarser grouping — the one the owner specified: collapse
 * CONSECUTIVE edges that share the same setback VALUE into a single labelled run, and break that
 * run only where the boundary genuinely changes direction. `edgeRuns` is untouched, so the
 * per-side edit semantics, `setRunSetback`, `resizeRunLength` and every B214/B215/B216 test keep
 * behaving exactly as before.
 *
 * ── how a run is broken ──────────────────────────────────────────────────────────────────────
 *  (1) the setback VALUE changes (a 25′ front next to a 10′ side is never one chip); and
 *  (2) the run's DIRECTION SPREAD exceeds `turnBreakDeg` — the spread of the running SIGNED
 *      bearing change since the run started (max minus min).
 *
 * Signed-and-spread, rather than a per-edge tolerance, is what makes all four real cases right:
 *   • survey noise on a nominally straight side (±1° alternating) never accumulates → ONE run,
 *     however many segments it was digitized with;
 *   • a filleted 90° corner sweeps past the threshold once, mid-fillet → the run breaks ONCE,
 *     at the corner, so a rounded rectangle reads as four sides — "one per boundary side";
 *   • a hard 90° corner blows the spread instantly → breaks at that vertex, as it always did;
 *   • a long continuous arc (a cul-de-sac frontage, a river bend) breaks every ~turnBreakDeg of
 *     sweep, which is honest: 180° of curve is genuinely more than one side.
 *
 * The chip is anchored at the midpoint of the LONGEST edge in its run (owner's rule) — the most
 * legible spot on the run and the one with the most clear boundary either side of it — and that
 * edge's length is also the run's declutter PRIORITY, so when two chips are too close the one on
 * the longer edge survives.
 *
 * Pure + dependency-free + unit-tested. Planar feet, same {x,y} ring convention as `edgeRuns`:
 * edge i is points[i] → points[(i+1) % n].
 */

import { turnBetween } from "./screenDeclutter.js";

/* Direction spread (degrees) at which a run breaks. 50° is chosen so a filleted right-angle
 * corner breaks exactly once (the fillet's total sweep is ~90°, so the spread crosses 50°
 * roughly at its middle) while every shallower bend — a slightly-off-square lot line, a
 * chamfered corner, survey noise — stays one side. */
export const CHIP_TURN_BREAK_DEG = 50;

/* Screen-space guards (px), applied by the renderer at the current zoom, never in model space.
 *  · MIN_EDGE — a chip whose anchor edge is shorter than this on screen is not drawn at all.
 *    Below it the edge itself is a tick, so the chip labels something you cannot see.
 *  · MIN_SEP  — two drawn chips may not sit closer than this; the lower-priority one drops.
 *    Comfortably wider than the ~26px chip plate, so kept chips have real air between them. */
export const CHIP_MIN_EDGE_PX = 26;
export const CHIP_MIN_SEP_PX = 40;

/**
 * Group a parcel's edges into setback-chip runs.
 *
 * @param points   ring of {x,y} (open ring, planner feet)
 * @param sb       per-edge setback array (one value per edge; missing reads as 0)
 * @param opts     { turnBreakDeg = CHIP_TURN_BREAK_DEG, eps = 0.05 } — `eps` is the feet
 *                 tolerance for "the same setback value"
 * @returns [{ edges, value, lengthFt, anchorEdge, anchorLenFt, midF }]
 *          `edges` is the ordered chain (may wrap across the index-0 seam), `value` the shared
 *          setback, `anchorEdge` the longest edge in the run, `anchorLenFt` its length (the
 *          declutter priority) and `midF` that edge's midpoint in feet (the chip anchor).
 *          Every edge appears in exactly one run.
 */
export function setbackChipRuns(points, sb, opts = {}) {
  const n = points ? points.length : 0;
  if (n < 2) return [];
  const turnBreakDeg = opts.turnBreakDeg == null ? CHIP_TURN_BREAK_DEG : opts.turnBreakDeg;
  const eps = opts.eps == null ? 0.05 : opts.eps;
  const edgeCount = n === 2 ? 1 : n;              // a 2-point "ring" has a single real edge
  const val = (i) => (Array.isArray(sb) && Number.isFinite(sb[i]) ? sb[i] : 0);

  const bear = [];
  for (let i = 0; i < edgeCount; i++) {
    const a = points[i], b = points[(i + 1) % n];
    bear.push((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI);
  }
  // Signed turn INTO edge i (i.e. at the vertex shared with edge i-1), in (-180,180].
  const signedTurn = (i) => {
    let d = (bear[i] - bear[(i - 1 + edgeCount) % edgeCount]) % 360;
    if (d > 180) d -= 360;
    if (d <= -180) d += 360;
    return d;
  };

  // Greedy forward partition. `run` tracks the running signed heading relative to its first
  // edge, plus the min/max that heading has reached — their difference is the spread.
  const runsIdx = [];
  let cur = [0], head = 0, lo = 0, hi = 0;
  for (let i = 1; i < edgeCount; i++) {
    const h = head + signedTurn(i);
    const spread = Math.max(hi, h) - Math.min(lo, h);
    if (Math.abs(val(i) - val(cur[0])) <= eps && spread <= turnBreakDeg) {
      cur.push(i); head = h; lo = Math.min(lo, h); hi = Math.max(hi, h);
    } else {
      runsIdx.push(cur); cur = [i]; head = 0; lo = 0; hi = 0;
    }
  }
  runsIdx.push(cur);

  // Wrap-merge across the index-0 seam: the closing edge and the opening edge are physically
  // adjacent, so a run that straddles the seam (the digitizer started mid-side) must not read as
  // two. Merge only when the values agree AND the COMBINED spread still clears the threshold —
  // otherwise the seam happens to sit on a real corner and the two runs are genuinely separate.
  if (runsIdx.length >= 2) {
    const first = runsIdx[0], last = runsIdx[runsIdx.length - 1];
    if (last !== first && Math.abs(val(first[0]) - val(last[0])) <= eps) {
      const merged = [...last, ...first];
      if (spreadOf(merged, signedTurn, edgeCount) <= turnBreakDeg) { runsIdx[0] = merged; runsIdx.pop(); }
    }
  }

  return runsIdx.map((edges) => {
    let lengthFt = 0, anchorEdge = edges[0], anchorLenFt = -1;
    for (const e of edges) {
      const a = points[e], b = points[(e + 1) % n];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      lengthFt += len;
      if (len > anchorLenFt) { anchorLenFt = len; anchorEdge = e; }
    }
    const a = points[anchorEdge], b = points[(anchorEdge + 1) % n];
    return {
      edges, value: val(edges[0]), lengthFt, anchorEdge,
      anchorLenFt: Math.max(0, anchorLenFt),
      midF: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  });
}

// Direction spread of an ordered (possibly wrapping) edge chain — the same running-heading
// measure the forward partition uses, recomputed for the seam-merge candidate.
function spreadOf(edges, signedTurn, edgeCount) {
  let head = 0, lo = 0, hi = 0;
  for (let k = 1; k < edges.length; k++) {
    // Only count a turn where the chain is actually contiguous (it always is, by construction,
    // except that the wrap-merge joins the last edge to edge 0 — which IS contiguous on a ring).
    if ((edges[k - 1] + 1) % edgeCount !== edges[k]) continue;
    head += signedTurn(edges[k]);
    lo = Math.min(lo, head); hi = Math.max(hi, head);
  }
  return hi - lo;
}

/** The run containing edge `edgeIndex`, or null. */
export const chipRunOfEdge = (runs, edgeIndex) =>
  (runs || []).find((r) => r.edges.includes(edgeIndex)) || null;
