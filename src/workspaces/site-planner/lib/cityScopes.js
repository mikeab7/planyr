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
 * ⛔ NEW-1/NEW-2/NEW-6/NEW-7 (2026-09-15) — Detroit was deliberately the ONLY entry when this module
 * shipped; that is no longer true, and this header text is corrected rather than left stale. Three
 * more scopes were added for the same reason Detroit was: a city inside the scope's own county
 * publishes a real parcel layer while the county itself has none (Kansas City, Independence) or has
 * one with a hole exactly where the city sits (Sioux Falls — see `sd_minnehaha`'s own comment in
 * `counties.js`). **The ring test itself is COUNTY-AGNOSTIC** — `cityScopeAnswer` never asks which
 * county a point is in, only whether it is inside a city's own boundary — so a city that happens to
 * straddle several counties (Kansas City, MO spans Jackson/Clay/Platte/Cass) needs no special
 * handling here: one outer ring (plus holes for any enclosed non-city land) answers the question
 * regardless of which county the point falls in. `state` on a multi-county entry is metadata for
 * display only, never part of the resolution test.
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
 * GEOMETRY PROVENANCE (Sioux Falls, Kansas City, Independence) — this sandbox's egress policy blocks
 * every one of these cities' own GIS hosts (`gis.siouxfalls.gov`, `mapd.kcmo.org`), and Kansas
 * City's own AGOL-hosted "CityLimit" layer (`services.arcgis.com/4o5uMWTHuOhUVJPd/.../CityLimit`,
 * item `0474215cb3b94eaabd7f7eaf4352b783`) answers `returnCountOnly` with 0 features despite
 * advertising a real extent — an empty hosted layer, not a reachability block, confirmed live
 * 2026-09-15. All three boundaries below instead come from Esri's own Living Atlas "USA Census
 * Populated Place Areas" (`services.arcgis.com/P3ePLMYs2RVChkJx/.../USA_Census_Populated_Places`,
 * org `esri_dm`), queried live 2026-09-15 with `maxAllowableOffset=0.0015°` (~150 m, matching
 * `NEAR_EDGE_DEG`) and rounded to 4 decimal places. A Census place boundary is the incorporated
 * city limit, not an approximation of it — `SQMI` on each returned feature matches the city's known
 * area (Sioux Falls 79.63 sq mi, Kansas City 318.79 sq mi, Independence 78.44 sq mi). Each ring set
 * was verified against every control point the dispatch gave: Sioux Falls downtown
 * (43.5460, -96.7311) hits, a rural Minnehaha point (43.75, -96.95) does not; Kansas City's Crown
 * Center (39.0836, -94.5822, Jackson Co.), Northland (39.2500, -94.5800, Clay Co.) and the airport
 * (39.2976, -94.7139, Platte Co.) all hit the SAME ring, proving the county-agnostic test holds
 * across the straddle; Independence's own centre hits its ring and does not hit Kansas City's.
 * Sioux Falls carries 42 holes (small unincorporated pockets inside the city limits from decades of
 * piecemeal annexation — a real feature of that city's shape, not a simplification artifact: every
 * hole is a small, clean, counter-clockwise ring). Kansas City carries 8 holes (enclosed
 * non-KC land). Independence has none.
 *
 * Pure — no DOM, no network, no module state. Plain-degree ray casting; no quantisation, because
 * even the largest ring set here (Kansas City, ~250 vertices) is far below the float-drift budget
 * the nationwide asset's delta encoding exists to protect.
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

