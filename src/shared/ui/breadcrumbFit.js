/* breadcrumbFit.js — NEW-4 (B1343203): the pure decision behind the phone-narrow breadcrumb's
 * middle-crumb collapse. Kept out of ProjectBreadcrumb.jsx's DOM measurement effect so the
 * decision itself is unit-testable without mounting a component or driving a browser — same
 * split as `headerCenterFit.js`'s `centerSlotPlan` beside its own DOM-measuring caller.
 *
 * THE REPORT this answers (owner's iPhone screenshot, project Goose Creek): "Map / Goose Creek
 * (dropdown) / Phase II - Revision (dropdown) / Pa…" — the fourth item cut mid-word at the screen
 * edge, with nothing on screen indicating the row scrolls. The trail is really three crumbs
 * (Dashboard "Map" · the project · the plan) plus, immediately after them in the same
 * horizontally-scrolling row, the Site Planner's own jurisdiction pill (which is what "Pa…" was —
 * the start of "Part in City of …"). NEW-2's scroll chevron/fade makes that continuation visible
 * as a strip, not a mystery fourth crumb; this module's job is narrower and comes first: make
 * sure the three REAL crumbs — and above all the LAST one, the plan actually open — fit without
 * needing a scroll at all, whenever the screen has room for that.
 *
 * The rule: collapse the MIDDLE crumb (the project) to a compact "…" affordance exactly when the
 * full, uncollapsed trail (Dashboard + two separators + the project's own natural width + the
 * trailing plan crumb) would not fit in the space actually available before the row has to
 * scroll. The FIRST (Dashboard) and LAST (plan) crumbs are never collapsed by this function —
 * it only ever answers for the crumb in between, and only when there IS a trailing crumb to
 * protect (no `planSlot` ⇒ the project crumb IS the last one, and must survive intact, same as
 * Dashboard).
 */

// A conservative stand-in for one rendered "/" separator's width — approximate on purpose. A few
// px either way costs nothing real: the fallback (a sideways scroll) is unconditionally still
// there regardless, and this constant only decides WHEN to reach for the compact affordance,
// never how anything is laid out.
export const CRUMB_SEP_W = 14;

export function crumbNeedsCompact({ availableWidth, dashboardWidth, projectWidth, planWidth, hasPlan }) {
  if (availableWidth == null || !hasPlan) return false;
  const total = (dashboardWidth || 0) + CRUMB_SEP_W * 2 + (projectWidth || 0) + (planWidth || 0);
  return total > availableWidth;
}
