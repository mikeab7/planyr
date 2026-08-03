/* lib/roundabout.js — roundabouts at a road terminus (NEW-5).
 *
 * WHAT THIS IS. Right-clicking a road's END control point offers "Roundabout", which turns that
 * terminus into a real one: a circular travelway (the CIRCULATORY roadway), a central ISLAND that is
 * a genuine hole in the pavement, and each approach leg tied in with proper CURB RETURNS rather than
 * a circle pasted over the road end.
 *
 * THE THREE THINGS THAT MAKE IT REAL RATHER THAN DECORATIVE — the owner named all three, and they
 * are the reason this module is pure and unit-tested rather than a render-time flourish:
 *
 *  1. THE PAVEMENT MATH KNOWS ABOUT IT. `roundaboutArea` is the ANNULUS — outer disc minus the
 *     central island — and the approach legs are SHORTENED by the inscribed radius so the leg strip
 *     stops at the circle instead of running to the middle and paving over the island.
 *     `legTrimFor` is that shortening, and every consumer of a road's strip (the drawn pavement, the
 *     curb stripes, the paved-area figure, the dissolve) takes it from the one place.
 *  2. THE CURB ENGINE KNOWS ABOUT IT. The rings are contributed into the SAME `dissolveRings` union
 *     the rest of the road network goes through, so the circulatory roadway and its legs come out as
 *     ONE region with ONE continuous curb outline and the island as a real hole. The annulus is
 *     emitted as arc SECTORS whose union IS the annulus, so no boolean difference is needed —
 *     union-only, which is the one operation the dissolve is already proven on.
 *  3. THE DESIGN VEHICLE DECIDES THE SIZE. An auto drive aisle, a fire lane and a WB-67 truck route
 *     do NOT get the same circle. See `roundaboutDiameterFor`.
 *
 * BONDING. A roundabout is stored ON THE ROAD, at a terminus (`el.roundabout = {end, d}`), and every
 * piece of its geometry is derived from that road's CURRENT `pts`. So moving or re-aligning the road
 * carries it and re-derives the leg tie-ins for free — there is no second copy of the position to
 * keep in sync, which is this repo's whole ROWS-CANONICAL / assembly-integrity lesson applied to
 * geometry. A SECOND road whose own terminus lands on the same node joins as another LEG rather than
 * creating a second circle (`roundaboutNodes` groups by node, and the largest declared diameter
 * wins).
 *
 * ⚠ SCREENING VALUES, NOT A DESIGN. The diameter bands below are the published FHWA/NCHRP category
 * ranges, and they are starting points to check against the adopted local standard — exactly the
 * convention `roadClasses.js` already sets for its radii ("BALLPARK starting points to verify").
 * Nothing here is authoritative and every value is user-editable through the same inline numeric
 * editor every other dimension uses.
 *
 * Pure (no React, no DOM): world feet in, world feet out. Unit-tested in test/roundabout.test.js. */

import { classMinRadius } from "./roadClasses.js";

const TAU = Math.PI * 2;
const EPS = 1e-9;

/* Inscribed-circle diameter bands, ft, by road class — FHWA "Roundabouts: An Informational Guide"
 * (NCHRP Report 672) category ranges:
 *   mini roundabout            45–90 ft   (passenger-car design vehicle; traversable island)
 *   single-lane roundabout     90–180 ft  (the band a bus / SU / WB-67 approach falls in)
 * The fire-lane floor is the single-lane bottom end because IFC Appendix D's apparatus turning
 * requirement (commonly 28 ft inside / 48 ft outside) does not fit a mini. `public` is given the
 * single-lane urban band directly: that class's `minRadius` is a HORIZONTAL CURVE radius derived
 * from design speed, not a design-vehicle turning radius, so it must not be fed to the formula. */
export const ROUNDABOUT_BANDS = {
  aisle:  { min: 45,  max: 90,  note: "mini roundabout (passenger car)" },
  fire:   { min: 90,  max: 180, note: "single-lane (fire apparatus)" },
  truck:  { min: 130, max: 180, note: "single-lane (WB-67)" },
  public: { min: 100, max: 180, note: "single-lane (urban collector)", fixed: 140 },
  custom: { min: 45,  max: 200, note: "custom" },
};
const DEFAULT_BAND = { min: 45, max: 200, note: "custom" };

