/* Model workspace — the formula bar row: the NAME BOX (Stage 1 — "type C50, go there"; Ctrl+G
 * focuses it, wired by ModelApp.jsx via `nameBoxRef`) beside the fx formula input, which shows
 * the UNDERLYING formula (or raw typed text) for the active cell, never the displayed/formatted
 * value (the build brief is explicit about this distinction). Editable in its own right, same
 * commit contract as the in-cell editor — typing "=…" here and pressing Enter sets the cell's
 * formula exactly as it would in-cell.
 */
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";
import { useEffect, useRef, useState } from "react";
import { formulaBarText } from "../lib/sheetEngine.js";
import { parseNameBoxAddress } from "../lib/sheetOps.js";

function colLabel(colIndex) {
  let n = colIndex + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export default function FormulaBar({ sheet, row, col, onCommit, onGoTo, nameBoxRef, focusGrid }) {
  const address = `${colLabel(col)}${row + 1}`;
  const [value, setValue] = useState(() => formulaBarText(sheet, row, col));
  const [nameValue, setNameValue] = useState(address);
  const [nameFocused, setNameFocused] = useState(false);
  // B1007280 — an address that doesn't resolve (malformed, or out of the sheet's current
  // bounds — "AA1" on a 26-column sheet) used to revert SILENTLY: the box just snapped back
  // to the current cell's own address with no visible sign anything was rejected, which reads
  // exactly like "I typed something and nothing happened." A brief red-border flash makes the
  // refusal itself visible, per the owner's own instruction: "silently going to the wrong cell
  // is worse than refusing" — refusing still has to be SEEN to count as refusing.
  const [invalid, setInvalid] = useState(false);
  const invalidTimer = useRef(null);
  useEffect(() => () => window.clearTimeout(invalidTimer.current), []);

  useEffect(() => { setValue(formulaBarText(sheet, row, col)); }, [sheet, row, col]);
  // Never stomp what the user is mid-typing into the Name Box — only re-seed it from the
  // active cell's own address while it does NOT have focus (the same "seed on cell change,
  // but never fight a live edit" contract the fx box already has via its own value/blur split).
  useEffect(() => { if (!nameFocused) setNameValue(address); }, [address, nameFocused]);

  const commit = () => onCommit(row, col, value);

  // Returns whether the jump succeeded, so the Enter handler knows whether to hand focus to the
  // grid (a rejected entry stays focused here, visibly flagged, so the user can fix it in place,
  // matching Excel's own Name Box — never hand focus away from an error the user hasn't seen yet).
  const goToTyped = () => {
    const target = parseNameBoxAddress(nameValue, sheet.rowCount, sheet.columns.length);
    if (target) { onGoTo(target.r1, target.c1, target.r2, target.c2); return true; }
    // An address that doesn't resolve reverts rather than navigating blindly — and now says so.
    setNameValue(address);
    setInvalid(true);
    window.clearTimeout(invalidTimer.current);
    invalidTimer.current = window.setTimeout(() => setInvalid(false), 700);
    return false;
  };

  return (
    // NEW-1 (2026-10-29) — a flat, full-width strip flush under the toolbar: the name box on the left,
    // divided from the fx field by one thin line; no shaded pills or inset boxes (the Round 3 card's
    // bordered, rounded inputs are gone). One hairline bottom border separates it from the grid.
    <div style={{ flex: "none", display: "flex", alignItems: "stretch", height: 28, background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)" }}>
      <input
        {...NO_AUTOFILL}
        ref={nameBoxRef}
        data-testid="model-name-box"
        data-invalid={invalid ? "true" : undefined}
        title="Name Box — type a cell address (or a range like C50:E60) and press Enter to jump there (Ctrl+G)"
        value={nameValue}
        onFocus={(e) => { setNameFocused(true); setInvalid(false); e.target.select(); }}
        onChange={(e) => { setNameValue(e.target.value); setInvalid(false); }}
        onKeyDown={(e) => {
          // ⛔ B1290496 — a resolved jump used to just `blur()` this input, which (with nothing
          // else to take focus) leaves `document.activeElement === document.body`: the selection
          // moves to the target cell but the KEYBOARD does not, so every keystroke typed right
          // after is silently discarded — no error, nothing selected, nothing typed. `focusGrid()`
          // hands DOM focus to the sheet grid itself (the same element a mouse click on the target
          // cell would focus), so typing goes straight into the cell exactly like it does in Excel.
          if (e.key === "Enter") { e.preventDefault(); if (goToTyped()) focusGrid?.(); }
          else if (e.key === "Escape") { e.preventDefault(); setNameValue(address); setInvalid(false); focusGrid?.(); }
        }}
        onBlur={() => { setNameFocused(false); setNameValue(address); }}
        style={{
          flex: "none", width: 84, boxSizing: "border-box", textAlign: "center", fontSize: 11, fontWeight: 700,
          color: "var(--text-primary)", fontVariantNumeric: "tabular-nums",
          border: "none", borderRight: "1px solid var(--border-default)", padding: "0 6px", background: "transparent",
          // A rejected address still flashes red (B1007280) — an inset outline now, since there is no box border to recolour.
          outline: invalid ? "1px solid var(--danger)" : undefined, outlineOffset: -1,
          transition: "outline-color 0.15s ease",
        }}
      />
      <span aria-hidden="true" style={{ flex: "none", display: "flex", alignItems: "center", padding: "0 8px 0 10px", fontSize: 12, fontWeight: 700, fontStyle: "italic", color: "var(--text-tertiary)" }}>fx</span>
      <input
        {...NO_AUTOFILL}
        data-testid="model-formula-bar"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); setValue(formulaBarText(sheet, row, col)); e.currentTarget.blur(); }
        }}
        onBlur={commit}
        style={{ flex: 1, minWidth: 0, border: "none", padding: "0 8px 0 0", font: "inherit", fontSize: 12.5, fontVariantNumeric: "tabular-nums", background: "transparent", color: "var(--text-primary)" }}
      />
    </div>
  );
}
