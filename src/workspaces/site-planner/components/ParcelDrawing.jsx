/* ParcelDrawing — B67: open a PDF/JPEG attached to a parcel as an IMMUTABLE backdrop
 * and mark it up on an editable layer above it. Markups are stored in PIXEL-RELATIVE
 * (0..1) coordinates over the backdrop's intrinsic dimensions, so zoom/pan can never
 * corrupt geometry and the backdrop's true pixels stay the source of truth (forward-
 * compatible with a later pixel→EPSG:2278 georeference). The backdrop raster is never
 * written back — "editing" here means building your own analysis layer over it.
 *
 * Tools: Select (move/recolour/delete existing markups), Pen, Line, Box, Text, plus a
 * Measure tool calibrated by a one-time Scale line (draw a line of known length → real
 * lengths in feet). The calibration is itself a markup (type 'calib'), so it persists
 * through the same onSave(markups) channel — no extra plumbing.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PAL = { ink: "#26231e", muted: "#6b6557", line: "#ddd6c5", paper: "#f6f3ec", accent: "#e8590c" };
const COLORS = ["#dc2626", "#ea580c", "#2563eb", "#16a34a", "#7c3aed", "#111827"];
const uid = () => "k" + Math.random().toString(36).slice(2, 9);
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const fmtFt = (f) => (f >= 1000 ? `${(f / 1000).toFixed(2)}k ft` : `${f.toFixed(f < 10 ? 1 : 0)} ft`);

export default function ParcelDrawing({ drawing, onSave, onClose, loading = false }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [tool, setTool] = useState("select");      // select | pen | line | rect | text | measure | calib
  const [color, setColor] = useState(COLORS[0]);
  const [marks, setMarks] = useState(() => drawing.markups || []);
  const [sel, setSel] = useState(null);            // selected markup id
  const [draft, setDraft] = useState(null);        // in-progress markup
  const [moving, setMoving] = useState(null);      // { id, pts } live drag of an existing markup
  const [view, setView] = useState({ scale: 1, ox: 0, oy: 0 }); // backdrop placement (screen px)
  const [textEdit, setTextEdit] = useState(null);  // { id } while editing a text markup
  const drag = useRef(null);
  const firstSave = useRef(true);
  const iw = drawing.intrinsic?.w || 1000, ih = drawing.intrinsic?.h || 1000;

  // Persist whenever the markup set settles. Skip the mount fire so opening doesn't re-save.
  useEffect(() => { if (firstSave.current) { firstSave.current = false; return; } onSave?.(marks); }, [marks]); // eslint-disable-line react-hooks/exhaustive-deps

  const fit = () => {
    const el = wrapRef.current; if (!el) return;
    const s = Math.min(el.clientWidth / iw, el.clientHeight / ih) * 0.92;
    setView({ scale: s, ox: (el.clientWidth - iw * s) / 2, oy: (el.clientHeight - ih * s) / 2 });
  };
  useEffect(() => { fit(); const on = () => fit(); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const Wd = iw * view.scale, Hd = ih * view.scale;
  const toNorm = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: clamp01((cx - r.left) / r.width), y: clamp01((cy - r.top) / r.height) };
  };
  // Real-world length of a 0..1 segment, via the calibration markup (null if uncalibrated).
  const calib = marks.find((m) => m.type === "calib");
  const lenFt = (a, b) => (calib ? Math.hypot((b.x - a.x) * iw, (b.y - a.y) * ih) * calib.ftPerPx : null);

  const addMark = (m) => setMarks((cur) => [...cur, m]);
  const delSel = () => { if (sel) { setMarks((cur) => cur.filter((m) => m.id !== sel)); setSel(null); } };

  // Finish a freshly-drawn Scale line: ask its real length, store/replace the calibration.
  const calibrateFrom = (line) => {
    const [a, b] = line.pts;
    const px = Math.hypot((b.x - a.x) * iw, (b.y - a.y) * ih);
    if (px < 1) return;
    const ans = window.prompt("Length of this line in feet (sets the drawing scale):", "100");
    const feet = parseFloat(ans);
    if (!feet || feet <= 0) return;
    setMarks((cur) => [...cur.filter((m) => m.type !== "calib"), { id: uid(), type: "calib", pts: [a, b], feet, ftPerPx: feet / px, color }]);
  };

  const onWheel = (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const r = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => { const ns = Math.max(0.05, Math.min(12, v.scale * f)); const k = ns / v.scale; return { scale: ns, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k }; });
  };

  // Press on a markup (Select tool) → select + begin moving it.
  const startMove = (e, m) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSel(m.id);
    wrapRef.current?.setPointerCapture?.(e.pointerId);
    drag.current = { mode: "move", id: m.id, start: toNorm(e.clientX, e.clientY), orig: m.pts };
  };
  const onDown = (e) => {
    if (e.button !== 0) return;
    const n = toNorm(e.clientX, e.clientY);
    wrapRef.current?.setPointerCapture?.(e.pointerId);
    if (tool === "select") { drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy }; setSel(null); return; }
    if (tool === "text") { const m = { id: uid(), type: "text", pts: [n], color, text: "" }; addMark(m); setTextEdit({ id: m.id }); setTool("select"); return; }
    drag.current = { mode: "draw", type: tool };
    setDraft({ id: uid(), type: tool, color, pts: [n] });
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    if (d.mode === "pan") { setView((v) => ({ ...v, ox: d.ox + (e.clientX - d.sx), oy: d.oy + (e.clientY - d.sy) })); return; }
    const n = toNorm(e.clientX, e.clientY);
    if (d.mode === "move") { const dx = n.x - d.start.x, dy = n.y - d.start.y; const pts = d.orig.map((p) => ({ x: clamp01(p.x + dx), y: clamp01(p.y + dy) })); d.live = pts; setMoving({ id: d.id, pts }); return; }
    setDraft((dr) => { if (!dr) return dr; if (dr.type === "pen") return { ...dr, pts: [...dr.pts, n] }; return { ...dr, pts: [dr.pts[0], n] }; });
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (d?.mode === "move") { if (d.live) setMarks((cur) => cur.map((m) => (m.id === d.id ? { ...m, pts: d.live } : m))); setMoving(null); return; }
    if (d?.mode === "draw" && draft) {
      const ok = draft.type === "pen" ? draft.pts.length > 1 : (draft.pts.length === 2 && (Math.abs(draft.pts[0].x - draft.pts[1].x) > 0.002 || Math.abs(draft.pts[0].y - draft.pts[1].y) > 0.002));
      if (ok) { if (draft.type === "calib") calibrateFrom(draft); else addMark(draft); }
    }
    setDraft(null);
  };

  // Render one markup as SVG (coords 0..1; viewBox 0 0 1 1). `moving` overrides its points live.
  const renderMark = (m, isSel) => {
    const pts = moving && moving.id === m.id ? moving.pts : m.pts;
    const common = { stroke: m.color, strokeWidth: isSel ? 3.25 : 2, fill: "none", vectorEffect: "non-scaling-stroke", strokeLinecap: "round", strokeLinejoin: "round", style: { cursor: tool === "select" ? "move" : "crosshair" }, onPointerDown: (e) => startMove(e, m) };
    if (m.type === "pen" || m.type === "line" || m.type === "measure" || m.type === "calib") {
      const d = pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
      return <path key={m.id} d={d} {...common} strokeDasharray={m.type === "calib" ? "0.012 0.008" : undefined} />;
    }
    if (m.type === "rect") {
      const [a, b] = pts; if (!b) return null;
      return <rect key={m.id} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...common} />;
    }
    return null; // text + measure/calib labels are positioned divs below
  };

  const allMarks = draft ? [...marks, draft] : marks;
  const texts = allMarks.filter((m) => m.type === "text");
  const dimensioned = allMarks.filter((m) => m.type === "measure" || m.type === "calib");
  const ptsOf = (m) => (moving && moving.id === m.id ? moving.pts : m.pts);

  const tBtn = (id, label, hint) => (
    <button onClick={() => setTool(id)} title={hint || label}
      style={{ padding: "6px 10px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${tool === id ? PAL.accent : PAL.line}`, background: tool === id ? PAL.accent : "#fff", color: tool === id ? "#fff" : PAL.ink }}>{label}</button>
  );

  return createPortal((
    <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(20,18,15,0.55)", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#fff", borderBottom: `1px solid ${PAL.line}` }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: PAL.ink, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drawing.name || "Drawing"}</span>
        <span style={{ width: 1, height: 20, background: PAL.line, margin: "0 2px" }} />
        {tBtn("select", "Select", "Select, drag to move, recolour or delete a markup")}{tBtn("pen", "Pen")}{tBtn("line", "Line")}{tBtn("rect", "Box")}{tBtn("text", "Text")}
        <span style={{ width: 1, height: 20, background: PAL.line, margin: "0 2px" }} />
        {tBtn("measure", "Measure", calib ? `Measure lengths (scale set: ${fmtFt(calib.feet)} ref)` : "Measure lengths — set the scale first")}
        {tBtn("calib", calib ? "Scale ✓" : "Scale", "Set the drawing scale: draw a line of known length, then enter its feet")}
        <span style={{ display: "flex", gap: 3, marginLeft: 4 }}>
          {COLORS.map((c) => <button key={c} onClick={() => { setColor(c); if (sel) setMarks((cur) => cur.map((m) => (m.id === sel ? { ...m, color: c } : m))); }} title={c}
            style={{ width: 18, height: 18, borderRadius: 99, cursor: "pointer", background: c, border: color === c ? `2px solid ${PAL.ink}` : "2px solid #fff", boxShadow: "0 0 0 1px " + PAL.line }} />)}
        </span>
        <button onClick={delSel} disabled={!sel} title="Delete selected markup"
          style={{ padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: sel ? "pointer" : "not-allowed", fontFamily: "inherit", border: `1px solid ${PAL.line}`, background: "#fff", color: sel ? "#b91c1c" : PAL.muted, opacity: sel ? 1 : 0.6 }}>Delete</button>
        <span style={{ flex: 1 }} />
        <button onClick={fit} title="Fit the drawing to the view" style={{ padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${PAL.line}`, background: "#fff", color: PAL.ink }}>⤢ Fit</button>
        <button onClick={onClose} title="Close (markups are saved)" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${PAL.accent}`, background: PAL.accent, color: "#fff" }}>Done</button>
      </div>

      <div ref={wrapRef} onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
        style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#3a352e", touchAction: "none", cursor: tool === "select" ? "grab" : "crosshair" }}>
        {drawing.src ? (
          <>
            <img src={drawing.src} alt={drawing.name} draggable={false}
              style={{ position: "absolute", left: view.ox, top: view.oy, width: Wd, height: Hd, userSelect: "none", pointerEvents: "none", boxShadow: "0 4px 24px rgba(0,0,0,0.4)", background: PAL.paper }} />
            <svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none"
              style={{ position: "absolute", left: view.ox, top: view.oy, width: Wd, height: Hd }}>
              {allMarks.map((m) => renderMark(m, m.id === sel))}
            </svg>
            {/* measure / scale length labels at each segment midpoint */}
            {dimensioned.map((m) => {
              const pts = ptsOf(m); if (!pts || pts.length < 2) return null;
              const left = view.ox + ((pts[0].x + pts[1].x) / 2) * Wd, top = view.oy + ((pts[0].y + pts[1].y) / 2) * Hd;
              const ft = lenFt(pts[0], pts[1]);
              const txt = m.type === "calib" ? (m.feet ? `scale: ${fmtFt(m.feet)}` : "scale…") : ft != null ? fmtFt(ft) : "set scale →";
              return <div key={"L" + m.id} onPointerDown={(e) => startMove(e, m)}
                style={{ position: "absolute", left, top, transform: "translate(-50%,-50%)", fontSize: 11, fontWeight: 700, color: "#fff", background: m.type === "calib" ? "#7c3aed" : (ft != null ? "#0f766e" : "#b45309"), padding: "1px 5px", borderRadius: 5, whiteSpace: "nowrap", cursor: tool === "select" ? "move" : "crosshair", pointerEvents: "auto" }}>{txt}</div>;
            })}
            {/* text markups as positioned, zoom-scaled divs */}
            {texts.map((m) => {
              const pts = ptsOf(m); const left = view.ox + pts[0].x * Wd, top = view.oy + pts[0].y * Hd;
              const editing = textEdit?.id === m.id;
              return editing ? (
                <input key={m.id} autoFocus defaultValue={m.text}
                  onBlur={(e) => { const v = e.target.value; setMarks((cur) => cur.map((x) => (x.id === m.id ? { ...x, text: v } : x)).filter((x) => x.type !== "text" || x.text.trim() || x.id !== m.id)); setTextEdit(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  style={{ position: "absolute", left, top, fontSize: Math.max(11, 0.022 * Hd), color: m.color, fontWeight: 700, border: `1px dashed ${m.color}`, background: "rgba(255,255,255,0.85)", padding: "1px 3px", fontFamily: "system-ui" }} />
              ) : (
                <div key={m.id} onPointerDown={(e) => startMove(e, m)} onDoubleClick={() => setTextEdit({ id: m.id })}
                  style={{ position: "absolute", left, top, fontSize: Math.max(11, 0.022 * Hd), color: m.color, fontWeight: 700, cursor: tool === "select" ? "move" : "crosshair", whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(255,255,255,0.8)", outline: m.id === sel ? `1px dashed ${m.color}` : "none", padding: "1px 2px" }}>{m.text || "…"}</div>
              );
            })}
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#cbd5e1", fontSize: 13, textAlign: "center", padding: 24 }}>
            {loading
              ? "Loading the drawing from the cloud…"
              : <span>The drawing image isn't on this device.<br />Re-attach it from the original file to view &amp; mark it up; your markups are saved.</span>}
          </div>
        )}
      </div>
    </div>
  ), document.body);
}
