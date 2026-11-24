/* Bulk-edit PROPERTIES for a multi-selection (NEW-1). Renders the type's fields from `lib/multiProps.js`
 * with the SAME Field / NumInput primitives the single-element panels use: a field every member agrees on shows the value,
 * a field they disagree on shows "Mixed", a typed value is written to every unlocked member in ONE undo step (`onWrite`).
 * Module-scope memoized component (MODULE-SCOPE-COMPONENTS); everything it reads from the planner arrives as a prop. */
import { memo, useEffect, useRef } from "react";
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { TYPE } from "../lib/planStyle.js";
import { readShared } from "../lib/multiProps.js";
import { NumInput } from "./NumInput.jsx";
import { Field, Section } from "./PropFields.jsx";

const MixedTick = memo(function MixedTick({ checked, mixed, onChange, label }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!mixed; }, [mixed]);
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT_SIZE.control, cursor: "pointer" }}>
      <input ref={ref} type="checkbox" data-testid="multi-prop-label-toggle" checked={!!checked && !mixed} onChange={(e) => onChange(e.target.checked)} style={{ width: 14, height: 14 }} />
      <span>{mixed ? "Mixed" : label}</span>
    </label>
  );
});

export const MultiPropsInspector = memo(function MultiPropsInspector({ members, type, fields, ctx, onWrite, muted, stalls }) {
  const shown = fields.map((f) => ({ f, r: readShared(members, f, ctx) })).filter((x) => x.r.n > 0);
  const stallRows = stalls ? [stalls.car && { key: "car", label: "Car parking", t: stalls.car, unit: "stalls", of: "parking field" }, stalls.trailer && { key: "trailer", label: "Trailer parking", t: stalls.trailer, unit: "trailer stalls", of: "trailer row" }].filter(Boolean) : [];
  if (!shown.length && !stallRows.length) return null;
  const lockedN = members.filter((m) => m.locked).length;
  const heading = type ? `${(TYPE[type]?.label || type).split(" / ")[0]} · ${members.length}` : `${members.length} items`;
  return (
    <Section title={null}>
      <div data-testid="multi-props" style={{ fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 6 }}>{heading}</div>
      {stallRows.map(({ key, label, t, unit, of }) => (
        <div key={key} data-testid={`multi-stalls-${key}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: FONT_SIZE.control, marginBottom: 6 }}>
          <span>{label} · {t.n} {of}{t.n === 1 ? "" : "s"}</span>
          <b data-testid={`multi-stalls-${key}-total`}>{t.count.toLocaleString("en-US")} {unit}{t.est ? " (est.)" : ""}</b>
        </div>
      ))}
      {shown.map(({ f, r }) => (
        <Field key={f.id} label={f.label}>
          {f.kind === "toggle"
            ? <MixedTick checked={r.value} mixed={r.mixed} label={r.value ? f.onText : f.offText} onChange={(v) => onWrite(f, v)} />
            : <NumInput boxed unit={f.unit} boxWidth={96} ariaLabel={f.label} testid={`multi-prop-${f.id}`}
                value={r.mixed || r.value == null ? null : r.value} placeholder={r.mixed ? "Mixed" : f.auto ? "auto" : "—"}
                min={f.min} max={f.max} step={f.step} coarse={f.coarse} onCommit={(n) => onWrite(f, n)} />}
        </Field>
      ))}
      {shown.length > 0 && <div style={{ fontSize: 10.5, color: muted, marginTop: 2 }}>
        Typing a value sets it on all {members.length}.{lockedN ? ` ${lockedN} locked ${lockedN === 1 ? "item is" : "items are"} left alone.` : ""}
      </div>}
    </Section>
  );
});
