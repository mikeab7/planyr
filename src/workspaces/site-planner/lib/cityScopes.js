/* B1583296 — CITY-SCOPED PARCEL SOURCES: a genuine addition to how a point resolves to a parcel
 * source, not a config line.
 *
 * Every resolver in `counties.js` (`resolveCounty`, `countyPolygonsCore.js`) answers at COUNTY
 * granularity — one nationwide polygon per county, one parcel source per county key. That is an
 * architectural ceiling: a county whose only real parcel source covers just PART of it (a city, not
 * the county) cannot be expressed by pointing the county key at that source, because every OTHER
 * place in the county would then silently query a layer that has never heard of it — the exact
 * Nebraska-shaped defect (B1332016) `docs/STATEWIDE-PARCELS.md` already names, and the reason
 * `Detroit_MP_Parcel_Authoritative` was correctly REJECTED as a Wayne County candidate rather than
 * wired under `wayne`.
 *
 * Wayne County, MI has no county-wide CAD/assessor GIS this repo could find after three discovery
 * routes (`docs/STATEWIDE-PARCELS.md`, B1551617/B1574256/B1574258) — but the City of Detroit
 * publishes its OWN authoritative parcel layer covering only itself. This module is the small,
 * genuinely new resolution TIER that lets Planyr use that layer ONLY inside Detroit's own limits: a
 * bundled city-boundary polygon, checked BEFORE the nationwide county geometry by every caller in
 * `counties.js` that decides "which source answers this point" — a click inside Detroit resolves
 * here; a click anywhere else in Wayne County falls through to the ordinary county resolution,
 * which (since no `mi_wayne` entry exists) correctly reports "no parcel data wired here yet."
 *
 * WHAT THIS IS NOT: a general sub-county framework. `CITY_SCOPES` is a short, explicit list — add a
 * city here only when ITS OWN parcel source is real and its county has no source that would
 * otherwise cover it (a city inside an already-wired county needs no entry; the county source
 * already reaches it). Every `COUNTIES_MAP` entry a scope here resolves to MUST carry
 * `cityScoped: true`, so `candidateCountiesForPoint`'s blind per-state fallback (used when a point
 * matches no bbox and no confident county geometry) never hands a scoped, partial source to a point
 * the scope itself rejected — see that function's own comment in `counties.js`.
 *
 * GEOMETRY PROVENANCE (Detroit) — "City of Detroit Boundary," sourced from the Michigan Geographic
 * Framework, published by the City of Detroit's own ArcGIS Online organization
 * (`OpenDataAdmin_detroitmi`, item `86b221bb68ca4364afe81d156e54f95c`,
 * `contentStatus: "public_authoritative"`). Queried live from this sandbox 2026-09-12
 * (`services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/City_of_Detroit_Boundary/FeatureServer/0`),
 * simplified server-side (`maxAllowableOffset=0.0008°`, ~90 m) and rounded to 4 decimal places
 * (~11 m) — screening-grade, the same precision class as the nationwide county-polygon asset's own
 * `NEAR_EDGE_DEG` (~150 m; see `countyPolygonsCore.js`). ONE feature, TWO rings: the outer city
 * limit (61 vertices) and a HOLE (15 vertices) — Hamtramck and Highland Park, two fully independent
 * cities the boundary layer's own geometry excludes (its description: "not clipped to the
 * coastline," i.e. a true polygon-with-hole, not a convex hull). A point inside that hole is NOT
 * Detroit. Verified against all three of the dispatch's control points: downtown Detroit
 * (42.3314, -83.0458) hits; Livonia (42.3684, -83.3527) and Taylor (42.2409, -83.2696) — both real
 * Wayne County cities outside Detroit's limits — do not.
 *
 * Pure — no DOM, no network, no module state. Plain-degree ray casting; no quantisation, because
 * this ring set is tiny (76 vertices total) and carries none of the float-drift budget the
 * nationwide asset's delta encoding exists to protect.
 */

function pointInRing(ring, lng, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Roughly 150 m in degrees — matches countyPolygonsCore.js's NEAR_EDGE_DEG, the band inside which
// this simplified boundary cannot be trusted to have picked the right side of the city line.
const NEAR_EDGE_DEG = 0.0015;

function distToRing(ring, lng, lat) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j], [x2, y2] = ring[i];
    let px = x1, py = y1;
    const dx = x2 - x1, dy = y2 - y1;
    if (dx !== 0 || dy !== 0) {
      const t = ((lng - x1) * dx + (lat - y1) * dy) / (dx * dx + dy * dy);
      if (t > 1) { px = x2; py = y2; } else if (t > 0) { px = x1 + dx * t; py = y1 + dy * t; }
    }
    const d = Math.hypot(lng - px, lat - py);
    if (d < best) best = d;
  }
  return best;
}

