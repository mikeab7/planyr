import { useEffect, useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import { defaultOverlayState } from "./lib/layers.js";
import { testConnection, supabaseConfigured, connectionInfo } from "./lib/supabase.js";
import { getUser, onAuthChange } from "./lib/auth.js";
import AuthPanel from "./components/AuthPanel.jsx";
import { migrateOldAutosave, migrateSiteGroups, migrateScenarios, loadSitesList, loadPlansOfGroup, renameSiteGroup, groupOf, loadSite, saveSite, deleteSite, getCurrentSiteId, setCurrentSiteId, setActiveUser, pushSiteToCloud } from "./lib/storage.js";

migrateOldAutosave(); // bring any legacy single-slot autosave into the site store
migrateSiteGroups();  // give every legacy record a site (location) group
migrateScenarios();   // fold legacy named scenarios into Plans

const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* Two surfaces: a map to find/select parcels, and the planner to design on a
 * site. Every site autosaves to its own record, so the map can list them and
 * starting/opening another never loses the one you were on. */
export default function App() {
  const [county, setCounty] = useState("harris");
  // Shared map-layer overlay state — ONE source of truth for both pages, so a
  // layer toggled on the map finder is reflected in the planner and vice-versa
  // (global app preference; per-site memory is reserved in the site model, TBD).
  const [overlays, setOverlays] = useState(defaultOverlayState);
  // Per-layer load status (id → {state, msg}), app-shared so the Layers panel on
  // either page shows which layers are actually painting vs failed/empty.
  const [layerStatus, setLayerStatus] = useState({});
  const [sites, setSites] = useState(() => loadSitesList());
  const [activeSiteId, setActiveSiteId] = useState(() => {
    const cur = getCurrentSiteId();
    return cur && loadSite(cur) ? cur : null;
  });
  // Resume into the planner if there's an active site to pick up.
  const [mode, setMode] = useState(() => (getCurrentSiteId() && loadSite(getCurrentSiteId()) ? "plan" : "map"));
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

  // PHASE 2: Supabase auth state (login only — does NOT change save/load). Tracks
  // the signed-in user and opens the password form on a recovery-link return.
  const [user, setUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabaseConfigured()) return;
    getUser().then((u) => { setUser(u); setActiveUser(u && u.id); });
    return onAuthChange((event, u) => {
      setUser(u);
      setActiveUser(u && u.id); // logged in → cloud is the home for saves; logged out → localStorage
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setAuthOpen(true); }
    });
  }, []);

  const refreshSites = () => setSites(loadSitesList());
  const goPlan = (id) => { setCurrentSiteId(id); setActiveSiteId(id); setMode("plan"); };

  // Open a saved site from the map.
  const openSite = (id) => { if (loadSite(id)) goPlan(id); };

  // A fresh selection from the map → a brand-new site, with its first plan.
  const newSiteFromMap = (payload) => {
    const id = newId();
    const parcels = (payload.parcels || [])
      .filter((p) => p.points?.length >= 3)
      .map((p, i) => ({ id: `p${id}_${i}`, points: p.points, locked: true, addr: p.addr || null, acct: p.acct || null, attrs: p.attrs || null }));
    saveSite({ id, groupId: id, site: payload.name || "Untitled site", name: "Plan 1", origin: payload.origin || null, county: payload.county || null, parcels, els: [], measures: [], settings: {}, underlay: payload.underlay || null });
    pushSiteToCloud(id).catch(() => {}); // mirror to cloud when logged in (no-op otherwise)
    refreshSites();
    goPlan(id);
  };

  // "Open blank planner" → a new empty (un-located) site. We do NOT write a record
  // yet: a blank site that's never edited should never be saved. The planner saves
  // a fully-formed record the moment you add anything.
  const newBlankSite = () => { goPlan(newId()); };

  // Next plan number for a site (so "Plan 1", "Plan 2", … never collide).
  const nextPlanNo = (groupId) => loadPlansOfGroup(groupId).length + 1;

  // New plan on the SAME site: keep the location (parcel, origin, aerial) but
  // start the layout fresh. This is the iteration workflow — explore another
  // layout without leaving the parcel.
  const newPlanSameParcel = (srcId) => {
    const src = loadSite(srcId);
    if (!src) return;
    const group = groupOf(src);
    const id = newId();
    saveSite({ id, groupId: group, site: src.site || src.name, name: `Plan ${nextPlanNo(group)}`,
      origin: src.origin || null, parcels: src.parcels || [], els: [], measures: [], settings: src.settings || {}, underlay: src.underlay || null });
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

  const renameSite = (groupId, site) => { renameSiteGroup(groupId, site); loadPlansOfGroup(groupId).forEach((s) => pushSiteToCloud(s.id).catch(() => {})); refreshSites(); };
  const renamePlan = (id, name) => { saveSite({ id, name }); pushSiteToCloud(id).catch(() => {}); refreshSites(); };

  // The planner dropped a blank, unedited site (never saved). Forget it.
  const handleSiteDropped = (id) => { if (id === activeSiteId) setActiveSiteId(null); refreshSites(); };

  // Delete a whole site (every plan in its group) — used from the map, where each
  // entry represents a location, not an individual plan.
  const deleteSiteGroup = (id) => {
    const rec = loadSite(id); if (!rec) return;
    const plans = loadPlansOfGroup(groupOf(rec));
    const hadActive = plans.some((s) => s.id === activeSiteId);
    plans.forEach((s) => deleteSite(s.id));
    if (hadActive) setActiveSiteId(null);
    refreshSites();
  };

  // The map lists SITES (locations), so collapse plans to one representative per
  // group — preferring the active plan so its pin highlights correctly.
  const siteGroups = (() => {
    const byGroup = new Map();
    sites.forEach((s) => { const g = groupOf(s); if (!byGroup.has(g)) byGroup.set(g, s); });
    const act = activeSiteId && sites.find((s) => s.id === activeSiteId);
    if (act) byGroup.set(groupOf(act), act);
    return [...byGroup.values()];
  })();

  // Refresh the map's site list when we land back on it (after the planner has
  // autosaved the latest edits).
  useEffect(() => {
    if (mode === "map") { const t = setTimeout(refreshSites, 80); return () => clearTimeout(t); }
  }, [mode]);

  return (
    <>
      <div style={{ display: mode === "map" ? "block" : "none", height: "100vh" }}>
        <MapFinder
          visible={mode === "map"}
          county={county}
          onCounty={setCounty}
          overlays={overlays}
          setOverlays={setOverlays}
          layerStatus={layerStatus}
          setLayerStatus={setLayerStatus}
          sites={siteGroups}
          activeSiteId={activeSiteId}
          onOpenSite={openSite}
          onDeleteSite={deleteSiteGroup}
          onUseParcels={newSiteFromMap}
          onSkip={newBlankSite}
        />
      </div>
      <div style={{ display: mode === "plan" ? "block" : "none", height: "100vh" }}>
        {activeSiteId && (
          <SitePlanner
            key={activeSiteId}
            active={mode === "plan"}
            siteId={activeSiteId}
            overlays={overlays}
            setOverlays={setOverlays}
            layerStatus={layerStatus}
            setLayerStatus={setLayerStatus}
            sites={sites}
            onBackToMap={() => setMode("map")}
            onOpenSite={openSite}
            onNewSite={newBlankSite}
            onNewPlanSameParcel={newPlanSameParcel}
            onDuplicateSite={duplicatePlan}
            onRenameSite={renameSite}
            onRenamePlan={renamePlan}
            onSiteDropped={handleSiteDropped}
            onSiteSaved={refreshSites}
          />
        )}
      </div>
      {/* PHASE 2 account control (login only; storage unchanged) */}
      {supabaseConfigured() && (
        <button onClick={() => { setRecovery(false); setAuthOpen(true); }}
          title={user ? `Signed in as ${user.email}` : "Sign in / create account"}
          style={{ position: "fixed", right: 6, bottom: 46, zIndex: 4000, display: "flex", alignItems: "center", gap: 6, maxWidth: 200,
            background: "rgba(25,22,19,0.82)", color: "#ece7db", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 99, padding: "3px 10px", fontSize: 10.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", cursor: "pointer", boxShadow: "0 2px 8px rgba(0,0,0,0.25)" }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, flex: "none", background: user ? "#15803d" : "#9b9482" }} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user ? user.email : "Sign in"}</span>
        </button>
      )}
      {authOpen && <AuthPanel user={user} recovery={recovery} onClose={() => { setAuthOpen(false); setRecovery(false); }} />}

      {/* PHASE 1 Supabase connection indicator (diagnostic; no data read/written) */}
      {(() => {
        const meta = {
          checking: { dot: "#f59e0b", label: "Cloud…" },
          connected: { dot: "#15803d", label: "Cloud ✓" },
          "not-configured": { dot: "#9b9482", label: "Cloud off" },
          "bad-key": { dot: "#b91c1c", label: "Cloud key" },
          error: { dot: "#b91c1c", label: "Cloud err" },
        }[cloud.state] || { dot: "#9b9482", label: "Cloud" };
        return (
          <div title={cloud.message || "Supabase connection (Phase 1 — no data synced yet)"}
            style={{ position: "fixed", right: 6, bottom: 22, zIndex: 4000, display: "flex", alignItems: "center", gap: 5,
              background: "rgba(25,22,19,0.82)", color: "#ece7db", borderRadius: 99, padding: "3px 9px", fontSize: 10.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 2px 8px rgba(0,0,0,0.25)", pointerEvents: "auto" }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: meta.dot, animation: cloud.state === "checking" ? "pf-pulse 1.1s ease-in-out infinite" : "none" }} />
            {meta.label}
          </div>
        );
      })()}
    </>
  );
}
