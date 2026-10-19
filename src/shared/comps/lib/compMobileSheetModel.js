/* compMobileSheetModel — pure model behind the REVIEW-FIRST phone comp sheet (NEW-2, 2026-10-05).
 *
 * `CompEntryMobileSheet.jsx` is presentation only; every decision it renders lives here so it is
 * unit-tested without a DOM: the one-line footer read-back, the derived price read-back under the
 * Price row, the Save button copy for its three blocker states, which "More details" fields exist
 * per comp type, and the Term months/years entry unit. Nothing here changes what a comp IS — all
 * values are read off the same draft the desktop sheet edits (`draftToComp`, the column getters).
 */
import { SHEET_COLUMNS, columnIndex, NOTES_COLUMN, formatNumberDisplay, sanitizeNumericInput, activeCellFlags } from "./compSheetColumns.js";
import { draftToComp, buildingPricePerSf, landPricePerAreaUnit, annualLeaseRate, validateComp } from "./comps.js";
import { rowHasBlockingFlags } from "./compParse.js";

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

/** compDate label: `Date signed` on a lease, `Closing date` on land and building sale (NEW-11). */
export function compDateLabel(compType) {
  return compType === "lease" ? "Date signed" : "Closing date";
}

/* ---- Rate period: a visible, one-tap-to-change GUESS from the rate (NEW-4, owner-approved) ------ */

/** Under 2 reads as a monthly rate ($/SF/mo), over 3 as yearly; 2 to 3 is genuinely ambiguous (null). */
export function guessPeriod(rate) {
  if (rate === "" || rate == null) return null;
  const n = Number(rate);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < 2) return "monthly";
  if (n > 3) return "annual";
  return null;
}

/** What to do about the rate period after the rate / period / guess state moved. Returns the next
 * `{ period, guessed }` to commit, or null for "leave it alone". A period the person (or the paste)
 * set is never touched; a tap locks it for good (`locked`); a guess follows the rate until then, and
 * is cleared with it. */
export function periodGuessStep({ rate, period, guessed, locked }) {
  if (locked) return null;
  if (period && !guessed) return null;
  const g = guessPeriod(rate);
  if (g == null) return period && guessed ? { period: "", guessed: false } : null;
  if (period === g && guessed) return null;
  return { period: g, guessed: true };
}

/** The period pill's next value when tapped: mo <-> yr; unset goes to monthly (a visible choice). */
export const flipPeriod = (p) => (p === "monthly" ? "annual" : "monthly");
export const flipBasis = (b) => (b === "gross" ? "nnn" : "gross");

/** Term entry-unit pill text and flip. */
export const TERM_UNIT_SHORT = { months: "mo", years: "yr" };
export const flipTermUnit = (u) => (u === "years" ? "months" : "years");

/** Tenant (lease) / Buyer (sale) — the party a blank deal name falls back to (NEW-8). */
export function partyNameFallback(draft) {
  return String(col("partyAcquirer").getValue(draft) ?? "").trim();
}
/** A row for saving: a blank `title` takes the party name; a typed name is never overwritten. */
export function withTitleFallback(row) {
  const title = String(row.draft.title ?? "").trim();
  if (title) return row;
  const party = partyNameFallback(row.draft);
  return party ? { ...row, draft: { ...row.draft, title: party } } : row;
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

/** What a phone row renders for a `cellState`: `derived` ONLY when it carries a real computed
 * number; a `na` state or a derived cell with no number is an EMPTY editable input (the `Add`
 * placeholder), never a bare dash that looks untappable. (Land Price owner report 2026-10-08.) */
export function rowFieldState(st) {
  const bare = (t) => t == null || String(t).trim() === "" || /^[—–-]$/.test(String(t).trim());
  if (st.state === "derived" && !bare(st.text)) return st;
  return { state: "editable", text: st.state === "editable" ? st.text : "", raw: st.state === "editable" ? (st.raw ?? "") : "" };
}

/** Width, in `ch`, of an input that hugs its own text (digits are one ch; commas/dots are narrower).
 * The empty state is as wide as its `Add` placeholder. */
export function hugWidthCh(text) {
  const t = String(text ?? "");
  if (!t) return 3;
  const narrow = (t.match(/[.,]/g) || []).length;
  return Math.max(2, t.length - narrow * 0.5 + 0.2);
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

/** The sticky footer's live read-back. Builds as fields fill; "" while nothing is entered (the
 * sheet hides the line entirely then — NEW-7). */
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
  return parts.join(" · ");
}

/* ---- Save button ------------------------------------------------------------------------- */

/** Which blocker a row has, as `{ kind, key, text }` or null. `kind`: `location` · `period` (a lease
 * with a rate and no period, none guessed) · `flag` (another blocking flag; `key` is the flagged field)
 * · `other`. Reads the row's own `validateComp` errors and blocking flags (limited to flags that still
 * apply to the row's current type) — never a guess. All types need a placed location; a LEASE with a
 * rate also needs its period. Land and building sale need no size or price (nullable in `comps.sql`),
 * so no copy ever claims they do. The Save button never shows these — a tap on it routes the person
 * to the offending row (`saveTapPlan`). */
export function rowBlockerInfo(row) {
  const comp = draftToComp(row.draft);
  const errors = validateComp(comp);
  const flags = activeCellFlags(row.cellFlags, row.draft.compType);
  if (errors.some((e) => /comp type/i.test(e))) return { kind: "other", key: "compType", text: "Pick a comp type to save" };
  if (errors.some((e) => /pin|parcel/i.test(e))) return { kind: "location", key: "location", text: "Place it on the map to save" };
  if (errors.some((e) => /rent period/i.test(e)) || flags.leaseRatePeriod?.level === "blocking") return { kind: "period", key: "leaseRate", text: "Monthly or yearly? They differ by 12x." };
  if (rowHasBlockingFlags(flags)) {
    const key = Object.keys(flags).find((k) => flags[k]?.level === "blocking");
    return { kind: "flag", key, text: "Fix the flagged field to save" };
  }
  if (errors.length) return { kind: "other", key: null, text: "Finish the missing field to save" };
  return null;
}
export const rowBlocker = (row) => rowBlockerInfo(row)?.text ?? null;

/** `{ label, disabled }` for the one full-width Save button. It is NEVER disabled for a missing
 * field (NEW-9) — only while saving, or with no comp at all. `Save comp` for one, `Save N comps` for a
 * batch (N = the rows that will actually save, else the batch size). */
export function saveState({ rows, readyCount, saving }) {
  if (saving) return { label: "Saving…", disabled: true };
  if (!rows.length) return { label: "Nothing to save yet", disabled: true };
  if (rows.length === 1) return { label: "Save comp", disabled: false };
  const n = readyCount > 0 ? readyCount : rows.length;
  return { label: `Save ${n} comp${n === 1 ? "" : "s"}`, disabled: false };
}

/** What a tap on Save does: save every ready row (title-fallback applied), then — if any row is not
 * ready — take the person to the FIRST such row's blocker. For the current row alone this is the whole
 * story; in a batch the ready rows go and the walk starts at the first not-ready one. */
export function saveTapPlan({ rows, isReady }) {
  const toSave = rows.filter(isReady).map(withTitleFallback);
  const first = rows.find((r) => !isReady(r));
  const info = first ? (rowBlockerInfo(first) || { kind: "other", key: null, text: "Finish the missing field to save" }) : null;
  return { toSave, target: first ? { rowId: first._id, ...info } : null };
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
