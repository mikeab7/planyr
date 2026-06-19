import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { loadSite, saveSite, deleteSite, isCloudActive, pushSiteToCloud, listVersions, getVersion } from "./lib/storage.js";
import { mergeSiteContent, createSiteModel } from "./lib/siteModel.js";
import { parkDepthForRows, parkRowsForDepth, splitParkingPieces, edgeAbutsPaving } from "./lib/parking.js";
import { loadAndDownscaleImage } from "./lib/image.js";
import { openOverlayFile, rasterizePage, isPdfFile, rasterizeStoredPdf } from "./lib/overlayPdf.js";
import ParcelDrawing from "./components/ParcelDrawing.jsx";
import { uploadOverlayFile, uploadParcelDrawingFile, downloadOverlayBytes, downloadOverlayDataUrl, deleteOverlayObject } from "./lib/overlayStorage.js";
import { COMMON_SCALES, ftPerPointForScale, scaleForFtPerPoint } from "./lib/overlayScale.js";
import { solveSimilarityLSQ, applySimilarityToOverlay, scaleOverlayAbout } from "./lib/overlayAlign.js";
import { hasPrintableOverlay } from "./lib/overlayPrint.js";
import { syncOverlayLayers, withTileRetry } from "./lib/layers.js";
import { fetchOverpass } from "./lib/evidenceLayers.js";
import { loadEasementRules, saveEasementRules, defaultJurForCounty } from "./lib/easementRules.js";
import { sampleProfile, ditchStats } from "./lib/elevation.js";
import LayerPanel from "./components/LayerPanel.jsx";
import AnchoredMenu from "../../shared/ui/AnchoredMenu.jsx";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { COUNTIES, COUNTIES_MAP, detectField, resolveTaxRates } from "./lib/counties.js";
import {
  getLayerInfo,
  resolveLayerUrl,
  queryFeatures,
  queryAtPoint,
  largestRingLngLat,
  outerRingsLngLat,
  lngLatRingToFeet,
  feetToLatLng,
  humanizeError,
} from "./lib/arcgis.js";
import { TYPE, typeStyle, elStyle, toHex6, byZ } from "./lib/planStyle.js";
import { parseCalls, callsToPath, pathCloses, misclosure, bufferPolyline, ringsOverlap } from "./lib/metesAndBounds.js";
import { EASEMENT_TYPES, easementType, easementColor, easementLabel, easementArea, DEFAULT_EASEMENT_ATTRS, deriveEasementRing, buildParcelEdgeStrip } from "./lib/easements.js";
import { readTitlePDF, fileToBase64, getKey, setKey } from "./lib/titleReader.js";
import { identifyJurisdiction, identifyRoadAuthority } from "./lib/jurisdiction.js";
import { formatAge } from "./lib/gisCache.js";
import { buildingNumbers, roadTravelWidth } from "./lib/siteModel.js";
import { layoutLabels, buildingLabelLines, dimCalloutVisible } from "./lib/labelLayout.js";
import { addedAreaLabelPoint } from "./lib/pondGeom.js";
import { splitPolygonByLine, splitPolygonByPath } from "./lib/polygonSplit.js";
import { buildSheetFurnitureSvg, buildScreenFurnitureSvg } from "./lib/sheetFurniture.js";

/* Geographic basemap under the planner canvas. The planner stays a feet-based
 * SVG (so every metric, setback and stall count is computed from true feet and
 * is unaffected by display projection); we just place a Leaflet Web-Mercator
 * basemap + the shared overlay layers beneath it, anchored to the site origin.
 * Mercator is conformal, so a uniform pixels-per-foot aligns to it with no x/y
 * distortion over a site — only the basemap's zoom/center are derived from the
 * planner view. */
const GEO_BASEMAP = {
  tiles: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  maxNative: 19,
  attr: "Imagery &copy; Esri, Maxar",
};
const M_PER_FT = 0.3048;
const EARTH_M = 40075016.686; // Web-Mercator world circumference (m) at the equator
// Leaflet (fractional) zoom whose pixels-per-foot equals the planner's `ppf` at
// the given latitude — so the basemap scale matches the SVG exactly.
const ppfToZoom = (ppf, lat) =>
  Math.log2((ppf / M_PER_FT) * EARTH_M * Math.cos((lat * Math.PI) / 180) / 256);

/* ------------------------------------------------------------------ *
 *  Industrial Site Planner — prototype (TestFit-style, industrial)
 *  Units: everything internal is in FEET. The canvas <g> scales
 *  feet -> pixels via pxPerFoot + pan offsets. Labels & handles are
 *  drawn in screen (pixel) space for crisp, zoom-independent UI.
 * ------------------------------------------------------------------ */

const SQFT_PER_ACRE = 43560;
const POND_ADD_MIN_SF = 50; // B157: below this, an expansion is too small to seat its own added-area label
const DOGEAR_W = 55; // dog-ear / corner bump-out: span along the dock wall
const DOGEAR_D = 60; // dog-ear projection out from the dock face
const CURB = 0.5;    // 6" curb on each side of a road (added to its true width)

const PAL = {
  paper: "#f4f1ea",
  gridMinor: "#e3ddd0",
  gridMajor: "#cfc6af",
  ink: "#2c2a26",
  accent: "#c2410c", // drafting red-orange (canvas selection)
  accentSoft: "#f0d9cc",
  setback: "#b45309",
  parcel: "#5b6650", // parcel boundary line (drafting green)
  panelBg: "#ffffff",
  panelLine: "#e7e2d6",
  muted: "#8a8473",
  // dark chrome (top bar, tool rail, status bar)
  chrome: "#191613",
  chromeLine: "#2e2a23",
  chromeInk: "#ece7db",
  chromeMuted: "#9b9482",
  ember: "#e8590c", // UI accent on dark chrome
};

/* Lucide-style 16×16 stroke icons for the tool rail (inherit currentColor). */
const ICON_PATHS = {
  select: <path d="M4 2.5 L12.8 8 L8.8 9 L11.2 13.6 L9.2 14.6 L6.9 9.9 L4 12.4 Z" fill="currentColor" stroke="none" />,
  parcel: <path d="M3 5.2 L8 2.6 L13.2 5.6 L12.2 12.4 L4.2 13.2 Z" />,
  building: <><rect x="2.5" y="4" width="11" height="8.5" rx="0.5" /><path d="M5.5 12.5 v-2.5 h2 v2.5 M10 6.8 h1.5 M4.5 6.8 H6" /></>,
  paving: <><rect x="2.5" y="2.5" width="11" height="11" rx="1" /><path d="M2.5 9.8 L9.8 2.5 M6.2 13.5 L13.5 6.2" /></>,
  parking: <path d="M5.2 13.5 V2.8 h3.6 a3.1 3.1 0 0 1 0 6.2 H5.2" />,
  trailer: <><rect x="1.8" y="4.5" width="9" height="5.5" rx="0.5" /><path d="M10.8 6.5 h2.6 l0.8 2.4 v1.1 h-3.4" /><circle cx="4.6" cy="11.8" r="1.3" /><circle cx="12.2" cy="11.8" r="1.3" /></>,
  pond: <path d="M8 2.6 C8 2.6 3.6 7.8 3.6 10.4 a4.4 4.4 0 0 0 8.8 0 C12.4 7.8 8 2.6 8 2.6 Z" />,
  road: <><path d="M5.2 2.5 L3.2 13.5 M10.8 2.5 L12.8 13.5" /><path d="M8 3 v2.2 M8 7 v2.2 M8 11 v2.2" /></>,
  easement: <><path d="M2.5 4.5 H13.5 M2.5 11.5 H13.5" /><path d="M2.5 8 H13.5" strokeDasharray="2 1.6" opacity="0.7" /></>,
  measure: <><path d="M2.2 10.8 L10.8 2.2 L13.8 5.2 L5.2 13.8 Z" /><path d="M5.6 7.4 l1.4 1.4 M8 5 l1.4 1.4" /></>,
  combine: <><path d="M2.5 2.5 h7 v4 h4 v7 h-7 v-4 h-4 Z" /></>,
  pan: <path d="M5 7 V3.6 a1.1 1.1 0 0 1 2.2 0 V6.6 M7.2 6.4 V2.9 a1.1 1.1 0 0 1 2.2 0 V6.6 M9.4 6.6 V3.5 a1.1 1.1 0 0 1 2.2 0 V8.5 M11.6 6 a1.1 1.1 0 0 1 2.1 0 l-0.2 4 a4 4 0 0 1-4 3.6 H8 a4 4 0 0 1-3.3-1.8 L2.6 9.6 a1.1 1.1 0 0 1 1.7-1.4 L5 9" />,
  callout: <><rect x="2.2" y="2.4" width="8.6" height="6" rx="1" /><path d="M5.2 8.4 L4 11.2 L7.2 8.4" /><path d="M11 11.5 L13.8 13.8" /></>,
  text: <><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M5.4 6 H10.6 M8 6 V10.6" /></>,
  mline: <path d="M3 13 L13 3" />,
  mrect: <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />,
  mellipse: <ellipse cx="8" cy="8" rx="6" ry="4.4" />,
  mpolygon: <path d="M8 2.4 L13.4 6.2 L11.3 12.6 L4.7 12.6 L2.6 6.2 Z" />,
  mpolyline: <path d="M2.5 11 L6 5.5 L9 9 L13.5 3.5" />,
};
const ToolIcon = ({ id, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    {ICON_PATHS[id] || <circle cx="8" cy="8" r="5.5" />}
  </svg>
);

const TOOLS = [
  { id: "select", label: "Select", hint: "Move/resize/rotate • Shift-drag an element to snap & bond it to a neighbour (green +); hold Alt to bypass snap & place freely • toggle snap with S • on a selected parcel: drag a dot to move a corner, click a + to add one, Shift-click a dot to delete • drag empty space to pan • shortcut: V" },
  { id: "pan", label: "Pan", hint: "Hand tool — drag anywhere to move the canvas; clicks don't select. Shortcut: H, or hold Space to pan temporarily (press V for Select)" },
  { id: "parcel", label: "Parcel", hint: "Click to drop boundary points • click the first point (or double-click) to close • Esc cancels" },
  { id: "split", label: "Split", hint: "Cut a parcel: click points to draw a line across it — two points cut straight, or add more for a bent/stepped cut; double-click (or Enter) to finish. It splits into two — then delete the piece you don't want" },
  { id: "callout", label: "Callout", hint: "Annotation (Q): click the point you're calling out, then click where the text box goes, and type. Drag the box to move it, the dot to re-aim the leader; double-click to edit the text" },
  { id: "text", label: "Text", hint: "Text box (T): click where the text goes and type — no leader line. Same size / align / colour / bold / italic options. Drag to move, double-click to edit" },
  { id: "building", label: "Building", hint: "Drag for a rectangle, or click points for an irregular footprint (click the 1st point / double-click to close)" },
  { id: "paving", label: "Paving", hint: "Drag for a rectangle, or click points for an irregular paving / drive / truck court (double-click to close)" },
  { id: "parking", label: "Car Parking", hint: "Pick a row preset from Car Parking ▾ (single 42′ / double 60′) and drag to set the length, or use Free draw for any rectangle / click points for an irregular field; stalls auto-count" },
  { id: "trailer", label: "Trailer Parking", hint: "Drag for a rectangle, or click points to outline irregular trailer storage (double-click to close); auto-counts" },
  { id: "pond", label: "Detention Pond", hint: "Drag for a rectangle, or click points to outline an irregular detention area (double-click to close)" },
  { id: "road", label: "Road", hint: "Pick a width and click two points to lay a road at any angle; Free draw to drag a rectangle. 6″ curb each side (24′ road = 25′ wide)" },
  { id: "easement", label: "Easement", hint: "Draw an easement (Easement ▾ for mode). Centerline+width: click a path, double-click/Enter to finish — it builds a strip of the set width. Boundary: click points, close on the first dot. Offset from parcel edge: click a parcel's edges then Enter. Edit attributes (type/holder/width…) in the Element panel; width re-offsets the strip live" },
  { id: "measure", label: "Measure", hint: "Pick a mode from Measure ▾ — Length (two-point distance), Polylength (click a path, double-click / Enter to finish), or Area (outline a region, click the first dot or double-click to close)" },
  { id: "calibrate", label: "Calibrate", hint: "Underlay scale: click two points a known distance apart on the screenshot, then enter the real length at right" },
  { id: "mline", label: "Line", hint: "Markup line (L): drag end-to-end. Hold Shift for 45° increments" },
  { id: "mrect", label: "Rectangle", hint: "Markup rectangle (R): drag a box. Hold Shift for a square" },
  { id: "mellipse", label: "Ellipse", hint: "Markup ellipse (E): drag a box. Hold Shift for a circle" },
  { id: "mpolygon", label: "Polygon", hint: "Markup polygon (Shift+P): click points, click the first dot or double-click to close. Shift for 45° segments" },
  { id: "mpolyline", label: "Polyline", hint: "Markup polyline (Shift+N): click points, double-click / Enter to finish. Shift for 45° segments" },
];
const DRAW_TYPES = ["building", "paving", "road", "parking", "trailer", "pond"];
const MARKUP_TOOLS = ["mline", "mrect", "mellipse", "mpolygon", "mpolyline"];
// Measure-mode display names — Bluebeam's terms (Length / Polylength / Area). The
// internal mode value stays line/polyline/area (persisted in localStorage), so this is
// label-only; "Polylength" also disambiguates the measurement from the markup "Polyline".
const MEASURE_MODES = [["line", "Length"], ["polyline", "Polylength"], ["area", "Area"]];
const measureModeLabel = (m) => { const e = MEASURE_MODES.find(([k]) => k === m); return e ? e[1] : m; };
const MAX_DIM = 100000; // ft — sane upper clamp so a fat-fingered size can't make absurd geometry / SVG stalls
// Relational tags that point at OTHER elements (a host building or a truck court). A copy/paste
// or duplicate starts standalone, so strip them all — keeping them would dangle a link to an
// element that wasn't cloned (orphan court / dog-ear metadata that refit/trailer logic reads).
const ORPHAN_TAGS = ["attachedTo", "truckCourt", "forCourt", "dogEar", "oppSide", "sideParkSide", "sidewalkSide"];
const detachClone = (src) => { const c = { ...src }; for (const k of ORPHAN_TAGS) delete c[k]; return c; };
const MK_DEFAULT = { stroke: "#c2410c", weight: 2, dash: "solid", fill: "#c2410c", fillOpacity: 0 };
const dashArray = (d, w) => d === "dashed" ? `${w * 3} ${w * 2.4}` : d === "dotted" ? `${w} ${w * 2}` : undefined;
// Snap an angle to the nearest 45° (for Shift-constrained drawing).
const snap45 = (a, b) => { const dx = b.x - a.x, dy = b.y - a.y, r = Math.hypot(dx, dy), ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4); return { x: a.x + r * Math.cos(ang), y: a.y + r * Math.sin(ang) }; };

/* ----------------------------- geometry ---------------------------- */
const rot2 = (x, y, deg) => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return { x: x * c - y * s, y: x * s + y * c };
};
// Black or white label text depending on how light the element's fill is.
const labelInk = (hex) => {
  const h = (hex || "#ffffff").replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 0.6 ? "#1a1a1a" : "#ffffff";
};
// Pick the CSS resize cursor that matches an on-screen direction vector
// (so grips read correctly even when the element is rotated).
const resizeCursor = (dx, dy) => {
  let a = (Math.atan2(dy, dx) * 180) / Math.PI;
  a = ((a % 180) + 180) % 180; // fold to [0,180)
  if (a < 22.5 || a >= 157.5) return "ew-resize";
  if (a < 67.5) return "nwse-resize";
  if (a < 112.5) return "ns-resize";
  return "nesw-resize";
};
// Snap a dragged rectangle flush against nearby axis-aligned rectangles.
// Returns an adjusted {cx,cy}. thr = contact/alignment threshold in feet.
const edgeSnapCenter = (moved, others, thr) => {
  let cx = moved.cx, cy = moved.cy;
  const hw = moved.w / 2, hh = moved.h / 2;
  const mx0 = cx - hw, mx1 = cx + hw, my0 = cy - hh, my1 = cy + hh;
  let bestX = { d: thr }, bestY = { d: thr }, alignX = { d: thr }, alignY = { d: thr };
  for (const t of others) {
    if (t.points || (((t.rot % 360) + 360) % 360) !== 0) continue;
    const thw = t.w / 2, thh = t.h / 2;
    const tx0 = t.cx - thw, tx1 = t.cx + thw, ty0 = t.cy - thh, ty1 = t.cy + thh;
    const yNear = Math.min(my1, ty1) - Math.max(my0, ty0) > -thr; // roughly side-by-side
    const xNear = Math.min(mx1, tx1) - Math.max(mx0, tx0) > -thr; // roughly stacked
    if (yNear) {
      let d = Math.abs(mx0 - tx1); if (d < bestX.d) bestX = { d, cx: tx1 + hw }; // our left → their right
      d = Math.abs(mx1 - tx0); if (d < bestX.d) bestX = { d, cx: tx0 - hw };     // our right → their left
      let dy = Math.abs(my0 - ty0); if (dy < alignY.d) alignY = { d: dy, cy: ty0 + hh };
      dy = Math.abs(my1 - ty1); if (dy < alignY.d) alignY = { d: dy, cy: ty1 - hh };
    }
    if (xNear) {
      let d = Math.abs(my0 - ty1); if (d < bestY.d) bestY = { d, cy: ty1 + hh }; // our top → their bottom
      d = Math.abs(my1 - ty0); if (d < bestY.d) bestY = { d, cy: ty0 - hh };     // our bottom → their top
      let dx = Math.abs(mx0 - tx0); if (dx < alignX.d) alignX = { d: dx, cx: tx0 + hw };
      dx = Math.abs(mx1 - tx1); if (dx < alignX.d) alignX = { d: dx, cx: tx1 - hw };
    }
  }
  if (bestX.cx !== undefined) { cx = bestX.cx; if (alignY.cy !== undefined) cy = alignY.cy; }
  if (bestY.cy !== undefined) { cy = bestY.cy; if (alignX.cx !== undefined) cx = alignX.cx; }
  return { cx, cy };
};
const elCorners = (el) => {
  const hw = el.w / 2, hh = el.h / 2;
  return [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].map(([lx, ly]) => {
    const p = rot2(lx, ly, el.rot);
    return { x: el.cx + p.x, y: el.cy + p.y };
  });
};
const polyArea = (pts) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return Math.abs(a) / 2;
};
const centroid = (pts) => {
  let x = 0, y = 0;
  pts.forEach((p) => { x += p.x; y += p.y; });
  return { x: x / pts.length, y: y / pts.length };
};
// Proper segment crossing (excludes shared endpoints / collinear touches). Used to
// reject self-intersecting "bow-tie" outlines, whose shoelace area is silently wrong.
const segsCross = (p1, p2, p3, p4) => {
  const o = (a, b, c) => Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const o1 = o(p1, p2, p3), o2 = o(p1, p2, p4), o3 = o(p3, p4, p1), o4 = o(p3, p4, p2);
  return !!o1 && !!o2 && !!o3 && !!o4 && o1 !== o2 && o3 !== o4;
};
// Does a closed ring cross itself? O(n²), fine for hand-drawn shapes (few vertices).
const polySelfIntersects = (pts) => {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if ((i + 1) % n === j || (j + 1) % n === i) continue; // adjacent / wrap edges share a vertex
    if (segsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
  }
  return false;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
// Measure records are {mode, pts}. Old records were {a,b} — normalize both.
const measPts = (m) => (m.pts ? m.pts : (m.a && m.b ? [m.a, m.b] : []));
const measMode = (m) => m.mode || "line";
// Neutral markup shapes that support Bluebeam-style geometry editing: vertex shapes
// (line/polyline/polygon) expose draggable control points; box shapes (rect/ellipse)
// resize + rotate via grips. Semantic markups (utilRoute/traced/encumbrance/…) stay
// move-only — they carry derived geometry that hand-editing would desync.
const MK_VERTEX_KINDS = ["line", "polyline", "polygon"];
const MK_BOX_KINDS = ["rect", "ellipse"];
const mkPts = (m) => (m.kind === "line" ? [m.a, m.b] : (m.pts || []));
const setMkPts = (m, pts) => (m.kind === "line" ? { ...m, a: pts[0], b: pts[1] } : { ...m, pts });
const mkMinPts = (m) => (m.kind === "polygon" ? 3 : 2);
const pathLen = (pts) => { let t = 0; for (let i = 1; i < pts.length; i++) t += dist(pts[i - 1], pts[i]); return t; };

function lineIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / d;
  return { x: x1 + t * (x2 - x1), y: y1 + t * (y2 - y1) };
}

// Inward offset of a polygon. `d` is a scalar OR a per-edge array (one value per
// edge i = segment pts[i]→pts[i+1]). Robust: offsets each edge by its left normal
// × sign; where adjacent offset edges don't intersect cleanly (concave spikes) it
// falls back to a beveled corner instead of bailing on the whole ring. Never
// returns null for a valid lot. Self-checks the sign by shrink (area) test.
function offsetPolygon(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  const dist = (i) => (Array.isArray(d) ? (d[i] ?? 0) : d);
  const build = (sign) => {
    const off = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      let ex = -(b.y - a.y), ey = b.x - a.x; // left normal of edge a→b
      const len = Math.hypot(ex, ey);
      if (len === 0) { off.push(null); continue; }
      const k = (sign * dist(i)) / len;
      off.push({ ax: a.x + ex * k, ay: a.y + ey * k, bx: b.x + ex * k, by: b.y + ey * k });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e1 = off[(i - 1 + n) % n], e2 = off[i];
      if (!e1 && !e2) { out.push(pts[i]); continue; }
      if (!e1) { out.push({ x: e2.ax, y: e2.ay }); continue; }
      if (!e2) { out.push({ x: e1.bx, y: e1.by }); continue; }
      const p = lineIntersect(e1.ax, e1.ay, e1.bx, e1.by, e2.ax, e2.ay, e2.bx, e2.by);
      // Parallel / failed miter → bevel: use the two offset endpoints at this corner.
      if (!p) { out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay }); continue; }
      // Reject a runaway spike (miter way past a sane bevel); bevel instead.
      const lim = Math.max(Math.abs(dist(i)), Math.abs(dist((i - 1 + n) % n))) * 6 + 1;
      if (Math.hypot(p.x - e1.bx, p.y - e1.by) > lim) out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay });
      else out.push(p);
    }
    return out.length >= 3 ? out : null;
  };
  const a1 = build(1);
  if (!a1) return build(-1);
  // Inward offset must shrink the ring; if it grew, we offset the wrong way.
  return polyArea(a1) <= polyArea(pts) ? a1 : (build(-1) || a1);
}

/* Outward (EXPANDING) offset by d>0 — pushes every edge out along its outward normal,
 * the opposite of offsetPolygon (which is inward-only, for setbacks/taper). Same miter/
 * bevel handling; selects the variant that GROWS the ring. Used by the pond "push banks
 * out" expansion (B139). Returns null if it can't build a sane ring; callers must ALSO
 * reject a self-intersecting result (tight concave corners) and fall back to drag. */
function expandPolygon(pts, d) {
  const n = pts.length;
  if (n < 3) return null;
  if (!(d > 0)) return pts.map((p) => ({ x: p.x, y: p.y }));
  const build = (sign) => {
    const off = [];
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      const ex = -(b.y - a.y), ey = b.x - a.x; // left normal of edge a→b
      const len = Math.hypot(ex, ey);
      if (len === 0) { off.push(null); continue; }
      const k = (sign * d) / len;
      off.push({ ax: a.x + ex * k, ay: a.y + ey * k, bx: b.x + ex * k, by: b.y + ey * k });
    }
    const out = [];
    for (let i = 0; i < n; i++) {
      const e1 = off[(i - 1 + n) % n], e2 = off[i];
      if (!e1 && !e2) { out.push(pts[i]); continue; }
      if (!e1) { out.push({ x: e2.ax, y: e2.ay }); continue; }
      if (!e2) { out.push({ x: e1.bx, y: e1.by }); continue; }
      const p = lineIntersect(e1.ax, e1.ay, e1.bx, e1.by, e2.ax, e2.ay, e2.bx, e2.by);
      if (!p) { out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay }); continue; }
      const lim = Math.abs(d) * 6 + 1; // bevel a runaway miter spike instead of keeping it
      if (Math.hypot(p.x - e1.bx, p.y - e1.by) > lim) out.push({ x: e1.bx, y: e1.by }, { x: e2.ax, y: e2.ay });
      else out.push(p);
    }
    return out.length >= 3 ? out : null;
  };
  const a1 = build(1);
  if (!a1) return build(-1);
  return polyArea(a1) >= polyArea(pts) ? a1 : (build(-1) || a1); // outward must GROW
}
// Ray-cast point-in-ring (even-odd). Powers the pond expansion's "past the property
// line" screening warning (B139).
const pointInRing = (pt, ring) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i].x, yi = ring[i].y, xj = ring[j].x, yj = ring[j].y;
    if (((yi > pt.y) !== (yj > pt.y)) && (pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

/* Detention storage for a pond whose drawn footprint is TOP-OF-BANK, with
 * `slope`:1 (H:V) interior side slopes — so the basin tapers inward with depth
 * (not a vertical-wall box). Water surface sits `freeboard` below top of bank.
 * Stored volume uses the prismoidal (Simpson) rule over the water column, which
 * is exact for linear side slopes. Areas come from inward polygon offsets:
 * offset = slope × (depth below top of bank). Returns areas (sf) + volume. */
function detentionStorage(ring, depth, freeboard, slope) {
  const sgnArea = (r) => { let a = 0; for (let i = 0, m = r.length; i < m; i++) { const p = r[i], q = r[(i + 1) % m]; a += p.x * q.y - q.x * p.y; } return a / 2; };
  const ringSgn = sgnArea(ring);
  const areaAt = (down) => { // wetted/section area at `down` ft below top of bank
    if (down <= 0) return polyArea(ring);
    const r = offsetPolygon(ring, slope * down);
    if (!r) return 0; // offset collapsed to nothing
    // An over-taper makes offsetPolygon return an inverted/self-intersecting ring whose
    // |area| is bogus; a winding-sign flip vs. the footprint means the basin tapered
    // PAST a point → zero area (so the "tapers to a point" guard can fire) (B60).
    if (ringSgn === 0 || sgnArea(r) * ringSgn <= 0) return 0;
    return polyArea(r);
  };
  const aTop = polyArea(ring);
  const dw = Math.max(0, depth - freeboard);       // water depth
  const aWater = areaAt(freeboard);                 // water surface
  const aBottom = areaAt(depth);                    // basin bottom
  const aMid = areaAt(freeboard + dw / 2);
  const vol = dw > 0 ? (dw / 6) * (aBottom + 4 * aMid + aWater) : 0; // cu ft
  return { aTop, aWater, aBottom, dw, vol };
}

/* ------------------- utility service routing (elec/water) ------------------ */
const _hyp = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function nearestOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}
function nearestOnPolylines(p, polys) {
  let best = null, bd = Infinity;
  polys.forEach((pl) => { for (let i = 0; i < pl.length - 1; i++) { const q = nearestOnSeg(p, pl[i], pl[i + 1]); const d = _hyp(p, q); if (d < bd) { bd = d; best = q; } } });
  return best ? { pt: best, d: bd } : null;
}
function ringHas(p, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const yi = ring[i].y, xi = ring[i].x, yj = ring[j].y, xj = ring[j].x;
    if (((yi > p.y) !== (yj > p.y)) && (p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
const rectRing = (c, w, h) => { const hw = w / 2, hh = h / 2; return [{ x: c.x - hw, y: c.y - hh }, { x: c.x + hw, y: c.y - hh }, { x: c.x + hw, y: c.y + hh }, { x: c.x - hw, y: c.y + hh }]; };
const ringOf = (e) => (e.points ? e.points : elCorners(e));
// A building's walls (with midpoints + lengths), its centre and area.
function buildingWalls(b) {
  const corners = ringOf(b), ctr = centroid(corners), n = corners.length, walls = [];
  for (let i = 0; i < n; i++) { const a = corners[i], d = corners[(i + 1) % n]; walls.push({ a, b: d, mid: { x: (a.x + d.x) / 2, y: (a.y + d.y) / 2 }, len: Math.hypot(d.x - a.x, d.y - a.y) }); }
  return { walls, ctr, area: polyArea(corners) };
}
const LARGE_BLDG_SF = 100000; // ≥ this → snap service to the (long) dock wall
// Build a service route from `source` (a point) to a building: pick the entry
// wall (nearest; for big buildings restrict to the long/dock walls), a fitting
// pad just outside it, and a buffered easement corridor along the route.
function buildUtilRoute(source, b, opts, uid) {
  const { walls, ctr, area } = buildingWalls(b);
  let cands = walls;
  if (area >= LARGE_BLDG_SF) { const mx = Math.max(...walls.map((w) => w.len)); cands = walls.filter((w) => w.len >= mx - 1); }
  let ew = cands[0]; cands.forEach((w) => { if (_hyp(source, w.mid) < _hyp(source, ew.mid)) ew = w; });
  const entry = ew.mid;
  let nx = entry.x - ctr.x, ny = entry.y - ctr.y; const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
  const padC = { x: entry.x + nx * (opts.padSize / 2 + 3), y: entry.y + ny * (opts.padSize / 2 + 3) };
  const pts = [source, entry, padC]; // reach the fitting pad just outside the wall, not just the wall midpoint (B62)
  return { id: uid(), kind: "utilRoute", util: opts.util, pts, corridor: bufferPolyline(pts, opts.width), pad: rectRing(padC, opts.padSize, opts.padSize), width: opts.width, fitting: opts.fitting, label: opts.label, stroke: opts.color };
}

/* --------------------------- parking math -------------------------- */
// Double-loaded modules (two stall rows + a drive aisle) filling a rectangle.
// Supports 90/60/45° stalls: angling narrows the row depth and the aisle the
// user sets, and spaces stalls farther apart along the row.
function carStalls(w, h, s) {
  const ang = [45, 60, 90].includes(+s.parkAngle) ? +s.parkAngle : 90;
  const rad = (ang * Math.PI) / 180, sinA = Math.sin(rad);
  const rowDepth = s.stallDepth * sinA;        // perpendicular depth of a stall row
  const pitch = s.stallW / sinA;               // spacing along the row
  const ai = s.aisle;
  const slantDx = ang === 90 ? 0 : rowDepth / Math.tan(rad); // lean across the depth
  const mod = rowDepth * 2 + ai;
  // Degenerate-config guard: a 0 stall-depth+aisle (mod) or 0 stall-width (pitch) makes
  // mods/perRow Infinity → an unbounded band loop that hard-freezes the tab. Bail to empty.
  if (!(mod > 0) || !(pitch > 0)) return { count: 0, bands: [], aisles: [], pitch: pitch > 0 ? pitch : 0, rowDepth, angle: ang };
  const perRow = Math.max(0, Math.floor((w - slantDx) / pitch));
  const mods = Math.max(0, Math.floor(h / mod));
  let count = 0;
  const bands = [], aisles = [];
  for (let i = 0; i < mods; i++) {
    const y = i * mod;
    bands.push({ y, depth: rowDepth, n: perRow, pitch, slantDx, dir: 1 });
    aisles.push({ y0: y + rowDepth, y1: y + rowDepth + ai });
    bands.push({ y: y + rowDepth + ai, depth: rowDepth, n: perRow, pitch, slantDx, dir: -1 });
    count += perRow * 2;
  }
  const used = mods * mod, left = h - used;
  if (left >= rowDepth && perRow > 0) {
    bands.push({ y: used, depth: rowDepth, n: perRow, pitch, slantDx, dir: 1 });
    count += perRow;
  }
  // flipDepth: mirror the layout across the strip's depth so the drive aisle
  // sits on the inner (y=0) edge — used for parking that hugs a building.
  if (s.flipDepth) {
    bands.forEach((b) => { b.y = h - b.y - b.depth; });
    aisles.forEach((a) => { const y0 = h - a.y1, y1 = h - a.y0; a.y0 = y0; a.y1 = y1; });
  }
  return { count, bands, aisles, pitch, rowDepth, angle: ang };
}
// Trailer storage as double-loaded rows (53′ deep) separated by a maneuvering
// drive lane (~60′) so tractors can back trailers in — not a solid pack.
function trailerStalls(w, h, s) {
  const tl = s.trailerL, tw = s.trailerW, ai = Math.max(0, s.trailerAisle || 0);
  const perRow = tw > 0 ? Math.max(0, Math.floor(w / tw)) : 0;
  // Single striped row (e.g. trailer parking flush against a wall): one band
  // filling the strip depth, columns every tw.
  if (s.single) {
    const bands = perRow > 0 ? [{ y: 0, depth: h, n: perRow }] : [];
    return { count: perRow, bands, aisles: [], cols: perRow, tw, tl };
  }
  const mod = tl * 2 + ai;
  // Same freeze guard as carStalls: 0 trailer-length + 0 aisle would loop forever.
  if (!(mod > 0)) return { count: 0, bands: [], aisles: [], cols: perRow, tw, tl };
  const mods = Math.max(0, Math.floor(h / mod));
  let count = 0;
  const bands = [], aisles = [];
  for (let i = 0; i < mods; i++) {
    const y = i * mod;
    bands.push({ y, depth: tl, n: perRow });
    aisles.push({ y0: y + tl, y1: y + tl + ai });
    bands.push({ y: y + tl + ai, depth: tl, n: perRow });
    count += perRow * 2;
  }
  const used = mods * mod, left = h - used;
  if (left >= tl && perRow > 0) {
    bands.push({ y: used, depth: tl, n: perRow });
    count += perRow;
  }
  return { count, bands, aisles, cols: perRow, tw, tl };
}
// Area-based stall estimates for irregular (polygon) fields — gross sf per stall
// including its share of drive aisle, with an efficiency factor for edge loss.
function estStalls(area, s) {
  const per = s.stallW * (s.stallDepth + s.aisle / 2) || 1;
  return Math.max(0, Math.floor((area * 0.8) / per));
}
function estTrailers(area, s) {
  const per = s.trailerW * (s.trailerL + (s.trailerAisle || 0) / 2) || 1;
  return Math.max(0, Math.floor((area * 0.8) / per));
}

/* --------------- parking row stepping (double-loading) ------------- */
// parkDepthForRows / parkRowsForDepth / splitParkingPieces are pure (unit-tested
// in test/parking.test.js) and imported from lib/parking.js. A drive aisle is
// double-loaded when it has a stall row on BOTH sides: depth(n) = n·stallDepth +
// ⌈n/2⌉·aisle (one aisle shared per pair of rows).

/* ------------------------- curbs (derived) ------------------------- */
// Curbs are auto-placed thin bands (not user geometry): a 6" mono curb is 0.5′ of
// plan-view width; a heavier 12" curb (trailer option) is 1.0′. One rule, three
// faces: ALWAYS drawn, ALWAYS in the area/yield math (width feeding it), NEVER in
// the displayed dimension (the label reads to the face of curb). The element's
// w/h stays the face-of-curb size, so the curb is derived on top — it floats to
// the terminal edge as rows are added/removed, with no stored geometry.
const CURB_6 = 0.5, CURB_12 = 1.0;
const CURB_TYPES = ["parking", "paving", "trailer"]; // roads carry their own curbs; no curb on a building side
const curbWidthOf = (el) => (el.curbW === CURB_12 ? CURB_12 : CURB_6);
const curbHost = (el, allEls) => (el.attachedTo ? (allEls || []).find((x) => x.id === el.attachedTo && !x.points) : null);
// Outward (terminal/back) edge in the element's LOCAL frame — the edge pointing
// away from a host building (so a curb never lands on the building side).
function outwardCurbEdge(el, allEls) {
  const host = curbHost(el, allEls);
  if (!host) return null;
  const loc = rot2(el.cx - host.cx, el.cy - host.cy, -el.rot); // host→el delta in local frame
  return Math.abs(loc.y) >= Math.abs(loc.x)
    ? { axis: "y", sign: loc.y >= 0 ? 1 : -1, length: el.w }
    : { axis: "x", sign: loc.x >= 0 ? 1 : -1, length: el.h };
}
// True when a sidewalk/landscape strip sits between this pad and its host, so the
// pad's inner edge is a sidewalk transition (curb) rather than a building face.
function sidewalkBetween(el, host, allEls) {
  if (!host) return false;
  const a = { x: el.cx - host.cx, y: el.cy - host.cy };
  return (allEls || []).some((s) => {
    if ((s.type !== "sidewalk" && s.type !== "landscape") || s.attachedTo !== host.id || s.id === el.id) return false;
    const b = { x: s.cx - host.cx, y: s.cy - host.cy };
    return (a.x * b.x + a.y * b.y) > 0 && (b.x * b.x + b.y * b.y) < (a.x * a.x + a.y * a.y); // same side, inboard
  });
}
// Curbed edges (LOCAL frame) — the single source feeding both the drawn band and
// the area math. B130 rule: a 6" curb wraps the WHOLE perimeter wherever pavement
// meets non-paving (dirt, landscape, a dead-end aisle), and is skipped wherever
// pavement meets pavement — a drive-aisle opening, continuous paving, or the
// internal seam between two abutting pads (e.g. split modules). The bare building
// face stays curb-free (B70) unless a sidewalk sits between (a transition curb).
function curbEdgesOf(el, allEls) {
  if (el.points || !CURB_TYPES.includes(el.type)) return [];
  const w = curbWidthOf(el), host = curbHost(el, allEls);
  const oe = host ? outwardCurbEdge(el, allEls) : null;             // edge AWAY from the host
  const swalk = host ? sidewalkBetween(el, host, allEls) : false;
  const edges = [];
  for (const c of [
    { axis: "y", sign: 1, length: el.w }, { axis: "y", sign: -1, length: el.w },
    { axis: "x", sign: 1, length: el.h }, { axis: "x", sign: -1, length: el.h },
  ]) {
    const hostSide = oe && c.axis === oe.axis && c.sign === -oe.sign;
    if (hostSide && !swalk) continue;                              // B70: bare building face → no curb
    if (edgeAbutsPaving(el, c.axis, c.sign, allEls)) continue;     // meets pavement (opening / seam) → no curb
    edges.push({ ...c, width: w });
  }
  return edges;
}
// Plan-view area of an element's curbs (counts in the SF / impervious math).
const curbAreaOf = (el, allEls) => (el.points ? 0 : curbEdgesOf(el, allEls).reduce((s, e) => s + e.length * e.width, 0));

/* ----------------------- geometry helpers -------------------------- */
// Parcel split geometry (straight + bent cuts) lives in lib/polygonSplit.js, imported above.
// Closest point on segment a-b to point p (used for snapping to a boundary).
function nearestPointOnSeg(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

/* ----------------------- polygon union (combine) ------------------- */
// Merge two adjacent simple polygons that share a boundary. Each shared edge
// appears in opposite directions in the two rings (consistent winding), so we
// cancel every edge that has a reverse twin in the other ring, then stitch the
// surviving edges back into one outer loop. Returns the merged ring or null
// (not adjacent / couldn't form a single loop).
function mergeRings(ringA, ringB, tol = 0.75) {
  const eq = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) <= tol;
  const edges = [];
  const add = (ring) => { for (let i = 0; i < ring.length; i++) edges.push({ a: ring[i], b: ring[(i + 1) % ring.length], dead: false }); };
  add(ringA); add(ringB);
  let shared = 0;
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].dead) continue;
    for (let j = 0; j < edges.length; j++) {
      if (j === i || edges[j].dead) continue;
      if (eq(edges[i].a, edges[j].b) && eq(edges[i].b, edges[j].a)) { edges[i].dead = edges[j].dead = true; shared++; break; }
    }
  }
  if (!shared) return null; // no common boundary → nothing to fuse
  const live = edges.filter((e) => !e.dead);
  if (live.length < 3) return null;
  const used = new Array(live.length).fill(false);
  const ring = [live[0].a, live[0].b]; used[0] = true;
  for (let guard = 0; guard < live.length + 2; guard++) {
    const end = ring[ring.length - 1];
    let f = -1;
    for (let k = 0; k < live.length; k++) { if (!used[k] && eq(live[k].a, end)) { f = k; break; } }
    if (f < 0) break;
    used[f] = true;
    ring.push(live[f].b);
  }
  if (ring.length > 1 && eq(ring[0], ring[ring.length - 1])) ring.pop();
  // drop coincident / collinear vertices left over from the cancelled edges
  const dedup = [];
  for (const p of ring) if (!dedup.length || !eq(dedup[dedup.length - 1], p)) dedup.push(p);
  if (dedup.length > 1 && eq(dedup[0], dedup[dedup.length - 1])) dedup.pop();
  const out = [];
  for (let i = 0; i < dedup.length; i++) {
    const a = dedup[(i - 1 + dedup.length) % dedup.length], b = dedup[i], c = dedup[(i + 1) % dedup.length];
    const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const baseLen = Math.hypot(c.x - a.x, c.y - a.y) || 1; // |cross|/base = perpendicular deviation in ft — scale-independent (B28)
    if (Math.abs(cross) / baseLen > 0.1) out.push(b); // keep a vertex only if it bends > ~0.1 ft off the a→c chord
  }
  const final = out.length >= 3 ? out : dedup;
  return final.length >= 3 ? final : null;
}

/* ------------------------------ format ----------------------------- */
const f0 = (n) => Math.round(n).toLocaleString();
const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* --------------- county appraisal-district attribute view --------------- */
// Curated, human-labelled rows pulled from the raw county GIS attributes that
// rode along with a map-imported parcel.
const APPR_FIELDS = [
  [/^(owner|own_?name|owner_?name|name|owner1)$/i, "Owner"],
  [/(situs|site_?addr|prop_?addr|loc_?addr|full_?addr|^addr|address)/i, "Situs address"],
  [/(hcad_?num|^acct|account|parcel_?id|prop_?id|geo_?id|quick_?ref|^pid)/i, "Account / ID"],
  [/(gis_?acre|calc_?acre|legal_?acre|^acre|acreage|deed_?acre)/i, "Acreage"],
  [/(land_?val|land_?mkt|land_?value)/i, "Land value"],
  [/(imp_?val|improvement_?val|bld_?val|impr_?val)/i, "Improvement value"],
  [/(tot_?val|market_?val|appr_?val|assessed_?val|total_?val|tot_?mkt)/i, "Total value"],
  [/(land_?use|state_?use|use_?cd|use_?desc|^class|prop_?type)/i, "Land use"],
  [/zoning/i, "Zoning"],
  [/(legal_?desc|^legal|subdiv|abstract|^abst)/i, "Legal"],
];
const prettyKey = (k) => k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const apprRows = (attrs) => {
  if (!attrs) return [];
  const used = new Set(), rows = [];
  for (const [re, label] of APPR_FIELDS) {
    const k = Object.keys(attrs).find((key) => !used.has(key) && re.test(key) && attrs[key] != null && attrs[key] !== "");
    if (k) { used.add(k); rows.push({ label, value: attrs[k] }); }
  }
  return rows;
};
const apprAll = (attrs) => Object.entries(attrs || {})
  .filter(([k, v]) => v != null && v !== "" && !/^(shape|objectid|globalid|geometry|st_area|st_length|shape_?area|shape_?len)/i.test(k))
  .map(([k, v]) => ({ label: prettyKey(k), value: v }));
// Format a value, adding $ + thousands for the money fields.
const apprVal = (label, v) => (/value/i.test(label) && v !== "" && !isNaN(+v)) ? `$${(+v).toLocaleString()}` : String(v);
const findAttr = (attrs, re) => { const k = Object.keys(attrs || {}).find((key) => re.test(key) && attrs[key] != null && attrs[key] !== ""); return k ? String(attrs[k]) : null; };
// County stated acreage from the attributes. Prefer an explicit acres field;
// fall back to Shape_Area (EPSG:2278 → US survey ft² → ÷43560). Returns
// { acres, source } or null. Caller flags a ~10× gap (likely m²) rather than
// silently "fixing" it.
const countyAcres = (attrs) => {
  if (!attrs) return null;
  const keys = Object.keys(attrs);
  const num = (k) => +attrs[k];
  const ok = (k) => k && attrs[k] != null && attrs[k] !== "" && !isNaN(num(k)) && num(k) > 0;
  // 1) An explicit, already-in-acres field.
  const acresKey = keys.find((k) => /(gis_?acres|legal_?acres|deed_?acres|calc_?acres|acreage|^acres$)/i.test(k) && ok(k));
  if (acresKey) return { acres: num(acresKey), source: acresKey };
  // 2) TxGIO statewide (the Chambers source) publishes GIS_AREA / LEGAL_AREA already in acres,
  //    with a sibling *_UNIT field naming the unit — prefer these over the projected Shape area
  //    so we don't misread square-metres as square-feet (the old regex matched neither, then
  //    divided a m² value by 43560 → ~10.76× too small, flagging every correct lot as wrong).
  const unitOf = (areaK) => { const want = (areaK + "_unit").toLowerCase(); const uk = keys.find((k) => k.toLowerCase() === want); return uk ? String(attrs[uk]) : ""; };
  const areaAcresKey = keys.find((k) => /(gis_?area|legal_?area)$/i.test(k) && ok(k) && /acre/i.test(unitOf(k)));
  if (areaAcresKey) return { acres: num(areaAcresKey), source: areaAcresKey };
  // 3) Last resort: a projected Shape area. Assume EPSG:2278 US-ft² (÷43560); the caller flags a
  //    ~10.76× gap as a likely square-metre projection rather than silently trusting it.
  const areaKey = keys.find((k) => /(shape_?area|shape\.starea|st_area)/i.test(k) && ok(k));
  if (areaKey) return { acres: num(areaKey) / 43560, source: areaKey, fromArea: true };
  return null;
};

let _id = 1;
const uid = () => `e${_id++}`;
// After restoring saved work, bump the id counter past any restored ids so new
// elements don't collide with old ones (which would break keys/selection).
const ensureIdAbove = (ids) => {
  (ids || []).forEach((id) => {
    const n = parseInt(String(id).replace(/\D/g, ""), 10);
    if (!isNaN(n) && n >= _id) _id = n + 1;
  });
};

// Snap is a global drafting preference (a tool mode), NOT a per-site attribute —
// default OFF so elements move freely; the choice persists across sites/reloads once
// turned on. We still mirror it into `settings.snap` so every read site is unchanged,
// but the per-site saved value is ignored on load/import in favour of this pref.
const SNAP_PREF_KEY = "planarfit:snap";
const loadSnapPref = () => { try { return localStorage.getItem(SNAP_PREF_KEY) === "1"; } catch { return false; } };
const saveSnapPref = (on) => { try { localStorage.setItem(SNAP_PREF_KEY, on ? "1" : "0"); } catch (_) {} };

const DEFAULT_SETTINGS = {
  gridSize: 10, snap: false,
  setback: 25, showSetback: true,
  stallW: 9, stallDepth: 18, aisle: 24, parkAngle: 90,
  trailerW: 12, trailerL: 53, trailerAisle: 60,
  roadCurb: 0.5, roadWidths: "24, 26, 30, 36, 40",
  showDocks: true,
  typeStyles: {}, // user-set default colors per element type (Bluebeam-style defaults)
};

export default function SitePlanner({ active = true, siteId = null, overlays, setOverlays, cloud = null, layerStatus = {}, setLayerStatus, onBackToMap, sites = [], onOpenSite, onNewSite, onNewPlanSameParcel, onDuplicateSite, onRenameSite, onRenamePlan, onSiteDropped, onSiteSaved, shellModule, onShellSwitch, authControl } = {}) {
  // Restore this site's saved canvas (and advance the id counter past saved ids).
  // Keyed remount in App means this runs once per site.
  const restored = useMemo(() => {
    const s = loadSite(siteId);
    if (s) ensureIdAbove([...(s.parcels || []).map((p) => p.id), ...(s.els || []).map((e) => e.id)]);
    return s;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [parcels, setParcels] = useState(() => restored?.parcels || []);    // {id, points:[{x,y}]}
  const [els, setEls] = useState(() => restored?.els || []);                // {id,type,cx,cy,w,h,rot}
  const [measures, setMeasures] = useState(() => restored?.measures || []); // {a,b}
  const [callouts, setCallouts] = useState(() => restored?.callouts || []);  // {id, tip:{x,y}, box:{x,y}, text}
  const [markups, setMarkups] = useState(() => restored?.markups || []);   // neutral shapes: line/polyline/rect/ellipse/polygon
  const [combineSel, setCombineSel] = useState([]);   // parcel ids picked for the Combine tool
  const [calloutDraft, setCalloutDraft] = useState(null); // {tip:{x,y}} while placing a callout
  const [editCallout, setEditCallout] = useState(null);   // {id, text, isNew} while typing a callout inline
  const [numEdit, setNumEdit] = useState(null);           // {fx,fy (feet), value, onCommit} — inline numeric edit, NEVER a dialog box
  const [mkRect, setMkRect] = useState(null);   // {kind, a:{x,y}, b:{x,y}} drag-draw a markup rect/ellipse/line
  const [mkPoly, setMkPoly] = useState(null);   // {kind, pts:[{x,y}]} click-draw a markup polygon/polyline
  const [mkStyle, setMkStyle] = useState(MK_DEFAULT); // current markup style (sticky)
  const [tool, setTool] = useState("select");
  const [toolMenu, setToolMenu] = useState(false); // Parcel ▾ dropdown open
  const [parkingMenu, setParkingMenu] = useState(false); // Parking ▾ row-preset dropdown open
  const [buildingMenu, setBuildingMenu] = useState(false); // Building ▾ dock-layout dropdown open
  const [buildingDock, setBuildingDock] = useState("single"); // dock layout for newly drawn buildings
  const [roadMenu, setRoadMenu] = useState(false);       // Road ▾ width-preset dropdown open
  const [exportMenu, setExportMenu] = useState(false);   // Export ▾ dropdown open
  const [printMode, setPrintMode] = useState(false);     // print-frame placement mode
  const [printFrame, setPrintFrame] = useState(null);    // {cx, cy, wFt, hFt} feet — the crop to print
  const [printPaper, setPrintPaper] = useState("letter");   // "letter" | "tabloid"
  const [printOrient, setPrintOrient] = useState("landscape"); // "landscape" | "portrait"
  const [printOverlay, setPrintOverlay] = useState(true);   // include placed site-plan overlays in print/export (B131); re-defaulted to on-screen visibility on entering print mode
  const [siteMenu, setSiteMenu] = useState(false);       // header Site ▾ dropdown open
  const [planMenu, setPlanMenu] = useState(false);       // header Plan ▾ dropdown open
  // anchor refs for the portal-rendered dropdowns (B127) — each points at the menu's
  // trigger so AnchoredMenu can position the flyout against it (see AnchoredMenu.jsx).
  const boundaryAnchor = useRef(null), buildingAnchor = useRef(null), parkingAnchor = useRef(null),
    roadAnchor = useRef(null), measureAnchor = useRef(null), easeAnchor = useRef(null), easeTypeAnchor = useRef(null),
    siteAnchor = useRef(null), planAnchor = useRef(null), exportAnchor = useRef(null);
  const [versionsOpen, setVersionsOpen] = useState(false); // version-history (automatic backups) dialog
  const [versionList, setVersionList] = useState([]);    // [{at, buildings, sig}] snapshots for this plan
  const [leftPanel, setLeftPanel] = useState(null);      // which left-rail menu is open: props|parcel|yield|aerial|standards|null
  const [leftWidth, setLeftWidth] = useState(() => { try { return Math.max(240, Math.min(620, +localStorage.getItem("planarfit:leftWidth") || 320)); } catch (_) { return 320; } });
  // B113: phone-width responsive mode. Below ~760px the fixed side rails would crush
  // the canvas to a sliver, so they OVERLAY it instead of consuming row width, and the
  // right tool palette collapses behind a toggle. matchMedia keeps it in sync with
  // rotate/resize. The desktop layout is untouched (every mobile style is `narrow ?`-gated).
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia("(max-width: 760px)").matches; } catch (_) { return false; } });
  const [mobileTools, setMobileTools] = useState(false); // right tool rail open as an overlay (narrow only)
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(max-width: 760px)"); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  const lsGet = (k, d) => { try { return localStorage.getItem("planarfit:" + k) || d; } catch (_) { return d; } };
  const [parkingRows, setParkingRows] = useState(() => lsGet("parkingRows", "free")); // drawn-parking depth preset
  const [roadWidth, setRoadWidth] = useState(() => lsGet("roadWidth", "free"));    // drawn-road width preset
  // Easement tool (NEW-1/2/3): a first-class easement object on the editable layer.
  // `easeMode` is the input mode; easeType/easeWidth are sticky tool defaults.
  const [easeMode, setEaseMode] = useState(() => lsGet("easeMode", "centerline")); // centerline | boundary | parceledge
  const [easeType, setEaseType] = useState(() => lsGet("easeType", "utility"));
  const [easeWidth, setEaseWidth] = useState(() => Math.max(1, +lsGet("easeWidth", "10") || 10));
  const [easeDraft, setEaseDraft] = useState(null); // {pts:[{x,y}]} centerline/boundary click-draw in progress
  const [easeEdges, setEaseEdges] = useState(null); // {parcelId, idx:[edge#]} parcel-edge run in progress (NEW-3)
  const [easeMenu, setEaseMenu] = useState(false);        // Easement ▾ rail menu open
  const [easeTypeMenu, setEaseTypeMenu] = useState(false); // attributes-panel type popover open
  const [attachFor, setAttachFor] = useState(null);     // element id awaiting a "click a host" to attach to
  const [alignFor, setAlignFor] = useState(null);       // element id awaiting a "click a target" to align rotation to
  const [attachHint, setAttachHint] = useState(null);   // {x,y} feet — green "+" while a drag is about to bond
  const [panning, setPanning] = useState(false);   // dragging empty canvas to pan
  const spaceRef = useRef(false);                  // Space held → temporary hand-pan over any tool (D4)
  const [spacePan, setSpacePan] = useState(false); // reflects spaceRef for the grab cursor
  const [sel, setSel] = useState(null);         // {kind:'el'|'parcel', id}
  const [multi, setMulti] = useState([]);       // multi-select: array of {kind:'el'|'markup', id}
  // Live mirrors of the selection. The window keydown listener is re-bound by a passive
  // effect, so right after a selecting click it can briefly still hold the PREVIOUS
  // render's `sel`/`multi` closure — which made Delete need a second press (NEW-1). The
  // Delete path reads these refs instead, so it always sees the current selection.
  // Synced during render (idempotent; a passive effect would lag the same window).
  const selRef = useRef(sel); selRef.current = sel;
  const multiRef = useRef(multi); multiRef.current = multi;
  const [marquee, setMarquee] = useState(null); // {a:{x,y}, b:{x,y}} feet, while rubber-banding
  const inMulti = (kind, id) => multi.some((m) => m.kind === kind && m.id === id);
  // snap comes from the global pref (a tool mode), never the per-site saved value.
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...(restored?.settings || {}), snap: loadSnapPref() }));
  const setSnap = useCallback((on) => { saveSnapPref(on); setSettings((s) => ({ ...s, snap: on })); }, []);

  const [view, setView] = useState({ ppf: 0.35, offX: 60, offY: 60 });
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [cursor, setCursor] = useState(null);   // {x,y} feet

  // parcel drafting + draw drafting + measure
  const [draftPoly, setDraftPoly] = useState(null);  // array of feet pts
  const [draftRect, setDraftRect] = useState(null);  // {type, x,y,w,h} feet
  const [draftElPoly, setDraftElPoly] = useState(null); // {type, pts:[{x,y}]} polygon element being drawn
  const [roadStart, setRoadStart] = useState(null);  // first click of a fixed-width road centerline
  const [draftRoad, setDraftRoad] = useState(null);  // {ax,ay,bx,by,cross} live road preview
  const [measDraft, setMeasDraft] = useState([]);    // in-progress measure vertices
  const [measureMode, setMeasureMode] = useState(() => lsGet("measureMode", "line"));
  const [measureMenu, setMeasureMenu] = useState(false);  // Measure ▾ dropdown open
  const [splitPath, setSplitPath] = useState([]);    // vertices of a split cut polyline

  // aerial underlay + scale calibration
  const [underlay, setUnderlay] = useState(() => restored?.underlay || null);    // {src,imgW,imgH,x,y,ftPerPx,opacity,locked}
  const [showAerial, setShowAerial] = useState(true);   // aerial underlay shows whenever one exists
  const [underlayErr, setUnderlayErr] = useState(false);
  const [underlayLoading, setUnderlayLoading] = useState(() => {
    const u = restored?.underlay;
    return !!(u && u.src && !String(u.src).startsWith("data:")); // show spinner until the remote aerial loads
  });
  const [calib, setCalib] = useState(null);          // {a:{x,y}, b?:{x,y}}
  const [calibInput, setCalibInput] = useState("");
  const fileRef = useRef(null);

  // Site-plan overlays (B72): backdrop PDFs/images the user drops onto the map and
  // places by hand (immutable backdrop — above the basemap, below markup/massing).
  // Distinct from the GIS map `overlays` (app-shared layer props, declared below).
  const [sheetOverlays, setSheetOverlays] = useState(() => restored?.sheetOverlays || []);
  const [selOverlay, setSelOverlay] = useState(null);   // id of the overlay shown in the panel
  const [overlayBusy, setOverlayBusy] = useState(false);
  // Parcel-attached drawings (B67): immutable backdrop + pixel-relative markup, per parcel.
  const [parcelDrawings, setParcelDrawings] = useState(() => restored?.parcelDrawings || []);
  const [openDrawingId, setOpenDrawingId] = useState(null);   // the drawing shown in the markup modal
  const [drawingTargetParcel, setDrawingTargetParcel] = useState(null); // parcel the file-picker is filing onto
  const [pagePick, setPagePick] = useState(null); // multi-page PDF awaiting a sheet choice (B67 increment 2)
  const [rehydratingId, setRehydratingId] = useState(null); // drawing whose backdrop is being re-fetched from Storage
  const drawingFileRef = useRef(null);
  const drawingPushTimer = useRef(null);
  const parcelDrawingsRef = useRef(parcelDrawings);
  useEffect(() => { parcelDrawingsRef.current = parcelDrawings; }, [parcelDrawings]);
  // Persist parcelDrawings via a saveSite MERGE (preserves the live parcels/els the
  // autosave owns), then debounce the cloud push. Keeps this collection off the main
  // autosave path so it needs no new wiring through every flush/snapshot site.
  const persistDrawings = (next) => {
    setParcelDrawings(next);
    if (siteId) saveSite({ id: siteId, parcelDrawings: next });
    clearTimeout(drawingPushTimer.current);
    drawingPushTimer.current = setTimeout(() => { if (isCloudActive() && siteId) pushSiteToCloud(siteId).catch(() => {}); }, 800);
  };
  // Back a freshly-attached drawing with its source file in Storage (B67 increment 2b), so
  // its backdrop rebuilds on another device. Background + fallback-safe: logged-out / oversize
  // / error just keeps the local raster (storageKey stays unset → "re-attach on load").
  const uploadDrawingSource = async (recId, file) => {
    if (!file) return;
    const res = await uploadParcelDrawingFile(siteId, recId, file).catch(() => null);
    if (!res) return;
    persistDrawings(parcelDrawingsRef.current.map((d) => (d.id === recId ? { ...d, storageKey: res.key, ext: res.ext } : d)));
  };
  // Build + persist + open a drawing record from a rasterized page/image; back it with the source.
  const addDrawingFromRaster = (parcelId, name, kind, raster, pageCount, file) => {
    const rec = { id: "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), parcelId,
      name, kind, page: raster.page || 1, pageCount: pageCount || 1,
      intrinsic: { w: raster.imgW, h: raster.imgH }, src: raster.src,
      markups: [], createdAt: Date.now(), updatedAt: Date.now() };
    persistDrawings([...parcelDrawings, rec]);
    setOpenDrawingId(rec.id);
    if (file) uploadDrawingSource(rec.id, file);
    return rec;
  };
  const onAttachDrawing = async (parcelId, file) => {
    if (!file || !parcelId) return;
    if (!(isPdfFile(file) || /^image\//.test(file.type))) { flashWarn("Attach a PDF or an image (PNG/JPG).", 0); return; }
    const baseName = (file.name || "Drawing").replace(/\.[^.]+$/, "");
    try {
      const r = await openOverlayFile(file); // { src, imgW, imgH, page, pageCount, pdf } — reuses the B72 rasterizer
      // Multi-page PDF → let the user pick the sheet (keep the PDF + File alive to re-rasterize + upload).
      if (r.pdf && r.pageCount > 1) { setPagePick({ parcelId, pdf: r.pdf, pageCount: r.pageCount, name: baseName, first: r, file }); return; }
      if (r.pdf) { try { r.pdf.destroy(); } catch (_) {} } // single page — first raster is all we need
      addDrawingFromRaster(parcelId, baseName, isPdfFile(file) ? "pdf" : "image", r, r.pageCount || 1, file);
    } catch (_) { flashWarn("Couldn't read that file — try another PDF or image.", 0); }
  };
  // Page-picker: rasterize the chosen sheet of a multi-page PDF, then attach it (B67 increment 2a).
  const pickPage = async (n) => {
    const pp = pagePick; if (!pp) return;
    setPagePick(null);
    try {
      const raster = pp.first && pp.first.page === n ? pp.first : await rasterizePage(pp.pdf, n);
      addDrawingFromRaster(pp.parcelId, `${pp.name} — p.${n}`, "pdf", raster, pp.pageCount, pp.file);
    } catch (_) { flashWarn("Couldn't render that page — try another.", 0); }
    finally { try { pp.pdf.destroy(); } catch (_) {} }
  };
  const cancelPagePick = () => { if (pagePick) { try { pagePick.pdf.destroy(); } catch (_) {} setPagePick(null); } };
  // Rehydrate a drawing's backdrop from Storage when it was opened without a local raster
  // (cross-device: the cloud row's src was stripped, but storageKey + the source survive).
  useEffect(() => {
    if (!openDrawingId) return;
    const d = parcelDrawingsRef.current.find((x) => x.id === openDrawingId);
    if (!d || d.src || !d.storageKey) return;
    let live = true;
    setRehydratingId(d.id);
    (async () => {
      let src = null;
      try {
        if (d.kind === "pdf") { const bytes = await downloadOverlayBytes(d.storageKey); if (bytes) { const rr = await rasterizeStoredPdf(bytes, d.page || 1); src = rr && rr.src; } }
        else { src = await downloadOverlayDataUrl(d.storageKey); }
      } catch (_) { /* keep the placeholder */ }
      if (live) { if (src) setParcelDrawings((cur) => cur.map((x) => (x.id === d.id ? { ...x, src } : x))); setRehydratingId(null); }
    })();
    return () => { live = false; };
  }, [openDrawingId]); // eslint-disable-line react-hooks/exhaustive-deps
  const updateDrawingMarks = (id, markups) =>
    persistDrawings(parcelDrawings.map((d) => (d.id === id ? { ...d, markups, updatedAt: Date.now() } : d)));
  const deleteDrawing = (id) => {
    const gone = parcelDrawings.find((d) => d.id === id);
    if (gone && gone.storageKey) deleteOverlayObject(gone.storageKey); // best-effort cloud cleanup (B67 2b)
    persistDrawings(parcelDrawings.filter((d) => d.id !== id));
    if (openDrawingId === id) setOpenDrawingId(null);
  };
  const overlayFileRef = useRef(null);
  const overlayDocs = useRef(new Map());                // id -> live PDFDocumentProxy (session-only, for the page picker)
  const overlayFetching = useRef(new Set());            // ids currently downloading their raster from Storage (B72)
  const [ovCalib, setOvCalib] = useState(null);         // {id, kind:'trace'|'align', pts:[]} — canvas calibration in progress

  // county parcel lookup
  const [county, setCounty] = useState("harris");
  const [lookupUrl, setLookupUrl] = useState(COUNTIES.harris.layerUrl || COUNTIES.harris.serviceUrl);
  const [searchMode, setSearchMode] = useState("address"); // "address" | "id"
  const [searchVal, setSearchVal] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState("");
  const [lookupRes, setLookupRes] = useState([]);    // [{ft, layerUrl, idField, addrField}]

  // rectangular parcel quick-add inputs
  const [lotW, setLotW] = useState(600);
  const [lotD, setLotD] = useState(800);

  const [typeMenu, setTypeMenu] = useState(null); // {id, x, y} screen coords for change-type popup
  const [parcelMenu, setParcelMenu] = useState(null); // {x,y} right-click parcel menu (merge)
  const [showShortcuts, setShowShortcuts] = useState(false); // ? keyboard overlay

  // Title reader + metes-and-bounds plotter (Schedule B → checklist; legal
  // description → drawn encumbrance). All in one modal.
  const [titleOpen, setTitleOpen] = useState(false);
  const [apiKey, setApiKey] = useState(() => getKey());
  const [titleBusy, setTitleBusy] = useState(false);
  const [titleErr, setTitleErr] = useState("");
  const [titleDoc, setTitleDoc] = useState(null);   // { legalDescription, exceptions:[...] }
  const [excChecked, setExcChecked] = useState({});  // exception index → ticked
  const [mbText, setMbText] = useState("");          // legal description to plot
  const [mbWidth, setMbWidth] = useState(20);        // corridor width (ft) for open traverses
  const [pobMode, setPobMode] = useState(null);      // { calls } awaiting a POB click on the canvas
  const [overlapWarn, setOverlapWarn] = useState(""); // transient warning after a plot
  // Single-owner warning toast (B56b): every non-empty warning goes through flashWarn,
  // which cancels any pending auto-clear first — so a stale timer from an earlier message
  // can never blank a newer one. ms<=0 = sticky (no auto-clear; still cancels a prior timer).
  // Bare setOverlapWarn("") clears can stay: a later flashWarn cancels any lingering timer.
  const warnTimerRef = useRef(null);
  const flashWarn = useCallback((msg, ms = 6000) => {
    if (warnTimerRef.current) { clearTimeout(warnTimerRef.current); warnTimerRef.current = null; }
    setOverlapWarn(msg);
    if (msg && ms > 0) warnTimerRef.current = setTimeout(() => { warnTimerRef.current = null; setOverlapWarn(""); }, ms);
  }, []);
  useEffect(() => () => { if (warnTimerRef.current) clearTimeout(warnTimerRef.current); }, []);
  const xsecBusyRef = useRef(false); // in-flight guard for the async ditch cross-section (B56b)
  const titlePdfRef = useRef(null);

  // Geographic basemap + shared overlay layers under the canvas (Phase 1). Only
  // meaningful for a located site (one with a real-world origin).
  const origin = restored?.origin || null;
  // overlays / setOverlays are app-shared (props from App) — one source of truth across pages.
  const [basemapOn, setBasemapOn] = useState(!!origin);
  const [layersOpen, setLayersOpen] = useState(false); // planner Layers control expanded
  const geoWrapRef = useRef(null);
  const geoMapRef = useRef(null);
  const geoBaseRef = useRef(null);
  const overlayRefs = useRef({});
  const geoCommitRef = useRef(null);   // last view actually setView'd: {center, zoom, w, h}
  const geoCommitTimer = useRef(null); // debounce handle for the crisp re-render
  // Utility-evidence drawing: manual power-line trace + inferred water main.
  const [traceMode, setTraceMode] = useState(false);
  const [tracePts, setTracePts] = useState([]);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [routeMode, setRouteMode] = useState(null); // utility routing: {util, snapTo, stage, source, width, ruleNote}
  const [easeRules, setEaseRules] = useState(loadEasementRules);
  const [jurKey, setJurKey] = useState(() => defaultJurForCounty(restored?.county || "harris"));
  const [rulesOpen, setRulesOpen] = useState(false);
  const [xsecMode, setXsecMode] = useState(false);   // ditch cross-section: click two points
  const [xsecPts, setXsecPts] = useState([]);
  const [xsec, setXsec] = useState(null);            // { p0, p1, lenFt, busy, stats } result

  /* Create the (non-interactive) Leaflet basemap once for a located site. The
     SVG above owns all interaction; this map is a pure backdrop, driven by the
     planner view. */
  useEffect(() => {
    if (!origin || geoMapRef.current || !geoWrapRef.current) return;
    const map = L.map(geoWrapRef.current, {
      zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false,
      doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, tap: false,
      zoomSnap: 0, fadeAnimation: false, zoomAnimation: false, inertia: false,
    }).setView([origin.lat, origin.lon], 17);
    geoMapRef.current = map;
    geoCommitRef.current = null; // fresh map → no committed view yet (forces a snap on first sync)
    return () => { try { map.remove(); } catch (_) {} geoMapRef.current = null; geoBaseRef.current = null; overlayRefs.current = {}; geoCommitRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin]);

  /* aerial basemap tile layer (toggle) */
  useEffect(() => {
    const map = geoMapRef.current;
    if (!map) return;
    if (basemapOn && !geoBaseRef.current) {
      const t = withTileRetry(L.tileLayer(GEO_BASEMAP.tiles, { maxNativeZoom: GEO_BASEMAP.maxNative, maxZoom: 24, attribution: GEO_BASEMAP.attr, keepBuffer: 4 }));
      t.setZIndex(1); t.addTo(map); geoBaseRef.current = t;
    } else if (!basemapOn && geoBaseRef.current) {
      try { map.removeLayer(geoBaseRef.current); } catch (_) {}
      geoBaseRef.current = null;
    }
  }, [basemapOn, origin]);

  /* keep the basemap sized when the canvas resizes or the planner is shown */
  useEffect(() => {
    const map = geoMapRef.current;
    if (map && active) { const t = setTimeout(() => { try { map.invalidateSize(false); } catch (_) {} }, 60); return () => clearTimeout(t); }
  }, [active, size, origin]);

  /* drive the basemap zoom/center from the planner view so it stays locked to
     the SVG. ppf→zoom keeps the scale identical; the canvas-center feet point
     projects to the map center.

     Anti-flash (B65): a real `map.setView` fires Leaflet's `viewreset`, whose
     GridLayer handler wipes & reloads ALL tiles — so calling it on every wheel
     step blanks the aerial for a frame each time (the white/dim flash). Instead
     we hold Leaflet at a committed view and, for the small zoom/pan deltas of a
     live gesture, just CSS-`transform` the whole map container (tiles AND the
     shared overlay layers together, so they stay mutually aligned) to track the
     gesture with the pixels already on screen — no reload, no flash. A debounced
     `setView` then re-renders crisp once the gesture settles. Big jumps (fit/
     resize/first paint, or >1.5 zoom levels of accumulated scroll) commit
     immediately so we never scale the aerial into a blurry mess. */
  useEffect(() => {
    const map = geoMapRef.current;
    const wrap = geoWrapRef.current;
    if (!map || !wrap || !origin) return;
    const fx = (size.w / 2 - view.offX) / view.ppf;
    const fy = (size.h / 2 - view.offY) / view.ppf;
    const center = feetToLatLng({ x: fx, y: fy }, origin.lat, origin.lon);
    const z = ppfToZoom(view.ppf, center[0]); // scale at the panned-to latitude

    const commit = (c, zoom) => {
      wrap.style.transform = "";
      try { map.setView(c, zoom, { animate: false }); } catch (_) {}
      geoCommitRef.current = { center: c, zoom, w: size.w, h: size.h };
    };

    const prev = geoCommitRef.current;
    const sizeChanged = !prev || prev.w !== size.w || prev.h !== size.h;
    // First paint, a resize, or a large jump → snap (one reload) rather than scale.
    if (sizeChanged || Math.abs(z - prev.zoom) > 1.5) {
      clearTimeout(geoCommitTimer.current);
      commit(center, z);
      return;
    }

    // Small delta → keep the committed tiles, just transform them to match.
    try {
      const scale = map.getZoomScale(z, prev.zoom);                 // 2^(z - prev.zoom)
      const p = map.latLngToContainerPoint(L.latLng(center));        // where `center` sits now
      const half = map.getSize().divideBy(2);
      const tx = half.x - p.x * scale;
      const ty = half.y - p.y * scale;
      wrap.style.transformOrigin = "0 0";
      wrap.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${scale})`;
    } catch (_) { commit(center, z); return; }

    // …then re-base to a crisp render shortly after the gesture stops.
    clearTimeout(geoCommitTimer.current);
    geoCommitTimer.current = setTimeout(() => commit(center, z), 180);
  }, [view, size, origin]);

  useEffect(() => () => clearTimeout(geoCommitTimer.current), []);

  /* shared overlay layers (same source as the map finder) */
  useEffect(() => {
    if (!origin) return;
    const sync = () => syncOverlayLayers(geoMapRef.current, overlays, overlayRefs.current, {
      onStatus: (id, state, msg, extra) => setLayerStatus && setLayerStatus((s) => ({ ...s, [id]: state ? { state, msg, ts: extra?.ts ?? null, stale: extra?.stale ?? false } : null })),
      onError: (cfg, msg) => { flashWarn(`⚠ “${cfg.label}” layer failed: ${msg || "service may be down or moved"}.`, 6000); },
    });
    sync();
    const iv = setInterval(sync, 45000); // re-probe so stopped services self-heal
    return () => clearInterval(iv);
  }, [overlays, origin, basemapOn]); // eslint-disable-line

  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const drag = useRef(null);
  const altSnapOffRef = useRef(false); // Alt held during a drag/placement → bypass snap for this one move (re-armed every pointer event)
  const clip = useRef(null); // copied element (for Ctrl+C / X / V)

  // Undo/redo history (snapshots of the editable state, stored by reference).
  const stateRef = useRef({ parcels: [], els: [], measures: [], callouts: [], markups: [], underlay: null, sheetOverlays: [] });
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  useEffect(() => { stateRef.current = { parcels, els, measures, callouts, markups, underlay, sheetOverlays }; });
  // A site with no parcels / elements / measures / callouts / aerial is "blank".
  // We don't want unedited blank sites cluttering the list, so we never persist
  // them, and drop their record on leave (but only un-located blank-planner
  // sites — a map-sourced site keeps its record even if you clear it).
  const isBlankSite = (s) => !(s?.parcels?.length) && !(s?.els?.length) && !(s?.measures?.length) && !(s?.callouts?.length) && !(s?.markups?.length) && !s?.underlay && !(s?.sheetOverlays?.length);
  // Site/plan metadata (name etc.) lives in component state declared below; mirror
  // it into a ref so the (earlier-defined) save effects can include it without a
  // forward reference. The first real save then writes a fully-formed record —
  // there's no need to pre-create an empty one.
  const metaRef = useRef({});
  // "saving" | "saved" | "unsaved". Initialize honestly: a brand-new site that
  // isn't in storage yet is "unsaved", an opened existing site is "saved".
  const [saveStatus, setSaveStatus] = useState(() => (loadSite(siteId) ? "saved" : "unsaved"));
  // True ONLY when a cloud write actually failed while signed in (not the normal logged-out
  // device save, and not a blank new site) — drives a loud, dismissible banner so a failed
  // cloud save is never silent again (B125). Cleared on the next successful save.
  const [cloudSaveFailed, setCloudSaveFailed] = useState(false);
  // Autosave this site (debounced). Persists on the FIRST real edit (so a 1-element
  // new site is written, not lost), and never persists a still-blank site.
  const firstSave = useRef(true);
  useEffect(() => {
    if (!siteId) return;
    // Skip only the initial mount (whatever the state) — must run BEFORE the blank
    // check, or a fresh blank site keeps the flag and swallows its first real edit.
    if (firstSave.current) { firstSave.current = false; return; }
    if (isBlankSite({ parcels, els, measures, callouts, markups, underlay, sheetOverlays })) return; // don't save a still-blank site
    setSaveStatus("saving");
    const fresh = !loadSite(siteId); // first save of a brand-new site → tell App to list it
    const t = setTimeout(() => {
      const ok = saveSite({ id: siteId, ...metaRef.current, parcels, els, measures, callouts, markups, settings, underlay, sheetOverlays });
      if (!ok) { setSaveStatus("unsaved"); return; }
      if (fresh) onSiteSaved?.();
      // Badge tracks the REAL write: local write done; when logged in, stay
      // "saving" until the cloud upsert resolves, then "saved" only if it succeeded.
      if (isCloudActive()) pushSiteToCloud(siteId).then((c) => { setSaveStatus(c.ok ? "saved" : "unsaved"); setCloudSaveFailed(!c.ok); }).catch(() => { setSaveStatus("unsaved"); setCloudSaveFailed(true); });
      else { setSaveStatus("saved"); setCloudSaveFailed(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [siteId, parcels, els, measures, callouts, markups, settings, underlay, sheetOverlays]);
  // Manual "Retry now" for the loud cloud-save-failure banner (B125).
  const retryCloudSave = () => {
    if (!siteId) return;
    setSaveStatus("saving");
    pushSiteToCloud(siteId).then((c) => { setSaveStatus(c.ok ? "saved" : "unsaved"); setCloudSaveFailed(!c.ok); }).catch(() => { setSaveStatus("unsaved"); setCloudSaveFailed(true); });
  };
  // Persist on leave; if the site is still blank and un-located, drop it instead.
  const liveRef = useRef({});
  useEffect(() => { liveRef.current = { parcels, els, measures, callouts, markups, settings, underlay, sheetOverlays }; });
  const persistOrDrop = () => {
    if (!siteId) return;
    const s = liveRef.current;
    if (isBlankSite(s) && !loadSite(siteId)?.origin) { deleteSite(siteId); onSiteDropped?.(siteId); }
    else saveSite({ id: siteId, ...metaRef.current, ...s });
  };
  useEffect(() => {
    if (active || !siteId) return;
    persistOrDrop();
  }, [active]); // eslint-disable-line
  useEffect(() => () => { persistOrDrop(); }, []); // eslint-disable-line
  // Synchronously flush an in-flight (debounced) edit if the tab is hidden or the
  // page is closing/navigating, so a change made just before leaving isn't lost.
  useEffect(() => {
    if (!siteId) return;
    const flush = () => { const s = liveRef.current; if (!isBlankSite(s)) saveSite({ id: siteId, ...metaRef.current, ...s }); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("beforeunload", flush); document.removeEventListener("visibilitychange", onVis); };
  }, [siteId]); // eslint-disable-line
  // B127 — cross-tab live convergence. busyRef tracks whether we're mid-interaction so a
  // background storage event never yanks the canvas out from under an active edit.
  const busyRef = useRef(false);
  useEffect(() => { busyRef.current = !!(drag.current || mkRect || mkPoly || draftRect || editCallout || calloutDraft || numEdit); });
  // When ANOTHER tab saves this site, fold its content into our canvas (union — never drops
  // either tab's work) so two open tabs agree without a reload. Idle-only + only-if-changed
  // (avoids churn / ping-pong). `storage` events fire only in OTHER tabs, never the writer.
  useEffect(() => {
    if (!siteId) return undefined;
    const onStore = (e) => {
      if (e && e.key && !e.key.startsWith("planarfit:sites:")) return;
      if (busyRef.current) return;
      const stored = loadSite(siteId);
      if (!stored) return;
      const live = liveRef.current || {};
      const liveModel = createSiteModel({ id: siteId, ...metaRef.current, ...live, updatedAt: Date.now() });
      const merged = mergeSiteContent(liveModel, stored); // our (newest) scalars + union of content
      const sig = (m) => [m.parcels, m.els, m.measures, m.callouts, m.markups, m.sheetOverlays].map((a) => (a && a.length) || 0).join("/");
      if (sig(merged) === sig(liveModel)) return; // the other tab added nothing new → leave our canvas alone
      setParcels(merged.parcels); setEls(merged.els); setMeasures(merged.measures);
      setCallouts(merged.callouts); setMarkups(merged.markups); setSheetOverlays(merged.sheetOverlays);
    };
    window.addEventListener("storage", onStore);
    return () => window.removeEventListener("storage", onStore);
  }, [siteId]);
  const histKey = (s) =>
    JSON.stringify({ p: s.parcels, e: s.els, m: s.measures, c: s.callouts, k: s.markups }) +
    "|" + (s.underlay ? `${s.underlay.x},${s.underlay.y},${s.underlay.ftPerPx},${s.underlay.ftPerPxY},${s.underlay.opacity},${s.underlay.locked},${s.underlay.src?.length}` : "none") +
    "|" + ((s.sheetOverlays || []).map((o) => `${o.id}:${Math.round(o.x)},${Math.round(o.y)},${o.ftPerPx},${o.rotation},${o.opacity},${o.locked},${o.page},${o.src ? o.src.length : 0}`).join(";") || "no");
  const [, bumpHist] = useState(0);
  const touchHist = () => bumpHist((n) => n + 1); // re-render so undo/redo enabled state updates
  const pushHistory = () => {
    pastRef.current.push(stateRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    touchHist();
  };
  const applySnapshot = (s) => {
    setParcels(s.parcels); setEls(s.els); setMeasures(s.measures); setCallouts(s.callouts || []); setMarkups(s.markups || []); setUnderlay(s.underlay); setSheetOverlays(s.sheetOverlays || []);
    setSel(null); setSplitPath([]); setTypeMenu(null);
  };
  const undo = () => {
    let prev = null;
    while (pastRef.current.length) {
      const cand = pastRef.current.pop();
      if (histKey(cand) !== histKey(stateRef.current)) { prev = cand; break; }
    }
    if (!prev) return;
    futureRef.current.push(stateRef.current);
    applySnapshot(prev);
    touchHist();
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(stateRef.current);
    applySnapshot(next);
    touchHist();
  };

  /* ------------ size tracking ------------ */
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((ents) => {
      const r = ents[0].contentRect;
      setSize({ w: Math.max(320, r.width), h: Math.max(360, r.height) });
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  /* ------------ coordinate transforms ------------ */
  const f2p = useCallback((p) => ({ x: p.x * view.ppf + view.offX, y: p.y * view.ppf + view.offY }), [view]);
  const p2f = useCallback((cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: (cx - r.left - view.offX) / view.ppf, y: (cy - r.top - view.offY) / view.ppf };
  }, [view]);
  const snap = useCallback((v) => {
    const gs = Number.isFinite(settings.gridSize) && settings.gridSize > 0 ? settings.gridSize : 10; // guard a bad grid → never NaN coords
    const on = settings.snap && !altSnapOffRef.current; // global toggle, minus a held-Alt bypass for the current move
    return on ? Math.round(v / gs) * gs : Math.round(v * 100) / 100;
  }, [settings]);
  const snapPt = useCallback((p) => ({ x: snap(p.x), y: snap(p.y) }), [snap]);
  // Snap to the nearest parcel boundary within ~5 ft (or ~10 px); used by Split.
  const snapToBoundary = useCallback((p) => {
    const tol = Math.max(5, 10 / view.ppf);
    let best = null, bestD = Infinity;
    for (const pc of parcels) {
      const pts = pc.points;
      for (let i = 0; i < pts.length; i++) {
        const q = nearestPointOnSeg(p, pts[i], pts[(i + 1) % pts.length]);
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) { bestD = d; best = q; }
      }
    }
    return best && bestD <= tol ? best : null;
  }, [parcels, view]);
  const snapSplit = useCallback((p) => snapToBoundary(p) || snapPt(p), [snapToBoundary, snapPt]);

  /* ------------ fit to content ------------ */
  const fit = useCallback(() => {
    const pts = [];
    parcels.forEach((pc) => pts.push(...pc.points));
    els.forEach((e) => pts.push(...(e.points ? e.points : elCorners(e))));
    if (underlay) {
      const sy = underlay.ftPerPxY || underlay.ftPerPx;
      pts.push({ x: underlay.x, y: underlay.y });
      pts.push({ x: underlay.x + underlay.imgW * underlay.ftPerPx, y: underlay.y + underlay.imgH * sy });
    }
    if (pts.length === 0) { setView({ ppf: 0.35, offX: 60, offY: 60 }); return; }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach((p) => { minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); });
    const bw = Math.max(maxX - minX, 10), bh = Math.max(maxY - minY, 10);
    const pad = 60;
    const ppf = Math.min((size.w - pad * 2) / bw, (size.h - pad * 2) / bh);
    setView({ ppf, offX: pad - minX * ppf + (size.w - pad * 2 - bw * ppf) / 2, offY: pad - minY * ppf + (size.h - pad * 2 - bh * ppf) / 2 });
  }, [parcels, els, underlay, size]);

  // Fit *after* a state change has committed: bump the nonce instead of calling
  // fit() from a stale closure (which would frame the view without the content
  // we just added). The effect runs post-render so fit() sees current state.
  const [fitNonce, setFitNonce] = useState(0);
  const requestFit = useCallback(() => setFitNonce((n) => n + 1), []);
  useEffect(() => { if (fitNonce) fit(); }, [fitNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select the single restored parcel so its handles are ready to use.
  useEffect(() => {
    if (restored?.parcels?.length === 1 && !(restored?.els?.length)) setSel({ kind: "parcel", id: restored.parcels[0].id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bluebeam-style left rail: selecting something opens its menu (element →
  // Properties, parcel → Parcel). Otherwise the rail stays collapsed.
  useEffect(() => {
    if (sel?.kind === "el" || sel?.kind === "callout" || sel?.kind === "markup") setLeftPanel("props");
    else if (sel?.kind === "parcel") setLeftPanel("parcel");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.kind, sel?.id]);
  // Resolve taxing jurisdictions for the selected parcel (async, graceful).
  useEffect(() => {
    const pc = sel?.kind === "parcel" ? parcels.find((p) => p.id === sel.id) : null;
    if (!pc || !pc.attrs) { setTaxInfo(null); return; }
    let live = true;
    resolveTaxRates(siteCounty, pc.attrs).then((r) => { if (live) setTaxInfo(r); }).catch(() => { if (live) setTaxInfo(null); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel?.kind, sel?.id]);
  // The left menu opening/closing resizes the canvas; pan to compensate so the
  // drawing doesn't jump sideways (e.g. on the first element click of a session).
  const prevPanelOpen = useRef(!!leftPanel);
  useEffect(() => {
    const open = !!leftPanel;
    if (open !== prevPanelOpen.current) {
      const delta = leftWidth + 6; // panel width + drag handle
      setView((v) => ({ ...v, offX: v.offX + (open ? -delta : delta) }));
      prevPanelOpen.current = open;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leftPanel]);
  // Remember the left menu width between sessions.
  useEffect(() => { try { localStorage.setItem("planarfit:leftWidth", String(leftWidth)); } catch (_) {} }, [leftWidth]);
  useEffect(() => { try { localStorage.setItem("planarfit:parkingRows", parkingRows); localStorage.setItem("planarfit:roadWidth", roadWidth); localStorage.setItem("planarfit:measureMode", measureMode); localStorage.setItem("planarfit:easeMode", easeMode); localStorage.setItem("planarfit:easeType", easeType); localStorage.setItem("planarfit:easeWidth", String(easeWidth)); } catch (_) {} }, [parkingRows, roadWidth, measureMode, easeMode, easeType, easeWidth]);
  // Drag the panel's right edge to resize it.
  const startLeftResize = (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = leftWidth;
    const onMove = (ev) => setLeftWidth(Math.max(240, Math.min(620, startW + (ev.clientX - startX))));
    const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // Reframe when this view becomes active — its real size is known only once shown.
  useEffect(() => {
    if (active) { const t = setTimeout(() => requestFit(), 120); return () => clearTimeout(t); }
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ------------ wheel zoom (non-passive) ------------ */
  useEffect(() => {
    // Attach to the canvas WRAPPER (which holds the SVG + the HTML overlays), so
    // scrolling over a badge / zoom button / selected element still zooms.
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e) => {
      // Let scrollable overlay panels (Layers control, etc.) scroll instead of zooming the canvas.
      if (e.target.closest && e.target.closest("[data-wheelscroll]")) return;
      e.preventDefault();
      const r = wrap.getBoundingClientRect(); // SVG fills the wrapper, so same rect
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      setView((v) => {
        const fx = (mx - v.offX) / v.ppf, fy = (my - v.offY) / v.ppf;
        const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
        const ppf = Math.max(0.02, Math.min(8, v.ppf * factor));
        return { ppf, offX: mx - fx * ppf, offY: my - fy * ppf };
      });
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, []);

  /* ------------ keyboard ------------ */
  useEffect(() => {
    const onKey = (e) => {
      const t = document.activeElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return; // don't hijack keys while typing in a field
      if ((e.ctrlKey || e.metaKey) && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "c" || e.key === "C")) { if (sel?.kind === "el") { e.preventDefault(); copySel(); } return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "x" || e.key === "X")) { if (sel?.kind === "el") { e.preventDefault(); cutSel(); } return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V")) { if (clip.current) { e.preventDefault(); pasteClip(); } return; }
      if ((e.ctrlKey || e.metaKey) && (e.key === "d" || e.key === "D")) { if (multi.length > 1) { e.preventDefault(); multi.filter((m) => m.kind === "el").forEach((m) => duplicateEl(m.id)); } else if (sel?.kind === "el") { e.preventDefault(); duplicateEl(sel.id); } return; }
      if ((e.key === "v" || e.key === "V") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectTool("select"); return; }
      if ((e.key === "h" || e.key === "H") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); selectTool("pan"); return; }
      if ((e.key === "s" || e.key === "S") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); setSnap(!settings.snap); return; } // toggle snap (hold Alt while dragging to bypass for one move)
      // Hold Space → temporary hand-pan over whatever tool is active (released = back to it).
      if (e.key === " " || e.code === "Space") {
        if (document.activeElement && document.activeElement.tagName === "BUTTON") return; // let Space activate a focused button
        if (!spaceRef.current) { spaceRef.current = true; setSpacePan(true); }
        e.preventDefault(); // arm hold-to-pan; also blocks the page from scrolling
        return;
      }
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) { e.preventDefault(); setShowShortcuts((s) => !s); return; }
      if ((e.key === "q" || e.key === "Q") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectTool("callout"); return; }
      if ((e.key === "t" || e.key === "T") && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectTool("text"); return; }
      // Bluebeam-matching markup shortcuts: L line, R rect, E ellipse, ⇧P polygon, ⇧N polyline
      if ((e.key === "l" || e.key === "L") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); selectTool("mline"); return; }
      if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); selectTool("mrect"); return; }
      if ((e.key === "e" || e.key === "E") && !e.ctrlKey && !e.metaKey && !e.shiftKey) { e.preventDefault(); selectTool("mellipse"); return; }
      if ((e.key === "p" || e.key === "P") && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectTool("mpolygon"); return; }
      if ((e.key === "n" || e.key === "N") && e.shiftKey && !e.ctrlKey && !e.metaKey) { e.preventDefault(); selectTool("mpolyline"); return; }
      if (e.key === "Enter" && tool === "select" && combineSel.length >= 2) { e.preventDefault(); mergeParcels(); return; }
      // Enter finishes / auto-closes ANY in-progress multi-point drawing (one shared path with double-click).
      if (e.key === "Enter" && finishActiveDrawing()) { e.preventDefault(); return; }
      if (e.key === "Escape") { setDraftPoly(null); setDraftRect(null); setDraftElPoly(null); setRoadStart(null); setDraftRoad(null); setMeasDraft([]); setCalib(null); setSplitPath([]); setCombineSel([]); setCalloutDraft(null); cancelEditCallout(); setMkRect(null); setMkPoly(null); setEaseDraft(null); setEaseEdges(null); setEaseMenu(false); setMarquee(null); setMulti([]); setPrintMode(false); setPrintFrame(null); setIdentifyMode(false); setIdentifyRes(null); setAttachFor(null); setAlignFor(null); setPobMode(null); setOvCalib(null); setTraceMode(false); setTracePts([]); setRouteMode(null); setXsecMode(false); setXsecPts([]); setOverlapWarn(""); setSel(null); setTypeMenu(null); setParcelMenu(null); setToolMenu(false); setMeasureMenu(false); setTool("select"); }
      if (e.key.startsWith("Arrow") && (multi.length > 1 || sel?.kind === "el")) { e.preventDefault(); nudgeSel(e.key, e.shiftKey ? 10 : 1); return; }
      if ((e.key === "Backspace" || e.key === "Delete") && removeLastVertex()) { e.preventDefault(); return; } // undo the last placed vertex mid-draw
      if ((e.key === "Delete" || e.key === "Backspace") && (selRef.current || multiRef.current.length)) { e.preventDefault(); deleteSel(); } // read live selection (refs) — not the listener's possibly-stale closure
    };
    const onKeyUp = (e) => { if (e.key === " " || e.code === "Space") { spaceRef.current = false; setSpacePan(false); } };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, [sel, tool, splitPath, els, settings, measDraft, measureMode, combineSel, mkPoly, multi, traceMode, tracePts, editCallout, draftPoly, draftElPoly, easeDraft, easeEdges, easeMode, easeWidth, parcels]); // eslint-disable-line

  const deleteSel = () => {
    const sel = selRef.current, multi = multiRef.current; // live selection — robust to a stale keydown closure (NEW-1)
    if (multi.length > 1) { // delete the whole multi-selection (+ each element's assembly)
      pushHistory();
      const elIds = new Set();
      multi.filter((m) => m.kind === "el").forEach((m) => assemblyOf(m.id).forEach((x) => elIds.add(x.id)));
      const mkIds = new Set(multi.filter((m) => m.kind === "markup").map((m) => m.id));
      setEls((a) => a.filter((e) => !elIds.has(e.id) && !elIds.has(e.attachedTo)));
      setMarkups((a) => a.filter((m) => !mkIds.has(m.id)));
      setMulti([]); setSel(null);
      return;
    }
    if (!sel) return;
    pushHistory();
    if (sel.kind === "el") setEls((a) => a.filter((e) => e.id !== sel.id && e.attachedTo !== sel.id));
    else if (sel.kind === "measure") setMeasures((a) => a.filter((_, i) => i !== sel.i));
    else if (sel.kind === "callout") setCallouts((a) => a.filter((c) => c.id !== sel.id));
    else if (sel.kind === "markup") setMarkups((a) => a.filter((m) => m.id !== sel.id));
    else setParcels((a) => a.filter((p) => p.id !== sel.id));
    setSel(null);
  };
  // Arrow-nudge the selection (1′, or 10′ with Shift) — group when multi-selected.
  const nudgeSel = (key, step) => {
    const dx = key === "ArrowLeft" ? -step : key === "ArrowRight" ? step : 0;
    const dy = key === "ArrowUp" ? -step : key === "ArrowDown" ? step : 0;
    if (!dx && !dy) return;
    pushHistory();
    if (multi.length > 1) {
      const elIds = new Set(); multi.filter((m) => m.kind === "el").forEach((m) => assemblyOf(m.id).forEach((x) => elIds.add(x.id)));
      const mkIds = new Set(multi.filter((m) => m.kind === "markup").map((m) => m.id));
      setEls((a) => a.map((el) => elIds.has(el.id) ? (el.points ? { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : { ...el, cx: el.cx + dx, cy: el.cy + dy }) : el));
      setMarkups((a) => a.map((m) => mkIds.has(m.id) ? translateMarkup(m, dx, dy) : m));
    } else if (sel?.kind === "el") {
      const ids = new Set(assemblyOf(sel.id).map((x) => x.id));
      setEls((a) => a.map((el) => ids.has(el.id) ? (el.points ? { ...el, points: el.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : { ...el, cx: el.cx + dx, cy: el.cy + dy }) : el));
    }
  };
  // Copy / cut / paste the selected element (rectangles or polygons).
  const copySel = () => { if (sel?.kind === "el") clip.current = els.find((x) => x.id === sel.id) || clip.current; };
  const cutSel = () => { if (sel?.kind === "el") { copySel(); deleteSel(); } };
  const pasteClip = () => {
    if (!clip.current) return;
    const src = detachClone(clip.current); // a pasted copy starts standalone (no host/court links)
    const off = (settings.gridSize || 10) * 2; // nudge the copy so it's visible
    const el = src.points
      ? { ...src, id: uid(), points: src.points.map((p) => ({ x: p.x + off, y: p.y + off })) }
      : { ...src, id: uid(), cx: src.cx + off, cy: src.cy + off };
    pushHistory();
    setEls((a) => [...a, el]);
    setSel({ kind: "el", id: el.id });
  };
  // Duplicate an element (offset ~10′, unattached). Used constantly from the menu.
  const duplicateEl = (id) => {
    const src = els.find((x) => x.id === id);
    if (!src) return;
    const rest = detachClone(src);
    const off = settings.gridSize || 10;
    const el = rest.points
      ? { ...rest, id: uid(), points: rest.points.map((p) => ({ x: p.x + off, y: p.y + off })) }
      : { ...rest, id: uid(), cx: rest.cx + off, cy: rest.cy + off };
    pushHistory();
    setEls((a) => [...a, el]);
    setSel({ kind: "el", id: el.id });
  };
  const selectMeasure = (e, i) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    setSel({ kind: "measure", i });
  };

  /* ------------ pointer handlers (svg root) ------------ */
  const onBgDown = (e) => {
    if (e.button !== 0) return;
    altSnapOffRef.current = !!e.altKey; // Alt at placement → drop free (no grid snap), matching the drag bypass
    const fp = p2f(e.clientX, e.clientY);

    if (printMode) { // in print-placement: background drag pans only (frame has its own handles)
      setPanning(true);
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.offX, oy: view.offY };
      svgRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (spaceRef.current) { // Space held → temporary hand-pan over whatever tool/mode is active (D4)
      setPanning(true);
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.offX, oy: view.offY };
      svgRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (attachFor) { setAttachFor(null); return; }     // clicked empty space → cancel attach
    if (alignFor) { alignToParcelEdge(fp, null); return; } // align: pick the nearest parcel edge to the click
    if (identifyMode) { identifyAt(fp); return; } // identify: query county GIS at the click
    if (pobMode) { anchorEncumbrance(snapPt(fp)); return; } // metes-and-bounds: drop the POB here
    if (ovCalib) { onOvCalibClick(fp); return; } // overlay trace/align: capture a calibration point
    if (xsecMode) { // ditch cross-section: two clicks → sample elevations
      const sp = snapPt(fp);
      if (xsecPts.length === 0) { setXsecPts([sp]); flashWarn("Click the far side of the ditch.", 0); }
      else { runXSection(xsecPts[0], sp); }
      return;
    }
    if (traceMode) { setTracePts((a) => [...a, snapPt(fp)]); return; } // power-line quick-trace point
    if (routeMode) { // utility service routing: pick source, then a building
      if (routeMode.stage === "source") {
        let src = snapPt(fp);
        if (routeMode.snapTo === "traced") {
          const near = nearestOnPolylines(fp, markups.filter((m) => m.kind === "traced").map((m) => m.pts));
          if (!near || near.d > 90) { flashWarn("Click closer to a traced power line.", 0); return; }
          src = near.pt;
        }
        setRouteMode({ ...routeMode, stage: "building", source: src });
        flashWarn("Now click the building to serve.", 0);
        return;
      }
      let b = els.find((e) => e.type === "building" && ringHas(fp, ringOf(e)));
      if (!b) { const builds = els.filter((e) => e.type === "building"); if (builds.length) b = builds.reduce((best, e) => _hyp(fp, centroid(ringOf(e))) < _hyp(fp, centroid(ringOf(best))) ? e : best); }
      if (!b) { flashWarn("No building to serve — draw a building first.", 0); return; }
      commitUtilRoute(routeMode, b);
      return;
    }
    if (tool === "pan") { // Shift+V hand tool — drag to move the canvas, never select
      setPanning(true);
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.offX, oy: view.offY };
      svgRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "select") {
      if (e.shiftKey) { // Shift-drag empty canvas → marquee select
        drag.current = { mode: "marquee", a: fp };
        setMarquee({ a: fp, b: fp });
        svgRef.current.setPointerCapture(e.pointerId);
        return;
      }
      setSel(null); setMulti([]);
      setPanning(true);
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.offX, oy: view.offY };
      svgRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "callout") { placeCallout(fp); return; } // click tip, then box
    if (tool === "text") { placeText(fp); return; }       // one click → text box
    if (tool === "mline" || tool === "mrect" || tool === "mellipse") { // drag-draw markup
      const a = snapPt(fp);
      drag.current = { mode: "mkDraw", kind: tool, a };
      setMkRect({ kind: tool, a, b: a, shift: e.shiftKey });
      svgRef.current.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === "mpolygon" || tool === "mpolyline") { // click-draw markup
      const sp = snapPt(fp);
      if (mkPoly && mkPoly.pts.length >= (tool === "mpolygon" ? 3 : 2) && dist(f2p(sp), f2p(mkPoly.pts[0])) < 12 && tool === "mpolygon") { finishMkPoly(); return; }
      const last = mkPoly?.pts?.[mkPoly.pts.length - 1];
      const pt = (e.shiftKey && last) ? snapPt(snap45(last, fp)) : sp;
      setMkPoly((d) => (d ? { ...d, pts: [...d.pts, pt] } : { kind: tool, pts: [pt] }));
      return;
    }
    if (tool === "easement") {
      if (easeMode === "parceledge") return; // edges are picked via the parcel-edge hit targets, not the canvas
      const sp = snapPt(fp);
      // boundary mode: clicking the first dot closes the polygon (≥3 pts)
      if (easeMode === "boundary" && easeDraft && easeDraft.pts.length >= 3 && dist(f2p(sp), f2p(easeDraft.pts[0])) < 12) { finishEaseDraft(); return; }
      const last = easeDraft?.pts?.[easeDraft.pts.length - 1];
      const pt = (e.shiftKey && last) ? snapPt(snap45(last, fp)) : sp;
      setEaseDraft((d) => (d ? { pts: [...d.pts, pt] } : { pts: [pt] }));
      return;
    }
    if (tool === "parcel") {
      const sp = snapPt(fp);
      if (draftPoly && draftPoly.length >= 3 && dist(f2p(sp), f2p(draftPoly[0])) < 12) { closePoly(); return; }
      setDraftPoly((d) => (d ? [...d, sp] : [sp]));
      return;
    }
    if (tool === "measure") {
      const sp = snapPt(fp);
      if (measureMode === "line") {
        // two-click distance
        if (measDraft.length === 0) setMeasDraft([sp]);
        else { pushHistory(); setMeasures((m) => [...m, { id: uid(), mode: "line", pts: [measDraft[0], sp] }]); setMeasDraft([]); }
      } else {
        // polyline / area: accumulate points; close an area by clicking the first dot
        if (measureMode === "area" && measDraft.length >= 3 && dist(f2p(sp), f2p(measDraft[0])) < 12) { finishMeasure(); return; }
        setMeasDraft((d) => [...d, sp]);
      }
      return;
    }
    if (tool === "calibrate") {
      // Calibration points are NOT grid-snapped — we want to land exactly on
      // the screenshot feature the user is clicking.
      if (!underlay) { flashWarn("Calibrate needs an underlay — drop an aerial/screenshot first (Aerial ▾).", 5000); return; }
      if (!calib || calib.b) { setCalib({ a: fp }); setCalibInput(""); }
      else setCalib((c) => ({ a: c.a, b: fp }));
      return;
    }
    if (tool === "split") {
      // Build up a cut polyline; double-click (or Enter) finishes the cut.
      const sp = snapSplit(fp);
      setSplitPath((pts) => [...pts, sp]);
      return;
    }
    if (DRAW_TYPES.includes(tool)) {
      const sp = snapPt(fp);
      if (draftElPoly) { // adding points to an in-progress polygon element
        if (draftElPoly.pts.length >= 3 && dist(f2p(sp), f2p(draftElPoly.pts[0])) < 12) { closeElPoly(); return; }
        setDraftElPoly((d) => ({ ...d, pts: [...d.pts, sp] }));
        return;
      }
      // Fixed-width road: two clicks lay a centerline at any angle (no drag).
      if (tool === "road" && roadWidth !== "free") {
        if (!roadStart) { setRoadStart(sp); return; }
        const A = roadStart, B = sp, len = Math.hypot(B.x - A.x, B.y - A.y);
        if (len >= 4) {
          const curb = +settings.roadCurb || CURB;
          const cross = +roadWidth + 2 * curb;
          let rot = Math.atan2(B.y - A.y, B.x - A.x) * 180 / Math.PI;
          if (e.shiftKey) rot = Math.round(rot / 45) * 45;
          pushHistory();
          // Keep the length axis (w) ≥ the cross axis (h): curb render / resize / roadTravel
          // infer the cross from min(w,h), so a road drawn shorter than it is wide swapped axes (B61).
          const el = { id: uid(), type: "road", cx: (A.x + B.x) / 2, cy: (A.y + B.y) / 2, w: Math.max(len, cross), h: cross, rot, travelW: +roadWidth, curb };
          setEls((a) => [...a, el]);
          setSel({ kind: "el", id: el.id });
          setTool("select");
        }
        setRoadStart(null); setDraftRoad(null);
        return;
      }
      pushHistory();
      let presetDepth = 0; // fixed cross-width for a preset strip (0 = free draw)
      if (tool === "parking" && parkingRows !== "free") presetDepth = parkingRows === "double" ? settings.stallDepth * 2 + settings.aisle : settings.stallDepth + settings.aisle;
      else if (tool === "road" && roadWidth !== "free") presetDepth = +roadWidth + 2 * (+settings.roadCurb || CURB); // travel + curb each side
      drag.current = { mode: "draw", type: tool, ox: sp.x, oy: sp.y, depth: presetDepth };
      setDraftRect({ type: tool, x: sp.x, y: sp.y, w: 0, h: 0 });
      svgRef.current.setPointerCapture(e.pointerId);
    }
  };

  // Finish the in-progress cut polyline and split.
  const finishSplit = () => {
    if (splitPath.length >= 2) performSplit(splitPath);
    setSplitPath([]);
  };
  // Commit the in-progress polyline / area measurement.
  // Warn (but still accept) when a freshly-closed outline crosses itself or has ~zero area,
  // so a silently-wrong shoelace area can't slip into the yield math unnoticed.
  const flashPolyWarn = (pts, label) => {
    if (polySelfIntersects(pts)) { flashWarn(`${label} outline crosses itself — its area may be wrong. Redraw without crossing lines.`, 7000); }
    else if (polyArea(pts) < 1) { flashWarn(`${label} has almost no area — check the outline.`, 6000); }
  };
  const finishMeasure = () => {
    if (measureMode === "polyline" && measDraft.length >= 2) { pushHistory(); setMeasures((m) => [...m, { id: uid(), mode: "polyline", pts: measDraft }]); }
    else if (measureMode === "area" && measDraft.length >= 3) { pushHistory(); setMeasures((m) => [...m, { id: uid(), mode: "area", pts: measDraft }]); flashPolyWarn(measDraft, "Measured area"); }
    setMeasDraft([]);
  };
  // Split the selected parcel (or whichever parcel the cut crosses) along a
  // polyline of >=2 points. Two points cut along the infinite line through them
  // (a straight cut — concave lots can yield more than two pieces); 3+ points
  // bend the cut through the interior.
  const performSplit = (path) => {
    // Drop consecutive coincident points (a finishing double-click adds the last twice).
    const pts = path.filter((p, i) => i === 0 || dist(p, path[i - 1]) > 0.01);
    if (pts.length < 2) return;
    const ordered = sel?.kind === "parcel"
      ? [parcels.find((p) => p.id === sel.id), ...parcels.filter((p) => p.id !== sel.id)].filter(Boolean)
      : parcels;
    for (const pc of ordered) {
      const pieces = pts.length === 2
        ? splitPolygonByLine(pc.points, pts[0], pts[1])
        : splitPolygonByPath(pc.points, pts);
      if (pieces) {
        // Backstop guard: if the pieces don't conserve the original area (they overlap or
        // omit a wedge) or come out self-intersecting, the cut was ambiguous — skip with a
        // warning instead of saving corrupted geometry that throws off every downstream
        // yield number. A clean straight cut through a concave lot now produces all the
        // real pieces (e.g. 3 for a U-shaped lot), which this still accepts.
        const whole = polyArea(pc.points), sum = pieces.reduce((s, r) => s + polyArea(r), 0);
        if (pieces.some(polySelfIntersects) || Math.abs(sum - whole) > whole * 0.02 + 1) {
          flashWarn("That cut crosses the parcel ambiguously (concave shape) — try a straight cut between two opposite edges.", 7000);
          return;
        }
        pushHistory();
        const inherit = { addr: pc.addr || null, acct: pc.acct || null, attrs: pc.attrs || null };
        const made = pieces.map((ring) => ({ id: uid(), points: ring, locked: true, ...inherit }));
        setParcels((arr) => arr.flatMap((p) => (p.id === pc.id ? made : [p])));
        setSel({ kind: "parcel", id: made[0].id });
        return;
      }
    }
  };

  /* ------------ merge parcels (Shift-click multi-select) ------------ */
  const toggleMerge = (id) => setCombineSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  // Fuse the selected parcels (any that share a boundary) into one parcel on the
  // editable layer — a working merge for test-fit/yield, NOT a recorded legal
  // consolidation. Merges greedily so a connected group of 2+ collapses to one.
  const mergeParcels = () => {
    const chosen = parcels.filter((p) => combineSel.includes(p.id));
    if (chosen.length < 2) return;
    let result = chosen[0].points;
    let remaining = chosen.slice(1).map((p) => p.points);
    let progress = true;
    while (remaining.length && progress) {
      progress = false;
      for (let i = 0; i < remaining.length; i++) {
        const merged = mergeRings(result, remaining[i]);
        if (merged) { result = merged; remaining.splice(i, 1); progress = true; break; }
      }
    }
    if (remaining.length) { alert("Those parcels don't all share a boundary — pick parcels that touch edge-to-edge."); return; }
    pushHistory();
    const np = { id: uid(), points: result, locked: true };
    setParcels((arr) => [...arr.filter((p) => !combineSel.includes(p.id)), np]);
    setCombineSel([]);
    setSel({ kind: "parcel", id: np.id });
    setTool("select");
  };

  /* ------------ callouts (annotations) ------------ */
  // Re-aim / move / retext callouts. Box & tip are stored in feet.
  const setCallout = (id, patch) => setCallouts((a) => a.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  // Resolved style for a callout (defaults + per-callout overrides).
  const calloutStyle = (c) => ({ size: c.size || 13, color: c.color || "#1f2937", fill: c.fill || "#fffbe8", stroke: c.stroke || "#1f2937", align: c.align || "center", bold: !!c.bold, italic: !!c.italic, underline: !!c.underline, padX: c.padX ?? 8, padY: c.padY ?? 8, lineHeight: c.lineHeight ?? 1.3 });
  // Inline editing: a textarea overlays the box. Empty text removes the callout.
  const beginEditCallout = (id) => { const c = callouts.find((x) => x.id === id); if (!c) return; setSel({ kind: "callout", id }); setEditCallout({ id, text: c.text || "" }); }; // no history on open — pushed on commit only if the text changed (B32)
  const commitEditCallout = () => {
    if (!editCallout) return;
    const { id, text, isNew } = editCallout;
    const cur = callouts.find((c) => c.id === id);
    const orig = (cur && cur.text) || "";
    if (!text.trim()) { // blank → discard (a brand-new callout's creation already pushed a frame)
      if (cur && !isNew) pushHistory();
      setCallouts((a) => a.filter((c) => c.id !== id));
    } else if (text.trim() !== orig.trim()) { // only a REAL text change adds an undo frame (B32)
      if (!isNew) pushHistory(); // new callouts already pushed history at creation
      setCallout(id, { text });
    }
    setEditCallout(null);
  };
  const cancelEditCallout = () => { if (editCallout?.isNew) setCallouts((a) => a.filter((c) => c.id !== editCallout.id)); setEditCallout(null); };
  // Click 1 sets the tip (what it points at); click 2 drops the box and starts typing.
  const placeCallout = (fp) => {
    if (!calloutDraft) { setCalloutDraft({ tip: fp }); return; }
    pushHistory();
    const c = { id: uid(), tip: calloutDraft.tip, box: fp, text: "" };
    setCalloutDraft(null);
    setCallouts((a) => [...a, c]);
    setSel({ kind: "callout", id: c.id });
    setTool("select");
    setEditCallout({ id: c.id, text: "", isNew: true });
  };
  // Text box: a callout with no leader — one click drops the box, then type.
  const placeText = (fp) => {
    pushHistory();
    const c = { id: uid(), box: fp, noLeader: true, text: "" };
    setCallouts((a) => [...a, c]);
    setSel({ kind: "callout", id: c.id });
    setTool("select");
    setEditCallout({ id: c.id, text: "", isNew: true });
  };
  /* ------------ markup shapes ------------ */
  const finishMkPoly = () => {
    if (mkPoly) {
      const pts = mkPoly.pts.filter((p, i) => i === 0 || dist(p, mkPoly.pts[i - 1]) > 0.01);
      const min = mkPoly.kind === "mpolygon" ? 3 : 2;
      if (pts.length >= min) {
        const mk = { id: uid(), kind: mkPoly.kind === "mpolygon" ? "polygon" : "polyline", pts, ...mkStyle };
        pushHistory(); setMarkups((a) => [...a, mk]); setSel({ kind: "markup", id: mk.id });
      }
    }
    setMkPoly(null); setTool("select");
  };
  const translateMarkup = (m, dx, dy) => {
    const shift = (arr) => (arr || []).map((p) => ({ x: p.x + dx, y: p.y + dy }));
    if (m.kind === "utilRoute") return { ...m, pts: shift(m.pts), corridor: shift(m.corridor), pad: shift(m.pad) };
    if (m.kind === "encumbrance") return { ...m, pts: m.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })), centerline: (m.centerline || []).map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    if (m.kind === "easement") return { ...m, pts: shift(m.pts), centerline: m.centerline ? shift(m.centerline) : m.centerline };
    if (m.pts) return { ...m, pts: m.pts.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    if (m.a) return { ...m, a: { x: m.a.x + dx, y: m.a.y + dy }, b: { x: m.b.x + dx, y: m.b.y + dy } };
    return { ...m, cx: m.cx + dx, cy: m.cy + dy };
  };
  const startMoveMarkup = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    if (e.shiftKey) {
      setMulti((s) => inMulti("markup", id) ? s.filter((m) => !(m.kind === "markup" && m.id === id)) : [...s, { kind: "markup", id }]);
      setSel({ kind: "markup", id });
      return;
    }
    if (multi.length > 1 && inMulti("markup", id)) { startGroupMove(e); return; }
    if (multi.length) setMulti([]);
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) { setSel({ kind: "markup", id }); return; }
    setSel({ kind: "markup", id });
    pushHistory();
    const fp = p2f(e.clientX, e.clientY);
    drag.current = { mode: "mkMove", id, fx: fp.x, fy: fp.y, orig: m };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  // Start moving every member of the multi-selection together (respecting assemblies).
  const startGroupMove = (e) => {
    pushHistory();
    const fp = p2f(e.clientX, e.clientY);
    const elIds = new Set();
    multi.filter((m) => m.kind === "el").forEach((m) => assemblyOf(m.id).forEach((x) => elIds.add(x.id)));
    const orig = {
      els: els.filter((x) => elIds.has(x.id)).map((x) => x.points ? { id: x.id, points: x.points } : { id: x.id, cx: x.cx, cy: x.cy }),
      markups: markups.filter((m) => inMulti("markup", m.id)).map((m) => ({ ...m })),
    };
    drag.current = { mode: "groupMove", fx: fp.x, fy: fp.y, orig };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const selMarkup = sel?.kind === "markup" ? markups.find((m) => m.id === sel.id) : null;
  const setSelMarkup = (patch) => { pushHistory(); setMarkups((a) => a.map((m) => m.id === selMarkup.id ? { ...m, ...patch } : m)); setMkStyle((s) => ({ ...s, ...patch })); };
  // Geometry patch (w/h/rot) — kept out of mkStyle so new shapes don't inherit a past size/angle.
  const setSelMarkupGeom = (patch) => { pushHistory(); setMarkups((a) => a.map((m) => m.id === selMarkup.id ? { ...m, ...patch } : m)); };

  /* ------------ easements (first-class objects on the editable layer) ------------ */
  // The hand-editable path of an easement: the boundary ring for mode B, else the
  // centerline/edge-run spine that gets offset into the strip.
  const easeEditPath = (e) => (e.mode === "boundary" ? (e.pts || []) : (e.centerline || []));
  const easeEditClosed = (e) => e.mode === "boundary";
  // Apply a patch and RE-DERIVE the drawn ring, so a width/vertex change re-offsets
  // the strip live (NEW-1). Boundary mode derives pts = the path itself.
  const withEaseRing = (e, patch) => {
    const next = { ...e, ...patch };
    const ring = deriveEasementRing(next);
    return ring && ring.length >= 3 ? { ...next, pts: ring } : next;
  };
  const setEasePath = (e, path) => withEaseRing(e, e.mode === "boundary" ? { pts: path } : { centerline: path });
  // Build an easement from a geometry spec + the sticky tool attributes.
  const makeEasement = (spec) => {
    const ring = deriveEasementRing(spec);
    if (!ring || ring.length < 3) return null;
    return {
      id: uid(), kind: "easement", mode: spec.mode, pts: ring,
      centerline: spec.centerline || null, width: spec.width || 0, offsetSide: spec.offsetSide,
      ...DEFAULT_EASEMENT_ATTRS, easeType, // start from the tool's current type
    };
  };
  // Commit a built easement: history + add + select + a screening overlap warning.
  const commitEasement = (mk) => {
    if (!mk) { flashWarn("Couldn't build that easement — check the points / width.", 5000); return; }
    pushHistory();
    setMarkups((a) => [...a, mk]);
    setSel({ kind: "markup", id: mk.id }); setLeftPanel("props"); setTool("select");
    const ringOfEl = (e) => (e.points ? e.points : elCorners(e));
    const hits = els.filter((e) => (e.type === "building" || e.type === "paving") && ringsOverlap(mk.pts, ringOfEl(e)));
    flashWarn(hits.length
      ? `${easementLabel(mk)} placed — ⚠ overlaps ${hits.length} building/paving area${hits.length > 1 ? "s" : ""} (${Math.round(easementArea(mk)).toLocaleString()} sf).`
      : `${easementLabel(mk)} placed — ${Math.round(easementArea(mk)).toLocaleString()} sf.`, 7000);
  };
  // Finish a centerline / boundary easement being click-drawn.
  const finishEaseDraft = () => {
    if (!easeDraft) return;
    const pts = easeDraft.pts.filter((p, i) => i === 0 || dist(p, easeDraft.pts[i - 1]) > 0.01);
    if (easeMode === "boundary") { if (pts.length >= 3) commitEasement(makeEasement({ mode: "boundary", pts })); }
    else if (pts.length >= 2) commitEasement(makeEasement({ mode: "centerline", centerline: pts, width: easeWidth }));
    setEaseDraft(null);
  };
  // Finish a parcel-edge easement (NEW-3): one-sided strip inset from the chosen run.
  const finishEaseEdges = () => {
    if (!easeEdges || !easeEdges.idx.length) return;
    const pc = parcels.find((p) => p.id === easeEdges.parcelId);
    if (!pc) { setEaseEdges(null); return; }
    const strip = buildParcelEdgeStrip(pc.points, easeEdges.idx, easeWidth);
    if (!strip) { flashWarn("Pick ONE contiguous run of edges along a single parcel, then press Enter.", 6000); return; }
    commitEasement(makeEasement({ mode: "parceledge", centerline: strip.run, width: easeWidth, offsetSide: strip.offsetSide }));
    setEaseEdges(null);
  };
  // Toggle a parcel edge in the in-progress run; switching parcels restarts the run.
  const toggleEaseEdge = (parcelId, edge) => {
    setEaseEdges((s) => {
      if (!s || s.parcelId !== parcelId) return { parcelId, idx: [edge] };
      const idx = s.idx.includes(edge) ? s.idx.filter((i) => i !== edge) : [...s.idx, edge];
      return idx.length ? { parcelId, idx } : null;
    });
  };
  // Attribute edit on the selected easement (re-derives the ring so width edits re-offset live).
  const setSelEasement = (patch) => { pushHistory(); setMarkups((a) => a.map((m) => m.id === selMarkup.id ? withEaseRing(m, patch) : m)); };
  // Vertex editing of the selected easement's path (drag; Shift-click deletes; ＋ adds).
  const startEaseVertex = (ev, id, index) => {
    if (tool !== "select" || ev.button !== 0) return;
    ev.stopPropagation();
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) { setSel({ kind: "markup", id }); return; }
    if (ev.shiftKey) {
      const minN = m.mode === "boundary" ? 3 : 2;
      if (easeEditPath(m).length > minN) { pushHistory(); setMarkups((a) => a.map((x) => x.id === id ? setEasePath(x, easeEditPath(x).filter((_, i) => i !== index)) : x)); }
      return;
    }
    setSel({ kind: "markup", id });
    pushHistory();
    drag.current = { mode: "easeVertex", id, index };
    svgRef.current.setPointerCapture(ev.pointerId);
  };
  const addEaseVertex = (ev, id, index) => {
    if (tool !== "select" || ev.button !== 0) return;
    ev.stopPropagation();
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) return;
    pushHistory();
    setMarkups((a) => a.map((x) => {
      if (x.id !== id) return x;
      const path = easeEditPath(x), p = path[index], q = path[(index + 1) % path.length];
      const np = [...path]; np.splice(index + 1, 0, snapPt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }));
      return setEasePath(x, np);
    }));
  };
  const startMoveCallout = (e, id, part) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const c = callouts.find((x) => x.id === id);
    setSel({ kind: "callout", id });
    pushHistory();
    const fp = p2f(e.clientX, e.clientY);
    drag.current = { mode: "callout", id, part, fx: fp.x, fy: fp.y, box0: { ...c.box }, tip0: { ...c.tip } };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  /* ------------ parcel vertex editing ------------ */
  const startVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    if (parcels.find((p) => p.id === id)?.locked) { e.stopPropagation(); setSel({ kind: "parcel", id }); return; }
    e.stopPropagation();
    pushHistory();
    if (e.shiftKey) { // shift-click removes a vertex (keep a triangle minimum)
      setParcels((a) => a.map((pc) => pc.id === id && pc.points.length > 3
        ? { ...pc, points: pc.points.filter((_, i) => i !== index) } : pc));
      return;
    }
    setSel({ kind: "parcel", id });
    drag.current = { mode: "vertex", id, index };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const addVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    if (parcels.find((p) => p.id === id)?.locked) return;
    e.stopPropagation();
    pushHistory();
    setParcels((a) => a.map((pc) => {
      if (pc.id !== id) return pc;
      const p = pc.points[index], q = pc.points[(index + 1) % pc.points.length];
      const mid = snapPt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const points = [...pc.points];
      points.splice(index + 1, 0, mid);
      return { ...pc, points };
    }));
    setSel({ kind: "parcel", id });
  };

  /* ------------ polygon element vertex editing (drag/add/delete points) ------------ */
  const startElVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    if (!el || !el.points || el.locked) return;
    pushHistory();
    if (e.shiftKey) { // shift-click removes a vertex (keep a triangle minimum)
      setEls((a) => a.map((x) => x.id === id && x.points && x.points.length > 3
        ? { ...x, points: x.points.filter((_, i) => i !== index) } : x));
      return;
    }
    setSel({ kind: "el", id });
    drag.current = { mode: "elVertex", id, index };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const addElVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    if (!el || !el.points || el.locked) return;
    pushHistory();
    setEls((a) => a.map((x) => {
      if (x.id !== id || !x.points) return x;
      const p = x.points[index], q = x.points[(index + 1) % x.points.length];
      const mid = snapPt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const points = [...x.points];
      points.splice(index + 1, 0, mid);
      return { ...x, points };
    }));
    setSel({ kind: "el", id });
  };

  /* ------------ measurement vertex editing (B141: Bluebeam-style add/drag/delete) ------------
     Mirrors the element-vertex handlers for the measures[] layer; area/perimeter recompute
     live because the label is derived from the points. Legacy {a,b} records migrate to
     {mode,pts} on first edit. */
  const startMeasureVertex = (e, i, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const m = measures[i];
    if (!m) return;
    const pts = measPts(m), min = measMode(m) === "area" ? 3 : 2;
    pushHistory();
    if (e.shiftKey) { // shift-click deletes the vertex (keep the mode's minimum)
      if (pts.length > min) setMeasures((arr) => arr.map((mm, k) => k === i ? { ...mm, mode: measMode(mm), pts: pts.filter((_, j) => j !== index) } : mm));
      return;
    }
    setSel({ kind: "measure", i });
    drag.current = { mode: "measureVertex", i, index };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const addMeasureVertex = (e, i, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    pushHistory();
    setMeasures((arr) => arr.map((mm, k) => {
      if (k !== i) return mm;
      const pts = measPts(mm), p = pts[index], q = pts[(index + 1) % pts.length];
      const mid = snapPt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const np = [...pts];
      np.splice(index + 1, 0, mid);
      return { ...mm, mode: measMode(mm), pts: np };
    }));
    setSel({ kind: "measure", i });
  };

  /* ------------ markup geometry editing (Bluebeam-style: drag/add/delete vertices,
     resize + rotate boxes). Mirrors the element/measure vertex + resize/rotate handlers
     for the markups[] layer. ------------ */
  const startMarkupVertex = (e, id, index) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) return;
    pushHistory();
    if (e.shiftKey) { // shift-click deletes the vertex (keep the kind's minimum)
      const pts = mkPts(m);
      if (pts.length > mkMinPts(m)) setMarkups((a) => a.map((x) => x.id === id ? setMkPts(x, pts.filter((_, j) => j !== index)) : x));
      return;
    }
    setSel({ kind: "markup", id });
    drag.current = { mode: "mkVertex", id, index };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const addMarkupVertex = (e, id, index) => { // ＋ on an edge midpoint (polyline/polygon)
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) return;
    pushHistory();
    setMarkups((a) => a.map((x) => {
      if (x.id !== id) return x;
      const pts = mkPts(x), p = pts[index], q = pts[(index + 1) % pts.length];
      const mid = snapPt({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
      const np = [...pts]; np.splice(index + 1, 0, mid);
      return setMkPts(x, np);
    }));
    setSel({ kind: "markup", id });
  };
  const startMarkupResize = (e, id, hx, hy) => { // hx/hy ∈ {-1,0,1}: corner = both, edge = one
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) return;
    const rot = m.rot || 0;
    const oppLocal = rot2(-hx * m.w / 2, -hy * m.h / 2, rot); // the mirrored corner/edge stays fixed
    pushHistory();
    drag.current = { mode: "mkResize", id, hx, hy, rot, opp: { x: m.cx + oppLocal.x, y: m.cy + oppLocal.y } };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startMarkupRotate = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const m = markups.find((x) => x.id === id);
    if (!m || m.locked) return;
    const fp = p2f(e.clientX, e.clientY), pivot = { x: m.cx, y: m.cy };
    pushHistory();
    drag.current = { mode: "mkRotate", id, pivot, rot0: m.rot || 0, a0: Math.atan2(fp.y - pivot.y, fp.x - pivot.x) };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  const onMove = (e) => {
    altSnapOffRef.current = !!e.altKey; // hold Alt to bypass snap for this drag (re-armed each move); read by snap()/snapPt() below
    const fp = p2f(e.clientX, e.clientY);
    setCursor(fp);
    if (roadStart && tool === "road" && roadWidth !== "free") { // live fixed-width road preview
      const B = snapPt(fp), A = roadStart, curb = +settings.roadCurb || CURB;
      setDraftRoad({ ax: A.x, ay: A.y, bx: B.x, by: B.y, cross: +roadWidth + 2 * curb });
    }
    const d = drag.current;
    if (!d) return;
    const snapOn = settings.snap && !altSnapOffRef.current; // effective snap for this frame: global toggle minus a held-Alt bypass

    if (d.mode === "dimMove") { // B146: drag a selected element's dimension callout to reposition it
      const loc = rot2(fp.x - d.start.x, fp.y - d.start.y, -d.rot); // world pointer delta → element-local frame
      setEls((a) => a.map((x) => x.id === d.id ? { ...x, dimOffset: { x: d.base.x + loc.x, y: d.base.y + loc.y } } : x));
      return;
    }
    if (d.mode === "pan") {
      setView((v) => ({ ...v, offX: d.ox + (e.clientX - d.sx), offY: d.oy + (e.clientY - d.sy) }));
      return;
    }
    if (d.mode === "moveUnderlay") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      setUnderlay((u) => (u ? { ...u, x: d.ox + dx, y: d.oy + dy } : u));
      return;
    }
    if (d.mode === "moveSheetOverlay") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      setSheetOverlays((arr) => arr.map((o) => (o.id === d.id ? { ...o, x: d.ox + dx, y: d.oy + dy } : o)));
      return;
    }
    if (d.mode === "ovScale") { // corner handle: uniform scale about the (fixed) center
      const ftPerPx = Math.max(0.001, d.ftPerPx0 * (Math.hypot(fp.x - d.C.x, fp.y - d.C.y) / d.grabDist));
      const W = d.imgW * ftPerPx, H = d.imgH * ftPerPx;
      setSheetOverlays((arr) => arr.map((o) => (o.id === d.id ? { ...o, ftPerPx, x: d.C.x - W / 2, y: d.C.y - H / 2 } : o)));
      return;
    }
    if (d.mode === "ovRotate") { // rotate handle: rotate about the center
      const rotation = (((d.rot0 + (Math.atan2(fp.y - d.C.y, fp.x - d.C.x) - d.a0) * 180 / Math.PI) % 360) + 360) % 360;
      setSheetOverlays((arr) => arr.map((o) => (o.id === d.id ? { ...o, rotation } : o)));
      return;
    }
    if (d.mode === "printMove") { setPrintFrame((f) => f ? { ...f, cx: d.cx + (fp.x - d.fx), cy: d.cy + (fp.y - d.fy) } : f); return; }
    if (d.mode === "printResize") {
      const aspect = printAspect();
      const wFt = Math.max(Math.abs(fp.x - d.opp.x), Math.abs(fp.y - d.opp.y) * aspect, 40);
      const hFt = wFt / aspect;
      setPrintFrame({ cx: d.opp.x + d.sx * wFt / 2, cy: d.opp.y + d.sy * hFt / 2, wFt, hFt });
      return;
    }
    if (d.mode === "marquee") { setMarquee({ a: d.a, b: fp }); return; }
    if (d.mode === "groupMove") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      const eids = new Set(d.orig.els.map((o) => o.id)), mids = new Set(d.orig.markups.map((o) => o.id));
      setEls((a) => a.map((el) => { if (!eids.has(el.id)) return el; const o = d.orig.els.find((x) => x.id === el.id); return o.points ? { ...el, points: o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : { ...el, cx: o.cx + dx, cy: o.cy + dy }; }));
      setMarkups((a) => a.map((m) => { if (!mids.has(m.id)) return m; const o = d.orig.markups.find((x) => x.id === m.id); return translateMarkup(o, dx, dy); }));
      return;
    }
    if (d.mode === "mkDraw") {
      let b = snapPt(fp);
      if (e.shiftKey) {
        if (d.kind === "mline") b = snapPt(snap45(d.a, fp));
        else { const s = Math.max(Math.abs(b.x - d.a.x), Math.abs(b.y - d.a.y)); b = { x: d.a.x + Math.sign(b.x - d.a.x || 1) * s, y: d.a.y + Math.sign(b.y - d.a.y || 1) * s }; } // square/circle
      }
      setMkRect({ kind: d.kind, a: d.a, b });
      return;
    }
    if (d.mode === "mkMove") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      setMarkups((a) => a.map((m) => m.id === d.id ? translateMarkup(d.orig, dx, dy) : m));
      return;
    }
    if (d.mode === "mkVertex") { // drag a line/polyline/polygon control point
      const sp = snapPt(fp);
      setMarkups((a) => a.map((m) => m.id === d.id ? setMkPts(m, mkPts(m).map((p, j) => (j === d.index ? sp : p))) : m));
      return;
    }
    if (d.mode === "easeVertex") { // drag an easement's centerline/boundary vertex → re-offset the strip
      const sp = snapPt(fp);
      setMarkups((a) => a.map((m) => m.id === d.id ? setEasePath(m, easeEditPath(m).map((p, j) => (j === d.index ? sp : p))) : m));
      return;
    }
    if (d.mode === "mkResize") { // resize a rect/ellipse in its own (rotated) frame; opposite side fixed
      const local = rot2(fp.x - d.opp.x, fp.y - d.opp.y, -d.rot);
      const snapDim = (v) => Math.max(1, snapOn ? Math.round(Math.abs(v) / settings.gridSize) * settings.gridSize : Math.round(Math.abs(v)));
      setMarkups((a) => a.map((m) => {
        if (m.id !== d.id) return m;
        const nw = d.hx !== 0 ? snapDim(local.x) : m.w;
        const nh = d.hy !== 0 ? snapDim(local.y) : m.h;
        const half = rot2(d.hx * nw, d.hy * nh, d.rot);
        return { ...m, w: nw, h: nh, cx: d.opp.x + half.x / 2, cy: d.opp.y + half.y / 2 };
      }));
      return;
    }
    if (d.mode === "mkRotate") { // rotate a rect/ellipse about its center (15° steps when snap is on)
      let rot = d.rot0 + (Math.atan2(fp.y - d.pivot.y, fp.x - d.pivot.x) - d.a0) * 180 / Math.PI;
      rot = snapOn ? Math.round(rot / 15) * 15 : Math.round(rot);
      setMarkups((a) => a.map((m) => m.id === d.id ? { ...m, rot: ((rot % 360) + 360) % 360 } : m));
      return;
    }
    if (d.mode === "callout") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      if (d.part === "tip") setCallout(d.id, { tip: { x: d.tip0.x + dx, y: d.tip0.y + dy } });
      else setCallout(d.id, { box: { x: d.box0.x + dx, y: d.box0.y + dy } });
      return;
    }
    if (d.mode === "draw") {
      const sp = snapPt(fp);
      if (d.depth) { // parking preset: lock the depth, drag sets length & direction
        const dx = sp.x - d.ox, dy = sp.y - d.oy, depth = d.depth;
        const horizontal = Math.abs(dx) >= Math.abs(dy);
        const len = Math.max(0, horizontal ? Math.abs(dx) : Math.abs(dy));
        const x = horizontal ? (dx >= 0 ? d.ox : d.ox - len) : (dx >= 0 ? d.ox : d.ox - depth);
        const y = horizontal ? (dy >= 0 ? d.oy : d.oy - depth) : (dy >= 0 ? d.oy : d.oy - len);
        setDraftRect({ type: d.type, x, y, w: horizontal ? len : depth, h: horizontal ? depth : len, parkLen: len, parkDepth: depth, parkRot: horizontal ? 0 : 90 });
        return;
      }
      const x = Math.min(d.ox, sp.x), y = Math.min(d.oy, sp.y);
      setDraftRect({ type: d.type, x, y, w: Math.abs(sp.x - d.ox), h: Math.abs(sp.y - d.oy) });
      return;
    }
    if (d.mode === "move") {
      const dx = fp.x - d.fx, dy = fp.y - d.fy;
      const shift = e.shiftKey; // live — works whether Shift is held before or mid-drag
      if (d.kind === "el") {
        // Snap based on the grabbed element, then shift the whole assembly by that delta.
        const g = d.members.find((m) => m.id === d.id);
        let effDx, effDy, hint = null, newRot = null;
        const gel = els.find((x) => x.id === d.id);
        const gbox = ortho(gel); // effective box (handles 90/180/270)
        if (g.cx !== undefined) {
          let ncx = snap(g.cx + dx), ncy = snap(g.cy + dy);
          const ids = new Set(d.members.map((m) => m.id));
          if (shift && d.canAttach && !gel.points) {
            // Shift: align to a nearby host's angle and snap flush in its frame
            const cands = els.filter((x) => !ids.has(x.id) && !x.points && rootIdOf(x.id) !== d.id);
            const res = alignSnap(gel, ncx, ncy, cands, Math.min(40, 24 / view.ppf));
            if (res) { ncx = res.cx; ncy = res.cy; newRot = res.rot; hint = { id: res.hostId, x: res.hintX, y: res.hintY }; }
          } else if (snapOn && gbox) { // ambient flush-snap along world axes (does NOT bond)
            const others = els.filter((x) => !ids.has(x.id)).map(ortho).filter(Boolean);
            const sc = edgeSnapCenter({ cx: ncx, cy: ncy, w: gbox.w, h: gbox.h }, others, Math.min(20, 10 / view.ppf));
            ncx = sc.cx; ncy = sc.cy;
          }
          effDx = ncx - g.cx; effDy = ncy - g.cy;
        } else {
          effDx = snap(g.points[0].x + dx) - g.points[0].x;
          effDy = snap(g.points[0].y + dy) - g.points[0].y;
        }
        d.bondTarget = hint ? hint.id : null; // remember for the drop (els may lag a frame)
        d.bondRot = newRot; // remember the aligned angle for the drop
        setEls((a) => a.map((el) => {
          const m = d.members.find((x) => x.id === el.id);
          if (!m) return el;
          if (m.points) return { ...el, points: m.points.map((p) => ({ x: p.x + effDx, y: p.y + effDy })) };
          const moved = { ...el, cx: m.cx + effDx, cy: m.cy + effDy };
          if (newRot != null && el.id === d.id) moved.rot = newRot; // align to host angle
          return moved;
        }));
        setAttachHint(hint ? { x: hint.x, y: hint.y } : null);
      } else {
        setParcels((a) => a.map((pc) => pc.id === d.id ? { ...pc, points: d.opts.map((p) => ({ x: snap(p.x + dx), y: snap(p.y + dy) })) } : pc));
      }
      return;
    }
    if (d.mode === "vertex") {
      const sp = snapPt(fp);
      setParcels((a) => a.map((pc) => pc.id === d.id
        ? { ...pc, points: pc.points.map((p, i) => (i === d.index ? sp : p)) } : pc));
      return;
    }
    if (d.mode === "elVertex") {
      const sp = snapPt(fp);
      setEls((a) => a.map((x) => x.id === d.id && x.points
        ? { ...x, points: x.points.map((p, i) => (i === d.index ? sp : p)) } : x));
      return;
    }
    if (d.mode === "measureVertex") { // B141: drag a measurement control point
      const sp = snapPt(fp);
      setMeasures((arr) => arr.map((mm, k) => k === d.i
        ? { ...mm, mode: measMode(mm), pts: measPts(mm).map((p, j) => (j === d.index ? sp : p)) } : mm));
      return;
    }
    if (d.mode === "resize") {
      const el = els.find((x) => x.id === d.id);
      if (!el) return;
      const opp = d.opp; // fixed opposite corner (world feet)
      const local = rot2(fp.x - opp.x, fp.y - opp.y, -el.rot);
      // Roads resize in 1′ increments (not the grid step) so a width dials to the exact foot.
      const snapTo = (v) => el.type === "road" ? Math.max(1, Math.round(v)) : Math.max(settings.gridSize, snapOn ? Math.round(v / settings.gridSize) * settings.gridSize : Math.round(v));
      let nw = snapTo(Math.abs(local.x)), nh = snapTo(Math.abs(local.y));
      // opposite stays fixed; new center is the midpoint of opp and the dragged corner
      const half = rot2(d.sx * nw, d.sy * nh, el.rot);
      const newCenter = { x: opp.x + half.x / 2, y: opp.y + half.y / 2 };
      const nb = { cx: newCenter.x, cy: newCenter.y, w: nw, h: nh, rot: el.rot };
      if (d.hostClamp) clampToHost(nb, d.hostClamp); // grow away from the host building
      setEls((a) => applySwShift(refitChildren(a, d.id, nb, d.kids), d.swShift, nb));
      return;
    }
    if (d.mode === "edgeResize") {
      // Drag one side; the opposite side stays put (only that dimension changes).
      const el = els.find((x) => x.id === d.id);
      if (!el) return;
      const { nx, ny, opp } = d; // outward local normal of the dragged edge
      const local = rot2(fp.x - opp.x, fp.y - opp.y, -el.rot);
      const snapDim = (v) => el.type === "road" ? Math.max(1, Math.round(Math.abs(v))) : Math.max(settings.gridSize, snapOn ? Math.round(Math.abs(v) / settings.gridSize) * settings.gridSize : Math.round(Math.abs(v)));
      const nw = nx !== 0 ? snapDim(local.x) : el.w;
      const nh = ny !== 0 ? snapDim(local.y) : el.h;
      const half = rot2(nx * nw, ny * nh, el.rot);
      const newCenter = { x: opp.x + half.x / 2, y: opp.y + half.y / 2 };
      const nb = { cx: newCenter.x, cy: newCenter.y, w: nw, h: nh, rot: el.rot };
      if (d.hostClamp) clampToHost(nb, d.hostClamp); // grow away from the host building
      setEls((a) => applySwShift(refitChildren(a, d.id, nb, d.kids), d.swShift, nb));
      return;
    }
    if (d.mode === "rotate") {
      const cur = (Math.atan2(fp.y - d.pivot.y, fp.x - d.pivot.x) * 180) / Math.PI;
      let delta = cur - d.startPtr;
      const prim = d.start.find((s) => s.id === d.id);
      if (prim && prim.rot !== undefined) { // snap the grabbed element to 15°, carry the rest along
        let target = prim.rot + delta;
        target = snapOn ? Math.round(target / 15) * 15 : Math.round(target);
        delta = target - prim.rot;
      }
      setEls((a) => a.map((el) => {
        const s = d.start.find((x) => x.id === el.id);
        if (!s) return el;
        if (s.points) return { ...el, points: s.points.map((p) => { const r = rot2(p.x - d.pivot.x, p.y - d.pivot.y, delta); return { x: d.pivot.x + r.x, y: d.pivot.y + r.y }; }) };
        const r = rot2(s.cx - d.pivot.x, s.cy - d.pivot.y, delta);
        return { ...el, cx: d.pivot.x + r.x, cy: d.pivot.y + r.y, rot: ((s.rot + delta) % 360 + 360) % 360 };
      }));
      return;
    }
  };

  // Feet-space bbox of any element / markup (for marquee hit-testing).
  const featBBox = (o) => {
    let pts = null;
    if (o.points) pts = o.points;
    else if (o.a && o.b) pts = [o.a, o.b];
    else if (o.pts) pts = o.pts;
    else if (o.w != null) { const hw = o.w / 2, hh = o.h / 2; pts = [{ x: o.cx - hw, y: o.cy - hh }, { x: o.cx + hw, y: o.cy + hh }]; }
    if (!pts || !pts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { x0, y0, x1, y1 };
  };
  const onUp = (e) => {
    const d = drag.current;
    if (d && d.mode === "marquee") {
      const mx0 = Math.min(d.a.x, marquee?.b.x ?? d.a.x), mx1 = Math.max(d.a.x, marquee?.b.x ?? d.a.x);
      const my0 = Math.min(d.a.y, marquee?.b.y ?? d.a.y), my1 = Math.max(d.a.y, marquee?.b.y ?? d.a.y);
      const hit = (o) => { const b = featBBox(o); return b && b.x0 <= mx1 && b.x1 >= mx0 && b.y0 <= my1 && b.y1 >= my0; };
      const picked = [
        ...els.filter((el) => !el.attachedTo && !el.dogEar && hit(el)).map((el) => ({ kind: "el", id: el.id })),
        ...markups.filter((m) => hit(m)).map((m) => ({ kind: "markup", id: m.id })),
      ];
      setMulti(picked);
      setSel(picked.length === 1 ? picked[0] : null);
      setMarquee(null); drag.current = null;
      try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (d && d.mode === "groupMove") { drag.current = null; try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {} return; }
    if (d && d.mode === "mkDraw" && mkRect) {
      const { a, b, kind } = mkRect;
      let mk = null;
      const minFt = 3 / view.ppf; // a deliberate ~3px drag, regardless of zoom — feet-based mins silently dropped real markups when zoomed in (B30)
      if (kind === "mline") { if (dist(a, b) >= minFt) mk = { id: uid(), kind: "line", a, b, ...mkStyle }; }
      else { const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2, w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
        if (w >= minFt && h >= minFt) mk = { id: uid(), kind: kind === "mrect" ? "rect" : "ellipse", cx, cy, w, h, rot: 0, ...mkStyle }; }
      if (mk) { pushHistory(); setMarkups((arr) => [...arr, mk]); setSel({ kind: "markup", id: mk.id }); setTool("select"); }
      setMkRect(null); drag.current = null; setPanning(false);
      try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (d && d.mode === "draw" && draftRect) {
      if (d.depth) {
        // fixed-width preset (parking rows / road width): a length×depth strip,
        // rotated for a vertical drag.
        if (draftRect.parkLen >= 4) {
          const curb = +settings.roadCurb || CURB;
          const roadExtra = d.type === "road" ? { travelW: Math.max(0, draftRect.parkDepth - 2 * curb), curb } : {};
          const el = { id: uid(), type: d.type, cx: draftRect.x + draftRect.w / 2, cy: draftRect.y + draftRect.h / 2, w: draftRect.parkLen, h: draftRect.parkDepth, rot: draftRect.parkRot, ...roadExtra };
          setEls((a) => [...a, el]);
          setSel({ kind: "el", id: el.id });
          setTool("select");
        }
      } else if (draftRect.w >= 4 && draftRect.h >= 4) {
        const curb = +settings.roadCurb || CURB;
        const roadExtra = draftRect.type === "road" ? { travelW: Math.max(0, Math.min(draftRect.w, draftRect.h) - 2 * curb), curb } : {};
        const buildingExtra = draftRect.type === "building" ? { dock: buildingDock, dockSide: draftRect.w >= draftRect.h ? "bottom" : "right" } : {};
        // B130: a free-drawn parking field runs its stall rows along the LONGER edge.
        // carStalls treats w as row-length and h as depth, so when the drawn box is
        // deeper than it is long, swap the two and rotate 90° — identical footprint on
        // screen, but the rows (and the double-loaded modules) lie along the long side.
        let w = draftRect.w, h = draftRect.h, rot = 0;
        if (draftRect.type === "parking" && h > w) { w = draftRect.h; h = draftRect.w; rot = 90; }
        const el = { id: uid(), type: draftRect.type, cx: draftRect.x + draftRect.w / 2, cy: draftRect.y + draftRect.h / 2, w, h, rot, ...roadExtra, ...buildingExtra };
        setEls((a) => [...a, el]);
        setSel({ kind: "el", id: el.id });
        setTool("select"); // one element per click — drop back to Select
      } else {
        // a click (no drag) → begin a polygon element by dropping perimeter points
        setDraftElPoly({ type: draftRect.type, pts: [{ x: draftRect.x, y: draftRect.y }] });
      }
      setDraftRect(null);
    }
    // Bond on drop: if a flush bond target was found during the drag (Shift held,
    // or Snap on), attach so they move together. Alt drops it free.
    if (d && d.mode === "move" && d.kind === "el" && d.canAttach && d.bondTarget && !e.altKey) {
      const root = rootIdOf(d.bondTarget);
      if (root !== d.id) setEls((a) => a.map((x) => x.id === d.id ? { ...x, attachedTo: root, ...(d.bondRot != null ? { rot: d.bondRot } : {}) } : x));
    }
    setAttachHint(null);
    drag.current = null;
    setPanning(false);
    try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {}
  };

  const closePoly = () => {
    if (draftPoly && draftPoly.length >= 3) {
      pushHistory();
      const pc = { id: uid(), points: draftPoly, locked: true };
      setParcels((a) => [...a, pc]);
      flashPolyWarn(draftPoly, "Parcel");
      requestFit();
    }
    setDraftPoly(null);
    setTool("select");
  };
  const closeElPoly = () => {
    if (draftElPoly && draftElPoly.pts.length >= 3) {
      const el = { id: uid(), type: draftElPoly.type, points: draftElPoly.pts, rot: 0 };
      setEls((a) => [...a, el]);
      setSel({ kind: "el", id: el.id });
      flashPolyWarn(draftElPoly.pts, "Element");
    }
    setDraftElPoly(null);
    setTool("select");
  };
  // One shared completion path for EVERY multi-point tool, used by BOTH Enter and double-click,
  // so "finish / auto-close" behaves identically everywhere. Each finisher guards its own minimum
  // point count, so this no-ops (rather than cancelling the draft) when there aren't enough yet.
  const finishActiveDrawing = () => {
    if (traceMode && tracePts.length >= 2) { commitTrace(); return true; }
    if (tool === "split" && splitPath.length >= 2) { finishSplit(); return true; }
    if (tool === "measure" && measDraft.length >= (measureMode === "area" ? 3 : 2)) { finishMeasure(); return true; }
    if (tool === "mpolyline" && mkPoly?.pts?.length >= 2) { finishMkPoly(); return true; }
    if (tool === "mpolygon" && mkPoly?.pts?.length >= 3) { finishMkPoly(); return true; }
    if (tool === "parcel" && draftPoly?.length >= 3) { closePoly(); return true; }
    if (draftElPoly?.pts?.length >= 3) { closeElPoly(); return true; } // any area element drawn as a polygon
    if (tool === "easement" && easeMode === "parceledge" && easeEdges?.idx?.length) { finishEaseEdges(); return true; }
    if (tool === "easement" && easeDraft?.pts?.length >= (easeMode === "boundary" ? 3 : 2)) { finishEaseDraft(); return true; }
    return false;
  };
  // Remove the last placed vertex of whatever multi-point shape is in progress (Backspace/Delete);
  // empties a polygon draft to null so it's fully cancelled once the last point is gone.
  const removeLastVertex = () => {
    if (traceMode && tracePts.length) { setTracePts((a) => a.slice(0, -1)); return true; }
    if (tool === "split" && splitPath.length) { setSplitPath((a) => a.slice(0, -1)); return true; }
    if (tool === "measure" && measDraft.length) { setMeasDraft((a) => a.slice(0, -1)); return true; }
    if (mkPoly?.pts?.length) { setMkPoly((m) => { const pts = m.pts.slice(0, -1); return pts.length ? { ...m, pts } : null; }); return true; }
    if (draftPoly?.length) { setDraftPoly((a) => { const n = a.slice(0, -1); return n.length ? n : null; }); return true; }
    if (draftElPoly?.pts?.length) { setDraftElPoly((d) => { const pts = d.pts.slice(0, -1); return pts.length ? { ...d, pts } : null; }); return true; }
    if (easeDraft?.pts?.length) { setEaseDraft((d) => { const pts = d.pts.slice(0, -1); return pts.length ? { pts } : null; }); return true; }
    return false;
  };
  // Double-click finishes exactly the way Enter does (the shared path above).
  const onBgDouble = () => { finishActiveDrawing(); };

  const addRectParcel = () => {
    const w = Math.max(20, +lotW || 0), d = Math.max(20, +lotD || 0);
    pushHistory();
    const pc = { id: uid(), points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }], locked: true };
    setParcels((a) => [...a, pc]);
    requestFit();
  };

  /* ------------ aerial underlay ------------ */
  const onUnderlayFile = async (file) => {
    if (!file) return;
    try {
      const { src, w, h } = await loadAndDownscaleImage(file);
      pushHistory();
      // Start at ~600 ft across the image width; the user calibrates precisely next.
      // Auto-locked (click-through) so you can immediately draw over it.
      setUnderlay({ src, imgW: w, imgH: h, x: 0, y: 0, ftPerPx: 600 / w, opacity: 1, locked: true });
      setUnderlayErr(false);
      setUnderlayLoading(true);
      setCalib(null);
      requestFit();
    } catch (err) {
      alert(humanizeError(err));
    }
  };
  const startMoveUnderlay = (e) => {
    if (tool !== "select" || e.button !== 0 || !underlay || underlay.locked) return;
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    setSel(null);
    pushHistory();
    drag.current = { mode: "moveUnderlay", fx: fp.x, fy: fp.y, ox: underlay.x, oy: underlay.y };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const applyCalibration = () => {
    const knownFt = +calibInput;
    if (!underlay || !calib?.a || !calib?.b || !(knownFt > 0) || !(underlay.ftPerPx > 0)) return;
    // A map-sourced underlay is already georeferenced and its two axes can legitimately
    // differ (ftPerPx ≠ ftPerPxY at this latitude); a single diagonal-derived scalar
    // would mis-size it, so calibration is disabled for from-map underlays (B57a).
    if (underlay.fromMap) {
      flashWarn("This underlay came from the map — it's already to scale, so manual calibration is disabled for it.", 5000);
      setCalib(null);
      return;
    }
    const measured = dist(calib.a, calib.b);
    if (measured <= 0) return;
    const factor = knownFt / measured;
    const sy = underlay.ftPerPxY || underlay.ftPerPx;
    const newFtPerPx = underlay.ftPerPx * factor;
    const newSy = sy * factor;
    // image-pixel coords of point a under the current placement
    const aPxX = (calib.a.x - underlay.x) / underlay.ftPerPx;
    const aPxY = (calib.a.y - underlay.y) / sy;
    pushHistory();
    // keep point a pinned in world space so the image scales about that point
    setUnderlay((u) => ({ ...u, ftPerPx: newFtPerPx, ftPerPxY: u.ftPerPxY ? newSy : undefined, x: calib.a.x - aPxX * newFtPerPx, y: calib.a.y - aPxY * newSy, calibrated: true }));
    setCalib(null);
    setCalibInput("");
    setTool("select");
  };

  /* ------------ site-plan overlays (B72) ------------ */
  // Add a dropped PDF/image as a backdrop overlay, placed ~60% of the view wide and
  // centered on what the user is currently looking at (true scale comes in B73).
  const addOverlayFile = async (file) => {
    if (!file) return;
    setOverlayBusy(true);
    try {
      const r = await openOverlayFile(file); // {src,imgW,imgH,page,pageCount,pdf,detectedScale,sheet}
      const id = uid();
      if (r.pdf) overlayDocs.current.set(id, r.pdf); // keep the doc for the in-session page picker
      const c = p2fStatic(size.w / 2, size.h / 2);   // view centre, in feet
      // True real-world scale ONLY when the page is a recognizable plot size AND we read
      // a scale note (B73); otherwise land it ~60% of the visible width wide to size by hand.
      const trueScale = r.detectedScale && r.sheet && r.sheet.std;
      const ftPerPx = trueScale
        ? ftPerPointForScale(r.detectedScale)
        : Math.max(0.01, ((size.w / view.ppf) * 0.6) / Math.max(1, r.imgW));
      const ov = {
        id, name: file.name || "Site plan", src: r.src, imgW: r.imgW, imgH: r.imgH,
        page: r.page || 1, pageCount: r.pageCount || 1,
        x: c.x - (r.imgW * ftPerPx) / 2, y: c.y - (r.imgH * ftPerPx) / 2,
        ftPerPx, rotation: 0, opacity: 0.85, locked: false,
        detectedScale: r.detectedScale || null, sheet: r.sheet || null,
      };
      pushHistory();
      setSheetOverlays((arr) => [...arr, ov]);
      setSel(null); setSelOverlay(id); setLeftPanel("overlay");
      if (isCloudActive()) { // back the source (PDF or image) up to Storage for cross-device reload (B72)
        uploadOverlayFile(siteId, id, file).then((res) => {
          if (res) setSheetOverlays((arr) => arr.map((x) => (x.id === id ? { ...x, storageKey: res.key } : x)));
        }).catch(() => {});
      }
    } catch (err) {
      alert(humanizeError(err));
    } finally {
      setOverlayBusy(false);
    }
  };
  const startMoveSheetOverlay = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    const o = sheetOverlays.find((x) => x.id === id);
    if (!o || o.locked) return;
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    setSel(null); setSelOverlay(id);
    pushHistory();
    drag.current = { mode: "moveSheetOverlay", id, fx: fp.x, fy: fp.y, ox: o.x, oy: o.y };
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
  };
  // On-canvas resize (corner) + rotate handles for the selected overlay (B72 — completes
  // the original spec). Both scale/rotate about the overlay center so they compose with any
  // existing rotation; the panel sliders remain as an alternative.
  const startScaleOverlay = (e, id) => {
    if (e.button !== 0) return;
    const o = sheetOverlays.find((x) => x.id === id);
    if (!o || o.locked) return;
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    const C = { x: o.x + (o.imgW * o.ftPerPx) / 2, y: o.y + (o.imgH * o.ftPerPx) / 2 };
    setSel(null); setSelOverlay(id);
    pushHistory();
    drag.current = { mode: "ovScale", id, C, grabDist: Math.max(1e-6, Math.hypot(fp.x - C.x, fp.y - C.y)), ftPerPx0: o.ftPerPx, imgW: o.imgW, imgH: o.imgH };
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
  };
  const startRotateOverlay = (e, id) => {
    if (e.button !== 0) return;
    const o = sheetOverlays.find((x) => x.id === id);
    if (!o || o.locked) return;
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    const C = { x: o.x + (o.imgW * o.ftPerPx) / 2, y: o.y + (o.imgH * o.ftPerPx) / 2 };
    setSel(null); setSelOverlay(id);
    pushHistory();
    drag.current = { mode: "ovRotate", id, C, a0: Math.atan2(fp.y - C.y, fp.x - C.x), rot0: o.rotation || 0 };
    try { svgRef.current.setPointerCapture(e.pointerId); } catch (_) {}
  };
  // Patch one overlay; `hist` gates an undo frame (off for continuous slider drags).
  const patchOverlay = (id, patch, hist = true) => {
    if (hist) pushHistory();
    setSheetOverlays((arr) => arr.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  };
  const removeOverlay = (id) => {
    pushHistory();
    const doc = overlayDocs.current.get(id);
    if (doc) { try { doc.destroy(); } catch (_) {} overlayDocs.current.delete(id); }
    const o = sheetOverlays.find((x) => x.id === id);
    if (o && o.storageKey) deleteOverlayObject(o.storageKey); // clean up the cloud copy (B72 polish)
    setSheetOverlays((arr) => arr.filter((o) => o.id !== id));
    setSelOverlay((s) => (s === id ? null : s));
  };
  // Re-rasterize a different page (only while the source doc is still in memory).
  const setOverlayPage = async (id, page) => {
    const doc = overlayDocs.current.get(id);
    if (!doc) return;
    try {
      const r = await rasterizePage(doc, page);
      patchOverlay(id, { src: r.src, imgW: r.imgW, imgH: r.imgH, page: r.page });
    } catch (_) { /* ignore a bad page render */ }
  };
  // B73 — apply a drawing scale (feet per inch) to an overlay: ftPerPx = S/72 (points),
  // keeping it centered so it scales in place to true real-world size.
  const applyOverlayScale = (id, feetPerInch) => {
    const S = +feetPerInch;
    if (!(S > 0)) return;
    pushHistory();
    setSheetOverlays((arr) => arr.map((o) => {
      if (o.id !== id) return o;
      const cx = o.x + (o.imgW * o.ftPerPx) / 2, cy = o.y + (o.imgH * o.ftPerPx) / 2;
      const ftPerPx = ftPerPointForScale(S);
      return { ...o, ftPerPx, x: cx - (o.imgW * ftPerPx) / 2, y: cy - (o.imgH * ftPerPx) / 2 };
    }));
  };
  // Which scale-dropdown option matches an overlay's current size (else "custom").
  const overlayScaleSel = (o) => { const s = Math.round(scaleForFtPerPoint(o.ftPerPx)); return COMMON_SCALES.includes(s) ? String(s) : "custom"; };
  // B73 fallbacks — calibrate by clicking the canvas. trace: 2 points on the drawing +
  // a real length → rescale (pinned at the first click). align: 2 points on the drawing
  // then the 2 matching points on the map → similarity (move + rotate + scale).
  const onOvCalibClick = (fp) => {
    const o = sheetOverlays.find((x) => x.id === ovCalib.id);
    if (!o) { setOvCalib(null); return; }
    const pts = [...ovCalib.pts, fp];
    if (ovCalib.kind === "trace") {
      if (pts.length < 2) { setOvCalib({ ...ovCalib, pts }); return; }
      const measuredFt = dist(pts[0], pts[1]);
      setOvCalib(null);
      setNumEdit({ fx: pts[1].x, fy: pts[1].y, value: "", onCommit: (realFt) => {
        const patch = realFt > 0 && measuredFt > 0 ? scaleOverlayAbout(o, pts[0], realFt / measuredFt) : null;
        if (!patch) return;
        pushHistory();
        setSheetOverlays((arr) => arr.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
      } });
    } else {
      // align: collect alternating drawing→map points (pairs); apply on demand (≥2 pairs)
      setOvCalib({ ...ovCalib, pts });
    }
  };
  // Apply the collected drawing→map pairs as a best-fit similarity (B73). 2 pairs = exact;
  // 3+ = least-squares, with an RMS residual shown so a poor (distorted) fit is visible.
  const applyOvAlign = () => {
    if (!ovCalib || ovCalib.kind !== "align") return;
    const o = sheetOverlays.find((x) => x.id === ovCalib.id);
    const nPairs = Math.floor(ovCalib.pts.length / 2);
    if (!o || nPairs < 2) return;
    const pairs = [];
    for (let i = 0; i < nPairs; i++) pairs.push({ from: ovCalib.pts[2 * i], to: ovCalib.pts[2 * i + 1] });
    const S = solveSimilarityLSQ(pairs);
    const patch = applySimilarityToOverlay(o, S);
    setOvCalib(null);
    if (!patch) return;
    pushHistory();
    setSheetOverlays((arr) => arr.map((x) => (x.id === o.id ? { ...x, ...patch } : x)));
    flashWarn(`Aligned to ${nPairs} point${nPairs > 1 ? "s" : ""} — fit residual ≈ ${Math.round(S.residual)}′.`, 5000);
  };
  const ovCalibMsg = () => {
    if (!ovCalib) return "";
    const n = ovCalib.pts.length;
    if (ovCalib.kind === "trace") return n === 0 ? "Click one end of a known dimension on the drawing." : "Click the other end — then enter its real length.";
    const pairNo = Math.floor(n / 2) + 1;
    return n % 2 === 0 ? `Click a known point on the drawing (point ${pairNo}).` : "Now click where that point belongs on the map.";
  };
  // Free any held PDF docs when the planner unmounts (cf. B39).
  useEffect(() => () => { overlayDocs.current.forEach((d) => { try { d.destroy(); } catch (_) {} }); overlayDocs.current.clear(); }, []);
  // Cross-device reload (B72): an overlay that synced only its transform (raster stripped
  // from the cloud row) but kept a Storage key → fetch the original PDF and re-rasterize.
  useEffect(() => {
    const missing = sheetOverlays.filter((o) => o.storageKey && !o.src && !overlayFetching.current.has(o.id));
    if (!missing.length) return;
    let cancelled = false;
    missing.forEach((o) => overlayFetching.current.add(o.id));
    (async () => {
      for (const o of missing) {
        try {
          if ((o.storageKey || "").toLowerCase().endsWith(".pdf")) { // PDF: re-rasterize the stored page
            const bytes = await downloadOverlayBytes(o.storageKey);
            const r = bytes ? await rasterizeStoredPdf(bytes, o.page || 1) : null;
            if (!cancelled && r) setSheetOverlays((arr) => arr.map((x) => (x.id === o.id ? { ...x, src: r.src, imgW: r.imgW, imgH: r.imgH, pageCount: r.pageCount } : x)));
          } else { // image: its raster IS the source — restore the src directly (dims already known)
            const src = await downloadOverlayDataUrl(o.storageKey);
            if (!cancelled && src) setSheetOverlays((arr) => arr.map((x) => (x.id === o.id ? { ...x, src } : x)));
          }
        } finally { overlayFetching.current.delete(o.id); }
      }
    })();
    return () => { cancelled = true; };
  }, [sheetOverlays]); // eslint-disable-line

  /* ------------ county parcel lookup ------------ */
  const onCountyChange = (key) => {
    setCounty(key);
    const c = COUNTIES[key];
    setLookupUrl(c.layerUrl || c.serviceUrl || "");
    setLookupRes([]);
    setLookupErr("");
  };
  const runLookup = async () => {
    setLookupErr(""); setLookupRes([]);
    const v = searchVal.trim();
    if (!v) { setLookupErr("Type an account number or address to search."); return; }
    setLookupBusy(true);
    try {
      const layerUrl = await resolveLayerUrl(lookupUrl.trim());
      const meta = await getLayerInfo(layerUrl);
      const idField = detectField(meta.fields, "id") || COUNTIES[county]?.idField;
      const addrField = detectField(meta.fields, "address") || COUNTIES[county]?.addrField;
      // The field NAME gets interpolated into the where-clause and comes from live (or a
      // user-pasted) layer's metadata — reject anything that isn't a plain identifier so a
      // hostile/compromised endpoint can't inject SQL that escapes the county scope (B47).
      const okField = (f) => /^[A-Za-z0-9_.]+$/.test(f || "");
      if (idField && !okField(idField)) throw new Error("Unexpected parcel-ID field name on this layer.");
      if (addrField && !okField(addrField)) throw new Error("Unexpected address field name on this layer.");
      const esc = v.replace(/'/g, "''");
      let where;
      if (searchMode === "id") {
        if (!idField) throw new Error("No account/parcel-id field on this layer — try an address search.");
        const fld = meta.fields.find((f) => f.name === idField);
        const numeric = fld && /integer|double|single|oid|smallinteger/i.test(fld.type);
        where = numeric && /^\d+$/.test(v) ? `${idField} = ${v}` : `UPPER(${idField}) LIKE UPPER('%${esc}%')`;
      } else {
        if (!addrField) throw new Error("No address field on this layer — try an account/ID search.");
        where = `UPPER(${addrField}) LIKE UPPER('%${esc}%')`;
      }
      // Statewide services (Chambers rides TxGIO's all-Texas parcel layer) need a county
      // scope, or an ID/address search could match a like-named/numbered parcel in another
      // county. Apply it only when the scope's field actually exists on this layer, so a
      // single-county override URL pasted in the box is left untouched (self-healing).
      const scope = COUNTIES[county]?.scopeWhere;
      if (scope) {
        const scopeField = scope.split("=")[0].trim().toLowerCase();
        if (meta.fields.some((f) => (f.name || "").toLowerCase() === scopeField))
          where = `(${scope}) AND (${where})`;
      }
      const feats = await queryFeatures(layerUrl, { where, count: 10, outSR: 4326 }); // lon/lat so importFeature projects via the shared 365223 model (B57c)
      if (!feats.length) { setLookupErr("No matches. Check spelling, try a shorter/partial value, or switch search mode."); return; }
      setLookupRes(feats.map((ft) => ({ ft, layerUrl, idField, addrField })));
    } catch (err) {
      setLookupErr(humanizeError(err));
    } finally {
      setLookupBusy(false);
    }
  };
  const importFeature = (entry) => {
    // Project with the SAME 365223 equirectangular model as map-click/identify so a
    // looked-up parcel and a clicked one are sized identically — this path used true
    // EPSG:2278 feet before, a ~0.3% mismatch for the same lot (B57c). Anchored on the
    // parcel's own lon/lat centroid so it still drops centered (unchanged placement).
    const rings = outerRingsLngLat(entry.ft); // open [lon,lat] rings (4326) — every part of a multipart parcel
    if (!rings.length) { setLookupErr("That record has no usable polygon geometry."); return; }
    // One shared anchor across all parts so separate tracts keep their true relative
    // position (anchoring each on its own centroid would stack them on top of each other).
    let n = 0, slon = 0, slat = 0;
    rings.forEach((r) => r.forEach(([lon, lat]) => { slon += lon; slat += lat; n++; }));
    const lon0 = slon / n, lat0 = slat / n;
    const pcs = rings.map((r) => ({ id: uid(), points: lngLatRingToFeet(r, lon0, lat0), locked: true })).filter((pc) => pc.points.length >= 3);
    if (!pcs.length) { setLookupErr("That record has no usable polygon geometry."); return; }
    pushHistory();
    setParcels((a) => [...a, ...pcs]);
    setSel({ kind: "parcel", id: pcs[pcs.length - 1].id });
    setLookupRes([]);
    requestFit();
  };

  /* ------------ element / handle interactions ------------ */
  // Attachment: an element may be bonded to a host (attachedTo). Bonded members
  // move and rotate as one assembly and can't be separated by dragging.
  const rootIdOf = (id) => { const el = els.find((x) => x.id === id); return (el && el.attachedTo) || id; };
  const assemblyOf = (id) => { const r = rootIdOf(id); return els.filter((e) => e.id === r || e.attachedTo === r); };
  const isAxisRect = (el) => !el.points && (((el.rot % 360) + 360) % 360) === 0;
  // Axis-aligned bounding box of a rect element at any quarter-turn (0/90/180/270),
  // swapping w/h for 90/270. Returns {cx,cy,w,h,rot:0} or null if not orthogonal.
  const ortho = (el) => {
    if (el.points) return null;
    const r = (((el.rot || 0) % 360) + 360) % 360;
    if (r % 90 !== 0) return null;
    const swap = r === 90 || r === 270;
    return { id: el.id, cx: el.cx, cy: el.cy, w: swap ? el.h : el.w, h: swap ? el.w : el.h, rot: 0 };
  };
  // Align a dragged rect to a nearby host's angle and snap it flush in the host's
  // own frame — so an off-angle element drops onto a rotated building/sidewalk.
  // Returns { cx, cy, rot, hostId, hintX, hintY } or null.
  const alignSnap = (gel, ncx, ncy, cands, thr) => {
    let best = null;
    for (const host of cands) {
      const th = host.rot || 0;
      const q = (((Math.round((gel.rot - th) / 90)) % 4) + 4) % 4; // quarter-turns off the host
      const swap = q === 1 || q === 3;
      const gbw = swap ? gel.h : gel.w, gbh = swap ? gel.w : gel.h;
      const loc = rot2(ncx - host.cx, ncy - host.cy, -th);          // grabbed centre in host frame
      const box = [{ id: host.id, cx: 0, cy: 0, w: host.w, h: host.h, rot: 0 }];
      const sc = edgeSnapCenter({ cx: loc.x, cy: loc.y, w: gbw, h: gbh }, box, thr);
      const hit = flushContact({ cx: sc.cx, cy: sc.cy, w: gbw, h: gbh, rot: 0 }, box, 6);
      if (!hit) continue;
      const back = rot2(sc.cx, sc.cy, th);
      const cx = host.cx + back.x, cy = host.cy + back.y, move2 = (cx - ncx) ** 2 + (cy - ncy) ** 2;
      if (!best || move2 < best.move2) {
        const hp = rot2(hit.x, hit.y, th);
        best = { cx, cy, rot: ((th + q * 90) % 360 + 360) % 360, hostId: host.id, hintX: host.cx + hp.x, hintY: host.cy + hp.y, move2 };
      }
    }
    return best;
  };
  const attachTo = (childId, hostId) => {
    if (childId === hostId) return;
    const hostRoot = rootIdOf(hostId);
    if (hostRoot === childId) return; // don't bond a host to its own child
    pushHistory();
    setEls((a) => a.map((e) => (e.id === childId ? { ...e, attachedTo: hostRoot } : e)));
    setSel({ kind: "el", id: childId });
  };
  const detach = (id) => {
    pushHistory();
    setEls((a) => a.map((e) => { if (e.id !== id) return e; const { attachedTo, ...rest } = e; return rest; }));
  };
  // Find an axis-aligned rect element that `m` is sitting flush against (a shared
  // edge with real overlap). Returns { id, x, y } where x,y is the contact-edge
  // midpoint (for the snap/attach indicator), or null.
  const flushContact = (m, others, eps) => {
    if (m.points || !isAxisRect(m)) return null;
    const mx0 = m.cx - m.w / 2, mx1 = m.cx + m.w / 2, my0 = m.cy - m.h / 2, my1 = m.cy + m.h / 2;
    let best = null;
    for (const t of others) {
      if (t.points || !isAxisRect(t)) continue;
      const tx0 = t.cx - t.w / 2, tx1 = t.cx + t.w / 2, ty0 = t.cy - t.h / 2, ty1 = t.cy + t.h / 2;
      const ya = Math.max(my0, ty0), yb = Math.min(my1, ty1), yov = yb - ya;
      const xa = Math.max(mx0, tx0), xb = Math.min(mx1, tx1), xov = xb - xa;
      if (yov > 5) {
        if (Math.abs(mx0 - tx1) <= eps && (!best || yov > best.ov)) best = { id: t.id, x: tx1, y: (ya + yb) / 2, ov: yov };
        if (Math.abs(mx1 - tx0) <= eps && (!best || yov > best.ov)) best = { id: t.id, x: tx0, y: (ya + yb) / 2, ov: yov };
      }
      if (xov > 5) {
        if (Math.abs(my0 - ty1) <= eps && (!best || xov > best.ov)) best = { id: t.id, x: (xa + xb) / 2, y: ty1, ov: xov };
        if (Math.abs(my1 - ty0) <= eps && (!best || xov > best.ov)) best = { id: t.id, x: (xa + xb) / 2, y: ty0, ov: xov };
      }
    }
    return best;
  };
  // Sidewalks / parking / trailer fields attached to a building track the wall
  // they hug when the building is resized. At drag start, capture each child in
  // the building's LOCAL frame: which wall it hugs (the axis it sits outside of),
  // its fixed depth, and its position/length along the wall.
  const WALL_KID_TYPES = ["sidewalk", "landscape", "parking", "trailer", "paving"];
  // noFit children (dog-ears, the rotated opposite-dock trailer strip) keep their
  // fixed size/position when the building is resized instead of scaling with a wall.
  const wallKids = (b) => els.filter((x) => x.attachedTo === b.id && !x.noFit && WALL_KID_TYPES.includes(x.type) && !x.points).map((c) => {
    const l = rot2(c.cx - b.cx, c.cy - b.cy, -b.rot); // child centre in the building's local frame
    // A child may be turned 90° from the building (e.g. a parking field rotated to
    // run ALONG a side wall). Resolve its extent on each building axis so depth,
    // length, and its own rotation all survive the resize.
    const rel = (((c.rot - b.rot) % 360) + 360) % 360;
    const cross = Math.min(Math.abs(rel - 90), Math.abs(rel - 270)) < 45; // child's w runs along building Y
    const dimBX = cross ? c.h : c.w; // child extent along the building's X axis
    const dimBY = cross ? c.w : c.h; // child extent along the building's Y axis
    const outX = Math.abs(l.x) - b.w / 2, outY = Math.abs(l.y) - b.h / 2;
    const perpIsY = outY >= outX; // hugs a horizontal (top/bottom) wall → perpendicular axis is Y
    // perpGap = clearance between the child's near face and the building edge
    // (0 when flush; e.g. a sidewalk's width when parking sits beyond a sidewalk).
    return perpIsY
      ? { id: c.id, perpIsY: true, cross, rot0: c.rot, sidePerp: l.y >= 0 ? 1 : -1, perpDepth: dimBY, perpGap: Math.abs(l.y) - b.h / 2 - dimBY / 2, alongCenter: l.x, alongHalf: dimBX / 2, oldAlongHalf: b.w / 2 }
      : { id: c.id, perpIsY: false, cross, rot0: c.rot, sidePerp: l.x >= 0 ? 1 : -1, perpDepth: dimBX, perpGap: Math.abs(l.x) - b.w / 2 - dimBX / 2, alongCenter: l.y, alongHalf: dimBY / 2, oldAlongHalf: b.h / 2 };
  });
  // ...then re-fit each child: it stays flush against the wall and keeps its
  // depth, while its length/position ALONG the wall scale with that wall.
  const fitKid = (nb, k) => {
    const newAlongHalf = (k.perpIsY ? nb.w : nb.h) / 2;
    const newPerpHalf = (k.perpIsY ? nb.h : nb.w) / 2;
    const ratio = k.oldAlongHalf ? newAlongHalf / k.oldAlongHalf : 1;
    const along = k.alongCenter * ratio;          // position along the wall
    const alongDim = 2 * k.alongHalf * ratio;      // length along the wall
    const perp = k.sidePerp * (newPerpHalf + k.perpDepth / 2 + Math.max(0, k.perpGap || 0)); // keep its clearance outside the wall
    const lx = k.perpIsY ? along : perp, ly = k.perpIsY ? perp : along;
    const dimBX = k.perpIsY ? alongDim : k.perpDepth; // child extent on building X
    const dimBY = k.perpIsY ? k.perpDepth : alongDim; // child extent on building Y
    const w = k.cross ? dimBY : dimBX, h = k.cross ? dimBX : dimBY; // back to the child's own w/h
    const off = rot2(lx, ly, nb.rot);
    return { cx: nb.cx + off.x, cy: nb.cy + off.y, w, h, rot: k.rot0 != null ? k.rot0 : ((nb.rot % 360) + 360) % 360 };
  };
  // Add a sidewalk strip flush against whichever side of the building was clicked.
  const SIDEWALK_W = 5;
  const TRUCK_COURT_D = 135; // truck dock apron + drive depth
  const OPP_TRAILER_D = 50;  // trailer-parking depth on the side opposite the docks
  const OPP_TRAILER_W = 12;  // trailer stall width for that strip
  const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
  // Dock-capable sides run along a building's TWO LONG sides. The dock preset
  // chooses how many: cross-dock = both, single-load = one, none = neither.
  // Existing buildings (no `dock` field) keep both long sides for back-compat.
  const dockSidesOf = (el) => {
    const longSides = el.w >= el.h ? ["top", "bottom"] : ["left", "right"];
    const dock = el.dock || "cross";
    if (dock === "none") return { dside: longSides[1], dockSides: [], trailerSides: [] };
    if (dock === "single") {
      const dside = longSides.includes(el.dockSide) ? el.dockSide : longSides[1];
      return { dside, dockSides: [dside], trailerSides: [] };
    }
    return { dside: longSides[1], dockSides: longSides, trailerSides: [] };
  };
  // Build (don't commit) a full-wall strip element flush against one building side.
  const makeStrip = (b, nx, ny, type, depth, extra = {}) => {
    const w = nx !== 0 ? depth : b.w;
    const h = ny !== 0 ? depth : b.h;
    const off = rot2(nx * (b.w / 2 + depth / 2), ny * (b.h / 2 + depth / 2), b.rot);
    return { id: uid(), type, cx: b.cx + off.x, cy: b.cy + off.y, w, h, rot: ((b.rot % 360) + 360) % 360, attachedTo: b.id, ...extra };
  };
  // Build a 55′×60′ dog-ear bump-out at one corner (sign = ±1 along the wall) of a
  // dock side. A dog-ear is part of the building: it sits flush at the end of the
  // dock wall and projects out into the court, taking that span out of dock use.
  // It's a building element (adds to SF), with no docks/label of its own.
  // Geometry of a dog-ear (size + center offset) for a given building box.
  const dogEarGeom = (bx, side, sign) => {
    const [nx, ny] = SIDE_N[side];
    const alongIsX = ny !== 0; // horizontal (top/bottom) dock wall → corners spread along X
    const w = alongIsX ? DOGEAR_W : DOGEAR_D;
    const h = alongIsX ? DOGEAR_D : DOGEAR_W;
    // outer edge flush with the building corner (inset half its along-span), and
    // projecting DOGEAR_D out past the dock face.
    const lx = alongIsX ? sign * (bx.w / 2 - DOGEAR_W / 2) : nx * (bx.w / 2 + DOGEAR_D / 2);
    const ly = alongIsX ? ny * (bx.h / 2 + DOGEAR_D / 2) : sign * (bx.h / 2 - DOGEAR_W / 2);
    const off = rot2(lx, ly, bx.rot);
    return { cx: bx.cx + off.x, cy: bx.cy + off.y, w, h, rot: ((bx.rot % 360) + 360) % 360 };
  };
  const makeDogEar = (b, side, sign) => ({
    id: uid(), type: "building", ...dogEarGeom(b, side, sign),
    attachedTo: b.id, noFit: true, noLabel: true, dock: "none", dogEar: { side, sign },
  });
  // Re-anchor a dog-ear to the building corner when the building is resized
  // (keeps its fixed 55′×60′ size, slides to the new corner / dock face).
  const fitDogEar = (nb, de) => dogEarGeom(nb, de.side, de.sign);
  // Commit a batch of building-attached elements in one history step.
  const addBuildingEls = (list, hostId) => { if (!list.length) return; pushHistory(); setEls((a) => [...a, ...list]); setSel({ kind: "el", id: hostId }); };
  // Remove a building feature (and anything that hangs off it, e.g. a court's trailer).
  const removeFeature = (id) => { pushHistory(); setEls((a) => a.filter((e) => e.id !== id && e.forCourt !== id)); };
  // Add a strip element of `type`/`depth` flush against one side of the building
  // (local normal nx,ny), full wall length, bonded to the building. Keeps the
  // building selected so several can be added in a row.
  const addStripSide = (b, nx, ny, type, depth, extra = {}) => addBuildingEls([makeStrip(b, nx, ny, type, depth, extra)], b.id);
  // Add a single row of parking + drive aisle flush against a building side, the
  // wall's full length, oriented so it grows OUTWARD (drive on the building side).
  const SIDE_PARK_ANGLE = { top: 180, bottom: 0, left: 90, right: 270 };
  const sideParkingOn = (b, name) => els.find((x) => x.attachedTo === b.id && x.sideParkSide === name);
  const sidewalkOnSide = (b, name) => els.find((x) => isWallStrip(x) && !x.points && x.attachedTo === b.id && sideOfKid(b, x) === name);
  // Add a 5′ sidewalk flush against a building side, full wall length. If pads
  // (paving/parking) already sit on that side, push them out by the sidewalk's
  // thickness so they stay flush beyond it.
  const addSidewalkSide = (b, name) => {
    if (sidewalkOnSide(b, name)) return;
    const sw = makeStrip(b, ...SIDE_N[name], "sidewalk", SIDEWALK_W, { sidewalkSide: name });
    const out = outwardUnit(b, name);
    const shift = new Set(els.filter((x) => x.attachedTo === b.id && !x.points && !x.dogEar && !isWallStrip(x) && sideOfKid(b, x) === name).map((x) => x.id));
    pushHistory();
    setEls((a) => [...a.map((x) => shift.has(x.id) ? { ...x, cx: x.cx + out.x * SIDEWALK_W, cy: x.cy + out.y * SIDEWALK_W } : x), sw]);
    setSel({ kind: "el", id: b.id });
  };
  const addParkingRowSide = (b, name) => {
    if (sideParkingOn(b, name)) return;
    const [nx, ny] = SIDE_N[name];
    const sw = sidewalkOnSide(b, name);
    // Offset only by the sidewalk's THICKNESS (never its run) — swThick resolves the
    // correct axis, so a resized/rotated sidewalk can't leak a ~wall-length value here.
    const swDepth = sw ? swThick(sw) : 0;
    // Parking row depth is a FIXED constant (one stall row + aisle) — it must never
    // be derived from adjacent or just-deleted geometry.
    const parkDepth = settings.stallDepth + settings.aisle;
    const along = ny !== 0 ? b.w : b.h;
    const half = (nx !== 0 ? b.w : b.h) / 2;
    const off = rot2(nx * (half + swDepth + parkDepth / 2), ny * (half + swDepth + parkDepth / 2), b.rot);
    // First stall row hugs the building face, drive aisle on the OUTSIDE (B119): the
    // strip's inner (local y=0) edge sits against the wall and carStalls lays the first
    // row there by default, so DON'T flip the depth (flipDepth would put the aisle against
    // the building). growParking then extends rows outward, away from the wall.
    const el = { id: uid(), type: "parking", cx: b.cx + off.x, cy: b.cy + off.y, w: along, h: parkDepth,
      rot: ((b.rot + SIDE_PARK_ANGLE[name]) % 360 + 360) % 360, attachedTo: b.id, sideParkSide: name };
    addBuildingEls([el], b.id);
  };
  // Geometry of a 50′-deep single trailer row flush against host box `b`'s `name`
  // side, full host length along that side. Rotated +90 on a side wall so the
  // stalls always stripe ALONG the wall.
  const oppTrailerGeom = (b, name) => {
    const [nx, ny] = SIDE_N[name];
    const horiz = ny !== 0;                 // top/bottom wall → stalls run along X
    const depth = OPP_TRAILER_D, along = horiz ? b.w : b.h;
    const off = rot2(nx * (b.w / 2 + depth / 2), ny * (b.h / 2 + depth / 2), b.rot);
    return { cx: b.cx + off.x, cy: b.cy + off.y, w: along, h: depth, rot: ((b.rot + (horiz ? 0 : 90)) % 360 + 360) % 360 };
  };
  const makeOppTrailer = (b, name, attachId = b.id) => ({
    id: uid(), type: "trailer", ...oppTrailerGeom(b, name),
    attachedTo: attachId, noFit: true, cfg: { trailerW: OPP_TRAILER_W, trailerL: OPP_TRAILER_D, trailerAisle: 0, single: true },
  });
  // Re-fit a wall-hugging single trailer row to a (resized) host box.
  const fitWallTrailer = (hostBox, side) => oppTrailerGeom(hostBox, side);
  // Re-fit every feature bonded to a resized building so the whole assembly stays
  // stuck together: dog-ears slide to the corner, wall strips scale, the
  // opposite-side trailer re-hugs its wall, and a court's trailer follows the
  // (re-scaled) court's far edge.
  const refitChildren = (a, buildingId, nb, kids) => {
    const courtBox = {}; // court id -> { box, side } for trailers that back onto it
    const pass1 = a.map((x) => {
      if (x.id === buildingId) return { ...x, cx: nb.cx, cy: nb.cy, w: nb.w, h: nb.h };
      if (x.attachedTo === buildingId && x.dogEar) return { ...x, ...fitDogEar(nb, x.dogEar) };
      if (x.attachedTo === buildingId && x.oppSide) return { ...x, ...fitWallTrailer(nb, x.oppSide) };
      const k = kids?.find((kk) => kk.id === x.id);
      if (k) { const g = fitKid(nb, k); if (x.truckCourt) courtBox[x.id] = { box: g, side: x.truckCourt.side }; return { ...x, ...g }; }
      return x;
    });
    return pass1.map((x) => (x.forCourt && courtBox[x.forCourt]) ? { ...x, ...fitWallTrailer(courtBox[x.forCourt].box, courtBox[x.forCourt].side) } : x);
  };
  // Trailer parking flush against the FAR (outer) edge of a truck court — where
  // trailers actually back in. Bonded to the court's building so it moves as one.
  const addCourtTrailer = (tc) => { if (els.some((x) => x.forCourt === tc.id)) return; const root = rootIdOf(tc.id); addBuildingEls([{ ...makeOppTrailer(tc, tc.truckCourt.side, root), forCourt: tc.id }], root); };
  // 135′ truck court on every dock side that doesn't already have one (tagged so it can sprout trailer parking).
  const addTruckCourt = (b) => {
    const { dockSides } = dockSidesOf(b);
    const have = new Set(els.filter((x) => x.attachedTo === b.id && x.truckCourt).map((x) => x.truckCourt.side));
    addBuildingEls(dockSides.filter((s) => !have.has(s)).map((s) => makeStrip(b, ...SIDE_N[s], "paving", TRUCK_COURT_D, { truckCourt: { side: s } })), b.id);
  };
  // A dock-corner bump-out lengthens the building's perpendicular wall by its
  // projection — so a sidewalk on that wall should grow to match. Which side that
  // sidewalk is on, and the direction it extends, follow from the corner.
  const bumpSidewalkSide = (side, sign) => {
    const horiz = side === "top" || side === "bottom"; // wall runs along X
    return horiz ? (sign < 0 ? "left" : "right") : (sign < 0 ? "top" : "bottom");
  };
  // Extend (dir +1) or shrink (dir −1) a sidewalk by one bump depth toward dockSide.
  const adjustSidewalkForBump = (sw, dockSide, dir) => {
    const [dnx, dny] = SIDE_N[dockSide];
    const lengthIsX = sw.sidewalkSide === "top" || sw.sidewalkSide === "bottom";
    const inc = dir * DOGEAR_D;
    const off = rot2(lengthIsX ? dnx * inc / 2 : 0, lengthIsX ? 0 : dny * inc / 2, sw.rot);
    return lengthIsX
      ? { ...sw, w: Math.max(SIDEWALK_W, sw.w + inc), cx: sw.cx + off.x, cy: sw.cy + off.y }
      : { ...sw, h: Math.max(SIDEWALK_W, sw.h + inc), cx: sw.cx + off.x, cy: sw.cy + off.y };
  };
  const isWallStrip = (x) => x.type === "sidewalk" || x.type === "landscape"; // 5′ wall strips
  const isBumpSidewalk = (x, b, swSide) => x.attachedTo === b.id && isWallStrip(x) && !x.points && sideOfKid(b, x) === swSide;
  // Add dog-ears at the given corners, growing any matching perpendicular sidewalk
  // to the bump-out's new length.
  const placeDogEars = (b, corners) => {
    if (!corners.length) return;
    pushHistory();
    const newDe = corners.map(([side, sign]) => makeDogEar(b, side, sign));
    setEls((a) => {
      let next = [...a, ...newDe];
      corners.forEach(([side, sign]) => {
        const swSide = bumpSidewalkSide(side, sign);
        next = next.map((x) => (isBumpSidewalk(x, b, swSide) ? adjustSidewalkForBump(x, side, 1) : x));
      });
      return next;
    });
    setSel({ kind: "el", id: b.id });
  };
  // Remove a dog-ear, shrinking its matching sidewalk back.
  const removeDogEar = (b, de) => {
    const swSide = bumpSidewalkSide(de.dogEar.side, de.dogEar.sign);
    pushHistory();
    setEls((a) => a.filter((x) => x.id !== de.id && x.forCourt !== de.id)
      .map((x) => (isBumpSidewalk(x, b, swSide) ? adjustSidewalkForBump(x, de.dogEar.side, -1) : x)));
  };
  // Dog-ears at both corners of every dock side (skipping any already present).
  const addDogEars = (b) => {
    const { dockSides } = dockSidesOf(b);
    const have = new Set(els.filter((x) => x.attachedTo === b.id && x.dogEar).map((x) => `${x.dogEar.side}${x.dogEar.sign}`));
    const corners = [];
    dockSides.forEach((s) => [1, -1].forEach((sign) => { if (!have.has(`${s}${sign}`)) corners.push([s, sign]); }));
    placeDogEars(b, corners);
  };
  // Which building side a bonded kid hugs. Trust an explicit tag; else infer it
  // from the kid's position (so legacy / untagged strips are still recognised).
  const sideOfKid = (b, kid) => {
    if (kid.sidewalkSide) return kid.sidewalkSide;
    const c = kid.points ? centroid(kid.points) : { x: kid.cx, y: kid.cy };
    const l = rot2(c.x - b.cx, c.y - b.cy, -b.rot);
    const outX = Math.abs(l.x) - b.w / 2, outY = Math.abs(l.y) - b.h / 2;
    return outY >= outX ? (l.y >= 0 ? "bottom" : "top") : (l.x >= 0 ? "right" : "left");
  };
  /* ---- wall-strip (sidewalk/landscape) geometry & flushness ---- */
  const buildingOf = (el) => els.find((x) => x.id === el.attachedTo);
  // Which building side a strip hugs, and whether its thickness is on the h axis.
  const swSide = (el) => { if (el.sidewalkSide) return el.sidewalkSide; const b = buildingOf(el); return b ? sideOfKid(b, el) : (el.w >= el.h ? "bottom" : "right"); };
  const swThickIsH = (el) => SIDE_N[swSide(el)][1] !== 0; // top/bottom → thickness is h
  const swThick = (el) => (swThickIsH(el) ? el.h : el.w);
  const swRun = (el) => (swThickIsH(el) ? el.w : el.h);
  // Strips/pads on the same building wall that sit beyond `ref` strip's centre
  // (farther out) — these must slide when `ref`'s outer face moves.
  const stripsBeyond = (b, side, refOutPerp, exceptId) => {
    const [nx, ny] = SIDE_N[side], isH = ny !== 0, s = isH ? ny : nx;
    return els.filter((x) => {
      if (x.attachedTo !== b.id || x.points || x.id === exceptId || x.dogEar) return false;
      const l = rot2(x.cx - b.cx, x.cy - b.cy, -b.rot);
      return sideOfKid(b, x) === side && s * (isH ? l.y : l.x) > refOutPerp + 1;
    });
  };
  const outwardUnit = (b, side) => { const [nx, ny] = SIDE_N[side]; return rot2(nx, ny, b.rot); };
  // Edit a sidewalk's Width (thickness): grow OUTWARD (inner face stays flush to
  // the building) and slide any pads beyond it out by the same delta.
  const setSidewalkWidth = (el, newT) => {
    const b = buildingOf(el); if (!b) return;
    const side = swSide(el), isH = swThickIsH(el), oldT = isH ? el.h : el.w, dT = Math.max(1, newT) - oldT;
    if (!dT) return;
    const out = outwardUnit(b, side);
    const l = rot2(el.cx - b.cx, el.cy - b.cy, -b.rot), s = SIDE_N[side][isH ? 1 : 0];
    const refOutPerp = s * (isH ? l.y : l.x);
    const beyond = new Set(stripsBeyond(b, side, refOutPerp, el.id).map((x) => x.id));
    pushHistory();
    setEls((a) => a.map((x) => {
      if (x.id === el.id) return { ...x, ...(isH ? { h: newT } : { w: newT }), cx: x.cx + out.x * dT / 2, cy: x.cy + out.y * dT / 2 };
      if (beyond.has(x.id)) return { ...x, cx: x.cx + out.x * dT, cy: x.cy + out.y * dT };
      return x;
    }));
  };
  const setSidewalkLength = (el, newRun) => {
    const isH = swThickIsH(el);
    pushHistory();
    setEls((a) => a.map((x) => x.id === el.id ? { ...x, ...(isH ? { w: Math.max(1, newRun) } : { h: Math.max(1, newRun) }) } : x));
  };
  // Capture (at resize start) the strips beyond a wall strip so the live drag can
  // keep them flush as its outer face moves.
  const swShiftSnapshot = (el) => {
    if (!isWallStrip(el)) return null;
    const b = buildingOf(el); if (!b) return null;
    const side = swSide(el), isH = swThickIsH(el);
    const out = outwardUnit(b, side);
    const l = rot2(el.cx - b.cx, el.cy - b.cy, -b.rot), s = SIDE_N[side][isH ? 1 : 0];
    const refOutPerp = s * (isH ? l.y : l.x);
    const siblings = stripsBeyond(b, side, refOutPerp, el.id).map((x) => ({ id: x.id, cx0: x.cx, cy0: x.cy }));
    return { out, isH, thick0: isH ? el.h : el.w, siblings };
  };
  const startMoveEl = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    if (e.shiftKey) { // Shift-click toggles into the multi-selection
      setMulti((s) => inMulti("el", id) ? s.filter((m) => !(m.kind === "el" && m.id === id)) : [...s, { kind: "el", id }]);
      setSel({ kind: "el", id });
      return;
    }
    if (multi.length > 1 && inMulti("el", id)) { startGroupMove(e); return; } // drag a member → move the group
    if (multi.length) setMulti([]);
    if (attachFor) { // bonding: this click picks the host to attach to
      if (el) attachTo(attachFor, el.id);
      setAttachFor(null);
      return;
    }
    if (alignFor) { alignToElement(el); return; } // align: this click picks an element to match
    if (el && el.locked) { setSel({ kind: "el", id }); return; } // locked: select only, don't move
    setSel({ kind: "el", id });
    pushHistory();
    // Snapshot every member of the assembly so they move together.
    const members = assemblyOf(id).map((m) => m.points
      ? { id: m.id, points: m.points }
      : { id: m.id, cx: m.cx, cy: m.cy, w: m.w, h: m.h });
    // Bonding (Shift-drag / snap) can only attach a free, rectangular element
    // that isn't already a host of something else. Shift is read live in onMove.
    const canAttach = !el.attachedTo && !el.points && !els.some((x) => x.attachedTo === id);
    drag.current = { mode: "move", kind: "el", id, fx: fp.x, fy: fp.y, members, canAttach };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startMoveParcel = (e, id) => {
    if (e.button !== 0) return;
    if (tool !== "select") return;
    e.stopPropagation();
    const pc = parcels.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    if (alignFor) { alignToParcelEdge(fp, pc); return; } // align: this click picks a parcel edge
    if (e.shiftKey) { toggleMerge(id); setSel({ kind: "parcel", id }); return; } // Shift-click: multi-select to merge
    setSel({ kind: "parcel", id });
    if (pc.locked) return;             // locked parcel: select only, don't move
    pushHistory();
    drag.current = { mode: "move", kind: "parcel", id, fx: fp.x, fy: fp.y, opts: pc.points };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  /* ------------ align rotation to a target (parcel edge / element) ------------ */
  const segDist = (p, a, b) => {
    const vx = b.x - a.x, vy = b.y - a.y, wx = p.x - a.x, wy = p.y - a.y;
    const L2 = vx * vx + vy * vy || 1;
    let t = (wx * vx + wy * vy) / L2; t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  };
  // Snap an element from curRot to be parallel to a line at `ang°`, choosing the
  // nearest of the four 90°-equivalent orientations (least rotation).
  const snapParallel = (curRot, ang) => {
    let best = ang, bestD = 1e9;
    for (let k = 0; k < 4; k++) {
      const t = ((ang + k * 90) % 360 + 360) % 360;
      const d = Math.abs(((t - curRot + 540) % 360) - 180);
      if (d < bestD) { bestD = d; best = t; }
    }
    return best;
  };
  // Align the alignFor element's rotation to the nearest edge of a parcel (the one
  // closest to the click), carrying its whole assembly.
  const alignToParcelEdge = (fp, onlyParcel) => {
    const el = els.find((x) => x.id === alignFor);
    setAlignFor(null);
    if (!el || el.points) return;
    const list = onlyParcel ? [onlyParcel] : parcels;
    let best = null;
    list.forEach((pc) => pc.points.forEach((a, i) => {
      const b = pc.points[(i + 1) % pc.points.length];
      const d = segDist(fp, a, b);
      if (!best || d < best.d) best = { d, a, b };
    }));
    if (!best) return;
    const ang = Math.atan2(best.b.y - best.a.y, best.b.x - best.a.x) * 180 / Math.PI;
    rotateAssemblyTo(el, snapParallel(el.rot || 0, ang));
  };
  // Align to another element's rotation (its edges).
  const alignToElement = (target) => {
    const el = els.find((x) => x.id === alignFor);
    setAlignFor(null);
    if (!el || el.points || !target || target.id === el.id) return;
    const ang = target.points ? null : (target.rot || 0);
    if (ang == null) return; // polygon target has no single rotation
    rotateAssemblyTo(el, snapParallel(el.rot || 0, ang));
  };
  // When a rectangular element is bonded to a (rect) building, capture which of
  // the host's edges it hugs plus the gap, so a resize keeps that host-facing
  // face pinned — the element then grows AWAY from the building, not over it.
  const hostClampOf = (el) => {
    const host = el.attachedTo ? els.find((x) => x.id === el.attachedTo && x.type === "building" && !x.points) : null;
    if (!host || el.points) return null;
    const hrot = host.rot || 0;
    const l = rot2(el.cx - host.cx, el.cy - host.cy, -hrot);
    const rel = ((((el.rot || 0) - hrot) % 360) + 360) % 360;
    const cross = Math.abs(rel - 90) < 45 || Math.abs(rel - 270) < 45;
    const halfX = (cross ? el.h : el.w) / 2, halfY = (cross ? el.w : el.h) / 2;
    const outX = Math.abs(l.x) - host.w / 2 - halfX, outY = Math.abs(l.y) - host.h / 2 - halfY;
    const axis = (Math.abs(l.x) - host.w / 2) >= (Math.abs(l.y) - host.h / 2) ? "x" : "y";
    const sign = axis === "x" ? (l.x >= 0 ? 1 : -1) : (l.y >= 0 ? 1 : -1);
    const gap = Math.max(0, axis === "x" ? outX : outY);
    return { host: { cx: host.cx, cy: host.cy, w: host.w, h: host.h, rot: hrot }, axis, sign, gap };
  };
  // Re-pin the host-facing face of nb to the host edge (+ original gap).
  const clampToHost = (nb, hc) => {
    const h = hc.host;
    const rel = ((((nb.rot || 0) - h.rot) % 360) + 360) % 360;
    const cross = Math.abs(rel - 90) < 45 || Math.abs(rel - 270) < 45;
    const half = hc.axis === "x" ? (cross ? nb.h : nb.w) / 2 : (cross ? nb.w : nb.h) / 2;
    const c = rot2(nb.cx - h.cx, nb.cy - h.cy, -h.rot);
    if (hc.axis === "x") c.x = hc.sign * (h.w / 2 + hc.gap + half);
    else c.y = hc.sign * (h.h / 2 + hc.gap + half);
    const back = rot2(c.x, c.y, h.rot);
    nb.cx = h.cx + back.x; nb.cy = h.cy + back.y;
  };
  // During a wall-strip resize, slide the captured pads beyond it by the change
  // in the strip's outer-face position (its thickness delta), keeping them flush.
  const applySwShift = (arr, sw, nb) => {
    if (!sw || !sw.siblings.length) return arr;
    const delta = (sw.isH ? nb.h : nb.w) - sw.thick0;
    if (!delta) return arr;
    const m = new Map(sw.siblings.map((s) => [s.id, s]));
    return arr.map((x) => m.has(x.id) ? { ...x, cx: m.get(x.id).cx0 + sw.out.x * delta, cy: m.get(x.id).cy0 + sw.out.y * delta } : x);
  };
  const startResize = (e, id, sx, sy) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    // fixed opposite corner in world feet
    const oppLocal = rot2(-sx * el.w / 2, -sy * el.h / 2, el.rot);
    const opp = { x: el.cx + oppLocal.x, y: el.cy + oppLocal.y };
    pushHistory();
    drag.current = { mode: "resize", id, sx, sy, opp, kids: wallKids(el), hostClamp: hostClampOf(el), swShift: swShiftSnapshot(el) };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  // B146: a selected element's dimension callout is grab-and-drag to reposition (stored as a
  // local-feet offset on the element); on a road, clicking the number edits the travel width.
  const startDimMove = (e, id) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    if (!el) return;
    setSel({ kind: "el", id });
    pushHistory();
    drag.current = { mode: "dimMove", id, start: p2f(e.clientX, e.clientY), base: el.dimOffset || { x: 0, y: 0 }, rot: el.rot || 0 };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const editDimWidth = (id, e) => {
    const el = els.find((x) => x.id === id);
    if (!el || el.type !== "road") return;
    const fp = e ? p2f(e.clientX, e.clientY) : { x: el.cx, y: el.cy };
    setNumEdit({ fx: fp.x, fy: fp.y, value: String(Math.round(roadTravel(el))), onCommit: (n) => { if (n > 0) setRoadTravel(el, n); } });
  };
  // Inline numeric editor — NEVER a dialog box (owner rule 2026-06-17). Commit on Enter / click-away,
  // cancel on Esc; each opener says where to place it (feet) + what to do with the entered value.
  const commitNumEdit = () => {
    if (!numEdit) return;
    const n = parseFloat(numEdit.value);
    const cb = numEdit.onCommit;
    setNumEdit(null);
    if (Number.isFinite(n)) cb(n);
  };
  const cancelNumEdit = () => setNumEdit(null);
  const startEdgeResize = (e, id, nx, ny) => {
    if (tool !== "select" || e.button !== 0) return;
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    // midpoint of the opposite edge stays fixed (world feet)
    const oppLocal = rot2(-nx * el.w / 2, -ny * el.h / 2, el.rot);
    const opp = { x: el.cx + oppLocal.x, y: el.cy + oppLocal.y };
    pushHistory();
    drag.current = { mode: "edgeResize", id, nx, ny, opp, kids: wallKids(el), hostClamp: hostClampOf(el), swShift: swShiftSnapshot(el) };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startRotate = (e, id) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    const fp = p2f(e.clientX, e.clientY);
    const pivot = { x: el.cx, y: el.cy };
    const startPtr = (Math.atan2(fp.y - pivot.y, fp.x - pivot.x) * 180) / Math.PI;
    // Rotate the whole assembly about this element's centre.
    const start = assemblyOf(id).map((m) => m.points
      ? { id: m.id, points: m.points }
      : { id: m.id, cx: m.cx, cy: m.cy, rot: m.rot });
    pushHistory();
    drag.current = { mode: "rotate", id, pivot, startPtr, start };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  // Double- or right-click an element to open its actions menu (dock / sidewalk / attach).
  const onElDouble = (e, id) => {
    e.stopPropagation();
    const el = els.find((x) => x.id === id);
    if (!el) return;
    setSel({ kind: "el", id });
    setTypeMenu({ id, x: e.clientX, y: e.clientY });
  };
  const toggleLock = (id) => {
    pushHistory();
    setEls((a) => a.map((el) => (el.id === id ? { ...el, locked: !el.locked } : el)));
  };
  const toggleParcelLock = (id) => {
    pushHistory();
    setParcels((a) => a.map((pc) => (pc.id === id ? { ...pc, locked: !pc.locked } : pc)));
  };
  // Active/Inactive is independent of lock (B100): inactive parcels drop out of every area
  // calc but stay on the canvas (dimmed). Missing = active, so toggling off sets active:false.
  const toggleParcelActive = (id) => {
    pushHistory();
    setParcels((a) => a.map((pc) => (pc.id === id ? { ...pc, active: pc.active === false } : pc)));
  };
  const toggleMarkupLock = (id) => {
    pushHistory();
    setMarkups((a) => a.map((m) => (m.id === id ? { ...m, locked: !m.locked } : m)));
  };

  /* ------------ metrics ------------ */
  // Per-element striping/count config: a strip may override the global standards
  // (e.g. the 50′ × 12′ single-row trailer parking carries its own cfg).
  const cfgOf = (el) => (el.cfg ? { ...settings, ...el.cfg } : settings);
  // Only ACTIVE parcels drive the yield/area math (default active; inactive = excluded but visible) (B100).
  const siteSqft = parcels.reduce((s, p) => s + (p.active !== false ? polyArea(p.points) : 0), 0);
  let bldg = 0, paving = 0, parkArea = 0, trailArea = 0, pondArea = 0, stalls = 0, trailers = 0;
  let bumpCount = 0, bumpArea = 0; // dog-ear / bump-out tally (counted within bldg)
  els.forEach((e) => {
    const a = e.points ? polyArea(e.points) : e.w * e.h;
    const curb = curbAreaOf(e, els); // derived curbs count in the SF / impervious math (0 for non-paved types)
    if (e.type === "building") { bldg += a; if (e.dogEar) { bumpCount++; bumpArea += a; } }
    else if (e.type === "paving" || e.type === "sidewalk" || e.type === "road") paving += a + curb;
    else if (e.type === "parking") { parkArea += a + curb; stalls += e.points ? estStalls(a, settings) : carStalls(e.w, e.h, cfgOf(e)).count; }
    else if (e.type === "trailer") { trailArea += a + curb; trailers += e.points ? estTrailers(a, settings) : trailerStalls(e.w, e.h, cfgOf(e)).count; }
    else if (e.type === "pond") pondArea += a;
  });
  // A dog-ear bump-out sits inside its truck court footprint — that overlap is
  // building, not paving (you can only place one there). Don't double-count it.
  els.forEach((e) => {
    if (!e.dogEar) return;
    const hasCourt = els.some((c) => c.truckCourt && c.attachedTo === e.attachedTo && c.truckCourt.side === e.dogEar.side);
    if (hasCourt) paving = Math.max(0, paving - e.w * e.h);
  });
  const impervious = bldg + paving + parkArea + trailArea;
  const cov = siteSqft ? (bldg / siteSqft) * 100 : 0;
  const far = siteSqft ? bldg / siteSqft : 0; // single-story assumption
  const impPct = siteSqft ? (impervious / siteSqft) * 100 : 0;
  const detPct = siteSqft ? (pondArea / siteSqft) * 100 : 0;
  const ratio = bldg ? stalls / (bldg / 1000) : 0;
  const open = Math.max(0, siteSqft - impervious - pondArea);
  // Easement encumbrance tally (NEW-1 readout + NEW-4 surface). Gross sum of easement
  // areas — overlaps are NOT deduped (screening), so it reads "gross" — split by what
  // each easement restricts (the same shape the buildable-area engine consumes).
  const easeAll = markups.filter((m) => m.kind === "easement");
  const easeArea = easeAll.reduce((s, e) => s + easementArea(e), 0);
  const easeBldgArea = easeAll.reduce((s, e) => s + (e.restrictsBuildings !== false ? easementArea(e) : 0), 0);
  const easePaveArea = easeAll.reduce((s, e) => s + (e.restrictsPaving === true ? easementArea(e) : 0), 0);

  const importRef = useRef(null);
  const importJSONFile = (file) => {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const d = JSON.parse(fr.result);
        if (!d || (!Array.isArray(d.parcels) && !Array.isArray(d.els))) throw new Error();
        ensureIdAbove([...(d.parcels || []).map((p) => p.id), ...(d.els || []).map((e) => e.id)]);
        pushHistory();
        setParcels(d.parcels || []); setEls(d.els || []); setMeasures(d.measures || []);
        setCallouts(d.callouts || []); setMarkups(d.markups || []); // symmetric with exportJSON (was dropped → data loss / bleed-through)
        setSettings((s) => ({ ...s, ...(d.settings || {}), snap: s.snap })); // snap is a global pref, not imported
        setUnderlay(d.underlay || null);
        setSel(null);
        requestFit();
      } catch (_) { alert("That file doesn't look like a Site Planyr export."); }
    };
    fr.readAsText(file);
  };
  // Site (location) vs Plan (layout) labels — editable from the header.
  const groupId = restored?.groupId || siteId;
  const siteCounty = restored?.county || null;
  // `origin` is declared once near the top (geographic basemap state).
  // Resolve taxing jurisdictions + rate for the selected parcel (graceful-degrade).
  const [taxInfo, setTaxInfo] = useState(null);
  // In-planner parcel identify (click any spot → county record without importing).
  const [identifyMode, setIdentifyMode] = useState(false);
  const [identifyRes, setIdentifyRes] = useState(null); // { busy } | { attrs, rings, ring, lng, lat, addr } | { error } — rings = all outer parts; ring = largest (for jurisdiction/road tests)
  const idLayerRef = useRef(null);
  const identifyTok = useRef(0);
  // B93/B94 — jurisdiction (city/ETJ/county) + road maintenance authority, on
  // EXPLICIT request only (never auto-loaded per parcel). Rides the SWR cache (B96).
  const [jurInfo, setJurInfo] = useState(null); // { busy } | { j, road } | { error }
  const checkJurisdiction = async () => {
    const r = identifyRes;
    if (!r || r.busy || r.error || r.lng == null) return;
    setJurInfo({ busy: true });
    const [j, road] = await Promise.all([
      identifyJurisdiction(r.lng, r.lat, { ring: r.ring }), // whole-parcel test → flags a straddle
      identifyRoadAuthority(r.lng, r.lat, { ring: r.ring }), // parcel frontage → every fronting authority
    ]);
    setJurInfo({ j, road });
  };
  const jurRow = (label, value, ageMs) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "1px 0" }}>
      <span style={{ color: PAL.muted }}>{label}</span>
      <span style={{ color: PAL.ink, fontWeight: 600, textAlign: "right" }}>
        {value}
        {ageMs != null && <span style={{ color: PAL.muted, fontWeight: 400 }}> · {formatAge(ageMs)}</span>}
      </span>
    </div>
  );
  const identifyAt = async (fp) => {
    if (!origin) { setIdentifyRes({ error: "This plan isn't georeferenced — bring the parcel in from the map." }); return; }
    const tok = ++identifyTok.current; // a later identify click supersedes this one (B53)
    setJurInfo(null); setIdentifyRes({ busy: true });
    try {
      const [lat, lng] = feetToLatLng(fp, origin.lat, origin.lon);
      if (!idLayerRef.current) {
        const cm = COUNTIES_MAP[siteCounty] || COUNTIES_MAP.harris;
        idLayerRef.current = cm.layerUrl || await resolveLayerUrl(cm.mapServer || COUNTIES[siteCounty]?.layerUrl || COUNTIES.harris.layerUrl);
      }
      const feat = await queryAtPoint(idLayerRef.current, lng, lat);
      if (tok !== identifyTok.current) return; // superseded by a newer click — don't clobber its result
      if (!feat) { setIdentifyRes({ error: "No parcel at that point." }); return; }
      const rings = outerRingsLngLat(feat); // every part of a multipart parcel
      if (!rings.length) { setIdentifyRes({ error: "That record has no polygon shape." }); return; }
      // `ring` (largest part) still drives the whole-parcel jurisdiction/road tests below; `rings` adds every part for import.
      setIdentifyRes({ attrs: feat.attributes || {}, rings, ring: largestRingLngLat(feat), lng, lat, addr: findAttr(feat.attributes, /(situs|site_?addr|prop_?addr|loc_?addr|full_?addr|^addr|address)/i) });
    } catch (e) { if (tok === identifyTok.current) setIdentifyRes({ error: humanizeError(e) }); }
  };
  const addIdentifiedParcel = () => {
    if (!identifyRes?.rings?.length || !origin) return;
    // Add EVERY part of a multipart parcel (e.g. "TRS 3 & 5"), all in the site frame.
    const pcs = identifyRes.rings
      .map((r) => ({ id: uid(), points: lngLatRingToFeet(r, origin.lon, origin.lat), locked: true, addr: identifyRes.addr || null, attrs: identifyRes.attrs || null }))
      .filter((pc) => pc.points.length >= 3);
    if (!pcs.length) return;
    pushHistory();
    setParcels((a) => [...a, ...pcs]);
    setSel({ kind: "parcel", id: pcs[pcs.length - 1].id });
    setIdentifyRes(null); setJurInfo(null); setIdentifyMode(false);
  };
  const [siteLabel, setSiteLabel] = useState(() => restored?.site || restored?.name || "Untitled site");
  const [planLabel, setPlanLabel] = useState(() => restored?.name || "Plan 1");
  const commitSiteLabel = (v) => { const n = (v || "").trim() || "Untitled site"; setSiteLabel(n); onRenameSite?.(groupId, n); };
  const commitPlanLabel = (v) => { const n = (v || "").trim() || "Untitled plan"; setPlanLabel(n); onRenamePlan?.(siteId, n); };
  const siteName = `${siteLabel} · ${planLabel}`; // used for export filenames / print header
  // Keep the save metadata current (so the first non-blank save is fully formed).
  useEffect(() => { metaRef.current = { site: siteLabel, name: planLabel, groupId, county: restored?.county ?? null, origin: restored?.origin ?? null }; });
  // Multi-site switching: flush this site's live state first so nothing in the
  // last debounce window is lost (and a Duplicate clones the very latest edits).
  const flushSite = () => { if (siteId && !isBlankSite(liveRef.current)) saveSite({ id: siteId, ...metaRef.current, ...liveRef.current }); };
  const closeHdrMenus = () => { setSiteMenu(false); setPlanMenu(false); };
  // Version history (automatic local backups, B126): open the dialog with this plan's
  // saved snapshots, and restore one into the canvas (which then autosaves as the newest
  // version — and the thinner state it replaces is itself snapshotted, so a restore is
  // reversible). Geometry is fully restored; any stripped backdrop image may need re-dropping.
  const openVersionHistory = () => { setVersionList(listVersions(siteId)); setVersionsOpen(true); closeHdrMenus(); };
  const restoreVersion = (at) => {
    const v = getVersion(siteId, at);
    if (!v) return;
    pushHistory();
    setParcels(v.parcels); setEls(v.els); setMeasures(v.measures); setCallouts(v.callouts); setMarkups(v.markups);
    setUnderlay(v.underlay); setSheetOverlays(v.sheetOverlays);
    setSel(null); setMulti([]); setVersionsOpen(false);
  };
  const handleNewSite = () => { closeHdrMenus(); flushSite(); onNewSite?.(); };
  const handleOpenSite = (id) => { closeHdrMenus(); if (id === siteId) return; flushSite(); onOpenSite?.(id); };
  const handleDuplicate = () => { closeHdrMenus(); flushSite(); onDuplicateSite?.(siteId); };
  const handleNewPlan = () => { closeHdrMenus(); flushSite(); onNewPlanSameParcel?.(siteId); };
  const fileSlug = () => (siteName || "site-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "site-plan";
  const exportJSON = () => {
    const blob = new Blob([JSON.stringify({ parcels, els, measures, callouts, markups, settings, underlay }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${fileSlug()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* ------------ export (PNG / print-to-PDF) ------------ */
  // Snapshot the live SVG cropped to the site, with editor chrome (grid,
  // handles, scale bar) stripped via data-export="skip" tags.
  // Bounding box (feet) of the development — the placed elements, not bare parcels.
  const DEV_TYPES = ["building", "paving", "parking", "trailer", "pond", "road"];
  const devExtent = () => {
    const pts = [];
    els.forEach((e) => { if (!DEV_TYPES.includes(e.type)) return; e.points ? pts.push(...e.points) : pts.push(...elCorners(e)); });
    if (!pts.length) return null;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
  };
  const buildExportSvg = (frame, includeOverlay = true) => {
    if (!svgRef.current) return null;
    let x, y, w, h;
    if (frame) { // explicit print crop (feet) → exact paper-aspect viewBox
      const a = f2p({ x: frame.cx - frame.wFt / 2, y: frame.cy - frame.hFt / 2 });
      const b = f2p({ x: frame.cx + frame.wFt / 2, y: frame.cy + frame.hFt / 2 });
      x = Math.min(a.x, b.x); y = Math.min(a.y, b.y); w = Math.abs(b.x - a.x); h = Math.abs(b.y - a.y);
    } else {
      let pts = [];
      const dev = devExtent();
      if (dev) pts = [{ x: dev.cx - dev.w / 2, y: dev.cy - dev.h / 2 }, { x: dev.cx + dev.w / 2, y: dev.cy + dev.h / 2 }];
      else { parcels.forEach((p) => pts.push(...p.points)); els.forEach((e) => (e.points ? pts.push(...e.points) : pts.push(...elCorners(e)))); }
      if (!pts.length && underlay) {
        const sy = underlay.ftPerPxY || underlay.ftPerPx;
        pts = [{ x: underlay.x, y: underlay.y }, { x: underlay.x + underlay.imgW * underlay.ftPerPx, y: underlay.y + underlay.imgH * sy }];
      }
      if (!pts.length) return null;
      const PAD = 60; // ft of margin around the site
      const minX = Math.min(...pts.map((p) => p.x)) - PAD, maxX = Math.max(...pts.map((p) => p.x)) + PAD;
      const minY = Math.min(...pts.map((p) => p.y)) - PAD, maxY = Math.max(...pts.map((p) => p.y)) + PAD;
      const a = f2p({ x: minX, y: minY }), b = f2p({ x: maxX, y: maxY });
      x = Math.min(a.x, b.x); y = Math.min(a.y, b.y); w = Math.abs(b.x - a.x); h = Math.abs(b.y - a.y);
    }
    const clone = svgRef.current.cloneNode(true);
    clone.querySelectorAll('[data-export="skip"]').forEach((n) => n.remove());
    clone.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
    clone.setAttribute("preserveAspectRatio", "xMidYMid meet"); // scale to fill the box, centered
    clone.setAttribute("width", Math.round(w));
    clone.setAttribute("height", Math.round(h));
    clone.removeAttribute("style");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("x", x); bg.setAttribute("y", y); bg.setAttribute("width", w); bg.setAttribute("height", h);
    bg.setAttribute("fill", PAL.paper);
    clone.insertBefore(bg, clone.firstChild);
    // Always include the aerial underlay (even if it's hidden on screen), placed
    // beneath everything but the paper, so prints/exports keep the satellite.
    if (underlay) {
      clone.querySelectorAll('image:not([data-overlay-image])').forEach((n) => n.remove()); // drop any live aerial copy — keep the placed site-plan overlays (handled below)
      const tl = f2p({ x: underlay.x, y: underlay.y });
      const sy = underlay.ftPerPxY || underlay.ftPerPx;
      const im = document.createElementNS("http://www.w3.org/2000/svg", "image");
      im.setAttribute("href", underlay.src);
      im.setAttributeNS("http://www.w3.org/1999/xlink", "href", underlay.src);
      im.setAttribute("x", tl.x); im.setAttribute("y", tl.y);
      im.setAttribute("width", underlay.imgW * underlay.ftPerPx * view.ppf);
      im.setAttribute("height", underlay.imgH * sy * view.ppf);
      im.setAttribute("preserveAspectRatio", "none");
      im.setAttribute("opacity", underlay.opacity ?? 1);
      clone.insertBefore(im, bg.nextSibling);
    }
    // Site-plan overlays (B72) obey the print dialog's "Print overlay" toggle (B131):
    // off → drop every placed overlay raster (its editor chrome + any unsynced
    // placeholder already left via data-export="skip"); on → the cloned <image>s keep
    // their exact on-screen transform — feet→pixel position, scale, rotation, opacity,
    // and the rasterized page — composited above the aerial backdrop in the same z-order.
    if (!includeOverlay) clone.querySelectorAll('[data-overlay-image]').forEach((n) => n.remove());
    // Sheet furniture for the export — a measurement-grade graphic scale bar
    // (bottom-right) and a north arrow (top-left), both on a translucent
    // legibility plate. Sized in OUTPUT units and anchored to the export FRAME
    // (lib/sheetFurniture.js) so they sit fully inside a safe-area inset, never
    // clip, and print at a fixed physical size on the page — unlike the screen
    // overlays (data-export="skip", already removed above) which are sized for the
    // live viewport. ftPerUnit = feet per viewBox user unit (one foot == view.ppf
    // user units). The planner canvas is north-up, so the arrow points straight up.
    const furn = document.createElementNS("http://www.w3.org/2000/svg", "g");
    furn.setAttribute("font-family", "Inter, system-ui, sans-serif");
    furn.innerHTML = buildSheetFurnitureSvg({ x, y, w, h, ftPerUnit: 1 / view.ppf, fmtFeet: f0, pal: PAL });
    clone.appendChild(furn);
    return { clone, w, h };
  };
  // Rasterizing/printing an SVG can't fetch remote resources, so inline every
  // <image> (the aerial) as a data URL first. Drops any that are CORS-blocked.
  const inlineImages = async (root, dropOnFail = true) => {
    const XL = "http://www.w3.org/1999/xlink";
    for (const img of root.querySelectorAll("image")) {
      const href = img.getAttribute("href") || img.getAttributeNS(XL, "href");
      if (href && !href.startsWith("data:")) {
        try {
          const blob = await fetch(href, { mode: "cors" }).then((r) => { if (!r.ok) throw new Error(); return r.blob(); });
          const dataUrl = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
          img.setAttribute("href", dataUrl); img.removeAttributeNS(XL, "href");
        } catch (_) { if (dropOnFail) img.remove(); } // print keeps the remote href as a fallback
      }
    }
  };
  const exportPNG = async () => {
    const built = buildExportSvg(printFrame); // use the print crop if one's set, else dev extent
    if (!built) { alert("Nothing to export yet — add a parcel or some elements first."); return; }
    const { clone, w, h } = built;
    await inlineImages(clone); // embed the aerial so the raster includes it
    const xml = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((res, rej) => { image.onload = res; image.onerror = () => rej(new Error("image load failed")); image.src = url; });
      const scale = Math.max(1, Math.min(3, 3500 / Math.max(w, h))); // crisp but bounded
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale);
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((png) => {
        if (!png) { alert("Couldn't render the PNG (the framed area may be too large). Try a tighter print frame, or use Print to PDF."); return; }
        const aEl = document.createElement("a");
        aEl.href = URL.createObjectURL(png);
        aEl.download = `${fileSlug()}.png`;
        aEl.click();
        URL.revokeObjectURL(aEl.href);
      }, "image/png");
    } catch (_) {
      // image.onerror, a CORS-tainted canvas (the aerial basemap), or drawImage failing
      // used to reject silently (unhandled) with no download — now surfaced (B50).
      alert("PNG export failed — the aerial basemap can taint the canvas (cross-origin). Turn the basemap off and retry, or use Print to PDF.");
    } finally { URL.revokeObjectURL(url); }
  };
  const printPDF = async (paper = "letter", orient = "landscape", includeOverlay = true) => {
    const built = buildExportSvg(printFrame, includeOverlay);
    if (!built) { alert("Nothing to print yet — add a parcel or some elements first."); return; }
    // Open the window synchronously (before any await) so it isn't pop-up-blocked.
    const win = window.open("", "_blank");
    if (!win) { alert("Pop-up blocked — allow pop-ups for this site to print."); return; }
    win.document.write("<!doctype html><title>Preparing…</title><body style='font-family:sans-serif;padding:24px;color:#555'>Preparing print…</body>");
    try {
    await inlineImages(built.clone, false); // embed the satellite (keep remote href if blocked)
    // Print clone is purely viewBox-driven (no px width/height that fight the CSS/zoom).
    built.clone.removeAttribute("width"); built.clone.removeAttribute("height");
    const ar = (built.w / built.h).toFixed(4); // plan box aspect = the framed crop
    const xml = new XMLSerializer().serializeToString(built.clone);
    const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); // also escape >/" so it's safe to reuse in an attribute/style context (B48)
    const pageCss = paper === "tabloid"
      ? (orient === "portrait" ? "11in 17in" : "17in 11in")
      : (orient === "portrait" ? "letter portrait" : "letter landscape");
    const rows = [
      ["Site area", `${f2(siteSqft / SQFT_PER_ACRE)} ac (${f0(siteSqft)} sf)`],
      ["Building", `${f0(bldg)} sf`],
      ["Lot coverage", `${f0(cov)}%`],
      ["FAR (1-story)", f2(far)],
      ["Car stalls", `${f0(stalls)}${ratio ? ` (${f2(ratio)}/1k sf)` : ""}`],
      ["Trailer stalls", f0(trailers)],
      ["Impervious", `${f0(impPct)}%`],
      ["Detention", `${f0(pondArea)} sf`],
      ["Open / green", `${f2(open / SQFT_PER_ACRE)} ac`],
    ];
    win.document.open();
    win.document.write(`<!doctype html><html><head><title>${esc(siteName)}</title><style>
      @page { size: ${pageCss}; margin: 8mm; }
      body{font-family:"Inter",system-ui,sans-serif;color:#26231e;margin:0}
      .sheet{box-sizing:border-box;border:1.5px solid #26231e;padding:8px}
      .title{display:flex;justify-content:space-between;align-items:baseline;border-bottom:1px solid #b8b1a0;padding-bottom:3px}
      .title h1{font-size:13px;margin:0;font-weight:600;line-height:1.2} .title .sub{font-size:9.5px;color:#6b6557}
      .plan{width:100%;aspect-ratio:${ar};margin:6px auto}
      .plan svg{width:100%;height:100%;display:block}
      .block{border-top:1px solid #b8b1a0;padding-top:3px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-size:9.5px;line-height:1.2}
      .metrics{display:flex;flex-wrap:wrap;gap:2px 16px} .metrics b{font-variant-numeric:tabular-nums} .note{color:#8a8473;font-size:9px}
    </style></head><body>
      <div class="sheet">
        <div class="title"><h1>${esc(siteName)}</h1><span class="sub">${new Date().toLocaleDateString()} · Site Planyr</span></div>
        <div class="plan">${xml}</div>
        <div class="block">
          <div class="metrics">${rows.map(([k, v]) => `<span>${esc(k)}: <b>${esc(v)}</b></span>`).join("")}</div>
          <span class="note">Concept site plan — planning-level estimates, not a survey.</span>
        </div>
      </div>
    </body></html>`);
    win.document.close();
    // Print once the aerial has loaded (or after a beat if it's cached/absent).
    const go = () => setTimeout(() => { try { win.focus(); win.print(); } catch (_) {} }, 350);
    if (win.document.readyState === "complete") go(); else win.onload = go;
    } catch (_) {
      try { win.close(); } catch (e2) {} // don't strand a blank "Preparing…" window if inlining/serialization threw (B50)
      alert("Couldn't prepare the print view — the aerial basemap may have blocked it. Turn the basemap off and retry.");
    }
  };

  /* ------------ print-frame placement ------------ */
  // [wIn, hIn] of the chosen paper + orientation; aspect = w / h.
  const paperDims = (paper, orient) => { const [lng, sht] = paper === "tabloid" ? [17, 11] : [11, 8.5]; return orient === "portrait" ? [sht, lng] : [lng, sht]; };
  // The frame matches the PRINTABLE area (paper minus @page margins and the
  // title/metrics chrome), so the plan fills both dimensions with no slack.
  const PRINT_MARGIN_IN = 0.315, PRINT_PAD_W_IN = 0.18, PRINT_CHROME_H_IN = 0.85;
  const printableDims = (paper, orient) => { const [pw, ph] = paperDims(paper, orient); return [pw - 2 * PRINT_MARGIN_IN - PRINT_PAD_W_IN, ph - 2 * PRINT_MARGIN_IN - PRINT_CHROME_H_IN]; };
  const printAspect = () => { const [w, h] = printableDims(printPaper, printOrient); return w / h; };
  // A frame of the given aspect, centred at cx,cy, that contains a w×h area.
  const fitFrame = (cx, cy, w, h, aspect) => { const wFt = Math.max(w, h * aspect, 40); return { cx, cy, wFt, hFt: wFt / aspect }; };
  const enterPrintMode = () => {
    const aspect = printAspect(), dev = devExtent();
    let base;
    if (dev) base = { cx: dev.cx, cy: dev.cy, w: dev.w + 80, h: dev.h + 80 };
    else { const a = p2fStatic(0, 0), b = p2fStatic(size.w, size.h); base = { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: Math.abs(b.x - a.x) * 0.8, h: Math.abs(b.y - a.y) * 0.8 }; }
    setPrintFrame(fitFrame(base.cx, base.cy, base.w, base.h, aspect));
    setPrintOverlay(hasPrintableOverlay(sheetOverlays)); // default "Print overlay" to match on-screen visibility (WYSIWYG)
    setPrintMode(true); setExportMenu(false); setSel(null);
  };
  // Re-fit the frame's aspect when paper/orientation changes (keep it around the
  // same coverage). Skip the initial render.
  const printAspectKey = `${printPaper}:${printOrient}`;
  const prevAspectKey = useRef(printAspectKey);
  useEffect(() => {
    if (prevAspectKey.current === printAspectKey) return;
    prevAspectKey.current = printAspectKey;
    if (printMode) setPrintFrame((f) => f ? fitFrame(f.cx, f.cy, f.wFt, f.hFt, printAspect()) : f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printAspectKey]);
  const overlayPrintable = hasPrintableOverlay(sheetOverlays); // gates the "Print overlay" checkbox — no dead control when nothing's loaded
  const doPrint = () => { const p = printPaper, o = printOrient, ov = printOverlay; setPrintMode(false); setTimeout(() => printPDF(p, o, ov), 60); };
  const startPrintMove = (e) => {
    e.stopPropagation();
    const fp = p2f(e.clientX, e.clientY);
    drag.current = { mode: "printMove", fx: fp.x, fy: fp.y, cx: printFrame.cx, cy: printFrame.cy };
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const startPrintResize = (e, sx, sy) => {
    e.stopPropagation();
    const opp = { x: printFrame.cx - sx * printFrame.wFt / 2, y: printFrame.cy - sy * printFrame.hFt / 2 };
    drag.current = { mode: "printResize", sx, sy, opp };
    svgRef.current.setPointerCapture(e.pointerId);
  };

  /* ------------ grid lines ------------ */
  const gridLines = () => {
    const out = [];
    const minF = p2fStatic(0, 0), maxF = p2fStatic(size.w, size.h);
    const step = Math.max(0.1, +settings.gridSize || 10); // guard: a 0/negative grid size would loop forever
    const major = step * 10;
    const startX = Math.floor(minF.x / step) * step, endX = Math.ceil(maxF.x / step) * step;
    const startY = Math.floor(minF.y / step) * step, endY = Math.ceil(maxF.y / step) * step;
    // cap line count for performance at low zoom
    if ((endX - startX) / step > 600 || (endY - startY) / step > 600) {
      // only majors
      for (let x = Math.floor(minF.x / major) * major; x <= maxF.x; x += major) {
        const px = x * view.ppf + view.offX;
        out.push(<line key={`gx${x}`} x1={px} y1={0} x2={px} y2={size.h} stroke={PAL.gridMajor} strokeWidth={1} />);
      }
      for (let y = Math.floor(minF.y / major) * major; y <= maxF.y; y += major) {
        const py = y * view.ppf + view.offY;
        out.push(<line key={`gy${y}`} x1={0} y1={py} x2={size.w} y2={py} stroke={PAL.gridMajor} strokeWidth={1} />);
      }
      return out;
    }
    for (let x = startX; x <= endX; x += step) {
      const px = x * view.ppf + view.offX;
      out.push(<line key={`gx${x}`} x1={px} y1={0} x2={px} y2={size.h} stroke={Math.round(x) % major === 0 ? PAL.gridMajor : PAL.gridMinor} strokeWidth={1} />);
    }
    for (let y = startY; y <= endY; y += step) {
      const py = y * view.ppf + view.offY;
      out.push(<line key={`gy${y}`} x1={0} y1={py} x2={size.w} y2={py} stroke={Math.round(y) % major === 0 ? PAL.gridMajor : PAL.gridMinor} strokeWidth={1} />);
    }
    return out;
  };
  // static p2f that doesn't need the DOM rect (uses view only, origin at svg 0,0)
  const p2fStatic = (px, py) => ({ x: (px - view.offX) / view.ppf, y: (py - view.offY) / view.ppf });

  /* labels + handles in screen space */
  // Labels scale with zoom so they stay proportional to the plan when zoomed
  // out (no ballooning chips), capping at a comfortable size when zoomed in.
  const ls = Math.max(0.34, Math.min(1, view.ppf / 0.45));
  const NO_LABEL = ["paving", "parking", "road"]; // truck courts / employee parking / roads stay unlabelled
  // B122: each standalone building shows a sequential "Building N" by placement order,
  // derived from list position (a delete renumbers the rest 1…N); identity stays el.id.
  const bldgNo = buildingNumbers(els);
  const fs = 11 * ls, lh = 14.5 * ls, charW = fs * 0.6;
  // B121: build each element's centred label as priority-ordered lines (name → area →
  // dimensions, highest priority first), then hand them all to the shared LOD + collision
  // engine (lib/labelLayout) so adjacent labels never overprint into an unreadable pile.
  // The engine drops a label's lowest lines (dimensions first) to fit a narrow shape or
  // dodge a neighbour, and hides it only as a last resort; bigger elements and buildings
  // win the space. Zoomed in, shapes are large and spread out, so all lines show as before.
  const seenLabels = new Set(); // suppress duplicate overlapping callouts (e.g. two stacked sidewalks)
  const labelCands = [];
  for (const el of els) {
    if (NO_LABEL.includes(el.type) || el.noLabel) continue;
    const poly = !!el.points;
    const area = poly ? polyArea(el.points) : el.w * el.h;
    let fc = poly ? centroid(el.points) : { x: el.cx, y: el.cy };
    const dupKey = `${el.type}@${Math.round(fc.x / 12)},${Math.round(fc.y / 12)}`;
    if (seenLabels.has(dupKey)) continue; // same type stacked at (nearly) the same spot
    seenLabels.add(dupKey);
    let lines, pondAdd = null;
    if (el.type === "sidewalk" || el.type === "landscape") {
      // e.g. "5′ Sidewalk" / "5′ Landscape" — width only, no sf / length
      const name = el.type === "landscape" ? "Landscape" : "Sidewalk";
      lines = [poly ? name : `${f0(Math.min(el.w, el.h))}′ ${name}`];
    } else if (el.type === "pond") {
      // B140/B157: label shows acres + sf (was sf only). In expansion mode (B139) the
      // EXISTING basin keeps this centred label; the ADDED ground gets its OWN label seated
      // over the new area (B157 `pondAdd`, pushed below) so the "+X ac" never floats over the
      // old pond — the case where the whole-pond centroid stays inside the existing basin. If
      // the change is a net shrink (or too small to seat a label on the new ground) we fall
      // back to the inline "+/−" increment so the delta still shows.
      const base = el.det?.baseline;
      if (base?.ring?.length >= 3) {
        const exA = polyArea(base.ring), addA = area - exA;
        const pt = addA > POND_ADD_MIN_SF ? addedAreaLabelPoint(poly ? el.points : elCorners(el), base.ring) : null;
        // Seat the EXISTING-area label over the existing basin (baseline centroid), not the
        // whole-pond centre — so it reads over the old pond and clears the "+added" label.
        fc = centroid(base.ring);
        lines = ["Existing Detention Pond", `${f2(exA / SQFT_PER_ACRE)} ac · ${f0(exA)} sf`];
        if (pt) pondAdd = { pt, addA };
        else { const s = addA >= 0 ? "+" : "−", m = Math.abs(addA); lines.push(`${s}${f2(m / SQFT_PER_ACRE)} ac · ${s}${f0(m)} sf`); }
      } else {
        lines = ["Detention Pond", `${f2(area / SQFT_PER_ACRE)} ac · ${f0(area)} sf`];
      }
    } else {
      const bn = bldgNo.get(el.id); // B122: a standalone building shows "Building N"
      const name = bn ? `Building ${bn}` : TYPE[el.type].label.split(" / ")[0];
      if (el.type === "building" && !poly && !el.dogEar) {
        // B123: the building label is a 4-line stack — name / sf / (incl. N bump-outs) /
        // dims. sf is its own line and sits high in the drop order (lib/labelLayout), so it
        // survives zoom-out far longer than the dimensions; the parenthetical shows only
        // when the building has bump-outs (whose area is folded into the on-plan sf).
        const bumps = els.filter((x) => x.attachedTo === el.id && x.dogEar);
        const ba = bumps.reduce((s, b) => s + b.w * b.h, 0);
        lines = buildingLabelLines({ name, sqft: `${f0(area + ba)} sf`, bumpCount: bumps.length, dims: `${f0(el.w)}′ × ${f0(el.h)}′` });
      } else {
        lines = [name];
        if (el.type === "trailer") lines.push(`${f0(poly ? estTrailers(area, settings) : trailerStalls(el.w, el.h, cfgOf(el)).count)} trailers${poly ? " (est)" : ""}`);
        else lines.push(`${f0(area)} sf`);
        lines.push(poly ? `${f2(area / SQFT_PER_ACRE)} ac` : `${f0(el.w)}′ × ${f0(el.h)}′`);
      }
    }
    // Shape's on-screen bounding half-extents (rotation-aware for rects). halfH drives the
    // level-of-detail height fit; when a label is wider than 2·halfW the engine pulls it
    // outside the shape with a leader line instead of overflowing a narrow / small shape.
    let halfW, halfH;
    if (poly) {
      let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
      for (const p of el.points) { lo = Math.min(lo, p.x); hi = Math.max(hi, p.x); lo2 = Math.min(lo2, p.y); hi2 = Math.max(hi2, p.y); }
      halfW = ((hi - lo) / 2) * view.ppf; halfH = ((hi2 - lo2) / 2) * view.ppf;
    } else {
      const rad = ((el.rot || 0) * Math.PI) / 180, cw = Math.abs(Math.cos(rad)), sw = Math.abs(Math.sin(rad));
      halfW = ((el.w / 2) * cw + (el.h / 2) * sw) * view.ppf;
      halfH = ((el.w / 2) * sw + (el.h / 2) * cw) * view.ppf;
    }
    labelCands.push({ el, lid: el.id, c: f2p(fc), lines, importance: (bldgNo.has(el.id) ? 1e12 : 0) + area, halfW, halfH });
    if (pondAdd) {
      // B157: the added-detention label, seated on the thickest part of the NEW ground.
      // Rides the SAME LOD/collision pool (its own label id) — not a parallel renderer.
      const a = pondAdd.addA;
      labelCands.push({ el, lid: `${el.id}#add`, added: true, c: f2p(pondAdd.pt),
        lines: ["Additional Detention", `+${f2(a / SQFT_PER_ACRE)} ac · +${f0(a)} sf`], importance: area + 1, halfW, halfH });
    }
  }
  const labelShow = layoutLabels(
    labelCands.map((d) => ({ id: d.lid, cx: d.c.x, cy: d.c.y, lines: d.lines, lh, charW, halfW: d.halfW, halfH: d.halfH })),
    { pad: 2 },
  );
  const labelEls = labelCands.map((d) => {
    const place = labelShow.get(d.lid);
    if (!place) return null; // hidden this frame to avoid overprinting a higher-priority label
    const { lines, x, y, leader } = place;
    const top = y - (lines.length * lh) / 2, first = top + fs * 0.82;
    // Inside labels contrast against the element fill; a leadered label sits OUT on the paper,
    // so ink it dark with a white halo to read over any background (B121 round 2b).
    const ink = leader ? PAL.ink : labelInk(elStyle(d.el, settings).fill);
    return (
      <g key={`lbl${d.lid}`} pointerEvents="none">
        {leader && <line x1={leader.x} y1={leader.y} x2={x} y2={top + lines.length * lh} stroke={PAL.ink} strokeWidth={1} opacity={0.5} />}
        {!d.added && d.el.locked && <text x={x} y={top - 3 * ls} textAnchor="middle" fontSize={12 * ls}>🔒</text>}
        <text x={x} y={first} textAnchor="middle" fontSize={fs}
          fontFamily="ui-monospace, Menlo, monospace" fill={ink}
          stroke={leader ? "#fff" : undefined} strokeWidth={leader ? 3 * ls : undefined} paintOrder={leader ? "stroke" : undefined}
          style={{ fontWeight: 600, letterSpacing: "0.02em" }}>
          {lines.map((t, i) => <tspan key={i} x={x} dy={i === 0 ? 0 : lh}>{t}</tspan>)}
        </text>
      </g>
    );
  });

  const parcelLabels = parcels.map((pc) => {
    const c = f2p(centroid(pc.points));
    const txt = `${f2(polyArea(pc.points) / SQFT_PER_ACRE)} ac`;
    const fs = 12 * ls, padX = 9 * ls, padY = 5 * ls, charW = fs * 0.6;
    const boxW = txt.length * charW + padX * 2, boxH = fs + padY * 2;
    return (
      <g key={`pl${pc.id}`} pointerEvents="none">
        <rect x={c.x - boxW / 2} y={c.y - boxH / 2} width={boxW} height={boxH} rx={7 * ls}
          fill="rgba(17,24,39,0.62)" stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
        <text x={c.x} y={c.y - boxH / 2 + padY + fs * 0.82} textAnchor="middle" fontSize={fs}
          fontFamily="ui-monospace, Menlo, monospace" fill="#e9edf2" style={{ fontWeight: 500, letterSpacing: "0.02em" }}>{txt}</text>
      </g>
    );
  });

  // Dashed tethers between the selected element and anything bonded to it.
  const attachLinks = (() => {
    if (sel?.kind !== "el") return null;
    const members = assemblyOf(sel.id);
    if (members.length < 2) return null;
    const ctr = (m) => (m.points ? centroid(m.points) : { x: m.cx, y: m.cy });
    const sc = f2p(ctr(els.find((x) => x.id === sel.id)));
    return (
      <g pointerEvents="none">
        {members.filter((m) => m.id !== sel.id).map((m) => {
          const p = f2p(ctr(m));
          return <line key={`lk${m.id}`} x1={sc.x} y1={sc.y} x2={p.x} y2={p.y} stroke={PAL.accent} strokeWidth={1} strokeDasharray="3 3" opacity={0.7} />;
        })}
      </g>
    );
  })();

  // "+" quick-add handles on a selected building:
  //  • each long (dock-capable) side: a 135′ truck dock + drive (orange)
  //  • each long-side corner: a 55′×60′ bump-out (purple)
  // A side/corner handle: a coloured "+" to add a feature, or a red "−" to
  // remove the one already there (so a feature can't be stacked twice).
  const featNode = (key, pos, exists, color, addTitle, onAdd, onRemove, r = 9) => (
    <g key={key} style={{ cursor: "pointer" }} onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); exists ? onRemove() : onAdd(); }}>
      <title>{exists ? "Remove this — click to subtract" : addTitle}</title>
      <circle cx={pos.x} cy={pos.y} r={r} fill={exists ? "#b91c1c" : color} stroke="#ffffff" strokeWidth={1.75} />
      <line x1={pos.x - r * 0.5} y1={pos.y} x2={pos.x + r * 0.5} y2={pos.y} stroke="#ffffff" strokeWidth={1.75} />
      {!exists && <line x1={pos.x} y1={pos.y - r * 0.5} x2={pos.x} y2={pos.y + r * 0.5} stroke="#ffffff" strokeWidth={1.75} />}
    </g>
  );
  const sideAddNodes = (() => {
    if (sel?.kind !== "el" || tool !== "select") return null;
    const el = els.find((x) => x.id === sel.id);
    if (el && el.locked) return null;
    // dog-ears / bump-outs are building elements but are NOT standalone buildings —
    // they don't get their own dock / sidewalk / trailer handles.
    if (!el || el.type !== "building" || el.points || el.dogEar) return null;
    const { dockSides } = dockSidesOf(el);
    const kids = els.filter((x) => x.attachedTo === el.id);
    const cpx = f2p({ x: el.cx, y: el.cy });
    const sides = [["top", 0, -1], ["bottom", 0, 1], ["left", -1, 0], ["right", 1, 0]];
    return (
      <g>
        {sides.map(([name, nx, ny]) => {
          const o = rot2(nx * el.w / 2, ny * el.h / 2, el.rot);
          const ms = f2p({ x: el.cx + o.x, y: el.cy + o.y });
          let ux = ms.x - cpx.x, uy = ms.y - cpx.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
          const pos = { x: ms.x - ux * 22, y: ms.y - uy * 22 }; // just inside the wall
          if (dockSides.includes(name)) { // long side → truck dock + drive
            const existing = kids.find((x) => x.truckCourt && x.truckCourt.side === name);
            return featNode(`add${name}`, pos, !!existing, "#b45309", `Add ${TRUCK_COURT_D}′ truck dock + drive`,
              () => addStripSide(el, nx, ny, "paving", TRUCK_COURT_D, { truckCourt: { side: name } }),
              existing ? () => removeFeature(existing.id) : null);
          }
          // short (non-dock) side → progress: + sidewalk → + parking row → − parking
          const sw = kids.find((x) => isWallStrip(x) && !x.points && sideOfKid(el, x) === name);
          const park = kids.find((x) => x.sideParkSide === name);
          return featNode(`add${name}`, pos, !!park,
            sw ? "#2563eb" : "#16a34a",
            sw ? "Add a parking row + drive aisle" : `Add ${SIDEWALK_W}′ sidewalk`,
            sw ? () => addParkingRowSide(el, name) : () => addSidewalkSide(el, name),
            park ? () => removeFeature(park.id) : null);
        })}
        {/* dog-ear bump-outs at each corner of every dock side */}
        {dockSides.flatMap((name) => {
          const [nx, ny] = SIDE_N[name];
          const alongIsX = ny !== 0;
          return [1, -1].map((sign) => {
            const cl = alongIsX ? { x: sign * el.w / 2, y: ny * el.h / 2 } : { x: nx * el.w / 2, y: sign * el.h / 2 };
            const co = rot2(cl.x, cl.y, el.rot);
            const cs = f2p({ x: el.cx + co.x, y: el.cy + co.y });
            let dx = cs.x - cpx.x, dy = cs.y - cpx.y; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
            const pos = { x: cs.x - dx * 20, y: cs.y - dy * 20 }; // just inside the corner (in the footprint)
            const existing = kids.find((x) => x.dogEar && x.dogEar.side === name && x.dogEar.sign === sign);
            return featNode(`dog${name}${sign}`, pos, !!existing, "#7c3aed", `Add ${DOGEAR_W}′×${DOGEAR_D}′ bump-out`, () => placeDogEars(el, [[name, sign]]), existing ? () => removeDogEar(el, existing) : null);
          });
        })}
      </g>
    );
  })();

  // "+" / "−" on a selected TRUCK COURT, on its far (outer) edge — where trailer
  // parking backs in. Adds 50′ striped trailer parking, or removes it if present.
  const courtAddNodes = (() => {
    if (sel?.kind !== "el" || tool !== "select") return null;
    const el = els.find((x) => x.id === sel.id);
    if (!el || el.locked || el.points || !el.truckCourt) return null;
    const existing = els.find((x) => x.forCourt === el.id);
    const [nx, ny] = SIDE_N[el.truckCourt.side];
    const o = rot2(nx * el.w / 2, ny * el.h / 2, el.rot);
    const ms = f2p({ x: el.cx + o.x, y: el.cy + o.y });        // outer-edge midpoint
    const cpx = f2p({ x: el.cx, y: el.cy });
    let ux = ms.x - cpx.x, uy = ms.y - cpx.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const pos = { x: ms.x - ux * 22, y: ms.y - uy * 22 };      // just inside the outer edge
    return <g>{featNode("courtTrailer", pos, !!existing, "#0e7490", `Add ${OPP_TRAILER_D}′ striped trailer parking on the court's far side`, () => addCourtTrailer(el), existing ? () => removeFeature(existing.id) : null)}</g>;
  })();

  // Grow a parking field one row deeper (keeping its near edge fixed); the stall
  // striping auto-fills the new depth. Loops, so you can stack rows/aisles.
  const growParking = (el, dir = 1) => {
    const cfg = cfgOf(el);
    const sd = cfg.stallDepth || settings.stallDepth, ai = cfg.aisle ?? settings.aisle;
    // Step exactly one row: 1 row + aisle (single-loaded) → 2 rows, same aisle
    // (double-loaded) → +aisle + row (new bay) → … never a two-row module.
    const n = parkRowsForDepth(el.h, sd, ai);
    if (n + dir < 1) return;                                  // keep at least one row
    const newH = parkDepthForRows(n + dir, sd, ai);
    // Grow on the edge pointing AWAY from a host building (so it never grows over
    // it); for a free field this is just the +local-y edge.
    let outSign = 1;
    const host = el.attachedTo ? els.find((x) => x.id === el.attachedTo && !x.points) : null;
    if (host) {
      const yAxis = rot2(0, 1, el.rot); // +local-y in world
      outSign = (yAxis.x * (el.cx - host.cx) + yAxis.y * (el.cy - host.cy)) >= 0 ? 1 : -1;
    }
    const off = rot2(0, outSign * (newH - el.h) / 2, el.rot);
    pushHistory();
    setEls((a) => a.map((x) => x.id === el.id ? { ...x, h: newH, cx: x.cx + off.x, cy: x.cy + off.y } : x));
  };
  // Per-field stall depth / drive-aisle override. Resizes the field's depth to
  // keep its rows consistent, growing on the outward (non-host) edge.
  const setParkCfg = (el, patch) => {
    const cur = cfgOf(el);
    const rows = parkRowsForDepth(el.h, cur.stallDepth || settings.stallDepth, cur.aisle ?? settings.aisle);
    const ncfg = { ...(el.cfg || {}), ...patch };
    const newH = parkDepthForRows(rows, ncfg.stallDepth ?? settings.stallDepth, ncfg.aisle ?? settings.aisle);
    let outSign = 1;
    const host = el.attachedTo ? els.find((x) => x.id === el.attachedTo && !x.points) : null;
    if (host) { const yAxis = rot2(0, 1, el.rot); outSign = (yAxis.x * (el.cx - host.cx) + yAxis.y * (el.cy - host.cy)) >= 0 ? 1 : -1; }
    const off = rot2(0, outSign * (newH - el.h) / 2, el.rot);
    pushHistory();
    setEls((a) => a.map((x) => x.id === el.id ? { ...x, cfg: ncfg, h: newH, cx: x.cx + off.x, cy: x.cy + off.y } : x));
  };
  // Per-element curb width (NEW-3): default 6" (0.5′) or a heavier 12" (1.0′) curb
  // for trailer-tire/dolly abuse. The property lives globally on any band; only
  // trailer parking surfaces the control for now.
  const setCurbW = (el, wv) => { pushHistory(); setEls((a) => a.map((x) => x.id === el.id ? { ...x, curbW: wv } : x)); };
  // Split a striped parking field into independent DOUBLE-LOADED module elements
  // (each two stall rows sharing one drive aisle), plus a trailing single-loaded
  // row only for a remainder that can't pair — never one row + a full aisle each
  // (B130). Preserves position / rotation / total depth so each piece can be
  // edited or dragged, and the field's stall count is unchanged.
  const splitParkingRows = (el) => {
    if (!el || el.points || el.type !== "parking") return;
    const cfg = cfgOf(el);
    const sd = cfg.stallDepth || settings.stallDepth, ai = cfg.aisle ?? settings.aisle;
    const pieces = splitParkingPieces(el.h, sd, ai);  // module depths, summing to el.h
    if (pieces.length < 2) return;                    // ≤ one module: nothing to split
    pushHistory();
    let y = -el.h / 2;                                 // walk down the local depth axis
    const newEls = [];
    for (const ph of pieces) {
      const off = rot2(0, y + ph / 2, el.rot);        // piece centre in local depth
      newEls.push({ id: uid(), type: "parking", cx: el.cx + off.x, cy: el.cy + off.y, w: el.w, h: ph, rot: el.rot, ...(el.cfg ? { cfg: el.cfg } : {}), ...(el.attachedTo ? { attachedTo: el.attachedTo } : {}) });
      y += ph;
    }
    setEls((a) => [...a.filter((x) => x.id !== el.id), ...newEls]);
    setSel({ kind: "el", id: newEls[0].id });
  };
  // "+ / −" on a selected car-parking field's depth edge: add or remove a row +
  // drive aisle. Keeps stacking, so you can build a multi-aisle lot.
  const parkingAddNodes = (() => {
    if (sel?.kind !== "el" || tool !== "select") return null;
    const el = els.find((x) => x.id === sel.id);
    if (!el || el.locked || el.points || el.type !== "parking") return null;
    const o = rot2(0, el.h / 2, el.rot);              // +local-y depth edge midpoint
    const ms = f2p({ x: el.cx + o.x, y: el.cy + o.y });
    const cpx = f2p({ x: el.cx, y: el.cy });
    let ux = ms.x - cpx.x, uy = ms.y - cpx.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const tx = -uy, ty = ux;                          // tangent along the edge
    const plus = { x: ms.x + ux * 16 - tx * 12, y: ms.y + uy * 16 - ty * 12 };
    const minus = { x: ms.x + ux * 16 + tx * 12, y: ms.y + uy * 16 + ty * 12 };
    const canShrink = parkRowsForDepth(el.h, cfgOf(el).stallDepth || settings.stallDepth, cfgOf(el).aisle ?? settings.aisle) > 1;
    return (
      <g>
        {featNode("parkAdd", plus, false, "#2563eb", "Add one parking row", () => growParking(el, 1), null)}
        {canShrink && featNode("parkSub", minus, true, "#b91c1c", "", null, () => growParking(el, -1))}
      </g>
    );
  })();

  const handleNodes = (() => {
    if (sel?.kind !== "el") return null;
    const el = els.find((x) => x.id === sel.id);
    if (!el || el.points || el.locked) return null; // locked / polygon: no resize/rotate handles
    const corners = elCorners(el).map(f2p);
    const signs = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const topMid = f2p({ x: el.cx + rot2(0, -el.h / 2, el.rot).x, y: el.cy + rot2(0, -el.h / 2, el.rot).y });
    const cpx = f2p({ x: el.cx, y: el.cy });
    let ux = topMid.x - cpx.x, uy = topMid.y - cpx.y;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const rotPos = { x: topMid.x + ux * 26, y: topMid.y + uy * 26 };
    return (
      <g>
        <line x1={topMid.x} y1={topMid.y} x2={rotPos.x} y2={rotPos.y} stroke={PAL.accent} strokeWidth={1.25} />
        <circle cx={rotPos.x} cy={rotPos.y} r={6} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5}
          style={{ cursor: "grab" }} onPointerDown={(e) => startRotate(e, el.id)} />
        {corners.map((c, i) => (
          <rect key={i} x={c.x - 5} y={c.y - 5} width={10} height={10} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5}
            style={{ cursor: resizeCursor(c.x - cpx.x, c.y - cpx.y) }} onPointerDown={(e) => startResize(e, el.id, signs[i][0], signs[i][1])} />
        ))}
        {/* side grips: drag one edge to expand/shrink that side (opposite side stays put) */}
        {[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([nx, ny], i) => {
          const o = rot2(nx * el.w / 2, ny * el.h / 2, el.rot);
          const m = f2p({ x: el.cx + o.x, y: el.cy + o.y });
          return (
            <rect key={`edge${i}`} x={m.x - 4.5} y={m.y - 4.5} width={9} height={9} rx={2}
              fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
              style={{ cursor: resizeCursor(m.x - cpx.x, m.y - cpx.y) }}
              onPointerDown={(e) => startEdgeResize(e, el.id, nx, ny)} />
          );
        })}
      </g>
    );
  })();

  // Edge-length labels on the selected parcel (so you can read/trim frontage).
  const parcelEdgeLabels = (() => {
    if (sel?.kind !== "parcel") return null;
    const pc = parcels.find((p) => p.id === sel.id);
    if (!pc) return null;
    return pc.points.map((a, i) => {
      const b = pc.points[(i + 1) % pc.points.length];
      const am = f2p(a), bm = f2p(b);
      const mid = { x: (am.x + bm.x) / 2, y: (am.y + bm.y) / 2 };
      return (
        <text key={`pe${i}`} x={mid.x} y={mid.y} dy={-7} textAnchor="middle" fontSize="11"
          fontFamily="ui-monospace, Menlo, monospace" fill={PAL.ink} stroke={PAL.paper} strokeWidth={3}
          paintOrder="stroke" pointerEvents="none" fontWeight="600">{f0(dist(a, b))}′</text>
      );
    });
  })();

  // Draggable vertices + add-point (+) handles on the selected parcel (select tool).
  const parcelHandles = (() => {
    if (sel?.kind !== "parcel" || tool !== "select") return null;
    const pc = parcels.find((p) => p.id === sel.id);
    if (!pc) return null;
    const nodes = [];
    pc.points.forEach((a, i) => {
      const b = pc.points[(i + 1) % pc.points.length];
      const am = f2p(a), bm = f2p(b);
      const mid = { x: (am.x + bm.x) / 2, y: (am.y + bm.y) / 2 };
      nodes.push(
        <g key={`addv${i}`} style={{ cursor: "copy" }} onPointerDown={(e) => addVertex(e, pc.id, i)}>
          <circle cx={mid.x} cy={mid.y} r={5.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mid.x - 2.5} y1={mid.y} x2={mid.x + 2.5} y2={mid.y} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mid.x} y1={mid.y - 2.5} x2={mid.x} y2={mid.y + 2.5} stroke={PAL.accent} strokeWidth={1.25} />
        </g>
      );
    });
    pc.points.forEach((a, i) => {
      const c = f2p(a);
      nodes.push(
        <rect key={`pv${i}`} x={c.x - 5} y={c.y - 5} width={10} height={10} rx={2}
          fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
          style={{ cursor: "move" }} onPointerDown={(e) => startVertex(e, pc.id, i)} />
      );
    });
    return <g>{nodes}</g>;
  })();

  // Vertex handles on a selected polygon ELEMENT (e.g. a non-rectangular pond):
  // drag a dot to move a corner, click a ＋ on an edge to add one, Shift-click a
  // dot to delete it — same as parcels.
  const elPolyHandles = (() => {
    if (sel?.kind !== "el" || tool !== "select") return null;
    const el = els.find((x) => x.id === sel.id);
    if (!el || !el.points || el.locked) return null;
    const nodes = [];
    el.points.forEach((a, i) => {
      const b = el.points[(i + 1) % el.points.length];
      const am = f2p(a), bm = f2p(b);
      const mid = { x: (am.x + bm.x) / 2, y: (am.y + bm.y) / 2 };
      nodes.push(
        <g key={`eaddv${i}`} style={{ cursor: "copy" }} onPointerDown={(e) => addElVertex(e, el.id, i)}>
          <circle cx={mid.x} cy={mid.y} r={5.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mid.x - 2.5} y1={mid.y} x2={mid.x + 2.5} y2={mid.y} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mid.x} y1={mid.y - 2.5} x2={mid.x} y2={mid.y + 2.5} stroke={PAL.accent} strokeWidth={1.25} />
        </g>
      );
    });
    el.points.forEach((a, i) => {
      const c = f2p(a);
      nodes.push(
        <rect key={`epv${i}`} x={c.x - 5} y={c.y - 5} width={10} height={10} rx={2}
          fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
          style={{ cursor: "move" }} onPointerDown={(e) => startElVertex(e, el.id, i)} />
      );
    });
    return <g>{nodes}</g>;
  })();

  // Bluebeam-style editing chrome on a selected markup (select tool):
  //  • rect / ellipse → 4 corner + 4 edge resize grips + a rotate handle above the top edge
  //  • line / polyline / polygon → draggable vertex dots; ＋ on edges (poly) to add a point,
  //    Shift-click a dot to delete one
  // Semantic markups (utilRoute/traced/encumbrance/…) get no grips (move-only, as before).
  const markupHandles = (() => {
    if (sel?.kind !== "markup" || tool !== "select") return null;
    const m = markups.find((x) => x.id === sel.id);
    if (!m || m.locked) return null;
    if (MK_BOX_KINDS.includes(m.kind)) {
      const rot = m.rot || 0, cpx = f2p({ x: m.cx, y: m.cy });
      const at = (lx, ly) => { const o = rot2(lx, ly, rot); return f2p({ x: m.cx + o.x, y: m.cy + o.y }); };
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
      const edges = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      const topMid = at(0, -m.h / 2);
      let ux = topMid.x - cpx.x, uy = topMid.y - cpx.y; const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
      const rotPos = { x: topMid.x + ux * 26, y: topMid.y + uy * 26 };
      return (
        <g>
          <line x1={topMid.x} y1={topMid.y} x2={rotPos.x} y2={rotPos.y} stroke={PAL.accent} strokeWidth={1.25} />
          <circle cx={rotPos.x} cy={rotPos.y} r={6} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5}
            style={{ cursor: "grab" }} onPointerDown={(e) => startMarkupRotate(e, m.id)} />
          {edges.map(([nx, ny], i) => { const p = at(nx * m.w / 2, ny * m.h / 2); return (
            <rect key={`mke${i}`} x={p.x - 4.5} y={p.y - 4.5} width={9} height={9} rx={2}
              fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
              style={{ cursor: resizeCursor(p.x - cpx.x, p.y - cpx.y) }} onPointerDown={(e) => startMarkupResize(e, m.id, nx, ny)} />
          ); })}
          {corners.map(([sx, sy], i) => { const p = at(sx * m.w / 2, sy * m.h / 2); return (
            <rect key={`mkc${i}`} x={p.x - 5} y={p.y - 5} width={10} height={10}
              fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5}
              style={{ cursor: resizeCursor(p.x - cpx.x, p.y - cpx.y) }} onPointerDown={(e) => startMarkupResize(e, m.id, sx, sy)} />
          ); })}
        </g>
      );
    }
    if (m.kind === "easement") {
      // Grips on the editable PATH (boundary ring, or the centerline/edge-run spine).
      const path = easeEditPath(m);
      const px = path.map(f2p);
      const closed = easeEditClosed(m);
      const nodes = [];
      px.forEach((p, i) => {
        if (!closed && i === px.length - 1) return; // open spine: no edge past the last point
        const q = px[(i + 1) % px.length], mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
        nodes.push(
          <g key={`eav${i}`} style={{ cursor: "copy" }} onPointerDown={(e) => addEaseVertex(e, m.id, i)}>
            <circle cx={mx} cy={my} r={5.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.25} />
            <line x1={mx - 2.5} y1={my} x2={mx + 2.5} y2={my} stroke={PAL.accent} strokeWidth={1.25} />
            <line x1={mx} y1={my - 2.5} x2={mx} y2={my + 2.5} stroke={PAL.accent} strokeWidth={1.25} />
          </g>
        );
      });
      px.forEach((p, i) => nodes.push(
        <rect key={`ev${i}`} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2}
          fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
          style={{ cursor: "move" }} onPointerDown={(e) => startEaseVertex(e, m.id, i)} />
      ));
      return <g>{nodes}</g>;
    }
    if (!MK_VERTEX_KINDS.includes(m.kind)) return null;
    const px = mkPts(m).map(f2p);
    const isPoly = m.kind === "polyline" || m.kind === "polygon";
    const nodes = [];
    if (isPoly) px.forEach((p, i) => {
      if (m.kind === "polyline" && i === px.length - 1) return; // open path: no edge past the last point
      const q = px[(i + 1) % px.length], mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
      nodes.push(
        <g key={`mkav${i}`} style={{ cursor: "copy" }} onPointerDown={(e) => addMarkupVertex(e, m.id, i)}>
          <circle cx={mx} cy={my} r={5.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mx - 2.5} y1={my} x2={mx + 2.5} y2={my} stroke={PAL.accent} strokeWidth={1.25} />
          <line x1={mx} y1={my - 2.5} x2={mx} y2={my + 2.5} stroke={PAL.accent} strokeWidth={1.25} />
        </g>
      );
    });
    px.forEach((p, i) => nodes.push(
      <rect key={`mkv${i}`} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2}
        fill={PAL.accent} stroke={PAL.paper} strokeWidth={1.5}
        style={{ cursor: "move" }} onPointerDown={(e) => startMarkupVertex(e, m.id, i)} />
    ));
    return <g>{nodes}</g>;
  })();

  // Accuracy state — the single source of truth for measurement / acreage trust.
  const isGeoref = restored?.origin || parcels.some((p) => p.attrs);
  const calibrationState =
    underlay
      ? (underlay.fromMap ? "georef" : underlay.calibrated ? "calibrated" : "uncalibrated")
      : (isGeoref ? "georef" : "drawn");
  const calibrated = calibrationState === "georef" || calibrationState === "calibrated" || calibrationState === "drawn";

  /* ----------------------------- UI ----------------------------- */
  // Bluebeam-style left rail: a thin column of small buttons, each opening one menu.
  const railHdr = (t) => <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: PAL.chromeMuted, padding: "8px 4px 4px" }}>{t}</div>;
  const leftTabs = [
    { id: "yield", glyph: "∑", label: "Yield" },
    { id: "parcel", glyph: "⬡", label: "Parcel" },
    { id: "props", glyph: "✎", label: "Element" },
    { id: "aerial", glyph: "◳", label: "Aerial" },
    { id: "overlay", glyph: "▦", label: "Overlay" },
    { id: "standards", glyph: "⚙", label: "Setup" },
  ];
  const railBtn = (on) => ({
    display: "flex", flexDirection: "column", alignItems: "center", gap: 3, width: "100%",
    padding: "10px 2px", border: "none", borderLeft: `3px solid ${on ? PAL.ember : "transparent"}`,
    background: on ? "rgba(232,89,12,0.14)" : "transparent", color: on ? "#fff" : PAL.chromeMuted,
    cursor: "pointer", fontFamily: "inherit", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.01em",
  });
  // primary buttons (inspector actions)
  const btn = (active) => ({
    padding: "7px 13px", fontSize: 12.5, borderRadius: 9, cursor: "pointer",
    border: `1px solid ${active ? PAL.accent : "#ddd6c5"}`,
    background: active ? PAL.accent : "#fff", color: active ? "#fff" : PAL.ink,
    fontWeight: 600, fontFamily: "inherit",
    boxShadow: active ? "0 2px 6px rgba(232,89,12,0.28)" : "0 1px 2px rgba(28,25,20,0.05)",
  });
  // right-side tool-rail buttons (dark chrome, icon + label, active = ember)
  const rbtn = (active) => ({
    display: "flex", alignItems: "center", gap: 9, width: "100%", textAlign: "left",
    padding: "6px 10px", fontSize: 12.5, borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap",
    border: "1px solid transparent", fontFamily: "inherit",
    background: active ? PAL.ember : "transparent",
    color: active ? "#fff" : PAL.chromeInk,
    fontWeight: active ? 650 : 500,
    boxShadow: active ? "0 2px 8px rgba(232,89,12,0.32)" : "none",
  });
  // ghost buttons on the DARK top bar
  const dGhost = { padding: "6px 11px", fontSize: 12.5, borderRadius: 8, border: "1px solid transparent", background: "transparent", color: PAL.chromeInk, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, whiteSpace: "nowrap" };
  const dIcon = { ...dGhost, width: 30, height: 30, padding: 0, display: "grid", placeItems: "center", fontSize: 15 };
  // Editable Site/Plan labels that sit inline in the dark top bar.
  // Site/Plan dropdown trigger buttons in the dark top bar.
  const hdrTab = (fs, color, weight) => ({ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 6, color, fontSize: fs, fontWeight: weight, fontFamily: "inherit", padding: "4px 9px", cursor: "pointer", maxWidth: 220, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
  const chip = { padding: "6px 11px", fontSize: 12, borderRadius: 8, border: `1px solid #ddd6c5`, background: "#fff", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontWeight: 500, boxShadow: "0 1px 2px rgba(28,25,20,0.04)" };
  const numInput = { width: 58, padding: "6px 9px", fontSize: 12, fontFamily: "ui-monospace, Menlo, monospace", border: `1px solid #ddd6c5`, borderRadius: 8, color: PAL.ink, background: "#fff" };
  const ovRow = { display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: PAL.muted };
  const spinBtn = { width: 20, height: 13, padding: 0, display: "grid", placeItems: "center", fontSize: 10.5, lineHeight: 1, border: `1px solid #ddd6c5`, borderRadius: 4, background: "#fff", color: PAL.muted, cursor: "pointer", fontFamily: "inherit" };
  const menuItem = (on) => ({ display: "block", width: "100%", textAlign: "left", padding: "7px 10px", fontSize: 12.5, borderRadius: 7, cursor: "pointer", border: "none", background: on ? PAL.accentSoft : "transparent", color: PAL.ink, fontFamily: "inherit", fontWeight: on ? 650 : 500 });
  const menuPanel = { background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 12, boxShadow: "0 16px 44px rgba(28,25,20,0.22), 0 3px 10px rgba(28,25,20,0.1)", padding: 6 };
  const vSep = <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", margin: "0 6px" }} />;
  // Switch tools and reset any in-progress drafting; also closes the Parcel menu.
  const selectTool = (id) => {
    setTool(id);
    setDraftPoly(null); setDraftRect(null); setDraftElPoly(null); setRoadStart(null); setDraftRoad(null); setMeasDraft([]); setSplitPath([]); setMarquee(null);
    if (id !== "easement") { setEaseDraft(null); setEaseEdges(null); setEaseMenu(false); }
    if (id !== "select") setMulti([]);
    if (id !== "select") setCombineSel([]); // merge selection only lives in the Select tool
    if (id !== "callout") setCalloutDraft(null);
    if (!MARKUP_TOOLS.includes(id)) { setMkRect(null); setMkPoly(null); }
    if (id !== "calibrate") setCalib(null);
    setToolMenu(false);
    if (id !== "building") setBuildingMenu(false);
    if (id !== "parking") setParkingMenu(false);
    if (id !== "road") setRoadMenu(false);
    if (id !== "measure") setMeasureMenu(false);
    if (narrow) setMobileTools(false); // B113: picking a tool dismisses the phone overlay rail so you can draw
  };
  // --- Title reader + metes-and-bounds plotting ---
  const elRingOf = (el) => (el.points ? el.points : elCorners(el));

  // Parse the legal description and arm POB placement (the user then clicks the
  // canvas to anchor the point of beginning).
  const startPlotMetes = (asEasement = false) => {
    const calls = parseCalls(mbText);
    if (!calls.length) { setTitleErr("No bearing/distance calls found. Paste a metes-and-bounds description (e.g. “THENCE N 45°30′ E, 150.00 feet”)."); return; }
    setTitleErr("");
    setPobMode({ calls, asEasement });
    setTitleOpen(false);
    setSel(null); setTool("select");
    flashWarn(`Click the point of beginning — ${calls.length} call${calls.length > 1 ? "s" : ""} ready${asEasement ? " (easement)" : ""}.`, 0);
  };

  // Drop the POB at `pob` (feet), build the encumbrance, warn on overlaps.
  const anchorEncumbrance = (pob) => {
    const { calls, asEasement } = pobMode;
    if (!calls || !calls.length) { flashWarn("No bearings were recognized in that description — check the metes-and-bounds format.", 7000); setPobMode(null); return; }
    const path = callsToPath(calls, pob);
    const closed = pathCloses(path);
    // NEW-2 — reuse the M&B parser to spawn a first-class Easement (mode B for a closed
    // tract; a corridor strip for an open traverse), attributes editable afterward.
    if (asEasement) {
      const mk = closed
        ? makeEasement({ mode: "boundary", pts: path.slice(0, -1) })
        : makeEasement({ mode: "centerline", centerline: path, width: mbWidth });
      setPobMode(null);
      commitEasement(mk);
      return;
    }
    const ring = closed ? path.slice(0, -1) : bufferPolyline(path, mbWidth);
    if (!ring || ring.length < 3) { flashWarn("Couldn't form a shape from those calls — check the description.", 6000); setPobMode(null); return; }
    const gap = misclosure(path);
    const mk = {
      id: uid(), kind: "encumbrance",
      pts: ring, centerline: path, closed,
      calls: calls.map((c) => ({ label: c.label, az: c.az, distFt: c.distFt })),
      label: closed ? "Tract / easement" : "Easement corridor",
      stroke: "#7c3aed", fill: "#7c3aed", fillOpacity: 0.14, weight: 2, dash: "solid",
    };
    pushHistory();
    setMarkups((a) => [...a, mk]);
    setSel({ kind: "markup", id: mk.id });
    setPobMode(null);
    // overlap check against buildings + paving
    const hits = els.filter((e) => (e.type === "building" || e.type === "paving") && ringsOverlap(ring, elRingOf(e)));
    const closeNote = closed && gap > 1 ? ` Traverse misclosure ≈ ${gap.toFixed(1)}′.` : "";
    if (hits.length) {
      const b = hits.filter((e) => e.type === "building").length, p = hits.length - b;
      const parts = [b && `${b} building${b > 1 ? "s" : ""}`, p && `${p} paving area${p > 1 ? "s" : ""}`].filter(Boolean).join(" and ");
      flashWarn(`⚠ Encumbrance overlaps ${parts}.${closeNote}`, 9000);
    } else {
      flashWarn(`Encumbrance placed — no conflicts with buildings or paving.${closeNote}`, 9000);
    }
  };

  // Manual quick-trace of an overhead power line on the aerial: click points,
  // double-click / Enter to finish. Commits a labeled polyline markup.
  const commitTrace = () => {
    if (tracePts.length >= 2) {
      pushHistory();
      const mk = { id: uid(), kind: "traced", pts: tracePts, label: "Overhead electric (traced)", stroke: "#b45309", weight: 2.6, dash: "solid" };
      setMarkups((a) => [...a, mk]); setSel({ kind: "markup", id: mk.id });
    }
    setTracePts([]); setTraceMode(false);
  };

  // Inferred water main: connect the fire hydrants currently in view (OSM) into a
  // nearest-neighbour path, drawn dashed and labeled screening-only.
  const inferWaterMain = async () => {
    if (!origin || evidenceBusy) return;
    setEvidenceBusy(true); flashWarn("Fetching hydrants in view…", 0);
    try {
      const corners = [[0, 0], [size.w, 0], [0, size.h], [size.w, size.h]].map(([px, py]) =>
        feetToLatLng({ x: (px - view.offX) / view.ppf, y: (py - view.offY) / view.ppf }, origin.lat, origin.lon));
      const lats = corners.map((c) => c[0]), lngs = corners.map((c) => c[1]);
      const bb = { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lngs), e: Math.max(...lngs) };
      const els = await fetchOverpass(bb, { hydrants: true });
      const feet = els.filter((e) => e.type === "node" && e.lat != null)
        .map((e) => lngLatRingToFeet([[e.lon, e.lat]], origin.lon, origin.lat)[0]);
      if (feet.length < 2) { flashWarn(`Only ${feet.length} hydrant${feet.length === 1 ? "" : "s"} in view — need ≥ 2 to infer a main. Zoom/pan to include a run of hydrants.`, 7000); return; }
      // nearest-neighbour order starting from the westmost hydrant
      const remaining = feet.slice();
      let cur = remaining.reduce((a, b) => (b.x < a.x ? b : a), remaining[0]);
      remaining.splice(remaining.indexOf(cur), 1);
      const ordered = [cur];
      while (remaining.length) {
        let bi = 0, bd = Infinity;
        remaining.forEach((p, i) => { const d = Math.hypot(p.x - cur.x, p.y - cur.y); if (d < bd) { bd = d; bi = i; } });
        cur = remaining.splice(bi, 1)[0]; ordered.push(cur);
      }
      pushHistory();
      const mk = { id: uid(), kind: "infwater", pts: ordered, label: "Inferred water main (screening only)", stroke: "#0891b2", weight: 2, dash: "dashed" };
      setMarkups((a) => [...a, mk]); setSel({ kind: "markup", id: mk.id });
      flashWarn(`Inferred a main through ${ordered.length} hydrants — screening only, verify with the utility.`, 8000);
    } catch (_) {
      flashWarn("Couldn't reach the hydrant source (OSM Overpass). Try again in a moment.", 6000);
    } finally { setEvidenceBusy(false); }
  };

  // --- utility service routing (electric / water) ---
  const startRoute = (util, extra = {}) => {
    if (util === "elec" && !markups.some((m) => m.kind === "traced")) {
      flashWarn("Trace an overhead pole line first (✏ Trace overhead electric), then route from it.", 6000); return;
    }
    setSel(null); setTool("select"); setTraceMode(false);
    setRouteMode({ util, snapTo: util === "elec" ? "traced" : "free", stage: "source", ...extra });
    flashWarn(util === "elec" ? "Click the connection point on a traced power line." : "Click the tap point on the water main (turn on the water layer to see it).", 0);
  };
  const commitUtilRoute = (mode, b) => {
    const opts = mode.util === "elec"
      ? { util: "elec", width: 10, color: "#b45309", padSize: 10, fitting: "XFMR", label: "Electric service · 10′ easement" }
      : { util: "water", width: mode.width || 15, color: "#0891b2", padSize: 6, fitting: "TAP", label: `Water service · ${mode.width || 15}′ easement${mode.ruleNote ? ` — ${mode.ruleNote}` : ""}` };
    const mk = buildUtilRoute(mode.source, b, opts, uid);
    pushHistory(); setMarkups((a) => [...a, mk]); setSel({ kind: "markup", id: mk.id });
    setRouteMode(null);
    const hits = els.filter((e) => e.id !== b.id && ["building", "paving", "parking", "trailer", "pond"].includes(e.type) && ringsOverlap(mk.corridor, ringOf(e)));
    const what = mode.util === "elec" ? "Electric" : "Water";
    flashWarn(hits.length ? `⚠ ${what} easement overlaps ${hits.length} element${hits.length > 1 ? "s" : ""} — reroute or relocate.` : `${what} service routed to the ${(b.w * b.h >= LARGE_BLDG_SF) ? "dock/long wall" : "nearest wall"} — no conflicts.`, 8000);
  };

  // Ditch cross-section: sample the 3DEP DEM along the drawn line (screening only).
  const runXSection = async (p0, p1) => {
    if (xsecBusyRef.current) return; // in-flight guard: ignore a second run while one samples (B56b)
    if (!origin) { flashWarn("Cross-section needs a located site (a real-world origin).", 6000); return; }
    const lenFt = _hyp(p0, p1);
    if (!(lenFt > 1)) { flashWarn("Cross-section line is too short — draw a longer line.", 5000); setXsecMode(false); setXsecPts([]); return; }
    xsecBusyRef.current = true;
    setXsec({ p0, p1, lenFt, busy: true, stats: null });
    setXsecMode(false); setXsecPts([]);
    try {
      const a = feetToLatLng(p0, origin.lat, origin.lon), b = feetToLatLng(p1, origin.lat, origin.lon);
      const elev = await sampleProfile([[a[1], a[0]], [b[1], b[0]]], 48); // [lng,lat]
      const stats = ditchStats(elev, lenFt);
      if (!stats) throw new Error("no samples");
      setXsec({ p0, p1, lenFt, busy: false, stats });
    } catch (_) {
      setXsec(null);
      flashWarn("Couldn't sample USGS 3DEP elevation there (service/coverage). Try again or a different line.", 7000);
    } finally {
      xsecBusyRef.current = false;
    }
  };

  const setRule = (key, patch) => setEaseRules((r) => { const next = { ...r, [key]: { ...r[key], ...patch } }; saveEasementRules(next); return next; });
  const startWaterRoute = () => {
    const rule = easeRules[jurKey] || easeRules.generic;
    startRoute("water", { width: rule.waterWidth || 15, ruleNote: `${rule.label}${rule.verified ? "" : " · VERIFY"}` });
  };

  // Upload + extract a title-commitment PDF via the Claude API.
  const runTitleExtract = async (file) => {
    if (!file) return;
    if (!apiKey) { setTitleErr("Paste your Anthropic API key first."); return; }
    setTitleBusy(true); setTitleErr("");
    try {
      const b64 = await fileToBase64(file);
      const doc = await readTitlePDF(b64, { apiKey });
      setTitleDoc(doc);
      setExcChecked({});
      if (doc.legalDescription) setMbText(doc.legalDescription);
    } catch (e) {
      setTitleErr(/api key|authentication|401/i.test(String(e?.message)) ? "That API key was rejected — check it and try again." : (e?.message || "Extraction failed."));
    } finally {
      setTitleBusy(false);
    }
  };

  const metricRow = (label, value, sub) => (
    <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "5.5px 0", borderBottom: "1px solid #f3efe5" }}>
      <span style={{ fontSize: 12, color: PAL.muted }}>{label}</span>
      <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 13, color: PAL.ink, fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{value}{sub && <span style={{ color: PAL.muted, fontWeight: 400, fontSize: 10.5 }}> {sub}</span>}</span>
    </div>
  );

  const selEl = sel?.kind === "el" ? els.find((e) => e.id === sel.id) : null;
  const setSelEl = (patch) => setEls((a) => a.map((e) => e.id === selEl.id ? { ...e, ...patch } : e));
  // Rotate the selected element to an absolute angle, carrying its whole bonded
  // assembly (sidewalks, truck court, trailer parking, dog-ears) around its centre.
  const rotateAssemblyTo = (el, newRot) => {
    if (!el || el.points) return;
    const delta = ((((newRot - (el.rot || 0)) % 360) + 360) % 360);
    if (!delta) return;
    pushHistory();
    const pivot = { x: el.cx, y: el.cy };
    const ids = new Set(assemblyOf(el.id).map((m) => m.id));
    setEls((a) => a.map((x) => {
      if (!ids.has(x.id)) return x;
      if (x.points) return { ...x, points: x.points.map((p) => { const r = rot2(p.x - pivot.x, p.y - pivot.y, delta); return { x: pivot.x + r.x, y: pivot.y + r.y }; }) };
      const r = rot2(x.cx - pivot.x, x.cy - pivot.y, delta);
      return { ...x, cx: pivot.x + r.x, cy: pivot.y + r.y, rot: ((x.rot + delta) % 360 + 360) % 360 };
    }));
  };
  const rotateSelTo = (newRot) => { if (selEl) rotateAssemblyTo(selEl, newRot); };
  const bumpRot = (d) => { if (selEl && !selEl.points) rotateSelTo((((Math.round(selEl.rot) + d) % 360) + 360) % 360); };
  // Resize the selected element from a numeric field, keeping its centre fixed and
  // carrying every bonded feature with it (same re-fit as dragging a grip).
  const resizeSelEl = (patch) => {
    if (!selEl || selEl.points) return;
    const nb = { cx: selEl.cx, cy: selEl.cy, w: patch.w ?? selEl.w, h: patch.h ?? selEl.h, rot: selEl.rot };
    pushHistory();
    const kids = wallKids(selEl);
    setEls((a) => refitChildren(a, selEl.id, nb, kids));
  };
  // Road travel width = element cross-width − two curbs. Editing it keeps the curb.
  const roadCurbOf = (el) => el.curb ?? (+settings.roadCurb || CURB);
  const roadTravel = (el) => roadTravelWidth(el.w, el.h, roadCurbOf(el)); // live geometry — tracks resizes (not a frozen travelW)
  const setRoadTravel = (el, travel) => {
    const curb = roadCurbOf(el), cross = Math.max(1, travel) + 2 * curb, crossIsH = el.h <= el.w;
    pushHistory();
    setEls((a) => a.map((x) => x.id === el.id ? { ...x, ...(crossIsH ? { h: cross } : { w: cross }), travelW: Math.max(1, travel), curb } : x));
  };
  const setRoadLength = (el, len) => {
    const crossIsH = el.h <= el.w; // the length axis is the other one
    pushHistory();
    setEls((a) => a.map((x) => x.id === el.id ? { ...x, ...(crossIsH ? { w: Math.max(1, len) } : { h: Math.max(1, len) }) } : x));
  };
  const selParcel = sel?.kind === "parcel" ? parcels.find((p) => p.id === sel.id) : null;
  const setSelParcel = (patch) => setParcels((a) => a.map((p) => p.id === selParcel.id ? { ...p, ...patch } : p));
  // Per-edge setbacks: pc.setbacks aligned to edges (edge i = pts[i]→pts[i+1]);
  // falls back to the global default for any parcel that predates per-edge.
  const parcelSetbacks = (pc) => {
    const n = pc.points.length, base = +settings.setback || 0;
    return (Array.isArray(pc.setbacks) && pc.setbacks.length === n) ? pc.setbacks : Array.from({ length: n }, () => base);
  };
  const setEdgeSetback = (pc, i, v) => {
    pushHistory();
    const arr = parcelSetbacks(pc).slice(); arr[i] = Math.max(0, v);
    setParcels((a) => a.map((p) => p.id === pc.id ? { ...p, setbacks: arr } : p));
  };
  // "Front" = the longest edge (street frontage heuristic).
  const frontEdge = (pc) => {
    let best = 0, bl = -1;
    for (let i = 0; i < pc.points.length; i++) { const d = dist(pc.points[i], pc.points[(i + 1) % pc.points.length]); if (d > bl) { bl = d; best = i; } }
    return best;
  };
  const selCallout = sel?.kind === "callout" ? callouts.find((c) => c.id === sel.id) : null;
  const setSelCallout = (patch) => { pushHistory(); setCallout(selCallout.id, patch); };
  const curHint = TOOLS.find((t) => t.id === tool)?.hint;

  /* ------------ element colors / defaults (Bluebeam-style Properties) ------------ */
  const curStyle = selEl ? elStyle(selEl, settings) : null;
  // Merge a default-color patch for one type into settings.typeStyles.
  const setTypeStyle = (type, patch) => { pushHistory(); setSettings((s) => ({ ...s, typeStyles: { ...(s.typeStyles || {}), [type]: { ...((s.typeStyles || {})[type] || {}), ...patch } } })); };
  // Make the selected element's current colors the default for its type.
  const setStyleDefault = () => { if (!selEl || !curStyle) return; setTypeStyle(selEl.type, { fill: curStyle.fill, stroke: curStyle.stroke, fillOpacity: curStyle.fillOpacity }); };
  // Drop the selected element's per-element overrides (back to the type default).
  const clearElStyle = () => { if (!selEl) return; pushHistory(); setEls((a) => a.map((e) => { if (e.id !== selEl.id) return e; const { fill, stroke, fillOpacity, ...rest } = e; return rest; })); };

  /* ------------ Plans dropdown grouping (this site's plans vs. other sites) ------------ */
  const planGroup = (s) => s.groupId || s.id;
  const plansHere = (sites || []).filter((s) => planGroup(s) === groupId);
  const otherSites = (() => {
    const seen = new Set([groupId]), out = [];
    (sites || []).forEach((s) => { const g = planGroup(s); if (!seen.has(g)) { seen.add(g); out.push(s); } });
    return out;
  })();
  // One representative per site (location), current site first, for the Site ▾ menu.
  const siteReps = (() => {
    const seen = new Set(), out = [];
    (sites || []).forEach((s) => { const g = planGroup(s); if (!seen.has(g)) { seen.add(g); out.push(s); } });
    return out.sort((a, b) => (planGroup(a) === groupId ? -1 : planGroup(b) === groupId ? 1 : 0));
  })();

  // ── AppHeader slot content ───────────────────────────────────────────────────
  const plannerCenterContent = (
    <span style={{ display: "flex", alignItems: "center", gap: 9 }}>
      {onBackToMap && (
        <button className="dbtn" style={{ ...dGhost, marginLeft: -4 }} onClick={onBackToMap} title="Back to the map finder">‹ Map</button>
      )}
      <div ref={siteAnchor} style={{ position: "relative" }}>
        <button className="dbtn" style={hdrTab(12.5, "#fff", 600)} onClick={() => { setSiteMenu((o) => !o); setPlanMenu(false); }} title="Switch or rename site">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{siteLabel}</span><span style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>
        </button>
        <AnchoredMenu open={siteMenu} onClose={() => setSiteMenu(false)} anchorRef={siteAnchor} placement="below-left" gap={8} width={284} panelStyle={{ ...menuPanel, padding: 10 }}>
          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 5 }}>Site name</div>
          <input value={siteLabel} onChange={(e) => setSiteLabel(e.target.value)} onBlur={(e) => commitSiteLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} style={{ ...numInput, width: "100%", fontFamily: "inherit" }} />
          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, margin: "11px 0 5px" }}>Switch site</div>
          {siteReps.map((s) => {
            const cur = planGroup(s) === groupId;
            return (
              <button key={s.id} style={menuItem(cur)} onClick={() => (cur ? setSiteMenu(false) : handleOpenSite(s.id))}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.site || s.name || "Untitled site"}</span>
                  {cur && <span style={{ color: PAL.accent, fontSize: 10.5, fontWeight: 700, flex: "none" }}>current</span>}
                </span>
              </button>
            );
          })}
          <div style={{ marginTop: 9, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
            <button style={{ ...chip, width: "100%" }} onClick={handleNewSite}>＋ New blank site</button>
          </div>
        </AnchoredMenu>
      </div>
      <span style={{ color: PAL.chromeMuted, fontSize: 13 }}>›</span>
      <div ref={planAnchor} style={{ position: "relative" }}>
        <button className="dbtn" style={hdrTab(11.5, PAL.chromeMuted, 500)} onClick={() => { setPlanMenu((o) => !o); setSiteMenu(false); }} title="Switch or rename plan">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{planLabel}</span><span style={{ opacity: 0.6, fontSize: 11, flex: "none" }}>▾</span>
        </button>
        <AnchoredMenu open={planMenu} onClose={() => setPlanMenu(false)} anchorRef={planAnchor} placement="below-left" gap={8} width={284} panelStyle={{ ...menuPanel, padding: 10 }}>
          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 5 }}>Plan name</div>
          <input value={planLabel} onChange={(e) => setPlanLabel(e.target.value)} onBlur={(e) => commitPlanLabel(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }} style={{ ...numInput, width: "100%", fontFamily: "inherit" }} />
          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, margin: "11px 0 5px" }}>Plans in this site</div>
          {plansHere.map((s) => (
            <button key={s.id} style={menuItem(s.id === siteId)} onClick={() => (s.id === siteId ? setPlanMenu(false) : handleOpenSite(s.id))}>
              <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name || "Untitled plan"}</span>
                {s.id === siteId && <span style={{ color: PAL.accent, fontSize: 10.5, fontWeight: 700, flex: "none" }}>current</span>}
              </span>
            </button>
          ))}
          <div style={{ display: "flex", gap: 6, marginTop: 9, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
            <button style={{ ...chip, flex: 1 }} onClick={handleNewPlan} title="New layout on the same parcel">＋ New plan</button>
            <button style={{ ...chip, flex: 1 }} onClick={handleDuplicate} title="Clone this plan to iterate on">⧉ Duplicate</button>
          </div>
          <button style={{ ...menuItem(false), marginTop: 6, display: "flex", alignItems: "center", gap: 8 }} onClick={openVersionHistory}
            title="Restore an earlier automatically-saved version of this plan">
            <span aria-hidden style={{ flex: "none" }}>↺</span><span>Version history…</span>
          </button>
        </AnchoredMenu>
      </div>
    </span>
  );

  const plannerSaveSlot = (() => {
    const cloudActive = isCloudActive();
    const connOk = cloud?.state === "connected";
    let label, dot, color = PAL.chromeMuted, spin = false, tip;
    if (saveStatus === "saving") {
      label = cloudActive ? "Syncing…" : "Saving…"; dot = "#f59e0b"; spin = true; tip = "Saving your changes…";
    } else if (saveStatus === "unsaved") {
      color = "#fbbf24"; dot = "#f59e0b";
      label = cloudActive && !connOk ? "Offline" : "Unsaved";
      tip = cloudActive && !connOk ? "Saved on this device — the cloud is unreachable. Your work will sync when you reconnect." : "You have unsaved changes.";
    } else if (cloudActive && connOk) {
      label = "Synced ✓"; dot = "#22c55e"; tip = "Saved and synced to the cloud.";
    } else if (cloudActive) {
      label = "Offline"; color = "#fbbf24"; dot = "#f59e0b"; tip = "Saved on this device — the cloud is unreachable. Your work will sync when you reconnect.";
    } else {
      label = "Saved ✓"; dot = "#9b9482"; tip = "Saved on this device. Sign in to sync across your devices.";
    }
    return (
      <span title={tip} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color, fontWeight: 500, marginRight: 4, minWidth: 70, justifyContent: "flex-end" }}>
        <span style={{ width: 7, height: 7, borderRadius: 99, background: dot, flex: "none", animation: spin ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
        {label}
      </span>
    );
  })();

  const plannerToolbar = (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 2, background: "rgba(255,255,255,0.05)", borderRadius: 10, padding: 2 }}>
        <button className="dbtn" style={dIcon} onClick={undo} disabled={!pastRef.current.length} aria-label="Undo" title="Undo (Ctrl+Z)">↶</button>
        <button className="dbtn" style={dIcon} onClick={redo} disabled={!futureRef.current.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">↷</button>
        <button className="dbtn" style={dIcon} onClick={fit} disabled={!parcels.length && !els.length && !markups.length && !callouts.length && !underlay} aria-label="Zoom to fit" title="Zoom to fit">⤢</button>
      </div>
      <button className="dbtn" aria-pressed={settings.snap} style={{ ...dGhost, display: "flex", alignItems: "center", gap: 7, color: settings.snap ? "#fff" : PAL.chromeMuted, fontWeight: 600 }}
        onClick={() => setSnap(!settings.snap)} title="Snap to grid & flush against neighbours — click or press S to toggle; hold Alt while dragging to place freely">
        <span style={{ width: 7, height: 7, borderRadius: 99, background: settings.snap ? "#22c55e" : "#5a5446", display: "inline-block", boxShadow: settings.snap ? "0 0 7px rgba(34,197,94,0.7)" : "none" }} />
        {settings.snap ? `Snap ${settings.gridSize}′` : "Snap off"}
      </button>
      {vSep}
      <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
        <div ref={exportAnchor} style={{ position: "relative" }}>
          <button className="dbtn" style={{ ...dGhost, fontWeight: 600 }} onClick={() => setExportMenu((o) => !o)}>File ▾</button>
          <AnchoredMenu open={exportMenu} onClose={() => setExportMenu(false)} anchorRef={exportAnchor} placement="below-right" gap={8} width={220} panelStyle={menuPanel}>
            <button style={menuItem(false)} title="Download this plan as a .json file you can re-import later" onClick={() => { setExportMenu(false); exportJSON(); }}>Export JSON</button>
            <button style={menuItem(false)} title="Load a plan from a .json file (replaces the current canvas)" onClick={() => { setExportMenu(false); importRef.current?.click(); }}>Import JSON…</button>
            <input ref={importRef} type="file" accept="application/json,.json" style={{ display: "none" }}
              onChange={(e) => { importJSONFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div style={{ height: 1, background: PAL.panelLine, margin: "5px 4px" }} />
            <button style={menuItem(false)} title="Save the current view as a PNG image" onClick={() => { setExportMenu(false); exportPNG(); }}>Export PNG</button>
            <button style={menuItem(false)} title="Pick a print frame, then print or save as PDF" onClick={() => { setExportMenu(false); enterPrintMode(); }}>Print / pick frame…</button>
            <div style={{ height: 1, background: PAL.panelLine, margin: "5px 4px" }} />
            <button style={menuItem(false)} title="Read a deed/title block to plot a metes-and-bounds boundary" onClick={() => { setExportMenu(false); setTitleErr(""); setTitleOpen(true); }}>Title reader / metes &amp; bounds…</button>
          </AnchoredMenu>
        </div>
      </div>
    </>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 600, background: "#efeadf",
      fontFamily: "inherit", color: PAL.ink, overflow: "hidden" }}>

      <AppHeader
        module={shellModule || "site-planner"}
        onSwitch={onShellSwitch}
        onDashboard={onBackToMap}
        centerContent={plannerCenterContent}
        saveSlot={plannerSaveSlot}
        authControl={authControl}
        toolbarContent={plannerToolbar}
      />
      {cloudSaveFailed && (
        <div role="alert" style={{ position: "fixed", top: 88, left: "50%", transform: "translateX(-50%)", zIndex: 6000, maxWidth: 620, display: "flex", alignItems: "center", gap: 12, background: "#7c2d12", color: "#fff", border: "1px solid #f59e0b", borderRadius: 10, padding: "9px 13px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.35)" }}>
          <span style={{ flex: 1 }}>⚠ Your last change <b>didn't reach the cloud</b>. It's saved on this device and will retry on your next edit — your work is not lost.</span>
          <button onClick={retryCloudSave} title="Try saving to the cloud again now" style={{ flex: "none", cursor: "pointer", background: "#f59e0b", color: "#1a1206", border: "none", borderRadius: 7, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 800 }}>Retry now</button>
          <button onClick={() => setCloudSaveFailed(false)} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.18)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* body */}
      <div style={{ display: "flex", flex: 1, minHeight: 0, position: "relative" }}>
        {/* canvas */}
        <div ref={wrapRef} style={{ flex: 1, position: "relative", minWidth: 0, order: 2, background: PAL.paper }}
          onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes("Files")) e.preventDefault(); }}
          onDrop={(e) => { const f = e.dataTransfer?.files?.[0]; if (f && (isPdfFile(f) || (f.type || "").startsWith("image/"))) { e.preventDefault(); addOverlayFile(f); } }}>
          {/* geographic basemap + shared overlay layers, beneath the SVG. Pure
              backdrop (pointer-events off) — the SVG above handles interaction. */}
          {/* When the aerial is ON, the backdrop is a neutral mid-dark gray so the
              brief tile gap during a zoom-level change reads as a subtle blink, not
              a bright (near-white) flash against the imagery (B65). With the aerial
              OFF this stays PAL.paper so the planner background matches the SVG. */}
          {origin && <div ref={geoWrapRef} data-export="skip" style={{ position: "absolute", inset: 0, zIndex: 0, background: basemapOn ? "#3f3f3f" : PAL.paper, pointerEvents: "none" }} />}
          <svg ref={svgRef} width="100%" height="100%" viewBox={`0 0 ${size.w} ${size.h}`} role="application" aria-label="Site plan canvas"
            style={{ position: "relative", zIndex: 1, background: origin ? "transparent" : PAL.paper, display: "block", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", cursor: spacePan ? (panning ? "grabbing" : "grab") : (attachFor || alignFor || identifyMode || traceMode || pobMode || routeMode || xsecMode || ovCalib) ? "crosshair" : (tool === "select" || tool === "pan" || printMode) ? (panning ? "grabbing" : "grab") : "crosshair" }}
            onMouseDown={(e) => e.preventDefault()}
            onPointerDown={onBgDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={onBgDouble}
            onContextMenu={(e) => { if (roadStart) { e.preventDefault(); setRoadStart(null); setDraftRoad(null); } }}>

            <defs>
              <filter id="bldgShadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="1.5" stdDeviation="2.5" floodColor="#2b2620" floodOpacity="0.28" />
              </filter>
              <pattern id="pat-landscape" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="9" stroke="#7f9a63" strokeWidth="0.8" opacity="0.5" />
              </pattern>
              <pattern id="pat-water" width="22" height="10" patternUnits="userSpaceOnUse">
                <path d="M0 5 q5.5 -4 11 0 t11 0" fill="none" stroke="#5d8497" strokeWidth="0.8" opacity="0.45" />
              </pattern>
              <pattern id="pat-encumber" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#7c3aed" strokeWidth="1" opacity="0.55" />
              </pattern>
              {/* colour-blind-safe secondary cues for the paved surfaces (H2): trailer
                  reads as a coarse diagonal (opposite lean to landscape), sidewalk as a
                  fine concrete-scoring dot grid. */}
              <pattern id="pat-trailer" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
                <line x1="0" y1="0" x2="0" y2="8" stroke="#b09a6c" strokeWidth="0.9" opacity="0.5" />
              </pattern>
              <pattern id="pat-sidewalk" width="7" height="7" patternUnits="userSpaceOnUse">
                <circle cx="1.4" cy="1.4" r="0.7" fill="#9c998d" opacity="0.5" />
              </pattern>
              {/* easement fills: a semi-transparent body + diagonal hatch, color-coded per type (NEW-1) */}
              {EASEMENT_TYPES.map((t) => (
                <pattern key={t.key} id={`pat-ease-${t.key}`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="7" height="7" fill={t.color} opacity="0.10" />
                  <line x1="0" y1="0" x2="0" y2="7" stroke={t.color} strokeWidth="1.1" opacity="0.5" />
                </pattern>
              ))}
            </defs>

            {!(origin && basemapOn) && <g data-export="skip">{gridLines()}</g>}

            {/* scaled feet space */}
            <g>
              {/* aerial underlay (drawn beneath everything) — hidden until you
                  click a parcel or toggle it on, so it doesn't fill the canvas by default */}
              {showAerial && underlay && !(origin && basemapOn) && (() => {
                const tl = f2p({ x: underlay.x, y: underlay.y });
                const sy = underlay.ftPerPxY || underlay.ftPerPx;
                const w = underlay.imgW * underlay.ftPerPx * view.ppf;
                const h = underlay.imgH * sy * view.ppf;
                return <image href={underlay.src} x={tl.x} y={tl.y} width={w} height={h}
                  opacity={underlay.opacity} preserveAspectRatio="none"
                  style={{ cursor: tool === "select" && !underlay.locked ? "move" : "crosshair" }}
                  pointerEvents={underlay.locked ? "none" : "auto"}
                  onError={() => { setUnderlayErr(true); setUnderlayLoading(false); }} onLoad={() => { setUnderlayErr(false); setUnderlayLoading(false); }}
                  onPointerDown={startMoveUnderlay} />;
              })()}

              {/* site-plan overlays (B72) — placed PDF/image backdrops in feet space,
                  above the basemap/underlay and below parcels/massing/markup; shown
                  even with the basemap on (the point is to overlay onto the aerial). */}
              {sheetOverlays.map((o) => {
                const tl = f2p({ x: o.x, y: o.y });
                const w = o.imgW * o.ftPerPx * view.ppf;
                const h = o.imgH * o.ftPerPx * view.ppf;
                const cx = tl.x + w / 2, cy = tl.y + h / 2;
                const isSel = selOverlay === o.id;
                return (
                  <g key={o.id} transform={o.rotation ? `rotate(${o.rotation} ${cx} ${cy})` : undefined}
                    style={{ cursor: tool === "select" && !o.locked ? "move" : "default" }}
                    pointerEvents={o.locked ? "none" : "auto"}
                    onPointerDown={(e) => startMoveSheetOverlay(e, o.id)}>
                    {o.src ? (
                      // data-overlay-image marks the printable raster so buildExportSvg can include/exclude it per the "Print overlay" toggle (B131)
                      <image data-overlay-image="1" href={o.src} x={tl.x} y={tl.y} width={w} height={h} opacity={o.opacity} preserveAspectRatio="none" />
                    ) : (<g data-export="skip">
                      <rect x={tl.x} y={tl.y} width={w} height={h} fill="#fbf3ee" fillOpacity={0.55} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="8 5" />
                      <text x={cx} y={cy} textAnchor="middle" fontSize={13} fill={PAL.accent}>{o.storageKey ? "Loading drawing from cloud…" : `Re-add “${o.name}” — image not synced to this device`}</text>
                    </g>)}
                    {isSel && tool === "select" && (
                      <rect data-export="skip" x={tl.x} y={tl.y} width={w} height={h} fill="none" stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="6 4" pointerEvents="none" />
                    )}
                    {isSel && tool === "select" && !o.locked && !ovCalib && (<g data-export="skip">
                      {[[tl.x, tl.y], [tl.x + w, tl.y], [tl.x + w, tl.y + h], [tl.x, tl.y + h]].map(([hx, hy], hi) => (
                        <rect key={`hsc${hi}`} x={hx - 5} y={hy - 5} width={10} height={10} rx={2} fill="#fff" stroke={PAL.accent} strokeWidth={1.5}
                          style={{ cursor: hi % 2 === 0 ? "nwse-resize" : "nesw-resize" }} onPointerDown={(e) => startScaleOverlay(e, o.id)} />
                      ))}
                      <line x1={cx} y1={tl.y} x2={cx} y2={tl.y - 22} stroke={PAL.accent} strokeWidth={1.5} pointerEvents="none" />
                      <circle cx={cx} cy={tl.y - 22} r={5.5} fill="#fff" stroke={PAL.accent} strokeWidth={1.5}
                        style={{ cursor: "grab" }} onPointerDown={(e) => startRotateOverlay(e, o.id)} />
                    </g>)}
                  </g>
                );
              })}

              {/* overlay calibration feedback (B73): clicked points + the traced line */}
              {ovCalib && ovCalib.pts.map((p, i) => {
                const sp = f2p(p), isMap = ovCalib.kind === "align" && i % 2 === 1;
                const label = ovCalib.kind === "align" ? (isMap ? "map" : `${i / 2 + 1}`) : `${i + 1}`;
                return (
                  <g key={`ovc${i}`} pointerEvents="none">
                    <circle cx={sp.x} cy={sp.y} r={5} fill={isMap ? "#2563eb" : PAL.accent} stroke="#fff" strokeWidth={1.5} />
                    <text x={sp.x + 8} y={sp.y - 6} fontSize={11} fontWeight={700} fill={isMap ? "#2563eb" : PAL.accent} stroke="#fff" strokeWidth={0.5} paintOrder="stroke">{label}</text>
                  </g>
                );
              })}
              {/* connectors: trace = the measured line; align = each drawing→map pair */}
              {ovCalib && ovCalib.kind === "trace" && ovCalib.pts.length >= 2 && (() => {
                const a = f2p(ovCalib.pts[0]), b = f2p(ovCalib.pts[1]);
                return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" pointerEvents="none" />;
              })()}
              {ovCalib && ovCalib.kind === "align" && Array.from({ length: Math.floor(ovCalib.pts.length / 2) }, (_, k) => {
                const a = f2p(ovCalib.pts[2 * k]), b = f2p(ovCalib.pts[2 * k + 1]);
                return <line key={`ovl${k}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth={1.25} strokeDasharray="4 3" pointerEvents="none" />;
              })}

              {/* setback outlines (per-edge) */}
              {settings.showSetback && parcels.map((pc) => {
                const sb = parcelSetbacks(pc);
                if (!sb.some((v) => v > 0)) return null;
                const o = offsetPolygon(pc.points, sb);
                if (!o) return null;
                return <polygon key={`sb${pc.id}`} points={o.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke={PAL.setback} strokeWidth={1.25} strokeDasharray="7 6" pointerEvents="none" />;
              })}
              {/* per-edge setback values on the selected parcel (click to edit) */}
              {settings.showSetback && selParcel && (() => {
                const sb = parcelSetbacks(selParcel), pts = selParcel.points;
                return <g data-export="skip">{pts.map((a, i) => {
                  const b = pts[(i + 1) % pts.length], mid = f2p({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
                  return (
                    <g key={`sbl${i}`} style={{ cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); const fp = p2f(e.clientX, e.clientY); setNumEdit({ fx: fp.x, fy: fp.y, value: String(sb[i]), onCommit: (n) => setEdgeSetback(selParcel, i, n) }); }}>
                      <rect x={mid.x - 13} y={mid.y - 9} width={26} height={16} rx={4} fill="#fff" stroke={PAL.setback} strokeWidth={1} />
                      <text x={mid.x} y={mid.y + 3.5} textAnchor="middle" fontSize="10.5" fontFamily="ui-monospace, monospace" fill={PAL.setback} fontWeight="700">{f0(sb[i])}′</text>
                    </g>
                  );
                })}</g>;
              })()}
              {/* parcels */}
              {parcels.map((pc) => {
                const isSel = sel?.kind === "parcel" && sel.id === pc.id;
                const picked = combineSel.includes(pc.id);
                const inactive = pc.active === false; // excluded from calcs → dim + dash so it's clearly "context only" (B100)
                return <polygon key={pc.id} points={pc.points.map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")}
                  fill={picked ? "#2563eb" : (pc.fill || "none")} fillOpacity={picked ? 0.16 : (pc.fill ? (pc.fillOpacity ?? 0.12) : 1)}
                  stroke={picked ? "#2563eb" : isSel ? PAL.accent : (pc.stroke || PAL.parcel)} strokeWidth={picked || isSel ? 3 : 2}
                  strokeDasharray={inactive ? "8 6" : undefined} opacity={inactive ? 0.4 : 1}
                  style={{ cursor: tool === "select" ? (pc.locked ? "default" : "move") : "crosshair" }}
                  pointerEvents="all"
                  onPointerDown={(e) => startMoveParcel(e, pc.id)}
                  onContextMenu={(e) => { if (tool !== "select") return; e.preventDefault(); setCombineSel((s) => (s.includes(pc.id) ? s : [...s, pc.id])); setSel({ kind: "parcel", id: pc.id }); setParcelMenu({ x: e.clientX, y: e.clientY }); }} />;
              })}
              {/* elements (drawn in PIXELS; coords pre-transformed by f2p).
                  Painted in ground→structure order so paving never covers a
                  building footprint (e.g. dock dog-ears sit ON the truck court). */}
              {[...els].sort(byZ).map((el) => renderElPx(el, f2p, sel, tool, settings, startMoveEl, onElDouble, els, startDimMove, editDimWidth))}
              {/* markup shapes (neutral line/polyline/rect/ellipse/polygon) */}
              {markups.map((m) => {
                const isSel = sel?.kind === "markup" && sel.id === m.id;
                const sw = (m.weight ?? 2), da = dashArray(m.dash, sw);
                const stroke = isSel ? PAL.accent : m.stroke;
                const common = { stroke, strokeWidth: sw, strokeDasharray: da, fill: "none", style: { cursor: tool === "select" ? "move" : "crosshair" }, onPointerDown: (e) => startMoveMarkup(e, m.id) };
                // Closed shapes (rect/ellipse/polygon) get an always-on pointer target so the WHOLE
                // body selects + drags, not just the painted border. pointerEvents:"all" makes the
                // interior a hit target even when the shape is UNFILLED (fill:"none" is otherwise dead
                // to clicks, so you'd have to land exactly on the 2px stroke). Mirrors Doc Review's
                // B33 hit-test and Bluebeam/Figma behaviour (B155). Open paths (line/polyline) don't
                // get fillProps, so their hit area is unchanged — see B155 for their forgiving buffer.
                const fillProps = (m.fillOpacity > 0)
                  ? { fill: m.fill, fillOpacity: m.fillOpacity, pointerEvents: "all" }
                  : { pointerEvents: "all" };
                if (m.kind === "utilRoute") {
                  const col = isSel ? PAL.accent : m.stroke;
                  const cor = m.corridor.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");
                  const pad = m.pad.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");
                  const cl = m.pts.map((p) => f2p(p));
                  const padC = f2p(centroid(m.pad)), mid = { x: (cl[0].x + cl[cl.length - 1].x) / 2, y: (cl[0].y + cl[cl.length - 1].y) / 2 };
                  return (
                    <g key={m.id} style={{ cursor: tool === "select" ? "move" : "crosshair" }} onPointerDown={(e) => startMoveMarkup(e, m.id)}>
                      <polygon points={cor} fill={col} fillOpacity={0.12} stroke={col} strokeWidth={1.2} strokeDasharray={m.util === "water" ? "5 4" : undefined} />
                      <polyline points={cl.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={col} strokeWidth={2.2} />
                      <polygon points={pad} fill={col} fillOpacity={0.88} stroke="#fff" strokeWidth={1} />
                      <text x={padC.x} y={padC.y + 3} textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff" pointerEvents="none">{m.fitting}</text>
                      <text x={mid.x} y={mid.y - 5} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={col} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{m.label}</text>
                    </g>
                  );
                }
                if (m.kind === "traced" || m.kind === "infwater") {
                  const pp = m.pts.map((p) => f2p(p));
                  const s = pp.map((q) => `${q.x},${q.y}`).join(" ");
                  const mid = pp[Math.floor((pp.length - 1) / 2)];
                  const col = isSel ? PAL.accent : m.stroke;
                  return (
                    <g key={m.id} style={{ cursor: tool === "select" ? "move" : "crosshair" }} onPointerDown={(e) => startMoveMarkup(e, m.id)}>
                      <polyline points={s} fill="none" stroke={col} strokeWidth={m.weight ?? 2.4} strokeDasharray={dashArray(m.dash, m.weight ?? 2.4)} strokeLinejoin="round" />
                      {m.kind === "infwater" && pp.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill="#dc2626" stroke="#fff" strokeWidth={1} />)}
                      {m.kind === "traced" && pp.map((q, i) => <rect key={i} x={q.x - 2} y={q.y - 2} width={4} height={4} fill={col} stroke="#fff" strokeWidth={0.8} />)}
                      {mid && <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize="9.5" fontWeight="700" fill={col} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{m.label}</text>}
                    </g>
                  );
                }
                if (m.kind === "encumbrance") {
                  const ring = m.pts.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");
                  const cen = (m.centerline || []).map(f2p);
                  const ctr = centroid(m.pts), cp = f2p(ctr);
                  return (
                    <g key={m.id} style={{ cursor: tool === "select" ? "move" : "crosshair" }} onPointerDown={(e) => startMoveMarkup(e, m.id)}>
                      <polygon points={ring} fill="url(#pat-encumber)" stroke={stroke} strokeWidth={sw} strokeDasharray={da} />
                      {/* centerline + per-call bearing/distance labels */}
                      {cen.length > 1 && <polyline points={cen.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={stroke} strokeWidth={0.8} strokeDasharray="4 3" opacity={0.7} pointerEvents="none" />}
                      {view.ppf > 0.12 && (m.calls || []).map((c, i) => {
                        const a = cen[i], b = cen[i + 1]; if (!a || !b) return null;
                        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
                        return <text key={i} x={mx} y={my - 3} textAnchor="middle" fontSize="9" fontFamily="ui-monospace, monospace" fill={stroke} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 2.5 }}>{c.label}</text>;
                      })}
                      <text x={cp.x} y={cp.y} textAnchor="middle" fontSize="11" fontWeight="700" fill={stroke} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{m.label}</text>
                    </g>
                  );
                }
                if (m.kind === "easement") {
                  const tcol = easementColor(m);
                  const ecol = isSel ? PAL.accent : tcol;
                  const proposed = m.status === "proposed";
                  const ring = m.pts.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");
                  const cen = (m.centerline && m.mode !== "boundary") ? m.centerline.map(f2p) : [];
                  const cp = f2p(centroid(m.pts));
                  const area = easementArea(m);
                  return (
                    <g key={m.id} style={{ cursor: tool === "select" ? "move" : "crosshair" }} onPointerDown={(e) => startMoveMarkup(e, m.id)}>
                      <polygon points={ring} fill={`url(#pat-ease-${easementType(m.easeType).key})`} stroke={ecol} strokeWidth={isSel ? 2.4 : 1.8} strokeDasharray={proposed ? "7 5" : undefined} />
                      {/* centerline shown for strip easements; flat-capped strip is the polygon above */}
                      {cen.length > 1 && <polyline points={cen.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke={ecol} strokeWidth={0.9} strokeDasharray="4 3" opacity={0.7} pointerEvents="none" />}
                      {view.ppf > 0.05 && <text x={cp.x} y={cp.y} textAnchor="middle" fontSize="10.5" fontWeight="700" fill={ecol} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{easementLabel(m)}{proposed ? " (proposed)" : ""}</text>}
                      {isSel && view.ppf > 0.05 && <text x={cp.x} y={cp.y + 12} textAnchor="middle" fontSize="9" fontWeight="600" fill={ecol} pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 2.5 }}>{Math.round(area).toLocaleString()} sf · {(area / SQFT_PER_ACRE).toFixed(2)} ac</text>}
                    </g>
                  );
                }
                if (m.kind === "line") { const a = f2p(m.a), b = f2p(m.b); return <line key={m.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...common} />; }
                if (m.kind === "polyline") { const s = m.pts.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" "); return <polyline key={m.id} points={s} {...common} />; }
                if (m.kind === "polygon") { const s = m.pts.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" "); return <polygon key={m.id} points={s} {...common} {...fillProps} />; }
                const c = f2p({ x: m.cx, y: m.cy }), w = m.w * view.ppf, h = m.h * view.ppf;
                if (m.kind === "ellipse") return <ellipse key={m.id} cx={c.x} cy={c.y} rx={w / 2} ry={h / 2} transform={`rotate(${m.rot || 0} ${c.x} ${c.y})`} {...common} {...fillProps} />;
                return <rect key={m.id} x={c.x - w / 2} y={c.y - h / 2} width={w} height={h} transform={`rotate(${m.rot || 0} ${c.x} ${c.y})`} {...common} {...fillProps} />;
              })}
              {/* ditch cross-section line (in-progress + last result) */}
              {(xsecMode && xsecPts.length === 1 && cursor) && (() => { const a = f2p(xsecPts[0]), b = f2p(cursor); return <line data-export="skip" x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e7490" strokeWidth={2} strokeDasharray="6 4" pointerEvents="none" />; })()}
              {xsec && (() => { const a = f2p(xsec.p0), b = f2p(xsec.p1); return <g data-export="skip" pointerEvents="none"><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e7490" strokeWidth={2.4} /><circle cx={a.x} cy={a.y} r={3.5} fill="#0e7490" stroke="#fff" strokeWidth={1} /><circle cx={b.x} cy={b.y} r={3.5} fill="#0e7490" stroke="#fff" strokeWidth={1} /></g>; })()}
              {/* in-progress utility route (source → cursor) */}
              {routeMode?.stage === "building" && routeMode.source && cursor && (() => {
                const a = f2p(routeMode.source), b = f2p(cursor);
                return <g data-export="skip" pointerEvents="none">
                  <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={routeMode.util === "elec" ? "#b45309" : "#0891b2"} strokeWidth={2} strokeDasharray="6 4" />
                  <circle cx={a.x} cy={a.y} r={4} fill={routeMode.util === "elec" ? "#b45309" : "#0891b2"} stroke="#fff" strokeWidth={1.2} />
                </g>;
              })()}
              {/* in-progress power-line trace */}
              {traceMode && tracePts.length > 0 && (() => {
                const pp = tracePts.map((p) => f2p(p));
                const s = [...pp, cursor ? f2p(cursor) : pp[pp.length - 1]].map((q) => `${q.x},${q.y}`).join(" ");
                return <g data-export="skip" pointerEvents="none">
                  <polyline points={s} fill="none" stroke="#b45309" strokeWidth={2.4} strokeDasharray="6 4" />
                  {pp.map((q, i) => <rect key={i} x={q.x - 2.5} y={q.y - 2.5} width={5} height={5} fill="#b45309" stroke="#fff" strokeWidth={1} />)}
                </g>;
              })()}
              {/* multi-select outlines + marquee */}
              {multi.length > 1 && multi.map((m) => {
                const o = m.kind === "el" ? els.find((x) => x.id === m.id) : markups.find((x) => x.id === m.id);
                const bb = o && featBBox(o); if (!bb) return null;
                const p0 = f2p({ x: bb.x0, y: bb.y0 }), p1 = f2p({ x: bb.x1, y: bb.y1 });
                return <rect key={`ms${m.kind}${m.id}`} x={Math.min(p0.x, p1.x) - 2} y={Math.min(p0.y, p1.y) - 2} width={Math.abs(p1.x - p0.x) + 4} height={Math.abs(p1.y - p0.y) + 4} fill="none" stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />;
              })}
              {marquee && (() => { const a = f2p(marquee.a), b = f2p(marquee.b); return <rect x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} fill={PAL.accent} fillOpacity={0.08} stroke={PAL.accent} strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />; })()}
              {/* markup draft */}
              {mkRect && (() => {
                const a = f2p(mkRect.a), b = f2p(mkRect.b), sw = mkStyle.weight;
                const dp = { stroke: PAL.accent, strokeWidth: sw, strokeDasharray: "5 4", fill: "none", pointerEvents: "none" };
                if (mkRect.kind === "mline") return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...dp} />;
                const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
                return mkRect.kind === "mellipse" ? <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...dp} /> : <rect x={x} y={y} width={w} height={h} {...dp} />;
              })()}
              {mkPoly && (() => {
                const live = cursor ? (mkPoly.pts.length ? snapPt(snap45(mkPoly.pts[mkPoly.pts.length - 1], cursor)) : snapPt(cursor)) : null;
                const all = live ? [...mkPoly.pts, live] : mkPoly.pts;
                const s = all.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");
                const lp = live ? f2p(live) : null, total = pathLen(all);
                return <>
                  <polyline points={s} fill="none" stroke={PAL.accent} strokeWidth={mkStyle.weight} strokeDasharray="5 4" pointerEvents="none" />
                  {lp && all.length >= 2 && <text x={lp.x + 8} y={lp.y - 6} fontSize="11.5" fontFamily="ui-monospace, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700" pointerEvents="none">{f0(total)}′</text>}
                  {mkPoly.pts.map((p, i) => { const q = f2p(p); return <circle key={i} cx={q.x} cy={q.y} r={3.5} fill={PAL.accent} pointerEvents="none" />; })}
                </>;
              })()}
              {/* easement draft (centerline / boundary click-draw) — live ghost strip */}
              {tool === "easement" && easeMode !== "parceledge" && easeDraft && (() => {
                const live = cursor ? (easeDraft.pts.length ? snapPt(snap45(easeDraft.pts[easeDraft.pts.length - 1], cursor)) : snapPt(cursor)) : null;
                const all = live ? [...easeDraft.pts, live] : easeDraft.pts;
                const tcol = easementType(easeType).color;
                const ghost = easeMode === "centerline" && all.length >= 2 ? bufferPolyline(all, easeWidth)
                  : (easeMode === "boundary" && all.length >= 3 ? all : null);
                const s = all.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ");
                const lp = live ? f2p(live) : null;
                return <g data-export="skip" pointerEvents="none">
                  {ghost && <polygon points={ghost.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ")} fill={tcol} fillOpacity={0.12} stroke={tcol} strokeWidth={1.4} strokeDasharray="5 4" />}
                  <polyline points={s} fill="none" stroke={tcol} strokeWidth={2} strokeDasharray="5 4" />
                  {easeDraft.pts.map((p, i) => { const q = f2p(p); return <circle key={i} cx={q.x} cy={q.y} r={3.5} fill={tcol} />; })}
                  {lp && all.length >= 2 && easeMode === "centerline" && <text x={lp.x + 8} y={lp.y - 6} fontSize="11" fontFamily="ui-monospace, monospace" fill={tcol} stroke="#fff" strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(pathLen(all))}′ · {easeWidth}′ wide</text>}
                </g>;
              })()}
              {/* parcel-edge picker (NEW-3): clickable edge targets, highlighted run, ghost strip */}
              {tool === "easement" && easeMode === "parceledge" && parcels.filter((p) => p.active !== false).map((pc) => (
                <g key={`eepick${pc.id}`}>
                  {pc.points.map((p, i) => {
                    const q = f2p(p), r = f2p(pc.points[(i + 1) % pc.points.length]);
                    const on = easeEdges && easeEdges.parcelId === pc.id && easeEdges.idx.includes(i);
                    return <line key={i} x1={q.x} y1={q.y} x2={r.x} y2={r.y}
                      stroke={on ? PAL.accent : "rgba(0,0,0,0.001)"} strokeWidth={on ? 4 : 12} strokeLinecap="round"
                      style={{ cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); toggleEaseEdge(pc.id, i); }} />;
                  })}
                </g>
              ))}
              {tool === "easement" && easeMode === "parceledge" && easeEdges && (() => {
                const pc = parcels.find((p) => p.id === easeEdges.parcelId);
                if (!pc) return null;
                const strip = buildParcelEdgeStrip(pc.points, easeEdges.idx, easeWidth);
                if (!strip) return null;
                const tcol = easementType(easeType).color;
                return <polygon data-export="skip" pointerEvents="none" points={strip.ring.map((p) => { const q = f2p(p); return `${q.x},${q.y}`; }).join(" ")} fill={tcol} fillOpacity={0.14} stroke={tcol} strokeWidth={1.6} strokeDasharray="5 4" />;
              })()}
              {/* callouts & text boxes — sized in the drawing's frame (scale with
                  zoom) so they don't balloon when you zoom out. */}
              {callouts.map((c) => {
                const bp = f2p(c.box);
                const isSel = sel?.kind === "callout" && sel.id === c.id;
                const st = calloutStyle(c);
                const zk = view.ppf / 0.35;            // scale relative to the default zoom
                const fontPx = st.size * zk;
                const lines = String(c.text || "").split("\n");
                const charW = fontPx * 0.56 * (st.bold ? 1.05 : 1), lineH = fontPx * st.lineHeight;
                const padX = st.padX * zk, padY = st.padY * zk;
                const tw = Math.max(fontPx, ...lines.map((l) => l.length * charW));
                const w = tw + padX * 2, h = lines.length * lineH + padY * 2;
                const border = isSel ? PAL.accent : st.stroke;
                const anchor = st.align === "left" ? "start" : st.align === "right" ? "end" : "middle";
                const tx = st.align === "left" ? bp.x - w / 2 + padX : st.align === "right" ? bp.x + w / 2 - padX : bp.x;
                const hasLeader = !c.noLeader && c.tip;
                const tp = hasLeader ? f2p(c.tip) : null;
                const ah = Math.max(7, fontPx * 0.7);
                const ang = tp ? Math.atan2(tp.y - bp.y, tp.x - bp.x) : 0;
                return (
                  <g key={c.id}>
                    {hasLeader && <>
                      <line x1={bp.x} y1={bp.y} x2={tp.x} y2={tp.y} stroke={border} strokeWidth={1.6} />
                      <polygon points={`${tp.x},${tp.y} ${tp.x - ah * Math.cos(ang - 0.4)},${tp.y - ah * Math.sin(ang - 0.4)} ${tp.x - ah * Math.cos(ang + 0.4)},${tp.y - ah * Math.sin(ang + 0.4)}`} fill={border} />
                    </>}
                    <rect x={bp.x - w / 2} y={bp.y - h / 2} width={w} height={h} rx={4}
                      fill={st.fill} stroke={border} strokeWidth={isSel ? 2 : 1.4}
                      pointerEvents="all" /* B142: select across the whole box even when the fill is none/transparent (was only the painted area / thin border) */
                      style={{ cursor: tool === "select" ? "move" : "default" }}
                      onPointerDown={(e) => startMoveCallout(e, c.id, "box")}
                      onDoubleClick={(e) => { e.stopPropagation(); beginEditCallout(c.id); }} />
                    {editCallout?.id !== c.id && lines.map((ln, i) => (
                      <text key={i} x={tx} y={bp.y - h / 2 + padY + fontPx * 0.82 + i * lineH} textAnchor={anchor}
                        fontSize={fontPx} fill={st.color} textDecoration={st.underline ? "underline" : undefined}
                        fontWeight={st.bold ? 700 : 500} fontStyle={st.italic ? "italic" : "normal"} pointerEvents="none">{ln}</text>
                    ))}
                    {isSel && hasLeader && tool === "select" && (
                      <circle cx={tp.x} cy={tp.y} r={5} fill="#fff" stroke={PAL.accent} strokeWidth={2}
                        style={{ cursor: "move" }} onPointerDown={(e) => startMoveCallout(e, c.id, "tip")} />
                    )}
                  </g>
                );
              })}
              {/* callout draft: tip placed, waiting for the box click */}
              {tool === "callout" && calloutDraft && (<>
                {cursor && <line x1={f2p(calloutDraft.tip).x} y1={f2p(calloutDraft.tip).y} x2={f2p(cursor).x} y2={f2p(cursor).y} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />}
                <circle cx={f2p(calloutDraft.tip).x} cy={f2p(calloutDraft.tip).y} r={4} fill={PAL.accent} />
              </>)}
              {/* inline callout text editor (overlays the box) */}
              {/* B142b: full-canvas catcher so clicking ANYWHERE outside the editor finishes the
                  text box (Bluebeam-style). Needed because the canvas pointerdown preventDefaults
                  the textarea blur, which otherwise traps you in the editor. Sits under the textarea. */}
              {editCallout && <rect x={-100000} y={-100000} width={200000} height={200000} fill="transparent" pointerEvents="all" onPointerDown={(e) => { e.stopPropagation(); commitEditCallout(); }} />}
              {editCallout && (() => {
                const c = callouts.find((x) => x.id === editCallout.id);
                if (!c) return null;
                const st = calloutStyle(c);
                const fontPx = st.size * (view.ppf / 0.35);
                const bp = f2p(c.box), W = Math.max(200, fontPx * 12), H = Math.max(64, fontPx * 4);
                return (
                  <foreignObject x={bp.x - W / 2} y={bp.y - H / 2} width={W} height={H} style={{ overflow: "visible" }}>
                    <textarea autoFocus value={editCallout.text}
                      onChange={(e) => setEditCallout((s) => ({ ...s, text: e.target.value }))}
                      onBlur={commitEditCallout}
                      onPointerDown={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        // Bluebeam text box: Enter makes a new line; finish by clicking away or Esc.
                        if (e.key === "Escape") { e.preventDefault(); commitEditCallout(); }
                      }}
                      placeholder="Type; click away or Esc to finish"
                      maxLength={2000}
                      style={{ width: W, height: H, resize: "none", border: `2px solid ${PAL.accent}`, borderRadius: 4, padding: "5px 7px", fontSize: fontPx, lineHeight: st.lineHeight, textAlign: st.align, fontWeight: st.bold ? 700 : 500, fontStyle: st.italic ? "italic" : "normal", textDecoration: st.underline ? "underline" : "none", color: st.color, background: st.fill, outline: "none", boxSizing: "border-box", boxShadow: "0 4px 14px rgba(0,0,0,0.18)" }} />
                  </foreignObject>
                );
              })()}

              {/* Inline numeric editor — road width / per-edge setback / overlay trace length. NEVER a dialog box. */}
              {numEdit && <rect x={-100000} y={-100000} width={200000} height={200000} fill="transparent" pointerEvents="all" onPointerDown={(e) => { e.stopPropagation(); commitNumEdit(); }} />}
              {numEdit && (() => {
                const bp = f2p({ x: numEdit.fx, y: numEdit.fy });
                const W = 96, H = 30;
                return (
                  <foreignObject x={bp.x - W / 2} y={bp.y - H - 8} width={W} height={H} style={{ overflow: "visible" }}>
                    <input autoFocus type="number" value={numEdit.value}
                      onChange={(e) => setNumEdit((s) => ({ ...s, value: e.target.value }))}
                      onBlur={commitNumEdit}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commitNumEdit(); } else if (e.key === "Escape") { e.preventDefault(); cancelNumEdit(); } }}
                      style={{ width: W, height: H, border: `2px solid ${PAL.accent}`, borderRadius: 6, padding: "2px 6px", fontSize: 13, fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 600, color: PAL.ink, background: "#fff", outline: "none", boxSizing: "border-box", boxShadow: "0 4px 14px rgba(0,0,0,0.18)" }} />
                  </foreignObject>
                );
              })()}

              {/* measurements — line (distance), polyline (path length), area */}
              {measures.map((m, i) => {
                const fpts = measPts(m);
                if (fpts.length < 2) return null;
                const mode = measMode(m);
                const pts = fpts.map(f2p);
                const isSel = sel?.kind === "measure" && sel.i === i;
                const isArea = mode === "area";
                const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                // label + anchor point. Area shows area + perimeter; amber + ⚠ when uncalibrated.
                const warn = calibrationState === "uncalibrated";
                const mcolor = warn ? "#b45309" : PAL.accent;
                const perim = pathLen([...fpts, fpts[0]]);
                const lbl = (warn ? "⚠ " : "") + (isArea
                  ? `${f0(polyArea(fpts))} sf · ${f2(polyArea(fpts) / SQFT_PER_ACRE)} ac · ${f0(perim)}′ perim`
                  : `${f0(pathLen(fpts))}′`);
                const anchor = isArea ? f2p(centroid(fpts)) : (() => {
                  const a = pts[pts.length - 2], b = pts[pts.length - 1];
                  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                })();
                return (
                  <g key={m.id || `m${i}`}>
                    {isArea
                      ? <polygon points={ptsStr} fill={mcolor} fillOpacity={isSel ? 0.16 : 0.1} stroke={mcolor} strokeWidth={isSel ? 2.5 : 1.5} pointerEvents="none" />
                      : <polyline points={ptsStr} fill="none" stroke={mcolor} strokeWidth={isSel ? 2.5 : 1.5} pointerEvents="none" />}
                    {pts.map((p, k) => <circle key={k} cx={p.x} cy={p.y} r={3} fill={mcolor} pointerEvents="none" />)}
                    <text x={anchor.x} y={anchor.y - 5} textAnchor="middle" fontSize="12" fontFamily="ui-monospace, Menlo, monospace"
                      fill={mcolor} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700" pointerEvents="none">{lbl}</text>
                    {/* wide invisible hit path to select the measurement (select tool only) */}
                    {isArea
                      ? <polygon points={ptsStr} fill="transparent" stroke="transparent" strokeWidth={14}
                          pointerEvents={tool === "select" ? "all" : "none"} style={{ cursor: "pointer" }} onPointerDown={(e) => selectMeasure(e, i)} />
                      : <polyline points={ptsStr} fill="none" stroke="transparent" strokeWidth={14}
                          pointerEvents={tool === "select" ? "stroke" : "none"} style={{ cursor: "pointer" }} onPointerDown={(e) => selectMeasure(e, i)} />}
                    {isSel && tool === "select" && (
                      <g>
                        {/* B141: add-vertex ＋ on each editable edge (area wraps closed; line/polyline don't) */}
                        {pts.map((p, k) => {
                          if (!isArea && k === pts.length - 1) return null;
                          const q = pts[(k + 1) % pts.length], mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
                          return (
                            <g key={`mav${k}`} style={{ cursor: "copy" }} onPointerDown={(e) => addMeasureVertex(e, i, k)}>
                              <circle cx={mx} cy={my} r={5.5} fill={PAL.paper} stroke={mcolor} strokeWidth={1.25} />
                              <line x1={mx - 2.5} y1={my} x2={mx + 2.5} y2={my} stroke={mcolor} strokeWidth={1.25} />
                              <line x1={mx} y1={my - 2.5} x2={mx} y2={my + 2.5} stroke={mcolor} strokeWidth={1.25} />
                            </g>
                          );
                        })}
                        {/* B141: draggable vertex dots — drag to reshape, Shift-click to delete */}
                        {pts.map((p, k) => (
                          <rect key={`mv${k}`} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2}
                            fill={mcolor} stroke={PAL.paper} strokeWidth={1.5}
                            style={{ cursor: "move" }} onPointerDown={(e) => startMeasureVertex(e, i, k)} />
                        ))}
                        {/* delete the whole measurement */}
                        <g style={{ cursor: "pointer" }} onPointerDown={(e) => { e.stopPropagation(); pushHistory(); setMeasures((arr) => arr.filter((_, idx) => idx !== i)); setSel(null); }}>
                          <circle cx={anchor.x} cy={anchor.y - 22} r={8.5} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />
                          <text x={anchor.x} y={anchor.y - 22} dy={3.5} textAnchor="middle" fontSize="12" fontWeight="700" fill={PAL.accent} pointerEvents="none">×</text>
                        </g>
                      </g>
                    )}
                  </g>
                );
              })}
              {/* in-progress measure draft */}
              {tool === "measure" && measDraft.length > 0 && (() => {
                const live = cursor ? snapPt(cursor) : null;
                const all = live ? [...measDraft, live] : measDraft;
                const pts = all.map(f2p);
                const ptsStr = pts.map((p) => `${p.x},${p.y}`).join(" ");
                const isArea = measureMode === "area";
                const lp = pts[pts.length - 1];
                const lbl = isArea
                  ? (all.length >= 3 ? `${f0(polyArea(all))} sf` : "")
                  : (all.length >= 2 ? `${f0(pathLen(all))}′` : "");
                return (
                  <g pointerEvents="none">
                    {isArea && all.length >= 3
                      ? <polygon points={ptsStr} fill={PAL.accent} fillOpacity={0.1} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />
                      : <polyline points={ptsStr} fill="none" stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />}
                    {measDraft.map((p, k) => { const c = f2p(p); return <circle key={k} cx={c.x} cy={c.y} r={k === 0 ? 5 : 3.5} fill={k === 0 ? PAL.paper : PAL.accent} stroke={PAL.accent} strokeWidth={1.5} />; })}
                    {lbl && <text x={lp.x} y={lp.y - 8} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{lbl}</text>}
                  </g>
                );
              })()}
              {/* calibration pick (unsnapped, drawn over the underlay) */}
              {calib?.a && (() => {
                const a = f2p(calib.a);
                const b = calib.b ? f2p(calib.b) : (cursor ? f2p(cursor) : a);
                const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const measured = calib.b ? dist(calib.a, calib.b) : (cursor ? dist(calib.a, cursor) : 0);
                return (
                  <g pointerEvents="none">
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray={calib.b ? "none" : "5 4"} />
                    <circle cx={a.x} cy={a.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />
                    {calib.b && <circle cx={b.x} cy={b.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />}
                    <text x={mid.x} y={mid.y - 7} textAnchor="middle" fontSize="12" fontFamily="ui-monospace, Menlo, monospace"
                      fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(measured)}′ now</text>
                  </g>
                );
              })()}
              {/* draft polygon */}
              {draftPoly && (
                <g pointerEvents="none">
                  <polyline points={[...draftPoly, ...(cursor ? [snapPt(cursor)] : [])].map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill="none" stroke={PAL.accent} strokeWidth={1.75} strokeDasharray="6 5" />
                  {draftPoly.map((p, i) => { const c = f2p(p); return <circle key={i} cx={c.x} cy={c.y} r={i === 0 ? 5 : 3.5} fill={i === 0 ? PAL.paper : PAL.accent} stroke={PAL.accent} strokeWidth={1.5} />; })}
                </g>
              )}
              {/* draft rect */}
              {draftRect && (() => { const a = f2p({ x: draftRect.x, y: draftRect.y }), pw = draftRect.w * view.ppf, ph = draftRect.h * view.ppf;
                const curb = +settings.roadCurb || CURB, dw = draftRect.type === "road" ? Math.max(0, Math.min(draftRect.w, draftRect.h) - 2 * curb) : 0;
                return (
                <g pointerEvents="none"><rect x={a.x} y={a.y} width={pw} height={ph} fill={typeStyle(draftRect.type, settings).fill} fillOpacity={0.5} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />
                  {(draftRect.w > 2 || draftRect.h > 2) && <text x={a.x + pw + 6} y={a.y + ph + 14} fontSize="11.5" fontFamily="ui-monospace, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{draftRect.type === "road" ? `${f0(dw)}′ travel` : `${f0(draftRect.w)}′ × ${f0(draftRect.h)}′`}</text>}
                </g>
              ); })()}
              {/* fixed-width road centerline preview (two-click) */}
              {draftRoad && (() => {
                const A = { x: draftRoad.ax, y: draftRoad.ay }, B = { x: draftRoad.bx, y: draftRoad.by }, len = dist(A, B);
                if (len < 1) return null;
                const ang = Math.atan2(B.y - A.y, B.x - A.x), nx = -Math.sin(ang), ny = Math.cos(ang), hw = draftRoad.cross / 2;
                const corners = [{ x: A.x + nx * hw, y: A.y + ny * hw }, { x: B.x + nx * hw, y: B.y + ny * hw }, { x: B.x - nx * hw, y: B.y - ny * hw }, { x: A.x - nx * hw, y: A.y - ny * hw }].map(f2p);
                const a = f2p(A), b = f2p(B), mid = f2p({ x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 });
                return (
                  <g pointerEvents="none">
                    <polygon points={corners.map((p) => `${p.x},${p.y}`).join(" ")} fill={typeStyle("road", settings).fill} fillOpacity={0.5} stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="5 4" />
                    <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={PAL.accent} strokeWidth={1} strokeDasharray="4 4" />
                    <text x={mid.x} y={mid.y - 6} textAnchor="middle" fontSize="11.5" fontFamily="ui-monospace, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(len)}′</text>
                  </g>
                );
              })()}
              {/* live dims for the markup rect/ellipse draft */}
              {mkRect && mkRect.kind !== "mline" && (() => {
                const a = f2p(mkRect.a), b = f2p(mkRect.b), w = Math.abs(mkRect.b.x - mkRect.a.x), h = Math.abs(mkRect.b.y - mkRect.a.y);
                return <text x={Math.max(a.x, b.x) + 6} y={Math.max(a.y, b.y) + 14} fontSize="11.5" fontFamily="ui-monospace, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700" pointerEvents="none">{f0(w)}′ × {f0(h)}′</text>;
              })()}
              {mkRect && mkRect.kind === "mline" && (() => {
                const b = f2p(mkRect.b);
                return <text x={b.x + 8} y={b.y - 6} fontSize="11.5" fontFamily="ui-monospace, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700" pointerEvents="none">{f0(dist(mkRect.a, mkRect.b))}′</text>;
              })()}
              {/* draft polygon element (clicking perimeter points) */}
              {draftElPoly && (
                <g pointerEvents="none">
                  <polyline points={[...draftElPoly.pts, ...(cursor ? [snapPt(cursor)] : [])].map((p) => `${f2p(p).x},${f2p(p).y}`).join(" ")} fill={typeStyle(draftElPoly.type, settings).fill} fillOpacity={0.35} stroke={PAL.accent} strokeWidth={1.75} strokeDasharray="6 5" />
                  {draftElPoly.pts.map((p, i) => { const c = f2p(p); return <circle key={i} cx={c.x} cy={c.y} r={i === 0 ? 5 : 3.5} fill={i === 0 ? PAL.paper : PAL.accent} stroke={PAL.accent} strokeWidth={1.5} />; })}
                </g>
              )}
              {/* split cut preview (polyline) */}
              {tool === "split" && splitPath.length > 0 && (() => {
                const live = cursor ? snapSplit(cursor) : null;
                const all = live ? [...splitPath, live] : splitPath;
                const ptsStr = all.map((p) => { const c = f2p(p); return `${c.x},${c.y}`; }).join(" ");
                let total = 0;
                for (let i = 1; i < all.length; i++) total += dist(all[i - 1], all[i]);
                const lp = f2p(all[all.length - 1]);
                return (
                  <g pointerEvents="none">
                    <polyline points={ptsStr} fill="none" stroke={PAL.accent} strokeWidth={1.5} strokeDasharray="6 5" />
                    {splitPath.map((p, i) => { const c = f2p(p); return <circle key={i} cx={c.x} cy={c.y} r={4} fill={PAL.paper} stroke={PAL.accent} strokeWidth={1.5} />; })}
                    {live && all.length >= 2 && <text x={lp.x} y={lp.y - 8} textAnchor="middle" fontSize="11" fontFamily="ui-monospace, Menlo, monospace" fill={PAL.accent} stroke={PAL.paper} strokeWidth={3} paintOrder="stroke" fontWeight="700">{f0(total)}′ cut</text>}
                  </g>
                );
              })()}

              {parcelLabels}
              {labelEls}
              {/* selection / editing chrome — stripped from exports */}
              <g data-export="skip">
                {attachLinks}
                {parcelEdgeLabels}
                {handleNodes}
                {sideAddNodes}
                {courtAddNodes}
                {parkingAddNodes}
                {parcelHandles}
                {elPolyHandles}
                {markupHandles}
                {attachHint && (() => {
                  const p = f2p(attachHint);
                  return (
                    <g pointerEvents="none">
                      <circle cx={p.x} cy={p.y} r={9} fill="#16a34a" stroke="#ffffff" strokeWidth={1.75} />
                      <line x1={p.x - 4.5} y1={p.y} x2={p.x + 4.5} y2={p.y} stroke="#ffffff" strokeWidth={1.75} />
                      <line x1={p.x} y1={p.y - 4.5} x2={p.x} y2={p.y + 4.5} stroke="#ffffff" strokeWidth={1.75} />
                    </g>
                  );
                })()}
              </g>
            </g>

            {/* On-screen sheet furniture — the SAME measurement-grade scale bar
                (bottom-right) and north arrow (bottom-left) the export uses, sized
                for the screen via lib/sheetFurniture.js. data-export="skip" so the
                export composites its own frame-anchored copy instead. The planner
                canvas is north-up, so the arrow points straight up. */}
            <g data-export="skip" fontFamily="Inter, system-ui, sans-serif" pointerEvents="none"
              dangerouslySetInnerHTML={{ __html: buildScreenFurnitureSvg({ vw: size.w, vh: size.h, ftPerUnit: 1 / view.ppf, fmtFeet: f0, pal: PAL }) }} />

            {/* print-frame crop overlay (screen space) */}
            {printMode && printFrame && (() => {
              const a = f2p({ x: printFrame.cx - printFrame.wFt / 2, y: printFrame.cy - printFrame.hFt / 2 });
              const b = f2p({ x: printFrame.cx + printFrame.wFt / 2, y: printFrame.cy + printFrame.hFt / 2 });
              const fx = Math.min(a.x, b.x), fy = Math.min(a.y, b.y), fw = Math.abs(b.x - a.x), fh = Math.abs(b.y - a.y);
              const HS = 9;
              const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
              return (
                <g data-export="skip">
                  {/* dim mask outside the frame (4 rects) */}
                  <rect x={0} y={0} width={size.w} height={fy} fill="rgba(20,18,15,0.46)" pointerEvents="none" />
                  <rect x={0} y={fy + fh} width={size.w} height={Math.max(0, size.h - fy - fh)} fill="rgba(20,18,15,0.46)" pointerEvents="none" />
                  <rect x={0} y={fy} width={fx} height={fh} fill="rgba(20,18,15,0.46)" pointerEvents="none" />
                  <rect x={fx + fw} y={fy} width={Math.max(0, size.w - fx - fw)} height={fh} fill="rgba(20,18,15,0.46)" pointerEvents="none" />
                  <rect x={fx} y={fy} width={fw} height={fh} fill="none" stroke={PAL.accent} strokeWidth={2}
                    pointerEvents="all" style={{ cursor: "move" }} onPointerDown={startPrintMove} />
                  {corners.map(([sx, sy], i) => (
                    <rect key={i} x={(sx < 0 ? fx : fx + fw) - HS / 2} y={(sy < 0 ? fy : fy + fh) - HS / 2} width={HS} height={HS} rx={2}
                      fill="#fff" stroke={PAL.accent} strokeWidth={2} style={{ cursor: (sx * sy > 0 ? "nwse-resize" : "nesw-resize") }}
                      onPointerDown={(e) => startPrintResize(e, sx, sy)} />
                  ))}
                </g>
              );
            })()}

            {/* During overlay trace/align, capture EVERY click as a calibration point —
                a transparent top layer so a click on the overlay/parcels/elements places
                a point instead of starting a move or selection (fixes "Align doesn't work"). */}
            {ovCalib && (
              <rect x={0} y={0} width={size.w} height={size.h} fill="transparent" pointerEvents="all"
                style={{ cursor: "crosshair" }}
                onPointerDown={(e) => { if (e.button === 0) { e.stopPropagation(); onOvCalibClick(p2f(e.clientX, e.clientY)); } }} />
            )}
          </svg>

          {/* Layers control (located sites) — same shared layers as the map finder */}
          {origin && (
            <div data-export="skip" data-wheelscroll="1" style={{ position: "absolute", top: 10, right: 10, zIndex: 6, width: layersOpen ? 226 : "auto", background: "rgba(255,255,255,0.95)", border: `1px solid ${PAL.panelLine}`, borderRadius: 9, boxShadow: "0 2px 10px rgba(28,25,20,0.16)", overflow: "hidden" }}>
              <button onClick={() => setLayersOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 7, width: "100%", padding: "8px 11px", border: "none", background: "transparent", color: PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 700 }}>
                <span style={{ color: PAL.accent }}>❖</span> Layers <span style={{ flex: 1 }} /> <span style={{ color: PAL.muted, fontWeight: 500 }}>{layersOpen ? "▾" : "▸"}</span>
              </button>
              {layersOpen && (
                <div style={{ padding: "2px 11px 10px", maxHeight: "62vh", overflowY: "auto" }}>
                  <label style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer", fontSize: 12.5, color: PAL.ink, paddingBottom: 6, marginBottom: 6, borderBottom: `1px solid ${PAL.panelLine}` }}>
                    <input type="checkbox" checked={basemapOn} onChange={(e) => setBasemapOn(e.target.checked)} />
                    <span style={{ flex: 1 }}>Aerial basemap</span>
                  </label>
                  <LayerPanel overlays={overlays} setOverlays={setOverlays} county={restored?.county || county} layerStatus={layerStatus} />
                  {/* utility-evidence drawing tools */}
                  <div style={{ borderTop: `1px solid ${PAL.panelLine}`, marginTop: 8, paddingTop: 7 }}>
                    <div style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 5 }}>Evidence tools</div>
                    <button onClick={() => { setTracePts([]); setTraceMode((m) => !m); }} title="Click along a visible pole line on the aerial; double-click or Enter to finish"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4, borderRadius: 7, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${traceMode ? "#b45309" : PAL.panelLine}`, background: traceMode ? "#b45309" : "#fff", color: traceMode ? "#fff" : PAL.ink, fontWeight: 600 }}>
                      {traceMode ? "✏ Tracing… (Esc / dbl-click to finish)" : "✏ Trace overhead electric"}
                    </button>
                    <button onClick={() => startRoute("elec")} title="Route electric service from a traced pole line to a building (10′ easement + transformer pad)"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4, borderRadius: 7, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${routeMode?.util === "elec" ? "#b45309" : PAL.panelLine}`, background: routeMode?.util === "elec" ? "#b45309" : "#fff", color: routeMode?.util === "elec" ? "#fff" : PAL.ink, fontWeight: 600 }}>
                      ⚡ Route electric service
                    </button>
                    <button onClick={startWaterRoute} title="Route water service from a main to a building, easement width from the jurisdiction rule below"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4, borderRadius: 7, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${routeMode?.util === "water" ? "#0891b2" : PAL.panelLine}`, background: routeMode?.util === "water" ? "#0891b2" : "#fff", color: routeMode?.util === "water" ? "#fff" : PAL.ink, fontWeight: 600 }}>
                      🚰 Route water service
                    </button>
                    <button onClick={inferWaterMain} disabled={evidenceBusy} title="Connect the fire hydrants in view into a screening-only water main"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4, borderRadius: 7, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${PAL.panelLine}`, background: "#fff", color: PAL.ink, fontWeight: 600, opacity: evidenceBusy ? 0.6 : 1 }}>
                      {evidenceBusy ? "Inferring…" : "⌁ Infer water main from hydrants"}
                    </button>
                    <button onClick={() => { const on = !xsecMode; setXsecMode(on); setXsecPts([]); if (on) { setXsec(null); flashWarn("Click one bank of the ditch, then the other side.", 0); } else setOverlapWarn(""); }}
                      title="Draw a line across a ditch to sample USGS 3DEP elevation and estimate depth/invert"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4, borderRadius: 7, fontSize: 11.5, fontFamily: "inherit", cursor: "pointer", border: `1px solid ${xsecMode ? "#0e7490" : PAL.panelLine}`, background: xsecMode ? "#0e7490" : "#fff", color: xsecMode ? "#fff" : PAL.ink, fontWeight: 600 }}>
                      {xsecMode ? "📏 Click both banks… (Esc to cancel)" : "📏 Cross-section (ditch)"}
                    </button>
                    {/* per-jurisdiction easement-rule table (editable; placeholders marked VERIFY) */}
                    <button onClick={() => setRulesOpen((o) => !o)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 6, padding: "5px 2px", border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontFamily: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase" }}>
                      Easement rules <span style={{ flex: 1 }} /> <span>{rulesOpen ? "▾" : "▸"}</span>
                    </button>
                    {rulesOpen && (() => {
                      const rule = easeRules[jurKey] || easeRules.generic;
                      return (
                        <div style={{ background: "#faf8f3", borderRadius: 8, padding: "7px 9px", marginBottom: 2 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
                            <span style={{ fontSize: 11, color: PAL.muted }}>Jurisdiction</span>
                            <select value={jurKey} onChange={(e) => setJurKey(e.target.value)} style={{ ...numInput, flex: 1, width: "auto", fontFamily: "inherit", fontSize: 11.5 }}>
                              {Object.entries(easeRules).map(([k, r]) => <option key={k} value={k}>{r.label}</option>)}
                            </select>
                          </div>
                          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span style={{ fontSize: 11, color: PAL.muted }}>Water easement</span>
                            <NumInput style={{ ...numInput, width: 52 }} value={rule.waterWidth} min={1} onCommit={(n) => setRule(jurKey, { waterWidth: n })} /> <span style={{ fontSize: 11, color: PAL.muted }}>ft</span>
                            <span style={{ flex: 1 }} />
                            <label style={{ display: "flex", gap: 4, alignItems: "center", fontSize: 10.5, color: rule.verified ? "#15803d" : "#b45309", cursor: "pointer", fontWeight: 600 }}>
                              <input type="checkbox" checked={rule.verified} onChange={(e) => setRule(jurKey, { verified: e.target.checked })} /> {rule.verified ? "verified" : "VERIFY"}
                            </label>
                          </div>
                          <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.4, marginTop: 5 }}>{rule.note}</div>
                        </div>
                      );
                    })()}
                    <button disabled title="Roadmap — not yet available"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 7, fontSize: 11.5, fontFamily: "inherit", cursor: "not-allowed", border: `1px dashed ${PAL.panelLine}`, background: "#faf8f3", color: PAL.muted, fontWeight: 600 }}>
                      🛰 AI corridor scan — coming soon
                    </button>
                  </div>
                  <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 8, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 6 }}>Layers sit beneath your drawing and stay locked to the plan as you pan and zoom.</div>
                </div>
              )}
            </div>
          )}

          {/* empty state */}
          {parcels.length === 0 && els.length === 0 && !underlay && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
              <div style={{ textAlign: "left", color: PAL.muted, background: "rgba(255,255,255,0.88)", padding: "20px 24px", borderRadius: 14, border: `1px solid ${PAL.panelLine}`, boxShadow: "0 8px 32px rgba(28,25,20,0.08)", maxWidth: 380 }}>
                <div style={{ fontSize: 14.5, fontWeight: 700, color: PAL.ink, marginBottom: 10 }}>Start your site</div>
                {[
                  ["1", <>Pick a <b>parcel from the map</b> (‹ Map) to start from real county data,</>],
                  ["2", <>or drop a <b>screenshot underlay</b> and calibrate it,</>],
                  ["3", <>or draw one with the <b>Boundary</b> tool (right rail).</>],
                ].map(([n, body]) => (
                  <div key={n} style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 12.5, lineHeight: 1.55, marginBottom: 5 }}>
                    <span style={{ width: 17, height: 17, borderRadius: 99, background: "#f1ece1", color: "#6b6557", fontSize: 10.5, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "none", transform: "translateY(2px)" }}>{n}</span>
                    <span>{body}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* aerial loading indicator (not while the live basemap stands in for the captured underlay) */}
          {showAerial && underlayLoading && !(origin && basemapOn) && (
            <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", background: "rgba(25,22,19,0.92)", color: "#fff", padding: "7px 15px", borderRadius: 99, fontSize: 12.5, fontWeight: 500, pointerEvents: "none", display: "flex", alignItems: "center", gap: 9, boxShadow: "0 6px 22px rgba(0,0,0,0.28)" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: PAL.ember, display: "inline-block", animation: "pf-pulse 1.1s ease-in-out infinite" }} />
              Loading aerial…
            </div>
          )}

          {/* calibration / accuracy badge (bottom-left, above the status bar) */}
          {(() => {
            const cfg = {
              georef: { bg: "rgba(22,101,52,0.92)", dot: "#4ade80", text: "● Scaled · county GIS", sub: null },
              calibrated: { bg: "rgba(22,101,52,0.92)", dot: "#4ade80", text: "● Scaled · calibrated", sub: underlay ? `1 px = ${f2(underlay.ftPerPx)} ft` : null },
              drawn: { bg: "rgba(40,37,33,0.92)", dot: "#cbd5e1", text: "● True scale · drawn in feet", sub: null },
              uncalibrated: { bg: "rgba(180,83,9,0.95)", dot: "#fbbf24", text: "▲ Not calibrated", sub: "click to calibrate" },
            }[calibrationState];
            const warn = calibrationState === "uncalibrated";
            return (
              <div onClick={warn ? () => { setShowAerial(true); setTool("calibrate"); setCalib(null); } : undefined}
                style={{ position: "absolute", left: 12, bottom: 40, display: "flex", alignItems: "center", gap: 8, background: cfg.bg, color: "#fff", padding: "5px 11px", borderRadius: 99, fontSize: 11.5, fontWeight: 600, boxShadow: "0 4px 14px rgba(0,0,0,0.22)", cursor: warn ? "pointer" : "default", zIndex: 6 }}>
                <span style={{ width: 7, height: 7, borderRadius: 99, background: cfg.dot, animation: warn ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
                {cfg.text}{cfg.sub && <span style={{ fontWeight: 400, opacity: 0.85, fontFamily: "ui-monospace, monospace" }}>· {cfg.sub}</span>}
              </div>
            );
          })()}

          {/* zoom controls (bottom-right, above the scale bar) */}
          {(() => {
            const zb = { width: 30, height: 30, display: "grid", placeItems: "center", border: `1px solid ${PAL.panelLine}`, background: "rgba(255,255,255,0.92)", color: PAL.ink, cursor: "pointer", fontSize: 16, fontWeight: 600 };
            const zoomBy = (f) => setView((v) => { const mx = size.w / 2, my = size.h / 2, fx = (mx - v.offX) / v.ppf, fy = (my - v.offY) / v.ppf, ppf = Math.max(0.02, Math.min(8, v.ppf * f)); return { ppf, offX: mx - fx * ppf, offY: my - fy * ppf }; });
            return (
              <div data-export="skip" style={{ position: "absolute", right: 14, bottom: 78, display: "flex", flexDirection: "column", borderRadius: 9, overflow: "hidden", boxShadow: "0 4px 14px rgba(0,0,0,0.18)", zIndex: 6 }}>
                <button className="gbtn" aria-label="Zoom in" title="Zoom in" style={{ ...zb, borderRadius: 0 }} onClick={() => zoomBy(1.25)}>＋</button>
                <button className="gbtn" aria-label="Zoom out" title="Zoom out" style={{ ...zb, borderTop: "none", borderRadius: 0 }} onClick={() => zoomBy(1 / 1.25)}>－</button>
                <button className="gbtn" aria-label="Zoom to fit" title="Zoom to fit" style={{ ...zb, borderTop: "none", borderRadius: 0, fontSize: 14 }} onClick={fit}>⤢</button>
              </div>
            );
          })()}

          {/* print-frame toolbar */}
          {printMode && (() => {
            const seg = (on) => ({ padding: "5px 11px", fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${on ? PAL.accent : "#ddd6c5"}`, background: on ? PAL.accent : "#fff", color: on ? "#fff" : PAL.ink });
            return (
              <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", display: "flex", alignItems: "center", gap: 12, background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 11, boxShadow: "0 8px 26px rgba(0,0,0,0.22)", padding: "8px 12px", zIndex: 9 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: PAL.muted }}>Print frame</span>
                <span style={{ display: "flex", gap: 4 }}>
                  <button style={seg(printPaper === "letter")} onClick={() => setPrintPaper("letter")}>Letter</button>
                  <button style={seg(printPaper === "tabloid")} onClick={() => setPrintPaper("tabloid")}>Tabloid</button>
                </span>
                <span style={{ display: "flex", gap: 4 }}>
                  <button style={seg(printOrient === "landscape")} onClick={() => setPrintOrient("landscape")}>Landscape</button>
                  <button style={seg(printOrient === "portrait")} onClick={() => setPrintOrient("portrait")}>Portrait</button>
                </span>
                {/* B131 — include the placed site-plan overlay in the printout; only shown when one's loaded (no dead control) */}
                {overlayPrintable && (
                  <label title="Include the placed site-plan overlay in the printout — exactly as shown (scale, position, rotation, opacity)" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: PAL.ink, cursor: "pointer", userSelect: "none", whiteSpace: "nowrap" }}>
                    <input type="checkbox" checked={printOverlay} onChange={(e) => setPrintOverlay(e.target.checked)} style={{ cursor: "pointer", margin: 0 }} />
                    Print overlay
                  </label>
                )}
                <span style={{ width: 1, height: 18, background: PAL.panelLine }} />
                <button style={{ ...btn(true), padding: "6px 14px" }} onClick={doPrint}>Print</button>
                <button style={{ ...chip }} onClick={() => { setPrintMode(false); setPrintFrame(null); }}>Cancel</button>
              </div>
            );
          })()}

          {/* Merge selection banner — Shift-click parcels to multi-select, then Merge */}
          {tool === "select" && combineSel.length > 0 && (
            <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", background: "rgba(25,22,19,0.94)", color: "#fff", padding: "6px 8px 6px 15px", borderRadius: 99, fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 6px 22px rgba(0,0,0,0.28)" }}>
              {combineSel.length < 2 ? `Shift-click another parcel to merge — ${combineSel.length} selected` : `${combineSel.length} parcels selected`}
              <button className="dbtn" style={{ ...btn(combineSel.length >= 2), padding: "5px 12px", opacity: combineSel.length >= 2 ? 1 : 0.5, cursor: combineSel.length >= 2 ? "pointer" : "default" }}
                disabled={combineSel.length < 2} onClick={mergeParcels}>Merge parcels ⏎</button>
              <button className="dbtn" style={{ ...chip, padding: "5px 10px" }} onClick={() => setCombineSel([])}>Clear</button>
            </div>
          )}

          {/* Parcel-edge easement banner (NEW-3) — click edges to build a run, then create */}
          {tool === "easement" && easeMode === "parceledge" && (
            <div style={{ position: "absolute", top: 14, left: "50%", transform: "translateX(-50%)", background: "rgba(25,22,19,0.94)", color: "#fff", padding: "6px 8px 6px 15px", borderRadius: 99, fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", gap: 10, boxShadow: "0 6px 22px rgba(0,0,0,0.28)" }}>
              {easeEdges && easeEdges.idx.length ? `${easeEdges.idx.length} edge${easeEdges.idx.length > 1 ? "s" : ""} · ${easeWidth}′ inset` : "Click a parcel's edges to select a contiguous run"}
              <button className="dbtn" style={{ ...btn(!!(easeEdges && easeEdges.idx.length)), padding: "5px 12px", opacity: (easeEdges && easeEdges.idx.length) ? 1 : 0.5, cursor: (easeEdges && easeEdges.idx.length) ? "pointer" : "default" }}
                disabled={!(easeEdges && easeEdges.idx.length)} onClick={finishEaseEdges}>Create easement ⏎</button>
              {easeEdges && <button className="dbtn" style={{ ...chip, padding: "5px 10px" }} onClick={() => setEaseEdges(null)}>Clear</button>}
            </div>
          )}

          {/* status bar — dark chrome */}
          <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, display: "flex", alignItems: "center", padding: "0 16px", height: 30, fontSize: 11.5, color: PAL.chromeMuted, background: "rgba(25,22,19,0.94)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", borderTop: `1px solid ${PAL.chromeLine}`, zIndex: 5 }}>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", minWidth: 124, fontVariantNumeric: "tabular-nums", color: PAL.chromeInk }}>{cursor ? `${f0(cursor.x)}′, ${f0(cursor.y)}′` : "—"}</span>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", minWidth: 96 }}>{underlay ? `1 px = ${f2(underlay.ftPerPx)} ft` : `${Math.round(view.ppf * 100) / 100} px/ft`}</span>
            <span style={{ width: 1, height: 14, background: PAL.chromeLine, margin: "0 14px" }} />
            <span style={{ color: (attachFor || alignFor) ? PAL.ember : PAL.chromeMuted, fontWeight: (attachFor || alignFor) ? 600 : 400, flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {attachFor ? "Click a host to bond to · Esc cancels" : alignFor ? "Click an edge to align to · Esc cancels" : identifyMode ? "Click a parcel to identify · Esc cancels" : curHint}
            </span>
            <span style={{ fontFamily: "ui-monospace, Menlo, monospace", color: PAL.chromeMuted, marginLeft: 14 }}>{f2(siteSqft / SQFT_PER_ACRE)} ac site</span>
            <button className="dbtn" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)" onClick={() => setShowShortcuts(true)} style={{ marginLeft: 12, width: 20, height: 20, borderRadius: 99, border: `1px solid ${PAL.chromeLine}`, background: "transparent", color: PAL.chromeInk, cursor: "pointer", fontSize: 11, fontWeight: 700, lineHeight: 1 }}>?</button>
          </div>
        </div>

        {/* phone-only floating button to summon the tool rail (B113) */}
        {narrow && !mobileTools && (
          <button onClick={() => setMobileTools(true)} title="Show the drawing tools"
            style={{ position: "absolute", right: 12, bottom: 16, zIndex: 1190, display: "flex", alignItems: "center", gap: 6, padding: "11px 16px", borderRadius: 99, border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 800, color: "#fff", background: PAL.ember, boxShadow: "0 6px 18px rgba(0,0,0,0.45)" }}>
            ✎ Tools
          </button>
        )}
        {/* right-side tool rail — dark chrome. On phones it overlays the canvas
            (slide-in from the right) instead of permanently eating 168px (B113). */}
        {narrow && mobileTools && <div onClick={() => setMobileTools(false)} style={{ position: "absolute", inset: 0, order: 2, zIndex: 1200, background: "rgba(20,18,15,0.35)" }} />}
        <div className="dark-scroll" style={{ width: narrow ? 200 : 168, flex: "none", order: 3, background: PAL.chrome, borderLeft: `1px solid ${PAL.chromeLine}`, display: "flex", flexDirection: "column", gap: 3, padding: "13px 11px",
          overflowY: "auto", minHeight: 0,
          position: narrow ? "absolute" : "relative", right: 0, top: 0, bottom: narrow ? 0 : undefined,
          zIndex: narrow ? 1205 : 30,
          transform: narrow && !mobileTools ? "translateX(100%)" : "none", transition: "transform 0.2s ease",
          boxShadow: narrow ? "-10px 0 28px rgba(0,0,0,0.45)" : "inset 1px 0 0 rgba(0,0,0,0.3)" }}>
          {railHdr("Tools")}
          <button className={`rbtn${tool === "select" ? " on" : ""}`} style={rbtn(tool === "select")} onClick={() => selectTool("select")}><ToolIcon id="select" /> Select <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 10 }}>V</span></button>
          <button className={`rbtn${tool === "pan" ? " on" : ""}`} style={rbtn(tool === "pan")} onClick={() => selectTool("pan")} title="Hand tool — or hold Space to pan temporarily"><ToolIcon id="pan" /> Pan <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 10 }}>H</span></button>

          {/* parcel tools grouped in one menu (opens to the left) */}
          <div ref={boundaryAnchor} style={{ position: "relative" }}>
            <button className={`rbtn${["parcel", "split"].includes(tool) ? " on" : ""}`} style={rbtn(["parcel", "split"].includes(tool))} onClick={() => setToolMenu((o) => !o)} title="Draw or split a parcel boundary"><ToolIcon id="parcel" /> Boundary <span style={{ marginLeft: "auto", opacity: 0.6 }}>▾</span></button>
            <AnchoredMenu open={toolMenu} onClose={() => setToolMenu(false)} anchorRef={boundaryAnchor} placement="left" width={248} panelStyle={menuPanel}>
              <button style={menuItem(tool === "parcel")} onClick={() => selectTool("parcel")}>Draw new parcel</button>
              <button style={menuItem(tool === "split")} onClick={() => selectTool("split")}>Split a parcel</button>
              <div style={{ fontSize: 11, color: PAL.muted, padding: "7px 8px 2px", lineHeight: 1.5, borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>
                <b style={{ color: PAL.ink }}>Merge:</b> in <b>Select</b>, <b>Shift-click</b> parcels to multi-select, then <b>Merge parcels</b> (right-click or the parcel panel).<br />
                <b style={{ color: PAL.ink }}>Reshape:</b> pick <b>Select</b>, click the parcel, then drag its dots — the <b>＋</b> on an edge adds a corner, <b>Shift-click</b> a dot removes it.
              </div>
            </AnchoredMenu>
          </div>

          {railHdr("Site elements")}

          {DRAW_TYPES.map((id) => {
            const t = TOOLS.find((x) => x.id === id);
            if (id === "building") {
              const dockLabel = { single: "single-load", cross: "cross-dock", none: "no docks" }[buildingDock];
              return (
                <div key={id} ref={buildingAnchor} style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button className={`rbtn${tool === "building" ? " on" : ""}`} style={{ ...rbtn(tool === "building"), flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 1 }} onClick={() => selectTool("building")}>
                      <span style={{ display: "flex", alignItems: "center", gap: 9, lineHeight: 1.15 }}><ToolIcon id="building" /> Building</span>
                      <span style={{ fontSize: 9, opacity: 0.6, paddingLeft: 24, lineHeight: 1.05 }}>{dockLabel}</span>
                    </button>
                    <button className={`rbtn${tool === "building" ? " on" : ""}`} style={{ ...rbtn(tool === "building"), width: 26, flex: "none", padding: 0, justifyContent: "center" }} onClick={() => setBuildingMenu((o) => !o)} aria-label="Dock layout">▾</button>
                  </div>
                  <AnchoredMenu open={buildingMenu} onClose={() => setBuildingMenu(false)} anchorRef={buildingAnchor} placement="left" width={200} panelStyle={menuPanel}>
                    <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "4px 8px 6px" }}>Dock layout</div>
                    {[["single", "Single-load (1 side)"], ["cross", "Cross-dock (2 sides)"], ["none", "No docks"]].map(([k, label]) => (
                      <button key={k} style={menuItem(buildingDock === k)} onClick={() => { setBuildingDock(k); selectTool("building"); setBuildingMenu(false); }}>{label}</button>
                    ))}
                  </AnchoredMenu>
                </div>
              );
            }
            if (id === "parking") {
              const sd = settings.stallDepth, ai = settings.aisle;
              return (
                <div key={id} ref={parkingAnchor} style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button className={`rbtn${tool === "parking" ? " on" : ""}`} style={{ ...rbtn(tool === "parking"), flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 1 }} onClick={() => selectTool("parking")}>
                      <span style={{ display: "flex", alignItems: "center", gap: 9, lineHeight: 1.15 }}><ToolIcon id="parking" /> Car Parking</span>
                      <span style={{ fontSize: 9, opacity: 0.6, paddingLeft: 24, lineHeight: 1.05 }}>{parkingRows === "free" ? "free draw" : parkingRows === "double" ? "double row" : "single row"}</span>
                    </button>
                    <button className={`rbtn${tool === "parking" ? " on" : ""}`} style={{ ...rbtn(tool === "parking"), width: 26, flex: "none", padding: 0, justifyContent: "center" }} onClick={() => setParkingMenu((o) => !o)} aria-label="Parking presets">▾</button>
                  </div>
                  <AnchoredMenu open={parkingMenu} onClose={() => setParkingMenu(false)} anchorRef={parkingAnchor} placement="left" width={248} panelStyle={menuPanel}>
                    <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "4px 8px 6px" }}>Parking rows</div>
                    {[["free", "Free draw (any size)"], ["single", `Single row (${sd}′ + ${ai}′ = ${sd + ai}′ deep)`], ["double", `Double row (${sd}′ + ${ai}′ + ${sd}′ = ${sd * 2 + ai}′ deep)`]].map(([k, label]) => (
                      <button key={k} style={menuItem(tool === "parking" && parkingRows === k)} onClick={() => { setParkingRows(k); selectTool("parking"); setParkingMenu(false); }}>{label}</button>
                    ))}
                  </AnchoredMenu>
                </div>
              );
            }
            if (id === "road") {
              return (
                <div key={id} ref={roadAnchor} style={{ position: "relative" }}>
                  <div style={{ display: "flex", gap: 2 }}>
                    <button className={`rbtn${tool === "road" ? " on" : ""}`} style={{ ...rbtn(tool === "road"), flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 1 }} onClick={() => selectTool("road")}>
                      <span style={{ display: "flex", alignItems: "center", gap: 9, lineHeight: 1.15 }}><ToolIcon id="road" /> Road</span>
                      <span style={{ fontSize: 9, opacity: 0.6, paddingLeft: 24, lineHeight: 1.05 }}>{roadWidth === "free" ? "free draw" : `${roadWidth}′ travel`}</span>
                    </button>
                    <button className={`rbtn${tool === "road" ? " on" : ""}`} style={{ ...rbtn(tool === "road"), width: 26, flex: "none", padding: 0, justifyContent: "center" }} onClick={() => setRoadMenu((o) => !o)} aria-label="Road presets">▾</button>
                  </div>
                  <AnchoredMenu open={roadMenu} onClose={() => setRoadMenu(false)} anchorRef={roadAnchor} placement="left" width={230} panelStyle={menuPanel}>
                    <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "4px 8px 6px" }}>Road width</div>
                    <button style={menuItem(tool === "road" && roadWidth === "free")} onClick={() => { setRoadWidth("free"); selectTool("road"); setRoadMenu(false); }}>Free draw (any size)</button>
                    {(settings.roadWidths ?? "24, 26, 30, 36, 40").split(",").map((s) => s.trim()).filter((s) => Number.isFinite(+s) && +s > 0).map((w) => (
                      <button key={w} style={menuItem(tool === "road" && roadWidth === w)} onClick={() => { setRoadWidth(w); selectTool("road"); setRoadMenu(false); }}>{w}′ travel — drag the length</button>
                    ))}
                  </AnchoredMenu>
                </div>
              );
            }
            // B93: give the preset-less site-element rows (paving/trailer/pond) the same
            // two-line anatomy as Building/Road/Car Parking, so the rail reads as one
            // uniform column (these just have no "▾" preset menu).
            const sub = { paving: "drive / court", trailer: "back-in storage", pond: "detention basin" }[id];
            return (
              <button key={id} className={`rbtn${tool === id ? " on" : ""}`} style={{ ...rbtn(tool === id), flexDirection: "column", alignItems: "flex-start", gap: 1 }} onClick={() => selectTool(id)}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, lineHeight: 1.15 }}><ToolIcon id={id} /> {t.label}</span>
                {sub && <span style={{ fontSize: 9, opacity: 0.6, paddingLeft: 24, lineHeight: 1.05 }}>{sub}</span>}
              </button>
            );
          })}

          {railHdr("Easement")}
          <div ref={easeAnchor} style={{ position: "relative" }}>
            <div style={{ display: "flex", gap: 2 }}>
              <button className={`rbtn${tool === "easement" ? " on" : ""}`} style={{ ...rbtn(tool === "easement"), flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 1 }} onClick={() => selectTool("easement")}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, lineHeight: 1.15 }}><ToolIcon id="easement" /> Easement</span>
                <span style={{ fontSize: 9, opacity: 0.6, paddingLeft: 24, lineHeight: 1.05 }}>{{ centerline: `centerline · ${easeWidth}′`, boundary: "boundary", parceledge: `parcel edge · ${easeWidth}′` }[easeMode]}</span>
              </button>
              <button className={`rbtn${tool === "easement" ? " on" : ""}`} style={{ ...rbtn(tool === "easement"), width: 26, flex: "none", padding: 0, justifyContent: "center" }} onClick={() => setEaseMenu((o) => !o)} aria-label="Easement options">▾</button>
            </div>
            <AnchoredMenu open={easeMenu} onClose={() => setEaseMenu(false)} anchorRef={easeAnchor} placement="left" width={248} panelStyle={menuPanel}>
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "4px 8px 6px" }}>Input mode</div>
              {[["centerline", "Centerline + width"], ["boundary", "Boundary polygon"], ["parceledge", "Offset from parcel edge"]].map(([k, label]) => (
                <button key={k} style={menuItem(easeMode === k)} onClick={() => { setEaseMode(k); selectTool("easement"); setEaseMenu(false); }}>{label}</button>
              ))}
              {easeMode !== "boundary" && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 8px 4px", borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>
                  <span style={{ fontSize: 12, color: PAL.muted }}>Width</span>
                  <NumInput style={{ ...numInput, width: 64 }} value={easeWidth} min={1} onCommit={(n) => setEaseWidth(n)} /> <span style={{ fontSize: 12, color: PAL.muted }}>ft</span>
                </div>
              )}
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "8px 8px 6px", borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>Type (default)</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, padding: "0 6px 4px" }}>
                {EASEMENT_TYPES.map((ty) => (
                  <button key={ty.key} title={ty.label} onClick={() => setEaseType(ty.key)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 7px", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontSize: 11, border: `1px solid ${easeType === ty.key ? ty.color : "#ddd6c5"}`, background: easeType === ty.key ? ty.color : "#fff", color: easeType === ty.key ? "#fff" : PAL.ink, fontWeight: easeType === ty.key ? 650 : 500 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: easeType === ty.key ? "#fff" : ty.color }} /> {ty.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: PAL.muted, padding: "6px 8px 2px", lineHeight: 1.5, borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>
                {easeMode === "parceledge" ? "Click a parcel's edges to select a contiguous run, then Enter." : easeMode === "boundary" ? "Click points; click the first dot (or double-click) to close." : "Click a centerline; double-click / Enter to finish."}
              </div>
            </AnchoredMenu>
          </div>

          {railHdr("Shapes")}
          {MARKUP_TOOLS.map((id) => {
            const t = TOOLS.find((x) => x.id === id);
            const sc = { mline: "L", mrect: "R", mellipse: "E", mpolygon: "⇧P", mpolyline: "⇧N" }[id];
            return <button key={id} className={`rbtn${tool === id ? " on" : ""}`} style={rbtn(tool === id)} onClick={() => selectTool(id)}><ToolIcon id={id} /> {t.label} <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 10 }}>{sc}</span></button>;
          })}

          {railHdr("Measure")}

          {/* measure with line / polyline / area modes */}
          <div ref={measureAnchor} style={{ position: "relative" }}>
            <div style={{ display: "flex", gap: 2 }}>
              <button className={`rbtn${tool === "measure" ? " on" : ""}`} style={{ ...rbtn(tool === "measure"), flex: 1, flexDirection: "column", alignItems: "flex-start", gap: 1 }} onClick={() => selectTool("measure")}>
                <span style={{ display: "flex", alignItems: "center", gap: 9, lineHeight: 1.15 }}><ToolIcon id="measure" /> Measure</span>
                <span style={{ fontSize: 9, opacity: 0.6, paddingLeft: 24, lineHeight: 1.05 }}>{measureModeLabel(measureMode)}</span>
              </button>
              <button className={`rbtn${tool === "measure" ? " on" : ""}`} style={{ ...rbtn(tool === "measure"), width: 26, flex: "none", padding: 0, justifyContent: "center" }} onClick={() => setMeasureMenu((o) => !o)} aria-label="Measure modes">▾</button>
            </div>
            <AnchoredMenu open={measureMenu} onClose={() => setMeasureMenu(false)} anchorRef={measureAnchor} placement="left" width={230} panelStyle={menuPanel}>
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, padding: "4px 8px 6px" }}>Measure</div>
              {MEASURE_MODES.map(([k, label]) => (
                <button key={k} style={menuItem(tool === "measure" && measureMode === k)} onClick={() => { setMeasureMode(k); selectTool("measure"); setMeasureMenu(false); }}>{label}</button>
              ))}
            </AnchoredMenu>
          </div>

          {railHdr("Annotate")}
          <button className={`rbtn${tool === "callout" ? " on" : ""}`} style={rbtn(tool === "callout")} onClick={() => selectTool("callout")}><ToolIcon id="callout" /> Callout <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 10 }}>Q</span></button>
          <button className={`rbtn${tool === "text" ? " on" : ""}`} style={rbtn(tool === "text")} onClick={() => selectTool("text")}><ToolIcon id="text" /> Text <span style={{ marginLeft: "auto", opacity: 0.6, fontSize: 10 }}>T</span></button>

          <div style={{ flex: 1 }} />
          {tool === "measure" && calibrationState === "uncalibrated" && (
            <div style={{ fontSize: 10.5, color: "#fbbf24", lineHeight: 1.45, padding: "8px 6px 0", fontWeight: 600 }}>⚠ Underlay isn't calibrated — distances may be wrong.</div>
          )}
          {curHint && (
            <div style={{ fontSize: 10.5, color: PAL.chromeMuted, lineHeight: 1.5, padding: "8px 6px 2px", borderTop: `1px solid ${PAL.chromeLine}` }}>
              <span style={{ color: PAL.ember, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9.5 }}>{TOOLS.find((t) => t.id === tool)?.label}</span>
              <div style={{ marginTop: 3 }}>{curHint.split("•")[0].trim()}</div>
            </div>
          )}
        </div>

        {/* left side — Bluebeam-style icon rail + one open menu */}
        <div style={{ display: "flex", flex: "none", order: 1, minHeight: 0 }}>
          {/* the rail */}
          <div style={{ width: 54, flex: "none", background: PAL.chrome, borderRight: `1px solid ${PAL.chromeLine}`, display: "flex", flexDirection: "column", paddingTop: 4 }}>
            {leftTabs.map((tb) => (
              <button key={tb.id} title={tb.label} className="dbtn" style={railBtn(leftPanel === tb.id)}
                onClick={() => setLeftPanel((p) => (p === tb.id ? null : tb.id))}>
                <span style={{ fontSize: 16, lineHeight: 1 }}>{tb.glyph}</span>{tb.label}
              </button>
            ))}
          </div>
          {/* the open menu (collapsed by default) — drag its right edge to resize */}
          {leftPanel && (<>
          <div style={{ width: narrow ? "min(320px, calc(100vw - 74px))" : leftWidth, flex: "none", background: "#efe9dd", overflowY: "auto", padding: "13px 13px 24px",
            ...(narrow ? { position: "absolute", left: 54, top: 0, bottom: 0, zIndex: 1100, boxShadow: "10px 0 28px rgba(0,0,0,0.35)" } : null) }}>
          {/* aerial underlay */}
          {leftPanel === "aerial" && (
          <Section title="Aerial underlay">
            {!underlay ? (
              <>
                <button style={{ ...btn(false), width: "100%" }} onClick={() => fileRef.current?.click()}>Load screenshot…</button>
                <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onUnderlayFile(e.target.files?.[0]); e.target.value = ""; }} />
                <div style={{ fontSize: 11, color: PAL.muted, marginTop: 7, lineHeight: 1.5 }}>Drop in an aerial/screenshot, calibrate it to a known distance, then trace your parcel and buildings on top at true scale.</div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 11, color: PAL.muted, marginBottom: 8, lineHeight: 1.5 }}>Hidden by default — click a parcel (or “Show” below) to reveal it. Locked &amp; click-through so you can draw right over it. Calibrate it to a known distance for true scale.</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <button style={{ ...btn(showAerial), flex: 1 }} onClick={() => setShowAerial((v) => !v)}>{showAerial ? "Hide aerial" : "Show aerial"}</button>
                  <button style={{ ...btn(tool === "calibrate") }} onClick={() => { setShowAerial(true); setTool("calibrate"); setCalib(null); }}>Calibrate</button>
                  <button style={chip} onClick={requestFit}>Fit</button>
                  <button style={{ ...chip, color: PAL.accent }} onClick={() => { setUnderlay(null); setCalib(null); setShowAerial(false); }}>Remove</button>
                </div>
                <div style={{ fontSize: 11, color: PAL.muted, marginTop: 7 }}>Scale: <b style={{ color: PAL.ink }}>{f2(1 / underlay.ftPerPx)}</b> px/ft · image ≈ {f0(underlay.imgW * underlay.ftPerPx)}′ wide</div>
                {underlayErr && <div style={{ fontSize: 11, color: PAL.accent, marginTop: 6, lineHeight: 1.45 }}>Aerial image didn't load from the source. Your boundary and tools still work — go back to the map and re-pick the site, or drop a screenshot here instead.</div>}
                {tool === "calibrate" && (
                  <div style={{ marginTop: 9, padding: "9px 10px", borderRadius: 7, background: "#fbf3ee", border: `1px solid ${PAL.accentSoft}` }}>
                    {!calib?.a && <div style={{ fontSize: 11.5, color: PAL.ink }}>Click the <b>first</b> end of a known distance on the image (e.g. a building wall, a road width).</div>}
                    {calib?.a && !calib?.b && <div style={{ fontSize: 11.5, color: PAL.ink }}>Now click the <b>second</b> end.</div>}
                    {calib?.a && calib?.b && (
                      <>
                        <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 6 }}>Picked segment reads <b style={{ color: PAL.ink }}>{f0(dist(calib.a, calib.b))}′</b> at the current scale.</div>
                        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                          <span style={{ fontSize: 11.5, color: PAL.muted }}>Actual ft</span>
                          <input autoFocus style={numInput} value={calibInput} onChange={(e) => setCalibInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") applyCalibration(); }} />
                          <button style={btn(false)} onClick={applyCalibration}>Apply</button>
                          <button style={chip} onClick={() => setCalib(null)}>Reset</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
          </Section>
          )}

          {/* site-plan overlay (B72) */}
          {leftPanel === "overlay" && (
          <Section title="Site-plan overlay">
            <button style={{ ...btn(false), width: "100%" }} disabled={overlayBusy} onClick={() => overlayFileRef.current?.click()}>{overlayBusy ? "Loading…" : "Add site plan (PDF / image)…"}</button>
            <input ref={overlayFileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }} onChange={(e) => { addOverlayFile(e.target.files?.[0]); e.target.value = ""; }} />
            <div style={{ fontSize: 11, color: PAL.muted, marginTop: 7, lineHeight: 1.5 }}>
              Drop a site-plan PDF onto the map (or browse). Drag it to move; set size, rotation &amp; opacity below, then Lock it to draw on top. White paper is knocked out so the map shows through. <i>(Sizing to the drawing scale comes next.)</i>
            </div>
            {!sheetOverlays.length ? null : (
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                {sheetOverlays.map((o) => {
                  const on = selOverlay === o.id, wFt = o.imgW * o.ftPerPx;
                  return (
                    <div key={o.id} style={{ border: `1px solid ${on ? PAL.accent : "#ddd6c5"}`, borderRadius: 9, padding: 9, background: "#fff" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <button style={{ ...chip, flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", borderColor: on ? PAL.accent : "#ddd6c5", color: on ? PAL.accent : PAL.ink }} title={o.name} onClick={() => setSelOverlay(on ? null : o.id)}>{o.name}</button>
                        <button style={chip} title={o.locked ? "Unlock" : "Lock"} onClick={() => patchOverlay(o.id, { locked: !o.locked })}>{o.locked ? "🔒" : "🔓"}</button>
                        <button style={{ ...chip, color: PAL.accent }} title="Remove" onClick={() => removeOverlay(o.id)}>✕</button>
                      </div>
                      {on && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 8 }}>
                          <label style={ovRow}><span style={{ width: 48 }}>Opacity</span>
                            <input type="range" min={0.1} max={1} step={0.05} value={o.opacity} style={{ flex: 1 }} onChange={(e) => patchOverlay(o.id, { opacity: +e.target.value }, false)} />
                          </label>
                          <label style={ovRow}><span style={{ width: 48 }}>Rotate</span>
                            <input type="range" min={0} max={360} step={1} value={o.rotation} style={{ flex: 1 }} onChange={(e) => patchOverlay(o.id, { rotation: +e.target.value }, false)} />
                            <span style={{ width: 32, textAlign: "right", fontFamily: "ui-monospace, monospace" }}>{Math.round(o.rotation)}°</span>
                          </label>
                          <label style={ovRow}><span style={{ width: 48 }}>Width</span>
                            <input style={numInput} value={Math.round(wFt)} onChange={(e) => { const v = +e.target.value; if (v > 0) patchOverlay(o.id, { ftPerPx: v / Math.max(1, o.imgW) }, false); }} />
                            <span>ft</span>
                            <button style={chip} title="Bigger" onClick={() => patchOverlay(o.id, { ftPerPx: o.ftPerPx * 1.1 })}>＋</button>
                            <button style={chip} title="Smaller" onClick={() => patchOverlay(o.id, { ftPerPx: o.ftPerPx / 1.1 })}>－</button>
                          </label>
                          {o.pageCount > 1 && (
                            <div style={ovRow}><span style={{ width: 48 }}>Page</span>
                              <button style={chip} disabled={!overlayDocs.current.has(o.id) || o.page <= 1} onClick={() => setOverlayPage(o.id, o.page - 1)}>‹</button>
                              <span style={{ color: PAL.ink }}>{o.page} / {o.pageCount}</span>
                              <button style={chip} disabled={!overlayDocs.current.has(o.id) || o.page >= o.pageCount} onClick={() => setOverlayPage(o.id, o.page + 1)}>›</button>
                              {!overlayDocs.current.has(o.id) && <span style={{ fontSize: 10 }}>re-add to change page</span>}
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button style={{ ...chip, flex: 1 }} title="Click two ends of a known dimension on the drawing, then enter its real length" onClick={() => { setSelOverlay(o.id); setOvCalib({ id: o.id, kind: "trace", pts: [] }); }}>Trace a length</button>
                            <button style={{ ...chip, flex: 1 }} title="Click a point on the drawing then its spot on the map; repeat for 2+ pairs, then Apply (moves, rotates & scales; 3+ pairs = robust best-fit + residual)" onClick={() => { setSelOverlay(o.id); setOvCalib({ id: o.id, kind: "align", pts: [] }); }}>Align to map</button>
                          </div>
                          {o.sheet && (
                            <div style={{ borderTop: `1px dashed #e3dccb`, paddingTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                              <div style={{ fontSize: 11, color: PAL.muted }}>Scale to the drawing — sizes the sheet to true real-world feet.</div>
                              <div style={{ fontSize: 11, color: PAL.muted }}>Sheet: <b style={{ color: PAL.ink }}>{o.sheet.label}</b>{!o.sheet.std && <span style={{ color: PAL.accent }}> · non-standard (may be shrunk) — scale below assumes true plot size</span>}</div>
                              <label style={ovRow}><span style={{ width: 48 }}>Scale</span><span>1″=</span>
                                <select style={{ ...numInput, width: 78, fontFamily: "inherit" }} value={overlayScaleSel(o)} onChange={(e) => { if (e.target.value !== "custom") applyOverlayScale(o.id, e.target.value); }}>
                                  {COMMON_SCALES.map((s) => <option key={s} value={s}>{s}′</option>)}
                                  <option value="custom">custom…</option>
                                </select>
                                {overlayScaleSel(o) === "custom" && <input style={{ ...numInput, width: 52 }} placeholder="ft" title="Feet per inch — press Enter" onKeyDown={(e) => { if (e.key === "Enter") applyOverlayScale(o.id, e.currentTarget.value); }} />}
                              </label>
                              {o.detectedScale && (
                                <div style={{ fontSize: 11, color: PAL.muted }}>Read from sheet: <b style={{ color: PAL.ink }}>1″={o.detectedScale}′</b>{Math.round(scaleForFtPerPoint(o.ftPerPx)) !== o.detectedScale && <button style={{ ...chip, marginLeft: 6, padding: "3px 8px" }} onClick={() => applyOverlayScale(o.id, o.detectedScale)}>Apply</button>}</div>
                              )}
                              <div style={{ fontSize: 10.5, color: PAL.muted }}>Now ≈ <b style={{ color: PAL.ink }}>1″={Math.round(scaleForFtPerPoint(o.ftPerPx))}′</b> · {Math.round(o.imgW * o.ftPerPx)}′ wide</div>
                            </div>
                          )}
                          <div style={{ display: "flex", gap: 6 }}>
                            <button style={{ ...chip, flex: 1 }} onClick={() => patchOverlay(o.id, { rotation: 0 })}>Reset rotation</button>
                            <button style={{ ...chip, flex: 1 }} onClick={requestFit}>Fit view</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Section>
          )}

          {/* Element menu — selection details + properties (or an empty hint) */}
          {leftPanel === "props" && !selEl && !selCallout && !selMarkup && (
            <Section title="Element">
              <div style={{ fontSize: 12, color: PAL.muted, lineHeight: 1.6 }}>Select an element, markup, or callout on the canvas to edit its properties here.</div>
            </Section>
          )}
          {/* selected easement — first-class attributes (NEW-1) */}
          {leftPanel === "props" && selMarkup && selMarkup.kind === "easement" && (() => {
            const e = selMarkup;
            const t = easementType(e.easeType);
            const area = easementArea(e);
            const isStrip = e.mode !== "boundary";
            const seg = (on) => ({ ...chip, flex: 1, padding: "6px 0", textAlign: "center", background: on ? PAL.accent : "#fff", color: on ? "#fff" : PAL.ink, borderColor: on ? PAL.accent : "#ddd6c5" });
            const txt = { ...numInput, width: 150, fontFamily: "inherit" };
            const check = (label, val, key) => (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: PAL.ink, marginBottom: 7, cursor: "pointer" }}>
                <input type="checkbox" checked={!!val} onChange={(ev) => setSelEasement({ [key]: ev.target.checked })} /> {label}
              </label>
            );
            return (
              <Section title={`Easement · ${{ centerline: "Centerline strip", boundary: "Boundary", parceledge: "Parcel-edge strip" }[e.mode] || "Easement"}`} accent={t.color}>
                {/* Type — shared portal popover so it never hides behind the rail / zoom rail */}
                <Field label="Type">
                  <button ref={easeTypeAnchor} style={{ ...chip, display: "flex", alignItems: "center", gap: 6 }} onClick={() => setEaseTypeMenu((o) => !o)}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color }} /> {t.label} <span style={{ opacity: 0.6 }}>▾</span>
                  </button>
                  <AnchoredMenu open={easeTypeMenu} onClose={() => setEaseTypeMenu(false)} anchorRef={easeTypeAnchor} placement="below-right" width={224} panelStyle={menuPanel}>
                    {EASEMENT_TYPES.map((ty) => (
                      <button key={ty.key} style={{ ...menuItem(e.easeType === ty.key), display: "flex", alignItems: "center", gap: 8 }} onClick={() => { setSelEasement({ easeType: ty.key }); setEaseType(ty.key); setEaseTypeMenu(false); }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: ty.color }} /> {ty.label}
                      </button>
                    ))}
                  </AnchoredMenu>
                </Field>
                <Field label="Holder / beneficiary"><input value={e.holder || ""} onChange={(ev) => setSelEasement({ holder: ev.target.value })} placeholder="e.g. CenterPoint" style={txt} /></Field>
                {isStrip && <Field label="Width (ft)"><NumInput style={numInput} value={Math.round(e.width || 0)} min={1} onCommit={(n) => setSelEasement({ width: n })} /></Field>}
                <Field label="Recording ref"><input value={e.recording || ""} onChange={(ev) => setSelEasement({ recording: ev.target.value })} placeholder="Vol/Pg or Clerk's #" style={txt} /></Field>
                <Field label="Status">
                  <span style={{ display: "flex", gap: 5, width: 150 }}>
                    <button style={seg(e.status !== "proposed")} onClick={() => setSelEasement({ status: "existing" })}>Existing</button>
                    <button style={seg(e.status === "proposed")} onClick={() => setSelEasement({ status: "proposed" })}>Proposed</button>
                  </span>
                </Field>
                <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "8px 0", paddingTop: 8 }}>
                  {check("Exclusive use", e.exclusive, "exclusive")}
                  {check("Restricts buildings", e.restrictsBuildings !== false, "restrictsBuildings")}
                  {check("Restricts paving", e.restrictsPaving === true, "restrictsPaving")}
                </div>
                <Field label="Label"><input value={e.labelOverride || ""} onChange={(ev) => setSelEasement({ labelOverride: ev.target.value })} placeholder={easementLabel({ ...e, labelOverride: "" })} style={txt} /></Field>
                <Field label="Notes"><textarea value={e.notes || ""} onChange={(ev) => setSelEasement({ notes: ev.target.value })} rows={2} style={{ width: 150, boxSizing: "border-box", padding: "5px 7px", fontSize: 12, fontFamily: "inherit", border: `1px solid #ddd6c5`, borderRadius: 8, color: PAL.ink, resize: "vertical" }} /></Field>
                <div style={{ fontSize: 11.5, color: PAL.muted, marginTop: 6 }}>Area: <b style={{ color: PAL.ink }}>{Math.round(area).toLocaleString()} sf</b> · {(area / SQFT_PER_ACRE).toFixed(2)} ac</div>
                <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5, marginTop: 6 }}>{isStrip ? "Drag a centerline dot to reshape (the strip re-offsets); ＋ adds a point, Shift-click removes one." : "Drag a boundary dot to reshape; ＋ adds a point, Shift-click removes one."}</div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button style={chip} onClick={() => toggleMarkupLock(e.id)}>{e.locked ? "🔒 Unlock" : "🔓 Lock"}</button>
                  <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>Delete</button>
                </div>
              </Section>
            );
          })()}
          {/* selected markup shape — geometry + style */}
          {leftPanel === "props" && selMarkup && selMarkup.kind !== "easement" && (() => {
            const swatch = { width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" };
            const closed = selMarkup.kind === "rect" || selMarkup.kind === "ellipse" || selMarkup.kind === "polygon";
            return (
              <Section title={`Markup · ${selMarkup.kind[0].toUpperCase()}${selMarkup.kind.slice(1)}`}>
                <Field label="Line color"><input type="color" value={toHex6(selMarkup.stroke)} onChange={(e) => setSelMarkup({ stroke: e.target.value })} style={swatch} /></Field>
                <Field label="Line weight"><NumInput style={numInput} value={selMarkup.weight ?? 2} min={0.5} onCommit={(n) => setSelMarkup({ weight: n })} /></Field>
                <Field label="Dash">
                  <select style={{ ...numInput, width: 100, fontFamily: "inherit" }} value={selMarkup.dash || "solid"} onChange={(e) => setSelMarkup({ dash: e.target.value })}>
                    <option value="solid">Solid</option><option value="dashed">Dashed</option><option value="dotted">Dotted</option>
                  </select>
                </Field>
                {closed && <>
                  <Field label="Fill color"><input type="color" value={toHex6(selMarkup.fill)} onChange={(e) => setSelMarkup({ fill: e.target.value })} style={swatch} /></Field>
                  <Field label="Fill opacity"><input type="range" min={0} max={1} step={0.05} value={selMarkup.fillOpacity ?? 0} onChange={(e) => setSelMarkup({ fillOpacity: +e.target.value })} /></Field>
                </>}
                {MK_BOX_KINDS.includes(selMarkup.kind) && <>
                  <Field label="Width / Height"><span style={{ display: "flex", gap: 5 }}>
                    <NumInput style={{ ...numInput, width: 56 }} value={Math.round(selMarkup.w)} min={1} onCommit={(n) => setSelMarkupGeom({ w: n })} />
                    <NumInput style={{ ...numInput, width: 56 }} value={Math.round(selMarkup.h)} min={1} onCommit={(n) => setSelMarkupGeom({ h: n })} />
                  </span></Field>
                  <Field label="Rotation°"><NumInput style={numInput} value={Math.round(selMarkup.rot || 0)} onCommit={(n) => setSelMarkupGeom({ rot: ((n % 360) + 360) % 360 })} /></Field>
                </>}
                <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5, marginTop: 8 }}>
                  {MK_BOX_KINDS.includes(selMarkup.kind)
                    ? "Drag the corner/edge grips to resize, the top handle to rotate."
                    : selMarkup.kind === "line"
                      ? "Drag either end dot to move it."
                      : "Drag a dot to reshape; ＋ adds a point; Shift-click a dot removes it."}
                </div>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button style={chip} onClick={() => toggleMarkupLock(selMarkup.id)}>{selMarkup.locked ? "🔒 Unlock" : "🔓 Lock"}</button>
                  <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>Delete</button>
                </div>
              </Section>
            );
          })()}
          {/* selected callout — text styling */}
          {leftPanel === "props" && selCallout && (() => {
            const cs = calloutStyle(selCallout);
            const swatch = { width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" };
            const seg = (on) => ({ ...chip, flex: 1, padding: "6px 0", textAlign: "center", background: on ? PAL.accent : "#fff", color: on ? "#fff" : PAL.ink, borderColor: on ? PAL.accent : "#ddd6c5" });
            return (
              <Section title={selCallout.noLeader ? "Text box" : "Callout"}>
                <button style={{ ...chip, width: "100%", marginBottom: 9 }} onClick={() => beginEditCallout(selCallout.id)}>✎ Edit text</button>
                {/* row 1: size · text color · fill */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
                  <NumInput style={{ ...numInput, width: 52 }} value={cs.size} min={6} max={96} onCommit={(n) => setSelCallout({ size: n })} />
                  <input type="color" title="Text" value={toHex6(cs.color)} onChange={(e) => setSelCallout({ color: e.target.value })} style={swatch} />
                  <input type="color" title="Fill" value={toHex6(cs.fill)} onChange={(e) => setSelCallout({ fill: e.target.value })} style={swatch} />
                  <input type="color" title="Line" value={toHex6(cs.stroke)} onChange={(e) => setSelCallout({ stroke: e.target.value })} style={swatch} />
                </div>
                {/* row 2: B / I / U · align L C R */}
                <div style={{ display: "flex", gap: 5, marginBottom: 7 }}>
                  <button style={{ ...seg(cs.bold), fontWeight: 800 }} title="Bold" onClick={() => setSelCallout({ bold: !cs.bold })}>B</button>
                  <button style={{ ...seg(cs.italic), fontStyle: "italic" }} title="Italic" onClick={() => setSelCallout({ italic: !cs.italic })}>I</button>
                  <button style={{ ...seg(cs.underline), textDecoration: "underline" }} title="Underline" onClick={() => setSelCallout({ underline: !cs.underline })}>U</button>
                  <span style={{ width: 6 }} />
                  {["left", "center", "right"].map((a) => (
                    <button key={a} style={seg(cs.align === a)} title={a} onClick={() => setSelCallout({ align: a })}>{a === "left" ? "⤙" : a === "right" ? "⤚" : "≡"}</button>
                  ))}
                </div>
                {/* row 3: padding · line spacing */}
                <Field label="Padding X / Y"><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={cs.padX} min={0} onCommit={(n) => setSelCallout({ padX: n })} /> <NumInput style={{ ...numInput, width: 42 }} value={cs.padY} min={0} onCommit={(n) => setSelCallout({ padY: n })} /></span></Field>
                <Field label="Line spacing"><NumInput style={numInput} value={cs.lineHeight} min={0.8} onCommit={(n) => setSelCallout({ lineHeight: n })} /></Field>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>{selCallout.noLeader ? "Delete text box" : "Delete callout"}</button>
                </div>
              </Section>
            );
          })()}
          {/* selected element */}
          {leftPanel === "props" && selEl && (
            <Section title={`Selected · ${TYPE[selEl.type].label}`}>
              {!selEl.points ? (
                <>
                  {selEl.type === "road" ? (
                    <>
                      <Field label="Length (ft)"><NumInput style={numInput} value={Math.round(Math.max(selEl.w, selEl.h))} min={1} onCommit={(n) => setRoadLength(selEl, n)} /></Field>
                      <Field label="Travel width (ft)"><NumInput style={numInput} value={Math.round(roadTravel(selEl))} min={1} onCommit={(n) => setRoadTravel(selEl, n)} /></Field>
                    </>
                  ) : (selEl.type === "sidewalk" || selEl.type === "landscape") && selEl.attachedTo ? (
                    <>
                      <Field label="Width (ft)"><NumInput style={numInput} value={Math.round(swThick(selEl))} min={1} onCommit={(n) => setSidewalkWidth(selEl, n)} /></Field>
                      <Field label="Length (ft)"><NumInput style={numInput} value={Math.round(swRun(selEl))} min={1} onCommit={(n) => setSidewalkLength(selEl, n)} /></Field>
                    </>
                  ) : (
                    <>
                      <Field label="Width (ft)"><NumInput style={numInput} value={Math.round(selEl.w)} min={1} max={MAX_DIM} onCommit={(n) => resizeSelEl({ w: n })} /></Field>
                      <Field label={selEl.type === "pond" ? "Length (ft)" : "Depth (ft)"}><NumInput style={numInput} value={Math.round(selEl.h)} min={1} max={MAX_DIM} onCommit={(n) => resizeSelEl({ h: n })} /></Field>
                    </>
                  )}
                  <Field label="Rotation (°)">
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <NumInput style={{ ...numInput, width: 46 }} value={Math.round(selEl.rot)} onCommit={(n) => rotateSelTo(((n % 360) + 360) % 360)} />
                      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <button style={spinBtn} onClick={() => bumpRot(1)} title="Rotate +1°">▲</button>
                        <button style={spinBtn} onClick={() => bumpRot(-1)} title="Rotate −1°">▼</button>
                      </span>
                    </span>
                  </Field>
                  {selEl.type === "building" && (
                    <Field label="Docks">
                      <select style={{ ...numInput, width: 120, fontFamily: "inherit" }} value={selEl.dock || "cross"} onChange={(e) => { pushHistory(); setSelEl({ dock: e.target.value }); }}>
                        <option value="single">Single-load</option>
                        <option value="cross">Cross-dock</option>
                        <option value="none">No docks</option>
                      </select>
                    </Field>
                  )}
                  {selEl.type === "building" && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "2px 0 6px" }}>Dock features</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <button style={{ ...chip, textAlign: "left" }} onClick={() => addTruckCourt(selEl)}>＋ {TRUCK_COURT_D}′ truck court</button>
                        <button style={{ ...chip, textAlign: "left" }} onClick={() => addDogEars(selEl)}>＋ Bump-outs ({DOGEAR_W}′×{DOGEAR_D}′)</button>
                      </div>
                    </div>
                  )}
                  {selEl.truckCourt && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "2px 0 6px" }}>Truck court</div>
                      <button style={{ ...chip, textAlign: "left", color: "#0e7490", width: "100%" }} onClick={() => addCourtTrailer(selEl)}>＋ {OPP_TRAILER_D}′ trailer parking (far side)</button>
                    </div>
                  )}
                  {selEl.type === "parking" && (() => {
                    const pc = cfgOf(selEl);
                    return (
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "2px 0 6px" }}>Parking layout</div>
                        <Field label="Stall depth (ft)"><NumInput style={numInput} value={pc.stallDepth} min={8} onCommit={(n) => setParkCfg(selEl, { stallDepth: n })} /></Field>
                        <Field label="Drive aisle (ft)"><NumInput style={numInput} value={pc.aisle} min={0} onCommit={(n) => setParkCfg(selEl, { aisle: n })} /></Field>
                        <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                          <button style={{ ...chip, flex: 1 }} onClick={() => growParking(selEl, 1)}>＋ Row</button>
                          <button style={{ ...chip, flex: 1 }} onClick={() => growParking(selEl, -1)}>－ Row</button>
                        </div>
                        {parkRowsForDepth(selEl.h, cfgOf(selEl).stallDepth || settings.stallDepth, cfgOf(selEl).aisle ?? settings.aisle) >= 3 &&
                          <button style={{ ...chip, width: "100%", marginTop: 6 }} onClick={() => splitParkingRows(selEl)}>Split rows/aisles</button>}
                        <label style={{ display: "flex", gap: 8, fontSize: 11.5, color: PAL.muted, marginTop: 7, cursor: "pointer" }}>
                          <input type="checkbox" checked={!(selEl.cfg && selEl.cfg.flipDepth)} onChange={(e) => { pushHistory(); setEls((a) => a.map((x) => x.id === selEl.id ? { ...x, cfg: { ...(x.cfg || {}), flipDepth: !e.target.checked } } : x)); }} /> Drive aisle on the far side
                        </label>
                      </div>
                    );
                  })()}
                  {selEl.type === "trailer" && !selEl.points && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", margin: "2px 0 6px" }}>Terminal curb</div>
                      <div style={{ display: "flex", gap: 6 }}>
                        <button style={{ ...chip, flex: 1, ...(curbWidthOf(selEl) === CURB_6 ? { borderColor: PAL.accent, color: PAL.accent, fontWeight: 600 } : {}) }} onClick={() => setCurbW(selEl, CURB_6)}>6″ mono</button>
                        <button style={{ ...chip, flex: 1, ...(curbWidthOf(selEl) === CURB_12 ? { borderColor: PAL.accent, color: PAL.accent, fontWeight: 600 } : {}) }} onClick={() => setCurbW(selEl, CURB_12)}>12″ heavy</button>
                      </div>
                      <div style={{ fontSize: 10.5, color: PAL.muted, marginTop: 5, lineHeight: 1.45 }}>12″ takes trailer-tire/dolly abuse (1.0′ plan width). Drawn + counted in the SF math; the dimension still reads to the face of curb.</div>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 4, lineHeight: 1.5 }}>Polygon · {selEl.points.length} points. Drag the body to move. Drag a <b>dot</b> to move a corner, click a <b>＋</b> on an edge to add one, <b>Shift-click</b> a dot to delete. Double-click to change type.</div>
              )}
              {(() => {
                const poly = !!selEl.points;
                const area = poly ? polyArea(selEl.points) : selEl.w * selEl.h;
                return (
                  <div style={{ fontSize: 12, color: PAL.muted, marginTop: 6, lineHeight: 1.6 }}>
                    {poly ? "Area" : "Footprint"}: <b style={{ color: PAL.ink }}>{f0(area)} sf</b>{poly ? ` · ${f2(area / SQFT_PER_ACRE)} ac` : ""}<br />
                    {selEl.type === "building" && !poly && !selEl.dogEar && (() => {
                      const bumps = els.filter((x) => x.attachedTo === selEl.id && x.dogEar);
                      if (!bumps.length) return null;
                      const ba = bumps.reduce((s, b) => s + b.w * b.h, 0);
                      return <span style={{ color: "#7c3aed" }}>+ {bumps.length} bump-out{bumps.length > 1 ? "s" : ""} ({f0(ba)} sf) → <b style={{ color: PAL.ink }}>{f0(area + ba)} sf</b> total<br /></span>;
                    })()}
                    {selEl.type === "parking" && <>Stalls: <b style={{ color: PAL.ink }}>{f0(poly ? estStalls(area, settings) : carStalls(selEl.w, selEl.h, cfgOf(selEl)).count)}</b>{poly ? " (est.)" : <> @ {settings.stallW}′×{settings.stallDepth}′ {settings.parkAngle}°, {settings.aisle}′ aisle</>}</>}
                    {selEl.type === "trailer" && (() => { const tc = cfgOf(selEl); return <>Trailer stalls: <b style={{ color: PAL.ink }}>{f0(poly ? estTrailers(area, settings) : trailerStalls(selEl.w, selEl.h, tc).count)}</b>{poly ? " (est.)" : <> @ {tc.trailerW}′×{tc.trailerL}′{tc.single ? "" : `, ${tc.trailerAisle}′ drive lane`}</>}</>; })()}
                    {selEl.type === "building" && !poly && (() => {
                      const dock = selEl.dock || "single";
                      const per = Math.floor(Math.max(selEl.w, selEl.h) / 12);
                      const total = dock === "cross" ? per * 2 : dock === "none" ? 0 : per;
                      return <>Dock doors: <b style={{ color: PAL.ink }}>{f0(total)}</b> @ 12′ o.c.{dock === "cross" ? " · both long sides" : dock === "single" ? " · one long side" : ""}</>;
                    })()}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                <button style={chip} onClick={() => toggleLock(selEl.id)} title="Pin in place — prevents accidental moves/edits">{selEl.locked ? "📌 Unpin" : "📌 Pin"}</button>
                <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>Delete element</button>
              </div>
              {selEl.type === "pond" && (() => {
                const det = selEl.det || {};
                const depth = det.depth ?? 8, fb = det.freeboard ?? 1, slope = det.slope ?? 3;
                const ring = selEl.points ? selEl.points : elCorners(selEl);
                const r = detentionStorage(ring, depth, fb, slope);
                const setDet = (patch) => { pushHistory(); setSelEl({ det: { depth, freeboard: fb, slope, ...det, ...patch } }); };
                // --- Expand this pond (B139): baseline + steppers; both steppers and free
                // drag feed the one Existing→Proposed readout. Baseline freezes the original
                // footprint + depth/slope so the delta is apples-to-apples. ---
                const base = det.baseline, inMode = !!base;
                const snapshotGeom = () => selEl.points ? { points: selEl.points.map((p) => ({ x: p.x, y: p.y })) } : { w: selEl.w, h: selEl.h, cx: selEl.cx, cy: selEl.cy, rot: selEl.rot };
                const startExpand = () => {
                  pushHistory();
                  setSelEl({ det: { ...det, depth, freeboard: fb, slope, expandFt: 0, baseline: { ring: ring.map((p) => ({ x: p.x, y: p.y })), geom: snapshotGeom(), depth, freeboard: fb, slope } } });
                  flashWarn("Expanding this pond — push the banks out or dig deeper, and watch the storage gained.", 4500);
                };
                const pushBanksOut = (n) => {
                  const N = Math.max(0, Math.round(n));
                  if (base.geom.points) {
                    const grown = N > 0 ? expandPolygon(base.geom.points, N) : base.geom.points.map((p) => ({ x: p.x, y: p.y }));
                    if (!grown || polySelfIntersects(grown)) { flashWarn("Can't push the banks out cleanly on this shape — the corners would cross. Drag the pond's edges on the map instead.", 6000); return; }
                    pushHistory();
                    setSelEl({ points: grown, det: { ...det, expandFt: N } });
                  } else {
                    pushHistory();
                    setSelEl({ w: base.geom.w + 2 * N, h: base.geom.h + 2 * N, cx: base.geom.cx, cy: base.geom.cy, rot: base.geom.rot, det: { ...det, expandFt: N } });
                  }
                };
                const digDeeper = (m) => setDet({ depth: base.depth + Math.max(0, Math.round(m)) });
                const resetExisting = () => {
                  pushHistory();
                  const g = base.geom.points ? { points: base.geom.points.map((p) => ({ x: p.x, y: p.y })) } : { w: base.geom.w, h: base.geom.h, cx: base.geom.cx, cy: base.geom.cy, rot: base.geom.rot };
                  setSelEl({ ...g, det: { ...det, depth: base.depth, freeboard: base.freeboard, slope: base.slope, expandFt: 0 } });
                };
                const doneExpand = () => { pushHistory(); const { baseline, expandFt, ...rest } = det; setSelEl({ det: rest }); flashWarn("Expansion kept — the pond now uses its new size everywhere.", 3500); };
                const stepRow = (label, val, step, apply) => (
                  <Field label={label}>
                    <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                      <button style={{ ...spinBtn, width: 22, height: 22, fontSize: 13 }} onClick={() => apply(val - step)} title={`−${step} ft`}>−</button>
                      <NumInput style={{ ...numInput, width: 52, textAlign: "center" }} value={val} min={0} onCommit={(v) => apply(v)} />
                      <button style={{ ...spinBtn, width: 22, height: 22, fontSize: 13 }} onClick={() => apply(val + step)} title={`+${step} ft`}>＋</button>
                    </span>
                  </Field>
                );
                const pondRow = (label, val) => (
                  <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
                    <span style={{ fontSize: 11.5, color: PAL.muted }}>{label}</span>
                    <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12.5, color: PAL.ink, fontWeight: 650 }}>{val}</span>
                  </div>
                );
                return (
                  <div style={{ marginTop: 12, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
                    <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, marginBottom: 7 }}>Detention storage</div>
                    <Field label="Total depth (ft)"><NumInput style={numInput} value={depth} min={1} onCommit={(n) => setDet({ depth: n })} /></Field>
                    <Field label="Freeboard (ft)"><NumInput style={numInput} value={fb} min={0} onCommit={(n) => setDet({ freeboard: n })} /></Field>
                    <Field label="Side slope (n:1 H:V)"><NumInput style={numInput} value={slope} min={1} onCommit={(n) => setDet({ slope: n })} /></Field>
                    {det.availDepth != null && (
                      <div style={{ fontSize: 10.5, color: "#0e7490", marginTop: 2, lineHeight: 1.4 }}>LiDAR available depth ≈ {f1(det.availDepth)}′ (screening only).</div>
                    )}
                    <div style={{ marginTop: 7, background: "#f8f6f0", borderRadius: 8, padding: "8px 10px" }}>
                      {pondRow("Top-of-bank area", `${f0(r.aTop)} sf`)}
                      {pondRow("Water-surface area", `${f0(r.aWater)} sf`)}
                      {pondRow("Bottom area", `${f0(r.aBottom)} sf`)}
                      {pondRow("Water depth", `${f1(r.dw)} ft`)}
                      <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "5px 0 4px" }} />
                      {pondRow("Stored volume", `${f0(r.vol)} cf`)}
                      {pondRow("", `${f2(r.vol / 43560)} ac-ft`)}
                    </div>
                    <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 6 }}>Top-of-bank footprint; basin tapers {slope}:1 — prismoidal volume, screening only.</div>
                    {r.aBottom === 0 && (
                      <div style={{ fontSize: 10.5, color: "#b45309", lineHeight: 1.4, marginTop: 4 }}>⚠ Side slopes meet before full depth — reduce the depth or the side slope.</div>
                    )}
                    {/* B139 — Expand this pond: enter mode (auto-baseline + ghost), then steppers
                        (push banks out / dig deeper) or free drag feed one Existing→Proposed delta. */}
                    {!inMode ? (
                      <div style={{ marginTop: 11 }}>
                        <button style={{ width: "100%", padding: "9px 10px", border: "none", borderRadius: 8, background: PAL.accent, color: "#fff", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }} onClick={startExpand}>Expand this pond</button>
                        <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 5 }}>See how much more detention you'd gain by enlarging this pond — it snapshots today's size, then you push the banks out or dig deeper.</div>
                      </div>
                    ) : (() => {
                      const baseVol = detentionStorage(base.ring, base.depth, base.freeboard, base.slope).vol;
                      const inc = r.vol - baseVol, sign = inc >= 0 ? "+" : "−", mag = Math.abs(inc);
                      const digVal = Math.max(0, Math.round(depth - base.depth));
                      const expandVal = Math.max(0, Math.round(det.expandFt || 0));
                      const warns = [];
                      const overlaps = els.filter((e) => e.id !== selEl.id && ["building", "parking", "trailer"].includes(e.type) && ringsOverlap(ring, ringOf(e)));
                      if (overlaps.length) warns.push(overlaps.length === 1 ? `Overlaps a ${TYPE[overlaps[0].type].label.toLowerCase()} — the expanded pond runs into your layout.` : `Overlaps ${overlaps.length} other elements — the expanded pond runs into your layout.`);
                      if (parcels.length && ring.some((p) => !parcels.some((pc) => pc.points && pc.points.length >= 3 && pointInRing(p, pc.points)))) warns.push("Extends past the property line.");
                      return (
                        <div style={{ marginTop: 11, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 9 }}>
                          <div style={{ fontSize: 10.5, color: PAL.accent, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 800, marginBottom: 7 }}>Expanding · existing locked</div>
                          {stepRow("Push banks out (ft)", expandVal, 5, pushBanksOut)}
                          {stepRow("Dig deeper (ft)", digVal, 1, digDeeper)}
                          <div style={{ fontSize: 10, color: PAL.muted, marginTop: 3 }}>Or drag the pond's edges on the map.</div>
                          <div style={{ marginTop: 8, background: "#f8f6f0", borderRadius: 8, padding: "8px 10px" }}>
                            {pondRow("Existing storage", `${f2(baseVol / 43560)} ac-ft`)}
                            {pondRow("Proposed storage", `${f2(r.vol / 43560)} ac-ft`)}
                            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "5px 0 4px" }} />
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", padding: "3px 0" }}>
                              <span style={{ fontSize: 12, color: PAL.ink, fontWeight: 700 }}>{inc >= 0 ? "Storage gained" : "Storage lost"}</span>
                              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 14, color: inc >= 0 ? "#15803d" : "#b3361b", fontWeight: 800 }}>{sign}{f2(mag / 43560)} ac-ft</span>
                            </div>
                            {pondRow("", `${sign}${f0(mag)} cf`)}
                          </div>
                          <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 6 }}>Screening estimate — confirm with your engineer.</div>
                          {warns.map((w, i) => (
                            <div key={i} style={{ fontSize: 10.5, color: "#b45309", lineHeight: 1.4, marginTop: 5 }}>⚠ {w}</div>
                          ))}
                          <div style={{ display: "flex", gap: 6, marginTop: 9 }}>
                            <button style={{ ...chip, flex: 1 }} onClick={resetExisting}>Reset to existing</button>
                            <button style={{ ...chip, flex: 1, borderColor: PAL.accent, color: PAL.accent, fontWeight: 700 }} onClick={doneExpand}>Done</button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </Section>
          )}

          {/* Bluebeam-style Properties — colors for the selected element + set defaults */}
          {leftPanel === "props" && selEl && curStyle && (
            <Section title="Properties">
              <Field label="Fill color">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="color" value={toHex6(curStyle.fill)} onChange={(e) => { pushHistory(); setSelEl({ fill: e.target.value }); }} style={{ width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                </span>
              </Field>
              <Field label="Line color">
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="color" value={toHex6(curStyle.stroke)} onChange={(e) => { pushHistory(); setSelEl({ stroke: e.target.value }); }} style={{ width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                </span>
              </Field>
              <Field label="Fill opacity">
                <input type="range" min={0.1} max={1} step={0.05} value={curStyle.fillOpacity}
                  onChange={(e) => setSelEl({ fillOpacity: +e.target.value })} />
              </Field>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <button style={{ ...chip, flex: 1 }} onClick={setStyleDefault} title={`Use these colors for every new ${TYPE[selEl.type].label}`}>Set as default</button>
                <button style={chip} onClick={clearElStyle} title="Revert this element to the type default">Reset</button>
              </div>
            </Section>
          )}

          {/* Parcel menu — empty hint when no parcel is selected */}
          {/* every parcel in this plan — click to select */}
          {leftPanel === "parcel" && (
            <Section title={`Parcels · ${parcels.length}`}>
              {parcels.length === 0 ? (
                <div style={{ fontSize: 12, color: PAL.muted, lineHeight: 1.6 }}>No parcels in this plan yet. Bring some in from the map, or draw one with the Boundary tool (right rail).</div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                  {parcels.map((pc, i) => {
                    const on = selParcel?.id === pc.id;
                    const picked = combineSel.includes(pc.id);
                    return (
                      <button key={pc.id} onClick={(e) => { if (e.shiftKey) toggleMerge(pc.id); setSel({ kind: "parcel", id: pc.id }); }}
                        style={{ textAlign: "left", padding: "7px 9px", borderRadius: 8, border: `1px solid ${picked ? "#2563eb" : on ? PAL.accent : "#e2dccb"}`, background: picked ? "#eaf1fe" : on ? PAL.accentSoft : "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                        <div style={{ fontSize: 12.5, fontWeight: 600, color: PAL.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{pc.addr || `Parcel ${i + 1}`}{pc.active === false ? " · inactive" : ""}{picked ? " ✓" : ""}</div>
                        <div style={{ fontSize: 10.5, color: PAL.muted, fontFamily: "ui-monospace, monospace" }}>{f2(polyArea(pc.points) / SQFT_PER_ACRE)} ac{pc.acct ? ` · ${pc.acct}` : ""}</div>
                      </button>
                    );
                  })}
                </div>
              )}
              {parcels.length > 1 && (
                <div style={{ marginTop: 8 }}>
                  <button style={{ ...chip, width: "100%", ...(combineSel.length >= 2 ? { background: PAL.accent, color: "#fff", borderColor: PAL.accent } : { opacity: 0.55 }) }}
                    disabled={combineSel.length < 2} onClick={mergeParcels}>Merge parcels{combineSel.length >= 2 ? ` (${combineSel.length})` : ""}</button>
                  <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, marginTop: 5 }}>Shift-click parcels (here or on the map, or right-click) to multi-select, then Merge. Working merge for test-fit — not a recorded consolidation.</div>
                </div>
              )}
              {/* identify any parcel from the county GIS (no import unless you add it) */}
              <div style={{ marginTop: 10, borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 10 }}>
                {origin ? (
                  <button style={{ ...chip, width: "100%", ...(identifyMode ? { background: PAL.accent, color: "#fff", borderColor: PAL.accent } : {}) }} onClick={() => { setIdentifyMode((m) => !m); setIdentifyRes(null); setJurInfo(null); }}>
                    {identifyMode ? "Identifying — click a spot (Esc to stop)" : "🔍 Identify parcel"}
                  </button>
                ) : (
                  <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5 }}>Identify needs a georeferenced plan. Bring the parcel in from the map to enable it.</div>
                )}
                {identifyRes && (
                  <div style={{ marginTop: 8, background: "#faf6ee", border: "1px solid #ece4d4", borderRadius: 8, padding: "8px 10px", fontSize: 11.5 }}>
                    {identifyRes.busy ? <span style={{ color: PAL.muted }}>Querying county GIS…</span>
                      : identifyRes.error ? <span style={{ color: "#b45309" }}>{identifyRes.error}</span>
                      : <>
                          <div style={{ fontWeight: 700, color: PAL.ink, marginBottom: 4 }}>{identifyRes.addr || "Parcel"}</div>
                          {apprRows(identifyRes.attrs).slice(0, 4).map((r) => (
                            <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "2px 0" }}>
                              <span style={{ color: PAL.muted }}>{r.label}</span><span style={{ color: PAL.ink, fontWeight: 600 }}>{apprVal(r.label, r.value)}</span>
                            </div>
                          ))}
                          {identifyRes.rings?.length > 0 && <button style={{ ...chip, width: "100%", marginTop: 7 }} onClick={addIdentifiedParcel}>＋ Add to plan</button>}
                          <button style={{ ...chip, width: "100%", marginTop: 6 }} onClick={checkJurisdiction} disabled={jurInfo?.busy}>
                            {jurInfo?.busy ? "Checking jurisdiction…" : "⚖︎ Jurisdiction & road authority"}
                          </button>
                          {jurInfo && !jurInfo.busy && (
                            <div style={{ marginTop: 7, borderTop: "1px dashed #ece4d4", paddingTop: 6 }}>
                              {jurInfo.error ? <span style={{ color: "#b45309" }}>{jurInfo.error}</span> : <>
                                {jurRow("County", jurInfo.j.county.length ? jurInfo.j.county.join(" + ") : "—", jurInfo.j.ages.county)}
                                {jurRow("City", jurInfo.j.unincorporated ? "Unincorporated" : jurInfo.j.city.join(" + "), jurInfo.j.ages.city)}
                                {jurRow("ETJ", jurInfo.j.etj.length ? jurInfo.j.etj.map((n) => `${n} ETJ`).join(" + ") : ((jurInfo.j.sources.find((s) => s.id === "etj") || {}).state === "unavailable" ? "no ETJ layer here (Houston/Austin/DFW covered)" : "not in a city ETJ"), jurInfo.j.ages.etj)}
                                {jurRow("Road maint.", jurInfo.road.authorities.length ? jurInfo.road.authorities.join(" · ") + (jurInfo.road.nearest?.route ? ` (${jurInfo.road.nearest.route})` : "") : "unknown", jurInfo.road.ageMs)}
                                {jurInfo.j.straddle && <div style={{ color: "#b45309", marginTop: 3 }}>⚑ Straddles a boundary — touches multiple jurisdictions.</div>}
                                <div style={{ color: PAL.muted, marginTop: 4, fontStyle: "italic" }}>Screening only — verify with the jurisdiction.</div>
                              </>}
                            </div>
                          )}
                        </>}
                  </div>
                )}
              </div>
            </Section>
          )}
          {/* parcel-attached drawings (B67): attach a PDF/JPEG to THIS parcel and mark it
              up on an immutable backdrop. */}
          {leftPanel === "parcel" && selParcel && (() => {
            const mine = parcelDrawings.filter((d) => d.parcelId === selParcel.id);
            return (
              <Section title="Attached drawings">
                <button style={{ ...chip, width: "100%" }} onClick={() => { setDrawingTargetParcel(selParcel.id); drawingFileRef.current?.click(); }}>＋ Attach a drawing (PDF / JPG)</button>
                <input ref={drawingFileRef} type="file" accept="application/pdf,image/*" style={{ display: "none" }}
                  onChange={(e) => { onAttachDrawing(drawingTargetParcel, e.target.files?.[0]); e.target.value = ""; }} />
                <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.45, marginTop: 6 }}>An immutable backdrop you mark up on top of — saved with this parcel.</div>
                {mine.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                    {mine.map((d) => (
                      <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 8, border: "1px solid #e2dccb", background: "#fff" }}>
                        <button onClick={() => setOpenDrawingId(d.id)} title={d.src ? "Open & mark up" : "Re-attach the file to view (markups are saved)"}
                          style={{ flex: 1, textAlign: "left", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {d.src ? "🖹" : "⚠"} {d.name}{d.markups?.length ? ` · ${d.markups.length} mk` : ""}
                        </button>
                        <button onClick={() => { if (window.confirm(`Remove “${d.name}” and its markups?`)) deleteDrawing(d.id); }} title="Remove this drawing"
                          style={{ border: "none", background: "transparent", cursor: "pointer", color: PAL.muted, fontSize: 13, lineHeight: 1 }}>✕</button>
                      </div>
                    ))}
                  </div>
                )}
              </Section>
            );
          })()}
          {/* appraisal-district property data for the selected parcel */}
          {leftPanel === "parcel" && selParcel && selParcel.attrs && (
            <Section title="Appraisal data">
              {(() => {
                const ok = Object.keys(selParcel.attrs).find((k) => /^(owner|own_?name|owner_?name|owner1|name)$/i.test(k) && selParcel.attrs[k]);
                return ok ? (
                  <div style={{ marginBottom: 9, paddingBottom: 8, borderBottom: "1px solid #ece4d4" }}>
                    <div style={{ fontSize: 9.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 700 }}>Owner</div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: PAL.ink, lineHeight: 1.3, marginTop: 2 }}>{String(selParcel.attrs[ok])}</div>
                  </div>
                ) : null;
              })()}
              {apprRows(selParcel.attrs).length === 0 ? (
                <div style={{ fontSize: 12, color: PAL.muted }}>No recognizable fields in the county record.</div>
              ) : apprRows(selParcel.attrs).map((r) => (
                <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "5px 0", borderBottom: "1px solid #f3efe5" }}>
                  <span style={{ fontSize: 11.5, color: PAL.muted, flex: "none" }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: PAL.ink, fontWeight: 600, textAlign: "right", wordBreak: "break-word" }}>{apprVal(r.label, r.value)}</span>
                </div>
              ))}
              <details style={{ marginTop: 8 }}>
                <summary style={{ fontSize: 11, color: PAL.muted, cursor: "pointer" }}>All county fields</summary>
                <div style={{ marginTop: 6 }}>
                  {apprAll(selParcel.attrs).map((r) => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "3px 0" }}>
                      <span style={{ fontSize: 10.5, color: PAL.muted, flex: "none" }}>{r.label}</span>
                      <span style={{ fontSize: 10.5, color: PAL.ink, fontFamily: "ui-monospace, monospace", textAlign: "right", wordBreak: "break-word" }}>{String(r.value)}</span>
                    </div>
                  ))}
                </div>
              </details>
            </Section>
          )}
          {/* taxing jurisdictions + combined rate (graceful-degrade until wired) */}
          {leftPanel === "parcel" && selParcel && selParcel.attrs && (
            <Section title="Taxes" collapsed>
              {!taxInfo ? (
                <div style={{ fontSize: 11.5, color: PAL.muted }}>Looking up taxing units…</div>
              ) : (
                <>
                  {taxInfo.units.length > 0 ? taxInfo.units.map((u, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", padding: "4px 0", borderBottom: "1px solid #f3efe5" }}>
                      <span style={{ fontSize: 11.5, color: PAL.ink }}>{u.name}</span>
                      <span style={{ fontSize: 11.5, color: PAL.muted, fontFamily: "ui-monospace, monospace" }}>{u.value}</span>
                    </div>
                  )) : <div style={{ fontSize: 11.5, color: PAL.muted }}>No taxing-unit fields in the county record.</div>}
                  {taxInfo.connected && taxInfo.total != null ? (
                    <div style={{ marginTop: 8, fontSize: 13, fontWeight: 700, color: PAL.ink }}>Total tax rate: {taxInfo.total} per $100</div>
                  ) : (
                    <div style={{ marginTop: 8, fontSize: 11, color: "#b45309", lineHeight: 1.5 }}>▲ {taxInfo.note} A total tax rate isn't shown until a rate source is wired for this county.</div>
                  )}
                </>
              )}
            </Section>
          )}
          {/* selected parcel — translucence + setback standards */}
          {leftPanel === "parcel" && selParcel && (
            <Section title="Boundary">
              <div style={{ fontSize: 12, color: PAL.muted, marginBottom: 8, lineHeight: 1.6 }}>
                Area: <b style={{ color: PAL.ink }}>{f0(polyArea(selParcel.points))} sf</b> · {f2(polyArea(selParcel.points) / SQFT_PER_ACRE)} ac · {selParcel.points.length} corners
              </div>
              {(() => {
                const ca = countyAcres(selParcel.attrs);
                if (!ca || !ca.acres) return null;
                const mine = polyArea(selParcel.points) / SQFT_PER_ACRE;
                // A projected Shape area read as ft² but actually in m² lands ~10.76× too small; if
                // multiplying it back by that factor matches our geometry, treat it as m² and use the
                // corrected county acreage (so a correct parcel reads ✓, not a false ~900% off).
                const m2 = ca.fromArea && Math.abs(mine - ca.acres * 10.7639) / (ca.acres * 10.7639) < 0.12;
                const county = m2 ? ca.acres * 10.7639 : ca.acres;
                const diff = Math.abs(mine - county) / county;
                const [color, mark] = diff <= 0.02 ? ["#2f7a3e", "✓"] : diff <= 0.05 ? ["#6b6557", "≈"] : ["#b45309", "▲"];
                return (
                  <div style={{ fontSize: 11, color, marginBottom: 8, lineHeight: 1.5, background: "#faf6ee", border: "1px solid #ece4d4", borderRadius: 8, padding: "6px 9px" }}>
                    <b>{mark} Geometry check</b> · county {f2(county)} ac vs {f2(mine)} ac ({f0(diff * 100)}% {diff <= 0.02 ? "match" : "off"})
                    {m2 && <div style={{ marginTop: 2, color: PAL.muted }}>County area field was in m² — converted to acres.</div>}
                    {!m2 && diff > 0.05 && <div style={{ marginTop: 2, color: PAL.muted }}>County acreage is approximate; check calibration/projection.</div>}
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 6, marginBottom: 9 }}>
                <button style={chip} onClick={() => toggleParcelActive(selParcel.id)} title={selParcel.active === false ? "Excluded from yield / coverage / detention — click to include" : "Counted in yield / coverage / detention — click to exclude (stays visible, dimmed)"}>{selParcel.active === false ? "◯ Inactive" : "✓ Active"}</button>
                <button style={chip} onClick={() => toggleParcelLock(selParcel.id)} title="Lock the boundary so it can't be moved or reshaped">{selParcel.locked ? "🔒 Unlock" : "🔓 Lock"}</button>
              </div>
              <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={!!selParcel.fill} onChange={(e) => { pushHistory(); setSelParcel(e.target.checked ? { fill: "#5b6650" } : { fill: null }); }} /> Fill the parcel (off by default)
              </label>
              {selParcel.fill && (
                <>
                  <Field label="Translucence">
                    <input type="range" min={0} max={0.6} step={0.02} value={selParcel.fillOpacity ?? 0.12}
                      onChange={(e) => setSelParcel({ fillOpacity: +e.target.value })} />
                  </Field>
                  <Field label="Fill color">
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="color" value={toHex6(selParcel.fill)} onChange={(e) => { pushHistory(); setSelParcel({ fill: e.target.value }); }} style={{ width: 34, height: 26, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                    </span>
                  </Field>
                </>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", margin: "10px 0 4px" }}>
                <span style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em" }}>Setbacks per edge</span>
                <label style={{ display: "flex", gap: 6, fontSize: 11, color: PAL.muted, cursor: "pointer" }}><input type="checkbox" checked={settings.showSetback} onChange={(e) => setSettings((s) => ({ ...s, showSetback: e.target.checked }))} /> Show</label>
              </div>
              {(() => {
                const sb = parcelSetbacks(selParcel), fe = frontEdge(selParcel);
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    {sb.map((v, i) => (
                      <div key={i} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ flex: 1, fontSize: 12, color: PAL.ink }}>{i === fe ? "Front" : `Edge ${i + 1}`}</span>
                        <NumInput style={{ ...numInput, width: 54 }} value={Math.round(v)} min={0} onCommit={(n) => setEdgeSetback(selParcel, i, n)} />
                      </div>
                    ))}
                    <button style={{ ...chip, marginTop: 4 }} onClick={() => { pushHistory(); setParcels((a) => a.map((p) => p.id === selParcel.id ? { ...p, setbacks: Array.from({ length: p.points.length }, () => +settings.setback || 0) } : p)); }}>Reset to default ({settings.setback}′)</button>
                  </div>
                );
              })()}
              <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
                <button style={{ ...chip, color: "#b3361b" }} onClick={deleteSel}>Delete parcel</button>
              </div>
            </Section>
          )}

          {/* metrics */}
          {leftPanel === "yield" && (
          <Section title="Site yield" accent={PAL.accent}>
            {/* hero stat tiles */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 7, marginBottom: 10 }}>
              {[
                ["Site", `${f2(siteSqft / SQFT_PER_ACRE)}`, "ac"],
                ["Building", `${f0(bldg / 1000)}k`, "sf"],
                ["Coverage", `${f0(cov)}`, "%"],
              ].map(([k, v, u]) => (
                <div key={k} style={{ background: "linear-gradient(160deg,#fbf8f2,#f3eee3)", border: "1px solid #ece4d4", borderRadius: 9, padding: "8px 9px" }}>
                  <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 600 }}>{k}</div>
                  <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontWeight: 700, color: PAL.ink, fontSize: 16, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", marginTop: 2 }}>{v}<span style={{ fontSize: 10.5, color: PAL.muted, fontWeight: 500, marginLeft: 2 }}>{u}</span></div>
                </div>
              ))}
            </div>
            {metricRow("Site area", `${f2(siteSqft / SQFT_PER_ACRE)} ac`, `(${f0(siteSqft)} sf)`)}
            {parcels.some((p) => p.active === false) && (
              <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4, margin: "-2px 0 6px" }}>
                Excludes {parcels.filter((p) => p.active === false).length} inactive parcel{parcels.filter((p) => p.active === false).length > 1 ? "s" : ""} — toggle in the Parcel panel.
              </div>
            )}
            {metricRow("Building", `${f0(bldg)} sf`, bumpCount ? `incl. ${bumpCount} bump-out${bumpCount > 1 ? "s" : ""}` : "")}
            {bumpCount > 0 && metricRow("· Bump-outs", `${f0(bumpArea)} sf`, `${bumpCount} × ${DOGEAR_W}′×${DOGEAR_D}′`)}
            {metricRow("FAR", f2(far), "(1-story)")}
            {metricRow("Car stalls", f0(stalls), ratio ? `· ${f2(ratio)}/1k sf` : "")}
            {metricRow("Trailer stalls", f0(trailers))}
            {metricRow("Impervious", `${f0(impPct)}%`)}
            {metricRow("Detention", `${f0(pondArea)} sf`, `· ${f2(pondArea / SQFT_PER_ACRE)} ac`)}
            {metricRow("Detention %", `${f0(detPct)}%`)}
            {metricRow("Open / green", `${f2(open / SQFT_PER_ACRE)} ac`)}
            {easeAll.length > 0 && <>
              {metricRow("Easements", `${f2(easeArea / SQFT_PER_ACRE)} ac`, `${easeAll.length} · ${f0(easeArea)} sf gross`)}
              {metricRow("· Restrict buildings", `${f0(easeBldgArea)} sf`, easeBldgArea ? `· ${f2(easeBldgArea / SQFT_PER_ACRE)} ac` : "")}
              {easePaveArea > 0 && metricRow("· Restrict paving", `${f0(easePaveArea)} sf`)}
              <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.4, margin: "2px 0 0" }}>
                Gross of overlaps; subtracted from buildable area by the future yield engine.
              </div>
            </>}
          </Section>
          )}

          {/* settings — grouped, collapsible */}
          {leftPanel === "standards" && (<>
          <Section title="Site defaults">
            <Field label="Grid (ft)"><NumInput style={numInput} value={settings.gridSize} min={1} onCommit={(n) => setSettings((s) => ({ ...s, gridSize: n }))} /></Field>
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, margin: "2px 0 6px", cursor: "pointer" }} title="Snap to grid & flush against neighbours — press S to toggle; hold Alt while dragging to place freely"><input type="checkbox" checked={settings.snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to grid &amp; neighbours (S)</label>
            <Field label="Default setback"><NumInput style={numInput} value={settings.setback} min={0} onCommit={(n) => setSettings((s) => ({ ...s, setback: n }))} /></Field>
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, margin: "2px 0 6px", cursor: "pointer" }}><input type="checkbox" checked={settings.showSetback} onChange={(e) => setSettings((s) => ({ ...s, showSetback: e.target.checked }))} /> Show setback line</label>
            <label style={{ display: "flex", gap: 8, fontSize: 12, color: PAL.muted, cursor: "pointer" }}><input type="checkbox" checked={settings.showDocks} onChange={(e) => setSettings((s) => ({ ...s, showDocks: e.target.checked }))} /> Show dock doors</label>
          </Section>

          <Section title="Parking" collapsed>
            <Field label="Stall W / D"><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={settings.stallW} min={1} onCommit={(n) => setSettings((s) => ({ ...s, stallW: n }))} /> <NumInput style={{ ...numInput, width: 42 }} value={settings.stallDepth} min={1} onCommit={(n) => setSettings((s) => ({ ...s, stallDepth: n }))} /></span></Field>
            <Field label="Drive aisle"><NumInput style={numInput} value={settings.aisle} min={1} onCommit={(n) => setSettings((s) => ({ ...s, aisle: n }))} /></Field>
            <Field label="Park angle"><select style={{ ...numInput, width: 58 }} value={settings.parkAngle} onChange={(e) => setSettings((s) => ({ ...s, parkAngle: +e.target.value }))}><option value={90}>90°</option><option value={60}>60°</option><option value={45}>45°</option></select></Field>
          </Section>

          <Section title="Trailers" collapsed>
            <Field label="Trailer W / L"><span style={{ display: "flex", gap: 5 }}><NumInput style={{ ...numInput, width: 42 }} value={settings.trailerW} min={1} onCommit={(n) => setSettings((s) => ({ ...s, trailerW: n }))} /> <NumInput style={{ ...numInput, width: 42 }} value={settings.trailerL} min={1} onCommit={(n) => setSettings((s) => ({ ...s, trailerL: n }))} /></span></Field>
            <Field label="Trailer aisle"><NumInput style={numInput} value={settings.trailerAisle} min={0} onCommit={(n) => setSettings((s) => ({ ...s, trailerAisle: n }))} /></Field>
          </Section>

          <Section title="Roads" collapsed>
            <Field label="Curb width (ft)"><NumInput style={numInput} value={settings.roadCurb ?? 0.5} min={0} onCommit={(n) => setSettings((s) => ({ ...s, roadCurb: n }))} /></Field>
            <Field label="Road widths (ft)">
              <input style={{ ...numInput, width: 150 }} value={settings.roadWidths ?? "24, 26, 30, 36, 40"}
                onChange={(e) => setSettings((s) => ({ ...s, roadWidths: e.target.value }))} />
            </Field>
          </Section>

          {/* element default colors — edit without selecting anything */}
          <Section title="Element default colors" collapsed>
            {Object.keys(TYPE).map((k) => {
              const st = typeStyle(k, settings);
              return (
                <div key={k} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
                  <span style={{ flex: 1, fontSize: 12, color: PAL.ink }}>{TYPE[k].label.split(" / ")[0]}</span>
                  <input type="color" title="Fill" value={toHex6(st.fill)} onChange={(e) => setTypeStyle(k, { fill: e.target.value })} style={{ width: 30, height: 24, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                  <input type="color" title="Line" value={toHex6(st.stroke)} onChange={(e) => setTypeStyle(k, { stroke: e.target.value })} style={{ width: 30, height: 24, padding: 0, border: `1px solid #ddd6c5`, borderRadius: 6, background: "#fff", cursor: "pointer" }} />
                </div>
              );
            })}
            <button style={{ ...chip, marginTop: 4, color: PAL.accent }} onClick={() => { pushHistory(); setSettings((s) => ({ ...s, typeStyles: {} })); }}>Reset all to built-in</button>
          </Section>
          </>)}
          </div>
          {/* drag handle to resize the menu (desktop only — on phones the panel is a fixed-width overlay) */}
          {!narrow && <div onPointerDown={startLeftResize} title="Drag to resize"
            style={{ width: 6, flex: "none", cursor: "col-resize", background: PAL.panelLine, borderRight: `1px solid ${PAL.panelLine}` }} />}
          </>)}
        </div>
      </div>

      {showShortcuts && (
        <div onClick={() => setShowShortcuts(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(20,18,15,0.55)", display: "grid", placeItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", padding: 22, width: 560, maxWidth: "92vw", maxHeight: "86vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: PAL.ink }}>Keyboard & gestures</h2>
              <button className="gbtn" onClick={() => setShowShortcuts(false)} style={{ ...chip }}>Close ✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 26px" }}>
              {[
                ["Tools", ""], ["V", "Select"], ["H", "Pan (hand)"], ["Space-drag", "Pan temporarily"], ["S", "Toggle snap"], ["L", "Line"], ["R", "Rectangle"], ["E", "Ellipse"],
                ["⇧P", "Polygon"], ["⇧N", "Polyline"], ["Q", "Callout"], ["T", "Text box"],
                ["Edit", ""], ["Ctrl/⌘ Z", "Undo"], ["Ctrl/⌘ ⇧Z", "Redo"], ["Ctrl/⌘ C / X / V", "Copy / Cut / Paste"],
                ["Ctrl/⌘ D", "Duplicate"], ["Delete / ⌫", "Delete selection"], ["Esc", "Cancel / deselect"],
                ["While drawing", ""], ["⇧ drag", "Constrain (square / circle / 45°)"], ["Double-click / Enter", "Finish polygon / polyline"], ["Click 1st dot", "Close a shape"],
                ["Gestures", ""], ["Drag a dot", "Move a vertex"], ["＋ on an edge", "Add a vertex"], ["⇧-click a dot", "Delete a vertex"],
                ["Double-click element", "Change type / actions"], ["⇧ drag element", "Bond to a neighbour"], ["Alt drag", "Bypass snap (place freely)"], ["?", "This panel"],
              ].map(([k, v], i) => v === "" ? (
                <div key={i} style={{ gridColumn: "1 / -1", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: PAL.muted, marginTop: i ? 12 : 0, marginBottom: 2 }}>{k}</div>
              ) : (
                <div key={i} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "3px 0", fontSize: 12.5 }}>
                  <kbd style={{ flex: "none" }}>{k}</kbd><span style={{ color: PAL.ink }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Version history (automatic local backups, B126) — restore an earlier saved version */}
      {versionsOpen && (
        <div onClick={() => setVersionsOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(20,18,15,0.55)", display: "grid", placeItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", padding: 22, width: 460, maxWidth: "92vw", maxHeight: "82vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: PAL.ink }}>Version history</h2>
              <button className="gbtn" onClick={() => setVersionsOpen(false)} style={{ ...chip }}>Close ✕</button>
            </div>
            <div style={{ fontSize: 12, color: PAL.muted, lineHeight: 1.5, marginBottom: 12 }}>
              Automatic backups of this plan, saved on this device. Restore one to bring it back — your current version is backed up too, so a restore can be undone. (Aerials / backdrop images may need re-dropping.)
            </div>
            {versionList.length === 0 ? (
              <div style={{ fontSize: 12.5, color: PAL.muted, padding: "10px 0" }}>No earlier versions saved yet. As you edit, recent versions are backed up here automatically.</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {versionList.map((v) => {
                  const d = new Date(v.at);
                  const when = isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
                  return (
                    <div key={v.at} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 10px", border: `1px solid ${PAL.panelLine}`, borderRadius: 9 }}>
                      <span style={{ fontSize: 12.5, color: PAL.ink }}>
                        <span style={{ fontWeight: 650 }}>{when}</span>
                        <span style={{ color: PAL.muted }}> · {v.buildings} building{v.buildings === 1 ? "" : "s"}</span>
                      </span>
                      <button style={{ ...chip, flex: "none" }} onClick={() => restoreVersion(v.at)} title="Replace the canvas with this saved version">Restore</button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {/* Parcel-attached drawing markup modal (B67) */}
      {openDrawingId && (() => {
        const d = parcelDrawings.find((x) => x.id === openDrawingId);
        if (!d) return null;
        return <ParcelDrawing drawing={d} loading={rehydratingId === d.id} onSave={(marks) => updateDrawingMarks(d.id, marks)} onClose={() => setOpenDrawingId(null)} />;
      })()}
      {/* Multi-page PDF sheet picker (B67 increment 2) */}
      {pagePick && (
        <div style={{ position: "fixed", inset: 0, zIndex: 3500, background: "rgba(20,18,15,0.5)", display: "grid", placeItems: "center" }} onClick={cancelPagePick}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 12, padding: 18, width: 420, maxWidth: "90vw", boxShadow: "0 18px 50px rgba(0,0,0,0.35)", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ fontSize: 14, fontWeight: 800, color: PAL.ink }}>Pick a sheet</div>
            <div style={{ fontSize: 12, color: PAL.chromeMuted, margin: "5px 0 12px" }}>“{pagePick.name}” has {pagePick.pageCount} pages — choose which one to attach as the backdrop.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, maxHeight: 220, overflowY: "auto" }}>
              {Array.from({ length: pagePick.pageCount }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => pickPage(n)} title={`Attach page ${n}`}
                  style={{ minWidth: 40, padding: "7px 10px", fontSize: 12.5, fontWeight: 700, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${PAL.panelLine}`, background: "#fff", color: PAL.ink }}>{n}</button>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
              <button onClick={cancelPagePick} style={{ padding: "7px 12px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${PAL.panelLine}`, background: "#fff", color: PAL.ink }}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {/* Title reader + metes-and-bounds modal */}
      {titleOpen && (() => {
        const calls = parseCalls(mbText);
        const path = calls.length ? callsToPath(calls, { x: 0, y: 0 }) : [];
        const closes = pathCloses(path);
        return (
        <div onClick={() => setTitleOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 3000, background: "rgba(20,18,15,0.55)", display: "grid", placeItems: "center" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, boxShadow: "0 20px 60px rgba(0,0,0,0.35)", padding: 22, width: 720, maxWidth: "94vw", maxHeight: "90vh", overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 4 }}>
              <h2 style={{ margin: 0, fontSize: 16, color: PAL.ink }}>Title reader &amp; metes-and-bounds plotter</h2>
              <button className="gbtn" onClick={() => setTitleOpen(false)} style={{ ...chip }}>Close ✕</button>
            </div>
            <div style={{ fontSize: 11.5, color: PAL.muted, lineHeight: 1.5, marginBottom: 14 }}>
              Upload a title commitment to pull its Schedule B exceptions into a checklist, then plot any metes-and-bounds easement on the plan.
            </div>

            {/* API key */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: PAL.muted, marginBottom: 5 }}>Anthropic API key</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="password" value={apiKey} placeholder="sk-ant-…" autoComplete="off"
                  onChange={(e) => { setApiKey(e.target.value); setKey(e.target.value.trim()); }}
                  style={{ ...numInput, width: "auto", flex: 1, fontFamily: "ui-monospace, monospace" }} />
                {apiKey && <button className="gbtn" style={chip} onClick={() => { setApiKey(""); setKey(""); }}>Clear</button>}
              </div>
              <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.5, marginTop: 5 }}>
                Stored only in this browser (localStorage) and sent directly to Anthropic. The PDF reader needs it; the plotter below does not.
              </div>
            </div>

            {/* PDF upload + Schedule B */}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 14, marginBottom: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: PAL.ink }}>1 · Schedule B exceptions</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input ref={titlePdfRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }}
                    onChange={(e) => { runTitleExtract(e.target.files?.[0]); e.target.value = ""; }} />
                  <button style={{ ...btn(true), padding: "7px 13px", opacity: titleBusy ? 0.6 : 1 }} disabled={titleBusy}
                    onClick={() => titlePdfRef.current?.click()}>{titleBusy ? "Reading…" : "Upload title PDF"}</button>
                </div>
              </div>
              {titleErr && <div style={{ fontSize: 12, color: "#b91c1c", marginBottom: 8, lineHeight: 1.45 }}>{titleErr}</div>}
              {titleDoc && (
                titleDoc.exceptions.length ? (
                  <div style={{ border: `1px solid ${PAL.panelLine}`, borderRadius: 10, overflow: "hidden" }}>
                    {titleDoc.exceptions.map((x, i) => (
                      <label key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start", padding: "8px 11px", borderBottom: i < titleDoc.exceptions.length - 1 ? `1px solid ${PAL.panelLine}` : "none", cursor: "pointer", background: excChecked[i] ? "#f6fdf6" : "#fff" }}>
                        <input type="checkbox" checked={!!excChecked[i]} onChange={(e) => setExcChecked((s) => ({ ...s, [i]: e.target.checked }))} style={{ marginTop: 2 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", gap: 7, alignItems: "baseline", flexWrap: "wrap" }}>
                            <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 11, fontWeight: 700, color: PAL.ink }}>{x.number ? `#${x.number}` : `#${i + 1}`}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#fff", background: x.plottable ? "#7c3aed" : PAL.muted, borderRadius: 5, padding: "1px 6px" }}>{x.type}</span>
                            {x.plottable && <span style={{ fontSize: 10, color: "#7c3aed", fontWeight: 600 }}>plottable</span>}
                          </div>
                          <div style={{ fontSize: 12.5, color: PAL.ink, marginTop: 2, lineHeight: 1.4 }}>{x.description}</div>
                          {x.recordingReference && <div style={{ fontSize: 11, color: PAL.muted, fontFamily: "ui-monospace, monospace", marginTop: 1 }}>{x.recordingReference}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                ) : <div style={{ fontSize: 12, color: PAL.muted }}>No Schedule B exceptions were found in that document.</div>
              )}
            </div>

            {/* metes-and-bounds plotter */}
            <div style={{ borderTop: `1px solid ${PAL.panelLine}`, paddingTop: 14 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: PAL.ink, marginBottom: 8 }}>2 · Plot a metes-and-bounds description</div>
              <textarea value={mbText} onChange={(e) => setMbText(e.target.value)} rows={5}
                placeholder={'Paste a legal description, e.g.\nBEGINNING at a point… THENCE N 45°30′00″ E, 150.00 feet;\nTHENCE S 44°30′00″ E, 300.00 feet; …'}
                style={{ width: "100%", boxSizing: "border-box", padding: "9px 11px", fontSize: 12, fontFamily: "ui-monospace, monospace", border: `1px solid #ddd6c5`, borderRadius: 8, color: PAL.ink, resize: "vertical", lineHeight: 1.5 }} />
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 12, color: calls.length ? PAL.ink : PAL.muted, fontWeight: 600 }}>
                  {calls.length ? `${calls.length} call${calls.length > 1 ? "s" : ""} parsed · ${closes ? "closes (tract)" : "open (corridor)"}` : "No calls parsed yet"}
                </div>
                {calls.some((c) => c.curve) && (
                  <div style={{ flexBasis: "100%", fontSize: 11, color: "#b45309", lineHeight: 1.45 }}>
                    ⚠ {calls.filter((c) => c.curve).length} curve(s) plotted as straight chords — verify against the survey.
                  </div>
                )}
                {calls.length > 0 && !closes && (
                  <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: PAL.muted }}>
                    Corridor width
                    <input type="number" min={1} value={mbWidth} onChange={(e) => setMbWidth(Math.max(1, +e.target.value || 1))} style={{ ...numInput, width: 56 }} /> ft
                  </label>
                )}
                <div style={{ flex: 1 }} />
                <button style={{ ...chip, padding: "8px 13px", opacity: calls.length ? 1 : 0.5 }} disabled={!calls.length} onClick={() => startPlotMetes(true)} title="Spawn a first-class Easement object (type/holder/etc. editable afterward in the Element panel)">Plot as easement →</button>
                <button style={{ ...btn(true), padding: "8px 15px", opacity: calls.length ? 1 : 0.5 }} disabled={!calls.length} onClick={() => startPlotMetes(false)}>Plot on canvas →</button>
              </div>
              {calls.length > 0 && (
                <div style={{ marginTop: 10, maxHeight: 130, overflowY: "auto", border: `1px solid ${PAL.panelLine}`, borderRadius: 8, fontSize: 11.5, fontFamily: "ui-monospace, monospace" }}>
                  {calls.map((c, i) => (
                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 10px", borderBottom: i < calls.length - 1 ? "1px solid #f3efe5" : "none", color: PAL.ink }}>
                      <span>{i + 1}. {c.bearing}{c.curve ? " ⤿ (chord)" : ""}</span><span>{c.distFt.toFixed(2)}′</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* POB / overlap banner (after plotting or while awaiting a POB click) */}
      {/* ditch cross-section result */}
      {xsec && (
        <div style={{ position: "fixed", left: 16, bottom: 16, zIndex: 2600, width: 286, background: "#fff", border: `1px solid ${PAL.panelLine}`, borderRadius: 12, boxShadow: "0 12px 36px rgba(0,0,0,0.22)", padding: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <span style={{ fontSize: 12.5, fontWeight: 700, color: PAL.ink }}>Ditch cross-section</span>
            <button onClick={() => setXsec(null)} style={{ ...chip, padding: "3px 8px", fontSize: 11 }}>✕</button>
          </div>
          {xsec.busy ? (
            <div style={{ fontSize: 12, color: PAL.muted, padding: "10px 0" }}>Sampling USGS 3DEP elevation…</div>
          ) : xsec.stats && (() => {
            const s = xsec.stats, W = 258, H = 64, span = Math.max(0.5, s.maxFt - s.minFt);
            const pts = s.profile.map((p) => `${(p.d / xsec.lenFt) * W},${H - ((p.el - s.minFt) / span) * (H - 6) - 3}`).join(" ");
            return (
              <div>
                <svg width={W} height={H} style={{ display: "block", background: "#f8f6f0", borderRadius: 6 }}>
                  <polyline points={pts} fill="none" stroke="#0e7490" strokeWidth={1.6} />
                </svg>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11.5, color: PAL.ink, marginTop: 7, fontFamily: "ui-monospace, monospace" }}>
                  <span>Depth ≈ <b>{f1(s.depthFt)}′</b></span>
                  <span>Invert {f1(s.invertFt)}′</span>
                  <span>Bank {f1(s.bankFt)}′</span>
                </div>
                <div style={{ fontSize: 9.5, color: "#b45309", lineHeight: 1.4, margin: "6px 0 8px" }}>Screening only — LiDAR bare-earth, verify with survey.</div>
                <button onClick={() => {
                  if (selEl?.type === "pond") { pushHistory(); setSelEl({ det: { ...(selEl.det || {}), availDepth: s.depthFt } }); flashWarn("Available depth applied to the selected pond.", 4000); }
                  else { flashWarn("Select a pond first, then apply the available depth.", 5000); }
                }} style={{ ...chip, width: "100%", fontWeight: 600 }}>→ Use as detention available depth{selEl?.type === "pond" ? "" : " (select a pond)"}</button>
              </div>
            );
          })()}
        </div>
      )}

      {(pobMode || routeMode || overlapWarn) && (
        <div style={{ position: "fixed", left: "50%", bottom: 84, transform: "translateX(-50%)", zIndex: 2500, maxWidth: "80vw",
          background: overlapWarn.startsWith("⚠") ? "#7f1d1d" : (pobMode || routeMode ? PAL.accent : "#15803d"),
          color: "#fff", padding: "9px 16px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 28px rgba(0,0,0,0.3)", display: "flex", gap: 12, alignItems: "center" }}>
          <span>{pobMode ? "Click the point of beginning on the plan to anchor the description (Esc to cancel)." : overlapWarn}</span>
          {(pobMode || routeMode) && <button onClick={() => { setPobMode(null); setRouteMode(null); setOverlapWarn(""); }} style={{ border: "1px solid rgba(255,255,255,0.5)", background: "transparent", color: "#fff", borderRadius: 7, padding: "3px 9px", cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Cancel</button>}
        </div>
      )}

      {ovCalib && (
        <div style={{ position: "fixed", left: "50%", bottom: 84, transform: "translateX(-50%)", zIndex: 2500, maxWidth: "80vw",
          background: PAL.accent, color: "#fff", padding: "9px 16px", borderRadius: 99, fontSize: 12.5, fontWeight: 600, boxShadow: "0 8px 28px rgba(0,0,0,0.3)", display: "flex", gap: 12, alignItems: "center" }}>
          <span>{ovCalibMsg()} {ovCalib.kind === "align" && Math.floor(ovCalib.pts.length / 2) >= 2 ? <span style={{ opacity: 0.75 }}>· or add more pairs for a better fit</span> : null} <span style={{ opacity: 0.75 }}>(Esc to cancel)</span></span>
          {ovCalib.kind === "align" && Math.floor(ovCalib.pts.length / 2) >= 2 && (
            <button onClick={applyOvAlign} style={{ border: "1px solid #fff", background: "#fff", color: PAL.accent, borderRadius: 7, padding: "3px 11px", cursor: "pointer", fontSize: 11.5, fontWeight: 700 }}>Apply {Math.floor(ovCalib.pts.length / 2)} pts</button>
          )}
          <button onClick={() => setOvCalib(null)} style={{ border: "1px solid rgba(255,255,255,0.5)", background: "transparent", color: "#fff", borderRadius: 7, padding: "3px 9px", cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>Cancel</button>
        </div>
      )}

      {parcelMenu && (
        <>
          <div onClick={() => setParcelMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 1998 }} />
          <div className="menu" style={{ ...menuPanel, position: "fixed", left: Math.min(parcelMenu.x, window.innerWidth - 206), top: Math.min(parcelMenu.y, window.innerHeight - 130), zIndex: 1999, width: 196 }}>
            <button style={{ ...menuItem(false), opacity: combineSel.length >= 2 ? 1 : 0.5, cursor: combineSel.length >= 2 ? "pointer" : "default" }} disabled={combineSel.length < 2} onClick={() => { mergeParcels(); setParcelMenu(null); }}>Merge parcels ({combineSel.length})</button>
            <button style={menuItem(false)} onClick={() => { setCombineSel([]); setParcelMenu(null); }}>Clear selection</button>
            <div style={{ fontSize: 10.5, color: PAL.muted, padding: "6px 8px 2px", lineHeight: 1.4, borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 }}>Shift-click parcels to add more, then Merge.</div>
          </div>
        </>
      )}

      {typeMenu && (() => {
        const MW = 200, GAP = 8, vw = window.innerWidth, vh = window.innerHeight;
        const left = Math.max(GAP, Math.min(typeMenu.x + 6, vw - MW - GAP));
        const spaceBelow = vh - typeMenu.y - GAP, spaceAbove = typeMenu.y - GAP;
        const openUp = spaceBelow < spaceAbove; // open toward whichever side has more room
        const maxH = Math.max(140, openUp ? spaceAbove : spaceBelow);
        const vEdge = openUp ? { bottom: vh - typeMenu.y + 6 } : { top: typeMenu.y + 6 };
        return (
        <>
          <div onClick={() => setTypeMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 1998 }} />
          <div className="menu" style={{ ...menuPanel, position: "fixed", left, ...vEdge, zIndex: 1999, width: MW, maxHeight: maxH, overflowY: "auto" }}>
            {(() => {
              const t = els.find((el) => el.id === typeMenu.id);
              if (!t) return null;
              const isBuildingRect = t.type === "building" && !t.points;
              const hdr = (top) => ({ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", padding: top ? "8px 8px 6px" : "4px 8px 6px", ...(top ? { borderTop: `1px solid ${PAL.panelLine}`, marginTop: 4 } : {}) });
              const dock = t.dock || "single";
              return (
                <>
                  {(t.type === "sidewalk" || t.type === "landscape") && (
                    <>
                      <div style={hdr(false)}>Type</div>
                      <button style={menuItem(false)} onClick={() => { pushHistory(); setEls((a) => a.map((e) => e.id === typeMenu.id ? { ...e, type: t.type === "sidewalk" ? "landscape" : "sidewalk" } : e)); setTypeMenu(null); }}>
                        {t.type === "sidewalk" ? "Turn into landscape buffer" : "Turn into sidewalk"}
                      </button>
                    </>
                  )}
                  {isBuildingRect && (
                    <>
                      <div style={hdr(t.type === "sidewalk" || t.type === "landscape")}>Dock features</div>
                      <button style={menuItem(false)} onClick={() => { addTruckCourt(t); setTypeMenu(null); }}>Add {TRUCK_COURT_D}′ truck court</button>
                      <button style={menuItem(false)} onClick={() => { addDogEars(t); setTypeMenu(null); }}>Add bump-outs ({DOGEAR_W}′×{DOGEAR_D}′)</button>
                    </>
                  )}
                  {t.type === "parking" && !t.points && parkRowsForDepth(t.h, cfgOf(t).stallDepth || settings.stallDepth, cfgOf(t).aisle ?? settings.aisle) >= 3 && (
                    <>
                      <div style={hdr(true)}>Parking</div>
                      <button style={menuItem(false)} onClick={() => { splitParkingRows(t); setTypeMenu(null); }}>Split rows/aisles</button>
                    </>
                  )}
                  <div style={hdr(true)}>Edit</div>
                  <button style={menuItem(false)} onClick={() => { duplicateEl(typeMenu.id); setTypeMenu(null); }}>Duplicate</button>
                  <button style={menuItem(!!t.locked)} onClick={() => { toggleLock(typeMenu.id); setTypeMenu(null); }}>{t.locked ? "Unpin" : "Pin"}</button>
                  {!t.points && <button style={menuItem(false)} onClick={() => { setSel({ kind: "el", id: typeMenu.id }); setAlignFor(typeMenu.id); setTypeMenu(null); }}>Align rotation…</button>}
                  {t.attachedTo
                    ? <button style={menuItem(false)} onClick={() => { detach(typeMenu.id); setTypeMenu(null); }}>Detach</button>
                    : <button style={menuItem(false)} onClick={() => { setAttachFor(typeMenu.id); setTypeMenu(null); }}>Attach to…</button>}
                  <button style={{ ...menuItem(false), color: "#b3361b" }} onClick={() => { setSel({ kind: "el", id: typeMenu.id }); deleteSel(); setTypeMenu(null); }}>Delete</button>
                </>
              );
            })()}
          </div>
        </>
        );
      })()}
    </div>
  );
}

/* element renderer working in PIXEL space (points pre-transformed by f2p).
   We draw the rect via the rotated group around the element's pixel center. */
function renderElPx(el, f2p, sel, tool, settings, startMoveEl, onElDouble, allEls, startDimMove, editDimWidth) {
  // Per-element striping config. renderElPx is a MODULE-level fn, so it can't close
  // over the component-scoped cfgOf — referencing that one here threw "cfgOf is not
  // defined" inside the els.map during render and blanked the whole page on any
  // project with a parking element. Resolve it locally from the settings param.
  const cfgOf = (e) => (e.cfg ? { ...settings, ...e.cfg } : settings);
  const st = elStyle(el, settings);
  const fillOp = st.fillOpacity ?? 1;
  const isSel = sel?.kind === "el" && sel.id === el.id;
  const texFill = st.pattern ? `url(#pat-${st.pattern})` : st.hatch ? "url(#pat-landscape)" : st.water ? "url(#pat-water)" : null;
  // Detention "expand vs. existing" ghost: the locked baseline footprint, in world
  // feet, drawn dashed so the user sees what the pond grew from. Same path for the
  // polygon and rect branches (the rect branch counter-rotates it back to world).
  const ghostRing = el.type === "pond" && el.det?.baseline?.ring?.length >= 3 ? el.det.baseline.ring : null;
  const ghostPath = ghostRing ? ghostRing.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z" : null;
  const ghostEl = (k) => <path key={k} d={ghostPath} fill="none" stroke="#5d8497" strokeWidth={1.25} strokeDasharray="7 5" opacity={0.8} pointerEvents="none" />;
  if (el.points) { // polygon element (irregular area drawn by clicking points)
    const dPath = el.points.map((p, i) => { const q = f2p(p); return `${i ? "L" : "M"}${q.x},${q.y}`; }).join(" ") + "Z";
    return (
      <g key={el.id} filter={st.shadow ? "url(#bldgShadow)" : undefined} style={{ cursor: tool === "select" ? "move" : "crosshair" }}
        onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
        onContextMenu={(e) => { if (onElDouble) { e.preventDefault(); onElDouble(e, el.id); } }}>
        <path d={dPath} fill={st.fill} fillOpacity={fillOp} stroke="none" />
        {texFill && <path d={dPath} fill={texFill} stroke="none" pointerEvents="none" />}
        <path d={dPath} fill="none" stroke={isSel ? PAL.accent : st.stroke} strokeWidth={isSel ? st.weight + 1.25 : st.weight} />
        {ghostPath && ghostEl("ghost")}
      </g>
    );
  }
  const tl = f2p({ x: el.cx - el.w / 2, y: el.cy - el.h / 2 });
  const c = f2p({ x: el.cx, y: el.cy });
  const ppf = (f2p({ x: 1, y: 0 }).x - f2p({ x: 0, y: 0 }).x); // px per foot
  const w = el.w * ppf, h = el.h * ppf;
  const parts = [];
  const rx = el.type === "pond" ? Math.min(w, h) * 0.12 : 0;
  parts.push(<rect key="r" x={tl.x} y={tl.y} width={w} height={h} fill={st.fill} fillOpacity={fillOp}
    stroke={isSel ? PAL.accent : st.stroke} strokeWidth={isSel ? st.weight + 0.75 : st.weight} rx={rx} />);
  if (texFill) parts.push(<rect key="tex" x={tl.x} y={tl.y} width={w} height={h} fill={texFill} rx={rx} pointerEvents="none" />);
  // Counter-rotate the baseline ghost: its ring is already in world feet, but this
  // branch's group rotates everything by el.rot — undo that so the ghost lands true.
  if (ghostPath) parts.push(<g key="ghost" transform={`rotate(${-el.rot} ${c.x} ${c.y})`}>{ghostEl("g")}</g>);

  if (el.type === "parking") {
    const cs = carStalls(el.w, el.h, cfgOf(el));
    cs.bands.forEach((b, i) => {
      const bandW = b.n * b.pitch;
      parts.push(<rect key={`b${i}`} x={tl.x} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />);
      const lean = b.dir * b.slantDx; // angled stalls lean toward their aisle
      for (let k = 1; k < b.n; k++) {
        const x = tl.x + k * b.pitch * ppf;
        parts.push(<line key={`b${i}d${k}`} x1={x} y1={tl.y + b.y * ppf} x2={x + lean * ppf} y2={tl.y + (b.y + b.depth) * ppf} stroke={st.stroke} strokeWidth={0.5} />);
      }
    });
    cs.aisles.forEach((a, i) =>
      parts.push(<line key={`a${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="6 5" />));
  }
  if (el.type === "trailer") {
    const ts = trailerStalls(el.w, el.h, el.cfg ? { ...settings, ...el.cfg } : settings);
    ts.bands.forEach((b, i) => {
      const bandW = b.n * ts.tw;
      parts.push(<rect key={`tb${i}`} x={tl.x} y={tl.y + b.y * ppf} width={bandW * ppf} height={b.depth * ppf} fill="none" stroke={st.stroke} strokeWidth={0.75} />);
      for (let k = 1; k < b.n; k++)
        parts.push(<line key={`tb${i}d${k}`} x1={tl.x + k * ts.tw * ppf} y1={tl.y + b.y * ppf} x2={tl.x + k * ts.tw * ppf} y2={tl.y + (b.y + b.depth) * ppf} stroke={st.stroke} strokeWidth={0.55} />);
    });
    ts.aisles.forEach((a, i) =>
      parts.push(<line key={`ta${i}`} x1={tl.x} y1={tl.y + (a.y0 + a.y1) / 2 * ppf} x2={tl.x + w} y2={tl.y + (a.y0 + a.y1) / 2 * ppf} stroke={st.stroke} strokeWidth={0.6} strokeDasharray="8 6" />));
  }
  // Derived curbs: thin bands on the terminal / sidewalk-transition edges. Always
  // drawn (their width scales, so a 12" curb visibly doubles a 6" one); the band's
  // stroke keeps it legible when the 0.5′ width is sub-pixel at low zoom.
  curbEdgesOf(el, allEls).forEach((e, i) => {
    const cpx = e.width * ppf;
    const x = e.axis === "x" ? (e.sign > 0 ? tl.x + w : tl.x - cpx) : tl.x;
    const y = e.axis === "y" ? (e.sign > 0 ? tl.y + h : tl.y - cpx) : tl.y;
    const bw = e.axis === "x" ? cpx : w, bh = e.axis === "y" ? cpx : h;
    parts.push(<rect key={`curb${i}`} x={x} y={y} width={bw} height={bh} fill="#aeb4bd" fillOpacity={0.9} stroke={st.stroke} strokeWidth={0.6} />);
  });
  if (el.type === "building" && settings.showDocks && (el.dock || "single") !== "none") {
    const dock = el.dock || "single";
    const side = el.dockSide || (el.w >= el.h ? "bottom" : "right"); // persistent dock side
    const Dpx = Math.min(8, Math.min(el.w, el.h) * 0.25) * ppf; // dock-apron depth
    const sides = dock === "cross"
      ? ((side === "top" || side === "bottom") ? ["bottom", "top"] : ["right", "left"])
      : [side];
    const dogEars = (allEls || []).filter((x) => x.attachedTo === el.id && x.dogEar);
    sides.forEach((s) => {
      const horiz = s === "top" || s === "bottom";
      const L = horiz ? el.w : el.h; // wall length (ft)
      // Don't draw doors where a dog-ear takes up the end of the wall.
      const startF = dogEars.some((d) => d.dogEar.side === s && d.dogEar.sign === -1) ? DOGEAR_W : 0;
      const endF = dogEars.some((d) => d.dogEar.side === s && d.dogEar.sign === 1) ? L - DOGEAR_W : L;
      if (endF - startF < 12) return; // no room for a door
      if (horiz) {
        const by = s === "bottom" ? h - Dpx : 0;
        const ax = tl.x + startF * ppf, aw = (endF - startF) * ppf;
        parts.push(<rect key={`db${s}`} x={ax} y={tl.y + by} width={aw} height={Dpx} fill="#9aa3b0" fillOpacity={0.9} stroke="#5b6470" strokeWidth={1} />);
        for (let f = startF + 12; f < endF - 0.5; f += 12) { const x = tl.x + f * ppf; parts.push(<line key={`db${s}d${f}`} x1={x} y1={tl.y + by} x2={x} y2={tl.y + by + Dpx} stroke="#5b6470" strokeWidth={0.5} />); }
      } else {
        const bx = s === "right" ? w - Dpx : 0;
        const ay = tl.y + startF * ppf, ah = (endF - startF) * ppf;
        parts.push(<rect key={`db${s}`} x={tl.x + bx} y={ay} width={Dpx} height={ah} fill="#9aa3b0" fillOpacity={0.9} stroke="#5b6470" strokeWidth={1} />);
        for (let f = startF + 12; f < endF - 0.5; f += 12) { const y = tl.y + f * ppf; parts.push(<line key={`db${s}d${f}`} x1={tl.x + bx} y1={y} x2={tl.x + bx + Dpx} y2={y} stroke="#5b6470" strokeWidth={0.5} />); }
      }
    });
  }
  if (el.type === "road") { // curb lines inside each long edge; pavement between
    const cp = (el.curb ?? CURB) * ppf;
    if (el.w >= el.h) {
      parts.push(<line key="cu0" x1={tl.x} y1={tl.y + cp} x2={tl.x + w} y2={tl.y + cp} stroke={st.stroke} strokeWidth={1} />);
      parts.push(<line key="cu1" x1={tl.x} y1={tl.y + h - cp} x2={tl.x + w} y2={tl.y + h - cp} stroke={st.stroke} strokeWidth={1} />);
    } else {
      parts.push(<line key="cu0" x1={tl.x + cp} y1={tl.y} x2={tl.x + cp} y2={tl.y + h} stroke={st.stroke} strokeWidth={1} />);
      parts.push(<line key="cu1" x1={tl.x + w - cp} y1={tl.y} x2={tl.x + w - cp} y2={tl.y + h} stroke={st.stroke} strokeWidth={1} />);
    }
  }
  if ((el.type === "building" || el.type === "paving" || el.type === "road") && !el.points && !el.noLabel && dimCalloutVisible(ppf)) {
    // Dimension line along the short side (depth of a building/truck court, width
    // of a drive/road). A road's callout excludes its 6" curbs (true width − 1′).
    // B121 (round 2): this red dimension layer is gated by zoom (dimCalloutVisible) so it
    // hides when zoomed out instead of shrinking onto the centred name labels.
    const k = Math.max(0.34, Math.min(1, ppf / 0.45));
    const fullMin = Math.min(el.w, el.h);
    const dimW = el.type === "road" ? roadTravelWidth(el.w, el.h, el.curb ?? (+settings.roadCurb || CURB)) : fullMin;
    const RED = "#dc2626", tick = 4 * k, fz = 11 * k, txt = `${f0(dimW)}′`;
    const horizLong = el.w >= el.h;
    const ox = (el.dimOffset?.x || 0) * ppf, oy = (el.dimOffset?.y || 0) * ppf; // B146: user reposition (local feet → px)
    const moved = Math.abs(ox) + Math.abs(oy) > 2;
    const dimSel = isSel && tool === "select"; // interactive (drag/edit) only when the element is selected
    const isRoad = el.type === "road";
    const numHandlers = dimSel && isRoad // road number: click to edit width (and don't start a drag)
      ? { style: { cursor: "text" }, onPointerDown: (e) => e.stopPropagation(), onClick: (e) => { e.stopPropagation(); editDimWidth(el.id, e); } }
      : {};
    const dim = [];
    if (horizLong) { // short side is vertical (h)
      const x = tl.x + w * 0.18, y0 = tl.y, y1 = tl.y + h, my = (y0 + y1) / 2;
      if (moved) dim.push(<line key="ld" x1={x} y1={my} x2={x + ox} y2={my + oy} stroke={RED} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.55} />);
      const X = x + ox, Y0 = y0 + oy, Y1 = y1 + oy, MY = my + oy;
      dim.push(<line key="dl" x1={X} y1={Y0} x2={X} y2={Y1} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t0" x1={X - tick} y1={Y0} x2={X + tick} y2={Y0} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t1" x1={X - tick} y1={Y1} x2={X + tick} y2={Y1} stroke={RED} strokeWidth={1.25} />);
      if (dimSel) dim.push(<line key="grab" x1={X} y1={Y0} x2={X} y2={Y1} stroke="transparent" strokeWidth={14} />); // fat invisible grab target
      // number OUTBOARD of the line (away from the centred label) so it doesn't clutter by default
      dim.push(<text key="tx" x={X - 6} y={MY} transform={`rotate(${-el.rot} ${X - 6} ${MY})`} textAnchor="end" fontSize={fz} fontFamily="ui-monospace, Menlo, monospace" fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" dominantBaseline="middle" fontWeight="600" {...numHandlers}>{txt}</text>);
    } else { // short side is horizontal (w)
      const y = tl.y + h * 0.18, x0 = tl.x, x1 = tl.x + w, mx = (x0 + x1) / 2;
      if (moved) dim.push(<line key="ld" x1={mx} y1={y} x2={mx + ox} y2={y + oy} stroke={RED} strokeWidth={0.75} strokeDasharray="3 3" opacity={0.55} />);
      const Y = y + oy, X0 = x0 + ox, X1 = x1 + ox, MX = mx + ox;
      dim.push(<line key="dl" x1={X0} y1={Y} x2={X1} y2={Y} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t0" x1={X0} y1={Y - tick} x2={X0} y2={Y + tick} stroke={RED} strokeWidth={1.25} />);
      dim.push(<line key="t1" x1={X1} y1={Y - tick} x2={X1} y2={Y + tick} stroke={RED} strokeWidth={1.25} />);
      if (dimSel) dim.push(<line key="grab" x1={X0} y1={Y} x2={X1} y2={Y} stroke="transparent" strokeWidth={14} />); // fat invisible grab target
      dim.push(<text key="tx" x={MX} y={Y - 6} transform={`rotate(${-el.rot} ${MX} ${Y - 6})`} textAnchor="middle" fontSize={fz} fontFamily="ui-monospace, Menlo, monospace" fill={RED} stroke="#fff" strokeWidth={2.5} paintOrder="stroke" fontWeight="600" {...numHandlers}>{txt}</text>);
    }
    // When the element is selected the dimension is grab-to-move (the red line/ticks are the handle);
    // otherwise it ignores pointers so a click falls through to select/move the element itself.
    parts.push(
      <g key="dim" style={dimSel ? { cursor: "move" } : { pointerEvents: "none" }}
        onPointerDown={dimSel ? ((e) => { if (e.button === 0) { e.stopPropagation(); startDimMove(e, el.id); } }) : undefined}>
        {dim}
      </g>,
    );
  }
  return <g key={el.id} transform={`rotate(${el.rot} ${c.x} ${c.y})`} filter={st.shadow ? "url(#bldgShadow)" : undefined} style={{ cursor: tool === "select" ? "move" : "crosshair" }}
    onPointerDown={(e) => startMoveEl(e, el.id)} onDoubleClick={(e) => onElDouble && onElDouble(e, el.id)}
    onContextMenu={(e) => { if (onElDouble) { e.preventDefault(); onElDouble(e, el.id); } }}>{parts}</g>;
}

/* ----------------------------- small UI ----------------------------- */
function Section({ title, children, collapsed, accent }) {
  const [open, setOpen] = useState(!collapsed);
  return (
    <div style={{ marginBottom: 9, background: "#fff", border: "1px solid #ece6d9", borderRadius: 12, boxShadow: "0 1px 2px rgba(28,25,20,0.04)", overflow: "hidden" }}>
      <div className="sec-head" onClick={() => setOpen((o) => !o)} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "10px 12px", userSelect: "none" }}>
        {accent && <span style={{ width: 6, height: 6, borderRadius: 99, background: accent, flex: "none" }} />}
        <span className="sec-title" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "#6b6557", flex: 1, transition: "color .12s" }}>{title}</span>
        <span style={{ fontSize: 10.5, color: "#b3aa92", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease", width: 9 }}>▶</span>
      </div>
      {open && <div style={{ padding: "0 12px 12px" }}>{children}</div>}
    </div>
  );
}
function Field({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span style={{ fontSize: 12, color: "#8a8473" }}>{label}</span>{children}
    </div>
  );
}
// A numeric input you can edit freely (clear it, type partial values) — it only
// commits (parse + clamp) on Enter or blur, never live on each keystroke.
function NumInput({ value, onCommit, min, max, style, placeholder }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    editing.current = false;
    const n = parseFloat(draft);
    // Reject NaN AND ±Infinity: parseFloat("1e999")/"Infinity" are NOT NaN, and Math.max(min, Infinity)
    // is Infinity, so a min-clamp can't catch it — a non-finite value poisons geometry to NaN and then
    // persists as null (JSON.stringify(Infinity) === null). The default 1e7 cap also bounds the absurd.
    if (!Number.isFinite(n)) { setDraft(value == null ? "" : String(value)); return; }
    let v = n;
    if (min != null) v = Math.max(min, v);
    v = Math.min(max != null ? max : 1e7, v);
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  return (
    <input style={style} value={draft} placeholder={placeholder} inputMode="decimal"
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); else if (e.key === "Escape") { setDraft(value == null ? "" : String(value)); e.currentTarget.blur(); } }}
    />
  );
}
