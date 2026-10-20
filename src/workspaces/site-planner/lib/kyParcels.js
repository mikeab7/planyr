/* NEW-1 (Kentucky, 2026-10-19) — KENTUCKY county parcel sources. Kentucky has NO statewide parcel service (the Division of Geographic
 * Information publishes per-county PVA layers, and its server now carries only Webster's; KYTC holds PVA parcels for 106 counties but does not
 * serve them), so each county is wired to its own PVA / planning-commission / county-GIS layer. A county absent from this table has no usable
 * public service and says so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "Kentucky counties" has the
 * per-county table and what was searched. Jefferson (Louisville) is the one hand-written row in counties.js (ky_jefferson); Fulton is an
 * owner-accepted gap (2026-10-16).
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, scopeWhere, owner column?, centre lat, lng,
 * padded bbox]. Provenance prose lives in kyProvenance.js (build-time only, never shipped to the browser). */
export const KY_ROWS = [
  ["fayette","Fayette","https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/arcgis/rest/services/Parcel/FeatureServer/0","PVANUM","ADDRESS",null,0,38.0289,-84.472,[37.816, -84.69, 38.241, -84.253]],
  ["mccracken","McCracken","https://services1.arcgis.com/xkOPDyh2DVxtFEGe/arcgis/rest/services/PVAParcels/FeatureServer/1","PARCEL_ID","LOCATION",null,0,37.084,-88.7233,[36.912, -88.972, 37.259, -88.453]],
  ["henderson","Henderson","https://services.arcgis.com/Iwwqwcdc5CWG2jt9/arcgis/rest/services/Parcels/FeatureServer/0","PIDN",null,null,0,37.8063,-87.578,[37.608, -87.957, 38.005, -87.242]],
  ["henry","Henry","https://services5.arcgis.com/SRuaqVyoD8TEQJga/arcgis/rest/services/HenryCoParcels/FeatureServer/13","PARCEL_ID",null,null,0,38.468,-85.1456,[38.306, -85.376, 38.627, -84.837]],
  ["simpson","Simpson","https://services6.arcgis.com/P3u2F80lQaN3sLkC/arcgis/rest/services/Public_Access_Parcels/FeatureServer/0","PIDN","Property_L",null,0,36.766,-86.5707,[36.604, -86.793, 36.913, -86.371]],
  ["webster","Webster","https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_Webster_Parcels_WM_gdb/FeatureServer/0","PARCEL_ID",null,null,0,37.5148,-87.6732,[37.321, -87.974, 37.678, -87.345]],
  ["breathitt","Breathitt","https://services.arcgis.com/9Dz5quHPmab2pMtb/arcgis/rest/services/Breathitt_Parcels/FeatureServer/1","PARCEL_ID",null,null,0,37.5156,-83.3354,[37.3, -83.61, 37.73, -82.919]],
  ["franklin","Franklin","https://services2.arcgis.com/1Mn98EWnWi3Ezwj3/arcgis/rest/services/1319Parcels/FeatureServer/0","PARCEL_ID",null,null,0,38.2506,-84.8669,[38.063, -85.054, 38.405, -84.695]],
  ["oldham","Oldham","https://services5.arcgis.com/4eBIYcSR3sVL9y0D/ArcGIS/rest/services/Parcels/FeatureServer/0","PARCELID",null,null,0,38.4091,-85.476,[38.255, -85.668, 38.554, -85.253]],
  ["shelby","Shelby","https://services2.arcgis.com/VqPd1Ybcc46AvijK/arcgis/rest/services/Parcels_Service/FeatureServer/0","PARCEL_ID","Location",null,0,38.2011,-85.2097,[38.007, -85.498, 38.388, -84.927]],
  ["todd","Todd","https://services2.arcgis.com/UAAKLK1ZNmY4DOkd/arcgis/rest/services/Parcels/FeatureServer/6","PARCEL_ID",null,null,0,36.8339,-87.1799,[36.612, -87.366, 37.106, -87.02]],
  ["woodford","Woodford","https://services9.arcgis.com/eE18Y8QhAVKzp7mP/arcgis/rest/services/Parcels/FeatureServer/0","PARCEL","Location",null,0,38.0199,-84.7445,[37.817, -84.896, 38.225, -84.595]],
  ["meade","Meade","https://services1.arcgis.com/ufOeQWjwz5JyJXKQ/ArcGIS/rest/services/Meade_Co_KY_Addresses_Roads_Lot_Lines_WFL1/FeatureServer/5","PIDN","Location",null,0,37.999,-86.2527,[37.769, -86.521, 38.229, -85.946]],
  ["trimble","Trimble","https://services5.arcgis.com/SRuaqVyoD8TEQJga/arcgis/rest/services/Trimble_Co_Current_Landuse/FeatureServer/0","PIDN",null,null,0,38.615,-85.3325,[38.463, -85.487, 38.767, -85.138]],
  ["boone","Boone","https://services1.arcgis.com/kleO5B3qko1eLO4Z/arcgis/rest/services/Tax_Parcels/FeatureServer/0","PIDN","SITEADD1",null,0,38.9644,-84.721,[38.747, -84.927, 39.178, -84.568]],
  ["madison","Madison","/gis-proxy/arcserver.madisoncountyky.us/arcgis/rest/services/County_Web_Maps/County_Parcels/MapServer/1","Parcel_ID",null,null,0,37.7153,-84.2897,[37.485, -84.556, 37.947, -84.044]],
  ["campbell","Campbell","/gis-proxy/maps.linkgis.org/server/rest/services/CC_KC_PCTheme/MapServer/9","PIDN",null,null,0,38.9643,-84.3661,[38.776, -84.536, 39.152, -84.202]],
  ["kenton","Kenton","/gis-proxy/maps.linkgis.org/server/rest/services/CC_KC_PCTheme/MapServer/15","PIDN",null,null,0,38.9421,-84.5345,[38.76, -84.654, 39.13, -84.387]],
  ["pendleton","Pendleton","/gis-proxy/maps.linkgis.org/server/rest/services/CC_KC_PCTheme/MapServer/18","PARCEL_ID","Location",null,0,38.6873,-84.364,[38.499, -84.562, 38.905, -84.166]],
  ["warren","Warren","/gis-proxy/webgis.bgky.org/server/rest/services/CCPC/CCPC_Parcels/FeatureServer/0","PVA_PARCEL",null,null,0,36.9676,-86.4049,[36.746, -86.704, 37.221, -86.084]],
  ["scott","Scott","/gis-proxy/gis.gscplanning.com/arcgis/rest/services/Parcels/MapServer/0","GIS_MapID",null,null,0,38.3009,-84.5859,[38.081, -84.771, 38.523, -84.372]],
  ["jessamine","Jessamine","https://services8.arcgis.com/zS6BFcOikVpehjJD/arcgis/rest/services/Parcels_Published/FeatureServer/0","PARCEL_ID","PROP_ADD",null,0,37.876,-84.5921,[37.698, -84.76, 38.041, -84.41]],
  ["spencer","Spencer","https://services5.arcgis.com/SRuaqVyoD8TEQJga/arcgis/rest/services/SpencerZoning/FeatureServer/0","PARCEL_ID",null,null,0,38.0381,-85.3349,[37.906, -85.555, 38.192, -85.074]],
  ["hardin","Hardin","https://services1.arcgis.com/fYwcHOBzInDTQxh0/arcgis/rest/services/Hardin_Parcels_08_11_22/FeatureServer/0","PARCEL_ID","PROP_ADD",null,0,37.6961,-85.9696,[37.403, -86.316, 38.047, -85.652]],
  ["bullitt","Bullitt","https://services3.arcgis.com/7GIe3Xxna70nAWN0/arcgis/rest/services/Bullitt_County_Kentucky_Zoning_Classification_WFL1/FeatureServer/46","PARCEL_ID",null,null,0,37.9673,-85.7076,[37.781, -85.978, 38.154, -85.412]],
  ["daviess","Daviess","https://services1.arcgis.com/0qqIwtRYsyVJ7lna/arcgis/rest/services/City_Services/FeatureServer/6","PARCEL_ID","full_prope",null,0,37.729,-87.0907,[37.529, -87.448, 37.966, -86.792]],
  ["mercer","Mercer","https://services2.arcgis.com/BxXA8zJZUU4360ND/arcgis/rest/services/Mercer_County_Planning_and_Zoning_WFL1/FeatureServer/123457","PARCEL_ID","Location",null,0,37.8101,-84.8851,[37.646, -85.069, 38.003, -84.668]],
  ["anderson","Anderson","https://services2.arcgis.com/BxXA8zJZUU4360ND/arcgis/rest/services/Anderson_County_Zoning_WFL1/FeatureServer/1","PARCEL_ID",null,null,0,38.0045,-85.0007,[37.837, -85.213, 38.16, -84.788]],
  ["montgomery","Montgomery","https://services3.arcgis.com/aaZhjjkUqOHS7oRg/arcgis/rest/services/Parcels/FeatureServer/0","PARCEL_ID",null,null,0,38.0348,-83.9211,[37.87, -84.121, 38.228, -83.721]],
  ["rowan","Rowan","https://services3.arcgis.com/aaZhjjkUqOHS7oRg/arcgis/rest/services/Rowan_Existing_Land_Use/FeatureServer/0","PIDN",null,null,0,38.199,-83.421,[37.985, -83.673, 38.432, -83.169]],
  ["hopkins","Hopkins","/gis-proxy/www.hopkinscountygis.com:6443/arcgis/rest/services/Parcel/MapServer/0","Parcel_ID",null,null,0,37.3036,-87.5521,[37.075, -87.89, 37.601, -87.27]],
  ["pulaski","Pulaski","https://services9.arcgis.com/2rJXfGpU7WMGx1RV/arcgis/rest/services/Parcels_10_2025/FeatureServer/0","PARCEL_ID",null,null,0,37.1156,-84.5917,[36.836, -84.956, 37.395, -84.259]],
];
export const kyRaw = () => Object.fromEntries(KY_ROWS.map(([k, n, url, id, addr, scope]) => ["ky_" + k, {
  state: "KY", label: n + " County, KY", layerUrl: url, idField: id, ...(addr ? { addrField: addr } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (county PVA / GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const kyMap = () => Object.fromEntries(KY_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb]) => ["ky_" + k, {
  state: "KY", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
