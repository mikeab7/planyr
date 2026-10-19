/* Grading panels (owner-only; loaded on demand — see lib/gradingGate.js). Presentational: every number and
 * every sentence comes from the model GradingController publishes (and lib/buildingGrade.js / lib/ffeSuggest.js),
 * and every action is a callback into SitePlanner's EXISTING edit paths — this file computes no grading itself.
 *
 *   GradingPanel  — the left-dock Grading panel (beside Drainage and Yield): one compact card per building (FFE
 *                   suggested, never asked), then GroundSection under it; the ⓘ + gear ride the panel header
 *                   (GradingHeaderActions). Site Analysis carries NONE of this.
 *   GroundSection — "Level ground at 2:1, no walls" + relief + steepness + the show-on-map button.
 *   GradingCanvas — the slope bands, daylight line, level-pad line, spot elevations, corner pills, the
 *                   setback-breach dot (SVG, inside the plan canvas).
 *
 * Module-scope components only (MODULE-SCOPE-COMPONENTS). Colours are theme tokens; the SVG half takes its
 * hex from the planner's PAL (SVG attributes cannot use var()). */
import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, SegmentedControl, IconButton } from "../../../shared/ui/controls.jsx";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle } from "../../../shared/ui/controls.jsx";
import RowInfo from "../../../shared/ui/RowInfo.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { SLOPE_RATIOS } from "../lib/gradingBase.js";
import { fmtCyShort, netWord } from "../lib/ffeSuggest.js";
import { fmtSf } from "../../../shared/units/areaUnits.js";
import { gradingPanelView } from "../lib/gradingPanelModel.js";

const sectionLabel = {
  fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)",
};
const muted = { color: "var(--text-secondary)", fontSize: FONT_SIZE.label };
const linkBtn = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit",
  fontSize: FONT_SIZE.label, fontWeight: 650, color: "var(--accent-site-text)", textDecoration: "underline", textAlign: "left",
};
const TONE = {
  green: { ink: "var(--success-text)", bar: "var(--success-text)" },
  amber: { ink: "var(--warn-text)", bar: "var(--warn-text)" },
  red: { ink: "var(--danger-text)", bar: "var(--danger)" },
};
const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const f100 = (v) => (Math.round(v / 100) * 100).toLocaleString("en-US");

/* A number field that follows the editor-exit contract (text class): Enter / Tab / click-away COMMIT, Escape
 * abandons what was typed. `commit(null)` for an emptied field when `allowClear`. */
function NumField({ value, onCommit, min = null, max = null, step = 0.5, width = 72, unit = null, placeholder = "", allowClear = false, testid, ariaLabel, disabled = false, autoFocus = false, onDone = null, tone = "var(--text-primary)" }) {
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
      <input type="number" inputMode="decimal" step={step} value={txt} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus}
        data-testid={testid} aria-label={ariaLabel}
        onChange={(e) => setTxt(e.target.value)} onBlur={() => { commit(); if (onDone) onDone(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTxt(value == null ? "" : String(value)); e.currentTarget.blur(); }
        }}
        style={{ width, boxSizing: "border-box", padding: "3px 6px", fontFamily: "inherit", fontSize: FONT_SIZE.control, textAlign: "right",
          color: tone, background: "var(--surface-field)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm }} />
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
export function GroundSection({ model, onToggleBuildable, buildableOn = false }) {
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
          <Button variant="secondary" size="sm" data-ground-show-buildable="1" aria-pressed={buildableOn} onClick={onToggleBuildable}>
            {buildableOn ? "Hide" : "Show buildable area on map"}
          </Button>
        </div>
      </div>
    );
  })();
  return (
    <div data-section="ground" style={{ borderBottom: "1px solid var(--planner-border)", padding: "10px 0", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={sectionLabel}>Ground</span>
        <RowInfo label="Ground" sections={[
          { text: "Ground heights: USGS 3DEP bare-earth LiDAR, sampled every 10 ft. A pad counts only inside the setback, with the cut-or-fill limit and slope set in Grading settings, and the slope off its edge must meet existing ground before the setback line. Bank volumes, no retaining walls. Screening only." },
          { text: setback && setback.usingPropertyLine ? "No setback drawn, using the property line." : "Measured to your parcel setback lines." },
        ]} />
      </div>
      {body}
    </div>
  );
}

/* ---------------------------------------------------------------- Grading group */
function Row({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 26 }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      <span style={{ flex: "none" }}>{children}</span>
    </div>
  );
}

