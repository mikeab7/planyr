/* Shared markup SVG RENDERER (B426 / NEW-2; B428 text/arrow completions).
 *
 * Renders ONE markup as pure SVG elements, given the host's viewport scale.
 * Pure presentational — no state, no event handlers. The host SVG must have the
 * same coordinate system: `(0,0)` at the page/canvas top-left, scale already applied
 * via CSS transform on the page box (so this component just multiplies by view.scale).
 *
 * Props:
 *   markup    — the markup object (pts in page/canvas units)
 *   view      — { scale } — pixels per canvas unit (tx/ty handled by the page-box CSS transform)
 *   selected  — bool — show selection highlight
 *   ftPerUnit — feet per canvas unit (0 = uncalibrated); 1 for the Site Planner (feet-native)
 *
 * Import path: "../../shared/markup/MarkupRenderer.jsx" from either workspace.
 */
import { measureLabel } from "./measure.js";
import { midOfPath, centroidOf } from "./geometry.js";
import { readProp } from "./propertySchema.js";

/* ---- defaults ---- */
const DEF_STROKE   = "#c2410c";   // annotation default (matches matrix PROPERTY_COLUMNS)
const MEAS_STROKE  = "#0e7490";   // measure overlay stroke (teal)
const SEL_STROKE   = "var(--accent)";

const MEASURE_KINDS = new Set(["distance", "polylength", "perimeter", "area", "count"]);

/* Scalloped "cloud" path — shared with DocReview's cloudPath (same algorithm, module-local). */
function cloudPath(x, y, w, h, r = 9) {
  const edge = (x1, y1, x2, y2) => {
    const n = Math.max(1, Math.round(Math.hypot(x2 - x1, y2 - y1) / (r * 2)));
    const dx = (x2 - x1) / n, dy = (y2 - y1) / n;
    let s = "";
    for (let i = 0; i < n; i++) s += ` A ${r} ${r} 0 0 1 ${x1 + dx * (i + 1)} ${y1 + dy * (i + 1)}`;
    return s;
  };
  return `M ${x} ${y}` + edge(x, y, x + w, y) + edge(x + w, y, x + w, y + h) +
         edge(x + w, y + h, x, y + h) + edge(x, y + h, x, y) + " Z";
}

/* Inline arrowhead triangle (no SVG defs/markers needed). `from` is the penultimate
 * point, `to` is the tip. Size is in screen pixels (not scaled — arrowhead stays constant). */
function Arrowhead({ from, to, color, size = 9 }) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return null;
  const ux = dx / len, uy = dy / len;
  const hw = size * 0.45;
  const px = -uy * hw, py = ux * hw;
  return (
    <polygon
      points={[
        `${to.x},${to.y}`,
        `${to.x - ux * size + px},${to.y - uy * size + py}`,
        `${to.x - ux * size - px},${to.y - uy * size - py}`,
      ].join(" ")}
      fill={color} stroke="none" />
  );
}

function MeasLabel({ x, y, text }) {
  return (
    <text x={x} y={y} fontSize="11" fontWeight="700" fill={MEAS_STROKE}
      style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }} pointerEvents="none">
      {text}
    </text>
  );
}

/* Reads the display properties for a markup — selected highlight overrides the stroke
 * but keeps stored width/style. Falls back to PROPERTY_COLUMNS defaults via readProp. */
function props(m, selected) {
  const isMeas = MEASURE_KINDS.has(m.kind);
  return {
    stroke:      selected ? SEL_STROKE   : (readProp(m, "stroke")  || (isMeas ? MEAS_STROKE : DEF_STROKE)),
    strokeWidth: (readProp(m, "strokeWidth") || 2) + (selected ? 1 : 0),
    dashArray:   ({ dashed: "8 5", dotted: "2 4" })[readProp(m, "strokeStyle")] || undefined,
    opacity:     readProp(m, "opacity") ?? 1,
    fill:        readProp(m, "fill")    || "none",
    fillOpacity: readProp(m, "fillOpacity") ?? 0,
  };
}

