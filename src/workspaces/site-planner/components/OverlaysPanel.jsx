/* OverlaysPanel — the Site tab's OVERLAYS panel (NEW-1 redesign, owner-approved 2026-10-08).
 *
 * A list of rows (thumbnail · name · short sub-line · eye · padlock · ⋯), one open at a time. The
 * open row shows three sections: PLACEMENT (scale / trace / match / rotation), CROP and APPEARANCE
 * (opacity, which band it draws in, white-paper knockout).
 *
 * Presentational only. Every action is a callback into SitePlanner.jsx's EXISTING overlay
 * functions (patchOverlay, applyOverlayScale, removeOverlay, …) — this file adds no data model
 * and no second implementation of anything (docs/DATA.md; the one-source rules in CLAUDE.md).
 * The "what does this kind of overlay show" decisions live in lib/overlayPanelModel.js, unit-tested.
 *
 * MODULE-SCOPE-COMPONENTS: nothing is defined inside a render body.
 *
 * TYPE (owner look spec, 2026-10-08): exactly TWO sizes — FONT_SIZE.control for values and controls,
 * FONT_SIZE.label for section labels and sub-lines — and four (size, weight) pairs: values / buttons /
 * ratio (control, 400), the row NAME (control, 500), section labels (label, 600, uppercase), sub-lines
 * (label, 400). Nothing at 700. ONE accent: the Site green (selected row, slider, checkbox, "Add
 * overlay"); the selected Draws segment is a dark neutral. No orange here. Measured by
 * `ui-audit/verify-overlays-panel-layout.mjs`.
 *
 * WIDTH: the panel is resizable 240–620 and also floats. Nothing here reads window width. The scale
 * group measures ITS OWN box (ResizeObserver) and is either one row of three equal buttons (all three
 * labels fit unwrapped) or one column of three — never 2 + 1. The two quarter-turn buttons under the
 * rotation row are ALWAYS one compact row, left-aligned, sized to their own text; they shorten to
 * "90° counterclockwise" / "90° clockwise" when the full labels would not fit, and never stack.
 *
 * ROTATION (NEW-1, 2026-10-21): label · round DIAL (drag the needle; Shift snaps 15°; one undo step per drag)
 * · number box with ▲▼ (+1° / −1°) on the top line; "Turn 90° counterclockwise" / "Turn 90° clockwise" under it, side by side.
 * CROP (NEW-2, 2026-10-21): a switch in the section heading. Off = the heading alone; on = a picture of the
 * sheet with the area outside the crop dimmed, the kept area dashed in the Site green, and Adjust. Switching
 * off keeps the shape (`crop.off`, shared engine) so switching on brings the same shape back.
 *
 * DRAG: rows reorder by HTML5 drag on a fine pointer only. On touch dragging is OFF (the precedent
 * is NotesTree.jsx) and ⋯ → Move up / Move down is the touch and keyboard path. A row drag is a
 * DOM drag inside the panel — it never reaches the canvas, so it cannot pan it or change selection.
 *
 * FOREIGN ROWS: a row may carry `foreign: { planName }` (an overlay added on another plan of this
 * site — built by a separate session). It renders hidden-style with "added on <plan>", and its eye
 * calls `onShowForeign(row)`. With no data source nothing foreign ever renders from this PR.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { Button, MenuItem } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { CONTROL_H, FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { isCoarsePointer } from "../../../shared/ui/coarsePointer.js";
import { normalizeDeg, parseRotationInput, formatDeg } from "../../../shared/ui/RotationStepper.jsx";
import { SCALE_PRESETS, feetPerInchForPreset, scaleForFtPerPoint, parseTypedScale } from "../../../shared/overlay/overlayScale.js";
import { hasCrop, hasSavedCrop, cropEditBlock, cropOutlinePath } from "../../../shared/overlay/overlayCrop.js";
import NumberBox from "../../../shared/ui/NumberBox.jsx";
import { DIAL_TICKS, dialAngleFromPoint, dialDragAngle, dialKeyAngle, needleEnd, stepRotation, createDialDrag } from "../lib/rotationDial.js";
import { overlayBand, overlayPanelOrder, overlayOrderFlags, canDropOverlay } from "../lib/overlayOrder.js";
import { overlaySubline, placementPlan, formatScaleRatio, scaleEntryPlan, OV_KIND } from "../lib/overlayPanelModel.js";
import { EyeIcon, EyeOffIcon, LockGlyph, UnlockGlyph, MoreIcon, iconBtn as rowIconBtn } from "./ParcelsPanel.jsx";

const LINE = "1px solid var(--border-default)";
const C = FONT_SIZE.control;   // values + controls
const L = FONT_SIZE.label;     // section labels + sub-lines

const H = CONTROL_H.md;        // buttons and inputs share one height
const ACCENT = "var(--accent-site)";
const ACCENT_TEXT = "var(--accent-site-text, var(--accent-site))";
const labelStyle = { fontSize: L, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" };
const subStyle = { fontSize: L, fontWeight: 400, color: "var(--text-secondary)" };
const valueStyle = { fontSize: C, fontWeight: 400, color: "var(--text-primary)" };
const inputStyle = { boxSizing: "border-box", height: H, fontSize: C, fontWeight: 400, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, padding: "0 8px", border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-raised)", color: "var(--text-primary)", minWidth: 0 };
const WARN = "var(--warn-text)";

// compact regular-weight button: the input height, control-size text, never wraps
const btnCompact = { height: H, minWidth: 0, padding: "0 10px", fontSize: C, fontWeight: 400, lineHeight: 1, whiteSpace: "nowrap", boxShadow: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: SPACE.xs };
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function Ico({ children, size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none", display: "block" }}>{children}</svg>;
}
const SheetIcon = () => <Ico size={16}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></Ico>;
const RotL = () => <Ico><path d="M4 12a8 8 0 1 0 3-6.2" /><path d="M4 4v4h4" /></Ico>;
const RotR = () => <Ico><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M20 4v4h-4" /></Ico>;

/* ---------------------------------------------------------------- small controls */

function SectionLabel({ children }) { return <div style={{ ...labelStyle, marginBottom: SPACE.xxs }}>{children}</div>; }

function Thumb({ o }) {
  const [bad, setBad] = useState(false);
  const show = !!o.src && !bad && o.kind !== "dxf";
  return (
    <span data-testid="overlay-thumb" style={{ flex: "none", width: 34, height: 34, borderRadius: RADIUS.sm, border: LINE, background: "var(--surface-page)", display: "grid", placeItems: "center", overflow: "hidden", color: "var(--text-secondary)" }}>
      {show
        ? <img src={o.src} alt="" decoding="async" loading="lazy" draggable={false} onError={() => setBad(true)} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block", opacity: o.visible === false ? 0.45 : 1 }} />
        : <SheetIcon />}
    </span>
  );
}

