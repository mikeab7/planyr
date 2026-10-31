/* Grading panels (owner-only; loaded on demand — see lib/gradingGate.js). Presentational: every number and
 * every sentence comes from the model GradingController publishes (and lib/gradingPanelModel.js), and every action is a callback
 * into SitePlanner's EXISTING edit paths — this file computes no grading itself.
 *
 *   GradingPanel  — the left-dock Grading panel, the APPROVED LAYOUT (NEW-1, owner 2026-10-31), top to bottom: inputs (the finished
 *                   floor — the ONLY place it is shown — , Limits of disturbance as ONE signed number off the property line, Slopes),
 *                   the HAUL / CUT / FILL tiles, threshold-only one-sentence flags, OTHER FLOORS TO TRY + the haul-by-floor curve,
 *                   ON THE MAP, GROUND. The On switch, ⓘ and gear ride the panel header (GradingHeaderActions).
 *   GroundSection — a severity pill, buildable acres and relief, the show-on-map button.
 *   GradingCanvas — the slope bands, daylight line, level-pad line, spot elevations, corner pills, the
 *                   setback-breach dot (SVG, inside the plan canvas); round 4: the grading limit's dashed line, the
 *                   proposed contours and the edit-outline highlight.
 *
 * Module-scope components only (MODULE-SCOPE-COMPONENTS). Colours are theme tokens; the SVG half takes its
 * hex from the planner's PAL (SVG attributes cannot use var()). */
import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, SegmentedControl, IconButton } from "../../../shared/ui/controls.jsx";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { menuPanelStyle } from "../../../shared/ui/controls.jsx";
import RowInfo from "../../../shared/ui/RowInfo.jsx";
import { PondSettingsIcon } from "./elementMenuIcons.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { SLOPE_RATIOS } from "../lib/gradingBase.js";
import { CUT_RGB, FILL_RGB, CONTOUR_PROPOSED_RGB, CONTOUR_PROPOSED_INDEX_RGB, LIMIT_LINE_DASH, GRADING_PAPER_RGB, placeContourLabels, planContourDraw } from "../lib/gradingPaint.js";
import { planAllContourLabels, pathToPieces, CONTOUR_LABEL_ALL } from "../lib/contourLabelPlan.js";
import { fmtCyShort } from "../lib/ffeSuggest.js";
import { placeCornerTag, pillWidth, CORNER_TAG_PILL_H } from "../lib/padCornerTag.js";
import { fmtSf } from "../../../shared/units/areaUnits.js";
import { gradingPanelView, limitOffsetFt, marginFromOffset, LIMIT_PAST_MAX_FT, ffePillText, groundNumbers, BALANCE_TOL_CY_PANEL } from "../lib/gradingPanelModel.js";
import { plainDec1 as f1 } from "../../../shared/units/numberFormat.js";

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
const pillStyle = { padding: "1px 7px", borderRadius: RADIUS.pill, border: "1px solid", fontSize: FONT_SIZE.micro, fontWeight: 700, whiteSpace: "nowrap" };

/* A number field that follows the editor-exit contract (text class): Enter / Tab / click-away COMMIT, Escape
 * abandons what was typed. `commit(null)` for an emptied field when `allowClear`. */
