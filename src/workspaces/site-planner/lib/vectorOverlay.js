/* Leaflet glue for the cached vector GIS layers (FEMA flood + NWI wetlands).
 *
 * Keeps the heavy logic in the PURE engine (vectorLayers.js — Web-Worker-movable,
 * unit-tested) and holds only the map-bound bits here: a view-driven L.layerGroup
 * that, on each move, decides VECTOR vs flat IMAGE (decideVectorOrImage), then either
 * draws the cached polygons (L.geoJSON styled per zone/type, via the browser-local SWR
 * cache so a revisited view paints instantly + shows its age) OR falls back to the
 * existing esri dynamicMapLayer picture. The fallback fires when the source is
 * image-only, the view is zoomed out / too large, or the data fetch fails (e.g. the
 * /query endpoint blocks cross-origin requests) — so a layer NEVER goes blank.
 *
 * Modeled on evidenceLayers.js `overpassLayer` (same onAdd/moveend/trailing-edge
 * refresh + status-with-age reporting). Screening-only: every tooltip says so and the
 * panel shows the data's age. */
import L from "leaflet";
import * as EL from "esri-leaflet";
import { gisCache } from "./gisCache.js";
import { fetchCached, styleFor, decideVectorOrImage } from "./vectorLayers.js";

const areaDeg = (b) => Math.abs((b.e - b.w) * (b.n - b.s)); // rough bbox area for the zoom/size gate
const bboxKey = (b) => [b.w, b.s, b.e, b.n].map((x) => x.toFixed(3)).join(",");

// Human label for a feature's tooltip (zone/subtype/BFE for FEMA; type/code for NWI).
function labelFor(source, props) {
  const p = props || {};
  if (source.style === "fema") {
    const bfe = p.STATIC_BFE != null && Number(p.STATIC_BFE) > 0 ? ` · BFE ${p.STATIC_BFE}` : "";
    return `Zone ${p.FLD_ZONE || "?"}${p.ZONE_SUBTY ? ` · ${p.ZONE_SUBTY}` : ""}${bfe}`;
  }
  return `${p.WETLAND_TYPE || "Wetland"}${p.ATTRIBUTE ? ` · ${p.ATTRIBUTE}` : ""}`;
}

/* A view-driven cached-vector overlay for one source. `onStatus(state, msg, {ts,stale})`
 * feeds the Layers panel (same channel as the evidence layers). `opts.pane` stacks it
 * with the other GIS overlays; `opts.opacity` is the initial slider value. */
export function vectorOverlay(source, onStatus, { pane, opacity = 0.55 } = {}) {
  const group = L.layerGroup();
  let map = null, op = opacity, busy = false, pending = false;
  let lastKey = null;          // the bbox key currently drawn as vectors (null in image mode)
  let gj = null;               // the live L.geoJSON layer, or null
  let imgLyr = null;           // the dynamicMapLayer fallback, or null
  let lastVectorError = null;  // a prior fetch failure → keep falling back to the picture

  // Per-feature style, scaled by the opacity slider but keeping each zone's RELATIVE
  // fill (floodway darker than minimal-risk X) instead of one flat value (cf. B36b).
  const styleFn = (f) => {
    const s = styleFor(source, f && f.properties);
    return { color: s.color, weight: s.weight, fillColor: s.fillColor, opacity: op, fillOpacity: s.fillOpacity * op };
  };

  const clearVector = () => { if (gj) { group.removeLayer(gj); gj = null; } };
  const clearImage = () => { if (imgLyr) { group.removeLayer(imgLyr); imgLyr = null; } };

  // Draw (or redraw) the cached polygons and report status + data age.
  const paintVector = (fc, ts, stale) => {
    clearImage(); clearVector();
    const feats = (fc && fc.features) || [];
    const o = { style: styleFn, onEachFeature: (feat, lyr) => lyr.bindTooltip(`${labelFor(source, feat.properties)} — screening only`) };
    if (pane) o.pane = pane;
    gj = L.geoJSON(fc || { type: "FeatureCollection", features: [] }, o);
    gj.addTo(group);
    const note = feats.length ? (stale ? "Showing last-good while it refreshes" : source.note) : "No mapped features in view";
    onStatus && onStatus(feats.length ? "loaded" : "empty", note, { ts, stale: !!stale });
  };

  // Fall back to the agency's flat image service (today's behavior). Idempotent.
  const showImage = (note) => {
    clearVector(); lastKey = null;
    if (!imgLyr) {
      const fb = source.imageFallback || {};
      const o = { url: fb.url, opacity: op, f: "image" };
      if (pane) o.pane = pane;
      if (fb.layers) o.layers = fb.layers;
      imgLyr = EL.dynamicMapLayer(o);
      imgLyr.on("requesterror", (e) => onStatus && onStatus("failed", `${source.label}: ${(e && e.message) || "request error"}`));
      imgLyr.addTo(group);
    }
    onStatus && onStatus("loaded", note || source.note || null);
  };

  const refresh = async () => {
    if (!map) return;
    if (busy) { pending = true; return; } // a moveend arrived mid-fetch — serve the latest view after
    const b = map.getBounds();
    const bb = { w: b.getWest(), s: b.getSouth(), e: b.getEast(), n: b.getNorth() };
    const mode = decideVectorOrImage(source, { zoom: map.getZoom(), bboxAreaDeg: areaDeg(bb), lastVectorError });
    if (mode === "image") { showImage(lastVectorError ? `Showing the standard picture — couldn't load the data (${(lastVectorError && lastVectorError.message) || "fetch failed"})` : "Zoom in to load the mapped detail"); return; }
    const key = bboxKey(bb);
    if (key === lastKey && gj) return; // same view, vectors already drawn
    lastKey = key;
    busy = true;
    if (!gj) onStatus && onStatus("loading");
    let res = null;
    try { res = await fetchCached(source, bb, { cache: gisCache }); lastVectorError = null; }
    catch (e) { lastVectorError = e; }
    busy = false;
    if (lastVectorError) showImage(`Showing the standard picture — couldn't load the data (${(lastVectorError && lastVectorError.message) || "fetch failed"})`);
    else paintVector(res.data, res.ts, res.stale);
    if (pending) { pending = false; refresh(); } // trailing-edge refresh for the view that moved mid-fetch
  };

  group.setOpacity = (o) => {
    op = o;
    if (gj) { try { gj.setStyle(styleFn); } catch (_) {} }
    if (imgLyr && imgLyr.setOpacity) { try { imgLyr.setOpacity(o); } catch (_) {} }
  };
  group.onAdd = function (m) { L.LayerGroup.prototype.onAdd.call(this, m); map = m; m.on("moveend", refresh); refresh(); return this; };
  group.onRemove = function (m) { m.off("moveend", refresh); map = null; lastKey = null; pending = false; L.LayerGroup.prototype.onRemove.call(this, m); };
  return group;
}
