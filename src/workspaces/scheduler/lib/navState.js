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
      // `ownerKind` rides along so the shell's owner grouping reads the SAME answer the embedded
      // app's document holds, rather than re-deriving it from the link alone. Without it, a
      // schedule explicitly moved to the organization while a stale `linkedSiteId` lingered would
      // group under the organization in the embed and under the old project in the shell — two
      // answers to one question. Carried only when present, so a pre-migration payload keeps its
      // exact prior shape and `ownerOf` falls back to inferring from the link.
      if (p.ownerKind != null) out.ownerKind = p.ownerKind;
      // B1404352 — how many tasks a schedule holds, carried only when the embedded app actually
      // reported one (older/malformed payloads keep their exact prior shape). Lets the shell's
      // per-schedule delete confirmation name what it's about to remove without a second
      // round-trip into the iframe.
      if (p.taskCount != null) out.taskCount = p.taskCount;
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

// Every schedule linked to a given Site Planner project (group_id), in list order. NEW-3
// (B1080547) — a project may now carry MORE than one schedule (the owner explicitly asked for
// this), so "the schedule for this site" is no longer guaranteed to be a single answer. Pure +
// null-safe; [] when nothing is linked (the "create / link" empty state applies) or when either
// arg is missing.
export function findAllBySiteId(projects, siteId) {
  if (siteId == null || !Array.isArray(projects)) return [];
  return projects.filter((p) => p && p.linkedSiteId != null && p.linkedSiteId === siteId);
}

// The FIRST schedule linked to a given Site Planner project (group_id), or null. Used as the
// carry-in's default target (which schedule to open when the route is first visited) and by
// every caller that only ever expected one link. Pure + null-safe.
export function findBySiteId(projects, siteId) {
  return findAllBySiteId(projects, siteId)[0] || null;
}

