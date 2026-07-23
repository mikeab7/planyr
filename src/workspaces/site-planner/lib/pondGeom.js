// Pond-expansion geometry (B157) — where to anchor the "added detention area" map label.
//
// When you enlarge an existing pond (B139), the new ground is the EXPANDED footprint minus
// the existing/baseline footprint. We want the "+X ac · +Y sf" label to sit ON that new area
// — specifically on the THICKEST part of it — so it never drifts back into the existing
// basin. That matters because the whole pond's centroid often stays inside the old pond
// (e.g. a uniform "push the banks out" expansion leaves a ring of new ground whose centre of
// mass is the old water), which is exactly the confusing case to avoid.
//
// `addedAreaLabelPoint` returns the pole-of-inaccessibility of (expanded − baseline): the
// interior point of the new ground farthest from any edge. A coarse grid finds the deepest
// cell, then a local grid refines it. Pure (world-feet in / world-feet out), no React/DOM,
// so it unit-tests without a browser. Screening-grade placement, not survey geometry.
import { offsetInward, offsetOutward, ringsArea, maxInwardOffset } from "./pondOffset.js";
import { polyArea } from "./polygonSplit.js";
import { crestTopRing } from "./inwardBerm.js";

// Even-odd ray cast: is point `pt` inside ring `ring` (array of {x,y})?
export const pointInRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

// Shortest distance from point `p` to segment a→b.
const distToSeg = (p, a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  let t = L2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

// Shortest distance from point `p` to the closed ring `ring` (includes the closing edge).
const distToRing = (p, ring) => {
  let d = Infinity;
  for (let i = 0, n = ring.length; i < n; i++) {
    const dd = distToSeg(p, ring[i], ring[(i + 1) % n]);
    if (dd < d) d = dd;
  }
  return d;
};

// Deepest interior point of the "added" region = inside `expanded` but outside `baseline`.
// Returns {x,y} in the same (world-feet) frame as the inputs, or null when there is no
// added ground (no expansion, a pure shrink, or a degenerate ring). `coarse`/`fine` are the
// grid subdivisions; the defaults are plenty for a screening label.
export function addedAreaLabelPoint(expanded, baseline, opts = {}) {
  if (!Array.isArray(expanded) || expanded.length < 3) return null;
  if (!Array.isArray(baseline) || baseline.length < 3) return null;
  const coarse = opts.coarse || 28, fine = opts.fine || 8;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of expanded) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  if (!(maxX > minX) || !(maxY > minY)) return null;
  const inAdded = (p) => pointInRing(p, expanded) && !pointInRing(p, baseline);
  // "Depth" of an added-region point = distance to the nearest edge of that region, whose
  // boundary is parts of the outer (expanded) ring and the inner (baseline) ring.
  const score = (p) => Math.min(distToRing(p, expanded), distToRing(p, baseline));
  const search = (x0, y0, x1, y1, n) => {
    let best = null, bestD = -1;
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      for (let j = 0; j <= n; j++) {
        const p = { x, y: y0 + ((y1 - y0) * j) / n };
        if (!inAdded(p)) continue;
        const d = score(p);
        if (d > bestD) { bestD = d; best = p; }
      }
    }
    return best ? { x: best.x, y: best.y, d: bestD } : null;
  };
  const c = search(minX, minY, maxX, maxY, coarse);
  if (!c) return null;
  const cw = (maxX - minX) / coarse, ch = (maxY - minY) / coarse;
  const r = search(c.x - cw, c.y - ch, c.x + cw, c.y + ch, fine);
  const best = r && r.d >= c.d ? r : c;
  return { x: best.x, y: best.y };
}

// ---------------------------------------------------------------------------
// Stage contour lines (the "topographic" depth rings drawn inside a detention
// pond). A pond is drawn TOP-OF-BANK and tapers inward at `slope`:1, so the ring
// at depth `down` below the top is the footprint offset INWARD by slope*down. That
// offset must be a ROBUST topology op — clipper-lib's offsetInward (pondOffset.js) —
// not a per-edge miter, so acute corners don't spike, a narrowing tail pinches off,
// and a split basin returns multiple rings. Pure: world-feet in, world-feet out.
// ---------------------------------------------------------------------------

const ringCentroidAvg = (r) => { let x = 0, y = 0; for (const p of r) { x += p.x; y += p.y; } return { x: x / r.length, y: y / r.length }; };