const SIOUXFALLS_OUTER = [[-96.7739,43.6381],[-96.7706,43.6381],[-96.7694,43.6154],[-96.7614,43.6129],[-96.7614,43.6081],[-96.7662,43.6084],[-96.7661,43.6055],[-96.7612,43.6056],[-96.7591,43.6019],[-96.7362,43.602],[-96.7362,43.6055],[-96.7281,43.6066],[-96.7281,43.6092],[-96.711,43.6096],[-96.7109,43.6164],[-96.7014,43.6164],[-96.7014,43.602],[-96.6854,43.602],[-96.6855,43.5947],[-96.6785,43.5947],[-96.6785,43.5983],[-96.6815,43.5983],[-96.6809,43.602],[-96.6566,43.6019],[-96.6566,43.5948],[-96.6517,43.5981],[-96.6516,43.5873],[-96.6567,43.5872],[-96.6567,43.5784],[-96.6603,43.5784],[-96.6602,43.5743],[-96.6566,43.5744],[-96.6566,43.5694],[-96.6516,43.5689],[-96.6516,43.5658],[-96.6465,43.5657],[-96.6465,43.5542],[-96.6415,43.5543],[-96.6415,43.5486],[-96.627,43.5487],[-96.6272,43.5542],[-96.6297,43.5542],[-96.6305,43.5584],[-96.6256,43.5584],[-96.624,43.5551],[-96.621,43.5554],[-96.6204,43.5436],[-96.6222,43.5429],[-96.6105,43.5428],[-96.61,43.5331],[-96.6016,43.5304],[-96.5981,43.5243],[-96.6009,43.522],[-96.6109,43.522],[-96.6177,43.5296],[-96.6305,43.5294],[-96.6307,43.5221],[-96.6332,43.5215],[-96.6307,43.5215],[-96.6308,43.5163],[-96.6341,43.5148],[-96.6309,43.5148],[-96.631,43.5113],[-96.6161,43.5112],[-96.6163,43.504],[-96.6113,43.504],[-96.6112,43.5076],[-96.6013,43.5075],[-96.6015,43.5004],[-96.6289,43.5004],[-96.6289,43.4968],[-96.6347,43.4967],[-96.6344,43.4943],[-96.6539,43.4931],[-96.6539,43.4895],[-96.6706,43.4907],[-96.6754,43.4878],[-96.6754,43.4849],[-96.6787,43.4849],[-96.6787,43.4821],[-96.6837,43.4821],[-96.6837,43.4862],[-96.6877,43.4875],[-96.6929,43.4876],[-96.6929,43.4851],[-96.701,43.4858],[-96.7027,43.4838],[-96.6977,43.4827],[-96.7076,43.4812],[-96.7076,43.4749],[-96.7127,43.4771],[-96.7127,43.475],[-96.7207,43.475],[-96.7176,43.4712],[-96.7275,43.4698],[-96.7275,43.4719],[-96.7326,43.4715],[-96.7326,43.475],[-96.7381,43.475],[-96.7374,43.4715],[-96.7489,43.4723],[-96.7474,43.4653],[-96.7545,43.4643],[-96.7673,43.4643],[-96.7673,43.4662],[-96.7623,43.4661],[-96.7656,43.4697],[-96.7671,43.468],[-96.7872,43.4692],[-96.7872,43.4754],[-96.7794,43.4754],[-96.7803,43.479],[-96.796,43.4791],[-96.7958,43.4819],[-96.8085,43.4815],[-96.8048,43.4878],[-96.8063,43.49],[-96.8082,43.49],[-96.8082,43.4847],[-96.8163,43.4847],[-96.8174,43.4899],[-96.8263,43.4899],[-96.8263,43.4925],[-96.8224,43.4937],[-96.8264,43.4938],[-96.8239,43.4946],[-96.8241,43.5003],[-96.8307,43.5003],[-96.8307,43.5076],[-96.8288,43.5076],[-96.8307,43.5094],[-96.8259,43.5099],[-96.8259,43.5133],[-96.8208,43.5135],[-96.8208,43.5076],[-96.8108,43.5075],[-96.8109,43.5148],[-96.8308,43.5137],[-96.8308,43.5184],[-96.8337,43.5184],[-96.8367,43.5148],[-96.8459,43.5148],[-96.8481,43.522],[-96.8457,43.522],[-96.8457,43.5257],[-96.8407,43.5256],[-96.8407,43.5305],[-96.8373,43.532],[-96.8374,43.5384],[-96.8309,43.5436],[-96.8472,43.5437],[-96.8488,43.5466],[-96.8474,43.5495],[-96.8447,43.5478],[-96.8401,43.5492],[-96.8308,43.5479],[-96.8308,43.546],[-96.8257,43.5475],[-96.8195,43.5441],[-96.8208,43.5511],[-96.8167,43.5511],[-96.8138,43.5554],[-96.8009,43.5547],[-96.8009,43.5583],[-96.806,43.5584],[-96.8059,43.562],[-96.801,43.562],[-96.801,43.5656],[-96.791,43.5656],[-96.791,43.5728],[-96.8009,43.5728],[-96.8009,43.5692],[-96.806,43.5692],[-96.8059,43.573],[-96.791,43.573],[-96.791,43.5875],[-96.8011,43.5874],[-96.8009,43.6023],[-96.7984,43.6023],[-96.7989,43.6055],[-96.791,43.605],[-96.7911,43.6085],[-96.801,43.6091],[-96.7911,43.6125],[-96.7912,43.6309],[-96.7865,43.6309],[-96.79,43.6363],[-96.7875,43.6381],[-96.7739,43.6381]];

