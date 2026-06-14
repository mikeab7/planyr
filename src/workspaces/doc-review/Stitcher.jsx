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
import { useEffect, useRef, useState } from "react";
import { loadPdf, renderPageToImage } from "./lib/pdf.js";
import { dist, polyArea, pathLength } from "./lib/takeoff.js";
import { ftToAcres } from "../../shared/coordinates/index.js";

const PAL = { paper: "#efeadf", ink: "#2c2a26", muted: "#8a8473", line: "#e7e2d6", accent: "#c2410c", chrome: "#191613", chromeInk: "#ece7db", chromeMuted: "#9b9482", ember: "#e8590c" };
const uid = () => "s" + Math.random().toString(36).slice(2, 9);
const ID = { A: 1, B: 0, e: 0, f: 0 };

// page-units → world, and inverse
const fwd = (M, p) => ({ x: M.A * p.x - M.B * p.y + M.e, y: M.B * p.x + M.A * p.y + M.f });
const inv = (M, w) => { const det = M.A * M.A + M.B * M.B || 1; const dx = w.x - M.e, dy = w.y - M.f; return { x: (M.A * dx + M.B * dy) / det, y: (-M.B * dx + M.A * dy) / det }; };
// similarity transform mapping b1→A1, b2→A2 (page-units → world)
function solveM(b1, b2, A1, A2) {
  const vb = { x: b2.x - b1.x, y: b2.y - b1.y }, vA = { x: A2.x - A1.x, y: A2.y - A1.y };
  const lb = Math.hypot(vb.x, vb.y) || 1, scale = Math.hypot(vA.x, vA.y) / lb;
  const theta = Math.atan2(vA.y, vA.x) - Math.atan2(vb.y, vb.x);
  const A = scale * Math.cos(theta), B = scale * Math.sin(theta);
  return { A, B, e: A1.x - (A * b1.x - B * b1.y), f: A1.y - (B * b1.x + A * b1.y) };
}
function sheetBBox(s) {
  const c = [{ x: 0, y: 0 }, { x: s.baseW, y: 0 }, { x: s.baseW, y: s.baseH }, { x: 0, y: s.baseH }].map((p) => fwd(s.M, p));
  return { minX: Math.min(...c.map((p) => p.x)), maxX: Math.max(...c.map((p) => p.x)), minY: Math.min(...c.map((p) => p.y)), maxY: Math.max(...c.map((p) => p.y)) };
}

