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
import { midOfPath, centroidOf, nearestRectPerimeterPoint, calloutCornerRadius } from "./geometry.js";
import { readProp } from "./propertySchema.js";
import { resolveMarkupStyle, MEASURE_KINDS, MEAS_STROKE } from "./markupStyle.js";
import { calloutBoxMetrics, bestMeasurer } from "./textWrap.js";

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

/* Measure value label. The measured value is computed (measureLabel); only its COLOR is
 * user-controllable — it follows the object's stroke so restyling a measure restyles its
 * label too. The paintOrder:"stroke" white halo keeps it legible over any fill (B734). */
function MeasLabel({ x, y, text, color = MEAS_STROKE }) {
  return (
    <text x={x} y={y} fontSize="11" fontWeight="700" fill={color}
      style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }} pointerEvents="none">
      {text}
    </text>
  );
}

/* Reads the display properties for a markup. A selected markup is shown in its REAL color
 * (WYSIWYG — so a color change in the panel takes effect instantly); selection is indicated by
 * the host's vertex grips + delete affordance, not by recoloring the stroke. A faint width bump
 * is the only selected cue (also covers freehand, which has no grips). Style + kind-keyed
 * fallback come from the shared resolveMarkupStyle (measures default teal, annotations orange). */
function props(m, selected) {
  const b = resolveMarkupStyle(m);
  return {
    stroke:      b.stroke,
    strokeWidth: b.strokeWidth + (selected ? 1 : 0),
    dashArray:   ({ dashed: "8 5", dotted: "2 4" })[b.strokeStyle] || undefined,
    opacity:     b.opacity,
    fill:        b.fill,
    fillOpacity: b.fillOpacity,
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
        {lbl && <MeasLabel x={mid.x + 4} y={mid.y - 4} text={lbl} color={p.stroke} />}
      </g>
    );
  }

  if (m.kind === "perimeter") {
    if (pts.length < 2) return null;
    const dd = [...pts, pts[0]].map((q) => `${q.x},${q.y}`).join(" ");
    const mid = midOfPath(pts, true);
    // Perimeter is a closed ring measuring loop length; fill is OFF by default (fillOpacity 0)
    // but user-settable (B734), painted behind the outline when turned up.
    return (
      <g opacity={p.opacity}>
        {p.fillOpacity > 0 && pts.length >= 3 && (
          <polygon points={pts.map((q) => `${q.x},${q.y}`).join(" ")}
            fill={p.fill !== "none" ? p.fill : p.stroke} fillOpacity={p.fillOpacity} stroke="none" />
        )}
        <polyline points={dd} fill="none" stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {pts.map((q, i) => <circle key={i} cx={q.x} cy={q.y} r={3} fill={p.stroke} />)}
        {lbl && <MeasLabel x={mid.x + 4} y={mid.y - 4} text={lbl} color={p.stroke} />}
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
        {lbl && <MeasLabel x={c.x} y={c.y} text={lbl} color={p.stroke} />}
      </g>
    );
  }

  if (m.kind === "count") {
    return (
      <g opacity={p.opacity}>
        {pts.map((q, i) => (
          <g key={i}>
            <circle cx={q.x} cy={q.y} r={7} fill={p.stroke + "33"} stroke={p.stroke} strokeWidth={1.5} />
            <text x={q.x} y={q.y + 3} fontSize="8" textAnchor="middle" fill={p.stroke} fontWeight="700" pointerEvents="none">{i + 1}</text>
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

  if (m.kind === "arc") {
    const a = pts[0], b = pts[1], c = pts[2]; if (!a || !b) return null;
    // Three-point arc: quadratic bezier through the control point c (or straight fallback)
    if (!c) return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} opacity={p.opacity} />;
    const ctrl = { x: 2 * c.x - (a.x + b.x) / 2, y: 2 * c.y - (a.y + b.y) / 2 };
    const aStart = readProp(m, "arrowStart"), aEnd = readProp(m, "arrowEnd");
    return (
      <g opacity={p.opacity}>
        <path d={`M ${a.x} ${a.y} Q ${ctrl.x} ${ctrl.y} ${b.x} ${b.y}`}
          fill="none" stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        {aEnd   && <Arrowhead from={ctrl} to={b} color={p.stroke} />}
        {aStart && <Arrowhead from={ctrl} to={a} color={p.stroke} />}
      </g>
    );
  }

  if (m.kind === "dimension") {
    const a = pts[0], b = pts[1]; if (!a || !b) return null;
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    if (len < 1) return null;
    const ux = dx / len, uy = dy / len; // unit vector along dimension line
    const tick = 7;                      // witness tick half-length (screen px already scaled)
    const fs = Math.max(6, (readProp(m, "fontSize") || 11) * scale / 16);
    const fc = readProp(m, "fontColor") || p.stroke;
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    return (
      <g opacity={p.opacity}>
        <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
        <line x1={a.x - uy * tick} y1={a.y + ux * tick} x2={a.x + uy * tick} y2={a.y - ux * tick} stroke={p.stroke} strokeWidth={p.strokeWidth} />
        <line x1={b.x - uy * tick} y1={b.y + ux * tick} x2={b.x + uy * tick} y2={b.y - ux * tick} stroke={p.stroke} strokeWidth={p.strokeWidth} />
        {lbl && (
          <text x={mid.x - uy * (fs + 3)} y={mid.y + ux * (fs + 3)} fontSize={fs} fontWeight="700" fill={fc}
            textAnchor="middle" pointerEvents="none"
            style={{ paintOrder: "stroke", stroke: "#fff", strokeWidth: 3 }}>{lbl}</text>
        )}
      </g>
    );
  }

  if (m.kind === "pen" || m.kind === "highlight") {
    if (pts.length < 2) return null;
    const d = "M " + pts.map((q) => `${q.x},${q.y}`).join(" L ");
    const isHL = m.kind === "highlight";
    const sw = isHL ? Math.max(8, (readProp(m, "strokeWidth") || 12)) : p.strokeWidth;
    const op = isHL ? Math.min(0.5, p.opacity || 0.35) : p.opacity;
    return <path d={d} fill="none" stroke={p.stroke} strokeWidth={sw}
      strokeLinecap="round" strokeLinejoin="round" opacity={op} />;
  }

  if (m.kind === "snapshot") {
    const a = pts[0], b = pts[1]; if (!a || !b) return null;
    const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
    const camSize = Math.min(20, h * 0.4, w * 0.4);
    return (
      <g opacity={p.opacity}>
        <rect x={x} y={y} width={w} height={h}
          fill={p.fill !== "none" ? p.fill : "none"} fillOpacity={p.fillOpacity}
          stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray || "6 3"} />
        {camSize >= 8 && (
          <text x={x + w / 2} y={y + h / 2 + camSize * 0.35} fontSize={camSize}
            textAnchor="middle" fill={p.stroke} opacity={0.45} pointerEvents="none">📷</text>
        )}
      </g>
    );
  }

  if (m.kind === "callout") {
    // N-leader model (B909/NEW-2): pts = [...tips, box]. A single point is a plain box-only
    // label (no leader — also what remains once the last leader is removed); ≥2 points is the
    // box plus one arrow per leading point, each pointing from its own nearest box edge/corner.
    if (!pts.length) return null;
    const box = pts[pts.length - 1];
    const tips = pts.slice(0, -1);
    const text = m.text || "";
    const fs        = Math.max(6, (readProp(m, "fontSize") || 14) * scale / 16);
    const fc        = readProp(m, "fontColor") || "#1a1a1a";
    const bold      = !!readProp(m, "bold");
    const italic    = !!readProp(m, "italic");
    const fw        = bold ? 700 : 400;
    const fi        = italic ? "italic" : "normal";
    const fd        = readProp(m, "underline") ? "underline" : "none";
    const bgFill    = p.fill !== "none" ? p.fill : "#fff";
    const bgOpacity = p.fillOpacity > 0 ? p.fillOpacity : 1;
    const padX = 8, padY = 4;   // horizontal a touch more generous than vertical (B566 parity)
    // The box is sized to the LONGEST ACTUAL wrapped line + the real line count (never a
    // char-count guess) — see textWrap.js. `measure` prefers real <canvas> glyph metrics in
    // the browser, so the box can't drift narrower than what actually paints.
    const measure = bestMeasurer({ bold, italic });
    const { lines, boxW, boxH, lineHeight } = calloutBoxMetrics(text, fs, { padX, padY, measure });
    return (
      <g opacity={p.opacity}>
        {tips.map((tip, i) => {
          const origin = nearestRectPerimeterPoint({ x: box.x, y: box.y, w: boxW, h: boxH }, tip);
          return (
            <g key={i}>
              <line x1={origin.x} y1={origin.y} x2={tip.x} y2={tip.y}
                stroke={p.stroke} strokeWidth={p.strokeWidth} strokeDasharray={p.dashArray} />
              <Arrowhead from={origin} to={tip} color={p.stroke} />
            </g>
          );
        })}
        {/* NEW-1 — corner radius scales with the box (zoom-invariant) and stays LOW so the callout
            reads as a rectangle at every zoom, matching the Site Planner callout. */}
        <rect x={box.x} y={box.y} width={boxW} height={boxH}
          fill={bgFill} fillOpacity={bgOpacity} stroke={p.stroke} strokeWidth={1}
          rx={calloutCornerRadius(boxW, boxH)} ry={calloutCornerRadius(boxW, boxH)} />
        <text x={box.x + padX} y={box.y + fs + padY / 2}
          fontSize={fs} fill={fc} fontWeight={fw} fontStyle={fi} textDecoration={fd}
          pointerEvents="none">
          {lines.map((line, i) => (
            <tspan key={i} x={box.x + padX} dy={i === 0 ? 0 : lineHeight}>{line}</tspan>
          ))}
        </text>
      </g>
    );
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
