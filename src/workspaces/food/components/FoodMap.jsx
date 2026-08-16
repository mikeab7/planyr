/* FoodMap — pan/zoom a map, see food places as pins, click one to log a visit.
 *
 * Deliberately simple: one Leaflet map, one canvas-rendered marker layer (canvas, not SVG —
 * the snapshot query can return up to a couple thousand points, and an SVG node per pin is the
 * wrong tool at that count), OpenStreetMap tiles (free, no key). Pins are colour-coded: logged
 * vs not-yet-logged vs a manual pin, per the brief's "places he has logged render differently
 * from ones he has not."
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Houston, so a first-ever visit opens somewhere useful rather than on the world map.
const DEFAULT_CENTER = [29.76, -95.37];
const DEFAULT_ZOOM = 12;
const MIN_PIN_ZOOM = 12; // below this the snapshot query would ask for a huge box; ask the user to zoom in instead

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
  places, loggedIds, manualPins, overpassPlaces,
  onSelectPlace, onSelectManualPin, pinMode, onDropPin, onViewChanged, onRequestSearchHere,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [tooSmall, setTooSmall] = useState(false);

  // Mount once.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;
    const map = L.map(hostRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true });
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layerRef.current = L.layerGroup([], { renderer: L.canvas() }).addTo(map);
    mapRef.current = map;

    const report = () => {
      setTooSmall(map.getZoom() < MIN_PIN_ZOOM);
      onViewChanged?.(boundsOf(map));
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

  // Redraw markers whenever the data changes.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const addPin = (lat, lon, color, title, onClick) => {
      const m = L.circleMarker([lat, lon], {
        renderer: layer.options.renderer, radius: 7, weight: 2, color: "#fff", fillColor: color, fillOpacity: 0.95,
      });
      m.bindTooltip(title, { direction: "top", offset: [0, -6] });
      if (onClick) m.on("click", onClick);
      m.addTo(layer);
    };

    for (const p of places || []) {
      addPin(p.lat, p.lon, loggedIds?.has(p.id) ? COLORS.logged : COLORS.unlogged, p.name, () => onSelectPlace?.(p));
    }
    for (const p of overpassPlaces || []) {
      if (loggedIds?.has(p.id)) continue; // already shown from the snapshot pass, avoid a double pin
      addPin(p.lat, p.lon, COLORS.unlogged, `${p.name} (live search)`, () => onSelectPlace?.(p));
    }
    for (const pin of manualPins || []) {
      addPin(pin.lat, pin.lon, COLORS.manual, pin.name, () => onSelectManualPin?.(pin));
    }
  }, [places, loggedIds, manualPins, overpassPlaces, onSelectPlace, onSelectManualPin]);

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
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