function NumField({ value, onCommit, min = null, max = null, step = 0.5, width = 72, unit = null, placeholder = "", allowClear = false, testid, ariaLabel, disabled = false, autoFocus = false, onDone = null, tone = "var(--text-primary)", signed = false, attrs = null }) {
  // `signed` (the limit of disturbance): a text box that shows "+20" / "-10" and accepts a typed leading plus or a real minus sign,
  // which a type=number box cannot (Chrome empties "+20"). Everything else is the plain number box.
  const show = (v) => (v == null ? "" : signed && v > 0 ? `+${v}` : String(v));
  const [txt, setTxt] = useState(show(value));
  useEffect(() => { setTxt(show(value)); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    if (txt.trim() === "") { if (allowClear && value != null) onCommit(null); else setTxt(show(value)); return; }
    let n = Number(signed ? txt.replace(/^\s*\+/, "").replace(/[−–]/g, "-") : txt);
    if (!Number.isFinite(n)) { setTxt(show(value)); return; }
    if (min != null) n = Math.max(min, n);
    if (max != null) n = Math.min(max, n);
    if (n !== value) onCommit(n); else setTxt(show(n));
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <input type={signed ? "text" : "number"} inputMode={signed ? "text" : "decimal"} step={signed ? undefined : step} value={txt} placeholder={placeholder} disabled={disabled} autoFocus={autoFocus}
        data-testid={testid} aria-label={ariaLabel} {...(attrs || {})}
        onChange={(e) => setTxt(e.target.value)} onBlur={() => { commit(); if (onDone) onDone(); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setTxt(show(value)); e.currentTarget.blur(); }
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

/* ---------------------------------------------------------------- the approved layout (NEW-1, owner 2026-10-31) */
function Row({ label, children }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, minHeight: 26 }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      <span style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>{children}</span>
    </div>
  );
}
const hairline = { borderTop: "1px solid var(--planner-border)" };
const blockStyle = { padding: "10px 0", display: "flex", flexDirection: "column", gap: 7 };
const inkOf = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;   // design-exempt: map ink — the legend swatches ARE the picture's own cut / fill colours (gradingPaint.CUT_RGB / FILL_RGB), which do not theme

/* The settings popover behind the gear: the numbers a civil sets once. The floor, the limit of disturbance and the slope ratio
 * live in the panel body now; the undisturbed buffer and the terrace depth live ONLY here. */
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
      <Row label="Fill or cut past which a terrace or wall is usual"><NumField value={cfg.terraceDepthFt} min={1} step={1} unit="ft" testid="grading-terrace-depth" ariaLabel="Fill or cut past which a terrace or wall is usual" onCommit={(v) => onCfg({ terraceDepthFt: v })} /></Row>
      <Row label="Shoulder past the pavement"><NumField value={cfg.shoulderFt} min={0} step={1} unit="ft" testid="grading-shoulder" ariaLabel="Shoulder past the pavement" onCommit={(v) => onCfg({ shoulderFt: v })} /></Row>
      <Row label="Limit corner radius"><NumField value={cfg.cornerRadiusFt} min={0} step={5} unit="ft" testid="grading-corner-radius" ariaLabel="Limit corner radius" onCommit={(v) => onCfg({ cornerRadiusFt: v })} /></Row>
      <Row label="Max pavement slope"><NumField value={cfg.maxPavementSlopePct} min={0.5} step={0.5} unit="%" testid="grading-max-pavement-slope" ariaLabel="Max pavement slope" onCommit={(v) => onCfg({ maxPavementSlopePct: v })} /></Row>
      <Row label="Open-ground slope"><NumField value={cfg.openGroundSlopePct} min={0} step={0.5} unit="%" testid="grading-open-ground-slope" ariaLabel="Open-ground slope" onCommit={(v) => onCfg({ openGroundSlopePct: v })} /></Row>
      <Row label="Undisturbed buffer"><NumField value={cfg.undisturbedBufferFt} min={0} step={5} unit="ft" testid="grading-undisturbed-buffer" ariaLabel="Undisturbed buffer along every property line" onCommit={(v) => onCfg({ undisturbedBufferFt: v })} /></Row>
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

/* The header's own actions: the On switch (always), then the ⓘ and the gear once there is a model. Rendered INTO the panel chrome's
 * action slot, beside the pop-out and the ✕. */
export function GradingHeaderActions({ model, planOn = true, onPlanOn = null, dockDropFt, onCfg, onDockDrop }) {
  const gearRef = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <span data-grading-header-actions="1" onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "none" }}>
      <label style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer", fontSize: FONT_SIZE.label, fontWeight: 650, color: "var(--text-primary)" }}>
        <input type="checkbox" role="switch" data-testid="grading-plan-switch" aria-label="Grade this plan" checked={!!planOn} onChange={(e) => onPlanOn && onPlanOn(e.target.checked)} /> On
      </label>
      {model && (
        <>
          <RowInfo label="Grading" sections={[
            { text: "The finished floor is suggested for you: the dirt balanced on site, with the pond's spoil counted as fill, held out of rock, and the docks kept on the low side where the ground allows. Type your own number any time; the AUTO pill takes it back." },
            { text: "Limits of disturbance is how far from the property line the grading may reach: negative is inside it, positive is past it. The setback limits buildings, not earthwork." },
          ]} />
          <IconButton ref={gearRef} size={24} aria-label="Grading settings" aria-expanded={open} data-grading-gear="1" onClick={() => setOpen((o) => !o)}>{/* a drawn gear — the ⚙ text glyph sits high and left of its own em box, so it read off-centre in its square */}<PondSettingsIcon size={14} /></IconButton>
          <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={gearRef} placement="below-right" width={300} gap={6}
            panelStyle={{ ...menuPanelStyle, padding: "10px 12px" }}>
            <GradingSettings model={model} dockDropFt={dockDropFt} onCfg={onCfg} onDockDrop={onDockDrop} />
          </AnchoredMenu>
        </>
      )}
    </span>
  );
}

