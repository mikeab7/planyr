/* WHAT SITS ON TOP OF WHAT — the whole contract, as committed data (B548819).
 *
 * ⛔ WHY THIS FILE EXISTS, and it is a process failure more than a code one. "Send to back /
 * layers never work" has been reported SIX times. It was fixed four times — B421, B820, B671,
 * B293072/B293073 — and every one of those fixes was correct. Every one of them also tested a
 * markup against ANOTHER MARKUP, which is the case that already worked. The fifth report was a
 * markup against a BUILDING (B548064, #1066). The sixth turned out not to be ordering at all: a
 * measurement and a markup shared a default colour (B548816).
 *
 * The owner's standing instruction after the sixth is the reason for the shape of this file: he
 * should not have to tell us to check all the cases. So this enumerates EVERY ORDERED PAIR of
 * drawn families — not the three somebody happened to try — states the expected relationship for
 * each, and names the command that reverses it where one exists. `test/paintOrder.test.js` proves
 * the enumeration is complete and matches the render; `ui-audit/verify-paint-order-contract.mjs`
 * drives the real app and proves the drawing agrees with the table.
 *
 * ⛔ TWO DEFAULTS THE OWNER DECIDED (2026-08-15), recorded here as data rather than left to fall
 * out of render order. Both were ALREADY TRUE; the instruction was to make them explicit and
 * enforced rather than incidental, so that the next person who reorders something has to break a
 * named assertion instead of quietly changing what the drawing means:
 *   1. A MEASUREMENT OUTRANKS DECORATION. Its job is to display a number. It is the top rung of
 *      the annotation stack, above markups and above callouts.
 *   2. A PARCEL DEFAULTS TO BEHIND. It is the ground the plan is drawn on, so everything except a
 *      reference the user has not promoted paints over it.
 *
 * Pure data + pure predicates. No React, no DOM.
 */

/* The user-facing name of the ONE cross-band command, in both directions. Five different pairs of
 * words were in the menus for this single idea — "Send behind buildings" (markup), "Send behind
 * the plan" (measurement, callout), "Draw above the plan" (reference), "Force on top of
 * everything" (element). A user cannot be expected to know those are one concept, and the drift
 * is exactly how the fifth report came to be filed as a different bug from the first four. This
 * is the canonical pair; the element's divergence is declared and justified in the capability
 * table (`e2e/elementCapabilities.table.js`), not left as an accident.
 *
 * "the plan" and not "buildings", deliberately: the band sits below EVERY site element, so a
 * markup sent behind it also goes under roads, paving and ponds. "Behind buildings" describes one
 * of those and would be wrong on a plan whose annotation covers a drive aisle. */
export const CROSS_BAND_BEHIND = "Send behind the plan";
export const CROSS_BAND_FRONT = "Bring in front of the plan";

/* ------------------------------------------------------------------------------- THE LADDER
 *
 * Every rung the canvas paints, bottom first — this mirrors the render order in SitePlanner.jsx
 * exactly, and `test/paintOrder.test.js` reads that file to prove it still does.
 *
 * `family` is the drawn class. `band` is which of that family's two positions this rung is:
 *   "only"   — the family has one position.
 *   "behind" / "above" — the two ends of a family's cross-band toggle.
 *   "forced" — a site element the user explicitly forced on top of everything (B316864).
 * `isDefault` marks the rung an untouched object of that family lands on.
 */
export const PAINT_LADDER = [
  { rung: 0, family: "reference", band: "behind", isDefault: true,  note: "a dropped drawing sits under the plan until promoted" },
  { rung: 1, family: "parcel",    band: "only",   isDefault: true,  note: "OWNER DEFAULT: the ground the plan is drawn on" },
  { rung: 2, family: "markup",    band: "behind", isDefault: false, note: null },
  { rung: 3, family: "callout",   band: "behind", isDefault: false, note: null },
  { rung: 4, family: "measure",   band: "behind", isDefault: false, note: null },
  { rung: 5, family: "element",   band: "only",   isDefault: true,  note: "within its own type layer: road → paving → pond → parking → building" },
  { rung: 6, family: "element",   band: "forced", isDefault: false, note: "the explicit, reversible 'Force on top of everything'" },
  { rung: 7, family: "markup",    band: "above",  isDefault: true,  note: null },
  { rung: 8, family: "reference", band: "above",  isDefault: false, note: null },
  { rung: 9, family: "callout",   band: "above",  isDefault: true,  note: null },
  { rung: 10, family: "measure",  band: "above",  isDefault: true,  note: "OWNER DEFAULT: a measurement outranks decoration" },
];

