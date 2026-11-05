/* NEW-1 (Pennsylvania, 2026-10-19) — PENNSYLVANIA county parcel sources. Pennsylvania has NO single free statewide parcel service with owners: PASDA (Penn State's state data clearinghouse) hosts one MapServer per
 * county for ~36 counties (each the county's OWN published layer, submitted to PASDA — the 2026-09-08 note that PASDA held "exactly one" parcel service was wrong), the PA DEP "PA_Parcels" layer is a PARTIAL
 * compilation (kept only as the last-resort source for the four counties with nothing better), and the rest of the counties publish through their own ArcGIS Server / ArcGIS Online. Each county below is wired to
 * the best MEASURED source (county-run first, then PASDA, then DEP), and Armstrong (wired 2026-10-20, from an ArcGIS Online account rather than the county — its own site says it has no public viewer) completes all 67: docs/STATEWIDE-PARCELS.md "Pennsylvania counties
 * (2026-10-19)" has the per-county table and what was searched. pa_allegheny, pa_northampton, pa_cumberland, pa_lehigh, pa_luzerne and pa_lackawanna stay hand-written in counties.js (wired 2026-09).
 * Row: [slug, county name, layer (non-arcgis.com hosts ride /gis-proxy), idField, addrField, centre lat, lng, padded bbox, scopeWhere?]. scopeWhere is set only for the four rows that share the DEP layer (text search stays inside the county; Elk's rows carry no COUNTY_NAME, so its scope is the null clause the search ignores — an Elk number search is statewide, ids are 8-digit and distinct). Provenance prose lives in paProvenance.js (build-time only, never shipped to the browser). */
