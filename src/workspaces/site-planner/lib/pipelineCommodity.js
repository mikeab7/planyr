/* Pipeline commodity crosswalk + symbology (B751) — pure, dependency-free, unit-tested.
 *
 * The RRC T-4 pipeline layer publishes a free-text `COMMODITY_DESCRIPTION` per segment
 * (e.g. "NATURAL GAS", "CRUDE OIL", "PROPANE", "REFINED PRODUCTS"). This module maps that
 * text into SIX fixed styling buckets and returns each bucket's map symbology.
 *
 * SYMBOLOGY RULES (owner-approved 2026-07-10):
 *   • Colors are FIXED map-symbology hex — consistent on the aerial basemap regardless of
 *     the app's light/dark theme (same convention as the hardcoded EVIDENCE line colors like
 *     `hifld_tx`). They are deliberately NOT theme palette tokens: a pipeline colored by
 *     commodity must read the SAME every time, so a screener learns "amber = gas".
 *   • WEIGHT encodes hazard / consequence (NOT diameter — diameter surfaces in the
 *     click-identify). Highly volatile liquids are loudest; unknown is quietest.
 *   • DASH is a SECOND signal so the six classes survive grayscale / colorblind viewing.
 *   • Salience tracks hazard, monotonically (HVL → unknown). Never invert it.
 *
 * HIGH-HAZARD OUTLIERS (owner-approved candidate): commodities that don't fit the five named
 * energy buckets but ARE genuinely high-hazard — hydrogen, anhydrous ammonia — are routed to
 * the RED HVL style (so salience keeps tracking hazard) while the click-identify keeps their
 * TRUE commodity name. They are NEVER dropped into the low-salience gray "unknown" bucket.
 * The real distinct-value set is reconciled live (gis-verify/pipeline-commodity-distinct-verify.mjs
 * + V264) — if the RRC data carries a high-hazard commodity this crosswalk misses, it surfaces
 * there rather than being silently buried.
 *
 * Crude/refined/gas keyword ordering matters and is deliberate — see `commodityBucket`.
 */

// One row per bucket, ordered LOUDEST → QUIETEST (salience === hazard). `dash` is an SVG /
// Leaflet dash-array string (null = solid). `weight` is the stroke weight in px.
export const COMMODITY_BUCKETS = [
  { key: "hvl",     label: "Highly volatile liquids", legendLabel: "HVL (NGL, propane, …)",     color: "#E24B4A", dash: null,      weight: 4 },
  { key: "gas",     label: "Natural gas",             legendLabel: "Natural gas",                color: "#EF9F27", dash: null,      weight: 3 },
  { key: "crude",   label: "Crude oil",               legendLabel: "Crude oil",                  color: "#7F77DD", dash: null,      weight: 3 },
  { key: "refined", label: "Refined products",        legendLabel: "Refined (gasoline/diesel/jet)", color: "#1D9E75", dash: "10 6",    weight: 3 },
  { key: "co2",     label: "Carbon dioxide (CO₂)",    legendLabel: "Carbon dioxide (CO₂)",       color: "#378ADD", dash: "9 5 2 5", weight: 2.5 },
  { key: "unknown", label: "Unknown / unclassified",  legendLabel: "Unknown / unclassified",     color: "#9a9992", dash: "5 5",     weight: 2 },
];

const BUCKET_BY_KEY = Object.fromEntries(COMMODITY_BUCKETS.map((b) => [b.key, b]));

/* The bucket record for a key (falls back to `unknown` on a bad key — never throws). Pure. */
export const commodityBucketRecord = (key) => BUCKET_BY_KEY[key] || BUCKET_BY_KEY.unknown;

