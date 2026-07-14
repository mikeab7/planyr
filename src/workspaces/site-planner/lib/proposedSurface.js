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
 * Pure, Node-testable, no DOM. Feet everywhere; elevations ft NAVD88. Screening only —
 * confirm final grading with your civil engineer. */
import { pointInRing } from "./pondGeom.js";
import { GRADING_RULES, gradingRuleFor, validateSlopeAgainstRule } from "./gradingRules.js";

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
export function buildPlanes({ els = [], ffeFt = null, dockDropFt = 4, tieDropFt = TIE_DROP_FT, fieldT = 0, drainTarget = null } = {}) {
  const planes = new Map();
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
      slopePct = hasOverride ? el.slopeOverridePct : band.min + t * (band.max - band.min);
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
export function surfaceGrid({ planes, els = [], existAt = null, parcelRings = [], pondRings = [], opts = {} } = {}) {
  const maxCells = opts.maxCells || 3000;
  const minCellFt = opts.minCellFt || 2;
  const prec = (el) => (el.type === "building" ? 0 : el.dockStack ? 1 : 2);
  const graded = els
    .filter((e) => e && planes.has(e.id) && Array.isArray(e.ring) && e.ring.length >= 3)
    .map((e) => ({ el: e, plane: planes.get(e.id), bbox: ringBBox(e.ring) }))
    .sort((a, b) => prec(a.el) - prec(b.el));
  if (!graded.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const g of graded) {
    if (g.bbox[0] < x0) x0 = g.bbox[0]; if (g.bbox[1] < y0) y0 = g.bbox[1];
    if (g.bbox[2] > x1) x1 = g.bbox[2]; if (g.bbox[3] > y1) y1 = g.bbox[3];
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
  const perEl = {};
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      const pt = { x: x0 + (i + 0.5) * dx, y: y0 + (j + 0.5) * dy };
      let hit = null;
      for (const g of graded) {
        if (pt.x < g.bbox[0] || pt.x > g.bbox[2] || pt.y < g.bbox[1] || pt.y > g.bbox[3]) continue;
        if (pointInRing(pt, g.el.ring)) { hit = g; break; }
      }
      if (!hit) continue;
      let inPond = false;
      for (const pr of pondRings) if (pointInRing(pt, pr)) { inPond = true; break; }
      if (inPond) continue;
      gradedSf += A;
      const prop = hit.plane.zAt(pt);
      const g0 = existAt ? existAt(pt) : null;
      const dz = g0 == null || !isFinite(g0) ? null : prop - g0;
      idx[i * ny + j] = { elId: hit.el.id, cls: hit.plane.classId, prop };
      cells.push({ x: pt.x, y: pt.y, wFt: dx, hFt: dy, dzFt: dz, elId: hit.el.id, cls: hit.plane.classId });
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
  for (let i = 0; i < nx; i++) {
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
    gradedSf,
    pricedCells, voidCells,
    cutCf: priced ? cutCf : null, fillCf: priced ? fillCf : null,
    cutCy: priced ? cutCf / CF_PER_CY : null, fillCy: priced ? fillCf / CF_PER_CY : null,
    perEl,
    floatAreaSf, floatPropSum,
    plFillSf, tieShortSf,
    dockBreaks: { count: breakCount, maxFt: maxBreakFt },
  };
}

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
    short: `${f2(grid.plFillSf / SQFT_PER_ACRE)} ac of graded fill lies OUTSIDE the parcel — no fill across the property line.`,
    detail: "The proposed planes extend past the parcel boundary — offsite fill needs the neighbor's land. Pull the element back inside the line or re-grade.",
  });
  if (grid && grid.tieShortSf > 200) out.push({
    kind: "tie-short", legal: false,
    short: `Fill near the property line too tall for a 3:1 tie-down inside the parcel (${f2(grid.tieShortSf / SQFT_PER_ACRE)} ac).`,
    detail: "The landscape tie between the graded plane and existing ground at the PL needs 3 ft of run per foot of fill (3:1 max, 4:1 preferred — mowable); that run doesn't fit before the line here. Lower the field, pull back, or plan a wall.",
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
export function buildProposedSurface({ els = [], ffeFt = null, dockDropFt = 4, tieDropFt = TIE_DROP_FT, fieldT = 0, drainTarget = null, existAt = null, parcelRings = [], pondRings = [], opts = {} } = {}) {
  const { planes, skipped } = buildPlanes({ els, ffeFt, dockDropFt, tieDropFt, fieldT, drainTarget });
  if (!planes.size) return null;
  const grid = surfaceGrid({ planes, els, existAt, parcelRings, pondRings, opts });
  if (!grid) return null;
  const violations = surfaceViolations({ planes, grid });
  const surfaceKey = [
    "b826", ffeFt, dockDropFt, tieDropFt, clamp01(fieldT).toFixed(3),
    drainTarget ? `${Math.round(drainTarget.x)},${Math.round(drainTarget.y)}` : "",
    opts.existKey || "",
    els.filter((e) => planes.has(e.id)).map((e) => `${e.id}:${ringHash(e.ring)}:${e.padElevFt ?? ""}:${e.slopeOverridePct ?? ""}:${e.accessible ? 1 : 0}`).join("|"),
  ].join("~");
  return { planes, grid, violations, skipped, fieldT: clamp01(fieldT), surfaceKey };
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
