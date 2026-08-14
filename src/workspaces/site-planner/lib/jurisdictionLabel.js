/* ═══ NEW-1 — THE ONE CANONICAL JURISDICTION LABEL, AND WHY THE SEPARATOR WAS THE BUG ════════════
 *
 * The owner's report (2026-08-09), on the Clay & Porter site: the header read
 * "Unincorporated / City of Houston ETJ", and his words were *"it would be just City of Houston
 * ETJ… like, it's either Unincorporated or it's COH ETJ."*
 *
 * ⛔ HE IS RIGHT ABOUT THE DISPLAY AND THE REASON MATTERS, SO IT IS ENCODED HERE RATHER THAN IN A
 * COMMENT SOMEWHERE ELSE. The two are NOT mutually exclusive. In Texas an extraterritorial
 * jurisdiction is BY DEFINITION the unincorporated band outside a city's corporate limits
 * (Local Gov't Code ch. 42), so land inside the City of Houston ETJ is NECESSARILY unincorporated.
 * The old label was therefore factually TRUE — it was REDUNDANT, not wrong. **Nothing in this
 * module makes the two mutually exclusive in the MODEL, and nothing downstream may**: the identify
 * still reports `cityContainment: "none"` on an ETJ site, `unincorporated` is still true, and the
 * detention/floodplain tiers still read those. Only the PRESENTATION changed: once an ETJ is named,
 * "Unincorporated" is implied and is not printed.
 *
 * ⛔ THE ACTUAL DEFECT, which is bigger than the redundancy: ONE SEPARATOR MEANT TWO OPPOSITE
 * THINGS. The old formatter joined every part with " / ":
 *     Clay & Porter   "Unincorporated / City of Houston · ETJ"        ← Houston GOVERNS platting here
 *     Bain / Tsakiris "Unincorporated / City of Katy · edge only"     ← Katy governs NOTHING here
 * A reader cannot tell those apart, and they are not the same kind of fact. One separator must not
 * mean both "this city regulates you" and "this city happens to be next door."
 *
 * ═══ THE GRAMMAR — three levels, and each level means exactly one thing ══════════════════════════
 *   `·`  separates SLOTS of the GOVERNING chain, always leading with the governing authority:
 *          <authority> · <ETJ> · <county> · <ISD>
 *   `+`  joins CO-EQUAL PEERS inside one slot (two cities that both hold the site, two counties,
 *        two ISDs). It reads as "and", never as "or".
 *   `—`  introduces the NON-GOVERNING tail: cities that merely touch the site, or that a failed
 *        containment lookup left unclassified. Nothing after this em dash regulates anything.
 *
 * ═══ THE FOUR SHAPES (the owner's, verbatim) — plus the two STATES that are not shapes ═══════════
 *   1. in-city       "City of Houston · Harris County"
 *   2. in-city-etj   "City of Humble · Houston ETJ · Harris County"      (in one city's limits AND
 *                                                                         inside another's ETJ)
 *   3. etj           "City of Houston ETJ · Harris County"               (NOT "Unincorporated /
 *                                                                         City of Houston ETJ")
 *   4. unincorporated "Unincorporated · Harris County — touches City of Katy"
 *
 *   Note the ETJ naming is deliberately asymmetric: the LEAD slot carries the full formal
 *   "City of X ETJ" because it is the governing authority; a SECONDARY ETJ is the qualifier
 *   "X ETJ". That is the owner's own wording in both shapes above.
 *
 *   `split` and `unknown` are not among the four because they are not shapes of a settled answer —
 *   they are the two states where there ISN'T one, and they predate this item (B280704 / B276753):
 *   a site straddling a city limit has TWO governing answers (both joined with `·`, because both
 *   really govern), and a failed containment lookup has none and may never let a city lead.
 *
 * Pure — no DOM, no network, no React. Unit-tested in test/jurisdictionLabel.test.js; the full
 * badge strings are pinned per shape against real recorded agency answers in
 * test/jurisdictionShapes.test.js. */

// The three separators, exported so no consumer re-types one and no test asserts a literal.
export const SLOT_SEP = " · ";   // governing chain:  ·
export const PEER_SEP = " + ";        // co-equal peers inside one slot
export const TOUCH_SEP = " — ";  // the non-governing tail:  —

export const JURISDICTION_SHAPES = Object.freeze([
  "in-city", "in-city-etj", "etj", "unincorporated", "split", "unknown",
]);

const list = (v) => (Array.isArray(v) ? v.filter((s) => s != null && s !== "").map(String) : []);

