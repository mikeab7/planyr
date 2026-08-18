/* FoodApp — the /food workspace root. A private place-tracker: browse food places on a map,
 * click one to log a visit (rating, cost, what you had, notes), or drop a pin for the taco
 * truck no dataset has. A list view sorts everywhere you've been by rating, cost or date.
 *
 * Deliberately small — this is the whole interaction surface the module asks for, and no more:
 * pan/zoom, pins, click-to-log, a list, search, manual pins. No photos, no sharing, no AI, no
 * offline mode (see the module's CLAUDE.md pointer for why each of those is out).
 *
 * ⛔ BUNDLE ISOLATION — this file and everything under src/workspaces/food/ must import
 * NOTHING from src/workspaces/site-planner. Even Supabase gets its own three-line client
 * (lib/supabaseClient.js) instead of reusing site-planner's, so this route's bundle can never
 * grow because a planner file changed.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import FoodMap from "./components/FoodMap.jsx";
import VisitPanel from "./components/VisitPanel.jsx";
import VisitList from "./components/VisitList.jsx";
import SearchBox from "./components/SearchBox.jsx";
import {
  supabaseConfigured, fetchPlacesInBounds, fetchAllVisits, fetchPlacesByIds,
  insertVisit, updateVisit, deleteVisit, manualPinsFromVisits, loggedPlaceIds, avgRatingByPlaceId,
  searchPlacesByName,
} from "./lib/foodStore.js";
import { searchOverpass } from "./lib/overpass.js";

export default function FoodApp({ shellModule, onShellSwitch, onGoDashboard, authControl, accountActive, userId }) {
  const [view, setView] = useState("map"); // "map" | "list"
  const [bounds, setBounds] = useState(null);
  const [places, setPlaces] = useState([]);
  const [placesCap, setPlacesCap] = useState({ capped: false, totalMatched: 0 });
  const [overpassPlaces, setOverpassPlaces] = useState([]);
  const [visits, setVisits] = useState([]);
  const [placeNames, setPlaceNames] = useState({}); // id -> {name, lat, lon}
  const [selected, setSelected] = useState(null); // {kind:'place'|'manualPin'|'newPin', ...}
  const [pinMode, setPinMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [manualDraftName, setManualDraftName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [flyToTarget, setFlyToTarget] = useState(null);
  const flyNonceRef = useRef(0);

  // Places in the current map viewport — public read, works signed out too.
  useEffect(() => {
    if (!bounds) return;
    let cancelled = false;
    fetchPlacesInBounds(bounds).then(({ data, capped, totalMatched }) => {
      if (cancelled) return;
      setPlaces(data);
      setPlacesCap({ capped, totalMatched });
    });
    return () => { cancelled = true; };
  }, [bounds]);

  // The signed-in user's own visit log, plus a name lookup for every place they've logged
  // (which can be well outside whatever the map currently shows).
  const reloadVisits = useCallback(async () => {
    if (!accountActive) { setVisits([]); setPlaceNames({}); return; }
    const { data } = await fetchAllVisits();
    setVisits(data);
    const ids = [...new Set(data.filter((v) => v.place_id).map((v) => v.place_id))];
    if (ids.length) {
      const { data: rows } = await fetchPlacesByIds(ids);
      setPlaceNames(Object.fromEntries(rows.map((r) => [r.id, r])));
    } else {
      setPlaceNames({});
    }
  }, [accountActive]);
  useEffect(() => { reloadVisits(); }, [reloadVisits]);

  const loggedIds = useMemo(() => loggedPlaceIds(visits), [visits]);
  const manualPins = useMemo(() => manualPinsFromVisits(visits), [visits]);
  const avgRatings = useMemo(() => avgRatingByPlaceId(visits), [visits]);
  // Every place he's logged, anywhere — independent of the current map viewport, per the
  // redesign's "his places are always visible, at every zoom level." Carries avgRating so
  // the map can colour the pin along the 1-10 ramp.
  const loggedPlaces = useMemo(
    () => Object.values(placeNames).map((p) => ({ ...p, avgRating: avgRatings.get(p.id) })),
    [placeNames, avgRatings]
  );

  const visitsForSelected = useMemo(() => {
    if (!selected) return [];
    if (selected.kind === "place") return visits.filter((v) => v.place_id === selected.place.id);
    if (selected.kind === "manualPin") return visits.filter((v) => selected.pin.visitIds.includes(v.id));
    return [];
  }, [selected, visits]);

  const listRows = useMemo(() => visits.map((v) => ({
    ...v,
    placeName: v.place_id ? (placeNames[v.place_id]?.name || "…") : v.custom_name,
  })), [visits, placeNames]);

  const openPlace = useCallback((place) => { setSelected({ kind: "place", place }); setError(null); }, []);
  const openManualPin = useCallback((pin) => { setSelected({ kind: "manualPin", pin }); setError(null); }, []);
  const dropPin = useCallback((lat, lon) => {
    setSelected({ kind: "newPin", lat, lon });
    // manualDraftName is NOT reset here — startDropPinFor (below) may have pre-seeded it from
    // a search box's no-results state; togglePinMode (below) is what clears it for the plain
    // "Drop a pin" toolbar entry.
    setPinMode(false);
    setError(null);
  }, []);
  const closePanel = useCallback(() => setSelected(null), []);

  // Toolbar's plain "Drop a pin" button: blank name, exactly as before.
  const togglePinMode = useCallback(() => {
    if (!pinMode) setManualDraftName("");
    setPinMode((m) => !m);
  }, [pinMode]);

  // Search box's no-results escape hatch: pre-seed the name he already typed and jump straight
  // to "click the map" (owner, 2026-08-18: "the manual drop-a-pin path should be reachable from
  // a no-results state, because sometimes the answer is that the place simply is not in any
  // dataset").
  const startDropPinFor = useCallback((name) => {
    setManualDraftName(name);
    setView("map");
    setPinMode(true);
    setSearchQuery("");
  }, []);

  // Search result selected — fly the map to it (FoodMap watches flyToTarget.nonce so
  // re-selecting the SAME result twice in a row still flies).
  const flyTo = useCallback(({ lat, lon }) => {
    flyNonceRef.current += 1;
    setFlyToTarget({ lat, lon, nonce: flyNonceRef.current });
  }, []);

  const submitVisit = useCallback(async (fields) => {
    if (!selected) return;
    setPending(true); setError(null);
    const payload = selected.kind === "place"
      ? { place_id: selected.place.id, ...fields }
      : selected.kind === "manualPin"
        ? { place_id: null, custom_name: selected.pin.name, custom_lat: selected.pin.lat, custom_lon: selected.pin.lon, ...fields }
        : { place_id: null, custom_name: manualDraftName || "Unnamed place", custom_lat: selected.lat, custom_lon: selected.lon, ...fields };
    if (selected.kind === "newPin" && !manualDraftName.trim()) {
      setPending(false);
      setError("Give this place a name first.");
      return;
    }
    const { error: err } = await insertVisit(payload);
    setPending(false);
    if (err) { setError(err.message || "Couldn't save that visit."); return; }
    await reloadVisits();
    if (selected.kind === "newPin") setSelected(null); // the pin now exists as a manual pin; close and let it re-render from data
  }, [selected, manualDraftName, reloadVisits]);

  const removeVisit = useCallback(async (id) => {
    const { error: err } = await deleteVisit(id);
    if (err) { setError(err.message || "Couldn't delete that visit."); return; }
    await reloadVisits();
  }, [reloadVisits]);

  const searchHere = useCallback(async () => {
    if (!bounds) return;
    const { data, error: err } = await searchOverpass(bounds);
    if (err) { setError("Live search failed — try again in a moment."); return; }
    setOverpassPlaces(data);
  }, [bounds]);

  const panelTitle = selected?.kind === "place" ? selected.place.name
    : selected?.kind === "manualPin" ? selected.pin.name : null;
  const panelSubtitle = selected?.kind === "place"
    ? [selected.place.category?.replace(/_/g, " "), selected.place.address].filter(Boolean).join(" · ")
    : null;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--surface-page)", position: "relative" }}>
      <AppHeader
        module={shellModule || "food"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        authControl={authControl}
        accountActive={accountActive}
        multiEditOk
        toolbarContent={
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ display: "flex", border: "1px solid var(--border-default)", borderRadius: 8, overflow: "hidden" }}>
              {["map", "list"].map((v) => (
                <button
                  key={v} type="button" onClick={() => setView(v)} aria-pressed={view === v}
                  style={{
                    border: "none", padding: "6px 14px", cursor: "pointer", font: "inherit", fontSize: 12.5, fontWeight: 700,
                    background: view === v ? "var(--accent-food)" : "transparent",
                    color: view === v ? "var(--on-accent-food)" : "var(--text-primary)",
                  }}
                >
                  {v === "map" ? "Map" : "List"}
                </button>
              ))}
            </div>
            {view === "map" && (
              <button
                type="button" onClick={togglePinMode} aria-pressed={pinMode}
                title="Drop a pin for a place not on the map"
                style={{
                  border: "1px solid var(--border-default)", borderRadius: 8, padding: "6px 12px", cursor: "pointer",
                  font: "inherit", fontSize: 12.5, fontWeight: 700,
                  background: pinMode ? "var(--accent-food)" : "transparent",
                  color: pinMode ? "var(--on-accent-food)" : "var(--text-primary)",
                }}
              >
                📍 {pinMode ? "Click the map…" : "Drop a pin"}
              </button>
            )}
            <SearchBox
              query={searchQuery} onQueryChange={setSearchQuery} view={view}
              manualPins={manualPins} loggedIds={loggedIds} bounds={bounds}
              searchSnapshot={searchPlacesByName} onSelectPlace={openPlace} onSelectManualPin={openManualPin}
              onFlyTo={flyTo} onRequestLiveSearch={searchHere} overpassPlaces={overpassPlaces}
              onStartDropPinFor={startDropPinFor}
            />
          </div>
        }
      />

      {!supabaseConfigured() && (
        <div role="status" style={{ padding: "6px 16px", fontSize: 12.5, color: "var(--warn-text)", background: "var(--warn-bg)" }}>
          Not connected to the cloud in this build — places will show, but visits can't be saved.
        </div>
      )}
      {supabaseConfigured() && !accountActive && (
        <div role="status" style={{ padding: "6px 16px", fontSize: 12.5, color: "var(--text-secondary)", background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)" }}>
          Sign in to log visits — browsing the map works either way.
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, position: "relative", display: "flex" }}>
        {view === "map" ? (
          <FoodMap
            places={places}
            placesCapped={placesCap.capped}
            placesTotalMatched={placesCap.totalMatched}
            loggedPlaces={loggedPlaces}
            loggedIds={loggedIds}
            manualPins={manualPins}
            overpassPlaces={overpassPlaces}
            onSelectPlace={openPlace}
            onSelectManualPin={openManualPin}
            pinMode={pinMode}
            onDropPin={dropPin}
            onViewChanged={setBounds}
            onRequestSearchHere={searchHere}
            flyToTarget={flyToTarget}
          />
        ) : (
          <VisitList visits={listRows} query={searchQuery} onSelect={(v) => {
            if (v.place_id && placeNames[v.place_id]) {
              openPlace({ id: v.place_id, name: placeNames[v.place_id].name });
            } else if (!v.place_id) {
              openManualPin({ name: v.custom_name, lat: v.custom_lat, lon: v.custom_lon, visitIds: visits.filter((x) => !x.place_id && x.custom_name === v.custom_name).map((x) => x.id) });
            }
          }} />
        )}

        {selected && (
          <VisitPanel
            key={selected.kind === "place" ? `place:${selected.place.id}` : selected.kind === "manualPin" ? `pin:${selected.pin.key || selected.pin.name}` : "new-pin"}
            title={panelTitle}
            subtitle={panelSubtitle}
            pastVisits={visitsForSelected}
            onClose={closePanel}
            onSubmitVisit={accountActive ? submitVisit : undefined}
            onDeleteVisit={removeVisit}
            pending={pending}
            error={error || (!accountActive ? "Sign in to log a visit here." : null)}
            manualNameEditable={selected.kind === "newPin"}
            manualName={manualDraftName}
            onManualNameChange={setManualDraftName}
          />
        )}
      </div>
    </div>
  );
}
