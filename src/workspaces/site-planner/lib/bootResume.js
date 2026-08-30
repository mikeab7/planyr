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

/* ⛔ NEW-5 — THE URL IS AUTHORITATIVE. Never write `null` over a route that names a project
 * unless the user actually left it.
 *
 * `mayReconcileUrl` (above) was the V13 fix and it is not enough, because it gates on an EVENT
 * having fired rather than on the DATA being known. Two live boot sequences defeat it, and the
 * owner hit them on production:
 *
 *   1. supabase-js emits `INITIAL_SESSION` with a NULL user while it is still restoring a
 *      stored session. `applyUser(null, "INITIAL_SESSION")` runs to completion and releases the
 *      gate — so `bootResolved` is true, the cloud sites are still absent, `effGroup` is null,
 *      and the URL sync writes that null straight over `#/project/<id>/site`. The deep link is
 *      gone before the real `SIGNED_IN` arrives, and the resume it would have driven now reads
 *      a route with no project in it.
 *   2. Worse: if the sequence is `INITIAL_SESSION(null)` → `TOKEN_REFRESHED(user)`, the handler
 *      deliberately ignores `TOKEN_REFRESHED`, so `applyUser` never runs with a user at all —
 *      and the route has already been stripped.
 *
 * Chasing the auth timing would close one sequence at a time. This closes the class, by making
 * the WRITER honest instead: the route is the source of truth for WHICH project is open, so the
 * app may only clear it when clearing is a fact rather than an absence of information.
 *
 *   routeProjectId — the project the URL currently names (or null)
 *   nextGroup      — the project the app would write (null = "no project open")
 *   userLeft       — true when the user deliberately navigated away (Dashboard / Map / a real
 *                    project switch). This is an INTENT flag the caller sets on user action —
 *                    never inferred from state, because "no project loaded" and "user closed
 *                    the project" look identical from the outside, and that is the whole bug.
 *
 * Returns true when the write may proceed. Pure. */
export function mayWriteRouteProject({ routeProjectId, nextGroup, userLeft = false }) {
  if (nextGroup) return true;              // opening/keeping a real project is always honest
  if (!routeProjectId) return true;        // the route already says "no project" — nothing to lose
  return !!userLeft;                       // clearing a named project needs a deliberate act
}

/* ⛔ B881664 — "resume the last-open plan" is a ONE-SHOT boot privilege, not a standing session
 * flag. `initialHashEmpty` (route.js's INITIAL_HASH_EMPTY) is captured once, at module load, and
 * stays true for the rest of the tab's life — so it answers "did THIS TAB'S BOOT carry no
 * explicit route", never "is this mount happening AS PART OF that boot". The Site Planner does
 * not necessarily mount on the app's first render at all (a boot that resolves to Schedule or
 * Library mounts THOSE first); it can mount much later, the first time the user navigates into
 * it — including via the Dashboard breadcrumb, which explicitly clears the routed project. That
 * mount also sees `projectId == null` and, with the old `resumeAllowed = initialHashEmpty` alone,
 * read it as "an empty boot, safe to resume the last site" — silently reviving a stale
 * `currentSite` pointer left over from an EARLIER visit and writing it straight back into the
 * route the user just explicitly left (repro: a tab that boots on a bare domain, gets "open
 * where I left off" resumed onto a project's Schedule tab, then clicks Dashboard — the hash
 * lands on "#/" for a moment and then bounces to "#/project/<id>/site").
 *
 * The fix: a mount may only use the boot-resume fallback when its OWN projectId prop still
 * matches what the app's boot route actually resolved to (`initialProjectId`, captured once,
 * immediately after "open where I left off" seeding and before any user action). A later,
 * deliberate navigation to a project-less route changes what this mount sees `projectId` as,
 * so the mismatch alone proves it is not the boot render — no clock, no consumed-once flag,
 * just a value comparison. Pure. */
export function mayResumeLastSite({ initialHashEmpty, projectId, initialProjectId }) {
  if (!initialHashEmpty) return false;
  return (projectId || null) === (initialProjectId || null);
}

/* NEW-5 — did the route ask for a project this device cannot currently open?
 *
 * `openProjectGroup` used to `return` silently when a group had no plans locally, so a hash
 * edited to a project that hadn't been pulled yet left the PREVIOUS project on screen while the
 * URL claimed the new one — the owner's repro B ("the header kept rendering Goose Creek while
 * the hash said smsdsqdkl9i0"). Silence is the wrong answer twice over: it is wrong while the
 * project is still loading (it will exist in a moment) and it is wrong when the id is bad (the
 * user should be told, not shown someone else's plan).
 *
 * Returns one of:
 *   "open"    — plans exist; open it
 *   "waiting" — nothing local yet AND the boot hasn't settled; hold, the pull may still land it
 *   "missing" — nothing local and the boot HAS settled; this project genuinely isn't here
 * Pure. */
export function routeProjectAvailability({ plansOfGroup, groupId, bootResolved }) {
  if (!groupId) return "open";
  const plans = plansOfGroup(groupId) || [];
  if (plans.length) return "open";
  return bootResolved ? "missing" : "waiting";
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
