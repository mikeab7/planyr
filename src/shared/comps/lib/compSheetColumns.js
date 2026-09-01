/* compSheetColumns — the pure column model behind the comp entry SHEET (B986096-HARDENING-5/6,
 * owner rule 2026-09-01: "should read more like an excel... think about what other professional
 * softwares do too"). Round 5 replaced the shared-column row grid with per-type CARDS; this round
 * replaces the cards with a real spreadsheet — EVERY column exists on EVERY row (a cell that
 * doesn't apply to a row's comp type renders as a grey em dash, never a different column set),
 * which is what lets a land row and a lease row line up under one header the way a genuine comp
 * sheet (CompStak, Argus) does. This file is the pure half: column definitions, per-cell value
 * get/set (several columns are POLYMORPHIC — "Price" reads land_price for a land row and
 * bldg_price for a building-sale row; "Size" reads a different field per type again), display
 * formatting, and the pure fill-down / paste-spill transforms. The React sheet
 * (`components/CompEntryGrid.jsx`) is wiring only — selection, keyboard handling, sticky/frozen
 * layout — and calls into this module for every cell decision, so the RULES of the sheet (which
 * column means what, per type) live in one tested place.
 *
 * ⛔ HARDENING-6 CORRECTION #1 (owner, same day) — the FIRST cut of this sheet grouped columns by
 * what they LOOK like (money together, durations together) rather than what they ARE in a deal.
 * Escalation moved out of a generic "Terms" group into RENT (it IS rent, over time). Free rent +
 * TI moved into their own CONCESSIONS group (the other half of the economics — the reason face
 * rent and net-effective rent differ). Size + Unit moved out of "Terms" into PROPERTY (a property
 * attribute and the denominator of every $/SF figure, not a lease term at all). EXECUTION vs
 * COMMENCEMENT are two different dates now (`compDate` / `leaseCommencementDate`), not one field
 * quietly standing in for the other.
 *
 * ⛔ HARDENING-6 CORRECTION #2, the SAME MISTAKE MADE TWICE — the first correction's derived
 * "$/SF" column still put a SALE's price/size and a LEASE's annualized rate through one shared
 * header; renaming it from "Annual NNN" to "$/SF/yr" fixed the LABEL and left the underlying
 * unit conflation intact (a sale figure has no time dimension at all, so labelling it "/yr" was
 * never honest). THE RULE, restated because it was broken twice: a derived column's header must
 * be a unit that is TRUE FOR EVERY ROW IT IS NOT GREYED ON. If two row types produce different
 * units, they are DIFFERENT COLUMNS — never one slot reused because it's usually empty. Three
 * derived columns now, in this order: `$/SF or $/AC` (land/building sale only — PRICE per unit
 * area, following the row's OWN size unit, `landPricePerAreaUnit`/`buildingPricePerSf`) ·
 * `$/SF/yr` (lease only — the annualized rate ON ITS OWN QUOTED BASIS, the basis printed inline
 * so it's never silently compared across NNN/gross) · `Net Effective $/SF/yr` (lease only, same
 * basis-inline rule — net effective on a gross lease and one on an NNN lease are not the same
 * number for the same reason the face rate isn't, per the owner's systematic audit finding 6).
 *
 * ⛔ HARDENING-7 (owner rule, "lets add an option for cap on building sales") — the money bands
 * split by TYPE now: PRICE (Price · NOI · Cap — land and building sale; NOI/Cap grey on land) is
 * its own group, separate from RENT (Rate · Per · Basis · Escalation — lease only). `price` moved
 * out of RENT into PRICE; `bldgNoi`/`bldgCapRate` are new, building-sale-only, and are the first
 * TRIANGLE columns (`triangleField: "price" | "noi" | "capRate"`): enter any two of the three,
 * the third is computed and rendered `derived` (read-only tinted, same as any other derived
 * cell — `cellState`'s `state !== "editable"` gate already blocks entering edit mode on it, so
 * no new gating was needed). Typing into a derived-looking cell is impossible until one of the
 * OTHER two is cleared, which is the deliberate "clear one to change it" shape, not an oversight.
 * `bldgCapRate` is stored as a decimal fraction (`resolveCapTriangle`'s header explains why) but
 * TYPED AND SHOWN as a percentage — the `bldgCapRate` column's own `getValue`/`setValue` do that
 * conversion at the cell boundary, so the fraction convention never leaks into the sheet's UI and
 * the percentage convention never leaks into the stored draft/comp.
 *
 * ⛔ HARDENING-8/9 (owner LIVE-TESTED the sheet and found it non-functional — read before touching
 * cellState, applyCellEdit, or a column's width/label) — three separate fixes, all in this file:
 * (1) `kind: "date"` columns now show/accept mm/dd/yy (`compDates.js`'s `formatDateDisplay`/
 * `parseTypedDate`) instead of a native `<input type=date>` — a native picker cannot accept typed
 * text ("June 1 2027"), which the owner explicitly required; the STORED value is still ISO, always.
 * (2) `visibleColumnIndices(rows)` is the "hide unused columns" rule — see its own header. (3) Net
 * Effective is GONE as a sheet column (the underlying term/free-rent/escalation/TI inputs are not
 * touched) and the two remaining derived columns dropped the "$" and, for `$/SF/yr` specifically
 * (one fixed unit), the "/yr" too — "if the header states the unit, the cell shows the number
 * only." `$/SF or $/AC` keeps its per-row "/AC"/"/SF" suffix because its header names TWO
 * candidate units, so the suffix is what disambiguates rather than a repeat.
 */
