/* NEW-1 (B2365360) — verification record for the Arizona county parcel sources (build-time documentation, see countiesProvenance.js). */
const V = "2026-10-19";
const M = "MEASURED 2026-10-19: polygon layer; 24 parcels sampled evenly across the layer each resolved (by centroid, against the nationwide county polygons) to the county they are wired for (the only exceptions sat within 0.6 km of the generalised county line) and a point query at each re-found the same lot with its parcel id; plus point queries on 7 spread interior points and up to 3 county-line points (most of Arizona is public, tribal or forest land with no tax parcels, so many spread points correctly return nothing). ";
const adwr = (note) => ({ publisher: "own", publisherName: "Arizona Department of Water Resources parcel compile ('Parcel layers displayed in ADWR applications', ArcGIS Online org C34zQ7veRS0V1t04, Parcels FeatureServer)", verifiedOn: V, verifiedNote: "Queried directly (host is *.arcgis.com). Layer last edited 2026-04-21. " + M + note + " B2365360" });
const relay = (publisherName, note) => ({ publisher: "own", publisherName, verifiedOn: V, verifiedNote: "Queried through the /gis-proxy relay (the sandbox cannot reach the host; CORS unread), measured on the PR preview deploy. " + M + note + " B2365360" });
const own = (publisherName, note) => ({ publisher: "own", publisherName, verifiedOn: V, verifiedNote: "Queried directly (host is *.arcgis.com). " + M + note + " B2365360" });
export const ARIZONA_VERIFICATION = {
  az_apache: adwr("Parcel id (APN), owner, situs, acres; 57,679 lots. County-published copies on ArcGIS Online are older (2020) or partial (4,539 lots), so the ADWR layer is the one wired."),
  az_cochise: adwr("Parcel id, owner, situs, acres; 122,935 lots. The county's own Cad_Parcel_Geometry layer (124,894 lots, edited 2026-10-19) is fresher but carries only the APN and tax area, no owner, so it was not used."),
  az_coconino: own("Coconino County GIS (own ArcGIS Online org, 'Coconino County Parcels Public View')", "APN, owner (OWNERNAME), situs, tax account; 78,591 lots; edited 2026-10-17. Fresher than the ADWR copy (78,368 lots, April)."),
  az_gila: adwr("Parcel id, owner, situs, acres; 39,656 lots. The only other Gila layers on ArcGIS Online are a district's partial copy (extent ~12 miles wide) and a 2020 city extract."),
  az_graham: own("Graham County GIS (own ArcGIS Online org, 'Graham County Parcels New' layer 7 'Parcels1')", "Parcel number, owner (NAME1), GIS and legal acres; 19,233 lots; edited 2026-10-15. Situs is published as separate street parts, so no single address column is wired."),
  az_greenlee: adwr("Parcel id, owner, situs, acres; 4,706 lots."),
  az_lapaz: adwr("Parcel id, owner, situs, acres; 19,336 lots. Two samples fall on the Colorado River generalised line (no Arizona polygon), which is the river boundary, not a misroute."),
  az_mohave: relay("Mohave County Assessor / GIS (mcgis.mohave.gov, PARCELS MapServer layer 14 'ParcelQueryLayer')", "Parcel number (PARCEL, 344-17-007 style), owner, situs, parcel size; 267,445 lots; returned extent sits inside Arizona. The only other public Mohave layer on ArcGIS Online is a 71-lot export."),
  az_navajo: own("Navajo County GIS (own ArcGIS Online org, 'Parcels')", "APN, owner, situs, acreage; 86,855 lots; edited 2026-10-19. Fresher than the ADWR copy (86,380 lots, April)."),
  az_pima: adwr("Parcel id, owner, situs, acres; 445,971 lots. Pima County's own server (gisdata.pima.gov, GISOpenData/LandRecords layer 12) was not used: it is not on ArcGIS Online, the open-data layers are dated 2021-2022, and the ADWR copy is as current."),
  az_santacruz: adwr("Parcel id, owner, situs, acres; 43,189 lots."),
  az_yavapai: own("Yavapai County GIS (own ArcGIS Online org, 'Parcels' layer 1)", "Parcel label (the county's readable APN, 106-34-109 style; PARCEL_ID is the 13-digit unique key), owner (NAME; blank on 8,262 lots), situs, acres; 187,921 lots; edited 2026-10-17. ADWR does not hold Yavapai."),
  az_yuma: adwr("Parcel id, owner, situs, acres; 96,848 lots. Yuma County's own server (arcgis.yumacountyaz.gov YC_Parcels) was not needed."),
};