/* The settings popover behind the group's gear: pavement slope, dock drop, max cut or fill under a pad, grading
 * slope and the shoulder. None of it is visible in a card. */
function GradingSettings({ model, dockDropFt, onCfg, onDockDrop }) {
  const cfg = model.cfg;
  const rock = model.rock || { status: "idle" };
  const rockLine = rock.status === "ready" ? (rock.count ? `Rock check: ${rock.count} soil map unit${rock.count > 1 ? "s" : ""} with shallow rock nearby, cuts kept 2 ft clear of it.` : "Rock check: no shallow rock recorded here.")
    : rock.status === "failed" ? null : "Rock check: reading the soil map…";
  return (
    <div data-grading-settings="1" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
      <span style={sectionLabel}>Grading settings</span>
      <Row label="Pavement slope"><NumField value={cfg.pavementSlopePct} min={0.5} step={0.1} unit="%" testid="grading-pavement-slope" ariaLabel="Pavement slope" onCommit={(v) => onCfg({ pavementSlopePct: v })} /></Row>
      <Row label="Dock drop"><NumField value={dockDropFt} min={0} step={0.5} unit="ft" testid="grading-dock-drop" ariaLabel="Dock drop" onCommit={(v) => onDockDrop(v)} /></Row>
      <Row label="Max cut or fill under a pad"><NumField value={cfg.maxCutFillFt} min={1} step={1} unit="ft" testid="grading-max-depth" ariaLabel="Max cut or fill under a pad" onCommit={(v) => onCfg({ maxCutFillFt: v })} /></Row>
      <Row label="Grading slopes">
        <SegmentedControl options={SLOPE_RATIOS.map((r) => ({ key: r, label: `${r}:1` }))} value={cfg.slopeRatio} onChange={(v) => onCfg({ slopeRatio: v })} />
      </Row>
      <span style={muted}>No walls · 5 ft shoulder before the slope starts. Bank volumes.</span>
      {rockLine && <span data-rock-status={rock.status} style={muted}>{rockLine}</span>}
      {rock.status === "failed" && (
        <span data-rock-status="failed" style={{ ...muted, color: "var(--warn-text)" }}>
          Rock check: couldn't read the soil map, so cuts aren't checked against rock.{" "}
          <button type="button" style={linkBtn} onClick={rock.retry}>↻ Retry</button>
        </span>
      )}
    </div>
  );
}

