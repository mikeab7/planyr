/* @planner-extract — AUDIT BATCH G1: the Properties-panel field primitives (Section, Field, PairedField, RotationField, the dock layer panels
 * and friends), moved verbatim out of SitePlanner.jsx. Behaviour-identical; see test/helpers/plannerSource.js. */
import { useState, Children, useRef, useEffect, useCallback } from "react";
import { CONTROL_H, FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { NumInput } from "./NumInput.jsx";
import { rampLayout, rampDir, rampWidthFt, rampGradePct } from "../lib/driveInRamp.js";
import { SegmentedControl } from "../../../shared/ui/controls.jsx";
import { ROW6, MAX_DIM } from "../lib/plannerConstants.js";
import { TABULAR_NUMS, NUM_FONT } from "../../../shared/theme/typography.js";
import { commaInt as f0 } from "../../../shared/units/numberFormat.js";
import { DOCK_STEPS } from "../lib/dockLayerPanel.js";
import Collapse from "./Collapse.jsx";
import { SURF_RAISED, BORDER_1 } from "../lib/plannerShared.js";
import RotationStepper, { formatDeg } from "../../../shared/ui/RotationStepper.jsx";
import { wallPickerLayout, wallClickTitle } from "../lib/loadingWalls.js";
import { dockSidesFor, dockSideCompassLabel } from "../lib/dockZones.js";
import { bumpEnds } from "../lib/wallRows.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";


/* ----------------------------- small UI ----------------------------- */
export function Section({ title, children, collapsed, accent }) {
  const [open, setOpen] = useState(!collapsed);
  // NEW-1: a whole-panel wrapper passes no title (the panel name now lives in the PanelChrome
  // bar, so an inner "Site Analysis"/"References"/"Parcels · N" header would duplicate it) —
  // render a bare, always-open card.
  if (title == null || title === false) {
    return (
      // Flat panel (owner NEW-1, Option A): the panel IS the section — no second border, radius,
      // background or inset. The scroll container's ordinary padding is the only inset.
      <div data-flat-section="1" style={{ marginBottom: 9 }}>{children}</div>
    );
  }
  return (
    <div className="flat-section" data-flat-section="1" style={{ borderTop: "1px solid var(--planner-border)" }}>
      <div className="sec-head" onClick={() => setOpen((o) => !o)}
        role="button" tabIndex={0} aria-expanded={open} aria-label={title}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen((o) => !o); } }} /* B531: keyboard-toggle the section */
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "10px 2px", userSelect: "none" }}>
        {accent && <span style={{ width: 6, height: 6, borderRadius: 99, background: accent, flex: "none" }} />}
        <span className="sec-title" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", flex: 1, transition: "color .12s" }}>{title}</span>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)", transform: open ? "rotate(90deg)" : "none", transition: "transform .18s ease", width: 9 }}>▶</span>
      </div>
      {open && <div style={{ padding: "0 2px 12px" }}>{children}</div>}
    </div>
  );
}
/* NEW-1 (B1618656) — the shared label GUTTER every properties-panel row aligns to, whether it's a
 * lone Field or one half of a PairedField. Sized to the short paired-column vocabulary (Colour /
 * Width / Style / Pattern / Opacity — all ≤8 chars); PropLabel below wraps a longer single-row
 * label (e.g. a pond engineering-assumption field) onto a second line rather than widening the
 * gutter and starving the two value columns beside it. A per-panel gutter was considered and
 * rejected — the owner's mockup calls for one shared left edge across the whole panel, paired rows
 * included, so the width has to be a single constant every row in every panel reads. */
const PROP_GUTTER_W = 64;
/* NEW-1 (owner 2026-10-21, Goose Creek area measurement) — the value column is a FIXED, compact width: sized for a number
 * box with its stepper (or a swatch), and it does NOT grow with the panel. Widening the docked panel leaves empty space on the
 * right; it never stretches a number box away from its ▲▼ or a pattern select across the panel. The grid uses
 * `minmax(0, W)` so a narrow panel still shrinks the columns instead of overflowing. The phone bottom sheet raises the
 * ceiling through the CSS variable (its steppers are touch-sized), so a phone-width sheet still fits. */
