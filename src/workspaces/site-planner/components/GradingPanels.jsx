/* Grading panels (owner-only; loaded on demand — see lib/gradingGate.js). Presentational: every number and
 * every sentence comes from the model GradingController publishes (and lib/buildingGrade.js), and every
 * action is a callback into SitePlanner's EXISTING edit paths — this file computes no grading itself.
 *
 *   GroundSection — "Level ground at 2:1, no walls" + relief + steepness, in Site Analysis under Jurisdiction.
 *   BuildingTab   — the selected building's grading controls, as the Site Analysis "Building" tab.
 *   GradingTabs   — the Analysis | Building tab strip.
 *   GradingCanvas — spot elevations, fall arrows, the setback-breach dot (SVG, inside the plan canvas).
 *
 * Module-scope components only (MODULE-SCOPE-COMPONENTS). Colours are theme tokens; the SVG half takes its
 * hex from the planner's PAL (SVG attributes cannot use var()). */
import React, { useEffect, useState } from "react";
import { Button, ToggleChip, Tab, SegmentedControl } from "../../../shared/ui/controls.jsx";
import RowInfo from "../../../shared/ui/RowInfo.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { BASES, basisNote, netLabel } from "../lib/buildingGrade.js";
import { SLOPE_RATIOS } from "../lib/gradingBase.js";

const sectionLabel = {
  fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)",
};
const muted = { color: "var(--text-secondary)", fontSize: FONT_SIZE.label };
const linkBtn = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit",
  fontSize: FONT_SIZE.label, fontWeight: 650, color: "var(--accent-site-text)", textDecoration: "underline",
};
const TONE = {
  green: { ink: "var(--success-text)", bar: "var(--success-text)" },
  amber: { ink: "var(--warn-text)", bar: "var(--warn-text)" },
  red: { ink: "var(--danger-text)", bar: "var(--danger)" },
};
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const f0 = (v) => Math.round(v).toLocaleString("en-US");

/* A number field that follows the editor-exit contract (text class): Enter / Tab / click-away COMMIT, Escape
 * abandons what was typed. `commit(null)` for an emptied field when `allowClear`. */
function NumField({ value, onCommit, min = null, max = null, step = 0.5, width = 72, unit = null, placeholder = "", allowClear = false, testid, ariaLabel, disabled = false }) {
  const [txt, setTxt] = useState(value == null ? "" : String(value));
  useEffect(() => { setTxt(value == null ? "" : String(value)); }, [value]);
  const commit = () => {
    if (txt.trim() === "") { if (allowClear && value != null) onCommit(null); else setTxt(value == null ? "" : String(value)); return; }
    let n = Number(txt);
    if (!Number.isFinite(n)) { setTxt(value == null ? "" : String(value)); return; }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onCommit(n); else setTxt(String(n));
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input type="number" inputMode="decimal" step={step} value={txt} placeholder={placeholder} disabled={disabled}
        data-testid={testid} aria-label={ariaLabel}
        onChange={(e) => setTxt(e.target.value)} onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTxt(value == null ? "" : String(value)); e.currentTarget.blur(); }
        }}
        style={{ width, boxSizing: "border-box", padding: "3px 6px", fontFamily: "inherit", fontSize: FONT_SIZE.control, textAlign: "right",
          color: "var(--text-primary)", background: "var(--surface-field)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm }} />
      {unit && <span style={muted}>{unit}</span>}
    </span>
  );
}

