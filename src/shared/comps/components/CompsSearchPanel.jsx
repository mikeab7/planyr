/* CompsSearchPanel — the Records tab's search row, inline filter panel, removable chips and results
 * line (comps records search). Presentational: the state (search text, filters, sort, panel open)
 * lives in CompsPanel — never here — so it survives a trip to a comp's detail view and back.
 * Every control is a primitive from shared/ui/controls.jsx; module-scope components only.
 * The pure rules are lib/compsQuery.js. */
import { Button, ToggleChip, SegmentedControl, Section, Field } from "../../ui/controls.jsx";
import { NO_AUTOFILL } from "../../ui/noAutofill.js";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { formatNumberDisplay, sanitizeNumericInput } from "../lib/compSheetColumns.js";
import {
  COMP_TYPE_KEYS, TYPE_CHIP_LABEL, SORT_KEYS, SORT_LABEL, activeFilterChips, removeFilter,
} from "../lib/compsQuery.js";
import { useState } from "react";

const fieldStyle = {
  boxSizing: "border-box", padding: "5px 8px", fontSize: FONT_SIZE.control, border: "1px solid var(--border-default)",
  borderRadius: RADIUS.sm, color: "var(--text-primary)", background: "var(--surface-base)", fontFamily: "inherit", outline: "none",
};

const DATE_OPTIONS = [
  { key: "any", label: "Any" }, { key: "3m", label: "3 mo" }, { key: "6m", label: "6 mo" },
  { key: "12m", label: "12 mo" }, { key: "custom", label: "Custom" },
];

/** A thousands-grouped numeric box: digits (and one decimal point) in, grouped at rest. */
function NumBox({ value, onChange, placeholder, label, ...rest }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...NO_AUTOFILL} type="text" inputMode="decimal" aria-label={label} placeholder={placeholder}
      value={focused ? (value ?? "") : formatNumberDisplay(value)}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onChange={(e) => onChange(sanitizeNumericInput(e.target.value))}
      style={{ ...fieldStyle, flex: "1 1 0", minWidth: 0, width: "100%" }} {...rest}
    />
  );
}

function RangeRow({ label, unit, value, onChange, minOnly = false }) {
  return (
    <Field label={unit ? `${label} (${unit})` : label} stacked>
      <div style={{ display: "flex", gap: 6 }}>
        <NumBox label={`${label} minimum`} placeholder="Min" value={value.min} onChange={(v) => onChange({ ...value, min: v })} />
        {!minOnly && <NumBox label={`${label} maximum`} placeholder="Max" value={value.max} onChange={(v) => onChange({ ...value, max: v })} />}
      </div>
    </Field>
  );
}

