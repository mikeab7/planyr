import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import * as EL from "esri-leaflet";
import { COUNTIES, COUNTIES_MAP, candidateCountiesForPoint, STATEWIDE_KEYS } from "./lib/counties.js";
import { recordSourceResult, filterHealthyCandidates } from "./lib/sourceHealth.js";
import { syncOverlayLayers, withTileRetry, ALL_LAYERS, probeService } from "./lib/layers.js";
import { prefetchExtents, computeCoverage, boundsFromLeaflet, getNearbyRadiusMiles, subscribeRelevance } from "./lib/coverage.js";
import LayerPanel from "./components/LayerPanel.jsx";
import {
  resolveLayerUrl,
  identifyParcelDetailed,
  outerRingsLngLat,
  lngLatRingToFeet,
  feetToLatLng,
  aerialPlacement,
  humanizeError,
} from "./lib/arcgis.js";
import { elStyle, elRingFeet, byZ } from "./lib/planStyle.js";
import { STATUSES, STATUS_META, statusOf } from "./lib/siteModel.js";
import { countyAtPoint } from "./lib/jurisdiction.js";
import { apprRows, apprVal, findAttr } from "./lib/appraisal.js";
import { statusToken, darken } from "../../shared/ui/statusTokens.js";

// Theme tokens (var(--…)) — MapFinder is DOM/inline-style only, so CSS vars resolve
// and the panel themes live with no re-render. (B318)
const PAL = {
  panelBg: "var(--surface-raised)", panelLine: "var(--border-default)", ink: "var(--text-primary)",
  accent: "var(--accent)", muted: "var(--text-secondary)",
  chrome: "var(--chrome-bg)", chromeLine: "var(--chrome-divider)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)", ember: "var(--accent)",
};

// Free aerial sources (no API key). Both are ArcGIS MapServers that support
// both XYZ tiles (for the map) and `export` (for the planner underlay capture).
// `maxNative` = each provider's native imagery ceiling (Esri z19 ≈ 0.3 m/px; USGS
// z16). This is REQUIRED per source and must not be dropped in a refactor: past its
// ceiling a provider returns the gray "Map data not yet available" placeholder as an
// HTTP 200 (not an error), so Leaflet's error-tile fallback never fires and the whole
// view goes blank. The imagery layer below clamps fetches to this ceiling (minus the
// retina offset) and lets maxZoom upscale the deepest real tile beyond it. Any new
// source MUST carry its own `maxNative`. (B220 — recurrence of B182)
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

/* Project-status visual language — color + glyph + shape per state come from the
 * ONE shared token set (src/shared/ui/statusTokens.js), consumed identically by the
 * filter chips, the list-item markers, and the map pins below (B234). Two redundant
 * cues per state (color AND glyph/shape) so it still reads for colorblind users and
 * over a busy aerial. The module accent colors (Site/Schedule/Markup) are
 * deliberately NOT used here — they belong to the tab row. */

