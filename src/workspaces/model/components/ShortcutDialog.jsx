/* Model workspace — the small prompt behind the Excel shortcuts that need one value: Column width…
 * (Alt H O W), Row height… (Alt H O H), Number format… (Ctrl+1, Alt H N) and the insert / delete
 * "entire row or column" choice (Ctrl+Shift+= / Ctrl+-) when the selection is a block of cells.
 *
 * A floating card in the normal layer (NOT a modal backdrop — nothing may eat a press elsewhere:
 * CHROME-NEVER-EATS-A-PRESS), opened under the toolbar. Enter applies, Escape closes, and focus goes
 * back to the grid either way so the keyboard keeps working. Never window.prompt (house rule: no
 * dialog-box edits). Content comes from a `spec` ModelApp builds at open time, so the dialog acts on
 * the selection the user had WHEN THEY ASKED, not whatever it is by the time Enter lands.
 *
 *   spec = { title, submitLabel, fields: [{ key, label, type: "number"|"text"|"select"|"radio", value, options?, min?, hint? }],
 *            run(values) }
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";

export default function ShortcutDialog({ spec, onClose }) {
  const [values, setValues] = useState(() => Object.fromEntries(spec.fields.map((f) => [f.key, f.value ?? ""])));
  const firstRef = useRef(null);
  useEffect(() => { firstRef.current?.focus(); firstRef.current?.select?.(); }, []);
  const submit = () => { spec.run(values); onClose(); };
  const set = (key, v) => setValues((cur) => ({ ...cur, [key]: v }));
  return (
    <div
      role="dialog" aria-label={spec.title} data-testid="model-shortcut-dialog"
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onClose(); }
        else if (e.key === "Enter" && e.target.tagName !== "BUTTON") { e.preventDefault(); e.stopPropagation(); submit(); }
        else e.stopPropagation();
      }}
      style={{
        position: "fixed", top: 120, left: "50%", transform: "translateX(-50%)", zIndex: 60,
        minWidth: 280, maxWidth: "calc(100vw - 32px)", padding: 14, display: "flex", flexDirection: "column", gap: 10,
        background: "var(--surface-raised)", color: "var(--text-primary)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.md,
        boxShadow: "0 6px 24px rgba(0,0,0,0.25)", // design-exempt: no shadow-color token yet repo-wide
      }}
    >
      <div style={{ fontWeight: 700 }}>{spec.title}</div>
      {spec.fields.map((f, i) => (
        <label key={f.key} style={{ display: "flex", flexDirection: "column", gap: 4, fontWeight: 600 }}>
          {f.type !== "radio" && <span>{f.label}</span>}
          {f.type === "select" ? (
            <select ref={i === 0 ? firstRef : undefined} value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} style={fieldStyle}>
              {f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.type === "radio" ? (
            <fieldset style={{ border: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
              {f.options.map((o, k) => (
                <label key={o.value} style={{ display: "flex", gap: 6, alignItems: "center", fontWeight: 500 }}>
                  <input ref={i === 0 && k === 0 ? firstRef : undefined} type="radio" name={f.key} checked={values[f.key] === o.value} onChange={() => set(f.key, o.value)} />
                  {o.label}
                </label>
              ))}
            </fieldset>
          ) : (
            <input
              {...NO_AUTOFILL}
              ref={i === 0 ? firstRef : undefined} type={f.type === "number" ? "number" : "text"} min={f.min}
              value={values[f.key]} onChange={(e) => set(f.key, e.target.value)} style={fieldStyle}
            />
          )}
          {f.hint && <span style={{ fontWeight: 400, color: "var(--text-secondary)" }}>{f.hint}</span>}
        </label>
      ))}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit}>{spec.submitLabel || "OK"}</Button>
      </div>
    </div>
  );
}

const fieldStyle = {
  height: 28, padding: "0 8px", font: "inherit", color: "var(--text-primary)", background: "var(--surface-page)",
  border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, boxSizing: "border-box",
};