// 42 small unincorporated pockets inside the Sioux Falls city limits — a real feature of the
// city's annexation history (piecemeal annexation left "county islands" behind), not a
// simplification artifact. A point inside one of these is unincorporated Minnehaha County,
// not Sioux Falls, and correctly falls through to `sd_minnehaha`.
const SIOUXFALLS_HOLES = [
  [[-96.7881,43.612],[-96.7739,43.6135],[-96.7713,43.6179],[-96.7878,43.6179],[-96.7896,43.6199],[-96.7881,43.612]],
  [[-96.776,43.6055],[-96.776,43.6021],[-96.7735,43.6021],[-96.7719,43.6055],[-96.776,43.6055]],
  [[-96.7097,43.6013],[-96.7064,43.601],[-96.7064,43.6053],[-96.7097,43.6038],[-96.7097,43.6013]],
  [[-96.7705,43.5975],[-96.7705,43.5947],[-96.7693,43.5947],[-96.7705,43.5975]],
  [[-96.7661,43.5896],[-96.7667,43.5874],[-96.7641,43.5874],[-96.7627,43.5904],[-96.7661,43.5896]],
  [[-96.6615,43.573],[-96.6616,43.5706],[-96.6582,43.5723],[-96.6615,43.573]],
  [[-96.6715,43.569],[-96.6715,43.5658],[-96.668,43.5633],[-96.6616,43.5639],[-96.6625,43.5687],[-96.6715,43.569]],
  [[-96.6697,43.5622],[-96.6678,43.5621],[-96.6691,43.5629],[-96.6697,43.5622]],
  [[-96.6665,43.5622],[-96.6655,43.5623],[-96.6668,43.5626],[-96.6665,43.5622]],
  [[-96.6515,43.5471],[-96.6505,43.546],[-96.6503,43.5471],[-96.6515,43.5471]],
  [[-96.8149,43.5448],[-96.8149,43.5468],[-96.8168,43.544],[-96.8108,43.544],[-96.8149,43.5448]],
  [[-96.6332,43.5446],[-96.6306,43.5429],[-96.6314,43.5451],[-96.6332,43.5446]],
  [[-96.6473,43.5432],[-96.6417,43.541],[-96.6448,43.5425],[-96.6473,43.5432]],
  [[-96.6303,43.5427],[-96.6303,43.5397],[-96.6255,43.5396],[-96.6254,43.5427],[-96.6303,43.5427]],
  [[-96.6426,43.541],[-96.6515,43.5438],[-96.6513,43.5294],[-96.6369,43.5287],[-96.6345,43.5294],[-96.6359,43.5328],[-96.6305,43.5326],[-96.6305,43.536],[-96.6426,43.541]],
  [[-96.6303,43.5379],[-96.6295,43.5384],[-96.6303,43.5384],[-96.6303,43.5379]],
  [[-96.6287,43.5378],[-96.6304,43.5371],[-96.6274,43.5352],[-96.6249,43.5366],[-96.6287,43.5378]],
  [[-96.619,43.536],[-96.6181,43.5367],[-96.6195,43.5368],[-96.619,43.536]],
  [[-96.6229,43.5327],[-96.6083,43.5268],[-96.6041,43.5282],[-96.6076,43.5309],[-96.6118,43.5292],[-96.6229,43.5327]],
  [[-96.8168,43.5402],[-96.8164,43.5437],[-96.8198,43.5437],[-96.8168,43.5402]],
  [[-96.8258,43.5427],[-96.824,43.5437],[-96.8305,43.5439],[-96.8258,43.5427]],
  [[-96.6538,43.5185],[-96.6517,43.5162],[-96.6517,43.5185],[-96.6538,43.5185]],
  [[-96.6526,43.516],[-96.6517,43.515],[-96.6517,43.5161],[-96.6526,43.516]],
  [[-96.6529,43.5152],[-96.6535,43.5158],[-96.6535,43.5149],[-96.6529,43.5152]],
  [[-96.6451,43.5148],[-96.6446,43.514],[-96.6446,43.5148],[-96.6451,43.5148]],
  [[-96.6459,43.5122],[-96.6469,43.5147],[-96.647,43.5122],[-96.6459,43.5122]],
  [[-96.6451,43.5139],[-96.6446,43.5131],[-96.6446,43.5139],[-96.6451,43.5139]],
  [[-96.6429,43.5062],[-96.6451,43.5061],[-96.6451,43.5004],[-96.6501,43.5004],[-96.6488,43.4967],[-96.6439,43.4967],[-96.6439,43.5004],[-96.6414,43.5004],[-96.6413,43.5073],[-96.6429,43.5062]],
  [[-96.6388,43.4967],[-96.6376,43.4944],[-96.6355,43.4967],[-96.6388,43.4967]],
  [[-96.6678,43.4956],[-96.6688,43.4956],[-96.6688,43.4949],[-96.6678,43.4956]],
  [[-96.6877,43.4909],[-96.6877,43.4894],[-96.6794,43.4894],[-96.6877,43.4909]],
  [[-96.7972,43.4899],[-96.8011,43.4899],[-96.8011,43.4878],[-96.7972,43.4899]],
  [[-96.7076,43.4847],[-96.7059,43.4847],[-96.7059,43.4859],[-96.7076,43.4847]],
  [[-96.7275,43.4831],[-96.7263,43.4839],[-96.7275,43.4839],[-96.7275,43.4831]],
  [[-96.7295,43.4773],[-96.7278,43.4767],[-96.7278,43.478],[-96.7295,43.4773]],
  [[-96.775,43.4732],[-96.7749,43.4752],[-96.776,43.4752],[-96.775,43.4732]],
  [[-96.7622,43.4734],[-96.7623,43.4716],[-96.7573,43.4716],[-96.7599,43.4751],[-96.767,43.4751],[-96.767,43.4735],[-96.7622,43.4734]],
  [[-96.7582,43.4746],[-96.7573,43.4744],[-96.7573,43.4751],[-96.7582,43.4746]],
  [[-96.75,43.4745],[-96.7491,43.4726],[-96.7482,43.4739],[-96.75,43.4745]],
  [[-96.7434,43.4743],[-96.7428,43.475],[-96.7434,43.475],[-96.7434,43.4743]],
  [[-96.6027,43.5258],[-96.6018,43.5263],[-96.6028,43.5264],[-96.6027,43.5258]],
  [[-96.7035,43.6061],[-96.7051,43.6077],[-96.7051,43.6061],[-96.7035,43.6061]],
];