function StepIcon({ plus }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d={plus ? "M6 2v8M2 6h8" : "M2 6h8"} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/* 2 — the INPUTS block: the finished floor (the ONLY place it is shown or edited), the limit of disturbance, the slope ratio. */
function InputsBlock({ c, model, floorVisible }) {
  const cfg = model.cfg, limit = model.limit, actions = model.actions;
  const offset = limitOffsetFt(cfg.gradingMarginFt);
  const setOffset = (v) => {
    const m = marginFromOffset(v);
    // typing a limit IS choosing the property-line limit: a plan still on the retired "around the layout" auto mode moves over with it
    actions.setLimit({ gradingMarginFt: m, ...(limit && limit.mode === "layout" && limit.source !== "edited" ? { limitMode: "boundary" } : {}) });
  };
  return (
    <div data-section="inputs" style={{ ...blockStyle, gap: 6 }}>
      {floorVisible && (
        <Row label="Finished floor">
          <NumField value={c.ffe} step={0.5} width={76} unit="ft" allowClear disabled={c.ffe == null} placeholder={c.failed ? "—" : "…"} testid="grading-ffe" ariaLabel="Finished floor elevation"
            attrs={{ "data-ffe-value": c.isAuto ? "auto" : "typed" }}
            onCommit={(v) => (v == null ? actions.resetFfe(c.id) : actions.typeFfe(c.id, v))} />
          {c.isAuto
            ? <span data-ffe-source="auto" style={{ ...pillStyle, color: "var(--success-text)", borderColor: "var(--success-text)" }}>{ffePillText(true)}</span>
            : <button type="button" data-ffe-source="typed" data-ffe-reset="1" title="Back to the suggested floor" onClick={() => actions.resetFfe(c.id)}
                style={{ ...pillStyle, cursor: "pointer", fontFamily: "inherit", background: "transparent", color: "var(--text-secondary)", borderColor: "var(--border-strong)" }}>{ffePillText(false)}</button>}
        </Row>
      )}
      <Row label="Limits of disturbance">
        <IconButton size={22} aria-label="Limit of disturbance 1 ft further inside" data-testid="grading-limit-minus" onClick={() => setOffset(offset - 1)}><StepIcon /></IconButton>
        <NumField value={offset} signed step={1} width={58} testid="grading-limit-offset" ariaLabel="Limits of disturbance, feet from the property line (negative inside, positive past it)"
          min={-500} max={LIMIT_PAST_MAX_FT} onCommit={(v) => setOffset(v)} />
        <IconButton size={22} aria-label="Limit of disturbance 1 ft further out" data-testid="grading-limit-plus" onClick={() => setOffset(offset + 1)}><StepIcon plus /></IconButton>
        <span style={muted}>ft from property line</span>
      </Row>
      {limit && (
        <div data-graded-area="1" data-limit-mode={limit.mode} data-limit-source={limit.source} data-limit-sig={limit.sig || ""} data-limit-ac={limit.areaAc == null ? "" : String(limit.areaAc)} data-limit-controls="1"
          style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 18 }}>
          {limit.editing
            ? <button type="button" data-limit-action="done" style={linkBtn} onClick={() => actions.doneEditLimit && actions.doneEditLimit()}>Done editing</button>
            : <button type="button" data-limit-action="edit" style={linkBtn} onClick={() => actions.editLimit && actions.editLimit(null)}>Edit outline</button>}
          {limit.source === "edited" && <button type="button" data-limit-action="reset" data-limit-grew={limit.grew && limit.grew.length ? "1" : "0"} title={limit.grew && limit.grew.length ? `The limit grew to include ${limit.grew.join(", ")}.` : undefined} style={linkBtn} onClick={() => actions.resetLimit && actions.resetLimit()}>Reset to auto</button>}
        </div>
      )}
      <Row label="Slopes">
        <SegmentedControl options={SLOPE_RATIOS.map((r) => ({ key: r, label: `${r}:1` }))} value={cfg.slopeRatio} onChange={(v) => model.actions.setSlope(v)} aria-label="Grading slope ratio" data-testid="grading-slope-ratio" />
      </Row>
    </div>
  );
}

/* 3 — the numbers row: HAUL first. */
function Tile({ k, label, big, sub, tone = null }) {
  const ink = tone === "green" ? "var(--success-text)" : tone === "amber" ? "var(--warn-text)" : "var(--text-primary)";
  return (
    <div data-tile={k} style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={sectionLabel}>{label}</span>
      <span data-tile-value={k} style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>{big}</span>
      <span data-tile-sub={k} style={{ fontSize: FONT_SIZE.label, color: ink, fontWeight: tone ? 650 : 400, fontVariantNumeric: "tabular-nums" }}>{sub}</span>
    </div>
  );
}
function TilesRow({ tiles }) {
  const t = tiles || { haul: { big: "…", sub: "" }, cut: { big: "…", sub: "" }, fill: { big: "…", sub: "" } };
  return (
    <div data-section="tiles" data-grading-earthwork={tiles ? "1" : "pending"} style={{ ...hairline, display: "flex", gap: 8, padding: "10px 0" }}>
      <Tile k="haul" label="Haul" big={t.haul.big} sub={t.haul.sub} tone={t.haul.tone === "green" ? "green" : t.haul.tone === "amber" ? "amber" : null} />
      <Tile k="cut" label="Cut" big={t.cut.big} sub={t.cut.sub} />
      <Tile k="fill" label="Fill" big={t.fill.big} sub={t.fill.sub} />
    </div>
  );
}

/* "Second pad": the search for a spot where this depth stays under its threshold runs ON CLICK (the controller's findSecondPad), then
 * the move is applied through the planner's one move action. */
function SecondPadLink({ c, flag, model, onApplyMoveFix }) {
  const [st, setSt] = useState("idle");
  if (st === "none") return <span data-fix="move" data-fix-state="none" style={muted}>No move within 240 ft clears it</span>;
  return (
    <button type="button" data-fix="move" data-fix-state={st} disabled={st === "looking"} style={{ ...linkBtn, cursor: st === "looking" ? "default" : "pointer" }}
      title={`Moves the building to where this stays under ${Math.round(flag.thresholdFt)} ft`}
      onClick={async () => {
        setSt("looking");
        let mv = null;
        try { mv = await model.actions.findSecondPad(c.id, flag); } catch (_) { mv = null; }
        if (mv) { setSt("idle"); onApplyMoveFix(c.id, mv); } else setSt("none");
      }}>{st === "looking" ? "Looking…" : "Second pad"}</button>
  );
}

