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
 * Route shape: { module, projectId, cross, org }
 *   module    — workspace id ('site-planner' | 'scheduler' | 'doc-review' | 'library')
 *   projectId — active project (a Site Planner site-group id) | null
 *   cross     — cross-project mode (the tree spans all of the user's projects)
 *   org       — ORG SCOPE (NEW-1): standing in the Organization, not any project. Mutually
 *               exclusive with `projectId`/`cross` by construction — a route never sets more
 *               than one of the three, and `buildHash` gives each its own grammar segment
 *               rather than a flag riding inside another's shape (a real, distinct scope in
 *               routing, never a sentinel `projectId`).
 *
 * Hash grammar:
 *   #/                       -> the Dashboard (see isDashboardRoute below — NOT a module)
 *   #/dashboard              -> same, explicit alias
 *   #/<slug>                 -> module, no project (e.g. #/markup = pick-a-project)
 *   #/all/<slug>             -> cross-project mode for that module
 *   #/project/<id>/<slug>    -> project + module
 *   #/org/<slug>             -> ORG SCOPE for that module (Notes, Library)
 * The URL uses friendly module slugs (site/schedule/markup), matching the header tabs.
 *
 * NEW-1 (B1213312) — bare "#/" used to be a plain alias for "site-planner, no project", which
 * is why the wordmark, the Dashboard breadcrumb crumb, and a bare planyr.io all used to land on
 * the Site Planner's map. `isDashboardRoute` (below) reads the raw hash directly, the same way
 * `isAdminRoute`/`isDesignRoute` do, so the Dashboard is a real destination outside the
 * `{module, projectId, cross, org}` shape rather than a value that shape can express. Because of
 * that, `buildHash` no longer special-cases the default module — EVERY project-less module now
 * gets its own named slug (`#/site`, not `#/`), so "site-planner with no project" (reached via
 * New Project, or by leaving a project) stays a real, distinct place from the Dashboard.
 */
import { useCallback, useEffect, useState } from "react";

export const DEFAULT_MODULE = "site-planner";
// B1166768 — the "model" tab was renamed "Spreadsheet" in user-facing copy (Michael doesn't want
// Planyr's naming to echo his employer's internal vocabulary, and "pro forma" was rejected for
// the same reason — it's developer/finance shorthand, and this container is meant for a GC's bid
// tab or an engineer's drainage calcs just as much). The workspace's internal id, files and
// storage keys all stay "model" (renaming those is pure churn — see src/workspaces/model/); only
// the SLUG a new link is built with changes, to "spreadsheet". "model" stays in MODULE_BY_SLUG as
// a permanent PARSE-ONLY alias so an existing bookmark/deep link naming "#/model" (or
// "#/project/<id>/model") keeps resolving — SLUG_BY_MODULE is the one-way "what a NEW link looks
// like" map, so it never grows the reverse alias.
export const MODULE_BY_SLUG = { site: "site-planner", schedule: "scheduler", markup: "doc-review", library: "library", notes: "notes", model: "model", spreadsheet: "model", food: "food" };
export const SLUG_BY_MODULE = { "site-planner": "site", scheduler: "schedule", "doc-review": "markup", library: "library", notes: "notes", model: "spreadsheet", food: "food" };

const slugFor = (module) => SLUG_BY_MODULE[module] || SLUG_BY_MODULE[DEFAULT_MODULE];

/* Pure: a location.hash string -> { module, projectId, cross, org }. Tolerant of junk
 * (unknown slug -> default module) so a hand-typed / stale URL never throws. */