export default function MarkupRenderer({ markup: m, view, selected = false, ftPerUnit = 0 }) {
  if (!m || !Array.isArray(m.pts) || !view || !view.scale) return null;
  const scale = view.scale;
  const S = (q) => ({ x: q.x * scale, y: q.y * scale });
  const pts = m.pts.map(S);

  const p = props(m, selected);
  const lbl = MEASURE_KINDS.has(m.kind) ? measureLabel(m, ftPerUnit) : null;

  /* ---- measures ---- */
  if (m.kind === "distance" || m.kind === "polylength") {
    if (pts.length < 2) return null;
    const dd = pts.map((q) => `${q.x},${q.y}`).join(" ");
    const mid = midOfPath(pts, false);
    return (
      <g opacity={p.opacity}>
        <polyline points={dd} fill="none" stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={p.stroke} />)}
        {lbl && <MeasLabel x={mid.x + 4} y={mid.y - 4} text={lbl} />}
      </g>
    );
  }

  if (m.kind === "perimeter") {
    if (pts.length < 2) return null;
    const dd = [...pts, pts[0]].map((q) => `${q.x},${q.y}`).join(" ");
    const mid = midOfPath(pts, true);
    return (
      <g opacity={p.opacity}>
        <polyline points={dd} fill="none" stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={p.stroke} />)}
        {lbl && <MeasLabel x={mid.x + 4} y={mid.y - 4} text={lbl} />}
      </g>
    );
  }

  if (m.kind === "area") {
    if (pts.length < 3) return null;
    const c = centroidOf(pts);
    const areaFill = p.fill !== "none" ? p.fill : MEAS_STROKE;
    return (
      <g opacity={p.opacity}>
        <polygon points={pts.map((q) => `${q.x},${q.y}`).join(" ")}
          fill={areaFill} fillOpacity={p.fillOpacity || 0.13}
          stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {lbl && <MeasLabel x={c.x} y={c.y} text={lbl} />}
      </g>
    );
  }

  if (m.kind === "count") {
    return (
      <g opacity={p.opacity}>
        {pts.map((q, i) => (
          <g key={i}>
            <circle cx={q.x} cy={q.y} r={7} fill={MEAS_STROKE + "33"} stroke={p.stroke} strokeWidth={1.5} />
            <text x={q.x} y={q.y + 3} fontSize="8" textAnchor="middle" fill={MEAS_STROKE} fontWeight="700" pointerEvents="none">{i + 1}</text>
          </g>
        ))}
      </g>
    );
  }

  /* ---- shapes ---- */
  if (m.kind === "rect") {
    const a = pts[0], b = pts[1]; if (!a || !b) return null;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    return <rect x={x} y={y} width={w} height={h}
      fill={p.fill} fillOpacity={p.fillOpacity} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} opacity={p.opacity} />;
  }

  if (m.kind === "cloud") {
    const a = pts[0], b = pts[1]; if (!a || !b) return null;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    return <path d={cloudPath(x, y, w, h)}
      fill={p.fill} fillOpacity={p.fillOpacity} stroke={p.stroke} strokeWidth={p.strokeWidth} opacity={p.opacity} />;
  }

  if (m.kind === "ellipse") {
    const a = pts[0], b = pts[1]; if (!a || !b) return null;
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
    const rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
    return <ellipse cx={cx} cy={cy} rx={rx} ry={ry}
      fill={p.fill} fillOpacity={p.fillOpacity} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} opacity={p.opacity} />;
  }

  if (m.kind === "line") {
    const a = pts[0], b = pts[1]; if (!a) return null;
    const end = b || a;
    const aStart = readProp(m, "arrowStart");
    const aEnd   = readProp(m, "arrowEnd");
    return (
      <g opacity={p.opacity}>
        <line x1={a.x} y1={a.y} x2={end.x} y2={end.y}
          stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {aEnd   && b && <Arrowhead from={a} to={b} color={p.stroke} />}
        {aStart && b && <Arrowhead from={b} to={a} color={p.stroke} />}
      </g>
    );
  }

  if (m.kind === "polyline") {
    if (pts.length < 2) return null;
    const dd = pts.map((q) => `${q.x},${q.y}`).join(" ");
    const aStart = readProp(m, "arrowStart");
    const aEnd   = readProp(m, "arrowEnd");
    const first = pts[0], second = pts[1];
    const last = pts[pts.length - 1], prev = pts[pts.length - 2];
    return (
      <g opacity={p.opacity}>
        <polyline points={dd} fill="none"
          stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {aEnd   && prev && <Arrowhead from={prev} to={last}  color={p.stroke} />}
        {aStart && second && <Arrowhead from={second} to={first} color={p.stroke} />}
      </g>
    );
  }

  if (m.kind === "polygon") {
    if (pts.length < 3) return null;
    const dd = pts.map((q) => `${q.x},${q.y}`).join(" ");
    return <polygon points={dd}
      fill={p.fill} fillOpacity={p.fillOpacity}
      stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} opacity={p.opacity} />;
  }

  if (m.kind === "text") {
    const q = pts[0]; if (!q) return null;
    const text = m.text || "";
    const fs        = Math.max(6, (readProp(m, "fontSize") || 14) * scale / 16);
    const fc        = readProp(m, "fontColor") || "#1a1a1a";
    const fw        = readProp(m, "bold")      ? 700 : 400;
    const fi        = readProp(m, "italic")    ? "italic" : "normal";
    const fd        = readProp(m, "underline") ? "underline" : "none";
    const alignVal  = readProp(m, "align")     || "left";
    const anchor    = alignVal === "center" ? "middle" : alignVal === "right" ? "end" : "start";
    const bgFill    = p.fill !== "none" ? p.fill : "#fff";
    const bgOpacity = p.fillOpacity > 0 ? p.fillOpacity : 1;
    const textW     = (text.length * fs * 0.58) + 8;
    const boxX      = anchor === "middle" ? q.x - textW / 2 : anchor === "end" ? q.x - textW + 2 : q.x - 2;
    return (
      <g opacity={p.opacity}>
        <rect x={boxX} y={q.y - fs - 2} width={textW} height={fs + 6}
          fill={bgFill} fillOpacity={bgOpacity} stroke={p.stroke} strokeWidth={1} rx={3} />
        <text x={q.x + (anchor === "start" ? 2 : 0)} y={q.y}
          fontSize={fs} fill={fc} fontWeight={fw} fontStyle={fi} textDecoration={fd}
          textAnchor={anchor} pointerEvents="none">{text}</text>
      </g>
    );
  }

  return null;
}
