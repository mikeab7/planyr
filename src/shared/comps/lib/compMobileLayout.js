/* compMobileLayout — pure model behind the comp entry sheet's MOBILE (transposed) layout
 * (B1091712, owner rule 2026-09-03: below a breakpoint the horizontal grid becomes a
 * transposed sheet — fields as ROWS, one comp per screen. The owner reviewed three layout
 * options and picked this shape; it is decided, not re-litigated here.
 *
 * This module owns exactly one question: for a given comp TYPE, which fields show, in which
 * SECTION, in which order. It reads `SHEET_COLUMNS` from compSheetColumns.js — the same pure
 * column model the desktop sheet uses — so a mobile field can never mean something different
 * from its desktop counterpart, and a future column addition/removal is picked up by both
 * layouts from one place.
 *
 * SECTION_ORDER is one fixed list, filtered per row by each column's own `appliesTo(compType)`
 * — never a per-type branch. That's what makes "swap RENT/TERM/CONCESSIONS for PRICE on a LAND
 * comp" fall out for free: RENT/TERM/CONCESSIONS columns all `appliesTo` lease only, so they
 * filter to empty (and the whole section is dropped) on a land/building-sale row, while PRICE's
 * columns filter to empty on a lease row. A comp type never named here explicitly stays correct
 * automatically if `compSheetColumns.js` ever grows a fourth deal type.
 *
 * NEEDED_TO_SAVE is a SEPARATE, pinned pseudo-section built from `col.required` — Executed and
 * Location are the two columns already marked required in compSheetColumns.js, so this reads
 * that flag rather than hardcoding the two keys, and stays in lockstep with the desktop sheet's
 * own definition of "required." Deliberately NOT repeated inside PROPERTY (a field is edited in
 * exactly one place on this sheet — see PANEL-BREVITY in /CLAUDE.md, "never render the same
 * fact in more than one place"); PROPERTY's own "Deal name" row is the free-text Title field
 * (desktop labels the same column "Title / Address" — mobile already shows the resolved address
 * in the identity strip and the pinned Location row, so it only needs the free-text half here).
 */
import { SHEET_COLUMNS, columnIndex } from "./compSheetColumns.js";
import { rowHasBlockingFlags } from "./compParse.js";

export const MOBILE_BREAKPOINT_PX = 820;

// One label override: desktop's "Title / Address" column reads as "Deal name" on mobile, where
// the resolved address already has its own row (NEEDED_TO_SAVE) and its own strip (identity).
const MOBILE_LABEL_OVERRIDES = { title: "Deal name" };

const SECTION_ORDER = [
  { title: "Property", keys: ["compType", "title", "size", "landSizeUnit"] },
  { title: "Rent", keys: ["leaseRate", "leaseRatePeriod", "leaseRateExpense", "leaseEscalationPct", "leaseAnnualRate"] },
  { title: "Term", keys: ["leaseCommencementDate", "leaseTerm"] },
  { title: "Concessions", keys: ["leaseFreeRentMonths", "leaseTi"] },
  { title: "Price", keys: ["price", "bldgNoi", "bldgCapRate", "salePricePerArea"] },
  { title: "Parties", keys: ["partyProvider", "partyAcquirer", "notes"] },
];

function colFor(key) {
  return SHEET_COLUMNS[columnIndex(key)];
}

// The owner's spec names the order explicitly ("NEEDED TO SAVE (Executed, Location)") — SHEET_COLUMNS'
// own declaration order puts Location first (it's the second FROZEN desktop column), so the pinned
// section's order is stated here rather than inherited. Still SOURCED from `col.required` — a future
// required column not in this list is appended rather than silently dropped.
const REQUIRED_KEY_ORDER = ["compDate", "location"];
const REQUIRED_KEYS = [
  ...REQUIRED_KEY_ORDER.filter((k) => colFor(k)?.required),
  ...SHEET_COLUMNS.filter((c) => c.required && !REQUIRED_KEY_ORDER.includes(c.key)).map((c) => c.key),
];

export function mobileLabel(col) {
  return MOBILE_LABEL_OVERRIDES[col.key] || col.label;
}

/** The pinned "Needed to save" pseudo-section for one comp type: every required column that
 * applies to it, in `REQUIRED_KEYS` order (Executed, then Location). */
export function neededToSaveColumns(compType) {
  return REQUIRED_KEYS.map(colFor).filter((c) => c.appliesTo(compType));
}

/** Every OTHER section for one comp type, each `{title, cols}` — a section with no applicable
 * column at all (RENT on a land comp, PRICE on a lease comp) is dropped outright, never shown
 * as an empty/greyed group. */
export function mobileSections(compType) {
  return SECTION_ORDER
    .map((s) => ({ title: s.title, cols: s.keys.map(colFor).filter((c) => c.appliesTo(compType)) }))
    .filter((s) => s.cols.length > 0);
}

/** Is a single REQUIRED column still unfilled on this draft? Location's "filled" test is its
 * anchor (the column is `kind:"action"`, so there is no plain string value to read); every other
 * required column reads its own `getValue`. */
export function isRequiredColEmpty(col, draft) {
  if (col.key === "location") return !draft?.anchor;
  const v = col.getValue(draft);
  return v == null || v === "";
}

/** How many required fields are still unfilled on this row (the "N left" count the pinned
 * section's caption shows). */
export function neededToSaveRemaining(row) {
  return neededToSaveColumns(row.draft.compType).filter((c) => isRequiredColEmpty(c, row.draft)).length;
}

/** A short, human sentence naming why a row isn't ready yet — used by the jump sheet's sub-line
 * and nowhere else (PANEL-BREVITY: state it once). A blocking cell flag (the lease rate/period
 * 12x-ambiguity case) always wins over a plain missing-field reading, since it names a real
 * data-quality problem rather than an empty box. */
export function rowStatusText(row) {
  if (rowHasBlockingFlags(row.cellFlags)) return "rate needs a period";
  const missing = neededToSaveColumns(row.draft.compType).filter((c) => isRequiredColEmpty(c, row.draft));
  if (!missing.length) return "ready";
  return `needs ${missing.map((c) => (c.key === "compDate" ? "a date" : "a location")).join(" & ")}`;
}
