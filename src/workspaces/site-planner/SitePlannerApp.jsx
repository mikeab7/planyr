import { useEffect, useMemo, useRef, useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { defaultOverlayState } from "./lib/layers.js";
import { testConnection, supabaseConfigured, connectionInfo } from "./lib/supabase.js";
import { onAuthChange } from "./lib/auth.js";
import { claimInvites } from "./lib/teams.js";
import { migrateOldAutosave, migrateSiteGroups, migrateScenarios, initHistoryStore, loadSitesList, loadPlansOfGroup, renameSiteGroup, groupOf, loadSite, saveSite, deleteSite, getCurrentSiteId, setCurrentSiteId, setActiveUser, pushSiteToCloud, pullCloud, importLegacyIntoCloud, pendingLegacyCount, stageLegacySite, discardLegacySite } from "./lib/storage.js";
import { SiteReviewModal } from "./components/SiteReviewModal.jsx";
import { nextConceptName } from "./lib/conceptName.js";
import { reportClientEvent } from "../../shared/telemetry/clientErrors.js";

migrateOldAutosave(); // bring any legacy single-slot autosave into the site store
migrateSiteGroups();  // give every legacy record a site (location) group
migrateScenarios();   // fold legacy named scenarios into Plans
initHistoryStore();   // B474 — hydrate the version-history ring from IndexedDB (async, fire-and-forget); migrates the localStorage ring over once

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
} = {}) {
  // (County is no longer a top-level pick — the map auto-resolves a clicked
  // parcel's county (B11), and the planner reads its county from the saved site.)
  // Shared map-layer overlay state — ONE source of truth for both pages, so a
  // layer toggled on the map finder is reflected in the planner and vice-versa
  // (global app preference; per-site memory is reserved in the site model, TBD).
  const [overlays, setOverlays] = useState(defaultOverlayState);
  // Per-layer load status (id → {state, msg}), app-shared so the Layers panel on
  // either page shows which layers are actually painting vs failed/empty.
  const [layerStatus, setLayerStatus] = useState({});
  const [sites, setSites] = useState(() => loadSitesList());
  // Boot target: the URL's project wins (a deep link, or carried in from another module);
  // otherwise resume the last-opened site — but ONLY when the page opened with no explicit
  // route, so a shared "#/" dashboard link or an explicit module URL isn't overridden.
  const bootActiveId = () => {
    if (projectId) {
      const plans = loadPlansOfGroup(projectId); // newest first
      const cur = getCurrentSiteId();
      const t = plans.find((p) => p.id === cur) || plans[0];
      return t ? t.id : null;
    }
    if (resumeAllowed) { const cur = getCurrentSiteId(); return cur && loadSite(cur) ? cur : null; }
    return null;
  };
  const [activeSiteId, setActiveSiteId] = useState(bootActiveId);
  // Resume into the planner if there's an active site to pick up.
  const [mode, setMode] = useState(() => (bootActiveId() ? "plan" : "map"));
  // Live mirror of the URL project for the once-registered auth callback (which would
  // otherwise close over the first render's prop).
  const projectIdRef = useRef(projectId); projectIdRef.current = projectId;
  // Clear a dangling currentSite pointer (e.g. a never-persisted site from before
  // the fix) so it doesn't linger in storage. The finder fallback already handles
  // the routing; this just tidies the stale pointer.
  useEffect(() => { const cur = getCurrentSiteId(); if (cur && !loadSite(cur)) setCurrentSiteId(null); }, []);

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
      if (seq !== applySeq.current) return; // superseded by a newer auth event
      const res = await pullCloud(uid).catch(() => ({ ok: false }));
      if (seq !== applySeq.current) return; // superseded by a newer auth event — don't apply stale cloud/view state (B43)
      setCloudLoading(false);
      // B54: a failed fetch no longer wipes the cache — say we're showing the last
      // synced copy rather than presenting a silent (and scary) empty library.
      setCloudError(res && res.ok === false ? "Couldn't reach the cloud — showing your last synced copy. Your saved sites are safe; reconnect to refresh." : "");
      // Resume target after the cloud pull: the URL's project wins (a deep link or a
      // cross-module carry must survive sign-in), else the last-opened site (B124/B133).
      const cur = getCurrentSiteId();
      const urlPid = projectIdRef.current;
      const urlPlans = urlPid ? loadPlansOfGroup(urlPid) : [];
      const resume = urlPid
        ? (urlPlans.find((p) => p.id === cur) || urlPlans[0] || null)
        : (cur && loadSite(cur) ? { id: cur } : null);
      if (resume) {
        setActiveSiteId(resume.id); setCurrentSiteId(resume.id); setMode("plan"); // resume if it's one of theirs
        // Force the keyed planner to re-read from the post-pull merged store even though `cur` is
        // unchanged, so the resumed plan can't linger on the stale pre-auth copy (B133). Safe: the
        // tab-focus SIGNED_IN re-emit is already skipped above (no remount mid-edit), and a boot
        // resume has no in-progress edits to lose.
        setLoadEpoch((n) => n + 1);
      }
      else { setActiveSiteId(null); setMode("map"); }
      refreshSites();
    } else {
      // Deliberately DON'T wipe the per-user cloud cache here. supabase-js also emits
      // SIGNED_OUT for a transient token-refresh failure, and clearing the cache on that
      // made signed-in work vanish (B124). The cache is keyed per-uid and only read while
      // that user is active (logged out, the app reads the legacy store), so leaving it is
      // not a leak — and it's preserved if the "sign-out" was a momentary refresh blip.
      setCloudError("");
      if (event === "SIGNED_OUT") { setActiveSiteId(null); setMode("map"); }
      refreshSites();
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
    setActiveSiteId(null);
    setMode("map");
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

  // Open a saved site from the map.
  const openSite = (id) => { if (loadSite(id)) goPlan(id); };

  // A fresh selection from the map → a brand-new site, with its first plan.
  const newSiteFromMap = (payload) => {
    const id = newId();
    const parcels = (payload.parcels || [])
      .filter((p) => p.points?.length >= 3)
      .map((p, i) => ({ id: `p${id}_${i}`, points: p.points, locked: true, addr: p.addr || null, acct: p.acct || null, attrs: p.attrs || null }));
    saveSite({ id, groupId: id, site: payload.name || "Untitled site", name: "Concept A", origin: payload.origin || null, county: payload.county || null, parcels, els: [], measures: [], settings: {}, underlay: payload.underlay || null });
    pushSiteToCloud(id).catch(() => {}); // mirror to cloud when logged in (no-op otherwise)
    refreshSites();
    goPlan(id);
  };

  // "Open blank planner" → a new empty (un-located) site. We do NOT write a record
  // yet: a blank site that's never edited should never be saved. The planner saves
  // a fully-formed record the moment you add anything.
  const newBlankSite = () => { goPlan(newId()); };

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
  useEffect(() => {
    const prev = prevPidRef.current; prevPidRef.current = projectId;
    if (projectId) {
      const curGroup = groupForPlan(activeSiteId, mode);
      if (projectId !== curGroup) openProjectGroup(projectId);
      else if (mode !== "plan") setMode("plan");
    } else if (prev !== undefined && prev !== null) {
      setMode("map");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // 2) Active project → URL. When the open project changes (open another, back to map,
  //    sign-in resume, new blank), reflect it in the hash so the URL stays shareable and
  //    the next module switch carries the project. navigate() de-dupes identical hashes,
  //    so this never loops with (1).
  const effGroup = groupForPlan(activeSiteId, mode);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onProjectChange?.(effGroup); }, [effGroup]);

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
    saveSite({ id, groupId: group, site: src.site || src.name, name: nextConceptForGroup(group),
      origin: src.origin || null, county: src.county || null, parcels: src.parcels || [], els: [], measures: [], settings: src.settings || {}, underlay: src.underlay || null });
    pushSiteToCloud(id).catch(() => {});
    refreshSites();
    goPlan(id);
  };

  // Duplicate this plan (layout and all) as another plan of the same site.
  const duplicatePlan = (srcId) => {
    const src = loadSite(srcId);
    if (!src) return;
    const group = groupOf(src);
    const id = newId();
    saveSite({ ...src, id, groupId: group, name: `${src.name || "Plan"} (copy)` });
    pushSiteToCloud(id).catch(() => {});
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
    else if (wasActive) { setActiveSiteId(null); setMode("map"); }
    await reportDeleteResult([res], "that plan");
  };

  const renameSite = (groupId, site) => { renameSiteGroup(groupId, site); loadPlansOfGroup(groupId).forEach((s) => pushSiteToCloud(s.id).catch(() => {})); refreshSites(); };
  const renamePlan = (id, name) => { saveSite({ id, name }); pushSiteToCloud(id).catch(() => {}); refreshSites(); };

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
    loadPlansOfGroup(groupOf(rec)).forEach((s) => { saveSite({ id: s.id, status }); pushSiteToCloud(s.id).catch(() => {}); });
    refreshSites();
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
  // autosaved the latest edits).
  useEffect(() => {
    if (mode === "map") { const t = setTimeout(refreshSites, 80); return () => clearTimeout(t); }
  }, [mode]);

  return (
    <>
      {/* Map mode — AppHeader sits above MapFinder's own toolbar */}
      <div style={{ display: mode === "map" ? "flex" : "none", flexDirection: "column", height: "100%" }}>
        <AppHeader
          module={shellModule || "site-planner"}
          onSwitch={onShellSwitch}
          authControl={authControl}
          accountActive={accountActive}
          // In the Site module the home crumb is "Map" (B204). Map IS the all-projects
          // view, so no "current project" here — the Map crumb reads as current and the
          // project crumb invites a pick.
          homeLabel="Map"
          onDashboard={() => setMode("map")}
          currentProject={null}
          onSelectProject={openProjectGroup}
          onNewProject={newBlankSite}
          centerContent={null}
          saveSlot={null}
          toolbarContent={
            <button
              onClick={newBlankSite}
              style={{
                padding: "4px 11px", fontSize: 12, fontWeight: 600, borderRadius: 6,
                border: "1px solid var(--chrome-divider)", background: "var(--chrome-bg-elev)",
                color: "var(--chrome-text)", cursor: "pointer", fontFamily: "inherit",
                whiteSpace: "nowrap",
              }}
            >
              Start blank
            </button>
          }
        />
        <div style={{ flex: 1, minHeight: 0 }}>
          <MapFinder
            visible={mode === "map"}
            overlays={overlays}
            setOverlays={setOverlays}
            layerStatus={layerStatus}
            setLayerStatus={setLayerStatus}
            sites={siteGroups}
            activeSiteId={activeSiteId}
            onOpenSite={openSite}
            onDeleteSite={deleteSiteGroup}
            onSetStatus={setSiteStatus}
            onRenameSite={renameSite}
            onSharedChange={refreshSites}
            onUseParcels={newSiteFromMap}
            onSkip={newBlankSite}
          />
        </div>
      </div>
      {/* Plan mode — SitePlanner renders its own AppHeader */}
      <div style={{ display: mode === "plan" ? "block" : "none", height: "100%" }}>
        {activeSiteId && (
          <SitePlanner
            key={`${activeSiteId}:${loadEpoch}`}
            active={mode === "plan"}
            siteId={activeSiteId}
            overlays={overlays}
            setOverlays={setOverlays}
            cloud={cloud}
            layerStatus={layerStatus}
            setLayerStatus={setLayerStatus}
            sites={sites}
            onBackToMap={() => setMode("map")}
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
      {cloudLoading && (
        <div style={{ position: "fixed", inset: 0, zIndex: 4500, background: "rgba(20,18,15,0.35)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ background: "rgba(25,22,19,0.92)", color: "#ece7db", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>Loading your sites…</div>
        </div>
      )}
      {cloudError && (
        <div role="alert" style={{ position: "fixed", top: 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#7c2d12", color: "#fff", border: "1px solid #b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          <span style={{ flex: 1 }}>{cloudError}</span>
          <button onClick={() => setCloudError("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}
      {deleteError && (
        <div role="alert" style={{ position: "fixed", top: cloudError ? 136 : 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#7c2d12", color: "#fff", border: "1px solid #b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          <span style={{ flex: 1 }}>{deleteError}</span>
          <button onClick={() => setDeleteError("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
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
          <button onClick={() => { setHideMigrate(true); setMigrateMsg(""); }} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

      {/* The cloud/connection state is now folded into the planner header's single
          save/sync badge (synced / syncing / offline / error) — see SitePlanner.
          On the map, signed-in state is shown by the shell account control. */}

      {showReviewModal && signedInUid && (
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
      )}

      {/* In-planner migration decision banner — shown when the user opened a legacy site
          via "Open →" in the migration modal. Stays until they Save or Discard. */}
      {mode === "plan" && (migrationPendingSiteId || migrationSaveMsg) && (
        <div role="status" style={{ position: "fixed", top: 79, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#1f2a44", color: "#eaf0ff", border: "1px solid #3b5bbf", borderRadius: 10, padding: "9px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          {migrationSaveMsg ? (
            <>
              <span style={{ flex: 1 }}>{migrationSaveMsg}</span>
              <button onClick={() => setMigrationSaveMsg("")} style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
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
