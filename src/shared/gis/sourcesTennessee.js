/* Tennessee (TDEC / THC / state screening rows; Rutherford zoning lives in sourcesRutherford.js) — GIS source rows, split out of sources.js (batch K stage 3, 2026-11-23, B2671306).
 * LOADS ON DEMAND, NOT in the Site route's first download: sourcePacks.js loads this pack with the lazy layer file(s) that read these rows (lazyLayerFiles.js `packs`),
 * and registers it into GIS_SOURCES (sources.js `registerSourcePack`). Rows are byte-identical to what sources.js held; nothing eager may read these keys
 * (test/sourcePacks.test.js sweeps for that). This file imports nothing so the dependency stays one-way. */

export const TENNESSEE_SOURCES = {

  /* NEW-1 (Tennessee industrial due-diligence layers, B2521584, 2026-10-29) — THE TENNESSEE SCREENING ROWS.
   * Every endpoint was read and queried live on 2026-10-29 from the build sandbox (reachable, answers `f=json` and a point query,
   * `access-control-allow-origin: *`, production host — no /Test/ path) and each is published by the agency that owns the fact:
   * TDEC (Tennessee Department of Environment & Conservation) through its own ArcGIS Online org (`bPacKTm9cauMXVfn`), NPS, USFWS
   * and USGS. Third-party and personal-account copies of the same data were REJECTED on provenance (the "TN_Sinkholes" layer on a
   * personal account is built from a hobbyist database; "CONUS Karst" is a personal re-host of USGS OFR 2014-1156).
   * The tdeconline.tn.gov rows (remediation sites, USTs, landfills, oil & gas wells, the Construction General Permit's restricted
   * waters, hydrologic determinations, dams) are the state's own ArcGIS Server — the build sandbox cannot reach any *.tn.gov host,
   * so they ride the same-origin /gis-proxy relay and were MEASURED through planyr.io (see their rows below). */
  /* TDEC Division of Remediation — Drycleaner Environmental Response Program (DCERP): every drycleaner registered with the program
   * since 1996 (pick-up-only shops excluded). 761 facilities; "DCERP Response Site" in COMMENTS = TDEC has worked a release there,
   * "Registration only" = on the program's list with no release work. Owner of record: TDEC-DOR (copyright line: Alison Hensley). */
  drycleanersTn: {
    key: "drycleanersTn",
    label: "Known drycleaners (Tennessee DCERP)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Remediation, Drycleaner Environmental Response Program",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/Known_Tennessee_Drycleaners/FeatureServer/2",
    layerId: null,
    geometryType: "point",
    fields: { name: "FACILITY_N", address: "FACILITY_A", city: "CITY", county: "COUNTY_NAM", id: "DCERP_ID", comments: "COMMENTS" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2026-02-26",
    lastVerified: "2026-10-29",
  },
  /* TDEC DWR — Municipal Separate Storm Sewer System (MS4) NPDES permit areas: the cities/counties whose own stormwater and
   * post-construction (including stream-buffer) rules apply on top of the state's Construction General Permit. 88 areas. */
  ms4Tn: {
    key: "ms4Tn",
    label: "MS4 permit areas (Tennessee DWR)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Water Resources, MS4 permit areas",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/MS4_Areas/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAME", permit: "PERMIT_NUM", verified: "VERIFIED" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2026-08-18",
    lastVerified: "2026-10-29",
  },
  /* TDEC DWR — 2026 Water Quality Assessment, STREAM assessment units (5,836 polylines): the spatial companion of the EPA-approved
   * "Tennessee 2026 List of Impaired and Threatened Streams". ATTAINMENT = Fully Supporting / Not Supporting / Threatened / Not Assessed
   * (and the "(Evaluated)" variants). The CAUSE of an impairment is in the separate Potential Sources table, not on the line. */
  wqaTn: {
    key: "wqaTn",
    label: "Water quality assessment — streams (Tennessee DWR, 2026)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Water Resources, 2026 Water Quality Assessment",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/Water_Quality_Assessment_2026/FeatureServer/9",
    layerId: null,
    geometryType: "line",
    fields: { name: "ASSESSMENT_UNIT_NAME", where: "LOCATION_DESCRIPTION", attainment: "ATTAINMENT", basin: "NAME8", type: "WATER_TYPE" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2026-08-13",
    lastVerified: "2026-10-29",
  },
  /* TDEC DWR — Public Water System service area boundaries (447 systems): the system that is permitted to serve a point (PWSID,
   * owner type, population served, link to the system's TDEC Drinking Water Watch page). A service-area line is the system's
   * declared territory, NOT proof of a main at the property line. */
  pwsTn: {
    key: "pwsTn",
    label: "Public water system service areas (Tennessee DWR)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Water Resources, public water system service areas",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/TN_Public_Water_System_Service_Area_Boundaries_WFL1/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { id: "PWSID", name: "MA_NAME", population: "PL_POPL", source: "PL_PSRC", link: "DWW_Link" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2024-10-01",
    lastVerified: "2026-10-29",
  },
  /* TDEC Division of Natural Areas — State Natural Areas (Natural Areas Preservation Act of 1971): 93 designated areas, public view.
   * Rutherford County's cedar glades (Vine, Flat Rock, Gattinger's, Lane) are the ones an industrial buyer in Middle Tennessee meets. */
  snaTn: {
    key: "snaTn",
    label: "State Natural Areas (Tennessee DNA)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Natural Areas",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/DNA_SNA_Boundaries_view/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "SNA_NAME", acres: "CALC_ACRES", url: "URL" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2026-10-13",
    lastVerified: "2026-10-29",
  },
  /* TDEC Division of Natural Areas — designated State Scenic Rivers (Tennessee Scenic Rivers Act of 1968): 25 river-corridor
   * polygons with the Act's class (Class I Free-flowing … Class III Partially developed). Edited 2023-09-13. */
  scenicTn: {
    key: "scenicTn",
    label: "State Scenic Rivers (Tennessee DNA)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Natural Areas, Tennessee Scenic Rivers Program",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/DNA_Scenic_Rivers_PolyEDIT_SEP23_view/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "Site_name", designation: "DESIGNATIO", miles: "GISMILES", description: "DESCRIPTIO" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2023-09-13",
    lastVerified: "2026-10-29",
  },
  /* The three federal Tennessee rows below read the SAME national services as the Georgia rows (`nrhp`, `critHabitat`,
   * `cemeteries`) — their own registry keys because the state scope is part of the row (a Georgia site must not be offered
   * the Tennessee copy and vice versa). Live 2026-10-29: Nashville box 41 NRHP points; Christiana bbox 4 critical-habitat units. */
  nrhpTn: {
    key: "nrhpTn",
    label: "National Register of Historic Places (Tennessee)",
    provider: "National Park Service — National Register of Historic Places (via Esri Federal Data)",
    serviceUrl: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/nrhp_points_v1/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "RESNAME", type: "ResType", city: "City", county: "County", listed: "CertDate" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2026-10-28",
    lastVerified: "2026-10-29",
  },
  critHabitatTn: {
    key: "critHabitatTn",
    label: "USFWS critical habitat (Tennessee)",
    provider: "U.S. Fish & Wildlife Service — Final Critical Habitat",
    serviceUrl: "https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/USFWS_Critical_Habitat/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "comname", sci: "sciname", status: "listing_status", unit: "unitname" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2026-10-21",
    lastVerified: "2026-10-29",
  },
  cemeteriesTn: {
    key: "cemeteriesTn",
    label: "Cemeteries (USGS / GNIS, Tennessee)",
    provider: "U.S. Geological Survey — National Map Structures (GNIS cemeteries)",
    serviceUrl: "https://carto.nationalmap.gov/arcgis/rest/services/structures/MapServer/37",
    layerId: null,
    geometryType: "point",
    fields: { name: "NAME", city: "CITY", state: "STATE" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    lastVerified: "2026-10-29",
  },

  /* TDEC Division of Remediation — the "DOR Sites" register: every site in a TDEC remediation program (voluntary cleanup, State Superfund funded by the
   * state's Hazardous Waste Remedial Action fund or by the liable party, EPA NPL and non-NPL, Department of Defense, pre-remedial evaluation, the drycleaner
   * program). 825 OPEN sites, one point each with acres, address, TDEC field office and — for listed Superfund sites — the promulgation date. TDEC's own
   * ArcGIS Online org (the service behind its "TDEC Remediation Sites" viewer, whose layer on tdeconline.tn.gov refuses the relay), CORS-open. ⚠ Last edited
   * 2024-06-25 — said on the row's tooltip; a site opened since is not on it. */
  dorSitesTn: {
    key: "dorSitesTn",
    label: "Remediation sites (Tennessee TDEC DOR)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Remediation, DOR Sites",
    serviceUrl: "https://services5.arcgis.com/bPacKTm9cauMXVfn/arcgis/rest/services/DOR_Sites/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { id: "DOR_Site_Id", name: "DOR_Site_Name", program: "Program", status: "Status", address: "Address", city: "City", county: "County", acres: "Acres", promulgated: "Promulgated" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    dataLastEdited: "2024-06-25",
    lastVerified: "2026-10-29",
  },
  /* ---- the State of Tennessee's own servers, reached through the same-origin /gis-proxy relay ----
   * `maps.tdec.tn.gov` (TDEC's hosting server) and `tnmap.tn.gov` (the State's GIS clearinghouse) answer the relay; MEASURED THROUGH planyr.io on
   * 2026-10-29 (build 88b0334). ⛔ `tdeconline.tn.gov` — TDEC's other server, home of its remediation-site, UST, oil & gas, Construction General
   * Permit restricted-water, hydrologic-determination and dam layers — answers the relay with HTTP 403 (it refuses Cloudflare's addresses) and is
   * unreachable from the build environment, so none of those layers is wired (docs/TENNESSEE-LAYERS.md). */
  /* TDEC Solid Waste — permitted Tennessee landfills (111 operating facilities, Class I–IV by the kind of waste), one point per facility with its TDEC
   * site id, county, city and status. maps.tdec.tn.gov hosts it; ArcGIS Online lists the same service as owned by TDEC's Bureau of Environment. */
  landfillsTn: {
    key: "landfillsTn",
    label: "Permitted landfills (Tennessee TDEC)",
    provider: "Tennessee Department of Environment & Conservation (TDEC) — Division of Solid & Hazardous Waste Management, permitted landfills",
    serviceUrl: "https://maps.tdec.tn.gov/hosting/rest/services/Permitted_Tennessee_Landfills/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "PRIMARY_NAME", cls: "LANDFILL_CLASS", status: "STATUS", county: "COUNTY", city: "CITY", address: "ADDRESS", id: "TDEC_SITE_ID" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* Tennessee Historical Commission — the recorded historic-sites SURVEY inventory (186,319 points; paper survey forms digitised, "conversion … is
   * in progress so the whole state is not available yet" — the service's own words). Survey records, NOT National Register listings. State of
   * Tennessee clearinghouse (tnmap.tn.gov), service HISTORICAL/HISTORICAL_COMMISSION layer 0. */
  thcSitesTn: {
    key: "thcSitesTn",
    label: "Recorded historic sites (Tennessee Historical Commission)",
    provider: "Tennessee Historical Commission (THC) — historic sites survey, via the State of Tennessee GIS clearinghouse",
    serviceUrl: "https://tnmap.tn.gov/arcgis/rest/services/HISTORICAL/HISTORICAL_COMMISSION/MapServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "COMNAME", histName: "HISTNAME", address: "PROPADDR", city: "CITY", county: "COUNTY", built: "DATECONST", origUse: "ORIGUSE", presUse: "PRESUSE" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
  /* THC / State Historic Preservation Office — National Register of Historic Places BOUNDARIES for Tennessee (2,047 polygons: a district's footprint,
   * not a single point). The sibling of the NPS point layer `nrhpTn`; same State clearinghouse. */
  nrhpBoundsTn: {
    key: "nrhpBoundsTn",
    label: "National Register boundaries (Tennessee)",
    provider: "Tennessee Historical Commission (State Historic Preservation Office) — National Register boundaries, via the State of Tennessee GIS clearinghouse",
    serviceUrl: "https://tnmap.tn.gov/arcgis/rest/services/HISTORICAL/NATIONAL_REGISTER_TN/MapServer/2",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "Resource_Name", address: "Address", county: "County", city: "City", listed: "Listed_Date", multiple: "Multiple_Name", nhl: "NHL_Date" },
    coverage: "tennessee",
    states: ["TN"],
    tier: "production",
    lastVerified: "2026-10-29",
  },
};

/* Fixture-reach overrides for these rows stay in sources.js SOURCE_FIXTURE_REACH (an audit-only table); nothing to register here. */
export const TENNESSEE_FIXTURE_REACH = {};