/* The ONE "row or column" decision for a group of equal buttons: a row while every label fits unwrapped in an
 * equal share of THIS box's own width, otherwise a column of full-width buttons — never a partial row. It is a
 * measurement (ResizeObserver on the group's own box + each button's natural content width), not a CSS guess.
 * Used by the scale group. */
function useRowOrStack(ref, key) {
  const [stacked, setStacked] = useState(false);
  const GAP = SPACE.sm, PAD_X = 10, BORDER = 2;
  useIsoLayoutEffect(() => {
    const box = ref.current;
    if (!box) return undefined;
    const measure = () => {
      const kids = Array.from(box.querySelectorAll("button"));
      if (!kids.length) return;
      let need = 0;
      kids.forEach((b) => {
        if (!b.firstChild) return;
        const r = document.createRange(); r.selectNodeContents(b);
        need = Math.max(need, r.getBoundingClientRect().width);
      });
      need += 2 * PAD_X + BORDER;
      const cell = (box.clientWidth - GAP * (kids.length - 1)) / kids.length;
      setStacked(cell < need - 0.5);
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(box);
    const fonts = document.fonts && document.fonts.ready;
    if (fonts) fonts.then(measure).catch(() => {});
    return () => { if (ro) ro.disconnect(); };
  }, [key]);
  return { stacked, GAP, PAD_X };
}

// the spinner arrows are drawn, not typeset: this panel allows exactly two text sizes and a glyph would be a third
const Chevron = ({ up }) => <svg width="8" height="5" viewBox="0 0 8 5" aria-hidden="true" focusable="false" style={{ display: "block" }}><path d={up ? "M1 4.2 4 1l3 3.2" : "M1 .8 4 4l3-3.2"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

const DIAL_PX = 32;
const DIAL_C = DIAL_PX / 2;

/* The rotation DIAL: a circle with four tick dots (0/90/180/270) and a needle in the Site green at the current
 * rotation (0° = up, clockwise positive). Press anywhere on it and drag to set the rotation live; the drag is ONE
 * undo step (rotationDial.createDialDrag). Shift snaps to 15°. Focusable slider: ←/↓ −1°, →/↑ +1°, Shift ±15°. */
function RotationDial({ value, disabled, reason, drag, onKey }) {
  const ref = useRef(null);
  const deg = Number.isFinite(value) ? value : 0;
  const tip = needleEnd(deg, DIAL_C, 10.5);
  const angleAt = (e) => {
    const r = ref.current.getBoundingClientRect();
    return dialDragAngle(dialAngleFromPoint(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY), { shift: e.shiftKey });
  };
  const end = (e) => {
    try { if (ref.current && ref.current.hasPointerCapture(e.pointerId)) ref.current.releasePointerCapture(e.pointerId); } catch (_) {}
    drag.up();
  };
  return (
    <span ref={ref} role="slider" tabIndex={disabled ? -1 : 0} aria-label="Rotation dial" aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(deg * 10) / 10}
      aria-valuetext={`${formatDeg(deg)}°`} aria-disabled={disabled || undefined} title={disabled ? reason : undefined} data-testid="overlay-rot-dial"
      style={{ flex: "none", width: DIAL_PX, height: DIAL_PX, borderRadius: RADIUS.pill, cursor: disabled ? "default" : "pointer", touchAction: "none", opacity: disabled ? 0.55 : 1, lineHeight: 0 }}
      onPointerDown={(e) => {
        if (disabled || e.button !== 0) return;
        e.preventDefault(); e.stopPropagation();
        try { ref.current.setPointerCapture(e.pointerId); } catch (_) {}
        try { ref.current.focus({ preventScroll: true }); } catch (_) {}
        drag.down(angleAt(e));
      }}
      onPointerMove={(e) => { if (drag.active) drag.move(angleAt(e)); }}
      onPointerUp={end} onPointerCancel={end}
      onKeyDown={(e) => { if (!disabled) onKey(e); }}>
      <svg width={DIAL_PX} height={DIAL_PX} viewBox={`0 0 ${DIAL_PX} ${DIAL_PX}`} aria-hidden="true" focusable="false" style={{ display: "block", pointerEvents: "none" }}>
        <circle cx={DIAL_C} cy={DIAL_C} r={DIAL_C - 1} style={{ fill: "var(--surface-raised)", stroke: "var(--border-default)" }} strokeWidth="1" />
        {DIAL_TICKS.map((t) => { const p = needleEnd(t, DIAL_C, 12.5); return <circle key={t} cx={p.x} cy={p.y} r="1.2" style={{ fill: "var(--text-secondary)" }} />; })}
        <line data-testid="overlay-rot-needle" x1={DIAL_C} y1={DIAL_C} x2={tip.x} y2={tip.y} strokeWidth="2" strokeLinecap="round" style={{ stroke: ACCENT }} />
        <circle cx={DIAL_C} cy={DIAL_C} r="2.2" style={{ fill: ACCENT }} />
      </svg>
    </span>
  );
}

/* The typed rotation: [ value° ▲▼ ] — typed value commits on Enter / blur (Esc reverts, ArrowUp/Down step 1°);
 * the ▲ turns the sheet +1° (clockwise), the ▼ −1°. */
function DegBox({ value, disabled, reason, onCommit, onStep }) {
  const committed = Number.isFinite(value) ? value : 0;
  const [draft, setDraft] = useState(formatDeg(committed));
  const editing = useRef(false);
  const cancelled = useRef(false);   // Esc → the blur that follows must not commit the half-typed draft it still closes over
  useEffect(() => { if (!editing.current) setDraft(formatDeg(committed)); }, [committed]);
  const commit = () => {
    editing.current = false;
    if (cancelled.current) { cancelled.current = false; setDraft(formatDeg(committed)); return; }
    const p = parseRotationInput(draft);
    if (p == null) { setDraft(formatDeg(committed)); return; }
    if (p !== normalizeDeg(committed)) onCommit(p);
    setDraft(formatDeg(p));
  };
  const step = (d) => { editing.current = false; onStep(d); };
  return (
    <NumberBox width={92} disabled={disabled} testid="overlay-rot-box" style={{ border: LINE }}
      onUp={() => step(1)} onDown={() => step(-1)} upLabel="Increase rotation 1 degree" downLabel="Decrease rotation 1 degree"
      upTitle={disabled ? reason : undefined} downTitle={disabled ? reason : undefined} upTestid="overlay-rot-plus" downTestid="overlay-rot-minus" upGlyph={<Chevron up />} downGlyph={<Chevron />}>
      <span role="group" aria-label="Rotation" title={disabled ? reason : undefined} style={{ display: "inline-flex", alignItems: "center", flex: "1 1 auto", minWidth: 0, paddingRight: SPACE.xs }}>
        <input value={draft} disabled={disabled} inputMode="decimal" aria-label="Rotation in degrees" data-testid="overlay-rotation"
          style={{ ...inputStyle, border: "none", background: "transparent", height: "100%", width: "100%", padding: "0 1px 0 0", textAlign: "right", outline: "none" }}
          onFocus={() => { editing.current = true; }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { editing.current = false; cancelled.current = true; setDraft(formatDeg(committed)); e.currentTarget.blur(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); step(1); }
            else if (e.key === "ArrowDown") { e.preventDefault(); step(-1); }
          }} />
        <span aria-hidden="true" style={{ ...valueStyle, fontFamily: NUM_FONT }}>°</span>
      </span>
    </NumberBox>
  );
}

