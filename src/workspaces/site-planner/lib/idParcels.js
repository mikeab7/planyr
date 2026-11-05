/* NEW-1 (B2317920, 2026-10-19) — IDAHO county parcel sources beyond the 13 participating counties already wired in counties.js (id_ada … id_washington,
 * all on the State's OITS "Public Idaho Parcels" layer 7). The State's own tracker (TIM_Parcels_Progress, read 2026-10-19) still lists exactly those 13
 * as participating; every county here is wired to its OWN county / assessor-published service instead. A county absent from this table AND from
 * counties.js has no usable public service and says so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md
 * "Idaho counties (2026-10-19)" has the per-county table and what was searched. Keys are `id_`-prefixed (a bare Washington/Madison/Jefferson would
 * collide with a Texas county).
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, scopeWhere, owner column?, centre lat, lng, padded bbox].
 * Provenance prose lives in idProvenance.js (build-time only, never shipped to the browser). */
export const ID_ROWS = [
  ["adams","Adams","https://services9.arcgis.com/ab7oZGsZDc90ZJE2/arcgis/rest/services/Parcels/FeatureServer/0","PARCEL_ID","PM_SITE_ADDRESS",null,0,44.851,-116.496,[44.419, -116.929, 45.283, -116.062]],
  ["bannock","Bannock","https://services6.arcgis.com/jEWFLsriO24ArCMH/arcgis/rest/services/Parcels_GDB/FeatureServer/0","PARCEL_NO","SitusAddress",null,1,42.639,-112.305,[42.237, -112.761, 43.041, -111.85]],
  ["bingham","Bingham","/gis-proxy/web.binghamid.gov/arcgis/rest/services/Public/Instrument_Numbers/MapServer/0","RP_Num","Address",null,1,43.237,-112.289,[42.837, -113.023, 43.637, -111.555]],
  ["blaine","Blaine","/gis-proxy/maps.blainecountyid.gov/server/rest/services/Parcel_Information_Service_V2/MapServer/5","parcel_num","prop_adrs1",null,1,43.297,-113.99,[42.587, -115.002, 44.008, -112.978]],
  ["bonner","Bonner","https://services3.arcgis.com/nr9kxNhUQUSKQoEO/arcgis/rest/services/TaxParcels2020/FeatureServer/0","pin","Property_Address__Not_mailing_",null,1,48.362,-116.546,[47.865, -117.059, 48.858, -116.034]],
  ["bonneville","Bonneville","https://services2.arcgis.com/Xd5SMhLZ1h9t0F3b/arcgis/rest/services/Parcel_Viewer/FeatureServer/0","pin","parceladdr",null,1,43.321,-111.778,[43.0, -112.529, 43.642, -111.027]],
  ["boundary","Boundary","https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Boundary_Parcels_Public/FeatureServer/0","parcel_id","ps_prop_ad",null,1,48.748,-116.544,[48.476, -117.052, 49.02, -116.037]],
  ["butte","Butte","https://services9.arcgis.com/xVyQcG5socEBv1Ip/arcgis/rest/services/Butte_County_Parcels_-_View/FeatureServer/0","PARCEL_ID",null,null,1,43.754,-113.234,[43.256, -113.809, 44.251, -112.659]],
  ["canyon","Canyon","/gis-proxy/maps.canyonco.org/arcgisserver/rest/services/General/Canyon_County_Public_Tax_Parcels/MapServer/0","PIN","SiteAddress",null,0,43.578,-116.75,[43.262, -117.057, 43.894, -116.444]],
  ["clearwater","Clearwater","https://services2.arcgis.com/bkAz0G7Qq4dmkYCg/arcgis/rest/services/Parcels_view/FeatureServer/0","PARCEL_ID","SitusAddress",null,1,46.594,-115.537,[46.244, -116.483, 46.945, -114.591]],
  ["elmore","Elmore","https://services.arcgis.com/zuVYcGbo1L9xuj72/arcgis/rest/services/PARCEL_DATA/FeatureServer/0","PARCEL_ID","PM_PROP_AD",null,1,43.425,-115.609,[42.743, -116.274, 44.107, -114.945]],
  ["franklin","Franklin","https://services9.arcgis.com/pf67TISFO3iTjgFX/arcgis/rest/services/fr_parcels_090226/FeatureServer/0","PIN_1","LglAddr",null,1,42.213,-111.805,[42.01, -112.136, 42.447, -111.475]],
  ["fremont","Fremont","https://services6.arcgis.com/tNgqqEFlzKrVeDPz/arcgis/rest/services/Parcels/FeatureServer/6","PIDN",null,null,0,44.313,-111.598,[43.861, -112.165, 44.765, -111.031]],
  ["idaho","Idaho","https://services7.arcgis.com/gqcDdwE7LMrYrEMJ/arcgis/rest/services/Parcels/FeatureServer/0","PS_PAR_15","PS_PROP_AD",null,1,45.882,-115.558,[45.082, -116.811, 46.681, -114.305]],
  ["jefferson","Jefferson","/gis-proxy/gisportal.co.jefferson.id.us/archost/rest/services/Assessor/Historic_Parcels/MapServer/0","PIN","PROPAD",null,1,43.834,-112.15,[43.593, -112.703, 44.074, -111.597]],
  ["kootenai","Kootenai","/gis-proxy/map.kcgov.us/arcgis/rest/services/ASSR_Dynamic_Layers_gisapp2022/MapServer/9","PIN","Loc_Addr",null,1,47.674,-116.685,[47.34, -117.062, 48.009, -116.308]],
  ["latah","Latah","/gis-proxy/gis.latah.id.us/arcgis/rest/services/Parcels3/MapServer/0","PARCEL_ID","GISParcels_dbo_pcparc00_PM_PROP_AD",null,1,46.827,-116.685,[46.513, -117.062, 47.14, -116.309]],
  ["lewis","Lewis","https://services6.arcgis.com/MzNRwfxJp71yxjQd/arcgis/rest/services/POL_Parcels/FeatureServer/4","PARCEL_ID",null,null,0,46.226,-116.361,[45.965, -116.735, 46.486, -115.987]],
  ["madison","Madison","/gis-proxy/madison.rexburg.org/mrgis/rest/services/Data/Parcels/MapServer/0","PARCEL_ID","SITE_ADD",null,1,43.77,-111.678,[43.597, -111.989, 43.944, -111.368]],
  ["owyhee","Owyhee","https://services1.arcgis.com/Qqv4dYPC8Vv8e3c3/arcgis/rest/services/D3_Parcels/FeatureServer/6","RP_NUMBER","Situs",null,1,42.837,-116.026,[42.01, -117.046, 43.699, -115.005]],
  ["shoshone","Shoshone","https://services1.arcgis.com/DjfAyvUwdiY6gnFC/arcgis/rest/services/Shoshone_Parcels/FeatureServer/0","ID",null,null,1,47.489,-115.647,[46.901, -116.349, 48.076, -114.945]],
];
export const idRaw = () => Object.fromEntries(ID_ROWS.map(([k, n, url, id, addr, scope]) => ["id_" + k, {
  state: "ID", label: n + " County, ID", layerUrl: url, idField: id, ...(addr ? { addrField: addr } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const idMap = () => Object.fromEntries(ID_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb]) => ["id_" + k, {
  state: "ID", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
