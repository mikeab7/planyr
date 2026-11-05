/* CompsQueryBar — the Records list's search row, filter panel, removable active-filter chips and
 * results line (NEW-1; sections redesigned 2026-10-23 to mirror the comp record). Presentational and
 * module-scope only: the filter state, the pure engine (`lib/compsQuery.js`) and the persistence live in
 * CompsPanel, which keeps them above the list/detail views so a record opened and closed returns to the
 * same view.
 *
 * The panel is INLINE (it pushes the list down) — never a popover and never a scroller of its own: the
 * rail is narrow, popovers die on a phone and a nested scroller traps the page scroll. It scrolls with the
 * list, and its footer is `position: sticky` so "Clear all" and "Show N comps" stay in reach.
 *
 * Sections follow the record view (Type / Date signed / Location, then Deal / Building / Parties) and only
 * offer fields a comp of the selected types actually stores. A comp missing a filtered value is simply left
 * out — nothing here ever says so. Treatment is the record's: uppercase bold header, one body size, a
 * hairline under each section, a heavier dark rule capping the panel; no cards, no gray fills. */
import { Button, RangeRow, SegmentedControl, ToggleChip, CONTROL_RADIUS, FONT } from "../../ui/controls.jsx";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { RECORD_BODY } from "../../ui/RecordSection.jsx";
import { NO_AUTOFILL } from "../../ui/noAutofill.js";
import {
  SORT_OPTIONS, TYPE_FILTER_LABEL, activeFilterChips, removeFilter, countyOptions, typeScope, withTypes, partyLabels,
  sectionSummaries, resultsLine, showButtonLabel,
} from "../lib/compsQuery.js";

const BOX = {
  boxSizing: "border-box", minWidth: 0, padding: "5px 8px", fontSize: FONT.md, fontFamily: "inherit", outline: "none",
  border: "1px solid var(--border-default)", borderRadius: CONTROL_RADIUS.control, background: "var(--surface-raised)", color: "var(--text-primary)",
};
const CHIP_ROW = { display: "flex", flexWrap: "wrap", gap: 6 };
const MUTED = { fontSize: FONT.sm, color: "var(--text-secondary)" };
const RULE_HEAVY = "2px solid var(--text-primary)";
const DATE_OPTIONS = [
  { key: "any", label: "Any" }, { key: "3mo", label: "3 mo" }, { key: "6mo", label: "6 mo" },
  { key: "12mo", label: "12 mo" }, { key: "custom", label: "Custom" },
];
const LABEL_W = "clamp(84px, 30%, 112px)"; // the same scaling RangeRow defaults to, so TextRow / DateRow line up with it

function toggled(list, v) { return list.includes(v) ? list.filter((x) => x !== v) : [...list, v]; }

/** One section of the panel: the word left, the current setting right (accent when set, muted "Any"
 * when not), the content, then a hairline. `id` is a stable hook for tests and the live harness. */
function FilterSection({ id, title, value, children }) {
  return (
    <section data-filter-section={id} style={{ padding: "12px 0 12px", borderBottom: "1px solid var(--border-default)", ...RECORD_BODY }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: FONT_SIZE.control, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-primary)", flex: "none" }}>{title}</span>
        <span data-filter-value style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: value ? 600 : 400, color: value ? "var(--accent)" : "var(--text-secondary)" }}>
          {value || "Any"}
        </span>
      </div>
      {children}
    </section>
  );
}

/** A small run label above a group of rows inside a section ("Lease", "Bldg Sale", "Land"). */
function GroupLabel({ children }) {
  return <div style={{ marginTop: 6, marginBottom: 2, fontWeight: 600, color: "var(--text-secondary)" }}>{children}</div>;
}

function TextRow({ label, value, onChange, placeholder = "Name contains" }) {
  return (
    <div data-range-row style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <span style={{ flex: `0 0 ${LABEL_W}`, minWidth: 0, color: "var(--text-secondary)" }}>{label}</span>
      <input
        {...NO_AUTOFILL} type="text" aria-label={`${label} name contains`} placeholder={placeholder} value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...BOX, flex: "1 1 0", fontSize: RECORD_BODY.fontSize, borderColor: value.trim() ? "var(--accent)" : "var(--border-default)" }}
      />
    </div>
  );
}

