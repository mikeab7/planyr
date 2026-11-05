/* Line & label style (NEW-2) — the Parcel page's style panel for the three styleable objects:
 * the parcel BOUNDARY, the SETBACK line and the side-length DIMENSION LABELS.
 *
 * A scope selector at the top says what an edit changes: "All parcels (workspace default)" writes the user's
 * default blob (every parcel that does not override follows it); "This parcel only" writes the parcel's own
 * override. Both are optimistic — the canvas repaints on every input event — and the caller persists. With no
 * parcel selected, "This parcel only" is DISABLED (an edit is never applied to nothing) and the panel falls back
 * to the workspace default. "Reset to workspace default" clears the parcel's override.
 *
 * Presentational only (MODULE-SCOPE-COMPONENTS): it owns the scope toggle and the gesture latch, nothing else.
 * Colours are a full native colour input (any hex, no swatch palette); weight is a 1–6 slider (screen pixels,
 * constant across zoom); dashed is an on/off switch (one sensible pattern); label size is points.
 */
import { useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { SegmentedControl, Switch } from "../../../shared/ui/controls.jsx";
import { LOOK_LIMITS, resolveParcelLook, hasParcelOverride, normalizeHex } from "../lib/parcelLook.js";

const eyebrow = { fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" };
const rowStyle = { display: "grid", gridTemplateColumns: "64px minmax(0, 1fr)", columnGap: SPACE.lg, alignItems: "center", padding: `${SPACE.xs}px 0` };
const labelStyle = { fontSize: FONT_SIZE.control, color: "var(--text-secondary)" };
const readout = { minWidth: 34, textAlign: "right", fontSize: FONT_SIZE.control, color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS };
const swatch = { width: 30, height: 22, padding: 0, border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, background: "var(--surface-field)", cursor: "pointer" };

function Row({ label, children }) {
  return <div style={rowStyle}><span style={labelStyle}>{label}</span><div style={{ display: "flex", alignItems: "center", gap: SPACE.md, minWidth: 0 }}>{children}</div></div>;
}

function Slider({ value, min, max, step, onChange, ariaLabel, testid, unit, shown }) {
  return (
    <>
      <input type="range" min={min} max={max} step={step} value={value} aria-label={ariaLabel} data-testid={testid}
        onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1, minWidth: 0, accentColor: "var(--accent-site)" }} />
      <span style={readout}>{shown ?? value}{unit}</span>
    </>
  );
}

function Swatch({ value, fallback, onChange, ariaLabel, testid, inherited }) {
  return <input type="color" value={normalizeHex(value) || normalizeHex(fallback) || value} aria-label={ariaLabel} data-testid={testid} data-inherited={inherited ? "1" : "0"} onChange={(e) => onChange(e.target.value)} style={swatch} />;
}

function Dashed({ checked, onChange, ariaLabel, testid }) {
  return (
    <>
      <Switch checked={checked} aria-label={ariaLabel} data-testid={testid} accent="var(--accent-site)" onAccent="var(--on-accent-site)" onClick={() => onChange(!checked)} />
      <span style={labelStyle}>{checked ? "Dashed" : "Solid"}</span>
    </>
  );
}

