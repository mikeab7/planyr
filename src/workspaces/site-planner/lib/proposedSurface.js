/* Proposed-surface engine (B826) — auto-grades the concept from the plan FFE + the
 * B825 grading-class records, then prices earthwork (cut/fill) off that surface.
 *
 * v1 = SCREENING PLANES, deliberately not a TIN: every graded element gets ONE plane
 * derived from its surface class (lib/gradingRules.js) —
 *   • building pad     — flat at FFE (per-element padElevFt override wins);
 *   • dock stack       — breaks −dockDropFt at the dock face (the B713 setting), then
 *     falls AWAY from the host building at the dockApron band (1–2%);
 *   • paving / parking / trailer — anchors to the pad at the nearest building edge
 *     (threshold tie ≈ FFE − 0.15′), falls toward the DRAINAGE TARGET (largest pond's
 *     centroid; the B705 flow field stays a hint only — there is no persisted site-wide
 *     flow field) at the class band, floor→cap swept by fieldT (the balance assist);
 *   • landscape        — ungraded: proposed = existing (tie-downs are checked as a
 *     violation class at the parcel line, not modeled as geometry).
 *
 * The composite grid rides the SAME adaptive-lattice idiom as the B808 mitigation
 * engine (cell-center sampling, honest DEM voids: excluded + counted, never priced as
 * zero), and the retained cells feed the B809 overlay renderer's cut/fill mode — the
 * picture and the earthwork rows are the same array by construction (engine truth).
 *
 * Violations are DATA with copy (short ≤ the B823 one-line cap + a ⓘ detail), classed
 * legal vs screening by the registry's legalClass: an ADA/TAS §502.4 breach is LEGAL
 * (danger), everything else is screening (warn). Slopes are validated against the BASE
 * registry rule — an owner slope override changes the plane, never the law (the
 * mergeGradeOverride provenance rule).
 *
 * GRADING MODEL (owner-only, 2026-10-16) — an OPTIONAL `grading` argument (buildPlanes / surfaceGrid /
 * buildProposedSurface; absent ⇒ every code path below is byte-for-byte the pre-existing engine):
 *   • the building pad is FLAT at its FFE;
 *   • the truck court (and a dock-chain trailer row, which CONTINUES the court's plane) starts at
 *     FFE − dock drop on the dock face and FALLS AWAY from the building at the pavement slope
 *     (default 1.5%, user-set, never below 0.5%);
 *   • every other paved element attached to a building (car rows, a wall trailer row) starts at
 *     FFE − 0.5′ at its curb and falls away at the pavement slope;
 *   • where two paved elements meet the HIGHER one RAMPS down to the lower at the grading slope (no
 *     vertical step; the dock wall — pad ↔ court — is the one exempt wall);
 *   • off every graded edge the ground holds that edge's elevation for a 5′ SHOULDER, then slopes at the
 *     grading slope (2:1 default) until it daylights on existing ground;
 *   • graded cells outside the SETBACK polygon are counted and located (`grid.outside`) — the flag.
 * Access and drive grading are out of scope; volumes are bank volumes (no shrink/swell).
 *
 * ROUND 4 (B2349120/B2349121, 2026-10-19 — "the calcs seemed awfully rectangular"): with `grading.limit` present the
 * engine grades the site as ONE PAD inside a GRADING LIMIT (lib/gradingLimit.js — the rounded union of every graded
 * element, clipped to the setback, or the setback itself in "boundary" mode) — `limitGridSteps` below:
 *   • inside the limit there is ONE stitched surface: the pad flat at FFE, each paved element on its plane, adjacent
 *     paved planes MEETING by sharing their common edge elevation (the lower wins; the higher plane bends toward it
 *     within its own extent — never a seam ramp), the open ground between elements (aisles, islands, the strip to the
 *     limit) interpolated between the planes it touches; in "boundary" mode the open ground is the PLATEAU, flat at the
 *     FFE, bounded by the Level-ground sweep's own mask at that finish (buildableGround.js — reused, never rewritten);
 *   • the daylight slope is thrown from the LIMIT only — never from an element edge inside it — cut or fill as the
 *     ground dictates, so the slope bends with the outline; `daylight` is one ring per limit region;
 *   • earthwork = proposed − existing over the whole limit plus the slope bands; every cell carries `regionId`, the
 *     slope cells belong to `limit:<k>` and the open ground to `infill:<k>`, and `grid.gradedIds` names them all so the
 *     balance, the FFE suggestion and the flag run over the WHOLE graded area.
 * Without `grading.limit` every path below is byte-for-byte the round-2 engine.
 *
 * Pure, Node-testable, no DOM. Feet everywhere; elevations ft NAVD88. Screening only —
 * confirm final grading with your civil engineer. */
import { pointInRing } from "./pondGeom.js";

/* Run a step generator to completion, synchronously. Its return value is the answer. */
export function drainSteps(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}
import { GRADING_RULES, gradingRuleFor, validateSlopeAgainstRule } from "./gradingRules.js";
import { resolveGradingLimit, unionRings, maskRegions, pointInRegions, regionsAreaSf, ringHash as limitRingHash } from "./gradingLimit.js";
import { buildLattice, prepareSweep, cachedMaskAt, CELL_FT as SWEEP_CELL_FT, DEFAULT_MAX_DEPTH_FT } from "./buildableGround.js";

export const TIE_DROP_FT = 0.15;   // threshold tie: paving meets the doors just below slab FF
export const DOCK_BREAK_FT = 0.75; // adjoining-pavement step at a court edge a truck can't cross
export const PL_FILL_EPS_FT = 0.05; // a cell counts as "fill" for the PL checks past this depth
const CF_PER_CY = 27;
const clamp01 = (t) => Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));

/* ---- small pure geometry (local on purpose — no planner imports) ---- */
const ringBBox = (ring) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ring) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return [x0, y0, x1, y1];
};
const ringCentroid = (ring) => {
  let x = 0, y = 0;
  for (const p of ring) { x += p.x; y += p.y; }
  return { x: x / ring.length, y: y / ring.length };
};
const norm = (dx, dy) => {
  const L = Math.hypot(dx, dy);
  return L > 1e-9 ? { x: dx / L, y: dy / L } : { x: 1, y: 0 }; // degenerate → east (deterministic)
};
// Nearest point ON a ring's edges to `pt` (segment projection — a rect court's nearest
// point to its host building centroid is the dock-FACE midpoint, never just a corner).
export function nearestOnRing(pt, ring) {
  let best = null, bd = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 === 0 ? 0 : ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const q = { x: a.x + t * dx, y: a.y + t * dy };
    const d = Math.hypot(pt.x - q.x, pt.y - q.y);
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}
// Distance from a point to the nearest edge of ANY ring in the list (the PL tie check).
export function distToRingEdges(pt, rings) {
  let best = Infinity;
  for (const ring of rings) {
    const q = nearestOnRing(pt, ring);
    if (q) { const d = Math.hypot(pt.x - q.x, pt.y - q.y); if (d < best) best = d; }
  }
  return best;
}
// Position-sensitive ring checksum (the SitePlanner _mitMemo idiom) for surfaceKey.
const ringHash = (ring) => {
  let h = 0;
  for (let i = 0; i < ring.length; i++) h += (ring[i].x * 7 + ring[i].y * 3) * (i + 1);
  return Math.round(h);
};

/* ---- grading-model helpers (owner-only; see header) ---- */
export const GRADING_DEFAULTS = Object.freeze({
  pavementSlopePct: 1.5, minPavementSlopePct: 0.5, lotDropFt: 0.5,
  slopeRatio: 2, shoulderFt: 5, apronSampleFt: 20, maxCells: 9000,
});
// Unit outward normal of a ring edge (away from the ring's centroid), for either winding.
function outwardNormal(a, b, c) {
  let n = norm(-(b.y - a.y), b.x - a.x);
  if (n.x * (c.x - (a.x + b.x) / 2) + n.y * (c.y - (a.y + b.y) / 2) > 0) n = { x: -n.x, y: -n.y };
  return n;
}
/* The host-building WALL an element sits against: the edge whose outward normal best matches the
 * direction from the host's centroid to the element's centroid. Returns { A (a point on the wall line),
 * n (unit outward normal), t (unit tangent along the wall) }. Depth of a point off the wall is
 * (pt − A)·n, so a court and the trailer row stacked beyond it share ONE plane by construction. Pure. */