const PROP_VALUE_W = 92;
const PROP_VALUE_W_CSS = `var(--prop-value-w, ${PROP_VALUE_W}px)`;
const PROP_PAIR_COLS = `${PROP_GUTTER_W}px repeat(2, minmax(0, ${PROP_VALUE_W_CSS}))`;
// The road panel's wider label column (redesign NEW-1): "Right-of-way" / "Repeat every" / "Background" must
// never wrap, and the road panel's rows are single-line by contract. Other panels keep PROP_GUTTER_W.
export const ROAD_GUTTER_W = 92;
// A native <select> at the same height / outline as the stepper boxes beside it (CONTROL_H.md, the strong border).
export const ROAD_SELECT_STYLE = { width: "100%", minWidth: 0, boxSizing: "border-box", height: CONTROL_H.md, padding: "0 6px", fontSize: FONT_SIZE.control, fontFamily: "inherit", color: "var(--text-primary)", background: "var(--surface-raised)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm };
const PROP_GRID_GAP = SPACE.sm; // 6 — tight on purpose: two ~84px value columns at the 268px panel width

/* The row label — wraps up to 2 lines (a handful of longer single-row labels do; the paired-row
 * vocabulary never does) and always carries its own text as a hover title, so nothing is ever lost
 * to the clamp even in the rare case a label runs past 2 lines. */
function PropLabel({ children, title, oneLine = false }) {
  const full = title ?? (typeof children === "string" ? children : undefined);
  return (
    <span
      style={{
        fontSize: FONT_SIZE.control, lineHeight: 1.25, color: "var(--text-secondary)",
        ...(oneLine ? { display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }
          : { display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }),
        ...(full ? { cursor: "help" } : null),
      }}
      title={full}
    >{children}</span>
  );
}

// The placeholder for "a property only one side has" (per the mockup) — an OUTLINE cell with no
// weight, or a FILL cell with no hatch, reads as a dash rather than an empty gap.
function PropDash() {
  return <span aria-hidden="true" style={{ display: "block", textAlign: "center", color: "var(--text-tertiary)", fontSize: FONT_SIZE.control }}>—</span>;
}

/* NEW-1 — `data-field-group` marks a VALUE-ENTRY ROW as one unit to the keyboard latch
 * (shared/keyboard/keyScope.js). The label, the input and its ▲▼ steppers are one thing to the
 * user, and pressing any of them means "I am editing this number" — so Delete and Backspace
 * belong to the number, not to the plan, until the user touches the drawing again. Two of the
 * seven measured ways the owner's building could be destroyed were presses on those steppers. */
/* NEW-1 — a Field whose ONLY child is a numeric box / percent box / native select is a "compact control" row: its value cell
 * is capped at the same fixed width as a PairedField column, so the two row kinds line up and neither grows with the panel.
 * Only the default-gutter Field is capped — the road and dock panels (their own gutters) already size their boxes explicitly. */
function isCompactControl(children) {
  const kids = Children.toArray(children);
  if (kids.length !== 1) return false;
  const t = kids[0] && kids[0].type;
  return t === NumInput || t === PercentField || t === "select";
}
export function Field({ label, children, title, gutter = PROP_GUTTER_W, oneLine = false }) {
  const compact = gutter === PROP_GUTTER_W && isCompactControl(children);
  return (
    <div data-field-group="1" data-row-align="1" style={{ display: "grid", gridTemplateColumns: `${gutter}px 1fr`, alignItems: "center", columnGap: PROP_GRID_GAP, marginBottom: SPACE.md }}>
      <PropLabel title={title} oneLine={oneLine}>{label}</PropLabel>
      <div data-field-value={compact ? "compact" : "1"} style={{ minWidth: 0, ...(compact ? { maxWidth: PROP_VALUE_W_CSS } : null) }}>{children}</div>
    </div>
  );
}
// PairedField — one row of an OUTLINE/FILL (or LINE/FILL) column pair, sharing Field's own gutter
// so the two primitives line up on one left edge. `left`/`right` go under PairedFieldHead's two
// column names, in that order; either may be omitted for a property only the other side has.
export function PairedField({ label, title, left, right }) {
  return (
    <div data-field-group="1" data-row-align="1" data-paired-grid="1" style={{ display: "grid", gridTemplateColumns: PROP_PAIR_COLS, alignItems: "center", columnGap: PROP_GRID_GAP, marginBottom: SPACE.md }}>
      <PropLabel title={title}>{label}</PropLabel>
      {/* NEW-2 — `data-paired-cell="1"` marks a HALF-width value column, as opposed to a Field
          row's full-width one. It exists only so the phone bottom-sheet's stepper touch-target CSS
          (below, near `data-num-stepper`) can tell the two apart: a row with BOTH sides populated
          by a stepped control (e.g. this panel's Opacity row — Fill AND Line opacity, each a
          PercentField with its own ▲▼ nudge) doesn't have room for two 44px-touch-target-wide
          spinners side by side at iPhone-SE width, and measurably overflowed the row before this
          marker existed (the Opacity row's own scrollWidth ran 12px past its clientWidth). */}
      <div data-paired-cell="1" style={{ minWidth: 0 }}>{left ?? <PropDash />}</div>
      <div data-paired-cell="1" style={{ minWidth: 0 }}>{right ?? <PropDash />}</div>
    </div>
  );
}
// PairedFieldHead — the column-header row atop a PairedField group (empty gutter cell, then the
// two group names) — the mockup's "OUTLINE" / "FILL" row. Shares Section's uppercase title style.
// `data-row-align="1"` is NOT `data-field-group` (that marks a value-entry row for the keyboard
// latch, and this row holds no input) — it exists only so a left-edge alignment check can find
// every row KIND, header included. NEW-1 shipped this row 2px right of the rows it labels
// because the alignment check of the day filtered on `data-field-group` and never saw it.
export function PairedFieldHead({ left, right }) {
  const head = { fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-secondary)" };
  return (
    <div data-row-align="1" data-paired-grid="1" style={{ display: "grid", gridTemplateColumns: PROP_PAIR_COLS, columnGap: PROP_GRID_GAP, margin: "10px 0 7px" }}>
      <span />
      <span style={head}>{left}</span>
      <span style={head}>{right}</span>
    </div>
  );
}
// DockLayerPanel — NEW-1 (owner-approved mockup 2026-10-19): the ONE Properties body for a dock layer (truck court ·
// trailer parking · buffer), parameterised by `kind`, never three copies. Presentational: every rule (Auto vs typed,
// the band notice, what a removal takes) is in lib/dockLayerPanel.js; every write is a callback into the planner's
// planner's writers (setDockLayerDepth / setDockLayerLength / setSelEl / removeFeature) so history, redraw and
// tombstones behave exactly as before. Module scope (MODULE-SCOPE-COMPONENTS); `confirm` is local state keyed on
// the selected layer by the call site. The Grade section exists only when `grade` is passed (a buffer has none today).
const DOCK_GUTTER_W = 84;
function DockHead({ children }) {
  return (
    <div style={{ fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-secondary)", padding: "9px 2px 5px", marginBottom: SPACE.md, borderBottom: "1px solid var(--border-default)" }}>{children}</div>
  );
}
function AutoPill({ on, onClick, label }) {
  return (
    <button type="button" data-testid={`dock-auto-${label}`} aria-pressed={on} onClick={onClick} onMouseDown={(e) => e.preventDefault()}
      title={on ? "Using the computed value — type or step to set your own" : "Back to the computed value"}
      style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: 4, height: CONTROL_H.md, padding: "0 8px", borderRadius: RADIUS.pill, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.label, fontWeight: 600,
        border: `1px solid ${on ? "var(--accent-site)" : "var(--border-strong)"}`, background: on ? "var(--accent-site)" : "transparent", color: on ? "var(--on-accent-site)" : "var(--text-secondary)" }}>
      <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M1.5 5.2 4 7.6 8.5 2.6" /></svg>Auto
    </button>
  );
}
/* Drive-in ramp Properties (NEW-3, 2026-10-30) — layout "A": a Ramp section (the choices), a Size & position section (what follows from them) and the
 * shared Appearance section the generic inspector renders beside it. Presentational: every rule and number is lib/driveInRamp.js, passed in. */