// Keyword groups, evaluated in a DELIBERATE priority order (see commodityBucket). Each is a
// single case-insensitive RegExp so the whole crosswalk is one linear scan.
//  - refined FIRST: "GAS OIL" / "GASOLINE" are refined products, and evaluating them before the
//    natural-gas `\bGAS\b` test keeps a bare "GAS" from stealing them.
//  - hvl BEFORE gas: "NATURAL GAS LIQUIDS" must land in HVL, not natural gas.
//  - crude requires the word CRUDE (a bare "OIL" is ambiguous — "fuel oil" is refined).
const RE_REFINED = /GASOLINE|GASOHOL|DIESEL|\bJET\b|JET\s*(?:FUEL|-?A)|KEROSENE|REFINED|TRANSMIX|NAPHTHA|AVIATION|MOTOR\s*FUEL|GAS\s*OIL|DISTILLATE|FUEL\s*OIL/i;
// Alkane names carry \b so "METHANE" (natural gas) doesn't match the "ETHANE" substring.
const RE_HVL = /\bNGL?S?\b|NATURAL\s*GAS\s*LIQUID|Y[-\s]?GRADE|\bPROPANE\b|\bETHANE\b|\bBUTANE\b|\bISOBUTANE\b|\bPENTANE\b|\bPROPYLENE\b|\bETHYLENE\b|\bLPG\b|LIQU[EI]FIED\s*PETROLEUM|HIGHLY\s*VOLATILE|\bHVL\b/i;
// High-hazard outliers → red HVL style, but the identify keeps the true commodity name.
const RE_HVL_HAZARD = /HYDROGEN|ANHYDROUS\s*AMMONIA|\bAMMONIA\b/i;
const RE_CRUDE = /CRUDE/i;
const RE_CO2 = /CARBON\s*DIOXIDE|\bCO2\b|\bCO²\b/i;
const RE_GAS = /NATURAL\s*GAS|\bGAS\b|METHANE|CASINGHEAD|SOUR\s*GAS|SWEET\s*GAS|FUEL\s*GAS/i;

/* Map a free-text COMMODITY_DESCRIPTION to one of the six bucket keys. Blank / unmatched →
 * "unknown" (the gray bucket, by design — an honest "we couldn't classify this", never a fake
 * precise class). Pure. */
export function commodityBucket(desc) {
  const s = String(desc == null ? "" : desc).trim();
  if (!s) return "unknown";
  if (RE_REFINED.test(s)) return "refined";
  if (RE_HVL.test(s) || RE_HVL_HAZARD.test(s)) return "hvl";
  if (RE_CRUDE.test(s)) return "crude";
  if (RE_CO2.test(s)) return "co2";
  if (RE_GAS.test(s)) return "gas";
  return "unknown";
}

/* True when a commodity is a high-hazard OUTLIER routed to the HVL style but not chemically an
 * HVL (hydrogen, anhydrous ammonia) — used only for the live-reconcile report / tests. Pure. */
export function isHazardOutlier(desc) {
  const s = String(desc == null ? "" : desc);
  return RE_HVL_HAZARD.test(s) && !RE_HVL.test(s);
}

/* Leaflet path style for a pipeline feature's properties. `commodityField` names the attribute
 * carrying the description (defaults to the RRC column). `opacity` multiplies the stroke.
 * Returns a Leaflet path-style object ({ color, weight, dashArray, opacity, fill:false }). Pure. */
export function pipelineStyleFor(props, opacity = 1, commodityField = "COMMODITY_DESCRIPTION") {
  const b = commodityBucketRecord(commodityBucket(props && props[commodityField]));
  return { color: b.color, weight: b.weight, dashArray: b.dash || null, opacity, fill: false };
}

/* The six-class legend rows for the LayerPanel ({ label, color, dash:boolean }), ordered by
 * salience. `dash` is a boolean here (the panel chip only shows solid-vs-dashed; the exact
 * pattern renders on the map). Pure. */
export const PIPELINE_LEGEND = COMMODITY_BUCKETS.map((b) => ({ label: b.legendLabel, color: b.color, dash: !!b.dash }));
