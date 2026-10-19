/* NEW-1 (B2317920) — verification record for the Idaho county parcel sources (build-time documentation, see countiesProvenance.js). */
const V = "2026-10-19";
const M = "MEASURED 2026-10-19: polygon layer; 8 parcels sampled evenly across the layer each resolved (by centroid, against the nationwide county polygons) to the county they are wired for, and a point query at each returned the same lot with its parcel id; plus point queries on a spread of interior and county-line points. ";
const agol = (publisherName, note) => ({ publisher: "own", publisherName, verifiedOn: V, verifiedNote: "Queried directly (host is *.arcgis.com). " + M + note + " B2317920" });
const relay = (publisherName, note) => ({ publisher: "own", publisherName, verifiedOn: V, verifiedNote: "Queried through the /gis-proxy relay (the sandbox cannot reach the host; CORS unread). " + M + note + " B2317920" });
export const IDAHO_VERIFICATION = {
  id_adams: agol("Adams County Assessor (ArcGIS Online)", "Parcel id + acreage; the layer carries no owner column."),
  id_bannock: agol("Bannock County (own ArcGIS Online org)", "Parcel id, owner (OwnerName), situs, GIS acreage; edited the day of the check."),
  id_bingham: relay("Bingham County (web.binghamid.gov, Public/Instrument_Numbers)", "Parcel id (RP_Num), owner, situs, acreage."),
  id_blaine: relay("Blaine County (maps.blainecountyid.gov Parcel_Information_Service_V2)", "Parcel number, owner (owner1), situs, acreage; 24,310 lots."),
  id_bonner: agol("Bonner County GIS (own ArcGIS Online org)", "PIN, owner (Parcel_Owner), property address, acreage; edited 2026-09-22. The title says TaxParcels2025, the service path TaxParcels2020."),
  id_bonneville: agol("Bonneville County (own ArcGIS Online org)", "PIN, owner, parcel address; edited 2026-10-08. No acreage column (measured acreage is computed from the polygon)."),
  id_boundary: agol("Boundary County parcels as published by Panhandle Health District 1 in the State of Idaho ArcGIS org", "Parcel id, owner as the ProVal mailing name (ps_mail_nm), property address, acreage; edited 2026-03-24."),
  id_butte: agol("Butte County GIS (own ArcGIS Online org)", "Parcel id, owner (OWNERSHIP), acreage; edited 2026-08-25. No situs column."),
  id_canyon: relay("Canyon County (maps.canyonco.org arcgisserver, Canyon_County_Public_Tax_Parcels)", "PIN, situs address, acreage, values; the county's public layer carries NO owner column. A 2018 third-party copy (AlertSense 'Tax Lots') does carry OwnerName but is eight years stale and was not used."),
  id_clearwater: agol("Clearwater County (own ArcGIS Online org)", "Parcel id, owner (OWNERSHIP), situs, acreage; edited 2026-10-04."),
  id_elmore: agol("Elmore County parcel roll as published in the City of Mountain Home ArcGIS org (PARCEL_DATA)", "Parcel id, owner (OWNERSHIP), property address, acreage; 20,811 lots; edited 2025-11-10. Publisher is the city, not the county — flagged for the owner."),
  id_franklin: agol("Franklin County parcels (fr_data ArcGIS org, 'fr_parcels_090226')", "PIN, owner (Owner1), legal address, legal acres; edited 2026-09-17. The Preston-hosted copy is older (2018)."),
  id_fremont: agol("Fremont County Assessor (ArcGIS Online org jfarnes_fremontidaho)", "Parcel id (PIDN) only: the layer carries no owner, situs or acreage column."),
  id_idaho: agol("Idaho County GIS (own ArcGIS Online org)", "Parcel id PS_PAR_15 (the Parcel_ID column is empty), owner (ML_OWNR_NM), property address, acreage; edited 2026-10-16."),
  id_jefferson: relay("Jefferson County GIS portal (gisportal.co.jefferson.id.us archost, Assessor/Historic_Parcels layer '2025')", "PIN, owner, property address, acres, tax year; the county's live Parcel_Fabric publishes only the parcel number. This is the county's 2025 roll snapshot, so it ages by a year at a time."),
  id_kootenai: relay("Kootenai County Assessor (map.kcgov.us ASSR_Dynamic_Layers_gisapp2022, layer 9 Parcel Polygon)", "PIN, owner (Name), situs (Loc_Addr), acres; 94,863 lots. The county's other ArcGIS host (gis.kcgov.us) answered 'could not access any server machines' during the check; map.kcgov.us is the working one. A 5,131-lot extract elsewhere on ArcGIS Online (KC_Parcels, north-end only) was rejected as partial."),
  id_latah: relay("Latah County (gis.latah.id.us/arcgis Parcels3)", "Parcel id, mailing name as owner (PM_MAIL_NM), property address."),
  id_lewis: agol("Lewis County parcels (rucon_admin 'POL Parcels' layer 4)", "Parcel id + acreage; no owner column. The publisher is a third-party admin account and the layer was last edited 2023-09 — flagged for the owner."),
  id_madison: relay("Madison County / City of Rexburg (madison.rexburg.org mrgis, Data/Parcels)", "Parcel id, owner (OWNER1), site address, assessor acreage; 17,769 lots."),
  id_owyhee: agol("Owyhee County layer inside the Idaho Transportation Dept. District 3 compilation ('D3_Parcels' layer 6)", "Parcel number, owner (OWNERSHIP), situs, acres. A 2023-05 compile by ITD, not the county: stale by design, flagged for the owner; no fresher public Owyhee layer was found."),
  id_shoshone: agol("Shoshone County parcels (ArcGIS Online org flo_publisher)", "Parcel id (ID), owner (OWNER); last edited 2020-12 — flagged for the owner; the county's current layer sits behind the Tax Commission's token-gated proxy."),
};
