/* Fit the biggest building — the TEMPLATE side (NEW-1, owner-only grading layer). Everything the search needs to know about the
 * building it is fitting, read off the plan, and the pieces that put the answer back on the plan's terms. Pure, no DOM; runs on the
 * main thread (the search itself, `fitBuilding.js`, runs in the terrain worker).
 *
 * The TEMPLATE is the selected building's configuration — its dock layout (single-load / cross-dock), the stack of truck court /
 * trailer rows / buffer on each long side, and what hangs off its ends (walks, car parking) — normalised into the search's frame:
 * u along the dock walls (the building's LENGTH), v across them (its DEPTH). With no building on the plan it is a default
 * cross-dock: a court + trailer row + buffer on each long side from the plan's standard depths.
 *
 *   templateFromBuilding   — selected building + the elements attached to it → template (JSON-safe, shipped to the worker)
 *   defaultTemplate        — no building: a cross-dock from the plan's standard zone depths
 *   frontageDegOf          — the direction of the road nearest the parcel (the building's length runs parallel to it)
 *   fitAssemblyEls         — the CURRENT assembly's prepared (graded) elements re-fitted to a candidate box, for the real engine
 *   syntheticAssemblyEls   — the same for a plan with no building yet (building + court + trailer rows from the template)
 *
 * The planner applies a result through its OWN resize path (`refitChildren`), never through anything here. */
import { dockSidesFor, dockAxisOf, footprintAxes, zoneDepthDefaults } from "./dockZones.js";
import { FIT_DEFAULTS, depthLadder } from "./fitBuilding.js";

const RAD = Math.PI / 180;
const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const rot2 = (x, y, deg) => { const r = deg * RAD, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };
const mod360 = (d) => ((d % 360) + 360) % 360;

/* A raw element's footprint corners (rect → rotated corners; an irregular footprint → its own points / ring). */
export function cornersOf(e) {
  const pts = (Array.isArray(e.ring) && e.ring.length >= 3 ? e.ring : null) || (Array.isArray(e.points) && e.points.length >= 3 ? e.points : null);
  if (pts) return pts;
  const hw = e.w / 2, hh = e.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([x, y]) => { const o = rot2(x, y, e.rot || 0); return { x: e.cx + o.x, y: e.cy + o.y }; });
}

/* The direction (degrees) of the building's LENGTH axis — along its dock walls. */
export function lengthAxisDeg(b) { return mod360((b.rot || 0) + (dockAxisOf(b) === "y" ? 90 : 0)); }

/* The building's length and depth in feet (depth = across the dock walls). */
export function lengthDepthOf(b) { const ax = footprintAxes(b); return { lengthFt: b[ax.length], depthFt: b[ax.depth] }; }

/* The template of a selected building and the elements attached to it.
 *   b      — the raw building element ({ cx, cy, w, h, rot, dock, dockAxis, dockSide })
 *   kids   — the raw elements attached to it (`attachedTo === b.id`: courts, trailer rows, buffers, walks, parking, bump-outs)
 *   opts   — { dockDropFt, lotDropFt, pavementSlopePct } */
