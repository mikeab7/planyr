/* lib/siteGeometry.js — the shared pure geometry primitives behind a site's drawn area math:
 * element footprints, curb bands, road strip/pavement area, junction detection and the
 * per-plan roundabout resolution.
 *
 * Extracted from SitePlanner.jsx (PREREQUISITE EXTRACTION, site-metrics-extraction) — these were
 * already pure module-scope functions (explicit params, no closures over component state), just
 * physically colocated with the render body. They are reused directly by the render path (curb
 * drawing, road strip rendering, junction fillets, the roundabout circle) AND by
 * lib/siteMetrics.js's pure yield computation, so there is exactly ONE definition of "how big is
 * this element's curb" / "how big is this road's pavement" for both the screen and the numbers.
 *
 * Pure (no React, no DOM): world feet in, world feet out.
 */
import { edgeAbutsPaving } from "./parking.js";
import { classDefaultRadius, classReturnRadius, roadClassOf } from "./roadClasses.js";
import { roadCenterline } from "./roadGeometry.js";
import { trimPolylineEnds, roundaboutNodes, roundaboutGeometry, roundaboutDiameterFor, legTrimFor, roundaboutArea } from "./roundabout.js";
import { bufferPolyline, offsetPolyline } from "./metesAndBounds.js";

export const SQFT_PER_ACRE = 43560;

/* ----------------------------- geometry ---------------------------- */
export const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};
export const elCorners = (el) => {
  const hw = el.w / 2, hh = el.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const p = rot2(lx, ly, el.rot);
    return { x: el.cx + p.x, y: el.cy + p.y };
  });
};
export const polyArea = (pts) => {
  // B690 — same guard as the finder's shoelace: a parcel/element without a usable ring
  // contributes 0 area instead of crashing the canvas (points can be absent on a
  // malformed/legacy record that round-tripped verbatim through storage or element rows).
  if (!Array.isArray(pts) || !pts.length) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
};
export const ringOf = (e) => (e.points ? e.points : elCorners(e));

