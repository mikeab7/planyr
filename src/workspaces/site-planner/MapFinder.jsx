import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { COUNTIES, COUNTIES_MAP, candidateCountiesForPoint, STATEWIDE_KEYS, SNAPSHOT_COUNTIES } from "./lib/counties.js";
import { ensureSnapshot, getSnapshot, snapshotVintage, onSnapshotChange, featureAtPoint } from "./lib/parcelSnapshot.js";
import { recordSourceResult, filterHealthyCandidates, isSourceOpen, isStatewideBackup } from "./lib/sourceHealth.js";
import { syncOverlayLayers, withTileRetry, ALL_LAYERS, probeService } from "./lib/layers.js";
import { BASEMAPS } from "./lib/basemaps.js";
import { prefetchExtents, computeCoverage, boundsFromLeaflet, getNearbyRadiusMiles, subscribeRelevance } from "./lib/coverage.js";
import LayerPanel from "./components/LayerPanel.jsx";
import {
  resolveLayerUrl,
  identifyParcelEager,
  outerRingsLngLat,
  geoJsonToEsriFeature,
  lngLatRingToFeet,
  feetToLatLng,
  aerialPlacement,
  humanizeError,
} from "./lib/arcgis.js";
import { elStyle, elRingFeet, byZ } from "./lib/planStyle.js";
import { siteToFeatures, buildKmz, kmzFilename, KMZ_MIME } from "./lib/kmzExport.js";
import { STATUSES, STATUS_META, statusOf } from "./lib/siteModel.js";
import { countyAtPoint } from "./lib/jurisdiction.js";
import { apprRows, apprVal, findAttr } from "./lib/appraisal.js";
import { makeParcelDisplayLayer, makeSnapshotLayer, PARCEL_MINZOOM, ADD_CURSOR, REMOVE_CURSOR } from "./lib/parcelDisplay.js";
import { geocodeAddress } from "./lib/geocode.js";
import { statusToken, darken } from "../../shared/ui/statusTokens.js";
import { shareProject, makeProjectPrivate } from "./lib/sharing.js";
import { listMyTeams, currentIdentity } from "./lib/teams.js";

// Theme tokens (var(--…)) — MapFinder is DOM/inline-style only, so CSS vars resolve
// and the panel themes live with no re-render. (B318)
const PAL = {
  panelBg: "var(--surface-raised)", panelLine: "var(--border-default)", ink: "var(--text-primary)",
  accent: "var(--accent)", muted: "var(--text-secondary)",
  chrome: "var(--chrome-bg)", chromeLine: "var(--chrome-divider)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)", ember: "var(--accent)",
};

// The aerial-source registry (BASEMAPS) lives in lib/basemaps.js (B689) — it's shared
// with the planner's Basemap control so both surfaces always offer the same sources.
// Its B220 rule travels with it: every source carries `maxNative`, and the imagery
// layer below clamps fetches to that ceiling (minus the retina offset).
// Subtle road/place labels overlay (drawn faint over the imagery).
const LABELS_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

// Parcel-outline display + the +/− cursors are shared with the in-planner "Add parcel"
// tool (lib/parcelDisplay.js) so both surfaces light up parcels identically.

/* Project-status visual language — color + glyph + shape per state come from the
 * ONE shared token set (src/shared/ui/statusTokens.js), consumed identically by the
 * filter chips, the list-item markers, and the map pins below (B234). Two redundant
 * cues per state (color AND glyph/shape) so it still reads for colorblind users and
 * over a busy aerial. The module accent colors (Site/Schedule/Markup) are
 * deliberately NOT used here — they belong to the tab row. */