export function wallFor(hostRing, elCentre) {
  const hc = ringCentroid(hostRing);
  const u = norm(elCentre.x - hc.x, elCentre.y - hc.y);
  let best = null, bs = -Infinity;
  for (let i = 0; i < hostRing.length; i++) {
    const a = hostRing[i], b = hostRing[(i + 1) % hostRing.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
    const n = outwardNormal(a, b, hc);
    const sc = n.x * u.x + n.y * u.y;
    if (sc > bs) { bs = sc; best = { A: a, n, t: { x: -n.y, y: n.x } }; }
  }
  return best;
}
/* The B833 wedge's elevation drop at distance `od` past an edge held at `zEdge` over ground `g0`:
 * flat for the shoulder, then `ratio` ft of run per foot of rise until it daylights. Returns dz
 * (proposed − existing, + fill / − cut). shoulder 0 ⇒ the original B833 taper, exactly. */
export function wedgeDz(zEdge, g0, od, ratio, shoulder = 0) {
  const delta = zEdge - g0;
  const taper = od <= shoulder ? 0 : (od - shoulder) / ratio;
  return Math.abs(delta) <= taper ? 0 : delta > 0 ? delta - taper : delta + taper;
}

/* ---- classing ---- */
/* Element → surface class. Input is the PREPARED element (see buildPlanes):
 * dockStack truthy = a truckCourt/forCourt dock-stack member (any type). Unknown /
 * ungraded types → honest null (landscape, roads, ponds are not planes here). Pure. */
export function classifyGradeElement(el) {
  if (!el) return null;
  if (el.type === "building") return "buildingPad";
  if (el.dockStack) return "dockApron";
  if (el.type === "trailer") return "trailerParking";
  if (el.type === "parking") return el.accessible ? "carParkingAccessible" : "carParkingGeneral";
  if (el.type === "paving") return "driveAisles";
  return null;
}

// Class slope band in percent. A class without a published min inherits the paved
// drainage floor (pavedMinimum, 1.0%); without a cap, the cap = max(min, 5) so a band
// always exists for the fieldT sweep. Pads are pinned flat.
export function slopeBand(classId, rule) {
  if (classId === "buildingPad") return { min: 0, max: 0 };
  const min = rule && rule.minSlopePct != null ? rule.minSlopePct : GRADING_RULES.pavedMinimum.minSlopePct;
  const max = rule && rule.maxSlopePct != null ? rule.maxSlopePct : Math.max(min, 5);
  return { min, max };
}

/* ---- planes ----
 * els: prepared elements —
 *   { id, type, ring, dockStack: {x,y}|null (host building centroid),
 *     accessible?, slopeOverridePct?, padElevFt? }
 * Returns { planes: Map(id → plane), skipped: [ids with no derivable elevation] }.
 * plane: { elId, classId, label, baseElevFt, anchor, dir, slopePct, floating,
 *          check (validateSlopeAgainstRule vs the BASE rule), zAt(pt) }. Pure. */
export function buildPlanes({ els = [], ffeFt = null, dockDropFt = 4, tieDropFt = TIE_DROP_FT, fieldT = 0, drainTarget = null, daylightAsap = false, grading = null } = {}) {
  const planes = new Map();
  const byIdEl = grading ? new Map(els.filter((e) => e && e.id != null).map((e) => [e.id, e])) : null;
  const pavSlopeG = grading ? Math.max(GRADING_DEFAULTS.minPavementSlopePct, Number.isFinite(grading.pavementSlopePct) ? grading.pavementSlopePct : GRADING_DEFAULTS.pavementSlopePct) : 0;
  const lotDropG = grading && Number.isFinite(grading.lotDropFt) ? grading.lotDropFt : GRADING_DEFAULTS.lotDropFt;
  const skipped = [];
  const t = clamp01(fieldT);
  const drop = Number.isFinite(dockDropFt) ? dockDropFt : 4;
  const buildingCentroids = els
    .filter((e) => e && e.type === "building" && Array.isArray(e.ring) && e.ring.length >= 3)
    .map((e) => ringCentroid(e.ring));
  const nearestBuilding = (pt) => {
    let best = null, bd = Infinity;
    for (const c of buildingCentroids) {
      const d = Math.hypot(pt.x - c.x, pt.y - c.y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  };
  for (const el of els) {
    if (!el || !Array.isArray(el.ring) || el.ring.length < 3) continue;
    const classId = classifyGradeElement(el);
    if (!classId) continue;
    const baseRule = GRADING_RULES[classId] || null;
    const hasOverride = el.slopeOverridePct != null && isFinite(el.slopeOverridePct);
    // An override pins the plane's slope (min = max); provenance stays the base rule's.
    const rule = gradingRuleFor(classId, hasOverride ? { minSlopePct: el.slopeOverridePct, maxSlopePct: el.slopeOverridePct } : null);
    const band = slopeBand(classId, rule);
    const elPad = el.padElevFt != null && isFinite(el.padElevFt) ? el.padElevFt : null;
    const c = ringCentroid(el.ring);
    let baseElevFt = null, anchor = c, dir = { x: 1, y: 0 }, slopePct = 0, floating = false;
    // GRADING MODEL — a paved layer attached to a host building: planes measured off the host's WALL.
    const gHost = grading && classId !== "buildingPad" && el.hostId != null ? byIdEl.get(el.hostId) : null;
    const gHostRing = gHost && gHost.type === "building" && Array.isArray(gHost.ring) && gHost.ring.length >= 3 ? gHost.ring : null;
    if (gHostRing) {
      const hostFfe = gHost.padElevFt != null && isFinite(gHost.padElevFt) ? gHost.padElevFt : ffeFt;
      const wall = wallFor(gHostRing, c);
      const isDock = classId === "dockApron";
      slopePct = hasOverride ? el.slopeOverridePct : pavSlopeG;
      let d0 = 0;
      if (!isDock) { d0 = Infinity; for (const v of el.ring) d0 = Math.min(d0, (v.x - wall.A.x) * wall.n.x + (v.y - wall.A.y) * wall.n.y); }
      baseElevFt = elPad ?? (hostFfe != null && isFinite(hostFfe) ? hostFfe - (isDock ? drop : lotDropG) : null);
      if (baseElevFt == null || !isFinite(baseElevFt)) { skipped.push(el.id); continue; }
      const sG = slopePct / 100, z0G = baseElevFt, Ax = wall.A.x, Ay = wall.A.y, nx = wall.n.x, ny = wall.n.y, d0G = d0;
      planes.set(el.id, {
        elId: el.id, classId, label: baseRule ? baseRule.label : classId,
        baseElevFt, anchor: wall.A, dir: wall.n, slopePct, floating: false,
        wall: { A: wall.A, n: wall.n, t: wall.t, d0 }, hostId: gHost.id, graded: true,
        check: validateSlopeAgainstRule(slopePct, baseRule),
        zAt: (pt) => z0G - sG * ((pt.x - Ax) * nx + (pt.y - Ay) * ny - d0G),
      });
      continue;
    }
    if (classId === "buildingPad") {
      baseElevFt = elPad ?? ffeFt;
    } else if (classId === "dockApron") {
      baseElevFt = elPad ?? (ffeFt != null ? ffeFt - drop : null);
      const host = el.dockStack && isFinite(el.dockStack.x) ? el.dockStack : null;
      anchor = host ? (nearestOnRing(host, el.ring) || c) : c;
      dir = host ? norm(c.x - host.x, c.y - host.y) : { x: 1, y: 0 };
      // Dock courts don't ride the balance sweep — trucks want the flattest legal apron.
      slopePct = hasOverride ? el.slopeOverridePct : band.min;
    } else {
      baseElevFt = elPad ?? (ffeFt != null ? ffeFt - tieDropFt : null);
      floating = true;
      const b = nearestBuilding(c);
      anchor = b ? (nearestOnRing(b, el.ring) || c) : c;
      dir = drainTarget && isFinite(drainTarget.x)
        ? norm(drainTarget.x - anchor.x, drainTarget.y - anchor.y)
        : b ? norm(c.x - b.x, c.y - b.y) : { x: 1, y: 0 };
      // B833(b) — "daylight ASAP": the field falls toward the drainage target at its
      // class CEILING (the steepest maintainable rate), so the surface gets down to
      // existing ground sooner and the transition wedge past the edge starts lower
      // and daylights earlier. An explicit slope override still wins; the balance
      // sweep (fieldT) has nothing left to vary while this is on.
      slopePct = hasOverride ? el.slopeOverridePct : daylightAsap ? band.max : band.min + t * (band.max - band.min);
    }
    if (baseElevFt == null || !isFinite(baseElevFt)) { skipped.push(el.id); continue; }
    const ax = anchor.x, ay = anchor.y, dx = dir.x, dy = dir.y, s = slopePct / 100, z0 = baseElevFt;
    planes.set(el.id, {
      elId: el.id, classId, label: baseRule ? baseRule.label : classId,
      baseElevFt, anchor, dir, slopePct, floating,
      // Legality/screening judged vs the BASE registry rule — an override moves the
      // plane, never the limit (a 3% "accessible" override must still trip ADA).
      check: validateSlopeAgainstRule(slopePct, baseRule),
      zAt: (pt) => z0 - s * ((pt.x - ax) * dx + (pt.y - ay) * dy),
    });
  }
  return { planes, skipped };
}

/* ---- composite grid ----
 * Adaptive lattice over the graded elements' bbox (the gridIntersect idiom): cell-center
 * sampling, coverage precedence building → dock stack → the rest (a pad wins an
 * overlapping court sliver), pond interiors EXCLUDED (pond dirt is the excavation
 * ledger's — counting it here would double-price the borrow). existAt(pt)→ft|null:
 * null = DEM void — the cell is retained as UNKNOWN geography (dzFt null), counted,
 * and NEVER priced as zero. cutCy/fillCy are null (honest UNKNOWN) when nothing
 * priced. Retained cells: { x, y, wFt, hFt, dzFt (+fill/−cut | null), elId, cls }.
 * Also accumulates the PL fill checks and the dock-approach break scan. Pure. */
export function surfaceGrid(args) { return drainSteps(surfaceGridSteps(args)); }
/* The same lattice as a GENERATOR (problem report 6cea9895): one `yield` per lattice column and per graded element's
 * apron sampling, so a caller off the render path (runChunked, the owner-only grading layer) can hand the main thread
 * back between columns. `surfaceGrid` drains it synchronously — the ONE implementation, byte-identical results. */
export function* surfaceGridSteps({ planes, els = [], existAt = null, parcelRings = [], pondRings = [], easementRings = [], opts = {} } = {}) {
  const inAnyRing = (pt, rings) => { for (const r of rings) if (pointInRing(pt, r)) return true; return false; };
  const maxCells = opts.maxCells || 3000;
  const minCellFt = opts.minCellFt || 2;
  const prec = (el) => (el.type === "building" ? 0 : el.dockStack ? 1 : 2);
  const graded = els
    .filter((e) => e && planes.has(e.id) && Array.isArray(e.ring) && e.ring.length >= 3)
    .map((e) => ({ el: e, plane: planes.get(e.id), bbox: ringBBox(e.ring) }))
    .sort((a, b) => prec(a.el) - prec(b.el));
  if (!graded.length) return null;
  // B833(a) — transition aprons: past every graded edge the ground doesn't teleport
  // to existing grade — fill (or cut) continues as a daylight wedge at the tie ratio
  // (landscapeTieDown: 3:1 max, 4:1 preferred/mowable via opts.apronRatio). Each
  // element's apron REACH = its worst edge |Δz| × ratio (sampled at ring vertices +
  // edge midpoints; DEM voids skipped). No ground sampler → no aprons (nothing to
  // daylight against — the grid prices nothing anyway).
  // GRADING MODEL (owner-only): the slope ratio IS the apron ratio, the slope holds a SHOULDER first, paved
  // neighbours RAMP, and graded cells outside the setback are located. `G` absent ⇒ none of it runs.
  const G = opts.grading || null;
  const gShoulder = G ? (Number.isFinite(G.shoulderFt) ? Math.max(0, G.shoulderFt) : GRADING_DEFAULTS.shoulderFt) : 0;
  const apronRatio = G
    ? (Number.isFinite(G.slopeRatio) && G.slopeRatio > 0 ? G.slopeRatio : GRADING_DEFAULTS.slopeRatio)
    : Number.isFinite(opts.apronRatio) && opts.apronRatio > 0 ? opts.apronRatio : GRADING_RULES.landscapeTieDown.maxSlopeRatio;
  const apronsOn = opts.aprons !== false && typeof existAt === "function";
  const APRON_MAX_FT = 200; // sanity clamp — a >66 ft drop is not a screening wedge
  // ROUND 4 — one pad inside a grading limit: a different lattice (below). Everything after this line is the round-2 engine.
  if (G && G.limit) return yield* limitGridSteps({ graded, existAt, parcelRings, pondRings, easementRings, opts, G, apronRatio, maxCells, minCellFt, inAnyRing });
  // Paved neighbours ramp: a paved cell is held to  min(own plane, zNeighbour(edge) + distance/ratio)  so the
  // HIGHER of two meeting surfaces ramps down to the lower at the grading slope. The building pad never
  // ramps (the dock wall — and the curb at a lot — are walls by design).
  const paved = G && G.ramp !== false ? graded.filter((g) => g.plane.classId !== "buildingPad") : [];
  const rampOn = paved.length > 1;
  let rampR = 0;
  if (rampOn) {
    let lo = Infinity, hi = -Infinity;
    for (const g of paved) for (const v of g.el.ring) { const z = g.plane.zAt(v); if (z < lo) lo = z; if (z > hi) hi = z; }
    rampR = Math.min(400, (hi - lo) * apronRatio + 10);
  }
  const zOf = !rampOn ? (g, pt) => g.plane.zAt(pt) : (g, pt) => {
    let z = g.plane.zAt(pt);
    if (g.plane.classId === "buildingPad") return z;
    for (const h of paved) {
      if (h === g) continue;
      if (pt.x < h.bbox[0] - rampR || pt.x > h.bbox[2] + rampR || pt.y < h.bbox[1] - rampR || pt.y > h.bbox[3] + rampR) continue;
      const q = nearestOnRing(pt, h.el.ring);
      if (!q) continue;
      const zl = h.plane.zAt(q) + Math.hypot(pt.x - q.x, pt.y - q.y) / apronRatio;
      if (zl < z) z = zl;
    }
    return z;
  };
  const sampleFt = G ? (Number.isFinite(G.apronSampleFt) ? G.apronSampleFt : GRADING_DEFAULTS.apronSampleFt) : 0;
  for (const g of graded) {
    yield;
    let reach = 0;
    if (apronsOn) {
      const ring = g.el.ring;
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i], b = ring[(i + 1) % ring.length];
        let pts;
        if (sampleFt > 0) {
          const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(2, Math.min(60, Math.ceil(len / sampleFt)));
          pts = []; for (let k = 0; k < steps; k++) pts.push({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps });
        } else pts = [a, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }];
        for (const p of pts) {
          const gz = existAt(p);
          if (gz == null || !isFinite(gz)) continue;
          const r = Math.abs(zOf(g, p) - gz) * apronRatio;
          if (r > reach) reach = r;
        }
      }
      if (G && reach > 0) reach += gShoulder;
    }
    g.apron = Math.min(APRON_MAX_FT, reach);
  }
  const sbRings = G && Array.isArray(G.setbackRings) && G.setbackRings.length ? G.setbackRings : null;
  const outAgg = sbRings ? { count: 0, sf: 0, maxPastFt: 0, sx: 0, sy: 0, beyondParcel: 0, cutSf: 0, fillSf: 0, perEl: {} } : null;
  const noteOut = (pt, A, dz, elId, cell) => {
    if (!outAgg || inAnyRing(pt, sbRings)) return;
    const past = distToRingEdges(pt, sbRings) + Math.sqrt(A) / 2;
    cell.out = true; cell.pastFt = past;
    outAgg.count++; outAgg.sf += A; outAgg.sx += pt.x; outAgg.sy += pt.y;
    if (past > outAgg.maxPastFt) outAgg.maxPastFt = past;
    if (dz != null && dz > PL_FILL_EPS_FT) outAgg.fillSf += A; else if (dz != null && dz < -PL_FILL_EPS_FT) outAgg.cutSf += A;
    if (parcelRings.length && !inAnyRing(pt, parcelRings)) outAgg.beyondParcel++;
    const pe = outAgg.perEl[elId] || (outAgg.perEl[elId] = { count: 0, sf: 0, maxPastFt: 0, sx: 0, sy: 0, fillSf: 0, cutSf: 0 });
    pe.count++; pe.sf += A; pe.sx += pt.x; pe.sy += pt.y;
    if (past > pe.maxPastFt) pe.maxPastFt = past;
    if (dz != null && dz > PL_FILL_EPS_FT) pe.fillSf += A; else if (dz != null && dz < -PL_FILL_EPS_FT) pe.cutSf += A;
  };
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of graded) {
    if (g.bbox[0] - g.apron < x0) x0 = g.bbox[0] - g.apron; if (g.bbox[1] - g.apron < y0) y0 = g.bbox[1] - g.apron;
    if (g.bbox[2] + g.apron > x1) x1 = g.bbox[2] + g.apron; if (g.bbox[3] + g.apron > y1) y1 = g.bbox[3] + g.apron;
  }
  const w = x1 - x0, h = y1 - y0;
  if (!(w > 0) || !(h > 0)) return null;
  const cell = Math.max(minCellFt, Math.sqrt((w * h) / maxCells));
  const nx = Math.max(1, Math.ceil(w / cell)), ny = Math.max(1, Math.ceil(h / cell));
  const dx = w / nx, dy = h / ny, A = dx * dy;
  const tieRatio = GRADING_RULES.landscapeTieDown.maxSlopeRatio; // 3:1 — the PL tie check
  const cells = [];
  const idx = new Array(nx * ny).fill(null); // {elId, cls, prop} per lattice slot (break scan)
  let cutCf = 0, fillCf = 0, gradedSf = 0, pricedCells = 0, voidCells = 0;
  let floatAreaSf = 0, floatPropSum = 0;
  let plFillSf = 0, tieShortSf = 0;
  let wedgeFillCf = 0, wedgeCutCf = 0, wedgeSf = 0, wedgeEasementSf = 0;
  const perEl = {};
  for (let i = 0; i < nx; i++) {
    yield;
    for (let j = 0; j < ny; j++) {
      const pt = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      let hit = null;
      for (const g of graded) {
        if (pt.x < g.bbox[0] || pt.x > g.bbox[2] || pt.y < g.bbox[1] || pt.y > g.bbox[3]) continue;
        if (pointInRing(pt, g.el.ring)) { hit = g; break; }
      }
      if (!hit) {
        if (!apronsOn) continue;
        // B833(a) — a cell outside every footprint may sit in a transition wedge: the
        // nearest graded edge within its apron reach owns it; the edge-vs-ground delta
        // tapers toward zero at the tie ratio and DAYLIGHTS where they meet (dz → 0).
        // Fill and cut transitions both taper (the fill fringe is the mitigable one).
        let own = null, od = Infinity, oq = null;
        for (const g of graded) {
          if (!(g.apron > 0)) continue;
          if (pt.x < g.bbox[0] - g.apron || pt.x > g.bbox[2] + g.apron || pt.y < g.bbox[1] - g.apron || pt.y > g.bbox[3] + g.apron) continue;
          const q = nearestOnRing(pt, g.el.ring);
          if (!q) continue;
          const d = Math.hypot(pt.x - q.x, pt.y - q.y);
          if (d <= g.apron && d < od) { od = d; own = g; oq = q; }
        }
        if (!own) continue;
        if (inAnyRing(pt, pondRings)) continue; // pond dirt is the excavation ledger's
        const g0 = existAt(pt);
        if (g0 == null || !isFinite(g0)) {
          // DEM void inside a possible wedge: honest unknown fringe — retained, never priced.
          voidCells++;
          cells.push({ x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: null, elId: own.el.id, cls: "transition", wedge: true });
          continue;
        }
        const dz = wedgeDz(zOf(own, oq), g0, od, apronRatio, gShoulder);
        if (Math.abs(dz) < PL_FILL_EPS_FT) continue; // at/past the daylight line
        wedgeSf += A;
        pricedCells++;
        const wcell = { x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: dz, propFt: g0 + dz, gFt: g0, elId: own.el.id, cls: "transition", wedge: true };
        noteOut(pt, A, dz, own.el.id, wcell);
        cells.push(wcell);
        const pw = perEl[own.el.id] || (perEl[own.el.id] = { cutCf: 0, fillCf: 0 });
        if (dz > 0) { fillCf += A * dz; wedgeFillCf += A * dz; pw.fillCf += A * dz; }
        else { cutCf += A * -dz; wedgeCutCf += A * -dz; pw.cutCf += A * -dz; }
        if (dz > PL_FILL_EPS_FT) {
          // The wedge is real fill: the same no-fill-past-the-PL rule applies, and a
          // wedge reaching into a drawn easement gets its own violation (B833 d).
          if (parcelRings.length && !inAnyRing(pt, parcelRings)) plFillSf += A;
          if (easementRings.length && inAnyRing(pt, easementRings)) wedgeEasementSf += A;
        }
        continue;
      }
      let inPond = false;
      for (const pr of pondRings) if (pointInRing(pt, pr)) { inPond = true; break; }
      if (inPond) continue;
      gradedSf += A;
      const prop = zOf(hit, pt);
      const g0 = existAt ? existAt(pt) : null;
      const dz = g0 == null || !isFinite(g0) ? null : prop - g0;
      idx[i * ny + j] = { elId: hit.el.id, cls: hit.plane.classId, prop };
      const fcell = { x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: dz, elId: hit.el.id, cls: hit.plane.classId };
      if (G) fcell.propFt = prop;
      noteOut(pt, A, dz, hit.el.id, fcell);
      cells.push(fcell);
      if (hit.plane.floating) { floatAreaSf += A; floatPropSum += prop * A; }
      if (dz == null) { voidCells++; continue; }
      pricedCells++;
      const pe = perEl[hit.el.id] || (perEl[hit.el.id] = { cutCf: 0, fillCf: 0 });
      if (dz > 0) { fillCf += A * dz; pe.fillCf += A * dz; } else { cutCf += A * -dz; pe.cutCf += A * -dz; }
      // PL checks — fill only: fill across the property line is prohibited outright;
      // fill NEAR it must still fit a 3:1 landscape tie-down inside the parcel.
      if (dz > PL_FILL_EPS_FT && parcelRings.length) {
        let inParcel = false;
        for (const pr of parcelRings) if (pointInRing(pt, pr)) { inParcel = true; break; }
        if (!inParcel) plFillSf += A;
        else if (distToRingEdges(pt, parcelRings) < tieRatio * dz) tieShortSf += A;
      }
    }
  }
  // Dock-approach break scan: adjoining PAVEMENT stepping at a court edge. The dock
  // WALL itself (pad ↔ court, −dockDrop) is by design — buildingPad pairs are exempt.
  let breakCount = 0, maxBreakFt = 0;
  // GRADING MODEL: paved neighbours RAMP at the grading slope by design — a ramp cell-to-cell step is the
  // model working, not a dock-approach defect, so the scan only runs on the pre-existing engine.
  if (!G) for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const a = idx[i * ny + j];
      if (!a) continue;
      for (const [ni, nj] of [[i + 1, j], [i, j + 1]]) {
        if (ni >= nx || nj >= ny) continue;
        const b = idx[ni * ny + nj];
        if (!b || b.elId === a.elId) continue;
        if (a.cls === "buildingPad" || b.cls === "buildingPad") continue;
        if (a.cls !== "dockApron" && b.cls !== "dockApron") continue;
        const step = Math.abs(a.prop - b.prop);
        if (step > DOCK_BREAK_FT) { breakCount++; if (step > maxBreakFt) maxBreakFt = step; }
      }
    }
  }
  const priced = pricedCells > 0;
  return {
    cells,
    // NEW-2(e) — the ownership set the lattice priced off, kept so a POINT can be sampled
    // through exactly the same precedence, planes and apron reaches. The map readout and
    // the earthwork rows therefore cannot disagree: they read one array.
    owners: graded, pondRings, apronsOn,
    // GRADING MODEL: the SAME elevation function the lattice priced with, so a point readout / spot
    // elevation can never disagree with the tiles (and the wedge shoulder rides along).
    zOf, shoulderFt: gShoulder, grading: G ? { slopeRatio: apronRatio, shoulderFt: gShoulder, ramp: rampOn } : null,
    outside: outAgg ? {
      count: outAgg.count, sf: outAgg.sf, maxPastFt: outAgg.maxPastFt,
      centroid: outAgg.count ? { x: outAgg.sx / outAgg.count, y: outAgg.sy / outAgg.count } : null,
      beyondParcel: outAgg.beyondParcel, cutSf: outAgg.cutSf, fillSf: outAgg.fillSf,
      perEl: Object.fromEntries(Object.entries(outAgg.perEl).map(([k, v]) => [k, { count: v.count, sf: v.sf, maxPastFt: v.maxPastFt, centroid: { x: v.sx / v.count, y: v.sy / v.count }, fillSf: v.fillSf, cutSf: v.cutSf }])),
    } : null,
    gradedSf,
    pricedCells, voidCells,
    cutCf: priced ? cutCf : null, fillCf: priced ? fillCf : null,
    cutCy: priced ? cutCf / CF_PER_CY : null, fillCy: priced ? fillCf / CF_PER_CY : null,
    perEl,
    floatAreaSf, floatPropSum,
    plFillSf, tieShortSf,
    // B833 — the transition-wedge share of the totals (already INSIDE cutCf/fillCf;
    // broken out so the rows and the mitigation delta can name it).
    wedgeFillCf, wedgeCutCf, wedgeSf, wedgeEasementSf,
    wedgeFillCy: wedgeFillCf / CF_PER_CY, wedgeCutCy: wedgeCutCf / CF_PER_CY,
    apronRatio,
    dockBreaks: { count: breakCount, maxFt: maxBreakFt },
  };
}

