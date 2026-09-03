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
  parseNavState, deriveCurrentProject, findBySiteId, findAllBySiteId, needsScheduleCarryIn,
  dashboardNavActions, shouldShowLinkPanel, shouldAdoptLinkedSiteIntoRoute, isPickShowing,
  isGridMismatched, newProjectAction,
} from "./lib/navState.js";
import { reportClientEvent } from "../../shared/telemetry/clientErrors.js";
import { scheduleSaveState } from "./lib/saveState.js";
import { ScheduleCenter, ScheduleActions } from "./components/ScheduleToolbar.jsx";
import { listProjects, warmProjectsIfEmpty, suggestNameMatch } from "../../shared/projects/projects.js";
import LinkSchedulePanel from "./components/LinkSchedulePanel.jsx";
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
  // NEW-1 (B866xxx) — the Shell passes this to every workspace so the shared header's Dashboard
  // crumb always means the same thing (leave this workspace, go to the Site Planner map home).
  // Scheduler used to receive it and never read it — see goDashboard's own header below.
  onGoDashboard,
  // ORG SCOPE (B1020930) — the route's org flag, uniform with `projectId`/`crossProject` on
  // every other workspace. `userId` scopes the local-only agenda store per account (never
  // per project — see agendaStore.js). `onNewProject` is the same "＋ New project" the switcher
  // already wires everywhere else; org mode still offers it.
  org = false, onSelectOrg, onNewProject, userId = null,
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
  // The switcher id the user last EXPLICITLY picked (or null). Read by isPickShowing() below to
  // let a deliberate pick of a cross-cutting unlinked schedule (Operations/Pursuits) show its grid
  // even on a routed project with no schedule of its own — see navState.js for the full story.
  const explicitPickRef = useRef(null);
  // ⛔ B1112449/B1112450 ×2 (NEW-1, 2026-09-03) — owner-verified live that the switcher still shows
  // one row and the breadcrumb still doesn't disambiguate for a site with two linked schedules,
  // AFTER the fix that should cover it merged (unionProjectLists' multi-link branch). Every static
  // read of unionProjectLists/ProjectBreadcrumb/this bridge traces correctly, and a live e2e drive
  // of the REAL Scheduler→AppHeader→ProjectBreadcrumb chain (e2e/scheduler-multi-schedule-switcher.spec.js)
  // posting the EXACT shape the owner's production row held — two entries, matching linkedSiteId,
  // both string/number types as minted — renders two rows and a disambiguated crumb correctly. So
  // the defect, if it's still live, is in data this sandbox cannot produce (no live signed-in
  // browser reaches planyr.io from here) — DANGEROUS-MEANS-UNOBSERVABLE: the honest fix is the
  // missing instrument, not another guess. This captures the RAW bridged payload the very next time
  // any tab observes a site with 2+ linked schedules, so a recurrence report comes with ground
  // truth (exact ids/types/linkedSiteId values as posted) instead of another blind reproduction.
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
  const pickShowing = isPickShowing(explicitPickRef.current, activeId, section);

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
    if (!shouldAdoptLinkedSiteIntoRoute({ isActive, section, projectId, dashboardIntent: dashboardIntentRef.current })) return;
    const cur = deriveCurrentProject(projects, activeId, section);
    const linked = cur && cur.linkedSiteId != null ? cur.linkedSiteId : null;
    if (linked != null) { try { onProjectChange?.(linked); } catch (_) {} }
  }, [projects, activeId, section, projectId, onProjectChange, isActive]);

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
    let sch = projects.find((p) => p && p.id === id);
    if (!sch) {
      const linked = findAllBySiteId(projects, id);
      sch = linked.find((p) => p.id === activeId) || linked[0] || null;
    }
    if (!sch) return; // an id this module cannot resolve at all — nothing to switch to
    dashboardIntentRef.current = false; // a deliberate pick supersedes a pending Dashboard press
    explicitPickRef.current = sch.id; // isPickShowing() lets this override the route-derived empty state
    post({ type: "planar:nav-select", id: sch.id });
    const linked = sch.linkedSiteId != null ? sch.linkedSiteId : null;
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
  // B1112450/NEW-3 — when the routed site carries MORE than one linked schedule (B1080547), the
  // crumb must name the ACTIVE one, not always the first-linked. `linkedSchedule` above (the
  // FIRST match) is exactly what the breadcrumb used to show regardless of which schedule was
  // actually on screen — the "crumb says Richfield, grid shows Richfield (2)" ambiguity B851
  // exists to prevent, reintroduced here by B1080547 shipping without this. A site with exactly
  // one linked schedule is unaffected: `activeLinkedSchedule` is just `linkedSchedule` again.
  const linkedSchedules = findAllBySiteId(projects, projectId);
  const activeLinkedSchedule = linkedSchedules.length > 1
    ? (linkedSchedules.find((p) => p.id === activeId) || linkedSchedule)
    : linkedSchedule;

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
  // (`pickShowing` itself is computed once, near the top of this component — see its own note.)

  let currentProject;
  if (pickShowing) {
    currentProject = deriveCurrentProject(projects, activeId, section);
  } else if (projectId != null) {
    currentProject = activeLinkedSchedule || (routedSiteName ? { id: projectId, name: routedSiteName } : null);
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

  // NEW-5 (B1080544) — the render gate: a routed project WITH a linked schedule whose grid hasn't
  // (yet, or any longer) caught up must never be visibly shown as if it had. `showEmptyState`
  // covers "no schedule exists"; this covers "a schedule exists but the wrong one is on screen" —
  // the case a global `aPid` drifting away from the route produces. See navState.js's own header.
  // B851 ×4 (NEW-1) — `navConfirmed` closes the gap the prior three fixes left: without it, this
  // gate trusted `activeId` even across an iframe reload the shell hadn't yet heard back from, so a
  // stale-but-still-matching belief read as "fine" while the reloaded document was already showing a
  // different project underneath. See navState.js's isGridMismatched header for the full mechanism.
  const gridMismatched = ready && isGridMismatched(projects, projectId, activeId, pickShowing, navConfirmed);

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
        // NEW-1 (B1080545) — while routed on a Planyr project, "+ New project" must create a
        // SCHEDULE FOR THAT PROJECT (linked + named after it, disambiguated if it already has
        // one — NEW-3), never a bare unlinked "Project N" the route can never reach again. See
        // newProjectAction's own header. Outside a routed project the generic unlinked creation
        // (Operations/Pursuits-style) is unchanged.
        onNewProject={() => {
          const action = newProjectAction({ projectId, routedSiteName, projects });
          post(action.type === "create-linked"
            ? { type: "planar:nav-create-linked", name: action.name, siteId: action.siteId, siteName: action.siteName }
            : { type: "planar:nav-new" });
        }}
        // Rename/delete a SCHEDULE project (B440) — bridged to the embedded app's own hs-v1
        // record (not the Site store). The breadcrumb already confirmed the delete inline, so
        // the embedded handler deletes without re-prompting + routes home on the active project.
        onRenameProject={(id, name) => post({ type: "planar:nav-rename", id, name })}
        onDeleteProject={(id) => post({ type: "planar:nav-delete", id })}
        // NEW-2 (B1080546) — deep-copy a schedule's tasks into a new, distinctly-named project.
        // Bridged to the embedded app's existing `duplicateProject` (already correct: strips the
        // source's linkedSiteId/linkedSiteName rather than silently attaching the copy to a live
        // Planyr project — the owner's standing rule that he decides when things are linked).
        onDuplicateProject={(id) => post({ type: "planar:nav-duplicate", id })}
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
