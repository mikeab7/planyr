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
 * ⛔ RUNG 10 (renumbered from 11 by B1788912, below) — B806080 ROUND 2, after the owner corrected
 * his own brief: "Bring to front on a callout must actually place it above everything else drawn
 * on the plan" — no either/or, no "the command tells the user what band it operates in." Measured
 * on his live plan: a WETLANDS callout at z=34816 (already the highest z of any callout) still
 * painted UNDER an area measurement at z=0, because the measure-above rung's own default ("a
 * measurement outranks decoration") is exactly the wall the old default-relationship ladder was
 * never meant to let a single explicit command cross. `calloutFrontForceZ`/`calloutAtAbsoluteFront`
 * (lib/arrange.js) are the ONLY mechanism that writes/reads it. It does not change `defaultRelation`
 * for anything — every pairing above is still about UNTOUCHED objects — it adds ONE more rung an
 * explicitly-forced callout can reach.
 *
 * ⛔ B1788912 (2026-09-19, NEW-1) — THE ELEMENT-FORCED RUNG IS GONE, AND THE LADDER RENUMBERED.
 * Elements no longer have a type-layer band to force themselves out of (planStyle.js's Z_LAYER is
 * retired — see /CLAUDE.md's owner-constraints entry 10); "element" now has exactly ONE rung, same
 * shape as every family that never had a forced escape hatch in the first place. The old rung 6
 * ("element forced," `bandForce: "front"`) is deleted rather than left as a gap, and every rung from
 * the old 7 onward shifted down by one (7→6, 8→7, 9→8, 10→9, 11→10) — `test/paintOrder.test.js`'s
 * contiguous-rung check is what enforces that a future edit can't leave a hole. `CROSS_BAND.element`
 * stays declared (not `null`, unlike the parcel row) because ordinary Arrange still gives an element
 * a real, wired Bring-to-Front / Send-to-Back — it just no longer crosses anything, since there is
 * nothing left on the other side of a band that doesn't exist. NEW-2's selection lift (a selected
 * element or road-network cluster paints after everything else while selected) is deliberately NOT
 * a rung here: it is ephemeral UI state, not a property stored on the object, and every OTHER rung
 * in this ladder is about what an untouched or deliberately-flagged object does. See
 * `SitePlanner.jsx`'s `elPaintItems` for where the lift actually happens.
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
 *   "forced" — a callout the user explicitly forced to the absolute front (B806080 round 2).
 * `isDefault` marks the rung an untouched object of that family lands on.
 */
export const PAINT_LADDER = [
  { rung: 0, family: "reference", band: "behind", isDefault: true,  note: "a dropped drawing sits under the plan until promoted" },
  { rung: 1, family: "parcel",    band: "only",   isDefault: true,  note: "OWNER DEFAULT: the ground the plan is drawn on" },
  { rung: 2, family: "markup",    band: "behind", isDefault: false, note: null },
  { rung: 3, family: "callout",   band: "behind", isDefault: false, note: null },
  { rung: 4, family: "measure",   band: "behind", isDefault: false, note: null },
  // B1788912 (NEW-1) — elements stack in plain creation order now; there is no second, "forced" rung.
  { rung: 5, family: "element",   band: "only",   isDefault: true,  note: "creation order — whatever was drawn or arranged last is on top (B1788912)" },
  { rung: 6, family: "markup",    band: "above",  isDefault: true,  note: null },
  { rung: 7, family: "reference", band: "above",  isDefault: false, note: null },
  { rung: 8, family: "callout",   band: "above",  isDefault: true,  note: null },
  { rung: 9, family: "measure",   band: "above",  isDefault: true,  note: "OWNER DEFAULT: a measurement outranks decoration" },
  { rung: 10, family: "callout",  band: "forced", isDefault: false, note: "the explicit, reversible absolute-front escape hatch (B806080 round 2) — literally above every other family" },
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
  /* B1788912 (2026-09-19, NEW-1) — an element has no band left to cross at all: the type-layer rule
   * it used to escape (B316864's `bandForce`) is retired, so "front"/"behind" here are ordinary
   * Arrange — the same Bring to Front / Send to Back every element already uses to reorder against
   * every OTHER element — never a second mechanism. Declared rather than `null` (unlike the parcel
   * row) only so this table still names a real, wired command for the element side of every pair it
   * appears in; it can never carry an element below the parcel ground plane, which no element
   * mechanism has ever been able to do (arrangeEnds is capped at the "element" rung — see
   * `SitePlanner.jsx`'s `arrangeSel`, whose peer set is every element, never anything outside it). */
  element:   {
    behind: "Send to Back",
    front: "Bring to Front",
    divergentName:
      "An element has no band left to cross (B1788912 retired the type-layer rule it used to " +
      "escape). What crosses here is ordinary Arrange, not a special escape hatch — the same " +
      "Bring to Front / Send to Back every element already uses to reorder against every other " +
      "element, and it never reaches past the element rung itself.",
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
