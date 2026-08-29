import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { defaultOverlayState } from "./lib/layers.js";
import { testConnection, supabaseConfigured, connectionInfo } from "./lib/supabase.js";
import { onAuthChange } from "./lib/auth.js";
import { claimInvites, listMyTeams } from "./lib/teams.js";
import { primeShareContext, defaultShareTeam, resetShareContext, resolveNewPlanTeam } from "./lib/newProjectSharing.js";
import { loadUserPrefs } from "./lib/userPrefs.js";
// B831777 (NEW-2) — CompsPanel is now rendered BY MapFinder itself, as the Comps tab in the
// map's left rail (it used to be a floating panel this component rendered as a MapFinder
// sibling). MapFinder owns the lazy import now; this component only owns the DATA the tab needs
// (comps / pendingCompAnchor / focusCompId) since that data has to survive the tab unmounting.

/* B326416 — the loaders the default-sharing resolution needs. Both modules are already on the
 * Site route's own tier (`SitePlanner.jsx` imports userPrefs statically), so these are plain
 * static edges and add no chunk. */
const SHARE_LOADERS = { loadPrefs: loadUserPrefs, listTeams: listMyTeams };
import { migrateOldAutosave, migrateSiteGroups, migrateScenarios, initHistoryStore, loadSitesList, loadPlansOfGroup, renameSiteGroup, repairSplitProjectNames, groupOf, loadSite, saveSite, deleteSite, getCurrentSiteId, setCurrentSiteId, setActiveUser, pushSiteToCloud, pullCloud, importLegacyIntoCloud, pendingLegacyCount, stageLegacySite, discardLegacySite } from "./lib/storage.js";
import { cloudParcelRows } from "./lib/cloudSync.js";
import { summarizeParcelRows } from "./lib/parcelSummary.js";
import { STATUS_META } from "./lib/siteModel.js";
import { ToastHost, useToasts } from "../../shared/ui/Toast.jsx";
import { idbPersist } from "./lib/localDb.js";
/* LOADED ON DEMAND (B1092). The legacy-import review modal is signed-in-only and opens
 * from a menu — it has no business riding the planner's critical-path chunk, which is the
 * chunk the perf budget gates. Same pattern as lib/exportSheet.js (B1042): a dynamic
 * import behind the one conditional that renders it. Named export, so the promise is
 * mapped to a default for React.lazy. */
const SiteReviewModal = lazy(() => import("./components/SiteReviewModal.jsx").then((m) => ({ default: m.SiteReviewModal })));
import { nextConceptName } from "./lib/conceptName.js";
import { reportClientEvent } from "../../shared/telemetry/clientErrors.js";
import { noteLayerContext } from "../../shared/telemetry/perfRecorderHandle.js";
import { initialBootResolved, mayReconcileUrl, pickResumeTarget, mayWriteRouteProject, routeProjectAvailability } from "./lib/bootResume.js";
import { RADIUS } from "../../shared/ui/radius.js";

migrateOldAutosave(); // bring any legacy single-slot autosave into the site store
migrateSiteGroups();  // give every legacy record a site (location) group
migrateScenarios();   // fold legacy named scenarios into Plans
repairSplitProjectNames(); // NEW-3 — converge any project whose plans disagree on its name (idempotent; see lib/projectName.js)
initHistoryStore();   // B474 — hydrate the version-history ring from IndexedDB (async, fire-and-forget); migrates the localStorage ring over once
idbPersist();         // B474 review (#9) — ask the browser to keep our IndexedDB durable (not best-effort/evictable); it's now the version ring's home + the underlay raster's local cache

const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// The effective project group of an active plan id (its group, or its own id for a
// brand-new unsaved blank). null when no plan is open / we're on the map.
const groupForPlan = (id, mode) => (mode === "plan" && id) ? (loadSite(id)?.groupId || id) : null;

// Last "new project" tick already acted on (Work Item A). Module-scoped (not a ref) so it
// survives this lazy workspace unmounting/remounting — the Shell mounts us fresh on the
// "New project" click (after navigating here), so a per-mount ref would miss it.
let lastConsumedNewProject = 0;

/* Two surfaces: a map to find/select parcels, and the planner to design on a
 * site. Every site autosaves to its own record, so the map can list them and
 * starting/opening another never loses the one you were on. */
