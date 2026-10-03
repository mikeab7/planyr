/* LocationsMapCard — the Dashboard's "Locations" card (NEW-1, owner chat block 2026-09-08):
 * "a new dashboard card that shows where everything is on a map... this card should say what
 * the product is the moment the page loads." Nothing else on the Dashboard is geographic, and
 * geography is the whole argument for Planyr over a spreadsheet — so this is a real interactive
 * map, not a picture.
 *
 * MAP LIBRARY: Leaflet — the same library every other map surface in this app already uses
 * (site-planner/MapFinder.jsx, the food workspace's FoodMap.jsx, SetLocationDialog.jsx). No
 * second mapping library was introduced. This file is its own lazy chunk (Dashboard.jsx
 * React.lazy()-imports it) so Leaflet's real weight never rides the Dashboard's own bundle —
 * the Dashboard is the app's landing page and loads on every session.
 *
 * BASEMAP (SUPERSEDED 2026-09-09, owner correction): satellite imagery, not the quiet grey
 * canvas this card shipped with. That grey basemap was this session's own instruction, deliberate
 * at the time — Michael has since overruled it, so treat it as wrong, not as a preference to
 * preserve. Imports `BASEMAPS.esri` straight from site-planner/lib/basemaps.js (Esri World
 * Imagery, `World_Imagery/MapServer`, the same free/keyless `server.arcgisonline.com` host,
 * native to z19) rather than writing a second literal — this is the exact tile source the Site
 * Planner's own "Aerial" basemap uses, so there is only ever one imagery provider in the app, and
 * a change to that registry (a new source, a ceiling change) reaches this card automatically. No
 * light/dark variant exists for aerial photography, so there is one tile layer, not a pair.
 * (Not independently verified against the live tile host from this sandbox — the egress proxy
 * blocks every external tile host here, the same known gap FoodMap.jsx's own header already
 * flags for its Esri/CARTO sources — flagged honestly rather than claimed proven.)
 *
 * THREE MARKER WEIGHTS (dashboardMapMarkers.js is the pure derivation this file only renders):
 * Active projects are filled accent pins with a soft halo and their name beside them (loudest).
 * Pursuits are hollow-cored accent rings with a lighter label. Comps are small quiet grey dots
 * with no label. Active/Pursuit markers are real DOM (Leaflet divIcons), so they read
 * `var(--accent)` etc. directly and re-theme for free; comps are SVG circleMarkers, whose fill is
 * an Esri/SVG presentation attribute — those don't reliably resolve var(), so they use the JS
 * palette mirror (shared/theme/palette.js) the same way every other Leaflet-painted layer in this
 * app does (see FoodMap.jsx's own header on exactly this point). Every label and every dot now
 * carries a solid `--surface-raised` backing plate/halo (see the SATELLITE-LABEL-LEGIBILITY note
 * on `activeIcon`/`pursuitIcon` below) — real aerial imagery ranges from near-black water to
 * bright new concrete in one frame, so legibility can no longer depend on what's under the pin.
 *
 * FIT-ON-LOAD: the map fits itself to the extent of every plottable point ONCE, at mount, and
 * never re-fits itself afterward (a comps-toggle change never yanks the camera).
 *
 * MISSING LOCATIONS ARE NEVER SILENTLY DROPPED: anything without a usable lat/lon cannot be
 * drawn, so a quiet counted line under the map says how many projects/pursuits are missing one.
 * FIXED 2026-09-09 (owner report — the line "looked like a link... clicking did nothing"): it now
 * calls `onFixLocations`, which the Dashboard wires to a token-stamped intent (same shape as the
 * Comps card's click-through) rather than a bare navigate — landing on the Site Planner's project
 * list is still the closest existing surface (there's no dedicated "missing locations" page), but
 * arriving via the intent now opens the Sites tab and narrows the list to exactly the projects
 * with no location, with a "no location" tag on each and a one-click way back to the full list.
 * See MapFinder.jsx's own `focusMissingLocations` effect.
 *
 * EMPTY STATE: an account with nothing in its open pipeline and no comps recorded shows a short
 * line, never an empty grey map rectangle. A non-empty account where NOTHING has a location yet
 * also skips the (pointless) empty map and leads with the missing-location line instead.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { usePalette } from "../../../shared/theme/ThemeProvider.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { ToggleChip } from "../../../shared/ui/controls.jsx";
import { openPipelineProjects, mapMarkers, missingLocationCount } from "../lib/dashboardMapMarkers.js";
import { displayPointsByGroup } from "../lib/dashboardParcelAnchors.js";
import { fetchParcelsForSites } from "../lib/dashboardParcelFetch.js";
import { resolveLabelVisibility } from "../lib/labelCollide.js";
// SATELLITE-LABEL-LEGIBILITY — the SAME aerial-imagery registry the Site Planner's own "Aerial"
// basemap reads (its own `lib/basemaps.js` header: "the single list of free aerial imagery
// sources, used by BOTH surfaces"). Importing the entry rather than writing a second literal is
// what keeps this card's imagery the same provider as the rest of the app by construction.
import { BASEMAPS } from "../../site-planner/lib/basemaps.js";

const MAX_ZOOM = 19;
const SINGLE_POINT_ZOOM = 13;
const FIT_MAX_ZOOM = 15;
const FIT_PADDING = [26, 26];
// LABEL-COLLIDE (owner report, 2026-09-09 — "Goose Creek and Grand Port print directly on top of
// each other", four more named pairs) — the collide-avoid budget: how much breathing room two
// label boxes must keep before they count as overlapping. Small on purpose (this card is small);
// large enough that near-misses still separate visually rather than just technically not touching.
const LABEL_COLLIDE_PAD_PX = 4;
// Same family the app renders text in everywhere else (src/index.css) — measuring label width in
// a font the browser isn't actually using would just move the mis-measurement into a different bug.
const LABEL_FONT_FAMILY = '"Inter", system-ui, sans-serif';
// SATELLITE-LABEL-LEGIBILITY (owner correction, 2026-09-09 — Michael overruled the quiet grey
// basemap this card shipped with; see the tile source swap below) — the label's own horizontal/
// vertical padding, shared between the divIcon HTML and `labelBoxFor`'s collision math so the two
// can't drift apart the way the marker geometry constants already don't.
const LABEL_PAD_X_PX = 6;
const LABEL_PAD_Y_PX = 2;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// SATELLITE-LABEL-LEGIBILITY — a fixed-black drop shadow, not a theme token: it separates the dot/
// plate from a busy photographic background the same way regardless of the app's light/dark
// setting (the same reasoning MapFinder.jsx's own on-map chips give for staying off theme tokens —
// see that file's "paint directly ON THE AERIAL PHOTOGRAPH" note). No shadow token exists in this
// design system yet; centralized here (never inline in the divIcon HTML below) both so the four
// values can't drift and so the design-drift audit's exemption comment has a real JS line to sit
// on — a template-literal HTML line has nowhere to put one without corrupting the rendered markup.
const DOT_SHADOW = "0 1px 3px rgba(0,0,0,0.45)"; // design-exempt: fixed shadow, must read the same over any imagery/theme
const LABEL_SHADOW_ACTIVE = "0 1px 3px rgba(0,0,0,0.35)"; // design-exempt: fixed shadow, must read the same over any imagery/theme
const PURSUIT_DOT_SHADOW = "0 1px 2px rgba(0,0,0,0.35)"; // design-exempt: fixed shadow, must read the same over any imagery/theme
const LABEL_SHADOW_PURSUIT = "0 1px 2px rgba(0,0,0,0.3)"; // design-exempt: fixed shadow, must read the same over any imagery/theme

// Real DOM (Leaflet divIcons render literal innerHTML into the page), so var(--x) tokens resolve
// and re-theme for free — no palette/redraw dependency, unlike the comp circleMarkers below.
// LABEL-COLLIDE — every label span below carries `dash-map-label-text` so `applyLabelCollisions`
// can find and hide it (display:none) without touching or re-rendering the dot beside it; the dot
// always stays, only the text is ever suppressed, so a hidden label's project is still on the map.
// SATELLITE-LABEL-LEGIBILITY — a blurred text-shadow halo (what this used to be) reads fine over
// the quiet grey basemap it was built for, but real aerial imagery ranges from near-black water to
// bright new concrete in the same frame, and a soft glow can't hold AA contrast against all of it.
// Both labels are now a solid, opaque --surface-raised PLATE (the same "chip over the drawing"
// shape the site-planner canvas already uses for its setback/dimension chips) — it occludes
// whatever is under it completely, so legibility no longer depends on what the imagery shows
// there, and `--text-primary`/`--text-secondary` on `--surface-raised` are already audited AA
// (src/index.css's contrast gate) in both themes. The dot itself gets the same halo treatment: a
// `--surface-raised` ring around the accent color, so the marker separates from the image behind
// it exactly like the plate does for its text.
function activeIcon(name) {
  const label = escapeHtml(name || "");
  return L.divIcon({
    className: "dash-map-marker dash-map-marker--active",
    html: `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
      <span style="position:relative;width:20px;height:20px;flex:none;display:flex;align-items:center;justify-content:center;">
        <span style="position:absolute;inset:0;border-radius:999px;background:var(--surface-raised);opacity:0.55;"></span>
        <span style="position:absolute;inset:0;border-radius:999px;background:var(--accent);opacity:0.24;"></span>
        <span style="position:relative;width:12px;height:12px;border-radius:999px;background:var(--accent);border:2px solid var(--surface-raised);box-shadow:${DOT_SHADOW};"></span>
      </span>
      <span class="dash-map-label-text" style="font-size:12px;font-weight:700;color:var(--text-primary);background:var(--surface-raised);border:1px solid var(--border-default);border-radius:999px;padding:${LABEL_PAD_Y_PX}px ${LABEL_PAD_X_PX}px;box-shadow:${LABEL_SHADOW_ACTIVE};">${label}</span>
    </span>`,
    iconSize: null, iconAnchor: [10, 10],
  });
}
function pursuitIcon(name) {
  const label = escapeHtml(name || "");
  return L.divIcon({
    className: "dash-map-marker dash-map-marker--pursuit",
    html: `<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap;">
      <span style="width:12px;height:12px;flex:none;border-radius:999px;background:var(--surface-raised);border:2px solid var(--accent);box-sizing:border-box;box-shadow:${PURSUIT_DOT_SHADOW};"></span>
      <span class="dash-map-label-text" style="font-size:10.5px;font-weight:500;color:var(--text-secondary);background:var(--surface-raised);border:1px solid var(--border-default);border-radius:999px;padding:${LABEL_PAD_Y_PX}px ${LABEL_PAD_X_PX}px;box-shadow:${LABEL_SHADOW_PURSUIT};">${label}</span>
    </span>`,
    iconSize: null, iconAnchor: [7, 7],
  });
}

// LABEL-COLLIDE — the placement RULE (priority order + greedy overlap resolution) is the pure,
// unit-tested `resolveLabelVisibility` (dashboard/lib/labelCollide.js). Everything here is the
// Leaflet/canvas-dependent glue that rule needs: a screen-space box per marker, and applying its
// verdict back onto the actual DOM.
function measureLabelWidthPx(text, fontWeight, fontSizePx) {
  const ctx = measureLabelWidthPx._ctx || (measureLabelWidthPx._ctx = document.createElement("canvas").getContext("2d"));
  ctx.font = `${fontWeight} ${fontSizePx}px ${LABEL_FONT_FAMILY}`;
  return ctx.measureText(text || "").width;
}
// Mirrors the marker HTML above exactly (dot size, gap, anchor, font) — the one place both the
// paint and the collision math read these numbers from, so they can't drift apart.
function labelBoxFor(map, m) {
  const pt = map.latLngToContainerPoint([m.lat, m.lon]);
  const isActive = m.kind === "active";
  const dotSize = isActive ? 20 : 12;
  const anchor = isActive ? 10 : 7;
  const gap = 6;
  const fontWeight = isActive ? 700 : 500;
  const fontSizePx = isActive ? 12 : 10.5;
  // + the plate's own padding (LABEL_PAD_X/Y) — the rendered chip is wider/taller than the bare
  // text, and skipping that here would let two plates visually touch while this math still called
  // them clear.
  const width = measureLabelWidthPx(m.name, fontWeight, fontSizePx) + 2 * LABEL_PAD_X_PX;
  const height = fontSizePx * 1.35 + 2 * LABEL_PAD_Y_PX;
  const left = pt.x - anchor + dotSize + gap;
  const top = pt.y - height / 2;
  return { left, top, right: left + width, bottom: top + height };
}
function setLabelTextVisible(marker, visible) {
  const el = marker.getElement && marker.getElement();
  const label = el && el.querySelector(".dash-map-label-text");
  if (label) label.style.display = visible ? "" : "none";
}
// `markers` — [{ marker, kind: "active"|"pursuit", lat, lon, name }], any order.
function applyLabelCollisions(map, markers) {
  if (!map || !markers || !markers.length) return;
  const items = markers.map((m, i) => ({ id: i, kind: m.kind, box: labelBoxFor(map, m) }));
  const visible = resolveLabelVisibility(items, LABEL_COLLIDE_PAD_PX);
  markers.forEach((m, i) => setLabelTextVisible(m.marker, visible.has(i)));
}

function LegendDot({ hollow }) {
  return (
    <span style={{
      width: 10, height: 10, borderRadius: RADIUS.pill, flex: "none",
      background: hollow ? "transparent" : "var(--accent)",
      border: hollow ? "2px solid var(--accent)" : "none",
      boxSizing: "border-box",
    }} />
  );
}
function CompDot() {
  return <span style={{ width: 6, height: 6, borderRadius: RADIUS.pill, flex: "none", background: "var(--text-tertiary)" }} />;
}

const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };

export default function LocationsMapCard({ projects, comps, onOpenProject, onFixLocations }) {
  const palette = usePalette();
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);
  const [showComps, setShowComps] = useState(true);
  // LABEL-COLLIDE — the active/pursuit markers currently on the map, in the shape
  // `applyLabelCollisions` needs. A ref (not state): panning/zooming re-derives label visibility
  // via direct DOM toggles, never a re-render, so this only needs to be readable from the
  // zoomend/moveend handlers registered once in the map-creation effect below.
  const labelMarkersRef = useRef([]);

  const openProjects = useMemo(() => openPipelineProjects(projects), [projects]);
  // B-NEW-1 — pins sit inside their parcel, same point as the Site tab map. Parcel shapes are read
  // once per set of plotted plans (never per render/zoom); until they arrive, or for a site with no
  // boundary, a pin stays at its saved origin.
  const [displayPoints, setDisplayPoints] = useState(null);
  const plottedSiteKey = useMemo(
    () => mapMarkers(projects, null).map((m) => m.project.siteId).filter(Boolean).sort().join(","),
    [projects],
  );
  useEffect(() => {
    if (!plottedSiteKey) return undefined;
    let live = true;
    fetchParcelsForSites(plottedSiteKey.split(",")).then((rows) => {
      if (live) setDisplayPoints(displayPointsByGroup(projects, rows));
    }).catch(() => {});
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plottedSiteKey]);
  const allMarkers = useMemo(() => mapMarkers(projects, comps, displayPoints), [projects, comps, displayPoints]);
  const missingCount = useMemo(() => missingLocationCount(projects), [projects]);
  const compsTotal = comps ? comps.length : 0;
  const compsPlotted = useMemo(() => allMarkers.filter((m) => m.kind === "comp").length, [allMarkers]);
  const visibleMarkers = useMemo(
    () => (showComps ? allMarkers : allMarkers.filter((m) => m.kind !== "comp")),
    [allMarkers, showComps],
  );

  const nothingPlaced = openProjects.length === 0 && compsTotal === 0;
  const hasMap = allMarkers.length > 0;

  // Mount the Leaflet map once, only when there is at least one plottable point — never an
  // empty grey rectangle (the JSX below only renders the host div when hasMap is true, so this
  // effect's `allMarkers.length > 0` precondition always holds by the time it can run).
  useEffect(() => {
    if (!hasMap || !hostRef.current || mapRef.current) return undefined;
    const first = allMarkers[0];
    const map = L.map(hostRef.current, {
      center: [first.lat, first.lon], zoom: SINGLE_POINT_ZOOM,
      zoomControl: true, fadeAnimation: false, trackResize: false,
    });
    layerRef.current = L.layerGroup([]).addTo(map);
    mapRef.current = map;

    // Fit to the extent of every plottable point, once, on load — never re-fit later (a comps
    // toggle must not yank the camera).
    if (allMarkers.length > 1) {
      const bounds = L.latLngBounds(allMarkers.map((m) => [m.lat, m.lon]));
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM });
    } else {
      map.setView([first.lat, first.lon], SINGLE_POINT_ZOOM);
    }

    let resizeObserver;
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => { try { map.invalidateSize({ animate: false }); } catch (_) { /* torn down mid-tick */ } });
      resizeObserver.observe(hostRef.current);
    }
    // LABEL-COLLIDE — this card supports real pan/zoom (zoomControl + the default drag/scroll-zoom
    // this L.map(...) call never disables), so a collision decided at the initial fit can go stale
    // the moment the owner moves the map: two labels that overlapped at load may have room once
    // he's zoomed in, and two that didn't can end up touching after a pan. Re-decide after every
    // gesture settles — cheap (DOM toggles only, no re-render) — rather than only once at mount.
    const onViewSettled = () => applyLabelCollisions(map, labelMarkersRef.current);
    map.on("zoomend", onViewSettled);
    map.on("moveend", onViewSettled);
    return () => {
      map.off("zoomend", onViewSettled); map.off("moveend", onViewSettled);
      resizeObserver?.disconnect(); map.remove(); mapRef.current = null; layerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMap]);

  // SATELLITE-LABEL-LEGIBILITY — Esri World Imagery, the same source `BASEMAPS.esri` names for
  // the Site Planner's own "Aerial" basemap. One tile layer only: aerial photography has no
  // light/dark variant, so unlike the old grey-canvas basemap this never needs to swap or
  // re-theme with the app's theme — it stays the same imagery in both.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const src = BASEMAPS.esri;
    const layer = L.tileLayer(src.tiles, { maxZoom: MAX_ZOOM, maxNativeZoom: src.maxNative, attribution: src.attr }).addTo(map);
    return () => { try { map.removeLayer(layer); } catch (_) { /* map already torn down */ } };
  }, [hasMap]);

  // Paint the markers. Comps first (quietest, bottom), pursuits next, active last (loudest, on
  // top) — later-added Leaflet layers paint over earlier ones within a shared pane.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();
    for (const m of visibleMarkers) {
      if (m.kind === "comp") {
        // SATELLITE-LABEL-LEGIBILITY — a thin `--surface-raised` stroke, same halo idea as the
        // active/pursuit dots below: a flat quiet-grey fill with no outline could vanish into
        // similarly grey ground (pavement, a rooftop) on real imagery the way it never could over
        // the old flat basemap.
        L.circleMarker([m.lat, m.lon], {
          radius: 3, weight: 1, color: palette.surfaceRaised, opacity: 0.9,
          fillColor: palette.textTertiary, fillOpacity: 0.85, interactive: false,
        }).addTo(layer);
      }
    }
    // LABEL-COLLIDE — comps carry no label, so only pursuit/active markers feed the collision
    // pass below; each is recorded alongside the same L.Marker instance `applyLabelCollisions`
    // will toggle, so a later zoomend/moveend can act on exactly what's on screen right now.
    const labelMarkers = [];
    for (const m of visibleMarkers) {
      if (m.kind === "pursuit") {
        const marker = L.marker([m.lat, m.lon], { icon: pursuitIcon(m.name) })
          .on("click", () => onOpenProject?.(m.project))
          .addTo(layer);
        labelMarkers.push({ marker, kind: "pursuit", lat: m.lat, lon: m.lon, name: m.name });
      }
    }
    for (const m of visibleMarkers) {
      if (m.kind === "active") {
        const marker = L.marker([m.lat, m.lon], { icon: activeIcon(m.name), zIndexOffset: 1000 })
          .on("click", () => onOpenProject?.(m.project))
          .addTo(layer);
        labelMarkers.push({ marker, kind: "active", lat: m.lat, lon: m.lon, name: m.name });
      }
    }
    labelMarkersRef.current = labelMarkers;
    applyLabelCollisions(map, labelMarkers);
  }, [visibleMarkers, palette, onOpenProject]);

  if (nothingPlaced) {
    return <div style={EMPTY} data-testid="locations-map-empty">Nothing placed yet — add a project or a comp to see it on the map.</div>;
  }

  const missingLine = missingCount > 0 && (
    <div
      role="button" tabIndex={0} data-testid="locations-map-missing"
      onClick={() => onFixLocations?.()}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFixLocations?.(); } }}
      style={{ fontSize: 12, color: "var(--text-secondary)", cursor: "pointer", flex: "none" }}
    >
      {missingCount} {missingCount === 1 ? "project's" : "projects'"} location{missingCount === 1 ? " needs" : "s need"} fixing →
    </div>
  );

  if (!hasMap) {
    // Something is placed, but none of it has a location yet — skip the pointless empty map.
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", justifyContent: "center" }}>
        <div style={EMPTY} data-testid="locations-map-unlocated">Nothing has a location on the map yet.</div>
        {missingLine}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%" }} data-testid="locations-map-card">
      <div
        ref={hostRef}
        data-testid="locations-map-host"
        style={{ flex: 1, minHeight: 120, borderRadius: RADIUS.md, overflow: "hidden", border: "1px solid var(--border-default)" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", flex: "none" }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-secondary)" }}>
          <LegendDot /> Active
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "var(--text-secondary)" }}>
          <LegendDot hollow /> Pursuit
        </span>
        <ToggleChip active={showComps} onClick={() => setShowComps((v) => !v)} style={{ marginLeft: "auto" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <CompDot /> Comps{compsPlotted ? ` · ${compsPlotted}` : ""}
          </span>
        </ToggleChip>
      </div>
      {missingLine}
    </div>
  );
}
