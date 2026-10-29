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
const q = async (url, params) => {
  const u = new URL(url); for (const [k, v] of Object.entries({ f: "geojson", outSR: 4326, outFields: "*", ...params })) u.searchParams.set(k, v);
  const r = await fetch(u); if (!r.ok) throw new Error(`${url} → ${r.status}`);
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
for (const [k, a] of Object.entries(areas)) console.log(k, a.polys.length, "polygons", a.polys.reduce((n, p) => n + p.reduce((m, r) => m + r.length, 0), 0), "vertices");
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(OUT, `/* GENERATED by scripts/build-service-areas.mjs on ${stamp} — do not hand-edit. Each area is a list of polygons; a polygon is
 * [outerRing, ...holes]; a ring is [[lng, lat], …]. Read through lib/serviceAreas.js (areaContains), never directly. */
export const SERVICE_AREAS = ${JSON.stringify(areas)};
`);
console.log("wrote", OUT.pathname, fs.statSync(OUT).size, "bytes");
