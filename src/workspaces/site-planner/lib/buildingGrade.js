/* Building-grade helpers (owner-only grading layer) — everything the Site Analysis Grading group and the grading
 * layers need that is NOT the surface itself: which elements belong to a building, its earthwork (read from the
 * SAME lattice the earthwork rows use), the setback flag in plain words, the balanced-dirt solver (the FFE
 * suggestion in lib/ffeSuggest.js builds on it), the two fix solvers, and the spot-elevation geometry drawn on
 * the court and the lots.
 *
 * Pure, no DOM, Node-tested. Feet and cubic yards; elevations ft NAVD88. Bank volumes — no stripping,
 * no shrink or swell (owner rule). The solvers are GENERATORS that `yield` before every surface build so
 * a driver (runChunked) can keep the UI alive between builds; runSync drives them to completion in tests.
 *
 * Every surface build goes through ONE closure the caller supplies — `evalAt({ ffe, dx, dy })` →
 * proposed surface (buildProposedSurface on the shared inputs with the building's FFE and/or the
 * assembly shifted). The solvers never build a surface of their own, so a verdict here can never differ
 * from what the tiles paint. */
import { solveBalanceFfeSteps, evalSteps } from "./ffeBalance.js";
export { evalSteps };
import { hostBuildingIdOf, assemblyIds } from "./gradingMembership.js";

export const CF_PER_CY = 27;
export const BALANCE_TOL_CY = 500;     // "CY net, balanced" when |net| is under this
export const FFE_STEP_FT = 0.5;
export const FFE_FIX_RANGE_FT = 16;    // nearest clearing FFE is searched within ±16 ft
export const MOVE_STEP_FT = 5;
export const MOVE_MAX_FT = 240;

/* ---- who belongs to a building ---- (the two rules live in gradingMembership.js; re-exported here) */
export { hostBuildingIdOf, assemblyIds };

/* ---- geometry helpers for the fix solvers ---- */
const shiftRing = (ring, dx, dy) => ring.map((p) => ({ x: p.x + dx, y: p.y + dy }));
/* Translate an assembly. Prepared elements carry `ring` and (dock stacks) `dockStack` = the host centroid. */
export function shiftAssembly(els, ids, dx, dy) {
  if (!dx && !dy) return els;
  return els.map((e) => {
    if (!ids.has(e.id)) return e;
    const n = { ...e, ring: shiftRing(e.ring, dx, dy) };
    if (e.dockStack) n.dockStack = { x: e.dockStack.x + dx, y: e.dockStack.y + dy };
    return n;
  });
}
// A bump-out is part of the host's pad, so it takes the same finish (`hostId` is stamped on it by the planner).
export const withFfe = (els, buildingId, ffe) => els.map((e) => (e.id === buildingId || (e.type === "building" && e.hostId === buildingId) ? { ...e, padElevFt: ffe } : e));

/* ---- compass ---- */
const POINTS8 = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];
/* Compass name of a direction in the planner's frame (x east, y SOUTH — screen down). */
export function compass8(dx, dy) {
  const bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;              // 0 = north, clockwise
  return POINTS8[Math.round(((bearing % 360) + 360) % 360 / 45) % 8];
}
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const ABBR8 = { north: "N", "north-east": "NE", east: "E", "south-east": "SE", south: "S", "south-west": "SW", west: "W", "north-west": "NW" };
export const compassAbbr = (name) => ABBR8[name] || name;

/* ---- the earthwork tiles ---- */

/* Cut / fill / net for an assembly, from the SAME lattice the earthwork rows price (`grid.perEl`, which
 * already includes each element's daylight wedge). CY, bank volumes. null when nothing priced. */
