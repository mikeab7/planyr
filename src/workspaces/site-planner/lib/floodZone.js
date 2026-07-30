/* NEW-1 / NEW-2 / NEW-3 — THE ONE ANSWER TO "what flood zone is this, and what does it MEAN".
 *
 * WHAT WENT WRONG. On a Colorado site the hover readout said, in full:
 *
 *     Flood Hazard Zones: 08069c_2802
 *     Type: X
 *
 * …over an empty map. Every part of that is technically true and none of it is usable. Verified
 * live against FEMA's own service on 2026-07-30:
 *   • `08069C_2802` is `FLD_AR_ID`, layer 28's `displayField` — an internal record id, not a panel.
 *   • `Type: X` is `FLD_ZONE`, picked by the generic identify row-spec, which lists FLD_ZONE ahead
 *     of ZONE_SUBTY and stops at the first hit. So the SUBTYPE — the only field that separates the
 *     two completely different things both called "Zone X" — was fetched and then dropped.
 *   • Nothing drew because FEMA's layer-28 renderer has NO symbol for unshaded X and NO default
 *     symbol. The blank map was the map agreeing, and it read as a broken layer.
 *
 * THE FIELD THAT MATTERS. In the National Flood Hazard Layer BOTH variants of Zone X carry
 * `FLD_ZONE = "X"`; only `ZONE_SUBTY` tells them apart:
 *   UNSHADED X — "AREA OF MINIMAL FLOOD HAZARD": outside the 1% AND the 0.2% floodplains. FEMA
 *                paints nothing. Correctly invisible.
 *   SHADED X   — the 0.2% (500-year) band. FEMA paints it orange. It is INSIDE the 500-year
 *                floodplain, and this app already ships rules keyed off exactly that line —
 *                COH Ch.19 (FFE at the 0.2% WSE + 2 ft), Fort Bend's Interim Atlas-14 §9 offset
 *                to the pre-Atlas-14 500-yr surface, Waller Art. 5 §A(8). A reader that cannot
 *                resolve shaded X feeds those rules the wrong answer.
 *
 * ⛔ THE SUBTYPE VOCABULARY IS WIDER THAN "0.2 PCT", AND THE OLD TEST MISSED 54,000 POLYGONS.
 * The two predecessors of this module (`siteAnalysis.isShadedX`, `floodplainMitigation.isShadedX`)
 * both tested /0\.2\s*pct|0\.2\s*%|500\s*yr/. Read straight off layer 28's live renderer, FEMA
 * paints these FLD_ZONE = X subtypes in its "0.2% Annual Chance Flood Hazard" class too:
 *     "1 PCT DEPTH LESS THAN 1 FOOT"                  → 30,981 polygons nationally
 *     "1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE"   → 23,157 polygons nationally
 *     …plus the "PERCENT"-spelled twins of every "PCT" form, and the coastal / combined /
 *     contained-in-channel / contained-in-structure qualifiers.
 * (Counts measured against the live service 2026-07-30.) Those are shaded Zone X on the FIRM, so
 * a 500-year fill trigger reaches them — and the app was classifying them as "no flood hazard".
 * The classification here follows FEMA'S OWN RENDERER rather than a guess at the wording, which is
 * why the two X classes it deliberately does NOT fold in are also renderer decisions:
 *     "1 PCT FUTURE CONDITIONS…"        → FEMA's separate "Future Conditions" class. Drawn, but
 *                                          not the EFFECTIVE regulatory floodplain.
 *     "AREA WITH REDUCED FLOOD RISK…"   → FEMA's separate "Reduced Risk Due to Levee" class.
 * Both are named states here, never silently lumped into "no hazard".
 *
 * WHAT THIS MODULE IS — AND WHAT ITS SIBLING IS. This is the CLASSIFIER: pure, leaf-level, no
 * strings a user ever reads. `resolveFloodZone(attrs)` answers one question — which of the eight
 * flood-zone variants is this polygon — and every engine on the site route reads it (the
 * compensating-storage ledger, the screening analysis, the map paint).
 *
 * ⛔ THE WORDS LIVE NEXT DOOR, IN `floodZoneCopy.js`, AND THAT SPLIT IS LOAD-BEARING. Every
 * user-facing sentence (the answer-first headline, the plain meaning, the no-data states) and all
 * of the NEW-3 provenance (the FIPS tables, the FIRM study and panel decode) sit in that module,
 * which is reached ONLY by dynamic import — the lazily-loaded hover path and the Layers panel's
 * own loader. The site-route chunk had 0.4 KB of headroom when this work landed, and a module
 * imported by BOTH the boot path and a lazy chunk is hoisted whole into their common ancestor, so
 * a static edge from here to the copy would put every one of those sentences back on the boot
 * path. Split by TIER, not by topic — the same rule the export path follows. Do not "tidy" the
 * two modules back together.
 */

