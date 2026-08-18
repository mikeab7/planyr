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
 *
 * ⛔ SATELLITE TOGGLE (B632177, owner, 2026-08-19: "also add an option for a satellite view"). ONE toggle,
 * two states — never a basemap gallery. Reuses the Site Planner's Esri World Imagery source
 * (`site-planner/lib/basemaps.js`'s `esri` entry — free, key-less, no account, no billing,
 * already vetted and already paid for at zero) — the URL/maxZoom/attribution are DUPLICATED
 * here rather than imported, the same reasoning as this module's own `lib/supabaseClient.js`:
 * BUNDLE ISOLATION forbids importing anything under `src/workspaces/site-planner/`, and a
 * shared edge would hoist this module's bytes onto the Site route. Esri over USGS: native to
 * z19 vs USGS's z16, so it stays sharp at the neighbourhood zoom this map already favours.
 * The two tile sources are swapped WHOLE (a fresh `L.tileLayer`, old one removed) rather than
 * `setUrl` on a shared layer — `setUrl` alone doesn't carry a new `maxZoom`/`attribution`,
 * and this way the two can never end up with one's URL and the other's ceiling.
 *
 * PIN LEGIBILITY ON IMAGERY. Satellite backdrops are dark and visually busy — rooftops, shadows,
 * pavement, tree canopy all compete with a small filled circle — where Voyager's pale, quiet
 * palette left plenty of contrast on its own. Every pin already carries a white keyline stroke
 * (the halo that makes the fill colour read against ANY backdrop); satellite mode widens it
 * (2px -> 3px) so the same 1-10 rating ramp stays legible over photo detail instead of just over
 * a street map's calm tones.
 */
import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { colorForRating } from "../lib/ratingColor.js";

const STREET_TILES = {
  url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
  maxZoom: 19, subdomains: "abcd",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
};
const SATELLITE_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 19, // no {s} subdomains — this is a single ArcGIS host, unlike the Voyager tiles
  attribution: "Imagery &copy; Esri, Maxar",
};

// Houston, so a first-ever visit opens somewhere useful rather than on the world map.
const DEFAULT_CENTER = [29.76, -95.37];
const DEFAULT_ZOOM = 12;

// ⛔ MIN_PIN_ZOOM (corrected 2026-08-19, B623728 recurrence — read before nudging this constant again).
// Shipped at 12 first, which is STILL the whole-metro view: measured against a typical
// 1440px-wide browser window centred on Houston, z12 shows ~30 miles across (Katy toward
// Baytown, exactly the view the owner screenshotted and rejected twice) and the reference
// snapshot query already returns 13,000-22,000+ matches there — so the "only his own places
// at low zoom" rule NEVER actually engaged at the zoom people look at Houston from by default.
// Below this now-corrected value, only HIS OWN places draw; the reference snapshot doesn't.
//
// Chosen at 15, not nudged — MEASURED against Houston's own density, not guessed:
//   - Ground scale is zoom-level-intrinsic (independent of any one screen's pixel width):
//     at z12, 1 screen px covers ~33 m at this latitude; at z15, ~4 m — z15 is the first
//     zoom where a city block reads as more than a few pixels, the "neighbourhood you could
//     actually drive to and recognise" scale, not "half the metro."
//   - On a 1440px-wide window, z15 shows ~3.7 miles across — comparable to a single named
//     Houston neighbourhood (the Heights, Montrose), not several stitched together (z14, the
//     next step down, is already ~7.4 miles — multiple neighbourhoods at once).
//   - THE STRONGEST reason: at z15, even DOWNTOWN/MIDTOWN — the single densest food_places
//     cluster in the whole metro — returns only 1,251 places, comfortably under the RPC's
//     2,000 cap (measured directly against production). At z14 the same box already returns
//     2,641 — OVER the cap. So z15 is the tightest zoom where the reference snapshot is
//     GENUINELY COMPLETE everywhere in the metro, never sampled, not even in the one place
//     dense enough to matter — no proportional-share algorithm needed to be "fair" once
//     nothing is ever left out to begin with.
const MIN_PIN_ZOOM = 15;

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

// Above MIN_PIN_ZOOM so a search result reliably lands somewhere the reference snapshot
// already draws — "arrived at this one restaurant" scale, not just "past the threshold."
const FLY_TO_ZOOM = 16;