/* The two quarter-turn buttons: ONE compact row, left-aligned, each as wide as its own text — never stacked. The label
 * steps down only as far as the panel's width forces it: "Turn 90° …" (full) → "90° …" (short) → "90° …" with no icon and
 * tighter padding (compact) → the two turn arrows alone (icons — only where even the compact words would be cut off by the
 * panel edge: the narrowest panel and a phone). The full words stay in aria-label and title at every step. The decision is a measurement
 * (ResizeObserver on the row's box + hidden copies of both label sets), not a CSS guess. */
const QUARTERS = [
  { testid: "overlay-rot-ccw90", full: "Turn 90° counterclockwise", short: "90° counterclockwise", delta: -90, Icon: RotL },
  { testid: "overlay-rot-cw90", full: "Turn 90° clockwise", short: "90° clockwise", delta: 90, Icon: RotR },
];
const QUARTER_LEVELS = ["full", "short", "compact", "icons"];
function QuarterTurns({ onTurn, keyId }) {
  const boxRef = useRef(null);
  const [level, setLevel] = useState("full");
  const GAP = SPACE.sm, BORDER = 2, ICON = 14;
  const padFor = (l) => (l === "full" || l === "short" ? 10 : 8);
  useIsoLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const measure = () => {
      const width = (kind) => Array.from(box.querySelectorAll(`[data-quarter-probe="${kind}"]`)).map((p) => p.getBoundingClientRect().width);
      const need = (l) => (l === "icons" ? QUARTERS.length * (ICON + 2 * padFor(l) + BORDER) : width(l === "full" ? "full" : "short").reduce((n, w) => n + w + (l === "compact" ? 0 : ICON + SPACE.xs) + 2 * padFor(l) + BORDER, 0)) + GAP;
      setLevel(QUARTER_LEVELS.find((l) => box.clientWidth >= need(l) - 0.5) || "icons");
    };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(box);
    const fonts = document.fonts && document.fonts.ready;
    if (fonts) fonts.then(measure).catch(() => {});
    return () => { if (ro) ro.disconnect(); };
  }, [keyId]);
  return (
    <div ref={boxRef} data-testid="overlay-quarter-group" data-label={level}
      style={{ position: "relative", display: "flex", flexWrap: "nowrap", justifyContent: "flex-start", gap: GAP, minWidth: 0 }}>
      {QUARTERS.map(({ testid, full, short: sh, delta, Icon }) => (
        <Button key={testid} variant="ghost" size="md" style={{ ...btnCompact, flex: "none", padding: `0 ${padFor(level)}px` }} data-testid={testid}
          aria-label={full} title={full} onClick={() => onTurn(delta)}>{(level === "full" || level === "short" || level === "icons") && <Icon />}{level === "full" ? full : level === "icons" ? null : sh}</Button>
      ))}
      {["full", "short"].flatMap((kind) => QUARTERS.map(({ testid, full, short: sh }) => (
        <span key={`${kind}-${testid}`} aria-hidden="true" data-quarter-probe={kind} style={{ position: "absolute", visibility: "hidden", pointerEvents: "none", whiteSpace: "nowrap", fontSize: C, fontWeight: 400, left: 0, top: 0 }}>{kind === "full" ? full : sh}</span>
      )))}
    </div>
  );
}

/* Rotation, as one block: label · dial · number box on the top line; the two quarter-turn buttons under it,
 * spelled out, side by side in one compact row (shortened, never stacked, when the panel is narrow).
 * Every control writes through the panel's one patch handler and works on a LOCKED overlay (B2262864). */
function RotationRow({ o, h }) {
  const oRef = useRef(o); oRef.current = o;
  const hRef = useRef(h); hRef.current = h;
  const rot = Number.isFinite(o.rotation) ? o.rotation : 0;
  const drag = useMemo(() => createDialDrag({
    getRotation: () => oRef.current.rotation || 0,
    pushHistory: () => hRef.current.pushHistory(),
    patch: (deg, hist) => hRef.current.onPatch(oRef.current.id, { rotation: deg }, hist),
  }), []);
  const turn = (d) => h.onPatch(o.id, { rotation: stepRotation(rot, d) });
  return (
    <div data-testid="overlay-rotation-row" style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
        <span style={{ ...valueStyle, color: "var(--text-secondary)", flex: "none" }}>Rotation</span>
        <RotationDial value={rot} drag={drag}
          onKey={(e) => {
            const next = dialKeyAngle(rot, e.key, e.shiftKey);
            if (next == null) return;
            e.preventDefault(); e.stopPropagation();
            h.onPatch(o.id, { rotation: next }, !e.repeat);   // a held key is ONE undo step
          }} />
        <DegBox value={rot} onCommit={(deg) => h.onPatch(o.id, { rotation: deg })} onStep={turn} />
      </div>
      <QuarterTurns onTurn={turn} keyId={o.id} />
    </div>
  );
}

/* The equal scale buttons. ONE row when every label fits unwrapped in an equal share of THIS panel's own
 * width, otherwise ONE column of full-width buttons — never a 2 + 1. The decision is a measurement
 * (ResizeObserver on the group's own box + the labels' natural text width), not a CSS auto-fit guess. */
