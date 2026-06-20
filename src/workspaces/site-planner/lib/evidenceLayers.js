/* Utility-evidence layers — live, view-driven Leaflet layers that fetch from
 * free crowd/agency sources for the current map view. Used by the shared layer
 * system (lib/layers.js) so they appear on BOTH the map finder and the planner.
 *
 *  - OSM Overpass: power lines / minor lines / poles / towers / substations /
 *    fire hydrants. Cached per rounded bbox; transmission vs distribution styled
 *    differently.
 *  - Mapillary: crowdsourced pole / fire-hydrant object detections (needs a free
 *    token — read from env or localStorage, never committed).
 *
 * Both are vector overlays drawn above the imagery; they refresh on map move and
 * only load once zoomed in (these sources are dense). All requests are CORS-ok.
 */
import L from "leaflet";
import { gisCache } from "./gisCache.js";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const MIN_ZOOM = 14;            // OSM power/hydrant data is dense — don't fetch zoomed out
const MLY_MIN_ZOOM = 16;        // Mapillary bbox must be < 0.01° — high zoom only
// Overpass results ride the shared browser-local SWR cache (B75): a view paints its
// last-known-good copy instantly and refreshes in the background, and now SURVIVES a
// reload (the old in-memory Map did not). TTL = how long a copy is "fresh" before a
// background refresh fires; a stale copy is still shown immediately with its age.
const OVERPASS_TTL = 30 * 60 * 1000; // 30 min

const COL = {
  transmission: "#b91c1c", // ≥ power=line
  distribution: "#ea580c", // power=minor_line
  pole: "#f59e0b",
  substation: "#7c3aed",
  hydrant: "#dc2626",
  mly: "#0ea5e9",
};

const bboxKey = (b) => [b.s, b.w, b.n, b.e].map((x) => x.toFixed(3)).join(",");

// ---- OSM Overpass ----
export async function fetchOverpass(bounds, want) {
  const bbox = `${bounds.s},${bounds.w},${bounds.n},${bounds.e}`;
  const p = [];
  if (want.lines) { p.push(`way["power"="line"](${bbox});`); p.push(`way["power"="minor_line"](${bbox});`); }
  if (want.poles) { p.push(`node["power"="pole"](${bbox});`); p.push(`node["power"="tower"](${bbox});`); }
  if (want.substations) { p.push(`way["power"="substation"](${bbox});`); p.push(`node["power"="substation"](${bbox});`); }
  if (want.hydrants) { p.push(`node["emergency"="fire_hydrant"](${bbox});`); }
  const q = `[out:json][timeout:25];(${p.join("")});out geom;`;
  const r = await fetch(OVERPASS_URL, { method: "POST", body: "data=" + encodeURIComponent(q) });
  if (!r.ok) throw new Error(`Overpass HTTP ${r.status}`);
  const j = await r.json();
  return j.elements || [];
}

function renderOverpass(els, group, opacity) {
  const op = opacity ?? 0.9;
  els.forEach((el) => {
    const tags = el.tags || {};
    if (el.type === "way" && el.geometry) {
      const pts = el.geometry.map((g) => [g.lat, g.lon]);
      if (tags.power === "substation") {
        L.polygon(pts, { color: COL.substation, weight: 1.5, opacity: op, fillColor: COL.substation, fillOpacity: op * 0.18 })
          .bindTooltip("Substation (OSM)").addTo(group);
      } else {
        const minor = tags.power === "minor_line";
        L.polyline(pts, { color: minor ? COL.distribution : COL.transmission, weight: minor ? 1.6 : 2.6, opacity: op, dashArray: minor ? "5 4" : null })
          .bindTooltip(`${minor ? "Distribution" : "Transmission"} line (OSM)${tags.voltage ? ` · ${tags.voltage} V` : ""}`).addTo(group);
      }
    } else if (el.type === "node" && el.lat != null) {
      const isHyd = tags.emergency === "fire_hydrant";
      const isSub = tags.power === "substation";
      const isTower = tags.power === "tower";
      const color = isHyd ? COL.hydrant : isSub ? COL.substation : COL.pole;
      L.circleMarker([el.lat, el.lon], { radius: isHyd ? 4 : isTower ? 3.5 : 2.6, color, weight: 1.2, opacity: op, fillColor: color, fillOpacity: op * 0.85 })
        .bindTooltip(isHyd ? "Fire hydrant (OSM)" : isSub ? "Substation (OSM)" : isTower ? "Transmission tower (OSM)" : "Power pole (OSM)").addTo(group);
    }
  });
}

