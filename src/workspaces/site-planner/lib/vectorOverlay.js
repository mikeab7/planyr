/* Cached-vector boundary overlay — the Leaflet glue over the pure vector engine
 * (B694/B695). This is the render consumer vectorLayers.js was built for: a
 * view-driven layer that PAINTS the last-good cached copy instantly (no waiting on
 * TxDOT/TxGIO), refreshes in the background, and always reports the copy's age
 * through the same onStatus channel the Layers panel already renders.
 *
 * Structure mirrors evidenceLayers.js's overpassLayer (the house pattern for a
 * view-driven cached layer): an L.layerGroup whose onAdd wires a `moveend` refresh
 * (zoom changes fire moveend too), plus:
 *  - hover → name tooltip + a subtle polygon highlight; click → a small identify
 *    popover (name + the has-jurisdiction wording) — both gated by `identifyOk()`
 *    so an active tool / parcel-select always wins the click (the B98 rule). Path
 *    events bubble to the map by default, so map-level handlers still fire.
 *  - zoom-gated name labels at polygon anchors, collision-dropped (boundaryLabels.js
 *    does the pure math). Labels ride a dedicated pointer-events:none pane.
 *  - a LIVE fallback: if the vector pull fails with nothing cached, the caller's
 *    `buildFallback()` (the previous esri-leaflet featureLayer path) takes over for
 *    the session — a cache/CORS failure never blanks the layer (LOUD via status,
 *    never silent).
 *
 * The planner's backdrop map is non-interactive (pointer-events: none), so the
 * hover/click identify is effectively a map-finder feature; the planner still gets
 * the instant cached paint. Labels live inside the Leaflet container, which carries
 * data-export="skip" on the planner — they can never leak into a PDF/PNG export.
 */
import L from "leaflet";
import { gisCache } from "./gisCache.js";
import { VECTOR_SOURCES, isCountyLinesId, isCityLimitsId, placeLabelZoom, fetchCached, decideVectorOrImage, pickTier, snapBbox, vectorKey, styleFor, identifyRows, hitFeature } from "./vectorLayers.js";
import { labelsVisible, titleCaseName } from "./boundaryLabels.js";
import { placeNamesShown, placeNameKey } from "./placeNamesGate.js";
import { cardNode } from "./identifyCard.js";
import { makeHighlight, setHighlight, releaseHighlight, childFor } from "./featureHighlight.js";
import { countyLineLabels, countyLabelText } from "./countyLineLabels.js";
import { siteState } from "./siteRegion.js";
import { COUNTY_LINE_COLOR, COUNTY_LINE_WEIGHT, COUNTY_LINE_DASH, PLACE_LABEL_INK, PLACE_PILL_ETJ_BG, PLACE_PILL_SHADOW, PLACE_LABEL_SHADOW } from "./boundaryStyle.js";
import { placeStyle, colorFeatures, placeKey, sharedColorBook } from "./boundaryPaint.js";
import { viewAnchors, placeNames, labelFontPx, labelBoxPx } from "./placeLabelAnchors.js";
import { combineJurisdictionHits, COUNTIES_CITIES_GROUP } from "./jurisdictionCard.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { corridorRingLngLat, DEFAULT_CORRIDOR_WIDTH_FT } from "./pipelineCorridor.js";
import { streamBufferBands, bufferLegend, streamBufferLossNote } from "./georgiaStreamBuffers.js";
import { streamBufferBandsTn, bufferLegendTn } from "./tennesseeStreamBuffers.js";   // B2521584 (Tennessee)
import { ftypeLabel } from "./nhdFlowline.js";
import { pointSymbolOptions } from "./layerRequest.js";
import { installDefaultMarkerIcon, pointToLayerFor } from "./mapSymbols.js";

const LABEL_PANE = "boundarylabels";

// Safety net for any marker this module's callers might still create (see mapSymbols.js).
installDefaultMarkerIcon();

/* Is this GeoJSON feature a point? Both style and hover emphasis branch on it (NEW-1).
 * Tolerant of a missing feature: `baseStyle()` is called with no argument from the
 * non-per-feature paths, and those all want the line/polygon style. */
export const isPointFeature = (feature) => {
  const t = feature && feature.geometry && feature.geometry.type;
  return t === "Point" || t === "MultiPoint";
};

/* Shared identify-row renderer (B1075/B1078) — the ONE place a `source.identifyFields`
 * row becomes DOM, used by both the polygon (cachedVectorLayer) and line
 * (cachedPipelineLayer) identify popovers so the two can't drift.
 *
 * Field options:
 *   unit    — appended to a bare number ("70" + "ft" → "70 ft"; "in" renders as ″)
 *   decode  — "nhdFtype": an integer code → plain English ("336" → "canal / ditch")
 *   kind    — "link": render as an anchor when the value IS a URL, or when the source
 *             declares a `linkBase`/`exhibitBase` to build one from. With neither, the
 *             value renders as plain TEXT — a document reference we can't resolve is
 *             still worth showing, and a fabricated URL never is.
 *
 * External attribute values always go through textContent / a built href — never
 * innerHTML (the same rule the rest of this module follows). */
export function decodeFieldValue(raw, f = {}) {
  if (f.decode === "nhdFtype") return ftypeLabel(raw) || String(raw);
  if (f.unit === "in" && /^[\d.]+$/.test(String(raw))) return `${raw}″`;
  if (f.unit && /^[\d.]+$/.test(String(raw))) return `${raw} ${f.unit}`;
  return String(raw);
}