// The status glyph as an inline WHITE SVG (crisp at every size/zoom + on retina;
// never raster). Keyed off the token `shape`, and drawn CENTERED on (cx,cy) — each
// glyph's bounding box is balanced about that point so it sits dead-center in the
// marker head regardless of the body shape. B365.
function statusGlyph(shape, cx, cy) {
  const n = (v) => +v.toFixed(2);
  switch (shape) {
    case "flag": {  // Pursuit — a planted flag (pole left, pennant balanced right).
      const px = n(cx - 2.5);
      return `<path d="M${px},${n(cy + 5.5)} L${px},${n(cy - 5.8)}" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>` +
             `<path d="M${px},${n(cy - 5.3)} L${n(cx + 3.5)},${n(cy - 3.1)} L${px},${n(cy - 0.9)} Z" fill="#fff"/>`;
    }
    case "pulse":   // Active build — an activity/heartbeat line.
      return `<polyline points="${n(cx - 6.5)},${cy} ${n(cx - 3.5)},${cy} ${n(cx - 1.5)},${n(cy - 4.4)} ${n(cx + 1.5)},${n(cy + 4.4)} ${n(cx + 3.5)},${cy} ${n(cx + 6.5)},${cy}" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "pause":   // On hold — two bars.
      return `<rect x="${n(cx - 3.3)}" y="${n(cy - 5)}" width="2.6" height="10" rx="1" fill="#fff"/><rect x="${n(cx + 0.7)}" y="${n(cy - 5)}" width="2.6" height="10" rx="1" fill="#fff"/>`;
    case "check":   // Complete.
      return `<polyline points="${n(cx - 5)},${n(cy - 0.3)} ${n(cx - 1.6)},${n(cy + 3.4)} ${n(cx + 5.4)},${n(cy - 4.4)}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "x":       // Dead (only shown when explicitly surfaced).
      return `<path d="M${n(cx - 3.4)},${n(cy - 3.4)} L${n(cx + 3.4)},${n(cy + 3.4)} M${n(cx + 3.4)},${n(cy - 3.4)} L${n(cx - 3.4)},${n(cy + 3.4)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
    default: return "";
  }
}

/* Status map pin (B365): a FLAT-TOP shield "Planyr site" marker (flat top edge,
 * tapering to a point at the bottom that lands on the exact spot), kept constant
 * across states so it always reads as a site — only the FILL color, white halo, size
 * tier, glyph, and opacity vary, and they vary WITH importance (Pursuit loudest →
 * Complete recessive; see statusTokens.js).
 *  • White HALO only (a fattened white copy under the body) — no drop-shadow, which
 *    flashes on re-render and costs perf; the halo is what guarantees legibility over
 *    both bright (tan/developed) and dark (water/forest) tiles.
 *  • A FIXED hit box for every state → the anchor never drifts when a pin's status/
 *    size changes, and the small Complete pin keeps the big pin's generous click
 *    target (shrinking the art never shrinks the tap target).
 * `active` = the currently-open site (a small extra size bump + float-to-top z). */
function buildingPinIcon(status, active) {
  const t = statusToken(status);
  // Fixed hit box ≥ the old largest marker (~32×41) so the tap target never regresses.
  const HIT_W = 34, HIT_H = 44;
  // Size tracks importance, dropped ~25% overall from the old single size; the open
  // site gets a small bump on top of its tier.
  const vs = 0.75 * (t.tier || 1) * (active ? 1.12 : 1);
  const w = +(28 * vs).toFixed(1), h = +(36 * vs).toFixed(1);
  const op = t.mapOpacity ?? 1;
  const halo = t.halo || 2;
  // Flat-top shield: flat top edge (5,10)–(23,10), straight sides to y=22, then a clean
  // taper to the point at (14,35) that lands on the geographic spot. The glyph centers
  // on the head zone x[5,23] × y[10,22] → (14,16).
  const body = "M14,35 L5,22 L5,10 L23,10 L23,22 Z";
  const GX = 14, GY = 16;
  let shapeSvg;
  if (t.mapHollow) {
    // Lost/passed deal: a faint hollow outline (only ever shown when filtered to Dead).
    shapeSvg =
      `<path d="${body}" fill="none" stroke="#fff" stroke-width="${halo * 2}" stroke-linejoin="round" opacity="0.7"/>` +
      `<path d="${body}" fill="none" stroke="${t.color}" stroke-width="1.4" stroke-linejoin="round"/>`;
  } else {
    shapeSvg =
      // white halo underlay (round joins → uniform outer ring), then the colored body
      `<path d="${body}" fill="#fff" stroke="#fff" stroke-width="${halo * 2}" stroke-linejoin="round"/>` +
      `<path d="${body}" fill="${t.color}" stroke="${darken(t.color, 0.28)}" stroke-width="0.75" stroke-linejoin="round"/>` +
      statusGlyph(t.shape, GX, GY);
  }
  // SVG bottom-aligned + horizontally centered in the fixed box → the pin tip sits at
  // the box's bottom-center, which is the icon anchor (the geographic point), for EVERY
  // size tier. overflow:visible so the halo isn't clipped.
  const html =
    `<div style="position:relative;width:${HIT_W}px;height:${HIT_H}px;opacity:${op}">` +
    `<svg width="${w}" height="${h}" viewBox="0 0 28 36" ` +
    `style="position:absolute;left:${((HIT_W - w) / 2).toFixed(1)}px;bottom:0;overflow:visible">` +
    shapeSvg +
    `</svg></div>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [HIT_W, HIT_H],
    iconAnchor: [HIT_W / 2, HIT_H],
    tooltipAnchor: [0, -(h - 2)],
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
// findAttr (imported from lib/appraisal.js) is the shared "first non-empty attr
// matching this regex, as a string" helper — formerly a local findVal duplicate.
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

// Total acreage across every outer ring of a lon/lat parcel feature (multipart-safe).
function ringsAcres(rings) {
  if (!rings || !rings.length) return null;
  try {
    const lon0 = rings[0][0][0], lat0 = rings[0][0][1];
    return rings.reduce((sum, r) => sum + shoelace(lngLatRingToFeet(r, lon0, lat0)), 0) / 43560;
  } catch (_) { return null; }
}

/* Geocode a free-text address/place to { lat, lon, label }, biased to the current
 * map area so a bare local street address ("19630 Crossbranch") lands near where
 * you're looking instead of in another state. Tries Esri's World geocoder FIRST —
 * it's far better at exact US street addresses and is the same keyless ArcGIS
 * family the app already uses for imagery + parcels — then falls back to OSM
 * Nominatim (also biased to a box around the map). Returns null if neither
 * resolves. The old code only used Nominatim with no biasing, which routinely
 * returned nothing for house-number addresses, so the map never moved (B232). */
async function geocodeAddress(q, center) {
  const near = center ? `&location=${center.lng},${center.lat}` : "";
  // 1) Esri World Geocoding Service — single, non-stored lookup (keyless).
  try {
    const u = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates` +
      `?f=json&singleLine=${encodeURIComponent(q)}&maxLocations=1&outFields=Match_addr&countryCode=USA${near}`;
    const r = await fetch(u);
    if (r.ok) {
      const j = await r.json();
      const c = j && j.candidates && j.candidates[0];
      if (c && c.location && isFinite(c.location.y) && isFinite(c.location.x)) {
        return { lat: c.location.y, lon: c.location.x, label: c.address || q };
      }
    }
  } catch (_) { /* fall through to Nominatim */ }
  // 2) Nominatim fallback — bias to a ~0.6° viewbox around the map centre.
  try {
    let vb = "";
    if (center) { const d = 0.6; vb = `&viewbox=${center.lng - d},${center.lat + d},${center.lng + d},${center.lat - d}&bounded=0`; }
    const u = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(q)}${vb}`;
    const r = await fetch(u);
    if (r.ok) {
      const j = await r.json();
      if (j && j.length) return { lat: +j[0].lat, lon: +j[0].lon, label: j[0].display_name || q };
    }
  } catch (_) { /* both failed */ }
  return null;
}

// Curated "key appraisal attributes" matchers for the search info card (B233) —
// the headline facts beyond address/account that help identify a tract at a glance.
const OWNER_RE = /^(owner|own_?name|owner_?name|name|owner1)$/i;

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
  // (B167) The idle "Drag to move the map" first-run bubble was removed entirely per owner
  // request — the map loads with no instructional overlay. Only the contextual selection
  // guidance and the error toast remain in the bottom-left slot (see B21/B105).
  // Sites panel: collapsible (persisted) + per-row hover-reveal of the crosshair/delete actions (B106).
  const [sitesPanelOpen, setSitesPanelOpen] = useState(() => { try { return localStorage.getItem("planarfit:sitesPanelClosed:v1") !== "1"; } catch (_) { return true; } });
  const toggleSitesPanel = () => setSitesPanelOpen((v) => { const n = !v; try { localStorage.setItem("planarfit:sitesPanelClosed:v1", n ? "0" : "1"); } catch (_) {} return n; });
  const [hoverRow, setHoverRow] = useState(null);
  const [viewCounty, setViewCounty] = useState("harris"); // jurisdiction for the Layers panel — follows the map's current area (B13)
  const [confirmDel, setConfirmDel] = useState(null); // site pending delete confirmation
  // (B235) The chips are now POSITIVE filters: a status in this set is SHOWN; an
  // empty set shows everything. The filter drives BOTH the list and the map pins,
  // so "show only Active" focuses both at once. (Replaces the old hide-on-map set.)
  const [statusFilter, setStatusFilter] = useState(() => new Set());
  const [nameFilter, setNameFilter] = useState(""); // type-to-filter the list by site name (B235)
  // Per-status section collapse in the list (B235). Settled stages start collapsed so
  // the handful that need a decision stay visible; persisted per device.
  const [groupCollapsed, setGroupCollapsed] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem("planarfit:sitesGroups:v1") || "null"); if (v) return v; } catch (_) {}
    return { complete: true, dead: true };
  });
  const [statusMenu, setStatusMenu] = useState(null); // {site, x, y} — right-click status picker
  const [parcelInfo, setParcelInfo] = useState(null); // {status:'found'|'none'|'unavailable', label, addr, acct, acres, attrs, county, key, backup} — address-search result (B233)
  const [backupNotice, setBackupNotice] = useState(null); // {county} — set when a click was answered by the statewide backup because the county's own server was down (B244)
  // overlays / setOverlays are app-shared (lifted to App) so toggles reflect on both pages.
  const overlayRefs = useRef({}); // key -> live esri dynamicMapLayer (this map's instances)
  const [coverage, setCoverage] = useState({}); // id -> "in"|"out"|"unknown" (NEW-1; picker-only)
  const [selected, setSelected] = useState([]); // [{key, rings:[[ [lon,lat],…] ], latlngsList:[[ [lat,lng],…] ], addr, acct, attrs, county}] — rings = every outer part (multipart-safe)
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const toggleStatusFilter = (st) => setStatusFilter((h) => { const n = new Set(h); n.has(st) ? n.delete(st) : n.add(st); return n; });
  const toggleGroup = (st) => setGroupCollapsed((c) => { const n = { ...c, [st]: !c[st] }; try { localStorage.setItem("planarfit:sitesGroups:v1", JSON.stringify(n)); } catch (_) {} return n; });
  // Apply a status to a site (group), then refresh — closes the right-click menu.
  const setStatus = (siteId, st) => { onSetStatusRef.current && onSetStatusRef.current(siteId, st); setStatusMenu(null); };
  // Pipeline counts by status across all sites (for the chips / counts strip).
  const statusCounts = STATUSES.reduce((m, st) => { m[st] = 0; return m; }, {});
  sites.forEach((s) => { statusCounts[statusOf(s)] = (statusCounts[statusOf(s)] || 0) + 1; });
  // A site passes the chip filter if no chips are selected, or its status is selected.
  const passStatus = (s) => statusFilter.size === 0 || statusFilter.has(statusOf(s));
  // …and the name filter (case-insensitive substring on the site/plan name).
  const nf = nameFilter.trim().toLowerCase();
  const passName = (s) => !nf || (s.site || s.name || "").toLowerCase().includes(nf);

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
    // so imagery is crisp instead of upscaled-and-soft. Keeps the Esri source. (B170)
    //
    // maxNativeZoom must DROP BY 1 on a retina/HiDPI display: detectRetina fetches one
    // zoom level HIGHER than the display zoom (it adds zoomOffset +1), so a plain
    // `maxNativeZoom: bm.maxNative` would, at deep zoom, ask the provider for a tile one
    // level past its native ceiling (Esri z20, USGS z17) — which arcgisonline/USGS
    // answer with the gray "Map data not yet available" PLACEHOLDER served as HTTP 200,
    // so the error-tile fallback never fires and the canvas fills with gray. Clamping
    // native to ceiling−1 on retina makes the highest fetch land on a REAL tile and lets
    // maxZoom:21 upscale it past that (slightly soft, never blank). Applies to EVERY
    // source in the dropdown via bm.maxNative. This is the same retina-offset fix B182
    // shipped for the planner-canvas backdrop (SitePlanner.jsx GEO_BASEMAP's
    // detailMaxNative); B220 brings it to the map-finder layer B182 missed. Do NOT drop
    // this in a refactor — the placeholder regresses SILENTLY (tiles return 200). (B220)
    const srcMaxNative = L.Browser.retina ? bm.maxNative - 1 : bm.maxNative;
    const layer = withTileRetry(L.tileLayer(bm.tiles, { maxZoom: 21, maxNativeZoom: srcMaxNative, detectRetina: true, attribution: bm.attr }));
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
    // Cap the reference/labels overlay at the imagery's native ceiling (z19) so the two
    // layers don't DIVERGE at deep zoom. World_Transportation serves tiles past z19, so
    // without this cap the labels kept rendering crisp while the imagery (clamped to its
    // native ceiling) had nothing there — the exact "labels float over gray" diagnostic
    // tell. No detectRetina on this overlay, so there's no retina offset to subtract.
    // Keep this aligned with the imagery layer's native ceiling above. (B220)
    const layer = L.tileLayer(LABELS_TILES, { maxZoom: 21, maxNativeZoom: 19, opacity: initOpacity });
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

  /* Coverage (NEW-1/B283): which layers' DATA reaches the current view, for the
     Layers panel's relevance picker. Recompute on map move (debounced) and when the
     nearby-range pref changes. Picker-only — never touches the map's requests. */
  useEffect(() => {
    let t;
    const recompute = () => setCoverage(computeCoverage(boundsFromLeaflet(mapRef.current), overlays, getNearbyRadiusMiles()));
    const debounced = () => { clearTimeout(t); t = setTimeout(recompute, 250); };
    // Read each regional service's extent from its health probe (no extra request), then compute.
    prefetchExtents(ALL_LAYERS, probeService).then(recompute);
    recompute();
    const map = mapRef.current;
    if (map) map.on("moveend", debounced);
    const unsub = subscribeRelevance(recompute);
    return () => { clearTimeout(t); if (map) map.off("moveend", debounced); unsub(); };
  }, [overlays]);

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
    if (visible) { clearHilites(); setSelected([]); setSelectMode(false); setParcelInfo(null); }
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
      if (statusFilter.size && !statusFilter.has(status)) return; // chip filter: show only selected statuses (B235)
      // Lost/passed deals recede off the map unless the user explicitly filters to
      // Dead — a settled stage shouldn't clutter the active picture (B365).
      if (status === "dead" && !statusFilter.has("dead")) return;
      const { lat, lon } = site.origin;
      const active = site.id === activeSiteId;
      const tip = `${site.site || site.name || "Site"} · ${siteAcres(site).toFixed(1)} ac · ${STATUS_META[status]?.label || status} · click to open`;
      const openSiteNow = () => onOpenSiteRef.current && onOpenSiteRef.current(site.id);
      // Right-click anywhere on a site → status picker at the cursor. (Suppress
      // the browser's native menu via the underlying DOM event.)
      const onCtx = (e) => { if (selectModeRef.current) return; const oe = e.originalEvent; if (oe) { oe.preventDefault(); oe.stopPropagation(); } setStatusMenu({ site, x: (oe && oe.clientX) || 0, y: (oe && oe.clientY) || 0 }); };

      if (showPlans && site.parcels?.length) {
        const t = statusToken(status);
        // Boundary ALWAYS carries the project status color; the open site is
        // emphasized with a heavier line (not by recoloring it to ember), so its
        // status stays visible — consistent with the status pin.
        const lineColor = t.color;
        const lineWeight = active ? 3.25 : 2.25;
        site.parcels.forEach((p) => {
          if (!p.points?.length) return;
          const poly = L.polygon(p.points.map((pt) => feetToLatLng(pt, lat, lon)), {
            color: lineColor, weight: lineWeight, dashArray: t.dashed ? "5 4" : "6 5",
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
        // zoomed out: a status-aware map pin at the site origin. Z-order by IMPORTANCE
        // (Pursuit on top → Complete at the bottom) so a settled pin never occludes a
        // pursuit where they overlap; the open site floats above its tier (B365).
        const zBase = (statusToken(status).z || 100) + (active ? 1000 : 0);
        const marker = L.marker([lat, lon], { icon: buildingPinIcon(status, active), interactive: !selectMode, keyboard: false, zIndexOffset: zBase, riseOnHover: true });
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
  }, [sites, activeSiteId, selectMode, showPlans, statusFilter]);

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

  /* Stable per-parcel key (county-namespaced — OBJECTIDs are only unique within one
     CAD layer, so a multi-county assembly could otherwise collide). */
  const parcelKey = (county, rings, attrs) => {
    const oid = attrs.OBJECTID ?? attrs.objectid ?? `${rings[0][0][0].toFixed(6)},${rings[0][0][1].toFixed(6)}`;
    return `${county}:${oid}`;
  };

  /* Highlight + add ONE identified parcel to the selection (idempotent — never
     toggles off). The SINGLE parcel-pipeline both click-to-select and
     address-search-select use, so they behave identically (B233). `at` is the
     query point used only for the Chambers→true-county relabel. Returns
     { key, attrs, rings } or null if the record has no polygon. */
  const addParcelHit = (hit, at) => {
    const { county, feature: feat } = hit;
    // ALL outer parts: a multipart parcel ("TRS 3 & 5" = two tracts) must highlight +
    // plan every piece, not just the largest (B36c).
    const rings = outerRingsLngLat(feat);
    if (!rings.length) return null;
    const attrs = feat.attributes || {};
    const key = parcelKey(county, rings, attrs);
    const map = mapRef.current;
    if (!hilitesRef.current[key]) {
      const latlngsList = rings.map((r) => r.map(([lon, lat]) => [lat, lon])); // every part — highlight + cursor hit-test
      // Multipolygon nesting ([[part],[part]]) so each separate tract draws as its own
      // filled shape — not as a hole punched out of the first (Leaflet's 2-level form).
      hilitesRef.current[key] = L.polygon(latlngsList.map((ll) => [ll]), { color: PAL.accent, weight: 2.5, fillColor: PAL.accent, fillOpacity: 0.14, interactive: false }).addTo(map);
      setSelected((s) => (s.some((x) => x.key === key) ? s : [...s, { key, rings, latlngsList, addr: findAttr(attrs, ADDR_RE), acct: findAttr(attrs, ID_RE), attrs, county }])); // dedupe by key (B22)
      // B36(a): the statewide TxGIO layer (configured under `chambers`) can answer
      // for a Harris/FB lot — relabel via a true point-in-county lookup (non-blocking).
      if (county === "chambers" && at) {
        countyAtPoint(at.lng, at.lat)
          .then(({ key: ckey }) => { if (ckey && ckey !== "chambers") setSelected((s) => s.map((x) => (x.key === key ? { ...x, county: ckey } : x))); })
          .catch(() => {});
      }
    }
    return { key, attrs, rings };
  };

  /* Build the parcel-query candidates for a point. Drops any primary whose circuit
     breaker is OPEN — we just saw it fail, so don't re-hammer it on every click and
     re-incur the (now time-boxed) failure (B244) — but ALWAYS keeps the statewide
     source so coverage holds. Also returns the real (non-statewide) CAD candidates so
     a statewide answer can be honestly flagged as a "backup". */
  const resolveCandidates = (latlng) => {
    const all = candidateCountiesForPoint(latlng.lat, latlng.lng)
      .map((county) => ({ county, url: layerUrlsRef.current[county] }))
      .filter((c) => c.url);
    const realPrimaries = all.filter((c) => !STATEWIDE_KEYS.includes(c.county));
    return { candidates: filterHealthyCandidates(all, STATEWIDE_KEYS), realPrimaries };
  };
  // A statewide-backup answer reports the parcel's true county in its `county` attr
  // ("FORT BEND"); title-case it for the badge, or fall back to a generic phrase.
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const backupCountyLabel = (attrs) => { const c = findAttr(attrs, /^county$/i); return c ? titleCase(c) : "This county"; };

  const handleClick = async (latlng) => {
    // Auto-route: figure out which configured county/counties could contain this
    // point, then identify against each one's CAD service and use whatever answers.
    // No county pre-selection required; a border straddle queries both and we take
    // the first hit. Candidates with an unresolved URL (service still loading or
    // down), or a primary whose breaker is open, are skipped this click.
    const { candidates, realPrimaries } = resolveCandidates(latlng);
    if (!candidates.length) { setErr("Parcel services are still loading — give it a second and click again."); return; }
    setBusy(true); setErr(""); setBackupNotice(null);
    try {
      const res = await identifyParcelDetailed(candidates, latlng.lng, latlng.lat);
      res.sources.forEach((s) => recordSourceResult(s.county, s.ok)); // feed the circuit breaker
      if (!res.hits.length) {
        // "Couldn't reach any parcel server" reads differently from "reached one, but
        // there's no parcel at this exact point" (B245).
        setErr(res.responded === 0
          ? "The county parcel server isn't responding right now — try again in a moment, or trace the lot from the Aerial underlay."
          : "No parcel right there — zoom in and click directly on a lot.");
        return;
      }
      const hit = res.hits[0]; // first county that answered owns the lot
      // A hit FROM the statewide layer while a real CAD existed for this spot means
      // TxGIO stood in for a county whose own server was down/skipped — flag it.
      const viaBackup = STATEWIDE_KEYS.includes(hit.county) && realPrimaries.length > 0;
      const rings = outerRingsLngLat(hit.feature);
      if (!rings.length) { setErr("That record has no polygon shape — try an adjacent lot."); return; }
      const key = parcelKey(hit.county, rings, hit.feature.attributes || {});
      if (hilitesRef.current[key]) {
        // toggle off
        mapRef.current.removeLayer(hilitesRef.current[key]);
        delete hilitesRef.current[key];
        setSelected((s) => s.filter((x) => x.key !== key));
      } else {
        addParcelHit(hit, latlng);
        if (viaBackup) setBackupNotice({ county: backupCountyLabel(hit.feature.attributes || {}) });
      }
    } catch (e) {
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  /* NEW-2 (B233): identify + select the parcel at a geocoded point and surface its
     info card. Reuses the SAME identify/select pipeline as a click. Distinguishes
     "couldn't reach the parcel service" (unavailable) from "no parcel at this point"
     (none) — they mean different things and must read differently. */
  const selectParcelAt = async (latlng, label) => {
    const { candidates, realPrimaries } = resolveCandidates(latlng);
    if (!candidates.length) { setParcelInfo({ status: "unavailable", label }); return; }
    let res;
    try {
      res = await identifyParcelDetailed(candidates, latlng.lng, latlng.lat);
    } catch (_) {
      setParcelInfo({ status: "unavailable", label }); return;
    }
    res.sources.forEach((s) => recordSourceResult(s.county, s.ok)); // feed the circuit breaker
    if (!res.hits.length) {
      // Nothing matched: if NO service even responded, the source is unavailable;
      // if one answered with no parcel, the point is genuinely empty (a road/ROW).
      setParcelInfo({ status: res.responded === 0 ? "unavailable" : "none", label }); return;
    }
    const hit = res.hits[0];
    const viaBackup = STATEWIDE_KEYS.includes(hit.county) && realPrimaries.length > 0;
    const added = addParcelHit(hit, latlng);
    if (!added) { setParcelInfo({ status: "none", label }); return; }
    setParcelInfo({
      status: "found", label, key: added.key, county: hit.county, attrs: added.attrs,
      addr: findAttr(added.attrs, ADDR_RE), acct: findAttr(added.attrs, ID_RE), acres: ringsAcres(added.rings),
      backup: viaBackup ? backupCountyLabel(hit.feature.attributes || {}) : null,
    });
  };

  // NEW-1 (B232) + NEW-2 (B233): geocode → recenter at parcel zoom → select the
  // parcel there + show its info. (The old version only flew to a Nominatim hit and
  // often got none for a bare street address, so the map never moved.)
  const goAddress = async () => {
    const q = addr.trim();
    if (!q) return;
    setBusy(true); setErr(""); setParcelInfo(null);
    try {
      const center = mapRef.current ? mapRef.current.getCenter() : null;
      const hit = await geocodeAddress(q, center);
      if (!hit) { setErr("Couldn't find that address — add the city or ZIP, or just pan the map to it."); return; }
      mapRef.current.flyTo([hit.lat, hit.lon], 18, { duration: 0.75 });
      await selectParcelAt({ lat: hit.lat, lng: hit.lon }, hit.label); // NEW-2: select + surface parcel info
    } catch (_) {
      setErr("Address search is unavailable right now — pan/zoom the map to your site instead.");
    } finally {
      setBusy(false);
    }
  };

  const clearSel = () => { clearHilites(); setSelected([]); setParcelInfo(null); setBackupNotice(null); };
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
  const field = { padding: "8px 10px", fontSize: 13, border: `1px solid ${PAL.panelLine}`, borderRadius: 8, color: PAL.ink, background: "var(--surface-raised)", fontFamily: "inherit" };

  // One left-rail site row — shared by every status section (B235). Status marker,
  // name (struck through when Dead), status + acreage, and the hover "show on map" ⊕.
  const siteRow = (s) => {
    const isActive = s.id === activeSiteId;
    const st = statusOf(s); const t = statusToken(st);
    const showActions = hoverRow === s.id || isActive;
    return (
      <div key={s.id} title={s.origin ? "Open site (double-click to fly here · right-click for status / delete)" : "Open site (right-click for status / delete)"}
        onClick={() => onOpenSite && onOpenSite(s.id)}
        onDoubleClick={() => flyToSite(s)}
        onMouseEnter={() => setHoverRow(s.id)} onMouseLeave={() => setHoverRow((r) => (r === s.id ? null : r))}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setStatusMenu({ site: s, x: e.clientX, y: e.clientY }); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", borderLeft: `3px solid ${isActive ? PAL.accent : "transparent"}`, background: isActive ? "#fbf3ee" : "transparent" }}>
        <button title={`Status: ${STATUS_META[st]?.label || st} — click to change`} aria-label="Set status"
          onClick={(e) => { e.stopPropagation(); setStatusMenu({ site: s, x: e.clientX, y: e.clientY }); }}
          style={{ width: 16, height: 16, flex: "none", display: "grid", placeItems: "center", borderRadius: 99, cursor: "pointer", padding: 0,
            border: `1.5px solid ${t.color}`, background: t.hollow ? "var(--surface-raised)" : t.color, color: t.hollow ? t.color : "#fff", fontSize: 9, lineHeight: 1, fontFamily: "inherit" }}>
          {t.glyph}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: t.struck ? "line-through" : "none" }}>{s.site || s.name || "Untitled site"}</div>
          <div style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, Menlo, monospace" }}>{STATUS_META[st]?.label || st} · {siteAcres(s) > 0 ? `${siteAcres(s).toFixed(1)} ac` : "no boundary"}{(s.els?.length ? ` · ${s.els.length} elem` : "")}</div>
        </div>
        {/* (B168) single-click ✕ delete removed — delete lives in the right-click menu;
            only the non-destructive locate (⊕) stays here. */}
        <div style={{ display: "flex", gap: 2, flex: "none", alignItems: "center", opacity: showActions ? 1 : 0, transition: "opacity .12s", pointerEvents: showActions ? "auto" : "none" }}>
          {s.origin && <button title="Show on map (zoom to the plan)" aria-label="Show on map" onClick={(e) => { e.stopPropagation(); flyToSite(s); }}
            className="gbtn" style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", lineHeight: 0, padding: 3, borderRadius: 5 }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="5.2" /><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" /><path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2" /></svg>
          </button>}
        </div>
      </div>
    );
  };
  // Sites matching the active chip + name filters (for the panel header count).
  const shownCount = sites.filter((s) => passStatus(s) && passName(s)).length;

  // One label/value row for the address-search parcel info card (B233).
  const infoRow = (label, value) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "4px 0", borderBottom: "1px solid #f3efe5" }}>
      <span style={{ fontSize: 11, color: PAL.muted, flex: "none" }}>{label}</span>
      <span style={{ fontSize: 11.5, color: PAL.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{value}</span>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface-page)" }}>
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
                border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
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
                  border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
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

        {/* NEW-2 (B233): address-search parcel info card — drops in under the search
            pill after a "Go". Three distinct states: found (parcel ID + key appraisal
            facts), none (centered, but no parcel at that point), and unavailable
            (couldn't reach the parcel service) — the last two read differently. */}
        {parcelInfo && (
          <div style={{ position: "absolute", top: 64, left: "50%", transform: "translateX(-50%)", zIndex: 1001, width: 348, maxWidth: "calc(100% - 540px)", background: PAL.panelBg, border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 6px 22px rgba(28,25,20,0.22)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 11px", borderBottom: parcelInfo.status === "found" ? `1px solid ${PAL.panelLine}` : "none" }}>
              <span style={{ flex: "none", fontSize: 13 }}>{parcelInfo.status === "found" ? "📍" : parcelInfo.status === "none" ? "○" : "⚠"}</span>
              <span style={{ flex: 1, fontSize: 12.5, fontWeight: 700, color: parcelInfo.status === "unavailable" ? PAL.accent : PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {parcelInfo.status === "found" ? (parcelInfo.addr || parcelInfo.label || "Parcel")
                  : parcelInfo.status === "none" ? "No parcel at this point"
                  : "Parcel info unavailable"}
              </span>
              <button onClick={() => setParcelInfo(null)} title="Dismiss" aria-label="Dismiss parcel info"
                style={{ flex: "none", width: 22, height: 22, borderRadius: 5, border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
            </div>
            {parcelInfo.status === "found" ? (
              <div style={{ padding: "8px 11px 10px" }}>
                {parcelInfo.backup && (
                  <div style={{ marginBottom: 8, padding: "6px 8px", background: "#fdf6e7", border: "1px solid #e6c478", borderRadius: 6, fontSize: 11, color: "#8a5a00", lineHeight: 1.4 }}>
                    Statewide backup — {parcelInfo.backup} county’s server is unavailable; shown from TxGIO and may lag county updates.
                  </div>
                )}
                {parcelInfo.acct && infoRow("Account / ID", parcelInfo.acct)}
                {parcelInfo.acres != null && infoRow("Acreage (measured)", `${parcelInfo.acres.toFixed(2)} ac`)}
                {apprRows(parcelInfo.attrs)
                  .filter((r) => !/^(situs address|account \/ id|acreage)$/i.test(r.label))
                  .map((r) => infoRow(r.label, apprVal(r.label, r.value)))}
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
                  <button onClick={planSelected}
                    style={{ height: 30, padding: "0 12px", borderRadius: 6, border: "none", background: PAL.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                    Plan this site →
                  </button>
                </div>
              </div>
            ) : parcelInfo.status === "none" ? (
              <div style={{ padding: "9px 11px", fontSize: 11.5, color: PAL.muted, lineHeight: 1.5 }}>
                The map centered on the address, but no parcel covers that exact point — it may sit on a road or right-of-way. Click the lot directly, or zoom in and use <b>Select parcels</b>.
              </div>
            ) : (
              <div style={{ padding: "9px 11px", fontSize: 11.5, color: PAL.accent, lineHeight: 1.5 }}>
                The map centered on the address, but the county parcel service couldn’t be reached for this area right now. Give it a moment, then click the lot or use <b>Select parcels</b>.
              </div>
            )}
          </div>
        )}

        {/* saved sites */}
        {sites.length > 0 && (
          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 1000, width: 232, background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 4px 18px rgba(28,25,20,0.14)", overflow: "hidden" }}>
            {/* collapsible header (B106): click to fold the panel to a slim bar; state persists per device */}
            <button onClick={toggleSitesPanel} title={sitesPanelOpen ? "Collapse the sites panel" : "Expand the sites panel"}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, padding: "9px 12px" }}>
              <span style={{ fontSize: 8, lineHeight: 1, transform: sitesPanelOpen ? "none" : "rotate(-90deg)", display: "inline-block" }}>▼</span>
              <span style={{ flex: 1, textAlign: "left" }}>Your sites</span>
              <span style={{ color: PAL.ink, fontWeight: 700 }}>{(statusFilter.size || nf) ? `${shownCount}/${sites.length}` : sites.length}</span>
            </button>
            {sitesPanelOpen && (<>
            {/* Type-to-filter the list by name (B235). */}
            <div style={{ padding: "0 8px 6px" }}>
              <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Filter by name…" aria-label="Filter sites by name"
                style={{ width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 12, border: `1px solid ${PAL.panelLine}`, borderRadius: 7, color: PAL.ink, background: "var(--surface-raised)", fontFamily: "inherit", outline: "none" }} />
            </div>
            {/* Status chips = POSITIVE multi-select filters (B235): tap to show only those
                statuses (list + map pins both). None selected = show everything. Colors +
                glyphs come from the shared status tokens (B234). */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 8px 8px" }}>
              {STATUSES.filter((st) => (statusCounts[st] || 0) > 0).map((st) => {
                const t = statusToken(st); const on = statusFilter.has(st); const anySel = statusFilter.size > 0; const n = statusCounts[st] || 0;
                return (
                  <button key={st} onClick={() => toggleStatusFilter(st)}
                    title={`${STATUS_META[st]?.label || st}: ${n} — ${on ? "click to remove from the filter" : "click to show only this status"}`}
                    style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 7px", borderRadius: 99, cursor: "pointer", fontFamily: "inherit",
                      fontSize: 10.5, fontWeight: 600, lineHeight: 1.3, border: `1px solid ${on ? t.color : PAL.panelLine}`,
                      background: on ? t.color : "var(--surface-raised)", color: on ? "#fff" : PAL.ink, opacity: anySel && !on ? 0.55 : 1, textDecoration: t.struck ? "line-through" : "none" }}>
                    <span style={{ color: on ? "#fff" : t.color, fontSize: 11 }}>{t.glyph}</span>
                    {STATUS_META[st]?.label || st}<span style={{ color: on ? "rgba(255,255,255,0.85)" : PAL.muted, fontWeight: 700 }}>{n}</span>
                  </button>
                );
              })}
            </div>
            {/* Collapsible status sections (B235). Active/Pursuit/On Hold expanded by
                default; Complete/Dead collapsed so settled projects go quiet. Headers
                use the shared status tokens (B234). */}
            <div style={{ maxHeight: 340, overflowY: "auto", paddingBottom: 4, borderTop: `1px solid ${PAL.panelLine}` }}>
              {(() => {
                if (shownCount === 0) return <div style={{ fontSize: 11.5, color: PAL.muted, padding: "10px 12px" }}>No sites match{nf ? ` “${nameFilter.trim()}”` : ""}.</div>;
                return STATUSES.filter((st) => statusFilter.size === 0 || statusFilter.has(st)).map((st) => {
                  const rows = sites.filter((s) => statusOf(s) === st && passName(s));
                  if (!rows.length) return null;
                  // While a name filter is active, force matching sections open so a
                  // match in a settled (collapsed) group isn't hidden (B235).
                  const t = statusToken(st); const collapsed = !!groupCollapsed[st] && !nf;
                  return (
                    <div key={st}>
                      <button onClick={() => toggleGroup(st)} title={collapsed ? "Expand" : "Collapse"}
                        style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "var(--surface-raised)", borderTop: `1px solid ${PAL.panelLine}`, borderLeft: "none", borderRight: "none", borderBottom: "none", cursor: "pointer", fontFamily: "inherit", padding: "5px 12px" }}>
                        <span style={{ fontSize: 8, lineHeight: 1, transform: collapsed ? "rotate(-90deg)" : "none", display: "inline-block", color: PAL.muted }}>▼</span>
                        <span style={{ color: t.color, fontSize: 11 }}>{t.glyph}</span>
                        <span style={{ flex: 1, textAlign: "left", fontSize: 11, fontWeight: 700, color: PAL.ink, textDecoration: t.struck ? "line-through" : "none" }}>{STATUS_META[st]?.label || st}</span>
                        <span style={{ color: PAL.muted, fontWeight: 700, fontSize: 11 }}>{rows.length}</span>
                      </button>
                      {!collapsed && rows.map(siteRow)}
                    </div>
                  );
                });
              })()}
            </div>
            </>)}
          </div>
        )}

        {/* imagery + labels + overlay layers control */}
        <div style={{ position: "absolute", top: 10, right: 10, zIndex: 1000, background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "6px 9px 8px", fontSize: 12, color: PAL.ink, boxShadow: "0 2px 8px rgba(0,0,0,0.12)", width: 228 }}>
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
            <LayerPanel overlays={overlays} setOverlays={setOverlays} county={viewCounty} layerStatus={layerStatus} coverage={coverage} />
          </div>
        </div>

        {/* error toast (bottom-left) — surfaced only when there's an error */}
        {err && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: PAL.accent, lineHeight: 1.45, pointerEvents: "none" }}>
            {err}
          </div>
        )}
        {/* statewide-backup notice (bottom-left) — the clicked lot was answered by the
            all-Texas TxGIO layer because the county's own server was down; be honest
            about provenance so a possibly-staler source is never mistaken for the
            county's own record (B244). */}
        {backupNotice && !err && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "rgba(255,250,240,0.96)", border: "1px solid #e6c478", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#8a5a00", lineHeight: 1.45 }}>
            <b>Statewide backup source.</b> {backupNotice.county} county’s own parcel server is unavailable, so this lot came from the all-Texas TxGIO layer — accurate for selection, but it may lag recent county updates.
          </div>
        )}
        {/* contextual selection guidance — only while actively selecting (not a persistent fixture) */}
        {!err && selectMode && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: "8px 11px", fontSize: 12.5, color: PAL.ink, lineHeight: 1.45, pointerEvents: "none" }}>
            {zoom != null && zoom < PARCEL_MINZOOM
              ? "Click any lot to add it (＋) — it works even before the purple outlines appear. Zoom in a little to see the lines."
              : "Click a lot to add it (＋). Hover an added lot and click to remove it (−). Add several, then Plan."}
          </div>
        )}
        {/* (B167) The idle "Drag to move the map" first-run bubble was removed entirely. */}

      </div>
      {/* Right-click context menu for a project — set its lifecycle stage (B7) or delete
          it (B168). One menu, not two: the status picker now also carries Delete, which
          routes through the existing confirmation modal (no single-click destruction).
          Opened from a card row OR a map marker/boundary. Positioned at the cursor,
          clamped to the viewport; the full-screen backdrop keeps it above all map layers. */}
      {statusMenu && (
        <div onClick={() => setStatusMenu(null)} onContextMenu={(e) => { e.preventDefault(); setStatusMenu(null); }}
          style={{ position: "fixed", inset: 0, zIndex: 4200 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ position: "fixed", left: Math.min(statusMenu.x, (typeof window !== "undefined" ? window.innerWidth : 1200) - 188),
              top: Math.min(statusMenu.y, (typeof window !== "undefined" ? window.innerHeight : 800) - 288),
              width: 180, background: "var(--surface-raised)", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.28)", overflow: "hidden", padding: "4px 0" }}>
            <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 12px 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statusMenu.site.site || statusMenu.site.name || "Site"}</div>
            {STATUSES.map((st) => {
              const t = statusToken(st); const cur = statusOf(statusMenu.site) === st;
              return (
                <button key={st} onClick={() => setStatus(statusMenu.site.id, st)}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                    background: cur ? "#fbf3ee" : "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: cur ? 700 : 500, textDecoration: t.struck ? "line-through" : "none" }}>
                  <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", borderRadius: 99,
                    border: `1.5px solid ${t.color}`, background: t.hollow ? "var(--surface-raised)" : t.color, color: t.hollow ? t.color : "#fff", fontSize: 9, lineHeight: 1 }}>{t.glyph}</span>
                  <span style={{ flex: 1 }}>{STATUS_META[st]?.label || st}</span>
                  {cur && <span style={{ color: PAL.accent, fontWeight: 800 }}>✓</span>}
                </button>
              );
            })}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "4px 0" }} />
            <button onClick={() => { const s = statusMenu.site; setStatusMenu(null); setConfirmDel(s); }}
              title="Delete this project and all its plans"
              style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", lineHeight: 0 }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </span>
              <span style={{ flex: 1 }}>Delete project…</span>
            </button>
          </div>
        </div>
      )}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(20,18,15,0.5)", display: "grid", placeItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface-raised)", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", padding: 20, width: 340, maxWidth: "92vw" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: PAL.ink, marginBottom: 6 }}>Delete this site?</div>
            <div style={{ fontSize: 12.5, color: PAL.muted, lineHeight: 1.5, marginBottom: 16 }}>“{confirmDel.site || confirmDel.name || "this site"}” and all of its plans will be removed. This can't be undone.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="gbtn" style={{ padding: "8px 14px", fontSize: 12.5, borderRadius: 8, border: `1px solid ${PAL.panelLine}`, background: "var(--surface-raised)", color: PAL.ink, cursor: "pointer", fontWeight: 600 }} onClick={() => setConfirmDel(null)}>Cancel</button>
              <button style={{ padding: "8px 14px", fontSize: 12.5, borderRadius: 8, border: "1px solid #b91c1c", background: "#b91c1c", color: "#fff", cursor: "pointer", fontWeight: 600 }} onClick={() => { onDeleteSite && onDeleteSite(confirmDel.id); setConfirmDel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