/* The FFE line: grey when auto (click to type your own), black when typed with a small "auto" chip that resets. */
function FfeLine({ c, actions }) {
  const [editing, setEditing] = useState(false);
  const shown = c.ffe == null ? (c.failed ? "—" : "…") : f1(c.ffe);
  const showField = editing || !c.isAuto;          // auto reads as ONE grey phrase, "FFE 799.8 ft"; a typed value gets its label and field
  return (
    <div data-grading-ffe-line="1" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, minHeight: 26 }}>
      {showField ? <span>FFE</span> : <span />}
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {showField ? (
          <NumField value={c.ffe} step={0.5} width={84} unit="ft" allowClear testid="grading-ffe" ariaLabel="Finished floor elevation"
            autoFocus={editing} onDone={() => setEditing(false)} tone="var(--text-primary)"
            onCommit={(v) => (v == null ? actions.resetFfe(c.id) : actions.typeFfe(c.id, v))} />
        ) : (
          <button type="button" data-ffe-value="auto" title="Suggested. Click to type your own." onClick={() => c.ffe != null && setEditing(true)}
            style={{ border: "none", background: "transparent", padding: 0, cursor: c.ffe != null ? "text" : "default", fontFamily: "inherit", fontSize: FONT_SIZE.control, color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            FFE {shown} ft
          </button>
        )}
        {c.isAuto
          ? <span data-ffe-source="auto" style={{ ...muted, fontSize: FONT_SIZE.micro }}>auto</span>
          : <button type="button" data-ffe-source="typed" data-ffe-reset="1" title="Back to the suggested finish elevation" onClick={() => actions.resetFfe(c.id)}
              style={{ cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.micro, padding: "1px 8px", borderRadius: RADIUS.pill, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-secondary)" }}>auto</button>}
      </span>
    </div>
  );
}

function FlagCard({ c, onApplyFfeFix, onApplyMoveFix }) {
  const flag = c.flag;
  const fx = c.fixes || { status: "idle", ffe: null, move: null };
  return (
    <div data-grading-flag="1" role="alert" style={{ border: "1px solid var(--danger)", borderLeft: "4px solid var(--danger)", borderRadius: RADIUS.md, padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, background: "var(--surface-field)" }}>
      <div style={{ fontWeight: 700, color: "var(--danger-text)" }}>{flag.text.title}</div>
      <div>{flag.text.body}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {fx.status === "computing" && <span style={muted}>Looking for a fix…</span>}
        <Button variant="secondary" size="sm" data-fix="ffe" disabled={!(fx.ffe)} onClick={() => fx.ffe && onApplyFfeFix(c.id, fx.ffe)}>
          {fx.status === "computing" ? "Finding a finish elevation…" : fx.ffe ? `${fx.ffe.delta > 0 ? "Raise" : "Lower"} FFE to ${f1(fx.ffe.ffe)} ft` : "No finish elevation clears it"}
        </Button>
        <Button variant="secondary" size="sm" data-fix="move" disabled={!(fx.move)} onClick={() => fx.move && onApplyMoveFix(c.id, fx.move)}>
          {fx.status === "computing" ? "Finding a move…" : fx.move ? `Move building ${fx.move.distFt} ft ${fx.move.direction}` : "No move within 240 ft clears it"}
        </Button>
        <Button variant="secondary" size="sm" data-fix="wall" disabled>Allow a wall on that edge · later</Button>
      </div>
    </div>
  );
}

function BuildingCard({ c, model, onSelect, onApplyFfeFix, onApplyMoveFix }) {
  const e = c.earthwork;
  if (!c.focus) {
    return (
      <button type="button" data-grading-card={c.id} data-card-state="collapsed" onClick={() => onSelect(c.id)}
        style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, color: "var(--text-primary)", background: "transparent", border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "6px 10px" }}>
        <span style={{ fontWeight: 650 }}>{c.name} · {fmtSf(c.sf)}</span>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
          {c.flag && <span title={c.flag.text.title} style={{ color: "var(--danger-text)", fontWeight: 700 }}>!</span>}
          <span>{c.ffe == null ? (c.failed ? "FFE —" : "FFE …") : `FFE ${f1(c.ffe)} ft`}</span>
        </span>
      </button>
    );
  }
  const alt = c.alt;
  return (
    <div data-grading-card={c.id} data-card-state="open"
      style={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--border-default)", borderLeft: "3px solid var(--accent-site-text)", borderRadius: RADIUS.md, padding: "8px 10px", background: "var(--surface-field)", fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
      <div data-card-title="1" style={{ fontWeight: 700 }}>{c.name} · {fmtSf(c.sf)}</div>
      <FfeLine c={c} actions={model.actions} />
      {model.demStatus === "failed"
        ? <div data-ffe-note="1" style={{ ...muted, color: "var(--warn-text)" }}>Couldn't read the ground, so there is no suggestion yet.</div>
        : <div data-ffe-note="1" style={muted}>{c.ffe == null ? (c.failed ? "The ground can't be priced here yet." : "Reading the ground…") : c.basis}</div>}
      {alt && (
        <div>
          <button type="button" data-alt-ffe={alt.E} style={linkBtn} onClick={() => model.actions.typeFfe(c.id, alt.E)}>
            Or sit it on the most level ground: FFE {f1(alt.E).replace(/\.0$/, "")} ({Math.round(alt.areaAc)} AC stays level, {fmtCyShort(alt.netCy)} CY {netWord(alt.netCy)})
          </button>
        </div>
      )}
      {e
        ? <div data-grading-earthwork="1" style={{ fontVariantNumeric: "tabular-nums" }}>
            Cut {f100(e.cutCy)} · Fill {f100(e.fillCy)} · {netWord(e.netCy) === "balanced" ? "Balanced" : `${f100(Math.abs(e.netCy))} CY ${netWord(e.netCy)}`}
          </div>
        : <div data-grading-earthwork="pending" style={muted}>{c.ffe == null ? "…" : "Reading the ground…"}</div>}
      {c.flag
        ? <FlagCard c={c} onApplyFfeFix={onApplyFfeFix} onApplyMoveFix={onApplyMoveFix} />
        : e && <div data-grading-flag="clear" style={{ color: "var(--success-text)", fontSize: FONT_SIZE.label }}>Slopes daylight inside the setback.</div>}
    </div>
  );
}

