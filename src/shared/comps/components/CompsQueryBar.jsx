/* CompsQueryBar — the Records list's search row, inline filter panel, removable active-filter chips and
 * results line (NEW-1). Presentational and module-scope only: the filter state, the pure engine
 * (`lib/compsQuery.js`) and the persistence live in CompsPanel, which keeps them above the list/detail
 * views so a record opened and closed returns to the same view.
 *
 * The panel is INLINE (it pushes the list down) — never a popover: the rail is narrow and popovers die on
 * a phone. It scrolls with the list. Every control is a shared primitive (ToggleChip, SegmentedControl,
 * RangeFields, Section, Field, Button). */
import { Button, Field, RangeFields, SegmentedControl, Section, ToggleChip, CONTROL_RADIUS, FONT } from "../../ui/controls.jsx";
import { NO_AUTOFILL } from "../../ui/noAutofill.js";
import { SORT_OPTIONS, TYPE_FILTER_LABEL, activeFilterChips, removeFilter, countyOptions } from "../lib/compsQuery.js";

const BOX = {
  boxSizing: "border-box", minWidth: 0, padding: "5px 8px", fontSize: FONT.md, fontFamily: "inherit", outline: "none",
  border: "1px solid var(--border-default)", borderRadius: CONTROL_RADIUS.control, background: "var(--surface-raised)", color: "var(--text-primary)",
};
const CHIP_ROW = { display: "flex", flexWrap: "wrap", gap: 6 };
const MUTED = { fontSize: FONT.sm, color: "var(--text-secondary)" };
const DATE_OPTIONS = [
  { key: "any", label: "Any" }, { key: "3mo", label: "3 mo" }, { key: "6mo", label: "6 mo" },
  { key: "12mo", label: "12 mo" }, { key: "custom", label: "Custom" },
];

function toggled(list, v) { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; }