// Smart contour interval (ft): aim for ~4–6 rings across the basin depth so a shallow
// pond gets 1-ft lines and a deep one doesn't crowd. User-overridable via det.contourInterval.
export function autoContourInterval(depth) {
  const d = depth > 0 ? depth : 8;
  if (d <= 6) return 1;
  if (d <= 12) return 2;
  return 3;
}

// Build the stack of stage contours for a pond footprint `ring` (top-of-bank, world feet).
// Returns levels top→bottom; each level carries `rings` — an ARRAY of result rings, since a
// robust inward offset can split the basin (multiple pools) or pinch it off (none). Stops
// the moment the offset returns nothing, and reports feasibility: a footprint can only grade
// to `maxDepth = maxInwardOffset(ring)/slope` before opposing slopes meet.
export function pondContours(ring, det = {}, opts = {}) {
  const depth = det.depth != null ? det.depth : 8;
  const freeboard = det.freeboard != null ? det.freeboard : 1;
  const slope = det.slope != null ? det.slope : 3;
  const interval = Math.max(0.5, det.contourInterval || autoContourInterval(depth));
  const tobElev = det.tobElev;
  const hasElev = tobElev != null && isFinite(tobElev);
  const EPS = 0.05;
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const out = { levels: [], collapsedAt: null, feasible: depth <= maxDepth + EPS, maxDepth, meta: { depth, freeboard, slope, interval } };
  if (!Array.isArray(ring) || ring.length < 3) return out;

  // Depths below top to draw: the interval grid, plus the water surface and the bottom
  // always (they carry the emphasis), de-duped within EPS so they don't double a grid line.
  const downs = [0];
  for (let d = interval; d < depth - EPS; d += interval) downs.push(d);
  if (freeboard > EPS && freeboard < depth - EPS) downs.push(freeboard);
  downs.push(depth);
  downs.sort((a, b) => a - b);
  const uniq = [];
  for (const d of downs) { if (d < -EPS) continue; if (!uniq.length || d - uniq[uniq.length - 1] > EPS) uniq.push(d); }

  const elevOf = (down) => (hasElev ? tobElev - down : undefined);
  for (const down of uniq) {
    if (down <= EPS) {
      out.levels.push({ down: 0, rings: [ring], area: ringsArea([ring]), isWater: freeboard <= EPS, isBottom: depth <= EPS, elev: elevOf(0) });
      continue;
    }
    const rings = offsetInward(ring, slope * down);
    // Pinch-off: the side slopes have met — nothing exists at this depth or deeper. Stop.
    if (!rings.length) { out.collapsedAt = down; break; }
    out.levels.push({
      down,
      rings,
      area: ringsArea(rings),
      isWater: Math.abs(down - freeboard) <= EPS,
      isBottom: Math.abs(down - depth) <= EPS,
      elev: elevOf(down),
    });
  }
  return out;
}

/* Detention storage for a pond whose drawn footprint is TOP-OF-BANK, with
 * `slope`:1 (H:V) interior side slopes — so the basin tapers inward with depth
 * (not a vertical-wall box). Water surface sits `freeboard` below top of bank.
 * Stage areas come from a ROBUST inward offset (clipper-lib offsetInward, B500) —
 * offset = slope × (depth below top of bank) — which pinches off cleanly when the
 * opposing slopes meet (no bogus inverted-ring area). Stored volume is the
 * average-end-area method over the water column, integrated only over the slabs
 * that actually exist, so a basin that daylights before full depth never inflates
 * the number. `feasible`/`maxDepth` report whether the footprint can hold the
 * design depth at this slope (maxDepth = max inscribed reach / slope).
 * Lifted from SitePlanner.jsx (B630) so the yield metrics pass and the pure
 * auto-size solver (detentionRules.js) can share it. `vol` is CUBIC FEET.
 *
 * Memo: a small LRU Map (not the old 1-entry cache) — the yield metrics pass
 * calls this for EVERY pond each render, interleaved with the selected-pond
 * panel and map labels, so a 1-entry memo would thrash the clipper offsets. */
