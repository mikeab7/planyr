/* NEW-1 (B2345888, 2026-10-19) — NEW MEXICO county parcel sources beyond the one row already hand-written in counties.js (nm_bernalillo, Albuquerque's
 * layer). 32 counties: 9 on their OWN county layer (ArcGIS Online, edited 2026 — fresher than the State's tax-year-2024 roll) and 23 on the Office of the
 * State Engineer's "County_Parcels_2025" service (one layer per county, one schema: UPC, Owner1, SitusAddress1), reached through /gis-proxy because
 * gis.ose.nm.gov sends no CORS headers. Keys are `nm_`-prefixed and drop the designation (`nm_doaana`: countyKeyForName strips every non-letter, so
 * "Doña Ana" is "doaana").
 * ⛔ Five OSE layers (De Baca, Guadalupe, Mora, Quay, Union) hold TOWN and subdivision lots only — zero parcels over 40 acres and no hit at any of 30
 * rural test points — so their help text says so. Catron's OSE layer is the same shape, which is why Catron rides the county layer instead.
 * docs/STATEWIDE-PARCELS.md "New Mexico counties (2026-10-19)" has the per-county table and what was searched.
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField|null, owner column published?, centre lat, lng, padded bbox, help].
 * bbox/centre are computed from public/geo/county-polygons.json (lattice extent, floored/ceiled to 2 dp), never hand-typed.
 * Provenance prose lives in nmProvenance.js (build-time only, never shipped to the browser). */