/* 4 — flags: zero or more, ONE sentence each, plus the action links that flag owns. */
function FlagList({ c, model, onApplyFfeFix, onApplyMoveFix, onPullLimit }) {
  const flags = c.flags || [];
  if (!flags.length) return null;
  const fx = c.fixes || { status: "idle", ffe: null, move: null };
  const link = (key, text, fix, onClick, disabled = false, title) => (
    <button key={key} type="button" data-fix={fix} disabled={disabled} title={title} onClick={onClick}
      style={{ ...linkBtn, opacity: disabled ? 0.55 : 1, cursor: disabled ? "default" : "pointer" }}>{text}</button>
  );
  return (
    <div data-section="flags" style={{ display: "flex", flexDirection: "column", gap: 6, paddingBottom: 10 }}>
      {flags.map((f) => (
        <div key={f.id} data-grading-flag="1" data-flag-kind={f.kind} role="alert"
          style={{ border: "1px solid var(--danger)", borderLeft: "4px solid var(--danger)", borderRadius: RADIUS.md, padding: "6px 10px", display: "flex", flexDirection: "column", gap: 4, background: "var(--surface-field)" }}>
          <span data-flag-text="1">{f.text}</span>
          {f.actions && f.actions.length > 0 && (
            <span style={{ display: "inline-flex", gap: 12, flexWrap: "wrap" }}>
              {f.actions.map((a) => {
                if (a === "ffe") return link(a, fx.status === "computing" ? "Finding a floor…" : fx.ffe ? `${fx.ffe.delta > 0 ? "Raise" : "Lower"} floor to ${f1(fx.ffe.ffe)} ft` : "No floor clears it", "ffe", () => fx.ffe && onApplyFfeFix(c.id, fx.ffe), !fx.ffe);
                if (a === "limit") return link(a, "Pull limit in", "limit", () => onPullLimit && onPullLimit(c.id, (fx.limit && fx.limit.span) || f.span), !onPullLimit);
                if (a === "second-pad") return <SecondPadLink key={a} c={c} flag={f} model={model} onApplyMoveFix={onApplyMoveFix} />;
                if (a === "raise-ffe") return link(a, `Raise floor to ${f1(Math.round((c.ffe + f.raiseFt) * 10) / 10)} ft`, "ffe", () => onApplyFfeFix(c.id, { ffe: Math.round((c.ffe + f.raiseFt) * 10) / 10 }), c.ffe == null);
                return null;
              })}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/* 5 — OTHER FLOORS TO TRY: the table, then the HAUL BY FLOOR curve. */
const fmtHaul = (cy) => {
  if (cy == null || !Number.isFinite(cy)) return "…";
  if (Math.abs(cy) < BALANCE_TOL_CY_PANEL) return "0";
  return `${cy > 0 ? "+" : "−"}${fmtCyShort(cy)}`;
};
const fmtFt = (v) => (v == null || !Number.isFinite(v) ? "…" : `${Math.round(v)} ft`);
const COLS = "minmax(0, 1.7fr) minmax(0, 0.75fr) minmax(0, 0.75fr) minmax(0, 0.75fr)";
function HaulCurve({ floors, currentE, currentHaul }) {
  const pts = floors.curve || [];
  if (pts.length < 2) return null;
  const W = 300, H = 84, L = 6, R = 6, T = 8, B = 16;
  const xs = pts.map((p) => p.E), ys = pts.map((p) => p.haulCy);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), yMax = Math.max(1, Math.abs(Math.min(...ys, 0)), Math.max(...ys, 0));
  const X = (e) => L + ((e - x0) / (x1 - x0 || 1)) * (W - L - R);
  const Y = (v) => T + (1 - (v + yMax) / (2 * yMax)) * (H - T - B);
  const mark = { stroke: "var(--border-strong)", strokeWidth: 1 };
  return (
    <div data-section="haul-curve" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={sectionLabel}>Haul by floor</span>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Haul by floor elevation: import above the line, export below" data-haul-curve="1" style={{ display: "block", overflow: "visible" }}>
        <line x1={L} x2={W - R} y1={Y(0)} y2={Y(0)} style={{ ...mark, strokeDasharray: "3 3" }} data-haul-zero="1" />
        {(floors.rows || []).map((r) => <line key={r.key} x1={X(r.E)} x2={X(r.E)} y1={T} y2={H - B} style={mark} data-haul-mark={r.key} />)}
        <polyline points={pts.map((p) => `${X(p.E).toFixed(1)},${Y(p.haulCy).toFixed(1)}`).join(" ")} fill="none" style={{ stroke: "var(--text-primary)", strokeWidth: 1.5 }} />
        {Number.isFinite(currentE) && currentE >= x0 && currentE <= x1 && Number.isFinite(currentHaul) && (
          <circle cx={X(currentE)} cy={Y(Math.max(-yMax, Math.min(yMax, currentHaul)))} r={3.5} data-haul-current="1" style={{ fill: "var(--accent-site-text)", stroke: "var(--surface-field)", strokeWidth: 1.5 }} />
        )}
        <text x={L} y={H - 3} style={{ fill: "var(--text-secondary)", fontSize: FONT_SIZE.micro }}>{Math.round(x0)}</text>
        <text x={W - R} y={H - 3} textAnchor="end" style={{ fill: "var(--text-secondary)", fontSize: FONT_SIZE.micro }}>{Math.round(x1)} ft</text>
        <text x={L} y={T + 6} style={{ fill: "var(--text-secondary)", fontSize: FONT_SIZE.micro }}>import</text>
        <text x={W - R} y={H - B - 3} textAnchor="end" style={{ fill: "var(--text-secondary)", fontSize: FONT_SIZE.micro }}>export</text>
      </svg>
    </div>
  );
}
function FloorsTable({ c, onTypeFloor }) {
  const fl = c.floors;
  if (!fl) return null;
  return (
    <div data-section="floors" data-floors-pending={fl.pending ? "1" : "0"} style={{ ...hairline, padding: "10px 0", display: "flex", flexDirection: "column", gap: 6, opacity: fl.pending ? 0.7 : 1 }}>
      <span style={sectionLabel}>Other floors to try</span>
      <div role="table" aria-label="Other floors to try" style={{ display: "flex", flexDirection: "column", fontVariantNumeric: "tabular-nums" }}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: COLS, gap: 6, ...muted, fontWeight: 650, paddingBottom: 3 }}>
          <span role="columnheader">Floor</span><span role="columnheader" style={{ textAlign: "right" }}>Haul CY</span><span role="columnheader" style={{ textAlign: "right" }}>Deepest cut</span><span role="columnheader" style={{ textAlign: "right" }}>Tallest fill</span>
        </div>
        {fl.rows.length === 0 && <div style={muted}>{fl.pending ? "…" : "—"}</div>}
        {fl.rows.map((r) => (
          <button key={r.key} type="button" role="row" data-floor-row={r.key} data-floor-e={r.E} data-floor-current={r.current ? "1" : "0"} aria-pressed={r.current}
            onClick={() => onTypeFloor(c.id, r.E)}
            style={{ display: "grid", gridTemplateColumns: COLS, gap: 6, alignItems: "baseline", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, color: "var(--text-primary)",
              background: r.current ? "var(--surface-field)" : "transparent", border: "1px solid", borderColor: r.current ? "var(--accent-site-text)" : "transparent", borderRadius: RADIUS.sm, padding: "4px 6px", margin: "0 -6px" }}>
            <span role="cell" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
              <span style={{ fontWeight: r.current ? 700 : 600 }}>{f1(r.E)} · {r.label}</span>
              {r.sub && <span style={{ ...muted, fontWeight: 400 }}>{r.sub}</span>}
            </span>
            <span role="cell" style={{ textAlign: "right" }}>{fmtHaul(r.stats ? r.stats.haulCy : null)}</span>
            <span role="cell" style={{ textAlign: "right" }}>{fmtFt(r.stats ? r.stats.deepestCutFt : null)}</span>
            <span role="cell" style={{ textAlign: "right" }}>{fmtFt(r.stats ? r.stats.tallestFillFt : null)}</span>
          </button>
        ))}
      </div>
      <HaulCurve floors={fl} currentE={c.ffe} currentHaul={c.haulCy} />
    </div>
  );
}

/* 6 — ON THE MAP: pill checkboxes, then a one-line legend in the picture's own colours. */
function PillCheck({ checked, onChange, testid, children }) {
  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "3px 9px", borderRadius: RADIUS.pill, fontSize: FONT_SIZE.control,
      border: `1px solid ${checked ? "var(--accent-site-text)" : "var(--border-default)"}`, background: checked ? "var(--surface-field)" : "transparent", fontWeight: checked ? 650 : 500, color: "var(--text-primary)" }}>
      <input type="checkbox" data-testid={testid} checked={!!checked} onChange={(e) => onChange && onChange(e.target.checked)} /> {children}
    </label>
  );
}
function MapLegend({ PAL }) {
  const ink = (PAL && PAL.ink) || "var(--text-primary)";
  const item = (key, swatch, text) => <span key={key} data-legend={key} style={{ display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>{swatch}{text}</span>;
  const box = (bg) => <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: RADIUS.sm, background: bg, opacity: 0.8, display: "inline-block" }} />;
  // the map's lines are dark ink on the sheet's white, so their swatches sit on a chip of that white — visible on a dark panel too
  const line = (stroke, dash) => <span aria-hidden="true" style={{ background: GRADING_PAPER_RGB, borderRadius: RADIUS.sm, padding: "0 3px", display: "inline-flex" }}><svg width="18" height="8"><line x1="0" x2="18" y1="4" y2="4" stroke={stroke} strokeWidth="1.4" strokeDasharray={dash} /></svg></span>;
  return (
    <div data-section="legend" style={{ ...muted, display: "flex", flexWrap: "wrap", gap: "2px 10px", alignItems: "center" }}>
      {item("cut", box(inkOf(CUT_RGB)), "Cut")}
      {item("fill", box(inkOf(FILL_RGB)), "Fill")}
      {item("limit", line(ink, LIMIT_LINE_DASH.replace(" ", ",")), "Limits")}
      {item("existing", line(CONTOUR_PROPOSED_RGB, "5,4"), "Existing contour")}
    </div>
  );
}
function OnTheMap({ showOnMap, showContours, showPaper, showSpots, onShowOnMap, onShowContours, onShowPaper, onShowSpots, PAL }) {
  return (
    <div data-section="on-the-map" style={{ ...hairline, padding: "10px 0", display: "flex", flexDirection: "column", gap: 7 }}>
      <span style={sectionLabel}>On the map</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <PillCheck testid="grading-show-on-map" checked={showOnMap} onChange={onShowOnMap}>Cut &amp; fill</PillCheck>
        <PillCheck testid="grading-show-contours" checked={showContours} onChange={onShowContours}>Proposed contours</PillCheck>
        <PillCheck testid="grading-show-paper" checked={showPaper} onChange={onShowPaper}>Paper</PillCheck>
        <PillCheck testid="grading-show-spots" checked={showSpots} onChange={onShowSpots}>Spot elevations</PillCheck>
      </div>
      <MapLegend PAL={PAL} />
    </div>
  );
}

/* 7 — GROUND: a severity pill, then TWO numbers. The only prose is behind the ⓘ. */
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
    const g = groundNumbers(sum, cfg);
    if (!g) return <div data-ground-state="computing" style={muted}>{ground.status === "idle" ? "Waiting for the ground model…" : "Reading the ground…"}</div>;
    return (
      <div data-ground-state="ready" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8 }}>
          <div data-ground-stat="buildable" style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span data-ground-figure="1" style={{ fontSize: FONT_SIZE.display, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{g.acres}</span>
            <span style={muted}>{g.acresSub}</span>
          </div>
          <div data-ground-stat="relief" style={{ flex: "1 1 0", minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
            <span style={{ fontSize: FONT_SIZE.display, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{g.relief}</span>
            <span style={muted}>{g.reliefSub}</span>
          </div>
        </div>
        <div>
          <Button variant="secondary" size="sm" data-ground-show-buildable="1" aria-pressed={buildableOn} onClick={onToggleBuildable}>
            {buildableOn ? "Hide" : "Show buildable area on map"}
          </Button>
        </div>
      </div>
    );
  })();
  const sev = sum && sum.best ? sum.severity : null;
  return (
    <div data-section="ground" style={{ ...hairline, ...blockStyle }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span style={sectionLabel}>Ground</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {sev && <Pill tone={sev.tone} data-ground-severity={sev.id}>{sev.label.toUpperCase()}</Pill>}
          <RowInfo label="Ground" sections={[
            { text: "Ground heights: USGS 3DEP bare-earth LiDAR, sampled every 10 ft. A pad counts only inside the setback, with the cut-or-fill limit and slope set in Grading settings. The slopes must meet existing ground inside the limit of disturbance. Bank volumes, no retaining walls. Screening only." },
            { text: setback && setback.usingPropertyLine ? "No setback drawn, using the property line." : "Measured to your parcel setback lines." },
          ]} />
        </span>
      </div>
      {body}
    </div>
  );
}

/* 8 — several buildings: a thin selector above the per-building blocks. */
function BuildingSelector({ cards, onSelect }) {
  return (
    <div data-section="buildings" role="group" aria-label="Buildings" style={{ display: "flex", flexDirection: "column", gap: 3, paddingBottom: 8 }}>
      {cards.map((c) => (
        <button key={c.id} type="button" data-grading-card={c.id} data-card-state={c.focus ? "open" : "collapsed"} aria-pressed={c.focus} onClick={() => onSelect(c.id)}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, color: "var(--text-primary)",
            background: c.focus ? "var(--surface-field)" : "transparent", border: "1px solid", borderColor: c.focus ? "var(--accent-site-text)" : "var(--border-default)", borderRadius: RADIUS.md, padding: "4px 10px" }}>
          <span style={{ fontWeight: 650 }}>{c.name} · {fmtSf(c.sf)}</span>
          <span style={{ display: "inline-flex", gap: 6, alignItems: "baseline", color: "var(--text-secondary)", fontVariantNumeric: "tabular-nums" }}>
            {c.flagged && <span title="Has a flag" style={{ color: "var(--danger-text)", fontWeight: 700 }}>!</span>}
            <span>{c.ffe == null ? (c.failed ? "—" : "…") : `${f1(c.ffe)} ft`}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/* The left-dock Grading panel (NEW-1, the approved layout). It only READS `model` (published by the controller SitePlanner mounts
 * whether or not this panel is open); opening it starts no build. `headerSlot` is the panel chrome's action element (the On switch,
 * the ⓘ and the gear portal there). */
export const OFF_LINE = "Turn this on to suggest finish elevations and show cut and fill for this plan.";
export function GradingPanel({ planOn = true, showOnMap = false, showContours = false, showPaper = true, showSpots = true, onPlanOn = null, onShowOnMap = null, onShowContours = null, onShowPaper = null, onShowSpots = null, model, headerSlot = null, dockDropFt, onCfg, onDockDrop, onSelectBuilding, onApplyFfeFix, onApplyMoveFix, onToggleBuildable, buildableOn = false, onPullLimit = null, PAL = null }) {
  const view = gradingPanelView(model);
  const head = headerSlot && createPortal(<GradingHeaderActions model={planOn ? model : null} planOn={planOn} onPlanOn={onPlanOn} dockDropFt={dockDropFt} onCfg={onCfg} onDockDrop={onDockDrop} />, headerSlot);
  if (!planOn) {
    return (
      <div data-testid="grading-panel" data-grading-panel="off" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
        {head}
        <div data-grading-empty="off" style={muted}>{OFF_LINE}</div>
      </div>
    );
  }
  if (view.state === "loading") {
    return (
      <div data-testid="grading-panel" data-grading-panel="loading" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
        {head}
        <div data-grading-empty="loading" style={muted}>{view.line}</div>
      </div>
    );
  }
  const cards = view.cards;
  const focus = cards.find((c) => c.focus) || cards[0] || null;
  // the model's actions plus the two this layout adds: one cfg write for the limit offset, one for the slope ratio
  const actions = { ...model.actions, setLimit: (patch) => onCfg(patch), setSlope: (r) => onCfg({ slopeRatio: r }), typeFfe: model.actions.typeFfe, resetFfe: model.actions.resetFfe };
  const m2 = { ...model, actions };
  return (
    <div data-testid="grading-panel" data-grading-panel={view.state} style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", display: "flex", flexDirection: "column" }}>
      {head}
      {cards.length > 1 && <BuildingSelector cards={cards} onSelect={onSelectBuilding} />}
      <div data-section="grading" data-grading-card={cards.length === 1 && focus ? focus.id : undefined} data-card-state={cards.length === 1 ? "open" : undefined} style={{ display: "flex", flexDirection: "column" }}>
        <InputsBlock c={focus || {}} model={m2} floorVisible={!!focus} />
        {focus
          ? (
            <>
              {model.demStatus === "failed"
                ? <div data-ffe-note="1" style={{ ...muted, color: "var(--warn-text)", paddingBottom: 8 }}>Couldn't read the ground.</div>
                : focus.ffe == null && !focus.failed && <div data-ffe-note="1" style={{ ...muted, paddingBottom: 8 }}>Reading the ground…</div>}
              <TilesRow tiles={focus.tiles || null} />
              <FlagList c={focus} model={model} onApplyFfeFix={onApplyFfeFix} onApplyMoveFix={onApplyMoveFix} onPullLimit={onPullLimit} />
              <FloorsTable c={focus} onTypeFloor={(id, E) => model.actions.typeFfe(id, E)} />
            </>
          )
          : <div data-grading-empty={view.state} style={{ ...muted, paddingBottom: 8 }}>{view.line}</div>}
      </div>
      <OnTheMap showOnMap={showOnMap} showContours={showContours} showPaper={showPaper} showSpots={showSpots} onShowOnMap={onShowOnMap} onShowContours={onShowContours} onShowPaper={onShowPaper} onShowSpots={onShowSpots} PAL={PAL} />
      <GroundSection model={model} buildableOn={buildableOn} onToggleBuildable={onToggleBuildable} />
    </div>
  );
}

/* ---------------------------------------------------------------- canvas */
export const LABELS_MIN_PX = 90;        // labels draw only when the building's shorter side is at least this many screen px
const PILL_H = CORNER_TAG_PILL_H;
function Pill2({ x, y, text, PAL, fill = null, stroke = null, size = 11 }) {
  const w = pillWidth(text, size);
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
export function GradingCanvas({ model, f2p, rppf, PAL, viewRect = null }) {
  const { buildable, cutfill, labels, cfg, contours, limit } = model;
  const bandClipId = `grading-band-${useId().replace(/:/g, "")}`;
  // ROUND 6 (NEW-1): what is drawn at this zoom — index only with the parcel filling the map, every level with the building
  // filling it, a band thinned to a coarser interval where its lines would touch — then the labels of the pieces drawn
  const drawPlan = useMemo(() => planContourDraw(contours, rppf), [contours, rppf]);
  // ROUND 10 (NEW-2): from working zoom in, EVERY drawn line (index and intermediate) carries its elevation — one label per line on a
  // straight stretch, never on another label; farther out the index labels the tracer chose stay (lib/contourLabelPlan.js)
  const placedLabels = useMemo(() => {
    if (rppf >= CONTOUR_LABEL_ALL.minPpf) {
      const lines = [];
      for (const lv of drawPlan.levels) pathToPieces(lv.d).forEach((pts, i) => lines.push({ key: `${lv.level}:${i}`, level: lv.level, isIndex: lv.isIndex, pts }));
      return planAllContourLabels(lines, rppf, { rect: viewRect });   // `viewRect` (feet) = the planner's LATCHED cull rect: stations are offered only where they can be seen
    }
    return placeContourLabels(drawPlan.labels, rppf);
  }, [drawPlan, rppf, viewRect]);
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
  const showCutfillLabels = !!cfg.layers.cutfill && cfg.layers.spots !== false;   // NEW-1: the "Spot elevations" pill hides the labels, not the picture
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
        <g data-layer="cutfill" data-band-ready={cutfill.bandReady ? "1" : "0"} data-band-source={cutfill.bandSource || ""} data-band-limit={cutfill.bandLimitSig || ""}>
          {cutfill.outlineD ? (
            <>
              {/* legacy (no grading limit): the per-cell picture and its cell outline */}
              {img(cutfill, "cimg", false)}
              {feetG(cutfill.outlineD, PAL.paper, 3.4, null)}
              {feetG(cutfill.outlineD, PAL.ink, 1.6, "1.5 3.5", "round")}
            </>
          ) : cutfill.clipD ? (
            /* ROUND 7 (NEW-1/NEW-2) — a light tint, smooth-scaled, CLIPPED to the traced band polygon (feet space, evenodd),
               then the daylight line as one thin solid contour-brown line on top; the inner edge (boundary mode's toe / top
               of slope) a thin dashed one */
            <g transform={`translate(${o.x} ${o.y}) scale(${rppf})`}>
              <defs>
                <clipPath id={bandClipId} clipPathUnits="userSpaceOnUse"><path data-band-clip="1" d={cutfill.clipD} clipRule="evenodd" fillRule="evenodd" /></clipPath>
              </defs>
              <image data-band-tint="1" href={cutfill.dataUrl} x={cutfill.bboxFt.x} y={cutfill.bboxFt.y} width={cutfill.bboxFt.w} height={cutfill.bboxFt.h}
                preserveAspectRatio="none" style={{ imageRendering: "auto" }} clipPath={`url(#${bandClipId})`} pointerEvents="none" />
              {cutfill.innerD && <path data-band-inner="1" d={cutfill.innerD} fill="none" stroke={CONTOUR_PROPOSED_RGB} strokeOpacity={0.8} strokeWidth={0.9} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
              {cutfill.daylightD && <path data-daylight-line="1" d={cutfill.daylightD} fill="none" stroke={CONTOUR_PROPOSED_RGB} strokeWidth={1.25} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />}
            </g>
          ) : null}
          {/* ROUND 4 — the grading limit: the thin dashed ink line the slope is thrown from */}
          {cutfill.limitD && <g data-grading-limit="1">{feetG(cutfill.limitD, PAL.ink, 1, LIMIT_LINE_DASH)}</g>}
        </g>
      )}
      {/* ROUND 4 (B2349122) — the proposed contours: bold brown lines, index lines heavier and labelled, clipped to daylight */}
      {contours && contours.levels && contours.levels.length > 0 && (
        <g data-layer="contours" data-contour-limit={contours.limitSig || ""} data-contour-interval={contours.interval} data-contour-index-only={drawPlan.indexOnly ? "1" : "0"} data-contour-levels-drawn={drawPlan.levels.length}>
          {drawPlan.levels.map((lv) => (
            <g key={lv.level} data-contour-level={lv.level} data-contour-index={lv.isIndex ? "1" : "0"}
              transform={`translate(${o.x} ${o.y}) scale(${rppf})`}>
              <path d={lv.d} fill="none" stroke={lv.isIndex ? CONTOUR_PROPOSED_INDEX_RGB : CONTOUR_PROPOSED_RGB} strokeWidth={lv.weight} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          ))}
          {/* ROUND 5 — labels ride the line (rotated with it, upright), one per index piece, never stacked (placeContourLabels) */}
          {placedLabels.map((lb, i) => {
            const p = f2p(lb.pt);
            return (
              <text key={i} data-contour-label={lb.level} data-contour-label-deg={lb.deg} transform={`translate(${p.x} ${p.y}) rotate(${lb.deg})`} y={3.5} textAnchor="middle" fontSize={10} fontWeight={700}
                fill={CONTOUR_PROPOSED_INDEX_RGB} stroke={GRADING_PAPER_RGB} strokeWidth={2.5} paintOrder="stroke" style={{ fontFamily: "ui-monospace, monospace" }}>{lb.text}</text>
            );
          })}
        </g>
      )}
      {/* ROUND 4 — while the outline is being edited for a flag: the offending span, circled */}
      {limit && limit.editing && limit.highlight && (() => {
        const c = f2p(limit.highlight.pt);
        return <circle data-limit-highlight="1" cx={c.x} cy={c.y} r={Math.max(24, limit.highlight.radiusFt * rppf)} fill="none" stroke={PAL.danger} strokeWidth={1.5} strokeDasharray="4 4" />;
      })()}
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
              // NEW-2 / NEW-5 (2026-10-30): the tag is placed by lib/padCornerTag — ALWAYS wholly inside the footprint, with a leader to the exact
              // corner when it sits away from it; every edit button lies outside the walls (lib/buildingButtons), so the two cannot meet. Non-interactive.
              const quad = L.quad ? L.quad.map((q) => f2p(q)) : null;
              const t = quad ? placeCornerTag(quad, k.idx, k.text) : null;
              const p = f2p(k.pt);
              let x, y;
              if (t) { x = t.x; y = t.y; } else {
                const dx = c0.x - p.x, dy = c0.y - p.y, d = Math.hypot(dx, dy) || 1, inset = Math.min(26, d * 0.3);
                x = p.x + (dx / d) * inset; y = p.y + (dy / d) * inset;
              }
              return (
                <g key={i} data-pad-corner={k.kind} data-pad-corner-idx={k.idx} data-pad-corner-moved={t && t.leader ? "1" : "0"} pointerEvents="none">
                  {t && t.leader && (
                    <g data-pad-corner-leader="1">
                      <line x1={t.leader.x1} y1={t.leader.y1} x2={t.leader.x2} y2={t.leader.y2} stroke={PAL.ink} strokeWidth={1} />
                      <circle cx={t.leader.x1} cy={t.leader.y1} r={2.2} fill={PAL.ink} />
                    </g>
                  )}
                  <Pill2 x={x} y={y} text={k.text} PAL={PAL} />
                </g>
              );
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
