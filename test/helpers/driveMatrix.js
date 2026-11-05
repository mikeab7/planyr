/* NEW-1 (road → employee-parking, every approach) — the scenario factory + the measurements for the
 * APPROACH MATRIX (test/driveParkingMatrix.test.js, e2e/road-parking-approach-matrix.spec.js).
 *
 * ⛔ Everything here drives the REAL pure pipeline (`driveJunctionsOf` → `roadNetSteps`, the field's own
 * `carStalls`, the outline-cut functions the renderer calls) — nothing re-derives a junction by hand. The
 * measurements are about the FINISHED geometry a person would see, not about intermediate numbers.
 *
 * Frames: a rect field is described in its own LOCAL frame (origin = top-left corner, x along `w`, y along
 * `h`, exactly the frame `carStalls` lays its bands in); `toWorld` rotates/translates that into the plan.
 * A road is described by the FACE it approaches ('left'|'right'|'top'|'bottom'), how far along that face
 * (feet from the local origin), the approach angle off perpendicular, and how far its far end sits.
 */
import { carStalls, roadStripRing } from "../../src/workspaces/site-planner/lib/siteGeometry.js";
import { driveJunctionsOf } from "../../src/workspaces/site-planner/lib/roadJunctions.js";
import { roadNetInputs, roadNetSteps, driveSteps } from "../../src/workspaces/site-planner/lib/roadNetBuild.js";
import { dissolveRings, rectOutlineCutSegments, rectBandOutlineCutPolylines, polygonOutlineCutSegments } from "../../src/workspaces/site-planner/lib/roadNetwork.js";
import { rectEdges } from "../../src/workspaces/site-planner/lib/roadGeometry.js";
import { pavedPredicate, pointInRing } from "../../ui-audit/lib/paveFloodFill.mjs";

export const SETTINGS = { stallW: 9, stallDepth: 18, aisle: 24, parkAngle: 90 };
export const rad = (d) => (d * Math.PI) / 180;

const FACE_N = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, top: { x: 0, y: -1 }, bottom: { x: 0, y: 1 } };

export function fieldWorld(f) {
  const r = rad(f.rot || 0), c = Math.cos(r), s = Math.sin(r);
  return (lx, ly) => {
    const dx = lx - f.w / 2, dy = ly - f.h / 2;
    return { x: f.cx + dx * c - dy * s, y: f.cy + dx * s + dy * c };
  };
}
/** the face's local point `along` feet from the local origin, and its outward normal / tangent (local) */
function facePoint(f, face, along) {
  switch (face) {
    case "left": return { x: 0, y: along };
    case "right": return { x: f.w, y: along };
    case "top": return { x: along, y: 0 };
    default: return { x: along, y: f.h };
  }
}

/** A rect field (`shape:"rect"`) or the same footprint as a free-drawn polygon (`shape:"poly"`, one extra collinear digitizing vertex on the long edges). */
export function makeField(o = {}) {
  const { id = "F", shape = "rect", rot = 0, w = 200, h = 60, cx = 0, cy = 0, attached = false, cfg } = o;
  const f = { id, type: "parking", z: 0, cx, cy, w, h, rot };
  if (cfg) f.cfg = cfg;
  if (attached) f.attachedTo = "BLDG-HOST";
  if (shape === "poly") {
    const W = fieldWorld(f);
    const pts = [W(0, 0), W(w / 2, 0), W(w, 0), W(w, h), W(w / 2, h), W(0, h)];
    const poly = { id, type: "parking", z: 0, points: pts, rot: 0, ...(attached ? { attachedTo: "BLDG-HOST" } : {}) };
    Object.defineProperty(poly, "__rect", { value: f, enumerable: false });   // the footprint the polygon was cut from (the frame a road approaches in)
    return poly;
  }
  return f;
}

