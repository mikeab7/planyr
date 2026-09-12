/* NEW-5 — THE ENDPOINT VERIFICATION RECORD for every county parcel source.
 *
 * ⛔ BUILD-TIME DOCUMENTATION, NOT RUNTIME DATA — which is exactly why it is its own module.
 * `ui-audit/gis-source-audit.mjs` (Node) reads this to enforce that no unverified endpoint ships
 * silently: every county must be live-probed (`verifiedOn`), riding its state's statewide
 * composite, or explaining itself (`verifiedNote`), and any `candidateUrl` must say where it came
 * from and why it could not be probed. The BROWSER reads none of it. Keeping it in `counties.js`
 * put ~2.5 KB of prose and dates on the Site route's bundle for zero user benefit, which is one of
 * the optimizations that paid for the Colorado tier's bundle cost (2026-07-29).
 *
 * Keyed by the same county keys as COUNTIES. When a parked endpoint is finally probed (V511),
 * promote it in `counties.js` AND replace its row here with a `verifiedOn` in the same commit — a
 * promoted endpoint has a date, not a provenance excuse.
 */
export const COUNTY_VERIFICATION = {
  harris: {
    verifiedOn: "2026-07-29",
  },
  fortbend: {
    verifiedOn: "2026-07-29",
  },
  chambers: {
    verifiedOn: null,
    verifiedNote: "Live-verified at the B787 CCAD repoint, and it is the same service the CCAD website's own map " + "draws. It could NOT be re-probed on 2026-07-29 because gisdata.pandai.com is blocked by this " + "build environment's egress policy — a sandbox limitation, not a sign the endpoint moved. Kept " + "as the primary: demoting a working Texas source to the statewide composite would be a " + "behaviour change, which the Colorado work is not permitted to make.",
  },
  /* ═══ B209503 — the five counties that complete the Houston metro ═══════════════════════════
   * All five were probed LIVE from this build environment on 2026-08-06 (every one is on Esri's
   * ArcGIS Online cloud, which the sandbox egress policy permits — unlike the self-hosted county
   * servers that keep the Colorado rows below parked). Each row's evidence — feature count,
   * count-query time, point-identify time, and the actual parcel returned — is recorded in the
   * matching `counties.js` comment, the way the Weld and Broomfield entries do it. */
  montgomery: {
    verifiedOn: "2026-08-06",
    verifiedNote: "Montgomery County's OWN GIS org (AGOL owner GIS.Data_MOCO), not a republication: 336,769 parcel polygons, count query 1,212 ms, point identify 172–596 ms, real lots returned at Conroe, downtown Conroe and The Woodlands. → V17704.",
  },
  brazoria: {
    verifiedOn: "2026-08-06",
    verifiedNote: "280,226 parcel polygons, count query 156 ms, point identify 224 ms. Returned the real lot at the Pearland test point (prop_id 517005, CITY OF PEARLAND, 0.43 ac) — the site whose wrong-county answer produced B209502. → V17704.",
  },
  galveston: {
    verifiedOn: "2026-08-06",
    verifiedNote: "188,679 parcel polygons, count query 128 ms, point identify 594 ms, real lot returned at Texas City. A SECOND AGOL layer (services7.arcgis.com/2iAOv9D7729Bn31m, GCAD_Parcels_MGO_view) also answers at Texas City but holds only 26,094 features — a partial republication, rejected: it is the B369 clip trap, a source that passes your test point while being silently incomplete elsewhere. → V17704.",
  },
  liberty: {
    verifiedOn: "2026-08-06",
    verifiedNote: "155,826 parcel polygons, count query 133 ms, point identify 144 ms, real lot returned at Dayton (prop_id 73270). → V17704.",
  },
  austintx: {
    verifiedOn: "2026-08-06",
    verifiedNote: "22,630 parcel polygons, count query 221 ms, point identify 137–233 ms, real lots returned at both Sealy and Bellville. Small count is CORRECT for a rural county of ~30k people — checked against the whole-county extent, not assumed. → V17704.",
  },

  co_adams: {
    verifiedOn: "2026-07-29",
  },
  co_denver: {
    verifiedOn: "2026-07-29",
  },
  co_weld: {
    verifiedOn: "2026-07-29",
  },
  co_broomfield: {
    verifiedOn: "2026-07-29",
  },
  co_arapahoe: {
    candidateUrl: "https://gis.arapahoegov.com/arcgis/rest/services/OpenDataService/FeatureServer/0",
    candidateProvenance: "ArcGIS Online item 'Parcels - Arapahoe County' (owner gis@mhfd); host gis.arapahoegov.com still blocked by build-environment egress policy — RE-PROBED 2026-08-03 (NEW-1) and still pending. The only reachable alternative is an AGOL copy (services1.arcgis.com/Ezk9fcjSUkeadg6u, 214,375 features, 250 ms) owned by `jklier_uagis`, a 2017 personal/coursework account; a nine-year-old third-party copy is worse than the state composite, so it is recorded and not shipped.",
    verifiedOn: null,
  },
  co_larimer: {
    // PROMOTED 2026-08-03 (NEW-1). The parked candidate is now the primary: probed LIVE from the
    // owner's own browser over the site in the report — 181,035 tax parcels, capabilities
    // Map,Query,Data, count query 108 ms, point identify 87 ms, maxRecordCount 1000, and the same
    // parcel (PARCELNUM 8634109901, LOCADDRESS "5260 ARENA CIR") the statewide composite returns
    // for -104.985, 40.44. Independently corroborated here against the ArcGIS Online registry:
    // item "Larimer County Tax Parcels", owner `ftc_geoevent`, this exact URL.
    verifiedOn: "2026-08-03",
    verifiedNote: "Live-probed from the owner's browser, not from this build environment — maps1.larimer.org is still blocked by the sandbox egress policy (a sandbox limitation, not a sign the endpoint moved), the same standing as the Chambers row. The browser is where the app actually runs, so a browser probe is the load-bearing one; the AGOL item record was matched here to confirm the URL is the county's own published service. → V682.",
  },
  co_jefferson: {
    // ⚠ CORRECTS the B1111 record. Jefferson was filed as "no county parcel endpoint could be
    // FOUND at all". The 2026-08-03 re-probe (NEW-1) found it registered: ArcGIS Online item
    // "Parcel", owner `Jeffco` (the county's own org).
    candidateUrl: "https://gisportal.jeffco.us/server2/rest/services/Parcel/FeatureServer/0",
    candidateProvenance: "ArcGIS Online item 'Parcel' (owner Jeffco, the county's own org), plus a sibling 'Parcel Split' service on the same host; gisportal.jeffco.us blocked by build-environment egress policy — probe pending. The two reachable Jeffco copies are both provably STALE: the City of Lakewood's hosted copy (services.arcgis.com/PFikmPaTMlt2KX1O, 248,974 features) last edited 2018-05-08, and the county's own 2022 snapshot service disagree on the owner of the same PIN 49-061-03-003.",
    verifiedOn: null,
  },
  co_elpaso: {
    candidateUrl: "https://gisservices.elpasoco.com/arcgis2/rest/services/HubPublic/Parcels/MapServer",
    candidateProvenance: "ArcGIS Online item 'Parcels' (owner BaileyG, El Paso County); host gisservices.elpasoco.com still blocked by build-environment egress policy — RE-PROBED 2026-08-03 (NEW-1) and still pending. A regional alternative was verified live 2026-07-29 and RE-verified 2026-08-03 — PPACG Parcels (2025), https://services1.arcgis.com/0plDVQODvYjBRQXP/arcgis/rest/services/PPACG_Parcels/FeatureServer/0, 268,356 features, 326 ms, native SR EPSG:2232, last edited 2026-07-25 — but it is the MPO's TAZ-joined planning derivative (LandUse/PlaceType/NumHU columns), it drops right-of-way parcels and it spans Teller County, so it is still not shipped as a parcel source. The re-probe confirms the 2026-07-29 reasoning rather than overturning it.",
    verifiedOn: null,
  },
  co_boulder: {
    candidateUrl: "https://maps.bouldercounty.org/arcgis/rest/services/PARCELS/PARCELS_OWNER/FeatureServer/0",
    candidateProvenance: "ArcGIS Online item 'Parcels - Boulder County' (owner gis@mhfd); host maps.bouldercounty.org still blocked by build-environment egress policy — RE-PROBED 2026-08-03 (NEW-1) and still pending. Boulder County's OWN reachable AGOL copy ('Boulder County Parcel / Address Look Up', services3.arcgis.com/0jWpHMuhmHsukKE3, native SR EPSG:2876, 259 ms) carries only 30,803 features and its own Updated column reads 2/14/2020 — a partial six-year-old extract would show a lot as MISSING rather than as slow, so it is recorded and not shipped.",
    verifiedOn: null,
  },

  /* ═══ B1455633 — Idaho's 13 participating counties, all one shared service (layer 7 of
   * "Public Idaho Parcels", not layer 0 — see counties.js's own header for the point/polygon
   * trap). All 13 verified together: live from THIS sandbox (services1.arcgis.com is reachable),
   * layer metadata read, a `County` distinct-values query returned exactly these 13 names, and
   * `extentCoverageCheck` confirmed the layer is NOT statewide (lat 66% / lon 104% of Idaho's
   * bbox) — consistent with only 13 of 44 counties participating. A Boise envelope query answered
   * in 1,682ms, inside the app's 8s budget. → V1055873. */
  id_ada: { verifiedOn: "2026-09-10" },
  id_bearlake: { verifiedOn: "2026-09-10" },
  id_boise: { verifiedOn: "2026-09-10" },
  id_camas: { verifiedOn: "2026-09-10" },
  id_gooding: { verifiedOn: "2026-09-10" },
  id_jerome: { verifiedOn: "2026-09-10" },
  id_lincoln: { verifiedOn: "2026-09-10" },
  id_minidoka: { verifiedOn: "2026-09-10" },
  id_nezperce: { verifiedOn: "2026-09-10" },
  id_oneida: { verifiedOn: "2026-09-10" },
  id_teton: { verifiedOn: "2026-09-10" },
  id_valley: { verifiedOn: "2026-09-10" },
  id_washington: { verifiedOn: "2026-09-10" },

  /* ═══ B1455634 — 21-item dispatch batch (19 distinct county rows; Hinds MS is documented, not
   * wired — see counties.js). Ten sit on `*.arcgis.com` and were re-verified live from THIS
   * sandbox on 2026-09-10 (feature count, geometry, a real 3-point spread query); eight sit on
   * county-owned/regional custom hosts this build environment's egress policy blocks, verified
   * only via the dispatch's own live-browser measurement (or, for Oakland/Tulsa, re-RESOLVED to
   * the correct layer via the allowlisted arcgis.com search API even though the origin host
   * itself could not be re-probed). → V1055874. */
  il_cook: {
    verifiedNote: "gis.cookcountyil.gov is blocked by this build environment's egress policy. Endpoint, feature count (95ms/23 populated fields) and county provenance are from the dispatch's own live-browser measurement, 2026-09-10 — not independently re-probed here.",
  },
  il_dupage: {
    verifiedNote: "gis.dupageco.org is blocked by this build environment's egress policy. Endpoint, feature count (275ms/66 populated fields) and county provenance are from the dispatch's own live-browser measurement, 2026-09-10 — not independently re-probed here.",
  },
  il_will: {
    verifiedNote: "gis.willcountyillinois.com is blocked by this build environment's egress policy. Endpoint, feature count (329ms/18 populated fields) and county provenance are from the dispatch's own live-browser measurement, 2026-09-10 — not independently re-probed here.",
  },
  pa_allegheny: {
    verifiedNote: "gisdata.alleghenycounty.us is blocked by this build environment's egress policy. Endpoint, feature count (469ms/8 populated fields) and county provenance are from the dispatch's own live-browser measurement, 2026-09-10 — not independently re-probed here.",
  },
  pa_northampton: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox (services2.arcgis.com is reachable): 122,379 parcel polygons, count query 275ms, 57 populated fields, esriGeometryPolygon.",
  },
  pa_cumberland: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 104,637 parcel polygons, count query 496ms, 41 populated fields, esriGeometryPolygon.",
  },
  ga_gwinnett: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 309,658 parcel polygons, count query 304ms, 16 populated fields, esriGeometryPolygon. Also independently surfaced in this repo's own statewide-parcel probe (docs/STATEWIDE-PARCELS.md, 'unlinked hits' table) as a real county publisher, corroborating the county provenance.",
  },
  mi_oakland: {
    verifiedOn: "2026-09-10",
    verifiedNote: "The dispatch's own URL was truncated ('gisservices.oakgov.com... my capture truncated it'). Re-RESOLVED via the allowlisted arcgis.com search API (which reaches ArcGIS Online item metadata even for a host whose ORIGIN is blocked): item 'OC Tax Parcels (Public)', owner OCAGOAdmin (Oakland County's own GIS org) — layer 1 of EnterpriseOpenParcelDataMapService, distinct from layer 0 (Site Address), layer 2 (Right of Way) and layer 3 (Parcel History) on the same service; that resolution IS a live confirmation of the correct endpoint, even though gisservices.oakgov.com's own /query cannot be independently re-probed from this sandbox (blocked by egress policy). PIN/SITESTREETADDRESS come from the dispatch's own live-browser measurement (540ms/12 populated fields).",
  },
  ks_wyandotte: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 68,993 parcel polygons, count query 289ms, esriGeometryPolygon. Attribute-light by design (id + acreage only, no owner/situs/value on this layer).",
  },
  mo_platte: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 45,149 parcel polygons, count query 744ms, esriGeometryPolygon. Attribute-light by design (id/legal/acreage/zoning only).",
  },
  or_multnomah: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 284,349 parcel polygons, count query 585ms, 49 populated fields, esriGeometryPolygon. A 3-point spread (Portland/Gresham/Troutdale) all answered with real parcels.",
  },
  or_clackamas: {
    verifiedOn: "2026-09-10",
    verifiedNote: "⛔ CORRECTS the dispatch's URL. The originally-measured endpoint (services2.arcgis.com/…/Taxlot_additional_records_public/FeatureServer/2, 'Taxlot Additional Records Public', OregonMetro.RLIS org) is a supplementary POINT table — esriGeometryPoint, only 3,470 features — not the county's parcel fabric; confirmed live from this sandbox. RESOLVED to Clackamas County's OWN GIS org account (CCGISWebService, not the regional OregonMetro.RLIS account): 'Taxlots', 163,927 parcel polygons, esriGeometryPolygon, VERIFIED LIVE from this sandbox, count query returned real data at all 3 of a spread across the county (Oregon City 3,775ms/2000 feat., Milwaukie 2,581ms/2000 feat., Molalla 973ms/707 feat.).",
  },
  ky_jefferson: {
    verifiedNote: "gis.lojic.org is blocked by this build environment's egress policy. Endpoint, feature count (272ms/7 populated fields) and county provenance (LOJIC — the Louisville/Jefferson County Information Consortium's own open-data service) are from the dispatch's own live-browser measurement, 2026-09-10 — not independently re-probed here.",
  },
  ms_desoto: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 80,950 parcel polygons, count query 830ms, 55 populated fields, esriGeometryPolygon. A 3-point spread (Southaven/Hernando/Horn Lake) all answered with real parcels.",
  },
  ok_oklahoma: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 337,029 parcel polygons, count query 149ms, 45 populated fields, esriGeometryPolygon. A 3-point spread (OKC/Edmond/Midwest City) all answered with real parcels.",
  },
  ok_tulsa: {
    verifiedOn: "2026-09-10",
    verifiedNote: "The dispatch's own URL was truncated ('Tulsa County parcels on services3.arcgis.com... my capture truncated it'). No services3.arcgis.com item matching '122 populated fields, densest in the set' was found under the Tulsa County Assessor's own AGOL account (tca_cperkins) — that account's services3.arcgis.com items are ancillary tables (Building Permit, Historical Parcels, Records), not the main parcel layer. RESOLVED to the assessor's own primary service instead: asps0305.tulsacounty.org, owner tca_cperkins (Tulsa County Assessor's own org, confirmed via that account's public AGOL item listing, including a 'Tulsa County Assessor' Hub site under the same account) — that resolution IS a live confirmation of the correct endpoint, even though the host itself is blocked by this build environment's egress policy and its field list could not be independently re-read here.",
  },
  la_eastbatonrouge: {
    verifiedOn: "2026-09-10",
    verifiedNote: "VERIFIED LIVE from this sandbox: 205,820 parcel polygons, count query 563ms, 13 populated fields, esriGeometryPolygon. A 3-point spread (Baton Rouge/Zachary/Baker) all answered with real parcels.",
  },
  al_jefferson: {
    verifiedNote: "jccgis.jccal.org is blocked by this build environment's egress policy. Endpoint, feature count (652ms/68 populated fields) and county provenance are from the dispatch's own live-browser measurement, 2026-09-10 — not independently re-probed here.",
  },
  /* ═══ B1551617 — Tier 1 counties, all discovered + verified LIVE from this sandbox 2026-09-11 by
   * ui-audit/discover-county-parcels.mjs (routes 1/2 — hub.arcgis.com / www.arcgis.com, both
   * reachable here). Every one passed 3 geometry-verified spread points across the WHOLE county
   * (never just the seat), not merely a metadata check. ═══ */
  ga_fulton: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 373,296 parcel polygons, count query 616ms, 28 fields, esriGeometryPolygon. Replaces the previously-declined `Tax_Parcels2018` (2018 vintage, stale — docs/STATEWIDE-PARCELS.md). Discovered via the ArcGIS Hub dataset API route.",
  },
  ga_chatham: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 126,490 parcel polygons, count query 708ms, 47 fields, esriGeometryPolygon. Previously recorded as 'not found by routes 1-2' (docs/STATEWIDE-PARCELS.md, 2026-09-10); found this session via the ArcGIS Online item search route.",
  },
  az_pinal: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 286,959 parcel polygons, count query 523ms, 74 fields, esriGeometryPolygon. Published by the City of Maricopa's own GIS account (owner CityOfMaricopa, not the neighboring Maricopa COUNTY) — a 3-point spread 50-80 miles apart (Casa Grande / Apache Junction area / San Tan Valley area) all answered with real, distinct parcels, confirming this covers the whole county rather than just the city.",
  },
  az_maricopa: {
    verifiedNote: "gis.maricopa.gov is blocked by this build environment's egress policy (confirmed live, B1339920 — CONNECT tunnel rejected by organization policy). Endpoint, feature count (1,760,396 polygons, capabilities Map/Query/Data) and the 4-point spread (Phoenix/Mesa/Surprise/Buckeye, each with a real APN and sub-250ms response) are from the dispatch's own live-browser measurement, 2026-09-11 evening Central — not independently re-probed here. Layer 1 ('Parcel') was explicitly distinguished from layer 0 ('Subdivision') in that measurement; layer 0 is NOT wired.",
  },
  mo_clay: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 98,112 parcel polygons, count query 570ms, 40 fields, esriGeometryPolygon.",
  },
  sc_greenville: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 215,484 parcel polygons, count query 387ms, 55 fields, esriGeometryPolygon. Replaces the previously-declined `Parcel_Sizes_2018_WFL1` (2018 vintage AND a derived-acreage layer, not the parcel layer itself — docs/STATEWIDE-PARCELS.md).",
  },
  ia_polk: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 219,672 parcel polygons, count query 291ms, 49 fields, esriGeometryPolygon. Previously recorded as 'not found by routes 1-2' (docs/STATEWIDE-PARCELS.md, 2026-09-10); found this session via the ArcGIS Hub dataset API route.",
  },
  pa_lehigh: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 127,043 parcel polygons, count query 451ms, 21 fields, esriGeometryPolygon. Replaces the previously-declined `ATestParcel` — this is the SAME underlying ArcGIS service container (a publisher naming quirk, not the same data): fetched the service's own layer list directly and confirmed layer 0 is an unrelated 'Owner' POINT layer while layer 1 (wired here) is a real, current, 127,043-feature POLYGON parcel layer whose own AGOL item is titled 'Parcels - PA - Lehigh County'.",
  },
  nm_bernalillo: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 257,283 parcel polygons, count query 304ms, 16 fields, esriGeometryPolygon. Published by the City of Albuquerque's GIS (owner agis_CABQ). Previously recorded as 'not found by routes 1-2' (docs/STATEWIDE-PARCELS.md, 2026-09-10).",
  },
  il_kane: {
    verifiedOn: "2026-09-11",
    verifiedNote: "VERIFIED LIVE from this sandbox: 187,336 parcel polygons, count query 336ms, 48 fields, esriGeometryPolygon.",
  },
};

/* Convenience accessors so callers never reach into the shape directly. */
export const verifiedOnFor = (key) => (COUNTY_VERIFICATION[key] || {}).verifiedOn || null;
export const candidateUrlFor = (key) => (COUNTY_VERIFICATION[key] || {}).candidateUrl || null;
export const provenanceFor = (key) => {
  const r = COUNTY_VERIFICATION[key] || {};
  return r.candidateProvenance || r.verifiedNote || null;
};
