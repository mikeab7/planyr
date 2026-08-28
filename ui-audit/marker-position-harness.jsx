// Marker-position regression harness (2026-08-28 owner report: "when I zoom in or out on mobile
// or desktop the markers jump oddly"). Mounts the REAL FoodMap component with synthetic
// loggedPlaces matching the owner's actual Austin-region cluster (11 real places, lat
// 30.2627-30.2957, lon -97.7419--97.7497, per his own query) PLUS a Dallas and a San Antonio test
// point at different distances/directions from Houston (his DEFAULT_CENTER, and where his
// selected place sits), so a distance-from-focal-point correlation is actually testable. Each
// test point gets an unmistakable, distinct fill colour via a hand-picked avgRating so canvas
// pixel-scanning can find it unambiguously.
import React from "react";
import { createRoot } from "react-dom/client";
import L from "leaflet";
import FoodMap from "/src/workspaces/food/components/FoodMap.jsx";

// Diagnostic-only capture of the real Leaflet map instance FoodMap creates internally — never
// touches FoodMap.jsx itself. Mirrors zoom-perf-harness.jsx's own window.L exposure pattern.
window.L = L;
const origMapFactory = L.map;
window.__testMap = null;
L.map = function (...args) {
  const m = origMapFactory.apply(L, args);
  window.__testMap = m;
  return m;
};

// His real cluster (queried live against production this session) — downtown/campus Austin.
// NOTE: every OTHER marker in this dataset (untracked Austin points, Houston) is deliberately
// given its OWN distinct avgRating too, so NONE of them fall back to the shared, ambiguous
// COLORS.logged default — a first version of this harness let 10 untracked Austin points AND the
// Houston marker all share that one flat colour, so pixel-scanning for "the green marker"
// silently averaged a centroid across the WHOLE MAP instead of one point. Every colour below is
// used by exactly one marker.
const AUSTIN_CLUSTER = [
  { id: "atx-1", name: "P6 at the LINE", lat: 30.2627, lon: -97.7419, avgRating: 2 },
  { id: "atx-2", name: "ATX Cocina", lat: 30.2701, lon: -97.7450, avgRating: 3 },
  { id: "atx-3", name: "Trace", lat: 30.2680, lon: -97.7440, avgRating: 4 },
  { id: "atx-4", name: "Flower Child", lat: 30.2750, lon: -97.7460, avgRating: 6 },
  { id: "atx-5", name: "Group Therapy", lat: 30.2800, lon: -97.7470, avgRating: 7 },
  { id: "atx-6", name: "Perla's Seafood", lat: 30.2850, lon: -97.7480, avgRating: 9 },
  { id: "atx-7", name: "Chick-fil-A", lat: 30.2900, lon: -97.7490, avgRating: 2 },
  { id: "atx-8", name: "Chipotle", lat: 30.2920, lon: -97.7495, avgRating: 3 },
  { id: "atx-9", name: "Potbelly", lat: 30.2940, lon: -97.7497, avgRating: 1 }, // #FFF2CC — TRACKED
  { id: "atx-10", name: "QDOBA", lat: 30.2957, lon: -97.7490, avgRating: 4 },
  { id: "atx-11", name: "Cabo Bob's", lat: 30.2930, lon: -97.7460, avgRating: 6 },
];
// Dallas (~240mi N of Houston) and San Antonio (~200mi SW) — different distances/directions from
// the DEFAULT_CENTER/Houston focal point, so a distance correlation is actually measurable, not
// just a single anecdote.
const DALLAS_PT = { id: "dal-1", name: "Dallas Test Point", lat: 32.7767, lon: -96.7970, avgRating: 10 }; // #6E1810 — TRACKED
const SA_PT = { id: "sa-1", name: "San Antonio Test Point", lat: 29.4241, lon: -98.4936, avgRating: 5 }; // #F58C34 — TRACKED
// Houston — the SELECTED place, matching his real screenshot (blue ring in Houston). Given its
// own rating (8) so its fill can never be confused with a tracked colour either.
const HOUSTON_SELECTED = { id: "hou-1", name: "Houston Selected", lat: 29.76, lon: -95.37, avgRating: 8 };

const loggedPlaces = [...AUSTIN_CLUSTER, DALLAS_PT, SA_PT, HOUSTON_SELECTED];
window.__testPlaces = loggedPlaces;

function Harness() {
  return (
    <FoodMap
      places={[]}
      placesCapped={false}
      placesTotalMatched={0}
      loggedPlaces={loggedPlaces}
      loggedIds={new Set()}
      manualPins={[]}
      wishlistPlaces={[]}
      wishlistManualPins={[]}
      overpassPlaces={[]}
      onSelectPlace={() => {}}
      onSelectManualPin={() => {}}
      pinMode={false}
      onDropPin={() => {}}
      onViewChanged={() => {}}
      onRequestSearchHere={() => {}}
      flyToTarget={null}
      selectedKey={`place:${HOUSTON_SELECTED.id}`}
      selectedPlaceInfo={null}
      sheetHeightPx={0}
    />
  );
}

createRoot(document.getElementById("root")).render(<Harness />);
window.__harnessReady = true;