/* Resolve an identify link field to an href, or null when we can't honestly build one. */
export function identifyHref(raw, source = {}) {
  const v = String(raw || "").trim();
  if (/^https?:\/\//i.test(v)) return v;
  const base = source.exhibitBase || source.linkBase || null;
  if (!base || !v) return null;
  return base.replace(/\/+$/, "") + "/" + v.replace(/^\/+/, "");
}

/* The headline for a LINE identify popover. Registry-driven (B1078) so one popover code
 * path serves pipelines ("Crude oil"), hydrography ("Willow Fork"), and anything added
 * later: prefer the source's declared title field, decode it if it's a code, else fall
 * back to the source's own honest "not stated" wording. Pure. */
export function identifyTitle(source = {}, props = {}) {
  // The pipeline layer's original behaviour, preserved verbatim as the default.
  if (!source.identifyTitleField) {
    const commodity = props[source.commodityField];
    return commodity == null || commodity === "" ? "Pipeline (commodity not stated)" : String(commodity);
  }
  const raw = props[source.identifyTitleField];
  if (raw != null && String(raw).trim() !== "") return String(raw).trim();
  if (source.identifyTitleDecode === "nhdFtype") {
    const decoded = ftypeLabel(props.ftype ?? props.FTYPE);
    if (decoded) return decoded;
  }
  return source.identifyFallbackTitle || source.label || "Feature";
}

/* The registry rows for one feature, as plain data (B1092). The DOM builder below and
 * the planner's own identify card both render THIS, so the map finder's popover and the
 * canvas card can never drift. */
export const identifyRowsFor = (source, props) =>
  identifyRows(source, props, { decode: decodeFieldValue, href: identifyHref });

export function appendIdentifyRows(el, source, props) {
  for (const r of identifyRowsFor(source, props)) {
    const row = document.createElement("div");
    const lab = document.createElement("span");
    lab.style.cssText = "opacity:0.7;";
    lab.textContent = `${r.label}: `;
    row.append(lab);
    const text = r.text, href = r.href;
    if (href) {
      const a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
      a.textContent = text;
      row.append(a);
    } else {
      const val = document.createElement("span");
      val.textContent = text;
      row.append(val);
    }
    el.append(row);
  }
  return el;
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Map-cartography label style: white with a dark halo reads on any imagery/theme —
// this is on-map lettering (like the tile providers' own labels), not app chrome,
// so it deliberately does not follow the app theme tokens.
const labelHtml = (text, { uppercase, angle = 0, fontPx = 11, pill = null, dashed = false }) =>
  `<span style="position:absolute;transform:translate(-50%,-50%)${angle ? ` rotate(${Math.round(angle * 10) / 10}deg)` : ""};white-space:nowrap;color:${PLACE_LABEL_INK};` +
  (pill
    ? `background:${dashed ? PLACE_PILL_ETJ_BG : pill};${dashed ? `color:${pill};border:1.5px dashed ${pill};` : ""}padding:1px 7px;border-radius:999px;box-shadow:${PLACE_PILL_SHADOW};`
    : `text-shadow:${PLACE_LABEL_SHADOW};`) +
  `font:700 ${Math.round(fontPx * 10) / 10}px/1.2 system-ui,sans-serif;` +
  `letter-spacing:0.04em;${uppercase ? "text-transform:uppercase;" : ""}pointer-events:none;" data-place-label="1">${escapeHtml(text)}</span>`;

/* NEW-1 — the Counties & Cities members live on each map, so a click on ANY of them can ask the others what is under the same point (one combined card). */
const boundaryMembers = new WeakMap(); // map → Map(sourceId → identifyAt)
const boundaryGate = new WeakMap(); // map → { ok, handler } — the ONE map-level click handler (a click INSIDE a shape reaches no polygon: only the outline answers a click, index.css)
const tolDegFor = (m) => (360 / (256 * Math.pow(2, m.getZoom()))) * 4;
/* The combined Counties & Cities answer at a point: every member layer on this map asked, folded into one card item (jurisdictionCard.js), or null. */
function boundaryItemAt(m, latlng) {
  const at = { lat: latlng.lat, lng: latlng.lng, tolDeg: tolDegFor(m) };
  const hits = [];
  for (const ask of (boundaryMembers.get(m) || new Map()).values()) { try { const h = ask(at); if (h) hits.push(h); } catch (_) { /* one bad member never breaks the card */ } }
  return combineJurisdictionHits(hits);
}
/* Open the ONE card for a click at `latlng`; the clicked place is outlined until the card closes (B2507061). Returns the popup, or null when nothing answers. */
function openBoundaryCard(m, latlng) {
  const item = boundaryItemAt(m, latlng);
  if (!item) return null;
  const node = cardNode({ title: item.title, rows: item.rows, note: item.note, about: item.sourceName ? `Source: ${item.sourceName}` : null });
  const popup = L.popup({ maxWidth: 280, autoPan: false }).setLatLng(latlng).setContent(node).openOn(m);
  if (item.highlight) { setHighlight(item.highlight); popup.on("remove", () => releaseHighlight(item.highlight)); }
  return popup;
}
/* A click on bare map (or inside a shape) answers with the card, unless the click landed on something that answers for itself (another layer's polygon, a pin, a control). */
function ensureBoundaryClick(m, ok) {
  if (boundaryGate.has(m)) return;
  const entry = { ok, handler: (e) => {
    const g = boundaryGate.get(m);
    if (!g || !(boundaryMembers.get(m) || new Map()).size || !g.ok()) return;
    const t = e.originalEvent && e.originalEvent.target;
    if (t && t.closest && t.closest(".leaflet-interactive, .leaflet-marker-icon, .leaflet-popup, .leaflet-control")) return;
    openBoundaryCard(m, e.latlng);
  } };
  boundaryGate.set(m, entry);
  m.on("click", entry.handler);
}
function releaseBoundaryClick(m) {
  if ((boundaryMembers.get(m) || new Map()).size) return;
  const g = boundaryGate.get(m);
  if (g) { m.off("click", g.handler); boundaryGate.delete(m); }
}

/* Build the cached boundary layer for overlay id `k` (must have a VECTOR_SOURCES
 * row). Returns an L.LayerGroup with a `setOpacity` like every other overlay, or
 * null when no registry row exists (caller keeps its old path). Options:
 *   cache         — injected SWR cache (default: the gisCache singleton)
 *   interactive   — enable hover/click identify (map finder yes; planner backdrop no)
 *   identifyOk    — live gate read per event: false while a tool owns clicks (B98)
 *   buildFallback — () => a live esri-leaflet layer, engaged if the vector pull dies */
export function cachedVectorLayer(k, cfg, initialOpacity, pane, onStatus, opts = {}) {
  const source = VECTOR_SOURCES[k];
  if (!source) return null;
  // NEW-1 — `labelPane` lets the caller put this layer's name labels in the SAME stacking
  // band as the layer itself (lib/mapStack.js), so a stream's name is never buried under the
  // building the stream is drawn over. Absent → the historic shared label pane.
  const { cache = gisCache, interactive = false, identifyOk = () => true, buildFallback = null, labelPane = LABEL_PANE } = opts;
  const labelPaneName = labelPane || LABEL_PANE;

  let map = null, opacity = initialOpacity, lastVectorError = null;
  let fellBack = false, fallbackLayer = null, openPopup = null;
  let seq = 0, lastKey = null, lastFc = null;
  const labelMarkers = [];
  const report = (state, msg, extra) => onStatus && onStatus(k, state, msg, extra);
  const lineColor = cfg.color || "#374151";
  /* NEW-1 — the style has to be GEOMETRY-AWARE, because L.geoJSON applies `options.style`
   * to every layer it builds, circleMarkers from `pointToLayer` included. Handing a point
   * the polygon style below would flatten it to the 0.02 hit-area fill — a symbol you can
   * barely see. So a point gets the filled-disc symbology instead, and everything else keeps
   * the boundary style verbatim. */
  const pointStyle = () => ({ ...pointSymbolOptions(cfg, opacity), className: "pf-boundary-hit" });
  /* B2507065 (NEW-10, owner constraint #47) — Counties & Cities reads at a glance. CITY LIMITS: a bolder outline plus a light tint INSIDE (none outside = unincorporated). COUNTIES:
   * a heavier DASHED grey line with a light halo (the `pf-county-line` CSS filter) — a different kind of line from a city's solid one; state lines (adminBoundaryData) are heavier still. */
  const countyLine = isCountyLinesId(source.id), cityLine = isCityLimitsId(source.id), etjLine = source.id === "jur_etj";
  const placeLine = cityLine || etjLine; // a layer of PLACES: each city gets its own hue (boundaryPaint)
  const lineStyle = (feature) => (countyLine ? {
    color: COUNTY_LINE_COLOR, weight: COUNTY_LINE_WEIGHT, opacity: Math.max(opacity, 0.85), dashArray: COUNTY_LINE_DASH,
    fill: true, fillColor: COUNTY_LINE_COLOR, fillOpacity: interactive ? 0.02 : 0, className: "pf-boundary-hit pf-county-line",
  } : placeLine ? {
    // NEW-1 (owner 2026-11-05): ONE hue per city — limits bold + tinted, ETJ the same hue thinner, dashed, fainter. The hue book is shared by every layer and surface.
    ...placeStyle(etjLine ? "etj" : "city", nameOf(feature), { opacity, fallbackInk: lineColor }), fill: true, className: "pf-boundary-hit",
  } : {
    color: lineColor, weight: cfg.weight || 2, opacity,
    // B761: a boundary source can request a DASHED stroke (cfg.dash) — line style, not colour, is how a kind of line is told apart.
    ...(cfg.dash ? { dashArray: "6 5" } : {}),
    // fill is the hover/click hit area; at 0.02 it's imperceptible on imagery. The
    // className lets select mode neutralize Leaflet's `.leaflet-interactive
    // {cursor:pointer}` (which would otherwise override the parcel-select cursor
    // across the whole fill — see the .pf-select-mode rule in index.css).
    fill: true, fillColor: lineColor, fillOpacity: interactive ? 0.02 : 0,
    className: "pf-boundary-hit",
  });
  // NEW-2 — an SB 2038 release area draws DOTTED (line style, never opacity, is what separates a kind of line):
  // solid = city limits, dashed = ETJ, dotted = a release area.
  const baseStyle = (feature) => (isPointFeature(feature) ? pointStyle()
    : feature && feature.properties && feature.properties._release ? { ...lineStyle(feature), dashArray: "2 5" } : lineStyle(feature));

  const group = L.layerGroup([], { pane });
  const nameOf = (feature) => {
    const raw = feature && feature.properties && feature.properties[source.labelField];
    let name = raw == null ? "" : String(raw).trim();
    if (name && source.titleCaseLabel) name = titleCaseName(name);
    return name;
  };
  const displayName = (feature) => {
    const name = nameOf(feature);
    if (!name) return cfg.label;
    return source.nameTemplate ? source.nameTemplate.replace("{name}", name) : name;
  };

  const wireFeature = (feature, lyr) => {
    if (!interactive) return;
    // B2507061 (owner constraint #43): NO hover tooltip and no hover emphasis — a boundary answers a CLICK with the clean card, and nothing else.
    lyr.on("click", (e) => {
      if (!identifyOk() || !map) return;
      /* NEW-1 (owner 2026-11-05): a click on the Counties & Cities row answers with ONE card — city, limits or ETJ, county — built from every member layer at the point
       * (jurisdictionCard.js), never with whichever polygon happened to be on top. */
      if (cfg.mergeGroup === COUNTIES_CITIES_GROUP) {
        const popup = openBoundaryCard(map, e.latlng);
        if (popup) { openPopup = popup; return; }
      }
      const about = source.sourceName ? `Source: ${source.sourceName}` : null;
      const node = cardNode({ title: displayName(feature), rows: identifyRowsFor(source, feature && feature.properties), note: source.identifyNote || null, about });
      openPopup = L.popup({ maxWidth: 280, autoPan: false }).setLatLng(e.latlng).setContent(node).openOn(map);
      const token = makeHighlight(lyr); // B2507061: only the CLICKED feature is outlined, and only until its card closes
      if (token) { setHighlight(token); openPopup.on("remove", () => releaseHighlight(token)); }
    });
  };
  // Close OUR identify popover (never someone else's) — on toggle-off / fallback the
  // popover must not outlive the boundaries it describes.
  const closeIdentify = () => {
    if (openPopup && map) { try { map.closePopup(openPopup); } catch (_) {} }
    openPopup = null;
  };

  /* NEW-1 — `pointToLayer` is NOT optional. A GeoJSON POINT reaching L.geoJSON without one
   * gets Leaflet's default `L.marker` + `L.Icon.Default`, whose PNG never resolved under the
   * bundler: the browser painted its broken-image glyph and the marker's "Marker" alt text
   * (clipped to read "Mark"). Points now become circleMarkers in the source's own colour —
   * which also hands them to `wireFeature` as ordinary interactive vector layers, so the
   * hover/click identify below reaches a point with no further wiring. */
  const geo = L.geoJSON(null, {
    pane, interactive, style: baseStyle, onEachFeature: wireFeature,
    pointToLayer: pointToLayerFor(cfg, opacity, { interactive }),
  });
  group.addLayer(geo);

  const clearLabels = () => { for (const m of labelMarkers) { try { group.removeLayer(m); } catch (_) {} } labelMarkers.length = 0; };

  // Re-place the zoom-gated name labels for the current view (pure math in
  // boundaryLabels.js; bigger polygons win, collisions drop).
  /* B2507065 (NEW-10): COUNTY names go alongside the line on each county's own side, turned to run parallel to it ("DeSoto Co." / "Shelby Co., TN"), instead of at the middle
   * of the county. Pure placement in countyLineLabels.js; this only projects and draws. */
  const mapPx = (m) => (lng, lat) => { try { return m.latLngToContainerPoint([lat, lng]); } catch (_) { return null; } };
  const mapBounds = (m) => { const b = m.getBounds(); return { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() }; };
  const addLabel = (m, px, py, html) => {
    let ll = null; try { ll = m.containerPointToLatLng([px, py]); } catch (_) { return; }
    const icon = L.divIcon({ className: "", html, iconSize: [0, 0] });
    const mk = L.marker([ll.lat, ll.lng], { icon, interactive: false, keyboard: false, pane: labelPaneName });
    group.addLayer(mk);
    labelMarkers.push(mk);
  };
  const refreshCountyLabels = () => {
    if (!map || !lastFc || !labelsVisible(placeLabelZoom(source), map.getZoom())) return;
    const size = map.getSize(), c = map.getCenter(), zoom = map.getZoom(), fontPx = labelFontPx(zoom);
    const home = siteState({ lat: c.lat, lng: c.lng });
    const feats = lastFc.features || [];
    const textOf = (f) => countyLabelText(nameOf(f), source.stateAbbr, home);
    const labels = countyLineLabels(feats, {
      textOf, project: (lng, lat) => { try { return map.latLngToContainerPoint([lat, lng]); } catch (_) { return null; } },
      unproject: (x, y) => { try { const ll = map.containerPointToLatLng([x, y]); return { lat: ll.lat, lng: ll.lng }; } catch (_) { return null; } },
      viewW: size.x, viewH: size.y, fontPx,
    });
    for (const p of labels) addLabel(map, p.x, p.y, labelHtml(p.text, { uppercase: false, angle: p.angle, fontPx }));
    /* NEW-1 (owner 2026-11-05): a county whose boundary is NOT on screen (the whole view is inside it — the working zoom of a site plan) still names itself, once, near the
     * bottom of the view; "Fort Bend Co." must not vanish just because you zoomed in past its line. */
    const placedTexts = new Set(labels.map((p) => p.text));
    const anchors = viewAnchors(feats, { nameOf: textOf, project: mapPx(map), viewW: size.x, viewH: size.y, bounds: mapBounds(map), band: [0.76, 0.9] }).filter((a) => !placedTexts.has(a.name));
    const taken = labels.map((p) => ({ x: p.x, y: p.y, box: labelBoxPx(p.text, fontPx) }));
    for (const a of placeNames(anchors, { textOf: (x) => x.name, fontPx, viewW: size.x, viewH: size.y, taken })) addLabel(map, a.x, a.y, labelHtml(a.name, { uppercase: false, fontPx }));
  };

  /* NEW-1 (owner 2026-11-05) — city / ETJ names at EVERY zoom, in the part of each polygon that is on screen (placeLabelAnchors.js): the old rule put the name at the polygon's
   * centre and switched it off above zoom 13, so at working zoom nothing named the ground the site stood on. A city's name sits on a pill in its own hue; an ETJ's on a dashed one. */
  const refreshLabels = () => {
    clearLabels();
    if (isCountyLinesId(source.id)) { refreshCountyLabels(); return; }
    if (!map || !lastFc || !source.labelField || !labelsVisible(placeLabelZoom(source), map.getZoom())) return;
    const size = map.getSize(), zoom = map.getZoom(), fontPx = labelFontPx(zoom);
    /* ⛔ ONE LABEL PER CITY — the city-limits layer skips every name the City-names canvas layer is already
     * drawing (see placeNamesGate.js). Filtered BEFORE placement so the names that remain get the freed room. */
    const drawnElsewhere = isCityLimitsId(source.id) ? placeNamesShown(map) : null;
    let anchors = viewAnchors(lastFc.features || [], { nameOf, project: mapPx(map), viewW: size.x, viewH: size.y, bounds: mapBounds(map) });
    if (drawnElsewhere && drawnElsewhere.size) anchors = anchors.filter((a) => !drawnElsewhere.has(placeNameKey(a.name)));
    // NEW-2 — a disputed strip and a release area already carry their full wording; never "… ETJ ETJ".
    const textFor = (name) => (source.id === "jur_etj" ? (/^Undetermined/.test(name) ? "ETJ undetermined (disputed)" : /release area/.test(name) ? name : `${name} ETJ`) : name);
    for (const p of placeNames(anchors, { textOf: (a) => textFor(a.name), fontPx: etjLine ? fontPx * 0.92 : fontPx, viewW: size.x, viewH: size.y })) {
      const pill = placeLine ? (sharedColorBook.colorOf(placeKey(p.name)) || lineColor) : null;
      addLabel(map, p.x, p.y, labelHtml(textFor(p.name), { uppercase: false, fontPx: etjLine ? fontPx * 0.92 : fontPx, pill, dashed: etjLine }));
    }
  };

  /* ⛔ A FREEZE THAT CANNOT BE REPRODUCED HERE MUST CAPTURE ITSELF WHERE IT HAPPENS (STANDING RULE #2). The owner saw
   * the map stall for "several seconds" when a boundary layer redrew after a zoom, at the 5-mile scale; measured in
   * headless Chromium with the new ETJ sources' full volume there was NO main-thread task over 50 ms and no frame
   * gap over 33 ms (`ui-audit/measure-etj-redraw.mjs`). Rather than close that as "not reproducible", a slow paint
   * or a slow load now reports itself through the app's own telemetry with everything needed to attribute it:
   * the layer, the zoom, the feature and vertex counts, and — for the multi-publisher ETJ layer — each publisher's
   * wall time. Throttled to one report per layer per 30 s; never throws into a paint. */
  const SLOW_PAINT_MS = 150, SLOW_LOAD_MS = 3000;
  let lastSlowReport = 0;
  const reportSlow = (kind, ms, fc, extra) => {
    const now = Date.now();
    if (now - lastSlowReport < 30000) return;
    lastSlowReport = now;
    try {
      let coords = 0;
      for (const f of (fc && fc.features) || []) {
        const c = f.geometry && f.geometry.coordinates;
        if (Array.isArray(c)) for (const ring of c) coords += Array.isArray(ring) ? ring.length : 0;
      }
      reportClientEvent(kind, `${cfg.label}: ${Math.round(ms)} ms`, {
        layer: k, ms: Math.round(ms), zoom: map ? map.getZoom() : null,
        features: (fc && fc.features && fc.features.length) || 0, vertices: coords,
        sourceMs: (fc && fc.sourceMs) || null, ...extra,
      });
    } catch (_) { /* telemetry must never break a paint */ }
  };

  const paint = (fc, ts, stale) => {
    const t0 = performance.now();
    geo.clearLayers();
    lastFc = fc || null; // B1092 — kept so a non-Leaflet surface can hit-test what's painted
    const n = (fc && fc.features && fc.features.length) || 0;
    if (placeLine && fc) colorFeatures(fc, nameOf); // every place gets its hue BEFORE it is drawn (a neighbour never shares one)
    if (n) geo.addData(fc);
    refreshLabels();
    const paintMs = performance.now() - t0;
    if (paintMs > SLOW_PAINT_MS) reportSlow("boundary-paint-slow", paintMs, fc, { labels: labelMarkers.length });
    report(n ? "loaded" : "empty", n ? null : "No boundaries in this view.", { ts: ts ?? null, stale: !!stale });
  };

  // A dead vector pull with nothing cached → hand the layer to the previous live
  // esri-leaflet path for the session. Never silent: either the fallback's own
  // status reporting takes over, or we report "failed" loudly.
  const engageFallback = (err) => {
    if (fellBack) return;
    seq++; // invalidate every in-flight vector fetch / pending onFresh swap — nothing may paint over the fallback
    closeIdentify();
    geo.clearLayers(); clearLabels(); lastKey = null;
    if (!buildFallback) {
      report("failed", `${cfg.label}: ${(err && err.message) || "the boundary service is not responding"} (screening only).`);
      return;
    }
    fellBack = true;
    try {
      fallbackLayer = buildFallback();
      if (fallbackLayer) {
        if (fallbackLayer.setOpacity) fallbackLayer.setOpacity(opacity);
        group.addLayer(fallbackLayer);
      }
    } catch (e) {
      report("failed", `${cfg.label}: ${(e && e.message) || "layer failed"} (screening only).`);
    }
  };

  const refresh = async () => {
    if (!map || fellBack) return;
    const zoom = map.getZoom();
    if (cfg.minZoom && zoom < cfg.minZoom) {
      seq++; // a slow in-flight fetch from above the gate must not paint below it
      geo.clearLayers(); clearLabels(); lastKey = null;
      report("empty", `Zoom in to ≥ ${cfg.minZoom} to load`);
      return;
    }
    const b = map.getBounds();
    const bbox = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const areaDeg = Math.abs((bbox.e - bbox.w) * (bbox.n - bbox.s));
    if (decideVectorOrImage(source, { zoom, bboxAreaDeg: areaDeg, lastVectorError }) === "image") { engageFallback(lastVectorError); return; }
    // Same tier + cache cell as last paint → the data can't have changed; only the
    // labels need re-placing for the new viewport.
    const tier = pickTier(source, zoom);
    const eff = tier && tier.scope !== "all" && tier.cellDeg ? snapBbox(bbox, tier.cellDeg) : bbox;
    const key = vectorKey(source, eff, tier);
    if (key === lastKey) { refreshLabels(); return; }
    const mySeq = ++seq;
    const loadT0 = performance.now();
    try {
      const r = await fetchCached(source, bbox, {
        cache, zoom,
        // A stale entry's BACKGROUND refresh landed: swap the new geometry in now
        // (if this view is still the live one), don't wait for the next pan. The
        // `lastKey === key` leg skips the cold-miss first fetch (swr fires onFresh
        // for it too, but the awaited return below paints that one — without this
        // guard every cold load painted twice). A FAILED refresh clears lastKey so
        // the next map move retries instead of trusting "(updating…)" forever.
        onFresh: (fr) => {
          if (mySeq !== seq || !map || fellBack || !fr) return;
          if (fr.updated && lastKey === key) paint(fr.data, fr.ts, false);
          else if (fr.error && lastKey === key) lastKey = null;
        },
      });
      if (mySeq !== seq || !map || fellBack) return;
      lastKey = key;
      lastVectorError = null; // a successful pull heals any earlier blip — never latch into the fallback
      const loadMs = performance.now() - loadT0;
      if (loadMs > SLOW_LOAD_MS && !r.stale) reportSlow("boundary-load-slow", loadMs, r.data, { cold: true });
      paint(r.data, r.ts, r.stale);
    } catch (e) {
      if (mySeq !== seq || !map || fellBack) return; // a superseded request's failure must not poison the live one (or latch lastVectorError)
      lastVectorError = e;
      engageFallback(e);
    }
  };

  group.onAdd = function (m) {
    map = m;
    if (!m.getPane(labelPaneName)) {
      const p = m.createPane(labelPaneName);
      p.style.zIndex = 360; // just above the overlay pane (350), below vectors (400)
      p.style.pointerEvents = "none";
    }
    L.LayerGroup.prototype.onAdd.call(this, m);
    m.on("moveend", refresh);
    if (cfg.mergeGroup === COUNTIES_CITIES_GROUP) {
      if (!boundaryMembers.has(m)) boundaryMembers.set(m, new Map());
      boundaryMembers.get(m).set(source.id, group.identifyAt);
      if (interactive) ensureBoundaryClick(m, identifyOk); // click-only (never hover): a click inside a shape opens the same card
    }
    if (isCityLimitsId(source.id)) m.on("pf:placenames", refreshLabels);   // the canvas layer's names changed → re-place ours
    report("loading");
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    seq++; // invalidate in-flight fetches / onFresh swaps
    closeIdentify(); // the popover must not outlive the layer
    m.off("moveend", refresh);
    if (boundaryMembers.has(m)) { boundaryMembers.get(m).delete(source.id); releaseBoundaryClick(m); }
    if (isCityLimitsId(source.id)) m.off("pf:placenames", refreshLabels);
    L.LayerGroup.prototype.onRemove.call(this, m);
    map = null; lastKey = null;
  };
  group.setOpacity = (o) => {
    opacity = o;
    try { geo.setStyle(baseStyle); } catch (_) {}
    if (fallbackLayer && fallbackLayer.setOpacity) { try { fallbackLayer.setOpacity(o); } catch (_) {} }
  };
  /* (B1092) Identify WITHOUT a Leaflet click. The planner's backdrop map is
   * pointer-events:none — its SVG canvas owns every pointer event — so the click that
   * opens this layer's popover on the map finder can never reach Leaflet there. This
   * hands the same answer to any surface that can supply a lat/lng: null when nothing
   * is under the point, or when the layer has fallen back to the raster/live path (no
   * geometry in hand to test, and claiming otherwise would be a guess). */
  group.identifyAt = (at) => identifyPayload(source, lastFc, at, fellBack, (f) => displayName(f), (f) => childFor(geo, f));

  return group;
}

/* The shared shape an identify hands back — one place, so a Leaflet popover and a
 * canvas card describe a feature identically. `titleOf` is the layer's OWN headline
 * rule (a boundary layer's label field vs. a line layer's registry title), so neither
 * borrows the other's wording. Pure given `fc`. */
const nameText = (source, f) => { const raw = f && f.properties && source.labelField ? f.properties[source.labelField] : null; const n = raw == null ? "" : String(raw).trim(); return n && source.titleCaseLabel ? titleCaseName(n) : n; };
function identifyPayload(source, fc, at, disabled, titleOf, childOf = null) {
  if (disabled || !fc) return null;
  const f = hitFeature(fc, at || {});
  if (!f) return null;
  const props = f.properties || {};
  const token = childOf ? makeHighlight(childOf(f)) : null; // the planner outlines this feature while its card is open
  return {
    ...(token ? { highlight: token } : {}),
    sourceId: source.id || null,
    title: titleOf(f),
    name: nameText(source, f), // the plain place name — the combined Counties & Cities card names the place from it (jurisdictionCard.js)
    rows: identifyRows(source, props, { decode: decodeFieldValue, href: identifyHref }),
    note: source.identifyNote || null,
    sourceName: source.sourceName || null,
  };
}

const CORRIDOR_PANE = "pipecorridorpane";

/* Cached-vector PIPELINE overlay (B751) — a view-driven LINE layer that draws the RRC T-4
 * pipeline centerlines as crisp polylines COLORED BY COMMODITY when zoomed in, and swaps to the
 * agency's `/export` raster (imageFallback) when zoomed far out (statewide density is too heavy
 * to draw as vector). Unlike the boundary `cachedVectorLayer`, the vector↔raster choice is
 * RE-EVALUATED on every moveend (`decideVectorOrImage`) — a zoom-reactive switch, not a
 * permanent fallback latch. Rides the same `gisCache` SWR cache + geometry-simplify tiers as
 * FEMA/NWI, and carries a click-identify (operator · commodity · diameter · status).
 *
 * Options:
 *   cache        — injected SWR cache (default: the gisCache singleton)
 *   interactive  — enable click-identify (map finder yes; planner backdrop no)
 *   identifyOk   — live gate read per event: false while a tool owns clicks (B98)
 *   buildRaster  — () => a live esri dynamicMapLayer for the imageFallback (injected by layers.js
 *                  so this module stays esri-free); mounted only in the far-out raster mode. */
export function cachedPipelineLayer(k, cfg, initialOpacity, pane, onStatus, opts = {}) {
  const source = VECTOR_SOURCES[k];
  if (!source) return null;
  const { cache = gisCache, interactive = false, identifyOk = () => true, buildRaster = null } = opts;

  let map = null, opacity = initialOpacity;
  let seq = 0, lastKey = null, mode = null; // 'vector' | 'image'
  let rasterLayer = null, openPopup = null, lastFc = null;
  const report = (state, msg, extra) => onStatus && onStatus(k, state, msg, extra);

  const group = L.layerGroup([], { pane });

  // Per-feature commodity style (fixed map symbology, hazard-encoded weight/dash) folded with the
  // live layer opacity. styleFor(pipeline) returns Leaflet path keys ({color,weight,dashArray}).
  const styleFeature = (feature) => {
    // NEW-1 — a POINT in a line source (a valve, a marker post, a stream gauge) must get the
    // filled-disc symbology: `fill:false` below is right for a centreline and would render a
    // point as a hollow ring that disappears over aerial imagery.
    if (isPointFeature(feature)) {
      const s = styleFor(source, feature.properties) || {};
      return { ...pointSymbolOptions({ ...cfg, color: s.color || cfg.color, weight: s.weight || cfg.weight }, opacity) };
    }
    const s = styleFor(source, feature && feature.properties) || {};
    return { color: s.color, weight: s.weight, dashArray: s.dashArray || null, opacity, fill: false, fillOpacity: 0 };
  };

  const closeIdentify = () => {
    if (openPopup && map) { try { map.closePopup(openPopup); } catch (_) {} }
    openPopup = null;
  };

  // Identify popover DOM (external attribute values → textContent, never innerHTML): the clean card (identifyCard.js), source behind the (i).
  const identifyEl = (props) => {
    const p = props || {};
    return cardNode({ title: identifyTitle(source, p), rows: identifyRowsFor(source, p), note: source.identifyNote || null, about: source.sourceName ? `Source: ${source.sourceName}` : null });
  };

  const wireFeature = (feature, lyr) => {
    if (!interactive) return;
    lyr.on("click", (e) => {
      if (!identifyOk() || !map) return;
      openPopup = L.popup({ maxWidth: 290, autoPan: false }).setLatLng(e.latlng).setContent(identifyEl(feature.properties)).openOn(map);
      const token = makeHighlight(lyr);
      if (token) { setHighlight(token); openPopup.on("remove", () => releaseHighlight(token)); }
    });
  };

  // NEW-1 — `pointToLayer` is mandatory here for the same reason as in cachedVectorLayer: a
  // point with none gets Leaflet's default marker, whose PNG never resolved under the bundler.
  const geo = L.geoJSON(null, {
    pane, interactive, style: styleFeature, onEachFeature: wireFeature,
    pointToLayer: pointToLayerFor(cfg, opacity, { interactive }),
  });
  group.addLayer(geo);

  const ensureRaster = () => {
    if (rasterLayer || !buildRaster) return rasterLayer;
    try { rasterLayer = buildRaster(); if (rasterLayer && rasterLayer.setOpacity) rasterLayer.setOpacity(opacity); } catch (_) { rasterLayer = null; }
    return rasterLayer;
  };
  const showRaster = () => { const r = ensureRaster(); if (r && !group.hasLayer(r)) group.addLayer(r); return !!r; };
  const hideRaster = () => { if (rasterLayer && group.hasLayer(rasterLayer)) { try { group.removeLayer(rasterLayer); } catch (_) {} } };

  const paintVector = (fc, ts, stale) => {
    geo.clearLayers();
    lastFc = fc || null; // B1092 — hit-testable by a non-Leaflet surface (the planner canvas)
    const n = (fc && fc.features && fc.features.length) || 0;
    if (n) geo.addData(fc);
    // B1078: the empty message is registry-declared, so a hydrography layer says "no mapped
    // watercourse" rather than the pipeline layer's wording.
    report(n ? "loaded" : "empty", n ? null : (source.emptyNote || "No pipelines in this view."), { ts: ts ?? null, stale: !!stale });
  };

  // Show the far-out raster. Report HONESTLY: "loaded" only if the raster actually mounted; if the
  // injected raster couldn't be built (absent/threw) surface a failure rather than a false "loaded".
  const enterImage = (msg, failMsg) => {
    if (mode !== "image") { seq++; mode = "image"; geo.clearLayers(); closeIdentify(); lastKey = null; }
    if (showRaster()) report("loaded", msg || null);
    else report("failed", failMsg || `${cfg.label}: the pipeline layer couldn't load here (screening only).`);
  };

  const refresh = async () => {
    if (!map) return;
    const zoom = map.getZoom();
    const b = map.getBounds();
    const bbox = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const areaDeg = Math.abs((bbox.e - bbox.w) * (bbox.n - bbox.s));
    // Zoom / area alone decide vector-vs-raster — this is a live, RETRYABLE switch, NOT a permanent
    // latch. A transient vector-fetch failure (below) falls to the raster for the current view but is
    // retried on the next moveend, so a one-off RRC blip can't pin the layer to the grainy raster (and
    // kill click-identify) for the session. (Deliberately unlike the boundary layer's `lastVectorError`
    // latch, which is paired with its permanent live-fallback.)
    if (decideVectorOrImage(source, { zoom, bboxAreaDeg: areaDeg }) === "image") { enterImage(); return; }
    if (mode !== "vector") { mode = "vector"; hideRaster(); lastKey = null; }
    const tier = pickTier(source, zoom);
    const eff = tier && tier.scope !== "all" && tier.cellDeg ? snapBbox(bbox, tier.cellDeg) : bbox;
    const key = vectorKey(source, eff, tier);
    if (key === lastKey) return; // same cache cell → data can't have changed
    const mySeq = ++seq;
    try {
      const r = await fetchCached(source, bbox, {
        cache, zoom,
        onFresh: (fr) => {
          if (mySeq !== seq || !map || mode !== "vector" || !fr) return;
          if (fr.updated && lastKey === key) paintVector(fr.data, fr.ts, false);
          else if (fr.error && lastKey === key) lastKey = null;
        },
      });
      if (mySeq !== seq || !map || mode !== "vector") return;
      lastKey = key;
      paintVector(r.data, r.ts, r.stale);
    } catch (e) {
      if (mySeq !== seq || !map || mode !== "vector") return;
      // A vector failure drops to the raster for THIS view (LOUD via status) — never a blank layer.
      // The next moveend re-tries vector (the gate above no longer latches on the error).
      mode = null; // force enterImage to switch panes/report
      enterImage(null, `${cfg.label}: couldn't load the pipeline vector here (screening only).`);
    }
  };

  group.onAdd = function (m) {
    map = m;
    L.LayerGroup.prototype.onAdd.call(this, m);
    m.on("moveend", refresh);
    report("loading");
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    seq++;
    closeIdentify();
    m.off("moveend", refresh);
    L.LayerGroup.prototype.onRemove.call(this, m);
    map = null; lastKey = null; mode = null;
  };
  group.setOpacity = (o) => {
    opacity = o;
    try { geo.setStyle(styleFeature); } catch (_) {}
    if (rasterLayer && rasterLayer.setOpacity) { try { rasterLayer.setOpacity(o); } catch (_) {} }
  };
  // The export gatherer reads this to know which class to composite (vector SVG vs raster image).
  group.getExportMode = () => mode;
  /* (B1092) Identify without a Leaflet click — see cachedVectorLayer.identifyAt. In the
   * far-out RASTER mode there is no geometry in hand, so this honestly answers null
   * rather than guessing from a picture. */
  group.identifyAt = (at) => identifyPayload(source, lastFc, at, mode !== "vector", (f) => identifyTitle(source, f.properties || {}), (f) => childFor(geo, f));
  return group;
}

/* Cached-vector PIPELINE EASEMENT CORRIDOR overlay (B752) — an ASSUMED translucent band a set
 * distance each side of the pipeline centerline, a screening proxy for easement extent (NOT a
 * surveyed width — the caveat lives on the layer note). Shares the B751 pipeline source + cache
 * key so enabling it alongside Pipelines costs no extra network. Bands are tinted to the
 * commodity color and drawn in a lower pane so they sit BENEATH the centerlines. Vector-only:
 * when zoomed out past the pipeline layer's vector gate there's no centerline geometry to buffer,
 * so it reports "zoom in" rather than a meaningless statewide raster. It reads the pipeline geometry
 * through the SAME gisCache key as the B751 layer, so every pan/zoom reuses the cached pull rather
 * than a second network round-trip (only a cold first paint with BOTH layers freshly enabled can
 * race a duplicate fetch, which then converges on the one shared entry).
 *
 * Options: cache (injected SWR cache), widthFt (total corridor width, feet). */
export function cachedCorridorLayer(k, cfg, initialOpacity, pane, onStatus, opts = {}) {
  // Georgia stream buffers are a corridor of a different kind: per-feature widths from three sources, not one
  // assumed width off one source — a sibling builder, same pane / status / export contract.
  if (cfg.bufferRule === "ga_streams") return cachedStreamBufferLayer(k, cfg, initialOpacity, pane, onStatus, opts);
  // Tennessee's construction-permit stream buffers: NHD streams + TDEC's own list of restricted waters — the same shape, a different rule (B2521584).
  if (cfg.bufferRule === "tn_streams") return cachedTnStreamBufferLayer(k, cfg, initialOpacity, pane, onStatus, opts);
  const source = VECTOR_SOURCES[cfg.pipelineSource || "txrrc_pipe"];
  if (!source) return null;
  const { cache = gisCache } = opts;

  let map = null, opacity = initialOpacity, widthFt = opts.widthFt || DEFAULT_CORRIDOR_WIDTH_FT;
  let seq = 0, lastData = null;
  const report = (state, msg, extra) => onStatus && onStatus(k, state, msg, extra);
  const group = L.layerGroup([], { pane });
  const bands = L.layerGroup([]); // the polygon bands live here (their own lower pane)
  group.addLayer(bands);

  // Extract each feature's [lon,lat] centerline parts from a LineString / MultiLineString.
  const featureParts = (feature) => {
    const g = feature && feature.geometry;
    if (!g) return [];
    if (g.type === "MultiLineString") return g.coordinates || [];
    if (g.type === "LineString") return [g.coordinates];
    return [];
  };

  const paint = (fc) => {
    bands.clearLayers();
    let drawn = 0;
    for (const feature of (fc && fc.features) || []) {
      const color = (styleFor(source, feature.properties) || {}).color || "#9a9992";
      for (const part of featureParts(feature)) {
        const ring = corridorRingLngLat(part, widthFt);
        if (!ring || ring.length < 3) continue;
        const latlngs = ring.map(([lon, lat]) => [lat, lon]);
        const poly = L.polygon(latlngs, {
          pane: CORRIDOR_PANE,
          stroke: true, color, weight: 0.5, opacity: Math.min(1, opacity + 0.15),
          fill: true, fillColor: color, fillOpacity: 0.18 * opacity,
          interactive: false,
        });
        bands.addLayer(poly);
        drawn++;
      }
    }
    report(drawn ? "loaded" : "empty", drawn ? null : "No pipelines in this view to buffer.");
  };

  const refresh = async () => {
    if (!map) return;
    const zoom = map.getZoom();
    const b = map.getBounds();
    const bbox = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const areaDeg = Math.abs((bbox.e - bbox.w) * (bbox.n - bbox.s));
    // Vector-only: no centerline vectors zoomed out → nothing to buffer.
    if (decideVectorOrImage(source, { zoom, bboxAreaDeg: areaDeg }) === "image") {
      seq++; bands.clearLayers(); lastData = null;
      report("empty", `Zoom in to about street level to see the assumed corridor.`);
      return;
    }
    const mySeq = ++seq;
    try {
      const r = await fetchCached(source, bbox, {
        cache, zoom,
        onFresh: (fr) => { if (mySeq === seq && map && fr && fr.updated) { lastData = fr.data; paint(fr.data); } },
      });
      if (mySeq !== seq || !map) return;
      lastData = r.data;
      paint(r.data);
    } catch (e) {
      if (mySeq !== seq || !map) return;
      bands.clearLayers();
      report("failed", `${cfg.label}: ${(e && e.message) || "couldn't load the pipeline geometry"} (screening only).`);
    }
  };

  group.onAdd = function (m) {
    map = m;
    if (!m.getPane(CORRIDOR_PANE)) {
      const p = m.createPane(CORRIDOR_PANE);
      p.style.zIndex = 349; // just below the GIS overlay pane (350) → bands sit under the centerlines
    }
    L.LayerGroup.prototype.onAdd.call(this, m);
    m.on("moveend", refresh);
    report("loading");
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    seq++;
    m.off("moveend", refresh);
    L.LayerGroup.prototype.onRemove.call(this, m);
    map = null; lastData = null;
  };
  group.setOpacity = (o) => { opacity = o; if (lastData) paint(lastData); };
  // Inline width control (B752): re-buffer the SAME cached geometry at the new width (no re-fetch).
  group.setWidth = (ft) => { const n = Number(ft); if (Number.isFinite(n) && n > 0 && n !== widthFt) { widthFt = n; if (lastData) paint(lastData); } };
  group.getExportMode = () => "vector";
  return group;
}

/* Georgia STREAM BUFFER bands (Georgia screening, Part B1) — the Leaflet half; every rule (which streams, how
 * wide, where the Metro North Georgia District applies) is `georgiaStreamBuffers.streamBufferBands`, pure and
 * unit-tested. NHD flowlines + DNR trout lines + the District outline all come through `fetchCached` — the same
 * SWR cache entries the drawn "Streams" / "Trout streams" layers use, so enabling the buffer next to them costs
 * no second pull. Bands paint in the corridor pane (just under the GIS overlay pane) in each tier's colour, and
 * the export gatherer reads them exactly as it reads a pipeline corridor (PDF-PARITY: same polygons, same fill).
 *
 * LOUD, never partial-and-silent: a supporting source that fails is NAMED on the row (a missing District outline
 * would otherwise draw 25 ft where the rule is 75), and a truncated NHD pull says it is partial.
 *
 * Vector-only: below the NHD source's vector gate there are no centrelines to buffer, so it reports "zoom in". */
export function cachedStreamBufferLayer(k, cfg, initialOpacity, pane, onStatus, opts = {}) {
  const nhd = VECTOR_SOURCES.nhd_flowlines, trout = VECTOR_SOURCES.ga_trout, district = VECTOR_SOURCES.ga_mngwpd, rivers = VECTOR_SOURCES.ga_protected_rivers, mrpa = VECTOR_SOURCES.ga_mrpa_corridor;
  if (!nhd || !trout || !district || !rivers || !mrpa) return null;
  const { cache = gisCache } = opts;

  let map = null, opacity = initialOpacity, seq = 0;
  const data = { nhd: null, trout: null, district: null, rivers: null, mrpa: null };
  const failed = { nhd: false, trout: false, district: false, rivers: false, mrpa: false };
  const report = (state, msg, extra) => onStatus && onStatus(k, state, msg, extra);
  const group = L.layerGroup([], { pane });
  const bands = L.layerGroup([]);
  group.addLayer(bands);

  const paint = () => {
    bands.clearLayers();
    if (!data.nhd) return;
    const list = streamBufferBands({ nhd: data.nhd, trout: failed.trout ? null : data.trout, district: failed.district ? null : data.district, rivers: failed.rivers ? null : data.rivers, mrpa: failed.mrpa ? null : data.mrpa });
    // Widest first, so a narrower tier laid over a wider one stays legible instead of being buried by it.
    list.sort((a, b) => b.tier.eachSideFt - a.tier.eachSideFt);
    for (const { ring, tier } of list) {
      bands.addLayer(L.polygon(ring.map(([lng, lat]) => [lat, lng]), {
        pane: CORRIDOR_PANE,
        stroke: true, color: tier.color, weight: 0.5, opacity: Math.min(1, opacity + 0.15),
        fill: true, fillColor: tier.color, fillOpacity: 0.18 * opacity,
        interactive: false,
      }));
    }
    const lossNote = streamBufferLossNote(cfg.label, failed);
    if (lossNote) {
      report("failed", lossNote);
    } else if (!list.length) {
      report("empty", "No state-waters streams in this view.");
    } else if (data.nhd.truncated) {
      report("loaded", `Partial — too many streams in this view to buffer them all; zoom in. Showing: ${bufferLegend(list).join(" · ")}.`);
    } else {
      report("loaded", bufferLegend(list).join(" · "));
    }
  };

  const refresh = async () => {
    if (!map) return;
    const zoom = map.getZoom();
    const b = map.getBounds();
    const bbox = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const areaDeg = Math.abs((bbox.e - bbox.w) * (bbox.n - bbox.s));
    if (decideVectorOrImage(nhd, { zoom, bboxAreaDeg: areaDeg }) === "image") {
      seq++; bands.clearLayers(); data.nhd = null;
      report("empty", "Zoom in to about street level to see the stream buffers.");
      return;
    }
    const mySeq = ++seq;
    const pull = (name, source) => fetchCached(source, bbox, {
      cache, zoom,
      onFresh: (fr) => { if (mySeq === seq && map && fr && fr.updated) { data[name] = fr.data; failed[name] = false; paint(); } },
    }).then((r) => { if (mySeq === seq) { data[name] = r.data; failed[name] = false; } })
      .catch((e) => { if (mySeq === seq) { failed[name] = true; reportClientEvent("ga-stream-buffer-source-failed", String((e && e.message) || e), { source: name }); } });
    await Promise.all([pull("nhd", nhd), pull("trout", trout), pull("district", district), pull("rivers", rivers), pull("mrpa", mrpa)]);
    if (mySeq !== seq || !map) return;
    if (failed.nhd) {
      bands.clearLayers();
      report("failed", `${cfg.label}: couldn't load the USGS stream lines here — no buffers are shown (screening only).`);
      return;
    }
    paint();
  };

  group.onAdd = function (m) {
    map = m;
    if (!m.getPane(CORRIDOR_PANE)) {
      const p = m.createPane(CORRIDOR_PANE);
      p.style.zIndex = 349; // just below the GIS overlay pane (350) → bands sit under the stream lines
    }
    L.LayerGroup.prototype.onAdd.call(this, m);
    m.on("moveend", refresh);
    report("loading");
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    seq++;
    m.off("moveend", refresh);
    L.LayerGroup.prototype.onRemove.call(this, m);
    map = null; data.nhd = data.trout = data.district = data.rivers = null;
  };
  group.setOpacity = (o) => { opacity = o; paint(); };
  group.getExportMode = () => "vector";
  return group;
}

/* Tennessee STREAM BUFFER bands (B2521584) — the sibling of the Georgia builder above, with the same pane / status / export contract (the export
 * gatherer reads the polygons exactly as it reads a pipeline corridor — PDF-PARITY). The rule is `tennesseeStreamBuffers.streamBufferBandsTn`, pure
 * and unit-tested: USGS NHD streams at 30 ft each side (the Construction General Permit's average natural riparian buffer). The NHD pull comes
 * through `fetchCached`, the same SWR cache entry the drawn "Streams" layer uses, so turning the buffer on beside it costs no second pull.
 *
 * LOUD, never partial-and-silent: the status line always carries what is NOT drawn (the 60 ft tier on TDEC-listed waters), and a failed NHD pull
 * clears the bands and says so. Vector-only: below the NHD source's vector gate there are no centrelines, so it says "zoom in". */
export function cachedTnStreamBufferLayer(k, cfg, initialOpacity, pane, onStatus, opts = {}) {
  const nhd = VECTOR_SOURCES.nhd_flowlines;
  if (!nhd) return null;
  const { cache = gisCache } = opts;
  const NOT_DRAWN = "The 60 ft tier on TDEC-listed waters is not drawn.";

  let map = null, opacity = initialOpacity, seq = 0, data = null;
  const report = (state, msg, extra) => onStatus && onStatus(k, state, msg, extra);
  const group = L.layerGroup([], { pane });
  const bands = L.layerGroup([]);
  group.addLayer(bands);

  const paint = () => {
    bands.clearLayers();
    if (!data) return;
    const list = streamBufferBandsTn({ nhd: data });
    for (const { ring, tier } of list) {
      bands.addLayer(L.polygon(ring.map(([lng, lat]) => [lat, lng]), {
        pane: CORRIDOR_PANE,
        stroke: true, color: tier.color, weight: 0.5, opacity: Math.min(1, opacity + 0.15),
        fill: true, fillColor: tier.color, fillOpacity: 0.18 * opacity,
        interactive: false,
      }));
    }
    if (!list.length) report("empty", "No streams in this view.");
    else if (data.truncated) report("loaded", `Partial — too many streams in this view to buffer them all; zoom in. ${bufferLegendTn(list).join(" · ")}. ${NOT_DRAWN}`);
    else report("loaded", `${bufferLegendTn(list).join(" · ")}. ${NOT_DRAWN}`);
  };

  const refresh = async () => {
    if (!map) return;
    const zoom = map.getZoom();
    const b = map.getBounds();
    const bbox = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const areaDeg = Math.abs((bbox.e - bbox.w) * (bbox.n - bbox.s));
    if (decideVectorOrImage(nhd, { zoom, bboxAreaDeg: areaDeg }) === "image") {
      seq++; bands.clearLayers(); data = null;
      report("empty", "Zoom in to about street level to see the stream buffers.");
      return;
    }
    const mySeq = ++seq;
    try {
      const r = await fetchCached(nhd, bbox, {
        cache, zoom,
        onFresh: (fr) => { if (mySeq === seq && map && fr && fr.updated) { data = fr.data; paint(); } },
      });
      if (mySeq !== seq || !map) return;
      data = r.data;
      paint();
    } catch (e) {
      if (mySeq !== seq || !map) return;
      bands.clearLayers();
      reportClientEvent("tn-stream-buffer-source-failed", String((e && e.message) || e), { source: "nhd" });
      report("failed", `${cfg.label}: couldn't load the USGS stream lines here — no buffers are shown (screening only).`);
    }
  };

  group.onAdd = function (m) {
    map = m;
    if (!m.getPane(CORRIDOR_PANE)) {
      const p = m.createPane(CORRIDOR_PANE);
      p.style.zIndex = 349; // just below the GIS overlay pane (350) → bands sit under the stream lines
    }
    L.LayerGroup.prototype.onAdd.call(this, m);
    m.on("moveend", refresh);
    report("loading");
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    seq++;
    m.off("moveend", refresh);
    L.LayerGroup.prototype.onRemove.call(this, m);
    map = null; data = null;
  };
  group.setOpacity = (o) => { opacity = o; paint(); };
  group.getExportMode = () => "vector";
  return group;
}
