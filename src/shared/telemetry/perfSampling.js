/* The tiny ALWAYS-LOADED half of the performance instrument (NEW-4).
 *
 * ⛔ WHY THIS FILE EXISTS AS ITS OWN MODULE, because it looks like gratuitous splitting and is not.
 *
 * `perfInstrument.js` is imported by `main.jsx`, which is on the critical path of EVERY route — so
 * a static edge from there charges the Notes route, the Library route and the Review route for a
 * Site-Planner-shaped diagnostic they will never use. It breached the Notes route's bundle budget
 * by 2.5 KB the first time it shipped that way, and the repo's rule for that (`/CLAUDE.md`, and the
 * doc-pointer note in `site-planner/CLAUDE.md`) is **split by tier, do not hope for tree-shaking**:
 * a module imported by both the boot path and a lazy chunk is hoisted whole into their common
 * ancestor, and shaking drops unused exports, never exports a sibling chunk uses.
 *
 * So the split is by TIER, not by size:
 *   • HERE (always loaded, a few hundred bytes): the enrolment decision and the edit counter — the
 *     two things that must exist before the instrument does. The counter has to be here because
 *     `SitePlanner.jsx` calls it from `pushHistory`, and that call must not drag a diagnostic into
 *     the site chunk.
 *   • `perfInstrument.js` (dynamic import, only for an ENROLLED tab): the observers, the periodic
 *     sample, the row builder and the sink.
 *
 * The happy consequence is that the file's own promise is now literally true rather than nearly
 * true: an unenrolled tab does not merely skip installing the instrument, it never downloads it.
 */

/** Enrol this fraction of page loads. A perf trend needs a sample, not a census. */
export const PERF_SAMPLE_RATE = 0.25;

/* Deterministic per page load from the tab id, NOT `Math.random()` at every decision point — so a
 * given tab is either in the sample for its whole life or out of it for its whole life. A tab that
 * flickered in and out would produce a series with holes in it, which is worse than no series: you
 * could not tell "nothing was slow" from "we were not looking". */
export function isEnrolled(tabId, rate = PERF_SAMPLE_RATE) {
  if (!(rate > 0)) return false;
  if (rate >= 1) return true;
  const s = String(tabId || "");
  if (!s) return false;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000 < rate;
}

/* THE ONE AXIS THE DOM CANNOT REPORT. Elements drawn, layers on and panels open are all readable
 * off the page; how much the session has been WORKED is not. `SitePlanner.jsx`'s `pushHistory` is
 * the single path every undoable action already funnels through, so one integer increment there is
 * the cheapest complete count there is — and it costs an unenrolled tab exactly that increment,
 * with nothing else loaded. */
let _edits = 0;
export function notePerfEdit() { _edits++; }
export function perfEditCount() { return _edits; }
export function __resetPerfEdits() { _edits = 0; }
