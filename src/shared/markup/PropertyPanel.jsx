/* Shared markup PROPERTY PANEL (B426 / NEW-2).
 *
 * Renders the ordered control list for a selected markup, driven entirely by
 * `schemaForMarkup(markup)`. Pure presentational — no internal state. The host calls
 * `onChange(canonicalKey, value)` and threads it through `writeProp` to produce a patch.
 * Adding a column to a matrix row makes the control appear automatically; nothing else
 * needs to change (the matrix stays the single source of truth).
 *
 * Inline editors only — no dialog boxes (owner rule, 2026-06-17).
 * WCAG AA color-contrast — all text uses theme tokens, never raw low-contrast grays.
 */
import { schemaForMarkup } from "./propertySchema.js";

const FONT = "system-ui, sans-serif";
const L = "var(--text-secondary)";  // label / caption
const T = "var(--text-primary)";    // value text
const B = "var(--border-default)";  // hairlines

function ColorControl({ value, label, onChange }) {
  const hex = (value && /^#[0-9a-fA-F]{3,8}$/.test(value)) ? value : "#000000";
  // <input type="color"> fires `input` live as you move through the palette but `change` only when
  // the dialog closes — so wire `onInput` (flagged live) for instant recolor, `onChange` as the
  // committed value. The host coalesces the live burst into one undo frame. (B562)
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="color" value={hex} aria-label={label}
        onInput={(e) => onChange(e.target.value, { live: true })}
        onChange={(e) => onChange(e.target.value, { live: false })}
        style={{ width: 30, height: 24, padding: 1, border: `1px solid ${B}`, borderRadius: 4, cursor: "pointer", background: "none" }} />
      <span style={{ fontSize: 11, color: L, fontFamily: "ui-monospace, monospace" }}>{hex}</span>
    </label>
  );
}

function NumberControl({ value, min, max, label, onChange }) {
  return (
    <input type="number" value={value ?? ""} min={min} max={max} aria-label={label}
      onChange={(e) => { const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(n); }}
      style={{ width: "100%", padding: "3px 6px", fontSize: 12, fontFamily: "ui-monospace, monospace",
        border: `1px solid ${B}`, borderRadius: 5, background: "var(--surface-page)", color: T }} />
  );
}

function RangeControl({ value, min, max, step, label, onChange }) {
  const pct = Math.round((value ?? 0) * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <input type="range" value={value ?? 0} min={min ?? 0} max={max ?? 1} step={step ?? 0.05} aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, accentColor: "var(--accent)" }} />
      <span style={{ fontSize: 11, fontFamily: "ui-monospace, monospace", color: L, minWidth: 32, textAlign: "right" }}>
        {pct}%
      </span>
    </div>
  );
}

function BoolControl({ value, label, onChange }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
      <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: "var(--accent)", width: 14, height: 14 }} />
      <span style={{ fontSize: 12, color: T }}>{label}</span>
    </label>
  );
}

function EnumControl({ value, options, label, onChange }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)}
      style={{ width: "100%", padding: "3px 6px", fontSize: 12, fontFamily: FONT,
        border: `1px solid ${B}`, borderRadius: 5, background: "var(--surface-page)", color: T }}>
      {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export default function PropertyPanel({ markup, onChange, style: outerStyle }) {
  if (!markup) {
    return (
      <div style={{ padding: "12px", fontFamily: FONT, ...outerStyle }}>
        <div style={{ fontSize: 11.5, color: L, textAlign: "center", lineHeight: 1.6 }}>
          Select a markup<br />to edit properties.
        </div>
      </div>
    );
  }

  const schema = schemaForMarkup(markup);
  if (!schema.length) {
    return (
      <div style={{ padding: "12px", fontFamily: FONT, ...outerStyle }}>
        <div style={{ fontSize: 11.5, color: L, textAlign: "center" }}>
          No editable properties.
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT, ...outerStyle }}>
      {schema.map(({ key, type, label, value, options, min, max, step }) => {
        const emit = (v, opts) => onChange && onChange(key, v, opts);
        return (
          <div key={key} style={{ padding: "6px 12px", borderBottom: `1px solid ${B}` }}>
            {type === "bool" ? (
              <BoolControl value={value} label={label} onChange={emit} />
            ) : (
              <>
                <div style={{ fontSize: 10, color: L, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>{label}</div>
                {/* B509: pass the caption as aria-label — the visible label is a detached <div>,
                    so without this the number/range/enum/color controls had no accessible name. */}
                {type === "color"  && <ColorControl value={value} label={label} onChange={emit} />}
                {type === "number" && <NumberControl value={value} min={min} max={max} label={label} onChange={emit} />}
                {type === "range"  && <RangeControl value={value} min={min} max={max} step={step} label={label} onChange={emit} />}
                {type === "enum"   && <EnumControl value={value} options={options} label={label} onChange={emit} />}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
