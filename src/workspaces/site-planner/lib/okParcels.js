/* NEW-1 (Oklahoma, 2026-10-19) — OKLAHOMA county parcel sources beyond the two hand-written rows in counties.js (ok_oklahoma, ok_tulsa). Oklahoma has NO free statewide parcel
 * service (the state's mosaic is published view/WMS-only, docs/STATEWIDE-PARCELS.md), so each county is wired to its OWN assessor / county GIS layer on ArcGIS Online. A county absent from
 * this table AND from counties.js has no usable public service and says so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "Oklahoma counties (2026-10-19)"
 * has the per-county table and what was searched for every gap. Keys are `ok_`-prefixed.
 * Row: [slug, county name, layer, idField, addrField, owner column?, centre lat, lng, padded bbox, scopeWhere?].
 * NEW-1 (second pass, B2497472): a layer can serve several counties, so a row may carry a `scopeWhere` as its tenth element. 52 counties ride the STATE'S OWN statewide parcel mosaic
 * (Office of Geographic Information, okmaps.org) through `/okparcels` (functions/okparcels + src/shared/gis/okParcelsAdapter.js: WMS GetFeatureInfo ↔ ArcGIS query); every other county rides its own ArcGIS Online layer.
 * A `/okparcels` row answers a click and the outline tiles; it cannot answer a county-wide account / owner / address search (loud 400 — the adapter's header says why).
 * Provenance prose lives in okProvenance.js (build-time only, never shipped to the browser). */
