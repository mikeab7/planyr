/* Model workspace — the number-format picker's preset list.
 *
 * Every token here is handed straight to the shared engine's formatValue(value,
 * {numberFormat}) (src/shared/formula/formula.js:1006-1019) — nothing is re-implemented.
 * That formatter was already written and already correct (verified live: #,##0 · $#,##0.00 ·
 * 0.0% · 0.00"/SF" quoted literals · accounting parens · 3-section-with-text · 00000 padding);
 * it had simply never been called from anywhere. This is the wiring, not a new formatter.
 *
 * Two known gaps in the underlying formatter, inherited rather than worked around here:
 * [Red] colour codes are emitted as a literal (not rendered in red) and a numberFormat that
 * names a date token is ignored. Neither matters for the presets below.
 */
export const NUMBER_FORMATS = [
  { id: "general", label: "General", token: null },
  { id: "number0", label: "Number", token: "#,##0" },
  { id: "number2", label: "Number (2 decimals)", token: "#,##0.00" },
  { id: "currency", label: "Currency", token: "$#,##0.00" },
  { id: "currency0", label: "Currency (whole)", token: "$#,##0" },
  { id: "percent", label: "Percent", token: "0.0%" },
  { id: "percent2", label: "Percent (2 decimals)", token: "0.00%" },
  { id: "accounting", label: "Accounting (parens)", token: "#,##0.00;(#,##0.00)" },
  { id: "sf", label: "$/SF", token: "0.00\"/SF\"" },
];

export const formatLabelFor = (token) => (NUMBER_FORMATS.find((f) => f.token === (token || null)) || {}).label || "Custom";
