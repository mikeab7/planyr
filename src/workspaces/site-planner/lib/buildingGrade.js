/* Building-grade helpers (NEW-3, owner-only grading layer) — everything the Site Analysis "Building" tab
 * and the grading layers need that is NOT the surface itself: which elements belong to a building, its
 * earthwork tiles (read from the SAME lattice the earthwork rows use), the setback flag in plain words,
 * the three FFE basis solvers, the two fix solvers, and the spot-elevation geometry drawn on the court
 * and the lots.
 *
 * Pure, no DOM, Node-tested. Feet and cubic yards; elevations ft NAVD88. Bank volumes — no stripping,
 * no shrink or swell (owner rule). The solvers are GENERATORS that `yield` before every surface build so
 * a driver (runChunked) can keep the UI alive between builds; runSync drives them to completion in tests.
 *
 * Every surface build goes through ONE closure the caller supplies — `evalAt({ ffe, dx, dy })` →
 * proposed surface (buildProposedSurface on the shared inputs with the building's FFE and/or the
 * assembly shifted). The solvers never build a surface of their own, so a verdict here can never differ
 * from what the tiles paint. */
import { solveBalanceFfe } from "./ffeBalance.js";
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
export const withFfe = (els, buildingId, ffe) => els.map((e) => (e.id === buildingId ? { ...e, padElevFt: ffe } : e));

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
/* Drive a solver without hogging the main thread: pump until `sliceMs` is spent, then yield to the event
 * loop via a MessageChannel (never a clamped timer — a hidden tab must not stall it). `isStale()` abandons
 * the run (a newer request superseded it) and resolves `{ stale: true }`. */
export function runChunked(gen, { sliceMs = 10, isStale = null, now = () => (typeof performance !== "undefined" ? performance.now() : Date.now()) } = {}) {
  const tick = () => new Promise((res) => {
    if (typeof MessageChannel === "undefined") { setTimeout(res, 0); return; }
    const mc = new MessageChannel(); mc.port1.onmessage = () => { mc.port1.close(); res(); }; mc.port2.postMessage(0);
  });
  return (async () => {
    let r = gen.next();
    let t0 = now();
    while (!r.done) {
      if (isStale && isStale()) return { stale: true };
      if (now() - t0 >= sliceMs) { await tick(); t0 = now(); if (isStale && isStale()) return { stale: true }; }
      r = gen.next();
    }
    return r.value;
  })();
}

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
  const sol = solveBalanceFfe({ netAtFfe: evalNet, regMinFfeFt: range.lo, maxRaiseFt: Math.max(1, range.hi - range.lo), tolCy: BALANCE_TOL_CY / 4 });
  if (!sol) return null;
  const round1 = (v) => Math.round(v * 10) / 10;
  const base = round1(sol.ffeFt);
  let best = null;
  for (const d of [-0.2, -0.1, 0, 0.1, 0.2]) {
    yield;
    const f = round1(base + d);
    const n = evalNet(f);
    if (n == null) continue;
    if (!best || Math.abs(n) < Math.abs(best.netCy)) best = { ffe: f, netCy: n };
  }
  if (!best) return null;
  return { ffe: best.ffe, netCy: best.netCy, achieved: Math.abs(best.netCy) < BALANCE_TOL_CY };
}

/* LEAST DIRT — the FFE minimising cut + fill. cut + fill is convex in the pad elevation, so an integer
 * ternary search over 0.5-ft steps finds it in ~log steps. `evalDirt(ffe)` → cut + fill CY or null. */
export function* solveLeastDirt(evalDirt, range) {
  let lo = Math.round(range.lo / FFE_STEP_FT), hi = Math.round(range.hi / FFE_STEP_FT);
  const memo = new Map();
  const f = function* (k) { if (!memo.has(k)) { yield; memo.set(k, evalDirt(k * FFE_STEP_FT)); } return memo.get(k); };
  while (hi - lo > 2) {
    const m1 = lo + Math.floor((hi - lo) / 3), m2 = hi - Math.floor((hi - lo) / 3);
    const a = yield* f(m1), b = yield* f(m2);
    if (a == null || b == null) return null;
    if (a <= b) hi = m2; else lo = m1;
  }
  let best = null;
  for (let k = lo; k <= hi; k++) {
    const v = yield* f(k);
    if (v == null) return null;
    if (!best || v < best.dirtCy) best = { ffe: k * FFE_STEP_FT, dirtCy: v };
  }
  return best;
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
    const u = clears(up);
    yield;
    const d = clears(down);
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
    if (clearsAt(dx, dy)) return { dx, dy, distFt: d, direction: compass8(ux, uy) };
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

/* ---- FFE basis copy ---- */
export const BASES = Object.freeze([
  { id: "balanced", label: "Balanced dirt" },
  { id: "least", label: "Least dirt" },
  { id: "room", label: "Most room" },
]);
export function basisNote(basis, { netCy = null, dirtCy = null, bestFinish = null } = {}) {
  const cy = (v) => Math.round(Math.abs(v)).toLocaleString("en-US");
  switch (basis) {
    case "balanced": return netCy != null ? `Balanced: cut and fill within ${cy(netCy)} CY of each other.` : "Balanced: cut and fill as close to equal as the ground allows.";
    case "least": return dirtCy != null ? `Least dirt: ${cy(dirtCy)} CY of cut plus fill, the minimum.` : "Least dirt: the finish that moves the fewest yards.";
    case "room": return bestFinish != null ? `Most room: the finish with the biggest single level pad (${f1(bestFinish)} ft).` : "Most room: the finish with the biggest single level pad.";
    default: return "Typed. Pick a chip to let the ground choose.";
  }
}