/** A road approaching `face` of rect field `f` at `along`, `angle`° off perpendicular (+ leans toward +tangent), welded at the face unless `insideFt`. */
export function makeRoad(f, o = {}) {
  const {
    id = "R", face = "left", along = 30, angle = 0, len = 140, insideFt = 0, travelW = 26,
    roadClass = "aisle", stored = true, kind = "parking", targetId = f.id, returnR,
  } = o;
  const rect = f.__rect || f;
  const W = fieldWorld(rect);
  const n = FACE_N[face];
  const t = { x: -n.y, y: n.x };
  const a = rad(angle);
  const dIn = { x: -n.x * Math.cos(a) + t.x * Math.sin(a), y: -n.y * Math.cos(a) + t.y * Math.sin(a) };   // local, into the field
  const P = facePoint(rect, face, along);
  const end = { x: P.x + dIn.x * insideFt, y: P.y + dIn.y * insideFt };
  const far = { x: P.x - dIn.x * len, y: P.y - dIn.y * len };
  const toW = (p) => W(p.x, p.y);
  const road = {
    id, type: "road", z: 1, pts: [toW(far), toW(end)], vtx: [{}, {}], travelW, curb: 0.5, roadClass,
  };
  // a drawn road also carries its pts' bounding box (cx/cy/w/h) like every real one — "Zoom to fit" reads it
  const xs = road.pts.map((q) => q.x), ys = road.pts.map((q) => q.y);
  Object.assign(road, { cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rot: 0 });
  if (stored) road.driveTee = { targetId, kind, returnR: returnR ?? (kind === "truckcourt" ? 24 : 15), flare: 0 };
  return road;
}

const seg = (a, b) => ({ a, b });
function distToSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  let t = l2 > 1e-12 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
const coveredBy = (p, segs, tol = 0.35) => segs.some(({ a, b }) => distToSeg(p, a, b) <= tol);
/** covered by the INTERIOR of an ink piece — a piece that merely ENDS at the point (the field's own corner, the end of a cut) is not "ruled across" it */
const coveredInterior = (p, segs, tol = 0.35, end = 0.9) => segs.some(({ a, b }) => distToSeg(p, a, b) <= tol && Math.hypot(p.x - a.x, p.y - a.y) > end && Math.hypot(p.x - b.x, p.y - b.y) > end);
const polylineSegs = (lines) => lines.flatMap((pl) => { const out = []; for (let i = 0; i + 1 < pl.length; i++) out.push(seg(pl[i], pl[i + 1])); return out; });

export function fieldRing(f) {
  if (f.points) return f.points;
  return rectEdges(f.cx, f.cy, f.w, f.h, f.rot || 0).map((e) => e.a);
}

/** The stall CELLS of a 90° rect field in WORLD feet: [{ band, k, ring }] — what `renderElPx` draws the dividers of. */
export function stallCells(f, settings = SETTINGS) {
  if (f.points) return [];
  const cs = carStalls(f.w, f.h, f.cfg ? { ...settings, ...f.cfg } : settings);
  const W = fieldWorld(f);
  const out = [];
  cs.bands.forEach((b, bi) => {
    for (let k = 0; k < b.n; k++) {
      const x0 = k * b.pitch, x1 = (k + 1) * b.pitch, y0 = b.y, y1 = b.y + b.depth;
      out.push({ band: bi, k, ring: [W(x0, y0), W(x1, y0), W(x1, y1), W(x0, y1)] });
    }
  });
  return out;
}
function ringArea(r) { let s = 0; for (let i = 0; i < r.length; i++) { const q = r[(i + 1) % r.length]; s += r[i].x * q.y - q.x * r[i].y; } return Math.abs(s) / 2; }
/** Fraction (0..1) of `cell` lying inside `ring`, by an 8×8 sample grid (the cell is a convex quad). */
function cellOverlap(cell, ring) {
  const [p0, p1, , p3] = cell;
  let hit = 0, N = 8;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const u = (i + 0.5) / N, v = (j + 0.5) / N;
    const p = { x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v, y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v };
    if (pointInRing(p, ring)) hit++;
  }
  return hit / (N * N);
}

export const CELL_HIT_FRACTION = 0.15;