/** The five drawn families, in no particular order. */
export const FAMILIES = ["reference", "parcel", "markup", "callout", "measure", "element"];

/** The rung an untouched object of `family` paints on. */
export function defaultRung(family) {
  const r = PAINT_LADDER.find((x) => x.family === family && x.isDefault);
  return r ? r.rung : null;
}

/** Every rung this family can reach, low to high. */
export const rungsFor = (family) => PAINT_LADDER.filter((x) => x.family === family).map((x) => x.rung);

/* Which families can cross the plan with the ONE named command, and in which directions. A
 * family that cannot is not a gap — an element IS the plan, and a parcel is the ground; neither
 * has a "behind the plan" to go to. Stated so the absence is a decision on the record. */
export const CROSS_BAND = {
  markup:    { behind: CROSS_BAND_BEHIND, front: CROSS_BAND_FRONT },
  callout:   { behind: CROSS_BAND_BEHIND, front: CROSS_BAND_FRONT },
  measure:   { behind: CROSS_BAND_BEHIND, front: CROSS_BAND_FRONT },
  reference: { behind: CROSS_BAND_BEHIND, front: CROSS_BAND_FRONT },
  element:   {
    behind: "Use the normal layer order",
    front: "Force on top of everything",
    divergentName:
      "An element IS the plan, so it has no behind-the-plan to go to and the canonical pair would " +
      "be a lie on it. Its escape hatch goes the other way — UP past every annotation — and its " +
      "'off' state returns it to the type-layer rule (B316864) rather than sending it anywhere. " +
      "Different destination, different words, declared rather than drifted.",
  },
  parcel: null, // the ground; nothing to cross
};

/**
 * The expected relationship between two families when BOTH are untouched — which the owner sees
 * as "which one is on top". Returns "over" when `a` paints above `b`, "under" when below.
 * Never "either": every ordered pair has an answer, and that is the point of the table.
 */
export function defaultRelation(a, b) {
  if (a === b) return "same";
  const ra = defaultRung(a), rb = defaultRung(b);
  if (ra == null || rb == null) return null;
  return ra > rb ? "over" : "under";
}

/** Can the user reverse the default relationship between `a` and `b`, and with what?
 *  Returns { reversible, by } — `by` names the command on whichever object has to move. */
export function reversal(a, b) {
  const rel = defaultRelation(a, b);
  if (rel !== "over" && rel !== "under") return { reversible: false, by: null };
  const upper = rel === "over" ? a : b;
  const lower = rel === "over" ? b : a;
  // The object on top can drop below the plan, or the object underneath can be lifted over it —
  // whichever of the two owns a cross-band command.
  if (CROSS_BAND[upper]) return { reversible: true, by: `${upper}: ${CROSS_BAND[upper].behind}` };
  if (CROSS_BAND[lower]) return { reversible: true, by: `${lower}: ${CROSS_BAND[lower].front}` };
  return { reversible: false, by: null };
}

/** Every ordered pair of distinct families, with its stated relationship and reversal. This is
 *  the enumeration the owner asked for — 30 rows for 6 families, generated from the ladder so it
 *  can never fall out of step with what the canvas actually paints. */
export function orderedPairs() {
  const out = [];
  for (const a of FAMILIES) {
    for (const b of FAMILIES) {
      if (a === b) continue;
      out.push({ a, b, relation: defaultRelation(a, b), ...reversal(a, b) });
    }
  }
  return out;
}
