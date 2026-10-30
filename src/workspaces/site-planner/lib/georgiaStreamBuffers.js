/* Georgia stream buffers — the PURE half (Georgia screening, Part B1). No Leaflet, no DOM, no network.
 *
 * WHAT IS DRAWN. A band on each side of a stream centreline, at the width the strictest rule that reaches
 * that stream asks for:
 *   state    25 ft   every state-waters stream — the Georgia Erosion & Sedimentation Act (O.C.G.A. 12-7-6(b)(15)) buffer.
 *   trout    50 ft   a Georgia DNR-mapped trout stream — the trout-water buffer.
 *   river   100 ft   a PROTECTED RIVER (perennial, 400 cfs or more — DCA's compiled map): a 100-ft natural vegetative buffer each side, measured from
 *                    the banks (O.C.G.A. 12-2-8, Rule 391-3-16-.04). Drawn from DCA's own protected-river lines, NOT matched to NHD reaches by name.
 *                    ⛔ NOT on the segments the rule EXCLUDES: a protected river does not include a segment covered by the Metropolitan River Protection Act (the
 *                    Chattahoochee, Buford Dam → the Fulton/Douglas line — cut out with ARC's own 2,000-ft corridor polygon, where the MRPA row governs) or by the
 *                    Coastal Marshlands Protection Act (the tidal reaches — `inTidalReach`, a screening proxy from the National Wetlands Inventory, see gaTidalReaches.js).
 *                    DCA's layer includes BOTH (live 2026-10-30: the Chattahoochee reach, and the Altamaha / Ogeechee / Savannah / Satilla / St Marys to the sea).
 *                    The same MRPA cut applies to the Chattahoochee's 75 / 50 / 25-ft bands (NHD / trout lines named Chattahoochee): inside the corridor the MRPA plan governs, so the District's
 *                    model buffer is not drawn along the river there either. Tributaries keep their bands. Every cut is GEOMETRIC (`clipOutside`): the line is split where it crosses the
 *                    corridor edge, never at the nearest vertex, so a long segment does not lose its whole length to one vertex.
 *   district 75 ft   inside the Metropolitan North Georgia Water Planning District — the District's MODEL stream-buffer
 *                    ordinance: 50 ft undisturbed + 25 ft impervious setback. A MODEL: each member county adopts and may
 *                    amend its own, so this is labelled "typical local requirement — confirm with the county", never law.
 * Where two rules reach the same stream the WIDER governs (a trout stream inside the District is 75, not 50).
 *
 * WHAT IS NOT. Only STREAMS are buffered: NHD ftype 460 (stream/river) perennial (46006) and intermittent (46003) and
 * the unspecified 46000 — never ephemeral (46007), canals/ditches (336), artificial paths through a lake (558) or
 * pipelines. Georgia's act protects "state waters"; an ephemeral swale or a roadside ditch is not one, and drawing a
 * buffer on every ditch would be a loud false constraint. The exclusion is a screening judgement, stated on the layer.
 *
 * ⛔ MEASURED FROM THE CENTRELINE, NOT THE BANK. The law measures from the top of the bank (or the wrested vegetation
 * line). NHD gives a centreline, so the band starts at the centreline and is TOO NARROW by half the channel width on a
 * wide stream. Said on the layer; a survey of the bank governs.
 *
 * Reuses `corridorRingLngLat` (the pipeline-corridor buffer: local flat-earth feet frame, no new dependency).
 */
import { corridorRingLngLat } from "./pipelineCorridor.js";
import { inTidalReach, inMrpaReachBox, makeRingIndex, nearRingIndexes, MRPA_EDGE_DEG } from "./georgiaRiverExclusions.js";
const MRPA_BOX_PAD_DEG = 0.01, CLIP_STEP_DEG = 0.0005;
export { inTidalReach, riverExclusionAt, inMrpaReachBox, inMrpaReach, MRPA_REACH_BOX } from "./georgiaRiverExclusions.js";

