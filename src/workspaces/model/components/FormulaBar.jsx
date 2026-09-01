/* Model workspace — the formula bar row: the NAME BOX (Stage 1 — "type C50, go there"; Ctrl+G
 * focuses it, wired by ModelApp.jsx via `nameBoxRef`) beside the fx formula input, which shows
 * the UNDERLYING formula (or raw typed text) for the active cell, never the displayed/formatted
 * value (the build brief is explicit about this distinction). Editable in its own right, same
 * commit contract as the in-cell editor — typing "=…" here and pressing Enter sets the cell's
 * formula exactly as it would in-cell.
 */
import { useEffect, useState } from "react";
import { formulaBarText } from "../lib/sheetEngine.js";
import { parseNameBoxAddress } from "../lib/sheetOps.js";

function colLabel(colIndex) {
  let n = colIndex + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export default function FormulaBar({ sheet, row, col, onCommit, onGoTo, nameBoxRef }) {
  const address = `${colLabel(col)}${row + 1}`;
  const [value, setValue] = useState(() => formulaBarText(sheet, row, col));
  const [nameValue, setNameValue] = useState(address);
  const [nameFocused, setNameFocused] = useState(false);

  useEffect(() => { setValue(formulaBarText(sheet, row, col)); }, [sheet, row, col]);
  // Never stomp what the user is mid-typing into the Name Box — only re-seed it from the
  // active cell's own address while it does NOT have focus (the same "seed on cell change,
  // but never fight a live edit" contract the fx box already has via its own value/blur split).
  useEffect(() => { if (!nameFocused) setNameValue(address); }, [address, nameFocused]);

  const commit = () => onCommit(row, col, value);

  const goToTyped = () => {
    const target = parseNameBoxAddress(nameValue, sheet.rowCount, sheet.columns.length);
    if (target) onGoTo(target.r, target.c);
    else setNameValue(address); // an address that doesn't resolve reverts rather than navigating blindly
  };

  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
      <input
        ref={nameBoxRef}
        data-testid="model-name-box"
        title="Name Box — type a cell address and press Enter to jump there (Ctrl+G)"
        value={nameValue}
        onFocus={(e) => { setNameFocused(true); e.target.select(); }}
        onChange={(e) => setNameValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); goToTyped(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); setNameValue(address); e.currentTarget.blur(); }
        }}
        onBlur={() => { setNameFocused(false); setNameValue(address); }}
        style={{ flex: "none", width: 64, textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums", border: "1px solid var(--border-default)", borderRadius: 4, padding: "3px 4px", background: "var(--surface-page)" }}
      />
      <span aria-hidden="true" style={{ flex: "none", fontSize: 12, fontWeight: 700, fontStyle: "italic", color: "var(--text-tertiary)" }}>fx</span>
      <input
        data-testid="model-formula-bar"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { e.preventDefault(); setValue(formulaBarText(sheet, row, col)); e.currentTarget.blur(); }
        }}
        onBlur={commit}
        style={{ flex: 1, minWidth: 0, border: "1px solid var(--border-default)", borderRadius: 4, padding: "3px 8px", font: "inherit", fontSize: 12.5, fontVariantNumeric: "tabular-nums", background: "var(--surface-page)", color: "var(--text-primary)" }}
      />
    </div>
  );
}
