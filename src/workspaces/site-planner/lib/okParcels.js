/* NEW-1 (Oklahoma, 2026-10-19) — OKLAHOMA county parcel sources beyond the two hand-written rows in counties.js (ok_oklahoma, ok_tulsa). Oklahoma has NO free statewide parcel
 * service (the state's mosaic is published view/WMS-only, docs/STATEWIDE-PARCELS.md), so each county is wired to its OWN assessor / county GIS layer on ArcGIS Online. A county absent from
 * this table AND from counties.js has no usable public service and says so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "Oklahoma counties (2026-10-19)"
 * has the per-county table and what was searched for every gap. Keys are `ok_`-prefixed.
 * Row: [slug, county name, layer, idField, addrField, owner column?, centre lat, lng, padded bbox].
 * Provenance prose lives in okProvenance.js (build-time only, never shipped to the browser). */
export const OK_ROWS = [
  ["beckham","Beckham","https://services7.arcgis.com/2uPhy8KfHlaAyk3B/arcgis/rest/services/Parcel/FeatureServer/0","account","situs",1,35.269,-99.6775,[35.009, -100.017, 35.528, -99.339]],
  ["canadian","Canadian","https://services2.arcgis.com/0NjdXxmJp53hZWPd/arcgis/rest/services/ParcelDataService_2_view/FeatureServer/3","account","situs",1,35.5305,-97.9895,[35.31, -98.329, 35.748, -97.648]],
  ["cleveland","Cleveland","https://services.arcgis.com/rt1leD4Hj3sLGHNL/arcgis/rest/services/Cleveland_County_Ownership_October_2023/FeatureServer/28","ACCOUNT","LOCATIONADDRESS",1,35.173,-97.3945,[34.918, -97.689, 35.406, -97.121]],
  ["comanche","Comanche","https://services6.arcgis.com/eNPJk90aMrXNOKF8/arcgis/rest/services/Comanche_Parcels/FeatureServer/0","ACCOUNT",null,1,34.6345,-98.458,[34.389, -98.848, 34.879, -98.067]],
  ["creek","Creek","https://services7.arcgis.com/rxjYSJmWllCcGWDd/arcgis/rest/services/ParcelsCreek(OK)/FeatureServer/0","account",null,1,35.9075,-96.328,[35.622, -96.643, 36.192, -96.01]],
  ["garfield","Garfield","https://services6.arcgis.com/99UdG1wpnm3S0CuD/arcgis/rest/services/Parcel_Import/FeatureServer/0","PARCEL_1",null,1,36.3795,-97.777,[36.149, -98.122, 36.613, -97.436]],
  ["mcclain","McClain","https://services8.arcgis.com/Tkj64juGWKKHPp01/arcgis/rest/services/County_Parcels/FeatureServer/0","account","situs",1,35.0715,-97.415,[34.841, -97.69, 35.357, -96.906]],
  ["muskogee","Muskogee","https://services.arcgis.com/1oF9XVrVYcFTsAKj/arcgis/rest/services/Muskogee_Parcels_FDP_1/FeatureServer/0","ParcelId",null,1,35.622,-95.416,[35.252, -95.781, 35.884, -95.052]],
  ["ottawa","Ottawa","https://services8.arcgis.com/yRdXE3105FhxUFH6/arcgis/rest/services/Ottawa_Cnty_Parcel_(2025)/FeatureServer/0","account",null,1,36.8355,-94.831,[36.65, -95.061, 37.021, -94.601]],
  ["payne","Payne","https://services.arcgis.com/RPfJX2yEEVtopacQ/arcgis/rest/services/Parcels/FeatureServer/0","ParcelID","Situs",1,36.1015,-96.989,[35.926, -97.374, 36.276, -96.6]],
  ["pittsburg","Pittsburg","https://services3.arcgis.com/vS6jO1qrSVqdHIdf/arcgis/rest/services/Pittsburg_Parcels_62325/FeatureServer/0","ParcelId",null,1,34.955,-95.7185,[34.575, -96.108, 35.334, -95.331]],
  ["rogers","Rogers","https://services6.arcgis.com/nj9ncbfaytLCyS0D/arcgis/rest/services/Catoosa_ROCO_Parcels/FeatureServer/0","ACCOUNT","SITUS",1,36.3435,-95.573,[36.058, -95.843, 36.625, -95.306]],
  ["wagoner","Wagoner","https://services6.arcgis.com/nj9ncbfaytLCyS0D/arcgis/rest/services/Wagoner_Co_Parcels_Dec_2025/FeatureServer/2","ACCOUNT","SITUS",1,35.971,-95.513,[35.756, -95.843, 36.191, -95.187]],
  ["washington","Washington","https://services7.arcgis.com/rxjYSJmWllCcGWDd/arcgis/rest/services/ParcelsWashington(OK)/FeatureServer/0","PARCEL_ID",null,1,36.7165,-95.896,[36.411, -96.026, 37.02, -95.766]],
];
export const okRaw = () => Object.fromEntries(OK_ROWS.map(([k, n, url, id, addr]) => ["ok_" + k, {
  state: "OK", label: n + " County, OK", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}),
  help: n + " County parcels (county assessor / county GIS). Search by account or parcel number" + (addr ? " or a site address." : "."),
}]));
export const okMap = () => Object.fromEntries(OK_ROWS.map(([k, n, url, , , , la, ln, bb]) => ["ok_" + k, {
  state: "OK", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url,
}]));
