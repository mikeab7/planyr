/* plannerKeepAlive — WHICH planners stay mounted across a plan switch (B2233521).
 *
 * A plan switch used to tear the whole planner down and build the next one from nothing — the old plan's DOM, its Leaflet map and every tile
 * thrown away, the new plan's map, header, panels, every mount effect and every first-render derivation built in the same click. Three
 * rounds (B2224000 / B2225424 / B2225425) took the work INSIDE that rebuild from ~900 ms to ~60 ms on the owner's machine; what is left is
 * the rebuild itself. So the plan you just left is KEPT: mounted, inactive (`active=false`, the same state the app already keeps a planner in
 * while the map view is on screen), its DOM detached from the page (components/PlannerSlot.jsx), and switching back to it is a show, not a
 * build. At most `PLANNER_KEEP` planners are alive — the one on screen and the one you came from — so the memory cost is bounded at one plan.
 *
 * Pure: the slot list is a most-recent-first array of `${siteId}:${epoch}` keys (the same key the planner was always mounted under), and the
 * answer is IDENTITY-STABLE — `nextPlannerSlots` returns its input when nothing changed, because the caller derives it during render.
 *
 * A kept planner is dropped (and so unmounts exactly as every planner used to) when:
 *   · a cloud pull bumps the epoch — it holds the PREVIOUS store's snapshot, which is the very thing the epoch remount exists to replace;
 *   · its plan is no longer in the account's plan list (deleted / dropped) — a hidden instance must never outlive, or re-save, its plan;
 *   · it falls off the end of the list.
 * The plan on screen is never dropped by the list check: a plan created this instant is not in the list until the next refresh.
 */
export const PLANNER_KEEP = 2;

export const slotKey = (siteId, epoch) => `${siteId}:${epoch}`;
export const slotSiteId = (key) => { const s = String(key); const i = s.lastIndexOf(":"); return i < 0 ? s : s.slice(0, i); };
const slotEpoch = (key) => { const s = String(key); const i = s.lastIndexOf(":"); return i < 0 ? null : s.slice(i + 1); };

/**
 * @param {string[]} prev           the current slot list (most recent first)
 * @param {object}   o
 * @param {string|null} o.current   the slot key on screen (`slotKey(activeSiteId, loadEpoch)`), or null when no plan is open
 * @param {Set<string>|null} o.live the ids of the account's plans; null = not known yet (drop nothing on that ground)
 * @param {number} [o.keep]         how many planners may be alive, the current one included
 * @returns {string[]} the next list — `prev` itself when nothing changed
 */
export function nextPlannerSlots(prev, { current, live = null, keep = PLANNER_KEEP } = {}) {
  const before = Array.isArray(prev) ? prev : [];
  if (!current) return before.length ? [] : before;
  const epoch = slotEpoch(current);
  const next = [current];
  for (const k of before) {
    if (next.length >= Math.max(1, keep)) break;
    if (k === current || slotEpoch(k) !== epoch) continue;
    if (live && !live.has(slotSiteId(k))) continue;
    next.push(k);
  }
  return next.length === before.length && next.every((k, i) => k === before[i]) ? before : next;
}
