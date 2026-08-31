import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { COUNTIES, COUNTIES_MAP, candidateCountiesForPoint, countyForView, countyKeyForName, STATEWIDE_KEYS, SNAPSHOT_COUNTIES, isStatewideLayerUrl, trimLayerUrl, loadCountyPolygons, countyIdentity, noParcelSourceNote } from "./lib/counties.js";
import { landingView, milesBetween, CLUSTER_RADIUS_MI } from "./lib/landingView.js";
import {
  shouldShowAccuracyCircle, formatAccuracyFt, locateErrorMessage,
  isAccuracyUsable, garbageAccuracyMessage, locateAvailability, locateUnavailableTooltip,
} from "./lib/locateMe.js";
import { ensureSnapshot, getSnapshot, snapshotVintage, onSnapshotChange, featureAtPoint, preferSnapshotForDisplay } from "./lib/parcelSnapshot.js";
import { recordSourceResult, filterHealthyCandidates, isSourceOpen, isStatewideBackup } from "./lib/sourceHealth.js";
import { syncOverlayLayers, withTileRetry, ALL_LAYERS, probeService } from "./lib/layers.js";
import { PANE_AREA, PANE_LINE, PANE_AREA_LABEL, PANE_LINE_LABEL } from "./lib/mapStack.js";
import { tileCacheLimit } from "./lib/tileBudget.js";
import { boundTileCache, capTileCache, releaseLayer } from "./lib/tileLifecycle.js";
import { BASEMAPS, FINDER_BASEMAP_CHOICES } from "./lib/basemaps.js";
// B427410 (×2) — the ONE gate for the "Road names" overlay below, shared with LayerPanel's
// dormant note so the map's opacity switch and the panel's explanation can't disagree.
import { PLACE_NAMES_MIN_ZOOM } from "./lib/layerZoomGate.js";
// B427411 — the ONE corner-radius scale. Never a bare number at a call site: eight of them
// disagreed visibly in this file alone before it existed.
import { RADIUS, nestedIn } from "../../shared/ui/radius.js";
// B649136 — the control-height / type-scale siblings of RADIUS (B809906), used by MAP_CORNER_CHIP_STYLE below.
import { CONTROL_H, FONT_SIZE } from "../../shared/ui/designTokens.js";
import { prefetchExtents, computeCoverage, boundsFromLeaflet, getNearbyRadiusMiles, subscribeRelevance } from "./lib/coverage.js";
/* LAZY (B1064 tranche c). Converted in the same commit as SitePlanner.jsx's copy — see that
 * file's header comment. On THIS host the card defaults OPEN on desktop (`layersPanelOpen`'s
 * initial state below), and `SitePlannerApp` keeps BOTH the map and the plan mode mounted at
 * once (the hidden one stays alive so switching back doesn't rebuild its Leaflet map) — so an
 * un-gated render here would fetch this chunk on EVERY boot, including a returning user who
 * lands straight in the planner and never looks at the map. The render site below therefore
 * gates on `visible` in addition to `layersPanelOpen`: the chunk loads once this mode is
 * actually the one on screen, not merely mounted. The outer card (width/padding) is owned by
 * the wrapping `<div>` at the render site, not by this component, so the box itself never
 * resizes when the chunk arrives. */
const LayerPanel = lazy(() => import("./components/LayerPanel.jsx"));
// B831777 (NEW-2) — the Comps tab's content. Loaded on demand, same reasoning as LayerPanel
// above: it renders inside the left rail, not on the map's own critical path.
const CompsPanel = lazy(() => import("../../shared/comps/components/CompsPanel.jsx"));
const SitePlansSection = lazy(() => import("../../shared/sitePlans/components/SitePlansSection.jsx"));
import LazyPanel from "./components/LazyPanel.jsx";
import { siteState } from "./lib/siteRegion.js";
// NEW-3 — the ONE map-overlay stacking model. Leaflet fixes its own control containers at
// z-index 1000; these panels sat at 1000 too, so whether the zoom buttons and the scale bar
// covered them came down to document order. An open panel now outranks map chrome outright.
import { MAP_CHROME_Z, panelMaxHeight, ZOOM_CONTROL_CLEARANCE_PX } from "./lib/mapChromeStack.js";
// B848848 — site-plan overlays (upload a site plan, anchor it on the map, pin comps to it).
import { useSitePlanOverlayLayers } from "./lib/useSitePlanOverlayLayers.js";
import { latLonToImagePoint, suggestFtPerPx } from "../../shared/sitePlans/lib/overlayGeoref.js";
import { projectToGrid } from "../../shared/coordinates/index.js";
// Reused (never a new raw hex literal) for text on the fixed COMP_ACCENT blue below — that
// accent doesn't change with theme, so the LIGHT palette's on-accent value is correct in both.
import { PALETTES } from "../../shared/theme/palette.js";
import PlaceSearchField from "./components/PlaceSearchField.jsx";
import { useGroundElevation } from "./components/useGroundElevation.js";
import CursorChip from "./components/CursorChip.jsx";
import { contourHover } from "./lib/terrainLazy.js";
import { attachRasterIdentifyLazy } from "./lib/rasterIdentifyLazy.js";
import { NUM_FONT, TABULAR_NUMS } from "../../shared/theme/typography.js";
import ContextMenu from "../../shared/ui/ContextMenu.jsx";
import AnchoredMenu from "../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle, MenuItem } from "../../shared/ui/controls.jsx";
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
import { elStyle, elToRingFeet, byZ } from "./lib/planStyle.js";
import { STATUSES, STATUS_META, statusOf } from "./lib/siteModel.js";
import { countyAtPoint } from "./lib/jurisdiction.js";
import { findAttr, situsAddress, siteNameFromParcel } from "./lib/appraisal.js";
/* LAZY (B1064 tranche). The address-search parcel card renders only AFTER a search resolves a
 * lot — an inherently async moment, so there is nothing on screen for its chunk to hold up and
 * no layout to reserve (the card is absolutely positioned over the map, which is also why the
 * fallback here is `null` rather than a height-reserving placeholder). `PanelErrorBoundary`
 * still contains a chunk that fails to load, per LOUD-FAILURE. */
const ParcelInfoCard = lazy(() => import("./components/ParcelInfoCard.jsx"));
import { PanelErrorBoundary } from "./components/LazyPanel.jsx";
import { makeParcelDisplayLayer, makeSnapshotLayer, PARCEL_MINZOOM, ADD_CURSOR, REMOVE_CURSOR } from "./lib/parcelDisplay.js";
import { responseWasTruncated, featureCountOf, parcelTruncationNotice } from "./lib/parcelTruncation.js";
import { siteBoundaryInfo, siteDrawParcels } from "./lib/siteBoundary.js";
import { geocodeAddress } from "./lib/geocode.js";
import { compAnchorFromSelection } from "./lib/compParcelAnchor.js";
import { statusToken, darken } from "../../shared/ui/statusTokens.js";
/* lib/sharing.js is loaded ON DEMAND, and the reason is a budget one. This module is the
   ONLY importer of it, and both of its functions are already reached through an `await`
   inside `doShare` — so deferring it is mechanical, changes no behaviour, and takes its
   bytes off the Site route's critical chunk, which nothing can use until someone actually
   picks a team from the share menu. (teams.js next door is deliberately NOT deferred:
   SitePlanner.jsx and SitePlannerApp.jsx import it too, so moving it here alone would
   save nothing.) */
const sharingLib = () => import("./lib/sharing.js");
import { listMyTeams, currentIdentity } from "./lib/teams.js";
import { sharedWithDisplay } from "./lib/sharedWithTeam.js";
import { lastEditedLabel } from "./lib/siteRecency.js";
// B855952/B855953/B855954 (NEW-1/NEW-2/NEW-3) — the Sites panel's cross-device arrangement (group
// order, collapse state, pinned sites, row sort) lives in the SAME account-scope store Standards'
// "Save for all projects" uses (see lib/userPrefs.js's `sitesPanel` header) — never a new mechanism.
import { loadUserPrefs, saveUserPrefs, readMirror, setSitesPanelPref } from "./lib/userPrefs.js";
import { adminBoundariesVisible, attachAdminBoundaries } from "./lib/adminBoundaryGate.js";
import { compHeadline } from "../../shared/comps/lib/comps.js";
import { compMarkerSvg, compMarkerSize } from "../../shared/comps/lib/compMarkerIcon.js";
// B834580 — the SAME time-sliced-paint primitive B802400 round 5 built for the contour layer
// (terrainLayers.js). REUSED, not reimplemented: this module owns only the pure "where to split a
// list of paint ops so no batch exceeds budget" decision; the scheduling policy (a MessageChannel
// macrotask, see scheduleSaveSitesFrame below) is caller glue, same as terrainLayers.js's own.
import { runBudgeted, PAINT_FRAME_BUDGET_MS } from "./lib/paintSchedule.js";

// Theme tokens (var(--…)) — MapFinder is DOM/inline-style only, so CSS vars resolve
// and the panel themes live with no re-render. (B318)
const PAL = {
  panelBg: "var(--surface-raised)", panelLine: "var(--border-default)", ink: "var(--text-primary)",
  accent: "var(--accent)", muted: "var(--text-secondary)",
  chrome: "var(--chrome-bg)", chromeLine: "var(--chrome-divider)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)", ember: "var(--accent)",
};

/* B831776 (NEW-1/NEW-6) — the Comp-mode accent. Deliberately a different hue from `PAL.accent`
 * (the site/plan action color) so the toolbar switch and the armed-drop indicator can never read
 * as "just another site action" — a raw click in Comp mode creates a standing record (a comp),
 * which is a costlier mistake to walk back than a site click is. Matches the leasing-comp map
 * marker's own "building sale" blue (compMarkerIcon.js) rather than inventing a fourth color. */
const COMP_ACCENT = "#2f6fb0";
const ON_COMP_ACCENT = PALETTES.light.onAccent; // white — see the palette.js import above

// The aerial-source registry (BASEMAPS) lives in lib/basemaps.js (B693) — it's shared
// with the planner's Basemap control so both surfaces always offer the same sources.
// Its B220 rule travels with it: every source carries `maxNative`, and the imagery
// layer below clamps fetches to that ceiling (minus the retina offset).
/* B427410 (×2) — this is Esri's TRANSPORTATION reference layer: road, highway and rail
 * names + shields, drawn faint over the imagery. It carries NO city/landmark names — those
 * live in a different Esri service (Reference/World_Boundaries_and_Places) that this app does
 * not use. The panel row this feeds is named "Road names" for exactly that reason — do not
 * relabel it back to anything implying place/city names without switching the source too. */
const LABELS_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}";

/* B427410 (×3) — THE DEFAULT OPACITY, MEASURED, NOT COPIED FROM THE TIER MODEL. The old fixed
 * 0.4 was never derived for this layer — it matches `layerWeight.js`'s "context" tier ceiling,
 * the quietest of three, applied here as a borrowed number rather than a decision. Compared real
 * Esri World_Transportation tiles over real World_Imagery aerial at three opacities: at 0.4 a
 * label's black glyph and its own protective white halo fade by the SAME amount, so contrast
 * against a busy aerial photo collapses into a grey smudge (this is the owner's "always kind of
 * opaque [muddy]," not a perception issue); at 0.85 it reads pixel-for-pixel as crisp as 1.0. A
 * label layer's readability and its "loudness" are not one knob the way an area fill's are, so
 * the tier ceiling below does not transfer to this layer. Session-only default; the user's own
 * slider (`opacityControl`, wired below) is the rest of the answer — "let me adjust the opacity"
 * was the owner's own fallback ask. */
const PLACE_NAMES_DEFAULT_OPACITY = 0.85;

/* NEW-MAPCTRL-3 — the narrow-mode full-width search bar's own footprint (`top:8, height:42`
 * where it's rendered below) plus an 8px gap. The bottom-left banner slot (error toast, share
 * confirmation, the "+ Select parcels" coach tip, …) uses this as its TOP ceiling on a narrow
 * screen, so a genuinely short pane (a landscape phone/tablet) can never render one of those
 * banners UNDER the search bar — see that render site for the measured collision this closes. */
const SEARCH_BAR_CLEARANCE_PX = 58;

// NEW-4 — how long the "location is blocked" notice stays up before it auto-dismisses. Still
// dismissible by hand at any time. The message itself is one short sentence (reads as two lines
// in the popover's width); 6s is long enough to read it twice with room to spare, shorter than
// the app's general sync-conflict toast (TOAST_TTL_MS, 8s) because there's no action to weigh —
// just a fact to notice and move past.
const LOCATE_NOTICE_MS = 6000;

/* NEW-2 — reproduced live (headless, both narrow and desktop widths, 700-2000 CSS px): whenever
 * the Layers panel is COLLAPSED — its default at ≤760px, and reachable at ANY width by collapsing
 * it by hand (the choice persists in localStorage) — the Comps toggle above it and the collapsed
 * "▶ Imagery & layers" pill below it read as two unrelated floating chips: same right edge, but
 * Comps is far narrower (~69px measured) than the collapsed panel (~150px measured), so their left
 * edges don't line up and there's a visible gap between them ("detached and misaligned"). It does
 * NOT reproduce while the panel is OPEN — a small toggle button sitting above a big content card is
 * an ordinary, expected size difference; the defect is specifically the two SAME-KIND collapsed
 * pills failing to match. COMPS_LAYERS_COLLAPSED_W is the shared collapsed width both chips read
 * (150px + a little breathing room) — no change to the open state, which was never the reported
 * defect. */
const COMPS_LAYERS_COLLAPSED_W = 152;

/* B649136 (2026-08-28) — same pair, a THIRD defect: sharing edges is not sharing a SHAPE. Owner,
 * verbatim: "it's just, like, interesting how you have this right next to each other, and they're
 * clearly two different shapes for the comps and imagery and layers... everything should, like,
 * kinda be the same. Like, everything should be uppercase or lowercase. Like, we shouldn't mix
 * uppercase only with normal text." Measured pre-fix: Comps was a full pill (radius 999) at
 * 12.5px/600 with a filled white background; the collapsed Layers toggle was a square corner
 * (radius 12 on its own bordered parent, not 0 — see the B649136 backlog item for the instrument
 * note on why a text-node read reports 0) in ALL CAPS with 0.735px letter-spacing at 10.5px/700,
 * transparent over a near-white parent.
 *
 * Direction is the owner's own words: "I like the squared off with the radii to where it's, like,
 * really a rectangle just with radii cut" — a rounded RECTANGLE, never a full pill. RADIUS.md is
 * the exact semantic fit, not a new number: radius.js's own scale defines `md` as "a standalone
 * control — a button, a text field, a chip that sits on the map by itself", which is precisely
 * what both of these are. No new radius token was needed, so this does NOT touch the open "raw 7"
 * question DESIGN-TOKENS.md flags (that's a retrofit judgement call over 43 unrelated sites; see
 * that doc for the explicit note this item leaves there).
 *
 * ⛔ CASING — SENTENCE CASE, not Title Case (owner correction, same session: his first instruction
 * was Title Case and he retracted it before it shipped). "Comps" doesn't change; multi-word labels
 * capitalise only the first word: "Imagery & layers" (already the source string — the uppercase
 * CSS transform was hiding it), matching every other control already in this app — "Start blank",
 * "+ Select parcels", "Turn all 1 layer off", "Zoom to fit", "Export to Google Earth (KMZ)" — none
 * of which read "Start Blank" or "Zoom To Fit". UPPERCASE + letterspacing stays reserved for
 * SECTION HEADERS (the open Layers panel's own list group headers, "Your sites" below) — a
 * floating control reads as a control, in sentence case, like every other primary button on this
 * bar (Go, + Select parcels, Start blank in the row-1 header).
 *
 * Applied to BOTH chips' COLLAPSED presentation only — the open Layers panel header stays exactly
 * as it was (a small uppercase mini-header above a big content card was never the reported shape
 * mismatch; only the two same-kind collapsed pills were). */
const MAP_CORNER_CHIP_STYLE = {
  height: CONTROL_H.lg, minWidth: COMPS_LAYERS_COLLAPSED_W, padding: "0 12px", borderRadius: RADIUS.md,
  border: `1px solid ${PAL.panelLine}`, background: "var(--surface-raised)",
  color: PAL.ink, fontSize: FONT_SIZE.xl, fontWeight: 600, textTransform: "none", letterSpacing: "normal",
  cursor: "pointer", fontFamily: "inherit", boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
};

/* NEW-6 — the ring count Leaflet actually uses on this map's two tile layers. Neither passes
 * `keepBuffer`, so both run on Leaflet's default of 2; the cache CEILING is sized from that same
 * number so the cap is computed for the layers as they really are. Deliberately NOT tuned: this
 * item is authorised to cap RETAINED memory, not to change how much gets drawn or fetched. */
const MAP_KEEP_BUFFER = 2;
/* How far the ceiling is squeezed while the Map view is HIDDEN (SitePlannerApp keeps it mounted
 * under display:none). A hidden map needs no ring of look-ahead tiles at all, and everything shed
 * re-fetches the moment it is shown again — the visible result is identical. */
const HIDDEN_TILE_CAP = 16;

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
    className: "map-site-feature", // NEW-3 — a stable hook for verifying the decoupling
    html,
    iconSize: [HIT_W, HIT_H],
    iconAnchor: [HIT_W / 2, HIT_H],
    tooltipAnchor: [0, -(h - 4)],
  });
}

// NEW-3 (B834578) — HTML-escape: a site NAME is user-entered text going straight into a divIcon's
// raw `html` string, so it must never be interpolated unescaped (an XSS opening, not just a bug).
const escHtmlText = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// The site-plan name tag: styled like the planner's own dark acreage-badge chip (SitePlanner.jsx's
// parcel badge — a `rgba(17,24,39,0.62)` plate, `#e9edf2` text, ~500 weight) rather than a new
// treatment. `white-space:nowrap` + the `translate(-50%,-50%)` centers it on the marker's lat/lon
// (the same anchor a status pin already uses) regardless of name length.
const sitePlanLabelHtml = (name) =>
  `<div style="display:inline-block;transform:translate(-50%,-50%);background:rgba(17,24,39,0.62);` +
  `border:1px solid rgba(255,255,255,0.14);border-radius:7px;padding:2px 7px;color:#e9edf2;` +
  `font:600 11px/1.4 ${NUM_FONT};white-space:nowrap;pointer-events:none;">${escHtmlText(name)}</div>`;

// NEW-5 (B834580) — yield a genuine MACROTASK between budgeted paint slices (not another
// requestAnimationFrame, which Leaflet's own queued redraw would just fold into the same frame —
// see terrainLayers.js's identical idiom, which this mirrors rather than reimplements).
function scheduleSaveSitesFrame(fn) {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => { try { fn(); } finally { ch.port1.close(); ch.port2.close(); } };
  ch.port2.postMessage(0);
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

/* NEW-2 — the address the card and the plan NAME use is the SITUS, resolved by the shared ordered
 * ladder in lib/appraisal.js. The local `ADDR_RE` this replaced was a single alternation applied
 * "first key wins", so on Weld County's schema the owner's mailing address (`ADDRESS1`) beat the
 * situs (`SITUS`) purely because the service lists it first — every plan started that way was named
 * after the owner's head office. Null means "this record has no situs", which the callers answer
 * with what the user searched, never with a mailing address. */
const ID_RE = /(hcad_?num|^acct|account|parcel_?id|prop_?id|^pid$|quick_?ref|geo_?id|^pin$|^gid$|objectid)/i;
// findAttr (imported from lib/appraisal.js) is the shared "first non-empty attr
// matching this regex, as a string" helper — formerly a local findVal duplicate.
const shoelace = (pts) => {
  // B690 — a stored parcel can lack `points` (attr-only / legacy / a malformed row round-tripped
  // verbatim through site_elements). The map layer skips those (p.points?.length below); the
  // acreage sums must too, or ONE bad record crashes the whole finder into the error boundary.
  if (!Array.isArray(pts) || !pts.length) return 0;
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

// Total acreage across every outer ring of a lon/lat parcel feature (multipart-safe).
function ringsAcres(rings) {
  if (!rings || !rings.length) return null;
  try {
    const lon0 = rings[0][0][0], lat0 = rings[0][0][1];
    return rings.reduce((sum, r) => sum + shoelace(lngLatRingToFeet(r, lon0, lat0)), 0) / 43560;
  } catch (_) { return null; }
}

/* NEW-1 — the map container's real pixel size, for the landing-view fit. `measured` is false
 * when the container has no layout yet (the map is created while the PLANNER is the visible
 * mode, and `SitePlannerApp` keeps this one alive behind `display:none`); the caller uses that
 * to decide whether the fit it just computed is final or provisional. The fallback is a
 * plain desktop-ish viewport — the fit only has to be close, and it always errs wide. */
function viewportOf(el) {
  const w = (el && el.clientWidth) || 0;
  const h = (el && el.clientHeight) || 0;
  return w > 0 && h > 0 ? { width: w, height: h, measured: true } : { width: 1024, height: 768, measured: false };
}

/* NEW-2 — the one "shared with a team" glyph, at MODULE SCOPE (MODULE-SCOPE-COMPONENTS): it is
 * drawn in three places now (the list row, the share menu's status line, each team row) and three
 * inline copies of the same path is how they drift. Inherits `currentColor` so each caller keeps
 * owning the colour. */
const ShareGlyph = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <circle cx="5.5" cy="6" r="2.4" /><circle cx="11" cy="6.6" r="1.9" />
    <path d="M1.6 13c0-2.1 1.7-3.4 3.9-3.4S9.4 10.9 9.4 13z" />
    <path d="M9.7 9.8c1.9.1 3.3 1.2 3.3 3.2h-2.2c0-1.2-.4-2.3-1.1-3.2z" />
  </svg>
);

// B855953 (NEW-2) — the "pinned to top" glyph, at MODULE SCOPE (MODULE-SCOPE-COMPONENTS):
// decorative only (the Pinned section header already names the state), drawn once here so the
// context-menu row and the section header can't drift into two different pin shapes.
const PinGlyph = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    <path d="M8 1.2a3.6 3.6 0 0 0-3.6 3.6c0 2.55 3.6 6.9 3.6 6.9s3.6-4.35 3.6-6.9A3.6 3.6 0 0 0 8 1.2zm0 5.1a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z" />
    <rect x="7.25" y="11.5" width="1.5" height="3.3" rx="0.7" />
  </svg>
);

/* B831776 (NEW-1) — the far-left Site/Comp switch. MODULE-SCOPE-COMPONENTS: defined here, not
 * inside MapFinder's render. Two segments, one piece of state (`mode`) — see the state's own
 * comment for why there is deliberately no second "which tab" variable. */
