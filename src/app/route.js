/* App route — the active project + workspace live in the URL hash (Work Item A).
 *
 * WHY THE HASH (and not a real path): the production build ships with Vite
 * `base: "./"` (relative asset URLs) and Cloudflare Pages has no SPA catch-all
 * (`_redirects`) — so a real path like `/project/abc/markup` would 404 on refresh
 * and load its assets from the wrong folder. A hash route (`#/project/abc/markup`)
 * is client-only: the server always serves `/index.html`, the hash never reaches it,
 * deep links + refresh "just work", and the stale-chunk cache-busting reload
 * (chunkReload.reloadFresh) already preserves the hash. Same shareable, refresh-
 * stable, survives-a-module-switch behaviour the path scheme wanted, with zero
 * deploy risk. The segment SHAPE matches the spec (`/project/:id/:module`) after the
 * `#`, so swapping to real paths later (if base flips to "/") is a localized change.
 *
 * Route shape: { module, projectId, cross }
 *   module    — workspace id ('site-planner' | 'scheduler' | 'doc-review' | 'library')
 *   projectId — active project (a Site Planner site-group id) | null
 *   cross     — cross-project mode (the tree spans all of the user's projects)
 *
 * Hash grammar:
 *   #/                       -> dashboard (default module, no project)
 *   #/<slug>                 -> module, no project (e.g. #/markup = pick-a-project)
 *   #/all/<slug>             -> cross-project mode for that module
 *   #/project/<id>/<slug>    -> project + module
 * The URL uses friendly module slugs (site/schedule/markup), matching the header tabs.
 */
import { useCallback, useEffect, useState } from "react";

export const DEFAULT_MODULE = "site-planner";
export const MODULE_BY_SLUG = { site: "site-planner", schedule: "scheduler", markup: "doc-review", library: "library" };
export const SLUG_BY_MODULE = { "site-planner": "site", scheduler: "schedule", "doc-review": "markup", library: "library" };

const slugFor = (module) => SLUG_BY_MODULE[module] || SLUG_BY_MODULE[DEFAULT_MODULE];

/* Pure: a location.hash string -> { module, projectId, cross }. Tolerant of junk
 * (unknown slug -> default module) so a hand-typed / stale URL never throws. */
export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const segs = raw.split("/").filter(Boolean); // "/project/abc/markup" -> ["project","abc","markup"]
  if (segs.length === 0) return { module: DEFAULT_MODULE, projectId: null, cross: false };
  if (segs[0] === "project" && segs.length >= 2) {
    let id = segs[1];
    try { id = decodeURIComponent(id); } catch (_) { /* keep raw on malformed escape */ }
    return { module: MODULE_BY_SLUG[segs[2]] || DEFAULT_MODULE, projectId: id || null, cross: false };
  }
  if (segs[0] === "all") {
    return { module: MODULE_BY_SLUG[segs[1]] || DEFAULT_MODULE, projectId: null, cross: true };
  }
  return { module: MODULE_BY_SLUG[segs[0]] || DEFAULT_MODULE, projectId: null, cross: false };
}

/* Pure: { module, projectId, cross } -> a "#/..." hash string. */
export function buildHash({ module = DEFAULT_MODULE, projectId = null, cross = false } = {}) {
  const slug = slugFor(module);
  if (cross) return `#/all/${slug}`;
  if (projectId) return `#/project/${encodeURIComponent(projectId)}/${slug}`;
  // No project = dashboard. Default module gets the clean "#/" home; others name the slug.
  return module === DEFAULT_MODULE ? "#/" : `#/${slug}`;
}

export function sameRoute(a, b) {
  return !!a && !!b && a.module === b.module && (a.projectId || null) === (b.projectId || null) && !!a.cross === !!b.cross;
}

export function readRoute() {
  return parseRoute(typeof window !== "undefined" && window.location ? window.location.hash : "");
}

/* Whether the page was opened WITHOUT an explicit route (empty hash). Captured once at
 * module load, before any navigate() writes the hash, so a first-time visit can still
 * resume the last-opened project from localStorage (today's behaviour) while an explicit
 * deep link — including "#/" for the dashboard — is honoured verbatim. */
export const INITIAL_HASH_EMPTY =
  typeof window !== "undefined" && window.location ? (window.location.hash === "" || window.location.hash === "#") : true;

/* React hook: subscribe to hashchange, expose [route, navigate]. navigate(partial)
 * MERGES with the live route read fresh from the URL (never a stale closure), so
 * `navigate({ module })` preserves the current project for free and vice-versa. The
 * hashchange event (fired by the assignment) is the single source of truth that pushes
 * the new route into state. */
export function useHashRoute() {
  const [route, setRoute] = useState(readRoute);
  useEffect(() => {
    const onHash = () => setRoute(readRoute());
    window.addEventListener("hashchange", onHash);
    onHash(); // reconcile in case the hash changed between first render and listen
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const navigate = useCallback((partial) => {
    const cur = readRoute();
    const next = { ...cur, ...partial };
    if (sameRoute(cur, next)) return; // no-op: don't spam history with identical hashes
    window.location.hash = buildHash(next);
  }, []);
  return [route, navigate];
}
