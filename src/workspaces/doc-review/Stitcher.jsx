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
import { loadPdf, renderPageToImage } from "./lib/pdf.js";
import { dist, polyArea, pathLength, centroidOf } from "./lib/takeoff.js";
import { parseFeet } from "./lib/parseLength.js";
import { inv, solveM, sheetBBox, alignBaselinesDegenerate, measureOverUnaligned } from "./lib/stitchGeom.js";
import { ftToAcres } from "../../shared/coordinates/index.js";
import { worldToScreen, screenToWorld, zoomAround } from "../../shared/viewport/viewportTransform.js";
import ReviewsBar from "./components/ReviewsBar.jsx";
import ProjectLibrary from "./components/ProjectLibrary.jsx";
import { useReviewPersistence } from "./lib/usePersistence.js";
import { newReviewId, newSourceId, storeSource, isStoredSource, downloadSource, downloadFromDrive, loadReview, currentUid, readDraft, reconcile, composeTitle } from "./lib/reviewStore.js";

const PAL = { paper: "var(--surface-page)", ink: "var(--text-primary)", muted: "var(--text-secondary)", line: "var(--border-default)", accent: "var(--accent)", chrome: "var(--chrome-bg)", chromeInk: "var(--chrome-text)", chromeMuted: "var(--chrome-muted)", ember: "var(--accent)" };
const uid = () => "s" + Math.random().toString(36).slice(2, 9);
const today = () => new Date().toISOString().slice(0, 10);
const newMeta = () => ({ title: "", projectId: null, project: "", discipline: "", item: "", revision: "", docDate: today() });
const ID = { A: 1, B: 0, e: 0, f: 0 };
// Pure stitch geometry (fwd/inv/solveM/sheetBBox + the B300/B301 alignment guards) lives
// in lib/stitchGeom.js so it can be unit-tested away from the component.