const SWITCH_SEG_H = 26;
function SiteCompSwitch({ mode, onChange }) {
  // NEW-1/NEW-3 (map landing radius audit) — measured `nestedIn(RADIUS.sm, 2)` = 4px against this
  // switch's own 2px padding, and a literal 4 is a genuinely NEW off-scale number (radius.js's
  // scale is {6,8,12,999} — nestedIn() derives concentric values for a LARGER outer radius nested
  // inside a bigger surface; at the smallest step, sm=6, a 2px inset floors below the next rung
  // down rather than landing on one). Between "perfectly concentric but off-scale" and "on-scale
  // but 2px shy of concentric on a 26px-tall segment" (imperceptible at working zoom —
  // PERCEPTUAL-PARITY), the second is the one that doesn't invent a fifth radius step, so the
  // segment stays on RADIUS.sm, matching its own shell. See docs/DESIGN.md's radius section for
  // the rule this documents ("snap to the nearest canonical step rather than mint a derived one").
  const seg = (key, label, accent) => {
    const on = mode === key;
    return (
      <button key={key} type="button" role="tab" aria-selected={on} onClick={() => onChange(key)}
        style={{
          flex: "none", height: SWITCH_SEG_H, padding: "0 8px", borderRadius: RADIUS.sm, border: "none",
          background: on ? accent : "transparent", color: on ? "#fff" : "var(--chrome-muted)",
          fontSize: 12, fontWeight: on ? 700 : 600, cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
        }}
      >{label}</button>
    );
  };
  return (
    <div role="tablist" aria-label="Site or comp" style={{
      flex: "none", display: "flex", gap: 2, padding: 2, marginRight: 6,
      height: SWITCH_SEG_H + 4, borderRadius: RADIUS.sm, background: "var(--chrome-bg-elev)",
    }}>
      {seg("site", "Site", PAL.accent)}
      {seg("comp", "Comp", COMP_ACCENT)}
    </div>
  );
}

/* B831777 (NEW-2) — one rail tab, counts included on the tab itself (never a separate badge).
 * NEW-1/NEW-3 (map landing radius audit) — repointed from the bare `RADIUS.sm` literal to
 * `nestedIn(RADIUS.lg, 6)` (same value, 6px, since the header row's own 6px padding is the real
 * gap to the panel's RADIUS.lg=12 edge): a literal that already equals a token's pixel value still
 * drifts independently of it (docs/DESIGN.md's radius section, exception 3) — this ties it to the
 * panel it actually nests inside instead. */
function RailTab({ label, count, active, onClick }) {
  return (
    <button type="button" role="tab" aria-selected={active} onClick={onClick} style={{
      flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
      height: 26, padding: "0 8px", borderRadius: nestedIn(RADIUS.lg, 6), border: "none",
      background: active ? "var(--surface-raised)" : "transparent",
      color: active ? "var(--text-primary)" : "var(--text-secondary)",
      fontSize: 11.5, fontWeight: active ? 700 : 600, cursor: "pointer", fontFamily: "inherit",
    }}>
      {label}<span style={{ color: active ? "var(--text-primary)" : "var(--text-tertiary)" }}>{count}</span>
    </button>
  );
}