export default function FoodMap({
  places, placesCapped, placesTotalMatched, loggedPlaces, loggedIds, manualPins, overpassPlaces,
  onSelectPlace, onSelectManualPin, pinMode, onDropPin, onViewChanged, onRequestSearchHere,
  flyToTarget,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const [tooSmall, setTooSmall] = useState(false);
  const [basemap, setBasemap] = useState("street"); // "street" | "satellite"

  // Mount once. The tile layer itself is NOT created here — see the basemap effect below —
  // so toggling satellite never tears down/recreates the map, the marker layer or its handlers.
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;
    const map = L.map(hostRef.current, { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true });
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

  // Basemap tile layer — swapped whole on toggle (see header comment for why not `setUrl`).
  // React runs this effect's cleanup (removing the PREVIOUS tile layer) before re-running the
  // body on a `basemap` change, so there is never a moment with two tile layers stacked.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const source = basemap === "satellite" ? SATELLITE_TILES : STREET_TILES;
    const layer = L.tileLayer(source.url, {
      maxZoom: source.maxZoom, subdomains: source.subdomains, attribution: source.attribution,
    }).addTo(map);
    layer.bringToBack(); // stays under the marker layer regardless of add order
    tileLayerRef.current = layer;
    return () => map.removeLayer(layer);
  }, [basemap]);

  // Search result selected — fly to it (owner, 2026-08-18: "selecting a result flies the map
  // to it"). Keyed on flyToTarget.nonce (not just lat/lon) so re-selecting the SAME result
  // twice in a row still flies — two identical lat/lon values wouldn't otherwise re-trigger
  // a dependency-array effect.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget) return;
    map.flyTo([flyToTarget.lat, flyToTarget.lon], Math.max(map.getZoom(), FLY_TO_ZOOM));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTarget?.nonce]);

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

    // Wider white keyline on satellite — see the header comment on PIN LEGIBILITY ON IMAGERY.
    const strokeWeight = basemap === "satellite" ? 3 : 2;
    const addPin = (lat, lon, color, title, onClick, opts = {}) => {
      const m = L.circleMarker([lat, lon], {
        renderer: layer.options.renderer, radius: opts.radius ?? 7, weight: strokeWeight, color: "#fff",
        fillColor: color, fillOpacity: opts.fillOpacity ?? 0.95,
      });
      m.bindTooltip(title, { direction: "top", offset: [0, -6] });
      if (onClick) m.on("click", onClick);
      m.addTo(layer);
    };

    // HIS places — always drawn, at every zoom, never hidden by the threshold below, always at
    // full size/opacity: they are the point of the map. A RATED place is coloured along the
    // 1-10 ramp so a glance shows where the good ones are; a visited-but-not-yet-rated place
    // falls back to the flat logged/manual colour.
    for (const p of loggedPlaces || []) {
      addPin(p.lat, p.lon, colorForRating(p.avgRating) || COLORS.logged, p.name, () => onSelectPlace?.(p));
    }
    for (const pin of manualPins || []) {
      addPin(pin.lat, pin.lon, colorForRating(pin.avgRating) || COLORS.manual, pin.name, () => onSelectManualPin?.(pin));
    }

    // The reference snapshot — a lookup table he reaches into once zoomed to a neighbourhood,
    // never metro-wide content. loggedIds excludes places already drawn above. Deliberately
    // SMALLER and more TRANSPARENT than his own places (owner note, 2026-08-18: make sure the
    // unrated pin style isn't itself a flat grey blob at density) — a quieter background layer
    // that still reads as "considered" where it overlaps, rather than a uniform solid mass, and
    // never competes with his own places for attention.
    const REFERENCE_PIN = { radius: 5, fillOpacity: 0.7 };
    if (!tooSmall) {
      for (const p of places || []) {
        if (loggedIds?.has(p.id)) continue;
        addPin(p.lat, p.lon, COLORS.unlogged, p.name, () => onSelectPlace?.(p), REFERENCE_PIN);
      }
      for (const p of overpassPlaces || []) {
        if (loggedIds?.has(p.id)) continue; // already shown from the snapshot pass, avoid a double pin
        addPin(p.lat, p.lon, COLORS.unlogged, `${p.name} (live search)`, () => onSelectPlace?.(p), REFERENCE_PIN);
      }
    }
  }, [places, loggedPlaces, loggedIds, manualPins, overpassPlaces, tooSmall, basemap, onSelectPlace, onSelectManualPin]);

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
      <button
        type="button" onClick={() => setBasemap((b) => (b === "satellite" ? "street" : "satellite"))}
        aria-pressed={basemap === "satellite"} data-testid="food-basemap-toggle"
        title={basemap === "satellite" ? "Switch to street map" : "Switch to satellite view"}
        style={{
          position: "absolute", top: 12, right: 12, zIndex: 500,
          border: "1px solid var(--border-default)", borderRadius: 999, background: "var(--surface-raised)",
          color: "var(--text-primary)", font: "inherit", fontSize: 12.5, fontWeight: 700, padding: "7px 14px",
          cursor: "pointer", boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}
      >
        {basemap === "satellite" ? "🗺 Street" : "🛰 Satellite"}
      </button>
    </div>
  );
}
