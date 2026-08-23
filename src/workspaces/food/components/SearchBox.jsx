/* SearchBox — ONE control (owner, 2026-08-18: "do NOT build a filter panel... if you think one
 * is needed, say so and stop" — no facets, no sort controls, no distance slider here).
 *
 * Searches the WHOLE 100,000+-place, three-metro snapshot by name, never scoped to the current
 * viewport ("the entire point of search is finding a place you cannot see") — backed by
 * `food_places_search_by_name` (db/food.sql), a debounced trigram lookup over a GIN index.
 * His own places (manual pins + anywhere he's logged) rank first and carry a small "You've
 * been here" mark, ahead of the snapshot's relevance order — he is far more often looking for
 * somewhere he's been than somewhere he hasn't.
 *
 * ⛔ THE RESULTS PANEL IS AN AnchoredMenu (fixed 2026-08-18, B632176 — read before ever going back
 * to a plain `position: absolute` div here). Shipped absolutely-positioned inside this
 * component's own DOM tree first; the owner's colleague measured it live and found the results
 * genuinely rendered, styled, and populated (five "Torchy's Tacos" matches in body.innerText)
 * but VISUALLY CLIPPED TO NOTHING — the header toolbar row is `overflow: hidden` (load-bearing
 * for its OWN layout), and a dropdown nested inside it is clipped the instant it grows past that
 * row's height, no matter how high its z-index goes (raising z-index cannot fix an ancestor
 * OVERFLOW clip — that's a completely different CSS mechanism). This repo already solved exactly
 * this class of bug once (`shared/ui/AnchoredMenu.jsx`, built for the Layers panel's RowInfo) —
 * a portal to `document.body`, positioned via `getBoundingClientRect` off the input, escapes
 * every ancestor's overflow/stacking context at once. Reused verbatim here, not reinvented.
 *
 * The dropdown (fly-to-and-open results, the live-Overpass fallback, the drop-a-pin escape
 * hatch) only matters in MAP view — there's a map to fly. In LIST view, this same input just
 * feeds FoodApp's shared `query` state straight into VisitList as a plain text filter over his
 * own visit history ("filter the list rather than fly the map") — no separate second search
 * box, no separate RPC call; `view === "list"` skips the snapshot lookup entirely.
 */
