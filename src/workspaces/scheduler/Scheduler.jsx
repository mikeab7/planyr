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
import { menuPanelStyle } from "../../shared/ui/controls.jsx";
import {
  parseNavState, deriveCurrentProject, findBySiteId, needsScheduleCarryIn,
  dashboardNavActions, shouldShowLinkPanel, shouldAdoptLinkedSiteIntoRoute, shouldNeutralizeToReports, isPickShowing,
  isGridMismatched, newProjectAction, resolveReportRowNavigation,
} from "./lib/navState.js";
import { reportClientEvent } from "../../shared/telemetry/clientErrors.js";
import { scheduleSaveState } from "./lib/saveState.js";
import { ScheduleCenter, ScheduleActions } from "./components/ScheduleToolbar.jsx";
import { listProjects, warmProjectsIfEmpty, suggestNameMatch } from "../../shared/projects/projects.js";
import { resolveControlledId } from "../../shared/projects/projectModel.js";
import LinkSchedulePanel from "./components/LinkSchedulePanel.jsx";
import NewScheduleModal from "./components/NewScheduleModal.jsx";
import ScheduleOwnerList from "./components/ScheduleOwnerList.jsx";
import ScheduleCrumb from "./components/ScheduleCrumb.jsx";
import AgendaView from "./components/AgendaView.jsx";

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
  // NEW-1 (owner report, 2026-09-15) — the Shell's own boot-resume privilege (SitePlannerApp.jsx's
  // `mayResumeLastSite`, computed once by Shell.jsx and passed uniformly to every workspace).
  // Frozen at first mount below (`bootCarryOutRef`) — see that ref's own comment for why reading
  // this live on every render would reopen the exact bug it closes.
  resumeAllowed = true,
  // The Shell passes this to every workspace as the "leave this workspace, go to the
  // Site Planner map home" action. B1128272 — Schedule wires it to the header
  // wordmark ONLY (`onLogoDashboard`), never to the breadcrumb crumb — see
  // goDashboard's own header below for why those two now do different things.
  onGoDashboard,
  // ORG SCOPE (B1020930) — the route's org flag, uniform with `projectId`/`crossProject` on
  // every other workspace. `userId` scopes the local-only agenda store per account (never
  // per project — see agendaStore.js). `onNewProject` is the same "＋ New project" the switcher
  // already wires everywhere else; org mode still offers it.
  org = false, onSelectOrg, onNewProject, userId = null,
  // B1161792 (NEW-1) — a one-shot "jump to this task" request from the Dashboard's "Needs
  // attention" card. Shell.jsx stashes it (token-stamped, same shape as `docIntent`) because the
  // Dashboard unmounts before this component does; consumed below once the iframe is ready.
  scheduleTaskIntent = null,
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
  // B851 ×4 (NEW-1) — is the grid we'd currently show CONFIRMED to belong to this iframe's most
  // recent `load`? False from the instant `onIframeLoad` fires (a fresh boot OR a silent self-reload
  // — see public/sequence/index.html's B850 background-tab reload) until a genuine `planar:nav-state`
  // message lands for THAT load. Unlike `readyRef` (a one-way latch — never show the loader twice),
  // this is re-armed on EVERY load, because the whole point is to stop the render gate from trusting
  // a BELIEF (`activeId`) that predates a reload that may have changed what the iframe is actually
  // showing. The ref is read synchronously inside `onIframeLoad`'s retry loop; the state drives the
  // render gate below.
  const navConfirmedRef = useRef(false);
  const [navConfirmed, setNavConfirmed] = useState(false);
  const setNavConfirmedBoth = useCallback((v) => { navConfirmedRef.current = v; setNavConfirmed(v); }, []);
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
  // NEW-1 — the boot-resume privilege (Shell's `resumeAllowed`), FROZEN at this component's own
  // first render via `useRef`'s initial-value argument (React ignores it on every later render).
  // Reading Shell's live `resumeAllowed` prop instead would reopen the exact bug this closes:
  // `mayResumeLastSite` only compares the CURRENT routed projectId against the app's boot-time
  // one, so when the boot itself resolved project-less (e.g. the Dashboard), it reads true again
  // any later time the live projectId cycles back to null — which is precisely "arrive at a
  // project-less Schedule route later in the session," the case being closed. Freezing it here
  // captures "was THIS mount's first render genuinely the app's boot resolution" once, and the
  // carry-out effect below spends it (sets it false) the moment it actually uses it, so even a
  // legitimate boot-time adoption never re-fires on a later revisit.
  const bootCarryOutRef = useRef(resumeAllowed);
  // The switcher pick the user last EXPLICITLY made (or null): `{ id, projectId }`, never a bare
  // id. Read by isPickShowing() below to let a deliberate pick of a cross-cutting unlinked
  // schedule (Operations/Pursuits) show its grid even on a routed project with no schedule of its
  // own — see navState.js for the full story. B1341184 — `projectId` here is the project the pick
  // BELONGS to (the schedule's own `linkedSiteId`, or the routed project at pick time for a
  // cross-cutting one), so a genuine switch to a DIFFERENT routed project invalidates the pick
  // instead of latching it forever — see isPickShowing's own header for the deadlock this fixes.
  const explicitPickRef = useRef(null);
  // ⛔ NEW-1 (B1614528 follow-up) — the route-write race: `onProjectChange` (below) writes
  // `window.location.hash` (route.js's `navigate`), and the resulting `projectId` prop only
  // updates once the hashchange event fires — a real browser task, never synchronous with and
  // never batched into the `setState` calls this same message handler already makes. Without this,
  // the very next render sees `section` already flipped to "projects" but `projectId` still the OLD
  // value, `isPickShowing` reads "not showing," and `shouldNeutralizeToReports` fires a real
  // `planar:nav-dashboard` into the one-tick gap — the bounce that clobbered the embed's own
  // just-set task selection. Set the instant a linked report-row pick calls `onProjectChange`;
  // cleared the moment the real `projectId` prop next changes (see the effect just below the nav
  // message handler) — by then either it matches (the ordinary case, and `projectId` itself is
  // authoritative from here on) or something else superseded it, and either way holding onto a
  // stale anticipated value past that point would be wrong. See navState.js's `isPickShowing`
  // header for the full mechanism.
  const pendingRouteProjectIdRef = useRef(null);
  // B1614528 — the message-listener effect below is deliberately "attach once" (see its own deps
  // comment), so it can't just list `projectId`/`onProjectChange` to stay current: `onProjectChange`
  // in particular is a fresh inline function every Shell render (Shell.jsx passes
  // `onProjectChange={(gid, meta) => {...}}` literally), so listing it would defeat the "attach
  // once" intent for no benefit. These two refs are kept fresh during render instead — the same
  // "kept current without re-subscribing" shape `bootCarryOutRef` already uses for a different prop.
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const onProjectChangeRef = useRef(onProjectChange);
  onProjectChangeRef.current = onProjectChange;
  // B1614528 — the CONFIRMED section this load last announced (never the live `section` state,
  // which can also hold an as-yet-unconfirmed value). Reset to null on every iframe load (see
  // onIframeLoad below), exactly like navConfirmedRef — see resolveReportRowNavigation's own
  // header in navState.js for why this is the one safe signal that a "reports" → "projects"
  // change is a deliberate in-iframe navigation (a Task Report row's "Open row in <project>" link)
  // rather than this load's first announcement of ambient aPid drift.
  const prevConfirmedSectionRef = useRef(null);
  // "New schedule" ASKS for a name and an owner (see NewScheduleModal's header — the old silent
  // auto-naming is what put three empty "Goose Creek (2)/(3)/(4)" schedules on production). null
  // when closed; otherwise { siteId, siteName } — the owner to PRE-SELECT, never a decision.
  const [newSchedulePrompt, setNewSchedulePrompt] = useState(null);
  // DIAGNOSTIC INSTRUMENT (not a bug fix) — B1112449/B1112450, 2026-09-03. A same-day report that
  // the multi-schedule switcher/breadcrumb still failed live on planyr.io after the fix
  // (unionProjectLists' multi-link branch) turned out to be a FALSE ALARM: the report was measured
  // in a browser tab still serving the pre-fix cached bundle, retracted once re-measured against a
  // fresh chunk hash (see BACKLOG.md / VERIFICATION.md's V613904, PASSED). Both items are confirmed
  // working on production as shipped — this instrument is NOT covering a known defect. It's kept
  // anyway because it's cheap, self-contained, and useful for any genuine future question about what
  // the embedded scheduler's bridge actually posts: it captures the RAW bridged payload the moment
  // any tab observes a site with 2+ linked schedules, so a real future report comes with ground
  // truth (exact ids/types/linkedSiteId values as posted) instead of a blind reproduction.
  // Fires once per distinct multi-link snapshot (never a spam loop) via the signature ref below.
  const multiLinkTelemetrySigRef = useRef("");

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
          // NEW-1 — true only from a REAL report, never from markToolbarReadyFallback's bare
          // `{...t, ready:true}` flip. ScheduleToolbar reserves the zoom-control block's width
          // (rather than mounting it) until this is true, so the fallback's unknown `zoomable`
          // can't cause a later real report to insert that block and shove the icon buttons
          // after it (Version history, …) sideways out from under a tap already in flight. Once
          // settled, a genuine view switch is the user's own doing and reflows normally, same as
          // before this fix.
          settled: true,
          view: m.view, section: m.section, isMobile: !!m.isMobile,
          zoomPct: Number(m.zoomPct) || 0, zoomable: !!m.zoomable,
          reviewCount: Number(m.reviewCount) || 0, reviewOpen: !!m.reviewOpen,
          saveStatus: m.saveStatus, savePulse: !!m.savePulse, fileLinked: !!m.fileLinked,
          offlineFallback: !!m.offlineFallback, // B566 — cloud-unreachable → badge shows honest "offline", not a false "synced"
          authRequired: !!m.authRequired, // B778/NEW-1 — signed-out (or not on the schedule's team)
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
      // B1614528 — capture BEFORE overwriting: was this load's last CONFIRMED section "reports"?
      // See resolveReportRowNavigation's header (navState.js) for why this is the safe signal.
      const cameFromReports = prevConfirmedSectionRef.current === "reports";
      prevConfirmedSectionRef.current = nav.section;
      // The iframe has reported since the Dashboard press — whatever it says is now the truth, so
      // the anti-ping-pong suppression has done its job (B1050).
      dashboardIntentRef.current = false;
      setProjects(nav.projects);
      setActiveId(nav.activeId);
      setSection(nav.section);
      // B851 ×4 — this IS the confirmation the render gate fail-closes on: a genuine nav-state
      // announcement for the iframe's current load has now landed, so `activeId`/`projects`/
      // `section` above are no longer a stale pre-reload belief.
      setNavConfirmedBoth(true);
      markReady();   // first nav-state ⇒ the embedded app is interactive
      // B1614528 — a genuine Task Report row click (see navState.js's own header on this function
      // for the full mechanism). Setting `explicitPickRef` here, synchronously in the same tick as
      // the setState calls above, means the re-render they cause already sees the updated pick —
      // the same ordering selectSchedule() relies on for its own explicit picks.
      const navAction = resolveReportRowNavigation({
        cameFromReports,
        projectId: projectIdRef.current,
        activeId: nav.activeId,
        linkedSiteId: (nav.projects.find((p) => p && p.id === nav.activeId) || {}).linkedSiteId ?? null,
      });
      if (navAction) {
        explicitPickRef.current = { id: navAction.activeId, projectId: navAction.linkedSiteId };
        // NEW-1 — always mirrors this pick's own `projectId` exactly (null for the unlinked/
        // cross-cutting case too), set BEFORE calling onProjectChange, so the render this same
        // tick's setState calls above trigger already reads `pendingRouteProjectIdRef.current`
        // when it computes `pickShowing` — no need to wait for the hashchange round trip that
        // adopts a linked pick into the real `projectId` prop. See this ref's own header and
        // isPickShowing's in navState.js.
        pendingRouteProjectIdRef.current = navAction.linkedSiteId;
        if (navAction.linkedSiteId != null) { try { onProjectChangeRef.current?.(navAction.linkedSiteId); } catch (_) {} }
      }
      // See multiLinkTelemetrySigRef's header above. Group the RAW (already-sanitized) list by
      // linkedSiteId; a group of 2+ is exactly the shape unionProjectLists' multi-link branch is
      // supposed to fan out into distinct switcher rows. Report the ids/types as posted (never
      // just a count) — the whole point is to catch a type or field difference no static read found.
      try {
        const bySite = new Map();
        for (const p of nav.projects) {
          if (p && p.linkedSiteId != null) {
            const key = p.linkedSiteId;
            if (!bySite.has(key)) bySite.set(key, []);
            bySite.get(key).push({ id: p.id, idType: typeof p.id, name: p.name });
          }
        }
        const multi = [...bySite.entries()].filter(([, list]) => list.length > 1);
        if (multi.length) {
          const sig = JSON.stringify(multi);
          if (sig !== multiLinkTelemetrySigRef.current) {
            multiLinkTelemetrySigRef.current = sig;
            reportClientEvent(
              "schedule-multi-link-payload",
              "site with 2+ linked schedules observed in the bridged nav-state",
              { activeId: nav.activeId, activeIdType: typeof nav.activeId, sites: multi.map(([siteId, list]) => ({ siteId, siteIdType: typeof siteId, schedules: list })) },
            );
          }
        }
      } catch (_) { /* telemetry must never throw into the app */ }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [markReady, onScheduleLinkChanged, setNavConfirmedBoth]); // all stable useCallbacks → still effectively attach-once

  // NEW-1 — once the REAL routed `projectId` prop actually changes, the anticipated value has
  // either been confirmed (the ordinary case — `projectId` itself is now authoritative and
  // `isPickShowing` no longer needs the bridge) or superseded by something else entirely, and
  // holding onto it past that point would be wrong either way. See the ref's own header above.
  useEffect(() => { pendingRouteProjectIdRef.current = null; }, [projectId]);

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
    // B851 ×4 (NEW-1) — this fires on EVERY document load the iframe element goes through, not just
    // the first: a plain browser guarantee that holds regardless of who triggered the navigation, so
    // it fires just as much for the embedded app's own silent background-tab self-reload (B850) as
    // for the initial `src="/sequence/"` load. Whatever the shell believed about the active project
    // is now UNCONFIRMED for this fresh document until it says otherwise — reset it before anything
    // else so the render gate (isGridMismatched's `navConfirmed` arg) fails closed for the whole
    // window between this load and that document's own first nav-state.
    setNavConfirmedBoth(false);
    // B1614528 — this load hasn't confirmed any section yet, so a first nav-state reporting
    // "projects" must never be mistaken for a came-from-reports transition (ambient aPid drift
    // vs. a genuine Task Report row click — see resolveReportRowNavigation's header).
    prevConfirmedSectionRef.current = null;
    let tries = 0;
    const ask = () => {
      // ⛔ Gating this on `readyRef` (whether the loader has EVER been dismissed) used to make every
      // retry after the very first load a silent no-op — exactly the gap that let a reload's nav
      // state go unrequested. Gate on THIS load's own confirmation instead, so a reload gets its own
      // fresh round of polite retries regardless of how long ago `ready` first flipped true.
      if (navConfirmedRef.current) return;
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
  }, [markReady, markToolbarReadyFallback, setNavConfirmedBoth]);

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

  // LOUD-FAILURE — the fail-closed gate above (navConfirmed) is correct to hold the iframe hidden
  // indefinitely rather than ever show an unconfirmed grid, but "indefinitely, silently" is still the
  // failure mode this repo bans. If a load never gets its nav-state confirmed (the announce is lost,
  // or the embed hangs mid-boot after a reload), surface it once per stuck load instead of leaving a
  // permanent, unexplained "switching schedule…" loader with nothing in telemetry to find it by.
  // Gated on `ready` (a one-way latch — stays true across a later reload): the ordinary FIRST boot
  // routinely takes several seconds and would otherwise fire this on every normal cold load.
  useEffect(() => {
    if (navConfirmed || !ready) return;
    const t = setTimeout(() => {
      try {
        reportClientEvent(
          "schedule-nav-unconfirmed",
          "iframe reloaded but never re-announced its nav state",
          { projectId, activeId },
        );
      } catch (_) { /* telemetry must never throw into the app */ }
    }, 8000);
    return () => clearTimeout(t);
  }, [navConfirmed, ready, projectId, activeId]);

  // Same-origin iframe, so target its exact origin (not "*").
  const post = (msg) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { source: "planar-shell", ...msg }, window.location.origin,
      );
    } catch (_) {}
  };

  // B1161792 (NEW-1) — apply a pending "jump to this task" request once the iframe is ready.
  // `scheduleTaskIntent.token` makes a repeat click on the SAME task re-fire (Shell stamps a
  // fresh token every call, same convention as `docIntent`); the ref below is what stops this
  // effect re-posting the same intent on every unrelated re-render. Gated on `siteId` matching
  // the routed `projectId` — a stale intent left over from navigating elsewhere must never fire
  // once some other project's schedule happens to become ready.
  const appliedTaskIntentRef = useRef(null);
  useEffect(() => {
    if (!ready || !scheduleTaskIntent) return;
    if (scheduleTaskIntent.token === appliedTaskIntentRef.current) return;
    if (scheduleTaskIntent.siteId !== projectId) return;
    appliedTaskIntentRef.current = scheduleTaskIntent.token;
    post({ type: "planar:nav-select-task", siteId: scheduleTaskIntent.siteId, taskId: scheduleTaskIntent.taskId });
  }, [ready, scheduleTaskIntent, projectId]);

  // Project-aware header tabs (the cross-module payoff): when the route carries a Site Planner
  // project (group_id), keep the embedded app's ACTIVE schedule pinned to the schedule linked to it,
  // so the grid always matches the crumb + route. No link yet → the embedded app ignores the post
  // and the resolution panel (below) offers create/link. The embedded handler no-ops when that
  // schedule is already active, so re-posting is harmless (it can't trigger a save).
  //
  // Picking a schedule from the breadcrumb is a USER action: switch to it, and if it's linked to a
  // site, carry that site into the route so the Site/Review tabs follow. Computed HERE (before the
  // carry-in effect below) because NEW-5's fix needs it as the carry-in's ONLY suppression signal —
  // see that effect's own note.
  //
  // NEW-1 (B1614528 follow-up) — `pendingRouteProjectIdRef.current` bridges the route-write race:
  // while a linked report-row pick's `onProjectChange` call is still in flight (the `projectId`
  // prop hasn't caught up to it yet), this lets the pick read as showing on the SAME render it was
  // recorded on, rather than one render late — see that ref's own header and isPickShowing's.
  const pickShowing = isPickShowing(explicitPickRef.current, activeId, section, projectId, pendingRouteProjectIdRef.current);

  // SELF-HEALING (B851 — the route↔grid divergence): this is a RE-DRIVE, not a fire-once. The
  // original one-shot (deps `[ready, projectId]`) posted the select a single time when `ready`
  // flipped; when `ready` flips via the fallback timer (onIframeLoad's 2.5s / the 6s backstop)
  // BEFORE the embed's ~230 KB hs-v1 cloud data has loaded, the embed DROPS that select (its
  // B644 null-data guard) and it was never retried — stranding the grid on the embed's
  // previously-active schedule while the crumb correctly named the routed one (owner repro
  // 2026-07-15: route Goose Creek, grid Grand Port). Re-running on `projects`/`activeId` means the
  // dropped select is re-posted the moment the embed's data lands, and keeps re-driving until the
  // grid ADOPTS the routed link.
  //
  // ⛔ NEW-5 (B1080544) — THIS EFFECT USED TO LATCH (`carriedRef`) THE FIRST TIME IT SUCCEEDED AND
  // NEVER RE-ARM FOR THE SAME ROUTED PROJECT. `aPid` (which schedule the embed shows) is a single
  // GLOBAL, MUTABLE field in the shared hs-v1 blob — not scoped to this tab or this route — so once
  // ANYTHING else moved it away (a second tab, a stale reconciliation) the latch silently refused to
  // re-correct it: the grid kept showing a WRONG project's tasks while the route-derived breadcrumb
  // kept reading correctly. Reproduced live: routed on Richfield, `aPid` reading Pappadoupolos — the
  // breadcrumb said Richfield, the grid rendered Pappadoupolos's 41 tasks. The latch's real intent
  // (never yank back a DELIBERATE pick of a cross-cutting unlinked schedule — Pursuits/Operations)
  // is already correctly tracked by `pickShowing`/`explicitPickRef`, so that's now the ONLY
  // suppression: this effect re-drives on every genuine mismatch, forever, not once. The render gate
  // below (`gridMismatched`) is the other half — it makes any remaining mismatch INVISIBLE rather
  // than merely quickly corrected, so the fix holds even if something re-drifts `aPid` again later.
  useEffect(() => {
    if (!ready || projectId == null) return;
    if (pickShowing) return; // a deliberate cross-cutting pick stands; never yanked back
    if (!needsScheduleCarryIn(projects, projectId, activeId, section)) return;
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
  }, [ready, projectId, projects, activeId, section, pickShowing]);

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
    if (!shouldAdoptLinkedSiteIntoRoute({
      isActive, section, projectId, dashboardIntent: dashboardIntentRef.current, bootCarryOutAllowed: bootCarryOutRef.current,
    })) return;
    const cur = deriveCurrentProject(projects, activeId, section);
    const linked = cur && cur.linkedSiteId != null ? cur.linkedSiteId : null;
    if (linked != null) {
      try { onProjectChange?.(linked); } catch (_) {}
      // NEW-1 — the boot privilege is spent the instant it's actually used, exactly like
      // `userLeftProjectRef` elsewhere in this app: it authorises ONE resume, not a standing
      // license to keep silently re-adopting whatever the iframe shows on every later revisit.
      bootCarryOutRef.current = false;
    }
  }, [projects, activeId, section, projectId, onProjectChange, isActive]);

  // NEW-1 — the honest counterpart to the carry-out effect above. The route is project-less, this
  // ISN'T the app's boot-resume window (bootCarryOutRef spent or never granted), and the iframe is
  // still showing SOME specific project's grid — its own persisted, account-wide `aPid`, left over
  // from an earlier visit that may not even be THIS tab or session. Leaving it on screen would show
  // a project the breadcrumb (correctly, now) says was never chosen — a crumb/grid mismatch, and
  // exactly the "takes me to the wrong place" report this whole fix answers. Tell the iframe to
  // show its own neutral, cross-project Dashboard (reports) view instead, matching the Site
  // Planner's own "Select a project" state for "nothing chosen."
  //
  // ⛔ B1644368 (NEW-1 amendment, 2026-09-15) — A SINGLE POST WAS NEVER ENOUGH. This effect's only
  // firing is the render right after mount, while `section` still holds its default ("projects") —
  // before the iframe's OWN document has loaded and attached its message listener, so the very
  // first (and only) `planar:nav-dashboard` post is reliably lost, the exact race `onIframeLoad`'s
  // own `ask()` retry loop already guards against for `nav-request`. And because `setSection(nav.
  // section)` is a no-op once the embed's first real report already reads "projects" (React bails a
  // `useState` update that doesn't change the value), this effect's own deps never see a second
  // change to re-fire it — so a lost first post was NEVER retried, and the iframe stayed on its
  // stale, fully-visible-and-clickable ambient project indefinitely. Retry it the same way
  // `onIframeLoad` retries `nav-request` (a few polite tries over ~2.3s); it naturally stops the
  // moment a real nav-state confirms "reports" (the gate above then reads false and the effect's own
  // cleanup already cleared the interval on the re-run).
  //
  // ⛔ B1614528 — `pickShowing` is now a required suppression too. A Task Report row click on a
  // schedule with NO linked site (Pursuits/Operations) is recorded as a cross-cutting pick with a
  // still-project-less route — legitimate, not drift — and this effect must not drag it back to
  // "reports" the instant it's set. See resolveReportRowNavigation (navState.js) for the full story.
  useEffect(() => {
    if (!shouldNeutralizeToReports({
      isActive, section, projectId, dashboardIntent: dashboardIntentRef.current, bootCarryOutAllowed: bootCarryOutRef.current, pickShowing,
    })) return;
    post({ type: "planar:nav-dashboard" });
    let tries = 0;
    const t = setInterval(() => {
      if (++tries >= 6) { clearInterval(t); return; }
      post({ type: "planar:nav-dashboard" });
    }, 380);
    return () => clearInterval(t);
  }, [isActive, section, projectId, pickShowing]);

  // Picking a schedule from the breadcrumb is a USER action: switch to it, and if it's linked to a
  // site, carry that site into the route so the Site/Review tabs follow. One-shot (not a reactive
  // effect), so it can't loop with the carry-in.
  //
  // ⛔ B881666 — `id` may name either one of THIS module's own schedules or a shared-header
  // switcher ROW that is a site-registry entry for a linked project (unionProjectLists prefers
  // that richer, timestamped row over this module's own bridged copy when exactly ONE schedule
  // covers it — see its own header). A registry row's id is the site GROUP id, not a schedule id,
  // so resolve it back to the linked schedule before posting into the iframe (which only knows
  // its own schedule ids) or latching `explicitPickRef` (which `isPickShowing` compares against
  // the iframe's OWN reported activeId).
  //
  // ⛔ B1112449/NEW-2 — a bare site id is ambiguous once a site carries MULTIPLE linked schedules
  // (unionProjectLists now gives each of those its own row with its own real schedule id, so the
  // switcher itself never produces this case anymore — but a bare site id can still reach here
  // from any other caller). `.find()`'s old "always the first-created" answer would silently snap
  // an already-active OTHER schedule of the same site back to the first one on every unrelated
  // re-render path that happens to call this with the site id — the exact "switching between two
  // schedules of the same site doesn't stick" failure. Prefer whichever of the site's schedules is
  // ALREADY active over always picking the first, so a genuinely ambiguous id is at least a
  // STABLE (never-regressing) choice rather than an arbitrary one.
  const selectSchedule = (id) => {
    // B1358128 — this resolution (a registry-standin site id → its one linked schedule) now
    // lives in projectModel.js's resolveControlledId, shared with ProjectBreadcrumb.jsx's own
    // rename/delete/duplicate handlers, which needed the identical logic and never had it.
    const resolvedId = resolveControlledId(projects, id, activeId);
    const sch = resolvedId != null ? projects.find((p) => p && p.id === resolvedId) : null;
    if (!sch) return; // an id this module cannot resolve at all — nothing to switch to
    dashboardIntentRef.current = false; // a deliberate pick supersedes a pending Dashboard press
    const linked = sch.linkedSiteId != null ? sch.linkedSiteId : null;
    // B1341184 — record which project this pick BELONGS to (the schedule's own link, or the
    // currently routed project for a cross-cutting one), so isPickShowing() stops honoring it the
    // instant the routed project genuinely changes to something else. A bare schedule id here is
    // what let the pick latch forever regardless of later project switches — see that fix's header.
    explicitPickRef.current = { id: sch.id, projectId: linked != null ? linked : projectId };
    // NEW-1 — a fresh, unrelated pick must never inherit a stale bridge left over from an earlier
    // report-row navigation (see pendingRouteProjectIdRef's own header); this pick has its own
    // `onProjectChange` call just below if it needs one, and isPickShowing falls back to the real
    // `projectId` prop once this is cleared.
    pendingRouteProjectIdRef.current = null;
    post({ type: "planar:nav-select", id: sch.id });
    if (linked != null && linked !== projectId) { try { onProjectChange?.(linked); } catch (_) {} }
  };

  // B1404352 — rename/delete a SCHEDULE directly, from the "Schedules" panel's own row. Unlike the
  // breadcrumb's onRenameProject/onDeleteProject above (which resolve a switcher row through
  // resolveControlledId because that row's id might be a registry site-standin), ScheduleOwnerList
  // always hands back a real schedule id straight from the bridged list, so no resolution step is
  // needed — post it to the embedded app exactly as the breadcrumb already does for the one
  // schedule it can reach.
  const renameSchedule = (id, name) => post({ type: "planar:nav-rename", id, name });
  const deleteSchedule = (id) => post({ type: "planar:nav-delete", id });

  // Pressing Dashboard is a USER action that has to move BOTH halves (B1050). Posting to the iframe
  // alone left the outer route pointing at the project, so the route-derived resolution panel stayed
  // up over the dashboard the user had just navigated to, with no way to close it. Mirror
  // selectSchedule: post AND carry the change up to the route. One-shot, not a reactive effect.
  //
  // ⛔ NEW-1 (B866xxx) added a call to the Shell's `onGoDashboard` (leave the workspace, go to the
  // Site Planner map home) here too, reasoning that Library/Notes/Review all wire it straight into
  // the shared header crumb and Schedule should be no different. That reasoning held for those three
  // modules — none of them has a dashboard of its own, so for them "Dashboard" can only mean "leave"
  // — but it does NOT hold for Schedule, which DOES have its own dashboard (the embedded app's
  // reports view). One press then fired TWO navigations (this function's own route-clear + iframe
  // post, AND the Shell's "leave" route change), and the second one usually won the race — the
  // "often takes me back to the map" report (B1128272). `goDashboardWithinModule` still keeps every
  // bit of the original B1050 behavior; it is now the crumb's ENTIRE action, never followed by
  // `onGoDashboard`. The wordmark keeps the "leave this workspace" job — see `onLogoDashboard` on
  // the AppHeader call below.
  const goDashboardWithinModule = () => {
    const { post: msg, clearRoute } = dashboardNavActions({ projectId });
    if (clearRoute) dashboardIntentRef.current = true; // arm before the route write (see the carry-out effect)
    explicitPickRef.current = null; // leaving the projects section retires any standing pick
    pendingRouteProjectIdRef.current = null; // NEW-1 — retires any in-flight bridge along with it
    post(msg);
    if (clearRoute) { try { onProjectChange?.(null); } catch (_) {} }
  };
  const goDashboard = () => { goDashboardWithinModule(); };

  // Resolve the routed project's display NAME from the site list — NEVER the raw group_id (which
  // reads as random letters/numbers). null when the list isn't warm yet; callers treat null as
  // "not ready" and never surface or persist the id (B560).
  const routedSite = projectId != null ? (siteProjects.find((p) => p.id === projectId) || null) : null;
  const routedSiteName = routedSite ? routedSite.name : null;
  const linkedSchedule = findBySiteId(projects, projectId);

  // B1435888 ("Schedule access: project and schedule become two separate breadcrumb levels") —
  // the breadcrumb's Row-1 PROJECT crumb is now a plain, route-driven project identity, exactly
  // like every other workspace's — never a schedule standing in for it (the old
  // `activeLinkedSchedule || …` fallback this replaced). It no longer needs to reconcile against
  // the embed's transient `activeId`/section at all: `ScheduleCrumb` (planSlot, below) is the
  // SECOND, independent crumb that shows which schedule is open, so this one only ever answers
  // "which project". `pickShowing`/`deriveCurrentProject` stay in use elsewhere (the empty-state
  // and grid-mismatch render gates) — see their own call sites further down.
  const currentProject = projectId != null && routedSiteName ? { id: projectId, name: routedSiteName } : null;

  // NEW-5 (B1080544) — the render gate: a routed project WITH a linked schedule whose grid hasn't
  // (yet, or any longer) caught up must never be visibly shown as if it had. `showEmptyState`
  // covers "no schedule exists"; this covers "a schedule exists but the wrong one is on screen" —
  // the case a global `aPid` drifting away from the route produces. See navState.js's own header.
  // B851 ×4 (NEW-1) — `navConfirmed` closes the gap the prior three fixes left: without it, this
  // gate trusted `activeId` even across an iframe reload the shell hadn't yet heard back from, so a
  // stale-but-still-matching belief read as "fine" while the reloaded document was already showing a
  // different project underneath. See navState.js's isGridMismatched header for the full mechanism.
  // B1644368 (NEW-1 amendment) — `section` is now part of the answer too: a PROJECT-LESS route is
  // matched only once the grid confirms it switched to its own neutral reports view, never by
  // default. Without this a stranger project's grid stayed fully visible AND clickable under an
  // honestly-empty breadcrumb — see navState.js's own header on this function for the live repro.
  // Computed here, ABOVE `showScheduleCrumb` (moved up from its old spot further down), because
  // that crumb now reads it too — see that const's own note on why.
  const gridMismatched = ready && isGridMismatched(projects, projectId, activeId, pickShowing, navConfirmed, section);

  // B1435888 — the SCHEDULE crumb (ScheduleCrumb, wired as `planSlot` below) renders whenever the
  // embed is on its own projects section (never on its Dashboard/"reports" view, which has no
  // schedule open) and has reported in at least once — so it never flashes "Select a schedule"
  // during the ~2 s boot window `ready` already covers everywhere else in this file.
  //
  // ⛔ B1644368 (NEW-1 amendment, 2026-09-15) — AND `!gridMismatched`, closing the self-contradicting
  // breadcrumb the dispatch reported verbatim: "Select a project / Master Schedule" in the SAME
  // trail. `activeId` below is the iframe's OWN belief — exactly the value `gridMismatched` can
  // already prove is wrong (a foreign/stale schedule, or an unconfirmed load) — and this crumb used
  // to name it regardless, independent of whether the grid underneath was even being shown. That
  // let the SCHEDULE crumb read a real project's schedule name while the PROJECT crumb honestly read
  // "Select a project," and while the grid itself sat hidden behind `gridMismatched`'s own loader —
  // a shorter-lived but still-real instance of the identical contradiction, not merely on a
  // project-less route but on ANY unconfirmed/mismatched grid, including the pre-existing routed
  // case B1080544 never closed this half of. Once the grid is confirmed correct (or a deliberate
  // pick is showing, via `pickShowing` inside `gridMismatched`), this crumb resumes exactly as before.
  const showScheduleCrumb = ready && section === "projects" && !gridMismatched;

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

  // ORG SCOPE (B1020930) — a wholly separate render branch, never the embedded iframe. Every
  // hook above this line still runs (React's rules require it), but none of their effects can
  // do anything: `iframeRef.current` stays null forever because the <iframe> below is simply
  // never rendered on this path, so the postMessage bridge sits idle rather than being touched
  // or restructured — "if you find yourself editing the scheduler, stop" is honored by never
  // reaching the scheduler's own code at all on this branch, not by editing it carefully.
  if (org) {
    return (
      <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "var(--surface-page)" }}>
        <AppHeader
          module={shellModule || "scheduler"}
          onSwitch={onShellSwitch}
          authControl={authControl}
          accountActive={accountActive}
          homeLabel="Dashboard"
          org
          onSelectOrg={onSelectOrg}
          // Uncontrolled here (no `projects=` prop) — ProjectBreadcrumb self-loads the real
          // Site Planner project list via listProjects(), exactly like Library/Notes at org
          // scope. The Schedule module's OWN bridged project list (`projects` state above) is
          // meaningless at org scope — it belongs to the walled iframe, which isn't mounted.
          onSelectProject={(id) => onProjectChange?.(id)}
          onDashboard={onGoDashboard}
          // NEW-3 (amendment to B1128272) — at org scope there is no in-module dashboard for the
          // crumb to point at (no routed project exists here; AgendaView already IS the whole
          // org-wide view), so the wordmark and the crumb legitimately do the SAME thing — matching
          // Library's and Notes' own wiring, both bare `onDashboard={onGoDashboard}` with no split.
          // What was actually stale: with neither `logoDashboardTitle` nor `dashboardTitle`
          // supplied, the two controls fell back to dashboardNav.js's own two DIFFERENT default
          // strings (see that module's header) — the exact near-identical, confusing wording
          // B1128272's own body named when it fixed the PROJECT-scope case. Since both controls
          // here provably do the identical thing (leave Schedule for the Dashboard), both
          // get the SAME explicit tooltip, in the wordmark's already-established project-scope wording.
          // B1213312 — reworded from "go to the Site Planner map": that stopped being where the
          // wordmark leads once the Dashboard became a real, separate destination.
          logoDashboardTitle="Leave Schedule — go to the Dashboard"
          dashboardTitle="Leave Schedule — go to the Dashboard"
          onNewProject={onNewProject}
        />
        <AgendaView scope={userId || "local"} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f6f8fa" }}>
      <AppHeader
        module={shellModule || "scheduler"}
        onSwitch={onShellSwitch}
        authControl={authControl}
        accountActive={accountActive}
        // NEW-2/NEW-3 (owner report, 2026-09-15) — this crumb is NOT the app's real Dashboard
        // (`onDashboard` below is wired to the in-module reports view, `goDashboard`, never
        // `onGoDashboard`) — labeling it "Dashboard" anyway is exactly what made it read as landing
        // "in the wrong place" (it visibly reads the same as Review/Library/Notes/Spreadsheet's
        // leading crumb, which DOES leave to the real Dashboard). Same rule this app already
        // applies to Site's own leading crumb ("Map", not "Dashboard", because it also leads
        // somewhere other than the real Dashboard): the label must match the real destination.
        // The wordmark is unaffected — it already reads no label text and already goes to the real
        // Dashboard (`onLogoDashboard={onGoDashboard}` below).
        homeLabel="Reports"
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
        // B1435888 — the PROJECT crumb is now a genuine, uncontrolled Site Planner project
        // switcher (no `projects=` prop), exactly like Library/Notes/Review at project scope:
        // its dropdown lists real projects ONLY, never a schedule. Picking one switches the
        // routed project via `onProjectChange` — the existing carry-in effect above then
        // opens that site's last-active (or first-linked) schedule automatically, the same
        // mechanism that already runs when you arrive on Schedule from another workspace.
        // Rename/Delete fall back to the uncontrolled site-store path (renaming/deleting the
        // real project, correctly, for the first time from this module — see B1358128's note in
        // ProjectBreadcrumb.jsx on why the OLD bridged handlers here only ever touched a
        // schedule and silently left the project itself untouched).
        currentProject={currentProject}
        onSelectProject={(id) => onProjectChange?.(id)}
        onDashboard={goDashboard}
        // B1128272 — the wordmark stays the way OUT of Schedule (onGoDashboard, same as
        // every other module); the crumb above it stays IN Schedule (goDashboard, its
        // own reports view). Distinct tooltips say so in plain words rather than
        // leaving the owner to click either one to find out which does what.
        onLogoDashboard={onGoDashboard}
        // B1213312 — reworded from "go to the Site Planner map": see the org-scope branch above.
        logoDashboardTitle="Leave Schedule — go to the Dashboard"
        dashboardTitle="Schedule dashboard — reports for every project"
        // "+ New project" now creates a genuine new SITE project — the same action every other
        // workspace's breadcrumb offers (the org-scope branch below already used this). Creating
        // a SCHEDULE moved to the new schedule crumb's own "+ New schedule in <project>" row.
        onNewProject={onNewProject}
        // B1435888 — the SCHEDULE crumb: a SECOND, independent breadcrumb level (planSlot — the
        // same mechanism the Site Planner uses for its own Project/Plan pair), scoped to this
        // project's own schedules + the Organization. Never collapsed into the project crumb
        // above it, even when a schedule shares its project's name.
        planSlot={showScheduleCrumb ? (
          <ScheduleCrumb
            schedules={projects}
            // B1341184 — while the empty state applies (this project owns no schedule of its own,
            // and there's no deliberate cross-cutting pick standing), the embed's `activeId` still
            // names whatever OTHER project's schedule happened to be open last — the shell has
            // nowhere to switch it to. Never let the crumb read that foreign schedule's name; fall
            // back to ScheduleCrumb's own "Select a schedule" label, matching the empty state
            // rendered below it.
            activeId={showEmptyState ? null : activeId}
            siteId={projectId}
            siteName={routedSiteName}
            onSelect={selectSchedule}
            // "+ New schedule" opens the New-schedule dialog — it never creates anything by
            // itself. It used to: standing on a project it auto-named the new schedule after
            // that project and appended "(2)", "(3)", "(4)" on a collision, which is exactly how
            // three empty duplicate schedules reached production with no prompt at any point.
            // The dialog PRE-FILLS the name and PRE-SELECTS the owner (this project, or the
            // Organization when none is routed) and lets him change both. See newProjectAction's
            // and NewScheduleModal's own headers.
            onCreate={() => setNewSchedulePrompt(newProjectAction({ projectId, routedSiteName }))}
            // Rename/delete/duplicate a SCHEDULE (B440/B1080546) — bridged to the embedded app's
            // own hs-v1 record. The row already confirms the delete inline, so the embedded
            // handler deletes without re-prompting + routes home on the active schedule.
            onRename={renameSchedule}
            onDelete={deleteSchedule}
            onDuplicate={(id) => post({ type: "planar:nav-duplicate", id })}
          />
        ) : null}
        // B388 — the embedded app's toolbar, lifted into the unified header (center = view +
        // review; right = zoom/export/save/history/contacts/automation/format/settings).
        // NEW-1 — the "Schedules" switcher this used to also carry (schedules/activeId/siteId/
        // siteName/onSelectSchedule/onCreateSchedule/onRenameSchedule/onDeleteSchedule) was
        // REMOVED: the Row-1 breadcrumb's schedule crumb (ScheduleCrumb, below) now owns that job.
        toolbarCenter={<ScheduleCenter toolbar={toolbar} post={post} />}
        toolbarContent={<ScheduleActions toolbar={toolbar} post={post} />}
      />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {/* NEW-2 — while the empty state applies the iframe is HIDDEN, not covered: there is no
            grid worth showing for a project with no schedule. `visibility` (not `display`) keeps
            its layout box, so the embedded Gantt's width measurements survive and it needs no
            re-layout when it comes back; and it stays MOUNTED, so the ~2 s boot + its nav/toolbar
            bridge are never lost (the keep-alive guarantee). Clearing the routed project — what
            Dashboard does — brings it straight back.
            NEW-5 (B1080544) — ALSO hidden while `gridMismatched`: the grid is showing a schedule
            that isn't the routed project's own (a stale/foreign `aPid`), and that must never be
            visible even for one frame — see isGridMismatched's header. The carry-in effect above
            is actively re-driving it; this is what keeps the wrong picture off screen meanwhile. */}
        <iframe
          ref={iframeRef}
          src="/sequence/"
          title="Sequence Planyr"
          onLoad={onIframeLoad}
          aria-hidden={showEmptyState || gridMismatched || undefined}
          style={{
            position: "absolute", inset: 0, border: "none", width: "100%", height: "100%", display: "block",
            visibility: (showEmptyState || gridMismatched) ? "hidden" : "visible",
            pointerEvents: (showEmptyState || gridMismatched) ? "none" : "auto",
          }}
        />
        {(showLoader || (!showEmptyState && gridMismatched)) && (
          <div
            aria-hidden={ready && !gridMismatched}
            style={{
              position: "absolute", inset: 0, zIndex: 5,
              opacity: (ready && !gridMismatched) ? 0 : 1,
              transition: "opacity 0.45s ease",
              pointerEvents: (ready && !gridMismatched) ? "none" : "auto",
            }}
          >
            <ModuleLoader module="scheduler" />
          </div>
        )}
        {/* The empty state (LinkSchedulePanel) AND which schedules this project owns
            (ScheduleOwnerList — a project with none of its own can still reach the Organization's,
            see that component's own header) are ONE scrollable region now, not two independently
            absolutely-positioned overlays.
            B1482096 (regression correction) — the original corner-text fix gave the owner list its
            own surface but kept it as a SEPARATE `position:absolute, bottom:0` sibling stacked over
            LinkSchedulePanel's own full-bleed box. Neither overlay could see the other's height, so
            on a short window the owner-list panel simply overlaid LinkSchedulePanel's Create/Link
            buttons — measured live, "Link an existing schedule" became unclickable
            (`elementFromPoint` resolved to the panel, not the button) — and the panel itself still
            ran off the bottom with no way to reach it. Fixed by making this ONE full-bleed
            `overflow:"auto"` shell (this div) whose only job is to scroll, containing a plain flex
            COLUMN that centers vertically when everything fits and simply grows (and scrolls) when
            it doesn't — LinkSchedulePanel first, the owner-list panel second, true document flow so
            they stack instead of overlapping at any viewport height. The owner-list panel keeps the
            same `menuPanelStyle` surface token the breadcrumb's own dropdown uses (ScheduleCrumb.jsx
            via AnchoredMenu) so the two read as one consistent list style — that part of the
            original fix is unchanged; only the layout that combines it with the empty state moved.
            Once a schedule IS loaded (showEmptyState false), none of this renders — the identical
            list is reachable instead from the Row-1 breadcrumb's schedule crumb. */}
        {showEmptyState && (
          <div
            data-testid="schedule-empty-shell"
            style={{
              position: "absolute", inset: 0, zIndex: 6, overflow: "auto",
              background: "var(--surface-page)", color: "var(--text-primary)",
            }}
          >
            <div
              style={{
                boxSizing: "border-box", minHeight: "100%",
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                gap: 24, padding: "24px",
              }}
            >
              <LinkSchedulePanel
                siteName={routedSiteName}
                schedules={projects}
                suggestedMatch={suggestedMatch}
                // Creating from the empty state goes through the SAME dialog as "+ New schedule" —
                // a project with no schedule is the one case where auto-naming was defensible
                // (there is nothing to collide with), but routing it separately is how two creation
                // paths drift apart, and only one of them would then require an owner.
                onCreate={() => setNewSchedulePrompt({ type: "prompt", siteId: projectId, siteName: routedSiteName })}
                onLink={(scheduleId) => post({ type: "planar:nav-link", id: scheduleId, siteId: projectId, siteName: routedSiteName })}
              />
              <div style={{ ...menuPanelStyle, width: "min(360px, 100%)" }}>
                <ScheduleOwnerList
                  schedules={projects}
                  activeId={activeId}
                  siteId={projectId}
                  siteName={routedSiteName}
                  onSelect={selectSchedule}
                  onRename={renameSchedule}
                  onDelete={deleteSchedule}
                />
              </div>
            </div>
          </div>
        )}
        {newSchedulePrompt && (
          <NewScheduleModal
            schedules={projects}
            siteProjects={siteProjects}
            defaultSiteId={newSchedulePrompt.siteId}
            defaultSiteName={newSchedulePrompt.siteName}
            onClose={() => setNewSchedulePrompt(null)}
            onCreate={({ name, ownerKind, siteId, siteName }) => {
              setNewSchedulePrompt(null);
              // One create message for both owners: an org-owned schedule simply carries no site.
              post({ type: "planar:nav-create-linked", name, ownerKind, siteId, siteName });
            }}
          />
        )}
      </div>
    </div>
  );
}