export function assemblyEarthwork(grid, ids) {
  if (!grid || grid.cutCy == null) return null;
  let cutCf = 0, fillCf = 0;
  for (const id of ids) { const p = grid.perEl && grid.perEl[id]; if (p) { cutCf += p.cutCf; fillCf += p.fillCf; } }
  const cutCy = cutCf / CF_PER_CY, fillCy = fillCf / CF_PER_CY;
  const netCy = fillCy - cutCy;                                       // + import, − export
  return { cutCy, fillCy, netCy, balanced: Math.abs(netCy) < BALANCE_TOL_CY, dirtCy: cutCy + fillCy };
}
/* The tile label for the net: "CY export" / "CY import" / "CY net, balanced". */
/* ROUND 4 — the earthwork of the WHOLE graded area: every element, the open ground inside the limit and the slope
 * bands. The balance, the suggestion and every card read this when the surface carries a limit. */
export function gradedAreaEarthwork(grid) {
  if (!grid || grid.cutCy == null) return null;
  const cutCy = grid.cutCy, fillCy = grid.fillCy, netCy = fillCy - cutCy;
  return { cutCy, fillCy, netCy, balanced: Math.abs(netCy) < BALANCE_TOL_CY, dirtCy: cutCy + fillCy };
}
/* Earthwork for a building's card: the whole graded area when the surface has a limit, else its own assembly. */
export const cardEarthwork = (grid, ids) => (grid && grid.limit ? gradedAreaEarthwork(grid) : assemblyEarthwork(grid, ids));
/* The ids a search/scan sees: the whole graded area when the surface has a limit, else the assembly. */
export const scopeIds = (grid, ids) => (grid && grid.limit && grid.gradedIds ? grid.gradedIds : ids);
export function netLabel(netCy) {
  if (Math.abs(netCy) < BALANCE_TOL_CY) return "CY net, balanced";
  return netCy < 0 ? "CY export" : "CY import";
}

/* ---- the flag ---- */

/* What a plane's wall means for the words: the dock wall, its opposite, or an end. Compares a plane's wall
 * normal with the dock wall normal. */
function roleOfPlane(plane, dockN, el) {
  if (plane.classId === "buildingPad") return "building";
  if (plane.classId === "dockApron") return el && el.type === "trailer" ? "trailer" : "court";
  if (!dockN || !plane.wall) return "lot";
  const dot = plane.wall.n.x * dockN.x + plane.wall.n.y * dockN.y;
  if (dot > 0.9) return "lot-dock-side";
  if (dot < -0.9) return "lot-opposite";
  return "lot-end";
}
const ROLE_PHRASE = {
  building: "the building", court: "the truck court", trailer: "the trailer parking",
  "lot-dock-side": "the dock-side parking", "lot-opposite": "the parking opposite the docks",
  "lot-end": "the end-wall parking", lot: "the parking",
};
export const rolePhrase = (r) => ROLE_PHRASE[r] || "the building";

/* Plain-words flag for an assembly whose graded cells leave the setback. Returns null when nothing does.
 *   { side: "South", over: 18, kind: "fill"|"cut", property: bool, elementId, element: "the truck court",
 *     centroid, text: { title, body } } */