export const NM_ROWS = [
  ["catron","Catron","https://services3.arcgis.com/fneA3L2J0387Pb3S/arcgis/rest/services/Tax_Parcel_Polygon20241007/FeatureServer/0","UPC",null,1,33.92,-108.4,[33.19,-109.06,34.6,-107.69],
    "Catron County parcels (county GIS, edited Oct 2026). Federal and state tracts show the agency as owner and carry no parcel number. Search by parcel number."],
  ["chaves","Chaves","https://services3.arcgis.com/2P9mvTRBkjNHMsaa/arcgis/rest/services/Parcels/FeatureServer/90","Master_UPC","PROP_ADD",1,33.37,-104.46,[32.52,-105.35,34.1,-103.48],
    "Chaves County parcels (county GIS, edited Oct 2026). Search by parcel number (UPC) or a site address."],
  ["cibola","Cibola","https://services.arcgis.com/4YineAQdtmx0tv46/arcgis/rest/services/ParcelPoly_CibolaNM/FeatureServer/0","PARCELID","SiteAddress",1,34.92,-107.99,[34.57,-109.05,35.36,-107.04],
    "Cibola County parcels (county assessor roll as published by the county's GIS vendor, tax year 2026). Search by parcel number or a site address."],
  ["colfax","Colfax","https://services.arcgis.com/4YineAQdtmx0tv46/arcgis/rest/services/Parcel_Colfax/FeatureServer/0","UPC",null,1,36.61,-104.63,[36.2,-105.36,37,-103.98],
    "Colfax County parcels (county assessor roll as published by the county's GIS vendor, May 2026). Search by parcel number."],
  ["curry","Curry","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/5","AccountNumber","SitusAddress1",1,34.58,-103.33,[34.29,-103.73,34.97,-103.01],
    "Curry County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["debaca","De Baca","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/6","AccountNumber","SitusAddress1",1,34.35,-104.4,[33.99,-104.89,34.78,-103.92],
    "De Baca County parcels for towns and villages only (State Engineer's county parcel compilation, 2024 tax roll) — rural and ranch lots are not in this source, so a click on open country finds nothing. Search by account number or a site address."],
  ["doaana","Doña Ana","https://services7.arcgis.com/JMIoqakAkedEx0oU/arcgis/rest/services/DAC_Parcels/FeatureServer/0","PARCELNUMBER","SITUSADDRS",1,32.36,-106.82,[31.78,-107.29,33.06,-106.31],
    "Doña Ana County parcels (county assessor, edited Sept 2026). Search by parcel number or a site address."],
  ["eddy","Eddy","https://services8.arcgis.com/jT60P9xoPbrtgXey/arcgis/rest/services/Parcel_Eddy/FeatureServer/0","UPC",null,1,32.47,-104.29,[32,-104.86,32.97,-103.69],
    "Eddy County parcels (county assessor roll as published by the county's GIS vendor, Aug 2026). Search by parcel number."],
  ["grant","Grant","https://services.arcgis.com/33TOOklri9xpic7U/arcgis/rest/services/Grant_County_Interactive_Parcel_Map/FeatureServer/0","GISAccount",null,1,32.74,-108.38,[31.86,-109.06,33.21,-107.65],
    "Grant County parcels (county GIS, edited Oct 2026). Search by account number."],
  ["guadalupe","Guadalupe","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/10","AccountNumber","SitusAddress1",1,34.86,-104.78,[34.34,-105.31,35.22,-104.1],
    "Guadalupe County parcels for towns and villages only (State Engineer's county parcel compilation, 2024 tax roll) — rural and ranch lots are not in this source, so a click on open country finds nothing. Search by account number or a site address."],
  ["harding","Harding","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/11","AccountNumber","SitusAddress1",1,35.87,-103.81,[35.38,-104.43,36.23,-103.34],
    "Harding County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["hidalgo","Hidalgo","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/12","AccountNumber","SitusAddress1",1,31.93,-108.71,[31.34,-109.06,32.79,-108.19],
    "Hidalgo County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["lea","Lea","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/13","AccountNumber","SitusAddress1",1,32.79,-103.4,[32,-103.81,33.57,-103.02],
    "Lea County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["lincoln","Lincoln","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/14","AccountNumber","SitusAddress1",1,33.75,-105.45,[33.12,-106.37,34.36,-104.86],
    "Lincoln County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["losalamos","Los Alamos","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/15","AccountNumber","SitusAddress1",1,35.89,-106.3,[35.76,-106.41,35.99,-106.15],
    "Los Alamos County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["luna","Luna","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/16","AccountNumber","SitusAddress1",1,32.18,-107.74,[31.78,-108.23,32.61,-107.27],
    "Luna County parcels (State Engineer's county parcel compilation, 2024 tax roll; this county's roll carries owner names for about half the lots). Search by account number or a site address."],
  ["mckinley","McKinley","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/17","AccountNumber","SitusAddress1",1,35.58,-108.26,[34.94,-109.05,36.01,-107.28],
    "McKinley County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["mora","Mora","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/18","AccountNumber","SitusAddress1",1,36.02,-104.94,[35.76,-105.72,36.28,-104.31],
    "Mora County parcels for towns and villages only (State Engineer's county parcel compilation, 2024 tax roll) — rural and ranch lots are not in this source, so a click on open country finds nothing. Search by account number or a site address."],
  ["otero","Otero","https://services6.arcgis.com/Qzsv71UymdXsOPnR/arcgis/rest/services/Parcel_OteroNM/FeatureServer/0","GIS_Parcel_Number","GIS_Site_Address",1,32.62,-105.73,[32,-106.38,33.4,-104.83],
    "Otero County parcels (county assessor roll as published by the county's GIS vendor, tax year 2025). Search by parcel number or a site address."],
  ["quay","Quay","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/20","AccountNumber","SitusAddress1",1,35.11,-103.54,[34.59,-104.12,35.75,-103.01],
    "Quay County parcels for towns and villages only (State Engineer's county parcel compilation, 2024 tax roll) — rural and ranch lots are not in this source, so a click on open country finds nothing. Search by account number or a site address."],
  ["rioarriba","Rio Arriba","https://services6.arcgis.com/6gDz3aQl2Pya7uIo/arcgis/rest/services/RAC_Parcels_2026/FeatureServer/0","UPC",null,1,36.51,-106.69,[35.93,-107.63,37,-105.49],
    "Rio Arriba County parcels (county assessor, edited Oct 2026). Search by parcel number."],
  ["roosevelt","Roosevelt","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/22","AccountNumber","SitusAddress1",1,34.02,-103.47,[33.55,-103.94,34.61,-103.01],
    "Roosevelt County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["sandoval","Sandoval","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/23","AccountNumber","SitusAddress1",1,35.7,-106.86,[35.21,-107.63,36.23,-106.22],
    "Sandoval County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["sanjuan","San Juan","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/24","AccountNumber","SitusAddress1",1,36.5,-108.32,[35.98,-109.05,37,-107.4],
    "San Juan County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["sanmiguel","San Miguel","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/25","AccountNumber","SitusAddress1",1,35.49,-104.8,[35.03,-105.72,35.89,-103.61],
    "San Miguel County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["santafe","Santa Fe","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/26","AccountNumber","SitusAddress1",1,35.51,-105.97,[35.03,-106.25,36.01,-105.68],
    "Santa Fe County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["sierra","Sierra","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/27","AccountNumber","SitusAddress1",1,33.13,-107.18,[32.59,-108,33.49,-106.31],
    "Sierra County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["socorro","Socorro","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/28","AccountNumber","SitusAddress1",1,34.01,-106.92,[33.46,-107.73,34.59,-105.9],
    "Socorro County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["taos","Taos","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/29","AccountNumber","SitusAddress1",1,36.58,-105.62,[36.01,-106.05,37,-105.17],
    "Taos County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["torrance","Torrance","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/30","AccountNumber","SitusAddress1",1,34.65,-105.84,[34.25,-106.47,35.05,-105.26],
    "Torrance County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
  ["union","Union","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/31","AccountNumber","SitusAddress1",1,36.48,-103.46,[35.73,-104.01,37,-102.98],
    "Union County parcels for towns and villages only (State Engineer's county parcel compilation, 2024 tax roll) — rural and ranch lots are not in this source, so a click on open country finds nothing. Search by account number or a site address."],
  ["valencia","Valencia","/gis-proxy/gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer/32","AccountNumber","SitusAddress1",1,34.72,-106.81,[34.43,-107.22,34.97,-106.39],
    "Valencia County parcels (State Engineer's county parcel compilation, 2024 tax roll). Search by account number or a site address."],
];
export const nmRaw = () => Object.fromEntries(NM_ROWS.map(([k, n, url, id, addr, , , , , help]) => ["nm_" + k, {
  state: "NM", label: n + " County, NM", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), help,
}]));
export const nmMap = () => Object.fromEntries(NM_ROWS.map(([k, , url, , , , la, ln, bb]) => ["nm_" + k, {
  state: "NM", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url,
}]));
