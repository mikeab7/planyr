/* NEW-1 (South Carolina, 2026-10-19) — SOUTH CAROLINA county parcel sources: all 46 counties. Greenville stays hand-written in counties.js (sc_greenville, wired 2026-09-11); the other 45 are here.
 * South Carolina's Revenue and Fiscal Affairs Office (RFA, the state's own GIS section) publishes ONE statewide parcel layer — "Statewide_Parcels", 2,968,877 parcels across all 46 counties, with the
 * tax-map number, owner name (all but eight counties' rolls), acreage and values, last edited January 2026 — as layer 18 of its public "Lexington Richland" web-map service on ArcGIS Online. It is
 * the base for every county here, scoped to one county per row by `scopeWhere` on its `County` field (the way Mississippi rides MARIS). RFA's own page says its aggregated parcels are otherwise
 * available only through "secure" services, so the layer being anonymous is flagged to the owner in docs/STATEWIDE-PARCELS.md. Ten counties use their OWN county layer instead, because it
 * carries a site address RFA never has (Beaufort, Colleton, Laurens, Pickens, Sumter, York) or the owner RFA lacks (Barnwell, Calhoun, Lee, Spartanburg). A host that is not
 * *.arcgis.com rides /gis-proxy (and is on its allow-list). The state's SCDOT index of per-county layers (smpesri.scdot.org) answers "Token Required" and is NOT used.
 * Row: [slug, county name, layer, idField, addrField, scopeWhere, owner column?, centre lat, lng, padded bbox]. Provenance prose lives in scProvenance.js (build-time only, never shipped to the
 * browser); docs/STATEWIDE-PARCELS.md "South Carolina counties (2026-10-19)" has the per-county table and what was searched. */
