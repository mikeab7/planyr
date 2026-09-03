/* dashboardNav.js — pure helpers for the header's TWO adjacent "Dashboard" controls
 * (the `planyr` wordmark and the breadcrumb's Dashboard crumb), pulled out of
 * AppHeader.jsx / ProjectBreadcrumb.jsx so the wiring is unit-testable without
 * rendering React.
 *
 * B1128272 — on the Schedule module these two controls used to fire the IDENTICAL
 * handler: AppHeader only ever had ONE `onDashboard` prop, fed to both the wordmark
 * and the breadcrumb crumb, and Schedule wired that single prop to a function that
 * did TWO navigations at once (show Schedule's own reports view AND leave the
 * workspace for the Site Planner map) — a race the "leave" navigation usually won,
 * which is why pressing Dashboard on Schedule "often" landed on the map. The fix
 * splits the wordmark from the crumb: the wordmark keeps the "leave this workspace"
 * job (`onLogoDashboard`, falling back to the shared `onDashboard` when a caller
 * doesn't wire it — every module but Schedule has no in-module dashboard of its own,
 * so they're unaffected); the crumb keeps whatever `onDashboard` the workspace wires
 * (Schedule's own in-module dashboard action, once fixed to stop also leaving).
 */

// The wordmark's click handler + tooltip. `onLogoDashboard`, when supplied, wins over
// the shared `onDashboard` — used only where the two controls now do genuinely
// different things (Schedule). Every other caller passes only `onDashboard` and gets
// byte-identical behavior to before this existed.
export function logoDashboardAction({ onDashboard, onLogoDashboard, logoDashboardTitle } = {}) {
  const action = onLogoDashboard || onDashboard || null;
  return {
    onClick: action || undefined,
    title: action ? (logoDashboardTitle || "Dashboard: all projects") : undefined,
  };
}

// The breadcrumb's Dashboard-crumb tooltip. `dashboardTitle`, when supplied, overrides
// the generic "All projects: <homeLabel>" text — needed when the crumb's action is no
// longer "go to all projects" (Schedule's crumb shows only ITS OWN dashboard, not the
// Site Planner map home the wordmark now leads to).
export function crumbDashboardTitle({ homeLabel = "Dashboard", dashboardTitle } = {}) {
  return dashboardTitle || `All projects: ${homeLabel}`;
}
