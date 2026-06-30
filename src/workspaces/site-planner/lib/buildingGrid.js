// Structural column grid + dock-door placement for a drawn building (B568/B569).
//
// PURE + dependency-free + unit-tested. Given a rectangular footprint's LENGTH (the
// span ALONG the dock wall) and DEPTH (the span PERPENDICULAR to it — dock face → rear,
// or dock wall → dock wall for cross-dock), this lays out a speculative-industrial
// column grid the way these buildings are actually framed:
//
//   • Depth direction: the first bay off each dock face is the SPEED BAY (default 60′ —
//     the staging strip between the docks and the first interior columns). The rest of
//     the depth is FIXED interior bays at a clean depth module (default 50′), with the
//     leftover absorbed by the REAR bay (single-load) or the CENTRE bay (cross-dock, a
//     speed bay mirrored to both walls).
//   • Length direction: FIXED interior bays at a clean length module (default 56′), with
//     the leftover absorbed by the two END bays (where offices / odd geometry live).
//
// Headline rule (owner, 2026-06-30): the typical/interior bays are a FIXED standard module
// — never stretched to an odd number to force an even division. The ONLY bays that flex are
// the end bays (length) and the rear/centre bay (depth); the speed bay stays pinned at 60′.
// The interior count is chosen so each flex bay stays near the module (no slivers, nothing
// oversized) and a flex bay that lands exactly on the module reads as a normal bay. Length
// and depth modules are INDEPENDENT (real buildings run e.g. 56′ × 50′ — confirmed against
// the owner's Grand Port approved set).
//
// Output is in building-LOCAL feet (offsets 0..L / 0..D). The renderer maps those onto the
// element's axis-aligned frame (and the existing rot/ppf transform handles rotation), so
// the geometry survives reload and rotation untouched.

const EPS = 1e-6;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const num = (v) => { const n = typeof v === "number" ? v : parseFloat(v); return Number.isFinite(n) ? n : null; };

// Grid defaults — the provisional house standard (tune against real sets later).
export const GRID_DEFAULTS = {
  speedBay: 60,          // staging bay off each dock face (ft)
  bayLengthTarget: 56,   // typical bay ALONG the dock wall (ft)
  bayDepthTarget: 50,    // typical interior bay PERPENDICULAR to the dock wall (ft)
  bayMin: 50,            // industry flex band (ft)
  bayMax: 58,
  doorWidth: 9,          // dock-door leaf width (ft) — 9×10 modern default
  doorOC: 12,            // dock-door spacing, on-centre (ft)
};

// Resolve the grid knobs for one building element: global `settings` defaults, each
// optionally pinned by a per-building override (the existing `…Override` pattern —
// flat fields on the element, null/absent = "use the global default"). Returns the
// resolved numbers plus an `overridden` map so the panel can show a "set ↺" revert.
export function resolveGridSettings(el, settings = {}) {
  const e = el || {};
  const pick = (key, ovKey, floor = 1) => {
    const ov = num(e[ovKey]);
    const base = num(settings[key]);
    const def = GRID_DEFAULTS[key];
    const val = ov != null ? ov : base != null ? base : def;
    return { val: Math.max(floor, val), overridden: ov != null };
  };
  // The flex band first — the bay targets are then CLAMPED into it, since the band is the
  // hard industry constraint and the per-building target is only a preference within it
  // (an out-of-band target would otherwise drive a negative residual bay; see divideSpan).
  let bayMin = num(settings.bayMin); bayMin = Math.max(1, bayMin != null ? bayMin : GRID_DEFAULTS.bayMin);
  let bayMax = num(settings.bayMax); bayMax = Math.max(1, bayMax != null ? bayMax : GRID_DEFAULTS.bayMax);
  if (bayMax < bayMin) [bayMin, bayMax] = [bayMax, bayMin]; // tolerate a swapped band
  const speedBay = pick("speedBay", "speedBayOverride");
  const bayLengthTarget = pick("bayLengthTarget", "bayLengthOverride");
  const bayDepthTarget = pick("bayDepthTarget", "bayDepthOverride");
  const doorWidth = pick("doorWidth", "doorWidthOverride");
  const doorOC = pick("doorOC", "doorOCOverride", 2);
  return {
    speedBay: speedBay.val,
    bayLengthTarget: clamp(bayLengthTarget.val, bayMin, bayMax),
    bayDepthTarget: clamp(bayDepthTarget.val, bayMin, bayMax),
    bayMin,
    bayMax,
    doorWidth: doorWidth.val,
    doorOC: doorOC.val,
    overrides: {
      speedBay: speedBay.overridden,
      bayLengthTarget: bayLengthTarget.overridden,
      bayDepthTarget: bayDepthTarget.overridden,
      doorWidth: doorWidth.overridden,
      doorOC: doorOC.overridden,
    },
  };
}

