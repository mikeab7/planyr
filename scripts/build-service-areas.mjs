/* Builds src/workspaces/site-planner/lib/serviceAreaData.js — the DECLARED SERVICE AREAS the Imagery & Layers panel scopes a
 * source to (B2436066). Run:  node scripts/build-service-areas.mjs   (needs network; the output is committed).
 *
 *   harris   Harris County, from the SAME bundled county polygons the finder's `countyForView` resolves a point with
 *            (public/geo/county-polygons.json) — so "which county" cannot differ between the two surfaces.
 *   houston  City of Houston limits (TxGIO City_Boundaries, full-purpose) ∪ Houston's ETJ (H-GAC HGAC_City_ETJ_Boundaries,
 *            CITY='HOUSTON'). The City of Houston water / sewer / storm / hydrant data is served for this area.
 *   bkdd     Brookshire–Katy Drainage District boundary (Waller County GIS, Brookshire_Katy_Drainage_District1 layer 54).
 *
 * The server-side simplification (maxAllowableOffset ≈ 0.4 km) is why `serviceAreas.areaContains` probes a small ring of points
 * around the site and answers "yes" if ANY is inside: an approximation may only ever err towards SHOWING a layer. */
import fs from "node:fs";
import { buildIndex } from "../src/workspaces/site-planner/lib/countyPolygonsCore.js";

