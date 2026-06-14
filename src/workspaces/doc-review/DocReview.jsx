/* Document Review — PDF review core (browser-only). PDF.js viewer + multi-sheet
 * nav, calibrate-to-scale, measure tools (distance / area / perimeter / count),
 * redline (rectangle / cloud / text), and a takeoff rollup. The PDF is an
 * IMMUTABLE backdrop; all markups live on an SVG overlay (an editable layer over
 * it) and are stored in PAGE UNITS so they survive zoom. Lazy-loaded by the shell.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadPdf, renderPageToCanvas } from "./lib/pdf.js";
import { measureLabel, rollup, dist } from "./lib/takeoff.js";
import Stitcher from "./Stitcher.jsx";
import ReviewsBar from "./components/ReviewsBar.jsx";
import { useReviewPersistence } from "./lib/usePersistence.js";
import { newReviewId, newSourceId, uploadSource, downloadSource, loadReview, currentUid, readDraft, reconcile, cloudReady } from "./lib/reviewStore.js";
import { onAuthChange } from "../site-planner/lib/auth.js";

const PAL = { paper: "#efeadf", ink: "#2c2a26", muted: "#8a8473", line: "#e7e2d6", accent: "#c2410c", chrome: "#191613", chromeInk: "#ece7db", chromeMuted: "#9b9482", ember: "#e8590c" };
const uid = () => "m" + Math.random().toString(36).slice(2, 9);

const TOOLS = [
  { id: "select", label: "Select", hint: "Click a markup to select; Delete removes it." },
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

export default function DocReview() {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const fileRef = useRef(null);
  const renderTok = useRef(0);

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
  const [draft, setDraft] = useState(null);         // in-progress { kind, pts:[...] }
  const [cursor, setCursor] = useState(null);       // page-unit cursor for live preview
  const [sel, setSel] = useState(null);             // selected markup id

  // --- cloud persistence (single-sheet review) ---
  const [reviewId, setReviewId] = useState(() => newReviewId());
  const [title, setTitle] = useState("");
  const [project, setProject] = useState("");
  const [discipline, setDiscipline] = useState("");
  const [source, setSource] = useState(null);     // { srcId, name, size, storageKey, oversize }
  const [redrop, setRedrop] = useState("");        // "re-drop on load" banner when bytes aren't available
  const [signedIn, setSignedIn] = useState(false);
  const [pendingStitch, setPendingStitch] = useState(null); // a stitch review handed to <Stitcher> to load
  const sourceRef = useRef(null);                  // { srcId, name } for re-drop matching after load

  const ftPerUnit = calByPage[page] || 0;
  const pageMarks = markups.filter((m) => m.page === page);

  /* ---- load ---- */
  const sameName = (a, b) => (a || "").toLowerCase() === (b || "").toLowerCase();
  const openFile = async (file) => {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const pdf = await loadPdf(file);
      pdfRef.current = pdf;
      setFileName(file.name || "document.pdf");
      setNumPages(pdf.numPages);
      setPage(1);
      setScale(0); // 0 = fit-to-width on next render
      setRedrop("");
      // Source bookkeeping: reuse the srcId when this is a re-drop of the review's
      // known file (so its markups stay bound); otherwise mint one and upload once.
      const keepId = sourceRef.current && sameName(sourceRef.current.name, file.name) ? sourceRef.current.srcId : null;
      const srcId = keepId || newSourceId();
      const base = { srcId, name: file.name || "document.pdf", size: file.size };
      sourceRef.current = base;
      setSource({ ...base, storageKey: null, oversize: false });
      uploadSource(reviewId, srcId, file).then((r) => {
        setSource((s) => (s && s.srcId === srcId ? { ...s, storageKey: r.storageKey || null, oversize: !!r.oversize } : s));
      });
    } catch (e) {
      setErr("Couldn't open that PDF. Make sure it's a valid PDF file.");
    } finally { setBusy(false); }
  };

  /* ---- render current page ---- */
  const render = useCallback(async () => {
    const pdf = pdfRef.current, canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    const tok = ++renderTok.current;
    let s = scale;
    if (!s) { // fit to container width
      const p = await pdf.getPage(page);
      const base = p.getViewport({ scale: 1 });
      const avail = (wrapRef.current?.clientWidth || 900) - 24;
      s = Math.max(0.2, Math.min(4, avail / base.width));
      if (tok !== renderTok.current) return;
      setScale(s);
    }
    const d = await renderPageToCanvas(pdf, page, canvas, s);
    if (tok !== renderTok.current) return; // a newer render superseded this
    setDims(d);
  }, [page, scale]);

  useEffect(() => { render(); }, [render, numPages]);

  /* ---- cloud persistence: badge, autosave, resume, load, new ---- */
  useEffect(() => {
    let live = true;
    const r = () => cloudReady().then((v) => live && setSignedIn(v));
    r();
    const off = onAuthChange(r);
    return () => { live = false; off && off(); };
  }, []);
  const onMeta = (k, v) => { if (k === "title") setTitle(v); else if (k === "project") setProject(v); else if (k === "discipline") setDiscipline(v); };

  const buildSnapshot = useCallback(() => ({
    id: reviewId, kind: "single", title, project, discipline,
    sources: source ? [{ srcId: source.srcId, name: source.name, size: source.size || 0, storageKey: source.storageKey || null, oversize: !!source.oversize }] : [],
    single: { srcId: source?.srcId || null, fileName, numPages, page, markups, calByPage },
  }), [reviewId, title, project, discipline, source, fileName, numPages, page, markups, calByPage]);
  const isEmpty = useCallback(() => !source && markups.length === 0, [source, markups]);
  // `page`/`scale`/`numPages` ride along in the snapshot but aren't save triggers, so
  // flipping through sheets doesn't spam writes — the next real edit (or flush) saves them.
  const { status } = useReviewPersistence({
    buildSnapshot, isEmpty, enabled: mode === "review",
    deps: [reviewId, title, project, discipline, source, markups, calByPage],
  });

  // Remember the active review so a refresh resumes it (cloud reconciled with the
  // synchronous local mirror, so an edit made just before reload isn't lost).
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastSingleId", reviewId); } catch (_) {} }, [reviewId]);
  useEffect(() => { try { localStorage.setItem("planyr:docreview:lastMode", mode); } catch (_) {} }, [mode]);

  const fetchSourceBytes = async (src) => {
    if (!src) return;
    if (src.oversize) { setRedrop(`“${src.name}” was too large to store in the cloud — re-open it to view (your markups are saved).`); return; }
    const buf = src.storageKey ? await downloadSource(src.storageKey) : null;
    if (!buf) { setRedrop(`Couldn't fetch “${src.name}” — re-open it to view (your markups are saved).`); return; }
    const pdf = await loadPdf(buf);
    pdfRef.current = pdf;
    setNumPages(pdf.numPages); setScale(0);
  };
  const loadSingleReview = async (rec) => {
    const s = rec.single || {};
    const src = (rec.sources || [])[0] || null;
    pdfRef.current = null;
    sourceRef.current = src ? { srcId: src.srcId, name: src.name } : null;
    setReviewId(rec.id);
    setTitle(rec.title || ""); setProject(rec.project || ""); setDiscipline(rec.discipline || "");
    setSource(src ? { srcId: src.srcId, name: src.name, size: src.size || 0, storageKey: src.storageKey || null, oversize: !!src.oversize } : null);
    setMarkups(s.markups || []); setCalByPage(s.calByPage || {});
    setFileName(s.fileName || ""); setNumPages(s.numPages || 0); setPage(s.page || 1);
    setDraft(null); setSel(null); setTool("select"); setRedrop("");
    await fetchSourceBytes(src);
  };
  const resetSingle = () => {
    pdfRef.current = null; sourceRef.current = null;
    setReviewId(newReviewId());
    setTitle(""); setProject(""); setDiscipline("");
    setSource(null); setRedrop("");
    setFileName(""); setNumPages(0); setPage(1); setScale(0);
    setMarkups([]); setCalByPage({}); setDraft(null); setSel(null); setTool("select");
  };
  // Open a saved review from either toolbar; route single vs. stitch by kind.
  const openReview = async (row) => {
    const rec = await loadReview(row.id);
    if (!rec) return;
    if (rec.kind === "stitch") { setPendingStitch(rec); setMode("stitch"); }
    else { setMode("review"); await loadSingleReview(rec); }
  };
  // Resume the last review (and its mode) on mount, once. Stitch reviews are handed
  // to <Stitcher> via pendingStitch; single reviews load here.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return; booted.current = true;
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

  const onDown = (e) => {
    if (!dims) return;
    const p = toPage(e);
    if (tool === "select") {
      setSel(hitTest(p));
      return;
    }
    if (tool === "text") {
      const t = window.prompt("Text note:");
      if (t) commit({ kind: "text", pts: [p], text: t });
      return;
    }
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

  const finishDraft = () => {
    if (!draft) return;
    const { kind, pts } = draft;
    if (kind === "count" && pts.length >= 1) commit({ kind, pts });
    else if ((kind === "area" || kind === "perimeter") && pts.length >= 2) commit({ kind, pts });
    else setDraft(null);
  };
  const onDbl = () => finishDraft();

  const finishCalibrate = (pts) => {
    const u = dist(pts[0], pts[1]);
    if (u < 1) { setErr("Calibration line too short — zoom in and try again."); return; }
    const v = window.prompt("Real-world length of that line (in feet):");
    const ft = parseFloat(v);
    if (!isFinite(ft) || ft <= 0) return;
    setCalByPage((c) => ({ ...c, [page]: ft / u }));
    setErr("");
  };

  const hitTest = (p) => {
    const tol = 10 / scale;
    let best = null, bd = Infinity;
    for (const m of pageMarks) {
      const pts = m.pts || [];
      for (const q of pts) { const dd = dist(p, q); if (dd < bd) { bd = dd; best = m.id; } }
    }
    return bd <= tol ? best : null;
  };

  // keyboard: Enter finishes a poly/count draft; Esc cancels; Delete removes selection
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (e.key === "Enter") { e.preventDefault(); finishDraft(); }
      else if (e.key === "Escape") { setDraft(null); setSel(null); }
      else if ((e.key === "Delete" || e.key === "Backspace") && sel) { e.preventDefault(); setMarkups((a) => a.filter((m) => m.id !== sel)); setSel(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line

  const zoom = (f) => setScale((s) => Math.max(0.2, Math.min(6, (s || 1) * f)));
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
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.paper }}>
      {/* toolbar */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px", background: PAL.chrome, borderBottom: `1px solid #2e2a23`, flexWrap: "wrap" }}>
        <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={() => fileRef.current?.click()}>{fileName ? "Open another…" : "Open PDF…"}</button>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" style={{ display: "none" }} onChange={(e) => { openFile(e.target.files?.[0]); e.target.value = ""; }} />
        <button style={{ ...btn(false), border: "1px solid #2e2a23", background: "rgba(255,255,255,0.06)", color: PAL.chromeInk }} onClick={() => setMode("stitch")} title="Stitch multiple sheets into one continuous plan">Stitch sheets ▸</button>
        {fileName && <span style={{ color: PAL.chromeMuted, fontSize: 11.5, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fileName}</span>}
        <span style={{ width: 1, height: 20, background: "#2e2a23" }} />
        {pdfRef.current && TOOLS.map((t) => <button key={t.id} style={{ ...btn(tool === t.id), fontSize: 11.5 }} onClick={() => { setTool(t.id); setDraft(null); }}>{t.label}</button>)}
        {pdfRef.current && <>
          <button style={{ ...btn(false) }} onClick={() => zoom(1 / 1.2)}>−</button>
          <span style={{ color: PAL.chromeMuted, fontSize: 11.5, width: 42, textAlign: "center" }}>{Math.round(scale * 100)}%</span>
          <button style={{ ...btn(false) }} onClick={() => zoom(1.2)}>+</button>
          <button style={{ ...btn(false) }} onClick={() => setScale(0)} title="Fit width">Fit</button>
        </>}
        <div style={{ flex: 1 }} />
        <ReviewsBar status={status} signedIn={signedIn} title={title} project={project} discipline={discipline} onMeta={onMeta} onOpen={openReview} onNew={resetSingle} />
      </div>

      {redrop && (
        <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 10, padding: "6px 12px", background: "#fef3c7", color: "#92400e", fontSize: 12, fontFamily: "system-ui, sans-serif" }}>
          <span>⚠ {redrop}</span>
          <button onClick={() => fileRef.current?.click()} style={{ marginLeft: "auto", padding: "4px 9px", fontSize: 11.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", borderRadius: 6, border: "1px solid #d6a64a", background: "#fff", color: "#92400e" }}>Re-open file…</button>
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
              <button key={n} onClick={() => { setPage(n); setScale(0); setDraft(null); setSel(null); }}
                style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 9px", marginBottom: 3, borderRadius: 6, cursor: "pointer", fontFamily: "inherit", fontSize: 12, fontWeight: 600,
                  border: `1px solid ${n === page ? PAL.accent : PAL.line}`, background: n === page ? "#fbf3ee" : "#fff", color: PAL.ink }}>
                Sheet {n}{calByPage[n] ? " ·✓" : ""}
              </button>
            ))}
          </div>

          {/* canvas + overlay */}
          <div ref={wrapRef} style={{ flex: 1, minWidth: 0, overflow: "auto", background: "#cfc8ba", display: "grid", placeItems: "center", padding: 12 }}>
            <div style={{ position: "relative", width: dims?.w, height: dims?.h, boxShadow: "0 4px 18px rgba(0,0,0,0.25)" }}>
              <canvas ref={canvasRef} style={{ display: "block" }} />
              {dims && (
                <svg width={dims.w} height={dims.h} style={{ position: "absolute", inset: 0, cursor: tool === "select" ? "default" : "crosshair" }}
                  onPointerDown={onDown} onDoubleClick={onDbl} onPointerMove={(e) => setCursor(toPage(e))} onPointerLeave={() => setCursor(null)}>
                  {pageMarks.map((m) => draw(m, m.id === sel))}
                  {drawDraft()}
                </svg>
              )}
            </div>
          </div>

          {/* takeoff */}
          <div style={{ flex: "none", width: 246, background: "#fff", borderLeft: `1px solid ${PAL.line}`, overflowY: "auto", padding: 12, fontFamily: "system-ui, sans-serif" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: PAL.ink, marginBottom: 2 }}>Takeoff</div>
            <div style={{ fontSize: 11, color: ftPerUnit ? "#15803d" : "#b45309", marginBottom: 8 }}>
              {ftPerUnit ? `Sheet ${page} calibrated` : `Sheet ${page} not calibrated — use Calibrate`}
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
              <div style={{ fontSize: 10, color: PAL.muted, lineHeight: 1.45, marginTop: 8 }}>Areas/counts use the shared coordinate module — the seam to feed the Site Planner's yield panel (pending the shared coordinate spine).</div>
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
