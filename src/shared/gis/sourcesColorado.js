/* Colorado (CDPHE / ECMC / MHFD / CPW / Weld / Adams / Aurora) — GIS source rows, split out of sources.js (batch K stage 3, 2026-11-23, B2671306).
 * LOADS ON DEMAND, NOT in the Site route's first download: sourcePacks.js loads this pack with the lazy layer file(s) that read these rows (lazyLayerFiles.js `packs`),
 * and registers it into GIS_SOURCES (sources.js `registerSourcePack`). Rows are byte-identical to what sources.js held; nothing eager may read these keys
 * (test/sourcePacks.test.js sweeps for that). This file imports nothing so the dependency stays one-way. */

export const COLORADO_SOURCES = {

  cdpheSuperfund: {
    key: "cdpheSuperfund",
    label: "Colorado Superfund sites (CDPHE)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — HMWMD",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/CDPHE_Superfund/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "NAME", city: "CITY", status: "SiteStatus", pollutants: "POLLUTANTS", link: "CDPHE_LINK" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29", // re-probed for B2528688: 31 polygons, same fields, edited 2026-08-10; now also drawn by the Superfund Sites layer row (co_superfund)
    /* Only 31 statewide — and that is the honest number, not a clip: Colorado has ~30 Superfund
     * sites. None of the seven probe points hit one (correct; they are rare and mostly rural),
     * so the fixtures use the sites' own BOUNDARIES rather than a city point. Unlike the point
     * layers this is a POLYGON layer, which is what makes it worth carrying alongside the
     * national `epaCleanups` row: an EPA point tells you a site is "near", this tells you whether
     * the parcel is INSIDE one. */
  },

  cdpheBrownfields: {
    key: "cdpheBrownfields",
    label: "Colorado brownfields (CDPHE)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — HMWMD",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/CDPHE_Brownfield/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Site", addr: "Address", city: "City", county: "County", status: "SitStts", acres: "AreAcrs", landUse: "LndUsTy" },
    coverage: "colorado",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 133 statewide · Fort Collins 2. Sparse by nature — a brownfield is a
    // specific designated property, so most points return 0 and that is the correct answer.
  },

  // ---- Mile High Flood District — the Colorado local drainage-authority tier -----------
  // The Colorado counterpart of the HCFCD / BKDD / FBCDD families. MHFD (formerly UDFCD) covers
  // Adams, Arapahoe, Boulder, Broomfield, Denver, Douglas and Jefferson — which is where the
  // owner's Commerce City, Arapahoe and Broomfield sites all sit. Larimer, Weld and El Paso are
  // deliberately OUTSIDE it and each run their own criteria (coloradoRegions.CO_COUNTY_REGIME
  // already encodes that, and the mhfdBoundary fixtures below PROVE it against the live service).
  mhfdBoundary: {
    key: "mhfdBoundary",
    label: "Mile High Flood District boundary",
    provider: "Mile High Flood District (MHFD, formerly UDFCD)",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/BOUNDARY_(View)/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { areaAc: "area_ac", areaSqMi: "area_sqmi" },
    coverage: "Mile High Flood District (Adams, Arapahoe, Boulder, Broomfield, Denver, Douglas, Jefferson)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    /* The point-in-district test that decides which Colorado drainage regime governs — the exact
     * job `bkddBoundary` does in Texas. Live 2026-08-05, and it agrees with the county table
     * EXACTLY: Commerce City 1 · Denver 1 · Aurora 1 · Broomfield 1 (in); Greeley/Weld 0 ·
     * Fort Collins/Larimer 0 · Colorado Springs/El Paso 0 (out). The out-of-district fixtures are
     * as load-bearing as the in-district ones — a service that silently grew to cover Weld would
     * hand Weld sites MHFD criteria they are not subject to. */
  },

  mhfdWatersheds: {
    key: "mhfdWatersheds",
    label: "MHFD watershed delineation",
    provider: "Mile High Flood District (MHFD)",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/MHFDWatershedDelineation/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "UDFCD_NAM", id: "UDFCD_ID" },
    coverage: "Mile High Flood District (Denver metro)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 316 statewide · Commerce City 4 · Aurora 4 · Denver 3 · Broomfield 3.
  },

  mhfdOutfalls: {
    key: "mhfdOutfalls",
    label: "MHFD storm outfalls",
    provider: "Mile High Flood District (MHFD) — SWIMS infrastructure inventory",
    serviceUrl: "https://services3.arcgis.com/TCnvslgqrzhT2ZXG/arcgis/rest/services/INFRASTRUCTURE_(View)/FeatureServer/10",
    layerId: null,
    geometryType: "point",
    fields: { name: "outfall_name", ownedBy: "outfall_ownedby", maintainedBy: "outfall_maintainedby", jurisdiction: "outfall_jurisdiction" },
    coverage: "Mile High Flood District (Denver metro)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-08-05",
    // Live 2026-08-05: 13,773 statewide · Commerce City 4. Sparse by nature (an outfall is a
    // structure, not a network), so the fixture sits where one genuinely is.
  },

  // ===========================================================================
  // NEW-1 (B2528688, 2026-10-29) — THE COLORADO DUE-DILIGENCE FAMILY (industrial day-one checks).
  //
  // Every row below was LIVE-PROBED 2026-10-29: metadata read, statewide count taken, counts taken at the SEVEN-plus
  // fixture boxes in sourceFixtures.js (Denver · Commerce City · Aurora · Greeley · Fort Collins · Windsor · Erie ·
  // Colorado Springs · Pueblo · Grand Junction · Durango). Hosts and how each was reached:
  //   · ECMC (gisdnr.state.co.us, Colorado DNR's own ArcGIS Server) — the build sandbox's egress refuses it, so it was
  //     MEASURED through the planyr.io /gis-proxy relay on the branch preview, and the app reads it through the same relay.
  //     ⛔ This is the authoritative statewide ECMC set B242545 / B1422 named and could not reach: 124,462 well spots,
  //     244,856 flowline segments, 95,486 location footprints — NOT one of the county clips (Adams 6,319, Broomfield
  //     8,035) that coloradoRegions refused. The anti-clip fixtures below (Greeley ≥ 500 wells in a 10 km box) fail on any clip.
  //   · CDPHE, DRMS, CPW, OEDIT/OIT and the three counties' own orgs — ArcGIS Online, CORS-open (`*`), read directly.
  //   · Aurora's open-data server — relayed, measured through the relay.
  // State-wide rows declare `states: ["CO"]`; the county / city rows ALSO carry a `regions` area in their LAYER row
  // (coloradoLayers.js) so they are offered only inside their own county.
  // ===========================================================================
  ecmcWells: {
    key: "ecmcWells",
    label: "Oil & gas wells (ECMC)",
    provider: "Colorado Energy and Carbon Management Commission (ECMC; formerly COGCC) — via Colorado DNR GIS",
    serviceUrl: "https://gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/Wells_Public_ECMC/MapServer/0",
    layerId: null,
    geometryType: "point",
    fields: { api: "API_Label", status: "wellstat", cls: "well_class", operator: "Operator", county: "County", name: "WellName", spud: "spud_date", statusDate: "status_date", basin: "BASIN" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): 124,462 well spots statewide · 55,875 PA / 36,078 PR / 22,446 AL / 6,056 SI.
    // Greeley box 768 · Windsor 638 · Erie 447 · Brighton 295 · Durango 25 · Commerce City 10 · Denver 2.
  },
  ecmcFlowlines: {
    key: "ecmcFlowlines",
    label: "Oil & gas flowlines (ECMC)",
    provider: "Colorado Energy and Carbon Management Commission (ECMC) — flowline registrations (Forms 12 / 44), via Colorado DNR GIS",
    serviceUrl: "https://gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/ECMC_Pipes_Flow_Network_Public/MapServer/0",
    layerId: null,
    geometryType: "line",
    fields: { status: "Status", fluid: "FluidType", material: "MatType", size: "PipeSize", operator: "Company", form: "Form_Type", length: "Length_ft" },
    coverage: "colorado (statewide; operator-submitted off-location flowlines, produced-water and crude transfer lines)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): 244,856 segments statewide · Greeley box 692 · Durango 722 · Erie 596 · Brighton 530 · Windsor 369.
    // ⚠ Operator-submitted GIS, so position is as good as the operator's submission and a flowline that was never registered is NOT here:
    // an empty map is never proof there is no flowline (the Firestone 2017 house explosion was an unmapped, severed abandoned flowline).
  },
  ecmcLocations: {
    key: "ecmcLocations",
    label: "Oil & gas locations (ECMC pads)",
    provider: "Colorado Energy and Carbon Management Commission (ECMC) — Oil and Gas Location footprints (Form 2A), via Colorado DNR GIS",
    serviceUrl: "https://gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/ECMC_Locations_Public/MapServer/2",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "location_name", operator: "operator_name", status: "facility_status", form: "form_type", expires: "expire_date" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): 95,486 footprints · CL 49,721 / AC 33,059 / AL 12,702. Greeley box 382 · Windsor 243 · Erie 205 · Brighton 139 · Durango 26.
  },
  ecmcFacilities: {
    key: "ecmcFacilities",
    label: "Oil & gas facilities (ECMC)",
    provider: "Colorado Energy and Carbon Management Commission (ECMC) — facilities (tank batteries, compressors, gas plants, injection), via Colorado DNR GIS",
    serviceUrl: "https://gisdnr.state.co.us/arcgis/rest/services/ECMC_Public/Facilities_and_Pits_Public/MapServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "facility_name", type: "facility_type", status: "facility_status", operator: "operator_name", statusDate: "status_date" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): 18,633 records, 5,506 once the layer row leaves off Nonfacility, Domestic tap and Off-location flowline points (12,726 of the rest duplicate the Flowlines row) · Greeley box 80 · Erie 26 · Durango 1.
  },
  cdpheRcraCa: {
    key: "cdpheRcraCa",
    label: "RCRA corrective-action sites (Colorado)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — Hazardous Materials & Waste Management Division",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/RCRA_corrective_action/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "facility_names", status: "status", groundwater: "gw_impacts_Y_or_N", offsite: "offsite_impacts_Y_or_N", plume: "plume_dist_ft" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 188 statewide (layer edited 2026-08-27) · Denver box 12 · Commerce City 12 · Windsor 3 · Fort Collins 2 · Grand Junction 2 · Durango 2 · Pueblo 2.
  },
  cdpheInstControls: {
    key: "cdpheInstControls",
    label: "Institutional controls (Colorado)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — completed institutional controls filed with the county clerk",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/Institutional_Controls_PROD_local/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { site: "Site", type: "IC_Type", approved: "Approved", description: "Desc_", acres: "Acres" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 336 parcels statewide (layer edited 2026-08-24) · Commerce City box 26 · Denver 17 · Pueblo 9 · Colorado Springs 5 · Grand Junction 2 · Durango 1.
  },
  cdpheClosedLandfills: {
    key: "cdpheClosedLandfills",
    label: "Closed landfills (Colorado)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — Solid Waste, closed landfill inventory",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/ClosedLandfillsColorado/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Facility_Name", city: "City", county: "County", suspectRelease: "Known_Suspect_Release" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 244 statewide (layer edited 2025-01-27) · Erie box 5 · Commerce City 2 · Aurora 2 · Denver 1 · Fort Collins 1 · Durango 1.
  },
  cdpheSolidWaste: {
    key: "cdpheSolidWaste",
    label: "Solid waste facilities (Colorado)",
    provider: "Colorado Dept. of Public Health & Environment (CDPHE) — Solid Waste Information System (SWIS)",
    serviceUrl: "https://services3.arcgis.com/66aUo8zsujfVXRIT/arcgis/rest/services/Solid_Waste_Facilities/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "Facility", type: "Type", status: "Status", city: "City", county: "County", category: "Category" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 868 statewide (layer edited 2026-08-24) · Commerce City box 44 · Colorado Springs 24 · Grand Junction 15 · Greeley 14 · Fort Collins 12 · Denver 10.
  },
  drmsUndermined: {
    key: "drmsUndermined",
    label: "Undermined areas (Colorado DRMS)",
    provider: "Colorado Division of Reclamation, Mining and Safety (DRMS) — Mine Subsidence Protection Program, statewide undermined areas with a 100 ft buffer",
    serviceUrl: "https://services7.arcgis.com/ZZPO1K5xRbz1PSYQ/arcgis/rest/services/Undermined_Areas_Statewide_100ft_buffer_2023/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { mine: "MINE_NAME", type: "TYPE", description: "F_DESC", buffer: "BUFF_DIST" },
    coverage: "colorado (statewide; coal and clay mining districts — Erie/Lafayette/Louisville, Colorado Springs, Durango)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 1,035 polygons statewide (layer edited 2026-02-24) · Erie box 13 · Durango 13 · Colorado Springs 1 · Aurora 1. Zero in Commerce City / Denver / Greeley is correct, not a clip.
  },
  cpwPrairieDog: {
    key: "cpwPrairieDog",
    label: "Black-tailed prairie dog colony potential (CPW)",
    provider: "Colorado Parks and Wildlife (CPW) — species activity mapping (Black-tailed Prairie Dog Colony Potential Occurrence)",
    serviceUrl: "https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWSpeciesData/FeatureServer/24",
    layerId: null,
    geometryType: "polygon",
    fields: { potential: "PotentialO" },
    coverage: "colorado (eastern plains and Front Range within the species' range)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 18 polygons (H / M / L) · every Front Range box ≥ 1, Grand Junction and Durango 0 (outside the range — correct).
  },
  cpwEagleNests: {
    key: "cpwEagleNests",
    label: "Bald eagle nest sites (CPW)",
    provider: "Colorado Parks and Wildlife (CPW) — species activity mapping (Bald Eagle Nest Sites)",
    serviceUrl: "https://services5.arcgis.com/ttNGmDvKQA7oeDQ3/arcgis/rest/services/CPWSpeciesData/FeatureServer/1",
    layerId: null,
    geometryType: "polygon",
    fields: { status: "STATUS" },
    coverage: "colorado (statewide)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 917 nest-site polygons (ACTIVE / INACTIVE / DESTROYED / UNKNOWN; edited 2026-05-07) · Brighton box 10 · Greeley 6 · Fort Collins 6 · Windsor 5 · Durango 4.
  },
  nrhpCo: {
    key: "nrhpCo",
    label: "National Register of Historic Places (Colorado)",
    provider: "National Park Service — National Register of Historic Places (via Esri Federal Data)",
    serviceUrl: "https://services2.arcgis.com/FiaPA4ga0iQKduv3/arcgis/rest/services/nrhp_points_v1/FeatureServer/0",
    layerId: null,
    geometryType: "point",
    fields: { name: "RESNAME", type: "ResType", city: "City", county: "County", listed: "CertDate" },
    coverage: "colorado (the national NPS layer; the Colorado row is the same service as the Georgia row)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 74,636 nationally (layer edited 2026-10-28) · Denver box 232 · Pueblo 52 · Colorado Springs 50 · Fort Collins 23 · Greeley 14.
  },
  critHabitatCo: {
    key: "critHabitatCo",
    label: "USFWS critical habitat (Colorado)",
    provider: "U.S. Fish & Wildlife Service — Final Critical Habitat",
    serviceUrl: "https://services.arcgis.com/QVENGdaPbd4LUkLV/ArcGIS/rest/services/USFWS_Critical_Habitat/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "comname", sci: "sciname", status: "status", unit: "unitname" },
    coverage: "colorado (the national USFWS layer; the Colorado row is the same service as the Georgia row)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 803 final-designation features nationally (layer edited 2026-10-21). In Colorado it is sparse by nature: Grand Junction box 3 (Colorado River fish), Colorado Springs 1.
  },
  enterpriseZonesCo: {
    key: "enterpriseZonesCo",
    label: "Colorado Enterprise Zones",
    provider: "Colorado Office of Economic Development and International Trade (OEDIT), via the State of Colorado OIT GIS org",
    serviceUrl: "https://services3.arcgis.com/DgjqnJA1rgO92Soi/arcgis/rest/services/Enterprise_Zones_Current/FeatureServer/2",
    layerId: null,
    geometryType: "polygon",
    fields: { admin: "Admin_Zone", statutory: "Statutory_Zone", start: "start_date", end: "end_date" },
    coverage: "colorado (statewide; 19 zones, 2026-2035 designation)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 19 zones (layer edited 2026-10-29) · Commerce City box 2 · Aurora 2 · Denver / Greeley / Fort Collins / Grand Junction / Durango / Pueblo / Colorado Springs 1 each.
  },

  // ---- County and city rows (offered only inside their own county / city; `regions` is on the LAYER row) ----
  weldZoning: {
    key: "weldZoning",
    label: "Weld County zoning (unincorporated)",
    provider: "Weld County, Colorado (the county's own ArcGIS Online org)",
    serviceUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Zoning_open_data/FeatureServer/38",
    layerId: null,
    geometryType: "polygon",
    fields: { zoning: "ZONING", master: "MASTERZ", caseName: "CASE_NAME", year: "YEAR", asOf: "As_of_date" },
    coverage: "Weld County, CO (unincorporated; cities zone their own ground)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 496 districts (layer edited 2026-10-28) · Greeley box 101 · Brighton 36 · Windsor 18 · Erie 10. One district is the county-wide "A" (Agricultural) base polygon.
  },
  weldGrowthBoundary: {
    key: "weldGrowthBoundary",
    label: "Weld County urban growth boundaries",
    provider: "Weld County, Colorado (the county's own ArcGIS Online org)",
    serviceUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Urban_Growth_Boundary_open_data/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { town: "TOWNNAME", district: "DISTRICT" },
    coverage: "Weld County, CO",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 5 (Brighton · Erie · Greeley · Lochbuie · Pierce) · Greeley box 1 · Erie 1 · Brighton 1.
  },
  weldIga: {
    key: "weldIga",
    label: "Weld County intergovernmental agreement areas",
    provider: "Weld County, Colorado (the county's own ArcGIS Online org)",
    serviceUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Intergovernmental_Agreement_open_data/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { town: "TOWNNAME", buffered: "BUFFERED", date: "DATE_" },
    coverage: "Weld County, CO",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 21 municipalities' IGA areas · Windsor box 4 · Greeley 3 · Brighton 1.
  },
  weldAirportOverlay: {
    key: "weldAirportOverlay",
    label: "Greeley-Weld airport overlay district",
    provider: "Weld County, Colorado (the county's own ArcGIS Online org)",
    serviceUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Airport_Overlay_open_data/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "Airport_Ov" },
    coverage: "Weld County, CO (one overlay district)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 1 polygon (layer edited 2020-12-02) · Greeley box 1.
  },
  weldOilGasAssessment: {
    key: "weldOilGasAssessment",
    label: "Weld County oil & gas location assessments (WOGLA)",
    provider: "Weld County, Colorado — Oil and Gas Location Assessment permits (the county's own ArcGIS Online org)",
    serviceUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Weld_Oil_and_Gas_Location_Assessment_open_data/FeatureServer/37",
    layerId: null,
    geometryType: "point",
    fields: { id: "B1_ALT_ID", status: "B1_APPL_STATUS", type: "B1_PER_SUB_TYPE" },
    coverage: "Weld County, CO",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 809 county permit records (layer edited 2026-10-28) · Brighton box 7 · Erie 5 · Greeley 3 · Windsor 2. LOCAL land-use permits — not ECMC's well register.
  },
  weldRoadRow: {
    key: "weldRoadRow",
    label: "Weld County road right-of-way",
    provider: "Weld County, Colorado (the county's own ArcGIS Online org)",
    serviceUrl: "https://services.arcgis.com/ewjSqmSyHJnkfBLL/arcgis/rest/services/Road_Right_of_Ways_open_data/FeatureServer/23",
    layerId: null,
    geometryType: "polygon",
    fields: { road: "ROADNAME", status: "ROW_STAT", width: "ROW_WIDTH", doc: "DOC_NUM" },
    coverage: "Weld County, CO (county roads)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 5,627 right-of-way polygons (layer edited 2026-10-28) · Greeley box 357 · Windsor 207 · Erie 85 · Brighton 66.
  },
  adamsZoning: {
    key: "adamsZoning",
    label: "Adams County zoning (unincorporated)",
    provider: "Adams County, Colorado — county GIS (the county's own ArcGIS Online org)",
    serviceUrl: "https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Zoning/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { zone: "ZONE_", city: "CITY_NAME", link: "LINK" },
    coverage: "Adams County, CO (unincorporated zoning; incorporated cities are labelled by city name)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 1,265 polygons (layer edited 2026-08-30) · Commerce City box 336 (city-labelled) · Brighton 60 · Aurora 10.
  },
  adamsAviation: {
    key: "adamsAviation",
    label: "Adams County aviation overlays (DEN)",
    provider: "Adams County, Colorado — county GIS (the county's own ArcGIS Online org)",
    serviceUrl: "https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Aviation_Overlays/FeatureServer/1",
    layerId: null,
    geometryType: "polygon",
    fields: { name: "Name", comments: "Comments" },
    coverage: "Adams County, CO (4 overlay areas: height, DIA noise, Front Range noise, airport influence)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 4 polygons (Height · DIA Noise 60 DNL · Front Range Noise 60 DNL · AIZ; edited 2026-10-25) · Commerce City box 1 · Aurora 1 · Brighton 1.
  },
  adamsLandfills: {
    key: "adamsLandfills",
    label: "Adams County landfills and fill sites",
    provider: "Adams County, Colorado — county GIS (the county's own ArcGIS Online org)",
    serviceUrl: "https://services3.arcgis.com/4PNQOtAivErR7nbT/arcgis/rest/services/Landfills/FeatureServer/0",
    layerId: null,
    geometryType: "polygon",
    fields: { id: "LANDFILL", type: "TYPE", caseName: "CASENAME", opened: "OPENDATE", closed: "CLOSEDATE" },
    coverage: "Adams County, CO",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29: 203 polygons (solid-waste, inert-fill, construction-debris and sludge sites; edited 2026-08-30) · Commerce City box 101 · Brighton 4.
  },
  auroraAirportNoise: {
    key: "auroraAirportNoise",
    label: "Airport noise contours (Aurora)",
    provider: "City of Aurora, Colorado — GIS open data (Airport LDN: Buckley SFB, Denver International, Centennial, Colorado Air and Space Port)",
    serviceUrl: "https://ags.auroragov.org/aurora/rest/services/OpenData/MapServer/25",
    layerId: null,
    geometryType: "polygon",
    fields: { airport: "NAME", contour: "LOUDNESS_I" },
    coverage: "Aurora, CO and its airports' influence areas",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): 25 contour polygons · Aurora box 5.
  },
  auroraBuckleyApz: {
    key: "auroraBuckleyApz",
    label: "Buckley SFB accident potential zones (Aurora)",
    provider: "City of Aurora, Colorado — GIS open data (Buckley APZ polygons)",
    serviceUrl: "https://ags.auroragov.org/aurora/rest/services/OpenData/MapServer/26",
    layerId: null,
    geometryType: "polygon",
    fields: { zone: "CRASH_ZONE" },
    coverage: "Aurora, CO (Buckley Space Force Base)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): polygons CZ / APZ I / APZ II, north and south runway ends · Aurora box 9.
  },
  auroraZoning: {
    key: "auroraZoning",
    label: "Aurora zoning districts",
    provider: "City of Aurora, Colorado — GIS open data (Zoning)",
    serviceUrl: "https://ags.auroragov.org/aurora/rest/services/OpenData/MapServer/20",
    layerId: null,
    geometryType: "polygon",
    fields: { district: "Dist_Name", name: "NAME", effective: "EFFECTIVE_DATE", case: "ZONING_CASE_NUMBER" },
    coverage: "Aurora, CO (city limits)",
    states: ["CO"],
    tier: "production",
    lastVerified: "2026-10-29",
    // Live 2026-10-29 (through the relay): Aurora box 511.
  },
};

/* Fixture-reach overrides for these rows stay in sources.js SOURCE_FIXTURE_REACH (an audit-only table); nothing to register here. */
export const COLORADO_FIXTURE_REACH = {};
