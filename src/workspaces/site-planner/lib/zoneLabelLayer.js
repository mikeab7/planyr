/* The Leaflet half of the zone-code labels (B2573312 NEW-3) — loaded lazily by `layers.buildFeatureLayer` for a row whose `lineLabel.polygon` is set, so it is
 * off the boot bundle. The rules (one label per polygon, centred inside, hidden when too small, never overlapping) live in the pure `zoneLabels.js`; the PDF
 * runs the same layout. This file only turns the layer's features into placement items on each pan / zoom / load and keeps one permanent tooltip per placed
 * label (a pool: a label that stays where it is is left alone). */
import L from "leaflet";
import { lineLabelText } from "./layerRequest.js";
import { labelSpotOf, layoutZoneLabels } from "./zoneLabels.js";

const EARTH_CIRCUMFERENCE_M = 40075016.686;

export function attachZoneLabels(lyr, cfg, { labelPane = null } = {}) {
  const tips = new Map();           // feature key → { tip, text, lat, lng }
  let timer = null, mapOn = null;
  const minZoom = cfg.lineLabel.minZoom ?? 13;

  const clear = () => { for (const t of tips.values()) { try { t.tip.remove(); } catch (_) { /* already gone */ } } tips.clear(); };

  const recompute = () => {
    const map = lyr._map;
    if (!map) { clear(); return; }
    if (map.getZoom() < minZoom) { clear(); return; }
    const size = map.getSize(), b = map.getBounds(), z = map.getZoom();
    const scale = 256 * Math.pow(2, z) / EARTH_CIRCUMFERENCE_M;   // world px per metre at the equator
    const items = [];
    try {
      lyr.eachFeature((l) => {
        const f = l && l.feature;
        if (!f || !f.geometry) return;
        if (l.getBounds && !b.intersects(l.getBounds())) return;
        const text = lineLabelText(cfg, f.properties);
        if (!text) return;
        const spot = labelSpotOf(f.geometry);
        if (!spot) return;
        const p = map.latLngToContainerPoint([spot.lat, spot.lng]);
        items.push({ key: String(f.id != null ? f.id : `${spot.lat},${spot.lng}`), text, x: p.x, y: p.y, spot, pxPerM: scale / Math.cos(spot.lat * Math.PI / 180) });
      });
    } catch (_) { return; }   // a label never breaks the layer
    const placed = layoutZoneLabels(items, { view: { x0: 0, y0: 0, x1: size.x, y1: size.y } });
    const keep = new Set();
    for (const p of placed) {
      keep.add(p.key);
      const it = items.find((i) => i.key === p.key);
      const have = tips.get(p.key);
      if (have && have.text === p.text && have.lat === it.spot.lat && have.lng === it.spot.lng) continue;
      if (have) { try { have.tip.remove(); } catch (_) { /* gone */ } }
      const tip = L.tooltip({ permanent: true, direction: "center", className: "pf-line-label pf-zone-label", interactive: false, opacity: 1, ...(labelPane ? { pane: labelPane } : {}) })
        .setLatLng([it.spot.lat, it.spot.lng]).setContent(p.text);
      tip.addTo(map);
      tips.set(p.key, { tip, text: p.text, lat: it.spot.lat, lng: it.spot.lng });
    }
    for (const [k, t] of tips) if (!keep.has(k)) { try { t.tip.remove(); } catch (_) { /* gone */ } tips.delete(k); }
  };
  const later = (ms = 150) => { clearTimeout(timer); timer = setTimeout(recompute, ms); };

  lyr.on("add", () => { mapOn = lyr._map; if (mapOn) { mapOn.on("moveend", later); mapOn.on("zoomend", later); } later(0); });
  lyr.on("remove", () => { clearTimeout(timer); try { mapOn && mapOn.off("moveend", later); mapOn && mapOn.off("zoomend", later); } catch (_) { /* map already gone */ } mapOn = null; clear(); });
  lyr.on("load", () => later(200));
  lyr.on("createfeature", () => later(400));   // features keep arriving after the first "load"
  lyr.on("removefeature", () => later(400));
  if (lyr._map) later(0);
  return { recompute, clear };
}
