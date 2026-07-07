/* Cached-vector boundary overlay — the Leaflet glue over the pure vector engine
 * (B690/B691). This is the render consumer vectorLayers.js was built for: a
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
import { VECTOR_SOURCES, fetchCached, decideVectorOrImage, pickTier, snapBbox, vectorKey } from "./vectorLayers.js";
import { labelAnchors, placeLabels, labelsVisible, titleCaseName } from "./boundaryLabels.js";

const LABEL_PANE = "boundarylabels";

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Map-cartography label style: white with a dark halo reads on any imagery/theme —
// this is on-map lettering (like the tile providers' own labels), not app chrome,
// so it deliberately does not follow the app theme tokens.
const labelHtml = (text, { uppercase }) =>
  `<span style="position:absolute;transform:translate(-50%,-50%);white-space:nowrap;color:#fff;` +
  `text-shadow:0 0 3px rgba(0,0,0,0.9),0 0 7px rgba(0,0,0,0.55);font:700 11px/1.2 system-ui,sans-serif;` +
  `letter-spacing:0.05em;${uppercase ? "text-transform:uppercase;" : ""}pointer-events:none;">${escapeHtml(text)}</span>`;

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
  const { cache = gisCache, interactive = false, identifyOk = () => true, buildFallback = null } = opts;

  let map = null, opacity = initialOpacity, lastVectorError = null;
  let fellBack = false, fallbackLayer = null, openPopup = null;
  let seq = 0, lastKey = null, anchors = [];
  const labelMarkers = [];
  const report = (state, msg, extra) => onStatus && onStatus(k, state, msg, extra);
  const lineColor = cfg.color || "#374151";
  const baseStyle = () => ({
    color: lineColor, weight: cfg.weight || 2, opacity,
    // fill is the hover/click hit area; at 0.02 it's imperceptible on imagery. The
    // className lets select mode neutralize Leaflet's `.leaflet-interactive
    // {cursor:pointer}` (which would otherwise override the parcel-select cursor
    // across the whole fill — see the .pf-select-mode rule in index.css).
    fill: true, fillColor: lineColor, fillOpacity: interactive ? 0.02 : 0,
    className: "pf-boundary-hit",
  });

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
    lyr.on("mouseover", (e) => {
      if (!identifyOk()) return;
      try { lyr.setStyle({ weight: (cfg.weight || 2) + 1.2, fillOpacity: 0.1 }); } catch (_) {}
      try { lyr.bindTooltip(displayName(feature), { sticky: true, direction: "top" }).openTooltip(e.latlng); } catch (_) {}
    });
    lyr.on("mouseout", () => {
      try { lyr.setStyle(baseStyle()); } catch (_) {}
      try { lyr.unbindTooltip(); } catch (_) {}
    });
    lyr.on("click", (e) => {
      if (!identifyOk() || !map) return;
      // Content built as DOM nodes (names arrive from an external service — never innerHTML them).
      const el = document.createElement("div");
      el.style.cssText = "font-size:12px;line-height:1.45;max-width:250px;";
      const head = document.createElement("div");
      head.style.cssText = "font-weight:700;font-size:12.5px;margin-bottom:3px;";
      head.textContent = displayName(feature);
      const note = document.createElement("div");
      note.style.cssText = "opacity:0.85;";
      note.textContent = source.identifyNote || "";
      const src = document.createElement("div");
      src.style.cssText = "opacity:0.7;font-size:10.5px;margin-top:4px;";
      src.textContent = source.sourceName ? `Source: ${source.sourceName}` : "";
      el.append(head, note, src);
      openPopup = L.popup({ maxWidth: 280, autoPan: false }).setLatLng(e.latlng).setContent(el).openOn(map);
    });
  };
  // Close OUR identify popover (never someone else's) — on toggle-off / fallback the
  // popover must not outlive the boundaries it describes.
  const closeIdentify = () => {
    if (openPopup && map) { try { map.closePopup(openPopup); } catch (_) {} }
    openPopup = null;
  };

  const geo = L.geoJSON(null, { pane, interactive, style: baseStyle, onEachFeature: wireFeature });
  group.addLayer(geo);

  const clearLabels = () => { for (const m of labelMarkers) { try { group.removeLayer(m); } catch (_) {} } labelMarkers.length = 0; };

  // Re-place the zoom-gated name labels for the current view (pure math in
  // boundaryLabels.js; bigger polygons win, collisions drop).
  const refreshLabels = () => {
    clearLabels();
    if (!map || !anchors.length || !labelsVisible(source.labelZoom, map.getZoom())) return;
    const size = map.getSize();
    const placed = placeLabels(anchors, {
      project: (lng, lat) => { try { return map.latLngToContainerPoint([lat, lng]); } catch (_) { return null; } },
      viewW: size.x, viewH: size.y,
    });
    for (const p of placed) {
      const text = source.id === "jur_etj" ? `${p.name} ETJ` : p.name;
      const icon = L.divIcon({ className: "", html: labelHtml(text, { uppercase: source.id === "jur_county" }), iconSize: [0, 0] });
      const mk = L.marker([p.lat, p.lng], { icon, interactive: false, keyboard: false, pane: LABEL_PANE });
      group.addLayer(mk);
      labelMarkers.push(mk);
    }
  };

  const paint = (fc, ts, stale) => {
    geo.clearLayers();
    const n = (fc && fc.features && fc.features.length) || 0;
    if (n) geo.addData(fc);
    anchors = source.labelField && fc ? labelAnchors(fc, { labelField: source.labelField, titleCase: !!source.titleCaseLabel }) : [];
    refreshLabels();
    report(n ? "loaded" : "empty", n ? null : "No boundaries in this view.", { ts: ts ?? null, stale: !!stale });
  };

  // A dead vector pull with nothing cached → hand the layer to the previous live
  // esri-leaflet path for the session. Never silent: either the fallback's own
  // status reporting takes over, or we report "failed" loudly.
  const engageFallback = (err) => {
    if (fellBack) return;
    seq++; // invalidate every in-flight vector fetch / pending onFresh swap — nothing may paint over the fallback
    closeIdentify();
    geo.clearLayers(); clearLabels(); anchors = []; lastKey = null;
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
      geo.clearLayers(); clearLabels(); anchors = []; lastKey = null;
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
      paint(r.data, r.ts, r.stale);
    } catch (e) {
      if (mySeq !== seq || !map || fellBack) return; // a superseded request's failure must not poison the live one (or latch lastVectorError)
      lastVectorError = e;
      engageFallback(e);
    }
  };

  group.onAdd = function (m) {
    map = m;
    if (!m.getPane(LABEL_PANE)) {
      const p = m.createPane(LABEL_PANE);
      p.style.zIndex = 360; // just above the overlay pane (350), below vectors (400)
      p.style.pointerEvents = "none";
    }
    L.LayerGroup.prototype.onAdd.call(this, m);
    m.on("moveend", refresh);
    report("loading");
    refresh();
    return this;
  };
  group.onRemove = function (m) {
    seq++; // invalidate in-flight fetches / onFresh swaps
    closeIdentify(); // the popover must not outlive the layer
    m.off("moveend", refresh);
    L.LayerGroup.prototype.onRemove.call(this, m);
    map = null; lastKey = null;
  };
  group.setOpacity = (o) => {
    opacity = o;
    try { geo.setStyle(baseStyle); } catch (_) {}
    if (fallbackLayer && fallbackLayer.setOpacity) { try { fallbackLayer.setOpacity(o); } catch (_) {} }
  };

  return group;
}