const RFA = "https://services9.arcgis.com/RvqSyw3diI7dTKo5/arcgis/rest/services/Lexington_Richland_Web_Map_WFL1/FeatureServer/18";
export const SC_ROWS = [
  ["abbeville","Abbeville",RFA,"T_Map_Number",null,"County='Abbeville County'",1,34.2473,-82.4898,[34.004, -82.753, 34.491, -82.227]],
  ["aiken","Aiken",RFA,"T_Map_Number",null,"County='Aiken County'",1,33.5353,-81.6028,[33.186, -82.03, 33.885, -81.176]],
  ["allendale","Allendale",RFA,"T_Map_Number",null,"County='Allendale County'",1,32.9495,-81.3405,[32.732, -81.621, 33.167, -81.06]],
  ["anderson","Anderson",RFA,"T_Map_Number",null,"County='Anderson County'",1,34.5113,-82.6482,[34.196, -82.992, 34.827, -82.304]],
  ["bamberg","Bamberg",RFA,"T_Map_Number",null,"County='Bamberg County'",1,33.2293,-81.0087,[33.016, -81.231, 33.442, -80.786]],
  ["barnwell","Barnwell","https://services8.arcgis.com/qqnlHdXochyJPfSY/arcgis/rest/services/ParcelData_ExportFeatures/FeatureServer/2","TaxPIN",null,null,1,33.289,-81.4762,[33.078, -81.773, 33.5, -81.179]],
  ["beaufort","Beaufort","https://services.arcgis.com/mbPLXL6SDfBjrAmS/arcgis/rest/services/ParcelsFromPro/FeatureServer/0","PIN","SitusAddre",null,1,32.3855,-80.7252,[32.058, -81.017, 32.713, -80.433]],
  ["berkeley","Berkeley",RFA,"T_Map_Number",null,"County='Berkeley County'",1,33.188,-79.9023,[32.849, -80.365, 33.527, -79.44]],
  ["calhoun","Calhoun","https://services5.arcgis.com/B3Zo1xqTw8CidOoF/arcgis/rest/services/WebParcels/FeatureServer/0","TMS","Property_Address",null,1,33.6713,-80.7735,[33.454, -81.063, 33.889, -80.484]],
  ["charleston","Charleston",RFA,"T_Map_Number",null,"County='Charleston County'",1,32.8415,-79.8653,[32.494, -80.452, 33.225, -79.278]],
  ["cherokee","Cherokee",RFA,"T_Map_Number",null,"County='Cherokee County'",1,35.0108,-81.6163,[34.829, -81.881, 35.193, -81.352]],
  ["chester","Chester",RFA,"T_Map_Number",null,"County='Chester County'",1,34.6788,-81.177,[34.528, -81.497, 34.829, -80.858]],
  ["chesterfield","Chesterfield",RFA,"T_Map_Number",null,"County='Chesterfield County'",1,34.5938,-80.1747,[34.362, -80.571, 34.826, -79.778]],
  ["clarendon","Clarendon",RFA,"T_Map_Number",null,"County='Clarendon County'",0,33.693,-80.2085,[33.429, -80.548, 33.957, -79.869]],
  ["colleton","Colleton","https://services1.arcgis.com/m0cnLGKdhwao8WvM/arcgis/rest/services/Public_Data/FeatureServer/2","PIN","PropertyAddress",null,1,32.8405,-80.727,[32.495, -81.08, 33.186, -80.374]],
  ["darlington","Darlington",RFA,"T_Map_Number",null,"County='Darlington County'",1,34.3085,-79.9755,[34.078, -80.299, 34.539, -79.652]],
  ["dillon","Dillon",RFA,"T_Map_Number",null,"County='Dillon County'",1,34.4218,-79.3552,[34.214, -79.646, 34.629, -79.065]],
  ["dorchester","Dorchester",RFA,"T_Map_Number",null,"County='Dorchester County'",1,33.074,-80.4382,[32.805, -80.806, 33.344, -80.07]],
  ["edgefield","Edgefield",RFA,"T_Map_Number",null,"County='Edgefield County'",1,33.7572,-81.9147,[33.528, -82.182, 33.986, -81.647]],
  ["fairfield","Fairfield",RFA,"T_Map_Number",null,"County='Fairfield County'",0,34.3702,-81.0948,[34.166, -81.434, 34.575, -80.756]],
  ["florence","Florence",RFA,"T_Map_Number",null,"County='Florence County'",1,34.041,-79.6908,[33.766, -80.08, 34.316, -79.302]],
  ["georgetown","Georgetown",RFA,"T_Map_Number",null,"County='Georgetown County'",0,33.4617,-79.3392,[33.132, -79.688, 33.792, -78.991]],
  ["greenwood","Greenwood",RFA,"T_Map_Number",null,"County='Greenwood County'",1,34.1773,-82.098,[33.937, -82.342, 34.417, -81.854]],
  ["hampton","Hampton",RFA,"T_Map_Number",null,"County='Hampton County'",1,32.7905,-81.124,[32.545, -81.431, 33.036, -80.818]],
  ["horry","Horry",RFA,"T_Map_Number",null,"County='Horry County'",1,33.9385,-78.9567,[33.562, -79.344, 34.314, -78.569]],
  ["jasper","Jasper",RFA,"T_Map_Number",null,"County='Jasper County'",1,32.4095,-81.0482,[32.058, -81.285, 32.761, -80.812]],
  ["kershaw","Kershaw",RFA,"T_Map_Number",null,"County='Kershaw County'",1,34.3385,-80.576,[34.056, -80.88, 34.621, -80.272]],
  ["lancaster","Lancaster",RFA,"T_Map_Number",null,"County='Lancaster County'",1,34.7575,-80.66,[34.445, -80.917, 35.07, -80.403]],
  ["laurens","Laurens","/gis-proxy/www.laurenscountygis.org/arcgis/rest/services/Pebble/TaxParcel/MapServer/5","TMS","Property_Address",null,1,34.49,-81.976,[34.189, -82.324, 34.791, -81.628]],
  ["lee","Lee","https://services5.arcgis.com/zg6ovB2KKN8L0zFv/arcgis/rest/services/Web_Parcels/FeatureServer/0","Parcel_Polygons_PID",null,null,1,34.1608,-80.2322,[33.94, -80.483, 34.382, -79.982]],
  ["lexington","Lexington",RFA,"T_Map_Number",null,"County='Lexington County'",1,33.9215,-81.242,[33.637, -81.577, 34.206, -80.908]],
  ["marion","Marion",RFA,"T_Map_Number",null,"County='Marion County'",1,33.9955,-79.3473,[33.684, -79.574, 34.307, -79.12]],
  ["marlboro","Marlboro",RFA,"T_Map_Number",null,"County='Marlboro County'",1,34.551,-79.6887,[34.284, -79.94, 34.818, -79.437]],
  ["mccormick","McCormick",RFA,"T_Map_Number",null,"County='McCormick County'",1,33.835,-82.3183,[33.584, -82.606, 34.086, -82.03]],
  ["newberry","Newberry",RFA,"T_Map_Number",null,"County='Newberry County'",1,34.2933,-81.623,[34.051, -81.948, 34.536, -81.298]],
  ["oconee","Oconee",RFA,"T_Map_Number",null,"County='Oconee County'",1,34.7632,-83.0965,[34.461, -83.36, 35.066, -82.833]],
  ["orangeburg","Orangeburg",RFA,"T_Map_Number",null,"County='Orangeburg County'",1,33.4403,-80.794,[33.166, -81.381, 33.715, -80.206]],
  ["pickens","Pickens","https://services1.arcgis.com/59960rq18IxUcAVI/arcgis/rest/services/Energov_AGOL/FeatureServer/7","PIN","LOCADD",null,1,34.8435,-82.7095,[34.592, -82.943, 35.096, -82.477]],
  ["richland","Richland",RFA,"T_Map_Number",null,"County='Richland County'",1,33.9982,-80.967,[33.727, -81.35, 34.27, -80.584]],
  ["saluda","Saluda",RFA,"T_Map_Number",null,"County='Saluda County'",0,33.995,-81.7382,[33.8, -82.017, 34.189, -81.459]],
  ["spartanburg","Spartanburg","/gis-proxy/maps.spartanburgcounty.org/server/rest/services/GIS/CAMA_Parcels/FeatureServer/0","MAPNUMBER","PropertyLocation",null,1,34.8877,-81.9635,[34.573, -82.232, 35.203, -81.695]],
  ["sumter","Sumter","/gis-proxy/gis.sumter-sc.com/server/rest/services/BaseMaps/Sumter_City_County/MapServer/7","parcel_number","parcel_address_one",null,1,33.905,-80.2728,[33.636, -80.658, 34.174, -79.887]],
  ["union","Union",RFA,"T_Map_Number",null,"County='Union County'",1,34.6775,-81.635,[34.436, -81.86, 34.919, -81.411]],
  ["williamsburg","Williamsburg",RFA,"T_Map_Number",null,"County='Williamsburg County'",1,33.5925,-79.708,[33.293, -80.109, 33.892, -79.307]],
  ["york","York","https://services1.arcgis.com/2AGLxyiJoNiVHKwq/arcgis/rest/services/Parcels/FeatureServer/0","ParcelID","PropertyAddress",null,1,34.989,-81.1785,[34.804, -81.498, 35.174, -80.859]],
];
export const scRaw = () => Object.fromEntries(SC_ROWS.map(([k, n, url, id, addr, scope]) => ["sc_" + k, {
  state: "SC", label: n + " County, SC", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (" + (url === RFA ? "SC Revenue and Fiscal Affairs statewide parcels" : "county GIS") + "). Search by tax-map number" + (addr ? " or a site address." : "."),
}]));
export const scMap = () => Object.fromEntries(SC_ROWS.map(([k, , url, , , scope, , la, ln, bb]) => ["sc_" + k, {
  state: "SC", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
