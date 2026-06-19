import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as EL from "esri-leaflet";
import { COUNTIES_MAP, candidateCountiesForPoint } from "./lib/counties.js";
import { syncOverlayLayers, withTileRetry } from "./lib/layers.js";
import LayerPanel from "./components/LayerPanel.jsx";
import {
  resolveLayerUrl,
  identifyParcelAcross,
  outerRingsLngLat,
  lngLatRingToFeet,
  feetToLatLng,
  aerialPlacement,
  humanizeError,
} from "./lib/arcgis.js";
import { elStyle, elRingFeet, byZ } from "./lib/planStyle.js";
import { STATUSES, STATUS_META, statusOf } from "./lib/siteModel.js";
import { countyAtPoint } from "./lib/jurisdiction.js";

const PAL = {
  panelBg: "#ffffff", panelLine: "#e7e2d6", ink: "#2c2a26",
  accent: "#c2410c", muted: "#8a8473",
  chrome: "#191613", chromeLine: "#2e2a23", chromeInk: "#ece7db", chromeMuted: "#9b9482", ember: "#e8590c",
};

// Free aerial sources (no API key). Both are ArcGIS MapServers that support
// both XYZ tiles (for the map) and `export` (for the planner underlay capture).
const BASEMAPS = {
  esri: {
    label: "Esri",
    tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    export: "https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/export",
    maxNative: 19,
    attr: "Imagery &copy; Esri, Maxar",
  },
  usgs: {
    label: "USGS",
    tiles: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
    export: "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/export",
    maxNative: 16,
    attr: "Imagery &copy; USGS",
  },
};
// Subtle road/place labels overlay (drawn faint over the imagery).
const LABELS_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

// Parcel boundaries are drawn as styleable vector lines (same query path that
// powers click-to-select), not a server image — so they render reliably. They
// load once zoomed in past this level (too many to draw across a whole county).
// Clicking to select works at ANY zoom (it's a point query); this only gates the
// VISIBLE outlines. Kept low enough to outline big rural/industrial tracts from
// further out, while still avoiding drawing a whole dense-urban county at once.
const PARCEL_MINZOOM = 14;
function makeParcelLayer(url) {
  return EL.featureLayer({
    url,
    minZoom: PARCEL_MINZOOM,
    simplifyFactor: 0.5,
    precision: 6,
    fields: ["OBJECTID"],
    interactive: false, // purely visual; clicks go to the map for add/remove
    style: () => ({ color: "#a21caf", weight: 1.3, opacity: 0.95, fillOpacity: 0 }),
  });
}

// Custom cursors so it's obvious you're adding (+) or removing (−) a parcel.
// Just a + / − with a white halo for contrast — no circle around it.
const ADD_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M14 5 L14 23 M5 14 L23 14' stroke='%23c2410c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";
const REMOVE_CURSOR =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='28' height='28'%3E%3Cpath d='M5 14 L23 14' stroke='%23ffffff' stroke-width='5' stroke-linecap='round'/%3E%3Cpath d='M5 14 L23 14' stroke='%23b91c1c' stroke-width='2.5' stroke-linecap='round'/%3E%3C/svg%3E\") 14 14, crosshair";

/* Project-status visual language (B8). TWO redundant cues per state — color AND
 * shape/glyph — so it reads for colorblind users and over a busy aerial:
 *   pursuit  amber,  dashed ring, no glyph (tentative/uncommitted)
 *   active   green,  solid, bold — grabs the eye (the live work)
 *   onhold   slate/indigo (NOT sky-blue, so it survives over blue water), pause ‖
 *   complete gray,   muted, small check ✓ — recedes
 *   dead     hollow gray, dimmest, faint ✕, NO fill — recedes (deliberately not red)
 * `dot` is the swatch color for the legend / list / counts. `dim` recedes a marker. */
const STATUS_STYLE = {
  pursuit:  { dot: "#d97706", fill: "#f59e0b", stroke: "#b45309", glyph: "", dashed: true,  dim: false },
  active:   { dot: "#16a34a", fill: "#16a34a", stroke: "#14532d", glyph: "", dashed: false, dim: false },
  onhold:   { dot: "#475569", fill: "#475569", stroke: "#1e293b", glyph: "pause", dashed: false, dim: false },
  complete: { dot: "#94a3b8", fill: "#94a3b8", stroke: "#64748b", glyph: "check", dashed: false, dim: true },
  dead:     { dot: "#9ca3af", fill: "none",    stroke: "#9ca3af", glyph: "x",     dashed: false, dim: true, hollow: true },
};
const statusStyle = (st) => STATUS_STYLE[st] || STATUS_STYLE.pursuit;
// Compact text glyph per status for the legend / list / menu (the second cue
// alongside color). Pursuit = hollow ring (uncommitted), active = filled dot.
const STATUS_GLYPH = { pursuit: "○", active: "●", onhold: "‖", complete: "✓", dead: "✕" };