export const OK_ROWS = [
  ["adair","Adair","https://services5.arcgis.com/ZTbCl7IqVy1LQh5d/arcgis/rest/services/Adair_WFL1/FeatureServer/0","account","situs",1,35.906,-94.6385,[35.621,-94.828,36.191,-94.449]],
  ["alfalfa","Alfalfa","/okparcels/FeatureServer/0","parcelid",null,1,36.7315,-98.32,[36.444,-98.56,37.019,-98.08],"county='Alfalfa'"],
  ["atoka","Atoka","/okparcels/FeatureServer/0","parcelid",null,1,34.4265,-96.0365,[34.144,-96.425,34.709,-95.648],"county='Atoka'"],
  ["beaver","Beaver","/okparcels/FeatureServer/0","parcelid",null,1,36.7435,-100.4785,[36.469,-100.977,37.018,-99.98],"county='Beaver'"],
  ["beckham","Beckham","https://services7.arcgis.com/2uPhy8KfHlaAyk3B/arcgis/rest/services/Parcel/FeatureServer/0","account","situs",1,35.269,-99.6775,[35.009, -100.017, 35.528, -99.339]],
  ["blaine","Blaine","/okparcels/FeatureServer/0","parcelid",null,1,35.862,-98.418,[35.534,-98.658,36.19,-98.178],"county='Blaine'"],
  ["bryan","Bryan","/okparcels/FeatureServer/0","parcelid",null,1,33.934,-96.19,[33.682,-96.635,34.186,-95.745],"county='Bryan'"],
  ["caddo","Caddo","/okparcels/FeatureServer/0","parcelid",null,1,35.2065,-98.3545,[34.838,-98.64,35.575,-98.069],"county='Caddo'"],
  ["canadian","Canadian","https://services2.arcgis.com/0NjdXxmJp53hZWPd/arcgis/rest/services/ParcelDataService_2_view/FeatureServer/3","account","situs",1,35.5305,-97.9895,[35.31, -98.329, 35.748, -97.648]],
  ["carter","Carter","/okparcels/FeatureServer/0","parcelid",null,1,34.2935,-97.2435,[34.052,-97.578,34.535,-96.909],"county='Carter'"],
  ["cherokee","Cherokee","/okparcels/FeatureServer/0","parcelid",null,1,35.9085,-95.0425,[35.624,-95.307,36.193,-94.778],"county='Cherokee'"],
  ["choctaw","Choctaw","/okparcels/FeatureServer/0","parcelid",null,1,34.0155,-95.576,[33.846,-96.023,34.185,-95.129],"county='Choctaw'"],
  ["cimarron","Cimarron","/okparcels/FeatureServer/0","parcelid",null,1,36.7445,-102.511,[36.47,-103.017,37.019,-102.005],"county='Cimarron'"],
  ["cleveland","Cleveland","https://services.arcgis.com/rt1leD4Hj3sLGHNL/arcgis/rest/services/Cleveland_County_Ownership_October_2023/FeatureServer/28","ACCOUNT","LOCATIONADDRESS",1,35.173,-97.3945,[34.918, -97.689, 35.406, -97.121]],
  ["coal","Coal","/okparcels/FeatureServer/0","parcelid",null,1,34.599,-96.301,[34.404,-96.534,34.794,-96.068],"county='Coal'"],
  ["comanche","Comanche","https://services6.arcgis.com/eNPJk90aMrXNOKF8/arcgis/rest/services/Comanche_Parcels/FeatureServer/0","ACCOUNT",null,1,34.6345,-98.458,[34.389, -98.848, 34.879, -98.067]],
  ["cotton","Cotton","/okparcels/FeatureServer/0","parcelid",null,1,34.2815,-98.397,[34.034,-98.677,34.529,-98.117],"county='Cotton'"],
  ["craig","Craig","/okparcels/FeatureServer/0","parcelid",null,1,36.76,-95.2165,[36.498,-95.451,37.022,-94.982],"county='Craig'"],
  ["creek","Creek","https://services7.arcgis.com/rxjYSJmWllCcGWDd/arcgis/rest/services/ParcelsCreek(OK)/FeatureServer/0","account",null,1,35.9075,-96.328,[35.622, -96.643, 36.192, -96.01]],
  ["custer","Custer","/okparcels/FeatureServer/0","parcelid",null,1,35.641,-98.997,[35.447,-99.395,35.835,-98.599],"county='Custer'"],
  ["delaware","Delaware","https://services8.arcgis.com/yRdXE3105FhxUFH6/arcgis/rest/services/parcel/FeatureServer/0","account",null,1,36.4215,-94.7845,[36.144,-95.036,36.699,-94.533]],
  ["dewey","Dewey","/okparcels/FeatureServer/0","parcelid",null,1,35.99,-99.0085,[35.794,-99.405,36.186,-98.612],"county='Dewey'"],
  ["ellis","Ellis","/okparcels/FeatureServer/0","parcelid",null,1,36.222,-99.694,[35.829,-100.027,36.615,-99.361],"county='Ellis'"],
  ["garfield","Garfield","https://services6.arcgis.com/LIvKKeLD11lMmJuJ/arcgis/rest/services/Polymorphic_Layers/FeatureServer/16","account","situs",1,36.381,-97.779,[36.149,-98.122,36.613,-97.436]],
  ["garvin","Garvin","/okparcels/FeatureServer/0","parcelid",null,1,34.6905,-97.298,[34.492,-97.691,34.889,-96.905],"county='Garvin'"],
  ["grady","Grady","/okparcels/FeatureServer/0","parcelid",null,1,35.031,-97.8805,[34.664,-98.111,35.398,-97.65],"county='Grady'"],
  ["grant","Grant","/okparcels/FeatureServer/0","parcelid",null,1,36.7955,-97.784,[36.572,-98.129,37.019,-97.439],"county='Grant'"],
  ["greer","Greer","/okparcels/FeatureServer/0","parcelid",null,1,34.9195,-99.5655,[34.702,-99.908,35.137,-99.223],"county='Greer'"],
  ["harmon","Harmon","/okparcels/FeatureServer/0","parcelid",null,1,34.7665,-99.829,[34.482,-100.019,35.051,-99.639],"county='Harmon'"],
  ["harper","Harper","/okparcels/FeatureServer/0","parcelid",null,1,36.795,-99.646,[36.574,-100.026,37.016,-99.266],"county='Harper'"],
  ["haskell","Haskell","/okparcels/FeatureServer/0","parcelid",null,1,35.267,-95.131,[35.045,-95.474,35.489,-94.788],"county='Haskell'"],
  ["hughes","Hughes","https://services5.arcgis.com/ep2pgCIk48QobVh6/arcgis/rest/services/Hughes_Okfuskee_Seminole_Parcel_Data_Updated/FeatureServer/0","PARCEL_ID","SITUS",1,35.033,-96.234,[34.752,-96.51,35.314,-95.958],"COUNTY_NAM='Hughes'"],
  ["jackson","Jackson","/okparcels/FeatureServer/0","parcelid",null,1,34.594,-99.4375,[34.312,-99.85,34.876,-99.025],"county='Jackson'"],
  ["jefferson","Jefferson","/okparcels/FeatureServer/0","parcelid",null,1,34.0745,-97.831,[33.835,-98.158,34.314,-97.504],"county='Jefferson'"],
  ["johnston","Johnston","/okparcels/FeatureServer/0","parcelid",null,1,34.319,-96.6665,[34.102,-96.948,34.536,-96.385],"county='Johnston'"],
  ["kay","Kay","https://services6.arcgis.com/1096yitfwoXld7mE/arcgis/rest/services/Basemap1/FeatureServer/0","account","situs",1,36.7965,-97.1075,[36.573,-97.486,37.02,-96.729]],
  ["kingfisher","Kingfisher","/okparcels/FeatureServer/0","parcelid",null,1,35.9495,-97.94,[35.708,-98.231,36.191,-97.649],"county='Kingfisher'"],
  ["kiowa","Kiowa","/okparcels/FeatureServer/0","parcelid",null,1,34.8565,-99.008,[34.573,-99.422,35.14,-98.594],"county='Kiowa'"],
  ["latimer","Latimer","/okparcels/FeatureServer/0","parcelid",null,1,34.8765,-95.22,[34.666,-95.534,35.087,-94.906],"county='Latimer'"],
  ["leflore","Le Flore","/okparcels/FeatureServer/0","parcelid",null,1,34.9545,-94.742,[34.488,-95.075,35.421,-94.409],"county='LeFlore'"],
  ["lincoln","Lincoln","/okparcels/FeatureServer/0","parcelid",null,1,35.7085,-96.8785,[35.449,-97.161,35.968,-96.596],"county='Lincoln'"],
  ["logan","Logan","https://services7.arcgis.com/Bad3o1FeX1bReLhE/arcgis/rest/services/Parcel/FeatureServer/0","ACCOUNT",null,1,35.947,-97.4095,[35.703,-97.699,36.191,-97.12]],
  ["love","Love","/okparcels/FeatureServer/0","parcelid",null,1,33.9005,-97.243,[33.706,-97.576,34.095,-96.91],"county='Love'"],
  ["major","Major","/okparcels/FeatureServer/0","parcelid",null,1,36.3345,-98.5295,[36.143,-98.977,36.526,-98.082],"county='Major'"],
  ["marshall","Marshall","/okparcels/FeatureServer/0","parcelid",null,1,34.008,-96.759,[33.812,-96.99,34.204,-96.528],"county='Marshall'"],
  ["mayes","Mayes","/okparcels/FeatureServer/0","parcelid",null,1,36.2995,-95.2275,[36.06,-95.462,36.539,-94.993],"county='Mayes'"],
  ["mcclain","McClain","https://services8.arcgis.com/Tkj64juGWKKHPp01/arcgis/rest/services/County_Parcels/FeatureServer/0","account","situs",1,35.0715,-97.415,[34.841, -97.69, 35.357, -96.906]],
  ["mccurtain","McCurtain","/okparcels/FeatureServer/0","parcelid",null,1,34.066,-94.8055,[33.601,-95.178,34.531,-94.433],"county='McCurtain'"],
  ["mcintosh","McIntosh","/okparcels/FeatureServer/0","parcelid",null,1,35.3565,-95.659,[35.13,-95.998,35.583,-95.32],"county='McIntosh'"],
  ["murray","Murray","/okparcels/FeatureServer/0","parcelid",null,1,34.4915,-97.086,[34.316,-97.372,34.667,-96.8],"county='Murray'"],
  ["muskogee","Muskogee","https://services.arcgis.com/1oF9XVrVYcFTsAKj/arcgis/rest/services/Muskogee_Parcels_FDP_1/FeatureServer/0","ParcelId",null,1,35.622,-95.416,[35.252, -95.781, 35.884, -95.052]],
  ["noble","Noble","/okparcels/FeatureServer/0","parcelid",null,1,36.3855,-97.172,[36.145,-97.479,36.626,-96.865],"county='Noble'"],
  ["nowata","Nowata","/okparcels/FeatureServer/0","parcelid",null,1,36.802,-95.612,[36.583,-95.838,37.021,-95.386],"county='Nowata'"],
  ["okfuskee","Okfuskee","https://services5.arcgis.com/ep2pgCIk48QobVh6/arcgis/rest/services/Hughes_Okfuskee_Seminole_Parcel_Data_Updated/FeatureServer/0","PARCEL_ID","SITUS",1,35.471,-96.299,[35.273,-96.64,35.669,-95.958],"COUNTY_NAM='Okfuskee'"],
  ["okmulgee","Okmulgee","/okparcels/FeatureServer/0","parcelid",null,1,35.623,-95.946,[35.363,-96.205,35.883,-95.687],"county='Okmulgee'"],
  ["osage","Osage","/gis-proxy/map11.incog.org/arcgis11wa/rest/services/Parcels_OsageCo/MapServer/0","ParcelId","AdrLabel",1,36.5865,-96.537,[36.152,-97.088,37.021,-95.986]],
  ["ottawa","Ottawa","https://services8.arcgis.com/yRdXE3105FhxUFH6/arcgis/rest/services/Ottawa_Cnty_Parcel_(2025)/FeatureServer/0","account",null,1,36.8355,-94.831,[36.65, -95.061, 37.021, -94.601]],
  ["pawnee","Pawnee","/okparcels/FeatureServer/0","parcelid",null,1,36.3655,-96.6395,[36.147,-97.052,36.584,-96.227],"county='Pawnee'"],
  ["payne","Payne","https://services.arcgis.com/RPfJX2yEEVtopacQ/arcgis/rest/services/Parcels/FeatureServer/0","ParcelID","Situs",1,36.1015,-96.989,[35.926, -97.374, 36.276, -96.6]],
  ["pittsburg","Pittsburg","https://services3.arcgis.com/vS6jO1qrSVqdHIdf/arcgis/rest/services/Pittsburg_Parcels_62325/FeatureServer/0","ParcelId",null,1,34.955,-95.7185,[34.575, -96.108, 35.334, -95.331]],
  ["pontotoc","Pontotoc","/okparcels/FeatureServer/0","parcelid",null,1,34.7415,-96.6645,[34.494,-96.949,34.989,-96.38],"county='Pontotoc'"],
  ["pottawatomie","Pottawatomie","/okparcels/FeatureServer/0","parcelid",null,1,35.189,-96.879,[34.888,-97.161,35.49,-96.597],"county='Pottawatomie'"],
  ["pushmataha","Pushmataha","/okparcels/FeatureServer/0","parcelid",null,1,34.424,-95.3605,[34.138,-95.803,34.71,-94.918],"county='Pushmataha'"],
  ["rogermills","Roger Mills","/okparcels/FeatureServer/0","parcelid",null,1,35.7195,-99.6795,[35.404,-100.02,36.035,-99.339],"county='Roger Mills'"],
  ["rogers","Rogers","https://services6.arcgis.com/nj9ncbfaytLCyS0D/arcgis/rest/services/Catoosa_ROCO_Parcels/FeatureServer/0","ACCOUNT","SITUS",1,36.3435,-95.573,[36.058, -95.843, 36.625, -95.306]],
  ["seminole","Seminole","https://services5.arcgis.com/ep2pgCIk48QobVh6/arcgis/rest/services/Hughes_Okfuskee_Seminole_Parcel_Data_Updated/FeatureServer/0","PARCEL_ID","SITUS",1,35.1625,-96.6075,[34.844,-96.798,35.481,-96.417],"COUNTY_NAM='Seminole'"],
  ["sequoyah","Sequoyah","/okparcels/FeatureServer/0","parcelid",null,1,35.4645,-94.779,[35.261,-95.149,35.668,-94.409],"county='Sequoyah'"],
  ["stephens","Stephens","/okparcels/FeatureServer/0","parcelid",null,1,34.49,-97.8515,[34.273,-98.166,34.707,-97.537],"county='Stephens'"],
  ["texas","Texas","/okparcels/FeatureServer/0","parcelid",null,1,36.743,-101.4925,[36.468,-102.054,37.018,-100.931],"county='Texas'"],
  ["tillman","Tillman","/okparcels/FeatureServer/0","parcelid",null,1,34.385,-98.92,[34.111,-99.254,34.659,-98.586],"county='Tillman'"],
  ["wagoner","Wagoner","https://services6.arcgis.com/nj9ncbfaytLCyS0D/arcgis/rest/services/Wagoner_Co_Parcels_Dec_2025/FeatureServer/2","ACCOUNT","SITUS",1,35.971,-95.513,[35.756, -95.843, 36.191, -95.187]],
  ["washington","Washington","https://services7.arcgis.com/rxjYSJmWllCcGWDd/arcgis/rest/services/ParcelsWashington(OK)/FeatureServer/0","PARCEL_ID",null,1,36.7165,-95.896,[36.411, -96.026, 37.02, -95.766]],
  ["washita","Washita","/okparcels/FeatureServer/0","parcelid",null,1,35.2855,-98.9865,[35.081,-99.379,35.49,-98.594],"county='Washita'"],
  ["woods","Woods","/okparcels/FeatureServer/0","parcelid",null,1,36.696,-98.9825,[36.373,-99.457,37.019,-98.508],"county='Woods'"],
  ["woodward","Woodward","https://services9.arcgis.com/PZDYj8nlIDAHxNx4/arcgis/rest/services/New2026Parcel/FeatureServer/0","account","situs",1,36.485,-99.2755,[36.142,-99.618,36.828,-98.933]],
];
const STATEWIDE = (url) => url.startsWith("/okparcels/");
export const okRaw = () => Object.fromEntries(OK_ROWS.map(([k, n, url, id, addr, , , , , scope]) => ["ok_" + k, {
  state: "OK", label: n + " County, OK", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}),
  ...(STATEWIDE(url) ? { displayMinZoom: 16 } : {}), // the state server answers one small window per request (tile cells at this zoom and closer)
  help: STATEWIDE(url)
    ? n + " County parcels (State of Oklahoma statewide parcel layer). Click a lot — a search by account number or address is not available from this layer."
    : n + " County parcels (county assessor / county GIS). Search by account or parcel number" + (addr ? " or a site address." : "."),
}]));
export const okMap = () => Object.fromEntries(OK_ROWS.map(([k, n, url, , , , la, ln, bb, scope]) => ["ok_" + k, {
  state: "OK", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}), ...(STATEWIDE(url) ? { displayMinZoom: 16 } : {}),
}]));
