/* NEW-1 (B2348000, 2026-10-19) — KANSAS county parcel sources. Kansas has NO complete free statewide parcel service: the state's own ORKA layer
 * (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB — "parcels where available", 19-digit KSPID, id + shape only) holds just four counties
 * (Cheyenne, Rawlins, Sherman, Thomas), which are wired through it scoped by CO_ABBR. Every other wired county is its own assessor / GIS layer:
 * ArcGIS Online (county orgs and the county-GIS contractors ATCI, lkmap, URS), the Integrity GIS Geocortex public sites, Eagleview's
 * geodataportal.net, or a county ArcGIS Server — non-arcgis.com hosts ride /gis-proxy. A county absent from this table has no usable public
 * service and says so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "Kansas counties (2026-10-19)" has the
 * per-county table and what was searched for every gap. ks_wyandotte stays hand-written in counties.js (wired 2026-09-10).
 * Row: [slug, county name, layer, idField, addrField, scopeWhere, centre lat, lng, padded bbox]. Provenance prose lives in ksProvenance.js
 * (build-time only, never shipped to the browser). */
export const KS_ROWS = [
  ["anderson","Anderson","https://services1.arcgis.com/q2CglofYX6ACNEeu/arcgis/rest/services/Anderson_Mobile_ORKA_WFL1/FeatureServer/1","ORKA_AN_PARCELS_ORKA_KSPID","Parcels_PropertyAddress",null,38.2105,-95.3225,[38.011,-95.533,38.408,-95.041]],
  ["atchison","Atchison","https://services3.arcgis.com/gP4crPvPyCTHFhOo/arcgis/rest/services/AT24_Parcel/FeatureServer/0","PIN","SitusAddre",null,39.5315,-95.3305,[39.391,-95.586,39.668,-94.939]],
  ["barber","Barber","https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/BarberCountyGIS/FeatureServer/0","PIN","SitusAddr",null,37.233,-98.64,[36.978,-99.025,37.486,-98.327]],
  ["butler","Butler","/gis-proxy/ww1.bucoks.com/bucogis1/rest/services/Appraisers/Parcels23/MapServer/0","PID",null,null,37.7775,-96.8235,[37.452,-97.168,38.106,-96.495]],
  ["cherokee","Cherokee","/gis-proxy/doniphangis.integritygis.com/Geocortex/Essentials/REST/sites/Cherokee_County_KS/map/mapservices/2/rest/services/x/MapServer/23","PIN","siteaddress",null,37.167,-94.902,[36.977,-95.092,37.356,-94.599]],
  ["cheyenne","Cheyenne","/gis-proxy/services.kansasgis.org/arcgis4/rest/services/KS_Parcels_ORKA_EB/FeatureServer/0","KSPID",null,"CO_ABBR='CN'",39.783,-101.6265,[39.543,-102.072,40.021,-101.387]],
  ["clark","Clark","https://services9.arcgis.com/SNKdKyZwMZ9biVZU/arcgis/rest/services/Parcels_3_3_25_/FeatureServer/0","PID","SitusAddre",null,37.2305,-99.854,[36.975,-100.129,37.489,-99.521]],
  ["cloud","Cloud","https://services9.arcgis.com/yGerJCngvNpaN2km/arcgis/rest/services/CloudCoKS_ParcelsOpenRecords/FeatureServer/0","PID","SitusAddre",null,39.478,-97.535,[39.283,-97.95,39.67,-97.34]],
  ["coffey","Coffey","https://services6.arcgis.com/cdij5k796ilcvPYN/arcgis/rest/services/CF_Parcels/FeatureServer/0","PID",null,null,38.2305,-95.7555,[38.015,-95.976,38.451,-95.479]],
  ["cowley","Cowley","https://services2.arcgis.com/duYcbdxVVOdnGdbq/arcgis/rest/services/Parcels/FeatureServer/0","PIN","SitusAddress",null,37.235,-96.903,[36.98,-97.163,37.493,-96.493]],
  ["dickinson","Dickinson","https://services6.arcgis.com/XBUaJ9z59sKeDhyY/arcgis/rest/services/Data_Dictionary/FeatureServer/15","PIN","SitusAddress",null,38.8315,-97.139,[38.576,-97.384,39.146,-96.871]],
  ["doniphan","Doniphan","/gis-proxy/doniphangis.integritygis.com/Geocortex/Essentials/REST/sites/Doniphan_County_KS/map/mapservices/3/rest/services/x/MapServer/11","PID","SitusAddress",null,39.777,-95.195,[39.602,-95.35,40.019,-94.851]],
  ["douglas","Douglas","https://services.arcgis.com/8O9UlSTnqjKptoda/arcgis/rest/services/Parcel/FeatureServer/0","PID","address",null,38.885,-95.3065,[38.71,-95.516,39.086,-95.032]],
  ["elk","Elk","https://services3.arcgis.com/jOKiQbWeUaBfRSxc/arcgis/rest/services/EkParcels/FeatureServer/0","PID","SitusAddre",null,37.4485,-96.235,[37.274,-96.535,37.623,-95.938]],
  ["ellis","Ellis","/gis-proxy/geodataportal.net/arcgis/rest/services/MultiPlatformParcels/MapServer/0","PARCEL_ID","SitusAddress",null,38.9095,-99.3705,[38.67,-99.616,39.149,-99.008]],
  ["ellsworth","Ellsworth","https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/EllsworthCountyGIS/FeatureServer/0","PID","SitusAddr",null,38.6905,-98.097,[38.496,-98.502,38.882,-97.904]],
  ["finney","Finney","https://utility.arcgis.com/usrsvcs/servers/9e3691d1d0e64182aa19dac298b6c7f8/rest/services/FinneyCountyAppraisers/Parcels/MapServer/0","ParcelID","SitusAddress",null,38.0315,-100.8745,[37.711,-101.12,38.276,-100.202]],
  ["ford","Ford","https://services7.arcgis.com/QfD34vvHtHcH5kGh/arcgis/rest/services/Parcel_Mosaic_Ford_County/FeatureServer/0","PARCEL_ID","siteaddres",null,37.6875,-99.9355,[37.442,-100.245,37.93,-99.532]],
  ["franklin","Franklin","https://services1.arcgis.com/Cdr6tOjJ99MjOR6x/arcgis/rest/services/Appraiser_Parcel_Search_WFL1/FeatureServer/4","PARCEL_CAM","SitusAddress",null,38.5575,-95.335,[38.368,-95.53,38.754,-95.035]],
  ["geary","Geary","https://services6.arcgis.com/FV7KF2rCsQjt0P3e/arcgis/rest/services/GeCo_Parcel_Ownership/FeatureServer/0","PIN","PROPADDR",null,38.971,-96.8125,[38.841,-96.977,39.236,-96.472]],
  ["harper","Harper","https://services9.arcgis.com/yGerJCngvNpaN2km/arcgis/rest/services/KScoHP_ParcelsOpenRecords/FeatureServer/0","PID","SitusAddre",null,37.1885,-97.994,[36.978,-98.369,37.403,-97.781]],
  ["harvey","Harvey","https://services2.arcgis.com/NYSVwQ7Ci1T1U8La/arcgis/rest/services/HV_Parcels_CRS2_view/FeatureServer/0","PIDNO","SitusAddre",null,38.039,-97.565,[37.889,-97.72,38.19,-97.128]],
  ["jefferson","Jefferson","https://services1.arcgis.com/tpr1e2h7Rmn9C5oc/arcgis/rest/services/JFKS_GIS_ParcelOrion_Public_V4/FeatureServer/0","PID","PropertyAddress",null,39.234,-95.359,[39.014,-95.619,39.433,-95.149]],
  ["labette","Labette","https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/LabetteCountyGIS/FeatureServer/2","PIDNO","SitusAddr",null,37.1905,-95.331,[36.981,-95.546,37.402,-95.052]],
  ["lane","Lane","/gis-proxy/gis.aumentumtech.com/arcgis/rest/services/LaneKs/LaneKsDynamic/MapServer/0","PID",null,null,38.4715,-100.4585,[38.232,-100.703,38.714,-100.22]],
  ["leavenworth","Leavenworth","https://services9.arcgis.com/YvdlPN5z971EmeG3/arcgis/rest/services/Parcel_Boundaries/FeatureServer/0","PID","SiteAddr",null,39.254,-95.0315,[38.939,-95.201,39.433,-94.77]],
  ["logan","Logan","https://services9.arcgis.com/yGerJCngvNpaN2km/arcgis/rest/services/LoganCoKS_ParcelsOwnership2/FeatureServer/0","PID","SitusAddre",null,38.9145,-101.2585,[38.674,-101.498,39.15,-100.788]],
  ["lyon","Lyon","https://services8.arcgis.com/dw5aksXsLRAhbdxH/arcgis/rest/services/Lyon_County_Parcels/FeatureServer/0","PID",null,null,38.429,-96.148,[38.144,-96.373,38.755,-95.922]],
  ["mcpherson","McPherson","https://services8.arcgis.com/5ehLV5DLlzhyV3k5/arcgis/rest/services/Ownership_Online_Map/FeatureServer/0","KSPID","PropAddres",null,38.3825,-97.6995,[38.147,-97.944,38.622,-97.344]],
  ["meade","Meade","/gis-proxy/gis.aumentumtech.com/arcgis/rest/services/MeadeKs/MeadeKsDynamic/MapServer/0","PID",null,null,37.2325,-100.3315,[36.978,-100.667,37.492,-100.068]],
  ["montgomery","Montgomery","https://services8.arcgis.com/NlV1tPHJ1eShmjwO/arcgis/rest/services/MontgomeryCountyKS_BeaconUpdated/FeatureServer/2","ParcelID","Situs",null,37.188,-95.768,[36.978,-95.978,37.403,-95.498]],
  ["nemaha","Nemaha","https://services3.arcgis.com/6xqgnnfHDAKxg22k/arcgis/rest/services/NM_Parcels/FeatureServer/0","PID",null,null,39.778,-96.0055,[39.538,-96.26,40.015,-95.761]],
  ["osage","Osage","https://services9.arcgis.com/yGerJCngvNpaN2km/arcgis/rest/services/OsageCoKS_ParcelsOpenRecords/FeatureServer/0","PID","SitusAddre",null,38.6445,-95.7275,[38.409,-95.973,38.883,-95.475]],
  ["pawnee","Pawnee","https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/PawneeCountyGIS/FeatureServer/12","PIN","SitusAddr",null,38.1705,-99.176,[37.975,-99.601,38.363,-98.889]],
  ["pottawatomie","Pottawatomie","https://services6.arcgis.com/Zt2LWLYlpbYKRPfg/arcgis/rest/services/CoparcelO/FeatureServer/0","PARCEL",null,null,39.367,-96.3735,[39.102,-96.733,39.58,-96.011]],
  ["rawlins","Rawlins","/gis-proxy/services.kansasgis.org/arcgis4/rest/services/KS_Parcels_ORKA_EB/FeatureServer/0","KSPID",null,"CO_ABBR='RA'",39.7855,-101.1875,[39.546,-101.427,40.022,-100.715]],
  ["reno","Reno","https://services6.arcgis.com/Z4v2bMJenWjCbO4R/arcgis/rest/services/Reno_County_Tax_Unit_Review_2021/FeatureServer/1","PIN",null,null,37.9495,-97.9215,[37.704,-98.492,38.189,-97.675]],
  ["republic","Republic","/gis-proxy/audraingis.integritygis.com/Geocortex/Essentials/REST/sites/Republic_County_KS/map/mapservices/14/rest/services/x/MapServer/7","PID","SitusAddress",null,39.823,-97.7495,[39.628,-97.95,40.019,-97.341]],
  ["riley","Riley","https://services.arcgis.com/6WmEmDp2YlKJjhJt/arcgis/rest/services/Parcels20250725/FeatureServer/0","PID",null,null,39.342,-96.8265,[39.017,-96.971,39.583,-96.368]],
  ["russell","Russell","https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/RussellCountyGIS/FeatureServer/2","KSPID","SitusAddr",null,38.9075,-98.704,[38.668,-99.054,39.148,-98.461]],
  ["saline","Saline","https://services2.arcgis.com/cuBVqVP04yYSBGZ9/arcgis/rest/services/Parcels_1/FeatureServer/0","PID","SITUSADDRE",null,38.778,-97.6265,[38.578,-97.947,38.979,-97.344]],
  ["scott","Scott","/gis-proxy/gis.aumentumtech.com/arcgis/rest/services/ScottKs/ScottKsDynamic/MapServer/0","PID",null,null,38.4755,-100.8975,[38.235,-101.143,38.717,-100.65]],
  ["sedgwick","Sedgwick","https://services7.arcgis.com/McLat6HlPl45bNBv/arcgis/rest/services/Sedgwick_County_Land_Records/FeatureServer/4","PIN",null,null,37.6915,-97.366,[37.447,-97.821,37.93,-97.123]],
  ["seward","Seward","https://services6.arcgis.com/nRkmtZHjCBp13izw/arcgis/rest/services/ParcelsDec122023/FeatureServer/3","PID","SITUS_1",null,37.1915,-100.8715,[36.976,-101.092,37.409,-100.614]],
  ["shawnee","Shawnee","https://services2.arcgis.com/2XE514jeVQMWNKHX/arcgis/rest/services/Parcels/FeatureServer/0","PIN","PADDRESS",null,39.0365,-95.768,[38.841,-96.053,39.235,-95.476]],
  ["sherman","Sherman","/gis-proxy/services.kansasgis.org/arcgis4/rest/services/KS_Parcels_ORKA_EB/FeatureServer/0","KSPID",null,"CO_ABBR='SH'",39.347,-101.609,[39.107,-102.069,39.587,-101.365]],
  ["stafford","Stafford","https://services9.arcgis.com/zDY8zW24CdJKhVIw/arcgis/rest/services/StaffordCountyGIS/FeatureServer/1","PARCEL_ID","SitusAddr",null,38.0365,-98.6965,[37.796,-99.036,38.273,-98.449]],
  ["sumner","Sumner","https://services6.arcgis.com/1T9VnnU2vFIMRmpS/arcgis/rest/services/SU_Parcels/FeatureServer/0","PID",null,null,37.2315,-97.469,[36.976,-97.824,37.493,-97.118]],
  ["thomas","Thomas","/gis-proxy/services.kansasgis.org/arcgis4/rest/services/KS_Parcels_ORKA_EB/FeatureServer/0","KSPID",null,"CO_ABBR='TH'",39.349,-100.937,[39.109,-101.407,39.586,-100.696]],
];
export const ksRaw = () => Object.fromEntries(KS_ROWS.map(([k, n, url, id, addr, scope]) => ["ks_" + k, {
  state: "KS", label: n + " County, KS", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (county / state GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const ksMap = () => Object.fromEntries(KS_ROWS.map(([k, n, url, , , scope, la, ln, bb]) => ["ks_" + k, {
  state: "KS", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