/* ============================ ROUND 4 — the stitched surface inside the grading limit ============================ */

const SEAM_SAMPLE_FT = 5;       // how often an element's edge is sampled for a neighbour
const SEAM_TOUCH_FT = 1.0;      // two paved rings closer than this share an edge
const SEAM_MIN_DROP_FT = 0.05;  // a seam flatter than this is the same plane (a dock chain's court + trailer row)
const IDW_K = 4;
const LIMIT_SAMPLE_FT = 10;     // the limit ring is sampled this often for the slope reach + the daylight line
const REACH_MAX_FT = 400;

const bboxOfRings = (rings) => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (const p of r) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  return [x0, y0, x1, y1];
};
const sampleRing = (ring, stepFt) => {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.min(200, Math.ceil(len / stepFt)));
    for (let k = 0; k < steps; k++) out.push({ x: a.x + (b.x - a.x) * k / steps, y: a.y + (b.y - a.y) * k / steps, a, b });
  }
  return out;
};
/* Nearest point on any ring of the regions (outers + holes) → { q, d, k (region index) }. */
function nearestOnRegions(pt, regions) {
  let best = null;
  regions.forEach((r, k) => {
    for (const ring of [r.outer, ...r.holes]) {
      const q = nearestOnRing(pt, ring);
      if (!q) continue;
      const d = Math.hypot(pt.x - q.x, pt.y - q.y);
      if (!best || d < best.d) best = { q, d, k };
    }
  });
  return best;
}
function regionIndexOf(pt, regions) {
  for (let k = 0; k < regions.length; k++) if (pointInRegions(pt, [regions[k]])) return k;
  return -1;
}