/* --------------------------- parking math -------------------------- */
// Double-loaded modules (two stall rows + a drive aisle) filling a rectangle.
// Supports 90/60/45° stalls: angling narrows the row depth and the aisle the
// user sets, and spaces stalls farther apart along the row.
export function carStalls(w, h, s) {
  const ang = [45, 60, 90].includes(+s.parkAngle) ? +s.parkAngle : 90;
  const rad = (ang * Math.PI) / 180, sinA = Math.sin(rad);
  const rowDepth = s.stallDepth * sinA;        // perpendicular depth of a stall row
  const pitch = s.stallW / sinA;               // spacing along the row
  const ai = s.aisle;
  const slantDx = ang === 90 ? 0 : rowDepth / Math.tan(rad); // lean across the depth
  const mod = rowDepth * 2 + ai;
  // Degenerate-config guard: a 0 stall-depth+aisle (mod) or 0 stall-width (pitch) makes
  // mods/perRow Infinity → an unbounded band loop that hard-freezes the tab. Bail to empty.
  if (!(mod > 0) || !(pitch > 0)) return { count: 0, bands: [], aisles: [], pitch: pitch > 0 ? pitch : 0, rowDepth, angle: ang };
  const perRow = Math.max(0, Math.floor((w - slantDx) / pitch));
  const mods = Math.max(0, Math.floor(h / mod));
  let count = 0;
  const bands = [], aisles = [];
  for (let i = 0; i < mods; i++) {
    const y = i * mod;
    bands.push({ y, depth: rowDepth, n: perRow, pitch, slantDx, dir: 1 });
    aisles.push({ y0: y + rowDepth, y1: y + rowDepth + ai });
    bands.push({ y: y + rowDepth + ai, depth: rowDepth, n: perRow, pitch, slantDx, dir: -1 });
    count += perRow * 2;
  }
  const used = mods * mod, left = h - used;
  if (left >= rowDepth && perRow > 0) {
    bands.push({ y: used, depth: rowDepth, n: perRow, pitch, slantDx, dir: 1 });
    count += perRow;
  }
  // flipDepth: mirror the layout across the strip's depth so the drive aisle
  // sits on the inner (y=0) edge — used for parking that hugs a building.
  if (s.flipDepth) {
    bands.forEach((b) => { b.y = h - b.y - b.depth; });
    aisles.forEach((a) => { const y0 = h - a.y1, y1 = h - a.y0; a.y0 = y0; a.y1 = y1; });
  }
  return { count, bands, aisles, pitch, rowDepth, angle: ang };
}
// Trailer storage as double-loaded rows (53′ deep) separated by a maneuvering
// drive lane (~60′) so tractors can back trailers in — not a solid pack.
export function trailerStalls(w, h, s) {
  const tl = s.trailerL, tw = s.trailerW, ai = Math.max(0, s.trailerAisle || 0);
  const perRow = tw > 0 ? Math.max(0, Math.floor(w / tw)) : 0;
  // Single striped row (e.g. trailer parking flush against a wall): one band
  // filling the strip depth, columns every tw.
  if (s.single) {
    const bands = perRow > 0 ? [{ y: 0, depth: h, n: perRow }] : [];
    return { count: perRow, bands, aisles: [], cols: perRow, tw, tl };
  }
  const mod = tl * 2 + ai;
  // Same freeze guard as carStalls: 0 trailer-length + 0 aisle would loop forever.
  if (!(mod > 0)) return { count: 0, bands: [], aisles: [], cols: perRow, tw, tl };
  const mods = Math.max(0, Math.floor(h / mod));
  let count = 0;
  const bands = [], aisles = [];
  for (let i = 0; i < mods; i++) {
    const y = i * mod;
    bands.push({ y, depth: tl, n: perRow });
    aisles.push({ y0: y + tl, y1: y + tl + ai });
    bands.push({ y: y + tl + ai, depth: tl, n: perRow });
    count += perRow * 2;
  }
  const used = mods * mod, left = h - used;
  if (left >= tl && perRow > 0) {
    bands.push({ y: used, depth: tl, n: perRow });
    count += perRow;
  }
  return { count, bands, aisles, cols: perRow, tw, tl };
}
// Area-based stall estimates for irregular (polygon) fields — gross sf per stall
// including its share of drive aisle, with an efficiency factor for edge loss.
export function estStalls(area, s) {
  const per = s.stallW * (s.stallDepth + s.aisle / 2) || 1;
  return Math.max(0, Math.floor((area * 0.8) / per));
}
export function estTrailers(area, s) {
  const per = s.trailerW * (s.trailerL + (s.trailerAisle || 0) / 2) || 1;
  return Math.max(0, Math.floor((area * 0.8) / per));
}