export const GA_BUFFER_TIERS = {
  state: { id: "state", eachSideFt: 25, color: "#b45309", label: "25 ft state-waters buffer" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
  trout: { id: "trout", eachSideFt: 50, color: "#0f766e", label: "50 ft trout-stream buffer" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
  river: { id: "river", eachSideFt: 100, color: "#0369a1", label: "100 ft protected-river buffer" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
  district: { id: "district", eachSideFt: 75, color: "#b91c1c", label: "75 ft Metro North Georgia District buffer" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
};

/* NHD `ftype`/`fcode` → is this reach a "state waters" stream the buffer applies to? Accepts either casing the
 * service has served (`ftype` lowercase on the large-scale layer, `FTYPE` on others). Pure. */
export function isBufferedStream(props) {
  const p = props || {};
  const ftype = Number(p.ftype ?? p.FTYPE);
  const fcode = Number(p.fcode ?? p.FCODE);
  if (ftype !== 460) return false; // streams/rivers only — not canals (336), artificial paths (558), pipelines
  return fcode !== 46007;           // …and not an ephemeral channel
}

/* The tier a stream part falls in. `inDistrict` wins (75), then trout (50), then the statewide floor (25). Pure. */
export function tierFor({ inDistrict = false, trout = false } = {}) {
  if (inDistrict) return GA_BUFFER_TIERS.district;
  if (trout) return GA_BUFFER_TIERS.trout;
  return GA_BUFFER_TIERS.state;
}

/* Ray-cast point-in-ring ([lng,lat] vertices, either winding). Pure. */
export function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/* The outer rings of every Polygon / MultiPolygon in a GeoJSON FeatureCollection. Holes are ignored on purpose: the
 * District outline has none, and a hole would only ever make "inside the District" LESS true (fail toward the
 * narrower buffer would be the unsafe direction) — so a hole is treated as inside, the conservative reading. Pure. */
export function districtRings(fc) {
  const out = [];
  for (const f of (fc && fc.features) || []) {
    const g = f && f.geometry;
    if (!g) continue;
    if (g.type === "Polygon" && g.coordinates && g.coordinates[0]) out.push(g.coordinates[0]);
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates || []) if (poly && poly[0]) out.push(poly[0]);
  }
  return out;
}

export const inAnyRing = (lng, lat, rings) => rings.some((r) => pointInRing(lng, lat, r));

/* Every LineString / MultiLineString part of a GeoJSON feature, as [lng,lat] paths. Pure. */
export function linePartsOf(feature) {
  const g = feature && feature.geometry;
  if (!g) return [];
  if (g.type === "MultiLineString") return g.coordinates || [];
  if (g.type === "LineString") return [g.coordinates];
  return [];
}


/* ── The two segments a protected river's 100-ft rule does NOT cover: see georgiaRiverExclusions.js (a boot-safe leaf — the registry's click card reads it too) ── */

/* Split a path into the runs of consecutive vertices for which `drop(vertex)` is false (runs of fewer than two vertices vanish). Pure. */
export function keepRuns(path, drop) {
  const runs = []; let cur = [];
  for (const v of path) {
    if (drop(v)) { if (cur.length > 1) runs.push(cur); cur = []; } else cur.push(v);
  }
  if (cur.length > 1) runs.push(cur);
  return runs;
}

/* Clip a path to the parts for which `drop(point)` is false, GEOMETRICALLY (a run ends where `drop` flips — for the MRPA cut that is the corridor edge plus its ~150 m digitisation tolerance, so a run ends that far OUTSIDE the polygon): each segment is sampled every CLIP_STEP_DEG (so a long segment that dips through a small excluded area is still seen),
 * and where the answer flips the crossing is found by bisection — the run ends AT the edge, not at the last vertex before it. Runs under two points vanish. Only original vertices and crossings
 * are kept (the samples are for testing). Pure. */
export function clipOutside(path, drop, step = CLIP_STEP_DEG) {
  const runs = []; let cur = [];
  const flush = () => { if (cur.length > 1) runs.push(cur); cur = []; };
  const cross = (a, aDrop, b) => { // a and b answer differently: the kept-side point nearest the edge
    let lo = a, hi = b;
    for (let i = 0; i < 12; i++) { const m = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2]; if (drop(m) === aDrop) lo = m; else hi = m; }
    return aDrop ? hi : lo;
  };
  let prev = path[0], prevDrop = drop(prev);
  if (!prevDrop) cur.push(prev);
  for (let i = 1; i < path.length; i++) {
    const b = path[i], n = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - prev[0]), Math.abs(b[1] - prev[1])) / step));
    let a = prev, aDrop = prevDrop;
    for (let k = 1; k <= n; k++) {
      const pt = k === n ? b : [prev[0] + ((b[0] - prev[0]) * k) / n, prev[1] + ((b[1] - prev[1]) * k) / n];
      const d = drop(pt);
      if (d !== aDrop) { const edge = cross(a, aDrop, pt); if (aDrop) cur = [edge]; else { cur.push(edge); flush(); } }
      a = pt; aDrop = d;
    }
    if (!aDrop) cur.push(b); else flush();
    prev = b; prevDrop = aDrop;
  }
  flush();
  return runs;
}