function ScaleGroup({ buttons, active, disabled, onPick, why }) {
  const defs = {
    set: { label: "Set scale", title: "Pick a standard scale or type your own" },
    trace: { label: "Trace a length", title: "Click two ends of a known dimension on the drawing, then enter its real length" },
    match: { label: "Match 2 points", title: "Click a point on the drawing then its spot on the map; repeat for 2+ pairs, then Apply (moves, rotates & scales; 3+ pairs = robust best-fit + residual)" },
  };
  const ref = useRef(null);
  const { stacked, GAP, PAD_X } = useRowOrStack(ref, buttons.join(","));
  return (
    <div ref={ref} data-testid="overlay-scale-group" data-layout={stacked ? "stack" : "row"} style={{ display: "grid", gridTemplateColumns: stacked ? "1fr" : `repeat(${buttons.length}, 1fr)`, gap: GAP }}>
      {buttons.map((k) => (
        <Button key={k} variant="ghost" size="md" disabled={disabled} style={{ ...btnCompact, width: "100%", padding: `0 ${PAD_X}px` }} data-testid={`overlay-scale-${k}`}
          title={disabled ? why : defs[k].title} aria-pressed={active === k} onClick={() => onPick(k)}>{defs[k].label}</Button>
      ))}
    </div>
  );
}

/* 'Set scale' — a two-segment switch: PRESET (a dropdown of standard scales, "Read from the sheet" first when there is
 * one; no "Custom…" entry) | CUSTOM (ONE text box, `1" = [ 40 ] '`; a plain number is feet per inch, and anything
 * `parseTypedScale` reads — `1:480`, `1/8" = 1'-0"` — works too). Local draft state; commits through onApply(feetPerInch).
 * Which segment opens first: Preset when the current scale matches a preset or the overlay has none yet; Custom,
 * pre-filled, when the scale came from Trace / Match / typing and matches no preset. */
const roundFpi = (v) => String(Math.round(v * 100) / 100);
function ScaleModeSwitch({ mode, onMode }) {
  const seg = (key, label) => {
    const on = mode === key;
    return (
      <button key={key} type="button" aria-pressed={on} data-testid={`overlay-scale-mode-${key}`} onClick={() => onMode(key)}
        style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: C, fontWeight: 400, lineHeight: 1, whiteSpace: "nowrap", height: "100%", padding: "0 10px", borderRadius: RADIUS.sm,
          background: on ? "var(--text-primary)" : "transparent", color: on ? "var(--surface-raised)" : "var(--text-primary)" }}>{label}</button>
    );
  };
  return (
    <div role="group" aria-label="Scale entry" style={{ display: "inline-flex", alignSelf: "flex-start", boxSizing: "border-box", height: H, padding: 1, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-raised)" }}>
      {seg("preset", "Preset")}{seg("custom", "Custom")}
    </div>
  );
}

