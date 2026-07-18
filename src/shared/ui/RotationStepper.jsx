/* Shared ROTATION STEPPER (B463 / owner "NEW-3").
 *
 * The ONE rotation control for the whole app — it RETIRES the old 0–360 drag slider. Used
 * today by the Site Planner's overlay panel, markup panel, and element panel; the shared
 * markup engine and any future Document Review rotatable object import this same widget so
 * rotation looks and behaves identically everywhere (no second slider to drift out of sync).
 *
 * Behavior (owner spec, NEW-3):
 *  • Type-to-set: edit the field freely and type an exact value, up to TWO decimals
 *    (hundredth-degree). Commit on Enter / blur / spinner — never live on each keystroke
 *    (so a partial "3." or "-" never re-renders the canvas).
 *  • Spinner buttons ▲▼ nudge ±1° per press (coarse). In the focused field, ArrowUp/Down =
 *    ±1°, Shift+Arrow = ±0.1° (fine). So coarse = buttons, fine = type or Shift+Arrow.
 *  • Normalize / wrap on commit into [0,360): typing 370 → 10, −5 → 355. The committed,
 *    displayed value is therefore always 0–359.99.
 *  • Display rounds to ≤2 decimals, but the STORED value keeps full precision and the spinner
 *    nudges the stored value (never the displayed round), so repeated nudges never drift.
 *  • Empty input on blur reverts to the last committed value (never zeroes it); non-numeric /
 *    pasted garbage flashes the field red and reverts, rather than silently clamping to 0.
 *  • Locked target: the whole control is disabled with a visible reason (tooltip) — it
 *    REFUSES rotation, it does not fail silently.
 *
 * Inline editor only — no dialog boxes (owner rule, 2026-06-17). Theme tokens only, WCAG AA.
 * The pure helpers (normalizeDeg / parseRotationInput / formatDeg) are exported for unit tests.
 */
import { useEffect, useRef, useState } from "react";
import { NUM_FONT, TABULAR_NUMS } from "../theme/typography.js";

/** Wrap any angle into [0, 360). */
export const normalizeDeg = (n) => (((n % 360) + 360) % 360);

/** Round to hundredths — the input's precision. Applied AFTER normalize so the modulo's
 *  floating-point residue (e.g. 12.34 → 12.339999…) can't survive into the stored value. */
const round2 = (n) => Math.round(n * 100) / 100;
const canon = (n) => round2(normalizeDeg(n));

/** Parse a typed rotation string → a normalized [0,360) value rounded to 2 dp, or null when
 *  the text is not a finite number (so the caller rejects it visibly instead of clamping). */
export function parseRotationInput(text) {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t === "" || t === "-" || t === "." || t === "-." || t === "+") return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return canon(n);
}

/** Format a stored angle for display: normalized, ≤2 decimals, trailing zeros trimmed
 *  (45, 45.5, 45.25 — never 45.00). */
export function formatDeg(n) {
  if (!Number.isFinite(n)) return "0";
  return String(canon(n));
}

const FONT = NUM_FONT;

export default function RotationStepper({
  value, onCommit, onStep, disabled = false, disabledReason,
  style, inputStyle, btnStyle, suffix = "°", "data-testid": testid,
}) {
  const committed = Number.isFinite(value) ? value : 0;
  const [draft, setDraft] = useState(formatDeg(committed));
  const [invalid, setInvalid] = useState(false);
  const editing = useRef(false);
  const flashTimer = useRef(null);

  // Keep the field in sync with the model while the user is NOT actively editing it.
  useEffect(() => { if (!editing.current) setDraft(formatDeg(committed)); }, [committed]);
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current); }, []);

  const revert = () => { setDraft(formatDeg(committed)); setInvalid(false); };
  const flashInvalid = () => {
    setInvalid(true);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => { setInvalid(false); setDraft(formatDeg(committed)); }, 1100);
  };

  const commit = () => {
    editing.current = false;
    const parsed = parseRotationInput(draft);
    if (parsed == null) {
      // Empty → silently revert (never zero). Garbage → flash red, then revert.
      if (draft.trim() === "") revert(); else flashInvalid();
      return;
    }
    setInvalid(false);
    setDraft(formatDeg(parsed));
    if (parsed !== canon(committed)) onCommit(parsed);
  };

  // ±d about the STORED value (no display-round → no accumulated drift). Spinner/keys are
  // inert when locked. onStep (a delta the host applies to its own stored field) is preferred;
  // onCommit (absolute) is the fallback when a host has no delta path.
  const step = (d) => {
    if (disabled) return;
    const next = normalizeDeg(committed + d);
    editing.current = false;
    setInvalid(false);
    setDraft(formatDeg(next));
    if (onStep) onStep(d); else onCommit(next);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") { e.currentTarget.blur(); return; }
    if (e.key === "Escape") { revert(); e.currentTarget.blur(); return; }
    if (e.key === "ArrowUp")   { e.preventDefault(); step(e.shiftKey ? 0.1 : 1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); step(e.shiftKey ? -0.1 : -1); return; }
  };

  const baseInput = {
    width: 52, padding: "6px 8px", fontSize: 12, fontFamily: FONT, fontVariantNumeric: TABULAR_NUMS, borderRadius: 8,
    border: `1px solid ${invalid ? "var(--danger)" : "var(--border-default)"}`,
    color: "var(--text-primary)", background: "var(--surface-raised)",
    opacity: disabled ? 0.5 : 1,
  };
  const baseBtn = {
    width: 20, height: 13, padding: 0, display: "grid", placeItems: "center", fontSize: 10.5,
    lineHeight: 1, border: `1px solid var(--border-default)`, borderRadius: 4,
    background: "var(--surface-raised)", color: "var(--text-secondary)",
    cursor: disabled ? "not-allowed" : "pointer", fontFamily: "inherit",
  };
  const reason = disabled && disabledReason ? disabledReason : undefined;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, ...style }} title={reason}>
      <input
        data-testid={testid}
        style={{ ...baseInput, ...inputStyle }}
        value={draft}
        inputMode="decimal"
        disabled={disabled}
        aria-label="Rotation in degrees"
        aria-invalid={invalid || undefined}
        onFocus={() => { editing.current = true; }}
        onChange={(e) => { setDraft(e.target.value); if (invalid) setInvalid(false); }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {suffix && <span style={{ fontSize: 11, color: "var(--text-secondary)" }}>{suffix}</span>}
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {/* preventDefault on mousedown keeps the input focused so a click steps the stored
            value rather than first firing a blur-commit on a half-typed draft. */}
        <button type="button" style={{ ...baseBtn, ...btnStyle }} disabled={disabled}
          title={reason || "Rotate +1°"} aria-label="Rotate one degree clockwise"
          onMouseDown={(e) => e.preventDefault()} onClick={() => step(1)}>▲</button>
        <button type="button" style={{ ...baseBtn, ...btnStyle }} disabled={disabled}
          title={reason || "Rotate −1°"} aria-label="Rotate one degree counterclockwise"
          onMouseDown={(e) => e.preventDefault()} onClick={() => step(-1)}>▼</button>
      </span>
    </span>
  );
}