const nameOf = (p) => String((p && (p.gnis_name ?? p.GNIS_NAME ?? p.FENAME ?? p.name ?? p.NAME)) || "");

/* A grid index over the Chattahoochee centreline segments (DCA's protected-river lines), so "is this point on the river?" visits a few segments, not hundreds. NHD often has NO name on the stretch that
 * runs along the river (live 2026-10-30 in Atlanta: the Chattahoochee itself is an unbuffered 'artificial path', while unnamed perennial 460 flowlines track it for kilometres), so the MRPA cut also
 * takes any stream within RIVER_NEAR_DEG (about 65 m) of the river's own centreline. Lines are in degrees scaled by cos(lat) so the tolerance is round. Pure. */
const RIVER_NEAR_DEG = 0.0006, RIVER_CELL_DEG = 0.002, RIVER_KX = 0.83;
function makeRiverIndex(rivers) {
  const cells = new Map(); let any = false;
  const add = (a, b) => {
    const x1 = a[0] * RIVER_KX, y1 = a[1], x2 = b[0] * RIVER_KX, y2 = b[1];
    const c0 = Math.floor((Math.min(x1, x2) - RIVER_NEAR_DEG) / RIVER_CELL_DEG), c1 = Math.floor((Math.max(x1, x2) + RIVER_NEAR_DEG) / RIVER_CELL_DEG);
    const r0 = Math.floor((Math.min(y1, y2) - RIVER_NEAR_DEG) / RIVER_CELL_DEG), r1 = Math.floor((Math.max(y1, y2) + RIVER_NEAR_DEG) / RIVER_CELL_DEG);
    for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) { const k = cx + "," + cy; (cells.get(k) || cells.set(k, []).get(k)).push([x1, y1, x2, y2]); }
    any = true;
  };
  for (const f of (rivers && rivers.features) || []) {
    if (!/^chattahoochee/i.test(nameOf(f.properties))) continue;
    for (const part of linePartsOf(f)) for (let i = 0; i + 1 < (part || []).length; i++) add(part[i], part[i + 1]);
  }
  if (!any) return null;
  return (lng, lat) => {
    const x = lng * RIVER_KX, y = lat, segs = cells.get(Math.floor(x / RIVER_CELL_DEG) + "," + Math.floor(y / RIVER_CELL_DEG));
    if (!segs) return false;
    for (const [x1, y1, x2, y2] of segs) {
      const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / L)) : 0;
      if (Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy)) <= RIVER_NEAR_DEG) return true;
    }
    return false;
  };
}

const midpoint = (path) => path[Math.floor(path.length / 2)];

/* THE FUNCTION: NHD flowlines + DNR trout lines + the District outline → the bands to draw.
 *   returns [{ ring: [[lng,lat],…], tier, from: "nhd" | "trout" }]
 * A part whose midpoint is inside the District is classified `district`. Membership is decided at the part's
 * midpoint (an NHD reach is ~1 km; a reach straddling the District line takes its middle's answer).
 * `districtOk` is FALSE when the District outline could not be loaded: then NO part is promoted to 75 and the caller
 * must say so — a missing outline must never silently draw the narrower band as if it were the answer. Pure. */
const _mrpaCache = new WeakMap();
function mrpaIndexes(mrpa) {
  if (!mrpa) return [];
  let v = _mrpaCache.get(mrpa);
  if (!v) { v = districtRings(mrpa).map(makeRingIndex); _mrpaCache.set(mrpa, v); }
  return v;
}