const KANSASCITY_OUTER = [[-94.6753,39.3562],[-94.662,39.3547],[-94.6616,39.3332],[-94.5606,39.3331],[-94.5606,39.3223],[-94.5559,39.3223],[-94.5559,39.3186],[-94.4914,39.3179],[-94.4914,39.3144],[-94.482,39.3142],[-94.482,39.3105],[-94.464,39.3099],[-94.4641,39.3033],[-94.4448,39.3031],[-94.4449,39.2887],[-94.437,39.2879],[-94.4372,39.2809],[-94.4454,39.281],[-94.4475,39.2657],[-94.4546,39.2687],[-94.4562,39.2461],[-94.4703,39.2248],[-94.493,39.2235],[-94.4932,39.2092],[-94.5033,39.2074],[-94.5073,39.209],[-94.5073,39.1952],[-94.4934,39.1952],[-94.4934,39.1985],[-94.4843,39.1985],[-94.4846,39.195],[-94.469,39.1948],[-94.4701,39.1918],[-94.4634,39.1889],[-94.4583,39.182],[-94.4484,39.1757],[-94.4462,39.1851],[-94.4346,39.1938],[-94.4292,39.1946],[-94.4207,39.1903],[-94.4182,39.1936],[-94.4086,39.1936],[-94.3999,39.1748],[-94.4023,39.1648],[-94.4258,39.1418],[-94.4406,39.1308],[-94.4554,39.1281],[-94.4693,39.1307],[-94.4678,39.1144],[-94.4706,39.1144],[-94.4711,39.1111],[-94.4814,39.1112],[-94.4769,39.0993],[-94.4867,39.0997],[-94.4873,39.0822],[-94.4702,39.082],[-94.4708,39.0727],[-94.4685,39.0684],[-94.4747,39.0671],[-94.475,39.0606],[-94.4333,39.0417],[-94.4372,39.036],[-94.4376,39.0292],[-94.4493,39.0297],[-94.4495,39.0267],[-94.4821,39.028],[-94.4828,38.9832],[-94.4992,38.9659],[-94.4413,38.9637],[-94.4403,38.9866],[-94.4453,38.9871],[-94.4435,39.0244],[-94.4408,39.0268],[-94.4254,39.0263],[-94.425,39.0352],[-94.387,39.0353],[-94.3881,39.0203],[-94.3859,39.0152],[-94.3899,38.973],[-94.3854,38.9728],[-94.3861,38.9581],[-94.3957,38.9581],[-94.3956,38.9612],[-94.4001,38.9613],[-94.407,38.9658],[-94.4048,38.9622],[-94.4101,38.9586],[-94.4103,38.9553],[-94.4144,38.9556],[-94.4148,38.9511],[-94.4105,38.9472],[-94.4102,38.9408],[-94.4479,38.9426],[-94.4507,38.9127],[-94.4687,38.9133],[-94.4713,38.8707],[-94.4296,38.8692],[-94.4312,38.8396],[-94.4921,38.8417],[-94.4886,38.9072],[-94.5334,38.9099],[-94.5608,38.9101],[-94.5638,38.8669],[-94.5269,38.8653],[-94.5296,38.8437],[-94.5418,38.844],[-94.5425,38.8358],[-94.5543,38.8354],[-94.555,38.8306],[-94.5591,38.8307],[-94.5619,38.8243],[-94.5663,38.8243],[-94.5621,38.845],[-94.608,38.8472],[-94.6085,39.1162],[-94.6051,39.1233],[-94.5903,39.1381],[-94.5884,39.1489],[-94.5907,39.1548],[-94.6017,39.1596],[-94.6013,39.1886],[-94.6593,39.1885],[-94.6592,39.2109],[-94.663,39.2123],[-94.6591,39.214],[-94.6578,39.2237],[-94.6784,39.2136],[-94.6784,39.2397],[-94.6819,39.238],[-94.6824,39.247],[-94.7011,39.2466],[-94.7011,39.2426],[-94.7479,39.243],[-94.7479,39.2742],[-94.7601,39.2752],[-94.7653,39.2854],[-94.7613,39.3016],[-94.7548,39.3103],[-94.7567,39.3156],[-94.7517,39.3392],[-94.7431,39.3396],[-94.7431,39.3437],[-94.733,39.3439],[-94.7327,39.3547],[-94.6753,39.3562]];