export function ScaleTools({ o, onApply }) {
  const { mode: firstMode, selected: selVal, curFpi, detected } = scaleEntryPlan(o);
  const [mode, setMode] = useState(firstMode);
  const [draft, setDraft] = useState(() => roundFpi(curFpi));
  const [bad, setBad] = useState(false);
  const [dirty, setDirty] = useState(false);   // an idle focus → blur must not re-commit the ROUNDED display value (it would drift the scale)
  // The warning colour describes the TEXT IN THE BOX and nothing else: unreadable text is kept (so it can be fixed) and flagged; a
  // readable value is never flagged. Escape, or any edit, clears it — a valid value never wears the warning.
  const commit = async (raw) => {
    if (!dirty) return;
    setDirty(false);   // before the await: Enter's commit and the blur that follows must not both apply
    const fpi = await parseTypedScale(raw);
    if (fpi == null) { setBad(true); return; }
    setBad(false); setDraft(roundFpi(fpi));
    onApply(fpi);
  };
  return (
    <div data-testid="overlay-scale-tools" style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      <ScaleModeSwitch mode={mode} onMode={(m) => { setMode(m); setBad(false); setDirty(false); if (m === "custom") setDraft(roundFpi(curFpi)); }} />
      {mode === "preset" ? (
        <select data-testid="overlay-scale-preset" aria-label="Scale" style={{ ...inputStyle, fontFamily: "inherit", width: "100%" }} value={selVal}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "sheet" && detected) { onApply(detected); return; }
            const p = SCALE_PRESETS.find((x) => x.id === v);
            if (p) onApply(feetPerInchForPreset(p));
          }}>
          {!selVal && <option value="" disabled>Choose a scale</option>}
          {detected && <optgroup label="Read from the sheet"><option value="sheet">{formatScaleRatio(detected)} (suggested)</option></optgroup>}
          <optgroup label="Engineering">{SCALE_PRESETS.filter((p) => p.group === "Engineering").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
          <optgroup label="Architectural">{SCALE_PRESETS.filter((p) => p.group === "Architectural").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
        </select>
      ) : (
        <div data-testid="overlay-scale-custom" style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", gap: SPACE.xs, minWidth: 0 }}>
          <span style={{ ...valueStyle, flex: "none" }}>1" =</span>
          <input data-testid="overlay-scale-custom-input" aria-label="Feet per inch" aria-invalid={bad || undefined} inputMode="decimal" value={draft}
            style={{ ...inputStyle, flex: "none", width: 92, ...(bad ? { borderColor: WARN, color: WARN } : null) }}
            onChange={(e) => { setDraft(e.target.value); setBad(false); setDirty(true); }}
            onBlur={(e) => commit(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === "Enter") commit(e.currentTarget.value); else if (e.key === "Escape") { setDraft(roundFpi(curFpi)); setBad(false); setDirty(false); } }} />
          <span style={{ ...valueStyle, flex: "none" }}>'</span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- the open row's sections */

function PlacementSection({ o, plan, calib, calibMsg, locked, h, pageFocusTick }) {
  const [tool, setTool] = useState(null);                 // "set" while the Set-scale tools are open
  const pageRef = useRef(null);
  const pageNextRef = useRef(null);
  useEffect(() => { setTool(null); }, [o.id]);
  useEffect(() => { if (!pageFocusTick) return; const t = pageRef.current && !pageRef.current.disabled ? pageRef.current : pageNextRef.current; if (t && !t.disabled) t.focus(); }, [pageFocusTick]);
  const mine = calib && calib.id === o.id ? calib : null;
  const pick = (k) => {
    if (k === "set") { setTool((t) => (t === "set" ? null : "set")); return; }
    setTool(null);
    if (k === "trace") h.onTrace(o.id); else h.onMatch(o.id);
  };
  const group = plan.scaleButtons.length ? (
    <ScaleGroup buttons={plan.scaleButtons} active={mine ? (mine.kind === "align" ? "match" : mine.kind) : null} onPick={pick} />
  ) : null;
  const pairs = mine && mine.kind === "align" ? Math.floor(mine.pts.length / 2) : 0;
  return (
    <section data-testid="overlay-placement" aria-label="Placement" style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      <SectionLabel>Placement</SectionLabel>
      {plan.notScaledBox ? (
        <div data-testid="overlay-not-scaled" style={{ border: `1px solid ${WARN}`, borderRadius: RADIUS.sm, padding: SPACE.md, display: "flex", flexDirection: "column", gap: SPACE.sm, background: "var(--surface-page)" }}>
          <div style={{ ...valueStyle, color: WARN }}>This overlay is not scaled</div>
          {plan.kind === OV_KIND.DXF && <div style={{ ...subStyle, color: WARN }}>Units assumed: feet — use Trace a length to confirm.</div>}
          {group}
        </div>
      ) : (<>
        {plan.showRatio && (
          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.md }}>
            <span style={{ ...valueStyle, color: "var(--text-secondary)" }}>Scale</span>
            <span data-testid="overlay-scale-ratio" style={{ ...valueStyle, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{formatScaleRatio(scaleForFtPerPoint(o.ftPerPx))}</span>
          </div>
        )}
        {plan.showUnits && (
          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.md }}>
            <span style={{ ...valueStyle, color: "var(--text-secondary)" }}>Drawing units</span>
            <span style={valueStyle}>{o.unitsLabel || "feet"}</span>
          </div>
        )}
        {group}
      </>)}
      {tool === "set" && plan.scaleButtons.includes("set") && <ScaleTools key={o.id} o={o} onApply={(fpi) => h.onApplyScale(o.id, fpi)} />}
      {mine && (
        <div role="status" data-testid="overlay-calib-status" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
          <span style={{ ...valueStyle, flex: "1 1 120px", minWidth: 0 }}>{calibMsg}</span>
          {pairs >= 2 && <Button variant="primary" size="md" accent={ACCENT} onAccent="var(--on-accent-site)" style={btnCompact} onClick={h.onCalibApply}>Apply {pairs} pts</Button>}
          <Button variant="ghost" size="md" style={btnCompact} onClick={h.onCalibCancel}>Cancel</Button>
        </div>
      )}
      {plan.pageChange && (
        <div data-testid="overlay-page" style={{ display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap" }}>
          <span style={{ ...valueStyle, color: "var(--text-secondary)" }}>Page</span>
          <button type="button" ref={pageRef} data-page-stepper style={{ ...rowIconBtn, border: LINE, color: "var(--text-primary)", fontSize: C, fontWeight: 400 }} aria-label="Previous page" disabled={!h.pageReady(o) || o.page <= 1} onClick={() => h.onSetPage(o.id, o.page - 1)}>‹</button>
          <span style={valueStyle}>{o.page} / {o.pageCount}</span>
          <button type="button" ref={pageNextRef} style={{ ...rowIconBtn, border: LINE, color: "var(--text-primary)", fontSize: C, fontWeight: 400 }} aria-label="Next page" disabled={!h.pageReady(o) || o.page >= o.pageCount} onClick={() => h.onSetPage(o.id, o.page + 1)}>›</button>
          {!h.pageReady(o) && <span style={subStyle}>re-add to change page</span>}
        </div>
      )}
      {plan.rotate && <RotationRow o={o} h={h} />}
    </section>
  );
}

/* The Crop on/off switch — a real `role="switch"`: Site green when on, neutral grey when off. */
function CropSwitch({ id, on, disabled, why, onToggle }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label="Crop" disabled={disabled} title={why || undefined} data-testid={`overlay-crop-switch-${id}`}
      onClick={onToggle}
      style={{ flex: "none", position: "relative", width: 32, height: 18, padding: 0, border: "none", borderRadius: RADIUS.pill, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1,
        background: on ? ACCENT : "var(--border-strong)", transition: "background 120ms" }}>
      <span aria-hidden="true" style={{ position: "absolute", top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: RADIUS.pill, background: on ? "var(--on-accent-site)" : "var(--surface-raised)", transition: "left 120ms" }} />
    </button>
  );
}

/* A picture of the sheet with the cropped-away area dimmed and the kept area outlined (dashed, Site green),
 * drawn from the STORED crop in the sheet's own image pixels — so it is always the real shape, rect or polygon. */
function CropPicture({ o, onOpen, why }) {
  const d = cropOutlinePath(o);
  const W = o.imgW, Hh = o.imgH;
  return (
    <button type="button" aria-label="Adjust the crop" disabled={!!why} title={why || undefined} data-testid={`overlay-crop-picture-${o.id}`} onClick={onOpen}
      style={{ flex: "1 1 0", minWidth: 0, height: 112, padding: SPACE.xs, boxSizing: "border-box", display: "grid", placeItems: "center", border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-page)", cursor: why ? "default" : "pointer", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${W} ${Hh}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false" style={{ display: "block", width: "100%", height: "100%", pointerEvents: "none" }}>
        {o.kind === "dxf" || !o.src ? null : <image href={o.src} x="0" y="0" width={W} height={Hh} preserveAspectRatio="none" />}
        <rect x="0" y="0" width={W} height={Hh} fill="none" strokeWidth="1" vectorEffect="non-scaling-stroke" style={{ stroke: "var(--border-strong)" }} />
        {d && <path data-testid="overlay-crop-dim" d={`M0 0H${W}V${Hh}H0Z${d}`} fillRule="evenodd" fill="black" fillOpacity="0.55" />}
        {d && <path data-testid="overlay-crop-outline" d={d} fill="none" strokeWidth="1.5" strokeDasharray="5 3" vectorEffect="non-scaling-stroke" style={{ stroke: ACCENT }} />}
      </svg>
    </button>
  );
}

function CropSection({ o, h }) {
  const why = cropEditBlock(o);
  const on = hasCrop(o);
  // OFF → the crop is hidden but its shape is kept; ON with a kept shape brings the same shape back;
  // ON with no shape yet opens the editor (closing it without a crop leaves the switch off — `on` is derived).
  const toggle = () => {
    if (why) return;
    if (on) h.onCropSwitch(o.id, false);
    else if (hasSavedCrop(o)) h.onCropSwitch(o.id, true);
    else h.onCrop(o.id);
  };
  return (
    <section data-testid={`overlay-crop-${o.id}`} aria-label="Crop" style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm, minHeight: 20 }}>
        <span style={labelStyle}>Crop</span>
        <CropSwitch id={o.id} on={on} disabled={!!why} why={why} onToggle={toggle} />
      </div>
      {on && (
        <div data-testid="overlay-crop-body" style={{ display: "flex", alignItems: "flex-start", gap: SPACE.sm }}>
          <CropPicture o={o} why={why} onOpen={() => h.onCrop(o.id)} />
          <Button variant="ghost" size="md" disabled={!!why} title={why || undefined} style={btnCompact} data-testid="overlay-crop-open" onClick={() => h.onCrop(o.id)}>Adjust</Button>
        </div>
      )}
    </section>
  );
}