/* ------------------------- curbs (derived) ------------------------- */
// Curbs are auto-placed thin bands (not user geometry): a 6" mono curb is 0.5′ of
// plan-view width; a heavier 12" curb (trailer option) is 1.0′. One rule, three
// faces: ALWAYS drawn, ALWAYS in the area/yield math (width feeding it), NEVER in
// the displayed dimension (the label reads to the face of curb). The element's
// w/h stays the face-of-curb size, so the curb is derived on top — it floats to
// the terminal edge as rows are added/removed, with no stored geometry.
export const CURB_6 = 0.5, CURB_12 = 1.0;
export const CURB_TYPES = ["parking", "paving", "trailer"]; // roads carry their own curbs; no curb on a building side
export const curbWidthOf = (el) => (el.curbW === CURB_12 ? CURB_12 : CURB_6);
export const curbHost = (el, allEls) => (el.attachedTo ? (allEls || []).find((x) => x.id === el.attachedTo && !x.points) : null);
// Outward (terminal/back) edge in the element's LOCAL frame — the edge pointing
// away from a host building (so a curb never lands on the building side).
export function outwardCurbEdge(el, allEls) {
  const host = curbHost(el, allEls);
  if (!host) return null;
  const loc = rot2(el.cx - host.cx, el.cy - host.cy, -el.rot); // host→el delta in local frame
  return Math.abs(loc.y) >= Math.abs(loc.x)
    ? { axis: "y", sign: loc.y >= 0 ? 1 : -1, length: el.w }
    : { axis: "x", sign: loc.x >= 0 ? 1 : -1, length: el.h };
}
// True when a sidewalk/landscape strip sits between this pad and its host, so the
// pad's inner edge is a sidewalk transition (curb) rather than a building face.
export function sidewalkBetween(el, host, allEls) {
  if (!host) return false;
  const a = { x: el.cx - host.cx, y: el.cy - host.cy };
  return (allEls || []).some((s) => {
    if ((s.type !== "sidewalk" && s.type !== "landscape") || s.attachedTo !== host.id || s.id === el.id) return false;
    const b = { x: s.cx - host.cx, y: s.cy - host.cy };
    return (a.x * b.x + a.y * b.y) > 0 && (b.x * b.x + b.y * b.y) < (a.x * a.x + a.y * a.y); // same side, inboard
  });
}
// Curbed edges (LOCAL frame) — the single source feeding both the drawn band and
// the area math. B130 rule: a 6" curb wraps the WHOLE perimeter wherever pavement
// meets non-paving (dirt, landscape, a dead-end aisle), and is skipped wherever
// pavement meets pavement — a drive-aisle opening, continuous paving, or the
// internal seam between two abutting pads (e.g. split modules). The bare building
// face stays curb-free (B70) unless a sidewalk sits between (a transition curb).
export function curbEdgesOf(el, allEls) {
  if (el.points || !CURB_TYPES.includes(el.type)) return [];
  const w = curbWidthOf(el), host = curbHost(el, allEls);
  const oe = host ? outwardCurbEdge(el, allEls) : null;             // edge AWAY from the host
  const swalk = host ? sidewalkBetween(el, host, allEls) : false;
  const edges = [];
  for (const c of [
    { axis: "y", sign: 1, length: el.w }, { axis: "y", sign: -1, length: el.w },
    { axis: "x", sign: 1, length: el.h }, { axis: "x", sign: -1, length: el.h },
  ]) {
    const hostSide = oe && c.axis === oe.axis && c.sign === -oe.sign;
    if (hostSide && !swalk) continue;                              // B70: bare building face → no curb
    if (edgeAbutsPaving(el, c.axis, c.sign, allEls)) continue;     // meets pavement (opening / seam) → no curb
    edges.push({ ...c, width: w });
  }
  return edges;
}
// Plan-view area of an element's curbs (counts in the SF / impervious math).
export const curbAreaOf = (el, allEls) => (el.points ? 0 : curbEdgesOf(el, allEls).reduce((s, e) => s + e.length * e.width, 0));

/* ---- Centerline road geometry (B596–B598 / NEW-1..3) ----
 * A centerline road carries pts + per-vertex treatment (vtx) + travelW + curb + roadClass.
 * Its surface, curbs and dimension all DERIVE from these via roadCenterline (B597) fed
 * through the shared bufferPolyline / offsetPolyline offset primitives (B598) — no new
 * geometry dependency. The legacy rotated-rect road (no `pts`) keeps the old render. */
export const isCenterlineRoad = (el) => !!el && el.type === "road" && Array.isArray(el.pts) && el.pts.length >= 2;
export const CURB = 0.5; // 6" curb on each side of a road (added to its true width)
export const roadCurbWidth = (el) => (Number.isFinite(el && el.curb) ? el.curb : CURB);
// Default Arc radius for a road's new vertices = its class default (settings-resolved).
export const roadDefaultRadius = (el, settings) => classDefaultRadius(roadClassOf(settings, el && el.roadClass));
// The dense, tessellated centerline (the rendered alignment) for a centerline road.
//
// NEW-2 — `sharpAt` is the set of this road's vertices that ANOTHER road tees onto. Those corners
// are rendered as hard corners (see roadCenterlineTagged's `sharpAt`): a junction is where two
// centerlines MEET, so the through road has to pass through the node, and a centerline fillet cuts
// the corner clean off it. Every caller that draws, measures or dissolves a road passes it, so the
// pavement, the curb stripes, the paved-area figure and the length all describe the same road.
/* NEW-5 — `trim` is {start,end} in feet: how far this road's centerline is SHORTENED at each
 * terminus because a roundabout sits there. Every consumer of a road's geometry takes it, so the
 * drawn pavement, the curb stripes, the paved-area figure and the dissolve all describe the SAME
 * road — the "the pavement math knows about it" half of the owner's condition. An undefined trim is
 * the byte-identical old behaviour, so a plan with no roundabout is untouched. */