function DateRow({ label, value, onChange }) {
  return (
    <div data-range-row style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
      <span style={{ flex: `0 0 ${LABEL_W}`, minWidth: 0, color: "var(--text-secondary)" }}>{label}</span>
      <input
        {...NO_AUTOFILL} type="date" aria-label={`${label} date`} value={value} onChange={(e) => onChange(e.target.value)}
        style={{ ...BOX, flex: "1 1 0", fontSize: RECORD_BODY.fontSize, borderColor: value ? "var(--accent)" : "var(--border-default)" }}
      />
    </div>
  );
}

function FilterPanel({ filters, setFilters, comps, counts, onClearAll, onClose, anyActive }) {
  const set = (patch) => setFilters({ ...filters, ...patch });
  const range = (field) => (r) => set({ [field]: r });
  const sc = typeScope(filters.types);
  const labels = partyLabels(filters.types);
  const sum = sectionSummaries(filters);
  const counties = countyOptions(comps);
  const dealGroups = [sc.lease, sc.sale, sc.land].filter(Boolean).length;
  const R = (label, field, extra) => (
    <RangeRow label={label} min={filters[field].min} max={filters[field].max} onChange={range(field)} labelWidth={LABEL_W} fontSize={RECORD_BODY.fontSize} {...extra} />
  );
  return (
    <div id="comps-filter-panel" data-testid="comps-filter-panel" style={{ marginTop: 8, borderTop: RULE_HEAVY }}>
      <FilterSection id="type" title="Type" value={sum.type}>
        <div style={CHIP_ROW}>
          {Object.keys(TYPE_FILTER_LABEL).map((t) => (
            <ToggleChip key={t} active={filters.types.includes(t)} aria-pressed={filters.types.includes(t)} onClick={() => setFilters(withTypes(filters, toggled(filters.types, t)))}>
              {TYPE_FILTER_LABEL[t]}
            </ToggleChip>
          ))}
        </div>
      </FilterSection>

      <FilterSection id="date" title="Date signed" value={sum.date}>
        <SegmentedControl
          options={DATE_OPTIONS} value={filters.date.mode} aria-label="Date window"
          onChange={(mode) => set({ date: { ...filters.date, mode } })}
          style={{ maxWidth: "100%" }} segmentStyle={{ padding: "0 5px", fontSize: FONT.sm, minWidth: 0 }}
        />
        {filters.date.mode === "custom" && (
          <div style={{ marginTop: 8 }}>
            <DateRow label="From" value={filters.date.from} onChange={(from) => set({ date: { ...filters.date, from } })} />
            <DateRow label="To" value={filters.date.to} onChange={(to) => set({ date: { ...filters.date, to } })} />
          </div>
        )}
      </FilterSection>

      {counties.length > 0 && (
        <FilterSection id="location" title="Location" value={sum.location}>
          <div style={CHIP_ROW}>
            {counties.map((c) => (
              <ToggleChip key={c.key} active={filters.counties.includes(c.key)} aria-pressed={filters.counties.includes(c.key)} onClick={() => set({ counties: toggled(filters.counties, c.key) })}>
                {c.short} {c.count}
              </ToggleChip>
            ))}
          </div>
        </FilterSection>
      )}

      <FilterSection id="deal" title="Deal" value={sum.deal}>
        {sc.lease && (
          <>
            {dealGroups > 1 && <GroupLabel>Lease</GroupLabel>}
            {R("Rate $/SF/yr", "rate", { minPlaceholder: "Min $", maxPlaceholder: "Max $" })}
            <div data-range-row style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 0" }}>
              <span style={{ flex: `0 0 ${LABEL_W}` }} />
              <div style={CHIP_ROW}>
                {["nnn", "gross"].map((b) => (
                  <ToggleChip key={b} active={filters.basis.includes(b)} aria-pressed={filters.basis.includes(b)} onClick={() => set({ basis: toggled(filters.basis, b) })}>
                    {b === "nnn" ? "NNN" : "Gross"}
                  </ToggleChip>
                ))}
              </div>
            </div>
            {R("Term (yrs)", "term")}
            {R("Escalations %", "escal")}
            {R("Free rent (mo)", "freeRent")}
            {R("TI $/SF", "ti", { minPlaceholder: "Min $", maxPlaceholder: "Max $" })}
          </>
        )}
        {sc.sale && (
          <>
            {dealGroups > 1 && <GroupLabel>Bldg Sale</GroupLabel>}
            {R("Price $/SF", "bldgPsf", { minPlaceholder: "Min $", maxPlaceholder: "Max $" })}
            {R("Cap rate %", "capRate")}
            {R("NOI $", "noi", { minPlaceholder: "Min $", maxPlaceholder: "Max $" })}
          </>
        )}
        {sc.land && (
          <>
            {dealGroups > 1 && <GroupLabel>Land</GroupLabel>}
            {R("Price $/SF", "landPsf", { minPlaceholder: "Min $", maxPlaceholder: "Max $" })}
          </>
        )}
      </FilterSection>

      {sc.building && (
        <FilterSection id="building" title="Building" value={sum.building}>
          {R("Size SF", "sf")}
          {R("Clear height", "clearHt", { minPlaceholder: "Min ft", maxPlaceholder: "Max ft" })}
          {R("Dock doors", "docks")}
          {R("Power amps", "power")}
          {R("Year built", "yearBuilt", { grouped: false, minPlaceholder: "From", maxPlaceholder: "To" })}
        </FilterSection>
      )}

      {sc.land && (
        <FilterSection id="land" title="Land" value={sum.land}>
          {R("Acres", "acres")}
        </FilterSection>
      )}

      <FilterSection id="parties" title="Parties" value={sum.parties}>
        <TextRow label={labels.landlord} value={filters.landlord} onChange={(landlord) => set({ landlord })} />
        <TextRow label={labels.tenant} value={filters.tenant} onChange={(tenant) => set({ tenant })} />
      </FilterSection>

      <div data-testid="comps-filter-footer" style={{
        position: "sticky", bottom: 0, zIndex: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        padding: "10px 0", background: "var(--surface-raised)", borderTop: "1px solid var(--border-default)",
      }}>
        <button type="button" onClick={onClearAll} disabled={!anyActive}
          style={{ border: "none", background: "none", padding: 0, fontFamily: "inherit", fontSize: FONT.md, fontWeight: 600, textDecoration: "underline", cursor: anyActive ? "pointer" : "default", color: anyActive ? "var(--text-primary)" : "var(--text-secondary)" }}>
          Clear all
        </button>
        <Button data-testid="comps-filter-show" onClick={onClose}>{showButtonLabel(counts)}</Button>
      </div>
    </div>
  );
}

