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
 *
 * ⛔ B634981 — THE SATELLITE TOGGLE SHIPPED CRASHING THE WHOLE MODULE, and this is the actual fix
 * (owner, with a live console stack trace, 2026-08-19: clicking Satellite threw
 * "Cannot read properties of undefined (reading 'length')" inside Leaflet's `_getSubdomain`,
 * caught by the workspace error boundary — the entire /food route blanked to an error screen).
 * ROOT CAUSE: the tile-layer options were built as `{ subdomains: source.subdomains, ... }`
 * unconditionally — for SATELLITE_TILES, which declares no `subdomains` key, that evaluates to
 * `subdomains: undefined`, and passing that EXPLICIT `undefined` clobbers Leaflet's own internal
 * default (`'abc'`) rather than leaving it alone. `_getSubdomain` reads
 * `this.options.subdomains.length` UNCONDITIONALLY on every tile request — not gated on whether
 * `{s}` appears in the URL template, contrary to what the URL alone would suggest — so the very
 * first tile threw, synchronously, inside the mount effect. Fix: `subdomains` is only added to the
 * options object AT ALL when the source actually declares one (STREET_TILES's `"abcd"`); Esri gets
 * no key, exactly as the Site Planner's own imagery layer already does it (`MapFinder.jsx` never
 * passes `subdomains` for its Esri layer either — this was the exact bug an explicit-undefined
 * introduces that an omitted key does not).
 * MIRRORED FROM THE PLANNER, PER INSTRUCTION, rather than re-derived: `maxZoom: 21` +
 * `maxNativeZoom: 19` (not a flat `maxZoom: 19`) so Leaflet upscales past Esri's native ceiling
 * instead of just refusing to zoom further; a second, faint LABELS overlay
 * (`Reference/World_Transportation`, opacity 0.4, added ONLY in satellite mode) so street names
 * still read over the photography — satellite imagery with no labels is much harder to navigate.
 * Axis order `{z}/{y}/{x}` (Y before X — Esri's convention, backwards from Leaflet's own default)
 * was already correct here; flagged in case a future edit "corrects" it back to `{z}/{x}/{y}` and
 * silently starts requesting the wrong tiles.
 * GUARDED SO A BAD TILE CONFIG CAN NEVER TAKE THE MODULE DOWN AGAIN: the tile-layer mount is
 * wrapped in try/catch; a thrown error degrades to a small "Imagery unavailable" state instead of
 * propagating into the workspace error boundary.
 *
 * ⛔ SELECTED-PIN HIGHLIGHT + PANEL-AWARE CENTRING (B634976, owner, 2026-08-19, after searching "soto" and
 * opening it: "it's not exactly clear once a spot is selected via map or search that it is
 * selected... give the selected pin its own state"). `selectedKey` (computed once in FoodApp,
 * shared verbatim with VisitList's row highlight and VisitPanel's own key) drives TWO things
 * here: (1) the matching pin draws noticeably larger, with an accent-coloured ring AND a soft
 * halo behind it — never just a bigger version of the same white-stroke look the unrated/rated
 * states already use, so it reads as a genuinely different state at a glance; (2) `flyToTarget`'s
 * pan offsets the destination so the pin lands centred in the area the user can actually SEE, not
 * the raw map element centre — `VisitPanel` covers roughly the right third once a place is
 * selected (`PANEL_WIDTH` below, matching its own literal width), so panning to the raw centre
 * can leave the pin behind the panel or crammed against its edge. Computed via
 * `map.project`/`unproject` (the standard Leaflet pixel-offset-pan pattern): shift the target
 * point right by half the panel's width before flying, so it re-centres left of true-centre by
 * exactly that much — i.e. the middle of the VISIBLE (unobstructed) region. This one flyTo path
 * is shared by search AND by list-driven selection (FoodApp's List `onSelect` now sets
 * `flyToTarget` too), so both get the same corrected centring for free.
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
// Esri World Imagery — mirrors the Site Planner's own layer verbatim (MapFinder.jsx), including
// maxZoom 21 with maxNativeZoom 19 (upscale past Esri's native ceiling rather than hard-refuse),
// and NO `subdomains` key at all — see the B634981 header comment for why an explicit
// `subdomains: undefined` (a single ArcGIS host has none) is what crashed this the first time.
const SATELLITE_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 21, maxNativeZoom: 19,
  attribution: "Imagery &copy; Esri, Maxar",
};
// Faint road/place labels, overlaid ONLY in satellite mode (owner: "a satellite view with no
// street labels is much harder to navigate") — same source + same opacity the planner already
// uses for the identical reason.
const LABELS_TILES = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
  maxZoom: 21, maxNativeZoom: 19, opacity: 0.4,
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

