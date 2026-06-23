/* Document Review — PDF review core (browser-only). PDF.js viewer + multi-sheet
 * nav, calibrate-to-scale, measure tools (distance / area / perimeter / count),
 * redline (rectangle / cloud / text), and a takeoff rollup. The PDF is an
 * IMMUTABLE backdrop; all markups live on an SVG overlay (an editable layer over
 * it) and are stored in PAGE UNITS so they survive zoom. Lazy-loaded by the shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadPdf, renderInto, extractPageItems } from "./lib/pdf.js";
import { backingScale, backdropDensity, visibleRegion, tileCovers } from "./lib/renderBudget.js";
import { readSheetMeta } from "../../shared/files/sheetMeta.js";
import { groupSheets, markAdjacentDuplicateNumbers } from "../../shared/files/sheetGroups.js";
import { statedCalibration } from "./lib/sheetRead.js";
import { measureLabel, rollup, dist, midOfPath, centroidOf, canCommitMeasure, sanitizeMarkups, pointInPoly } from "./lib/takeoff.js";
import { parseFeet } from "./lib/parseLength.js";
import Stitcher from "./Stitcher.jsx";
import ReviewsBar from "./components/ReviewsBar.jsx";
import FileBrowser from "./components/FileBrowser.jsx";
import { autofilingProvider } from "./lib/autofiling.js";
import { useReviewPersistence, docSaveState } from "./lib/usePersistence.js";
import { newReviewId, newSourceId, storeSource, isStoredSource, downloadSource, downloadFromDrive, loadReview, currentUid, readDraft, reconcile, cloudReady, composeTitle } from "./lib/reviewStore.js";
import { classifySource, sourceUnavailableMessage } from "./lib/sourceState.js";
import { onAuthChange } from "../site-planner/lib/auth.js";
import { listProjects as listLocalProjects } from "../../shared/projects/projects.js";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import ToolRail from "../../shared/ui/ToolRail.jsx";
import { MODULE_ACCENT } from "../../shared/ui/moduleAccent.js";
import { screenToWorld, zoomAround, fitView, shouldPan, midpoint, distance, pinchZoom } from "../../shared/viewport/viewportTransform.js";

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
  { id: "select", label: "Select", hint: "Click a markup to select; drag to move; double-click a text note to edit; Delete removes it." },
  { id: "pan", label: "Pan", hint: "Drag to move around the sheet. (Hold Space in any tool to pan; wheel or Ctrl+scroll to zoom toward the cursor.)" },
  { id: "calibrate", label: "Calibrate", hint: "Click two points a known distance apart, then enter the real length." },
  { id: "distance", label: "Distance", hint: "Click two points to measure a distance." },
  { id: "perimeter", label: "Perimeter", hint: "Click points around a shape; double-click / Enter to close." },
  { id: "area", label: "Area", hint: "Click points around a region; double-click / Enter to close." },
  { id: "count", label: "Count", hint: "Click each item (stall, dock door); Enter / double-click to finish." },
  { id: "rect", label: "Rect", hint: "Click two opposite corners." },
  { id: "cloud", label: "Cloud", hint: "Revision cloud: click two opposite corners." },
  { id: "text", label: "Text", hint: "Click to place a text note." },
];
const MEASURE = new Set(["distance", "perimeter", "area", "count"]);

// Rail icons for the Markup tools + zoom controls (B330). 16×16, stroke = currentColor so a
// button's text colour drives them; select/pan/rect/text mirror the Site Planner's icon set.
const MK_ICONS = {
  select: <path d="M4 2.5 L12.8 8 L8.8 9 L11.2 13.6 L9.2 14.6 L6.9 9.9 L4 12.4 Z" fill="currentColor" stroke="none" />,
  pan: <path d="M5 7 V3.6 a1.1 1.1 0 0 1 2.2 0 V6.6 M7.2 6.4 V2.9 a1.1 1.1 0 0 1 2.2 0 V6.6 M9.4 6.6 V3.5 a1.1 1.1 0 0 1 2.2 0 V8.5 M11.6 6 a1.1 1.1 0 0 1 2.1 0 l-0.2 4 a4 4 0 0 1-4 3.6 H8 a4 4 0 0 1-3.3-1.8 L2.6 9.6 a1.1 1.1 0 0 1 1.7-1.4 L5 9" />,
  calibrate: <><path d="M2.3 10.5 L10.5 2.3 L13.7 5.5 L5.5 13.7 Z" /><path d="M4.9 7.7 l1.5 1.5 M7.3 5.3 l1.5 1.5" /></>,
  distance: <><path d="M3 12.6 L13 3.4" /><circle cx="3" cy="12.6" r="1.5" fill="currentColor" stroke="none" /><circle cx="13" cy="3.4" r="1.5" fill="currentColor" stroke="none" /></>,
  perimeter: <path d="M8 2.6 L13.4 6.2 L11.3 12.6 L4.7 12.6 L2.6 6.2 Z" strokeDasharray="2.4 1.6" />,
  area: <path d="M8 2.6 L13.4 6.2 L11.3 12.6 L4.7 12.6 L2.6 6.2 Z" fill="currentColor" fillOpacity="0.3" />,
  count: <><circle cx="4.7" cy="5.2" r="1.7" fill="currentColor" stroke="none" /><circle cx="10.9" cy="6.1" r="1.7" fill="currentColor" stroke="none" /><circle cx="6.7" cy="11.2" r="1.7" fill="currentColor" stroke="none" /></>,
  rect: <rect x="2.5" y="3.5" width="11" height="9" rx="0.5" />,
  cloud: <path d="M5.2 11.6 a2.3 2.3 0 0 1-.5-4.5 a2.7 2.7 0 0 1 5.1-1 a2.2 2.2 0 0 1 2.6 3.2 a2.1 2.1 0 0 1-1.5 2.9 a2.3 2.3 0 0 1-2.2.9 a2.4 2.4 0 0 1-3-.4 Z" />,
  text: <><rect x="2.5" y="3" width="11" height="10" rx="1" /><path d="M5.4 6 H10.6 M8 6 V10.6" /></>,
  zoomIn: <path d="M8 3.4 V12.6 M3.4 8 H12.6" strokeWidth="1.7" />,
  zoomOut: <path d="M3.4 8 H12.6" strokeWidth="1.7" />,
  fitW: <><path d="M2.6 8 H13.4" /><path d="M2.6 8 l2.3 -2.3 M2.6 8 l2.3 2.3 M13.4 8 l-2.3 -2.3 M13.4 8 l-2.3 2.3" /></>,
  fitP: <><rect x="2.6" y="3.4" width="10.8" height="9.2" rx="1" /><rect x="5.4" y="5.8" width="5.2" height="4.4" rx="0.5" opacity="0.55" /></>,
};
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
} = {}) {
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
  // Destroy the previous PDF document before swapping in a new one — frees the worker
  // + retained ArrayBuffer; without this every re-open leaks the prior doc (B39).
  const setPdfDoc = (next) => {
    const prev = pdfRef.current;
    if (prev && prev !== next) { try { prev.destroy(); } catch (_) {} }
    pdfRef.current = next;
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
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [tool, setTool] = useState("select");
  const [markups, setMarkups] = useState([]);       // all pages; coords in PAGE UNITS
  const [calByPage, setCalByPage] = useState({});   // pageNum -> ftPerUnit
  const [calInfo, setCalInfo] = useState({});       // pageNum -> { src:'auto'|'manual'|'nts', label } (B267)
  const [sheetMeta, setSheetMeta] = useState({});   // pageNum -> readSheetMeta facts (sheet #, title, …) for the labeled, grouped sidebar (B266/B348)
  const [openGroups, setOpenGroups] = useState({}); // groupId -> expanded? in the logical-sheet list (B348)
  const [draft, setDraft] = useState(null);         // in-progress { kind, pts:[...] }
  const [cursor, setCursor] = useState(null);       // page-unit cursor for live preview
  const [sel, setSel] = useState(null);             // selected markup id
  const [fitMode, setFitMode] = useState("width");  // 'width' | 'page' — how a fit (scale===0) is computed (B295)
  const [spaceHeld, setSpaceHeld] = useState(false); // hold-Space = temporary pan in any tool (B289/B329)
  const [panning, setPanning] = useState(false);    // a pan drag is in progress (grab/grabbing cursor)
  const [dragPreview, setDragPreview] = useState(null); // live { id, pts } while dragging a markup (B293)
  const [editing, setEditing] = useState(null);     // inline text editor { id|null, page, pt, text } (B293)
  const [calInput, setCalInput] = useState(null);   // inline Calibrate entry { pts:[pageUnits], x, y (screen px), value } (B304 — no window.prompt)
  const [loadNonce, setLoadNonce] = useState(0);    // bump to force a fresh fit on open / reset / load (B329)
  const viewRef = useRef(view); viewRef.current = view; // live view for the once-bound wheel handler
  const pageRef = useRef(page); pageRef.current = page; // live page for the ref-driven render callbacks (B415)
  const pageBaseRef = useRef(pageBase); pageBaseRef.current = pageBase;
  const panRef = useRef(null);        // active pan drag { sx, sy, tx0, ty0 } (B329)
  const pointersRef = useRef(new Map()); // live touch pointers → viewport-relative {x,y} (B331)
  const pinchRef = useRef(null);         // active two-finger pinch { mid, dist } (B331)
  const touchPinchedRef = useRef(false); // a pinch occurred this touch sequence → suppress the tap on lift (B331)
  const dragRef = useRef(null);       // active markup move { id, start, orig, moved } (B293)
  const editDoneRef = useRef(false);  // guard so a commit + the unmount blur don't double-fire (B293)

  // --- cloud persistence (single-sheet review) ---
  const [reviewId, setReviewId] = useState(() => newReviewId());
  const [meta, setMeta] = useState(() => newMeta()); // { title, projectId, project, discipline, item, revision, docDate }
  const [source, setSource] = useState(null);     // { srcId, name, size, storageKey, oversize }
  const [redrop, setRedrop] = useState("");        // "re-drop on load" banner when bytes aren't available
  const [openErr, setOpenErr] = useState("");      // visible banner when an open no-ops / loadReview returns null (NEW-1) — so it can't fail silently
  const [signedIn, setSignedIn] = useState(false);
  // Work Item B: the file browser is the LANDING surface. `browsing` true = show the
  // tree/facets/list; opening or starting a file flips to the review canvas; the 🗂 Files
  // button (or selecting a project) brings the browser back.
  const [browsing, setBrowsing] = useState(true);
  const [takeoffOpen, setTakeoffOpen] = useState(true); // right-side Takeoff panel collapse (B330)
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
    setDraft(null); setSel(null); setCalInput(null); setDragPreview(null); setEditing(null);
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
    setPage(t); setDraft(null); setSel(null); setCalInput(null); setDragPreview(null);
  };

  /* ---- load ---- */
  const sameName = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

  // Read each sheet's metadata in the background (B348): sheet #, title, discipline, stated scale —
  // via the SAME shared reader the Stitcher uses (sheetMeta.readSheetMeta), so the single-sheet
  // sidebar can show real labels + collapse into logical sheets instead of "Sheet N" (B266). Also
  // pre-fills the per-sheet stated-scale calibration (B267) via the shared statedCalibration (which
  // gates on a standard plot size), never overwriting a user/loaded cal. A page with no text layer
  // reads hasText:false — the OCR seam (shared with B267/B336). Superseded if another file opens.
  const scanTok = useRef(0);
  const scanSheets = useCallback(async (pdf, pages) => {
    const tok = ++scanTok.current;
    for (let p = 1; p <= pages; p++) {
      if (tok !== scanTok.current) return;             // a newer open superseded this scan
      const page = await extractPageItems(pdf, p);
      if (tok !== scanTok.current) return;
      const meta = { ...readSheetMeta(page), width: page.width, height: page.height };
      setSheetMeta((m) => ({ ...m, [p]: meta }));
      const sc = meta.scale;
      if (sc && sc.explicit === "nts") { setCalInfo((m) => (m[p] ? m : { ...m, [p]: { src: "nts", label: sc.label } })); continue; }
      const ft = statedCalibration(meta); // 0 unless a trustworthy stated scale on a standard plot size
      if (ft) {
        setCalByPage((c) => (c[p] ? c : { ...c, [p]: ft }));
        setCalInfo((m) => (m[p] ? m : { ...m, [p]: { src: "auto", label: (sc && sc.label) || "" } }));
      }
    }
  }, []);

  // Logical sheets (B348): collapse the read pages into the SAME logical groups the Stitcher uses —
  // consecutive pages sharing a plan type + a contiguous sheet-number run become one entry
  // ("Grading Plan · C-5–C-9 · 5 sheets"); cover/notes/one-offs stay standalone. Each group's pages
  // carry pageNum so the sidebar maps a logical entry back to real sheets. Recomputes as the read fills in.
  // The read pages in order, with duplicate adjacent sheet numbers cleared (cross-reference
  // misreads — B378). This ONE cleaned array feeds both the grouping and every per-page label
  // lookup, so the sidebar never shows the same wrong number on several rows. `metaOf(n)` reads it.
  const orderedMeta = useMemo(
    () => markAdjacentDuplicateNumbers(Array.from({ length: numPages }, (_, i) => ({ pageNum: i + 1, ...(sheetMeta[i + 1] || {}) }))),
    [sheetMeta, numPages]
  );
  const metaOf = (n) => orderedMeta[n - 1] || sheetMeta[n] || null;
  const groups = useMemo(() => groupSheets(orderedMeta), [orderedMeta]);

  const openFile = async (file) => {
    if (!file) return;
    // Validate before buffering the whole file into memory (a non-PDF / 0-byte / huge
    // file would otherwise be read via arrayBuffer() and only then fail).
    if (!file.size || !(/\.pdf$/i.test(file.name) || file.type === "application/pdf")) { setErr("Please drop a PDF file."); return; }
    setBusy(true); setErr(""); setBrowsing(false); // opening a PDF → show the review canvas
    try {
      const pdf = await loadPdf(file);
      setPdfDoc(pdf);
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
      setSource({ ...base, storageKey: null, driveKey: null, oversize: false });
      // Store Drive-first, Supabase-fallback (B322). The source stays keyless in state until
      // this resolves, and buildSnapshot won't persist a keyless source, so a quick reload
      // mid-upload can't strand the backdrop with an unfetchable pointer (B323).
      storeSource(srcId, file, { projectId: meta.projectId, discipline: meta.discipline, fileName: file.name }).then((r) => {
        setSource((s) => (s && s.srcId === srcId ? { ...s, storageKey: r.storageKey || null, driveKey: r.driveKey || null, oversize: !!r.oversize } : s));
      }).catch(() => {}); // best-effort store; a rejection mustn't become an unhandled rejection
    } catch (e) {
      setErr("Couldn't open that PDF. Make sure it's a valid PDF file.");
    } finally { setBusy(false); }
  };

  /* ---- prepare page + fit (B329) ---- */
  const VIEW_MIN = 0.05, VIEW_MAX = 6; // px-per-page-unit clamp for the viewport
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
    const id = setTimeout(() => setDetailReq((n) => n + 1), 140);
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
        scale: 1, density: backdropDensity(base.w, base.h, deviceDpr()),
        onTask: (t) => { backdropTaskRef.current = t; }, isStale: () => tok !== backdropTok.current });
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
        scale: v.scale, density, region: reg.rect,
        onTask: (t) => { renderTaskRef.current = t; }, isStale: () => tok !== renderTok.current });
      if (!d || tok !== renderTok.current) return; // superseded mid-render (B40), or a newer render won
      const tile = { ...reg.rect, scale: v.scale };
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
  // synchronous local mirror, so an edit made just before reload isn't lost).
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastSingleId", reviewId); } catch (_) {} }, [reviewId]);
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastMode", mode); } catch (_) {} }, [mode]);

  const loadTok = useRef(0); // a newer open supersedes an in-flight single-review load (B52)
  const fetchSourceBytes = async (src, tok) => {
    const superseded = () => tok != null && tok !== loadTok.current; // a newer open won
    if (superseded()) return; // superseded before fetching
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
    const pdf = await loadPdf(buf);
    if (tok != null && tok !== loadTok.current) { try { pdf.destroy(); } catch (_) {} return; } // superseded — free the doc we just loaded
    setPdfDoc(pdf);
    setNumPages(pdf.numPages); setView(null); setPageBase(null); detailTileRef.current = null; setDetailTile(null); setLoadNonce((n) => n + 1); // refit on load (B329)
    scanSheets(pdf, pdf.numPages); // re-read sheets for the labeled/grouped sidebar (B266/B348); won't override saved cals
  };
  const loadSingleReview = async (rec) => {
    const tok = ++loadTok.current; // supersede any in-flight load so its late PDF can't land on this review (B52)
    suspendSave(); // don't let this programmatic load re-save itself with a fresh updatedAt (B19)
    setBrowsing(false); // a review is opening → leave the browser for the review canvas
    const s = rec.single || {};
    const src = (rec.sources || [])[0] || null;
    setPdfDoc(null);
    sourceRef.current = src ? { srcId: src.srcId, name: src.name } : null;
    setReviewId(rec.id);
    setMeta({ title: rec.title || "", projectId: rec.projectId || null, project: rec.project || "", discipline: rec.discipline || "", item: rec.item || "", revision: rec.revision || "", docDate: rec.docDate || "" });
    if (rec.projectId) onNavigate?.({ projectId: rec.projectId }); // reflect the open file's project in the URL + breadcrumb (Work Item A)
    setSource(src ? { srcId: src.srcId, name: src.name, size: src.size || 0, storageKey: src.storageKey || null, driveKey: src.driveKey || null, oversize: !!src.oversize } : null);
    setMarkups(sanitizeMarkups(s.markups)); setCalByPage(s.calByPage || {}); setCalInfo(s.calInfo || {}); // sanitize: a corrupted/partial saved review can't crash the overlay
    setSheetMeta({}); setOpenGroups({}); // re-read on load (B266/B348); saved cals preserved
    setFileName(s.fileName || ""); setNumPages(s.numPages || 0); setPage(s.page || 1);
    setDraft(null); setSel(null); setTool("select"); setRedrop(""); setCalInput(null); clearHistory();
    scanTok.current++; // a programmatic load supersedes any in-flight auto-scale scan (use the saved cals)
    await fetchSourceBytes(src, tok);
  };
  const resetSingle = () => {
    setBrowsing(false); // "New" → a fresh blank review canvas (still in the current project)
    setPdfDoc(null); sourceRef.current = null;
    setReviewId(newReviewId());
    setMeta(newMeta());
    // Keep the current project context: "New" starts a fresh blank review still filed
    // under the project you're in (it does NOT drop you back to "Select a project").
    setSource(null); setRedrop("");
    setFileName(""); setNumPages(0); setPage(1); setView(null); setPageBase(null); detailTileRef.current = null; setDetailTile(null); setLoadNonce((n) => n + 1);
    setMarkups([]); setCalByPage({}); setCalInfo({}); setSheetMeta({}); setOpenGroups({}); setDraft(null); setSel(null); setTool("select"); setCalInput(null);
    clearHistory();
    scanTok.current++; // cancel any in-flight scan from a prior file
  };
  // Open a saved review from either toolbar OR the global Project Files panel; route single
  // vs. stitch by kind. Surfaces a visible error if the row can't be loaded so an open can
  // never fail silently again (NEW-1).
  const openReview = async (row) => {
    if (!row || !row.id) return;
    setOpenErr("");
    let rec = null;
    try { rec = await loadReview(row.id); } catch (_) { rec = null; }
    if (!rec) {
      setOpenErr(`Couldn't open “${row.title || row.item || "that file"}”. It may have been removed, or the cloud is unreachable — try again.`);
      return;
    }
    // Carry the project context through so the breadcrumb reflects the opened file (single
    // reviews also navigate inside loadSingleReview; this also covers stitch).
    if (rec.projectId) onNavigate?.({ projectId: rec.projectId });
    if (rec.kind === "stitch") { setPendingStitch(rec); setMode("stitch"); }
    else { setMode("review"); await loadSingleReview(rec); }
  };

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
  // Resume the last review (and its mode) on mount, once. Stitch reviews are handed
  // to <Stitcher> via pendingStitch; single reviews load here.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return; booted.current = true;
    // A cross-workspace open is incoming — let the docIntent effect load THAT review rather
    // than also resuming the last one (the two are async and would race; resume could win
    // and silently replace the file the user just clicked). (NEW-1)
    if (bootDocIntentRef.current) return;
    // Work Item B: with a project active, Markup lands on the FILE BROWSER (the last file is
    // one click away in the list) — don't auto-open it into the canvas. Resume-into-canvas
    // stays only for the project-less single-file workflow (e.g. a logged-out local review).
    if (projectId) return;
    (async () => {
      let lastMode = "review", lastSingle = null, lastStitch = null;
      try {
        lastMode = localStorage.getItem("planyr:docreview:lastMode") || "review";
        lastSingle = localStorage.getItem("planyr:docreview:lastSingleId");
        lastStitch = localStorage.getItem("planyr:docreview:lastStitchId");
      } catch (_) {}
      const uid = await currentUid();
      // Respect an explicit deep link (Work Item A): if the URL named a project, don't
      // auto-resume a review that belongs to a DIFFERENT project — show the linked
      // project's browser instead. No URL project → resume freely (it reflects into the URL).
      const wrongProject = (rec) => projectId && rec && rec.projectId && rec.projectId !== projectId;
      if (lastMode === "stitch" && lastStitch) {
        const rec = reconcile(await loadReview(lastStitch), readDraft(uid, lastStitch));
        if (rec && rec.kind === "stitch" && !wrongProject(rec)) { setPendingStitch(rec); setMode("stitch"); return; }
      }
      if (lastSingle) {
        const rec = reconcile(await loadReview(lastSingle), readDraft(uid, lastSingle));
        if (rec && rec.kind === "single" && !wrongProject(rec)) await loadSingleReview(rec);
      }
    })();
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

  const commit = (mk) => { pushHistory(); setMarkups((a) => [...a, { id: uid(), page, ...mk }]); setDraft(null); };

  const panMode = () => tool === "pan" || spaceHeld;

  const openEditor = (ed) => { editDoneRef.current = false; setEditing(ed); };
  const closeEditor = (save) => {
    if (editDoneRef.current) return; // a prior Enter/Esc already handled it; ignore the unmount blur (B293)
    editDoneRef.current = true;
    const ed = editing; setEditing(null);
    if (!save || !ed) return;
    const text = (ed.text || "").trim();
    if (!text) { if (ed.id) { pushHistory(); setMarkups((a) => a.filter((m) => m.id !== ed.id)); } return; } // empty → drop / delete
    pushHistory();
    if (ed.id) setMarkups((a) => a.map((m) => (m.id === ed.id ? { ...m, text } : m)));
    else setMarkups((a) => [...a, { id: uid(), page: ed.page, kind: "text", pts: [ed.pt], text }]);
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
    const p = toPage(e);
    // Select only "grabs" a markup when the click lands on one; an empty-canvas Select drag
    // pans instead (Bluebeam). hitTest is cheap + math-based, so probe it up front for the rule.
    const hitId = tool === "select" ? hitTest(p) : null;
    // Bluebeam pan/tool collision (shared rule): middle-mouse / Space / Pan tool / Select-on-
    // empty → pan; Select-on-object → select/move; a drawing tool → draw, never pan. (B329)
    if (shouldPan({ button: e.button, spaceHeld, tool, onObject: !!hitId })) {
      e.preventDefault();
      if (tool === "select") setSel(null); // a pan starting on empty canvas also clears the selection
      panRef.current = { sx: e.clientX, sy: e.clientY, tx0: view.tx, ty0: view.ty };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      setPanning(true);
      return;
    }
    if (e.button !== 0) return; // only the left button draws / selects past here
    if (tool === "select") {
      setSel(hitId);
      if (hitId) { // arm a move-drag; a sub-threshold drag stays a plain click-select (B293)
        const m = pageMarks.find((mm) => mm.id === hitId);
        if (m) { dragRef.current = { id: hitId, start: p, orig: (m.pts || []).map((q) => ({ x: q.x, y: q.y })), moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }
      }
      return;
    }
    if (tool === "text") return; // text opens on pointer-UP (below) so the click's own focus change can't blur+discard the fresh editor (B293)
    if (tool === "calibrate" || tool === "distance" || tool === "rect" || tool === "cloud") {
      if (!draft) setDraft({ kind: tool, pts: [p] });
      else {
        const pts = [draft.pts[0], p];
        if (tool === "calibrate") finishCalibrate(pts);
        else commit({ kind: tool, pts });
        setDraft(null);
      }
      return;
    }
    if (tool === "area" || tool === "perimeter" || tool === "count") {
      setDraft((d) => (d && d.kind === tool ? { ...d, pts: [...d.pts, p] } : { kind: tool, pts: [p] }));
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
    const p = toPage(e);
    if (dragRef.current) { // moving a markup: translate its page-unit points live (B293)
      const dx = p.x - dragRef.current.start.x, dy = p.y - dragRef.current.start.y;
      if (!dragRef.current.moved && Math.hypot(dx * view.scale, dy * view.scale) < 3) { setCursor(p); return; }
      dragRef.current.moved = true;
      setDragPreview({ id: dragRef.current.id, pts: dragRef.current.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) });
      return;
    }
    setCursor(p);
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
    // Text places on release: opening the inline editor here (not on pointer-down) means the
    // click's own focus change has already happened, so autofocus sticks and the empty editor
    // isn't immediately blurred + discarded. (B293)
    if (tool === "text" && e.button === 0) openEditor({ id: null, page, pt: toPage(e), text: "" });
  };

  // Always clear pan/move state on an interrupted gesture so the canvas can't get stuck
  // behind a frozen grab cursor (cf. B271, the origin/main frozen-cursor lockout).
  const onCancel = (e) => {
    if (e && e.pointerType === "touch" && e.pointerId != null) pointersRef.current.delete(e.pointerId);
    reseedPinch();
    if (pointersRef.current.size === 0) touchPinchedRef.current = false;
    panRef.current = null; setPanning(false); dragRef.current = null; setDragPreview(null);
  };

  const finishDraft = () => {
    if (!draft) return;
    const { kind, pts } = draft;
    // Area + perimeter need ≥3 points to be real polygons; a 2-point area is 0 sf and a
    // 2-point perimeter is a single segment, both meaningless in the takeoff (B302).
    if ((kind === "count" || kind === "area" || kind === "perimeter") && canCommitMeasure(kind, pts.length)) commit({ kind, pts });
    else setDraft(null);
  };
  const onDbl = (e) => {
    if (tool === "select") { // double-click a text note → edit it inline (B293)
      const m = pageMarks.find((mm) => mm.id === hitTest(toPage(e)));
      if (m && m.kind === "text") openEditor({ id: m.id, page, pt: (m.pts && m.pts[0]) || { x: 0, y: 0 }, text: m.text || "" });
      return;
    }
    if (!draft) return;
    // The browser fires TWO pointerdowns before a dblclick, each appending a coincident
    // point at the finish spot — strip that trailing run so a Count isn't inflated and a
    // poly isn't distorted. Enter (no extra downs) keeps every point. (B291)
    if (draft.kind === "area" || draft.kind === "perimeter" || draft.kind === "count") {
      const d = toPage(e), tol = 6 / view.scale;
      const pts = draft.pts.slice();
      while (pts.length && dist(pts[pts.length - 1], d) <= tol) pts.pop();
      // Same min-point gate as Enter/finishDraft so a 2-point area/perimeter can't slip in
      // via double-click either (count ≥1, area/perimeter ≥3). (B302)
      if (canCommitMeasure(draft.kind, pts.length)) commit({ kind: draft.kind, pts });
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

  const hitTest = (p) => {
    const Z = view ? view.scale : 1;
    const tol = 10 / Z; // page-unit click tolerance
    const segDist = (a, b) => { // distance from p to segment a–b (page units)
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      if (!L2) return dist(p, a);
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
      return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
    };
    const bboxArea = (pts) => { // tie-break for interior hits (the smaller shape wins)
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      return (x1 - x0) * (y1 - y0);
    };
    // Among interior (d===0) hits, prefer the SMALLEST shape so a small markup sitting on top of a
    // big filled area stays selectable instead of being swallowed by the area underneath it (B374).
    let best = null, bd = Infinity, bArea = Infinity;
    for (const m of pageMarks) {
      const pts = m.pts || [];
      let d = Infinity, interior = false;
      if (m.kind === "rect" || m.kind === "cloud") {
        // shape-aware: a box is selectable across its whole body, not just its 2 corners (B33)
        const a = pts[0], b = pts[1]; if (!a || !b) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        if (p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol) { d = 0; interior = true; }
      } else if (m.kind === "text") {
        // the text box (offsets mirror the render; screen px → page units via /scale) (B33)
        const q = pts[0]; if (!q) continue;
        const w = ((m.text || "").length * 6.5 + 6) / Z, h = 16 / Z;
        if (p.x >= q.x - 2 / Z && p.x <= q.x - 2 / Z + w && p.y >= q.y - 12 / Z && p.y <= q.y - 12 / Z + h) { d = 0; interior = true; }
      } else if (m.kind === "area") {
        // B33 generalized to the AREA polygon (B374): its FILLED interior is grabbable, so a click
        // anywhere inside selects it — not just an edge/vertex (the dead-centre bug Michael hit). A
        // thin / degenerate (<3-pt) area still selects by its edge or vertex via the fallback.
        if (pts.length >= 3 && pointInPoly(p, pts)) { d = 0; interior = true; }
        else {
          for (let i = 0; i < pts.length; i++) { d = Math.min(d, dist(p, pts[i])); if (i > 0) d = Math.min(d, segDist(pts[i - 1], pts[i])); }
          if (pts.length > 2) d = Math.min(d, segDist(pts[pts.length - 1], pts[0])); // closing edge
        }
      } else {
        // distance / perimeter / count: nearest vertex OR segment (so the line body selects)
        for (let i = 0; i < pts.length; i++) { d = Math.min(d, dist(p, pts[i])); if (i > 0) d = Math.min(d, segDist(pts[i - 1], pts[i])); }
        if (m.kind === "perimeter" && pts.length > 2) d = Math.min(d, segDist(pts[pts.length - 1], pts[0])); // closing edge
      }
      const a = interior ? bboxArea(pts) : Infinity;
      if (d < bd - 1e-6 || (d <= bd + 1e-6 && a < bArea)) { bd = d; best = m.id; bArea = a; }
    }
    return bd <= tol ? best : null;
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
    if (mod) return; // leave other modified keys (copy/paste/etc.) to the browser
    if (e.key === " " || e.code === "Space") { if (!spaceHeld) setSpaceHeld(true); e.preventDefault(); return; } // hold-Space = pan (B289)
    if (e.key === "Enter") { e.preventDefault(); finishDraft(); }
    else if (e.key === "Escape") { setDraft(null); setSel(null); setDragPreview(null); dragRef.current = null; setCalInput(null); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      if (removeLastVertex()) { e.preventDefault(); return; }            // trim a draft vertex first (B303)
      if (sel) { e.preventDefault(); pushHistory(); setMarkups((a) => a.filter((m) => m.id !== sel)); setSel(null); }
    }
    // Sheet paging (B306) — only when not mid-draft / mid-entry so arrows don't drop work.
    else if (!draft && !calInput && (e.key === "ArrowLeft" || e.key === "PageUp")) { e.preventDefault(); goToPage(page - 1); }
    else if (!draft && !calInput && (e.key === "ArrowRight" || e.key === "PageDown")) { e.preventDefault(); goToPage(page + 1); }
  };
  useEffect(() => {
    const onKey = (e) => onKeyRef.current && onKeyRef.current(e);
    const onKeyUp = (e) => { if (e.key === " " || e.code === "Space") setSpaceHeld(false); };
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
  const markRowValue = (m) => MEASURE.has(m.kind) ? measureLabel(m, ftPerUnit) : m.kind === "text" ? ((m.text || "").trim() || "empty note") : "";
  // Toolbar buttons: nowrap (so labels never break mid-word into uneven multi-line chips)
  // + tightened padding for density on the single header row (B305).
  const btn = (on) => ({ padding: "5px 9px", fontSize: 12, lineHeight: 1.1, whiteSpace: "nowrap", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${on ? PAL.accent : "var(--border-default)"}`, background: on ? PAL.accent : "var(--surface-raised)", color: on ? "var(--on-accent)" : PAL.ink });
  const chromeBtn = (extra = {}) => ({ ...btn(false), border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: PAL.chromeInk, ...extra });
  const iconBtn = (disabled) => ({ ...btn(false), padding: "5px 7px", opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" });
  const tbDiv = { width: 1, height: 18, background: "var(--chrome-divider)", margin: "0 2px", flex: "none" };
  const curTool = TOOLS.find((t) => t.id === tool);
  // Logical-sheet sidebar helpers (B266/B348): a calibration dot, a short sheet id, a rich tooltip.
  const calMark = (n) => (calInfo[n]?.src === "auto" ? " ·≈" : calByPage[n] ? " ·✓" : "");
  const sheetShort = (n) => metaOf(n)?.sheetNumber || `Sheet ${n}`;
  // Do we trust the read title enough to surface it as the label (B378)? A title is trustworthy
  // when it came from a detected title-block band, OR is corroborated by a real sheet number read
  // from the title-block zone, OR the sheet is a recognized text page (general notes / specs, where
  // the title IS its identity). A bare band — or nothing — no longer authorizes a body line as the
  // label (the old `hasReal` gate that let copyright/legend prose through).
  const trustedTitle = (m) =>
    m?.sheetTitle && m.sheetTitle !== "Document" && (m.titleBlock || m.sheetNumber || m.textDense) ? m.sheetTitle : "";
  // The human label for a single sheet: the trusted title ("GENERAL NOTES"), else the deterministic
  // discipline item ("Grading Plan"), with the sheet number appended; else just the number; else
  // "Sheet N". Returns { label, real }.
  const sheetLabel = (n) => {
    const m = metaOf(n);
    const title = trustedTitle(m) || (m?.item && m.item.toLowerCase() !== "document" ? m.item : "");
    const num = m?.sheetNumber ? ` · ${m.sheetNumber}` : "";
    if (title) return { label: `${title}${num}`, real: true };
    if (m?.sheetNumber) return { label: m.sheetNumber, real: true };
    return { label: `Sheet ${n}`, real: false };
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
  const railItems = [
    ...TOOLS.map((t) => ({ kind: "tool", id: t.id, label: t.label, title: t.hint, icon: <MkIcon id={t.id} />, active: tool === t.id, onClick: () => { setTool(t.id); setDraft(null); setCalInput(null); } })),
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
      onReview={() => setMode("review")}
      loadReq={pendingStitch}
      onConsumeLoad={() => setPendingStitch(null)}
      onOpenReview={openReview}
      signedIn={signedIn}
    />
  );

  // SVG element for one markup (coords ×scale)
  const draw = (m, selected) => {
    const S = (q) => ({ x: q.x * view.scale, y: q.y * view.scale });
    const stroke = selected ? PAL.accent : (MEASURE.has(m.kind) ? "#0e7490" : "#b91c1c");
    const lbl = MEASURE.has(m.kind) ? measureLabel(m, ftPerUnit) : null;
    const labelAt = (x, y, text, color) => (
      <text x={x} y={y} fontSize="11" fontWeight="700" fill={color} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }} pointerEvents="none">{text}</text>
    );
    if (m.kind === "distance" || m.kind === "perimeter") {
      const pts = m.pts.map(S);
      const closed = m.kind === "perimeter";
      const dd = (closed ? [...pts, pts[0]] : pts).map((q) => `${q.x},${q.y}`).join(" ");
      const mid = midOfPath(pts, closed); // true arc-length midpoint, not a vertex (B307)
      return <g key={m.id}><polyline points={dd} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 2} />{pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={stroke} />)}{lbl && labelAt(mid.x + 4, mid.y - 4, lbl, "#0e7490")}</g>;
    }
    if (m.kind === "area") {
      const pts = m.pts.map(S);
      const c = centroidOf(pts); // area-weighted centroid, clamped inside concave shapes (B307)
      return <g key={m.id}><polygon points={pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="#0e749022" stroke={stroke} strokeWidth={selected ? 3 : 2} />{lbl && labelAt(c.x, c.y, lbl, "#0e7490")}</g>;
    }
    if (m.kind === "count") {
      const pts = m.pts.map(S);
      return <g key={m.id}>{pts.map((q, i) => <g key={i}><circle cx={q.x} cy={q.y} r={7} fill="#0e749033" stroke={stroke} strokeWidth={1.5} /><text x={q.x} y={q.y + 3} fontSize="8" textAnchor="middle" fill="#0e7490" fontWeight="700" pointerEvents="none">{i + 1}</text></g>)}</g>;
    }
    if (m.kind === "rect" || m.kind === "cloud") {
      const a = S(m.pts[0]), b = S(m.pts[1]);
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      return m.kind === "cloud"
        ? <path key={m.id} d={cloudPath(x, y, w, h)} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 2} />
        : <rect key={m.id} x={x} y={y} width={w} height={h} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 2} />;
    }
    if (m.kind === "text") {
      const q = S((m.pts && m.pts[0]) || { x: 0, y: 0 });
      const text = m.text || ""; // guard a missing text (mirrors hitTest) so one bad note can't crash the overlay
      return <g key={m.id}><rect x={q.x - 2} y={q.y - 12} width={(text.length * 6.5) + 6} height={16} fill="#fff" stroke={stroke} strokeWidth={1} rx={3} /><text x={q.x + 2} y={q.y} fontSize="11" fill="#b91c1c" fontWeight="600" pointerEvents="none">{text}</text></g>;
    }
    return null;
  };

  const drawDraft = () => {
    if (!draft) return null;
    const S = (q) => ({ x: q.x * view.scale, y: q.y * view.scale });
    const pts = draft.pts.map(S);
    const cur = cursor ? S(cursor) : null;
    const col = draft.kind === "calibrate" ? PAL.accent : MEASURE.has(draft.kind) ? "#0e7490" : "#b91c1c";
    if (draft.kind === "distance" || draft.kind === "calibrate") {
      const a = pts[0]; if (!a) return null;
      return <g>{cur && <line x1={a.x} y1={a.y} x2={cur.x} y2={cur.y} stroke={col} strokeWidth={2} strokeDasharray="5 4" />}<circle cx={a.x} cy={a.y} r={3} fill={col} /></g>;
    }
    if (draft.kind === "rect" || draft.kind === "cloud") {
      const a = pts[0]; if (!a || !cur) return <g><circle cx={a?.x} cy={a?.y} r={3} fill={col} /></g>;
      const x = Math.min(a.x, cur.x), y = Math.min(a.y, cur.y), w = Math.abs(cur.x - a.x), h = Math.abs(cur.y - a.y);
      return draft.kind === "cloud" ? <path d={cloudPath(x, y, w, h)} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" /> : <rect x={x} y={y} width={w} height={h} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" />;
    }
    // poly / count
    const seq = cur ? [...pts, cur] : pts;
    return <g>{seq.length > 1 && <polyline points={seq.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={col} strokeWidth={2} strokeDasharray="5 4" />}{pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3.5} fill={col} />)}{draft.kind === "count" && <text x={(pts[pts.length-1]||{x:8}).x + 8} y={(pts[pts.length-1]||{y:8}).y} fontSize="11" fontWeight="700" fill={col}>{pts.length}</text>}</g>;
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.paper, position: "relative" }}>
      <AppHeader
        module={shellModule || "doc-review"}
        onSwitch={onShellSwitch}
        // Breadcrumb (B191–B193): Dashboard leaves Markup for the all-projects map;
        // picking a project browses its files in place (the file browser, scoped to it);
        // New project is born in the Site Planner. Save state from persistence.
        onDashboard={onGoDashboard}
        currentProject={markupProject}
        cross={crossProject}
        onSelectProject={(id) => { onNavigate?.({ projectId: id }); setBrowsing(true); }}
        onNewProject={onNewProject}
        // The compact Row-1 CloudSyncBadge (NEW-1) reads this normalized state; docSaveState
        // keeps the "a failed write is LOUD, never silent" contract (unit-locked).
        saveState={docSaveState(status, signedIn, isEmpty())}
        onRetrySave={status === "conflict" ? undefined : saveNow}
        saveDetail={status === "conflict" ? "This review was changed in another session. Reload to merge in the latest before saving — your edit is safe on this device." : undefined}
        centerContent={
          // The 🗂 Files button returns to the file browser landing from the review canvas
          // (B6). It reads as active while browsing. The project name itself isn't repeated
          // here — the Row-1 breadcrumb is its one canonical home (B357).
          <button onClick={() => setBrowsing(true)} title="Back to the project file browser"
            aria-pressed={browsing}
            style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "3px 10px",
              border: `1px solid ${browsing ? "var(--accent-markup)" : "var(--chrome-divider)"}`,
              background: browsing ? "var(--accent-markup)" : "var(--chrome-bg-elev)",
              color: browsing ? "var(--on-accent)" : "var(--chrome-text)" }}>
            🗂 Files
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
          <button onClick={() => { setOpenErr(""); setBrowsing(true); }} style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #dca0a0", background: "#fff", color: "#991b1b" }}>Browse Files…</button>
          <button onClick={() => setOpenErr("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(0,0,0,0.06)", color: "#991b1b", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {browsing ? (
        // Work Item B — the file browser IS the landing surface (a project's tree, facets,
        // and badged list), not an empty "drop a PDF" screen. Opening a file flips to the
        // review canvas; the 🗂 Files button brings the browser back.
        <FileBrowser
          projectId={projectId}
          projectName={markupProject?.name || ""}
          signedIn={signedIn}
          cross={crossProject}
          indexProvider={autofilingProvider}
          onOpenReview={openReview}
          onNavigate={onNavigate}
        />
      ) : !pdfRef.current ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files?.[0]); }}
          style={{ flex: 1, display: "grid", placeItems: "center", color: PAL.muted, fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: PAL.ink, marginBottom: 8 }}>Document Review</div>
            <div style={{ fontSize: 13.5, marginBottom: 4 }}>{busy ? "Opening…" : "Open or drop a construction PDF to review."}</div>
            <div style={{ fontSize: 12 }}>Calibrate to scale, measure distance/area/count, redline, and roll up a takeoff.</div>
            {err && <div style={{ color: "var(--danger-text)", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* sheet list — logical sheets (B348) with real labels (B266) */}
          <div style={{ flex: "none", width: 200, background: "var(--surface-raised)", borderRight: `1px solid ${PAL.line}`, display: "flex", flexDirection: "column", minHeight: 0 }}>
            {/* Prev/Next pager (B306) — also ← / → and PageUp/PageDown on the keyboard */}
            <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, padding: "8px 8px 6px" }}>
              {(() => { const pg = (on) => ({ flex: 1, padding: "4px 0", borderRadius: 6, cursor: on ? "pointer" : "default", fontFamily: "inherit", fontSize: 13, fontWeight: 700, border: `1px solid ${PAL.line}`, background: "var(--surface-raised)", color: on ? PAL.ink : "var(--text-tertiary)" }); return (
                <>
                  <button style={pg(page > 1)} disabled={page <= 1} onClick={() => goToPage(page - 1)} title="Previous sheet (←)">‹</button>
                  <span style={{ flex: "none", fontSize: 10.5, color: PAL.muted, fontWeight: 700, minWidth: 40, textAlign: "center" }}>{page} / {numPages}</span>
                  <button style={pg(page < numPages)} disabled={page >= numPages} onClick={() => goToPage(page + 1)} title="Next sheet (→)">›</button>
                </>
              ); })()}
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "0 8px 8px", minHeight: 0 }}>
              {/* Logical sheets (B348): grouped plans collapse to one entry; the real sheet # + title
                  replace "Sheet N" (B266). The same shared engine (sheetGroups/sheetMeta) the Stitcher
                  uses; the count reads "logical sheets · pages" so the collapse is visible. */}
              <div data-testid="sheet-count" style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>{groups.length} sheet{groups.length === 1 ? "" : "s"} · {numPages} pages</div>
              {groups.map((g, gi) => {
                const gid = `${gi}:${g.pages[0]?.pageNum}`;
                if (g.kind === "single") {
                  const n = g.pages[0].pageNum, active = n === page;
                  // The label: the real title-block title + number, else "Sheet N" — never a random
                  // body-text line (B266) and never a cross-referenced/duplicate number (B378).
                  const lbl = sheetLabel(n).label;
                  return (
                    <button key={gid} ref={active ? activeSheetRef : null} onClick={() => goToPage(n)} title={sheetTip(n)} data-testid="sheet-entry"
                      style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", marginBottom: 3, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                        border: `1px solid ${active ? PAL.accent : PAL.line}`, background: active ? "var(--hover-ghost)" : "var(--surface-raised)", color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {lbl}{calMark(n)}
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
                      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.label}</span>
                    </button>
                    {open && pagesN.map((n) => {
                      const active = n === page;
                      return (
                        <button key={n} ref={active ? activeSheetRef : null} onClick={() => goToPage(n)} title={sheetTip(n)} data-testid="sheet-entry"
                          style={{ display: "block", width: "calc(100% - 12px)", marginLeft: 12, textAlign: "left", padding: "5px 8px", marginBottom: 2, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11.5, fontWeight: 600,
                            border: `1px solid ${active ? PAL.accent : PAL.line}`, background: active ? "var(--hover-ghost)" : "var(--surface-raised)", color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {sheetShort(n)}{calMark(n)}
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>

          {/* canvas + overlay — a transform viewport (B329). The sheet is a page-sized box
              positioned by translate(tx,ty) and sized by view.scale, so it pans freely in any
              direction and zooms toward the cursor (no scroll box). The wheel + pointer handlers
              live on the viewport itself, so a pan can begin anywhere — even off the sheet. */}
          <div ref={attachWrap}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onDoubleClick={onDbl} onPointerLeave={() => setCursor(null)}
            onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openFile(f); }}
            style={{ flex: 1, minWidth: 0, position: "relative", overflow: "hidden", background: "var(--canvas-mat)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none",
              cursor: panning ? "grabbing" : panMode() ? "grab" : tool === "select" ? "default" : "crosshair" }}>
            {pageBase && view && (
              <div style={{ position: "absolute", left: 0, top: 0, width: pageBase.w * view.scale, height: pageBase.h * view.scale, transform: `translate(${view.tx}px, ${view.ty}px)`, transformOrigin: "0 0", background: "#fff", boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }}>
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
                {pageMarks.map((m) => draw(dragPreview && dragPreview.id === m.id ? { ...m, pts: dragPreview.pts } : m, m.id === sel))}
                {drawDraft()}
              </svg>
              {/* On-canvas delete affordance (B375): a clear × on the selected markup so removing it
                  doesn't depend on knowing the Delete key. Lives OUTSIDE the pointerEvents:none overlay
                  (like the inline editors) so it takes its own click; stopPropagation keeps that click
                  from starting a pan/draw on the canvas underneath. Anchored at the markup's top-right. */}
              {sel && !editing && !calInput && (() => {
                const m = pageMarks.find((mm) => mm.id === sel);
                const src = (dragPreview && dragPreview.id === sel ? dragPreview.pts : m && m.pts) || [];
                if (!m || !src.length) return null;
                const sp = src.map((q) => ({ x: q.x * view.scale, y: q.y * view.scale }));
                let rx = -Infinity, ty = Infinity;
                for (const q of sp) { rx = Math.max(rx, q.x); ty = Math.min(ty, q.y); }
                if (m.kind === "text") { rx = sp[0].x + ((m.text || "").length * 6.5 + 6); ty = sp[0].y - 12; }
                return (
                  <button title="Delete this markup (Del)" aria-label="Delete this markup"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); pushHistory(); setMarkups((a) => a.filter((mm) => mm.id !== sel)); setSel(null); }}
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
                    <button onClick={() => { setTool("select"); setSel(m.id); }} title="Select this markup on the sheet"
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
            {sel && <button style={{ ...btn(false), width: "100%", marginTop: 10, color: "var(--danger-text)" }} onClick={() => { pushHistory(); setMarkups((a) => a.filter((m) => m.id !== sel)); setSel(null); }}>Delete selected</button>}
          </div>
          ) : (
            <button onClick={() => setTakeoffOpen(true)} title="Show the takeoff panel" style={{ flex: "none", width: 26, background: "#fff", borderLeft: `1px solid ${PAL.line}`, cursor: "pointer", color: PAL.muted, fontFamily: "system-ui, sans-serif", fontSize: 11, fontWeight: 700, display: "grid", placeItems: "center" }}>
              <span style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", whiteSpace: "nowrap" }}>◂ Takeoff</span>
            </button>
          )}
        </div>
      )}

      {/* tool hint */}
      {pdfRef.current && curTool && (
        <div style={{ flex: "none", padding: "5px 12px", background: PAL.chrome, borderTop: `1px solid var(--chrome-divider)`, color: PAL.chromeMuted, fontSize: 11, fontFamily: "system-ui, sans-serif" }}>
          <b style={{ color: PAL.ember }}>{curTool.label}:</b> {curTool.hint}{err && <span style={{ color: "var(--warn-text)", marginLeft: 10 }}>{err}</span>}
        </div>
      )}
    </div>
  );
}
