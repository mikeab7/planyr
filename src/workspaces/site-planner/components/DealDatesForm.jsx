/* DealDatesForm — the three contractual-date fields on a pursuit (B1161793, NEW-2): when its
 * feasibility period ends, when an LOI response is due, and its closing date. Opened from
 * MapFinder.jsx's per-site right-click menu, inside a ContextMenu (the app's one context-menu
 * primitive — see that component's own header) rather than a `window.prompt` dialog, per the
 * root CLAUDE.md's standing "no dialog-box edits — inline editors only" rule. Each field commits
 * the instant it changes (a native date input has nothing further to "confirm").
 */
import { Field } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";

const inputStyle = {
  width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12, borderRadius: RADIUS.sm, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};

const DATE_FIELDS = [
  { key: "feasibilityExpiry", label: "Feasibility ends" },
  { key: "loiDate", label: "LOI response due" },
  { key: "closingDate", label: "Closing" },
];

export default function DealDatesForm({ site, onChange }) {
  return (
    <div style={{ padding: "8px 12px 4px", minWidth: 200 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 6 }}>
        Deal dates
      </div>
      {DATE_FIELDS.map(({ key, label }) => (
        <Field key={key} label={label} stacked>
          <input
            type="date"
            value={site?.[key] || ""}
            onChange={(e) => onChange({ [key]: e.target.value || null })}
            style={inputStyle}
          />
        </Field>
      ))}
    </div>
  );
}
