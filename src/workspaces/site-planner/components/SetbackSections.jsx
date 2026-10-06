/* The parcel page's SETBACKS section (Parcels rework — NEW-3): a small sketch of the parcel's own
 * outline split into its main sections (lib/boundarySections.js), each in its own colour with its
 * setback written on it, and under it one row per section — named by direction and what it borders —
 * with an editable ft box. Clicking a section in the sketch, the list or on the map selects it.
 * "Split or join sections" turns the corners into buttons so a bad grouping can be fixed.
 *
 * Presentational and module-scope. Setback VALUES stay per-edge on the parcel (the engine reads that
 * array); a section is only a view over edges, written back through `setSectionSetback`.
 */
import { useMemo, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";

/* Seven theme-aware accents, cycled — colour only tells neighbouring sections apart; the label does the naming. */
export const SECTION_COLORS = ["var(--accent-site)", "var(--accent-model)", "var(--accent-review)", "var(--accent-notes)", "var(--accent-library)", "var(--accent-food)", "var(--accent-schedule)"];
export const sectionColor = (i) => SECTION_COLORS[i % SECTION_COLORS.length];

const VB_W = 300, VB_H = 190, PAD = 26;

/* Fit the ring into the viewBox, keeping its shape. Pure. */
export function fitSketch(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const w = Math.max(1e-6, maxX - minX), h = Math.max(1e-6, maxY - minY);
  const k = Math.min((VB_W - 2 * PAD) / w, (VB_H - 2 * PAD) / h);
  const ox = (VB_W - w * k) / 2 - minX * k, oy = (VB_H - h * k) / 2 - minY * k;
  return { map: (p) => ({ x: p.x * k + ox, y: p.y * k + oy }), k };
}

const ringIdx = (n, a, b) => { const out = [a % n]; let i = a % n, guard = 0; while (i !== b % n && guard++ <= n) { i = (i + 1) % n; out.push(i); } return out; };

export function sectionPath(points, section) {
  const n = points.length;
  return ringIdx(n, section.startVertex, section.endVertex).map((i) => points[i]);
}

function Sketch({ points, sections, selectedKey, editing, onSelect, onVertex }) {
  const fit = useMemo(() => fitSketch(points), [points]);
  const cx = useMemo(() => { const m = points.map(fit.map); return { x: m.reduce((s, p) => s + p.x, 0) / m.length, y: m.reduce((s, p) => s + p.y, 0) / m.length }; }, [points, fit]);
  const n = points.length;
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" role="group" aria-label="Parcel outline split into setback sections" data-testid="setback-sketch" style={{ display: "block", maxHeight: 220 }}>
      <polygon points={points.map((p) => { const q = fit.map(p); return `${q.x},${q.y}`; }).join(" ")} fill="var(--surface-page)" stroke="none" />
      {sections.map((s, i) => {
        const pts = sectionPath(points, s).map(fit.map);
        const sel = s.key === selectedKey;
        const d = pts.map((q, j) => `${j ? "L" : "M"}${q.x},${q.y}`).join(" ");
        const mid = pts[Math.floor(pts.length / 2)];
        const mx = pts.length % 2 === 0 ? (pts[pts.length / 2 - 1].x + mid.x) / 2 : mid.x;
        const my = pts.length % 2 === 0 ? (pts[pts.length / 2 - 1].y + mid.y) / 2 : mid.y;
        const vx = cx.x - mx, vy = cx.y - my, vl = Math.hypot(vx, vy) || 1;
        const tx = mx + (vx / vl) * 15, ty = my + (vy / vl) * 15;
        return (
          <g key={s.key} data-testid={`setback-sketch-section-${s.key}`} data-selected={sel ? "1" : "0"} onClick={() => onSelect(s.key)} style={{ cursor: "pointer" }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} strokeLinejoin="round" strokeLinecap="round" />
            <path d={d} fill="none" stroke={sectionColor(i)} strokeWidth={sel ? 6 : 4} strokeLinejoin="round" strokeLinecap="round" />
            <text x={tx} y={ty} textAnchor="middle" dominantBaseline="central" data-testid={`setback-sketch-num-${s.key}`}
              style={{ fontSize: FONT_SIZE.label, fontWeight: 700, fontFamily: NUM_FONT, fill: "var(--text-primary)", paintOrder: "stroke", stroke: "var(--surface-raised)", strokeWidth: 3, strokeLinejoin: "round", pointerEvents: "none" }}>
              {s.value == null ? "mixed" : `${Math.round(s.value)}′`}
            </text>
          </g>
        );
      })}
      {editing && points.map((p, i) => { const q = fit.map(p); return (
        <circle key={i} cx={q.x} cy={q.y} r={4.5} data-testid={`setback-vertex-${i}`} onClick={() => onVertex(i)} style={{ cursor: "pointer" }}
          fill={sections.some((s) => s.startVertex % n === i) ? "var(--text-primary)" : "var(--surface-raised)"} stroke="var(--text-primary)" strokeWidth={1.5} />
      ); })}
    </svg>
  );
}

export default function SetbackSections({ points, sections, selectedKey, onSelect, onSetValue, onToggleVertex, onResetAll, resetLabel, showLine, onShowLine, renderNum }) {
  const [editing, setEditing] = useState(false);
  return (
    <div data-testid="setback-sections">
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.lg, marginBottom: SPACE.sm }}>
        <span style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm, fontSize: FONT_SIZE.control, color: "var(--text-secondary)", cursor: "pointer" }} title="Show the setback line inside the parcel boundary">
          <input type="checkbox" checked={!!showLine} onChange={(e) => onShowLine(e.target.checked)} data-testid="setback-show-line" /> Show setback line
        </label>
      </div>
      <Sketch points={points} sections={sections} selectedKey={selectedKey} editing={editing} onSelect={onSelect} onVertex={onToggleVertex} />
      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs, marginTop: SPACE.sm }}>
        {sections.map((s, i) => {
          const sel = s.key === selectedKey;
          return (
            <div key={s.key} data-testid="setback-section-row" data-section-key={s.key} data-selected={sel ? "1" : "0"} onClick={() => onSelect(s.key)}
              style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) auto", alignItems: "center", columnGap: SPACE.md, padding: `${SPACE.xs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm, border: `1px solid ${sel ? "var(--accent-site)" : "transparent"}`, background: sel ? "var(--surface-selected)" : "transparent", cursor: "pointer" }}>
              <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: RADIUS.pill, background: sectionColor(i) }} />
              <span style={{ minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{s.label}{s.mixed ? <span style={{ color: "var(--warn-text)" }}> · mixed</span> : null}</span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }} onClick={(e) => e.stopPropagation()}>
                {renderNum(s.value == null ? 0 : Math.round(s.value), (v) => onSetValue(s, v), `Setback — ${s.label}`)}
                <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>ft</span>
              </span>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SPACE.lg, marginTop: SPACE.md }}>
        <button type="button" onClick={() => setEditing((o) => !o)} aria-pressed={editing} data-testid="setback-split-join"
          style={{ padding: 0, border: "none", background: "transparent", color: "var(--accent-site-text, var(--text-primary))", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, cursor: "pointer" }}>{editing ? "Done splitting or joining" : "Split or join sections"}</button>
        <button type="button" onClick={onResetAll} data-testid="setback-reset"
          style={{ padding: 0, border: "none", background: "transparent", color: "var(--text-secondary)", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, cursor: "pointer" }}>{resetLabel}</button>
      </div>
      {editing && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: SPACE.xs }}>Click a corner dot: a filled dot is a break — click it to join; a hollow one to split there.</div>}
    </div>
  );
}
