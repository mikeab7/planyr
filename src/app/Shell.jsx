/* App shell — the top-level surface that hosts each workspace. The shared
 * two-row AppHeader is now rendered by each workspace (so it has access to
 * workspace-specific toolbar content). The shell's job is auth, module
 * switching state, and building the auth-control slot that AppHeader needs.
 */
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { supabaseConfigured } from "../workspaces/site-planner/lib/supabase.js";
import { onAuthChange } from "../workspaces/site-planner/lib/auth.js";
// B927105 — this is the ONLY storage-adjacent thing the shell needs at boot, and it's a
// genuinely tiny leaf (no siteModel.js/cloudSync.js imports), so it's a plain static import —
// see the note beside its call site below for what this replaced and why.
import { setActiveUser } from "../workspaces/site-planner/lib/activeUser.js";
import AuthPanel from "../workspaces/site-planner/components/AuthPanel.jsx";
import ErrorBoundary from "./ErrorBoundary.jsx";
import ModuleLoader from "../shared/ui/ModuleLoader.jsx";
import AccountControl from "./AccountControl.jsx";
import { useProfile } from "../shared/profile/useProfile.js";
import { setTelemetryModule } from "../shared/telemetry/clientErrors.js";
import { useHashRoute, unknownModuleSlug, isAdminRoute, isDesignRoute, isDashboardRoute, readRoute, buildHash, INITIAL_HASH_EMPTY } from "./route.js";
import { pageTitle } from "./pageTitle.js";
import { writeLastRoute, seedBootRoute } from "./lastRoute.js";
import { installBuildSkewWatch, shouldOfferReload, fetchServedBuild, isBuildSkewed, LOADED_BUILD } from "./buildSkew.js";
import { reloadFresh, isChunkRecoveryStuck, subscribeChunkRecoveryStuck } from "./chunkReload.js";
import { RADIUS } from "../shared/ui/radius.js";
import FloatingNotice from "../shared/ui/FloatingNotice.jsx";
import { mayResumeLastSite } from "../workspaces/site-planner/lib/bootResume.js";
import HelpReportControl from "./HelpReportControl.jsx";
import { retryQueuedReports } from "../shared/reports/reportsStore.js";
import { checkProjectDeletionStatus, listDeletedProjects, restoreDeletedProject, projectGateStatus, wasProjectFreshlyMinted } from "../shared/projects/projects.js";

// NEW-2 (B848833) — lazy, same reasoning as AdminGate/DesignGallery below: a soft-deleted-project
// notice is rare enough that it has no business riding the entry chunk every route downloads.
const DeletedProjectNotice = lazy(() => import("../shared/ui/DeletedProjectNotice.jsx"));

const AdminGate = lazy(() => import("../workspaces/admin/AdminGate.jsx"));
// NEW-4 (docs/DESIGN.md) — the `/design` primitive gallery. Same lazy/not-a-workspace shape as
// AdminGate above: no header tab, never offered by the module switcher, costs nothing on the
// shipped bundle until someone types the URL.
const DesignGallery = lazy(() => import("../workspaces/design-gallery/DesignGallery.jsx"));
// NEW-1 (B1213312) — the Dashboard: a real destination that sits ABOVE the six workspaces, not
// one of them, so it's deliberately not a WORKSPACES entry either — same lazy/not-a-workspace
// shape as AdminGate/DesignGallery above (isDashboardHash below, no header tab of its own).
const Dashboard = lazy(() => import("../workspaces/dashboard/Dashboard.jsx"));

// "Open where I left off": on an empty-hash boot, seed the URL from the stored last-route
// pointer BEFORE the first render (so useHashRoute's initial read sees it). Runs at module
// scope — after route.js captured INITIAL_HASH_EMPTY, so deep links (incl. "#/") still win
// and resumeAllowed stays true for the Site Planner's own plan-level resume.
seedBootRoute();

// B881664 — the route the app's BOOT actually resolved to (after the seed above), captured
// once. `mayResumeLastSite` compares a later mount's own projectId against this to tell "the
// Site Planner is mounting as part of processing the boot route" from "the Site Planner is
// mounting because the user just navigated to a project-less route" — see bootResume.js.
const INITIAL_ROUTE = readRoute();

// Workspace registry — each Comp is lazy-loaded (separate bundle chunk).
const WORKSPACES = [
  { id: "site-planner", label: "Site Planyr",     Comp: lazy(() => import("../workspaces/site-planner/SitePlannerApp.jsx")) },
  { id: "doc-review",   label: "Review", Comp: lazy(() => import("../workspaces/doc-review/DocReview.jsx")) },
  { id: "library",      label: "Library", Comp: lazy(() => import("../workspaces/library/Library.jsx")) },
  { id: "scheduler",    label: "Sequence Planyr",  Comp: lazy(() => import("../workspaces/scheduler/Scheduler.jsx")) },
  { id: "notes",        label: "Notes", Comp: lazy(() => import("../workspaces/notes/Notes.jsx")) },
  { id: "model",        label: "Spreadsheet", Comp: lazy(() => import("../workspaces/model/ModelApp.jsx")) }, // B1166768 — user-facing rename; this `label` also feeds ErrorBoundary's crash-card copy below
  { id: "food",         label: "Food", Comp: lazy(() => import("../workspaces/food/FoodApp.jsx")) },
];

// Chrome color is a theme token so the shell themes WITH the app (B318). (The account
// pill/dropdown styling moved into AccountControl.jsx with the control itself — B734.)
const CHROME = "var(--chrome-bg)";

