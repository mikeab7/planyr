/* The vector-overlay hover/identify ATTACH layer (NEW-2), deliberately off the boot path.
 *
 * WHY THIS IS ITS OWN MODULE. `wireFeatureClick` and `attachFeatureCanvasIdentify` are only ever
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
import L from "leaflet";
import { hoverTitle, featureCard } from "./featureHover.js";
import { cardNode } from "./identifyCard.js";
import { hitFeature } from "./vectorLayers.js";

/* THE ONE card for a clicked feature (B2507062): a row's own `identifyCard(props, at)` when it has one, else its title + labelled rows. Used by the planner canvas
 * (`attachFeatureCanvasIdentify`) and by the Map view's click popup (`wireFeatureClick`), so the two surfaces cannot drift. `about` is the (i) text. */
function itemFor(cfg, props, at, about) {
  if (typeof cfg.identifyCard === "function") {
    const card = cfg.identifyCard(props, at);
    if (card) return { title: card.title || hoverTitle(cfg), rows: card.rows || [], note: card.note || null, sourceName: cfg.source || null, about, ...(card.dedupeKey ? { dedupeKey: card.dedupeKey } : {}) };
  }
  return { ...featureCard(cfg, props), sourceName: cfg.source || null, about };
}

/* Map view: a feature answers a CLICK with a pinned popup — never a hover (owner constraint #43, B2507061). Nothing is bound to mouseover, no tooltip, no hover
 * emphasis; the layer's features stay interactive only so a click lands on them. The popup is the same clean card the planner canvas shows. */
export function wireFeatureClick(lyr, cfg, identifyOk, about = null) {
  const ok = () => (typeof identifyOk === "function" ? identifyOk() : true);
  lyr.on("click", (e) => {
    if (!ok()) return;
    const map = lyr._map || (e.target && e.target._map);
    if (!map) return;
    const feature = e.layer && e.layer.feature;
    const props = (feature && feature.properties) || {};
    const item = itemFor(cfg, props, { lat: e.latlng.lat, lng: e.latlng.lng }, about);
    const node = cardNode(item);
    try { L.popup({ maxWidth: 290, autoPan: false }).setLatLng(e.latlng).setContent(node).openOn(map); } catch (_) { /* a popup never breaks the layer */ }
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
  if (typeof cfg.warm === "function") { try { cfg.warm(); } catch (_) { /* warming a lookup the card needs never breaks the layer */ } } // NEW-1 (DeSoto zoning): start loading what the card will need (the municipal limits)
  lyr.identifyAt = (at) => {
    const features = [];
    try { lyr.eachFeature((child) => { if (child && child.feature) features.push(child.feature); }); } catch (_) { return null; }
    if (!features.length) return null;
    const hit = hitFeature({ type: "FeatureCollection", features }, at);
    if (!hit) return null;
    return itemFor(cfg, hit.properties || {}, at, lyr.__pfAbout || null);
  };
}