export const roadDenseCenterline = (el, settings, sharpAt, trim) => {
  const dense = roadCenterline(el.pts, el.vtx, { defaultRadius: roadDefaultRadius(el, settings), sharpAt });
  return trim && (trim.start > 0 || trim.end > 0) ? trimPolylineEnds(dense, trim.start || 0, trim.end || 0) : dense;
};
// The pavement+curb OUTER ring (closed polygon) — total width = travelW + a curb each side.
export const roadStripRing = (el, settings, sharpAt, trim) => {
  const dense = roadDenseCenterline(el, settings, sharpAt, trim);
  return bufferPolyline(dense, Math.max(0, (+el.travelW || 0) + 2 * roadCurbWidth(el))) || [];
};
// The two inner curb lines = the centerline offset by ±travelW/2 (face-of-curb edges).
export const roadCurbLines = (el, settings, sharpAt, trim) => {
  const dense = roadDenseCenterline(el, settings, sharpAt, trim);
  const hw = Math.max(0, (+el.travelW || 0) / 2);
  return [offsetPolyline(dense, hw), offsetPolyline(dense, -hw)].filter(Boolean);
};
// Plan-view paved area (sf) of a centerline road = its generated strip polygon area
// (replaces the old w×h — the curbs are included, matching the B70 three-way contract).
// NEW-5 — plus the CIRCULATORY ROADWAY of any roundabout this road owns (`extraSf`), which is the
// annulus and never the disc: the central island is landscaped, so counting it would overstate
// impervious cover, and impervious cover is what a detention volume is priced off.
export const roadStripArea = (el, settings, sharpAt, trim, extraSf = 0) => {
  const ring = roadStripRing(el, settings, sharpAt, trim);
  return (ring.length >= 3 ? Math.abs(polyArea(ring)) : 0) + (+extraSf || 0);
};

// Junction (tee) coincidence tolerance — see teeTargetOf/roadJunctionVerticesOf.
export const TEE_COINCIDE_FT = 0.75;
// B1011 round 2 — a FLAT 0.75 ft is too tight to recognise a junction the owner actually drew. On his
// plan the 36' aisle's endpoint sits 0.86 ft from the 40' aisle's vertex — a tenth of a foot over the
// line — so the app saw no tee there at all, added no curb returns, and the two strips simply butted:
// the squared-off notch at that junction. Sub-foot slack is normal in hand-drawn geometry (grid snap,
// migration rounding, a nudged vertex), and it is NOT a meaningful separation on a 40 ft road. So the
// tolerance scales with the narrower road's own width, exactly like the B1010 debris rule, and stays
// bounded so two genuinely distinct vertices can never be welded by accident.
export const TEE_COINCIDE_MAX_FT = 4;
export const teeCoincideFt = (a, b) => {
  const w = Math.min(+a?.travelW || 0, +b?.travelW || 0);
  return Math.max(TEE_COINCIDE_FT, Math.min(w > 0 ? w / 8 : 0, TEE_COINCIDE_MAX_FT));
};
// The road (and which of its interior vertices) that `P` — one endpoint of side road `S` — tees onto.
// ONE definition of "this is a tee", shared by the junction builder and the junction-vertex map, so
// the corners we FLATTEN can never drift from the junctions we BUILD.
export const teeTargetOf = (roads, S, P) => {
  for (const H of roads) {
    if (H.id === S.id) continue;
    for (let i = 1; i < H.pts.length - 1; i++) {
      if (Math.hypot(H.pts[i].x - P.x, H.pts[i].y - P.y) <= teeCoincideFt(S, H)) return { G: H, gvi: i };
    }
  }
  return null;
};
/* Every vertex a road junction lands on, per road: Map<roadId, Set<vertexIndex>>.
 *
 * These corners render SHARP (see roadDenseCenterline). The owner's Goose Creek split is why: his
 * 36' aisle turns ~88° through an arc-treated vertex, and the branch is welded to that vertex — but
 * a 25 ft fillet carries the drawn pavement ~10 ft clear of it, so the branch's edges sat 10 ft
 * inboard of the through road's and the outline stepped. A junction is where two centerlines MEET;
 * the rounding there belongs to the curb returns, not to a centerline fillet that moves the road
 * away from the node. No-op on a collinear junction vertex (the common case), so an ordinary
 * straight tee renders byte-identically to before. Pure over (els); memoized at the call site. */