/* ⛔ NEW-1 — LIMITED-PURPOSE AND STRIP ANNEXATION GET THEIR OWN SLOT AND THEIR OWN NOUN.
 *
 * "City of Baytown" is the phrase a reader takes to mean the city's whole ordinance set, so it is
 * reserved for FULL-PURPOSE limits. Limited-purpose and strip annexation are named as what they
 * are — they are real, they belong on the badge, and they are not the same fact. The plain-English
 * explanation of each rides the info popover (`cityLimitClass.cityLimitGloss`), never the badge:
 * PANEL-BREVITY rule 3, a named state beats a sentence explaining the state. */
export const LIMIT_CLASS_NOUN = {
  limited: (name) => `${name} limited-purpose annexation`,
  strip: (name) => `${name} strip annexation`,
  unknown: (name) => `${name} city-limits layer, class not stated`,
};
// A share, as the badge says it. Null share (no area pass) prints nothing — a lot count is NOT a
// share and may never stand in for one (NEW-2).
export const shareNote = (share) => (share == null ? "" : `${Math.round(share * 100)}% by area`);

/* Which of the six the model is. Asked BEFORE any string is built, so the shape is a fact about
 * the jurisdiction rather than a description of the text that came out. */
export function jurisdictionShapeOf(model = {}) {
  const gov = list(model.governingCities);
  const part = list(model.partialCities);
  const etj = list(model.etjCities);
  if (model.cityUnresolved) return "unknown";
  if (part.length) return "split";
  if (gov.length) return etj.length ? "in-city-etj" : "in-city";
  if (etj.length) return "etj";
  return "unincorporated";
}

/* The governing slot — what regulates this land. Exactly one of five outcomes, in this order:
 * city limits · a straddle of them · an admitted failure · an ETJ · unincorporated. */
function leadFor(model, shape) {
  const gov = list(model.governingCities);
  const part = list(model.partialCities);
  const etj = list(model.etjCities);
  if (shape === "unknown") return "Couldn't check city limits";
  if (shape === "split") {
    /* NEW-1/NEW-2 — the split lead names the CLASS and states the share as an AREA fraction. Both
     * halves are the item: "part in City of Baytown" gave no idea whether that is a third of the
     * site or a lot line, and it did not distinguish full-purpose limits (Goose Creek) from a
     * limited-purpose annexation (Grand Port), which are different amounts of authority. */
    // `splitNote` arrives either already parenthesised (the legacy lot count) or bare (the area
    // share). One pair of brackets, either way.
    const bare = String(model.splitNote || "").trim().replace(/^\((.*)\)$/, "$1");
    const note = [model.splitClass === "full" ? "full purpose" : null, bare].filter(Boolean).join(", ");
    const noun = (c) => (model.splitClass && model.splitClass !== "full"
      ? (LIMIT_CLASS_NOUN[model.splitClass] || LIMIT_CLASS_NOUN.unknown)(c)
      : `City of ${c} limits`);
    const cities = part.map((c) => `Part in ${noun(c)}${note ? ` (${note})` : ""}`).join(PEER_SEP);
    // The remainder is MEASURED upstream (B280704) — never assumed to be "unincorporated", because
    // at Goose Creek the other 8 of 14 lots sit inside Baytown's own ETJ, and calling ETJ land
    // unincorporated drops the city's floodplain standard out of the FFE comparison entirely.
    /* ⛔ B367298 — TWO SLOTS, NOT ONE PRE-JOINED STRING, and this is a fit bug rather than a wording
     * one. `slots` is what the header pill drops whole facts FROM; a split that hands it one string
     * containing its own " · " gives the shortener nothing to drop, so the pill fell back to a CSS
     * ellipsis and cut mid-word — measured on the owner's two longest labels (Goose Creek and
     * Tsakiris) at laptop widths. `jur` and `text` are unchanged: the caller joins these with the
     * same separator. Asserted in test/jurisdictionLabel.test.js. */
    return [cities, model.remainderLabel].filter(Boolean);
  }
  if (gov.length) return gov.map((c) => `City of ${c}`).join(PEER_SEP);
  // ⛔ THE ITEM ITSELF: an ETJ leads, and "Unincorporated" is NOT printed beside it. An ETJ is
  // unincorporated land by definition, so the word adds nothing and reads as a contradiction.
  if (etj.length) return etj.map((c) => `City of ${c} ETJ`).join(PEER_SEP);
  return "Unincorporated";
}

/* The ETJ slot, which exists only when something ELSE already took the lead. When the ETJ IS the
 * lead (shape 3) this is empty by construction — printing it twice is the redundancy this item is
 * about, in a second costume. */
function etjSlotFor(model, shape) {
  const etj = list(model.etjCities);
  if (shape === "etj") return null;                 // already the lead
  if (shape === "split") return null;               // the remainder label already names it
  if (etj.length) return etj.map((c) => `${c} ETJ`).join(PEER_SEP);
  // "We could not check" and "there is no ETJ here" are OPPOSITE facts that imply different
  // floodplain rules (B209507). Silence is only ever the second one.
  if (model.etjUnresolved) return "Couldn't check ETJ";
  return null;
}