/** the road's drive footprint INSIDE the field: the strip of the road extended `reach` ft past its welded end along its last leg */
export function driveFootprint(road, reach = 80) {
  const [a, b] = road.pts.slice(-2);
  const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const e = { x: b.x + ((b.x - a.x) / L) * reach, y: b.y + ((b.y - a.y) / L) * reach };
  const ext = { ...road, pts: [a, e], vtx: [{}, {}] };
  return roadStripRing(ext, SETTINGS, undefined, undefined);
}

export async function netOf(els, settings = SETTINGS) {
  const inp = await roadNetInputs(els, settings);
  return { inp, net: driveSteps(roadNetSteps(inp)) };
}

/** One finished-geometry measurement of a scenario. Returns { fails: [string], facts: {...} }. */
export async function measure(els, { roadId = "R", fieldId = "F", building = null, settings = SETTINGS, expectWedges = 2, entryFace = "top" } = {}) {
  const fails = [], facts = {};
  const field = els.find((e) => e.id === fieldId), road = els.find((e) => e.id === roadId);
  const js = driveJunctionsOf(els, settings);
  const j = js.find((x) => x.sideId === roadId && x.targetId === fieldId);
  facts.junction = !!j;
  if (!j) { fails.push("no junction: the road does not connect to the field"); return { fails, facts }; }
  facts.wedges = j.geom.wedges.length;
  if (j.kind !== "parking" && field.type === "parking") fails.push(`kind ${j.kind}: a car field must get the car geometry, never the truck flare`);
  if (expectWedges != null && j.geom.wedges.length !== expectWedges) fails.push(`curb returns: ${j.geom.wedges.length} (expected ${expectWedges})`);

  const strip = roadStripRing(road, settings, undefined, undefined);
  const fr = fieldRing(field);
  const merged = dissolveRings([fr, strip, ...j.geom.wedges]);
  facts.regions = merged.length;
  if (merged.length !== 1) fails.push(`pavement is ${merged.length} regions, not ONE surface`);
  const holes = merged.reduce((s, r) => s + r.holes.length, 0);
  if (holes) fails.push(`${holes} enclosed hole(s) in the joined pavement`);

  const isPaved = pavedPredicate([], merged);
  // GORE: the corner between the road's edge and the field's face must be paved except inside the return's own arc (a bevel / notch / dropped wedge leaves it open)
  let goreOpen = 0;
  (j.geom.corners || []).forEach((C, i) => {
    const t1 = j.geom.throughTangents[i], t2 = j.geom.sideTangents[i], arc = j.geom.returns[i];
    if (!C || !t1 || !t2 || !arc || arc.length < 3) return;                 // a zero-radius corner: nothing to fill (the wedge-count check owns it)
    const mid = arc[Math.floor(arc.length / 2)];
    const O = circumcentre(t1, mid, t2);
    if (!O) return;
    const R = Math.hypot(t1.x - O.x, t1.y - O.y);
    const tri = [C, t1, t2];
    const bx0 = Math.min(...tri.map((q) => q.x)), bx1 = Math.max(...tri.map((q) => q.x)), by0 = Math.min(...tri.map((q) => q.y)), by1 = Math.max(...tri.map((q) => q.y));
    for (let x = bx0; x <= bx1; x += 0.5) for (let y = by0; y <= by1; y += 0.5) {
      const q = { x, y };
      if (!pointInRing(q, tri) || Math.hypot(q.x - O.x, q.y - O.y) <= R + 0.5) continue;
      if (distToSeg(q, C, t1) < 0.4 || distToSeg(q, C, t2) < 0.4) continue;   // on the corner's own edges
      if (!isPaved(q)) goreOpen++;
    }
  });
  facts.goreOpenCells = goreOpen;
  if (goreOpen) fails.push(`the corner gore is not filled (${goreOpen} open cells): a bevel / notch at the junction`);

  // OUTLINE: open across the mouth and nowhere else
  const { net } = await netOf(els, settings);
  const cutters = net.outlineCuts.get(fieldId), mouths = net.mouths.get(fieldId);
  facts.mouths = (mouths || []).length;
  if (!mouths || !mouths.length) fails.push("no mouth recorded: the field's outline is ruled across the drive");
  const edgeSegs = field.points
    ? polygonOutlineCutSegments(field, cutters || [], mouths)
    : rectOutlineCutSegments(field, cutters || [], mouths);
  const ink = polylineSegs(edgeSegs);
  // every sample ON the perimeter that is not inside a mouth must be ink; every mouth midpoint must not
  const per = []; const n = fr.length;
  for (let i = 0; i < n; i++) { const a = fr[i], b = fr[(i + 1) % n], L = Math.hypot(b.x - a.x, b.y - a.y); for (let d = 0.5; d < L; d += 1.5) per.push({ p: { x: a.x + ((b.x - a.x) * d) / L, y: a.y + ((b.y - a.y) * d) / L } }); }
  const inMouth = (p) => (mouths || []).some((m) => distToSeg(p, m.a, m.b) <= 0.5 && Math.hypot(p.x - m.a.x, p.y - m.a.y) > 0.9 && Math.hypot(p.x - m.b.x, p.y - m.b.y) > 0.9);
  const nearMouthEnd = (p) => (mouths || []).some((m) => [m.a, m.b].some((e) => Math.hypot(p.x - e.x, p.y - e.y) <= 0.9));
  let missing = 0, stray = 0;
  for (const { p } of per) { const im = inMouth(p), cov = coveredBy(p, ink); if (!im && !cov && !nearMouthEnd(p) && !pointInRing(p, strip)) missing++; if (im && coveredInterior(p, ink)) stray++; }
  facts.outlineMissing = missing; facts.outlineStray = stray;
  if (stray) fails.push(`outline ruled across the mouth at ${stray} sample(s)`);
  if (missing) fails.push(`outline missing outside the mouth at ${missing} sample(s)`);

  // STRAY: no ink may lie OUTSIDE the field's footprint (the double-rotation class)
  const outside = ink.filter(({ a, b }) => !pointInRing({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, fr) && distToSeg({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, ...nearestEdge(fr, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })) > 0.5);
  if (outside.length) fails.push(`${outside.length} stray outline piece(s) outside the field's footprint`);

  // BAND OUTLINES: the stall rows' own outlines are open across the mouth too (rect fields)
  if (!field.points) {
    const cs = carStalls(field.w, field.h, field.cfg ? { ...settings, ...field.cfg } : settings);
    let bandStray = 0;
    cs.bands.forEach((b) => {
      const chains = rectBandOutlineCutPolylines(field, { x: 0, y: b.y, w: b.n * b.pitch, h: b.depth }, net.bandCuts.get(fieldId) || cutters || [], mouths);
      const bs = polylineSegs(chains);
      for (const m of mouths || []) {
        for (let t = 0.1; t < 0.95; t += 0.2) { const p = { x: m.a.x + (m.b.x - m.a.x) * t, y: m.a.y + (m.b.y - m.a.y) * t }; if (coveredInterior(p, bs, 0.2)) bandStray++; }
      }
    });
    facts.bandStray = bandStray;
    if (bandStray) fails.push(`a stall row's outline is ruled across the mouth (${bandStray} samples)`);

    // STALLS under the drive: every cell the drive's footprint covers must be reported removed
    const foot = driveFootprint(road);
    // the drive crosses the row that backs onto the face it enters by (it arrives in the aisle behind it — it never reaches the far row)
    const cs2 = carStalls(field.w, field.h, field.cfg ? { ...settings, ...field.cfg } : settings);
    const W2 = fieldWorld(field), rd = entryFace;
    const entry = cs2.bands.map((b, i) => ({ i, b })).filter(({ b }) => rd === "top" ? Math.abs(b.y) < 1e-6 : Math.abs(b.y + b.depth - field.h) < 1e-6)[0];
    void W2;
    const hit = stallCells(field, settings).filter((c) => entry && c.band === entry.i && cellOverlap(c.ring, foot) > CELL_HIT_FRACTION);
    facts.cellsUnderDrive = hit.length;
    facts.hit = hit.map((c) => `${c.band}:${c.k}`);
  }

  // NO PAVEMENT BEHIND THE FACE: the drive ends at the field's face — none of its painted pavement may run on past the face plane beside the field (the "tongue" a
  // drive wider than the face it enters, or an endpoint dropped inside it, leaves hanging off the field's side)
  if (!field.points && !j.geom.skim) {
    const rr = (-(field.rot || 0) * Math.PI) / 180, cc = Math.cos(rr), ss = Math.sin(rr);
    const loc = (p) => { const dx = p.x - field.cx, dy = p.y - field.cy; return { x: dx * cc - dy * ss + field.w / 2, y: dx * ss + dy * cc + field.h / 2 }; };
    const jl = loc(j.junctionPt);
    const behind = (l) => (Math.abs(jl.y) < 1 ? l.y : Math.abs(jl.y - field.h) < 1 ? field.h - l.y : Math.abs(jl.x) < 1 ? l.x : field.w - l.x);
    let tongue = 0;
    const net2 = (await netOf(els, settings)).net;
    for (const reg of net2.regions) {
      if (!reg.ids.includes(roadId)) continue;
      for (const p of reg.region.outer) { const l = loc(p); if (behind(l) > 0.75) tongue++; }
    }
    facts.pavementBehindFace = tongue;
    if (tongue) fails.push(`${tongue} painted pavement vertex(es) run on past the field's face (a tongue beside the field)`);
  }
  if (building) {
    const bRing = fieldRing(building.points ? building : { ...building, cx: building.cx, cy: building.cy, w: building.w, h: building.h, rot: building.rot || 0 });
    let under = 0;
    for (const r of merged) for (let i = 0; i < r.outer.length; i++) if (pointInRing(r.outer[i], bRing)) under++;
    for (const w of j.geom.wedges) for (const p of w) if (pointInRing(p, bRing)) under++;
    facts.underBuilding = under;
    if (under) fails.push(`pavement under a building (${under} vertices)`);
  }
  return { fails, facts, j, merged };
}
function nearestEdge(ring, p) {
  let best = null, bd = Infinity;
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length], d = distToSeg(p, a, b); if (d < bd) { bd = d; best = [a, b]; } }
  return best;
}

