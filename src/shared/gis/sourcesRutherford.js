/* NEW-1 (Rutherford County TN zoning, 2026-11-12) — THE RUTHERFORD ZONING GIS REGISTRY ROWS.
 *
 * Four governments, four token-free ArcGIS Online feature services (CORS-open, read straight from the browser), every count and edit date MEASURED 2026-11-12:
 *   · Rutherford County Planning     — Zoning_Hub_Data layer 2   (org 36I6IHIdr660pAyH), 2,065 polygons, edited 2026-10-28, WKID 2274
 *   · City of Murfreesboro           — City_Zoning_inc_Historic_Zoning_WFL1 layer 45 (org A5C0MR9xfkxVRwat; layers 0–43 are dated snapshots, 44 is another table), 4,346 polygons, edited 2024-04-09, WKID 3857
 *   · Town of Smyrna                 — Smyrna_Zoning layer 0     (org 36I6IHIdr660pAyH), 1,296 polygons, edited 2024-03-06, WKID 2274
 *   · City of La Vergne              — LaVergne_Zoning layer 0   (org 36I6IHIdr660pAyH), 579 polygons, edited 2024-03-06, WKID 2274
 * NOT used, on purpose: a third-party merged layer ("RutherfordCountyZoning", item eZ3RGx53Xjn5cGa6) — the four governments' own layers are the source.
 *
 * The layer rows in lib/tennesseeLayers.js read their URL and `where` from here, so the two cannot disagree. How a polygon is read, named and carded is lib/rutherfordZoning.js.
 * Fixtures and notes live in `sourceFixturesRutherford.js` (off the app bundle, same rule as every other row). Spread into `GIS_SOURCES` (sources.js) with one line. */

const ORG = "https://services.arcgis.com/36I6IHIdr660pAyH/arcgis/rest/services";
const MB_ORG = "https://services5.arcgis.com/A5C0MR9xfkxVRwat/arcgis/rest/services";
const base = { states: ["TN"], coverage: "rutherford", tier: "production", lastVerified: "2026-11-12", layerId: null, geometryType: "polygon" };

export const RUTHERFORD_SOURCES = {
  rutherfordCountyZoning: {
    key: "rutherfordCountyZoning", label: "Zoning districts (Rutherford County)", provider: "Rutherford County Planning — zoning (Zoning_Hub_Data)",
    serviceUrl: `${ORG}/Zoning_Hub_Data/FeatureServer/2`,
    fields: { code: "ZONEABBRV", district: "ZONE_DIST", family: "ZONING", effective: "EFF_DATE", case: "CASE_NO", case2: "CASE_NO_2", comment: "COMMENT" },
    where: "(ZONEABBRV IS NULL OR ZONEABBRV <> 'CITY') AND (ZONING IS NULL OR ZONING NOT IN ('CITY','ANNEXED'))",
    dataLastEdited: "2026-10-28",
    ...base,
    // Live 2026-11-12: 2,065 polygons, of which 258 are CITY / ANNEXED fill for incorporated ground (never a district) → 1,807 drawn. The 164-ac Capital Way EAC polygon is 132 vertices.
  },
  murfreesboroZoning: {
    key: "murfreesboroZoning", label: "Zoning districts (City of Murfreesboro)", provider: "City of Murfreesboro — GIS (zoning)",
    serviceUrl: `${MB_ORG}/City_Zoning_inc_Historic_Zoning_WFL1/FeatureServer/45`,
    fields: { code: "SubZoning", family: "GenZoning", type: "ParcelType", ordinance: "URL" },
    where: "ParcelType <> 'r' OR ParcelType IS NULL",
    dataLastEdited: "2024-04-09",
    ...base,
    // Live 2026-11-12: 4,346 polygons: 2,791 parcels ('p') drawn, 1,555 street right-of-way ('r') not drawn.
  },
  smyrnaZoning: {
    key: "smyrnaZoning", label: "Zoning districts (Town of Smyrna)", provider: "Town of Smyrna — GIS (zoning)",
    serviceUrl: `${ORG}/Smyrna_Zoning/FeatureServer/0`,
    fields: { district: "ZONING_DIST", id: "ZONE_ID", updated: "LastUpdate" },
    dataLastEdited: "2024-03-06",
    ...base,
    // Live 2026-11-12: 1,296 polygons. ZONING_DIST is an integer with a 24-value coded domain; codes 26–30 occur in the data and are NOT in the domain ("Unlisted").
  },
  lavergneZoning: {
    key: "lavergneZoning", label: "Zoning districts (City of La Vergne)", provider: "City of La Vergne — GIS (zoning)",
    serviceUrl: `${ORG}/LaVergne_Zoning/FeatureServer/0`,
    fields: { code: "Zoning_Typ" },
    dataLastEdited: "2024-03-06",
    ...base,
    // Live 2026-11-12: 579 polygons, 16 of the domain's 17 codes in use (R-3 … I-3, PDR).
  },
};

/* The county is a county-sized area (regional class); each city is one place (local class). */
export const RUTHERFORD_FIXTURE_REACH = {
  rutherfordCountyZoning: ["regional", "Rutherford County's own zoning — one county by definition; probing it in Memphis or Knoxville would assert a guaranteed zero."],
  murfreesboroZoning: ["local", "The City of Murfreesboro's zoning only."],
  smyrnaZoning: ["local", "The Town of Smyrna's zoning only."],
  lavergneZoning: ["local", "The City of La Vergne's zoning only."],
};