/* The SEAMS between paved planes: where element E's ring runs along N's ring and N is LOWER there, E bends down to N's
 * edge elevation within its own extent. Returns Map(elId → [{ pt, delta (≤ 0), L, nId }]) plus the seam-step violations
 * (a bend that would push E past the max pavement slope needs a curb/wall of `stepFt`). */
export function buildSeams(graded, { maxPavementSlopePct = 5 } = {}) {
  const seams = new Map();
  const steps = [];
  const paved = graded.filter((g) => g.plane.classId !== "buildingPad");
  for (const E of paved) {
    const samples = sampleRing(E.el.ring, SEAM_SAMPLE_FT);
    const c = ringCentroid(E.el.ring);
    const mine = [];
    const worstBy = new Map();
    for (const N of paved) {
      if (N === E) continue;
      if (E.bbox[0] > N.bbox[2] + SEAM_TOUCH_FT || N.bbox[0] > E.bbox[2] + SEAM_TOUCH_FT || E.bbox[1] > N.bbox[3] + SEAM_TOUCH_FT || N.bbox[1] > E.bbox[3] + SEAM_TOUCH_FT) continue;
      for (const s of samples) {
        const q = nearestOnRing(s, N.el.ring);
        if (!q || Math.hypot(s.x - q.x, s.y - q.y) > SEAM_TOUCH_FT) continue;
        // the edge must RUN ALONG N's ring, not merely touch it at a corner: a point a few feet either way along the
        // same edge has to be on N's ring too (a lot's wall edge meeting the court's corner is not a seam)
        const ex = s.b.x - s.a.x, ey = s.b.y - s.a.y, eL = Math.hypot(ex, ey) || 1, ux = ex / eL, uy = ey / eL;
        const along = [{ x: s.x + ux * 2.5, y: s.y + uy * 2.5 }, { x: s.x - ux * 2.5, y: s.y - uy * 2.5 }].filter((p) => { const qq = nearestOnRing(p, N.el.ring); return qq && Math.hypot(p.x - qq.x, p.y - qq.y) <= SEAM_TOUCH_FT; });
        if (along.length < 2) continue;
        const zE = E.plane.zAt(s), zN = N.plane.zAt(q);
        const delta = zN - zE;
        if (!(delta < -SEAM_MIN_DROP_FT)) continue;                 // N is not lower here: E keeps its plane
        // E's extent through s, along the inward normal of this edge
        let n = outwardNormal(s.a, s.b, c);
        n = { x: -n.x, y: -n.y };
        let L = 0;
        for (const v of E.el.ring) { const t = (v.x - s.x) * n.x + (v.y - s.y) * n.y; if (t > L) L = t; }
        if (!(L > 1)) continue;
        mine.push({ pt: { x: s.x, y: s.y }, delta, L, nId: N.el.id });
        const need = E.plane.slopePct / 100 + (-delta) / L;         // conservative: the bend adds to the plane's own fall
        const over = need - maxPavementSlopePct / 100;
        if (over > 1e-9) {
          const stepFt = -delta - Math.max(0, maxPavementSlopePct / 100 - E.plane.slopePct / 100) * L;
          const w = worstBy.get(N.el.id);
          if (!w || stepFt > w.stepFt) worstBy.set(N.el.id, { stepFt, needPct: need * 100 });
        }
      }
    }
    if (mine.length) seams.set(E.el.id, mine);
    for (const [nId, w] of worstBy) steps.push({ elId: E.el.id, nId, stepFt: Math.max(0.1, Math.round(w.stepFt * 10) / 10), needPct: w.needPct });
  }
  return { seams, steps };
}