/* The header's own actions: the ⓘ and the gear (settings popover). Rendered INTO the panel chrome's action slot, beside the
 * ✕ — the cards below carry no settings. */
export function GradingHeaderActions({ model, dockDropFt, onCfg, onDockDrop }) {
  const gearRef = useRef(null);
  const [open, setOpen] = useState(false);
  const noSetback = model.setback && model.setback.usingPropertyLine;
  return (
    <span data-grading-header-actions="1" onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: "none" }}>
      <RowInfo label="Grading" sections={[
        { text: "The finished floor is suggested for you: the dirt balanced on site, with the pond's spoil counted as fill, held out of rock, and the docks kept on the low side where the ground allows. Type your own number any time; the small auto chip takes it back." },
        { text: noSetback ? "No setback drawn, using the property line." : "Slopes are measured to your parcel setback lines." },
      ]} />
      <IconButton ref={gearRef} size={24} aria-label="Grading settings" aria-expanded={open} data-grading-gear="1" onClick={() => setOpen((o) => !o)}>⚙</IconButton>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={gearRef} placement="below-right" width={280} gap={6}
        panelStyle={{ ...menuPanelStyle, padding: "10px 12px" }}>
        <GradingSettings model={model} dockDropFt={dockDropFt} onCfg={onCfg} onDockDrop={onDockDrop} />
      </AnchoredMenu>
    </span>
  );
}

/* The left-dock Grading panel (NEW-1, amends B2315856): the per-building cards, then the three Ground rows + the
 * show-on-map button. It only READS `model` (published by the controller SitePlanner mounts whether or not this
 * panel is open); opening it starts no build. `headerSlot` is the panel chrome's action element (the ⓘ + gear portal there). */
