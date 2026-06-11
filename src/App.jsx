import { useEffect, useState } from "react";
import MapFinder from "./MapFinder.jsx";
import SitePlanner from "./SitePlanner.jsx";
import { migrateOldAutosave, loadSitesList, loadSite, saveSite, deleteSite, getCurrentSiteId, setCurrentSiteId } from "./lib/storage.js";

migrateOldAutosave(); // bring any legacy single-slot autosave into the site store

const newId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

/* Two surfaces: a map to find/select parcels, and the planner to design on a
 * site. Every site autosaves to its own record, so the map can list them and
 * starting/opening another never loses the one you were on. */
export default function App() {
  const [county, setCounty] = useState("harris");
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

  // A fresh selection from the map → a brand-new site (current one is autosaved).
  const newSiteFromMap = (payload) => {
    const id = newId();
    const parcels = (payload.parcels || [])
      .filter((p) => p.points?.length >= 3)
      .map((p, i) => ({ id: `p${id}_${i}`, points: p.points }));
    saveSite({ id, name: payload.name || "Untitled site", origin: payload.origin || null, parcels, els: [], measures: [], settings: {}, underlay: payload.underlay || null });
    refreshSites();
    goPlan(id);
  };

  // "Open blank planner" → a new empty (un-located) site.
  const newBlankSite = () => {
    const id = newId();
    saveSite({ id, name: "Untitled site", origin: null, parcels: [], els: [], measures: [], settings: {}, underlay: null });
    refreshSites();
    goPlan(id);
  };

  // Iteration: clone an existing site into a fresh record (its own id) so you can
  // explore a variant without touching the original. The planner flushes its live
  // state before calling this, so loadSite() here sees the latest edits.
  const duplicateSite = (srcId) => {
    const src = loadSite(srcId);
    if (!src) return;
    const id = newId();
    saveSite({ ...src, id, name: `${src.name || "Untitled site"} (copy)`, origin: src.origin || null });
    refreshSites();
    goPlan(id);
  };

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
          sites={sites}
          activeSiteId={activeSiteId}
          onOpenSite={openSite}
          onDeleteSite={(id) => { deleteSite(id); if (id === activeSiteId) setActiveSiteId(null); refreshSites(); }}
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
            sites={sites}
            onBackToMap={() => setMode("map")}
            onOpenSite={openSite}
            onNewSite={newBlankSite}
            onDuplicateSite={duplicateSite}
          />
        )}
      </div>
    </>
  );
}
