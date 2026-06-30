/* Multi-sheet stitcher (Document Review) — assisted alignment. Load several PDF
 * sheets, place them on one shared world canvas, and align each new sheet to a
 * placed one by clicking two matching points (a shared property corner or the
 * labeled match-line ends). We compute a similarity transform (translate/rotate/
 * scale) and snap it in. Measure (distance/area) and a single composite
 * calibration work across the seams. No automatic match-line detection / OCR.
 *
 * Geometry: each sheet has a page-units→world matrix M={A,B,e,f}
 *   world.x = A*x − B*y + e ;  world.y = B*x + A*y + f   (SVG matrix(A,B,−B,A,e,f))
 * World↔screen is a single pan/zoom group.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPdf, renderPageToImage, renderPageToImageData } from "./lib/pdf.js";
import { dist, polyArea, pathLength, centroidOf } from "./lib/takeoff.js";
import { parseFeet } from "./lib/parseLength.js";
import { fwd, inv, solveM, sheetBBox, alignBaselinesDegenerate, measureOverUnaligned, panTo } from "./lib/stitchGeom.js";
import { autoPlaceGroup, detectedEndpointsFor } from "./lib/autoStitch.js";
import { binarizeImageData, refineGroupPlacements } from "./lib/matchLineRefine.js";
import { readAndGroup, groupCalibration } from "./lib/sheetRead.js";
import { normSheet } from "../../shared/files/detailRefs.js";
import { aggregateNotes } from "../../shared/files/sheetNotes.js";
import { createOcrRunner } from "./lib/ocr.js";
import { ftToAcres } from "../../shared/coordinates/index.js";
import { worldToScreen, screenToWorld, zoomAround } from "../../shared/viewport/viewportTransform.js";
import ReviewsBar from "./components/ReviewsBar.jsx";
import CloudSyncBadge from "../../shared/ui/CloudSyncBadge.jsx";
import { useReviewPersistence, docSaveState } from "./lib/usePersistence.js";
import { newReviewId, newSourceId, storeSource, isStoredSource, downloadSource, downloadFromDrive, loadReview, currentUid, readDraft, reconcile, composeTitle } from "./lib/reviewStore.js";

const PAL = { paper: "var(--surface-page)", ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", chrome: "var(--chrome-bg)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)", ember: "var(--accent)" };
const uid = () => "s" + Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const newMeta = () => ({ title: "", projectId: null, project: "", discipline: "", item: "", revision: "", docDate: today() });
const ID = { A: 1, B: 0, e: 0, f: 0 };
const DBOX = { w: 380, h: 256 }; // detail "cloud" popup viewing box (px) — stable module const (B350)
// Pure stitch geometry (fwd/inv/solveM/sheetBBox + the B300/B301 alignment guards) lives
// in lib/stitchGeom.js so it can be unit-tested away from the component.

const f0 = (n) => Math.round(n).toLocaleString();
// One-decimal feet for LINEAR measures, matching the single-sheet Markup tool (B296) — whole-
// foot rounding hid sub-foot precision (a 150.6 ft line read "151 ft") and clashed with the
// 2-dp acres shown for area.
const f1 = (n) => (Math.round(n * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Stitcher({ onReview, loadReq = null, onConsumeLoad, onOpenReview, signedIn = false }) {
  const svgRef = useRef(null);
  const [pdfs, setPdfs] = useState([]);          // {srcId,name,doc,numPages,blob,size,storageKey,oversize,missing}
  const [placed, setPlaced] = useState([]);      // {id,srcId,pageNum,name,href,baseW,baseH,M,missing}
  const [view, setView] = useState({ panX: 40, panY: 40, zoom: 0.4 });
  const [tool, setTool] = useState("pan");       // pan | distance | area | calibrate
  const [align, setAlign] = useState(null);      // { sheetId, step, A1, b1, A2 }
  const [draft, setDraft] = useState(null);      // measure/calibrate in progress (world pts)
  const [cursor, setCursor] = useState(null);    // world cursor
  const [measures, setMeasures] = useState([]);  // {id,kind,pts:[world]}
  const [ftPerUnit, setFtPerUnit] = useState(0); // composite calibration (ft per world unit)
  const [calInput, setCalInput] = useState(null); // inline Calibrate entry { pts:[world], x, y (screen px), value } (B304)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [reading, setReading] = useState(false); // reading + grouping a freshly dropped set (B335/B336)
  const [ocrRunning, setOcrRunning] = useState(false); // a scanned page is being OCR'd (B352) — slower
  const [showAllPages, setShowAllPages] = useState(false); // safety net: reveal the raw per-page tray
  const [cropBlocks, setCropBlocks] = useState(true);      // crop title-block bands on grouped composites (B338)
  const [legendOpen, setLegendOpen] = useState(true);      // the pinned composite key (B338)
  const [notesOpen, setNotesOpen] = useState(false);       // expand the aggregated notes/legend (B350)
  const [showRefs, setShowRefs] = useState(true);          // show clickable detail-callout hotspots (B350)
  const [detail, setDetailPopup] = useState(null);         // open detail "cloud" popup (B350)
  const [notice, setNotice] = useState("");                // transient auto-stitch result line
  const drag = useRef(null);

  /* ---- undo / redo (B303) — measures + the composite calibration ---- */
  const editRef = useRef({ measures: [], ftPerUnit: 0 });
  useEffect(() => { editRef.current = { measures, ftPerUnit }; });
  const pastRef = useRef([]);
  const futureRef = useRef([]);
  const [, bumpHist] = useState(0);
  const touchHist = () => bumpHist((n) => n + 1);
  const histKey = (s) => JSON.stringify({ m: s.measures, f: s.ftPerUnit });
  const pushHistory = () => {
    pastRef.current.push(editRef.current);
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    touchHist();
  };
  const clearHistory = () => { pastRef.current = []; futureRef.current = []; touchHist(); };
  const applySnapshot = (s) => { setMeasures(s.measures || []); setFtPerUnit(s.ftPerUnit || 0); setDraft(null); setCalInput(null); };
  const undo = () => {
    let prev = null;
    while (pastRef.current.length) { const c = pastRef.current.pop(); if (histKey(c) !== histKey(editRef.current)) { prev = c; break; } }
    if (!prev) return;
    futureRef.current.push(editRef.current); applySnapshot(prev); touchHist();
  };
  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(editRef.current); applySnapshot(next); touchHist();
  };
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  const removeLastVertex = () => {
    if (!draft || !draft.pts || draft.pts.length === 0) return false;
    setDraft((d) => { if (!d) return d; const pts = d.pts.slice(0, -1); return pts.length ? { ...d, pts } : null; });
    return true;
  };

  // --- cloud persistence (stitched-set review) ---
  const [reviewId, setReviewId] = useState(() => newReviewId());
  const [meta, setMeta] = useState(() => newMeta()); // { title, projectId, project, discipline, item, revision, docDate }
  const pdfsRef = useRef([]); useEffect(() => { pdfsRef.current = pdfs; });
  const placedRef = useRef([]); useEffect(() => { placedRef.current = placed; });
  const sameName = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();

  // Free PDF.js docs + sheet object URLs once they leave state (remove/replace/reset)
  // and on unmount — otherwise every re-load leaks a doc (worker + retained buffer)
  // and a multi-MB blob URL (B39/B45). Track what's live and release the rest.
  const liveDocsRef = useRef([]);
  useEffect(() => {
    const live = new Set(pdfs.map((p) => p.doc).filter(Boolean));
    for (const d of liveDocsRef.current) if (d && !live.has(d)) { try { d.destroy(); } catch (_) {} }
    liveDocsRef.current = [...live];
  }, [pdfs]);
  const liveHrefsRef = useRef([]);
  useEffect(() => {
    const live = new Set(placed.map((s) => s.href).filter(Boolean));
    for (const h of liveHrefsRef.current) if (h && !live.has(h) && h.startsWith("blob:")) { try { URL.revokeObjectURL(h); } catch (_) {} }
    liveHrefsRef.current = [...live];
  }, [placed]);
  useEffect(() => () => {
    for (const d of liveDocsRef.current) if (d) { try { d.destroy(); } catch (_) {} }
    for (const h of liveHrefsRef.current) if (h && h.startsWith("blob:")) { try { URL.revokeObjectURL(h); } catch (_) {} }
  }, []);

  // B51/B52: loadStitch rebuilds pdfs[]/placed[] wholesale, so block user adds while a
  // load runs (an add's sheet would be clobbered by the load's blind setPlaced), and let
  // a newer open supersede an older in-flight load by token.
  const loadingRef = useRef(false);
  const loadTok = useRef(0);
  const openFiles = async (files) => {
    if (loadingRef.current) return; // don't add sources while a load is rebuilding them (B51)
    const list = [...(files || [])].filter((f) => /pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!list.length) return;
    setBusy(true); setErr("");
    try {
      for (const f of list) {
        const doc = await loadPdf(f);
        // Re-drop of a source that was too large / unavailable on load? Re-bind its
        // bytes (and re-render its placed sheets) instead of adding a duplicate.
        const miss = pdfsRef.current.find((p) => p.missing && sameName(p.name, f.name));
        if (miss) { await bindSource(miss.srcId, doc, f); continue; }
        const srcId = newSourceId();
        setPdfs((p) => [...p, { srcId, name: f.name, doc, numPages: doc.numPages, blob: f, size: f.size, storageKey: null, driveKey: null, oversize: false, missing: false, groups: null }]);
        readGroupsFor(srcId, doc); // B335/B336: read each page + collapse into logical sheets (background)
        // Store Drive-first, Supabase-fallback (B322) — the same path filing uses, so stitched
        // sheets live in Drive and aren't bound by Supabase's 50 MB cap. A sheet stays keyless
        // in state until this resolves; buildSnapshot won't persist a keyless source (B323).
        storeSource(srcId, f, { projectId: meta.projectId, discipline: meta.discipline, fileName: f.name }).then((r) =>
          setPdfs((p) => p.map((x) => (x.srcId === srcId ? { ...x, storageKey: r.storageKey || null, driveKey: r.driveKey || null, oversize: !!r.oversize } : x)))
        ).catch(() => {}); // best-effort store; don't leak an unhandled rejection
      }
    } catch (_) { setErr("One of those files wasn't a readable PDF."); }
    finally { setBusy(false); }
  };

  // Read every page's metadata and collapse the file into logical sheets (B335/B336). Runs in
  // the background after a drop — read-only, so it can't clobber the placement state; on any
  // failure the file just falls back to the raw per-page tray (never blocks adding sheets).
  // A SCANNED / image-only page (no text layer) goes through the OCR seam (B352): the runner only
  // spins up the Tesseract worker if such a page is actually hit, so a normal vector set pays
  // nothing. `onOcrStart` flips the status copy so the (slower) OCR pass is visible.
  const readGroupsFor = async (srcId, doc) => {
    setReading(true); setOcrRunning(false);
    const ocr = createOcrRunner({ onOcrStart: () => setOcrRunning(true) });
    try {
      const { groups } = await readAndGroup(doc, { ocr: ocr.run });
      setPdfs((p) => p.map((x) => (x.srcId === srcId ? { ...x, groups } : x)));
    } catch (_) { setPdfs((p) => p.map((x) => (x.srcId === srcId ? { ...x, groups: [] } : x))); }
    finally { ocr.dispose(); setReading(false); setOcrRunning(false); }
  };

  // Fill in a source's bytes after a re-drop, and re-render any sheets placed from it.
  const bindSource = async (srcId, doc, blob) => {
    setPdfs((p) => p.map((x) => (x.srcId === srcId ? { ...x, doc, numPages: doc.numPages, blob, missing: false } : x)));
    for (const s of placedRef.current.filter((s) => s.srcId === srcId)) {
      const img = await renderPageToImage(doc, s.pageNum, 2);
      setPlaced((arr) => arr.map((x) => (x.id === s.id ? { ...x, href: img.href, baseW: img.baseW, baseH: img.baseH, missing: false } : x)));
    }
    if (!pdfsRef.current.some((p) => p.missing && p.srcId !== srcId)) setErr("");
    // A re-dropped sheet that was previously UNSTORED (oversize, or never uploaded) now gets
    // persisted so it survives the next reload instead of going missing again — the recovery
    // path for B409. Large files take the browser-direct Drive route. Same srcId, so the
    // sheet's placement + markups stay bound. Skip sheets that already have a key (a transient
    // fetch miss) so we don't create a duplicate Drive copy.
    const src = pdfsRef.current.find((p) => p.srcId === srcId);
    const needsStore = !src || src.oversize || (!src.driveKey && !src.storageKey);
    if (blob && needsStore) {
      const name = (blob && blob.name) || (src && src.name) || "document.pdf";
      storeSource(srcId, blob, { projectId: meta.projectId, discipline: meta.discipline, fileName: name }).then((r) =>
        setPdfs((p) => p.map((x) => (x.srcId === srcId ? { ...x, storageKey: r.storageKey || null, driveKey: r.driveKey || null, oversize: !!r.oversize } : x)))
      ).catch(() => {}); // best-effort persist; don't leak an unhandled rejection
    }
  };

  // Remove a placed sheet. If this drops the world-frame (the index-0 sheet that defines the
  // shared coordinate space), promote the NEW first sheet to the frame so a leftover
  // aligned:false sheet isn't stranded — otherwise it loses its "Align" button (gated on i>0)
  // AND stays measurement-blocked (aligned:false), an unrecoverable stuck state.
  const removeSheet = (id) => setPlaced((arr) => {
    const next = arr.filter((x) => x.id !== id);
    if (next.length && next[0].aligned === false) next[0] = { ...next[0], aligned: true };
    return next;
  });

  // Find a page's read metadata (detail refs/anchors/notes/sheet number) from the background
  // read+group pass, so a single-page add carries the same furniture a grouped add does.
  const pageMetaOf = (pdf, pageNum) => {
    for (const g of pdf.groups || []) { const pg = (g.pages || []).find((p) => p.pageNum === pageNum); if (pg) return pg; }
    return {};
  };

  const addSheet = async (pdf, pageNum) => {
    if (loadingRef.current) return; // a load is rebuilding placed[]; its blind setPlaced would clobber this sheet (B51)
    setBusy(true);
    try {
      const img = await renderPageToImage(pdf.doc, pageNum, 2);
      const pm = pageMetaOf(pdf, pageNum);
      setPlaced((arr) => {
        let M = { ...ID };
        if (arr.length) { const right = Math.max(...arr.map((s) => sheetBBox(s).maxX)); M = { ...ID, e: right + 40 }; }
        // The first sheet IS the world frame (auto-aligned). Every later sheet drops at
        // identity scale offset to the right and must be Aligned before its measurements
        // can be trusted — track that per sheet so we can flag + warn until it is (B301).
        return [...arr, { id: uid(), srcId: pdf.srcId, pageNum, name: `${pdf.name} · p${pageNum}`, href: img.href, baseW: img.baseW, baseH: img.baseH, M, missing: false, aligned: arr.length === 0,
          sheetNumber: pm.sheetNumber || "", detailRefs: pm.detailRefs || [], detailAnchors: pm.detailAnchors || [], notes: pm.notes || [] }];
      });
    } finally { setBusy(false); }
  };

  /* Add a whole LOGICAL sheet at once (B335): render every page in the group, AUTO-STITCH them
   * from their match-line seams (B337), AUTO-CALIBRATE from the stated scale (B339), and tag the
   * title-block band so the composite can crop it (B338). A single-page logical sheet just drops
   * one page. Sheets the seam graph can't reach stay aligned:false → the manual-Align safety net,
   * pre-seeded with their detected seam endpoints. The drawing-area edge is the seam reference. */
  const addGroup = async (pdf, group) => {
    if (loadingRef.current) return;
    setBusy(true); setNotice("");
    try {
      const built = [];
      const renderFailed = []; // B536: pages whose raster threw (corrupt page / worker crash)
      for (const pg of group.pages) {
        let img;
        // B536: a single failed page-render used to throw past the loop, so the whole group-drop
        // silently did NOTHING (no sheets, no message). Skip the bad page and report it instead.
        try { img = await renderPageToImage(pdf.doc, pg.pageNum, 2); }
        catch (_) { renderFailed.push(pg.sheetNumber || ("p" + pg.pageNum)); continue; }
        const da = pg.drawingArea && pg.drawingArea.w ? pg.drawingArea : { x: 0, y: 0, w: img.baseW, h: img.baseH };
        built.push({
          id: uid(), srcId: pdf.srcId, pageNum: pg.pageNum,
          name: `${pdf.name.replace(/\.pdf$/i, "")} · ${pg.sheetNumber || "p" + pg.pageNum}`,
          href: img.href, baseW: img.baseW, baseH: img.baseH,
          drawingArea: da, sheetNumber: pg.sheetNumber || "", matchLines: pg.matchLines || [], missing: false,
          detailRefs: pg.detailRefs || [], detailAnchors: pg.detailAnchors || [], notes: pg.notes || [],
        });
      }
      // B536: every page failed to render → nothing to place. Tell the user (re-drop to retry)
      // rather than leaving the drop looking like it did nothing.
      if (!built.length) { setNotice(`Couldn’t render ${renderFailed.length === 1 ? "the page" : `any of the ${group.pages.length} pages`} — re-drop the file to retry.`); return; }
      const placeInput = built.map((s) => ({ id: s.id, sheetNumber: s.sheetNumber, drawingArea: s.drawingArea, matchLines: s.matchLines, baseW: s.baseW, baseH: s.baseH }));
      const auto = autoPlaceGroup(placeInput);
      let placements = auto.placements; const unplaced = auto.unplaced;
      // B413 — refine each auto-placed seam from the rendered pixels: find the REAL (inset/skewed)
      // match line on both sheets and land the neighbor's exactly on the anchor's, so a scanned
      // set joins seamlessly instead of butting paper edges. Best-effort: any sheet we can't fit
      // confidently keeps its label-based placement, so this only improves seams, never breaks one.
      if (built.length > 1 && built.length <= 12) {
        try {
          const rasters = new Map();
          for (const s of built) {
            if (!placements.has(s.id)) continue;
            const im = await renderPageToImageData(pdf.doc, s.pageNum, 2);
            const { bin, W, H } = binarizeImageData(im.data);
            rasters.set(s.id, { bin, W, H, pagePerRaster: im.baseW / W });
          }
          placements = refineGroupPlacements({ sheets: placeInput, placements, anchorId: auto.anchorId, rasterOf: (id) => rasters.get(id) || null });
        } catch (_) { /* refine is best-effort; keep label placements on any failure */ }
      }
      const existing = placedRef.current;
      const GAP = 40;
      const right = existing.length ? Math.max(...existing.map((s) => sheetBBox(s).maxX)) : 0;
      // World bbox of the auto-placed members, so the whole group slots to the right of existing
      // content with its internal layout preserved (a single translation, scale untouched).
      const placedSheets = built.filter((s) => placements.has(s.id));
      let minX = Infinity, minY = Infinity, maxX = -Infinity;
      for (const s of placedSheets) { const bb = sheetBBox({ baseW: s.baseW, baseH: s.baseH, M: placements.get(s.id) }); minX = Math.min(minX, bb.minX); minY = Math.min(minY, bb.minY); maxX = Math.max(maxX, bb.maxX); }
      if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 0; }
      const dx = right + GAP - minX, dy = 40 - minY;
      const crop = group.kind === "group";
      const newSheets = placedSheets.map((s) => {
        const M0 = placements.get(s.id);
        return { ...s, M: { A: M0.A, B: M0.B, e: M0.e + dx, f: M0.f + dy }, aligned: true, grouped: crop, groupLabel: group.label };
      });
      // Unplaced members (no readable seam): drop them to the right, needing manual Align.
      let off = right + GAP + (maxX - minX) + GAP;
      for (const s of built.filter((s) => !placements.has(s.id))) {
        newSheets.push({ ...s, M: { ...ID, e: off }, aligned: false, grouped: false, groupLabel: group.label });
        off += s.baseW + GAP;
      }
      setPlaced((arr) => [...arr, ...newSheets]);
      // Auto-calibrate the composite from the group's stated scale, once (B339).
      let calMsg = "";
      if (!ftPerUnit && crop) { const cal = groupCalibration(group.pages); if (cal) { setFtPerUnit(cal.ftPerUnit); calMsg = ` · scale ${cal.label || "set"} from sheet`; } }
      const failMsg = renderFailed.length ? ` · ${renderFailed.length} page${renderFailed.length > 1 ? "s" : ""} couldn’t render (re-drop to retry)` : ""; // B536
      setNotice(unplaced.length
        ? `Auto-stitched ${placedSheets.length} of ${built.length} sheets${calMsg} — ${unplaced.length} need a quick manual Align.${failMsg}`
        : (built.length > 1 || failMsg) ? `Auto-stitched ${placedSheets.length} sheets${calMsg}.${failMsg}` : "");
    } finally { setBusy(false); }
  };

  // Screen<->world via the shared viewport engine (B329); { zoom, panX, panY } == { scale, tx, ty }.
  const toWorld = (e) => { const r = svgRef.current.getBoundingClientRect(); return screenToWorld({ scale: view.zoom, tx: view.panX, ty: view.panY }, { x: e.clientX - r.left, y: e.clientY - r.top }); };

  // Start a manual Align. When the sheet's own match-line seam was detected (B336) but it
  // couldn't be auto-placed, PRE-SEED the moving sheet's two seam endpoints so the user only
  // clicks the two matching points on a placed sheet — half the clicks (B337 fallback chain).
  const startAlign = (sheetId) => {
    setTool("pan"); setDraft(null); setErr("");
    const s = placed.find((x) => x.id === sheetId);
    const ml = s && (s.matchLines || []).find((m) => m.side);
    const ends = ml && s.drawingArea ? detectedEndpointsFor(s.drawingArea, ml.side) : null;
    if (ends) setAlign({ sheetId, step: 0, seeded: true, b1: ends[0], b2: ends[1] });
    else setAlign({ sheetId, step: 0 });
  };

  // Hard-block a measurement that lands over a sheet that hasn't been aligned yet — its scale
  // isn't set until Align runs, so the length/area would be SILENTLY WRONG. Refuse the point
  // and tell the user to Align first. (B301 warned but still committed; B313 blocks outright —
  // owner call: never measure on an un-aligned / un-scaled sheet.) Calibrate is exempt: that's
  // the act of SETTING the scale, not reading one off.
  const blockedOverUnaligned = (pts) => {
    if (measureOverUnaligned(placed, pts)) {
      setErr("Align that sheet before measuring on it — its scale isn't set yet, so the length/area would be wrong.");
      return true;
    }
    return false;
  };

  const onDown = (e) => {
    if (calInput) return; // finish the inline Calibrate entry first
    const w = toWorld(e);
    if (align) {
      const sheet = placed.find((s) => s.id === align.sheetId);
      if (!sheet) { setAlign(null); return; } // the sheet being aligned was removed mid-align — bail, don't crash on sheet.M
      if (align.seeded) {
        // The moving sheet's seam endpoints (b1,b2) are already known — just collect the two
        // matching points on a placed sheet, then solve.
        if (align.step === 0) { setAlign({ ...align, step: 1, A1: w }); return; }
        const A2 = w;
        if (alignBaselinesDegenerate(align.b1, align.b2, align.A1, A2)) {
          setErr("Those two points are too close together — pick two points farther apart.");
          setAlign({ sheetId: align.sheetId, step: 0, seeded: true, b1: align.b1, b2: align.b2 });
          return;
        }
        setPlaced((arr) => arr.map((s) => (s.id === align.sheetId ? { ...s, M: solveM(align.b1, align.b2, align.A1, A2), aligned: true } : s)));
        setAlign(null); setErr("");
        return;
      }
      if (align.step === 0) setAlign({ ...align, step: 1, A1: w });
      else if (align.step === 1) setAlign({ ...align, step: 2, b1: inv(sheet.M, w) });
      else if (align.step === 2) setAlign({ ...align, step: 3, A2: w });
      else {
        const b2 = inv(sheet.M, w);
        // B300 — reject a degenerate alignment (the two points on either sheet landed on
        // ~the same spot): solveM would divide by a ~0 baseline and fling the sheet far away
        // at huge scale, silently and with no undo. Leave the sheet untouched and restart
        // this alignment (mirrors the Calibrate "line too short" guard).
        if (alignBaselinesDegenerate(align.b1, b2, align.A1, align.A2)) {
          setErr("Those two points are too close together — pick two points farther apart, then click the matching points again.");
          setAlign({ sheetId: align.sheetId, step: 0 });
          return;
        }
        const M = solveM(align.b1, b2, align.A1, align.A2);
        setPlaced((arr) => arr.map((s) => (s.id === align.sheetId ? { ...s, M, aligned: true } : s)));
        setAlign(null); setErr("");
      }
      return;
    }
    if (tool === "pan") { drag.current = { sx: e.clientX, sy: e.clientY, panX: view.panX, panY: view.panY, pointerId: e.pointerId }; svgRef.current.setPointerCapture(e.pointerId); return; } // B551: remember pointerId so a blur/visibility abort can release the capture
    // B313 — refuse a distance/area point that lands on a not-yet-aligned sheet (its scale
    // isn't set, so the reading would be silently wrong). Calibrate is exempt — it SETS scale.
    if ((tool === "distance" || tool === "area") && blockedOverUnaligned([w])) return;
    if (tool === "calibrate" || tool === "distance") {
      if (!draft) setDraft({ kind: tool, pts: [w] });
      else { const pts = [draft.pts[0], w]; if (tool === "calibrate") doCalibrate(pts); else { pushHistory(); setMeasures((m) => [...m, { id: uid(), kind: "distance", pts }]); } setDraft(null); }
      return;
    }
    if (tool === "area") setDraft((d) => (d && d.kind === "area" ? { ...d, pts: [...d.pts, w] } : { kind: "area", pts: [w] }));
  };
  const onMove = (e) => {
    setCursor(toWorld(e));
    // Capture the drag origin into a local NOW, then close over it (panTo). This setView updater
    // runs in React's render phase, which for a continuous event (pointermove) can be deferred a
    // tick — and a discrete event in between (pointerup, pointercancel, or the blur/visibility
    // abort below) may null drag.current first. Reading the ref *inside* the deferred updater
    // then dereferenced null → the whole stitcher crashed (B325: "reading 'panX'"). The captured
    // `d` keeps the pan correct even if the gesture is aborted mid-flight.
    const d = drag.current;
    if (d) setView((v) => panTo(v, d, e.clientX, e.clientY));
  };
  const onUp = (e) => { if (drag.current) { drag.current = null; try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {} } };
  // NEW-1 — recover from a pan whose gesture was interrupted (browser pointercancel, window
  // blur, tab hidden, or a devtools/remote-debugger attaching) rather than ending with a
  // normal pointer-up, so the stitcher canvas can never be left stuck mid-pan with pointer-
  // capture held and a frozen grab cursor that swallows clicks.
  const abortGesture = (pid) => { if (pid != null && svgRef.current) { try { svgRef.current.releasePointerCapture(pid); } catch (_) {} } drag.current = null; };
  useEffect(() => {
    // B551: pass the in-flight pointerId so abortGesture actually RELEASES the capture (without it,
    // `pid != null` was false → capture held → frozen grab cursor + swallowed clicks after alt-tab).
    const recover = () => { if (drag.current) abortGesture(drag.current.pointerId); };
    const onVis = () => { if (document.hidden) recover(); };
    window.addEventListener("blur", recover);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("blur", recover); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  const onWheel = (e) => { e.preventDefault(); const r = svgRef.current.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; setView((v) => { const nv = zoomAround({ scale: v.zoom, tx: v.panX, ty: v.panY }, e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my, 0.05, 8); return { zoom: nv.scale, panX: nv.tx, panY: nv.ty }; }); };
  // ± zoom buttons anchor on the viewport CENTRE (not the world origin), matching the cursor-
  // anchored wheel path — otherwise the content slid toward the top-left corner on every click.
  const zoomBtn = (factor) => { const el = svgRef.current; if (!el) return; const r = el.getBoundingClientRect(); setView((v) => { const nv = zoomAround({ scale: v.zoom, tx: v.panX, ty: v.panY }, factor, r.width / 2, r.height / 2, 0.05, 8); return { zoom: nv.scale, panX: nv.tx, panY: nv.ty }; }); };
  // Area points are blocked at click-time (onDown) when over an un-aligned sheet, so a
  // committed area can't include one; just gate on the ≥3-point minimum here. (B302/B313)
  const finishArea = () => { if (draft && draft.kind === "area" && draft.pts.length >= 3) { pushHistory(); setMeasures((m) => [...m, { id: uid(), kind: "area", pts: draft.pts }]); } setDraft(null); };

  // Two points placed → open an INLINE entry box (no window.prompt — owner rule). Store only
  // the WORLD points; the box's screen position is derived from the live pan/zoom at render
  // time (below), so a wheel-zoom while the box is open can't leave it stranded off its line. (B304)
  const doCalibrate = (pts) => {
    const u = dist(pts[0], pts[1]);
    if (u < 1) { setErr("Line too short — zoom in and retry."); return; }
    setErr("");
    setCalInput({ pts, value: "" });
  };
  // Validate + apply the composite calibration; reject ratios/junk with a message (B304).
  const commitCalibrate = () => {
    if (!calInput) return;
    const r = parseFeet(calInput.value);
    if (r.empty) { setCalInput(null); setErr(""); return; }
    if (!r.ok) { setErr(r.message); return; }
    const u = dist(calInput.pts[0], calInput.pts[1]);
    if (!(u >= 1)) { setErr("Points too close — recalibrate."); setCalInput(null); return; } // B546: never divide by ~0 → Infinity ftPerUnit (mirrors doCalibrate's guard; also catches NaN)
    pushHistory();
    setFtPerUnit(r.ft / u);
    setCalInput(null); setErr("");
  };

  // Bind the window keydown listener ONCE; refresh the handler via a ref so it keeps
  // live closures (finishArea reads the current draft) without re-subscribing on every
  // render — onPointerMove re-renders constantly while drawing (B41).
  const onKeyRef = useRef(null);
  onKeyRef.current = (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && (e.key === "z" || e.key === "Z")) { e.preventDefault(); if (e.shiftKey) redo(); else if (!removeLastVertex()) undo(); return; }
    if (mod && (e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
    if (mod) return;
    if (e.key === "Enter") finishArea();
    else if (e.key === "Escape") { setDraft(null); setAlign(null); setCalInput(null); closeDetail(); }
    else if ((e.key === "Delete" || e.key === "Backspace") && removeLastVertex()) e.preventDefault();
  };
  useEffect(() => {
    const onKey = (e) => onKeyRef.current && onKeyRef.current(e);
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* ---- cloud persistence (stitched set): autosave, resume, load, new ---- */
  const onMeta = (k, v) => setMeta((m) => ({ ...m, [k]: v }));
  const buildSnapshot = useCallback(() => ({
    id: reviewId, kind: "stitch", updatedAt: Date.now(), // stamp so the local mirror + cloud data carry a consistent updatedAt (reconcile)
    title: (meta.title || "").trim() || composeTitle(meta),
    project: meta.project, projectId: meta.projectId, discipline: meta.discipline,
    item: meta.item, revision: meta.revision, docDate: meta.docDate,
    sources: pdfs.filter(isStoredSource).map((p) => ({ srcId: p.srcId, name: p.name, size: p.size || 0, storageKey: p.storageKey || null, driveKey: p.driveKey || null, oversize: !!p.oversize })),
    stitch: {
      placed: placed.map((s) => ({ id: s.id, srcId: s.srcId, pageNum: s.pageNum, name: s.name, baseW: s.baseW, baseH: s.baseH, M: s.M, aligned: s.aligned !== false, drawingArea: s.drawingArea || null, grouped: !!s.grouped, groupLabel: s.groupLabel || null, matchLines: s.matchLines || [], sheetNumber: s.sheetNumber || "", detailRefs: s.detailRefs || [], detailAnchors: s.detailAnchors || [], notes: s.notes || [] })),
      view, measures, ftPerUnit,
    },
  }), [reviewId, meta, pdfs, placed, view, measures, ftPerUnit]);
  const isEmpty = useCallback(() => placed.length === 0 && measures.length === 0, [placed, measures]);
  // Pan/zoom (`view`) is captured in the snapshot but left out of the save triggers so
  // panning doesn't spam writes — the next real edit (or the flush) saves the latest view.
  const { status, suspendSave, saveNow } = useReviewPersistence({
    buildSnapshot, isEmpty,
    deps: [reviewId, meta, pdfs, placed, measures, ftPerUnit],
  });
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastStitchId", reviewId); } catch (_) {} }, [reviewId]);

  const resetStitch = () => {
    setReviewId(newReviewId());
    setMeta(newMeta());
    setPdfs([]); setPlaced([]); setMeasures([]); setFtPerUnit(0);
    setView({ panX: 40, panY: 40, zoom: 0.4 }); setAlign(null); setDraft(null); setTool("pan"); setErr(""); setCalInput(null); setNotice(""); setShowAllPages(false);
    closeDetail();
    clearHistory();
    pdfsRef.current = []; placedRef.current = [];
  };

  const loadStitch = async (rec) => {
    const tok = ++loadTok.current; // a newer open supersedes this load (B52)
    loadingRef.current = true; setBusy(true);
    suspendSave(); // this programmatic load sets the autosave deps; don't re-save what we loaded (B19)
    try {
      setReviewId(rec.id);
      setMeta({ title: rec.title || "", projectId: rec.projectId || null, project: rec.project || "", discipline: rec.discipline || "", item: rec.item || "", revision: rec.revision || "", docDate: rec.docDate || "" });
      const st = rec.stitch || {};
      setMeasures(st.measures || []); setFtPerUnit(st.ftPerUnit || 0);
      if (st.view) setView(st.view);
      setAlign(null); setDraft(null); setTool("pan"); setCalInput(null); clearHistory();
      // Re-fetch each source PDF; render placed sheets back from the bytes + saved M.
      const srcEntries = [];
      for (const src of rec.sources || []) {
        let doc = null, missing = true;
        if (!src.oversize) {
          // Read-back prefers Google Drive (the file's home), falls back to Supabase Storage
          // so a pre-Drive sheet — or any Drive miss — still opens (B322, fallback-safe).
          let buf = src.driveKey ? await downloadFromDrive(src.driveKey) : null;
          if (!buf && src.storageKey) buf = await downloadSource(src.storageKey);
          if (buf) { doc = await loadPdf(buf); missing = false; }
        }
        srcEntries.push({ srcId: src.srcId, name: src.name, size: src.size || 0, doc, numPages: doc ? doc.numPages : 0, blob: null, storageKey: src.storageKey || null, driveKey: src.driveKey || null, oversize: !!src.oversize, missing });
      }
      if (tok !== loadTok.current) return; // a newer load started — don't overwrite its sources (B52)
      suspendSave(); // re-park across this load's async commits (B19)
      setPdfs(srcEntries); pdfsRef.current = srcEntries;
      const out = [];
      let idx = 0;
      for (const s of st.placed || []) {
        const e = srcEntries.find((x) => x.srcId === s.srcId);
        let href = null, baseW = s.baseW, baseH = s.baseH, missing = true;
        if (e && e.doc) { const img = await renderPageToImage(e.doc, s.pageNum, 2); if (tok !== loadTok.current) return; href = img.href; baseW = img.baseW; baseH = img.baseH; missing = false; }
        // First placed sheet is always the world frame; older saves predate the `aligned`
        // flag, so treat the rest as aligned (they were saved with a real transform) — only
        // genuinely unaligned new sheets carry aligned:false, so we never falsely flag. (B301)
        out.push({ id: s.id, srcId: s.srcId, pageNum: s.pageNum, name: s.name, baseW, baseH, M: s.M, href, missing, aligned: idx === 0 ? true : s.aligned !== false, drawingArea: s.drawingArea || null, grouped: !!s.grouped, groupLabel: s.groupLabel || null, matchLines: s.matchLines || [], sheetNumber: s.sheetNumber || "", detailRefs: s.detailRefs || [], detailAnchors: s.detailAnchors || [], notes: s.notes || [] });
        idx++;
      }
      if (tok !== loadTok.current) return; // superseded before committing the placed sheets (B52)
      suspendSave(); // re-park before the final commit so a slow load's setPlaced isn't re-saved (B19)
      setPlaced(out); placedRef.current = out;
      setErr(srcEntries.some((e) => e.missing) ? "Some source PDFs weren't available (too large to store) — drop the files to fill in the placeholders." : "");
    } finally { if (tok === loadTok.current) { loadingRef.current = false; setBusy(false); } }
  };

  // Controlled load handed down from DocReview (opening a saved stitch review).
  const loadedId = useRef(null);
  useEffect(() => {
    if (!loadReq || loadReq.id === loadedId.current) return;
    loadedId.current = loadReq.id;
    // B505: a load error (corrupt/partial PDF, Drive/Storage byte error) must still CONSUME
    // the request — else the rejection is unhandled AND pendingStitch never clears (loadedId
    // is already set, so the effect won't re-fire), leaving the load permanently half-done.
    loadStitch(loadReq).then(() => onConsumeLoad && onConsumeLoad()).catch(() => onConsumeLoad && onConsumeLoad());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadReq]);
  // Otherwise resume the last stitch session on mount (e.g. toggling back from single).
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return; booted.current = true;
    if (loadReq) return;
    (async () => {
      let sid = null; try { sid = localStorage.getItem("planyr:docreview:lastStitchId"); } catch (_) {}
      if (!sid) return;
      const rec = reconcile(await loadReview(sid), readDraft(await currentUid(), sid));
      if (rec && rec.kind === "stitch") { loadedId.current = rec.id; await loadStitch(rec); }
    })().catch(() => {}); // B534: a resume failure (Drive/Storage/parse) must not be an unhandled
    // rejection — loadStitch owns its own busy via finally, so swallowing here just falls to the
    // empty stitcher instead of leaving a half-started boot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // takeoff totals (world units → feet via composite calibration)
  const totals = measures.reduce((t, m) => {
    if (m.kind === "distance") { const u = dist(m.pts[0], m.pts[1]); if (ftPerUnit) t.distFt += u * ftPerUnit; }
    else if (m.kind === "area") { const u = polyArea(m.pts); if (ftPerUnit) t.areaSf += u * ftPerUnit * ftPerUnit; }
    return t;
  }, { distFt: 0, areaSf: 0 });

  // The composite "key" (B338): the distinct grouped plans currently on the canvas (one merged
  // entry per group, not one title block per sheet). Pinned as a panel so it stays readable at
  // any zoom instead of being baked into the raster.
  const composite = [...new Map(placed.filter((s) => s.groupLabel).map((s) => [s.groupLabel, s])).values()];

  // B350 — pull EVERY placed sheet's notes/legend into one pinned model, deduped, with the
  // sheets each note appeared on, so a note that changes page to page is captured (not lost
  // behind the title-block crop). Keyed by sheet number when known, else the placement order.
  const notesModel = aggregateNotes(placed.map((s, i) => ({ sheet: s.sheetNumber || `#${i + 1}`, notes: s.notes || [] })));
  const noteCount = notesModel.reduce((n, g) => n + g.lines.length, 0);

  // B350 — resolve a detail callout's target sheet to something we can show in the popup:
  // an already-placed sheet's rendered image first (instant), else a page from a loaded PDF
  // (rendered on demand), else nothing (honest "not in this set").
  const findSheetByCode = (code) => {
    const want = normSheet(code);
    if (!want) return null;
    const p = placedRef.current.find((s) => s.href && normSheet(s.sheetNumber) === want);
    if (p) return { href: p.href, baseW: p.baseW, baseH: p.baseH, anchors: p.detailAnchors || [], name: p.name };
    for (const pdf of pdfsRef.current) {
      if (!pdf.doc) continue;
      for (const g of pdf.groups || []) {
        const pg = (g.pages || []).find((x) => normSheet(x.sheetNumber) === want);
        if (pg) return { pdf, pageNum: pg.pageNum, anchors: pg.detailAnchors || [], name: `${pdf.name.replace(/\.pdf$/i, "")} · ${pg.sheetNumber}` };
      }
    }
    return null;
  };

  // Open the "cloud" — pull up the referenced detail without leaving the current drawing.
  const openDetail = async (ref, screen) => {
    setDetailPopup({ ref, screen, status: "loading", title: `Detail ${ref.detail} · Sheet ${ref.sheetRaw || ref.sheet}` });
    const found = findSheetByCode(ref.sheet);
    if (!found) { setDetailPopup({ ref, screen, status: "missing", title: `Detail ${ref.detail} · Sheet ${ref.sheetRaw || ref.sheet}` }); return; }
    try {
      let href = found.href, baseW = found.baseW, baseH = found.baseH;
      if (!href && found.pdf) { const img = await renderPageToImage(found.pdf.doc, found.pageNum, 2); href = img.href; baseW = img.baseW; baseH = img.baseH; }
      // If the target sheet labels this detail ("DETAIL 5"), center the popup on it; else fit.
      const anchor = (found.anchors || []).find((a) => a.detail === ref.detail);
      setDetailPopup({ ref, screen, status: "ready", title: `Detail ${ref.detail} · Sheet ${ref.sheetRaw || ref.sheet}`, href, baseW, baseH, anchor: anchor || null, name: found.name, ownHref: !found.href });
    } catch (_) { setDetailPopup({ ref, screen, status: "missing", title: `Detail ${ref.detail} · Sheet ${ref.sheetRaw || ref.sheet}` }); }
  };
  // Free a popup image we rendered ourselves (not one borrowed from a placed sheet) on close/replace.
  const closeDetail = () => { setDetailPopup((d) => { if (d && d.ownHref && d.href && d.href.startsWith("blob:")) { try { URL.revokeObjectURL(d.href); } catch (_) {} } return null; }); };
  const detailDrag = useRef(null);
  // Initialise the popup's view once the image is ready: center+zoom on the named detail if the
  // target sheet labels it, else fit the whole sheet. The user can then pan/zoom inside the cloud.
  useEffect(() => {
    if (!detail || detail.status !== "ready" || detail.view || !detail.baseW) return;
    const fit = Math.min(DBOX.w / detail.baseW, DBOX.h / detail.baseH);
    let view;
    if (detail.anchor) {
      const sc = Math.min(Math.max(fit * 3.2, fit), 2);
      view = { scale: sc, tx: DBOX.w / 2 - sc * detail.anchor.x, ty: DBOX.h / 2 - sc * detail.anchor.y };
    } else {
      view = { scale: fit, tx: (DBOX.w - fit * detail.baseW) / 2, ty: (DBOX.h - fit * detail.baseH) / 2 };
    }
    setDetailPopup((d) => (d ? { ...d, view } : d));
  }, [detail]);
  const detailWheel = (e) => {
    e.preventDefault();
    const box = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - box.left, my = e.clientY - box.top;
    setDetailPopup((d) => {
      if (!d || !d.view) return d;
      const ns = Math.max(0.03, Math.min(10, d.view.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const k = ns / d.view.scale;
      return { ...d, view: { scale: ns, tx: mx - (mx - d.view.tx) * k, ty: my - (my - d.view.ty) * k } };
    });
  };
  const detailFit = () => setDetailPopup((d) => {
    if (!d || !d.baseW) return d;
    const fit = Math.min(DBOX.w / d.baseW, DBOX.h / d.baseH);
    return { ...d, view: { scale: fit, tx: (DBOX.w - fit * d.baseW) / 2, ty: (DBOX.h - fit * d.baseH) / 2 } };
  });

  // The tray shows LOGICAL sheets (B335) once a file has been read+grouped: one entry per
  // group/single, click to add the whole thing auto-stitched. "Show all pages" (or a file still
  // being read) falls back to the raw per-page list — the safety net that never went away.
  // A file has a usable grouped view only once its read produced ≥1 logical sheet. On a read
  // FAILURE (`groups` set to []) — or a 0-page doc — fall back to the raw per-page list instead
  // of rendering nothing, otherwise that file's pages were invisible in the grouped tray with no
  // way to add them (groupSheets always yields ≥1 run for a readable page, so empty == failure).
  const hasGroups = (p) => Array.isArray(p.groups) && p.groups.length > 0;
  const trayItems = pdfs.flatMap((p) => {
    const useGroups = !showAllPages && hasGroups(p);
    if (useGroups) return p.groups.map((g, gi) => ({ key: p.srcId + ":g" + gi, pdf: p, group: g }));
    return Array.from({ length: p.numPages }, (_, i) => ({ key: p.srcId + ":p" + (i + 1), pdf: p, page: i + 1 }));
  });
  const anyGroups = pdfs.some(hasGroups);
  const G = `translate(${view.panX} ${view.panY}) scale(${view.zoom})`;
  const ls = (n) => n / view.zoom; // constant on-screen size inside the zoomed group
  // Detail hotspots only grab clicks in Pan mode (so measure/align/calibrate clicks pass through). (B350)
  const refsInteractive = showRefs && tool === "pan" && !align && !draft;
  // Live screen position of the inline Calibrate box, derived from the stored WORLD points each
  // render so it follows the line under pan/zoom (the box doesn't block the wheel). (B304)
  const calPos = calInput ? worldToScreen({ scale: view.zoom, tx: view.panX, ty: view.panY }, { x: (calInput.pts[0].x + calInput.pts[1].x) / 2, y: (calInput.pts[0].y + calInput.pts[1].y) / 2 }) : null;
  const btn = (on) => ({ padding: "6px 10px", fontSize: 11.5, whiteSpace: "nowrap", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${on ? PAL.accent : "var(--border-default)"}`, background: on ? PAL.accent : "var(--surface-raised)", color: on ? "var(--on-accent)" : PAL.ink });
  const iconBtn = (disabled) => ({ ...btn(false), padding: "5px 8px", opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" });
  const alignMsg = align && (align.seeded
    ? ["Seam detected — click where its FIRST end lands on the placed sheet", "Click where its SECOND end lands"][align.step]
    : ["Click reference point #1 (on a placed sheet)", "Click the SAME point on the sheet being aligned", "Click reference point #2", "Click the matching point #2 on the sheet"][align.step]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.paper, position: "relative" }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFiles(e.dataTransfer.files); }}>
      {/* toolbar */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: PAL.chrome, borderBottom: "1px solid var(--chrome-divider)", flexWrap: "wrap" }}>
        <button style={{ ...btn(false), border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)", color: PAL.chromeInk }} onClick={onReview}>‹ Single sheet</button>
        <span style={{ width: 1, height: 20, background: "var(--chrome-divider)" }} />
        <label style={{ ...btn(false), display: "inline-block" }}>
          Open PDFs…<input type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => { openFiles(e.target.files); e.target.value = ""; }} />
        </label>
        {[["pan", "Pan"], ["distance", "Distance"], ["area", "Area"], ["calibrate", "Calibrate"]].map(([id, lbl]) => (
          <button key={id} style={btn(tool === id && !align)} onClick={() => { setTool(id); setDraft(null); setAlign(null); }}>{lbl}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={iconBtn(!canUndo)} disabled={!canUndo} onClick={undo} title="Undo (⌘/Ctrl-Z)">↶</button>
        <button style={iconBtn(!canRedo)} disabled={!canRedo} onClick={redo} title="Redo (⌘/Ctrl-Shift-Z)">↷</button>
        <span style={{ width: 1, height: 20, background: "var(--chrome-divider)" }} />
        <button style={btn(false)} onClick={() => zoomBtn(1 / 1.2)}>−</button>
        <span style={{ color: PAL.chromeMuted, fontSize: 11.5, width: 42, textAlign: "center" }}>{Math.round(view.zoom * 100)}%</span>
        <button style={btn(false)} onClick={() => zoomBtn(1.2)}>+</button>
        <span style={{ width: 1, height: 20, background: "var(--chrome-divider)" }} />
        <button style={btn(cropBlocks)} onClick={() => setCropBlocks((v) => !v)} title="Hide each grouped sheet's title block so the drawings butt cleanly (B338)">{cropBlocks ? "✓ " : ""}Crop blocks</button>
        <button style={btn(showRefs)} onClick={() => setShowRefs((v) => !v)} title="Show clickable detail-callout hotspots — click one to pull up that detail in a popup (B350)">{showRefs ? "✓ " : ""}Details</button>
        {/* The Stitcher has its own chrome (no shared AppHeader), so the app-wide save
            indicator (NEW-1) rides here next to Reviews — same compact cloud glyph, same
            normalized state, so a failed save is just as loud as everywhere else. */}
        <CloudSyncBadge
          state={docSaveState(status, signedIn, placed.length === 0)}
          onRetry={status === "conflict" ? undefined : saveNow}
          detail={status === "conflict" ? "This review was changed in another session. Reload to merge in the latest before saving — your edit is safe on this device." : undefined}
        />
        <ReviewsBar signedIn={signedIn} meta={meta} onMeta={onMeta} onOpen={onOpenReview || (() => {})} onNew={resetStitch} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* tray */}
        <div style={{ flex: "none", width: 168, background: "#fff", borderRight: `1px solid ${PAL.line}`, overflowY: "auto", padding: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
            <div style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{showAllPages || !anyGroups ? "Sheets" : "Logical sheets"}</div>
            {anyGroups && <button onClick={() => setShowAllPages((v) => !v)} style={{ fontSize: 10, color: PAL.accent, background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}>{showAllPages ? "grouped" : "all pages"}</button>}
          </div>
          {reading && <div style={{ fontSize: 10.5, color: PAL.accent, marginBottom: 6 }}>{ocrRunning ? "Reading scanned sheet (OCR)…" : "Reading sheets…"}</div>}
          {trayItems.length === 0 && !reading && <div style={{ fontSize: 11.5, color: PAL.muted, lineHeight: 1.5 }}>Open or drop a PDF set — it’ll group the pages into logical sheets here.</div>}
          {trayItems.map((t) => t.group ? (
            <button key={t.key} onClick={() => addGroup(t.pdf, t.group)} title={`${t.group.label} — ${t.pdf.name}`}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 4, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11, border: `1px solid ${t.group.kind === "group" ? "#c7b88f" : PAL.line}`, background: t.group.kind === "group" ? "#fbf7ec" : "#fff", color: PAL.ink }}>
              <div style={{ display: "flex", alignItems: "center", gap: 4, overflow: "hidden" }}>
                <span style={{ flex: "none", fontWeight: 700, color: t.group.kind === "group" ? "#8a6d1f" : PAL.muted }}>{t.group.kind === "group" ? "▣" : "+"}</span>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: t.group.kind === "group" ? 650 : 400 }}>{t.group.title}</span>
              </div>
              {t.group.kind === "group" && <div style={{ fontSize: 9.5, color: PAL.muted, marginTop: 1 }}>{t.group.sheetRange} · {t.group.pages.length} sheets · auto-stitch</div>}
            </button>
          ) : (
            <button key={t.key} onClick={() => addSheet(t.pdf, t.page)} title={t.pdf.name}
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px", marginBottom: 3, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 11, border: `1px solid ${PAL.line}`, background: "#fff", color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              + {t.pdf.name.replace(/\.pdf$/i, "")} · p{t.page}
            </button>
          ))}
        </div>

        {/* world canvas */}
        <div style={{ flex: 1, minWidth: 0, position: "relative", background: "var(--canvas-mat)" }}>
          <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", cursor: align ? "crosshair" : tool === "pan" ? "grab" : "crosshair", touchAction: "none" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={(e) => abortGesture(e.pointerId)} onDoubleClick={finishArea}
            onWheel={onWheel} onMouseDown={(e) => e.preventDefault()}>
            <g transform={G}>
              {placed.map((s) => {
                const aligning = align && align.sheetId === s.id;
                const unaligned = s.aligned === false && !aligning; // not yet aligned — flag it (B301)
                const xf = `matrix(${s.M.A} ${s.M.B} ${-s.M.B} ${s.M.A} ${s.M.e} ${s.M.f})`;
                if (!s.href) { // source bytes unavailable (too large / not yet re-dropped) — placeholder
                  return <g key={s.id} transform={xf} opacity={aligning ? 0.6 : 1}>
                    <rect x={0} y={0} width={s.baseW} height={s.baseH} fill="#e7e2d6" stroke="#b3361b" strokeWidth={ls(2)} strokeDasharray={`${ls(8)} ${ls(6)}`} />
                    <text x={s.baseW / 2} y={s.baseH / 2} fontSize={ls(22)} textAnchor="middle" fill="#b3361b" fontWeight="700">Re-drop “{s.name}”</text>
                  </g>;
                }
                // B338 — on a grouped composite, clip each sheet to its drawing area so the
                // title-block band is hidden and the drawing areas butt cleanly. Fail open: only
                // when a band was actually detected (drawingArea smaller than the full page).
                const da = s.drawingArea;
                const cropped = cropBlocks && s.grouped && da && (da.w < s.baseW - 1 || da.h < s.baseH - 1);
                const clipId = "tbclip-" + s.id;
                return <g key={s.id} transform={xf}>
                  {cropped && <clipPath id={clipId}><rect x={da.x} y={da.y} width={da.w} height={da.h} /></clipPath>}
                  <image href={s.href} x={0} y={0} width={s.baseW} height={s.baseH} preserveAspectRatio="none"
                    clipPath={cropped ? `url(#${clipId})` : undefined}
                    opacity={aligning ? 0.6 : 1} style={{ outline: aligning ? "2px solid #c2410c" : "none" }} />
                  {unaligned && <>
                    <rect x={0} y={0} width={s.baseW} height={s.baseH} fill="#f59e0b14" stroke="#b45309" strokeWidth={ls(2.5)} strokeDasharray={`${ls(12)} ${ls(8)}`} pointerEvents="none" />
                    <text x={s.baseW / 2} y={ls(30)} fontSize={ls(22)} textAnchor="middle" fill="#b45309" fontWeight="700" pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(5) }}>⚠ Not aligned — click “Align”</text>
                  </>}
                  {/* B350 — clickable detail-callout hotspots: ring the printed bubble; click pulls
                      up that detail in a popup. Interactive only in Pan mode so measure/align clicks
                      aren't swallowed; stopPropagation keeps a click from also starting a pan. */}
                  {showRefs && (s.detailRefs || []).map((r, ri) => (
                    <g key={"ref" + ri} transform={`translate(${r.x} ${r.y})`}
                      style={{ cursor: refsInteractive ? "pointer" : "default" }}
                      pointerEvents={refsInteractive ? "auto" : "none"}
                      onPointerDown={refsInteractive ? (e) => e.stopPropagation() : undefined}
                      onClick={refsInteractive ? (e) => { e.stopPropagation(); openDetail(r, { x: e.clientX, y: e.clientY }); } : undefined}>
                      <circle r={ls(12)} fill="#1d4ed8" fillOpacity={detail && detail.ref === r ? 0.28 : 0.12} stroke="#1d4ed8" strokeWidth={ls(1.8)} />
                      <text y={ls(4)} fontSize={ls(12)} textAnchor="middle" fill="#1d4ed8" fontWeight="800" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(3) }}>{r.detail}</text>
                    </g>
                  ))}
                </g>;
              })}
              {/* measures (world coords) */}
              {measures.map((m) => {
                if (m.kind === "distance") { const a = m.pts[0], b = m.pts[1]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return <g key={m.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e7490" strokeWidth={ls(2)} /><text x={mid.x} y={mid.y - ls(4)} fontSize={ls(12)} fontWeight="700" fill="#0e7490" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(3) }}>{ftPerUnit ? `${f1(dist(a, b) * ftPerUnit)} ft` : "set scale"}</text></g>; }
                const c = centroidOf(m.pts); // area-weighted centroid, clamped inside concave shapes (B307)
                const sf = polyArea(m.pts) * ftPerUnit * ftPerUnit;
                return <g key={m.id}><polygon points={m.pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="#0e749022" stroke="#0e7490" strokeWidth={ls(2)} /><text x={c.x} y={c.y} fontSize={ls(12)} fontWeight="700" fill="#0e7490" textAnchor="middle" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(3) }}>{ftPerUnit ? `${f2(ftToAcres(sf))} ac` : "set scale"}</text></g>;
              })}
              {/* draft */}
              {draft && (() => {
                const col = draft.kind === "calibrate" ? PAL.accent : "#0e7490";
                const pts = cursor ? [...draft.pts, cursor] : draft.pts;
                if (draft.kind === "area") return <polyline points={pts.map((q) => `${q.x},${q.y}`).join(" ")} fill="none" stroke={col} strokeWidth={ls(2)} strokeDasharray={`${ls(5)} ${ls(4)}`} />;
                const a = draft.pts[0]; return <g>{cursor && <line x1={a.x} y1={a.y} x2={cursor.x} y2={cursor.y} stroke={col} strokeWidth={ls(2)} strokeDasharray={`${ls(5)} ${ls(4)}`} />}<circle cx={a.x} cy={a.y} r={ls(3)} fill={col} /></g>;
              })()}
              {/* align ref markers */}
              {align && [align.A1, align.A2].map((p, i) => p && <circle key={i} cx={p.x} cy={p.y} r={ls(5)} fill="none" stroke="#c2410c" strokeWidth={ls(2)} />)}
              {/* Seeded align: number the moving sheet's detected seam endpoints at their current
                  position so the user knows which end is "first"/"second" — otherwise clicking the
                  matching points in reverse order silently flips the sheet 180°. */}
              {align && align.seeded && (() => {
                const s = placed.find((x) => x.id === align.sheetId);
                if (!s || !align.b1 || !align.b2) return null;
                return [align.b1, align.b2].map((bp, i) => {
                  const w = fwd(s.M, bp);
                  return <g key={"seed" + i}>
                    <circle cx={w.x} cy={w.y} r={ls(6)} fill="none" stroke="#2563eb" strokeWidth={ls(2)} />
                    <text x={w.x} y={w.y - ls(9)} fontSize={ls(16)} textAnchor="middle" fill="#2563eb" fontWeight="700" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(4) }}>{i + 1}</text>
                  </g>;
                });
              })()}
            </g>
          </svg>
          {/* Inline Calibrate entry (B304) — replaces window.prompt; validates the typed length. */}
          {calInput && (
            <div style={{ position: "absolute", left: calPos.x, top: calPos.y, transform: "translate(-50%, -135%)", zIndex: 5, width: 214, background: "#fff", border: `1px solid ${PAL.accent}`, borderRadius: 8, padding: "7px 9px", boxShadow: "0 6px 20px rgba(0,0,0,0.28)", fontFamily: "system-ui, sans-serif" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 11, color: PAL.muted, whiteSpace: "nowrap" }}>Real length</span>
                <input autoFocus value={calInput.value}
                  onChange={(e) => { const v = e.target.value; setCalInput((c) => (c ? { ...c, value: v } : c)); if (err) setErr(""); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); commitCalibrate(); } else if (e.key === "Escape") { e.preventDefault(); setCalInput(null); setErr(""); } }}
                  placeholder={`120  or  38'-7"`}
                  style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontFamily: "inherit", padding: "3px 6px", border: `1px solid ${err ? "#dc2626" : PAL.line}`, borderRadius: 5, outline: "none" }} />
                <button onMouseDown={(e) => e.preventDefault()} onClick={commitCalibrate} style={{ ...btn(true), padding: "3px 9px", fontSize: 11.5 }}>Set</button>
              </div>
              <div style={{ fontSize: 10.5, marginTop: 4, color: err ? "#dc2626" : PAL.muted, lineHeight: 1.35 }}>
                {err || "Feet, or feet-inches. Enter to set · Esc to cancel."}
              </div>
            </div>
          )}
          {(align || tool !== "pan") && !calInput && (
            <div style={{ position: "absolute", left: "50%", bottom: 14, transform: "translateX(-50%)", background: align ? PAL.accent : "rgba(25,22,19,0.9)", color: "#fff", padding: "7px 14px", borderRadius: 99, fontSize: 12, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 6px 20px rgba(0,0,0,0.3)" }}>
              {align ? alignMsg : tool === "calibrate" ? "Click two points a known distance apart" : tool === "distance" ? "Click two points" : "Click a region; double-click / Enter to close"}
              {align && " · Esc to cancel"}
            </div>
          )}
          {/* Pinned composite KEY (B338): one merged entry per grouped plan + the auto-set scale,
              floated over the canvas so it stays readable at any zoom (not baked into the raster).
              B350 — also carries every sheet's NOTES/LEGEND, aggregated + deduped, so a note that
              changes page to page is still shown (cropping the title block can't lose it). */}
          {(composite.length > 0 || noteCount > 0) && legendOpen && (
            <div style={{ position: "absolute", top: 10, left: 10, zIndex: 4, width: 230, maxHeight: "calc(100% - 20px)", overflowY: "auto", background: "rgba(255,255,255,0.97)", border: `1px solid ${PAL.line}`, borderRadius: 8, padding: "8px 10px", boxShadow: "0 4px 14px rgba(0,0,0,0.16)", fontFamily: "system-ui, sans-serif" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted }}>Composite key</span>
                <button onClick={() => setLegendOpen(false)} title="Hide" style={{ border: "none", background: "none", cursor: "pointer", color: PAL.muted, fontSize: 13, lineHeight: 1, padding: 0 }}>×</button>
              </div>
              {composite.map((s) => (
                <div key={s.groupLabel} style={{ fontSize: 11.5, color: PAL.ink, padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.groupLabel}>{s.groupLabel}</div>
              ))}
              <div style={{ fontSize: 10.5, color: (Number.isFinite(ftPerUnit) && ftPerUnit) ? "#15803d" : "#b45309", marginTop: 5, borderTop: `1px solid ${PAL.line}`, paddingTop: 4 }}>
                {/* B546: Number.isFinite guard — a non-finite ftPerUnit (e.g. a corrupt loaded review) is truthy and would render "1\" ≈ ∞'". */}
                {(Number.isFinite(ftPerUnit) && ftPerUnit) ? `Scale set · 1" ≈ ${f0(ftPerUnit * 72)}'` : "Scale not set — use Calibrate once"}
              </div>
              {noteCount > 0 && (
                <div style={{ marginTop: 6, borderTop: `1px solid ${PAL.line}`, paddingTop: 5 }}>
                  <button onClick={() => setNotesOpen((v) => !v)} style={{ display: "flex", width: "100%", alignItems: "center", justifyContent: "space-between", border: "none", background: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}>
                    <span style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: PAL.muted }}>Notes &amp; legend · {noteCount}</span>
                    <span style={{ fontSize: 11, color: PAL.accent }}>{notesOpen ? "hide" : "show"}</span>
                  </button>
                  {notesOpen && notesModel.map((g, gi) => (
                    <div key={gi} style={{ marginTop: 5 }}>
                      <div style={{ fontSize: 10.5, fontWeight: 700, color: PAL.ink, letterSpacing: "0.03em" }}>{g.heading}</div>
                      {g.lines.map((ln, li) => {
                        // A note that didn't appear on every sheet bearing this heading is a per-sheet
                        // variation — tag it with the sheet(s) so a divergent note is obvious, not lost.
                        const varies = g.sheetsWithHeading.length > 1 && ln.sheets.length > 0 && ln.sheets.length < g.sheetsWithHeading.length;
                        return (
                          <div key={li} style={{ fontSize: 10.5, color: PAL.ink, lineHeight: 1.4, padding: "1px 0 1px 6px" }}>
                            {ln.text}
                            {varies && <span style={{ color: "#b45309", fontWeight: 700 }}> · {ln.sheets.join(", ")}</span>}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {(composite.length > 0 || noteCount > 0) && !legendOpen && (
            <button onClick={() => setLegendOpen(true)} style={{ position: "absolute", top: 10, left: 10, zIndex: 4, ...btn(false), fontSize: 11 }}>▣ Key{noteCount > 0 ? ` · ${noteCount} notes` : ""}</button>
          )}
          {/* Auto-stitch result line (B337) — what just happened, dismissable. */}
          {notice && (
            <div style={{ position: "absolute", top: 10, right: 10, zIndex: 4, maxWidth: 320, background: "rgba(25,22,19,0.92)", color: "#fff", padding: "7px 12px", borderRadius: 8, fontSize: 11.5, fontFamily: "system-ui, sans-serif", boxShadow: "0 4px 14px rgba(0,0,0,0.25)", cursor: "pointer" }} onClick={() => setNotice("")} title="Dismiss">{notice}</div>
          )}
          {!placed.length && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "#5a554a", fontFamily: "system-ui, sans-serif", textAlign: "center" }}><div><div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Drop a whole set — it stitches itself</div><div style={{ fontSize: 12.5 }}>Drop a multi-page PDF → it groups the pages into logical sheets → click a grouped plan to add it auto-stitched, cropped, and scaled. Manual add &amp; Align stay as the safety net.</div></div></div>}
        </div>
        {/* B350 — the detail "cloud": click a detail callout → that detail pops up here without
            leaving the current drawing. Pulls the referenced sheet, centers on the named detail if
            it can read where it's defined, and is pan/zoomable inside the box. */}
        {detail && (() => {
          const PW = DBOX.w + 22;
          const left = Math.max(8, Math.min((detail.screen?.x || 200) - PW / 2, (typeof window !== "undefined" ? window.innerWidth : 1200) - PW - 8));
          const top = Math.max(8, Math.min((detail.screen?.y || 200) + 18, (typeof window !== "undefined" ? window.innerHeight : 800) - DBOX.h - 96));
          return (
            <div style={{ position: "fixed", left, top, zIndex: 30, width: PW, background: "#fff", border: `1px solid ${PAL.accent}`, borderRadius: 10, boxShadow: "0 12px 34px rgba(0,0,0,0.34)", fontFamily: "system-ui, sans-serif", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", background: "var(--chrome-bg)", borderBottom: "1px solid var(--chrome-divider)" }}>
                <span style={{ fontSize: 12.5, fontWeight: 700, color: "var(--chrome-text)" }}>☁ {detail.title}</span>
                <div style={{ flex: 1 }} />
                {detail.status === "ready" && <button onClick={detailFit} style={{ ...btn(false), padding: "2px 7px", fontSize: 10.5 }} title="Fit the whole sheet">Fit</button>}
                <button onClick={closeDetail} style={{ border: "none", background: "none", cursor: "pointer", color: "var(--chrome-muted)", fontSize: 16, lineHeight: 1, padding: 0 }} title="Close (Esc)">×</button>
              </div>
              <div style={{ position: "relative", width: DBOX.w + 22, height: DBOX.h, background: "var(--canvas-mat)", overflow: "hidden" }}>
                {detail.status === "loading" && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: PAL.muted, fontSize: 12 }}>Pulling up the detail…</div>}
                {detail.status === "missing" && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", padding: 16, color: PAL.muted, fontSize: 12, lineHeight: 1.5 }}>Sheet {detail.ref.sheetRaw || detail.ref.sheet} isn’t in this set yet.<br />Open or drop it, then click the callout again.</div>}
                {detail.status === "ready" && detail.href && (
                  <div style={{ position: "absolute", inset: 0, cursor: detailDrag.current ? "grabbing" : "grab", touchAction: "none" }}
                    onWheel={detailWheel}
                    onPointerDown={(e) => { detailDrag.current = { sx: e.clientX, sy: e.clientY, tx: detail.view?.tx || 0, ty: detail.view?.ty || 0 }; try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {} }}
                    onPointerMove={(e) => { const dd = detailDrag.current; if (!dd) return; setDetailPopup((d) => (d && d.view ? { ...d, view: { ...d.view, tx: dd.tx + (e.clientX - dd.sx), ty: dd.ty + (e.clientY - dd.sy) } } : d)); }}
                    onPointerUp={(e) => { detailDrag.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} }}
                    onPointerCancel={(e) => { detailDrag.current = null; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch (_) {} /* B579: release capture on interrupt (blur/tab-hide/OS gesture) too — else the popup keeps pointer capture, swallowing all events with a stuck grab cursor until closed/reopened; same class as B551 on the main canvas */ }}>
                    {detail.view && <img src={detail.href} alt={detail.title} draggable={false}
                      style={{ position: "absolute", left: 0, top: 0, width: detail.baseW, height: detail.baseH, transformOrigin: "0 0", transform: `translate(${detail.view.tx}px, ${detail.view.ty}px) scale(${detail.view.scale})`, imageRendering: "auto", userSelect: "none" }} />}
                    {detail.view && detail.anchor && (() => {
                      const cx = detail.view.tx + detail.view.scale * detail.anchor.x, cy = detail.view.ty + detail.view.scale * detail.anchor.y;
                      return <svg width={DBOX.w + 22} height={DBOX.h} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}><circle cx={cx} cy={cy} r={18} fill="none" stroke={PAL.accent} strokeWidth={2.5} /></svg>;
                    })()}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 10, color: PAL.muted, padding: "4px 10px", borderTop: `1px solid ${PAL.line}`, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {detail.status === "ready" ? `${detail.name || ""} · scroll to zoom · drag to pan` : ""}
              </div>
            </div>
          );
        })()}

        {/* right panel: placed sheets + takeoff */}
        <div style={{ flex: "none", width: 220, background: "#fff", borderLeft: `1px solid ${PAL.line}`, overflowY: "auto", padding: 12, fontFamily: "system-ui, sans-serif" }}>
          <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 6 }}>Placed sheets · {placed.length}</div>
          {placed.map((s, i) => {
            const isAligning = align && align.sheetId === s.id;
            const needsAlign = i > 0 && s.aligned === false; // not aligned yet (B301)
            return (
            <div key={s.id} style={{ border: `1px solid ${isAligning ? PAL.accent : needsAlign ? "#d6a64a" : PAL.line}`, borderRadius: 7, padding: "6px 8px", marginBottom: 6, background: needsAlign ? "#fffbeb" : "#fff" }}>
              <div style={{ fontSize: 11, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>{i + 1}. {s.name}</div>
              {needsAlign && <div style={{ fontSize: 10, color: "#b45309", fontWeight: 700, marginBottom: 4 }}>⚠ Not aligned — Align before measuring</div>}
              <div style={{ display: "flex", gap: 6 }}>
                {i > 0 && <button style={{ ...btn(isAligning), padding: "3px 8px", fontSize: 11, ...(needsAlign && !isAligning ? { border: "1px solid #d6a64a", color: "#b45309", fontWeight: 700 } : {}) }} onClick={() => startAlign(s.id)}>Align</button>}
                <button style={{ ...btn(false), padding: "3px 8px", fontSize: 11, color: "#b3361b" }} onClick={() => removeSheet(s.id)}>Remove</button>
              </div>
            </div>
            );
          })}
          {placed.length > 0 && (
            <div style={{ borderTop: `1px solid ${PAL.line}`, marginTop: 6, paddingTop: 8 }}>
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 4 }}>Takeoff (stitched)</div>
              <div style={{ fontSize: 11, color: ftPerUnit ? "#15803d" : "#b45309", marginBottom: 6 }}>{ftPerUnit ? "Calibrated" : "Not calibrated — use Calibrate once"}</div>
              {/* B547: Number.isFinite guard — one degenerate/NaN measure must not propagate "NaN ac · NaN sf · NaN ft" into the rollup. */}
              {[["Area", Number.isFinite(totals.areaSf) ? `${f2(ftToAcres(totals.areaSf))} ac` : "—"], ["", Number.isFinite(totals.areaSf) ? `${f0(totals.areaSf)} sf` : "—"], ["Distance", Number.isFinite(totals.distFt) ? `${f1(totals.distFt)} ft` : "—"], ["Measures", `${measures.length}`]].map(([k, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}><span style={{ color: PAL.muted }}>{k}</span><span style={{ color: PAL.ink, fontWeight: 650, fontFamily: "ui-monospace, monospace" }}>{v}</span></div>
              ))}
              {/* Per-measure list with a × delete (B376): the stitched canvas has no select-and-delete,
                  so this list is the ONLY way to remove a committed measurement here — without it a
                  stray measure (e.g. an uncalibrated "set scale" area) could never be taken off. */}
              {measures.length > 0 && (
                <div style={{ marginTop: 6, borderTop: `1px solid ${PAL.line}`, paddingTop: 6 }}>
                  {measures.map((m) => {
                    const val = m.kind === "area"
                      ? (ftPerUnit ? `${f2(ftToAcres(polyArea(m.pts) * ftPerUnit * ftPerUnit))} ac` : "set scale")
                      : (ftPerUnit ? `${f1(dist(m.pts[0], m.pts[1]) * ftPerUnit)} ft` : "set scale");
                    return (
                      <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 0" }}>
                        <span style={{ flex: "none", color: PAL.muted, textTransform: "capitalize", fontSize: 11.5 }}>{m.kind}</span>
                        <span style={{ flex: 1, minWidth: 0, textAlign: "right", color: PAL.ink, fontWeight: 650, fontFamily: "ui-monospace, monospace", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</span>
                        <button onClick={() => { pushHistory(); setMeasures((arr) => arr.filter((x) => x.id !== m.id)); }} title="Delete this measurement" aria-label="Delete this measurement"
                          style={{ flex: "none", width: 22, height: 22, display: "grid", placeItems: "center", border: "none", background: "transparent", cursor: "pointer", color: "var(--danger-text)", fontSize: 13, fontWeight: 800, lineHeight: 1, borderRadius: 5, fontFamily: "inherit" }}>×</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 8 }}>One calibration applies to the whole stitched plan (shared scale). Measures cross seams in world units.</div>
            </div>
          )}
        </div>
      </div>
      {(busy || err) && <div style={{ flex: "none", padding: "5px 12px", background: PAL.chrome, borderTop: "1px solid var(--chrome-divider)", color: err ? "var(--warn-text)" : PAL.chromeMuted, fontSize: 11, fontFamily: "system-ui, sans-serif" }}>{err || "Rendering…"}</div>}
    </div>
  );
}