// 8 enclosed pockets of non-Kansas-City land (other incorporated cities and unincorporated
// county land fully surrounded by KC's own irregular annexation boundary).
const KANSASCITY_HOLES = [
  [[-94.6675,39.3111],[-94.6611,39.311],[-94.664,39.3125],[-94.664,39.3184],[-94.6675,39.3184],[-94.6675,39.3111]],
  [[-94.6473,39.2345],[-94.6472,39.2322],[-94.6588,39.2329],[-94.6594,39.2252],[-94.6451,39.2251],[-94.645,39.2303],[-94.6445,39.2274],[-94.6404,39.2275],[-94.6404,39.2259],[-94.6288,39.2268],[-94.6332,39.2337],[-94.645,39.2359],[-94.6473,39.2345]],
  [[-94.5861,39.2346],[-94.5864,39.1903],[-94.5882,39.1902],[-94.5882,39.1831],[-94.5926,39.1831],[-94.5943,39.1741],[-94.586,39.174],[-94.586,39.1812],[-94.5811,39.1812],[-94.5811,39.1957],[-94.5303,39.1952],[-94.5299,39.2267],[-94.5267,39.2273],[-94.53,39.2334],[-94.5401,39.2336],[-94.5415,39.2312],[-94.5427,39.2337],[-94.5861,39.2346]],
  [[-94.6182,39.1897],[-94.6186,39.1942],[-94.6211,39.1933],[-94.6224,39.196],[-94.6255,39.196],[-94.6255,39.1899],[-94.6182,39.1897]],
  [[-94.4572,39.1623],[-94.443,39.1623],[-94.443,39.1729],[-94.457,39.173],[-94.4572,39.1623]],
  [[-94.4959,39.1622],[-94.4962,39.1588],[-94.4985,39.1587],[-94.4985,39.1513],[-94.4901,39.151],[-94.4899,39.1551],[-94.4847,39.1551],[-94.4847,39.1588],[-94.494,39.1588],[-94.4939,39.1622],[-94.4959,39.1622]],
  [[-94.5312,39.1519],[-94.5404,39.152],[-94.5403,39.1556],[-94.5479,39.1557],[-94.547,39.1592],[-94.5493,39.1592],[-94.548,39.152],[-94.5503,39.155],[-94.5536,39.1521],[-94.5759,39.1523],[-94.577,39.1542],[-94.5802,39.1508],[-94.586,39.1524],[-94.5869,39.1233],[-94.5647,39.1235],[-94.555,39.1274],[-94.5392,39.1427],[-94.5313,39.1469],[-94.5312,39.1519]],
  [[-94.4981,39.1595],[-94.4964,39.1621],[-94.4981,39.1622],[-94.4981,39.1595]],
];

