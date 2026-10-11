import { CONTROL_H } from "./designTokens.js";
import { FONT_SIZE } from "./designTokens.js";
import { RADIUS } from "./radius.js";
import { NUM_FONT, TABULAR_NUMS } from "../theme/typography.js";

/* NumberBox — Building panel v3 (NEW-2). ONE bordered box holding a number's value, its unit and a slim
 * stacked ▲▼ at the right edge. A frame, not a field: the caller supplies the <input> (so every existing
 * numeric control — NumInput's commit/clamp/"Using N" behaviour, RotationStepper's wrap — keeps its own logic and
 * only its chrome changes). The input gets `NUMBOX_INPUT_STYLE` (borderless, right-aligned, tabular); the
 * frame draws the one outline, the focus ring (`:focus-within`, index.css) and the invalid state.
 *
 * ▲▼ use onMouseDown preventDefault so a click steps the committed value rather than first blurring (and
 * committing) a half-typed draft. `data-num-stepper` is the same marker the phone sheet's touch rules
 * already target. Module scope; theme tokens only. */
export const NUMBOX_INPUT_STYLE = {
  flex: "1 1 auto", minWidth: 0, width: "100%", height: "100%", boxSizing: "border-box", padding: "0 4px 0 6px", margin: 0,
  border: "none", borderRadius: 0, background: "transparent", color: "var(--text-primary)", textAlign: "right",
  fontSize: FONT_SIZE.control, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS,
};

export default function NumberBox({ children, unit, onUp, onDown, upLabel = "Increase", downLabel = "Decrease", upTitle, downTitle, disabled = false, width = 76, style, testid }) {
  const stepBtn = (label, title, onClick, glyph) => (
    <button type="button" tabIndex={-1} disabled={disabled} aria-label={label} title={title}
      onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      style={{ flex: "1 1 0", minHeight: 0, width: "100%", padding: 0, display: "grid", placeItems: "center", border: "none", background: "transparent",
        color: "var(--text-secondary)", fontSize: FONT_SIZE.micro, lineHeight: 1, fontFamily: "inherit", cursor: disabled ? "not-allowed" : "pointer" }}>{glyph}</button>
  );
  return (
    <span data-numbox="1" data-testid={testid}
      style={{ display: "inline-flex", alignItems: "stretch", boxSizing: "border-box", width, height: CONTROL_H.md, flex: "none", overflow: "hidden",
        border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm, background: "var(--surface-raised)", opacity: disabled ? 0.5 : 1, ...style }}>
      {children}
      {unit ? <span aria-hidden="true" style={{ flex: "none", alignSelf: "center", paddingRight: 4, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{unit}</span> : null}
      {onUp && onDown ? (
        <span data-num-stepper="1" style={{ flex: "none", display: "flex", flexDirection: "column", width: 16, borderLeft: "1px solid var(--border-default)" }}>
          {stepBtn(upLabel, upTitle || "Increase", onUp, "▲")}
          {stepBtn(downLabel, downTitle || "Decrease", onDown, "▼")}
        </span>
      ) : null}
    </span>
  );
}