const _detMemo = new Map(); // sig → result, insertion order = recency
const DET_MEMO_MAX = 32;
export function detentionStorage(ring, depth, freeboard, slope) {
  const sig = `${depth}|${freeboard}|${slope}|${ring.length}|${ring[0] ? `${ring[0].x.toFixed(2)},${ring[0].y.toFixed(2)}` : ""}|${polyArea(ring).toFixed(1)}`;
  if (_detMemo.has(sig)) {
    const hit = _detMemo.get(sig);
    _detMemo.delete(sig); _detMemo.set(sig, hit); // refresh recency
    return hit;
  }
  const areaAt = (down) => (down <= 0 ? polyArea(ring) : ringsArea(offsetInward(ring, slope * down)));
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const aTop = polyArea(ring);
  const dw = Math.max(0, depth - freeboard);       // design water depth
  const aWater = areaAt(freeboard);                 // water surface
  const aBottom = areaAt(depth);                    // basin floor (0 if it daylights first)
  // Average-end-area over the column from the water surface to the achievable floor
  // (min of design depth and what the footprint can actually grade to), ~1-ft slabs.
  const floor = Math.min(depth, maxDepth);
  let vol = 0;
  if (floor > freeboard) {
    const step = 1;
    for (let d = freeboard; d < floor - 1e-9; d += step) {
      const h = Math.min(step, floor - d);
      vol += ((areaAt(d) + areaAt(d + h)) / 2) * h;
    }
  }
  const val = { aTop, aWater, aBottom, dw, vol, feasible: depth <= maxDepth + 0.05, maxDepth };
  _detMemo.set(sig, val);
  if (_detMemo.size > DET_MEMO_MAX) _detMemo.delete(_detMemo.keys().next().value); // evict oldest
  return val;
}

// Where to seat a contour's depth/elevation label: the ring's extreme vertex on the chosen
// side (top/bottom/left/right), nudged a hair inward so it sits just inside the line. Anchoring
// the water ring to the TOP and the bottom ring to the BOTTOM keeps the two callouts apart and
// reads intuitively (water surface high, floor low), clear of the centred pond name. Returns
// {x,y} (world feet) or null.
export function contourLabelPoint(contourRing, anchor = "top") {
  if (!Array.isArray(contourRing) || contourRing.length < 3) return null;
  const c = ringCentroidAvg(contourRing);
  let best = contourRing[0];
  for (const p of contourRing) {
    if (anchor === "bottom") { if (p.y > best.y) best = p; }
    else if (anchor === "left") { if (p.x < best.x) best = p; }
    else if (anchor === "right") { if (p.x > best.x) best = p; }
    else if (p.y < best.y) best = p; // "top" (default)
  }
  const dx = c.x - best.x, dy = c.y - best.y, L = Math.hypot(dx, dy) || 1;
  const n = Math.min(10, L * 0.4);
  return { x: best.x + (dx / L) * n, y: best.y + (dy / L) * n };
}

/* ---------------------------------------------------------------------------------
 * B708 — elevation-anchored banded storage. Anchoring a pond to a real NAVD88
 * top-of-bank elevation (det.tobElev — the same field the stage contours label
 * with) lets the basin's volume split at REAL water surfaces:
 *
 *   ── top of bank (tobElev) ─────────────────────────────── freeboard
 *   ── design water surface (tobElev − freeboard) ────────┐
 *      DETENTION-USABLE — above max(flood WSE, pool)      │ exclusive bands:
 *   ── flood WSE ─────────────────────────────────────────┤ no acre-foot lands
 *      MITIGATION-CANDIDATE — the flood already occupies  │ in two ledgers
 *      it at design stage → NO detention credit           │
 *   ── permanent pool surface (det.poolElev) ─────────────┤
 *      POOL DEAD — wet-bottom storage below the outlet    │
 *   ── achievable floor (tobElev − min(depth, maxDepth)) ─┘
 *
 * All pure; volumes are CUBIC FEET (display converts). Same average-end-area
 * slab integration as detentionStorage so a full-band request equals its `vol`
 * exactly. Small LRU memos (the metrics pass calls these for every pond each
 * render) — sigs EXTEND the detentionStorage signature with the elevation params
 * so two elevation states of one pond can never collide in the cache.
 * ------------------------------------------------------------------------------- */

const EPS_ELEV = 1e-9;

// Shared slab integrator over a depth-below-top range (dLo < dHi), ~1-ft slabs —
// the same loop detentionStorage runs, factored so bands can't drift from it.
function integrateAreaBetween(areaAt, dLo, dHi) {
  let vol = 0;
  const step = 1;
  for (let d = dLo; d < dHi - EPS_ELEV; d += step) {
    const h = Math.min(step, dHi - d);
    vol += ((areaAt(d) + areaAt(d + h)) / 2) * h;
  }
  return vol;
}