const OUT = new URL("../src/workspaces/site-planner/lib/serviceAreaData.js", import.meta.url);
const round = (n) => Math.round(n * 1e4) / 1e4;
const q = async (url, params, headers = {}) => {
  const u = new URL(url); for (const [k, v] of Object.entries({ f: "geojson", outSR: 4326, outFields: "*", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers }); if (!r.ok) throw new Error(`${url} → ${r.status}`);
  const j = await r.json(); if (j.error) throw new Error(`${url} → ${JSON.stringify(j.error)}`);
  return j;
};
const polysOf = (gj) => gj.features.flatMap((f) => (f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates))
  .map((poly) => poly.map((ring) => ring.map(([x, y]) => [round(x), round(y)])));

const index = buildIndex(JSON.parse(fs.readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
const harrisRec = index.counties.find((c) => c.state === "TX" && /^harris$/i.test(c.name.replace(/ county$/i, "")));
if (!harrisRec) throw new Error("Harris County not found in the county polygon asset");
// the asset's rings are independent outer rings (resolveIn tests `some ring contains`), so each is its own polygon
const harris = harrisRec.rings.map((ring) => [ring.map(([x, y]) => [round(x / index.scale), round(y / index.scale)])]);

/* NEW-1 (DeSoto County MS, B2507056–B2507059):
 *   desoto        DeSoto County MS, from the SAME bundled county polygons as `harris` (no network).
 *   olivebranch   the City of Olive Branch's planning area ∪ annexation areas (the city's ArcGIS Online org services9.arcgis.com/VGtdH6iTQlVulSnr —
 *                 OLIVE_BRANCH_PLANNING_AREA + ANNEXATION_AREA_BOUNDARY). The Olive Branch utility layers are declared for this area.
 * `--only=desoto,olivebranch` rebuilds just those and keeps every other area as it is in the committed file (the Houston / BKDD fetches need hosts a
 * build sandbox may not reach). */
const ONLY = ((process.argv.find((a) => a.startsWith("--only=")) || "").slice(7)).split(",").filter(Boolean);
const want = (k) => !ONLY.length || ONLY.includes(k);
const areas = ONLY.length ? { ...(await import(OUT.href)).SERVICE_AREAS } : {};
if (want("harris")) areas.harris = { label: "Harris County", source: "Planyr's bundled county polygons (public/geo/county-polygons.json)", polys: harris };
if (want("houston")) {
  const cityLimits = await q("https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0/query", { where: "city_name='Houston'", maxAllowableOffset: 0.004 });
  const etj = await q("https://services.arcgis.com/su8ic9KbA7PYVxPS/arcgis/rest/services/HGAC_City_ETJ_Boundaries/FeatureServer/0/query", { where: "CITY='HOUSTON'", maxAllowableOffset: 0.004 });
  areas.houston = { label: "City of Houston limits and ETJ", source: "TxGIO City_Boundaries (Houston) + H-GAC HGAC_City_ETJ_Boundaries (HOUSTON)", polys: [...polysOf(cityLimits), ...polysOf(etj)] };
}
if (want("bkdd")) {
  const bkdd = await q("https://services1.arcgis.com/BqVKz0o32DERqyE4/arcgis/rest/services/Brookshire_Katy_Drainage_District1/FeatureServer/54/query", { where: "1=1", maxAllowableOffset: 0.003 });
  areas.bkdd = { label: "Brookshire–Katy Drainage District", source: "Waller County GIS Brookshire_Katy_Drainage_District1 layer 54", polys: polysOf(bkdd) };
}
if (want("desoto")) {
  const rec = index.counties.find((c) => c.state === "MS" && /^de ?soto$/i.test(c.name.replace(/ county$/i, "")));
  if (!rec) throw new Error("DeSoto County MS not found in the county polygon asset");
  areas.desoto = { label: "DeSoto County, MS", source: "Planyr's bundled county polygons (public/geo/county-polygons.json)", polys: rec.rings.map((ring) => [ring.map(([x, y]) => [round(x / index.scale), round(y / index.scale)])]) };
}
/* NEW-1 (Florida, B2452976): the county- and district-scoped Florida rows.
 *   broward / miamidade               the county, from the SAME bundled county polygons as `harris` (no network).
 *   sfwmd                             the South Florida Water Management District, from its own published boundary (SFWMD's hosted
 *                                     "Water Management District Boundaries", WMDNAME='SFWMD'); the ERP permit layer, canals and rights of way are
 *                                     SFWMD's own and carry nothing outside it. */
for (const [key, name, label] of [["broward", "Broward", "Broward County, FL"], ["miamidade", "Miami-Dade", "Miami-Dade County, FL"]]) {
  if (!want(key)) continue;
  const rec = index.counties.find((c) => c.state === "FL" && c.name.replace(/ county$/i, "") === name);
  if (!rec) throw new Error(`${label} not found in the county polygon asset`);
  areas[key] = { label, source: "Planyr's bundled county polygons (public/geo/county-polygons.json)", polys: rec.rings.map((ring) => [ring.map(([x, y]) => [round(x / index.scale), round(y / index.scale)])]) };
}
if (want("sfwmd")) {
  const wmd = await q("https://services1.arcgis.com/sDAPyc2rGRn7vf9B/arcgis/rest/services/BDWMD_Boundary_Area/FeatureServer/0/query", { where: "WMDNAME='SFWMD'", maxAllowableOffset: 0.004 });
  areas.sfwmd = { label: "South Florida Water Management District", source: "SFWMD Water Management District Boundaries (services1.arcgis.com/sDAPyc2rGRn7vf9B), WMDNAME='SFWMD'", polys: polysOf(wmd) };
}
if (want("pantherconsult")) {
  /* USFWS's South Florida panther consultation area (one multipart polygon), as FDEP hosts it. FDEP's server is not reachable from every build sandbox, so it is read through planyr.io's same-origin relay
   * (a browser-style User-Agent is needed: Cloudflare refuses a bare script one). PLANYR_RELAY_BASE overrides the origin (a branch preview works before the relay is on the apex). */
  const base = process.env.PLANYR_RELAY_BASE || "https://planyr.io";
  /* FDEP's MapServer answers f=geojson only with a token, so read Esri JSON and take every ring as its own polygon (a hole is therefore filled — an area may only ever err toward SHOWING a layer). */
  const u = new URL(`${base}/gis-proxy/ca.dep.state.fl.us/arcgis/rest/services/OpenData/PANTHER_CONSULT_AREA/MapServer/0/query`);
  for (const [k, v] of Object.entries({ f: "json", where: "1=1", outSR: 4326, returnGeometry: "true", maxAllowableOffset: 0.004 })) u.searchParams.set(k, v);
  const r = await fetch(u, { headers: { "user-agent": "Mozilla/5.0 Chrome/120" } }); if (!r.ok) throw new Error(`${u} → ${r.status}`);
  const j = await r.json(); if (j.error) throw new Error(`${u} → ${JSON.stringify(j.error)}`);
  const polys = j.features.flatMap((f) => f.geometry.rings.map((ring) => [ring.map(([x, y]) => [round(x), round(y)])]));
  areas.pantherconsult = { label: "USFWS Florida panther consultation area", source: "USFWS South Florida Ecological Services consultation area (FDEP OpenData PANTHER_CONSULT_AREA)", polys };
}
if (want("olivebranch")) {
  /* The city's PLANNING AREA is the ground AROUND the city (it excludes the city proper — measured: downtown Olive Branch is outside it), so it cannot stand for
   * "where the city's utility data lives". The region is instead the union of the published data extents of every Olive Branch utility layer, the planning area and
   * the annexation areas (all via returnExtentOnly, WGS84), padded 0.02° (≈1.4 mi) — a rectangle, honestly "within or near Olive Branch". */
  const OB = "https://services9.arcgis.com/VGtdH6iTQlVulSnr/ArcGIS/rest/services";
  const layers = ["WATER_UTILITIES_(VIEWER)/FeatureServer/6", "WATER_UTILITIES_(VIEWER)/FeatureServer/2", "WASTEWATER_UTILITIES_(Viewer)/FeatureServer/6", "WASTEWATER_UTILITIES_(Viewer)/FeatureServer/7",
    "WASTEWATER_UTILITIES_(Viewer)/FeatureServer/3", "GAS_UTILITIES_(VIEWER)/FeatureServer/5", "OLIVE_BRANCH_PLANNING_AREA/FeatureServer/0", "ANNEXATION_AREA_BOUNDARY/FeatureServer/0"];
  let ext = null;
  for (const l of layers) {
    const u = new URL(`${OB}/${l}/query`); for (const [k, v] of Object.entries({ f: "json", where: "1=1", returnExtentOnly: "true", outSR: 4326 })) u.searchParams.set(k, v);
    const r = await fetch(u); const j = await r.json(); if (!j.extent) throw new Error(`${l} → no extent ${JSON.stringify(j)}`);
    const e = j.extent; ext = ext ? { xmin: Math.min(ext.xmin, e.xmin), ymin: Math.min(ext.ymin, e.ymin), xmax: Math.max(ext.xmax, e.xmax), ymax: Math.max(ext.ymax, e.ymax) } : e;
  }
  const PAD = 0.02, x0 = round(ext.xmin - PAD), y0 = round(ext.ymin - PAD), x1 = round(ext.xmax + PAD), y1 = round(ext.ymax + PAD);
  areas.olivebranch = { label: "Olive Branch, MS and its utility service area", source: "Union of the data extents of the City of Olive Branch ArcGIS Online utility, planning-area and annexation layers (services9.arcgis.com/VGtdH6iTQlVulSnr), padded 0.02°", polys: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]] };
}
/* NEW-1 (Colorado due-diligence layers, B2528688): the county / city areas the Weld, Adams and Aurora rows are declared for.
 *   co_weld, co_adams   the county, from the SAME bundled county polygons as `harris` (no network).
 *   co_aurora           the union of the data extents of the City of Aurora's airport-noise, Buckley APZ, zoning and city-limits layers (ags.auroragov.org/aurora/rest/services/OpenData/MapServer
 *                       layers 25, 26, 20, 41; returnExtentOnly, WGS84, measured 2026-10-29 through the planyr.io relay because the city's host is not reachable from a build sandbox), padded 0.02° —
 *                       a rectangle, honestly "within or near Aurora and its airports' influence areas" (the noise contours run past the city limits to Denver International). */
const COUNTY_AREA = (key, name, label) => {
  const rec = index.counties.find((c) => c.state === "CO" && c.name.replace(/ county$/i, "").toLowerCase() === name);
  if (!rec) throw new Error(`${label} not found in the county polygon asset`);
  areas[key] = { label, source: "Planyr's bundled county polygons (public/geo/county-polygons.json)", polys: rec.rings.map((ring) => [ring.map(([x, y]) => [round(x / index.scale), round(y / index.scale)])]) };
};
if (want("co_weld")) COUNTY_AREA("co_weld", "weld", "Weld County, CO");
if (want("co_adams")) COUNTY_AREA("co_adams", "adams", "Adams County, CO");
if (want("co_aurora")) {
  const ext = { xmin: -104.9029, ymin: 39.4922, xmax: -104.4683, ymax: 39.9156 }; // union of layers 25 / 26 / 20 / 41 (see above)
  const PAD = 0.02, x0 = round(ext.xmin - PAD), y0 = round(ext.ymin - PAD), x1 = round(ext.xmax + PAD), y1 = round(ext.ymax + PAD);
  areas.co_aurora = { label: "Aurora, CO and its airports' influence areas", source: "Union of the data extents of the City of Aurora open-data airport-noise, Buckley APZ, zoning and city-limits layers (ags.auroragov.org), padded 0.02°", polys: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]] };
}
/* NEW-1 (Georgia due-diligence gaps, 2026-10-29):
 *   mngwpd       the 15-county Metropolitan North Georgia Water Planning District (ARC's `MNGWPD_Boundary` layer 1 — the SAME outline the stream-buffer rule uses).
 *                The Chattahoochee MRPA corridor/buffers and the District's small water supply watersheds are declared for this area.
 *   spalding_ga  Spalding County GA, from the SAME bundled county polygons as `harris` (no network) — the county's own unincorporated zoning layer.
 * `--only=mngwpd,spalding_ga,ga_blue_ridge,bartow_ga,mrpa_corridor` rebuilds just these five and keeps every other area as committed. */
