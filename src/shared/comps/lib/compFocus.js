/* compFocus — the ONE decision for "a request arrived to focus comp X" (NEW-1, 2026-11-15).
 *
 * THE BUG IT CLOSES: the Dashboard Comps card's click lands on the Site Planner's map with the
 * Records tab open, but the featured comp was never focused. CompsPanel's focus effect looked the
 * id up in its OWN loaded list, and on a cold arrival from another workspace that list is still
 * empty (the fetch is in flight) — so the lookup found nothing and the request was cleared as
 * "handled" anyway. Clicking a map pin never hit this because a pin only exists once the list is
 * loaded. A request must therefore WAIT for the list, and only be dropped once the list is known.
 *
 *   idle    — nothing was asked for
 *   wait    — the comp isn't in the list yet and the list hasn't finished loading: keep the request
 *   open    — the comp is in the list: open its record (and the caller then clears the request)
 *   missing — the list finished loading (or failed) and the comp isn't in it: say so, clear it
 */
export function resolveCompFocus({ focusCompId, comps, loaded }) {
  if (!focusCompId) return { action: "idle", comp: null };
  const comp = (comps || []).find((c) => c && c.id === focusCompId) || null;
  if (comp) return { action: "open", comp };
  if (!loaded) return { action: "wait", comp: null };
  return { action: "missing", comp: null };
}

/** The plain sentence for a focus request that found no comp (deleted, or not shared with this viewer). */
export const COMP_FOCUS_MISSING_NOTICE =
  "That comp isn't in your list any more — it may have been deleted or isn't shared with you.";