export const ROUNDABOUT_MIN_D = 30;   // ft — below this it is a painted dot, not a roundabout
export const ROUNDABOUT_MAX_D = 400;  // ft — a sanity ceiling for a hand-typed value

/* The CIRCULATORY ROADWAY width (ft) — the paved ring the vehicle drives on, between the central
 * island and the outer curb. Takes the approach's own travel width, floored at a single lane and
 * capped so a wide multi-lane approach doesn't imply a multi-lane circle by accident. */
export function circulatoryWidthFt(travelWFt) {
  const w = +travelWFt || 0;
  return Math.max(16, Math.min(w > 0 ? w : 20, 30));
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* THE DERIVATION. Inscribed diameter = twice the design vehicle's minimum turning radius plus one
 * circulatory width — the swept path plus the lane it is swept in — then clamped into the class's
 * published band. A speed-based class (`public`) has no turning radius to read, so it takes its
 * band's `fixed` value outright rather than a number derived from the wrong input.
 * `cls` is a road-class config from `roadClasses.js`. Pure. */
export function roundaboutDiameterFor(cls, travelWFt) {
  const band = (cls && ROUNDABOUT_BANDS[cls.key]) || DEFAULT_BAND;
  const W = circulatoryWidthFt(travelWFt);
  if (band.fixed) return clamp(band.fixed, band.min, band.max);
  const Rt = classMinRadius(cls);
  const raw = Rt > 0 ? 2 * Rt + W : band.min;
  return Math.round(clamp(raw, band.min, band.max));
}

/* The band a class's roundabout is sized within, for the honest "why is it this big" note. */
export const roundaboutBandFor = (cls) => (cls && ROUNDABOUT_BANDS[cls.key]) || DEFAULT_BAND;

/* Sanitise a stored / hand-typed diameter. */
export const normalizeRoundaboutD = (d, fallback) => {
  const n = +d;
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return clamp(n, ROUNDABOUT_MIN_D, ROUNDABOUT_MAX_D);
};

/* How far a leg's centerline must be SHORTENED so its strip stops AT the circle instead of paving
 * over the central island. This is the number that makes claim (1) above true, and it is exported so
 * the renderer, the curb stripes and the paved-area figure all take it from one place.
 *
 * It is √(R² − half²), NOT R. Trimming by the radius stops the CENTERLINE on the circle, which
 * leaves the strip's square end face poking a foot or two past the arc at its outer corners — and
 * the lens-shaped void between that face and the arc closes as a genuine HOLE in the dissolved
 * pavement (measured: two of them, one per side). Trimming by the half-chord instead lands both
 * end-face corners exactly ON the circle, so the strip meets it flush across its full width.
 * Floored at the island radius so a very wide leg can never be trimmed so little that it reaches
 * the central island — the one thing the trim exists to prevent. */
export function legTrimFor(dFt, halfFt = 0, travelWFt = undefined) {
  const R = Math.max(0, (+dFt || 0) / 2);
  if (!(R > 0)) return 0;
  const half = Math.max(0, +halfFt || 0);
  const islandR = Math.max(0, R - circulatoryWidthFt(travelWFt === undefined ? halfFt * 2 : travelWFt));
  return Math.max(islandR, Math.min(R, Math.sqrt(Math.max(0, R * R - half * half))));
}

/* Plan-view PAVED area (sf) of the circulatory roadway: the annulus, never the whole disc.
 * The central island is landscaped, not paved, so counting it would overstate impervious cover —
 * which is the number a detention calculation is priced off. */
export function roundaboutArea(dFt, travelWFt) {
  const R = (+dFt || 0) / 2;
  if (!(R > 0)) return 0;
  const ri = Math.max(0, R - circulatoryWidthFt(travelWFt));
  return Math.PI * (R * R - ri * ri);
}

/* The central island's area (sf) — reported separately so a yield readout can say what the circle
 * costs in land versus what it adds in pavement. */
export function roundaboutIslandArea(dFt, travelWFt) {
  const ri = Math.max(0, (+dFt || 0) / 2 - circulatoryWidthFt(travelWFt));
  return Math.PI * ri * ri;
}

/* A closed circle polygon, tessellated at `tessDeg` per step (the road engine's own convention). */
export function circleRing(center, r, tessDeg = 6) {
  const steps = Math.max(12, Math.ceil(360 / Math.max(1, tessDeg)));
  const out = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TAU;
    out.push({ x: center.x + r * Math.cos(a), y: center.y + r * Math.sin(a) });
  }
  return out;
}