const PAS = (svc, n) => "/gis-proxy/mapservices.pasda.psu.edu/server/rest/services/pasda/" + svc + "/MapServer/" + n; // PASDA's per-county MapServer
const DEP = "/gis-proxy/gis.dep.pa.gov/depgisprd/rest/services/Parcels/PA_Parcels/MapServer/0"; // PA DEP partial statewide layer — last resort
export const PA_ROWS = [
  ["armstrong", "Armstrong", "https://services5.arcgis.com/beeAx3XQCWXfcm0Q/arcgis/rest/services/Armstrong_County_Parcels/FeatureServer/8", "PARCELNUM", null, 40.7977, -79.4781, [40.498, -79.73, 41.205, -79.186]], // layer 8, NOT 0 (/0 answers "400 Invalid URL")
  ["adams", "Adams", PAS("AdamsCounty",2), "Parcel_ID", "COMBINED_S", 39.8813, -77.1584, [39.69, -77.508, 40.102, -76.937]],
  ["beaver", "Beaver", "/gis-proxy/gis.beavercountypa.gov/server/rest/services/InfoAtlas/Parcels_with_Owner/MapServer/22", "Parcel_ID", "Location_Street", 40.6837, -80.3526, [40.449, -80.555, 40.887, -80.12]],
  ["bedford", "Bedford", PAS("BedfordCounty",0), "Name", null, 39.9745, -78.505, [39.693, -78.848, 40.357, -78.105]],
  ["berks", "Berks", PAS("BerksCounty",6), "PIN", "FULLSITEAD", 40.4113, -75.8717, [40.111, -76.468, 40.712, -75.502]],
  ["blair", "Blair", PAS("BlairCounty",2), "PAR_NUM", null, 40.4759, -78.3327, [40.217, -78.651, 40.776, -78.096]],
  ["bradford", "Bradford", PAS("BradfordCounty",5), "ParcelJoin", null, 41.7735, -76.3895, [41.514, -76.959, 42.033, -76.09]],
  ["bucks", "Bucks", PAS("BucksCounty",17), "PARCEL_NUM", "ADDRESS", 40.421, -75.2058, [40.004, -75.524, 40.645, -74.695]],
  ["butler", "Butler", PAS("ButlerCounty",0), "PIN", null, 40.8974, -79.9317, [40.633, -80.196, 41.205, -79.668]],
  ["cambria", "Cambria", PAS("CambriaCounty",13), "PARCELID", null, 40.4618, -78.7409, [40.204, -79.092, 40.761, -78.332]],
  ["cameron", "Cameron", "https://services5.arcgis.com/NN66N9nlzcCXJ9he/arcgis/rest/services/Parcels_(September_2025)/FeatureServer/0", "PIN", null, 41.3863, -78.1387, [41.188, -78.455, 41.652, -77.966]],
  ["carbon", "Carbon", "/gis-proxy/gis.carboncounty.com/arcgis/rest/services/Parcels_Universal/MapServer/0", "ParcelID", "Location", 40.8873, -75.7186, [40.709, -76.027, 41.163, -75.453]],
  ["centre", "Centre", PAS("CentreCounty",0), "TAXIDNUM", "LOCATION", 40.9506, -77.8697, [40.66, -78.412, 41.288, -77.123]],
  ["chester", "Chester", PAS("ChesterCounty",11), "UPI", "LOC_ADDRES", 39.9895, -75.7567, [39.692, -76.172, 40.287, -75.341]],
  ["clarion", "Clarion", "https://services1.arcgis.com/vPnMbqTxbhNgGUqs/arcgis/rest/services/Parcel_Permanent2/FeatureServer/0", "Map_Number", "Situs_Address", 41.1836, -79.3944, [40.941, -79.728, 41.465, -79.183]],
  ["clearfield", "Clearfield", DEP, "PARCEL_ID", "PROPERTY_ADDRESS_1", 40.9895, -78.521, [40.693, -78.838, 41.286, -78.013], "COUNTY_NAME='Clearfield'"],
  ["clinton", "Clinton", "/gis-proxy/maps.clintoncountypa.gov/arcgis/rest/services/Testing/PARCELS417/MapServer/0", "PARCEL_ID", "ADDRESS", 41.3063, -77.7014, [40.934, -78.13, 41.508, -77.114]],
  ["columbia", "Columbia", PAS("ColumbiaCounty",2), "PIN", null, 41.0882, -76.43, [40.747, -76.679, 41.34, -76.181]],
  ["crawford", "Crawford", PAS("CrawfordCounty",18), "CAMA_PIN", null, 41.6655, -80.185, [41.449, -80.554, 41.882, -79.59]],
  ["dauphin", "Dauphin", PAS("DauphinCounty",0), "PID", null, 40.4236, -76.8089, [40.109, -77.066, 40.694, -76.511]],
  ["delaware", "Delaware", "/gis-proxy/gis.delcopa.gov/arcgis/rest/services/AssessmentViewers/Parcels/MapServer/0", "PIN", null, 39.9327, -75.3683, [39.769, -75.643, 40.096, -75.216]],
  ["elk", "Elk", DEP, "PARCEL_ID", "PROPERTY_ADDRESS_1", 41.4352, -78.6672, [41.172, -79.124, 41.663, -78.21], "COUNTY_NAME IS NULL"],
  ["erie", "Erie", PAS("ErieCountyParcels",0), "TaxPin", "FullStreet", 42.0245, -79.9537, [41.821, -80.552, 42.297, -79.582]],
  ["fayette", "Fayette", "https://services5.arcgis.com/n3KaqXoFYDuIhfyz/arcgis/rest/services/Fayette_County_Parcels/FeatureServer/0", "taxidnum", null, 39.9109, -79.7163, [39.689, -80.046, 40.167, -79.267]],
  ["forest", "Forest", PAS("ForestCounty",3), "PARCEL", null, 41.5129, -79.1485, [41.289, -79.558, 41.659, -78.929]],
  ["franklin", "Franklin", "/gis-proxy/fcgis.franklincountypa.gov/fcgishosting/rest/services/TaxRecords/FC_TaxRecords/MapServer/0", "Name", "FULL_SITUS_ADDR", 39.9347, -77.6998, [39.69, -78.126, 40.322, -77.432]],
  ["fulton", "Fulton", PAS("FultonCounty",0), "PIN", null, 39.9249, -78.1044, [39.694, -78.415, 40.193, -77.837]],
  ["greene", "Greene", "https://services7.arcgis.com/0JhPFgxDlwicqVHq/arcgis/rest/services/GreeneParcels111423/FeatureServer/0", "Tax_ID_Num", null, 39.8708, -80.2943, [39.69, -80.555, 40.052, -79.88]],
  ["huntingdon", "Huntingdon", "https://services3.arcgis.com/liWtJPxLI3mlx8pH/arcgis/rest/services/Property_Lines/FeatureServer/1", "TAXIDNUM", "Property_A", 40.2893, -78.0238, [40.033, -78.299, 40.772, -77.65]],
  ["indiana", "Indiana", PAS("IndianaCounty",5), "PARCEL_ID", null, 40.6418, -79.0805, [40.338, -79.493, 40.946, -78.777]],
  ["jefferson", "Jefferson", "https://services1.arcgis.com/qXvbYftT9ld1YWzi/arcgis/rest/services/Jefferson_County_Parcels_View/FeatureServer/0", "ParcelId", null, 41.143, -79.0072, [40.878, -79.251, 41.407, -78.678]],
  ["juniata", "Juniata", PAS("JuniataCounty",0), "PARCELID", null, 40.5724, -77.3816, [40.236, -77.787, 40.729, -76.908]],
  ["lancaster", "Lancaster", "/gis-proxy/arcgis.lancastercountypa.gov/arcgis/rest/services/Parcels_app/FeatureServer/0", "ACCOUNT", null, 40.0448, -76.2061, [39.692, -76.768, 40.348, -75.857]],
  ["lawrence", "Lawrence", "/gis-proxy/gis.leoc.net:6443/arcgis/rest/services/LAWRENCEGIS/TaxParcelCAMA/MapServer/1", "TID", "SITUS", 40.9917, -80.3837, [40.824, -80.553, 41.16, -80.075]],
  ["lebanon", "Lebanon", "https://utility.arcgis.com/usrsvcs/servers/7072ca11c43c43feb1ab453851e847b9/rest/services/LandRecords/TaxParcels/MapServer/0", "MAP_NUMBER", "SITUS_ADDR", 40.3755, -76.5047, [40.164, -76.71, 40.587, -76.123]],
  ["lycoming", "Lycoming", PAS("LycomingCounty",0), "PARCEL", "SITUS", 41.3365, -77.0748, [41.044, -77.636, 41.63, -76.416]],
  ["mckean", "McKean", "/gis-proxy/gis.mckeancountypa.gov/server/rest/services/ParcelViewer/BPV3_Parcels/MapServer/0", "pin", null, 41.8038, -78.3931, [41.578, -78.989, 42.03, -78.174]],
  ["mercer", "Mercer", PAS("MercerCounty",0), "Parcel_Id", "Situs_Desc", 41.2979, -80.1977, [41.038, -80.553, 41.522, -79.972]],
  ["mifflin", "Mifflin", PAS("MifflinCounty",0), "ACCOUNT", null, 40.53, -77.7271, [40.337, -77.933, 40.885, -77.271]],
  ["monroe", "Monroe", PAS("MonroeCounty",1), "MAPNUMBER", null, 41.0713, -75.3384, [40.783, -75.683, 41.285, -74.936]],
  ["montgomery", "Montgomery", PAS("MontgomeryCounty",14), "PARCEL", null, 40.2137, -75.3863, [39.953, -75.725, 40.474, -74.992]],
  ["montour", "Montour", PAS("MontourCounty",2), "PIN", null, 41.0378, -76.686, [40.852, -76.829, 41.2, -76.497]],
  ["northumberland", "Northumberland", DEP, "PARCEL_ID", "PROPERTY_ADDRESS_1", 40.8215, -76.6903, [40.578, -76.974, 41.206, -76.361], "COUNTY_NAME='Northumberland'"],
  ["perry", "Perry", PAS("PerryCounty",1), "PIN", null, 40.4329, -77.1662, [40.16, -77.704, 40.668, -76.882]],
  ["philadelphia", "Philadelphia", "https://services.arcgis.com/fLeGjb7u4uXqeF9q/arcgis/rest/services/PWD_PARCELS/FeatureServer/0", "parcel_id", "address", 39.9688, -75.1923, [39.82, -75.316, 40.165, -74.936]],
  ["pike", "Pike", "/gis-proxy/gis.pikepa.org/arcgis/rest/services/PikeCo_Parcels/MapServer/1", "MAP_JOIN", "Situs", 41.3204, -74.9991, [41.05, -75.383, 41.635, -74.67]],
  ["potter", "Potter", "/gis-proxy/maps.pottercountypa.net/arcgis/rest/services/TaxParcel/TaxParcels/MapServer/0", "Map_Number", null, 41.737, -77.9324, [41.445, -78.24, 42.029, -77.575]],
  ["schuylkill", "Schuylkill", "/gis-proxy/services.co.schuylkill.pa.us/arcgis/rest/services/ParcelLocator/Parcel_CAMA_View/MapServer/0", "PARCEL_NUMBER", null, 40.7419, -76.1538, [40.466, -76.728, 40.98, -75.736]],
  ["snyder", "Snyder", PAS("SnyderCounty",10), "PIN", null, 40.7627, -76.9725, [40.608, -77.39, 40.918, -76.783]],
  ["somerset", "Somerset", "https://services7.arcgis.com/3t8a8pNihhGS6bDO/arcgis/rest/services/Parcels/FeatureServer/0", "MAPNUM", "LOCAT", 39.9555, -79.0078, [39.689, -79.447, 40.316, -78.632]],
  ["sullivan", "Sullivan", "https://services.arcgis.com/v23hD9oBVGlp45Zy/arcgis/rest/services/Sullivan_County_Tax_Parcels_June_2023/FeatureServer/0", "PARCEL_ID", null, 41.4224, -76.495, [41.248, -76.85, 41.623, -76.191]],
  ["susquehanna", "Susquehanna", "https://services5.arcgis.com/lmuC4NmaSm4GH9h5/arcgis/rest/services/Parcels_CAMA/FeatureServer/0", "PIN", "SITUS_COMBINED", 41.821, -75.947, [41.611, -76.175, 42.031, -75.436]],
  ["tioga", "Tioga", "/gis-proxy/tiogagis.tiogacountypa.us/arcgis2017/rest/services/01_Parcel_Fabric_CAMA_Lines_REG/MapServer/0", "PARCELID", "LOCATION", 41.7735, -77.369, [41.514, -77.643, 42.032, -76.851]],
  ["union", "Union", PAS("UnionCounty",10), "Name", null, 40.9802, -77.0288, [40.782, -77.394, 41.179, -76.798]],
  ["venango", "Venango", PAS("VenangoCounty",1), "ParcelNumb", "Situs", 41.3817, -79.8084, [41.142, -80.034, 41.659, -79.453]],
  ["warren", "Warren", PAS("WarrenCounty",0), "PIN", null, 41.8137, -79.152, [41.596, -79.651, 42.031, -78.888]],
  ["washington", "Washington", PAS("WashingtonCounty",7), "PIN", null, 40.2163, -80.328, [39.923, -80.556, 40.51, -79.817]],
  ["wayne", "Wayne", "https://services1.arcgis.com/VMKRr2Ecl6EFwJpm/arcgis/rest/services/TaxParcels/FeatureServer/0", "TAXMAPNO_1", "Address", 41.6822, -75.2738, [41.209, -75.526, 42.029, -75.022]],
  ["westmoreland", "Westmoreland", DEP, "PARCEL_ID", "PROPERTY_ADDRESS_1", 40.3319, -79.5566, [40.007, -79.931, 40.711, -78.953], "COUNTY_NAME='WESTMORELAND'"],
  ["wyoming", "Wyoming", PAS("WyomingCounty",2), "Pin", null, 41.5182, -76.099, [41.353, -76.314, 41.683, -75.698]],
  ["york", "York", PAS("YorkCounty",31), "PIDN", "PROPADR", 39.911, -76.7638, [39.691, -77.173, 40.258, -76.203]],
]; 
export const paRaw = () => Object.fromEntries(PA_ROWS.map(([k, n, url, id, addr, , , , scope]) => ["pa_" + k, {
  state: "PA", label: n + " County, PA", layerUrl: url, idField: id, pinIdField: true, ...(addr ? { addrField: addr, pinAddrField: true } : {}), ...(scope ? { scopeWhere: scope } : {}),
  help: n + " County parcels (county GIS). Search by parcel number" + (addr ? " or a site address." : "."),
}]));
export const paMap = () => Object.fromEntries(PA_ROWS.map(([k, , url, , , la, ln, bb, scope]) => ["pa_" + k, {
  state: "PA", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