const f0 = (n) => Math.round(n).toLocaleString();
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
  const [libraryOpen, setLibraryOpen] = useState(false);
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
        setPdfs((p) => [...p, { srcId, name: f.name, doc, numPages: doc.numPages, blob: f, size: f.size, storageKey: null, driveKey: null, oversize: false, missing: false }]);
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

  // Fill in a source's bytes after a re-drop, and re-render any sheets placed from it.
  const bindSource = async (srcId, doc, blob) => {
    setPdfs((p) => p.map((x) => (x.srcId === srcId ? { ...x, doc, numPages: doc.numPages, blob, missing: false } : x)));
    for (const s of placedRef.current.filter((s) => s.srcId === srcId)) {
      const img = await renderPageToImage(doc, s.pageNum, 2);
      setPlaced((arr) => arr.map((x) => (x.id === s.id ? { ...x, href: img.href, baseW: img.baseW, baseH: img.baseH, missing: false } : x)));
    }
    if (!pdfsRef.current.some((p) => p.missing && p.srcId !== srcId)) setErr("");
  };

  const addSheet = async (pdf, pageNum) => {
    if (loadingRef.current) return; // a load is rebuilding placed[]; its blind setPlaced would clobber this sheet (B51)
    setBusy(true);
    try {
      const img = await renderPageToImage(pdf.doc, pageNum, 2);
      setPlaced((arr) => {
        let M = { ...ID };
        if (arr.length) { const right = Math.max(...arr.map((s) => sheetBBox(s).maxX)); M = { ...ID, e: right + 40 }; }
        // The first sheet IS the world frame (auto-aligned). Every later sheet drops at
        // identity scale offset to the right and must be Aligned before its measurements
        // can be trusted — track that per sheet so we can flag + warn until it is (B301).
        return [...arr, { id: uid(), srcId: pdf.srcId, pageNum, name: `${pdf.name} · p${pageNum}`, href: img.href, baseW: img.baseW, baseH: img.baseH, M, missing: false, aligned: arr.length === 0 }];
      });
    } finally { setBusy(false); }
  };

  // Screen<->world via the shared viewport engine (B325); { zoom, panX, panY } == { scale, tx, ty }.
  const toWorld = (e) => { const r = svgRef.current.getBoundingClientRect(); return screenToWorld({ scale: view.zoom, tx: view.panX, ty: view.panY }, { x: e.clientX - r.left, y: e.clientY - r.top }); };

  const startAlign = (sheetId) => { setTool("pan"); setDraft(null); setAlign({ sheetId, step: 0 }); setErr(""); };

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
    if (tool === "pan") { drag.current = { sx: e.clientX, sy: e.clientY, panX: view.panX, panY: view.panY }; svgRef.current.setPointerCapture(e.pointerId); return; }
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
    if (drag.current) { setView((v) => ({ ...v, panX: drag.current.panX + (e.clientX - drag.current.sx), panY: drag.current.panY + (e.clientY - drag.current.sy) })); }
  };
  const onUp = (e) => { if (drag.current) { drag.current = null; try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {} } };
  // NEW-1 — recover from a pan whose gesture was interrupted (browser pointercancel, window
  // blur, tab hidden, or a devtools/remote-debugger attaching) rather than ending with a
  // normal pointer-up, so the stitcher canvas can never be left stuck mid-pan with pointer-
  // capture held and a frozen grab cursor that swallows clicks.
  const abortGesture = (pid) => { if (pid != null && svgRef.current) { try { svgRef.current.releasePointerCapture(pid); } catch (_) {} } drag.current = null; };
  useEffect(() => {
    const recover = () => abortGesture();
    const onVis = () => { if (document.hidden) recover(); };
    window.addEventListener("blur", recover);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("blur", recover); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  const onWheel = (e) => { e.preventDefault(); const r = svgRef.current.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; setView((v) => { const nv = zoomAround({ scale: v.zoom, tx: v.panX, ty: v.panY }, e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my, 0.05, 8); return { zoom: nv.scale, panX: nv.tx, panY: nv.ty }; }); };
  // Area points are blocked at click-time (onDown) when over an un-aligned sheet, so a
  // committed area can't include one; just gate on the ≥3-point minimum here. (B302/B313)
  const finishArea = () => { if (draft && draft.kind === "area" && draft.pts.length >= 3) { pushHistory(); setMeasures((m) => [...m, { id: uid(), kind: "area", pts: draft.pts }]); } setDraft(null); };

  // Two points placed → open an INLINE entry box (no window.prompt — owner rule). The
  // world midpoint maps to screen px via the current pan/zoom. (B304)
  const doCalibrate = (pts) => {
    const u = dist(pts[0], pts[1]);
    if (u < 1) { setErr("Line too short — zoom in and retry."); return; }
    setErr("");
    const mid = worldToScreen({ scale: view.zoom, tx: view.panX, ty: view.panY }, { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 });
    setCalInput({ pts, x: mid.x, y: mid.y, value: "" });
  };
  // Validate + apply the composite calibration; reject ratios/junk with a message (B304).
  const commitCalibrate = () => {
    if (!calInput) return;
    const r = parseFeet(calInput.value);
    if (r.empty) { setCalInput(null); setErr(""); return; }
    if (!r.ok) { setErr(r.message); return; }
    const u = dist(calInput.pts[0], calInput.pts[1]);
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
    else if (e.key === "Escape") { setDraft(null); setAlign(null); setCalInput(null); }
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
      placed: placed.map((s) => ({ id: s.id, srcId: s.srcId, pageNum: s.pageNum, name: s.name, baseW: s.baseW, baseH: s.baseH, M: s.M, aligned: s.aligned !== false })),
      view, measures, ftPerUnit,
    },
  }), [reviewId, meta, pdfs, placed, view, measures, ftPerUnit]);
  const isEmpty = useCallback(() => placed.length === 0 && measures.length === 0, [placed, measures]);
  // Pan/zoom (`view`) is captured in the snapshot but left out of the save triggers so
  // panning doesn't spam writes — the next real edit (or the flush) saves the latest view.
  const { status, suspendSave } = useReviewPersistence({
    buildSnapshot, isEmpty,
    deps: [reviewId, meta, pdfs, placed, measures, ftPerUnit],
  });
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastStitchId", reviewId); } catch (_) {} }, [reviewId]);

  const resetStitch = () => {
    setReviewId(newReviewId());
    setMeta(newMeta());
    setPdfs([]); setPlaced([]); setMeasures([]); setFtPerUnit(0);
    setView({ panX: 40, panY: 40, zoom: 0.4 }); setAlign(null); setDraft(null); setTool("pan"); setErr(""); setCalInput(null);
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
        out.push({ id: s.id, srcId: s.srcId, pageNum: s.pageNum, name: s.name, baseW, baseH, M: s.M, href, missing, aligned: idx === 0 ? true : s.aligned !== false });
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
    loadStitch(loadReq).then(() => onConsumeLoad && onConsumeLoad());
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
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // takeoff totals (world units → feet via composite calibration)
  const totals = measures.reduce((t, m) => {
    if (m.kind === "distance") { const u = dist(m.pts[0], m.pts[1]); if (ftPerUnit) t.distFt += u * ftPerUnit; }
    else if (m.kind === "area") { const u = polyArea(m.pts); if (ftPerUnit) t.areaSf += u * ftPerUnit * ftPerUnit; }
    return t;
  }, { distFt: 0, areaSf: 0 });

  const tray = pdfs.flatMap((p) => Array.from({ length: p.numPages }, (_, i) => ({ key: p.srcId + ":" + (i + 1), pdf: p, page: i + 1 })));
  const G = `translate(${view.panX} ${view.panY}) scale(${view.zoom})`;
  const ls = (n) => n / view.zoom; // constant on-screen size inside the zoomed group
  const btn = (on) => ({ padding: "6px 10px", fontSize: 11.5, whiteSpace: "nowrap", borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${on ? PAL.accent : "#ddd6c5"}`, background: on ? PAL.accent : "#fff", color: on ? "#fff" : PAL.ink });
  const iconBtn = (disabled) => ({ ...btn(false), padding: "5px 8px", opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" });
  const alignMsg = align && ["Click reference point #1 (on a placed sheet)", "Click the SAME point on the sheet being aligned", "Click reference point #2", "Click the matching point #2 on the sheet"][align.step];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.paper, position: "relative" }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFiles(e.dataTransfer.files); }}>
      <ProjectLibrary open={libraryOpen} onClose={() => setLibraryOpen(false)} onOpenReview={onOpenReview} signedIn={signedIn} />
      {/* toolbar */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: PAL.chrome, borderBottom: "1px solid #2e2a23", flexWrap: "wrap" }}>
        <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={onReview}>‹ Single sheet</button>
        <span style={{ width: 1, height: 20, background: "#2e2a23" }} />
        <label style={{ ...btn(false), display: "inline-block" }}>
          Open PDFs…<input type="file" accept="application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => { openFiles(e.target.files); e.target.value = ""; }} />
        </label>
        {[["pan", "Pan"], ["distance", "Distance"], ["area", "Area"], ["calibrate", "Calibrate"]].map(([id, lbl]) => (
          <button key={id} style={btn(tool === id && !align)} onClick={() => { setTool(id); setDraft(null); setAlign(null); }}>{lbl}</button>
        ))}
        <div style={{ flex: 1 }} />
        <button style={iconBtn(!canUndo)} disabled={!canUndo} onClick={undo} title="Undo (⌘/Ctrl-Z)">↶</button>
        <button style={iconBtn(!canRedo)} disabled={!canRedo} onClick={redo} title="Redo (⌘/Ctrl-Shift-Z)">↷</button>
        <span style={{ width: 1, height: 20, background: "#2e2a23" }} />
        <button style={btn(false)} onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.2) }))}>−</button>
        <span style={{ color: PAL.chromeMuted, fontSize: 11.5, width: 42, textAlign: "center" }}>{Math.round(view.zoom * 100)}%</span>
        <button style={btn(false)} onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.2) }))}>+</button>
        <span style={{ width: 1, height: 20, background: "#2e2a23" }} />
        <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={() => setLibraryOpen(true)} title="Browse the project library">📁 Library</button>
        <ReviewsBar status={status} signedIn={signedIn} meta={meta} onMeta={onMeta} onOpen={onOpenReview || (() => {})} onNew={resetStitch} />
      </div>

      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>
        {/* tray */}
        <div style={{ flex: "none", width: 150, background: "#fff", borderRight: `1px solid ${PAL.line}`, overflowY: "auto", padding: 8 }}>
          <div style={{ fontSize: 10, color: PAL.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 6 }}>Available sheets</div>
          {tray.length === 0 && <div style={{ fontSize: 11.5, color: PAL.muted, lineHeight: 1.5 }}>Open or drop PDFs to list their sheets here.</div>}
          {tray.map((t) => (
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
                return <g key={s.id} transform={xf}>
                  <image href={s.href} x={0} y={0} width={s.baseW} height={s.baseH} preserveAspectRatio="none"
                    opacity={aligning ? 0.6 : 1} style={{ outline: aligning ? "2px solid #c2410c" : "none" }} />
                  {unaligned && <>
                    <rect x={0} y={0} width={s.baseW} height={s.baseH} fill="#f59e0b14" stroke="#b45309" strokeWidth={ls(2.5)} strokeDasharray={`${ls(12)} ${ls(8)}`} pointerEvents="none" />
                    <text x={s.baseW / 2} y={ls(30)} fontSize={ls(22)} textAnchor="middle" fill="#b45309" fontWeight="700" pointerEvents="none" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(5) }}>⚠ Not aligned — click “Align”</text>
                  </>}
                </g>;
              })}
              {/* measures (world coords) */}
              {measures.map((m) => {
                if (m.kind === "distance") { const a = m.pts[0], b = m.pts[1]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return <g key={m.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e7490" strokeWidth={ls(2)} /><text x={mid.x} y={mid.y - ls(4)} fontSize={ls(12)} fontWeight="700" fill="#0e7490" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(3) }}>{ftPerUnit ? `${f0(dist(a, b) * ftPerUnit)} ft` : "set scale"}</text></g>; }
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
            </g>
          </svg>
          {/* Inline Calibrate entry (B304) — replaces window.prompt; validates the typed length. */}
          {calInput && (
            <div style={{ position: "absolute", left: calInput.x, top: calInput.y, transform: "translate(-50%, -135%)", zIndex: 5, width: 214, background: "#fff", border: `1px solid ${PAL.accent}`, borderRadius: 8, padding: "7px 9px", boxShadow: "0 6px 20px rgba(0,0,0,0.28)", fontFamily: "system-ui, sans-serif" }}>
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
          {!placed.length && <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none", color: "#5a554a", fontFamily: "system-ui, sans-serif", textAlign: "center" }}><div><div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Stitch sheets into one plan</div><div style={{ fontSize: 12.5 }}>Open/drop PDFs → add a sheet → add the next and Align it with two matching points.</div></div></div>}
        </div>

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
                <button style={{ ...btn(false), padding: "3px 8px", fontSize: 11, color: "#b3361b" }} onClick={() => setPlaced((arr) => arr.filter((x) => x.id !== s.id))}>Remove</button>
              </div>
            </div>
            );
          })}
          {placed.length > 0 && (
            <div style={{ borderTop: `1px solid ${PAL.line}`, marginTop: 6, paddingTop: 8 }}>
              <div style={{ fontSize: 10.5, color: PAL.muted, textTransform: "uppercase", letterSpacing: "0.05em", fontWeight: 700, marginBottom: 4 }}>Takeoff (stitched)</div>
              <div style={{ fontSize: 11, color: ftPerUnit ? "#15803d" : "#b45309", marginBottom: 6 }}>{ftPerUnit ? "Calibrated" : "Not calibrated — use Calibrate once"}</div>
              {[["Area", `${f2(ftToAcres(totals.areaSf))} ac`], ["", `${f0(totals.areaSf)} sf`], ["Distance", `${f0(totals.distFt)} ft`], ["Measures", `${measures.length}`]].map(([k, v], i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 12 }}><span style={{ color: PAL.muted }}>{k}</span><span style={{ color: PAL.ink, fontWeight: 650, fontFamily: "ui-monospace, monospace" }}>{v}</span></div>
              ))}
              <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 8 }}>One calibration applies to the whole stitched plan (shared scale). Measures cross seams in world units.</div>
            </div>
          )}
        </div>
      </div>
      {(busy || err) && <div style={{ flex: "none", padding: "5px 12px", background: PAL.chrome, borderTop: "1px solid #2e2a23", color: err ? "#fbbf24" : PAL.chromeMuted, fontSize: 11, fontFamily: "system-ui, sans-serif" }}>{err || "Rendering…"}</div>}
    </div>
  );
}