function FilterPanel({ filters, setFilters, comps }) {
  const set = (patch) => setFilters({ ...filters, ...patch });
  const none = filters.types.length === 0;
  const has = (t) => none || filters.types.includes(t);
  const showBuilding = none || filters.types.some((t) => t !== "land");
  const showLand = has("land");
  const showSale = has("building_sale");
  const showLease = has("lease");
  const counties = countyOptions(comps);
  return (
    <div id="comps-filter-panel" data-testid="comps-filter-panel" style={{ marginTop: 8 }}>
      <Section title="Type">
        <div style={{ ...MUTED, marginBottom: 8 }}>Blank fields don't match a range.</div>
        <div style={CHIP_ROW}>
          {Object.keys(TYPE_FILTER_LABEL).map((t) => (
            <ToggleChip key={t} active={filters.types.includes(t)} aria-pressed={filters.types.includes(t)} onClick={() => set({ types: toggled(filters.types, t) })}>
              {TYPE_FILTER_LABEL[t]}
            </ToggleChip>
          ))}
        </div>
      </Section>

      <Section title="Date">
        <SegmentedControl
          options={DATE_OPTIONS} value={filters.date.mode} aria-label="Date window"
          onChange={(mode) => set({ date: { ...filters.date, mode } })}
          style={{ maxWidth: "100%" }} segmentStyle={{ padding: "0 5px", fontSize: FONT.sm, minWidth: 0 }}
        />
        {filters.date.mode === "custom" && (
          <div style={{ marginTop: 8 }}>
            <Field label="From" stacked>
              <input {...NO_AUTOFILL} type="date" aria-label="From date" value={filters.date.from} style={{ ...BOX, width: "100%" }}
                onChange={(e) => set({ date: { ...filters.date, from: e.target.value } })} />
            </Field>
            <Field label="To" stacked>
              <input {...NO_AUTOFILL} type="date" aria-label="To date" value={filters.date.to} style={{ ...BOX, width: "100%" }}
                onChange={(e) => set({ date: { ...filters.date, to: e.target.value } })} />
            </Field>
          </div>
        )}
      </Section>

      <Section title="Size">
        {showBuilding && <RangeFields label="Building size" unit="SF" min={filters.sf.min} max={filters.sf.max} onChange={(sf) => set({ sf })} />}
        {showLand && <RangeFields label="Land size" unit="AC" min={filters.acres.min} max={filters.acres.max} onChange={(acres) => set({ acres })} />}
      </Section>

      {showBuilding && (
        <Section title="Building">
          <RangeFields label="Clear height" unit="ft" min={filters.clearHt.min} max={filters.clearHt.max} onChange={(clearHt) => set({ clearHt })} />
          <RangeFields label="Power (at least)" single unit="A" min={filters.powerMin} onChange={({ min }) => set({ powerMin: min })} />
          <RangeFields label="Dock doors (at least)" single min={filters.docksMin} onChange={({ min }) => set({ docksMin: min })} />
          <RangeFields label="Year built" grouped={false} min={filters.yearBuilt.min} max={filters.yearBuilt.max} onChange={(yearBuilt) => set({ yearBuilt })} />
        </Section>
      )}

      {(showLease || showSale || showLand) && (
        <Section title="Rate / price">
          {showLease && (
            <>
              <RangeFields label="Lease rate" unit="$/SF/yr" min={filters.rate.min} max={filters.rate.max} onChange={(rate) => set({ rate })} />
              <Field label="Lease basis" stacked>
                <div style={CHIP_ROW}>
                  {["nnn", "gross"].map((b) => (
                    <ToggleChip key={b} active={filters.basis.includes(b)} aria-pressed={filters.basis.includes(b)} onClick={() => set({ basis: toggled(filters.basis, b) })}>
                      {b === "nnn" ? "NNN" : "Gross"}
                    </ToggleChip>
                  ))}
                </div>
              </Field>
            </>
          )}
          {showSale && <RangeFields label="Building sale" unit="$/SF" min={filters.bldgPsf.min} max={filters.bldgPsf.max} onChange={(bldgPsf) => set({ bldgPsf })} />}
          {showLand && <RangeFields label="Land sale" unit="$/SF" min={filters.landPsf.min} max={filters.landPsf.max} onChange={(landPsf) => set({ landPsf })} />}
        </Section>
      )}

      {counties.length > 0 && (
        <Section title="County / market">
          <div style={CHIP_ROW}>
            {counties.map((c) => (
              <ToggleChip key={c.key} active={filters.counties.includes(c.key)} aria-pressed={filters.counties.includes(c.key)} onClick={() => set({ counties: toggled(filters.counties, c.key) })}>
                {c.label} · {c.count}
              </ToggleChip>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

export default function CompsQueryBar({ filters, setFilters, sort, setSort, panelOpen, setPanelOpen, comps, counts, onClearAll }) {
  const chips = activeFilterChips(filters);
  const searching = filters.q.trim() !== "";
  const anyActive = chips.length > 0 || searching;
  const noMatch = counts.shown === 0 && counts.total > 0;
  return (
    <div data-testid="comps-query-bar" style={{ padding: "8px 14px 0" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          {...NO_AUTOFILL} type="search" value={filters.q} placeholder="Search comps" aria-label="Search comps"
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          style={{ ...BOX, flex: "1 1 auto", minWidth: 0 }}
        />
        <ToggleChip active={panelOpen} aria-expanded={panelOpen} aria-controls="comps-filter-panel" onClick={() => setPanelOpen(!panelOpen)} style={{ flex: "none" }}>
          {chips.length ? `Filters · ${chips.length}` : "Filters"}
        </ToggleChip>
      </div>

      {panelOpen && <FilterPanel filters={filters} setFilters={setFilters} comps={comps} />}

      {chips.length > 0 && (
        <div style={{ ...CHIP_ROW, marginTop: 8 }} data-testid="comps-active-chips">
          {chips.map((c) => (
            <ToggleChip key={c.key} active aria-label={`Remove filter: ${c.label}`} onClick={() => setFilters(removeFilter(filters, c.key))}>
              {c.label} ✕
            </ToggleChip>
          ))}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <span data-testid="comps-results-line" style={{ ...MUTED, minWidth: 0 }}>
          {counts.shown} of {counts.total} comps{counts.undatedHidden > 0 ? ` · ${counts.undatedHidden} undated hidden` : ""}
          {anyActive && (
            <> · <button onClick={onClearAll} style={{ border: "none", background: "none", padding: 0, color: "var(--text-primary)", fontWeight: 600, textDecoration: "underline", cursor: "pointer", fontFamily: "inherit", fontSize: "inherit" }}>Clear all</button></>
          )}
        </span>
        <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort comps" title="Sort comps"
          style={{ ...BOX, flex: "0 1 auto", textOverflow: "ellipsis" }}>
          {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </div>

      {noMatch && (
        <div data-testid="comps-no-match" style={{ padding: "14px 0 6px", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: FONT.md, color: "var(--text-primary)" }}>No comps match</span>
          <Button size="sm" variant="ghost" onClick={onClearAll}>Clear filters</Button>
        </div>
      )}
    </div>
  );
}