const detOf = (det = {}) => ({
  depth: det.depth != null ? det.depth : 8,
  freeboard: det.freeboard != null ? det.freeboard : 1,
  slope: det.slope != null ? det.slope : 3,
});

/* Volume of the basin between two ELEVATIONS (ft NAVD88), clamped to what exists:
 * nothing above the top of bank, nothing below the achievable floor (pinch-off
 * respected via maxInwardOffset). Returns cubic feet; null when the pond isn't
 * anchored (no tobElev) — never a silent 0 for a missing anchor. Pure. */
export function volumeBetween(ring, det, elevLo, elevHi) {
  const tob = det && det.tobElev;
  if (tob == null || !isFinite(tob)) return null;
  const { depth, slope } = detOf(det);
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const floorElev = tob - Math.min(depth, maxDepth);
  const lo = Math.max(elevLo, floorElev), hi = Math.min(elevHi, tob);
  if (!(hi > lo)) return 0;
  const areaAt = (down) => (down <= 0 ? polyArea(ring) : ringsArea(offsetInward(ring, slope * down)));
  return integrateAreaBetween(areaAt, tob - hi, tob - lo);
}

const _bandMemo = new Map();
const BAND_MEMO_MAX = 32;

/* Split an ANCHORED pond's storage into the exclusive bands above. `wseFt` is the
 * governing flood water surface at the pond (B707's wse1pctForRing / manual BFE) —
 * null when the pond is outside the floodplain or the WSE is unknown, in which case
 * only the pool band splits (a wet-bottom pond outside the floodplain still earns
 * no credit below its outlet). Returns null when unanchored — the caller falls back
 * to the Regime-B estimate, NEVER silently to gross. Pure + memoized. */
export function bandedStorage(ring, det, { wseFt = null, gradeFt = null, deadFloorFt = null } = {}) {
  const tob = det && det.tobElev;
  if (tob == null || !isFinite(tob)) return null;
  const { depth, freeboard, slope } = detOf(det);
  // D1 — INWARD berm: when the rim sits above existing grade the drawn ring is the fixed OUTER
  // TOE; the effective top-of-bank is the CREST, inset inward by extSlope·(tob−grade). Storage
  // then integrates down from the crest on the shrunk ring (diminishing returns; a closed
  // footprint → zero). gradeFt omitted, or the rim at/below grade, leaves the drawn ring as-is.
  const bermH = gradeFt != null && isFinite(gradeFt) && tob > gradeFt + 0.02 ? tob - gradeFt : 0;
  if (bermH > 0) {
    const crest = crestTopRing(ring, bermH);
    if (!crest) {
      return { usableCf: 0, mitigationCandidateCf: 0, poolDeadCf: 0, grossCf: 0, fullyInundated: false,
        anchored: true, closed: true, elevations: { tobElev: tob, waterSurfElev: tob - freeboard, floorElev: tob, poolElev: det.poolElev ?? null, wseFt } };
    }
    ring = crest;
  }
  const poolElev = det.poolElev != null && isFinite(det.poolElev) ? det.poolElev : null;
  // PR-G (c) — storage below the 100-yr receiving water (tailwater) can't discharge by
  // gravity, so it's DEAD: the usable band floors at the tailwater elevation too.
  const deadFloor = Number.isFinite(deadFloorFt) ? deadFloorFt : null;
  const sig = `${depth}|${freeboard}|${slope}|${tob}|${poolElev}|${wseFt}|${deadFloor}|${ring.length}|` +
    `${ring[0] ? `${ring[0].x.toFixed(2)},${ring[0].y.toFixed(2)}` : ""}|${polyArea(ring).toFixed(1)}`;
  if (_bandMemo.has(sig)) {
    const hit = _bandMemo.get(sig);
    _bandMemo.delete(sig); _bandMemo.set(sig, hit);
    return hit;
  }
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const floorElev = tob - Math.min(depth, maxDepth);
  const waterSurf = tob - freeboard;
  const grossCf = detentionStorage(ring, depth, freeboard, slope).vol;
  const poolTop = poolElev != null ? Math.min(poolElev, waterSurf) : null;
  const poolDeadCf = poolTop != null ? volumeBetween(ring, det, floorElev, poolTop) : 0;
  // Mitigation-candidate: pool surface (or floor) up to the flood WSE — the flood
  // already occupies it during the design storm (tailwater), so it stores nothing
  // for detention; it IS candidate compensating-storage cut ("hydraulic connection
  // + stage distribution: engineer confirms").
  const candLo = Math.max(floorElev, poolTop != null ? poolTop : floorElev);
  const candHi = wseFt != null ? Math.min(wseFt, waterSurf) : candLo;
  const mitigationCandidateCf = candHi > candLo ? volumeBetween(ring, det, candLo, candHi) : 0;
  const usableLo = Math.max(wseFt != null ? wseFt : floorElev, poolTop != null ? poolTop : floorElev, floorElev, deadFloor != null ? deadFloor : -Infinity);
  const usableCf = usableLo < waterSurf ? volumeBetween(ring, det, usableLo, waterSurf) : 0;
  const val = {
    usableCf,
    mitigationCandidateCf,
    poolDeadCf,
    grossCf,
    fullyInundated: wseFt != null && wseFt >= tob - EPS_ELEV,
    anchored: true,
    elevations: { tobElev: tob, waterSurfElev: waterSurf, floorElev, poolElev, wseFt },
  };
  _bandMemo.set(sig, val);
  if (_bandMemo.size > BAND_MEMO_MAX) _bandMemo.delete(_bandMemo.keys().next().value);
  return val;
}

