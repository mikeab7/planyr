import { useEffect, useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import { defaultOverlayState } from "./lib/layers.js";
import { migrateOldAutosave, migrateSiteGroups, migrateScenarios, loadSitesList, loadPlansOfGroup, renameSiteGroup, groupOf, loadSite, saveSite, deleteSite, getCurrentSiteId, setCurrentSiteId } from "./lib/storage.js";

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
  const [sites, setSites] = useState(() => loadSitesList());
  const [activeSiteId, setActiveSiteId] = useState(() => {
    const cur = getCurrentSiteId();
    return cur && loadSite(cur) ? cur : null;
  });
  // Resume into the planner if there's an active site to pick up.
  const [mode, setMode] = useState(() => (getCurrentSiteId() && loadSite(getCurrentSiteId()) ? "plan" : "map"));

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
    refreshSites();
    goPlan(id);
  };

  const renameSite = (groupId, site) => { renameSiteGroup(groupId, site); refreshSites(); };
  const renamePlan = (id, name) => { saveSite({ id, name }); refreshSites(); };

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
    </>
  );
}