/* The sweep lattice + context for boundary mode, cached by the ground's own key (the FFE search rebuilds dozens of
 * surfaces over unchanged ground). */
const sweepCache = new Map();
const SWEEP_CACHE_MAX = 3;
function* sweepContextSteps({ existAt, existKey, regions }) {
  const [bx0, by0, bx1, by1] = bboxOfRings(regions.map((r) => r.outer));
  const M = 200;
  const bbox = [bx0 - M, by0 - M, bx1 + M, by1 + M];
  const key = `${existKey || "?"}|${bbox.map((v) => Math.round(v)).join(",")}|${regions.map((r) => limitRingHash(r.outer)).join(",")}|${regions.map((r) => r.holes.map(limitRingHash).join("/")).join(",")}`;
  const hit = sweepCache.get(key);
  if (hit) return hit;
  // the lattice, row by row (a 100-acre parcel is ~60k ground reads)
  const cell = SWEEP_CELL_FT;
  const x0 = Math.floor(bbox[0] / cell) * cell, y0 = Math.floor(bbox[1] / cell) * cell;
  const nx = Math.max(1, Math.ceil((bbox[2] - x0) / cell)), ny = Math.max(1, Math.ceil((bbox[3] - y0) / cell));
  const z = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    if (j % 12 === 0) yield;
    const y = y0 + (j + 0.5) * cell;
    for (let i = 0; i < nx; i++) { const v = existAt({ x: x0 + (i + 0.5) * cell, y }); z[j * nx + i] = v == null || !isFinite(v) ? NaN : v; }
  }
  const lattice = { x0, y0, nx, ny, cell, z };
  yield;
  const ctx = prepareSweep({ lattice, rings: regions.map((r) => r.outer), holes: regions.flatMap((r) => r.holes) });
  sweepCache.set(key, ctx);
  if (sweepCache.size > SWEEP_CACHE_MAX) sweepCache.delete(sweepCache.keys().next().value);
  return ctx;
}
void buildLattice;