export function parseRoute(hash) {
  const raw = String(hash || "").replace(/^#/, "");
  const segs = raw.split("/").filter(Boolean); // "/project/abc/markup" -> ["project","abc","markup"]
  if (segs.length === 0) return { module: DEFAULT_MODULE, projectId: null, cross: false, org: false };
  if (segs[0] === "project" && segs.length >= 2) {
    let id = segs[1];
    try { id = decodeURIComponent(id); } catch (_) { /* keep raw on malformed escape */ }
    return { module: MODULE_BY_SLUG[segs[2]] || DEFAULT_MODULE, projectId: id || null, cross: false, org: false };
  }
  if (segs[0] === "all") {
    return { module: MODULE_BY_SLUG[segs[1]] || DEFAULT_MODULE, projectId: null, cross: true, org: false };
  }
  if (segs[0] === "org") {
    return { module: MODULE_BY_SLUG[segs[1]] || DEFAULT_MODULE, projectId: null, cross: false, org: true };
  }
  return { module: MODULE_BY_SLUG[segs[0]] || DEFAULT_MODULE, projectId: null, cross: false, org: false };
}

/* THE ROUTE THAT RESOLVED TO NOTHING — the definitive stale-build signal (B1373).
 *
 * `parseRoute` is deliberately tolerant: an unknown slug falls back to the default module so
 * a hand-typed or stale URL never throws. That tolerance has a cost, and on 2026-07-31 the
 * owner paid it — `#/notes` opened on a machine running a build from before Notes existed,
 * whose MODULE_BY_SLUG has no `notes` key, so the route silently resolved to the Site
 * workspace with no tab, no message and no clue.
 *
 * This reports that case WITHOUT changing the route shape (which several call sites compare
 * by value). A slug that this build cannot resolve is either a typo or — far more likely for
 * a link the user actually followed — a part of Planyr newer than the code answering it. The
 * shell offers a reload; it does not force one, and a typo costs at worst one dismissible
 * line. Returns the offending slug, or null when the hash resolves cleanly.
 */
export function unknownModuleSlug(hash) {
  const segs = String(hash || "").replace(/^#/, "").split("/").filter(Boolean);
  if (segs.length === 0) return null;
  const slug = segs[0] === "project" ? segs[2] : segs[0] === "all" || segs[0] === "org" ? segs[1] : segs[0];
  // "#/project/<id>" with no module segment is a legitimate shorthand, not a miss.
  if (!slug) return null;
  // "admin" is a real, resolvable destination (see isAdminRoute) that just isn't one of
  // the tabbed workspaces — it must never trip the "newer build" banner, which would be
  // the one signal telling a random visitor that typing this slug does something.
  if (slug === ADMIN_SLUG) return null;
  // Same reasoning for "design" (see isDesignRoute, NEW-4) — a real, resolvable destination
  // that isn't a tabbed workspace either.
  if (slug === DESIGN_SLUG) return null;
  // Same reasoning for "dashboard" (see isDashboardRoute, NEW-1/B1213312) — a real,
  // resolvable destination that isn't a tabbed workspace either.
  if (slug === DASHBOARD_SLUG) return null;
  return MODULE_BY_SLUG[slug] ? null : slug;
}

/* B711904 (NEW-1) — the internal admin page. Deliberately NOT a workspace: it carries no
 * header tab, no entry in MODULE_BY_SLUG, and is never offered by the module switcher —
 * Shell.jsx checks this directly off the raw hash instead. Keeping it out of the normal
 * module-slug table is what makes an unauthorized visit indistinguishable from any other
 * unrecognized route (parseRoute falls back to DEFAULT_MODULE exactly as it would for a
 * typo), rather than needing its own "access denied" branch anywhere in the route grammar. */
const ADMIN_SLUG = "admin";
export function isAdminRoute(hash) {
  const segs = String(hash || "").replace(/^#/, "").split("/").filter(Boolean);
  return segs[0] === ADMIN_SLUG;
}

/* NEW-4 (docs/DESIGN.md) — the `/design` primitive gallery. Same shape as `isAdminRoute` above and
 * for the same reason: a dev-facing destination that carries no header tab and is never offered by
 * the module switcher, so it costs nothing on the shipped bundle until someone types the URL. */
const DESIGN_SLUG = "design";
export function isDesignRoute(hash) {
  const segs = String(hash || "").replace(/^#/, "").split("/").filter(Boolean);
  return segs[0] === DESIGN_SLUG;
}

/* NEW-1 (B1213312) — the Dashboard: a real destination that sits above the six modules, never
 * one of them. Bare "#/" (no segments at all) IS the Dashboard's canonical, shareable link — the
 * explicit "#/dashboard" slug is a defensive alias so a hand-typed/bookmarked URL naming it
 * resolves too. Deliberately not a `route.module` value, same shape as isAdminRoute/isDesignRoute
 * above: Shell reads this directly off the raw hash rather than through parseRoute. */
const DASHBOARD_SLUG = "dashboard";
export function isDashboardRoute(hash) {
  const segs = String(hash || "").replace(/^#/, "").split("/").filter(Boolean);
  return segs.length === 0 || segs[0] === DASHBOARD_SLUG;
}

/* Pure: { module, projectId, cross, org } -> a "#/..." hash string.
 * NEW-1 (B1213312) — every project-less module gets its own named slug now, the default module
 * included ("#/site", never a bare "#/"), because bare "#/" is reserved for the Dashboard
 * (isDashboardRoute above). This is what lets goDashboard() and the Dashboard route target a
 * place that "site-planner, no project" can never collide with. */
export function buildHash({ module = DEFAULT_MODULE, projectId = null, cross = false, org = false } = {}) {
  const slug = slugFor(module);
  if (cross) return `#/all/${slug}`;
  if (org) return `#/org/${slug}`;
  if (projectId) return `#/project/${encodeURIComponent(projectId)}/${slug}`;
  return `#/${slug}`;
}

export function sameRoute(a, b) {
  return !!a && !!b && a.module === b.module && (a.projectId || null) === (b.projectId || null)
    && !!a.cross === !!b.cross && !!a.org === !!b.org;
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
    const nextHash = buildHash(next);
    // NEW-1 (B1213312) — compare the actual HASH STRING navigate() is about to write, not the
    // parsed route shape. `sameRoute(cur, next)` used to gate this, and it made every non-module
    // route that shares a parsed fallback with "{module: DEFAULT_MODULE, projectId: null}" —
    // the Dashboard, `#/admin`, `#/design` — a silent no-op to leave: parseRoute resolves all of
    // them to the identical object, so navigating from one to "the same-looking" one wrote
    // nothing and no hashchange ever fired (Shell.jsx's DesignGallery onExit needed a direct
    // `window.location.hash =` workaround for exactly this). Comparing the real hash string this
    // call would produce against the one already in the URL fixes the whole class at the root:
    // a call that would genuinely leave nothing changed is still a no-op (no added history
    // entry), and a call that changes the URL — even to a hash that parses "the same" — writes.
    if (typeof window !== "undefined" && window.location.hash === nextHash) return;
    window.location.hash = nextHash;
  }, []);
  return [route, navigate];
}