export function describeFlag(surface, ids, { buildingCentre, elements = [], slopeRatio = 2 } = {}) {
  const out = surface && surface.grid && surface.grid.outside;
  if (!out || !out.count) return null;
  // ROUND 4 (B2349121) — one pad inside a grading limit: the flag belongs to the GRADED AREA, named by its edge
  // ("the south edge of the graded area"), and the slope it describes is the one thrown from the limit.
  if (surface.grid.limit) {
    let worst = null, cx = 0, cy = 0, n = 0, fillSf = 0, cutSf = 0;
    for (const [id, p] of Object.entries(out.perEl || {})) {
      n += p.count; cx += p.centroid.x * p.count; cy += p.centroid.y * p.count; fillSf += p.fillSf; cutSf += p.cutSf;
      if (!worst || p.maxPastFt > worst.maxPastFt) worst = { id, ...p };
    }
    if (!n) return null;
    const centroid = { x: cx / n, y: cy / n };
    const bc = buildingCentre || centroid;
    const side = compass8(centroid.x - bc.x, centroid.y - bc.y);
    const kind = fillSf >= cutSf ? "fill" : "cut";
    const over = Math.max(1, Math.round(worst.maxPastFt));
    const property = out.beyondParcel > 0;
    const edge = `the ${side} edge of the graded area`;
    return {
      side: cap(side), over, kind, property, elementId: worst.id, element: "the graded area", role: "limit", centroid, sf: out.sf, limit: true,
      span: { pt: centroid, radiusFt: Math.max(60, Math.sqrt(out.sf) / 2) },
      text: {
        title: `Slope crosses ${property ? "the property line" : `the setback · ${cap(side)}`}`,
        body: `The ${kind} slope on ${edge} runs ${over} ft past the ${property ? "property line" : "setback"} at ${slopeRatio}:1. Pick a fix:`,
      },
    };
  }
  // only this assembly's cells count for ITS flag
  let worst = null, cx = 0, cy = 0, n = 0, fillSf = 0, cutSf = 0, beyond = 0;
  for (const id of ids) {
    const p = out.perEl && out.perEl[id];
    if (!p) continue;
    n += p.count; cx += p.centroid.x * p.count; cy += p.centroid.y * p.count; fillSf += p.fillSf; cutSf += p.cutSf;
    if (!worst || p.maxPastFt > worst.maxPastFt) worst = { id, ...p };
  }
  if (!n) return null;
  const centroid = { x: cx / n, y: cy / n };
  // is any offending cell beyond the PARCEL ring? (the grid counts beyond-parcel across all elements; refine per assembly
  // only when this assembly owns every offending cell — otherwise report the conservative whole-plan answer)
  beyond = out.count === n ? out.beyondParcel : (out.beyondParcel > 0 ? out.beyondParcel : 0);
  const bc = buildingCentre || centroid;
  const side = compass8(centroid.x - bc.x, centroid.y - bc.y);
  const plane = surface.planes.get(worst.id);
  const dockPlane = [...surface.planes.values()].find((q) => q.classId === "dockApron" && q.wall);
  const el = elements.find((e) => e.id === worst.id);
  const role = plane ? roleOfPlane(plane, dockPlane ? dockPlane.wall.n : null, el) : "building";
  const kind = fillSf >= cutSf ? "fill" : "cut";
  const over = Math.max(1, Math.round(worst.maxPastFt));
  const property = beyond > 0;
  const element = rolePhrase(role);
  return {
    side: cap(side), over, kind, property, elementId: worst.id, element, role, centroid, sf: out.sf,
    text: {
      title: `Slope crosses ${property ? "the property line" : `the setback · ${cap(side)}`}`,
      body: `The ${kind} slope off ${element} runs ${over} ft past the line at ${slopeRatio}:1. Pick a fix:`,
    },
  };
}

/* ---- drivers for the generator solvers ---- */
export function runSync(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}
/* runChunked lives in its own leaf (lib/runChunked.js) so the planner's off-render surface build can use it without
 * pulling this module onto the boot path; re-exported here for every existing caller. */
export { runChunked } from "./runChunked.js";

/* ---- the three FFE bases ---- */

/* Snap to the 0.5-ft grading convention. */
export const snapFfe = (v, step = FFE_STEP_FT) => Math.round(v / step) * step;

/* BALANCED — solveBalanceFfe over the whole assembly (pad + court + trailer row + lots), then refined to the
 * 0.1-ft grading convention with its neighbours checked, so the net lands within 500 CY wherever it can. (A
 * half-foot step on a 520 × 300 pad moves ~4,000 CY, so a 0.5-ft grid alone usually cannot reach "balanced";
 * 0.1 ft moves ~800 CY and almost always can.) `evalNet(ffe)` → net CY (+ import) or null. `range` = { lo, hi }
 * the FFE window to search. Returns { ffe, netCy, achieved } or null. */