/* A view-driven Overpass overlay. `want` selects feature kinds. `onStatus(state,
 * msg)` reports loading | loaded | empty | failed for the Layers panel. */
export function overpassLayer(want, onStatus) {
  const group = L.layerGroup();
  let map = null, lastKey = null, opacity = 0.9, busy = false, pending = false, lastEls = [];
  // Re-render at the new opacity so each feature keeps its RELATIVE fill (substations
  // faint, nodes solid) instead of being flattened to one uniform fillOpacity (B36b).
  group.setOpacity = (o) => { opacity = o; group.clearLayers(); renderOverpass(lastEls, group, opacity); };
  // Render a result set and report status, carrying the data's age (`ts`) and whether
  // it's a stale/last-good copy so the Layers panel can show "refreshed 3m ago" (B75).
  const paint = (els, ts, opts = {}) => {
    group.clearLayers(); renderOverpass(els, group, opacity); lastEls = els;
    const msg = opts.note || (els.length ? null : "No OSM features in view");
    onStatus && onStatus(els.length ? "loaded" : "empty", msg, { ts, stale: !!opts.stale });
  };
  const refresh = async () => {
    if (!map) return;
    if (busy) { pending = true; return; } // a moveend arrived mid-fetch — serve the latest view after (B56d)
    if (map.getZoom() < MIN_ZOOM) { group.clearLayers(); lastEls = []; lastKey = "zoomed-out"; onStatus && onStatus("empty", `Zoom in to ≥ ${MIN_ZOOM} to load`); return; }
    const b = map.getBounds();
    const bb = { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() };
    const key = "overpass:" + bboxKey(bb) + ":" + JSON.stringify(want);
    if (key === lastKey) return;
    lastKey = key;
    // Stale-while-revalidate (B75): paint the cached copy NOW (its age is shown), then
    // refresh in the background and swap fresh data in when it returns.
    const { cached, stale, fresh } = gisCache.swr(key, () => fetchOverpass(bb, want), { ttl: OVERPASS_TTL });
    if (cached) paint(cached.data, cached.ts, { stale });
    else onStatus && onStatus("loading");
    busy = true;
    const r = await fresh;
    busy = false;
    if (r.updated) paint(r.data, r.ts);
    else if (r.error && !cached) { lastKey = null; onStatus && onStatus("failed", `OSM Overpass: ${(r.error && r.error.message) || "request failed"}`); }
    else if (r.error && cached) paint(cached.data, cached.ts, { stale: true, note: "Showing last-good — refresh failed" }); // keep last-known-good
    if (pending) { pending = false; refresh(); } // trailing-edge refresh for the view that moved during the fetch
  };
  group.onAdd = function (m) { L.LayerGroup.prototype.onAdd.call(this, m); map = m; m.on("moveend", refresh); refresh(); return this; };
  group.onRemove = function (m) { m.off("moveend", refresh); map = null; lastKey = null; pending = false; L.LayerGroup.prototype.onRemove.call(this, m); };
  return group;
}