if (want("mngwpd")) {
  /* The District outline is NOT enough on its own: the District's own small-water-supply watersheds reach past it (the Randy Poynter reservoir's basin sits partly in
   * Walton/Newton — measured: its interior point is outside the outline). The region is the outline ∪ those watersheds ∪ the Chattahoochee MRPA corridor, so a row declared
   * for it is never hidden over ground its own data covers. (The Chattahoochee MRPA rows use the narrower `mrpa_corridor` below — Bartow's Adairsville is a District county, 70 miles from the river.) */
  const ARC = "https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services";
  const parts = [];
  for (const l of ["MNGWPD_Boundary/FeatureServer/1", "SWSW/FeatureServer/0", "ProtectedSWSW/FeatureServer/1"]) parts.push(...polysOf(await q(`${ARC}/${l}/query`, { where: "1=1", maxAllowableOffset: 0.003 })));
  areas.mngwpd = { label: "Metropolitan North Georgia Water Planning District and its water-supply watersheds", source: "Atlanta Regional Commission MNGWPD_Boundary layer 1 ∪ SWSW ∪ ProtectedSWSW", polys: parts };
}
if (want("ga_blue_ridge")) {
  /* DCA's protected-mountain polygon (one feature, 28k pieces) is north Georgia only: the region is its published data extent (returnExtentOnly, WGS84) padded 0.05° — a rectangle,
   * honestly "within or near the Georgia mountains", so a Savannah or Macon site is not offered a layer that can only ever read "nothing here". */
  const u = new URL("https://services2.arcgis.com/Gqyymy5JISeLzyNM/arcgis/rest/services/EnvironmentalPlanning/FeatureServer/3/query");
  for (const [k, v] of Object.entries({ f: "json", where: "1=1", returnExtentOnly: "true", outSR: 4326 })) u.searchParams.set(k, v);
  const j = await (await fetch(u)).json(); if (!j.extent) throw new Error(`protected mountains → no extent ${JSON.stringify(j)}`);
  const e = j.extent, PAD = 0.05, x0 = round(e.xmin - PAD), y0 = round(e.ymin - PAD), x1 = round(e.xmax + PAD), y1 = round(e.ymax + PAD);
  areas.ga_blue_ridge = { label: "North Georgia mountains (DCA protected-mountain data extent)", source: "Georgia DCA EnvironmentalPlanning layer 3 (ProtectedMountainAreas) extent, padded 0.05°", polys: [[[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]] };
}
if (want("mrpa_corridor")) {
  /* The Chattahoochee MRPA corridor (ARC's 2,000-ft polygon, Buford Dam → the Fulton/Douglas line) is a thin diagonal ribbon: its bounding box swallows half of metro Atlanta and the District outline swallows
   * Bartow. The region is the cells of a 0.05° grid (~3.5 mi) the ribbon passes through, plus their eight neighbours — "on or within a few miles of the river" — as one square polygon per cell. */
  const u = new URL("https://services1.arcgis.com/Ug5xGQbHsD8zuZzM/arcgis/rest/services/Chattahoochee_River_Corridor_2000ft/FeatureServer/0/query");
  for (const [k, v] of Object.entries({ f: "geojson", where: "1=1", outSR: 4326, outFields: "*", maxAllowableOffset: 0.0005 })) u.searchParams.set(k, v);
  const gj = await (await fetch(u)).json(); if (!gj.features || !gj.features.length) throw new Error("MRPA corridor → no features");
  const CELL = 0.05, cells = new Set(), mark = (x, y) => { const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL); for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) cells.add(`${cx + dx},${cy + dy}`); };
  for (const poly of polysOf(gj)) for (const ring of poly) for (let i = 0; i < ring.length; i++) {
    mark(ring[i][0], ring[i][1]);
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length], n = Math.ceil(Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1)) / (CELL / 2));
    for (let k = 1; k < n; k++) mark(x1 + ((x2 - x1) * k) / n, y1 + ((y2 - y1) * k) / n); // an edge longer than half a cell would otherwise skip the cells between its ends
  }
  const sq = (c) => { const [cx, cy] = c.split(",").map(Number), x0 = round(cx * CELL), y0 = round(cy * CELL), x1 = round((cx + 1) * CELL), y1 = round((cy + 1) * CELL); return [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]; };
  areas.mrpa_corridor = { label: "Along the Chattahoochee MRPA corridor (within a few miles)", source: "ARC Chattahoochee_River_Corridor_2000ft, dilated to a 0.05° grid", polys: [...cells].map(sq) };
}
if (want("bartow_ga")) {
  const rec = index.counties.find((c) => c.state === "GA" && /^bartow$/i.test(c.name.replace(/ county$/i, "")));
  if (!rec) throw new Error("Bartow County GA not found in the county polygon asset");
  areas.bartow_ga = { label: "Bartow County, GA", source: "Planyr's bundled county polygons (public/geo/county-polygons.json)", polys: rec.rings.map((ring) => [ring.map(([x, y]) => [round(x / index.scale), round(y / index.scale)])]) };
}
if (want("spalding_ga")) {
  const rec = index.counties.find((c) => c.state === "GA" && /^spalding$/i.test(c.name.replace(/ county$/i, "")));
  if (!rec) throw new Error("Spalding County GA not found in the county polygon asset");
  areas.spalding_ga = { label: "Spalding County, GA", source: "Planyr's bundled county polygons (public/geo/county-polygons.json)", polys: rec.rings.map((ring) => [ring.map(([x, y]) => [round(x / index.scale), round(y / index.scale)])]) };
}
for (const [k, a] of Object.entries(areas)) console.log(k, a.polys.length, "polygons", a.polys.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0), "vertices");
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, `/* GENERATED by scripts/build-service-areas.mjs on ${stamp} — do not hand-edit. Each area is a list of polygons; a polygon is
 * [outerRing, ...holes]; a ring is [[lng, lat], …]. Read through lib/serviceAreas.js (areaContains), never directly. */
export const SERVICE_AREAS = ${JSON.stringify(areas)};
`);
console.log("wrote", OUT.pathname, fs.statSync(OUT).size, "bytes");