export function streamBufferBands({ nhd = null, trout = null, district = null, rivers = null, mrpa = null } = {}) {
  const rings = districtRings(district);
  const bands = [];
  const push = (path, tier, from) => {
    const ring = corridorRingLngLat(path, tier.eachSideFt * 2);
    if (ring && ring.length >= 3) bands.push({ ring, tier, from });
  };
  /* The MRPA corridor (ARC's polygon) as an indexed ring set, and the "is this point on the MRPA reach?" test the cuts share. `mrpa` null = the polygon could not be loaded: nothing is cut. */
  const mrpaIdx = mrpaIndexes(mrpa);
  const nearMrpa = (lng, lat) => mrpaIdx.length > 0 && inMrpaReachBox(lng, lat, MRPA_BOX_PAD_DEG) && nearRingIndexes(mrpaIdx, lng, lat, MRPA_EDGE_DEG);
  const dropMrpa = ([lng, lat]) => nearMrpa(lng, lat);
  /* The Chattahoochee's own 75 / 50 / 25-ft bands stop at the corridor edge too (the MRPA plan governs inside it): a feature NAMED Chattahoochee, and any stream that runs within ~65 m of DCA's
   * Chattahoochee centreline while inside the corridor (the river's unnamed flowlines and a tributary's mouth). A tributary away from the river keeps its band. */
  const onRiver = makeRiverIndex(rivers);
  const dropMrpaRiver = ([lng, lat]) => nearMrpa(lng, lat) && !!onRiver && onRiver(lng, lat);
  const partsFor = (feature, part) => {
    if (!mrpaIdx.length) return [part];
    if (/^chattahoochee/i.test(nameOf(feature.properties))) return clipOutside(part, dropMrpa);
    return onRiver ? clipOutside(part, dropMrpaRiver) : [part];
  };
  for (const feature of (nhd && nhd.features) || []) {
    if (!isBufferedStream(feature.properties)) continue;
    for (const whole of linePartsOf(feature)) {
      if (!whole || whole.length < 2) continue;
      for (const part of partsFor(feature, whole)) {
        const m = midpoint(part);
        push(part, tierFor({ inDistrict: inAnyRing(m[0], m[1], rings) }), "nhd");
      }
    }
  }
  for (const feature of (trout && trout.features) || []) {
    for (const whole of linePartsOf(feature)) {
      if (!whole || whole.length < 2) continue;
      for (const part of partsFor(feature, whole)) {
        const m = midpoint(part);
        push(part, tierFor({ inDistrict: inAnyRing(m[0], m[1], rings), trout: true }), "trout");
      }
    }
  }
  // DCA's protected rivers: 100 ft each side (the widest tier — no narrower rule can govern a protected river) — EXCEPT on the segments the rule excludes: the MRPA reach of the Chattahoochee
  // (cut out by ARC's corridor polygon; `mrpa` null = the polygon could not be loaded, and the caller must say the band may cover that reach) and the tidal reaches (Coastal Marshlands Protection Act).
  // The tidal cells are a vertex-derived proxy (gaTidalReaches.js marks the cell under each tidal VERTEX of DCA's lines), so they cut at vertices; the MRPA corridor is a real polygon and cuts geometrically.
  for (const feature of (rivers && rivers.features) || []) {
    for (const part of linePartsOf(feature)) {
      if (!part || part.length < 2) continue;
      for (const fresh of keepRuns(part, ([lng, lat]) => inTidalReach(lng, lat))) {
        for (const run of mrpaIdx.length ? clipOutside(fresh, dropMrpa) : [fresh]) push(run, GA_BUFFER_TIERS.river, "river");
      }
    }
  }
  return bands;
}

/* The status line when a supporting source of the buffer layer failed (NEW-1 third review, 2026-10-30): which sources were lost and what that does to the picture. Pure.
 *   · a lost trout / District / protected-river source makes a band NARROWER than the rule (no 50 ft trout tier, no 75 ft District tier, no 100 ft river tier);
 *   · a lost MRPA corridor makes the Chattahoochee band WIDER than the rule — nothing can be cut where the Metropolitan River Protection Act governs;
 *   · a lost protected-river source ALSO leaves the river's unnamed flowlines uncut (the cut that follows DCA's centreline needs the lines — `makeRiverIndex` is null), so the
 *     District's 75-ft band is drawn along the Chattahoochee INSIDE the corridor too. Either of the two therefore says the river/District bands may be drawn along the reach.
 * `failed` = { trout, district, rivers, mrpa } booleans; returns "" when nothing failed. */
export function streamBufferLossNote(label, failed = {}) {
  const lost = [failed.trout && "trout streams", failed.district && "the Metro North Georgia District outline", failed.rivers && "the protected-river lines", failed.mrpa && "the Chattahoochee MRPA corridor"].filter(Boolean);
  if (!lost.length) return "";
  const narrower = failed.trout || failed.district || failed.rivers;
  const inCorridor = failed.mrpa || failed.rivers;
  const effect = [narrower && "the bands shown may be narrower than the rule", inCorridor && "river or District bands may be drawn along the Chattahoochee reach, inside the corridor where the Metropolitan River Protection Act's buffers govern instead"].filter(Boolean).join("; ");
  return `${label}: couldn't load ${lost.join(" and ")} — ${effect}. NOT the full answer (screening only).`;
}

/* The legend/ⓘ line — one sentence per tier actually present in the bands (so a Savannah view never advertises a
 * mountain trout rule). Pure. */
export function bufferLegend(bands) {
  const seen = new Set((bands || []).map((b) => b.tier.id));
  return Object.values(GA_BUFFER_TIERS).filter((t) => seen.has(t.id)).map((t) => t.label);
}