const INDEPENDENCE_OUTER = [[-94.2159,39.1384],[-94.2189,39.0804],[-94.2556,39.0811],[-94.2559,39.0784],[-94.2651,39.078],[-94.2698,39.0782],[-94.2697,39.0818],[-94.2757,39.0823],[-94.2777,39.0804],[-94.2779,39.0665],[-94.2698,39.0566],[-94.2698,39.0534],[-94.3153,39.0541],[-94.3127,39.0446],[-94.3054,39.0348],[-94.3322,39.0378],[-94.3324,39.033],[-94.3371,39.0327],[-94.3371,39.0292],[-94.3278,39.027],[-94.3314,39.0215],[-94.3328,39.025],[-94.3634,39.0263],[-94.3654,39.024],[-94.3743,39.0232],[-94.3742,39.0206],[-94.3776,39.0191],[-94.3818,39.0207],[-94.3869,39.0176],[-94.387,39.0353],[-94.425,39.0352],[-94.4254,39.0263],[-94.4377,39.0268],[-94.4372,39.036],[-94.4333,39.0417],[-94.475,39.0606],[-94.4747,39.0671],[-94.469,39.0668],[-94.4684,39.0687],[-94.4708,39.0727],[-94.4702,39.082],[-94.4782,39.0896],[-94.4788,39.0974],[-94.4763,39.1009],[-94.4814,39.1111],[-94.4711,39.1111],[-94.4706,39.1144],[-94.4678,39.1144],[-94.4674,39.1314],[-94.4554,39.1281],[-94.4554,39.1215],[-94.4607,39.1169],[-94.4565,39.1154],[-94.4531,39.117],[-94.4537,39.1028],[-94.437,39.1022],[-94.4324,39.1027],[-94.4314,39.1098],[-94.4277,39.1097],[-94.427,39.1136],[-94.4229,39.1142],[-94.4248,39.123],[-94.4236,39.1309],[-94.3554,39.1286],[-94.3519,39.1307],[-94.3521,39.1338],[-94.3492,39.1324],[-94.3179,39.1367],[-94.2682,39.1365],[-94.258,39.1398],[-94.2159,39.1384]];


const CITY_SCOPES = [
  {
    key: "mi_detroit",
    name: "Detroit",
    state: "MI",
    bbox: [42.2550, -83.2877, 42.4504, -82.9103], // [minLat, minLng, maxLat, maxLng]
    outer: DETROIT_OUTER,
    holes: [DETROIT_HOLE],
  },
  {
    key: "sd_siouxfalls",
    name: "Sioux Falls",
    state: "SD",
    bbox: [43.4643, -96.8488, 43.6381, -96.5981],
    outer: SIOUXFALLS_OUTER,
    holes: SIOUXFALLS_HOLES,
  },
  {
    key: "mo_kansascity",
    name: "Kansas City",
    // Spans Jackson, Clay, Platte and Cass counties — `state` is display metadata only, never
    // part of the resolution test (see this module's own header). The ring test is the same
    // county-agnostic point-in-polygon check as every other scope here.
    state: "MO",
    bbox: [38.8243, -94.7653, 39.3562, -94.3854],
    outer: KANSASCITY_OUTER,
    holes: KANSASCITY_HOLES,
  },
  {
    key: "mo_independence",
    name: "Independence",
    state: "MO",
    bbox: [39.0176, -94.4814, 39.1398, -94.2159],
    outer: INDEPENDENCE_OUTER,
    holes: [],
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