// True while the embedded app is NOT yet showing the routed site's schedule — i.e. the shell must
// (re)post planar:nav-select-by-site so the grid follows the route. Stays true when the link isn't
// resolvable yet (the embed's projects haven't loaded), so the carry-in keeps driving until the
// iframe actually has the data to switch. This is what makes the carry-in self-heal the boot race
// where the FIRST select is dropped before the embed's cloud data loads (the B644 null-data guard)
// and — pre-fix — was never retried, stranding the grid on the previously-active schedule while the
// crumb correctly named the routed one (the route↔grid divergence, B851).
//
// NEW-2 — `section` is part of the answer, and leaving it out was the whole bug. "Showing the
// routed site's schedule" is TWO facts: the right project is active AND the embed is on its
// PROJECTS section rather than its own Dashboard (reports). The old test compared only the active
// id, so the very common state — the owner last pressed Dashboard inside Schedule, which the embed
// persists as `section:"reports"` in its cloud doc, while `aPid` still names the routed project's
// schedule — answered "nothing to carry in". Nothing was posted, the embed stayed on its Dashboard,
// and jumping Site Planner → Schedule inside a project landed on the dashboard every time. Worse,
// it was self-sustaining: the section persists, so it kept happening for every project until the
// user manually picked one from the breadcrumb.
//
// A deliberate in-module Dashboard press is NOT caught by this, because that path CLEARS the routed
// project (dashboardNavActions → onProjectChange(null)) and `siteId == null` returns false here.
// So the only way to be on a non-projects section with a routed site is to have arrived from
// another module — which is exactly the case that must be carried in.
//
// Pure + null-safe; no siteId → nothing to carry. `section` is optional so an older caller keeps
// the previous behaviour.
// NEW-3 — checks membership in the FULL linked set, not just the first match, so switching
// between two schedules the owner has linked to the SAME site never reads as "needs carry-in"
// (which would fight the switch back to the first one every time).
export function needsScheduleCarryIn(projects, siteId, activeId, section) {
  if (siteId == null) return false;
  if (section != null && section !== "projects") return true;
  const linked = findAllBySiteId(projects, siteId);
  if (linked.some((p) => p.id === activeId)) return false;
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

/* ---- B748064 — a deliberate switcher pick of a CROSS-CUTTING schedule must be visible ----------
 *
 * Owner report: on a project with no linked schedule (the empty-state "no schedule for this
 * project" screen), clicking ANY of the six rows in the switcher does nothing — including
 * Operations and Pursuits, the two schedules that aren't tied to any site at all.
 *
 * Root cause: `currentProject`/`showEmptyState` in Scheduler.jsx are derived purely from the
 * ROUTE (does the routed site have a linked schedule?), which is right for keeping the grid
 * pinned to the routed project during ordinary navigation — but it has no way to represent "the
 * user just explicitly chose a schedule that isn't reachable through the route at all." selectSchedule()
 * DOES post planar:nav-select and the embedded app DOES switch its own active project — the pick
 * genuinely lands — but the shell keeps showing the routed project's own empty state over it, so
 * the switch is invisible. A linked target (Goose Creek, Grand Port, 8 South, Pappadoupolos) works
 * today because picking one also calls onProjectChange(), which moves the route and makes the
 * route-derived state resolve to the newly routed project.
 *
 * isPickShowing answers "is the schedule the user just picked the one actually active in the
 * embed right now" — true only once the embed's own reported activeId catches up to the pick, and
 * only on its projects section.
 *
 * ⛔ B1341184 — "self-clearing: once activeId moves on… this answers false again on its own" WAS
 * WRONG, and the gap it left was a permanent deadlock, not a rare edge case. `pickShowing` also
 * gates the SELF-HEALING CARRY-IN EFFECT in Scheduler.jsx (`if (pickShowing) return;`) — the very
 * effect responsible for moving `activeId` on after a genuine navigation. So once ANY schedule was
 * explicitly picked, `pickShowing` latched true FOREVER: nothing could ever move `activeId` away
 * from the pick again, which made `pickShowing` re-read true on every future render, which kept
 * blocking the one effect that could have cleared it. Reproduced live: pick "TAS Land Sale" under
 * Goose Creek, then switch the PROJECT breadcrumb to Mesa/Grand Port/Richfield — the SCHEDULE
 * breadcrumb stays on "TAS Land Sale" regardless of which project is routed, because the carry-in
 * effect, the empty-state gate, and the grid-mismatch gate are ALL suppressed by the stuck
 * `pickShowing`, indefinitely.
 *
 * The pick was never meant to survive a genuine change of ROUTED PROJECT — B748064's own scenario
 * is a pick that stays valid only while the user remains on the project it was made under (a
 * cross-cutting Organization schedule picked from an empty-state project). So the pick now also
 * carries the project it belongs to: `projectId` on a linked schedule, or the routed project at
 * pick time for a cross-cutting one. `isPickShowing` requires that recorded project to still match
 * the CURRENTLY ROUTED one — a real project switch invalidates the pick, which is what lets the
 * carry-in effect run again for the newly routed project. */
export function isPickShowing(pick, activeId, section, projectId) {
  if (pick == null || activeId == null || pick.id !== activeId || section !== "projects") return false;
  return pick.projectId === (projectId ?? null);
}

// Whether the carry-OUT effect may adopt the iframe's active schedule's linked site into an empty
// route. `dashboardIntent` is the anti-ping-pong guard: clearing the route on Dashboard leaves a
// window where the route is empty but the iframe hasn't yet reported section "reports" — without
// this the carry-out would instantly re-adopt the site we just cleared and bring the panel back.
// The intent is cleared by the very next nav-state, so a non-honouring iframe degrades to the
// prior behaviour rather than a route that can never adopt again.
//
// ⛔ NEW-1 (owner report, 2026-09-15 — "sometimes when I'm clicking between modules... it takes me
// to the wrong place") — `bootCarryOutAllowed` is a REQUIRED gate now, not an oversight to add
// later. `activeId`/`section` come from the embedded app's own persisted, ACCOUNT-WIDE `aPid`
// field (see the B1080544/B851 notes above this function) — "what schedule was last open," not
// "what the user just chose." Without this gate, EVERY later arrival at a project-less Schedule
// route (a module-tab click from Site's own "Select a project", a hand-typed `#/schedule`, a
// revisit after deliberately leaving a project elsewhere) silently re-adopted whatever project
// that ambient field happened to hold — which is exactly what made a routed project feel random:
// the same click landed differently depending on invisible state left over from an earlier visit,
// possibly from a different tab or session entirely. `bootCarryOutAllowed` is the SAME boot-resume
// privilege `SitePlannerApp.jsx`'s `mayResumeLastSite` already grants (Shell's `resumeAllowed`) —
// true only while THIS mount is processing the app's own actual boot route — and the caller must
// FREEZE it at first render (never re-read Shell's live `resumeAllowed` on every render), because
// `mayResumeLastSite` only compares the CURRENT projectId against the boot-time one: if the boot
// itself resolved project-less (e.g. the Dashboard), `resumeAllowed` reads true again any later
// time the live projectId cycles back to null, which is precisely the case this gate exists to
// close. See `shouldNeutralizeToReports` below for the honest counterpart: when this returns
// false, the iframe must be told to stop showing that stale project, not merely left alone.
export function shouldAdoptLinkedSiteIntoRoute({
  isActive = true, section = "projects", projectId = null, dashboardIntent = false, bootCarryOutAllowed = false,
} = {}) {
  if (!isActive) return false;          // only the VISIBLE module may write the route (keep-alive gate)
  if (section !== "projects") return false;
  if (projectId != null) return false;  // route already carries a project → inert (loop-free)
  if (!bootCarryOutAllowed) return false; // NEW-1 — not the app's own boot-resume: never silently adopt
  return !dashboardIntent;
}

// NEW-1 — the honest counterpart to shouldAdoptLinkedSiteIntoRoute. The route names no project,
// this ISN'T the app's boot-resume privilege (see that gate's own header just above), and the
// iframe is STILL showing some specific project's grid — its own persisted `aPid`, left over from
// this tab's earlier visit, another tab, or another session. Rather than leave that stale project
// visibly on screen while the breadcrumb correctly says "no project" (a crumb/grid mismatch that
// is arguably worse than the silent-adopt bug), tell the iframe to show its own neutral,
// cross-project Dashboard (reports) view instead — the same "nothing chosen ⇒ a real, honestly-
// labeled neutral state" shape the Site Planner's own "Select a project" map already uses.
// `dashboardIntent` is skipped deliberately: a Dashboard press already told the iframe to switch
// (dashboardNavActions), so re-posting here would be redundant, not wrong — but there is nothing
// useful for this function to add in that window.
export function shouldNeutralizeToReports({
  isActive = true, section = "projects", projectId = null, bootCarryOutAllowed = false, dashboardIntent = false,
} = {}) {
  if (!isActive) return false;
  if (projectId != null) return false;
  if (bootCarryOutAllowed) return false;  // the boot privilege still stands — let it try adopting first
  if (dashboardIntent) return false;      // already told the iframe to switch, nothing more to do
  return section === "projects";
}

/* ---- NEW-5 (B1080544) — make a route↔grid mismatch IMPOSSIBLE TO SEE, not merely self-healing ---
 *
 * Root cause, proven against production: `aPid` (which schedule the embedded app currently shows)
 * is a single GLOBAL, MUTABLE field stored in the one shared hs-v1 blob — not scoped per route,
 * per tab, or per session. The carry-in effect above re-drives the embed toward the routed site's
 * linked schedule, but the OLD Scheduler.jsx latched a `carriedRef` the first time that succeeded
 * and never re-armed it for the SAME routed project — so once `aPid` drifted away afterward (a
 * second tab, a stale reconciliation, any other write to the shared field), the grid was stuck
 * showing the WRONG project's tasks while the breadcrumb (which resolves straight from the route,
 * never from `aPid`) kept reading correctly. Reproduced live: routed on Richfield (its own linked
 * schedule has 1 task), `aPid` reading a different project (Pappadoupolos, 41 tasks) — breadcrumb
 * said Richfield, the grid rendered Pappadoupolos's rows.
 *
 * The fix removes the latch (the carry-in effect now re-drives on EVERY genuine mismatch, forever,
 * not once) AND adds this: a hard render gate. While the grid's active schedule isn't one of the
 * routed site's own linked schedules (and the user hasn't deliberately picked an unrelated
 * cross-cutting one — Pursuits/Operations, via isPickShowing), the iframe is HIDDEN and a brief
 * "switching" state shows instead — so a mismatch can never be visibly rendered, only ever a
 * transitional loader, regardless of what caused `aPid` to drift or how long the fix takes to
 * re-converge it.
 *
 * ⛔ B851 ×4 (NEW-1) — the gate above compared route-vs-BELIEF, not route-vs-GRID, and the belief
 * (`activeId`) is only ever updated when the embedded app POSTS a fresh `planar:nav-state`. Reproduced
 * live: the embedded app silently self-reloads a backgrounded tab (B850's 20s/focus/reconnect poll —
 * `public/sequence/index.html`'s `if (saveStatusRef.current === "saved" && document.hidden)
 * window.location.reload()`), the reloaded document boots showing whatever the shared `aPid` field
 * now says (which can have drifted while this tab was reloading/backgrounded), and — until IT
 * announces itself — the shell's `activeId` still holds the PRE-RELOAD value. That stale value can
 * happen to already equal the routed site's linked schedule id, so the gate read "matched" while the
 * grid underneath had already repainted with a different project's tasks. `navConfirmed` closes this:
 * it must be true only when the shell has heard a genuine `planar:nav-state` announcement SINCE the
 * iframe's most recent `load` event (Scheduler.jsx resets it to false in `onIframeLoad`, before
 * anything else, and sets it true only inside the nav-state message handler). An un-announced grid —
 * `navConfirmed === false` — is ALWAYS treated as mismatched, fail CLOSED, never matched-by-default,
 * regardless of what the stale `projects`/`activeId` belief says. Defaults to `true` so every existing
 * caller (and every pre-×4 unit test) keeps its prior meaning unchanged. */
export function isGridMismatched(projects, siteId, activeId, pickShowing, navConfirmed = true) {
  if (siteId == null || pickShowing) return false;
  if (!navConfirmed) return true; // fail closed: no confirmation from THIS load yet
  const linked = findAllBySiteId(projects, siteId);
  if (linked.length === 0) return false; // nothing linked yet — the empty state (not this gate) applies
  return !linked.some((p) => p.id === activeId);
}

/* ---- "+ New schedule" ASKS. It never names a schedule for him and never picks an owner. ---------
 *
 * ⛔ THIS FUNCTION USED TO BE THE BUG. Three empty schedules — "Goose Creek (2)", "(3)" and "(4)" —
 * sit on production right now because of exactly what it did: standing on a project, "+ New" took
 * NO name and NO owner, auto-named the new schedule after the project, and on a collision appended
 * "(2)", then "(3)", then "(4)". Three presses, three duplicates, no prompt at any point, and each
 * one silently re-pointed the project's last-active pointer at the newest empty one — so it read as
 * "nothing happened" while a real, indistinguishable schedule was minted every time.
 *
 * The old header called that disambiguating name the FIX for creating a second schedule under a
 * project ("the new schedule gets a disambiguating name rather than silently becoming a second,
 * indistinguishable 'Pappadoupolos'"). It was not: a machine-generated ordinal is exactly as
 * indistinguishable as a repeated name, because neither says what the schedule is FOR. A second
 * schedule under a project is a genuinely different thing — a master schedule and a land sale, as
 * the owner's own "TAS Land Sale" under Goose Creek shows — and only he knows which.
 *
 * So there is now ONE action, and it opens the New-schedule dialog rather than creating anything:
 * the name is PRE-FILLED (with the project's name when that project has no schedule yet, and left
 * EMPTY when it does — see suggestScheduleName) and the owner is PRE-SELECTED to the routed
 * project, and both are changeable before anything exists. Pre-filling an editable field in front
 * of him is a different act from committing a name to an object he never saw named.
 *
 * `siteId`/`siteName` are the dialog's PRE-SELECTED owner, not a decision — null outside a routed
 * project, where the dialog opens on the Organization instead. Pure; no I/O, no DOM. */
export function newProjectAction({ projectId = null, routedSiteName = null } = {}) {
  const routed = projectId != null && !!routedSiteName;
  return {
    type: "prompt",
    siteId: routed ? projectId : null,
    siteName: routed ? routedSiteName : null,
  };
}

/* ---- SUPERSEDED (B1435888) — `scheduleCrumbLabel` / `labelMultiScheduleRows` are GONE ------------
 *
 * B1404352 fixed "the breadcrumb must say WHICH PROJECT, not just which schedule" by RELABELING a
 * multi-schedule project's dropdown rows to "Goose Creek / TAS Land Sale", so the ONE combined
 * crumb never lost the project's name. B1435888 ("Schedule access: project and schedule become two
 * separate breadcrumb levels") replaces that mechanism outright: the breadcrumb is now TWO
 * independent crumbs — a plain project switcher, and a separate schedule switcher (`ScheduleCrumb`)
 * right beside it — so a schedule's OWN bare name is exactly what the schedule crumb shows; the
 * project crumb answers "which project" on its own, with nothing to relabel. If a future session
 * needs to rebuild a combined single-crumb label, the git history has both functions and their
 * tests intact as of this commit. */