// The status glyph as an inline WHITE SVG (crisp at every size/zoom + on retina;
// never raster). Keyed off the token `shape`, drawn CENTERED on (cx,cy) so it sits
// dead-center in the bulb. Only the SETTLED stages carry a glyph (the colorblind-safe
// second cue); Pursuit and Active are glyphless solid discs — color + size + the
// ground-ring progress sweep distinguish them (B433). "" → no glyph.
function statusGlyph(shape, cx, cy) {
  const n = (v) => +v.toFixed(2);
  switch (shape) {
    case "pause":   // On hold — two bars.
      return `<rect x="${n(cx - 3.3)}" y="${n(cy - 5)}" width="2.6" height="10" rx="1" fill="#fff"/><rect x="${n(cx + 0.7)}" y="${n(cy - 5)}" width="2.6" height="10" rx="1" fill="#fff"/>`;
    case "check":   // Complete.
      return `<polyline points="${n(cx - 5)},${n(cy - 0.3)} ${n(cx - 1.6)},${n(cy + 3.4)} ${n(cx + 5.4)},${n(cy - 4.4)}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
    case "x":       // Dead (only shown when explicitly surfaced).
      return `<path d="M${n(cx - 3.4)},${n(cy - 3.4)} L${n(cx + 3.4)},${n(cy + 3.4)} M${n(cx + 3.4)},${n(cy - 3.4)} L${n(cx - 3.4)},${n(cy + 3.4)}" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`;
    default: return "";
  }
}

// Progress fraction per status (Path B — DERIVED from status until a real
// progress_pct column lands, B161/B163). The retired building marker drew this as an
// arc ring; the precision pin folds the SAME source into the ground ring (B434).
const STATUS_PROGRESS = { pursuit: 0.10, active: 0.60, onhold: 0.30, complete: 1.00, dead: 0 };

/* Status map pin (B434) — the "precision pin": a small color BULB on a short vertical
 * STALK seated over a GROUND RING (a survey-monument read). The ground-ring CENTER is
 * the anchor — it sits exactly on the site coordinate (it replaces the old building/
 * shield bottom-tip anchor). Kept constant across states so it always reads as a site;
 * only the bulb FILL color, the glyph, the size tier, the opacity, and the ground-ring
 * progress sweep vary — and they vary WITH importance (Pursuit loudest/largest → Dead
 * quietest/smallest; statusTokens.js).
 *  • SOLID bulb + a WHITE keyline (the white disc/halo behind it) — the standing rule:
 *    never a transparent/hollow primary marker on the aerial (B433). A soft white halo
 *    on every stroke keeps it legible over both bright (tan/developed) and dark (water/
 *    forest) tiles; no drop-shadow (it flashes on re-render) EXCEPT a single subtle one
 *    on the open site.
 *  • PROGRESS folds into the ground ring: it sweeps 0–100% clockwise from 12 o'clock
 *    (pursuit 10 · active 60 · onhold 30 · complete 100 · dead 0) — the same source the
 *    retired building arc used. A faint full track keeps the ring readable at 0%.
 *  • A FIXED hit box for every state → the anchor never drifts when status/size change.
 *    The ground-ring center sits at the viewBox bottom edge, so it maps to the hit-box
 *    bottom-center (the iconAnchor) at EVERY size tier; its lower half overflows below.
 *  • The glyph (‖/✓/✕) rides inside the bulb as the colorblind-safe second cue; Pursuit
 *    and Active are glyphless solid discs (color + size + sweep carry them).
 * `active` = the currently-open site (a small size bump + a subtle drop-shadow + top z). */
function sitePinIcon(status, active) {
  const t = statusToken(status);
  // Fixed hit box ≥ the old tap target (~32×41) so it never regresses when the art shrinks.
  const HIT_W = 34, HIT_H = 46;
  // Size tracks importance; the open site gets a small bump (1.15×) on top of its tier.
  const vs = 0.80 * (t.tier || 1) * (active ? 1.15 : 1);
  const w = +(26 * vs).toFixed(1), h = +(34 * vs).toFixed(1);
  const op = t.mapOpacity ?? 1;
  const halo = t.halo || 2;
  const col = t.color, edge = darken(col, 0.26);
  // viewBox 0 0 26 34. Ground-ring center = (13, 34) (bottom edge) so it maps to the
  // hit-box bottom-center for every tier; bulb up top, stalk between.
  const CX = 13, BULB_CY = 10.5, BULB_R = 6.8, RING_CY = 34, RING_R = 5;
  const STALK_TOP = +(BULB_CY + BULB_R - 0.5).toFixed(2);  // bulb bottom
  const STALK_BOT = +(RING_CY - RING_R + 0.4).toFixed(2);  // ring top
  const pct = STATUS_PROGRESS[status] ?? 0;
  const C = +(2 * Math.PI * RING_R).toFixed(2);
  const sweep = +(C * pct).toFixed(2);
  // White keyline/halo underlay for the whole silhouette → legible over any imagery.
  const whiteHalo =
    `<circle cx="${CX}" cy="${BULB_CY}" r="${(BULB_R + halo).toFixed(1)}" fill="#fff"/>` +
    `<line x1="${CX}" y1="${STALK_TOP}" x2="${CX}" y2="${STALK_BOT}" stroke="#fff" stroke-width="${(2.4 + halo).toFixed(1)}" stroke-linecap="round"/>` +
    `<circle cx="${CX}" cy="${RING_CY}" r="${RING_R}" fill="none" stroke="#fff" stroke-width="${(2 + halo).toFixed(1)}"/>`;
  const stalk = `<line x1="${CX}" y1="${STALK_TOP}" x2="${CX}" y2="${STALK_BOT}" stroke="${col}" stroke-width="2.4" stroke-linecap="round"/>`;
  // Ground ring: a faint full track (so the ring still reads at 0%) + the progress arc.
  const ringTrack = `<circle cx="${CX}" cy="${RING_CY}" r="${RING_R}" fill="none" stroke="${col}" stroke-width="2" opacity="0.32"/>`;
  const ringSweep = sweep > 0
    ? `<circle cx="${CX}" cy="${RING_CY}" r="${RING_R}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-dasharray="${sweep} ${C}" transform="rotate(-90 ${CX} ${RING_CY})"/>`
    : "";
  // Bulb: solid fill + a thin same-hue edge for crispness; the white disc behind is the
  // white keyline. The glyph (settled stages only) rides centered inside the bulb.
  const bulb = `<circle cx="${CX}" cy="${BULB_CY}" r="${BULB_R}" fill="${col}" stroke="${edge}" stroke-width="0.6"/>`;
  const shapeSvg = whiteHalo + stalk + ringTrack + ringSweep + bulb + statusGlyph(t.shape, CX, BULB_CY);
  // overflow:visible so the halo + the ground ring's lower half aren't clipped.
  const shadow = active ? "filter:drop-shadow(0 1px 2px rgba(0,0,0,0.38));" : "";
  const html =
    `<div style="position:relative;width:${HIT_W}px;height:${HIT_H}px;opacity:${op};${shadow}">` +
    `<svg width="${w}" height="${h}" viewBox="0 0 26 34" ` +
    `style="position:absolute;left:${((HIT_W - w) / 2).toFixed(1)}px;bottom:0;overflow:visible">` +
    shapeSvg +
    `</svg></div>`;
  return L.divIcon({
    className: "",
    html,
    iconSize: [HIT_W, HIT_H],
    iconAnchor: [HIT_W / 2, HIT_H],
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

// Curated "key appraisal attributes" matchers for the search info card (B233) —
// the headline facts beyond address/account that help identify a tract at a glance.
const OWNER_RE = /^(owner|own_?name|owner_?name|name|owner1)$/i;

export default function MapFinder({ visible, isActive = true, overlays, setOverlays, layerStatus = {}, setLayerStatus, sites = [], activeSiteId, onOpenSite, onDeleteSite, onSetStatus, onRenameSite, onSharedChange, onUseParcels, onSkip }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const addrTokRef = useRef(0); // B545: address-search generation — a newer search invalidates an older in-flight one
  const displaysRef = useRef({});    // county -> visible parcel-line layer (all CAD counties)
  const sitesLayerRef = useRef(null); // saved-site footprints
  const pressedRef = useRef(false);        // a pointer is currently down on the map (B64)
  const pendingRebuildRef = useRef(null);  // a saved-site rebuild deferred until pointer-up (B64)
  const onOpenSiteRef = useRef(onOpenSite);
  useEffect(() => { onOpenSiteRef.current = onOpenSite; }, [onOpenSite]);
  const onSetStatusRef = useRef(onSetStatus);
  useEffect(() => { onSetStatusRef.current = onSetStatus; }, [onSetStatus]);
  const onRenameSiteRef = useRef(onRenameSite);
  useEffect(() => { onRenameSiteRef.current = onRenameSite; }, [onRenameSite]);
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
  // Phone-width responsive mode (mirrors the planner's B113 ≤760px breakpoint). On a phone
  // the desktop layout's three top panels (search pill, sites list, layers) sit side-by-side
  // and overlap — covering the "Select parcels" button — so narrow mode reflows them into a
  // full-width search bar with the two side panels collapsed to taps below it.
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia("(max-width: 760px)").matches; } catch (_) { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(max-width: 760px)"); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.addEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  // Sites panel: collapsible (persisted) + per-row hover-reveal of the crosshair/delete actions (B106).
  // On a phone it defaults CLOSED (owner request) so the map isn't buried under the list on open.
  const [sitesPanelOpen, setSitesPanelOpen] = useState(() => {
    try { if (window.matchMedia("(max-width: 760px)").matches) return false; } catch (_) {}
    try { return localStorage.getItem("planarfit:sitesPanelClosed:v1") !== "1"; } catch (_) { return true; }
  });
  const toggleSitesPanel = () => setSitesPanelOpen((v) => { const n = !v; try { localStorage.setItem("planarfit:sitesPanelClosed:v1", n ? "0" : "1"); } catch (_) {} return n; });
  // Layers/imagery panel: on a phone it collapses to a tap (default closed) so it stops
  // covering the search bar; desktop keeps it always-open as before.
  const [layersPanelOpen, setLayersPanelOpen] = useState(() => { try { return !window.matchMedia("(max-width: 760px)").matches; } catch (_) { return true; } });
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
  const [mapMenu, setMapMenu] = useState(null);       // {x, y} — right-click-on-empty-map menu (KMZ export) (B684)
  const [hoverLL, setHoverLL] = useState(null);       // {lat, lng} — live "you are here" GPS readout (B683)
  const [renaming, setRenaming] = useState(null);     // {id, name} — the site row being inline-renamed (B158)
  const skipRenameBlurRef = useRef(false);            // Esc cancels without the trailing blur committing
  const [parcelInfo, setParcelInfo] = useState(null); // {status:'found'|'none'|'unavailable', label, addr, acct, acres, attrs, county, key, backup} — address-search result (B233)
  const [backupNotice, setBackupNotice] = useState(null); // {county} — set when a click was answered by the statewide backup because the county's own server was down (B244)
  const [cachedNotice, setCachedNotice] = useState(null); // {county, asOf} — set when a click was answered by the Drive PARCEL SNAPSHOT because the live county server was unreachable (B629)
  // overlays / setOverlays are app-shared (lifted to App) so toggles reflect on both pages.
  const overlayRefs = useRef({}); // key -> live esri dynamicMapLayer (this map's instances)
  const [coverage, setCoverage] = useState({}); // id -> "in"|"out"|"unknown" (NEW-1; picker-only)
  const [selected, setSelected] = useState([]); // [{key, rings:[[ [lon,lat],…] ], latlngsList:[[ [lat,lng],…] ], addr, acct, attrs, county}] — rings = every outer part (multipart-safe)
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const toggleStatusFilter = (st) => setStatusFilter((h) => { const n = new Set(h); n.has(st) ? n.delete(st) : n.add(st); return n; });
  const toggleGroup = (st) => setGroupCollapsed((c) => { const n = { ...c, [st]: !c[st] }; try { localStorage.setItem("planarfit:sitesGroups:v1", JSON.stringify(n)); } catch (_) {} return n; });
  // Apply a status to a site (group), then refresh — closes the right-click menu.
  const setStatus = (siteId, st) => { onSetStatusRef.current && onSetStatusRef.current(siteId, st); setStatusMenu(null); };
  // Commit an inline site rename (B158): trim, ignore an empty/unchanged name, persist via the
  // group-rename flow threaded from SitePlannerApp. Cancel just clears the editor.
  const commitRename = (id, raw, original) => {
    const name = (raw || "").trim();
    setRenaming(null);
    if (name && name !== original) onRenameSiteRef.current && onRenameSiteRef.current(id, name);
  };
  const cancelRename = () => { skipRenameBlurRef.current = true; setRenaming(null); };

  // ── Team sharing (share a project with a team) ──────────────────────────────
  const [myUid, setMyUid] = useState(null);
  const [myTeams, setMyTeams] = useState([]);
  const [shareBusy, setShareBusy] = useState(false);
  const teamName = (id) => { const t = myTeams.find((x) => x.id === id); return t ? t.name : "a team"; };
  const refreshTeams = async () => {
    const { uid } = await currentIdentity();
    setMyUid(uid);
    if (!uid) { setMyTeams([]); return; }
    try { setMyTeams(await listMyTeams()); } catch (_) { /* keep prior list on transient error */ }
  };
  useEffect(() => { let live = true; (async () => { const { uid } = await currentIdentity(); if (!live) return; setMyUid(uid); if (uid) { try { const t = await listMyTeams(); if (live) setMyTeams(t); } catch (_) {} } })(); return () => { live = false; }; }, []);
  // Open the per-project menu and refresh the team list so newly-created teams appear.
  const openSiteMenu = (s, x, y) => { setStatusMenu({ site: s, x, y }); refreshTeams(); };
  // Escape closes the open project menu, matching click-outside (B158 acceptance:
  // the right-click menu dismisses on click-outside, Escape, or selecting an option).
  useEffect(() => {
    if (!statusMenu) return;
    const onKey = (e) => { if (e.key === "Escape") setStatusMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [statusMenu]);
  // Escape also closes the right-click map (KMZ export) menu.
  useEffect(() => {
    if (!mapMenu) return;
    const onKey = (e) => { if (e.key === "Escape") setMapMenu(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mapMenu]);
  // Export the sites currently on the map — plus any selected parcels — to a Google Earth .kmz
  // (B684). Each visible site becomes its own folder; its boundary + drawn layout are reprojected
  // to WGS84 via the SAME feetToLatLng the map render uses (KML is lon,lat, so we flip [lat,lng]).
  // Selected parcels are already lon/lat. Honors the status-chip filter. LOUD-FAILURE: siteToFeatures
  // throws on a non-finite reprojection → caught, surfaced via setErr, no partial file written.
  const exportSitesKmz = (extrude = false) => {
    setMapMenu(null);
    try {
      const projectFor = (o) => (pt) => { const [la, ln] = feetToLatLng(pt, o.lat, o.lon); return [ln, la]; };
      const features = [];
      sites.forEach((site) => {
        if (!site.origin) return;
        const status = statusOf(site);
        if (statusFilter.size && !statusFilter.has(status)) return;   // honor the chip filter (matches the map)
        if (status === "dead" && !statusFilter.has("dead")) return;   // dead recedes unless filtered to (B365)
        features.push(...siteToFeatures(site, projectFor(site.origin), { extrudeBuildings: extrude, prefix: [site.site || site.name || "Site"] }));
      });
      selected.forEach((sp, i) => {
        (sp.rings || []).forEach((ring) => {
          if (!ring || ring.length < 3) return;
          const closed = ring.map(([lon, lat]) => [lon, lat]);
          const a = closed[0], b = closed[closed.length - 1];
          if (a[0] !== b[0] || a[1] !== b[1]) closed.push([a[0], a[1]]);
          features.push({ geom: "polygon", name: sp.addr || sp.acct || `Parcel ${i + 1}`, folder: ["Selected parcels"], rings: [closed], style: { line: "#0E7490", fill: "#0E7490", fillOpacity: 0.08 } });
        });
      });
      if (!features.length) { setErr("Nothing to export yet — save a site or select a parcel first."); return; }
      const blob = new Blob([buildKmz("Planyr sites", features)], { type: KMZ_MIME });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = kmzFilename("planyr-sites");
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (e) {
      setErr(`Couldn't build the Google Earth file: ${(e && e.message) || "unexpected error"}.`);
    }
  };
  // Share a project (site group) with a team, or make it private again (teamId=null).
  const doShare = async (site, teamId) => {
    const gid = site.groupId || site.id;
    setShareBusy(true);
    const r = teamId ? await shareProject(gid, teamId) : await makeProjectPrivate(gid);
    setShareBusy(false);
    setStatusMenu(null);
    if (!r || !r.ok) { setErr((r && r.error) || "Couldn't update sharing."); return; }
    if (teamId && r.sites === 0) { setErr("This project isn't in the cloud yet — open it once to sync, then share."); return; }
    onSharedChange && onSharedChange();
  };
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
    // Phone: the full-width search bar now owns the top-left, so move the +/- zoom control
    // to the bottom-left (clear there) instead of leaving it half-hidden behind the bar.
    // Desktop is unchanged (top-left, where the Your-sites panel sits over it as before).
    const phone = (() => { try { return window.matchMedia("(max-width: 760px)").matches; } catch (_) { return false; } })();
    const map = L.map(elRef.current, { zoomControl: false, minZoom: 8, maxZoom: 21 }).setView(cfg.center, cfg.zoom);
    L.control.zoom({ position: phone ? "bottomleft" : "topleft" }).addTo(map);
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
    // Live "you are here" GPS readout (B683): the cursor's WGS84 lat/long, coalesced to one
    // update per animation frame so a fast mousemove can't thrash React. Cleared on mouse-out.
    let llLatest = null, llPending = false;
    const onCoordMove = (e) => {
      llLatest = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (llPending) return;
      llPending = true;
      requestAnimationFrame(() => { llPending = false; if (llLatest) setHoverLL(llLatest); });
    };
    const onCoordOut = () => setHoverLL(null);
    // Right-click on EMPTY map → the KMZ export menu (B684). A right-click ON a site keeps its own
    // status menu: skip when the DOM target is an interactive site layer / marker, so the two never fight.
    const onMapCtx = (e) => {
      const oe = e.originalEvent;
      if (oe && oe.target && oe.target.closest && oe.target.closest(".leaflet-interactive, .leaflet-marker-pane")) return;
      if (oe) { oe.preventDefault(); oe.stopPropagation(); }
      setStatusMenu(null);
      setMapMenu({ x: (oe && oe.clientX) || 0, y: (oe && oe.clientY) || 0 });
    };
    map.on("click", onClick);
    map.on("zoomend", onZoom);
    map.on("moveend", onMove);
    map.on("mousemove", onMouseMove);
    map.on("mousemove", onCoordMove);
    map.on("mouseout", onCoordOut);
    map.on("contextmenu", onMapCtx);
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
    return () => { map.off("click", onClick); map.off("zoomend", onZoom); map.off("moveend", onMove); map.off("mousemove", onMouseMove); map.off("mousemove", onCoordMove); map.off("mouseout", onCoordOut); map.off("contextmenu", onMapCtx); map.off("dragstart", onDragStart); map.off("dragend", onDragEnd); containerEl.removeEventListener("pointerdown", onPress); containerEl.removeEventListener("pointerup", onRelease); containerEl.removeEventListener("pointercancel", onRelease); map.remove(); mapRef.current = null; };
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
      // Boundary hover/click identify (B691) — read live per event; parcel-select mode
      // owns the map's clicks, so the identify yields while it's on (the B98 rule).
      identifyOk: () => !selectModeRef.current,
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

  /* keep the map sized correctly when shown after being hidden — both when the Site
     workspace flips map↔plan (`visible`) AND when the whole workspace returns from a
     hidden keep-alive tab (`isActive`: Leaflet sized itself at 0×0 while display:none). */
  useEffect(() => {
    if (visible && isActive && mapRef.current) {
      const t = setTimeout(() => mapRef.current && mapRef.current.invalidateSize(), 60);
      return () => clearTimeout(t);
    }
  }, [visible, isActive]);

  /* Returning to the map (e.g. after committing parcels and planning) clears any
     committed selection and exits select-parcels mode back to the normal map.
     Deliberately keyed on `visible` (the map↔plan MODE flip) only — NOT `isActive` —
     so peeking at another module tab and coming back never wipes a parcel selection. */
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
        const marker = L.marker([lat, lon], { icon: sitePinIcon(status, active), interactive: !selectMode, keyboard: false, zIndexOffset: zBase, riseOnHover: true });
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

  // How long to wait for a county's outline layer to actually draw before treating its
  // CAD host as hung. A live host (HCAD/TxGIO) answers in ~2s; FBCAD's whole server has
  // gone dark for 15s+ at a stretch (B244, recurred 2026-06-22) with the outline layer
  // — which, unlike the click path, had no timeout — spinning "forever". Past this we
  // drop the dead layer, lean on the always-present statewide TxGIO outlines for that
  // ground, and remember the host is failing so CLICKS skip it too (keeping what you
  // SEE and what you can SELECT the same source — the B137 rule).
  const DISPLAY_LOAD_TIMEOUT_MS = 8000;

  // Lazily add a county's visible parcel-outline layer (zoom-gated). Skips a county
  // whose CAD breaker is already open (its tiles would only hang); the statewide TxGIO
  // outline layer still covers that area. Idempotent per county.
  const addDisplay = (key) => {
    const map = mapRef.current;
    if (!map || displaysRef.current[key]) return;

    // B629 — prefer the Drive PARCEL SNAPSHOT when this county's cached copy is loaded: a reliable
    // local vector layer that renders outlines AND (via optimisticHitAt, which iterates its
    // eachFeature) selects a lot even with the county server fully down. Served from the browser,
    // so no network + no hang-guard. This is what makes Chambers/Waller keep working during a TxGIO
    // outage. (Fort Bend, Tier B, is tiled — Phase 2 — and has no whole-county snapshot loaded.)
    if (SNAPSHOT_COUNTIES.has(key) && getSnapshot(key)) {
      const snapLayer = makeSnapshotLayer(key);
      snapLayer.addTo(map);
      displaysRef.current[key] = snapLayer;
      return;
    }

    const url = layerUrlsRef.current[key];
    if (!url) return;
    const statewide = STATEWIDE_KEYS.includes(key);
    // A county we already know is down: don't add a layer that will only spin — the
    // statewide outlines cover it. Never skip the statewide source itself (the
    // universal fallback).
    if (!statewide && isSourceOpen(key)) return;

    // The statewide TxGIO source has its /query disabled upstream, so its vector layer
    // draws nothing; makeParcelDisplayLayer renders it as a server /export image overlay
    // instead (real, queryable CADs stay vector — which also backs the instant click
    // highlight). What you SEE stays == what you can SELECT (the B137 rule): the click
    // path (queryAtPoint) has the matching /query→/identify fallback.
    const fl = makeParcelDisplayLayer(url);
    fl.addTo(map);
    displaysRef.current[key] = fl;
    // The statewide TxGIO layer is the UNIVERSAL fallback — let it load even when it's
    // slow, and NEVER pull it on a hiccup. A slow statewide outline still beats no
    // outline (that "took a while to load but worked" wait IS this layer); removing it
    // would leave the user with nothing to see OR click. Only a real county layer gets
    // the hang-guard below.
    if (statewide) {
      fl.on("requesterror", () => setErr("Statewide parcel outlines are slow right now — clicking a lot still adds it."));
      return;
    }

    let settled = false; // health of this county layer's first real draw, decided once
    let timer = null;
    const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const markDown = () => {
      if (settled) return; settled = true; stopTimer();
      // A real county's outline request hung/errored → pull the dead layer (so the map
      // stops spinning), record the host as failing so CLICKS skip it too, and rely on
      // the TxGIO statewide outlines for this area (keep what you SEE == what you can
      // SELECT, the B137 rule).
      try { map.removeLayer(fl); } catch (_) {}
      delete displaysRef.current[key];
      recordSourceResult(key, false);
      setErr("That county's parcel server is slow right now — showing statewide outlines; clicking a lot still adds it.");
    };
    // Arm the hang-timer only once a request to the host is actually in flight, so we
    // never false-flag a county just because we're zoomed out below the outline zoom
    // (no request made). A live host fires 'load' well within the window.
    fl.on("requeststart", () => { if (!settled && !timer) timer = setTimeout(markDown, DISPLAY_LOAD_TIMEOUT_MS); });
    fl.on("load", () => { if (!settled) { settled = true; stopTimer(); } }); // drew fine — healthy
    fl.on("requesterror", markDown);
  };
  const clearDisplays = () => {
    const map = mapRef.current;
    Object.values(displaysRef.current).forEach((fl) => { try { map && map.removeLayer(fl); } catch (_) {} });
    displaysRef.current = {};
  };
  const removeDisplay = (key) => {
    const map = mapRef.current;
    const fl = displaysRef.current[key];
    if (fl) { try { map && map.removeLayer(fl); } catch (_) {} delete displaysRef.current[key]; }
  };

  // B629 — the Phase-1 client-loaded (whole-county) snapshot counties. Chambers + Waller ride the
  // flaky State/TxGIO service and are small enough to hold whole in the browser. Fort Bend (Tier B)
  // is tiled — Phase 2 — so it is NOT warmed/whole-loaded here.
  const CLIENT_SNAPSHOT_COUNTIES = ["chambers", "waller"];

  /* When a county's Drive snapshot finishes loading/refreshing (first IndexedDB hydrate or a fresh
     nightly copy), swap its on-map display to the snapshot vector layer so outlines + clicks come
     from the reliable local copy. If it's already the snapshot layer, it self-refreshes. */
  useEffect(() => {
    const off = onSnapshotChange((county) => {
      if (!selectModeRef.current || !mapRef.current) return;
      const cur = displaysRef.current[county];
      if (cur && cur._isSnapshot) return; // already the snapshot layer (self-refreshing)
      removeDisplay(county);
      addDisplay(county);
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* enter/leave select mode: show all counties' outlines, set the +/− cursor,
     enable click-to-identify. */
  useEffect(() => {
    selectModeRef.current = selectMode;
    const map = mapRef.current;
    if (!map) return;
    // Flag select mode on the container so the boundary overlays' interactive fills
    // (`.pf-boundary-hit`, B691) drop Leaflet's pointer cursor and inherit the +/−
    // parcel cursor — the tool owns the cursor, not the fill (see index.css).
    try { map.getContainer().classList.toggle("pf-select-mode", !!selectMode); } catch (_) {}
    if (selectMode) {
      // Warm the cached parcel snapshots (instant from IndexedDB, SWR-refresh from Drive) so a
      // county whose live server is down still draws + clicks from the local copy (B629).
      CLIENT_SNAPSHOT_COUNTIES.forEach((c) => { ensureSnapshot(c).catch(() => {}); });
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

  /* B441 — find the parcel outline already DRAWN under a click, with zero network.
     The county display layers (makeParcelLayer) are esri-leaflet vector featureLayers,
     so the lot under the cursor is already client-side geometry; we hit-test it to
     paint an instant optimistic highlight before the (variable, often multi-second)
     county identify even starts. Prefers a real county's outline over the statewide
     TxGIO backup (mirrors identify's source priority), then the tighter parcel when
     several overlap. Returns a hit shaped like an identify hit ({county, feature}) or
     null when nothing's loaded under the point (→ fall back to await-identify). */
  const pointInLngLatRing = (lng, lat, ring) => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
      if (((yi > lat) !== (yj > lat)) && (lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  };
  const optimisticHitAt = (latlng) => {
    let best = null; // { county, feature(esri), acres, real }
    for (const [county, fl] of Object.entries(displaysRef.current)) {
      if (!fl || typeof fl.eachFeature !== "function") continue;
      const real = !STATEWIDE_KEYS.includes(county);
      fl.eachFeature((layer) => {
        // Cheap bbox reject first — only convert/test the 1-3 features that could contain it.
        try { if (layer.getBounds && !layer.getBounds().contains(latlng)) return; } catch (_) { return; }
        const esri = geoJsonToEsriFeature(layer.feature);
        if (!esri) return;
        const parts = outerRingsLngLat(esri); // [[lon,lat]…] per outer tract (multipart-safe)
        if (!parts.length || !parts.some((p) => pointInLngLatRing(latlng.lng, latlng.lat, p))) return;
        const acres = ringsAcres(parts) ?? Infinity;
        if (!best || (!best.real && real) || (best.real === real && acres < best.acres))
          best = { county, feature: esri, acres, real };
      });
    }
    return best ? { county: best.county, feature: best.feature } : null;
  };

  // A click inside an ALREADY-highlighted parcel → its key (for an instant local
  // toggle-off, no network). Tests the live highlight geometry via selectedRef.
  const selectedHitAt = (latlng) => {
    const rec = selectedRef.current.find((s) => (s.latlngsList || []).some((ll) => pointInPoly(latlng.lat, latlng.lng, ll)));
    return rec ? rec.key : null;
  };

  // Undo an optimistic highlight + its provisional selection record (used when the
  // authoritative identify disagrees, finds nothing, or errors). Visibly legible: the
  // flashed highlight vanishes rather than stranding a mismatched outline (B441 rule).
  const rollbackHit = (key) => {
    if (hilitesRef.current[key]) { try { mapRef.current.removeLayer(hilitesRef.current[key]); } catch (_) {} delete hilitesRef.current[key]; }
    setSelected((s) => s.filter((x) => x.key !== key));
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
      .map((county) => ({ county, url: layerUrlsRef.current[county], statewide: STATEWIDE_KEYS.includes(county) }))
      .filter((c) => c.url);
    const realPrimaries = all.filter((c) => !STATEWIDE_KEYS.includes(c.county));
    return { candidates: filterHealthyCandidates(all, STATEWIDE_KEYS), realPrimaries };
  };
  // A statewide-backup answer reports the parcel's true county in its `county` attr
  // ("FORT BEND"); title-case it for the badge, or fall back to a generic phrase.
  const titleCase = (s) => String(s || "").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
  const backupCountyLabel = (attrs) => { const c = findAttr(attrs, /^county$/i); return c ? titleCase(c) : "This county"; };
  // " · as of Jul 3, 2026" from a snapshot's generatedAt ISO string, or "" when unknown. Pure.
  const fmtAsOf = (iso) => { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? ` · as of ${d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}` : ""; };

  // B629 — the parcel under a point from any LOADED Drive snapshot, shaped like an identify hit
  // ({county, feature}), or null. The last-resort answer when every live source is unreachable.
  const snapshotHitAt = (lng, lat) => {
    for (const c of SNAPSHOT_COUNTIES) {
      const snap = getSnapshot(c);
      if (!snap) continue;
      const feature = featureAtPoint(snap.features, lng, lat);
      if (feature) return { county: c, feature };
    }
    return null;
  };

  const handleClick = async (latlng) => {
    // Auto-route: figure out which configured county/counties could contain this
    // point, then identify against each one's CAD service and use whatever answers.
    // No county pre-selection required; a border straddle queries both and we take
    // the first hit. Candidates with an unresolved URL (service still loading or
    // down), or a primary whose breaker is open, are skipped this click.
    const { candidates, realPrimaries } = resolveCandidates(latlng);
    if (!candidates.length) { setErr("Parcel services are still loading — give it a second and click again."); return; }
    setErr(""); setBackupNotice(null); setCachedNotice(null);

    // Instant local toggle-off: a click inside an already-highlighted parcel deselects
    // it with zero network round-trip — we already have its geometry (B441).
    const selKey = selectedHitAt(latlng);
    if (selKey && hilitesRef.current[selKey]) {
      mapRef.current.removeLayer(hilitesRef.current[selKey]);
      delete hilitesRef.current[selKey];
      setSelected((s) => s.filter((x) => x.key !== selKey));
      return;
    }

    // B441 — optimistic highlight: paint the outline under the cursor NOW, from the
    // already-loaded county display layer, before the (variable, often multi-second)
    // county identify even starts. That network wait was the lag the owner felt; the
    // authoritative identify below confirms it (filling real attrs) or corrects it.
    let optKey = null;
    const opt = optimisticHitAt(latlng);
    if (opt) {
      const parts = outerRingsLngLat(opt.feature);
      if (parts.length) {
        const k = parcelKey(opt.county, parts, opt.feature.attributes || {});
        if (!hilitesRef.current[k]) { addParcelHit(opt, latlng); optKey = k; }
      }
    }

    setBusy(true);
    try {
      // Eager identify: take the first source that returns a lot (≈2-3s via the
      // statewide layer) instead of stalling on a hung county server's full 8s timeout.
      // The breaker is fed for EVERY source via onSettled once they all finish — even
      // the slow ones we didn't wait for — so the next click skips a dead host (B244).
      const res = await identifyParcelEager(candidates, latlng.lng, latlng.lat, {
        onSettled: (sources) => sources.forEach((s) => recordSourceResult(s.county, s.ok)),
      });
      if (!res.hits.length) {
        // Live returned nothing. If the optimistic highlight came from a loaded Drive snapshot
        // (the county server is down but our cached copy HAS this lot), KEEP it as the selection —
        // that's the B629 cache doing its job — and badge it "cached". Only fall back to the cache
        // when live truly didn't answer (responded === 0), so a genuine "no parcel here" from a
        // healthy server still reads as empty. Otherwise roll the optimistic outline back + report.
        if (res.responded === 0 && opt && optKey && SNAPSHOT_COUNTIES.has(opt.county) && getSnapshot(opt.county) && hilitesRef.current[optKey]) {
          const v = snapshotVintage(opt.county);
          setCachedNotice({ county: backupCountyLabel(opt.feature.attributes || {}), asOf: v && v.asOf });
          return; // the optimistic addParcelHit already added it to the selection — leave it in place
        }
        if (optKey) rollbackHit(optKey);
        // "Couldn't reach any parcel server" reads differently from "reached one, but
        // there's no parcel at this exact point" (B245).
        setErr(res.responded === 0
          ? "The county parcel server isn't responding right now — try again in a moment, or trace the lot from the Aerial underlay."
          : "No parcel right there — zoom in and click directly on a lot.");
        return;
      }
      // The authoritative live answer always wins: drop the optimistic outline and rebuild
      // from the identified geometry (full-res + real account/address attrs), so the
      // IMPORTED parcel is never the simplified display outline. No flash — the
      // remove+re-add happen in this one synchronous turn (B441).
      if (optKey) rollbackHit(optKey);
      const hit = res.hits[0]; // first county that answered owns the lot
      // A statewide-layer hit is a genuine "backup" only when the county's OWN CAD was
      // unavailable this click (breaker open → dropped from the query) — NOT when a
      // healthy CAD was queried but statewide merely won the parallel race (B630). And
      // with B643's eager preference, a healthy CAD normally WINS the race, so hit.county
      // is the CAD itself here and this is false.
      const viaBackup = isStatewideBackup(hit.county, { realPrimaries, queried: candidates, statewideKeys: STATEWIDE_KEYS });
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
      if (optKey) rollbackHit(optKey);
      setErr(humanizeError(e));
    } finally {
      setBusy(false);
    }
  };

  /* NEW-2 (B233): identify + select the parcel at a geocoded point and surface its
     info card. Reuses the SAME identify/select pipeline as a click. Distinguishes
     "couldn't reach the parcel service" (unavailable) from "no parcel at this point"
     (none) — they mean different things and must read differently. */
  const selectParcelAt = async (latlng, label, tok) => {
    // B545: when called from a search, `tok` is that search's generation; a newer search makes
    // this one stale, so we neither apply its parcelInfo NOR add its (now-wrong) parcel.
    const live = () => tok == null || tok === addrTokRef.current;
    const { candidates, realPrimaries } = resolveCandidates(latlng);
    if (!candidates.length) { if (live()) setParcelInfo({ status: "unavailable", label }); return; }
    let res;
    try {
      res = await identifyParcelEager(candidates, latlng.lng, latlng.lat, {
        onSettled: (sources) => sources.forEach((s) => recordSourceResult(s.county, s.ok)), // feed the circuit breaker
      });
    } catch (_) {
      if (live()) setParcelInfo({ status: "unavailable", label }); return;
    }
    if (!live()) return; // a newer search superseded this one — don't add a stale parcel or info
    if (!res.hits.length) {
      // Live gave nothing. If NO service responded, try the Drive snapshot for a cached lot before
      // reporting unavailable (B629); a real "no parcel here" from a healthy server stays empty.
      const cached = res.responded === 0 ? snapshotHitAt(latlng.lng, latlng.lat) : null;
      if (cached) {
        const added = addParcelHit(cached, latlng);
        if (added) {
          const v = snapshotVintage(cached.county);
          setParcelInfo({
            status: "found", label, key: added.key, county: cached.county, attrs: added.attrs,
            addr: findAttr(added.attrs, ADDR_RE), acct: findAttr(added.attrs, ID_RE), acres: ringsAcres(added.rings),
            cached: { asOf: v ? v.asOf : null },
          });
          return;
        }
      }
      // Nothing matched: if NO service even responded, the source is unavailable;
      // if one answered with no parcel, the point is genuinely empty (a road/ROW).
      setParcelInfo({ status: res.responded === 0 ? "unavailable" : "none", label }); return;
    }
    const hit = res.hits[0];
    // See handleClick (B630): a statewide answer flags a "backup" only when the real CAD
    // was actually unavailable, not when it lost the parallel race to a faster TxGIO.
    const viaBackup = isStatewideBackup(hit.county, { realPrimaries, queried: candidates, statewideKeys: STATEWIDE_KEYS });
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
    const tok = ++addrTokRef.current; // B545: claim this search's generation; guard every async setState below
    setBusy(true); setErr(""); setParcelInfo(null);
    try {
      const center = mapRef.current ? mapRef.current.getCenter() : null;
      const hit = await geocodeAddress(q, center);
      if (tok !== addrTokRef.current) return; // a newer search started — drop this stale result
      if (hit && hit.error) { setErr(hit.error); return; } // B540: service unreachable ≠ not found
      if (!hit) { setErr("Couldn't find that address — add the city or ZIP, or just pan the map to it."); return; }
      mapRef.current.flyTo([hit.lat, hit.lon], 18, { duration: 0.75 });
      await selectParcelAt({ lat: hit.lat, lng: hit.lon }, hit.label, tok); // NEW-2: select + surface parcel info
    } catch (_) {
      if (tok === addrTokRef.current) setErr("Address search is unavailable right now — pan/zoom the map to your site instead.");
    } finally {
      if (tok === addrTokRef.current) setBusy(false);
    }
  };

  const clearSel = () => { clearHilites(); setSelected([]); setParcelInfo(null); setBackupNotice(null); setCachedNotice(null); };
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
      <div key={s.id} title={s.origin ? "Open site (double-click to fly here · right-click for status / rename / delete)" : "Open site (right-click for status / rename / delete)"}
        onClick={() => onOpenSite && onOpenSite(s.id)}
        onDoubleClick={() => flyToSite(s)}
        onMouseEnter={() => setHoverRow(s.id)} onMouseLeave={() => setHoverRow((r) => (r === s.id ? null : r))}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openSiteMenu(s, e.clientX, e.clientY); }}
        style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 12px", cursor: "pointer", borderLeft: `3px solid ${isActive ? PAL.accent : "transparent"}`, background: isActive ? "#fbf3ee" : "transparent" }}>
        <button title={`Status: ${STATUS_META[st]?.label || st} — click to change`} aria-label="Set status"
          onClick={(e) => { e.stopPropagation(); openSiteMenu(s, e.clientX, e.clientY); }}
          style={{ width: 16, height: 16, flex: "none", display: "grid", placeItems: "center", borderRadius: 99, cursor: "pointer", padding: 0,
            border: `1.5px solid ${t.color}`, background: t.hollow ? "var(--surface-raised)" : t.color, color: t.hollow ? t.color : "#fff", fontSize: 9, lineHeight: 1, fontFamily: "inherit" }}>
          {t.glyph}
        </button>
        {s.teamId && (
          <span title={`Shared with ${teamName(s.teamId)}`} aria-label="Shared with team"
            style={{ flex: "none", color: PAL.accent, display: "grid", placeItems: "center", lineHeight: 0 }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="5.5" cy="6" r="2.4" /><circle cx="11" cy="6.6" r="1.9" /><path d="M1.6 13c0-2.1 1.7-3.4 3.9-3.4S9.4 10.9 9.4 13z" /><path d="M9.7 9.8c1.9.1 3.3 1.2 3.3 3.2h-2.2c0-1.2-.4-2.3-1.1-3.2z" /></svg>
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          {renaming && renaming.id === s.id ? (
            <input autoFocus defaultValue={renaming.name}
              onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") commitRename(s.id, e.target.value, renaming.name);
                else if (e.key === "Escape") cancelRename();
              }}
              onBlur={(e) => { if (skipRenameBlurRef.current) { skipRenameBlurRef.current = false; return; } commitRename(s.id, e.target.value, renaming.name); }}
              style={{ width: "100%", boxSizing: "border-box", fontSize: 12.5, fontWeight: 600, color: PAL.ink, fontFamily: "inherit", padding: "1px 4px", border: `1px solid ${PAL.accent}`, borderRadius: 4, outline: "none", background: "var(--surface-raised)" }} />
          ) : (
            <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: t.struck ? "line-through" : "none" }}>{s.site || s.name || "Untitled site"}</div>
          )}
          <div style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, Menlo, monospace" }}>{STATUS_META[st]?.label || st} · {siteAcres(s) > 0 ? `${siteAcres(s).toFixed(1)} ac` : "no boundary"}</div>
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

        {/* Live GPS readout (B683): the cursor's WGS84 lat/long, bottom-center so it clears the
            zoom control (corner) and the scale bar (bottom-right). Display-only; the app's frame
            stays EPSG:2278 feet. */}
        {hoverLL && (
          <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", zIndex: 900, pointerEvents: "none", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11, color: "rgba(255,255,255,0.9)", background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)", padding: "3px 9px", borderRadius: 5, lineHeight: 1.4, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            {hoverLL.lat.toFixed(6)}°,&nbsp;{hoverLL.lng.toFixed(6)}°
          </div>
        )}

        {/* Right-click-on-empty-map menu → export the map's sites to Google Earth (B684). */}
        {mapMenu && (
          <>
            <div onClick={() => setMapMenu(null)} onContextMenu={(e) => { e.preventDefault(); setMapMenu(null); }} style={{ position: "fixed", inset: 0, zIndex: 3999 }} />
            <div style={{ position: "fixed", left: Math.min(mapMenu.x + 4, window.innerWidth - 244), top: Math.min(mapMenu.y + 4, window.innerHeight - 108), zIndex: 4000, background: "var(--surface-raised)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, boxShadow: "0 10px 30px rgba(28,25,20,0.22)", padding: 4, minWidth: 236, fontFamily: "inherit" }}>
              <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 10px 4px" }}>Map</div>
              <button onClick={() => exportSitesKmz(false)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: PAL.ink, padding: "7px 10px", borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-overlay)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>Export to Google Earth (KMZ)</button>
              <button onClick={() => exportSitesKmz(true)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: PAL.ink, padding: "7px 10px", borderRadius: 6 }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-overlay)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>Export with 3D buildings</button>
            </div>
          </>
        )}

        {/* ── Combined site bar — floating pill at top-center (full-width bar on a phone) ── */}
        <div style={{
          position: "absolute", zIndex: narrow ? 1100 : 1000,
          display: "flex", alignItems: "center",
          background: PAL.chrome,
          borderRadius: 99,
          boxShadow: "0 4px 20px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.25)",
          padding: "0 6px",
          height: 42,
          // Phone: a full-width bar pinned to the top so the side panels (now below it) can't
          // cover the search input or the Select-parcels button. Desktop: centered pill.
          ...(narrow
            ? { top: 8, left: 8, right: 8, transform: "none", maxWidth: "none", minWidth: 0 }
            : { top: 14, left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100% - 540px)", minWidth: 300 }),
        }}>
          {/* Address search */}
          <input
            style={{
              flex: 1, minWidth: narrow ? 60 : 140, maxWidth: 300, height: "100%",
              padding: "0 10px", background: "transparent", border: "none", outline: "none",
              color: PAL.chromeInk, fontSize: 13, fontFamily: "inherit",
            }}
            placeholder={narrow ? "Find a site…" : "Find a site — address or place…"}
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
          <div style={{ position: "absolute", zIndex: narrow ? 1090 : 1001, background: PAL.panelBg, border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 6px 22px rgba(28,25,20,0.22)", overflow: "hidden",
            ...(narrow
              ? { top: 58, left: 8, right: 8, transform: "none", width: "auto", maxWidth: "none" }
              : { top: 64, left: "50%", transform: "translateX(-50%)", width: 348, maxWidth: "calc(100% - 540px)" }) }}>
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
                {parcelInfo.cached && (
                  <div style={{ marginBottom: 8, padding: "6px 8px", background: "#fdf6e7", border: "1px solid #e6c478", borderRadius: 6, fontSize: 11, color: "#8a5a00", lineHeight: 1.4 }}>
                    Cached copy{fmtAsOf(parcelInfo.cached.asOf)} — the county server is unavailable, so this lot came from Planyr’s saved snapshot. Accurate for selection; may lag recent county updates.
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
          <div style={{ position: "absolute", background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 4px 18px rgba(28,25,20,0.14)", overflow: "hidden",
            // Phone: drop below the full-width search bar; a slim tap when closed, a wider
            // overlay (above the layers panel) when the user opens it.
            ...(narrow
              ? { top: 60, left: 8, zIndex: 1060, width: sitesPanelOpen ? "min(320px, calc(100vw - 16px))" : 188 }
              : { top: 10, left: 10, zIndex: 1000, width: 232 }) }}>
            {/* collapsible header (B106): click to fold the panel to a slim bar; state persists per device */}
            <button onClick={() => { if (narrow && !sitesPanelOpen) setLayersPanelOpen(false); toggleSitesPanel(); }} title={sitesPanelOpen ? "Collapse the sites panel" : "Expand the sites panel"}
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
                    {/* Solid status disc (matches the map pin): filled dot off, inverted on.
                        Pursuit/Active are glyphless discs; settled stages carry ‖/✓/✕ (B433). */}
                    <span style={{ width: 12, height: 12, flex: "none", display: "grid", placeItems: "center", borderRadius: 99, background: on ? "rgba(255,255,255,0.92)" : t.color, color: on ? t.color : "#fff", fontSize: 7.5, lineHeight: 1 }}>{t.glyph}</span>
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
                        {/* Solid status disc, matching the map pin (B433). */}
                        <span style={{ width: 14, height: 14, flex: "none", display: "grid", placeItems: "center", borderRadius: 99, background: t.color, color: "#fff", fontSize: 8.5, lineHeight: 1 }}>{t.glyph}</span>
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

        {/* imagery + labels + overlay layers control — on a phone this collapses to a tap
            (default closed) so it stops covering the search bar / Select-parcels button. */}
        <div style={{ position: "absolute", background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, padding: narrow && !layersPanelOpen ? 0 : "6px 9px 8px", fontSize: 12, color: PAL.ink, boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          ...(narrow
            ? { top: 60, right: 8, zIndex: 1055, width: layersPanelOpen ? "min(300px, calc(100vw - 16px))" : "auto" }
            : { top: 10, right: 10, zIndex: 1000, width: 228 }) }}>
          {narrow && (
            <button onClick={() => setLayersPanelOpen((o) => { const n = !o; if (narrow && n) setSitesPanelOpen(false); return n; })} title={layersPanelOpen ? "Collapse layers" : "Imagery & layers"}
              style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700, padding: layersPanelOpen ? "0 0 6px" : "8px 11px" }}>
              <span style={{ fontSize: 8, lineHeight: 1, transform: layersPanelOpen ? "none" : "rotate(-90deg)", display: "inline-block" }}>▼</span>
              <span style={{ flex: 1, textAlign: "left" }}>Imagery &amp; layers</span>
            </button>
          )}
          {(!narrow || layersPanelOpen) && (<>
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
          </>)}
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
        {/* cached-snapshot notice (bottom-left) — the clicked lot came from Planyr's saved Drive
            snapshot because the live county server was unreachable (B629). Same honesty as the
            statewide-backup notice: a possibly-staler local copy is never mistaken for a live record. */}
        {cachedNotice && !err && !backupNotice && (
          <div style={{ position: "absolute", left: 12, bottom: 12, zIndex: 1000, maxWidth: 380, background: "rgba(255,250,240,0.96)", border: "1px solid #e6c478", borderRadius: 8, padding: "8px 11px", fontSize: 12, color: "#8a5a00", lineHeight: 1.45 }}>
            <b>Cached copy{fmtAsOf(cachedNotice.asOf)}.</b> {cachedNotice.county} county’s live parcel server is unavailable, so this lot came from Planyr’s saved snapshot — accurate for selection, but it may lag recent county updates.
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
              width: 180, background: "var(--surface-raised)", border: `1px solid ${PAL.panelLine}`, borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.28)", maxHeight: "min(80vh, 520px)", overflowY: "auto", padding: "4px 0" }}>
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
            {/* Share with team (owner only; needs at least one team) */}
            {myTeams.length > 0 && (() => {
              const s = statusMenu.site;
              const owned = !s.ownerId || s.ownerId === myUid;
              if (!owned) return (
                <>
                  <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "4px 0" }} />
                  <div style={{ fontSize: 11, color: PAL.muted, padding: "6px 12px" }}>Shared by a teammate</div>
                </>
              );
              return (
                <>
                  <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "4px 0" }} />
                  <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "4px 12px 2px" }}>Share with team</div>
                  {myTeams.map((tm) => {
                    const on = s.teamId === tm.id;
                    return (
                      <button key={tm.id} disabled={shareBusy} onClick={() => doShare(s, on ? null : tm.id)}
                        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                          background: on ? "#fbf3ee" : "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 500 }}>
                        <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", color: PAL.accent, lineHeight: 0 }}>
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor"><circle cx="5.5" cy="6" r="2.4" /><circle cx="11" cy="6.6" r="1.9" /><path d="M1.6 13c0-2.1 1.7-3.4 3.9-3.4S9.4 10.9 9.4 13z" /><path d="M9.7 9.8c1.9.1 3.3 1.2 3.3 3.2h-2.2c0-1.2-.4-2.3-1.1-3.2z" /></svg>
                        </span>
                        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tm.name}</span>
                        {on && <span style={{ color: PAL.accent, fontWeight: 800 }}>✓</span>}
                      </button>
                    );
                  })}
                  {s.teamId && (
                    <button disabled={shareBusy} onClick={() => doShare(s, null)}
                      style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                        background: "transparent", color: PAL.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600 }}>
                      <span style={{ width: 15, flex: "none" }} />
                      <span style={{ flex: 1 }}>Make private</span>
                    </button>
                  )}
                </>
              );
            })()}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "4px 0" }} />
            <button onClick={() => { const s = statusMenu.site; setStatusMenu(null); setRenaming({ id: s.id, name: s.site || s.name || "" }); }}
              title="Rename this project"
              style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                background: "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", lineHeight: 0 }}>
                <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11.5 2.5l2 2L6 12l-2.5.5L4 10z" /></svg>
              </span>
              <span style={{ flex: 1 }}>Rename…</span>
            </button>
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