const f0 = (n) => Math.round(n).toLocaleString();
const f2 = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function Stitcher({ onReview }) {
  const svgRef = useRef(null);
  const [pdfs, setPdfs] = useState([]);          // {id,name,doc,numPages}
  const [placed, setPlaced] = useState([]);      // {id,name,href,baseW,baseH,M}
  const [view, setView] = useState({ panX: 40, panY: 40, zoom: 0.4 });
  const [tool, setTool] = useState("pan");       // pan | distance | area | calibrate
  const [align, setAlign] = useState(null);      // { sheetId, step, A1, b1, A2 }
  const [draft, setDraft] = useState(null);      // measure/calibrate in progress (world pts)
  const [cursor, setCursor] = useState(null);    // world cursor
  const [measures, setMeasures] = useState([]);  // {id,kind,pts:[world]}
  const [ftPerUnit, setFtPerUnit] = useState(0); // composite calibration (ft per world unit)
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const drag = useRef(null);

  const openFiles = async (files) => {
    const list = [...(files || [])].filter((f) => /pdf$/i.test(f.name) || f.type === "application/pdf");
    if (!list.length) return;
    setBusy(true); setErr("");
    try {
      const loaded = [];
      for (const f of list) { const doc = await loadPdf(f); loaded.push({ id: uid(), name: f.name, doc, numPages: doc.numPages }); }
      setPdfs((p) => [...p, ...loaded]);
    } catch (_) { setErr("One of those files wasn't a readable PDF."); }
    finally { setBusy(false); }
  };

  const addSheet = async (pdf, pageNum) => {
    setBusy(true);
    try {
      const img = await renderPageToImage(pdf.doc, pageNum, 2);
      setPlaced((arr) => {
        let M = { ...ID };
        if (arr.length) { const right = Math.max(...arr.map((s) => sheetBBox(s).maxX)); M = { ...ID, e: right + 40 }; }
        return [...arr, { id: uid(), name: `${pdf.name} · p${pageNum}`, href: img.href, baseW: img.baseW, baseH: img.baseH, M }];
      });
    } finally { setBusy(false); }
  };

  const toWorld = (e) => { const r = svgRef.current.getBoundingClientRect(); return { x: (e.clientX - r.left - view.panX) / view.zoom, y: (e.clientY - r.top - view.panY) / view.zoom }; };

  const startAlign = (sheetId) => { setTool("pan"); setDraft(null); setAlign({ sheetId, step: 0 }); setErr(""); };

  const onDown = (e) => {
    const w = toWorld(e);
    if (align) {
      const sheet = placed.find((s) => s.id === align.sheetId);
      if (align.step === 0) setAlign({ ...align, step: 1, A1: w });
      else if (align.step === 1) setAlign({ ...align, step: 2, b1: inv(sheet.M, w) });
      else if (align.step === 2) setAlign({ ...align, step: 3, A2: w });
      else {
        const b2 = inv(sheet.M, w);
        const M = solveM(align.b1, b2, align.A1, align.A2);
        setPlaced((arr) => arr.map((s) => (s.id === align.sheetId ? { ...s, M } : s)));
        setAlign(null);
      }
      return;
    }
    if (tool === "pan") { drag.current = { sx: e.clientX, sy: e.clientY, panX: view.panX, panY: view.panY }; svgRef.current.setPointerCapture(e.pointerId); return; }
    if (tool === "calibrate" || tool === "distance") {
      if (!draft) setDraft({ kind: tool, pts: [w] });
      else { const pts = [draft.pts[0], w]; if (tool === "calibrate") doCalibrate(pts); else setMeasures((m) => [...m, { id: uid(), kind: "distance", pts }]); setDraft(null); }
      return;
    }
    if (tool === "area") setDraft((d) => (d && d.kind === "area" ? { ...d, pts: [...d.pts, w] } : { kind: "area", pts: [w] }));
  };
  const onMove = (e) => {
    setCursor(toWorld(e));
    if (drag.current) { setView((v) => ({ ...v, panX: drag.current.panX + (e.clientX - drag.current.sx), panY: drag.current.panY + (e.clientY - drag.current.sy) })); }
  };
  const onUp = (e) => { if (drag.current) { drag.current = null; try { svgRef.current.releasePointerCapture(e.pointerId); } catch (_) {} } };
  const onWheel = (e) => { e.preventDefault(); const r = svgRef.current.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top; setView((v) => { const f = e.deltaY < 0 ? 1.15 : 1 / 1.15; const z = Math.max(0.05, Math.min(8, v.zoom * f)); return { zoom: z, panX: mx - ((mx - v.panX) * z) / v.zoom, panY: my - ((my - v.panY) * z) / v.zoom }; }); };
  const finishArea = () => { if (draft && draft.kind === "area" && draft.pts.length >= 3) setMeasures((m) => [...m, { id: uid(), kind: "area", pts: draft.pts }]); setDraft(null); };

  const doCalibrate = (pts) => {
    const u = dist(pts[0], pts[1]);
    if (u < 1) { setErr("Line too short — zoom in and retry."); return; }
    const v = window.prompt("Real length of that line (feet):"); const ft = parseFloat(v);
    if (isFinite(ft) && ft > 0) { setFtPerUnit(ft / u); setErr(""); }
  };

  useEffect(() => {
    const onKey = (e) => { if (e.key === "Enter") finishArea(); else if (e.key === "Escape") { setDraft(null); setAlign(null); } };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }); // eslint-disable-line

  // takeoff totals (world units → feet via composite calibration)
  const totals = measures.reduce((t, m) => {
    if (m.kind === "distance") { const u = dist(m.pts[0], m.pts[1]); if (ftPerUnit) t.distFt += u * ftPerUnit; }
    else if (m.kind === "area") { const u = polyArea(m.pts); if (ftPerUnit) t.areaSf += u * ftPerUnit * ftPerUnit; }
    return t;
  }, { distFt: 0, areaSf: 0 });

  const tray = pdfs.flatMap((p) => Array.from({ length: p.numPages }, (_, i) => ({ key: p.id + ":" + (i + 1), pdf: p, page: i + 1 })));
  const G = `translate(${view.panX} ${view.panY}) scale(${view.zoom})`;
  const ls = (n) => n / view.zoom; // constant on-screen size inside the zoomed group
  const btn = (on) => ({ padding: "6px 10px", fontSize: 11.5, borderRadius: 7, cursor: "pointer", fontFamily: "inherit", fontWeight: 600, border: `1px solid ${on ? PAL.accent : "#ddd6c5"}`, background: on ? PAL.accent : "#fff", color: on ? "#fff" : PAL.ink });
  const alignMsg = align && ["Click reference point #1 (on a placed sheet)", "Click the SAME point on the sheet being aligned", "Click reference point #2", "Click the matching point #2 on the sheet"][align.step];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", background: PAL.paper }}
      onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); openFiles(e.dataTransfer.files); }}>
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
        <button style={btn(false)} onClick={() => setView((v) => ({ ...v, zoom: Math.max(0.05, v.zoom / 1.2) }))}>−</button>
        <span style={{ color: PAL.chromeMuted, fontSize: 11.5, width: 42, textAlign: "center" }}>{Math.round(view.zoom * 100)}%</span>
        <button style={btn(false)} onClick={() => setView((v) => ({ ...v, zoom: Math.min(8, v.zoom * 1.2) }))}>+</button>
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
        <div style={{ flex: 1, minWidth: 0, position: "relative", background: "#cfc8ba" }}>
          <svg ref={svgRef} width="100%" height="100%" style={{ display: "block", cursor: align ? "crosshair" : tool === "pan" ? "grab" : "crosshair", touchAction: "none" }}
            onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onDoubleClick={finishArea}
            onWheel={onWheel} onMouseDown={(e) => e.preventDefault()}>
            <g transform={G}>
              {placed.map((s) => {
                const aligning = align && align.sheetId === s.id;
                return <image key={s.id} href={s.href} x={0} y={0} width={s.baseW} height={s.baseH} preserveAspectRatio="none"
                  transform={`matrix(${s.M.A} ${s.M.B} ${-s.M.B} ${s.M.A} ${s.M.e} ${s.M.f})`}
                  opacity={aligning ? 0.6 : 1} style={{ outline: aligning ? "2px solid #c2410c" : "none" }} />;
              })}
              {/* measures (world coords) */}
              {measures.map((m) => {
                if (m.kind === "distance") { const a = m.pts[0], b = m.pts[1]; const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; return <g key={m.id}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#0e7490" strokeWidth={ls(2)} /><text x={mid.x} y={mid.y - ls(4)} fontSize={ls(12)} fontWeight="700" fill="#0e7490" style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: ls(3) }}>{ftPerUnit ? `${f0(dist(a, b) * ftPerUnit)} ft` : "set scale"}</text></g>; }
                const c = m.pts.reduce((p, q) => ({ x: p.x + q.x / m.pts.length, y: p.y + q.y / m.pts.length }), { x: 0, y: 0 });
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
          {(align || tool !== "pan") && (
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
          {placed.map((s, i) => (
            <div key={s.id} style={{ border: `1px solid ${align && align.sheetId === s.id ? PAL.accent : PAL.line}`, borderRadius: 7, padding: "6px 8px", marginBottom: 6 }}>
              <div style={{ fontSize: 11, color: PAL.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginBottom: 4 }}>{i + 1}. {s.name}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {i > 0 && <button style={{ ...btn(align && align.sheetId === s.id), padding: "3px 8px", fontSize: 11 }} onClick={() => startAlign(s.id)}>Align</button>}
                <button style={{ ...btn(false), padding: "3px 8px", fontSize: 11, color: "#b3361b" }} onClick={() => setPlaced((arr) => arr.filter((x) => x.id !== s.id))}>Remove</button>
              </div>
            </div>
          ))}
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