// NEW-1 (B1213312) — the Dashboard's canonical hash (see route.js's isDashboardRoute + buildHash).
const DASHBOARD_HASH = "#/";

// B113/B485's existing phone breakpoint (760px, matchMedia), reused verbatim rather than a
// third one — same value AppHeader.jsx's own `useNarrow` and Notes.jsx/FoodMap.jsx's local
// mirrors of it already use. A LOCAL copy rather than importing AppHeader.jsx: that file pulls
// in ProjectBreadcrumb/CloudSyncBadge/AnchoredMenu/BrandMark/InterfaceSettings and more, and
// Shell.jsx sits in the entry chunk every route downloads — FoodMap.jsx's own `useCoarsePointer`
// comment documents the same tradeoff for the same reason (bundle weight on chrome every route
// pays for, not the workspace-lazy chunks that already import AppHeader.jsx directly).
function useNarrow() {
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia("(max-width: 760px)").matches; } catch (_) { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(max-width: 760px)"); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  return narrow;
}

/** "A newer version of Planyr is available" (B1373) — module scope, per
 *  MODULE-SCOPE-COMPONENTS.
 *
 *  It must be impossible for this to interrupt someone mid-sentence, and it must be
 *  dismissible in one click. It does not reload on its own — a forced reload of an app
 *  someone is typing into is a worse bug than the staleness it cures. `reloadFresh` is the
 *  same cache-busting reload the stale-chunk guard uses, so the reload actually lands on the
 *  new build rather than re-serving the cached index.html.
 *
 *  NEW-1 (B1000400) — bottom-centered via the shared FloatingNotice primitive, replacing the
 *  old in-flow top strip (see docs/DESIGN.md "Floating notifications"). That strip could never
 *  cover anything (it pushed content down); this floating card CAN cover a strip of whatever's
 *  underneath, which is acceptable only because it stays dismissible, actionable (Reload), and
 *  never traps clicks outside its own box — FloatingNotice's shared host is pointer-events:none
 *  everywhere except each notice's own filled card. */
const UPDATE_BANNER_MAX_WIDTH = "min(480px, calc(100vw - 16px))";

