/* FoodMap — pan/zoom a map, see food places as pins, click one to log a visit.
 *
 * Deliberately simple: one Leaflet map, one canvas-rendered marker layer (canvas, not SVG —
 * the snapshot query can return up to a couple thousand points, and an SVG node per pin is the
 * wrong tool at that count). Pins are colour-coded: logged vs not-yet-logged vs a manual pin,
 * per the brief's "places he has logged render differently from ones he has not."
 *
 * ⛔ BASEMAP (NEW-5, owner report 2026-08-17: "clearly all grouped in a specific section" was
 * NEW-4's bug, but he separately asked for a cleaner map — raw OSM raster is "busy, washed out,
 * and full of highway shields and street labels that mean nothing for finding a restaurant.")
 * Checked the Site Planner's own free basemap registry first (`site-planner/lib/basemaps.js`,
 * Esri + USGS) rather than adding a source of our own — but BOTH are AERIAL PHOTOGRAPHY, the
 * wrong content type for this ask: a satellite photo is busier than a street map, not calmer,
 * and the pins would fight the imagery for attention instead of standing out against it. What
 * the request actually describes — muted, low-contrast, light labels, minimal road furniture —
 * is CARTO's free "Positron" raster tiles (`basemaps.cartocdn.com`), the standard no-key,
 * no-account, no-billing choice for exactly this look; it's OSM data restyled, so attribution
 * still credits OpenStreetMap alongside CARTO, same as the Esri/USGS entries already do for
 * their own sources. BUNDLE ISOLATION note: this is a tile URL, not a package — no new
 * dependency, and nothing here imports from site-planner (see the module's CLAUDE.md pointer).
 *
 * ⛔ CLUSTERING (NEW-5) — at his real pin density a metro-wide view is, in his words, "a solid
 * mass of grey circles." `lib/markerCluster.js` is a small hand-rolled grid clusterer rather
 * than a library: `leaflet.markercluster` is built around DOM `<div>` icons, and pulling it in
 * would undo the exact reason this map renders on canvas. Clusters break apart into individual
 * pins as the user zooms in (finer screen grid ⇒ fewer points share a cell); a cluster keeps
 * the same logged/unlogged/manual colour priority the individual pins use, so a group that
 * contains anywhere he's already been never looks identical to one he hasn't.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { clusterPoints } from "../lib/markerCluster.js";

// Houston, so a first-ever visit opens somewhere useful rather than on the world map.
const DEFAULT_CENTER = [29.76, -95.37];
const DEFAULT_ZOOM = 12;
const MIN_PIN_ZOOM = 12; // below this the snapshot query would ask for a huge box; ask the user to zoom in instead
const CLUSTER_CELL_PX = 56; // screen-pixel grid cell; two pins closer than this share one cluster

// Leaflet's permanent tooltip renders its own plate/border; the cluster count sits directly
// on the coloured circle instead, so this strips that chrome down to bare white text.
const CLUSTER_LABEL_CSS = ".food-cluster-count{background:transparent;border:none;box-shadow:none;color:#fff;font-weight:700;font-size:12px;text-align:center;}.food-cluster-count::before{display:none;}";

// Literal (not theme tokens) DELIBERATELY: these are Leaflet canvas-renderer fill/stroke
// values, not CSS applied to a DOM element — a canvas 2D context has no cascade to resolve
// var(--x) against, so a token here would just paint as the literal string "var(--accent)".
// Same reasoning as the Notes toolbar's content palette (see its header).
const COLORS = {
  unlogged: "#8a8f98",
  logged: "#1D9E75",
  manual: "#E2572B",
};

function boundsOf(map) {
  const b = map.getBounds();
  return { south: b.getSouth(), north: b.getNorth(), west: b.getWest(), east: b.getEast() };
}

export default function FoodMap({
  places, placesCapped, placesTotalMatched, loggedIds, manualPins, overpassPlaces,
  onSelectPlace, onSelectManualPin, pinMode, onDropPin, onViewChanged, onRequestSearchHere,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const redrawRef = useRef(() => {});
  const [tooSmall, setTooSmall] = useState(false);

  // Mount once.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;
    const map = L.map(hostRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19, subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(map);
    layerRef.current = L.layerGroup([], { renderer: L.canvas() }).addTo(map);
    mapRef.current = map;

    const report = () => {
      setTooSmall(map.getZoom() < MIN_PIN_ZOOM);
      onViewChanged?.(boundsOf(map));
      redrawRef.current();
    };
    map.on("moveend", report);
    report();

    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Drop-a-pin mode: next map click reports its lat/lon.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    if (!pinMode) return undefined;
    const onClick = (e) => onDropPin?.(e.latlng.lat, e.latlng.lng);
    map.on("click", onClick);
    return () => map.off("click", onClick);
  }, [pinMode, onDropPin]);

  // Redraw markers whenever the data changes — and keep the latest draw available to the
  // moveend handler above, since screen position (and therefore which pins share a cluster)
  // changes on every pan/zoom even when the underlying data does not.
  useEffect(() => {
    const combined = [
      ...(places || []).map((p) => ({ ...p, kind: loggedIds?.has(p.id) ? "logged" : "unlogged", onClick: () => onSelectPlace?.(p) })),
      ...(overpassPlaces || [])
        .filter((p) => !loggedIds?.has(p.id)) // already shown from the snapshot pass, avoid a double pin
        .map((p) => ({ ...p, kind: "unlogged", onClick: () => onSelectPlace?.(p), titleSuffix: " (live search)" })),
      ...(manualPins || []).map((p) => ({ ...p, kind: "manual", onClick: () => onSelectManualPin?.(p) })),
    ];

    redrawRef.current = () => {
      const map = mapRef.current;
      const layer = layerRef.current;
      if (!map || !layer) return;
      layer.clearLayers();

      const project = (lat, lon) => {
        const pt = map.latLngToContainerPoint([lat, lon]);
        return [pt.x, pt.y];
      };
      const clusters = clusterPoints(combined, project, CLUSTER_CELL_PX);

      for (const c of clusters) {
        if (c.count === 1) {
          const item = c.items[0];
          const m = L.circleMarker([item.lat, item.lon], {
            renderer: layer.options.renderer, radius: 7, weight: 2, color: "#fff", fillColor: COLORS[item.kind], fillOpacity: 0.95,
          });
          m.bindTooltip(`${item.name}${item.titleSuffix || ""}`, { direction: "top", offset: [0, -6] });
          m.on("click", item.onClick);
          m.addTo(layer);
        } else {
          const radius = Math.min(22, 12 + Math.sqrt(c.count) * 2);
          const m = L.circleMarker([c.lat, c.lon], {
            renderer: layer.options.renderer, radius, weight: 2, color: "#fff", fillColor: COLORS[c.kind], fillOpacity: 0.88,
          });
          m.bindTooltip(String(c.count), {
            permanent: true, direction: "center", className: "food-cluster-count", offset: [0, 0],
          });
          m.on("click", () => {
            const bounds = L.latLngBounds(c.items.map((it) => [it.lat, it.lon]));
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
          });
          m.addTo(layer);
        }
      }
    };
    redrawRef.current();
  }, [places, loggedIds, manualPins, overpassPlaces, onSelectPlace, onSelectManualPin]);

  const showCappedNotice = !tooSmall && placesCapped;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <style>{CLUSTER_LABEL_CSS}</style>
      <div ref={hostRef} data-testid="food-map" style={{ position: "absolute", inset: 0 }} />
      {tooSmall && (
        <div style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 500,
          background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}>
          Zoom in to see food places
        </div>
      )}
      {showCappedNotice && (
        <div data-testid="food-capped-notice" style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 500,
          background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}>
          Showing {places.length.toLocaleString()} of {placesTotalMatched.toLocaleString()} here — zoom in for more
        </div>
      )}
      {!tooSmall && onRequestSearchHere && (
        <button
          type="button" onClick={onRequestSearchHere} data-testid="food-search-here"
          style={{
            position: "absolute", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 500,
            border: "1px solid var(--border-default)", borderRadius: 999, background: "var(--surface-raised)",
            color: "var(--text-primary)", font: "inherit", fontSize: 12.5, fontWeight: 700, padding: "7px 16px",
            cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
          }}
        >
          🔍 Search live for more here
        </button>
      )}
    </div>
  );
}
