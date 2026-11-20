/* The parcel page's SETBACKS section (Parcels rework — NEW-3; compacted by NEW-1, B2191xxx): a small
 * sketch of the parcel's own outline split into its few main sections (lib/boundarySections.js), each in
 * its own colour with ONE non-overlapping label (lib/setbackSketch.js), then ONE line — "Setback [25] ft ·
 * all sections" — and only the sections whose value differs, one short row each. Clicking a section in
 * the sketch or on the map opens a small inline editor (name + ft box) for just that section.
 * "Split or join sections" turns the corners into buttons so a bad grouping can be fixed.
 *
 * Presentational and module-scope. Setback VALUES stay per-edge on the parcel (the engine reads that
 * array); a section is only a view over edges, written back through `setSectionSetback`.
 *
 * PAVING SETBACK (NEW-1, 2026-11-09): a second per-edge array over the SAME sections. Off until "+ Add paving
 * setback" is clicked (nothing here ever fills it from the building value). Once added: its own "Paving [n] ft ·
 * all sections" row (own Show line + a trash that removes it), a Building | Paving switch that picks which numbers
 * the sketch labels, and section rows that show BOTH numbers under BUILDING / PAVING headings. Parent wiring is the
 * `paving` prop ({ valueOf, common, onSetValue, onSetAll, showLine, onShowLine, onRemove }) + `onAddPaving`.
 */
import { useMemo, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { NUM_FONT } from "../../../shared/theme/typography.js";
import { summarizeSetbacks, layoutSectionLabels, pickVertexDots } from "../lib/setbackSketch.js";

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

function Sketch({ points, sections, selectedKey, hoverKey, editing, onSelect, onHover, onVertex, labelFor = labelText, ariaLabel = "Parcel outline split into setback sections" }) {
  const fit = useMemo(() => fitSketch(points), [points]);
  const mapped = useMemo(() => points.map(fit.map), [points, fit]);
  const centre = useMemo(() => ({ x: mapped.reduce((s, p) => s + p.x, 0) / mapped.length, y: mapped.reduce((s, p) => s + p.y, 0) / mapped.length }), [mapped]);
  const paths = useMemo(() => sections.map((s) => sectionPath(points, s).map(fit.map)), [sections, points, fit]);
  const labels = useMemo(() => layoutSectionLabels(
    sections.map((s, i) => ({ key: s.key, pts: paths[i], text: labelFor(s), force: s.key === selectedKey || s.key === hoverKey })),
    { width: VB_W, height: VB_H, centre }), [sections, paths, selectedKey, hoverKey, centre, labelFor]);
  const n = points.length;
  const dots = useMemo(() => (editing ? pickVertexDots(mapped, sections.map((s) => s.startVertex % n)) : []), [editing, mapped, sections, n]);
  return (
    <svg viewBox={`0 0 ${VB_W} ${VB_H}`} width="100%" role="group" aria-label={ariaLabel} data-testid="setback-sketch" style={{ display: "block", maxHeight: 170 }}>
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
                {labelFor(s)}
              </text>
            )}
          </g>
        );
      })}
      {editing && dots.map(({ i, isBreak }) => {
        const q = mapped[i];
        return (
          <g key={i} data-testid={`setback-vertex-${i}`} data-break={isBreak ? "1" : "0"} onClick={() => onVertex(i)} style={{ cursor: "pointer" }}>
            <circle cx={q.x} cy={q.y} r={9} fill="transparent" />
            <circle cx={q.x} cy={q.y} r={isBreak ? 6 : 4.5} fill={isBreak ? "var(--text-primary)" : "var(--surface-raised)"} stroke="var(--text-primary)" strokeWidth={1.5} />
          </g>
        );
      })}
    </svg>
  );
}