export function GradingPanel({ model, headerSlot = null, dockDropFt, onCfg, onDockDrop, onSelectBuilding, onApplyFfeFix, onApplyMoveFix, onToggleBuildable, buildableOn = false }) {
  const view = gradingPanelView(model);
  return (
    <div data-testid="grading-panel" data-grading-panel={view.state} style={{ display: "flex", flexDirection: "column" }}>
      {model && headerSlot && createPortal(<GradingHeaderActions model={model} dockDropFt={dockDropFt} onCfg={onCfg} onDockDrop={onDockDrop} />, headerSlot)}
      <div data-section="grading" style={{ padding: "0 0 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        {view.state === "cards"
          ? view.cards.map((c) => (
              <BuildingCard key={c.id} c={c} model={model} onSelect={onSelectBuilding} onApplyFfeFix={onApplyFfeFix} onApplyMoveFix={onApplyMoveFix} />
            ))
          : <div data-grading-empty={view.state} style={muted}>{view.line}</div>}
      </div>
      {model && <GroundSection model={model} buildableOn={buildableOn} onToggleBuildable={onToggleBuildable} />}
    </div>
  );
}

/* ---------------------------------------------------------------- canvas */
export const LABELS_MIN_PX = 90;        // labels draw only when the building's shorter side is at least this many screen px
const PILL_H = 17;
function Pill2({ x, y, text, PAL, fill = null, stroke = null, size = 11 }) {
  const w = Math.max(22, text.length * (size * 0.6) + 10);
  return (
    <g data-grade-pill="1">
      <rect x={x - w / 2} y={y - PILL_H / 2} width={w} height={PILL_H} rx={4} fill={fill || PAL.panelBg} stroke={stroke || PAL.panelLine} strokeWidth={1} />
      <text x={x} y={y + size * 0.36} textAnchor="middle" fontSize={size} fontWeight={700} fill={PAL.ink} style={{ fontFamily: "ui-monospace, monospace" }}>{text}</text>
    </g>
  );
}

/* The grading pictures + labels. Everything rides the planner's own feet→screen transform (`f2p`, `rppf`);
 * the cut/fill image is a single <image> and the outlines one path each in feet space with a non-scaling
 * stroke, so a pan never recomputes a thing (VIEW-INDEPENDENT-ONCE). */
export function GradingCanvas({ model, f2p, rppf, PAL }) {
  const { buildable, cutfill, labels, cfg } = model;
  const o = f2p({ x: 0, y: 0 });
  const feetG = (d, stroke, w, dash, cap = "butt") => (
    <g transform={`translate(${o.x} ${o.y}) scale(${rppf})`}>
      <path d={d} fill="none" stroke={stroke} strokeWidth={w} strokeDasharray={dash} strokeLinecap={cap} vectorEffect="non-scaling-stroke" />
    </g>
  );
  const img = (L, key, smooth) => {
    const tl = f2p({ x: L.bboxFt.x, y: L.bboxFt.y });
    return <image key={key} href={L.dataUrl} x={tl.x} y={tl.y} width={L.bboxFt.w * rppf} height={L.bboxFt.h * rppf} preserveAspectRatio="none" style={{ imageRendering: smooth ? "auto" : "pixelated" }} pointerEvents="none" />;
  };
  const px = (ft) => ft * rppf;
  const showCutfillLabels = !!cfg.layers.cutfill;
  return (
    <g data-grading-layers="1" pointerEvents="none">
      {buildable && buildable.dataUrl && (
        <g data-layer="buildable">
          {img(buildable, "bimg", true)}
          {feetG(buildable.outlineD, PAL.accent, 1.5, "7 4")}
          {buildable.label && (() => { const p = f2p(buildable.label.pt); return <g data-buildable-label="1"><Pill2 x={p.x} y={p.y} text={buildable.label.text} PAL={PAL} stroke={PAL.accent} size={12} /></g>; })()}
        </g>
      )}
      {cutfill && cutfill.dataUrl && (
        <g data-layer="cutfill">
          {img(cutfill, "cimg", false)}
          {feetG(cutfill.outlineD, PAL.paper, 3.4, null)}
          {feetG(cutfill.outlineD, PAL.ink, 1.6, "1.5 3.5", "round")}
        </g>
      )}
      {showCutfillLabels && (labels || []).map((L) => {
        if (px(L.minSideFt) < LABELS_MIN_PX) return null;      // below the working zoom: bands and the daylight line only
        const c0 = f2p(L.centre);
        return (
          <g key={L.id} data-label-set={L.id}>
            {L.spots.map((sp) => {
              const depthPx = px(sp.depthFt);
              if (depthPx < 46) return null;                    // too small to carry a label legibly
              const inset = Math.min(sp.depthFt * 0.22, 15 / rppf);
              const at = (a, b) => f2p(sp.world(a, b));
              const fp = at(sp.face.a + inset, sp.face.b);
              return (
                <g key={sp.elId} data-spot-set={sp.elId}>
                  <Pill2 x={fp.x} y={fp.y} text={sp.face.label} PAL={PAL} />
                  {sp.stations.map((st, i) => {
                    const a = at(st.from, st.b), z = at(st.to, st.b);
                    const ang = Math.atan2(z.y - a.y, z.x - a.x), h = 6;
                    const head = `${z.x},${z.y} ${z.x - h * Math.cos(ang - 0.45)},${z.y - h * Math.sin(ang - 0.45)} ${z.x - h * Math.cos(ang + 0.45)},${z.y - h * Math.sin(ang + 0.45)}`;
                    const far = at(sp.stations[i].far.a - inset, st.b);
                    return (
                      <g key={i} data-station={i}>
                        <line x1={a.x} y1={a.y} x2={z.x} y2={z.y} stroke={PAL.ink} strokeWidth={1.6} />
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
            {L.corners.map((k, i) => {
              const p = f2p(k.pt);
              const dx = c0.x - p.x, dy = c0.y - p.y, d = Math.hypot(dx, dy) || 1;
              const inset = Math.min(26, d * 0.3);
              return <g key={i} data-pad-corner={k.kind}><Pill2 x={p.x + (dx / d) * inset} y={p.y + (dy / d) * inset} text={k.text} PAL={PAL} /></g>;
            })}
          </g>
        );
      })}
      {showCutfillLabels && (labels || []).map((L) => L.flagDot && (() => {
        const d = f2p(L.flagDot.pt);
        return (
          <g key={`fd${L.id}`} data-flag-dot="1">
            <circle cx={d.x} cy={d.y} r={5} fill={PAL.danger} stroke={PAL.paper} strokeWidth={1.2} />
            <Pill2 x={d.x} y={d.y - 16} text={L.flagDot.text} PAL={PAL} stroke={PAL.danger} />
          </g>
        );
      })())}
    </g>
  );
}