export default function MapFinder({ visible, isActive = true, overlays, setOverlays, layerStatus = {}, setLayerStatus, sites = [], parcelSummary = null, lastEditedByGroup = null, activeSiteId, onOpenSite, onDeleteSite, onSetStatus, onRenameSite, onSharedChange, onUseParcels, onSkip, comps = [], onPlaceComp, onCompClick, pendingCompAnchor = null, onCompAnchorConsumed, focusCompId = null, onCompFocusHandled, onCompsChange, onOpenReviewInDocReview }) {
  const elRef = useRef(null);
  const mapRef = useRef(null);
  const addrTokRef = useRef(0); // B545: address-search generation — a newer search invalidates an older in-flight one
  const imageryCapRef = useRef(null); // NEW-6 — detach fn for the imagery layer's tile-cache cap
  const labelsCapRef = useRef(null);  // NEW-6 — ditto for the labels overlay
  const displaysRef = useRef({});    // county -> visible parcel-line layer (all CAD counties)
  /* NEW-2 — county -> { url, owner }: the RESOLVED endpoint behind that county's on-map layer, and
     which county key actually CREATED it. Two keys that resolve to the same endpoint (a county
     parked on a statewide composite) now share ONE Leaflet layer instead of stacking two identical
     ones over the same ground; the non-owner keys are aliases and must never remove the layer. */
  const displaySrcRef = useRef({});
  const sitesLayerRef = useRef(null); // saved-site footprints
  // NEW-5 (B834580) — cancellation token for the budgeted saved-site paint below: bumped at the
  // start of every build() so a still-trickling PREVIOUS build's scheduled continuation becomes a
  // silent no-op the moment a newer one starts, instead of two builds racing to populate/replace
  // `sitesLayerRef.current`.
  const sitesPaintEpochRef = useRef(0);
  const compsLayerRef = useRef(null); // leasing-comp markers (NEW-COMPS)
  const onCompClickRef = useRef(onCompClick);
  useEffect(() => { onCompClickRef.current = onCompClick; }, [onCompClick]);
  const pressedRef = useRef(false);        // a pointer is currently down on the map (B64)
  const pendingRebuildRef = useRef(null);  // a saved-site rebuild deferred until pointer-up (B64)
  const pendingCompsRebuildRef = useRef(null); // ditto, but its OWN slot — sharing pendingRebuildRef
  // would let a comps rebuild deferred in the same press silently clobber a pending sites one (or
  // the reverse), since that ref only ever holds one function.
  /* NEW-1 — the derived landing view is where the map OPENS, never a leash on the user.
   * `landedRef` latches once a view derived from real sites has been applied; `userMovedRef`
   * latches the instant the user touches the map. Either one ends the landing behaviour for
   * the session, so a late-arriving cloud site list can never yank a camera the user is
   * already driving. */
  const landedRef = useRef(false);
  const userMovedRef = useRef(false);
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const onOpenSiteRef = useRef(onOpenSite);
  useEffect(() => { onOpenSiteRef.current = onOpenSite; }, [onOpenSite]);
  const onSetStatusRef = useRef(onSetStatus);
  useEffect(() => { onSetStatusRef.current = onSetStatus; }, [onSetStatus]);
  const onRenameSiteRef = useRef(onRenameSite);
  useEffect(() => { onRenameSiteRef.current = onRenameSite; }, [onRenameSite]);
  const hilitesRef = useRef({});     // key -> L.polygon for each selected parcel
  const locateLayerRef = useRef(null); // "locate me" — the L.layerGroup holding the position dot + accuracy circle
  const locateBtnRef = useRef(null);   // the control's DOM button, so we can toggle a "locating" pressed/spinner state
  const locatingRef = useRef(false);   // in-flight guard — ignore a 2nd press while a fix is pending
  // NEW-MAPCTRL-2 — permission-aware "locate me": read before touching the click handler.
  const geoAvailabilityRef = useRef("ready"); // locateAvailability()'s live answer: 'ready' | 'blocked' | 'insecure' | 'unsupported'
  const geoPermissionRef = useRef(null);      // the live PermissionStatus (if the browser supports the query), so its 'change' listener can be removed on unmount
  const locateWatchdogRef = useRef(null);     // backstop timer — stops the spinner even if neither locationfound nor locationerror ever fires (an unanswered permission prompt)
  // NEW-4 — the "location is blocked" (etc.) message, ANCHORED to the locate button itself
  // (AnchoredMenu + locateBtnRef) rather than riding the generic page-corner `err` banner, which
  // is what let it read as a page-level announcement with no visual tie to the control that
  // produced it. Auto-dismisses after LOCATE_NOTICE_MS; still closeable by hand at any time.
  const [locateNotice, setLocateNotice] = useState(null);
  const locateNoticeTimerRef = useRef(null);
  const dismissLocateNotice = () => { setLocateNotice(null); if (locateNoticeTimerRef.current) { clearTimeout(locateNoticeTimerRef.current); locateNoticeTimerRef.current = null; } };
  const showLocateNotice = (msg) => {
    setLocateNotice(msg);
    if (locateNoticeTimerRef.current) clearTimeout(locateNoticeTimerRef.current);
    locateNoticeTimerRef.current = setTimeout(() => { setLocateNotice(null); locateNoticeTimerRef.current = null; }, LOCATE_NOTICE_MS);
  };
  useEffect(() => () => { if (locateNoticeTimerRef.current) clearTimeout(locateNoticeTimerRef.current); }, []);
  const layerUrlsRef = useRef({});   // county -> resolved queryable layer URL (auto-routing)
  const imageryRef = useRef(null);
  const labelsRef = useRef(null);
  const selectModeRef = useRef(false); // read by the once-bound map handlers
  const placingCompPinRef = useRef(false); // NEW-COMPS: armed by "+ Comp", read by the once-bound click handler
  const activeOverlayIdRef = useRef(null); // NEW-2 (B848496): read by the once-bound click handler, to deselect on a background click
  const selectedRef = useRef([]);
  const draggingRef = useRef(false);
  // NEW-2 — read live by the once-bound raster hover-identify handlers, so toggling a layer
  // (or a health dot flipping) never re-binds a Leaflet listener.
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const layerStatusRef = useRef(layerStatus);
  layerStatusRef.current = layerStatus;
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  /* NEW-4 — a county outage used to produce a banner and nothing else: the owner was left on a map
   * that would not give him a lot, with no indication that he could proceed anyway. When a source
   * reports UNAVAILABLE (as opposed to "no parcel right there", which is a different fact), the
   * way forward is offered in the same breath — start the plan at this point and draw the boundary
   * by hand, with the location captured so the plan is never stranded. */
  const [fallbackOffer, setFallbackOffer] = useState(null); // {at:{lat,lon}} | null
  // NEW-MAPCTRL-2 — STEEL-MAN ix: a locate fix genuinely far from every saved site is flown to
  // (that's correct — it's where the user is), but this leaves a way back rather than stranding
  // the camera. "Far" reuses the SAME 50-mile market radius `landingView` already uses to decide
  // whether two sites are the same market (CLUSTER_RADIUS_MI) — no new distance policy to keep in sync.
  const [locateFar, setLocateFar] = useState(false);
  const failUnavailable = (msg, at) => {
    setErr(msg);
    const c = at || (mapRef.current ? mapRef.current.getCenter() : null);
    setFallbackOffer(c ? { at: { lat: c.lat, lon: c.lon != null ? c.lon : c.lng } } : null);
  };
  const [basemap, setBasemap] = useState("esri");
  const [labels, setLabels] = useState(true);
  // B427410 (×3) — the owner's own opacity control over the road-names overlay (`opacityControl`,
  // the same slider every other Layers-panel row uses). Session-only, matching every other row's
  // opacity (layerPrefs.js keeps opacity out of the persisted per-site record on purpose). The
  // DEFAULT is set for crispness, not for the old "context tier" quietness — see PLACE_NAMES_DEFAULT_OPACITY.
  const [labelsOpacity, setLabelsOpacity] = useState(PLACE_NAMES_DEFAULT_OPACITY);
  const [selectMode, setSelectMode] = useState(false); // off = pan only; on = add/remove parcels
  // NEW-1 (map "Start blank" consolidation) — the secondary-action dropdown on the "Select
  // parcels" split button, below. One state/ref pair for the one caret this toolbar now has.
  const [startBlankMenuOpen, setStartBlankMenuOpen] = useState(false);
  const startBlankMenuBtnRef = useRef(null);
  // NEW-COMPS: armed by "+ Comp" — the next map click drops a leasing comp anchor there. A
  // second, independent one-shot mode alongside `selectMode` (mutually exclusive in the UI,
  // never both true at once) rather than folded into it, because it needs none of selectMode's
  // parcel-identify machinery — just a raw point.
  const [placingCompPin, setPlacingCompPin] = useState(false);
  useEffect(() => { placingCompPinRef.current = placingCompPin; }, [placingCompPin]);
  useEffect(() => {
    if (!mapRef.current) return;
    if (placingCompPin) mapRef.current.getContainer().style.cursor = ADD_CURSOR;
    else if (!selectMode) mapRef.current.getContainer().style.cursor = "";
    // selectMode's OWN cursor is owned by its own effect elsewhere in this file; this effect only
    // needs to react to placingCompPin toggling, reading selectMode's current value to avoid
    // stomping on that other effect's cursor when comp-placing mode turns off.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingCompPin]);

  /* B831776 (NEW-1/NEW-2) — the Site/Comp switch and the left-rail tab are ONE piece of state,
   * never two: flipping either flips the other, which is the whole point of this design (two
   * independent modes is the failure it replaces). `mode` drives BOTH — the toolbar switch's
   * highlighted segment (and therefore which pair of action buttons it offers) AND which rail
   * tab is showing. It does NOT drive what's drawn on the map — see `showSitesLayer`/
   * `showCompsLayer` below (NEW-3): those are independent, so switching modes here can never hide
   * a pin. */
  const [mode, setModeRaw] = useState(() => {
    try { return localStorage.getItem("planarfit:mapMode:v1") === "comp" ? "comp" : "site"; } catch (_) { return "site"; }
  });
  const setMode = (m) => {
    setModeRaw(m);
    try { localStorage.setItem("planarfit:mapMode:v1", m); } catch (_) { /* private mode */ }
    // Leaving a mode cancels whatever that mode had armed, so switching Site<->Comp never leaves
    // a stale one-shot click-handler live under the other mode's toolbar (NEW-6's armed state is
    // keyed on `mode`, so this keeps the visual and the actual armed handler from disagreeing).
    if (m !== "comp") { setPlacingCompPin(false); }
    setSelectMode(false);
  };
  const [zoom, setZoom] = useState(null);

  // ---- Site-plan overlays (B848496) — upload a site plan, place it on the map by DIRECT
  // MANIPULATION (drag / corner-scale / rotate, mirroring the Site Planner's own on-canvas
  // reference-image tool — the owner rejected the original control-point wizard outright), pin
  // comps to buildings on it. The DATA (fetch/list/upload UI) is owned by SitePlansSection, the
  // same self-contained-data-owner shape CompsPanel already uses; this component owns what the
  // REAL Leaflet map has to do: render the placed overlays + their live drag handles
  // (useSitePlanOverlayLayers, below), which overlay is armed for editing, and the "the next
  // click ON one specific overlay's rendered image" mode (pinning a comp), which resolves
  // through the EXISTING onPlaceComp/pendingCompAnchor flow.
  const [sitePlanOverlays, setSitePlanOverlays] = useState([]);
  const overlaysById = useMemo(() => Object.fromEntries(sitePlanOverlays.map((o) => [o.id, o])), [sitePlanOverlays]);
  // Meaningless zoomed all the way out — a site plan is building-scale detail.
  const SITE_PLAN_MIN_ZOOM = 15;
  const visibleSitePlanOverlays = useMemo(
    () => (zoom != null && zoom < SITE_PLAN_MIN_ZOOM ? [] : sitePlanOverlays),
    [sitePlanOverlays, zoom]
  );

  const [activeOverlayId, setActiveOverlayId] = useState(null); // armed for move/scale/rotate editing
  useEffect(() => { activeOverlayIdRef.current = activeOverlayId; }, [activeOverlayId]);
  const commitPlacementRef = useRef(null); // set by SitePlansSection; called once per finished drag
  const commitOverlayPlacement = (id, placement) => { commitPlacementRef.current && commitPlacementRef.current(id, placement); };

  // A sensible starting size/position for a freshly placed overlay: centered on the current map
  // view, sized to a fraction of it (mirrors the Site Planner reference-image panel's own "Size
  // to view" button). Pure sizing math lives in overlayGeoref.js; only the live view is read here.
  const suggestPlacement = (imgW, imgH) => {
    const m = mapRef.current;
    if (!m || !imgW || !imgH) return null;
    const c = m.getCenter();
    const size = m.getSize();
    const midY = size.y / 2;
    const pL = m.containerPointToLatLng([0, midY]), pR = m.containerPointToLatLng([size.x, midY]);
    const gL = projectToGrid(pL.lat, pL.lng), gR = projectToGrid(pR.lat, pR.lng);
    const viewWidthFt = Math.hypot(gR.x - gL.x, gR.y - gL.y);
    return { centerLat: c.lat, centerLon: c.lng, ftPerPx: suggestFtPerPx(viewWidthFt, imgW), rotationDeg: 0 };
  };

  const [clickableOverlayId, setClickableOverlayId] = useState(null); // "pin a comp" mode, armed on one overlay
  const startPinOnOverlay = (id) => { setActiveOverlayId(null); setClickableOverlayId(id); };
  const stopPinOnOverlay = () => setClickableOverlayId(null);
  const placeCompOnOverlay = (overlay, latlng) => {
    setClickableOverlayId(null);
    const sitePlanPoint = latLonToImagePoint(overlay, overlay.imgW, overlay.imgH, latlng.lat, latlng.lng);
    onPlaceComp && onPlaceComp({
      kind: "site_plan", lat: latlng.lat, lon: latlng.lng,
      sitePlanOverlayId: overlay.id, sitePlanPoint,
    });
  };
  const selectOverlay = (id) => { setClickableOverlayId(null); setActiveOverlayId(id); };
  useSitePlanOverlayLayers(mapRef.current, visibleSitePlanOverlays, {
    pinTargetId: clickableOverlayId, onPinClick: placeCompOnOverlay,
    activeId: activeOverlayId, onSelect: selectOverlay, onCommitPlacement: commitOverlayPlacement,
  });

  // "Open source brochure" from a comp's detail view (CompsPanel) — reuses the existing
  // cross-workspace open-review intent (Shell.openReviewInDocReview), the same one Library
  // uses, at the overlay's own page.
  const openOverlayBrochure = (overlay) => {
    onOpenReviewInDocReview && onOpenReviewInDocReview(
      { id: overlay.reviewId, project_id: overlay.projectId || null, title: overlay.docTitle || "Site plan" },
      { page: overlay.page }
    );
  };

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

  // ---- Drag-and-drop a brochure straight onto the map (NEW-2, second amendment) ------------
  // The owner's explicit ask: this is the PRIMARY way a brochure gets in (they arrive as email
  // attachments dragged out of Downloads), and the file-picker inside SitePlansSection stays
  // only as the fallback. THE GOTCHA: a browser's default reaction to a dropped file is to
  // navigate the whole tab to it — miss the drop zone by a pixel and the app is gone, unsaved
  // state included. `preventDefault` on a drop zone alone does not stop that; it has to happen
  // on `dragover` AND `drop` at the WINDOW level, gated on `dataTransfer.types.includes("Files")`
  // so a file drag is never confused with the map's own pan-by-drag, the planner's element drag,
  // or the schedule's row drag — none of which use the browser's HTML5 Drag and Drop API, so
  // none of them can trip this gate.
  const dropIntakeRef = useRef(null); // set by SitePlansSection; called with (fileList, dropPlacement)
  const [fileDragActive, setFileDragActive] = useState(false);
  const fileDragDepth = useRef(0); // dragenter/dragleave fire per element crossed, not per drag — a counter avoids flicker
  const onRejectDroppedFile = (name, reason) => setErr(`Couldn't add "${name}" — ${reason}.`);

  useEffect(() => {
    const isFileDrag = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files");
    const onDragEnter = (e) => {
      if (!visible || !isFileDrag(e)) return;
      e.preventDefault();
      fileDragDepth.current += 1;
      setFileDragActive(true);
    };
    const onDragOver = (e) => {
      if (!visible || !isFileDrag(e)) return;
      e.preventDefault(); // the whole point — without this the browser navigates the tab to the file
      e.dataTransfer.dropEffect = "copy";
    };
    const onDragLeave = (e) => {
      if (!visible || !isFileDrag(e)) return;
      e.preventDefault();
      fileDragDepth.current = Math.max(0, fileDragDepth.current - 1);
      if (fileDragDepth.current === 0) setFileDragActive(false);
    };
    const onDrop = (e) => {
      if (!visible || !isFileDrag(e)) return;
      e.preventDefault(); // stop the tab-navigation gotcha on the actual drop too, not just dragover
      fileDragDepth.current = 0;
      setFileDragActive(false);
      const files = e.dataTransfer.files;
      if (!files || !files.length) return;
      setMode("comp");
      if (!sitesPanelOpen) toggleSitesPanel();
      let dropPlacement = null;
      const m = mapRef.current;
      if (m) { const ll = m.mouseEventToLatLng(e); dropPlacement = { centerLat: ll.lat, centerLon: ll.lng }; }
      dropIntakeRef.current && dropIntakeRef.current(files, dropPlacement);
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [visible, sitesPanelOpen]);

  // NEW-COMPS/NEW-2 — a comp pin just dropped or an existing comp's marker just got clicked: the
  // Comps tab is what should be showing to act on it, wherever the rail happened to be pointed.
  useEffect(() => {
    if (!pendingCompAnchor && !focusCompId) return;
    setModeRaw("comp");
    try { localStorage.setItem("planarfit:mapMode:v1", "comp"); } catch (_) { /* private mode */ }
    setSitesPanelOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCompAnchor, focusCompId]);
  // Layers/imagery panel: on a phone it collapses to a tap (default closed) so it stops
  // covering the search bar; desktop keeps it always-open as before.
  /* B427409 — the panel's open state now PERSISTS, on the `sitesPanelClosed` pattern one state
   * above. Making it collapsible on desktop without remembering the choice would mean re-closing
   * it on every visit, which is its own small version of the same complaint. Phone still defaults
   * CLOSED (it would otherwise cover the search bar) and desktop still defaults OPEN, so nothing
   * moves for anyone until they touch the control; only an explicit choice is stored. */
  const [layersPanelOpen, setLayersPanelOpen] = useState(() => {
    let stored = null;
    try { stored = localStorage.getItem("planarfit:layersPanelClosed:v1"); } catch (_) { /* private mode */ }
    if (stored === "1") return false;
    if (stored === "0") return true;
    try { return !window.matchMedia("(max-width: 760px)").matches; } catch (_) { return true; }
  });
  /* One control drives both breakpoints (B427409). The phone half is unchanged: opening Layers
   * there closes Your sites, because the two overlays would otherwise stack on a narrow screen. */
  const toggleLayersPanel = () => setLayersPanelOpen((v) => {
    const n = !v;
    try { localStorage.setItem("planarfit:layersPanelClosed:v1", n ? "0" : "1"); } catch (_) { /* private mode */ }
    if (n) { try { if (window.matchMedia("(max-width: 760px)").matches) setSitesPanelOpen(false); } catch (_) {} }
    return n;
  });
  /* B831778 (NEW-3) — THE LOAD-BEARING REQUIREMENT: what's DRAWN on the map is independent of
   * which rail tab (or toolbar switch position) is active. Two plain checkboxes, both ON by
   * default, live in the Imagery & layers panel below; the site/comp map-layer effects filter on
   * these — and ONLY these — never on `mode`. Switching tabs changes what you BROWSE and what an
   * add-action is ABOUT; it must never change what's PAINTED. (Michael: "If selecting the Comps
   * tab hides site pins, the design has failed.") */
  const [showSitesLayer, setShowSitesLayer] = useState(() => {
    try { return localStorage.getItem("planarfit:mapShowSites:v1") !== "0"; } catch (_) { return true; }
  });
  const [showCompsLayer, setShowCompsLayer] = useState(() => {
    try { return localStorage.getItem("planarfit:mapShowComps:v1") !== "0"; } catch (_) { return true; }
  });
  const toggleShowSitesLayer = (v) => { setShowSitesLayer(v); try { localStorage.setItem("planarfit:mapShowSites:v1", v ? "1" : "0"); } catch (_) {} };
  const toggleShowCompsLayer = (v) => { setShowCompsLayer(v); try { localStorage.setItem("planarfit:mapShowComps:v1", v ? "1" : "0"); } catch (_) {} };
  const [hoverRow, setHoverRow] = useState(null);
  // Jurisdiction for the Layers panel — follows the map's current area (B13). NEW-1: seeded
  // from where the map is about to OPEN rather than from a hardcoded "harris", so a
  // Colorado-only account never flashes a Harris County panel before the first `moveend`.
  const [viewCounty, setViewCounty] = useState(() => { const c = landingView(sites).center; return countyForView(c[0], c[1]); });
  const [viewState, setViewState] = useState(null); // NEW-2 — the state the map centre is in (see the LayerPanel prop below)
  const [confirmDel, setConfirmDel] = useState(null); // site pending delete confirmation
  const [nameFilter, setNameFilter] = useState(""); // type-to-filter the list by name
  // B855952/B855953/B855954 (NEW-1/NEW-2/NEW-3) — the Sites panel's own cross-device arrangement:
  // which group order the user dragged into, which groups are collapsed, and which sites are
  // pinned to the top. ONE account-scope bag (lib/userPrefs.js's `sitesPanel`), same
  // load-then-commit shape SitePlanner.jsx's `userPrefs`/`commitUserPrefs` already uses for
  // Standards — instant local paint from the mirror, replaced by the real cross-device value once
  // the account row loads, LOUD (never silent) on a failed write.
  const [acctPrefs, setAcctPrefs] = useState(() => readMirror());
  const acctPrefsRef = useRef(acctPrefs);
  acctPrefsRef.current = acctPrefs;
  const sitesPanelPrefs = acctPrefs.sitesPanel;
  const [prefsSaveWarn, setPrefsSaveWarn] = useState(null);
  const prefsSaveWarnTimer = useRef(null);
  useEffect(() => () => clearTimeout(prefsSaveWarnTimer.current), []);
  const commitAcctPrefs = (next) => {
    setAcctPrefs(next);
    saveUserPrefs(myUid, next).then((res) => {
      // "Not signed in" is the ordinary, expected state for arranging this panel signed out (the
      // header's own "Cloud off" chip already says so) — never a failure to warn about on every
      // single pin/collapse/drag. LOUD-FAILURE is for a SIGNED-IN write that genuinely couldn't
      // reach the account.
      if (res.ok || res.error === "not signed in") return;
      clearTimeout(prefsSaveWarnTimer.current);
      setPrefsSaveWarn(`⚠ Saved on this computer only — couldn't reach your account (${res.error}).`);
      prefsSaveWarnTimer.current = setTimeout(() => setPrefsSaveWarn(null), 7000);
    });
  };
  const patchSitesPanel = (patch) => commitAcctPrefs(setSitesPanelPref(acctPrefsRef.current, patch));
  const groupCollapsedFor = (st) => !!sitesPanelPrefs.collapsed[st];
  const toggleGroup = (st) => patchSitesPanel({ collapsed: { ...sitesPanelPrefs.collapsed, [st]: !groupCollapsedFor(st) } });
  // NEW-2 — pinned site ids, most-recently-pinned first. A pinned site LEAVES its status group
  // (rendered in the Pinned section instead) rather than appearing twice.
  const pinnedIds = sitesPanelPrefs.pinned;
  const pinnedSet = useMemo(() => new Set(pinnedIds), [pinnedIds]);
  const togglePin = (id) => patchSitesPanel({ pinned: pinnedSet.has(id) ? pinnedIds.filter((x) => x !== id) : [id, ...pinnedIds] });
  // NEW-3 — the user's drag order for the five status groups; empty = today's default order.
  // Any status not named (a future status type) is appended at the end, never dropped.
  const orderedStatuses = useMemo(() => {
    const saved = sitesPanelPrefs.order.filter((s) => STATUSES.includes(s));
    if (!saved.length) return STATUSES;
    return [...saved, ...STATUSES.filter((s) => !saved.includes(s))];
  }, [sitesPanelPrefs.order]);
  const [hoverGroup, setHoverGroup] = useState(null); // status key whose drag handle should show
  const [dragGroup, setDragGroup] = useState(null);   // status key currently being dragged
  const moveGroup = (st, dir) => {
    const cur = orderedStatuses;
    const i = cur.indexOf(st), j = i + dir;
    if (i < 0 || j < 0 || j >= cur.length) return;
    const next = cur.slice();
    [next[i], next[j]] = [next[j], next[i]];
    patchSitesPanel({ order: next });
  };
  const dropGroup = (targetSt) => {
    if (!dragGroup || dragGroup === targetSt) return;
    const cur = orderedStatuses;
    const from = cur.indexOf(dragGroup), to = cur.indexOf(targetSt);
    if (from < 0 || to < 0) return;
    const next = cur.slice();
    next.splice(from, 1);
    next.splice(to, 0, dragGroup);
    patchSitesPanel({ order: next });
    setDragGroup(null);
  };
  // NEW-1 — largest first / A–Z / recently touched, applied WITHIN each group (and within Pinned).
  const acresOf = (s) => { const b = siteBoundaryInfo(s, parcelSummary); return b.known && b.hasBoundary ? b.acres : -1; };
  const nameOf = (s) => (s.site || s.name || "Untitled site").toLowerCase();
  // B845089 (NEW-2) — the group's real last EDIT (max(site_elements.updated_at) across every plan
  // in the project), never `s.updatedAt` (`sites.updated_at`) — that column only advances on a
  // header change, not a drawing edit, so sorting by it made "Recently touched" mean "recently
  // opened" instead. `null` (unresolved fetch) sorts as if never touched, not as most-recent.
  const lastEditedOf = (s) => (lastEditedByGroup ? (lastEditedByGroup[s.groupId || s.id] ?? null) : null);
  const sortRows = (rows) => {
    const arr = rows.slice();
    if (sitesPanelPrefs.sort === "largest") arr.sort((a, b) => acresOf(b) - acresOf(a));
    else if (sitesPanelPrefs.sort === "az") arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    else arr.sort((a, b) => (lastEditedOf(b) ?? 0) - (lastEditedOf(a) ?? 0)); // "recent"
    return arr;
  };
  const setSitesSort = (sort) => patchSitesPanel({ sort });
  const [statusMenu, setStatusMenu] = useState(null); // {site, x, y} — right-click status picker
  const [mapMenu, setMapMenu] = useState(null);       // {x, y} — right-click-on-empty-map menu (KMZ export) (B684)
  const [hoverLL, setHoverLL] = useState(null);       // {lat, lng} — live "you are here" GPS readout (B683)
  // B706 / NEW-2: always a STATE, never silence. `zoom` picks the lattice band the cursor
  // tile is warmed at, so with contours on it's the tile they already fetched.
  const hoverEl = useGroundElevation(hoverLL, { zoom });
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
  // NEW-2 — a confirmation the owner asked for: "not really clear that it's sharing anything."
  // A clean share/unshare used to close the menu and say nothing at all — the only evidence was
  // the project row eventually relabelling itself, with no causal link back to the click. Reuses
  // the map's existing bottom-left toast slot (mutually exclusive with `err`), auto-dismissing.
  const [shareNotice, setShareNotice] = useState(null);
  const shareNoticeTimer = useRef(null);
  useEffect(() => () => clearTimeout(shareNoticeTimer.current), []);
  const flashShareNotice = (msg) => {
    clearTimeout(shareNoticeTimer.current);
    setShareNotice(msg);
    shareNoticeTimer.current = setTimeout(() => setShareNotice(null), 6000);
  };
  const teamName = (id) => { const t = myTeams.find((x) => x.id === id); return t ? t.name : "a team"; };
  const refreshTeams = async () => {
    const { uid } = await currentIdentity();
    setMyUid(uid);
    if (!uid) { setMyTeams([]); return; }
    try { setMyTeams(await listMyTeams()); } catch (_) { /* keep prior list on transient error */ }
  };
  useEffect(() => { let live = true; (async () => { const { uid } = await currentIdentity(); if (!live) return; setMyUid(uid); if (uid) { try { const t = await listMyTeams(); if (live) setMyTeams(t); } catch (_) {} } })(); return () => { live = false; }; }, []);
  // B855952/B855953/B855954 — replace the local mirror with the real cross-device Sites-panel
  // arrangement once the account row loads (mirrors SitePlanner.jsx's identical `userPrefs` load).
  // Re-runs once `myUid` resolves from null → a real id (or stays null, signed out — the local
  // mirror / signed-out default is what `loadUserPrefs` already returns for that case).
  useEffect(() => {
    let live = true;
    loadUserPrefs(myUid).then((res) => { if (live) setAcctPrefs(res.prefs); });
    return () => { live = false; };
  }, [myUid]);
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
  const exportSitesKmz = async (extrude = false) => {
    setMapMenu(null);
    try {
      // B1042 — the KMZ writer loads only when a Google Earth export is actually asked for,
      // so it never rides the planner's boot bundle. It is the one dependency here.
      const { siteToFeatures, buildKmz, kmzFilename, KMZ_MIME } = await import("./lib/kmzExport.js");
      const projectFor = (o) => (pt) => { const [la, ln] = feetToLatLng(pt, o.lat, o.lon); return [ln, la]; };
      const features = [];
      sites.forEach((site) => {
        if (!site.origin) return;
        // Dimension lines off. Dock doors always export, as one run per dock side — and neither
        // is read off each saved site's own settings, so a multi-site file cannot vary with what
        // someone happened to have shown on screen when they last saved plan #3.
        features.push(...siteToFeatures(site, projectFor(site.origin), { extrudeBuildings: extrude, includeDimensions: false, prefix: [site.site || site.name || "Site"] }));
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
    const label = site.site || site.name || "This project";
    setShareBusy(true);
    const r = await sharingLib().then(
      ({ shareProject, makeProjectPrivate }) => (teamId ? shareProject(gid, teamId) : makeProjectPrivate(gid)),
      /* LOUD-FAILURE: a chunk that fails to load must read as a failed share, never as a
         silent success — the busy state below clears either way. */
      (e) => ({ ok: false, error: `Couldn't load the sharing tools: ${(e && e.message) || "network error"}.` }),
    );
    setShareBusy(false);
    setStatusMenu(null);
    setShareNotice(null); // an error and a confirmation never both stand — the outcome below picks one
    if (!r || !r.ok) { setErr((r && r.error) || "Couldn't update sharing."); return; }
    /* NEW-1 — branch on the NAMED outcome, never on a row count. The old test was
     * `if (teamId && r.sites === 0)` → "This project isn't in the cloud yet", which fired every time
     * an ALREADY-SHARED project was shared again: that write legitimately changes 0 rows, and 0 rows
     * changed is not 0 rows existing. It was reported on "8 South" at version 587, shared for weeks.
     * Only "not-found" may say that now, and on a migrated database that state is reported
     * explicitly rather than inferred from a zero. */
    if (r.outcome === "not-found") {
      setErr("This project isn't in the cloud yet — open it once to sync, then share.");
      return;
    }
    /* NEW-3, LOUD-FAILURE: the RPC re-counts its own group after writing, so a share that reached
     * only some of a project's plans says so instead of looking like a success. A half-UNSHARE is
     * the dangerous direction — a teammate keeps access the owner thinks he revoked — so it is
     * named as still-shared rather than softened. */
    if (r.mismatched > 0) {
      setErr(teamId
        ? `Only part of this project was shared — ${r.mismatched} of ${r.matched} plans didn't take. Try again.`
        : `Only part of this project was made private — ${r.mismatched} of ${r.matched} plans are STILL shared. Try again.`);
      onSharedChange && onSharedChange();
      return;
    }
    // A project holding a teammate's plan is shared as far as it can be: your rows moved, theirs are
    // deliberately left alone. Say that rather than reporting a clean success for a partial one.
    if (teamId && r.foreign > 0) {
      setErr(`Shared your ${r.matched} of ${r.plans} plans — the rest belong to a teammate and were left as they are.`);
      onSharedChange && onSharedChange();
      return;
    }
    // NEW-2 — the clean-success case: the RPC changed exactly the rows it meant to and nothing is
    // left unsaid. Confirm it happened, scoped to what actually moved (site plans only — Notes,
    // Library, Review and Schedule were never touched), so the click has a visible after-state
    // beyond the row eventually relabelling itself on the next render.
    flashShareNotice(teamId
      ? `Shared “${label}”'s site plans with ${teamName(teamId)} — Notes, Library, Review and Schedule stay private.`
      : `“${label}” is private again — its site plans are no longer shared.`);
    onSharedChange && onSharedChange();
  };
  // The name filter (case-insensitive substring on the site/plan name) — B855952 (NEW-1) removed
  // the status chip filter outright (collapsing a group is the filter now; see the Sites-panel
  // render below), so this is the only list-narrowing predicate left.
  const nf = nameFilter.trim().toLowerCase();
  const passName = (s) => !nf || (s.site || s.name || "").toLowerCase().includes(nf);

  const clearHilites = () => {
    const map = mapRef.current;
    Object.values(hilitesRef.current).forEach((p) => map && map.removeLayer(p));
    hilitesRef.current = {};
  };

  /* create the map once */
  useEffect(() => {
    /* NEW-1 — the opening view is DERIVED from the user's own saved sites (see
     * `lib/landingView.js`), never hardcoded. This used to be `COUNTIES_MAP.harris`, so every
     * account on earth opened over Houston, Texas. Sites can still be loading at this instant
     * (the cloud list arrives later), which is fine: an account with nothing located yet is
     * exactly the continental-US case, and the effect below re-lands once the list is in —
     * but only while the user hasn't touched the map. */
    const cfg = landingView(sitesRef.current, viewportOf(elRef.current));
    // ⛔ B427408 — THE ZOOM CONTROL OWNS THE BOTTOM-LEFT CORNER AT EVERY BREAKPOINT, AND THE
    // BREAKPOINT BRANCH THAT USED TO LIVE HERE IS GONE ON PURPOSE.
    //
    // What was here before moved the control to `bottomleft` on a phone and left it at `topleft`
    // on desktop, with a comment that said in as many words: "Desktop is unchanged (top-left,
    // where the Your-sites panel sits over it as before)". The Your-sites panel is `top: 10,
    // left: 10, width: 232` — the SAME corner Leaflet puts `topleft` in — so on desktop the panel
    // covered the control completely: the owner could not press `+` at all, and only the bottom
    // sliver of `−` showed below the panel. The occlusion was seen, fixed for one breakpoint, and
    // knowingly left on the other.
    //
    // ⛔ NOT A z-index FIX. Raising the control above the panel just moves the collision — the
    // buttons would then sit on top of the site list and eat presses meant for it. The fix is a
    // corner nothing else claims, and there is exactly one: `topleft` is the sites panel (desktop)
    // / the search bar (phone), `topright` is the layers panel, `bottomright` is the scale bar.
    //
    // ONE POSITION, NO BRANCH — which is also the point. Two of the six defects in this block
    // exist because the desktop path was left behind while the phone path was fixed; a control
    // whose position does not depend on the breakpoint cannot drift apart again.
    // NEW-6 — "I can't zoom out far enough" was THIS, and only this: a hard `minZoom: 8` floor on
    // the Leaflet map. It was not the tile sources (both Esri World Imagery and USGS serve from
    // z0), not a bounds clamp (no `maxBounds` is ever set), and not the projection (one Web
    // Mercator for the whole world). At z8 the view spans a few counties, so there was no way to
    // pull back and see another state at all — you could only jump by picking a site.
    // z3 puts the continent on screen, which is what a two-state product needs.
    const map = L.map(elRef.current, { zoomControl: false, minZoom: 3, maxZoom: 21 }).setView(cfg.center, cfg.zoom);
    // "Locate me" (NEW — mobile pinch/locate/telemetry lap): a 3rd button stacked directly below
    // the zoom control (same `bottomleft` corner — every OTHER corner is already claimed, per
    // mapChromeStack.js's rule; a control belongs beside the map's other controls, not fighting a
    // panel for a corner). Plain L.DomUtil/L.DomEvent rather than an L.Control subclass — this is
    // the file's first custom control and a bespoke class buys nothing a closure doesn't already.
    // ⛔ Added to the map BEFORE the zoom control on purpose — Leaflet's bottom-corner containers
    // stack a LATER-added control ABOVE an earlier one (measured: reversing this order put the
    // locate button above zoom's +/−, not below it), so "below" requires adding it first.
    let detachPermWatch = () => {};
    (() => {
      // NEW-3 (map landing radius audit) — "leaflet-control-locate" is OUR class, not Leaflet's;
      // it exists only so index.css can give this hand-rolled control the same corner treatment as
      // the zoom stack it sits directly above (Leaflet's generic "leaflet-bar" alone left it at the
      // vendor default 4px while the zoom bar right next to it reads 8px — two adjacent rounded
      // boxes with two different curves, the exact class of drift this pass exists to close).
      const container = L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-locate");
      const btn = L.DomUtil.create("a", "", container);
      btn.href = "#"; btn.setAttribute("role", "button"); btn.setAttribute("aria-label", "Find my location"); btn.setAttribute("data-testid", "locate-me-btn"); btn.setAttribute("data-locate-state", "idle");
      btn.style.display = "flex"; btn.style.alignItems = "center"; btn.style.justifyContent = "center"; btn.style.color = "var(--chrome-text)";
      btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>';
      locateBtnRef.current = btn;
      L.DomEvent.disableClickPropagation(container);

      /* NEW-MAPCTRL-2 — HONEST STATES, checked BEFORE ever calling getCurrentPosition.
       *
       * ⛔ CORRECTED (owner measurement, same day): the first cut of this comment claimed the
       * `permissions.query` precheck below was what would catch the owner's company-blocked
       * Chrome. It is NOT — he measured `navigator.permissions.query({name:'geolocation'})` on
       * his real machine, on the real deployed app, and it reports **'prompt'**, not 'denied'.
       * An enterprise policy of this shape (Chrome's `DefaultGeolocationSetting`) blocks the
       * REQUEST silently — it does not pre-announce itself through the Permissions API. So
       * `locateAvailability` reads his environment as "ready" and the click proceeds exactly
       * like any other — this precheck is a DEMOTED, best-effort convenience for the states it
       * actually can see (STEEL-MAN v/vi, and a genuine 'denied' from a real per-site browser
       * block or an already-answered "no" — a different case from his), never the defence for
       * his case.
       *
       * THE ACTUAL DEFENCE against his case is below, in the click handler and the two async
       * handlers: an EXPLICIT, FINITE `timeout` on the `map.locate()` call itself (never the
       * PositionOptions default of Infinity — an infinite timeout on a request that never
       * resolves is a permanent spinner, which is exactly his report), PLUS an independent
       * wall-clock `locateWatchdogRef` timer that fires on its own regardless of whether
       * `navigator.geolocation` ever invokes either callback — which a policy-blocked provider
       * is free to never do (STEEL-MAN ii). Both are demonstrated with a mocked
       * `getCurrentPosition` that calls back NEITHER way (`ui-audit/verify-locate-me.mjs`), the
       * closest reproduction of his environment this sandbox can build without a real blocked
       * browser, since a genuine permission prompt cannot be driven by automation (STEEL-MAN's
       * own testability requirement).
       *
       * `applyAvailability` is the ONE place the control's visual "blocked" state is set —
       * opacity only, never a hardcoded grey, so it reads correctly in both themes — and it is
       * also what a live permission CHANGE (an admin lifts a real per-site block) re-runs, via
       * the `change` subscription below. It still earns its place: a 'denied' state IS real for
       * other users/browsers, and skipping a call already known to fail is a plain improvement
       * over always asking — it is simply not what fixes THIS report. */
      const applyAvailability = (availability) => {
        geoAvailabilityRef.current = availability;
        const blocked = availability !== "ready";
        const tip = locateUnavailableTooltip(availability);
        btn.title = tip;
        btn.setAttribute("aria-label", blocked ? `Find my location — ${tip}` : "Find my location");
        btn.setAttribute("data-locate-state", locatingRef.current ? "locating" : (blocked ? "blocked" : "idle"));
        btn.style.opacity = blocked ? "0.4" : "";
        btn.style.cursor = blocked ? "default" : "pointer";
      };
      const readEnv = (permissionState) => ({
        isSecureContext: typeof window === "undefined" || window.isSecureContext !== false,
        hasGeolocation: typeof navigator !== "undefined" && !!navigator.geolocation,
        permissionState,
      });
      applyAvailability(locateAvailability(readEnv(undefined)));
      // STEEL-MAN i/vi — ask what the browser already knows. Not every engine implements
      // permissions.query for "geolocation" (older Safari among them); where it's missing we
      // simply can't know ahead of time, and the reactive locationerror handler below still
      // gives an honest answer either way, so this is a pure enhancement, never a dependency.
      if (typeof navigator !== "undefined" && navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: "geolocation" }).then((status) => {
          if (!mapRef.current) return; // unmounted before this resolved
          geoPermissionRef.current = status;
          applyAvailability(locateAvailability(readEnv(status.state)));
          const onChange = () => applyAvailability(locateAvailability(readEnv(status.state)));
          if (status.addEventListener) status.addEventListener("change", onChange); else status.onchange = onChange;
          detachPermWatch = () => { try { status.removeEventListener ? status.removeEventListener("change", onChange) : (status.onchange = null); } catch (_) {} };
        }).catch(() => { /* STEEL-MAN vi — a Permissions-Policy header can make the query itself reject; fall back to the reactive path */ });
      }

      const clearWatchdog = () => { if (locateWatchdogRef.current) { clearTimeout(locateWatchdogRef.current); locateWatchdogRef.current = null; } };
      // STEEL-MAN xii — every exit from "locating" (found, error, cancel, watchdog) funnels
      // through here, so the control can never stick in a spinner or an error look.
      const stopLocating = () => {
        locatingRef.current = false;
        clearWatchdog();
        btn.style.animation = "";
        applyAvailability(geoAvailabilityRef.current);
      };
      L.DomEvent.on(btn, "click", (e) => {
        L.DomEvent.stop(e);
        if (locatingRef.current) {
          // STEEL-MAN xi — a 2nd press while a fix is in flight CANCELS it rather than being a
          // no-op or starting a concurrent 2nd request (STEEL-MAN x). The browser's
          // getCurrentPosition itself cannot be aborted, but `stopLocating` flips locatingRef
          // back to idle immediately, and both async handlers below check it first — so a late
          // result that arrives after this click is silently ignored rather than reviving the UI.
          try { map.stopLocate(); } catch (_) {}
          stopLocating();
          return;
        }
        if (geoAvailabilityRef.current !== "ready") {
          // STEEL-MAN i/v/vi — a control already known to be blocked never spins; LOUD-FAILURE
          // says why, once. NEW-4 — anchored to THIS button (AnchoredMenu, above), not the
          // generic page-corner `err` banner: the old page-level placement is exactly what read
          // as unrelated to the control that produced it.
          showLocateNotice(locateUnavailableTooltip(geoAvailabilityRef.current));
          return;
        }
        setLocateFar(false);
        locatingRef.current = true;
        btn.setAttribute("data-locate-state", "locating");
        btn.style.animation = "spin 1s linear infinite"; btn.style.opacity = "0.6";
        try {
          // ⛔ THE REAL DEFENCE (owner-corrected) — an EXPLICIT, FINITE `timeout`. The
          // PositionOptions default is Infinity, which is the literal cause of a spinner that
          // never stops: a policy-blocked or hung geolocation provider is free to invoke NEITHER
          // callback, and with no timeout set nothing ever ends the request. 10s here, comfortably
          // inside the "short, 8-10s" the owner asked for.
          // maximumAge:0 — STEEL-MAN viii: never accept a cached fix, possibly hours old and in
          // another city, over a fresh one. setView is deliberately NOT passed here; the
          // locationfound handler below decides for itself whether this fix is even usable
          // (STEEL-MAN vii) before ever moving the camera.
          map.locate({ enableHighAccuracy: true, maxZoom: 17, timeout: 10000, maximumAge: 0 });
        } catch (_) {
          // STEEL-MAN vi — a Permissions-Policy violation or a blocked iframe can throw
          // synchronously instead of going through the normal error callback.
          stopLocating();
          setErr(locateErrorMessage());
          return;
        }
        // ⛔ STEEL-MAN ii, THE SECOND HALF OF THE REAL DEFENCE — an INDEPENDENT wall-clock timer,
        // never trusting the browser's own timeout alone. `map.locate`'s `timeout` option only
        // bounds the underlying `getCurrentPosition` call; it does nothing if the provider (or a
        // policy) prevents that call from ever being answered in a way the browser itself detects.
        // This plain `setTimeout` fires regardless of whether `navigator.geolocation` EVER invokes
        // either callback — proven with a mocked `getCurrentPosition` that calls back neither way
        // (`ui-audit/verify-locate-me.mjs`'s "unanswered prompt" arm) — a couple of seconds past
        // the explicit timeout above, so the spinner can never run forever.
        locateWatchdogRef.current = setTimeout(() => {
          if (!locatingRef.current) return; // already resolved or cancelled
          try { map.stopLocate(); } catch (_) {}
          stopLocating();
          setErr(locateErrorMessage(3));
        }, 12000);
      });
      const ctrl = L.control({ position: "bottomleft" });
      ctrl.onAdd = () => container;
      ctrl.addTo(map);

      map.on("locationfound", (e) => {
        if (!locatingRef.current) return; // stale result after a cancel/watchdog — already idle, ignore
        stopLocating();
        // STEEL-MAN vii — a bad-enough fix (classically desktop IP positioning, 20-50 km) is not
        // a location at all: never fly the map to it and never draw an accuracy circle over half
        // a county. Treat it exactly as a failure, with an honest reason.
        if (!isAccuracyUsable(e.accuracy)) {
          setErr(garbageAccuracyMessage(e.accuracy));
          return;
        }
        // isAccuracyUsable already proved e.accuracy is finite and > 0 — matches Leaflet's own
        // internal setView-on-locate fit (`latlng.toBounds(accuracy * 2)`), replicated here
        // rather than relying on Leaflet's `setView:true` because that option can't be told
        // "only when the fix is usable" (STEEL-MAN vii).
        const zoom = Math.min(map.getBoundsZoom(e.latlng.toBounds(e.accuracy * 2)), 17);
        map.setView(e.latlng, zoom);
        if (!locateLayerRef.current) locateLayerRef.current = L.layerGroup().addTo(map);
        locateLayerRef.current.clearLayers();
        L.circleMarker(e.latlng, { radius: 7, color: "#fff", weight: 2, fillColor: PAL.accent, fillOpacity: 1, interactive: false }).addTo(locateLayerRef.current);
        if (shouldShowAccuracyCircle(e.accuracy)) {
          L.circle(e.latlng, { radius: e.accuracy, color: PAL.accent, weight: 1, fillColor: PAL.accent, fillOpacity: 0.12, interactive: false }).addTo(locateLayerRef.current);
        } else {
          // Wi-Fi/cellular fallback (no GPS chip, or GPS unavailable) — the map still centers on
          // the best guess it has, but a multi-hundred-metre-or-worse radius is not honestly
          // drawn as a precise "you are here" ring (KEY DECISIONS: never present a vague guess as
          // a precise location).
          const acc = formatAccuracyFt(e.accuracy);
          setErr(acc ? `Location is approximate (accuracy ${acc}) — this looks like a network-based guess, not a GPS fix.` : "Location found, but its accuracy couldn't be read — treat it as approximate.");
        }
        // STEEL-MAN ix — genuinely far from every saved site is the RIGHT place to fly to (it's
        // where the user is), but it must leave a way back rather than stranding the camera.
        if (sitesRef.current.length) {
          const lv = landingView(sitesRef.current, viewportOf(elRef.current));
          setLocateFar(lv.source === "sites" && milesBetween({ lat: e.latlng.lat, lon: e.latlng.lng }, { lat: lv.center[0], lon: lv.center[1] }) > CLUSTER_RADIUS_MI);
        }
      });
      map.on("locationerror", (e) => {
        if (!locatingRef.current) return; // stale result after a cancel/watchdog — already idle, ignore
        stopLocating();
        setErr(locateErrorMessage(e && e.code));
      });
    })();
    L.control.zoom({ position: "bottomleft" }).addTo(map);
    mapRef.current = map;
    L.control.scale({ imperial: true, metric: false, position: "bottomright", maxWidth: 130 }).addTo(map); // graphic scale (B96b)
    setZoom(map.getZoom());
    const onClick = (e) => {
      if (placingCompPinRef.current) { placeCompPinAtRef.current(e.latlng); return; }
      if (selectModeRef.current) { handleClick(e.latlng); return; }
      // A background click (nothing else claimed it) deselects a site plan armed for editing —
      // its own image click already stops propagation before this ever runs (B848496 NEW-2).
      if (activeOverlayIdRef.current) setActiveOverlayId(null);
    };
    const onZoom = () => setZoom(map.getZoom());
    // Resolve the Layers-panel jurisdiction from the map's current area (B13): pick the
    // county whose extent covers the view centre, so utility overlays are right outside
    // Houston too.
    // NEW-1 — this read `candidateCountiesForPoint(...)[0]`, whose out-of-bbox answer is
    // harris-first BY CONTRACT (click routing depends on that order). With the landing view
    // now derivable to Denver — or to the whole country — that made the panel claim Harris
    // County over Colorado and over Kansas. `countyForView` answers the jurisdiction question
    // on its own terms: bbox hit, else the nearest county IN THE POINT'S OWN STATE.
    const onMove = () => {
      const c = map.getCenter();
      setViewCounty(countyForView(c.lat, c.lng));
      // NEW-2 — the state the view is in, resolved with NO network (siteRegion.js is envelope
      // math). It has to hold when every GIS endpoint is down, which is exactly when a site
      // falls through to a default — the same reason coloradoRegions.js is network-free.
      setViewState(siteState({ lat: c.lat, lng: c.lng }));
    };
    onMove();
    // NEW-1 — seed the zoom too, not just the centre. `zoom` starts null and only `zoomend`
    // wrote it, so before the user's first zoom the Layers panel had no idea what zoom it was
    // looking at and could not report a gated row as dormant at all.
    onZoom();
    /* B209502 — WARM THE COUNTY GEOMETRY, THEN ASK AGAIN.
     *
     * `countyForView` is synchronous and answers from whatever it has: before the polygon asset
     * is resident it returns the old bounding-box guess, and after it returns the real county.
     * Without this call the asset would never load at all and the whole point-in-polygon fix
     * would ship inert but green — the exact failure mode B1120 recorded (a feature that merged,
     * passed CI, and did nothing in production because nobody wired the one call site).
     *
     * The re-ask is what makes the load visible: the first resolve almost always happens before
     * the fetch lands, so a map that opened over Pearland would otherwise sit on "Harris" for the
     * whole session. Guarded on `cancelled` because a fast unmount must not set state. */
    let cancelled = false;
    loadCountyPolygons().then(() => { if (!cancelled && mapRef.current) onMove(); });
    // NEW-1 — the moment the user drives the map themselves, the derived landing view is done
    // for the session. Deliberately keyed on real INPUT (a press, a wheel, a drag) rather than
    // Leaflet's `movestart`/`zoomstart`, which our own programmatic `setView` also fires.
    const markUserMoved = () => { userMovedRef.current = true; landedRef.current = true; };
    const onMouseMove = (e) => {
      if (!selectModeRef.current || draggingRef.current) return; // don't fight the grab cursor while panning
      const inside = selectedRef.current.some((s) => (s.latlngsList || []).some((ll) => pointInPoly(e.latlng.lat, e.latlng.lng, ll)));
      map.getContainer().style.cursor = inside ? REMOVE_CURSOR : ADD_CURSOR;
    };
    const onDragStart = () => { draggingRef.current = true; map.getContainer().style.cursor = "grabbing"; };
    const onDragEnd = () => { draggingRef.current = false; map.getContainer().style.cursor = selectModeRef.current ? ADD_CURSOR : ""; };
    // Live "you are here" GPS readout (B683): the cursor's WGS84 lat/long, coalesced to one
    // update per animation frame so a fast mousemove can't thrash React. Cleared on mouse-out.
    // NEW-1 rides THIS handler — the contour under the cursor is answered from the same
    // already-throttled position, never a second mousemove listener.
    let llLatest = null, llPending = false;
    const onCoordMove = (e) => {
      llLatest = { lat: e.latlng.lat, lng: e.latlng.lng };
      if (llPending) return;
      llPending = true;
      requestAnimationFrame(() => {
        llPending = false;
        if (!llLatest) return;
        setHoverLL(llLatest);
        contourHover(map, llLatest);
      });
    };
    const onCoordOut = () => { setHoverLL(null); contourHover(map, null); };
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
    const onPress = () => { pressedRef.current = true; markUserMoved(); };
    const onRelease = () => {
      pressedRef.current = false;
      if (pendingRebuildRef.current) { const fn = pendingRebuildRef.current; pendingRebuildRef.current = null; setTimeout(fn, 0); }
      if (pendingCompsRebuildRef.current) { const fn = pendingCompsRebuildRef.current; pendingCompsRebuildRef.current = null; setTimeout(fn, 0); }
    };
    containerEl.addEventListener("pointerdown", onPress);
    containerEl.addEventListener("pointerup", onRelease);
    containerEl.addEventListener("pointercancel", onRelease);
    containerEl.addEventListener("wheel", markUserMoved, { passive: true }); // NEW-1 — a scroll-zoom is the user driving too
    map.on("dragstart", markUserMoved);
    /* NEW-2 — hover/click identify for the RASTER-painted overlays. Bound once with the map;
       every gate is read live per event (see the refs above), so nothing here re-binds. */
    const detachRasterIdentify = attachRasterIdentifyLazy(map, {
      getOverlays: () => overlaysRef.current || {},
      // Respect the EXISTING per-layer health probe rather than adding a second liveness
      // mechanism: a layer whose dot already reads "failed" is not re-asked on every hover.
      layerHealthy: (id) => (layerStatusRef.current?.[id]?.state ?? null) !== "failed",
      // Parcel-select owns the pointer while it's on (the B98 rule) — the same gate the
      // vector boundary identify reads. Panning is gated inside attachRasterIdentify.
      identifyOk: () => !selectModeRef.current,
    });
    return () => { cancelled = true; detachRasterIdentify(); detachPermWatch(); if (locateWatchdogRef.current) { clearTimeout(locateWatchdogRef.current); locateWatchdogRef.current = null; } map.off("click", onClick); map.off("zoomend", onZoom); map.off("moveend", onMove); map.off("mousemove", onMouseMove); map.off("mousemove", onCoordMove); map.off("mouseout", onCoordOut); map.off("contextmenu", onMapCtx); map.off("dragstart", onDragStart); map.off("dragend", onDragEnd); map.off("dragstart", markUserMoved); map.off("locationfound"); map.off("locationerror"); containerEl.removeEventListener("pointerdown", onPress); containerEl.removeEventListener("pointerup", onRelease); containerEl.removeEventListener("pointercancel", onRelease); containerEl.removeEventListener("wheel", markUserMoved); map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* NEW-1 — LAND on the user's own market, once.
   *
   * The map is created before the site list is (the cloud list arrives later, and the map can
   * be created at zero size while the planner is the visible mode), so the derived view is
   * re-applied here the moment BOTH are real — and then never again. Two latches keep this an
   * opening position rather than a leash: `landedRef` (we've landed on real sites) and
   * `userMovedRef` (the user has taken the wheel). The `moveend` handler above re-resolves the
   * Layers-panel jurisdiction off the resulting position, so a Colorado landing reads Colorado.
   *
   * Blank-planner sites carry no `origin` and are filtered out inside `landingView`, so an
   * account whose only records are un-located plans still gets the honest country view. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || landedRef.current || userMovedRef.current) return;
    const vp = viewportOf(elRef.current);
    const view = landingView(sites, vp);
    if (view.source !== "sites") return;   // nothing located yet — stay on the continental-US open
    map.setView(view.center, view.zoom, { animate: false });
    // Only LATCH on a real measurement. While the planner is the visible mode this container
    // has no size, so the fit ran against the fallback viewport; showing the market straight
    // away is right, but the next run with real dimensions may refine the zoom by a step.
    if (vp.measured) landedRef.current = true;
  }, [sites, visible, isActive]);

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
    /* NEW-6 — the SAME explicit ceiling the planner's two layers got in B1121. The Map view has
       its own Leaflet map and was left out of that work, and it is never unmounted (SitePlannerApp
       hides it with display:none deliberately, to keep it alive), so its `_tiles` map grew for the
       whole session with nothing but Leaflet's incidental pruning to shed it. Pure EVICTION: no
       retina change, no cap on what can be drawn — a shed tile re-fetches on demand, and
       `capTileCache` never evicts a CURRENT tile, so it cannot punch a hole in the view. */
    const detachCap = boundTileCache(layer, () => tileCacheLimit({
      containerW: (elRef.current && elRef.current.clientWidth) || 1024,
      containerH: (elRef.current && elRef.current.clientHeight) || 768,
      tileSizePx: (layer.getTileSize && layer.getTileSize().x) || 256,
      keepBuffer: MAP_KEEP_BUFFER,
    }));
    imageryCapRef.current = detachCap;
    return () => { detachCap(); imageryCapRef.current = null; try { map.removeLayer(layer); } catch (_) {} };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basemap]);

  /* faint labels overlay (toggle) — initial opacity set from live zoom (B162) */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !labels) return;
    const initOpacity = (map.getZoom() >= PLACE_NAMES_MIN_ZOOM) ? labelsOpacity : 0;
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
    const detachCap = boundTileCache(layer, () => tileCacheLimit({   // NEW-6 — second uncapped layer
      containerW: (elRef.current && elRef.current.clientWidth) || 1024,
      containerH: (elRef.current && elRef.current.clientHeight) || 768,
      tileSizePx: (layer.getTileSize && layer.getTileSize().x) || 256,
      keepBuffer: MAP_KEEP_BUFFER,
    }));
    labelsCapRef.current = detachCap;
    return () => { detachCap(); labelsCapRef.current = null; try { map.removeLayer(layer); } catch (_) {} labelsRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels]);

  /* zoom-driven label opacity (B162): hide road names below PLACE_NAMES_MIN_ZOOM, otherwise use
   * the owner's own opacity (B427410 ×3) — one effect, so the zoom gate and the slider can never
   * fight over which one last wrote `setOpacity`. */
  useEffect(() => {
    const layer = labelsRef.current;
    if (!layer) return;
    layer.setOpacity(zoom != null && zoom >= PLACE_NAMES_MIN_ZOOM ? labelsOpacity : 0);
  }, [zoom, labelsOpacity]);

  /* State + country outlines at wide zoom (NEW-1) — the same shape as the label-opacity
     gate above and the `showPlans` switch below: one boolean derived from the live zoom,
     outside the effect, so crossing the band mounts once instead of re-running per zoom
     step. Everything else (which levels, the geometry, the drawing) lives behind the
     dynamic import in adminBoundaryGate.js and is never fetched at site zoom. The
     controller owns its own `zoomend` handling from there, so this fires once. */
  const wideZoom = adminBoundariesVisible(zoom);
  useEffect(() => {
    if (wideZoom && mapRef.current) attachAdminBoundaries(mapRef.current);
  }, [wideZoom]);

  /* overlay layers (FEMA, NWI, TxRRC, local utilities) — toggle + opacity.
     The add/remove/opacity logic is shared with the planner (one source). The
     pane sits above imagery tiles (200), below the vector pane (400) so parcel
     lines / site plans stay on top.
     NEW-1 — the SAME two stacking bands the planner uses (lib/mapStack.js), both hosted in
     this map's own pane stack: there are no site elements on the finder, so nothing has to
     rise above the drawing — but AREA still paints under LINE, so a floodplain fill can't
     bury the stream running through it. syncOverlayLayers creates the panes it is named. */
  useEffect(() => {
    const sync = () => syncOverlayLayers(mapRef.current, overlays, overlayRefs.current, {
      /* NEW-1 — the map finder has NO site plan, so there is nothing for a layer to be "above":
         the lifted band collapses back onto the area band here. `overlays` is app-shared, so a
         layer the user lifted on the planner arrives with its flag set — pointing `areaFront` at
         the SAME pane is what makes that a no-op instead of a stray extra pane, and because
         mapStack keys the rebuild check on the RESOLVED pane names, it also costs no rebuild. */
      panes: {
        area: PANE_AREA, areaLabel: PANE_AREA_LABEL,
        areaFront: PANE_AREA, areaFrontLabel: PANE_AREA_LABEL,
        line: PANE_LINE, lineLabel: PANE_LINE_LABEL,
      },
      onStatus: (id, state, msg, extra) => setLayerStatus && setLayerStatus((s) => ({ ...s, [id]: state ? { state, msg, ts: extra?.ts ?? null, stale: extra?.stale ?? false } : null })),
      onError: (cfg, msg) => setErr(`“${cfg.label}” layer failed: ${msg || "service may be down or moved"}.`),
      // Boundary hover/click identify (B695) — read live per event; parcel-select mode
      // owns the map's clicks, so the identify yields while it's on (the B98 rule).
      identifyOk: () => !selectModeRef.current,
    });
    sync();
    /* NEW-6 — the re-probe is gated on VISIBLE. This map is never unmounted (SitePlannerApp hides
       it with display:none on purpose, to keep it alive), so this timer used to keep re-syncing —
       and re-fetching — every enabled GIS raster overlay every 45 s for a map nobody was looking
       at, for the whole session. It self-heals a stopped service, which only matters while the map
       is on screen; the effect re-runs on `visible`, so returning to the map syncs immediately and
       then resumes the heartbeat. */
    if (!visible) return undefined;
    // periodic re-probe so stopped services self-heal when the City/County restart
    const iv = setInterval(sync, 45000);
    return () => clearInterval(iv);
  }, [overlays, visible]); // eslint-disable-line

  /* NEW-6 — hand memory back while the Map view is hidden. Two things are released, both pure
     eviction with no visual consequence: the two basemap layers are squeezed to a token ceiling
     (a hidden map needs no look-ahead ring), and every esri raster OVERLAY this map holds — a
     DUPLICATE set of the planner's, each keeping a painted full-viewport <img> alive — is torn
     down through the same `releaseLayer` the planner uses at toggle-off. `syncOverlayLayers`
     rebuilds whatever is still enabled on the way back in (the sync effect above re-runs on
     `visible`), so nothing is lost and no quality changes; the tiles simply re-fetch. */
  useEffect(() => {
    if (visible) return;
    const map = mapRef.current;
    if (!map) return;
    for (const layer of [imageryRef.current, labelsRef.current]) {
      if (layer) { try { capTileCache(layer, HIDDEN_TILE_CAP); } catch (_) {} }
    }
    for (const key of Object.keys(overlayRefs.current)) {
      const layer = overlayRefs.current[key];
      if (!layer) continue;
      try { releaseLayer(map, layer); } catch (_) {}
      delete overlayRefs.current[key];
    }
  }, [visible]);

  /* Hover identify for the RASTER-painted layers (NEW-2). The vector overlays answer a hover
     from their own features (a tooltip bound as they draw — see featureHover.js / vectorOverlay.js),
     but roughly half the registry paints as a server-rendered PICTURE with no features in the
     DOM at all: FEMA, wetlands, the City mains, HCFCD, BKDD, the wells and the CCN/MUD
     territories. Those can only be identified by asking the service, which is what this does —
     debounced on cursor rest, cancelled on move/pan, and always ending in a stated outcome.

     The listeners are bound ONCE with the map (see the map-creation effect above) and read
     `overlays`, the health verdict and the select-mode gate LIVE through these refs — so
     toggling a layer never re-binds a Leaflet handler. */

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
     hidden keep-alive tab (`isActive`: Leaflet sized itself at 0×0 while display:none).

     B842 — re-sync SYNCHRONOUSLY in a LAYOUT effect (before paint) so the revealed map is
     correctly sized in the FIRST visible frame. The old passive `setTimeout(…, 60)` let the
     map paint once at its stale / 0×0 hidden size and then snap to the real size ~60 ms later
     — the reveal "flash" on the map↔plan flip and on returning from a hidden keep-alive tab
     (the less-protected sibling of the Site canvas, which the B65/B837/B933/B962 machinery
     already covers). `invalidateSize(false)` = no pan animation, and it fires only Leaflet
     `resize`/`move` (never a tile-wiping `viewreset`), so the re-sync itself costs no flash.
     A timed fallback stays as a safety net for the rare case the container isn't laid out yet
     at layout-effect time (then the synchronous call is a no-op and the fallback catches it). */
  useLayoutEffect(() => {
    if (!(visible && isActive && mapRef.current)) return;
    const sync = () => { try { mapRef.current && mapRef.current.invalidateSize(false); } catch (_) {} };
    sync(); // before paint — the revealed map is correct in the first frame, no 60ms snap
    const t = setTimeout(sync, 60); // safety net if layout wasn't ready at layout-effect time
    return () => clearTimeout(t);
  }, [visible, isActive]);

  /* Returning to the map (e.g. after committing parcels and planning) clears any
     committed selection and exits select-parcels mode back to the normal map.
     Deliberately keyed on `visible` (the map↔plan MODE flip) only — NOT `isActive` —
     so peeking at another module tab and coming back never wipes a parcel selection. */
  useEffect(() => {
    if (visible) { clearHilites(); setSelected([]); setSelectMode(false); setParcelInfo(null); setPlacingCompPin(false); }
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
  // NEW-2 (B834577) — this map sits the plan directly OVER the aerial (unlike the planner canvas,
  // which draws on a blank sheet), so a near-opaque element fill blots out the photo underneath.
  // Matches the fill this file ALREADY uses for a translucent-over-aerial overlay — the parcel
  // selection preview (0.08) and the marquee hilite (0.14) a few hundred lines below — rather than
  // the planner's own per-type opacities (untouched; Map route only).
  const MAP_ELEMENT_FILL_OPACITY_CAP = 0.4;
  // NEW-4 (B834579) — a flat 1px stroke is proportionally heavier on a small, zoomed-out element
  // than a large, zoomed-in one: with hundreds of small elements in view at PLAN_ZOOM, the constant
  // stroke width reads as a mesh of hairlines over the imagery. Linear 0.5px (PLAN_ZOOM) → 1.5px
  // six zoom levels up, clamped — thinner where elements are small on screen, fuller where they aren't.
  const elementStrokeWeight = (z) => Math.max(0.5, Math.min(1.5, 0.5 + ((z ?? PLAN_ZOOM) - PLAN_ZOOM) / 6));
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const build = () => {
    if (!mapRef.current) return; // unmounted while deferred
    // NEW-5 (B834580) — bump the epoch FIRST so any still-running budgeted continuation from a
    // previous build (see the bottom of this function) recognizes itself as superseded and stops.
    const myEpoch = ++sitesPaintEpochRef.current;
    if (sitesLayerRef.current) { map.removeLayer(sitesLayerRef.current); sitesLayerRef.current = null; }
    // NEW-4 — read once, at build time (this effect deliberately does NOT depend on `zoom` — see
    // the B64 comment above `showPlans`: a rebuild on every zoom tick is exactly what drops a
    // press-in-flight's target path). Elements built at PLAN_ZOOM's crossing get the thin end of
    // the scale; a plan re-panned/re-filtered at a higher zoom (any of this effect's OTHER deps
    // changing) picks up that zoom's weight for free, same as the boundary/pin styling above it.
    const strokeW = elementStrokeWeight(map.getZoom());
    const group = L.layerGroup();
    // NEW-5 — every polygon CONSTRUCT+ADD (the expensive part: Leaflet's `Path.onAdd` projects the
    // ring synchronously the instant it's added to a layer already on the map) is queued as one op
    // here instead of run immediately, so `runBudgeted` below can spread hundreds of them — up to
    // ~156 elements per site, several sites in view at once — across multiple animation frames
    // instead of one uninterrupted pass. Cheap, non-geometry work (creating a site's own group,
    // wiring its click/tooltip, a zoomed-out pin) still happens immediately: there's nothing there
    // for Leaflet to project.
    const ops = [];
    // B831778 (NEW-3) — gated ONLY on the "Sites" checkbox in Imagery & layers, never on `mode`
    // or which rail tab is open. This is the entire decoupling: browsing Comps must never empty
    // this loop.
    // B881665 — ALSO gated on the name filter, same as the Sites-panel list rows (`passName`
    // below): typing in "Filter by name…" narrowed the list to "1/28" while all 28 pins stayed
    // on the map, including the 0-match case where the map should show nothing at all. The list
    // and the map are two views of the same filtered set; only the list was ever filtered.
    (showSitesLayer ? sites.filter(passName) : []).forEach((site) => {
      if (!site.origin) return; // blank-planner sites have no geo anchor
      const status = statusOf(site);
      // NEW-1 — a Dead site stays ON the map (small + dim, same treatment as Complete):
      // hiding it outright was the B365 default and is exactly what made a site marked
      // dead read as "disappeared entirely." It still recedes via STATUS_TOKENS' size/
      // opacity/z-order, it just never vanishes.
      const { lat, lon } = site.origin;
      const active = site.id === activeSiteId;
      const name = site.site || site.name || "Site";
      // B849344/NEW-1 — canonical boundary + acreage, never the dead `site.parcels` mirror; and
      // an unresolved summary reads "checking…", never a confident wrong "no boundary" (LOUD-
      // FAILURE). NEW-2 — the trailing "click to open" narrated an already-obvious interaction
      // (owner: "it doesnt need to say click to open") and is dropped; the card states only facts.
      const boundary = siteBoundaryInfo(site, parcelSummary);
      const acreText = !boundary.known ? "checking boundary…" : boundary.hasBoundary ? `${boundary.acres.toFixed(1)} AC` : "no boundary";
      const tip = `${name} · ${acreText} · ${STATUS_META[status]?.label || status}`;
      const openSiteNow = () => onOpenSiteRef.current && onOpenSiteRef.current(site.id);
      // Right-click anywhere on a site → status picker at the cursor. (Suppress
      // the browser's native menu via the underlying DOM event.)
      const onCtx = (e) => { if (selectModeRef.current) return; const oe = e.originalEvent; if (oe) { oe.preventDefault(); oe.stopPropagation(); } setStatusMenu({ site, x: (oe && oe.clientX) || 0, y: (oe && oe.clientY) || 0 }); };

      // B849344 — the same canonical parcels the acreage number above was built from, not
      // `site.parcels`: drawing the boundary from a different source than the number describes
      // it is exactly the "picture and number disagree" failure this fix exists to close.
      const drawParcels = siteDrawParcels(site, parcelSummary);
      if (showPlans && drawParcels.length) {
        const t = statusToken(status);
        // Boundary ALWAYS carries the project status color; the open site is
        // emphasized with a heavier line (not by recoloring it to ember), so its
        // status stays visible — consistent with the status pin.
        const lineColor = t.color;
        const lineWeight = active ? 3.25 : 2.25;
        // NEW-1 (B834576) — ONE tooltip/click/contextmenu for the WHOLE site, not one per polygon.
        // L.FeatureGroup propagates every child layer's mouse events to itself (Leaflet's own
        // documented mechanism for "bindTooltip/bindPopup binds to all member layers at once"), so
        // binding here — before any polygon exists — still fires correctly once children are added:
        // hovering ANY parcel or element polygon opens this one tooltip, without each of up to ~157
        // polygons per site carrying (and independently opening/closing) its own copy.
        const siteGroup = L.featureGroup();
        if (!selectMode) siteGroup.on("click", openSiteNow).on("contextmenu", onCtx).bindTooltip(tip, { direction: "top", sticky: true });
        siteGroup.addTo(group); // cheap: siteGroup is still empty here, so this projects nothing
        drawParcels.forEach((p) => {
          if (!p.points?.length) return;
          ops.push(() => {
            L.polygon(p.points.map((pt) => feetToLatLng(pt, lat, lon)), {
              color: lineColor, weight: lineWeight, dashArray: t.dashed ? "5 4" : "6 5",
              fillColor: lineColor, fillOpacity: 0.05, interactive: !selectMode,
              className: "map-site-feature", // NEW-3 — a stable hook for verifying the decoupling
            }).addTo(siteGroup);
          });
        });
        // the plan itself: every element in its real fill/stroke (same resolver
        // as the planner canvas, including per-site default colors + overrides)
        [...(site.els || [])].sort(byZ).forEach((el) => {
          // B834581 — `elToRingFeet` (not the bare `elRingFeet`) so a centreline road draws as its
          // true pavement+curb strip; `elRingFeet` alone has no notion of a road and falls back to
          // the w/h bounding box its vertices happen to span (see that function's header).
          const ring = elToRingFeet(el);
          if (!ring || ring.length < 3) return;
          ops.push(() => {
            const st = elStyle(el, site.settings);
            L.polygon(ring.map((pt) => feetToLatLng(pt, lat, lon)), {
              color: st.stroke, weight: strokeW, fillColor: st.fill,
              fillOpacity: Math.min(MAP_ELEMENT_FILL_OPACITY_CAP, st.fillOpacity ?? 1),
              interactive: !selectMode,
              className: "map-site-feature",
            }).addTo(siteGroup);
          });
        });
        // NEW-3 (B834578) — a visible name tag, styled like the planner's own dark acreage-badge
        // chip (SitePlanner.jsx's parcel badge: a `rgba(17,24,39,0.62)` plate with `#e9edf2` text) —
        // matching an existing treatment rather than inventing a new one. Non-interactive (a name
        // tag, not a second click target — the same `interactive:false` pattern this file already
        // uses for the geolocate dot below) and HTML-escaped: a site name is user-entered text.
        L.marker([lat, lon], {
          icon: L.divIcon({ className: "", html: sitePlanLabelHtml(name), iconSize: [0, 0], iconAnchor: [0, 0] }),
          interactive: false, keyboard: false, zIndexOffset: active ? 1000 : 0,
        }).addTo(siteGroup);
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
    // NEW-5 — drive the queued polygon ops a bounded time-slice at a time (B802400 round 5's
    // `runBudgeted`), yielding via a genuine MessageChannel macrotask between slices — the same
    // idiom terrainLayers.js uses and for the same reason: a `requestAnimationFrame` continuation
    // gets folded into the SAME native frame as Leaflet's own queued canvas/SVG redraw, so it can't
    // actually hand control back to the browser between slices the way a macrotask does.
    const runner = runBudgeted(ops, () => performance.now(), PAINT_FRAME_BUDGET_MS);
    const driveSitesPaint = () => {
      if (!mapRef.current || myEpoch !== sitesPaintEpochRef.current) return; // unmounted or superseded
      const step = runner.next();
      if (!step.done) scheduleSaveSitesFrame(driveSitesPaint);
    };
    driveSitesPaint();
    };
    // Defer the rebuild if a press is in flight (B64); otherwise build now.
    if (pressedRef.current) { pendingRebuildRef.current = build; return; }
    build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sites, parcelSummary, activeSiteId, selectMode, showPlans, showSitesLayer, nameFilter]);

  // NEW-COMPS — leasing-comp markers: a sibling layer to the site-pin one above, deliberately
  // simpler (always a flat point marker, no zoom-dependent footprint rendering — a comp has no
  // drawn plan). Every comp the viewer can see (own + team's, regardless of project) is a
  // candidate here; the layer doesn't filter by activeSiteId or the status chips, since a comp
  // has neither. Same "skip while a press is in flight" deferral as the sites layer, so a
  // rebuild landing mid-gesture can't swallow a click the same way.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const build = () => {
      if (!mapRef.current) return;
      if (compsLayerRef.current) { map.removeLayer(compsLayerRef.current); compsLayerRef.current = null; }
      const group = L.layerGroup();
      // B831778 (NEW-3) — gated ONLY on the "Comps" checkbox, never on `mode` or the rail tab —
      // the same decoupling rule as the sites layer above.
      (showCompsLayer ? comps : []).forEach((c) => {
        if (!c?.anchor || typeof c.anchor.lat !== "number" || typeof c.anchor.lon !== "number") return;
        const { size, anchor } = compMarkerSize(false);
        const icon = L.divIcon({ className: "map-comp-feature", html: compMarkerSvg(c.compType), iconSize: size, iconAnchor: anchor });
        const marker = L.marker([c.anchor.lat, c.anchor.lon], { icon, interactive: !selectMode && !placingCompPin, keyboard: false, riseOnHover: true });
        const tip = `${c.title || compHeadline(c)} · ${c.compDate || ""}`;
        if (!selectMode && !placingCompPin) {
          marker.on("click", () => onCompClickRef.current && onCompClickRef.current(c.id)).bindTooltip(tip, { direction: "top" });
        }
        marker.addTo(group);
      });
      group.addTo(map);
      compsLayerRef.current = group;
    };
    if (pressedRef.current) { pendingCompsRebuildRef.current = build; return; }
    build();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comps, selectMode, placingCompPin, showCompsLayer]);

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

    // B629 — prefer the Drive PARCEL SNAPSHOT when this county's cached copy is loaded AND the live
    // source can't itself draw current selectable outlines (an image-only statewide source — Waller).
    // The snapshot is a reliable local vector layer that renders outlines AND (via optimisticHitAt,
    // which iterates its eachFeature) selects a lot even with the county server fully down. Served
    // from the browser, so no network + no hang-guard. B787: a queryable CAD (Chambers → CCAD) draws
    // its OWN current vectors, so it takes display precedence — the snapshot stays a click/outage
    // fallback (see the snapshot promote below + statewide outlines), never shadowing the live CAD
    // with a staler harvest. (Fort Bend, Tier B, is tiled — Phase 2 — and has no whole-county
    // snapshot loaded.)
    if (SNAPSHOT_COUNTIES.has(key) && preferSnapshotForDisplay({ hasSnapshot: !!getSnapshot(key), liveUrl: layerUrlsRef.current[key] })) {
      const snapLayer = makeSnapshotLayer(key);
      snapLayer.addTo(map);
      displaysRef.current[key] = snapLayer;
      return;
    }

    const url = layerUrlsRef.current[key];
    if (!url) return;
    const src = trimLayerUrl(url);

    /* NEW-2 (a) — DEDUPE BY RESOLVED URL, NOT BY COUNTY KEY. `co_larimer` used to carry the exact
       same URL as `co_statewide`, so this function added TWO identical Leaflet layers over the
       same ground and doubled every request to the slowest host in the app. Structural, not a
       special case for Larimer: any key that resolves to an endpoint already on the map becomes an
       ALIAS of the layer that is already there. Four counties + Waller are in that position today
       and the next one parked on a composite is covered for free. */
    const twin = Object.keys(displaysRef.current).find((k) => displaySrcRef.current[k]?.url === src);
    if (twin) {
      displaysRef.current[key] = displaysRef.current[twin];
      displaySrcRef.current[key] = { url: src, owner: displaySrcRef.current[twin].owner };
      return;
    }

    /* NEW-2 (b) — THE HANG-GUARD EXEMPTION FOLLOWS THE URL, NOT THE `statewide` FLAG ON THE KEY.
       The composite is exempt because pulling it would leave the map with nothing to see or click
       — a property of the ENDPOINT. Keyed off `STATEWIDE_KEYS` instead, a county sharing the
       composite's URL got the OPPOSITE policy: the 8s guard fired on the county-keyed copy,
       `markDown` pulled it, `recordSourceResult` opened the breaker, and the banner told the owner
       his county server was slow while pointing him at the very host it had just declared dead. */
    const statewide = isStatewideLayerUrl(src);
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
    displaySrcRef.current[key] = { url: src, owner: key };
    /* NEW-3 — a truncated parcel draw must never look like a complete one. ArcGIS answers a
       view-sized bbox with at most `maxRecordCount` features and sets `exceededTransferLimit`
       when it had more to give; esri-leaflet does not page, so the map draws an authoritative-
       looking parcel layer with an unknown number of lots silently missing. Measured against the
       Colorado composite: exactly 2000 features, flag true, 1,466 ms. Say so. */
    fl.on("requestsuccess", (e) => {
      if (!responseWasTruncated(e && e.response)) return;
      setErr(parcelTruncationNotice(featureCountOf(e.response)));
    });
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
      // NEW-2 — drop every key pointing at this layer, not just the one that armed the guard, so
      // an alias can never hand a detached layer to `optimisticHitAt`.
      Object.keys(displaysRef.current).forEach((k) => {
        if (displaysRef.current[k] === fl) { delete displaysRef.current[k]; delete displaySrcRef.current[k]; }
      });
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
    const seen = new Set(); // NEW-2 — aliased keys share ONE layer; remove it once
    Object.values(displaysRef.current).forEach((fl) => {
      if (!fl || seen.has(fl)) return;
      seen.add(fl);
      try { map && map.removeLayer(fl); } catch (_) {}
    });
    displaysRef.current = {};
    displaySrcRef.current = {};
  };
  const removeDisplay = (key) => {
    const map = mapRef.current;
    const fl = displaysRef.current[key];
    if (!fl) return;
    // NEW-2 — an ALIAS drops only its own reference; the layer belongs to the key that created it.
    if (displaySrcRef.current[key] && displaySrcRef.current[key].owner !== key) {
      delete displaysRef.current[key]; delete displaySrcRef.current[key];
      return;
    }
    try { map && map.removeLayer(fl); } catch (_) {}
    Object.keys(displaysRef.current).forEach((k) => {
      if (displaysRef.current[k] === fl) { delete displaysRef.current[k]; delete displaySrcRef.current[k]; }
    });
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
      // B787 — only swap the on-map display to the snapshot when it's actually the preferred
      // display source for this county (an image-only/unreachable live source — Waller). A healthy
      // queryable CAD (Chambers → CCAD) keeps its own current vectors; don't flicker them out for a
      // staler snapshot (the snapshot still serves clicks/outage via the promote path).
      if (!preferSnapshotForDisplay({ hasSnapshot: !!getSnapshot(county), liveUrl: layerUrlsRef.current[county] })) return;
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
    // (`.pf-boundary-hit`, B695) drop Leaflet's pointer cursor and inherit the +/−
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
    const walked = new Set(); // NEW-2 — aliased keys share one layer; walk its features once
    for (const [county, fl] of Object.entries(displaysRef.current)) {
      if (!fl || typeof fl.eachFeature !== "function") continue;
      if (walked.has(fl)) continue;
      walked.add(fl);
      /* NEW-2 — "is this a REAL county CAD hit?" is a question about the ENDPOINT, not the key. A
         county parked on a statewide composite draws COMPOSITE features, so a hit off it is a
         statewide-backup hit however the key is spelled — which is what decides whether a genuine
         neighbouring CAD hit should win instead. Falls back to the key test for the snapshot
         layers, which have no live URL. */
      const src = displaySrcRef.current[county];
      const real = src ? !isStatewideLayerUrl(src.url) : !STATEWIDE_KEYS.includes(county);
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
      setSelected((s) => (s.some((x) => x.key === key) ? s : [...s, { key, rings, latlngsList, addr: situsAddress(attrs), acct: findAttr(attrs, ID_RE), attrs, county }])); // dedupe by key (B22)
      // B36(a): the statewide TxGIO layer can answer for a Harris/FB lot — relabel via a
      // true point-in-county lookup (non-blocking). Keyed off STATEWIDE_KEYS, not a
      // hardcoded "chambers": B787 moved the statewide role from the `chambers` key to the
      // dedicated `txgio_statewide` key, so a statewide-backup hit now carries
      // `county === "txgio_statewide"`. Guarding on the statewide set keeps the relabel
      // firing (and skips the wasted lookup for a real CCAD Chambers hit, which is already
      // correctly its own county).
      if (STATEWIDE_KEYS.includes(county) && at) {
        countyAtPoint(at.lng, at.lat)
          .then(({ key: ckey }) => { if (ckey && ckey !== county) setSelected((s) => s.map((x) => (x.key === key ? { ...x, county: ckey } : x))); })
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
    setErr(""); setFallbackOffer(null); setBackupNotice(null); setCachedNotice(null); setLocateFar(false);

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
        /* B209502 — SAY THE COUNTY, and say it has no parcel data, rather than implying the click
         * was bad. Before this, a click anywhere in one of the ~245 Texas counties Planyr has no
         * CAD for read as "No parcel right there — zoom in and click directly on a lot", which
         * blames the user for a gap in our coverage. `countyIdentity` knows the difference: it
         * names the county from real geometry and reports `no-source` when nothing is wired there.
         * Naming the wrong county is worse than admitting a gap — and so is naming none at all. */
        const gap = noParcelSourceNote(countyIdentity(latlng.lat, latlng.lng));
        // "Couldn't reach any parcel server" reads differently from "reached one, but
        // there's no parcel at this exact point" (B245).
        /* NEW-4 — an OUTAGE carries the fallback; the other two do not. "No parcel right there" is a
         * real answer about this point, and a county with no wired source (`gap`) is a coverage fact
         * — neither is a reason to offer "start the plan here anyway", which exists for the case
         * where the service that WOULD have answered is down. */
        if (res.responded === 0) failUnavailable("The county parcel server isn't responding right now — try again in a moment, or start the plan here and draw the boundary yourself.", latlng);
        else setErr(gap
          ? `${gap} You can still trace the lot from the Aerial underlay.`
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
      failUnavailable(humanizeError(e), latlng); // NEW-4 — a thrown lookup is an outage too
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
            addr: situsAddress(added.attrs), acct: findAttr(added.attrs, ID_RE), acres: ringsAcres(added.rings),
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
      addr: situsAddress(added.attrs), acct: findAttr(added.attrs, ID_RE), acres: ringsAcres(added.rings),
      backup: viaBackup ? backupCountyLabel(hit.feature.attributes || {}) : null,
    });
  };

  // NEW-1 (B232) + NEW-2 (B233): geocode → recenter at parcel zoom → select the
  // parcel there + show its info. (The old version only flew to a Nominatim hit and
  // often got none for a bare street address, so the map never moved.)
  // B831779 (NEW-4a) — takes an optional raw string so the suggestion field's "Press ⏎ to
  // search…" / "Search anyway" rows can hand back exactly the text they showed, rather than
  // relying on `addr` state having caught up to the same value through a debounced onChange.
  const goAddress = async (text) => {
    const q = (text != null ? text : addr).trim();
    if (!q) return;
    if (text != null && text !== addr) setAddr(text);
    const tok = ++addrTokRef.current; // B545: claim this search's generation; guard every async setState below
    setBusy(true); setErr(""); setFallbackOffer(null); setParcelInfo(null); setLocateFar(false);
    try {
      const center = mapRef.current ? mapRef.current.getCenter() : null;
      const hit = await geocodeAddress(q, center);
      if (tok !== addrTokRef.current) return; // a newer search started — drop this stale result
      if (hit && hit.error) { setErr(hit.error); return; } // B540: service unreachable ≠ not found
      if (!hit) { setErr("Couldn't find that address — add the city or ZIP, or just pan the map to it."); return; }
      mapRef.current.flyTo([hit.lat, hit.lon], 18, { duration: 0.75 });
      await selectParcelAt({ lat: hit.lat, lng: hit.lon }, hit.label, tok); // NEW-2: select + surface parcel info
    } catch (_) {
      if (tok === addrTokRef.current) failUnavailable("Address search is unavailable right now — pan/zoom the map to your site, or start the plan where the map is looking and draw the boundary.");
    } finally {
      if (tok === addrTokRef.current) setBusy(false);
    }
  };

  // B831779 (NEW-4) — a suggestion the user explicitly picked already carries its own lat/lon,
  // so this skips straight to the same fly-to + identify tail `goAddress` uses instead of
  // re-geocoding a string we already resolved.
  const commitAddressHit = async (hit) => {
    const tok = ++addrTokRef.current;
    setAddr(hit.label);
    setBusy(true); setErr(""); setFallbackOffer(null); setParcelInfo(null); setLocateFar(false);
    if (mapRef.current) mapRef.current.flyTo([hit.lat, hit.lon], 18, { duration: 0.75 });
    try {
      await selectParcelAt({ lat: hit.lat, lng: hit.lon }, hit.label, tok);
    } finally {
      if (tok === addrTokRef.current) setBusy(false);
    }
  };

  // B831779 (NEW-4d) — the no-match row's "drop a pin here": mode-dependent, since what a raw
  // click on the map WOULD do differs by mode (a Site pin starts a blank plan; a Comp pin anchors
  // a leasing comp) — the same branch the toolbar's own "Start blank"/"Drop a pin" buttons take.
  const dropPinFromSearch = () => {
    if (mode === "comp") { const c = mapRef.current && mapRef.current.getCenter(); if (c) placeCompPinAt(c); return; }
    startBlankHere();
  };

  const clearSel = () => { clearHilites(); setSelected([]); setParcelInfo(null); setBackupNotice(null); setCachedNotice(null); };

  /* NEW-4 — THE FALLBACK. Start a plan with no parcel, LOCATED at `at` (or wherever the map is
   * looking), so the owner can draw the boundary himself and still get the aerial, the flood
   * layer, contours and the county's rules. This is the whole point of capturing the origin here:
   * a plan born located can never be stranded, and when the county service comes back the drawn
   * boundary is already sitting on the right ground.
   *
   * The county is resolved best-effort on the same 3s race `planSelected` uses — it is a nicety
   * (the planner re-resolves it from the origin on load), so an outage never blocks the fallback. */
  // NEW-COMPS: drop a leasing comp pin at a raw clicked point — no parcel resolution needed,
  // mirroring startBlankHere's best-effort county lookup below (same 3s race, same "don't block
  // on an outage" shape) but handing off to `onPlaceComp` instead of creating a site.
  const placeCompPinAt = async (latlng) => {
    setPlacingCompPin(false);
    let county = null;
    try {
      const ans = await Promise.race([
        countyAtPoint(latlng.lng, latlng.lat),
        new Promise((res) => setTimeout(() => res(null), 3000)),
      ]);
      county = ans?.name ? countyKeyForName(ans.name) : null;
    } catch (_) { /* the comp still gets created without a county; non-critical metadata */ }
    onPlaceComp && onPlaceComp({ kind: "pin", lat: latlng.lat, lon: latlng.lng, county });
  };
  const placeCompPinAtRef = useRef(placeCompPinAt);
  useEffect(() => { placeCompPinAtRef.current = placeCompPinAt; });

  // NEW-COMPS: anchor a comp to the currently-selected real parcel(s) (selectMode's own
  // selection), instead of planning a new site with it. `selected` items already carry lon/lat
  // `rings` (MapFinder.jsx:424) — reused as-is for the map snapshot geometry, no re-derivation.
  // B941152 — this used to read ONLY `selected[selected.length - 1]`, so a two-plus-parcel
  // selection silently dropped every parcel but the last: it had no `parcelApn`/`parcelGeom` of
  // its own, and the button that calls this was gated to `selected.length === 1` and simply did
  // not render for a bigger selection — Michael's "I selected parcels and press enter but
  // nothing happens." A multi-parcel comp now carries EVERY selected parcel's account id
  // (joined, never just one) and EVERY selected parcel's ring(s) as one GeoJSON geometry —
  // `Polygon` for a lone parcel (byte-identical to the old single-parcel shape), `MultiPolygon`
  // for several — anchored at the assembly's own bbox-center (the same point a "Plan N parcels"
  // site would open on), carrying the toolbar's own already-computed acreage so it survives into
  // the comp instead of forcing Michael to re-type 66.17 by hand.
  const placeCompOnSelectedParcel = () => {
    const anchor = compAnchorFromSelection(selected, asm);
    if (!anchor) return;
    onPlaceComp && onPlaceComp(anchor);
    clearSel();
  };

  // B941152 — Enter mirrors the "Comp here" button that appears the moment a parcel is selected
  // in Comp mode. Selecting parcels is a sequence of map clicks, which leaves nothing sitting in
  // focus (not the address field, not a button) — so before this, Michael's Enter keystroke had
  // no listener anywhere to reach, and the toolbar's badge + ✕ were all there was to show for it.
  // Scoped OFF whenever a real control has focus (the address search, a rename field, the ✕/Cancel
  // buttons…) so Enter keeps doing whatever that control already does; it only fires when nothing
  // in the toolbar has claimed the keystroke, which is exactly the state a map click leaves you in.
  useEffect(() => {
    if (mode !== "comp" || !selected.length) return undefined;
    const onKey = (e) => {
      if (e.key !== "Enter") return;
      const ae = document.activeElement;
      const tag = ae && ae.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || (ae && ae.isContentEditable)) return;
      e.preventDefault();
      placeCompOnSelectedParcel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const startBlankHere = async (at) => {
    const c = at || (mapRef.current ? mapRef.current.getCenter() : null);
    if (!c) { onSkip && onSkip(); return; }
    const origin = { lat: c.lat, lon: c.lon != null ? c.lon : c.lng };
    setErr(""); setFallbackOffer(null);
    let county = null;
    try {
      const ans = await Promise.race([
        countyAtPoint(origin.lon, origin.lat),
        new Promise((res) => setTimeout(() => res(null), 3000)),
      ]);
      county = ans?.name ? countyKeyForName(ans.name) : null;
    } catch (_) { /* the planner resolves it from the origin on load */ }
    onSkip && onSkip({ origin, county, name: parcelInfo?.label || addr.trim() || "Untitled site" });
  };
  // Always capture the planner underlay from Esri: it supports image `export`
  // (USGS tiles render on the map but its export op returns no image). The
  // boundary aligns to either source, so the planner aerial stays reliable.
  const planSelected = async () => {
    const asm = computeAssembly(selected, BASEMAPS.esri.export);
    if (!asm) return;
    // County now comes from the parcels themselves (auto-resolved at click), not a
    // pre-pick — use the last-selected parcel's county.
    let county = selected[selected.length - 1]?.county || selected.find((s) => s.county)?.county || null;
    // B792 — the answering-candidate key can be WRONG and it persists to the site row
    // forever: overlapping county bboxes + a spatially-unscoped statewide source let e.g.
    // "waller" answer for a Fort Bend parcel (scopeWhere applies only to text search).
    // Confirm against the TxDOT county-boundary layer before handing off (SWR-cached,
    // ≤3s); on timeout/outage/unrecognized county keep the click-time key — the planner's
    // load-time self-heal (B792) corrects it later.
    try {
      const ans = await Promise.race([
        countyAtPoint(asm.origin.lon, asm.origin.lat),
        new Promise((res) => setTimeout(() => res(null), 3000)),
      ]);
      const key = ans?.name ? countyKeyForName(ans.name) : null;
      if (key && key !== county) county = key;
    } catch (_) { /* keep the click-time key */ }
    /* NEW-2 — the plan's NAME is the parcel's SITUS, then what the user actually searched, then its
     * account id. `siteNameFromParcel` also refuses any candidate that equals a value the record
     * files under a mailing key, so a schema we have not seen still cannot name a Colorado plan
     * after an Arlington, TX head office. */
    const last = selected[selected.length - 1];
    const name = siteNameFromParcel(last?.attrs, {
      addr: last?.addr, searched: parcelInfo?.label || addr.trim(), acct: last?.acct,
    });
    onUseParcels({ ...asm, name, county });
  };

  const asm = selected.length ? computeAssembly(selected, BASEMAPS.esri.export) : null;

  /* B427410 — the `field` style object that used to live here dressed ONE control: the Imagery
   * <select> above the layer list. That control is now a row INSIDE the list (LayerPanel's basemap
   * control), styled by the panel, so the object had no reader left. */

  // B885136 (NEW-1) — Option E ("quiet rows"), owner-approved from 5 reviewed directions
  // (2026-08-30). Two things B855952's row still got wrong: the org/team chip outweighed the
  // name (9.5px/700 accent-colored vs 12.5px/600 ink — the heaviest, only-colored thing in the
  // row was the least useful fact) and cost the name real width every render; and inside a
  // single-status group the per-row dot repeats the group header's own colour+count once per
  // row for nothing. Fix: no per-row dot INSIDE a status group (`showStatusDot=false` — the
  // header already carries it); the org chip renders but stays invisible (opacity, not
  // display:none — VIEWPORT-STABLE) until the row is hovered OR focused, in a slot reserved at
  // its full width the whole time so revealing it never shifts the name or the date; name is
  // the one flexible element and truncates last; date is a fixed tabular-nums column.
  // The Pinned section (below) mixes every status under one header, so IT still needs a
  // per-row indicator — `showStatusDot=true` there is deliberate, not an oversight (see call
  // sites). Shared by every status section and the Pinned section alike.
  const siteRow = (s, { showStatusDot = false } = {}) => {
    const isActive = s.id === activeSiteId;
    const st = statusOf(s); const t = statusToken(st);
    // B849344 — canonical boundary (see siteBoundaryInfo); an honest "…" (checking) while
    // the summary hasn't loaded yet, never a confident wrong "no boundary" (LOUD-FAILURE).
    const boundary = siteBoundaryInfo(s, parcelSummary);
    // Hover OR keyboard focus reveals the org chip + the locate target together (React's
    // onFocus/onBlur bubble from focusin/focusout since React 17, so this fires for any
    // focusable descendant — the chip, the share glyph, the locate button — without a second
    // focus-tracking mechanism). Without this, hover-only content is unreachable by keyboard.
    const showActions = hoverRow === s.id || isActive;
    const isRenaming = renaming && renaming.id === s.id;
    // Touch/narrow viewport: 28px is a fine dense-desktop row but under a comfortable touch
    // target (WCAG 2.5.5's 44×44 CSS px). This panel DOES render at the phone-narrow breakpoint
    // (same `narrow` state the panel shell above keys off), so it gets the larger row there.
    const rowH = narrow ? 44 : 28;
    return (
      <div key={s.id} title={s.origin ? "Open site (double-click to fly here · right-click for status / pin / rename / delete)" : "Open site (right-click for status / pin / rename / delete)"}
        onClick={() => onOpenSite && onOpenSite(s.id)}
        onDoubleClick={() => flyToSite(s)}
        onMouseEnter={() => setHoverRow(s.id)} onMouseLeave={() => setHoverRow((r) => (r === s.id ? null : r))}
        onFocus={() => setHoverRow(s.id)}
        onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHoverRow((r) => (r === s.id ? null : r)); }}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); openSiteMenu(s, e.clientX, e.clientY); }}
        style={{ display: "flex", alignItems: "center", gap: 8, height: rowH, padding: "0 12px", cursor: "pointer", position: "relative", borderLeft: `3px solid ${isActive ? PAL.accent : "transparent"}`, background: isActive ? "#fbf3ee" : "transparent" }}>
        {showStatusDot && (
          <button title={`Status: ${STATUS_META[st]?.label || st} — click to change`} aria-label="Set status"
            onClick={(e) => { e.stopPropagation(); openSiteMenu(s, e.clientX, e.clientY); }}
            style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", borderRadius: RADIUS.pill, cursor: "pointer", padding: 0,
              border: `1.5px solid ${t.color}`, background: t.hollow ? "var(--surface-raised)" : t.color, color: t.hollow ? t.color : "#fff", fontSize: 9, lineHeight: 1, fontFamily: "inherit" }}>
            {t.glyph}
          </button>
        )}
        {isRenaming ? (
          <input autoFocus defaultValue={renaming.name}
            onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") commitRename(s.id, e.target.value, renaming.name);
              else if (e.key === "Escape") cancelRename();
            }}
            onBlur={(e) => { if (skipRenameBlurRef.current) { skipRenameBlurRef.current = false; return; } commitRename(s.id, e.target.value, renaming.name); }}
            style={{ flex: 1, minWidth: 0, boxSizing: "border-box", fontSize: 12, fontWeight: 600, color: PAL.ink, fontFamily: "inherit", padding: "1px 4px", border: `1px solid ${PAL.accent}`, borderRadius: RADIUS.sm, outline: "none", background: "var(--surface-raised)" }} />
        ) : (
          <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, overflow: "hidden" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", textDecoration: t.struck ? "line-through" : "none" }}>
              {s.site || s.name || "Untitled site"}
            </span>
            {/* B845089 — the "no boundary" flag used to live in the acreage column; that column is
                now last-edited, which a boundary-less site still has, so the flag moved here instead
                of being lost. Unaffected by B885136 — it's a standing fact about the site, not a
                hover reveal, so it stays visible at rest same as before. */}
            {boundary.known && !boundary.hasBoundary && (
              <span title="No boundary drawn yet" style={{ flex: "none", fontSize: 9.5, fontWeight: 700, color: PAL.muted, background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.pill, padding: "1px 6px", whiteSpace: "nowrap" }}>no boundary</span>
            )}
          </div>
        )}
        {/* B885136 (NEW-1) — the org/team chip: invisible at rest, reveals on hover/focus.
            NOT a reserved-width flex sibling — a WIDE team name (e.g. "HIP Houston") in a
            fixed-width flex slot was measured to steal enough room to truncate even a short
            name like "Richfield" on this panel's real (232px) width, reproducing the exact
            defect this item exists to fix. Anchored instead on a ZERO-WIDTH relatively-
            positioned span sitting where the chip would start (right before the locate slot):
            the name-wrapper above always gets its full flex share regardless of hover state or
            team presence (never a truncation "did not have to happen"), and the chip paints as
            an absolutely-positioned overlay, growing left from that fixed anchor, which is what
            actually satisfies "revealing it on hover does NOT shift the name or the date" —
            an out-of-flow element cannot shift a sibling's box no matter what it renders. */}
        {s.teamId && !isRenaming && (() => {
          const disp = sharedWithDisplay(s.teamId, myTeams);
          if (disp.kind === "none") return null;
          const revealStyle = { opacity: showActions ? 1 : 0, transition: "opacity .12s", pointerEvents: showActions ? "auto" : "none" };
          const chip = disp.kind === "team"
            ? (
              <span tabIndex={0} title={`Shared with ${disp.name}`} aria-label={`Shared with ${disp.name}`}
                style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  fontSize: 9.5, fontWeight: 700, color: PAL.accent, background: "var(--surface-overlay)",
                  border: `1px solid ${PAL.accent}`, borderRadius: RADIUS.pill, padding: "1px 6px", lineHeight: 1.5, ...revealStyle }}>
                {disp.name}
              </span>
            )
            // "unknown" — shared, but the team no longer names anything this account can see
            // (deleted, or the viewer left it). Still shared, so still say so — just not with whom.
            : (
              <span tabIndex={0} title="Shared" aria-label="Shared"
                style={{ position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", display: "flex", alignItems: "center", color: PAL.accent, ...revealStyle }}>
                <ShareGlyph size={12} />
              </span>
            );
          return <span style={{ position: "relative", width: 0, height: "100%", flex: "none" }}>{chip}</span>;
        })()}
        {/* B845089 (NEW-2) — the right-aligned column is now LAST EDITED, not acreage: "get rid of
            the acreage... date last edited would be more likely to be important" (owner, live
            review). The value is the group's real last EDIT (max across every plan's live
            site_elements rows) — never `sites.updated_at`, which advances on a header change (a
            rename, opening the plan) and not on a drawing edit; see lib/siteRecency.js.
            B885136 — font/colour now match the app's own --font-sm/--text-tertiary tokens
            exactly (was a hardcoded 11px against --text-secondary); fontVariantNumeric keeps the
            digits tabular so "1d" and "Jul 14" don't jiggle the column width. */}
        <div style={{ flex: "none", minWidth: 34, display: "flex", justifyContent: "flex-end" }}>
          {lastEditedByGroup === null ? (
            <span title="Checking last edit…" style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>…</span>
          ) : (() => {
            const ms = lastEditedByGroup[s.groupId || s.id] ?? null;
            const label = lastEditedLabel(ms);
            return label ? (
              <span title={`Last edited ${new Date(ms).toLocaleString()}`} style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap" }}>{label}</span>
            ) : <span style={{ fontSize: 10.5, color: "var(--text-tertiary)", fontVariantNumeric: TABULAR_NUMS }}>—</span>;
          })()}
        </div>
        {/* (B168) single-click ✕ delete removed — delete lives in the right-click menu;
            only the non-destructive locate (⊕) stays here. Already reserved-width + opacity-only
            (the B885136 pattern the org chip above now follows too). */}
        <div style={{ display: "flex", gap: 2, flex: "none", alignItems: "center", opacity: showActions ? 1 : 0, transition: "opacity .12s", pointerEvents: showActions ? "auto" : "none" }}>
          {s.origin && <button title="Show on map (zoom to the plan)" aria-label="Show on map" onClick={(e) => { e.stopPropagation(); flyToSite(s); }}
            className="gbtn" style={{ border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", lineHeight: 0, padding: 2, borderRadius: RADIUS.sm }}>
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4"><circle cx="8" cy="8" r="5.2" /><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" /><path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2" /></svg>
          </button>}
        </div>
      </div>
    );
  };
  // Sites matching the name filter (for the panel header count).
  const shownCount = sites.filter((s) => passName(s)).length;

  // NEW-MAPCTRL-2 — STEEL-MAN ix's way back: re-run the SAME derived landing view a fresh open
  // would use, so "back to your sites" always means the same thing "open the Map view" does.
  const backToSites = () => {
    const map = mapRef.current;
    if (!map) return;
    const view = landingView(sitesRef.current, viewportOf(elRef.current));
    if (view.source === "sites") map.setView(view.center, view.zoom, { animate: true });
    setLocateFar(false);
  };

  // (The parcel card's own label/value row moved to components/ParcelInfoCard.jsx — NEW-1.)

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface-page)" }}>
      {/* map */}
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <div ref={elRef} style={{ position: "absolute", inset: 0 }} />

        {/* B831781 (NEW-6) — A PERSISTENT MODE NEEDS A VISIBLE ARMED STATE. With Comp mode active
            and an add-action armed (a raw click is about to either drop a comp pin or pick a
            parcel to anchor one — placingCompPin / selectMode), the map itself says so: a soft
            blue ring around the whole viewport (map-edge tint). COMP_ACCENT is the same hue the
            switch and every comp action already use, so "blue" reads as "comp" everywhere in
            this cluster — the toolbar's own status text (below) is what NAMES the action; this
            is what makes it impossible to miss.
            Chosen over a cursor-only cue (invisible the instant the pointer leaves the map,
            e.g. while reading the toolbar) or a corner badge (has to be looked away from to
            read) because a full-viewport ring is PERIPHERAL — visible in the same glance as
            wherever the pointer is about to click, wherever on the map that is.
            `pointer-events: none`, so it never steals the click it's warning about. */}
        {mode === "comp" && (placingCompPin || selectMode) && (
          <div aria-hidden="true" data-testid="map-comp-armed" style={{
            position: "absolute", inset: 0, zIndex: MAP_CHROME_Z.control, pointerEvents: "none",
            boxShadow: `inset 0 0 0 3px ${COMP_ACCENT}, inset 0 0 26px -8px ${COMP_ACCENT}`,
          }} />
        )}

        {/* B848496 — "pin a comp to this plan" (a click on the plan's own rendered image) gets
            the same visible-armed-state treatment B831781 established above for a comp drop. */}
        {clickableOverlayId && (
          <>
            <div aria-hidden="true" data-testid="map-siteplan-armed" style={{
              position: "absolute", inset: 0, zIndex: MAP_CHROME_Z.control, pointerEvents: "none",
              boxShadow: `inset 0 0 0 3px ${COMP_ACCENT}, inset 0 0 26px -8px ${COMP_ACCENT}`,
            }} />
            <div style={{
              position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: MAP_CHROME_Z.control + 1,
              background: COMP_ACCENT, color: ON_COMP_ACCENT, borderRadius: RADIUS.pill, padding: "6px 14px", fontSize: 12.5, fontWeight: 600,
              display: "flex", alignItems: "center", gap: 10, maxWidth: "calc(100% - 40px)",
            }}>
              <span>Click the plan on the map to pin a comp there</span>
              <button onClick={() => stopPinOnOverlay()} style={{ border: `1px solid ${ON_COMP_ACCENT}`, background: "transparent", color: ON_COMP_ACCENT, borderRadius: RADIUS.pill, width: 18, height: 18, lineHeight: "16px", padding: 0, cursor: "pointer", flex: "none" }} aria-label="Cancel">×</button>
            </div>
          </>
        )}

        {/* B848496 second amendment — a real drop target: a full-area highlight naming what will
            happen, shown the instant a file is dragged over the map (never a silent accept).
            `pointer-events: none` throughout — the window-level listeners above own the actual
            drag/drop events; this is feedback only and must never be able to steal a drop. */}
        {fileDragActive && (
          <div aria-hidden="true" data-testid="map-file-drop-active" style={{
            position: "absolute", inset: 0, zIndex: MAP_CHROME_Z.control + 2, pointerEvents: "none",
            boxShadow: `inset 0 0 0 3px ${COMP_ACCENT}, inset 0 0 26px -8px ${COMP_ACCENT}`,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>
            <div style={{ background: COMP_ACCENT, color: ON_COMP_ACCENT, borderRadius: RADIUS.lg, padding: "12px 20px", fontSize: 14, fontWeight: 700 }}>
              Drop to add a site plan
            </div>
          </div>
        )}

        {/* Live GPS readout (B683): the cursor's WGS84 lat/long, bottom-center so it clears the
            zoom control (corner) and the scale bar (bottom-right). Display-only; the app's frame
            stays EPSG:2278 feet. B706 appends the ground elevation when a reading exists (cached
            terrain grid, else one debounced 3DEP point sample) — suppressed over no-data. */}
        <CursorChip ll={hoverLL} el={hoverEl} style={{
          bottom: 8, left: "50%", transform: "translateX(-50%)", zIndex: 900, maxWidth: "calc(100% - 20px)",
          color: "rgba(255,255,255,0.9)", background: "rgba(0,0,0,0.5)", padding: "3px 9px",
        }} />

        {/* Right-click-on-empty-map menu → export the map's sites to Google Earth (B684).
            Shared viewport-aware ContextMenu (B915) — flips/clamps at any edge. */}
        {mapMenu && (
          <ContextMenu x={mapMenu.x} y={mapMenu.y} onClose={() => setMapMenu(null)} minWidth={236} zIndex={3999}
            className="" ariaLabel="Map actions"
            panelStyle={{ background: "var(--surface-raised)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.lg, boxShadow: "0 10px 30px rgba(28,25,20,0.22)", padding: 4, fontFamily: "inherit" }}>
            <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 10px 4px" }}>Map</div>
            <button onClick={() => exportSitesKmz(false)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: PAL.ink, padding: "7px 10px", borderRadius: RADIUS.sm }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-overlay)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>Export to Google Earth (KMZ)</button>
            <button onClick={() => exportSitesKmz(true)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, color: PAL.ink, padding: "7px 10px", borderRadius: RADIUS.sm }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "var(--surface-overlay)")} onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>Export with 3D buildings</button>
          </ContextMenu>
        )}

        {/* ── Combined site bar — floating pill at top-center (full-width bar on a phone) ──
            B831776 (NEW-5): the bar is RADIUS.lg, and every child button below is
            nestedIn(RADIUS.lg, 6) = RADIUS.sm — radius.js's own concentric-nesting rule applied
            exactly as it documents, not a new value. */}
        <div style={{
          position: "absolute", zIndex: narrow ? 1100 : 1000,
          display: "flex", alignItems: "center",
          background: PAL.chrome,
          borderRadius: RADIUS.lg,
          boxShadow: "0 4px 20px rgba(0,0,0,0.45), 0 1px 4px rgba(0,0,0,0.25)",
          padding: "0 6px",
          height: 42,
          // Phone: a full-width bar pinned to the top so the side panels (now below it) can't
          // cover the search input or the Select-parcels button. Desktop: centered pill.
          ...(narrow
            ? { top: 8, left: 8, right: 8, transform: "none", maxWidth: "none", minWidth: 0 }
            : { top: 14, left: "50%", transform: "translateX(-50%)", maxWidth: "calc(100% - 540px)", minWidth: 300 }),
        }}>
          {/* B831776 (NEW-1) — Site/Comp switch, far left, before the search field. Sets what
              the action buttons to the right offer; the SAME state drives the rail tab below. */}
          <SiteCompSwitch mode={mode} onChange={setMode} />

          {/* B831779 (NEW-4) — the address field is now a live-suggestion combobox; the red "Go"
              pill is gone (see PlaceSearchField.jsx for the full behaviour contract). */}
          <PlaceSearchField
            value={addr}
            onChange={setAddr}
            narrow={narrow}
            busy={busy && !selectMode}
            center={() => (mapRef.current ? mapRef.current.getCenter() : null)}
            placeholder={narrow ? "Type an address…" : "Type an address, city or place…"}
            onCommit={commitAddressHit}
            onCommitRaw={(text) => { if (!(busy && !selectMode)) goAddress(text); }}
            onDropPinHere={dropPinFromSearch}
            dropPinLabel={mode === "comp" ? "Drop a comp pin here" : "Start blank here"}
          />

          {/* Divider */}
          <span style={{ width: 1, height: 22, background: PAL.chromeLine, flex: "none", margin: "0 8px" }} />

          {/* Right section — mode + state dependent. B831780 — every label button here is
              SHRINKABLE (flex: 0 1 auto, a small minWidth, ellipsis) rather than `flex:"none"`:
              the new switch takes real width away from this section, and at ~900px (one of the
              widths this cluster is checked at) a fixed-width row here forced Cancel/the primary
              action UNDER the Layers panel's corner instead of just shortening its own label.
              Only Cancel and the small ✕ clear button stay fixed-width — short enough to never
              need it, and always reachable is what matters most for those two. */}
          {mode === "site" && !selectMode && !placingCompPin && selected.length === 0 && (
            /* NEW-1 (map "Start blank" consolidation, owner report 2026-08-29) — ONE entry point
               for starting a plan here, not two of equal weight. "Select parcels" is the PRIMARY
               action (almost every new plan starts from a real parcel) — filled with the accent,
               same as any other primary button in this app. "Start blank" is still one click away,
               but now SECONDARY: a caret on the same control opens it, rather than a second button
               sitting beside "Select parcels" and competing with it. The row-1 header's separate
               "Start blank" button (SitePlannerApp.jsx) is gone — this is now the only place on the
               map that starts a blank plan. Reuses the exact fallback `startBlankHere` already gives
               the "county service is down" banner — no second implementation. */
            <div style={{ display: "flex", flex: "0 1 auto", minWidth: 54 }}>
              <button
                onClick={() => setSelectMode(true)}
                title="Click parcels on the map to select them, then start a plan from the selection"
                style={{
                  flex: "1 1 auto", minWidth: 0, overflow: "hidden",
                  height: 30, padding: "0 11px",
                  borderTopLeftRadius: nestedIn(RADIUS.lg, 6), borderBottomLeftRadius: nestedIn(RADIUS.lg, 6),
                  borderTopRightRadius: 0, borderBottomRightRadius: 0,
                  border: "1px solid var(--accent)", borderRight: "1px solid var(--on-accent)",
                  background: "var(--accent)", color: "var(--on-accent)", fontSize: 12.5, fontWeight: 700,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Select parcels</span>
              </button>
              <button
                ref={startBlankMenuBtnRef}
                onClick={() => setStartBlankMenuOpen((o) => !o)}
                title="More ways to start a plan"
                aria-haspopup="menu" aria-expanded={startBlankMenuOpen}
                data-testid="map-start-blank-menu-btn"
                style={{
                  flex: "none", width: 22,
                  height: 30,
                  borderTopRightRadius: nestedIn(RADIUS.lg, 6), borderBottomRightRadius: nestedIn(RADIUS.lg, 6),
                  borderTopLeftRadius: 0, borderBottomLeftRadius: 0,
                  border: "1px solid var(--accent)", background: "var(--accent)", color: "var(--on-accent)",
                  fontSize: FONT_SIZE.xs, cursor: "pointer", fontFamily: "inherit",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >▾</button>
            </div>
          )}
          {mode === "comp" && !selectMode && !placingCompPin && selected.length === 0 && onPlaceComp && (
            <>
              <button
                onClick={() => setPlacingCompPin(true)}
                title="Click the map to drop a leasing-comp pin at that spot"
                style={{
                  flex: "0 1 auto", minWidth: 40, overflow: "hidden",
                  height: 30, padding: "0 11px", borderRadius: nestedIn(RADIUS.lg, 6),
                  border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
                  color: PAL.chromeInk, fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Drop a pin</span>
              </button>
              <button
                onClick={() => setSelectMode(true)}
                title="Click a parcel on the map to anchor a comp to it"
                style={{
                  flex: "0 1 auto", minWidth: 44, overflow: "hidden",
                  height: 30, padding: "0 11px", borderRadius: nestedIn(RADIUS.lg, 6),
                  border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
                  color: PAL.chromeInk, fontSize: 12.5, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Comp from parcel</span>
              </button>
            </>
          )}
          {placingCompPin && (
            <>
              <span style={{ flex: "1 1 auto", minWidth: 0, color: PAL.chromeMuted, fontSize: 12.5, padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                Click the map to place a comp…
              </span>
              <button
                onClick={() => setPlacingCompPin(false)}
                style={{
                  flex: "none", height: 30, padding: "0 10px", borderRadius: nestedIn(RADIUS.lg, 6),
                  border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
                  color: PAL.chromeInk, fontSize: 12, fontWeight: 600,
                  cursor: "pointer", fontFamily: "inherit",
                }}
              >
                Cancel
              </button>
            </>
          )}
          {selectMode && selected.length === 0 && (
            <>
              <span style={{
                flex: "1 1 auto", minWidth: 0, color: PAL.chromeMuted, fontSize: 12.5,
                padding: "0 6px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {busy ? "Looking up lot…" : (mode === "comp" ? "Selecting a parcel for a comp…" : "Selecting…")}
              </span>
              <button
                onClick={() => setSelectMode(false)}
                style={{
                  flex: "none", height: 30, padding: "0 10px", borderRadius: nestedIn(RADIUS.lg, 6),
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
              <span style={{ width: 7, height: 7, borderRadius: RADIUS.pill, background: mode === "comp" ? COMP_ACCENT : PAL.accent, flex: "none" }} />
              <span style={{
                flex: "1 1 auto", minWidth: 0, color: PAL.chromeInk, fontSize: 12.5, fontWeight: 600,
                padding: "0 8px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {selected.length} parcel{selected.length > 1 ? "s" : ""} · {asm ? `${asm.totalAc.toFixed(2)} AC` : "…"}
              </span>
              <button
                onClick={clearSel}
                title="Clear selection"
                style={{
                  flex: "none", width: 26, height: 26, borderRadius: RADIUS.sm,
                  border: "none", background: "transparent",
                  color: PAL.chromeMuted, fontSize: 13, lineHeight: 1,
                  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                }}
              >
                ✕
              </button>
              {/* B831776 (NEW-1) — one action, chosen by mode: Site mode plans the parcel(s);
                  Comp mode anchors a comp to the one selected parcel. Never both at once — that
                  was the old design's own confusion (two unrelated actions on one selection). */}
              {mode === "site" && (
                <button
                  onClick={planSelected}
                  style={{
                    flex: "0 1 auto", minWidth: 44, overflow: "hidden",
                    height: 30, padding: "0 11px", borderRadius: nestedIn(RADIUS.lg, 6),
                    border: "none", background: PAL.accent, color: "#fff",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Plan {selected.length > 1 ? `${selected.length} parcels` : "site"} →
                  </span>
                </button>
              )}
              {/* B941152 — this used to require `selected.length === 1`, so a two-plus-parcel
                  selection (a normal industrial land comp assembled from adjoining lots) had NO
                  primary action at all: no button to click, and Enter had nothing to reach either.
                  Any non-empty selection now gets the same one action, worded like the Site-mode
                  "Plan N parcels →" button beside it. */}
              {mode === "comp" && onPlaceComp && (
                <button
                  onClick={placeCompOnSelectedParcel}
                  style={{
                    flex: "0 1 auto", minWidth: 44, overflow: "hidden",
                    height: 30, padding: "0 11px", borderRadius: nestedIn(RADIUS.lg, 6),
                    border: "none", background: COMP_ACCENT, color: "#fff",
                    fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    Comp {selected.length > 1 ? `${selected.length} parcels` : "here"}
                  </span>
                </button>
              )}
            </>
          )}
          <span style={{ width: 4 }} />
        </div>

        {/* NEW-1 — the "Start blank" secondary option, off the "Select parcels" split button's
            caret. One item today; a MenuItem list rather than a bare popover so a future secondary
            option (e.g. a saved-template start) has somewhere to go without another redesign. */}
        <AnchoredMenu open={startBlankMenuOpen} onClose={() => setStartBlankMenuOpen(false)}
          anchorRef={startBlankMenuBtnRef} placement="below-left" width={200} gap={6}
          zIndex={MAP_CHROME_Z.panel} panelStyle={menuPanelStyle}>
          <MenuItem data-testid="map-start-blank-menu-item"
            title="Start a plan with no parcel, located where the map is looking — draw the boundary yourself"
            onClick={() => { setStartBlankMenuOpen(false); startBlankHere(); }}>
            Start blank
          </MenuItem>
        </AnchoredMenu>

        {/* NEW-2 (B233): address-search parcel info card — drops in under the search pill
            after a "Go". The card itself lives in components/ParcelInfoCard.jsx (NEW-1),
            which is what lets its three-row default + "More details" fold be unit-tested.
            Keyed on the parcel so every new search re-mounts it with the fold CLOSED. */}
        {parcelInfo && (
          <PanelErrorBoundary name="Parcel info"><Suspense fallback={null}>
          <ParcelInfoCard
            key={`${parcelInfo.key || ""}|${parcelInfo.acct || ""}|${parcelInfo.addr || ""}`}
            info={parcelInfo}
            narrow={narrow}
            cachedAsOfLabel={parcelInfo.cached ? fmtAsOf(parcelInfo.cached.asOf) : ""}
            onDismiss={() => setParcelInfo(null)}
            onPlan={planSelected}
            // NEW-4 — the unavailable state offers the fallback instead of dead-ending.
            onStartBlank={parcelInfo.status === "unavailable" ? () => { const m = mapRef.current; startBlankHere(m ? m.getCenter() : null); setParcelInfo(null); } : null}
          />
          </Suspense></PanelErrorBoundary>
        )}

        {/* B831777 (NEW-2) — the left rail: Sites and Comps as TABS, side by side, counts on the
            tabs, one list showing at a time. This used to be gated on `sites.length > 0` (a
            brand-new account saw no rail at all); it now always renders, since the Comps tab is
            useful with zero sites and zero comps alike — this is the one persistent place to
            browse or add either. */}
        <div style={{ position: "absolute", background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.lg, boxShadow: "0 4px 18px rgba(28,25,20,0.14)", overflow: "hidden",
            // B831777×2/B948496 — the rail must never grow past the viewport: it can hold a
            // long site list, several site plans, or an open comp form, and any one of those
            // used to just push the panel off-screen with no way to reach what fell below the
            // fold (an unusable panel, not a polish gap — the comp form's own Size row was
            // reported cut off with no way down to it). `display:flex/flexDirection:column`
            // pins the header row and hands the content below it ONE scrollable region (added
            // just below). Collapsed (sitesPanelOpen false) the panel must still shrink to its
            // small closed-tab height, not stretch to fill the available space, which is why
            // this is a CAP (`max-height`) and not a fixed/stretched height.
            // ⛔ THE CAP IS `calc(100% - …)`, NEVER A VIEWPORT-RELATIVE `calc(100vh - Npx)` —
            // measured live: this panel's positioned ancestor does not start at the viewport's
            // own top (it sits below the app header), so a viewport-relative calc silently
            // drifts by exactly that ancestor offset — the panel's own bottom edge ran 41px past
            // the real viewport bottom at a short (iPhone) height even though the arithmetic
            // "looked" right. `100%` here is relative to the SAME positioned ancestor `top`
            // already measures from, so the two can't disagree — and it rides whatever that
            // ancestor resolves to, so it also follows a mobile browser's address-bar chrome
            // showing/hiding automatically, which a hardcoded number cannot.
            display: "flex", flexDirection: "column",
            // Phone: drop below the full-width search bar; a slim tap when closed, a wider
            // overlay (above the layers panel) when the user opens it.
            ...(narrow
              ? { top: 60, left: 8, zIndex: MAP_CHROME_Z.panel, width: sitesPanelOpen ? "min(320px, calc(100vw - 16px))" : 188, maxHeight: "calc(100% - 68px)" }
              : { top: 10, left: 10, zIndex: MAP_CHROME_Z.panel, width: 232, maxHeight: "calc(100% - 24px)" }) }}>
            {/* collapsible header (B106) + the two tabs — one row, always visible (never buried
                behind the collapse, and now PINNED — flex:"none" against the scrollable body
                below — so both counts stay readable, and reachable, no matter how long either
                tab's content runs). */}
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "6px 6px 4px" }}>
              {/* NEW-1/NEW-3 (map landing radius audit) — nestedIn(RADIUS.lg, 6), not a bare
                  RADIUS.sm literal: this header row sits 6px in from the panel's own RADIUS.lg=12
                  edge, same reasoning as RailTab just above (docs/DESIGN.md's radius exception 3). */}
              <button onClick={() => { if (narrow && !sitesPanelOpen) setLayersPanelOpen(false); toggleSitesPanel(); }}
                title={sitesPanelOpen ? "Collapse the sites panel" : "Expand the sites panel"}
                style={{ flex: "none", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center",
                  background: "transparent", border: "none", cursor: "pointer", color: PAL.muted, borderRadius: nestedIn(RADIUS.lg, 6) }}>
                <span style={{ fontSize: 8, lineHeight: 1, transform: sitesPanelOpen ? "none" : "rotate(-90deg)", display: "inline-block" }}>▼</span>
              </button>
              <RailTab label="Sites" count={nf ? `${shownCount}/${sites.length}` : sites.length}
                active={mode === "site"} onClick={() => { setMode("site"); if (!sitesPanelOpen) toggleSitesPanel(); }} />
              <RailTab label="Comps" count={comps.length} active={mode === "comp"}
                onClick={() => { setMode("comp"); if (!sitesPanelOpen) toggleSitesPanel(); }} />
            </div>
            {/* B948496 — everything below the pinned header is ONE scrollable region, so the
                panel itself never grows past the viewport regardless of which tab is open or
                how much either holds (a long site list, several site plans, an open comp
                form). Sites-tab sections keep their own bounded inner scrollers (unchanged)
                for per-group behavior; this outer scroller is the backstop that makes the
                WHOLE panel — not just one nested list — reachable at any viewport height. */}
            <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", overflowY: "auto" }}>
            {sitesPanelOpen && mode === "site" && (<>
            {/* B855952 (NEW-1) — the name filter and the sort control share ONE line (the status
                chip row this replaced ate two). "Delete the status filter chip row" — owner,
                verbatim: "that's not really a good way to filter it… there's literally just
                nothing there." Collapsing a group IS the filter now (below). */}
            <div style={{ display: "flex", gap: 6, padding: "0 8px 8px" }}>
              <input value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} placeholder="Filter by name…" aria-label="Filter sites by name"
                style={{ flex: 1, minWidth: 0, boxSizing: "border-box", padding: "5px 8px", fontSize: 12, border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.sm, color: PAL.ink, background: "var(--surface-raised)", fontFamily: "inherit", outline: "none" }} />
              <select value={sitesPanelPrefs.sort} onChange={(e) => setSitesSort(e.target.value)} aria-label="Sort sites within each group"
                title="Sort — applies within each group, not across groups"
                style={{ flex: "none", boxSizing: "border-box", padding: "5px 6px", fontSize: 11, border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.sm, color: PAL.ink, background: "var(--surface-raised)", fontFamily: "inherit", outline: "none" }}>
                <option value="largest">Largest first</option>
                <option value="az">A–Z</option>
                <option value="recent">Recently touched</option>
              </select>
            </div>
            {/* B855953/B855954 (NEW-2/NEW-3) — the Pinned section (fixed, never reorderable) sits
                above every status group; the groups themselves drag-reorder via each header's
                hover/focus-revealed grip. Collapsing a group is the only "filter" left (NEW-1). */}
            <div style={{ maxHeight: 340, overflowY: "auto", paddingBottom: 4, borderTop: `1px solid ${PAL.panelLine}` }}>
              {(() => {
                const pinnedRows = sortRows(sites.filter((s) => pinnedSet.has(s.id) && passName(s)));
                const groupBlocks = orderedStatuses.map((st) => {
                  const rows = sites.filter((s) => statusOf(s) === st && passName(s)); // TRUE group total — pinned included
                  if (!rows.length) return null;
                  const visibleRows = sortRows(rows.filter((s) => !pinnedSet.has(s.id))); // pinned sites live in the Pinned section instead
                  // While a name filter is active, force matching sections open so a match in a
                  // settled (collapsed) group isn't hidden.
                  const t = statusToken(st); const collapsed = groupCollapsedFor(st) && !nf;
                  return (
                    <div key={st}
                      onDragOver={(e) => { if (dragGroup && dragGroup !== st) e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); dropGroup(st); }}>
                      <div onMouseEnter={() => setHoverGroup(st)} onMouseLeave={() => setHoverGroup((g) => (g === st ? null : g))}
                        style={{ display: "flex", alignItems: "center", background: "var(--surface-raised)", borderTop: `1px solid ${PAL.panelLine}` }}>
                        <button onClick={() => toggleGroup(st)} title={collapsed ? "Expand" : "Collapse"}
                          style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit", padding: "4px 4px 4px 12px" }}>
                          <span style={{ fontSize: 8, lineHeight: 1, transform: collapsed ? "rotate(-90deg)" : "none", display: "inline-block", color: PAL.muted }}>▼</span>
                          {/* Solid status disc, matching the map pin (B433). */}
                          <span style={{ width: 14, height: 14, flex: "none", display: "grid", placeItems: "center", borderRadius: RADIUS.pill, background: t.color, color: "#fff", fontSize: 8.5, lineHeight: 1 }}>{t.glyph}</span>
                          <span style={{ flex: 1, textAlign: "left", fontSize: 11, fontWeight: 700, color: PAL.ink, textDecoration: t.struck ? "line-through" : "none" }}>{STATUS_META[st]?.label || st}</span>
                          {/* B845089 — the acreage total dropped from this line: "if acreage is not
                              the criterion, a sum of it is not either" (this session's call, not the
                              owner's words — easy to reverse if he wants it back). */}
                          <span style={{ color: PAL.muted, fontWeight: 700, fontSize: 11 }}>{rows.length}</span>
                        </button>
                        {/* NEW-3 — the drag handle: quiet at rest, shown on hover/focus, and a
                            focusable control so arrow-key reorder doesn't need a visible drag to
                            discover it. */}
                        <button draggable tabIndex={0} aria-label={`Reorder the ${STATUS_META[st]?.label || st} group`}
                          title="Drag to reorder, or focus + arrow keys"
                          onDragStart={(e) => { setDragGroup(st); try { e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", st); } catch (_) {} }}
                          onDragEnd={() => setDragGroup(null)}
                          onFocus={() => setHoverGroup(st)} onBlur={() => setHoverGroup((g) => (g === st ? null : g))}
                          onKeyDown={(e) => {
                            if (e.key === "ArrowUp") { e.preventDefault(); moveGroup(st, -1); }
                            else if (e.key === "ArrowDown") { e.preventDefault(); moveGroup(st, 1); }
                          }}
                          style={{ flex: "none", width: 17, height: 17, marginRight: 4, display: "grid", placeItems: "center", background: "transparent", border: "none", borderRadius: RADIUS.sm, cursor: "grab", color: PAL.muted, opacity: hoverGroup === st ? 1 : 0, transition: "opacity .12s" }}>
                          <svg width="9" height="13" viewBox="0 0 9 13" fill="currentColor" aria-hidden="true">
                            <circle cx="2" cy="1.8" r="1.2" /><circle cx="7" cy="1.8" r="1.2" />
                            <circle cx="2" cy="6.5" r="1.2" /><circle cx="7" cy="6.5" r="1.2" />
                            <circle cx="2" cy="11.2" r="1.2" /><circle cx="7" cy="11.2" r="1.2" />
                          </svg>
                        </button>
                      </div>
                      {!collapsed && visibleRows.map((s) => siteRow(s))}
                    </div>
                  );
                }).filter(Boolean);
                if (!pinnedRows.length && !groupBlocks.length) {
                  return <div style={{ fontSize: 11.5, color: PAL.muted, padding: "10px 12px" }}>No sites match{nf ? ` “${nameFilter.trim()}”` : ""}.</div>;
                }
                return (
                  <>
                    {pinnedRows.length > 0 && (
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 12px", background: "var(--surface-raised)" }}>
                          <span style={{ flex: "none", color: PAL.muted, display: "grid", placeItems: "center", lineHeight: 0 }}><PinGlyph size={11} /></span>
                          <span style={{ flex: 1, textAlign: "left", fontSize: 11, fontWeight: 700, color: PAL.ink }}>Pinned</span>
                          <span style={{ color: PAL.muted, fontWeight: 700, fontSize: 11 }}>{pinnedRows.length}</span>
                        </div>
                        <div style={{ maxHeight: pinnedRows.length > 6 ? 192 : "none", overflowY: pinnedRows.length > 6 ? "auto" : "visible" }}>
                          {/* B885136 — Pinned is the one FLAT/mixed-status view: a pinned Pursuit
                              site and a pinned Active site sit under the same "Pinned" header,
                              which carries no single status colour, so the per-row dot is the
                              only thing here that still says which is which. */}
                          {pinnedRows.map((s) => siteRow(s, { showStatusDot: true }))}
                        </div>
                      </div>
                    )}
                    {groupBlocks}
                  </>
                );
              })()}
            </div>
            </>)}
            {/* B831777 (NEW-2) — the Comps tab's content. Mounted whenever the map route is
                visible (`open={visible}`) so a comp anchored while browsing Sites still loads and
                renders as a map pin (NEW-3) — only DISPLAY is gated on the tab (`active`). */}
            {(sitesPanelOpen && mode === "comp") && (
              <PanelErrorBoundary name="SitePlans">
                <Suspense fallback={<div style={{ padding: 14, fontSize: 12, color: PAL.muted }}>Loading…</div>}>
                  <SitePlansSection
                    open={visible}
                    active={sitesPanelOpen && mode === "comp"}
                    projects={sites}
                    onOverlaysChange={setSitePlanOverlays}
                    suggestPlacement={suggestPlacement}
                    activeOverlayId={activeOverlayId}
                    onActivateOverlay={selectOverlay}
                    onStartPinOnOverlay={startPinOnOverlay}
                    onStopPinOnOverlay={stopPinOnOverlay}
                    pinningOverlayId={clickableOverlayId}
                    commitPlacementRef={commitPlacementRef}
                    dropIntakeRef={dropIntakeRef}
                    onRejectFile={onRejectDroppedFile}
                  />
                </Suspense>
              </PanelErrorBoundary>
            )}
            <PanelErrorBoundary name="Comps">
              <Suspense fallback={sitesPanelOpen && mode === "comp" ? <div style={{ padding: 14, fontSize: 12, color: PAL.muted }}>Loading…</div> : null}>
                <CompsPanel
                  open={visible}
                  active={sitesPanelOpen && mode === "comp"}
                  pendingAnchor={pendingCompAnchor}
                  onAnchorConsumed={onCompAnchorConsumed}
                  focusCompId={focusCompId}
                  onFocusHandled={onCompFocusHandled}
                  projects={sites}
                  onCompsChange={onCompsChange}
                  overlaysById={overlaysById}
                  onOpenBrochure={openOverlayBrochure}
                />
              </Suspense>
            </PanelErrorBoundary>
            </div>
          </div>

        {/* imagery + labels + overlay layers control — on a phone this collapses to a tap
            (default closed) so it stops covering the search bar / Select-parcels button. */}
        <div style={{ position: "absolute",
          // B649136 — the box that actually PAINTS the collapsed chip (background/border/radius
          // live here, not on the inner button — see the constant's own header). RADIUS.lg (a
          // "surface that CONTAINS other things") is right for the OPEN content card; collapsed,
          // this reads as a standalone control, so it borrows RADIUS.md + the same solid
          // surface-raised fill from MAP_CORNER_CHIP_STYLE instead of the panel's own
          // slightly-translucent surface-overlay.
          background: layersPanelOpen ? "var(--surface-overlay)" : MAP_CORNER_CHIP_STYLE.background,
          border: `1px solid ${PAL.panelLine}`, borderRadius: layersPanelOpen ? RADIUS.lg : RADIUS.md,
          padding: layersPanelOpen ? "6px 9px 8px" : 0, fontSize: 12, color: PAL.ink, boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          // Collapsed: the DIV (not the button) owns the box-sizing:border-box height, so its own
          // 1px border is INCLUDED rather than added on top of the button's.
          ...(layersPanelOpen ? null : { height: CONTROL_H.lg }),
          // B831777 — this corner used to reserve extra `top` room for the floating "Comps" chip
          // that stacked above it (COMPS_TOGGLE_CLEARANCE_PX); Comps moved to the left rail
          // (NEW-2), so this is topright's sole occupant again and the plain 10/60px applies.
          ...(narrow
            ? { top: 60, right: 8, zIndex: MAP_CHROME_Z.panel, width: layersPanelOpen ? "min(300px, calc(100vw - 16px))" : "auto" }
            /* B427409 — DESKTOP COLLAPSES TOO, and collapsing FREES THE MAP. The width and the
               height bound are now conditional on the same `layersPanelOpen` the phone uses:
               closed, the card shrinks to its header bar (`width: "auto"`, no max-height, no flex
               column) instead of staying a 268-wide block pinned over the imagery. A collapsed
               panel that still covers the map would answer the letter of the report and not the
               point of it. */
            : { top: 10, right: 10, zIndex: MAP_CHROME_Z.panel,
                ...(layersPanelOpen
                  ? { width: 268, maxHeight: panelMaxHeight({ topPx: 10, bottomPx: 76 }), display: "flex", flexDirection: "column" }
                  : { width: "auto" }) }),
          ...(layersPanelOpen ? null : { minWidth: MAP_CORNER_CHIP_STYLE.minWidth }),
        }}>
          {/* B427409 — ONE control, at EVERY breakpoint. This button used to be wrapped in
              `{narrow && (...)}`, so on desktop the panel had no way to close and the owner's only
              recourse was collapsing each section by hand: "I can't hide that layers panel without
              collapsing all the individual ones, and I feel like I should be able to just collapse
              it all together." Same defect shape as the zoom control in B427408 — the phone path
              was built and the desktop path was left behind — and it is fixed the same way, by
              removing the branch rather than adding a second control. */}
          {(
            // B831776 (NEW-5) — sentence case, matching every neighbouring control in this
            // cluster (the switch, the rail tabs, the checkboxes below); this OPEN-state header
            // used to be the one holdout still in UPPERCASE + letterspacing, which is exactly
            // what read as "a section header" rather than "a sibling control."
            <button onClick={toggleLayersPanel} title={layersPanelOpen ? "Collapse layers" : "Imagery & layers"}
              style={layersPanelOpen ? {
                display: "flex", alignItems: "center", gap: 6, width: "100%", background: "transparent", border: "none", cursor: "pointer", fontFamily: "inherit",
                fontSize: 12, color: PAL.ink, fontWeight: 700, padding: "0 0 6px",
              } : {
                // B649136 — collapsed: the SAME type scale/weight/casing/height as Comps (the
                // constant), just re-hosted as a flex row for the disclosure caret. Border/
                // background/shadow stay on the wrapping div above — painting them again here,
                // at the same edges (the div's padding is 0 while collapsed), would double the
                // border pixel for no visible gain.
                ...MAP_CORNER_CHIP_STYLE, border: "none", background: "transparent", boxShadow: "none", height: "100%",
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
              }}>
              <span style={{ fontSize: 8, lineHeight: 1, transform: layersPanelOpen ? "none" : "rotate(-90deg)", display: "inline-block" }}>▼</span>
              <span style={{ flex: 1, textAlign: "left" }}>Imagery &amp; layers</span>
            </button>
          )}
          {/* B1064 tranche c — gated on `visible` too, not just `layersPanelOpen`: this component
              stays mounted (hidden) while the planner is the active mode, and without this the
              now-lazy LayerPanel below would fetch on every boot regardless of which mode is on
              screen. See the import comment above for the full reasoning. */}
          {layersPanelOpen && visible && (<>
          {/* B427410 — the Imagery <select> and the bare "Labels" checkbox that used to sit HERE,
              in their own strip above a "LAYERS" heading and divided off from it, are gone. The
              basemap IS a layer: it now renders inside the list's own Base & terrain group via
              LayerPanel's `basemap` prop — the same control the planner has always had — so
              choosing Esri vs USGS reads as picking a base rather than operating a separate
              machine. The divider and the "LAYERS" heading went with it: LayerPanel renders its
              own group headers, and Base & terrain is the first of them, so the heading was
              labelling a list that already labels itself. */}
          {/* B831778 (NEW-3) — THE LOAD-BEARING DECOUPLING, made VISIBLE: what's drawn is decided
              HERE, by these two checkboxes, and nowhere else. Both default ON. Switching the
              Site/Comp mode or the rail tab never touches either — see the map-layer effects'
              own comments for the enforcement half. */}
          <div style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 2px 8px", marginBottom: 6, borderBottom: `1px solid ${PAL.panelLine}` }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: PAL.ink, cursor: "pointer", padding: "2px 0" }}>
              <input type="checkbox" checked={showSitesLayer} onChange={(e) => toggleShowSitesLayer(e.target.checked)} data-testid="map-show-sites" />
              <span>Sites{sites.length ? ` (${sites.length})` : ""}</span>
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: PAL.ink, cursor: "pointer", padding: "2px 0" }}>
              <input type="checkbox" checked={showCompsLayer} onChange={(e) => toggleShowCompsLayer(e.target.checked)} data-testid="map-show-comps" />
              <span>Comps{comps.length ? ` (${comps.length})` : ""}</span>
            </label>
          </div>
          {/* NEW-3 — the list takes whatever height the card has left instead of a flat 260px
              (about four rows of a twenty-eight layer list). The card itself is bounded by
              panelMaxHeight above, so this can never run off the bottom of the map. */}
          <div style={{ flex: 1, minHeight: 140, overflowY: "auto", margin: "0 -2px", paddingRight: 2 }}>
            {/* No county is pre-picked on the map any more (B11). The jurisdiction
                shown here follows the map's current area (B13) — `viewCounty` is
                resolved from the view centre on every moveend — so the right utility
                overlays are offered outside Houston too; per-site jurisdiction still
                follows the site's own county once one is opened in the planner. */}
            {/* B1091(×2) — on the finder the view county IS the best county fact available (no
                site, no drainage identify), so it feeds the flood scoping too. In the
                planner the two are deliberately different signals. */}
            <LazyPanel name="Layers panel (finder)" minHeight={140}>
            <LayerPanel overlays={overlays} setOverlays={setOverlays} county={viewCounty} siteCounty={viewCounty} layerStatus={layerStatus} coverage={coverage} surface="finder"
              /* B427410 — the basemap as a BASE LAYER inside the list, not a separate strip above
                 it. Choices are DERIVED from the shared BASEMAPS registry, so a source added there
                 shows up here with no second edit; there is no "off" on this surface because the
                 finder's map always has a base (see basemaps.js). `placeNames` is the same
                 provider ROAD-NAMES overlay the bare "Labels" checkbox used to toggle (renamed
                 (×2) from the still-inaccurate "Place names"), carrying the ⓘ every other row in
                 this panel has, plus (×3) its own `opacityControl` slider — `labelsOpacity` — so
                 the owner can dial it from crisp default down to faint rather than only on/off. */
              basemap={{ value: basemap, onChange: setBasemap, choices: FINDER_BASEMAP_CHOICES }}
              placeNames={{ value: labels, onChange: setLabels, opacity: labelsOpacity, onOpacityChange: setLabelsOpacity }}
              /* NEW-2 — which STATE the map is looking at, so a Texas-only source is named as
                 "not available in Colorado" rather than offered as a toggle that produces an
                 empty map. The view centre is the best state fact the finder has (there is no
                 site here), and an unresolved one hides nothing. */
              siteState={viewState}
              /* NEW-1 — the live zoom every row's gate is reported against, and the fix. On this
                 surface the map is the interactive one, so `setZoom` IS the whole action. */
              mapZoom={zoom}
              onZoomTo={(z) => { try { mapRef.current && mapRef.current.setZoom(z); } catch (_) {} }} />
            </LazyPanel>
          </div>
          </>)}
        </div>

        {/* NEW-MAPCTRL-3 — THE BOTTOM-LEFT BANNER SLOT, and why it is now ONE wrapper instead of five
            identically-positioned `position:absolute` divs. Every one of these used a bare
            `bottom: ZOOM_CONTROL_CLEARANCE_PX`, which only clears the BOTTOM (the zoom/locate
            stack) — it says nothing about the TOP, and in narrow mode the full-width search bar
            sits at a fixed `top:8` regardless of how tall the map pane is. On a genuinely short
            pane (a landscape phone/tablet — narrow width, short height, the reported case: bar
            at y121-163, tip at y103-157, a real 36-42px overlap measured live) a bottom-anchored
            box can render ABOVE the search bar's bottom edge, burying the ONLY instruction this
            app offers for how "+ Select parcels" mode works.
            THE FIX is a `top`+`bottom` pair (never `bottom` alone): the outer wrapper spans from
            a real ceiling (the search bar's own bottom edge + a gap, narrow only — 0 on desktop,
            where the search bar is a small centered pill nowhere near this corner) down to the
            existing zoom-stack floor, and a flex column with `justifyContent:"flex-end"` hugs
            the box to the BOTTOM of that span — so it reads exactly as before on every taller
            screen, and on a short one it is squeezed against its ceiling rather than climbing
            past it. No JS measurement needed: both edges are already-known constants.
            ⛔ `overflow:"hidden"` on the wrapper is doing real work, not tidying: a flex child
            TALLER than its own span (the banner's natural height vs. an EXTREMELY short pane —
            measured under 200px of usable pane height, past any realistic device) still overflows
            the `flex-end` anchor in the direction opposite the anchor, i.e. back past the ceiling.
            Clipping there means the search bar can NEVER be covered even in that pathological
            case — a message truncated at the top is the honest failure, a hidden search box is not. */}
        <div style={{ position: "absolute", left: 12, top: narrow ? SEARCH_BAR_CLEARANCE_PX : 0, bottom: ZOOM_CONTROL_CLEARANCE_PX, maxWidth: 380, zIndex: 1000, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 8, pointerEvents: "none", overflow: "hidden" }}>
        {/* error toast — surfaced on an error, OR on the NEW-MAPCTRL-2 "you're far
            from your sites" offer alone (STEEL-MAN ix), which can stand with no error text at all. */}
        {(err || locateFar) && (
          <div style={{ background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.lg, padding: "8px 11px", fontSize: 12.5, color: PAL.accent, lineHeight: 1.45, pointerEvents: (fallbackOffer || locateFar) ? "auto" : "none" }}>
            {err}
            {/* NEW-4 — the way forward rides WITH the bad news. Only on a genuine source outage:
                "no parcel right there" is an answer, not an outage, and gets no button. */}
            {fallbackOffer && (
              <button onClick={() => startBlankHere(fallbackOffer.at)} data-testid="map-start-blank-here"
                style={{ display: "block", width: "100%", marginTop: 8, height: 30, borderRadius: RADIUS.sm, border: "none", background: PAL.accent, color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                Start the plan here &amp; draw the boundary →
              </button>
            )}
            {/* NEW-MAPCTRL-2 — STEEL-MAN ix: flying to a location far from every saved site is
                the right call (it's where the user is), but it must leave a way back. */}
            {locateFar && (
              <button onClick={backToSites} data-testid="map-back-to-sites"
                style={{ display: "block", width: "100%", marginTop: err ? 8 : 0, height: 30, borderRadius: RADIUS.sm, border: `1px solid ${PAL.panelLine}`, background: "var(--surface-raised)", color: PAL.ink, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                ◂ Back to your sites
              </button>
            )}
          </div>
        )}
        {/* NEW-2 — share/unshare confirmation (same slot as the error toast, mutually
            exclusive with it): the visible after-state the owner asked for. */}
        {!err && shareNotice && (
          <div role="status" style={{ background: "var(--success-bg)", border: "1px solid var(--success-border)", borderRadius: RADIUS.lg, padding: "8px 11px", fontSize: 12.5, color: "var(--success-text)", lineHeight: 1.45 }}>
            {shareNotice}
          </div>
        )}
        {/* B855952/B855953/B855954 — LOUD-FAILURE for a failed Sites-panel arrangement save (a
            pin, a drag reorder, a collapse toggle, or a sort change that couldn't reach the
            account row): the change still applies on this device, but it's said out loud rather
            than silently staying local. */}
        {!err && !shareNotice && prefsSaveWarn && (
          <div role="status" style={{ background: "rgba(255,250,240,0.96)", border: "1px solid #e6c478", borderRadius: RADIUS.lg, padding: "8px 11px", fontSize: 12, color: "#8a5a00", lineHeight: 1.45 }}>
            {prefsSaveWarn}
          </div>
        )}
        {/* statewide-backup notice — the clicked lot was answered by the
            all-Texas TxGIO layer because the county's own server was down; be honest
            about provenance so a possibly-staler source is never mistaken for the
            county's own record (B244). */}
        {backupNotice && !err && (
          <div style={{ background: "rgba(255,250,240,0.96)", border: "1px solid #e6c478", borderRadius: RADIUS.lg, padding: "8px 11px", fontSize: 12, color: "#8a5a00", lineHeight: 1.45 }}>
            <b>Statewide backup source.</b> {backupNotice.county} county’s own parcel server is unavailable, so this lot came from the all-Texas TxGIO layer — accurate for selection, but it may lag recent county updates.
          </div>
        )}
        {/* cached-snapshot notice — the clicked lot came from Planyr's saved Drive
            snapshot because the live county server was unreachable (B629). Same honesty as the
            statewide-backup notice: a possibly-staler local copy is never mistaken for a live record. */}
        {cachedNotice && !err && !backupNotice && (
          <div style={{ background: "rgba(255,250,240,0.96)", border: "1px solid #e6c478", borderRadius: RADIUS.lg, padding: "8px 11px", fontSize: 12, color: "#8a5a00", lineHeight: 1.45 }}>
            <b>Cached copy{fmtAsOf(cachedNotice.asOf)}.</b> {cachedNotice.county} county’s live parcel server is unavailable, so this lot came from Planyr’s saved snapshot — accurate for selection, but it may lag recent county updates.
          </div>
        )}
        {/* contextual selection guidance — only while actively selecting (not a persistent
            fixture). This is the ONE explanation anywhere in the app for how "+ Select parcels"
            mode works, which is exactly why it must never be the box that ends up covered. */}
        {!err && selectMode && (
          <div data-testid="select-parcels-tip" style={{ background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.lg, padding: "8px 11px", fontSize: 12.5, color: PAL.ink, lineHeight: 1.45, pointerEvents: "none" }}>
            {zoom != null && zoom < PARCEL_MINZOOM
              ? "Click any lot to add it (＋) — it works even before the purple outlines appear. Zoom in a little to see the lines."
              : "Click a lot to add it (＋). Hover an added lot and click to remove it (−). Add several, then Plan."}
          </div>
        )}
        </div>
        {/* (B167) The idle "Drag to move the map" first-run bubble was removed entirely. */}

        {/* NEW-4 — the locate button's own "blocked" message, anchored to the button itself
            (never the page-corner err banner above) so it reads as feedback on THAT control —
            same visual treatment as the err banner (no new style), just correctly placed and,
            unlike err, dismissible by hand and self-clearing after LOCATE_NOTICE_MS. */}
        <AnchoredMenu open={!!locateNotice} onClose={dismissLocateNotice} anchorRef={locateBtnRef} hoverSafe
          placement="above-left" width={240} gap={8} zIndex={MAP_CHROME_Z.alert}
          panelStyle={{ background: "var(--surface-overlay)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.lg, boxShadow: "0 8px 24px rgba(0,0,0,0.22)" }}>
          <div role="status" style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "8px 11px", fontSize: 12.5, color: PAL.accent, lineHeight: 1.45 }}>
            <span style={{ flex: 1 }}>{locateNotice}</span>
            <button onClick={dismissLocateNotice} aria-label="Dismiss" title="Dismiss"
              style={{ flex: "none", cursor: "pointer", background: "transparent", color: PAL.muted, border: "none", fontSize: 13, fontWeight: 800, padding: 0, lineHeight: 1 }}>✕</button>
          </div>
        </AnchoredMenu>

      </div>
      {/* Right-click context menu for a project — set its lifecycle stage (B7) or delete
          it (B168). One menu, not two: the status picker now also carries Delete, which
          routes through the existing confirmation modal (no single-click destruction).
          Opened from a card row OR a map marker/boundary. Positioned at the cursor,
          clamped to the viewport; the full-screen backdrop keeps it above all map layers. */}
      {statusMenu && (
        <ContextMenu x={statusMenu.x} y={statusMenu.y} onClose={() => setStatusMenu(null)} width={180} zIndex={4200}
          className="" ariaLabel="Project actions"
          panelStyle={{ background: "var(--surface-raised)", border: `1px solid ${PAL.panelLine}`, borderRadius: RADIUS.lg, boxShadow: "0 14px 40px rgba(0,0,0,0.28)", padding: "4px 0" }}>
          <>
            <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 12px 4px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{statusMenu.site.site || statusMenu.site.name || "Site"}</div>
            {STATUSES.map((st) => {
              const t = statusToken(st); const cur = statusOf(statusMenu.site) === st;
              return (
                <button key={st} onClick={() => setStatus(statusMenu.site.id, st)}
                  style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                    background: cur ? "#fbf3ee" : "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: cur ? 700 : 500, textDecoration: t.struck ? "line-through" : "none" }}>
                  <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", borderRadius: RADIUS.pill,
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
                  {/* NEW-2 — THE MENU STATES ITS CURRENT STATE BEFORE IT OFFERS AN ACTION. The owner's
                      report was that after sharing, "options still pop up to share it, so it makes it
                      seem like it hasn't been." Two causes: the ✓ was keyed on `s.teamId`, which was
                      always blank (the mirror bug above), and even with it lit, a list of team names
                      reads as an invitation rather than as a state. So the state is now a SENTENCE,
                      and the actions sit under it. */}
                  <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "4px 12px 2px" }}>
                    {s.teamId ? "Sharing" : "Share with team"}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "1px 12px 5px", fontSize: 12,
                    color: s.teamId ? PAL.accent : PAL.muted, fontWeight: s.teamId ? 700 : 500 }}>
                    {s.teamId && <ShareGlyph size={12} />}
                    <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.teamId ? `Shared with ${teamName(s.teamId)}` : "Private — only you can see this"}
                    </span>
                  </div>
                  {/* NEW-2 — WHAT gets shared, stated before the click. Owner: "not really clear
                      that it's sharing anything." A team NAME answers WHO; nothing here answered
                      WHAT, and the honest answer is narrower than "this project" — sharing today
                      moves the site plans (the drawings) only. Notes/Library/Review/Schedule have
                      no team column at all and are never touched (see B326416's scope guarantee). */}
                  <div style={{ padding: "0 12px 6px", fontSize: 10.5, color: PAL.muted, lineHeight: 1.35 }}>
                    Shares this project's site plans (the drawings) — Notes, Library, Review and Schedule stay private.
                  </div>
                  {myTeams.map((tm) => {
                    const on = s.teamId === tm.id;
                    return (
                      <button key={tm.id} disabled={shareBusy} onClick={() => doShare(s, on ? null : tm.id)}
                        title={on ? `Stop sharing with ${tm.name}` : `Share this project with ${tm.name}`}
                        style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                          background: on ? "#fbf3ee" : "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: on ? 700 : 500 }}>
                        <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", color: PAL.accent, lineHeight: 0 }}>
                          <ShareGlyph />
                        </span>
                        <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tm.name}</span>
                        {/* An already-shared team offers the REVERSE action, and says so. Without this
                            the row is indistinguishable from the offer to share. */}
                        {on
                          ? <span style={{ color: PAL.muted, fontWeight: 600, fontSize: 11, flex: "none" }}>✓ Unshare</span>
                          : <span style={{ color: PAL.muted, fontWeight: 600, fontSize: 11, flex: "none" }}>Share</span>}
                      </button>
                    );
                  })}
                  {s.teamId && (
                    <button disabled={shareBusy} onClick={() => doShare(s, null)}
                      title="Pull this project back to private — teammates lose access"
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
            {/* B855953 (NEW-2) — owner, verbatim: "let's add an option to pin a site to the top.
                And, like, maybe we just right click and you can pin it." This IS that menu — no
                separate affordance was built. Reachable on a phone too: the status dot's own tap
                (above) opens this same menu, so no long-press is needed. */}
            <button onClick={() => { const s = statusMenu.site; setStatusMenu(null); togglePin(s.id); }}
              title={pinnedSet.has(statusMenu.site.id) ? "Remove this project from the top of the list" : "Pin this project to the top of the list"}
              style={{ display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left", padding: "7px 12px", border: "none",
                background: "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 600 }}>
              <span style={{ width: 15, height: 15, flex: "none", display: "grid", placeItems: "center", lineHeight: 0 }}>
                <PinGlyph size={13} />
              </span>
              <span style={{ flex: 1 }}>{pinnedSet.has(statusMenu.site.id) ? "Unpin" : "Pin to top"}</span>
            </button>
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
          </>
        </ContextMenu>
      )}
      {confirmDel && (
        <div onClick={() => setConfirmDel(null)} style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(20,18,15,0.5)", display: "grid", placeItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "var(--surface-raised)", borderRadius: RADIUS.lg, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", padding: 20, width: 340, maxWidth: "92vw" }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: PAL.ink, marginBottom: 6 }}>Delete this site?</div>
            <div style={{ fontSize: 12.5, color: PAL.muted, lineHeight: 1.5, marginBottom: 16 }}>“{confirmDel.site || confirmDel.name || "this site"}” and all of its plans move to Recently deleted. You can restore it from the project switcher for 30 days.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="gbtn" style={{ padding: "8px 14px", fontSize: 12.5, borderRadius: RADIUS.md, border: `1px solid ${PAL.panelLine}`, background: "var(--surface-raised)", color: PAL.ink, cursor: "pointer", fontWeight: 600 }} onClick={() => setConfirmDel(null)}>Cancel</button>
              <button style={{ padding: "8px 14px", fontSize: 12.5, borderRadius: RADIUS.md, border: "1px solid #b91c1c", background: "#b91c1c", color: "#fff", cursor: "pointer", fontWeight: 600 }} onClick={() => { onDeleteSite && onDeleteSite(confirmDel.id); setConfirmDel(null); }}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