/* ---------------------------------------------------------------------------
 * Zone semantics
 * ------------------------------------------------------------------------- */

const s = (v) => (v == null ? "" : String(v)).trim();
const up = (v) => s(v).toUpperCase();

/* FEMA Special Flood Hazard Area codes — the regulatory 1%-annual-chance (100-yr) floodplain.
 * Kept here rather than imported from siteAnalysis.js so this module stays leaf-level (it is read
 * by the map paint, the panel and the lazily-loaded hover path alike); `siteAnalysis.isSFHA` now
 * delegates to it, so there is still exactly ONE list. */
const SFHA_ZONES = new Set("A AE AH AO AR A99 V VE VO AR/AE AR/AH AR/AO AR/A AR/A99".split(" "));

export function isSfhaZone(zone) {
  const z = up(zone);
  if (!z) return false;
  if (SFHA_ZONES.has(z)) return true;
  return /^(A|V)([1-9]|[12][0-9]|30)$/.test(z); // legacy numbered zones A1-A30 / V1-V30
}

const isFloodwaySubtype = (subtype) => /floodway/i.test(s(subtype));

/* The two X subtypes FEMA draws in a class of their OWN — neither the 0.2% band nor "no hazard".
 * Tested BEFORE the shaded test, because "1 PCT FUTURE CONDITIONS, FLOODWAY" would otherwise be
 * read as a regulatory floodway and "…FUTURE CONDITIONS" as a 1-percent form. */
const isFutureConditionsSubtype = (subtype) => /future\s+cond/i.test(s(subtype));
const isLeveeReducedSubtype = (subtype) => /reduced\s+flood\s+(risk|hazard)/i.test(s(subtype));

/* SHADED Zone X — the 0.2% (500-yr) band, as FEMA's layer-28 renderer defines it. See the header:
 * this is deliberately wider than "0.2 PCT". Never call it on a future-conditions or levee subtype
 * (resolveFloodZone orders those first). */
export function isShadedXSubtype(subtype) {
  const t = up(subtype);
  if (!t) return false;
  if (/0\.2\s*(PCT|PERCENT|%)/.test(t)) return true;
  if (/\b500[-\s]?(YR|YEAR)/.test(t)) return true;
  // "1 PCT DEPTH LESS THAN 1 FOOT" / "1 PCT DRAINAGE AREA LESS THAN 1 SQUARE MILE" — 1%-chance
  // areas that FEMA maps as SHADED X because they fall below the depth / drainage-area thresholds
  // for an SFHA. Both spellings of "PCT".
  if (/^1\s*(PCT|PERCENT)\s+(DEPTH|DRAINAGE AREA)\b/.test(t)) return true;
  // Non-accredited levee areas mapped as X ride the same 0.2% symbology.
  if (/NON-?ACCREDITED LEVEE/.test(t) && !/REDUCED/.test(t)) return true;
  return false;
}

/* Resolve ONE NFHL S_Fld_Haz_Ar feature's attributes (or an already-normalized {zone, subtype}
 * pair) into the app's single flood-zone answer. Pure.
 *
 * Returns { zone, subtype, sfha, floodway, shadedX, variant } — the CLASSIFICATION and nothing
 * a user reads. `describeFloodZone` in floodZoneCopy.js turns it into the answer-first
 * headline and the plain meaning. `null` for an input with no zone at all; an ABSENT or failed
 * answer is `floodAbsence(kind)` over there, never a null this function returns.
 */
export function resolveFloodZone(attrs) {
  if (!attrs) return null;
  const zone = up(attrs.FLD_ZONE != null ? attrs.FLD_ZONE : attrs.zone);
  const subtype = s(attrs.ZONE_SUBTY != null ? attrs.ZONE_SUBTY : attrs.subtype);
  if (!zone && !subtype) return null;
  const sfhaFlag = up(attrs.SFHA_TF != null ? attrs.SFHA_TF : attrs.sfhaTf) === "T";
  const sfha = sfhaFlag || isSfhaZone(zone);

  let variant = "other";
  if (isFloodwaySubtype(subtype) && !isFutureConditionsSubtype(subtype)) variant = "floodway";
  else if (sfha) variant = "sfha";
  else if (isFutureConditionsSubtype(subtype)) variant = "x-future";
  else if (isLeveeReducedSubtype(subtype)) variant = "x-levee";
  else if (isShadedXSubtype(subtype)) variant = "shaded-x";
  else if (zone === "X") variant = subtype ? "unshaded-x" : "x-unstated";
  else if (zone === "D") variant = "d";

  return {
    zone,
    subtype,
    sfha,
    floodway: variant === "floodway",
    shadedX: variant === "shaded-x",
    variant,
  };
}