/* Draws: a compact two-segment switch — the selected segment is a dark neutral, never the accent. */
function DrawsToggle({ id, band, onSet }) {
  const seg = (key, label, title) => {
    const on = band === key;
    return (
      <button key={key} type="button" aria-pressed={on} title={title} data-testid={`reference-${key}-${id}`} onClick={() => onSet(key === "above")}
        style={{ border: "none", cursor: "pointer", fontFamily: "inherit", fontSize: C, fontWeight: 400, lineHeight: 1, whiteSpace: "nowrap", height: "100%", padding: "0 5px", borderRadius: RADIUS.sm,
          background: on ? "var(--text-primary)" : "transparent", color: on ? "var(--surface-raised)" : "var(--text-primary)" }}>{label}</button>
    );
  };
  return (
    <div role="group" aria-label="Draws" style={{ display: "inline-flex", flex: "none", boxSizing: "border-box", height: H, padding: 1, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-raised)" }}>
      {seg("below", "Behind the plan", "Under the parcel boundary, the setback ring and the site elements")}
      {seg("above", "In front", "Over the parcel boundary, the setback ring and the site elements")}
    </div>
  );
}

function AppearanceSection({ o, plan, isMap, h }) {
  const [pctDraft, setPctDraft] = useState(null);
  const [pctFocus, setPctFocus] = useState(false);
  const pct = pctDraft != null ? pctDraft : Math.round((o.opacity ?? 1) * 100);
  const band = overlayBand(o);
  return (
    <section data-testid="overlay-appearance" aria-label="Appearance" style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      <SectionLabel>Appearance</SectionLabel>
      <label style={{ display: "flex", alignItems: "center", gap: SPACE.sm, minHeight: H }}>
        <span style={{ ...valueStyle, color: "var(--text-secondary)", flex: "none" }}>Opacity</span>
        <input type="range" min={0.1} max={1} step={0.05} value={o.opacity ?? 1} aria-label="Opacity" style={{ flex: "1 1 60px", minWidth: 0, margin: 0, accentColor: ACCENT }}
          {...h.sliderHistory((e) => { h.onPatch(o.id, { opacity: +e.target.value }, false); setPctDraft(null); })} />
        {/* plain text ("85%") that becomes editable on click / focus — no box, no separate % */}
        <input type="text" inputMode="numeric" aria-label="Overlay opacity percent" data-testid="overlay-opacity-pct" title="Click to type a value"
          style={{ ...valueStyle, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, flex: "none", boxSizing: "border-box", width: 40, height: H, padding: 0, border: "none", borderBottom: pctFocus ? `1px solid ${ACCENT}` : "1px solid transparent", borderRadius: 0, background: "transparent", textAlign: "right", outline: "none", cursor: "text" }}
          value={pctFocus ? pct : `${pct}%`}
          onFocus={(e) => { setPctFocus(true); h.pushHistory(); e.currentTarget.select(); }}
          onChange={(e) => { const t = e.target.value.replace(/[^0-9]/g, ""); setPctDraft(t); const n = Math.round(+t); if (t !== "" && Number.isFinite(n)) h.onPatch(o.id, { opacity: Math.min(1, Math.max(0.1, n / 100)) }, false); }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } }}
          onBlur={() => { setPctDraft(null); setPctFocus(false); }} />
      </label>
      {!isMap && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACE.xs }}>
          <span style={{ ...valueStyle, color: "var(--text-secondary)", flex: "none" }}>Draws</span>
          <DrawsToggle id={o.id} band={band} onSet={(front) => h.onSetBand(o.id, front)} />
        </div>
      )}
      {plan.knockout && h.pageReady(o) && (
        <label style={{ display: "flex", alignItems: "center", gap: SPACE.sm, cursor: "pointer" }} title="Make the sheet's white paper transparent so the map shows through the linework">
          <input type="checkbox" checked={o.knockout !== false} style={{ margin: 0, accentColor: ACCENT }} onChange={(e) => h.onKnockout(o.id, e.target.checked)} />
          <span style={valueStyle}>Knock out white paper</span>
        </label>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------- ⋯ menu */

function RowMenu({ open, anchorRef, o, flags, hidden, hasParcel, isMap, onClose, h }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { const first = ref.current && ref.current.querySelector("button:not([disabled])"); if (first) first.focus(); }, 0);
    return () => clearTimeout(t);
  }, [open]);
  if (!open) return null;
  const locked = !!o.locked;
  // after an action focus returns to the ⋯ button (never <body>); Rename / Change page hand focus to their own field instead
  const run = (fn, keepFocus) => () => { onClose(); fn(); if (!keepFocus) setTimeout(() => { if (anchorRef.current) anchorRef.current.focus(); }, 0); };
  const onKeyDown = (e) => {
    const items = Array.from(ref.current.querySelectorAll("button:not([disabled])"));
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
    else if (e.key === "Tab") { if (anchorRef.current) anchorRef.current.focus(); onClose(); }   // focus the trigger, let Tab carry on from it
    // Escape is handled HERE as well as by AnchoredMenu's window listener: the planner's own window-level Escape
    // handling (clear the selection) must not also run, and the focus goes back to the ⋯ button that opened it.
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); if (anchorRef.current) anchorRef.current.focus(); }
  };
  const it = (text, fn, extra = {}) => <MenuItem key={text} role="menuitem" disabled={!!extra.disabled} title={extra.title} style={extra.danger ? { color: "var(--danger-text)" } : undefined} onClick={run(fn, extra.keepFocus)}>{text}</MenuItem>;
  return (
    <AnchoredMenu open onClose={() => { onClose(); if (anchorRef.current) anchorRef.current.focus(); }} anchorRef={anchorRef} placement="below-right" width={210}>
      <div ref={ref} role="menu" aria-label={`${o.name} actions`} data-testid="overlay-row-menu" onKeyDown={onKeyDown}>
        {it("Rename…", () => h.onRename(o.id), { keepFocus: true })}
        {(o.pageCount || 1) > 1 && it("Change page…", () => h.onChangePage(o.id), { keepFocus: true })}
        {it(locked ? "Unlock" : "Lock in place", () => h.onPatch(o.id, { locked: !locked }))}
        {it(hidden ? "Show" : "Hide", () => h.onToggleHide(o))}
        {it("Zoom to", () => h.onZoomTo(o.id))}
        {it("Size to view", () => h.onSizeToView(o.id), { disabled: isMap, title: isMap ? "The map capture is already to scale" : undefined })}
        {it("Copy", () => h.onCopy(o.id), { disabled: isMap, title: isMap ? "The map capture can't be copied — it is pinned to this plan" : undefined })}
        {it("Duplicate", () => h.onDuplicate(o.id), { disabled: isMap, title: isMap ? "The map capture can't be duplicated — it is pinned to this plan" : undefined })}
        {it("Align to parcel edge", () => h.onAlignEdge(o.id), { disabled: !hasParcel || isMap, title: isMap ? "The map capture is already to scale" : !hasParcel ? "Draw or load a parcel first" : "Click a parcel edge to snap this overlay parallel to it" })}
        {it("Move up", () => h.onStep(o.id, 1), { disabled: flags.atFront })}
        {it("Move down", () => h.onStep(o.id, -1), { disabled: flags.atBack })}
        <div style={{ borderTop: LINE, margin: `${SPACE.xs}px 0` }} />
        {it("Remove overlay", () => h.onRemove(o), { danger: true })}
      </div>
    </AnchoredMenu>
  );
}