/* THE per-pond usable/dead split — the ONE helper every consumer calls (the site
 * metrics loop, the pond auto-size solver's volumeAt + depth fallback, and the
 * per-pond required-vs-provided card), so the readout and the solver can never
 * disagree (the invariant the providedUsableCf comment in SitePlanner holds).
 *
 * Precedence:
 *   anchored  — det.tobElev is set AND we have something real to split on (a flood
 *               WSE and/or a permanent-pool elevation) → the banded split.
 *   estimate  — otherwise, when the caller passes the Regime-B site-level pool
 *               estimate (deadStoragePoolDepthFt output) → the existing
 *               depth-below-pool subtraction. An anchored pond whose ctx elevations
 *               are missing lands HERE — it must never silently zero its dead band.
 *   gross     — no flood/pool information at all → everything counts.
 * Pure. */
export function usablePondVolume(ring, det = {}, { wseFt = null, estimatePoolDepthFt = null, gradeFt = null, deadFloorFt = null } = {}) {
  const { depth, freeboard, slope } = detOf(det);
  const anchored = det.tobElev != null && isFinite(det.tobElev);
  // D1 — INWARD berm: a rim above grade shrinks the effective top-of-bank to the crest ring
  // (inset by extSlope·(tob−grade)); every volume below is integrated on that shrunk ring, so a
  // taller berm holds progressively LESS (diminishing returns) until the footprint pinches
  // closed. gradeFt omitted / rim at grade → the drawn ring is used, exactly as before.
  const bermH = gradeFt != null && isFinite(gradeFt) && anchored && det.tobElev > gradeFt + 0.02 ? det.tobElev - gradeFt : 0;
  const effRing = bermH > 0 ? crestTopRing(ring, bermH) : ring;
  if (bermH > 0 && !effRing) return { mode: "closed", usableCf: 0, deadCf: 0, grossCf: 0, bands: null, closed: true };
  const grossCf = detentionStorage(effRing, depth, freeboard, slope).vol;
  if (anchored && (wseFt != null || (det.poolElev != null && isFinite(det.poolElev)) || Number.isFinite(deadFloorFt))) {
    const bands = bandedStorage(effRing, det, { wseFt, deadFloorFt }); // effRing is already the crest → no gradeFt
    return { mode: "anchored", usableCf: bands.usableCf, deadCf: Math.max(0, grossCf - bands.usableCf), grossCf, bands };
  }
  if (estimatePoolDepthFt != null && estimatePoolDepthFt > 0) {
    const dead = detentionStorage(effRing, depth, Math.max(0, depth - estimatePoolDepthFt), slope).vol;
    return { mode: "estimate", usableCf: Math.max(0, grossCf - dead), deadCf: Math.min(grossCf, dead), grossCf, bands: null };
  }
  return { mode: "gross", usableCf: grossCf, deadCf: 0, grossCf, bands: null };
}

const _excMemo = new Map();

/* Excavation (cut) volume for the cost line (B712): the WHOLE basin from the drawn
 * top-of-bank down to the achievable floor — deliberately NOT detentionStorage.vol,
 * which integrates only below the freeboard (the water column). Assumes the drawn
 * top-of-bank sits at existing grade; a bermed basin (tobElev above grade) is fill,
 * flagged separately by bermAsFillHeight. Cubic feet; /27 for cy. Pure + memoized. */
