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
import {
  parseNavState, deriveCurrentProject, findBySiteId, needsScheduleCarryIn,
  dashboardNavActions, shouldShowLinkPanel, shouldAdoptLinkedSiteIntoRoute, isPickShowing,
} from "./lib/navState.js";
import { reportClientEvent } from "../../shared/telemetry/clientErrors.js";
import { scheduleSaveState } from "./lib/saveState.js";
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
  // Keep-alive: false while mounted but hidden behind another tab. The iframe stays booted
  // (the whole point — no ~2 s Gantt re-boot per switch); hidden, we still FOLLOW the route
  // into the iframe, but never write the route from iframe state.
  isActive = true,
  // NEW-1 (B866xxx) — the Shell passes this to every workspace so the shared header's Dashboard
  // crumb always means the same thing (leave this workspace, go to the Site Planner map home).
  // Scheduler used to receive it and never read it — see goDashboard's own header below.
  onGoDashboard,
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
  // B1050 — the user pressed Dashboard: the route is being cleared, but the iframe hasn't reported
  // section "reports" back yet. Suppress the carry-OUT adoption for exactly that window, or it would
  // re-adopt the site we just cleared and put the trapping panel straight back up. Cleared by the
  // very next nav-state (see the message handler), so it can never wedge the route permanently.
  const dashboardIntentRef = useRef(false);
  // The switcher id the user last EXPLICITLY picked (or null). Read by isPickShowing() below to
  // let a deliberate pick of a cross-cutting unlinked schedule (Operations/Pursuits) show its grid
  // even on a routed project with no schedule of its own — see navState.js for the full story.
  const explicitPickRef = useRef(null);

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
          offlineFallback: !!m.offlineFallback, // B566 — cloud-unreachable → badge shows honest "offline", not a false "synced"
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
      // The iframe has reported since the Dashboard press — whatever it says is now the truth, so
      // the anti-ping-pong suppression has done its job (B1050).
      dashboardIntentRef.current = false;
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
  // B853268/NEW-5 — the empty state's OWN visibility gate (`ready`, below) used to be the only
  // signal these two fallback timers drove. `toolbar.ready` and `projects` (the schedules list)
  // have no such fallback, so on a load slow enough to hit either timer, `ready` flips true and
  // the empty state mounts a full beat before the real `planar:toolbar-state`/`planar:nav-state`
  // messages land — painting with the toolbar and the "Link an existing schedule" row missing
  // until whatever next re-render happens to catch the deferred state up. `markToolbarReadyFallback`
  // is toolbar.ready's twin of markReady: it only ever flips a still-default `{ready:false}` to
  // true (a REAL planar:toolbar-state report always wins — this never clobbers real data), on the
  // SAME two timers, so every signal the empty state depends on resolves on one schedule.
  const markToolbarReadyFallback = useCallback(() => {
    setToolbar((t) => (t.ready ? t : { ...t, ready: true }));
  }, []);
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
    setTimeout(markToolbarReadyFallback, 2500);
  }, [markReady, markToolbarReadyFallback]);

  // Absolute backstop in case `onLoad` itself never fires (e.g. the iframe doc hangs).
  useEffect(() => {
    const t = setTimeout(markReady, 6000);
    const t2 = setTimeout(markToolbarReadyFallback, 6000);
    return () => { clearTimeout(t); clearTimeout(t2); };
  }, [markReady, markToolbarReadyFallback]);

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
  // project (group_id), keep the embedded app's ACTIVE schedule pinned to the schedule linked to it,
  // so the grid always matches the crumb + route. No link yet → the embedded app ignores the post
  // and the resolution panel (below) offers create/link. The embedded handler no-ops when that
  // schedule is already active, so re-posting is harmless (it can't trigger a save).
  //
  // SELF-HEALING (B851 — the route↔grid divergence): this is a RE-DRIVE, not a fire-once. The
  // original one-shot (deps `[ready, projectId]`) posted the select a single time when `ready`
  // flipped; when `ready` flips via the fallback timer (onIframeLoad's 2.5s / the 6s backstop)
  // BEFORE the embed's ~230 KB hs-v1 cloud data has loaded, the embed DROPS that select (its
  // B644 null-data guard) and it was never retried — stranding the grid on the embed's
  // previously-active schedule while the crumb correctly named the routed one (owner repro
  // 2026-07-15: route Goose Creek, grid Grand Port). Re-running on `projects`/`activeId` means the
  // dropped select is re-posted the moment the embed's data lands, and keeps re-driving until the
  // grid ADOPTS the routed link; `carriedRef` then stops it so a later DELIBERATE pick of a
  // cross-cutting unlinked schedule (Pursuits/Operations) isn't yanked back. Never writes the route
  // (no onProjectChange) → cannot revive the B560/V172 A↔B ping-pong; the `projectId != null` gate
  // keeps this strictly the carry-IN branch (carry-out below stays `projectId == null`).
  const carriedRef = useRef(null);
  useEffect(() => {
    if (!ready || projectId == null) return;
    if (!needsScheduleCarryIn(projects, projectId, activeId, section)) { carriedRef.current = projectId; return; }
    // Already carried this route's grid onto its schedule once → let deliberate later picks stand
    // (picking the cross-cutting Pursuits / Operations schedule must not be yanked back). Re-arms
    // whenever the routed project changes (carriedRef holds the last-carried projectId).
    //
    // NEW-2 — that latch is scoped to the PROJECTS section. A non-projects section (the embed's own
    // Dashboard) cannot reflect the route at all, so it is never a deliberate pick worth preserving:
    // pressing Dashboard inside Schedule clears the routed project, so the only way to be here is to
    // have arrived from another module. Without this scoping, coming back to a project we had
    // already carried once left the latch closed and the Dashboard on screen — the same landing the
    // section fix exists to prevent, reached by a second route.
    if (carriedRef.current === projectId && section === "projects") return;
    post({ type: "planar:nav-select-by-site", siteId: projectId });
    // LOUD-FAILURE backstop: if the routed site's linked schedule is ALREADY loaded (resolvable in
    // `projects`) yet the grid still hasn't adopted it after a short settle window, the drive isn't
    // converging — a real fault, not the ordinary pre-load window. Surface it to telemetry (this was
    // a silent no-op before). React runs THIS effect's cleanup before any re-run, so adoption
    // (activeId changes → effect re-runs) clears the timer; it only fires when nothing changed for
    // 2.5s. No user-facing banner → respects the anti-flash guard.
    const linked = findBySiteId(projects, projectId);
    if (!linked) return;
    const t = setTimeout(() => {
      try {
        reportClientEvent(
          "schedule-route-grid-divergence",
          "routed site's linked schedule never became the active grid",
          { siteId: projectId, linkedId: linked.id, activeId },
        );
      } catch (_) { /* telemetry must never throw into the app */ }
    }, 2500);
    return () => clearTimeout(t);
  }, [ready, projectId, projects, activeId, section]);

  // Carry the project the OTHER way ONLY when the route has no project yet (projectId == null):
  // adopt the iframe's active schedule's linked site into the empty route so the Site/Review tabs
  // can follow. This is loop-free — once it sets projectId the guard makes it inert, so it can
  // NEVER fight the carry-in effect above. (The first cut of this pushed up on EVERY nav-state,
  // even when the route already carried a project — so arriving on site A while the iframe's
  // last-active schedule was linked to site B made the two effects ping-pong the route A↔B, which
  // flashed the whole screen + breadcrumb, B560.) A user switching schedules WITHIN the scheduler
  // carries up via selectSchedule() below.
  useEffect(() => {
    // Keep-alive gate: only the VISIBLE module may write the route. A hidden scheduler
    // adopting its linked site would rewrite the project out from under the user (e.g.
    // while they sit on the Site dashboard with no project selected). The dashboardIntent arm
    // (B1050) holds the adoption off for the one frame between "Dashboard cleared the route" and
    // "the iframe confirmed it's on reports" — without it the two would ping-pong the project back.
    if (!shouldAdoptLinkedSiteIntoRoute({ isActive, section, projectId, dashboardIntent: dashboardIntentRef.current })) return;
    const cur = deriveCurrentProject(projects, activeId, section);
    const linked = cur && cur.linkedSiteId != null ? cur.linkedSiteId : null;
    if (linked != null) { try { onProjectChange?.(linked); } catch (_) {} }
  }, [projects, activeId, section, projectId, onProjectChange, isActive]);

  // Picking a schedule from the breadcrumb is a USER action: switch to it, and if it's linked to a
  // site, carry that site into the route so the Site/Review tabs follow. One-shot (not a reactive
  // effect), so it can't loop with the carry-in.
  const selectSchedule = (id) => {
    dashboardIntentRef.current = false; // a deliberate pick supersedes a pending Dashboard press
    explicitPickRef.current = id; // isPickShowing() lets this override the route-derived empty state
    post({ type: "planar:nav-select", id });
    const sch = projects.find((p) => p && p.id === id);
    const linked = sch && sch.linkedSiteId != null ? sch.linkedSiteId : null;
    if (linked != null && linked !== projectId) { try { onProjectChange?.(linked); } catch (_) {} }
  };

  // Pressing Dashboard is a USER action that has to move BOTH halves (B1050). Posting to the iframe
  // alone left the outer route pointing at the project, so the route-derived resolution panel stayed
  // up over the dashboard the user had just navigated to, with no way to close it. Mirror
  // selectSchedule: post AND carry the change up to the route. One-shot, not a reactive effect.
  //
  // ⛔ NEW-1 (B866xxx) — this was ALSO, silently, the shared header crumb's ENTIRE `onDashboard`
  // handler, which made "Dashboard" mean something different on Schedule than on every other
  // workspace: Library/Notes/Review all wire the Shell's `onGoDashboard` (leave the workspace,
  // go to the Site Planner map home) straight into the crumb; this function only ever clears the
  // routed project WITHIN Schedule and tells the embedded iframe to show its own reports view —
  // it never left the module. On the global `/schedule` route (already showing that internal
  // view) that made the button a genuine no-op: no navigation, no error, four presses, nothing —
  // exactly the reported repro. `goDashboardWithinModule` keeps every bit of the existing B1050
  // behavior (still needed if the user ends up back on Schedule with no project routed — the
  // iframe should already be showing its reports view, not a stale project); the crumb now ALSO
  // calls the Shell's `onGoDashboard`, so pressing it behaves identically everywhere.
  const goDashboardWithinModule = () => {
    const { post: msg, clearRoute } = dashboardNavActions({ projectId });
    if (clearRoute) dashboardIntentRef.current = true; // arm before the route write (see the carry-out effect)
    explicitPickRef.current = null; // leaving the projects section retires any standing pick
    post(msg);
    if (clearRoute) { try { onProjectChange?.(null); } catch (_) {} }
  };
  const goDashboard = () => { goDashboardWithinModule(); onGoDashboard?.(); };

  // Resolve the routed project's display NAME from the site list — NEVER the raw group_id (which
  // reads as random letters/numbers). null when the list isn't warm yet; callers treat null as
  // "not ready" and never surface or persist the id (B560).
  const routedSite = projectId != null ? (siteProjects.find((p) => p.id === projectId) || null) : null;
  const routedSiteName = routedSite ? routedSite.name : null;
  const linkedSchedule = findBySiteId(projects, projectId);

  // The breadcrumb's "current project". When the route carries a project, show THAT project — the
  // schedule linked to it, or its name as last-known-good during the ~2 s iframe boot — never the
  // iframe's transient active schedule (which may belong to a different project mid-carry-in: the
  // B560 placeholder/flash). With no routed project, the iframe's active schedule IS the current.
  //
  // NEW-2 — the ROUTE outranks the embed's section. The old order tested `section === "reports"`
  // FIRST, so whenever the embed was on its own Dashboard the crumb read "Select a project" even
  // though the URL named one — the app knowing which project you are in and saying nothing. The
  // Dashboard's genuine no-current-project state is the `projectId == null` case (pressing Dashboard
  // clears the route), which the last branch still handles.
  // ⛔ B748064 — a deliberate switcher pick WINS over the route-derived project, because it is the
  // one case the route can never represent: Operations/Pursuits aren't tied to any site, so picking
  // one can never move `projectId`. Gated on the embed actually having caught up to the pick
  // (isPickShowing), so this can't flash the OLD project's name for the one round-trip before the
  // embed reports back. See navState.js for the full story and Scheduler.jsx's own history below.
  const pickShowing = isPickShowing(explicitPickRef.current, activeId, section);

  let currentProject;
  if (pickShowing) {
    currentProject = deriveCurrentProject(projects, activeId, section);
  } else if (projectId != null) {
    currentProject = linkedSchedule || (routedSiteName ? { id: projectId, name: routedSiteName } : null);
  } else if (section === "reports") {
    currentProject = null; // Dashboard with no routed project: none is current
  } else {
    currentProject = deriveCurrentProject(projects, activeId, section);
  }

  // The Schedule tab's EMPTY STATE (NEW-2): the route points at a site that has NO linked schedule
  // yet, so there is no grid to show — we render the create/link surface INSTEAD OF the iframe
  // (hidden just below), not over it. Still gated on `ready` AND a RESOLVED name, so it never
  // flashes before the iframe reports in and never shows — or creates a schedule named — the raw
  // group_id (B560). Deliberately NOT gated on a dismissal or on the iframe's section: either one
  // could suppress the ONLY create/link entry point and strand the project (NEW-1).
  //
  // `pickShowing` overrides it (B748064): once the user's pick is genuinely active in the embed,
  // there IS something to show — a cross-cutting schedule the route can't name — so the empty
  // state must step aside instead of covering it.
  //
  // B853268/NEW-5 — gated on `toolbar.ready` too, not just `ready`. `ready` only proves the FIRST
  // nav-state (or a fallback timer) has landed; the right-hand toolbar renders from a SEPARATE
  // `planar:toolbar-state` message that can still be outstanding at that exact moment, which is
  // what painted the empty state with its toolbar and "Link an existing schedule" row missing on
  // first paint (owner repro: both reappeared only once something else forced a re-render). Both
  // signals now resolve on the same schedule (see markToolbarReadyFallback above), so this never
  // waits any longer on a slow/broken embed than `ready` alone already did.
  const iframeFullyReported = ready && toolbar.ready;
  const showEmptyState = !pickShowing && shouldShowLinkPanel({ ready: iframeFullyReported, projectId, linkedSchedule, routedSiteName });
  const suggestedMatch = showEmptyState ? suggestNameMatch(routedSiteName, projects) : null;

  // B566 — the Schedule workspace now shows the SAME unified top-right cloud sync badge as the
  // Site Planner (Row-1 right zone of AppHeader), driven by the embedded app's already-reported
  // save status, instead of a separate floppy-disk "Save" button down in the Row-2 toolbar. The
  // embedded Gantt app auto-saves to its own cloud; this only re-skins that live status. Retry on
  // a failed write is wired through onRetrySave → the embedded app's planar:save (which, in the
  // error state, re-attempts the cloud save).
  const saveState = scheduleSaveState(toolbar);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f6f8fa" }}>
      <AppHeader
        module={shellModule || "scheduler"}
        onSwitch={onShellSwitch}
        authControl={authControl}
        accountActive={accountActive}
        homeLabel="Dashboard"
        // B850 (2026-07-15, owner-reported, then owner pushed back further: "shouldn't it just
        // auto-reload... if I have it up in two tabs") — AUDIT-FIRST confirmed the Scheduler is
        // genuinely safe for two tabs, same guarantee multiEditOk exists to convey: the embedded
        // app (public/sequence/index.html) polls every 20s + on focus/reconnect/tab-switch for a
        // newer cloud version — a clean backgrounded tab reloads itself SILENTLY, a tab you're
        // looking at (or that has unsaved edits) gets a small one-click "Reload" banner instead of
        // its screen being yanked out from under it. A save that would clobber a newer version is
        // BLOCKED, never applied (the version-guard in the storage `set()`, "Layer 0"), and the
        // blocked copy is snapshotted to Version History, never silently lost. So — unlike Doc
        // Review, which genuinely enforces a single-writer lock — a second Scheduler tab was never
        // actually read-only, and the outer B313 "another tab" banner added noise, not safety: the
        // embedded app's own precise, in-context stale-version notice already covers the one real
        // case (a blocked save) with better copy than a generic cross-workspace banner ever could.
        multiEditOk
        // B566 — unified cloud save-status badge (Row-1, top-right), replacing the floppy Save
        // button. `saveState` is the embedded app's reported status mapped to the shared badge's
        // vocabulary; the loud error state's popover "Retry now" re-posts planar:save to re-attempt
        // the cloud write. The embedded app is the single source of truth — the badge only displays.
        saveState={saveState}
        onRetrySave={() => post({ type: "planar:save" })}
        // The breadcrumb drives the EMBEDDED scheduler (its own projects), not the
        // Site Planner: pick a project → switch to its Gantt; Dashboard → the reports
        // overview; New project → add one in the scheduler.
        currentProject={currentProject}
        projects={projects}
        onSelectProject={selectSchedule}
        onDashboard={goDashboard}
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
        {/* NEW-2 — while the empty state applies the iframe is HIDDEN, not covered: there is no
            grid worth showing for a project with no schedule. `visibility` (not `display`) keeps
            its layout box, so the embedded Gantt's width measurements survive and it needs no
            re-layout when it comes back; and it stays MOUNTED, so the ~2 s boot + its nav/toolbar
            bridge are never lost (the keep-alive guarantee). Clearing the routed project — what
            Dashboard does — brings it straight back. */}
        <iframe
          ref={iframeRef}
          src="/sequence/"
          title="Sequence Planyr"
          onLoad={onIframeLoad}
          aria-hidden={showEmptyState || undefined}
          style={{
            position: "absolute", inset: 0, border: "none", width: "100%", height: "100%", display: "block",
            visibility: showEmptyState ? "hidden" : "visible",
            pointerEvents: showEmptyState ? "none" : "auto",
          }}
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
        {showEmptyState && (
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
