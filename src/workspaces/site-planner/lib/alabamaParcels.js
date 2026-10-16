/* NEW-1 (B2302784, 2026-10-16) — ALABAMA county parcel sources. Alabama has NO free statewide parcel service (AGOL, Hub, ADOR / AGIC /
 * GSA searched; only commercial resellers carry one — not used), so each county is wired to its own Revenue Commissioner / county GIS layer,
 * or to a regional host that publishes several counties. A county absent from this table has no usable public service and says so by
 * name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "Alabama" has the per-county table and what was searched.
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, scopeWhere, owner column?, centre lat, lng,
 * padded bbox]. Provenance prose lives in alabamaProvenance.js (build-time only, never shipped to the browser). */
export const AL_ROWS = [
  ["autauga","Autauga","https://services7.arcgis.com/jF2q3LPxL7PETdYk/arcgis/rest/services/PARCELS_REGION_061626_158_WFL1/FeatureServer/0","APN_2017","SITE_ADDRESS_","COUNTY='AUTAUGA COUNTY'",1,32.539,-86.641,[32.293,-86.942,32.74,-86.376]],
  ["baldwin","Baldwin","/gis-proxy/web6.kcsgis.com/kcsgis/rest/services/Baldwin/AL05_GAMAWeb/MapServer/31","PID","SitusAddName",null,1,30.743,-87.725,[30.204,-88.05,31.357,-87.363]],
  ["barbour","Barbour","/gis-proxy/gis.capturecama.com/arcgis/rest/services/BarbourAL/BarbourCapture/MapServer/213","PARCELID",null,null,0,31.877,-85.392,[31.595,-85.773,32.186,-85.027]],
  ["blount","Blount","/gis-proxy/web5.kcsgis.com/kcsgis/rest/services/Blount/Public/MapServer/32","ParcelNum",null,null,1,33.983,-86.567,[33.734,-86.999,34.296,-86.273]],
  ["bullock","Bullock","/gis-proxy/gis.capturecama.com/arcgis/rest/services/BullockAL/BullockCapture/MapServer/3","ParcelNo",null,null,1,32.106,-85.716,[31.851,-86.031,32.34,-85.381]],
  ["calhoun","Calhoun","/gis-proxy/gis.calhouncounty.org/arcgis/rest/services/Parcel_Viewer_IPV/MapServer/106","PARCEL_NUMBER","STREET_ADDRESS",null,1,33.776,-85.825,[33.532,-86.176,34.001,-85.49]],
  ["cherokee","Cherokee","/gis-proxy/web3.kcsgis.com/kcsgis/rest/services/Cherokee/Public/MapServer/116","ParcelID_GISlink",null,null,1,34.176,-85.6,[33.909,-85.873,34.553,-85.366]],
  ["cleburne","Cleburne","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Cleburne/CleburneParcels_06122024/MapServer/401","PARCEL_NUM",null,null,0,33.676,-85.519,[33.441,-85.919,33.99,-85.275]],
  ["coosa","Coosa","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Coosa/Coosa11282023/MapServer/169","PARCELID",null,null,0,32.941,-86.247,[32.724,-86.557,33.141,-85.973]],
  ["dallas","Dallas","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Dallas/Dallas_05272026/MapServer/163","PARCEL_ID","SITUS_ADDR",null,1,32.331,-87.104,[32.023,-87.498,32.734,-86.779]],
  ["elmore","Elmore","/gis-proxy/gis.capturecama.com/arcgis/rest/services/ElmoreAL/ElmoreCapture/MapServer/0","ParcelNo","PropertyAddr1",null,1,32.6,-86.15,[32.381,-86.446,32.804,-85.836]],
  ["etowah","Etowah","/gis-proxy/web3.kcsgis.com/kcsgis/rest/services/Etowah/Etowah_Revenue_Viewer_new/MapServer/64","ParcelID_GISlink",null,null,1,34.048,-86.037,[33.823,-86.401,34.237,-85.705]],
  ["hale","Hale","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Hale/HALE_11132024/MapServer/921","PARCELID",null,null,0,32.77,-87.627,[32.456,-87.899,33.047,-87.39]],
  ["henry","Henry","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Henry/Henry05042023/MapServer/0","PARCEL_ID","P_ADDRESS",null,1,31.53,-85.24,[31.302,-85.447,31.814,-85.013]],
  ["lauderdale","Lauderdale","/gis-proxy/web5.kcsgis.com/kcsgis/rest/services/Lauderdale/Public/MapServer/120","ParcelNum","PhysAddr",null,1,34.907,-87.649,[34.71,-88.225,35.046,-87.178]],
  ["lawrence","Lawrence","/gis-proxy/web4.kcsgis.com/kcsgis/rest/services/Lawrence/Public/MapServer/49","ParcelID_GISlink",null,null,1,34.526,-87.309,[34.273,-87.564,34.84,-87.068]],
  ["lee","Lee","/gis-proxy/explore.opelika-al.gov/server/rest/services/Lee_County_Parcels/MapServer/0","KEY_",null,null,0,32.606,-85.356,[32.386,-85.727,32.777,-84.966]],
  ["limestone","Limestone","/gis-proxy/gis.limestonecounty-al.gov/arcgis/rest/services/Limestone_Parcels/MapServer/0","ParcelNo","PropertyAddr1",null,1,34.816,-86.98,[34.53,-87.295,35.038,-86.752]],
  ["macon","Macon","/gis-proxy/gis.capturecama.com/arcgis/rest/services/MaconAL/MaconCapture/MapServer/1","PARCELID",null,null,0,32.394,-85.691,[32.209,-86.049,32.631,-85.401]],
  ["madison","Madison","/gis-proxy/maps.madisonal.gov/server/rest/services/Development_Dashboard_Base_MIL1/MapServer/1","ParcelNum","PropertyAddress",null,1,34.765,-86.547,[34.445,-86.818,35.027,-86.212]],
  ["marshall","Marshall","/gis-proxy/web5.kcsgis.com/kcsgis/rest/services/Marshall/Public/MapServer/37","PARCELID",null,null,1,34.372,-86.303,[34.075,-86.61,34.637,-86.031]],
  ["monroe","Monroe","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Monroe/Monroe12092025/MapServer/84","PARCELJOIN",null,null,0,31.577,-87.362,[31.207,-87.813,31.871,-86.883]],
  ["montgomery","Montgomery","https://services7.arcgis.com/jF2q3LPxL7PETdYk/arcgis/rest/services/PARCELS_REGION_061626_158_WFL1/FeatureServer/0","APN_2017","SITE_ADDRESS_","COUNTY LIKE 'MONTGOMERY%'",1,32.228,-86.207,[31.943,-86.529,32.54,-85.901]],
  ["morgan","Morgan","/gis-proxy/al52portal.kcsgis.com/al52server/rest/services/Mapping/Morgan_Public_ISV/MapServer/132","PARCELID","PropAddr1",null,1,34.457,-86.852,[34.28,-87.14,34.716,-86.516]],
  ["russell","Russell","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Russell/Russell_02122026/MapServer/133","PARCELID",null,null,0,32.295,-85.181,[32.04,-85.463,32.549,-84.864]],
  ["shelby","Shelby","/gis-proxy/maps.shelbyal.com/gisserver/rest/services/CaptureServices/PropertyTaxOfficeBase/MapServer/93","ParcelNo","PropAddr1",null,1,33.272,-86.661,[33.002,-87.05,33.578,-86.318]],
  ["stclair","St. Clair","/gis-proxy/map.stclairco.com/arcgis/rest/services/PublicParcelViewerStPln/MapServer/57","PARCELID","STREET_ADD",null,1,33.716,-86.315,[33.373,-86.615,34.014,-86.012]],
  ["sumter","Sumter","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Sumter/Sumter03282024/MapServer/2","PARCEL_NUM",null,null,0,32.59,-88.2,[32.279,-88.456,33.019,-87.807]],
  ["wilcox","Wilcox","/gis-proxy/maps.capturecama.com/arcgis/rest/services/Wilcox/Wilcox_03122025/MapServer/10","PARCEL_NUM",null,null,0,31.997,-87.308,[31.802,-87.699,32.306,-86.827]],
  ["tuscaloosa","Tuscaloosa","https://services.arcgis.com/AWzSDaKZ41uuVges/arcgis/rest/services/Parcels/FeatureServer/0","pclnum","pcliLocati",null,1,33.298,-87.52,[32.982,-87.867,33.649,-87.028]],
  ["greene","Greene","https://services8.arcgis.com/XI1FxP9uZwSBSNV8/arcgis/rest/services/GreeneAL_Service/FeatureServer/5","PARCEL_ID",null,null,1,32.86,-87.952,[32.495,-88.237,33.188,-87.68]],
  ["mobile","Mobile","https://services8.arcgis.com/HND1NcQt6vgOGn1z/arcgis/rest/services/MCRC_Public_Parcels/FeatureServer/0","Parcel_Number","PropAddr1",null,1,30.8,-88.21,[30.307,-88.465,31.202,-87.9]],
  ["dekalb","DeKalb","https://services9.arcgis.com/NT45iGhs5xJWW8xQ/arcgis/rest/services/Parcel_Data/FeatureServer/0","PARCELNUMB","SitusAddNa",null,1,34.463,-85.803,[34.176,-86.161,34.892,-85.482]],
  ["houston","Houston","https://services.arcgis.com/UXN4FGWBfn79LLPC/arcgis/rest/services/Parcels_County_Current_050323/FeatureServer/0","PARCEL_ID","STREET_ADD",null,1,31.164,-85.296,[30.971,-85.738,31.364,-84.972]],
];
export const alRaw = () => Object.fromEntries(AL_ROWS.map(([k, n, url, id, addr, scope]) => ["al_" + k, {
  state: "AL", label: n + " County, AL", layerUrl: url, idField: id, ...(addr ? { addrField: addr } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const alMap = () => Object.fromEntries(AL_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb]) => ["al_" + k, {
  state: "AL", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