/* The lattice for the round-4 model. `graded` = [{ el, plane, bbox }] sorted by precedence (building → dock → rest). */
function* limitGridSteps({ graded, existAt, parcelRings, pondRings, easementRings, opts, G, apronRatio, maxCells, minCellFt, inAnyRing }) {
  const spec = G.limit;
  const limit = resolveGradingLimit({
    els: graded.map((g) => ({ id: g.el.id, ring: g.el.ring, type: g.el.type })), extraRings: spec.extraRings || [],
    spec: { mode: spec.mode, shoulderFt: spec.shoulderFt ?? G.shoulderFt, cornerRadiusFt: spec.cornerRadiusFt, aisleFt: spec.aisleFt, edited: spec.edited || null,
      setbackRings: G.setbackRings || [], setbackHoles: spec.setbackHoles || [], pondRings, bufferRings: easementRings },
  });
  yield;
  const maxPav = Number.isFinite(spec.maxPavementSlopePct) ? spec.maxPavementSlopePct : 5;
  const { seams, steps: seamSteps } = buildSeams(graded, { maxPavementSlopePct: maxPav });
  yield;
  const byId = new Map(graded.map((g) => [g.el.id, g]));
  // the seam-blended elevation of element g at pt — the ONE surface inside the limit
  const zOf = (g, pt) => {
    let z = g.plane.zAt(pt);
    const mine = seams.get(g.el.id);
    if (!mine) return z;
    let bestW = 0, bestD = 0;
    for (const sm of mine) {
      const d = Math.hypot(pt.x - sm.pt.x, pt.y - sm.pt.y);
      const w = Math.max(0, 1 - d / sm.L);
      if (w * -sm.delta > bestW * -bestD) { bestW = w; bestD = sm.delta; }
    }
    return z + bestD * bestW;
  };
  const elementAt = (pt) => {
    for (const g of graded) {
      if (pt.x < g.bbox[0] || pt.x > g.bbox[2] || pt.y < g.bbox[1] || pt.y > g.bbox[3]) continue;
      if (pointInRing(pt, g.el.ring)) return g;
    }
    return null;
  };
  // boundary mode: the plateau per host building, off the Level-ground sweep at that building's finish
  let plateaus = [];
  let plateauAt = () => null;
  let srcRegions = limit.regions;
  if (limit.mode === "boundary" && limit.regions.length && typeof existAt === "function") {
    const ctx = yield* sweepContextSteps({ existAt, existKey: opts.existKey, regions: limit.regions });
    const D = Number.isFinite(spec.maxCutFillFt) && spec.maxCutFillFt > 0 ? spec.maxCutFillFt : DEFAULT_MAX_DEPTH_FT;
    const hosts = graded.filter((g) => g.plane.classId === "buildingPad" && !(g.el.hostId != null && g.el.hostId !== g.el.id));
    const masks = [];
    const unionMask = new Uint8Array(ctx.lattice.nx * ctx.lattice.ny);
    for (const h of hosts) {
      yield;
      const E = Math.round(h.plane.baseElevFt * 10) / 10;
      const r = cachedMaskAt(ctx, E, apronRatio, D);
      masks.push({ id: h.el.id, ffe: E, mask: r.mask, areaSf: r.areaSf });
      for (let k = 0; k < unionMask.length; k++) if (r.mask[k]) unionMask[k] = 1;
    }
    yield;
    const { x0, y0, nx, ny, cell } = ctx.lattice;
    const plateauRegions = maskRegions({ mask: unionMask, nx, ny, x0, y0, cell });
    plateaus = masks.map((m) => ({ id: m.id, ffe: m.ffe, areaSf: m.areaSf }));
    plateauAt = (pt) => {
      const i = Math.floor((pt.x - x0) / cell), j = Math.floor((pt.y - y0) / cell);
      if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
      const k = j * nx + i;
      for (const m of masks) if (m.mask[k]) return m.ffe;
      return null;
    };
    yield;
    srcRegions = unionRings([...plateauRegions.map((r) => r.outer), ...graded.map((g) => g.el.ring)]);
  }
  if (!srcRegions.length) return null;
  // the open ground inside the limit: the plateau in boundary mode, else inverse-distance between the planes it touches
  const infillZ = (pt) => {
    const pz = plateauAt(pt);
    if (pz != null) return pz;
    const near = [];
    for (const g of graded) {
      const q = nearestOnRing(pt, g.el.ring);
      if (!q) continue;
      const d = Math.hypot(pt.x - q.x, pt.y - q.y);
      near.push({ d, z: zOf(g, q) });
    }
    if (!near.length) return null;
    near.sort((a, b) => a.d - b.d);
    let sw = 0, sz = 0;
    for (const n of near.slice(0, IDW_K)) { const w = 1 / ((n.d + 1) * (n.d + 1)); sw += w; sz += w * n.z; }
    return sz / sw;
  };
  const insideZ = (pt) => { const g = elementAt(pt); return g ? zOf(g, pt) : infillZ(pt); };
  const insideAt = (pt) => !!elementAt(pt) || pointInRegions(pt, srcRegions);
  // the edge elevation at a point ON the limit: read a hair inside
  const edgeZ = (q, from) => {
    const dx = q.x - from.x, dy = q.y - from.y, L = Math.hypot(dx, dy) || 1;
    const z = insideZ({ x: q.x + dx / L * 0.25, y: q.y + dy / L * 0.25 });
    return z != null ? z : insideZ(q);
  };
  // the slope reach, sampled along every limit ring
  const apronsOn = opts.aprons !== false && typeof existAt === "function";
  let reach = 0;
  const edgeSamples = [];
  if (apronsOn) {
    srcRegions.forEach((r, k) => {
      const c = ringCentroid(r.outer);
      for (const ring of [r.outer, ...r.holes]) {
        for (const s of sampleRing(ring, LIMIT_SAMPLE_FT)) {
          const gz = existAt(s);
          if (gz == null || !isFinite(gz)) continue;
          const away = { x: s.x + (s.x - c.x) * 1e-3, y: s.y + (s.y - c.y) * 1e-3 };
          const ze = edgeZ(s, away);
          if (ze == null) continue;
          const dz = ze - gz;
          edgeSamples.push({ x: s.x, y: s.y, a: s.a, b: s.b, k, ring, dz, c });
          const rr = Math.abs(dz) * apronRatio;
          if (rr > reach) reach = rr;
        }
      }
    });
  }
  reach = Math.min(REACH_MAX_FT, reach);
  yield;
  const sbRings = Array.isArray(G.setbackRings) && G.setbackRings.length ? G.setbackRings : null;
  const outAgg = sbRings ? { count: 0, sf: 0, maxPastFt: 0, sx: 0, sy: 0, beyondParcel: 0, cutSf: 0, fillSf: 0, perEl: {} } : null;
  const noteOut = (pt, A, dz, elId, cell) => {
    if (!outAgg || inAnyRing(pt, sbRings)) return;
    const past = distToRingEdges(pt, sbRings) + Math.sqrt(A) / 2;
    cell.out = true; cell.pastFt = past;
    outAgg.count++; outAgg.sf += A; outAgg.sx += pt.x; outAgg.sy += pt.y;
    if (past > outAgg.maxPastFt) outAgg.maxPastFt = past;
    if (dz != null && dz > PL_FILL_EPS_FT) outAgg.fillSf += A; else if (dz != null && dz < -PL_FILL_EPS_FT) outAgg.cutSf += A;
    if (parcelRings.length && !inAnyRing(pt, parcelRings)) outAgg.beyondParcel++;
    const pe = outAgg.perEl[elId] || (outAgg.perEl[elId] = { count: 0, sf: 0, maxPastFt: 0, sx: 0, sy: 0, fillSf: 0, cutSf: 0 });
    pe.count++; pe.sf += A; pe.sx += pt.x; pe.sy += pt.y;
    if (past > pe.maxPastFt) pe.maxPastFt = past;
    if (dz != null && dz > PL_FILL_EPS_FT) pe.fillSf += A; else if (dz != null && dz < -PL_FILL_EPS_FT) pe.cutSf += A;
  };
  const [bx0, by0, bx1, by1] = bboxOfRings(srcRegions.map((r) => r.outer).concat(graded.map((g) => g.el.ring)));
  const x0 = bx0 - reach, y0 = by0 - reach, w = bx1 - bx0 + 2 * reach, h = by1 - by0 + 2 * reach;
  if (!(w > 0) || !(h > 0)) return null;
  const cellFt = Math.max(minCellFt, Math.sqrt((w * h) / maxCells));
  const nx = Math.max(1, Math.ceil(w / cellFt)), ny = Math.max(1, Math.ceil(h / cellFt));
  const dx = w / nx, dy = h / ny, A = dx * dy;
  const tieRatio = GRADING_RULES.landscapeTieDown.maxSlopeRatio;
  const cells = [];
  let cutCf = 0, fillCf = 0, gradedSf = 0, pricedCells = 0, voidCells = 0;
  let plFillSf = 0, tieShortSf = 0;
  let wedgeFillCf = 0, wedgeCutCf = 0, wedgeSf = 0, wedgeEasementSf = 0;
  const perEl = {};
  const regionStats = srcRegions.map(() => ({ cutCf: 0, fillCf: 0, areaSf: 0, slopeSf: 0 }));
  const price = (id, dz, isWedge) => {
    pricedCells++;
    const pe = perEl[id] || (perEl[id] = { cutCf: 0, fillCf: 0 });
    if (dz > 0) { fillCf += A * dz; pe.fillCf += A * dz; if (isWedge) wedgeFillCf += A * dz; }
    else { cutCf += A * -dz; pe.cutCf += A * -dz; if (isWedge) wedgeCutCf += A * -dz; }
  };
  for (let i = 0; i < nx; i++) {
    yield;
    for (let j = 0; j < ny; j++) {
      const pt = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      if (inAnyRing(pt, pondRings)) continue;                       // pond dirt is the excavation ledger's
      const hit = elementAt(pt);
      const g0 = existAt ? existAt(pt) : null;
      const gOk = g0 != null && isFinite(g0);
      if (hit) {
        const k = Math.max(0, regionIndexOf(pt, srcRegions));
        gradedSf += A; regionStats[k].areaSf += A;
        const prop = zOf(hit, pt);
        const dz = gOk ? prop - g0 : null;
        const cell = { x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: dz, propFt: prop, elId: hit.el.id, cls: hit.plane.classId, regionId: k };
        noteOut(pt, A, dz, hit.el.id, cell);
        cells.push(cell);
        if (dz == null) { voidCells++; continue; }
        price(hit.el.id, dz, false);
        regionStats[k][dz > 0 ? "fillCf" : "cutCf"] += A * Math.abs(dz);
        if (dz > PL_FILL_EPS_FT && parcelRings.length) {
          if (!inAnyRing(pt, parcelRings)) plFillSf += A;
          else if (distToRingEdges(pt, parcelRings) < tieRatio * dz) tieShortSf += A;
        }
        continue;
      }
      const k = regionIndexOf(pt, srcRegions);
      if (k >= 0) {
        // open ground inside the limit
        const prop = infillZ(pt);
        if (prop == null) continue;
        gradedSf += A; regionStats[k].areaSf += A;
        const dz = gOk ? prop - g0 : null;
        const id = `infill:${k}`;
        const cell = { x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: dz, propFt: prop, elId: id, cls: "infill", regionId: k };
        noteOut(pt, A, dz, id, cell);
        cells.push(cell);
        if (dz == null) { voidCells++; continue; }
        price(id, dz, false);
        regionStats[k][dz > 0 ? "fillCf" : "cutCf"] += A * Math.abs(dz);
        if (dz > PL_FILL_EPS_FT && parcelRings.length) {
          if (!inAnyRing(pt, parcelRings)) plFillSf += A;
          else if (distToRingEdges(pt, parcelRings) < tieRatio * dz) tieShortSf += A;
        }
        continue;
      }
      if (!apronsOn || !(reach > 0)) continue;
      // outside the limit: the daylight slope thrown FROM the limit
      const nr = nearestOnRegions(pt, srcRegions);
      if (!nr || nr.d > reach) continue;
      const id = `limit:${nr.k}`;
      if (!gOk) { voidCells++; cells.push({ x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: null, elId: id, cls: "transition", wedge: true, regionId: nr.k }); continue; }
      const ze = edgeZ(nr.q, pt);
      if (ze == null) continue;
      const dz = wedgeDz(ze, g0, nr.d, apronRatio, 0);
      if (Math.abs(dz) < PL_FILL_EPS_FT) continue;                   // at/past the daylight line
      wedgeSf += A; regionStats[nr.k].slopeSf += A;
      const cell = { x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: dz, propFt: g0 + dz, gFt: g0, elId: id, cls: "transition", wedge: true, regionId: nr.k };
      noteOut(pt, A, dz, id, cell);
      cells.push(cell);
      price(id, dz, true);
      regionStats[nr.k][dz > 0 ? "fillCf" : "cutCf"] += A * Math.abs(dz);
      if (dz > PL_FILL_EPS_FT) {
        if (parcelRings.length && !inAnyRing(pt, parcelRings)) plFillSf += A;
        if (easementRings.length && inAnyRing(pt, easementRings)) wedgeEasementSf += A;
      }
    }
  }
  // the daylight line: each limit ring sample pushed outward by |dz| × ratio — the same taper the slope cells price
  const daylight = [];
  if (edgeSamples.length) {
    const byRing = new Map();
    for (const s of edgeSamples) { let l = byRing.get(s.ring); if (!l) byRing.set(s.ring, (l = { k: s.k, pts: [] })); l.pts.push(s); }
    for (const [ring, l] of byRing) {
      const isHole = srcRegions[l.k].holes.includes(ring);
      const pts = l.pts.map((s) => {
        let n = norm(-(s.b.y - s.a.y), s.b.x - s.a.x);
        if ((n.x * (s.c.x - s.x) + n.y * (s.c.y - s.y) > 0) !== isHole) n = { x: -n.x, y: -n.y };   // away from the region
        const d = Math.min(reach, Math.abs(s.dz) * apronRatio);
        return { x: s.x + n.x * d, y: s.y + n.y * d };
      });
      if (pts.length >= 3) daylight.push({ elId: `limit:${l.k}`, ring: pts, hole: isHole });
    }
  }
  const priced = pricedCells > 0;
  const gradedIds = new Set(Object.keys(perEl));
  for (const c of cells) gradedIds.add(c.elId);
  const probe = (pt) => {
    if (inAnyRing(pt, pondRings)) return { status: "none", reason: "pond" };
    const g = elementAt(pt);
    if (g) return { status: "value", ft: zOf(g, pt), elId: g.el.id, cls: g.plane.classId, wedge: false };
    const k = regionIndexOf(pt, srcRegions);
    if (k >= 0) { const z = infillZ(pt); return z == null ? { status: "none", reason: "outside" } : { status: "value", ft: z, elId: `infill:${k}`, cls: "infill", wedge: false }; }
    if (!apronsOn) return { status: "none", reason: "outside" };
    const nr = nearestOnRegions(pt, srcRegions);
    if (!nr || nr.d > reach) return { status: "none", reason: "outside" };
    const g0 = existAt(pt);
    if (g0 == null || !isFinite(g0)) return { status: "none", reason: "void" };
    const ze = edgeZ(nr.q, pt);
    if (ze == null) return { status: "none", reason: "outside" };
    return { status: "value", ft: g0 + wedgeDz(ze, g0, nr.d, apronRatio, 0), elId: `limit:${nr.k}`, cls: "transition", wedge: true };
  };
  return {
    cells, owners: graded, pondRings, apronsOn, zOf, shoulderFt: 0,
    grading: { slopeRatio: apronRatio, shoulderFt: spec.shoulderFt ?? G.shoulderFt, ramp: false },
    limit: {
      mode: limit.mode, source: limit.source, regions: srcRegions, limitRegions: limit.regions, areaSf: regionsAreaSf(srcRegions), areaAc: regionsAreaSf(srcRegions) / 43560,
      grewIds: limit.grewIds, plateaus, reachFt: reach, shoulderFt: limit.shoulderFt, cornerRadiusFt: limit.cornerRadiusFt,
      regions_stats: regionStats.map((r) => ({ cutCy: r.cutCf / CF_PER_CY, fillCy: r.fillCf / CF_PER_CY, areaSf: r.areaSf, slopeSf: r.slopeSf })),
    },
    seams: seamSteps, gradedIds, probe, daylight,
    outside: outAgg ? {
      count: outAgg.count, sf: outAgg.sf, maxPastFt: outAgg.maxPastFt,
      centroid: outAgg.count ? { x: outAgg.sx / outAgg.count, y: outAgg.sy / outAgg.count } : null,
      beyondParcel: outAgg.beyondParcel, cutSf: outAgg.cutSf, fillSf: outAgg.fillSf,
      perEl: Object.fromEntries(Object.entries(outAgg.perEl).map(([k, v]) => [k, { count: v.count, sf: v.sf, maxPastFt: v.maxPastFt, centroid: { x: v.sx / v.count, y: v.sy / v.count }, fillSf: v.fillSf, cutSf: v.cutSf }])),
    } : null,
    gradedSf, pricedCells, voidCells,
    cutCf: priced ? cutCf : null, fillCf: priced ? fillCf : null,
    cutCy: priced ? cutCf / CF_PER_CY : null, fillCy: priced ? fillCf / CF_PER_CY : null,
    perEl, floatAreaSf: 0, floatPropSum: 0, plFillSf, tieShortSf,
    wedgeFillCf, wedgeCutCf, wedgeSf, wedgeEasementSf,
    wedgeFillCy: wedgeFillCf / CF_PER_CY, wedgeCutCy: wedgeCutCf / CF_PER_CY,
    apronRatio, dockBreaks: { count: 0, maxFt: 0 },
  };
}

