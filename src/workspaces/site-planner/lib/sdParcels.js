/* NEW-1 (B2343936, 2026-10-19) — SOUTH DAKOTA county parcel sources beyond the three hand-written rows already in counties.js (sd_pennington, sd_minnehaha,
 * sd_siouxfalls). South Dakota has NO statewide parcel layer (the State GIS server — sdgis.sd.gov — publishes boundaries, PLSS and tax-match districts, no
 * parcels); counties publish through (a) the First District Association of Local Governments' ArcGIS Server (www.1stdistrict.org — one folder per county),
 * (b) their own ArcGIS Online orgs, (c) Planning District III's server (gis.districtiii.org — answers the relay with a WAF 404/403, so NOT wired), and
 * (d) Beacon / Equator viewers (no public REST). A county absent from this table AND from counties.js has no measured public service and says so by name
 * ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "South Dakota counties (2026-10-19)" has the per-county table and what was searched.
 * Keys are `sd_`-prefixed. Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, scopeWhere, owner column?, centre lat, lng,
 * padded bbox]. Provenance prose lives in sdProvenance.js (build-time only, never shipped to the browser). */
export const SD_ROWS = [
  ["beadle","Beadle","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Beadle/beadleparcels/MapServer/0","PARCEL_ID",null,null,1,44.414,-98.281,[44.165, -98.735, 44.663, -97.826]],
  ["brown","Brown","https://services5.arcgis.com/H3Xuuu0h4PaTeWwU/arcgis/rest/services/Parcels_2025/FeatureServer/0","nParcelID",null,null,1,45.591,-98.355,[45.214, -98.762, 45.968, -97.949]],
  ["clark","Clark","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Clark/clarkmapnetpro/MapServer/1","PARCEL_ID",null,null,1,44.849,-97.74,[44.51, -98.015, 45.187, -97.465]],
  ["codington","Codington","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Codington/codingtonmapnetpro/MapServer/9","RECORD","PROP_STREE",null,1,44.978,-97.193,[44.769, -97.531, 45.187, -96.856]],
  ["deuel","Deuel","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Deuel/deuelmapnetpro/MapServer/2","RECORD","PROP_STREE",null,1,44.756,-96.673,[44.508, -96.92, 45.003, -96.425]],
  ["dewey","Dewey","https://services3.arcgis.com/VaWuldDb7HYFU2ja/arcgis/rest/services/DEWEY_COUNTY_LAYERS2/FeatureServer/4","PARCEL_ID","ADDRESS","PARCEL_ID <> 'TRIBAL'",1,45.104,-100.887,[44.7, -101.533, 45.507, -100.241]],
  ["edmunds","Edmunds","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Edmunds/edmundsmapnet/MapServer/2","RECORD",null,null,1,45.423,-99.22,[45.217, -99.746, 45.629, -98.695]],
  ["grant","Grant","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Grant/grantmapnetpro/MapServer/16","PARCEL","INQ_STREET_NAME",null,1,45.152,-96.842,[44.942, -97.259, 45.361, -96.424]],
  ["hamlin","Hamlin","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Hamlin/hamlinmapnetpro/MapServer/8","RECORD",null,null,1,44.671,-97.194,[44.51, -97.532, 44.832, -96.856]],
  ["hand","Hand","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Hand/handmapnet/MapServer/7","RECORD",null,null,1,44.547,-99.01,[44.169, -99.346, 44.924, -98.673]],
  ["kingsbury","Kingsbury","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Kingsbury/kingsburymapnetpro/MapServer/4","RECORD","PROP_STREE",null,1,44.368,-97.494,[44.164, -97.888, 44.573, -97.101]],
  ["lawrence","Lawrence","https://services8.arcgis.com/YKIZLV97YLZN6bol/arcgis/rest/services/Lawrence_Parcels_YrBlt/FeatureServer/0","PARCEL_ID","SITUS",null,1,44.377,-103.758,[44.116, -104.091, 44.638, -103.426]],
  ["miner","Miner","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Miner/minermapnetpro/MapServer/2","RECORD","PROP_STREE",null,1,44.02,-97.615,[43.814, -97.886, 44.225, -97.343]],
  ["moody","Moody","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Moody/moodymapnet/MapServer/7","PIN",null,null,1,44.022,-96.674,[43.815, -96.922, 44.229, -96.427]],
  ["roberts","Roberts","/gis-proxy/www.1stdistrict.org/arcgis/rest/services/Roberts/robertsmapnetpro/MapServer/3","PARCEL_ID",null,null,1,45.619,-96.855,[45.272, -97.263, 45.967, -96.448]],
];
export const sdRaw = () => Object.fromEntries(SD_ROWS.map(([k, n, url, id, addr, scope]) => ["sd_" + k, {
  state: "SD", label: n + " County, SD", layerUrl: url, idField: id, ...(addr ? { addrField: addr } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const sdMap = () => Object.fromEntries(SD_ROWS.map(([k, , url, , , scope, , la, ln, bb]) => ["sd_" + k, {
  state: "SD", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