// Divide a span S into bays the way spec industrial is actually framed (owner rule,
// 2026-06-30): the interior/typical bays are a FIXED, clean standard module (`target` —
// e.g. 56′ along the docks, 50′ deep), and ONLY the flex bays vary to close the building.
// `residual` says where the flex lives: "ends" → the two end bays (length — offices / odd
// geometry), "rear" → one far bay (single-load depth), "center" → one middle bay (cross-
// dock depth). We pick the interior count so each flex bay stays near the module (never a
// sliver, never oversized: ~0.75–1.25× for two ends, ~0.5–1.5× for one). A flex bay that
// lands exactly on the module is tagged "std" (no dashed line); only a genuinely different
// one is tagged "flex". `min`/`max` only bound the module + the single-bay threshold now.
// Returns { sizes, roles } where role is "std" | "flex".
export function divideSpan(S, opts = {}) {
  const span = num(S);
  if (span == null || span <= EPS) return { sizes: [], roles: [] };
  let min = Math.max(1, num(opts.min) ?? GRID_DEFAULTS.bayMin);
  let max = Math.max(1, num(opts.max) ?? GRID_DEFAULTS.bayMax);
  if (max < min) [min, max] = [max, min];
  const residual = opts.residual || "ends";
  const M = clamp(num(opts.target) ?? (min + max) / 2, min, max); // the FIXED interior module
  // A short span is a single bay (no interior column line).
  if (span <= max + EPS) return { sizes: [span], roles: ["std"] };

  const E = residual === "ends" ? 2 : 1;                 // how many bays flex
  const nFull = Math.max(0, Math.round(span / M) - E);   // interior bays pinned at exactly M
  const each = (span - nFull * M) / E;                   // each flex bay absorbs the residual
  const flexRole = Math.abs(each - M) > 0.5 ? "flex" : "std"; // clean division → not a dashed line
  const fill = (k) => Array(Math.max(0, k)).fill(M);
  const fillR = (k) => Array(Math.max(0, k)).fill("std");
  if (residual === "rear") {
    return { sizes: [...fill(nFull), each], roles: [...fillR(nFull), flexRole] };
  }
  if (residual === "center") {
    const left = Math.floor(nFull / 2), right = nFull - left;
    return { sizes: [...fill(left), each, ...fill(right)], roles: [...fillR(left), flexRole, ...fillR(right)] };
  }
  // "ends" (default): a flex bay at each end, fixed module between.
  return { sizes: [each, ...fill(nFull), each], roles: [flexRole, ...fillR(nFull), flexRole] };
}

// Cumulative interior column-line offsets from a bay-size list (drops the trailing edge,
// which is the building wall, not a column line). Each line's role comes from its two
// neighbouring bays: touching a speed bay → "speed" (so BOTH cross-dock speed lines are
// caught), else touching a residual flex bay → "flex", else "std".
function linesFromBays(sizes, roles) {
  const lines = [];
  let acc = 0;
  for (let i = 0; i < sizes.length - 1; i++) {
    acc += sizes[i];
    const pair = [roles[i], roles[i + 1]];
    const role = pair.includes("speed") ? "speed" : pair.includes("flex") ? "flex" : "std";
    lines.push({ at: acc, role });
  }
  return lines;
}

// The depth-axis bay list (from a dock face inward) for a single-load building: the speed
// bay, then interior bays flexing toward the depth target, residual in the rear bay.
function depthBaysSingle(D, g) {
  if (D <= g.speedBay + EPS) return { sizes: [D], roles: ["speed"] }; // too shallow for any interior line
  const rest = divideSpan(D - g.speedBay, { target: g.bayDepthTarget, min: g.bayMin, max: g.bayMax, residual: "rear" });
  return { sizes: [g.speedBay, ...rest.sizes], roles: ["speed", ...rest.roles] };
}

// The depth-axis bay list for a cross-dock building: a speed bay mirrored to BOTH dock
// walls, interiors flexing in the middle, residual in the centre. Guards a footprint too
// shallow to hold two speed bays by degrading to a single speed bay (one dock face).
function depthBaysCross(D, g) {
  if (D < 2 * g.speedBay + g.bayMin - EPS) return depthBaysSingle(D, g); // can't fit two speed bays + a bay
  const mid = divideSpan(D - 2 * g.speedBay, { target: g.bayDepthTarget, min: g.bayMin, max: g.bayMax, residual: "center" });
  return { sizes: [g.speedBay, ...mid.sizes, g.speedBay], roles: ["speed", ...mid.roles, "speed"] };
}