/* THE ANNULUS AS A UNION, NOT A DIFFERENCE.
 *
 * `dissolveRings` unions; it has no subtract. Emitting the circulatory roadway as arc SECTORS —
 * each bounded by an outer arc, a radial, an inner arc and a radial — means their union IS the
 * annulus, with the central island falling out as a genuine PolyTree hole (the same shape the
 * dissolve already handles for a road loop encircling an island). Union-only is also the operation
 * the dissolve is proven on, so this adds no new failure mode. Returns [] for a degenerate ring. */
export function annulusSectors(center, rOuter, rInner, { tessDeg = 6, sectors = 8 } = {}) {
  const R = +rOuter || 0, ri = Math.max(0, +rInner || 0);
  if (!(R > EPS) || ri >= R - EPS) return [];
  const n = Math.max(4, sectors | 0);
  const perSector = Math.max(2, Math.ceil(360 / n / Math.max(1, tessDeg)));
  const out = [];
  for (let s = 0; s < n; s++) {
    const a0 = (s / n) * TAU, a1 = ((s + 1) / n) * TAU;
    const poly = [];
    for (let i = 0; i <= perSector; i++) {
      const a = a0 + ((a1 - a0) * i) / perSector;
      poly.push({ x: center.x + R * Math.cos(a), y: center.y + R * Math.sin(a) });
    }
    for (let i = perSector; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / perSector;
      poly.push({ x: center.x + ri * Math.cos(a), y: center.y + ri * Math.sin(a) });
    }
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

/* CURB RETURNS, one per leg edge.
 *
 * A leg arrives with half-width `half` along a unit direction `u` pointing OUT from the centre. Its
 * two back-of-curb edges are the lines offset ±half from the leg axis. Where an edge meets the
 * circle there is an armpit exactly like the one `nodeJunction` fillets at a tee, and leaving it
 * square is what "a circle pasted over the road end" looks like.
 *
 * The return is an arc of radius `Rr` tangent to BOTH the leg edge and the outer circle, on the
 * outside of the circle — so its centre sits at distance (R + Rr) from the roundabout centre and at
 * distance (half + Rr) from the leg axis. Those two conditions place it exactly; when they cannot be
 * satisfied (a leg wider than the circle) the return is simply omitted rather than faked.
 *
 * The emitted polygon is ADDITIVE and deliberately overlaps both pavements — the same convention
 * and the same reason as `nodeJunction`'s wedges: only the arc is a real boundary, and reaching
 * inside both bridges any tessellation mismatch instead of leaving a hair-thin seam.
 * Returns an array of world-feet rings (0, 1 or 2 per leg). */
export function legReturnWedges(center, R, leg, Rr, tessDeg = 6) {
  const out = [];
  if (!leg || !leg.u || !(R > EPS) || !(Rr > EPS)) return out;
  const u = leg.u, half = Math.max(0, +leg.half || 0);
  const nrm = { x: -u.y, y: u.x };                 // left of the leg direction
  const D = R + Rr;                                 // centre-to-fillet-centre
  for (const side of [1, -1]) {
    const off = half + Rr;                          // fillet centre's distance from the leg axis
    if (off >= D - EPS) continue;                   // leg wider than the circle can return around
    // Fillet centre F = center + u*t + nrm*(side*off), with |F − center| = D  ⇒  t = √(D² − off²).
    const t = Math.sqrt(Math.max(0, D * D - off * off));
    const F = { x: center.x + u.x * t + nrm.x * side * off, y: center.y + u.y * t + nrm.y * side * off };
    // Tangent on the CIRCLE: along the centre→F ray, at radius R.
    const dF = { x: F.x - center.x, y: F.y - center.y };
    const dL = Math.hypot(dF.x, dF.y) || 1;
    const tanC = { x: center.x + (dF.x / dL) * R, y: center.y + (dF.y / dL) * R };
    // Tangent on the LEG EDGE: F projected onto the edge line (foot of the perpendicular).
    const edgePt = { x: center.x + nrm.x * side * half, y: center.y + nrm.y * side * half };
    const along = (F.x - edgePt.x) * u.x + (F.y - edgePt.y) * u.y;
    const tanE = { x: edgePt.x + u.x * along, y: edgePt.y + u.y * along };
    // The concave arc from tanC to tanE, swept about F the short way.
    const a0 = Math.atan2(tanC.y - F.y, tanC.x - F.x);
    const a1 = Math.atan2(tanE.y - F.y, tanE.x - F.x);
    let sweep = a1 - a0;
    while (sweep > Math.PI) sweep -= TAU;
    while (sweep < -Math.PI) sweep += TAU;
    const steps = Math.max(2, Math.ceil((Math.abs(sweep) * 180) / Math.PI / Math.max(1, tessDeg)));
    const arc = [];
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      arc.push({ x: F.x + Rr * Math.cos(a), y: F.y + Rr * Math.sin(a) });
    }
    /* CLOSE THROUGH THE CORNER THE ARC CUTS OFF — the gore between the arc, the leg edge and the
       circle. Both closing edges lie ON existing pavement boundaries (the leg edge line and the
       circle), so the only NEW boundary this polygon contributes is the arc itself: that is what
       "additive wedge" means here, exactly as in `nodeJunction`.
       ⚠ The closure must run through the corner and NOT straight from one tangent point to the
       other. A direct chord passes INSIDE the fillet circle — it crosses its own arc, and a
       self-intersecting ring is dropped by the union, which is how a "return" ends up floating as
       its own island instead of joining the pavement. */
    const cross = Math.sqrt(Math.max(0, R * R - half * half));   // leg edge ∩ circle, along the leg
    const corner = { x: center.x + u.x * cross + nrm.x * side * half, y: center.y + u.y * cross + nrm.y * side * half };
    // A hair INSIDE both surfaces, so the boundaries CROSS rather than one merely stopping on the
    // other (the sub-inch tessellation mismatch the dissolve's morphological close is sized for).
    const bias = Math.min(0.5, half * 0.25, R * 0.05);
    const inner = { x: corner.x - u.x * bias - nrm.x * side * bias, y: corner.y - u.y * bias - nrm.y * side * bias };
    const poly = [...arc, inner];
    if (poly.length >= 3) out.push(poly);
  }
  return out;
}

/* Collect every roundabout DECLARED on a set of road elements, grouped by NODE, so two roads whose
 * termini meet at the same point produce ONE circle with two legs rather than two overlapping ones.
 *
 * `roads` is [{ id, pts, travelW, curbW, roundabout }]. `nodeTolFt` is how close two termini must be
 * to count as the same node — the caller passes the same slack the tee detector uses, so a junction
 * the owner drew by hand is recognised the same way in both places.
 *
 * Returns [{ key, center, d, legs:[{roadId, end, u, half}], roadIds }]. A leg's `u` points AWAY from
 * the centre, along the road's own approach bearing. Pure. */
export function roundaboutNodes(roads, { nodeTolFt = 2, diameterFor = null } = {}) {
  const declared = [];
  for (const r of roads || []) {
    const ra = r && r.roundabout;
    if (!ra || !Array.isArray(r.pts) || r.pts.length < 2) continue;
    const end = ra.end === "start" ? "start" : "end";
    const i = end === "start" ? 0 : r.pts.length - 1;
    const p = r.pts[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    declared.push({ road: r, end, node: { x: p.x, y: p.y }, d: +ra.d || 0 });
  }
  if (!declared.length) return [];

  // Group termini that coincide.
  const groups = [];
  for (const dec of declared) {
    const g = groups.find((q) => Math.hypot(q.center.x - dec.node.x, q.center.y - dec.node.y) <= nodeTolFt);
    if (g) g.members.push(dec);
    else groups.push({ center: { ...dec.node }, members: [dec] });
  }

  const out = [];
  for (const g of groups) {
    // The largest declared diameter wins: a truck leg and an aisle leg meeting at one node must get
    // the truck's circle, never the aisle's — the smaller one cannot turn the bigger vehicle.
    let d = 0;
    for (const m of g.members) {
      const own = m.d > 0 ? m.d : (diameterFor ? diameterFor(m.road) : 0);
      if (own > d) d = own;
    }
    if (!(d >= ROUNDABOUT_MIN_D)) continue;
    const legs = [];
    const roadIds = [];
    for (const m of g.members) {
      const pts = m.road.pts;
      const i = m.end === "start" ? 0 : pts.length - 1;
      const j = m.end === "start" ? 1 : pts.length - 2;
      const a = pts[i], b = pts[j];
      // Direction OUT of the roundabout, i.e. from the node toward the rest of the road.
      const vx = b.x - a.x, vy = b.y - a.y;
      const L = Math.hypot(vx, vy);
      if (!(L > EPS)) continue;
      const outer = (+m.road.travelW || 0) / 2 + (+m.road.curbW || 0);
      legs.push({ roadId: m.road.id, end: m.end, u: { x: vx / L, y: vy / L }, half: Math.max(0, outer) });
      roadIds.push(m.road.id);
    }
    if (!legs.length) continue;
    out.push({ key: roadIds.slice().sort().join("|") + `@${Math.round(g.center.x)},${Math.round(g.center.y)}`, center: g.center, d, legs, roadIds });
  }
  return out;
}

/* The full drawable/dissolvable geometry for one roundabout node.
 * Returns { center, R, islandR, sectors, island, returns, area, islandArea } — `sectors` and
 * `returns` are the ADDITIVE rings to hand to the dissolve; `island` is the island ring for the
 * landscaped fill drawn on top. Pure. */
export function roundaboutGeometry(node, { travelWFt, returnR = 25, tessDeg = 6 } = {}) {
  if (!node || !node.center || !(node.d >= ROUNDABOUT_MIN_D)) return null;
  const R = node.d / 2;
  const W = circulatoryWidthFt(travelWFt);
  const islandR = Math.max(0, R - W);
  const sectors = annulusSectors(node.center, R, islandR, { tessDeg });
  const returns = [];
  for (const leg of node.legs || []) returns.push(...legReturnWedges(node.center, R, leg, returnR, tessDeg));
  return {
    center: node.center,
    R,
    islandR,
    sectors,
    island: islandR > 0 ? circleRing(node.center, islandR, tessDeg) : null,
    outer: circleRing(node.center, R, tessDeg),
    returns,
    area: roundaboutArea(node.d, travelWFt),
    islandArea: roundaboutIslandArea(node.d, travelWFt),
  };
}

/* Shorten a dense centerline at either end by a distance in feet, keeping every interior point.
 * This is how a leg's drawn strip, its curb stripes and its paved-area figure all stop at the
 * circle from ONE decision — pass it the `legTrimFor` distance for the end that carries a
 * roundabout. Returns the original array when there is nothing to trim. Pure. */
export function trimPolylineEnds(line, startFt = 0, endFt = 0) {
  if (!Array.isArray(line) || line.length < 2) return line;
  let pts = line;
  const cutFront = (arr, d) => {
    if (!(d > 0)) return arr;
    let left = d;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i], b = arr[i + 1];
      const seg = Math.hypot(b.x - a.x, b.y - a.y);
      if (seg <= EPS) continue;
      if (seg > left) {
        const t = left / seg;
        return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, ...arr.slice(i + 1)];
      }
      left -= seg;
    }
    return arr.slice(-2); // the trim ate the whole leg — keep a degenerate stub rather than nothing
  };
  if (startFt > 0) pts = cutFront(pts, startFt);
  if (endFt > 0) pts = cutFront(pts.slice().reverse(), endFt).reverse();
  return pts;
}