/* Earthwork of the WHOLE graded area (every element, the open ground and the slope bands), CY. */
export function gradedAreaEarthwork(grid) {
  if (!grid || grid.cutCy == null) return null;
  return { cutCy: grid.cutCy, fillCy: grid.fillCy, netCy: grid.fillCy - grid.cutCy };
}

/* NEW-2(c/e) — the PROPOSED elevation at ONE point, for the map's cursor readout.
 *
 * This is deliberately not a second derivation: it walks `grid.owners` — the very array
 * surfaceGrid built and priced its lattice from — through the same precedence (building
 * pad → dock stack → the rest), the same pond exclusion, and the same B833 transition
 * taper. A readout that disagreed with the earthwork ledger would be a defect, so the
 * two share one surface by construction rather than by care.
 *
 * NEVER extrapolates a plane past its own element: outside every footprint the answer is
 * either the daylight wedge (which tapers to existing ground and stops) or an honest
 * "nothing proposed here", never `plane.zAt` of the nearest element.
 *
 * Returns { status:"value", ft, elId, cls, wedge } or { status:"none", reason } where
 * reason ∈ "nosurface" | "pond" | "outside" | "void". Pure. */
export function sampleProposedAt(grid, pt, existAt) {
  if (!grid || !Array.isArray(grid.owners) || !grid.owners.length || !pt ||
    !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) return { status: "none", reason: "nosurface" };
  if (grid.limit && typeof grid.probe === "function") return grid.probe(pt);   // ROUND 4 — the one stitched surface
  for (const pr of grid.pondRings || []) if (pointInRing(pt, pr)) return { status: "none", reason: "pond" };
  for (const g of grid.owners) {
    if (pt.x < g.bbox[0] || pt.x > g.bbox[2] || pt.y < g.bbox[1] || pt.y > g.bbox[3]) continue;
    if (pointInRing(pt, g.el.ring)) {
      return { status: "value", ft: grid.zOf ? grid.zOf(g, pt) : g.plane.zAt(pt), elId: g.el.id, cls: g.plane.classId, wedge: false };
    }
  }
  if (!grid.apronsOn || typeof existAt !== "function") return { status: "none", reason: "outside" };
  const apronRatio = grid.apronRatio || GRADING_RULES.landscapeTieDown.maxSlopeRatio;
  let own = null, od = Infinity, oq = null;
  for (const g of grid.owners) {
    if (!(g.apron > 0)) continue;
    if (pt.x < g.bbox[0] - g.apron || pt.x > g.bbox[2] + g.apron ||
      pt.y < g.bbox[1] - g.apron || pt.y > g.bbox[3] + g.apron) continue;
    const q = nearestOnRing(pt, g.el.ring);
    if (!q) continue;
    const d = Math.hypot(pt.x - q.x, pt.y - q.y);
    if (d <= g.apron && d < od) { od = d; own = g; oq = q; }
  }
  if (!own) return { status: "none", reason: "outside" };
  const g0 = existAt(pt);
  if (g0 == null || !isFinite(g0)) return { status: "none", reason: "void" };
  const dz = wedgeDz(grid.zOf ? grid.zOf(own, oq) : own.plane.zAt(oq), g0, od, apronRatio, grid.shoulderFt || 0);
  return { status: "value", ft: g0 + dz, elId: own.el.id, cls: "transition", wedge: true };
}

/* B833(c) — the daylight line: where each element's transition taper meets existing
 * ground. Sampled along the ring (vertices + perEdge interpolants); each sample is
 * offset outward along its edge normal by |proposed − existing| × ratio — the same
 * taper model the wedge cells price, so the line and the fringe agree by
 * construction. Screening polyline (a DEM void samples as zero offset). Pure. */
export function daylightRings({ planes, els = [], existAt = null, apronRatio = GRADING_RULES.landscapeTieDown.maxSlopeRatio, perEdge = 3, shoulderFt = 0, zOf = null } = {}) {
  if (typeof existAt !== "function" || !planes) return [];
  const out = [];
  for (const el of els) {
    const plane = planes.get ? planes.get(el.id) : null;
    if (!plane || !Array.isArray(el.ring) || el.ring.length < 3) continue;
    const c = ringCentroid(el.ring);
    const pts = [];
    const ring = el.ring;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      for (let k = 0; k < perEdge; k++) {
        const t = k / perEdge;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const gz = existAt(p);
        const dz = gz == null || !isFinite(gz) ? 0 : Math.abs((zOf ? zOf({ plane, el }, p) : plane.zAt(p)) - gz);
        let n = norm(-(b.y - a.y), b.x - a.x); // edge normal…
        if (n.x * (c.x - p.x) + n.y * (c.y - p.y) > 0) n = { x: -n.x, y: -n.y }; // …pointing away from the centroid
        const d = dz * apronRatio + (dz > 0 ? shoulderFt : 0);
        pts.push({ x: p.x + n.x * d, y: p.y + n.y * d });
      }
    }
    if (pts.length >= 3) out.push({ elId: el.id, ring: pts });
  }
  return out;
}

const SEAM_WORD = { dockApron: "The court", trailerParking: "The trailer row", carParkingGeneral: "The lot", carParkingAccessible: "The lot", driveAisles: "The paving" };
const seamName = (planes, id) => { const p = planes && planes.get ? planes.get(id) : null; const w = p ? SEAM_WORD[p.classId] : null; return w || "The pavement"; };
/* ---- violations — data WITH copy (short ≤ the B823 one-line cap, detail = the ⓘ) ---- */
const SQFT_PER_ACRE = 43560;
const f2 = (n) => (Math.round(n * 100) / 100).toFixed(2);
export function surfaceViolations({ planes, grid } = {}) {
  const out = [];
  const byBound = { legalMax: [], min: [], max: [] };
  for (const p of (planes ? planes.values() : [])) {
    const c = p.check;
    if (!c || c.ok !== false) continue;
    if (c.violation === "legal") byBound.legalMax.push(p);
    else if (c.bound === "min") byBound.min.push(p);
    else byBound.max.push(p);
  }
  const n = (list) => `${list.length} element${list.length > 1 ? "s" : ""}`;
  if (byBound.legalMax.length) out.push({
    kind: "ada", legal: true,
    short: `ADA/TAS §502.4: accessible parking graded over 2.0% — a LEGAL breach (${n(byBound.legalMax)}).`,
    detail: `Accessible stalls AND their access aisles are capped at 2.0% (1:48) in EVERY direction — a legal requirement, not a style note. Slopes here: ${byBound.legalMax.map((p) => `${f2(p.slopePct)}%`).join(", ")}. Lower the slope override or re-grade.`,
  });
  if (byBound.min.length) out.push({
    kind: "under-min", legal: false,
    short: `Paved surface under its drainage minimum — water will pond (${n(byBound.min)}).`,
    detail: `A paved plane graded flatter than its class floor won't sheet-drain: ${byBound.min.map((p) => `${p.label} at ${f2(p.slopePct)}% (min ${f2(p.check.limitPct)}%)`).join("; ")}. Raise the slope or clear the override.`,
  });
  if (byBound.max.length) out.push({
    kind: "over-max", legal: false,
    short: `A surface exceeds its class slope cap — check the override (${n(byBound.max)}).`,
    detail: byBound.max.map((p) => `${p.label} at ${f2(p.slopePct)}% (cap ${f2(p.check.limitPct)}%)`).join("; ") + ". Planyr screening bands — confirm intent with your civil engineer.",
  });
  if (grid && grid.plFillSf > 200) out.push({
    kind: "pl-fill", legal: false,
    short: `${f2(grid.plFillSf / SQFT_PER_ACRE)} AC of graded fill lies OUTSIDE the parcel — no fill across the property line.`,
    detail: "The proposed planes OR their daylight transition wedges extend past the parcel boundary — offsite fill needs the neighbor's land. Pull the element back, steepen the tie (3:1 max), or plan a retaining wall at the line so grade daylights inside it.",
  });
  if (grid && grid.wedgeEasementSf > 200) out.push({
    kind: "wedge-easement", legal: false,
    short: `Transition-slope fill reaches into a drawn easement (${f2(grid.wedgeEasementSf / SQFT_PER_ACRE)} AC) — daylight runs out of room.`,
    detail: "The daylight wedge off a graded edge crosses an easement — fill there usually needs the easement holder's consent. Pull the element back, steepen the tie (3:1 max), or plan a retaining wall so grade daylights before the easement line.",
  });
  if (grid && grid.tieShortSf > 200) out.push({
    kind: "tie-short", legal: false,
    short: `Fill near the property line too tall for a 3:1 tie-down inside the parcel (${f2(grid.tieShortSf / SQFT_PER_ACRE)} AC).`,
    detail: "The landscape tie between the graded plane and existing ground at the PL needs 3 ft of run per foot of fill (3:1 max, 4:1 preferred — mowable); that run doesn't fit before the line here. Lower the field, pull back, or plan a wall.",
  });
  for (const st of (grid && grid.seams) || []) out.push({
    kind: "seam-step", legal: false, elId: st.elId, nId: st.nId,
    short: `${seamName(planes, st.elId)} and ${seamName(planes, st.nId).toLowerCase()} can't meet without a step; a curb/wall of ${f2(st.stepFt).replace(/\.?0+$/, "")} ft at their seam.`,
    detail: `Bending the higher surface down to the lower one's edge within its own extent would need ${f2(st.needPct)}% — past the max pavement slope. Lower the higher one, pull them apart, or plan a curb or wall at the seam.`,
  });
  if (grid && grid.dockBreaks.count > 0) out.push({
    kind: "dock-break", legal: false,
    short: `Dock-approach grade break — adjoining pavement steps over ${f2(DOCK_BREAK_FT)}′ at a court edge.`,
    detail: `A drive lane meets the dock court with a step no truck can cross (max ${f2(grid.dockBreaks.maxFt)}′). Blend the approach grades or re-anchor the adjoining paving. The dock WALL itself (pad to court) is by design and not flagged.`,
  });
  return out;
}

