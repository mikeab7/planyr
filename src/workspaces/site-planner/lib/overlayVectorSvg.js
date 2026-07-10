/* B745 — pure SVG emitter for the VECTOR / client-drawn GIS overlay layers in the export.
 *
 * Phase 1 (B739) composited the RASTER overlays (FEMA/pipelines/…) as frame-exact <image>s.
 * The thin-line layers — esriFeature (transmission, road-authority), vector boundaries
 * (county/city/ETJ), contours/flowdir (terrain), overpass/mapillary (OSM/street points) — are
 * drawn client-side by Leaflet and can't be captured by the SVG clone or a (canvas-tainting)
 * screenshot. So the gatherer in SitePlanner.jsx reads each live layer's lat/lon geometry,
 * normalizes it to the flat feature list below, and this module reprojects + emits it as an SVG
 * fragment — the drift-free "reproject + emit" pattern kmzExport.js uses (one injected projection,
 * LOUD-skip on any non-finite vertex, never a half-drawn feature).
 *
 * Leaflet-free + pure → unit-tested (test/overlayVectorSvg.test.js).
 *
 * Normalized feature (coords are [lon,lat] WGS84 unless `space:"pixel"`, then already viewBox px):
 *   { kind:"line", coords:[[lon,lat],…], style }
 *   { kind:"polygon", coords:[ ring0, …holes ], style }   ring = [[lon,lat],…]
 *   { kind:"point", coords:[lon,lat], style }
 *   { kind:"line", space:"pixel", coords:[[x,y],…], style }   // flow arrows (fixed-px glyph)
 * style: { stroke, strokeWidth, strokeOpacity, dash, fill, fillOpacity, radius }
 */
import { xmlEscape } from "./kmzExport.js";

const clampNum = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
// Trim to `round` decimals without trailing-zero / exponent noise (kmzExport `num` idiom).
const fmt = (n, round) => Number(Number(n).toFixed(round)).toString();
const isFinitePair = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);
const identityPx = (c) => ({ x: c[0], y: c[1] });

const attr = (k, v) => (v == null || v === "" ? "" : ` ${k}="${v}"`);

/* Project one feature's coords and emit its SVG element STRING, or null if ANY projected vertex
 * is non-finite (skip the WHOLE feature — a half-drawn floodplain/contour is worse than an honest
 * omission). `projectLngLat([lon,lat]) -> {x,y}`; a `space:"pixel"` feature bypasses it. Pure. */
