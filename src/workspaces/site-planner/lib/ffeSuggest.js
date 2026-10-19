/* FFE suggestion (owner-only grading layer, round 2) — the finished-floor elevation is always SUGGESTED, never
 * asked for. "You're asking for the FFE, that's not something I need to be calculating; suggest an FFE that makes
 * sense based on how a Georgia developer would look at it."
 *
 * The suggestion is the balanced-dirt solve over the WHOLE graded assembly (pad + courts + trailer rows + lots +
 * walks), at 0.1 ft, THEN adjusted and explained by these rules, in this order, each contributing a clause to the
 * plain-words basis line when it fires:
 *   1. POND SPOIL counts as fill — a detention pond's cut is dirt on site, so "balanced" means pad cut + pond cut
 *      ≈ pad fill.
 *   2. ROCK — no cut under the pad or pavement may go deeper than depth-to-rock minus 2 ft; if the balanced FFE
 *      breaks that, raise it to the lowest value that clears it. No rock data → nothing is said.
 *   3. DOCKS ON THE LOW SIDE — a court on higher ground than the pad faces uphill. The FFE does not change; the
 *      basis says which court and what it costs (and, for a one-sided building, what flipping the docks buys).
 *   4. MAX CUT / FILL under the pad is a SOFT limit — the balance is kept, the basis warns. Never blocks.
 * A plan-wide FFE floor (the flood rule's required finished floor) is a hard minimum: the suggestion never dips below it.
 *
 * Pure, no DOM, Node-tested. Feet and cubic yards. The solvers are GENERATORS that `yield` before every surface
 * build so runChunked can keep the UI alive between builds; every surface build goes through ONE closure the
 * caller supplies, so a verdict here can never differ from what the tiles paint. */
import { solveBalanced, compass8, cap, BALANCE_TOL_CY } from "./buildingGrade.js";

export const ROCK_CLEARANCE_FT = 2;      // cut may go no deeper than depth-to-rock minus this
export const DOCK_UPHILL_MIN_FT = 1;     // a court is "uphill" when its ground is this much above the pad's mean ground
export const SOFT_DEPTH_FT = 12;         // default max cut / fill under a pad
const MAX_ROCK_PASSES = 5;

const round1 = (v) => Math.round(v * 10) / 10;
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const nf = (v) => Math.round(v).toLocaleString("en-US");

/* ---- words ---- */

/* A volume as a person says it: 54,248 → "54k", 4,310 → "4,300", 615 → "600". */
export function fmtCyShort(cy) {
  const v = Math.abs(cy);
  if (v >= 10000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return nf(Math.round(v / 100) * 100);
  if (v >= 100) return nf(Math.round(v / 100) * 100);
  return nf(Math.round(v / 10) * 10);
}
/* The sign word for a net: import (+) / export (−) / balanced. */
export const netWord = (netCy) => (Math.abs(netCy) < BALANCE_TOL_CY ? "balanced" : netCy < 0 ? "export" : "import");

/* The four-way side an offset points to in the planner's frame (x east, y SOUTH). null when it is too small to name. */
export function fourWay(dx, dy, minFt = 8) {
  if (Math.hypot(dx, dy) < minFt) return null;
  return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "east" : "west") : (dy > 0 ? "south" : "north");
}
export const OPPOSITE = Object.freeze({ north: "south", south: "north", east: "west", west: "east" });

/* ---- reading a surface grid for one assembly ---- */

/* Volume-weighted centroids of the cut and the fill over the assembly's cells (slopes included — they are priced too). */
export function cutFillCentroids(grid, ids) {
  const acc = { cut: { w: 0, x: 0, y: 0 }, fill: { w: 0, x: 0, y: 0 } };
  if (!grid || !grid.cells) return { cut: null, fill: null };
  for (const c of grid.cells) {
    if (!ids.has(c.elId) || c.dzFt == null) continue;
    const a = c.dzFt < 0 ? acc.cut : acc.fill;
    const w = Math.abs(c.dzFt) * c.wFt * c.hFt;
    a.w += w; a.x += w * c.x; a.y += w * c.y;
  }
  const at = (a) => (a.w > 0 ? { x: a.x / a.w, y: a.y / a.w } : null);
  return { cut: at(acc.cut), fill: at(acc.fill) };
}

