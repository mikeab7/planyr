/* NEW-1 (2026-09-08) — THE DECIDE BAR'S PURE DECISIONS.
 *
 * The map toolbar stopped asking "what are you making?" before the user had pointed at any
 * ground. It now asks afterwards, on a decide bar, and three small questions decide what that bar
 * says. They live here, out of `MapFinder.jsx`, because each one is a pure function of state the
 * app already holds — no map, no DOM, no Leaflet — and because they are the exact things a
 * regression would break silently (a verb order that quietly stops being sticky still renders a
 * perfectly good-looking toolbar). `test/decideBar.test.js` is the whole guard.
 *
 * Nothing here knows what a verb DOES; `MapFinder.jsx` owns the actions. This module only decides
 * WHICH ground the bar is about, WHICH verb leads, and HOW the leading verb reads.
 */

/* Which ground the decide bar is about, or null when there is none and the toolbar shows its
 * at-rest row instead.
 *
 * Parcels win over a raw pin. In practice the two never coexist — dropping a pin clears the
 * selection — but stating the precedence here rather than relying on that keeps the bar's three
 * verbs unambiguous by construction: they are always about exactly one thing, and a future caller
 * that forgets to clear cannot make them mean two. */
export function decideTargetOf({ selectedCount = 0, hasPin = false } = {}) {
  if (selectedCount > 0) return "parcels";
  if (hasPin) return "pin";
  return null;
}

/* THE STICKY ANSWER, and the reason it exists: the retired Site/Comp toggle made one thing cheap
 * that ground-first makes dearer. Flipping to Comp once meant every following search made a comp;
 * now the app asks each time, so entering comps one at a time costs one extra click each. This
 * pays that back — the last verb chosen leads the next bar, so a run of comps is one click each
 * after the first.
 *
 * `available` is the subset of `all` that can actually run right now (a comp needs somewhere to
 * put it). A stored verb that is not available must NOT lead: leading a bar with a verb it cannot
 * honour is worse than losing the stickiness for one press. Falls back to "site" — the safest of
 * the three on a fresh tab, since a plan is private scratch work and a comp is a standing market
 * record. */
export function orderVerbs(all, lastVerb, isAvailable = () => true) {
  const available = all.filter(isAvailable);
  if (!available.length) return [];
  const lead =
    available.find((k) => k === lastVerb) ||
    available.find((k) => k === "site") ||
    available[0];
  return [lead, ...available.filter((k) => k !== lead)];
}

/* The leading verb's own wording. Owner amendment, 2026-09-08 (verbatim: it reads "Plan a site").
 * The plural keeps the wording this button already carried before the redesign — "Plan N parcels"
 * — because a user assembling adjoining lots is checking exactly that count before committing.
 * Every other verb reads the same however much ground is selected: "a comp" and "a site plan" are
 * single things whatever they are anchored to.
 * NEW-1 (B1892544, 2026-09-24) — the singular reads "Plan this site", not "Plan a site". The
 * other three verbs collapsed off the bar into MapFinder.jsx's "Record info" dropdown (this
 * button stayed a direct, always-visible press), and "this site" reads correctly beside the
 * dropdown trigger where "a site" — grammatically fine on its own — implied a fourth, unnamed
 * site next to the one already picked. The plural is untouched: "Plan N parcels" already names
 * the ground, so it never had that ambiguity. */
export function verbLabel(key, selectedCount = 0) {
  if (key === "site") return selectedCount > 1 ? `Plan ${selectedCount} parcels` : "Plan this site";
  if (key === "comp") return "Log a comp";
  if (key === "siteplan") return "Place a site plan";
  // B1372144 — the fourth verb. Reads the same however much ground is selected, like "a comp" and
  // "a site plan": a note is one thing whatever it is pinned to. Only "site" varies with the count,
  // because a user assembling adjoining lots is checking exactly that number before committing.
  if (key === "note") return "Add a note";
  return "";
}