/* ---------------------------------------------------------------- one list row */

function OverlayRow({ o, on, hidden, flags, menuOpen, renaming, drag, h, isMap, hasParcel, loadErr, basemapNote, calib, calibMsg, pageFocusTick }) {
  const menuBtn = useRef(null);
  const [nameDraft, setNameDraft] = useState(null);      // null = show the overlay's own name (one source); a string = the text being typed
  useEffect(() => { setNameDraft(null); }, [renaming]);
  const sub = overlaySubline(o);
  const plan = placementPlan(o);
  const locked = !!o.locked;
  const canDrag = drag.enabled && !renaming && !flags.pinned;
  const finishRename = (commit) => {
    const name = (nameDraft == null ? o.name || "" : nameDraft).trim();
    h.onRenameDone(o.id, commit && name && name !== o.name ? name : null);
    setTimeout(() => { const b = document.querySelector(`[data-testid="reference-more-${o.id}"]`); if (b) b.focus(); }, 0);
  };
  const indicator = drag.over && drag.over.id === o.id ? drag.over.side : null;
  const line = { position: "absolute", left: 0, right: 0, height: 2, background: ACCENT, pointerEvents: "none" };
  return (
    <div data-testid={`reference-row-${o.id}`} data-reference-band={overlayBand(o)} data-reference-frommap={isMap ? "1" : undefined} data-overlay-row={o.id}
      style={{ position: "relative", borderBottom: "1px solid var(--planner-border)", borderLeft: `2px solid ${on ? ACCENT : "transparent"}`, opacity: drag.dragging === o.id ? 0.5 : 1 }}
      onDragOver={(e) => {
        if (!drag.enabled || !drag.dragging || drag.dragging === o.id) return;
        const r = e.currentTarget.getBoundingClientRect(), side = e.clientY < r.top + r.height / 2 ? "front" : "behind";
        e.preventDefault();
        // a drop the order rules would refuse (another band, or beneath the pinned map capture) shows the browser's no-drop cursor, not a move
        if (!drag.canDrop(o.id, side)) { e.dataTransfer.dropEffect = "none"; drag.onOver(null, null); return; }
        e.dataTransfer.dropEffect = "move"; drag.onOver(o.id, side);
      }}
      onDrop={(e) => { if (!drag.dragging) return; e.preventDefault(); e.stopPropagation(); drag.onDrop(o.id); }}>
      {indicator === "front" && <span aria-hidden="true" style={{ ...line, top: -1 }} />}
      {indicator === "behind" && <span aria-hidden="true" style={{ ...line, bottom: -1 }} />}
      <div draggable={canDrag} data-overlay-drag-handle={canDrag ? "1" : undefined} data-cursor={canDrag ? "grab" : undefined}
        onDragStart={(e) => { if (!canDrag) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("application/x-planyr-overlay", o.id); } catch (_) {} drag.onStart(o.id); }}
        onDragEnd={drag.onEnd}
        style={{ display: "flex", alignItems: "center", gap: SPACE.xs, padding: `${SPACE.sm}px ${SPACE.sm}px ${SPACE.sm}px ${SPACE.xs}px`, minHeight: 46, cursor: canDrag ? "grab" : undefined, background: on ? `color-mix(in srgb, ${ACCENT} 11%, transparent)` : "transparent" }}>
        <span style={{ display: "flex", alignItems: "center", gap: SPACE.sm, flex: "1 1 0", minWidth: 0 }}>
        <Thumb o={o} />
        {renaming ? (
          <input autoFocus value={nameDraft == null ? o.name || "" : nameDraft} aria-label="Overlay name" data-testid="overlay-rename-input" style={{ ...inputStyle, flex: 1, minWidth: 0 }}
            onChange={(e) => setNameDraft(e.target.value)} onFocus={(e) => e.currentTarget.select()}
            onBlur={() => finishRename(true)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); finishRename(true); } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finishRename(false); } e.stopPropagation(); }} />
        ) : (
          <button type="button" data-testid={`reference-open-${o.id}`} aria-expanded={on} onClick={() => h.onSelect(on ? null : o.id)}
            onKeyDown={(e) => { if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown") && !flags.pinned) { e.preventDefault(); h.onStep(o.id, e.key === "ArrowUp" ? 1 : -1); } }}
            onContextMenu={(e) => h.onContext(e, o.id)}
            title={`${o.name}${isMap ? " — the map capture; always draws beneath everything" : ""}`}
            style={{ flex: 1, minWidth: 0, textAlign: "left", border: "none", background: "transparent", padding: 0, cursor: "pointer", fontFamily: "inherit", color: "inherit", display: "flex", flexDirection: "column", gap: 1 }}>
            <span data-testid="overlay-row-name" style={{ ...valueStyle, fontWeight: 500, color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25 }}>{o.name}</span>
            <span data-testid="overlay-row-sub" style={{ ...subStyle, color: sub.warn ? WARN : "var(--text-secondary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{sub.text}</span>
          </button>
        )}
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 0, flex: "none" }}>
        <button type="button" style={{ ...rowIconBtn, color: hidden ? "var(--text-secondary)" : "var(--text-primary)" }} data-testid={`reference-eye-${o.id}`} aria-pressed={!hidden} aria-label={hidden ? `Show ${o.name}` : `Hide ${o.name}`} title={hidden ? "Show" : "Hide"} onClick={() => h.onToggleHide(o)}>{hidden ? <EyeOffIcon /> : <EyeIcon />}</button>
        <button type="button" style={rowIconBtn} data-testid={`reference-lock-${o.id}`} aria-pressed={locked} aria-label={locked ? `Unlock ${o.name}` : `Lock ${o.name}`} title={locked ? "Unlock" : "Lock in place"} onClick={() => h.onPatch(o.id, { locked: !locked })}>{locked ? <LockGlyph size={14} /> : <UnlockGlyph />}</button>
        <button type="button" ref={menuBtn} style={rowIconBtn} data-testid={`reference-more-${o.id}`} aria-haspopup="menu" aria-expanded={menuOpen} aria-label={`More actions for ${o.name}`} title="More" onClick={() => h.onMenu(menuOpen ? null : o.id)}><MoreIcon /></button>
        </span>
      </div>
      <RowMenu open={menuOpen} anchorRef={menuBtn} o={o} flags={flags} hidden={hidden} hasParcel={hasParcel} isMap={isMap} onClose={() => h.onMenu(null)} h={h} />
      {isMap && loadErr === "remote" && (
        <div style={{ ...subStyle, color: WARN, padding: `0 ${SPACE.md}px ${SPACE.md}px`, lineHeight: 1.45 }}>Aerial image didn't load from the source. Your boundary and tools still work — go back to the map and re-pick the site, or drop a screenshot here instead.</div>
      )}
      {on && (
        <div data-testid={`overlay-open-${o.id}`} style={{ display: "flex", flexDirection: "column", gap: SPACE.lg, padding: `${SPACE.xs}px ${SPACE.md}px ${SPACE.lg}px` }}>
          {!isMap && <PlacementSection o={o} plan={plan} calib={calib} calibMsg={calibMsg} locked={locked} h={h} pageFocusTick={pageFocusTick} />}
          {!isMap && <CropSection o={o} h={h} />}
          <AppearanceSection o={o} plan={plan} isMap={isMap} h={h} />
          {isMap && basemapNote && <div style={subStyle}>Hidden while the live map basemap is on — the basemap IS the aerial there.</div>}
        </div>
      )}
    </div>
  );
}

