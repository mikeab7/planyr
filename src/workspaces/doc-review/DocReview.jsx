/* Document Review — PDF review core (browser-only). PDF.js viewer + multi-sheet
 * nav, calibrate-to-scale, measure tools (distance / area / perimeter / count),
 * redline (rectangle / cloud / text), and a takeoff rollup. The PDF is an
 * IMMUTABLE backdrop; all markups live on an SVG overlay (an editable layer over
 * it) and are stored in PAGE UNITS so they survive zoom. Lazy-loaded by the shell.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { loadPdf, renderPageToCanvas, extractPageText } from "./lib/pdf.js";
import { parseSheetScale, detectSheet, ftPerPointForScale } from "../site-planner/lib/overlayScale.js";
import { measureLabel, rollup, dist } from "./lib/takeoff.js";
import Stitcher from "./Stitcher.jsx";
import ReviewsBar from "./components/ReviewsBar.jsx";
import ProjectLibrary from "./components/ProjectLibrary.jsx";
import ProjectFilesDrawer from "./components/ProjectFilesDrawer.jsx";
import { useReviewPersistence } from "./lib/usePersistence.js";
import { newReviewId, newSourceId, uploadSource, downloadSource, downloadFromDrive, loadReview, currentUid, readDraft, reconcile, cloudReady, composeTitle } from "./lib/reviewStore.js";
import { onAuthChange } from "../site-planner/lib/auth.js";
import AppHeader from "../../shared/ui/AppHeader.jsx";

// Last cross-workspace "open this review" intent already acted on. Module-scoped (not a
// ref) so it survives this lazy workspace unmounting/remounting — otherwise switching back
// in via the module tab would re-fire the previous open on mount. Mirrors SitePlannerApp's
// lastConsumedNavToken. (NEW-1)
let lastConsumedDocToken = null;

const PAL = { paper: "#efeadf", ink: "#2c2a26", muted: "#8a8473", line: "#e7e2d6", accent: "#c2410c", chrome: "#191613", chromeInk: "#ece7db", chromeMuted: "#9b9482", ember: "#e8590c" };
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

export default function DocReview({ shellModule, onShellSwitch, authControl, onGoDashboard, onNewProject, docIntent = null } = {}) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const fileRef = useRef(null);
  const renderTok = useRef(0);
  const renderTaskRef = useRef(null); // current pdf.js RenderTask, so a superseded render can be cancelled (B40)
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
  const [scale, setScale] = useState(1);
  const [dims, setDims] = useState(null);          // { w,h,baseW,baseH } current render
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const [tool, setTool] = useState("select");
  const [markups, setMarkups] = useState([]);       // all pages; coords in PAGE UNITS
  const [calByPage, setCalByPage] = useState({});   // pageNum -> ftPerUnit
  const [calInfo, setCalInfo] = useState({});       // pageNum -> { src:'auto'|'manual'|'nts', label } (B267)
  const [draft, setDraft] = useState(null);         // in-progress { kind, pts:[...] }
  const [cursor, setCursor] = useState(null);       // page-unit cursor for live preview
  const [sel, setSel] = useState(null);             // selected markup id
  const [fitMode, setFitMode] = useState("width");  // 'width' | 'page' — how a fit (scale===0) is computed (B295)
  const [spaceHeld, setSpaceHeld] = useState(false); // hold-Space = temporary pan in any tool (B289)
  const [dragPreview, setDragPreview] = useState(null); // live { id, pts } while dragging a markup (B293)
  const [editing, setEditing] = useState(null);     // inline text editor { id|null, page, pt, text } (B293)
  const scaleRef = useRef(scale); scaleRef.current = scale; // live scale for the once-bound wheel handler
  const pendingAnchor = useRef(null); // { pageX, pageY, viewX, viewY } pinned across a zoom (B288/B290)
  const panRef = useRef(null);        // active pan drag { sx, sy, sl, st } (B289)
  const dragRef = useRef(null);       // active markup move { id, start, orig, moved } (B293)
  const editDoneRef = useRef(false);  // guard so a commit + the unmount blur don't double-fire (B293)

  // --- cloud persistence (single-sheet review) ---
  const [reviewId, setReviewId] = useState(() => newReviewId());
  const [meta, setMeta] = useState(() => newMeta()); // { title, projectId, project, discipline, item, revision, docDate }
  const [source, setSource] = useState(null);     // { srcId, name, size, storageKey, oversize }
  const [redrop, setRedrop] = useState("");        // "re-drop on load" banner when bytes aren't available
  const [openErr, setOpenErr] = useState("");      // visible banner when an open no-ops / loadReview returns null (NEW-1) — so it can't fail silently
  const [signedIn, setSignedIn] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  // The project the header breadcrumb points at in Markup (B191). Follows the open
  // review's project; picking another project here browses its files in place (it does
  // NOT re-file the open review — browsing ≠ filing).
  // Seed from a fresh cross-workspace open intent so the project context carries through the
  // switch (no "Select a project" flash); loadSingleReview/openReview confirm it after load.
  // project_id covers a listReviews row (snake_case), projectId a loaded record (camelCase).
  const [markupProject, setMarkupProject] = useState(() => {
    const r = bootDocIntentRef.current && bootDocIntentRef.current.row;
    const pid = r && (r.project_id ?? r.projectId);
    return pid ? { id: pid, name: r.project || r.title || "Project" } : null;
  }); // { id, name } | null
  const [pendingStitch, setPendingStitch] = useState(null); // a stitch review handed to <Stitcher> to load
  const sourceRef = useRef(null);                  // { srcId, name } for re-drop matching after load

  const ftPerUnit = calByPage[page] || 0;
  const pageMarks = markups.filter((m) => m.page === page);

  /* ---- load ---- */
  const sameName = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

  // Auto-detect each sheet's stated scale (B267): read the page's embedded text, parse a
  // scale callout, and — ONLY when the page is a standard plot size — pre-fill calibration
  // from it, flagged "from sheet scale (verify)". Never overwrites a page the user (or a
  // loaded review) already calibrated. Runs in the background after a fresh open; a page
  // with no embedded text (scanned/raster) is skipped — that's the seam for the OCR
  // fallback (B267 remaining). Superseded if another file opens mid-scan.
  const scanTok = useRef(0);
  const autoDetectScales = useCallback(async (pdf, pages) => {
    const tok = ++scanTok.current;
    for (let p = 1; p <= pages; p++) {
      if (tok !== scanTok.current) return;             // a newer open superseded this scan
      const text = await extractPageText(pdf, p);
      if (tok !== scanTok.current) return;
      if (!text) continue;                             // no embedded text → leave for OCR (future)
      const r = parseSheetScale(text);
      if (!r) continue;
      if (r.explicit === "nts") { setCalInfo((m) => (m[p] ? m : { ...m, [p]: { src: "nts", label: r.label } })); continue; }
      if (!r.ftPerInch) continue;
      const vp = (await pdf.getPage(p)).getViewport({ scale: 1 });
      if (tok !== scanTok.current) return;
      if (!detectSheet(vp.width, vp.height).std) continue; // non-standard plot → don't trust the printed scale
      setCalByPage((c) => (c[p] ? c : { ...c, [p]: ftPerPointForScale(r.ftPerInch) }));
      setCalInfo((m) => (m[p] ? m : { ...m, [p]: { src: "auto", label: r.label } }));
    }
  }, []);

  const openFile = async (file) => {
    if (!file) return;
    // Validate before buffering the whole file into memory (a non-PDF / 0-byte / huge
    // file would otherwise be read via arrayBuffer() and only then fail).
    if (!file.size || !(/\.pdf$/i.test(file.name) || file.type === "application/pdf")) { setErr("Please drop a PDF file."); return; }
    setBusy(true); setErr("");
    try {
      const pdf = await loadPdf(file);
      setPdfDoc(pdf);
      setFileName(file.name || "document.pdf");
      setNumPages(pdf.numPages);
      setPage(1);
      setScale(0); // 0 = fit-to-width on next render
      setRedrop("");
      // A genuinely DIFFERENT document replaces the backdrop — drop the previous sheet's
      // calibrations so they can't bleed onto the new (differently-paginated) file. A re-drop
      // of the SAME file keeps them (its saved/auto cals still apply). (B267)
      const reuse = sourceRef.current && sameName(sourceRef.current.name, file.name);
      if (!reuse) { setCalByPage({}); setCalInfo({}); }
      autoDetectScales(pdf, pdf.numPages); // B267: background stated-scale auto-calibration
      // Source bookkeeping: reuse the srcId when this is a re-drop of the review's
      // known file (so its markups stay bound); otherwise mint one and upload once.
      const keepId = reuse ? sourceRef.current.srcId : null;
      const srcId = keepId || newSourceId();
      const base = { srcId, name: file.name || "document.pdf", size: file.size };
      sourceRef.current = base;
      setSource({ ...base, storageKey: null, oversize: false });
      uploadSource(srcId, file, meta.projectId, meta.discipline).then((r) => {
        setSource((s) => (s && s.srcId === srcId ? { ...s, storageKey: r.storageKey || null, oversize: !!r.oversize } : s));
      }).catch(() => {}); // best-effort upload; a rejection mustn't become an unhandled rejection
    } catch (e) {
      setErr("Couldn't open that PDF. Make sure it's a valid PDF file.");
    } finally { setBusy(false); }
  };

  /* ---- render current page ---- */
  // Compute the fit-to-width scale in its OWN effect when scale===0, so render() stays a
  // pure draw at a concrete scale. render() used to call setScale internally, which
  // re-fired the render effect → two overlapping renders / brief dims mismatch (B34).
  useEffect(() => {
    if (scale || !pdfRef.current || !canvasRef.current) return;
    let live = true;
    (async () => {
      const p = await pdfRef.current.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const wrap = wrapRef.current;
      const availW = (wrap?.clientWidth || 900) - 24;
      const availH = (wrap?.clientHeight || 600) - 24;
      const sW = availW / base.width;
      // 'page' fits the WHOLE sheet so a tall/portrait sheet is visible at once; 'width'
      // (the long-standing default) fits the width only and lets height overflow. (B295)
      const s = fitMode === "page" ? Math.min(sW, availH / base.height) : sW;
      if (live) setScale(Math.max(0.2, Math.min(4, s)));
    })();
    return () => { live = false; };
  }, [scale, page, numPages, fitMode]);

  const render = useCallback(async () => {
    const pdf = pdfRef.current, canvas = canvasRef.current;
    if (!pdf || !canvas || !scale) return; // the fit effect sets a concrete scale first; render only draws
    const tok = ++renderTok.current;
    // Cancel any in-flight render before starting a new one, so overlapping page/zoom
    // changes can't fight over the same canvas (PDF.js throws on that) (B40).
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (_) {} renderTaskRef.current = null; }
    try {
      const d = await renderPageToCanvas(pdf, page, canvas, scale, (task) => { renderTaskRef.current = task; });
      if (tok !== renderTok.current) return; // a newer render superseded this
      setDims(d);
    } catch (e) {
      if (e && e.name === "RenderingCancelledException") return; // expected when superseded/unmounted
      // other render errors: keep the prior frame rather than crashing
    }
  }, [page, scale]);

  useEffect(() => { render(); }, [render, numPages]);

  // Free PDF.js resources on unmount: cancel any in-flight render + destroy the doc (B39/B40).
  useEffect(() => () => {
    if (renderTaskRef.current) { try { renderTaskRef.current.cancel(); } catch (_) {} }
    try { pdfRef.current && pdfRef.current.destroy(); } catch (_) {}
  }, []);

  /* ---- zoom/pan viewport (B288/B289/B290) ---- */
  const clampScale = (s) => Math.max(0.2, Math.min(6, s));
  // Zoom by `factor`, keeping the page-point under (clientX,clientY) — or the viewport
  // centre when no cursor is given — pinned in place. We re-rasterize at the new scale,
  // then a layout effect (keyed on the fresh dims) nudges the scroller so the anchor lands
  // back under the cursor. Same idea as the Stitcher's cursor-anchored wheel zoom, adapted
  // to this view's scroll/re-raster model (it redraws the PDF at `scale`, it doesn't transform
  // a fixed-res image, so the anchor rides the scrollbars, not a pan/zoom matrix). (B288/B290)
  const zoomAround = (factor, clientX, clientY) => {
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) { setScale((s) => clampScale((s || 1) * factor)); return; }
    const wrapR = wrap.getBoundingClientRect(), canR = canvas.getBoundingClientRect();
    const cx = clientX == null ? wrapR.left + wrapR.width / 2 : clientX;
    const cy = clientY == null ? wrapR.top + wrapR.height / 2 : clientY;
    const s = scaleRef.current || 1;
    pendingAnchor.current = { pageX: (cx - canR.left) / s, pageY: (cy - canR.top) / s, viewX: cx - wrapR.left, viewY: cy - wrapR.top };
    setScale((cur) => clampScale((cur || 1) * factor));
  };
  useLayoutEffect(() => {
    // Runs only when `dims` changes — i.e. after the re-raster at the new scale, when the
    // canvas already carries its new size. Read the live scale from the ref (not a closed-over
    // `scale`) so it's the post-render value, no stale-closure / extra dep needed.
    const a = pendingAnchor.current; if (!a) return;
    pendingAnchor.current = null;
    const wrap = wrapRef.current, canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const s = scaleRef.current;
    const wrapR = wrap.getBoundingClientRect(), canR = canvas.getBoundingClientRect();
    wrap.scrollLeft += (canR.left + a.pageX * s) - (wrapR.left + a.viewX);
    wrap.scrollTop += (canR.top + a.pageY * s) - (wrapR.top + a.viewY);
  }, [dims]);
  // Bind a NON-passive wheel listener via a callback ref so preventDefault works (a React
  // onWheel is registered passive at the root and can't stop the page from scrolling/zooming)
  // and so it attaches exactly when the scroll viewport mounts (it only exists once a PDF is
  // open). Ctrl/Cmd+wheel and trackpad pinch both arrive here as wheel events. (B288)
  const wheelCleanup = useRef(null);
  const attachWrap = useCallback((node) => {
    if (wheelCleanup.current) { wheelCleanup.current(); wheelCleanup.current = null; }
    wrapRef.current = node;
    if (node) {
      const onWheel = (e) => { e.preventDefault(); zoomAround(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY); };
      node.addEventListener("wheel", onWheel, { passive: false });
      wheelCleanup.current = () => node.removeEventListener("wheel", onWheel);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    sources: source ? [{ srcId: source.srcId, name: source.name, size: source.size || 0, storageKey: source.storageKey || null, oversize: !!source.oversize }] : [],
    single: { srcId: source?.srcId || null, fileName, numPages, page, markups, calByPage, calInfo },
  }), [reviewId, meta, source, fileName, numPages, page, markups, calByPage, calInfo]);
  const isEmpty = useCallback(() => !source && markups.length === 0, [source, markups]);
  // `page`/`scale`/`numPages` ride along in the snapshot but aren't save triggers, so
  // flipping through sheets doesn't spam writes — the next real edit (or flush) saves them.
  const { status, suspendSave } = useReviewPersistence({
    buildSnapshot, isEmpty, enabled: mode === "review",
    deps: [reviewId, meta, source, markups, calByPage, calInfo],
  });

  // Remember the active review so a refresh resumes it (cloud reconciled with the
  // synchronous local mirror, so an edit made just before reload isn't lost).
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastSingleId", reviewId); } catch (_) {} }, [reviewId]);
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastMode", mode); } catch (_) {} }, [mode]);

  const loadTok = useRef(0); // a newer open supersedes an in-flight single-review load (B52)
  const fetchSourceBytes = async (src, tok) => {
    if (!src) return;
    if (tok != null && tok !== loadTok.current) return; // superseded before fetching
    if (src.oversize) { setRedrop(`“${src.name}” was too large to store in the cloud — re-open it to view (your markups are saved).`); return; }
    // Read-back: prefer Google Drive (the file's home), fall back to Supabase Storage so a
    // pre-Drive file — or any Drive miss — still opens. (B207 read-back, fallback-safe.)
    let buf = src.driveKey ? await downloadFromDrive(src.driveKey) : null;
    if (tok != null && tok !== loadTok.current) return; // superseded while downloading
    if (!buf) buf = src.storageKey ? await downloadSource(src.storageKey) : null;
    if (tok != null && tok !== loadTok.current) return; // a newer review opened while downloading
    if (!buf) { setRedrop(`Couldn't fetch “${src.name}” — re-open it to view (your markups are saved).`); return; }
    const pdf = await loadPdf(buf);
    if (tok != null && tok !== loadTok.current) { try { pdf.destroy(); } catch (_) {} return; } // superseded — free the doc we just loaded
    setPdfDoc(pdf);
    setNumPages(pdf.numPages); setScale(0);
  };
  const loadSingleReview = async (rec) => {
    const tok = ++loadTok.current; // supersede any in-flight load so its late PDF can't land on this review (B52)
    suspendSave(); // don't let this programmatic load re-save itself with a fresh updatedAt (B19)
    const s = rec.single || {};
    const src = (rec.sources || [])[0] || null;
    setPdfDoc(null);
    sourceRef.current = src ? { srcId: src.srcId, name: src.name } : null;
    setReviewId(rec.id);
    setMeta({ title: rec.title || "", projectId: rec.projectId || null, project: rec.project || "", discipline: rec.discipline || "", item: rec.item || "", revision: rec.revision || "", docDate: rec.docDate || "" });
    setMarkupProject(rec.projectId ? { id: rec.projectId, name: rec.project || rec.title || "Project" } : null);
    setSource(src ? { srcId: src.srcId, name: src.name, size: src.size || 0, storageKey: src.storageKey || null, oversize: !!src.oversize } : null);
    setMarkups(s.markups || []); setCalByPage(s.calByPage || {}); setCalInfo(s.calInfo || {});
    setFileName(s.fileName || ""); setNumPages(s.numPages || 0); setPage(s.page || 1);
    setDraft(null); setSel(null); setTool("select"); setRedrop("");
    scanTok.current++; // a programmatic load supersedes any in-flight auto-scale scan (use the saved cals)
    await fetchSourceBytes(src, tok);
  };
  const resetSingle = () => {
    setPdfDoc(null); sourceRef.current = null;
    setReviewId(newReviewId());
    setMeta(newMeta());
    setMarkupProject(null);
    setSource(null); setRedrop("");
    setFileName(""); setNumPages(0); setPage(1); setScale(0);
    setMarkups([]); setCalByPage({}); setCalInfo({}); setDraft(null); setSel(null); setTool("select");
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
    // reviews are also set inside loadSingleReview; this also covers stitch).
    setMarkupProject(rec.projectId ? { id: rec.projectId, name: rec.project || rec.title || "Project" } : null);
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
    (async () => {
      let lastMode = "review", lastSingle = null, lastStitch = null;
      try {
        lastMode = localStorage.getItem("planyr:docreview:lastMode") || "review";
        lastSingle = localStorage.getItem("planyr:docreview:lastSingleId");
        lastStitch = localStorage.getItem("planyr:docreview:lastStitchId");
      } catch (_) {}
      const uid = await currentUid();
      if (lastMode === "stitch" && lastStitch) {
        const rec = reconcile(await loadReview(lastStitch), readDraft(uid, lastStitch));
        if (rec && rec.kind === "stitch") { setPendingStitch(rec); setMode("stitch"); return; }
      }
      if (lastSingle) {
        const rec = reconcile(await loadReview(lastSingle), readDraft(uid, lastSingle));
        if (rec && rec.kind === "single") await loadSingleReview(rec);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- pointer → page units ---- */
  const toPage = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const commit = (mk) => { setMarkups((a) => [...a, { id: uid(), page, ...mk }]); setDraft(null); };

  const panMode = () => tool === "pan" || spaceHeld;

  const openEditor = (ed) => { editDoneRef.current = false; setEditing(ed); };
  const closeEditor = (save) => {
    if (editDoneRef.current) return; // a prior Enter/Esc already handled it; ignore the unmount blur (B293)
    editDoneRef.current = true;
    const ed = editing; setEditing(null);
    if (!save || !ed) return;
    const text = (ed.text || "").trim();
    if (!text) { if (ed.id) setMarkups((a) => a.filter((m) => m.id !== ed.id)); return; } // empty → drop / delete
    if (ed.id) setMarkups((a) => a.map((m) => (m.id === ed.id ? { ...m, text } : m)));
    else setMarkups((a) => [...a, { id: uid(), page: ed.page, kind: "text", pts: [ed.pt], text }]);
  };

  const onDown = (e) => {
    if (!dims) return;
    if (panMode()) { // hand tool / hold-Space: drag the scroll viewport (B289)
      const wrap = wrapRef.current; if (!wrap) return;
      panRef.current = { sx: e.clientX, sy: e.clientY, sl: wrap.scrollLeft, st: wrap.scrollTop };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
      return;
    }
    const p = toPage(e);
    if (tool === "select") {
      const id = hitTest(p);
      setSel(id);
      if (id) { // arm a move-drag; a sub-threshold drag stays a plain click-select (B293)
        const m = pageMarks.find((mm) => mm.id === id);
        if (m) { dragRef.current = { id, start: p, orig: (m.pts || []).map((q) => ({ x: q.x, y: q.y })), moved: false }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }
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
    if (panRef.current) { // panning: scroll opposite the drag (B289)
      const wrap = wrapRef.current; if (!wrap) return;
      wrap.scrollLeft = panRef.current.sl - (e.clientX - panRef.current.sx);
      wrap.scrollTop = panRef.current.st - (e.clientY - panRef.current.sy);
      return;
    }
    const p = toPage(e);
    if (dragRef.current) { // moving a markup: translate its page-unit points live (B293)
      const dx = p.x - dragRef.current.start.x, dy = p.y - dragRef.current.start.y;
      if (!dragRef.current.moved && Math.hypot(dx * scale, dy * scale) < 3) { setCursor(p); return; }
      dragRef.current.moved = true;
      setDragPreview({ id: dragRef.current.id, pts: dragRef.current.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) });
      return;
    }
    setCursor(p);
  };

  const onUp = (e) => {
    if (panRef.current) { panRef.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} return; }
    if (dragRef.current) {
      const d = dragRef.current; dragRef.current = null;
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {}
      if (d.moved) { // commit the move ONCE on pointer-up so it's a single edit/save (B293)
        const p = toPage(e), dx = p.x - d.start.x, dy = p.y - d.start.y;
        setMarkups((a) => a.map((m) => (m.id === d.id ? { ...m, pts: d.orig.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : m)));
      }
      setDragPreview(null);
      return;
    }
    // Text places on release: opening the inline editor here (not on pointer-down) means the
    // click's own focus change has already happened, so autofocus sticks and the empty editor
    // isn't immediately blurred + discarded. (B293)
    if (tool === "text") openEditor({ id: null, page, pt: toPage(e), text: "" });
  };

  // Always clear pan/move state on an interrupted gesture so the canvas can't get stuck
  // behind a frozen grab cursor (cf. B271, the origin/main frozen-cursor lockout).
  const onCancel = () => { panRef.current = null; dragRef.current = null; setDragPreview(null); };

  const finishDraft = () => {
    if (!draft) return;
    const { kind, pts } = draft;
    if (kind === "count" && pts.length >= 1) commit({ kind, pts });
    else if ((kind === "area" || kind === "perimeter") && pts.length >= 2) commit({ kind, pts });
    else setDraft(null);
  };
  const onDbl = (e) => {
    if (tool === "select") { // double-click a text note → edit it inline (B293)
      const m = pageMarks.find((mm) => mm.id === hitTest(toPage(e)));
      if (m && m.kind === "text") openEditor({ id: m.id, page, pt: m.pts[0], text: m.text });
      return;
    }
    if (!draft) return;
    // The browser fires TWO pointerdowns before a dblclick, each appending a coincident
    // point at the finish spot — strip that trailing run so a Count isn't inflated and a
    // poly isn't distorted. Enter (no extra downs) keeps every point. (B291)
    if (draft.kind === "area" || draft.kind === "perimeter" || draft.kind === "count") {
      const d = toPage(e), tol = 6 / scale;
      const pts = draft.pts.slice();
      while (pts.length && dist(pts[pts.length - 1], d) <= tol) pts.pop();
      if (draft.kind === "count" ? pts.length >= 1 : pts.length >= 2) commit({ kind: draft.kind, pts });
      else setDraft(null);
    } else finishDraft();
  };

  const finishCalibrate = (pts) => {
    const u = dist(pts[0], pts[1]);
    if (u < 1) { setErr("Calibration line too short — zoom in and try again."); return; }
    const v = window.prompt("Real-world length of that line (in feet):");
    const ft = parseFloat(v);
    if (!isFinite(ft) || ft <= 0) return;
    setCalByPage((c) => ({ ...c, [page]: ft / u }));
    setCalInfo((m) => ({ ...m, [page]: { src: "manual" } })); // a hand-calibration supersedes any auto guess (B267)
    setErr("");
  };

  const hitTest = (p) => {
    const tol = 10 / scale; // page-unit click tolerance
    const segDist = (a, b) => { // distance from p to segment a–b (page units)
      const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
      if (!L2) return dist(p, a);
      let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2; t = Math.max(0, Math.min(1, t));
      return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
    };
    let best = null, bd = Infinity;
    for (const m of pageMarks) {
      const pts = m.pts || [];
      let d = Infinity;
      if (m.kind === "rect" || m.kind === "cloud") {
        // shape-aware: a box is selectable across its whole body, not just its 2 corners (B33)
        const a = pts[0], b = pts[1]; if (!a || !b) continue;
        const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
        if (p.x >= x0 - tol && p.x <= x1 + tol && p.y >= y0 - tol && p.y <= y1 + tol) d = 0;
      } else if (m.kind === "text") {
        // the text box (offsets mirror the render; screen px → page units via /scale) (B33)
        const q = pts[0]; if (!q) continue;
        const w = ((m.text || "").length * 6.5 + 6) / scale, h = 16 / scale;
        if (p.x >= q.x - 2 / scale && p.x <= q.x - 2 / scale + w && p.y >= q.y - 12 / scale && p.y <= q.y - 12 / scale + h) d = 0;
      } else {
        // measures (distance/perimeter/area/count): nearest vertex OR segment (so the line body selects)
        for (let i = 0; i < pts.length; i++) { d = Math.min(d, dist(p, pts[i])); if (i > 0) d = Math.min(d, segDist(pts[i - 1], pts[i])); }
      }
      if (d < bd) { bd = d; best = m.id; }
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
    if (e.key === " " || e.code === "Space") { if (!spaceHeld) setSpaceHeld(true); e.preventDefault(); return; } // hold-Space = pan (B289)
    if (e.key === "Enter") { e.preventDefault(); finishDraft(); }
    else if (e.key === "Escape") { setDraft(null); setSel(null); setDragPreview(null); dragRef.current = null; }
    else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); setMarkups((a) => a.filter((m) => m.id !== sel)); setSel(null); }
  };
  useEffect(() => {
    const onKey = (e) => onKeyRef.current && onKeyRef.current(e);
    const onKeyUp = (e) => { if (e.key === " " || e.code === "Space") setSpaceHeld(false); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp); };
  }, []);

  const zoom = (f) => zoomAround(f, null, null); // ± buttons hold the viewport centre fixed (B290)
  const totals = rollup(markups, calByPage);

  /* ---------------- render ---------------- */
  const f0 = (n) => Math.round(n).toLocaleString();
  const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const btn = (on) => ({ padding: "6px 10px", fontSize: 12, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${on ? PAL.accent : "#ddd6c5"}`, background: on ? PAL.accent : "#fff", color: on ? "#fff" : PAL.ink });
  const curTool = TOOLS.find((t) => t.id === tool);

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
    const S = (q) => ({ x: q.x * scale, y: q.y * scale });
    const stroke = selected ? PAL.accent : (MEASURE.has(m.kind) ? "#0e7490" : "#b91c1c");
    const lbl = MEASURE.has(m.kind) ? measureLabel(m, ftPerUnit) : null;
    const labelAt = (x, y, text, color) => (
      <text x={x} y={y} fontSize="11" fontWeight="700" fill={color} style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }} pointerEvents="none">{text}</text>
    );
    if (m.kind === "distance" || m.kind === "perimeter") {
      const pts = m.pts.map(S);
      const closed = m.kind === "perimeter";
      const dd = (closed ? [...pts, pts[0]] : pts).map((q) => `${q.x},${q.y}`).join(" ");
      const mid = pts[Math.floor((pts.length - 1) / 2)];
      return <g key={m.id}><polyline points={dd} fill="none" stroke={stroke} strokeWidth={selected ? 3 : 2} />{pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={stroke} />)}{lbl && labelAt(mid.x + 4, mid.y - 4, lbl, "#0e7490")}</g>;
    }
    if (m.kind === "area") {
      const pts = m.pts.map(S);
      const c = pts.reduce((a, q) => ({ x: a.x + q.x / pts.length, y: a.y + q.y / pts.length }), { x: 0, y: 0 });
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
      const q = S(m.pts[0]);
      return <g key={m.id}><rect x={q.x - 2} y={q.y - 12} width={(m.text.length * 6.5) + 6} height={16} fill="#fff" stroke={stroke} strokeWidth={1} rx={3} /><text x={q.x + 2} y={q.y} fontSize="11" fill="#b91c1c" fontWeight="600" pointerEvents="none">{m.text}</text></g>;
    }
    return null;
  };

  const drawDraft = () => {
    if (!draft) return null;
    const S = (q) => ({ x: q.x * scale, y: q.y * scale });
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
      <ProjectLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} onOpenReview={openReview} signedIn={signedIn} />
      <ProjectFilesDrawer open={filesOpen} onClose={() => setFilesOpen(false)} onOpenReview={openReview} signedIn={signedIn}
        projectId={markupProject?.id || meta.projectId || null} onPlaceOnMap={() => onShellSwitch?.("site-planner")} />
      <AppHeader
        module={shellModule || "doc-review"}
        onSwitch={onShellSwitch}
        // Breadcrumb (B191–B193): Dashboard leaves Markup for the all-projects map;
        // picking a project browses its files in place (opens the Files drawer scoped
        // to it); New project is born in the Site Planner. Save state from persistence.
        onDashboard={onGoDashboard}
        currentProject={markupProject}
        onSelectProject={(id, name) => { setMarkupProject({ id, name }); setFilesOpen(true); }}
        onNewProject={onNewProject}
        saveState={status === "saving" ? "saving" : (status === "unsaved" || status === "conflict") ? "error" : (signedIn ? "synced" : "local")}
        centerContent={
          // Files is opened from Row 1 (the project-name area), not a module tab (B180):
          // a shelf every workspace reaches into, so it lives next to the project name.
          <span style={{ display: "flex", alignItems: "center", gap: 8, maxWidth: "100%" }}>
            {meta.title && (
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#ece7db", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {meta.title}
              </span>
            )}
            <button onClick={() => setFilesOpen(true)} title="Project Files — saved views over your tagged file index"
              style={{ flex: "none", display: "flex", alignItems: "center", gap: 4, fontSize: 11.5, fontFamily: "inherit", fontWeight: 600, cursor: "pointer", borderRadius: 999, padding: "3px 10px", border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: "#ece7db" }}>
              🗂 Files
            </button>
          </span>
        }
        saveSlot={<ReviewsBar status={status} signedIn={signedIn} meta={meta} onMeta={onMeta} onOpen={openReview} onNew={resetSingle} />}
        authControl={authControl}
        toolbarContent={
          <>
            <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={() => fileRef.current?.click()}>{fileName ? "Open another…" : "Open PDF…"}</button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
            <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={() => setMode("stitch")} title="Stitch multiple sheets into one continuous plan">Stitch sheets ▸</button>
            <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={() => setLibraryOpen(true)} title="Browse the project library">📁 Library</button>
            {fileName && <span style={{ color: PAL.chromeMuted, fontSize: 11.5, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>}
            {pdfRef.current && <span style={{ width: 1, height: 18, background: "rgba(255,255,255,0.12)", margin: "0 2px" }} />}
            {pdfRef.current && TOOLS.map((t) => <button key={t.id} style={{ ...btn(tool === t.id), fontSize: 11.5 }} onClick={() => { setTool(t.id); setDraft(null); }}>{t.label}</button>)}
            {pdfRef.current && <>
              <button style={{ ...btn(false) }} onClick={() => zoom(1 / 1.2)}>−</button>
              <span style={{ color: PAL.chromeMuted, fontSize: 11.5, width: 42, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
              <button style={{ ...btn(false) }} onClick={() => zoom(1.2)}>+</button>
              <button style={{ ...btn(false) }} onClick={() => { setFitMode("width"); setScale(0); }} title="Fit to width">Fit</button>
              <button style={{ ...btn(false) }} onClick={() => { setFitMode("page"); setScale(0); }} title="Fit the whole sheet">Fit page</button>
            </>}
          </>
        }
      />

      {redrop && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", background: "#fef3c7", color: "#92400e", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
          <span>⚠ {redrop}</span>
          <button onClick={() => fileRef.current?.click()} style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #d6a64a", background: "#fff", color: "#92400e" }}>Re-open file…</button>
        </div>
      )}

      {openErr && (
        <div role="alert" style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", background: "#fee2e2", color: "#991b1b", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
          <span>⚠ {openErr}</span>
          <button onClick={() => { setOpenErr(""); setFilesOpen(true); }} style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #dca0a0", background: "#fff", color: "#991b1b" }}>Browse Files…</button>
          <button onClick={() => setOpenErr("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(0,0,0,0.06)", color: "#991b1b", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {!pdfRef.current ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFile(e.dataTransfer.files?.[0]); }}
          style={{ flex: 1, display: "grid", placeItems: "center", color: PAL.muted, fontFamily: "system-ui, sans-serif", textAlign: "center", padding: 24 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700, color: PAL.ink, marginBottom: 8 }}>Document Review</div>
            <div style={{ fontSize: 13.5, marginBottom: 4 }}>{busy ? "Opening…" : "Open or drop a construction PDF to review."}</div>
            <div style={{ fontSize: 12 }}>Calibrate to scale, measure distance/area/count, redline, and roll up a takeoff.</div>
            {err && <div style={{ color: "#b91c1c", marginTop: 10, fontSize: 12.5 }}>{err}</div>}
          </div>
        </div>
      ) : (
        <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
          {/* sheet list */}
          <div style={{ flex: "none", width: 116, background: "#fff", borderRight: `1px solid ${PAL.line}`, overflowY: "auto", padding: 8 }}>
            <div style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Sheets · {numPages}</div>
            {Array.from({ length: numPages }, (_, i) => i + 1).map((n) => (
              <button key={n} onClick={() => { setPage(n); setDraft(null); setSel(null); }}
                title={calInfo[n]?.label ? `Scale ${calInfo[n].label}${calInfo[n].src === "auto" ? " — from sheet, verify" : ""}` : undefined}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", marginBottom: 3, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${n === page ? PAL.accent : PAL.line}`, background: n === page ? "#fbf3ee" : "#fff", color: PAL.ink }}>
                Sheet {n}{calInfo[n]?.src === "auto" ? " ·≈" : calByPage[n] ? " ·✓" : ""}
              </button>
            ))}
          </div>

          {/* canvas + overlay */}
          <div ref={attachWrap} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) openFile(f); }}
            style={{ flex: 1, minWidth: 0, overflow: "auto", background: "#cfc8ba", display: "flex", padding: 12 }}>
            {/* margin:auto centres the sheet when it fits but resolves to 0 (top-left aligned,
                fully scrollable) when it overflows — unlike place-items:center, which makes the
                top/left overflow unreachable and breaks zoom-anchoring + pan. (B288/B289/B290) */}
            <div style={{ position: "relative", width: dims?.w, height: dims?.h, margin: "auto", boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }}>
              <canvas ref={canvasRef} style={{ display: "block" }} />
              {dims && (
                <svg width={dims.w} height={dims.h} style={{ position: "absolute", inset: 0, touchAction: "none", cursor: panMode() ? "grab" : tool === "select" ? "default" : "crosshair" }}
                  onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel} onDoubleClick={onDbl} onPointerLeave={() => setCursor(null)}>
                  {pageMarks.map((m) => draw(dragPreview && dragPreview.id === m.id ? { ...m, pts: dragPreview.pts } : m, m.id === sel))}
                  {drawDraft()}
                </svg>
              )}
              {editing && (
                <input autoFocus value={editing.text}
                  onChange={(ev) => setEditing((ed) => (ed ? { ...ed, text: ev.target.value } : ed))}
                  onPointerDown={(ev) => ev.stopPropagation()}
                  onKeyDown={(ev) => { ev.stopPropagation(); if (ev.key === "Enter") { ev.preventDefault(); closeEditor(true); } else if (ev.key === "Escape") { ev.preventDefault(); closeEditor(false); } }}
                  onBlur={() => closeEditor(true)} placeholder="Text note…"
                  style={{ position: "absolute", left: editing.pt.x * scale, top: editing.pt.y * scale - 14, font: "600 12px ui-sans-serif, system-ui, sans-serif", padding: "1px 4px", border: `1px solid ${PAL.accent}`, borderRadius: 4, background: "#fff", color: "#b91c1c", minWidth: 90, zIndex: 5 }} />
              )}
            </div>
          </div>

          {/* takeoff */}
          <div style={{ flex: "none", width: 246, background: "#fff", borderLeft: `1px solid ${PAL.line}`, overflowY: "auto", padding: 12, fontFamily: "system-ui, sans-serif" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: PAL.ink, marginBottom: 2 }}>Takeoff</div>
            <div style={{ fontSize: 11, marginBottom: 8 }}>
              {(() => {
                const info = calInfo[page];
                if (ftPerUnit && info?.src === "auto")
                  return <span style={{ color: "#b45309" }}>Sheet {page} — scale from sheet: <b>{info.label}</b> · verify</span>;
                if (ftPerUnit) return <span style={{ color: "#15803d" }}>Sheet {page} calibrated</span>;
                if (info?.src === "nts") return <span style={{ color: "#b45309" }}>Sheet {page} — marked NOT TO SCALE</span>;
                return <span style={{ color: "#b45309" }}>Sheet {page} not calibrated — use Calibrate</span>;
              })()}
            </div>
            <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 4 }}>This sheet</div>
            {pageMarks.filter((m) => MEASURE.has(m.kind)).length === 0
              ? <div style={{ fontSize: 11.5, color: PAL.muted, marginBottom: 10 }}>No measurements yet.</div>
              : <div style={{ marginBottom: 10 }}>{pageMarks.filter((m) => MEASURE.has(m.kind)).map((m) => (
                  <div key={m.id} onClick={() => { setTool("select"); setSel(m.id); }} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 6px", borderRadius: 6, cursor: "pointer", background: m.id === sel ? "#fbf3ee" : "transparent", fontSize: 11.5 }}>
                    <span style={{ color: PAL.muted, textTransform: "capitalize" }}>{m.kind}</span>
                    <span style={{ color: PAL.ink, fontWeight: 650, fontFamily: "ui-monospace, monospace" }}>{measureLabel(m, ftPerUnit)}</span>
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
              {totals.uncal > 0 && <div style={{ fontSize: 10.5, color: "#b45309", marginTop: 5, lineHeight: 1.4 }}>{totals.uncal} measurement(s) on uncalibrated sheets are excluded.</div>}
              <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 8 }}>Areas/counts use the shared coordinate module — the seam to feed the Site Planyr's yield panel (pending the shared coordinate spine).</div>
            </div>
            {sel && <button style={{ ...btn(false), width: "100%", marginTop: 10, color: "#b3361b" }} onClick={() => { setMarkups((a) => a.filter((m) => m.id !== sel)); setSel(null); }}>Delete selected</button>}
          </div>
        </div>
      )}

      {/* tool hint */}
      {pdfRef.current && curTool && (
        <div style={{ flex: "none", padding: "5px 12px", background: PAL.chrome, borderTop: `1px solid #2e2a23`, color: PAL.chromeMuted, fontSize: 11, fontFamily: "system-ui, sans-serif" }}>
          <b style={{ color: PAL.ember }}>{curTool.label}:</b> {curTool.hint}{err && <span style={{ color: "#fbbf24", marginLeft: 10 }}>{err}</span>}
        </div>
      )}
    </div>
  );
}
