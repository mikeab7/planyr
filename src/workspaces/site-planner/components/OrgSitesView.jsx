/* OrgSitesView (NEW-2, company workspace card) — what the Site tab shows at COMPANY scope: a map of
 * every project the account has, one labelled pin each, where tapping a pin opens that project on
 * the Site tab. The Site Planner has no company-level plan (there is no parcel to draw without a
 * project), so company scope is the zoomed-out answer instead of a fallback to another tab.
 *
 * It reuses the Dashboard's Locations map (`LocationsMapCard`, `scope="all"`) — same Leaflet map,
 * same aerial imagery, same pin placement INSIDE each parcel (PR 1918), same label collision —
 * rather than a second map. Data is the same two reads the Dashboard makes (`fetchSiteSummaries`
 * + element recency) through the same grouping (`groupProjectsByGroupId`), so a project reads the
 * same here as there. Read-only: nothing here writes.
 *
 * Mounted by Shell.jsx ONLY while the route is `#/org/site`; the Site Planner itself is not
 * mounted for it (and, if it was already open, is held inactive so it never writes the route).
 * Its own AppHeader makes the crumb read Map / <Company name> and keeps every tab one click away.
 */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import AppHeader from "../../../shared/ui/AppHeader.jsx";
import { fetchSiteSummaries } from "../../dashboard/lib/dashboardSitesFetch.js";
import { fetchAllElementRecency } from "../../dashboard/lib/dashboardElementRecencyFetch.js";
import { groupProjectsByGroupId } from "../../dashboard/lib/dashboardPipeline.js";
import { summarizeElementRecency } from "../../../shared/projects/projectModel.js";

// Leaflet's weight stays out of the entry chunk, exactly as on the Dashboard.
const LocationsMapCard = lazy(() => import("../../dashboard/components/LocationsMapCard.jsx"));

export default function OrgSitesView({ onShellSwitch, authControl, accountActive = false, onGoDashboard, onNavigate, onNewProject, onSelectOrg, onFixLocations }) {
  const [sites, setSites] = useState(null);       // null = still loading
  const [recency, setRecency] = useState({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const [s, r] = await Promise.allSettled([fetchSiteSummaries(), fetchAllElementRecency()]);
      if (!live) return;
      // LOUD-FAILURE: a failed read must not read as "you have no projects".
      if (s.status === "rejected") { setFailed(true); setSites([]); return; }
      setSites(s.value || []);
      if (r.status === "fulfilled") setRecency(summarizeElementRecency(r.value || []));
    })();
    return () => { live = false; };
  }, [accountActive]);

  const projects = useMemo(() => groupProjectsByGroupId(sites || [], recency), [sites, recency]);
  const openProject = (p) => onNavigate?.({ module: "site-planner", projectId: p.groupId, cross: false, org: false });

  return (
    <div data-testid="org-sites-view" style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--surface-page)" }}>
      <AppHeader
        module="site-planner"
        onSwitch={onShellSwitch}
        authControl={authControl}
        accountActive={accountActive}
        // The Site tab's home crumb is "Map" (all projects); at company scope the trail is
        // Map / <Company name>, and clicking "Map" returns to the ordinary project map.
        homeLabel="Map"
        onDashboard={() => onNavigate?.({ module: "site-planner", projectId: null, cross: false, org: false })}
        onLogoDashboard={onGoDashboard}
        currentProject={null}
        org
        onSelectOrg={onSelectOrg}
        onSelectProject={(id) => onNavigate?.({ module: "site-planner", projectId: id, cross: false, org: false })}
        onNewProject={onNewProject}
      />
      <div style={{ flex: 1, minHeight: 0, padding: 12, display: "flex", flexDirection: "column" }}>
        {sites === null ? (
          <div style={{ fontSize: 12, color: "var(--text-secondary)" }} data-testid="org-sites-loading">Loading your sites…</div>
        ) : failed ? (
          <div role="alert" style={{ fontSize: 12, color: "var(--warn-text)" }} data-testid="org-sites-error">Couldn't load your sites — check your connection and reopen this tab.</div>
        ) : (
          <Suspense fallback={<div style={{ fontSize: 12, color: "var(--text-secondary)" }}>Loading map…</div>}>
            <LocationsMapCard scope="all" projects={projects} comps={null} onOpenProject={openProject} onFixLocations={onFixLocations} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
