import { useEffect, useMemo, useRef, useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import { defaultOverlayState } from "./lib/layers.js";
import { testConnection, supabaseConfigured, connectionInfo } from "./lib/supabase.js";
import { onAuthChange } from "./lib/auth.js";
import { migrateOldAutosave, migrateSiteGroups, migrateScenarios, loadSitesList, loadPlansOfGroup, renameSiteGroup, groupOf, loadSite, saveSite, deleteSite, getCurrentSiteId, setCurrentSiteId, setActiveUser, pushSiteToCloud, pullCloud, clearCloudCache } from "./lib/storage.js";

migrateOldAutosave(); // bring any legacy single-slot autosave into the site store
migrateSiteGroups();  // give every legacy record a site (location) group
migrateScenarios();   // fold legacy named scenarios into Plans

const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* Two surfaces: a map to find/select parcels, and the planner to design on a
 * site. Every site autosaves to its own record, so the map can list them and
 * starting/opening another never loses the one you were on. */
export default function App() {
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

  // Supabase auth → data-store switching only. The account UI (sign in/out, modal)
  // is global in the shell; here we just react to auth to switch cloud↔local storage.
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState(""); // "couldn't load from cloud" — shown instead of silently wiping to empty (B54)
  const prevUid = useRef(null);
  const applySeq = useRef(0); // monotonic token so overlapping auth events can't interleave (B43)

  // Switch the data store on sign-in / sign-out. Logged in → pull the user's cloud
  // sites into their local cache and make that the active store (cloud is home);
  // logged out → back to the legacy localStorage store. Reset the view on a real
  // switch so we never show one account's pointer against another's data.
  const applyUser = async (u, event) => {
    const seq = ++applySeq.current; // capture before the await; a newer auth event bumps it
    const uid = (u && u.id) || null;
    setActiveUser(uid);
    if (uid) {
      setCloudLoading(true);
      const res = await pullCloud(uid).catch(() => ({ ok: false }));
      if (seq !== applySeq.current) return; // superseded by a newer auth event — don't apply stale cloud/view state (B43)
      setCloudLoading(false);
      // B54: a failed fetch no longer wipes the cache — say we're showing the last
      // synced copy rather than presenting a silent (and scary) empty library.
      setCloudError(res && res.ok === false ? "Couldn't reach the cloud — showing your last synced copy. Your saved sites are safe; reconnect to refresh." : "");
      const cur = getCurrentSiteId();
      if (cur && loadSite(cur)) { setActiveSiteId(cur); setMode("plan"); } // resume if it's one of theirs
      else { setActiveSiteId(null); setMode("map"); }
      refreshSites();
    } else {
      if (prevUid.current) clearCloudCache(prevUid.current); // don't leave cloud data cached after logout
      setCloudError("");
      if (event === "SIGNED_OUT") { setActiveSiteId(null); setMode("map"); }
      refreshSites();
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
      <div style={{ display: mode === "map" ? "block" : "none", height: "100%" }}>
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
          onUseParcels={newSiteFromMap}
          onSkip={newBlankSite}
        />
      </div>
      <div style={{ display: mode === "plan" ? "block" : "none", height: "100%" }}>
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
      {/* account control is global in the shell header (top-right) */}
      {cloudLoading && (
        <div style={{ position: "fixed", inset: 0, zIndex: 4500, background: "rgba(20,18,15,0.35)", display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div style={{ background: "rgba(25,22,19,0.92)", color: "#ece7db", borderRadius: 10, padding: "10px 18px", fontSize: 13, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>Loading your sites…</div>
        </div>
      )}
      {cloudError && (
        <div role="alert" style={{ position: "fixed", top: 46, left: "50%", transform: "translateX(-50%)", zIndex: 4600, maxWidth: 560, display: "flex", alignItems: "center", gap: 10, background: "#7c2d12", color: "#fff", border: "1px solid #b91c1c", borderRadius: 10, padding: "8px 12px", fontSize: 12.5, fontWeight: 600, fontFamily: "system-ui, sans-serif", boxShadow: "0 8px 28px rgba(0,0,0,0.3)" }}>
          <span style={{ flex: 1 }}>{cloudError}</span>
          <button onClick={() => setCloudError("")} title="Dismiss" style={{ flex: "none", cursor: "pointer", background: "rgba(255,255,255,0.15)", color: "#fff", border: "none", borderRadius: 6, padding: "2px 8px", fontFamily: "inherit", fontSize: 12, fontWeight: 700 }}>✕</button>
        </div>
      )}

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
