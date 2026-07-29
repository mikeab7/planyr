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

/* ---- B1050 / NEW-1 / NEW-2: leaving the Schedule tab's empty state ------------------------
 *
 * The original trap (B1050): pressing Dashboard used to ONLY post planar:nav-dashboard into the
 * iframe. The embedded app obeyed (its nav-state came back with section "reports", so the
 * breadcrumb read "Dashboard / Select a project") but the OUTER route kept its projectId — and the
 * link surface's gate is derived purely from the outer route, so it stayed up, dimming and blocking
 * the dashboard the user had just navigated to. `dashboardNavActions` fixed that half by moving the
 * route as well.
 *
 * The two suppressors B1050 added to belt-and-brace it turned out to be strands of their own — both
 * reproduced headless against the shipped build (ui-audit/diagnose-schedule-strand.mjs):
 *   • `dismissed` (X / Escape) was per-project component state in a KEPT-ALIVE workspace, so one
 *     dismissal removed the ONLY create/link entry point for that project for the whole session.
 *     That is the owner's Tsakiris-broken / Sylvestri-fine report, exactly.
 *   • `section !== "projects"` suppressed it whenever the embed reported its dashboard section —
 *     and a routed site with no link is never switched off that section, because the embed's
 *     nav-select-by-site handler returns its state UNCHANGED when it can't resolve the link.
 *
 * NEW-2 removes the need for both: the surface is no longer an overlay, it is the Schedule tab's
 * EMPTY STATE, rendered instead of the iframe. Nothing is covered, so there is nothing to dismiss,
 * and clearing the routed project (what Dashboard does) is the single, always-available way out.
 * So the gate below is derived purely from the OUTER route — the iframe's internal section has no
 * say, because an unlinked project gives the embed nothing useful to show anyway.
 */

// What pressing Dashboard must do. The post alone is what trapped the user: the outer route has
// to follow the iframe, exactly the way selectSchedule() carries a picked schedule's linked site
// up. `clearRoute` true ⇒ the caller also calls onProjectChange(null).
export function dashboardNavActions({ projectId } = {}) {
  return { post: { type: "planar:nav-dashboard" }, clearRoute: projectId != null };
}

// Whether the Schedule tab shows its "no schedule for this project" EMPTY STATE (in place of the
// embedded Gantt) rather than the grid.
//
// Purely a function of the OUTER route: the route points at a site, that site has no linked
// schedule, and we know its display name. There is deliberately NO dismissal input and NO
// dependence on the iframe's internal section — either one can strand the project, because this is
// the only surface from which a schedule can be created or linked (the breadcrumb's New project
// makes an UNLINKED schedule). Pressing Dashboard clears `projectId`, which is what closes this.
export function shouldShowLinkPanel({
  ready = false, projectId = null, linkedSchedule = null, routedSiteName = null,
} = {}) {
  if (!ready) return false;              // never flash before the iframe reports in
  if (projectId == null) return false;   // no routed site → nothing to resolve
  if (linkedSchedule) return false;      // already linked → the grid is the answer
  if (!routedSiteName) return false;     // never surface (or create) a schedule named the raw id (B560)
  return true;
}

// Whether the carry-OUT effect may adopt the iframe's active schedule's linked site into an empty
// route. `dashboardIntent` is the anti-ping-pong guard: clearing the route on Dashboard leaves a
// window where the route is empty but the iframe hasn't yet reported section "reports" — without
// this the carry-out would instantly re-adopt the site we just cleared and bring the panel back.
// The intent is cleared by the very next nav-state, so a non-honouring iframe degrades to the
// prior behaviour rather than a route that can never adopt again.
export function shouldAdoptLinkedSiteIntoRoute({
  isActive = true, section = "projects", projectId = null, dashboardIntent = false,
} = {}) {
  if (!isActive) return false;          // only the VISIBLE module may write the route (keep-alive gate)
  if (section !== "projects") return false;
  if (projectId != null) return false;  // route already carries a project → inert (loop-free)
  return !dashboardIntent;
}