export function DriveInRampPanel({ ramp, marker, lengthFt, riseIn, dockHeightIn, doorsTaken, flags, atMax, onPatch, onAt, onRise, onDelete }) {
  const lay = rampLayout(ramp), horizWall = ramp.side === "top" || ramp.side === "bottom";
  const note = { fontSize: FONT_SIZE.label, color: "var(--text-secondary)" };
  const check = (key, label, on, tid) => (
    <label style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm, fontSize: FONT_SIZE.control, color: "var(--text-primary)", cursor: "pointer" }}>
      <input type="checkbox" data-testid={tid} checked={on} onChange={(e) => onPatch({ [key]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <div data-testid="ramp-panel">
      <StdSubLabel section="appearance">{marker ? "Door" : "Ramp"}</StdSubLabel>
      {!marker && (
        <Field label="Layout">
          <SegmentedControl aria-label="Ramp layout" data-testid="ramp-layout" value={lay} onChange={(k) => onPatch({ layout: k })} accent="var(--accent-site)" onAccent="var(--on-accent-site)"
            options={[{ key: "straight", label: "Straight-in", testid: "ramp-layout-straight", title: "Perpendicular to the wall, out into the court" }, { key: "along", label: "Along the wall", testid: "ramp-layout-along", title: "Runs parallel to the dock face and turns into the door at the top" }]} />
        </Field>
      )}
      {!marker && lay === "along" && (
        <Field label="Runs">
          <SegmentedControl aria-label="Ramp direction" data-testid="ramp-dir" value={rampDir(ramp) > 0 ? "end" : "start"} onChange={(k) => onPatch({ dir: k === "end" ? 1 : -1 })} accent="var(--accent-site)" onAccent="var(--on-accent-site)"
            options={[{ key: "start", label: horizWall ? "Left" : "Up", testid: "ramp-dir-start" }, { key: "end", label: horizWall ? "Right" : "Down", testid: "ramp-dir-end" }]} />
        </Field>
      )}
      <Field label="Position" title="Feet from the start of the wall to the centre of the drive-in door; it snaps to the door spacing">
        <NumInput boxed unit="ft" testid="ramp-at" ariaLabel="Ramp position along the wall" value={Math.round((ramp.at ?? 0) * 100) / 100} min={0} step={6} coarse={12} onCommit={onAt} />
      </Field>
      {!marker && (
        <>
          <Field label="Width"><NumInput boxed unit="ft" testid="ramp-width" ariaLabel="Ramp width" value={rampWidthFt(ramp)} min={14} max={40} step={2} coarse={4} onCommit={(n) => onPatch({ width: Math.max(14, Math.min(40, n)) })} /></Field>
          <Field label="Grade"><NumInput boxed unit="%" testid="ramp-grade" ariaLabel="Ramp grade" value={rampGradePct(ramp)} min={2} max={20} step={0.5} coarse={1} onCommit={(n) => onPatch({ gradePct: Math.max(2, Math.min(20, n)) })} /></Field>
          <Field label="Rise" title={`Defaults to the plan's dock height (${Math.round(dockHeightIn)} in)`}>
            <span style={ROW6}>
              <NumInput boxed unit="in" testid="ramp-rise" ariaLabel="Ramp rise in inches" value={Math.round(riseIn * 10) / 10} min={6} max={120} step={2} coarse={6} onCommit={onRise} />
              {ramp.riseIn != null && <button type="button" data-testid="ramp-rise-auto" onClick={() => onRise(null)} style={{ ...note, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", textDecoration: "underline" }}>dock height</button>}
            </span>
          </Field>
        </>
      )}
      <Field label="Door">
        <SegmentedControl aria-label="Door size" data-testid="ramp-door" value={ramp.door === "14x16" ? "14x16" : "12x14"} onChange={(k) => onPatch({ door: k })} accent="var(--accent-site)" onAccent="var(--on-accent-site)"
          options={[{ key: "12x14", label: "12×14", testid: "ramp-door-12x14" }, { key: "14x16", label: "14×16", testid: "ramp-door-14x16" }]} />
      </Field>
      {!marker && <Field label="Details"><span style={{ display: "inline-flex", gap: SPACE.xl, flexWrap: "wrap" }}>{check("wings", "Wing walls", ramp.wings !== false, "ramp-wings")}</span></Field>}
      {!marker && (
        <>
          <StdSubLabel section="size">Size & position</StdSubLabel>
          <Field label="Length"><span data-testid="ramp-length" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", fontVariantNumeric: TABULAR_NUMS }}>{f0(lengthFt)} ft</span></Field>
          <Field label="Takes"><span data-testid="ramp-takes" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>{doorsTaken === 0 ? "no dock doors" : `${doorsTaken} dock ${doorsTaken === 1 ? "door" : "doors"}`}</span></Field>
        </>
      )}
      {flags.map((f) => (
        <div key={f.code} data-testid={`ramp-flag-${f.code}`} role="status" style={{ display: "flex", alignItems: "flex-start", gap: SPACE.sm, margin: `${SPACE.xs}px 0 ${SPACE.md}px`, fontSize: FONT_SIZE.label, color: "var(--warn-text)", lineHeight: 1.4 }}>
          <span aria-hidden="true" style={{ flex: "none" }}>⚠</span><span>{f.text}</span>
        </div>
      ))}
      <div style={{ display: "flex", gap: SPACE.md, marginTop: SPACE.md }}>
        <button type="button" data-testid="ramp-delete" onClick={onDelete} style={{ height: CONTROL_H.md, padding: "0 12px", borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, border: "1px solid var(--danger-text)", background: "transparent", color: "var(--danger-text)" }}>{marker ? "Delete door" : "Delete ramp"}</button>
      </div>
    </div>
  );
}
export function DockLayerPanel({ kind, size, grade, style, pinned, onPin, removal, onRemove, removeNoun }) {
  const [confirm, setConfirm] = useState(false);
  const muted = { fontSize: FONT_SIZE.label, color: "var(--text-secondary)" };
  const autoRow = (label, tid, f, { min, max, step, onCommit, onAuto, noun }) => (
    <Field gutter={DOCK_GUTTER_W} oneLine label={label}>
      <span style={ROW6}>
        <NumInput boxed boxWidth={84} testid={tid} ariaLabel={label} value={f.shown == null ? "" : f.shown} placeholder="—" min={min} max={max} step={step} coarse={step * 5}
          muted={f.isAuto} forceCommit={f.isAuto} syncExternal onCommit={onCommit} />
        <AutoPill on={f.isAuto} label={noun} onClick={() => { if (!f.isAuto) onAuto(); }} />
      </span>
    </Field>
  );
  const colHead = { fontSize: FONT_SIZE.label, color: "var(--text-secondary)" };
  const grid = { display: "grid", gridTemplateColumns: `${DOCK_GUTTER_W}px repeat(2, minmax(0, ${PROP_VALUE_W_CSS}))`, alignItems: "center", columnGap: PROP_GRID_GAP, marginBottom: SPACE.md };
  return (
    <div data-testid="dock-layer-panel" data-dock-kind={kind}>
      <DockHead>Size</DockHead>
      <Field gutter={DOCK_GUTTER_W} oneLine label="Depth (ft)">
        <NumInput boxed boxWidth={84} testid="dock-depth" ariaLabel="Depth" value={size.depth} min={1} max={MAX_DIM} step={DOCK_STEPS.depth} onCommit={size.onDepth} />
      </Field>
      <Field gutter={DOCK_GUTTER_W} oneLine label="Length (ft)">
        <span style={ROW6}>
          <NumInput boxed boxWidth={84} testid="dock-length" ariaLabel="Length" value={size.length} min={1} max={size.maxLength} step={DOCK_STEPS.length} onCommit={size.onLength} />
          {size.isFull
            ? <span data-testid="dock-full-wall" style={muted}>Full wall</span>
            : <button type="button" data-testid="dock-full-wall-link" style={{ ...muted, padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", color: "var(--accent-text, var(--accent))", textDecoration: "underline", textUnderlineOffset: 2 }} onClick={size.onFullWall}>Full wall</button>}
        </span>
      </Field>
      <Field gutter={DOCK_GUTTER_W} oneLine label="Area"><span data-testid="dock-area" style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", fontVariantNumeric: TABULAR_NUMS }}>{f0(size.area)} SF</span></Field>
      {size.extra}

      {grade && (
        <Collapse sectionId="dock-grade" title="Grade" defaultOpen>
          {autoRow("Elevation (ft)", "dock-elevation", grade.elevation, { min: -1000, max: 20000, step: DOCK_STEPS.elevation, noun: "elevation",
            onCommit: (n) => grade.onElevation(Number.isFinite(n) ? n : null), onAuto: () => grade.onElevation(null) })}
          {autoRow("Slope (%)", "dock-slope", grade.slope, { min: 0, max: 100, step: DOCK_STEPS.slope, noun: "slope",
            onCommit: (n) => grade.onSlope(Number.isFinite(n) ? n : null), onAuto: () => grade.onSlope(null) })}
          {grade.notice && (
            <div data-testid="dock-band-notice" role="status" style={{ display: "flex", alignItems: "flex-start", gap: SPACE.sm, margin: `-${SPACE.xs}px 0 ${SPACE.md}px`, fontSize: FONT_SIZE.label, color: "var(--warn-text)", lineHeight: 1.4 }}>
              <span aria-hidden="true" style={{ flex: "none" }}>⚠</span><span>{grade.notice}</span>
            </div>
          )}
        </Collapse>
      )}

      <Collapse sectionId="dock-style" title="Style" defaultOpen>
        <div style={{ ...grid, marginBottom: SPACE.sm }}><span /><span style={colHead}>Outline</span><span style={colHead}>Fill</span></div>
        <div style={grid}><PropLabel oneLine>Colour</PropLabel><span style={ROW6}>{style.strokeColor}</span><span style={ROW6}>{style.fillColor}</span></div>
        <div style={grid}><PropLabel oneLine>Weight</PropLabel>
          <span style={{ display: "flex" }}><NumInput boxed boxWidth={72} testid="dock-weight" ariaLabel="Outline weight" value={style.weight} min={1} max={10} step={DOCK_STEPS.weight} onCommit={style.onWeight} /></span><span /></div>
        <div style={grid}><PropLabel oneLine>Opacity (%)</PropLabel>
          <span style={{ display: "flex" }}><NumInput boxed boxWidth={72} testid="dock-outline-opacity" ariaLabel="Outline opacity" value={Math.round((style.strokeOpacity ?? 1) * 100)} min={0} max={100} step={DOCK_STEPS.opacity} onCommit={(n) => style.onStrokeOpacity(Math.max(0, Math.min(100, Math.round(n))) / 100)} /></span>
          <span style={{ display: "flex" }}><NumInput boxed boxWidth={72} testid="dock-fill-opacity" ariaLabel="Fill opacity" value={Math.round((style.fillOpacity ?? 1) * 100)} min={0} max={100} step={DOCK_STEPS.opacity} onCommit={(n) => style.onFillOpacity(Math.max(0, Math.min(100, Math.round(n))) / 100)} /></span></div>
      </Collapse>

      <div style={{ display: "flex", gap: SPACE.md, marginTop: SPACE.xl }}>
        <button type="button" data-testid="dock-pin" aria-pressed={pinned} onClick={onPin}
          style={{ height: CONTROL_H.md, padding: "0 12px", borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600,
            border: `1px solid ${pinned ? "var(--accent-site)" : "var(--border-strong)"}`, background: pinned ? "var(--accent-site)" : "transparent", color: pinned ? "var(--on-accent-site)" : "var(--text-primary)" }}
          title="Pin in place: prevents accidental moves/edits">{pinned ? "Pinned" : "📌 Pin"}</button>
        <button type="button" data-testid="dock-remove" aria-expanded={confirm} onClick={() => setConfirm((c) => !c)}
          style={{ height: CONTROL_H.md, padding: "0 12px", borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, border: "1px solid var(--danger-text)", background: "transparent", color: "var(--danger-text)" }}>Remove {removeNoun}</button>
      </div>
      {confirm && (
        <div data-testid="dock-remove-confirm" role="alertdialog" aria-label={`Remove ${removeNoun}`}
          style={{ marginTop: SPACE.md, padding: SPACE.xl, border: "1px solid var(--border-strong)", borderRadius: RADIUS.md, background: "var(--surface-raised)" }}>
          {removal.copy && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", lineHeight: 1.45, marginBottom: SPACE.md }}>{removal.copy}</div>}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", columnGap: SPACE.lg, rowGap: SPACE.xs, fontSize: FONT_SIZE.label, marginBottom: SPACE.xl }}>
            <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>Now</span><span data-testid="dock-confirm-now" style={{ color: "var(--text-primary)" }}>{removal.now}</span>
            <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>After</span><span data-testid="dock-confirm-after" style={{ color: "var(--text-primary)" }}>{removal.after}</span>
          </div>
          <div style={{ display: "flex", gap: SPACE.md }}>
            <button type="button" data-testid="dock-confirm-remove" onClick={() => { setConfirm(false); onRemove(); }}
              style={{ height: CONTROL_H.md, padding: "0 12px", borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, border: "1px solid var(--danger-text)", background: "var(--danger-text)", color: "var(--on-accent)" }}>{removal.confirmLabel}</button>
            <button type="button" data-testid="dock-confirm-cancel" onClick={() => setConfirm(false)}
              style={{ height: CONTROL_H.md, padding: "0 12px", borderRadius: RADIUS.sm, cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.control, border: "1px solid var(--border-strong)", background: "transparent", color: "var(--text-primary)" }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
// PercentField — compact 0–100% entry for a 0–1 opacity value. A paired value column has no room
// for a full-width slider (the mockup's deliberate call), so both OUTLINE and FILL opacity read as
// a short number instead. Commits once (blur/Enter), like every other NumInput in these panels —
// no drag-history batching needed, unlike the slider it replaces. `inputStyle` is the caller's own
// local `numInput` const (this function lives at module scope, above the component that defines
// it, so it cannot close over it) — every call site already has one in scope.
export function PercentField({ value, onCommit, ariaLabel, inputStyle, min = 0, max = 100, boxed = false }) {
  // NEW-1 (layout "A") — `boxed`: the SAME field drawn as the shared NumberBox (value · % · ▲▼) filling its column, so every
  // Appearance number box shares one right edge. Callers that do not pass it are unchanged.
  if (boxed) {
    return <NumInput boxed fill unit="%" ariaLabel={ariaLabel} value={Math.round((value ?? 0) * 100)} min={min} max={max} step={5} coarse={25}
      onCommit={(n) => onCommit(Math.max(min, Math.min(max, Math.round(n))) / 100)} />;
  }
  return (
    <span style={{ display: "flex", alignItems: "center", gap: SPACE.xxs, minWidth: 0 }}>
      <NumInput style={{ ...inputStyle, width: "100%", minWidth: 0 }} value={Math.round((value ?? 0) * 100)} min={min} max={max} step={5}
        ariaLabel={ariaLabel} onCommit={(n) => onCommit(Math.max(min, Math.min(max, Math.round(n))) / 100)} />
      <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", flex: "none" }}>%</span>
    </span>
  );
}
// AisleSideCard — B1790017 NEW-2, the parking inspector's "Aisle side" picture control. A real
// aria-pressed button (never a div) drawing a to-scale cross-section (wall → row → aisle, or
// wall → aisle → row) from the field's LIVE stallDepth/aisle, so flipping cfg.flipDepth reads as
// a picture rather than a bare "far side" checkbox. Module-scope per MODULE-SCOPE-COMPONENTS —
// it takes the caller's live theme palette as an ordinary prop (`pal`) rather than closing over
// the panel's own render-body `PAL`, which only exists inside that component.
// NEW-2 (B1790017 amendment) — `disabledReason` (same convention as RotationStepper's own prop)
// replaces the button's ordinary hover title with the reason when `disabled`, so a mouse/keyboard
// user gets the answer without hunting for the separate paragraph below the cards (LOUD-FAILURE:
// the disabled state used to change nothing about the button itself, only a caption elsewhere).
export function AisleSideCard({ flipped, stallDepth, aisle, active, disabled, disabledReason, onClick, label, sub, pal }) {
  const total = Math.max(1, (stallDepth || 0) + (aisle || 0));
  const BANDS_H = 46, WALL_H = 7, GAP = 1, W = 78;
  const stallH = Math.max(9, Math.round((stallDepth / total) * BANDS_H));
  const aisleH = Math.max(9, BANDS_H - stallH);
  const order = flipped ? ["aisle", "row"] : ["row", "aisle"]; // top-to-bottom, from the wall outward
  let y = WALL_H + GAP;
  const bands = order.map((kind) => {
    const h = kind === "row" ? stallH : aisleH;
    const b = { kind, h, y, val: kind === "row" ? stallDepth : aisle };
    y += h + GAP;
    return b;
  });
  const svgH = y;
  const innerX = 2, innerW = W - 4;
  const title = disabled && disabledReason ? disabledReason : (sub ? `${label} — ${sub}` : label);
  return (
    <button type="button" aria-pressed={active} disabled={disabled} onClick={onClick} title={title}
      style={{
        flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
        padding: "7px 6px 6px", borderRadius: RADIUS.md, fontFamily: "inherit",
        border: `1px solid ${active ? pal.accent : pal.panelLine}`,
        background: active ? pal.accentSoft : SURF_RAISED,
        cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
      }}>
      <svg width={W} height={svgH} viewBox={`0 0 ${W} ${svgH}`} aria-hidden="true" focusable="false">
        <rect x={innerX} y={0} width={innerW} height={WALL_H} fill={pal.muted} opacity={0.35} />
        {Array.from({ length: 7 }).map((_, i) => {
          const x = innerX + (i * innerW) / 6;
          return <line key={i} x1={x} y1={WALL_H} x2={x - WALL_H} y2={0} stroke={pal.muted} strokeWidth={1} />;
        })}
        {bands.map((b, i) => b.kind === "row" ? (
          <g key={i}>
            <rect x={innerX} y={b.y} width={innerW} height={b.h} fill="none" stroke={pal.ink} strokeWidth={1} />
            {Array.from({ length: 4 }).map((_, k) => {
              const x = innerX + ((k + 1) * innerW) / 5;
              return <line key={k} x1={x} y1={b.y} x2={x} y2={b.y + b.h} stroke={pal.ink} strokeWidth={1} />;
            })}
            <text x={innerX + innerW - 2} y={b.y + b.h / 2 + 3} textAnchor="end" fontSize="8" fontFamily={NUM_FONT} fill={pal.ink}>{f0(b.val)}′</text>
          </g>
        ) : (
          <g key={i}>
            <rect x={innerX} y={b.y} width={innerW} height={b.h} fill="none" stroke={pal.panelLine} strokeWidth={1} />
            <line x1={innerX + 2} y1={b.y + b.h / 2} x2={innerX + innerW - 2} y2={b.y + b.h / 2} stroke={pal.muted} strokeWidth={1} strokeDasharray="3 3" />
            <text x={innerX + innerW - 2} y={b.y + b.h / 2 + 3} textAnchor="end" fontSize="8" fontFamily={NUM_FONT} fill={pal.muted}>{f0(b.val)}′</text>
          </g>
        ))}
      </svg>
      <div style={{ fontSize: FONT_SIZE.label, fontWeight: 650, color: active ? pal.accent : pal.ink, textAlign: "center", lineHeight: 1.25 }}>{label}</div>
      {sub && <div style={{ fontSize: 10, color: pal.muted, textAlign: "center" }}>{sub}</div>}
    </button>
  );
}
/* NEW-1 — a sub-heading INSIDE a panel/section that styles more than one UNPAIRED thing (e.g. the
 * parcel boundary vs. its setback line — two different lines, neither one "the fill side" of the
 * other, so they stay two stacked single-column groups rather than a paired grid). Hierarchy comes
 * from weight + uppercase letter-spacing, never from fading the text toward the background (theme rule). */
export function StdSubLabel({ children, section }) {
  return (
    <div data-panel-section={section} style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-secondary)", margin: "10px 0 7px" }}>{children}</div>
  );
}
// B681 — familiar Word-style paragraph-alignment glyph: four stacked rows, long rows spanning the
// width and short rows anchored left / centre / right per `dir`. Replaces the cryptic ⇤ ≣ ⇥ unicode.
// `currentColor` makes it inherit the button's active/idle text colour.
export function AlignIcon({ dir }) {
  const W = 14, rows = [1, 0.62, 0.86, 0.54], ys = [2.2, 5.8, 9.4, 13];
  return (
    <svg width="14" height="15" viewBox="0 0 14 15" aria-hidden="true" focusable="false" style={{ display: "block", pointerEvents: "none" }}>
      {rows.map((r, i) => {
        const len = r * W;
        const x = dir === "right" ? W - len : dir === "center" ? (W - len) / 2 : 0;
        return <line key={i} x1={x} y1={ys[i]} x2={x + len} y2={ys[i]} stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />;
      })}
    </svg>
  );
}
// NEW-1 (layout "A") — vertical-align glyph: a box outline with a short text bar pinned to the top / middle / bottom.
export function VAlignIcon({ dir }) {
  const y = dir === "top" ? 3.4 : dir === "bottom" ? 11.6 : 7.5;
  return (
    <svg width="14" height="15" viewBox="0 0 14 15" aria-hidden="true" focusable="false" style={{ display: "block", pointerEvents: "none" }}>
      <rect x="1" y="1" width="12" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.55" />
      <line x1="3.6" y1={y} x2="10.4" y2={y} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
// NEW-1 (layout "A") — the rotation row's angle glyph: a small dial whose needle is drawn at the CURRENT angle (clockwise from
// 12 o'clock, the way the canvas turns), so the tilt reads at a glance. Display only — not an interactive dial.
function AngleGlyph({ deg }) {
  const a = ((Number.isFinite(deg) ? deg : 0) * Math.PI) / 180;
  const cx = 10, cy = 10, r = 7.5;
  return (
    <svg data-testid="rotation-glyph" data-angle={String(Number.isFinite(deg) ? deg : 0)} width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={{ display: "block", flex: "none", pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r={r + 1} fill="none" stroke="var(--border-strong)" strokeWidth="1" />
      <line x1={cx} y1={cy} x2={cx + r * Math.sin(a)} y2={cy - r * Math.cos(a)} stroke="var(--text-primary)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx={cx} cy={cy} r="1.3" fill="var(--text-primary)" />
    </svg>
  );
}
// NEW-1 (layout "A") — the ONE rotation row for markups / text boxes / callouts: the shared RotationStepper (unchanged behaviour,
// locked state included) with the angle glyph beside it, two icon-only quarter-turn buttons and a Level button that exists
// only while the angle is not 0. Module scope (MODULE-SCOPE-COMPONENTS).
export function RotationField({ value, locked, lockedReason, onCommit, onStep }) {
  const deg = Number.isFinite(value) ? value : 0;
  const tilted = formatDeg(deg) !== "0";
  const icoBtn = { flex: "none", width: 26, height: CONTROL_H.md, padding: 0, display: "grid", placeItems: "center", borderRadius: RADIUS.sm, border: BORDER_1, background: SURF_RAISED, color: "var(--text-primary)", fontSize: 14, lineHeight: 1, fontFamily: "inherit", cursor: locked ? "default" : "pointer", opacity: locked ? 0.5 : 1 };
  return (
    <div data-testid="rotation-field" style={{ display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
      <AngleGlyph deg={deg} />
      <RotationStepper boxed boxWidth="100%" style={{ flex: "1 1 0", minWidth: 0, maxWidth: PROP_VALUE_W_CSS }} data-testid="rotation-input" value={deg} disabled={locked} disabledReason={lockedReason} onCommit={onCommit} onStep={onStep} />
      <button type="button" data-testid="rotation-quarter-left" style={icoBtn} disabled={locked} title={locked ? lockedReason : "Quarter turn left"} aria-label="Quarter turn left" onClick={() => onStep(-90)}>↺</button>
      <button type="button" data-testid="rotation-quarter-right" style={icoBtn} disabled={locked} title={locked ? lockedReason : "Quarter turn right"} aria-label="Quarter turn right" onClick={() => onStep(90)}>↻</button>
      {tilted && <button type="button" data-testid="rotation-level" style={{ ...icoBtn, width: "auto", padding: "0 8px", fontSize: FONT_SIZE.label, fontWeight: 600 }} disabled={locked} title={locked ? lockedReason : "Set the angle back to 0°"} onClick={() => onCommit(0)}>Level</button>}
    </div>
  );
}
// NEW-1 — the Properties panel's "Building number" field. Deliberately its OWN tiny control
// rather than the shared `NumInput` below: a number another building already holds must not be
// silently committed OR silently reverted — it has to reach the caller (`onAttempt`) so the
// panel can offer Swap / Shift / Cancel, and keep showing what was typed while it does. Integer
// only, no 0 or negative — enforced both by the keystroke filter and the caller's own guard.
// Commits on Enter (in place, caret kept — never blur, matching every other inline editor here)
// or on blur; Escape reverts an in-progress edit. `resetToken` is a way IN from the caller: bump
// it to force the draft back to `value` (used when the panel's own Cancel is clicked, since at
// that point `value` itself hasn't changed and the plain effect below would have nothing to react to).
// `id` is the building this instance is currently bound to. It exists because the canvas's own
// mousedown handler deliberately `preventDefault()`s outside a text field (so a canvas drag never
// starts a text selection) — which also suppresses the browser's normal focus-shift-on-click-
// elsewhere, so double-clicking a DIFFERENT building right after an Enter-commit (which leaves
// this field focused, on purpose) never fires a blur. Without `id`, `editing` would stay latched
// true forever and this field would keep showing the PREVIOUS building's number. Reset the latch
// the instant the bound id changes, before deciding whether to resync the draft — never rely on a
// blur that this app's own canvas can silently withhold.
export function BuildingNumberField({ id, value, onAttempt, onCancelConflict, style, className, ariaLabel, resetToken }) {
  const [draft, setDraft] = useState(String(value));
  const editing = useRef(false);
  const boundId = useRef(id);
  useEffect(() => {
    if (boundId.current !== id) { boundId.current = id; editing.current = false; }
    if (!editing.current) setDraft(String(value));
  }, [id, value, resetToken]);
  const commit = () => {
    const n = Math.round(Number(draft));
    if (draft.trim() === "" || !Number.isFinite(n) || n < 1) { setDraft(String(value)); return; }
    setDraft(String(n));
    if (n !== value) onAttempt(n);
  };
  return (
    <input
      style={style}
      className={className}
      value={draft}
      inputMode="numeric"
      aria-label={ariaLabel || "Building number"}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={() => { editing.current = false; commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          editing.current = true; // stays focused — see the NumInput note on why Enter never blurs
          const el = e.currentTarget;
          requestAnimationFrame(() => { try { el.select(); } catch (_) {} });
        } else if (e.key === "Escape") {
          e.preventDefault();
          // ⛔ Never blur() here — a synchronous blur fires `onBlur` before this `setDraft` has
          // applied (React state updates are not synchronous), so `commit()` would read the
          // STALE, about-to-be-reverted draft and commit it. Same reasoning as NumInput's own
          // Escape: stay focused (`editing.current = true`) and let the plain revert stand; Escape
          // is deliberately left to bubble (no stopPropagation), which is what lets it *also*
          // trigger the inspector's own guaranteed escape hatch (B1125) — exactly like every other
          // field in this panel.
          setDraft(String(value));
          editing.current = true;
          // NEW-2 (amends B1768384) — Escape must drop a PENDING conflict exactly like Cancel
          // does, not just revert this field's own draft. Without this, `bldgNumConflict` in the
          // parent survives the Escape (nothing else clears it unless `sel` actually moves to a
          // DIFFERENT building first), so reselecting this same building — a single click that
          // never deselects it, or a direct double-click — reopens the panel onto the stale
          // Swap/Shift/Cancel prompt even though the number already reverted. A no-op when
          // nothing is pending.
          onCancelConflict?.();
        }
      }}
    />
  );
}
// The per-element appearance overrides (back to the type default when dropped) — one list for the single
// and the multi-selection Reset, so a new override key (NEW-8's outline pair) cannot be missed by one of them.
const STYLE_OVERRIDE_KEYS = ["fill", "stroke", "fillOpacity", "strokeOpacity", "strokeWidth"];
export function withoutStyleOverrides(e) { const r = { ...e }; STYLE_OVERRIDE_KEYS.forEach((k) => { delete r[k]; }); return r; }
// LoadingWallPicker — NEW-4. The building inspector's Loading control: a small plan of the building,
// turned by its rotation so it matches the canvas, with four CLICKABLE walls (loaded = thick accent,
// unloaded = thin neutral), each labelled outside it with its compass point, and a fixed north arrow.
// All geometry and every click's meaning comes from lib/loadingWalls.js (pure, unit-tested); this only
// draws it. Labels are positioned on the rotated frame but the text itself never rotates. A wall is a
// real button (role/tab/Enter/Space) with a wide invisible hit line so a 3px wall is still easy to hit.
// Module scope per MODULE-SCOPE-COMPONENTS; theme tokens only.
export function LoadingWallPicker({ b, bumps, onWall, onCorner }) {
  const L = wallPickerLayout(b, { bumps });
  const loaded = new Set(dockSidesFor(b).dockSides);
  const poly = L.corners.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const pts = (arr) => arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const a = L.arrow;
  return (
    <svg data-testid="loading-wall-picker" width={L.width} height={L.height} viewBox={`0 0 ${L.width} ${L.height}`} role="group" aria-label="Loading walls" style={{ flex: "none", display: "block" }}>
      {/* The building, to scale, then each bump-out filled and outlined like the building (it IS building). */}
      <polygon points={poly} fill="var(--surface-field)" stroke="none" />
      {L.bumps.filter((x) => x.existing).map((x) => (
        <polygon key={x.key} data-testid="picker-bump" data-bump={x.key} points={pts(x.poly)} fill="var(--surface-field)" stroke="var(--border-strong)" strokeWidth={1} pointerEvents="none" />
      ))}
      <polygon points={poly} fill="none" stroke="var(--border-strong)" strokeWidth={1} pointerEvents="none" />
      {L.walls.map((w) => {
        const on = loaded.has(w.side);
        const act = () => onWall(w.side);
        return (
          <g key={w.side} data-wall={w.side} data-loaded={on ? "1" : "0"} data-compass={w.label} role="button" tabIndex={0} aria-pressed={on}
            aria-label={`${w.label} wall — ${on ? "loaded" : "not loaded"}`} style={{ cursor: "pointer", outline: "none" }}
            onClick={act} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } }}>
            <title>{wallClickTitle(b, w.side)}</title>
            <line x1={w.x1} y1={w.y1} x2={w.x2} y2={w.y2} stroke="transparent" strokeWidth={14} strokeLinecap="butt" />
            {/* The dock line runs only along the CLEAR face between bump-outs, butt-capped so it stops exactly at one. */}
            <line data-testid="picker-wall-line" x1={on ? w.clear.x1 : w.x1} y1={on ? w.clear.y1 : w.y1} x2={on ? w.clear.x2 : w.x2} y2={on ? w.clear.y2 : w.y2}
              stroke={on ? "var(--accent)" : "var(--border-strong)"} strokeWidth={on ? 5 : 3} strokeLinecap="butt" pointerEvents="none" />
            <text x={w.lx} y={w.ly} textAnchor="middle" dominantBaseline="central" fontSize={FONT_SIZE.micro} fontWeight={on ? 700 : 600}
              fill={on ? "var(--accent-text, var(--accent))" : "var(--text-secondary)"} pointerEvents="none" style={{ userSelect: "none" }}>{w.label}</text>
          </g>
        );
      })}
      {/* Empty corners of a loaded wall: a dashed footprint of the bump-out; click to add. An existing one removes. */}
      {L.bumps.map((x) => {
        const act = () => onCorner(x.side, x.sign);
        const end = bumpEnds(x.side, b.rot || 0).find((e) => e.sign === x.sign);
        const title = x.existing ? `Remove the ${dockSideCompassLabel(x.side, b.rot || 0)} wall's ${end?.label || ""} bump-out` : `Add a bump-out at the ${dockSideCompassLabel(x.side, b.rot || 0)} wall's ${end?.label || ""} end`;
        return (
          <g key={`hit-${x.key}`} data-testid={x.existing ? "picker-bump-hit" : "picker-corner-add"} data-corner={x.key} role="button" tabIndex={0} aria-label={title}
            style={{ cursor: "pointer", outline: "none" }} onClick={act} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); act(); } }}>
            <title>{title}</title>
            {!x.existing && <polygon points={pts(x.poly)} fill="none" stroke="var(--accent)" strokeWidth={1} strokeDasharray="2 2" />}
            <circle cx={x.cx} cy={x.cy} r={7} fill="transparent" />
          </g>
        );
      })}
      <g data-testid="loading-wall-north" pointerEvents="none" aria-hidden="true">
        <path d={`M${a.x} ${a.box.y0 + 1} L${a.x + 4.5} ${a.box.y0 + 10} L${a.x} ${a.box.y0 + 7.5} L${a.x - 4.5} ${a.box.y0 + 10} Z`} fill="var(--text-secondary)" />
        <text x={a.x} y={a.box.y1 - 1.5} textAnchor="middle" fontSize={FONT_SIZE.micro} fontWeight={700} fill="var(--text-secondary)">N</text>
      </g>
    </svg>
  );
}

/* NEW-2 — the inspector header's "⋯" action menu. A bare <details> never closed on an outside click or Esc;
   this is the shared AnchoredMenu (portal, outside-click + Escape dismiss) with the dismissing press consumed
   whole, so closing it never also deselects/deletes whatever was under the pointer. Module scope on purpose
   (MODULE-SCOPE-COMPONENTS): it owns its own open state. */
export function InspectorMoreMenu({ testId, label, glyph = "⋯", btnStyle, btnClassName, panelStyle, children }) {
  const [open, setOpen] = useState(false);
  const anchor = useRef(null);
  const close = useCallback(() => setOpen(false), []);
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: "inline-flex" }}>
      <button ref={anchor} type="button" data-testid={testId} aria-label={label} title="More" aria-haspopup="menu" aria-expanded={open}
        className={btnClassName} style={btnStyle} onClick={() => setOpen((o) => !o)}>{glyph}</button>
      <AnchoredMenu open={open} onClose={close} anchorRef={anchor} placement="below-right" gap={4} width={140} swallowOutsidePress panelStyle={panelStyle}>
        <div data-testid={`${testId}-menu`}>{children(close)}</div>
      </AnchoredMenu>
    </span>
  );
}
// LineSample — the Line weight row's live sample: a short line whose thickness tracks the value.
export function LineSample({ weight }) {
  const w = Math.max(0.5, Math.min(12, Number(weight) || 1));
  return (
    <svg data-testid="line-weight-sample" width={36} height={14} viewBox="0 0 36 14" aria-hidden="true" style={{ flex: "none", display: "block" }}>
      <line x1={2} y1={7} x2={34} y2={7} stroke="var(--text-primary)" strokeWidth={w} strokeLinecap="butt" />
    </svg>
  );
}
