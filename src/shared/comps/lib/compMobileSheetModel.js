/* compMobileSheetModel — pure model behind the REVIEW-FIRST phone comp sheet (NEW-2, 2026-10-05).
 *
 * `CompEntryMobileSheet.jsx` is presentation only; every decision it renders lives here so it is
 * unit-tested without a DOM: the one-line footer read-back, the derived price read-back under the
 * Price row, the Save button copy for its three blocker states, which "More details" fields exist
 * per comp type, and the Term months/years entry unit. Nothing here changes what a comp IS — all
 * values are read off the same draft the desktop sheet edits (`draftToComp`, the column getters).
 */
import { SHEET_COLUMNS, columnIndex, NOTES_COLUMN, saveButtonLabel, formatNumberDisplay, sanitizeNumericInput } from "./compSheetColumns.js";
import { draftToComp, buildingPricePerSf, landPricePerAreaUnit, annualLeaseRate } from "./comps.js";

export const SF_PER_ACRE = 43560;

const col = (key) => (key === "notes" ? NOTES_COLUMN : SHEET_COLUMNS[columnIndex(key)]);
export const mobileCol = col;

const money = (n, maxFrac = 0) => `$${n.toLocaleString("en-US", { minimumFractionDigits: maxFrac, maximumFractionDigits: maxFrac })}`;
const money2 = (n) => money(n, 2);

/* ---- Deal-group field labels -------------------------------------------------------------- */

/** Party row labels on the phone: lease Landlord / Tenant, land + building sale Seller / Buyer. */
export function mobilePartyLabels(compType) {
  return compType === "lease" ? { provider: "Landlord", acquirer: "Tenant" } : { provider: "Seller", acquirer: "Buyer" };
}

/** compDate label: `Lease signed` on a lease, `Closed` on a sale. */
export function compDateLabel(compType) {
  return compType === "lease" ? "Lease signed" : "Closed";
}

/* ---- Term: stored in months, entered in months OR years -------------------------------------- */

export const TERM_UNITS = ["months", "years"];

/** What the person typed -> the string the `leaseTerm` column setter commits (always MONTHS).
 * Years are ×12 (rounded to 2 decimals so 5.3 yr stays 63.6 mo, never a float tail). */
export function termToMonths(raw, unit) {
  const s = sanitizeNumericInput(raw);
  if (s === "" || s === ".") return "";
  const n = Number(s);
  if (!Number.isFinite(n)) return "";
  if (unit !== "years") return s;
  return String(Math.round(n * 12 * 100) / 100);
}

/** Stored months (string from the column getter) -> the string shown in the chosen unit. */
export function termForDisplay(monthsRaw, unit) {
  if (monthsRaw === "" || monthsRaw == null) return "";
  const m = Number(monthsRaw);
  if (!Number.isFinite(m)) return "";
  if (unit !== "years") return String(monthsRaw);
  return String(Math.round((m / 12) * 100) / 100);
}

/** The quiet other-reading under Term: `64 mo = 5.3 yr` (or `5 yr = 60 mo`). Null with no term. */
export function termOtherReading(monthsRaw, unit) {
  if (monthsRaw === "" || monthsRaw == null) return null;
  const m = Number(monthsRaw);
  if (!Number.isFinite(m) || m <= 0) return null;
  const yr = Math.round((m / 12) * 10) / 10;
  const mo = Math.round(m * 100) / 100;
  return unit === "years" ? `${yr} yr = ${mo} mo` : `${mo} mo = ${yr} yr`;
}

/* ---- Derived read-backs ------------------------------------------------------------------- */

const sizeOf = (d) => (d.compType === "land" ? d.landSizeValue : d.compType === "building_sale" ? d.bldgSizeSf : d.leaseSizeSf);
const priceOf = (d) => (d.compType === "land" ? d.landPrice : d.bldgPrice);

/** Quiet line under the Price row, or null until price AND size are both present.
 *  land: `= $217,647 /AC · $5.00 /SF` (the entry unit's rate first)   building sale: `= $77.08 /SF` */
export function priceReadback(draft) {
  const comp = draftToComp(draft);
  if (draft.compType === "building_sale") {
    const v = buildingPricePerSf(comp);
    return v != null ? `= ${money2(v)} /SF` : null;
  }
  if (draft.compType === "land") {
    const r = landPricePerAreaUnit(comp);
    if (!r) return null;
    const perAc = r.unit === "ac" ? r.value : r.value * SF_PER_ACRE;
    const perSf = r.unit === "sf" ? r.value : r.value / SF_PER_ACRE;
    return r.unit === "ac"
      ? `= ${money(perAc)} /AC · ${money2(perSf)} /SF`
      : `= ${money2(perSf)} /SF · ${money(perAc)} /AC`;
  }
  return null;
}