export default function CompsQueryBar({ filters, setFilters, sort, setSort, panelOpen, setPanelOpen, comps, counts, onClearAll }) {
  const chips = activeFilterChips(filters);
  const searching = filters.q.trim() !== "";
  const anyActive = chips.length > 0 || searching;
  const noMatch = counts.shown === 0 && counts.total > 0;
  // Filled while the panel is open, outlined when closed with filters applied, plain with none.
  const filterBtnStyle = { flex: "none", ...(!panelOpen && chips.length ? { borderColor: "var(--accent)", color: "var(--accent)", fontWeight: 650 } : null) };
  return (
    <div data-testid="comps-query-bar" style={{ padding: "8px 14px 0" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <input
          {...NO_AUTOFILL} type="search" value={filters.q} placeholder="Search comps" aria-label="Search comps"
          onChange={(e) => setFilters({ ...filters, q: e.target.value })}
          style={{ ...BOX, flex: "1 1 auto", minWidth: 0 }}
        />
        <ToggleChip active={panelOpen} aria-expanded={panelOpen} aria-controls="comps-filter-panel" onClick={() => setPanelOpen(!panelOpen)} style={filterBtnStyle}>
          {chips.length ? `Filters · ${chips.length}` : "Filters"}
        </ToggleChip>
      </div>

      {panelOpen ? (
        <FilterPanel filters={filters} setFilters={setFilters} comps={comps} counts={counts} onClearAll={onClearAll} onClose={() => setPanelOpen(false)} anyActive={anyActive} />
      ) : (
        <>
          {chips.length > 0 && (
            <div style={{ ...CHIP_ROW, marginTop: 8, alignItems: "center" }} data-testid="comps-active-chips">
              {chips.map((c) => (
                <ToggleChip key={c.key} active aria-label={`Remove filter: ${c.label}`} onClick={() => setFilters(removeFilter(filters, c.key))}>
                  {c.label} ✕
                </ToggleChip>
              ))}
              <button type="button" onClick={onClearAll}
                style={{ border: "none", background: "none", padding: "0 4px", fontFamily: "inherit", fontSize: FONT.sm, fontWeight: 600, textDecoration: "underline", cursor: "pointer", color: "var(--text-primary)" }}>
                Clear all
              </button>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8, paddingBottom: 8, borderBottom: RULE_HEAVY, flexWrap: "wrap" }}>
            <span data-testid="comps-results-line" style={{ ...MUTED, minWidth: 0 }}>{resultsLine(counts)}</span>
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
        </>
      )}
    </div>
  );
}
