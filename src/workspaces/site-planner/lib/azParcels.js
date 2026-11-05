/* NEW-1 (Arizona, 2026-10-19) — ARIZONA county parcel sources beyond the two hand-written rows in counties.js (az_pinal, az_maricopa).
 * Two shapes, both MEASURED live before wiring (docs/STATEWIDE-PARCELS.md "Arizona counties (2026-10-19)" has the per-county table and what was searched):
 *   · the Arizona Department of Water Resources' multi-county parcel compile, published on ArcGIS Online ("Parcel layers displayed in ADWR applications",
 *     services.arcgis.com/C34zQ7veRS0V1t04 … /Parcels/FeatureServer) — ONE layer per county, each with APN, owner, situs and acres, last edited 2026-04-21.
 *     It is wired as the base for the counties where no fresher county layer with an owner exists. It does NOT hold Maricopa, Mohave or Yavapai.
 *   · Mohave County's own GIS server (mcgis.mohave.gov, PARCELS MapServer layer 14 'ParcelQueryLayer'), relayed through /gis-proxy because the build sandbox cannot read its CORS headers.
 *   · the county's OWN ArcGIS Online layer where one exists, was edited this month, and carries id + owner (Coconino, Graham, Navajo, Yavapai).
 * A county absent from this table AND from counties.js has no usable public service and says so by name ("<County> — no parcel data wired here yet").
 * Keys are `az_`-prefixed. Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, scopeWhere, owner column?, centre lat, lng, padded bbox, outline floor?].
 * OUTLINE FLOOR (`displayMinZoom`, optional 11th column): a FeatureServer answers at most 2,000 lots a query and has no server-picture regime to fall back on. Measured 2026-10-19 on the
 * busiest 1 km cell at each county's towns: 600–1,133 lots at zoom 16, so a zoom-15 cell (four times the ground) overflows and would draw an arbitrary 2,000 with nothing saying so. The ten
 * counties with a town that dense floor at 16 (below it the existing "zoom in to see the lines" hint shows; a click is unaffected at every zoom). Apache and Greenlee measured 10 and 221, so they keep the generic floor.
 * The id / address columns are PINNED (`pinIdField` / `pinAddrField`): each was read off the real layer, and the generic detector would otherwise prefer an internal column (Navajo's account number, Yavapai's 13-digit PARCEL_ID) over the APN people search by.
 * Provenance prose lives in azProvenance.js (build-time only, never shipped to the browser). */
const ADWR = "https://services.arcgis.com/C34zQ7veRS0V1t04/arcgis/rest/services/Parcels/FeatureServer/"; // the ADWR compile — one layer per county
export const AZ_ROWS = [
  ["apache","Apache",ADWR+"0","APN","SITE_ADDRESS",null,1,36.43341,-109.52152,[33.46, -110.017, 37.017, -109.026]],
  ["cochise","Cochise",ADWR+"1","APN","SITE_ADDRESS",null,1,31.89042,-109.85364,[31.317, -110.478, 32.466, -109.026],16],
  ["coconino","Coconino","https://services1.arcgis.com/Rlvx5g8pKeK13apH/arcgis/rest/services/Coconino_County_Parcels_Public_View/FeatureServer/0","APN","SITUS",null,1,35.97521,-111.7294,[34.241, -113.367, 37.023, -110.72],16],
  ["gila","Gila",ADWR+"3","APN","SITE_ADDRESS",null,1,33.63859,-110.71143,[32.969, -111.727, 34.541, -109.972],16],
  ["graham","Graham","https://services.arcgis.com/rr5PkYU3R3HXxyDH/arcgis/rest/services/Graham_County_Parcels_New/FeatureServer/7","Parcel_No",null,null,1,32.92913,-109.96244,[32.42, -110.477, 33.674, -109.105],16],
  ["greenlee","Greenlee",ADWR+"5","APN","SITE_ADDRESS",null,1,33.52448,-109.27453,[32.422, -109.52, 33.806, -109.029]],
  ["lapaz","La Paz",ADWR+"6","APN","SITE_ADDRESS",null,1,33.81698,-113.72684,[33.007, -114.755, 34.357, -113.307],16],
  ["mohave","Mohave","/gis-proxy/mcgis.mohave.gov/arcgis/rest/services/PARCELS/MapServer/14","PARCEL","SITE_ADDRESS",null,1,35.42768,-113.95709,[34.188, -114.756, 37.018, -112.504]],
  ["navajo","Navajo","https://services.arcgis.com/cghC2lEIpJ2TRrs5/arcgis/rest/services/Parcels/FeatureServer/0","APN","SitusAddress",null,1,34.91335,-110.28888,[33.554, -110.763, 37.024, -109.805],16],
  ["pima","Pima",ADWR+"10","APN","SITE_ADDRESS",null,1,32.01402,-111.56587,[31.412, -113.35, 32.546, -110.427],16],
  ["santacruz","Santa Cruz",ADWR+"12","APN","SITE_ADDRESS",null,1,31.5382,-110.79226,[31.316, -111.389, 31.761, -110.431],16],
  ["yavapai","Yavapai","https://services1.arcgis.com/BajuNXbtZNiBKFkx/arcgis/rest/services/Parcels/FeatureServer/1","PARLABEL","SITUS_ADD_DOR",null,1,34.5831,-112.75083,[33.879, -113.352, 35.561, -111.439],16],
  ["yuma","Yuma",ADWR+"13","APN","SITE_ADDRESS",null,1,32.7356,-113.84594,[32.023, -114.842, 33.521, -113.309],16],
];
export const azRaw = () => Object.fromEntries(AZ_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb, floor]) => ["az_" + k, {
  state: "AZ", label: n + " County, AZ", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}), ...(floor ? { displayMinZoom: floor } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const azMap = () => Object.fromEntries(AZ_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb, floor]) => ["az_" + k, {
  state: "AZ", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}), ...(floor ? { displayMinZoom: floor } : {}),
}]));