const DETROIT_OUTER = [[-82.9162,42.4213],[-82.9103,42.419],[-82.9106,42.4172],[-82.9215,42.3955],[-82.9354,42.3898],[-82.9468,42.387],[-82.924,42.3521],[-82.9454,42.3474],[-82.9598,42.3398],[-82.9891,42.3325],[-83.0189,42.3306],[-83.0636,42.3169],[-83.0799,42.3072],[-83.0999,42.2867],[-83.1146,42.2902],[-83.1181,42.2897],[-83.1199,42.2876],[-83.1176,42.2804],[-83.1188,42.2791],[-83.1375,42.2828],[-83.161,42.255],[-83.1664,42.2597],[-83.1681,42.2639],[-83.1698,42.2646],[-83.1582,42.2788],[-83.167,42.2896],[-83.1583,42.292],[-83.1577,42.295],[-83.1517,42.2963],[-83.1472,42.2926],[-83.1426,42.2944],[-83.1404,42.2977],[-83.1424,42.3057],[-83.1396,42.3087],[-83.1407,42.311],[-83.1531,42.3281],[-83.1565,42.3272],[-83.1569,42.337],[-83.153,42.3376],[-83.1499,42.3398],[-83.1477,42.3519],[-83.1965,42.3509],[-83.1961,42.3364],[-83.2153,42.3361],[-83.2153,42.329],[-83.2251,42.3288],[-83.2278,42.3326],[-83.2346,42.3298],[-83.235,42.3358],[-83.2375,42.3357],[-83.2378,42.3431],[-83.2638,42.3417],[-83.2659,42.357],[-83.2666,42.3788],[-83.2749,42.3786],[-83.2759,42.4073],[-83.2864,42.407],[-83.2877,42.4427],[-82.9405,42.4504],[-82.9513,42.4358],[-82.9162,42.4213]];

// Hamtramck + Highland Park — two fully independent municipalities the boundary layer excludes.
const DETROIT_HOLE = [[-83.0738,42.3987],[-83.0666,42.3897],[-83.0624,42.3912],[-83.0547,42.3796],[-83.0404,42.3848],[-83.0443,42.3902],[-83.0422,42.3902],[-83.0425,42.4044],[-83.0539,42.4044],[-83.057,42.409],[-83.0763,42.4018],[-83.0895,42.4181],[-83.1219,42.4175],[-83.1021,42.3883],[-83.0738,42.3987]];

const CITY_SCOPES = [
  {
    key: "mi_detroit",
    name: "Detroit",
    state: "MI",
    bbox: [42.2550, -83.2877, 42.4504, -82.9103], // [minLat, minLng, maxLat, maxLng]
    outer: DETROIT_OUTER,
    holes: [DETROIT_HOLE],
  },
];

/* The city-scoped keys this module can resolve to — `counties.js` uses this to require every one
 * of them to carry `cityScoped: true` on its `COUNTIES_MAP` entry (test-guarded), rather than
 * trusting each entry to remember the flag on its own. */
export const CITY_SCOPE_KEYS = CITY_SCOPES.map((s) => s.key);

/**
 * A city-scoped parcel source for (lat, lng), or null. Same answer shape as `counties.js`'s own
 * `geometryCountyAnswer`/`resolveCounty`: `{ key, name, state, nearEdge }` — `nearEdge` true means
 * the point is within ~150 m of the resolved city's line, so a caller that needs certainty should
 * defer to a live identify, exactly the contract `NEAR_EDGE_DEG` already documents for counties.
 *
 * Synchronous and pure — no asset to warm, so this never returns a `pending` status the way the
 * nationwide county geometry can.
 */
export function cityScopeAnswer(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  for (const scope of CITY_SCOPES) {
    const [minLat, minLng, maxLat, maxLng] = scope.bbox;
    if (lat < minLat || lat > maxLat || lng < minLng || lng > maxLng) continue;
    if (!pointInRing(scope.outer, lng, lat)) continue;
    if (scope.holes.some((h) => pointInRing(h, lng, lat))) continue;
    const edgeDist = Math.min(distToRing(scope.outer, lng, lat), ...scope.holes.map((h) => distToRing(h, lng, lat)));
    return { key: scope.key, name: scope.name, state: scope.state, nearEdge: edgeDist < NEAR_EDGE_DEG };
  }
  return null;
}