function Pill({ tone, children, ...rest }) {
  const t = TONE[tone] || TONE.amber;
  return (
    <span {...rest} style={{ padding: "1px 7px", borderRadius: RADIUS.pill, border: `1px solid ${t.ink}`, color: t.ink, fontSize: FONT_SIZE.micro, fontWeight: 700, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------- Ground */
export function GroundSection({ model, onShowBuildable }) {
  const { ground, cfg, setback } = model;
  const sum = ground.summary;
  const body = (() => {
    if (ground.status === "failed" || model.demStatus === "failed") {
      return (
        <div data-ground-state="failed" style={{ color: "var(--warn-text)" }}>
          Couldn't read the ground.{" "}
          <button type="button" style={linkBtn} onClick={() => { if (model.demStatus === "failed" && model.retryDem) model.retryDem(); ground.retry(); }}>↻ Retry</button>
        </div>
      );
    }
    if (!sum || !sum.best) {
      return <div data-ground-state="computing" style={muted}>{ground.status === "idle" ? "Waiting for the ground model…" : "Reading the ground…"}</div>;
    }
    const sev = sum.severity;
    const tone = TONE[sev ? sev.tone : "amber"];
    return (
      <div data-ground-state="ready" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <div data-ground-row="level" style={{ borderLeft: `3px solid ${tone.bar}`, padding: "6px 0 6px 10px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontWeight: 700 }}>Level ground at {cfg.slopeRatio}:1, no walls</span>
            <span style={{ display: "inline-flex", alignItems: "baseline", gap: 6, whiteSpace: "nowrap" }}>
              <span data-ground-figure="1" style={{ fontWeight: 700, color: tone.ink }}>{f1(sum.best.areaAc)} of {f1(sum.parcelAc)} AC</span>
              {sev && <Pill tone={sev.tone} data-ground-severity={sev.id}>{sev.label}</Pill>}
            </span>
          </div>
          <div style={muted}>best single pad, finish {sum.best.E} ft · no more than {cfg.maxCutFillFt} ft of cut or fill</div>
        </div>
        <div data-ground-row="relief" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "0 0 0 13px" }}>
          <span>Relief across the parcel</span>
          <span style={{ fontWeight: 600 }}>{Math.round(sum.relief.reliefFt)} ft · {Math.round(sum.relief.lowFt)} to {Math.round(sum.relief.highFt)}</span>
        </div>
        <div data-ground-row="steep" style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "0 0 0 13px" }}>
          <span>Ground steeper than 15%</span>
          <span style={{ fontWeight: 600 }}>{sum.relief.steepShare == null ? "—" : `${Math.round(sum.relief.steepShare * 100)}%`}</span>
        </div>
        <div>
          <Button variant="secondary" size="sm" data-ground-show-buildable="1" onClick={onShowBuildable}>Show buildable area on map</Button>
        </div>
      </div>
    );
  })();
  return (
    <div data-section="ground" style={{ borderBottom: "1px solid var(--planner-border)", padding: "10px 0", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={sectionLabel}>Ground</span>
        <RowInfo label="Ground" sections={[
          { text: "Ground heights: USGS 3DEP bare-earth LiDAR, sampled every 10 ft. A pad counts only inside the setback, with the cut-or-fill limit and slope you set on the Building tab, and the slope off its edge must meet existing ground before the setback line. Bank volumes, no retaining walls. Screening only." },
          { text: setback && setback.usingPropertyLine ? "No setback drawn, using the property line." : "Measured to your parcel setback lines." },
        ]} />
      </div>
      {body}
    </div>
  );
}

/* ---------------------------------------------------------------- tabs */
export function GradingTabs({ tab, onTab, showBuilding, children }) {
  return (
    <div data-grading-tabs="1" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {showBuilding && (
        <div role="tablist" style={{ display: "flex", height: 30, borderBottom: "1px solid var(--planner-border)" }}>
          <Tab active={tab === "analysis"} data-grading-tab="analysis" role="tab" aria-selected={tab === "analysis"} onClick={() => onTab("analysis")}>Analysis</Tab>
          <Tab active={tab === "building"} data-grading-tab="building" role="tab" aria-selected={tab === "building"} onClick={() => onTab("building")}>Building</Tab>
        </div>
      )}
      {children}
    </div>
  );
}

/* ---------------------------------------------------------------- Building tab */
function Row({ label, children, hint }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 26 }}>
      <span style={{ minWidth: 0 }}>{label}{hint && <span style={{ ...muted, display: "block" }}>{hint}</span>}</span>
      <span style={{ flex: "none" }}>{children}</span>
    </div>
  );
}
function Tile({ tone, value, label, testid }) {
  return (
    <div data-grading-tile={testid} style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "6px 8px", background: "var(--surface-field)" }}>
      <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: tone, fontVariantNumeric: "tabular-nums" }}>{value}</div>
      <div style={muted}>{label}</div>
    </div>
  );
}
const WALL_ROLE = { dock: "Dock wall", rear: "Rear wall", ends: "End wall", sides: "Side wall" };