export default function ParcelStylePanel({ parcel, workspace, themeHex, onEditDefault, onEditParcel, onBeginGesture, onResetParcel }) {
  const hasParcel = !!parcel;
  const [wantScope, setWantScope] = useState("parcel");
  const scope = hasParcel && wantScope === "parcel" ? "parcel" : "default";
  const gesture = useRef(false);
  const look = resolveParcelLook(scope === "parcel" ? parcel : null, workspace, themeHex);
  const edit = (section, field, value) => {
    if (scope === "parcel") {
      if (!gesture.current) { gesture.current = true; onBeginGesture && onBeginGesture(); }
      onEditParcel(section, field, value);
    } else onEditDefault(section, field, value);
  };
  const endGesture = () => { gesture.current = false; };
  const inh = (sec, field) => scope === "parcel" && look.from[sec][field] !== "parcel";
  const sizeShown = look.labels.sizePt;
  return (
    <div data-testid="parcel-style-panel" data-scope={scope} onBlurCapture={endGesture} onPointerUp={endGesture} onKeyUp={endGesture}>
      <SegmentedControl style={{ width: "100%", height: "auto", minHeight: 30 }} segmentStyle={{ flex: 1, padding: `${SPACE.sm}px ${SPACE.lg}px`, lineHeight: 1.25, textAlign: "center" }} accent="var(--accent-site)" onAccent="var(--on-accent-site)" value={scope} onChange={setWantScope}
        options={[
          { key: "default", label: "All parcels (workspace default)", testid: "parcel-style-scope-default" },
          { key: "parcel", label: "This parcel only", testid: "parcel-style-scope-parcel", disabled: !hasParcel, title: hasParcel ? undefined : "Select a parcel to style it on its own" },
        ]} />
      {!hasParcel && <div style={{ ...labelStyle, marginTop: SPACE.sm }}>Select a parcel to style it on its own.</div>}

      <div style={{ ...eyebrow, marginTop: SPACE.xl, marginBottom: SPACE.xs }}>Boundary</div>
      <Row label="Colour"><Swatch fallback={themeHex.ink} value={look.boundary.color} onChange={(v) => edit("boundary", "color", v)} ariaLabel="Boundary colour" testid="look-boundary-color" inherited={inh("boundary", "color")} /></Row>
      <Row label="Weight"><Slider min={LOOK_LIMITS.weightPx.min} max={LOOK_LIMITS.weightPx.max} step={0.25} value={Math.min(LOOK_LIMITS.weightPx.max, Math.max(LOOK_LIMITS.weightPx.min, look.boundary.weightPx))} onChange={(v) => edit("boundary", "weightPx", v)} ariaLabel="Boundary weight" testid="look-boundary-weight" unit=" px" /></Row>
      <Row label="Line"><Dashed checked={look.boundary.dashed} onChange={(v) => edit("boundary", "dashed", v)} ariaLabel="Boundary dashed" testid="look-boundary-dashed" /></Row>

      <div style={{ ...eyebrow, marginTop: SPACE.xl, marginBottom: SPACE.xs }}>Setback line</div>
      <Row label="Colour"><Swatch fallback={themeHex.ink} value={look.setback.color} onChange={(v) => edit("setback", "color", v)} ariaLabel="Setback line colour" testid="look-setback-color" inherited={inh("setback", "color")} /></Row>
      <Row label="Weight"><Slider min={LOOK_LIMITS.weightPx.min} max={LOOK_LIMITS.weightPx.max} step={0.25} value={Math.min(LOOK_LIMITS.weightPx.max, Math.max(LOOK_LIMITS.weightPx.min, look.setback.weightPx))} onChange={(v) => edit("setback", "weightPx", v)} ariaLabel="Setback line weight" testid="look-setback-weight" unit=" px" /></Row>
      <Row label="Line"><Dashed checked={look.setback.dashed} onChange={(v) => edit("setback", "dashed", v)} ariaLabel="Setback line dashed" testid="look-setback-dashed" /></Row>

      <div style={{ ...eyebrow, marginTop: SPACE.xl, marginBottom: SPACE.xs }}>Dimension labels</div>
      <Row label="Show">
        <Switch checked={look.labels.show} aria-label="Show dimension labels" data-testid="look-labels-show" accent="var(--accent-site)" onAccent="var(--on-accent-site)" onClick={() => edit("labels", "show", !look.labels.show)} />
      </Row>
      <Row label="Colour"><Swatch fallback={themeHex.ink} value={look.labels.color} onChange={(v) => edit("labels", "color", v)} ariaLabel="Dimension label colour" testid="look-labels-color" inherited={inh("labels", "color")} /></Row>
      <Row label="Size"><Slider min={LOOK_LIMITS.sizePt.min} max={LOOK_LIMITS.sizePt.max} step={1} value={sizeShown ?? 11} shown={sizeShown == null ? "Auto" : sizeShown} unit={sizeShown == null ? "" : " pt"} onChange={(v) => edit("labels", "sizePt", v)} ariaLabel="Dimension label size" testid="look-labels-size" /></Row>

      {scope === "parcel" && (
        <button type="button" data-testid="parcel-look-reset" disabled={!hasParcelOverride(parcel)} onClick={onResetParcel}
          style={{ marginTop: SPACE.lg, padding: 0, border: "none", background: "transparent", color: hasParcelOverride(parcel) ? "var(--accent-site-text)" : "var(--text-secondary)", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, cursor: hasParcelOverride(parcel) ? "pointer" : "default" }}>
          Reset to workspace default
        </button>
      )}
    </div>
  );
}