function circumcentre(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  return { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
}

/** which row-side face ("top" | "bottom") a road ends on, in the field's own frame ("end" for the aisle-end faces) */
function fieldRingLocalEntry(field, road) {
  const r = (-(field.rot || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const p = road.pts[0];                         // the FAR end: which side of the field the road comes from
  const dx = p.x - field.cx, dy = p.y - field.cy;
  const lx = dx * c - dy * s + field.w / 2, ly = dx * s + dy * c + field.h / 2;
  if (lx < 0 || lx > field.w) return "end";
  return ly < field.h / 2 ? "top" : "bottom";
}

/** a drive running ALONG a face (parallel, near curb `gap` ft off the face), from local y0 to y1 (the perimeter-drive layout) */
export function makeAlongRoad(f, o = {}) {
  const { id = "P", face = "left", gap = 0, y0 = -40, y1 = f.h + 40, travelW = 26, roadClass = "aisle" } = o;
  const hw = travelW / 2 + 0.5, x = face === "left" ? -(hw + gap) : f.w + hw + gap;
  const W = fieldWorld(f.__rect || f);
  const pts = [W(x, y0), W(x, y1)];
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  return { id, type: "road", z: 1, pts, vtx: [{}, {}], travelW, curb: 0.5, roadClass, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rot: 0 };
}
/** a road that crosses the field wholesale, top to bottom, at local x = `at` */
export function makeThroughRoad(f, o = {}) {
  const { id = "T", at = 100, travelW = 26, roadClass = "aisle", over = 50 } = o;
  const W = fieldWorld(f.__rect || f);
  const pts = [W(at, -over), W(at, f.h + over)];
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  return { id, type: "road", z: 1, pts, vtx: [{}, {}], travelW, curb: 0.5, roadClass, cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rot: 0 };
}
export { distToSeg, polylineSegs, coveredBy, coveredInterior };
