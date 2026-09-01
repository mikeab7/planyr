/* lastRoute — "open the app where I left off" (owner request, 2026-07-05).
 *
 * Every navigation writes a tiny {module, projectId, cross} pointer to localStorage; a boot
 * with an EMPTY hash seeds the URL from it before React renders, so a fresh tab lands on the
 * last module + project instead of the default dashboard. An explicit deep link — including
 * a literal "#/" — always wins (INITIAL_HASH_EMPTY is false for it, and it's captured before
 * this seed writes anything, so `resumeAllowed` semantics downstream are unchanged: the Site
 * Planner's own pickResumeTarget still chooses the specific plan within the seeded project).
 *
 * The pointer stores only ids — whether the project still exists is delegated to the modules
 * (a dead id resolves to the map/dashboard and the URL self-heals), so this file stays pure.
 *
 * ⛔ B710736 (2026-08-23) — a pointer is only restored when it names somewhere SPECIFIC: a
 * real project, or a deliberate cross-project view. See `isWorthRestoring` / `shouldPersistRoute`
 * below — a generic "no project selected" placeholder is never seeded, and Food (which has no
 * project model at all) never even overwrites the pointer. Root cause + full reasoning: BACKLOG.md.
 */
import { parseRoute, buildHash, DEFAULT_MODULE, INITIAL_HASH_EMPTY } from "./route.js";

const KEY = "planyr:lastRoute:v1";

/* Owner decision (2026-07-05): restore the last MODULE too, not just the project.
 * Flip to false to always boot into the Site Planner (project still restored). */
export const RESTORE_LAST_MODULE = true;

export function readLastRoute() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("bad shape");
    return {
      module: typeof v.module === "string" ? v.module : DEFAULT_MODULE,
      projectId: typeof v.projectId === "string" && v.projectId ? v.projectId : null,
      cross: !!v.cross,
      org: !!v.org,
    };
  } catch (_) {
    // Corrupt pointer: clear it so it can't wedge every boot, and boot clean (the visible
    // effect — landing on the default dashboard once — beats a half-working restore).
    try { localStorage.removeItem(KEY); } catch (_) { /* storage unavailable */ }
    return null;
  }
}

/* B710736 — modules with no project model at all, which must never drive "open where I
 * left off". Food is a private, personal side product, deliberately outside the Site
 * Planner's project model (see src/workspaces/food/CLAUDE.md — "no projects, no
 * cross-workspace navigation"). The owner sends planyr.io to brokers, lenders and his own
 * team; landing a bare-domain visit in a restaurant tracker instead of the professional
 * tool is a credibility problem, not a mere inconvenience. Food stays reachable by direct
 * URL (#/food still parses and mounts it) — it is only excluded from EVER being the
 * pointer "open where I left off" restores to, or even overwriting that pointer. */
const PROJECTLESS_MODULES = new Set(["food"]);

/* Whether a route change is worth persisting as "where I left off" at all. A visit to a
 * projectless module must not clobber the pointer to wherever the professional tool was
 * actually left — otherwise the very next bare-domain boot lands right back in it. */
export function shouldPersistRoute(route) {
  return !!route && !PROJECTLESS_MODULES.has(route.module);
}

export function writeLastRoute(route) {
  if (!route || !shouldPersistRoute(route)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      module: route.module || DEFAULT_MODULE,
      projectId: route.projectId || null,
      cross: !!route.cross,
      org: !!route.org,
    }));
  } catch (_) { /* quota/unavailable — resume is a convenience, never blocks navigation */ }
}

/* Whether a stored pointer names somewhere SPECIFIC enough to be worth seeding into a
 * fresh boot: a real project, or a deliberate cross-project view the user explicitly
 * toggled on (Notes' "All Notes" dashboard, a cross-project Library tree, …). A
 * non-default module sitting on no project and not in cross mode is a generic
 * placeholder — a project picker, an empty canvas, "nothing selected" — indistinguishable
 * from just landing on the default workspace, so restoring it is never restoring a place
 * the user was actually working; it only reproduces the food-tab bug in miniature
 * (B710736). Food is refused outright regardless of project/cross, matching
 * PROJECTLESS_MODULES above, in case a stale pointer written before this fix (or by a
 * future regression) still carries one. */
function isWorthRestoring(route) {
  if (PROJECTLESS_MODULES.has(route.module)) return false;
  if (route.module === DEFAULT_MODULE) return true; // already a no-op — buildHash gives "#/"
  // ORG SCOPE (NEW-1) — a deliberate destination the user toggled on, same standing as `cross`.
  return !!route.projectId || !!route.cross || !!route.org;
}

/* Pure boot decision: which route (if any) to seed into an empty-hash boot.
 * Returns null when the current URL must be honoured verbatim, when nothing is stored,
 * when the stored pointer names no specific place worth restoring (isWorthRestoring), or
 * when it resolves to the plain default dashboard (seeding "#/" would be a visible
 * no-op). The parse(build(x)) round-trip normalizes junk — an unknown module falls back
 * to the default, malformed ids stay strings — so a stale pointer can never produce an
 * invalid hash. */
export function pickBootRoute({ initialHashEmpty, stored, restoreLastModule = RESTORE_LAST_MODULE }) {
  if (!initialHashEmpty || !stored) return null;
  const wanted = restoreLastModule
    ? stored
    : { module: DEFAULT_MODULE, projectId: stored.projectId, cross: false };
  if (!isWorthRestoring(wanted)) return null;
  const route = parseRoute(buildHash(wanted));
  return buildHash(route) === "#/" ? null : route;
}

/* Called once from Shell module scope, before the first render, so useHashRoute's initial
 * read sees the seeded hash. location.replace = no junk history entry (Back skips it). */
export function seedBootRoute() {
  if (typeof window === "undefined" || !window.location) return false;
  const boot = pickBootRoute({ initialHashEmpty: INITIAL_HASH_EMPTY, stored: readLastRoute() });
  if (!boot) return false;
  try { window.location.replace(buildHash(boot)); return true; } catch (_) { return false; }
}
