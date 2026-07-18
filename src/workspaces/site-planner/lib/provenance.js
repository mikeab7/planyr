/* B895 — the Yield-panel PROVENANCE source-tag vocabulary (chat "yield panel
 * provenance readability" brief). Presentation-only: this module classifies WHERE a
 * headline figure came from — it never computes, thresholds, or reclassifies a value.
 * Six words, trust decreasing, one color each (SourceTag.jsx renders them; the color
 * mapping lives here so a future consumer — print, another panel — inherits it free):
 *
 *   CODE       (violet) — an adopted ordinance / criteria value (a rate, a ratio, a
 *               cited section) — the number a reviewing authority actually enforces.
 *   PLAN       (green)  — measured from the user's own drawn geometry (areas,
 *               coverage, stalls, cut/fill quantities).
 *   SURVEY     (blue)   — public measured data (USGS 3DEP elevations, county-GIS
 *               parcel/FIRM lines) — not adopted criteria, not drawn by the user.
 *   ESTIMATE   (amber)  — derived where nothing published exists (a WSE read off
 *               grade, a Modified-Rational volume, an auto-graded plane).
 *   YOURS      (gray)   — the user typed it in (a BFE override, an allowable release
 *               rate, a unit-price bid).
 *   UNVERIFIED (red, hollow) — a placeholder default standing in until confirmed.
 *
 * classifyWseSource / classifyVerified below turn signals the engine ALREADY computes
 * (WSE_PROVIDER_LABEL codes in floodplainMitigation.js, the `verified` flag
 * pondAutoValues() already carries) into one of these six ids — a display mapping,
 * not new logic.
 */

export const SOURCE_TAGS = {
  code: { id: "code", label: "CODE", order: 0, short: "Adopted ordinance / criteria value" },
  plan: { id: "plan", label: "PLAN", order: 1, short: "Measured from your drawn geometry" },
  survey: { id: "survey", label: "SURVEY", order: 2, short: "Public measured data (USGS 3DEP, county GIS)" },
  estimate: { id: "estimate", label: "ESTIMATE", order: 3, short: "Derived where nothing published exists" },
  yours: { id: "yours", label: "YOURS", order: 4, short: "You entered this value" },
  unverified: { id: "unverified", label: "UNVERIFIED", order: 5, short: "Placeholder default — confirm before use" },
};

export const SOURCE_TAG_ORDER = ["code", "plan", "survey", "estimate", "yours", "unverified"];

// One CSS custom property per tag — SourceTag/SourcesLegend read these, never raw hex.
// PLAN/SURVEY/ESTIMATE/YOURS/UNVERIFIED reuse the existing AA-audited semantic-text
// tokens (success/info/warn/text-secondary/danger); CODE has no existing semantic-text
// token, so it gets its own (--source-code-text, index.css) rather than repurposing the
// Schedule module's accent for an unrelated meaning.
export const SOURCE_TAG_COLOR_VAR = {
  code: "--source-code-text",
  plan: "--success-text",
  survey: "--info-text",
  estimate: "--warn-text",
  yours: "--text-secondary",
  unverified: "--danger-text",
};

export function sourceTag(id) {
  return SOURCE_TAGS[id] || null;
}

// WSE_PROVIDER_LABEL (floodplainMitigation.js) codes → a source-tag id. "static-bfe" is
// the one PUBLISHED/effective value (SURVEY); "manual" is a typed-in override (YOURS);
// every other code (bfe-line-interp, xs-wsel*, the fbcdd/est-*/ebfe-*/maapnext-* family,
// derived-wse100, "mixed") is DERIVED where nothing published resolved it (ESTIMATE).
// A missing/unknown source means the value hasn't been confirmed at all (UNVERIFIED).
export function classifyWseSource(src) {
  if (!src) return "unverified";
  if (src === "static-bfe") return "survey";
  if (src === "manual") return "yours";
  return "estimate";
}

// pondAutoValues()/DETENTION_CRITERIA fields already carry `verified: true|false` (a
// human checked the citation vs. false = "Planyr screening convention" placeholder).
// true → CODE (it's the cited criteria value); false → UNVERIFIED (a placeholder
// default). A manually-typed override is YOURS, checked by the caller before this.
export function classifyVerified(verified) {
  return verified ? "code" : "unverified";
}