export function templateFromBuilding(b, kids, opts = {}) {
  const theta = lengthAxisDeg(b), th = theta * RAD;
  const uHat = { x: Math.cos(th), y: Math.sin(th) }, vHat = { x: -Math.sin(th), y: Math.cos(th) };
  const { lengthFt, depthFt } = lengthDepthOf(b);
  const hl = lengthFt / 2, hd = depthFt / 2;
  let negDepth = 0, posDepth = 0, endNeg = 0, endPos = 0;
  for (const k of kids || []) {
    if (!k || k.id === b.id || k.dogEar || k.type === "driveInRamp") continue;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of cornersOf(k)) {
      const dx = p.x - b.cx, dy = p.y - b.cy;
      const u = dx * uHat.x + dy * uHat.y, v = dx * vHat.x + dy * vHat.y;
      if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
    }
    const TOL = 1;
    if (v1 <= -hd + TOL) negDepth = Math.max(negDepth, -v0 - hd);
    else if (v0 >= hd - TOL) posDepth = Math.max(posDepth, v1 - hd);
    else if (u0 >= hl - TOL) endPos = Math.max(endPos, u1 - hl);
    else if (u1 <= -hl + TOL) endNeg = Math.max(endNeg, -u0 - hl);
  }
  // which long side is a dock side → its stack starts a dock drop below the finish; any other side, a curb drop
  const dockMode = b.dock === "single" || b.dock === "none" ? b.dock : "cross";
  const { dockSides } = dockSidesFor(b);
  let negDock = false, posDock = false;
  for (const sd of dockSides) {
    const n = SIDE_N[sd]; if (!n) continue;
    const w = rot2(n[0], n[1], b.rot || 0);
    const dv = w.x * vHat.x + w.y * vHat.y;
    if (dv > 0.5) posDock = true; else if (dv < -0.5) negDock = true;
  }
  const dockDrop = opts.dockDropFt ?? FIT_DEFAULTS.dockDropFt, lotDrop = opts.lotDropFt ?? FIT_DEFAULTS.lotDropFt;
  return {
    fromBuilding: true, dockMode, axis: dockAxisOf(b) === "y" ? "y" : "x", uDeg: theta,
    lengthFt, depthFt, negDepth: Math.round(negDepth), posDepth: Math.round(posDepth), endNeg: Math.round(endNeg), endPos: Math.round(endPos),
    negDrop: negDock ? dockDrop : lotDrop, posDrop: posDock ? dockDrop : lotDrop, lotDrop,
    bayFt: FIT_DEFAULTS.bayFt, minBays: FIT_DEFAULTS.minBays,
    depths: depthLadder({ dockMode, templateDepthFt: depthFt }),
  };
}

/* No building on the plan: a cross-dock with the plan's standard court / trailer row / buffer on each long side. */
export function defaultTemplate(settings = {}, opts = {}) {
  const stack = zoneDepthDefaults(settings).reduce((a, d) => a + d, 0);
  const dockDrop = opts.dockDropFt ?? FIT_DEFAULTS.dockDropFt;
  return {
    fromBuilding: false, dockMode: "cross", axis: "x", uDeg: null, lengthFt: null, depthFt: null,
    negDepth: Math.round(stack), posDepth: Math.round(stack), endNeg: 0, endPos: 0,
    negDrop: dockDrop, posDrop: dockDrop, lotDrop: opts.lotDropFt ?? FIT_DEFAULTS.lotDropFt,
    bayFt: FIT_DEFAULTS.bayFt, minBays: FIT_DEFAULTS.minBays,
    depths: depthLadder({ dockMode: "cross" }),
  };
}

/* The direction (degrees [0,180)) of the road nearest the parcel — "the frontage". `roads` = centerlines ([{x,y}…]); `parcelRings` =
 * the active parcels' rings. null when no centerline road is drawn. */
export function frontageDegOf(roads, parcelRings) {
  let cx = 0, cy = 0, n = 0;
  for (const r of parcelRings || []) for (const p of r) { cx += p.x; cy += p.y; n++; }
  if (!n) return null;
  cx /= n; cy /= n;
  let best = null;
  for (const pts of roads || []) {
    if (!Array.isArray(pts) || pts.length < 2) continue;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
      if (len2 < 1) continue;
      const t = Math.max(0, Math.min(1, ((cx - a.x) * dx + (cy - a.y) * dy) / len2));
      const d = Math.hypot(cx - (a.x + t * dx), cy - (a.y + t * dy));
      if (!best || d < best.d) best = { d, deg: ((Math.atan2(dy, dx) / RAD) % 180 + 180) % 180 };
    }
  }
  return best ? best.deg : null;
}

/* ---------------- re-fitting graded elements to a candidate box ---------------- */

const frameOf = (box, axis) => {
  const theta = (box.rot || 0) + (axis === "y" ? 90 : 0), th = theta * RAD;
  return { cx: box.cx, cy: box.cy, uHat: { x: Math.cos(th), y: Math.sin(th) }, vHat: { x: -Math.sin(th), y: Math.cos(th) },
    L: axis === "y" ? box.h : box.w, W: axis === "y" ? box.w : box.h };
};
const place = (f, u, v) => ({ x: f.cx + u * f.uHat.x + v * f.vHat.x, y: f.cy + u * f.uHat.y + v * f.vHat.y });

