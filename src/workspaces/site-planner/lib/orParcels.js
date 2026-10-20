/* NEW-1 (B2347696, 2026-10-19) — OREGON county parcel sources beyond the two hand-written rows in counties.js (or_multnomah, or_clackamas).
 * Oregon has no free statewide queryable taxlot layer: DOR's ORMAP service is permission-gated (403 to anonymous), ODF's TaxlotsDisplay is a
 * map-image-only service (no Query), ODF StatewideTaxLots is token-gated, and the state's "Tax Lot" cadastral layer is retired (HTTP 400).
 * Each county here is wired to its OWN county / assessor-published service, or (Curry, Jefferson, Lincoln) to the Water Resources Department's
 * public tax-lot query scoped by county_name. A county absent from this table AND from counties.js (Polk, Sherman, Wallowa) has no usable
 * public service and says so by name ("<County> — no parcel data wired here yet"): docs/STATEWIDE-PARCELS.md "Oregon counties (2026-10-19)" has
 * the per-county table and what was searched. Keys are `or_`-prefixed (a bare Union/Lincoln/Marion/Washington would collide with other states).
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, scopeWhere, owner column?, centre lat, lng, padded bbox].
 * Provenance prose lives in orProvenance.js (build-time only, never shipped to the browser). */
export const OR_ROWS = [
  ["baker","Baker","https://services3.arcgis.com/QNL6ESLaMOiSE2DQ/arcgis/rest/services/Baker_County_Oregon_Taxlot_Shapefile/FeatureServer/0","MapTaxlot",null,null,0,44.661,-117.652,[44.216, -118.547, 45.106, -116.757]],
  ["benton","Benton","/gis-proxy/gis.co.benton.or.us/arcgis/rest/services/Public/TaxlotOwners/FeatureServer/0","MapTaxlot","Situs_Addr1",null,1,44.491,-123.447,[44.24, -123.849, 44.742, -123.046]],
  ["clatsop","Clatsop","https://services8.arcgis.com/l89P2qlKPxgrFDLw/arcgis/rest/services/taxlot_accounts/FeatureServer/0","MapTaxlot","SITUS_ADDR",null,1,46.002,-123.679,[45.738, -124.026, 46.266, -123.331]],
  ["columbia","Columbia","/gis-proxy/gis.columbiacountymaps.com/server/rest/services/TaxlotWb/FeatureServer/0","MAP_TAX","PRIMARY_SI",null,1,45.949,-123.064,[45.684, -123.394, 46.214, -122.734]],
  ["coos","Coos","https://services5.arcgis.com/W1uyphp8h2tna3qJ/arcgis/rest/services/Coos_County_Parcels_March2024/FeatureServer/0","TLID","SITUSSTR",null,1,43.139,-124.097,[42.643, -124.515, 43.635, -123.678]],
  ["crook","Crook","/gis-proxy/gis.crookcountyor.gov/server/rest/services/taxlots_helion_view/FeatureServer/0","MAPTAXLOT","SITUS_ADDRESS",null,1,44.124,-120.381,[43.66, -121.139, 44.588, -119.623]],
  ["curry","Curry","/gis-proxy/gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_Query_WGS84/FeatureServer/2","maptaxlot",null,"county_name='Curry'",0,42.474,-124.145,[41.963, -124.59, 42.986, -123.7]],
  ["deschutes","Deschutes","https://services1.arcgis.com/znO8Hz1SuVVohYhZ/arcgis/rest/services/Taxlots/FeatureServer/0","TAXLOT",null,null,0,43.996,-120.947,[43.574, -122.031, 44.418, -119.863]],
  ["douglas","Douglas","/gis-proxy/gis.co.douglas.or.us/server/rest/services/Parcel/Parcels/FeatureServer/0","TAXID","SitusAddress",null,1,43.318,-123.106,[42.666, -124.256, 43.97, -121.955]],
  ["gilliam","Gilliam","https://services3.arcgis.com/e3KSI9Py4B7m3xu6/arcgis/rest/services/Gilliam01_TL/FeatureServer/6","MapTaxlot","SITUS",null,1,45.435,-120.207,[45.028, -120.688, 45.841, -119.726]],
  ["grant","Grant","https://services3.arcgis.com/e3KSI9Py4B7m3xu6/arcgis/rest/services/Grant01/FeatureServer/0","MapTaxlot",null,null,0,44.472,-118.949,[43.924, -119.702, 45.019, -118.195]],
  ["harney","Harney","https://services3.arcgis.com/e3KSI9Py4B7m3xu6/arcgis/rest/services/02_arcgis_online_Address_and_Tax_Lots/FeatureServer/1","MapTaxlot","SITUS",null,1,43.015,-119.06,[41.959, -119.966, 44.071, -118.155]],
  ["hoodriver","Hood River","https://services7.arcgis.com/xtfQPw7zwSRPkcfN/arcgis/rest/services/Tax_Lot_Parcels_Public/FeatureServer/54","MAPTAXLOT","SITUS",null,1,45.486,-121.684,[45.222, -121.957, 45.75, -121.41]],
  ["jackson","Jackson","/gis-proxy/jcportal.jacksoncountyor.gov/server/rest/services/Property/Taxlots2/FeatureServer/1","MAPTAXLOT","SITEADD",null,1,42.497,-122.755,[41.971, -123.266, 43.023, -122.243]],
  ["jefferson","Jefferson","/gis-proxy/gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_Query_WGS84/FeatureServer/2","maptaxlot",null,"county_name='Jefferson'",0,44.601,-121.114,[44.353, -121.877, 44.849, -120.351]],
  ["josephine","Josephine","https://services8.arcgis.com/tTnPnfrm4tbv649q/arcgis/rest/services/JoCo_Taxlots/FeatureServer/63","MAPNUM","SITUS",null,1,42.383,-123.641,[41.963, -124.09, 42.802, -123.192]],
  ["klamath","Klamath","https://services.arcgis.com/H6Mh1bySxR4oHx6x/arcgis/rest/services/KC_Taxlots/FeatureServer/1","MTL","SITUS_ADDRESS",null,1,42.799,-121.578,[41.958, -122.315, 43.64, -120.842]],
  ["lake","Lake","https://services.arcgis.com/H6Mh1bySxR4oHx6x/arcgis/rest/services/LakeCoTaxlots/FeatureServer/0","MapTaxlot",null,null,1,42.799,-120.35,[41.958, -121.377, 43.64, -119.322]],
  ["lane","Lane","/gis-proxy/lcmaps.lanecounty.org/arcgis/rest/services/AT/AddressParcelSales/MapServer/2","MAPTAXLOT",null,null,1,43.858,-122.962,[43.404, -124.188, 44.312, -121.735]],
  ["lincoln","Lincoln","/gis-proxy/gis.wrd.state.or.us/server/rest/services/tax/Tax_Lots_Public_Query_WGS84/FeatureServer/2","maptaxlot",null,"county_name='Lincoln'",0,44.652,-123.857,[44.236, -124.148, 45.067, -123.565]],
  ["linn","Linn","/gis-proxy/gis.co.linn.or.us/arcgis/rest/services/AssessmentTax/pub_taxlots_web/MapServer/0","PIN",null,null,0,44.49,-122.526,[44.159, -123.284, 44.821, -121.767]],
  ["malheur","Malheur","https://services3.arcgis.com/e3KSI9Py4B7m3xu6/arcgis/rest/services/Malheur01TL/FeatureServer/0","MapTaxlot",null,null,1,43.217,-117.566,[41.965, -118.26, 44.47, -116.872]],
  ["marion","Marion","https://services1.arcgis.com/sYGZnQPdJ0azuLyn/arcgis/rest/services/Parcels/FeatureServer/0","TAXLOT","SITUS",null,1,44.979,-122.466,[44.648, -123.21, 45.311, -121.722]],
  ["morrow","Morrow","https://services6.arcgis.com/MQGnkVpUbcAxMorv/arcgis/rest/services/2026_10_16_Assessment_Taxlot_Merge_shp/FeatureServer/0","MAPTAXLOT","SITUSSTR",null,1,45.45,-119.571,[44.957, -120.028, 45.944, -119.114]],
  ["tillamook","Tillamook","https://services3.arcgis.com/JnnlTIrcZLzs7d68/arcgis/rest/services/Taxlots/FeatureServer/0","MapTaxlot",null,null,0,45.406,-123.653,[45.006, -124.038, 45.806, -123.268]],
  ["umatilla","Umatilla","https://services3.arcgis.com/pi8Rll0S1Iwgkq8o/arcgis/rest/services/Tax_Lot_Map_WFL1/FeatureServer/0","map_tax",null,null,1,45.494,-118.707,[44.956, -119.473, 46.032, -117.942]],
  ["union","Union","https://services3.arcgis.com/e3KSI9Py4B7m3xu6/arcgis/rest/services/Union01TaxMaps/FeatureServer/0","MapTaxlot",null,null,0,45.402,-117.975,[44.919, -118.726, 45.885, -117.225]],
  ["wasco","Wasco","/gis-proxy/public.co.wasco.or.us/gisserver/rest/services/Taxlots/MapServer/0","MapTaxlot",null,null,1,45.259,-121.095,[44.788, -121.839, 45.73, -120.352]],
  ["washington","Washington","/gis-proxy/gispub.co.washington.or.us/server/rest/services/Washington_County_Taxlots/FeatureServer/0","TLNO",null,null,0,45.541,-123.114,[45.282, -123.515, 45.801, -122.713]],
  ["wheeler","Wheeler","https://services3.arcgis.com/e3KSI9Py4B7m3xu6/arcgis/rest/services/Wheeler01_TL/FeatureServer/0","MAPTAXLOT",null,null,1,44.68,-120.072,[44.268, -120.522, 45.092, -119.623]],
  ["yamhill","Yamhill","https://services6.arcgis.com/toubSXwoan3LMhOW/arcgis/rest/services/AT_Taxlots/FeatureServer/1","maptaxlot","situs1",null,1,45.249,-123.326,[45.038, -123.816, 45.459, -122.836]],
];
export const orRaw = () => Object.fromEntries(OR_ROWS.map(([k, n, url, id, addr, scope]) => ["or_" + k, {
  state: "OR", label: n + " County, OR", layerUrl: url, idField: id, ...(addr ? { addrField: addr } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County taxlots (county GIS). Search by map-taxlot number" + (addr ? " or a site address." : "."),
}]));
export const orMap = () => Object.fromEntries(OR_ROWS.map(([k, n, url, id, addr, scope, ow, la, ln, bb]) => ["or_" + k, {
  state: "OR", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
