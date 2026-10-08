/* The parcel page's SETBACKS section (Parcels rework — NEW-3; compacted by NEW-1, B2191xxx): a small
 * sketch of the parcel's own outline split into its few main sections (lib/boundarySections.js), each in
 * its own colour with ONE non-overlapping label (lib/setbackSketch.js), then ONE line — "Setback [25] ft ·
 * all sections" — and only the sections whose value differs, one short row each. Clicking a section in
 * the sketch or on the map opens a small inline editor (name + ft box) for just that section.
 * "Split or join sections" turns the corners into buttons so a bad grouping can be fixed.
 *
 * Presentational and module-scope. Setback VALUES stay per-edge on the parcel (the engine reads that
 * array); a section is only a view over edges, written back through `setSectionSetback`.
 */
import { useMemo, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { NUM_FONT } from "../../../shared/theme/typography.js";
import { summarizeSetbacks, layoutSectionLabels } from "../lib/setbackSketch.js";

/* Seven theme-aware accents, cycled — colour only tells neighbouring sections apart; the label does the naming. */
export const SECTION_COLORS = ["var(--accent-site)", "var(--accent-model)", "var(--accent-review)", "var(--accent-notes)", "var(--accent-library)", "var(--accent-food)", "var(--accent-schedule)"];
export const sectionColor = (i) => SECTION_COLORS[i % SECTION_COLORS.length];

const VB_W = 300, VB_H = 150, PAD = 22;

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

const labelText = (s) => (s.value == null ? "mixed" : `${Math.round(s.value)}′`);

function Sketch({ points, sections, selectedKey, hoverKey, editing, onSelect, onHover, onVertex }) {
  const fit = useMemo(() => fitSketch(points), [points]);
  const mapped = useMemo(() => points.map(fit.map), [points, fit]);
  const centre = useMemo(() => ({ x: mapped.reduce((s, p) => s + p.x, 0) / mapped.length, y: mapped.reduce((s, p) => s + p.y, 0) / mapped.length }), [mapped]);
  const paths = useMemo(() => sections.map((s) => sectionPath(points, s).map(fit.map)), [sections, points, fit]);
  const labels = useMemo(() => layoutSectionLabels(
    sections.map((s, i) => ({ key: s.key, pts: paths[i], text: labelText(s), force: s.key === selectedKey || s.key === hoverKey })),
    { width: VB_W, height: VB_H, centre }), [sections, paths, selectedKey, hoverKey, centre]);
  const n = points.length;
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" role="group" aria-label="Parcel outline split into setback sections" data-testid="setback-sketch" style={{ display: "block", maxHeight: 170 }}>
      <polygon points={mapped.map((q) => `${q.x},${q.y}`).join(" ")} fill="var(--surface-page)" stroke="none" />
      {sections.map((s, i) => {
        const pts = paths[i];
        const sel = s.key === selectedKey;
        const d = pts.map((q, j) => `${j ? "L" : "M"}${q.x},${q.y}`).join(" ");
        const lab = labels.get(s.key);
        return (
          <g key={s.key} data-testid={`setback-sketch-section-${s.key}`} data-selected={sel ? "1" : "0"} onClick={() => onSelect(sel ? null : s.key)}
            onPointerEnter={() => onHover(s.key)} onPointerLeave={() => onHover(null)} style={{ cursor: "pointer" }}>
            <path d={d} fill="none" stroke="transparent" strokeWidth={16} strokeLinejoin="round" strokeLinecap="round" />
            <path d={d} fill="none" stroke={sectionColor(i)} strokeWidth={sel ? 6 : 4} strokeLinejoin="round" strokeLinecap="round" />
            {lab && (
              <text x={lab.x} y={lab.y} textAnchor="middle" dominantBaseline="central" data-testid={`setback-sketch-num-${s.key}`}
                style={{ fontSize: FONT_SIZE.label, fontWeight: 700, fontFamily: NUM_FONT, fill: "var(--text-primary)", paintOrder: "stroke", stroke: "var(--surface-raised)", strokeWidth: 3, strokeLinejoin: "round", pointerEvents: "none" }}>
                {labelText(s)}
              </text>
            )}
          </g>
        );
      })}
      {editing && mapped.map((q, i) => (
        <circle key={i} cx={q.x} cy={q.y} r={4.5} data-testid={`setback-vertex-${i}`} onClick={() => onVertex(i)} style={{ cursor: "pointer" }}
          fill={sections.some((s) => s.startVertex % n === i) ? "var(--text-primary)" : "var(--surface-raised)"} stroke="var(--text-primary)" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

const rowStyle = (sel) => ({ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) auto", alignItems: "center", columnGap: SPACE.md, padding: `${SPACE.xs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm, border: `1px solid ${sel ? "var(--accent-site)" : "transparent"}`, background: sel ? "var(--surface-selected)" : "transparent", cursor: "pointer" });

export default function SetbackSections({ points, sections, selectedKey, onSelect, onSetValue, onSetAll, onToggleVertex, onResetAll, resetLabel, showLine, onShowLine, renderNum }) {
  const [editing, setEditing] = useState(false);
  const [hoverKey, setHoverKey] = useState(null);
  const { common, others } = useMemo(() => summarizeSetbacks(sections), [sections]);
  const selected = sections.find((s) => s.key === selectedKey) || null;
  const shown = others.filter((s) => s.key !== selectedKey); // the selected one has its own editor below the sketch
  const row = (s) => {
    const i = sections.indexOf(s);
    const sel = s.key === selectedKey;
    return (
      <div key={s.key} data-testid="setback-section-row" data-section-key={s.key} data-selected={sel ? "1" : "0"} onClick={() => onSelect(sel ? null : s.key)} style={rowStyle(sel)}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: RADIUS.pill, background: sectionColor(i) }} />
        <span style={{ minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{s.label}{s.mixed ? <span style={{ color: "var(--warn-text)" }}> · mixed</span> : null}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }} onClick={(e) => e.stopPropagation()}>
          {renderNum(s.value == null ? 0 : Math.round(s.value), (v) => onSetValue(s, v), `Setback — ${s.label}`)}
          <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>ft</span>
        </span>
      </div>
    );
  };
  return (
    <div data-testid="setback-sections">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: SPACE.lg, rowGap: SPACE.xs, marginBottom: SPACE.sm }}>
        <span data-testid="setback-all" style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
          <span style={{ fontWeight: 700 }}>Setback</span>
          {renderNum(common == null ? 0 : Math.round(common), (v) => onSetAll(v), "Setback — all sections")}
          <span style={{ color: "var(--text-secondary)" }}>ft · all sections</span>
        </span>
        <span style={{ flex: 1 }} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm, fontSize: FONT_SIZE.control, color: "var(--text-secondary)", cursor: "pointer" }} title="Show the setback line inside the parcel boundary">
          <input type="checkbox" checked={!!showLine} onChange={(e) => onShowLine(e.target.checked)} data-testid="setback-show-line" /> Show line
        </label>
      </div>
      <Sketch points={points} sections={sections} selectedKey={selectedKey} hoverKey={hoverKey} editing={editing} onSelect={onSelect} onHover={setHoverKey} onVertex={onToggleVertex} />
      {(selected || shown.length > 0) && (
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs, marginTop: SPACE.sm }}>
          {selected && row(selected)}
          {shown.map(row)}
        </div>
      )}
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