// Matches VisitPanel's own literal width (`position: absolute`, `width: 340`) — the pixel
// amount the panel-aware fly-to offset shifts the pan by. Duplicated as a literal for the same
// canvas/no-cascade reason as COLORS above, and because sharing it would mean importing across
// two components for one number — not worth a new shared-constants module for this module's size.
const PANEL_WIDTH = 340;
// --accent-food, literal for the same canvas reason as COLORS — ties the selected pin's ring
// and halo to the panel's own accent dot (VisitPanel.jsx), "the eye connects them."
const SELECTED_ACCENT = "#BE3B22";

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
  flyToTarget, selectedKey,
}) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const labelsLayerRef = useRef(null);
  const [tooSmall, setTooSmall] = useState(false);
  const [basemap, setBasemap] = useState("street"); // "street" | "satellite"
  const [basemapError, setBasemapError] = useState(false);

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
  //
  // ⛔ B634981 — WRAPPED IN TRY/CATCH ON PURPOSE. A bad tile-layer config (this file's own crash,
  // see the header comment) must degrade to "Imagery unavailable" rather than throwing out of a
  // useEffect and taking the whole module down through the workspace error boundary — a basemap
  // toggle is never worth losing the map, the pins, and every other feature on this route.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const source = basemap === "satellite" ? SATELLITE_TILES : STREET_TILES;
    const layers = [];
    try {
      // `subdomains` is only added to the options object when the source actually declares one —
      // never pass an explicit `subdomains: undefined`, which clobbers Leaflet's own internal
      // default and is exactly what crashed this the first time (see the header comment).
      const opts = { maxZoom: source.maxZoom, attribution: source.attribution };
      if (source.subdomains) opts.subdomains = source.subdomains;
      if (source.maxNativeZoom) opts.maxNativeZoom = source.maxNativeZoom;
      const layer = L.tileLayer(source.url, opts).addTo(map);
      layer.bringToBack(); // stays under the marker layer regardless of add order
      tileLayerRef.current = layer;
      layers.push(layer);

      if (basemap === "satellite") {
        const labelsLayer = L.tileLayer(LABELS_TILES.url, {
          maxZoom: LABELS_TILES.maxZoom, maxNativeZoom: LABELS_TILES.maxNativeZoom, opacity: LABELS_TILES.opacity,
        }).addTo(map);
        labelsLayerRef.current = labelsLayer;
        layers.push(labelsLayer);
      } else {
        labelsLayerRef.current = null;
      }
      setBasemapError(false);
    } catch (err) {
      console.error("FoodMap: basemap tile layer failed to mount", err);
      setBasemapError(true);
    }
    return () => {
      for (const layer of layers) { try { map.removeLayer(layer); } catch (_) { /* already gone */ } }
    };
  }, [basemap]);

  // Search or list result selected — fly to it, offset so it lands centred in the area the user
  // can actually SEE (see header comment: the detail panel covers roughly the right third).
  // Keyed on flyToTarget.nonce (not just lat/lon) so re-selecting the SAME result twice in a row
  // still flies — two identical lat/lon values wouldn't otherwise re-trigger a dependency-array
  // effect.
  //
  // ⛔ B651872 — WHY A HARD RESET FOLLOWS EVERY flyTo (owner report: the map painted flat grey
  // the instant a search result landed, until one manual zoom/pan click). Traced into Leaflet's
  // own source (GridLayer + Map.flyTo), not guessed:
  //   1. `GridLayer._updateLevels()` only computes a zoom level's pixel `origin` the FIRST time
  //      that level is created — never again while the level object survives. `flyTo`'s own
  //      animation frame loop can create the destination zoom's level mid-flight (or reuse one
  //      created long before this flight even started, for a same-zoom hop), baking `origin`
  //      from a not-yet-settled camera position.
  //   2. `GridLayer._onMoveEnd` no-ops entirely while `map._animatingZoom` is true — a flag
  //      `flyTo()` never checks or waits for, unlike `setView`, which calls `_stop()` first.
  //      A zoom gesture (wheel/+−/double-click) still finishing when a search result is picked
  //      can leave that flag set into the flyTo, silently dropping the tile-grid update.
  // Both are races only `flyTo` can hit (a direct pin click never moves the camera; a manual
  // zoom/pan is exactly what "fixes" it live, because `setView`'s non-animated path forces a
  // full `_resetView`). Rather than chase each race individually, force the SAME hard reset a
  // manual interaction gets, once, when the flight settles: `setView(sameCenter, sameZoom,
  // {reset:true})` fires Leaflet's own 'viewprereset' → 'viewreset' pair, which wipes every
  // cached tile level and rebuilds it fresh from the truly-final view — no polling, no interval,
  // one call per selection. `invalidateSize()` alongside it is belt-and-braces for the case the
  // container itself was resized while off-screen (Leaflet never learns of a resize on a hidden
  // element). Verified in an isolated Leaflet harness (real img tileLayer, real async tile
  // loads, long + short hops, concurrent marker redraws) that this never errors, never loops,
  // and doesn't meaningfully change tile request volume — see the session's repro notes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !flyToTarget) return;
    const targetZoom = Math.max(map.getZoom(), FLY_TO_ZOOM);
    // Standard Leaflet pixel-offset-pan pattern: project the target at the destination zoom,
    // shift it RIGHT by half the panel's width, then unproject back — flying to that shifted
    // point puts the ORIGINAL target left-of-true-centre by the same amount, i.e. dead centre of
    // the visible (unobstructed) region. Clamped to 40% of the map's own width so a narrow/phone
    // viewport (where the panel can approach the map's full width) never shifts the target off
    // the visible area entirely in the other direction.
    const containerWidth = map.getSize().x;
    const panelOffsetPx = Math.min(PANEL_WIDTH, containerWidth * 0.8) / 2;
    const targetPoint = map.project([flyToTarget.lat, flyToTarget.lon], targetZoom);
    const shiftedLatLng = map.unproject(targetPoint.add([panelOffsetPx, 0]), targetZoom);
    map.once("moveend", () => {
      map.invalidateSize({ animate: false });
      map.setView(map.getCenter(), map.getZoom(), { reset: true, animate: false });
    });
    map.flyTo(shiftedLatLng, targetZoom);
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
      const isSelected = opts.key != null && opts.key === selectedKey;
      const baseRadius = opts.radius ?? 7;
      // Selected: noticeably larger, an accent-coloured ring (never the plain white every other
      // state uses), PLUS a soft halo behind it — unmistakable at a glance, distinct from both
      // the unrated-neutral and the rated-colour states (owner, 2026-08-19).
      if (isSelected) {
        L.circleMarker([lat, lon], {
          renderer: layer.options.renderer, radius: baseRadius + 12, weight: 0,
          fillColor: SELECTED_ACCENT, fillOpacity: 0.22, interactive: false,
        }).addTo(layer);
      }
      const m = L.circleMarker([lat, lon], {
        renderer: layer.options.renderer,
        radius: isSelected ? baseRadius + 5 : baseRadius,
        weight: isSelected ? 4 : strokeWeight,
        color: isSelected ? SELECTED_ACCENT : "#fff",
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
      addPin(p.lat, p.lon, colorForRating(p.avgRating) || COLORS.logged, p.name, () => onSelectPlace?.(p), { key: `place:${p.id}` });
    }
    for (const pin of manualPins || []) {
      addPin(pin.lat, pin.lon, colorForRating(pin.avgRating) || COLORS.manual, pin.name, () => onSelectManualPin?.(pin), { key: `pin:${pin.name}` });
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
        addPin(p.lat, p.lon, COLORS.unlogged, p.name, () => onSelectPlace?.(p), { ...REFERENCE_PIN, key: `place:${p.id}` });
      }
      for (const p of overpassPlaces || []) {
        if (loggedIds?.has(p.id)) continue; // already shown from the snapshot pass, avoid a double pin
        addPin(p.lat, p.lon, COLORS.unlogged, `${p.name} (live search)`, () => onSelectPlace?.(p), { ...REFERENCE_PIN, key: `place:${p.id}` });
      }
    }
  }, [places, loggedPlaces, loggedIds, manualPins, overpassPlaces, tooSmall, basemap, selectedKey, onSelectPlace, onSelectManualPin]);

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
      {basemapError && (
        <div data-testid="food-basemap-error" role="status" style={{
          position: "absolute", top: 56, right: 12, zIndex: 500,
          background: "var(--surface-raised)", color: "var(--text-secondary)", border: "1px solid var(--border-default)",
          borderRadius: 8, padding: "6px 10px", fontSize: 12, boxShadow: "0 4px 14px rgba(0,0,0,0.18)",
        }}>
          Imagery unavailable
        </div>
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
