/* Sequence Planyr workspace — embeds the scheduler in-page via iframe.
 * The sequence app's own header is hidden when it detects it's inside an iframe
 * (see public/sequence/index.html — the .in-iframe CSS class), so its project
 * navigation is bridged up to the shell's shared Row-1 breadcrumb over postMessage
 * (B203). The embedded app emits its OWN project list + active project + section
 * ("planar:nav-state"); this component renders them in the breadcrumb and posts back
 * select / dashboard / new-project commands. That makes the Schedule picker show
 * SCHEDULE projects (Goose Creek, Grand Port, …) and switch them in place — instead
 * of listing the Site Planner's sites and bouncing into the Site Planner. */
import { useCallback, useEffect, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import ModuleLoader from "../../shared/ui/ModuleLoader.jsx";
import { parseNavState, deriveCurrentProject, findBySiteId } from "./lib/navState.js";
import { ScheduleCenter, ScheduleActions } from "./components/ScheduleToolbar.jsx";
import { listProjects, warmProjectsIfEmpty, suggestNameMatch } from "../../shared/projects/projects.js";
import LinkSchedulePanel from "./components/LinkSchedulePanel.jsx";

export default function Scheduler({
  shellModule, onShellSwitch, authControl, accountActive = false,
  // Cross-module connection: the active Site Planner project (group_id) from the URL route, and
  // the callback that writes it back. When set, the Scheduler activates the schedule LINKED to
  // that site (so the header tabs carry the same project); if none is linked yet it shows the
  // "create / link" resolution panel. onScheduleLinkChanged lets the Shell mirror the link onto
  // the Site Planner side (the two live in separate backends).
  projectId = null, onProjectChange, onScheduleLinkChanged,
} = {}) {
  const iframeRef = useRef(null);
  const [projects, setProjects] = useState([]);   // [{id, name}] from the embedded app
  const [activeId, setActiveId] = useState(null);  // its active project id (aPid)
  const [section, setSection] = useState("projects"); // "projects" | "reports" (Dashboard)
  // B224 — the iframe loads the heavy standalone Gantt app; show the "assembling
  // schedule" loader over it until it's interactive, then cross-fade out. The
  // embedded app emits planar:nav-state once its data is loaded + first paint is
  // done, so the FIRST such message is our "ready" signal.
  const [ready, setReady] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  // `ready` flips exactly once (whichever signal lands first); the ref makes the timers +
  // message handler idempotent so a late nav-state can't re-trigger the cross-fade.
  const readyRef = useRef(false);
  const markReady = useCallback(() => {
    if (readyRef.current) return;
    readyRef.current = true;
    setReady(true);
  }, []);
  // B388 — the embedded app's action toolbar, lifted into this shell header. The embedded app
  // reports its live toolbar state up over the bridge (planar:toolbar-state); the lifted
  // controls render it and post commands (planar:*) back down. `ready` stays false until the
  // first report, so we never render a control backed by a fabricated value (e.g. a hardcoded
  // unread count) — the iframe is the single source of truth.
  const [toolbar, setToolbar] = useState({ ready: false });
  // The Site Planner's projects (= site groups), for the resolution panel: the site's display
  // name + the suggested same-named schedule. Warmed like the breadcrumb does (B475) so a fresh
  // tab that lands straight on the Schedule still has the list. listProjects() is a local read.
  const [siteProjects, setSiteProjects] = useState(() => { try { return listProjects(); } catch (_) { return []; } });
  useEffect(() => { (async () => { try { await warmProjectsIfEmpty(); setSiteProjects(listProjects()); } catch (_) {} })(); }, []);

  // Receive the embedded scheduler's nav state (its own projects — not the Site
  // Planner's). It re-emits on load and on every project add/rename/delete/switch.
  useEffect(() => {
    const onMsg = (e) => {
      // Same-origin embedded iframe only — ignore messages from any other window so a
      // cross-origin page can't spoof the scheduler's project list into the breadcrumb.
      if (e.origin !== window.location.origin) return;
      // Toolbar state (B388) — a sibling of nav-state from the same embedded app. Coerce to
      // safe types so a malformed message can't render a NaN %/count; `ready` gates display.
      const m = e.data;
      if (m && m.source === "planar-seq" && m.type === "planar:toolbar-state") {
        setToolbar({
          ready: true,
          view: m.view, section: m.section, isMobile: !!m.isMobile,
          zoomPct: Number(m.zoomPct) || 0, zoomable: !!m.zoomable,
          reviewCount: Number(m.reviewCount) || 0, reviewOpen: !!m.reviewOpen,
          saveStatus: m.saveStatus, savePulse: !!m.savePulse, fileLinked: !!m.fileLinked,
          activePanel: m.activePanel || null,
        });
        return;
      }
      // Cross-module link set/cleared/created inside the embedded app — mirror the lightweight
      // hint onto the Site Planner side (the Shell owns that write; this app can't reach the
      // site backend). Refresh our local site list so a freshly-linked name shows immediately.
      if (m && m.source === "planar-seq" && m.type === "planar:link-changed") {
        try { onScheduleLinkChanged?.(m.siteId ?? null, { scheduleProjectId: m.scheduleId ?? null, name: m.name ?? null }); } catch (_) {}
        try { setSiteProjects(listProjects()); } catch (_) {}
        return;
      }
      // parseNavState validates source/type and SANITIZES the project list to plain
      // {id,name,linkedSiteId,linkedSiteName} objects (B380), so the breadcrumb can never
      // deref an undefined entry.
      const nav = parseNavState(e.data);
      if (!nav) return;
      setProjects(nav.projects);
      setActiveId(nav.activeId);
      setSection(nav.section);
      markReady();   // first nav-state ⇒ the embedded app is interactive
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [markReady, onScheduleLinkChanged]); // markReady is a stable useCallback → still effectively attach-once

  // When the iframe document finishes loading, ASK the embedded app to (re-)announce its
  // nav-state, retrying briefly in case its own message listener isn't attached yet. The lone
  // 9 s timer used to be the ONLY backstop, so any time the first nav-state was slow or missed
  // (a network hiccup, the embed's deps loading slowly) the loader sat for a full 9 seconds —
  // the "slow/buggy sometimes" the owner saw. This handshake makes the fast path reliable, and
  // a short fallback reveals the embed ~2.5 s after it loads even if it never answers (a slow/
  // broken embed shouldn't hold a full-screen spinner).
  const onIframeLoad = useCallback(() => {
    let tries = 0;
    const ask = () => {
      if (readyRef.current) return;
      try {
        iframeRef.current?.contentWindow?.postMessage(
          { source: "planar-shell", type: "planar:nav-request" }, window.location.origin,
        );
      } catch (_) {}
      if (++tries < 7) setTimeout(ask, 380); // ~2.3 s of polite retries
    };
    ask();
    setTimeout(markReady, 2500); // reveal even if the embed never reports interactive
  }, [markReady]);

  // Absolute backstop in case `onLoad` itself never fires (e.g. the iframe doc hangs).
  useEffect(() => {
    const t = setTimeout(markReady, 6000);
    return () => clearTimeout(t);
  }, [markReady]);

  // Once ready, let the cross-fade finish, then drop the overlay entirely.
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => setShowLoader(false), 450);
    return () => clearTimeout(t);
  }, [ready]);

  // Same-origin iframe, so target its exact origin (not "*").
  const post = (msg) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { source: "planar-shell", ...msg }, window.location.origin,
      );
    } catch (_) {}
  };

  // Project-aware header tabs (the cross-module payoff): when the route carries a Site Planner
  // project (group_id), ask the embedded app to activate the schedule linked to it. Fires once
  // the iframe is ready and whenever the routed project changes. No link yet → the embedded app
  // ignores it and the resolution panel (below) offers create/link. Re-posting is harmless.
  useEffect(() => {
    if (!ready || projectId == null) return;
    post({ type: "planar:nav-select-by-site", siteId: projectId });
  }, [ready, projectId]);

  // Keep the route's project in sync the other way: when the active schedule is linked to a site,
  // push that site id up so switching to the Site/Review tabs lands on the SAME project. Only ever
  // pushes a real link up — never clears — so viewing an unlinked schedule won't churn the route.
  useEffect(() => {
    if (section !== "projects") return;
    const cur = deriveCurrentProject(projects, activeId, section);
    const linked = cur && cur.linkedSiteId != null ? cur.linkedSiteId : null;
    if (linked != null && linked !== projectId) { try { onProjectChange?.(linked); } catch (_) {} }
  }, [projects, activeId, section, projectId, onProjectChange]);

  // On the Dashboard (reports) view no single project is "current" — the Dashboard
  // crumb reads as current and the project crumb invites a pick. deriveCurrentProject
  // (B380) never throws and never returns undefined, so the first-render-before-nav-
  // state window resolves to null (empty/loader state) instead of dereferencing a
  // not-yet-resolved record.
  const currentProject = deriveCurrentProject(projects, activeId, section);

  // Resolution panel (suggest-and-confirm): the route points at a site that has NO linked
  // schedule yet. Offer "create a schedule for this site" + linking an existing one (with a
  // same-named suggestion). Gated on `ready` so it never flashes before the iframe reports in.
  const routedSite = projectId != null ? (siteProjects.find((p) => p.id === projectId) || null) : null;
  const routedSiteName = routedSite ? routedSite.name : projectId;
  const linkedSchedule = findBySiteId(projects, projectId);
  const showLinkPanel = ready && projectId != null && !linkedSchedule;
  const suggestedMatch = showLinkPanel ? suggestNameMatch(routedSiteName, projects) : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f6f8fa" }}>
      <AppHeader
        module={shellModule || "scheduler"}
        onSwitch={onShellSwitch}
        authControl={authControl}
        accountActive={accountActive}
        homeLabel="Dashboard"
        // The breadcrumb drives the EMBEDDED scheduler (its own projects), not the
        // Site Planner: pick a project → switch to its Gantt; Dashboard → the reports
        // overview; New project → add one in the scheduler.
        currentProject={currentProject}
        projects={projects}
        onSelectProject={(id) => post({ type: "planar:nav-select", id })}
        onDashboard={() => post({ type: "planar:nav-dashboard" })}
        onNewProject={() => post({ type: "planar:nav-new" })}
        // Rename/delete a SCHEDULE project (B440) — bridged to the embedded app's own hs-v1
        // record (not the Site store). The breadcrumb already confirmed the delete inline, so
        // the embedded handler deletes without re-prompting + routes home on the active project.
        onRenameProject={(id, name) => post({ type: "planar:nav-rename", id, name })}
        onDeleteProject={(id) => post({ type: "planar:nav-delete", id })}
        // B388 — the embedded app's toolbar, lifted into the unified header (center = view +
        // review; right = zoom/export/save/history/contacts/automation/format/settings).
        toolbarCenter={<ScheduleCenter toolbar={toolbar} post={post} />}
        toolbarContent={<ScheduleActions toolbar={toolbar} post={post} />}
      />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        <iframe
          ref={iframeRef}
          src="/sequence/"
          title="Sequence Planyr"
          onLoad={onIframeLoad}
          style={{ position: "absolute", inset: 0, border: "none", width: "100%", height: "100%", display: "block" }}
        />
        {showLoader && (
          <div
            aria-hidden={ready}
            style={{
              position: "absolute", inset: 0, zIndex: 5,
              opacity: ready ? 0 : 1,
              transition: "opacity 0.45s ease",
              pointerEvents: ready ? "none" : "auto",
            }}
          >
            <ModuleLoader module="scheduler" />
          </div>
        )}
        {showLinkPanel && (
          <LinkSchedulePanel
            siteName={routedSiteName}
            schedules={projects}
            suggestedMatch={suggestedMatch}
            onCreate={() => post({ type: "planar:nav-create-linked", name: routedSiteName, siteId: projectId, siteName: routedSiteName })}
            onLink={(scheduleId) => post({ type: "planar:nav-link", id: scheduleId, siteId: projectId, siteName: routedSiteName })}
          />
        )}
      </div>
    </div>
  );
}