export function featureToSvg(feature, projectLngLat, { round = 2, opacity = 1 } = {}) {
  if (!feature || !feature.coords) return null;
  const proj = feature.space === "pixel" ? identityPx : projectLngLat;
  const s = feature.style || {};
  const opac = (v) => fmt(clampNum(v * opacity, 0, 1), 3); // round out float noise (0.9*0.9 → "0.81")
  const so = attr("stroke-opacity", s.strokeOpacity != null ? opac(s.strokeOpacity) : null);
  const fo = attr("fill-opacity", s.fillOpacity != null ? opac(s.fillOpacity) : null);
  const sw = attr("stroke-width", s.strokeWidth != null ? s.strokeWidth : null);
  const stroke = attr("stroke", s.stroke);
  const dash = attr("stroke-dasharray", s.dash);

  const projLine = (pts) => {
    const out = [];
    for (const c of pts) {
      const q = proj(c);
      if (!isFinitePair(q)) return null; // non-finite → skip whole feature
      out.push(`${fmt(q.x, round)},${fmt(q.y, round)}`);
    }
    return out;
  };

  if (feature.kind === "line") {
    const pts = projLine(feature.coords);
    if (!pts || pts.length < 2) return null;
    const d = "M" + pts.join(" L");
    return `<path d="${d}" fill="none"${stroke}${sw}${so}${dash} stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  if (feature.kind === "polygon") {
    const rings = [];
    for (const ring of feature.coords) {
      const pts = projLine(ring);
      if (!pts || pts.length < 3) return null; // a bad ring kills the whole polygon (no partial)
      rings.push("M" + pts.join(" L") + " Z");
    }
    if (!rings.length) return null;
    const fill = attr("fill", s.fill || "none");
    return `<path d="${rings.join(" ")}"${fill}${fo}${stroke}${sw}${so}${dash} fill-rule="evenodd" stroke-linejoin="round"/>`;
  }

  if (feature.kind === "point") {
    const q = proj(feature.coords);
    if (!isFinitePair(q)) return null;
    const r = s.radius != null ? s.radius : 3.5;
    const fill = attr("fill", s.fill || s.stroke || "#333");
    return `<circle cx="${fmt(q.x, round)}" cy="${fmt(q.y, round)}" r="${fmt(r, round)}"${fill}${fo}${stroke}${sw}${so}/>`;
  }

  return null;
}

/* Exhibit label text (pre-placed in pixel space): dark ink + white halo (paint-order:stroke),
 * matching the acreage-chip halo the export restyle already emits so the NEW-2 stroke-thinning
 * pass keeps it proportional. `labels` = [{x,y,text,uppercase?}]. Pure. */
function labelSvg(labels, round) {
  let out = "";
  for (const lb of labels || []) {
    if (!lb || !Number.isFinite(lb.x) || !Number.isFinite(lb.y) || !lb.text) continue;
    const up = lb.uppercase ? ' style="text-transform:uppercase"' : "";
    out +=
      `<text x="${fmt(lb.x, round)}" y="${fmt(lb.y, round)}" text-anchor="middle" dominant-baseline="middle"` +
      ` font-family="Inter,system-ui,sans-serif" font-weight="700" font-size="11" fill="#1a1a1a"` +
      ` stroke="#ffffff" stroke-width="3" paint-order="stroke"${up}>${xmlEscape(lb.text)}</text>`;
  }
  return out;
}

/* Build ONE SVG fragment string for a whole normalized feature list. Returns
 * { svg, emitted, skipped } — a feature that couldn't be fully projected is SKIPPED and counted
 * (the caller logs it), never emitted partial. Labels ride after the geometry. Pure. */
export function buildOverlayVectorFragment(features, projectLngLat, opts = {}) {
  const { opacity = 1, labels = [], round = 2 } = opts;
  let svg = "";
  let emitted = 0, skipped = 0;
  for (const f of features || []) {
    const el = featureToSvg(f, projectLngLat, { round, opacity });
    if (el) { svg += el; emitted++; } else { skipped++; }
  }
  svg += labelSvg(labels, round);
  return { svg, emitted, skipped };
}

/* String-only convenience. */
export function overlayVectorSvg(features, projectLngLat, opts = {}) {
  return buildOverlayVectorFragment(features, projectLngLat, opts).svg;
}

// ---------------------------------------------------------------------------
// Pure normalizers (Leaflet-free) — turn provider geometry into the feature list above.
// ---------------------------------------------------------------------------

/* GeoJSON LineString / MultiLineString ([lon,lat]) → one `line` feature per part. Pure. */
export function esriLineFeatures(geometry, style) {
  if (!geometry) return [];
  const g = geometry;
  const parts = g.type === "MultiLineString" ? g.coordinates : g.type === "LineString" ? [g.coordinates] : [];
  return parts.filter((p) => p && p.length >= 2).map((coords) => ({ kind: "line", coords, style }));
}

/* GeoJSON Polygon / MultiPolygon ([lon,lat]) → one `polygon` feature per part (holes kept as
 * inner rings, drawn with fill-rule evenodd). Pure. */
export function esriPolygonFeatures(geometry, style) {
  if (!geometry) return [];
  const g = geometry;
  const polys = g.type === "MultiPolygon" ? g.coordinates : g.type === "Polygon" ? [g.coordinates] : [];
  return polys.filter((rings) => rings && rings.length && rings[0].length >= 3).map((coords) => ({ kind: "polygon", coords, style }));
}

// terrain worker artifact coords are [lat,lng]; GeoJSON/our features are [lon,lat].
export const swapLatLng = (ll) => [ll[1], ll[0]];

// Topo palette (mirrors terrainLayers.js so print matches screen — PDF-PARITY).
const CONTOUR_COL = "#7C3F12", CONTOUR_INDEX_COL = "#5B2E0D", ARROW_COL = "#0369A1";

/* Terrain contour artifact { levels:[{level,isIndex,lines:[[[lat,lng],…]]}], labels:[{ll,level}] }
 * → { features (lines, [lon,lat]), labels ([{lng,lat,text}]) }. Index lines heavier (never faded —
 * the salience rule). Pure. */
export function contourFeatures(contours) {
  const features = [], labels = [];
  if (!contours || !contours.levels) return { features, labels };
  for (const lv of contours.levels) {
    for (const line of lv.lines || []) {
      if (!line || line.length < 2) continue;
      features.push({
        kind: "line",
        coords: line.map(swapLatLng),
        style: { stroke: lv.isIndex ? CONTOUR_INDEX_COL : CONTOUR_COL, strokeWidth: lv.isIndex ? 2.2 : 1.1, strokeOpacity: 1 },
      });
    }
  }
  for (const lab of contours.labels || []) {
    if (!lab || !lab.ll) continue;
    const [lng, lat] = swapLatLng(lab.ll);
    labels.push({ lng, lat, text: `${lab.level} ft` });
  }
  return { features, labels };
}

/* One drainage-arrow glyph as a PIXEL-space `line` feature (tail→tip + two arrowhead barbs),
 * built from the arrow's already-projected center {x,y} + dir/slope — the SAME length/width
 * formula terrainLayers.renderArrows uses (fixed-px screen glyph, y-down like f2p). Pure. */
export function arrowGlyphFeatures(arrow, center) {
  if (!arrow || !center || !Number.isFinite(center.x) || !Number.isFinite(center.y)) return [];
  const t = clampNum((arrow.slope - 0.0008) / (0.02 - 0.0008), 0, 1);
  const len = 14 + 14 * t, w = 1.2 + 1.6 * t, head = Math.max(5, len * 0.38);
  const dx = Math.cos(arrow.dir), dy = Math.sin(arrow.dir);
  const tip = [center.x + (dx * len) / 2, center.y + (dy * len) / 2];
  const tail = [center.x - (dx * len) / 2, center.y - (dy * len) / 2];
  const back = arrow.dir + Math.PI;
  const h1 = [tip[0] + Math.cos(back - 0.45) * head, tip[1] + Math.sin(back - 0.45) * head];
  const h2 = [tip[0] + Math.cos(back + 0.45) * head, tip[1] + Math.sin(back + 0.45) * head];
  return [{ kind: "line", space: "pixel", coords: [tail, tip, h1, tip, h2], style: { stroke: ARROW_COL, strokeWidth: w, strokeOpacity: 1 } }];
}
