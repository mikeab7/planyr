/* NEW-1 (B2349360, 2026-10-19) — WASHINGTON county parcel sources. Washington has a statewide parcel mosaic (WAGeoservices "Current Parcels" / the WDFW copy) but its own
 * licence text restricts some counties' parcels to "State of Washington business only", so — as the owner's standing record (docs/STATEWIDE-PARCELS.md, B759/760) has it — it is
 * NOT used here. Every county is wired to ITS OWN published layer instead: the county / assessor / GIS department's ArcGIS Online org, or its own ArcGIS Server (reached through
 * /gis-proxy when it sends no CORS header). Five counties have no public layer and say so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md
 * "Washington counties (2026-10-19)" has the per-county table and what was searched. Keys are `wa_`-prefixed (Washington/Lincoln/Jefferson/Franklin/… are also counties in other states).
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, owner column?, centre lat, lng, padded bbox]. Provenance prose lives in waProvenance.js
 * (build-time only, never shipped to the browser). San Juan's bbox is hand-widened to the whole archipelago (Orcas, Lopez, Shaw, Waldron…): the bundled county polygons carry only part of San
 * Juan Island, so the bbox is what routes an island lot click to wa_sanjuan (B2349362). */
export const WA_ROWS = [
  ["adams","Adams","https://services9.arcgis.com/PIM6ojLbIEBpWUkK/arcgis/rest/services/Ritzville_Parcels/FeatureServer/0","ParcelNumb","Situs",1,46.997,-118.6655,[46.714, -119.391, 47.28, -117.94]],
  ["asotin","Asotin","https://services6.arcgis.com/VsJGTl1jmCYBc0EX/arcgis/rest/services/Asotin_County_Parcels/FeatureServer/1","PARCEL","PA2",1,46.2263,-117.2005,[45.975, -117.502, 46.478, -116.899]],
  ["benton","Benton","https://services7.arcgis.com/NURlY7V8UHl6XumF/arcgis/rest/services/Parcels_and_Assess_view/FeatureServer/0","Parcel_ID","situs_address",1,46.2765,-119.41,[45.811, -119.903, 46.741, -118.917]],
  ["chelan","Chelan","/gis-proxy/atlas.co.chelan.wa.us/arcgis/rest/services/GIS/ParcelsOwners/MapServer/0","sde_CHELAN_Property_Polygons_PA","sde_CHELAN_PACS_TABLE_Site_Addr",1,47.8992,-120.5195,[47.236, -121.2, 48.562, -119.839]],
  ["clallam","Clallam","https://services8.arcgis.com/noCZ2SM2C0rVag8y/arcgis/rest/services/parcel_owners/FeatureServer/0","PNUM",null,1,48.1215,-123.8272,[47.845, -124.753, 48.397, -122.901]],
  ["clark","Clark","https://services2.arcgis.com/ylxwjFBdCPBzP16d/arcgis/rest/services/TaxlotsforPublicUse/FeatureServer/0","Prop_id","SitusAddrsFull",0,45.8,-122.5165,[45.523, -122.808, 46.077, -122.225]],
  ["cowlitz","Cowlitz","/gis-proxy/gis.cowlitzwa.gov/ccserver/rest/services/Assessor/Parcels/MapServer/0","PARCNO",null,1,46.1157,-122.7315,[45.83, -123.24, 46.401, -122.223]],
  ["douglas","Douglas","https://services2.arcgis.com/fjst9C4kBtvXuiLQ/arcgis/rest/services/Parcels_view_(Joined)/FeatureServer/0","ParcelNumb","Situs",1,47.6855,-119.6295,[47.201, -120.325, 48.17, -118.934]],
  ["franklin","Franklin","https://services5.arcgis.com/Mrjxd32WJFxUIHrM/arcgis/rest/services/Parcels_7_26/FeatureServer/0","PARCELNUMB","Situs",1,46.4652,-118.8275,[46.174, -119.474, 46.756, -118.181]],
  ["grant","Grant","https://services2.arcgis.com/hQZvdtFxRzJpMtdS/arcgis/rest/services/Parcel/FeatureServer/0","PARCEL","situs_street",1,47.2925,-119.5077,[46.606, -120.063, 47.979, -118.952]],
  ["graysharbor","Grays Harbor","https://services3.arcgis.com/CxYgmwdx507LY5lO/arcgis/rest/services/Grays_Harbor_Parcels_2024/FeatureServer/0","ParcelID","ADDRESS",1,47.1585,-123.7553,[46.769, -124.369, 47.548, -123.142]],
  ["island","Island","https://services6.arcgis.com/Q2crTJYujvn27IJC/arcgis/rest/services/Parcels/FeatureServer/0","ParcelNo","physical_addr",1,48.1297,-122.5829,[47.884, -122.789, 48.425, -122.336]],
  ["jefferson","Jefferson","/gis-proxy/gisweb.jeffcowa.us/server/rest/services/OpenData/OpenData/MapServer/4","PIN","Situs_Addr",1,47.8285,-123.63,[47.493, -124.626, 48.164, -122.633]],
  ["king","King","https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/PARCEL_ADDRESS_PUB_AREA_3069/FeatureServer/0","PIN","ADDR_FULL",0,47.43,-121.7435,[47.064, -122.441, 47.796, -121.046]],
  ["kitsap","Kitsap","https://services6.arcgis.com/qt3UCV9x5kB4CwRA/arcgis/rest/services/Tax_Parcel_lot_polygons/FeatureServer/0","APN",null,0,47.6404,-122.75,[47.378, -123.046, 47.956, -122.454]],
  ["kittitas","Kittitas","/gis-proxy/gis.co.kittitas.wa.us/kcgis/rest/services/OpenData/Tax_Parcel_OpenData/MapServer/0","PARCELID","t2_Situs",1,47.1647,-120.6942,[46.713, -121.481, 47.616, -119.907]],
  ["klickitat","Klickitat","https://services9.arcgis.com/jOyAPi8TFd9XL78l/arcgis/rest/services/KlickitatParcels_2026/FeatureServer/0","PARCEL_NUM","ADDRESS",1,45.8225,-120.7395,[45.58, -121.63, 46.064, -119.849]],
  ["lewis","Lewis","https://services7.arcgis.com/WW5lgea2Y0mYbpH6/arcgis/rest/services/Lewis_County_Tax_Parcels/FeatureServer/0","PIN","SITEADD",0,46.5835,-122.3685,[46.354, -123.393, 46.813, -121.344]],
  ["lincoln","Lincoln","https://services3.arcgis.com/caAn57sZq4ktyly4/arcgis/rest/services/Parcel/FeatureServer/0","ParcelNum","Situs",1,47.603,-118.401,[47.237, -119.001, 47.97, -117.802]],
  ["mason","Mason","https://services2.arcgis.com/jJDDJN0XbP5tQU8H/arcgis/rest/services/Parcels_2025/FeatureServer/0","PIN","SITUS_ADDR",1,47.3413,-123.151,[47.057, -123.522, 47.625, -122.779]],
  ["pendoreille","Pend Oreille","https://services1.arcgis.com/o3wuEYcU5N00WpI1/arcgis/rest/services/PendOreilleCountyParcels/FeatureServer/0","prop_id",null,1,48.522,-117.3325,[48.024, -117.656, 49.02, -117.009]],
  ["pierce","Pierce","https://services2.arcgis.com/1UvBaQ5y1ubjUPmd/arcgis/rest/services/Tax_Parcels/FeatureServer/0","TaxParcelNumber","Site_Address",0,47.0648,-122.1033,[46.71, -122.845, 47.419, -121.362]],
  ["sanjuan","San Juan","/gis-proxy/gis.sanjuancountywa.gov/arcgis/rest/services/Polaris/Parcels/MapServer/1","PIN",null,1,48.5337,-123.069,[48.36, -123.25, 48.8, -122.65]],
  ["skagit","Skagit","/gis-proxy/gis.skagitcountywa.gov/arcgis/rest/services/OpenData/AssessorDataParcels/FeatureServer/0","PARCELID","SitusStName",1,48.4723,-121.693,[48.269, -122.72, 48.675, -120.666]],
  ["skamania","Skamania","https://services3.arcgis.com/uKh72TYBlxpm42Cm/arcgis/rest/services/Parcel/FeatureServer/0","PARCEL_ID","Situs",1,45.9657,-121.8825,[45.528, -122.268, 46.403, -121.497]],
  ["snohomish","Snohomish","https://services6.arcgis.com/z6WYi9VRHfgwgtyW/arcgis/rest/services/Parcels/FeatureServer/0","PARCEL_ID","SITUSLINE1",1,48.032,-121.6617,[47.754, -122.424, 48.31, -120.899]],
  ["spokane","Spokane","https://services1.arcgis.com/ozNll27nt9ZtPWOn/arcgis/rest/services/Parcels/FeatureServer/0","PID_NUM","site_address",0,47.6517,-117.4327,[47.238, -117.848, 48.066, -117.017]],
  ["stevens","Stevens","https://services.arcgis.com/6E99CuinVlFZ3R03/arcgis/rest/services/Stevens_County_Addressing_Parcel_Map_WFL1/FeatureServer/0","PARCELN",null,0,48.395,-117.9102,[47.77, -118.406, 49.02, -117.414]],
  ["thurston","Thurston","/gis-proxy/tconline.co.thurston.wa.us/server/rest/services/Common_Layers/Parcels/FeatureServer/4","PARCEL_NO","SITUS_STRE",1,46.9428,-122.72,[46.74, -123.229, 47.146, -122.211]],
  ["wahkiakum","Wahkiakum","https://services5.arcgis.com/SQaKrZ90pTH1GKNW/arcgis/rest/services/Wahkiakum_County_Tax_Parcels_Authoritative_Hosted_Feature_(Public_VIew_WCNYH)/FeatureServer/1","Geographic","Parcel_Add",1,46.2853,-123.469,[46.124, -123.745, 46.4, -123.193]],
  ["wallawalla","Walla Walla","https://services8.arcgis.com/COL6rRPkF9w28VGX/arcgis/rest/services/Tax_Parcels/FeatureServer/0","geo_id","full_situs",1,46.3005,-118.5115,[45.979, -119.054, 46.622, -117.97]],
  ["whatcom","Whatcom","/gis-proxy/wcgis.whatcomcounty.us/arcgis/rest/services/EnterprisePublishing/WhatcomCo_Property/MapServer/1","geo_id","situs_street",1,48.8192,-121.7405,[48.619, -122.843, 49.02, -120.639]],
  ["whitman","Whitman","https://services3.arcgis.com/eoLFybJXLOtInQXJ/arcgis/rest/services/Parcel_Data___TaxSifter_Map_WFL1/FeatureServer/19","ParcelNumber",null,1,46.8383,-117.6407,[46.398, -118.263, 47.278, -117.018]],
  ["yakima","Yakima","https://services3.arcgis.com/9Qz94N8Zml9hnG84/arcgis/rest/services/Parcels/FeatureServer/1","PARC",null,0,46.5613,-120.6953,[46.018, -121.545, 47.105, -119.845]],
];
export const waRaw = () => Object.fromEntries(WA_ROWS.map(([k, n, url, id, addr]) => ["wa_" + k, {
  state: "WA", label: n + " County, WA", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const waMap = () => Object.fromEntries(WA_ROWS.map(([k, n, url, , , , la, ln, bb]) => ["wa_" + k, {
  state: "WA", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url,
}]));