export function* solveBalanced(evalNet, range) {
  yield;
  // The bisection YIELDS between (and, with a generator evaluator, inside) its surface builds: it used to run whole inside
  // one step — every build of the search in a single task (a 637 ms task on the owner's cross-dock, problem report 6cea9895).
  const sol = yield* solveBalanceFfeSteps({ netAtFfe: evalNet, regMinFfeFt: range.lo, maxRaiseFt: Math.max(1, range.hi - range.lo), tolCy: BALANCE_TOL_CY / 4 });
  if (!sol) return null;
  const round1 = (v) => Math.round(v * 10) / 10;
  const base = round1(sol.ffeFt);
  let best = null;
  for (const d of [-0.2, -0.1, 0, 0.1, 0.2]) {
    yield;
    const f = round1(base + d);
    const n = yield* evalSteps(evalNet, f);
    if (n == null) continue;
    if (!best || Math.abs(n) < Math.abs(best.netCy)) best = { ffe: f, netCy: n };
  }
  if (!best) return null;
  return { ffe: best.ffe, netCy: best.netCy, achieved: Math.abs(best.netCy) < BALANCE_TOL_CY };
}

/* ---- the two fix solvers ---- */

/* Nearest FFE within ±16 ft (0.5 steps) at which the slopes daylight inside the setback. `clears(ffe)` →
 * true | false | null. Tries outward alternately; when both directions clear at the same step the caller's
 * `prefer(upFfe, downFfe)` picks (default: the raise). Returns { ffe, delta } or null. */
export function* findFfeFix(clears, current, { prefer = null } = {}) {
  const steps = Math.round(FFE_FIX_RANGE_FT / FFE_STEP_FT);
  for (let k = 1; k <= steps; k++) {
    const up = current + k * FFE_STEP_FT, down = current - k * FFE_STEP_FT;
    yield;
    const u = yield* evalSteps(clears, up);
    yield;
    const d = yield* evalSteps(clears, down);
    if (u && d) {
      const pick = prefer ? prefer(up, down) : up;
      return { ffe: pick, delta: pick - current };
    }
    if (u) return { ffe: up, delta: up - current };
    if (d) return { ffe: down, delta: down - current };
  }
  return null;
}

/* Move the assembly straight AWAY from the offending cells' centroid in 5-ft steps (up to 240 ft) until
 * the slopes daylight inside the setback. `clearsAt(dx, dy)` → true | false | null. Returns
 * { dx, dy, distFt, direction } or null when nothing in range clears. */
export function* findMoveFix(clearsAt, { buildingCentre, offendCentroid }) {
  let ux = buildingCentre.x - offendCentroid.x, uy = buildingCentre.y - offendCentroid.y;
  const L = Math.hypot(ux, uy);
  if (L < 1e-6) return null;
  ux /= L; uy /= L;
  for (let d = MOVE_STEP_FT; d <= MOVE_MAX_FT; d += MOVE_STEP_FT) {
    yield;
    const dx = ux * d, dy = uy * d;
    if (yield* evalSteps(clearsAt, dx, dy)) return { dx, dy, distFt: d, direction: compass8(ux, uy) };
  }
  return null;
}

/* ---- spot elevations + fall arrows ---- */

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const STATION_COURT_WIDE_FT = 400;     // a court wider than this gets three stations, else two
const LOT_WIDE_FT = 200;               // a lot wider than this gets two, else one
export const GRADE_TAG_MIN_DEPTH_FT = 90;

/* Geometry of the labels drawn on a court / lot, in the element's WALL frame so it rotates with the
 * building: a = depth off the wall (along the plane's fall), b = along the wall. `world(a, b)` maps back to
 * feet. Elevations come from the surface's own elevation function (`zAt`) — the tiles' number, not a copy.
 *   { elId, kind, depthFt, widthFt, face: { a, b, z, label }, stations: [{ b, far: { a, z }, from, to }],
 *     tag: { a, b, text } | null, slopePct, world }
 * Returns null when the element has no wall frame (not a graded layer of a building). */
