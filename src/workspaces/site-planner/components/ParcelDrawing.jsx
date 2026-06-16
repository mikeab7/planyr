/* ParcelDrawing — B67: open a PDF/JPEG attached to a parcel as an IMMUTABLE backdrop
 * and mark it up on an editable layer above it. Markups are stored in PIXEL-RELATIVE
 * (0..1) coordinates over the backdrop's intrinsic dimensions, so zoom/pan can never
 * corrupt geometry and the backdrop's true pixels stay the source of truth (forward-
 * compatible with a later pixel→EPSG:2278 georeference). The backdrop raster is never
 * written back — "editing" here means building your own analysis layer over it.
 *
 * Self-contained: the parent (SitePlanner) owns the persisted drawing record and
 * passes the resolved raster `src`; this component renders + edits the markup layer
 * and calls onSave(markups) as they change. No backend access of its own.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const PAL = { ink: "#26231e", muted: "#6b6557", line: "#ddd6c5", paper: "#f6f3ec", accent: "#e8590c" };
const COLORS = ["#dc2626", "#ea580c", "#2563eb", "#16a34a", "#7c3aed", "#111827"];
const uid = () => "k" + Math.random().toString(36).slice(2, 9);
const clamp01 = (v) => Math.max(0, Math.min(1, v));

export default function ParcelDrawing({ drawing, onSave, onClose }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [tool, setTool] = useState("select");      // select | pen | line | rect | text
  const [color, setColor] = useState(COLORS[0]);
  const [marks, setMarks] = useState(() => drawing.markups || []);
  const [sel, setSel] = useState(null);            // selected markup id
  const [draft, setDraft] = useState(null);        // in-progress markup
  const [view, setView] = useState({ scale: 1, ox: 0, oy: 0 }); // backdrop placement (screen px)
  const [textEdit, setTextEdit] = useState(null);  // { id } while editing a text markup
  const drag = useRef(null);
  const firstSave = useRef(true);
  const iw = drawing.intrinsic?.w || 1000, ih = drawing.intrinsic?.h || 1000;

  // Persist whenever the markup set settles (parent merges into the site record).
  // Skip the mount fire so opening a drawing doesn't re-save unchanged markups.
  useEffect(() => { if (firstSave.current) { firstSave.current = false; return; } onSave?.(marks); }, [marks]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fit the backdrop to the viewport on mount / resize.
  const fit = () => {
    const el = wrapRef.current; if (!el) return;
    const cw = el.clientWidth, ch = el.clientHeight - 0;
    const s = Math.min(cw / iw, ch / ih) * 0.92;
    setView({ scale: s, ox: (cw - iw * s) / 2, oy: (ch - ih * s) / 2 });
  };
  useEffect(() => { fit(); const on = () => fit(); window.addEventListener("resize", on); return () => window.removeEventListener("resize", on); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The displayed backdrop rect (screen px) and 0..1 <-> screen helpers.
  const Wd = iw * view.scale, Hd = ih * view.scale;
  const toNorm = (cx, cy) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: clamp01((cx - r.left) / r.width), y: clamp01((cy - r.top) / r.height) };
  };

  const commitMarks = (next) => setMarks(next);
  const addMark = (m) => commitMarks([...marks, m]);
  const delSel = () => { if (sel) { commitMarks(marks.filter((m) => m.id !== sel)); setSel(null); } };

  const onWheel = (e) => {
    e.preventDefault();
    const f = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const r = wrapRef.current.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    setView((v) => { const ns = Math.max(0.05, Math.min(12, v.scale * f)); const k = ns / v.scale; return { scale: ns, ox: mx - (mx - v.ox) * k, oy: my - (my - v.oy) * k }; });
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    const n = toNorm(e.clientX, e.clientY);
    if (tool === "select") {
      // pan the backdrop (drawing-space drag)
      drag.current = { mode: "pan", sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
      setSel(null);
      return;
    }
    if (tool === "text") {
      const m = { id: uid(), type: "text", pts: [n], color, text: "" };
      addMark(m); setTextEdit({ id: m.id }); setTool("select");
      return;
    }
    drag.current = { mode: "draw", type: tool };
    setDraft({ id: uid(), type: tool, color, pts: [n] });
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onMove = (e) => {
    const d = drag.current; if (!d) return;
    if (d.mode === "pan") { setView((v) => ({ ...v, ox: d.ox + (e.clientX - d.sx), oy: d.oy + (e.clientY - d.sy) })); return; }
    const n = toNorm(e.clientX, e.clientY);
    setDraft((dr) => {
      if (!dr) return dr;
      if (dr.type === "pen") return { ...dr, pts: [...dr.pts, n] };
      return { ...dr, pts: [dr.pts[0], n] }; // line / rect: anchor + current
    });
  };
  const onUp = () => {
    const d = drag.current; drag.current = null;
    if (d?.mode === "draw" && draft) {
      const ok = draft.type === "pen" ? draft.pts.length > 1 : (draft.pts.length === 2 && (Math.abs(draft.pts[0].x - draft.pts[1].x) > 0.002 || Math.abs(draft.pts[0].y - draft.pts[1].y) > 0.002));
      if (ok) addMark(draft);
    }
    setDraft(null);
  };

  // Render one markup as SVG (coords are 0..1; the svg viewBox is 0 0 1 1).
  const renderMark = (m, isSel) => {
    const sw = isSel ? 3.25 : 2;
    const common = { stroke: m.color, strokeWidth: sw, fill: "none", vectorEffect: "non-scaling-stroke", strokeLinecap: "round", strokeLinejoin: "round", style: { cursor: tool === "select" ? "pointer" : "crosshair" }, onPointerDown: tool === "select" ? (e) => { e.stopPropagation(); setSel(m.id); } : undefined };
    if (m.type === "pen" || m.type === "line") {
      const d = m.pts.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ");
      return <path key={m.id} d={d} {...common} />;
    }
    if (m.type === "rect") {
      const [a, b] = m.pts; if (!b) return null;
      return <rect key={m.id} x={Math.min(a.x, b.x)} y={Math.min(a.y, b.y)} width={Math.abs(b.x - a.x)} height={Math.abs(b.y - a.y)} {...common} />;
    }
    return null; // text rendered as a positioned div overlay below
  };

  const allMarks = draft ? [...marks, draft] : marks;
  const texts = allMarks.filter((m) => m.type === "text");

  const tBtn = (id, label) => (
    <button onClick={() => setTool(id)} title={label}
      style={{ padding: "6px 10px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${tool === id ? PAL.accent : PAL.line}`, background: tool === id ? PAL.accent : "#fff", color: tool === id ? "#fff" : PAL.ink }}>{label}</button>
  );

  // Portal to <body> so the full-screen editor escapes the workspace's stacking-context
  // floor (the shell <main> is z-capped, B66) and its top toolbar isn't hidden behind
  // the shell header.
  return createPortal((
    <div style={{ position: "fixed", inset: 0, zIndex: 4000, background: "rgba(20,18,15,0.55)", display: "flex", flexDirection: "column", fontFamily: "system-ui, sans-serif" }}>
      {/* toolbar */}
      <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "9px 12px", background: "#fff", borderBottom: `1px solid ${PAL.line}` }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: PAL.ink, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{drawing.name || "Drawing"}</span>
        <span style={{ fontSize: 11, color: PAL.muted }}>immutable backdrop · markups saved</span>
        <span style={{ width: 1, height: 20, background: PAL.line, margin: "0 4px" }} />
        {tBtn("select", "Select")}{tBtn("pen", "Pen")}{tBtn("line", "Line")}{tBtn("rect", "Box")}{tBtn("text", "Text")}
        <span style={{ display: "flex", gap: 3, marginLeft: 4 }}>
          {COLORS.map((c) => <button key={c} onClick={() => { setColor(c); if (sel) commitMarks(marks.map((m) => m.id === sel ? { ...m, color: c } : m)); }} title={c}
            style={{ width: 18, height: 18, borderRadius: 99, cursor: "pointer", background: c, border: color === c ? `2px solid ${PAL.ink}` : "2px solid #fff", boxShadow: "0 0 0 1px " + PAL.line }} />)}
        </span>
        <button onClick={delSel} disabled={!sel} title="Delete selected markup"
          style={{ padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: sel ? "pointer" : "not-allowed", fontFamily: "inherit", border: `1px solid ${PAL.line}`, background: "#fff", color: sel ? "#b91c1c" : PAL.muted, opacity: sel ? 1 : 0.6 }}>Delete</button>
        <span style={{ flex: 1 }} />
        <button onClick={fit} title="Fit the drawing to the view" style={{ padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${PAL.line}`, background: "#fff", color: PAL.ink }}>⤢ Fit</button>
        <button onClick={onClose} title="Close (markups are saved)" style={{ padding: "6px 12px", fontSize: 12, fontWeight: 700, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", border: `1px solid ${PAL.accent}`, background: PAL.accent, color: "#fff" }}>Done</button>
      </div>

      {/* canvas */}
      <div ref={wrapRef} onWheel={onWheel} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden", background: "#3a352e", touchAction: "none", cursor: tool === "select" ? "grab" : "crosshair" }}>
        {drawing.src ? (
          <>
            <img src={drawing.src} alt={drawing.name} draggable={false}
              style={{ position: "absolute", left: view.ox, top: view.oy, width: Wd, height: Hd, userSelect: "none", pointerEvents: "none", boxShadow: "0 4px 24px rgba(0,0,0,0.4)", background: PAL.paper }} />
            <svg ref={svgRef} viewBox="0 0 1 1" preserveAspectRatio="none"
              onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
              style={{ position: "absolute", left: view.ox, top: view.oy, width: Wd, height: Hd }}>
              {allMarks.map((m) => renderMark(m, m.id === sel))}
            </svg>
            {/* text markups as positioned, zoom-scaled divs */}
            {texts.map((m) => {
              const left = view.ox + m.pts[0].x * Wd, top = view.oy + m.pts[0].y * Hd;
              const editing = textEdit?.id === m.id;
              return editing ? (
                <input key={m.id} autoFocus defaultValue={m.text}
                  onBlur={(e) => { commitMarks(marks.map((x) => x.id === m.id ? { ...x, text: e.target.value } : x).filter((x) => x.type !== "text" || x.text.trim() || x.id !== m.id)); setTextEdit(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
                  style={{ position: "absolute", left, top, fontSize: Math.max(11, 0.022 * Hd), color: m.color, fontWeight: 700, border: `1px dashed ${m.color}`, background: "rgba(255,255,255,0.85)", padding: "1px 3px", fontFamily: "system-ui" }} />
              ) : (
                <div key={m.id} onPointerDown={(e) => { if (tool === "select") { e.stopPropagation(); setSel(m.id); } }}
                  onDoubleClick={() => setTextEdit({ id: m.id })}
                  style={{ position: "absolute", left, top, fontSize: Math.max(11, 0.022 * Hd), color: m.color, fontWeight: 700, cursor: tool === "select" ? "pointer" : "crosshair", whiteSpace: "nowrap", textShadow: "0 1px 2px rgba(255,255,255,0.8)", outline: m.id === sel ? `1px dashed ${m.color}` : "none", padding: "1px 2px" }}>{m.text || "…"}</div>
              );
            })}
          </>
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#cbd5e1", fontSize: 13, textAlign: "center", padding: 24 }}>
            The drawing image isn't on this device.<br />Re-attach it from the original file to view &amp; mark it up; your markups are saved.
          </div>
        )}
      </div>
    </div>
  ), document.body);
}
