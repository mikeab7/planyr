/* FoodMap — pan/zoom a map, see food places as pins, click one to log a visit.
 *
 * Deliberately simple: one Leaflet map, one canvas-rendered marker layer (canvas, not SVG —
 * the snapshot query can return up to a couple thousand points, and an SVG node per pin is the
 * wrong tool at that count). Pins are colour-coded: logged vs not-yet-logged vs a manual pin,
 * per the brief's "places he has logged render differently from ones he has not."
 *
 * ⛔ THE ZOOMED-OUT MODEL (owner redesign, 2026-08-18, SUPERSEDING an earlier clustering attempt
 * — read this before adding anything back). The first pass at "the pins are unreadable at low
 * zoom" tried clustering AND spreading the 34,000-place reference snapshot evenly across the
 * viewport at every zoom. The owner rejected the whole model, not the tuning, verbatim: "i dont
 * think the idea is to show all the places at this zoom level, i also dont want to lump things
 * together, the better thing would be to show places that we have rated at a more zoomed out
 * level." So: **no clustering, ever — one pin per point, at every zoom.** And below
 * `MIN_PIN_ZOOM`, the map shows ONLY his own places (`loggedPlaces` + `manualPins`) — the
 * reference snapshot (`places`, from Overture) simply does not draw at all until he zooms in.
 * His own places are the CONTENT of this map; the 34,000-place table is a lookup he reaches
 * into once zoomed to a neighbourhood, never something to sample or spread evenly at metro
 * scale. His own places draw at EVERY zoom, always, and are never hidden or merged into
 * anything — that's the one invariant this file must not break again.
 *
 * ⛔ BASEMAP (NEW-5, revised 2026-08-18 — "i want some color on the map, its too grey"). Positron
 * (the light-grey CARTO style) delivered "muted" so thoroughly it read as a flat wash — water,
 * parks and built-up land all nearly the same tone, no way to orient at a glance. Landed on
 * CARTO's **Voyager** style instead: still the SAME free, key-less service at the SAME domain
 * (`basemaps.cartocdn.com`) and the SAME terms already vetted for Positron (see
 * https://github.com/CartoDB/basemap-styles — `rastertiles/voyager` is one of the documented
 * style values on the identical `{s}.basemaps.cartocdn.com/{style}/{z}/{x}/{y}{scale}.png`
 * endpoint), just a different `style` parameter — genuine cartographic colour (green parks,
 * blue water, warm building fill) with roads/labels still kept quiet. Checked the Site Planner's
 * own free registry again first, as instructed (`site-planner/lib/basemaps.js`, Esri/USGS) —
 * still the wrong content type: aerial PHOTOGRAPHY has no "muted" setting, it's real-world photo
 * detail, and would reintroduce the "too busy" problem in a different shape. A tile URL, not a
 * package — no new dependency.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { colorForRating } from "../lib/ratingColor.js";

// Houston, so a first-ever visit opens somewhere useful rather than on the world map.
const DEFAULT_CENTER = [29.76, -95.37];
const DEFAULT_ZOOM = 12;
const MIN_PIN_ZOOM = 12; // below this, only HIS OWN places draw — the reference snapshot doesn't

// Literal (not theme tokens) DELIBERATELY: these are Leaflet canvas-renderer fill/stroke
// values, not CSS applied to a DOM element — a canvas 2D context has no cascade to resolve
// var(--x) against, so a token here would just paint as the literal string "var(--accent)".
// Same reasoning as the Notes toolbar's content palette (see its header). `logged`/`manual` are
// the FALLBACK for a place he's visited but not yet rated — a RATED place uses colorForRating's
// 1-10 ramp instead (see lib/ratingColor.js), so "the colour means something" rather than being
// decoration (owner redesign, 2026-08-18).
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
  places, placesCapped, placesTotalMatched, loggedPlaces, loggedIds, manualPins, overpassPlaces,
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
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 19, subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
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

  // Redraw markers whenever the data (or the zoomed-in/out threshold) changes. Individual
  // circleMarkers reposition themselves with the map automatically, so — unlike a clustered
  // view — nothing here needs to run again on a plain pan/zoom with unchanged data.
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

    // HIS places — always drawn, at every zoom, never hidden by the threshold below. A RATED
    // place is coloured along the 1-10 ramp so a glance at the map shows where the good ones
    // are; a visited-but-not-yet-rated place falls back to the flat logged/manual colour.
    for (const p of loggedPlaces || []) {
      addPin(p.lat, p.lon, colorForRating(p.avgRating) || COLORS.logged, p.name, () => onSelectPlace?.(p));
    }
    for (const pin of manualPins || []) {
      addPin(pin.lat, pin.lon, colorForRating(pin.avgRating) || COLORS.manual, pin.name, () => onSelectManualPin?.(pin));
    }

    // The 34,000-place reference snapshot — a lookup table he reaches into once zoomed to a
    // neighbourhood, never metro-wide content. loggedIds excludes places already drawn above.
    if (!tooSmall) {
      for (const p of places || []) {
        if (loggedIds?.has(p.id)) continue;
        addPin(p.lat, p.lon, COLORS.unlogged, p.name, () => onSelectPlace?.(p));
      }
      for (const p of overpassPlaces || []) {
        if (loggedIds?.has(p.id)) continue; // already shown from the snapshot pass, avoid a double pin
        addPin(p.lat, p.lon, COLORS.unlogged, `${p.name} (live search)`, () => onSelectPlace?.(p));
      }
    }
  }, [places, loggedPlaces, loggedIds, manualPins, overpassPlaces, tooSmall, onSelectPlace, onSelectManualPin]);

  const showCappedNotice = !tooSmall && placesCapped;
  const hasOwnPlaces = (loggedPlaces?.length || 0) + (manualPins?.length || 0) > 0;

  return (
    <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <div ref={hostRef} data-testid="food-map" style={{ position: "absolute", inset: 0 }} />
      {tooSmall && (
        <div data-testid="food-zoomed-out-notice" style={{
          position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 500,
          background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 999, padding: "6px 14px", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
          textAlign: "center",
        }}>
          {hasOwnPlaces
            ? "Showing only places you've been — zoom in to browse everywhere else"
            : "Zoom in to browse restaurants near you"}
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