/* ---- top level ---- */
/* Build the whole proposed surface: planes + composite grid + violations + a stable
 * identity key (memo/persist signatures — the B807 stale-memo discipline: the key must
 * change whenever any input that changes the surface changes). Returns null when no
 * element yields a plane (no FFE anywhere / nothing graded). Pure. */
export function buildProposedSurface(args) { return drainSteps(buildProposedSurfaceSteps(args)); }
/* ⛔ NOT ON THE RENDER PATH FOR THE GRADING LAYER (problem report 6cea9895). One build of the owner's 636,916 SF
 * cross-dock on the Chehaw lattice is ~100 ms in Node; the grading layer runs this generator through runChunked
 * (lib/useGradeSurface.js, GradingController) so no step holds the main thread past a lattice column.
 * `buildProposedSurface` drains it synchronously: one implementation, identical results. */
export function* buildProposedSurfaceSteps({ els = [], ffeFt = null, dockDropFt = 4, tieDropFt = TIE_DROP_FT, fieldT = 0, drainTarget = null, daylightAsap = false, existAt = null, parcelRings = [], pondRings = [], easementRings = [], opts = {}, grading = null } = {}) {
  const { planes, skipped } = buildPlanes({ els, ffeFt, dockDropFt, tieDropFt, fieldT, drainTarget, daylightAsap, grading });
  if (!planes.size) return null;
  yield;
  // The grading model rides OPTS into the lattice (maxCells defaults up so a 520′ building keeps ~8′ cells).
  const gridOpts = grading ? { maxCells: GRADING_DEFAULTS.maxCells, ...opts, grading } : opts;
  const grid = yield* surfaceGridSteps({ planes, els, existAt, parcelRings, pondRings, easementRings, opts: gridOpts });
  if (!grid) return null;
  yield;
  const violations = surfaceViolations({ planes, grid });
  // B833(c) — the daylight boundary, per graded element (rendered as a subtle contour).
  yield;
  const daylight = grid.limit ? grid.daylight : daylightRings({ planes, els, existAt, apronRatio: grid.apronRatio, shoulderFt: grid.shoulderFt || 0, zOf: grid.zOf || null });
  const surfaceKey = [
    "b826", ffeFt, dockDropFt, tieDropFt, clamp01(fieldT).toFixed(3),
    drainTarget ? `${Math.round(drainTarget.x)},${Math.round(drainTarget.y)}` : "",
    opts.existKey || "",
    // B833 — apron + daylight inputs join the identity (the B807 stale-memo discipline).
    `ar:${grid.apronRatio}`, `dl:${daylightAsap ? 1 : 0}`,
    easementRings.length ? `es:${easementRings.map((r) => ringHash(r)).join(",")}` : "",
    // GRADING MODEL inputs join the identity (the B807 stale-memo discipline) — and only then, so an
    // account without the model gets the key it always had.
    grading ? `gr:${grading.pavementSlopePct ?? ""}:${grading.lotDropFt ?? ""}:${grading.slopeRatio ?? ""}:${grading.shoulderFt ?? ""}:${(grading.setbackRings || []).map((r) => ringHash(r)).join(",")}` : "",
    // ROUND 4 — the limit's inputs join the identity (the surface itself is cached by them inside gradingLimit.js)
    grading && grading.limit ? `lm:${grading.limit.mode || "layout"}:${grading.limit.shoulderFt ?? ""}:${grading.limit.cornerRadiusFt ?? ""}:${grading.limit.aisleFt ?? ""}:${grading.limit.maxPavementSlopePct ?? ""}:${grading.limit.maxCutFillFt ?? ""}:${grading.limit.edited ? ringHash(grading.limit.edited) : "-"}:${(grading.limit.extraRings || []).map((r) => ringHash(r)).join(",")}:${(grading.limit.setbackHoles || []).map((r) => ringHash(r)).join(",")}:${pondRings.map((r) => ringHash(r)).join(",")}` : "",
    els.filter((e) => planes.has(e.id)).map((e) => `${e.id}:${ringHash(e.ring)}:${e.padElevFt ?? ""}:${e.slopeOverridePct ?? ""}:${e.accessible ? 1 : 0}${grading ? `:${e.hostId ?? ""}` : ""}`).join("|"),
  ].join("~");
  return { planes, grid, violations, skipped, daylight, fieldT: clamp01(fieldT), surfaceKey };
}

/* Net dirt in CY: + = import (buy dirt), − = export (haul off). shrinkFactor converts
 * compacted fill to bank volume (1 + shrink% — clay placed at 95% Proctor needs more
 * bank dirt than its compacted volume); borrowCy = on-site borrow OUTSIDE the graded
 * surface (pond excavation, the mitigation cut). Pure. */
export const netImportCy = ({ fillCy = 0, cutCy = 0, borrowCy = 0, shrinkFactor = 1 } = {}) =>
  (fillCy || 0) * (Number.isFinite(shrinkFactor) ? shrinkFactor : 1) - (cutCy || 0) - (borrowCy || 0);

/* Balance assist (B826 c): the fieldT (uniform paving-field sweep, flattest → class
 * cap; the threshold tie holds at the doors by construction — the field lowers by
 * steepening within each class band, never by breaking the tie) that nets the dirt
 * closest to zero. net(t) is monotone nonincreasing in t (steeper → lower field →
 * less fill, more cut), so bisection converges. buildAtT(t) → a surfaceGrid result.
 * Returns { t, netCy, fillCy, cutCy, achieved, clamped:null|'flattest'|'steepest' } —
 * clamped names the honest boundary case (the target net can't be reached in-band).
 * Returns null when the grid can't price (no ground elevation). Pure. */
export function balanceAssist({ buildAtT, shrinkFactor = 1, borrowCy = 0, tolCy = 10, iters = 24 } = {}) {
  if (typeof buildAtT !== "function") return null;
  const net = (g) => (g && g.fillCy != null ? netImportCy({ fillCy: g.fillCy, cutCy: g.cutCy, borrowCy, shrinkFactor }) : null);
  const g0 = buildAtT(0);
  const n0 = net(g0);
  if (n0 == null) return null;
  if (n0 <= tolCy) {
    // Flattest field already balances or exports — going steeper only exports more.
    return { t: 0, netCy: n0, fillCy: g0.fillCy, cutCy: g0.cutCy, achieved: Math.abs(n0) <= tolCy, clamped: Math.abs(n0) <= tolCy ? null : "flattest" };
  }
  const g1 = buildAtT(1);
  const n1 = net(g1);
  if (n1 == null) return null;
  if (n1 >= -tolCy) {
    // Even the steepest in-band field still imports (or just balances) — clamp at the cap.
    return { t: 1, netCy: n1, fillCy: g1.fillCy, cutCy: g1.cutCy, achieved: Math.abs(n1) <= tolCy, clamped: Math.abs(n1) <= tolCy ? null : "steepest" };
  }
  let lo = 0, hi = 1, gm = g1, nm = n1, tm = 1;
  for (let k = 0; k < iters; k++) {
    tm = (lo + hi) / 2;
    gm = buildAtT(tm);
    nm = net(gm);
    if (nm == null) return null;
    if (Math.abs(nm) <= tolCy) break;
    if (nm > 0) lo = tm; else hi = tm;
  }
  return { t: tm, netCy: nm, fillCy: gm.fillCy, cutCy: gm.cutCy, achieved: Math.abs(nm) <= tolCy, clamped: null };
}
