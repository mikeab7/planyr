/* Model workspace — the number-format picker's preset list.
 *
 * Every token here is handed straight to the shared engine's formatValue(value,
 * {numberFormat}) (src/shared/formula/formula.js) — nothing is re-implemented. That formatter
 * was already written and already correct (verified: #,##0 · $#,##0.00 · 0.0% · 0.00"/SF"
 * quoted literals · accounting parens · 3-section-with-text · 00000 padding — see
 * test/formula.test.js's "numberFormat" block); it had simply never been called from anywhere.
 * This is the wiring, not a new formatter.
 *
 * ⛔ STAGE 2 RIBBON (B1007281) — the two gaps this file's header used to warn about are CLOSED,
 * in the shared formatter itself (formula.js), not here: a [Red]/[Blue]/… colour tag no longer
 * leaks into the displayed text (and `formatValueColor` now exposes it, so the ribbon's Accounting
 * preset below can actually render negatives in red, not just parens); a date-shaped numberFormat
 * (Date preset below) now really renders through formatDateToken instead of printing the format
 * string back verbatim. Basis points and Multiple(x) are new — the first small, additive
 * extension the shared formatter needed (a literal "bps" scales ×10,000, mirroring how a literal
 * '%' already scales ×100); Multiple(x) needed nothing new, it's an ordinary decimal format with
 * a quoted suffix.
 */
export const NUMBER_FORMATS = [
  { id: "general", label: "General", token: null },
  { id: "number0", label: "Number", token: "#,##0" },
  { id: "number2", label: "Number (2 decimals)", token: "#,##0.00" },
  { id: "currency", label: "Currency", token: "$#,##0.00" },
  { id: "currency0", label: "Currency (whole)", token: "$#,##0" },
  { id: "percent", label: "Percent", token: "0.0%" },
  { id: "percent2", label: "Percent (2 decimals)", token: "0.00%" },
  // Negatives in red AND in parentheses — the two accounting conventions asked for TOGETHER
  // (the owner's brief: "Negatives in red AND in parentheses"), not as separate presets.
  { id: "accounting", label: "Accounting (parens, red)", token: "#,##0.00;[Red](#,##0.00)" },
  { id: "sf", label: "$/SF", token: '0.00"/SF"' },
  { id: "bps", label: "Basis points", token: '0" bps"' },
  { id: "multiple", label: "Multiple (x)", token: '0.00"x"' },
  { id: "date", label: "Date", token: "mm/dd/yyyy" },
];

export const formatLabelFor = (token) => (NUMBER_FORMATS.find((f) => f.token === (token || null)) || {}).label || "Custom";

// ── Format-TOKEN manipulation (the ribbon's Increase/Decrease Decimal + thousands-separator
// toggle buttons) — a different concern from formatValue above: these edit the FORMAT STRING
// itself, never a formatted VALUE, so they don't touch (or duplicate) formatNumberSection at
// all. Regex-based against the same digit-placeholder shape (a run of `0`/`#`, optionally with
// a `.` and more `0`/`#`) formula.js's own formatter recognizes; good enough for every preset
// above and for anything a user hand-types in the same style — not a general Excel-format
// parser.
const PLACEHOLDER_RE = /[0#,]+(\.[0#]*)?/;

function mapSections(token, fn) {
  return String(token).split(";").map(fn).join(";");
}

function bumpDecimals(section, delta) {
  const m = section.match(PLACEHOLDER_RE);
  if (!m) return section; // a literal-only section (no digit placeholder) — nothing to bump
  const whole = m[0];
  const dotIdx = whole.indexOf(".");
  const intPart = dotIdx >= 0 ? whole.slice(0, dotIdx) : whole;
  let decPart = dotIdx >= 0 ? whole.slice(dotIdx + 1) : "";
  if (delta > 0) decPart += "0";
  else decPart = decPart.slice(0, Math.max(0, decPart.length - 1));
  const next = decPart.length > 0 ? `${intPart}.${decPart}` : intPart;
  return section.slice(0, m.index) + next + section.slice(m.index + whole.length);
}

/** One more decimal place, in EVERY section of a (possibly multi-section, e.g. accounting)
 *  token — never just the first, or a 2-section format would show mismatched decimals between
 *  its positive and negative halves. `null`/General starts from a bare "0" — matching Excel's
 *  own Increase Decimal on an unformatted cell, which does NOT silently add a thousands
 *  separator; that's the separate button below. */
export function increaseDecimals(token) {
  return mapSections(token || "0", (section) => bumpDecimals(section, 1));
}

/** One fewer decimal place. A `null`/General token has nothing to decrease — returned as-is
 *  (there is no "General, but with -1 decimals" to fall back to). */
export function decreaseDecimals(token) {
  if (!token) return token;
  return mapSections(token, (section) => bumpDecimals(section, -1));
}

function setThousands(section, on) {
  const m = section.match(PLACEHOLDER_RE);
  if (!m) return section;
  const whole = m[0];
  const dotIdx = whole.indexOf(".");
  const decPart = dotIdx >= 0 ? whole.slice(dotIdx) : "";
  const nextInt = on ? "#,##0" : "0";
  return section.slice(0, m.index) + nextInt + decPart + section.slice(m.index + whole.length);
}

/** Toggle the thousands separator on/off, in every section at once. formatNumberSection only
 *  cares WHETHER a comma appears in a section's digit placeholder (not where), so this is a
 *  clean on/off flip rather than a fragile position-preserving edit. */
export function toggleThousands(token) {
  const base = token || "0";
  const hasComma = /,/.test(base);
  return mapSections(base, (section) => setThousands(section, !hasComma));
}