import { useEffect, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { rankSearchCandidates } from "../lib/searchQuality.js";

const DEBOUNCE_MS = 220;
const MIN_QUERY_LEN = 2;
const SHOWN_CAP = 10;

function fieldStyle() {
  return {
    boxSizing: "border-box", padding: "6px 10px", borderRadius: 999,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 12.5,
  };
}

const nameMatches = (name, q) => (name || "").toLowerCase().includes(q);

export default function SearchBox({
  query, onQueryChange, view, manualPins, loggedIds, wishlistIds, bounds,
  searchSnapshot, onSelectPlace, onSelectManualPin, onFlyTo,
  onRequestLiveSearch, overpassPlaces, onStartDropPinFor,
}) {
  const [snapshotResults, setSnapshotResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [liveState, setLiveState] = useState("idle"); // idle | pending | done
  const debounceRef = useRef(null);
  const requestRef = useRef(0);
  const inputRef = useRef(null); // AnchoredMenu's anchor — the portal positions off this

  const trimmed = query.trim();
  const q = trimmed.toLowerCase();
  // The current map view's midpoint — breaks a chain search's identical-similarity ties by
  // distance instead of alphabetically (see foodStore.searchPlacesByName's header).
  const center = bounds ? { lat: (bounds.south + bounds.north) / 2, lon: (bounds.west + bounds.east) / 2 } : null;

  // Debounced whole-snapshot search — MAP view only; LIST view never fires this RPC at all.
  useEffect(() => {
    if (view !== "map") return undefined;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (trimmed.length < MIN_QUERY_LEN) {
      setSnapshotResults([]); setLoading(false); setLiveState("idle");
      return undefined;
    }
    setLoading(true);
    setLiveState("idle");
    const myRequest = ++requestRef.current;
    debounceRef.current = setTimeout(async () => {
      const { data } = await searchSnapshot(trimmed, center);
      if (myRequest !== requestRef.current) return; // a newer keystroke already superseded this
      // B709697 — exclude the RPC's own weak/corrupted candidates and rank the rest (see
      // lib/searchQuality.js for why this is word-coverage + de-rank, not a similarity cutoff).
      // A place he's already logged or flagged never gets filtered out by this — the search box
      // must always resolve back to the exact place his own visit/flag history points at.
      const protectedIds = new Set([...(loggedIds || []), ...(wishlistIds || [])]);
      setSnapshotResults(rankSearchCandidates(trimmed, data || [], protectedIds));
      setLoading(false);
    }, DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trimmed, view, searchSnapshot, bounds?.south, bounds?.north, bounds?.west, bounds?.east]);

  // A live-search press already fired (FoodApp's existing Overpass wiring, reused as-is) —
  // once its results land, filter them by the CURRENT query and fold matches in.
  const liveMatches = liveState === "done" ? (overpassPlaces || []).filter((p) => nameMatches(p.name, q)) : [];

  // "His own places rank first" — manual pins (never in the snapshot) matched client-side,
  // plus every snapshot hit he's already logged, ahead of everywhere he hasn't been. Each
  // bucket keeps the relevance order it already arrived in.
  const manualMatches = view === "map" && trimmed.length >= MIN_QUERY_LEN
    ? (manualPins || []).filter((p) => nameMatches(p.name, q)).map((p) => ({ ...p, kind: "manual", mine: true }))
    : [];
  const snapshotRanked = snapshotResults.map((p) => ({ ...p, kind: "place", mine: loggedIds?.has(p.id), wishlisted: wishlistIds?.has(p.id) }));
  const results = [
    ...manualMatches,
    ...snapshotRanked.filter((p) => p.mine),
    ...snapshotRanked.filter((p) => !p.mine),
    ...liveMatches.map((p) => ({ ...p, kind: "live" })),
  ].slice(0, SHOWN_CAP);

  const settled = !loading && trimmed.length >= MIN_QUERY_LEN;
  const showLiveOffer = view === "map" && settled && liveState === "idle" && results.length < 3 && bounds;
  const showNoResults = view === "map" && settled && results.length === 0 && liveState !== "pending";
  const showDropdown = view === "map" && open && trimmed.length >= MIN_QUERY_LEN;

  const selectPlace = (place) => {
    onSelectPlace(place);
    onFlyTo({ lat: place.lat, lon: place.lon });
    setOpen(false);
  };
  const selectManual = (pin) => {
    onSelectManualPin(pin);
    onFlyTo({ lat: pin.lat, lon: pin.lon });
    setOpen(false);
  };
  const runLiveSearch = () => {
    setLiveState("pending");
    onRequestLiveSearch().finally(() => setLiveState("done"));
  };

  return (
    <div>
      <input
        ref={inputRef}
        type="search" value={query} data-testid="food-search-box"
        onChange={(e) => { onQueryChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder={view === "map" ? "Search restaurants…" : "Filter your visits…"}
        style={{ ...fieldStyle(), width: 220 }}
        aria-label="Search restaurants"
      />
      <AnchoredMenu
        open={showDropdown} onClose={() => setOpen(false)} anchorRef={inputRef}
        placement="below-left" width={280} gap={4}
        // hoverSafe: not a hover trigger, but its click-away semantics are exactly what a text
        // input needs — no full-viewport interactive backdrop covering the input itself, so
        // clicking back into the box to keep typing/reposition the cursor works normally
        // instead of being swallowed by the backdrop and closing the dropdown first.
        hoverSafe
        panelStyle={{
          background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 10,
          boxShadow: "0 10px 28px rgba(0,0,0,0.22)", padding: 6,
        }}
      >
        <div data-testid="food-search-results">
          {loading && <div style={{ padding: "8px 10px", fontSize: 12.5, color: "var(--text-tertiary)" }}>Searching…</div>}

          {!loading && results.map((p) => (
            <button
              key={`${p.kind}:${p.id || p.key || p.name}`} type="button"
              onClick={() => (p.kind === "manual" ? selectManual(p) : selectPlace(p))}
              style={{
                display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, width: "100%",
                textAlign: "left", border: "none", background: "transparent", borderRadius: 6, padding: "7px 8px",
                cursor: "pointer", font: "inherit", color: "var(--text-primary)",
              }}
            >
              <span style={{ overflow: "hidden", minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {p.name}{p.kind === "live" && <span style={{ color: "var(--text-tertiary)" }}> (live search)</span>}
                </span>
                {/* THE CITY, so a chain search ("Torchy's") reads as distinct branches, not fifteen
                    identical rows (owner, 2026-08-18) — the full address already carries the city
                    and enough street to disambiguate within it; no separate city field needed. */}
                {p.address && (
                  <span style={{
                    display: "block", fontSize: 11, color: "var(--text-tertiary)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>
                    {p.address}
                  </span>
                )}
              </span>
              {p.mine && (
                <span style={{
                  flex: "0 0 auto", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
                  color: "var(--on-accent-food)", background: "var(--accent-food)", borderRadius: 999, padding: "2px 6px",
                }}>
                  Been here
                </span>
              )}
              {/* Want to try (B669312) — a place that's flagged AND visited reads as visited
                  (p.mine wins, same rule the map pins follow), so this only ever shows on its own.
                  Outlined, not filled, echoing the hollow map-pin treatment for the same flag. */}
              {!p.mine && p.wishlisted && (
                <span style={{
                  flex: "0 0 auto", fontSize: 10.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
                  color: "var(--accent-food)", background: "transparent", border: "1px solid var(--accent-food)",
                  borderRadius: 999, padding: "1px 6px",
                }}>
                  Want to try
                </span>
              )}
            </button>
          ))}

          {!loading && showLiveOffer && (
            <button
              type="button" onClick={runLiveSearch} data-testid="food-search-live-fallback"
              style={{
                display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent",
                borderRadius: 6, padding: "7px 8px", cursor: "pointer", font: "inherit", fontSize: 12.5,
                fontWeight: 700, color: "var(--accent-food)",
              }}
            >
              Search live for "{trimmed}" nearby
            </button>
          )}
          {!loading && liveState === "pending" && (
            <div style={{ padding: "7px 8px", fontSize: 12.5, color: "var(--text-tertiary)" }}>Searching live…</div>
          )}

          {!loading && showNoResults && (
            <div style={{ padding: "8px" }}>
              <div style={{ fontSize: 12.5, color: "var(--text-tertiary)", marginBottom: 6 }}>
                No matches{liveState === "done" ? ", even live" : ""} for "{trimmed}".
              </div>
              <button
                type="button" onClick={() => onStartDropPinFor(trimmed)} data-testid="food-search-drop-pin"
                style={{
                  display: "block", width: "100%", textAlign: "left", border: "1px dashed var(--border-default)",
                  borderRadius: 6, padding: "7px 8px", cursor: "pointer", font: "inherit", fontSize: 12.5,
                  fontWeight: 700, color: "var(--text-primary)", background: "transparent",
                }}
              >
                Drop a pin for "{trimmed}" — not in any dataset
              </button>
            </div>
          )}
        </div>
      </AnchoredMenu>
    </div>
  );
}