/* The deepest cut and fill under the PAD itself (not the pavement or the slopes), and where. */
export function padDepths(grid, buildingId) {
  let cut = null, fill = null;
  if (!grid || !grid.cells) return { cut, fill };
  for (const c of grid.cells) {
    if (c.elId !== buildingId || c.wedge || c.dzFt == null) continue;
    if (c.dzFt < 0 && (!cut || -c.dzFt > cut.ft)) cut = { ft: -c.dzFt, x: c.x, y: c.y };
    if (c.dzFt > 0 && (!fill || c.dzFt > fill.ft)) fill = { ft: c.dzFt, x: c.x, y: c.y };
  }
  return { cut, fill };
}

/* Where on the building a point is, in words: "NW corner" when it sits out toward a corner, else "north side".
 * `half` = the building's half extents (ft). */
export function padSpotWord(pt, centre, half) {
  const dx = pt.x - centre.x, dy = pt.y - centre.y;
  const rx = half.x > 0 ? Math.abs(dx) / half.x : 0, ry = half.y > 0 ? Math.abs(dy) / half.y : 0;
  const ns = dy < 0 ? "N" : "S", ew = dx < 0 ? "W" : "E";
  if (rx > 0.5 && ry > 0.5) return `${ns}${ew} corner`;
  const w = fourWay(dx, dy, 1);
  return w ? `${w} side` : "middle";
}

/* ---- rock ---- */

/* depth-to-rock lookup over SSURGO map-unit polygons (fetchBedrockView's `polys`: { depthCm, polygons: [rings[lng,lat]] }).
 * Returns (feetPt) → depth to rock in FEET (shallowest unit covering the point) or null — null means "no rock recorded
 * here", which is not "no rock": it simply constrains nothing. */
