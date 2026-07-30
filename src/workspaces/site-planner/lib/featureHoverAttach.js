/* The vector-overlay hover/identify ATTACH layer (NEW-2), deliberately off the boot path.
 *
 * WHY THIS IS ITS OWN MODULE. `wireFeatureHover` and `attachFeatureCanvasIdentify` are only ever
 * needed once a hover-capable layer is actually switched ON, and the wording engine they pull in
 * (`featureHover.js`, plus `powerScreen`'s redaction cleaners) is only needed once a cursor is
 * actually over a feature. Left in layers.js they rode the Site route's boot bundle and helped
 * breach two of the ceilings in `ui-audit/perf-bundle-audit.mjs`, whose standing rule is that a
 * feature breaching a budget ships with a matching optimization. This is part of that optimization
 * — the same shape as `terrainLazy.js` (B1095) and the `SiteReviewModal` deferral (B1092).
 *
 * TIMING IS SAFE, and that is the point of attaching at layer-BUILD time rather than at first
 * hover: the import is kicked off the moment the user toggles the layer on, which is many hundreds
 * of milliseconds before a cursor can come to rest on one of its features. Until it lands,
 * `lyr.identifyAt` is simply absent — and `layers.identifyOverlaysAt` already guards on exactly
 * that (`typeof lyr.identifyAt !== "function"`), so a tap in that window declines to answer rather
 * than answering wrongly.
 */
import { hoverText } from "./featureHover.js";
import { hitFeature } from "./vectorLayers.js";
import { pointSymbolOptions } from "./layerRequest.js";

const isPoint = (feature) => {
  const t = feature && feature.geometry && feature.geometry.type;
  return t === "Point" || t === "MultiPoint";
};

/* Bind the hover tooltip + emphasis for an interactive esri featureLayer. The wording comes from
 * featureHover.js so a HIFLD substation reads exactly like the OSM one two rows above it in the
 * Layers panel.
 *
 * A sticky tooltip (following the cursor) rather than a fixed one: transmission lines are long, and
 * a tooltip pinned to a polyline's centroid can land off-screen entirely. */
export function wireFeatureHover(lyr, cfg, identifyOk) {
  const ok = () => (typeof identifyOk === "function" ? identifyOk() : true);
  const restyle = (feature, hovered) => {
    const base = isPoint(feature)
      ? pointSymbolOptions(cfg, cfg.opacity ?? 1)
      : { color: cfg.color || "#b91c1c", weight: cfg.weight || 2 };
    if (!hovered) return base;
    // A point's emphasis is a fatter ring at FULL fill — dropping fillOpacity (right for a
    // boundary's near-invisible hit fill) would make a hovered disc fainter than an unhovered one.
    return { ...base, weight: (cfg.weight || 2) + 1.4, ...(isPoint(feature) ? { fillOpacity: 1 } : {}) };
  };
  lyr.on("mouseover", (e) => {
    if (!ok()) return;
    const feature = e.layer && e.layer.feature;
    const props = (feature && feature.properties) || {};
    try { e.layer.setStyle(restyle(feature, true)); } catch (_) {}
    try { e.layer.bindTooltip(hoverText(cfg, props), { sticky: true, direction: "top" }).openTooltip(); } catch (_) {}
  });
  lyr.on("mouseout", (e) => {
    const feature = e.layer && e.layer.feature;
    try { e.layer.setStyle(restyle(feature, false)); } catch (_) {}
    try { e.layer.unbindTooltip(); } catch (_) {}
  });
}

/* Let the PLANNER canvas ask an esri featureLayer what is under a point.
 *
 * Why it is needed at all: the Leaflet tooltip above can only ever fire on the MAP FINDER. The
 * planner's backdrop map sits inside a pointer-events:none box — its SVG canvas owns every pointer
 * event — so no Leaflet mouseover there will ever run. That is the same wall B1092 hit for the
 * vector boundary layers, and it solved it by having the canvas ask the layer directly through
 * `identifyAt`. So these layers implement the SAME accessor over the SAME pure hit-test, and the
 * planner's existing identify card renders the answer — rather than a second, parallel mechanism.
 *
 * esri-leaflet keeps the fetched GeoJSON on each child layer's `.feature`, so the hit-test runs over
 * what is genuinely PAINTED right now (a zoom-gated layer with nothing drawn honestly answers
 * nothing) with no extra request. */
export function attachFeatureCanvasIdentify(lyr, cfg) {
  lyr.identifyAt = (at) => {
    const features = [];
    try { lyr.eachFeature((child) => { if (child && child.feature) features.push(child.feature); }); } catch (_) { return null; }
    if (!features.length) return null;
    const hit = hitFeature({ type: "FeatureCollection", features }, at);
    if (!hit) return null;
    // The SAME one-line wording the map finder's tooltip shows, so the two surfaces cannot drift and
    // neither restates a fact the other omits. No `rows`: everything worth saying is already in that
    // line, and a second copy below it would be the accumulation PANEL-BREVITY exists to prevent.
    return { title: hoverText(cfg, hit.properties || {}), rows: [], note: null, sourceName: cfg.source || null };
  };
}