const rowStyle = (sel, paving) => ({ display: "grid", gridTemplateColumns: paving ? "10px minmax(0, 1fr) auto auto auto" : "10px minmax(0, 1fr) auto", alignItems: "center", columnGap: SPACE.md, padding: `${SPACE.xs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm, border: `1px solid ${sel ? "var(--accent-site)" : "transparent"}`, background: sel ? "var(--surface-selected)" : "transparent", cursor: "pointer" });
const linkBtn = { padding: 0, border: "none", background: "transparent", color: "var(--accent-site-text, var(--text-primary))", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, cursor: "pointer" };
const showLineLabel = { display: "inline-flex", alignItems: "center", gap: SPACE.sm, fontSize: FONT_SIZE.control, color: "var(--text-secondary)", cursor: "pointer" };
/* Building and Paving share ONE grid, so the two rows' numbers and Show lines line up (label | box | "ft · all sections" | Show line | trash). */
const topRow = { display: "grid", gridTemplateColumns: "auto auto minmax(0, 1fr) auto 28px", alignItems: "center", columnGap: SPACE.sm, rowGap: SPACE.xs, marginBottom: SPACE.sm };
const colHead = { fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-secondary)", textTransform: "uppercase", width: 54, textAlign: "left" };

/* A section's value for one mode, in the shape summarizeSetbacks reads (`value` null = mixed). */
const asMode = (sections, valueOf) => sections.map((s) => ({ ...s, value: valueOf(s) }));

export default function SetbackSections({ points, sections, selectedKey, onSelect, onSetValue, onSetAll, onToggleVertex, onResetAll, resetLabel, showLine, onShowLine, renderNum, collapsed, paving = null, onAddPaving = null }) {
  const [editing, setEditing] = useState(false);
  const [hoverKey, setHoverKey] = useState(null);
  const [modeRaw, setMode] = useState("building");
  const hasPaving = !!paving;
  const mode = hasPaving ? modeRaw : "building"; // the switch only exists once paving does
  const pavingSections = useMemo(() => (hasPaving ? asMode(sections, paving.valueOf) : null), [hasPaving, sections, paving]);
  const { common, others } = useMemo(() => summarizeSetbacks(sections), [sections]);
  const pavingSummary = useMemo(() => (pavingSections ? summarizeSetbacks(pavingSections) : null), [pavingSections]);
  const selected = sections.find((s) => s.key === selectedKey) || null;
  // A row is listed when EITHER number differs from its common value (the selected one has its own editor below the sketch).
  const shown = hasPaving
    ? sections.filter((s, i) => s.key !== selectedKey && (others.includes(s) || pavingSummary.others.includes(pavingSections[i])))
    : others.filter((s) => s.key !== selectedKey);
  const labelFor = useMemo(() => (mode === "paving" ? (s) => { const v = paving.valueOf(s); return v == null ? "mixed" : `${Math.round(v)}′`; } : labelText), [mode, paving]);
  const box = (kind, s) => {
    const v = kind === "paving" ? paving.valueOf(s) : s.value;
    const set = kind === "paving" ? paving.onSetValue : onSetValue;
    const word = kind === "paving" ? "Paving setback" : "Building setback";
    return (
      <span data-testid={`setback-box-${kind}`} data-active={mode === kind ? "1" : "0"} onClick={(e) => e.stopPropagation()}
        style={{ display: "inline-flex", borderRadius: RADIUS.sm, outline: mode === kind ? "1px solid var(--accent-site)" : "none" }}>
        {renderNum(v == null ? 0 : Math.round(v), (n) => set(s, n), `${word} — ${s.label}`)}
      </span>
    );
  };
  const row = (s) => {
    const i = sections.indexOf(s);
    const sel = s.key === selectedKey;
    return (
      <div key={s.key} data-testid="setback-section-row" data-section-key={s.key} data-selected={sel ? "1" : "0"} onClick={() => onSelect(sel ? null : s.key)} style={rowStyle(sel, hasPaving)}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: RADIUS.pill, background: sectionColor(i) }} />
        <span style={{ minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{s.label}{s.mixed ? <span style={{ color: "var(--warn-text)" }}> · mixed</span> : null}</span>
        {hasPaving ? (
          <>
            {box("building", s)}
            {box("paving", s)}
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>ft</span>
          </>
        ) : (
          <span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }} onClick={(e) => e.stopPropagation()}>
            {renderNum(s.value == null ? 0 : Math.round(s.value), (v) => onSetValue(s, v), `Setback — ${s.label}`)}
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>ft</span>
          </span>
        )}
      </div>
    );
  };
  const hasRows = !!selected || shown.length > 0;
  return (
    <div data-testid="setback-sections">
      {collapsed && (
        <div role="alert" data-testid="setback-collapsed" style={{ marginBottom: SPACE.sm, padding: `${SPACE.xs}px ${SPACE.sm}px`, borderRadius: RADIUS.sm, border: "1px solid var(--danger)", color: "var(--danger-text, var(--text-primary))", fontSize: FONT_SIZE.control, fontWeight: 700 }}>
          Setbacks exceed parcel — no buildable area
        </div>
      )}
      <div style={topRow}>
        <span data-testid="setback-all" style={{ display: "contents", fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
          <span style={{ fontWeight: 700 }}>Building</span>
          {renderNum(common == null ? 0 : Math.round(common), (v) => onSetAll(v), "Building setback — all sections")}
          <span style={{ color: "var(--text-secondary)", fontSize: FONT_SIZE.control }}>ft · all sections</span>
        </span>
        <label style={showLineLabel} title="Show the building setback line inside the parcel boundary">
          <input type="checkbox" checked={!!showLine} onChange={(e) => onShowLine(e.target.checked)} data-testid="setback-show-line" /> Show line
        </label>
        <span />
      {hasPaving ? (
        <>
          <span data-testid="paving-all" style={{ display: "contents", fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
            <span style={{ fontWeight: 700 }}>Paving</span>
            {renderNum(pavingSummary.common == null ? 0 : Math.round(pavingSummary.common), (v) => paving.onSetAll(v), "Paving setback — all sections")}
            <span style={{ color: "var(--text-secondary)", fontSize: FONT_SIZE.control }}>ft · all sections</span>
          </span>
          <label style={showLineLabel} title="Show the paving setback line inside the parcel boundary">
            <input type="checkbox" checked={!!paving.showLine} onChange={(e) => paving.onShowLine(e.target.checked)} data-testid="paving-show-line" /> Show line
          </label>
          <button type="button" onClick={paving.onRemove} data-testid="paving-remove" aria-label="Remove paving setback" title="Remove the paving setback"
            style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, padding: 0, border: "none", background: "transparent", color: "var(--text-secondary)", cursor: "pointer" }}>
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4 H13 M6 4 V2.5 H10 V4 M4.5 4 L5.3 14 H10.7 L11.5 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>
          </button>
        </>
      ) : onAddPaving ? (
        <div style={{ gridColumn: "1 / -1" }}>
          <button type="button" onClick={onAddPaving} data-testid="paving-add" style={{ ...linkBtn, display: "inline-flex", alignItems: "center", gap: SPACE.xs }}>
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2 V12 M2 7 H12" stroke="currentColor" strokeWidth="1.8" /></svg>
            Add paving setback
          </button>
        </div>
      ) : null}
      </div>
      {hasPaving && (
        <div role="group" aria-label="Sketch shows" data-testid="setback-mode" style={{ display: "flex", justifyContent: "center", marginBottom: SPACE.xs }}>
          <span style={{ display: "inline-flex", border: "1px solid var(--border-default, var(--text-secondary))", borderRadius: RADIUS.sm, overflow: "hidden" }}>
            {[["building", "Building"], ["paving", "Paving"]].map(([k, text], j) => (
              <button key={k} type="button" aria-pressed={mode === k} data-testid={`setback-mode-${k}`} onClick={() => setMode(k)}
                style={{ padding: `${SPACE.xs}px ${SPACE.lg}px`, border: "none", borderLeft: j ? "1px solid var(--border-default, var(--text-secondary))" : "none", background: mode === k ? "var(--surface-selected)" : "transparent", color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: mode === k ? 700 : 600, cursor: "pointer" }}>{text}</button>
            ))}
          </span>
        </div>
      )}
      <Sketch points={points} sections={sections} selectedKey={selectedKey} hoverKey={hoverKey} editing={editing} onSelect={onSelect} onHover={setHoverKey} onVertex={onToggleVertex} labelFor={labelFor}
        ariaLabel={mode === "paving" ? "Parcel outline split into sections, labelled with paving setback values" : hasPaving ? "Parcel outline split into sections, labelled with building setback values" : undefined} />
      {/* directly under the sketch, so it never moves down with the number of rows below (no scrolling to fix a grouping) */}
      <div style={{ marginTop: SPACE.xs }}>
        <button type="button" onClick={() => setEditing((o) => !o)} aria-pressed={editing} data-testid="setback-split-join" style={linkBtn}>{editing ? "Done splitting or joining" : "Split or join sections"}</button>
        {editing && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: SPACE.xs }}>Click a corner dot: a filled dot is a break — click it to join; a hollow one to split there.</div>}
      </div>
      {hasRows && (
        <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs, marginTop: SPACE.sm }}>
          {hasPaving && (
            <div data-testid="setback-col-heads" style={{ display: "grid", gridTemplateColumns: "10px minmax(0, 1fr) auto auto auto", columnGap: SPACE.md, padding: `0 ${SPACE.sm}px`, alignItems: "center" }}>
              <span /><span />
              <span style={colHead}>Building</span>
              <span style={colHead}>Paving</span>
              <span style={{ fontSize: FONT_SIZE.label, visibility: "hidden" }}>ft</span>
            </div>
          )}
          {selected && row(selected)}
          {shown.map(row)}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SPACE.lg, marginTop: SPACE.md }}>
        <button type="button" onClick={onResetAll} data-testid="setback-reset"
          style={{ padding: 0, border: "none", background: "transparent", color: "var(--text-secondary)", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, cursor: "pointer" }}>{resetLabel}</button>
      </div>
    </div>
  );
}