/* A row from another plan of this site: hidden-style, not openable, eye → onShowForeign. */
function ForeignRow({ row, onShowForeign }) {
  return (
    <div data-testid={`reference-row-${row.id}`} data-foreign="1" style={{ display: "flex", alignItems: "center", gap: SPACE.sm, padding: `${SPACE.sm}px ${SPACE.sm}px ${SPACE.sm}px ${SPACE.xs}px`, minHeight: 46, borderBottom: "1px solid var(--planner-border)", borderLeft: "2px solid transparent" }}>
      <Thumb o={{ ...row, visible: false }} />
      <span style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1, opacity: 0.75 }}>
        <span style={{ ...valueStyle, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", lineHeight: 1.25 }}>{row.name}</span>
        <span data-testid="overlay-row-sub" style={subStyle}>added on {row.foreign.planName}</span>
      </span>
      <button type="button" style={{ ...rowIconBtn, color: "var(--text-secondary)" }} data-testid={`reference-eye-${row.id}`} aria-pressed={false} aria-label={`Show ${row.name} on this plan`} title="Show on this plan" onClick={() => onShowForeign && onShowForeign(row)}><EyeOffIcon /></button>
    </div>
  );
}

/* ---------------------------------------------------------------- the panel */

export default function OverlaysPanel({
  overlays, selId, showAerial, hasParcel, busy, loadErr, basemapNote,
  calib, calibMsg, menuId, renamingId, pageFocusTick, onShowForeign, handlers,
}) {
  const h = handlers;
  const [dragging, setDragging] = useState(null);
  const [over, setOver] = useState(null);                 // { id, side }
  const [fileOver, setFileOver] = useState(false);
  const depth = useRef(0);
  const fileRef = useRef(null);
  const fine = !isCoarsePointer();
  const local = useMemo(() => overlays.filter((o) => !o.foreign), [overlays]);
  const foreign = useMemo(() => overlays.filter((o) => o.foreign), [overlays]);
  const rows = useMemo(() => overlayPanelOrder(local), [local]);
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const drag = {
    enabled: fine, dragging, over,
    canDrop: (id, side) => canDropOverlay(local, dragging, id, side),
    onStart: setDragging, onEnd: () => { setDragging(null); setOver(null); },
    onOver: (id, side) => setOver((c) => (c && c.id === id && c.side === side ? c : { id, side })),
    onDrop: (id) => { const side = over && over.id === id ? over.side : "front"; const from = dragging; setDragging(null); setOver(null); if (from) h.onDropRow(from, id, side); },
  };
  return (
    <div data-testid="overlays-panel" data-fine-pointer={fine ? "1" : "0"}
      style={{ display: "flex", flexDirection: "column", minWidth: 0, outline: fileOver ? `2px dashed ${ACCENT}` : "none", outlineOffset: -2, borderRadius: RADIUS.sm }}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setFileOver(true); }}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; } }}
      onDragLeave={(e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setFileOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current = 0; setFileOver(false); const fs = e.dataTransfer.files; const f = fs && fs[0]; if (f) h.onDropFile(f, fs.length); }}>
      {/* one accent: the global focus ring is the orange --accent; inside this panel it is the Site green (index.css, "Overlays panel focus") */}
      <div role="list" aria-label="Overlays" style={{ display: "flex", flexDirection: "column" }} onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(null); }}>
        {rows.map((o) => {
          const isMap = !!o.fromMap;
          return (
            <OverlayRow key={o.id} o={o} on={selId === o.id} hidden={isMap ? !showAerial : o.visible === false} flags={overlayOrderFlags(local, o.id)}
              menuOpen={menuId === o.id} renaming={renamingId === o.id} drag={drag} h={h} isMap={isMap} hasParcel={hasParcel}
              loadErr={loadErr && loadErr[o.id]} basemapNote={basemapNote} calib={calib} calibMsg={calibMsg} pageFocusTick={selId === o.id ? pageFocusTick : 0} />
          );
        })}
        {foreign.map((r) => <ForeignRow key={r.id} row={r} onShowForeign={onShowForeign} />)}
      </div>
      <button type="button" data-testid="overlay-add" disabled={busy} onClick={() => { if (!busy) fileRef.current?.click(); }}
        style={{ marginTop: SPACE.md, display: "flex", alignItems: "center", justifyContent: "center", gap: SPACE.sm, height: H + 4, padding: "0 12px", border: `1px dashed ${fileOver ? ACCENT : "var(--border-default)"}`, borderRadius: RADIUS.sm, background: fileOver ? `color-mix(in srgb, ${ACCENT} 11%, transparent)` : "var(--surface-raised)", color: ACCENT_TEXT, fontSize: C, fontWeight: 400, fontFamily: "inherit", cursor: busy ? "default" : "pointer" }}>
        {busy ? "Loading…" : "Add overlay"}
      </button>
      <input ref={fileRef} type="file" accept="application/pdf,image/*,.dxf,.dwg" style={{ display: "none" }} data-testid="overlay-file-input" onChange={(e) => { h.onAddFile(e.target.files && e.target.files[0]); e.target.value = ""; }} />
    </div>
  );
}
