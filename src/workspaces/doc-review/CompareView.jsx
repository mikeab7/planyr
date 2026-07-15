/* Revision-compare VIEW (B471 Phase 1). A self-contained full-screen overlay that shows two
 * revisions of the same drawing and paints the color-wash of what changed — removed linework in
 * one colour, added in another, unchanged linework dimmed — plus an auto change-list you click to
 * jump change-to-change.
 *
 * Deliberately isolated from DocReview's review-mode canvas/state: it owns its own pan/zoom and
 * canvas (reusing only the PURE viewport helpers), so it never entangles with the contended
 * review render path. The comparison ITSELF is the already-tested pure engine
 * (shared/files/rasterCompare → rasterRegister + rasterDiff), reached through the browser glue
 * `comparePdfPages` (PDF render + binarize). The wash colours live HERE (the view layer), never in
 * the pure engine — per rasterDiff's presentation-free contract.
 *
 * Scope of Phase 1 (this file): auto-align, color-wash, change-list + click-to-centre, per-side
 * page steppers, honest low-confidence / no-fit states. The interactive 2-point MANUAL align
 * (the engine already supports `manualPairs`) is the next slice — surfaced here as an honest
 * message, not a broken view.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { loadPdf } from "./lib/pdf.js";
import { comparePdfPages } from "./lib/compareRegister.js";
import { DIFF_SAME, DIFF_REMOVED, DIFF_ADDED } from "../../shared/files/rasterDiff.js";
import { fitView, zoomAround } from "../../shared/viewport/viewportTransform.js";

// Diff-wash colours. The wash sits over the drawing's white "paper", so these are fixed,
// high-contrast, colour-blind-distinguishable ink colours (red vs blue vs gray — never the
// red/green confusion pair), theme-independent by design.
const RGB = { removed: [209, 52, 47], added: [29, 78, 216], same: [156, 163, 175] };
const CSS = { removed: "rgb(209,52,47)", added: "rgb(29,78,216)", mixed: "rgb(126,58,180)" };

// Paint the per-pixel `codes` (W×H) into an offscreen canvas: unchanged linework dimmed gray,
// removed red, added blue, background transparent (the container's paper-white shows through).
function paintWash(codes, W, H) {
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i];
    let rgb = null;
    if (c === DIFF_REMOVED) rgb = RGB.removed;
    else if (c === DIFF_ADDED) rgb = RGB.added;
    else if (c === DIFF_SAME) rgb = RGB.same;
    const o = i * 4;
    if (rgb) { d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = c === DIFF_SAME ? 150 : 255; }
    // else leave transparent (background)
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}

const kindLabel = (k) => (k === "added" ? "Added" : k === "removed" ? "Removed" : "Changed");
const kindColor = (k) => (k === "added" ? CSS.added : k === "removed" ? CSS.removed : CSS.mixed);

export default function CompareView({ a, b, onClose }) {
  // a / b = { name, source } — source is a File/Blob/ArrayBuffer/{url} loadPdf accepts. `a` is the
  // OLDER revision (its removed ink is what's gone in the newer), `b` the NEWER.
  const [pdfs, setPdfs] = useState(null);   // { a, b } loaded pdf.js docs
  const [pages, setPages] = useState({ a: 1, b: 1 });
  const [result, setResult] = useState(null); // compareBinaries result + imgA/imgB
  const [status, setStatus] = useState("loading"); // loading | ready | error
  const [errMsg, setErrMsg] = useState("");
  const [view, setView] = useState(null);   // { scale, tx, ty } over the W×H diff grid
  const [activeRegion, setActiveRegion] = useState(-1);

  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const washRef = useRef(null);   // offscreen wash canvas
  const panRef = useRef(null);    // { x, y, tx, ty } during a drag
  const runTok = useRef(0);       // supersede a stale compare (page change / unmount)

  // --- load both PDFs once ---
  useEffect(() => {
    let alive = true;
    setStatus("loading"); setErrMsg("");
    Promise.all([loadPdf(a.source), loadPdf(b.source)])
      .then(([pa, pb]) => { if (alive) setPdfs({ a: pa, b: pb }); })
      .catch((e) => { if (alive) { setStatus("error"); setErrMsg((e && e.message) || "Couldn't open one of the PDFs."); } });
    return () => { alive = false; };
  }, [a.source, b.source]);

  const numA = pdfs?.a?.numPages || 1;
  const numB = pdfs?.b?.numPages || 1;

  // --- run the compare whenever the loaded docs or the chosen pages change ---
  useEffect(() => {
    if (!pdfs) return;
    const tok = ++runTok.current;
    setStatus("loading"); setActiveRegion(-1);
    comparePdfPages(pdfs.a, pages.a, pdfs.b, pages.b, { scale: 1.5, tol: 1, minArea: 24 })
      .then((r) => {
        if (tok !== runTok.current) return; // superseded
        if (!r || r.error || !r.transform) { setStatus("error"); setErrMsg("Couldn't line up these two revisions automatically — they may be different sheets, or too different to auto-align. (Manual alignment is coming next.)"); return; }
        washRef.current = paintWash(r.codes, r.W, r.H);
        setResult(r); setStatus("ready");
      })
      .catch((e) => { if (tok === runTok.current) { setStatus("error"); setErrMsg((e && e.message) || "The comparison failed."); } });
  }, [pdfs, pages.a, pages.b]);

  // --- fit the diff grid to the container on first ready + on resize ---
  const fit = useCallback(() => {
    const wrap = wrapRef.current, r = result;
    if (!wrap || !r) return;
    setView(fitView(r.W, r.H, wrap.clientWidth, wrap.clientHeight, { pad: 20, mode: "page" }));
  }, [result]);
  useLayoutEffect(() => { if (status === "ready") fit(); }, [status, fit]);
  useEffect(() => {
    const wrap = wrapRef.current; if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => { if (canvasRef.current) draw(); });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, view]);

  // --- draw the wash + active-region highlight at the current view ---
  const draw = useCallback(() => {
    const cv = canvasRef.current, wrap = wrapRef.current, wash = washRef.current, v = view, r = result;
    if (!cv || !wrap || !wash || !v || !r) return;
    const dpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
    const cw = wrap.clientWidth, ch = wrap.clientHeight;
    if (cv.width !== Math.round(cw * dpr) || cv.height !== Math.round(ch * dpr)) { cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr); }
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    // paper
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(v.tx, v.ty, r.W * v.scale, r.H * v.scale);
    // wash (crisp pixels)
    ctx.imageSmoothingEnabled = v.scale < 1;
    ctx.drawImage(wash, 0, 0, r.W, r.H, v.tx, v.ty, r.W * v.scale, r.H * v.scale);
    // active-region highlight box
    if (activeRegion >= 0 && r.regions[activeRegion]) {
      const bb = r.regions[activeRegion].bbox;
      ctx.strokeStyle = kindColor(r.regions[activeRegion].kind);
      ctx.lineWidth = 2;
      const pad = 6;
      ctx.strokeRect(v.tx + bb.x * v.scale - pad, v.ty + bb.y * v.scale - pad, bb.w * v.scale + pad * 2, bb.h * v.scale + pad * 2);
    }
  }, [view, result, activeRegion]);
  useEffect(() => { draw(); }, [draw]);

  // --- pan / zoom ---
  const onWheel = useCallback((e) => {
    e.preventDefault();
    setView((v) => {
      if (!v) return v;
      const rect = wrapRef.current.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      return zoomAround(v, factor, e.clientX - rect.left, e.clientY - rect.top);
    });
  }, []);
  const onDown = useCallback((e) => {
    if (e.button !== 0) return;
    const v = view; if (!v) return;
    panRef.current = { x: e.clientX, y: e.clientY, tx: v.tx, ty: v.ty };
  }, [view]);
  const onMove = useCallback((e) => {
    const p = panRef.current; if (!p) return;
    setView((v) => (v ? { ...v, tx: p.tx + (e.clientX - p.x), ty: p.ty + (e.clientY - p.y) } : v));
  }, []);
  const endPan = useCallback(() => { panRef.current = null; }, []);

  // --- click a change in the list → centre the view on it ---
  const jumpTo = useCallback((idx) => {
    setActiveRegion(idx);
    const wrap = wrapRef.current, r = result; if (!wrap || !r || !r.regions[idx]) return;
    const reg = r.regions[idx];
    setView((v) => {
      const scale = Math.max(v ? v.scale : 1, 1); // don't zoom out further to jump
      return { scale, tx: wrap.clientWidth / 2 - reg.centroid.x * scale, ty: wrap.clientHeight / 2 - reg.centroid.y * scale };
    });
  }, [result]);

  const counts = result?.counts || { added: 0, removed: 0, mixed: 0, total: 0 };
  const lowConfidence = status === "ready" && result?.transform?.confidence === "low";
  const pageStepper = (side, num) => (
    num > 1 ? (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        <button data-cmp={`page-${side}-prev`} disabled={pages[side] <= 1} onClick={() => setPages((p) => ({ ...p, [side]: Math.max(1, p[side] - 1) }))} style={stepBtn}>‹</button>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>p{pages[side]}/{num}</span>
        <button data-cmp={`page-${side}-next`} disabled={pages[side] >= num} onClick={() => setPages((p) => ({ ...p, [side]: Math.min(num, p[side] + 1) }))} style={stepBtn}>›</button>
      </span>
    ) : null
  );

  return (
    <div data-cmp="compare-view" data-status={status} data-active-region={activeRegion} data-change-count={counts.total} style={overlay}>
      {/* header */}
      <div style={header}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <strong style={{ fontSize: 13 }}>Compare revisions</strong>
          <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ color: CSS.removed }}>◀ {a.name || "Older"}</span> {pageStepper("a", numA)}
            <span style={{ margin: "0 6px", color: "var(--muted)" }}>vs</span>
            <span style={{ color: CSS.added }}>{b.name || "Newer"} ▶</span> {pageStepper("b", numB)}
          </span>
        </div>
        <button data-cmp="close" onClick={onClose} style={closeBtn}>Close ✕</button>
      </div>

      {/* legend + counts */}
      <div style={legend}>
        <span data-cmp="count-removed"><Dot c={CSS.removed} /> Removed {counts.removed}</span>
        <span data-cmp="count-added"><Dot c={CSS.added} /> Added {counts.added}</span>
        {counts.mixed ? <span data-cmp="count-mixed"><Dot c={CSS.mixed} /> Changed {counts.mixed}</span> : null}
        <span style={{ color: "var(--muted)" }}><Dot c="rgb(156,163,175)" /> Unchanged (dimmed)</span>
      </div>

      {lowConfidence ? (
        <div data-cmp="low-confidence" style={warnBar}>⚠ Auto-alignment wasn't confident — the highlighted changes may include alignment noise. Manual 2-point alignment is coming next.</div>
      ) : null}

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        {/* canvas */}
        <div ref={wrapRef} style={canvasWrap}
          onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={endPan} onPointerLeave={endPan}>
          <canvas ref={canvasRef} style={{ display: "block", cursor: panRef.current ? "grabbing" : "grab" }} />
          {status === "loading" ? <div style={busyOv} data-cmp="busy">Comparing revisions…</div> : null}
          {status === "error" ? <div style={errOv} data-cmp="error">{errMsg}</div> : null}
        </div>

        {/* change-list */}
        <div style={listPane} data-cmp="change-list">
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border-default)", fontSize: 12, fontWeight: 600 }}>
            {counts.total} change{counts.total === 1 ? "" : "s"}
          </div>
          <div style={{ overflow: "auto", flex: 1 }}>
            {status === "ready" && counts.total === 0 ? (
              <div style={{ padding: 12, fontSize: 12, color: "var(--muted)" }} data-cmp="no-changes">No differences found between these two revisions.</div>
            ) : null}
            {(result?.regions || []).map((reg, i) => (
              <button key={i} data-cmp="change-item" onClick={() => jumpTo(i)}
                style={{ ...listItem, background: i === activeRegion ? "var(--surface-raised)" : "transparent" }}>
                <Dot c={kindColor(reg.kind)} />
                <span style={{ flex: 1, textAlign: "left" }}>{kindLabel(reg.kind)}</span>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{Math.round(reg.area)} px²</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Dot({ c }) {
  return <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: c, marginRight: 6, verticalAlign: "middle" }} />;
}

// --- inline styles (token-driven; the overlay chromes with the app theme) ---
const overlay = { position: "absolute", inset: 0, zIndex: 50, display: "flex", flexDirection: "column", background: "var(--surface-page)", color: "var(--ink)" };
const header = { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 12px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-raised)" };
const legend = { display: "flex", gap: 16, alignItems: "center", padding: "6px 12px", fontSize: 12, borderBottom: "1px solid var(--border-default)", flexWrap: "wrap" };
const warnBar = { padding: "6px 12px", fontSize: 12, color: "var(--warn-text)", background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)" };
const canvasWrap = { position: "relative", flex: 1, minWidth: 0, overflow: "hidden", background: "var(--surface-page)", touchAction: "none" };
const listPane = { width: 240, borderLeft: "1px solid var(--border-default)", display: "flex", flexDirection: "column", background: "var(--surface-raised)" };
const listItem = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 10px", border: "none", borderBottom: "1px solid var(--border-default)", cursor: "pointer", font: "inherit", fontSize: 12, color: "var(--ink)" };
const closeBtn = { border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--ink)", borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 12 };
const stepBtn = { border: "1px solid var(--border-default)", background: "var(--surface-raised)", color: "var(--ink)", borderRadius: 4, width: 20, height: 20, cursor: "pointer", lineHeight: 1, padding: 0 };
const busyOv = { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--hover-ghost)", fontSize: 13, color: "var(--muted)" };
const errOv = { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: 13, color: "var(--warn-text)" };