export function spotElevationsFor(plane, ring, zAt) {
  if (!plane || !plane.wall || !ring || ring.length < 3) return null;
  const { A, n, t } = plane.wall;
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const v of ring) {
    const a = (v.x - A.x) * n.x + (v.y - A.y) * n.y, b = (v.x - A.x) * t.x + (v.y - A.y) * t.y;
    if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
  }
  const depth = a1 - a0, width = b1 - b0;
  if (!(depth > 0) || !(width > 0)) return null;
  const world = (a, b) => ({ x: A.x + n.x * a + t.x * b, y: A.y + n.y * a + t.y * b });
  const isCourt = plane.classId === "dockApron";
  const m = isCourt ? (width > STATION_COURT_WIDE_FT ? 3 : 2) : (width > LOT_WIDE_FT ? 2 : 1);
  const bMid = (b0 + b1) / 2;
  const zFace = zAt(world(a0, bMid));
  const face = { a: a0, b: bMid, z: zFace, label: `${isCourt ? "dock" : "curb"} ${f1(zFace)}` };
  const stations = [];
  for (let i = 0; i < m; i++) {
    const b = b0 + ((i + 0.5) / m) * width;
    const zFar = zAt(world(a1, b));
    stations.push({ b, far: { a: a1, z: zFar, label: f1(zFar) }, from: a0 + 0.3 * depth, to: a0 + 0.7 * depth });
  }
  const mid = stations[Math.floor(m / 2)];
  const tag = depth >= GRADE_TAG_MIN_DEPTH_FT ? { a: (mid.from + mid.to) / 2, b: mid.b, text: `${f1(plane.slopePct).replace(/\.0$/, "")}% fall` } : null;
  return { elId: plane.elId, kind: isCourt ? "court" : "lot", depthFt: depth, widthFt: width, face, stations, tag, slopePct: plane.slopePct, world };
}

/* "Truck court, dock face → far edge" readout: "789.5 → 787.5 ft" from the court's middle station. */
export function courtDropReadout(spot) {
  if (!spot || !spot.stations.length) return null;
  const mid = spot.stations[Math.floor(spot.stations.length / 2)];
  return `${f1(spot.face.z)} → ${f1(mid.far.z)} ft`;
}

/* ---- the four corner spots on the pad ---- */

/* The pad's four corners (the ring itself when it is a quadrilateral, else the corners of its oriented bounding box,
 * oriented along the ring's longest edge). Returns [{x, y}] or null. */
export function padCorners(ring) {
  if (!ring || ring.length < 3) return null;
  if (ring.length === 4) return ring.map((p) => ({ x: p.x, y: p.y }));
  let best = 0, ux = 1, uy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L > best) { best = L; ux = (b.x - a.x) / L; uy = (b.y - a.y) / L; }
  }
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of ring) {
    const u = p.x * ux + p.y * uy, v = -p.x * uy + p.y * ux;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const at = (u, v) => ({ x: u * ux - v * uy, y: u * uy + v * ux });
  return [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
}

/* "cut 9.1" / "fill 6.8" at each pad corner: existing ground against the finished floor. `existAt(pt)` → ft | null.
 * A corner over a DEM void has no spot (never a guessed number). Returns [{ pt, existFt, kind, depthFt, text }]. */
export function padCornerSpots(ring, ffe, existAt) {
  const cs = padCorners(ring);
  if (!cs || !Number.isFinite(ffe) || typeof existAt !== "function") return [];
  const out = [];
  for (const pt of cs) {
    const g = existAt(pt);
    if (g == null || !Number.isFinite(g)) continue;
    const d = ffe - g;
    if (Math.abs(d) < 0.05) out.push({ pt, existFt: g, kind: "grade", depthFt: 0, text: "grade" });
    else out.push({ pt, existFt: g, kind: d < 0 ? "cut" : "fill", depthFt: Math.abs(d), text: `${d < 0 ? "cut" : "fill"} ${f1(Math.abs(d))}` });
  }
  return out;
}

/* A ring's area in square feet (shoelace). */
export function ringSf(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; a += p.x * q.y - q.x * p.y; }
  return Math.abs(a) / 2;
}