// Compute the full structural grid for a rectangular footprint.
//   opts: { length, depth, dock: "single"|"cross"|"none", grid: resolveGridSettings() }
// Returns local-feet column-line offsets + bay lists + a panel summary. `lengthLines`
// run across the depth (offsets along the length, 0..L); `depthLines` run across the
// length (offsets along the depth from the dock face, 0..D).
export function computeBuildingGrid({ length, depth, dock = "single", grid } = {}) {
  const L = num(length), D = num(depth);
  const g = grid || resolveGridSettings(null, {});
  const empty = { lengthLines: [], depthLines: [], lengthBays: [], depthBays: [], summary: null };
  if (L == null || D == null || L <= EPS || D <= EPS) return empty;

  const len = divideSpan(L, { target: g.bayLengthTarget, min: g.bayMin, max: g.bayMax, residual: "ends" });
  let dep;
  if (dock === "cross") dep = depthBaysCross(D, g);
  else if (dock === "none") dep = divideSpan(D, { target: g.bayDepthTarget, min: g.bayMin, max: g.bayMax, residual: "ends" });
  else dep = depthBaysSingle(D, g);

  const lengthLines = linesFromBays(len.sizes, len.roles);
  const depthLines = linesFromBays(dep.sizes, dep.roles);

  // Typical (modal) standard bay size in each direction, for the readout. Falls back to
  // the average when every bay is a residual flex bay.
  const typical = (sizes, roles) => {
    const std = sizes.filter((_, i) => roles[i] === "std");
    const pick = std.length ? std : sizes.filter((_, i) => roles[i] !== "speed");
    if (!pick.length) return Math.round(sizes.reduce((a, b) => a + b, 0) / Math.max(1, sizes.length));
    return Math.round(pick.reduce((a, b) => a + b, 0) / pick.length);
  };

  return {
    lengthLines,
    depthLines,
    lengthBays: len.sizes,
    depthBays: dep.sizes,
    summary: {
      lengthTyp: typical(len.sizes, len.roles),
      depthTyp: typical(dep.sizes, dep.roles),
      lengthCount: len.sizes.length,
      depthCount: dep.sizes.length,
      speedBay: dock === "none" ? null : Math.round(g.speedBay),
    },
  };
}

// Place dock doors along one stretch of the dock wall so an opening never lands on a
// column line (B569). The stretch [from,to] (local feet along the length) is partitioned
// by the interior column lines that fall inside it; within each clear sub-bay we drop
// doors at `doorOC` spacing, centred, leaving at least half a door's width of jamb clear
// of each column line. Returns door CENTRE offsets (feet). Pure — built only against the
// grid's own line offsets, never re-deriving geometry.
export function placeDockDoors(from, to, lengthLines = [], { doorOC, doorWidth } = {}) {
  const a = num(from) ?? 0, b = num(to) ?? 0;
  const oc = Math.max(2, num(doorOC) ?? GRID_DEFAULTS.doorOC);
  const leaf = Math.max(1, num(doorWidth) ?? GRID_DEFAULTS.doorWidth);
  if (b - a < leaf + EPS) return [];
  // Cut points: the segment ends plus any column line strictly inside it (sorted).
  const cuts = [a, ...lengthLines.map((l) => (typeof l === "number" ? l : l.at)).filter((x) => x > a + EPS && x < b - EPS).sort((x, y) => x - y), b];
  const doors = [];
  const margin = leaf / 2; // keep the leaf clear of the column line at each sub-bay edge
  for (let i = 0; i < cuts.length - 1; i++) {
    const segA = cuts[i] + (i === 0 ? 0 : margin);       // building-wall ends need no column margin
    const segB = cuts[i + 1] - (i === cuts.length - 2 ? 0 : margin);
    const w = segB - segA;
    if (w < leaf - EPS) continue;
    const n = Math.max(1, Math.floor((w + (oc - leaf)) / oc + EPS)); // doors that fit at oc spacing
    const span = (n - 1) * oc;                            // centre-to-centre extent of the run
    const start = segA + (w - span) / 2;                  // centre the run in the sub-bay
    for (let k = 0; k < n; k++) doors.push(start + k * oc);
  }
  return doors;
}
