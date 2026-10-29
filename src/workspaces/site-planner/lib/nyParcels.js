/* NEW-1 (New York, 2026-10-20) — New York county parcel sources beyond the statewide public layer (ny_statewide in counties.js).
 * The statewide layer holds 38 of 62 counties (the five NYC boroughs among them); NY_UNCOVERED is the other 24, MEASURED from its Footprint
 * layer and a per-county count. A county here with no row says so by name ("<County> — no parcel data wired here yet."); docs/STATEWIDE-PARCELS.md
 * "New York counties (2026-10-20)" has the per-county table and what was searched.
 * Niagara (NEW-1, 2026-10-28) was a named gap only because its county server MOVED: the old host (gis.niagaracounty.com) answers "Service … not started", the
 * county's current viewer reads parcels from gis.niagaracounty.gov/server (PublicViewer/Public_Viewer layer 4, "Parcels (Niagara County Final Roll, 2026)"). It is wired through
 * the relay; the statewide layer holds none of Niagara (see NY_UNCOVERED), so its fallbacks are the extras in parcelFallbacks.js.
 * Row: [slug, county name, layer, idField, addrField, scopeWhere, owner column?, centre lat, lng, padded bbox, displayMinZoom?]. */
export const NY_UNCOVERED = ["Allegany", "Cattaraugus", "Chemung", "Chenango", "Clinton", "Columbia", "Delaware", "Dutchess", "Essex", "Franklin", "Fulton", "Herkimer", "Jefferson", "Madison", "Monroe", "Nassau", "Niagara", "Orleans", "Saratoga", "Schenectady", "Schoharie", "Seneca", "Washington", "Yates"];
export const NY_ROWS = [
  ["allegany","Allegany","https://services6.arcgis.com/TUMWUdOUQ0tPtTxU/arcgis/rest/services/Tax_Map_2025_Ally_Co_Final_Merge/FeatureServer/0","Printkey","Street",null,1,42.2635,-78.0135,[41.977, -78.325, 42.55, -77.702],16],
  ["cattaraugus","Cattaraugus","/gis-proxy/maps2.cattco.org/arcgiswebadaptor/rest/services/PublicNotification/Public_Notification_Parcels/FeatureServer/0","PRINTKEY","ParcelAdd",null,1,42.272,-78.6823,[41.979, -79.079, 42.565, -78.285],16],
  ["chemung","Chemung","https://services5.arcgis.com/Zuw6weNBpZX2wFbS/arcgis/rest/services/Parcels_2024/FeatureServer/0","PrintKey","RPS_ADDRES",null,1,42.1475,-76.7498,[41.982, -76.989, 42.312, -76.511],16],
  ["chenango","Chenango","https://services6.arcgis.com/krSNOBBGf8rF7cNp/arcgis/rest/services/Chenango_Tax_Map_WFL1/FeatureServer/4","printkey","address",null,1,42.4723,-75.587,[42.174, -75.908, 42.771, -75.266],16],
  ["clinton","Clinton","https://services3.arcgis.com/33FPYaVQYNa7sFJ5/arcgis/rest/services/Parcels_ClintonWeb1/FeatureServer/0","PRINT_KEY","PROP_ADDR",null,1,44.7152,-73.6743,[44.404, -74.041, 45.026, -73.307],16],
  ["columbia","Columbia","https://utility.arcgis.com/usrsvcs/servers/71beebf563f848479e79202d20c2dfe7/rest/services/CCBT24/FeatureServer/200","ParcelID","StreetName",null,0,42.2438,-73.6437,[41.962, -73.956, 42.525, -73.331],16],
  ["delaware","Delaware","/gis-proxy/spatialags.vhb.com/arcgis/rest/services/29822_Delaware/NY_County_Delaware/MapServer/25","PRINT_KEY","PROP_ADDR",null,1,42.188,-74.9255,[41.836, -75.447, 42.54, -74.404],16],
  ["dutchess","Dutchess","https://services7.arcgis.com/qa9lgxOEmOSHoWNZ/arcgis/rest/services/County_Parcels/FeatureServer/0","PrintKey",null,null,0,41.7597,-73.7415,[41.419, -74.019, 42.1, -73.464],16],
  ["essex","Essex","https://services6.arcgis.com/YMCiEBhA0TNgGZ2c/arcgis/rest/services/Parcels_2026_2_view/FeatureServer/15","PRINTKEY","LOCATION",null,1,44.142,-73.8125,[43.719, -74.352, 44.565, -73.273]],
  ["franklin","Franklin","/gis-proxy/maps.dancgis.org/server/rest/services/Parcel_Model/MapServer/0","PRINT_KEY","PARCEL_ADD","COUNTY='FRANKLIN'",1,44.5445,-74.3233,[44.076, -74.756, 45.013, -73.891],16],
  ["fulton","Fulton","https://services2.arcgis.com/okXm0pb6aWH6XOGI/arcgis/rest/services/Mohawk_Property_Class_by_Parcel/FeatureServer/0","PrintKey",null,"County='Fulton'",0,43.1335,-74.437,[42.962, -74.795, 43.305, -74.079],16],
  ["herkimer","Herkimer","https://services2.arcgis.com/eJJggHxAdMpU0Yv4/arcgis/rest/services/HerkimerCo_Parcels_LandUse/FeatureServer/0","parcelnumb","address",null,1,43.4603,-74.9543,[42.807, -75.234, 44.113, -74.675],16],
  ["jefferson","Jefferson","/gis-proxy/maps.dancgis.org/server/rest/services/Parcel_Model/MapServer/0","PRINT_KEY","PARCEL_ADD","UPPER(COUNTY) LIKE 'JEFFERSON%'",1,44.031,-75.905,[43.651, -76.383, 44.411, -75.427],16],
  ["madison","Madison","https://services6.arcgis.com/yg1rUzGjBdSxKz2Z/arcgis/rest/services/2024_Tax_Parcels/FeatureServer/0","Print_Key","PARCEL_LOC",null,0,42.957,-75.616,[42.707, -76.008, 43.207, -75.224],16],
  ["monroe","Monroe","/gis-proxy/maps.monroecounty.gov/server/rest/services/Hosted/Parcels_Public/FeatureServer/0","printkey","parceladdress",null,0,43.154,-77.6785,[42.922, -78.012, 43.386, -77.345],17],
  ["nassau","Nassau","https://services6.arcgis.com/dptt3Slw4IV02m0l/arcgis/rest/services/Nassau_County_Parcels_v2/FeatureServer/0","SBL","PARCEL_ADD",null,1,40.7488,-73.5938,[40.574, -73.785, 40.923, -73.403],17],
  ["niagara","Niagara","/gis-proxy/gis.niagaracounty.gov/server/rest/services/PublicViewer/Public_Viewer/FeatureServer/4","PrintKey","PrclStreet",null,1,43.19,-78.74,[42.99, -79.1, 43.4, -78.43],16],
  ["orleans","Orleans","https://services6.arcgis.com/AGRzZ0TKgr5syAM6/arcgis/rest/services/OrleansCountyParcels/FeatureServer/0","print_key","loc_st_nam",null,1,43.251,-78.2287,[43.11, -78.486, 43.392, -77.971],16],
  ["saratoga","Saratoga","https://services8.arcgis.com/L31p4Kvi5t2HjDqc/arcgis/rest/services/Parcels/FeatureServer/57","PRINT_KEY","PROP_ADDR",null,1,43.0812,-73.8697,[42.744, -74.179, 43.419, -73.56],16],
  ["schenectady","Schenectady","/gis-proxy/spatialags.vhb.com/arcgis/rest/services/29816_SIMS/SIMS_03262026/MapServer/6","PRINT_KEY","PROP_ADDRS",null,1,42.8308,-74.0627,[42.691, -74.323, 42.97, -73.802],16],
  ["schoharie","Schoharie","https://services7.arcgis.com/fScJUugRnMdg5KWv/arcgis/rest/services/Parcels/FeatureServer/5","PRINT_KEY","PROP_ADDR",null,1,42.594,-74.4375,[42.333, -74.738, 42.855, -74.137]],
  ["seneca","Seneca","https://services2.arcgis.com/r16htQT76FYkOCrg/arcgis/rest/services/ParcelsCloudPermit/FeatureServer/0","print_key","parcel_loc",null,1,42.789,-76.7798,[42.532, -76.992, 43.046, -76.568],16],
  ["washington","Washington","/gis-proxy/gis.washingtoncountyny.gov/arcgis/rest/services/WaCoMS4_COLLECTION_MAP/MapServer/9","PRINT_KEY","PROP_ADDR",null,1,43.3713,-73.4412,[42.918, -73.664, 43.825, -73.219]],
  ["yates","Yates","/gis-proxy/gisportal.yatescounty.org/server/rest/services/Hosted/Parcels/FeatureServer/0","printkey","prop_addr",null,1,42.6128,-77.1255,[42.438, -77.386, 42.788, -76.865],16],
];
export const nyRaw = () => Object.fromEntries(NY_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb, floor]) => ["ny_" + k, {
  state: "NY", label: n + " County, NY", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}), ...(floor ? { displayMinZoom: floor } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const nyMap = () => Object.fromEntries(NY_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb, floor]) => ["ny_" + k, {
  state: "NY", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}), ...(floor ? { displayMinZoom: floor } : {}),
}]));