export default function App({
  shellModule, onShellSwitch, authControl, accountActive = false, onOpenReviewInDocReview,
  // Work Item A — the active project lives in the URL. `projectId` is the route's
  // Site-group id (or null = Dashboard/Map); `onProjectChange` writes our active group
  // back to the URL; `resumeAllowed` lets a route-less first visit resume the last site;
  // `newProjectTick` increments when "New project" is clicked from any workspace.
  projectId = null, onProjectChange, resumeAllowed = true, newProjectTick = 0,
  // Keep-alive: false while this workspace is mounted but hidden behind another tab.
  // Hidden = follow the route, but never WRITE to it and never own global keyboard input.
  isActive = true,
} = {}) {
  // (County is no longer a top-level pick — the map auto-resolves a clicked
  // parcel's county (B11), and the planner reads its county from the saved site.)
  // Shared map-layer overlay state — ONE source of truth for both pages, so a
  // layer toggled on the map finder is reflected in the planner and vice-versa
  // (global app preference; per-site memory is reserved in the site model, TBD).
  const [overlays, setOverlays] = useState(defaultOverlayState);
  /* B265539 — tell the recorder WHICH layers are on, not just how many. `ly` has always been a
   * count, and a count cannot be turned into a fixture: the tab he reports the symptom in carries
   * four while every battery in this repo runs at zero. One effect keyed on the overlay state —
   * never per render, never per frame — and the handle sanitises and bounds what it stores. */
  useEffect(() => { noteLayerContext(overlays); }, [overlays]);
  // Per-layer load status (id → {state, msg}), app-shared so the Layers panel on
  // either page shows which layers are actually painting vs failed/empty.
  const [layerStatus, setLayerStatus] = useState({});
  const [sites, setSites] = useState(() => loadSitesList());
  // Boot target: the URL's project wins (a deep link, or carried in from another module);
  // otherwise resume the last-opened site — but ONLY when the page opened with no explicit
  // route, so a shared "#/" dashboard link or an explicit module URL isn't overridden.
  const bootActiveId = () => {
    // No route project AND a route-bearing first visit (not a route-less resume) → don't
    // resume the last site (an explicit "#/" / module URL must land on the dashboard).
    if (!projectId && !resumeAllowed) return null;
    return pickResumeTarget({
      routeProjectId: projectId, currentId: getCurrentSiteId(),
      plansOfGroup: loadPlansOfGroup, hasSite: (id) => !!loadSite(id),
    });
  };
  const [activeSiteId, setActiveSiteId] = useState(bootActiveId);
  // Resume into the planner if there's an active site to pick up.
  const [mode, setMode] = useState(() => (bootActiveId() ? "plan" : "map"));
  // Live mirror of the URL project for the once-registered auth callback (which would
  // otherwise close over the first render's prop).
  const projectIdRef = useRef(projectId); projectIdRef.current = projectId;
  // V13/V28 — "boot resolved" gate. False until the first auth event + cloud pull settles
  // (so the route's project + the currentSite pointer aren't clobbered during the async gap
  // where a signed-in user's cloud sites aren't loaded yet). True from the start when there's
  // no Supabase to wait on (logged-out / unconfigured boots resolve synchronously).
  const [bootResolved, setBootResolved] = useState(() => initialBootResolved(supabaseConfigured()));
  /* NEW-5 — the two pieces of the route<->project binding that must NOT live in render state.
   * `userLeftProjectRef` records a DELIBERATE exit from a project (see leaveProject/goMap); it
   * is a ref because the URL-sync effect reads it in the same tick the exit sets it, and a
   * state write would not be visible until the next render — by which time the write it is
   * meant to authorise has already been skipped. `routeMissing` is the honest answer when the
   * URL names a project this device genuinely does not have. */
  const userLeftProjectRef = useRef(false);
  const [routeMissing, setRouteMissing] = useState(null);
  // Clear a dangling currentSite pointer (e.g. a never-persisted site from before
  // the fix) so it doesn't linger in storage. The finder fallback already handles
  // the routing; this just tidies the stale pointer. V13: gate on bootResolved — a
  // signed-in cloud site looks "dangling" at first render ONLY because it isn't pulled
  // yet, and nulling the pointer there loses the exact-plan resume. Run after the first
  // auth + pull settles, when "absent" genuinely means absent.
  useEffect(() => {
    if (!mayReconcileUrl(bootResolved)) return;
    const cur = getCurrentSiteId(); if (cur && !loadSite(cur)) setCurrentSiteId(null);
  }, [bootResolved]);

  // PHASE 1 ONLY: test the Supabase connection (no data read/written). Drives a
  // tiny status chip + a console line + a window.pfCloudTest() helper. Persistence
  // is unchanged — still localStorage.
  const [cloud, setCloud] = useState({ state: supabaseConfigured() ? "checking" : "not-configured", message: "" });
  useEffect(() => {
    let live = true;
    const run = async () => { const r = await testConnection(); if (live) setCloud(r); console.log(`[Supabase] ${r.state}: ${r.message}`); return r; };
    window.pfCloudTest = run; // on-demand re-test from the console
    window.pfCloudInfo = connectionInfo(); // what the build baked in (url + key prefix/len)
    run();
    return () => { live = false; };
  }, []);

  // Supabase auth → data-store switching only. The account UI (sign in/out, modal)
  // is global in the shell; here we just react to auth to switch cloud↔local storage.
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState(""); // "couldn't load from cloud" — shown instead of silently wiping to empty (B54)
  const [deleteError, setDeleteError] = useState(""); // a cloud DELETE that actually failed — loud, never a phantom success (B372)
  const [pushError, setPushError] = useState("");     // a background cloud-mirror push failed (NEW-F6) — device copy is safe; heals on next push/pull
  // NEW-1 — a site-status change (incl. "Dead") is a header write outside the planner's
  // element-level undo stack (Ctrl+Z can't reach it — different component, sometimes not even
  // mounted). This toast is the "obvious, working undo" for it instead, reusing the shared B673
  // toast host rather than inventing a second mechanism.
  const { toasts: statusToasts, pushToast: pushStatusToast, dismissToast: dismissStatusToast } = useToasts();
  const prevUid = useRef(null);
  const applySeq = useRef(0); // monotonic token so overlapping auth events can't interleave (B43)
  // "Bring my on-device sites into my account": signed-in uid drives the prompt; the
  // rest track the one-time, non-destructive copy-up of legacy (logged-out) sites.
  const [signedInUid, setSignedInUid] = useState(null);
  const [migrating, setMigrating] = useState(false);
  const [migrateMsg, setMigrateMsg] = useState("");
  const [hideMigrate, setHideMigrate] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  // When the user clicks "Open" on a migration site, we stage it locally and open it in
  // the planner. migrationPendingSiteId tracks that a decision (Save / Discard) is still
  // outstanding so we can show the in-planner banner.
  const [migrationPendingSiteId, setMigrationPendingSiteId] = useState(null);
  const [migrationSaveMsg, setMigrationSaveMsg] = useState("");
  // Re-read epoch for the keyed planner (B133 — stale plan flashes on boot then "comes back").
  // The planner snapshots its plan from storage ONCE at mount (`key={activeSiteId}`). At boot the
  // first synchronous render reads the store BEFORE auth resolves (activeUser still null → the
  // legacy/local store), so a signed-in user can momentarily see an older copy; the authoritative
  // copy only lands after applyUser's `pullCloud`, which is a SAME-TAB localStorage write — and a
  // same-tab write fires no `storage` event, so the already-mounted planner (B127's listener only
  // catches OTHER tabs) never refreshes and the stale copy lingers. Bumping this after the pull
  // forces a one-time remount so the resumed plan reflects the freshly-merged cloud copy.
  const [loadEpoch, setLoadEpoch] = useState(0);

  // Switch the data store on sign-in / sign-out. Logged in → pull the user's cloud
  // sites into their local cache and make that the active store (cloud is home);
  // logged out → back to the legacy localStorage store. Reset the view on a real
  // switch so we never show one account's pointer against another's data.
  const applyUser = async (u, event) => {
    const uid = (u && u.id) || null;
    // supabase-js re-emits SIGNED_IN on tab focus / token refresh. When it's the SAME
    // user already active, nothing actually changed — skip the re-pull + view reset that
    // would otherwise bounce an open plan back to the map a couple minutes later (the
    // B124 "work disappears on its own" churn). A real switch (different user) or a
    // sign-out still runs in full.
    if (uid && uid === prevUid.current && event !== "SIGNED_OUT") return;
    const seq = ++applySeq.current; // capture before the await; a newer auth event bumps it
    setActiveUser(uid);
    setSignedInUid(uid);     // null when logged out → the on-device-sites prompt only shows when signed in
    setMigrateMsg(""); setHideMigrate(false); // reset the prompt on any real auth switch
    if (uid) {
      setCloudLoading(true);
      // TEAM: activate any invites waiting on this user's email (an existing account invited
      // after signup) BEFORE pulling, so a freshly-joined team's shared projects come down in
      // the same pull. Best-effort — never blocks loading the user's own sites.
      await claimInvites().catch(() => {});
      // B326416 — warm the default-sharing answer (account preference + your teams) right after
      // invites are claimed, so the FIRST project created in this session already knows whether it
      // is born shared. Best-effort: a failure leaves the context unset, and an unset context
      // resolves to "private" rather than guessing.
      primeShareContext(uid, SHARE_LOADERS).catch(() => {});
      if (seq !== applySeq.current) return; // superseded by a newer auth event
      const res = await pullCloud(uid).catch(() => ({ ok: false }));
      if (seq !== applySeq.current) return; // superseded by a newer auth event — don't apply stale cloud/view state (B43)
      setCloudLoading(false);
      // B54: a failed fetch no longer wipes the cache — say we're showing the last
      // synced copy rather than presenting a silent (and scary) empty library.
      setCloudError(res && res.ok === false ? "Couldn't reach the cloud — showing your last synced copy. Your saved sites are safe; reconnect to refresh." : "");
      // Resume target after the cloud pull: the URL's project wins (a deep link or a
      // cross-module carry must survive sign-in — V13), else the last-opened site (B124/B133).
      // projectIdRef stays the route's project because bootResolved gated the URL sync from
      // clobbering it during the async pull (the whole point of the fix).
      const resumeId = pickResumeTarget({
        routeProjectId: projectIdRef.current, currentId: getCurrentSiteId(),
        plansOfGroup: loadPlansOfGroup, hasSite: (id) => !!loadSite(id),
      });
      if (resumeId) {
        setActiveSiteId(resumeId); setCurrentSiteId(resumeId); setMode("plan"); // resume if it's one of theirs
        // Force the keyed planner to re-read from the post-pull merged store even though `cur` is
        // unchanged, so the resumed plan can't linger on the stale pre-auth copy (B133). Safe: the
        // tab-focus SIGNED_IN re-emit is already skipped above (no remount mid-edit), and a boot
        // resume has no in-progress edits to lose.
        setLoadEpoch((n) => n + 1);
      }
      else { setActiveSiteId(null); setMode("map"); }  // NEW-5: NOT a user exit — the URL writer keeps the route (mayWriteRouteProject)
      refreshSites();
      refreshParcelSummary(uid);
    } else {
      // B326416 — the sharing context is one user's preference and one user's team list, so it
      // must not survive a sign-out into the next account. (Unlike the cloud cache below, this is
      // cheap to rebuild and dangerous to keep: a stale team here would share the wrong person's
      // project. It re-primes on the next sign-in.)
      resetShareContext();
      // Deliberately DON'T wipe the per-user cloud cache here. supabase-js also emits
      // SIGNED_OUT for a transient token-refresh failure, and clearing the cache on that
      // made signed-in work vanish (B124). The cache is keyed per-uid and only read while
      // that user is active (logged out, the app reads the legacy store), so leaving it is
      // not a leak — and it's preserved if the "sign-out" was a momentary refresh blip.
      setCloudError("");
      if (event === "SIGNED_OUT") { userLeftProjectRef.current = true; setActiveSiteId(null); setMode("map"); }
      refreshSites();
      refreshParcelSummary(null);
    }
    // B471 — log the auth transition so a "saving stopped after my session changed" report is
    // diagnosable from telemetry (the cloud-save path is gated on being signed in; a silent token
    // lapse is exactly the kind of cause we couldn't see before). Only fires on a REAL change (the
    // same-user re-emit returned early above).
    if ((prevUid.current || null) !== uid) {
      reportClientEvent(uid ? "auth-signed-in" : "auth-signed-out",
        uid ? "session active" : "session ended (signed out or token lapsed)", { event });
    }
    prevUid.current = uid;
    // V13 — the first auth event + pull has now settled the store + the resume view; release
    // the boot gate so the URL sync + the dangling-pointer cleanup may run. Batched with the
    // resume's setActiveSiteId above, so the URL-sync effect only ever sees the resolved view
    // (never the transient null that stripped the deep link).
    setBootResolved(true);
  };

  useEffect(() => {
    if (!supabaseConfigured()) return;
    return onAuthChange((event, u) => {
      // Recovery UI + token refresh don't change which data store is active.
      if (event === "PASSWORD_RECOVERY" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") return;
      applyUser(u, event); // INITIAL_SESSION, SIGNED_IN, SIGNED_OUT
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshSites = () => setSites(loadSitesList());

  // B849344 — the canonical parcel-boundary read behind the Sites panel + map pins (see
  // MapFinder.jsx's siteBoundaryInfo). `parcelSummaryLoaded` starts false so the UI can tell
  // "no boundary" (a real answer) apart from "haven't checked yet" (LOUD-FAILURE — an unknown
  // acreage must read as unknown, never as a confident 0.0). Signed out there is nothing to
  // fetch — a local-only site's `parcels` field IS its live store — so it flips true at once
  // with an empty summary and every site falls back to its own record. The only place that
  // flip normally happens is applyUser's signed-out branch, driven by onAuthChange — but that
  // listener is never even ATTACHED when `!supabaseConfigured()` (no Supabase project baked into
  // this build), so a fully offline/unconfigured app would otherwise get stuck on "checking
  // boundary…" forever (caught live: a real headless run against an unconfigured dev build sat
  // on the unknown state with no auth event ever coming to clear it). Seed the initial value
  // from that same fact instead of waiting on an event that will never fire.
  const [parcelSummary, setParcelSummary] = useState({});
  const [parcelSummaryLoaded, setParcelSummaryLoaded] = useState(() => !supabaseConfigured());
  const parcelSummaryFetching = useRef(false);
  const refreshParcelSummary = async (uid) => {
    if (!uid) { setParcelSummary({}); setParcelSummaryLoaded(true); return; }
    if (parcelSummaryFetching.current) return;
    parcelSummaryFetching.current = true;
    try {
      const r = await cloudParcelRows(uid).catch(() => ({ ok: false }));
      // A failed fetch leaves the last-known summary in place (stale-while-revalidate, same
      // discipline as cloudError above) rather than reporting every site boundary-less. The
      // dissolve happens here, not in cloudSync.js — see cloudParcelRows's own header for why.
      if (r && r.ok) { setParcelSummary(summarizeParcelRows(r.rows)); setParcelSummaryLoaded(true); }
    } finally { parcelSummaryFetching.current = false; }
  };
  // Bring the user's on-device (logged-out) sites into their cloud account — a one-time,
  // non-destructive copy-up. Originals are kept; any cloud copy that's already newer is left
  // alone. After it runs we re-pull + refresh so the list reflects the consolidated account.
  const bringLocalSitesIn = async () => {
    if (!signedInUid || migrating) return;
    setMigrating(true); setMigrateMsg("");
    try {
      const r = await importLegacyIntoCloud(signedInUid);
      await pullCloud(signedInUid).catch(() => {});
      refreshSites();
      refreshParcelSummary(signedInUid);
      const parts = [];
      if (r.copied) parts.push(`${r.copied} site${r.copied === 1 ? "" : "s"} brought into your account`);
      if (r.failed) parts.push(`${r.failed} couldn't reach the cloud (kept on this device — will retry on your next edit)`);
      setMigrateMsg(parts.length ? parts.join("; ") + "." : "Nothing new to bring in — your account is already up to date.");
    } finally { setMigrating(false); }
  };
  // "Open →" in the migration modal: stage the legacy site into the cloud cache so the
  // planner can load it, then navigate into it. The planner banner lets the user Save or
  // Discard once they've seen the site. Non-destructive: the original legacy copy remains
  // until the user explicitly acts (Save keeps it in Supabase; Discard removes both copies).
  const handleOpenLegacySite = (siteId) => {
    if (!signedInUid) return;
    const staged = stageLegacySite(signedInUid, siteId);
    if (!staged) return;
    refreshSites();
    setMigrationPendingSiteId(siteId);
    setMigrationSaveMsg("");
    goPlan(siteId);
  };

  // "Save to account" from the in-planner migration banner.
  const handleMigrateSave = async () => {
    if (!migrationPendingSiteId || !signedInUid) return;
    const r = await pushSiteToCloud(migrationPendingSiteId).catch(() => ({ ok: false }));
    if (r && r.ok) {
      setMigrationSaveMsg("Saved to your account.");
      setMigrationPendingSiteId(null);
    } else {
      setMigrationSaveMsg("Couldn't reach the cloud — try again when reconnected.");
    }
  };

  // "Discard" from the in-planner migration banner: remove from both stores and go back.
  const handleMigrateDiscard = () => {
    if (!migrationPendingSiteId || !signedInUid) return;
    const siteId = migrationPendingSiteId;
    setMigrationPendingSiteId(null);
    setMigrationSaveMsg("");
    discardLegacySite(signedInUid, siteId);
    leaveProject();
    refreshSites();
  };

  const pendingLegacy = signedInUid ? pendingLegacyCount(signedInUid) : 0;
  // Cross-tab freshness: when ANOTHER tab changes the site store, refresh this tab's finder list
  // so it doesn't go stale (the per-save read-modify-write in storage.js already prevents a
  // whole-store clobber; this keeps the list in sync). Only reacts to the sites keys.
  useEffect(() => {
    const onStorage = (e) => { if (!e.key || e.key.startsWith("planarfit:sites")) refreshSites(); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);
  const goPlan = (id) => { setCurrentSiteId(id); setActiveSiteId(id); setMode("plan"); };
  /* NEW-5 — the ONE way to leave a project, and the ONE place the intent is recorded.
   *
   * The URL writer refuses to clear a route-named project unless it is told the user meant to
   * leave (see mayWriteRouteProject). That intent CANNOT be inferred from state: "the project's
   * data hasn't loaded" and "the user closed the project" both look like `effGroup === null`,
   * and treating the first as the second is precisely the bug. So every deliberate exit —
   * the Map crumb, the planner's Back to map, a sign-out, a discarded staging site — goes
   * through here, and nothing else may set `mode` to "map" while a project is routed. */
  const leaveProject = () => { userLeftProjectRef.current = true; setActiveSiteId(null); setMode("map"); };
  const goMap = () => { userLeftProjectRef.current = true; setMode("map"); };

  // NEW-F6 (LOUD-FAILURE): the fire-and-forget cloud mirrors below (new site, duplicate, rename,
  // status) used to `.catch(() => {})` — the op looked done while the cloud copy silently lagged.
  // Not data loss (the device copy is authoritative and the next autosave/pull heal re-pushes),
  // but silence is the B209 class. One dismissible banner; notify-only, no retry loop. Returns
  // ok so multi-plan loops can aggregate to a single banner instead of N.
  const pushLoud = async (id, what) => {
    try {
      const r = await pushSiteToCloud(id);
      if (r && r.ok === false) throw new Error(r.error || "push failed");
      return true;
    } catch (e) {
      setPushError(`${what} is saved on this device but couldn't sync to the cloud — it'll catch up on your next edit or reload.`);
      reportClientEvent("cloud-push-failed", `background push failed (${what})`, { id, error: (e && e.message) || "" });
      return false;
    }
  };

  // Open a saved site from the map.
  const openSite = (id) => { if (loadSite(id)) goPlan(id); };

  // A fresh selection from the map → a brand-new site, with its first plan.
  // B326416 — this is one of exactly TWO places a new PROJECT is born, and therefore one of the two
  // places the team default is resolved. The await is on a warmed cache (primed at sign-in), and it
  // sits BEFORE `saveSite` on purpose: `team_id` is written only on the row's INSERT, so a team
  // stamped afterwards would need an UPDATE — which the database now refuses outright.
  const newSiteFromMap = async (payload) => {
    const id = newId();
    const parcels = (payload.parcels || [])
      .filter((p) => p.points?.length >= 3)
      .map((p, i) => ({ id: `p${id}_${i}`, points: p.points, locked: true, addr: p.addr || null, acct: p.acct || null, attrs: p.attrs || null }));
    const { teamId } = await defaultShareTeam(signedInUid, SHARE_LOADERS);
    saveSite({ id, groupId: id, site: payload.name || "Untitled site", name: "Concept A", origin: payload.origin || null, county: payload.county || null, parcels, els: [], measures: [], settings: {}, underlay: payload.underlay || null, teamId });
    pushLoud(id, "The new site"); // mirror to cloud when logged in (no-op otherwise); loud on failure (NEW-F6)
    // Seed this new project's standard folder tree + mirror it to Google Drive (B650). Idempotent
    // and graceful (no-op signed-out / Drive off); a dynamic import keeps the folder code off the
    // planner chunk, and folder rows are independent of the sites row so ordering doesn't matter.
    import("../library/lib/folders.js")
      .then((m) => m.ensureSeeded(id).then((r) => { if (r && r.ok && r.seeded) m.syncFoldersToDrive(id); }))
      .catch(() => {});
    refreshSites();
    goPlan(id);
  };

  /* "Open blank planner" → a new empty site. We do NOT write a record yet: a blank site that's
   * never edited should never be saved. The planner saves a fully-formed record the moment you
   * add anything.
   *
   * NEW-4 — EXCEPT when we already know WHERE it is. Every blank plan started from the map (the
   * "Start blank" button, and the fallback offered when a county parcel service is down) now
   * carries the map's current centre as its origin, so it is born located: the aerial, the flood
   * layer, contours and the county rules are on from the first click, and the plan can never be
   * stranded in blank space. That one DOES get written immediately — an anchor is a fact worth
   * keeping even before anything is drawn (and `persistOrDrop` keeps a blank plan that has one). */
  const newBlankSite = async (opts) => {
    const id = newId();
    const o = opts && opts.origin && Number.isFinite(opts.origin.lat) && Number.isFinite(opts.origin.lon)
      ? { lat: opts.origin.lat, lon: opts.origin.lon } : null;
    if (o) {
      // B326416 — the second (and last) birthplace of a project. See newSiteFromMap.
      const { teamId } = await defaultShareTeam(signedInUid, SHARE_LOADERS);
      saveSite({ id, groupId: id, site: opts.name || "Untitled site", name: "Concept A", origin: o, county: opts.county || null, parcels: [], els: [], measures: [], settings: {}, teamId });
      pushLoud(id, "The new site"); // mirror to cloud when logged in; loud on failure
      refreshSites();
    }
    goPlan(id);
  };
  // NEW-4 — where the map is looking right now, so a blank plan started from the map header is
  // born at the spot the owner is staring at rather than nowhere. A plain ref: this is read at
  // click time only, and re-rendering the whole app on every map pan would be absurd.
  const mapCenterRef = useRef(null);
  const newBlankSiteHere = () => newBlankSite(mapCenterRef.current ? { origin: mapCenterRef.current } : null);

  // NEW-COMPS — Leasing Comps: a comp is its own entity (never a project type), so its state
  // lives here rather than inside a site record. `comps` mirrors what CompsPanel has loaded, fed
  // back up purely so MapFinder can render the same list as markers — CompsPanel remains the one
  // data owner (fetch/insert/update/delete all live in its own module).
  // B831777 (NEW-2) — no more `compsPanelOpen`: the Comps tab now lives inside MapFinder's own
  // rail, and MapFinder decides for itself (from `pendingCompAnchor`/`focusCompId` arriving)
  // whether to switch its Site/Comp mode to show the result. This component only owns the data.
  const [comps, setComps] = useState([]);
  const [pendingCompAnchor, setPendingCompAnchor] = useState(null);
  const [focusCompId, setFocusCompId] = useState(null);
  const onPlaceComp = (anchor) => setPendingCompAnchor(anchor);
  const onCompClick = (id) => setFocusCompId(id);

  // Open a whole project (site group) from the header breadcrumb switcher (B191):
  // resume its active plan if one's open, else its newest. Switching plans changes
  // `activeSiteId`, which remounts/flushes the previous planner (B193 persist-on-switch).
  const openProjectGroup = (groupId) => {
    if (!groupId) return;
    const plans = loadPlansOfGroup(groupId); // newest first
    const target = plans.find((p) => p.id === activeSiteId) || plans[0];
    if (target) goPlan(target.id);
  };

  // ── URL ↔ active-project sync (Work Item A) ──────────────────────────────────
  // 1) URL project → state. The route decides WHICH project is open, so a deep link, a
  //    refresh, or a carry-in from another module all land here. A genuine transition to
  //    "no project" (the Dashboard) drops to the map; activeSiteId is kept so switching
  //    back into the project resumes the same plan. The first, route-less render is NOT
  //    treated as a Dashboard navigation, so a localStorage resume isn't undone.
  const prevPidRef = useRef(undefined);
  /* NEW-5 — the route effect now also re-runs when the SITE LIST changes.
   *
   * Repro B was two faults compounding. `openProjectGroup` returned silently when a group had
   * no plans on this device, so a hash edited to a not-yet-pulled project left the PREVIOUS
   * project rendered under a URL claiming the new one — and because the effect only depended on
   * `projectId`, the cloud pull landing a moment later never re-ran it, so it never self-
   * corrected either. Depending on `sites` (bumped by every `refreshSites`) makes a late arrival
   * complete the switch, and `routeProjectAvailability` replaces the silent return with a real
   * three-state answer. `bootResolved` is in the deps for the same reason: it is what turns a
   * "waiting" verdict into a "missing" one. */
  /* NEW-3 (owner report 2026-08-22 — a deep link to the owner's OWN Commerce City, Colorado
   * project showed the "this account doesn't have it open here" banner) — `routeProjectAvailability`
   * only ever asks the LOCAL cache, and the only thing that ever fills the local cache is the ONE
   * bulk `pullCloud` sign-in runs. A project that is genuinely owned but was created on another
   * device (or whose local cache is simply cold) is honestly, and permanently, "missing" by that
   * contract — there was no second chance. So before the banner fires for a signed-in user, try
   * ONE fresh cloud pull for exactly this project id (the same bulk fetch sign-in already runs,
   * not a new query) and let the effect's own `sites` dependency re-evaluate. Guarded per id
   * (`routeMissingRetryRef`) so a genuinely-gone id retries exactly once, never on every render. */
  const routeMissingRetryRef = useRef(new Set());
  useEffect(() => {
    const prev = prevPidRef.current; prevPidRef.current = projectId;
    if (projectId) {
      const curGroup = groupForPlan(activeSiteId, mode);
      if (projectId !== curGroup) {
        const avail = routeProjectAvailability({ plansOfGroup: loadPlansOfGroup, groupId: projectId, bootResolved });
        if (avail === "open") { setRouteMissing(null); routeMissingRetryRef.current.delete(projectId); openProjectGroup(projectId); }
        // "waiting": hold the current view; the pull may still land it and this effect re-runs.
        else if (avail === "missing") {
          if (signedInUid && !routeMissingRetryRef.current.has(projectId)) {
            // Not yet retried this id — fetch fresh from the cloud before believing it's gone.
            // Hold the current view exactly like "waiting" does; `refreshSites()` bumps `sites`,
            // which re-runs this effect and re-asks `routeProjectAvailability` with the fresh data.
            routeMissingRetryRef.current.add(projectId);
            pullCloud(signedInUid).catch(() => {}).then(() => refreshSites());
          } else {
            // Either not signed in (no cloud to check), or already retried once and it's still
            // absent — say so out loud and drop to the map. Never leave the OLD project on screen
            // under a URL naming a different one (that is what made repro B invisible).
            setRouteMissing(projectId); setActiveSiteId(null); setMode("map");
          }
        }
      } else { setRouteMissing(null); routeMissingRetryRef.current.delete(projectId); if (mode !== "plan") setMode("plan"); }
    } else if (prev !== undefined && prev !== null) {
      setRouteMissing(null);
      setMode("map");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, sites, bootResolved, signedInUid]);

  // 2) Active project → URL. When the open project changes (open another, back to map,
  //    sign-in resume, new blank), reflect it in the hash so the URL stays shareable and
  //    the next module switch carries the project. navigate() de-dupes identical hashes,
  //    so this never loops with (1).
  //    V13: gate on bootResolved. At the first render of a signed-in deep link the cloud
  //    project isn't pulled yet, so effGroup is transiently null — writing that null would
  //    strip the route ("#/project/<id>/site" → "#/") and bounce to the finder before the
  //    pull can resume. Hold the URL (the route is the source of truth during boot) until
  //    the first auth + pull settles, then sync (de-duped if already correct).
  //    Keep-alive: a HIDDEN Site Planner must never write to the URL (the visible module
  //    owns it) — `isActive` in the deps makes re-activation reconcile immediately instead.
  //    NEW-5: `mayReconcileUrl` gates on an EVENT having fired, and that is not enough — a
  //    null-user INITIAL_SESSION releases it while the cloud sites are still absent, and the
  //    null written there strips the deep link before the real SIGNED_IN can resume it. So the
  //    writer is now honest about what it knows: it may CLEAR a route-named project only when
  //    the user deliberately left it (`userLeftProjectRef`), never merely because nothing is
  //    loaded. Opening or keeping a project still writes freely, so the URL stays shareable.
  const effGroup = groupForPlan(activeSiteId, mode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!isActive || !mayReconcileUrl(bootResolved)) return;
    const allowed = mayWriteRouteProject({
      routeProjectId: projectIdRef.current,
      nextGroup: effGroup,
      userLeft: userLeftProjectRef.current,
    });
    if (!allowed) return;
    userLeftProjectRef.current = false; // the intent is spent once it has been written
    onProjectChange?.(effGroup);
  }, [effGroup, bootResolved, isActive]);

  // Keep-alive: returning to this tab re-reads the local site list (cheap, synchronous) so a
  // project created/renamed from another module while we were hidden shows without a reload.
  useEffect(() => { if (isActive) refreshSites(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  // 3) "New project" from any workspace → start a blank site here (a side effect, not a
  //    route: the blank has no saved id yet; once edited it writes its id into the URL).
  useEffect(() => {
    if (newProjectTick && newProjectTick !== lastConsumedNewProject) {
      lastConsumedNewProject = newProjectTick;
      newBlankSite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newProjectTick]);

  // Default name for the next plan in a site: lettered concepts (Concept A, B, …
  // AA, AB; per-site, continues past the highest existing letter — NEW-1/NEW-2).
  const nextConceptForGroup = (groupId) => nextConceptName(loadPlansOfGroup(groupId).map((p) => p.name));

  // New plan on the SAME site: keep the location (parcel, origin, aerial) but
  // start the layout fresh. This is the iteration workflow — explore another
  // layout without leaving the parcel.
  const newPlanSameParcel = (srcId) => {
    const src = loadSite(srcId);
    if (!src) return;
    const group = groupOf(src);
    const id = newId();
    // B326416 — a new PLAN inherits its PROJECT's sharing; it never consults the account default.
    // That is what keeps "new projects only" honest from the other direction: adding a plan to an
    // old private project must not be a back door that shares it.
    const { teamId } = resolveNewPlanTeam(loadPlansOfGroup(group));
    saveSite({ id, groupId: group, site: src.site || src.name, name: nextConceptForGroup(group),
      origin: src.origin || null, county: src.county || null, parcels: src.parcels || [], els: [], measures: [], settings: src.settings || {}, underlay: src.underlay || null, teamId });
    pushLoud(id, "The new plan"); // NEW-F6
    refreshSites();
    goPlan(id);
  };

  // Duplicate this plan (layout and all) as another plan of the same site.
  const duplicatePlan = (srcId) => {
    const src = loadSite(srcId);
    if (!src) return;
    const group = groupOf(src);
    const id = newId();
    // Inherit from the PROJECT (not from `src`, whose in-memory copy can predate a share/unshare).
    // A copy is also a fresh plan, so it must never carry the source's lock — the owner locks a
    // specific plan, not a lineage.
    saveSite({ ...src, id, groupId: group, name: `${src.name || "Plan"} (copy)`,
      teamId: resolveNewPlanTeam(loadPlansOfGroup(group)).teamId, shareLocked: false });
    pushLoud(id, "The duplicated plan"); // NEW-F6
    refreshSites();
    goPlan(id);
  };

  // Delete a SINGLE plan from its site (B264) — distinct from deleting the whole site.
  // Never removes the last plan in a group (that's the map's whole-site delete). If the
  // deleted plan was the one open, switch to a sibling so the planner lands somewhere valid.
  const deletePlan = async (id) => {
    const rec = loadSite(id);
    if (!rec) return;
    const siblings = loadPlansOfGroup(groupOf(rec));
    if (siblings.length <= 1) return; // keep at least one plan per site
    const wasActive = id === activeSiteId;
    const next = siblings.find((s) => s.id !== id);
    const res = await deleteSite(id);
    refreshSites();
    if (wasActive && next) goPlan(next.id);
    else if (wasActive) { leaveProject(); }
    await reportDeleteResult([res], "that plan");
  };

  /* NEW-1/NEW-2 — ONE rename, awaited before the list is rebuilt.
   *
   * Two bugs lived here. (1) The rename pushed one plan at a time over `loadPlansOfGroup` — the
   * LOCAL store — so a plan this browser had never hydrated was never written and kept the old
   * name in the cloud, ready to re-publish it on its next save. `renameSiteGroup` now performs a
   * single write against the GROUP at the source of truth, so that enumeration is gone entirely.
   * (2) The pushes were fired with `Promise.all` and NOT awaited, then `refreshSites()` ran
   * synchronously — so a pull landing in that window rebuilt the list from cloud rows that hadn't
   * been updated yet, and the name appeared to revert. The refresh now waits for the write.
   *
   * The immediate refresh is kept as well, so the new name paints in the same tick; the awaited one
   * is the honest confirmation. LOUD-FAILURE: a rename that didn't reach the cloud says so. */
  const renameSite = (idOrGroup, site) => {
    const rec = loadSite(idOrGroup);
    const groupId = rec ? groupOf(rec) : idOrGroup;
    const done = renameSiteGroup(groupId, site);
    refreshSites(); // optimistic — the local half of the rename has already been written
    return Promise.resolve(done).then((res) => {
      refreshSites(); // authoritative — rebuilt only AFTER the cloud write settled
      if (res && res.ok === false) {
        setPushError(`“${site}” is saved on this device, but the rename couldn't be saved to the cloud — it may come back under its old name when you reload. Check your connection and try again.`);
        reportClientEvent("cloud-push-failed", "project rename did not reach the cloud", { id: groupId, error: (res && res.error) || "" });
      }
      return res;
    });
  };
  const renamePlan = (id, name) => { saveSite({ id, name }); pushLoud(id, "The plan rename"); refreshSites(); }; // NEW-F6

  // The planner dropped a blank, unedited site (never saved). Forget it.
  const handleSiteDropped = (id) => { if (id === activeSiteId) setActiveSiteId(null); refreshSites(); };

  // Delete a whole site (every plan in its group) — used from the map, where each
  // entry represents a location, not an individual plan.
  const deleteSiteGroup = async (id) => {
    const rec = loadSite(id); if (!rec) return;
    const plans = loadPlansOfGroup(groupOf(rec));
    const hadActive = plans.some((s) => s.id === activeSiteId);
    const label = rec.site || rec.name || "this site";
    // Unmount the (now tombstone-protected) planner BEFORE removing rows so its persist-on-leave
    // can't race the delete; the storage guard (B372) makes it safe even if the order shifts.
    if (hadActive) setActiveSiteId(null);
    const results = await Promise.all(plans.map((s) => deleteSite(s.id)));
    refreshSites();
    await reportDeleteResult(results, `"${label}"`);
  };

  // If a cloud delete actually ERRORED (not just a 0-row no-op), the row may survive server-side
  // and reappear on reload — say so LOUDLY (never a phantom success, B372) and re-pull so the list
  // reflects the honest truth instead of showing it gone when it isn't.
  const reportDeleteResult = async (results, label) => {
    if (!results.some((r) => r && r.ok === false)) return;
    setDeleteError(`Couldn't delete ${label} from the cloud — it may reappear when you reload. Check your connection and try again.`);
    if (signedInUid) { await pullCloud(signedInUid).catch(() => {}); refreshSites(); }
  };

  // Set a site's project status (B7/B8). The map shows one marker per SITE group,
  // so apply the status to every plan in the group to keep it consistent however
  // the group is represented. Persists + mirrors to cloud, then refreshes.
  const setSiteStatus = (id, status) => {
    const rec = loadSite(id); if (!rec) return;
    const prevStatus = rec.status; // NEW-1 — captured BEFORE the write, for the undo toast below
    // NEW-F6 — save every plan locally first, then aggregate the pushes to ONE banner.
    const plans = loadPlansOfGroup(groupOf(rec));
    plans.forEach((s) => saveSite({ id: s.id, status }));
    Promise.all(plans.map((s) => pushSiteToCloud(s.id).then((r) => !(r && r.ok === false)).catch(() => false)))
      .then((oks) => { if (oks.some((ok) => !ok)) { setPushError("The status change is saved on this device but couldn't sync to the cloud — it'll catch up on your next edit or reload."); reportClientEvent("cloud-push-failed", "background push failed (site status)", { id }); } });
    refreshSites();
    // NEW-1 — a status change has no home on the planner's Ctrl+Z stack (it's a site-header
    // write, not an element edit, and can fire from the map with no plan even open), so an
    // undo toast is the reachable "make it reversible" affordance instead of a silent no-op.
    if (prevStatus && prevStatus !== status) {
      const label = rec.site || rec.name || "This site";
      pushStatusToast({
        text: `${label} marked ${STATUS_META[status]?.label || status}.`,
        action: { label: "Undo", onClick: () => setSiteStatus(id, prevStatus) },
      });
    }
  };

  // The map lists SITES (locations), so collapse plans to one representative per
  // group — preferring the active plan so its pin highlights correctly.
  const siteGroups = useMemo(() => {
    const byGroup = new Map();
    sites.forEach((s) => { const g = groupOf(s); if (!byGroup.has(g)) byGroup.set(g, s); });
    const act = activeSiteId && sites.find((s) => s.id === activeSiteId);
    if (act) byGroup.set(groupOf(act), act);
    return [...byGroup.values()];
  }, [sites, activeSiteId]); // stable identity → doesn't force MapFinder to re-render every parent render

  // Refresh the map's site list when we land back on it (after the planner has
  // autosaved the latest edits) — and, signed in, the canonical parcel summary too, so a
  // boundary just drawn in the planner shows up on the map/list the moment you return to it.
  useEffect(() => {
    if (mode === "map") {
      const t = setTimeout(() => { refreshSites(); if (signedInUid) refreshParcelSummary(signedInUid); }, 80);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <>
      {/* Map mode — AppHeader sits above MapFinder's own toolbar.
       *
       * (NEW-1) BOTH modes stay MOUNTED — the hidden one keeps its Leaflet map alive so
       * switching back doesn't rebuild it. The cost, until now unpaid: the hidden mode is a
       * complete SECOND copy of shared chrome (the Layers panel above all), still in the
       * document, still in the accessibility tree, and FIRST in document order when the
       * planner is the visible one. A screen reader read a whole duplicate layers panel, and
       * a page-level text check reads the hidden copy's answers instead of the live panel's —
       * which is how the Flood & drainage group came to be reported silent while the visible
       * panel was rendering every line correctly. `inert` + `aria-hidden` take the hidden
       * mode out of the a11y tree, out of focus order, and out of role-based queries, without
       * unmounting it (which is what keeps the map alive). `data-mode-active` lets any
       * remaining raw-text check target the live mode. */}
      <div data-mode="map" data-mode-active={mode === "map" ? "true" : "false"}
        aria-hidden={mode === "map" ? undefined : "true"} inert={mode === "map" ? undefined : ""}
        style={{ display: mode === "map" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
        <AppHeader
          module={shellModule || "site-planner"}
          onSwitch={onShellSwitch}
          authControl={authControl}
          accountActive={accountActive}
          // In the Site module the home crumb is "Map" (B204). Map IS the all-projects
          // view, so no "current project" here — the Map crumb reads as current and the
          // project crumb invites a pick.
          homeLabel="Map"
          onDashboard={goMap}
          currentProject={null}
          onSelectProject={openProjectGroup}
          onNewProject={newBlankSite}
          // NEW-4 — the header project dropdown can rename, and it routes through the SAME single
          // write path everything else uses. Unwired, the breadcrumb fell back to its uncontrolled
          // `storeRename`, which writes only to this device — so a rename made from the map viewer
          // was never sent to the cloud at all and came straight back on the next load. That is
          // the owner's exact repro.
          onRenameProject={renameSite}
          centerContent={null}
          saveSlot={null}
          toolbarContent={
            <button
              // NEW-4 — starts blank AT THE MAP'S CURRENT CENTRE, so "the county server is down,
              // I'll just draw it" doesn't produce an unlocated plan.
              onClick={newBlankSiteHere}
              title="Start a plan with no parcel — it takes its location from where the map is looking, so you can draw the boundary and still get the aerial, flood layer and county rules"
              style={{
                padding: "4px 11px", fontSize: 12, fontWeight: 600, borderRadius: RADIUS.sm,
                border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
                color: "var(--chrome-text)", cursor: "pointer", fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Start blank
            </button>
          }
        />
        {/* NEW-5 — the URL named a project this device genuinely doesn't have (a bad id, a
            project on another account, or one that's been deleted). The old code returned
            silently and left the PREVIOUS project on screen under the new URL, so nothing on
            the page agreed with anything else. Say it plainly instead — LOUD-FAILURE. */}
        {routeMissing && (
          <div role="status" data-testid="route-project-missing"
            style={{ margin: "8px 12px 0", padding: "9px 13px", border: "1px solid var(--border-default)",
              borderLeft: "3px solid var(--warn-text)", borderRadius: 8, background: "var(--surface-overlay)",
              fontSize: 12.5, color: "var(--text-primary)", lineHeight: 1.45, display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ flex: 1 }}>
              That link points at a project this account doesn&rsquo;t have open here. Pick one below, or check the link.
            </span>
            <button onClick={() => { setRouteMissing(null); userLeftProjectRef.current = true; onProjectChange?.(null); }}
              style={{ border: "none", background: "transparent", color: "var(--accent)", fontWeight: 700, fontSize: 12, cursor: "pointer", fontFamily: "inherit" }}>
              Dismiss
            </button>
          </div>
        )}
        <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
          <MapFinder
            visible={mode === "map"}
            isActive={isActive}
            overlays={overlays}
            setOverlays={setOverlays}
            layerStatus={layerStatus}
            setLayerStatus={setLayerStatus}
            sites={siteGroups}
            parcelSummary={parcelSummaryLoaded ? parcelSummary : null}
            activeSiteId={activeSiteId}
            onOpenSite={openSite}
            onDeleteSite={deleteSiteGroup}
            onSetStatus={setSiteStatus}
            onRenameSite={renameSite}
            onSharedChange={refreshSites}
            onUseParcels={newSiteFromMap}
            // NEW-4 — the finder hands us the map's centre (and, when it could resolve one, the
            // county) so the fallback plan is located from the start.
            onSkip={newBlankSite}
            onViewCenter={(c) => { mapCenterRef.current = c; }}
            comps={comps}
            onPlaceComp={onPlaceComp}
            onCompClick={onCompClick}
            // B831777 (NEW-2) — the Comps tab now lives inside MapFinder's own left rail
            // (beside Sites), not a separate floating panel this component renders. MapFinder
            // owns the lazy CompsPanel import; this just hands down the data it needs.
            pendingCompAnchor={pendingCompAnchor}
            onCompAnchorConsumed={() => setPendingCompAnchor(null)}
            focusCompId={focusCompId}
            onCompFocusHandled={() => setFocusCompId(null)}
            onCompsChange={setComps}
          />
        </div>
      </div>
      {/* Plan mode — SitePlanner renders its own AppHeader (same inert/aria-hidden rule). */}
      <div data-mode="plan" data-mode-active={mode === "plan" ? "true" : "false"}
        aria-hidden={mode === "plan" ? undefined : "true"} inert={mode === "plan" ? undefined : ""}
        style={{ display: mode === "plan" ? "block" : "none", height: "100%" }}>
        {activeSiteId && (
          <SitePlanner
            key={`${activeSiteId}:${loadEpoch}`}
            active={mode === "plan" && isActive}
            siteId={activeSiteId}
            overlays={overlays}
            setOverlays={setOverlays}
            cloud={cloud}
            layerStatus={layerStatus}
            setLayerStatus={setLayerStatus}
            sites={sites}
            onBackToMap={goMap}
            onOpenSite={openSite}
            onNewSite={newBlankSite}
            onNewPlanSameParcel={newPlanSameParcel}
            onDuplicateSite={duplicatePlan}
            onDeletePlan={deletePlan}
            onRenameSite={renameSite}
            onRenamePlan={renamePlan}
            onSiteDropped={handleSiteDropped}
            onSiteSaved={refreshSites}
            shellModule={shellModule}
            onShellSwitch={onShellSwitch}
            onOpenReviewInDocReview={onOpenReviewInDocReview}
            authControl={authControl}
            accountActive={accountActive}
          />
        )}
      </div>
      {/* NEW-1 — outside both mode divs so a status-change undo offered on the map survives
          switching into a plan before the toast's own timer runs out. */}
      <ToastHost toasts={statusToasts} onDismiss={dismissStatusToast} />
      {cloudLoading && (
        <div style={{ position: "fixed", inset: 0, zIndex: 4500, background: "rgba(20,18,15,0.35)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ background: "rgba(25,22,19,0.92)", color: "#ece7db", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>Loading your sites…</div>
        </div>
      )}
      {cloudError && (
        <div role="alert" style={{ position: "fixed", top: 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#7c2d12", color: "#fff", border: "1px solid #b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          <span style={{ flex: 1 }}>{cloudError}</span>
          <button onClick={() => setCloudError("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: RADIUS.sm, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}
      {deleteError && (
        <div role="alert" style={{ position: "fixed", top: cloudError ? 136 : 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#7c2d12", color: "#fff", border: "1px solid #b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          <span style={{ flex: 1 }}>{deleteError}</span>
          <button onClick={() => setDeleteError("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: RADIUS.sm, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}
      {/* NEW-F6 — a background cloud-mirror push failed. Informational (the device copy is safe
          and the next push/pull heals), so warn styling, stacked under the harder alerts. */}
      {pushError && (
        <div role="alert" style={{ position: "fixed", top: (cloudError ? 57 : 0) + (deleteError ? 57 : 0) + 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "var(--warn-bg, #fef3c7)", color: "var(--warn-text)", border: "1px solid var(--warn-border, #d6a64a)", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          <span style={{ flex: 1 }}>{pushError}</span>
          <button onClick={() => setPushError("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "transparent", color: "var(--warn-text)", border: "none", borderRadius: RADIUS.sm, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* "Bring my on-device sites into my account" — shows only when signed in AND there
          are logged-out (legacy) sites not yet in the cloud account. The copy-up is
          non-destructive (originals kept); this is the bridge between the two stores. */}
      {mode === "map" && signedInUid && !hideMigrate && (pendingLegacy > 0 || migrateMsg) && (
        <div role="status" style={{ position: "fixed", top: cloudError ? 136 : 88, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 620, display: "flex", alignItems: "center", gap: 12, background: "#1f2a44", color: "#eaf0ff", border: "1px solid #3b5bbf", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          {migrateMsg ? (
            <span style={{ flex: 1 }}>{migrateMsg}</span>
          ) : (
            <span style={{ flex: 1 }}>
              You have <b>{pendingLegacy}</b> site{pendingLegacy === 1 ? "" : "s"} saved on <b>this device</b> that {pendingLegacy === 1 ? "isn't" : "aren't"} in your account yet.
            </span>
          )}
          {!migrateMsg && (
            <button onClick={() => setShowReviewModal(true)} title="Review each on-device site and choose which ones to save to your account"
              style={{ flex: "none", cursor: "pointer", background: "#4f7df0", color: "#fff", border: "none", borderRadius: 7, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
              Review each site
            </button>
          )}
          <button onClick={() => { setHideMigrate(true); setMigrateMsg(""); }} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: RADIUS.sm, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* The cloud/connection state is now folded into the planner header's single
          save/sync badge (synced / syncing / offline / error) — see SitePlanner.
          On the map, signed-in state is shown by the shell account control. */}

      {showReviewModal && signedInUid && (
        <Suspense fallback={null}>
        <SiteReviewModal
          uid={signedInUid}
          onOpen={(siteId) => {
            setShowReviewModal(false);
            handleOpenLegacySite(siteId);
          }}
          onClose={async (savedCount) => {
            setShowReviewModal(false);
            if (savedCount > 0) {
              await pullCloud(signedInUid).catch(() => {});
              refreshSites();
            }
          }}
        />
        </Suspense>
      )}

      {/* In-planner migration decision banner — shown when the user opened a legacy site
          via "Open →" in the migration modal. Stays until they Save or Discard. */}
      {mode === "plan" && (migrationPendingSiteId || migrationSaveMsg) && (
        <div role="status" style={{ position: "fixed", top: 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#1f2a44", color: "#eaf0ff", border: "1px solid #3b5bbf", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          {migrationSaveMsg ? (
            <>
              <span style={{ flex: 1 }}>{migrationSaveMsg}</span>
              <button onClick={() => setMigrationSaveMsg("")} style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: RADIUS.sm, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
            </>
          ) : (
            <>
              <span style={{ flex: 1 }}>This site is saved on <b>this device only</b> — not yet in your account.</span>
              <button onClick={handleMigrateSave} style={{ flex: "none", cursor: "pointer", background: "#4f7df0", color: "#fff", border: "none", borderRadius: 7, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>Save to account</button>
              <button onClick={handleMigrateDiscard} style={{ flex: "none", cursor: "pointer", background: "rgba(220,38,38,0.15)", color: "#f87171", border: "1px solid rgba(220,38,38,0.35)", borderRadius: 7, padding: "5px 11px", fontFamily: "inherit", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>Discard</button>
            </>
          )}
        </div>
      )}
    </>
  );
}
