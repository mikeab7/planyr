/* crumbScope.js — NEW-1/NEW-2 (header breadcrumb): the two pure rules behind the trailing crumb.
 * A dependency-free leaf on purpose: AppHeader (the entry chunk) reads it on every route.
 *
 * (1) WHICH TABS MAY SHOW A TRAILING CRUMB — decided here, once, from the active module.
 *     Owner decision 2026-10-29: only the Site tab is plan-scoped, so only Site shows the plan
 *     crumb ("Dashboard / <Project> ▾ / <Plan> ▾"). Spreadsheet, Review, Library and Notes are
 *     project-level and read "Dashboard / <Project> ▾" with no trailing "/". Schedule keeps its
 *     own trailing crumb because that one names a SCHEDULE of the project (the multi-schedule
 *     switcher, B1435888), not a plan. HIDE, DON'T FORGET: this only decides whether the slot is
 *     drawn — the open plan lives in the planner / the site store and is untouched, so Spreadsheet →
 *     Site lands on the same plan.
 *
 * (2) THE FLOOR OF A SHRINKABLE CRUMB — a crumb used to carry a flat `min-width` (92). A name
 *     narrower than the floor was padded out to it, so a short name sat in dead space and its "/"
 *     looked farther away than a normal name's. The floor now follows the name: it is a lower
 *     bound on how far the crumb can be SQUEEZED, never a width a short name is padded to. The
 *     text term is deliberately an UNDER-estimate (0.4ch per character is narrower than any glyph
 *     of the chrome font), so the crumb's natural width always wins over it and a short name hugs
 *     its text; a long name is capped at `cap` (CRUMB_MIN_W) exactly as before.
 */

export const MODULES_WITH_TRAILING_CRUMB = Object.freeze(["site-planner", "scheduler"]);

export function trailingCrumbAllowed(module) {
  return MODULES_WITH_TRAILING_CRUMB.includes(module);
}

/** The slot to hand the breadcrumb: the caller's own crumb on a module that owns one, else null. */
export function trailingCrumbFor(module, slot) {
  return slot && trailingCrumbAllowed(module) ? slot : null;
}

// Horizontal chrome around a crumb's text: 12 + 12 padding, the 5 inner gap, and the ▾ caret.
const CRUMB_CHROME_PX = 36;

/** A CSS `min-width` for a shrinkable crumb: never more than `cap`, never more than the name needs. */
export function crumbFloor(label, cap) {
  const n = Array.from(String(label ?? "")).length;
  return `min(${cap}px, calc(${(n * 0.4).toFixed(1)}ch + ${CRUMB_CHROME_PX}px))`;
}