export function BuildingTab({ model, renderNumber, wallRows = [], dockDropFt, onCfg, onDockDrop, onApplyFfeFix, onApplyMoveFix }) {
  const b = model.building;
  const cfg = model.cfg;
  if (!b) return <div style={muted}>Select a building to see its grading.</div>;
  const e = b.earthwork;
  const flag = b.flag;
  const fx = b.fixes;
  const noSetback = model.setback && model.setback.usingPropertyLine;
  return (
    <div data-building-grade-tab="1" style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: FONT_SIZE.display, fontWeight: 700 }}>Building</span>
          {renderNumber}
        </div>
        {b.extra > 0 && <div data-multi-note="1" style={muted}>{b.extra + 1} buildings selected, showing the first.</div>}
        {noSetback && <div style={muted}>No setback drawn, using the property line.</div>}
      </div>

      {wallRows.length > 0 && (
        <div data-section="walls" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={sectionLabel}>Walls</span>
          {wallRows.map((r) => (
            <div key={r.key} data-wall-row={r.key} style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span data-wall-compass="1" style={{ minWidth: 26, textAlign: "center", fontWeight: 700, fontSize: FONT_SIZE.label, border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm, padding: "0 4px" }}>{r.badge}</span>
              <span style={{ color: "var(--text-secondary)", minWidth: 62 }}>{WALL_ROLE[r.role] || r.role}</span>
              <span style={{ minWidth: 0 }}>{r.layers.length ? r.layers.map((l) => `${l.label} ${Math.round(l.depth)}′`).join(" · ") : <span style={muted}>nothing</span>}</span>
            </div>
          ))}
          <span style={muted}>Edit walls in the Building panel.</span>
        </div>
      )}

      <div data-section="elevations" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <span style={sectionLabel}>Elevations</span>
        <Row label="Finished floor (FFE)">
          <NumField value={b.ffe} step={0.5} width={84} unit="ft" allowClear testid="grading-ffe" ariaLabel="Finished floor elevation" onCommit={(v) => model.actions.typeFfe(v)} />
        </Row>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {BASES.map((c) => (
            <ToggleChip key={c.id} data-ffe-basis={c.id} aria-pressed={b.basis === c.id} active={b.basis === c.id} disabled={!!b.solving} onClick={() => model.actions.pickBasis(c.id)}>
              {b.solving === c.id ? "Solving…" : c.label}
            </ToggleChip>
          ))}
        </div>
        <div data-ffe-note="1" style={muted}>
          {b.ffe == null ? "Pick a chip to let the ground choose." : basisNote(b.basis, { netCy: e ? e.netCy : null, dirtCy: e ? e.dirtCy : null, bestFinish: model.bestFinish })}
        </div>
        <Row label="Dock drop"><NumField value={dockDropFt} min={0} step={0.5} unit="ft" testid="grading-dock-drop" ariaLabel="Dock drop" onCommit={(v) => onDockDrop(v)} /></Row>
        <Row label="Pavement slope"><NumField value={cfg.pavementSlopePct} min={0.5} step={0.1} unit="%" testid="grading-pavement-slope" ariaLabel="Pavement slope" onCommit={(v) => onCfg({ pavementSlopePct: v })} /></Row>
        <Row label="Truck court, dock face → far edge">
          <span data-court-drop="1" style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{b.courtDrop || "—"}</span>
        </Row>
        <Row label="Max cut or fill under a pad"><NumField value={cfg.maxCutFillFt} min={1} step={1} unit="ft" testid="grading-max-depth" ariaLabel="Max cut or fill under a pad" onCommit={(v) => onCfg({ maxCutFillFt: v })} /></Row>
        <Row label="Grading slopes">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <SegmentedControl options={SLOPE_RATIOS.map((r) => ({ key: r, label: `${r}:1` }))} value={cfg.slopeRatio} onChange={(v) => onCfg({ slopeRatio: v })} />
            <Pill tone="green">no walls · 5 ft shoulder</Pill>
          </span>
        </Row>
      </div>

      <div data-section="earthwork" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={sectionLabel}>Earthwork</span>
        {e ? (
          <>
            <div style={{ display: "flex", gap: 6 }}>
              <Tile testid="cut" tone="var(--warn-text)" value={f0(e.cutCy)} label="CY cut" />
              <Tile testid="fill" tone="var(--info-text)" value={f0(e.fillCy)} label="CY fill" />
              <Tile testid="net" tone={e.balanced ? "var(--success-text)" : "var(--text-primary)"} value={f0(Math.abs(e.netCy))} label={netLabel(e.netCy)} />
            </div>
            <span style={muted}>Bank volumes, no stripping or shrink.</span>
          </>
        ) : <span style={muted}>{b.noSurface ? "Pick a finish elevation to price the earthwork." : "Reading the ground…"}</span>}
      </div>

      {flag ? (
        <div data-grading-flag="1" role="alert" style={{ border: "1px solid var(--danger)", borderLeft: "4px solid var(--danger)", borderRadius: RADIUS.md, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, background: "var(--surface-field)" }}>
          <div style={{ fontWeight: 700, color: "var(--danger-text)" }}>{flag.text.title}</div>
          <div>{flag.text.body}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {fx.status === "computing" && <span style={muted}>Looking for a fix…</span>}
            <Button variant="secondary" size="sm" data-fix="ffe" disabled={!(fx.ffe)} onClick={() => fx.ffe && onApplyFfeFix(fx.ffe)}>
              {fx.status === "computing" ? "Finding a finish elevation…" : fx.ffe ? `${fx.ffe.delta > 0 ? "Raise" : "Lower"} FFE to ${f1(fx.ffe.ffe)} ft` : "No finish elevation clears it"}
            </Button>
            <Button variant="secondary" size="sm" data-fix="move" disabled={!(fx.move)} onClick={() => fx.move && onApplyMoveFix(fx.move)}>
              {fx.status === "computing" ? "Finding a move…" : fx.move ? `Move building ${fx.move.distFt} ft ${fx.move.direction}` : "No move within 240 ft clears it"}
            </Button>
            <Button variant="secondary" size="sm" data-fix="wall" disabled>Allow a wall on that edge · later</Button>
          </div>
        </div>
      ) : (
        e && <div data-grading-flag="clear" style={{ color: "var(--success-text)", fontSize: FONT_SIZE.label }}>Slopes daylight inside the setback.</div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- canvas */
const PILL_H = 14;
function Pill2({ x, y, text, PAL, fill = null, stroke = null }) {
  const w = Math.max(18, text.length * 5.7 + 8);
  return (
    <g data-grade-pill="1">
      <rect x={x - w / 2} y={y - PILL_H / 2} width={w} height={PILL_H} rx={3} fill={fill || PAL.panelBg} stroke={stroke || PAL.panelLine} strokeWidth={0.75} />
      <text x={x} y={y + 3.4} textAnchor="middle" fontSize={9.5} fontWeight={700} fill={PAL.ink} style={{ fontFamily: "ui-monospace, monospace" }}>{text}</text>
    </g>
  );
}

/* The grading pictures + labels. Everything rides the planner's own feet→screen transform (`f2p`, `rppf`);
 * the pad/cut-fill images are single <image>s and the outlines one path each in feet space with a
 * non-scaling stroke, so a pan never recomputes a thing (VIEW-INDEPENDENT-ONCE). */
export function GradingCanvas({ model, f2p, rppf, PAL }) {
  const { buildable, cutfill, building, cfg } = model;
  const o = f2p({ x: 0, y: 0 });
  const feetG = (d, stroke, w, dash) => (
    <g transform={`translate(${o.x} ${o.y}) scale(${rppf})`}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={w} strokeDasharray={dash} strokeLinecap="butt" vectorEffect="non-scaling-stroke" />
    </g>
  );
  const img = (L, key) => {
    const tl = f2p({ x: L.bboxFt.x, y: L.bboxFt.y });
    return <image key={key} href={L.dataUrl} x={tl.x} y={tl.y} width={L.bboxFt.w * rppf} height={L.bboxFt.h * rppf} preserveAspectRatio="none" style={{ imageRendering: "pixelated" }} pointerEvents="none" />;
  };
  const showLabels = cfg.layers.cutfill && building;
  const px = (ft) => ft * rppf;
  return (
    <g data-grading-layers="1" pointerEvents="none">
      {buildable && buildable.dataUrl && <g data-layer="buildable">{img(buildable, "bimg")}{feetG(buildable.outlineD, PAL.accent, 1)}</g>}
      {cutfill && cutfill.dataUrl && <g data-layer="cutfill">{img(cutfill, "cimg")}{feetG(cutfill.outlineD, PAL.ink, 1.2, "1.5 3")}</g>}
      {showLabels && building.spots.map((sp) => {
        const depthPx = px(sp.depthFt);
        if (depthPx < 46) return null;                                   // too small to carry a label legibly
        const inset = Math.min(sp.depthFt * 0.22, 15 / rppf);
        const at = (a, b) => f2p(sp.world(a, b));
        const fp = at(sp.face.a + inset, sp.face.b);
        return (
          <g key={sp.elId} data-spot-set={sp.elId}>
            <Pill2 x={fp.x} y={fp.y} text={sp.face.label} PAL={PAL} />
            {sp.stations.map((st, i) => {
              const a = at(st.from, st.b), z = at(st.to, st.b);
              const ang = Math.atan2(z.y - a.y, z.x - a.x), h = 5;
              const head = `${z.x},${z.y} ${z.x - h * Math.cos(ang - 0.45)},${z.y - h * Math.sin(ang - 0.45)} ${z.x - h * Math.cos(ang + 0.45)},${z.y - h * Math.sin(ang + 0.45)}`;
              const far = at(sp.stations[i].far.a - inset, st.b);
              return (
                <g key={i} data-station={i}>
                  <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={PAL.ink} strokeWidth={1.2} />
                  <polygon points={head} fill={PAL.ink} />
                  <Pill2 x={far.x} y={far.y} text={st.far.label} PAL={PAL} />
                </g>
              );
            })}
            {sp.tag && (() => {
              // beside the middle arrow: nudged along the wall so it never sits on the arrow itself
              const t = at(sp.tag.a, sp.tag.b + Math.min(26 / rppf, sp.widthFt * 0.12));
              return <Pill2 x={t.x} y={t.y} text={sp.tag.text} PAL={PAL} />;
            })()}
          </g>
        );
      })}
      {cfg.layers.cutfill && building && building.flagDot && (() => {
        const d = f2p(building.flagDot.pt);
        return (
          <g data-flag-dot="1">
            <circle cx={d.x} cy={d.y} r={5} fill={PAL.danger} stroke={PAL.paper} strokeWidth={1.2} />
            <Pill2 x={d.x} y={d.y - 16} text={building.flagDot.text} PAL={PAL} stroke={PAL.danger} />
          </g>
        );
      })()}
    </g>
  );
}

