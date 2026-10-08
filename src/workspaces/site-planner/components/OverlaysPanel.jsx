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
 * labels fit unwrapped) or one column of three — never 2 + 1. The rotation row is flex-wrap, so the
 * two 90° buttons drop below only when the panel is genuinely too narrow.
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
import { SCALE_PRESETS, feetPerInchForPreset, feetPerInchFromPair, matchScalePreset, scaleForFtPerPoint, PAGE_UNITS, REAL_UNITS } from "../../../shared/overlay/overlayScale.js";
import { hasCrop, cropKind, cropEditBlock } from "../../../shared/overlay/overlayCrop.js";
import { overlayBand, overlayPanelOrder, overlayOrderFlags } from "../lib/overlayOrder.js";
import { overlaySubline, placementPlan, formatScaleRatio, OV_KIND } from "../lib/overlayPanelModel.js";
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
const FOCUS_CSS = `[data-testid="overlays-panel"] :is(button,input,select):focus-visible{outline:2px solid ${ACCENT};outline-offset:1px;box-shadow:none}
[data-testid="overlays-panel"] input:not([type=range],[type=checkbox]):focus{border-color:${ACCENT};box-shadow:none}`;
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

function Ico({ children, size = 14 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flex: "none", display: "block" }}>{children}</svg>;
}
const SheetIcon = () => <Ico size={16}><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4" /></Ico>;
const RectIcon = () => <Ico><rect x="4" y="6" width="16" height="12" rx="1" strokeDasharray="3 2" /></Ico>;
const PolyIcon = () => <Ico><path d="M5 17l3-11 9 3 2 8z" strokeDasharray="3 2" /></Ico>;
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

/* [− value° +] — 1° per press, the value typeable (commit on Enter / blur, Esc reverts). */
function DegStepper({ value, disabled, reason, onCommit, onStep }) {
  const committed = Number.isFinite(value) ? value : 0;
  const [draft, setDraft] = useState(formatDeg(committed));
  const editing = useRef(false);
  useEffect(() => { if (!editing.current) setDraft(formatDeg(committed)); }, [committed]);
  const commit = () => {
    editing.current = false;
    const p = parseRotationInput(draft);
    if (p == null) { setDraft(formatDeg(committed)); return; }
    if (p !== normalizeDeg(committed)) onCommit(p);
    setDraft(formatDeg(p));
  };
  const step = (d) => { editing.current = false; onStep(d); };
  const stepBtn = { ...rowIconBtn, width: H, height: "100%", borderRadius: 0, color: "var(--text-primary)", fontSize: C, fontWeight: 400 };
  return (
    <span role="group" aria-label="Rotation" title={disabled ? reason : undefined} style={{ display: "inline-flex", alignItems: "stretch", boxSizing: "border-box", height: H, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-raised)", overflow: "hidden", opacity: disabled ? 0.55 : 1 }}>
      <button type="button" style={{ ...stepBtn, borderRight: LINE }} disabled={disabled} aria-label="Rotate 1 degree anticlockwise" data-testid="overlay-rot-minus" onClick={() => step(-1)}>−</button>
      <span style={{ display: "inline-flex", alignItems: "center", paddingRight: SPACE.md }}>
        <input value={draft} disabled={disabled} inputMode="decimal" aria-label="Rotation in degrees" data-testid="overlay-rotation"
          style={{ ...inputStyle, border: "none", background: "transparent", height: "100%", width: 52, padding: "0 1px 0 0", textAlign: "right", outline: "none" }}
          onFocus={() => { editing.current = true; }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
            else if (e.key === "Escape") { editing.current = false; setDraft(formatDeg(committed)); e.currentTarget.blur(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); step(1); }
            else if (e.key === "ArrowDown") { e.preventDefault(); step(-1); }
          }} />
        <span aria-hidden="true" style={{ ...valueStyle, fontFamily: NUM_FONT }}>°</span>
      </span>
      <button type="button" style={{ ...stepBtn, borderLeft: LINE }} disabled={disabled} aria-label="Rotate 1 degree clockwise" data-testid="overlay-rot-plus" onClick={() => step(1)}>+</button>
    </span>
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
        const t = b.firstChild;
        if (!t) return;
        const r = document.createRange(); r.selectNodeContents(t);
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
  }, [buttons.join(",")]);
  return (
    <div ref={ref} data-testid="overlay-scale-group" data-layout={stacked ? "stack" : "row"} style={{ display: "grid", gridTemplateColumns: stacked ? "1fr" : `repeat(${buttons.length}, 1fr)`, gap: GAP }}>
      {buttons.map((k) => (
        <Button key={k} variant="ghost" size="md" disabled={disabled} style={{ ...btnCompact, width: "100%", padding: `0 ${PAD_X}px` }} data-testid={`overlay-scale-${k}`}
          title={disabled ? why : defs[k].title} aria-pressed={active === k} onClick={() => onPick(k)}>{defs[k].label}</Button>
      ))}
    </div>
  );
}

