# STATEWIDE-PARCELS.md — free statewide parcel GIS probe (NEW-1)

> **Last probed:** 2026-09-09 · **Re-run:** `npm run probe:parcels` (NEW-2) · script: `ui-audit/probe-statewide-parcels.mjs`
>
> One row per state + DC, MEASURED by this script hitting each candidate endpoint live — never typed from memory.
> This build environment sits behind an egress allowlist: `*.arcgis.com` hosts are reachable, most individual state
> `.gov` domains are not (`blocked-in-sandbox` below means exactly that policy block, not a real outage). A `no-free-source`
> row is a legitimate, expected finding for most states — record it plainly, never omit it. A `no-free-source` row whose
> Candidate cell names a real service (rather than reading `none found`) means a real candidate WAS found but was never
> queried from here — its own per-state note below says why (blocked host + bad third-party-provenance being the usual case).
> A `shape-mismatch` row is a DIFFERENT finding from `no-free-source` and must never be read as one: a real statewide source
> exists (sometimes fully measured, live, with a real field list — Mississippi's is the best schema of the whole probe) but its
> SHAPE doesn't fit this app's single-`layerUrl` wiring — it needs a join to a second table, or ships as more than one service
> covering different halves of the state. That is an INTEGRATION gap, never a DATA gap; its Candidate cell always names the
> real service(s), with a real clickable URL when one is on record.
>
> **Hawaii, Maryland, Nebraska, New Hampshire, Virginia, West Virginia, Mississippi, Pennsylvania, Kansas and
> RHODE ISLAND were additionally measured LIVE FROM THE OWNER'S OWN BROWSER on 2026-09-08 — a real, unrestricted network, never this
> sandbox.** Their per-state notes below say so explicitly; do not read their `blocked-in-sandbox`/`host-error`
> reachability columns (a property of THIS sandbox's own probe run) as evidence the sandbox itself ever reached them —
> it did not, and cannot. Virginia and West Virginia were previously declined (B1345824 round 1) on a mistaken reading
> of this exact blind spot — their official hosts were never actually unreachable, only unreachable FROM HERE.
>
> **⛔ CALIFORNIA AND RHODE ISLAND were, until 2026-09-08, recorded here as `no-free-source` with `Candidate: none
> found`. BOTH FINDINGS WERE FALSE, and they are retracted outright rather than softened** — see their per-state
> notes. California's claimed "only a static 2014 file-geodatabase, 51 of 58 counties, not a live REST service" was
> wrong in every operative clause (a live, public, official 13,138,000-parcel Feature Service exists, and was
> reachable FROM THIS SANDBOX the whole time); Rhode Island's claimed "RIGIS publishes standards and a per-town
> tracker, not a merged statewide layer" was wrong too (the merged layer exists and RIGIS itself publishes it).
> Both were found by **pass 2** below — searching states' own official ArcGIS Online ORGANIZATIONS rather than only
> their `.gov` GIS hosts. The `Found by` column records which pass produced every candidate in the table.

> **NEW-1/NEW-2 (2026-09-09) — the `Extent covers state?` and `Envelope query (≤8s)` columns are the first real
> SPATIAL checks this probe runs, not just metadata.** Nebraska's `ne_statewide` had a real capabilities list and a
> real field set — every check a prior pass ran — while its layer extent covered the Omaha metro plus two Iowa
> counties, not Nebraska; a query at Omaha's own coordinates returned zero. `Extent covers state?` projects each
> reachable layer's own declared extent to lat/lon (via Esri's public Geometry Service — one extra request, no
> guessed reprojection math) and reports what fraction of the claimed state's own lat/lon span it reaches, flagged
> ⛔ below a generous floor. `Envelope query (≤8s)` times a real ~7-mile envelope-intersect/attributes-only query —
> the shape the app's own viewport draw runs — against the SAME 8-second budget the app's click-lookup path already
> enforces (`PARCEL_FETCH_TIMEOUT_MS`), flagged ⛔ when a source can't answer inside it (Florida timed out past 32s;
> Tennessee took 25.5s and returned zero; California — MORE features than Florida — answered in under 2s). A second,
> INDEPENDENT ⛔ ("zero at a covered point") fires whenever a source answers a query centered INSIDE its own declared
> extent with zero features — Tennessee's own re-runs varied in TIMING (4.2s–25.5s across repeated probes) but were
> CONSISTENTLY empty at Nashville, which its own extent claims to cover, so timing alone would miss it on a fast day.
> Both checks are DIAGNOSTIC, not a hard gate: an irregularly-shaped or far-flung state (Alaska, Hawaii, Michigan's two
> peninsulas) can legitimately read a lower coverage fraction without that being a defect — read the numbers.

| State | Assessing unit | Verdict | Candidate | Found by | Reachable here | Feature count | Geometry | Fields | Extent covers state? | Envelope query (≤8s) | Wired? |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Alaska (AK) | borough/municipality (organized); no local assessor in the unorganized borough | measured-reachable | [Alaska Statewide Parcels (AK DNR, Div. of Forestry & Fire Protection)](https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services/AK_Parcels/FeatureServer/0) | gov | yes (200, 273ms) | 415,359 | esriGeometryPolygon | parcelId=`parcel_id`, owner=`owner`, situsAddress=absent, landArea=absent, appraisedValue=`land_value` | lat 87% · lon 75% of state | 157ms, 2000 feat. | ✅ |
| Alabama (AL) | county | no-free-source (statewide) — **35 of 67 counties wired county-by-county, see "Alabama counties (B2302784)"** | none found | — | — | — | — | — | — | — | — |
| Arkansas (AR) | county | blocked-in-sandbox | [Parcel Polygon — County Assessor Mapping Program (CAMP), Arkansas GIS Office](https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — gis.arkansas.gov) |
| Arizona (AZ) | county | no-free-source (statewide) — **15 of 15 counties wired county-by-county, see "Arizona counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| California (CA) | county | measured-reachable | [California Statewide Parcels Public View (CAL FIRE — CA Dept. of Forestry & Fire Protection, org ITS.CALFIRE)](https://bz1uwWPKUInZBK94.svcs5.arcgis.com/bz1uwWPKUInZBK94/arcgis/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0) | agol | yes (200, 456ms) | 13,138,000 | esriGeometryPolygon | parcelId=`PARCEL_APN`, owner=absent, situsAddress=`SITE_ADDR`, landArea=absent, appraisedValue=absent | lat 102% · lon 112% of state | 655ms, 2000 feat. | ✅ |
| Colorado (CO) | county | already-wired | none found | — | — | — | — | — | — | — | ✅ (already) |
| Connecticut (CT) | town/municipal (no functioning county government); CT OPM GIS Office aggregates via the regional Councils of Government under CGS §4d-90–92 | measured-reachable | [Connecticut State Parcel Layer 2023](https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0) | gov | yes (200, 215ms) | 1,247,506 | esriGeometryPolygon | parcelId=absent, owner=`Owner`, situsAddress=absent, landArea=absent, appraisedValue=absent | lat 93% · lon 97% of state | 719ms, 2000 feat. | ✅ |
| District of Columbia (DC) | none — single consolidated city government (DC Office of Tax & Revenue) | measured-reachable | [Owner Polygons / Common Ownership Layer, layer 40 (DC GIS, Property_and_Land_WebMercator)](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/40) | gov | blocked (sandbox policy) | 137,400 | esriGeometryPolygon | parcelId=absent (OWNERNAME/PREMISEADD carry identity), owner=`OWNERNAME`, situsAddress=`PREMISEADD`, landArea=`LANDAREA`, appraisedValue=`NEWTOTAL` | — | — | ✅ (Verify: live — maps2.dcgis.dc.gov) |
| Delaware (DE) | county (3: Kent, New Castle, Sussex) | blocked-in-sandbox | [Delaware State Parcels 2.0 — without Ownership Information (FirstMap)](https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — enterprise.firstmap.delaware.gov) |
| Florida (FL) | county | measured-reachable | [Florida Statewide Cadastral (FL Dept. of Revenue, Property Tax Oversight)](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0) | gov | yes (200, 346ms) | 10,831,924 | esriGeometryPolygon | parcelId=`PARCEL_ID`, owner=absent, situsAddress=absent, landArea=`LND_SQFOOT`, appraisedValue=absent | lat 99% · lon 102% of state | ⛔ 8002ms (timed out) | ✅ |
| Georgia (GA) | county | no-free-source (statewide) — **111 of 159 counties wired county-by-county, see "Georgia counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Hawaii (HI) | county (4 counties only; state has had zero role in valuation since a 1981 constitutional amendment) | blocked-in-sandbox | [Hawaii Statewide TMKs (State Office of Planning & Sustainable Development, ParcelsZoning MapServer layer 25)](https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — geodata.hawaii.gov) |
| Iowa (IA) | county assessor generally; 8 larger cities (Cedar Rapids, Iowa City, Des Moines, etc.) run an independent City Assessor | no-free-source (statewide) — **56 of 99 counties wired county-by-county, see "Iowa counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Idaho (ID) | county | measured-reachable | [Public Idaho Parcels — layer 7 "Parcels Public" (Idaho OITS)](https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7) | gov | yes (200) | 381,144 | esriGeometryPolygon | parcelId=`PARCEL_ID`, owner=`OWNER1`, situsAddress=`SITE_ADD`, landArea=`ASR_ACRES`, appraisedValue=`VAL_TOTAL` | lat 66% · lon 104% of state | 1682ms, 2000 feat. | ✅ (13 of 44 counties on this layer; 34 of 44 with the county-sourced rows — see "Idaho counties (2026-10-19)") |
| Illinois (IL) | township assessors within most counties do the initial valuation (Cook County is the exception, assessing directly); county Supervisor of Assessments reviews/equalizes | no-free-source (statewide; the ISGS statewide database answers Token Required) — **66 of 102 counties wired county-by-county, see "Illinois counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Indiana (IN) | county assessor by default since a 2008 reform; a handful of larger townships above a population threshold retain their own elected township assessor | blocked-in-sandbox | [Parcel Boundaries of Indiana (Indiana Geographic Information Office, Data Harvest)](https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — gisdata.in.gov) |
| Kansas (KS) | county | no-free-source (statewide; the state ORKA layer holds 4 counties) — **50 of 105 counties wired county-by-county, see "Kansas counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Kentucky (KY) | county (PVA — Property Valuation Administrator) | no-free-source (statewide) — **37 of 120 counties wired county-by-county, see "Kentucky counties (2026-10-19, extended 2026-10-20)"**; a Department of Revenue statewide 2025 layer exists but is token-gated | none found | — | — | — | — | — | — | — | — |
| Louisiana (LA) | parish (64 parishes, each with an elected parish assessor — no county, no appraisal-district concept) | no-free-source **at STATE level; 38 of 64 parishes wired individually** (34 through 2026-10-06 + Claiborne, Richland, West Carroll, Ouachita on 2026-10-19; the other 26 each carry a recorded reason — see "## Louisiana parishes (2026-10-19)" at the end of this file) | none found statewide (the only statewide item, LandGrid 2020, answers `Token Required`) — see "Louisiana parishes — 64-parish dispatch, 2026-09-30" | — | — | — | — | — | — | — | — |
| Massachusetts (MA) | city/town (351 cities/towns; counties have no assessing function) | measured-reachable | [Massachusetts Property Tax Parcels (MassGIS, EOTSS)](https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0) | gov | yes (200, 119ms) | 2,559,319 | esriGeometryPolygon | parcelId=`PROP_ID`, owner=`OWNER1`, situsAddress=`SITE_ADDR`, landArea=`LOT_SIZE`, appraisedValue=`LAND_VAL` | lat 98% · lon 100% of state | 5684ms, 2000 feat. | ✅ |
| Maryland (MD) | state-run — SDAT (Dept. of Assessments & Taxation) runs 24 local offices directly; not independent county assessors | blocked-in-sandbox | [MD iMAP — Parcel Boundaries (SDAT-sourced, monthly)](https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — mdgeodata.md.gov) |
| Maine (ME) | town/municipality (482 towns); Unorganized Territory assessed directly by Maine Revenue Services | measured-reachable | ["Maine Parcels Organized Towns", layer 10 (the ONLY layer on this service)](https://services1.arcgis.com/RbMX0mRVOFNTdLzd/ArcGIS/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10) | agol | yes (200, 158–174ms) | 708,382 | esriGeometryPolygon | parcelId=`STATE_ID`, owner=absent, situsAddress=`PROP_LOC`, landArea=absent, appraisedValue=absent | lat 98% · lon 102% of state | 378ms, 2000 feat. | ✅ |
| Michigan (MI) | township/city (local unit assessor); county Equalization Department only reviews aggregate classes, cannot change an individual assessment | no-free-source (statewide) — **54 of 83 counties wired county-by-county, see "Michigan counties (2026-10-19/20)"** | none found | — | — | — | — | — | — | — | — |
| Minnesota (MN) | county (87 counties) | measured-reachable | [Minnesota Parcels — Opt-In Open Data (MnGeo)](https://utility.arcgis.com/usrsvcs/servers/1627519e8d3f42bcb55532d48e9a61e5/rest/services/OpenParcels/plan_parcels_open/MapServer/0) | gov | yes (200, 180ms) | — | esriGeometryPolygon | parcelId=`county_pin`, owner=`owner_name`, situsAddress=absent, landArea=`acres_poly`, appraisedValue=absent | lat 3051% · lon 1162% of state | 114ms, 20000 feat. | ✅ |
| Missouri (MO) | county | no-free-source (statewide) — **73 of 115 counties wired county-by-county, see "Missouri counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Mississippi (MS) | county | shape-mismatch | [MS_East_Parcels](https://gis.mississippi.edu/server/rest/services/Cadastral/MS_East_Parcels/MapServer/0) + [MS_West_Parcels](https://gis.mississippi.edu/server/rest/services/Cadastral/MS_West_Parcels/MapServer/0) — real, measured, two half-state services | — | — | — | — | — | — | — | — |
| Montana (MT) | state-run — MT Dept. of Revenue (ORION CAMA) appraises nearly all property statewide per the MT Constitution; counties bill/collect | measured-reachable | [Montana Cadastral Framework (Montana State Library, MSDI)](https://services.arcgis.com/qnjIrwR8z5Izc0ij/ArcGIS/rest/services/Montana_Cadastral_Framework/FeatureServer/1) | gov | yes (200, 189ms) | 921,301 | esriGeometryPolygon | parcelId=`PARCELID`, owner=`OwnerName`, situsAddress=absent, landArea=`GISAcres`, appraisedValue=`TotalLandValue` | lat 106% · lon 104% of state | 215ms, 2000 feat. | ✅ |
| North Carolina (NC) | county | blocked-in-sandbox | [NC OneMap Parcels — NC Integrated Cadastral Data Exchange](https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — services.nconemap.gov (also confirm the '/secure/' path is not a login wall)) |
| North Dakota (ND) | county | measured-reachable | [ND State Parcel Program (NDIT, aggregated by AppGeo from 51+ counties)](https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0) | gov | yes (200, 251ms) | 742,200 | esriGeometryPolygon | parcelId=absent, owner=`Ownership`, situsAddress=absent, landArea=`CalculatedAcres`, appraisedValue=absent | lat 99% · lon 100% of state | 324ms, 2000 feat. | ✅ |
| Nebraska (NE) | county | blocked-in-sandbox | [Nebraska Statewide Parcels External (NE OCIO, Enterprise)](https://gis.ne.gov/Enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — gis.ne.gov) |
| New Hampshire (NH) | town/municipal (RSA 76; NH DRA provides oversight/equalization only) | blocked-in-sandbox | [NH Parcel Mosaic — layer 1 'Parcels' (NH GRANIT / UNH)](https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosaic/MapServer/1) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — nhgeodata.unh.edu) |
| New Jersey (NJ) | municipal (564 municipalities, each with its own Tax Assessor) | measured-reachable (**564 of 564 municipalities**) | [Parcels and MOD-IV Composite of NJ, Web Mercator (NJOGIS's own AGOL copy)](https://services2.arcgis.com/XVOqAjTOJ5P6ngMu/arcgis/rest/services/Parcels_Composite_NJ_WM/FeatureServer/0) | agol | yes (200, 280–660ms) | 3,481,240 | esriGeometryPolygon | parcelId=`PAMS_PIN`, owner=`OWNER_NAME` (redacted, Daniel's Law), situsAddress=`PROP_LOC`, landArea=`CALC_ACRE`, appraisedValue=`NET_VALUE` | lat 38.9–41.4 / lng -75.6 – -73.9 | ✅ (Verify: live — Newark, Cape May, Delaware River click) |
| New Mexico (NM) | county | measured-reachable (per-county layers; **33 of 33 wired**) | [County_Parcels_2025 — one layer per county (NM Office of the State Engineer)](https://gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer) | gov (via relay) | via /gis-proxy | 33 layers, 1,074–255,181 each | esriGeometryPolygon | parcelId=`UPC`/`AccountNumber`, owner=`Owner1`, situs=`SitusAddress1` | per-county | — | ✅ (23 on this service, 9 on fresher county layers, Bernalillo pre-existing; 5 counties partial — see "New Mexico counties (2026-10-19)") |
| Nevada (NV) | county | measured-reachable | [County_Parcels_In_Nevada_Yellow (Nevada Division of Water Resources)](https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0) | gov | blocked (sandbox policy) | 1,394,188 | esriGeometryPolygon | parcelId=`APN`, owner=absent, situsAddress=absent (`SiteCity` only), landArea=`Acres`, appraisedValue=absent | — | 5-point spread: Las Vegas 132ms · Reno 203ms · Elko 147ms · Carson City 103ms · Pahrump 178ms | ✅ (Verify: live — arcgis.water.nv.gov) — B1455632: the sibling `County_Parcels_in_Nevada` service this row wired originally went empty (0 layers, `/0` → 404) between 8:50 PM and 10:57 PM Central on 2026-09-10; the state had republished the same 1,394,188-feature data one service name over on the same host, re-verified 2026-09-11 morning. Rejects `resultRecordCount` ("Pagination is not supported"); accepts `returnCountOnly`. |
| New York (NY) | town/municipal (city/town assessors; NYS ORPTS provides oversight/certification) | measured-reachable | [NYS Tax Parcels Public — official ArcGIS Online mirror (NYS ITS Geospatial Services + Dept. of Taxation & Finance ORPTS, org account NYSGIS_GPO)](https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1) | gov | yes (200, 342ms) | 3,827,530 | esriGeometryPolygon | parcelId=`MUNI_PARCEL_ID`, owner=`PRIMARY_OWNER`, situsAddress=absent, landArea=`ACRES`, appraisedValue=`FULL_MARKET_VAL` | lat 100% · lon 101% of state | 501ms, 1000 feat. | ✅ — holds 38 of 62 counties (incl. the 5 NYC boroughs); the other 24: 23 wired county-by-county, Niagara a named gap — see "New York counties (2026-10-20)" |
| Ohio (OH) | county (elected County Auditor) | measured-reachable | [Ohio Statewide Parcels — public view (OGRIP)](https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0) | gov | yes (200, 226ms) | 6,313,610 | esriGeometryPolygon | parcelId=`LocalParcelID`, owner=absent, situsAddress=`SitusAddressAll`, landArea=`LandArea`, appraisedValue=absent | lat 92% · lon 103% of state | ⛔ 8001ms (timed out) | ✅ |
| Oklahoma (OK) | county | no-free-source (statewide) | none found statewide — the 2026-09-09 probe ran from an egress-limited sandbox; 16 of 77 counties are now wired county by county (see "Oklahoma counties (2026-10-19)") | — | — | — | — | — | — | — | — |
| Pennsylvania (PA) | county (67 autonomous assessing authorities) | no-free-source (statewide with owners) — **all 67 counties wired county-by-county (PASDA's per-county layers + county-run servers; Armstrong from an ArcGIS Online account, 2026-10-20), see "Pennsylvania counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Oregon (OR) | county (ORMAP is the state's own cooperative cadastral base-map program) | no-free-source (statewide) — **33 of 36 counties wired county-by-county, see "Oregon counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Rhode Island (RI) | town/municipal — RI abolished county government in 1842; 39 towns/cities each run their own independent Tax Assessor | blocked-in-sandbox | [Tax Parcels (RIGIS — the RI state GIS clearinghouse, org RIGIS_ADMIN / RIDEM Map Room)](https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/0) | agol | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — risegis.ri.gov) |
| South Carolina (SC) | county (46 counties, elected/appointed Assessor) | measured-reachable — **all 46 counties wired, see "South Carolina counties (2026-10-19)"** | [Statewide_Parcels (SC Revenue and Fiscal Affairs Office, layer 18 of the Lexington_Richland_Web_Map_WFL1 service)](https://services9.arcgis.com/RvqSyw3diI7dTKo5/arcgis/rest/services/Lexington_Richland_Web_Map_WFL1/FeatureServer/18) | gov | yes (200, 0.4–1.4s) | 2,968,877 | esriGeometryPolygon | parcelId=`T_Map_Number`, owner=`Ownership` (38 of 46 counties), situsAddress=absent, landArea=`Acreage`, appraisedValue=`L_Value`/`M_Value`/`B_Value` | all 46 counties, county-scoped | 0.4–1.4s, ≤2000 feat. | ✅ (wired per county, `scopeWhere` on `County`) |
| South Dakota (SD) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| South Carolina (SC) | county (46 counties, elected/appointed Assessor) | no-free-source | none found | — | — | — | — | — | — | — | — |
| South Dakota (SD) | county | no-free-source (statewide) — **17 of 66 counties wired county-by-county, see "South Dakota counties (2026-10-19)"** | none found | — | — | — | — | — | — | — | — |
| Tennessee (TN) | county (elected County Assessor; Comptroller's Division of Property Assessments provides oversight) | measured-reachable | [Tennessee Property Boundaries Public Use (TN Comptroller, Base Mapping Program)](https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0) | gov | yes (200, 213ms) | 2,141,289 | esriGeometryPolygon | parcelId=`PARCELID`, owner=`OWNER`, situsAddress=absent, landArea=absent, appraisedValue=absent | lat 100% · lon 100% of state | ⛔ 3674ms, 0 feat. — zero at a covered point | ✅ |
| Texas (TX) | appraisal district (a separate legal entity per county under the TX Property Tax Code — not a county government department) | already-wired | none found | — | — | — | — | — | — | — | ✅ (already) |
| Utah (UT) | county (29 counties) | measured-reachable | [Utah Statewide Parcels (UGRC/AGRC)](https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0) | gov | yes (200, 54ms) | 1,596,196 | esriGeometryPolygon | parcelId=`PARCEL_ID`, owner=absent, situsAddress=absent, landArea=absent, appraisedValue=absent | lat 100% · lon 100% of state | 1480ms, 2000 feat. | ✅ |
| Virginia (VA) | county/independent city (98 counties + 39 independent cities, each its own assessing jurisdiction) | blocked-in-sandbox | [Virginia Parcels (VDEM, VA_Base_Layers)](https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — vginmaps.vdem.virginia.gov) |
| Vermont (VT) | town (247 towns; VT counties have no assessing role) | measured-reachable | [VT Parcel Program (Vermont Center for Geographic Information, joined to the Dept. of Taxes Grand List)](https://services.arcgis.com/XG15cJAlne2vxtgt/ArcGIS/rest/services/VT_Parcel/FeatureServer/665) | gov | yes (200, 228ms) | 339,251 | esriGeometryPolygon | parcelId=absent, owner=`OWNER1`, situsAddress=absent, landArea=`ACRESGL`, appraisedValue=absent | lat 100% · lon 106% of state | 149ms, 2000 feat. | ✅ |
| Washington (WA) | county (39 counties) | **statewide mosaic licence-restricted and NOT used — 34 of 39 counties wired county-by-county, see "Washington counties (2026-10-19)"** | none used (the WAGeoservices "Current Parcels" mosaic carries a "State of Washington business only" restriction for some counties; B759/760 stands) | — | — | — | — | — | — | — | ✅ (34 of 39 counties) |
| Wisconsin (WI) | municipal (town/village/city; a minority of counties use a county-assessor system) | measured-reachable | [Wisconsin Statewide Parcels DB V12 (State Cartographer's Office / DOA Land Information Program)](https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0) | gov | yes (200, 249ms) | 3,574,646 | esriGeometryPolygon | parcelId=`STATEID`, owner=`OWNERNME1`, situsAddress=absent, landArea=`ASSDACRES`, appraisedValue=absent | lat 100% · lon 92% of state | 438ms, 2000 feat. | ✅ |
| West Virginia (WV) | county (55 counties) | blocked-in-sandbox | [WVParcels (WV GIS Technical Center)](https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — services.wvgis.wvu.edu) |
| Wyoming (WY) | county (23 counties) | measured-reachable | [Wyoming Parcels for 2026 (WY Dept. of Revenue Property Tax Division)](https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/Wyoming_Parcels_for_2026/FeatureServer/0) | gov | yes (200, 176ms) | 373,666 | esriGeometryPolygon | parcelId=`parcelnb`, owner=`ownername1`, situsAddress=absent, landArea=absent, appraisedValue=`actualvalu` | lat 100% · lon 100% of state | 95ms | ✅ |

**32 states + DC wired** (incl. TX/CO already live): AK, AR, CA, CO, CT, DC, DE, FL, HI, IN, MA, ME, MD, MN, MT, NC, ND, NE, NH, NJ, NV, NY, OH, RI, TN, TX, UT, VA, VT, WI, WV, WY. (Idaho is wired too, but as 13 individual counties, not a statewide composite — see the County-level section.)

### ⛔ WIRED SOURCES FLAGGED BY THE NEW-1/NEW-2 SPATIAL CHECKS — look at these before trusting the row above

**Envelope query exceeded the 8000ms budget (the app's own click-lookup hang-guard), or returned zero features at a point inside the layer's own declared extent:**
- **Florida (FL)** — ⛔ 8002ms (timed out) — [layer](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0)
- **Ohio (OH)** — ⛔ 8001ms (timed out) — [layer](https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0)
- **Tennessee (TN)** — ⛔ 3674ms, 0 feat. — zero at a covered point — [layer](https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0)

## Pass 2 — official state ArcGIS Online organizations (NEW-2)

> Pass 1 above resolves each state's candidate from that STATE'S OWN `.gov` GIS host. This environment reaches
> `*.arcgis.com` and cannot reach most state `.gov` domains, so pass 1 is structurally blind to a state that
> publishes the same dataset to its own ArcGIS Online ORGANIZATIONAL ACCOUNT. New York was rescued by exactly
> that route and it was filed as a one-off workaround rather than a method; running it properly found
> **California** (13.1M parcels, CAL FIRE) and **Rhode Island** (394k parcels, RIGIS) — both of which this
> document previously recorded as `no-free-source` / `Candidate: none found`.
>
> Publishers are sorted into THREE tiers, never two. **official** — a verified state organization, or an org whose
> name both names the state and names a government body. **review** — parcel-shaped, published by somebody this pass
> cannot positively classify; SURFACED for a human, never dropped. **excluded** — a commercial vendor (Regrid /
> LandGrid and similar are filtered in every state; the owner has declined paid data) or a positively-identified
> county, city, school or university. The middle tier is the point: an organization's display NAME is not a reliable
> signal — New York's is "ShareGIS NY" and Rhode Island's "RIDEM - Map Room", so a two-way filter DISCARDS two of
> the three state publishers this repo has verified, and each discard reads downstream as an authoritative "nothing
> exists here".

Known-good arms all reported their known answers, so the counts below are real (see `ui-audit/lib/agolParcelSearch.mjs`).

| State | Tier | Publisher (org) | Item | Measured | Wired already? |
|---|---|---|---|---|---|
| AK | official | for_admin (Alaska Department of Natural Resources ArcGIS Online) | [Alaska Statewide Parcels](https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services/AK_Parcels/FeatureServer/0) | 415,359 features, esriGeometryPolygon | yes |
| CA | official | ITS.CALFIRE (CAL FIRE) | [California Statewide Parcels Public View](https://bz1uwWPKUInZBK94.svcs5.arcgis.com/bz1uwWPKUInZBK94/arcgis/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0) | 13,138,000 features, esriGeometryPolygon | yes |
| CT | official | ctgisoffice (State of Connecticut) | [Connecticut CAMA and Parcel Layer](https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer/FeatureServer/0) | 1,320,686 features, esriGeometryPolygon | yes |
| CT | review | deepgis (Department of Energy & Environmental Protection) | [Connecticut Parcels 2009](https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Connecticut_Parcels_for_Protected_Open_Space_Mapping/FeatureServer/0) | 1,020,364 features, esriGeometryPolygon | yes |
| CT | official | ctgisoffice (State of Connecticut) | [Connecticut CAMA and Parcel Layer 2024](https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_2024/FeatureServer/0) | 1,290,196 features, esriGeometryPolygon | yes |
| FL | official | FloridaGIO (State of Florida Geographic Information Office) | [Florida Statewide Parcels](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0) | 10,831,924 features, esriGeometryPolygon | yes |
| FL | official | FDEPMapDirect (Florida Department of Environmental Protection) | [Florida_Statewide_Cadastral](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0) | 10,831,924 features, esriGeometryPolygon | yes |
| FL | review | layermanager (GIS WebTech) | [Florida Statewide Parcels](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0) | 10,831,924 features, esriGeometryPolygon | yes |
| IA | review | mtbutler@uiowa.edu_uiowa (org unresolved) | [Iowa Statewide Parcel Data, 2017](https://services3.arcgis.com/kd9gaiUExYqUbnoq/arcgis/rest/services/Iowa_Parcels_2017/FeatureServer/0) | 2,450,589 features, esriGeometryPolygon | **no** |
| NJ | official | NJPinelands (New Jersey Pinelands Commission) | [Pinelands_Parcels](https://services1.arcgis.com/nCm6SZaiGMuGX35l/arcgis/rest/services/Pinelands_Parcels/FeatureServer/0) | 622,323 features, esriGeometryPolygon | yes |
| OH | official | ogrip_agol (Ohio Geographically Referenced Information Program) | [Ohio Statewide Parcels Public View](https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0) | 6,313,610 features, esriGeometryPolygon | yes |
| TN | official | tnmap_oir (State of Tennessee STS GIS) | [Tennessee Property Boundaries Public Use](https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0) | 2,141,289 features, esriGeometryPolygon | yes |
| TN | review | MTIDAadmin (org unresolved) | [Tennessee Property Boundaries](https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0) | 2,141,289 features, esriGeometryPolygon | yes |
| TN | review | sara2263_thrive_geohub (Thrive Regional Partnership) | [Tennessee Property Boundaries Public Use](https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0) | 2,141,289 features, esriGeometryPolygon | yes |
| UT | official | UtahAGRC (Utah Automated Geographic Reference Center (AGRC)) | [Utah Statewide Parcels](https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0) | 1,596,196 features, esriGeometryPolygon | yes |
| WA | official | WAGeoservices (Washington State Geospatial Portal) | [Current Parcels](https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Current_Parcels/FeatureServer/0) | 3,321,859 features, esriGeometryPolygon | **no** |
| WA | official | WAGeoservices (Washington State Geospatial Portal) | [Previous Parcels](https://services.arcgis.com/jsIt88o09Q0r1j8h/arcgis/rest/services/Previous_Parcels/FeatureServer/0) | 3,322,257 features, esriGeometryPolygon | **no** |
| WA | official | OpenData_wadnr (Washington State Department of Natural Resources) | WA DNR Managed Land Parcels | not measured — no service URL | **no** |

**2 official + MEASURED-plausible candidate(s) in states NOT yet wired · 1 needing a publisher review · 1 official lead(s) that could not be measured at all.**
Each one is a FILED lead, not a wiring decision: a candidate is wired only after its layer id, coverage and
licence are checked by hand — a layer id is a guess (Hawaii's statewide mosaic is layer 25, New Hampshire's
polygons are layer 1) and a parcel-shaped title is not a parcel layer (Oregon's "State Parcels" resolves to 146
POINTS of facility leases).

### States previously declined for NON-reachability reasons — re-checked by pass 2

Every one of these declines predates this pass and therefore rested on the same `.gov`-only search that lost
California and Rhode Island. Re-checked here so the null is on the record rather than re-derived next time.

| State | Prior reason for the decline | Pass 2 result |
|---|---|---|
| MI | Michigan DTMB confirms a statewide parcel layer exists inside its Michigan Geographic Framework, but states outright it is for internal state use only and is not published to the public Open Data portal — a real effort, deliberately not public. | 10 looked at · nothing — decline stands |
| IA | The only free statewide layer found (Iowa_Parcels_2017, reachable, id+owner present) is EXPLICITLY disclaimed by its own publisher as deprecated/frozen at Nov 2017 and 'not current' — 9 years stale. | 4 looked at · nothing official; 1 review-tier candidate(s) above |
| ID | Reachable with real fields, but geometry is POINT (parcel centroids), not polygon — incompatible with the app's polygon-outline click routing — and only 13 of 44 counties currently participate. | 5 looked at · nothing — decline stands |
| OK | A real statewide mosaic exists (Property Records Preservation LLC for the OK Office of Geographic Information) but is explicitly published as view/WMS-only with no downloadable or queryable REST FeatureServer/MapServer found on any reachable host. | 2 looked at · nothing — decline stands |
| OR | The Tax Lot layer the state's own 'Oregon Parcel Viewer' web app points to returns a real HTTP 400 'Invalid URL' — the service has been retired/unpublished, a genuine dead reference rather than a sandbox block. | 7 looked at · nothing — decline stands |
| MO | MSDIS's full open-data catalog (176 datasets, checked directly) contains no parcels/cadastral dataset; the one parcel-shaped layer found (gis. | 4 looked at · nothing — decline stands |
| GA | Georgia GIS Clearinghouse covers 'more than 20% of counties' and is a per-county directory, not a mosaic; DOR's 'tax digest' is tabular jurisdiction totals, not parcel geometry. | 7 looked at · nothing — decline stands |

### Unlinked hits — recorded, not counted, not dropped

Candidates a state's search returned that carry NO positive link to that state — neither the publisher's
organization nor the item's own title names it. Almost always ArcGIS Online relevance noise (it ranks by
relevance, not geography), so they are kept out of the count above. They are listed rather than discarded
because the link test is not sound in one direction: Rhode Island's own statewide layer is titled
`Tax_Parcels` and published by "RIDEM - Map Room", and would fail it too.

| State searched | Tier | Publisher (org) | Item | Measured | Wired already? |
|---|---|---|---|---|---|
| DC | review | admin_canadacadastral (Community Property Map of Canada) | [British Columbia Original Survey Parcels](https://services7.arcgis.com/hFo7GO2CrHDM1QVm/arcgis/rest/services/BC_Update/FeatureServer/0) | 100,782 features, esriGeometryPolygon | **no** |
| DC | review | digitalRE (org unresolved) | [FL_Parcels](https://services5.arcgis.com/GcvM6vDlR2gM4x31/arcgis/rest/services/FL_Parcels/FeatureServer/0) | 10,834,415 features, esriGeometryPolygon | **no** |
| DC | review | Olena.Leskova@FloridaDEP.gov_FDEP (Florida Department of Environmental Protection) | [Cadastral Property Appraiser Parcels - South District](https://services1.arcgis.com/nRHtyn3uE1kyzoYc/arcgis/rest/services/FDORCadastral_SouthDistrict/FeatureServer/0) | 1,642,725 features, esriGeometryPolygon | **no** |
| GA | review | GwinnettCountyGIS (org unresolved) | [Land Parcels](https://services3.arcgis.com/RfpmnkSAQleRbndX/arcgis/rest/services/Property_and_Tax/FeatureServer/0) | 309,658 features, esriGeometryPolygon | **no** |
| ME | review | admin_canadacadastral (Community Property Map of Canada) | [Canada Lands Parcel Mapping](https://services7.arcgis.com/hFo7GO2CrHDM1QVm/arcgis/rest/services/ParcelTime/FeatureServer/0) | 1,373,647 features, esriGeometryPolygon | **no** |
| VA | review | Chesterfield_County (org unresolved) | [ParcelsEnriched_layer](https://services3.arcgis.com/TsynfzBSE6sXfoLq/arcgis/rest/services/Cadastral_ProdA/FeatureServer/3) | 150,514 features, esriGeometryPolygon | yes |
| WA | review | deepgis (Department of Energy & Environmental Protection) | [Connecticut Parcels 2009](https://services1.arcgis.com/FjPcSmEFuDYlIdKC/arcgis/rest/services/Connecticut_Parcels_for_Protected_Open_Space_Mapping/FeatureServer/0) | 1,020,364 features, esriGeometryPolygon | **no** |

## Per-state notes (research context this probe can't measure itself)

- **Alaska (AK):** Explicitly a best-effort mosaic — not every borough has its own parcel service, coverage is uneven; publisher says use the original per-borough services for authoritative data.
- **Alabama (AL):** No state-level parcel aggregation found (Alabama GeoHub, ADOR mapping pages, AGIC hubs, AGOL, ArcGIS Hub checked; the national NSGIC parcel portal lists a *viewer* URL per county and no download or API URL for any of the 67) — parcels are county-only. **Counties are wired one by one: see "Alabama counties (B2302784)" below.** The only statewide Alabama layer on ArcGIS Online (PowerSouth's "Alabama Parcel Data") carries Regrid's `LL_*` fields and is a reseller derivative — NOT used.
- **Arkansas (AR):** Rich schema (id/owner/situs/area/value all present) confirmed via ArcGIS Hub's cached item metadata (2,117,780 features) — gis.arkansas.gov itself is blocked in this sandbox.
- **Arizona (AZ):** AZGeo/AGIC checked; the only state-run 'parcels' layer (ASLD State_Trust_Parcels) covers only state-trust land, not general private parcels. server.azgeo.az.gov blocked in this sandbox.
- **California (CA):** MEASURED FROM THIS SANDBOX (HTTP 200) and independently from the owner's own browser, 2026-09-08. 13,138,000 parcels — the largest source in counties.js, ~21% above Florida's 10.8M, which the same wiring already handles (nothing ever fetches a layer whole: the display layer is viewport-queried and gated at PARCEL_MINZOOM, and a truncated draw is reported loudly — ⛔ THAT LAST CLAUSE WAS NOT TRUE OF THE CODE; see the 2026-10-02 re-measure at the end of this note). Polygon, 21 fields: PARCEL_APN, FIPS_CODE, PARCEL_DMP_ID, COUNTYNAME, SITE_ADDR/CITY/STATE/ZIP, FullStreetAddress, Search_PARCELAPN. NO owner and NO appraised value — attribute-light, the same standing already given to Hawaii, New Hampshire and Virginia. ⛔ FOUND BY THE AGOL PASS (NEW-2), NOT BY A .gov PROBE: the prior 'no free source' finding came from searching California's own .gov GIS hosts, which this sandbox cannot reach, and never searching California's state-agency ArcGIS Online organization, which it can. That blind spot is what NEW-2 closes systematically. **RE-MEASURED 2026-10-02 (B2010865, from this sandbox, HTTP 200 throughout):** still live and still the statewide layer — `CA_Statewide_Parcels_Public`, 13,138,000 features (identical count), `esriGeometryPolygon`, `maxRecordCount` 2,000, formats JSON/geoJSON/PBF, `Query` capability only, CORS `access-control-allow-origin: *`, data last edited **2026-05-28**, native projection California Albers (wkid 6414 — so a point-with-DISTANCE buffer query fails with "SRID is not valid"; the app's plain point-intersects query, inSR/outSR 4326, is unaffected and answers). It has **no MapServer sibling** (`…/MapServer` → "Invalid URL"; `/export` → 400), so California can never get the server-rendered image regime other CADs fall back to. **Click proven at a named point:** (-117.6030, 34.0260) → APN `011328215`, `COUNTYNAME` SAN BERNARDINO, `SITE_ADDR` 2525 E RIVERSIDE DR, `SITE_CITY` ONTARIO, `SITE_ZIP` 91761 (downtown Los Angeles → APN 5149001915, 100 W 1ST ST). **Two defects found by driving the real click path, both fixed:** (1) the card's "Account / ID" was the layer's OBJECTID row number, not the APN (the B1875248 defect class — `ca_statewide` had no pinned `idField`, and `idAttrFor` only read pins from the per-county table); (2) the "truncated draw is reported loudly" claim was false — there is no truncation notice, and the owner retired the "capped this view" banner 2026-09-24 in favour of the image regime that this FeatureServer cannot have. Densest 512-px cell, `returnCountOnly`, measured: **zoom 15 → 18,043 (SF Mission) · zoom 16 → 3,410 (SF Mission), 2,271 (Oakland), 1,757 (Koreatown) · zoom 17 → 1,124 max** — against the 2,000 cap. So `ca_statewide` declares `displayMinZoom: 17` (nothing draws below it; the existing "zoom in to see the lines" hint follows); a click is unaffected at every zoom. Bounded-view proof: `ui-audit/verify-parcel-display-california.mjs`.
- **Colorado (CO):** Already wired (co_statewide) — Colorado Public Parcels composite, gis.colorado.gov. Not re-probed here; that host is blocked in this sandbox (as expected — production reaches it fine).
- **Connecticut (CT):** Rich CAMA-style schema (owner/situs/value present) but no dedicated parcel-ID field surfaced on this hosted copy — only OBJECTID.
- **District of Columbia (DC):** ⛔ RETRACTED 2026-09-10 (B1455632). The `shape-mismatch` verdict above (an ITSPE attribute table joined to a separate Tax Lots geometry layer by an SSL key) was a real finding about a DIFFERENT candidate on this same service — it did not rule out the service having a single, already-joined layer, and it does. Layer 40 ("Owner Polygons / Common Ownership Layer") carries BOTH the geometry and the richest attribute set of anything wired in this repo in ONE layer, no join needed: OWNERNAME, owner mailing address, PREMISEADD, LANDAREA, PROPTYPE, USECODE, NEWLAND/NEWIMPR/NEWTOTAL assessed values, SALEPRICE, SALEDATE, ASSESSMENT, ANNUALTAX, TAXRATE, NBHDNAME. MEASURED FROM THE OWNER'S OWN BROWSER 2026-09-10 (maps2.dcgis.dc.gov is blocked in this sandbox) — 137,400 features, 632ms. ⛔ Layer 33 ("Parcel Lots"), on the SAME service, is a trap: only 1,124 features and returns ZERO downtown — not wired.
- **Delaware (DE):** id + acreage confirmed via Hub metadata (451,344 features); owner/situs deliberately absent from this public copy (a fuller version requires a FirstMap login). enterprise.firstmap.delaware.gov blocked in this sandbox.
- **Florida (FL):** Best-in-class: full attribute set, 10.8M parcels, updated annually every August from all 67 counties.
- **Georgia (GA):** Georgia GIS Clearinghouse covers 'more than 20% of counties' and is a per-county directory, not a mosaic; DOR's 'tax digest' is tabular jurisdiction totals, not parcel geometry. No state aggregation effort found.
- **Hawaii (HI):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — geodata.hawaii.gov is blocked here. Layer 25 'Statewide TMKs', polygon, 18 fields: tmk, tmk_txt, county, island, gisacres, qpub_link. No owner, no value. ⛔ Layer 0 is a GROUP LAYER with zero fields; layers 5/9/11/30 are per-county and were deliberately NOT wired — layer 25 is the statewide mosaic.
- **Iowa (IA):** The only free statewide layer found (Iowa_Parcels_2017, reachable, id+owner present) is EXPLICITLY disclaimed by its own publisher as deprecated/frozen at Nov 2017 and 'not current' — 9 years stale. Not wired: a data-currency disqualification, not a reachability one. **Superseded 2026-10-19:** 56 of 99 counties are now wired county-by-county — see "Iowa counties (2026-10-19)" at the end of this file.
- **Idaho (ID):** ⛔ CORRECTED 2026-09-10 (B1455633). The `esriGeometryPoint` finding above was real but INCOMPLETE — it read layer 0 ("Idaho Parcels Public Centroids", point, parcel centroids) and never checked whether the SAME service published a polygon layer too. It does: layer 7, "Parcels Public", `esriGeometryPolygon`, 381,144 features, confirmed live from this sandbox. The "only 13 of 44 counties" finding stands and is NOT a defect to fix — it is why Idaho is wired as 13 individual per-county entries (`id_ada` … `id_washington`) rather than a statewide composite; wiring it as `id_statewide` would silently return zero for the other 31 counties, the same shape that produced the Nebraska defect (B1332016). See the County-level section below for the full per-county wiring.
- **Illinois (IL):** Illinois State Geological Survey clearinghouse hosts many statewide layers but no parcel mosaic. No aggregation found — matches the township-assessed pattern the brief names. **Updated 2026-10-20 (B2372624):** the ISGS `IL_Parcels/Illinois_Parcels_Database` service exists but is token-gated (499), the Prairie Research Institute's OMLP parcel fabric is a 20-county project slice, and 66 of 102 counties are now wired individually — see "Illinois counties (2026-10-19)".
- **Indiana (IN):** Schema confirmed via ArcGIS item metadata XML: id + address present, owner and value fields absent from this layer entirely. gisdata.in.gov blocked in this sandbox.
- **Kansas (KS):** *(superseded 2026-10-19 — see "Kansas counties (2026-10-19)": the state's parcel layer is on `arcgis4`, holds four counties, and 49 more counties are wired from their own sources.)* RETRACTED, corrected 2026-09-08 from the owner's own browser (not this sandbox): services.kansasgis.org root has ZERO services; its folders are FIRSTNET, ORKA, Utilities, water, wimas, wizard, and ORKA — the one folder that could plausibly hold parcels — holds only KS_ORKA_Extras and sketch. No parcel mosaic exists there. This replaces the prior 'not confirmed either way' finding, which is now a confirmed no.
- **Kentucky (KY):** ⚠ RE-SEARCHED 2026-10-19 (the 2026-09-09 probe ran before AGOL pass 2 and the relay): still no public statewide layer (a DOR statewide 2025 layer exists but answers Token Required), but 37 counties are wired individually — see "Kentucky counties (2026-10-19, extended 2026-10-20)" at the end of this file. Original note: Kentucky's own open-data portal (opengisdata.ky.gov) files every parcel dataset per-county with no combined statewide layer; DOR Mapping Services page describes supporting individual county PVAs, not running one central layer.
- **Louisiana (LA):** LAGIC / LSU Atlas / LA Division of Administration GIS / LA Tax Commission checked — no state-run parcel aggregation found. qpublic.net/la is a private directory of parish links, not a state service.
  **Individual parishes DO publish, and are wired one at a time** — East Baton Rouge (B1455634), Orleans (B1574256, `gis.nola.gov`, found by route 3 after 1 and 2 came up empty), and 24 more on 2026-09-30 (see "Louisiana parishes" at the end of this file; a `Parcels - LA - Statewide 2020` LandGrid item exists but is token-gated). The statewide finding is unchanged; the parish-level one is not the same question. **⛔ Louisiana has PARISHES, not counties, and that is load-bearing rather than cosmetic:** the nationwide geometry asset names these rows "Orleans Parish"/"East Baton Rouge Parish", and until B1574257 `countyKeyForName` stripped only the word "County" from a display name — so NO Louisiana point could be turned back into its configured key, silently. Any future parish wired here must keep the designation out of the key (`la_orleans`) and IN every user-facing label ("Orleans Parish, LA").
- **Massachusetts (MA):** Best-in-class of the whole probe: full schema (id/owner/situs/area/value), 2.56M parcels, semi-annual refresh.
- **Maryland (MD):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — mdgeodata.md.gov is blocked here. 'Parcel Boundaries', polygon, 117 fields: ACCTID, ADDRESS, ACRES, LANDAREA, NFMTTLVL (total value). Owner NAME is absent — only owner MAILING ADDRESS (OWNADD1 etc); the app leaves owner absent rather than fabricating it from the mailing fields.
- **Maine (ME):** ⛔ CORRECTED 2026-09-10 (B1455632). The `shape-mismatch` finding above read layer 0 of this service (which does need the ADB join for owner/value) and never checked layer 10, the service's ONLY OTHER layer — confirmed live from this sandbox: `esriGeometryPolygon`, 708,382 features, fields TOWN/COUNTY/STATE_ID/MAP_BK_LOT/PROP_LOC — everything the app's id/situs lookup needs, no join required. Owner and appraised value are still absent (they genuinely do live only in the un-joined ADB table) — left absent, never fabricated. **⛔ COVERAGE CAVEAT, stated plainly per the dispatch's own instruction: "Organized Towns" excludes Maine's UNORGANIZED TERRITORY — roughly HALF the state's LAND AREA (the North Woods) but almost none of its parcels (a handful of residents, no municipal government to assess them). This is NOT full statewide coverage; do not let it read as such anywhere in the app or in future docs.** The publisher's currency disclaimer ("data for many towns is more than fifteen years old") still applies to the organized-town data this layer DOES carry.
- **Michigan (MI)** *(statewide finding stands; the county-level "none found" was superseded 2026-10-20 — 54 of 83 counties are wired, see "Michigan counties (2026-10-19/20)")*: Michigan DTMB confirms a statewide parcel layer exists inside its Michigan Geographic Framework, but states outright it is for internal state use only and is not published to the public Open Data portal — a real effort, deliberately not public.
- **Minnesota (MN):** Live-confirmed with real owner/value data on a sample feature. Coverage is OPT-IN — counties choose to participate quarterly, so completeness varies by county.
- **Missouri (MO)** *(statewide finding stands; the county-level "none found" was superseded 2026-10-19 — 73 of 115 counties are wired, see "Missouri counties (2026-10-19)")*: MSDIS's full open-data catalog (176 datasets, checked directly) contains no parcels/cadastral dataset; the one parcel-shaped layer found (gis.mo.gov FMDCrealEstate) is scoped to state-OWNED real estate, not general private parcels.
- **Mississippi (MS):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — every MARIS host is blocked here. Real, rich statewide cadastral data exists — the best schema of the whole probe (55 fields: PARNO, OWNNAME, SITEADD, TAXACRES, GISACRES, LANDVAL, IMPVAL1, IMPVAL2, TOTVAL, DEEDREF, DEEDDATE, section/township/range) — but it ships as TWO half-state ArcGIS services, MS_East_Parcels and MS_West_Parcels (gis.mississippi.edu/server/rest/services/Cadastral/), never one statewide layerUrl. Not wired this round, same shape B1332016 already declined for DC: the per-county pattern in counties.js is a single layerUrl, and wiring only the East half would silently present half the state's coverage as the whole (the exact silent-wrong-answer class this repo keeps closing) — so it ships as not-wired-at-all rather than half-wired. Extending the source shape to a real two-service state is real, separate follow-up work.
- **Montana (MT):** Full schema (id/owner/situs/area/value) confirmed live, 921,024 parcels. MCA 2-6-1017 restricts using owner names as a mailing list, which does not affect this app's use.
- **North Carolina (NC):** Full schema confirmed via item metadata XML (id/owner/situs/area/value all present), all 100 counties + Eastern Band of Cherokee. The URL's own '/secure/' path segment is ambiguous — the item's `access` field reads public, but this needs a live check to rule out a login wall before relying on it. services.nconemap.gov blocked in this sandbox.
- **North Dakota (ND):** id + acreage present on this layer; owner/situs/value live on a separate joinable TaxRoll table (layer 1), not wired here — same attribute-light shape as Utah/Delaware.
- **Nebraska (NE):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-09), not this sandbox — gis.ne.gov is blocked here. "Nebraska Statewide Parcels External" (note the path is /Enterprise/, not the old /Agency/), polygon, 1,154,898 features (the retracted TaxParcelsDED layer was 75,394), capabilities Query,Extract, maxRecordCount 2000. Fields: State_PID, Parcel_ID, Situs_Address, Ph_Full_Address, Legal_Description, Twn, Sect, Rng, Acres_Deeded, GIS_Acres, Subdivision, County_ID. Verified GENUINELY statewide by five point probes spread across Nebraska, each returning a real parcel with a DISTINCT county: Omaha 41.2565/-95.9345 → County_ID 055 (Douglas), Scottsbluff 41.8666/-103.6672 in the far western panhandle → 157 (Scotts Bluff), Norfolk 42.0286/-97.4170 in the north → 119 (Madison), McCook 40.2019/-100.6254 in the southwest → 145 (Red Willow), Lincoln 40.8136/-96.7026 → 109 (Lancaster). A whole-layer `returnExtentOnly` request timed out at 12s (this layer is slow at that specific op — see NEW-3's timing-budget note), so the five-point spread is the coverage evidence on record rather than a converted layer extent.
- **New Hampshire (NH):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — nhgeodata.unh.edu is blocked here. ⛔ Layer 1 ('Parcels', polygon) — NOT layer 0 ('Parcel Points', POINT geometry, unusable for the app's polygon click routing). 20 fields: PID, Town, StreetAddress, DisplayId, CountyId, SLU. No owner, no value.
- **New Jersey (NJ):** Full schema confirmed via item metadata XML (id/owner/situs/area/value all present in the field list) — but owner-name values are reported REDACTED for many records under NJ's Daniel's Law privacy statute, so the field exists without always carrying data. maps.nj.gov blocked in this sandbox.
- **New Mexico (NM):** SUPERSEDED 2026-10-19 (B2345888) — the earlier "no confirmed statewide source" was wrong: the Office of the State Engineer publishes `County_Parcels_2025` (one layer per county, all 33) at gis.ose.nm.gov; all 33 counties are wired, 5 of them partially. See "New Mexico counties (2026-10-19)". (Original note: NM Taxation & Revenue Dept. disclaims distributing parcel data.)
- **Nevada (NV):** The DCNR/State Demographer mosaic's NRS 250 disqualification above STANDS — that is a different, real service, and this note does not overturn it. A SEPARATE candidate exists, published by the Nevada DIVISION OF WATER RESOURCES rather than the state GIS office or the demographer's org — exactly why every earlier GIS-office-targeted search missed it. No public-record restriction is stated on this item. Fields: APN, County, SiteCity, Acres, SourceDate, Website — `Website` is a per-parcel deep link to the county assessor's own record, the only wired source in this repo with that field. Clark and Washoe counties' OWN per-county layers are superseded by this statewide layer and are deliberately NOT wired separately. ⛔ **B1455632 (2026-09-11):** the originally-wired service ("County_Parcels_in_Nevada") went empty overnight on 2026-09-10 — healthy at 8:50 PM Central (1,394,188 features, five-point spread all real), reporting ZERO layers by 10:57 PM with `/0` answering "404 Layer not found." Not a throttle (an earlier note here blamed rate-limiting from heavy testing that night; RETRACTED — a throttle cannot empty a service's own layer list). The state had republished the identical data one service name over on the same host: "County_Parcels_In_Nevada_Yellow" ("County Parcels Yellow"), re-verified 2026-09-11 morning Central with the IDENTICAL 1,394,188 count and field list, five fresh spread probes (Las Vegas 132ms, Reno 203ms, Elko 147ms, Carson City 103ms, Pahrump 178ms) — this is the URL now wired. This service rejects `resultRecordCount` outright ("Pagination is not supported"); it accepts `returnCountOnly`.
- **New York (NY):** The publicly-cited host (gisservices.its.ny.gov) is blocked in this sandbox — same as production is expected to reach it — but the SAME dataset is independently reachable via NY's own official ArcGIS Online organizational account (not a third party), so this wires the mirror rather than parking the whole state on an unreachable primary. 3,827,530 parcels, full schema, covers the 38 counties+NYC that opted in (a companion Footprint layer names which).
- **Ohio (OH):** 6.3M parcels; owner name and appraised value are deliberately absent from this privacy-scrubbed public view (a MailAddressAll field is present as a proxy).
- **Oklahoma (OK):** A real statewide mosaic exists (Property Records Preservation LLC for the OK Office of Geographic Information) but is explicitly published as view/WMS-only with no downloadable or queryable REST FeatureServer/MapServer found on any reachable host.
- **Oregon (OR):** The Tax Lot layer the state's own 'Oregon Parcel Viewer' web app points to returns a real HTTP 400 'Invalid URL' — the service has been retired/unpublished, a genuine dead reference rather than a sandbox block. Every other candidate host (gis.odf.oregon.gov, ormap.net, data.oregon.gov) is blocked. Needs a fresh live search, not just a re-probe of this URL.
- **Pennsylvania (PA):** ⚠ **CORRECTED AGAIN 2026-10-19 — the 2026-09-08 correction below was itself wrong about PASDA:** its directory holds one MapServer per county for ~45 counties (~36 with parcels); see "Pennsylvania counties (2026-10-19)". (Original 2026-09-08 text follows, kept as history.) RETRACTED, corrected 2026-09-08 from the owner's own browser (not this sandbox): PASDA's service directory carries 170 services and EXACTLY ONE parcel service, ErieCountyParcels — county-only. There is no statewide PA parcel mosaic on PASDA. This replaces the prior 'high-confidence follow-up candidate' framing, which is now a confirmed no.
- **Rhode Island (RI):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — risegis.ri.gov is a state .gov host this environment's egress allowlist blocks (the CONNECT tunnel never opens). 'Tax Parcels', polygon, 394,167 parcels, published by RIGIS_ADMIN — the state clearinghouse ITSELF, not a town and not a third-party rehost. Fields: PlatLot (RI's own parcel identifier — with no counties since 1842, each of the 39 towns keys parcels by plat + lot), Acres, E911 and E911_Type (address), TownCode, IMP_sqft, Last_UPD. NO owner, NO appraised value — the same attribute-light standing already given to Hawaii, New Hampshire and Virginia. ⛔ FOUND BY THE AGOL PASS (NEW-2): the item is discoverable on ArcGIS Online (searchable from this sandbox) even though the service it points at is not reachable from here.
- **South Carolina (SC)** *(the original finding was SUPERSEDED 2026-10-19 — all 46 counties are wired, see "South Carolina counties (2026-10-19)")*: the original probe found only the DNR/RFA lookup TABLE of county viewer links and RFA's statement that aggregated parcels are 'secure'-only. A pass 2 / layer-probe search then found RFA's anonymous `Statewide_Parcels` (2.97 M parcels, owner included) as a layer of its public Lexington–Richland web-map service — see the section for the caveat that it was published for another purpose.
- **South Dakota (SD):** No credible statewide aggregation found; a same-named 'SD_Parcels' service turned out to be a flood substantial-damage-assessment layer (SD = Substantial Damage), a false positive ruled out by inspecting its schema. Individual counties run independent systems.
- **Tennessee (TN):** 2,141,289 parcels, id/owner/situs/area present; appraised value requires a join to a separate tax table (LINK_TPAD/LINK_TPV) not included here. Covers 86 of 95 counties — 9 use non-state assessment systems and are excluded.
- **Texas (TX):** Already wired (txgio_statewide) — TxGIO / StratMap Land Parcels, confirmed still healthy this session (HTTP 200, full field set).
- **Utah (UT):** Attribute-light by design: id + situs address present; owner/value require the per-county CAMA system (a CoParcel_URL field links out) and are absent from this layer.
- **Virginia (VA):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — vginmaps.vdem.virginia.gov is blocked here. B1345824 round 1 declined this state on 'the only reachable copy is a third-party rehost' — WRONG: that reading traced to this sandbox never being able to reach VGIN's own host at all, not to the official host being unreachable from a real browser. This IS VGIN's own official host. 'Virginia Parcels', polygon, 9 fields: PARCELID, VGIN_QPID, FIPS, LOCALITY, LASTUPDATE, PTM_ID, OBJECTID, Shape__Area, Shape__Length. Attribute-light by design — no owner, no value, no acreage field (only Shape__Area) — the same standing this repo already gives Hawaii's and New Hampshire's thin schemas; wired anyway on that precedent.
- **Vermont (VT):** One of the richest schemas of the whole probe (full id/owner/situs/area/value), all 247 towns, 339,251 parcels. Layer id is non-standard (665, not 0) — confirmed, not a typo.
- **Washington (WA):** A real, reachable statewide mosaic exists ('Current Parcels', geo.wa.gov) with decent fields, but its own license text states some counties restrict use of their parcels to 'State of Washington business only' — an explicit use restriction, not just a liability disclaimer, that this app's commercial real-estate use may not clear. Flagged for an owner/legal decision rather than wired silently.
- **Wisconsin (WI):** Fullest field set of the whole probe (id/owner/situs/three acreage measures/five value fields), 3,574,646 parcels, hosted by the official WI DOA account, explicitly 'free for public consumption.'
- **West Virginia (WV):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — services.wvgis.wvu.edu is blocked here. B1345824 round 1 declined this state on 'the only reachable copy is a third-party rehost under a named individual's personal account' — WRONG, same mistake as Virginia: this sandbox never reached the WV GIS Technical Center's own host at all. 'WVParcels', polygon, 21 fields: CleanParcelID, FullOwnerName, OWNER1, OWNER2, FullPhysicalAddress, CALC_ACRE, COUNTY, Map, Parcel, Dist, CountyID. No appraised-value field — left absent, never zero or blank. ⛔ Layer 0 is the parcels; sibling layers on the same service are 1 (Districts) and 5 (Site Address Points).
- **Wyoming (WY):** Full schema, 373,666 parcels, hosted directly by the state Property Tax Division's own org, annually updated.

## County-level parcel endpoints (B1455633 / B1455634, 2026-09-10)

This section is per-COUNTY discovery, distinct from the statewide-mosaic hunt above — no statewide
aggregation exists for any of the states below (that is exactly why each county was probed
individually). Wiring detail (idField/addrField/scopeWhere) lives in `counties.js`'s own comments;
verification provenance lives in `countiesProvenance.js`'s `COUNTY_VERIFICATION`. This table records
WHICH DISCOVERY ROUTES WERE TRIED and WHEN, per **STANDING RULE #2** — a county a route did not find
is recorded as "not found by routes 1-2 on 2026-09-10", **never** as "no source", because several of
these almost certainly publish parcels and a stronger search (routes 3+) would likely find them.

**Discovery routes, referenced by number below:**
1. The county's own `.gov`/self-hosted GIS search (this build environment's egress policy blocks
   most such hosts; where blocked, the dispatch's own live-browser measurement is the record).
2. ArcGIS Online's public search API (`www.arcgis.com/sharing/rest/search`), reachable from this
   sandbox — the same "search the state/county's own AGOL organization" method NEW-2 (above)
   systematized for statewide sources, applied here at county granularity.

### Idaho — 13 participating counties (B1455633)

All 13 ride ONE shared service, "Public Idaho Parcels" layer 7 (`services1.arcgis.com/
CNPdEkvnGl65jCX8/.../Public_Idaho_Parcels_/FeatureServer/7`), scoped per county via `scopeWhere` on
the `County` field. Verified live from this sandbox 2026-09-10 (route 2 — services1.arcgis.com):
layer metadata, geometry (`esriGeometryPolygon`, NOT layer 0's `esriGeometryPoint` centroids), a
`County` distinct-values query returning exactly these 13 names, and an `extentCoverageCheck`
confirming the layer covers only 66% of Idaho's latitude span — consistent with 13 of 44 counties,
not statewide. A pin in any of Idaho's other 31 counties correctly reports no source.

| County | Wired key | Notes |
|---|---|---|
| Ada (Boise) | `id_ada` | Boise envelope query answered in 1,682ms — inside the app's 8s budget despite this being a comparatively slow service. |
| Bear Lake | `id_bearlake` | |
| Boise (Idaho City) | `id_boise` | Not the city of Boise, which sits in Ada County. |
| Camas | `id_camas` | |
| Gooding | `id_gooding` | |
| Jerome | `id_jerome` | |
| Lincoln | `id_lincoln` | |
| Minidoka | `id_minidoka` | |
| Nez Perce (Lewiston) | `id_nezperce` | |
| Oneida | `id_oneida` | |
| Teton (Driggs) | `id_teton` | |
| Valley (Cascade/McCall) | `id_valley` | |
| Washington (Weiser) | `id_washington` | Not Washington County, TX. |

**Not participating** (all 31 remaining Idaho counties, incl. Coeur d'Alene/Kootenai, Sandpoint/Bonner,
Idaho Falls/Bonneville, Twin Falls) — confirmed live: the dispatch's own point queries at Coeur
d'Alene, Sandpoint, Idaho Falls and Twin Falls all returned ZERO (3.8–5.1s), the same wrong-scope
signature the county-level `County` distinct-values query independently confirms. A pin in any of
these must report no source, never a silent zero drawn as if the layer covered them.

## Idaho counties (2026-10-19)

B2317920, owner request "start wiring all the remaining states into Planner". **34 of 44 counties wired** (13 on the OITS layer above + 21 on their own county/assessor services, module `lib/idParcels.js`); **10 are named gaps** with a recorded reason. Re-measured from this session: the State's own tracker (`TIM_Parcels_Progress`, State of Idaho ArcGIS org) still lists exactly the 13 OITS participants (status S / UPP) and every other county as "AS"; OITS layer 7's `County` field still holds exactly the same 13 names. The 2026-09-09 statewide probe's Idaho verdict is superseded.

**How it was searched.** The sandbox reaches only `*.arcgis.com`, so: (1) ArcGIS Online item search, bbox-filtered to Idaho, ~3,650 Feature/Map services, every polygon layer's extent probed (county-sized + parcel-ish fields); (2) per-county AGOL searches; (3) the Idaho State Tax Commission's "County Parcel Maps" links page (item `6b5a5290…`) and every county web map/app it links, read for their real layer URLs; (4) county portals' own `sharing/rest/search` and REST directories, read through the `/gis-proxy` relay on the PR preview deploy (non-AGOL hosts are unreachable from the sandbox); (5) web search for each gap county. Each wired row: 8 parcels sampled evenly across the layer each resolved (by centroid) to the right county and each re-found by a point query returning its parcel id; plus point queries at 6 spread interior and up to 3 county-line points.

| County | Key | Source | Owner | Notes |
|---|---|---|---|---|
| Adams | `id_adams` | AGOL Parcels (Adams County Assessor) | no | id + acres + situs only |
| Bannock | `id_bannock` | AGOL Parcels_GDB (county org) | yes | edited day of check |
| Bingham | `id_bingham` | web.binghamid.gov Public/Instrument_Numbers (relay) | yes | 39,883 |
| Blaine | `id_blaine` | maps.blainecountyid.gov Parcel_Information_Service_V2/5 (relay) | yes | 24,310 |
| Bonner | `id_bonner` | AGOL TaxParcels2020 (Bonner County GIS org) | yes | 45,352; edited 2026-09-22 |
| Bonneville | `id_bonneville` | AGOL Parcel_Viewer (county org) | yes | 65,357 |
| Boundary | `id_boundary` | AGOL Boundary_Parcels_Public (State org, Panhandle Health) | mailing name | ProVal `ps_mail_nm` |
| Butte | `id_butte` | AGOL Butte_County_Parcels_-_View | yes | no situs |
| Canyon | `id_canyon` | maps.canyonco.org arcgisserver Public_Tax_Parcels (relay) | **no** | 103,060; county layer has no owner. A 2018 AlertSense copy has OwnerName but is 8 years stale — not used |
| Clearwater | `id_clearwater` | AGOL Parcels_view (county org) | yes | edited 2026-10-04 |
| Elmore | `id_elmore` | AGOL PARCEL_DATA (**City of Mountain Home** org) | yes | publisher is the city; edited 2025-11 |
| Franklin | `id_franklin` | AGOL fr_parcels_090226 | yes | edited 2026-09-17 |
| Fremont | `id_fremont` | AGOL Parcels/6 (Fremont assessor org) | no | PIDN only |
| Idaho | `id_idaho` | AGOL Parcels (county org) | yes | id = `PS_PAR_15` (`Parcel_ID` is empty) |
| Jefferson | `id_jefferson` | gisportal.co.jefferson.id.us archost Assessor/Historic_Parcels/0 "2025" (relay) | yes | county's roll-year snapshot; live fabric has parcel # only |
| Kootenai | `id_kootenai` | map.kcgov.us ASSR_Dynamic_Layers_gisapp2022/9 (relay) | yes | 94,863; gis.kcgov.us host is down ("could not access any server machines") |
| Latah | `id_latah` | gis.latah.id.us arcgis Parcels3 (relay) | mailing name | `PM_MAIL_NM` |
| Lewis | `id_lewis` | AGOL POL_Parcels/4 (third-party admin org) | no | edited 2023-09 — stale, flagged |
| Madison | `id_madison` | madison.rexburg.org mrgis Data/Parcels (relay) | yes | 17,769 |
| Owyhee | `id_owyhee` | AGOL D3_Parcels/6 (ITD District 3 compile) | yes | edited 2023-05 — stale, flagged; nothing fresher found |
| Shoshone | `id_shoshone` | AGOL Shoshone_Parcels (flo_publisher) | yes | edited 2020-12 — stale, flagged |

**The 10 gaps, and what was searched (not "no source" — each has a specific blocker):**

| County | What exists | Why it is not wired |
|---|---|---|
| Benewah, Caribou, Cassia, Gem, Lemhi, Payette, Power, Twin Falls | A county parcel map on the Idaho State Tax Commission's ArcGIS org (Experience Builder apps). Their parcel layers are `utility.arcgis.com/usrsvcs/servers/<id>/…` services | Every one answers HTTP 403 `GWM_0003` ("You do not have permissions") to an anonymous query, with or without an experience.arcgis.com Referer/Origin — the layers are token-gated behind the ISTC proxy. Not a format we could read; a key we do not have |
| Lemhi (also) | `gisu.rdc.isu.edu/server/rest/services/Lemhi_County_Land_Ownership/MapServer` (ISU GIS center) | 502 from the relay on 2026-10-19; re-try when the host is up |
| Clark, Custer | `maps.terragis.net/<county>/` (GWmap MapServer) | Behind a "must accept terms of use" gate with a shapefile download; `robots.txt` disallows the map server paths; no open REST. Not worked around |
| All 8 ISTC counties + Gem, Owyhee, Payette, Washington, Lemhi, Bear Lake | `maps.idahoparcels.us` (ISTC GeoMoose over MapServer) | `robots.txt` is `Disallow: /`, and every other path returns Cloudflare 520 through the relay. Not used |
| Statewide | IDWR `Reference/Parcels` (gis.idwr.idaho.gov) compiles every county | Its own description: "This dataset cannot be shared outside IDWR". **Rejected on licence grounds**; the host is not on the relay allow-list |
| Statewide | Regrid vector tiles on ITD (gisp.itd.idaho.gov), Equator Studios, ReportAll, Land Records | Commercial / licensed aggregators, not used |

**Open items for the owner:** Elmore (city-published), Lewis, Owyhee and Shoshone are wired on stale or non-county publishers because nothing fresher is public; Canyon, Adams, Fremont, Lewis return no owner. The 8 token-gated counties would open if the Tax Commission or the county will share a public (or keyed) endpoint — that is a request to make, not a build.

### 19 measured county endpoints across 12 states (B1455634)

| State | County | Wired key | Route | Date | Notes |
|---|---|---|---|---|---|
| IL | Cook | `il_cook` | 1 (dispatch browser; host blocked here) | 2026-09-10 | |
| IL | DuPage | `il_dupage` | 1 (dispatch browser; host blocked here) | 2026-09-10 | |
| IL | Will | `il_will` | 1 (dispatch browser; host blocked here) | 2026-09-10 | |
| PA | Allegheny | `pa_allegheny` | 1 (dispatch browser; host blocked here) | 2026-09-10 | |
| PA | Northampton | `pa_northampton` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 122,379 parcels, 57 fields. |
| PA | Cumberland | `pa_cumberland` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 104,637 parcels, 41 fields. |
| GA | Gwinnett | `ga_gwinnett` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 309,658 parcels; independently corroborated in this doc's own "unlinked hits" table above. |
| MI | Oakland | `mi_oakland` | 1 (dispatch; URL truncated) + route 2 to re-resolve the exact layer | 2026-09-10 | Resolved to "OC Tax Parcels (Public)", layer 1 of `EnterpriseOpenParcelDataMapService` — owner OCAGOAdmin, the county's own org. |
| KS | Wyandotte | `ks_wyandotte` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 68,993 parcels; attribute-light by design (id + acreage only). |
| MO | Platte | `mo_platte` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 45,149 parcels; attribute-light by design. |
| OR | Multnomah | `or_multnomah` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 284,349 parcels, 49 fields. |
| OR | Clackamas | `or_clackamas` | 1 (dispatch URL was a different, wrong layer) + route 2 to find the real one | 2026-09-10 | ⛔ TRAP: the dispatch's URL (`Taxlot_additional_records_public/FeatureServer/2`) is a supplementary POINT table, 3,470 features, published by the regional OregonMetro.RLIS account. Resolved to Clackamas County's OWN GIS org (CCGISWebService) "Taxlots" service instead — 163,927 polygon parcels, verified live. |
| KY | Jefferson (Louisville) | `ky_jefferson` | 1 (dispatch browser; host blocked here) | 2026-09-10 | LOJIC (Louisville/Jefferson County Information Consortium). |
| MS | DeSoto | `ms_desoto` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 80,950 parcels, 55 fields. |
| MS | Hinds | **excluded — see below** | 1 + 2 (both confirm it is NOT wireable) | 2026-09-10 | |
| OK | Oklahoma | `ok_oklahoma` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 337,029 parcels, 45 fields. |
| OK | Tulsa | `ok_tulsa` | 1 (dispatch; URL truncated) + route 2 to re-resolve | 2026-09-10 | Resolved to the Tulsa County Assessor's own service (`asps0305.tulsacounty.org`, owner `tca_cperkins`) — the dispatch's cited `services3.arcgis.com` host under this same account carries only ancillary tables, not the main parcel layer. |
| LA | East Baton Rouge | `la_eastbatonrouge` | 1 + re-verified route 2 (sandbox-reachable) | 2026-09-10 | 205,820 parcels, 13 fields. |
| AL | Jefferson (Birmingham) | `al_jefferson` | 1 (dispatch browser; host blocked here); re-measured through the relay 2026-10-16 (B2302784) | 2026-09-10 | |

### Tier 1 (Hillwood-market) counties — B1551617, 2026-09-11

`ui-audit/discover-county-parcels.mjs` (this repo's dedicated county-discovery harness — four
routes: ArcGIS Hub dataset API, ArcGIS Online item search, county-hostname pattern + REST-directory
walk, state open-data org search) ran against the 22-county Tier 1 roster (metros where Hillwood is
active). Every accepted candidate passed the harness's acceptance test LIVE from this sandbox: a
point query inside the 8s timing budget, ownership-shaped attributes with a REAL populated value
(not just present in the schema), and three geometry-verified spread points across the WHOLE county
— never just the seat, the check built specifically to catch a City-offered-as-County error.

| State | County | Wired key | Route | Date | Notes |
|---|---|---|---|---|---|
| GA | Fulton | `ga_fulton` | 1 (ArcGIS Hub) | 2026-09-11 | 373,296 parcels, 28 fields. Replaces the excluded `Tax_Parcels2018` below. |
| GA | Chatham | `ga_chatham` | 2 (AGOL search) | 2026-09-11 | 126,490 parcels, 47 fields. Previously "not found" (2026-09-10). |
| AZ | Pinal | `az_pinal` | 2 (AGOL search) | 2026-09-11 | 286,959 parcels, 74 fields. Published by the City of Maricopa's own GIS; confirmed county-wide, not city-only, by 3 spread points 50-80 miles apart. |
| AZ | Maricopa | `az_maricopa` | 3 (county hostname) | 2026-09-11/12 | 1,760,396 parcels, capabilities Map/Query/Data. `gis.maricopa.gov/.../IndividualService/Parcel/MapServer/1` — layer 1 ("Parcel"), not layer 0 ("Subdivision"). Measured LIVE from Michael's own browser 2026-09-11 evening Central (this sandbox's egress policy still blocks `gis.maricopa.gov` — B1339920): 4-point spread Phoenix/Mesa/Surprise/Buckeye, each a real APN, each under 250ms. **This closes the B1339920 bug** — Phoenix had been silently routed to `az_pinal`'s bbox (Pinal's own measured extent overlaps southern Maricopa County) and queried a service with zero Phoenix parcels. |
| MO | Clay | `mo_clay` | 2 (AGOL search) | 2026-09-11 | 98,112 parcels, 40 fields. Previously "not found" (2026-09-10). |
| SC | Greenville | `sc_greenville` | 2 (AGOL search) | 2026-09-11 | 215,484 parcels, 55 fields. Replaces the excluded `Parcel_Sizes_2018_WFL1` below. |
| IA | Polk | `ia_polk` | 1 (ArcGIS Hub) | 2026-09-11 | 219,672 parcels, 49 fields. Previously "not found" (2026-09-10). |
| PA | Lehigh | `pa_lehigh` | 2 (AGOL search) | 2026-09-11 | 127,043 parcels, 21 fields. Same service CONTAINER as the excluded `ATestParcel` below, different layer — see that entry. |
| NM | Bernalillo | `nm_bernalillo` | 2 (AGOL search) | 2026-09-11 | 257,283 parcels, 16 fields. Previously "not found" (2026-09-10). |
| IL | Kane | `il_kane` | 2 (AGOL search) | 2026-09-11 | 187,336 parcels, 48 fields. |
| LA | Orleans **Parish** | `la_orleans` | 3 (jurisdiction hostname) | 2026-09-11/12 | `gis.nola.gov/arcgis/rest/services/ParcelSearch/MapServer/0` — layer 0 "parcels", the service's ONLY layer; capabilities Map/Query/Data. Measured LIVE from Michael's own browser 2026-09-11 evening Central (this sandbox's egress blocks `gis.nola.gov`, re-confirmed HTTP 403 while wiring — B1574256). 3-point spread across the whole parish: CBD 114ms/357 feat. (PARCELID 41036654, "826 UNION ST, LA", OWNERNME1 "CONDO MASTER") · Algiers 94ms/246 feat. (41001272, "1306 PACIFIC AVE, LA, 70114") · Lakeview 65ms/224 feat. (41011510, "6198 MILNE BLVD, LA, 70124"). Fields: PARCELID, SITEADDRESS, OWNERNME1, OWNERNME2, TAXBILLID. **Previously "not found" on the 2026-09-10 (routes 1-2) and 2026-09-11 (routes 1-4) passes — this CORRECTS both.** |

Route 3 (county hostname + REST-directory walk) found candidate hosts for several remaining
counties — see "Not found by routes 1-4" below — and every one is a custom county/city domain this
sandbox's egress policy blocks; route 3's own code ran correctly and reports each as
`blocked-in-sandbox`, distinct from "nothing found." **One of them, Maricopa AZ's `gis.maricopa.gov`,
was live-verified from Michael's own browser 2026-09-11/12 and is now wired (`az_maricopa` in the
Tier 1 table above) — B1339920/B1339921.** A different three (Macomb MI, Johnson KS, Jackson MO)
were ALSO re-tried from Michael's own browser and did NOT answer even with open egress — those are
recorded as genuinely not found by routes 1-3, not sandbox-blocked (see "Not found by routes 1-4"
below). Route 4 (state open-data org search) surfaced no additional accepted candidate beyond what
routes 1-2 already found for this roster.

### Tier 1 continuation — 2026-09-15

All eight measured live from Michael's own browser 2026-09-15; three (`sd_pennington`, `mi_macomb`,
`mo_independence`) additionally confirmed reachable, with matching field lists, directly from this
sandbox the same day (all three sit on `*.arcgis.com`).

| State | County/City | Wired key | Notes |
|---|---|---|---|
| SD | Pennington | `sd_pennington` | 52,547 parcels, extent matching the county (Rapid City). South Dakota had ZERO parcel coverage before this session. |
| SD | Minnehaha (rural remainder) | `sd_minnehaha` | ⛔ **THE CITY-HOLE, worked example.** 23,044 parcels across the whole-county extent — count and extent both look correct — but a point query at downtown Sioux Falls (its own largest city) returns ZERO; a rural point 15 miles away returns a real parcel. This is now a NAMED TRAP in `ui-audit/discover-county-parcels.mjs`'s acceptance test (`largestCity` probe, run separately from the three generic spread points). |
| SD | Sioux Falls (city) | `sd_siouxfalls` | City-scoped (`cityScopes.js`) — fills the hole above. 67,022 parcels. Boundary ring sourced from Esri's Living Atlas Census Populated Places (the city's own AGOL account publishes no reachable mirror of its real "City Limits" layer). |
| PA | Luzerne | `pa_luzerne` | 176,385 parcels. **CLOSES the 2026-09-11 lead below** — `gis.luzernecounty.org` was already recorded as a real, correctly-named candidate blocked in this sandbox; it answers from an open-egress browser, confirming that record rather than correcting it. Layer 1 is the parcel layer; layer 6 on the same service is Improvements, not wired. |
| PA | Lackawanna | `pa_lackawanna` | 103,145 parcels, Esri parcel-fabric schema (`Name` = the 13-digit PIN). **CLOSES the 2026-09-11 lead below** — same shape as Luzerne. |
| MI | Macomb | `mi_macomb` | 332,971 parcels, on `services6.arcgis.com` (an AGOL-hosted layer, not `gis.macombgov.org` — the county's own host that the 2026-09-11 "not found by routes 1-3, tried from Michael's own browser" record below genuinely could not reach). **Different endpoint, not a correction of that finding** — the county host is still unreached; this is a separately-published copy. ⛔ Published under a personal AGOL account, not a county org — flagged as a provenance/vintage risk, the same shape as the Texas statewide source whose owner deleted it. |
| MO | Kansas City (city) | `mo_kansascity` | City-scoped (`cityScopes.js`), spans Jackson/Clay/Platte/Cass counties — the ring test is county-agnostic, so one layer answers regardless of county. 203,425 parcels. The city's own AGOL-hosted "CityLimit" boundary layer answers `returnCountOnly` with 0 features (an empty hosted layer, not a reachability block) — the boundary ring instead comes from Esri's Living Atlas Census Populated Places. |
| MO | Independence (city) | `mo_independence` | City-scoped, wholly within Jackson County. 73,154 parcels. |

**Jackson County, MO still has no COUNTYWIDE source** — this correction is about the two cities
inside it, not the county. `gis.jacksongov.org` / `maps.jacksongov.org` still did not answer (see
below); Kansas City and Independence together are what Jackson County gets, exactly the shape this
repo already uses for Wayne County MI (Detroit) — the rest of Jackson County (Lee's Summit, Blue
Springs, Grandview, unincorporated land, …) has no source wired, an honest gap, not a defect.

**Washington statewide parcels remain declined on LICENCE grounds, unchanged (B759/760).** A
2026-09-12 brief separately instructed wiring Washington statewide; that instruction was WRONG and
was retracted by the same 2026-09-15 dispatch that produced the rows above — this repo's own record
(above, "Washington (WA)") already flags the WA Geospatial Portal's parcel mosaic as licence-restricted
("State of Washington business only" for some counties) and pending an owner decision. Washington
was correctly NOT touched this session.

### Excluded — measured, answered, and deliberately NOT wired

Recorded here so nobody re-adds them without re-deriving the same answer:

- **Hinds County, MS.** The dispatch's URL (`services8.arcgis.com/dXKNoCSoFLBzx24o/.../Parcels/
  FeatureServer/0`) is published by a Jackson State University STUDENT account
  (`J00937011@students.jsums.edu_OneJSU`), not the county, and holds only 188 features against a
  county of ~250,000 people — objectively too small to be the real parcel fabric, confirmed live
  from this sandbox (route 2). The county's own real candidates — `gisweb.co.hinds.ms.us` (owner
  `kadcock`, "Hinds County Parcel Map") and `gis.cmpdd.org` (Central Mississippi Planning &
  Development District, "Parcels - MS - Hinds County") — are both blocked from this sandbox (route
  1 could not confirm them) and are recorded as **candidates, not shipped** — the same
  evidence bar as every other `candidateUrl` in `countiesProvenance.js`.
- **Fulton County, GA** — `Tax_Parcels2018`: a 2018 snapshot, stale. **RESOLVED 2026-09-11** — see
  the Tier 1 table above (`ga_fulton`).
- **Greenville County, SC** — `Parcel_Sizes_2018_WFL1`: 2018 AND a derived-acreage layer, not the
  parcel layer itself. **RESOLVED 2026-09-11** — see the Tier 1 table above (`sc_greenville`).
- **Maricopa County, AZ** — `parcels_maricnty_2007`/`parcels_maricnty_2019`: Maricopa publishes six
  vintages side by side (2004/2007/2008/2011/2019/2021); a search returns a different one arbitrarily
  run to run — needs a deliberate current-vintage pick, not a re-run of the same search; both named
  vintages are stale (>5yr) and correctly hard-rejected by `rejectCandidate` on sight, at zero
  network cost. **RESOLVED 2026-09-11/12 (B1339920) — see the Tier 1 table above (`az_maricopa`).**
  `gis.maricopa.gov` (found via route 3's hostname harvest on 2026-09-11, blocked-in-sandbox that
  session) was measured LIVE from Michael's own browser on 2026-09-11 evening Central and wired.
  Route 3's own hostname-pattern generator was also missing the bare `gis.<name>.gov` shape this
  host uses (every prior guess glued "county" into the hostname) — fixed in the same session
  (B1339921) so this class resolves on the first try, not only via lucky harvest.
- **Lehigh County, PA** — `ATestParcel`: named as a test service by its own publisher. **RESOLVED
  2026-09-11** — see the Tier 1 table above (`pa_lehigh`). Correction to the record: this is the
  SAME underlying ArcGIS service container, not a different one — inspecting it directly showed
  layer 0 is an unrelated "Owner" POINT layer (genuinely test-shaped, correctly excluded) while
  layer 1 is a real, current, 127,043-feature POLYGON parcel layer titled "Parcels - PA - Lehigh
  County" in its own AGOL listing. The container's own name is a publisher naming quirk, not a
  claim about every layer inside it.
- **Wayne County, MI** — `Detroit_MP_Parcel_Authoritative`: this is the CITY OF DETROIT, not Wayne
  County — the same wrong-scope failure mode as the Nebraska defect (answers correctly downtown,
  silently returns nothing across most of the county). **RE-ATTEMPTED 2026-09-11 (B1551617)**,
  still unresolved AT THE COUNTY LEVEL: routes 1/2/4 found several real "Wayne County" candidates,
  but every one either fails a spread point outright (covers only part of the county) or is itself
  stale — the best-scoring one, "Parcels - MI - Wayne County" (owner GDITAdmin), carries no year in
  its title but its own `editingInfo.dataLastEditDate` is 2018, 8 years stale, caught only because
  this session's harness was extended to check that field too (see BACKLOG.md). Route 3 found
  `gis.macombgov.org` for the neighboring county (Macomb, below) but no equivalently-named Wayne
  County host, and a re-attempt from Michael's own browser (open egress) still did not answer
  (`gis.waynecounty.com` / `maps.waynecounty.com` / `gisapps.waynecounty.com` — B1574256, and again
  B1583297) — genuinely harder, not a sandbox artifact.
  **✅ WIRED SEPARATELY, CITY-SCOPED, 2026-09-12 (B1583296): `mi_detroit`.** The rejection above is
  UNCHANGED and permanent AT THE COUNTY GRANULARITY — `Detroit_MP_Parcel_Authoritative` is still
  never registered as `wayne`/`mi_wayne`. What changed is a genuinely new resolution TIER
  (`src/workspaces/site-planner/lib/cityScopes.js`): a bundled City of Detroit boundary polygon
  (sourced from the City of Detroit's own ArcGIS Online org, `OpenDataAdmin_detroitmi`, item
  `86b221bb68ca4364afe81d156e54f95c`, `public_authoritative`) is checked BEFORE the county-level
  answer, so a point genuinely inside Detroit's own limits now resolves to `mi_detroit` while every
  other Wayne County city (Livonia, Taylor, Dearborn, …) still correctly reports no parcel source —
  proven against exactly those two control points. This was a genuine architectural addition, not a
  config line — see B1583296 (BACKLOG.md) and `cityScopes.js`'s own header for the full reasoning.
  Wayne County's own gap — everywhere in the county OUTSIDE Detroit — is UNCHANGED and is what
  B1583297's fourth-route candidates (Michigan's own open-data portal, SEMCOG) target next.

### Not found by routes 1-4 on 2026-09-11 (B1551617) — expands the 2026-09-10 pass; recorded as such, NEVER as "no source"

The original 2026-09-10 pass (routes 1-2 only) listed sixteen counties as not found. This session
re-ran the ones on the Tier 1 roster with the fuller four-route harness. **Five are now wired** —
Chatham GA, Pinal AZ, Clay MO, Polk IA, Bernalillo NM — see the Tier 1 table above. The rest,
plus new counties added to this roster, are recorded below by what was actually tried:

**Real, correctly-named candidate host found by route 3, blocked by this sandbox's egress policy —
strong leads for a live pass, not a guess:**
- **Bartow County, GA** — `www.bartowgis.org`, AGOL item "Parcels - GA - Bartow County".
- **Cobb County, GA** — `gis.cobbcounty.org`, AGOL item "Parcels - GA - Cobb County".
- **Spartanburg County, SC** — `smpesri.scdot.org`, AGOL item "Parcels - SC - Spartanburg County".
- **Luzerne County, PA** — `gis.luzernecounty.org`, AGOL items "Luzerne County Parcels" AND
  "Parcels - PA - Luzerne County" (two, same host). **✅ WIRED 2026-09-15 — see "Tier 1
  continuation" above (`pa_luzerne`).**
- **Lackawanna County, PA** — `gis.lackawannacounty.org`, AGOL item "Lackawanna County Parcels".
  **✅ WIRED 2026-09-15 — see "Tier 1 continuation" above (`pa_lackawanna`).**

**Re-attempted this session, no good candidate on any route — every hit was either wrong-state
noise (a same-named county elsewhere: Jackson County OR for Jackson MO, Winnebago County WI for
Winnebago IL, Johnson County MO for Johnson KS, Niagara County NY for Orleans LA) or a generic,
unrelated "County Cadastral Layers"-titled host that recurred across many unrelated queries:**
Henry (GA) · Winnebago (IL) · ~~Orleans (LA)~~.

> **✅ ORLEANS PARISH IS NO LONGER IN THAT LIST — CORRECTED 2026-09-12 (B1574256).** It was
> measured live from Michael's own browser at `gis.nola.gov/arcgis/rest/services`, whose root
> service list carries `ParcelSearch` directly, and is now wired as `la_orleans` (Tier 1 table
> above). The "Niagara County NY" hit recorded above is exactly the wrong-state noise routes 1-2
> produce for a parish name; **route 3 found it immediately.** Left struck-through rather than
> deleted so the failed-route record stays readable — the point of this section is what was tried,
> not only what worked.

**Not found by routes 1-3 on 2026-09-11 — tried from Michael's OWN browser (open egress, not this
sandbox) and STILL did not answer, so these are genuinely harder than a sandbox block, never "no
source":**
- **Macomb County, MI** — `gis.macombgov.org` (the route 3 hostname harvest's own candidate,
  AGOL item "Parcels - MI - Macomb County") did not answer live either. This finding is UNCHANGED —
  `mi_macomb` (wired 2026-09-15, "Tier 1 continuation" above) is a DIFFERENT, separately-published
  AGOL layer on `services6.arcgis.com`, not this host answering after all.
- **Johnson County, KS** — `aims.jocogov.org` did not answer live.
- **Jackson County, MO** — `gis.jacksongov.org` did not answer live. Still true at the COUNTY level —
  see "Tier 1 continuation" above for why Kansas City and Independence (both CITY-scoped, wired
  2026-09-15) are what Jackson County gets instead.

**Not on this session's Tier 1 roster, unchanged from the 2026-09-10 pass — several almost
certainly publish parcels through a route not yet tried against them specifically:**
Ingham (MI) · Washington (OR) · Boone (KY).

### Not found by routes 1-3 on 2026-09-11, tried from Michael's OWN browser (B1574256)

⛔ **Recorded as "not found by routes 1-3 on 2026-09-11" — NEVER as "no source."** These hostnames
did not answer at all from a browser with fully open egress, so they are genuinely harder rather
than an artifact of this sandbox's egress policy. Several of these counties almost certainly do
publish parcels somewhere; what is established is that the county-GIS-hostname route did not reach
them, which is a much narrower claim.

| State | County | Hostnames tried, none answered |
|---|---|---|
| MI | Wayne (outside Detroit) | `gis.waynecounty.com` · `maps.waynecounty.com` · `gisapps.waynecounty.com` — reconfirmed 2026-09-11 evening (B1583297). **The City of Detroit ITSELF, inside Wayne County, is now wired separately as a city-scoped source (`mi_detroit`, B1583296) — this row is about the COUNTY-wide gap only, i.e. every Wayne County city that is not Detroit.** |
| MI | Macomb | `gis.macombgov.org` · `maps.macombgov.org` — reconfirmed 2026-09-11 evening (B1583297); still unreached. `mi_macomb` (wired 2026-09-15) is a different, separately-published AGOL layer, not this host. |
| GA | Cobb | `gis.cobbcounty.org` · `gis.cobbcounty.gov` — reconfirmed 2026-09-11 evening (B1583297). |
| GA | Fulton | `gis.fultoncountyga.gov` · `gisdata.fultoncountyga.gov` (already wired via route 1 — `ga_fulton` — so this is the hostname route failing, not the county; the county's OWN host might carry a fresher vintage than the AGOL copy, which is why this is still worth closing) — reconfirmed 2026-09-11 evening (B1583297). |
| GA | Henry | `gis.co.henry.ga.us` — reconfirmed 2026-09-11 evening (B1583297). |
| PA | Luzerne | `gis.luzernecounty.org` — reconfirmed 2026-09-11 evening (B1583297). ✅ WIRED 2026-09-15 (`pa_luzerne`) — this host answers from open egress. |
| PA | Lackawanna | `maps.lackawannacounty.org` — reconfirmed 2026-09-11 evening (B1583297). ✅ WIRED 2026-09-15 (`pa_lackawanna`) — this host answers from open egress. |
| IL | Winnebago | `gis.wincoil.gov` — reconfirmed 2026-09-11 evening (B1583297). |
| MO | Clay | `gis.claycountymo.gov` (already wired via route 2 — `mo_clay` — same note as Fulton) — reconfirmed 2026-09-11 evening (B1583297). |
| MO | Jackson | `gis.jacksongov.org` · `maps.jacksongov.org` — reconfirmed 2026-09-11 evening (B1583297); still no countywide source. Kansas City and Independence, both CITY-scoped, wired 2026-09-15 — see "Tier 1 continuation" above. |

**⚠ Johnson County, KS is a DIFFERENT case and deserves its own line, because its host DID answer.**
`aims.jocogov.org` / `gis.jocogov.org` / **`maps.jocogov.org`** (the third hostname added 2026-09-11
evening, B1583297 — same answer, same session) responded and served a real REST directory — it
simply carries **no parcel service**. The folders listed are: `Edgerton`, `JCW_UtilityMapping`,
`Mission`, `PrairieVillage`, `SpringHill`, `Test`, `Utilities`, `WebEOC` — city utility layers,
nothing cadastral. So Johnson County's parcel data is published **somewhere else**, and "the county
GIS host has no parcels" is a finding that points at the next step rather than closing the question.
Kansas City is a Hillwood market, so this is worth a targeted look: the county's AIMS (Automated
Information Mapping System) program and its open-data portal are the obvious next candidates, and
neither has been probed by name. This supersedes the earlier, vaguer "`aims.jocogov.org` did not
answer live" note above, which was wrong about the host — it answered.

**PASDA is not a route to Pennsylvania county parcels generally** (reconfirmed 2026-09-11 evening,
B1583297; originally established 2026-09-08 — see the Pennsylvania state-level note above): its
service directory carries 170 services, of which EXACTLY ONE is parcels (`ErieCountyParcels`,
county-only). So Luzerne and Lackawanna — both Pennsylvania — cannot be found via a PA-statewide
aggregator; each needs its own per-county route, which is exactly what routes 1-3 already tried and
failed to find above.

### A fourth route to try next for the still-missing counties (B1583297, filed 2026-09-11 evening)

None of these have been attempted yet against the ten counties still open above (Wayne outside
Detroit, Macomb MI, Winnebago IL, Luzerne PA, Lackawanna PA, Cobb GA, Fulton GA's own current-vintage
host, Henry GA, Clay MO, Jackson MO) or against Johnson County KS's still-unlocated parcel service.
Filed as the next step rather than left as a dead end, per the owner's own instruction:

- **State open-data portals under their own naming**, distinct from a state GIS AGENCY's own
  `.gov` host (the route this session already tried and the sandbox blocks) — e.g. Michigan's
  `gis-michigan.opendata.arcgis.com` and the Illinois and Georgia equivalents. This is the SAME
  method NEW-2 (above, in the statewide-mosaic hunt) used to rescue California and Rhode Island from
  a false "no free source" — searching a state's own ArcGIS Online ORGANIZATION rather than only its
  `.gov` GIS host — applied here at county rather than state granularity.
- **Regional planning agencies**, which sometimes host or mirror a member county's parcel data even
  when the county's own GIS host is unreachable or has none: SEMCOG (Southeast Michigan Council of
  Governments) for Wayne-outside-Detroit and Macomb, ARC (Atlanta Regional Commission) for Cobb,
  Fulton and Henry, and MARC (Mid-America Regional Council) for Johnson KS and Jackson MO.
- **County assessor web apps whose underlying service is not titled "parcels"** — several counties
  in this repo's own history published their real parcel fabric under a name that would never match
  a "parcels" keyword search (Nebraska's own case, and Tulsa County OK's `TCA_Mapping_Application`,
  found only by walking the service directly rather than searching its title). Worth a targeted
  service-directory walk (route 3's own method, one level deeper) once a candidate host is found for
  any of the counties above.

### Route 3 is now three-for-three where routes 1 and 2 failed

Worth stating plainly because it is the pattern that keeps working, and it changes where a future
session should spend its first attempt. Routes 1 (ArcGIS Hub dataset API) and 2 (ArcGIS Online item
search) are cheap and should still run first — they found 8 of the 11 Tier 1 counties wired so far.
But when they come up empty or return only wrong-state noise, **the jurisdiction's OWN GIS hostname
has succeeded every single time it has been reachable:**

| County | Host | Wired as | Item |
|---|---|---|---|
| Maricopa AZ | `gis.maricopa.gov/arcgis/rest/services` | `az_maricopa` | B1339920 |
| Allegheny PA | county GIS host | `pa_allegheny` | B1455634 |
| Orleans Parish LA | `gis.nola.gov/arcgis/rest/services` | `la_orleans` | B1574256 |

In all three the ROOT service list carried the parcel service directly — no deep search needed once
the right host was in hand. The standing limitation is unchanged and is the whole reason this is a
pattern rather than a rule: **route 3's hosts are custom jurisdiction domains that this sandbox's
egress policy blocks**, so a Claude Code session can find the candidate but usually cannot verify
it. Verification comes from Michael's own browser or a Cowork session. (`gis.nola.gov` was
re-probed from this sandbox while wiring `la_orleans` and returned HTTP 403 at the CONNECT tunnel —
the block is live, not historical.)

### Georgia — 24-county dispatch, 2026-09-23 (NEW-1)

An owner chat block named 24 GA counties, most with a "confirmed" URL to probe and a handful as
"Hub endpoints" (an ArcGIS Online item id to resolve). **11 wired, 13 not** — see `counties.js`'s
own NEW-1 comment block (right after `ga_chatham`) and the matching `COUNTY_VERIFICATION` rows in
`countiesProvenance.js` for the per-county evidence. This section is the fuller record.

**⛔ CORRECTED (B1873776, same day) — "13 not" was a REACHABILITY statement about THIS SANDBOX,
never a finding about the counties, and it is now known to be wrong for eleven of the thirteen.**
Every host this section calls blocked below was reachable — and answered real parcel data — from
Michael's own signed-in Chrome; see **"Georgia second pass, 2026-09-23"** at the end of this
section for the eleven that are now wired, the two mechanisms that fixing them needed
(`arcgis.js`'s pagination-unsupported fallback for Bryan County; `parcelQuery.js`'s field pin for
Jackson/Bibb/Rockdale), and what remains genuinely unwired (only Long and Walton — neither has a
usable public parcel source).

**Two of the dispatch's own "confirmed" answers were a WRONG SOURCE, caught only by checking real
sampled attribute values against Georgia's own geography rather than trusting a title, a field
name, or a plausible-looking hostname:**
- **`ga_walton`'s given URL** (`services1.arcgis.com/TaXHPwWfIMuzJ7Ov/.../WaltonCountyPropeties`)
  is Walton County, **FLORIDA** — sampled features read `OWN_CITY: "DEFUNIAK SPRINGS"`,
  `OWN_STATE: "FL"` (DeFuniak Springs is Walton County FL's own county seat), and its own sibling
  layers are named `Walton_County_Parcels_South_Walton...` — "South Walton" is the well-known
  Florida Gulf Coast beach community, not anything in Georgia. An AGOL search for the REAL Georgia
  Walton County turned up exactly one candidate, `Parcels_Walton_2019` under the Atlanta Regional
  Commission's org — but the service is now dead (`FeatureServer?f=json` itself returns ArcGIS's
  "Invalid URL" error, not just the layer), and it would have been stale (2019, >5yr) even if live.
  **No live or reachable GA Walton parcel source could be found from this sandbox — not wired, not
  even as a candidate.** A future session with open egress to `*.co.walton.ga.us`-style hosts, or
  Michael's own browser, is the next step.
- **`ga_paulding`'s Hub discovery hint** (`paulding-county-geospatial-hub-pcaud.hub.arcgis.com`) is
  Paulding County, **OHIO** — its Parcels layer's native spatial reference is NAD83/Ohio South
  (ftUS), and a sampled feature reads owner `WEST OHIO GAS COMPANY`. "pcaud" is Paulding County
  Ohio's own Auditor (Ohio counties call their assessor-equivalent office the "County Auditor" —
  a state-specific title). A DIFFERENT, genuinely-Georgia source was found instead and wired (see
  `ga_paulding` in `counties.js` — a third-party nationwide-parcel-schema republication, not the
  county's own GIS, recorded as such).

**11 wired, all re-derived from this sandbox rather than copied from the dispatch's own URLs**
(method: `ui-audit/discover-county-parcels.mjs`'s Hub-dataset and AGOL-item-search routes, both
reachable here, plus direct ArcGIS-item/web-app-config resolution for two cases; every candidate
was then independently confirmed — real feature count, `outSR=4326` extent checked against
Georgia's own bbox, and for the two ambiguous near-duplicate cases below, sampled attribute values):
DeKalb, Clarke (Athens), Columbia, Lowndes, Jackson, Bibb (Macon), Dougherty (Albany), Rockdale,
Paulding, Bulloch (Statesboro), Camden. Two extra corrections beyond the wrong-state pair above:
- **Rockdale** has TWO near-identical services on one AGOL org — a commercial real-estate broker's
  personal mirror (`rbell@nationalland.com_CCIM`, National Land Realty) and the county's own GIS
  staff account (`gary.morris_RockdaleGA`). Wired to the county's own copy.
- **Bulloch**'s first AGOL hit, titled "Bulloch County Parcels" on the county's own GIS-atlas
  service, holds only 136 features — the title-is-never-the-measurement trap (B1551616's own named
  trap #3) applied to a genuinely county-published service, not just a third party's. The real
  34,014-feature layer sits on a DIFFERENT service (`Parcelswithparcelno`) under the same account.
- **Camden**'s dispatch-given MapServer path advertises `capabilities:"Map"` only (no Query — every
  `/query` call 400s "Invalid URL"); the identical dataset is also published as a FeatureServer at
  the same path with Query enabled, wired to that instead.

**13 NOT wired AS OF THIS SANDBOX'S OWN REACH — every one resolves to a real, county-owned host
that this build environment's egress policy blocks, with no live response from THIS sandbox to
confirm the schema (unlike `il_cook`/`pa_allegheny`/etc. elsewhere in this file, which carry a
PRIOR live-browser measurement to lean on).** Georgia has no statewide composite to park an
unpromoted county on (unlike Colorado's `CO_STATEWIDE_LAYER`), so — per this dispatch's own
explicit validation rule ("if an endpoint is unreachable... do NOT wire broken endpoints") — none
of these were in `COUNTIES_MAP` at that time. **⛔ ELEVEN OF THE THIRTEEN ARE NOW WIRED — see
"Georgia second pass, 2026-09-23" below.** The unreachability was this sandbox's own egress
policy, never a property of the counties, and every host below except Long and Walton answered
real parcel data the moment it was asked from a real browser instead. Table left as originally
recorded, with a ✅ marking exactly what changed:

| County | Best-known host (found this session, not the dispatch's guess where they differ) | Note |
|---|---|---|
| Forsyth | `geo.forsythco.com/gis2/rest/services/Public/Tax_Parcel/FeatureServer/0` | ArcGIS-registry-confirmed path is `/gis2/`, not the dispatch's `/gis/` — likely a server migration since the dispatch's own info was gathered. **✅ WIRED 2026-09-23 second pass** — this exact host answered 105,480 parcels from Michael's own Chrome. |
| Henry | `arcgis.co.henry.ga.us/server/rest/services/Parcels/MapServer/12` | Dispatch's own URL; no better candidate found. Also unreached from Michael's own browser 2026-09-11 (B1583297, as `gis.co.henry.ga.us`). **✅ WIRED 2026-09-23 second pass** — this same URL answered 103,537 parcels on the second try, from Michael's own signed-in Chrome rather than this sandbox; the "strong lead" this row named was correct all along. |
| Cherokee | `gis.cherokeecountyga.gov/arcgis/rest/services/MainLayers/MapServer/1` | "Cherokee County Parcels Live Layer", published by the City of Canton, GA's own GIS org — a more specific, higher-confidence source than the dispatch's own guess. **✅ WIRED 2026-09-23 second pass** — 116,022 parcels. |
| Clayton | `weba.co.clayton.ga.us:5443/server/rest/services/TaxAssessor/Parcels/MapServer/0` | ArcGIS-registry-confirmed (differs from the dispatch's `gis.claytoncountyga.gov` guess). ⛔ A reachable AGOL candidate, "Find Locations in Clayton County Public Schools Owned Tax Parcels", was REJECTED — only 99 features, a schools-owned subset, not the county's fabric. **✅ WIRED 2026-09-23 second pass** — 92,100 parcels, this exact host (including the non-standard port). |
| Coweta | `cccjcgiswa.coweta.ga.us/arcgis/rest/services/Parcels/FeatureServer/0` | ArcGIS-registry-confirmed (differs from the dispatch's `coweta-gis-web.coweta.ga.us` guess). **✅ WIRED 2026-09-23 second pass** — 64,060 parcels, from the county's own `coweta-gis-web.coweta.ga.us` host (the dispatch's original guess, not the registry-confirmed alternate this row recorded — both may be live; the dispatch's own host is what answered from Michael's own browser). |
| Glynn | `webadaptor.glynncounty-ga.gov/webadaptor/rest/services/Parcels/Parcels/FeatureServer/0` | ArcGIS-registry-confirmed (differs from the dispatch's `gis-web.glynncounty-ga.gov` guess — a different hostname). **✅ WIRED 2026-09-23 second pass** — 46,503 parcels, from the dispatch's original `gis-web.glynncounty-ga.gov` host. No address column on this layer — id search only. |
| Liberty | `gis.libertycountyga.com/arcgis/rest/services/ParcelsCache/MapServer/0` | ArcGIS-registry-confirmed path is `ParcelsCache`, not the dispatch's guessed `Parcels`. **✅ WIRED 2026-09-23 second pass** — but NOT at this host: `gis.libertycountyga.com` did not connect at all from Michael's own Chrome either. Wired instead to the Coastal Regional Commission's shared host (`maps.crc.ga.gov/crcarcgis/.../Liberty/Parcels/MapServer/0`, the same publisher as Screven below) — 28,170 parcels. |
| Bryan | `bryangis.bryan-county.org/arcgis/rest/services/PropertyDetails/MapServer/0` | ArcGIS-registry-confirmed path is `PropertyDetails`, not the dispatch's guessed `Parcels`. **✅ WIRED 2026-09-23 second pass** — 23,200 parcels, this exact host and path. ⛔ This server answers HTTP 200 with a `"Pagination is not supported."` error to any query carrying `resultRecordCount` — see the second-pass section below for the fallback this needed. |
| Long | `maps.crc.ga.gov/crcarcgis/rest/services/Long/LongParcels/MapServer/0` | Matches the dispatch's own URL exactly; independently confirmed via the ArcGIS registry (Coastal Regional Commission). **Still NOT wired** — checked from Michael's own Chrome: this service holds only a subdivisions layer, not parcels, and none of the 14 services in the county's Coastal Regional Commission folder carries parcels either. |
| Screven | `maps.crc.ga.gov/crcarcgis/rest/services/Screven/ScrevenParcels/MapServer/0` | Matches the dispatch's own URL. A reachable AGOL alternate ("Parcels - GA - Screven County", `services.arcgis.com/ISpzx3B5ZsVA6e1Z/...`) exists but its own service root 400s "Invalid URL" — dead, not usable. **✅ WIRED 2026-09-23 second pass** — 10,979 parcels, this exact host and path. No address column — id search only. |
| Cobb | `gis.cobbcounty.gov/gisserver/rest/services/tax/taxassessorsdaily/mapserver/0` | Resolved by walking the county's own public "Cobb County Parcel Viewer" Web AppBuilder app (item `e22d8c597b4e4762bcd2caa6127696e4`) → its webmap (`b4fc89d1ace44027b37036d874a1f727`) → its "Parcels" operational layer. Also unreached from Michael's own browser 2026-09-11 (B1583297). A reachable AGOL candidate, "Cobb_Parcels" (owner `Smyrna_GA`), was REJECTED — its extent covers only the Smyrna area, not the whole county (17,572 features against a county with several hundred thousand). **✅ WIRED 2026-09-23 second pass** — this exact host resolved cleanly this time: 279,635 parcels, the largest of the eleven. |
| Bartow | `www.bartowgis.org/arcgis/rest/services/AGOServices/BartowLand/FeatureServer/2` | Resolved by walking the dispatch's own web-app id (`baef84e2cf524176aee5491f187b2b5a`, "BartowPublicMap") → its webmap (`0a183eb91a47498dbbb5b6eb5d24e320`) → its "Tax Parcels" operational layer. **✅ WIRED 2026-09-23 second pass** — this same "strong lead" host answered 63,688 parcels from Michael's own signed-in Chrome. |
| Walton | *(none found — see the wrong-state correction above)* | The dispatch's own URL is Florida's Walton County; the one AGOL hit for the real Georgia county is a dead, stale (2019) service. **Still NOT wired** — re-checked from Michael's own Chrome: the state-catalog item no longer resolves, the county's own account publishes `walton_parcels_view` but it requires a token, and the Hub hit is Walton County, FLORIDA (the same wrong-state trap this row already recorded). |

Every host above returned `CONNECT tunnel failed, response 403` when probed directly from this
sandbox (confirmed live while compiling this table, 2026-09-23) — the same egress-allowlist wall
this file documents everywhere else. None of the four hostname-discovery corrections above
(Forsyth/Clayton/Coweta/Glynn/Liberty/Bryan differing from the dispatch's own guess) could be
independently re-verified for the same reason; they are recorded because the ArcGIS Online item
registry that names them is itself a more current, checkable source than the dispatch's own guess,
not because either was fetched and read.

### Georgia second pass, 2026-09-23 (B1873776, amends B1870704/NEW-1 above)

The "13 not wired" list two sections up recorded a REACHABILITY finding about this sandbox's own
egress policy, never a finding about the counties. Re-run from Michael's own signed-in Chrome on
`planyr.io` (so CORS was measured too, not just host reachability), eleven of the thirteen answered
real parcel data through the app's own request shapes — `queryAtPoint` at a real parcel centroid,
then an id search and an address search through the Map Finder search box. Only Long and Walton
remain unwired; see the annotated table above for what was checked for each of those two.

| County | Key | Parcels | What was measured |
|---|---|---|---|
| Forsyth | `ga_forsyth` | 105,480 | `geo.forsythco.com/gis2/...` — the registry-corrected host from the first pass. queryAtPoint + both search modes confirmed near Cumming. |
| Henry | `ga_henry` | 103,537 | `arcgis.co.henry.ga.us` — the dispatch's own original URL, unreachable only because of sandbox egress. Slowest of the eleven to click-identify (~1.5s), well inside the 8s fetch budget. Confirmed near McDonough. |
| Clayton | `ga_clayton` | 92,100 | `weba.co.clayton.ga.us:5443` — a non-standard port, which is very likely why the first pass could not reach it even in principle. Confirmed near Jonesboro. |
| Cherokee | `ga_cherokee` | 116,022 | `gis.cherokeecountyga.gov` — the City of Canton-published "Cherokee County Parcels Live Layer" the first pass had already identified as the higher-confidence source. Confirmed near Canton, plus the Woodstock overlap point against Cobb (below). |
| Coweta | `ga_coweta` | 64,060 | `coweta-gis-web.coweta.ga.us` — the dispatch's own original host (not the registry-alternate `cccjcgiswa` host the first pass recorded as a candidate). Confirmed near Newnan. |
| Glynn | `ga_glynn` | 46,503 | `gis-web.glynncounty-ga.gov` — the dispatch's own original host. No address column on this layer — id search only. |
| Screven | `ga_screven` | 10,979 | `maps.crc.ga.gov` (Coastal Regional Commission) — matches the dispatch's own URL exactly. Smallest of the eleven. No address column — id search only. |
| Bryan | `ga_bryan` | 23,200 | `bryangis.bryan-county.org/.../PropertyDetails/MapServer/0`. **Needed a real code fix, not just reachability** — see "Bryan County's pagination gap" below. |
| Liberty | `ga_liberty` | 28,170 | `maps.crc.ga.gov` (Coastal Regional Commission) — **not** the dispatch's own `gis.libertycountyga.com`, which did not connect at all even from a real browser. A genuinely different, working source. |
| Bartow | `ga_bartow` | 63,688 | `www.bartowgis.org/.../BartowLand/FeatureServer/2` — the first pass's own "strong lead," confirmed correct. |
| Cobb | `ga_cobb` | 279,635 | `gis.cobbcounty.gov` — the first pass's own "strong lead," confirmed correct. Largest of the eleven. Confirmed near Marietta, plus the north-Marietta overlap point against Cherokee (below). |

**Two mechanisms this pass needed, beyond just reachability:**

1. **Bryan County's pagination gap (`arcgis.js`).** This server answers HTTP 200 with
   `{error:{code:400,message:"Pagination is not supported."}}` to *any* query carrying
   `resultRecordCount` — which every ordinary search sends — so Bryan's search box could never
   have worked, however good the query was, however reachable the host. The click path
   (`queryAtPoint`, which sends no pagination params) always worked; only search was broken.
   `queryFeatures` now catches exactly this error (`isPaginationUnsupportedError`, matched on the
   wording so a real timeout/network/other error is never retried as though it were this) and
   falls back to two requests it does control the size of: ask for the matching object ids only
   (cheap even for a long list, since it carries no geometry), keep the first `count`, then fetch
   exactly those objects. Both fallback calls were measured working on this server; any other
   error still throws, per LOUD-FAILURE.
2. **Jackson/Bibb id search and Rockdale address search (`parcelQuery.js`, `counties.js`) — fixing
   defects in the FIRST pass's own rows, not this pass's new ones.** `detectField`'s auto-detection
   picks the first plausible-shaped column, and on three of the first pass's rows that was the
   wrong one: Jackson's `PIN` (a short partial like "006A" that matched several lots) ahead of the
   full `PARCEL_NO`; Bibb's `LOWPARCELID` ahead of `PARCELID`; and Rockdale's `Address` column,
   which holds ONLY the house number ("1620") — a street-name search on it found 0 lots, a bare
   house number found 32 — while the same layer's `BOA_Addres` column holds the whole situs line
   ("1620 WALNUT ST SE") and a street-name search on it found 55 lots. `resolveSearchField` adds an
   opt-in pin (`pinIdField`/`pinAddrField` on a county row): the pinned column wins over detection
   *only* while it still exists on the layer, so it degrades back to plain detection rather than
   failing the search if a county ever drops the pinned column. Jackson and Bibb now pin their id
   field; Rockdale now pins `BOA_Addres` as its address field.

**`ga_dekalb`, `ga_bibb`, `ga_bulloch` and `ga_camden` (all first-pass rows) were left exactly as
wired** — nothing in this pass found evidence any of them are wrong, only that Bibb's id field
needed the same pin fix described above (its endpoint itself is untouched).

### Georgia third pass — 34-county dispatch, 2026-09-24 (B1875248, amends B1870704 a second time)

An owner chat block named 34 more Georgia counties (a third pass, following the 2026-09-23 first
pass above — `ga_dekalb`..`ga_camden`, 11 counties — and the second pass immediately above this
section, B1873776, 11 more — Forsyth/Henry/Clayton/Cherokee/Coweta/Glynn/Screven/Bryan/Liberty/
Bartow/Cobb — dispatched the same night in a different session and merged, PR #1832, just before
this pass started). **⛔ Unlike the first two passes, none of this batch's sources could be
re-verified from this sandbox — every host is blocked by this build environment's egress
policy.** All counts, edit dates and quirks below come from Michael's own signed-in Chrome at the
`planyr.io` origin, measured 2026-09-24 (service JSON, `returnCountOnly`, `returnExtentOnly` with
`outSR=4326`, extent checked inside the county), and are recorded here and in `counties.js` /
`countiesProvenance.js` as reported — the live-verify item on this batch is what closes that gap.

**The finding that explains why so many of these exist at all: Georgia's county assessors
overwhelmingly sit behind qPublic (Schneider Geospatial's viewer), which has no public API and is
Cloudflare-bot-walled. The real parcel data underneath it is still published — just by a different
publisher.** Three regional bodies republish the same WinGAP parcel export their member counties'
assessors use, each as its own ArcGIS Online organization: the Georgia Association of Regional
Commissions (org `Ug5xGQbHsD8zuZzM`), the Southern Georgia Regional Commission (org
`HA2thkMWRBDb77XN`), and VALOR (org `fYt1jp3hqamxgSvI` — the same CAMA vendor name `ga_lowndes`
above already resolved through). A handful of counties instead publish from their own county-run
GIS host (Richmond, Whitfield, Hall) or from a third-party republication (Muscogee, on a University
of Georgia research org — not this batch's own oldest source; see the vintage note below).

**34 wired** (key → county, real seat): `ga_richmond` (Richmond/Augusta), `ga_whitfield`
(Whitfield/Dalton), `ga_hall` (Hall/Gainesville), `ga_effingham` (Effingham/Springfield),
`ga_fayette` (Fayette/Fayetteville), `ga_spalding` (Spalding/Griffin), `ga_newton`
(Newton/Covington), `ga_barrow` (Barrow/Winder), `ga_oconee` (Oconee/Watkinsville), `ga_butts`
(Butts/Jackson GA), `ga_monroe` (Monroe/Forsyth GA), `ga_troup` (Troup/LaGrange), `ga_peach`
(Peach/Fort Valley), `ga_muscogee` (Muscogee/Columbus), `ga_morgan` (Morgan/Madison GA),
`ga_baldwin` (Baldwin/Milledgeville), `ga_brantley` (Brantley/Nahunta), `ga_charlton`
(Charlton/Folkston), `ga_clay` (Clay/Fort Gaines), `ga_cook` (Cook/Adel), `ga_crawford`
(Crawford/Knoxville), `ga_crisp` (Crisp/Cordele), `ga_dade` (Dade/Trenton), `ga_dooly`
(Dooly/Vienna), `ga_echols` (Echols/Statenville), `ga_emanuel` (Emanuel/Swainsboro), `ga_evans`
(Evans/Claxton), `ga_greene` (Greene/Greensboro), `ga_lanier` (Lanier/Lakeland), `ga_meriwether`
(Meriwether/Greenville GA), `ga_sumter` (Sumter/Americus), `ga_turner` (Turner/Ashburn),
`ga_twiggs` (Twiggs/Jeffersonville), `ga_ware` (Ware/Waycross).

Notable quirks recorded on the individual rows (`counties.js`/`countiesProvenance.js`), not
repeated in full here: **Barrow and Oconee deliberately share one FeatureServer** (the Greater
Athens regional-commission service) at different layer ids — not a URL conflict, the same shape
`sharedLayerUrlConflicts()` already allows elsewhere in this file. **Cook**'s measured extent
(`-83.49..-83.37`) reads narrower than the whole county — possibly city-of-Adel-only coverage —
wired anyway per this dispatch's own instruction, with the live-verify pass required to click a lot
outside Adel before this is treated as full-county coverage. **Dade**'s real source
(`Dade_Parcels_2020LLLT/FeatureServer/5`) must not be confused with a same-org, same-count,
differently-named `Walker_Parcels_2026LLLT/4` layer — that is Dade's own data under a
Walker-County-sounding name, not a real Walker County source, and stays unwired anywhere in this
registry. **Muscogee (2019-01) and Morgan (2018-11) are the two oldest sources in this batch** —
both still inside this repo's 5-year staleness bar, and the help text on both rows says so plainly
rather than presenting them as current.

**Six counties named in the dispatch had no usable public parcel source found and are NOT wired,
filed instead as an Open follow-up item:**

| County | What was checked | Why it was ruled out |
|---|---|---|
| Walton | `walton_parcels_view` (per the dispatch) | Answers `499 Token Required` — checked twice the same night; not a public, key-free endpoint. |
| Douglas | — | No public parcel endpoint found. |
| Houston | — | No public parcel endpoint found. |
| Floyd | `romefloyd.agdmaps.com` portal | Did not answer. |
| Carroll | ArcGIS Online "Carroll County Parcel Viewer" | Is Carroll County, **MISSISSIPPI** (extent near -90°) — a same-name-different-state trap, same species as the first pass's Walton/FL and Paulding/OH catches. |
| Gordon | Warner Robins city polygon layer | Not a parcel layer — a municipal boundary, not parcel geometry (and Warner Robins is in Houston County, not Gordon, in any case). |

qPublic direct access was also tried and ruled out generally for this whole pass: Schneider's own
API sits behind a Cloudflare bot wall and answers nothing scriptable.
### GIS pass-through — a same-origin relay for a county host with NO CORS support at all (NEW-1, 2026-09-24)

Every county row above assumes the county's own GIS server will answer a browser's cross-origin
fetch — most do (Esri's ArcGIS Online sends `Access-Control-Allow-Origin` by default, and most
self-hosted county servers do too). **Southern Georgia Regional Commission (SGRC) does not.**
Measured live from Michael's own Chrome, 2026-09-24: `www.sgrcmaps.com`'s Tift County parcel
layer (`/alma/rest/services/Tift/Tift_Parcels/MapServer/0`, 19,194 parcel polygons) opens fine
when fetched directly, but the identical fetch from the `planyr.io` origin fails with no ACAO
header on the response at all — not a slow server, not a wrong URL, a server that simply never
sends the header a browser needs to let the page read the response.

**The fix is a plain relay, not a workaround per county.** `functions/gis-proxy/[[path]].js` is a
Cloudflare Pages Function — it deploys automatically with the site build, no `wrangler.toml`, no
environment variable — that fetches an allow-listed host **server-side**, where CORS does not
apply, and hands the response back same-origin. A county's `layerUrl` in `counties.js` can be
either a normal `https://…` address (the common case) or a root-relative path of the form
`/gis-proxy/<host>/<rest of the county's own path>` (Tift County's case) — every parcel-fetch call
site (`arcgis.js`'s `queryFeatures`/`queryAtPoint`/`getLayerInfo`/`resolveLayerUrl`, all via one
`resolveGisUrl` helper) resolves either shape correctly, and the on-screen parcel layer (Leaflet /
esri-leaflet, pointed straight at the same relative path) never needs to know a proxy is involved.

**To add a new host:** add its exact hostname to `ALLOWED_HOSTS` in
`functions/gis-proxy/[[path]].js` (a hard-coded set — never a wildcard/pattern, so this can never
become an open relay to an arbitrary host), then wire the county's `layerUrl` as
`/gis-proxy/<that host>/<the county's own REST path>`, exactly as if you were building the normal
`https://` URL but swapping the scheme+host for the proxy's own path. GET and POST both work (the
function forwards a POST body + its Content-Type, so the `fetchArcgisJson` GET→POST fallback for
an over-long query still works through it); nothing is cached beyond a short response-lifetime
`Cache-Control` on a genuine 200 — this is a pass-through, not a copy, unlike the separate B445
`/api/gis-cache/` proxy (a Drive-backed cache for raster **imagery**; see that module's own header
— the two proxies solve different problems and are not the same mechanism).

**SGRC's one host already covers eleven more Georgia counties**, all reachable the identical way
once wired: Atkinson, Ben Hill, Berrien, Brooks, Coffee, Cook, Echols, Irwin, Lanier, Pierce and
Turner, each under its own `/alma/rest/services/<County>/<County>_Parcels/MapServer/0`-shaped
path on the same host (not independently confirmed this session — a real follow-up, not a
guess: the SGRC host itself is real and reachable, only the per-county path needs confirming).
**⛔ Four of these eleven — Cook, Echols, Lanier and Turner — are ALREADY wired as of the same-day
third pass above, through a DIFFERENT, working source** (ArcGIS Online-hosted layers on the
`HA2thkMWRBDb77XN`/`TSNNo8H51qYl31gq` orgs, which send a normal CORS header — no proxy needed).
A future session picking up this follow-up should confirm those four are covered before spending
effort re-wiring them through SGRC's own host; the remaining seven (Atkinson, Ben Hill, Berrien,
Brooks, Coffee, Irwin, Pierce) are still genuinely open.
**Middle Georgia Regional Commission** (`mgrcmaps.org`) is allow-listed too and is the same shape
of fix once a specific county layer on it is confirmed and wired. **The Coastal Regional
Commission** (`maps.crc.ga.gov`) is ALSO allow-listed, per the dispatch's own explicit list — but
turned out not to need the pass-through at all: the Georgia second-pass work below (same day,
sibling session) wired Screven and Liberty directly against `https://maps.crc.ga.gov/...` and
found it answers a normal CORS header, unlike SGRC. Left allow-listed as a harmless, unused
capability rather than removed, since a future CRC-hosted county could still turn out to need it.

### Florida — 17 counties, Jacksonville + Polk/Lakeland markets (NEW-1, 2026-09-24)

Unlike Georgia, **Florida needs no per-county discovery at all** — the state GIO (Geographic
Information Office) publishes every one of Florida's 67 counties' parcels in ONE statewide layer,
sourced from the Department of Revenue (FDOR) cadastral roll: `fl_statewide`'s own `layerUrl`
(`services9.arcgis.com/Gh9awoU677aKree0/…/Florida_Statewide_Cadastral/FeatureServer/0`, "FDOR
Cadastral 2025", owner FloridaGIO), already recorded above in the per-state notes. Wiring a
Florida county is therefore a one-line addition — a new `scopeWhere` on the SAME shared layer,
exactly the shape Idaho's 13 counties use — never a new endpoint to find.

**MEASURED from Michael's own Chrome at the planyr.io origin, 2026-09-24:** 10,831,924 features,
esriGeometryPolygon, last edited 2026-09-16, maxRecordCount 2000. A point query at downtown
Jacksonville (-81.6579, 30.3255) answered in 369ms — CO_NO 26, PARCEL_ID "0744550000R", PHY_ADDR1
"3 E INDEPENDENT DR", OWN_NAME "JACKSONVILLE AREA CHAMBER OF C". A point at Lakeland (-81.9498,
28.0395) answered CO_NO 63, PARCEL_ID "242819000000031050", PHY_ADDR1 "72 LAKE MORTON DR".

**⛔ ATTRIBUTE-ONLY QUERIES OVER THE WHOLE LAYER ARE SLOW — do not validate rows on this layer by
count or extent.** `returnCountOnly`/`returnExtentOnly` with `where CO_NO=12` both exceeded a 40s
timeout from this sandbox (consistent with the pre-existing per-state note above: a whole-layer
`returnExtentOnly` probe timed out at 8002ms against the SAME layer during the original statewide
discovery pass). Point/envelope spatial queries are fast (both test points above answered in well
under a second) — that is the query shape the app actually sends, and the shape every future
Florida county should be validated against.

**The 17 counties wired** (Jacksonville and Polk/Lakeland markets, ~30-mile radius of each city —
the Georgia side of this ask, Bartow County GA and its ring, was already wired or has no public
source, so nothing further was built there):

| County | FDOR `CO_NO` | Wired key | County seat |
|---|---|---|---|
| Duval | 26 | `fl_duval` | Jacksonville |
| Nassau | 55 | `fl_nassau` | Fernandina Beach |
| Clay | 20 | `fl_clay` | Green Cove Springs |
| St. Johns | 65 | `fl_stjohns` | St. Augustine |
| Baker | 12 | `fl_baker` | Macclenny |
| Polk | 63 | `fl_polk` | Bartow, FL (a city — not Bartow County, GA) |
| Hillsborough | 39 | `fl_hillsborough` | Tampa |
| Pasco | 61 | `fl_pasco` | Dade City |
| Hernando | 37 | `fl_hernando` | Brooksville |
| Sumter | 70 | `fl_sumter` | Bushnell |
| Lake | 45 | `fl_lake` | Tavares |
| Orange | 58 | `fl_orange` | Orlando |
| Osceola | 59 | `fl_osceola` | Kissimmee |
| Highlands | 38 | `fl_highlands` | Sebring |
| Hardee | 35 | `fl_hardee` | Wauchula |
| Manatee | 51 | `fl_manatee` | Bradenton |
| DeSoto | 24 | `fl_desoto` | Arcadia |

`CO_NO` is FDOR's own county numbering, **not a FIPS code** — confirmed by both live test points
above (Duval FIPS is 031, but `CO_NO` reads 26; Polk FIPS is 105, `CO_NO` reads 63).

**Key spelling — a deliberate deviation from the dispatch's own suggested `fl_st_johns`.** This
repo's established convention for a multi-word county name is to SQUISH it with no underscore
(`la_eastbatonrouge`, `id_bearlake`, `id_nezperce` above) — never `fl_st_johns`. This is not
stylistic: `countyKeyForName` derives the routing key as `${state}_${slug}`, where `slug` strips
every character that isn't a letter, so "St. Johns County" can only ever resolve to `fl_stjohns`.
An underscored key would be silently unreachable by name lookup while still working by direct
key/bbox routing — exactly the kind of defect that hides behind a passing build. `fl_stjohns` is
what's wired.

**⛔ RECURRENCE (2026-09-24, B1885600 ×2) — the generalized-boundary trap this section used to
document as "not a bug in this session's wiring" turned out to be a real, user-facing outage, and
the fix is a source swap, not a workaround.** The claim above — that a literal barrier-island point
was merely a shape the offline geometry couldn't be trusted on while the live click-to-select query
stayed authoritative regardless — was measured WRONG on the deployed build (b9722c7): with no
parcel-source geometry able to name a county for Fernandina Beach's own coordinates, the click
router never fired a parcel request there AT ALL (the network log showed only the geocoder call),
and the card read "the county parcel service couldn't be reached for this area right now." A
`status: "outside"` answer from `resolveCounty` isn't a cosmetic gap in a screening asset — it is
the input `candidateCountiesForPoint` uses to decide which parcel service to query, so an offline
geometry that clips the coast produces a real, live routing failure, not just an imprecise fallback.

**The fix:** `build-county-polygons.mjs` now has a dedicated `FL` source (the FDEP "Florida County
Boundaries" shoreline layer — see its own header for the live-verified provenance), the same
TX/CO-style treatment as every other state riding the generalized nationwide layer should eventually
get. Fernandina Beach's real coordinates now resolve `status: "ok"` / Nassau against the rebuilt
asset, and `fl_nassau`'s bbox/center were re-derived from it. `test/counties.test.js` asserts this
directly (Fernandina Beach → `fl_nassau`, plus Anna Maria → `fl_manatee`, Ponte Vedra Beach →
`fl_stjohns`, Jacksonville Beach → `fl_duval`, all newly-wired barrier-island/coastal seats) rather
than routing test coverage around the gap with a mainland stand-in. St. Marys, GA and Kingsland, GA
still confirm cleanly on the Camden County side, unaffected by the Florida-side fix.

**The trade-off, stated rather than hidden:** the FDEP shoreline layer is genuinely higher-detail
than the generalized one (~700 polygon parts for Nassau County alone before simplification), so all
67 Florida counties together cost roughly 485 KB of the (public/, not-bundle-budgeted) geometry
asset — a real increase, and the price of routing barrier islands correctly instead of clipping them.

**The other 50 Florida counties are one row away** — same shared parcel layer, same `scopeWhere`
shape, just a different `CO_NO` and a county seat to confirm — whenever a market needs one; their
boundary geometry is already correct in the rebuilt asset regardless of whether a parcel source is
wired for them yet.

### Louisiana parishes — 64-parish dispatch, 2026-09-30 (NEW-1, owner: "wire up Louisiana's parcels from their GIS servers")

Louisiana has **no statewide parcel layer** (LAGIC, LSU Atlas, LA Division of Administration GIS and
the LA Tax Commission were already checked — see the Louisiana per-state note above), so this pass went
parish by parish through all 64. **⛔ Louisiana has PARISHES, not counties:** every key drops the
designation (`la_calcasieu`, never `la_calcasieuparish`), every label keeps it ("Calcasieu Parish, LA"),
multi-word names squish with no underscore (`la_stjohnthebaptist`) — guarded, for every wired row, by
`test/louisianaParishes.test.js` (key shape, label, bbox inside Louisiana, `countyKeyForName("<Name>
Parish", "LA")` back to the key, and a point INSIDE each parish resolving to that parish's source).

**⚠ SUPERSEDED IN PART 2026-10-04 — read "Louisiana route 3, run from Michael's browser 2026-10-04" at the end of this section: 5 parishes below (Calcasieu, Jefferson, Jefferson Davis, St. Landry, West Baton Rouge) moved to WIRED, and the counts in this paragraph are corrected there (31 wired · 7 blocked · 5 rejected · 21 not found = 64).**

**⚠ SUPERSEDED AGAIN 2026-10-06 — De Soto, Washington and West Feliciana were also found and WIRED; read "Louisiana 2026-10-05/06 route-3 sweep" at the very end of this file for the current 34-wired state and for what every one of the 30 still-unwired parishes actually uses. "Not found" below is a statement about the 2026-09-30 sandbox only — it never meant "no source exists".**

**Outcome for all 64 (as of 2026-09-30):** **2** already wired (East Baton Rouge B1455634, Orleans B1574256) · **24 wired
now** (table below) · **10** with a real candidate on a parish-owned host this sandbox's egress blocks →
"Candidates needing a live measurement" below (V1413377) · **6** measured and REJECTED, with the reason (West Baton Rouge's stale 2018 copy is recorded with its first-party lead in the blocked table) ·
**22** not found by any reachable route. The 38 unwired parishes are **never** "no source" — each says
which routes were tried.

**Routes tried (this sandbox reaches only `*.arcgis.com`; every parish-owned host is a policy 403 at the
CONNECT tunnel — re-confirmed 2026-09-30 for 17 of them, including `maps.brla.gov`, so route 3 could
not be executed here):**
1. **ArcGIS Hub dataset API** (`hub.arcgis.com/api/v3/datasets`) — `"<P> Parish parcels"`, `"<P> Parish tax
   parcels Louisiana"`, `"<P> Parish assessor"`, filtered to parcel-titled datasets that name the parish and
   Louisiana (the stock `discover-county-parcels.mjs` run on the 30 priority parishes queried "<P> County" and
   returned only wrong-state noise plus Ascension/Terrebonne/St. Mary — its wording is wrong for parishes).
2. **ArcGIS Online item search** (`www.arcgis.com/sharing/rest/search`), Feature Service AND Map Service, the
   same three wordings for every parish, plus a 30-query pass on the parish names most likely to be
   missed. Then a **service-directory walk of every org that surfaced** (Westwood/CSRS `FqQ2BQIKVGpUWqAa`,
   `1fGAZVgZnPx4zcNH`, `fe3XWHMASK948q2c`, DesireLine `LJwIycC0yIuqCBxq`, …) — which is how Calcasieu, St.
   Bernard, St. John the Baptist, St. Martin and Plaquemines were found: their names are not what a search
   for "<P> Parish parcels" returns.
3. **The ArcGIS Online catalog of `GDITAdmin`'s "Parcels - LA - <Parish>" items** — a 31-parish directory
   (title `Parcels - LA - X Parish`) whose `url` is each parish's OWN REST endpoint. This is the route-3
   substitute: it names the parish-owned host without touching it. It is where every blocked candidate below
   comes from. It also lists a **"Parcels - LA - Statewide 2020 (minus 6 parishes)"** item
   (`services8.arcgis.com/g1eUGM6NUcD0Fk5p/.../LandGrid_Parcels/FeatureServer/0`, owner Jim.Mitchell_lsfmo) —
   **measured: `Token Required`.** It is not a public statewide layer, and it is a 2020, commercial (LandGrid)
   extract; recorded so nobody re-hunts it.
4. **Direct probing of parish hostnames** — blocked here (see above); the candidate table is what a browser
   with open egress needs to run.

Every wired row passed ALL of: a count query; a polygon geometry type; an extent (`outSR=4326`) that
matches the parish; ≥15 of ~24 in-parish grid probe points answering (misses are marsh, water or road); three
widely spread hits carrying a real id + owner/situs; **a 1 km box around each parish seat holding real
parcels (the Minnehaha "city-hole" trap — it is what rejected Vermilion and Livingston's 2018 copy)**; the
production `lookupParcels` path returning the right parcel for an id search and (where an address column
exists) an address search; and the app's own owner/situs/acreage resolvers run over ~25 real attribute
bags. The per-row numbers and the three spread hits are in `countiesProvenance.js`.

#### Wired now — 24 parishes

⛔ **Most of these are NOT the parish's own server** — the house standard (the Paulding GA precedent) is to say
so. "Third-party republication" means an engineering/consulting firm's ArcGIS Online copy of the assessor's
roll (Westwood/CSRS, DesireLine): fresh, parish-wide and queryable, but a private account that can be
deleted (the 2026-09-12 TxGIO incident is the precedent — see `counties.js`), so **each row is also a
candidate to swap for the parish's own host the day it is measured**; the first-party URL, where one is
known, is in the blocked-candidates table.

| Parish | Key | Parcels | Source class | Layer edited | Id column | Address column |
|---|---|---|---|---|---|---|
| Ascension | `la_ascension` | 48,115 | third-party republication | 2026-06-15 | `PARCEL_NO` | `LOCATION_1` |
| Assumption | `la_assumption` | 14,275 | third-party republication | 2026-05-29 | `PIN` | — (none) |
| Iberville | `la_iberville` | 17,471 | third-party republication | 2026-06-15 | `ParcelNumb` | `Street_Nam` |
| St. Charles | `la_stcharles` | 34,253 | third-party republication | 2026-06-15 | `PI_CODE` (pinned) | `Address` |
| St. James | `la_stjames` | 10,301 | third-party republication | 2026-06-15 | `PIN` | `Physical_A` |
| St. John the Baptist | `la_stjohnthebaptist` | 26,805 | third-party republication | 2026-06-15 | `PARCEL_ID` | `PAR_ADDR` |
| St. Bernard | `la_stbernard` | 22,764 | third-party republication | 2026-06-15 | `ParcelNumb` | `Street_Nam` |
| St. Martin | `la_stmartin` | 44,228 | third-party republication | 2026-05-29 | `PARCEL_NO` | `STREET_NAM` |
| Plaquemines | `la_plaquemines` | 18,008 | third-party republication | 2026-06-15 | `ASSESSID` (pinned) | — (none) |
| St. Tammany | `la_sttammany` | 135,083 | assessor's content, individual account | 2026-06-02 | `REID` (pinned) | `Physical_A` |
| Lafayette | `la_lafayette` | 116,693 | vendor republication | 2025-12-10 | `parcelnumb` (pinned) | `address` |
| Acadia | `la_acadia` | 46,577 | assessor's own account | 2026-09-22 | `PARCEL_NO` | — (none) |
| East Feliciana | `la_eastfeliciana` | 16,762 | assessor's own account | 2026-09-25 | `PIN_Number` (pinned) | — (none) |
| Caddo | `la_caddo` | 140,086 | regional council of governments | n/a (no editingInfo) | `PARCELID` (pinned) | — (none) |
| Bossier | `la_bossier` | 75,290 | regional council of governments | n/a (no editingInfo) | `Assessment` (pinned) | — (none) |
| Webster | `la_webster` | 55,625 | regional council of governments | n/a (no editingInfo) | `ParcelNumb` (pinned) | `Street_Nam` |
| St. Mary | `la_stmary` | 43,610 | levee/drainage district | n/a (no editingInfo) | `PIN` (pinned) | `STREET_NAM` |
| Terrebonne | `la_terrebonne` | 55,364 | third-party republication | 2026-03-05 | `ACCT_NUM` | — (none) |
| Lafourche | `la_lafourche` | 56,246 | levee/drainage district | 2024-01-15 | `parcelnumb` | `street_nam` |
| Allen | `la_allen` | 17,706 | third-party republication | 2023-01-26 | `ParcelID` | `par_addres` |
| Cameron | `la_cameron` | 11,918 | third-party republication | 2023-03-13 | `PARCELNUMB` (pinned) | `ADDRESS` |
| Natchitoches | `la_natchitoches` | 29,443 | third-party republication | 2023-07-19 | `PARCEL_ID` | `SITUS` |
| Tangipahoa | `la_tangipahoa` | 75,019 | third-party republication | 2026-09-03 | `Assessment` (pinned) | `Address` |
| Livingston | `la_livingston` | 79,656 | parish government's own org | n/a (no editingInfo) | `ParcelNumber` | `Par_Address` |

Field-mapping notes that a reader of the table would otherwise miss (each is also in the row's provenance):
- **`idField` is PINNED where `detectField` would have picked a wrong column** — the parish FIPS code `geoid`
  (Lafayette, Cameron's `GEOID`), the row id `FID` (St. Charles), `OBJECTID` (East Feliciana, Tangipahoa,
  Bossier's `OBJECTID_1`), the synthetic `PARCEL_ID` = "PARCEL_"+REID (St. Tammany), a map-derived `PIN`
  (Webster), a sequential row number (St. Mary).
- **Situs vs mailing (B1196).** Four schemas broke the shared owner/situs ladder in `appraisal.js` and it was
  fixed at the ONE implementation, not per parish: Cameron's `ADDRESS_SO` = "county" (a source flag listed
  before the real `ADDRESS`), Natchitoches' `M_ADDRESSN`/`M_STREETNM` (the owner's MAILING address), Regrid's
  JSON `original_address`, and Livingston's `~` null. St. James' `TAXPAYER`, Ascension's `OWNERNAME_`,
  Acadia's `OWNERS` and Assumption's `Taxpayer` were owner columns no resolver claimed (now a strict
  FALLBACK — a layer with a real `Owner` column resolves exactly as before). A bare house NUMBER on the generic
  rung is no longer a situs (Lafourche, St. Mary, St. John, St. Bernard, Iberville, Webster publish the address
  split in two). Where no whole-line situs column exists the card title falls back to what the user searched
  — a stated, honest degrade — and the address search runs on the street-name column.
- **Attribute-light rows, wired on the Virginia/Hawaii precedent (boundary + id, NOT an owner source):**
  Plaquemines (owner column empty on every sampled row), St. Tammany (REID/Assessment/Physical_A only),
  East Feliciana, Caddo, Terrebonne. **Bossier** carries the owner name in `Assessme_1`, which no shared
  resolver claims — a known gap, not fixed here.
- **Shared service:** Lafayette rides the ES2 vendor layer that also holds Vermilion; the row is scoped
  `geoid='22055'`.

#### Measured and REJECTED — 6 parishes (each is a finding about a candidate, never "no source")

| Parish | Candidate | Why rejected |
|---|---|---|
| Vermilion | ES2 `Parish_Parcels__All_`, geoid 22113 (44,509 features, extent matches) | ⛔ **City-hole:** a point query at Abbeville (the parish seat) and at Delcambre returns ZERO features while Kaplan/Erath/Gueydan return parcels; `owner` is empty on ~25%. Count and extent both pass — only a query at the seat sees it. |
| St. Landry — ✅ **WIRED 2026-10-04 from a different, complete TotaLand-hosted source** | `StLandryParcels` (62,139; org fe3XWHMASK948q2c, owner `daviddcbudtest`) | Fields are PARCEL/BLOCK/acreage only — no owner, no situs — on a test-named account. |
| Richland | `RichlandParcels` (18,753; same org) | Edited 2021-04-22; test-named account. |
| Bienville | `Bienville(Parcels)(2018)` (18,032) | 2018 vintage in its own title; edited 2021. |
| Evangeline | ES2 `Parcel_Search_Widget_AGOL` / `Evangeline_Parish_Parcels_(Public_View)` | `Token Required` — not public. |
| Ouachita | City of Monroe `Public_Parcels` (92,073; extent matches) | Only `Parcel_ID`/`RPID`, and 4 of 53 in-parish probe points answered — a partial fabric. Held, not wired; the parish police jury's own inventory app (`malma.maps.arcgis.com`) is unmeasured. |

Also measured and passed over inside PARISHES THAT ARE WIRED (or blocked), so they are not re-tried:
Calcasieu's `Calcasieu_Tax_Parcels` (Westwood org; 26,401 — covers only the Lake Charles/Sulphur half, extent
−93.73..−93.30) and `CalcParcels` (155,923; org fe3XWHMASK948q2c, owner `daviddcbudtest`, no editing date — a
test-named account whose 16/16 coverage is real but whose provenance cannot be stated); Jefferson's Westwood
`Jefferson_Parish_Tax_Parcels` (156,471 — zoning/lot schema with **no owner and no situs**, 5/16 probe points);
Lafayette's LED `2023_Parcels_Lafayette_Parish` (its `Name` column is the parcel NUMBER); Livingston's
`Livingston_Parish_Assessor_Parcels` (5,541 features dated 2/21/2018, Denham Springs corner only) and the
parish's own `Lots` layer (23,938; hit 0 of 16); Tangipahoa's older `Parcels` (73,475; 2022); East Feliciana's
`EastFelParcels` (560,226; 2020).

#### Candidates needing a live measurement from Michael's browser — 10 parishes (V1413377)

Each is a REAL parish-owned or assessor-consortium REST endpoint, taken from `GDITAdmin`'s catalog or the
Hub API; **none could be probed here (CONNECT 403), so none is wired and none is dropped.** For each: open
`<URL>?f=json` (layer metadata: geometry type, fields, `maxRecordCount`), then `/query?where=1=1&returnCountOnly=true&f=json`,
then `/query?where=1=1&returnExtentOnly=true&outSR=4326&f=json`, then the point query below. **What to confirm:**
polygon geometry · count plausible for the parish · extent matches the parish · a point query returns a real
parcel with an id, an owner and a SITUS (not the mailing address) · a point at the parish seat is not a hole ·
and — because none of these hosts has been checked — whether the response carries an `Access-Control-Allow-Origin`
header (if not, the host goes through `functions/gis-proxy/[[path]].js` after adding the EXACT hostname to
`ALLOWED_HOSTS`).

| Parish | Exact REST URL | Point to query (lat, lng) | Notes |
|---|---|---|---|
| **Calcasieu** (#1) — ✅ WIRED 2026-10-04 | `https://lak-dc-arcgis2.cppj.net/arcgis/rest/services/HubLayers/Parcels/FeatureServer/0` (Calcasieu Parish Police Jury; AGOL item owner `giscppj`, updated 2026) · alt `https://gis2.totaland.com/ArcGIS/rest/services/CPPJ/CPPJ_Group2/MapServer/21` | 30.2266, −93.2174 (Lake Charles) · 30.2427, −93.2454 (Westlake industrial) · 30.2360, −93.3775 (Sulphur) | The only reachable copies are partial (26,401, Lake Charles half) or unattributable (155,923). |
| **Jefferson** (#2) — ✅ WIRED 2026-10-04 (a different layer than listed here) | `https://jpgis.jeffparish.net/server/rest/services/Parcels/MapServer` (AGOL item owner `rlongsrsa`, 2026 — pick the parcel layer) · alt `https://eweb.jeffparish.net/arcgis/rest/services/SCP/MPN/MapServer/3` | 29.9435, −90.2034 (Harahan) · 29.9569, −90.1893 (Elmwood) · 29.9511, −90.1670 (Metairie) | Confirm owner + situs columns exist — the reachable Westwood copy has neither. |
| **Iberia** | `https://gis.iberiagov.net/server/rest/services/Parcels/AssessorServiceMay2020/MapServer/0` | 30.0035, −91.8188 (New Iberia) | Title says May 2020 — confirm vintage. |
| **Rapides** | `https://gissrv1.romlc.net/arcgis/rest/services/WebMaps/LA_Assessors/MapServer/0` | 31.3113, −92.4451 (Alexandria) | `LA_Assessors` is a shared multi-parish assessor-consortium service — layer index = parish. |
| **Avoyelles** | same host, `.../LA_Assessors/MapServer/2` | 31.1152, −92.0654 (Marksville) | |
| **Grant** | same host, `.../LA_Assessors/MapServer/9` | 31.5588, −92.5548 (Colfax) | |
| **Lincoln** | same host, `.../LA_Assessors/MapServer/4` | 32.5293, −92.6377 (Ruston) | |
| **West Baton Rouge** — ✅ WIRED 2026-10-04 (TotaLand-hosted assessor service, not the romlc layer) | same host, `.../LA_Assessors/MapServer/1` (layer title "Iberville & West Baton Rouge Parishes") | 30.4515, −91.2101 (Port Allen) | Confirm the layer carries a parish field to scope on. The only reachable copy, `WBRParcels` (12,026 features, org fe3XWHMASK948q2c), was edited 2018-04-24 — outside the repo's 5-year bar, so not wired. |
| **Catahoula** | `https://www.efsedge.com/arcgis/rest/services/Catahoula_Parish/Parcels/FeatureServer/1` | 31.7146, −91.8590 (Harrisonburg) | `efsedge.com` is a vendor host. |
| **Vernon** | `https://www.efsedge.com/arcgis/rest/services/Vernon_Parish/Vernon_Vector/MapServer/19` | 31.1657, −93.2846 (Leesville) | |

**Also worth measuring — first-party hosts for parishes that are wired from a third-party copy today**
(a swap is a one-line `layerUrl` change once measured): Ascension `https://geo.apgov.us/apgarc/rest/services/Maps/AscensionGeneralDetails/MapServer/5` ·
St. James `https://gisviewer.stjamesla.com/arcgis/rest/services/TaxViewer/MapServer/4` ·
St. Bernard `https://lucity.sbpg.net/arcgis/rest/services/ComDev/Parcels3/MapServer/0` (FeatureServer variant advertises Query) ·
St. Tammany `https://gisportal.stpgov.org/arcgis/rest/services/CarlData/MapServer/1` ·
Lafayette `https://webgis.lafayetteassessor.com/arcgis/rest/services/Sidwell/TaxParcelPublic/MapServer/0` ·
Terrebonne `https://gis.tpcg.org/server/rest/services/SAS/webmap_public/MapServer/0` ·
Allen `https://gis3.totaland.com/arcgis/rest/services/Allen/AllenReference2/MapServer/14` ·
Tangipahoa `https://tangis.tangipahoa.org/server/rest/services/Cadastral/TaxParcel_A/MapServer/0` (also `TaxParcelAssessment_A`) ·
Bossier/Caddo/Natchitoches via the same `romlc` service (`/7`, `/3`, `/5`).

#### Not found by any reachable route — 22 parishes

Beauregard · Caldwell · Claiborne · Concordia · ~~De Soto~~ (✅ found and wired 2026-10-06) · East Carroll · Franklin · Jackson · ~~Jefferson Davis~~ (✅ found and wired 2026-10-04) ·
La Salle · Madison · Morehouse · Pointe Coupee · Red River · Sabine · St. Helena · Tensas · Union · ~~Washington~~ (✅ found and wired 2026-10-06) ·
West Carroll · ~~West Feliciana~~ (✅ found and wired 2026-10-06) · Winn.

**Recorded as NOT FOUND ON 2026-09-30 by routes 1, 2 and 3-substitute above — never as "no source".** For each:
the Hub API and the AGOL item search (Feature Service + Map Service, three wordings) returned only
wrong-parish, wrong-state or non-parcel hits (e.g. "Concordia" returned Concordia, **Missouri**; every
`Tax Parcels` hit was East Baton Rouge's or Lafayette's; "St. Helena"/"Tensas"/"Red River" returned other
parishes' services); none of the 22 has a `Parcels - LA - <Parish>` item in the `GDITAdmin` catalog (31
parishes, listed above); and route 4 (their own hostnames, and the assessor viewers most of them link — many
of these parishes use qPublic/Schneider, Atlas or another private vendor viewer with no public REST service,
which is a legitimate "not found") is blocked by this sandbox's egress. **What would find them:** a session
with open egress running route 3 against each parish assessor's own site and reading the map viewer's network
calls for the ArcGIS REST endpoint (the route that found Orleans).

**Not attempted: nothing.** All 64 parishes have an outcome above. The numbers as of 2026-09-30 were 2 + 24 + 10
(blocked candidates, incl. West Baton Rouge) + 6 (rejected) + 22 (not found) = 64 — **corrected 2026-10-04 below.**

#### Louisiana route 3, run from Michael's browser 2026-10-04 (NEW-1, B2118880 — closes part of V1413377)

Owner pushback on the 2026-09-30 write-up, verbatim: *"adversarially review what you're saying, i think you can find
them."* He was right: the "blocked" and several "not found" parishes were only unreachable **from a code sandbox**.
The Cowork chat measured the sources below on 2026-10-04 evening Central from Michael's own Chrome with `fetch()`
running **on a planyr.io tab**, so every one is **CORS-confirmed from the production origin — no gis-proxy needed.**
Everything in this section is **"measured live from Michael's browser at the planyr.io origin, 2026-10-04"**; this
sandbox's egress still 403s these hosts at the CONNECT tunnel, so none was re-probed here (live re-check → V1538480).

**Corrected counts — 5 moved to WIRED:** **31 wired** (26 + the 5 below) · **7 blocked** (Iberia, Rapides, Avoyelles,
Grant, Lincoln, Catahoula, Vernon — each now has a named reason, below) · **5 rejected** (Vermilion, Richland,
Bienville, Evangeline, Ouachita; St. Landry left this list) · **21 not found** (Jefferson Davis left it) = **64.**

| Parish | Key | Parcels | Source (class) | Id column | Situs column | Mailing columns — NEVER the address |
|---|---|---|---|---|---|---|
| Calcasieu | `la_calcasieu` | 167,981 | Calcasieu Parish Police Jury, `lak-dc-arcgis2.cppj.net` HubLayers/Parcels FeatureServer/0 — **first-party** | `PIN` (pinned) | `PHYSICALAD` | `ADDRESS1`, `ADDRESS2` |
| Jefferson | `la_jefferson` | 192,313 (180,965 with owner) | Parish GIS, assessor roll joined, `jpgis.jeffparish.net` PAO_MAP_2025 MapServer/72 "Parcel Ownership" — **first-party** | `TAXROLLPAR` (pinned) | `PARCELADDR` (+ `ADDRESSNUM`/`ADDRESSSTR`) | `OWNER_ADDR`, `OWNER_AD_1`, `OWNER_AD_2`, `CITYSTATE`, `ZIP`, `FULLOWNERA` |
| Jefferson Davis | `la_jeffersondavis` | 26,157 | `gis2.totaland.com` AEDC/JDPE_Parcels MapServer/0 — **TotaLand-hosted for the parish economic-development org, not the assessor's own server** | `ParcelID` | `par_address` | — |
| St. Landry | `la_stlandry` | 58,772 | `gis2.totaland.com` StLandryParish/Parcels MapServer/0 — **TotaLand-hosted parish service, national-parcel-schema field set (`CTY_ROW_ID`, `COUNTY_FIP` …)** | `PARCEL_ID` (pinned) | `SITUS` (+ `SITUS_CITY`, `SITUS_ZIP`) | — |
| West Baton Rouge | `la_westbatonrouge` | 13,178 | `gis2.totaland.com` WestBatonRougeTaxAssessor/WestBatonRouge MapServer/1 — **first-party (parish tax assessor), TotaLand-hosted** | `ParcelNumb` (pinned; `ASSESSORID`, `PARCEL` also published) | `AISAddress` (+ `AISStreetN`, `AISPhysCit`) | `AISOwnerAd`, `AISOwnerCi` |

Sample records recorded with the measurement: Calcasieu 30.2266,−93.2174 (Lake Charles) → PIN `061008-1397-13 -000G`,
"SUGAR BOWL 2004 LLC" · Jefferson Davis 30.2241,−92.6571 (Jennings) → `221556545`, "PARKER, RICHARD K. CAROLYN L",
414 BROADWAY ST N, 0.25 ac · St. Landry 30.5335,−92.0815 (Opelousas) → `0101120288`, "BATISTE SENIC M", 117 MAIN ST S ·
Jefferson (by envelope) Elmwood → `0700000440` "EMMERSON ASSET MANAGEMENT", Harahan → `3933287515`, Metairie →
`9700005539`, Westwego-area −90.05,29.90 → `0100000361`, Lafitte-area −90.10,29.70 → `0600001469`. Extents: Calcasieu
−93.77,30.04..−92.89,30.49 (whole parish) · Jefferson −90.28,29.65..−90.01,30.05 (east + west bank) · Jefferson Davis
−93.13,30.04..−92.58,30.49 · West Baton Rouge −91.49,30.32..−91.15,30.65. Superseded and not used: Westwood
`Calcasieu_Tax_Parcels`, the unattributable `CalcParcels`, Calcasieu's TotaLand `CPPJ_Group2/MapServer/21` (same roll,
no situs — a valid alternate), Jefferson layer 18 "Parcels" (155,139; the zoning/lot layer with NO owner), the stale
2018 `WBRParcels`, and the rejected `StLandryParcels` test-account copy.

**⛔ Jefferson Parish's point-query gotcha (measured; cause NOT determined).** A bare point query
(`geometry=x,y` with `inSR=4326`) returned **0 features at three in-parish points that DO hold parcels**, while a small
**envelope** around the same points returned real parcels every time. Nobody has been able to read that server's
settings, so the cause (a bare point's spatial-reference handling on that server vs. a JSON point with a
`spatialReference`) is unproven. What was done instead of guessing: the row declares `pointViaEnvelope`, and
`queryAtPoint` (the app's real click path) asks that one layer the envelope shape that was measured working, then
picks the parcel that contains the click. The shape is pinned in `test/louisianaParishes.test.js`. **Open and named
for the live pass (V1538480 step 6):** the app's *own* original click shape — a JSON point **with** a
`spatialReference` — was never measured on this layer, so whether the envelope workaround is strictly needed is
unknown; it is harmless either way.

**Shared resolvers fixed at the ONE implementation (`appraisal.js`)**, each with a red-proofed test on the recorded
schema: Calcasieu's `PHYSICALAD` is now a situs column (before this, the card had no situs at all and the numbered
`ADDRESS1/2` mailing lines were correctly excluded); `OWNER_AD_*` / `FULLOWNERA` / `AISOwnerAd` are mailing keys; West
Baton Rouge's `AISName` is an owner fallback; a bare `SITUS` column outranks its own `SITUS_CITY`/`SITUS_ZIP` siblings
whatever order the service lists them.

**Vendor findings, so nobody re-hunts them (all measured from Michael's browser 2026-10-04):**
- **TotaLand (`gis2.totaland.com`, `gis3.totaland.com`) is a PUBLIC, CORS-open ArcGIS host serving several Louisiana
  parishes.** Its directory was walked; the Louisiana folders are **AcadiaTax, Allen, CPPJ, Colc (City of Lake
  Charles), AEDC (Jefferson Davis), StLandryParish, WestBatonRougeTaxAssessor, LTA**; the `c#####` folders are
  out-of-state clients. (Allen and Acadia are already wired from other copies — a swap to the TotaLand first-party
  folders is a one-line `layerUrl` change once someone compares them.)
- **Romlc `LA_Assessors`** (`gissrv1.romlc.net`; Rapides, Avoyelles, Grant, Lincoln, WBR, Bossier, Caddo, Natchitoches)
  answers **"Token Required" (499) — not public.**
- **`efsedge.com`** (Catahoula, Vernon) **redirects every REST call to a login page — not public.**
- **`gis.iberiagov.net`** (Iberia) **does not answer at all from Michael's browser** (connection error) — Iberia stays unwired.
- **actDataScout** (Beauregard, Sabine, Caldwell, Ouachita — and likely more) is a **login/token-gated proprietary
  viewer** (`onemap.actdatascout.com`) with **no public REST** — a legitimate "no public server", **never to be scraped.**
- **Atlas / GeoPortal Maps** (`atlas.geoportalmaps.com` — Pointe Coupee, West Feliciana, Iberia, a Jefferson assessor
  view) serves **QGIS WMS through the app's own proxy, not a public REST API** — also not wired.

**The unwired parishes, as of 2026-10-04** (each is "route 3 run 2026-10-04 from Michael's browser: <vendor>" where the
vendor is known; the rest are **not yet route-3-checked** — which is NOT "not found"):
- Rapides, Avoyelles, Grant, Lincoln — route 3 run 2026-10-04 from Michael's browser: **Romlc LA_Assessors, token-gated (499).**
- Catahoula, Vernon — route 3 run 2026-10-04 from Michael's browser: **efsedge.com, login-gated.**
- Iberia — route 3 run 2026-10-04 from Michael's browser: **`gis.iberiagov.net` unreachable (connection error); also an Atlas/GeoPortal Maps parish.**
- Beauregard, Sabine, Caldwell, Ouachita — route 3 run 2026-10-04 from Michael's browser: **actDataScout, login/token-gated.**
- Pointe Coupee — route 3 run 2026-10-04 from Michael's browser: **Atlas / GeoPortal Maps (WMS only, no public REST).** (West Feliciana was on this line; ✅ it is now WIRED from the parish government's own AGOL, 2026-10-06.)
- Evangeline — token required (ES2), 2026-09-30.
- Vermilion (Abbeville city-hole), Richland (2021, test account), Bienville (2018) — rejected 2026-09-30, unchanged.
- **Not yet route-3-checked** (as of 2026-10-04; **SUPERSEDED — every parish here was route-3-checked 2026-10-05/06, see the final section**; De Soto and Washington are now WIRED): Claiborne · Concordia · De Soto · East
  Carroll · Franklin · Jackson · La Salle · Madison · Morehouse · Red River · St. Helena · Tensas · Union ·
  Washington · West Carroll · Winn.

### Louisiana 2026-10-05/06 route-3 sweep, measured from Michael's own Chrome (NEW-1, B2085536 — closes the rest of V1413377)

Everything in this section is **"measured live from Michael's browser at the planyr.io origin, 2026-10-06"** (the
unwired-parish survey is dated 2026-10-05/06), with `fetch()` running **at the planyr.io origin, so every source below is
CORS-confirmed from production** and needs no gis-proxy. The three wired parishes were **also re-probed independently from
this sandbox on 2026-10-06** — `services5/6/7.arcgis.com` ARE reachable here (unlike the TotaLand/parish hosts), so each
count, extent, spread point and seat check below was reproduced, not only relayed.

**How they were found — the route that beat name search.** An ArcGIS Online item search with a Louisiana bbox filter
(`search?q=parcel … &bbox=-94.1,28.9,-88.8,33.1`), keeping the items whose extent covers more than half of a parish's bbox.
**Name search ("<Parish> parcels", "<Parish> assessor") missed all three.** Reuse this route before declaring any parish
"not found".

**Wired — 3 parishes (34 of 64):**

| Parish | Key | Parcels | Source (class) | Vintage | Id column | Situs (SPLIT) | Mailing — NEVER the address |
|---|---|---|---|---|---|---|---|
| De Soto | `la_desoto` | 41,968 (40,028 with owner) | De Soto Parish Assessor (linked from desotoassessor.org "Maps"), AGOL `services6.arcgis.com/pbafaqRkYgys7ElS` Parcels_AGOL_view/FeatureServer/0 — **first-party** | live roll, edited 2026-10-03 | `PARCEL_ID` (pinned; `TAX_PIN`, `ParcelNumber`, `PIN` also published) | `Address_Number` + `Street_Name` (+ `Street_Direction`, `Physical_Address_City/State/Zip_Code`); often blank on rural parcels | `Owner_Address`, `Owner_CityStateZipCode` |
| Washington | `la_washington` | 33,297 (32,992 with owner) | Washington Parish Communications District (911), AGOL `services7.arcgis.com/yE0LOKocwREqepjx` Parcels_Public_view_March_2024/FeatureServer/0 — **first-party parish body** | edited 2024-03-18 | `PARCEL_ID` (pinned; `PARCEL_NUM` also published) | `PHYSICAL_A` (**house number only**) + `PHYSICAL_S` (street) | none published; `HOUSE` / `HOUSEPIC` hold internal image paths — never rendered |
| West Feliciana | `la_westfeliciana` | 6,406 (6,149 with owner) | West Feliciana Parish Government (AGOL owner gmego@wfparish.org), `services5.arcgis.com/SkttgSmcq6CPonms` Parcels_06012022_Public/FeatureServer/**14** — **first-party** | **June 2022** (inside the 5-year bar; stated, the oldest of the batch) | `PARCEL_ID` (pinned; `AISparcelN`, `MappingNum` also published) | `Address_Nu` + `Street_Nam` + `Street_Dir`; `Physical_A/1/2` exist but were blank on every sampled row | `Owner_Addr`, `Owner_City` |

Extents (4326): De Soto −94.05,31.84 to −93.35,32.35 · Washington −90.35,30.66 to −89.73,31.01 (whole parish) · West
Feliciana −91.75,30.65 to −91.18,31.05. **Spread hits (small envelope; browser + sandbox agree):**
- **De Soto** — Mansfield −93.709,32.038 → `0400451500` "DESOTO HOSPITAL ASSOCIATION, INC.", 103 LOUISIANA; −93.53,31.94 →
  `0701061800` "NABORS PROPERTIES, L.L.C."; −93.92,32.18 → `0100026880B` "SATS 4C LAND & CATTLE, L.L.C."; also −93.70,32.20 →
  `0600921900` and −93.80,31.95 → `0300284400`. 1 km box round Mansfield: 827 parcels.
- **Washington** — Bogalusa −89.8486,30.7910 → `0440115800` "VINCE, CHARLES RAY", 1006 LOUISIANA AVENUE; `0440465715`
  "ROBERTS, BRITTANY", 1820 SOUTH COLUMBIA ROAD, 0.65 ac; −90.15,30.85 → `0330162800` 811 14TH AVENUE; rural −90.05,30.70 →
  `0600109400`, 13.3 ac. 1 km boxes: Bogalusa 298, Franklinton 344.
- **West Feliciana** — St. Francisville −91.377,30.784 → `336G-068-000-020.000` "TOWN OF ST. FRANCISVILLE", 4977 PARKER ST.;
  −91.45,30.80 → `333L-072-000-001.000` "BUTLER, R. O.,JR., VIRGINIA P.", 338 ac; −91.30,30.95 → `126M-081-000-001.000`
  "WILKINSON, BEN EST.", 11185 WALKER RD. 1 km box round St. Francisville: 299. Three further points picked from the bbox
  corners (−91.60,30.70 · −91.65,30.95 · −91.40,30.70) held nothing — outside the parish outline / on the river, not a service
  hole; and the same for De Soto −93.45,32.25.

**Rejected siblings, so nobody re-hunts them:** Washington `services7.arcgis.com/HsavlueFx5YZacwn/…/WP_PARCEL_2022` answers
**Token Required**; West Feliciana `…/Parcels/FeatureServer/0` (6,104, edited 2019-10, outside the 5-year bar).

**⛔ Two contradictions, recorded rather than smoothed over.** (1) **De Soto's bare-point query.** The browser found a bare
point at Mansfield returning 0 while the envelope returned the hospital parcel (Jefferson's shape), so the row declares
`pointViaEnvelope`. From this sandbox a bare point and a JSON point with a `spatialReference` BOTH returned a parcel at all five
in-parish points tried. The browser's exact failing shape is therefore unreproduced here; the envelope is harmless either way and
stays until V1510480 step 5 settles it. (2) The shared ladder fixes below exist because of how these schemas are split.

**Shared resolvers fixed at the ONE implementation (`appraisal.js`), each red-proofed in `test/louisianaParishes.test.js`:**
the physical-address rung used to read **De Soto's `Physical_Address_City` as the situs** (a card titled "MANSFIELD") and
**Washington's `PHYSICAL_A` — the house number alone — as the situs** (a card titled "1820"); a city/state/zip part is now never
a situs below the bare-`situs` rung, and a bare number is never a situs below that rung either (rung 0's `SITUS_NUM` behaviour is
unchanged). `Owner_City` / `Owner_State` / `Owner_Zip` are mailing keys. All three schemas split the situs, so — like Lafourche —
the parcel card's title falls back to the searched address; an address search runs a `LIKE` on the street column
(`Street_Name` · `PHYSICAL_S` · `Street_Nam`). All text columns are fixed-width **space-padded** — a blank is "          ", which the
shared placeholder test already treats as empty.

#### What was verified live, 2026-10-05/06 (Cowork chat, Michael's signed-in Chrome — recorded as observed)

- **2026-10-05, planyr.io, a build containing #2039 (the B2118880 live check):** address search returned the right parcel card in
  all five parishes wired 2026-10-04 — **Lake Charles** 949 Ryan St → SUGAR BOWL 2004 LLC / `061008-1397-13 -000G` ·
  **Jennings** 414 N Broadway → PARKER, RICHARD K. CAROLYN L / `221556545` · **Opelousas** 117 S Main → BATISTE SENIC M /
  `0101120288` · **Metairie** 3301 Veterans Blvd → CAUSEWAY LLC / `0820046558` · **Port Allen** 880 N Alexander → PARISH OF WEST
  BATON ROUGE / `030359014000`. This is the PASS for the address-search steps of the B2118880 live check (V1538480).
- **2026-10-06, build `ba0cb72` (the admin coverage map, #2038 + #2064):** Calcasieu, Jefferson, Jefferson Davis, St. Landry
  and West Baton Rouge all show "County's own server" with their publisher names — recorded against V1557536.

#### The 30 still-unwired parishes — what each actually uses (route 3, Michael's browser, 2026-10-05/06)

For **every parish in the first five groups below, a parcel source exists only behind a vendor login or a vendor's private
proxy. That is a legitimate "no public server". It MUST NOT be worked around** — no scraping, no token-guessing, no replaying a
vendor viewer's own session or proxy. **The 4 "not yet identified" parishes are the only ones a future pass should spend time
on.**

- **actDataScout** (`onemap.actdatascout.com`; login/token-gated, proprietary, no public REST — never scrape) — **18:**
  Beauregard · Bienville · Caldwell · Claiborne · Concordia · East Carroll · Evangeline · Grant · Jackson · Morehouse · Ouachita ·
  Rapides · Red River · Richland · Sabine · Union · Vermilion · West Carroll. (Taken from actDataScout's own Louisiana parish list
  plus the assessor sites for Beauregard, Sabine, Caldwell, Ouachita, Union, Jackson.)
- **Atlas / GeoPortal Maps** (`atlas.geoportalmaps.com`; QGIS WMS behind the app's own `proxy.ashx` to a private 192.168.x host —
  not a public API) — **3 more:** Iberia · La Salle · Pointe Coupee (Grant is also on actDataScout; West Feliciana is now WIRED
  above from the parish government's AGOL). Atlas once published
  `services.geoportalmaps.com/arcgis/rest/services/Iberia_Parcels_DB/MapServer`; it now returns **404**, as does every Atlas parish
  service name tried there. Iberia's own `gis.iberiagov.net` does not answer from Michael's browser at all, and the AGOL-indexed
  `gis.iberiagov.net/…/Parcels/AssessorFeb2019` is the same dead host.
- **Token/login-gated ArcGIS** — **4:** Avoyelles · Lincoln (`gissrv1.romlc.net` LA_Assessors, "Token Required" 499) ·
  Catahoula · Vernon (`efsedge.com`; every REST call redirects to a login page).
- **Greenstone** (`localgreenstone.com`, MapGuide behind a login session) — **1:** Winn.
- **Evangeline** — ES2 `Parcel_Search_Widget_AGOL` still answers Token Required (also on the actDataScout list above).
- **Not yet identified — 4:** Franklin · Madison (madisonparish.org assessor page: email only, no online map) · St. Helena · Tensas.
  None has an assessor website with a map, and the Louisiana-bbox AGOL sweep found nothing for them. **These are the only ones a
  future pass should spend time on.**
- **Also seen, not used:** `gis2.totaland.com` LTA/RealChoropleth (90,084 Lafayette parcels; an assessor research/choropleth layer, no
  owner/situs fields, "Pagination is not supported" on an envelope query) — not a better Lafayette source than the one wired.
  The `gis2`/`gis3.totaland.com` folders were walked in full; **every Louisiana folder with a parcel layer there is now wired.**

Count check: 18 + 3 + 4 + 1 + 4 = **30** unwired, and 34 wired = 64.



## Memphis 100-mile radius (NEW-1 / B2289168, 2026-10-15)

71 counties computed by a server-side 100-statute-mile distance query from downtown Memphis (list and edge bands on B2289168; fixture
`test/fixtures/memphisRadiusCounties.json`). **Mississippi correction:** the "two half-state services, shape-mismatch" row above is superseded —
`Cadastral/MS_Parcels_August_2024` on gis.mississippi.edu is ONE service with the West half as layer 1 and the East half as layer 2 (same 55
fields, `CNTYNAME`), so each county pins its layer + `scopeWhere` (the Idaho shape). 24 counties wired (DeSoto keeps its own). All new blocked
hosts go through `/gis-proxy` (sandbox cannot read their CORS); Arkansas statewide was moved onto it too. **Tennessee:** the Comptroller layer
omits Shelby and Chester (`excludedCounties` — a composite is never routed a county it excludes). **Shelby (×2, 2026-10-15) — a RETRACTED
"no public source":** the Shelby County Assessor of Property's own `CERTParcel` service is on `scgis.shelbycountytn.gov` (NOT the
Cloudflare-challenged `gis.` viewer), token-free, countywide incl. Germantown/Collierville with owners; wired as `tn_shelby` through
`/gis-proxy` (the old Germantown/Collierville city scopes were folded in). Found by a pass-2 AGOL search — the item is registered by the City of
Millington, not the county, which is why a county-org search missed it. **Chester TN (×3, 2026-10-16) — ALSO a retracted "no source":** the
Chester County Assessor of Property's own public AGOL web map (`f214fb11968a4539bf128561ea61ecd6`) reads its Parcels from
`https://gis.capturecama.com/arcgis/rest/services/ChesterTN/ChesterCapture/MapServer/7` (CaptureCAMA = the Tennessee Comptroller's assessment
system; token-free, Map/Query/Data, ~10,333 parcels); wiring and field mapping are on B2289169. **Missouri bootheel / Kentucky — corrected
2026-10-16 (NEW-2):** Butler, Dunklin and Ripley MO each run a FREE PUBLIC county parcel map on Integrity GIS (Geocortex site ids
`Butler_County_MO`, `Dunklin_County_MO`, `Ripley_County_MO` at `butlergis.integritygis.com`), so "no public source" was wrong for them — but the
data behind the viewers (`services4.integritygis.com/arcgis/rest/services/MO/<County>_Assessor_Data/MapServer`) answers `Token Required` (499):
the viewer injects its own key, which Planyr must NOT replay or harvest (same rule as the Shelby bot-challenged viewer). Record: **public viewer
exists; data access needs a key from the county or Integrity GIS.** **Genuine gaps** (nothing public found): New Madrid and Pemiscot MO (no county
viewer on Integrity GIS or AGOL) and Fulton KY (the PVA uses qPublic, a paid subscription) — see B2289169. Live check: `ui-audit/verify-memphis-radius-live.mjs` (all 71 counties ×
both lot-picking flows; V1720784).


## Georgia counties (2026-10-19)

**Owner request 2026-10-19:** "wire more of Georgia" (B2316720; branch `claude/wonderful-hypatia-wmz2kf`; sixteen sibling sessions did other states the same day). Start: 60 of 159 counties wired (the 2026-09 first/second/third passes, hand-written `ga_*` rows in `counties.js`). **Now: 111 of 159 wired, 48 named gaps.** New rows live in `gaParcels.js` (prose in `gaProvenance.js`), plugged into `counties.js` with one import line, exactly like Alabama's. The 2026-09-09 statewide probe's "no-free-source" verdict for Georgia stands for a STATEWIDE layer (there is none), but its "none found" for individual counties was stale: it ran before pass 2 and before `/gis-proxy`.

**What carries Georgia's parcels (the finding that explains why so many counties had a public layer all along).** Georgia's assessors mostly sit behind qPublic (no API, bot-walled — never scraped), but the digest/GIS contractors and the regional commissions that serve them each publish the underlying WinGAP/CAMA export as an ArcGIS Online (AGOL) org: the **appraisal-contractor org `ISpzx3B5ZsVA6e1Z`** (accounts graham_ghorley / Trudy_Umfuhrer; it also hosts the 'GMASS' project layers — the contractor identity is inferred, not stated by the org) (county "Web Map" services with `Owner`: Union, Dawson, Glascock, Chattooga, Jeff Davis, Jefferson, Taylor, Telfair, Laurens, McIntosh…), the **Heart of Georgia Altamaha Regional Commission org `HHvUPZ2XuLOAJxjR`** (`<County> County Wide_View` services with a `TaxParcels_25` layer: Appling, Bleckley, Candler, Dodge, Tattnall, Treutlen, Wayne, Wheeler, Wilcox, Montgomery, Toombs), the **River Valley RC layers in the GARC org `Ug5xGQbHsD8zuZzM`** (Harris, Talbot, Stewart, Chattahoochee), the **Southern Georgia RC host `www.sgrcmaps.com`** (relayed: Atkinson, Ben Hill, Brooks, Coffee, Irwin, Pierce, and a countywide Cook layer), and two county-run servers (Douglas, Thomas) plus a handful of single-county layers (Floyd, Houston, Decatur, Walker, Franklin, Hart, White, Grady, Johnson/Wilkinson).

**How each wired row was measured (the rule from the dispatch, applied to every one).** Live, 2026-10-19: AGOL hosts directly from the sandbox, every other host through the production relay (`planyr.io/gis-proxy`): layer type polygon, feature count, `outSR=4326` extent inside Georgia and overlapping the named county, then point queries at **5 spread interior points** and **3–4 points just inside the county line**, requiring a parcel id on the hit. The county outlines are Esri's USA_Counties (Census TIGER) polygons. Test artifacts: `test/georgiaCounties.test.js` + `test/fixtures/georgiaCounties.json` / `georgiaSamples.json` (a recorded real attribute bag per source). **Red-proof:** on main a8d440d the 51 new counties fell through to "no-source"; deleting the `gaRaw()`/`gaMap()` spreads turns the per-county "wired" cases red (89 failures when measured with the first 30 rows).

**Defects found by re-measuring the existing 60 rows.**
- **`ga_cook` was Adel-only** — the Esri layer the third pass wired (5,103 lots) returned **no lot at 0 of 5 spread points** of the county (the third pass had flagged exactly this doubt). Re-pointed to the SGRC countywide layer (10,432 parcels, 4/5 interior, 4/4 near-line).
- The other rows re-measured with ≥3/5 interior hits (table below). Rows whose host the sandbox could only reach after this change's relay allow-list additions are marked in the table.

**Owner column.** `LASTNAME` is the whole owner on the WinGAP rolls (Thomas, Atkinson, Brooks, Irwin, Pierce, Houston, Stewart, Talbot, Walker, Montgomery, Toombs) — `OWNER_FALLBACK_RE` in `appraisal.js` now accepts `last_?name` so they show an owner (a first name, where a roll splits one into `FIRSTNAME`, is not shown). Layers with no owner column (HOGARC tax-parcel layers, Hart, White, Franklin, Grady, Coffee) are marked "no" — parcel id + acres + geometry only.

**Traps hit (so nobody re-hunts them).**
- *Carroll* — the AGOL "Carroll County Parcel Viewer" is Carroll County, **Mississippi**; GDIT's Georgia entry points at a dead GMASS service. *Walton* — the Hub/AGOL hits are Walton County, **Florida** (DeFuniak Springs); the GA copy is dead (2019) or token-gated.
- *Walker* — `Walker_Parcels_2021/2026LLLT` (UT-Chattanooga) holds 7,811 lots covering only the **western** third of Walker (extent to -85.27, county to -85.05; it is Dade-sized): REJECTED; wired the 34,945-lot `Parcels` layer instead (5/5 spread points, extent covers the county).
- *Upson, Oglethorpe* — real layers exist but answer `Token Required` (499).
- *Macon* (2018 copy) and *Wilkes* (2021 copy) are the only sources found and are past the project's 5-year staleness bar — NOT wired (a stale parcel fabric is worse than the named gap).
- *Habersham* — GDIT's ROK Technologies link now 404s (folder removed). *Long* — the CRC service holds subdivisions only. *Berrien* — SGRC's folder has only Nashville zoning. *Rabun/Jones* — partial layers (Sky Valley; 40 features).

**Searched for every gap (the "No source" discipline — three earlier no-source findings were wrong).** (1) The four regional AGOL orgs enumerated **layer by layer** (not by service title — title-matching missed Laurens/McIntosh/Telfair on the first pass): that contractor org 54 services, GARC 1,766, SGRC 193, VALOR 395, HOGARC 135; (2) the GDIT "Parcels - GA" index (85 items, `title:"Parcels - GA -"`) — every Georgia entry checked; (3) AGOL keyword searches (4 phrasings × each of the 99 then-unwired counties), ArcGIS Hub dataset search per county, a **2,569-service bounding-box sweep** over Georgia for parcel-word items, and a per-county-name bounding-box sweep for the gap counties; (4) web search for each regional commission (Three Rivers, NW Georgia, Heart of Georgia, Southwest Georgia) and for the larger gap counties' own viewers. qPublic is bot-walled and was never scraped; the paid resellers (Regrid, LandRecords, ReportAll USA store, Equator) are not used. **Build-item check:** no gap turned out to be a format we do not read — every REST layer found was a standard ArcGIS FeatureServer/MapServer; the remaining gaps have no public layer at all.

**Re-run recipe.** The discovery scripts are throw-away; the method is above and each gap's reason is in its table row. A county leaves the gap list the day a current, countywide layer with a parcel id is found: add its row to `gaParcels.js`, drop it from `test/fixtures/georgiaCounties.json` `gaps`, and measure it the way the paragraph above says.

| County | Status | Source | Owner? | Measured / what was searched |
|---|---|---|---|---|
| Appling | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 12,828 parcels; spread-point hits 5/5, near-line 3/3; 'TaxParcels25', edited 2026-07-27 (replaces the stale 2021 copy that was refused) |
| Atkinson | **new 2026-10-19** | Southern Georgia Regional Commission (www.sgrcmaps.com, relayed) — `www.sgrcmaps.com` | yes | 4,716 parcels; spread-point hits 4/5, near-line 3/3; live server |
| Bacon | **gap** — "Bacon County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Baker | **gap** — "Baker County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Baldwin | wired earlier (2026-09) | `services7.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 21,411 parcels, spread-point hits 5/5, near-line 3/4 |
| Banks | **gap** — "Banks County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Barrow | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 35,234 parcels, spread-point hits 4/5, near-line 1/3 |
| Bartow | wired earlier (2026-09) | `www.bartowgis.org` | see `counties.js` | re-measured 2026-10-19: 63,689 parcels, spread-point hits 5/5, near-line 3/3 |
| Ben Hill | **new 2026-10-19** | Southern Georgia Regional Commission (www.sgrcmaps.com, relayed) — `www.sgrcmaps.com` | yes | 11,549 parcels; spread-point hits 5/5, near-line 3/4; live server |
| Berrien | **gap** — "Berrien County — no parcel data wired here yet." | none found | — | SGRC's Berrien folder holds only the Nashville zoning layer — no parcel layer (re-checked through the relay). |
| Bibb | wired earlier (2026-09) | `services2.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 68,899 parcels, spread-point hits 5/5, near-line 1/2 |
| Bleckley | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 7,273 parcels; spread-point hits 5/5, near-line 2/3; 'TaxParcels_25', edited 2026-04-27 |
| Brantley | wired earlier (2026-09) | `services3.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 13,301 parcels, spread-point hits 5/5, near-line 2/3 |
| Brooks | **new 2026-10-19** | Southern Georgia Regional Commission (www.sgrcmaps.com, relayed) — `www.sgrcmaps.com` | yes | 10,037 parcels; spread-point hits 4/5, near-line 2/3; live server |
| Bryan | wired earlier (2026-09) | `bryangis.bryan-county.org` | see `counties.js` | re-measured 2026-10-19: 23,200 parcels, spread-point hits 4/5, near-line 1/4 |
| Bulloch | wired earlier (2026-09) | `services6.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 34,014 parcels, spread-point hits 5/5, near-line 4/4 |
| Burke | **gap** — "Burke County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Butts | wired earlier (2026-09) | `services6.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 13,065 parcels, spread-point hits 4/5, near-line 0/3 |
| Calhoun | **gap** — "Calhoun County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Camden | wired earlier (2026-09) | `services2.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 31,649 parcels, spread-point hits 4/5, near-line 4/4 |
| Candler | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 7,151 parcels; spread-point hits 5/5, near-line 2/4; 'TaxParcel_26', edited 2026-01-26; the parcel number is the NAME column |
| Carroll | **gap** — "Carroll County — no parcel data wired here yet." | none found | — | Re-searched: the "Carroll County Parcel Viewer" AGOL hit is Carroll County MISSISSIPPI (extent near -90°). GDIT's Georgia entry (`Carroll_Parcels`, GMASS org) is dead ("Invalid URL"); the live GMASS org holds only Carroll sales/soils/improvement layers, no parcel layer. Commercial resellers carry it (≈55k parcels) — not used. |
| Catoosa | **gap** — "Catoosa County — no parcel data wired here yet." | none found | — | Re-searched: only commercial resellers (≈29.8k parcels). The county tax-assessor site is the only public face. |
| Charlton | wired earlier (2026-09) | `services3.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 7,357 parcels, spread-point hits 5/5, near-line 3/3 |
| Chatham | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 126,490 parcels, spread-point hits 4/5, near-line 3/4 |
| Chattahoochee | **new 2026-10-19** | River Valley Regional Commission, published in the Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM) — `services1.arcgis.com` | yes | 1,785 parcels; spread-point hits 3/5, near-line 1/3; undated working copy |
| Chattooga | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 14,501 parcels; spread-point hits 5/5, near-line 2/4; edited 2025-09-16 |
| Cherokee | wired earlier (2026-09) | `gis.cherokeecountyga.gov` | see `counties.js` | re-measured 2026-10-19: 116,114 parcels, spread-point hits 4/5, near-line 2/3 |
| Clarke | wired earlier (2026-09) | `services2.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 41,989 parcels, spread-point hits 5/5, near-line 2/3 |
| Clay | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 3,063 parcels, spread-point hits 4/5, near-line 3/4 |
| Clayton | wired earlier (2026-09) | `weba.co.clayton.ga.us:5443` | see `counties.js` | relay could not reach it — the county server answered the relay with 502/522 (it does not answer Cloudflare egress); the app reads it straight from the browser, where the 2026-09 passes measured it. Covered by the browser click V1747248 |
| Clinch | **gap** — "Clinch County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Cobb | wired earlier (2026-09) | `gis.cobbcounty.gov` | see `counties.js` | re-measured 2026-10-19: 279,965 parcels, spread-point hits 4/5, near-line 2/4 |
| Coffee | **new 2026-10-19** | Southern Georgia Regional Commission (www.sgrcmaps.com, relayed) — `www.sgrcmaps.com` | no | 21,364 parcels; spread-point hits 4/5, near-line 3/3; live server |
| Colquitt | **gap** — "Colquitt County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Columbia | wired earlier (2026-09) | `services3.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 66,097 parcels, spread-point hits 5/5, near-line 4/4 |
| Cook | **re-pointed 2026-10-19** (was Adel-only) | Southern Georgia Regional Commission — `www.sgrcmaps.com` (relayed) | no | 10,432 parcels; spread-point hits 4/5, near-line 4/4. The earlier Esri layer returned **no lot at 0/5 spread points** of the county. |
| Coweta | wired earlier (2026-09) | `coweta-gis-web.coweta.ga.us` | see `counties.js` | relay could not reach it — the county server answered the relay with 502/522 (it does not answer Cloudflare egress); the app reads it straight from the browser, where the 2026-09 passes measured it. Covered by the browser click V1747248 |
| Crawford | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 8,186 parcels, spread-point hits 5/5, near-line 3/4 |
| Crisp | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 12,351 parcels, spread-point hits 5/5, near-line 2/3 |
| Dade | wired earlier (2026-09) | `services.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 7,811 parcels, spread-point hits 5/5, near-line 1/4 |
| Dawson | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 19,599 parcels; spread-point hits 5/5, near-line 2/4; edited 2026-03-31 |
| Decatur | **new 2026-10-19** | ArcGIS Online org uCLHikoEKcQwv9tD 'Decatur' tax-parcel layer (GDIT's own Decatur index points at a different org; affiliation not established — the layer names Decatur County, GA in COUNTY_NAM/COUNTY_FIP 13087) — `services1.arcgis.com` | yes | 18,781 parcels; spread-point hits 5/5, near-line 3/3; edited 2026-04-30 |
| DeKalb | wired earlier (2026-09) | `services2.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 245,688 parcels, spread-point hits 4/5, near-line 2/4 |
| Dodge | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 12,515 parcels; spread-point hits 5/5, near-line 4/4; 'TaxParcels25', edited 2026-07-31 |
| Dooly | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 7,277 parcels, spread-point hits 5/5, near-line 4/4 |
| Dougherty | wired earlier (2026-09) | `services6.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 38,007 parcels, spread-point hits 4/5, near-line 3/4 |
| Douglas | **new 2026-10-19** | Douglas County GIS (maps.douglascountyga.gov, relayed) — `maps.douglascountyga.gov` | yes | 55,100 parcels; spread-point hits 5/5, near-line 3/4; live county server |
| Early | **gap** — "Early County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Echols | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 2,206 parcels, spread-point hits 5/5, near-line 3/4 |
| Effingham | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 32,941 parcels, spread-point hits 5/5, near-line 4/4 |
| Elbert | **new 2026-10-19** | Northeast Georgia Regional Commission future-development-map parcel layer (GARC org Ug5xGQbHsD8zuZzM) — `services1.arcgis.com` | no | 11,237 parcels; spread-point hits 5/5, near-line 2/2; edited 2026-10-02 |
| Emanuel | wired earlier (2026-09) | `services8.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 15,107 parcels, spread-point hits 5/5, near-line 3/3 |
| Evans | wired earlier (2026-09) | `services6.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 6,672 parcels, spread-point hits 4/5, near-line 2/3 |
| Fannin | **gap** — "Fannin County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Fayette | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 49,131 parcels, spread-point hits 5/5, near-line 1/4 |
| Floyd | **new 2026-10-19** | Rome-Floyd County GIS (ArcGIS Online org nV67H1IJR8GS6SAA 'Current_Parcels') — `services2.arcgis.com` | yes | 49,316 parcels; spread-point hits 5/5, near-line 1/2; values through 2022 |
| Forsyth | wired earlier (2026-09) | `geo.forsythco.com` | see `counties.js` | re-measured 2026-10-19: 105,607 parcels, spread-point hits 5/5, near-line 4/4 |
| Franklin | **new 2026-10-19** | Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM), layer 'Parcels' of a Rose Hill web map — `services1.arcgis.com` | no | 16,149 parcels; spread-point hits 4/5, near-line 3/3; edited 2023-05-15 |
| Fulton | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 373,306 parcels, spread-point hits 4/5, near-line 2/3 |
| Gilmer | **gap** — "Gilmer County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Glascock | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 2,455 parcels; spread-point hits 4/5, near-line 3/4; edited 2026-08-18 |
| Glynn | wired earlier (2026-09) | `gis-web.glynncounty-ga.gov` | see `counties.js` | relay could not reach it — the county server answered the relay with 502/522 (it does not answer Cloudflare egress); the app reads it straight from the browser, where the 2026-09 passes measured it. Covered by the browser click V1747248 |
| Gordon | **new 2026-10-19** | Gordon County GIS (ArcGIS Online account gordongis, layer 'GC Parcels' of the OpenGov service) — `services3.arcgis.com` | no | 28,878 parcels; spread-point hits 5/5, near-line 3/4; edited 2026-01-22 |
| Grady | **new 2026-10-19** | ArcGIS Online org Pf7RRv4QttHB3VbR 'WebParcels' (affiliation not established; GDITAdmin's own Grady index points here) — `services7.arcgis.com` | no | 14,057 parcels; spread-point hits 5/5, near-line 2/4; edited 2021-03-30 (>5 yr) |
| Greene | wired earlier (2026-09) | `services7.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 17,735 parcels, spread-point hits 5/5, near-line 3/4 |
| Gwinnett | wired earlier (2026-09) | `services3.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 309,705 parcels, spread-point hits 5/5, near-line 4/4 |
| Habersham | **gap** — "Habersham County — no parcel data wired here yet." | none found | — | GDIT's entry points at arcgis5.roktech.net `habersham/habersham_rokmaps` layer 8 — the host's `habersham` folder now returns 404 (removed). The ROK host is on the relay allow-list; no Habersham service remains on it. |
| Hall | wired earlier (2026-09) | `hallgis.hallcounty.org` | see `counties.js` | re-measured 2026-10-19: 92,490 parcels, spread-point hits 5/5, near-line 4/4 |
| Hancock | **gap** — "Hancock County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Haralson | **gap** — "Haralson County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Harris | **new 2026-10-19** | River Valley Regional Commission, published in the Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM) — `services1.arcgis.com` | yes | 21,044 parcels; spread-point hits 5/5, near-line 3/4; edited 2026-04-03 |
| Hart | **new 2026-10-19** | Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM), layer 'Parcels' of the Lavonia sewer web map — `services1.arcgis.com` | no | 18,340 parcels; spread-point hits 5/5, near-line 4/4; 2023 web map |
| Heard | **gap** — "Heard County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Henry | wired earlier (2026-09) | `arcgis.co.henry.ga.us` | see `counties.js` | re-measured 2026-10-19: 103,734 parcels, spread-point hits 5/5, near-line 3/4 |
| Houston | **new 2026-10-19** | Middle Georgia Regional Commission, published in the Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM) — `services1.arcgis.com` | yes | 68,166 parcels; spread-point hits 5/5, near-line 1/3; edited 2025-03-20 |
| Irwin | **new 2026-10-19** | Southern Georgia Regional Commission (www.sgrcmaps.com, relayed) — `www.sgrcmaps.com` | yes | 7,073 parcels; spread-point hits 5/5, near-line 4/4; live server |
| Jackson | wired earlier (2026-09) | `services8.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 45,054 parcels, spread-point hits 5/5, near-line 3/4 |
| Jasper | **new 2026-10-19** | Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM), Jasper County future-development-map layer carrying the full roll — `services1.arcgis.com` | yes | 10,447 parcels; spread-point hits 5/5, near-line 2/4; edited 2023-05-24 |
| Jeff Davis | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 8,472 parcels; spread-point hits 5/5, near-line 4/4; edited 2026-07-10 |
| Jefferson | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 12,003 parcels; spread-point hits 5/5, near-line 3/3; edited 2025-07-07 |
| Jenkins | **gap** — "Jenkins County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Johnson | **new 2026-10-19** | ReportAll USA-schema county parcel export (ArcGIS Online org ue5fMdTkPeHLCobS) — `services1.arcgis.com` | yes | 5,854 parcels; spread-point hits 4/5, near-line 3/4; edited 2026-10-05 |
| Jones | **gap** — "Jones County — no parcel data wired here yet." | none found | — | Only a 40-feature Georgia College research layer. Not county-wide, NOT wired. |
| Lamar | **gap** — "Lamar County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Lanier | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 5,968 parcels, spread-point hits 5/5, near-line 4/4 |
| Laurens | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 30,018 parcels; spread-point hits 5/5, near-line 3/4; layer 'Parcels' of the county web map |
| Lee | **new 2026-10-19** | ArcGIS Online account charles.talley 'Tyler Technology map' (affiliation not established; the layer is a Lee County GA roll) — `services7.arcgis.com` | yes | 14,713 parcels; spread-point hits 5/5, near-line 3/4; edited 2022-07-14 (4.3 years — inside the 5-year bar) |
| Liberty | wired earlier (2026-09) | `maps.crc.ga.gov` | see `counties.js` | re-measured 2026-10-19: 28,170 parcels, spread-point hits 5/5, near-line 4/4 |
| Lincoln | **gap** — "Lincoln County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Long | **gap** — "Long County — no parcel data wired here yet." | none found | — | The Coastal Regional Commission's `Long/LongParcels` service holds a subdivisions layer only, not parcels (re-checked 2026-10-19). |
| Lowndes | wired earlier (2026-09) | `services3.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 52,540 parcels, spread-point hits 5/5, near-line 3/3 |
| Lumpkin | **new 2026-10-19** | ArcGIS Online org BAJNi3EgCdtQ1BCG 'Lumpkin County Parcels' (account layermanager; affiliation not established — the layer is the 2025 Lumpkin roll) — `services6.arcgis.com` | yes | 17,741 parcels; spread-point hits 5/5, near-line 3/4; edited 2025-02-05 |
| Macon | **gap** — "Macon County — no parcel data wired here yet." | none found | — | Only a December-2018 copy exists (`Parcels12_2018` on the GARC org, 8,798 lots with owner): older than the project's 5-year staleness bar, so NOT wired; wire it the day a current layer appears. |
| Madison | **gap** — "Madison County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Marion | **gap** — "Marion County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| McDuffie | **gap** — "McDuffie County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| McIntosh | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 13,269 parcels; spread-point hits 4/5, near-line 4/4; 2025 web map, layer 'Parcels' |
| Meriwether | wired earlier (2026-09) | `services9.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 16,511 parcels, spread-point hits 5/5, near-line 3/4 |
| Miller | **gap** — "Miller County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Mitchell | **gap** — "Mitchell County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Monroe | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 16,707 parcels, spread-point hits 5/5, near-line 3/4 |
| Montgomery | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county-boundary study service (ArcGIS Online org HHvUPZ2XuLOAJxjR) — 2022 tax-parcel layer — `services5.arcgis.com` | yes | 6,174 parcels; spread-point hits 5/5, near-line 3/3; 2022 tax roll, edited 2023-06-15 |
| Morgan | wired earlier (2026-09) | `services9.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 12,190 parcels, spread-point hits 4/5, near-line 4/4 |
| Murray | **gap** — "Murray County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Muscogee | wired earlier (2026-09) | `services2.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 70,625 parcels, spread-point hits 4/5, near-line 2/4 |
| Newton | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 45,755 parcels, spread-point hits 4/5, near-line 4/4 |
| Oconee | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 19,068 parcels, spread-point hits 5/5, near-line 4/4 |
| Oglethorpe | **gap** — "Oglethorpe County — no parcel data wired here yet." | none found | — | GDIT's entry (`Tax_Parcels`, org IX9GvidKl201KteW) answers `Token Required` (499) — not public. |
| Paulding | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 68,018 parcels, spread-point hits 5/5, near-line 2/4 |
| Peach | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 14,431 parcels, spread-point hits 5/5, near-line 1/3 |
| Pickens | **gap** — "Pickens County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Pierce | **new 2026-10-19** | Southern Georgia Regional Commission (www.sgrcmaps.com, relayed) — `www.sgrcmaps.com` | yes | 12,893 parcels; spread-point hits 5/5, near-line 3/4; live server |
| Pike | **gap** — "Pike County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Polk | **gap** — "Polk County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Pulaski | **gap** — "Pulaski County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Putnam | **new 2026-10-19** | ArcGIS Online account ESG_Admin 'Putnam_Parcels' (affiliation not established) — `services9.arcgis.com` | no | 19,253 parcels; spread-point hits 5/5, near-line 2/4; edited 2023-06-07 |
| Quitman | **gap** — "Quitman County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Rabun | **gap** — "Rabun County — no parcel data wired here yet." | none found | — | Only a 1,487-lot Sky Valley partial layer (GARC org). Not county-wide, NOT wired. |
| Randolph | **gap** — "Randolph County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Richmond | wired earlier (2026-09) | `gismap.augustaga.gov` | see `counties.js` | relay could not reach it — the county server answered the relay with 502/522 (it does not answer Cloudflare egress); the app reads it straight from the browser, where the 2026-09 passes measured it. Covered by the browser click V1747248 |
| Rockdale | wired earlier (2026-09) | `services.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 36,856 parcels, spread-point hits 5/5, near-line 3/3 |
| Schley | **gap** — "Schley County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Screven | wired earlier (2026-09) | `maps.crc.ga.gov` | see `counties.js` | re-measured 2026-10-19: 10,979 parcels, spread-point hits 5/5, near-line 4/4 |
| Seminole | **gap** — "Seminole County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Spalding | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 33,712 parcels, spread-point hits 4/5, near-line 4/4 |
| Stephens | **gap** — "Stephens County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Stewart | **new 2026-10-19** | River Valley Regional Commission, published in the Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM) — `services1.arcgis.com` | yes | 4,068 parcels; spread-point hits 4/5, near-line 3/4; edited 2022-02-16 (older than 5 years is NOT the case; 4.7 yr) |
| Sumter | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 16,415 parcels, spread-point hits 5/5, near-line 3/3 |
| Talbot | **new 2026-10-19** | River Valley Regional Commission, published in the Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM) — `services1.arcgis.com` | yes | 6,692 parcels; spread-point hits 4/5, near-line 3/4; edited 2025-07-28 |
| Taliaferro | **gap** — "Taliaferro County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Tattnall | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 12,858 parcels; spread-point hits 4/5, near-line 4/4; 'TaxParcels_25', edited 2026-09-11 |
| Taylor | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 6,417 parcels; spread-point hits 5/5, near-line 4/4; edited 2025-07-16 |
| Telfair | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — `services.arcgis.com` | yes | 8,871 parcels; spread-point hits 4/5, near-line 3/3; 2025 web map, layer 'Telfair_Parcels_Webmap' |
| Terrell | **gap** — "Terrell County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Thomas | **new 2026-10-19** | Thomas County GIS (www.thomascountymaps.org, relayed) — `www.thomascountymaps.org` | yes | 24,832 parcels; spread-point hits 4/5, near-line 3/3; live county server; owner is the LASTNAME column |
| Tift | wired earlier (2026-09) | `www.sgrcmaps.com` | see `counties.js` | re-measured 2026-10-19: 19,194 parcels, spread-point hits 5/5, near-line 3/4 |
| Toombs | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county-boundary study service (ArcGIS Online org HHvUPZ2XuLOAJxjR) — 2022 tax-parcel layer — `services5.arcgis.com` | yes | 16,238 parcels; spread-point hits 5/5, near-line 3/4; 2022 tax roll, edited 2023-06-15 |
| Towns | **gap** — "Towns County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Treutlen | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 4,340 parcels; spread-point hits 3/5, near-line 1/4; 'TaxParcels_25', edited 2026-05-28; 3 of 5 spread points hit (the rest fall on unparcelled tracts) |
| Troup | wired earlier (2026-09) | `services6.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 35,511 parcels, spread-point hits 5/5, near-line 4/4 |
| Turner | wired earlier (2026-09) | `services5.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 5,714 parcels, spread-point hits 5/5, near-line 3/3 |
| Twiggs | wired earlier (2026-09) | `services1.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 6,832 parcels, spread-point hits 4/5, near-line 2/4 |
| Union | **new 2026-10-19** | Georgia county appraisal-contractor web map (ArcGIS Online org ISpzx3B5ZsVA6e1Z) — 'Union_Parcels_2026' — `services.arcgis.com` | yes | 24,391 parcels; spread-point hits 4/5, near-line 2/4; edited 2026-10-14 |
| Upson | **gap** — "Upson County — no parcel data wired here yet." | none found | — | The WinGAP republication (`Parcel_Regions_w_WinGAP`, org 1zCta9fCSdX45Yaq, 15,938 parcels) answers `Token Required` (499) — not public. |
| Walker | **new 2026-10-19** | ArcGIS Online org tzrZqCyu9DgupjuD 'Parcels' (WinGAP export; affiliation not established — extent and 5/5 spread points are Walker County's, not the western-half 'Walker_Parcels_2026LLLT' layer that holds 7,811 lots) — `services7.arcgis.com` | yes | 34,945 parcels; spread-point hits 5/5, near-line 3/3; edited 2025-12-11 |
| Walton | **gap** — "Walton County — no parcel data wired here yet." | none found | — | Re-searched (the earlier 'no usable source' stands for now, with new leads): GDIT's index points at Parcels_Walton_2019 on the Atlanta Regional Commission org — dead ("Invalid URL") and 2019 anyway; the county's own org publishes `walton_parcels_view`, token-required (499); the Hub/AGOL hits are Walton County FLORIDA (DeFuniak Springs owner cities). NEW LEAD: `gis11.cama.io/arcgis/rest/services/Walton/WaltonCounty_Features/MapServer` (a CAMA.io-hosted copy, 2017) — host added to the relay allow-list in this change; measured result recorded below if it answered. |
| Ware | wired earlier (2026-09) | `services9.arcgis.com` | see `counties.js` | re-measured 2026-10-19: 23,139 parcels, spread-point hits 5/5, near-line 2/4 |
| Warren | **new 2026-10-19** | ArcGIS Online account JeffreyF96 'GA_Warren_County_13301' (affiliation not established; the layer names Warren County GA in COUNTY_NAM/COUNTY_FIP 13301) — `services8.arcgis.com` | yes | 4,675 parcels; spread-point hits 5/5, near-line 3/3; edited 2026-10-09 |
| Washington | **gap** — "Washington County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Wayne | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 17,629 parcels; spread-point hits 5/5, near-line 4/4; 'Tax Parcels', edited 2026-09-10; the service is named *_test but holds the county roll |
| Webster | **gap** — "Webster County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Wheeler | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 4,063 parcels; spread-point hits 5/5, near-line 2/3; 'TaxParcels18' (an 2018 roll geometry, edited 2026-02-06) |
| White | **new 2026-10-19** | Georgia Association of Regional Commissions org (Ug5xGQbHsD8zuZzM), layer 'Parcels' of the Cleveland sewer web map — `services1.arcgis.com` | no | 19,990 parcels; spread-point hits 4/5, near-line 2/4; 2023 web map |
| Whitfield | wired earlier (2026-09) | `gis.whitfieldcountyga.com` | see `counties.js` | re-measured 2026-10-19: 46,685 parcels, spread-point hits 5/5, near-line 0/2 |
| Wilcox | **new 2026-10-19** | Heart of Georgia Altamaha Regional Commission county web service (ArcGIS Online org HHvUPZ2XuLOAJxjR, account hogagis) — `services5.arcgis.com` | no | 6,169 parcels; spread-point hits 5/5, near-line 3/3; 'TaxParcels_25', edited 2025-09-12 |
| Wilkes | **gap** — "Wilkes County — no parcel data wired here yet." | none found | — | Searched, nothing usable: the 12 regional-commission and appraisal-contractor ArcGIS Online orgs (GARC, SGRC, VALOR, GMASS, RVRC, HOGARC, ReportAll…) enumerated layer by layer; the GDIT "Parcels - GA" index (85 items); AGOL keyword, Hub-dataset, bounding-box (2,569 services) and per-county-name sweeps; web search for the county's own viewer. No public REST parcel layer — the county sits behind qPublic (bot-walled, never scraped) or publishes only a paid/tokened copy. |
| Wilkinson | **new 2026-10-19** | ReportAll USA-schema county parcel export (ArcGIS Online org ue5fMdTkPeHLCobS) — `services1.arcgis.com` | yes | 7,849 parcels; spread-point hits 4/5, near-line 3/4; edited 2026-10-05 |
| Worth | **new 2026-10-19** | River Valley Community College District / USG research account (heirs-property study) — layer 4 holds the full Worth County roll — `services2.arcgis.com` | yes | 12,726 parcels; spread-point hits 5/5, near-line 2/3; edited 2023-05-30 |

## Alabama counties (B2302784 + B2302785 + B2312352, 2026-10-16) — 67 of 67 wired

Owner request 2026-10-16: *"let's wire up Alabama and Mississippi"* (this section is Alabama; Mississippi is its own item). **Alabama has no free statewide parcel service**, so each county was resolved on its own.
Routes tried for every county: (1) statewide — ADOR / AGIC / GSA / ALDOT, ArcGIS Online org search, ArcGIS Hub, the NSGIC 2025 Parcel Portal (`VIEWURL` only; `DLDURL`/`APIURL` empty for all 67); (2) the county Revenue Commissioner / tax assessor / county GIS — by AGOL item search, by web search of REST directories, and by walking the county viewer's real server (that is how Calhoun's `/arcgis/rest/services` was found when the viewer's own `/ArcGIS5` path 404'd); (3) regional bodies (the Central Alabama commission publishes Autauga + Elmore + Montgomery). **Sources rejected on purpose:** PowerSouth's Regrid-derived layer (reseller), Atmore-only subsets uploaded by a consultant (city-only, no licence), `Madison` and `Walker` AGOL items that need a token, a paid Covington subscription site, and the Cloudflare/530 gates below — **no key was harvested or replayed and no bot challenge was bypassed.**
The sandbox reaches only `*.arcgis.com`; every other host was MEASURED through the production relay `planyr.io/gis-proxy` (hosts added to its allow-list in PRs #2348 and #2352) with point queries at 5 spread points inside each county.

**Flagship MapGuide adapter (B2302785).** 26 counties (Bibb, Butler, Chambers, Chilton, Choctaw, Clarke, Clay, Coffee, Conecuh, Covington, Crenshaw, Dale, Escambia, Fayette, Geneva, Lamar, Lowndes, Marengo, Marion, Perry, Pickens, Pike, Randolph, Tallapoosa, Walker, Washington) publish parcels only through Flagship GIS's **Autodesk MapGuide** (`www.alabamagis.com/<County>/` → `fgis-map-<n>.flagshipcloud.com/mapserver<n>`, n ∈ 100/101/102/104/105/106/107/110, read from each county page's `cloudURL`). There is no `/rest/services`. The county's own mobile viewer searches parcels through the MapGuide REST extension (`…/rest/library/<COUNTY>/3_LAYERS/Parcels.LayerDefinition/features.geojson`) with **no key, session or token** — that is the only door used (the blank Pictometry key fields on the landing page, or any key the viewer injects, are never read, harvested or replayed). `functions/mg/[[path]].js` answers `/mg/<server>/<COUNTY>/FeatureServer/0` (+ `/query`) in ArcGIS REST shape, translated by the pure `src/shared/gis/mapguideAdapter.js`, so `countyRecord`, the esri-leaflet outline layer, click-to-select and the ID/address search run unchanged. Native system is Web Mercator; the server returns lon/lat (`transformto=LL84`). The layer has no acreage column, so `GIS_ACRES` is computed from the polygon; it also carries a label Point per lot (deduped by the stable OBJECTID). Uniform schema on all 26: `NAME` (owner), `PARCEL_ID`, `P_ADDRESS`, `MAILING1-3`, `TOTALVALUE`, … Measured through the relay: a lot found by envelope near each county's centre, re-found by point, same lot, id + owner + acreage on all 26. Marengo's `www.alabamagis.com/Marengo/` page 404s but its library is on server 100; Clay (previously recorded as a private AGOL app) is on 107.

| County | Source (host) | Owner field | Notes |
|---|---|---|---|

| County | Source | Owner field | Notes / what was searched |
|---|---|---|---|
| Autauga | **wired** — (republished) services7.arcgis.com ... `PARCELS_REGION_061626_158_WFL1/FeatureServer/0` | yes | 6/2026 merge of the Autauga, Elmore and Montgomery county rolls; a dated 'WFL1' working copy, so the item name can be replaced |
| Baldwin | **wired** — (republished) web6.kcsgis.com ... `Baldwin/AL05_GAMAWeb/MapServer/31` | yes | layer 'Parcels - Owner Displayed' of the county's public web map |
| Barbour | **wired** — (republished) gis.capturecama.com ... `BarbourAL/BarbourCapture/MapServer/213` | **no** (id + acres only) | geometry + parcel id + acres only; owner lives in the CAMA roll, not this layer |
| Bibb | **wired** — (republished) `/mg/106/BIBB/FeatureServer/0` → Flagship MapGuide `fgis-map-106.flagshipcloud.com/mapserver106` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Blount | **wired** — (republished) web5.kcsgis.com ... `Blount/Public/MapServer/32` | yes | measured 2026-10-16, 5 spread points |
| Bullock | **wired** — (republished) gis.capturecama.com ... `BullockAL/BullockCapture/MapServer/3` | yes | measured 2026-10-16, 5 spread points |
| Butler | **wired** — (republished) `/mg/106/BUTLER/FeatureServer/0` → Flagship MapGuide `fgis-map-106.flagshipcloud.com/mapserver106` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Calhoun | **wired** — (republished) gis.calhouncounty.org ... `Parcel_Viewer_IPV/MapServer/106` | yes | layer 'Owner Parcels'; found by walking the county server's /arcgis/rest/services — the viewer's own path (/ArcGIS5) was wrong |
| Chambers | **wired** — (republished) `/mg/105/CHAMBERS/FeatureServer/0` → Flagship MapGuide `fgis-map-105.flagshipcloud.com/mapserver105` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Cherokee | **wired** — (republished) web3.kcsgis.com ... `Cherokee/Public/MapServer/116` | yes | measured 2026-10-16, 5 spread points |
| Chilton | **wired** — (republished) `/mg/104/CHILTON/FeatureServer/0` → Flagship MapGuide `fgis-map-104.flagshipcloud.com/mapserver104` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Choctaw | **wired** — (republished) `/mg/107/CHOCTAW/FeatureServer/0` → Flagship MapGuide `fgis-map-107.flagshipcloud.com/mapserver107` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Clarke | **wired** — (republished) `/mg/107/CLARKE/FeatureServer/0` → Flagship MapGuide `fgis-map-107.flagshipcloud.com/mapserver107` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Clay | **wired** — (republished) `/mg/107/CLAY/FeatureServer/0` → Flagship MapGuide `fgis-map-107.flagshipcloud.com/mapserver107` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Cleburne | **wired** — (republished) maps.capturecama.com ... `Cleburne/CleburneParcels_06122024/MapServer/401` | **no** (id + acres only) | owner column exists but is empty on this layer; date-stamped service folder (06/12/2024) |
| Coffee | **wired** — (republished) `/mg/107/COFFEE/FeatureServer/0` → Flagship MapGuide `fgis-map-107.flagshipcloud.com/mapserver107` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Colbert | **wired** — (republished) al20portal.kcsgis.com ... `al20server/rest/services/Internal/Colbert_Public_ISV/MapServer/43` | yes | found by reading the county viewer's own public `js/config/viewer.js` (not on web3–web6; those Colbert folders are token-secured and were never used); 6/9 grid points hit, owner + id populated |
| Conecuh | **wired** — (republished) `/mg/101/CONECUH/FeatureServer/0` → Flagship MapGuide `fgis-map-101.flagshipcloud.com/mapserver101` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Coosa | **wired** — (republished) maps.capturecama.com ... `Coosa/Coosa11282023/MapServer/169` | **no** (id + acres only) | geometry + parcel id + acres only; date-stamped service folder (11/28/2023) |
| Covington | **wired** — (republished) `/mg/101/COVINGTON/FeatureServer/0` → Flagship MapGuide `fgis-map-101.flagshipcloud.com/mapserver101` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Crenshaw | **wired** — (republished) `/mg/105/CRENSHAW/FeatureServer/0` → Flagship MapGuide `fgis-map-105.flagshipcloud.com/mapserver105` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Cullman | **wired** — (republished) web5.kcsgis.com ... `Cullman/iWorQ/MapServer/3` | yes | measured 2026-10-16 through the relay, 3×3 grid of points: layer 'Parcels' of the county's iWorQ service (found by LISTING the `Cullman` folder — the previously-tried `Cullman/Public` is the stopped one); 7/9 grid points hit, owner + id populated |
| Dale | **wired** — (republished) `/mg/101/DALE/FeatureServer/0` → Flagship MapGuide `fgis-map-101.flagshipcloud.com/mapserver101` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Dallas | **wired** — (republished) maps.capturecama.com ... `Dallas/Dallas_05272026/MapServer/163` | yes | parcel polygon joined to the tax roll (TAXROLL.* fields); date-stamped service folder (05/27/2026). An older AGOL copy (2022) is not used |
| DeKalb | **wired** — (republished) services9.arcgis.com ... `Parcel_Data/FeatureServer/0` | yes | 53,518 polygons, edited 2025-11-26 |
| Elmore | **wired** — (republished) gis.capturecama.com ... `ElmoreAL/ElmoreCapture/MapServer/0` | yes | layer 'Ownership' |
| Escambia | **wired** — (republished) `/mg/110/ESCAMBIA/FeatureServer/0` → Flagship MapGuide `fgis-map-110.flagshipcloud.com/mapserver110` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Etowah | **wired** — (republished) web3.kcsgis.com ... `Etowah/Etowah_Revenue_Viewer_new/MapServer/64` | yes | layer SVW_PARCEL_CAMA |
| Fayette | **wired** — (republished) `/mg/104/FAYETTE/FeatureServer/0` → Flagship MapGuide `fgis-map-104.flagshipcloud.com/mapserver104` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Franklin | **wired** — (republished) web6.kcsgis.com ... `Franklin/Franklin_Public_ISV/MapServer/105` | yes | measured 2026-10-16 through the relay, 3×3 grid of points: layer 'Parcels' of the county's public ISV service (found by LISTING the `Franklin` folder on web6; the stopped `Franklin/Public` was on web5); 9/9 grid points hit, owner + id populated |
| Geneva | **wired** — (republished) `/mg/106/GENEVA/FeatureServer/0` → Flagship MapGuide `fgis-map-106.flagshipcloud.com/mapserver106` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Greene | **wired** — (republished) services8.arcgis.com ... `GreeneAL_Service/FeatureServer/5` | yes | 11,080 polygons, edited 2026-10-15; no situs column |
| Hale | **wired** — (republished) maps.capturecama.com ... `Hale/HALE_11132024/MapServer/921` | **no** (id + acres only) | geometry + parcel id + acres only; date-stamped service folder (11/13/2024) |
| Henry | **wired** — (republished) maps.capturecama.com ... `Henry/Henry05042023/MapServer/0` | yes | date-stamped service folder (05/04/2023) |
| Houston | **wired** — (republished) services.arcgis.com ... `Parcels_County_Current_050323/FeatureServer/0` | yes | 61,825 polygons, last edited 2023-12 — the oldest source wired; county's own server not yet reached |
| Jackson | **wired** — (republished) web3.kcsgis.com ... `Jackson/Public_ISV_Jackson/MapServer/1` | yes | measured 2026-10-16 through the relay, 3×3 grid of points: layer 'Parcels' of the county's public ISV service (the earlier search guessed `Jackson/Public_ISV`; the real name is `Public_ISV_Jackson`, found by listing the folder); 7/9 grid points hit (rest are unmapped land), owner + id populated; id = PRODNO |
| Jefferson | **wired** — (republished) jccgis.jccal.org ... `Basemap/Parcels/MapServer/0` | yes | the very layer the county's own 'Parcel Look-up' web app queries |
| Lamar | **wired** — (republished) `/mg/102/LAMAR/FeatureServer/0` → Flagship MapGuide `fgis-map-102.flagshipcloud.com/mapserver102` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Lauderdale | **wired** — (republished) web5.kcsgis.com ... `Lauderdale/Public/MapServer/120` | yes | measured 2026-10-16, 5 spread points |
| Lawrence | **wired** — (republished) web4.kcsgis.com ... `Lawrence/Public/MapServer/49` | yes | measured 2026-10-16, 5 spread points |
| Lee | **wired** — (republished) explore.opelika-al.gov ... `Lee_County_Parcels/MapServer/0` | **no** (id + acres only) | parcel polygons + id + acres only (no owner column); countywide extent, 5/5 spread points |
| Limestone | **wired** — (republished) gis.limestonecounty-al.gov ... `Limestone_Parcels/MapServer/0` | yes | measured 2026-10-16, 5 spread points |
| Lowndes | **wired** — (republished) `/mg/104/LOWNDES/FeatureServer/0` → Flagship MapGuide `fgis-map-104.flagshipcloud.com/mapserver104` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Macon | **wired** — (republished) gis.capturecama.com ... `MaconAL/MaconCapture/MapServer/1` | **no** (id + acres only) | geometry + parcel id + acres only |
| Madison | **wired** — (republished) maps.madisonal.gov ... `Development_Dashboard_Base_MIL1/MapServer/1` | yes | layer MadisonCountyParcels, 206,348 polygons |
| Marengo | **wired** — (republished) `/mg/100/MARENGO/FeatureServer/0` → Flagship MapGuide `fgis-map-100.flagshipcloud.com/mapserver100` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Marion | **wired** — (republished) `/mg/104/MARION/FeatureServer/0` → Flagship MapGuide `fgis-map-104.flagshipcloud.com/mapserver104` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Marshall | **wired** — (republished) web5.kcsgis.com ... `Marshall/Public/MapServer/37` | yes | measured 2026-10-16, 5 spread points |
| Mobile | **wired** — (republished) services8.arcgis.com ... `MCRC_Public_Parcels/FeatureServer/0` | yes | 214,040 polygons, updated 2026-09; strings are space-padded |
| Monroe | **wired** — (republished) maps.capturecama.com ... `Monroe/Monroe12092025/MapServer/84` | **no** (id + acres only) | geometry + parcel id + acres only; date-stamped service folder (12/09/2025) |
| Montgomery | **wired** — (republished) services7.arcgis.com ... `PARCELS_REGION_061626_158_WFL1/FeatureServer/0` | yes | 105,222 Montgomery rows (+5 with the county misspelled, hence LIKE) |
| Morgan | **wired** — (republished) al52portal.kcsgis.com ... `Mapping/Morgan_Public_ISV/MapServer/132` | yes | layer from the county's own public web map |
| Perry | **wired** — (republished) `/mg/105/PERRY/FeatureServer/0` → Flagship MapGuide `fgis-map-105.flagshipcloud.com/mapserver105` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Pickens | **wired** — (republished) `/mg/105/PICKENS/FeatureServer/0` → Flagship MapGuide `fgis-map-105.flagshipcloud.com/mapserver105` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Pike | **wired** — (republished) `/mg/100/PIKE/FeatureServer/0` → Flagship MapGuide `fgis-map-100.flagshipcloud.com/mapserver100` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Randolph | **wired** — (republished) `/mg/102/RANDOLPH/FeatureServer/0` → Flagship MapGuide `fgis-map-102.flagshipcloud.com/mapserver102` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Russell | **wired** — (republished) maps.capturecama.com ... `Russell/Russell_02122026/MapServer/133` | **no** (id + acres only) | geometry + parcel id + acres only; date-stamped service folder (02/12/2026) |
| Shelby | **wired** — (republished) maps.shelbyal.com ... `CaptureServices/PropertyTaxOfficeBase/MapServer/93` | yes | layer C_PARCEL = parcel polygon joined to the DOR roll (dbo.DOR_Parcel.*) |
| St. Clair | **wired** — (republished) map.stclairco.com ... `PublicParcelViewerStPln/MapServer/57` | yes | layer 'Owner Parcels' |
| Sumter | **wired** — (republished) maps.capturecama.com ... `Sumter/Sumter03282024/MapServer/2` | **no** (id + acres only) | owner/acre columns are blank on this layer; date-stamped service folder (03/28/2024) |
| Talladega | **wired** — (republished) web6.kcsgis.com ... `Talladega/Talladega_TylerTech/MapServer/1` | yes | measured 2026-10-16 through the relay, 3×3 grid of points: layer 'Parcels' of the county's Tyler Tech roll service; 6/9 grid points hit, owner + id populated |
| Tallapoosa | **wired** — (republished) `/mg/100/TALLAPOOSA/FeatureServer/0` → Flagship MapGuide `fgis-map-100.flagshipcloud.com/mapserver100` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Tuscaloosa | **wired** — (republished) services.arcgis.com ... `Parcels/FeatureServer/0` | yes | 111,770 polygons, edited 2026-10 |
| Walker | **wired** — (republished) `/mg/102/WALKER/FeatureServer/0` → Flagship MapGuide `fgis-map-102.flagshipcloud.com/mapserver102` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Washington | **wired** — (republished) `/mg/106/WASHINGTON/FeatureServer/0` → Flagship MapGuide `fgis-map-106.flagshipcloud.com/mapserver106` | yes | the county's own public-viewer search endpoint, anonymous; ArcGIS-REST adapter (see "Flagship MapGuide adapter" below); acreage computed from the polygon (`GIS_ACRES`) |
| Wilcox | **wired** — (republished) maps.capturecama.com ... `Wilcox/Wilcox_03122025/MapServer/10` | **no** (id + acres only) | owner/acre columns are blank on this layer; date-stamped service folder (03/12/2025) |
| Winston | **wired** — (republished) web3.kcsgis.com ... `Winston/Winston_Public_ISV/MapServer/141` | yes | measured 2026-10-16 through the relay, 3×3 grid of points: layer 'Parcels' of the county's public ISV service; 9/9 grid points hit, owner + id populated |

**Totals:** 35 wired — owner name on 25; parcel id + acreage only on 10 (Barbour, Cleburne, Coosa, Hale, Lee, Macon, Monroe, Russell, Sumter, Wilcox — their layers are geometry-only or carry blank owner columns) — and 32 named gaps: 25 Flagship/MapGuide (B2302785), 1 private ArcGIS Online app (Clay), 4 KCS viewers whose service could not be located (Colbert, Jackson, Talladega, Winston), 2 stopped KCS services (Cullman, Franklin).
**Bigger-than-one-session item, flagged loudly:** the 25 Flagship counties are the biggest remaining block and need a MapGuide adapter, filed as **B2302785**.
**Dated service folders:** Capture CAMA names its services by upload date (`Dallas_05272026`, `Russell_02122026`…). A county that uploads a new folder leaves the old one up, so a row keeps working but ages; `B2302784`'s provenance rows name the date of every such folder.


## Louisiana parishes (2026-10-19)

NEW-1 (owner: "start wiring all the remaining states into Planner"). Louisiana-only session; **38 of 64 parishes are now wired (4 new), 26 are named gaps with a recorded, re-searched reason**. Rows live in `src/workspaces/site-planner/lib/laParcels.js` (provenance prose `laProvenance.js`), plugged into `counties.js` with one import + two spreads. **No `/gis-proxy` allow-list change was needed** — all four new sources are `*.arcgis.com`, CORS-open (`access-control-allow-origin: *` re-checked 2026-10-19). Guard: `test/louisianaParishes2.test.js` (red on the commit before: 12 failures) on top of the existing per-key suite in `test/louisianaParishes.test.js`.

**Instrument, so nobody repeats my traps.** The sandbox reaches only `*.arcgis.com` and planyr.io (every parish/vendor host is a CONNECT 403 or `ENOTFOUND`, WebFetch included; the production `/gis-proxy` answers `host not allowed` for any host not already deployed). Coverage was measured against the REAL parish outline — the public `Louisiana_Parishes` polygon (`services1.arcgis.com/Brg1qbmzmFn7JtpX/.../Louisiana_Parishes/FeatureServer/0`), a point grid kept only where it falls inside the polygon — not against the layer's own extent (a layer's extent is where its data is, so a grid built on it cannot see a hole), and the spread points were never taken from the layer's own features (a sampled feature always finds itself). **That instrument reversed one earlier rejection (Ouachita) — see below.**

### Wired this session — 4 parishes (38 of 64)

| Parish | Key | Parcels | Source (class) | Edited | Id column | Owner? | Situs? |
|---|---|---|---|---|---|---|---|
| Claiborne | `la_claiborne` | 19,493 | **1803 Electric Co-Op** AGOL copy of the parish assessor roll (`ParcelsClaiborne1803`, services7 org `rxjYSJmWllCcGWDd`, individual account) — third-party republication | 2025-12-02 | `parcelnumb` (pinned) | **yes** (`owner_name`; mailing `owner_addr`) | no |
| Richland | `la_richland` | 18,780 | same org, `ParcelsRichland1803` | 2025-12-02 | `parcel_id` (pinned) | **yes** (`ownername`; mailing `owneraddre`) | no |
| West Carroll | `la_westcarroll` | 7,016 | same org, `ParcelsWestCarroll1803` | 2025-12-02 | `PARCEL_ID` (pinned) | **yes** (`OWNER`; mailing `MAIL_ADDRE`) | no |
| Ouachita | `la_ouachita` | 92,073 | **City of Monroe GIS** (AGOL `Kyle.Knous@ci.monroe.la.us`, `Public_Parcels`) — municipal GIS publishing the whole parish fabric | 2026-02-09 | `Parcel_ID` (pinned) | **no** (fields are `Parcel_ID` + `RPID` only) | no |

**Measurements (live, 2026-10-19).** In-parish outline grid: Claiborne 124/126 · Richland 65/65 · West Carroll 81/82 · Ouachita 99/100. Seat checks: Homer 1 km box = 581 parcels (no city hole), Rayville / Oak Grove / Monroe + West Monroe answered. Every spread and near-parish-line point is listed per parish in `laProvenance.js` (e.g. Claiborne −93.1359,32.6714 → `0400045175` "SANDERS, PEGGY JO PAIR"; Richland −91.9143,32.2546 → `0500223500` "WOOTEN PROPERTIES, INC."; West Carroll −91.3918,32.8590 → `0410423150` "BRADLEY JOSHUA C ET UX"; Ouachita −92.3131,32.3516 → `33452`); all returned polygons lie inside Louisiana.

**⛔ Vintage — an edit date is not a roll date (measured, and it rejected a layer).** The co-op re-published four Louisiana parishes in one batch, so I tested currency instead of trusting `Edited`: **Lincoln (`ParcelsLincoln1803`, 25,166, edited 2026-01-07) carries `TRANSFER_D` and its newest transfer is 2019 — a stale roll behind a fresh edit date → REJECTED, not wired.** For the three wired, compared with older copies of the same parish: Richland — 10 of 150 parcels carry a different owner than the 2021-04 copy; Claiborne — 25 of 131 differ from the 2020-06 copy, 41 have a different deed number (newer instrument numbers than the old copy's maximum) and 19 are new. So both are demonstrably newer than the old copies, **but neither layer states its own roll date**; their help text says "owner names current to its pull, not to today". **West Carroll has no older copy and no date column, so its currency is the edit date only — unverifiable, flagged on the row** (owner decision requested in the PR: keep or drop).

**⛔ Ouachita correction.** The 2026-09-30 table rejected this exact layer ("4 of 53 in-parish probe points answered — a partial fabric"). Re-measured against the real parish outline: **99 of 100** points answer, with rural, near-line and both Monroe/West Monroe points hitting. The earlier probe set was evidently not a proper in-parish grid. It stays attribute-light on purpose — boundary + parcel id, wired on the Virginia/Hawaii precedent; 1,445 parcels carry the placeholder id `888888` and 193 carry `999999` (1.8%).

### The 26 parishes still named gaps — source and what was searched

All 26 say "`<Parish> Parish — no parcel data wired here yet.`" (guarded by name in the test). Searches this session, in addition to the 2026-09-30 and 2026-10-05/06 routes: an ArcGIS Online item search with the Louisiana bbox (10 wordings × Feature/Map Service, 3,467 items, 307 parcel-ish with a Louisiana-bounded extent), a per-parish-name search for all 30 across Web Map / Web Mapping Application / Feature Service / Map Service / Hub Site, a walk of the operational layers of the parishes' public web maps, and a directory walk of the three orgs that surfaced (`rxjYSJmWllCcGWDd`, `fe3XWHMASK948q2c`, `eR5n9maFLflJFdXU`). Same-name traps seen: **`MADISON_PARCELS` and the Claiborne/Mississippi `PARCELS_20xx` layers are Madison / Claiborne COUNTY, MISSISSIPPI** (extents lng −90.45 / −91.24) — not Louisiana.

| Parish | Where the data actually is | Why not wired |
|---|---|---|
| Beauregard · Caldwell · Concordia · East Carroll · Jackson* · Morehouse · Red River* · Sabine* · Union | actDataScout (`onemap.actdatascout.com`) login/token — proprietary, never scraped | *No public REST. \*Land-company working copies exist and fail the bar: Jackson `JacksonParcels` 12,429 (edited 2019, geometry-only), Red River `RedRiver(Parcels)(2018)` 10,111 (edited 2021-05), Sabine `Sabine(Parcels)(2009)` 35,504 (edited 2021-05).* |
| Bienville | actDataScout; AGOL `Bienville(Parcels)(2018)` (18,032, 99% coverage, owners) | Outside the 5-year bar (2018 vintage, edited 2021); the same org's `ParcelsBienvilleBrookston` is fresh (2025-08) but only 4,238 parcels — a partial. |
| Rapides · Evangeline | actDataScout; `gissrv1.romlc.net` LA_Assessors/0 (Rapides) and ES2 `Evangeline_Parish_Parcels_(Public_View)` | `Token Required` (re-measured 2026-10-19 on the ES2 layer). Land-co "Portion" copies are 1,983 / 7,800 parcels edited 2020 — partial and stale. |
| Grant · Lincoln · Avoyelles | `gissrv1.romlc.net` LA_Assessors/9, /4, /2 | `Token Required`. Lincoln's fresh-dated co-op layer is a 2019 roll (see above). |
| Catahoula · Vernon | `www.efsedge.com` | Every REST call redirects to a login page (2026-10-05). |
| Winn | `localgreenstone.com` (MapGuide behind a login session — not the Flagship/anonymous kind the `/mg` adapter reads) | Login-gated. |
| Iberia | `gis.iberiagov.net/server/rest/services/Parcels/` — newest published is **AssessoFeb2021** (5.7 yr), then AssessorFeb2019; parish GIS hub `gis-ipg.hub.arcgis.com`; a newer host `maps.iberiagov.net` carries aerials/flood/E911 only | Outside the bar, and neither host is reachable from the sandbox or the production relay (`host not allowed`); Atlas (`services.geoportalmaps.com` Iberia_Parcels_DB) is 404. None of the 40+ web maps the parish publishes references a newer parcel layer. |
| LaSalle · Pointe Coupee | Atlas / GeoPortal Maps behind its own `proxy.ashx` to a private host (Pointe Coupee: `atlas.geoportalmaps.com/ptcoupee`) | Not a public API. A 2017 Boundary Solutions dataset is catalogued but restricted. |
| Vermilion | ES2 `Parish_Parcels__All_`, geoid 22113 (Regrid-schema copy) | **Re-measured: the Abbeville city-hole is still there** (−92.1343,29.9747 → no parcel; 81% in-parish grid). Rejected stands. |
| Franklin · Madison · St. Helena · Tensas | Franklin: assessor property search `franklin.smartcama.com` (no map found). Madison: an ArcGIS viewer is reported but its host was not identified. St. Helena, Tensas: no viewer found | Nothing queryable located by any route; these four remain the only ones worth another pass (look at the assessor sites' network calls from a browser with open egress). |

Count: 34 + 4 wired = 38; the table names **26** gaps — Beauregard, Bienville, Caldwell, Concordia, East Carroll, Jackson, Morehouse, Red River, Sabine, Union, Rapides, Evangeline, Grant, Lincoln, Avoyelles, Catahoula, Vernon, Winn, Iberia, LaSalle, Pointe Coupee, Vermilion, Franklin, Madison, St. Helena, Tensas — and 38 + 26 = 64.

## Michigan counties (2026-10-19/20) — 54 of 83 wired (NEW-1, B2366656)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* / *"send the rest"* — this section is Michigan only (sibling sessions took the other states). **Michigan has no free statewide parcel service:** the State's DTMB says outright that its statewide parcel layer inside the Michigan Geographic Framework is internal-only and not on the Open Data portal, and the assessing unit is the township / city, so countywide layers come from each county's equalization / GIS / drain office. The 2026-09-09 probe row ("none found") was run from an egress-limited sandbox before pass 2 and before the relay existed, and is superseded.

**How it was searched (every county).** (1) Statewide / multi-county: DTMB, the NSGIC portal, ArcGIS Hub, regional bodies (SEMCOG, Western U.P. Planning, EUP Regional Planning, NEMCOG, Tri-County, MSU RS&GIS) — nothing statewide; the "Parcels - MI -" index a federal-contractor org (GDITAdmin) keeps on ArcGIS Online listed 33 counties, ~half of whose services have since been deleted. (2) ArcGIS Online: ~5,400 Michigan-extent items crawled, every polygon layer probed, then per-county name searches, then per-org (orgid-wide) parcel/tax/property searches for ~45 county orgs found by sub-domain guessing and by the owner accounts of county layers. (3) The State's own county tax-parcel directory (michigan.gov/dtmb … /tax-parcels) read through the relay, every county landing page crawled through the relay, and each county's official viewer chased to the service URLs its web app actually reads (that is how Antrim, Cheboygan, Lenawee, Manistee, Montcalm, Osceola, Ionia and Lake were confirmed to be the county's own layer). (4) Vendors: Colligo, Schneider Beacon, BS&A Online, MangoMap and FetchGIS looked at directly. The sandbox reaches only `*.arcgis.com`; every other host was MEASURED through the production-shaped relay (`/gis-proxy`, on this PR's Cloudflare preview). Each wired row returned polygons carrying its parcel id at 5 spread interior points plus 4 points beside its county lines, and its returned extent sits inside Michigan.

**Findings worth knowing.**
- **46 of the 52 new rows read `*.arcgis.com` directly** (no relay); six ride the relay: Kent, Ottawa, Jackson, Grand Traverse, St. Clair (Geocortex; one layer per tax year — layer 17 is Tax Year 2026, re-point each January) and Monroe (`gis.mocogeo.org`).
- **Third-party copies** (18 counties; the provenance record says so per row): Benzie, Berrien, Branch, Clinton, Gladwin, Gratiot, Hillsdale, Huron, Isabella, Lapeer, Mackinac, Marquette, Mecosta, Muskegon, Sanilac, Shiawassee, St. Joseph, Van Buren — the only open copy found, published by a consultant, a regional commission or an individual account. Isabella and Mecosta share ONE 16-county HDR compile (`Copperton_Projects_Parcels`), each row scoped by `county_name`.
- **Wayne County is a 2018 file.** The newest open layer in Wayne's org is the "Wayne County Parcel Shape File" (edited 2018-08; the org's other parcel layer is 2017). Detroit keeps its own newer city layer inside its limits. Disclosed in the row's provenance record.
- **Midland** gives the lot and its number only (the countywide fabric's owner/address columns are empty on every sampled parcel); its other layer with owners covers the townships only.
- **FetchGIS (Amalgam LLC) is the biggest single unlock and an OWNER DECISION.** About 25 Michigan counties' official viewers are FetchGIS (`app.fetchgis.com/?currentMap=<county>`). Its ArcGIS Server (`app.fetchgis.com/geoservices/fgis/<xxx>Parcels/FeatureServer/0`, read from the viewer's own `main.js`) answers a plain non-browser request with an HTTP 520 reset through the relay while the viewer page itself loads. Making it work would mean replaying the viewer's browser identity, which Planyr does not do (the same rule as the Missouri Integrity-token counties), and the vendor describes some counties' public map as "limited information, more for a fee". A data agreement with Amalgam would cover Calhoun, Delta and Otsego outright (and give a first-party source for the counties wired above from third-party copies). Filed as B2366657.
- **Colligo GIS (7 counties)** is a hosted app behind a sign-in; **Schneider Beacon (5)** and **BS&A Online (9)** publish no parcel-query service. None worked around.

### Wired (54 = 52 new rows + the hand-wired Oakland and Macomb; Detroit stays city-scoped)

| County | Source | Parcel-id field | Owner | Address | Measured (hits / points · beside line) |
|---|---|---|---|---|---|
| Allegan County | county-published — services7.arcgis.com | `MAPPING_ID` | yes | — | 6/9 · 1/4 |
| Antrim County | county-published — services6.arcgis.com | `PARCEL_NO` | yes | — | 7/9 · 2/4 |
| Arenac County | county-published — services8.arcgis.com | `PID` | yes | `PROPERTY_A` | 8/9 · 3/4 |
| Barry County | county-published — services.arcgis.com | `Tparcel` | no | — | 9/9 · 4/4 |
| Bay County | county-published — services7.arcgis.com | `PARCELID` | yes | — | 9/9 · 4/4 |
| Benzie County | third-party — services5.arcgis.com | `PNUM` | yes | `PROPSTREET` | 8/9 · 4/4 |
| Berrien County | third-party — services5.arcgis.com | `PIN` | yes | `Full_Address` | 7/9 · 2/4 |
| Branch County | third-party — services9.arcgis.com | `PARCELID` | yes | `ADDRESS` | 8/9 · 4/4 |
| Cass County | county-published — services3.arcgis.com | `Parcel_Num` | yes | `Physical` | 7/9 · 2/4 |
| Charlevoix County | county-published — services9.arcgis.com | `PIN` | yes | — | 9/9 · 4/4 |
| Cheboygan County | county-published — services6.arcgis.com | `PARCEL_NO` | yes | — | 8/9 · 3/4 |
| Clinton County | third-party — services5.arcgis.com | `PARCEL_NUM` | yes | — | 8/9 · 3/4 |
| Eaton County | county-published — services2.arcgis.com | `LPARCEL` | yes | `SITEADDRESS` | 9/9 · 4/4 |
| Emmet County | county-published — services8.arcgis.com | `PID` | yes | `PAR_ADDR` | 7/9 · 2/4 |
| Genesee County | county-published — services2.arcgis.com | `ParcelID` | yes | — | 9/9 · 4/4 |
| Gladwin County | third-party — services.arcgis.com | `ParcelNumb` | yes | `PropertyAd` | 8/9 · 3/4 |
| Grand Traverse County | county-published — gis.gtcountymi.gov (via relay) | `PARCELID` | yes | `SITEADDRESS` | 9/9 · 4/4 |
| Gratiot County | third-party — services.arcgis.com | `PID` | no | — | 9/9 · 4/4 |
| Hillsdale County | third-party — services.arcgis.com | `Parcel_No` | yes | — | 8/9 · 3/4 |
| Huron County | third-party — services5.arcgis.com | `PIN` | yes | — | 9/9 · 4/4 |
| Ingham County | county-published — services3.arcgis.com | `PARCELNUM` | yes | — | 8/9 · 3/4 |
| Ionia County | county-published — services9.arcgis.com | `CountyParcels_PIN` | yes | `PROPERTYFULLADDR` | 8/9 · 3/4 |
| Isabella County | third-party — services.arcgis.com | `parcel_id` | yes | `address` | 9/9 · 4/4 |
| Jackson County | county-published — gis.mijackson.org (via relay) | `PIN` | yes | `P_FULLADD` | 8/9 · 3/4 |
| Kalamazoo County | county-published — services3.arcgis.com | `PELNUMBER` | yes | `PCOMBINED` | 8/9 · 3/4 |
| Kent County | county-published — gis.kentcountymi.gov (via relay) | `PNUM` | yes | `PROPERTYADDRESS` | 9/9 · 4/4 |
| Lake County | county-published — services6.arcgis.com | `PARCELID` | yes | `PROPADDRESS` | 9/9 · 4/4 |
| Lapeer County | third-party — services8.arcgis.com | `PID` | yes | `Address` | 9/9 · 4/4 |
| Leelanau County | county-published — services.arcgis.com | `PARCEL` | yes | `SITE_ADD` | 6/9 · 2/4 |
| Lenawee County | county-published — services6.arcgis.com | `TAXID` | yes | `PRADDCOMB` | 9/9 · 4/4 |
| Mackinac County | third-party — services7.arcgis.com | `TaxPIN` | no | — | 8/9 · 3/4 |
| Macomb County | personal AGOL copy (hand-wired 2026-09-15); the county's own host `gis.macombgov.org` (`FLEX2/Parcel_Layers/MapServer/4`, 332,879 parcels, 8/9 · 4/4 measured 2026-10-20) is a verified like-for-like alternative if the personal account ever vanishes | `TAX_ID` | yes | `ADDRESS` | (earlier session) |
| Manistee County | county-published — services5.arcgis.com | `BSA_PIN` | yes | `propstreet` | 9/9 · 4/4 |
| Marquette County | third-party — services.arcgis.com | `PARCEL_ID` | yes | — | 9/9 · 4/4 |
| Mason County | county-published — services6.arcgis.com | `Parcel` | yes | — | 8/9 · 4/4 |
| Mecosta County | third-party — services.arcgis.com | `parcel_id` | yes | `address` | 9/9 · 4/4 |
| Midland County | county-published — services6.arcgis.com | `Name` | no | — | 9/9 · 4/4 |
| Monroe County | county-published — gis.mocogeo.org (via relay) | `parcelid` | yes | `parcelmaster_propstreetcombined` | 7/9 · 2/4 |
| Montcalm County | county-published — services6.arcgis.com | `TaxParcel_PARCELID` | yes | `BSAEXPORT_PCOMBINED` | 9/9 · 4/4 |
| Muskegon County | third-party — services3.arcgis.com | `PIN` | no | `Address` | 9/9 · 4/4 |
| Newaygo County | county-published — services6.arcgis.com | `PIN` | yes | — | 9/9 · 4/4 |
| Oakland County | county GIS (hand-wired 2026-09-10) | `PIN` | yes | `SITESTREETADDRESS` | (earlier session) |
| Oceana County | county-published — services8.arcgis.com | `PIN` | no | — | 9/9 · 4/4 |
| Osceola County | county-published — services8.arcgis.com | `PIN` | yes | `PROPADD` | 8/9 · 3/4 |
| Ottawa County | county-published — gis.miottawa.org (via relay) | `FinalPIN` | yes | — | 9/9 · 4/4 |
| Roscommon County | county-published — services3.arcgis.com | `PIN` | yes | `Property_A` | 8/9 · 4/4 |
| Saginaw County | county-published — services3.arcgis.com | `PIN` | yes | — | 9/9 · 4/4 |
| Sanilac County | third-party — services7.arcgis.com | `PIN` | no | — | 9/9 · 4/4 |
| Shiawassee County | third-party — services7.arcgis.com | `Parcel_Num` | yes | `PROPERTY_A` | 9/9 · 4/4 |
| St. Clair County | county-published — maps.stclaircounty.org (via relay) | `PARCEL_NUMBER` | yes | `PROP_ADDRESS_COMBINED` | 9/9 · 4/4 |
| St. Joseph County | third-party — services5.arcgis.com | `Tax_ID` | yes | `PCOMBINED` | 9/9 · 4/4 |
| Tuscola County | county-published — services6.arcgis.com | `PIN` | yes | — | 8/9 · 3/4 |
| Van Buren County | third-party — services3.arcgis.com | `PARCEL_NO` | yes | `ADDRESSALL` | 8/9 · 3/4 |
| Wayne County | county-published — services1.arcgis.com | `packedParc` | yes | — | 6/9 · 3/4 |

### Not wired (29) — each carries a recorded reason from the re-search

| County | Kind | Reason |
|---|---|---|
| Alcona County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Alger County | none-found | The county publishes no parcel viewer: its site offers a 'GIS Data Request' form and a records-search page (no map link), and the State's tax-parcel directory page for Alger returns not-found. No ArcGIS Online org or open server for Alger County exists in any search (sub-domain guesses, county-name item search, orgid-wide search). |
| Alpena County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Baraga County | login-required | The county's parcel viewer (the link the State's county tax-parcel directory gives) is a Colligo GIS site (colligogis.com/desktop/#…) — a vendor-hosted app that opens through a Colligo sign-in (its page ships a password-reset form) and publishes no ArcGIS REST / OGC parcel service Planyr can call; no ArcGIS Online org of the county holds a parcel layer. Not worked around. |
| Calhoun County | no-api | The county's parcel viewer is FetchGIS (Amalgam LLC, app.fetchgis.com/?currentMap=…). Its ArcGIS Server (app.fetchgis.com/geoservices/fgis/<x>Parcels/FeatureServer/0, read from the viewer's own main.js) answers a plain non-browser request with an HTTP 520 connection reset through the relay (and the county's own ArcGIS Server, gis.calhouncountymi.gov, answers 401 'Access is denied due to invalid credentials') although the viewer page itself loads; using it would mean replaying the viewer's browser identity, which Planyr does not do (same rule as the Integrity-GIS token sites in Missouri). A data agreement with Amalgam LLC would unlock about 25 Michigan counties at once — owner decision. |
| Chippewa County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Clare County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Crawford County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Delta County | no-api | The county's parcel viewer is FetchGIS (Amalgam LLC, app.fetchgis.com/?currentMap=…). Its ArcGIS Server (app.fetchgis.com/geoservices/fgis/<x>Parcels/FeatureServer/0, read from the viewer's own main.js) answers a plain non-browser request with an HTTP 520 connection reset through the relay although the viewer page itself loads; using it would mean replaying the viewer's browser identity, which Planyr does not do (same rule as the Integrity-GIS token sites in Missouri). A data agreement with Amalgam LLC would unlock about 25 Michigan counties at once — owner decision. |
| Dickinson County | login-required | The county's parcel viewer (the link the State's county tax-parcel directory gives) is a Colligo GIS site (colligogis.com/desktop/#…) — a vendor-hosted app that opens through a Colligo sign-in (its page ships a password-reset form) and publishes no ArcGIS REST / OGC parcel service Planyr can call; no ArcGIS Online org of the county holds a parcel layer. Not worked around. |
| Gogebic County | login-required | The county's parcel viewer (the link the State's county tax-parcel directory gives) is a Colligo GIS site (colligogis.com/desktop/#…) — a vendor-hosted app that opens through a Colligo sign-in (its page ships a password-reset form) and publishes no ArcGIS REST / OGC parcel service Planyr can call; no ArcGIS Online org of the county holds a parcel layer. Not worked around. |
| Houghton County | no-api | The county's parcel viewer is a Schneider Beacon site (beacon.schneidercorp.com/Application.aspx?App=…), a server-rendered viewer with no public parcel-query service Planyr can call, and no ArcGIS Online org of the county holds a parcel layer (the county's page and the State's tax-parcel directory both point only at Beacon). |
| Iosco County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Iron County | none-found | The county's viewer is a MangoMap site (mangomap.com/jimwaisanen/maps), which the Western U.P. Planning Region's GIS page itself labels 'Iron County Parcel Viewer (Partial Coverage)' and says WUPPDR 'does not have access to parcel data for some counties' (data-ownership issues); the ArcGIS Online parcel service the county published (listed in the GDIT 'Parcels - MI -' index) has been deleted (URL answers 'Invalid URL'). No countywide open service found. |
| Kalkaska County | login-required | The county's parcel viewer (the link the State's county tax-parcel directory gives) is a Colligo GIS site (colligogis.com/desktop/#…) — a vendor-hosted app that opens through a Colligo sign-in (its page ships a password-reset form) and publishes no ArcGIS REST / OGC parcel service Planyr can call; no ArcGIS Online org of the county holds a parcel layer. Not worked around. |
| Keweenaw County | login-required | The county's parcel viewer (the link the State's county tax-parcel directory gives) is a Colligo GIS site (colligogis.com/desktop/#…) — a vendor-hosted app that opens through a Colligo sign-in (its page ships a password-reset form) and publishes no ArcGIS REST / OGC parcel service Planyr can call; no ArcGIS Online org of the county holds a parcel layer. Not worked around. |
| Livingston County | login-required | The county's Parcel Viewer web apps (livgov.maps.arcgis.com) read parcels through a secured proxy (utility.arcgis.com/usrsvcs/servers/eb4804bd…/AGO/Parcels/MapServer) that answers 'You do not have permissions' without the app's own credentials. The only open layer found (Livingston_County_Parcels, published from the Genesee County Drain Commissioner's org) holds 12,944 parcels — a district subset, not the countywide fabric — so it is not wired. |
| Luce County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Menominee County | none-found | The county's 'Land Information Services (GIS)' department page lists no map link, the State's tax-parcel directory gives only the department page, and the ArcGIS Online parcel service the county published (menominee_parcels_New_050120, listed in the GDIT 'Parcels - MI -' index) has been deleted — its URL answers 'Invalid URL'. No other open service found. |
| Missaukee County | no-api | The county's parcel viewer is a Schneider Beacon site (beacon.schneidercorp.com/Application.aspx?App=MissaukeeCountyMI), a server-rendered viewer with no public parcel-query service Planyr can call. The ArcGIS Online parcel service the county once published (MissaukeeParcels, listed in the GDIT 'Parcels - MI -' index) has been deleted — its URL answers 'Invalid URL'. |
| Montmorency County | no-api | The county's parcel viewer is a Schneider Beacon site (beacon.schneidercorp.com/Application.aspx?App=…), a server-rendered viewer with no public parcel-query service Planyr can call, and no ArcGIS Online org of the county holds a parcel layer (the county's page and the State's tax-parcel directory both point only at Beacon). |
| Ogemaw County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Ontonagon County | login-required | The county's parcel viewer (the link the State's county tax-parcel directory gives) is a Colligo GIS site (colligogis.com/desktop/#…) — a vendor-hosted app that opens through a Colligo sign-in (its page ships a password-reset form) and publishes no ArcGIS REST / OGC parcel service Planyr can call; no ArcGIS Online org of the county holds a parcel layer. Not worked around. |
| Oscoda County | none-found | The county's Equalization 'GIS & Mapping' page (oscodacountymi.com/equalization/gis-mapping, the link the State's directory gives) carries no map or service link, and no ArcGIS Online org or open server for Oscoda County turned up in any search (sub-domain guesses, county-name item search, orgid-wide search). |
| Otsego County | no-api | The county's parcel viewer is FetchGIS (Amalgam LLC, app.fetchgis.com/?currentMap=…). Its ArcGIS Server (app.fetchgis.com/geoservices/fgis/<x>Parcels/FeatureServer/0, read from the viewer's own main.js) answers a plain non-browser request with an HTTP 520 connection reset through the relay although the viewer page itself loads; using it would mean replaying the viewer's browser identity, which Planyr does not do (same rule as the Integrity-GIS token sites in Missouri). A data agreement with Amalgam LLC would unlock about 25 Michigan counties at once — owner decision. |
| Presque Isle County | no-api | The county's parcel viewer is a Schneider Beacon site (beacon.schneidercorp.com/Application.aspx?App=…), a server-rendered viewer with no public parcel-query service Planyr can call, and no ArcGIS Online org of the county holds a parcel layer (the county's page and the State's tax-parcel directory both point only at Beacon). |
| Schoolcraft County | no-api | The county's entry in the State's tax-parcel directory is BS&A Online (bsaonline.com/?uid=…) — a property-record search with no map layer and no geometry service — and no county ArcGIS Online org or open ArcGIS Server was found; the only parcel-shaped ArcGIS Online layers that reach the county are the State DNR's state-land parcels (not private lots) and project layers for a single city. |
| Washtenaw County | no-api | The county publishes its parcels as a downloadable file (a ShareFile link behind the 'Parcels' item on data-washtenaw.opendata.arcgis.com) and runs its parcel map services behind secured utility.arcgis.com proxies (HTTP 403 'no permissions' without the county's credentials; the MapWashtenaw viewer is gisappsecure.ewashtenaw.org). The open ArcGIS Online copies found are an EMU class project with no parcel id and a 27,347-parcel solar-study subset, neither countywide. A bulk-file import is not a point-query source. |
| Wexford County | no-api | The county's parcel viewer is a Schneider Beacon site (beacon.schneidercorp.com/Application.aspx?App=…), a server-rendered viewer with no public parcel-query service Planyr can call, and no ArcGIS Online org of the county holds a parcel layer (the county's page and the State's tax-parcel directory both point only at Beacon). |

Test: `test/michiganCounties.test.js` (+ `test/fixtures/miCounties.json`, `miSamples.json`; roster from `scripts/gen-mi-county-fixture.mjs`) — 949 assertions, 111 red on the pre-change `counties.js`.

## Missouri counties (2026-10-19) — 73 of 115 wired (B2317680)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* — this section is Missouri only (sibling sessions took the other states). **Missouri has no free statewide parcel service:** the state GIS office's only parcel layer, `gis.mo.gov/.../FMDCrealEstate_StateOwnedParcels`, is the state's OWN land (a "statewide all parcels" copy a catalog lists no longer exists — 404, re-checked 2026-10-19); MSDIS, the AGOL orgs, ArcGIS Hub and the NSGIC portal were searched. The 2026-09-09 probe row for Missouri ("no-free-source / none found") was run from an egress-limited sandbox before pass 2 and before the relay existed — its *statewide* finding stands, its "none found" for the counties does not.
Routes tried for every county: (1) statewide / multi-county — state GIS, MSDIS, regional planning commissions (SEMO RPC, Mid-Missouri RPC), AGOL org + title + extent search (crawled ~1,400 Missouri-extent items), ArcGIS Hub, the "Parcels - MO - <County>" index a federal-contractor org keeps on AGOL; (2) the county's own assessor / GIS host; (3) the viewer vendors (Integrity GIS Geocortex, Breeze Maps, CAMAvision Maps, Beacon/Schneider, Tyler iasWorld). The sandbox reaches only `*.arcgis.com`; every other host was MEASURED through the production-shaped relay (`/gis-proxy`, on this PR's Cloudflare preview) with point queries at 5 spread points inside each county plus 4 beside its county lines — each wired row returned polygons carrying its parcel id, and its returned extent sits inside Missouri.

**Integrity GIS (52 counties).** Integrity GIS hosts the assessor viewers of ~90 Missouri sites on five Geocortex pools (`adairgis`, `audraingis`, `barrygis`, `bartongis`, `bentongis` `.integritygis.com`). A county's PUBLIC site answers a *guest* with no sign-in and serves its parcel layer through the ordinary ArcGIS-REST shape (`/Geocortex/Essentials/REST/sites/<site>/map/mapservices/<n>/rest/services/x/MapServer/<layer>`; search, paging, `outSR=4326` geometry all work) — Planyr sends and reads no key. **13 sites demand a login** (guest → 403) and are named gaps, never worked around; and Butler, Dunklin and Ripley stay unwired on the owner's 2026-10-16 decision (their data service needs the viewer's injected key — Planyr must not replay or harvest it). **Flagged for the owner:** the three excluded counties' Geocortex guest path *does* answer, i.e. the exclusion is now a choice rather than a technical limit.

**Two viewer vendors Planyr cannot read yet = build items, not gaps (17 counties).** Breeze Maps (`<county>gis.breezemaps.com`, 7 counties here) and CAMAvision Maps (`maps.camavision.com/<county>mo`, 10 counties here) both answer anonymously but in their own formats, not ArcGIS REST — see the gap table and B2317681 / B2317682.

| County | Source | Layer / parcel-id field | Owner | Address | Measured (hits / points · beside line) |
|---|---|---|---|---|---|
| Adair County | Integrity GIS Geocortex public site `Adair_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 3 · layer 5) | yes | `ADDRESS` | 8/9 · 3/4 |
| Andrew County | Integrity GIS Geocortex public site `Andrew_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 0 · layer 6) | yes | — | 7/9 · 3/4 |
| Atchison County | Integrity GIS Geocortex public site `Atchison_County_MO` (`audraingis.integritygis.com`) | `PARCEL_PID` (ms 5 · layer 11) | yes | `REALDATA_ADDRESS` | 8/9 · 3/4 |
| Audrain County | Integrity GIS Geocortex public site `Audrain_County_MO` (`audraingis.integritygis.com`) | `PID` (ms 4 · layer 15) | yes | `ADDRESS` | 9/9 · 4/4 |
| Barry County | Integrity GIS Geocortex public site `Barry_County_MO` (`barrygis.integritygis.com`) | `PIN` (ms 0 · layer 9) | yes | `SITUS_ADDRESS` | 9/9 · 4/4 |
| Barton County | Integrity GIS Geocortex public site `Barton_County_MO` (`bartongis.integritygis.com`) | `PID` (ms 10 · layer 209) | yes | `SITUS_ADDRESS` | 7/9 · 2/4 |
| Bates County | Integrity GIS Geocortex public site `Bates_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 0 · layer 9) | yes | `address1` | 7/9 · 3/4 |
| Benton County | Integrity GIS Geocortex public site `Benton_County_MO` (`bentongis.integritygis.com`) | `PARCEL_PID` (ms 1 · layer 9) | yes | `address1` | 8/9 · 3/4 |
| Bollinger County | ArcGIS Online (`services6.arcgis.com`) | `PIN` | yes | — | 7/9 · 2/4 |
| Boone County | Boone County GIS (`gis.boonemo.gov`) | `ASSESSOR` | no | — | 9/9 · 4/4 |
| Buchanan County | Integrity GIS Geocortex public site `Buchanan_Co_MO` (`adairgis.integritygis.com`) | `PID2` (ms 0 · layer 9) | yes | `SITUSADDRESS` | 9/9 · 4/4 |
| Callaway County | ArcGIS Online (`services3.arcgis.com`) | `parcelid` | yes | `ADDRESS` | 9/9 · 4/4 |
| Camden County | Integrity GIS Geocortex public site `Camden_County_MO` (`bartongis.integritygis.com`) | `PID` (ms 0 · layer 8) | yes | — | 9/9 · 4/4 |
| Cape Girardeau County | SEMO RPC (`maps.semogis.com`) | `PIN` | yes | `Main_Addre` | 8/9 · 3/4 |
| Cedar County | Integrity GIS Geocortex public site `Cedar_County_MO` (`adairgis.integritygis.com`) | `parcel` (ms 0 · layer 26) | yes | `SITUS_ADDRESS` | 9/9 · 4/4 |
| Chariton County | Integrity GIS Geocortex public site `Chariton_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 2 · layer 7) | yes | `ADDRESS` | 6/9 · 2/4 |
| Christian County | Integrity GIS Geocortex public site `Christian_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 4 · layer 8) | yes | `address1` | 5/9 · 1/4 |
| Cole County | Mid-Missouri RPC (`www.midmogis.org`) | `PID` | yes | `Location` | 8/9 · 3/4 |
| Cooper County | Integrity GIS Geocortex public site `Cooper_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 2 · layer 11) | yes | `address1` | 8/9 · 3/4 |
| Dade County | Integrity GIS Geocortex public site `Dade_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 0 · layer 11) | yes | `ADDRESS` | 9/9 · 4/4 |
| Dallas County | Integrity GIS Geocortex public site `Dallas_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 0 · layer 7) | yes | `address1` | 6/9 · 2/4 |
| DeKalb County | Integrity GIS Geocortex public site `Dekalb_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 10 · layer 20) | yes | — | 6/9 · 1/4 |
| Douglas County | Integrity GIS Geocortex public site `Douglas_County_MO_Public` (`audraingis.integritygis.com`) | `parcel_no` (ms 2 · layer 23) | yes | `address1` | 9/9 · 4/4 |
| Gasconade County | Integrity GIS Geocortex public site `Gasconade_County_MO` (`audraingis.integritygis.com`) | `PARCEL_NUMBER` (ms 0 · layer 7) | yes | `SITUS_ADDRESS` | 8/9 · 4/4 |
| Greene County | Greene County Assessor (`greenecountyassessor.org`) | `PIN` | yes | `PropAdr` | 7/9 · 3/4 |
| Grundy County | Integrity GIS Geocortex public site `Grundy_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 0 · layer 4) | yes | `SITUSADDRESS` | 7/9 · 2/4 |
| Henry County | Integrity GIS Geocortex public site `Henry_County_MO` (`audraingis.integritygis.com`) | `PID` (ms 1 · layer 5) | yes | `SITUS_STRA` | 8/9 · 3/4 |
| Holt County | Integrity GIS Geocortex public site `Holt_County_MO` (`bentongis.integritygis.com`) | `PARCEL_PID` (ms 3 · layer 20) | yes | `site_address` | 7/9 · 3/4 |
| Iron County | SEMO RPC (`maps.semogis.com`) | `PID` | yes | `ADDRESS` | 6/9 · 1/4 |
| Jackson County | ArcGIS Online (`services3.arcgis.com`) | `parcel_id` | no | — | 7/9 · 2/4 |
| Jasper County | ArcGIS Online (`services6.arcgis.com`) | `PIN` | yes | `Address` | 8/9 · 4/4 |
| Jefferson County | ArcGIS Online (`services1.arcgis.com`) | `ParcelID` | yes | `Situs` | 7/9 · 3/4 |
| Johnson County | Integrity GIS Geocortex public site `Johnson_County_MO` (`audraingis.integritygis.com`) | `PID` (ms 2 · layer 8) | yes | `address1` | 8/9 · 3/4 |
| Laclede County | Integrity GIS Geocortex public site `Laclede_County_MO` (`audraingis.integritygis.com`) | `PARCEL_NUMBER` (ms 0 · layer 8) | yes | `address1` | 8/9 · 3/4 |
| Lafayette County | Integrity GIS Geocortex public site `Lafayette_County_MO` (`barrygis.integritygis.com`) | `PID` (ms 2 · layer 5) | yes | `ADDRESS_911` | 7/9 · 2/4 |
| Lawrence County | Integrity GIS Geocortex public site `Lawrence_County_MO` (`bentongis.integritygis.com`) | `parcel_no` (ms 0 · layer 6) | yes | `address1` | 9/9 · 4/4 |
| Lincoln County | Integrity GIS Geocortex public site `Lincoln_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 2 · layer 5) | yes | `SITUS_ADDRESS` | 8/9 · 3/4 |
| Livingston County | Integrity GIS Geocortex public site `Livingston_County_MO_Public` (`bentongis.integritygis.com`) | `PID` (ms 1 · layer 7) | yes | `ADDRESS` | 8/9 · 3/4 |
| Macon County | Integrity GIS Geocortex public site `Macon_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 0 · layer 5) | yes | `SITUS_ADDRESS` | 8/9 · 3/4 |
| Madison County | SEMO RPC (`maps.semogis.com`) | `ParcelNumb` | yes | `LocationAd` | 7/9 · 2/4 |
| Maries County | Integrity GIS Geocortex public site `Maries_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 2 · layer 11) | yes | `ADDRESS_1` | 7/9 · 2/4 |
| Marion County | Integrity GIS Geocortex public site `Marion_County_MO_Public` (`adairgis.integritygis.com`) | `PID` (ms 2 · layer 6) | yes | `ADDRESS` | 8/9 · 4/4 |
| McDonald County | Integrity GIS Geocortex public site `McDonald_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 1 · layer 7) | yes | `sit_stnm` | 8/9 · 3/4 |
| Miller County | Integrity GIS Geocortex public site `Miller_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 0 · layer 10) | yes | `SITUS_ADDRESS` | 9/9 · 4/4 |
| Moniteau County | Integrity GIS Geocortex public site `Moniteau_County_MO` (`audraingis.integritygis.com`) | `PID` (ms 0 · layer 9) | yes | `address1` | 8/9 · 3/4 |
| Morgan County | Integrity GIS Geocortex public site `Morgan_County_MO` (`bartongis.integritygis.com`) | `PARCEL_ID` (ms 1 · layer 6) | yes | `address1` | 7/9 · 2/4 |
| Newton County | Integrity GIS Geocortex public site `Newton_County_MO` (`barrygis.integritygis.com`) | `parcel_no` (ms 4 · layer 7) | yes | — | 8/9 · 3/4 |
| Osage County | Integrity GIS Geocortex public site `Osage_County_MO` (`adairgis.integritygis.com`) | `PIN` (ms 0 · layer 5) | yes | `SITUS_ADDRESS` | 9/9 · 4/4 |
| Perry County | SEMO RPC (`maps.semogis.com`) | `Parcel_Number` | yes | `Site_Address` | 8/9 · 3/4 |
| Phelps County | Integrity GIS Geocortex public site `Phelps_County_MO_Public` (`adairgis.integritygis.com`) | `PARCELPIN` (ms 7 · layer 6) | yes | `ADDRESS` | 9/9 · 4/4 |
| Polk County | Integrity GIS Geocortex public site `Polk_County_MO` (`bentongis.integritygis.com`) | `PARCEL_PID` (ms 0 · layer 10) | yes | `sit_stnm` | 8/9 · 3/4 |
| Pulaski County | Integrity GIS Geocortex public site `Pulaski_County_MO` (`bentongis.integritygis.com`) | `PARCEL_NUMBER` (ms 0 · layer 10) | yes | `ADDRESS` | 9/9 · 4/4 |
| Putnam County | Integrity GIS Geocortex public site `Putnam_County_MO_Vanguard` (`adairgis.integritygis.com`) | `PID` (ms 5 · layer 5) | yes | `ADDRESS` | 9/9 · 4/4 |
| Ralls County | Integrity GIS Geocortex public site `Ralls_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 4 · layer 8) | yes | `ADDRESS` | 9/9 · 4/4 |
| Ray County | Integrity GIS Geocortex public site `Ray_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 10 · layer 21) | yes | `ADDRESS` | 7/9 · 2/4 |
| Saline County | Integrity GIS Geocortex public site `Saline_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 0 · layer 12) | yes | `SITUSADDRESS` | 7/9 · 2/4 |
| Scott County | SEMO RPC (`maps.semogis.com`) | `PID` | yes | `SITE_ADDRESS` | 7/9 · 2/4 |
| St. Charles County | ArcGIS Online (`services1.arcgis.com`) | `Parcel_ID` | yes | `SiteAddress` | 7/9 · 3/4 |
| St. Clair County | Integrity GIS Geocortex public site `St_Clair_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 0 · layer 26) | yes | `Situs_Street` | 5/9 · 1/4 |
| St. Francois County | SEMO RPC (`maps.semogis.com`) | `PARCEL_NUMBER` | yes | `SITUS_ADDRESS` | 9/9 · 4/4 |
| St. Louis County | St. Louis County GIS (`maps.stlouisco.com`) | `LOCATOR` | yes | `PROP_ADD` | 8/9 · 4/4 |
| St. Louis city | City of St. Louis (`maps6.stlouis-mo.gov`) | `ParcelId` | yes | — | 6/9 · 1/4 |
| Stone County | Integrity GIS Geocortex public site `Stone_County_MO` (`audraingis.integritygis.com`) | `PARCEL_NUMBER` (ms 1 · layer 9) | yes | `address1` | 7/9 · 2/4 |
| Taney County | ArcGIS Online (`services3.arcgis.com`) | `PropertyNumber` | yes | `SitusAddress` | 7/9 · 3/4 |
| Vernon County | Integrity GIS Geocortex public site `Vernon_County_MO` (`adairgis.integritygis.com`) | `PID` (ms 1 · layer 7) | yes | — | 8/9 · 3/4 |
| Warren County | Integrity GIS Geocortex public site `Warren_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 2 · layer 6) | yes | `SITUS_ADDRESS` | 7/9 · 2/4 |
| Washington County | SEMO RPC (`maps.semogis.com`) | `PIN` | yes | `SITUSADDRE` | 7/9 · 2/4 |
| Wayne County | Integrity GIS Geocortex public site `Wayne_County_MO` (`barrygis.integritygis.com`) | `PID` (ms 2 · layer 9) | yes | `address1` | 9/9 · 4/4 |
| Webster County | Integrity GIS Geocortex public site `Webster_County_MO` (`adairgis.integritygis.com`) | `parcel_no` (ms 1 · layer 14) | yes | `address1` | 9/9 · 4/4 |
| Worth County | Integrity GIS Geocortex public site `Worth_County_MO` (`bentongis.integritygis.com`) | `PID` (ms 0 · layer 7) | yes | `CONAME1_ADDRESS` | 7/9 · 2/4 |
| Wright County | Integrity GIS Geocortex public site `Wright_County_MO_Public` (`barrygis.integritygis.com`) | `PARCELPIN` (ms 4 · layer 26) | yes | `SITUS_ADDRESS` | 8/9 · 3/4 |
| Clay County | county GIS (AGOL) — hand-wired 2026-09-11 (`mo_clay`) | — | — | — | unchanged |
| Platte County | county GIS (AGOL) — hand-wired 2026-09-10 (`mo_platte`) | — | — | — | unchanged |

Kansas City and Independence stay **city-scoped** (`cityScopes.js`) and answer first inside their limits; Jackson County now has its first countywide source (`mo_jackson`, the county's own parcel-fabric layer — no owner column, the tax/owner table is separate). Boone's public layer is the county basemap's parcel linework (lot id only; the owner-bearing viewers need a login). Taney's is a regional sewer district's republication of the county roll (dated 2026-10-09). The independent **City of St. Louis** keys apart from St. Louis County (`mo_stlouiscity` vs `mo_stlouis`, `counties.js` `INDEPENDENT_CITY_KEYS`).

### Missouri gaps — 42 counties, each with the reason and what was re-searched

Every one reads "<County> — no parcel data wired here yet." in the app. **None was closed on a null:** the five owner-decided counties stand on his word; 13 are login-gated (a fact measured 2026-10-19, not a failed search); 17 are a *format* (build items); the last 7 were re-searched on every route above.

| County | Kind | Reason (what was searched) |
|---|---|---|
| Butler | owner-decision | Public county viewer on Integrity GIS exists, but its data service answers 'Token Required' (499) — the viewer injects its own key. OWNER DECISION 2026-10-16: not pursued (Planyr must not replay or harvest a viewer's key). Re-checked 2026-10-19: the Integrity Geocortex guest path for these three sites does answer, and was left unwired on purpose. |
| Caldwell | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Carroll | none-found | No public parcel service found. Re-searched 2026-10-19: ArcGIS Online org + title search, the Integrity, Breeze Maps and CAMAvision county lists, the county assessor/collector pages (they refer to the assessor's office or a paid viewer), the NSGIC portal. Commercial resellers carry the roll; none used. |
| Carter | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Cass | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Clark | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Clinton | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Crawford | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |
| Daviess | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Dent | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |
| Dunklin | owner-decision | Public county viewer on Integrity GIS exists, but its data service answers 'Token Required' (499) — the viewer injects its own key. OWNER DECISION 2026-10-16: not pursued (Planyr must not replay or harvest a viewer's key). Re-checked 2026-10-19: the Integrity Geocortex guest path for these three sites does answer, and was left unwired on purpose. |
| Franklin | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Gentry | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Harrison | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Hickory | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |
| Howard | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Howell | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Knox | none-found | No public parcel service found. Re-searched 2026-10-19: ArcGIS Online org + title search, the Integrity, Breeze Maps and CAMAvision county lists, the county assessor/collector pages (they refer to the assessor's office or a paid viewer), the NSGIC portal. Commercial resellers carry the roll; none used. |
| Lewis | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Linn | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Mercer | none-found | No public parcel service found. Re-searched 2026-10-19: ArcGIS Online org + title search, the Integrity, Breeze Maps and CAMAvision county lists, the county assessor/collector pages (they refer to the assessor's office or a paid viewer), the NSGIC portal. Commercial resellers carry the roll; none used. |
| Mississippi | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Monroe | none-found | No public parcel service found. Re-searched 2026-10-19: ArcGIS Online org + title search, the Integrity, Breeze Maps and CAMAvision county lists, the county assessor/collector pages (they refer to the assessor's office or a paid viewer), the NSGIC portal. Commercial resellers carry the roll; none used. |
| Montgomery | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| New Madrid | owner-decision | OWNER DECISION 2026-10-16: accepted gap — no county viewer on Integrity GIS or ArcGIS Online. Re-searched 2026-10-19: AGOL org + title search, the Integrity site list, the Breeze Maps and CAMAvision county lists, the NSGIC portal — nothing public. |
| Nodaway | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Oregon | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Ozark | none-found | No public parcel service found. Re-searched 2026-10-19: ArcGIS Online org + title search, the Integrity, Breeze Maps and CAMAvision county lists, the county assessor/collector pages (they refer to the assessor's office or a paid viewer), the NSGIC portal. Commercial resellers carry the roll; none used. |
| Pemiscot | owner-decision | OWNER DECISION 2026-10-16: accepted gap — no county viewer on Integrity GIS or ArcGIS Online. Re-searched 2026-10-19: AGOL org + title search, the Integrity site list, the Breeze Maps and CAMAvision county lists, the NSGIC portal — nothing public. |
| Pettis | no-api | Beacon (Schneider Corp.) application only — no REST/OGC service; the AssessorSearch county guide lists no other map. Re-searched 2026-10-19 (AGOL org + title search, Integrity/Breeze/CAMAvision lists). |
| Pike | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Randolph | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |
| Reynolds | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |
| Ripley | owner-decision | Public county viewer on Integrity GIS exists, but its data service answers 'Token Required' (499) — the viewer injects its own key. OWNER DECISION 2026-10-16: not pursued (Planyr must not replay or harvest a viewer's key). Re-checked 2026-10-19: the Integrity Geocortex guest path for these three sites does answer, and was left unwired on purpose. |
| Schuyler | none-found | No public parcel service found. Re-searched 2026-10-19: ArcGIS Online org + title search, the Integrity, Breeze Maps and CAMAvision county lists, the county assessor/collector pages (they refer to the assessor's office or a paid viewer), the NSGIC portal. Commercial resellers carry the roll; none used. |
| Scotland | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Shannon | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |
| Shelby | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Ste. Genevieve | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Stoddard | adapter-needed | The county's map is a CAMAvision Maps site (maps.camavision.com/<county>mo), a UMN MapServer: parcel boundaries are WFS closed LINES (no polygons, no attributes) and the owner/PIN/acres come from a separate per-click JSON — NOT ArcGIS REST. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 10 counties). Howell's older Breeze Maps site was discontinued by the vendor (its own page says so, 2026-10-19). |
| Sullivan | login-required | The county's parcel viewer is an Integrity GIS Geocortex site that REQUIRES A LOGIN — its public endpoint answers a guest 403 'The current user cannot access the desired resource' (measured 2026-10-19 through the relay, site listed in the Integrity farm's own site index). Not worked around. |
| Texas | adapter-needed | The county's parcel viewer is Breeze Maps (<county>gis.breezemaps.com), a custom API (api/map, api/features, JWT guest login) — NOT ArcGIS REST, so the existing layer plumbing cannot read it. A FORMAT we do not read yet, not an absence of data: filed as a build item (adapter covers these 7 counties). |

## South Carolina counties (2026-10-19) — 46 of 46 wired

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* — this section is South Carolina only (sibling sessions took the other states). **Every one of the 46 counties now returns a parcel (tax-map number, acreage, and the owner wherever the source has one); none is a gap.** The 2026-09-09 probe row for South Carolina ("no-free-source / none found") was run from an egress-limited sandbox, before pass 2 and before the relay existed; its *statewide* conclusion was wrong, and it is replaced below.

**The statewide source (found 2026-10-19).** The SC **Revenue and Fiscal Affairs Office** (RFA — the state's own GIS section) publishes `Statewide_Parcels`: **2,968,877 parcels, all 46 counties**, as layer 18 of its public ArcGIS Online service `Lexington_Richland_Web_Map_WFL1` (`services9.arcgis.com/RvqSyw3diI7dTKo5`). Fields: `T_Map_Number` (the county tax-map number — the parcel id), `County`, `Ownership` (owner), `Acreage`, `L_Value`/`M_Value`/`B_Value`, `Land_Use`, `Zoning`, `SD_Name`, `GeoID`. Data last edited January–February 2026 (every county 2026-01-30 except Dorchester and Georgetown, 2026-02-20). It is anonymous (no token), its licence text calls it "public information and data", it answers a viewport-sized envelope in 0.4–1.4 s, and a point never matches two lots (checked at 9 points × 46 counties; York alone has one double). **Owner present for 38 of 46 counties** — empty for Barnwell, Calhoun, Clarendon, Fairfield, Georgetown, Lee, Saluda and Spartanburg. No situs address at all. Each county row scopes the one layer with `scopeWhere = County='<Name> County'` (the way Mississippi rides MARIS), so a search or click can only ever return that county's lots.

> **⚠ FLAGGED FOR THE OWNER — read before treating this as settled.** RFA's own web page says its aggregated statewide parcels are available only through "secure" (non-public) services. This layer is *not* secure: it is the public layer behind the County Boundary Program's Lexington–Richland boundary web map, and it carries the whole state. It is public today, under the state's own public-data licence — but it was published for a different purpose, so RFA could restrict or remove it without notice. If it goes dark, 35 counties show the app's loud "no parcel data" failure (never a wrong number) and the fix is to re-wire them to their county layers (the research below lists what exists). That risk is why ten counties use their own county layer instead.

**Ten counties use their own county layer** — where it carries a **site address** RFA never has (Beaufort, Colleton, Laurens, Pickens, Sumter, York) or the **owner** RFA's roll lacks (Barnwell, Calhoun, Lee, Spartanburg), and is at least as fresh (edited 2026-09 / 2026-10, or a live county database): Laurens, Sumter and Spartanburg ride `/gis-proxy` (three hosts added to its allow-list); the other seven are on ArcGIS Online. Greenville keeps its hand-written row (`sc_greenville`, 2026-09-11).

**Measured** (every source, 9 interior points + 4 points just inside the county line, point queries only): the 35 RFA counties and every county layer returned polygons carrying the declared id; the layer's returned extent sits inside South Carolina (for the RFA layer, scoped to the county). Misses are roads, water and public land with no tax parcel — checked rather than assumed: where a county's own server was also queried (Oconee, Anderson, Berkeley) it returned the same number of hits at the same points, and populated points at Walhalla, Westminster, Pendleton and in Charleston/Berkeley town centres return parcels from the RFA layer. Oconee (2 of 9 interior, 3 of 4 on the line) is the thinnest — Lake Keowee/Jocassee and Sumter National Forest. Laurens, Sumter and Spartanburg were measured through the production-shaped relay on this PR's Cloudflare preview (the sandbox reaches only `*.arcgis.com`).

**Searched, and not used (so nobody re-hunts them):**
- **SCDOT's `smpesri.scdot.org/arcgis/rest/services/GISMapping/SC_Parcels`** — a MapServer with one layer per county (0–45, the "Parcels - SC - <County>" items on ArcGIS Online, published 2022). Measured through the relay: **`Token Required` (499)**. Login-gated, so never used and not on the allow-list.
- **SC Forestry Commission** `Parcels_PeeDee` / `Parcels_Coastal` / `Parcels_Piedmont` (services9 `MvVEDRWecTZBD2xl`, 2024, 2.95 M parcels, all 46 counties, tax-map number + acreage, no owner) — measured and passes everywhere, but RFA's layer has the same parcels *plus* the owner and is newer, so it is the documented fallback if RFA goes dark. Its Colleton rows are spelled `Collecton County`.
- **Town of Summerville's** January-2026 republications of Berkeley and Dorchester (`croberts226`, services8) — same vintage as RFA, adds only an address, and a town is not the county; not used. Charleston Water System's all-tri-county copy (437,707 parcels, edited 2026-10-05, owner + address) and Charleston County's own `gisccapps.charlestoncounty.org` (ProVal/ParcelMap, 197,715; all 13 point queries returned nothing, though an envelope query around the same spot returns 64 lots — a shape the app's click path would trip on) — Charleston rides RFA (195,917 parcels, owner).
- **Horry** (`www.horrycounty.org/gispublic`, 302,412), **Anderson** (`propertyviewer.andersoncountysc.org`, 120,545, no owner), **Oconee** (`arcserver2.oconeesc.com`, 63,514, no owner), **Georgetown** (`gis1.georgetowncountysc.org`, 47,940, tax-map number only; its owner table is non-spatial) were measured through the relay and agree with RFA; RFA has the owner, so they are not wired.
- Greenwood (Hub, 2024), Jasper (2020–22), Kershaw (2026-07, id + acres only), Hampton, Darlington, Union, Florence (replica edited 2021), Lancaster (2024), Lexington (a 146,177-lot `Parcels_20260625` copy that RFA's own web map also carries) and Richland (RFA's own 183,685-lot Richland layer is the statewide layer's source): county layers exist and pass, but add neither an address nor an owner RFA lacks, or are older — RFA is used. Aiken, Abbeville, Allendale, Bamberg, Cherokee, Chester (a 22,851-lot Catawba COG scenario layer, not the county's), Chesterfield, Clarendon, Dillon, Edgefield, Fairfield, Marion (token), Marlboro, McCormick, Newberry (2021), Saluda, Williamsburg: no public county service found on ArcGIS Online (title search, owner/org search, per-layer probe of ~700 SC-extent items, web-map layer extraction) — RFA is their source.

**Counties whose public source has no owner (the card shows the lot, tax-map number and acreage, and says nothing about an owner):** Clarendon, Fairfield, Georgetown, Saluda — RFA's roll is empty for them and no county layer was found (re-searched 2026-10-19 by county name, org name and the SCDOT index). Nothing is "unavailable": these are lots with no owner column in the public data. Their owner names would come from the county assessor sites (login/search forms, no public API found).

**Quirks recorded:** McCormick's `T_Map_Number` is `GOV` on some large public parcels (not unique) — click returns the lot, the id is not a search key there; Lee's CAMA address lines are the owner's mailing address and are deliberately not read as a site address; RFA's `GeoID` is a county/district code (e.g. `4500720` on every Aiken lot) — the account shown is `T_Map_Number` (`countyRecord` now prefers the declared column over a GeoID).

| County | Source | Parcel-id field | Owner | Site address | Measured (interior hits/9 · county-line hits/4) |
|---|---|---|---|---|---|
| Abbeville County | SC Revenue and Fiscal Affairs statewide parcels, `County='Abbeville County'` | `T_Map_Number` | yes | — | 5/9 · 4/4 |
| Aiken County | SC Revenue and Fiscal Affairs statewide parcels, `County='Aiken County'` | `T_Map_Number` | yes | — | 8/9 · 2/4 |
| Allendale County | SC Revenue and Fiscal Affairs statewide parcels, `County='Allendale County'` | `T_Map_Number` | yes | — | 7/9 · 4/4 |
| Anderson County | SC Revenue and Fiscal Affairs statewide parcels, `County='Anderson County'` | `T_Map_Number` | yes | — | 4/9 · 3/4 |
| Bamberg County | SC Revenue and Fiscal Affairs statewide parcels, `County='Bamberg County'` | `T_Map_Number` | yes | — | 9/9 · 4/4 |
| Barnwell County | Barnwell County, ArcGIS Online (`BarnwellCountySC`, edited 2026-10-19) | `TaxPIN` | yes | — | 9/9 · 4/4 |
| Beaufort County | Beaufort County GIS, ArcGIS Online (`iand_BCSCGIS` `ParcelsFromPro`, edited 2026-10-14) | `PIN` | yes | `SitusAddre` | 7/9 · 3/4 |
| Berkeley County | SC Revenue and Fiscal Affairs statewide parcels, `County='Berkeley County'` | `T_Map_Number` | yes | — | 4/9 · 1/4 |
| Calhoun County | Calhoun County, ArcGIS Online (`WebParcels`, edited 2026-10-17) | `TMS` | yes | `Property_Address` | 5/9 · 4/4 |
| Charleston County | SC Revenue and Fiscal Affairs statewide parcels, `County='Charleston County'` | `T_Map_Number` | yes | — | 4/9 · 3/4 |
| Cherokee County | SC Revenue and Fiscal Affairs statewide parcels, `County='Cherokee County'` | `T_Map_Number` | yes | — | 7/9 · 4/4 |
| Chester County | SC Revenue and Fiscal Affairs statewide parcels, `County='Chester County'` | `T_Map_Number` | yes | — | 6/9 · 4/4 |
| Chesterfield County | SC Revenue and Fiscal Affairs statewide parcels, `County='Chesterfield County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| Clarendon County | SC Revenue and Fiscal Affairs statewide parcels, `County='Clarendon County'` | `T_Map_Number` | no (roll is empty for this county) | — | 5/9 · 3/4 |
| Colleton County | Colleton County GIS, ArcGIS Online (`ColletonGIS` `Public_Data` layer 2, edited 2026-09-17) | `PIN` | yes | `PropertyAddress` | 8/9 · 4/4 |
| Darlington County | SC Revenue and Fiscal Affairs statewide parcels, `County='Darlington County'` | `T_Map_Number` | yes | — | 9/9 · 4/4 |
| Dillon County | SC Revenue and Fiscal Affairs statewide parcels, `County='Dillon County'` | `T_Map_Number` | yes | — | 6/9 · 4/4 |
| Dorchester County | SC Revenue and Fiscal Affairs statewide parcels, `County='Dorchester County'` | `T_Map_Number` | yes | — | 9/9 · 3/4 |
| Edgefield County | SC Revenue and Fiscal Affairs statewide parcels, `County='Edgefield County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| Fairfield County | SC Revenue and Fiscal Affairs statewide parcels, `County='Fairfield County'` | `T_Map_Number` | no (roll is empty for this county) | — | 7/9 · 3/4 |
| Florence County | SC Revenue and Fiscal Affairs statewide parcels, `County='Florence County'` | `T_Map_Number` | yes | — | 7/9 · 4/4 |
| Georgetown County | SC Revenue and Fiscal Affairs statewide parcels, `County='Georgetown County'` | `T_Map_Number` | no (roll is empty for this county) | — | 9/9 · 4/4 |
| Greenwood County | SC Revenue and Fiscal Affairs statewide parcels, `County='Greenwood County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| Hampton County | SC Revenue and Fiscal Affairs statewide parcels, `County='Hampton County'` | `T_Map_Number` | yes | — | 7/9 · 4/4 |
| Horry County | SC Revenue and Fiscal Affairs statewide parcels, `County='Horry County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| Jasper County | SC Revenue and Fiscal Affairs statewide parcels, `County='Jasper County'` | `T_Map_Number` | yes | — | 6/9 · 4/4 |
| Kershaw County | SC Revenue and Fiscal Affairs statewide parcels, `County='Kershaw County'` | `T_Map_Number` | yes | — | 7/9 · 2/4 |
| Lancaster County | SC Revenue and Fiscal Affairs statewide parcels, `County='Lancaster County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| Laurens County | Laurens County GIS (`www.laurenscountygis.org`, Pebble/TaxParcel layer 5) via `/gis-proxy` | `TMS` | yes | `Property_Address` | 7/9 · 2/4 |
| Lee County | Lee County, ArcGIS Online (`LeeCounty_2013` `Web_Parcels`, edited 2026-10-19) | `Parcel_Polygons_PID` | yes | — | 7/9 · 4/4 |
| Lexington County | SC Revenue and Fiscal Affairs statewide parcels, `County='Lexington County'` | `T_Map_Number` | yes | — | 8/9 · 1/4 |
| Marion County | SC Revenue and Fiscal Affairs statewide parcels, `County='Marion County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| Marlboro County | SC Revenue and Fiscal Affairs statewide parcels, `County='Marlboro County'` | `T_Map_Number` | yes | — | 7/9 · 4/4 |
| McCormick County | SC Revenue and Fiscal Affairs statewide parcels, `County='McCormick County'` | `T_Map_Number` | yes | — | 7/9 · 1/4 |
| Newberry County | SC Revenue and Fiscal Affairs statewide parcels, `County='Newberry County'` | `T_Map_Number` | yes | — | 5/9 · 4/4 |
| Oconee County | SC Revenue and Fiscal Affairs statewide parcels, `County='Oconee County'` | `T_Map_Number` | yes | — | 2/9 · 3/4 |
| Orangeburg County | SC Revenue and Fiscal Affairs statewide parcels, `County='Orangeburg County'` | `T_Map_Number` | yes | — | 6/9 · 2/4 |
| Pickens County | Pickens County GIS, ArcGIS Online (`GISpickens` `Energov_AGOL` layer 7) | `PIN` | yes | `LOCADD` | 7/9 · 3/4 |
| Richland County | SC Revenue and Fiscal Affairs statewide parcels, `County='Richland County'` | `T_Map_Number` | yes | — | 5/9 · 2/4 |
| Saluda County | SC Revenue and Fiscal Affairs statewide parcels, `County='Saluda County'` | `T_Map_Number` | no (roll is empty for this county) | — | 7/9 · 4/4 |
| Spartanburg County | Spartanburg County GIS (`maps.spartanburgcounty.org`, GIS/CAMA_Parcels) via `/gis-proxy` | `MAPNUMBER` | yes | `PropertyLocation` | 7/9 · 3/4 |
| Sumter County | Sumter County GIS (`gis.sumter-sc.com`, BaseMaps/Sumter_City_County layer 7) via `/gis-proxy` | `parcel_number` | yes | `parcel_address_one` | 9/9 · 4/4 |
| Union County | SC Revenue and Fiscal Affairs statewide parcels, `County='Union County'` | `T_Map_Number` | yes | — | 7/9 · 4/4 |
| Williamsburg County | SC Revenue and Fiscal Affairs statewide parcels, `County='Williamsburg County'` | `T_Map_Number` | yes | — | 8/9 · 4/4 |
| York County | York County GIS, ArcGIS Online (`yorkcountysc_gisonline` `Parcels`, edited 2026-10-19) | `ParcelID` | yes | `PropertyAddress` | 8/9 · 4/4 |

## Washington counties (2026-10-19) — 34 of 39 wired (B2349360)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* — this section is Washington only. **The statewide mosaic is NOT used.** The WAGeoservices "Current Parcels" layer (and the WDFW / DNR copies of it) states that some counties restrict use of their parcels to "State of Washington business only" — an explicit use restriction, not a liability disclaimer — so the B759/760 decision above stands: it is a legal call for the owner, not a wiring choice for a session. (The mosaic also carries no owner column.) Instead **every county is wired to its OWN published layer**; the 2026-09-09 probe's "no-free-source" verdict for Washington is superseded. Module `lib/waParcels.js` (rows), `lib/waProvenance.js` (per-county prose, build-time only), test `test/washingtonCounties.test.js` (red on main: 75 failing assertions), fixtures `test/fixtures/waCounties.json` + `waSamples.json`.

**How it was searched.** The sandbox reaches only `*.arcgis.com`. (1) ArcGIS Online item search per county, wide AGOL bbox crawl, county-org service listers; (2) four parallel research passes over county GIS / assessor pages and open-data hubs; (3) the county-run ArcGIS Servers (Chelan, Cowlitz, Jefferson, Kittitas, San Juan, Skagit, Thurston, Whatcom) were listed and measured **through the `/gis-proxy` relay on this PR's Cloudflare preview**; (4) the vendor viewer hosts of the gap counties (TerraScan MapSifter, Sanborn MapGeo) were read through the relay too. **Measurement per wired row:** ~140 real parcels pulled spread across the layer's object-id range; the first 60 each re-found by a point query at their own interior point, returning the parcel id; the sampled parcels' extent sits inside Washington; parcels sitting beside a county line (by the bundled county polygons) found for every county. Record: `test/fixtures/waSamples.json`.

**Three wired counties are NOT county-hosted** (labelled `third-party` in `waProvenance.js`): Adams (the county's IT contractor's org), Grays Harbor (a 2024 copy in a third-party org) and Klickitat (a nonprofit's 2026 copy) — each cites the county as its source; replace them if the county publishes its own. **Flags for the owner (not blockers):** King County's metadata says its parcel data "may not be reproduced or redistributed … without written authorization" (Planyr reads one parcel per click and shows it to the clicker; it does not copy the layer), Cowlitz's layer says it is meant for the Assessor's appraisers, Pierce's service carries a Terms of Use acceptance, and Clark removed owner names from its public layer on purpose.

**Owner column.** Present for 26 of the 34 (`yes` below); absent on Clark, King (the public layer's only name field is a care-of line), Kitsap (owner/address live in separate join tables), Lewis, Pierce (business name only), Spokane, Stevens and Yakima. Adams, Douglas, Franklin and Mason publish surname + given names in two columns and Skamania `OwnerLast` + `OwnerFirst` — `appraisal.js` `ownerWithFirstName` joins them; Whitman's `Last_Name` is the whole name for an entity but only the surname for an individual. `appraisal.js` also learned the spellings `PNAM`, `file_as_name`, `t2_Owner`, `TitleOwner`, `ownr_nm`, `Property_O`, `py_owner_name`, `title_owner_name`, `DEED_HOLDER_NAME` and Chelan's prefixed `sde_CHELAN_PACS_TABLE_Owner_Nam`, and ignores King's `FULLNAME` (a street name).

**San Juan's islands.** The bundled county polygons carry only part of San Juan Island, so Orcas / Lopez / Shaw / Waldron lots resolve "outside" by polygon; `wa_sanjuan`'s bbox is hand-widened to the archipelago so a lot click still reaches it (guarded in the test). Filed as B2349362.

| County | Source · publisher | Parcel-id field | Owner | Address | Measured |
|---|---|---|---|---|---|
| Adams County | ArcGIS Online (direct) · **third-party copy** | `ParcelNumb` | yes (`LastName`) | `Situs` | 60/60 re-found · 19 beside a line |
| Asotin County | ArcGIS Online (direct) · county | `PARCEL` | yes (`PNAM`) | `PA2` | 60/60 re-found · 59 beside a line |
| Benton County | ArcGIS Online (direct) · county | `Parcel_ID` | yes (`owner_name`) | `situs_address` | 59/60 re-found · 38 beside a line |
| Chelan County | county ArcGIS Server via `/gis-proxy` (`atlas.co.chelan.wa.us`) · county | `sde_CHELAN_Property_Polygons_PA` | yes (`sde_CHELAN_PACS_TABLE_Owner_Nam`) | `sde_CHELAN_PACS_TABLE_Site_Addr` | 60/60 re-found · 32 beside a line |
| Clallam County | ArcGIS Online (direct) · county | `PNUM` | yes (`OWNER`) | — | 59/60 re-found · 2 beside a line |
| Clark County | ArcGIS Online (direct) · county | `Prop_id` | no | `SitusAddrsFull` | 60/60 re-found · 40 beside a line |
| Cowlitz County | county ArcGIS Server via `/gis-proxy` (`gis.cowlitzwa.gov`) · county | `PARCNO` | yes (`DEED_HOLDER_NAME`) | — | 60/60 re-found · 46 beside a line |
| Douglas County | ArcGIS Online (direct) · county | `ParcelNumb` | yes (`LastName`) | `Situs` | 60/60 re-found · 21 beside a line |
| Franklin County | ArcGIS Online (direct) · county | `PARCELNUMB` | yes (`LastName`) | `Situs` | 60/60 re-found · 47 beside a line |
| Grant County | ArcGIS Online (direct) · county | `PARCEL` | yes (`file_as_name`) | `situs_street` | 60/60 re-found · 23 beside a line |
| Grays Harbor County | ArcGIS Online (direct) · **third-party copy** | `ParcelID` | yes (`OWNER`) | `ADDRESS` | 60/60 re-found · 4 beside a line |
| Island County | ArcGIS Online (direct) · county | `ParcelNo` | yes (`taxpayer`) | `physical_addr` | 60/60 re-found · 7 beside a line |
| Jefferson County | county ArcGIS Server via `/gis-proxy` (`gisweb.jeffcowa.us`) · county | `PIN` | yes (`Owner_Name`) | `Situs_Addr` | 60/60 re-found · 10 beside a line |
| King County | ArcGIS Online (direct) · county | `PIN` | no | `ADDR_FULL` | 60/60 re-found · 7 beside a line |
| Kitsap County | ArcGIS Online (direct) · county | `APN` | no | — | 60/60 re-found · 3 beside a line |
| Kittitas County | county ArcGIS Server via `/gis-proxy` (`gis.co.kittitas.wa.us`) · county | `PARCELID` | yes (`t2_Owner`) | `t2_Situs` | 59/60 re-found · 4 beside a line |
| Klickitat County | ArcGIS Online (direct) · **third-party copy** | `PARCEL_NUM` | yes (`NAME`) | `ADDRESS` | 59/60 re-found · 27 beside a line |
| Lewis County | ArcGIS Online (direct) · county | `PIN` | no | `SITEADD` | 60/60 re-found · 5 beside a line |
| Lincoln County | ArcGIS Online (direct) · county | `ParcelNum` | yes (`TitleOwner`) | `Situs` | 58/60 re-found · 21 beside a line |
| Mason County | ArcGIS Online (direct) · county | `PIN` | yes (`LAST_NAME`) | `SITUS_ADDR` | 60/60 re-found · 11 beside a line |
| Pend Oreille County | ArcGIS Online (direct) · county | `prop_id` | yes (`ownr_nm`) | — | 60/60 re-found · 10 beside a line |
| Pierce County | ArcGIS Online (direct) · county | `TaxParcelNumber` | no | `Site_Address` | 60/60 re-found · 13 beside a line |
| San Juan County | county ArcGIS Server via `/gis-proxy` (`gis.sanjuancountywa.gov`) · county | `PIN` | yes (`Owner`) | — | 60/60 re-found · 1 beside a line |
| Skagit County | county ArcGIS Server via `/gis-proxy` (`gis.skagitcountywa.gov`) · county | `PARCELID` | yes (`OwnerName`) | `SitusStName` | 54/60 re-found · 11 beside a line |
| Skamania County | ArcGIS Online (direct) · county | `PARCEL_ID` | yes (`OwnerLast`) | `Situs` | 60/60 re-found · 48 beside a line |
| Snohomish County | ArcGIS Online (direct) · county | `PARCEL_ID` | yes (`OWNERNAME`) | `SITUSLINE1` | 60/60 re-found · 22 beside a line |
| Spokane County | ArcGIS Online (direct) · county | `PID_NUM` | no | `site_address` | 60/60 re-found · 4 beside a line |
| Stevens County | ArcGIS Online (direct) · county | `PARCELN` | no | — | 60/60 re-found · 28 beside a line |
| Thurston County | county ArcGIS Server via `/gis-proxy` (`tconline.co.thurston.wa.us`) · county | `PARCEL_NO` | yes (`OWNER_NAME`) | `SITUS_STRE` | 60/60 re-found · 18 beside a line |
| Wahkiakum County | ArcGIS Online (direct) · county | `Geographic` | yes (`Property_O`) | `Parcel_Add` | 60/60 re-found · 22 beside a line |
| Walla Walla County | ArcGIS Online (direct) · county | `geo_id` | yes (`py_owner_name`) | `full_situs` | 59/60 re-found · 43 beside a line |
| Whatcom County | county ArcGIS Server via `/gis-proxy` (`wcgis.whatcomcounty.us`) · county | `geo_id` | yes (`title_owner_name`) | `situs_street` | 60/60 re-found · 3 beside a line |
| Whitman County | ArcGIS Online (direct) · county | `ParcelNumber` | yes (`Last_Name`) | — | 59/60 re-found · 18 beside a line |
| Yakima County | ArcGIS Online (direct) · county | `PARC` | no | — | 57/60 re-found · 4 beside a line |

### Washington gaps (5) — each re-searched

| County | Kind | What was searched and why it is a gap |
|---|---|---|
| Columbia | none-found | No public Columbia County parcel layer found. Re-searched 2026-10-19 by: ArcGIS Online item search (eight queries incl. Dayton, Public Works), the county GIS page (columbiaco.com/482/GIS) and assessor property search, the county's AGOL org alias (ccpwdgis — private, no public items), vendor viewer host (columbiawa-mapsifter.publicaccessnow.com — not reachable even through the relay). A different Columbia County (New York) also answers to the name. Only the licence-restricted statewide mosaic covers it, which is not used. |
| Ferry | login-required | The one Ferry County parcel layer on ArcGIS Online (FERRY_COUNTY_PARCEL_LAYER, an individual's account) answers 'Token Required' (499) at service and layer level, so it is not public. The county's viewer is TerraScan MapSifter behind a click-through Disclaimer page (ferrywa-mapsifter.publicaccessnow.com, read through the relay 2026-10-19), which is not replayed. A state parcel record says the county runs an ArcGIS Server but its URL is not published. Only the licence-restricted statewide mosaic covers it, which is not used. |
| Garfield | none-found | No public Garfield County parcel layer found. Re-searched 2026-10-19 by: ArcGIS Online item search (six queries: Garfield County parcel, Pomeroy, owner:gmci), the county web map org gmci.maps.arcgis.com (private — no public items), the Tyler property-search host, the MapSifter viewer host (garfieldwa-mapsifter.publicaccessnow.com, a disclaimer-gated HTML viewer), and the state parcel-producer record (assessor releases CDs on a signed non-commercial declaration). Only the licence-restricted statewide mosaic covers it, which is not used. |
| Okanogan | no-api | Okanogan County's parcels are published only in a MapGeo viewer (okanoganwa.mapgeo.io — a Sanborn-hosted viewer with its own private API, not an ArcGIS REST layer) and as an assessor FTP bulk file. The only ArcGIS Online copy (Okanogan_County_Parcels_view, a project account) answers 'Token Required' (499) and has owner data removed. Re-searched 2026-10-19: AGOL (four queries), county GIS and assessor pages, the Emergency Management org, the MapGeo host through the relay. Calling a viewer's private API would be replaying its key, which this project does not do; the statewide mosaic is licence-restricted and unused. |
| Pacific | no-api | Pacific County publishes tax lots only as a downloadable shapefile (tax_lots.zip on the county GIS page) and through TerraScan MapSifter / TaxSifter viewers (pacificwa-mapsifter.publicaccessnow.com, a disclaimer-gated HTML viewer, read through the relay 2026-10-19). Re-searched 2026-10-19: AGOL (four queries — only user copies of the licence-restricted statewide mosaic and a coastal-study extract), county pages, the state parcel-producer record. No public REST layer exists to wire. |

The three vendor-viewer gaps (Ferry, Garfield, Pacific, and Adams' own viewer) all sit behind a TerraScan MapSifter **click-through disclaimer page** with no REST layer behind it; Okanogan's is a Sanborn MapGeo viewer with a private API. Neither is replayed (the project's standing posture on a viewer's key). A county's own published bulk file (Okanogan's assessor FTP file, Pacific's `tax_lots.zip`) is a possible future ingest, not a live lookup.


## Oregon counties (2026-10-19) — 33 of 36 wired (B2347696)

Owner request 2026-10-19 ("start wiring all the remaining states into Planner"). **Start state:** 2 of 36 (Multnomah, Clackamas); the 2026-09-09 statewide probe called Oregon "no-free-source" from an egress-limited sandbox, before the ArcGIS Online org pass and the `/gis-proxy` relay existed — that verdict is stale for the 31 counties wired here.

**Statewide routes tried first, and why none is the answer.** (1) The state's own page "Publicly Accessible Oregon County Parcel Data" (Oregon GEOHub, an ArcGIS Experience) is a list of county viewer links, not a layer; each link's web-map config was read for its real service. (2) DOR's ORMAP service (`utility.arcgis.com/…/Secure/DOR_ORMAP/MapServer`) — 403 to an anonymous caller. (3) ODF `StatewideTaxLots` — "Token Required"; ODF `TaxlotsDisplay` has a layer for all 36 counties but its capabilities are **Map only** (no Query, no Identify), so it can draw tiles but cannot answer "which lot is this". (4) The state's `or_cadastral_wm` "Tax Lot" layer — HTTP 400 "Invalid URL" (retired, as the 2026-09 note said). (5) Water Resources Department "Tax_Lots_Public_Query_WGS84" layer 2 (`gis.wrd.state.or.us`) — queryable, 536,727 lots with an agreement for public use, but only **13 counties** (Baker, Benton, Clackamas, Curry, Grant, Harney, Jackson, Jefferson, Klamath, Lake, Lincoln, Tillamook, Wheeler) and it carries the owner's MAILING text, not an owner-of-record name; it is used (scoped by `county_name`) only for Curry, Jefferson and Lincoln, where no queryable county layer was found. (6) Metro RLIS covers the Portland tri-county area only (Multnomah/Clackamas already wired).

**How it was searched.** The sandbox reaches only `*.arcgis.com`, so: (1) ArcGIS Online item search bbox-filtered to Oregon (3,928 Feature/Map services across 13 parcel/taxlot/assessor keywords; 4,291 polygon layers probed; the 789 with ≥1,500 features re-probed for their real extent and assigned to a county by centroid); (2) every ArcGIS web app/experience on the state's county list read for its web-map layer URLs (that is how Benton's, Josephine's and the eastern-Oregon org's services were found); (3) county REST directories read through the relay on the PR's Cloudflare preview (hosts added to the allow-list in this PR); (4) web search per gap county. **Trap caught:** the "Union County Parcel Viewer" on ArcGIS Online (layer `Union_County_Assessor_Rnumbers`, publisher UnionGIS) is Union County, **New Mexico** — never wired (`test/oregonCounties.test.js` fails if it ever is).

**Measurement.** Each wired row: polygon layer, point queries at 5 spread interior points and up to 4 points just inside the county line (the two numbers per row below), each hit carrying the parcel id. Test artifacts: `test/oregonCounties.test.js`, `test/fixtures/oregonCounties.json` / `oregonSamples.json` (a recorded real lot from each source). **Red-proof:** with the `orRaw()`/`orMap()` spreads removed from `counties.js`, 63 of the test's 110 cases fail (every "wired" county falls through to no-source).

| County | Status | Owner field | Source / measurement |
|---|---|---|---|
| Baker | **wired** — Baker County Assessor (ArcGIS Online org Assessor_BakerCo, 'Baker County Oregon Taxlot Shapefile') | no | id = `MapTaxlot`; Map-taxlot id + acreage; no owner column. 16,722 lots; edited 2026-06. Measured through ArcGIS Online directly: interior hits 5/5 · 3/3 (interior · near-line). |
| Benton | **wired** — Benton County (gis.co.benton.or.us Public/TaxlotOwners) | yes | id = `MapTaxlot`; Map-taxlot id, owner (Party_Name), situs; 107,939 rows (one per account). The county's own taxlot viewer reads this service. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Clatsop | **wired** — Clatsop County staff (ArcGIS Online, 'Taxlots March 2022' taxlot_accounts) | yes | id = `MapTaxlot`; Map-taxlot id, owner (OWNER_LINE), situs; edited 2024-02. The county's own server (delta.co.clatsop.or.us) publishes no queryable taxlot layer. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Columbia | **wired** — Columbia County (gis.columbiacountymaps.com TaxlotWb) | yes | id = `MAP_TAX`; Map-tax id, owner, primary situs; 28,843 lots. The county's Assessor folder is token-gated; this public TaxlotWb service is the one its web maps use. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Coos | **wired** — Coos County assessor roll as republished by University of Oregon (ArcGIS Online 'Coos County Parcels_March2024') | yes | id = `TLID`; Tax-lot id (TLID), owner (OWNER1), situs; edited 2025-04. The county's own org copy (CoosCounty) is the May 2019 comp-finder, older, so not used. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Crook | **wired** — Crook County (gis.crookcountyor.gov taxlots_helion_view) | yes | id = `MAPTAXLOT`; Map-taxlot id, owner, situs, acreage; 17,596 lots. County-line points near unmapped federal land returned no lot (2 of 4). Measured through the relay: interior hits 5/5 · 2/4 (interior · near-line). |
| Curry | **wired** — Oregon Water Resources Department public tax-lot query (gis.wrd.state.or.us Tax_Lots_Public_Query_WGS84 layer 2, scoped county_name='Curry') | no | id = `maptaxlot`; Map-taxlot id + acreage; the state layer carries owner mailing text only (no owner-of-record name). Curry County's own RLID server publishes no queryable taxlot layer. 20,748 lots. Measured through the relay: interior hits 5/5 · 3/4 (interior · near-line). |
| Deschutes | **wired** — Deschutes County (ArcGIS Online org DeschutesCo, 'Taxlots') | no | id = `TAXLOT`; Taxlot id only (the public layer holds no owner or situs; the DIAL link is the roll); 109,504 lots; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Douglas | **wired** — Douglas County (gis.co.douglas.or.us Parcel/Parcels) | yes | id = `TAXID`; Tax id, owner (NAME), situs, acreage; 68,858 parcels. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Gilliam | **wired** — Gilliam County (ArcGIS Online org of the shared eastern-Oregon county GIS org (the org that publishes Harney County's layers), 'Gilliam01_TL' layer 6 'Tax Lot Own') | yes | id = `MapTaxlot`; Map-taxlot id, owner (OWNERSHIP), situs; 3,171 lots; edited 2026-08. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Grant | **wired** — Grant County (same shared org, 'Grant01' Grant County Tax Lots) | no | id = `MapTaxlot`; Map-taxlot id + acreage only; no owner column; edited 2023-03. Measured through ArcGIS Online directly: interior hits 5/5 · 3/3 (interior · near-line). |
| Harney | **wired** — Harney County (ArcGIS Online org harneycounty, '02_arcgis_online_Address_and_Tax_Lots' layer 1) | yes | id = `MapTaxlot`; Map-taxlot id, owner, situs; 10,974 lots; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Hood River | **wired** — Hood River County (ArcGIS Online, 'Tax Lot Parcels Public') | yes | id = `MAPTAXLOT`; Map-taxlot id, owner, situs, acreage; 11,890 lots; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Jackson | **wired** — Jackson County (jcportal.jacksoncountyor.gov Property/Taxlots2) | yes | id = `MAPTAXLOT`; Map-taxlot id, owner (FEEOWNER), site address, acreage; 103,578 lots; the county refreshes it weekly. The older Soil & Water District copy on ArcGIS Online (2021) was not used. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Jefferson | **wired** — Oregon Water Resources Department public tax-lot query (scoped county_name='Jefferson') | no | id = `maptaxlot`; Map-taxlot id + acreage; no owner-of-record name. 13,636 lots. Jefferson County's own map host (maps.co.jefferson.or.us) timed out (HTTP 522) on 2026-10-19. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Josephine | **wired** — Josephine County (ArcGIS Online, 'JoCo_Taxlots' layer 63, January 2026 roll) | yes | id = `MAPNUM`; Map number, owner (NAME), situs, legal acreage; 42,029 lots. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Klamath | **wired** — Klamath County GIS (ArcGIS Online org KCGIS, 'KC_Taxlots' layer 1) | yes | id = `MTL`; Map-taxlot id, owner, situs, acreage; 61,227 lots; edited 2026-09. Measured through ArcGIS Online directly: interior hits 5/5 · 3/3 (interior · near-line). |
| Lake | **wired** — Lake County taxlots as hosted by Klamath County GIS (ArcGIS Online 'LakeCoTaxlots') | yes | id = `MapTaxlot`; Map-taxlot id, owner (OwnerLine1), mailing address; last edited 2021-07, so it ages — flagged for the owner; no fresher public Lake layer was found (the state WRD layer carries Lake with no owner name). Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Lane | **wired** — Lane County (lcmaps.lanecounty.org AT/AddressParcelSales layer 2 'Parcels') | yes | id = `MAPTAXLOT`; Map-taxlot id, owner (OWNNAME), acreage; 159,145 parcels. Measured through the relay: interior hits 5/5 · 3/3 (interior · near-line). |
| Lincoln | **wired** — Oregon Water Resources Department public tax-lot query (scoped county_name='Lincoln') | no | id = `maptaxlot`; Map-taxlot id + acreage; no owner-of-record name; 48,794 lots, updated 2026-06. Lincoln County's own maps host has no public REST directory. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Linn | **wired** — Linn County (gis.co.linn.or.us AssessmentTax/pub_taxlots_web) | no | id = `PIN`; PIN + acreage; the public layer carries no owner; 54,598 lots; edited 2026-10. Measured through the relay: interior hits 5/5 · 4/4 (interior · near-line). |
| Malheur | **wired** — Malheur County (ArcGIS Online, shared eastern-Oregon county GIS org (the org that publishes Harney County's layers), 'Malheur01TL') | yes | id = `MapTaxlot`; Map-taxlot id, owner, address; 22,444 lots; last edited 2024-07. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Marion | **wired** — Marion County (ArcGIS Online org Marion_County, 'Parcels') | yes | id = `TAXLOT`; Taxlot id, owner (OWNERNAME), situs, acreage; 115,870 parcels; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Morrow | **wired** — Morrow County (ArcGIS Online, '2026_10_16_Assessment_Taxlot_Merge') | yes | id = `MAPTAXLOT`; Map-taxlot id, owner (OWNER1), situs, acreage; 10,257 lots; edited the day it was published. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Tillamook | **wired** — Tillamook County (ArcGIS Online org, 'Taxlots') | no | id = `MapTaxlot`; Map-taxlot id + acreage; the layer holds owner mailing address but no owner name; 31,358 lots; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 3/3 (interior · near-line). |
| Umatilla | **wired** — Umatilla County tax lots as published by the City of Pendleton (ArcGIS Online 'Tax Lot Map') | yes | id = `map_tax`; Map-tax id, owner (MAILING_NAME), acreage; 44,595 lots; edited 2026-06. Publisher is the city, not the county — flagged for the owner. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Union | **wired** — Union County tax maps (ArcGIS Online, shared eastern-Oregon county GIS org (the org that publishes Harney County's layers), 'Union01TaxMaps') | no | id = `MapTaxlot`; Map-taxlot id + acreage; no owner column; last edited 2022-09 — flagged for the owner. TRAP avoided: the county's 'Union County Parcel Viewer' app on ArcGIS Online is Union County, NEW MEXICO. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Wasco | **wired** — Wasco County (public.co.wasco.or.us gisserver Taxlots) | yes | id = `MapTaxlot`; Map-taxlot id, owner (Taxpayer), acreage; 15,516 lots. Points on federal/tribal land return no lot (4 of 9 test points hit), the layer being the taxed roll. Measured through the relay: interior hits 2/5 · 2/4 (interior · near-line). |
| Washington | **wired** — Washington County (gispub.co.washington.or.us Washington_County_Taxlots) | no | id = `TLNO`; Taxlot id (TLNO) only; the public service carries no owner; 200,948 lots. Measured through the relay: interior hits 4/5 · 4/4 (interior · near-line). |
| Wheeler | **wired** — Wheeler County (ArcGIS Online, shared eastern-Oregon county GIS org (the org that publishes Harney County's layers), 'Wheeler01_TL') | yes | id = `MAPTAXLOT`; Map-taxlot id, owner, acreage; 2,675 lots; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Yamhill | **wired** — Yamhill County Assessment & Taxation (ArcGIS Online, 'AT Taxlots' layer 1) | yes | id = `maptaxlot`; Map-taxlot id, owner (owner1), situs, acreage; 51,339 lots; edited 2026-10. Measured through ArcGIS Online directly: interior hits 5/5 · 4/4 (interior · near-line). |
| Multnomah | wired earlier (B1455633) | yes | `or_multnomah`, hand-written row |
| Clackamas | wired earlier (B1455633) | no | `or_clackamas`, hand-written row |
| Polk | **gap — named** | — | The county's own `maps.co.polk.or.us/gis/rest/services/Assessor/Taxlots/MapServer` (found by search) answers an ArcGIS **Web Adaptor "Application Error"** (HTTP 500) on every path through the relay on 2026-10-19 — the front door is up, the server behind it is not. The ArcGIS Online "Taxlots" under the Polk account's org is **Lake County's** (its extent and `LakeCounty` layer say so) — a same-name trap, not wired. The state WRD layer does not carry Polk; ODF's has no Query. Retried at the end of the session: still down. **Stopping rule:** re-probe `maps.co.polk.or.us` (re-add it to the relay allow-list) and wire it the day the server answers. |
| Sherman | **gap — named** | — | Re-searched 2026-10-19: ArcGIS Online org + title + extent crawl, the state list's viewer links (the county's page sends visitors to the state ORMAP viewer), web search. No county REST. DOR's taxlot delivery itself omits Sherman (and Douglas, Malheur, Wallowa, Washington — those four are wired from their own servers). ODF has a Sherman layer with no Query. |
| Wallowa | **gap — named** | — | The county's only public layer is `Taxlots_Public` in the apgis_wallowacounty ArcGIS Online org: polygons carrying **one column, the bare lot number** (`Taxlot` = "100", "400" … not unique across maps), so it cannot answer with a parcel ID and is not wired. No county REST directory found; not in the WRD layer; ODF has no Query. |

**Needs the owner (not a build).** Polk (server down), Sherman and Wallowa (no usable public layer). Stale or non-county publishers, kept because nothing fresher is public: Lake (Klamath County GIS's 2021 copy), Grant and Union (2023 / 2022, no owner), Umatilla (published by the City of Pendleton), Coos (University of Oregon's March 2024 copy of the roll), Malheur (2024). Counties with no owner column: Baker, Columbia, Deschutes, Grant, Linn, Tillamook, Union, Washington, Curry, Jefferson, Lincoln.

## Oklahoma counties (2026-10-19) — 16 of 77 wired (NEW-1)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* — this section is Oklahoma only. **Oklahoma has no free statewide parcel service:** the state's mosaic (Property Records Preservation LLC for the Office of Geographic Information) is view/WMS-only; okmaps.onenet.net answered 404 through the relay; the NSGIC portal and ArcGIS Hub list none. The 2026-09-09 probe row ("none found") was run from an egress-limited sandbox before pass 2; its statewide finding stands, its implication for the counties does not.

**How it was searched.** (1) ArcGIS Online item search, bbox-filtered to Oklahoma, ~1,470 items (Feature/Map services, web maps, apps, dashboards) over parcel/assessor/tax/ownership/cadastral keywords, then **every polygon layer of 1,041 Oklahoma-extent services probed** (extent mapped to a county by centroid against the repo's own county polygons, owner/parcel-id column check); (2) per-county AGOL searches by county name, title + extent; (3) the assessor-contact layer `County_Assessors` (20 counties' own assessor links) and web search for each county's viewer; (4) the county servers found (gis.okco14.org, map8/map9.incog.org, asps0305.tulsacounty.org, gis.clevelandcountyassessor.us, okmaps.onenet.net, mapview-online.com) read through the `/gis-proxy` relay on this PR's preview. Only gis.okco14.org answered (Cleveland County's parcel fabric — attributes carry no owner/account, so the AGOL ownership layer stays); the INCOG, Tulsa County and Cleveland assessor hosts returned 520/525/530 (their servers refuse the relay) and the rest 404. Each wired row: 5 interior + 4 county-line point queries, polygons with a parcel id required, layer extent inside Oklahoma.

**Dated copy flagged:** Garfield's only layer (`Parcel_Import`, owner org `Garfieldok`) was last edited **2015** — geometry and parcel ids are usable, owner names are as of then. Creek has no situs column (`address2` is the owner's MAILING line, deliberately not used). Tulsa and Oklahoma counties keep their hand-written rows.

**Viewer vendors seen but not readable (leads, not gaps proven):** MapView Online (`mapview-online.com/<County>`; Caddo, Washington's listing; `mapview-adair.com`), Spatialest (`property.spatialest.com/ok/<county>`; Canadian, Cleveland, McClain, Payne, Wagoner — all already wired from AGOL), ACT Datascout, `oktaxrolls.com` (tax roll, no map: Bryan, Cherokee), `okcountyassessors.org` subdomains (Grady: a static image). None exposed an ArcGIS REST endpoint we could reach; if one is found it is a build item (see the backlog item filed with this section).

### Wired counties

| County | Source | Parcel-id field | Owner | Address | Measured (hits / 9 · beside line) |
|---|---|---|---|---|---|
| Beckham County | ArcGIS Online (`services7.arcgis.com`) | `account` | yes | `situs` | 9/9 · 4/4 |
| Canadian County | ArcGIS Online (`services2.arcgis.com`) | `account` | yes | `situs` | 9/9 · 4/4 |
| Cleveland County | ArcGIS Online (`services.arcgis.com`) | `ACCOUNT` | yes | `LOCATIONADDRESS` | 8/9 · 3/4 |
| Comanche County | ArcGIS Online (`services6.arcgis.com`) | `ACCOUNT` | yes | — | 9/9 · 4/4 |
| Creek County | ArcGIS Online (`services7.arcgis.com`) | `account` | yes | — | 8/9 · 3/4 |
| Garfield County | ArcGIS Online (`services6.arcgis.com`) | `PARCEL_1` | yes | — | 9/9 · 4/4 |
| McClain County | ArcGIS Online (`services8.arcgis.com`) | `account` | yes | `situs` | 6/9 · 1/4 |
| Muskogee County | ArcGIS Online (`services.arcgis.com`) | `ParcelId` | yes | — | 8/9 · 3/4 |
| Ottawa County | ArcGIS Online (`services8.arcgis.com`) | `account` | yes | — | 8/9 · 3/4 |
| Payne County | ArcGIS Online (`services.arcgis.com`) | `ParcelID` | yes | `Situs` | 6/9 · 2/4 |
| Pittsburg County | ArcGIS Online (`services3.arcgis.com`) | `ParcelId` | yes | — | 8/9 · 3/4 |
| Rogers County | ArcGIS Online (`services6.arcgis.com`) | `ACCOUNT` | yes | `SITUS` | 7/9 · 2/4 |
| Wagoner County | ArcGIS Online (`services6.arcgis.com`) | `ACCOUNT` | yes | `SITUS` | 7/9 · 2/4 |
| Washington County | ArcGIS Online (`services7.arcgis.com`) | `PARCEL_ID` | yes | — | 8/9 · 3/4 |
| Oklahoma County | hand-written `ok_oklahoma` (assessor, Esri-hosted) | `accountno` | yes | `location` | re-verified 2026-09-10 |
| Tulsa County | hand-written `ok_tulsa` (Tulsa County Assessor) | `PARCEL_ID` | — | — | unchanged |

### Gaps (61) — each named in the app as "<County> — no parcel data wired here yet", with the re-searched reason

| County | Kind | Why / what was searched |
|---|---|---|
| Adair County | partial-coverage | The only Adair parcel layer on ArcGIS Online (sfrank_TB 'Adair County Parcel Data', layer 12 AdairCo_SelectParcelData) covers a ~0.1-degree patch around Stilwell and returned nothing at any of 9 county-wide test points; the assessor's own viewer (mapview-adair.com, a MapView Online site per the Oklahoma 811 county-assessor list) is not an ArcGIS REST service we can read, and its host is not reachable from the build sandbox. |
| Alfalfa County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Atoka County | partial-coverage | The only Atoka parcel layer found (City of Atoka's 'County_Parcels_2019_view') covers a ~0.2-degree patch around the town and returned nothing at 9 county-wide test points; the county's online tool is a treasurer tax-roll search (okcountytreasurers.com/atoka), not a map. |
| Beaver County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Blaine County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Bryan County | tax-roll-only | Bryan's assessor publishes only the oktaxrolls.com tax-roll search (no map); no Bryan parcel layer exists on ArcGIS Online or ArcGIS Hub. |
| Caddo County | viewer-no-rest | Caddo's assessor points at a MapView Online viewer (mapview-online.com/Caddo) plus ACT Datascout; neither exposes an ArcGIS REST layer we could find (the relay returned 404 for the path), and no Caddo parcel service exists on ArcGIS Online (only a Wichita-Caddo allotment layer). |
| Carter County | no-public-service | Carter's assessor page (cartercountyok.us/departments/assessor.php) links no map; no Carter parcel layer exists on ArcGIS Online (the only hits are a Noble Foundation property layer and a Norman layer clipped to Cleveland). |
| Cherokee County | tax-roll-only | Cherokee's assessor link is the oktaxrolls.com tax-roll search (no map); the only Cherokee-area ArcGIS Online layer is a single-road acquisition (Fritz Rd), not a parcel fabric. |
| Choctaw County | no-public-service | The Choctaw County assessor publishes only a Facebook page; no parcel layer exists on ArcGIS Online, ArcGIS Hub or the NSGIC portal. |
| Cimarron County | viewer-no-rest | Cimarron's assessor is listed only on a Facebook page and the countyservice.net mobile portal (a tax-roll lookup, not a map); no ArcGIS Online parcel layer exists. |
| Coal County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Cotton County | no-public-service | The Cotton County assessor publishes only a Facebook page; no parcel layer exists on ArcGIS Online, ArcGIS Hub or the NSGIC portal. |
| Craig County | no-public-service | The Craig County assessor publishes only a Facebook page; no parcel layer exists on ArcGIS Online, ArcGIS Hub or the NSGIC portal. |
| Custer County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Delaware County | partial-coverage | The Delaware County assessor's free GIS map is described as a work in progress with alignment issues; the one ArcGIS Online layer (DELAWARE CO PARCELS 2017, inside a utility map) is a 2017 dated working copy and has no polygon layer in the service, so it is not wired. |
| Dewey County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Ellis County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Garvin County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Grady County | viewer-no-rest | Grady's assessor GIS page (grady.okcountyassessors.org) serves a static map image, not a queryable layer; the only large Grady-area parcel layers on ArcGIS Online are Oklahoma City's tri-county 2021 set (a Q4-2021 working copy, not published by Grady and not current). |
| Grant County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Greer County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Harmon County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Harper County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Haskell County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Hughes County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Jackson County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Jefferson County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Johnston County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Kay County | no-public-service | Kay's only assessor listing found is a subscription records service; ArcGIS Online holds only a Ponca City lake-lots layer and a commercial property list, no countywide parcel fabric. |
| Kingfisher County | partial-coverage | Kingfisher has only City-of-Kingfisher parcel layers on ArcGIS Online (a ~0.3-degree patch, zero hits at county-wide test points); no countywide assessor layer was found. |
| Kiowa County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Latimer County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Le Flore County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Lincoln County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Logan County | no-public-service | Logan's only online tool found is a treasurer property-tax search; no Logan parcel layer exists on ArcGIS Online. |
| Love County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Major County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Marshall County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Mayes County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| McCurtain County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| McIntosh County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Murray County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Noble County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Nowata County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Okfuskee County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Okmulgee County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Osage County | no-public-service | Osage's assessor GIS viewer is a legacy-certificate site not reachable from the relay; the only Osage ArcGIS Online layer is a 1930s WPA land-ownership map, which is historical, not current parcels. |
| Pawnee County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Pontotoc County | no-public-service | Pontotoc's only online tool found is a treasurer property-tax search; Ada's city server (maps.adaok.com) publishes city data only, no countywide parcel layer. |
| Pottawatomie County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Pushmataha County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Roger Mills County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Seminole County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Sequoyah County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Stephens County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Texas County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Tillman County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Washita County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Woods County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |
| Woodward County | none-found | Searched 2026-10-19: no countywide parcel layer exists on ArcGIS Online (about 1,470 Oklahoma-extent items were title/extent searched and 1,041 services had every polygon layer probed), ArcGIS Hub, or the NSGIC portal, and web search found no county-published REST viewer; the county's assessor runs a tax-roll or vendor viewer that is not a queryable ArcGIS REST layer we can read. |

## New Mexico counties (2026-10-19) — 33 of 33 wired (B2345888)

B2345888, owner request "start wiring all the remaining states into Planner". **All 33 counties wired**: Bernalillo (pre-existing) + 9 on their own county layers (`lib/nmParcels.js`, ArcGIS Online, edited 2026) + 23 on the **Office of the State Engineer's `County_Parcels_2025` MapServer** (one layer per county, one schema: `UPC`, `AccountNumber`, `Owner1`, `SitusAddress1`; data is tax year 2024). **Five of those 23 are PARTIAL (towns and villages only)** — see below; they are wired because town lots are what a site search mostly needs, and their help text says so, but rural lots there have no source.

**The 2026-09-09 "no-free-source" verdict was wrong and is retracted.** It ran before pass 2 and before the relay. The state source exists: ArcGIS Online's "Parcels - NM - <County>" catalog (a state GIS admin account, 2021 items) pointed at `gis.ose.state.nm.us/…/County_Parcels_2021`, **whose host no longer resolves (Cloudflare 1016)**; the live successor is `gis.ose.nm.gov/server_s/rest/services/Parcels/County_Parcels_2025/MapServer` (found by listing the new host's `Parcels` folder through the relay; the `County_Parcels_2021` service there now demands a token). 33 layers, indexed alphabetically (0 Bernalillo … 32 Valencia, Doña Ana = 7).

**How it was searched.** (1) ArcGIS Online item search (NM bbox, parcel/assessor/tax words, per-county names), the state's "Parcels - NM" catalog, the Sidwell/Magnasoft county-viewer orgs, every county web app / web map config read for its real layer URLs (Eddy, Valencia, Catron, Cibola); (2) the OSE host listed through `/gis-proxy` once PR #2396 allowed it (the sandbox reaches only `*.arcgis.com`); (3) web search for the gap counties. Rejected on measurement: the 2021 catalog's county URLs (dead hosts, private items); `kspore`'s county copies (a land broker's private items, token-required); Harding's AGOL `Parcel_HardingNM` (no owner/UPC, the State layer covers every sampled lot of it); Mora's `Mora_County` layer 8 (an NRCS project polygon set, no ids, wrong county edges); Quay's Sidwell pilot (`Quay_UPC_2019`, **points**, not polygons); Catron's 2022 `Tax_Parcels_Polygon` (superseded by the 2024 layer).

**Measurement (every wired row).** Through the production relay or direct: 5–6 lots sampled evenly across the layer, each interior point inside the named county (county-polygon asset) and each re-found by a point query returning its id; a 30-point lattice inside each county compared against the second source where one exists (the check that caught Catron: the State layer scored **0 of 30** where the county layer scored 27, because it holds town lots only); up to 3 real parcels within ~400 m of each county line re-found by point query with an id. Measurement scripts are summarised in `nmProvenance.js`; the red-proof is `test/newMexicoCounties.test.js` (67 cases fail on main).

**Traps seen.** (a) A statewide-schema layer that covers one slice of a county: five OSE layers (De Baca, Guadalupe, Mora, Quay, Union) and Catron's have **zero parcels over 40 acres** — ranch land is simply absent. (b) The OSE service says "2025" but its `TaxYear` is 2024; every wired county layer is newer where one exists. (c) `UPC` is blank (or `0000000000000`) on public-land and unmatched rows in some counties (Lea, San Miguel, Torrance, Harding, Socorro 70%), so the OSE rows pin `AccountNumber`, which is filled almost everywhere. (d) A dead host that the 2021 catalog still advertises. (e) Doña Ana's key is `nm_doaana`.

| County | Key | Source | Owner | Notes |
|---|---|---|---|---|
| Bernalillo | `nm_bernalillo` | AGOL berncoparcels_forIDO (City of Albuquerque GIS org) | yes | pre-existing hand-wired row (2026-09-11), unchanged; State layer agrees (29/30 vs 28/30) |
| Catron | `nm_catron` | AGOL Tax_Parcel_Polygon20241007 (county org, edited 2026-10-16) | yes (agency name on public land) | 17,879 polys; 27/30 lattice vs **0/30** for the State layer (town lots only). UPC only on assessed private lots |
| Chaves | `nm_chaves` | AGOL Parcels/90 'Sept042026Parcels' (county org, edited 2026-10-14) | yes | 36,033; id Master_UPC; 29/30 = State |
| Cibola | `nm_cibola` | AGOL ParcelPoly_CibolaNM (county vendor org, tax yr 2026) | yes | 22,823; 29/30 = State |
| Colfax | `nm_colfax` | AGOL Parcel_Colfax 'Parcel_May26' (county vendor org, 2026-05-25) | yes | 24,766; 30/30 = State; UPC blank on road polys |
| Curry | `nm_curry` | OSE County_Parcels_2025 layer 5 (relay, gis.ose.nm.gov) | yes | 26,067; 28/30 lattice |
| De Baca | `nm_debaca` | OSE County_Parcels_2025 layer 6 (relay, gis.ose.nm.gov) | yes | 1,638; 0/30 lattice — **PARTIAL: town/subdivision lots only** (0 parcels >40 ac) |
| Doña Ana | `nm_doaana` | AGOL DAC_Parcels (assessor org, edited 2026-09-30) | yes | 96,348; key `nm_doaana` (countyKeyForName drops the ñ) |
| Eddy | `nm_eddy` | AGOL Parcel_Eddy (county vendor org, 2026-08-25) | yes | 53,962; no situs (SITUS holds a mailing line) |
| Grant | `nm_grant` | AGOL Grant_County_Interactive_Parcel_Map (county org, 2026-10-19) | yes | 44,621; id GISAccount; no situs |
| Guadalupe | `nm_guadalupe` | OSE County_Parcels_2025 layer 10 (relay, gis.ose.nm.gov) | yes | 3,800; 0/30 lattice — **PARTIAL: town/subdivision lots only** (0 parcels >40 ac) |
| Harding | `nm_harding` | OSE County_Parcels_2025 layer 11 (relay, gis.ose.nm.gov) | yes | 1,074; 30/30 lattice |
| Hidalgo | `nm_hidalgo` | OSE County_Parcels_2025 layer 12 (relay, gis.ose.nm.gov) | yes | 5,210; 29/30 lattice |
| Lea | `nm_lea` | OSE County_Parcels_2025 layer 13 (relay, gis.ose.nm.gov) | yes | 32,096; 30/30 lattice |
| Lincoln | `nm_lincoln` | OSE County_Parcels_2025 layer 14 (relay, gis.ose.nm.gov) | yes | 38,607; 30/30 lattice |
| Los Alamos | `nm_losalamos` | OSE County_Parcels_2025 layer 15 (relay, gis.ose.nm.gov) | yes | 8,552; 28/30 lattice |
| Luna | `nm_luna` | OSE County_Parcels_2025 layer 16 (relay, gis.ose.nm.gov) | ~half (51%) | 115,161; 11/30 lattice; no situs |
| McKinley | `nm_mckinley` | OSE County_Parcels_2025 layer 17 (relay, gis.ose.nm.gov) | yes | 12,945; 16/30 lattice |
| Mora | `nm_mora` | OSE County_Parcels_2025 layer 18 (relay, gis.ose.nm.gov) | yes | 7,471; 0/30 lattice — **PARTIAL: town/subdivision lots only** (0 parcels >40 ac) |
| Otero | `nm_otero` | AGOL Parcel_OteroNM (county org, tax yr 2025) | yes (`GIS_Owner1`, added to appraisal.js's fallback owner spellings) | 50,729; 29/30 = State |
| Quay | `nm_quay` | OSE County_Parcels_2025 layer 20 (relay, gis.ose.nm.gov) | yes | 14,518; 0/30 lattice — **PARTIAL: town/subdivision lots only** (0 parcels >40 ac) |
| Rio Arriba | `nm_rioarriba` | AGOL RAC_Parcels_2026 (assessor org, 2026-10-13) | yes | 35,031; State layer missed 2 of 12 lattice hits the county layer has |
| Roosevelt | `nm_roosevelt` | OSE County_Parcels_2025 layer 22 (relay, gis.ose.nm.gov) | yes | 14,580; 30/30 lattice |
| San Juan | `nm_sanjuan` | OSE County_Parcels_2025 layer 24 (relay, gis.ose.nm.gov) | yes | 44,690; 30/30 lattice |
| San Miguel | `nm_sanmiguel` | OSE County_Parcels_2025 layer 25 (relay, gis.ose.nm.gov) | yes | 29,545; 28/30 lattice |
| Sandoval | `nm_sandoval` | OSE County_Parcels_2025 layer 23 (relay, gis.ose.nm.gov) | yes | 149,777; 28/30 lattice |
| Santa Fe | `nm_santafe` | OSE County_Parcels_2025 layer 26 (relay, gis.ose.nm.gov) | yes | 87,313; 28/30 lattice |
| Sierra | `nm_sierra` | OSE County_Parcels_2025 layer 27 (relay, gis.ose.nm.gov) | yes | 12,178; 30/30 lattice |
| Socorro | `nm_socorro` | OSE County_Parcels_2025 layer 28 (relay, gis.ose.nm.gov) | yes | 36,101; 4/30 lattice; id = AccountNumber (UPC blank 70%) |
| Taos | `nm_taos` | OSE County_Parcels_2025 layer 29 (relay, gis.ose.nm.gov) | yes | 61,148; 30/30 lattice |
| Torrance | `nm_torrance` | OSE County_Parcels_2025 layer 30 (relay, gis.ose.nm.gov) | yes | 29,043; 29/30 lattice |
| Union | `nm_union` | OSE County_Parcels_2025 layer 31 (relay, gis.ose.nm.gov) | yes | 2,962; 0/30 lattice — **PARTIAL: town/subdivision lots only** (0 parcels >40 ac) |
| Valencia | `nm_valencia` | OSE County_Parcels_2025 layer 32 (relay, gis.ose.nm.gov) | yes | 199,659; 25/30 lattice |

**Partial counties (the honest gaps).** De Baca, Guadalupe, Mora, Quay, Union: the State layer has the towns (Fort Sumner, Santa Rosa, Mora, Tucumcari, Clayton: 400–2,000 parcels in a ~2 km box at each seat) and no rural lots. Searched for a rural source: ArcGIS Online (county names × parcel/assessor/tax/lots, the Sidwell and Magnasoft orgs, NM bbox sweep), the counties' own viewers, web search (the Quay "Parcel Pilot" is point data; the only other hits were commercial sellers). Not found. Next places to look: each county assessor's own server (Tyler EagleWeb sites list parcel numbers but no geometry), RGIS (rgis.unm.edu, downloads not services), and an owner ask to the assessors. **Stopping rule:** each closes when a rural polygon layer is wired or the assessor confirms none exists. Socorro (4/30 lattice) and McKinley (16/30) look sparse because most of the land is public/tribal, not because the layer is truncated (1,122 and 1,037 parcels over 40 acres respectively).

## Pennsylvania counties (2026-10-19) — 67 of 67 wired (NEW-1; Armstrong added 2026-10-20, B2386480)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* — this section is Pennsylvania only (sibling sessions took the other states). The 2026-09-09 probe row for Pennsylvania ("no-free-source / none found") was run from an egress-limited sandbox, before pass 2 and before the relay existed, and the 2026-09-08 note below it ("PASDA's service directory carries 170 services and EXACTLY ONE parcel service, ErieCountyParcels") was **wrong** — it counted the directory's top level. Read through the relay on 2026-10-19, `mapservices.pasda.psu.edu/server/rest/services/pasda` lists **one MapServer per county for ~45 counties, ~36 of them with a parcel layer** (each the county's own layer, submitted to PASDA and refreshed monthly — Adams `202610`, Allegheny `20261012`, Lancaster `202609`…). There is still **no statewide parcel service with owners**: PASDA's statewide `PA_Parcels` mosaic (`apps.pasda.psu.edu`) is the same county layers (PIN + source + date, no owner, 36 of 67 counties), and the PA DEP `gis.dep.pa.gov/.../Parcels/PA_Parcels` layer is "a PA Parcel partial dataset for WorldView and PracticeKeeper project" (its own words) — real county polygons with owner and address for 38 counties, of unknown vintage, 502s now and then under load, `COUNTY_NAME` spelled four ways (and `Wyoming County` rows labelled `Washington`), and one county (Clarion) with no parcel id on 7 of 8 rows. It is therefore used only as the **last resort for four counties** with nothing better (Clearfield, Elk, Northumberland, Westmoreland), scoped per county, and says so in its provenance.

Routes tried for every county: (1) statewide / multi-county — PASDA (per-county + statewide), PA DEP, the NSGIC parcel portal, ArcGIS Hub, regional planning commissions; (2) the two ArcGIS Online county-parcel registries (`PA_AgMaps_Admin`, `GDITAdmin`) that list one service per county; (3) the county's own server and its **viewer's own web-map / app config** (that is how Clarion's, McKean's and Huntingdon's current layers were found — the registries' URLs for those had moved or died: Beaver `gis.mbakerintl.com` "service not started", Delaware `dcgis.co.delaware.pa.us`, Clarion `gis.co.clarion.pa.us` no longer resolves, Franklin `gis.franklincountypa.gov` unreachable, McKean `gismaps.mckeancountypa.org` timing out); (4) ArcGIS Online item search by county (crawled ~3,000 Pennsylvania-area items). The sandbox reaches only `*.arcgis.com`; every other host was MEASURED through the production-shaped relay (`/gis-proxy`, on this PR's Cloudflare preview) with point queries at **5 spread points inside each county plus 4 beside its county line** (centre + 4 spread, 4 line), requiring polygons with a parcel id in the declared column and a layer extent inside Pennsylvania. Traps hit and avoided: **same-named counties in other states** (a Utah "Clearfield County" parcel service answered a Clearfield PA search; Armstrong/Beaver/Carbon/Wayne/Delaware/Jefferson all have out-of-state namesakes — every layer was checked against the Pennsylvania extent); **ArcGIS Online copies that went private** (the whole `wharcgisdeveloper` "<County> County PA Parcels" family and two consultants' copies now answer `Token Required` — not a source); **dated working copies** (Susquehanna's `Parcel_OLD`, Greene's June-2023 layer without owners — newer/owner-bearing sibling layers used instead); and a **Franklin PASDA layer that answers 502 on every query** (the county's own `fcgis.franklincountypa.gov` is wired instead).

| County | Source | Parcel-id field | Owner | Address | Measured (polygons with an id at 9 points · of the 4 beside the county line) |
|---|---|---|---|---|---|
| Adams County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `Parcel_ID` | yes | `COMBINED_S` | 8/9 · 3/4 |
| Beaver County | county's own server (`gis.beavercountypa.gov`) | `Parcel_ID` | yes | `Location_Street` | 8/9 · 4/4 |
| Bedford County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `Name` | yes | — | 9/9 · 4/4 |
| Berks County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | yes | `FULLSITEAD` | 8/9 · 3/4 |
| Blair County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PAR_NUM` | no | — | 8/9 · 4/4 |
| Bradford County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `ParcelJoin` | yes | — | 7/9 · 4/4 |
| Bucks County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCEL_NUM` | yes | `ADDRESS` | 7/9 · 2/4 |
| Butler County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | yes | — | 9/9 · 4/4 |
| Cambria County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCELID` | no | — | 7/9 · 2/4 |
| Cameron County | ArcGIS Online (`services5.arcgis.com`) | `PIN` | yes | — | 9/9 · 4/4 |
| Carbon County | county's own server (`gis.carboncounty.com`) | `ParcelID` | yes | `Location` | 9/9 · 4/4 |
| Centre County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `TAXIDNUM` | no | `LOCATION` | 9/9 · 4/4 |
| Chester County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `UPI` | yes | `LOC_ADDRES` | 8/9 · 3/4 |
| Clarion County | ArcGIS Online (`services1.arcgis.com`) | `Map_Number` | yes | `Situs_Address` | 8/9 · 3/4 |
| Clearfield County | PA DEP `PA_Parcels` (partial compilation — fallback) (`gis.dep.pa.gov`) | `PARCEL_ID` | yes | `PROPERTY_ADDRESS_1` | 9/9 · 4/4 |
| Clinton County | county's own server (`maps.clintoncountypa.gov`) | `PARCEL_ID` | yes | `ADDRESS` | 9/9 · 4/4 |
| Columbia County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | no | — | 9/9 · 4/4 |
| Crawford County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `CAMA_PIN` | no | — | 9/9 · 4/4 |
| Dauphin County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PID` | yes | — | 7/9 · 2/4 |
| Delaware County | county's own server (`gis.delcopa.gov`) | `PIN` | no | — | 7/9 · 2/4 |
| Elk County | PA DEP `PA_Parcels` (partial compilation — fallback) (`gis.dep.pa.gov`) | `PARCEL_ID` | no | `PROPERTY_ADDRESS_1` | 7/9 · 3/4 |
| Erie County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `TaxPin` | no | `FullStreet` | 8/9 · 4/4 |
| Fayette County | ArcGIS Online (`services5.arcgis.com`) | `taxidnum` | yes | — | 7/9 · 3/4 |
| Forest County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCEL` | yes | — | 9/9 · 4/4 |
| Franklin County | county's own server (`fcgis.franklincountypa.gov`) | `Name` | yes | `FULL_SITUS_ADDR` | 8/9 · 4/4 |
| Fulton County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | no | — | 8/9 · 3/4 |
| Greene County | ArcGIS Online (`services7.arcgis.com`) | `Tax_ID_Num` | yes | — | 8/9 · 3/4 |
| Huntingdon County | ArcGIS Online (`services3.arcgis.com`) | `TAXIDNUM` | yes | `Property_A` | 8/9 · 3/4 |
| Indiana County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCEL_ID` | yes | — | 7/9 · 2/4 |
| Jefferson County | ArcGIS Online (`services1.arcgis.com`) | `ParcelId` | yes | — | 8/9 · 3/4 |
| Juniata County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCELID` | yes | — | 9/9 · 4/4 |
| Lancaster County | county's own server (`arcgis.lancastercountypa.gov`) | `ACCOUNT` | yes | — | 8/9 · 3/4 |
| Lawrence County | county's own server (`gis.leoc.net:6443`) | `TID` | yes | `SITUS` | 7/9 · 3/4 |
| Lebanon County | ArcGIS Online (`utility.arcgis.com`) | `MAP_NUMBER` | yes | `SITUS_ADDR` | 9/9 · 4/4 |
| Lycoming County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCEL` | no | `SITUS` | 9/9 · 4/4 |
| McKean County | county's own server (`gis.mckeancountypa.gov`) | `pin` | no | — | 9/9 · 4/4 |
| Mercer County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `Parcel_Id` | yes | `Situs_Desc` | 9/9 · 4/4 |
| Mifflin County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `ACCOUNT` | no | — | 8/9 · 3/4 |
| Monroe County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `MAPNUMBER` | no | — | 9/9 · 4/4 |
| Montgomery County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PARCEL` | yes | — | 8/9 · 4/4 |
| Montour County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | no | — | 9/9 · 4/4 |
| Northumberland County | PA DEP `PA_Parcels` (partial compilation — fallback) (`gis.dep.pa.gov`) | `PARCEL_ID` | yes | `PROPERTY_ADDRESS_1` | 6/9 · 2/4 |
| Perry County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | no | — | 8/9 · 3/4 |
| Philadelphia County | ArcGIS Online (`services.arcgis.com`) | `parcel_id` | yes | `address` | 6/9 · 3/4 |
| Pike County | county's own server (`gis.pikepa.org`) | `MAP_JOIN` | yes | `Situs` | 9/9 · 4/4 |
| Potter County | county's own server (`maps.pottercountypa.net`) | `Map_Number` | yes | — | 9/9 · 4/4 |
| Schuylkill County | county's own server (`services.co.schuylkill.pa.us`) | `PARCEL_NUMBER` | yes | — | 8/9 · 3/4 |
| Snyder County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | no | — | 9/9 · 4/4 |
| Somerset County | ArcGIS Online (`services7.arcgis.com`) | `MAPNUM` | yes | `LOCAT` | 9/9 · 4/4 |
| Sullivan County | ArcGIS Online (`services.arcgis.com`) | `PARCEL_ID` | no | — | 8/9 · 4/4 |
| Susquehanna County | ArcGIS Online (`services5.arcgis.com`) | `PIN` | yes | `SITUS_COMBINED` | 8/9 · 3/4 |
| Tioga County | county's own server (`tiogagis.tiogacountypa.us`) | `PARCELID` | no | `LOCATION` | 9/9 · 4/4 |
| Union County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `Name` | no | — | 9/9 · 4/4 |
| Venango County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `ParcelNumb` | no | `Situs` | 8/9 · 3/4 |
| Warren County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | no | — | 9/9 · 4/4 |
| Washington County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIN` | yes | — | 9/9 · 4/4 |
| Wayne County | ArcGIS Online (`services1.arcgis.com`) | `TAXMAPNO_1` | yes | `Address` | 9/9 · 4/4 |
| Westmoreland County | PA DEP `PA_Parcels` (partial compilation — fallback) (`gis.dep.pa.gov`) | `PARCEL_ID` | yes | `PROPERTY_ADDRESS_1` | 8/9 · 4/4 |
| Wyoming County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `Pin` | yes | — | 9/9 · 4/4 |
| York County | PASDA (county-submitted layer) (`mapservices.pasda.psu.edu`) | `PIDN` | yes | `PROPADR` | 8/9 · 3/4 |
| Allegheny County | county GIS — hand-wired 2026-09 (`pa_allegheny`) | — | — | — | unchanged |
| Cumberland County | county GIS — hand-wired 2026-09 (`pa_cumberland`) | — | — | — | unchanged |
| Lackawanna County | county GIS — hand-wired 2026-09 (`pa_lackawanna`) | — | — | — | unchanged |
| Lehigh County | county GIS — hand-wired 2026-09 (`pa_lehigh`) | — | — | — | unchanged |
| Luzerne County | county GIS — hand-wired 2026-09 (`pa_luzerne`) | — | — | — | unchanged |
| Northampton County | county GIS — hand-wired 2026-09 (`pa_northampton`) | — | — | — | unchanged |

Owner **no** means the published layer carries no owner column (geometry + parcel id, sometimes acreage only — the county's tax/owner table is not on the public layer); it is the source's fact, not a gap, and the card says so honestly. Philadelphia is one consolidated city-county (`pa_philadelphia`, the City's `PWD_PARCELS`, which carries owner and address). Susquehanna and Dauphin split the owner across two columns (last / first name); Susquehanna's new `Parcels_CAMA` layer has the whole name in `COMBINED_NAME`.

### Pennsylvania gaps — none left; Armstrong was wired 2026-10-20 (B2386480), and the earlier "no source" finding was WRONG

The 2026-10-19/20 pass (B2373200) left Armstrong as a named gap, reasoning that the county's own Mapping page says it has no public GIS viewer and that its only ArcGIS Online Armstrong layers (`Kiski_Parcels`, a consultant's copy) answered `Token Required`. **That was a failed search read as a null.** Reviewed adversarially on the owner's request the next day, it turned up a public service the first pass had probed and discarded by mistake:

- **Source:** ArcGIS Online item "Armstrong County Parcels", account `tzink_lsse`, public — `https://services5.arcgis.com/beeAx3XQCWXfcm0Q/arcgis/rest/services/Armstrong_County_Parcels/FeatureServer`. It is **not published by the county**; provenance says so (`third-party`).
- **Why it was missed:** **the parcel layer is LAYER 8 ("Armstrong Parcels"), not layer 0.** Querying `/0` answers `400 Invalid URL`, which reads as "service dead / private". The service root answers with no token and lists the layers.
- **Shape:** polygons, 40,709 of them, last edited about 2026-09-30 (current). Fields `FID`, `PARCELNUM`, `ACREAGE` (a STRING — parse it), `Shape__Area`, `Shape__Length`; **no owner, no address** (the card already says "owner not published"). Row: `idField PARCELNUM`, no address field.
- **Measured live 2026-10-20 (direct, host is `*.arcgis.com` so no relay change):** 7 of 9 fixture points returned a polygon (the 2 misses are road/river) — e.g. `44-165.00-01-03`, 25.248 ac; plus 6 of 8 extra points just inside the Butler, Indiana, Westmoreland and Clarion sides; layer extent [-79.698, 40.525, -79.207, 41.169] sits inside Pennsylvania and inside Armstrong's bounds; a point well into Butler or Westmoreland returns nothing. A click just across the line in each neighbour still resolves to THAT county's row (`test/pennsylvaniaCounties.test.js`, "Armstrong County is wired"). The bundled county polygons sit roughly half a kilometre off the Armstrong/Indiana line, so a few points on Indiana's side of the bundled line are still Armstrong lots; the lot-click fallback (`identifyWithFallback`) asks the neighbour across the line for exactly that case.
- **Ruled out, do not re-chase:** `Kiski_Parcels` and `Bethel_Parcels` (account `Daxton01`) — `499 Token Required`, and they cover only a slice of the county.
- **The lesson (STANDING RULE #2 clause 1):** "no public source" was filed after the one route that would have worked answered an error that looked like a refusal. When an ArcGIS Online service root answers and a layer index errors, list the layers and try each before calling it private.

**Reachability caveat (for the next session).** Four registry-listed county hosts answer from a browser but not from the Cloudflare relay (`gis.norrycopa.net` Northumberland and `www.wcgis.us` Westmoreland present an invalid certificate — Cloudflare error 526; `clearfieldco.org` answers 500; `gis.blairco.org`, `gis.co.berks.pa.us` and several others time out with 522) — those counties ride PASDA or the DEP layer instead. They should be re-measured periodically; Northumberland, Westmoreland, Clearfield and Elk would then move off the fallback.

## South Dakota counties (2026-10-19)

B2343936, owner request "start wiring all the remaining states into Planner". **17 of 66 counties wired** (Pennington, Minnehaha + the Sioux Falls city layer from 2026-09-15, and 15 added here: module `lib/sdParcels.js`, provenance `lib/sdProvenance.js`); **49 are named gaps** (the existing "<County> — no parcel data wired here yet." sentence) with a recorded, re-searched reason. South Dakota has **no statewide parcel layer**: the State GIS server (`sdgis.sd.gov/arcgis1`, read through the relay) publishes boundaries, PLSS, tax-match districts and rooftop addresses only, and the 2026-09-09 probe's "none found" stands for the STATE — what changed is that county-by-county sources turned up.

**How it was searched.** (1) ArcGIS Online: a bbox-filtered crawl of ~4,450 Feature/Map services in South Dakota's extent (every polygon layer with a county-sized extent probed), a per-county name search for all 66, Web Map / app / Hub searches, and the layer URLs inside the web maps; (2) a federal-contractor org on AGOL (`GDITAdmin`) keeps a "Parcels - SD - <County>" index of 48 county services — it names the two planning-district servers below, which no other search surfaced; (3) the State GIS server and every state-published folder through the `/gis-proxy` relay; (4) planning-district sites (First District: `1stdistrict.org`, `1stdistrictmapnet.com`; District III: `districtiii.org/gis.html`) and county sites read through the relay; (5) web search per county for the ones in no index. Non-AGOL hosts are unreachable from the sandbox, so each was MEASURED through the production relay (allow-list PRs #2397 and #2410) with point queries only: per wired layer ~12 lots sampled evenly across the layer, each lot's centroid resolved against the nationwide county polygons to the wired county, a point query returning the same lot with its parcel id, the returned extent inside South Dakota; then point queries at the five spread interior points of every county (75/75 returned a lot with an id) and a walk in from each county line (parcels run right up to the line; the exact line point is usually a section-line road with no lot).

**Who publishes what.** (a) **First District Association of Local Governments** (Watertown) runs one ArcGIS Server for 12 counties' "MapNet" viewers — the REST parcel layers are anonymous; the viewers sell subscriptions for premium data (property cards, sales), so only the free basic-assessment fields are used here (flagged for the owner). (b) **Planning District III** (Yankton) runs ~30 county viewers on `gis.districtiii.org`; the State index lists their REST layers but the host now answers every path 404 / the root 403 through the relay — **needs a real-browser check (V1774465): if the owner's browser can read `gis.districtiii.org/arcgis/rest/services/AURORA_COUNTY_LAYERS/MapServer/8?f=json`, ~26 counties unlock at once.** (c) **Beacon (Schneider)** runs the assessor viewer for Brookings, Brown, Clay, Custer, Hughes, McCook, Union and others: no public REST/export, terms-gated; an adapter would be a scrape, so it is NOT built. (d) **Equator Studios** is a paid portal. (e) a handful of counties publish on their own AGOL org (Brown, Dewey, Lawrence).

| County | Key | Source | Owner | Notes |
|---|---|---|---|---|
| Aurora | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Beadle | `sd_beadle` | www.1stdistrict.org Beadle/beadleparcels/0 (relay) | yes | OWNER_NAME; 16,909 lots |
| Bennett | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Bon Homme | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Brookings | — (named gap) | **no source wired** | — | Beacon (Schneider) only — `beacon.schneidercorp.com/?site=BrookingsCountySD`, no public REST; the City-of-Brookings AGOL layer in the State index is gone (layer id not found) |
| Brown | `sd_brown` | AGOL Parcels_2025 (Brown County / Aberdeen org) | partly | tax-payer last/entity name (`vcPayerLas`); 42,870 parcel-type polygons of 44,183 (road/rail/water rows excluded); edited 2025-10-22 |
| Brule | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Buffalo | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Butte | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Campbell | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Charles Mix | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Clark | `sd_clark` | www.1stdistrict.org Clark/clarkmapnetpro/1 (relay) | yes | OWNER1; 7,623 |
| Clay | — (named gap) | **no source wired** | — | Beacon (Schneider) only; no public REST service found |
| Codington | `sd_codington` | www.1stdistrict.org Codington/codingtonmapnetpro/9 (relay) | yes | OWNER1; 18,479; PROP_STREE address |
| Corson | — (named gap) | **no source wired** | — | Equator Studios (paid portal) only; no public county service found |
| Custer | — (named gap) | **no source wired** | — | Beacon (Schneider) only; the county GIS office's own parcel geodatabase is not published as a service |
| Davison | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured (the county's own davisonreports.com viewer: origin DNS error) |
| Day | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Deuel | `sd_deuel` | www.1stdistrict.org Deuel/deuelmapnetpro/2 (relay) | yes | OWNER1; 6,974 |
| Dewey | `sd_dewey` | AGOL DEWEY_COUNTY_LAYERS2/4 (county org) | yes | deed holder; tribal-trust polygons (`PARCEL_ID` = TRIBAL) excluded; edited 2026-09-30 |
| Douglas | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Edmunds | `sd_edmunds` | www.1stdistrict.org Edmunds/edmundsmapnet/2 (relay) | yes | OWNER1; 9,603 |
| Fall River | — (named gap) | **no source wired** | — | State parcel index lists arcgis.mobile311.com/arcgis/rest/services/SouthDakota/FallRiver/MapServer/25 (county vendor host); the relay times out (504) on it — unmeasured. The county's own AGOL org (fallriversd) holds election layers only |
| Faulk | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Grant | `sd_grant` | www.1stdistrict.org Grant/grantmapnetpro/16 (relay) | yes | TAXPAYER_NAME; 8,926 |
| Gregory | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Haakon | — (named gap) | **no source wired** | — | District III viewer listed on districtiii.org/gis.html; absent from the parcel index; host dead as above |
| Hamlin | `sd_hamlin` | www.1stdistrict.org Hamlin/hamlinmapnetpro/8 (relay) | yes | OWNER_NAME; 8,132 |
| Hand | `sd_hand` | www.1stdistrict.org Hand/handmapnet/7 (relay) | yes | OWNER_NAME; 9,550 |
| Hanson | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Harding | — (named gap) | **no source wired** | — | No county service found; only commercial resellers list it |
| Hughes | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured; the county's own real-estate site is Beacon |
| Hutchinson | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Hyde | — (named gap) | **no source wired** | — | District III GIS Services (assessor-search directory) — same dead host; no parcel layer in the State index |
| Jackson | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Jerauld | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Jones | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Kingsbury | `sd_kingsbury` | www.1stdistrict.org Kingsbury/kingsburymapnetpro/4 (relay) | yes | OWNER1; 9,086 |
| Lake | — (named gap) | **no source wired** | — | State index lists 1stdistrict.org Lake/lakemapnet (service 'not started'); the Lake folder now holds only FSA imagery — no parcel service |
| Lawrence | `sd_lawrence` | AGOL Lawrence_Parcels_YrBlt (county equalization org) | yes | CURRENT_OW; 21,895; edited 2024-04-23 — year-built working copy, flagged |
| Lincoln | — (named gap) | **no source wired** | — | Real service exists (gis.lincolncountysd.gov Pro29/Parcels FeatureServer, Esri-hosted item on the county's AGOL org) but the host sits behind a Cloudflare managed bot challenge: the relay gets 403 'Just a moment…' on every path (also for POST), maps.lincolncountysd.org answers 530/1016. Cannot be measured or reached from the app. The Sioux Falls part of the county is answered by the city layer (`sd_siouxfalls`). City-only AGOL layers also exist for Tea and Harrisburg (not wired) |
| Lyman | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Marshall | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| McCook | — (named gap) | **no source wired** | — | Beacon (Schneider) interactive parcel map; no public REST service found |
| McPherson | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Meade | — (named gap) | **no source wired** | — | State index points at gisstaffweb.rcgov.org (Rapid City staff web adapter; origin unresolvable from the relay, error 1016). The only public AGOL copy (`MeadeCo_Parcels`) holds 401 polygons, mostly in Pennington County — a partial, rejected |
| Mellette | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Miner | `sd_miner` | www.1stdistrict.org Miner/minermapnetpro/2 (relay) | yes | OWNER1; 5,299 |
| Minnehaha | `sd_minnehaha` | gis.minnehahacounty.gov Parcels/0 + Sioux Falls city layer — earlier session `sd_minnehaha` / `sd_siouxfalls` | — | unchanged (rural remainder + the city's own layer) |
| Moody | `sd_moody` | www.1stdistrict.org Moody/moodymapnet/7 (relay) | yes | deed holder; 6,322; GrossAcres reads 0 |
| Oglala Lakota | — (named gap) | **no source wired** | — | No county service found; nothing indexed (county created from Shannon, 2015) |
| Pennington | `sd_pennington` | AGOL PenningtonParcels (county GIS) — earlier session `sd_pennington` | — | 52,547; unchanged |
| Perkins | — (named gap) | **no source wired** | — | Equator Studios (paid portal) only; no public county service found |
| Potter | — (named gap) | **no source wired** | — | District III viewer listed on districtiii.org/gis.html; absent from the parcel index; host dead as above |
| Roberts | `sd_roberts` | www.1stdistrict.org Roberts/robertsmapnetpro/3 (relay) | yes | OWNER; 14,609 |
| Sanborn | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured |
| Spink | — (named gap) | **no source wired** | — | Not published online: the county sells/licenses its parcel GIS layer (commission minutes record fee waivers for it); no viewer service found |
| Stanley | — (named gap) | **no source wired** | — | District III viewer listed on districtiii.org/gis.html; absent from the parcel index; host dead as above |
| Sully | — (named gap) | **no source wired** | — | District III viewer listed on districtiii.org/gis.html; absent from the parcel index; host dead as above |
| Todd | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured (shared Todd + Tripp layer) |
| Tripp | — (named gap) | **no source wired** | — | Planning District III county viewer (listed in the State's parcel index as gis.districtiii.org/arcgis/rest/services/<COUNTY>_LAYERS/MapServer); the host answers the relay 404 on every path (and 403 at its root) on 2026-10-20 — REST no longer served publicly, so nothing could be measured (shared Todd + Tripp layer) |
| Turner | — (named gap) | **no source wired** | — | District III viewer listed on districtiii.org/gis.html; absent from the parcel index; host dead as above |
| Union | — (named gap) | **no source wired** | — | Beacon (Schneider) only; no public REST service found |
| Walworth | — (named gap) | **no source wired** | — | No county service found; only commercial resellers list it |
| Yankton | — (named gap) | **no source wired** | — | AGOL `YanktonCountyParcels_new` (9,458) covers only the city of Yankton and its surroundings (extent 42.84–42.99 N of the county's 42.80–43.17) — a one-city layer, rejected as a county source. The county's other layers were District III's |
| Ziebach | — (named gap) | **no source wired** | — | District III viewer listed on districtiii.org/gis.html; absent from the parcel index; host dead as above |

**Rejected sources (measured, so they are not re-chased).** `MeadeCo_Parcels` (AGOL, 401 polygons, 22 of 24 samples in Pennington); `YanktonCountyParcels_new` (city + surroundings only); the school-district `BCSDGISdata_view` cut of Brown's roll (26,168 vs 44,183); City of Sturgis `Zoning (Parcels)`, Tea, Brandon and Volga parcel views (single cities, no owner on Tea) — a city-scope row would be the way to add them; the Esri Living Atlas / Regrid / Land Records / ReportAll products (commercial).

**Stopping rule.** Closes when each of the 49 gap counties is wired or the owner confirms the source stays closed: (1) V1774465 (District III from a real browser) decides ~26 at once; (2) Lincoln needs the county to lift the bot challenge on its parcel service for `planyr.io`'s relay; (3) Beacon counties need a licence or an export from the county.

## Arizona counties (2026-10-19) — 15 of 15 wired (B2365360)

Owner request "start wiring all the remaining states into Planner", Arizona only. **All 15 counties are connected** (2 hand-wired earlier: Pinal, Maricopa; 13 in `lib/azParcels.js`, provenance in `lib/azProvenance.js`). No gaps, so no county falls back to "<County> — no parcel data wired here yet". The 2026-09-09 probe verdict for Arizona ("no free source", run from an egress-limited sandbox, before the AGOL-org pass) is superseded.

**What changed the answer.** There IS a multi-county Arizona layer: the **Arizona Department of Water Resources' parcel compile** on ArcGIS Online ("Parcel layers displayed in ADWR applications", org `C34zQ7veRS0V1t04`, service `Parcels/FeatureServer`, last edited 2026-04-21). It has one layer per county with APN, owner, situs and acres for 12 counties. It does **not** hold Maricopa, Mohave or Yavapai (layers 7, 8 and any Yavapai layer do not exist). The earlier probe missed it because it searched parcel-titled items from state-agency orgs; this one is published under a generic data-manager account. It is wired as the base for the counties where no fresher county layer with an owner exists; four counties have a county-published layer edited this month that is better, and Mohave needed its own server.

**How it was searched.** (1) ArcGIS Online item search bbox-filtered to Arizona, ~730 Feature/Map services across 30 queries (statewide, per county, per town); every candidate's layers probed for geometry, count, extent and columns; (2) the ADWR compile's layer list, extents and edit dates read in full; (3) county-published AGOL layers compared to ADWR on freshness and columns; (4) non-AGOL hosts (Mohave's `mcgis.mohave.gov`) read through the `/gis-proxy` relay on this PR's Cloudflare preview, because the sandbox reaches only `*.arcgis.com`. **Measurement for every wired row:** 24 lots sampled evenly across the layer (by offset), each resolved by centroid against the nationwide county polygons to the county it is wired for and re-found by a point query returning its parcel id; plus point queries at 7 spread interior points and up to 3 county-line points per county (many spread points correctly return nothing: most of Arizona is public, tribal or forest land with no tax parcels, so "interior hit" counts below are low for those counties by design, not a defect). The only samples that resolved to a neighbouring county sat within 0.6 km of the generalised county line (or on the Colorado River line). Each row's returned extent sits inside Arizona (31.3–37.0 N, 109.0–114.9 W).

| County | Key | Source | Lots | Owner | Edited | Notes |
|---|---|---|---|---|---|---|
| Apache | `az_apache` | ADWR compile layer 0 | 57,679 | yes | 2026-04 | county copies on AGOL are 2020 (57,674) or partial (4,539) |
| Cochise | `az_cochise` | ADWR compile layer 1 | 122,935 | yes | 2026-04 | county's own `Cad_Parcel_Geometry` (124,894, edited 2026-10-19) is fresher but has only the APN and tax area — no owner — so not used |
| Coconino | `az_coconino` | county AGOL "Coconino County Parcels Public View" | 78,591 | yes | 2026-10-17 | fresher than ADWR (78,368) |
| Gila | `az_gila` | ADWR compile layer 3 | 39,656 | yes | 2026-04 | other Gila layers: a district's partial copy (~12 mi wide), a 2020 city extract |
| Graham | `az_graham` | county AGOL "Graham County Parcels New" layer 7 | 19,233 | yes | 2026-10-15 | situs is separate street parts, so no address column wired |
| Greenlee | `az_greenlee` | ADWR compile layer 5 | 4,706 | yes | 2026-04 | |
| La Paz | `az_lapaz` | ADWR compile layer 6 | 19,336 | yes | 2026-04 | two samples fall on the Colorado River line |
| Maricopa | `az_maricopa` | gis.maricopa.gov Parcel MapServer 1 | 1,760,396 | yes | — | existing row (B1339920), measured from the owner's browser 2026-09-11; this sandbox cannot reach the host. An AGOL mirror (`Parcel_Data_View`, 1,742,671, edited 2025-04) exists but the county's own host is the fresher, authoritative one |
| Mohave | `az_mohave` | mcgis.mohave.gov PARCELS MapServer layer 14 (relay) | 267,445 | yes | — | the county's own server; the only other public Mohave layer is a 71-lot export. A MapServer, so outlines start at the generic MapServer floor |
| Navajo | `az_navajo` | county AGOL "Parcels" | 86,855 | yes | 2026-10-19 | fresher than ADWR (86,380); owner values carry a trailing newline (trimmed by the reader) |
| Pima | `az_pima` | ADWR compile layer 10 | 445,971 | yes | 2026-04 | Pima's own server (`gisdata.pima.gov` GISOpenData/LandRecords layer 12) not used: not on AGOL and its open-data copies are dated 2021–2022 |
| Pinal | `az_pinal` | AGOL `TaxParcel_8_26` (City of Maricopa org) | 286,959 | yes | 2026-08 | existing row, re-measured today: 23 of 24 samples in county, 7/7 interior |
| Santa Cruz | `az_santacruz` | ADWR compile layer 12 | 43,189 | yes | 2026-04 | county server `mapservices.santacruzcountyaz.gov` also exists; not needed |
| Yavapai | `az_yavapai` | county AGOL "Parcels" layer 1 | 187,921 | yes | 2026-10-17 | readable APN is `PARLABEL`; blank owner on 8,262 lots; ADWR does not hold Yavapai |
| Yuma | `az_yuma` | ADWR compile layer 13 | 96,848 | yes | 2026-04 | county server `arcgis.yumacountyaz.gov` YC_Parcels exists; not needed |

**Outline floor (the 2,000-lot query cap).** FeatureServer rows answer at most 2,000 lots a query. Busiest 1 km cell sampled at each county's towns: Yavapai 1,133, Yuma 1,107, Pima 1,044, Cochise 1,005 (at zoom 16; four times that at zoom 15), Coconino 837, Navajo 763, Gila 753, Santa Cruz 724, Graham 622, La Paz 612, Greenlee 221, Apache 10. The ten counties with a town above ~600 floor their outlines at zoom 16 (`displayMinZoom`); below it the existing "zoom in to see the lines" hint shows, and a click is unaffected at every zoom. Apache and Greenlee keep the generic floor.

**Honest caveats (for the owner, not blockers).**
- Eight counties ride the ADWR compile, edited 2026-04-21, so they can lag a county by months; when a county publishes an owner-bearing layer fresher than that, swap the row.
- Cochise's fresher county geometry has no owner; the choice was owner over freshness.
- Owner columns are the roll's owner of record; Yavapai's is blank on 8,262 lots (4%).
- Maricopa was not re-measured from here (host blocked in the sandbox); its row stands on the 2026-09-11 browser measurement.
- Tribal and public land has no tax parcels in any of these layers by nature; a click there returns nothing, which is correct, not a gap.

## Kansas counties (2026-10-19) — 50 of 105 wired (B2348000)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* — this section is Kansas only. **Kansas has no complete free statewide parcel service.** The 2026-09-09 probe (top table) was run from an egress-limited sandbox and is stale; re-measured 2026-10-19: the state's own parcel layer — `services.kansasgis.org/arcgis4/rest/services/KS_Parcels_ORKA_EB` ("parcels where available", 19-digit `KSPID`, id + shape only) — exists but holds exactly four counties (Cheyenne `CN`, Rawlins `RA`, Sherman `SH`, Thomas `TH`, measured by a count grouped on `CO_ABBR`: 4,905 / 5,075 / 6,447 / 7,434 polygons). Those four are wired through it, scoped by `CO_ABBR`. (The earlier "ORKA folder holds only KS_ORKA_Extras" finding looked at `arcgis`; the parcels sit on `arcgis4`.) `ks_wyandotte` stays hand-written (wired 2026-09-10).

Routes tried for every county: (1) statewide / multi-county — the state's DASC servers (`arcgis`, `arcgis3`–`arcgis15`), the KansasGIS ArcGIS Online org (686 services; its only parcel layers are Harper's and an Anderson ORKA mobile copy), the state's "KS_County_Website_Links" table (every county's GIS / parcel-search URL — nearly all point at the ORKA portal), ArcGIS Online title / owner / extent crawls (~5,300 Kansas-bbox items, ~3,000 candidate layers point-probed), the county-GIS contractors' orgs (ATCI `services9…/zDY8zW24CdJKhVIw`, lkmap `…/yGerJCngvNpaN2km`, URS), ArcGIS Hub; (2) each county's own assessor / GIS host and the AGOL web maps and experiences its website links; (3) the viewer vendors (Integrity GIS Geocortex pools and the newer SAM app, Tyler / Aumentum LGIS, Schneider Beacon, kansasgov ASP pages). The sandbox reaches only `*.arcgis.com`; every other host was MEASURED through the production-shaped relay (`/gis-proxy`, on this PR's Cloudflare preview) with point queries at 5 interior spread points plus 4 beside each county's lines, then 14 random interior points; each wired row returned polygons carrying its parcel id and its returned extent sits inside Kansas. A miss on a spread point is normal where the point falls on a road or water.

**Two layers deliberately NOT wired.** (a) ATCI's `x911Parcels` (389,266 owner polygons over the western half; `Owner` + a county code that is blank on 52,459 rows) carries **no parcel id**, so it fails the "polygon with a parcel ID" bar — it would, if the owner ever accepts an owner-only source, give ~20 more western counties a polygon + owner; (b) Miami County's only AGOL parcel layer is a rural water district's 2023 copy (8/14 interior points).

**Wired with a caveat:** Reno's layer is the county's 2021 tax-unit review copy (14/14 interior, dated); Seward's is the City of Liberal's December 2023 copy of the county roll (third-party publisher); Geary / Reno / Saline return a parcel at 6/9 of the test points (the misses are roads / water, 13–14 of 14 random interior points hit).

### Wired counties (49 + Wyandotte)

| County | Source | Parcel-id field | Owner | Address | Measured (spread+line hits / points · beside line · random interior) |
|---|---|---|---|---|---|
| Anderson County | ArcGIS Online (`services1.arcgis.com`) | `ORKA_AN_PARCELS_ORKA_KSPID` | yes | `Parcels_PropertyAddress` | 9/9 · 4/4 · interior 14/14 |
| Atchison County | ArcGIS Online (`services3.arcgis.com`) | `PIN` | yes | `SitusAddre` | 7/9 · 2/4 · interior 13/14 |
| Barber County | ArcGIS Online (`services9.arcgis.com`) | `PIN` | yes | `SitusAddr` | 9/9 · 4/4 · interior 14/14 |
| Butler County | County / vendor server (`ww1.bucoks.com`) | `PID` | no | — | 8/9 · 3/4 · interior 14/14 |
| Cherokee County | Integrity GIS Geocortex public site `Cherokee_County_KS` (`doniphangis.integritygis.com`) · ms 2 · layer 23 | `PIN` | yes | `siteaddress` | 9/9 · 4/4 · interior 14/14 |
| Cheyenne County | Kansas DASC / Dept. of Revenue statewide ORKA layer (`services.kansasgis.org`) scoped by `CO_ABBR='CN'` | `KSPID` | no | — | 9/9 · 4/4 · interior 14/14 |
| Clark County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SitusAddre` | 8/9 · 3/4 · interior 14/14 |
| Cloud County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SitusAddre` | 8/9 · 3/4 · interior 13/14 |
| Coffey County | ArcGIS Online (`services6.arcgis.com`) | `PID` | no | — | 8/9 · 3/4 · interior 14/14 |
| Cowley County | ArcGIS Online (`services2.arcgis.com`) | `PIN` | yes | `SitusAddress` | 8/9 · 3/4 · interior 14/14 |
| Dickinson County | ArcGIS Online (`services6.arcgis.com`) | `PIN` | yes | `SitusAddress` | 8/9 · 3/4 · interior 14/14 |
| Doniphan County | Integrity GIS Geocortex public site `Doniphan_County_KS` (`doniphangis.integritygis.com`) · ms 3 · layer 11 | `PID` | yes | `SitusAddress` | 9/9 · 4/4 · interior 14/14 |
| Douglas County | ArcGIS Online (`services.arcgis.com`) | `PID` | yes | `address` | 9/9 · 4/4 · interior 13/14 |
| Elk County | ArcGIS Online (`services3.arcgis.com`) | `PID` | yes | `SitusAddre` | 9/9 · 4/4 · interior 14/14 |
| Ellis County | County / vendor server (`geodataportal.net`) | `PARCEL_ID` | yes | `SitusAddress` | 8/9 · 3/4 · interior 14/14 |
| Ellsworth County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SitusAddr` | 8/9 · 3/4 · interior 14/14 |
| Finney County | County's ArcGIS Experience parcel app (`utility.arcgis.com`, public) | `ParcelID` | yes | `SitusAddress` | 8/9 · 4/4 · interior 14/14 |
| Ford County | ArcGIS Online (`services7.arcgis.com`) | `PARCEL_ID` | yes | `siteaddres` | 9/9 · 4/4 · interior 14/14 |
| Franklin County | ArcGIS Online (`services1.arcgis.com`) | `PARCEL_CAM` | no | `SitusAddress` | 7/9 · 3/4 · interior 13/14 |
| Geary County | ArcGIS Online (`services6.arcgis.com`) | `PIN` | yes | `PROPADDR` | 6/9 · 2/4 · interior 13/14 |
| Harper County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SitusAddre` | 8/9 · 4/4 · interior 14/14 |
| Harvey County | ArcGIS Online (`services2.arcgis.com`) | `PIDNO` | yes | `SitusAddre` | 9/9 · 4/4 · interior 13/14 |
| Jefferson County | ArcGIS Online (`services1.arcgis.com`) | `PID` | yes | `PropertyAddress` | 9/9 · 4/4 · interior 14/14 |
| Labette County | ArcGIS Online (`services9.arcgis.com`) | `PIDNO` | yes | `SitusAddr` | 9/9 · 4/4 · interior 14/14 |
| Lane County | Tyler / Aumentum LGIS (`gis.aumentumtech.com`) | `PID` | no | — | 8/9 · 3/4 · interior 14/14 |
| Leavenworth County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SiteAddr` | 8/9 · 3/4 · interior 14/14 |
| Logan County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SitusAddre` | 8/9 · 3/4 · interior 14/14 |
| Lyon County | ArcGIS Online (`services8.arcgis.com`) | `PID` | no | — | 9/9 · 4/4 · interior 14/14 |
| McPherson County | ArcGIS Online (`services8.arcgis.com`) | `KSPID` | yes | `PropAddres` | 7/9 · 2/4 · interior 13/14 |
| Meade County | Tyler / Aumentum LGIS (`gis.aumentumtech.com`) | `PID` | no | — | 9/9 · 4/4 · interior 14/14 |
| Montgomery County | ArcGIS Online (`services8.arcgis.com`) | `ParcelID` | yes | `Situs` | 9/9 · 4/4 · interior 14/14 |
| Nemaha County | ArcGIS Online (`services3.arcgis.com`) | `PID` | no | — | 8/9 · 3/4 · interior 13/14 |
| Osage County | ArcGIS Online (`services9.arcgis.com`) | `PID` | yes | `SitusAddre` | 9/9 · 4/4 · interior 13/14 |
| Pawnee County | ArcGIS Online (`services9.arcgis.com`) | `PIN` | yes | `SitusAddr` | 9/9 · 4/4 · interior 13/14 |
| Pottawatomie County | ArcGIS Online (`services6.arcgis.com`) | `PARCEL` | yes | — | 9/9 · 4/4 · interior 14/14 |
| Rawlins County | Kansas DASC / Dept. of Revenue statewide ORKA layer (`services.kansasgis.org`) scoped by `CO_ABBR='RA'` | `KSPID` | no | — | 9/9 · 4/4 · interior 14/14 |
| Reno County | ArcGIS Online (`services6.arcgis.com`) | `PIN` | yes | — | 6/9 · 2/4 · interior 14/14 |
| Republic County | Integrity GIS Geocortex public site `Republic_County_KS` (`audraingis.integritygis.com`) · ms 14 · layer 7 | `PID` | yes | `SitusAddress` | 8/9 · 3/4 · interior 14/14 |
| Riley County | ArcGIS Online (`services.arcgis.com`) | `PID` | yes | — | 9/9 · 4/4 · interior 14/14 |
| Russell County | ArcGIS Online (`services9.arcgis.com`) | `KSPID` | yes | `SitusAddr` | 9/9 · 4/4 · interior 13/14 |
| Saline County | ArcGIS Online (`services2.arcgis.com`) | `PID` | yes | `SITUSADDRE` | 6/9 · 2/4 · interior 13/14 |
| Scott County | Tyler / Aumentum LGIS (`gis.aumentumtech.com`) | `PID` | no | — | 7/9 · 2/4 · interior 14/14 |
| Sedgwick County | ArcGIS Online (`services7.arcgis.com`) | `PIN` | no | — | 7/9 · 3/4 · interior 12/14 |
| Seward County | ArcGIS Online (`services6.arcgis.com`) | `PID` | yes | `SITUS_1` | 9/9 · 4/4 · interior 14/14 |
| Shawnee County | ArcGIS Online (`services2.arcgis.com`) | `PIN` | no | `PADDRESS` | 7/9 · 3/4 · interior 14/14 |
| Sherman County | Kansas DASC / Dept. of Revenue statewide ORKA layer (`services.kansasgis.org`) scoped by `CO_ABBR='SH'` | `KSPID` | no | — | 8/9 · 3/4 · interior 14/14 |
| Stafford County | ArcGIS Online (`services9.arcgis.com`) | `PARCEL_ID` | yes | `SitusAddr` | 7/9 · 3/4 · interior 14/14 |
| Sumner County | ArcGIS Online (`services6.arcgis.com`) | `PID` | no | — | 8/9 · 3/4 · interior 14/14 |
| Thomas County | Kansas DASC / Dept. of Revenue statewide ORKA layer (`services.kansasgis.org`) scoped by `CO_ABBR='TH'` | `KSPID` | no | — | 9/9 · 4/4 · interior 13/14 |

### Gaps — the "<County> — no parcel data wired here yet." sentence, each with its re-searched reason (55)

| County | Kind | Re-searched reason (2026-10-19) |
|---|---|---|
| Allen County | no-api | Allen County's viewer (allen.integritygis.com) is Integrity GIS's newer SAM React app: its data comes from a proprietary dataapi/siteapi behind single sign-on, with no ArcGIS REST endpoint to query. The state link row points to ORKA. Re-searched 2026-10-19. |
| Barton County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Bourbon County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Brown County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Chase County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Chautauqua County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Clay County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Comanche County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Crawford County | none-found | Crawford County's maps page (read through the relay) links only district/precinct/taxing-unit instant apps on the county's AGOL org (crcoks); the only layer called Parcels there (services6 org 8Y1pfzURRr23GSDj) covers a single city's footprint (0 of 14 county interior points), and the state link row points to ORKA. Re-searched 2026-10-19. |
| Decatur County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Edwards County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Gove County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Graham County | login-required | The only Graham County layer found on ArcGIS Online (owner grahamcounty.org, Tax_View) answers Token Required; the state link row points to ORKA. Re-searched 2026-10-19. |
| Grant County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Gray County | no-api | Gray County's parcel search is a classic ASP page (gray.kansasgov.com/parcel/NCRunLev2.asp, Tyler/kansasgov) with no map service behind it; the state link row has no GIS portal. Re-searched 2026-10-19 through the relay. |
| Greeley County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Greenwood County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Hamilton County | login-required | Integrity GIS Geocortex site Hamilton_County_KS (doniphangis.integritygis.com) answers a guest with 403 'The current user cannot access the desired resource' — a login-gated site, never worked around. Its state link row points to ORKA; no other county layer found (ATCI HamiltonCountyGIS holds address points and roads only). Re-searched 2026-10-19. |
| Haskell County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Hodgeman County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Jackson County | no-api | Jackson County's viewer is Integrity GIS's newer SAM React app: its data comes from a proprietary dataapi/siteapi behind single sign-on, with no ArcGIS REST endpoint to query. The state link row points to ORKA. Re-searched 2026-10-19. |
| Jewell County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Johnson County | login-required | Johnson County AIMS publishes parcels only as free file downloads and in the county's secured map services: maps.jocogov.org and fsgis.jocogov.org list no parcel layer publicly, and the folders that could hold one (Secure, jocoDev, DHE) answer 499 Token Required. City layers (Overland Park, Olathe, Lenexa) cover single cities only and do not count. Re-searched 2026-10-19 through the relay. |
| Kearny County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Kingman County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Kiowa County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Lincoln County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Linn County | login-required | The county's ArcGIS Online org (lncoks) publishes Planning_and_Zoning_Parcels (layer 250) but it answers 499 Token Required; its public layers hold no parcel fabric (a 2025 tax-sale layer covers only the sale parcels). The county's old maps page moved to linncountyks.gov. Re-searched 2026-10-19. |
| Marion County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Marshall County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Miami County | no-api | Miami County's parcel viewer is Schneider Beacon (AppID 229, no public REST/query endpoint). The only Kansas AGOL parcel layer found (Property_mico_MI2_2023, a rural water district's 2023 copy) covers only 8 of 14 random interior points — a district copy, not a countywide layer — so it is not wired. The county's own AGOL org (micoks) holds no parcel service. Re-searched 2026-10-19. |
| Mitchell County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Morris County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Morton County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Neosho County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Ness County | login-required | Integrity GIS Geocortex site Ness_County_KS (doniphangis.integritygis.com) answers a guest with 403 — a login-gated site, never worked around. ATCI NessCountyGIS holds address points and roads only; the state link row points to ORKA. Re-searched 2026-10-19. |
| Norton County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Osborne County | no-api | Osborne County's maps page links only an ASP parcel search (osborne.kansasgov.com/parcel, Tyler/kansasgov) and a CIC tax-payment site — no map service. Re-searched 2026-10-19 through the relay. |
| Ottawa County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Phillips County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Pratt County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Rice County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Rooks County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Rush County | login-required | Integrity GIS Geocortex site Rush_County_KS (doniphangis.integritygis.com) answers a guest with 403 — a login-gated site, never worked around. ATCI RushCountyGIS holds address points and roads only; the state link row points to ORKA. Re-searched 2026-10-19. |
| Sheridan County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Smith County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Stanton County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Stevens County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Trego County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Wabaunsee County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Wallace County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Washington County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Wichita County | no-api | The state's own county-links table (KansasGIS 'KS_County_Website_Links', read 2026-10-19) sends this county's parcel search to the Kansas ORKA portal (kansasgis.org/orka), a ColdFusion viewer with no public ArcGIS REST layer; the state's statewide ORKA layer (services.kansasgis.org/arcgis4 KS_Parcels_ORKA_EB) holds only Cheyenne, Rawlins, Sherman and Thomas. Re-searched 2026-10-19: ArcGIS Online title / owner / extent crawl, the county's own AGOL org service list, the state's other server folders; none was found. |
| Wilson County | no-api | Wilson County's parcel viewer is Schneider Beacon (beacon.schneidercorp.com AppID 194), which has no public REST/query endpoint; the same-named AGOL orgs found are in North Carolina. Re-searched 2026-10-19. |
| Woodson County | login-required | Integrity GIS Geocortex site Woodson_County_KS (doniphangis.integritygis.com) answers a guest with 403 — a login-gated site, never worked around; the county's own map page (woodsoncounty.net) returns 404. The state link row points to ORKA. Re-searched 2026-10-19. |

## Illinois counties (2026-10-19) — 66 of 102 wired (B2372624)

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"* and *"send the rest"* — this section is **Illinois only** (sibling sessions took the other states). **66 of 102 counties are wired: Cook, DuPage, Will and Kane (hand-wired 2026-09, re-measured here) plus 62 new rows; the other 36 read "<County> — no parcel data wired here yet." and each carries a recorded, re-searched reason.** Rows live in `src/workspaces/site-planner/lib/ilParcels.js` (provenance prose `ilProvenance.js`), plugged into `counties.js` with one import and two spreads. Guard: `test/illinoisCounties.test.js` (704+ assertions; **127 failures on main before the rows**), fixtures `test/fixtures/ilCounties.json` + `ilSamples.json`.

**Illinois has no free statewide parcel service — and the three statewide-looking candidates were each measured, not assumed.** (1) The Illinois State Geological Survey's *Illinois_Parcels_Database* (`maps.isgs.illinois.edu/arcgis/rest/services/IL_Parcels/…`) answers **"Token Required" (499)** to an anonymous request — the whole `IL_Parcels` folder is behind the token, so it cannot be a statewide source (no key is replayed or harvested). (2) The Prairie Research Institute's *OMLP_Parcel_Fabric* (`gis.prairie.illinois.edu`) is a project slice: a one-point-per-county sweep found lots in only 20 counties (Carroll, Alexander, De Witt, Franklin, Fayette, Jackson, Jasper, Jersey, Johnson, Logan, Monroe, Perry, Peoria, Rock Island, Sangamon, Schuyler, Stark, Tazewell, Vermilion, Will), so it is not a county source. (3) The Illinois Department of Revenue's server (`aglomaps.revenue.illinois.gov`) publishes tax districts, enterprise zones, municipalities and geocoders — no parcels. The 2026-09-09 probe row for Illinois ("no-free-source / none found") was run from an egress-limited sandbox before pass 2 and before the relay existed; its *statewide* finding stands, its "none found" for the counties does not.

**How it was found and measured.** The sandbox reaches only `*.arcgis.com` and planyr.io, so: (a) ArcGIS Online — a bbox crawl of ~6,600 Illinois-area items, the `GDITAdmin` "Parcels - IL - <County>" index (63 entries; **roughly 40 of its URLs no longer answer** — stale "Invalid URL" (the Sidwell-org `<County>ILFeatures` services it names no longer exist), token-gated, not found, or TLS/timeout at the relay), per-county title searches, county-named AGOL organisations, web-map layer extraction, ArcGIS Hub, and a second per-county search restricted to each county's own envelope; (b) every county host found that way was added to `/gis-proxy`'s allow-list in three small PRs (#2428, #2431, #2435) and **measured through the production relay** (`planyr.io/gis-proxy`) before any row used it — directory walks of each server found the parcel layers (Madison, Tazewell, Sangamon and Coles' new domain were all found that way; a title search misses them). Each wired row: point queries at 5 spread interior points and 4 points beside the county lines (a miss that sits within 300 m of a lot — a road or gap — is counted separately), a **uniform grid laid over the real county polygon** (every county ≥ 90 % answered; `grid x/y` below), and a **point query at the county's two largest places** (the city-hole check). Extents sit inside Illinois. Keep-relay-light: point queries only, no headless browser against planyr.io.

**Traps this run hit, so nobody re-hits them.** *The city hole, three times:* Piatt's only layer has **no lots in Monticello or Bement** (rural-only "_OLD" copy → a gap); Mercer's county layer (`mercer_parcels/25`) has no lots in Aledo (the city layer is separate) → switched to the single `Parcel/39` layer that has both; Clinton's older `ClintonILFeatures` has none in New Baden → switched to `ClintonCo_Parcel_2` (2025). *Cloudflare 526/522:* the Bhamaps PAT tax-map hosts (`ags.bhamaps.com`, `services2.bhamaps.com`) and Tazewell's old `gis.tazewell.com` answer **526 (the edge rejects their TLS chain)**, Lee's `gis.leecountyil.com` and St. Clair/Macon/Sangamon's older hosts answer **522 (timeout)**, McHenry's `www.mchenrycountygis.org` answers 403 — a Worker cannot reach them, so those counties are gaps until a browser measures them (B2379936); **Tazewell/St. Clair/Sangamon/Macon were reached through their *other* working hosts**. *Pagination-less servers* (Grundy, Coles, Moultrie answer "Pagination is not supported" to `resultRecordCount`) are handled by the existing `arcgis.js` fallback. *Names:* `Parcels_Soils` (Sidwell org) is Fayette's parcel layer (21,756 lots), `Parcels_Clay` is Clay **IL**'s (Clay County IA/NE/KS have their own); the five Illinois "Jefferson/Marion/Washington/Union/Clay…" rows are keyed `il_*` and tested against the Alabama/Missouri/Ohio namesakes.

**Owner names.** 58 of the 62 new rows return an owner; Boone (assessment linework), Greene, Macon and Washington publish none in their public layer. The Devnet/Tyler exports spell the owner a dozen ways, so `appraisal.js` learned `owner1_nam`, `Owner1Name`, `TSC_Owner1/TSC_Name1`, `PrimaryName`, `Primary_Owner`, `OWN_FULL`, `OwnerLastName` and `TAXNAME` (fallback pass only — no existing source changes its answer); `test/illinoisCounties.test.js` pins each.

### The 4 hand-wired counties (re-measured 2026-10-20)

| County | Layer | Measured | Note |
|---|---|---|---|
| Cook | `gis.cookcountyil.gov/…/parcelHistorical/MapServer/2025` | 4/5 · 2/4, 1,432,483 lots | unchanged |
| DuPage | `gis.dupageco.org/…/ParcelsWithRealEstateCC/FeatureServer/0` | 5/5 · 4/4, 337,048 lots | |
| Will | `gis.willcountyillinois.com/…/Parcels_LY_V/MapServer/0` | 5/5 · 2/4, 327,643 lots | the earlier note "idField unconfirmed" is now confirmed: `PIN` |
| Kane | `services1.arcgis.com/oRKmdBXD6EbdmVgJ/…/KaneCo_IL_Parcels/FeatureServer/0` | 4/5 · 4/4, 187,434 lots | |

### Wired this session — 62 counties

| County | Source | Id field | Owner | Address | Measured (interior · line · grid) | Lots | Largest places |
|---|---|---|---|---|---|---|---|
| Adams | ArcGIS Online — AGOL org `BXTAaNPMn1VANOeH` | `PIN` | yes | `SiteAddress` | 5/5 · 3/4+1 · grid 74/74 | 38,785 | Quincy:exact; Camp Point:exact |
| Bond | ArcGIS Online — AGOL org `VbP0KHITyLTMBTy3` | `parcel_number` | yes | `site_address` | 5/5 · 4/4 · grid 76/76 | 14,489 | Greenville:exact; Pocahontas:exact |
| Boone | Boone County GIS (`maps.boonecountyil.org`, via `/gis-proxy`) | `pin` | no | — | 5/5 · 4/4 · grid 49/49 | 24,230 | Belvidere:exact; Candlewick Lake:exact |
| Brown | ArcGIS Online — AGOL org `aHxsJXn8GAlRIIIg` | `PIN` | yes | `site_address` | 5/5 · 3/4+1 · grid 65/65 | 5,616 | Mount Sterling:exact; Versailles:near |
| Bureau | ArcGIS Online — The Sidwell Company org | `PIN` | yes | — | 5/5 · 4/4 · grid 65/65 | 27,696 | Princeton:exact; Spring Valley:exact |
| Christian | ArcGIS Online — AGOL org `Xn3XOQd1zDlYr9z7` | `ParcelNumber` | yes | `SiteAddress` | 4/5+1 · 3/4 · grid 66/66 | 24,347 | Taylorville:exact; Pana:near |
| Clay | ArcGIS Online — The Sidwell Company org | `GIS_Parcel_Number` | yes | `TSC_Site_Address` | 5/5 · 3/4+1 · grid 75/75 | 15,636 | Flora:exact; Louisville:exact |
| Clinton | ArcGIS Online — AGOL org `gnvxvf9aoRBjW15Q` | `GIS_Parcel_Number` | yes | `TSC_Site_Address` | 5/5 · 4/4 · grid 63/63 | 27,086 | Breese:exact; New Baden:near |
| Coles | Coles County GIS (also hosts Moultrie) (`www.colesco.illinois.gov`, via `/gis-proxy`) | `PIN` | yes | `ADDRESS` | 5/5 · 4/4 · grid 41/41 | 28,674 | Charleston:exact; Mattoon:exact |
| Cumberland | ArcGIS Online — AGOL org `wLNQBWR5Fy6KPoGg` | `PIN` | yes | `site_address` | 4/5+1 · 4/4 · grid 81/81 | 11,711 | Neoga:exact; Greenup:exact |
| De Witt | ArcGIS Online — The Sidwell Company org | `ParcelNumber` | yes | `SiteAddress` | 5/5 · 3/4+1 · grid 68/68 | 11,146 | Clinton:exact; Farmer City:exact |
| DeKalb | ArcGIS Online — AGOL org `hEXJrPwm89CLXBYe` | `Parcel_Number` | yes | `SiteAddress` | 4/5+1 · 3/4+1 · grid 81/81 | 45,413 | DeKalb:near; Sycamore:exact |
| Douglas | ArcGIS Online — AGOL org `HXjsHxkFFcZquC8P` | `parcel_num` | yes | `site_addre` | 5/5 · 3/4+1 · grid 79/79 | 15,498 | Tuscola:exact; Arcola:exact |
| Edwards | ArcGIS Online — AGOL org `anr3PwUmzQdlCbyr` | `PIN` | yes | `site_address` | 5/5 · 4/4 · grid 76/76 | 7,574 | Albion:exact; West Salem:exact |
| Effingham | ArcGIS Online — AGOL org `4aeqJB5xSs86LgEv` | `PARCELID` | yes | `SiteAddres` | 5/5 · 4/4 · grid 79/79 | 23,731 | Effingham:exact; Altamont:near |
| Fayette | ArcGIS Online — The Sidwell Company org | `GIS_Parcel_Number` | yes | `TSC_Site_Address1` | 4/5 · 3/4 · grid 54/55 | 21,756 | Vandalia:exact; St. Elmo:near |
| Franklin | ArcGIS Online — AGOL org `gb3yKpyyBmugDAn1` | `parcel_num` | yes | `site_addre` | 4/5+1 · 4/4 · grid 76/76 | 31,515 | West Frankfort:exact; Benton:exact |
| Fulton | ArcGIS Online — AGOL org `O9Z7JkIFFJ6nOIIq` | `PIN` | yes | `site_addre` | 5/5 · 3/4+1 · grid 64/64 | 27,610 | Canton:near; Farmington:near |
| Greene | ArcGIS Online — AGOL org `Ggva1SWphWGX4bb8` | `PIN` | no | `SiteAddres` | 5/5 · 4/4 · grid 68/68 | 11,668 | Carrollton:near; White Hall:exact |
| Grundy | Grundy County GIS (`maps.grundyco.org`, via `/gis-proxy`) | `Grundy_Master.SDEDATA.Parcel_Poly.PIN` | yes | `GrundyParcels.dbo.GISParcelsLegalDescriptionIncluded.SitusAddr1` | 5/5 · 4/4 · grid 49/49 | 27,032 | Morris:exact; Channahon:exact |
| Hamilton | ArcGIS Online — AGOL org `49YxBsMNEjT1wN6z` | `PIN` | yes | `SitusAddress1` | 5/5 · 4/4 · grid 81/81 | 10,514 | McLeansboro:exact; Dahlgren:near |
| Hancock | ArcGIS Online — AGOL org `BN5dINZZvv0oeIev` | `parcel_number` | yes | `site_address` | 4/5+1 · 2/4+2 · grid 69/70 | 21,182 | Hamilton:exact; Carthage:exact |
| Henderson | Western Illinois University GIS Center (`gis.wiu.edu`, via `/gis-proxy`) | `PIN_Dash` | yes | `site_addre` | 5/5 · 2/4+1 · grid 29/30 | 8,105 | Oquawka:exact; Stronghurst:exact |
| Henry | ArcGIS Online — The Sidwell Company org | `ParcelNumber_Formatted` | yes | `location_addr` | 5/5 · 3/4+1 · grid 76/76 | 31,949 | Kewanee:near; Geneseo:near |
| Iroquois | ArcGIS Online — AGOL org `6FZQl5a5SiSFMv8P` | `ParcelNumber` | yes | `SiteAddress` | 5/5 · 4/4 · grid 81/81 | 28,244 | Watseka:near; Gilman:exact |
| Jackson | ArcGIS Online — AGOL org `lNrzIHYICuzkgTNM` | `PIN` | yes | `site_addre` | 5/5 · 4/4 · grid 64/64 | 34,208 | Carbondale:exact; Murphysboro:near |
| Jefferson | ArcGIS Online — The Sidwell Company org | `PIN` | yes | `site_address` | 4/5+1 · 4/4 · grid 81/81 | 30,903 | Mount Vernon:exact; Ina:near |
| Johnson | ArcGIS Online — AGOL org `kVhBUtzgRFJZxuuX` | `PIN` | yes | `site_addre` | 5/5 · 4/4 · grid 75/75 | 12,995 | Vienna:exact; Goreville:exact |
| Kankakee | ArcGIS Online — AGOL org `wtCeg7DiC1GyX2L9` | `pin` | yes | `site_address` | 5/5 · 4/4 · grid 69/72 | 54,929 | Kankakee:exact; Bourbonnais:exact |
| Kendall | Kendall County GIS (`maps.co.kendall.il.us`, via `/gis-proxy`) | `pin` | yes | `site_address` | 5/5 · 4/4 · grid 49/49 | 61,893 | Oswego:exact; Yorkville:exact |
| Knox | Knox County GIS (`gis.knoxcountyil.gov`, via `/gis-proxy`) | `TaxParcel.PARCELID` | yes | `GIS_Table.dbo.gis_data.site_addr` | 5/5 · 4/4 · grid 49/49 | 33,239 | Galesburg:exact; Abingdon:exact |
| LaSalle | LaSalle County GIS (`gis.lasallecounty.org`, via `/gis-proxy`) | `PIN` | yes | `SiteAddress` | 5/5 · 4/4 · grid 39/39 | 72,236 | Ottawa:exact; Streator:exact |
| Lake | Lake County CCAO (`maps.lakecountyil.gov`, via `/gis-proxy`) | `PIN` | yes | `situs_addr_line_1` | 5/5 · 4/4 · grid 43/43 | 278,986 | Waukegan:near; Buffalo Grove:exact |
| Lawrence | ArcGIS Online — AGOL org `AtoBX9sHdZu4i3gx` | `GISPin` | yes | `SiteAddress` | 5/5 · 4/4 · grid 71/71 | 14,914 | Lawrenceville:near; Sumner:exact |
| Logan | ArcGIS Online — AGOL org `pPTAs43AFhhk0pXQ` | `parcel_number` | yes | `site_address` | 5/5 · 4/4 · grid 75/75 | 18,976 | Lincoln:exact; Atlanta:near |
| Macon | ArcGIS Online — AGOL org `a3k0qIja5SolIRYR` | `PIN` | no | `SiteAddres` | 5/5 · 4/4 · grid 72/72 | 57,096 | Decatur:exact; Mount Zion:exact |
| Madison | Madison County CCAO GIS (`gisportal.co.madison.il.us`, via `/gis-proxy`) | `PIN` | yes | — | 5/5 · 4/4 · grid 43/43 | 136,799 | Granite City:exact; Edwardsville:exact |
| Marion | ArcGIS Online — AGOL org `bcQYzj0jmLWRU0zq` | `PIN` | yes | `site_address` | 5/5 · 4/4 · grid 81/81 | 33,867 | Centralia:near; Salem:exact |
| Marshall | ArcGIS Online — The Sidwell Company org | `ParcelNumber` | yes | `SiteAddress` | 5/5 · 4/4 · grid 67/67 | 13,245 | Henry:near; Lacon:exact |
| McDonough | Western Illinois University GIS Center (`gis.wiu.edu`, via `/gis-proxy`) | `PARCELID` | yes | `site_address` | 5/5 · 4/4 · grid 49/49 | 18,353 | Macomb:exact; Bushnell:exact |
| McHenry | ArcGIS Online — AGOL org `6iYC5AXXYapRVNzl` | `ParcelNumber` | yes | `SiteAddress` | 4/5+1 · 4/4 · grid 81/81 | 150,153 | Crystal Lake:exact; Algonquin:exact |
| McLean | McLean County GIS Consortium (`www.mcgisweb.org`, via `/gis-proxy`) | `Dash_PIN` | yes | `address1` | 5/5 · 3/4+1 · grid 43/43 | 71,486 | Bloomington:exact; Normal:exact |
| Mercer | ArcGIS Online — AGOL org `p5CKEkDVdYePfy0g` | `PIN` | yes | `site_address` | 5/5 · 2/4+2 · grid 74/74 | 14,012 | Aledo:near; Viola:exact |
| Monroe | ArcGIS Online — AGOL org `AZVIEb4WFZST2UYx` | `PARCEL_NUM` | yes | `SiteAdd` | 5/5 · 4/4 · grid 45/45 | 19,623 | Waterloo:exact; Columbia:exact |
| Morgan | ArcGIS Online — AGOL org `95PFahBF8eyGEfuc` | `pin` | yes | `site_addre` | 5/5 · 4/4 · grid 51/51 | 22,489 | Jacksonville:near; South Jacksonville:near |
| Moultrie | Coles County GIS (also hosts Moultrie) (`www.colesco.illinois.gov`, via `/gis-proxy`) | `ParcelNumber` | yes | `SiteLocation` | 5/5 · 4/4 · grid 38/38 | 11,520 | Sullivan:exact; Bethany:exact |
| Peoria | ArcGIS Online — AGOL org `iPiPjILCMYxPZWTc` | `PIN` | yes | `prop_street` | 5/5 · 3/4+1 · grid 57/57 | 90,357 | Peoria:exact; Chillicothe:exact |
| Putnam | ArcGIS Online — AGOL org `Z2F3lckKXNBvWQZU` | `ParcelNumber` | yes | `SiteAddress` | 5/5 · 3/4+1 · grid 57/58 | 7,538 | Granville:exact; Hennepin:exact |
| Randolph | ArcGIS Online — AGOL org `pweYHqdOby1TE9DD` | `parcel_num` | yes | `site_addre` | 5/5 · 3/4+1 · grid 52/52 | 26,113 | Chester:exact; Sparta:exact |
| Rock Island | ArcGIS Online — AGOL org `6FnscPPlUa9DXXOk` | `PIN` | yes | `site_address` | 4/5+1 · 3/4+1 · grid 24/24 | 65,909 | Moline:exact; Rock Island:exact |
| Sangamon | SANGIS (Sangamon County) (`sangis.co.sangamon.il.us`, via `/gis-proxy`) | `SOA.SANGIS.Parcel_Poly.PIN` | yes | — | 5/5 · 4/4 · grid 34/34 | 105,146 | Springfield:exact; Chatham:exact |
| Schuyler | ArcGIS Online — AGOL org `6WBCrIMyoycGocqb` | `parcel_number` | yes | `site_address` | 5/5 · 4/4 · grid 45/45 | 9,114 | Rushville:exact; Littleton:exact |
| St. Clair | St. Clair County Assessor (`arcgispublicmap.co.st-clair.il.us`, via `/gis-proxy`) | `parcelid` | yes | `address` | 3/5+2 · 4/4 · grid 38/38 | 147,988 | Belleville:exact; O'Fallon:exact |
| Stark | ArcGIS Online — AGOL org `IMZwRRU1qL5MDxBH` | `ParcelNumber` | yes | `SiteAddress` | 5/5 · 4/4 · grid 72/72 | 6,089 | Wyoming:near; Toulon:near |
| Tazewell | Tazewell County GIS (`gis.tazewell-il.gov`, via `/gis-proxy`) | `PIN` | yes | `site_address` | 5/5 · 4/4 · grid 32/32 | 68,098 | Pekin:near; East Peoria:exact |
| Union | ArcGIS Online — DEVNET org | `parcel_num` | yes | `site_addre` | 4/5+1 · 1/4+3 · grid 70/72 | 12,741 | Anna:exact; Jonesboro:exact |
| Washington | ArcGIS Online — DEVNET org | `PIN` | no | — | 5/5 · 4/4 · grid 74/74 | 20,575 | Nashville:exact; Okawville:near |
| Wayne | ArcGIS Online — AGOL org `uPUVi2srVxNIkSU7` | `ParcelNumber` | yes | `SitusAddress1` | 5/5 · 4/4 · grid 81/81 | 20,544 | Fairfield:exact; Wayne City:near |
| White | ArcGIS Online — The Sidwell Company org | `PIN` | yes | `site_address` | 5/5 · 4/4 · grid 69/69 | 20,948 | Carmi:exact; Grayville:exact |
| Whiteside | ArcGIS Online — AGOL org `l0M0OC6J9QAHCiGx` | `PARCELID` | yes | `SITEADDRESS` | 5/5 · 4/4 · grid 74/74 | 36,481 | Sterling:near; Rock Falls:exact |
| Winnebago | City of Rockford GIS (Winnebago ownership layer) (`rockgis.rockfordil.gov`, via `/gis-proxy`) | `DashPIN` | yes | — | 5/5 · 4/4 · grid 46/46 | 127,957 | Rockford:near; Loves Park:exact |
| Woodford | ArcGIS Online — AGOL org `iOG1OLysrxLAswZi` | `Parcel_Number` | yes | `Site_Address_1` | 5/5 · 3/4+1 · grid 61/61 | 26,041 | Eureka:exact; Metamora:exact |

### The 36 named gaps (each with a recorded, re-searched reason)

Kinds: `none-found` (nothing public anywhere we looked) · `relay-tls` (a real public service the relay cannot reach — a build/measure item, **not** a data gap: B2379936) · `token-required` (the host asks for a key; none is replayed) · `adapter-needed` (a vendor viewer in a format Planyr does not read — B2379937) · `partial-copy` (only a dated / rural-only / one-city copy exists).

| County | Kind | Why (after the re-search above) |
|---|---|---|
| Alexander | `none-found` | Alexander County (pop. ~5k) has no GIS organisation, web map or REST host in any listing. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Calhoun | `none-found` | Calhoun's only public ArcGIS items (Western Illinois University's West Central Illinois basemap services) carry addresses, roads and section lines but no parcel layer. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Carroll | `token-required` | The county's parcel layer (Carrol_County_Base_Data, services6.arcgis.com/qv1nlKGEXHyUgE2M, layer 3 in the 'Parcels - IL' index) answers 'Token Required' (499) to an anonymous request, and a public web map that embeds it asks for a sign-in. Planyr does not replay or harvest a key. |
| Cass | `none-found` | Cass County's AGOL organisation (CassCountySIDs, survey blocks, flood areas) holds no parcel layer. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Champaign | `none-found` | The Champaign County GIS Consortium and the City of Champaign (gisportal.champaignil.gov, aerial and open-data services only) publish no anonymous parcel REST layer. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Clark | `none-found` | The 'Clark County' parcel layers in the AGOL crawl belong to other states' Clark Counties (Nevada, Washington …); none is in Illinois. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Crawford | `none-found` | Crawford's 'Parcels - IL' index entry (CrawfordILFeatures on services.arcgis.com/4YineAQdtmx0tv46, The Sidwell Company's org) no longer exists — the org's 1,182 services were listed on 2026-10-20 and none is a Crawford County parcel layer (Crawford IA, Robinson address points and a 911 org are all that remain). |
| Edgar | `relay-tls` | The county's assessor tax-map service is real and public (EdgarIL_PAT_Taxmap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Ford | `relay-tls` | The county's assessor tax-map service is real and public (FordIL_Taxmap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Gallatin | `none-found` | The only 'Gallatin County' parcel layers on AGOL belong to Gallatin County, Montana. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Hardin | `none-found` | Hardin County's AGOL organisations (hardincounty, hardinassessor) hold no public Illinois parcel layer; the 'Hardin' items are Hardin County, Texas/Kentucky/Ohio. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Jasper | `none-found` | The only Jasper parcel items on AGOL are Jasper County, Missouri's and a polyline 'Jasper_Parcels' layer of another state; Jasper County IL has no public layer. |
| Jersey | `partial-copy` | The only Jersey County layer is a 2019 flood-mitigation extract for the village of Grafton (Grafton__IL_WFL1, 14,773 lots, only 1 of 4 county-line points answer); the 'Parcels - IL' index entry (JerseyILFeatures) is gone from The Sidwell Company's org. A dated partial working copy is not a county source. |
| Jo Daviess | `token-required` | Jo Daviess County publishes a free Public Map Portal and a Karst portal at gismaps.jodaviesscountyil.gov, but parcel information, addresses and orthophotography sit in its paid SUBSCRIPTION Map Portal (per the county GIS page); no anonymous parcel layer is public. Planyr does not buy, replay or harvest a subscription. |
| Lee | `relay-tls` | Lee County's parcel service (gis.leecountyil.com/server/rest/services/Parcel_Polygons/MapServer/0, named in the 'Parcels - IL' index) times out from the relay (Cloudflare 522, the origin does not answer the edge), and the county's other host (gis.leecountyil.gov Parcel_Points) publishes parcel POINTS only, no polygons. Not wired; B2379936 re-measures it from a browser. |
| Livingston | `token-required` | Livingston County GIS (livgov.maps.arcgis.com) publishes a public Parcel Viewer, but the parcel service behind it (utility.arcgis.com/usrsvcs/servers/eb4804bdc78942118a68040cbdd30c9e/rest/services/AGO/Parcels/MapServer, named by its 'Tax Parcels' web map) answers 'You do not have permissions to access this resource' (403, GWM_0003) to an anonymous request. Planyr does not replay or harvest an organisation login. |
| Macoupin | `relay-tls` | The county's assessor tax-map service is real and public (MacoupinIL_PAT_Taxmap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Mason | `none-found` | The AGOL 'Mason County' parcel items are Mason County in Washington/Kentucky/West Virginia; Mason County IL publishes none. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Massac | `relay-tls` | The county's assessor tax-map service is real and public (MassacIL_PAT_TaxMap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Menard | `relay-tls` | The county's assessor tax-map service is real and public (AGS_menard_co_il_taxmap/MapServer/0 on services2.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Montgomery | `none-found` | The 'Montgomery County' hits are Montgomery County in Pennsylvania, Maryland, Ohio and Texas. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Ogle | `adapter-needed` | Ogle County's parcel map is a Schneider 'Beacon' application linked from oglecountyil.gov/departments/gis (per the assessor-search listing; the sandbox cannot open the county site). Beacon serves tiles and a proprietary search, not an ArcGIS REST layer a click can query; building a Beacon adapter would also unlock other Beacon counties and is filed as B2379937. |
| Perry | `token-required` | Perry County's layer (PerryILFeatures, services7.arcgis.com/1kfqC9OkmKEknhe1, in the 'Parcels - IL' index) answers 'Token Required' (499); the only anonymous Perry item is the Pinckneyville enterprise-zone parcel extract (11,391 lots, 2 of 5 interior points answer), which is a slice, not the county. |
| Piatt | `partial-copy` | The only Piatt layer, 'IL_Piatt_County_Parcels_OLD' (services9.arcgis.com/OjHfU34Et3kVRT5y, 4,501 lots), has no lots inside Monticello or Bement — a point at downtown Monticello and one at Bement both return nothing — so it is a rural-only dated working copy (the city-hole trap), not a county source. |
| Pike | `none-found` | The AGOL 'Pike County' parcel layers are Pike County in Colorado (PPACG) and Missouri; none is Illinois. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Pope | `none-found` | Pope County's AGOL organisation (popecountyil) is empty of public items. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Pulaski | `none-found` | The 'Pulaski County' items are Arkansas/Missouri/Kentucky (pagis.org is Pulaski County, Arkansas). No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Richland | `none-found` | The only Richland parcel item is the University of South Carolina's (USC_System_Parcels); Richland County IL has none. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Saline | `none-found` | The 'Saline County' items are Arkansas/Kansas/Missouri/Nebraska; the 'salineassessor' org is not Illinois. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Scott | `none-found` | The 'Scott County' items are Iowa, Minnesota, Missouri (semogis) and Kentucky layers; none is Scott County, Illinois. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Shelby | `relay-tls` | The county's assessor tax-map service is real and public (ShelbyIL_PAT_Taxmap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Stephenson | `none-found` | Stephenson County has no GIS organisation or REST host in any listing. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Vermilion | `relay-tls` | The county's assessor tax-map service is real and public (VermilionIL_PAT_Parcel_Taxmap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |
| Wabash | `none-found` | The only Wabash item is a county-boundary layer. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Warren | `none-found` | The 'Warren County' parcel layers are New Jersey's; Western Illinois University's Monmouth service (Warren County's seat) carries addresses, zoning and city limits but no parcel layer. No public ArcGIS REST parcel layer for the county exists in any of those; the county's assessor roll is published only through a vendor viewer or a search page. |
| Williamson | `relay-tls` | The county's assessor tax-map service is real and public (WilliamsonIL_PAT_Taxmap/MapServer/0 on ags.bhamaps.com, listed in the 'Parcels - IL' index), but Planyr's relay cannot reach it: Cloudflare answers 526 (the host's TLS certificate chain is rejected from the edge), and the sandbox cannot reach the host directly. Not wired because a source nobody could measure may not ship; B2379936 re-measures it from a browser that accepts the chain (the owner's chat), and wires it if it answers with CORS or through a fixed relay. |

**Re-run recipe.** The discovery scripts are throw-away; the method is above and each gap's reason is in its table row. A county leaves the gap list the day a current, countywide layer with a parcel id is found *and* answers at the county's two largest places: add its row to `ilParcels.js` (+ `ilProvenance.js`), drop it from `test/fixtures/ilCounties.json` `gaps`, record its sample in `ilSamples.json`, and measure it the way the paragraph above says (a directory walk of the host beats a title search — that is how Madison, Tazewell, Sangamon, Knox and Coles' new domain were found).

## New Jersey municipalities (2026-10-20)

**Result: all 564 municipalities in 21 counties are covered by ONE source. No municipality is uncovered, and nothing needed a county-level row.** (B2384880.)

- **Source:** NJOGIS's own ArcGIS Online copy of the statewide composite — `services2.arcgis.com/XVOqAjTOJ5P6ngMu/.../Parcels_Composite_NJ_WM/FeatureServer/0` (item `533599bb…`, owner NJOGIS; "Parcels and MOD-IV Composite of NJ, Web Mercator"). Chosen over `maps.nj.gov` because that host is blocked from the build sandbox (unmeasurable) and the mirror is official, answers with `access-control-allow-origin: *` (no relay needed) and is the same composite. `maps.nj.gov` was therefore NOT added to the `/gis-proxy` allow-list.
- **Measured 2026-10-20 (direct, from the sandbox):** 3,481,240 polygons · `esriGeometryPolygon` · `maxRecordCount` 2000 · JSON/geoJSON/PBF · point query 0.28–0.66 s (12 city points). Fields: `PAMS_PIN` (parcel id; pinned as `idField`), `PROP_LOC` (property location; pinned as `addrField` and added to the situs ladder), `OWNER_NAME`, `ST_ADDRESS` / `CITY_STATE` / `ZIP_CODE` (the OWNER's mailing lines — now excluded from situs), `CALC_ACRE`, `MUN_NAME`, `COUNTY`, `PCL_MUN`, land/improvement/net value, deed, sale, year built.
- **Owner names are blank** in this public copy ("`OWNER_NAME` is redacted per Daniel's Law for public web access" — the service's own description). Source's choice; no non-redacted copy was sought. The card shows parcel id, address, acreage (measured from the ring) and values.
- **Municipality proof:** a group-by on `PCL_MUN` returns exactly 564 codes, every one with MOD-IV attributes; one real parcel (up to three) was then fetched per municipality and routed through the app's own resolver (`test/newJerseyMunicipalities.test.js`, fixture `test/fixtures/njMunicipalities.json`, 1,692 points). ~11% of parcels (403,260) carry geometry with no MOD-IV match (right-of-way / unmatched) and answer with lot lines only.

| County | Municipalities | Parcels |
|---|---|---|
| Atlantic | 23 | 144,352 |
| Bergen | 70 | 281,646 |
| Burlington | 40 | 174,852 |
| Camden | 36 | 191,292 |
| Cape May | 16 | 95,290 |
| Cumberland | 14 | 63,411 |
| Essex | 22 | 178,089 |
| Gloucester | 24 | 112,792 |
| Hudson | 12 | 143,305 |
| Hunterdon | 26 | 52,902 |
| Mercer | 12 | 127,186 |
| Middlesex | 25 | 243,019 |
| Monmouth | 53 | 249,796 |
| Morris | 39 | 177,533 |
| Ocean | 33 | 299,346 |
| Passaic | 16 | 125,785 |
| Salem | 15 | 31,223 |
| Somerset | 21 | 117,387 |
| Sussex | 24 | 74,214 |
| Union | 21 | 147,628 |
| Warren | 22 | 46,932 |

- **Routing defect found and fixed.** The bundled county polygons stop short of the shore: 87 of the 1,692 sampled lots (Atlantic City, Brigantine, Margate, Ventnor, Longport, Cape May, Long Beach Island, Seaside Heights, Sea Bright, Highlands …) fell in no county, so a click there queried nothing. `counties.js` `njCoastalGapState` now routes a point that no county polygon holds but that sits in New Jersey's envelope to `nj_statewide` (never overrides a real county answer). Red on main eccb06e: 88 failures; green after.
- **State lines (NJ/NY, NJ/PA):** a NJ-side point either resolves to NJ directly or, when the simplified line puts it across, is reached by the existing second pass (`lineNeighbourKeysForPoint` → `identifyWithFallback`). All 1,692 samples reach `nj_statewide` by one of the two. The Phillipsburg riverfront no longer lists `pa_northampton` first. The NY side belongs to the sibling NY work.
- **Pinelands (`Pinelands_Parcels`, 622,323 features):** not needed — the statewide composite covers the Pinelands municipalities (e.g. Shamong, Washington Twp); kept only as a documented fallback.
- **Not verified here (live check pending, V1813264):** the in-app click at a Newark lot, a Cape May lot and a Delaware River town lot.


## New York counties (2026-10-20) — 61 of 62 reachable (38 statewide layer + 23 county rows), Niagara a named gap (NEW-1, B2387344)

Owner request "wire up all cities in NJ, NY", New York only (NJ is a sibling session). New York assesses by city/town, but the layers are county-wide, so the coverage unit is the county.

**What was measured.** `NYS_Tax_Parcels_Public` (NY's own AGOL mirror, org NYSGIS_GPO, `FeatureServer/1`, 3,827,530 parcels) is documented as "only counties that gave ITS permission to share" — its Footprint layer `/0` and a per-county count of `/1` agree: **38 counties** (Albany, Bronx, Broome, Cayuga, Chautauqua, Cortland, Erie, Genesee, Greene, Hamilton, Kings, Lewis, Livingston, Montgomery, New York, Oneida, Onondaga, Ontario, Orange, Oswego, Otsego, Putnam, Queens, Rensselaer, Richmond, Rockland, Schuyler, St. Lawrence, Steuben, Suffolk, Sullivan, Tioga, Tompkins, Ulster, Warren, Wayne, Westchester, Wyoming). **The other 24** are listed in `nyParcels.js` `NY_UNCOVERED` and are now `excludedCounties` on `ny_statewide`, so a click there is never sent to a layer that holds none of it. No newer or fuller statewide polygon layer exists on AGOL (the "Tax Parcel Centroid Points" layer is points and not usable for click routing; `gisservices.its.ny.gov`/`gisservices.dec.ny.gov` are blocked here and the DEC copy is 2016).

**NYC.** All five boroughs answer from the statewide layer (14 of 20 spread points returned a lot with an owner; the 6 misses were streets/water). **Defect found and fixed:** `MUNI_PARCEL_ID`, `PRINT_KEY` and `ACRES` are blank for every NYC lot and for many Suffolk lots (874k lots layer-wide), so the card showed no parcel id. `appraisal.js` now falls back to `PRINT_KEY` then `SWIS_SBL_ID`; acreage already read `CALC_ACRES`.

**How the 24 were searched.** ArcGIS Online item search bbox-filtered per county (8 queries × feature/map services), then every candidate layer probed for geometry, count, extent and columns; owner accounts and org content read to tell a county's own publication from a student, consultant or land-trust copy; county web pages and vendor viewers (VHB, DANC, Schneider/Beacon); then the hosts the sandbox blocks were measured through the planyr relay on the PR preview (the 10 hosts added to `functions/gis-proxy`). Each wired row: 8 spread interior points inside the county polygon plus up to 3 near-line points, one lot with an id per point.

| County | Key | Source | Lots | Owner | Edited / roll | Notes |
|---|---|---|---|---|---|---|
| Allegany | `ny_allegany` | county 911/GIS AGOL org | 34,683 | yes | 2026-08 | a few road/river polygons (Printkey "Road") |
| Cattaraugus | `ny_cattaraugus` | county's own server maps2.cattco.org (relay) | 50,326 | yes | — | AGOL copies are partial |
| Chemung | `ny_chemung` | county AGOL `Parcels_2024` | 39,477 | yes | 2024-05 | older org copies hold every lot twice — avoided |
| Chenango | `ny_chenango` | **LaBella consultant** AGOL working layer (Regrid-sourced) | 34,526 | yes | 2026-06 | not the county; see caveats |
| Clinton | `ny_clinton` | county GIS AGOL | 38,414 | yes | 2026-08 | Plattsburgh included |
| Columbia | `ny_columbia` | county AGOL (federated) | 36,033 | **no** | 2026-07 | a 2021 copy with owners exists, not used |
| Delaware | `ny_delaware` | county COMIT viewer, VHB server (relay) | 43,036 | yes | roll 2025 | |
| Dutchess | `ny_dutchess` | **unconfirmed AGOL account** (county grid schema) | 109,728 | **no** | 2025-09 | no owner/acres/address; county sells parcels |
| Essex | `ny_essex` | county RPTS AGOL | 36,052 | yes | 2026-07 | `ADDRESS` is the owner's mailing address — `LOCATION` wired |
| Franklin | `ny_franklin` | DANC `Parcel_Model` (relay), `COUNTY='FRANKLIN'` | 34,620 | yes | — | |
| Fulton | `ny_fulton` | NYS Dept. of State Mohawk layer, `County='Fulton'` | 33,355 | **no** | data 2023-01 | weakest row; county viewer host did not resolve |
| Herkimer | `ny_herkimer` | **Byer Planning consultant** AGOL (Regrid-derived) | 41,642 | yes | 2025-09 | fallback: Mohawk layer |
| Jefferson | `ny_jefferson` | DANC `Parcel_Model` (relay), incl. City of Watertown | 58,599 | yes | — | beats the county account's septic-grant map (no Watertown) |
| Madison | `ny_madison` | county AGOL `2024 Tax Parcels` | 37,460 | **no** | roll 2024 | |
| Monroe | `ny_monroe` | county DES `Parcels_Public` (relay) | 267,962 | **no** | 2025 | the AGOL republish with owners is the 2020 roll |
| Nassau | `ny_nassau` | **Peconic Land Trust** republish of the 2020 roll | 420,594 | yes | data 2020 | stalest row; county viewer has no public REST |
| Niagara | — | **named gap** | — | — | — | see below |
| Orleans | `ny_orleans` | county AGOL | 20,588 | yes | 2025-09 | no acres column |
| Saratoga | `ny_saratoga` | county AGOL | 102,623 | yes | 2026-09 | stacked condo polygons |
| Schenectady | `ny_schenectady` | county SIMS, VHB server (relay) | 59,320 | yes | 2026-03 | state DHSES copy is the fallback |
| Schoharie | `ny_schoharie` | county RPTO AGOL | 23,123 | yes | 2026-06 | |
| Seneca | `ny_seneca` | county AGOL | 17,597 | yes | 2024-10 | |
| Washington | `ny_washington` | county GIS (relay) | 35,386 | yes | roll 2025 | consultant AGOL copy built on Regrid not used |
| Yates | `ny_yates` | county GIS portal (relay) | 15,720 | yes | roll — | |

**Niagara — a gap, and why (not "no source").** The county's parcels live on `gis.niagaracounty.com` (`NC_GIS/NC_GIS` MapServer layer 4, from the county's own catalogue entry). On 2026-10-20 that host answered only *"Could not access any server machines"* (ArcGIS Server down) on every REST path and HTTP 500 on its portal, through the relay. Everything else found is partial or locked: the county AGOL `Map_TEMP` "Niagara County NY Parcels" is token-gated, a consultant study copy covers only the north-west towns (all 9 county test points missed), a 2023 copy has 3,320 lots. Re-test when the county server is back (one request: `…/NC_GIS/NC_GIS/MapServer/4?f=json`) — wiring it is then a one-line row.

**Caveats for the owner (not blockers).**
- Four counties are not county publications: Chenango and Herkimer are consultant working layers built on Regrid-sourced data (they could be removed, and Regrid's licence on redistribution is the owner's call); Nassau is a land trust's republish of the 2020 roll; Dutchess is an unconfirmed account. Each is labelled `third-party` in `nyProvenance.js`. Swap when the county publishes.
- No owner column: Columbia, Dutchess, Fulton, Madison, Monroe (the public layers omit it; a click returns the lot, id and acreage).
- Lots whose attributes the county blanks (state land, condos) return what the layer holds.
- Outline floors: every county row with a dense town draws outlines from zoom 16 (Nassau and Monroe 17) because the layers answer at most 2,000 lots per query; Essex, Schoharie and Washington are sparse enough to draw from the generic floor.
- Edge points: misses near the line fell on the Hudson, Lake Champlain, Cayuga/Seneca lakes or roads; none was a second lot.
## Iowa counties (2026-10-19) — 56 of 99 wired

**Owner request 2026-10-19:** "start wiring all the remaining states into Planner" (Iowa only in this session). Before this pass one county was wired (Polk, `ia_polk`); the 2026-09-09 statewide probe's "no-free-source" for Iowa is **superseded** — it was run from an egress-limited sandbox before pass 2 and before `/gis-proxy`. There is still no *current* free statewide layer (`Iowa_Parcels_2017`, mirrored from HSEMD's deprecated `eoc.iowa.gov` server, is frozen at 2017-11-02 and is not used by any row; the 3-county `Iowa_Parcels_Demo` subset of the same data is not used either).

**What carries Iowa's parcels (the finding that explains most of the map).** Iowa assessors mostly use Schneider Geospatial's **Beacon** viewer, which has no query service of its own — but Schneider also runs a public ArcGIS server, `wfs.schneidercorp.com`, with one anonymous MapServer per Beacon county (38 Iowa county services at measurement time: `<County>CountyIA_WFS`, Hardin's is `HardinCountyIA_AGS`). Its Parcels layer is a polygon layer carrying the parcel number and, for most counties, the deed holder. **23 counties come from that feed** (Adair, Buena Vista, Cass, Chickasaw, Clinton, Franklin, Guthrie, Hamilton, Hardin, Harrison, Humboldt, Iowa, Jasper, Jefferson, Louisa, Lyon, Mahaska, Osceola, Wapello, Webster, Winnebago, Worth, Wright); nine further counties that also appear there keep the county-published ArcGIS Online layer instead (Benton, Butler, Cedar, Cerro Gordo, Clayton, Delaware, Floyd, Mitchell, Monona). The feed is read anonymously with no key; no Beacon page is scraped. The remaining wired counties are county-published ArcGIS Online layers (Black Hawk, Boone, Bremer, Buchanan, Crawford, Decatur, Dickinson, Grundy, Johnson, Kossuth, Lee, Linn, Marshall, Mills, Scott, Story, Warren, Wayne, Winneshiek, Woodbury) or county servers reached through the relay (Dallas, Muscatine/MAGIC, Pottawattamie).

**How it was searched (a gap is a finding, not a disposition).** (1) ArcGIS Online item search bbox-filtered to Iowa — ~15,800 Feature/Map services, ~500 polygon layers probed for extent, count and fields; (2) three phrasings of per-county searches on ArcGIS Online and ArcGIS Hub for all 99 counties; (3) ~5,500 Iowa web maps' operational layers read for their real server hosts (that is how the Dallas, Muscatine, Pottawattamie and Schneider hosts were found); (4) the candidate hosts, with the county directories read through the `/gis-proxy` relay on this PR's preview deploy (non-AGOL hosts are unreachable from the sandbox); (5) web search for each of the 71 counties without an ArcGIS Online layer, split across six parallel research passes. **Currency rule:** a county layer last edited before 2020-01-01 is not wired (Jackson 2019, Ringgold 2015 package; Cass's 2017 layer was replaced by Schneider's feed). Each wired row: polygons with a parcel id returned at 5 spread interior points and 4 points just inside the county line (test points computed from the repo's own county polygons; fixture `test/fixtures/iaCounties.json`), extent inside Iowa and the named county, count recorded. Test artifacts: `test/iowaCounties.test.js` + `iaCounties.json` / `iaSamples.json` (a recorded real attribute bag per source). **Red-proof:** on main 70a26e2 only Polk was wired; with the `iaRaw()`/`iaMap()` spreads removed 116 of the 1,112 assertions go red. Owner resolution: the Iowa CAMA exports spell the owner `DEEDHOLD` / `DeedHolder1` / `DEEDHLDR` / `Tyler_Deed_Holder` / `PRIMARYNAME1` / `OwnerDeed`; those spellings were added to `OWNER_KEY_RE` (`appraisal.js`) or 26 wired counties would have shown no Owner line.

**Eight larger Iowa cities run their own City Assessor** (Cedar Rapids, Iowa City, Des Moines, Davenport, Dubuque, Council Bluffs, Waterloo, Sioux City…); the county layers above cover each county's whole area including its cities (extent and spread points measured county-wide; coverage inside each individual city was not separately measured), so no city scope is added.

**Named gaps (43).** Beacon-only counties with no query service, six CAMAvision counties waiting on the adapter build item B2317681 (data exists; format not read yet), one login-gated Integrity GIS site (Taylor), one county server the relay cannot reach (Dubuque), and counties where no viewer vendor or service could be found. The sentence the app shows is the existing "<County> — no parcel data wired here yet." and each reason below was re-searched.

| County | Status | Source | Owner | Notes / what was searched |
|---|---|---|---|---|
| Adair | **new 2026-10-19** | Schneider Geospatial county feed `AdairCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 14,687 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Adams | **gap** — "Adams County — no parcel data wired here yet." | none usable | — | _beacon-only_: County parcels are viewed through Schneider Beacon (per a third-party county guide); Beacon exposes no query service. An ArcGIS Online 'Parcels' layer found for 'Adams County' is Adams County, Wisconsin (extent near -90,44) and was rejected. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Allamakee | **gap** — "Allamakee County — no parcel data wired here yet." | none usable | — | _beacon-only_: Assessor and parcel viewer is Schneider Beacon only (per the AssessorSearch listing); searches of ArcGIS Online by county name returned only school districts and a spring inventory, no parcel layer. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Appanoose | **gap** — "Appanoose County — no parcel data wired here yet." | none usable | — | _no-source-found_: County-name searches (web and ArcGIS Online, three phrasings each) found no county GIS page, viewer vendor or parcel layer — only historical maps and listings. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Audubon | **gap** — "Audubon County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon viewer per a third-party county guide. Schneider's feed carries only a CityOfAudubon service (the town, not the county); ArcGIS Online has no Audubon parcel layer. |
| Benton | **new 2026-10-19** | AGOL `Benton_County_IA_Parcels/FeatureServer/0` — ArcGIS Online account dave.tenney_evsketchinspect | yes | 17,744 parcels; interior hits 5/5, near-line 4/4; layer edit date 2024-06-25 |
| Black Hawk | **new 2026-10-19** | AGOL `ParcelFabricPublished_gdb/FeatureServer/15` — Black Hawk County GIS | yes | 76,158 parcels; interior hits 4/5, near-line 4/4; layer edit date 2026-10-09 |
| Boone | **new 2026-10-19** | AGOL `County_Owned_Properties__Boone_IA_WFL1/FeatureServer/1` — Boone County GIS | yes | 24,493 parcels; interior hits 5/5, near-line 4/4; layer edit date 2021-06-08 |
| Bremer | **new 2026-10-19** | AGOL `Bremer_County_Reference_Map/FeatureServer/8` — Bremer County GIS | yes | 20,072 parcels; interior hits 3/5, near-line 4/4; layer edit date 2026-02-03 |
| Buchanan | **new 2026-10-19** | AGOL `Buchanan_Parcels/FeatureServer/0` — ArcGIS Online account esinnott1 | yes | 21,606 parcels; interior hits 4/5, near-line 4/4; layer edit date 2026-09-29 |
| Buena Vista | **new 2026-10-19** | Schneider Geospatial county feed `BuenaVistaCountyIA_WFS/MapServer/1` (relay) — Schneider Geospatial's county feed | yes | 19,797 parcels; interior hits 5/5, near-line 3/4; layer edit date n/a (live server) |
| Butler | **new 2026-10-19** | AGOL `Parcels_Backfilled/FeatureServer/0` — Schneider Geospatial parcel fabric for Butler County | **no** | 14,044 parcels; interior hits 5/5, near-line 3/4; layer edit date 2026-06-01 |
| Calhoun | **gap** — "Calhoun County — no parcel data wired here yet." | none usable | — | _city-only_: The only public Iowa layer is Lake City's own (ArcGIS Online LakeCity51449, 1,377 parcels, last edited 2018-06) — one town, stale. The 'Calhoun County parcel viewer' host gis.calhouncounty.org is Calhoun County, ALABAMA (Anniston orthos and city limits) and was rejected. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Carroll | **gap** — "Carroll County — no parcel data wired here yet." | none usable | — | _adapter-needed_: The county viewer is CAMAvision Maps (maps.camavision.com). CAMAvision Maps is a format Planyr does not read yet (a UMN MapServer: parcel attributes from a point-info call, boundary rings as WFS closed lines) — a BUILD item, not an absence: this county is added to B2317681 (CAMAvision adapter, 10 Missouri counties there too). The viewer answers through the relay (maps.camavision.com/carrollia returned 200). |
| Cass | **new 2026-10-19** | Schneider Geospatial county feed `CassCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 17,162 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Cedar | **new 2026-10-19** | AGOL `Cedar_County_IA_Parcels_and_Muni/FeatureServer/1` — ArcGIS Online account clarenceia | yes | 19,901 parcels; interior hits 4/5, near-line 4/4; layer edit date 2023-03-28 |
| Cerro Gordo | **new 2026-10-19** | AGOL `Tax_Parcels_Feature_Service/FeatureServer/0` — Cerro Gordo County GIS | yes | 32,851 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-10-19 |
| Cherokee | **gap** — "Cherokee County — no parcel data wired here yet." | none usable | — | _no-source-found_: Only the assessor's search page (cherokee.iowaassessors.com) and a county GIS page were found; no viewer vendor or query service is named, and ArcGIS Online has only a basemap web map for the county. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Chickasaw | **new 2026-10-19** | Schneider Geospatial county feed `ChickasawCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 10,156 parcels; interior hits 4/5, near-line 4/4; layer edit date n/a (live server) |
| Clarke | **gap** — "Clarke County — no parcel data wired here yet." | none usable | — | _no-source-found_: Parcels are viewed through the county GIS website and clarke.iowaassessors.com (per a third-party directory); no query service or ArcGIS Online layer found. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Clay | **gap** — "Clay County — no parcel data wired here yet." | none usable | — | _beacon-only_: Schneider Beacon plus clay.iowaassessors.com; ArcGIS Online hits for 'Clay' were a student lab and other states' data (rejected). Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Clayton | **new 2026-10-19** | AGOL `Parcels_Old/FeatureServer/0` — ArcGIS Online account jansonchrisj | yes | 32,264 parcels; interior hits 5/5, near-line 4/4; layer edit date 2025-04-30 |
| Clinton | **new 2026-10-19** | Schneider Geospatial county feed `ClintonCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 34,561 parcels; interior hits 5/5, near-line 3/4; layer edit date n/a (live server) |
| Crawford | **new 2026-10-19** | AGOL `Parcel_CrawfordIA/FeatureServer/0` — Magnasoft | yes | 22,787 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-03-31 |
| Dallas | **new 2026-10-19** | `gis.dallascountyiowa.gov` Public/Parcels/MapServer/0 (relay) — Dallas County GIS | yes | 57,465 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Davis | **gap** — "Davis County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon GIS plus the assessor's page; ArcGIS Online hits were unrelated wildfire layers. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Decatur | **new 2026-10-19** | AGOL `Parcel_Decatur/FeatureServer/0` — Magnasoft | yes | 16,095 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-06-05 |
| Delaware | **new 2026-10-19** | AGOL `DelCO_UNC_Parcels/FeatureServer/0` — ArcGIS Online account dfox000 | yes | 11,355 parcels; interior hits 5/5, near-line 3/4; layer edit date 2021-07-13 |
| Des Moines | **gap** — "Des Moines County — no parcel data wired here yet." | none usable | — | _no-source-found_: The county GIS is a custom app (www.dmcgis.com, per a directory listing) plus desmoines.iowaassessors.com; no ArcGIS REST path for it was seen in any search result, web map or item. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Dickinson | **new 2026-10-19** | AGOL `Parcels2026_01/FeatureServer/0` — Iowa Great Lakes Sanitary District | yes | 26,897 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-01-23 |
| Dubuque | **gap** — "Dubuque County — no parcel data wired here yet." | none usable | — | _host-unreachable_: The county parcel layer is gis.dubuquecounty.us/server/rest/services/Maps/Land_Records/MapServer/26 (named in an ArcGIS Online item), but the production relay's request to that host fails or times out (measured), so no point could be queried and it was not wired. |
| Emmet | **gap** — "Emmet County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon is the county GIS map; nothing on ArcGIS Online. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Fayette | **gap** — "Fayette County — no parcel data wired here yet." | none usable | — | _beacon-only_: The county's own GIS maps page says 'Coming Soon' and points to Beacon; nothing on ArcGIS Online. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Floyd | **new 2026-10-19** | AGOL `Parcels/FeatureServer/0` — Floyd County GIS | yes | 11,631 parcels; interior hits 5/5, near-line 4/4; layer edit date 2025-08-08 |
| Franklin | **new 2026-10-19** | Schneider Geospatial county feed `FranklinCountyIA_WFS/MapServer/4` (relay) — Schneider Geospatial's county feed | yes | 17,388 parcels; interior hits 4/5, near-line 4/4; layer edit date n/a (live server) |
| Fremont | **gap** — "Fremont County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon; a 'Fremont County' GIS guide found is Colorado's and was rejected. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Greene | **gap** — "Greene County — no parcel data wired here yet." | none usable | — | _no-source-found_: No county viewer or vendor identified; ArcGIS Online has only an Iowa State University PLSS web map for Greene. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Grundy | **new 2026-10-19** | AGOL `Parcels/FeatureServer/0` — Grundy County | **no** | 10,574 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-09-24 |
| Guthrie | **new 2026-10-19** | Schneider Geospatial county feed `GuthrieCountyIA_WFS/MapServer/1` (relay) — Schneider Geospatial's county feed | yes | 19,889 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Hamilton | **new 2026-10-19** | Schneider Geospatial county feed `HamiltonCountyIA_WFS/MapServer/3` (relay) — Schneider Geospatial's county feed | yes | 19,286 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Hancock | **gap** — "Hancock County — no parcel data wired here yet." | none usable | — | _no-source-found_: No viewer or query service identified; the one ArcGIS Online hit was Franklin County control points, not Hancock. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Hardin | **new 2026-10-19** | Schneider Geospatial county feed `HardinCountyIA_AGS/MapServer/37` (relay) — Schneider Geospatial's county feed | yes | 21,889 parcels; interior hits 4/5, near-line 4/4; layer edit date n/a (live server) |
| Harrison | **new 2026-10-19** | Schneider Geospatial county feed `HarrisonCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 25,284 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Henry | **gap** — "Henry County — no parcel data wired here yet." | none usable | — | _no-source-found_: A county property database with GIS maps exists but its vendor is not named; ArcGIS Online hits for 'Henry' were other organisations' golf-course and parks layers. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Howard | **gap** — "Howard County — no parcel data wired here yet." | none usable | — | _adapter-needed_: The county viewer is CAMAvision Maps (maps.camavision.com). CAMAvision Maps is a format Planyr does not read yet (a UMN MapServer: parcel attributes from a point-info call, boundary rings as WFS closed lines) — a BUILD item, not an absence: this county is added to B2317681 (CAMAvision adapter, 10 Missouri counties there too). The viewer answers through the relay (maps.camavision.com/howardia returned 200). |
| Humboldt | **new 2026-10-19** | Schneider Geospatial county feed `HumboldtCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 16,834 parcels; interior hits 4/5, near-line 4/4; layer edit date n/a (live server) |
| Ida | **gap** — "Ida County — no parcel data wired here yet." | none usable | — | _no-source-found_: Web and ArcGIS Online searches by county name returned nothing relevant. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Iowa | **new 2026-10-19** | Schneider Geospatial county feed `IowaCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 19,620 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Jackson | **gap** — "Jackson County — no parcel data wired here yet." | none usable | — | _stale-only_: A public county layer exists (ArcGIS Online services9 MwhmgVod3RReV4Us Parcels/FeatureServer/0: 22,056 polygons, deed holder and parcel number, measured 5/5 interior and 4/4 county-line points) but it was last edited 2019-07-09 — older than the 2020 currency floor applied to every Iowa row — so it is not wired. Swap it in if the county republishes. |
| Jasper | **new 2026-10-19** | Schneider Geospatial county feed `JasperCountyIA_WFS/MapServer/12` (relay) — Schneider Geospatial's county feed | yes | 30,252 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Jefferson | **new 2026-10-19** | Schneider Geospatial county feed `JeffersonCountyIA_WFS/MapServer/37` (relay) — Schneider Geospatial's county feed | yes | 18,439 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Johnson | **new 2026-10-19** | AGOL `Parcels/FeatureServer/0` — Johnson County GIS | yes | 74,335 parcels; interior hits 5/5, near-line 2/4; layer edit date 2026-07-02 |
| Jones | **gap** — "Jones County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon, linked from the county GIS page; otherwise only static PDF maps. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Keokuk | **gap** — "Keokuk County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon only per the AssessorSearch listing; ArcGIS Online hits were a Penn State feature collection. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Kossuth | **new 2026-10-19** | AGOL `Kossuth_Parcels/FeatureServer/0` — Magnasoft | yes | 26,141 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-10-02 |
| Lee | **new 2026-10-19** | AGOL `Auditor_Data_Public_View/FeatureServer/32` — Lee County Auditor | yes | 30,783 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-10-19 |
| Linn | **new 2026-10-19** | AGOL `RealEstateParcel/FeatureServer/0` — Linn County Auditor / Assessor | yes | 105,879 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-10-19 |
| Louisa | **new 2026-10-19** | Schneider Geospatial county feed `LouisaCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 13,622 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Lucas | **gap** — "Lucas County — no parcel data wired here yet." | none usable | — | _no-source-found_: lucas.iowaassessors.com holds assessments and a GIS link sits under the treasurer's page; the vendor behind it could not be identified and no query service was found. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Lyon | **new 2026-10-19** | Schneider Geospatial county feed `LyonCountyIA_WFS/MapServer/1` (relay) — Schneider Geospatial's county feed | yes | 11,869 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Madison | **gap** — "Madison County — no parcel data wired here yet." | none usable | — | _adapter-needed_: The county viewer is CAMAvision Maps (maps.camavision.com). CAMAvision Maps is a format Planyr does not read yet (a UMN MapServer: parcel attributes from a point-info call, boundary rings as WFS closed lines) — a BUILD item, not an absence: this county is added to B2317681 (CAMAvision adapter, 10 Missouri counties there too). The viewer answers through the relay (maps.camavision.com/madisonia returned 200). |
| Mahaska | **new 2026-10-19** | Schneider Geospatial county feed `MahaskaCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 22,962 parcels; interior hits 4/5, near-line 4/4; layer edit date n/a (live server) |
| Marion | **gap** — "Marion County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon, linked from the county IT/GIS maps page; ArcGIS Online 'Marion' hits are the city of Marion in Linn County. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Marshall | **new 2026-10-19** | AGOL `Marshall_County_Parcels/FeatureServer/0` — ArcGIS Online account legrandmaint | yes | 27,313 parcels; interior hits 5/5, near-line 4/4; layer edit date 2020-12-16 |
| Mills | **new 2026-10-19** | AGOL `parcels_iworq/FeatureServer/0` — ArcGIS Online account pbinns | yes | 17,492 parcels; interior hits 5/5, near-line 4/4; layer edit date 2020-05-07 |
| Mitchell | **new 2026-10-19** | AGOL `Parcel_MitchellIA/FeatureServer/0` — Magnasoft | yes | 12,182 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-07-20 |
| Monona | **new 2026-10-19** | AGOL `Parcels_Monona/FeatureServer/0` — Magnasoft | yes | 20,963 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-03-16 |
| Monroe | **gap** — "Monroe County — no parcel data wired here yet." | none usable | — | _adapter-needed_: The county viewer is CAMAvision Maps (maps.camavision.com). CAMAvision Maps is a format Planyr does not read yet (a UMN MapServer: parcel attributes from a point-info call, boundary rings as WFS closed lines) — a BUILD item, not an absence: this county is added to B2317681 (CAMAvision adapter, 10 Missouri counties there too). The viewer answers through the relay (maps.camavision.com/monroeia returned 200). |
| Montgomery | **gap** — "Montgomery County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon only per the AssessorSearch listing. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Muscatine | **new 2026-10-19** | `magic-gis.com` MAGIC_Landbase/Countywide_ParcelLayers/MapServer/44 (relay) — MAGIC — Muscatine Area GIS consortium | yes | 24,930 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| O'Brien | **gap** — "O'Brien County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon is the listed parcel and GIS viewer; ArcGIS Online has only Iowa DOT project layers for the county. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Osceola | **new 2026-10-19** | Schneider Geospatial county feed `OsceolaCountyIA_WFS/MapServer/1` (relay) — Schneider Geospatial's county feed | yes | 12,056 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Page | **gap** — "Page County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon (county site pagecounty.iowa.gov); the ArcGIS Online 'Real Estate Parcel' layer is Linn County's. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Palo Alto | **gap** — "Palo Alto County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon is the listed viewer (an Equator Studios page also exists, a paid-data storefront); ArcGIS Online has only a utility viewer guide. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Plymouth | **gap** — "Plymouth County — no parcel data wired here yet." | none usable | — | _no-source-found_: plymouth.iowaassessors.com is an assessor and GIS portal whose vendor could not be identified; ArcGIS Online returned nothing. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Pocahontas | **gap** — "Pocahontas County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon is the official portal (an Equator Studios paid-data page also exists). Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Polk | wired earlier (2026-09-11, Hub) | AGOL `PolkParcelsValues5_28_2026/FeatureServer/0` | no | 219,672 parcels; hand-written `ia_polk` row, untouched by this pass |
| Pottawattamie | **new 2026-10-19** | `gis.pottcounty-ia.gov` PublicDataEnterprise/PublicData_Parcels/FeatureServer/0 (relay) — Pottawattamie County GIS | yes | 53,843 parcels; interior hits 4/5, near-line 4/4; layer edit date n/a (live server) |
| Poweshiek | **gap** — "Poweshiek County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon, linked from the assessor page; ArcGIS Online returned only a wildlife dataset. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Ringgold | **gap** — "Ringgold County — no parcel data wired here yet." | none usable | — | _stale-only_: Beacon, plus an ArcGIS Online account (RinggoldCoIA) holding only a 2015 'PARCELS2' layer package (.lpk) and a notes-only web map — no hosted query service. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Sac | **gap** — "Sac County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon is the official portal (an Equator Studios paid-data page also exists). Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Scott | **new 2026-10-19** | AGOL `Cadastral/FeatureServer/3` — Scott County IT / GIS | yes | 75,501 parcels; interior hits 5/5, near-line 4/4; layer edit date 2026-10-13 |
| Shelby | **gap** — "Shelby County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon; the Auditor's page says staff maintain a GIS map of all parcels but names no query service. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Sioux | **gap** — "Sioux County — no parcel data wired here yet." | none usable | — | _vendor-viewer-only_: The viewer is an Equator Studios storefront (gis.equatorstudios.com/iowa_sioux) — a Next.js page selling parcel data, with no query service behind it (read through the relay); ArcGIS Online has none. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Story | **new 2026-10-19** | AGOL `Parcels_Esri/FeatureServer/0` — Story County GIS | yes | 42,058 parcels; interior hits 5/5, near-line 3/4; layer edit date 2026-09-05 |
| Tama | **gap** — "Tama County — no parcel data wired here yet." | none usable | — | _adapter-needed_: The county viewer is CAMAvision Maps (maps.camavision.com). CAMAvision Maps is a format Planyr does not read yet (a UMN MapServer: parcel attributes from a point-info call, boundary rings as WFS closed lines) — a BUILD item, not an absence: this county is added to B2317681 (CAMAvision adapter, 10 Missouri counties there too). The viewer answers through the relay (maps.camavision.com/tamaia returned 200). |
| Taylor | **gap** — "Taylor County — no parcel data wired here yet." | none usable | — | _login-required_: The county's Integrity GIS Geocortex site (Taylor_County_IA on bentongis.integritygis.com) answers a guest with 403 'The current user cannot access the desired resource' (measured through the relay) — a login-gated site is a named gap, never worked around. |
| Union | **gap** — "Union County — no parcel data wired here yet." | none usable | — | _beacon-only_: Beacon per the AssessorSearch listing; the only ArcGIS Online 'Union' hits were Black Hawk County's election layer. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Van Buren | **gap** — "Van Buren County — no parcel data wired here yet." | none usable | — | _no-source-found_: No county GIS viewer found (county site vanburencoia.org); web results were commercial resellers and Van Buren County, Michigan. Absent from Schneider Geospatial's public Iowa county feed (wfs.schneidercorp.com lists 38 Iowa county services; this county is not one) and from ArcGIS Online. |
| Wapello | **new 2026-10-19** | Schneider Geospatial county feed `WapelloCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | yes | 30,685 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Warren | **new 2026-10-19** | AGOL `Parcels051622/FeatureServer/0` — ArcGIS Online account eklimowski | yes | 35,498 parcels; interior hits 5/5, near-line 3/4; layer edit date 2026-10-09 |
| Washington | **gap** — "Washington County — no parcel data wired here yet." | none usable | — | _adapter-needed_: The county viewer is CAMAvision Maps (maps.camavision.com). CAMAvision Maps is a format Planyr does not read yet (a UMN MapServer: parcel attributes from a point-info call, boundary rings as WFS closed lines) — a BUILD item, not an absence: this county is added to B2317681 (CAMAvision adapter, 10 Missouri counties there too). The viewer answers through the relay (maps.camavision.com/washingtonia returned 200). |
| Wayne | **new 2026-10-19** | AGOL `WayneCoParcelsJan2023_view/FeatureServer/1` — ArcGIS Online account CorydonCityHall | yes | 14,002 parcels; interior hits 5/5, near-line 4/4; layer edit date 2024-01-11 |
| Webster | **new 2026-10-19** | Schneider Geospatial county feed `WebsterCountyIA_WFS/MapServer/58` (relay) — Schneider Geospatial's county feed | yes | 33,467 parcels; interior hits 5/5, near-line 3/4; layer edit date n/a (live server) |
| Winnebago | **new 2026-10-19** | Schneider Geospatial county feed `WinnebagoCountyIA_WFS/MapServer/12` (relay) — Schneider Geospatial's county feed | yes | 12,416 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
| Winneshiek | **new 2026-10-19** | AGOL `Winn_Parcels/FeatureServer/0` — Winneshiek County GIS | yes | 21,005 parcels; interior hits 5/5, near-line 4/4; layer edit date 2024-09-16 |
| Woodbury | **new 2026-10-19** | AGOL `parcel_polygon_feature/FeatureServer/0` — Woodbury County | **no** | 55,899 parcels; interior hits 4/5, near-line 4/4; layer edit date 2026-06-25 |
| Worth | **new 2026-10-19** | Schneider Geospatial county feed `WorthCountyIA_WFS/MapServer/0` (relay) — Schneider Geospatial's county feed | **no** | 11,696 parcels; interior hits 4/5, near-line 3/4; layer edit date n/a (live server) |
| Wright | **new 2026-10-19** | Schneider Geospatial county feed `WrightCountyIA_WFS/MapServer/2` (relay) — Schneider Geospatial's county feed | yes | 18,992 parcels; interior hits 5/5, near-line 4/4; layer edit date n/a (live server) |
## Kentucky counties (2026-10-19, extended 2026-10-20) — 37 of 120 wired

Owner request 2026-10-19: *"start wiring all the remaining states into Planner"*; 2026-10-20: *"can you wire up kentucky counties"* (this section is Kentucky only; sibling sessions took the other states). **Kentucky has no statewide parcel service and the "no-free-source (statewide)" verdict stands — but there IS one the public cannot use:** the Department of Revenue's *statewide 2025 parcel layer* (`kygisportalservices.ky.gov/server/rest/services/Hosted/Ky_DOR_Statewide_Parcels_2025_WM_gdb/FeatureServer/0`, found by reading a public Kentucky DGI web map; fields pidn / parcel_id / county / acres, no owner) and the state's per-county `COT/Ky_PVA_<County>_Parcels_WM` services answer **Token Required** to anonymous callers, and KYTC's "County PVA Availability" layer says its PVA data is read-only for authorized users. A request to Kentucky DGI / DOR for a public key or an open copy is the one route that could cover most of the state at once (an owner decision — see OWNER-TODO.md).

**What the first pass (10-19) found:** 22 counties wired from title/tag/extent searches. **What the extension (10-20) found by other means: 15 more** — parcels were hiding in layers a title search cannot find: planner "zoning" / "land use" services (Spencer, Bullitt, Mercer, Anderson, Rowan, Allen), a county E911 office's org (Pulaski), a county planning consortium's org (Barren, Daviess), a city utility's working GIS (Boyd) and a water-district lead-line inventory (Bourbon), a Gateway ADD layer next to an id-less trap (Montgomery), the county staff's own org (Jessamine, Hardin), and Hopkins County's *own* server on port 6443 (the first pass's "Hopkins is Texas" note was an ArcGIS Online title search, not Hopkins County, Kentucky's server).

**Method applied to every county below (not repeated per row):** (A) every public service AND sublayer of ~35 orgs was enumerated and each polygon sublayer's fields and count tested for parcel shape — Bluegrass ADD (BGGIS), Gateway ADD, Big Sandy ADD, BRADD, Purchase ADD, Pennyrile ADD, Lake Cumberland ADD, Cumberland Valley ADD, Kentucky River ADD, FIVCO, Lincoln Trail ADD, Northern Kentucky ADD and health district, KIPDA, GeoComm and Cloudpermit multi-county orgs, Kentucky DGI (442 services, ~90 public web maps read), KYTC, plus county / city / E911 / water-district orgs; (B) ~600 `<name>.maps.arcgis.com/sharing/rest/portals/self` org-name probes and AGOL `owner:` wildcards (prefix only); (C) the ArcGIS Hub datasets API searched by parcel-style field names (PIDN, PARCEL_ID, MUID, PHOTO_ID, TAX_DIST) with each county's box; (D) web-map / app / experience configs read for `operationalLayers` URLs. Reachable-host measuring: the sandbox reaches only `*.arcgis.com`; every other host was MEASURED through the Cloudflare preview of `planyr.io/gis-proxy`. Rule for every wired row: point queries at 5 spread interior points and 4 points ~300 m inside the county line; polygons with a parcel id; extent inside Kentucky; no token. **Misses are water / right-of-way / river-border / federal ground — a parcel exists within 400 m of each** (stated where it is not true).

**Vendor findings (hypotheses tested, 10-20).** *qPublic / Schneider* — a server-side request to `qpublic.schneidercorp.com` through the relay is answered with a Cloudflare managed-challenge page ("Just a moment…"); most PVA sites (perrycountypva.com, laurelpva.com, washingtonkypva.com, carrollpva.com, ccpva.org, triggpva.com, mcpva.com, pikekypva.com, estillkypva.org, russellpva.com) answer the same challenge. So whether qPublic's map calls a queryable endpoint **cannot be seen from this environment** — it needs a real browser (filed as B2394592; Bell's `bellpva.com/parcel-map` is just an embedded qPublic app). *Equator Studios* — `gis.equatorstudios.com/kentucky_<county>/` is a paid-download sales page (DWG/SHP/GeoJSON exports), not a queryable service. *Kentucky open-data hub* (`opengisdata.ky.gov`) — its search lists only Webster's viewer; **no per-county parcel download files turned up, so the "free downloadable parcel file" category is empty** (nothing for the owner to host). *KYTC's own ArcGIS org* (`services2.arcgis.com/CcI36Pduqd0OR4W9`, 306 services) — no PVA parcels: `ClippedParcels` is one project area near Louisville, `KYTC_Properties` is 40 KYTC-owned sites. *State server* `kygisserver.ky.gov` — only Webster remains; the `Ky_PVA_<County>_Parcels_WGS84WM` names for 22 other counties return a real 404. Re-tests: Boyle (523), Clark (522) and Daviess's old host (DNS 1016) stayed unreachable from Cloudflare; Daviess is wired from an Owensboro-planning copy instead.

**Traps found by measuring (do not re-chase):** Grant — the layer is Grant County, New Mexico; Montgomery's `Montgomery_Parcels_view` is id-less (the wired `Parcels` sibling has `PARCEL_ID`); Franklin's `Parcels101817` is Woodford-area data; Boyle's county-wide layer has no parcel id; Hopkins (Texas) was a title-search artefact; Calloway / Lawrence / Hickman / Grayson / Hancock / McLean / Ohio / Marion / Bell / Knox / Jackson / Lee / Carroll look-alikes are other states' counties.

| County | Source | Owner column | Measured | Layer |
|---|---|---|---|---|
| Fayette | **wired** — LFUCG GIS | no | 4/5 interior, 4/4 near-line | `https://services1.arcgis.com/Mg7DLdfYcSWIaDnu/arcgis/rest/services/Parcel/FeatureServer/0` |
| McCracken | **wired** — City of Paducah/McCracken GIS | yes | 4/5 interior, 3/4 near-line | `https://services1.arcgis.com/xkOPDyh2DVxtFEGe/arcgis/rest/services/PVAParcels/FeatureServer/1` |
| Henderson | **wired** — Henderson County GIS | no | 5/5 interior, 2/4 near-line | `https://services.arcgis.com/Iwwqwcdc5CWG2jt9/arcgis/rest/services/Parcels/FeatureServer/0` |
| Henry | **wired** — KIPDA/Henry PVA | yes | 5/5 interior, 4/4 near-line | `https://services5.arcgis.com/SRuaqVyoD8TEQJga/arcgis/rest/services/HenryCoParcels/FeatureServer/13` |
| Simpson | **wired** — Simpson PVA | yes | 5/5 interior, 4/4 near-line | `https://services6.arcgis.com/P3u2F80lQaN3sLkC/arcgis/rest/services/Public_Access_Parcels/FeatureServer/0` |
| Webster | **wired** — KY DGI (AGOL copy) | no | 5/5 interior, 4/4 near-line | `https://services3.arcgis.com/ghsX9CKghMvyYjBU/arcgis/rest/services/Ky_Webster_Parcels_WM_gdb/FeatureServer/0` |
| Breathitt | **wired** — AGOL dougcurl (unverified) | see sample | 5/5 interior, 4/4 near-line | `https://services.arcgis.com/9Dz5quHPmab2pMtb/arcgis/rest/services/Breathitt_Parcels/FeatureServer/1` |
| Franklin | **wired** — AGOL 1319Parcels (unverified) | see sample | 4/5 interior, 4/4 near-line | `https://services2.arcgis.com/1Mn98EWnWi3Ezwj3/arcgis/rest/services/1319Parcels/FeatureServer/0` |
| Oldham | **wired** — Oldham County GIS | no | 5/5 interior, 3/4 near-line | `https://services5.arcgis.com/4eBIYcSR3sVL9y0D/ArcGIS/rest/services/Parcels/FeatureServer/0` |
| Shelby | **wired** — Shelby County GIS | yes | 5/5 interior, 4/4 near-line | `https://services2.arcgis.com/VqPd1Ybcc46AvijK/arcgis/rest/services/Parcels_Service/FeatureServer/0` |
| Todd | **wired** — AGOL ccmiller22 (unverified) | yes | 5/5 interior, 4/4 near-line | `https://services2.arcgis.com/UAAKLK1ZNmY4DOkd/arcgis/rest/services/Parcels/FeatureServer/6` |
| Woodford | **wired** — Woodford/Versailles GIS | yes | 5/5 interior, 4/4 near-line | `https://services9.arcgis.com/eE18Y8QhAVKzp7mP/arcgis/rest/services/Parcels/FeatureServer/0` |
| Meade | **wired** — Meade County GIS | yes | 5/5 interior, 1/4 near-line | `https://services1.arcgis.com/ufOeQWjwz5JyJXKQ/ArcGIS/rest/services/Meade_Co_KY_Addresses_Roads_Lot_Lines_WFL1/FeatureServer/5` |
| Trimble | **wired** — KIPDA land-use layer, ~2018 | no | 5/5 interior, 3/4 near-line | `https://services5.arcgis.com/SRuaqVyoD8TEQJga/arcgis/rest/services/Trimble_Co_Current_Landuse/FeatureServer/0` |
| Boone | **wired** — Boone County Planning Commission | yes | 5/5 interior, 1/4 near-line | `https://services1.arcgis.com/kleO5B3qko1eLO4Z/arcgis/rest/services/Tax_Parcels/FeatureServer/0` |
| Madison | **wired** — Madison County GIS (relay) | no | 5/5 interior, 4/4 near-line | `https://arcserver.madisoncountyky.us/arcgis/rest/services/County_Web_Maps/County_Parcels/MapServer/1` |
| Campbell | **wired** — LINK-GIS (relay) | owner-city only? see sample | 5/5 interior, 3/4 near-line | `https://maps.linkgis.org/server/rest/services/CC_KC_PCTheme/MapServer/9` |
| Kenton | **wired** — LINK-GIS (relay) | yes | 4/5 interior, 4/4 near-line | `https://maps.linkgis.org/server/rest/services/CC_KC_PCTheme/MapServer/15` |
| Pendleton | **wired** — LINK-GIS (relay) | yes | 5/5 interior, 3/4 near-line | `https://maps.linkgis.org/server/rest/services/CC_KC_PCTheme/MapServer/18` |
| Warren | **wired** — Warren CCPC (relay) | no | 4/5 interior, 4/4 near-line | `https://webgis.bgky.org/server/rest/services/CCPC/CCPC_Parcels/FeatureServer/0` |
| Scott | **wired** — Georgetown-Scott Planning (relay) | yes (PVA ownership join) | 5/5 interior, 3/4 near-line | `https://gis.gscplanning.com/arcgis/rest/services/Parcels/MapServer/0` |
| Jefferson | **wired** — LOJIC (relay) | no | 4/5 interior, 2/4 near-line | `https://gis.lojic.org/maps/rest/services/LojicSolutions/OpenDataPVA/MapServer/1` |
| Jessamine | **wired** — Jessamine County staff org | yes | 5/5 interior, 2/3 near-line (3/3 counting a parcel within 400 m) | `https://services8.arcgis.com/zS6BFcOikVpehjJD/arcgis/rest/services/Parcels_Published/FeatureServer/0` |
| Spencer | **wired** — KIPDA org (zoning-service parcel fabric) | no | 5/5 interior, 3/4 near-line (4/4 counting a parcel within 400 m) | `https://services5.arcgis.com/SRuaqVyoD8TEQJga/arcgis/rest/services/SpencerZoning/FeatureServer/0` |
| Hardin | **wired** — Hardin County Online GIS | yes | 5/5 interior, 2/4 near-line | `https://services1.arcgis.com/fYwcHOBzInDTQxh0/arcgis/rest/services/Hardin_Parcels_08_11_22/FeatureServer/0` |
| Bullitt | **wired** — AGOL cspalding (planner zoning file, unverified) | yes | 5/5 interior, 2/4 near-line (4/4 counting a parcel within 400 m) | `https://services3.arcgis.com/7GIe3Xxna70nAWN0/arcgis/rest/services/Bullitt_County_Kentucky_Zoning_Classification_WFL1/FeatureServer/46` |
| Daviess | **wired** — Owensboro MPC / ODCGIS org | yes | 5/5 interior, 2/4 near-line (4/4 counting a parcel within 400 m) | `https://services1.arcgis.com/0qqIwtRYsyVJ7lna/arcgis/rest/services/City_Services/FeatureServer/6` |
| Mercer | **wired** — Bluegrass ADD (BGGIS) zoning service | yes | 4/5 interior, 1/4 near-line (2/4 counting a parcel within 400 m) | `https://services2.arcgis.com/BxXA8zJZUU4360ND/arcgis/rest/services/Mercer_County_Planning_and_Zoning_WFL1/FeatureServer/123457` |
| Anderson | **wired** — Bluegrass ADD (BGGIS) zoning service | no | 5/5 interior, 1/4 near-line (2/4 counting a parcel within 400 m) | `https://services2.arcgis.com/BxXA8zJZUU4360ND/arcgis/rest/services/Anderson_County_Zoning_WFL1/FeatureServer/1` |
| Montgomery | **wired** — Gateway ADD org | no | 5/5 interior, 2/4 near-line (4/4 counting a parcel within 400 m) | `https://services3.arcgis.com/aaZhjjkUqOHS7oRg/arcgis/rest/services/Parcels/FeatureServer/0` |
| Rowan | **wired** — Gateway ADD org (land-use layer) | no | 3/5 interior, 3/4 near-line (4/4 counting a parcel within 400 m) | `https://services3.arcgis.com/aaZhjjkUqOHS7oRg/arcgis/rest/services/Rowan_Existing_Land_Use/FeatureServer/0` |
| Hopkins | **wired** — Hopkins County GIS server :6443 (relay) | no | 5/5 interior, 4/4 near-line | `https://www.hopkinscountygis.com:6443/arcgis/rest/services/Parcel/MapServer/0` |
| Pulaski | **wired** — Pulaski County E911 org | yes | 5/5 interior, 1/4 near-line (2/4 counting a parcel within 400 m) | `https://services9.arcgis.com/2rJXfGpU7WMGx1RV/arcgis/rest/services/Parcels_10_2025/FeatureServer/0` |
| Allen | **wired** — City of Scottsville org (flood-plain service sublayer) | yes | 5/5 interior, 3/4 near-line | `https://services2.arcgis.com/rWBXXM3V5IXrtnYJ/arcgis/rest/services/P_Z_FLOODPLAIN_MAP_WFL1/FeatureServer/3` |
| Barren | **wired** — BITS — Glasgow/Barren County GIS | yes | 5/5 interior, 2/4 near-line (4/4 counting a parcel within 400 m) | `https://services9.arcgis.com/3EpidazL61WC8HDd/arcgis/rest/services/PARCELS/FeatureServer/0` |
| Boyd | **wired** — AGOL smckay_ashlandky (Ashland utility GIS view, unverified) | yes | 5/5 interior, 3/4 near-line (4/4 counting a parcel within 400 m) | `https://services5.arcgis.com/5FuqXDDWUwSxApN0/arcgis/rest/services/Field_Map_layers_6_(view)/FeatureServer/47` |
| Bourbon | **wired** — AGOL cdmrio1880 (Paris lead-line inventory snapshot, unverified) | yes | 5/5 interior, 3/4 near-line (4/4 counting a parcel within 400 m) | `https://services5.arcgis.com/bVgg5ZXLyu6x0rny/arcgis/rest/services/lead_service_line_inventory/FeatureServer/9` |


### Kentucky gaps — 83 counties print "<County> — no parcel data wired here yet."

KYTC availability shown for each (stale 1993-era attribution; it has been wrong both ways — e.g. Hardin and Bullitt are flagged "Without Ownership" yet carry owners). Statuses: **gap** (nothing usable found) · **gap · city layer only** (a real parcel layer covering only the county seat) · **gap · token-gated** (a county-wide layer exists but answers Token Required).

| County | Status | KYTC holds | What was searched / why (county-specific; the shared method is above) |
|---|---|---|---|
| Adair | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (Schneider); adairpva.com sells subscriber GIS maps. |
| Ballard | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Bath | gap · token-gated | Without Ownership | Gateway ADD's `OwingsvilleZoningParcels` requires a token; Bath's PVA is a Beacon app (AppID 934). PVA/vendor: qPublic/Beacon (beacon.schneidercorp.com AppID=934 'Bath County, KY PVA'). |
| Bell | gap | Without Ownership | `bellcounty` org is Bell County, Texas; '2016_04_15 Bell Parcels' has a cancelled subscription (403); bellpva.com embeds a qPublic app. PVA/vendor: Equator (gis.equatorstudios.com/kentucky_bell, paid download portal) + qPublic. |
| Boyle | gap | Not Yet Available | Two real sources, neither wireable: Danville-Boyle Planning & Zoning's county-wide polygon layer (13,205 parcels, `…/YNGbWQGxX08glHX9/…/Parcel_Boundary/FeatureServer/2`) carries only OBJECTID / ACRES — no parcel id; the id-bearing Bluegrass ADD server `maps2.bgadd.org/…/Boyle/BoyleParcelBoundary/MapServer/0` answered 523 (origin unreachable) through the relay on 10-19 and again 10-20. PVA/vendor: ArcGIS Server (BGADD maps2) / Equator boylepva.com. |
| Bracken | gap | Without Ownership | No parcel polygon layer found. |
| Breckinridge | gap · token-gated | With Ownership | `BreckinridgeParcels_0224` (Joshpoe001) re-confirmed Token Required. PVA/vendor: Schneider Beacon/qPublic. |
| Butler | gap · city layer only | Without Ownership | Morgantown only (1,021 parcels in BRADD's org); the county's JRAdams apps return a cancelled-subscription error. PVA/vendor: qPublic (Schneider). |
| Caldwell | gap | Without Ownership | The only Caldwell KY parcel item is a 20-polygon Fredonia sample (0/5); 'caldwellcounty' / 'caldwellcad' orgs are Texas. PVA/vendor: qPublic (qpublic.net/ky/caldwell, Beacon) + Equator data page https://gis.equatorstudios.com/kentucky_caldwell. |
| Calloway | gap · city layer only | Without Ownership | Murray's layer (8,978 parcels) 1/5 interior, no owner column. `Calloway_KY` (CommunitySystems) and `Calloway_County` (pamela.rodriguez) are Token Required; 'Parcels Selection' is Calloway County, Missouri. PVA/vendor: qPublic (Schneider) + Equator; city layer on ArcGIS Online. |
| Carlisle | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Carroll | gap | Without Ownership | `carroll.countygis.org` is Carroll County, OHIO (rejected); the Carrollton org is Carrollton, Texas; carrollpva.com sits behind a bot challenge. PVA/vendor: countygis.org (carroll.countygis.org is Carroll County OHIO - rejected) / PVA site carrollpva.com. |
| Carter | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: Equator Studios (gis.equatorstudios.com/kentucky_carter) + qPublic; no county GIS viewer per aggregator. |
| Casey | gap | Without Ownership | The 'Parcel Boundary' layer on `services3…/YNGbWQGxX08glHX9` is Boyle County ground. PVA/vendor: qPublic (subscription tier) qpublic.net/ky/casey. |
| Christian | gap · city layer only | Without Ownership | Hopkinsville's layer (13,957 parcels, about half the county; org holds 20+ copies of it) measures 0/5 across the county. Nothing county-wide in that org. PVA/vendor: qPublic + Hopkinsville AGOL (also dozens of copies: CityParcels, Corporate_Parcels, ParcelsAccela, TestParcels. |
| Clark | gap | Without Ownership | County server `gis.ccgisonline.com:6443/arcgis/rest/services/BASELAYERS/PARCELS/MapServer/0` answered 522 (timeout) through the relay on 10-19 and 10-20; its :6080 twin is http-only; the AGOL copy (webmap FIELDTEST → `ParcelsArcGISServer2023gdb`) was deleted. Re-test if the county opens the server to Cloudflare. PVA/vendor: ArcGIS Server (county self-hosted, ports 6080/6443). |
| Clay | gap | With Ownership | No parcel polygon layer found. |
| Clinton | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic/Beacon (Schneider). |
| Crittenden | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (subscription) + Equator data page. |
| Cumberland | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic/Beacon (Schneider). |
| Edmonson | gap · token-gated | Without Ownership | `ECWD_online` /12 (water district) re-confirmed Token Required. PVA/vendor: qPublic (Schneider) + Equator. |
| Elliott | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (qpublic.net/ky/elliott is the PVA page; free tier limited data). |
| Estill | gap | Without Ownership | No parcel polygon layer found. |
| Fleming | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (kypvas directory; flemingcountyky.us/pva.asp). |
| Floyd | gap | With Ownership | No parcel polygon layer found. |
| Fulton | gap · owner-accepted | Without Ownership | OWNER-ACCEPTED gap (2026-10-16) — not reopened. |
| Gallatin | gap | Without Ownership | `gallatinky.wthgis.com` is WTH Technology's proprietary non-ArcGIS viewer (no REST); the gallatin911 org holds emergency-service boundaries only. PVA/vendor: WTH Technology (gallatinky.wthgis.com, proprietary non-ArcGIS viewer, rejected). |
| Garrard | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (qpublic.net/ky/kypvas per AssessorSearch). |
| Grant | gap | Without Ownership | REJECTED trap: 'Grant_County_Interactive_Parcel_Map' is Grant County, NEW MEXICO (lon -109..-107.6); the Planning Commission's `Parcels_PCForAlex` has only 95 rows. PVA/vendor: unknown (grantpva.net PVA site per aggregator). |
| Graves | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Grayson | gap | Without Ownership | The cited 'Public Map Viewer' is Grayson County, Texas; GCWD layers are water lines. PVA/vendor: qPublic/Beacon (beacon.schneidercorp.com/?site=GraysonCountyKY). |
| Green | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: qPublic (App=GreenCountyKY). |
| Greenup | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (qpublic.net/ky/greenup). |
| Hancock | gap | Without Ownership | The cited parcel viewer is West Virginia; the Hancock mapper is Indiana. PVA/vendor: qPublic (qpublic.net/ky/hancock; beware Hancock IN). |
| Harlan | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: qPublic / PVA site (not located). |
| Harrison | gap | Without Ownership | No parcel polygon layer found. |
| Hart | gap · city layer only | Without Ownership | Horse Cave only (1,240). BRADD's county-wide `Hart_Land_Use_2025_View_Layer` (14,065 polygons) has no parcel id; its id-bearing parent `Hart_Land_Use_2025` answers Token Required — BRADD could publish it. PVA/vendor: qPublic (hartpva.com / qpublic.schneidercorp.com). |
| Hickman | gap | Without Ownership | `HickmanCo_Parcels` is Hickman County, Tennessee. PVA/vendor: qPublic (Schneider) + Equator. |
| Jackson | gap | Without Ownership | `jacksongis` is Jackson, Mississippi; the tax-parcel web map is Jackson County, Wisconsin. |
| Johnson | gap · token-gated | With Ownership | The 13,431-parcel 'Parcels' layer in `services8…/jQmYSjut98J74Bji` answers Token Required; qPublic is the PVA's site. PVA/vendor: qPublic (Schneider) - PVA hosts GIS on qpublic.net/ky/johnson. |
| Knott | gap · token-gated | With Ownership | State PVA service `kygisportalservices.ky.gov/…/COT/Ky_PVA_Knott_Parcels_WM` (found in a DGI web map) answers Token Required, as does the statewide DOR layer; RESPEC's coal-permit PVA subset has only 273 polygons. PVA/vendor: state-hosted PVA service (kygisportalservices.ky.gov/server/rest/services/COT/Ky_PVA_Knott_Parcels_WM) - token. |
| Knox | gap | Not Yet Available | `knoxgis` org is Knoxville, Tennessee; KYTC lists Knox 'Not Yet Available'. PVA/vendor: unknown (KYTC: Not Yet Available). |
| Larue | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: unknown (county site laruecounty.org; not found on qPublic listings). |
| Laurel | gap · token-gated | Without Ownership | `Laurel_County_PVA_Files` (Cloudpermit org, 32,142 parcels with owner) answers Token Required (publisher's subscription disabled). laurelpva.com sits behind a bot challenge. PVA/vendor: qPublic + laurelpva.com GIS map. |
| Lawrence | gap | Without Ownership | The `isv.kcsgis.com/al.lawrence_revenue` viewer and 'Lawrence County Revenue - Parcel Viewer' are Lawrence County, ALABAMA; Equator sells downloads. PVA/vendor: Equator Studios (gis.equatorstudios.com/kentucky_lawrence, paid downloads). |
| Lee | gap | With Ownership | `leegis` is Lee County, Florida. |
| Leslie | gap | Without Ownership | No parcel polygon layer found. |
| Letcher | gap | Without Ownership | RESPEC's `Kingdom_Permit_PVA` has real PVA parcels with owner but only 273 polygons (a coal-permit subset). qPublic is the PVA's site. PVA/vendor: qPublic (qpublic.net/ky/letcher). |
| Lewis | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (kypvas directory lists Lewis PVA, 112 Second St Vanceburg). |
| Lincoln | gap | Without Ownership | The Lincoln 'Parcel Map' Experience is Idaho; BG911 layers are addresses only; Bluegrass ADD's `maps2.bgadd.org` (unreachable, see Boyle) may carry a Lincoln folder. PVA/vendor: unknown; BGADD ArcGIS Server maps2.bgadd.org (Boyle only so far). |
| Livingston | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: none visible (Acres/AcreValue/Regrid only). |
| Logan | gap · token-gated | Without Ownership | Cloudpermit's 'Russellville, KY' layer (20,392 features) answers Token Required; the BRADD org holds Logan 911 data only; `logancounty` is Logan Co., Illinois. PVA/vendor: qPublic (Schneider) + Equator. |
| Lyon | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Magoffin | gap | With Ownership | No parcel polygon layer found. |
| Marion | gap | Not Yet Available | The `mariongis` org is in South Carolina. PVA/vendor: Schneider Beacon/qPublic; PVA site marionkypva.com. |
| Marshall | gap | Without Ownership | The county 'MAGIC' viewer `gis.marshallcounty.ky.gov/MAGIC/` answered 502 through the relay (10-20); the county's own AGOL org has no parcels; McCracken's layer overlaps its box but is McCracken ground. PVA/vendor: qPublic + county 'MAGIC' viewer. |
| Martin | gap | With Ownership | No parcel polygon layer found. PVA/vendor: Equator Studios (gis.equatorstudios.com/kentucky_martin) and/or qPublic; platform unconfirmed. |
| Mason | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (App=MasonCountyKY, Layer=Parcels at qpublic.schneidercorp.com). |
| McCreary | gap | With Ownership | `Parcel_McCreary_NKUrequest` is a 12-polygon clip near Bear Creek (0/5); 'Parcels 10 2025' is Scott County, Tennessee. PVA/vendor: unknown (KYTC: see availability). |
| McLean | gap | Without Ownership | The `mcleangis` org is McLean County, Illinois. PVA/vendor: qPublic (subscription list). |
| Menifee | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: unknown (listed in qPublic Kentucky PVA directory; PVA 12 Main St Frenchburg, 606-768-3514). |
| Metcalfe | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Monroe | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Morgan | gap | Without Ownership | No parcel polygon layer found. PVA/vendor: qPublic (qpublic.net/ky/morgan per assessor-search aggregator; unconfirmed). |
| Muhlenberg | gap | With Ownership | No parcel polygon layer found. PVA/vendor: qPublic (PVA) + Equator https://gis.equatorstudios.com/kentucky_muhlenberg/. |
| Nelson | gap · city layer only | With Ownership | Bardstown only (5,947 of ~25k); Nelson's building footprints (32,181) carry no id; Lead_Survey_Parcels (2,791) is a partial survey. PVA/vendor: Equator (gis.equatorstudios.com/kentucky_nelson) / qPublic. |
| Nicholas | gap | With Ownership | No parcel polygon layer found. |
| Ohio | gap | Without Ownership | `OhioCountyGIS` is Ohio County, West Virginia. PVA/vendor: qPublic/Beacon (ohiopva.com) + Equator. |
| Owen | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: qPublic (PVA, Room 6 Owenton); no AGOL presence. |
| Owsley | gap | Without Ownership | No parcel polygon layer found. |
| Perry | gap | Without Ownership | perrycountypva.com sits behind a Cloudflare bot challenge (unreadable from a server). AssessorSearch cites a 'Perry County Public GIS Map' on arcgis.com that no search can find — likely private. A real browser could read its web-map id. PVA/vendor: ArcGIS Online web app per AssessorSearch ("Perry County Public GIS Map") + perrycountypva.com. |
| Pike | gap | With Ownership | Equator sells Pike downloads (`gis.equatorstudios.com/kentucky_pike`); the Big Sandy ADD org (69 services) holds centerlines / fire layers only; the Logan/Mingo tax-parcel layers are West Virginia. PVA/vendor: Equator (gis.equatorstudios.com/kentucky_pike, lists a Pike County Portal) ; ReportAll ~42.5k parcels. |
| Powell | gap · token-gated | Without Ownership | The Stanton org's `PVA`, `Zoning` and `STANTON_08_29_2023` services answer Token Required. PVA/vendor: unknown (qPublic Kentucky portal lists Powell PVA). |
| Robertson | gap | Without Ownership | No parcel polygon layer found. |
| Rockcastle | gap | Without Ownership | No parcel polygon layer found. |
| Russell | gap | With Ownership | russellpva.com sits behind a bot challenge; no arcgis.com layer found. PVA/vendor: qPublic + PVA tax-mapping site (host unknown). |
| Taylor | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: qPublic (qpublic.net/ky/taylor); Equator data page. |
| Trigg | gap | With Ownership | No parcel polygon layer found. PVA/vendor: qPublic (Schneider) + Equator. |
| Union | gap · token-gated | Without Ownership | The county org's zoning services (Morganfield, Sturgis, Waverly) answer Token Required and its subscription is disabled; no parcel layer in the org. PVA/vendor: qPublic (qpublic.net/ky/union). |
| Washington | gap | Not Yet Available | No parcel polygon layer found. PVA/vendor: unknown (washingtonkypva.com; qPublic listed by aggregators). |
| Wayne | gap | Without Ownership | `kygisserver …/Ky_PVA_Wayne_Parcels_WGS84WM` returns a real 404 (probed through the relay 10-20); the old kygeonet viewer is gone; qPublic is the PVA's site. PVA/vendor: KY DGI/KyGeoNet PVA viewer (ArcGIS Server WGS84WM) + qPublic. |
| Whitley | gap | With Ownership | No parcel polygon layer found. PVA/vendor: qPublic (qpublic.net/ky/whitley). |
| Wolfe | gap | With Ownership | No parcel polygon layer found. PVA/vendor: Equator. |


## Tennessee non-state counties (2026-10-21)

**Reported:** searching "20 Culvert St, Nashville, TN" centred the map on the right aerial and then read "No parcel at this point" with no outlines anywhere (B2408832); two Rutherford County parcel ids (156-002.01-000, 156-027.00-000) could not be found at all (B2408833).

**Root cause (measured, not inferred).** The Comptroller's `Tennessee_Property_Boundaries_Public_Use` says it holds "86 of 95 counties; 9 use non-state assessment systems". A per-county count over the layer itself (`outStatistics count(OBJECTID) groupBy COUNTY_ID, COUNTY_NAME`, 2026-10-21; committed as `test/fixtures/tnComptrollerCounties.json`) returns 86 counties and names the missing nine **by absence, not by a low count**: county ids **12 Chester · 19 Davidson · 33 Hamilton · 41 Hickman · 47 Knox · 63 Montgomery · 75 Rutherford · 79 Shelby · 94 Williamson**. Only Shelby and Chester were in `tn_statewide.excludedCounties`, so Davidson, Rutherford and the other five resolved to `statewideKey: "tn_statewide"`, every click and every outline request went to a layer that holds none of their lots, and a healthy-but-empty answer is exactly the "No parcel at this point" card (a statewide composite is a coverage claim, not a jurisdiction claim). This is the same mechanism B1437586 recorded as "consistently zero at Nashville" without naming it.

**What changed.** `excludedCounties` now lists all nine (computed from the fixture in `test/tnNonStateCounties.test.js`, which fails if the layer's absentees and the list ever disagree). Each of the nine is either wired to its own source or a named gap that says so and never borrows the composite:

| County | Outcome | Source | Id column | Owner | Notes |
|---|---|---|---|---|---|
| Davidson | **wired** `tn_davidson` | Metro Nashville — Planning Department / Assessor of Property, `Parcels_view` FeatureServer/0 on Nashville Open Data's AGOL org `HdTo6HJqh92wn4D8` (item `fa26cd93…`, `accessInformation` "Nashville Planning Department / Assessor of Property") | `STANPAR` (11 digits) | `Owner` | 287,729 lots, token-free, WKID 2274, maxRecordCount 2,000. Outline floor **17** (downtown zoom-16 cell = 2,238 lots). MEASURED 36.137653,-86.755160 → `10508026600` AKZO NOBEL COATINGS INC, 20 CULVERT ST, 9.52 ac. |
| Rutherford | **wired** `tn_rutherford` | Rutherford County GIS (AGOL org `36I6IHIdr660pAyH`, portal "Rutherford County GIS"), `ParcelsCAMA1` FeatureServer/0, "up to date CAMA data" edited 2026-10-21 | `ParcelID` (`156-027.00-000`) | `Owner1` | 123,298 lots, token-free, COUNTY=075. Outline floor **16**. 156-027.00-000 → RHODES DEVELOPMENT COMPANY 8.75 ac (Christiana); 156-002.01-000 → RHODES DEVELOPMENT COMPANY 37.00 ac. A second copy (`Parcel Data` layer 1, org `A5C0MR9xfkxVRwat`, published by the City of Murfreesboro's GIS manager, same schema, 123,256 lots) exists and was not used — the county's own org is primary. |
| Shelby | wired `tn_shelby` (2026-10-15) | Shelby County Assessor of Property `CERTParcel`, via `/gis-proxy` | `PARCELID` | `OWNER` | unchanged |
| Chester | wired `tn_chester` (2026-10-16) | Chester County Assessor via CaptureCAMA, via `/gis-proxy` | `L15Parce_2` | `GPDATA__OW` | unchanged |
| Williamson | **named gap** | none public found | — | — | The only Williamson parcels on AGOL are the City of Franklin's `publicmaps.franklintn.gov …/Planning/MapServer/2` (city UGB + Grassland water area only, "provided by Williamson County Tennessee" — a city scope, not the county) and a 2020s Koordinates shapefile upload by a university account (`kx_williamson_county_tennessee_parcels_SHP`, 3rd-party, stale). Neither is the county. |
| Hamilton | **named gap** | none public found | — | — | AGOL has only UT-Chattanooga and Red Bank municipal slices. A lead worth probing through the relay: the state's own `geoviewer.cot.tn.gov/arcgis/rest/services/GeoViewer/NonImpact_Parcels/MapServer` (a layer literally named "Hamilton", fields GISLINK/MAP/GROUP_/PARCEL/CALC_ACRE, WKID 102100). Unreachable from the build sandbox; allow-listed on the relay in this change for exactly that measurement (see B2408834). |
| Knox | **named gap** | none public found | — | — | KGIS (`kgis.org`) serves its public viewer from a Geocortex site over a cached basemap (`KGIS_Basemap_TNSP`, "Parcel Number" label layer); no queryable parcel polygon service was found. Unreachable from the sandbox. |
| Montgomery | **named gap — licence** | Austin Peay State University's `apnsgis4.apsu.edu/arcgis/rest/services/CMCGIS/Parcels/MapServer/0` mirrors the county assessor's data | — | — | **Not used:** its item says it is "shared solely for use by authorized clients … not to be redistributed, republished, or repurposed without prior written consent from APSU". A source Planyr may not reach is not wired. |
| Hickman | **named gap** | none public found | — | — | No AGOL parcel layer; nothing on the Comptroller's viewer index. |

**Id search.** The Site search box used to be address-only. Text that reads as a Tennessee parcel id (`lib/tnParcelId.js`: control map [+ letter] · group · parcel · special interest; any spacing, dots, dashes or none; a leading "Parcel ID:" / "APN" / "#" is dropped) is looked up on the counties' own layers before the geocoder is asked (`lib/parcelIdSearch.js`). An 11-digit number is both a valid control-map id and a valid Metro STANPAR, so both counties are asked, never guessed between. The outcomes are typed: found (lands on the lot, selected, a point inside it), not found (a sentence naming the counties asked), couldn't check (a county did not answer — never "doesn't exist"). The in-planner per-county ID lookup normalises through the same parser for any county declaring `idNormalizer: "tn-control"`. Shelby's and Chester's id formats are county-specific and are not read yet (their address search and click path are unchanged).

**Address snap.** A geocoded address that lands in the road no longer dead-ends where the county layer carries a situs column: `lib/addressSnap.js` asks that county's layer for the lot whose house number AND street first word match, within 300 m of the point, exactly one match; anything else leaves the card as it was.
