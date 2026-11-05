/* NEW-1 (Silvestri zoom freeze) — a keep-alive surface that is HIDDEN must not re-render because its parent did.
 *
 * `SitePlannerApp` keeps the map finder mounted behind the planner (display:none) so its Leaflet map survives.
 * It is also given app-wide state that churns during a zoom (`layerStatus` — every GIS layer reports
 * loading/ok around each request — plus fresh `sites` / callback identities each App render). Without a gate, every
 * one of those re-rendered the hidden map's whole saved-plan list (acreage + boundary per plan, name lookups),
 * on the main thread, in the middle of the planner's zoom. Measured on a store of ~90 saved plans: ~6.4 s of the
 * 8-step profile at 4× CPU throttle.
 *
 * The rule (a React.memo comparator — return true to SKIP the render): skip only when the surface was hidden
 * before AND is hidden now, and its `isActive` flag is unchanged. The moment `visible` flips, or it is visible, it
 * renders exactly as before with the latest props — so nothing is ever shown stale; the cost of the skip is only
 * that props which changed while hidden are applied at the moment it is shown again.
 * Pure, so it unit-tests without React.
 */
export function skipWhileHidden(prev, next) {
  return !prev.visible && !next.visible && prev.isActive === next.isActive;
}