export function rockDepthLookup(polys, origin, toLatLng) {
  if (!Array.isArray(polys) || !polys.length || !origin || typeof toLatLng !== "function") return null;
  const prepared = [];
  for (const p of polys) {
    const depthFt = Number(p.depthCm) / 2.54 / 12;
    if (!Number.isFinite(depthFt) || depthFt < 0) continue;
    for (const rings of p.polygons || []) {
      if (!rings || !rings.length) continue;
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      for (const [lng, lat] of rings[0]) { if (lng < w) w = lng; if (lng > e) e = lng; if (lat < s) s = lat; if (lat > n) n = lat; }
      prepared.push({ depthFt, rings, w, s, e, n });
    }
  }
  if (!prepared.length) return null;
  const inRing = (lng, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return (pt) => {
    const [lat, lng] = toLatLng(pt, origin.lat, origin.lon);
    let best = null;
    for (const q of prepared) {
      if (lng < q.w || lng > q.e || lat < q.s || lat > q.n) continue;
      if (!inRing(lng, lat, q.rings[0])) continue;
      let hole = false;
      for (let k = 1; k < q.rings.length; k++) if (inRing(lng, lat, q.rings[k])) { hole = true; break; }
      if (hole) continue;
      if (best == null || q.depthFt < best) best = q.depthFt;
    }
    return best;
  };
}

/* How far the assembly's CUT goes past what the rock allows: for every ground-contact cell of the pad and the
 * pavement (slopes are not "under" anything), over = cutDepth − max(0, depthToRock − 2). Returns
 * { raiseFt (the largest overshoot, 0 when clear), at: {x,y}, depthFt (rock depth there) }. */
export function rockViolation(grid, ids, rockAt) {
  const out = { raiseFt: 0, at: null, depthFt: null };
  if (!grid || !grid.cells || typeof rockAt !== "function") return out;
  for (const c of grid.cells) {
    if (!ids.has(c.elId) || c.wedge || c.dzFt == null || c.dzFt >= 0) continue;
    const r = rockAt({ x: c.x, y: c.y });
    if (r == null) continue;
    const over = -c.dzFt - Math.max(0, r - ROCK_CLEARANCE_FT);
    if (over > out.raiseFt) { out.raiseFt = over; out.at = { x: c.x, y: c.y }; out.depthFt = r; }
  }
  return out;
}

/* ---- the docks ---- */

/* Each truck court against the pad. A court is UPHILL when its mean existing ground is ≥ 1 ft above the pad's. For
 * each: how deep its cut or fill runs (mean |dz| over its cells) and — mirroring it through the building's centre,
 * which puts it on the opposite wall with the SAME proposed elevations — what it would run if the docks faced the
 * other way. Returns [{ id, side, uphill, depthFt, kind: "cut"|"fill", flipDepthFt|null, flipKind|null }]. */
export function courtReport({ grid, planes, els, buildingId, ids, existAt, centre }) {
  if (!grid || !grid.cells || !planes) return [];
  const courts = els.filter((e) => ids.has(e.id) && e.id !== buildingId && e.type !== "trailer" && planes.get(e.id) && planes.get(e.id).classId === "dockApron");
  if (!courts.length) return [];
  let padSum = 0, padN = 0;
  for (const c of grid.cells) {
    if (c.elId !== buildingId || c.wedge || c.dzFt == null || c.propFt == null) continue;
    padSum += c.propFt - c.dzFt; padN++;
  }
  const padGround = padN ? padSum / padN : null;
  const out = [];
  for (const ct of courts) {
    let gSum = 0, dzSum = 0, absSum = 0, n = 0, flipAbs = 0, flipN = 0, cx = 0, cy = 0;
    for (const c of grid.cells) {
      if (c.elId !== ct.id || c.wedge || c.dzFt == null || c.propFt == null) continue;
      gSum += c.propFt - c.dzFt; dzSum += c.dzFt; absSum += Math.abs(c.dzFt); n++; cx += c.x; cy += c.y;
      if (typeof existAt === "function") {
        const g2 = existAt({ x: 2 * centre.x - c.x, y: 2 * centre.y - c.y });
        if (g2 != null && Number.isFinite(g2)) { flipAbs += Math.abs(c.propFt - g2); flipN++; }
      }
    }
    if (!n) continue;
    const ground = gSum / n;
    const side = fourWay(cx / n - centre.x, cy / n - centre.y, 1);
    const flipDepthFt = flipN > n * 0.8 ? flipAbs / flipN : null;
    out.push({
      id: ct.id, side, uphill: padGround != null && ground - padGround >= DOCK_UPHILL_MIN_FT,
      depthFt: absSum / n, kind: dzSum <= 0 ? "cut" : "fill", flipDepthFt,
      groundAbovePadFt: padGround != null ? ground - padGround : null,
    });
  }
  return out;
}

/* ---- the basis, in plain words ---- */

/* The balance clause. `e` = the assembly's earthwork { cutCy, fillCy, netCy } (the pad's own — the pond is NOT in it);
 * `cutSide` / `fillSide` = where the cut and the fill sit relative to the building; `pondCy` = the spoil credited to
 * THIS building, `pondWhole` = the pond's whole cut when several buildings share it. */
export function balanceClause({ e, cutSide, fillSide, pondCy = 0, pondWhole = null, achieved = true }) {
  const net = e.netCy - pondCy;
  const w = netWord(net);
  const lead = achieved || w === "balanced" ? "Balances the dirt" : "Closest the ground gets to balanced";
  const cut = `${fmtCyShort(e.cutCy)} CY cut${cutSide ? ` on the ${cutSide}` : ""}`;
  const fill = `${fmtCyShort(e.fillCy)} CY fill${fillSide ? ` on the ${fillSide}` : ""}`;
  const pond = pondCy > 0 ? `; the pond digs ${fmtCyShort(pondWhole != null ? pondWhole : pondCy)} CY that ${fillSide ? `fills the ${fillSide} side` : "goes into the fill"}` : "";
  const tail = w === "balanced" ? "nothing to haul" : `${fmtCyShort(net)} CY ${w}`;
  return `${lead}: ${cut}, ${fill}${pond}; ${tail}.`;
}

/* The docks clause(s). */
export function dockClause(courts) {
  if (!courts || !courts.length) return null;
  const up = courts.filter((c) => c.uphill);
  if (!up.length) return "Docks sit on the low side, so the courts drain away from the building.";
  const one = courts.length === 1;
  return up.map((c) => {
    const base = `The ${c.side || "dock"} court faces uphill, so its ${c.kind} runs ${nf(Math.max(1, Math.round(c.depthFt)))} ft deep`;
    if (one && c.side && c.flipDepthFt != null && c.flipDepthFt + 0.5 < c.depthFt) {
      const n = Math.max(0, Math.round(c.flipDepthFt));
      return `${base}; flipping the docks ${OPPOSITE[c.side]} would cut that to ${n} ft.`;
    }
    return `${base}.`;
  }).join(" ");
}

/* The rock clause. */
export function rockClause({ raisedFt, sideWord, depthFt }) {
  return `Raised ${f1(raisedFt).replace(/\.0$/, "")} ft to stay out of rock${sideWord ? ` on the ${sideWord} end` : ""} (bedrock about ${nf(Math.max(1, Math.round(depthFt)))} ft down there).`;
}

/* The soft-depth clause. `d` = { ft, word, kind }. */
export function depthClause({ ft, word, kind, limitFt }) {
  return `${cap(kind)} reaches ${nf(Math.round(ft))} ft at the ${word}; past ${nf(limitFt)} ft most Georgia sites terrace or wall. Consider a second pad.`;
}

/* The flood-floor clause. */
export function floorClause(floorFt) {
  return `Held at the site's required finished floor, ${f1(floorFt)} ft.`;
}

/* Priority when more than three sentences want a place: the balance clause leads; then what CHANGED the answer
 * (floor, rock), then the warning, then the docks. At most three sentences. */
const ORDER = ["balance", "floor", "rock", "depth", "docks"];
export function composeBasis(clauses, { max = 3 } = {}) {
  const by = new Map(clauses.filter(Boolean).map((c) => [c.id, c]));
  const out = [];
  for (const id of ORDER) if (by.has(id)) out.push(by.get(id).text);
  return out.slice(0, max).join(" ");
}

/* ---- the solver ---- */

/* The auto FFE for one building. Callers supply:
 *   evalNet(ffe)  → the assembly's net CY (+ import) at that finish, or null when it cannot be priced
 *   evalGrid(ffe) → the proposed surface's grid at that finish (for the rock check), or null
 *   range         → { lo, hi } the FFE window to search
 *   ids           → the assembly's element ids
 * Options: pondCy (spoil available as fill), floorFt (hard minimum), rockAt (see rockDepthLookup).
 * Resolves { ffe, solvedFfe, achieved, netCy, floored, rock } or null when the ground cannot be priced. */
export function* suggestFfe({ evalNet, evalGrid, range, ids, pondCy = 0, floorFt = null, rockAt = null }) {
  const netEff = (f) => { const n = evalNet(f); return n == null ? null : n - pondCy; };
  const bal = yield* solveBalanced(netEff, range);
  if (!bal) return null;
  let ffe = bal.ffe;
  const solvedFfe = ffe;
  let floored = false;
  if (floorFt != null && Number.isFinite(floorFt) && ffe < floorFt) { ffe = round1(floorFt); floored = true; }
  let rock = null;
  if (typeof rockAt === "function" && typeof evalGrid === "function") {
    for (let pass = 0; pass < MAX_ROCK_PASSES; pass++) {
      yield;
      const g = evalGrid(ffe);
      const v = rockViolation(g, ids, rockAt);
      if (!(v.raiseFt > 0.04)) break;
      const raise = Math.ceil(v.raiseFt * 10) / 10;
      ffe = round1(ffe + raise);
      rock = rock ? { ...rock, raisedFt: round1(ffe - rock.fromFfe) } : { fromFfe: round1(ffe - raise), raisedFt: raise, at: v.at, depthFt: v.depthFt };
      if (floorFt != null && ffe < floorFt) ffe = round1(floorFt);
    }
  }
  return { ffe: round1(ffe), solvedFfe, achieved: bal.achieved, netCy: bal.netCy + pondCy, floored, rock };
}
