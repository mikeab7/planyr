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
 *
 * ⛔ HARDENING-10 (owner LIVE-TESTED AGAIN, two rounds of measured DOM/CSS facts) — read before
 * touching column order, width, align, or label:
 * (1) TYPE IS NOW THE FIRST COLUMN, frozen alongside Title ("choose deal first because it will
 * inform the rest"). Its own group is `TYPE`, a deliberate one-column band — Type isn't a
 * PROPERTY or DEAL fact, it's the classifier every other column's meaning depends on.
 * (2) ALIGNMENT IS ONE RULE, NOT A PER-COLUMN CALL: NUMERIC or DATE -> right, everything else ->
 * left, period. `col.align` below encodes exactly that — never right-align a text/select/action
 * column, never left-align a number/date one, and never introduce a third alignment.
 * (3) A CELL HOLDS ITS BARE VALUE; A UNIT GOES IN THE HEADER, NEVER BOTH. `leaseTerm`'s cell used
 * to read "126 mo" — a unit suffix baked into a "numeric" cell is what made it read as text and
 * left-align inconsistently with its neighbors. `col.get/setValue` below strip the unit at the
 * cell boundary (mirroring `bldgCapRate`'s %-vs-fraction split) so the cell is bare digits and
 * the header states what they mean (`Term (mo)`, `Free (mo)`, `Escal (%)`, `TI ($/SF)`, `Cap
 * (%)`) — `Size` keeps its own separate Unit column instead, because THAT unit varies per row.
 * (4) NO COLUMN'S WIDTH MAY LET ITS OWN HEADER TRUNCATE — every label below was sized against its
 * column's width by hand; if you touch one, re-check the other.
 */
import {
  draftToComp, buildingPricePerSf, annualLeaseRate,
  landPricePerAreaUnit, resolveCapTriangle,
} from "./comps.js";
import { parseTypedDate, formatDateDisplay } from "./compDates.js";

export const GROUPS = ["TYPE", "PROPERTY", "DEAL", "PRICE", "RENT", "CONCESSIONS", "DERIVED", "PARTIES"];

// HARDENING-10 — leaseTerm's cell boundary: the stored field stays free text (a real deal can be
// "10 yr + 2x5 options", which a bare-months cell can't hold) but the SHEET CELL itself only ever
// shows/accepts a bare month count, mirroring bldgCapRate's %-vs-fraction split. This reads only
// the LEADING quantity — "10 yr + 2x5 options" is the 10-year BASE term with renewal options
// described after it, so 120 is the correct reduction, not a guess. A stored value with no
// leading number/unit at all ("See Section 4.2") shows empty rather than a wrong number.
function monthsFromTermText(text) {
  const s = String(text || "");
  let m = s.match(/(\d+(?:\.\d+)?)\s*(mo|mos|month|months)\b/i);
  if (m) return Number(m[1]);
  m = s.match(/(\d+(?:\.\d+)?)\s*(yr|yrs|year|years)\b/i);
  if (m) return Number(m[1]) * 12;
  return null;
}

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
  // TYPE — the classifier every other column's meaning depends on ("choose deal first because it
  // will inform the rest"). Frozen alongside Title so it never scrolls out of view.
  {
    key: "compType", label: "Type", group: "TYPE", width: 66, align: "left", kind: "select", options: TYPE_OPTIONS, frozen: true,
    appliesTo: () => true,
    getValue: (d) => d.compType,
    setValue: (d, v) => {
      // HARDENING-10 NEW-1 — "setting Type ... sets that row's Unit default: Land -> AC,
      // Building sale -> SF, Lease -> SF." Building sale / lease never read `landSizeUnit` at all
      // (their Size column is fixed to SF, see below) so there is nothing to default for them —
      // only switching TO land needs a starting value, and only if one isn't already set, so
      // re-picking Land after picking something else never clobbers a choice the user already made.
      const next = { ...d, compType: v };
      if (v === "land" && !d.landSizeUnit) next.landSizeUnit = "ac";
      return next;
    },
    flagKey: () => "compType",
  },

  // PROPERTY — facts about the property itself, not the deal. Title/address is the second frozen
  // column ("freeze through Title / address so it stays while the rest scrolls right").
  simpleColumn({ key: "title", label: "Title / Address", group: "PROPERTY", width: 170, flexKey: "title", align: "left", kind: "text", frozen: true }),
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
  { key: "location", label: "Location", group: "PROPERTY", width: 84, align: "left", kind: "action", appliesTo: () => true, required: true },

  // DEAL — facts about the transaction: when, how long.
  simpleColumn({ key: "compDate", label: "Executed", group: "DEAL", width: 74, align: "right", kind: "date", required: true }),
  simpleColumn({ key: "leaseCommencementDate", label: "Commence", fullLabel: "Commencement", group: "DEAL", width: 74, align: "right", kind: "date", appliesTo: (t) => t === "lease" }),
  {
    // HARDENING-10 — the STORED field stays free text (a real term can be "10 yr + 2x5 options",
    // which a bare-months field can't hold) but the CELL only ever shows/accepts a bare month
    // count, mirroring bldgCapRate's %-vs-fraction split below. A stored term this can't reduce to
    // one number shows empty rather than a wrong guess.
    key: "leaseTerm", label: "Term (mo)", fullLabel: "Term (months)", group: "DEAL", width: 60, align: "right", kind: "number",
    appliesTo: (t) => t === "lease",
    getValue: (d) => {
      const months = monthsFromTermText(d.leaseTerm);
      return months == null ? "" : String(months);
    },
    setValue: (d, v) => ({ ...d, leaseTerm: v === "" ? "" : `${v} mo` }),
    flagKey: () => "leaseTerm",
  },

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
    // typed by a human. The "%" itself lives in the HEADER now, not the cell (HARDENING-10).
    key: "bldgCapRate", label: "Cap (%)", fullLabel: "Cap rate (%)", group: "PRICE", width: 58, align: "right", kind: "number",
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
  simpleColumn({ key: "leaseEscalationPct", label: "Escal (%)", fullLabel: "Escalation %/yr", group: "RENT", width: 60, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),

  // CONCESSIONS — the other half of the economics: what the landlord gives up, which is exactly
  // why face rent and net-effective rent differ.
  simpleColumn({ key: "leaseFreeRentMonths", label: "Free (mo)", fullLabel: "Free rent (months)", group: "CONCESSIONS", width: 60, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),
  simpleColumn({ key: "leaseTi", label: "TI ($/SF)", fullLabel: "TI $/SF", group: "CONCESSIONS", width: 60, align: "right", kind: "number", appliesTo: (t) => t === "lease" }),

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
    key: "salePricePerArea", label: "$/SF or $/AC", group: "DERIVED", width: 90, align: "right", kind: "derived",
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
  // needs somewhere for what doesn't fit a column). All four `flexKey` columns (title above,
  // these three) share the dialog's leftover horizontal space — see CompEntryGrid.jsx's
  // `computeFlexWidths`. `width` here is only the STATIC fallback (tests, no-DOM contexts); the
  // live sheet always uses the computed value.
  simpleColumn({ key: "partyProvider", label: "Landlord/Seller", fullLabel: "Landlord / Seller", group: "PARTIES", width: 125, flexKey: "partyProvider", align: "left", kind: "text" }),
  simpleColumn({ key: "partyAcquirer", label: "Tenant/Buyer", fullLabel: "Tenant / Buyer", group: "PARTIES", width: 125, flexKey: "partyAcquirer", align: "left", kind: "text" }),
  simpleColumn({ key: "notes", label: "Notes", group: "PARTIES", width: 90, flexKey: "notes", align: "left", kind: "text" }),
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
      // HARDENING-10 — bare digits only; "Cap (%)" in the header already says what they mean.
      const text = col.triangleField === "capRate"
        ? (cell.value * 100).toFixed(2)
        : formatNumberDisplay(String(cell.value));
      return { state: "derived", text };
    }
    return { state: "editable", text: formatNumberDisplay(raw), raw: raw ?? "" };
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

/** HARDENING-10 NEW-4 — "empty means empty." A cell that hasn't been filled in renders truly
 * empty, never a grey placeholder word ("Seller", "Tenant") standing in for it — in a grid, grey
 * text inside a cell reads as data, not as a hint, and the column header already says what the
 * column is. The only surviving muted mark is the em dash `cellState` renders for a cell that is
 * genuinely NOT APPLICABLE to the row's type, which is a different, still-necessary signal
 * (blank-because-N/A vs. blank-because-unfilled) and lives in `cellState`, not here. This
 * function now always returns "" — kept (rather than deleted at every call site) so a future
 * column-specific hint has exactly one place to be added back, deliberately, if ever needed. */
export function cellPlaceholder() {
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
    while (rIdx >= next.length) {
      // HARDENING-10 NEW-1 — "a new empty row defaults Type to whatever the row above it is,
      // since people enter comps in batches of one kind." Only a genuine DEFAULT: the paste's own
      // cells (below) are applied on top in the normal way and win outright if the pasted block
      // itself carries a Type column.
      const above = next[next.length - 1];
      const draft = emptyDraftFn();
      if (above?.draft.compType) draft.compType = above.draft.compType;
      next.push({ _id: newRowIdFn(), draft, cellFlags: {} });
    }
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

/* ---- dynamic column width — the four `flexKey` columns share whatever horizontal space is left
 * after every fixed-width visible column, so the sheet fits its container with ZERO horizontal
 * scroll rather than a hand-tuned static budget (two static attempts both overflowed the target
 * by 170-200px — a computed-to-fit approach is the only one that's correct regardless of an
 * imprecise per-column guess). HARDENING-10 NEW-5 (message A) said Notes shrinks first; NEW-3
 * (message B, later and more specific) said Title/Landlord/Tenant share leftover space growing,
 * Title getting the largest share, and said nothing about Notes growing — so Notes is modeled
 * separately: it alone absorbs a squeeze up to its own floor, and only once it's AT that floor do
 * the three growers give up any of their own room. ------------------------------------------- */

const FLEX_GROWERS = [
  { key: "title", nominal: 170, floor: 90, weight: 2 }, // "Title gets the largest share"
  { key: "partyProvider", nominal: 125, floor: 65, weight: 1 },
  { key: "partyAcquirer", nominal: 125, floor: 65, weight: 1 },
];
const FLEX_NOTES = { key: "notes", nominal: 90, floor: 55 };

/** Pure: given the horizontal space left over after every FIXED-width visible column (and the
 * remove-row column, and borders — the caller's job to subtract those), returns
 * `{title, partyProvider, partyAcquirer, notes}` widths — never negative, and NEVER below a
 * column's own floor, full stop. The floors are chosen (see the sum at the top of this file's
 * HARDENING-10 note) so that even the narrowest realistic dialog never has to cross one; if
 * `availableForFlex` is ever smaller than the floor sum anyway (an extreme window), every column
 * still holds its floor and the table is left to overflow by that difference — a readable column
 * that causes a little horizontal scroll beats an unreadable one that doesn't. Three regimes, in
 * order of how tight things are: everyone gets more than nominal (surplus shared by the three
 * growers, weighted) · notes alone shrinks to absorb the squeeze · notes is already at floor and
 * the three growers now shrink together, proportional to their own room. */
export function computeFlexWidths(availableForFlex) {
  const avail = Math.max(0, availableForFlex);
  const growerNominalTotal = FLEX_GROWERS.reduce((s, g) => s + g.nominal, 0);
  const growerFloorTotal = FLEX_GROWERS.reduce((s, g) => s + g.floor, 0);
  const fullNominalTotal = growerNominalTotal + FLEX_NOTES.nominal;

  if (avail >= fullNominalTotal) {
    const surplus = avail - fullNominalTotal;
    const weightTotal = FLEX_GROWERS.reduce((s, g) => s + g.weight, 0);
    const widths = { notes: FLEX_NOTES.nominal };
    FLEX_GROWERS.forEach((g) => { widths[g.key] = Math.round(g.nominal + surplus * (g.weight / weightTotal)); });
    return widths;
  }

  const notesShrinkRoom = FLEX_NOTES.nominal - FLEX_NOTES.floor;
  const deficitFromFullNominal = fullNominalTotal - avail;
  if (deficitFromFullNominal <= notesShrinkRoom) {
    const widths = { notes: FLEX_NOTES.nominal - deficitFromFullNominal };
    FLEX_GROWERS.forEach((g) => { widths[g.key] = g.nominal; });
    return widths;
  }

  const remainingForGrowers = Math.max(0, avail - FLEX_NOTES.floor);
  const widths = { notes: FLEX_NOTES.floor };
  if (remainingForGrowers >= growerNominalTotal) {
    FLEX_GROWERS.forEach((g) => { widths[g.key] = g.nominal; });
    return widths;
  }
  if (remainingForGrowers <= growerFloorTotal) {
    FLEX_GROWERS.forEach((g) => { widths[g.key] = g.floor; });
    return widths;
  }
  const growerDeficit = growerNominalTotal - remainingForGrowers;
  const shrinkRoom = FLEX_GROWERS.reduce((s, g) => s + (g.nominal - g.floor), 0);
  FLEX_GROWERS.forEach((g) => {
    const share = shrinkRoom > 0 ? (g.nominal - g.floor) / shrinkRoom : 0;
    widths[g.key] = Math.round(g.nominal - growerDeficit * share);
  });
  return widths;
}

/** A column's actual rendered width — its own fixed `width`, or the computed flex width when it
 * carries a `flexKey`. `flexWidths` is a `computeFlexWidths(...)` result (or `{}` before the
 * first measurement, in which case every flex column falls back to its own static `width`). */
export function widthFor(col, flexWidths) {
  if (!col.flexKey) return col.width;
  return flexWidths[col.flexKey] ?? col.width;
}

/** Cumulative `left` offset for each FROZEN visible column, in `visibleIdx` order (Type at 0,
 * Title immediately after Type's own width, ...) — pure so the sticky-column math is one tested
 * place rather than re-derived inline in the header and every cell. Returns `{[colKey]: leftPx}`
 * for frozen columns only. */
export function frozenLeftOffsets(visibleIdx, flexWidths) {
  let left = 0;
  const offsets = {};
  for (const idx of visibleIdx) {
    const col = SHEET_COLUMNS[idx];
    if (!col.frozen) continue;
    offsets[col.key] = left;
    left += widthFor(col, flexWidths);
  }
  return offsets;
}
