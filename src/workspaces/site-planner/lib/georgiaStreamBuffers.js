/* Georgia stream buffers — the PURE half (Georgia screening, Part B1). No Leaflet, no DOM, no network.
 *
 * WHAT IS DRAWN. A band on each side of a stream centreline, at the width the strictest rule that reaches
 * that stream asks for:
 *   state    25 ft   every state-waters stream — the Georgia Erosion & Sedimentation Act (O.C.G.A. 12-7-6(b)(15)) buffer.
 *   trout    50 ft   a Georgia DNR-mapped trout stream — the trout-water buffer.
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

export const GA_BUFFER_TIERS = {
  state: { id: "state", eachSideFt: 25, color: "#b45309", label: "25 ft state-waters buffer" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
  trout: { id: "trout", eachSideFt: 50, color: "#0f766e", label: "50 ft trout-stream buffer" }, // design-exempt: map ink for a drawn buffer tier (cartography, not UI chrome)
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

const midpoint = (path) => path[Math.floor(path.length / 2)];

/* THE FUNCTION: NHD flowlines + DNR trout lines + the District outline → the bands to draw.
 *   returns [{ ring: [[lng,lat],…], tier, from: "nhd" | "trout" }]
 * A part whose midpoint is inside the District is classified `district`. Membership is decided at the part's
 * midpoint (an NHD reach is ~1 km; a reach straddling the District line takes its middle's answer).
 * `districtOk` is FALSE when the District outline could not be loaded: then NO part is promoted to 75 and the caller
 * must say so — a missing outline must never silently draw the narrower band as if it were the answer. Pure. */
export function streamBufferBands({ nhd = null, trout = null, district = null } = {}) {
  const rings = districtRings(district);
  const bands = [];
  const push = (path, tier, from) => {
    const ring = corridorRingLngLat(path, tier.eachSideFt * 2);
    if (ring && ring.length >= 3) bands.push({ ring, tier, from });
  };
  for (const feature of (nhd && nhd.features) || []) {
    if (!isBufferedStream(feature.properties)) continue;
    for (const part of linePartsOf(feature)) {
      if (!part || part.length < 2) continue;
      const m = midpoint(part);
      push(part, tierFor({ inDistrict: inAnyRing(m[0], m[1], rings) }), "nhd");
    }
  }
  for (const feature of (trout && trout.features) || []) {
    for (const part of linePartsOf(feature)) {
      if (!part || part.length < 2) continue;
      const m = midpoint(part);
      push(part, tierFor({ inDistrict: inAnyRing(m[0], m[1], rings), trout: true }), "trout");
    }
  }
  return bands;
}

/* The legend/ⓘ line — one sentence per tier actually present in the bands (so a Savannah view never advertises a
 * mountain trout rule). Pure. */
export function bufferLegend(bands) {
  const seen = new Set((bands || []).map((b) => b.tier.id));
  return Object.values(GA_BUFFER_TIERS).filter((t) => seen.has(t.id)).map((t) => t.label);
}
