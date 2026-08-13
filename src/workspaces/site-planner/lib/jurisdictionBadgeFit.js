/* NEW-2 — HOW THE JURISDICTION PILL GETS SHORTER WHEN THE HEADER IS TIGHT, and the rule behind it.
 *
 * ⛔ NAVIGATION WINS. The pill must shrink, truncate or collapse before it ever overlaps the
 * project / plan chips — never the other way round. A jurisdiction label is INFORMATION; the plan
 * switcher is how the owner gets work done. His report, verbatim: "if I am looking at a site on a
 * normal sized laptop screen, I can't change between the concepts or the plans because the
 * unincorporated / city of Houston / ETJ / Harris County chip is too big and it covers it."
 *
 * The layout half of that rule lives in `AppHeader` (the zone flex) and the min-widths live on the
 * chips. This module is the CONTENT half: what a shortened pill says.
 *
 * ⛔ IT DROPS WHOLE FACTS, NEVER CHARACTERS. A CSS ellipsis on this line cuts mid-word and can
 * leave "Part in City of Bayto…" — which reads as a different, wrong answer rather than a short
 * one. The badge is a list of segments in reading order, GOVERNING FIRST (`formatJurisdictionBadge`
 * builds it that way on purpose: the city limits or "Unincorporated", then the ETJ, then the
 * county, then the district). So the abbreviation keeps the LEAD — the fact that governs — and
 * says how many it is not showing: "Unincorporated +3".
 *
 * ⛔ AND THE FULL STRING IS NEVER LOST. The component keeps it in the tooltip AND in the DOM
 * (`data-jurisdiction-full`), so hovering shows everything and a headless check can read the whole
 * answer without measuring pixels. Shortening the DEFAULT VIEW is the tool; deleting a fact is not
 * (PANEL-BREVITY §6, same principle on a different surface).
 *
 * Pure — no DOM, no React. Guarded in test/headerNavPriority.test.js.
 */

/**
 * The badge's display segments in reading order, governing fact first.
 * @param {object|null} badge a `formatJurisdictionBadge` result.
 * @returns {string[]} e.g. ["City of Houston ETJ", "Harris County", "Katy ISD"] — and the
 *   non-governing tail, if there is one, as the LAST segment, because it is the first thing worth
 *   dropping and the last thing anyone reads.
 */
export function jurisdictionSegments(badge) {
  if (!badge) return [];
  /* ⛔ `parts` IS `formatJurisdictionLabel`'s OWN `slots` ARRAY, HANDED THROUGH — and there is
   * deliberately NO string fallback that takes the rendered label apart. `SLOT_SEP` would in fact
   * split the chain correctly under the current grammar (peers inside a slot join with `+`), and
   * that is exactly the temptation the coupling guard exists to refuse: recovering a jurisdiction
   * FACT from the jurisdiction LABEL is the parse `governingCities` was introduced to retire, and
   * it is banned repo-wide by test/jurisdictionCoupling. A legacy or hand-written badge with no
   * slots therefore contributes its governing chain as ONE opaque segment — shorter than ideal,
   * never wrong. */
  const slots = Array.isArray(badge.parts) && badge.parts.length
    ? badge.parts.filter((p) => p != null && String(p) !== "")
    : [badge.jur].filter((p) => p != null && String(p).trim() !== "");
  return [...slots.map(String), badge.county, badge.isd, badge.tail]
    .filter((p) => p != null && String(p).trim() !== "")
    .map(String);
}

/**
 * The shortened form of a badge: the governing fact, plus a count of what is not shown.
 * @param {object|null} badge a `formatJurisdictionBadge` result.
 * @returns {{text: string, hidden: number, full: string}} `text` is what to render; `hidden` is how
 *   many segments it stands in for; `full` is the complete string, which never stops being
 *   available. A badge with one segment abbreviates to itself with no "+0" — a count of nothing is
 *   noise, and the pill is already as short as it goes.
 */
export function abbreviateJurisdiction(badge) {
  const segs = jurisdictionSegments(badge);
  const full = badge && badge.text ? String(badge.text) : segs.join(" · ");
  if (!segs.length) return { text: "", hidden: 0, full };
  const hidden = segs.length - 1;
  return { text: hidden > 0 ? `${segs[0]} +${hidden}` : segs[0], hidden, full };
}