/** The sticky footer's live read-back. Builds as fields fill; `Nothing entered yet` when empty. */
export function footerReadback(draft) {
  const comp = draftToComp(draft);
  const parts = [];
  const sizeRaw = sizeOf(draft);
  const sizeText = sizeRaw === "" || sizeRaw == null ? "" : formatNumberDisplay(sizeRaw);
  if (draft.compType === "lease") {
    const rate = Number(draft.leaseRate);
    if (draft.leaseRate !== "" && draft.leaseRate != null && rate > 0) {
      const basis = draft.leaseRateExpense ? ` ${String(draft.leaseRateExpense).toUpperCase()}` : "";
      if (draft.leaseRatePeriod === "monthly") {
        const yr = annualLeaseRate(comp);
        parts.push(`${money2(rate)}/SF/mo${basis}${yr != null ? ` · ${money2(yr)}/yr` : ""}`);
      } else if (draft.leaseRatePeriod === "annual") {
        parts.push(`${money2(rate)}/SF/yr${basis}`);
      } else {
        parts.push(`${money2(rate)}/SF mo or yr?${basis}`);
      }
    }
    if (sizeText) parts.push(`${sizeText} SF`);
    const months = col("leaseTerm").getValue(draft);
    if (months !== "" && months != null) parts.push(`${months} mo`);
  } else if (draft.compType === "land") {
    if (sizeText) parts.push(`${sizeText} ${draft.landSizeUnit === "ac" ? "AC" : "SF"}`);
    const p = priceOf(draft);
    if (p !== "" && p != null && Number(p) > 0) parts.push(money(Number(p)));
    const r = landPricePerAreaUnit(comp);
    if (r) parts.push(`${money2(r.unit === "ac" ? r.value / SF_PER_ACRE : r.value)}/SF`);
  } else {
    if (sizeText) parts.push(`${sizeText} SF`);
    const p = priceOf(draft);
    if (p !== "" && p != null && Number(p) > 0) parts.push(money(Number(p)));
    const v = buildingPricePerSf(comp);
    if (v != null) parts.push(`${money2(v)}/SF`);
  }
  return parts.length ? parts.join(" · ") : "Nothing entered yet";
}

/* ---- Save button ------------------------------------------------------------------------- */

/** `{ label, disabled }` for the one full-width Save button. `rowReadyFn(row)` is the grid's own
 * readiness test. Three blocker states: no rows · only the location missing · otherwise-blocked. */
export function saveState({ rows, readyCount, saving }) {
  if (saving) return { label: "Saving…", disabled: true };
  if (!rows.length) return { label: "Nothing to save yet", disabled: true };
  if (readyCount > 0) return { label: saveButtonLabel(readyCount), disabled: false };
  const missingLocation = rows.some((r) => !r.draft.anchor);
  if (missingLocation) return { label: "Place it on the map to save", disabled: true };
  return { label: "Pick mo or yr to save", disabled: true };
}

/* ---- More details ------------------------------------------------------------------------ */

const MORE_KEYS = ["clearHeightFt", "yearBuilt", "leaseOpex", "leaseEscalationPct", "leaseCommencementDate",
  "leaseFreeRentMonths", "leaseTi", "bldgNoi", "bldgCapRate", "compDate", "notes"];

/** Suffix/prefix shown INSIDE the box for a More-details field (only once it has a value/focus). */
export const MORE_AFFIX = {
  clearHeightFt: { suffix: "ft" },
  leaseOpex: { prefix: "$", suffix: "/SF/yr" },
  leaseEscalationPct: { suffix: "%/yr" },
  leaseFreeRentMonths: { suffix: "mo" },
  leaseTi: { prefix: "$", suffix: "/SF" },
  bldgNoi: { prefix: "$" },
  bldgCapRate: { suffix: "%" },
};

/** Every other applicable column for the type, in order, as `{ col, label }` (label per type). */
export function moreDetailFields(compType) {
  return MORE_KEYS.map(col).filter((c) => c.appliesTo(compType)).map((c) => ({
    col: c,
    label: c.key === "compDate" ? compDateLabel(compType) : c.fullLabel?.replace(/\s*\(.*?\)|\s*\$\/SF$|\s*%\/yr$/g, "") || c.label,
  }));
}

/** Is this More-details field already holding a value (render as a row) or empty (an Add chip)? */
export function moreFieldHasValue(c, draft) {
  const v = c.getValue(draft);
  return v !== "" && v != null;
}