export function excavationVolume(ring, det = {}) {
  const { depth, slope } = detOf(det);
  const sig = `exc|${depth}|${slope}|${ring.length}|${ring[0] ? `${ring[0].x.toFixed(2)},${ring[0].y.toFixed(2)}` : ""}|${polyArea(ring).toFixed(1)}`;
  if (_excMemo.has(sig)) {
    const hit = _excMemo.get(sig);
    _excMemo.delete(sig); _excMemo.set(sig, hit);
    return hit;
  }
  const maxDepth = slope > 0 ? maxInwardOffset(ring) / slope : 0;
  const floor = Math.min(depth, maxDepth);
  const areaAt = (down) => (down <= 0 ? polyArea(ring) : ringsArea(offsetInward(ring, slope * down)));
  const val = floor > 0 ? integrateAreaBetween(areaAt, 0, floor) : 0;
  _excMemo.set(sig, val);
  if (_excMemo.size > BAND_MEMO_MAX) _excMemo.delete(_excMemo.keys().next().value);
  return val;
}

/* Gravity-drawdown screen (B708; the pond-side consumer of the B641 outfall
 * umbrella — HCFCD flowline data plugs into receivingFlowlineElev later): a pond
 * bottom BELOW the receiving channel's flowline can't drain by gravity. Returns
 * null (no concern / not enough info) or the warning payload. Pure. */
export function drawdownWarning(det = {}) {
  const tob = det.tobElev, fl = det.receivingFlowlineElev;
  if (tob == null || fl == null || !isFinite(tob) || !isFinite(fl)) return null;
  const { depth } = detOf(det);
  const bottomElev = tob - depth;
  if (bottomElev >= fl - 0.05) return null;
  return {
    bottomElev,
    flowlineElev: fl,
    belowByFt: fl - bottomElev,
    // The depth at which the bottom would sit AT the flowline — the gravity cap.
    suggestedMaxDepthFt: Math.max(0, tob - fl),
  };
}

/* Berm-as-fill screen (B708): a top of bank ABOVE existing grade means the basin is
 * bermed — the berm itself is fill (requires mitigation in the floodplain and can
 * block conveyance). 0.25 ft tolerance shrugs off survey noise. Pure. */
/* B833(e) — screening berm-as-fill volume: an embankment ring lifting the bank from
 * existing grade to the top of bank. Cross-section = a triangle hFt high with the
 * OUTER face at ratio:1 (the inner face is the basin's own cut — already priced by
 * excavationVolume; counting it here would double-price the wall). volume ≈
 * perimeter × h²·ratio/2. The toe sits ≈ h·ratio outside the drawn bank line. Pure. */
export function bermFillVolume(ring, hFt, ratio = 3) {
  if (!Array.isArray(ring) || ring.length < 3 || !(hFt > 0) || !(ratio > 0)) return null;
  let perim = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    perim += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return perim * hFt * hFt * ratio / 2;
}

export function bermAsFillHeight(det = {}, existGradeFt = null) {
  const tob = det.tobElev;
  if (tob == null || existGradeFt == null || !isFinite(tob) || !isFinite(existGradeFt)) return null;
  const h = tob - existGradeFt;
  return h > 0.25 ? h : null;
}

/* NEW-6 — MATERIALIZE an above-grade berm (top of bank above existing grade) as modeled
 * proposed-fill cells, so an applied/entered TOB raise becomes real dirt everywhere fill
 * matters (mitigation ledger, fill-depth heat map, land take, earthwork).
 *
 * The berm is the embankment ring OUTSIDE the drawn bank line: the crest sits at the TOB
 * over the bank, and the OUTER face slopes down at `ratio:1` to meet existing grade at the
 * toe (≈ h·ratio outside the bank). Unlike the single-number bermFillVolume screening
 * approximation, the height here is PER-CELL: h = TOB − LOCAL grade sampled off the 3DEP
 * grid, so on a sloped reach the berm is tall on the low side and absent on the high side
 * (where grade already meets/clears the TOB). Cells that fall below the flood WSE inside a
 * trigger zone are the compensating-fill contribution; the rest are earthwork-only.
 *
 * Inputs: `gradeAt(pt)` → existing grade ft (null when off-grid — that cell is skipped, never
 * priced as 0); `wseFt` the governing flood WSE (null → no below-WSE split); `ratio` the outer
 * side slope; `triggerClassAt(pt)` → "1pct"|"02pct"|null (null → no floodplain fill priced);
 * `fpId` the heat-cell footprint id. Returns { cells, heatCells, volCf, floodCf, toeRing,
 * landTakeSf, maxHeightFt, crestElevFt, cellFt } or null on degenerate input. Pure. */