/* The prepared (graded) elements of the current assembly re-fitted to a new building box, as the planner's own resize would: the
 * building and the stacks across its length scale with it, what stands off an end moves with that end, the depth change lands
 * on the outward side. Used ONLY to price a candidate through the real engine and to draw nothing: the plan itself is re-laid by
 * the planner's resize path when the owner presses Use this.
 *   els         — the prepared elements (as `buildProposedSurface` takes them)
 *   assembly    — the Set of ids that belong to the building (gradingMembership.assemblyIds)
 *   oldBox/newBox — { cx, cy, w, h, rot };  axis — "x" | "y" (the building's dock axis)
 *   ffe         — the finished floor the building takes */
export function fitAssemblyEls(els, buildingId, assembly, oldBox, newBox, axis, ffe) {
  const fo = frameOf(oldBox, axis), fn = frameOf(newBox, axis);
  const kL = fo.L > 0 ? fn.L / fo.L : 1, kW = fo.W > 0 ? fn.W / fo.W : 1;
  const dL = (fn.L - fo.L) / 2, dW = (fn.W - fo.W) / 2;
  const TOL = 0.75;
  const mapPt = (p) => {
    const dx = p.x - fo.cx, dy = p.y - fo.cy;
    const u = dx * fo.uHat.x + dy * fo.uHat.y, v = dx * fo.vHat.x + dy * fo.vHat.y;
    const pastU = Math.abs(u) > fo.L / 2 + TOL, pastV = Math.abs(v) > fo.W / 2 + TOL;
    const u2 = pastU ? u + Math.sign(u) * dL : u * kL;
    const v2 = pastV ? v + Math.sign(v) * dW : v * kW;
    return place(fn, u2, v2);
  };
  const centre = { x: newBox.cx, y: newBox.cy };
  return els.map((e) => {
    if (!assembly.has(e.id)) return e;
    const n = { ...e, ring: e.ring.map(mapPt) };
    if (e.dockStack) n.dockStack = centre;
    if (e.id === buildingId) n.padElevFt = ffe;
    return n;
  });
}

const rectRing = (f, u0, u1, v0, v1) => [place(f, u0, v0), place(f, u1, v0), place(f, u1, v1), place(f, u0, v1)];

/* A plan with no building: the candidate's building plus a truck court and a trailer row on each long side, from the template's
 * standard zone depths — graded elements as `buildProposedSurface` takes them. */
export function syntheticAssemblyEls(box, settings, ffe, opts = {}) {
  const f = frameOf(box, "x");
  const [courtD, trailerD] = zoneDepthDefaults(settings);
  const id = opts.id || "fit-new";
  const centre = { x: box.cx, y: box.cy };
  const out = [{ id, type: "building", ring: rectRing(f, -f.L / 2, f.L / 2, -f.W / 2, f.W / 2), dockStack: null, accessible: false, slopeOverridePct: null, padElevFt: ffe }];
  for (const [sgn, tag] of [[-1, "n"], [1, "p"]]) {
    const edge = (sgn * f.W) / 2;
    const rectV = (d0, d1) => { const a = edge + sgn * d0, b = edge + sgn * d1; return rectRing(f, -f.L / 2, f.L / 2, Math.min(a, b), Math.max(a, b)); };
    out.push({ id: `${id}-court-${tag}`, type: "paving", ring: rectV(0, courtD), dockStack: centre, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: id });
    out.push({ id: `${id}-trailer-${tag}`, type: "trailer", ring: rectV(courtD, courtD + trailerD), dockStack: centre, accessible: false, slopeOverridePct: null, padElevFt: null, hostId: id });
  }
  return out;
}

/* The element a "Use this" creates when the plan has no building (planner-side; the planner adds the court / trailer / buffer zones
 * through its own factories). */
export function newBuildingFields(box) {
  return { type: "building", cx: box.cx, cy: box.cy, w: box.w, h: box.h, rot: mod360(box.rot), dock: "cross", dockAxis: "x", dockSide: "bottom" };
}