/* 'Set scale' — presets, a custom page = real entry (metric too), and the sheet's own scale note
 * as the suggestion. Local draft state; commits through onApply(feetPerInch). */
function ScaleTools({ o, onApply }) {
  const curFpi = scaleForFtPerPoint(o.ftPerPx);
  const matched = matchScalePreset(curFpi);
  const detected = o.detectedScale > 0 ? o.detectedScale : null;
  const [mode, setMode] = useState(null);      // null → follow the current size; "custom"
  const [page, setPage] = useState("1");
  const [pageUnit, setPageUnit] = useState("in");
  const [real, setReal] = useState(String(detected && o.unscaled ? detected : Math.round(curFpi * 100) / 100));
  const [realUnit, setRealUnit] = useState("ft");
  const [dirty, setDirty] = useState({ page: false, real: false });   // a unit change only commits a distance the person actually typed
  const selVal = mode === "custom" ? "custom" : (matched ? matched.id : (detected && Math.abs(detected - curFpi) < 1e-6 ? "sheet" : "custom"));
  const commit = (next = {}) => {
    const fpi = feetPerInchFromPair({ pageVal: next.page ?? page, pageUnit: next.pageUnit ?? pageUnit, realVal: next.real ?? real, realUnit: next.realUnit ?? realUnit });
    if (fpi) onApply(fpi);
  };
  return (
    <div data-testid="overlay-scale-tools" style={{ display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      <select data-testid="overlay-scale-preset" aria-label="Scale" style={{ ...inputStyle, fontFamily: "inherit", width: "100%" }} value={selVal}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "custom") { setMode("custom"); return; }
          setMode(null);
          if (v === "sheet" && detected) { onApply(detected); return; }
          const p = SCALE_PRESETS.find((x) => x.id === v);
          if (p) onApply(feetPerInchForPreset(p));
        }}>
        {detected && <optgroup label="Read from the sheet"><option value="sheet">{formatScaleRatio(detected)} (suggested)</option></optgroup>}
        <optgroup label="Engineering">{SCALE_PRESETS.filter((p) => p.group === "Engineering").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
        <optgroup label="Architectural">{SCALE_PRESETS.filter((p) => p.group === "Architectural").map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</optgroup>
        <option value="custom">Custom…</option>
      </select>
      {selVal === "custom" && (
        <div data-testid="overlay-scale-custom" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SPACE.xs }}>
          <input style={{ ...inputStyle, width: 46 }} value={page} aria-label="Distance on the page" placeholder="1 or 1/2" onChange={(e) => { setPage(e.target.value); setDirty((d) => ({ ...d, page: true })); }}
            onBlur={(e) => commit({ page: e.currentTarget.value })} onKeyDown={(e) => { if (e.key === "Enter") commit({ page: e.currentTarget.value }); }} />
          <select style={{ ...inputStyle, fontFamily: "inherit" }} value={pageUnit} aria-label="Page unit" onChange={(e) => { setPageUnit(e.target.value); if (dirty.page || dirty.real) commit({ pageUnit: e.target.value }); }}>
            {PAGE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <span style={valueStyle}>=</span>
          <input style={{ ...inputStyle, width: 76 }} value={real} aria-label="Real-world distance" placeholder="real" onChange={(e) => { setReal(e.target.value); setDirty((d) => ({ ...d, real: true })); }}
            onBlur={(e) => commit({ real: e.currentTarget.value })} onKeyDown={(e) => { if (e.key === "Enter") commit({ real: e.currentTarget.value }); }} />
          <select style={{ ...inputStyle, fontFamily: "inherit" }} value={realUnit} aria-label="Real-world unit" onChange={(e) => { setRealUnit(e.target.value); if (dirty.page || dirty.real) commit({ realUnit: e.target.value }); }}>
            {REAL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
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
    <ScaleGroup buttons={plan.scaleButtons} active={mine ? (mine.kind === "align" ? "match" : mine.kind) : null} disabled={locked} why="Unlock this overlay to change its scale" onPick={pick} />
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
      {o.sheet && !o.sheet.std && plan.kind === OV_KIND.PDF && <div role="note" style={{ ...subStyle, color: WARN }}>Non-standard sheet ({o.sheet.label}) — it may have been shrunk; a scale assumes true plot size.</div>}
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
      {plan.rotate && (
        <div data-testid="overlay-rotation-row" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${SPACE.xs}px ${SPACE.md}px` }}>
          <span style={{ ...valueStyle, color: "var(--text-secondary)" }}>Rotation</span>
          <DegStepper value={o.rotation || 0} disabled={locked} reason="Unlock this overlay to rotate it"
            onCommit={(deg) => h.onPatch(o.id, { rotation: deg })} onStep={(d) => h.onPatch(o.id, { rotation: normalizeDeg((o.rotation || 0) + d) })} />
          <span style={{ display: "inline-flex", gap: SPACE.sm }}>
            <Button variant="ghost" size="md" disabled={locked} style={{ ...btnCompact, padding: "0 8px" }} aria-label="Rotate 90 degrees anticlockwise" title="Rotate 90° anticlockwise" data-testid="overlay-rot-ccw90"
              onClick={() => h.onPatch(o.id, { rotation: normalizeDeg((o.rotation || 0) - 90) })}><RotL />90°</Button>
            <Button variant="ghost" size="md" disabled={locked} style={{ ...btnCompact, padding: "0 8px" }} aria-label="Rotate 90 degrees clockwise" title="Rotate 90° clockwise" data-testid="overlay-rot-cw90"
              onClick={() => h.onPatch(o.id, { rotation: normalizeDeg((o.rotation || 0) + 90) })}><RotR />90°</Button>
          </span>
        </div>
      )}
    </section>
  );
}

function CropSection({ o, h }) {
  const why = cropEditBlock(o);
  const kind = hasCrop(o) ? cropKind(o.crop) : null;
  const text = kind === "poly" ? `Polygon · ${(o.crop.pts || []).length} points` : kind === "rect" ? "Rectangle" : "Not cropped";
  return (
    <section data-testid={`overlay-crop-${o.id}`} aria-label="Crop" style={{ display: "flex", flexDirection: "column", gap: SPACE.xs }}>
      <SectionLabel>Crop</SectionLabel>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm, flex: "1 1 110px", minWidth: 0, color: kind ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {kind === "poly" ? <PolyIcon /> : <RectIcon />}<span data-testid="overlay-crop-shape" style={valueStyle}>{text}</span>
        </span>
        <span style={{ display: "inline-flex", gap: SPACE.sm, flex: "none" }}>
          <Button variant="ghost" size="md" disabled={!!why} title={why || "Trim the logo band, title block and margins with a rectangle or a polygon — reversible, the full sheet is kept"} style={btnCompact} data-testid="overlay-crop-open" onClick={() => h.onCrop(o.id)}>Edit</Button>
          <Button variant="ghost" size="md" disabled={!!why || !kind} title={why || "Show the whole sheet again"} style={btnCompact} data-testid="overlay-crop-reset" onClick={() => h.onResetCrop(o.id)}>Reset</Button>
        </span>
      </div>
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
        {it("Size to view", () => h.onSizeToView(o.id), { disabled: isMap || locked, title: isMap ? "The map capture is already to scale" : locked ? "Unlock to resize" : undefined })}
        {it("Copy", () => h.onCopy(o.id), { disabled: isMap, title: isMap ? "The map capture can't be copied — it is pinned to this plan" : undefined })}
        {it("Duplicate", () => h.onDuplicate(o.id), { disabled: isMap, title: isMap ? "The map capture can't be duplicated — it is pinned to this plan" : undefined })}
        {it("Align to parcel edge", () => h.onAlignEdge(o.id), { disabled: locked || !hasParcel || isMap, title: isMap ? "The map capture is already to scale" : locked ? "Unlock to align" : !hasParcel ? "Draw or load a parcel first" : "Click a parcel edge to snap this overlay parallel to it" })}
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
      onDragOver={(e) => { if (!drag.enabled || !drag.dragging || drag.dragging === o.id) return; e.preventDefault(); e.dataTransfer.dropEffect = "move"; const r = e.currentTarget.getBoundingClientRect(); drag.onOver(o.id, e.clientY < r.top + r.height / 2 ? "front" : "behind"); }}
      onDrop={(e) => { if (!drag.dragging) return; e.preventDefault(); e.stopPropagation(); drag.onDrop(o.id); }}>
      {indicator === "front" && <span aria-hidden="true" style={{ ...line, top: -1 }} />}
      {indicator === "behind" && <span aria-hidden="true" style={{ ...line, bottom: -1 }} />}
      <div draggable={canDrag} data-overlay-drag-handle={canDrag ? "1" : undefined}
        onDragStart={(e) => { if (!canDrag) { e.preventDefault(); return; } e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("application/x-planyr-overlay", o.id); } catch (_) {} drag.onStart(o.id); }}
        onDragEnd={drag.onEnd}
        style={{ display: "flex", alignItems: "center", gap: SPACE.xs, padding: `${SPACE.sm}px ${SPACE.sm}px ${SPACE.sm}px ${SPACE.xs}px`, minHeight: 46, background: on ? `color-mix(in srgb, ${ACCENT} 11%, transparent)` : "transparent" }}>
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
    onStart: setDragging, onEnd: () => { setDragging(null); setOver(null); },
    onOver: (id, side) => setOver((c) => (c && c.id === id && c.side === side ? c : { id, side })),
    onDrop: (id) => { const side = over && over.id === id ? over.side : "front"; const from = dragging; setDragging(null); setOver(null); if (from) h.onDropRow(from, id, side); },
  };
  return (
    <div data-testid="overlays-panel" data-fine-pointer={fine ? "1" : "0"}
      style={{ display: "flex", flexDirection: "column", minWidth: 0, outline: fileOver ? `2px dashed ${ACCENT}` : "none", outlineOffset: -2, borderRadius: RADIUS.sm }}
      onDragEnter={(e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current += 1; setFileOver(true); }}
      onDragOver={(e) => { if (hasFiles(e)) e.preventDefault(); }}
      onDragLeave={(e) => { if (!hasFiles(e)) return; depth.current = Math.max(0, depth.current - 1); if (depth.current === 0) setFileOver(false); }}
      onDrop={(e) => { if (!hasFiles(e)) return; e.preventDefault(); e.stopPropagation(); depth.current = 0; setFileOver(false); const fs = e.dataTransfer.files; const f = fs && fs[0]; if (f) h.onDropFile(f, fs.length); }}>
      {/* one accent: the global focus ring is the orange --accent; inside this panel it is the Site green */}
      <style>{FOCUS_CSS}</style>
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