export function bermFillCells(ring, det = {}, { gradeAt = null, wseFt = null, ratio = 3, triggerClassAt = null, fpId = "berm", cellFt = null, maxCells = 6000 } = {}) {
  const tob = det.tobElev;
  if (!Array.isArray(ring) || ring.length < 3 || tob == null || !isFinite(tob) || typeof gradeAt !== "function" || !(ratio > 0)) return null;
  // Max local berm height (grade sampled at the bank vertices) → the toe reach.
  let maxH = 0;
  for (const p of ring) {
    const g = gradeAt(p);
    if (g == null || !isFinite(g)) continue;
    const h = tob - g;
    if (h > maxH) maxH = h;
  }
  const empty = { cells: [], heatCells: [], volCf: 0, floodCf: 0, toeRing: null, landTakeSf: 0, maxHeightFt: Math.max(0, maxH), crestElevFt: tob, cellFt: 0 };
  if (!(maxH > 0.25)) return empty; // at/below grade → no berm (dormant, never a zero-height ring polluting ledgers)
  const toeReach = maxH * ratio;
  const toeArr = offsetOutward(ring, toeReach);
  const toeRing = toeArr && toeArr[0] ? toeArr[0] : null;
  const size = cellFt && cellFt > 0 ? cellFt : Math.max(4, Math.min(20, toeReach / 4));
  const bbSrc = toeRing || ring;
  let mnX = Infinity, mnY = Infinity, mxX = -Infinity, mxY = -Infinity;
  for (const p of bbSrc) { if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x; if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y; }
  const cells = [], heatCells = [];
  let volCf = 0, floodCf = 0, bermSf = 0, count = 0;
  const nx = Math.min(300, Math.ceil((mxX - mnX) / size));
  const ny = Math.min(300, Math.ceil((mxY - mnY) / size));
  const a = size * size;
  for (let iy = 0; iy < ny && count <= maxCells; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      if (++count > maxCells) break;
      const x = mnX + (ix + 0.5) * size, y = mnY + (iy + 0.5) * size;
      const pt = { x, y };
      if (pointInRing(pt, ring)) continue;            // inside the basin — that's excavation, not berm
      if (toeRing && !pointInRing(pt, toeRing)) continue; // beyond the toe — not berm
      const g = gradeAt(pt);
      if (g == null || !isFinite(g)) continue;        // off-grid — skip, never price as 0
      const bermSurf = tob - distToRing(pt, ring) / ratio; // outer face sloping down from the crest
      const fill = bermSurf - g;
      if (!(fill > 0.05)) continue;                   // the face has met grade — no fill here
      bermSf += a;
      volCf += a * fill;
      const cls = triggerClassAt ? triggerClassAt(pt) : null;
      const belowWse = wseFt != null && isFinite(wseFt) ? Math.max(0, Math.min(bermSurf, wseFt) - g) : 0;
      if (cls && belowWse > 0.001) {
        floodCf += a * belowWse;
        heatCells.push({ cls, fpId, x, y, wFt: size, hFt: size, depthFt: belowWse });
      }
      cells.push({ x, y, wFt: size, hFt: size, fillDepthFt: fill, belowWseFt: belowWse, cls: cls || null });
    }
  }
  const landTakeSf = toeRing ? Math.max(0, ringsArea([toeRing]) - polyArea(ring)) : bermSf;
  return { cells, heatCells, volCf, floodCf, toeRing, landTakeSf, maxHeightFt: maxH, crestElevFt: tob, cellFt: size };
}