function UpdateBanner({ reason, onReload, onDismiss }) {
  // B113/B485's existing phone breakpoint (760px, matchMedia), reused rather than a third one —
  // same convention Notes.jsx's phone drill-in cites. Hook runs unconditionally (Rules of Hooks),
  // ahead of the `reason` early-return below.
  const narrow = useNarrow();
  if (!reason) return null;
  const actions = (
    <>
      <button
        type="button" data-testid="app-update-reload" onClick={onReload}
        style={{
          flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--warn-text)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 12px", cursor: "pointer",
        }}
      >Reload</button>
      <button
        type="button" data-testid="app-update-dismiss" onClick={onDismiss}
        style={{
          flex: "0 0 auto", border: "1px solid var(--border-default)", borderRadius: RADIUS.pill,
          background: "transparent", color: "var(--text-tertiary)", font: "inherit",
          fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer",
        }}
      >Dismiss</button>
    </>
  );
  return (
    <FloatingNotice maxWidth={UPDATE_BANNER_MAX_WIDTH}>
      <div
        role="status"
        data-testid="app-update-banner"
        data-reason={reason}
        style={{
          // FloatingNotice's wrapper only CAPS width (maxWidth) — it never forces its child to
          // actually USE the available room, so a shrink-to-fit column collapses to whatever its
          // narrowest content demands (measured: a bare flexDirection:"column" switch alone
          // produced a 165px-wide message column, four lines, narrower than the unfixed bug).
          // Setting the SAME width the FloatingNotice cap uses is what actually claims the room.
          width: narrow ? UPDATE_BANNER_MAX_WIDTH : undefined,
          display: "flex", flexDirection: narrow ? "column" : "row", alignItems: narrow ? "stretch" : "center",
          gap: 10, padding: "8px 14px",
          background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: RADIUS.lg,
          color: "var(--warn-text)", fontSize: 12.5, fontWeight: 600, boxShadow: "0 4px 16px rgba(0,0,0,0.22)",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {reason === "route-miss"
            ? "That part of Planyr is newer than the copy this tab has open — reload to get it."
            : reason === "chunk-stuck"
            ? "Planyr couldn't finish loading part of the app just now (likely mid-deploy) — a reload should fix it. Anything you were changing is saved on this device."
            : "A newer version of Planyr is available. Reload when you're ready — your work is saved."}
        </span>
        {narrow
          ? <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>{actions}</div>
          : actions}
      </div>
    </FloatingNotice>
  );
}

export default function Shell() {
  // The active project + workspace now live in the URL hash (Work Item A), so the
  // project survives a module switch, deep-links, and refreshes — instead of being
  // module-local state that's lost on the way into Document Review. The breadcrumb and
  // every workspace read the project from here, not from their own state.
  const [route, navigate] = useHashRoute();
  const routedModule = route.module;  // the module named by the URL (ignores the admin/design/dashboard overlays)
  const projectId = route.projectId;  // active Site-group id | null
  const cross     = route.cross;      // cross-project mode
  const org       = route.org;        // ORG SCOPE (NEW-1) — standing in the Organization, not any project
  // B711904 (NEW-1) — "admin" is deliberately NOT a module slug (see route.js), so it never
  // shows up in `route.module`; it's read straight off the live hash instead, the same way
  // `routeMiss` below already has to be.
  //
  // ⛔ B1213312 — THESE THREE ARE PLAIN, SYNCHRONOUS COMPUTATIONS, NEVER STATE-PLUS-EFFECT.
  // They used to be `useState` seeded once at mount, updated by a `useEffect` keyed on `[route]`
  // — which looks equivalent but ISN'T: `route` updates from the hashchange LISTENER inside
  // `useHashRoute`, one render pass; the effect that recomputes isAdminHash/isDesignHash/
  // isDashboardHash from the (by-then-current) `window.location.hash` only runs AFTER that
  // render commits, one pass LATER. For one render in between, `route.module` already reflects
  // the NEW hash while `isDashboardHash` still reflects the OLD one. That gap is invisible for
  // admin/design (nothing else depends on them) but is exactly what turned `active` below (which
  // DOES depend on isDashboardHash) briefly back into `"site-planner"` on a hashchange landing on
  // bare "#/" — long enough for the kept-alive Site Planner's isActive-gated URL-sync effect
  // (SitePlannerApp.jsx) to fire once and overwrite the just-written Dashboard hash with its own
  // "#/site", reproducing the exact B881664-class bounce this session's fix was supposed to
  // close. Measured live: clicking the wordmark from Schedule produced `#/schedule → #/ → #/site`,
  // 55ms apart. Computing all three plain, straight off `window.location.hash`, on every render
  // — no state, no effect, no lag — closes the gap: whatever render sees the new `route` also
  // sees the new hash-derived flags, always in the same pass.
  const isAdminHash = typeof window !== "undefined" && isAdminRoute(window.location.hash);
  // NEW-4 — same shape as isAdminHash above, for the `/design` gallery.
  const isDesignHash = typeof window !== "undefined" && isDesignRoute(window.location.hash);
  // NEW-1 (B1213312) — the Dashboard: same shape as isAdminHash/isDesignHash above, read
  // straight off the raw hash rather than through `route.module` (parseRoute can't tell a bare
  // "#/" apart from "site-planner, no project" — see route.js's own header). Unlike admin/design,
  // the Dashboard genuinely has no workspace "active" underneath it (see `active` below).
  const isDashboardHash = typeof window !== "undefined" && isDashboardRoute(window.location.hash);
  // NEW-1 (B1213312) — NO workspace is "active" while the Dashboard is open: unlike admin/design
  // (which sit on top of whatever workspace the route still names), the Dashboard is a genuine
  // peer of the six workspaces, not a layer over one of them. This is what makes "no module tab
  // active" true for free (AppHeader's tabs highlight on `m.id === module`, and `active` here
  // never equals a real workspace id while it's null) and keeps a fresh dashboard boot from
  // mounting the Site Planner's chunk just to hide it underneath.
  const active = isDashboardHash ? null : routedModule;
  const [user,      setUser]      = useState(null);
  // NEW-1 — `user` starts null on every load and only resolves once Supabase's auth listener
  // reports back, so a signed-in visitor briefly sees the SIGNED-OUT "Sign in" pill before the
  // real, usually wider, named account pill replaces it. AccountControl's rendered width is part
  // of row 1's right zone, which grows into (and squeezes) the left zone's breadcrumb via plain
  // flexbox the moment it changes size — so that swap moved a still-mounted, already-pressed
  // header control (the project/plan crumb) out from under a tap in flight
  // (event:click-swallowed, "moved": true). `authKnown` lets AccountControl hold a neutral,
  // stable-width placeholder until the real state is in, instead of asserting "Sign in" first.
  const [authKnown, setAuthKnown] = useState(false);
  const [authOpen,  setAuthOpen]  = useState(false);
  const [recovery,  setRecovery]  = useState(false);
  const [authTab,   setAuthTab]   = useState("profile"); // which tab the account modal opens on
  // The account pill/dropdown + "Cloud off" popover now live in AccountControl, which owns its
  // own anchor ref + open state per mounted header instance (B734) — Shell only drives the modal.
  // Cross-workspace navigation (B191–B193, now URL-driven for project context). The
  // breadcrumb's "Dashboard" / "select project" simply change the hash; only the two
  // *side-effecting* actions still need a signal: creating a new project (born in the
  // Site Planner) and opening a specific review file (Document Review is lazy-mounted).
  // ORG SCOPE (NEW-1, extended B1020930) — Notes, Library and now Schedule are meaningful
  // there (Site/Review/Model have no org-scoped content to show), so switching tabs while
  // standing in Organization keeps org scope only when the target module can actually show it;
  // any other tab drops back to that module's plain, no-project state. Schedule at org scope
  // renders `AgendaView` (a lightweight local surface Scheduler.jsx renders INSTEAD of the
  // embedded Gantt iframe — never a route into the walled `public/sequence/index.html`), so it
  // was safe to add here without touching the embedded scheduler at all. Site/Review/Model
  // are still simply never OFFERED a way into org scope (no `onSelectOrg` wiring for them);
  // this is what makes a stray "#/org/site" URL, if ever hand-typed, degrade harmlessly rather
  // than needing its own guard everywhere.
  const ORG_CAPABLE_MODULES = new Set(["notes", "library", "scheduler"]);
  const switchModule = (id) => navigate({ module: id, org: org && ORG_CAPABLE_MODULES.has(id) });
  // NEW-1 (B1213312) — the Dashboard is not a `{module, projectId, cross, org}` value (see
  // route.js's isDashboardRoute), so it can't be reached through `navigate()`'s partial-merge
  // shape the way every module switch is; it needs the raw hash set directly. The guard against
  // re-assigning an unchanged hash is the whole fix for the measured bug this replaces: clicking
  // the wordmark from `#/design` or `#/admin` used to call `navigate({module:"site-planner",
  // projectId:null})`, which `parseRoute` resolves to the SAME route object those overlays
  // themselves fall back to — so `navigate`'s own sameRoute check saw "no change" and refused to
  // write the hash at all (measured: click "succeeds", hash never moves, the overlay never
  // closes). Comparing the literal hash string here — not the parsed route — means leaving any
  // of those pages always fires a real hashchange, and clicking the wordmark while already on
  // the Dashboard is a correct, silent no-op.
  const goDashboard = () => {
    if (typeof window !== "undefined" && window.location.hash !== DASHBOARD_HASH) window.location.hash = DASHBOARD_HASH;
  };
  // "New project" from anywhere: land in the Site Planner and tell it to start a blank
  // site. A monotonic tick (not a project id — the blank isn't saved yet) re-fires on
  // each click; the Site Planner writes the real id into the URL once it exists.
  const [newProjectTick, setNewProjectTick] = useState(0);
  const newProject = () => { navigate({ module: "site-planner", projectId: null, cross: false, org: false }); setNewProjectTick((n) => n + 1); };
  // ORG SCOPE (NEW-1) — the switcher's "Organization" entry, reachable from every workspace
  // the same way "New project" is: it always lands in Notes (the first org-capable module),
  // regardless of where it was picked from.
  const goOrg = () => navigate({ module: "notes", projectId: null, cross: false, org: true });
  // Cross-workspace "open this file" intent (NEW-1). The global Project Files panel is
  // reachable from every workspace, but Document Review is lazy-mounted — so a file clicked
  // from the Site side can't be handed to a component that doesn't exist yet. We route to
  // Document Review WITH the file's project (so the breadcrumb + browser land on it), and
  // stash the requested review (token-stamped so a repeat click re-fires) for DR to open
  // once it mounts. Without this the open is dropped and DR boots to its placeholder.
  const [docIntent, setDocIntent] = useState(null);
  // `openAtPage` (B848848 — the comps "open source brochure" link) jumps to a specific page
  // once the review has loaded, instead of resuming wherever it was last left open.
  const openReviewInDocReview = (row, { page } = {}) => {
    const pid = row && (row.project_id ?? row.projectId ?? null);
    setDocIntent({ kind: "open-review", row, openAtPage: page || null, token: Date.now() });
    navigate({ module: "doc-review", projectId: pid || null, cross: false, org: false });
  };
  // B1161792 (NEW-1) — the Dashboard's "Needs attention" card rows click through to the exact
  // task, not just its project. Same shape as openReviewInDocReview above: the Dashboard isn't
  // kept alive alongside Scheduler (it unmounts the instant the route leaves it), so the
  // requested task is stashed here (token-stamped so a repeat click on the same task re-fires)
  // and handed to Scheduler.jsx once it mounts and the embedded iframe is ready.
  const [scheduleTaskIntent, setScheduleTaskIntent] = useState(null);
  const openTaskInScheduler = ({ linkedSiteId, taskId }) => {
    if (linkedSiteId == null || taskId == null) return;
    setScheduleTaskIntent({ siteId: linkedSiteId, taskId, token: Date.now() });
    navigate({ module: "scheduler", projectId: linkedSiteId, cross: false, org: false });
  };
  // Cross-module schedule link (the Schedule + the Site Planner live in SEPARATE cloud backends
  // and can't read each other). When the embedded Schedule app reports a link set/created, mirror
  // the lightweight hint onto the Site Planner side so the Site dashboard can show "has a schedule"
  // without booting the iframe. The Schedule record stays the source of truth; this is the copy.
  const scheduleLinkChanged = (groupId, info) => {
    if (!groupId) return; // a clear with no group can't be mirrored; the stale hint self-heals on relink
    // B927105 — dynamic import, not a static one: storage.js pulls in the whole site model /
    // element-sync engine (~165 KB), which otherwise rides the shared entry chunk every route
    // downloads for the sake of these two functions. This only ever fires from a mounted
    // Schedule embed, so the one-time chunk fetch costs nothing anyone notices.
    import("../workspaces/site-planner/lib/storage.js")
      .then(({ setScheduleLink }) => { try { setScheduleLink(groupId, info || {}); } catch (_) {} })
      .catch(() => {});
  };

  /* ⛔ WHO THE PROJECT STORE BELONGS TO IS THE SHELL'S JOB, NOT THE SITE PLANNER'S (B482 ×2).
   *
   * `setActiveUser` is what switches the shared project store from the logged-out legacy cache
   * to the signed-in user's own (`planarfit:sites:cloud:<uid>`). It used to be called in exactly
   * ONE place — SitePlannerApp's auth effect — and SitePlannerApp is a lazy workspace that only
   * mounts once you visit it. "Open where I left off" now routinely boots straight into Notes,
   * Review or Library, and on those boots the Site Planner never mounts, so the store stayed
   * bound to nobody: `isCloudActive()` was false, every warm no-opped instantly, and every
   * project read silently returned whatever stale LOGGED-OUT data that particular machine
   * happened to hold. That is why one account gave two answers on two computers — the office
   * machine had a few legacy sites to show, the home machine had none.
   *
   * The Shell always mounts and already owns auth, so the binding lives here. The Site Planner
   * still calls it (and still runs its own pull) — the call is idempotent, and its own
   * same-user re-emit guard is keyed on its own ref, so nothing there changes.
   *
   * B927105 — `setActiveUser` now comes from `activeUser.js`, a leaf split out of `storage.js`
   * specifically so this call can stay a plain, synchronous, statically-imported function. The
   * old `storage.js` statically pulled in the whole site-model / element-sync engine (siteModel.js,
   * cloudSync.js, elementSync.js, roadGeometry.js, …) — about 165 KB that has nothing to do with
   * auth and was riding the shared entry chunk every route downloads (Notes included) for the
   * sake of this one function plus `setScheduleLink` below. `activeUser.js` has no such import,
   * so calling it here costs none of that. */
  useEffect(() => {
    if (!supabaseConfigured()) { setAuthKnown(true); return; }
    return onAuthChange((event, u) => {
      try { setActiveUser((u && u.id) || null); } catch (_) {}
      setUser(u);
      setAuthKnown(true);
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthOpen(true); }
    });
  }, []);

  // NEW-9 — the B223 boot-time idle warm of scheduler/doc-review/library was REMOVED.
  // Its requestIdleCallback fired at ~t=304ms, ahead of first-contentful-paint at ~328ms,
  // so it raced the critical path instead of following it: a Site-only session fetched AND
  // evaluated ~805 KB of chunks it never uses. Warming now happens on navigation intent
  // only (AppHeader module-tab hover / pointerdown → prefetchModule), which keeps the
  // instant-switch feel without taxing a session that never leaves the Site route.

  // B279 — tag telemetry rows with the workspace the user is in, so a reported error
  // says WHERE it happened (site-planner / doc-review / scheduler). "admin" resolves as its
  // own module here even though it's not in `route.module` (see isAdminHash above), so a
  // crash inside the admin page is never mislabeled as a Site Planner error. NEW-1
  // (B1213312) — same reasoning for "dashboard": `active` is null there, which would
  // otherwise tag every Dashboard error with a bare "null" module.
  useEffect(() => { setTelemetryModule(isAdminHash ? "admin" : isDashboardHash ? "dashboard" : active); }, [active, isAdminHash, isDashboardHash]);

  // NEW-1 (2026-08-28) — the browser tab title names the module you're in, using the
  // SAME label the nav tabs render (pageTitle.js reads moduleTabLabel.js, the nav's own
  // source), so it updates on every client-side route change with no reload.
  // B1213312 — the Dashboard has no MODULE_TAB_LABEL entry (it's not a tab), so pageTitle's
  // existing "no label for this module" fallback already renders the bare brand string for it;
  // no change needed there, just don't pass the null `active` off as some other module's id.
  useEffect(() => { document.title = pageTitle({ module: isDashboardHash ? "dashboard" : active, isAdmin: isAdminHash }); }, [active, isAdminHash, isDashboardHash]);

  // "Open where I left off" — persist every route change as the last-route pointer.
  // Single choke point: catches tab clicks, breadcrumb picks, and programmatic navigates.
  // writeLastRoute() itself declines a few cases (B710736 — Food, and any other module
  // sitting on no project/cross view) so a visit there can't clobber the pointer to
  // wherever the professional tool was actually left; see lastRoute.js. #/admin resolves
  // (via parseRoute's tolerant fallback) to the default module with no project — a real
  // pointer, indistinguishable from "on the plain dashboard" — so it's excluded the same way
  // Food is: a visit to /admin must never clobber the pointer to whatever project was
  // actually open before it (B711904).
  useEffect(() => { if (!isAdminHash && !isDesignHash && !isDashboardHash) writeLastRoute(route); }, [route, isAdminHash, isDesignHash, isDashboardHash]);

  // B842866 — drain any problem reports that couldn't reach the server on a prior load
  // (offline, a dropped connection). Once per boot; LOUD-FAILURE means a report never
  // silently vanishes, so this is the retry half of that promise. Fire-and-forget.
  useEffect(() => { retryQueuedReports(); }, []);

  // Keep-alive (owner request, 2026-07-05: "cleaner/faster switch between modules"): every
  // workspace the user has VISITED stays mounted, hidden with display:none, instead of being
  // torn down on each tab switch. Switching back is instant — the open drawing, map view,
  // file list, and the booted Schedule iframe all survive. Hidden workspaces still follow
  // the route's project (their route→state effects stay live); writing to the URL and global
  // keyboard handling are gated on the `isActive` prop each workspace now receives.
  const [visited, setVisited] = useState(() => new Set([active]));
  useEffect(() => { setVisited((v) => (v.has(active) ? v : new Set(v).add(active))); }, [active]);

  /* NEW-2 (B848833) — A SOFT-DELETED PROJECT MUST NOT SILENTLY STAY OPEN AND WRITABLE.
   *
   * A deep link (or a tab left open across a delete) can name a project id that's since been
   * moved to Recently deleted — nothing about the route itself changes, and every workspace here
   * mounts unconditionally off `projectId` with no notion that the site behind it might be gone.
   * The check is asked ONCE per (projectId, recheck) pair, against the cloud directly (a single
   * indexed row lookup — see `cloudCheckDeleted`'s own header), never against the local project
   * list: that cache only reliably EXCLUDES a deleted project once a pull has run since the
   * delete, so an already-cached, since-deleted entry would read as live for however long this
   * device goes between pulls — exactly the staleness this gate exists to close.
   *
   * Deliberately OPTIMISTIC, not blocking: the workspace mounts normally the instant you navigate
   * (no added latency for the overwhelming common case of a live project), and this swaps the
   * blocked notice in the moment the check comes back positive. `gateReqRef` drops a stale
   * response from a projectId the user has already navigated away from.
   */
  const [projectGate, setProjectGate] = useState({ id: null, status: "unknown", name: null, deletedAt: null });
  const [gateRecheck, setGateRecheck] = useState(0);
  const gateReqRef = useRef(null);
  /* B1202176 — ids the Site Planner minted LOCALLY this session via "New project" / "New site
   * here" (reported through `onProjectChange`'s second argument, set below). Creation there is
   * deliberately lazy — a blank project's cloud row lands on first save, sometimes racing an
   * async push — so the very first thing this gate could ask about a brand-new project was
   * "no such row", indistinguishable from a bad/expired deep link. That regression (against
   * B848833's own gate) blocked EVERY "New project" click behind "This project doesn't exist"
   * before the user could do anything to create the row. `projectGateStatus` is the one place
   * that folds this context into the DB's honest `{exists,deleted}` answer — see its own header.
   *
   * B1202176 (extended) — this ref is a plain in-memory Set, so it resets to empty on a
   * bare-domain reload: a fresh mount of THIS component, exactly what `lastRoute.js`'s
   * restore-where-I-left-off seed triggers. A brand-new, never-drawn-on project writes its id
   * into `lastRoute` (the `writeLastRoute(route)` effect below) the moment the route changes,
   * well before it's ever saved anywhere — so closing the tab first and reopening the bare
   * domain restored a pointer this ref no longer remembered, reading "missing" again (the
   * owner's live repro). `wasProjectFreshlyMinted` reads the small capped localStorage list
   * SitePlannerApp.jsx writes at both mint sites — this ref's cross-reload twin — so the two are
   * ORed together below rather than either alone deciding.
   */
  const freshProjectIdsRef = useRef(new Set());
  useEffect(() => {
    if (!projectId || cross || org) { setProjectGate({ id: projectId, status: "live", name: null, deletedAt: null }); return; }
    gateReqRef.current = projectId;
    let live = true;
    checkProjectDeletionStatus(projectId).then((res) => {
      if (!live || gateReqRef.current !== projectId) return; // superseded by a later navigation
      const freshlyCreated = freshProjectIdsRef.current.has(projectId) || wasProjectFreshlyMinted(projectId);
      const g = projectGateStatus({ res, freshlyCreated });
      setProjectGate({ id: projectId, ...g });
      // B1202176 (extended, owner live-measured on production build 89b5c3f) — a CONFIRMED
      // "missing" id is stuck in `lastRoute` forever otherwise: the notice itself never touches
      // it, so every subsequent reload/bare-domain boot seeds the URL straight back into the
      // same dead id and reproduces the identical dead end — sticky until the user happens to
      // click "Go to Dashboard" (measured: that click is the ONLY thing that currently corrects
      // it). Overwriting it with the neutral route the instant the id is confirmed dead is what
      // lastRoute.js's own stated design ("a dead id resolves to the map/dashboard and the URL
      // self-heals") actually requires, so a future boot never routes into it again. Deliberately
      // scoped to "missing" only — a genuinely soft-deleted project still offers Restore, so a
      // reload correctly shows that SAME notice again rather than one this tab silently discarded.
      if (g.status === "missing") writeLastRoute({ module: "site-planner", projectId: null, cross: false, org: false });
    });
    return () => { live = false; };
  }, [projectId, cross, org, gateRecheck]);
  const projectBlocked = projectGate.id === projectId && (projectGate.status === "deleted" || projectGate.status === "missing");
  const restoreBlockedProject = async () => {
    // Restore the WHOLE group the routed id belongs to (every sibling plan), same as the
    // breadcrumb's own Recently-deleted bin — never just the one plan id, which would leave the
    // rest of a multi-plan project still binned.
    const bin = await listDeletedProjects();
    const entry = bin && bin.ok && bin.projects ? bin.projects.find((p) => (p.ids || []).includes(projectId)) : null;
    const res = await restoreDeletedProject(entry ? entry.ids : [projectId]);
    if (res && res.ok !== false) setGateRecheck((n) => n + 1); // re-run the gate check, drops the notice on success
    return res;
  };

  /* DEPLOY SKEW (B1373) — two independent signals, one banner.
   *
   *  `servedBuild` is what the SERVER says is current (null while unknown / offline / dev);
   *  `routeMiss` is the definitive one — this build was handed a route slug it has no module
   *  for, which is what a link to a workspace shipped after this tab loaded looks like from
   *  the inside. The route signal is read from the live hash, not from `route`, because
   *  parseRoute has already resolved the miss away by then. */
  const [servedBuild, setServedBuild] = useState(null);
  const [dismissedFor, setDismissedFor] = useState(null);
  // NEW-2 — a chunk that is STILL missing after the auto-reload already tried once (a
  // mid-propagating deploy). Independent of the build-skew signals below: this is a CONFIRMED
  // current failure, not a heuristic, so it wins whenever both are true. See chunkReload.js.
  const [chunkStuck, setChunkStuck] = useState(() => isChunkRecoveryStuck());
  useEffect(() => subscribeChunkRecoveryStuck(setChunkStuck), []);
  const [routeMiss, setRouteMiss] = useState(() => (typeof window !== "undefined" ? !!unknownModuleSlug(window.location.hash) : false));
  useEffect(() => installBuildSkewWatch({ onServed: setServedBuild }), []);
  useEffect(() => {
    if (typeof window === "undefined") return;
    setRouteMiss(!!unknownModuleSlug(window.location.hash));
  }, [route]);
  // B881667 — `shouldOfferReload` now requires CONFIRMED skew before a route miss shows the
  // reload banner (see its own header), so the routine watch's up-to-20s-after-boot first check
  // is too slow a way to learn "no, this build is already current" — the whole reason a route
  // miss is uninformative until then. Fire one extra, immediate check the moment a miss is seen;
  // the routine watch's own poll/focus checks are untouched and keep running regardless.
  useEffect(() => {
    if (!routeMiss) return;
    let live = true;
    fetchServedBuild().then((served) => { if (live) setServedBuild(served); });
    return () => { live = false; };
  }, [routeMiss]);
  // B881667 — a route miss silently left the URL bar naming the unresolved slug forever (the
  // owner's exact complaint: "the URL keeps saying /review"), with the resolved fallback module
  // rendered underneath. Correct the visible URL to what's actually rendered — but ONLY once the
  // immediate check above has PROVEN this tab is already on the current build: while skew is
  // still possible, rewriting the URL would silently throw away a deep link a reload could
  // actually resolve (exactly the case this mechanism exists to protect, per buildSkew.js's own
  // header). `replaceState`, never a real navigation — no wasted history entry, no re-render
  // (parseRoute already resolved `route` to the same fallback the render already used).
  useEffect(() => {
    if (!routeMiss || typeof window === "undefined" || !window.history) return;
    if (servedBuild == null || isBuildSkewed(LOADED_BUILD, servedBuild)) return;
    try {
      const url = window.location.pathname + window.location.search + buildHash(route);
      window.history.replaceState(window.history.state, "", url);
    } catch (_) { /* history API unavailable — leave the URL as-is */ }
    setRouteMiss(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMiss, servedBuild]);
  const updateReason = chunkStuck && dismissedFor !== "chunk-stuck"
    ? "chunk-stuck"
    : shouldOfferReload({ loaded: LOADED_BUILD, served: servedBuild, dismissedFor, routeMissed: routeMiss })
    ? (routeMiss && dismissedFor !== "route-miss" ? "route-miss" : "newer-build")
    : null;

  // Profile (name/org) for the signed-in user — sourced from the profiles table via
  // the useProfile hook, with a never-blank display name (B297/B298).
  const profileApi = useProfile(user);

  const openAuth    = () => { setRecovery(false); setAuthOpen(true); };
  const openAccount = (tab) => { setRecovery(false); setAuthTab(tab); setAuthOpen(true); };

  // Build the auth-control slot once per render; passed to every workspace so AppHeader always
  // has the current user state. AccountControl is a self-contained component (own anchor ref +
  // open state per mounted instance), so the same element rendered into several kept-alive
  // headers no longer shares one ref and mis-anchors the dropdown to the corner (B734).
  const authControl = (
    <AccountControl
      user={user}
      authKnown={authKnown}
      profileApi={profileApi}
      onOpenAuth={openAuth}
      onOpenAccount={openAccount}
    />
  );

  return (
    <div style={{ height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", background: CHROME }}>
      {/* No shell-level header — each workspace renders AppHeader internally
          so it can own its toolbar-slot content without prop-drilling through here. */}
      <UpdateBanner
        reason={updateReason}
        onReload={() => reloadFresh()}
        onDismiss={() => setDismissedFor(updateReason === "route-miss" ? "route-miss" : updateReason === "chunk-stuck" ? "chunk-stuck" : servedBuild)}
      />
      <main style={{ flex: 1, minHeight: 0, position: "relative", zIndex: 0, background: "var(--surface-page)" }}>
        {/* Keep-alive render: every visited workspace stays mounted in an absolutely-
            positioned wrapper; only the active one is displayed. Each gets its OWN error
            boundary (stable key — a crash in one is contained and shows only when that tab
            is active; "Try again" resets in place) and its own Suspense (the per-module
            loader shows only on the first visit, while the lazy chunk loads). */}
        {WORKSPACES.filter((w) => visited.has(w.id) || w.id === active).map((w) => {
          const isActive = w.id === active;
          const Comp = w.Comp;
          // NEW-2 (B848833) — a workspace never mounts (or stays mounted) for a project the gate
          // has confirmed is soft-deleted / nonexistent. This is what makes the block real rather
          // than cosmetic: swapping the JSX at this slot unmounts an already-open workspace too,
          // which is what actually stops its autosave/write effects, not just hides them.
          if (isActive && projectBlocked) {
            return (
              <div key={w.id} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
                <Suspense fallback={null}>
                  <DeletedProjectNotice
                    status={projectGate.status}
                    name={projectGate.name}
                    deletedAt={projectGate.deletedAt}
                    onRestore={restoreBlockedProject}
                    onDashboard={goDashboard}
                  />
                </Suspense>
              </div>
            );
          }
          return (
            <div key={w.id} style={{ position: "absolute", inset: 0, display: isActive ? "flex" : "none", flexDirection: "column" }}>
              {/* NEW-2 — `label` is the human-facing crash-card copy ("Site Planyr"); `moduleId`
                  is the same slug every other telemetry source reports (`w.id`, "site-planner").
                  Passing only `label` before this made every React crash file under a display
                  name no other row in client_errors used — see ErrorBoundary.jsx's own note. */}
              <ErrorBoundary label={w.label} moduleId={w.id}>
                <Suspense fallback={<ModuleLoader module={w.id} />}>
                  <Comp
                    isActive={isActive}
                    shellModule={w.id}
                    onShellSwitch={switchModule}
                    authControl={authControl}
                    accountActive={!!user}
                    // The signed-in user's id, so a workspace can SCOPE its own per-account
                    // storage without importing the auth/Supabase client onto its route.
                    // Notes keys its notebooks by this (or `local` when signed out), so two
                    // accounts on one machine never read each other's notes.
                    userId={user?.id || null}
                    projectId={projectId}
                    crossProject={cross}
                    // ORG SCOPE (NEW-1) — passed uniformly, like projectId/crossProject; only
                    // Notes and Library read it. `onSelectOrg` is the switcher's "Organization"
                    // entry point, wired the same way `onNewProject` already is everywhere.
                    org={org}
                    onSelectOrg={goOrg}
                    onNavigate={navigate}
                    onProjectChange={(gid, meta) => {
                      // B1202176 — record which ids SitePlannerApp minted locally (see its own
                      // `locallyMintedGroupsRef` note) BEFORE navigating, so the gate effect above
                      // never has a render where it could ask the cloud about this id cold.
                      if (gid && meta && meta.freshlyCreated) freshProjectIdsRef.current.add(gid);
                      navigate({ projectId: gid || null, cross: false, org: false });
                    }}
                    resumeAllowed={mayResumeLastSite({ initialHashEmpty: INITIAL_HASH_EMPTY, projectId, initialProjectId: INITIAL_ROUTE.projectId })}
                    newProjectTick={newProjectTick}
                    docIntent={docIntent}
                    scheduleTaskIntent={scheduleTaskIntent}
                    onGoDashboard={goDashboard}
                    onNewProject={newProject}
                    onOpenReviewInDocReview={openReviewInDocReview}
                    onScheduleLinkChanged={scheduleLinkChanged}
                  />
                </Suspense>
              </ErrorBoundary>
            </div>
          );
        })}
        {/* B711904 (NEW-1), pointer-events fixed B1154240 — the admin page. Only mounted (lazy
            chunk + the allowlist RPC call) while the hash actually reads #/admin, so a normal
            session never pays for either. AdminGate itself renders null for anyone not on the
            allowlist, so the ordinary workspace underneath shows through unblocked, paint-wise —
            the "404, not a permission page" requirement. But an absolutely-positioned wrapper
            with default `pointer-events: auto` wins every hit-test inside its box regardless of
            what it paints (CHROME-NEVER-EATS-A-PRESS), so a null-rendering AdminGate still froze
            the whole workspace underneath for anyone not on the allowlist. This wrapper is
            therefore deliberately `pointer-events: none` — pointer-transparent whether or not
            AdminGate ends up rendering anything — and AdminApp claims its own presses back with
            `pointer-events: auto` on its root (pointer-events inherits, so that second half is
            required; AdminGate's own null render needs nothing, since none is nothing to hit). */}
        {isAdminHash && (
          <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
            <Suspense fallback={null}>
              <AdminGate user={user} onExit={goDashboard} />
            </Suspense>
          </div>
        )}
        {isDesignHash && (
          // Pointer-events fixed B1154242 (NEW-3), same defect and same shape as B1154240's
          // #/admin fix: while the DesignGallery lazy chunk is still loading (the Suspense
          // fallback={null} gap), this wrapper is an empty box that still wins every hit-test
          // in its area by CSS default (CHROME-NEVER-EATS-A-PRESS) — measured, ~3s of a dead
          // workspace underneath on a throttled/cold load. Only ONE line is needed here, unlike
          // #/admin's two: DesignGallery itself renders via `createPortal(..., document.body)`
          // (see its own header — done to escape this exact wrapper's z-index stacking), so once
          // it mounts it is not a DOM descendant of this div at all and never inherits its
          // `pointer-events`; nothing there needs a counter-flip.
          <div style={{ position: "absolute", inset: 0, zIndex: 1, pointerEvents: "none" }}>
            <Suspense fallback={null}>
              {/* B1213312 — `onExit={goDashboard}` now works here (it used to be a measured
                  silent no-op: see goDashboard's own header above for the mechanism and fix). */}
              <DesignGallery onExit={goDashboard} />
            </Suspense>
          </div>
        )}
        {/* NEW-1 (B1213312) — the Dashboard. Unlike admin/design above, it does not sit ON TOP
            of an active workspace (there isn't one: `active` is null while isDashboardHash is
            true, so no WORKSPACES entry above claims `isActive`), so it needs none of their
            pointer-events choreography. Deliberately NOT kept alive (unlike the six
            workspaces) — a genuinely conditional `{isDashboardHash && ...}` render, same shape
            as the admin/design blocks above, so it unmounts the instant you leave and a fresh
            mount re-fetches its cards' data on every visit rather than showing a stale snapshot
            from whenever it first mounted. */}
        {isDashboardHash && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column" }}>
            <ErrorBoundary label="Dashboard">
              <Suspense fallback={<ModuleLoader module="dashboard" />}>
                <Dashboard
                  onShellSwitch={switchModule}
                  authControl={authControl}
                  accountActive={!!user}
                  userId={user?.id || null}
                  onNewProject={newProject}
                  onNavigate={navigate}
                  onOpenReviewInDocReview={openReviewInDocReview}
                  onOpenTaskInScheduler={openTaskInScheduler}
                />
              </Suspense>
            </ErrorBoundary>
          </div>
        )}
      </main>
      {/* B842864 — the global help/report control. Rendered here (outside every per-workspace
          absolutely-positioned wrapper) so it renders on every route at every breakpoint,
          including the map screen and every non-Site workspace, and survives a module switch
          without remounting. It reads the active route straight off the URL hash itself
          (reportsStore.js's routeId(), the same source Shell's own isAdminHash/active read),
          so it needs no route prop threaded down. */}
      <HelpReportControl user={user} />
      {authOpen && (
        <AuthPanel
          user={user}
          recovery={recovery}
          profileApi={profileApi}
          initialTab={authTab}
          onClose={() => { setAuthOpen(false); setRecovery(false); }}
        />
      )}
    </div>
  );
}