import {
  draftToComp, buildingPricePerSf, annualLeaseRate, partyLabels,
  landPricePerAreaUnit, resolveCapTriangle,
} from "./comps.js";
import { parseTypedDate, formatDateDisplay } from "./compDates.js";

export const GROUPS = ["PROPERTY", "DEAL", "PRICE", "RENT", "CONCESSIONS", "DERIVED", "PARTIES"];

export const TYPE_OPTIONS = [
  { value: "land", label: "Land" },
  { value: "building_sale", label: "Bldg sale" },
  { value: "lease", label: "Lease" },
];
export const PERIOD_OPTIONS = [{ value: "monthly", label: "MO" }, { value: "annual", label: "YR" }];
export const BASIS_OPTIONS = [{ value: "nnn", label: "NNN" }, { value: "gross", label: "GROSS" }];
export const UNIT_OPTIONS = [{ value: "ac", label: "AC" }, { value: "sf", label: "SF" }];

/* ---- number display: comma-separated while resting, raw digits while being typed ----------- */

export function formatNumberDisplay(raw) {
  if (raw === "" || raw == null) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return String(raw);
  const s = String(raw);
  const dot = s.indexOf(".");
  if (dot === -1) return n.toLocaleString("en-US");
  const decimals = Math.max(0, s.length - dot - 1);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function sanitizeNumericInput(raw) {
  let s = String(raw || "").replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  return s;
}

function optionLabel(options, value) {
  return options.find((o) => o.value === value)?.label || "";
}

// Loose match for typing over a select cell (e.g. typing "y" or "yr" for Period) — matches by
// value, by full label, or by label PREFIX, case-insensitively. Returns null (no change) rather
// than guessing when nothing matches, same "never silently wrong" rule as compParse.js.
function matchOption(options, typed) {
  const t = String(typed || "").trim().toLowerCase();
  if (!t) return "";
  const byValue = options.find((o) => o.value.toLowerCase() === t);
  if (byValue) return byValue.value;
  const byLabel = options.find((o) => o.label.toLowerCase() === t);
  if (byLabel) return byLabel.value;
  const byPrefix = options.find((o) => o.label.toLowerCase().startsWith(t) || o.value.toLowerCase().startsWith(t));
  return byPrefix ? byPrefix.value : null;
}

/* ---- the column list ------------------------------------------------------------------------
 * Every column: { key, label, group, width, align, kind, frozen? }. `kind` decides the editor:
 *   "select"  — a native <select>, options[] with {value,label}
 *   "date"    — a native <input type=date>
 *   "text"    — a plain text input
 *   "number"  — a text input, comma-formatted at rest, sanitized to digits while editing
 *   "action"  — no text edit at all (Location) — Enter/double-click runs its own handler
 *   "derived" — never editable, computed by `derive(comp)`
 * A column applies to a row when `appliesTo(compType)` is true; POLYMORPHIC columns (Price,
 * Size, Unit) additionally carry `getValue`/`setValue`/`flagKey` that route to the right draft
 * field for that row's type — every other column's value lives at `draft[col.key]` directly. */

function simpleColumn(base) {
  return {
    ...base,
    appliesTo: base.appliesTo || (() => true),
    getValue: (draft) => draft[base.key],
    setValue: (draft, value) => ({ ...draft, [base.key]: value }),
    flagKey: () => base.key,
  };
}

export const SHEET_COLUMNS = [
  // PROPERTY — facts about the property itself, not the deal. Title/address is the one frozen
  // column ("freeze through Title / address so it stays while the rest scrolls right").
  simpleColumn({ key: "title", label: "Title / Address", group: "PROPERTY", width: 180, align: "left", kind: "text", frozen: true }),
  {
    key: "size", label: "Size", group: "PROPERTY", width: 70, align: "right", kind: "number",
    appliesTo: () => true,
    getValue: (d) => (d.compType === "land" ? d.landSizeValue : d.compType === "building_sale" ? d.bldgSizeSf : d.leaseSizeSf),
    setValue: (d, v) => (d.compType === "land" ? { ...d, landSizeValue: v } : d.compType === "building_sale" ? { ...d, bldgSizeSf: v } : { ...d, leaseSizeSf: v }),
    flagKey: (d) => (d.compType === "land" ? "landSizeValue" : d.compType === "building_sale" ? "bldgSizeSf" : "leaseSizeSf"),
  },
  {
    // Editable AC/SF only for land — building-sale and lease sizes are always SF, shown as a
    // fixed (not em-dash — it DOES apply, it's just not a choice) label.
    key: "landSizeUnit", label: "Unit", group: "PROPERTY", width: 42, align: "left", kind: "select", options: UNIT_OPTIONS,
    appliesTo: () => true,
    editableFor: (t) => t === "land",
    getValue: (d) => (d.compType === "land" ? d.landSizeUnit : "sf"),
    setValue: (d, v) => ({ ...d, landSizeUnit: v }),
    flagKey: () => "landSizeUnit",
  },
  { key: "location", label: "Location", group: "PROPERTY", width: 88, align: "left", kind: "action", appliesTo: () => true, required: true },

  // DEAL — facts about the transaction: what kind, when, how long.
  simpleColumn({ key: "compType", label: "Type", group: "DEAL", width: 62, align: "left", kind: "select", options: TYPE_OPTIONS }),
  simpleColumn({ key: "compDate", label: "Executed", group: "DEAL", width: 74, align: "left", kind: "date", required: true }),
  simpleColumn({ key: "leaseCommencementDate", label: "Commence", fullLabel: "Commencement", group: "DEAL", width: 74, align: "left", kind: "date", appliesTo: (t) => t === "lease" }),
  simpleColumn({ key: "leaseTerm", label: "Term", group: "DEAL", width: 56, align: "left", kind: "text", appliesTo: (t) => t === "lease" }),

  // PRICE — land and building-sale economics: Price for either, NOI + Cap for a sale only (grey
  // on land — Michael scoped cap rate to building sales). The three are a TRIANGLE: enter any
  // two, the third derives (see the file header + resolveCapTriangle in comps.js).
  {
    key: "price", label: "Price", group: "PRICE", width: 84, align: "right", kind: "number",
    appliesTo: (t) => t === "land" || t === "building_sale",
    triangleField: "price",
    getValue: (d) => (d.compType === "land" ? d.landPrice : d.bldgPrice),
    setValue: (d, v) => (d.compType === "land" ? { ...d, landPrice: v } : { ...d, bldgPrice: v }),
    flagKey: (d) => (d.compType === "land" ? "landPrice" : "bldgPrice"),
  },
  {
    key: "bldgNoi", label: "NOI", group: "PRICE", width: 84, align: "right", kind: "number",
    appliesTo: (t) => t === "building_sale",
    triangleField: "noi",
    getValue: (d) => d.bldgNoi,
    setValue: (d, v) => ({ ...d, bldgNoi: v }),
    flagKey: () => "bldgNoi",
  },
  {
    // Typed and shown as a PERCENTAGE (5.75); stored internally as a FRACTION (0.0575) — the
    // get/set pair is the one place that conversion happens, so nothing outside this column ever
    // sees the percentage form and nothing outside resolveCapTriangle ever sees a raw fraction
    // typed by a human.
    key: "bldgCapRate", label: "Cap %", fullLabel: "Cap rate (%)", group: "PRICE", width: 52, align: "right", kind: "number",
    appliesTo: (t) => t === "building_sale",
    triangleField: "capRate",
    getValue: (d) => (d.bldgCapRate === "" || d.bldgCapRate == null ? "" : String(Number(d.bldgCapRate) * 100)),
    setValue: (d, v) => ({ ...d, bldgCapRate: v === "" ? "" : String(Number(v) / 100) }),
    flagKey: () => "bldgCapRate",
  },

  // RENT — lease-only now that Price moved to PRICE: Rate (+ how it's quoted) and Escalation,
  // because escalation IS rent, over time — never a generic "term".
  simpleColumn({ key: "leaseRate", label: "Rate", fullLabel: "Rate $/SF", group: "RENT", width: 56, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),
  simpleColumn({ key: "leaseRatePeriod", label: "Per", group: "RENT", width: 56, align: "left", kind: "select", options: PERIOD_OPTIONS, appliesTo: (t) => t === "lease" }),
  simpleColumn({ key: "leaseRateExpense", label: "Basis", group: "RENT", width: 52, align: "left", kind: "select", options: BASIS_OPTIONS, appliesTo: (t) => t === "lease" }),
  simpleColumn({ key: "leaseEscalationPct", label: "Escal", fullLabel: "Escalation %/yr", group: "RENT", width: 56, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),

  // CONCESSIONS — the other half of the economics: what the landlord gives up, which is exactly
  // why face rent and net-effective rent differ.
  simpleColumn({ key: "leaseFreeRentMonths", label: "Free rent", fullLabel: "Free rent (months)", group: "CONCESSIONS", width: 50, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),
  simpleColumn({ key: "leaseTi", label: "TI", fullLabel: "TI $/SF", group: "CONCESSIONS", width: 52, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),

  // DERIVED — never editable, tinted read-only. TWO columns now (HARDENING-9 removed Net
  // Effective — "dont worry about net effective per year ... still remove", the underlying
  // inputs (term/free rent/escalation/TI) stay as enterable facts, only the derived output went):
  // a sale's price/area and a lease's annualized rate are different units and never share a slot.
  // ⛔ HARDENING-9 — "if the header states the unit, the cell shows the number only": neither
  // cell repeats the "$" the header already implies. `$/SF/yr`'s header commits to ONE unit, so
  // its cell drops "/yr" too (kept only the NNN/GROSS basis, which is new information the header
  // doesn't carry); `$/SF or $/AC` states TWO candidate units, so its cell keeps the per-row
  // "/AC" or "/SF" — that suffix is what tells you which one applies, not a repeat of the header.
  {
    // Follows the row's OWN recorded size unit — $/AC for an acre-quoted land comp, $/SF for an
    // SF-quoted one or a building sale (which has no unit choice at all).
    key: "salePricePerArea", label: "$/SF or $/AC", group: "DERIVED", width: 66, align: "right", kind: "derived",
    appliesTo: (t) => t === "land" || t === "building_sale",
    derive: (comp) => {
      const fmt = (n) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (comp.compType === "building_sale") {
        const v = buildingPricePerSf(comp);
        return v != null ? `${fmt(v)}/SF` : null;
      }
      const r = landPricePerAreaUnit(comp);
      return r ? `${fmt(r.value)}/${r.unit.toUpperCase()}` : null;
    },
  },
  {
    // The lease's annualized rate on its OWN quoted basis — the basis prints inline so this is
    // never silently compared across NNN and gross (they are not the same figure).
    key: "leaseAnnualRate", label: "$/SF/yr", group: "DERIVED", width: 66, align: "right", kind: "derived",
    appliesTo: (t) => t === "lease",
    derive: (comp) => {
      const v = annualLeaseRate(comp);
      if (v == null) return null;
      const basis = comp.leaseRateExpense ? ` ${comp.leaseRateExpense.toUpperCase()}` : "";
      return `${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${basis}`;
    },
  },

  // PARTIES — who the deal is between, plus notes (kept here rather than dropped — every type
  // needs somewhere for what doesn't fit a column).
  simpleColumn({ key: "partyProvider", label: "Landlord/Seller", fullLabel: "Landlord / Seller", group: "PARTIES", width: 120, align: "left", kind: "text" }),
  simpleColumn({ key: "partyAcquirer", label: "Tenant/Buyer", fullLabel: "Tenant / Buyer", group: "PARTIES", width: 120, align: "left", kind: "text" }),
  simpleColumn({ key: "notes", label: "Notes", group: "PARTIES", width: 110, align: "left", kind: "text" }),
];

export function columnIndex(key) {
  return SHEET_COLUMNS.findIndex((c) => c.key === key);
}

/** B986096-HARDENING-9 (owner rule: "hide unused columns entirely") — which of the FULL column
 * list is worth showing given the rows actually on the sheet, as an array of indices into
 * `SHEET_COLUMNS`. "Every column exists on every ROW" (a cell that doesn't apply renders grey
 * with an em dash) is UNCHANGED and still what keeps a land row aligned under a lease row — this
 * is the opposite question, across the whole sheet rather than within one row: a lease-only
 * sheet has no use for Price/NOI/Cap, so those columns take up no horizontal room at all rather
 * than sitting there greyed on every single row. With no rows yet (nothing to hide against) every
 * column shows, so the sheet doesn't flicker narrower the instant the first row lands. */
export function visibleColumnIndices(rows) {
  if (!rows || !rows.length) return SHEET_COLUMNS.map((_, i) => i);
  const types = new Set(rows.map((r) => r.draft.compType));
  const out = [];
  SHEET_COLUMNS.forEach((c, i) => {
    for (const t of types) {
      if (c.appliesTo(t)) { out.push(i); return; }
    }
  });
  return out;
}

/** The one place a cell's rendered state is decided: applicable+editable, applicable+fixed
 * (Unit for a non-land row), not-applicable (em dash), or derived. Never returns a raw value the
 * caller has to re-interpret — `text` is always what the cell should show. */
export function cellState(col, draft) {
  const applies = col.appliesTo(draft.compType);
  if (col.kind === "derived") {
    if (!applies) return { state: "na", text: "—" };
    const text = col.derive(draftToComp(draft));
    return { state: "derived", text: text ?? "—" };
  }
  if (!applies) return { state: "na", text: "—" };
  if (col.kind === "action") return { state: "action" };
  // HARDENING-7 — Price/NOI/Cap on a building sale: whichever one the triangle computed from the
  // OTHER two (never a genuinely-typed one, and never any of the three when land, or when a
  // building sale has fewer than two given) renders `derived` — tinted, and NOT enterable, since
  // every caller into edit mode (beginEdit, F2, typing a character) already gates on
  // `state === "editable"`. Clearing one of the other two frees this cell up again.
  if (col.triangleField && draft.compType === "building_sale") {
    const tri = resolveCapTriangle(draft);
    const cell = tri[col.triangleField];
    const raw = col.getValue(draft);
    if (cell.derived) {
      const text = col.triangleField === "capRate"
        ? `${(cell.value * 100).toFixed(2)}%`
        : formatNumberDisplay(String(cell.value));
      return { state: "derived", text };
    }
    const text = col.triangleField === "capRate" && raw !== "" ? `${formatNumberDisplay(raw)}%` : formatNumberDisplay(raw);
    return { state: "editable", text, raw: raw ?? "" };
  }
  const raw = col.getValue(draft);
  if (col.editableFor && !col.editableFor(draft.compType)) {
    // applies, but not a choice for this type (Unit is always SF outside land)
    return { state: "fixed", text: optionLabel(col.options, raw) || String(raw || "").toUpperCase() };
  }
  if (col.kind === "select") return { state: "editable", text: optionLabel(col.options, raw), raw: raw || "" };
  if (col.kind === "number") return { state: "editable", text: formatNumberDisplay(raw), raw: raw ?? "" };
  if (col.kind === "date") {
    // HARDENING-8 — `raw` (ISO, what's actually stored) is never shown; the REST display and
    // the edit box both use mm/dd/yy, this app's own convention, so an unchanged edit round-trips
    // through parseTypedDate back to the identical ISO value it started as.
    const shown = formatDateDisplay(raw);
    return { state: "editable", text: shown, raw: shown };
  }
  return { state: "editable", text: raw || "", raw: raw || "" };
}

/** The placeholder a text/select cell shows when it's genuinely empty — the party columns use
 * the comp type's own role name ("Seller", "Tenant") rather than a generic "optional". */
export function cellPlaceholder(col, compType) {
  if (col.key === "partyProvider") return partyLabels(compType).provider;
  if (col.key === "partyAcquirer") return partyLabels(compType).acquirer;
  return "";
}

/** Apply a typed/pasted edit to one cell -> the new draft. Sanitizes per column kind; a select
 * column resolves loose typed text against its options (case-insensitive, prefix match) and
 * returns the draft UNCHANGED if nothing matches — never guesses a value into existence. */
export function applyCellEdit(col, draft, rawInput) {
  if (col.kind === "derived" || col.kind === "action") return draft;
  if (col.kind === "select") {
    const matched = matchOption(col.options, rawInput);
    return matched == null ? draft : col.setValue(draft, matched);
  }
  if (col.kind === "number") return col.setValue(draft, sanitizeNumericInput(rawInput));
  if (col.kind === "date") {
    // Accepts whatever a person typed or pasted (see compDates.js's header for the formats) and
    // stores the canonical ISO — never the typed text. An empty cell is a deliberate clear; text
    // that doesn't read as a date leaves the draft UNCHANGED rather than guessing or blanking a
    // real date on a garbled edit (the same "never guess" rule `matchOption` follows for selects).
    const trimmed = String(rawInput ?? "").trim();
    if (!trimmed) return col.setValue(draft, "");
    const iso = parseTypedDate(trimmed);
    return iso ? col.setValue(draft, iso) : draft;
  }
  return col.setValue(draft, String(rawInput ?? ""));
}

/* ---- fill-down (Ctrl/Cmd+D) and paste-spill — both pure over the `rows` array --------------- */

/** Fill DOWN one column across a contiguous row range: every row below the first gets the
 * first row's value for that column. `rowIndices` is `[startIdx, endIdx]` inclusive. Returns a
 * NEW rows array (never mutates); a column with nothing applicable at the source row is a no-op. */
export function fillDownColumn(rows, colIndex, rowIndices) {
  const col = SHEET_COLUMNS[colIndex];
  if (!col || col.kind === "derived" || col.kind === "action") return rows;
  const [start, end] = rowIndices;
  if (end <= start) return rows;
  const sourceDraft = rows[start].draft;
  if (!col.appliesTo(sourceDraft.compType)) return rows;
  const sourceValue = col.getValue(sourceDraft);
  return rows.map((row, i) => {
    if (i <= start || i > end) return row;
    if (!col.appliesTo(row.draft.compType)) return row; // never fills a value onto a row it doesn't apply to
    const flagKey = col.flagKey(row.draft);
    const nextFlags = { ...row.cellFlags };
    delete nextFlags[flagKey];
    return { ...row, draft: col.setValue(row.draft, sourceValue), cellFlags: nextFlags };
  });
}

/** Excel-style paste: a tab/newline-delimited clipboard block written starting at
 * `(startRow, startCol)`, spilling right (across columns, in SHEET_COLUMNS order from startCol)
 * and down (extending `rows` with new blank draft rows if the paste has more rows than exist).
 * `emptyDraftFn` builds a fresh blank draft (the caller's `emptyDraft`, kept out of this pure
 * module so it never needs to know about map anchors). A single-cell paste (no tabs, one line)
 * just writes that one cell. Returns the new rows array. */
export function spillPaste(rows, startRow, startCol, clipboardText, emptyDraftFn, newRowIdFn) {
  const lines = String(clipboardText || "").replace(/\r/g, "").split("\n").filter((l, i, arr) => !(i === arr.length - 1 && l === ""));
  if (!lines.length) return rows;
  const grid = lines.map((l) => l.split("\t"));
  const next = rows.slice();
  grid.forEach((cells, rOffset) => {
    const rIdx = startRow + rOffset;
    while (rIdx >= next.length) next.push({ _id: newRowIdFn(), draft: emptyDraftFn(), cellFlags: {} });
    let row = next[rIdx];
    cells.forEach((cellText, cOffset) => {
      const col = SHEET_COLUMNS[startCol + cOffset];
      if (!col || col.kind === "derived" || col.kind === "action") return;
      if (!col.appliesTo(row.draft.compType)) return;
      const flagKey = col.flagKey(row.draft);
      const nextFlags = { ...row.cellFlags };
      delete nextFlags[flagKey];
      row = { ...row, draft: applyCellEdit(col, row.draft, cellText), cellFlags: nextFlags };
    });
    next[rIdx] = row;
  });
  return next;
}
