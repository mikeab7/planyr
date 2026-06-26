/* Boot resume — pure decisions for "which plan do we resume into, and when is the
 * boot safe to reconcile the URL?" (V13 / V28 fix).
 *
 * THE BUG these guard against: on a signed-in deep link / refresh into a project
 * (`#/project/<id>/site`), the user's cloud sites are NOT in the local store at the
 * first synchronous render — auth + `pullCloud` are async. So `activeSiteId` is
 * momentarily null even though the route names a project. Two boot-time reactions
 * then destroyed the resume:
 *   1. the active-project → URL sync wrote `null` over the route, stripping the deep
 *      link to "#/" and bouncing to the finder; and
 *   2. the "tidy a dangling currentSite pointer" cleanup nulled the pointer because
 *      the cloud site only *looked* absent (it wasn't loaded yet).
 * Both must wait until the first auth + cloud pull settles ("boot resolved"). With no
 * Supabase configured (or logged out, where the local store is synchronous) there is
 * no async gap, so boot is resolved from the very first render.
 *
 * These helpers are pure so the decision is locked by unit tests even though the
 * timing itself lives in React effects (the sandbox can't drive the signed-in path).
 */

/* Initial value for the `bootResolved` gate. When Supabase isn't configured there is no
 * async auth/pull to wait on, so the boot is already settled and the URL/cleanup
 * reconciliation may run immediately (preserving today's behaviour). When it IS
 * configured, start false and flip true once the first auth event + pull completes. */
export function initialBootResolved(supabaseConfigured) {
  return !supabaseConfigured;
}

/* Whether the active-project → URL sync (and the dangling-pointer cleanup) may run.
 * A thin, named wrapper so the intent reads clearly at the call site and is testable. */
export function mayReconcileUrl(bootResolved) {
  return !!bootResolved;
}

/* Which saved plan to resume into. Single source of truth shared by the first-render
 * boot target AND the post-cloud-pull resume, so the two can never drift.
 *   routeProjectId — the URL's project (a Site-group id) or null/empty
 *   currentId      — the last-open plan id (the currentSite pointer) or null
 *   plansOfGroup   — (groupId) => plans[] for that group, newest first
 *   hasSite        — (id) => boolean, whether a saved record for id exists
 * Returns the plan id to open, or null when there's nothing to resume.
 *
 * When the route names a project, resume the open plan if it's one of that project's
 * (else its newest). With no route project, resume the last-open plan only if it still
 * exists. Mirrors the pre-extraction logic in bootActiveId() + applyUser() exactly. */
export function pickResumeTarget({ routeProjectId, currentId, plansOfGroup, hasSite }) {
  if (routeProjectId) {
    const plans = plansOfGroup(routeProjectId) || [];
    const t = plans.find((p) => p.id === currentId) || plans[0];
    return t ? t.id : null;
  }
  return currentId && hasSite(currentId) ? currentId : null;
}