/* B907 — CE roadmap #7: tie detention SIZING to LAND TAKE + EARTHWORK $. Two gaps closed:
 *
 * (1) INCREMENTAL excavation for an ENLARGED pond. excavationVolume() above always prices
 *     the FULL basin cut (top of bank → floor) off the pond's CURRENT geometry — correct
 *     for a from-scratch pond, but wrong for the "Expand this pond" case (B139/B902): a
 *     basin that reuses an EXISTING depression (the Tsakiris case) should only cost the
 *     ADDED dirt, not a full re-dig of ground it already excavated once. The expand flow
 *     already snapshots a `det.baseline` ({ring, depth, freeboard, slope}) purely for its
 *     "+X ac added" label (SitePlanner.jsx) — reused here as the pre-expansion geometry to
 *     net against. Falls back to the FULL cut when there's no baseline (never assumes an
 *     incremental history that isn't there). Pure.
 *
 * (2) A FORWARD-LOOKING land-take ESTIMATE. The Yield land pie's "Detention" slice
 *     (detPct, computed elsewhere from real drawn pond footprints) is honest but reactive —
 *     it can only show acreage a pond ALREADY consumes. Before a pond is drawn/enlarged to
 *     meet the site's required volume, there's no signal of how much MORE land that
 *     shortfall will eventually take. detentionLandTakeEstimate() answers that from the
 *     SAME required-vs-provided figures the site's "raise TOB" berm-apply screen already
 *     reads, via a simple prismatic screening approximation (footprint = volume / a typical
 *     pond depth) — advisory only, never folded into the pie's real percentages (which stay
 *     100%-consistent, reflecting only what's actually drawn). LOUD-FAILURE: null with no
 *     resolvable shortfall — never a fabricated estimate. */
export function incrementalExcavationCf(ring, det = {}) {
  const totalCf = excavationVolume(ring, det);
  const base = det && det.baseline;
  if (!base || !Array.isArray(base.ring) || base.ring.length < 3) {
    return { cf: totalCf, totalCf, baselineCf: 0, incremental: false };
  }
  const baselineCf = excavationVolume(base.ring, { depth: base.depth, freeboard: base.freeboard, slope: base.slope });
  return { cf: Math.max(0, totalCf - baselineCf), totalCf, baselineCf, incremental: true };
}

/* Screening-estimate a footprint (sf) from a volume + a typical average depth — a simple
 * prismatic approximation, never a substitute for a drawn/sized pond. Null on bad inputs. */
export function estimateFootprintSf({ volumeCf, avgDepthFt } = {}) {
  const v = Number(volumeCf), d = Number(avgDepthFt);
  if (!Number.isFinite(v) || v <= 0 || !Number.isFinite(d) || d <= 0) return null;
  return v / d;
}

/* The top-level site land-take advisory: required vs. provided (the SAME figures the
 * "raise TOB" berm-apply screen reads) → the shortfall's estimated additional footprint,
 * at `avgDepthFt` (criteria-configurable — detentionCriteria.js's screeningPondDepthFt,
 * default 8 ft — the same screening default depth already used elsewhere for an
 * unanchored pond). Null when there's no positive shortfall (or the inputs aren't
 * resolvable) — never a fabricated estimate. Pure. */
export function detentionLandTakeEstimate({ requiredAcFt, providedUsableCf, avgDepthFt = 8 } = {}) {
  const req = Number(requiredAcFt);
  if (!Number.isFinite(req) || req <= 0 || providedUsableCf == null || !Number.isFinite(providedUsableCf)) return null;
  const deficitCf = req * 43560 - providedUsableCf;
  if (!(deficitCf > 0)) return null;
  const footprintSf = estimateFootprintSf({ volumeCf: deficitCf, avgDepthFt });
  if (footprintSf == null) return null;
  return { deficitCf, deficitAcFt: deficitCf / 43560, footprintSf, footprintAc: footprintSf / 43560, avgDepthFt };
}

// B909 — screening candidate CENTER points for auto-placing a pond that doesn't exist yet
// ("⚡ Design detention" / "⚡ Design mitigation" one-click flows): an N×N grid over a
// bounding box (e.g. the active parcels' extent), ordered NEAREST-TO-CENTER first so a
// caller's first collision-free / in-parcel / in-floodplain hit reads as "the most central
// open spot found," not an arbitrary corner. The caller supplies its own validity test
// (collision with drawn elements, inside a parcel, intersects a mapped flood zone, …) —
// this function only ever proposes WHERE to look, never judges a spot itself, so it stays
// free of the app's element/GIS state and unit-tests with plain numbers. Pure.
export function pondPlacementCandidates({ minX, minY, maxX, maxY, divisions = 5 } = {}) {
  if (!(maxX > minX) || !(maxY > minY) || !(Number.isFinite(divisions)) || divisions < 1) return [];
  const n = Math.floor(divisions);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const pts = [];
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      pts.push({ x: minX + ((i + 0.5) / n) * (maxX - minX), y: minY + ((j + 0.5) / n) * (maxY - minY) });
    }
  }
  pts.sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));
  return pts;
}
