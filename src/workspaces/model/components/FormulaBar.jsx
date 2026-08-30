/* Model workspace — the formula bar: shows the UNDERLYING formula (or raw typed text) for
 * the active cell, never the displayed/formatted value (the build brief is explicit about
 * this distinction). Editable in its own right, same commit contract as the in-cell editor —
 * typing "=…" here and pressing Enter sets the column's formula exactly as it would in-cell.
 */
import { useEffect, useState } from "react";
import { colAt } from "../lib/sheetModel.js";
import { formulaBarText } from "../lib/sheetEngine.js";

function colLabel(colIndex) {
  let n = colIndex + 1, s = "";
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

export default function FormulaBar({ sheet, row, col, onCommit }) {
  const column = colAt(sheet, col);
  const [value, setValue] = useState(() => formulaBarText(sheet, row, col));

  // Re-seed whenever the active cell (or its content, via any other commit path) changes.
  // Safe to run on every sheet change: this is a single-user, single-tab v1 with no live
  // remote writer, so nothing can change `sheet` while someone is mid-keystroke in this box.
  useEffect(() => { setValue(formulaBarText(sheet, row, col)); }, [sheet, row, col]);

  const commit = () => onCommit(row, col, value);

  return (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
      <span data-testid="model-cell-address" style={{ flex: "none", minWidth: 42, textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--text-tertiary)", fontVariantNumeric: "tabular-nums" }}>
        {colLabel(col)}{row + 1}
      </span>
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
