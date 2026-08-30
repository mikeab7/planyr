/* Model workspace — the number-format picker (build brief item 6): currency, percent,
 * 0/1/2 decimals, thousands, accounting parens, $/SF. A native <select> rather than a custom
 * popover — a dropdown of nine short labels doesn't need AnchoredMenu's machinery, and this
 * ships correct keyboard/accessibility behavior for free.
 *
 * Applies to every COLUMN the current selection spans (not a per-cell override) — see
 * lib/sheetModel.js's setNumberFormat. That is a deliberate v1 simplification consistent with
 * formulas also being per-column: "format this column as currency" is the common underwriting
 * case (a whole Rent or Cost column), and it keeps one column from showing two different
 * formats depending which row you're on.
 */
import { NUMBER_FORMATS } from "../lib/numberFormats.js";

export default function NumberFormatPicker({ token, onChange }) {
  const current = NUMBER_FORMATS.find((f) => f.token === (token || null));
  return (
    <select
      data-testid="model-format-picker"
      value={current ? current.id : "general"}
      onChange={(e) => {
        const preset = NUMBER_FORMATS.find((f) => f.id === e.target.value);
        onChange(preset ? preset.token : null);
      }}
      title="Number format for the selected column(s)"
      style={{
        font: "inherit", fontSize: 12.5, padding: "4px 6px", borderRadius: 6,
        border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
      }}
    >
      {NUMBER_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
    </select>
  );
}
