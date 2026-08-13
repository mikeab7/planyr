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

/* ⛔ B367298 — THE RUNGS, because ONE short form is not enough on the owner's longest labels.
 *
 * `abbreviateJurisdiction` drops every segment but the governing one and appends "+N". On a normal
 * label that fits any header. On a SPLIT site it does not: "Part in City of Baytown limits (full
 * purpose, 6 of 14 lots) +1" is nearly the whole line, and at his laptop widths the pill fell back
 * to a CSS ellipsis and cut it mid-word — the exact failure `abbreviateJurisdiction` exists to
 * prevent, reached from underneath. Measured in a real browser on Goose Creek and Tsakiris at 761
 * and 860 px; invisible to a source-level guard, which is why the browser harness found it.
 *
 * So the shortener returns a LADDER, and every rung is COMPLETE FACTS — never a cut word:
 *   1. the full line
 *   2. the governing fact + "+N"                        (what `abbreviateJurisdiction` returns)
 *   3. the governing fact WITHOUT its parenthetical qualifier + "+N"
 *      — "(full purpose, 6 of 14 lots)" is itself a fact, so it is dropped as a UNIT
 *   4. NOTHING. The pin alone, and the whole answer on hover.
 *
 * ⛔ RUNG 4 IS DELIBERATE AND IS NOT A COP-OUT. Below a certain width no true statement about a
 * split jurisdiction fits, and the alternatives are a fragment ("Part in City of Bayto…", which
 * reads as a different answer) or a form that drops the qualifier that carries the meaning ("City of
 * Baytown", which claims the whole site is in it). Showing nothing is the only one of the three that
 * cannot mislead, and it costs nothing: the tooltip and `data-jurisdiction-full` still carry every
 * word. This is "navigation wins" followed to its end — a pill with no room to say something TRUE
 * yields the room rather than say something wrong.
 *
 * Pure. Guarded in test/jurisdictionBadgeRungs.test.js and driven in a browser by the ui-audit
 * harness verify-jurisdiction-badge-shapes.
 */
/* ⛔ THE DEEPEST RUNG, BUILT FROM THE MODEL AND NEVER BY CHOPPING THE LABEL. The bare identity of
 * the authority: who governs, with every qualifier dropped as a unit. It is the last thing that can
 * be said truthfully in very little room, and it is the difference between a pill that still names
 * Baytown at a narrow width and one that shows nothing at all (measured: Goose Creek at 761 px needs
 * 231 px for the next rung up and is granted 213).
 *
 * ⚠ "Part in" is KEPT. Without it "City of Baytown" claims the whole site is inside the city, which
 * is a different — and wrong — answer; shortening may drop facts, never reverse one. And it is
 * assembled from `governingCities` / `partialCities` / `etjLabels`, never from `jur`, because
 * recovering a jurisdiction FACT from the jurisdiction LABEL is banned repo-wide
 * (test/jurisdictionCoupling). Returns null when the badge cannot say who governs. */
export function governingIdentity(badge) {
  if (!badge) return null;
  const one = (v) => (Array.isArray(v) && v.length ? String(v[0]) : null);
  const part = one(badge.partialCities);
  if (part) return `Part in City of ${part}`;
  const gov = one(badge.governingCities);
  if (gov) return `City of ${gov}`;
  const etj = one(badge.etjLabels);
  if (etj) return `City of ${etj} ETJ`;
  if (badge.cityContainment === "unknown") return "Couldn't check city limits";
  return badge.cityContainment === "none" ? "Unincorporated" : null;
}

export function jurisdictionRungs(badge) {
  const segs = jurisdictionSegments(badge);
  const full = badge && badge.text ? String(badge.text) : segs.join(" · ");
  if (!segs.length) return [""];
  const hidden = segs.length - 1;
  const plus = (t) => (hidden > 0 ? `${t} +${hidden}` : t);
  const lead = segs[0];
  // The parenthetical is a whole fact and comes off as one. Only ever a TRAILING one, so a name
  // that legitimately contains brackets mid-string is left alone.
  const bare = lead.replace(/\s*\([^()]*\)\s*$/, "").trim();
  const rungs = [full, plus(lead)];
  if (bare && bare !== lead) rungs.push(plus(bare));
  const identity = governingIdentity(badge);
  if (identity) rungs.push(plus(identity));
  rungs.push("");
  // De-duplicate while keeping order: on a one-segment badge rungs 1 and 2 are the same string.
  return rungs.filter((r, i) => rungs.indexOf(r) === i);
}