// ---- Mapillary (crowdsourced detections) ----
export const mapillaryToken = () => {
  try {
    return (import.meta.env && import.meta.env.VITE_MAPILLARY_TOKEN) || localStorage.getItem("planarfit:mapillaryToken") || "";
  } catch (_) { return ""; }
};
// Same-tab pub/sub so both LayerPanel copies (map + planner) reflect a token typed in
// either one, and pick up an externally-set token without a remount (B46).
const _mlySubs = new Set();
export const subscribeMapillaryToken = (cb) => { _mlySubs.add(cb); return () => _mlySubs.delete(cb); };
export const setMapillaryToken = (t) => {
  try { t ? localStorage.setItem("planarfit:mapillaryToken", t) : localStorage.removeItem("planarfit:mapillaryToken"); } catch (_) {}
  _mlySubs.forEach((cb) => { try { cb(mapillaryToken()); } catch (_) {} });
};

async function fetchMapillary(bounds, token) {
  const bbox = `${bounds.w},${bounds.s},${bounds.e},${bounds.n}`;
  const url = `https://graph.mapillary.com/map_features?access_token=${encodeURIComponent(token)}&fields=id,object_value,geometry&bbox=${bbox}&limit=500`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Mapillary HTTP ${r.status}`);
  const j = await r.json();
  return (j.data || []).filter((d) => /pole|fire.?hydrant/i.test(d.object_value || ""));
}

export function mapillaryLayer(onStatus) {
  const group = L.layerGroup();
  let map = null, lastKey = null, opacity = 0.95, busy = false, pending = false;
  group.setOpacity = (o) => { opacity = o; group.eachLayer((l) => l.setStyle && l.setStyle({ opacity: o, fillOpacity: o })); };
  const refresh = async () => {
    if (!map) return;
    if (busy) { pending = true; return; } // a moveend arrived mid-fetch — serve the latest view after (B56d)
    const token = mapillaryToken();
    // No token isn't a failure — it's just unconfigured (NEW-4/B285). Report a quiet
    // "unconfigured" status, not the red "failed", if the token is cleared while on.
    if (!token) { group.clearLayers(); lastKey = "no-token"; onStatus && onStatus("unconfigured", "Not configured — add a free access token to enable this layer."); return; }
    if (map.getZoom() < MLY_MIN_ZOOM) { group.clearLayers(); lastKey = "zoomed-out"; onStatus && onStatus("empty", `Zoom in to ≥ ${MLY_MIN_ZOOM} to load`); return; }
    const b = map.getBounds();
    // clamp to < 0.01° per side (Mapillary bbox limit) around the view centre
    const c = b.getCenter(), h = 0.0045;
    const bb = { s: c.lat - h, n: c.lat + h, w: c.lng - h, e: c.lng + h };
    const key = bboxKey(bb);
    if (key === lastKey) return;
    lastKey = key;
    let feats = null; busy = true; onStatus && onStatus("loading");
    try { feats = await fetchMapillary(bb, token); }
    catch (e) { lastKey = null; onStatus && onStatus("failed", `Mapillary: ${e.message || "request failed"}`); feats = null; }
    finally { busy = false; }
    if (feats === null) { if (pending) { pending = false; refresh(); } return; }
    group.clearLayers();
    onStatus && onStatus(feats.length ? "loaded" : "empty", feats.length ? null : "No detections in view");
    feats.forEach((f) => {
      const g = f.geometry; if (!g || !g.coordinates) return;
      const [lon, lat] = g.coordinates;
      const isHyd = /hydrant/i.test(f.object_value || "");
      L.circleMarker([lat, lon], { radius: 4, color: COL.mly, weight: 1.4, opacity, fillColor: isHyd ? COL.hydrant : COL.mly, fillOpacity: opacity })
        .bindTooltip(`${isHyd ? "Hydrant" : "Pole"} · crowdsourced detection (Mapillary)`).addTo(group);
    });
    if (pending) { pending = false; refresh(); } // trailing-edge refresh for the view that moved during the fetch (B56d)
  };
  group.onAdd = function (m) { L.LayerGroup.prototype.onAdd.call(this, m); map = m; m.on("moveend", refresh); refresh(); return this; };
  group.onRemove = function (m) { m.off("moveend", refresh); map = null; lastKey = null; pending = false; L.LayerGroup.prototype.onRemove.call(this, m); };
  return group;
}