/* Building marker (B161). Gabled industrial-building silhouette, status color only — no ring. */
const BUILDING_COLORS = {
  active:   { fill: "#EF9F27", stroke: "#c17c0f", dim: false, dashed: false },
  complete: { fill: "#1D9E75", stroke: "#167a5a", dim: false, dashed: false },
  onhold:   { fill: "#888780", stroke: "#65645e", dim: false, dashed: false },
  pursuit:  { fill: "none",    stroke: "#378ADD", dim: false, dashed: true  },
  dead:     { fill: "#f3f4f6", stroke: "#9ca3af", dim: true,  dashed: false },
};
function buildingPinIcon(status, active) {
  const bc = BUILDING_COLORS[status] || BUILDING_COLORS.pursuit;
  const scale = active ? 1.15 : 1;
  const w = Math.round(28 * scale), h = Math.round(36 * scale);
  const op = bc.dim && !active ? 0.72 : 1;
  let glyph = "";
  if (status === "complete") {
    glyph = `<polyline points="9,18 13,22 20,13" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  } else if (status === "onhold") {
    glyph = `<rect x="11" y="15" width="2.5" height="9" rx="1" fill="rgba(255,255,255,.7)"/><rect x="14.5" y="15" width="2.5" height="9" rx="1" fill="rgba(255,255,255,.7)"/>`;
  }
  const bStroke = bc.dashed
    ? `stroke="${bc.stroke}" stroke-width="1.5" stroke-dasharray="4 2.5"`
    : `stroke="${bc.stroke}" stroke-width="1"`;
  const hasDoors = bc.fill !== "none";
  const shadow = active
    ? "filter:drop-shadow(0 0 6px rgba(232,89,12,.65)) drop-shadow(0 2px 4px rgba(0,0,0,.4));"
    : "filter:drop-shadow(0 2px 6px rgba(0,0,0,.45));";
  const html =
    `<div style="${shadow}opacity:${op}">` +
    `<svg width="${w}" height="${h}" viewBox="0 0 28 36">` +
    `<path d="M14,35 L5,29 L5,15 L14,9 L23,15 L23,29 Z" fill="${bc.fill}" ${bStroke}/>` +
    (hasDoors ? `<rect x="7.5" y="22" width="4" height="7" rx="1" fill="rgba(0,0,0,.22)"/><rect x="16.5" y="22" width="4" height="7" rx="1" fill="rgba(0,0,0,.22)"/>` : "") +
    glyph +
    `</svg></div>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [w, h],
    iconAnchor: [Math.round(w / 2), h],
    tooltipAnchor: [0, -(h - 4)],
  });
}

// Ray-cast point-in-polygon on a [[lat,lng], ...] ring.
function pointInPoly(lat, lng, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i][0], xi = ring[i][1], yj = ring[j][0], xj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

const ADDR_RE = /(situs|site_?addr|prop_?addr|loc_?addr|location|^addr|str_?name|full_?addr|address)/i;
const ID_RE = /(hcad_?num|^acct|account|parcel_?id|prop_?id|^pid$|quick_?ref|geo_?id|^pin$|^gid$|objectid)/i;
const findVal = (attrs, re) => {
  const k = Object.keys(attrs || {}).find((key) => re.test(key) && attrs[key] != null && attrs[key] !== "");
  return k ? String(attrs[k]) : null;
};
const shoelace = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) { const j = (i + 1) % pts.length; a += pts[i].x * pts[j].y - pts[j].x * pts[i].y; }
  return Math.abs(a) / 2;
};

// Build the planner hand-off: all selected parcels in one shared feet frame,
// plus an aerial export covering them.
function computeAssembly(selected, exportBase) {
  if (!selected.length) return null;
  let lonMin = Infinity, lonMax = -Infinity, latMin = Infinity, latMax = -Infinity;
  selected.forEach((s) => s.rings.forEach((r) => r.forEach(([lon, lat]) => {
    lonMin = Math.min(lonMin, lon); lonMax = Math.max(lonMax, lon);
    latMin = Math.min(latMin, lat); latMax = Math.max(latMax, lat);
  })));
  const lon0 = (lonMin + lonMax) / 2, lat0 = (latMin + latMax) / 2;
  // One planner parcel per part, in the shared frame — a multipart parcel (e.g.
  // "TRS 3 & 5") brings in ALL its tracts, not just the biggest (acreage was undercounted before).
  const parcels = selected.flatMap((s) => s.rings.map((r) => ({ points: lngLatRingToFeet(r, lon0, lat0), addr: s.addr || null, acct: s.acct || null, attrs: s.attrs || null })));
  const totalSqft = parcels.reduce((sum, p) => sum + shoelace(p.points), 0);
  // Generous context around the site so you can see access roads / neighbors.
  const padLon = Math.max((lonMax - lonMin) * 0.4, 0.0012);
  const padLat = Math.max((latMax - latMin) * 0.4, 0.001);
  const bbox = { lonMin: lonMin - padLon, lonMax: lonMax + padLon, latMin: latMin - padLat, latMax: latMax + padLat };
  const underlay = { ...aerialPlacement(bbox, lon0, lat0, { exportBase }), opacity: 1, locked: true, fromMap: true };
  return { parcels, underlay, totalAc: totalSqft / 43560, origin: { lat: lat0, lon: lon0 } };
}

// Acreage of a stored site from its planner-feet parcels.
function siteAcres(site) {
  if (!site.parcels?.length) return 0;
  return site.parcels.reduce((s, p) => s + shoelace(p.points), 0) / 43560;
}

