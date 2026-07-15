/* Scheduler nav-state — pure helpers for the embedded-app bridge (B380).
 *
 * The Sequence workspace embeds the standalone Gantt app in an iframe; that app
 * posts its navigation state (its own projects + active project + section) up to
 * the shell over postMessage ("planar:nav-state", see public/sequence/index.html).
 * The shell renders those projects in the Row-1 breadcrumb.
 *
 * These functions are intentionally dependency-free (no React, no DOM) so the
 * parse + derive logic is unit-tested in the Node runner and — the point of B380 —
 * so the SINGLE place that turns an inbound message into the data the header
 * dereferences is hardened ONCE, at the source, instead of relying on every
 * downstream consumer to null-check. The header reads `currentProject.id`,
 * `p.id`, `p.name`; if a not-yet-ready / malformed message ever reached those
 * reads with an `undefined` entry it would throw "Cannot read properties of
 * undefined" inside the workspace and trip the ErrorBoundary. `sanitizeProjects`
 * guarantees the list is always an array of plain objects, and
 * `deriveCurrentProject` always returns a project-or-null (never `undefined`,
 * never a throw) — so the first-render-before-data window renders the empty/
 * loader state cleanly rather than dereferencing undefined.
 *
 * Behaviour for the real embedded app's well-formed `{id, name}` payload is
 * IDENTICAL to the previous inline logic — this only adds robustness for the
 * not-ready / malformed shapes.
 */

// Coerce whatever arrived as `projects` into an array of plain `{id, name}` objects.
// Drops null / undefined / primitive entries (the only values that would throw on a
// later `p.id` / `p.name` read); keeps every real object entry, with a null id rather
// than dropping it, so the displayed list matches what the embedded app sent.
export function sanitizeProjects(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((p) => p && typeof p === "object")
    // linkedSiteId/Name (cross-module link) ride along ONLY when the schedule is actually linked,
    // so the shell can map a schedule project ↔ a Site Planner project (group_id). An unlinked
    // schedule keeps the exact prior {id,name} shape — no null-field noise, existing tests green.
    .map((p) => {
      const out = { id: p.id ?? null, name: p.name };
      if (p.linkedSiteId != null) { out.linkedSiteId = p.linkedSiteId; out.linkedSiteName = p.linkedSiteName ?? null; }
      return out;
    });
}

// Parse an inbound window message into the shell's nav state, or null when it isn't
// the embedded scheduler's nav-state message (wrong source/type, or junk). Pure: the
// caller still does the origin check (a security boundary that needs the live event).
export function parseNavState(message) {
  if (!message || message.source !== "planar-seq" || message.type !== "planar:nav-state") return null;
  return {
    section: message.section || "projects",
    activeId: message.activeId ?? null,
    projects: sanitizeProjects(message.projects),
  };
}

// The active project record for the breadcrumb, or null. Never throws and never
// returns `undefined`: on the Dashboard (reports) view no project is current, and a
// stale/absent activeId (e.g. it points at a project not yet in the list) resolves to
// null so the crumb reads "choose a project" instead of dereferencing a missing record.
export function deriveCurrentProject(projects, activeId, section) {
  if (section === "reports") return null;
  if (!Array.isArray(projects)) return null;
  return projects.find((p) => p && p.id === activeId) || null;
}

// The schedule project linked to a given Site Planner project (group_id), or null. Drives the
// project-aware header tabs: when the route carries #/project/<gid>/schedule, this finds which
// schedule to activate. Pure + null-safe; returns the single match (a group_id maps to at most
// one schedule), or null when nothing is linked yet → the shell shows the "create / link" panel.
export function findBySiteId(projects, siteId) {
  if (siteId == null || !Array.isArray(projects)) return null;
  return projects.find((p) => p && p.linkedSiteId != null && p.linkedSiteId === siteId) || null;
}

// True while a routed site's linked schedule is NOT yet the iframe's ACTIVE one — i.e. the shell
// must (re)post planar:nav-select-by-site so the grid follows the route. Stays true when the link
// isn't resolvable yet (the embed's projects haven't loaded), so the carry-in keeps driving until
// the iframe actually has the data to switch; goes false only once the active schedule equals the
// link. This is what makes the carry-in self-heal the boot race where the FIRST select is dropped
// before the embed's cloud data loads (the B644 null-data guard) and — pre-fix — was never retried,
// stranding the grid on the previously-active schedule while the crumb correctly named the routed
// one (the route↔grid divergence this fixes). Pure + null-safe; no siteId → nothing to carry.
export function needsScheduleCarryIn(projects, siteId, activeId) {
  if (siteId == null) return false;
  const linked = findBySiteId(projects, siteId);
  if (linked && linked.id === activeId) return false;
  return true;
}