function FilterPanel({ filters, setFilters, counties }) {
  const f = filters;
  const set = (patch) => setFilters({ ...f, ...patch });
  const toggle = (key, v) => set({ [key]: f[key].includes(v) ? f[key].filter((x) => x !== v) : [...f[key], v] });
  const none = !f.types.length;
  const showLand = none || f.types.includes("land");
  const showBldg = none || f.types.includes("building_sale");
  const showLease = none || f.types.includes("lease");
  const showBuildingFacts = showBldg || showLease;
  return (
    <div data-testid="comps-filter-panel" style={{ padding: "8px 14px 0" }}>
      <Section title="Type">
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginBottom: 6 }}>Blank fields don't match a range.</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {COMP_TYPE_KEYS.map((t) => (
            <ToggleChip key={t} active={f.types.includes(t)} aria-pressed={f.types.includes(t)} onClick={() => toggle("types", t)}>{TYPE_CHIP_LABEL[t]}</ToggleChip>
          ))}
        </div>
      </Section>
      <Section title="Date">
        <SegmentedControl
          options={DATE_OPTIONS} value={f.date.mode} onChange={(mode) => set({ date: { ...f.date, mode } })}
          style={{ width: "100%" }} segmentStyle={{ flex: "1 1 auto", padding: "0 4px", minWidth: 0 }} aria-label="Date window"
        />
        {f.date.mode === "custom" && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <label style={{ flex: "1 1 0", minWidth: 0, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>From
              <input type="date" {...NO_AUTOFILL} value={f.date.from} onChange={(e) => set({ date: { ...f.date, from: e.target.value } })} style={{ ...fieldStyle, width: "100%", marginTop: 3 }} />
            </label>
            <label style={{ flex: "1 1 0", minWidth: 0, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>To
              <input type="date" {...NO_AUTOFILL} value={f.date.to} onChange={(e) => set({ date: { ...f.date, to: e.target.value } })} style={{ ...fieldStyle, width: "100%", marginTop: 3 }} />
            </label>
          </div>
        )}
      </Section>
      <Section title="Size">
        {showBuildingFacts && <RangeRow label="Building" unit="SF" value={f.sizeSf} onChange={(v) => set({ sizeSf: v })} />}
        {showLand && <RangeRow label="Land" unit="acres" value={f.acres} onChange={(v) => set({ acres: v })} />}
      </Section>
      {showBuildingFacts && (
        <Section title="Building">
          <RangeRow label="Clear height" unit="ft" value={f.clearFt} onChange={(v) => set({ clearFt: v })} />
          <RangeRow label="Power" unit="min amps" minOnly value={f.powerAmps} onChange={(v) => set({ powerAmps: v })} />
          <RangeRow label="Dock doors" unit="min" minOnly value={f.dockDoors} onChange={(v) => set({ dockDoors: v })} />
          <RangeRow label="Year built" value={f.yearBuilt} onChange={(v) => set({ yearBuilt: v })} />
        </Section>
      )}
      <Section title="Rate">
        {showLease && (
          <>
            <RangeRow label="Lease rate" unit="$/SF/yr" value={f.leaseRate} onChange={(v) => set({ leaseRate: v })} />
            <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
              {["nnn", "gross"].map((b) => (
                <ToggleChip key={b} active={f.bases.includes(b)} aria-pressed={f.bases.includes(b)} onClick={() => toggle("bases", b)}>{b.toUpperCase()}</ToggleChip>
              ))}
            </div>
          </>
        )}
        {showBldg && <RangeRow label="Building sale price" unit="$/SF" value={f.bldgPsf} onChange={(v) => set({ bldgPsf: v })} />}
        {showLand && <RangeRow label="Land price" unit="$/SF" value={f.landPsf} onChange={(v) => set({ landPsf: v })} />}
      </Section>
      {counties.length > 0 && (
        <Section title="County / market">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {counties.map((c) => (
              <ToggleChip key={c.key} active={f.counties.includes(c.key)} aria-pressed={f.counties.includes(c.key)} onClick={() => toggle("counties", c.key)}>
                {c.label} · {c.count}
              </ToggleChip>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export default function CompsSearchPanel({ q, setQ, counties, total, shownCount, undatedHidden, onClearAll }) {
  const chips = activeFilterChips(q.filters);
  const anyActive = chips.length > 0 || q.search.trim() !== "";
  const setFilters = (filters) => setQ((s) => ({ ...s, filters }));
  const filtered = anyActive;
  return (
    <div data-testid="comps-search">
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 14px 0", alignItems: "center" }}>
        <input
          {...NO_AUTOFILL} type="search" value={q.search} onChange={(e) => setQ((s) => ({ ...s, search: e.target.value }))}
          placeholder="Search comps" aria-label="Search comps" data-testid="comps-search-input"
          style={{ ...fieldStyle, flex: "1 1 120px", minWidth: 0 }}
        />
        <select
          value={q.sort} onChange={(e) => setQ((s) => ({ ...s, sort: e.target.value }))} aria-label="Sort comps" title="Sort comps" data-testid="comps-sort"
          style={{ ...fieldStyle, flex: "0 1 auto", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
        >
          {SORT_KEYS.map((k) => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
        <ToggleChip
          active={q.panelOpen} aria-pressed={q.panelOpen} aria-expanded={q.panelOpen} data-testid="comps-filters-toggle"
          onClick={() => setQ((s) => ({ ...s, panelOpen: !s.panelOpen }))}
        >
          {chips.length ? `Filters · ${chips.length}` : "Filters"}
        </ToggleChip>
        {anyActive && (
          <Button size="sm" variant="ghost" onClick={onClearAll} data-testid="comps-clear-all">Clear all</Button>
        )}
      </div>
      {q.panelOpen && <FilterPanel filters={q.filters} setFilters={setFilters} counties={counties} />}
      {chips.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, padding: "8px 14px 0" }} data-testid="comps-chips">
          {chips.map((c) => (
            <ToggleChip key={c.key} active onClick={() => setFilters(removeFilter(q.filters, c.key))} aria-label={`Remove filter ${c.label}`} title="Remove this filter">
              {c.label} ✕
            </ToggleChip>
          ))}
        </div>
      )}
      {total > 0 && (
        <div data-testid="comps-results-line" style={{ padding: "8px 14px 2px", fontSize: FONT_SIZE.label, fontWeight: 600, color: "var(--text-secondary)" }}>
          {filtered ? `${shownCount} of ${total} comps` : `${total} comps`}
          {undatedHidden > 0 ? ` · ${undatedHidden} undated hidden` : ""}
        </div>
      )}
      {total > 0 && shownCount === 0 && (
        <div data-testid="comps-no-match" style={{ padding: "6px 14px 10px", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
          No comps match
          <div style={{ marginTop: 6 }}><Button size="sm" variant="ghost" onClick={onClearAll}>Clear filters</Button></div>
        </div>
      )}
    </div>
  );
}