export function roadJunctionVerticesOf(els) {
  const roads = (els || []).filter((x) => isCenterlineRoad(x) && !x.attachedTo);
  const out = new Map();
  for (const S of roads) {
    for (const ei of [0, S.pts.length - 1]) {
      const t = teeTargetOf(roads, S, S.pts[ei]);
      if (!t) continue;
      if (!out.has(t.G.id)) out.set(t.G.id, new Set());
      out.get(t.G.id).add(t.gvi);
    }
  }
  return out;
}

/* ---- Roundabouts (NEW-5) — the ONE per-plan resolution --------------------------------------
 * Derived entirely from what each road stores at its terminus (`el.roundabout = {end, d}`), so
 * the circle is BONDED by construction: move or re-align the road and the centre, the leg
 * bearings and the curb returns all re-derive from the current `pts`. Two roads whose termini
 * meet at one node share ONE circle (the larger declared diameter wins), which is what makes a
 * second leg join rather than stack. `trims` is the per-road centerline shortening every geometry
 * consumer reads (roadDenseCenterline); `areaById` is the annulus each owning road contributes to
 * the paved figure — read by both the renderer (SitePlanner.jsx's `roundabouts` memo) and
 * lib/siteMetrics.js's yield computation, so the drawn roundabout and the paved-area number can
 * never describe two different circles. Pure over (els, settings). */
export function roundaboutsForSite(els, settings) {
  const roads = (els || []).filter((x) => isCenterlineRoad(x) && !x.attachedTo);
  const declared = roads.filter((r) => r.roundabout && r.roundabout.end);
  if (!declared.length) return { nodes: [], geoms: [], trims: new Map(), areaById: new Map(), pairs: [], extraById: new Map() };
  const byId = new Map(roads.map((r) => [r.id, r]));
  const derivedD = (r) => roundaboutDiameterFor(roadClassOf(settings, r.roadClass), +r.travelW || 0);
  const nodes = roundaboutNodes(
    roads.map((r) => ({ id: r.id, pts: r.pts, travelW: r.travelW, curbW: roadCurbWidth(r), roundabout: r.roundabout })),
    { nodeTolFt: Math.max(2, TEE_COINCIDE_FT), diameterFor: (r) => derivedD(byId.get(r.id) || r) },
  );
  const geoms = [], trims = new Map(), areaById = new Map(), pairs = [], extraById = new Map();
  for (const node of nodes) {
    // The circulatory width follows the WIDEST leg — a truck approach must not be circled by an
    // aisle-width ring.
    const travelW = Math.max(...node.legs.map((l) => +((byId.get(l.roadId) || {}).travelW) || 0), 0);
    const owner = node.legs[0];
    const cls = roadClassOf(settings, (byId.get(owner.roadId) || {}).roadClass);
    const g = roundaboutGeometry(node, { travelWFt: travelW, returnR: classReturnRadius(cls), tessDeg: 6 });
    if (!g) continue;
    geoms.push({ node, geom: g, travelW });
    for (const leg of node.legs) {
      const t = trims.get(leg.roadId) || { start: 0, end: 0 };
      t[leg.end] = legTrimFor(node.d, leg.half, travelW);
      trims.set(leg.roadId, t);
    }
    // ONE road owns the annulus in the area ledger, so two legs can never double-count it.
    areaById.set(owner.roadId, (areaById.get(owner.roadId) || 0) + roundaboutArea(node.d, travelW));
    extraById.set(owner.roadId, [...(extraById.get(owner.roadId) || []), ...g.sectors, ...g.returns]);
    for (let i = 1; i < node.roadIds.length; i++) pairs.push([node.roadIds[0], node.roadIds[i]]);
  }
  return { nodes, geoms, trims, areaById, pairs, extraById };
}