export default function MapFinder({ visible, overlays, setOverlays, layerStatus = {}, setLayerStatus, sites = [], activeSiteId, onOpenSite, onDeleteSite, onSetStatus, onUseParcels, onSkip }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const displaysRef = useRef({});    // county -> visible parcel-line layer (all CAD counties)
  const sitesLayerRef = useRef(null); // saved-site footprints
  const pressedRef = useRef(false);        // a pointer is currently down on the map (B64)
  const pendingRebuildRef = useRef(null);  // a saved-site rebuild deferred until pointer-up (B64)
  const onOpenSiteRef = useRef(onOpenSite);
  useEffect(() => { onOpenSiteRef.current = onOpenSite; }, [onOpenSite]);
  const onSetStatusRef = useRef(onSetStatus);
  useEffect(() => { onSetStatusRef.current = onSetStatus; }, [onSetStatus]);
  const hilitesRef = useRef({});     // key -> L.polygon for each selected parcel
  const layerUrlsRef = useRef({});   // county -> resolved queryable layer URL (auto-routing)
  const imageryRef = useRef(null);
  const labelsRef = useRef(null);
  const selectModeRef = useRef(false); // read by the once-bound map handlers
  const selectedRef = useRef([]);
  const draggingRef = useRef(false);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [basemap, setBasemap] = useState("esri");
  const [labels, setLabels] = useState(true);
  const [selectMode, setSelectMode] = useState(false); // off = pan only; on = add/remove parcels
  const [zoom, setZoom] = useState(null);
  // First-run-only map hint (B105): the old persistent "Drag to move" card is now a one-time,
  // dismissible bubble. Remembered in localStorage so it never returns once dismissed.
  const [showMapHint, setShowMapHint] = useState(() => { try { return !localStorage.getItem("planarfit:mapHintDismissed:v1"); } catch (_) { return true; } });
  const dismissMapHint = () => { setShowMapHint(false); try { localStorage.setItem("planarfit:mapHintDismissed:v1", "1"); } catch (_) {} };
  // Sites panel: collapsible (persisted) + per-row hover-reveal of the crosshair/delete actions (B106).
  const [sitesPanelOpen, setSitesPanelOpen] = useState(() => { try { return localStorage.getItem("planarfit:sitesPanelClosed:v1") !== "1"; } catch (_) { return true; } });
  const toggleSitesPanel = () => setSitesPanelOpen((v) => { const n = !v; try { localStorage.setItem("planarfit:sitesPanelClosed:v1", n ? "0" : "1"); } catch (_) {} return n; });
  const [hoverRow, setHoverRow] = useState(null);
  const [viewCounty, setViewCounty] = useState("harris"); // jurisdiction for the Layers panel — follows the map's current area (B13)
  const [confirmDel, setConfirmDel] = useState(null); // site pending delete confirmation
  const [hidden, setHidden] = useState(() => new Set()); // statuses filtered out of the map
  const [statusMenu, setStatusMenu] = useState(null); // {site, x, y} — right-click status picker
  // overlays / setOverlays are app-shared (lifted to App) so toggles reflect on both pages.
  const overlayRefs = useRef({}); // key -> live esri dynamicMapLayer (this map's instances)
  const [selected, setSelected] = useState([]); // [{key, rings:[[ [lon,lat],…] ], latlngsList:[[ [lat,lng],…] ], addr, acct, attrs, county}] — rings = every outer part (multipart-safe)
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const toggleHidden = (st) => setHidden((h) => { const n = new Set(h); n.has(st) ? n.delete(st) : n.add(st); return n; });
  // Apply a status to a site (group), then refresh — closes the right-click menu.
  const setStatus = (siteId, st) => { onSetStatusRef.current && onSetStatusRef.current(siteId, st); setStatusMenu(null); };
  // Pipeline counts by status across all sites (for the legend / counts strip).
  const statusCounts = STATUSES.reduce((m, st) => { m[st] = 0; return m; }, {});
  sites.forEach((s) => { statusCounts[statusOf(s)] = (statusCounts[statusOf(s)] || 0) + 1; });

  const clearHilites = () => {
    const map = mapRef.current;
    Object.values(hilitesRef.current).forEach((p) => map && map.removeLayer(p));
    hilitesRef.current = {};
  };

  /* create the map once */
  useEffect(() => {
    const cfg = COUNTIES_MAP.harris; // default landing view (no pre-picked county)
    const map = L.map(elRef.current, { zoomControl: true, minZoom: 8, maxZoom: 21 }).setView(cfg.center, cfg.zoom);
    mapRef.current = map;
    L.control.scale({ imperial: true, metric: false, position: "bottomright", maxWidth: 130 }).addTo(map); // graphic scale (B96b)
    setZoom(map.getZoom());
    const onClick = (e) => { if (selectModeRef.current) handleClick(e.latlng); };
    const onZoom = () => setZoom(map.getZoom());
    // Resolve the Layers-panel jurisdiction from the map's current area (B13): pick the
    // county whose extent covers the view centre, so utility overlays are right outside
    // Houston too. (candidateCountiesForPoint falls back to all → "harris" when away.)
    const onMove = () => { const c = map.getCenter(); const cand = candidateCountiesForPoint(c.lat, c.lng); if (cand.length) setViewCounty(cand[0]); };
    onMove();
    const onMouseMove = (e) => {
      if (!selectModeRef.current || draggingRef.current) return; // don't fight the grab cursor while panning
      const inside = selectedRef.current.some((s) => (s.latlngsList || []).some((ll) => pointInPoly(e.latlng.lat, e.latlng.lng, ll)));
      map.getContainer().style.cursor = inside ? REMOVE_CURSOR : ADD_CURSOR;
    };
    const onDragStart = () => { draggingRef.current = true; map.getContainer().style.cursor = "grabbing"; };
    const onDragEnd = () => { draggingRef.current = false; map.getContainer().style.cursor = selectModeRef.current ? ADD_CURSOR : ""; };
    map.on("click", onClick);
    map.on("zoomend", onZoom);
    map.on("moveend", onMove);
    map.on("mousemove", onMouseMove);
    map.on("dragstart", onDragStart);
    map.on("dragend", onDragEnd);
    // B64: track whether a pointer is currently pressed on the map, so the saved-site
    // layer is never torn down + rebuilt between a mousedown and mouseup (that destroys
    // the path that received the press and Leaflet swallows the click). On release, run
    // any deferred rebuild a tick later so the pending click dispatches first.
    const containerEl = map.getContainer();
    const onPress = () => { pressedRef.current = true; };
    const onRelease = () => {
      pressedRef.current = false;
      if (pendingRebuildRef.current) { const fn = pendingRebuildRef.current; pendingRebuildRef.current = null; setTimeout(fn, 0); }
    };
    containerEl.addEventListener("pointerdown", onPress);
    containerEl.addEventListener("pointerup", onRelease);
    containerEl.addEventListener("pointercancel", onRelease);
    return () => { map.off("click", onClick); map.off("zoomend", onZoom); map.off("moveend", onMove); map.off("mousemove", onMouseMove); map.off("dragstart", onDragStart); map.off("dragend", onDragEnd); containerEl.removeEventListener("pointerdown", onPress); containerEl.removeEventListener("pointerup", onRelease); containerEl.removeEventListener("pointercancel", onRelease); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fit the map to all LOCATED saved sites (blank-planner sites have no origin). (B96b)
  /* aerial imagery layer (swappable source) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const bm = BASEMAPS[basemap] || BASEMAPS.esri;
    // detectRetina: request 2x-density (one-zoom-higher) tiles on HiDPI displays
    // so imagery is crisp instead of upscaled-and-soft. Keeps the Esri source. (B168)
    const layer = withTileRetry(L.tileLayer(bm.tiles, { maxZoom: 21, maxNativeZoom: bm.maxNative, detectRetina: true, attribution: bm.attr }));
    layer.setZIndex(1);
    layer.addTo(map);
    imageryRef.current = layer;
    return () => { try { map.removeLayer(layer); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  /* faint labels overlay (toggle) — initial opacity set from live zoom (B162) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !labels) return;
    const initOpacity = (map.getZoom() >= 14) ? 0.4 : 0;
    const layer = L.tileLayer(LABELS_TILES, { maxZoom: 21, opacity: initOpacity });
    layer.setZIndex(2);
    layer.addTo(map);
    labelsRef.current = layer;
    return () => { try { map.removeLayer(layer); } catch (_) {} labelsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);

  /* zoom-driven label opacity (B162): hide street labels below zoom 14 */
  useEffect(() => {
    const layer = labelsRef.current;
    if (!layer) return;
    layer.setOpacity(zoom != null && zoom >= 14 ? 0.4 : 0);
  }, [zoom]);

  /* overlay layers (FEMA, NWI, TxRRC, local utilities) — toggle + opacity.
     The add/remove/opacity logic is shared with the planner (one source). The
     pane sits above imagery tiles (200), below the vector pane (400) so parcel
     lines / site plans stay on top. */
  useEffect(() => {
    const sync = () => syncOverlayLayers(mapRef.current, overlays, overlayRefs.current, {
      onStatus: (id, state, msg, extra) => setLayerStatus && setLayerStatus((s) => ({ ...s, [id]: state ? { state, msg, ts: extra?.ts ?? null, stale: extra?.stale ?? false } : null })),
      onError: (cfg, msg) => setErr(`“${cfg.label}” layer failed: ${msg || "service may be down or moved"}.`),
    });
    sync();
    // periodic re-probe so stopped services self-heal when the City/County restart
    const iv = setInterval(sync, 45000);
    return () => clearInterval(iv);
  }, [overlays]); // eslint-disable-line

  /* keep the map sized correctly when shown after being hidden */
  useEffect(() => {
    if (visible && mapRef.current) {
      const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [visible]);

  /* Returning to the map (e.g. after committing parcels and planning) clears any
     committed selection and exits select-parcels mode back to the normal map. */
  useEffect(() => {
    if (visible) { clearHilites(); setSelected([]); setSelectMode(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /* Saved sites on the overview map. Zoomed out: a branded pin per site.
     Zoomed in (>= PLAN_ZOOM): the actual site plan — parcel boundary plus every
     element in its true colors — georeferenced via the site's origin. Clickable
     to open (unless we're in parcel-select mode, where clicks add parcels). */
  const PLAN_ZOOM = 15;
  // Derive the pin-vs-plan switch OUTSIDE the effect so the saved-site layer is
  // only torn down + rebuilt when the threshold is actually crossed — not on every
  // zoom step. A rebuild landing between mousedown and mouseup destroys the path that
  // received the press, so Leaflet emits no `click` and opening the site silently
  // fails; fewer rebuilds = fewer swallowed clicks (B64).
  const showPlans = (zoom ?? 0) >= PLAN_ZOOM;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const build = () => {
    if (!mapRef.current) return; // unmounted while deferred
    if (sitesLayerRef.current) { map.removeLayer(sitesLayerRef.current); sitesLayerRef.current = null; }
    const group = L.layerGroup();
    sites.forEach((site) => {
      if (!site.origin) return; // blank-planner sites have no geo anchor
      const status = statusOf(site);
      if (hidden.has(status)) return; // filtered out by the status toggles
      const { lat, lon } = site.origin;
      const active = site.id === activeSiteId;
      const tip = `${site.site || site.name || "Site"} · ${siteAcres(site).toFixed(1)} ac · ${STATUS_META[status]?.label || status} · click to open`;
      const openSiteNow = () => onOpenSiteRef.current && onOpenSiteRef.current(site.id);
      // Right-click anywhere on a site → status picker at the cursor. (Suppress
      // the browser's native menu via the underlying DOM event.)
      const onCtx = (e) => { if (selectModeRef.current) return; const oe = e.originalEvent; if (oe) { oe.preventDefault(); oe.stopPropagation(); } setStatusMenu({ site, x: (oe && oe.clientX) || 0, y: (oe && oe.clientY) || 0 }); };

      if (showPlans && site.parcels?.length) {
        const sty = statusStyle(status);
        // Boundary ALWAYS carries the project status color; the open site is
        // emphasized with a heavier line (not by recoloring it to ember), so its
        // status stays visible — consistent with the status pin.
        const lineColor = sty.dot;
        const lineWeight = active ? 3.25 : 2.25;
        site.parcels.forEach((p) => {
          if (!p.points?.length) return;
          const poly = L.polygon(p.points.map((pt) => feetToLatLng(pt, lat, lon)), {
            color: lineColor, weight: lineWeight, dashArray: sty.dashed ? "5 4" : "6 5",
            fillColor: lineColor, fillOpacity: 0.05, interactive: !selectMode,
          });
          if (!selectMode) poly.on("click", openSiteNow).on("contextmenu", onCtx).bindTooltip(tip, { direction: "top", sticky: true });
          poly.addTo(group);
        });
        // the plan itself: every element in its real fill/stroke (same resolver
        // as the planner canvas, including per-site default colors + overrides)
        [...(site.els || [])].sort(byZ).forEach((el) => {
          const ring = elRingFeet(el);
          if (!ring || ring.length < 3) return;
          const st = elStyle(el, site.settings);
          const poly = L.polygon(ring.map((pt) => feetToLatLng(pt, lat, lon)), {
            color: st.stroke, weight: 1, fillColor: st.fill,
            fillOpacity: Math.min(0.92, st.fillOpacity ?? 1),
            interactive: !selectMode,
          });
          if (!selectMode) poly.on("click", openSiteNow).on("contextmenu", onCtx).bindTooltip(tip, { direction: "top", sticky: true });
          poly.addTo(group);
        });
      } else {
        // zoomed out: a status-aware map pin at the site origin
        const marker = L.marker([lat, lon], { icon: buildingPinIcon(status, active), interactive: !selectMode, keyboard: false });
        if (!selectMode) marker.on("click", openSiteNow).on("contextmenu", onCtx).bindTooltip(tip, { direction: "top" });
        marker.addTo(group);
      }
    });
    group.addTo(map);
    sitesLayerRef.current = group;
    };
    // Defer the rebuild if a press is in flight (B64); otherwise build now.
    if (pressedRef.current) { pendingRebuildRef.current = build; return; }
    build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, activeSiteId, selectMode, showPlans, hidden]);

  const flyToSite = (site) => {
    if (site.origin && mapRef.current) mapRef.current.flyTo([site.origin.lat, site.origin.lon], 17, { duration: 0.7 });
  };

  /* Resolve EVERY CAD county's parcel-layer URL once (no county pre-selection):
     a click is auto-routed to whichever county's service answers, so we need them
     all ready. Each is the queryable layer used both to outline parcels and to
     identify the lot under a click. A county whose service is unreachable is just
     skipped — its siblings still work. */
  useEffect(() => {
    let cancelled = false;
    Object.entries(COUNTIES_MAP).forEach(([key, cfg]) => {
      resolveLayerUrl(cfg.layerUrl || cfg.mapServer)
        .then((url) => { if (!cancelled) { layerUrlsRef.current[key] = url; if (selectModeRef.current) addDisplay(key); } })
        .catch(() => {}); // a single county being down must not break the others
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lazily add a county's visible parcel-outline layer (zoom-gated, county-bounded
  // so it only paints where that county has coverage). Idempotent per county.
  const addDisplay = (key) => {
    const map = mapRef.current;
    const url = layerUrlsRef.current[key];
    if (!map || !url || displaysRef.current[key]) return;
    const fl = makeParcelLayer(url);
    fl.on("requesterror", () => setErr("Parcel outlines are heavy here — clicking a lot still adds it."));
    fl.addTo(map);
    displaysRef.current[key] = fl;
  };
  const clearDisplays = () => {
    const map = mapRef.current;
    Object.values(displaysRef.current).forEach((fl) => { try { map && map.removeLayer(fl); } catch (_) {} });
    displaysRef.current = {};
  };

  /* enter/leave select mode: show all counties' outlines, set the +/− cursor,
     enable click-to-identify. */
  useEffect(() => {
    selectModeRef.current = selectMode;
    const map = mapRef.current;
    if (!map) return;
    if (selectMode) {
      Object.keys(layerUrlsRef.current).forEach(addDisplay);
      map.getContainer().style.cursor = ADD_CURSOR;
    } else {
      clearDisplays();
      map.getContainer().style.cursor = "";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectMode]);

  const handleClick = async (latlng) => {
    // Auto-route: figure out which configured county/counties could contain this
    // point, then identify against each one's CAD service and use whatever answers.
    // No county pre-selection required; a border straddle queries both and we take
    // the first hit. Candidates with an unresolved URL (service still loading or
    // down) are skipped this click.
    const candidates = candidateCountiesForPoint(latlng.lat, latlng.lng)
      .map((county) => ({ county, url: layerUrlsRef.current[county] }))
      .filter((c) => c.url);
    if (!candidates.length) { setErr("Parcel services are still loading — give it a second and click again."); return; }
    setBusy(true); setErr("");
    try {
      const hits = await identifyParcelAcross(candidates, latlng.lng, latlng.lat);
      if (!hits.length) { setErr("No parcel right there — zoom in and click directly on a lot."); return; }
      const { county, feature: feat } = hits[0]; // first county that answered owns the lot
      // ALL outer parts: a multipart parcel ("TRS 3 & 5" = two separate tracts) used to
      // highlight only its largest piece, so clicking the smaller tract registered the
      // account but lit up the neighbour instead (B36c). Highlight + plan every part.
      const rings = outerRingsLngLat(feat);
      if (!rings.length) { setErr("That record has no polygon shape — try an adjacent lot."); return; }
      const attrs = feat.attributes || {};
      // Namespace by county: OBJECTIDs are only unique within one CAD layer, so a multi-county
      // assembly could otherwise collide (two lots sharing an id would toggle each other off).
      const oid = attrs.OBJECTID ?? attrs.objectid ?? `${rings[0][0][0].toFixed(6)},${rings[0][0][1].toFixed(6)}`;
      const key = `${county}:${oid}`;
      const map = mapRef.current;
      if (hilitesRef.current[key]) {
        // toggle off
        map.removeLayer(hilitesRef.current[key]);
        delete hilitesRef.current[key];
        setSelected((s) => s.filter((x) => x.key !== key));
      } else {
        const latlngsList = rings.map((r) => r.map(([lon, lat]) => [lat, lon])); // every part — for the highlight + cursor hit-test
        if (hilitesRef.current[key]) { try { map.removeLayer(hilitesRef.current[key]); } catch (_) {} } // drop a stale hilite before overwriting → no orphaned polygon if two clicks race (B22)
        // Multipolygon nesting ([[part],[part]]) so each separate tract draws as its own
        // filled shape — not as a hole punched out of the first (Leaflet's 2-level form).
        hilitesRef.current[key] = L.polygon(latlngsList.map((ll) => [ll]), { color: PAL.accent, weight: 2.5, fillColor: PAL.accent, fillOpacity: 0.14, interactive: false }).addTo(map);
        setSelected((s) => (s.some((x) => x.key === key) ? s : [...s, { key, rings, latlngsList, addr: findVal(attrs, ADDR_RE), acct: findVal(attrs, ID_RE), attrs, county }])); // dedupe by key (B22)
        // B36(a): the statewide TxGIO layer (configured under `chambers`) can answer
        // for a Harris/FB lot when that county's own CAD didn't — relabel via a true
        // point-in-county lookup. Non-blocking + additive: only patches the saved
        // entry's county, never the select/hilite flow.
        if (county === "chambers") {
          countyAtPoint(latlng.lng, latlng.lat)
            .then(({ key: ckey }) => { if (ckey && ckey !== "chambers") setSelected((s) => s.map((x) => (x.key === key ? { ...x, county: ckey } : x))); })
            .catch(() => {});
        }
      }
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  const goAddress = async () => {
    const q = addr.trim();
    if (!q) return;
    setBusy(true); setErr("");
    try {
      const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}`;
      const r = await fetch(u);
      const j = await r.json();
      if (!j.length) { setErr("Couldn't find that address — add the city or ZIP, or just pan the map to it."); return; }
      mapRef.current.flyTo([+j[0].lat, +j[0].lon], 18, { duration: 0.75 });
    } catch (_) {
      setErr("Address search is unavailable right now — pan/zoom the map to your site instead.");
    } finally {
      setBusy(false);
    }
  };

  const clearSel = () => { clearHilites(); setSelected([]); };
  // Always capture the planner underlay from Esri: it supports image `export`
  // (USGS tiles render on the map but its export op returns no image). The
  // boundary aligns to either source, so the planner aerial stays reliable.
  const planSelected = () => {
    const asm = computeAssembly(selected, BASEMAPS.esri.export);
    // County now comes from the parcels themselves (auto-resolved at click), not a
    // pre-pick — use the last-selected parcel's county.
    const county = selected[selected.length - 1]?.county || selected.find((s) => s.county)?.county || null;
    if (asm) onUseParcels({ ...asm, name: selected[selected.length - 1]?.addr || "Untitled site", county });
  };

  const asm = selected.length ? computeAssembly(selected, BASEMAPS.esri.export) : null;

  const btn = (primary) => ({
    padding: "8px 14px", fontSize: 13, borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${primary ? PAL.accent : PAL.panelLine}`, background: primary ? PAL.accent : "#fbfaf6",
    color: primary ? "#fff" : PAL.ink, fontWeight: primary ? 600 : 500,
    boxShadow: primary ? "0 2px 8px rgba(232,89,12,0.3)" : "none",
  });
  const field = { padding: "8px 10px", fontSize: 13, border: `1px solid ${PAL.panelLine}`, borderRadius: 8, color: PAL.ink, background: "#fff", fontFamily: "inherit" };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#efeadf" }}>
      {/* map */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={elRef} style={{ position: "absolute", inset: 0 }} />

        {/* ── Combined site bar — floating pill at top-center ── */}
        <div style={{
          position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", zIndex: 1000,
          display: "flex", alignItems: "center",
          background: PAL.chrome,
          borderRadius: 99,
          boxShadow: "0 4px 20px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.25)",
          padding: "0 6px",
          height: 42,
          maxWidth: "calc(100% - 540px)",
          minWidth: 300,
        }}>
          {/* Address search */}
          <input
            style={{
              flex: 1, minWidth: 140, maxWidth: 300, height: "100%",
              padding: "0 10px", background: "transparent", border: "none", outline: "none",
              color: PAL.chromeInk, fontSize: 13, fontFamily: "inherit",
            }}
            placeholder="Find a site — address or place…"
            value={addr}
            onChange={(e) => setAddr(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !busy) goAddress(); }}
          />
          <button
            style={{
              flex: "none", height: 30, padding: "0 11px", borderRadius: 6,
              border: "none", background: PAL.accent, color: "#fff",
              fontSize: 12, fontWeight: 700, cursor: busy ? "default" : "pointer",
              fontFamily: "inherit", opacity: busy && !selectMode ? 0.6 : 1,
              whiteSpace: "nowrap",
            }}
            disabled={busy && !selectMode}
            onClick={goAddress}
          >
            {busy && !selectMode ? "…" : "Go"}
          </button>

          {/* Divider */}
          <span style={{ width: 1, height: 22, background: PAL.chromeLine, flex: "none", margin: "0 8px" }} />

          {/* Right section — state-dependent */}
          {!selectMode && selected.length === 0 && (
            <button
              onClick={() => setSelectMode(true)}
              style={{
                flex: "none", display: "flex", alignItems: "center", gap: 5,
                height: 30, padding: "0 11px", borderRadius: 6,
                border: "1px solid rgba(255,255,255,0.13)", background: "rgba(255,255,255,0.07)",
                color: PAL.chromeInk, fontSize: 12.5, fontWeight: 600,
                cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
              }}
            >
              ＋ Select parcels
            </button>
          )}
          {selectMode && selected.length === 0 && (
            <>
              <span style={{
                flex: "none", color: PAL.chromeMuted, fontSize: 12.5,
                padding: "0 6px", whiteSpace: "nowrap",
              }}>
                {busy ? "Looking up lot…" : "Selecting…"}
              </span>
              <button
                onClick={() => setSelectMode(false)}
                style={{
                  flex: "none", height: 30, padding: "0 10px", borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.13)", background: "rgba(255,255,255,0.07)",
                  color: PAL.chromeInk, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </>
          )}
          {selected.length > 0 && (
            <>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: PAL.accent, flex: "none" }} />
              <span style={{
                flex: "none", color: PAL.chromeInk, fontSize: 12.5, fontWeight: 600,
                padding: "0 8px", whiteSpace: "nowrap",
              }}>
                {selected.length} parcel{selected.length > 1 ? "s" : ""} · {asm ? `${asm.totalAc.toFixed(2)} ac` : "…"}
              </span>
              <button
                onClick={clearSel}
                title="Clear selection"
                style={{
                  flex: "none", width: 26, height: 26, borderRadius: 5,
                  border: "none", background: "transparent",
                  color: PAL.chromeMuted, fontSize: 13, lineHeight: 1,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
              <button
                onClick={planSelected}
                style={{
                  flex: "none", height: 30, padding: "0 11px", borderRadius: 6,
                  border: "none", background: PAL.accent, color: "#fff",
                  fontSize: 12, fontWeight: 700, cursor: "pointer",
                  fontFamily: "inherit", whiteSpace: "nowrap",
                }}
              >
                Plan {selected.length > 1 ? `${selected.length} parcels` : "site"} →
              </button>
            </>
          )}
          <span style={{ width: 4 }} />
        </div>

        {/* saved sites */}
        {sites.length > 0 && (
          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, width: 232, background: "rgba(255,255,255,0.96)", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 4px 18px rgba(28,25,20,0.14)", overflow: "hidden" }}>
            {/* collapsible header (B106): click to fold the panel to a slim bar; state persists per device */}
            <button onClick={toggleSitesPanel} title={sitesPanelOpen ? "Collapse the sites panel" : "Expand the sites panel"}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, padding: "9px 12px" }}>
              <span style={{ fontSize: 8, lineHeight: 1, transform: sitesPanelOpen ? "none" : "rotate(-90deg)", display: "inline-block" }}>▼</span>
              <span style={{ flex: 1, textAlign: "left" }}>Your sites</span>
              <span style={{ color: PAL.ink, fontWeight: 700 }}>{sites.length}</span>
            </button>
            {sitesPanelOpen && (<>
            {/* Pipeline by status — legend + filter + counts. Each chip toggles that status on the
                map; zero-count statuses are hidden to keep it tidy (B106). */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 8px 8px" }}>
              {STATUSES.filter((st) => (statusCounts[st] || 0) > 0).map((st) => {
                const sty = statusStyle(st); const off = hidden.has(st); const n = statusCounts[st] || 0;
                return (
                  <button key={st} onClick={() => toggleHidden(st)}
                    title={`${STATUS_META[st]?.label || st}: ${n} — click to ${off ? "show" : "hide"} on map`}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 6px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit",
                      fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, border: `1px solid ${off ? PAL.panelLine : sty.dot}`,
                      background: off ? "#f4f1ea" : "#fff", color: off ? PAL.muted : PAL.ink, opacity: off ? 0.7 : 1, textDecoration: off ? "line-through" : "none" }}>
                    <span style={{ color: sty.dot, fontSize: 11 }}>{STATUS_GLYPH[st]}</span>
                    {STATUS_META[st]?.label || st}<span style={{ color: PAL.muted, fontWeight: 700 }}>{n}</span>
                  </button>
                );
              })}
            </div>
            <div style={{ maxHeight: 280, overflowY: "auto", paddingBottom: 4, borderTop: `1px solid ${PAL.panelLine}` }}>
              {sites.map((s) => {
                const isActive = s.id === activeSiteId;
                const st = statusOf(s); const sty = statusStyle(st);
                const showActions = hoverRow === s.id || isActive; // crosshair + delete reveal on hover (B106)
                return (
                  <div key={s.id} title={s.origin ? "Open site (double-click to fly here · right-click for status)" : "Open site"}
                    onClick={() => onOpenSite && onOpenSite(s.id)}
                    onDoubleClick={() => flyToSite(s)}
                    onMouseEnter={() => setHoverRow(s.id)} onMouseLeave={() => setHoverRow((r) => (r === s.id ? null : r))}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setStatusMenu({ site: s, x: e.clientX, y: e.clientY }); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", borderLeft: `3px solid ${isActive ? PAL.accent : "transparent"}`, background: isActive ? "#fbf3ee" : "transparent" }}>
                    <button title={`Status: ${STATUS_META[st]?.label || st} — click to change`} aria-label="Set status"
                      onClick={(e) => { e.stopPropagation(); setStatusMenu({ site: s, x: e.clientX, y: e.clientY }); }}
                      style={{ width: 16, height: 16, flex: "none", display: "grid", placeItems: "center", borderRadius: 99, cursor: "pointer", padding: 0,
                        border: `1.5px solid ${sty.dot}`, background: sty.hollow ? "#fff" : sty.dot, color: sty.hollow ? sty.dot : "#fff", fontSize: 9, lineHeight: 1, fontFamily: "inherit" }}>
                      {STATUS_GLYPH[st]}
                    </button>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.site || s.name || "Untitled site"}</div>
                      <div style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, Menlo, monospace" }}>{STATUS_META[st]?.label || st} · {siteAcres(s) > 0 ? `${siteAcres(s).toFixed(1)} ac` : "no boundary"}{(s.els?.length ? ` · ${s.els.length} elem` : "")}</div>
                    </div>
                    <div style={{ display: "flex", gap: 2, flex: "none", alignItems: "center", opacity: showActions ? 1 : 0, transition: "opacity .12s", pointerEvents: showActions ? "auto" : "none" }}>
                      {s.origin && <button title="Show on map (zoom to the plan)" aria-label="Show on map" onClick={(e) => { e.stopPropagation(); flyToSite(s); }}
                        className="gbtn" style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", lineHeight: 0, padding: 3, borderRadius: 5 }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="5.2" /><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" /><path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2" /></svg>
                      </button>}
                      <button title="Delete site and all its plans" aria-label="Delete site" onClick={(e) => { e.stopPropagation(); setConfirmDel(s); }}
                        className="gbtn-danger" style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", lineHeight: 0, padding: 3, borderRadius: 5 }}>
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            </>)}
          </div>
        )}

        {/* imagery + labels + overlay layers control */}
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "6px 9px 8px", fontSize: 12, color: PAL.ink, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", width: 228 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: PAL.muted }}>Imagery</span>
            <select style={{ ...field, padding: "4px 6px", fontSize: 12, flex: 1 }} value={basemap} onChange={(e) => setBasemap(e.target.value)}>
              {Object.entries(BASEMAPS).map(([k, b]) => <option key={k} value={k}>{b.label}</option>)}
            </select>
            <label style={{ display: "flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
              <input type="checkbox" checked={labels} onChange={(e) => setLabels(e.target.checked)} /> Labels
            </label>
          </div>
          <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "7px -9px 6px" }} />
          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, marginBottom: 4 }}>Layers</div>
          <div style={{ maxHeight: 260, overflowY: "auto", margin: "0 -2px", paddingRight: 2 }}>
            {/* No county is pre-picked on the map any more (B11). The jurisdiction
                shown here follows the map's current area (B13) — `viewCounty` is
                resolved from the view centre on every moveend — so the right utility
                overlays are offered outside Houston too; per-site jurisdiction still
                follows the site's own county once one is opened in the planner. */}
            <LayerPanel overlays={overlays} setOverlays={setOverlays} county={viewCounty} layerStatus={layerStatus} />
          </div>
        </div>

        {/* error toast (bottom-left) — surfaced only when there's an error */}
        {err && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: PAL.accent, lineHeight: 1.45, pointerEvents: "none" }}>
            {err}
          </div>
        )}
        {/* contextual selection guidance — only while actively selecting (not a persistent fixture) */}
        {!err && selectMode && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: PAL.ink, lineHeight: 1.45, pointerEvents: "none" }}>
            {zoom != null && zoom < PARCEL_MINZOOM
              ? "Click any lot to add it (＋) — it works even before the purple outlines appear. Zoom in a little to see the lines."
              : "Click a lot to add it (＋). Hover an added lot and click to remove it (−). Add several, then Plan."}
          </div>
        )}
        {/* first-run-only, dismissible hint — replaces the old persistent "Drag to move" card (B105) */}
        {!err && !selectMode && showMapHint && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 360, background: "rgba(255,255,255,0.94)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: PAL.ink, lineHeight: 1.45, display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span>Drag to move the map. Hit “＋ Select parcels” to start adding lots.</span>
            <button onClick={dismissMapHint} title="Dismiss" style={{ flex: "none", border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 14, lineHeight: 1, padding: 0 }}>✕</button>
          </div>
        )}

      </div>
      {/* Right-click status picker — set the project's lifecycle stage. Current
          state is checked; picking another persists it (via onSetStatus) and the
          markers/legend re-render. Positioned at the cursor, clamped to viewport. */}
      {statusMenu && (
        <div onClick={() => setStatusMenu(null)} onContextMenu={(e) => { e.preventDefault(); setStatusMenu(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 4200 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: Math.min(statusMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 188),
              top: Math.min(statusMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 224),
              width: 180, background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.28)", overflow: "hidden", padding: "4px 0" }}>
            <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 12px 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statusMenu.site.site || statusMenu.site.name || "Site"}</div>
            {STATUSES.map((st) => {
              const sty = statusStyle(st); const cur = statusOf(statusMenu.site) === st;
              return (
                <button key={st} onClick={() => setStatus(statusMenu.site.id, st)}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                    background: cur ? "#fbf3ee" : "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: cur ? 700 : 500 }}>
                  <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", borderRadius: 99,
                    border: `1.5px solid ${sty.dot}`, background: sty.hollow ? "#fff" : sty.dot, color: sty.hollow ? sty.dot : "#fff", fontSize: 9, lineHeight: 1 }}>{STATUS_GLYPH[st]}</span>
                  <span style={{ flex: 1 }}>{STATUS_META[st]?.label || st}</span>
                  {cur && <span style={{ color: PAL.accent, fontWeight: 800 }}>✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(20,18,15,0.5)", display: "grid", placeItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", padding: 20, width: 340, maxWidth: "92vw" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: PAL.ink, marginBottom: 6 }}>Delete this site?</div>
            <div style={{ fontSize: 12.5, color: PAL.muted, lineHeight: 1.5, marginBottom: 16 }}>“{confirmDel.site || confirmDel.name || "this site"}” and all of its plans will be removed. This can't be undone.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="gbtn" style={{ padding: "8px 14px", fontSize: 12.5, borderRadius: 8, border: `1px solid ${PAL.panelLine}`, background: "#fff", color: PAL.ink, cursor: "pointer", fontWeight: 600 }} onClick={() => setConfirmDel(null)}>Cancel</button>
              <button style={{ padding: "8px 14px", fontSize: 12.5, borderRadius: 8, border: "1px solid #b91c1c", background: "#b91c1c", color: "#fff", cursor: "pointer", fontWeight: 600 }} onClick={() => { onDeleteSite && onDeleteSite(confirmDel.id); setConfirmDel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