/* Format the whole label. Returns the pieces as well as the joined text, so a consumer that wants
 * one part (the county line, the tail) never has to split a string apart to get it — which is the
 * coupling NEW-2 exists to prevent. */
/* The limited-purpose / strip slot. It sits AFTER the ETJ because it is the weaker claim of the
 * two on land outside a city's limits — an ETJ is a defined statutory reach, a limited-purpose
 * annexation is a specific instrument whose scope has to be confirmed with the city. It is
 * omitted entirely when there is none, so no site that has never met one gains a character. */
function limitedSlotFor(model) {
  const areas = Array.isArray(model.limitedAreas) ? model.limitedAreas : [];
  if (!areas.length) return null;
  return areas.map((a) => {
    const noun = (LIMIT_CLASS_NOUN[a.class] || LIMIT_CLASS_NOUN.unknown)(String(a.name || "").replace(/^City of\s+/i, ""));
    const note = shareNote(a.share);
    return note ? `${noun} (${note})` : noun;
  }).join(PEER_SEP);
}

export function formatJurisdictionLabel(model = {}) {
  const shape = jurisdictionShapeOf(model);
  const slots = [leadFor(model, shape), etjSlotFor(model, shape), limitedSlotFor(model)]
    .flat()               // B367298 — a split lead is TWO governing slots; every other lead is one
    .filter(Boolean);
  const jur = slots.join(SLOT_SEP);

  const counties = list(model.counties);
  const county = counties.length
    ? counties.map((c) => `${c} County`).join(PEER_SEP)
    : model.countyUnresolved ? "Couldn't check county" : null;

  const isds = list(model.isds);
  const isd = model.isdOverride ? String(model.isdOverride) : (isds.length ? isds.join(PEER_SEP) : null);

  /* The tail. A city here regulates NOTHING on this site — it either merely brushes the boundary
   * (a frontage sliver) or a failed lookup left it unclassified. It is separated by the em dash
   * precisely so it can never be read as part of the governing answer, which is what " / " let
   * happen for a year. */
  const adjacent = list(model.adjacentCities);
  const unclassified = list(model.unclassifiedCities);
  const touches = [
    adjacent.length ? `touches ${adjacent.map((c) => `City of ${c}`).join(", ")}` : null,
    unclassified.length ? `touches ${unclassified.map((c) => `City of ${c}`).join(", ")}, containment unchecked` : null,
  ].filter(Boolean);
  const tail = touches.length ? touches.join("; ") : null;

  const chain = [jur, county, isd].filter(Boolean).join(SLOT_SEP);
  const text = tail ? `${chain}${TOUCH_SEP}${tail}` : chain;
  /* NEW-2 (B371361) — `slots` is handed back, not just joined away. The header pill has to be able
   * to SHORTEN this line when the row is tight, and it must drop whole facts rather than characters
   * (a CSS ellipsis turns "Part in City of Baytown (6 of 14 lots)" into a different, wrong answer).
   * Returning the array it already built is the same rule as `governingCities`: nothing downstream
   * should have to take a rendered string apart. */
  return { shape, slots, jur, county, isd, tail, text };
}

/* ⛔ NEW-2 — THE STRUCTURED ACCESSOR, and the whole reason it is exported.
 *
 * `SitePlanner.jsx` used to derive the governing city by PARSING the formatted badge:
 *     (jurBadge?.jur || "").split(" / ")[0].replace(/^City of\s+/, "")
 * and handed the result to `assessAdministrator` as `cityLabel` — the signal that decides whether
 * a city's floodplain ordinance is even a CANDIDATE for the finished-floor elevation. Under the
 * grammar above that parse returns "Humble · Houston ETJ" for shape 2: no rule record matches it,
 * the city candidate silently vanishes, and the site is priced on the county's rule, which in flat
 * Harris/Fort Bend floodplain commonly sits 1–2 ft LOWER than the city's.
 *
 * So the label is now a LEAF: it is produced from the model and nothing reads back out of it.
 * `test/jurisdictionCoupling.test.js` proves this accessor survives every shape AND sweeps the
 * source tree for the banned parse. */
export function governingCityOf(badge) {
  if (!badge) return null;
  const gov = list(badge.governingCities);
  if (gov.length) return gov[0];
  // A city holding PART of the site is a real candidate — `resolveAdministrator` picks the
  // STRICTER rule, so including it can only raise the floor (B276753).
  const part = list(badge.partialCities);
  return part.length ? part[0] : null;
}
