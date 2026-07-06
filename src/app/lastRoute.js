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
    };
  } catch (_) {
    // Corrupt pointer: clear it so it can't wedge every boot, and boot clean (the visible
    // effect — landing on the default dashboard once — beats a half-working restore).
    try { localStorage.removeItem(KEY); } catch (_) { /* storage unavailable */ }
    return null;
  }
}

export function writeLastRoute(route) {
  if (!route) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({
      module: route.module || DEFAULT_MODULE,
      projectId: route.projectId || null,
      cross: !!route.cross,
    }));
  } catch (_) { /* quota/unavailable — resume is a convenience, never blocks navigation */ }
}

/* Pure boot decision: which route (if any) to seed into an empty-hash boot.
 * Returns null when the current URL must be honoured verbatim, when nothing is stored,
 * or when the stored pointer resolves to the plain default dashboard (seeding "#/" would
 * be a visible no-op). The parse(build(x)) round-trip normalizes junk — an unknown module
 * falls back to the default, malformed ids stay strings — so a stale pointer can never
 * produce an invalid hash. */
export function pickBootRoute({ initialHashEmpty, stored, restoreLastModule = RESTORE_LAST_MODULE }) {
  if (!initialHashEmpty || !stored) return null;
  const wanted = restoreLastModule
    ? stored
    : { module: DEFAULT_MODULE, projectId: stored.projectId, cross: false };
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
