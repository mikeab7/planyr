/* Document Review — PDF review core (browser-only). PDF.js viewer + multi-sheet
 * nav, calibrate-to-scale, measure tools (distance / area / perimeter / count),
 * redline (rectangle / cloud / text / line / polyline / polygon / ellipse), and a
 * takeoff rollup. The PDF is an IMMUTABLE backdrop; all markups live on an SVG
 * overlay (an editable layer over it) and are stored in PAGE UNITS so they survive
 * zoom. Lazy-loaded by the shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { loadPdf, renderInto, extractPageItems } from "./lib/pdf.js";
import { ocgLayerList, deriveLayerVisibility } from "./lib/ocg.js";
import { reorderWithinPage, arrangeFlags } from "./lib/arrange.js";
import { backingScale, backdropDensity, visibleRegion, tileCovers } from "./lib/renderBudget.js";
import { readSheetMeta } from "../../shared/files/sheetMeta.js";
import { refineSheetTitles, projectStopTexts } from "../../shared/files/sheetTitleSet.js";
import { groupSheets, markAdjacentDuplicateNumbers } from "../../shared/files/sheetGroups.js";
import { statedCalibration } from "./lib/sheetRead.js";
import { measureLabel, rollup, dist, midOfPath, centroidOf, canCommitMeasure, sanitizeMarkups } from "./lib/takeoff.js";
import { parseFeet } from "./lib/parseLength.js";
import Stitcher from "./Stitcher.jsx";
import ReviewsBar from "./components/ReviewsBar.jsx";
import { useReviewPersistence, docSaveState } from "./lib/usePersistence.js";
import { newReviewId, newSourceId, storeSource, isStoredSource, downloadSource, downloadFromDrive, loadReview, currentUid, readDraft, reconcile, cloudReady, composeTitle } from "./lib/reviewStore.js";
import { writeLastDoc, readLastDoc, readLastDocMap, readLegacyPointers, resolveResume } from "./lib/lastDoc.js";
import { recordOpen } from "../../shared/recents/recentDocs.js";
import { classifySource, sourceUnavailableMessage } from "./lib/sourceState.js";
import { cacheSourceBytes, getSourceBytes } from "./lib/sessionBytes.js";
import { isPdfName } from "../../shared/files/uploadQueue.js";
import { onAuthChange } from "../site-planner/lib/auth.js";
import { listProjects as listLocalProjects } from "../../shared/projects/projects.js";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import ToolRail from "../../shared/ui/ToolRail.jsx";
import AnchoredMenu from "../../shared/ui/AnchoredMenu.jsx";
import { MODULE_ACCENT } from "../../shared/ui/moduleAccent.js";
import { screenToWorld, zoomAround, fitView, shouldPan, midpoint, distance, pinchZoom } from "../../shared/viewport/viewportTransform.js";
import { centerOn } from "../../shared/geometry/pasteGeom.js";
import MarkupRenderer from "../../shared/markup/MarkupRenderer.jsx";
import PropertyPanel from "../../shared/markup/PropertyPanel.jsx";
import { propsForTool, columnMeta, toolById } from "../../shared/markup/tools.matrix.js";
import { writeProp } from "../../shared/markup/propertySchema.js";
import { bboxOfMarkup } from "../../shared/markup/markupModel.js";
import { pickInMarquee, selMods, nextSelection, hasSelMod } from "../../shared/markup/selection.js";
import { pickMarkup } from "../../shared/markup/hitTest.js";
import SelectionChrome from "../../shared/markup/SelectionChrome.jsx";

// Last cross-workspace "open this review" intent already acted on. Module-scoped (not a
// ref) so it survives this lazy workspace unmounting/remounting — otherwise switching back
// in via the module tab would re-fire the previous open on mount. Mirrors SitePlannerApp's
// lastConsumedNavToken. (NEW-1)
let lastConsumedDocToken = null;


// Device pixel ratio (capped use is in renderBudget) — the detail layer renders at this density
// so linework is native-sharp on the visible window regardless of sheet size (B415).
const deviceDpr = () => (typeof window !== "undefined" && window.devicePixelRatio) || 1;

const PAL = { paper: "var(--surface-page)", ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", chrome: "var(--chrome-bg)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)", ember: "var(--accent)" };
const uid = () => "m" + Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const newMeta = () => ({ title: "", projectId: null, project: "", discipline: "", item: "", revision: "", docDate: today() });

const TOOLS = [
  { id: "select",    label: "Select",    hint: "Click a markup to select; drag to move; double-click a text note or callout to edit; Delete removes it." },
  { id: "pan",       label: "Pan",       hint: "Drag to move around the sheet. (Hold Space in any tool to pan; wheel or Ctrl+scroll to zoom toward the cursor.)" },
  { id: "marquee",   label: "Marquee",   hint: "Box-select: drag a box over the sheet — every markup it touches is selected together to move (drag any one) or delete. In Select, Ctrl/⌘-click toggles one, Shift-click adds; Esc / click empty clears." },
  { id: "calibrate", label: "Calibrate", hint: "Click two points a known distance apart, then enter the real length." },
  { id: "distance",   label: "Distance",  hint: "Click two points to measure a distance." },
  { id: "polylength", label: "Length",    hint: "Click a path; double-click / Enter to finish. Measures the total run." },
  { id: "perimeter",  label: "Perimeter", hint: "Click points around a shape; double-click / Enter to close." },
  { id: "area",       label: "Area",      hint: "Click points around a region; double-click / Enter to close." },
  { id: "count",      label: "Count",     hint: "Click each item (stall, dock door); Enter / double-click to finish." },
  { id: "line",      label: "Line",      hint: "Drag end-to-end. Arrow toggles in Properties." },
  { id: "polyline",  label: "Polyline",  hint: "Click points; double-click / Enter to finish an open path." },
  { id: "polygon",   label: "Polygon",   hint: "Click points; click the first dot or double-click to close." },
  { id: "rect",      label: "Rect",      hint: "Drag a box. Hold Shift for a square." },
  { id: "ellipse",   label: "Ellipse",   hint: "Drag a bounding box. Hold Shift for a circle." },
  { id: "cloud",     label: "Cloud",     hint: "Revision cloud: drag a box; the scalloped outline traces it." },
  { id: "text",      label: "Text",      hint: "Click to place a text note." },
  { id: "callout",   label: "Callout",   hint: "Click the pointer target, then click to place the text box." },
  { id: "arc",       label: "Arc",       hint: "Click start, click end, then click a point on the curve to set the bend." },
  { id: "dimension", label: "Dimension", hint: "Drag end-to-end; the calibrated length labels the line with witness ticks." },
  { id: "pen",       label: "Pen",       hint: "Press and draw a freehand path." },
  { id: "highlight", label: "Highlight", hint: "Press and sweep a translucent highlighter over the drawing." },
  { id: "eraser",    label: "Eraser",    hint: "Drag a box to erase Pen / Highlight strokes only — never the engineer's drawing." },
  { id: "snapshot",  label: "Snapshot",  hint: "Drag a region to mark a capture area." },
];
const MEASURE = new Set(["distance", "polylength", "perimeter", "area", "count"]);
// Tools with two-point (click-click or drag) draw mode
const TWOPOINT = new Set(["distance", "calibrate", "rect", "cloud", "line", "ellipse", "dimension"]);
// Tools with multi-point (click-click-dbl) draw mode; arc auto-commits at exactly 3 pts (handled in onDown)
const MULTIPOINT = new Set(["area", "perimeter", "count", "polygon", "polyline", "polylength", "arc"]);
// Freehand tools: pointer-down → move → up records a continuous stroke
const FREEHAND = new Set(["pen", "highlight"]);
// Region tools: drag-to-select a rectangular area
const REGION = new Set(["eraser", "snapshot"]);

// Rail icons for the Markup tools + zoom controls (B330). 16×16, stroke = currentColor so a
// button's text colour drives them; select/pan/rect/text mirror the Site Planner's icon set.
const MK_ICONS = {
  takeoff: <><path d="M2.8 13.2 V9.2 M6.3 13.2 V6.4 M9.8 13.2 V8 M13.3 13.2 V4.4" /><path d="M2 13.9 H14" /></>,
  select: <path d="M4 2.5 L12.8 8 L8.8 9 L11.2 13.6 L9.2 14.6 L6.9 9.9 L4 12.4 Z" fill="currentColor" stroke="none" />,
  pan: <path d="M5 7 V3.6 a1.1 1.1 0 0 1 2.2 0 V6.6 M7.2 6.4 V2.9 a1.1 1.1 0 0 1 2.2 0 V6.6 M9.4 6.6 V3.5 a1.1 1.1 0 0 1 2.2 0 V8.5 M11.6 6 a1.1 1.1 0 0 1 2.1 0 l-0.2 4 a4 4 0 0 1-4 3.6 H8 a4 4 0 0 1-3.3-1.8 L2.6 9.6 a1.1 1.1 0 0 1 1.7-1.4 L5 9" />,
  marquee: <><rect x="2.6" y="2.6" width="10.8" height="10.8" rx="0.6" strokeDasharray="2.4 1.8" /><rect x="1.7" y="1.7" width="1.8" height="1.8" fill="currentColor" stroke="none" /><rect x="12.5" y="1.7" width="1.8" height="1.8" fill="currentColor" stroke="none" /><rect x="1.7" y="12.5" width="1.8" height="1.8" fill="currentColor" stroke="none" /><rect x="12.5" y="12.5" width="1.8" height="1.8" fill="currentColor" stroke="none" /></>,
  calibrate: <><path d="M2.3 10.5 L10.5 2.3 L13.7 5.5 L5.5 13.7 Z" /><path d="M4.9 7.7 l1.5 1.5 M7.3 5.3 l1.5 1.5" /></>,
  distance: <><path d="M3 12.6 L13 3.4" /><circle cx="3" cy="12.6" r="1.5" fill="currentColor" stroke="none" /><circle cx="13" cy="3.4" r="1.5" fill="currentColor" stroke="none" /></>,
  polylength: <><path d="M3 13 L6.5 8 L10.5 11 L13.5 5" /><circle cx="3" cy="13" r="1.3" fill="currentColor" stroke="none" /><circle cx="13.5" cy="5" r="1.3" fill="currentColor" stroke="none" /></>,
  perimeter: <path d="M8 2.6 L13.4 6.2 L11.3 12.6 L4.7 12.6 L2.6 6.2 Z" strokeDasharray="2.4 1.6" />,
  area: <path d="M8 2.6 L13.4 6.2 L11.3 12.6 L4.7 12.6 L2.6 6.2 Z" fill="currentColor" fillOpacity="0.3" />,
  count: <><circle cx="4.7" cy="5.2" r="1.7" fill="currentColor" stroke="none" /><circle cx="10.9" cy="6.1" r="1.7" fill="currentColor" stroke="none" /><circle cx="6.7" cy="11.2" r="1.7" fill="currentColor" stroke="none" /></>,
  line: <path d="M3 13 L13 3" />,
  polyline: <path d="M2.5 13 L6 8 L10 11 L13.5 4" />,
  polygon: <path d="M8 2.5 L14 7 L11.5 13.5 L4.5 13.5 L2 7 Z" />,
  rect: <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />,
  ellipse: <ellipse cx="8" cy="8" rx="5.5" ry="4" />,
  cloud: <path d="M5.2 11.6 a2.3 2.3 0 0 1-.5-4.5 a2.7 2.7 0 0 1 5.1-1 a2.2 2.2 0 0 1 2.6 3.2 a2.1 2.1 0 0 1-1.5 2.9 a2.3 2.3 0 0 1-2.2.9 a2.4 2.4 0 0 1-3-.4 Z" />,
  text: <><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M5.4 6 H10.6 M8 6 V10.6" /></>,
  callout: <><rect x="6" y="2" width="8" height="6" rx="1" /><path d="M6 5 L2 13" /><circle cx="2" cy="13" r="1.3" fill="currentColor" stroke="none" /></>,
  arc:       <path d="M2.5 13 Q 8 1 13.5 13" />,
  dimension: <><path d="M3 8 L13 8" /><path d="M3 5.5 L3 10.5 M13 5.5 L13 10.5" /></>,
  pen:       <path d="M4 13 L4.5 10 L11.5 3 L13.5 4.5 L6.5 12.5 Z M11.5 3 L13.5 4.5" />,
  highlight: <><rect x="5.5" y="2.5" width="5" height="7.5" rx="1" /><path d="M6 10 L8 14 L10 10" /></>,
  eraser:    <><path d="M5 12.5 L9.5 4.5 L13.5 6.5 L9 14.5 Z" /><path d="M2 14.5 L9 14.5" /></>,
  snapshot:  <><rect x="2" y="4.5" width="12" height="9" rx="1.5" /><circle cx="8" cy="9.5" r="2.5" /><path d="M5.5 4.5 L6.5 3 H9.5 L10.5 4.5" /></>,
  zoomIn: <path d="M8 3.4 V12.6 M3.4 8 H12.6" strokeWidth="1.7" />,
  zoomOut: <path d="M3.4 8 H12.6" strokeWidth="1.7" />,
  fitW: <><path d="M2.6 8 H13.4" /><path d="M2.6 8 l2.3 -2.3 M2.6 8 l2.3 2.3 M13.4 8 l-2.3 -2.3 M13.4 8 l-2.3 2.3" /></>,
  fitP: <><rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1" /><rect x="5.4" y="5.8" width="5.2" height="4.4" rx="0.5" opacity="0.55" /></>,
};
// A sheet-rail row's text (B664): the sheet CODE bold — it's how the owner navigates a set —
// the title lighter beside it. Module scope per MODULE-SCOPE-COMPONENTS.
const SheetRowText = ({ code, title }) => (
  <>
    {code ? <span style={{ fontWeight: 700 }}>{code}</span> : null}
    {code && title ? <span style={{ fontWeight: 400 }}>{"  "}</span> : null}
    {title ? <span style={{ fontWeight: 500, color: "var(--text-secondary)" }}>{title}</span> : null}
  </>
);

const MkIcon = ({ id, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {MK_ICONS[id] || <circle cx="8" cy="8" r="5.5" />}
  </svg>
);

function cloudPath(x, y, w, h, r = 9) {
  const edge = (x1, y1, x2, y2) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / (r * 2)));
    const dx = (x2 - x1) / n, dy = (y2 - y1) / n;
    let s = "";
    for (let i = 0; i < n; i++) s += ` A ${r} ${r} 0 0 1 ${x1 + dx * (i + 1)} ${y1 + dy * (i + 1)}`;
    return s;
  };
  return `M ${x} ${y}` + edge(x, y, x + w, y) + edge(x + w, y, x + w, y + h) + edge(x + w, y + h, x, y + h) + edge(x, y + h, x, y) + " Z";
}

export default function DocReview({
  shellModule, onShellSwitch, authControl, accountActive = false, onGoDashboard, onNewProject, docIntent = null,
  // Work Item A — the active project comes from the URL route (so it survives a module
  // switch), not module-local state. `projectId` is the route's Site-group id (null =
  // no project → pick-a-project); `onNavigate` writes the hash to change it; `crossProject`
  // is the all-projects browse mode.
  projectId = null, onNavigate, crossProject = false,
  // Keep-alive: false while this workspace is mounted but hidden behind another tab. The
  // once-bound window key handlers MUST no-op then (a hidden Review eating Delete would
  // silently delete markups), and a PDF that finished loading while hidden re-fits on show.
  isActive = true,
} = {}) {
  const isActiveRef = useRef(isActive); isActiveRef.current = isActive; // live value for once-bound handlers
  const hiddenFitPending = useRef(false); // a fit computed at display:none fallback size → redo on activation
  const wrapRef = useRef(null);
  const backdropRef = useRef(null);     // whole-page floor canvas — always present, no white (B415)
  const detailRef = useRef(null);       // viewport-clipped sharp canvas over the backdrop (B415)
  const pdfRef = useRef(null);
  const fileRef = useRef(null);
  const renderTok = useRef(0);
  const renderTaskRef = useRef(null);   // current DETAIL pdf.js RenderTask, cancellable (B40)
  const backdropTok = useRef(0);
  const backdropTaskRef = useRef(null); // current BACKDROP RenderTask, cancellable (B40)
  const detailTileRef = useRef(null);   // {rx,ry,rw,rh,scale} of the rastered detail tile (coverage check, B415)
  const ocgConfigRef = useRef(null);    // B490: retained OptionalContentConfig — renderInto reads it for PDF-layer visibility
  const layersBtnRef = useRef(null);    // B490: anchor for the Layers popover (portaled — escapes the toolbar row's overflow clip)
  const lastDetailBumpRef = useRef(0);  // B489b: last mid-gesture detail re-raster time (leading-edge throttle)
  // Destroy the previous PDF document before swapping in a new one — frees the worker
  // + retained ArrayBuffer; without this every re-open leaks the prior doc (B39).
  const setPdfDoc = (next) => {
    const prev = pdfRef.current;
    if (prev && prev !== next) { try { prev.destroy(); } catch (_) {} }
    pdfRef.current = next;
    ocgConfigRef.current = null; setOcgLayers([]); setLayersOpen(false); // B490: drop the old doc's layers; readOcg repopulates
  };
  // B490: read a freshly-loaded doc's optional-content (OCG) groups for the Layers panel. Guarded on
  // pdfRef so a superseded load can't attach its layers to whichever doc won the race; a doc with no
  // optional content (the common case) leaves the list empty, so no Layers control shows.
  const readOcg = async (pdf) => {
    try {
      const cfg = await pdf.getOptionalContentConfig();
      if (pdfRef.current !== pdf) return; // a newer doc loaded while we awaited
      ocgConfigRef.current = cfg;
      setOcgLayers(ocgLayerList(cfg));
    } catch (_) { /* older pdf / no OCGs — leave the Layers panel empty */ }
  };
  // B490: show/hide one PDF layer, re-read every row's visibility (a radio-button group flips its
  // siblings), then re-raster BOTH layers against the mutated config. View filter only — never the markups.
  const toggleLayer = (id, visible) => {
    const cfg = ocgConfigRef.current;
    if (!cfg) return;
    cfg.setVisibility(id, visible);
    setOcgLayers((rows) => deriveLayerVisibility(cfg, rows));
    setBackdropReq((n) => n + 1); setDetailReq((n) => n + 1);
  };

  // A fresh (unconsumed) cross-workspace "open this review" request handed down by the Shell
  // when a file is clicked in the GLOBAL Project Files panel (e.g. from the Site side).
  // Captured ONCE at mount (not per-render) so consuming it can't be undone by a later
  // render, and so the resume-last-review boot can reliably stand down for it. (NEW-1)
  const bootDocIntentRef = useRef(undefined);
  if (bootDocIntentRef.current === undefined) {
    bootDocIntentRef.current = (docIntent && docIntent.token !== lastConsumedDocToken && docIntent.kind === "open-review") ? docIntent : null;
  }

  const [mode, setMode] = useState("review"); // review (single sheet) | stitch (multi-sheet)
  const [fileName, setFileName] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  // Viewport transform (B329): ONE shared pan/zoom model with the Site map. `view` is
  // { scale, tx, ty } — pixels per page-unit + the page origin's position in the viewport —
  // so the sheet pans freely in any direction (not trapped inside a scroll box). The bitmaps
  // are decoupled from view.scale (B415): during a gesture the page box CSS-rescales the
  // already-drawn backdrop + detail (cheap, no flash); on settle the detail re-rasterises the
  // visible window crisp. View transform ONLY — it never touches stored markups or calibration.
  const [view, setView] = useState(null);          // { scale, tx, ty } | null until first fit
  const [pageBase, setPageBase] = useState(null);  // { w, h } current page at scale 1
  const [detailTile, setDetailTile] = useState(null); // {rx,ry,rw,rh,scale} placing the sharp detail canvas (B415)
  const [backdropReq, setBackdropReq] = useState(0);  // bump → re-raster the whole-page backdrop (page/load only)
  const [detailReq, setDetailReq] = useState(0);      // bump → re-raster the viewport detail (page/load + settle)
  const [ocgLayers, setOcgLayers] = useState([]);     // B490: PDF optional-content layers [{id,name,visible}] (empty = no Layers control)
  const [layersOpen, setLayersOpen] = useState(false); // B490: Layers popover open?
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState(""); // file name shown in the "Opening…" overlay (B446)
  const [err, setErr] = useState("");

  const [tool, setTool] = useState("select");
  // Bluebeam-style arming: a single click arms a tool for ONE markup (after which it reverts to
  // Select and selects the new markup); double-clicking the rail button LOCKS it for repeated use.
  const [toolLock, setToolLock] = useState(false);
  // Per-tool style overrides (B426): the user's last-set value for each property key becomes
  // the sticky default for the next markup of that tool kind. Stored as canonical keys.
  const [propStyle, setPropStyle] = useState({});
  const [markups, setMarkups] = useState([]);       // all pages; coords in PAGE UNITS
  const [calByPage, setCalByPage] = useState({});   // pageNum -> ftPerUnit
  const [calInfo, setCalInfo] = useState({});       // pageNum -> { src:'auto'|'manual'|'nts', label } (B267)
  const [sheetMeta, setSheetMeta] = useState({});   // pageNum -> readSheetMeta facts (sheet #, title, …) for the labeled, grouped sidebar (B266/B348)
  const [ocrScan, setOcrScan] = useState(null);     // { total, done } while the scanned-sheet OCR pass runs (B364) — visible, never a silent stall
  const [openGroups, setOpenGroups] = useState({}); // groupId -> expanded? in the logical-sheet list (B348)
  const [draft, setDraft] = useState(null);         // in-progress { kind, pts:[...] }
  const [cursor, setCursor] = useState(null);       // page-unit cursor for live preview
  const [sel, setSel] = useState(null);             // PRIMARY selected markup id (property panel / vertex edit)
  const [selSet, setSelSet] = useState([]);         // B569: the full multi-selection (markup ids, current page)
  const [hoverId, setHoverId] = useState(null);     // B156: markup under the cursor in Select mode (pre-click hover preview)
  const [marquee, setMarquee] = useState(null);     // B570: live box-select rubber-band { a, b } in page units
  const marqueeRef = useRef(null);                  // drag bookkeeping for the marquee gesture (no re-render churn)
  const groupDragRef = useRef(null);                // B569: group-move snapshot { ids, start, orig:{id->pts} }
  // Selection helpers keep `sel` (the primary, for the property panel / vertex edit) and `selSet`
  // (the full multi-selection) in lock-step. (B569)
  const clearSelection = () => { setSel(null); setSelSet([]); };
  const selectOne = (id) => { setSel(id || null); setSelSet(id ? [id] : []); };
  // Apply Ctrl/⌘-click (toggle) or Shift-click (add) to the set; the clicked id becomes primary.
  // An empty set seeds from the current single selection so click-A then Ctrl-click-B gives {A,B}.
  const applySelMods = (id, mods) => {
    setSelSet((s) => nextSelection(s.length ? s : (sel ? [sel] : []), id, mods));
    setSel(id);
  };
  const [fitMode, setFitMode] = useState("width");  // 'width' | 'page' — how a fit (scale===0) is computed (B295)
  const [spaceHeld, setSpaceHeld] = useState(false); // hold-Space = temporary pan in any tool (B289/B329)
  const [panning, setPanning] = useState(false);    // a pan drag is in progress (grab/grabbing cursor)
  const [dragPreview, setDragPreview] = useState(null); // live { id, pts } while dragging a markup (B293)
  const [groupPreview, setGroupPreview] = useState(null); // B569: live { id -> pts } while dragging a multi-selection
  const [vtxPreview, setVtxPreview] = useState(null);  // live { id, pts } during vertex-grip drag (B431)
  const [editing, setEditing] = useState(null);     // inline text editor { id|null, page, pt, text } (B293)
  const [calInput, setCalInput] = useState(null);   // inline Calibrate entry { pts:[pageUnits], x, y (screen px), value } (B304 — no window.prompt)
  const [ctxMenu, setCtxMenu] = useState(null);     // right-click Arrange menu { x, y (client px), id } | null (B421)
  const [loadNonce, setLoadNonce] = useState(0);    // bump to force a fresh fit on open / reset / load (B329)
  const viewRef = useRef(view); viewRef.current = view; // live view for the once-bound wheel handler
  const pageRef = useRef(page); pageRef.current = page; // live page for the ref-driven render callbacks (B415)
  const [renderedPage, setRenderedPage] = useState(0);  // the page whose BACKDROP is actually on the canvas — a sheet switch dims + labels the stale frame until the new one lands (B660)
  const pageBaseRef = useRef(pageBase); pageBaseRef.current = pageBase;
  const panRef = useRef(null);        // active pan drag { sx, sy, tx0, ty0 } (B329)
  const pointersRef = useRef(new Map()); // live touch pointers → viewport-relative {x,y} (B331)
  const pinchRef = useRef(null);         // active two-finger pinch { mid, dist } (B331)
  const touchPinchedRef = useRef(false); // a pinch occurred this touch sequence → suppress the tap on lift (B331)
  const dragRef = useRef(null);       // active markup move { id, start, orig, moved } (B293)
  const vtxDragRef = useRef(null);    // active vertex drag { id, idx, start, origPts } (B431)
  const editDoneRef = useRef(false);  // guard so a commit + the unmount blur don't double-fire (B293)

  // --- cloud persistence (single-sheet review) ---
  const [reviewId, setReviewId] = useState(() => newReviewId());
  const [meta, setMeta] = useState(() => newMeta()); // { title, projectId, project, discipline, item, revision, docDate }
  // Snapshot the stored "last doc" pointers at FIRST RENDER, before any effect below can
  // touch them. The mount-time pointer writes used to overwrite lastSingleId/lastMode with
  // this session's fresh blank id/mode BEFORE the resume effect read them back — so resume
  // loaded a review that was never saved and fell to the empty state ("starts from nothing"
  // on every reload). Resume now reads this capture; writes stay silent until boot resolves.
  const bootPointers = useRef(null);
  if (bootPointers.current === null) bootPointers.current = { legacy: readLegacyPointers(), map: readLastDocMap() };
  const [bootResolved, setBootResolved] = useState(false); // pointer writes arm only after the boot resume settled
  const [source, setSource] = useState(null);     // { srcId, name, size, storageKey, oversize }
  const [redrop, setRedrop] = useState("");        // "re-drop on load" banner when bytes aren't available
  const [openErr, setOpenErr] = useState("");      // visible banner when an open no-ops / loadReview returns null (NEW-1) — so it can't fail silently
  const [signedIn, setSignedIn] = useState(false);
  // Takeoff is a TOOL-RAIL TOGGLE, hidden by default (owner, B664 — "why is takeoff a separate
  // section, it should be one of the tools"); the choice persists per device.
  const [takeoffOpen, setTakeoffOpen] = useState(() => { try { return localStorage.getItem("planarfit:takeoffOpen") === "1"; } catch (_) { return false; } });
  useEffect(() => { try { localStorage.setItem("planarfit:takeoffOpen", takeoffOpen ? "1" : "0"); } catch (_) { /* private mode */ } }, [takeoffOpen]);
  // Sheet rail: user-resizable (drag the right edge) + collapsible to a slim strip (owner, B664
  // — "I should be able to expand and slim the left menu"); both persist per device.
  const [railW, setRailW] = useState(() => { try { const v = +localStorage.getItem("planarfit:reviewRailW"); return v >= 160 && v <= 460 ? v : 224; } catch (_) { return 224; } });
  const [railHidden, setRailHidden] = useState(() => { try { return localStorage.getItem("planarfit:reviewRailHidden") === "1"; } catch (_) { return false; } });
  useEffect(() => { try { localStorage.setItem("planarfit:reviewRailW", String(railW)); localStorage.setItem("planarfit:reviewRailHidden", railHidden ? "1" : "0"); } catch (_) { /* private mode */ } }, [railW, railHidden]);
  const startRailResize = (e) => {
    e.preventDefault();
    const startX = e.clientX, startW = railW;
    const move = (ev) => setRailW(Math.max(160, Math.min(460, startW + ev.clientX - startX)));
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  // The project the header breadcrumb points at in Markup now comes from the URL route
  // (Work Item A) — so it survives a module switch instead of resetting to "Select a
  // project". Picking another project navigates the hash; opening a review navigates to
  // that review's project (below). Its display name resolves from the local site list
  // (instant; the per-user cloud cache feeds it), falling back to the open review's own
  // project label, then the id. { id, name } | null.
  const markupProject = useMemo(() => {
    if (!projectId) return null;
    let name = "";
    try { const p = listLocalProjects().find((pp) => pp.id === projectId); if (p) name = p.name; } catch (_) {}
    if (!name && meta.projectId === projectId && meta.project) name = meta.project;
    return { id: projectId, name: name || "Project" };
  }, [projectId, meta.projectId, meta.project]);
  const [pendingStitch, setPendingStitch] = useState(null); // a stitch review handed to <Stitcher> to load
  const sourceRef = useRef(null);                  // { srcId, name } for re-drop matching after load
  const activeSheetRef = useRef(null);             // current sheet button — kept scrolled into view (B306)

  const ftPerUnit = calByPage[page] || 0;
  const pageMarks = markups.filter((m) => m.page === page);
  // B569 safety net: keep the multi-selection referencing only markups that still exist on the
  // current page, so a delete (via any path) or a page change can never leave a dangling id.
  useEffect(() => {
    const onPage = (id) => markups.some((m) => m.id === id && m.page === page);
    setSelSet((s) => { const f = s.filter(onPage); return f.length === s.length ? s : f; });
    setSel((id) => (id && onPage(id) ? id : null));
  }, [markups, page]);

  /* ---- undo / redo (B303) ----
   * Snapshots of the editable doc state (markups + per-sheet calibration), by reference,
   * mirroring the Site Planner's pushHistory pattern. pushHistory() is called BEFORE a real
   * mutation (add/delete/move a markup, edit a text note, apply a hand calibration); undo()
   * skips frames identical to the current state via histKey so a stray push can't make Ctrl-Z
   * look like a no-op (B32/B105). The background auto-scale scan (B267) never pushes. */
  const docStateRef = useRef({ markups: [], calByPage: {}, calInfo: {} });
  useEffect(() => { docStateRef.current = { markups, calByPage, calInfo }; });
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const colorSessionRef = useRef(null); // active live color-pick key, so the burst is one undo frame (B567)
  const [, bumpHist] = useState(0);
  const touchHist = () => bumpHist((n) => n + 1);
  const histKey = (s) => JSON.stringify({ m: s.markups, c: s.calByPage, i: s.calInfo });
  const pushHistory = () => {
    pastRef.current.push(docStateRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    touchHist();
  };
  const clearHistory = () => { pastRef.current = []; futureRef.current = []; touchHist(); };
  const applySnapshot = (s) => {
    setMarkups(s.markups || []); setCalByPage(s.calByPage || {}); setCalInfo(s.calInfo || {});
    setDraft(null); clearSelection(); setCalInput(null); setDragPreview(null); setEditing(null);
  };
  const undo = () => {
    let prev = null;
    while (pastRef.current.length) {
      const cand = pastRef.current.pop();
      if (histKey(cand) !== histKey(docStateRef.current)) { prev = cand; break; }
    }
    if (!prev) return;
    futureRef.current.push(docStateRef.current);
    applySnapshot(prev);
    touchHist();
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(docStateRef.current);
    applySnapshot(next);
    touchHist();
  };
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  // Mid-draw: step back the last placed vertex of a poly/count draft (B303 "poly-vertex
  // placement"). Returns true if it consumed something so Ctrl-Z / Backspace fall through to
  // full undo / delete-selection only when there's no draft to trim.
  const removeLastVertex = () => {
    if (!draft || !draft.pts || draft.pts.length === 0) return false;
    setDraft((d) => { if (!d) return d; const pts = d.pts.slice(0, -1); return pts.length ? { ...d, pts } : null; });
    return true;
  };
  // Navigate sheets (Prev/Next + keyboard, B306). Keeps the current zoom (matching the sheet
  // list's click behaviour) and drops any in-progress draft/selection/inline entry.
  const goToPage = (n) => {
    const t = Math.max(1, Math.min(numPages || 1, n));
    if (t === page) return;
    setPage(t); setDraft(null); clearSelection(); setMarquee(null); marqueeRef.current = null; setCalInput(null); setDragPreview(null);
  };

  /* ---- load ---- */
  const sameName = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

  // Read each sheet's metadata in the background (B348): sheet #, title, discipline, stated scale —
  // via the SAME shared reader the Stitcher uses (sheetMeta.readSheetMeta), so the single-sheet
  // sidebar can show real labels + collapse into logical sheets instead of "Sheet N" (B266). Also
  // pre-fills the per-sheet stated-scale calibration (B267) via the shared statedCalibration (which
  // gates on a standard plot size), never overwriting a user/loaded cal. Superseded if another file opens.
  //
  // SCANNED pages (B364): a page with no text layer reads hasText:false. After the text pass, the
  // no-text pages go through the SAME shared OCR runner the Stitcher (B352) and the filing path
  // (B411a) use — lazy (the Tesseract worker spins up only if a scanned page actually exists),
  // capped like the filing read, token-guarded, and every recovered page re-enters the identical
  // meta/calibration pipeline, so a scanned set gets real rail labels instead of "Sheet N". A page
  // OCR can't read stays an honest no-text record — never a guess. `ocrScan` drives the visible
  // "reading scanned sheets…" note (a silent multi-second stall would read as a hang).
  const RAIL_MAX_OCR_PAGES = 24; // matches localRead's filing cap — OCR is heavy; the rest stay "Sheet N"
  const scanTok = useRef(0);
  const scanSheets = useCallback(async (pdf, pages) => {
    const tok = ++scanTok.current;
    const applyMeta = (p, meta) => {
      setSheetMeta((m) => ({ ...m, [p]: meta }));
      const sc = meta.scale;
      if (sc && sc.explicit === "nts") { setCalInfo((m) => (m[p] ? m : { ...m, [p]: { src: "nts", label: sc.label } })); return; }
      const ft = statedCalibration(meta); // 0 unless a trustworthy stated scale on a standard plot size
      if (ft) {
        setCalByPage((c) => (c[p] ? c : { ...c, [p]: ft }));
        setCalInfo((m) => (m[p] ? m : { ...m, [p]: { src: "auto", label: (sc && sc.label) || "" } }));
      }
    };
    // Scan ORDER (B664 speed): the sheet on screen first, then its neighbors outward — the label
    // you're looking at fills in immediately instead of after a front-to-back sweep of a 50-page
    // set. A macrotask yield between pages keeps the main thread responsive while the rail fills.
    const start = Math.max(1, Math.min(pages, pageRef.current || 1));
    const order = [start];
    for (let d = 1; order.length < pages; d++) {
      if (start + d <= pages) order.push(start + d);
      if (start - d >= 1) order.push(start - d);
    }
    const noText = [];
    for (const p of order) {
      if (tok !== scanTok.current) return;             // a newer open superseded this scan
      const page = await extractPageItems(pdf, p);
      if (tok !== scanTok.current) return;
      const meta = { ...readSheetMeta(page), width: page.width, height: page.height };
      if (!meta.hasText) noText.push(p);
      applyMeta(p, meta);
      await new Promise((r) => setTimeout(r, 0));      // yield — never a long main-thread hog
    }
    noText.sort((a, b) => a - b);
    if (!noText.length || tok !== scanTok.current) return;
    // OCR pass — only now does the (lazy, CDN-pinned) Tesseract worker load. Best-effort: any
    // failure leaves the page as its no-text record and the note clears; never blocks the viewer.
    const capped = noText.slice(0, RAIL_MAX_OCR_PAGES);
    setOcrScan({ total: capped.length, done: 0 });
    let runner = null, recovered = 0;
    try {
      const { createOcrRunner } = await import("./lib/ocr.js");
      runner = createOcrRunner();
      for (const p of capped) {
        if (tok !== scanTok.current) return;
        let o = null;
        try { o = await runner.run(pdf, p); } catch (_) { o = null; }
        if (tok !== scanTok.current) return;
        if (o && (o.items || []).length) { recovered++; applyMeta(p, { ...readSheetMeta(o), ocr: true, width: o.width, height: o.height }); }
        setOcrScan((s) => (s ? { ...s, done: s.done + 1 } : s));
      }
    } catch (_) { /* import/worker init failure — handled by the recovered===0 note below */ }
    finally {
      if (runner) { try { runner.dispose(); } catch (_) { /* best-effort */ } }
      // LOUD-FAILURE: the runner fails soft per page (null), so a dead engine (offline CDN,
      // worker blocked) looks like "no page recovered". Say so instead of silently leaving
      // every label "Sheet N" — the user should know recognition didn't run, not wonder.
      if (tok === scanTok.current) setOcrScan(recovered === 0 ? { total: capped.length, done: capped.length, failed: true } : null);
    }
  }, []);

  // Logical sheets (B348): collapse the read pages into the SAME logical groups the Stitcher uses —
  // consecutive pages sharing a plan type + a contiguous sheet-number run become one entry
  // ("Grading Plan · C-5–C-9 · 5 sheets"); cover/notes/one-offs stay standalone. Each group's pages
  // carry pageNum so the sidebar maps a logical entry back to real sheets. Recomputes as the read fills in.
  // The read pages in order, with duplicate adjacent sheet numbers cleared (cross-reference
  // misreads — B378). This ONE cleaned array feeds both the grouping and every per-page label
  // lookup, so the sidebar never shows the same wrong number on several rows. `metaOf(n)` reads it.
  // Known project names/aliases — CERTAIN not-a-sheet-title texts for the set-level title pass
  // (B659). Recomputed per document open (fileName changes on open), not per scanned page —
  // listLocalProjects reads the on-device store, too heavy to run on every rail render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const titleStops = useMemo(() => { try { return projectStopTexts(listLocalProjects()); } catch (_) { return []; } }, [fileName]);
  const orderedMeta = useMemo(
    () => refineSheetTitles(
      markAdjacentDuplicateNumbers(Array.from({ length: numPages }, (_, i) => ({ pageNum: i + 1, ...(sheetMeta[i + 1] || {}) }))),
      { stopTexts: titleStops }
    ),
    [sheetMeta, numPages, titleStops]
  );
  const metaOf = (n) => orderedMeta[n - 1] || sheetMeta[n] || null;
  const groups = useMemo(() => groupSheets(orderedMeta), [orderedMeta]);

  const openFile = async (file) => {
    // A null/no-op drop must not be silent (B446): name it on the always-visible banner so
    // "nothing happened" is never mistaken for a crash ("silence is a crash").
    if (!file) { setOpenErr("No file was received from that drop. Try the Open PDF… button, or drop a single .pdf."); return; }
    // Validate before buffering the whole file into memory (a non-PDF / 0-byte / huge
    // file would otherwise be read via arrayBuffer() and only then fail). Surface the reject on
    // BOTH the inline empty-state hint (err) AND the top banner (openErr) so it shows whether or
    // not a document is already open (B446 — the drop-over-open path renders no empty state).
    if (!file.size || !(/\.pdf$/i.test(file.name) || file.type === "application/pdf")) {
      const msg = `“${file.name || "that file"}” isn’t a PDF we can open — drop a .pdf file.`;
      setErr(msg); setOpenErr(msg); return;
    }
    setBusy(true); setBusyLabel(file.name || "PDF"); setErr(""); setOpenErr(""); // opening a PDF → show the review canvas, with a clear "Opening…" overlay
    try {
      const pdf = await loadPdf(file);
      setPdfDoc(pdf);
      readOcg(pdf); // B490: populate the Layers panel from the new doc's optional content
      setFileName(file.name || "document.pdf");
      setNumPages(pdf.numPages);
      setPage(1);
      setView(null); setPageBase(null); detailTileRef.current = null; setDetailTile(null); setLoadNonce((n) => n + 1); // fit the new backdrop (B329)
      setRedrop(""); setCalInput(null); clearHistory(); // a new backdrop starts a fresh undo timeline (B303)
      // A genuinely DIFFERENT document replaces the backdrop — drop the previous sheet's
      // calibrations so they can't bleed onto the new (differently-paginated) file. A re-drop
      // of the SAME file keeps them (its saved/auto cals still apply). (B267)
      const reuse = sourceRef.current && sameName(sourceRef.current.name, file.name);
      if (!reuse) { setCalByPage({}); setCalInfo({}); }
      setSheetMeta({}); setOpenGroups({}); // re-read the new backdrop's sheets (B266/B348)
      scanSheets(pdf, pdf.numPages); // background sheet-metadata read (labels + grouping) + B267 auto-calibration
      // Source bookkeeping: reuse the srcId when this is a re-drop of the review's
      // known file (so its markups stay bound); otherwise mint one and upload once.
      const keepId = reuse ? sourceRef.current.srcId : null;
      const srcId = keepId || newSourceId();
      const base = { srcId, name: file.name || "document.pdf", size: file.size };
      sourceRef.current = base;
      cacheSourceBytes(srcId, file); // B448: keep the dropped bytes so a switch/reload mid-upload never loses the backdrop
      setSource({ ...base, storageKey: null, driveKey: null, oversize: false });
      // Store Drive-first, Supabase-fallback (B322). The source stays keyless in state until
      // this resolves, and buildSnapshot won't persist a keyless source, so a quick reload
      // mid-upload can't strand the backdrop with an unfetchable pointer (B323).
      storeSource(srcId, file, { projectId: meta.projectId, discipline: meta.discipline, fileName: file.name }).then(async (r) => {
        setSource((s) => (s && s.srcId === srcId ? { ...s, storageKey: r.storageKey || null, driveKey: r.driveKey || null, oversize: !!r.oversize } : s));
        // B579: a GENUINE store failure (BOTH Drive and Supabase rejected it — not merely `oversize`, which
        // still saves the work layer and flags the file "re-drop on load") leaves the source permanently
        // keyless, so buildSnapshot persists sources:[] and the markups reload with NO backdrop. That used
        // to be silent. Surface it — but only when signed in (logged-out is by-design local-only: the bytes
        // are cached via cacheSourceBytes and the work layer still mirrors locally, so no cloud store is owed).
        if (!r.ok && !r.oversize && (await cloudReady())) {
          const m = "Couldn't save this PDF to the cloud — your markups might open without their drawing next time. Check your connection and drop the file again.";
          setErr(m); setOpenErr(m);
        }
      }).catch(() => {}); // best-effort store; a rejection mustn't become an unhandled rejection
    } catch (e) {
      // A read failure must surface on the always-visible banner too (the canvas may already show
      // the prior doc, where the inline `err` hint never renders). (B446)
      const msg = "Couldn't open that PDF. Make sure it's a valid PDF file.";
      setErr(msg); setOpenErr(msg);
    } finally { setBusy(false); setBusyLabel(""); }
  };

  /* ---- prepare page + fit (B329) ---- */
  const VIEW_MIN = 0.05, VIEW_MAX = 10; // px-per-page-unit clamp for the viewport (10 lets you read
  // the finest survey bearing/distance call-outs & tiny dimension text; the detail layer still
  // rasterises the small visible window at full density, so the deeper zoom stays sharp + in-budget)
  // When the page or a load changes: refresh the page's base (scale-1) size, and — only on a
  // fresh open/reset/load (view === null) — fit the sheet to the viewport. Switching sheets
  // keeps the current zoom/pan (B292): view stays non-null, so we only update pageBase.
  useEffect(() => {
    const pdf = pdfRef.current;
    if (!pdf) return;
    let live = true;
    (async () => {
      const p = await pdf.getPage(page);
      const base = p.getViewport({ scale: 1 });
      if (!live) return;
      setPageBase({ w: base.width, h: base.height });
      pageBaseRef.current = { w: base.width, h: base.height }; // sync now so the req effects below read the new size
      detailTileRef.current = null; setDetailTile(null);       // a new page/size invalidates the old detail tile
      if (!viewRef.current) {
        const wrap = wrapRef.current;
        const vw = wrap?.clientWidth || 900, vh = wrap?.clientHeight || 600;
        // Keep-alive: while hidden (display:none), clientWidth reads 0 and the fit lands on
        // the 900×600 fallback — flag it so activation re-fits at the real viewport size.
        if (!isActiveRef.current) hiddenFitPending.current = true;
        setView(fitView(base.width, base.height, vw, vh, { pad: 12, min: VIEW_MIN, max: VIEW_MAX, mode: fitMode }));
      }
      setBackdropReq((n) => n + 1); setDetailReq((n) => n + 1); // raster both layers for the new page/size
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, numPages, loadNonce]);

  // Re-raster the sharp DETAIL layer once a pan/zoom gesture settles (debounced). The backdrop
  // never re-rasters on zoom, so during the gesture the page box just CSS-rescales the existing
  // bitmaps (cheap, no flash); on settle we redraw only the visible window at full density. The
  // tileCovers check inside renderDetail makes a settle that didn't move the window a no-op. (B415)
  useEffect(() => {
    if (!view) return;
    // B489b: leading-edge throttle — re-raster the crisp detail window DURING a continuous pan/zoom
    // (not only on settle), at most once per ~140ms, so a long drag stays sharp near its leading edge.
    // Skipped during a pinch (touch GPUs are weakest and scale changes every frame → tileCovers never
    // covers → every tick would raster). Self-limiting: renderDetail's tileCovers guard no-ops a bump
    // while the tile still covers, and a superseded render is cancelled — so ticks can't pile up.
    if (!pinchRef.current) {
      const now = performance.now();
      if (now - lastDetailBumpRef.current >= 140) { lastDetailBumpRef.current = now; setDetailReq((n) => n + 1); }
    }
    const id = setTimeout(() => { lastDetailBumpRef.current = performance.now(); setDetailReq((n) => n + 1); }, 90); // trailing settle: sharp
    // detail re-appears almost immediately after a pan/zoom stops (the soft CSS-scaled backdrop shows for less time)
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view && view.scale, view && view.tx, view && view.ty]);

  // BACKDROP — the whole page at a fixed, zoom-independent density, rendered once per page (never
  // on zoom), double-buffered so a page change swaps with no white flash. Always present under the
  // detail layer as a no-white floor. Reads live refs so its identity stays stable. (B414/B415)
  const renderBackdrop = useCallback(async () => {
    const pdf = pdfRef.current, canvas = backdropRef.current, base = pageBaseRef.current;
    if (!pdf || !canvas || !base) return;
    const tok = ++backdropTok.current;
    if (backdropTaskRef.current) { try { backdropTaskRef.current.cancel(); } catch (_) {} backdropTaskRef.current = null; }
    try {
      await renderInto(pdf, pageRef.current, canvas, {
        scale: 1, density: backdropDensity(base.w, base.h, deviceDpr()), optionalContentConfig: ocgConfigRef.current,
        onTask: (t) => { backdropTaskRef.current = t; }, isStale: () => tok !== backdropTok.current });
      // The canvas now shows THIS page — clears the sheet-switch dim/label (B660). A superseded
      // render (tok moved on) never claims it.
      if (tok === backdropTok.current) setRenderedPage(pageRef.current);
    } catch (e) { if (!(e && e.name === "RenderingCancelledException")) { /* keep the prior frame */ } }
  }, []);

  // DETAIL — only the visible window (+ margin) at full device density, re-rastered on settle and
  // double-buffered. tileCovers skips the work when the existing tile still covers the view; the
  // budget is spent on the REGION (not the whole sheet), so density stays native when zoomed in. (B415)
  const renderDetail = useCallback(async () => {
    const pdf = pdfRef.current, canvas = detailRef.current, wrap = wrapRef.current;
    const v = viewRef.current, base = pageBaseRef.current;
    if (!pdf || !canvas || !wrap || !v || !base) return;
    const reg = visibleRegion(v, base, wrap.clientWidth, wrap.clientHeight);
    if (!reg) return;
    if (tileCovers(detailTileRef.current, reg.visible, v.scale)) return; // already sharp here
    const tok = ++renderTok.current;
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (_) {} renderTaskRef.current = null; }
    try {
      const density = backingScale(reg.rect.rw, reg.rect.rh, v.scale, deviceDpr());
      const d = await renderInto(pdf, pageRef.current, canvas, {
        scale: v.scale, density, region: reg.rect, optionalContentConfig: ocgConfigRef.current,
        onTask: (t) => { renderTaskRef.current = t; }, isStale: () => tok !== renderTok.current });
      if (!d || tok !== renderTok.current) return; // superseded mid-render (B40), or a newer render won
      const tile = { ...d.region, scale: v.scale }; // B489a: place the tile on the DEVICE-ROUNDED region → seam-free vs the backdrop
      detailTileRef.current = tile; setDetailTile(tile);
    } catch (e) { if (!(e && e.name === "RenderingCancelledException")) { /* keep the prior frame */ } }
  }, []);

  useEffect(() => { renderBackdrop(); }, [renderBackdrop, backdropReq]);
  useEffect(() => { renderDetail(); }, [renderDetail, detailReq]);

  // Keep the current sheet scrolled into view in the (long) sheet list as you page (B306).
  useEffect(() => { activeSheetRef.current?.scrollIntoView({ block: "nearest" }); }, [page]);

  // Free PDF.js resources on unmount: cancel any in-flight render + destroy the doc (B39/B40).
  useEffect(() => () => {
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (_) {} }
    if (backdropTaskRef.current) { try { backdropTaskRef.current.cancel(); } catch (_) {} }
    try { pdfRef.current && pdfRef.current.destroy(); } catch (_) {}
  }, []);

  /* ---- zoom/pan viewport — the shared engine (B329) ---- */
  // Zoom about a screen anchor (the cursor for wheel/pinch; the viewport centre for ± / null).
  // zoomAround holds the page point under the anchor fixed; the bitmap rescales now, re-rasters
  // on settle. Reads the live view from the ref so the once-bound wheel handler isn't stale.
  const doZoom = (factor, clientX, clientY) => {
    const wrap = wrapRef.current, v = viewRef.current;
    if (!wrap || !v) return;
    const r = wrap.getBoundingClientRect();
    const ax = clientX == null ? r.width / 2 : clientX - r.left;
    const ay = clientY == null ? r.height / 2 : clientY - r.top;
    setView(zoomAround(v, factor, ax, ay, VIEW_MIN, VIEW_MAX));
  };
  // Fit the current sheet to the viewport (Fit = width, Fit page = the whole sheet). (B295/B329)
  const fitNow = (mode) => {
    setFitMode(mode);
    const base = pageBase, wrap = wrapRef.current;
    if (!base || !wrap) { setView(null); setLoadNonce((n) => n + 1); return; } // no page yet → prepare effect fits
    const vw = wrap.clientWidth || 900, vh = wrap.clientHeight || 600;
    const nv = fitView(base.w, base.h, vw, vh, { pad: 12, min: VIEW_MIN, max: VIEW_MAX, mode });
    setView(nv); setDetailReq((n) => n + 1); // re-raster the detail at the new fit (backdrop is zoom-independent)
  };
  // Keep-alive: a PDF that finished loading while this tab was HIDDEN fitted to the 900×600
  // fallback (display:none ⇒ clientWidth 0). Re-fit once on activation, at the real size.
  useEffect(() => {
    if (isActive && hiddenFitPending.current) { hiddenFitPending.current = false; fitNow(fitMode); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);
  // Bind a NON-passive wheel listener via a callback ref so preventDefault works (a React
  // onWheel is registered passive at the root and can't stop the page from scrolling/zooming)
  // and so it attaches exactly when the viewport mounts. Plain wheel, Ctrl/Cmd+wheel, and
  // trackpad pinch all arrive here as wheel events and all zoom toward the cursor. (B329)
  const wheelCleanup = useRef(null);
  const attachWrap = useCallback((node) => {
    if (wheelCleanup.current) { wheelCleanup.current(); wheelCleanup.current = null; }
    wrapRef.current = node;
    if (node) {
      const onWheel = (e) => { e.preventDefault(); doZoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
      node.addEventListener("wheel", onWheel, { passive: false });
      wheelCleanup.current = () => node.removeEventListener("wheel", onWheel);
    }
  }, []);

  /* ---- cloud persistence: badge, autosave, resume, load, new ---- */
  useEffect(() => {
    let live = true;
    const r = () => cloudReady().then((v) => live && setSignedIn(v));
    r();
    const off = onAuthChange(r);
    return () => { live = false; off && off(); };
  }, []);
  const onMeta = (k, v) => setMeta((m) => ({ ...m, [k]: v }));

  const buildSnapshot = useCallback(() => ({
    id: reviewId, kind: "single", updatedAt: Date.now(), // stamp so the local mirror + cloud data carry a consistent updatedAt (reconcile)
    title: (meta.title || "").trim() || composeTitle(meta),
    project: meta.project, projectId: meta.projectId, discipline: meta.discipline,
    item: meta.item, revision: meta.revision, docDate: meta.docDate,
    sources: isStoredSource(source) ? [{ srcId: source.srcId, name: source.name, size: source.size || 0, storageKey: source.storageKey || null, driveKey: source.driveKey || null, oversize: !!source.oversize }] : [],
    single: { srcId: source?.srcId || null, fileName, numPages, page, markups, calByPage, calInfo },
  }), [reviewId, meta, source, fileName, numPages, page, markups, calByPage, calInfo]);
  const isEmpty = useCallback(() => !source && markups.length === 0, [source, markups]);
  // `page`/`scale`/`numPages` ride along in the snapshot but aren't save triggers, so
  // flipping through sheets doesn't spam writes — the next real edit (or flush) saves them.
  const { status, suspendSave, saveNow } = useReviewPersistence({
    buildSnapshot, isEmpty, enabled: mode === "review",
    deps: [reviewId, meta, source, markups, calByPage, calInfo],
  });

  // Remember the active review so a refresh resumes it (cloud reconciled with the
  // synchronous local mirror, so an edit made just before reload isn't lost). Two layers:
  // the legacy GLOBAL pointers (kept as the resume fallback for existing devices) and the
  // per-PROJECT map (each project reopens ITS last drawing). Both stay silent until boot
  // resolved — writing on mount is what used to clobber the pointers before resume read them.
  useEffect(() => {
    if (!bootResolved) return;
    // Never record a non-PDF as the resume/last-doc target (B686): the markup canvas can't render
    // it, so resuming it would just re-trigger a download the user didn't ask for on load. Leaving
    // the previous PDF as last-doc is the right resume. (setReviewId + setSource are batched in
    // loadSingleReview, so this effect sees both together — no stale-source window.)
    if (source && source.name && !isPdfName(source.name)) return;
    try { localStorage.setItem("planyr:docreview:lastSingleId", reviewId); } catch (_) {}
    if (mode === "review") writeLastDoc(meta.projectId, { id: reviewId, mode: "review" });
  }, [bootResolved, reviewId, meta.projectId, mode, source]);
  useEffect(() => {
    if (!bootResolved) return;
    try { localStorage.setItem("planyr:docreview:lastMode", mode); } catch (_) {}
  }, [bootResolved, mode]);

  const loadTok = useRef(0); // a newer open supersedes an in-flight single-review load (B52)
  const openInFlightRef = useRef(false); // an openReview is running — the project-switch resume must stand down
  const fetchSourceBytes = async (src, tok) => {
    const superseded = () => tok != null && tok !== loadTok.current; // a newer open won
    if (superseded()) return; // superseded before fetching
    // B448: the bytes dropped this session win over everything — even if the source is still
    // keyless because its upload is mid-flight, the backdrop stays viewable. A File re-reads
    // cleanly (unlike a worker-transferred ArrayBuffer), so this never strands a blank canvas.
    let blob = src && src.srcId ? getSourceBytes(src.srcId) : null;
    if (!blob) {
      // Name the PRECISE cause, never a silent return or a one-size "Couldn't fetch" (B405).
      // Pre-download states: no source / never-stored / oversize / signed-out all surface here.
      const pre = classifySource(src, { signedIn });
      if (pre) { setRedrop(sourceUnavailableMessage(pre, { name: src?.name })); return; }
      // Read-back: prefer Google Drive (the file's home), fall back to Supabase Storage so a
      // pre-Drive file — or any Drive miss — still opens. (B207 read-back, fallback-safe.)
      let buf = src.driveKey ? await downloadFromDrive(src.driveKey) : null;
      if (superseded()) return; // superseded while downloading
      if (!buf && src.storageKey) buf = await downloadSource(src.storageKey);
      if (superseded()) return; // a newer review opened while downloading
      // The file IS stored (it had a key) but the bytes didn't come back — a transient fetch /
      // permission failure, NOT a missing file. Distinct, retryable wording; auth if signed out.
      if (!buf) { setRedrop(sourceUnavailableMessage(signedIn ? "fetch-failed" : "signed-out", { name: src.name })); return; }
      blob = buf;
    }
    // B685/B686 — the Library stores ANY file type, but the markup canvas can only render a PDF.
    // A non-PDF reaches here when it's opened from a Library-Home pin (or an older resume). We
    // already have the bytes, so DOWNLOAD the original right here — never a dead-end note — and
    // show a clear message. (Non-PDFs are barred from becoming the resume target below, so this
    // only fires on a deliberate open, never as a surprise download on load.)
    if (src && src.name && !isPdfName(src.name)) {
      try {
        const dl = blob instanceof Blob ? blob : new Blob([blob]);
        const url = URL.createObjectURL(dl);
        const a = document.createElement("a"); a.href = url; a.download = src.name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 4000);
        setRedrop(`“${src.name}” isn’t a PDF, so it can’t be shown on the markup canvas — it’s downloading instead. Find it anytime in the Library.`);
      } catch (_) {
        setRedrop(`“${src.name}” isn’t a PDF, so it can’t be shown on the markup canvas. Open it from the Library to download it.`);
      }
      return;
    }
    let pdf;
    try { pdf = await loadPdf(blob); }
    catch (_) { setRedrop(`“${src.name || "That file"}” couldn’t be opened as a PDF — it may be a different file type or a damaged PDF. Open it from the Library to download the original.`); return; }
    if (tok != null && tok !== loadTok.current) { try { pdf.destroy(); } catch (_) {} return; } // superseded — free the doc we just loaded
    setPdfDoc(pdf);
    readOcg(pdf); // B490: populate the Layers panel from the new doc's optional content
    setRedrop(""); // bytes came back (from cache or cloud) — clear any stale "re-drop" banner (B448)
    setNumPages(pdf.numPages); setView(null); setPageBase(null); detailTileRef.current = null; setDetailTile(null); setLoadNonce((n) => n + 1); // refit on load (B329)
    scanSheets(pdf, pdf.numPages); // re-read sheets for the labeled/grouped sidebar (B266/B348); won't override saved cals
  };
  const loadSingleReview = async (rec) => {
    const tok = ++loadTok.current; // supersede any in-flight load so its late PDF can't land on this review (B52)
    suspendSave(); // don't let this programmatic load re-save itself with a fresh updatedAt (B19)
    const s = rec.single || {};
    const src = (rec.sources || [])[0] || null;
    // Library-Home "Recent": every open stamps the local opened-list — but not a non-PDF (B686),
    // which can't be marked up and shouldn't clutter "Recent drawings" (opening it just downloads).
    if (!(src && src.name && !isPdfName(src.name))) {
      currentUid().then((uid) => recordOpen(uid, { id: rec.id, projectId: rec.projectId || null })).catch(() => {});
    }
    // B446: a clear canvas-level "Opening…" overlay covers the whole load (setPdfDoc(null) below
    // blanks the backdrop, so without this the switch looks like nothing registered). Cleared in
    // the finally — but ONLY by the still-current load, so a rapid A→B switch doesn't let A's
    // late finally hide B's overlay (B447).
    setBusy(true); setBusyLabel(src?.name || rec.title || rec.item || "file");
    setPdfDoc(null);
    sourceRef.current = src ? { srcId: src.srcId, name: src.name } : null;
    setReviewId(rec.id);
    setMeta({ title: rec.title || "", projectId: rec.projectId || null, project: rec.project || "", discipline: rec.discipline || "", item: rec.item || "", revision: rec.revision || "", docDate: rec.docDate || "" });
    if (rec.projectId) onNavigate?.({ projectId: rec.projectId }); // reflect the open file's project in the URL + breadcrumb (Work Item A)
    setSource(src ? { srcId: src.srcId, name: src.name, size: src.size || 0, storageKey: src.storageKey || null, driveKey: src.driveKey || null, oversize: !!src.oversize } : null);
    setMarkups(sanitizeMarkups(s.markups)); setCalByPage(s.calByPage || {}); setCalInfo(s.calInfo || {}); // sanitize: a corrupted/partial saved review can't crash the overlay
    setSheetMeta({}); setOpenGroups({}); // re-read on load (B266/B348); saved cals preserved
    setFileName(s.fileName || ""); setNumPages(s.numPages || 0); setPage(s.page || 1);
    setDraft(null); clearSelection(); setTool("select"); setRedrop(""); setCalInput(null); clearHistory();
    scanTok.current++; // a programmatic load supersedes any in-flight auto-scale scan (use the saved cals)
    try { await fetchSourceBytes(src, tok); }
    finally { if (tok === loadTok.current) { setBusy(false); setBusyLabel(""); } } // only the winning load clears the overlay (B447)
  };
  const resetSingle = () => {
    setPdfDoc(null); sourceRef.current = null;
    setReviewId(newReviewId());
    setMeta(newMeta());
    // Keep the current project context: "New" starts a fresh blank review still filed
    // under the project you're in (it does NOT drop you back to "Select a project").
    setSource(null); setRedrop("");
    setFileName(""); setNumPages(0); setPage(1); setView(null); setPageBase(null); detailTileRef.current = null; setDetailTile(null); setLoadNonce((n) => n + 1);
    setMarkups([]); setCalByPage({}); setCalInfo({}); setSheetMeta({}); setOpenGroups({}); setDraft(null); clearSelection(); setTool("select"); setCalInput(null);
    clearHistory();
    scanTok.current++; // cancel any in-flight scan from a prior file
  };
  // Open a saved review from either toolbar OR the global Project Files panel; route single
  // vs. stitch by kind. Surfaces a visible error if the row can't be loaded so an open can
  // never fail silently again (NEW-1).
  const openReview = async (row) => {
    // Even a malformed open request is named, never silent (B446).
    if (!row || !row.id) { setOpenErr("That file can't be opened (its reference is missing). Browse the Files list and try again."); return; }
    setOpenErr("");
    // While THIS open runs, the project-switch resume effect must stand down: a cross-
    // workspace open navigates the route a commit AFTER its intent is consumed, and without
    // this flag that route change would kick off the target project's LAST doc in parallel,
    // racing (and possibly superseding) the very file the user just clicked.
    openInFlightRef.current = true;
    try {
    // B447 — switching is deterministic: flush the OUTGOING review's pending write to the cloud
    // BEFORE the incoming load starts. The debounced autosave's timer is cancelled the instant
    // this load changes the deps, so without this the outgoing edit would live only in the local
    // mirror — and returning to that file would load the stale cloud copy and clobber it.
    try { await saveNow(); } catch (_) {}
    setBusy(true); setBusyLabel(row.title || row.item || "file"); // B446: overlay up immediately so the click visibly registers
    let rec = null;
    try {
      // B447 — reconcile the cloud record with this file's local mirror, exactly as resume does,
      // so a switch-back picks up the just-made edit even if its cloud write hadn't landed.
      const uid = await currentUid();
      rec = reconcile(await loadReview(row.id), readDraft(uid, row.id));
    } catch (_) { rec = null; }
    if (!rec) {
      setBusy(false); setBusyLabel("");
      setOpenErr(`Couldn't open “${row.title || row.item || "that file"}”. It may have been removed, or the cloud is unreachable — try again.`);
      return;
    }
    // Carry the project context through so the breadcrumb reflects the opened file (single
    // reviews also navigate inside loadSingleReview; this also covers stitch).
    if (rec.projectId) onNavigate?.({ projectId: rec.projectId });
    // A stitch hands off to <Stitcher>; the single path owns the overlay through its own load
    // (loadSingleReview clears busy in its finally, token-guarded).
    if (rec.kind === "stitch") {
      currentUid().then((uid) => recordOpen(uid, { id: rec.id, projectId: rec.projectId || null })).catch(() => {}); // Library-Home "Recent"
      setPendingStitch(rec); setMode("stitch"); setBusy(false); setBusyLabel("");
    } else { setMode("review"); await loadSingleReview(rec); }
    } finally { openInFlightRef.current = false; }
  };

  // Breadcrumb project switch → land on THAT project's last-open document (owner request,
  // 2026-07-05: "whatever I last reviewed in that project should stay open too"). Declared
  // BEFORE the docIntent consumer so a same-commit cross-workspace open still reads as
  // pending here and wins. Skips during boot (the resume effect owns the first resolve) and
  // when the project change came FROM opening a doc (meta already matches the new project).
  const booted = useRef(false);
  const prevProjectRef = useRef(projectId);
  useEffect(() => {
    const prev = prevProjectRef.current;
    prevProjectRef.current = projectId;
    if (!booted.current || projectId === prev || !projectId) return;
    if (docIntent && docIntent.token !== lastConsumedDocToken) return; // a specific open is incoming — it wins
    if (openInFlightRef.current) return; // an open is mid-flight — ITS navigate caused this change; it owns the outcome
    if (meta.projectId === projectId) return; // the open doc already belongs here (its own open navigated us)
    const entry = readLastDoc(projectId);
    const openId = mode === "stitch" ? ((pendingStitch && pendingStitch.id) || null) : reviewId;
    if (entry && entry.id === openId) return; // that doc is already on screen
    if (entry) { openReview({ id: entry.id }); return; } // openReview flushes the outgoing doc first (B447)
    // No remembered doc for this project: fall to the clean empty state — a drawing from
    // ANOTHER project staying open under the new breadcrumb reads as the wrong file. Flush
    // the outgoing review's pending edit before wiping the canvas state.
    if (mode !== "review" || source || markups.length > 0 || meta.projectId) {
      (async () => { try { await saveNow(); } catch (_) {} setMode("review"); resetSingle(); })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Consume the Shell's cross-workspace "open this review" intent (NEW-1). A file clicked in
  // the GLOBAL Project Files panel switches here AND hands us the review; because this
  // workspace is lazy-mounted, we can only open it once we exist. Token-guarded (module-
  // scoped) so a plain tab switch-back doesn't re-fire the last open.
  useEffect(() => {
    if (!docIntent || docIntent.token === lastConsumedDocToken) return;
    lastConsumedDocToken = docIntent.token;
    if (docIntent.kind === "open-review" && docIntent.row) openReview(docIntent.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIntent]);
  // Resume the last review (and its mode) on mount, once — per-project first. Stitch
  // reviews are handed to <Stitcher> via pendingStitch; single reviews load here.
  useEffect(() => {
    if (booted.current) return; booted.current = true;
    // A cross-workspace open is incoming — let the docIntent effect load THAT review rather
    // than also resuming the last one (the two are async and would race; resume could win
    // and silently replace the file the user just clicked). (NEW-1)
    if (bootDocIntentRef.current) { setBootResolved(true); return; }
    // Browsing lives in the Library workspace, so Review resumes the last open drawing on
    // mount. Candidates come from the FIRST-RENDER pointer capture (the live keys may already
    // be touched by this session): the URL's project → that project's own last doc first,
    // then the legacy global pointers; no URL project → the legacy globals, then unfiled.
    (async () => {
      const candidates = resolveResume({
        routeProjectId: projectId,
        map: bootPointers.current.map,
        legacy: bootPointers.current.legacy,
      });
      if (!candidates.length) return;
      const uid = await currentUid();
      // Respect an explicit deep link (Work Item A): if the URL named a project, don't
      // auto-resume a review that belongs to a DIFFERENT project — try the next candidate,
      // else the empty state. No URL project → resume freely (it reflects into the URL).
      const wrongProject = (rec) => projectId && rec && rec.projectId && rec.projectId !== projectId;
      for (const c of candidates) {
        const rec = reconcile(await loadReview(c.id), readDraft(uid, c.id));
        if (!rec || wrongProject(rec)) continue;
        // Route by the RECORD's kind (an entry's stored mode could be stale if re-filed).
        if (rec.kind === "stitch") { setPendingStitch(rec); setMode("stitch"); return; }
        if (rec.kind === "single") { await loadSingleReview(rec); return; }
      }
    })().catch(() => {}) // B535: a resume failure (currentUid/loadReview/reconcile throwing) must
      // not be an unhandled rejection — loadSingleReview owns its own "Opening…" overlay via
      // finally, so swallowing here just falls to the empty state.
      .finally(() => setBootResolved(true)); // arm the pointer writes only now — never before resume read them
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- pointer → page units (via the shared transform; relative to the viewport so it
   * works at any pan/zoom — the sheet lives inside the viewport, offset by view.tx/ty) ---- */
  const toPage = (e) => {
    const wrap = wrapRef.current, v = viewRef.current;
    if (!wrap || !v) return { x: 0, y: 0 };
    const r = wrap.getBoundingClientRect();
    return screenToWorld(v, { x: e.clientX - r.left, y: e.clientY - r.top });
  };
  // Viewport-relative screen point (for two-finger pinch midpoint math). (B331)
  const vpPoint = (e) => { const r = wrapRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  // One frame of a two-finger pinch: zoom by the finger-distance ratio about the moving midpoint. (B331)
  const applyPinch = () => {
    // Snapshot the pinch baseline locally: a finger can lift (reseedPinch → pinchRef.current=null)
    // between scheduling this update and React running the updater, so reading pinchRef.current
    // inside setView could hit null ("null is not an object … .mid" crash on mobile). (B331 fix)
    const p = pinchRef.current;
    if (!p || pointersRef.current.size < 2) return;
    const [a, b] = [...pointersRef.current.values()];
    const mid = midpoint(a, b), dist = Math.max(1, distance(a, b));
    const factor = dist / p.dist;
    setView((v) => (v ? pinchZoom(v, p.mid, mid, factor, VIEW_MIN, VIEW_MAX) : v));
    pinchRef.current = { mid, dist };
  };
  // (Re)baseline the pinch to whatever touch pointers remain: ≥2 → seed from the current pair (the
  // first two), else end it. Called on every finger add/remove so a 3rd finger or a partial lift
  // re-anchors the gesture instead of zoom-jumping off a stale pair. (B331)
  const reseedPinch = () => {
    const pts = [...pointersRef.current.values()];
    pinchRef.current = pts.length >= 2 ? { mid: midpoint(pts[0], pts[1]), dist: Math.max(1, distance(pts[0], pts[1])) } : null;
  };

  // Per-tool style defaults that override PROPERTY_COLUMNS defaults but yield to the user's
  // last-set sticky style (propStyle). Highlight is yellow + wide + translucent by default.
  const TOOL_DEFAULTS = { highlight: { stroke: "#fbbf24", strokeWidth: 12, opacity: 0.35 } };

  const commit = (mk) => {
    // Stamp the new markup with the current sticky style for its tool kind. The user's overrides
    // (propStyle) take precedence over tool defaults, which take precedence over column defaults;
    // explicit fields inside mk win over all.
    const style = {};
    const toolDefs = TOOL_DEFAULTS[mk.kind] || {};
    propsForTool(mk.kind).forEach((key) => {
      const v = propStyle[key] !== undefined ? propStyle[key]
        : toolDefs[key] !== undefined ? toolDefs[key]
        : columnMeta(key)?.default;
      if (v !== undefined) style[key] = v;
    });
    const id = uid();
    pushHistory();
    setMarkups((a) => [...a, { id, page, ...style, ...mk }]);
    setDraft(null);
    // Bluebeam: a single-use tool reverts to Select after one markup and selects the new one
    // (so its properties show + you can tweak it); a locked tool stays armed.
    if (!toolLock) { setTool("select"); selectOne(id); }
  };

  // Erase pen/highlight markups whose points overlap the given box (two corner pts).
  const eraseInBox = ([a, b]) => {
    const x0 = Math.min(a.x, b.x), y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
    pushHistory();
    setMarkups((arr) => arr.filter((m) => {
      if (m.page !== page) return true;
      if (m.kind !== "pen" && m.kind !== "highlight") return true;
      return !(m.pts || []).some((q) => q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1);
    }));
  };

  const panMode = () => tool === "pan" || spaceHeld;

  // Property panel onChange (B426 + B437): patch the selected markup if one is selected, and ALWAYS
  // update the sticky style default — so the panel also works for an ARMED tool with nothing selected
  // (set color/weight/fill/font BEFORE drawing; new markups inherit it via commit()).
  const onPropChange = (key, value, opts = {}) => {
    if (sel) {
      // Live color picking (opts.live) fires `input` continuously while the palette is open — take
      // ONE undo snapshot on the first live event of a session (keyed on `key`), then skip the rest
      // so undo reverts the whole pick in one step instead of one frame per swatch (B567). The
      // committed `change` (opts.live falsy) of that same session must NOT push a second frame; any
      // other key (a normal discrete change) ends the session and pushes its own frame as before.
      if (opts.live) {
        if (colorSessionRef.current !== key) { pushHistory(); colorSessionRef.current = key; }
      } else {
        if (colorSessionRef.current !== key) pushHistory();
        colorSessionRef.current = null;
      }
      setMarkups((a) => a.map((m) => m.id === sel ? { ...m, ...writeProp(m, key, value) } : m));
    }
    setPropStyle((s) => ({ ...s, [key]: value }));
  };

  const openEditor = (ed) => { editDoneRef.current = false; setEditing(ed); };
  const closeEditor = (save) => {
    if (editDoneRef.current) return; // a prior Enter/Esc already handled it; ignore the unmount blur (B293)
    editDoneRef.current = true;
    const ed = editing; setEditing(null);
    if (!save || !ed) return;
    const text = (ed.text || "").trim();
    if (!text) { if (ed.id) { pushHistory(); setMarkups((a) => a.filter((m) => m.id !== ed.id)); } return; } // empty → drop / delete
    pushHistory();
    if (ed.id) {
      setMarkups((a) => a.map((m) => (m.id === ed.id ? { ...m, text } : m)));
    } else if (ed.calloutTip) {
      // New callout: pts[0] = leader tip (pointer target), pts[1] = text box anchor
      const style = {};
      propsForTool("callout").forEach((k) => { const v = propStyle[k] ?? columnMeta(k)?.default; if (v !== undefined) style[k] = v; });
      const id = uid();
      setMarkups((a) => [...a, { id, page: ed.page, kind: "callout", pts: [ed.calloutTip, ed.pt], ...style, text }]);
      if (!toolLock) { setTool("select"); selectOne(id); }
    } else {
      const style = {}; // honor the sticky text style (size/color/bold/…) set before drawing
      propsForTool("text").forEach((k) => { const v = propStyle[k] ?? columnMeta(k)?.default; if (v !== undefined) style[k] = v; });
      const id = uid();
      setMarkups((a) => [...a, { id, page: ed.page, kind: "text", pts: [ed.pt], ...style, text }]);
      if (!toolLock) { setTool("select"); selectOne(id); } // revert + select like the other tools
    }
  };

  const onDown = (e) => {
    if (!pageBase || !view) return;
    // Two-finger touch pinch (B331): track touch pointers; a 2nd touch starts a pinch and takes
    // over from any pan/draw in progress. Gated on pointerType==='touch' → mouse/trackpad untouched.
    if (e.pointerType === "touch") {
      pointersRef.current.set(e.pointerId, vpPoint(e));
      if (pointersRef.current.size >= 2) { // 2nd finger starts a pinch; a 3rd+ finger is absorbed (never draws/pans)
        reseedPinch();
        touchPinchedRef.current = true;
        panRef.current = null; dragRef.current = null; setDraft(null); setDragPreview(null); setPanning(false);
        e.preventDefault();
        return;
      }
    }
    if (calInput) return; // an inline Calibrate entry is open — finish it (Enter/Esc) before drawing again (B304)
    setHoverId(null);     // B156: a press starts a click/drag/draw — drop the hover glow until the pointer idles again
    const p = toPage(e);
    // Vertex grip hit check — when select tool + a SINGLE markup selected, a click within 8
    // screen-px of any vertex starts a single-vertex drag instead of a full-markup move. (B431)
    // Skipped for a true multi-selection so a drag moves the whole set as one. (B569)
    if (tool === "select" && sel && selSet.length <= 1 && !hasSelMod(e)) {
      const selM = pageMarks.find((mm) => mm.id === sel);
      if (selM?.pts?.length && selM.kind !== "pen" && selM.kind !== "highlight") {
        for (let vi = 0; vi < selM.pts.length; vi++) {
          const q = selM.pts[vi];
          if (Math.hypot((p.x - q.x) * view.scale, (p.y - q.y) * view.scale) <= 8) {
            vtxDragRef.current = { id: sel, idx: vi, start: p, origPts: selM.pts.map((r) => ({ ...r })) };
            try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
            return;
          }
        }
      }
    }
    // Select only "grabs" a markup when the click lands on one; an empty-canvas Select drag
    // pans instead (Bluebeam). hitTest is cheap + math-based, so probe it up front for the rule.
    const hitId = tool === "select" ? hitTest(p) : null;
    // Bluebeam pan/tool collision (shared rule): middle-mouse / Space / Pan tool / Select-on-
    // empty → pan; Select-on-object → select/move; a drawing tool → draw, never pan. (B329)
    if (shouldPan({ button: e.button, spaceHeld, tool, onObject: !!hitId })) {
      e.preventDefault();
      if (tool === "select" && !hasSelMod(e)) clearSelection(); // empty-canvas Select drag pans + clears (modifier held → keep the set)
      panRef.current = { sx: e.clientX, sy: e.clientY, tx0: view.tx, ty0: view.ty };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      setPanning(true);
      return;
    }
    if (e.button !== 0) return; // only the left button draws / selects past here
    if (tool === "marquee") { // B570 — dedicated box-select: drag a rubber-band, select on release
      marqueeRef.current = { a: p };
      setMarquee({ a: p, b: p });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (tool === "select") {
      const mods = selMods(e); // Ctrl/⌘-click = toggle, Shift-click = additive add (B569)
      if (hitId && (mods.toggle || mods.add)) { applySelMods(hitId, mods); return; }
      if (hitId && selSet.length > 1 && selSet.includes(hitId)) {
        // Drag a member of the multi-selection → move the whole set together as ONE undo step.
        const orig = {};
        pageMarks.forEach((m) => { if (selSet.includes(m.id)) orig[m.id] = (m.pts || []).map((q) => ({ x: q.x, y: q.y })); });
        groupDragRef.current = { ids: [...selSet], start: p, orig, moved: false };
        try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
        return;
      }
      selectOne(hitId);
      if (hitId) { // arm a single move-drag; a sub-threshold drag stays a plain click-select (B293)
        const m = pageMarks.find((mm) => mm.id === hitId);
        if (m) { dragRef.current = { id: hitId, start: p, orig: (m.pts || []).map((q) => ({ x: q.x, y: q.y })), moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }
      }
      return;
    }
    if (tool === "text" || tool === "callout") return; // text/callout open on pointer-UP (below) so focus change can't blur+discard the fresh editor (B293)
    if (FREEHAND.has(tool)) {
      setDraft({ kind: tool, pts: [p] });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (REGION.has(tool)) {
      setDraft({ kind: tool, pts: [p] });
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    if (TWOPOINT.has(tool)) {
      if (!draft) setDraft({ kind: tool, pts: [p] });
      else {
        // Shift = snap second point to the nearest 45° from the first (B431)
        let end = p;
        if (e.shiftKey && draft.pts.length >= 1) {
          const o = draft.pts[0], dx = p.x - o.x, dy = p.y - o.y;
          const ang = Math.atan2(dy, dx), snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          end = { x: o.x + Math.cos(snapped) * len, y: o.y + Math.sin(snapped) * len };
        }
        const pts = [draft.pts[0], end];
        if (tool === "calibrate") finishCalibrate(pts);
        else commit({ kind: tool, pts });
        setDraft(null);
      }
      return;
    }
    // Arc auto-commits when the 3rd point (the bulge/curve point) is placed
    if (tool === "arc" && draft?.kind === "arc" && draft?.pts?.length >= 2) {
      commit({ kind: "arc", pts: [...draft.pts, p] });
      setDraft(null);
      return;
    }
    if (MULTIPOINT.has(tool)) {
      setDraft((d) => {
        if (d && d.kind === tool) {
          // Close polygon on click near the first point (snap to close)
          if (tool === "polygon" && d.pts.length >= 3) {
            const tol = 12 / (view?.scale || 1);
            if (dist(p, d.pts[0]) <= tol) { commit({ kind: tool, pts: d.pts }); return null; }
          }
          return { ...d, pts: [...d.pts, p] };
        }
        return { kind: tool, pts: [p] };
      });
      return;
    }
  };

  const onMove = (e) => {
    if (pinchRef.current && e.pointerType === "touch") { // two-finger pinch in progress (B331)
      if (pointersRef.current.has(e.pointerId)) pointersRef.current.set(e.pointerId, vpPoint(e));
      applyPinch();
      return;
    }
    if (panRef.current) { // panning: move the sheet with the drag, free in any direction (B329)
      const d = panRef.current;
      setView((v) => (v ? { scale: v.scale, tx: d.tx0 + (e.clientX - d.sx), ty: d.ty0 + (e.clientY - d.sy) } : v));
      return;
    }
    if (!view) return;
    const rawP = toPage(e);
    if (marqueeRef.current) { setMarquee({ a: marqueeRef.current.a, b: rawP }); return; } // B570 live box-select
    if (groupDragRef.current) { // B569 live group-move preview of the whole multi-selection
      const g = groupDragRef.current, dx = rawP.x - g.start.x, dy = rawP.y - g.start.y;
      if (!g.moved && Math.hypot(dx * view.scale, dy * view.scale) < 3) { setCursor(rawP); return; }
      g.moved = true;
      const pts = {};
      for (const id of g.ids) pts[id] = (g.orig[id] || []).map((q) => ({ x: q.x + dx, y: q.y + dy }));
      setGroupPreview(pts);
      return;
    }
    // Vertex drag: translate only the grabbed vertex, keep all others fixed (B431)
    if (vtxDragRef.current) {
      const dx = rawP.x - vtxDragRef.current.start.x, dy = rawP.y - vtxDragRef.current.start.y;
      setVtxPreview({ id: vtxDragRef.current.id, pts: vtxDragRef.current.origPts.map((q, i) => i === vtxDragRef.current.idx ? { x: q.x + dx, y: q.y + dy } : { ...q }) });
      return;
    }
    // Freehand: append every move point to grow the live path
    if (FREEHAND.has(tool) && draft?.kind === tool) {
      setDraft((d) => d ? { ...d, pts: [...d.pts, rawP] } : d);
      return;
    }
    if (dragRef.current) { // moving a markup: translate its page-unit points live (B293)
      const dx = rawP.x - dragRef.current.start.x, dy = rawP.y - dragRef.current.start.y;
      if (!dragRef.current.moved && Math.hypot(dx * view.scale, dy * view.scale) < 3) { setCursor(rawP); return; }
      dragRef.current.moved = true;
      setDragPreview({ id: dragRef.current.id, pts: dragRef.current.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) });
      return;
    }
    // Shift = snap cursor to 45° from draft start point during TWOPOINT drawing (B431)
    let p = rawP;
    if (draft && TWOPOINT.has(tool) && e.shiftKey && draft.pts.length >= 1) {
      const o = draft.pts[0], dx = rawP.x - o.x, dy = rawP.y - o.y;
      const ang = Math.atan2(dy, dx), snapped = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      const len = Math.hypot(dx, dy);
      p = { x: o.x + Math.cos(snapped) * len, y: o.y + Math.sin(snapped) * len };
    }
    setCursor(p);
    // B156: highlight the markup a click would land on, using the SAME picker as the click (rawP,
    // pre-snap) so the hover preview always matches what selection actually grabs. Select mode only.
    setHoverId(tool === "select" ? hitTest(rawP) : null);
  };

  const onUp = (e) => {
    if (e.pointerType === "touch") { // wind down a touch pointer / pinch (B331)
      pointersRef.current.delete(e.pointerId);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      reseedPinch(); // re-baseline (or end) the pinch to whatever fingers remain — a lift never jumps
      if (pointersRef.current.size > 0) return;            // fingers remain — wait for full lift
      if (touchPinchedRef.current) { touchPinchedRef.current = false; panRef.current = null; dragRef.current = null; setPanning(false); return; } // pinch ended — no stray tap
    }
    if (panRef.current) { panRef.current = null; setPanning(false); try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} return; }
    if (marqueeRef.current) { // B570 — resolve the box-select: every markup the box TOUCHES (crossing)
      const a = marqueeRef.current.a, b = toPage(e); marqueeRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      const box = { x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) };
      const ids = pickInMarquee(pageMarks, box, { bboxOf: bboxOfMarkup, refOf: (m) => m.id });
      setMarquee(null);
      setSelSet(ids);
      setSel(ids.length === 1 ? ids[0] : null);
      setTool("select"); // hand the live selection to the move tool (raw setter keeps the set)
      return;
    }
    if (groupDragRef.current) { // B569 — commit the group-move as ONE undo step
      const g = groupDragRef.current; groupDragRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      if (g.moved) {
        const p = toPage(e), dx = p.x - g.start.x, dy = p.y - g.start.y;
        const ids = new Set(g.ids);
        pushHistory();
        setMarkups((a) => a.map((m) => (ids.has(m.id) && g.orig[m.id]) ? { ...m, pts: g.orig[m.id].map((q) => ({ x: q.x + dx, y: q.y + dy })) } : m));
      }
      setGroupPreview(null);
      return;
    }
    if (vtxDragRef.current) { // commit a single-vertex drag (B431)
      const d = vtxDragRef.current; vtxDragRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      if (vtxPreview) { pushHistory(); setMarkups((a) => a.map((m) => m.id === d.id ? { ...m, pts: vtxPreview.pts } : m)); setVtxPreview(null); }
      return;
    }
    if (dragRef.current) {
      const d = dragRef.current; dragRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      if (d.moved) { // commit the move ONCE on pointer-up so it's a single edit/save (B293) + one undo frame (B303)
        const p = toPage(e), dx = p.x - d.start.x, dy = p.y - d.start.y;
        pushHistory();
        setMarkups((a) => a.map((m) => (m.id === d.id ? { ...m, pts: d.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : m)));
      }
      setDragPreview(null);
      return;
    }
    // Freehand commit: release ends the stroke
    if (FREEHAND.has(tool) && draft) {
      if (draft.pts.length >= 2) commit({ kind: tool, pts: draft.pts });
      else setDraft(null);
      return;
    }
    // Region commit: release ends the drag-box (eraser deletes; snapshot creates a markup)
    if (REGION.has(tool) && draft) {
      const pts = [draft.pts[0], toPage(e)];
      if (tool === "eraser") { eraseInBox(pts); setDraft(null); }
      else commit({ kind: tool, pts }); // snapshot
      return;
    }
    // Two-point drag-commit: if the pointer was dragged far enough from the first click,
    // commit the second point on release (Bluebeam drag gesture). A sub-threshold release
    // is treated as a plain click (leaves the draft; the second click commits it, as before).
    if (TWOPOINT.has(tool) && draft && draft.pts.length >= 1) {
      const end = toPage(e);
      const dragScreenPx = dist(draft.pts[0], end) * (view?.scale || 1);
      if (dragScreenPx > 6) {
        let snapped = end;
        if (e.shiftKey) {
          const o = draft.pts[0], dx = end.x - o.x, dy = end.y - o.y;
          const ang = Math.atan2(dy, dx), a45 = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
          const len = Math.hypot(dx, dy);
          snapped = { x: o.x + Math.cos(a45) * len, y: o.y + Math.sin(a45) * len };
        }
        const pts = [draft.pts[0], snapped];
        if (tool === "calibrate") finishCalibrate(pts);
        else commit({ kind: tool, pts });
      }
      return;
    }
    // Text places on release: opening the inline editor here (not on pointer-down) means the
    // click's own focus change has already happened, so autofocus sticks and the empty editor
    // isn't immediately blurred + discarded. (B293)
    if (tool === "text" && e.button === 0) openEditor({ id: null, page, pt: toPage(e), text: "" });
    if (tool === "callout" && e.button === 0) {
      const p = toPage(e);
      if (!draft) {
        // First click: pin the leader tip (pointer target); wait for the second click.
        setDraft({ kind: "callout", pts: [p] });
      } else {
        // Second click: open the inline editor at the text box position.
        openEditor({ id: null, page, pt: p, text: "", calloutTip: draft.pts[0] });
        setDraft(null);
      }
    }
  };

  // Always clear pan/move state on an interrupted gesture so the canvas can't get stuck
  // behind a frozen grab cursor (cf. B271, the origin/main frozen-cursor lockout).
  const onCancel = (e) => {
    if (e && e.pointerType === "touch" && e.pointerId != null) pointersRef.current.delete(e.pointerId);
    reseedPinch();
    if (pointersRef.current.size === 0) touchPinchedRef.current = false;
    panRef.current = null; setPanning(false); dragRef.current = null; setDragPreview(null); vtxDragRef.current = null; setVtxPreview(null);
    marqueeRef.current = null; setMarquee(null); groupDragRef.current = null; setGroupPreview(null); // B569/B570 — abandon an in-flight box-select / group-move
  };

  const finishDraft = () => {
    if (!draft) return;
    const { kind, pts } = draft;
    // Measures: area + perimeter need ≥3 points. Shapes: polyline ≥2, polygon ≥3.
    if (MEASURE.has(kind) || kind === "count") {
      if (canCommitMeasure(kind, pts.length)) commit({ kind, pts });
      else setDraft(null);
    } else if (kind === "arc" && pts.length >= 3) {
      commit({ kind, pts });
    } else if (FREEHAND.has(kind) && pts.length >= 2) {
      commit({ kind, pts });
    } else if (kind === "polyline" && pts.length >= 2) {
      commit({ kind, pts });
    } else if (kind === "polygon" && pts.length >= 3) {
      commit({ kind, pts });
    } else {
      setDraft(null);
    }
  };
  const onDbl = (e) => {
    if (tool === "select") { // double-click a text note → edit it inline (B293)
      const m = pageMarks.find((mm) => mm.id === hitTest(toPage(e)));
      if (m && m.kind === "text") openEditor({ id: m.id, page, pt: (m.pts && m.pts[0]) || { x: 0, y: 0 }, text: m.text || "" });
      if (m && m.kind === "callout") openEditor({ id: m.id, page, pt: (m.pts && m.pts[1]) || (m.pts && m.pts[0]) || { x: 0, y: 0 }, text: m.text || "" });
      return;
    }
    if (!draft) return;
    // The browser fires TWO pointerdowns before a dblclick, each appending a coincident
    // point at the finish spot — strip that trailing run so a Count isn't inflated and a
    // poly isn't distorted. Enter (no extra downs) keeps every point. (B291)
    if (MULTIPOINT.has(draft.kind)) {
      const d = toPage(e), tol = 6 / view.scale;
      const pts = draft.pts.slice();
      while (pts.length && dist(pts[pts.length - 1], d) <= tol) pts.pop();
      const { kind } = draft;
      if ((MEASURE.has(kind) || kind === "count") && canCommitMeasure(kind, pts.length)) commit({ kind, pts });
      else if (kind === "polyline" && pts.length >= 2) commit({ kind, pts });
      else if (kind === "polygon" && pts.length >= 3) commit({ kind, pts });
      else setDraft(null);
    } else finishDraft();
  };

  // Two points placed → open an INLINE entry box at the line's midpoint (no window.prompt —
  // owner "no dialog boxes" rule). Commit/validation happens in commitCalibrate (B304).
  const finishCalibrate = (pts) => {
    const u = dist(pts[0], pts[1]);
    if (u < 1) { setErr("Calibration line too short — zoom in and try again."); return; }
    setErr("");
    setCalInput({ pts, x: ((pts[0].x + pts[1].x) / 2) * view.scale, y: ((pts[0].y + pts[1].y) / 2) * view.scale, value: "" });
  };
  // Validate the typed length and set the sheet's scale. Rejects ratios / bare fractions /
  // junk with a clear message (parseFeet) instead of silently mis-calibrating (B304).
  const commitCalibrate = () => {
    if (!calInput) return;
    const r = parseFeet(calInput.value);
    if (r.empty) { setCalInput(null); setErr(""); return; } // blank = cancel, no error
    if (!r.ok) { setErr(r.message); return; }               // invalid → keep the box open to fix
    const u = dist(calInput.pts[0], calInput.pts[1]);
    pushHistory();
    setCalByPage((c) => ({ ...c, [page]: r.ft / u }));
    setCalInfo((m) => ({ ...m, [page]: { src: "manual" } })); // a hand-calibration supersedes any auto guess (B267)
    setCalInput(null); setErr("");
  };

  // Selection picking is the ONE shared engine now (B155). Document Review's per-kind interior-grab
  // + smallest-area tie-break (B33/B374) moved into `pickMarkup`, so this surface, the Stitcher and
  // the shared tests all pick markups by identical rules — and the B156 hover preview can reuse the
  // exact same call so what highlights is always what a click selects. `tolPx: 10` keeps Document
  // Review's forgiving 10-px grab (the shared default is 6). Returns the markup id under `p`, or null.
  const hitTest = (p) => pickMarkup(pageMarks, p, view, { tolPx: 10 })?.id ?? null;

  // Copy / cut / paste a single selected markup (B417). Markups live on the editable SVG
  // overlay — the PDF backdrop is never touched. Paste drops the copy CENTERED under the
  // live cursor (Bluebeam-style); repeated paste restamps at wherever the cursor is now.
  // Single-element clipboard (sel is one markup id); group/multi clipboard is out of scope.
  const clip = useRef(null);
  const copyMarkup = () => {
    if (!sel) return false;
    const m = markups.find((x) => x.id === sel);
    if (!m) return false;
    clip.current = { ...m, pts: (m.pts || []).map((q) => ({ x: q.x, y: q.y })) }; // deep-clone pts so later edits can't mutate the clipboard
    return true;
  };
  const cutMarkup = () => {
    if (!copyMarkup()) return false;
    pushHistory(); setMarkups((a) => a.filter((x) => x.id !== sel)); clearSelection();
    return true;
  };
  const pasteMarkup = () => {
    const src = clip.current;
    if (!src) return false;
    const base = (src.pts || []).map((q) => ({ x: q.x, y: q.y }));
    // Drop the markup's bbox center under the live cursor (text = its single point); with no
    // cursor yet, a small fixed page-unit offset so a paste is never a silent no-op.
    const pts = (cursor && Number.isFinite(cursor.x) && Number.isFinite(cursor.y) && base.length)
      ? centerOn(base, cursor)
      : base.map((q) => ({ x: q.x + 12, y: q.y + 12 }));
    const mk = { ...src, id: uid(), page, pts }; // fresh id, lands on the CURRENT sheet
    pushHistory(); setMarkups((a) => [...a, mk]); selectOne(mk.id);
    return true;
  };

  // Arrange — change the selected markup's z-order within its same-page peers (B421, Bluebeam's
  // four ops). Draw order IS z-order (the overlay paints pageMarks in array order), so the pure
  // reorderWithinPage permutes only this sheet's group. It returns the SAME array for a no-op
  // (already at that end / a lone markup), so a top/bottom arrange leaves history untouched.
  const arrange = (mode) => {
    if (!sel) return false;
    const next = reorderWithinPage(markups, sel, mode);
    if (next === markups) return false; // no-op (already topmost/bottom, or only one on the sheet)
    pushHistory(); setMarkups(next);
    return true;
  };
  // Stack position of the current selection — drives the menu's greyed-out items (atTop disables
  // Bring to Front/Forward; atBottom disables Send to Back/Backward; a lone markup reads both).
  const arrangeState = () => arrangeFlags(markups, sel);

  // Right-click a markup → open the Arrange context menu at the cursor (B421). hitTest (B33) at the
  // press point: a hit selects that markup and opens the menu; a MISS does nothing — preventDefault
  // is not called, so the native browser menu shows over blank canvas (no empty custom menu).
  const onContextMenu = (e) => {
    if (!pageBase || !view || editing || calInput) return; // not while an inline editor / calibrate entry is open
    const hitId = hitTest(toPage(e));
    if (!hitId) return; // empty canvas → let the default context menu through
    e.preventDefault();
    if (selSet.includes(hitId)) setSel(hitId); else selectOne(hitId); // keep a multi-selection if right-clicking a member (B569)
    setCtxMenu({ x: e.clientX, y: e.clientY, id: hitId });
  };

  // keyboard: Enter finishes a poly/count draft; Esc cancels; Delete removes selection.
  // Keep the handler in a ref (refreshed each render with live closures) and bind the
  // window listener ONCE — the old no-deps effect re-subscribed on every render, and
  // onPointerMove re-renders dozens of times/sec while drawing (B41).
  const onKeyRef = useRef(null);
  onKeyRef.current = (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else if (!removeLastVertex()) undo(); return; } // ⌘/Ctrl-Z (B303)
    if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }                                                        // Ctrl-Y redo
    if (mod && (e.key === "c" || e.key === "C")) { if (copyMarkup()) e.preventDefault(); return; }  // ⌘/Ctrl-C copy selected markup (B417)
    if (mod && (e.key === "x" || e.key === "X")) { if (cutMarkup()) e.preventDefault(); return; }   // ⌘/Ctrl-X cut
    if (mod && (e.key === "v" || e.key === "V")) { if (pasteMarkup()) e.preventDefault(); return; } // ⌘/Ctrl-V paste at the cursor
    // Arrange z-order chords (B421), Bluebeam-style. Match e.code (physical key), NOT e.key — Shift
    // turns e.key "]"→"}", which would silently miss the Bring-to-Front chord. ] = up the stack,
    // [ = down; Shift = jump to the end. Gated on a selection; ⌘ is covered by `mod` (metaKey).
    if (mod && sel && (e.code === "BracketRight" || e.code === "BracketLeft")) {
      e.preventDefault();
      if (e.code === "BracketRight") arrange(e.shiftKey ? "front" : "forward");   // ⌘/Ctrl(+Shift)+]
      else arrange(e.shiftKey ? "back" : "backward");                            // ⌘/Ctrl(+Shift)+[
      return;
    }
    if (mod) return; // leave any other modified keys to the browser
    if (e.key === " " || e.code === "Space") { if (!spaceHeld) setSpaceHeld(true); e.preventDefault(); return; } // hold-Space = pan (B289)
    if (e.key === "Enter") { e.preventDefault(); finishDraft(); }
    else if (e.key === "Escape") {
      if (ctxMenu) { setCtxMenu(null); return; } // close the Arrange menu first, keeping the selection (B421)
      setDraft(null); clearSelection(); setDragPreview(null); dragRef.current = null; setCalInput(null); setMarquee(null); marqueeRef.current = null;
    }
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (removeLastVertex()) { e.preventDefault(); return; }            // trim a draft vertex first (B303)
      if (selSet.length > 1) { // B569: delete the whole multi-selection as ONE undo step
        e.preventDefault(); pushHistory();
        const ids = new Set(selSet);
        setMarkups((a) => a.filter((m) => !ids.has(m.id)));
        clearSelection();
      } else if (sel) { e.preventDefault(); pushHistory(); setMarkups((a) => a.filter((m) => m.id !== sel)); clearSelection(); }
    }
    // Sheet paging (B306) — only when not mid-draft / mid-entry so arrows don't drop work.
    else if (!draft && !calInput && (e.key === "ArrowLeft" || e.key === "PageUp")) { e.preventDefault(); goToPage(page - 1); }
    else if (!draft && !calInput && (e.key === "ArrowRight" || e.key === "PageDown")) { e.preventDefault(); goToPage(page + 1); }
  };
  useEffect(() => {
    // Keep-alive gate: these listeners stay bound for the workspace's whole mounted life,
    // which now spans hidden-tab time — a hidden Review must never eat Delete/Ctrl-Z/Space
    // (or actually delete markups on the hidden canvas) while another module is on screen.
    const onKey = (e) => { if (isActiveRef.current && onKeyRef.current) onKeyRef.current(e); };
    const onKeyUp = (e) => { if (isActiveRef.current && (e.key === " " || e.code === "Space")) setSpaceHeld(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  const zoom = (f) => doZoom(f, null, null); // ± buttons zoom about the viewport centre (B290/B329)
  const totals = rollup(markups, calByPage);

  /* ---------------- render ---------------- */
  const f0 = (n) => Math.round(n).toLocaleString();
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Right-hand value for a row in the per-sheet markup list (B376): a measurement shows its
  // measured value; a text note shows its words; a redline shape has none. Every markup is listed
  // so it can always be found + deleted from the panel, independent of clicking it on the canvas.
  const markRowValue = (m) => MEASURE.has(m.kind) ? measureLabel(m, ftPerUnit) : (m.kind === "text" || m.kind === "callout") ? ((m.text || "").trim() || "empty note") : "";
  // Toolbar buttons: nowrap (so labels never break mid-word into uneven multi-line chips)
  // + tightened padding for density on the single header row (B305).
  const btn = (on) => ({ padding: "5px 9px", fontSize: 12, lineHeight: 1.1, whiteSpace: "nowrap", borderRadius: 8, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${on ? PAL.accent : "var(--border-default)"}`, background: on ? PAL.accent : "var(--surface-raised)", color: on ? "var(--on-accent)" : PAL.ink }); // B657-5B: radius 8 = shared control scale
  const chromeBtn = (extra = {}) => ({ ...btn(false), border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: PAL.chromeInk, ...extra });
  const iconBtn = (disabled) => ({ ...btn(false), padding: "5px 7px", opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" });
  const tbDiv = { width: 1, height: 18, background: "var(--chrome-divider)", margin: "0 2px", flex: "none" };
  const curTool = TOOLS.find((t) => t.id === tool);
  // Logical-sheet sidebar helpers (B266/B348): a short sheet id + a rich tooltip. The old inline
  // "·≈"/"·✓" calibration marks read as unexplained noise (owner, B664) — calibration status
  // lives in the tooltip ("scale 1\"=40' — verify") and the Takeoff/Calibrate UI instead.
  const sheetShort = (n) => metaOf(n)?.sheetNumber || `Sheet ${n}`;
  // Do we trust the read title enough to surface it as the label (B378)? A title is trustworthy
  // when it came from a detected title-block band, OR is corroborated by a real sheet number read
  // from the title-block zone, OR the sheet is a recognized text page (general notes / specs, where
  // the title IS its identity). A bare band — or nothing — no longer authorizes a body line as the
  // label (the old `hasReal` gate that let copyright/legend prose through).
  const trustedTitle = (m) =>
    m?.sheetTitle && m.sheetTitle !== "Document" && (m.titleBlock || m.sheetNumber || m.textDense) ? m.sheetTitle : "";
  // The human label for a single sheet — NUMBER FIRST, the owner's own convention (2026-07-05:
  // "pick the sheet number first, then 'A101 - OVERALL FLOOR PLAN'"): the read sheet number, a
  // dash, then the trusted title ("GENERAL NOTES"), else the deterministic discipline item
  // ("Grading Plan"); no number → title alone; neither → "Sheet N". Returns { label, real }.
  const sheetLabel = (n) => {
    const m = metaOf(n);
    const title = trustedTitle(m) || (m?.item && m.item.toLowerCase() !== "document" ? m.item : "");
    if (m?.sheetNumber && title) return { label: `${m.sheetNumber} - ${title}`, code: m.sheetNumber, title, real: true };
    if (m?.sheetNumber) return { label: m.sheetNumber, code: m.sheetNumber, title: "", real: true };
    if (title) return { label: title, code: "", title, real: true };
    return { label: `Sheet ${n}`, code: `Sheet ${n}`, title: "", real: false };
  };
  const sheetTip = (n) => {
    const m = metaOf(n); const parts = [];
    if (m?.sheetNumber) parts.push(m.sheetNumber);
    const t = trustedTitle(m);
    if (t) parts.push(t);
    if (calInfo[n]?.label) parts.push(`scale ${calInfo[n].label}${calInfo[n].src !== "manual" ? " — verify" : ""}`);
    return parts.join(" · ") || `Sheet ${n}`;
  };

  // Right-side tool rail (B330): the drawing/measure tools + zoom controls, Bluebeam-style.
  // Takeoff rides HERE as a toggle (B664 — owner: "takeoff should just be one of the tools"),
  // not as a permanently-docked panel.
  const railItems = [
    ...TOOLS.map((t) => ({ kind: "tool", id: t.id, label: t.label, title: `${t.hint}${t.id !== "select" && t.id !== "pan" ? "  (double-click to keep this tool active)" : ""}`, icon: <MkIcon id={t.id} />, active: tool === t.id,
      onClick: () => { setTool(t.id); setToolLock(false); setDraft(null); setCalInput(null); },
      onDoubleClick: () => { setTool(t.id); setToolLock(true); setDraft(null); setCalInput(null); } })),
    { kind: "tool", id: "takeoff", label: "Takeoff", title: "Show / hide the takeoff rollup (measured quantities across sheets)", icon: <MkIcon id="takeoff" />, active: takeoffOpen,
      onClick: () => setTakeoffOpen((v) => !v) },
    { kind: "spacer" },
    { kind: "header", label: "Zoom" },
    { kind: "node", render: <div style={{ textAlign: "center", fontSize: 10, color: "var(--chrome-muted)", fontWeight: 600, padding: "1px 0 2px" }}>{Math.round((view?.scale || 0) * 100)}%</div> },
    { kind: "tool", id: "zoomIn", label: "In", title: "Zoom in", icon: <MkIcon id="zoomIn" />, onClick: () => zoom(1.2) },
    { kind: "tool", id: "zoomOut", label: "Out", title: "Zoom out", icon: <MkIcon id="zoomOut" />, onClick: () => zoom(1 / 1.2) },
    { kind: "tool", id: "fitW", label: "Fit", title: "Fit to width", icon: <MkIcon id="fitW" />, onClick: () => fitNow("width") },
    { kind: "tool", id: "fitP", label: "Page", title: "Fit the whole sheet", icon: <MkIcon id="fitP" />, onClick: () => fitNow("page") },
  ];

  if (mode === "stitch") return (
    <Stitcher
      isActive={isActive}
      onReview={() => setMode("review")}
      loadReq={pendingStitch}
      onConsumeLoad={() => setPendingStitch(null)}
      onOpenReview={openReview}
      signedIn={signedIn}
    />
  );

  // drawMarkup() is now handled by <MarkupRenderer> (B426); the local `draw()` alias is gone.

  const drawDraft = () => {
    if (!draft || !view) return null;
    const S = (q) => ({ x: q.x * view.scale, y: q.y * view.scale });
    const pts = draft.pts.map(S);
    const cur = cursor ? S(cursor) : null;
    const col = draft.kind === "calibrate" ? PAL.accent : MEASURE.has(draft.kind) ? "#0e7490" : "#b91c1c";

    // Callout draft: first click pins the leader tip; show a rubber-band leader to the cursor
    if (draft.kind === "callout") {
      const tip = pts[0]; if (!tip) return null;
      if (!cur) return <circle cx={tip.x} cy={tip.y} r={3.5} fill={col} />;
      return (
        <g>
          <line x1={tip.x} y1={tip.y} x2={cur.x} y2={cur.y} stroke={col} strokeWidth={2} strokeDasharray="5 4" />
          <circle cx={tip.x} cy={tip.y} r={3.5} fill={col} />
          <rect x={cur.x} y={cur.y - 10} width={60} height={20} fill="none" stroke={col} strokeWidth={1.5} strokeDasharray="4 3" rx={2} />
        </g>
      );
    }

    // Two-point drafts (line, distance, calibrate, rect, cloud, ellipse)
    if (TWOPOINT.has(draft.kind)) {
      const a = pts[0]; if (!a) return null;
      if (!cur) return <g><circle cx={a.x} cy={a.y} r={3} fill={col} /></g>;
      if (draft.kind === "rect" || draft.kind === "cloud") {
        const x = Math.min(a.x, cur.x), y = Math.min(a.y, cur.y), w = Math.abs(cur.x - a.x), h = Math.abs(cur.y - a.y);
        return draft.kind === "cloud"
          ? <path d={cloudPath(x, y, w, h)} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" />
          : <rect x={x} y={y} width={w} height={h} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" />;
      }
      if (draft.kind === "ellipse") {
        const cx = (a.x + cur.x) / 2, cy = (a.y + cur.y) / 2;
        const rx = Math.abs(cur.x - a.x) / 2, ry = Math.abs(cur.y - a.y) / 2;
        return <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" />;
      }
      // line / distance / calibrate / dimension — a simple segment preview
      return <g><line x1={a.x} y1={a.y} x2={cur.x} y2={cur.y} stroke={col} strokeWidth={2} strokeDasharray="5 4" /><circle cx={a.x} cy={a.y} r={3} fill={col} /></g>;
    }

    // Arc draft: 1 pt = dot, 2 pts = straight segment + live bezier preview as cursor moves
    if (draft.kind === "arc") {
      if (pts.length === 1) return <circle cx={pts[0].x} cy={pts[0].y} r={3.5} fill={col} />;
      const [a, b] = pts;
      if (!cur) return <g><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={col} strokeWidth={2} strokeDasharray="5 4" /><circle cx={a.x} cy={a.y} r={3.5} fill={col} /><circle cx={b.x} cy={b.y} r={3.5} fill={col} /></g>;
      const ctrl = { x: 2 * cur.x - (a.x + b.x) / 2, y: 2 * cur.y - (a.y + b.y) / 2 };
      return (
        <g>
          <path d={`M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" />
          <circle cx={a.x} cy={a.y} r={3.5} fill={col} />
          <circle cx={b.x} cy={b.y} r={3.5} fill={col} />
        </g>
      );
    }

    // Freehand draft (pen / highlight): grow the live path on every pointer-move
    if (FREEHAND.has(draft.kind) && pts.length >= 1) {
      const isHL = draft.kind === "highlight";
      const sw = isHL ? 10 : 2;
      const op = isHL ? 0.4 : 1;
      const d = "M " + pts.map((q) => `${q.x},${q.y}`).join(" L ");
      return <path d={d} fill="none" stroke={isHL ? "#fbbf24" : col} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" opacity={op} />;
    }

    // Region draft (eraser / snapshot): rubber-band rectangle
    if (REGION.has(draft.kind) && pts.length >= 1 && cur) {
      const a = pts[0];
      const x = Math.min(a.x, cur.x), y = Math.min(a.y, cur.y);
      const w = Math.abs(cur.x - a.x), h = Math.abs(cur.y - a.y);
      return <rect x={x} y={y} width={w} height={h} fill={col + "18"} stroke={col} strokeWidth={1.5} strokeDasharray="5 4" />;
    }

    // Multi-point drafts (polygon, polyline, area, perimeter, count)
    const seq = cur ? [...pts, cur] : pts;
    const isClosingDraft = draft.kind === "polygon" && pts.length >= 3;
    const closeSegment = isClosingDraft && cur
      ? <line x1={cur.x} y1={cur.y} x2={pts[0].x} y2={pts[0].y} stroke={col} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.5} />
      : null;
    return (
      <g>
        {seq.length > 1 && (
          <polyline points={seq.map((q) => `${q.x},${q.y}`).join(" ")}
            fill={draft.kind === "polygon" || draft.kind === "area" ? col + "18" : "none"}
            stroke={col} strokeWidth={2} strokeDasharray="5 4" />
        )}
        {closeSegment}
        {pts.map((q, i) => (
          <circle key={i} cx={q.x} cy={q.y} r={i === 0 && isClosingDraft ? 5 : 3.5}
            fill={i === 0 && isClosingDraft ? col : col}
            stroke={i === 0 && isClosingDraft ? "#fff" : "none"} strokeWidth={1.5} />
        ))}
        {draft.kind === "count" && (
          <text x={(pts[pts.length - 1] || { x: 8 }).x + 8} y={(pts[pts.length - 1] || { y: 8 }).y}
            fontSize="11" fontWeight="700" fill={col}>{pts.length}</text>
        )}
      </g>
    );
  };

  // Canvas-level "Opening…" overlay (B446): the instant ANY entry path accepts a file
  // (drop / Open… / a Files-panel open / a switch), a clear, unmistakable cover appears with the
  // file name + a spinner — so an open can never look like "nothing happened" (the old "Opening…"
  // text only rendered in the empty state, leaving the drop-over-open and switch paths silent).
  const openingOverlay = busy ? (
    <div data-testid="opening-overlay" style={{ position: "absolute", inset: 0, zIndex: 30, display: "grid", placeItems: "center",
      background: "var(--scrim, rgba(255,255,255,0.78))", backdropFilter: "blur(1px)", WebkitBackdropFilter: "blur(1px)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderRadius: 10, background: "var(--surface-raised)",
        border: `1px solid ${PAL.line}`, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", color: PAL.ink, fontFamily: "system-ui, sans-serif" }}>
        <span aria-hidden="true" style={{ flex: "none", width: 18, height: 18, borderRadius: "50%", border: "2.5px solid var(--border-default)",
          borderTopColor: "var(--accent)", animation: "spin 0.8s linear infinite" }} />
        <span style={{ fontSize: 13.5, fontWeight: 600, maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          Opening {busyLabel || "file"}…
        </span>
      </div>
    </div>
  ) : null;

  return (
    <div data-testid="doc-review-root" style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.paper, position: "relative" }}>
      <AppHeader
        module={shellModule || "doc-review"}
        onSwitch={onShellSwitch}
        // Breadcrumb (B191–B193): Dashboard leaves Markup for the all-projects map;
        // picking a project changes the URL project; New project is born in the Site
        // Planner. Save state from persistence.
        onDashboard={onGoDashboard}
        currentProject={markupProject}
        cross={crossProject}
        // cross:false is load-bearing (same fix as the Library): navigate() merges with
        // the live route and buildHash drops projectId while cross is true, so picking a
        // project from the breadcrumb in "All projects" mode was a silent no-op.
        onSelectProject={(id) => onNavigate?.({ projectId: id, cross: false })}
        onNewProject={onNewProject}
        // The compact Row-1 CloudSyncBadge (NEW-1) reads this normalized state; docSaveState
        // keeps the "a failed write is LOUD, never silent" contract (unit-locked).
        saveState={docSaveState(status, signedIn, isEmpty())}
        onRetrySave={status === "conflict" ? undefined : saveNow}
        saveDetail={status === "conflict" ? "This review was changed in another session. Reload to merge in the latest before saving — your edit is safe on this device." : undefined}
        centerContent={
          // Browsing files now lives in the Library workspace; this button switches there
          // (carrying the current project, since the URL project survives a module switch).
          <button onClick={() => onShellSwitch?.("library")} title="Open the Library to browse this project's files"
            style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "3px 10px",
              border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: "var(--chrome-text)" }}>
            🗂 Library
          </button>
        }
        authControl={authControl}
        accountActive={accountActive}
        toolbarContent={
          <>
            <button style={chromeBtn()} title={fileName ? "Open another PDF" : "Open a PDF"} onClick={() => fileRef.current?.click()}>{fileName ? "Open…" : "Open PDF…"}</button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button style={chromeBtn()} onClick={() => setMode("stitch")} title="Stitch multiple sheets into one continuous plan">Stitch ▸</button>
            {/* Reviews (file/save this review) lives in the Row-2 tools row (B360). Its own
                save chip was retired — the app-wide Row-1 CloudSyncBadge (NEW-1) is the single
                save indicator now, so there's no longer a second chip competing here. The old
                📁 Library door is gone too — the 🗂 Files drawer browses by project + discipline. */}
            <ReviewsBar signedIn={signedIn} meta={meta} onMeta={onMeta} onOpen={openReview} onNew={resetSingle} />
            {fileName && <span style={{ color: PAL.chromeMuted, fontSize: 11.5, maxWidth: 130, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>}
            {/* Drawing/measure tools + zoom controls now live in the right-side tool rail (B330).
                Undo/Redo stay here as document-history actions, beside the doc-level controls. */}
            {pdfRef.current && <>
              <span style={tbDiv} />
              <button style={iconBtn(!canUndo)} disabled={!canUndo} onClick={undo} title="Undo (⌘/Ctrl-Z)">↶</button>
              <button style={iconBtn(!canRedo)} disabled={!canRedo} onClick={redo} title="Redo (⌘/Ctrl-Shift-Z)">↷</button>
              {/* B490 — Layers: show/hide the PDF's optional-content groups (e.g. Electrical). Only when the
                  drawing carries layers; visibility is a view filter (in-memory), never the markups. The popover
                  is portaled (AnchoredMenu) so the toolbar row's overflow:hidden can't clip it. */}
              {ocgLayers.length > 0 && (
                <>
                  <button ref={layersBtnRef} style={iconBtn(false)} onClick={() => setLayersOpen((o) => !o)} title="Layers — show/hide parts of the drawing" aria-expanded={layersOpen} aria-haspopup="menu">▤</button>
                  <AnchoredMenu open={layersOpen} onClose={() => setLayersOpen(false)} anchorRef={layersBtnRef} placement="below-right" width={200} className=""
                    panelStyle={{ padding: "8px 10px", borderRadius: 10, background: "var(--surface-raised)", border: `1px solid ${PAL.line}`, boxShadow: "0 6px 24px rgba(0,0,0,0.18)", color: PAL.ink, fontFamily: "system-ui, sans-serif" }}>
                    <div data-testid="layers-menu">
                      <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted, margin: "0 0 6px" }}>Layers</div>
                      {ocgLayers.map((r) => (
                        <label key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "3px 2px", cursor: "pointer", whiteSpace: "nowrap" }}>
                          <input type="checkbox" checked={r.visible} onChange={(e) => toggleLayer(r.id, e.target.checked)} />
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                        </label>
                      ))}
                    </div>
                  </AnchoredMenu>
                </>
              )}
            </>}
          </>
        }
      />

      {redrop && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", background: "#fef3c7", color: "#92400e", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
          <span>⚠ {redrop}</span>
          <button onClick={() => fileRef.current?.click()} style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #d6a64a", background: "var(--surface-raised)", color: "var(--warn-text)" }}>Re-open file…</button>
        </div>
      )}

      {openErr && (
        <div role="alert" style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", background: "#fee2e2", color: "#991b1b", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
          <span>⚠ {openErr}</span>
          <button onClick={() => { setOpenErr(""); onShellSwitch?.("library"); }} style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #dca0a0", background: "#fff", color: "#991b1b" }}>Open Library…</button>
          <button onClick={() => setOpenErr("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(0,0,0,0.06)", color: "#991b1b", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {!pdfRef.current ? (
        // Browsing moved to the Library workspace, so Review's landing is a clean empty state:
        // browse the Library for a filed drawing, or drop/open an ad-hoc PDF to mark up here.
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files?.[0]); }}
          style={{ flex: 1, position: "relative", display: "grid", placeItems: "center", color: PAL.muted, fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: PAL.ink, marginBottom: 8 }}>No drawing open</div>
            <div style={{ fontSize: 13.5, marginBottom: 4 }}>{busy ? "Opening…" : "Open a filed drawing from the Library, or drop a construction PDF to review."}</div>
            <div style={{ fontSize: 12, marginBottom: 14 }}>Calibrate to scale, measure distance/area/count, redline, and roll up a takeoff.</div>
            <div style={{ display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
              <button data-testid="empty-open-library" onClick={() => onShellSwitch?.("library")}
                style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 700, cursor: "pointer", borderRadius: 8, padding: "7px 14px", border: "1px solid var(--accent-library)", background: "var(--accent-library)", color: "var(--on-accent-library)" }}>
                🗂 Browse the Library
              </button>
              <button onClick={() => fileRef.current?.click()}
                style={{ fontFamily: "inherit", fontSize: 12.5, fontWeight: 600, cursor: "pointer", borderRadius: 8, padding: "7px 14px", border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--text-secondary)" }}>
                Open PDF…
              </button>
            </div>
            {err && <div style={{ color: "var(--danger-text)", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
          </div>
          {openingOverlay}
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0, position: "relative" }}>
          {/* sheet list — logical sheets (B348) with real labels (B266). Collapsed → a slim
              re-open strip; open → user-resizable via the drag handle on its right edge (B664). */}
          {railHidden && (
            <button onClick={() => setRailHidden(false)} title="Show the sheet list" data-testid="sheet-rail-expand"
              style={{ flex: "none", width: 26, background: "var(--surface-raised)", borderRight: `1px solid ${PAL.line}`, border: "none", borderRightStyle: "solid", cursor: "pointer", color: PAL.muted, fontFamily: "inherit", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center" }}>
              <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>Sheets ▸</span>
            </button>
          )}
          {!railHidden && (
          <div data-testid="sheet-rail" style={{ flex: "none", width: railW, position: "relative", background: "var(--surface-raised)", borderRight: `1px solid ${PAL.line}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Prev/Next pager (B306) — also ← / → and PageUp/PageDown on the keyboard */}
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "8px 8px 6px" }}>
              {(() => { const pg = (on) => ({ flex: 1, padding: "4px 0", borderRadius: 6, cursor: on ? "pointer" : "default", fontFamily: "inherit", fontSize: 13, fontWeight: 700, border: `1px solid ${PAL.line}`, background: "var(--surface-raised)", color: on ? PAL.ink : "var(--text-tertiary)" }); return (
                <>
                  <button style={pg(page > 1)} disabled={page <= 1} onClick={() => goToPage(page - 1)} title="Previous sheet (←)">‹</button>
                  <span style={{ flex: "none", fontSize: 10.5, color: PAL.muted, fontWeight: 700, minWidth: 40, textAlign: "center" }}>{page} / {numPages}</span>
                  <button style={pg(page < numPages)} disabled={page >= numPages} onClick={() => goToPage(page + 1)} title="Next sheet (→)">›</button>
                  <button onClick={() => setRailHidden(true)} title="Hide the sheet list" data-testid="sheet-rail-collapse"
                    style={{ flex: "none", border: "none", background: "transparent", color: PAL.muted, cursor: "pointer", fontSize: 12, fontWeight: 700, padding: "2px 4px", fontFamily: "inherit" }}>⟨</button>
                </>
              ); })()}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px", minHeight: 0 }}>
              {/* Logical sheets (B348): grouped plans collapse to one entry; the real sheet # + title
                  replace "Sheet N" (B266). The same shared engine (sheetGroups/sheetMeta) the Stitcher
                  uses; the count reads "logical sheets · pages" so the collapse is visible. */}
              <div data-testid="sheet-count" style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{groups.length} sheet{groups.length === 1 ? "" : "s"} · {numPages} pages</div>
              {/* B364 — the scanned-sheet OCR pass is visibly in progress (labels fill in as pages
                  read), and a pass that recovered NOTHING says so instead of silently leaving
                  "Sheet N" everywhere. */}
              {ocrScan && (
                <div data-testid="ocr-scan-note" style={{ fontSize: 10, color: "var(--warn-text)", fontWeight: 700, marginBottom: 6 }}>
                  {ocrScan.failed ? "Couldn’t read the scanned sheets (text recognition unavailable) — labels stay generic" : `Reading scanned sheets… ${ocrScan.done}/${ocrScan.total}`}
                </div>
              )}
              {groups.map((g, gi) => {
                const gid = `${gi}:${g.pages[0]?.pageNum}`;
                if (g.kind === "single") {
                  const n = g.pages[0].pageNum, active = n === page;
                  // The label: number bold + the real title-block title, else "Sheet N" — never a
                  // random body-text line (B266) nor a cross-referenced/duplicate number (B378).
                  const lb = sheetLabel(n);
                  return (
                    <button key={gid} ref={active ? activeSheetRef : null} onClick={() => goToPage(n)} title={sheetTip(n)} data-testid="sheet-entry"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", marginBottom: 3, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12,
                        border: `1px solid ${active ? PAL.accent : PAL.line}`, background: active ? "var(--hover-ghost)" : "var(--surface-raised)", color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      <SheetRowText code={lb.code} title={lb.title} />
                    </button>
                  );
                }
                const pagesN = g.pages.map((p) => p.pageNum);
                const open = openGroups[gid] ?? pagesN.includes(page);
                const activeInGroup = pagesN.includes(page);
                return (
                  <div key={gid} style={{ marginBottom: 4 }}>
                    <button onClick={() => { setOpenGroups((o) => ({ ...o, [gid]: !open })); goToPage(g.pages[0].pageNum); }} title={g.label} data-testid="sheet-group"
                      style={{ display: "flex", alignItems: "center", gap: 6, width: "100%", textAlign: "left", padding: "6px 8px", borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 700,
                        border: `1px solid ${activeInGroup ? PAL.accent : PAL.line}`, background: activeInGroup ? "var(--hover-ghost)" : "var(--surface-page)", color: PAL.ink }}>
                      <span style={{ flex: "none", fontSize: 9, color: PAL.muted }}>{open ? "▾" : "▸"}</span>
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        <SheetRowText code={g.sheetRange} title={g.title} />
                        <span style={{ fontWeight: 500, color: "var(--text-tertiary)" }}>{`  · ${g.pages.length} sheets`}</span>
                      </span>
                    </button>
                    {open && pagesN.map((n) => {
                      const active = n === page;
                      return (
                        <button key={n} ref={active ? activeSheetRef : null} onClick={() => goToPage(n)} title={sheetTip(n)} data-testid="sheet-entry"
                          style={{ display: "block", width: "calc(100% - 12px)", marginLeft: 12, textAlign: "left", padding: "5px 8px", marginBottom: 2, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600,
                            border: `1px solid ${active ? PAL.accent : PAL.line}`, background: active ? "var(--hover-ghost)" : "var(--surface-raised)", color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sheetShort(n)}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
            {/* Properties (B426 + B437) — shows for a SELECTED markup, OR for the ARMED drawable tool
                so you can set color/weight/fill/font BEFORE drawing (new markups inherit the sticky
                style via commit()). Driven by schemaForMarkup → PropertyPanel. */}
            {(() => {
              const selM = sel ? pageMarks.find((mm) => mm.id === sel) : null;
              const armed = (!selM && toolById(tool) && propsForTool(tool).length) ? tool : null;
              if (!selM && !armed) return null;
              const subject = selM || { kind: armed, ...propStyle };
              return (
                <div style={{ flex: "none", borderTop: `1px solid ${PAL.line}` }}>
                  <div style={{ padding: "6px 12px 4px", fontSize: 10, color: PAL.muted, fontWeight: 700,
                    textTransform: "uppercase", letterSpacing: "0.06em", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span>{selM ? "Properties" : "Tool style"}</span>
                    <span style={{ fontWeight: 500, color: PAL.ink, textTransform: "none", letterSpacing: 0, fontSize: 11 }}>{selM ? selM.kind : `${armed} · default`}</span>
                  </div>
                  <div data-testid="property-panel" style={{ maxHeight: 220, overflowY: "auto" }}>
                    <PropertyPanel markup={subject} onChange={onPropChange} />
                  </div>
                </div>
              );
            })()}
            {/* drag-to-resize handle on the rail's right edge (B664) */}
            <div onPointerDown={startRailResize} data-testid="sheet-rail-resizer" title="Drag to resize the sheet list"
              style={{ position: "absolute", top: 0, right: -3, width: 7, height: "100%", cursor: "col-resize", zIndex: 4 }} />
          </div>
          )}

          {/* canvas + overlay — a transform viewport (B329). The sheet is a page-sized box
              positioned by translate(tx,ty) and sized by view.scale, so it pans freely in any
              direction and zooms toward the cursor (no scroll box). The wheel + pointer handlers
              live on the viewport itself, so a pan can begin anywhere — even off the sheet. */}
          <div ref={attachWrap}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onDoubleClick={onDbl} onPointerLeave={() => { setCursor(null); setHoverId(null); }}
            onContextMenu={onContextMenu}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openFile(f); }}
            style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", background: "var(--canvas-mat)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
              cursor: panning ? "grabbing" : panMode() ? "grab" : tool === "select" ? "default" : "crosshair" }}>
            {/* B660 — while the new sheet rasterises, name what's opening (the dimmed frame behind
                is the PREVIOUS sheet; without this the switch read as "it held the wrong sheet"). */}
            {numPages > 0 && pageBase && renderedPage !== page && (
              <div data-testid="sheet-switching" style={{ position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 5,
                fontSize: 11.5, fontWeight: 700, color: "var(--text-primary)", background: "var(--surface-raised)",
                border: "1px solid var(--border-default)", borderRadius: 999, padding: "4px 12px", boxShadow: "0 2px 8px rgba(0,0,0,0.18)", pointerEvents: "none" }}>
                Opening {sheetShort(page)}…
              </div>
            )}
            {pageBase && view && (
              <div style={{ position: "absolute", left: 0, top: 0, width: pageBase.w * view.scale, height: pageBase.h * view.scale, transform: `translate(${view.tx}px, ${view.ty}px)`, transformOrigin: "0 0", background: "#fff", boxShadow: "0 4px 18px rgba(0,0,0,0.25)",
                // Sheet switch (B660): until the NEW page's backdrop lands, the double-buffered canvas
                // still shows the PREVIOUS sheet — dim it so it clearly reads "in transition", never
                // "the wrong sheet". The chip below names what's opening.
                opacity: renderedPage === page ? 1 : 0.35, transition: "opacity 120ms linear" }}>
              {/* Two layers (B415). BACKDROP: the whole page at a fixed density, filling the page
                  box — never re-rastered on zoom, so it's always present as a no-white floor. DETAIL:
                  just the visible window at full device density, positioned over the backdrop, sized
                  in page-units × view.scale (so it CSS-rescales with a zoom gesture, then re-rasters
                  crisp on settle). Both pointerEvents:none so the viewport gets the gesture; the
                  detail canvas stays mounted (display:none until its first tile) so renderDetail
                  always has a canvas to draw into. The markup SVG overlay sits above both, unchanged. */}
              <canvas ref={backdropRef} style={{ display: "block", position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }} />
              <canvas ref={detailRef} style={{ position: "absolute",
                left: detailTile ? detailTile.rx * view.scale : 0, top: detailTile ? detailTile.ry * view.scale : 0,
                width: detailTile ? detailTile.rw * view.scale : 0, height: detailTile ? detailTile.rh * view.scale : 0,
                display: detailTile ? "block" : "none", pointerEvents: "none" }} />
              <svg data-testid="markup-overlay" width={pageBase.w * view.scale} height={pageBase.h * view.scale} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
                {pageMarks.map((m) => {
                  const isSel = m.id === sel || selSet.includes(m.id);
                  const isHov = m.id === hoverId && !isSel; // B156: hover glow, never on the already-selected markup
                  const el = (
                    <MarkupRenderer key={m.id}
                      markup={groupPreview?.[m.id] ? { ...m, pts: groupPreview[m.id] } : vtxPreview?.id === m.id ? { ...m, pts: vtxPreview.pts } : dragPreview?.id === m.id ? { ...m, pts: dragPreview.pts } : m}
                      view={view} selected={isSel} ftPerUnit={ftPerUnit} />
                  );
                  // Only the ONE hovered markup gets a wrapping <g> for the glow — so the overlay DOM
                  // is unchanged (markups stay direct children) whenever nothing is hovered (B156).
                  return isHov ? <g key={m.id} className="mk-hover" data-hover="1">{el}</g> : el;
                })}
                {drawDraft()}
                {/* B569 — neutral hue-free multi-select chrome (casing + line + corner grips) on every
                    member of a multi-selection; the single-select case keeps its grips/× treatment below. */}
                {selSet.length > 1 && selSet.map((id) => {
                  const m = pageMarks.find((mm) => mm.id === id); if (!m) return null;
                  const pts = groupPreview?.[id] || m.pts;
                  const bb = bboxOfMarkup(pts ? { ...m, pts } : m); if (!bb) return null;
                  const x = bb.x * view.scale - 3, y = bb.y * view.scale - 3;
                  return <SelectionChrome key={`sel${id}`} x={x} y={y} w={bb.w * view.scale + 6} h={bb.h * view.scale + 6} casing="var(--sel-casing)" line="var(--sel-line)" grips />;
                })}
                {/* B570 — live box-select rubber-band */}
                {marquee && (() => {
                  const ax = marquee.a.x * view.scale, ay = marquee.a.y * view.scale, bx = marquee.b.x * view.scale, by = marquee.b.y * view.scale;
                  return <SelectionChrome x={Math.min(ax, bx)} y={Math.min(ay, by)} w={Math.abs(bx - ax)} h={Math.abs(by - ay)} casing="var(--sel-casing)" line="var(--sel-line)" fill />;
                })()}
                {/* Vertex grip handles — small circles at each vertex of the selected markup (B431).
                    Hidden during a multi-selection (the neutral chrome above stands in). */}
                {sel && selSet.length <= 1 && !draft && (() => {
                  const selM = pageMarks.find((mm) => mm.id === sel);
                  if (!selM?.pts?.length || selM.kind === "pen" || selM.kind === "highlight") return null;
                  const src = vtxPreview?.id === sel ? vtxPreview.pts : selM.pts;
                  return src.map((q, i) => (
                    <circle key={i} cx={q.x * view.scale} cy={q.y * view.scale} r={5}
                      fill="#fff" stroke="var(--accent)" strokeWidth={1.5} />
                  ));
                })()}
              </svg>
              {/* On-canvas delete affordance (B375): a clear × on the selected markup so removing it
                  doesn't depend on knowing the Delete key. Lives OUTSIDE the pointerEvents:none overlay
                  (like the inline editors) so it takes its own click; stopPropagation keeps that click
                  from starting a pan/draw on the canvas underneath. Anchored at the markup's top-right. */}
              {sel && selSet.length <= 1 && !editing && !calInput && (() => {
                const m = pageMarks.find((mm) => mm.id === sel);
                const src = (dragPreview && dragPreview.id === sel ? dragPreview.pts : m && m.pts) || [];
                if (!m || !src.length) return null;
                const sp = src.map((q) => ({ x: q.x * view.scale, y: q.y * view.scale }));
                let rx = -Infinity, ty = Infinity;
                for (const q of sp) { rx = Math.max(rx, q.x); ty = Math.min(ty, q.y); }
                if (m.kind === "text") { rx = sp[0].x + ((m.text || "").length * 6.5 + 6); ty = sp[0].y - 12; }
                if (m.kind === "callout") { const bp = sp[1] || sp[0]; rx = bp.x + ((m.text || "").length * 6.5 + 6); ty = bp.y - 12; }
                return (
                  <button title="Delete this markup (Del)" aria-label="Delete this markup"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); pushHistory(); setMarkups((a) => a.filter((mm) => mm.id !== sel)); clearSelection(); }}
                    style={{ position: "absolute", left: rx + 6, top: ty - 2, width: 22, height: 22, display: "grid", placeItems: "center", borderRadius: "50%", border: "none", background: "var(--danger-text)", color: "var(--on-accent)", cursor: "pointer", fontSize: 15, fontWeight: 800, lineHeight: 1, boxShadow: "0 2px 8px rgba(0,0,0,0.35)", zIndex: 7, padding: 0, fontFamily: "inherit" }}>×</button>
                );
              })()}
              {editing && (
                <input autoFocus value={editing.text}
                  onChange={(ev) => setEditing((ed) => (ed ? { ...ed, text: ev.target.value } : ed))}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); closeEditor(true); } else if (ev.key === "Escape") { ev.preventDefault(); closeEditor(false); } }}
                  onBlur={() => closeEditor(true)} placeholder="Text note…"
                  style={{ position: "absolute", left: editing.pt.x * view.scale, top: editing.pt.y * view.scale - 14, font: "600 12px ui-sans-serif, system-ui, sans-serif", padding: "1px 4px", border: `1px solid ${PAL.accent}`, borderRadius: 4, background: "#fff", color: "#b91c1c", minWidth: 90, zIndex: 5 }} />
              )}
              {/* Inline Calibrate entry (B304) — replaces window.prompt; validates the typed length. */}
              {calInput && (
                <div style={{ position: "absolute", left: calInput.x, top: calInput.y, transform: "translate(-50%, -135%)", zIndex: 6, width: 214, background: "#fff", border: `1px solid ${PAL.accent}`, borderRadius: 8, padding: "7px 9px", boxShadow: "0 6px 20px rgba(0,0,0,0.28)", fontFamily: "system-ui, sans-serif" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: PAL.muted, whiteSpace: "nowrap" }}>Real length</span>
                    <input autoFocus value={calInput.value}
                      onChange={(e) => { const v = e.target.value; setCalInput((c) => (c ? { ...c, value: v } : c)); if (err) setErr(""); }}
                      onPointerDown={(e) => e.stopPropagation()}
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); commitCalibrate(); } else if (e.key === "Escape") { e.preventDefault(); setCalInput(null); setErr(""); } }}
                      placeholder={`120  or  38'-7"`}
                      style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontFamily: "inherit", padding: "3px 6px", border: `1px solid ${err ? "#dc2626" : PAL.line}`, borderRadius: 5, outline: "none" }} />
                    <button onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.preventDefault()} onClick={commitCalibrate} style={{ ...btn(true), padding: "3px 9px", fontSize: 11.5 }}>Set</button>
                  </div>
                  <div style={{ fontSize: 10.5, marginTop: 4, color: err ? "#dc2626" : PAL.muted, lineHeight: 1.35 }}>
                    {err || "Feet, or feet-inches. Enter to set · Esc to cancel."}
                  </div>
                </div>
              )}
              </div>
            )}
          </div>

          {/* tool rail (B330) — drawing/measure tools + zoom, flush to the canvas */}
          <ToolRail items={railItems} accent={MODULE_ACCENT["doc-review"]} data-testid="markup-rail" />

          {/* takeoff — collapsible (B330); a thin re-open tab when hidden */}
          {takeoffOpen ? (
          <div style={{ flex: "none", width: 246, background: "var(--surface-raised)", borderLeft: `1px solid ${PAL.line}`, overflowY: "auto", padding: 12, fontFamily: "system-ui, sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: PAL.ink }}>Takeoff</div>
              <button onClick={() => setTakeoffOpen(false)} title="Hide the takeoff panel" style={{ flex: "none", cursor: "pointer", border: "none", background: "transparent", color: PAL.muted, fontSize: 14, fontWeight: 700, lineHeight: 1, padding: "2px 4px", fontFamily: "inherit" }}>▸</button>
            </div>
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              {(() => {
                const info = calInfo[page];
                if (ftPerUnit && info?.src === "auto")
                  return <span style={{ color: "var(--warn-text)" }}>Sheet {page} — scale from sheet: <b>{info.label}</b> · verify</span>;
                if (ftPerUnit) return <span style={{ color: "var(--success-text)" }}>Sheet {page} calibrated</span>;
                if (info?.src === "nts") return <span style={{ color: "var(--warn-text)" }}>Sheet {page} — marked NOT TO SCALE</span>;
                return <span style={{ color: "var(--warn-text)" }}>Sheet {page} not calibrated — use Calibrate</span>;
              })()}
            </div>
            <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 4 }}>This sheet</div>
            {/* Every markup on the sheet (measures + redlines + notes), each click-to-select with its
                own × delete — so anything can be removed from the list even if it's hard to click on a
                dense sheet or you're not in Select mode (B376). */}
            {pageMarks.length === 0
              ? <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 10 }}>Nothing on this sheet yet.</div>
              : <div style={{ marginBottom: 10 }}>{pageMarks.map((m) => (
                  <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 2px 2px 6px", borderRadius: 6, background: m.id === sel ? "#fbf3ee" : "transparent" }}>
                    <button onClick={() => { setTool("select"); selectOne(m.id); }} title="Select this markup on the sheet"
                      style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "2px 0", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, textAlign: "left", color: "inherit" }}>
                      <span style={{ color: PAL.muted, textTransform: "capitalize", flex: "none" }}>{m.kind}</span>
                      <span style={{ color: PAL.ink, fontWeight: 650, fontFamily: "ui-monospace, monospace", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{markRowValue(m)}</span>
                    </button>
                    <button onClick={() => { pushHistory(); setMarkups((a) => a.filter((x) => x.id !== m.id)); if (sel === m.id) setSel(null); }}
                      title="Delete this markup" aria-label="Delete this markup"
                      style={{ flex: "none", width: 22, height: 22, display: "grid", placeItems: "center", border: "none", background: "transparent", cursor: "pointer", color: "var(--danger-text)", fontSize: 13, fontWeight: 800, lineHeight: 1, borderRadius: 5, fontFamily: "inherit" }}>×</button>
                  </div>
                ))}</div>}

            <div style={{ borderTop: `1px solid ${PAL.line}`, paddingTop: 8 }}>
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 6 }}>All sheets — rollup</div>
              {[["Area", `${f2(totals.areaAc)} ac`], ["", `${f0(totals.areaSf)} sf`], ["Perimeter", `${f0(totals.perimFt)} ft`], ["Distance", `${f0(totals.distFt)} ft`], ["Count", `${totals.count}`]].map(([k, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}>
                  <span style={{ color: PAL.muted }}>{k}</span>
                  <span style={{ color: PAL.ink, fontWeight: 650, fontFamily: "ui-monospace, monospace" }}>{v}</span>
                </div>
              ))}
              {totals.uncal > 0 && <div style={{ fontSize: 10.5, color: "var(--warn-text)", marginTop: 5, lineHeight: 1.4 }}>{totals.uncal} measurement(s) on uncalibrated sheets are excluded.</div>}
              <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 8 }}>Areas/counts use the shared coordinate module — the seam to feed the Site Planyr's yield panel (pending the shared coordinate spine).</div>
            </div>
            {sel && <button style={{ ...btn(false), width: "100%", marginTop: 10, color: "var(--danger-text)" }} onClick={() => { pushHistory(); const ids = selSet.length > 1 ? new Set(selSet) : new Set([sel]); setMarkups((a) => a.filter((m) => !ids.has(m.id))); clearSelection(); }}>{selSet.length > 1 ? `Delete ${selSet.length} selected` : "Delete selected"}</button>}
          </div>
          ) : null /* hidden entirely — Takeoff opens from its tool-rail button (B664), no reopen tab */}
          {/* "Opening…" overlay covers the whole canvas area, including the drop-over-an-open-doc
              path (B294/B446) where the prior sheet is still showing underneath. */}
          {openingOverlay}
        </div>
      )}

      {/* tool hint */}
      {pdfRef.current && curTool && (
        <div style={{ flex: "none", padding: "5px 12px", background: PAL.chrome, borderTop: `1px solid var(--chrome-divider)`, color: PAL.chromeMuted, fontSize: 11, fontFamily: "system-ui, sans-serif" }}>
          <b style={{ color: PAL.ember }}>{curTool.label}:</b> {curTool.hint}{err && <span style={{ color: "var(--warn-text)", marginLeft: 10 }}>{err}</span>}
        </div>
      )}

      {/* Right-click Arrange menu (B421) — Bluebeam-style z-order + Edit/Delete on the clicked
          markup. Portalled to <body> (like AnchoredMenu / the Site-row menu) so the canvas's
          overflow:hidden + stacking can't clip it; positioned at the cursor, viewport-clamped,
          dismissed on click-away / right-click-away / Escape. Arrange items grey out at the top /
          bottom of the stack. */}
      {ctxMenu && (() => {
        const m = pageMarks.find((mm) => mm.id === ctxMenu.id);
        if (!m) return null; // the selection went away (e.g. deleted) — nothing to arrange
        const st = arrangeState() || { atTop: true, atBottom: true };
        const close = () => setCtxMenu(null);
        const run = (fn) => () => { fn(); close(); };
        const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || "");
        const K = isMac ? "⌘" : "Ctrl+", SH = isMac ? "⌘⇧" : "Ctrl+Shift+";
        const ops = [
          { label: "Bring to Front", hint: `${SH}]`, disabled: st.atTop, on: () => arrange("front") },
          { label: "Bring Forward", hint: `${K}]`, disabled: st.atTop, on: () => arrange("forward") },
          { label: "Send Backward", hint: `${K}[`, disabled: st.atBottom, on: () => arrange("backward") },
          { label: "Send to Back", hint: `${SH}[`, disabled: st.atBottom, on: () => arrange("back") },
        ];
        const VW = typeof window !== "undefined" ? window.innerWidth : 1200;
        const VH = typeof window !== "undefined" ? window.innerHeight : 800;
        const W = 216, H = m.kind === "text" ? 268 : 232;
        const left = Math.max(8, Math.min(ctxMenu.x, VW - W - 8));
        const top = Math.max(8, Math.min(ctxMenu.y, VH - H - 8));
        const row = (extra = {}) => ({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, width: "100%", textAlign: "left", padding: "7px 12px", border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5, fontWeight: 500, color: PAL.ink, ...extra });
        return createPortal(
          <div onPointerDown={close} onContextMenu={(e) => { e.preventDefault(); close(); }}
            style={{ position: "fixed", inset: 0, zIndex: 4000 }}>
            <div onPointerDown={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()} role="menu"
              style={{ position: "fixed", left, top, width: W, background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 10, boxShadow: "0 14px 40px rgba(0,0,0,0.28)", overflow: "hidden", padding: "4px 0", fontFamily: "system-ui, sans-serif", zIndex: 4001 }}>
              <div style={{ fontSize: 10, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, padding: "6px 12px 4px" }}>Arrange</div>
              {ops.map((it) => (
                <button key={it.label} role="menuitem" disabled={it.disabled} onClick={run(it.on)}
                  style={row({ cursor: it.disabled ? "default" : "pointer", color: it.disabled ? "var(--text-tertiary)" : PAL.ink, opacity: it.disabled ? 0.55 : 1 })}>
                  <span>{it.label}</span>
                  <span style={{ color: it.disabled ? "var(--text-tertiary)" : PAL.muted, fontSize: 11, fontFamily: "ui-monospace, monospace" }}>{it.hint}</span>
                </button>
              ))}
              <div style={{ borderTop: "1px solid var(--border-default)", margin: "4px 0" }} />
              {m.kind === "text" && (
                <button role="menuitem" onClick={run(() => openEditor({ id: m.id, page, pt: (m.pts && m.pts[0]) || { x: 0, y: 0 }, text: m.text || "" }))} style={row()}>
                  <span>Edit text…</span>
                </button>
              )}
              <button role="menuitem" onClick={run(() => { pushHistory(); setMarkups((a) => a.filter((x) => x.id !== m.id)); setSel(null); })}
                style={row({ color: "var(--danger-text)", fontWeight: 600 })}>
                <span>Delete</span>
                <span style={{ color: "var(--text-tertiary)", fontSize: 11, fontFamily: "ui-monospace, monospace" }}>Del</span>
              </button>
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
