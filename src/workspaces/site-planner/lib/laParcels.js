/* NEW-1 (Louisiana, 2026-10-19) — Louisiana PARISH parcel sources wired in the 2026-10-19 "all remaining states" pass, kept OUT of counties.js so
 * parallel state sessions never collide there (the alabamaParcels.js pattern). Louisiana assesses by parish: keys drop the designation
 * (`la_ouachita`), labels keep it ("Ouachita Parish, LA"). The pre-existing 34 `la_*` rows stay hand-written in counties.js.
 * A parish with no row here or there has no usable public service and says so by name ("<Parish> Parish — no parcel data wired here
 * yet"): docs/STATEWIDE-PARCELS.md "## Louisiana parishes (2026-10-19)" has the per-parish table and what was searched for every gap.
 * Row: [slug, parish name, layer, idField (always pinned), scopeWhere|null, owner column published?, centre lat, lng, padded bbox, help].
 * bbox/centre are computed from public/geo/county-polygons.json (raw extent / scale, floored/ceiled to 2 dp), never hand-typed.
 * Provenance prose lives in laProvenance.js (build-time only, never shipped to the browser). */
const CO_OP = "https://services7.arcgis.com/rxjYSJmWllCcGWDd/arcgis/rest/services";
export const LA_ROWS = [
  ["claiborne", "Claiborne", `${CO_OP}/ParcelsClaiborne1803/FeatureServer/0`, "parcelnumb", null, 1, 32.8028, -92.9748, [32.58, -93.24, 33.02, -92.71],
    "Claiborne Parish parcels (a rural electric co-op's copy of the parish assessor roll, republished Dec 2025 — owner names current to its pull, not to today). Search by parcel ID."],
  ["richland", "Richland", `${CO_OP}/ParcelsRichland1803/FeatureServer/0`, "parcel_id", null, 1, 32.4190, -91.7332, [32.16, -92.04, 32.68, -91.43],
    "Richland Parish parcels (a rural electric co-op's copy of the parish assessor roll, republished Dec 2025 — owner names current to its pull, not to today). Search by parcel ID."],
  ["westcarroll", "West Carroll", `${CO_OP}/ParcelsWestCarroll1803/FeatureServer/0`, "PARCEL_ID", null, 1, 32.7998, -91.4412, [32.58, -91.63, 33.02, -91.25],
    "West Carroll Parish parcels (a rural electric co-op's copy of the parish assessor roll, republished Dec 2025 — owner names current to its pull, not to today). Search by parcel ID."],
  ["ouachita", "Ouachita", "https://services7.arcgis.com/MwglueBMxIOHOjKe/arcgis/rest/services/Public_Parcels/FeatureServer/0", "Parcel_ID", null, 0, 32.4975, -92.1570, [32.26, -92.42, 32.74, -91.9],
    "Ouachita Parish parcel boundaries (City of Monroe GIS, edited Feb 2026). Boundary and parcel ID only — the source publishes no owner. Search by parcel ID."],
];
export const laRaw = () => Object.fromEntries(LA_ROWS.map(([k, n, url, id, scope, , , , , help]) => ["la_" + k, {
  state: "LA", label: n + " Parish, LA", layerUrl: url, idField: id, pinIdField: true, ...(scope ? { scopeWhere: scope } : {}), help,
}]));
export const laMap = () => Object.fromEntries(LA_ROWS.map(([k, , url, , scope, , la, ln, bb]) => ["la_" + k, {
  state: "LA", center: [la, ln], zoom: 10, bbox: bb, mapServer: null, layerUrl: url, ...(scope ? { scopeWhere: scope } : {}),
}]));
