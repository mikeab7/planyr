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
  searchPlacesByName, fetchAllWishlist, addWishlist, removeWishlist, wishlistedPlaceIds,
  manualWishlistFromRows, manualGroupKey,
} from "./lib/foodStore.js";
import { searchOverpass } from "./lib/overpass.js";
import { RADIUS } from "../../shared/ui/radius.js";

export default function FoodApp({ shellModule, onShellSwitch, onGoDashboard, authControl, accountActive, userId }) {
  const [view, setView] = useState("map"); // "map" | "list"
  const [bounds, setBounds] = useState(null);
  const [places, setPlaces] = useState([]);
  const [placesCap, setPlacesCap] = useState({ capped: false, totalMatched: 0 });
  const [overpassPlaces, setOverpassPlaces] = useState([]);
  const [visits, setVisits] = useState([]);
  const [wishlist, setWishlist] = useState([]); // "want to try" flags (B669312) — food_wishlist rows
  const [placeNames, setPlaceNames] = useState({}); // id -> {name, lat, lon}
  const [selected, setSelected] = useState(null); // {kind:'place'|'manualPin'|'newPin', ...}
  const [pinMode, setPinMode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [manualDraftName, setManualDraftName] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [flyToTarget, setFlyToTarget] = useState(null);
  const flyNonceRef = useRef(0);
  // NEW-1 (2nd owner block, 2026-08-23) — the map's own bottom-anchored notices (zoom-gate,
  // capped, "search live for more here") need to sit above the mobile bottom sheet's REAL current
  // top edge, not a static guess — BottomSheet already tracks its own height precisely (peek/half/
  // full, mid-drag); VisitPanel forwards it up via onSheetHeightChange. 0 whenever no panel is
  // open (desktop never opens a sheet at all — VisitPanel's right-rail branch never calls this).
  const [sheetHeightPx, setSheetHeightPx] = useState(0);
  // NEW-1 (2026-08-27 owner block) — a monotonic id for optimistic visit rows, mirroring
  // flyNonceRef's own pattern. Never collides with a real row's uuid (a distinct "optimistic-N"
  // shape), so filtering it back out on rollback can never accidentally remove a real visit.
  const optimisticIdRef = useRef(0);

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

  // The signed-in user's own visit log.
  const reloadVisits = useCallback(async () => {
    if (!accountActive) { setVisits([]); return; }
    const { data } = await fetchAllVisits();
    setVisits(data);
  }, [accountActive]);
  useEffect(() => { reloadVisits(); }, [reloadVisits]);

  // The signed-in user's "want to try" flags (B669312) — a separate table from visits (see
  // foodStore.js's header comment on food_wishlist for why a flag can't live on either
  // food_places or food_visits).
  const reloadWishlist = useCallback(async () => {
    if (!accountActive) { setWishlist([]); return; }
    const { data } = await fetchAllWishlist();
    setWishlist(data);
  }, [accountActive]);
  useEffect(() => { reloadWishlist(); }, [reloadWishlist]);

  // A name/lat/lon lookup for every place he's logged OR flagged (which can be well outside
  // whatever the map currently shows) — the union of both tables' place_ids, one batch fetch.
  useEffect(() => {
    if (!accountActive) { setPlaceNames({}); return; }
    const ids = [...new Set([
      ...visits.filter((v) => v.place_id).map((v) => v.place_id),
      ...wishlist.filter((w) => w.place_id).map((w) => w.place_id),
    ])];
    if (!ids.length) { setPlaceNames({}); return; }
    let cancelled = false;
    fetchPlacesByIds(ids).then(({ data }) => {
      if (cancelled) return;
      setPlaceNames(Object.fromEntries(data.map((r) => [r.id, r])));
    });
    return () => { cancelled = true; };
  }, [accountActive, visits, wishlist]);

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

  // "Want to try" (B669312) — flagged places/pins, EXCLUDING anything already visited (a place
  // that's flagged and also visited must read as visited, never as want-to-try; the auto-clear
  // in submitVisit below keeps this true in steady state, this filter keeps it true even if a
  // clear hasn't landed yet). Manual pins matched by the same rounded (name, lat, lon) key
  // manualPinsFromVisits already groups visited manual pins by.
  const wishlistIds = useMemo(() => wishlistedPlaceIds(wishlist), [wishlist]);
  const manualWishlistAll = useMemo(() => manualWishlistFromRows(wishlist), [wishlist]);
  const manualPinKeys = useMemo(() => new Set(manualPins.map((p) => p.key)), [manualPins]);
  const wishlistPlaces = useMemo(
    () => [...wishlistIds].filter((id) => !loggedIds.has(id)).map((id) => placeNames[id]).filter(Boolean),
    [wishlistIds, loggedIds, placeNames]
  );
  const wishlistManualPins = useMemo(
    () => manualWishlistAll.filter((p) => !manualPinKeys.has(p.key)),
    [manualWishlistAll, manualPinKeys]
  );

  const visitsForSelected = useMemo(() => {
    if (!selected) return [];
    if (selected.kind === "place") return visits.filter((v) => v.place_id === selected.place.id);
    if (selected.kind === "manualPin") return visits.filter((v) => selected.pin.visitIds.includes(v.id));
    return [];
  }, [selected, visits]);

  // List view rows: every logged visit, PLUS every flagged-but-unvisited place (B669312 — "flagged
  // places appear there [in the list]"). A wishlist-only row carries no visit facts (rating/cost/
  // date all null, matching how the table already renders a visit that never set them) and
  // `isWishlist: true`, which VisitList's own shortlist filter chip reads.
  const listRows = useMemo(() => {
    const visitRows = visits.map((v) => ({
      ...v,
      placeName: v.place_id ? (placeNames[v.place_id]?.name || "…") : v.custom_name,
      isWishlist: false,
    }));
    const wishlistOnlyRows = wishlist
      .filter((w) => (w.place_id ? !loggedIds.has(w.place_id) : !manualPinKeys.has(manualGroupKey(w.custom_name, w.custom_lat, w.custom_lon))))
      .map((w) => ({
        id: `wish:${w.id}`, place_id: w.place_id,
        custom_name: w.custom_name, custom_lat: w.custom_lat, custom_lon: w.custom_lon,
        placeName: w.place_id ? (placeNames[w.place_id]?.name || "…") : w.custom_name,
        rating: null, rating_ambiance: null, cost: null, visited_on: null, what_i_had: null, what_was_good: null,
        isWishlist: true,
      }));
    return [...visitRows, ...wishlistOnlyRows];
  }, [visits, wishlist, placeNames, loggedIds, manualPinKeys]);

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
  const closePanel = useCallback(() => { setSelected(null); setSheetHeightPx(0); }, []);

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

  // B668194 — returns whether the save actually succeeded, so VisitForm can clear its own
  // fields ONLY on a confirmed write (see VisitPanel.jsx's header comment) rather than leaving
  // stale text sitting in the boxes, or clearing it before a failed save is even known about.
  const submitVisit = useCallback(async (fields) => {
    if (!selected) return false;
    setPending(true); setError(null);
    const payload = selected.kind === "place"
      ? { place_id: selected.place.id, ...fields }
      : selected.kind === "manualPin"
        ? { place_id: null, custom_name: selected.pin.name, custom_lat: selected.pin.lat, custom_lon: selected.pin.lon, ...fields }
        : { place_id: null, custom_name: manualDraftName || "Unnamed place", custom_lat: selected.lat, custom_lon: selected.lon, ...fields };
    if (selected.kind === "newPin" && !manualDraftName.trim()) {
      setPending(false);
      setError("Give this place a name first.");
      return false;
    }
    // NEW-1 (2026-08-27 owner block, verbatim: "when I click log this visit, it should not make
    // it seem like nothing happened") — OPTIMISTIC add, so the Past-visits list, the aggregates,
    // the panel's own visited/not-visited state, and the map pin (a hollow want-to-try pin
    // becoming a filled rated one) all update in the SAME beat as the click, before the network
    // round-trip resolves — `loggedPlaces`/`manualPins`/`avgRatings` above are all memoized off
    // this `visits` state, so one push here drives every one of them at once. Rolled back below
    // on a failed write — "never leave a phantom visit on screen" per the owner's own instruction.
    const optimisticId = `optimistic-${++optimisticIdRef.current}`;
    const optimisticVisit = { ...payload, id: optimisticId, created_at: new Date().toISOString() };
    setVisits((v) => [optimisticVisit, ...v]);

    const { error: err } = await insertVisit(payload);
    setPending(false);
    if (err) {
      setVisits((v) => v.filter((x) => x.id !== optimisticId)); // rollback — never a phantom visit
      setError(err.message || "Couldn't save that visit.");
      return false;
    }
    // First visit at a flagged place clears the flag automatically (B669312, owner: "do not
    // prompt") — it's no longer a want-to-try once he's actually been. Matched by place_id, or
    // by the manual pin's own (name, lat, lon) key for a dropped/manual pin.
    const clearedWish = payload.place_id
      ? wishlist.find((w) => w.place_id === payload.place_id)
      : wishlist.find((w) => !w.place_id && manualGroupKey(w.custom_name, w.custom_lat, w.custom_lon) === manualGroupKey(payload.custom_name, payload.custom_lat, payload.custom_lon));
    if (clearedWish) await removeWishlist(clearedWish.id);
    await reloadVisits(); // replaces the optimistic row with the real, server-confirmed one — never a duplicate
    await reloadWishlist();
    if (selected.kind === "newPin") setSelected(null); // the pin now exists as a manual pin; close and let it re-render from data
    return true;
  }, [selected, manualDraftName, reloadVisits, reloadWishlist, wishlist]);

  // "Want to try" toggle (B669312) — one click on, one click off, working for a snapshot place,
  // an existing manual pin, or a brand-new dropped pin not yet saved anywhere (which needs a
  // name first, same validation submitVisit already applies to a newPin).
  const toggleWishlist = useCallback(async () => {
    if (!selected || !accountActive) return;
    setError(null);
    if (selected.kind === "place") {
      const existing = wishlist.find((w) => w.place_id === selected.place.id);
      const { error: err } = existing ? await removeWishlist(existing.id) : await addWishlist({ place_id: selected.place.id });
      if (err) { setError(err.message || "Couldn't update that flag."); return; }
    } else {
      const name = selected.kind === "manualPin" ? selected.pin.name : manualDraftName;
      const lat = selected.kind === "manualPin" ? selected.pin.lat : selected.lat;
      const lon = selected.kind === "manualPin" ? selected.pin.lon : selected.lon;
      if (!name || !name.trim()) { setError("Give this place a name first."); return; }
      const key = manualGroupKey(name, lat, lon);
      const existing = wishlist.find((w) => !w.place_id && manualGroupKey(w.custom_name, w.custom_lat, w.custom_lon) === key);
      const { error: err } = existing ? await removeWishlist(existing.id) : await addWishlist({ custom_name: name, custom_lat: lat, custom_lon: lon });
      if (err) { setError(err.message || "Couldn't update that flag."); return; }
    }
    await reloadWishlist();
  }, [selected, accountActive, wishlist, manualDraftName, reloadWishlist]);

  const removeVisit = useCallback(async (id) => {
    const { error: err } = await deleteVisit(id);
    if (err) { setError(err.message || "Couldn't delete that visit."); return; }
    await reloadVisits();
  }, [reloadVisits]);

  // NEW (2026-08-28 owner block, verbatim: "I should be able to edit previous visits") — the
  // SAME optimistic/rollback shape submitVisit above already uses: the edited fields land on the
  // card/aggregates/pin in the SAME beat as pressing Save (everything downstream is memoized off
  // this `visits` state), and a failed write reverts to the EXACT pre-edit row rather than leaving
  // an unsaved value on screen. `updateVisit` (lib/foodStore.js) was already written and imported
  // here but never wired to anything — a plain PostgREST `.update()`, which fires the
  // `food_visits_touch_updated_at` trigger (db/food.sql) on every write. That trigger IS this
  // table's "op-envelope" equivalent: a DB-enforced, client-unspoofable `updated_at` timestamp
  // that makes an edit attributable/auditable exactly like the site-planner's `operationEnvelope.js`
  // does for site_elements — just proportionate to a single-owner table with no multi-writer
  // collision surface to correlate, and reached with zero new schema (this table already had it)
  // rather than importing site-planner's own envelope module, which BUNDLE ISOLATION forbids
  // (see this workspace's CLAUDE.md) and which solves a concurrency problem this table doesn't have.
  const editVisit = useCallback(async (id, fields) => {
    setPending(true); setError(null);
    const original = visits.find((v) => v.id === id);
    setVisits((v) => v.map((x) => (x.id === id ? { ...x, ...fields } : x)));
    const { error: err } = await updateVisit(id, fields);
    setPending(false);
    if (err) {
      setVisits((v) => v.map((x) => (x.id === id ? original : x))); // rollback to the exact pre-edit row
      setError(err.message || "Couldn't save that edit.");
      return false;
    }
    await reloadVisits(); // replaces the optimistic row with the server-confirmed one
    return true;
  }, [visits, reloadVisits]);

  const searchHere = useCallback(async () => {
    if (!bounds) return;
    const { data, error: err } = await searchOverpass(bounds);
    if (err) { setError("Live search failed — try again in a moment."); return; }
    setOverpassPlaces(data);
  }, [bounds]);

  // NEW-2 — VisitPanel now builds its own header (name/category-city/directions) from the raw
  // place fields, rather than FoodApp pre-joining a subtitle string; a manual/new pin has no
  // category or address (never did), so those come through null and VisitPanel's own guards
  // simply don't render those lines.
  const panelPlace = selected?.kind === "place"
    ? { name: selected.place.name, category: selected.place.category, address: selected.place.address, lat: selected.place.lat, lon: selected.place.lon }
    : selected?.kind === "manualPin"
      ? { name: selected.pin.name, category: null, address: null, lat: selected.pin.lat, lon: selected.pin.lon }
      : selected?.kind === "newPin"
        ? { name: null, category: null, address: null, lat: selected.lat, lon: selected.lon }
        : null;

  // Identifies the currently-selected PLACE or MANUAL PIN the exact same way across the map's
  // pin-highlight, the list's row-highlight, and the panel's own key (B634976) — owner, 2026-08-19: "it's
  // not exactly clear once a spot is selected... give the selected pin its own state" and "the
  // selected row highlights too." A manual pin is keyed by NAME ONLY (not the lat/lon-qualified
  // key `manualPinsFromVisits` groups by) because a plain visit ROW (in the list) only carries
  // `custom_name` — matching this repo's existing precedent of disambiguating manual pins by
  // name alone (see the List `onSelect` handler below, unchanged by this item).
  const selectedKey = selected?.kind === "place" ? `place:${selected.place.id}`
    : selected?.kind === "manualPin" ? `pin:${selected.pin.name}`
    : null;

  // B651872 (×3) — a place selected from search (never visited, never flagged) draws ONLY from
  // the bounds-scoped reference snapshot (`places`, refetched on 'moveend' once the flight
  // lands) — everything else the map always draws (his own logged/manual/wishlist places) is
  // NOT bounds-gated. So right after a search jump, before that refetch lands, the selected
  // place has no pin at all to attach its highlight to. Passed through so FoodMap can draw ONE
  // fallback pin for it — see FoodMap.jsx's marker-redraw effect.
  const selectedPlaceInfo = selected?.kind === "place"
    ? { lat: selected.place.lat, lon: selected.place.lon, name: selected.place.name }
    : null;

  // Whether the CURRENTLY SELECTED place/pin is flagged (B669312) — drives the panel's toggle
  // button state, the one thing that has to be "obvious at a glance" per the brief.
  const wishlistedForSelected = useMemo(() => {
    if (!selected) return false;
    if (selected.kind === "place") return wishlistIds.has(selected.place.id);
    const name = selected.kind === "manualPin" ? selected.pin.name : manualDraftName;
    const lat = selected.kind === "manualPin" ? selected.pin.lat : selected.lat;
    const lon = selected.kind === "manualPin" ? selected.pin.lon : selected.lon;
    if (!name) return false;
    return manualWishlistAll.some((p) => p.key === manualGroupKey(name, lat, lon));
  }, [selected, wishlistIds, manualWishlistAll, manualDraftName]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, background: "var(--surface-page)", position: "relative" }}>
      <AppHeader
        module={shellModule || "food"}
        onSwitch={onShellSwitch}
        onDashboard={onGoDashboard}
        authControl={authControl}
        accountActive={accountActive}
        // B651873 — /food is a standalone, unlisted easter egg (B575952), not a page inside the
        // planner's product: removing "Food" from AppHeader's own MODULES list (B575952) still
        // left the OTHER five workspace tabs (Site/Schedule/Review/Library/Notes) rendering on
        // this route, which is exactly the "sitting inside the planner's chrome" look the owner
        // rejected. Row 1 (wordmark + account controls) is untouched — that's the minimal header
        // this route is supposed to keep.
        showModuleTabs={false}
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
                  border: "1px solid var(--border-default)", borderRadius: RADIUS.md, padding: "6px 14px", cursor: "pointer",
                  font: "inherit", fontSize: 12.5, fontWeight: 700,
                  background: pinMode ? "var(--accent-food)" : "transparent",
                  color: pinMode ? "var(--on-accent-food)" : "var(--text-primary)",
                }}
              >
                {pinMode ? "Click the map…" : "Drop a pin"}
              </button>
            )}
            <SearchBox
              query={searchQuery} onQueryChange={setSearchQuery} view={view}
              manualPins={manualPins} loggedIds={loggedIds} wishlistIds={wishlistIds} bounds={bounds}
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
            wishlistPlaces={wishlistPlaces}
            wishlistManualPins={wishlistManualPins}
            overpassPlaces={overpassPlaces}
            onSelectPlace={openPlace}
            onSelectManualPin={openManualPin}
            pinMode={pinMode}
            onDropPin={dropPin}
            onViewChanged={setBounds}
            onRequestSearchHere={searchHere}
            flyToTarget={flyToTarget}
            selectedKey={selectedKey}
            selectedPlaceInfo={selectedPlaceInfo}
            sheetHeightPx={sheetHeightPx}
          />
        ) : (
          <VisitList
            visits={listRows} query={searchQuery} selectedKey={selectedKey}
            onSelect={(v) => {
              // Selecting from the LIST centres the map on it too (owner, 2026-08-19: "centre it
              // in the visible map... applies to selecting from search AND from the list") — the
              // map isn't mounted while in List view, but flyToTarget is honoured on FoodMap's
              // next mount (its fly effect runs on mount whenever a target is already set), so
              // switching to Map view afterward lands already centred, no second click needed.
              if (v.place_id && placeNames[v.place_id]) {
                const p = placeNames[v.place_id];
                openPlace({ id: v.place_id, name: p.name, lat: p.lat, lon: p.lon });
                if (p.lat != null && p.lon != null) flyTo({ lat: p.lat, lon: p.lon });
              } else if (!v.place_id) {
                const pin = { name: v.custom_name, lat: v.custom_lat, lon: v.custom_lon, visitIds: visits.filter((x) => !x.place_id && x.custom_name === v.custom_name).map((x) => x.id) };
                openManualPin(pin);
                if (pin.lat != null && pin.lon != null) flyTo({ lat: pin.lat, lon: pin.lon });
              }
            }}
          />
        )}

        {selected && (
          <VisitPanel
            key={selected.kind === "place" ? `place:${selected.place.id}` : selected.kind === "manualPin" ? `pin:${selected.pin.key || selected.pin.name}` : "new-pin"}
            place={panelPlace}
            pastVisits={visitsForSelected}
            onClose={closePanel}
            onSubmitVisit={accountActive ? submitVisit : undefined}
            onDeleteVisit={removeVisit}
            onEditVisit={accountActive ? editVisit : undefined}
            pending={pending}
            error={error || (!accountActive ? "Sign in to log a visit here." : null)}
            manualNameEditable={selected.kind === "newPin"}
            manualName={manualDraftName}
            onManualNameChange={setManualDraftName}
            wishlisted={wishlistedForSelected}
            onToggleWishlist={accountActive ? toggleWishlist : undefined}
            onSheetHeightChange={setSheetHeightPx}
          />
        )}
      </div>
    </div>
  );
}
