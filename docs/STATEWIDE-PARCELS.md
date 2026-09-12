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
| Alabama (AL) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Arkansas (AR) | county | blocked-in-sandbox | [Parcel Polygon — County Assessor Mapping Program (CAMP), Arkansas GIS Office](https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — gis.arkansas.gov) |
| Arizona (AZ) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| California (CA) | county | measured-reachable | [California Statewide Parcels Public View (CAL FIRE — CA Dept. of Forestry & Fire Protection, org ITS.CALFIRE)](https://bz1uwWPKUInZBK94.svcs5.arcgis.com/bz1uwWPKUInZBK94/arcgis/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0) | agol | yes (200, 456ms) | 13,138,000 | esriGeometryPolygon | parcelId=`PARCEL_APN`, owner=absent, situsAddress=`SITE_ADDR`, landArea=absent, appraisedValue=absent | lat 102% · lon 112% of state | 655ms, 2000 feat. | ✅ |
| Colorado (CO) | county | already-wired | none found | — | — | — | — | — | — | — | ✅ (already) |
| Connecticut (CT) | town/municipal (no functioning county government); CT OPM GIS Office aggregates via the regional Councils of Government under CGS §4d-90–92 | measured-reachable | [Connecticut State Parcel Layer 2023](https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0) | gov | yes (200, 215ms) | 1,247,506 | esriGeometryPolygon | parcelId=absent, owner=`Owner`, situsAddress=absent, landArea=absent, appraisedValue=absent | lat 93% · lon 97% of state | 719ms, 2000 feat. | ✅ |
| District of Columbia (DC) | none — single consolidated city government (DC Office of Tax & Revenue) | measured-reachable | [Owner Polygons / Common Ownership Layer, layer 40 (DC GIS, Property_and_Land_WebMercator)](https://maps2.dcgis.dc.gov/dcgis/rest/services/DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/40) | gov | blocked (sandbox policy) | 137,400 | esriGeometryPolygon | parcelId=absent (OWNERNAME/PREMISEADD carry identity), owner=`OWNERNAME`, situsAddress=`PREMISEADD`, landArea=`LANDAREA`, appraisedValue=`NEWTOTAL` | — | — | ✅ (Verify: live — maps2.dcgis.dc.gov) |
| Delaware (DE) | county (3: Kent, New Castle, Sussex) | blocked-in-sandbox | [Delaware State Parcels 2.0 — without Ownership Information (FirstMap)](https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — enterprise.firstmap.delaware.gov) |
| Florida (FL) | county | measured-reachable | [Florida Statewide Cadastral (FL Dept. of Revenue, Property Tax Oversight)](https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0) | gov | yes (200, 346ms) | 10,831,924 | esriGeometryPolygon | parcelId=`PARCEL_ID`, owner=absent, situsAddress=absent, landArea=`LND_SQFOOT`, appraisedValue=absent | lat 99% · lon 102% of state | ⛔ 8002ms (timed out) | ✅ |
| Georgia (GA) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Hawaii (HI) | county (4 counties only; state has had zero role in valuation since a 1981 constitutional amendment) | blocked-in-sandbox | [Hawaii Statewide TMKs (State Office of Planning & Sustainable Development, ParcelsZoning MapServer layer 25)](https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — geodata.hawaii.gov) |
| Iowa (IA) | county assessor generally; 8 larger cities (Cedar Rapids, Iowa City, Des Moines, etc.) run an independent City Assessor | no-free-source | none found | — | — | — | — | — | — | — | — |
| Idaho (ID) | county | measured-reachable | [Public Idaho Parcels — layer 7 "Parcels Public" (Idaho OITS)](https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/7) | gov | yes (200) | 381,144 | esriGeometryPolygon | parcelId=`PARCEL_ID`, owner=`OWNER1`, situsAddress=`SITE_ADD`, landArea=`ASR_ACRES`, appraisedValue=`VAL_TOTAL` | lat 66% · lon 104% of state | 1682ms, 2000 feat. | ✅ (13 of 44 counties — see County-level section) |
| Illinois (IL) | township assessors within most counties do the initial valuation (Cook County is the exception, assessing directly); county Supervisor of Assessments reviews/equalizes | no-free-source | none found | — | — | — | — | — | — | — | — |
| Indiana (IN) | county assessor by default since a 2008 reform; a handful of larger townships above a population threshold retain their own elected township assessor | blocked-in-sandbox | [Parcel Boundaries of Indiana (Indiana Geographic Information Office, Data Harvest)](https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — gisdata.in.gov) |
| Kansas (KS) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Kentucky (KY) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Louisiana (LA) | parish (64 parishes, each with an elected parish assessor — no county, no appraisal-district concept) | no-free-source | none found | — | — | — | — | — | — | — | — |
| Massachusetts (MA) | city/town (351 cities/towns; counties have no assessing function) | measured-reachable | [Massachusetts Property Tax Parcels (MassGIS, EOTSS)](https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0) | gov | yes (200, 119ms) | 2,559,319 | esriGeometryPolygon | parcelId=`PROP_ID`, owner=`OWNER1`, situsAddress=`SITE_ADDR`, landArea=`LOT_SIZE`, appraisedValue=`LAND_VAL` | lat 98% · lon 100% of state | 5684ms, 2000 feat. | ✅ |
| Maryland (MD) | state-run — SDAT (Dept. of Assessments & Taxation) runs 24 local offices directly; not independent county assessors | blocked-in-sandbox | [MD iMAP — Parcel Boundaries (SDAT-sourced, monthly)](https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — mdgeodata.md.gov) |
| Maine (ME) | town/municipality (482 towns); Unorganized Territory assessed directly by Maine Revenue Services | measured-reachable | ["Maine Parcels Organized Towns", layer 10 (the ONLY layer on this service)](https://services1.arcgis.com/RbMX0mRVOFNTdLzd/ArcGIS/rest/services/Maine_Parcels_Organized_Towns/FeatureServer/10) | agol | yes (200, 158–174ms) | 708,382 | esriGeometryPolygon | parcelId=`STATE_ID`, owner=absent, situsAddress=`PROP_LOC`, landArea=absent, appraisedValue=absent | lat 98% · lon 102% of state | 378ms, 2000 feat. | ✅ |
| Michigan (MI) | township/city (local unit assessor); county Equalization Department only reviews aggregate classes, cannot change an individual assessment | no-free-source | none found | — | — | — | — | — | — | — | — |
| Minnesota (MN) | county (87 counties) | measured-reachable | [Minnesota Parcels — Opt-In Open Data (MnGeo)](https://utility.arcgis.com/usrsvcs/servers/1627519e8d3f42bcb55532d48e9a61e5/rest/services/OpenParcels/plan_parcels_open/MapServer/0) | gov | yes (200, 180ms) | — | esriGeometryPolygon | parcelId=`county_pin`, owner=`owner_name`, situsAddress=absent, landArea=`acres_poly`, appraisedValue=absent | lat 3051% · lon 1162% of state | 114ms, 20000 feat. | ✅ |
| Missouri (MO) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Mississippi (MS) | county | shape-mismatch | [MS_East_Parcels](https://gis.mississippi.edu/server/rest/services/Cadastral/MS_East_Parcels/MapServer/0) + [MS_West_Parcels](https://gis.mississippi.edu/server/rest/services/Cadastral/MS_West_Parcels/MapServer/0) — real, measured, two half-state services | — | — | — | — | — | — | — | — |
| Montana (MT) | state-run — MT Dept. of Revenue (ORION CAMA) appraises nearly all property statewide per the MT Constitution; counties bill/collect | measured-reachable | [Montana Cadastral Framework (Montana State Library, MSDI)](https://services.arcgis.com/qnjIrwR8z5Izc0ij/ArcGIS/rest/services/Montana_Cadastral_Framework/FeatureServer/1) | gov | yes (200, 189ms) | 921,301 | esriGeometryPolygon | parcelId=`PARCELID`, owner=`OwnerName`, situsAddress=absent, landArea=`GISAcres`, appraisedValue=`TotalLandValue` | lat 106% · lon 104% of state | 215ms, 2000 feat. | ✅ |
| North Carolina (NC) | county | blocked-in-sandbox | [NC OneMap Parcels — NC Integrated Cadastral Data Exchange](https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — services.nconemap.gov (also confirm the '/secure/' path is not a login wall)) |
| North Dakota (ND) | county | measured-reachable | [ND State Parcel Program (NDIT, aggregated by AppGeo from 51+ counties)](https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0) | gov | yes (200, 251ms) | 742,200 | esriGeometryPolygon | parcelId=absent, owner=`Ownership`, situsAddress=absent, landArea=`CalculatedAcres`, appraisedValue=absent | lat 99% · lon 100% of state | 324ms, 2000 feat. | ✅ |
| Nebraska (NE) | county | blocked-in-sandbox | [Nebraska Statewide Parcels External (NE OCIO, Enterprise)](https://gis.ne.gov/Enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — gis.ne.gov) |
| New Hampshire (NH) | town/municipal (RSA 76; NH DRA provides oversight/equalization only) | blocked-in-sandbox | [NH Parcel Mosaic — layer 1 'Parcels' (NH GRANIT / UNH)](https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosaic/MapServer/1) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — nhgeodata.unh.edu) |
| New Jersey (NJ) | municipal (each municipality has its own Tax Assessor) | blocked-in-sandbox | [Parcels and MOD-IV Composite of New Jersey (NJOGIS + NJ Treasury MOD-IV)](https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — maps.nj.gov) |
| New Mexico (NM) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Nevada (NV) | county | measured-reachable | [County_Parcels_In_Nevada_Yellow (Nevada Division of Water Resources)](https://arcgis.water.nv.gov/arcgis/rest/services/BaseLayers/County_Parcels_In_Nevada_Yellow/MapServer/0) | gov | blocked (sandbox policy) | 1,394,188 | esriGeometryPolygon | parcelId=`APN`, owner=absent, situsAddress=absent (`SiteCity` only), landArea=`Acres`, appraisedValue=absent | — | 5-point spread: Las Vegas 132ms · Reno 203ms · Elko 147ms · Carson City 103ms · Pahrump 178ms | ✅ (Verify: live — arcgis.water.nv.gov) — B1455632: the sibling `County_Parcels_in_Nevada` service this row wired originally went empty (0 layers, `/0` → 404) between 8:50 PM and 10:57 PM Central on 2026-09-10; the state had republished the same 1,394,188-feature data one service name over on the same host, re-verified 2026-09-11 morning. Rejects `resultRecordCount` ("Pagination is not supported"); accepts `returnCountOnly`. |
| New York (NY) | town/municipal (city/town assessors; NYS ORPTS provides oversight/certification) | measured-reachable | [NYS Tax Parcels Public — official ArcGIS Online mirror (NYS ITS Geospatial Services + Dept. of Taxation & Finance ORPTS, org account NYSGIS_GPO)](https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1) | gov | yes (200, 342ms) | 3,827,530 | esriGeometryPolygon | parcelId=`MUNI_PARCEL_ID`, owner=`PRIMARY_OWNER`, situsAddress=absent, landArea=`ACRES`, appraisedValue=`FULL_MARKET_VAL` | lat 100% · lon 101% of state | 501ms, 1000 feat. | ✅ |
| Ohio (OH) | county (elected County Auditor) | measured-reachable | [Ohio Statewide Parcels — public view (OGRIP)](https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0) | gov | yes (200, 226ms) | 6,313,610 | esriGeometryPolygon | parcelId=`LocalParcelID`, owner=absent, situsAddress=`SitusAddressAll`, landArea=`LandArea`, appraisedValue=absent | lat 92% · lon 103% of state | ⛔ 8001ms (timed out) | ✅ |
| Oklahoma (OK) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Oregon (OR) | county (ORMAP is the state's own cooperative cadastral base-map program) | no-free-source | none found | — | — | — | — | — | — | — | — |
| Pennsylvania (PA) | county (67 autonomous assessing authorities) | no-free-source | none found | — | — | — | — | — | — | — | — |
| Rhode Island (RI) | town/municipal — RI abolished county government in 1842; 39 towns/cities each run their own independent Tax Assessor | blocked-in-sandbox | [Tax Parcels (RIGIS — the RI state GIS clearinghouse, org RIGIS_ADMIN / RIDEM Map Room)](https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/0) | agol | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — risegis.ri.gov) |
| South Carolina (SC) | county (46 counties, elected/appointed Assessor) | no-free-source | none found | — | — | — | — | — | — | — | — |
| South Dakota (SD) | county | no-free-source | none found | — | — | — | — | — | — | — | — |
| Tennessee (TN) | county (elected County Assessor; Comptroller's Division of Property Assessments provides oversight) | measured-reachable | [Tennessee Property Boundaries Public Use (TN Comptroller, Base Mapping Program)](https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0) | gov | yes (200, 213ms) | 2,141,289 | esriGeometryPolygon | parcelId=`PARCELID`, owner=`OWNER`, situsAddress=absent, landArea=absent, appraisedValue=absent | lat 100% · lon 100% of state | ⛔ 3674ms, 0 feat. — zero at a covered point | ✅ |
| Texas (TX) | appraisal district (a separate legal entity per county under the TX Property Tax Code — not a county government department) | already-wired | none found | — | — | — | — | — | — | — | ✅ (already) |
| Utah (UT) | county (29 counties) | measured-reachable | [Utah Statewide Parcels (UGRC/AGRC)](https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0) | gov | yes (200, 54ms) | 1,596,196 | esriGeometryPolygon | parcelId=`PARCEL_ID`, owner=absent, situsAddress=absent, landArea=absent, appraisedValue=absent | lat 100% · lon 100% of state | 1480ms, 2000 feat. | ✅ |
| Virginia (VA) | county/independent city (98 counties + 39 independent cities, each its own assessing jurisdiction) | blocked-in-sandbox | [Virginia Parcels (VDEM, VA_Base_Layers)](https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0) | gov | blocked (sandbox policy) | — | — | — | — | — | ✅ (Verify: live — vginmaps.vdem.virginia.gov) |
| Vermont (VT) | town (247 towns; VT counties have no assessing role) | measured-reachable | [VT Parcel Program (Vermont Center for Geographic Information, joined to the Dept. of Taxes Grand List)](https://services.arcgis.com/XG15cJAlne2vxtgt/ArcGIS/rest/services/VT_Parcel/FeatureServer/665) | gov | yes (200, 228ms) | 339,251 | esriGeometryPolygon | parcelId=absent, owner=`OWNER1`, situsAddress=absent, landArea=`ACRESGL`, appraisedValue=absent | lat 100% · lon 106% of state | 149ms, 2000 feat. | ✅ |
| Washington (WA) | county (39 counties) | no-free-source | none found | — | — | — | — | — | — | — | — |
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
- **Alabama (AL):** No state-level parcel aggregation found (Alabama GeoHub, ADOR mapping pages, AGIC hubs checked) — parcels are county-only.
- **Arkansas (AR):** Rich schema (id/owner/situs/area/value all present) confirmed via ArcGIS Hub's cached item metadata (2,117,780 features) — gis.arkansas.gov itself is blocked in this sandbox.
- **Arizona (AZ):** AZGeo/AGIC checked; the only state-run 'parcels' layer (ASLD State_Trust_Parcels) covers only state-trust land, not general private parcels. server.azgeo.az.gov blocked in this sandbox.
- **California (CA):** MEASURED FROM THIS SANDBOX (HTTP 200) and independently from the owner's own browser, 2026-09-08. 13,138,000 parcels — the largest source in counties.js, ~21% above Florida's 10.8M, which the same wiring already handles (nothing ever fetches a layer whole: the display layer is viewport-queried and gated at PARCEL_MINZOOM, and a truncated draw is reported loudly). Polygon, 21 fields: PARCEL_APN, FIPS_CODE, PARCEL_DMP_ID, COUNTYNAME, SITE_ADDR/CITY/STATE/ZIP, FullStreetAddress, Search_PARCELAPN. NO owner and NO appraised value — attribute-light, the same standing already given to Hawaii, New Hampshire and Virginia. ⛔ FOUND BY THE AGOL PASS (NEW-2), NOT BY A .gov PROBE: the prior 'no free source' finding came from searching California's own .gov GIS hosts, which this sandbox cannot reach, and never searching California's state-agency ArcGIS Online organization, which it can. That blind spot is what NEW-2 closes systematically.
- **Colorado (CO):** Already wired (co_statewide) — Colorado Public Parcels composite, gis.colorado.gov. Not re-probed here; that host is blocked in this sandbox (as expected — production reaches it fine).
- **Connecticut (CT):** Rich CAMA-style schema (owner/situs/value present) but no dedicated parcel-ID field surfaced on this hosted copy — only OBJECTID.
- **District of Columbia (DC):** ⛔ RETRACTED 2026-09-10 (B1455632). The `shape-mismatch` verdict above (an ITSPE attribute table joined to a separate Tax Lots geometry layer by an SSL key) was a real finding about a DIFFERENT candidate on this same service — it did not rule out the service having a single, already-joined layer, and it does. Layer 40 ("Owner Polygons / Common Ownership Layer") carries BOTH the geometry and the richest attribute set of anything wired in this repo in ONE layer, no join needed: OWNERNAME, owner mailing address, PREMISEADD, LANDAREA, PROPTYPE, USECODE, NEWLAND/NEWIMPR/NEWTOTAL assessed values, SALEPRICE, SALEDATE, ASSESSMENT, ANNUALTAX, TAXRATE, NBHDNAME. MEASURED FROM THE OWNER'S OWN BROWSER 2026-09-10 (maps2.dcgis.dc.gov is blocked in this sandbox) — 137,400 features, 632ms. ⛔ Layer 33 ("Parcel Lots"), on the SAME service, is a trap: only 1,124 features and returns ZERO downtown — not wired.
- **Delaware (DE):** id + acreage confirmed via Hub metadata (451,344 features); owner/situs deliberately absent from this public copy (a fuller version requires a FirstMap login). enterprise.firstmap.delaware.gov blocked in this sandbox.
- **Florida (FL):** Best-in-class: full attribute set, 10.8M parcels, updated annually every August from all 67 counties.
- **Georgia (GA):** Georgia GIS Clearinghouse covers 'more than 20% of counties' and is a per-county directory, not a mosaic; DOR's 'tax digest' is tabular jurisdiction totals, not parcel geometry. No state aggregation effort found.
- **Hawaii (HI):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — geodata.hawaii.gov is blocked here. Layer 25 'Statewide TMKs', polygon, 18 fields: tmk, tmk_txt, county, island, gisacres, qpub_link. No owner, no value. ⛔ Layer 0 is a GROUP LAYER with zero fields; layers 5/9/11/30 are per-county and were deliberately NOT wired — layer 25 is the statewide mosaic.
- **Iowa (IA):** The only free statewide layer found (Iowa_Parcels_2017, reachable, id+owner present) is EXPLICITLY disclaimed by its own publisher as deprecated/frozen at Nov 2017 and 'not current' — 9 years stale. Not wired: a data-currency disqualification, not a reachability one.
- **Idaho (ID):** ⛔ CORRECTED 2026-09-10 (B1455633). The `esriGeometryPoint` finding above was real but INCOMPLETE — it read layer 0 ("Idaho Parcels Public Centroids", point, parcel centroids) and never checked whether the SAME service published a polygon layer too. It does: layer 7, "Parcels Public", `esriGeometryPolygon`, 381,144 features, confirmed live from this sandbox. The "only 13 of 44 counties" finding stands and is NOT a defect to fix — it is why Idaho is wired as 13 individual per-county entries (`id_ada` … `id_washington`) rather than a statewide composite; wiring it as `id_statewide` would silently return zero for the other 31 counties, the same shape that produced the Nebraska defect (B1332016). See the County-level section below for the full per-county wiring.
- **Illinois (IL):** Illinois State Geological Survey clearinghouse hosts many statewide layers but no parcel mosaic. No aggregation found — matches the township-assessed pattern the brief names.
- **Indiana (IN):** Schema confirmed via ArcGIS item metadata XML: id + address present, owner and value fields absent from this layer entirely. gisdata.in.gov blocked in this sandbox.
- **Kansas (KS):** RETRACTED, corrected 2026-09-08 from the owner's own browser (not this sandbox): services.kansasgis.org root has ZERO services; its folders are FIRSTNET, ORKA, Utilities, water, wimas, wizard, and ORKA — the one folder that could plausibly hold parcels — holds only KS_ORKA_Extras and sketch. No parcel mosaic exists there. This replaces the prior 'not confirmed either way' finding, which is now a confirmed no.
- **Kentucky (KY):** Kentucky's own open-data portal (opengisdata.ky.gov) files every parcel dataset per-county with no combined statewide layer; DOR Mapping Services page describes supporting individual county PVAs, not running one central layer.
- **Louisiana (LA):** LAGIC / LSU Atlas / LA Division of Administration GIS / LA Tax Commission checked — no state-run parcel aggregation found. qpublic.net/la is a private directory of parish links, not a state service.
- **Massachusetts (MA):** Best-in-class of the whole probe: full schema (id/owner/situs/area/value), 2.56M parcels, semi-annual refresh.
- **Maryland (MD):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — mdgeodata.md.gov is blocked here. 'Parcel Boundaries', polygon, 117 fields: ACCTID, ADDRESS, ACRES, LANDAREA, NFMTTLVL (total value). Owner NAME is absent — only owner MAILING ADDRESS (OWNADD1 etc); the app leaves owner absent rather than fabricating it from the mailing fields.
- **Maine (ME):** ⛔ CORRECTED 2026-09-10 (B1455632). The `shape-mismatch` finding above read layer 0 of this service (which does need the ADB join for owner/value) and never checked layer 10, the service's ONLY OTHER layer — confirmed live from this sandbox: `esriGeometryPolygon`, 708,382 features, fields TOWN/COUNTY/STATE_ID/MAP_BK_LOT/PROP_LOC — everything the app's id/situs lookup needs, no join required. Owner and appraised value are still absent (they genuinely do live only in the un-joined ADB table) — left absent, never fabricated. **⛔ COVERAGE CAVEAT, stated plainly per the dispatch's own instruction: "Organized Towns" excludes Maine's UNORGANIZED TERRITORY — roughly HALF the state's LAND AREA (the North Woods) but almost none of its parcels (a handful of residents, no municipal government to assess them). This is NOT full statewide coverage; do not let it read as such anywhere in the app or in future docs.** The publisher's currency disclaimer ("data for many towns is more than fifteen years old") still applies to the organized-town data this layer DOES carry.
- **Michigan (MI):** Michigan DTMB confirms a statewide parcel layer exists inside its Michigan Geographic Framework, but states outright it is for internal state use only and is not published to the public Open Data portal — a real effort, deliberately not public.
- **Minnesota (MN):** Live-confirmed with real owner/value data on a sample feature. Coverage is OPT-IN — counties choose to participate quarterly, so completeness varies by county.
- **Missouri (MO):** MSDIS's full open-data catalog (176 datasets, checked directly) contains no parcels/cadastral dataset; the one parcel-shaped layer found (gis.mo.gov FMDCrealEstate) is scoped to state-OWNED real estate, not general private parcels.
- **Mississippi (MS):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — every MARIS host is blocked here. Real, rich statewide cadastral data exists — the best schema of the whole probe (55 fields: PARNO, OWNNAME, SITEADD, TAXACRES, GISACRES, LANDVAL, IMPVAL1, IMPVAL2, TOTVAL, DEEDREF, DEEDDATE, section/township/range) — but it ships as TWO half-state ArcGIS services, MS_East_Parcels and MS_West_Parcels (gis.mississippi.edu/server/rest/services/Cadastral/), never one statewide layerUrl. Not wired this round, same shape B1332016 already declined for DC: the per-county pattern in counties.js is a single layerUrl, and wiring only the East half would silently present half the state's coverage as the whole (the exact silent-wrong-answer class this repo keeps closing) — so it ships as not-wired-at-all rather than half-wired. Extending the source shape to a real two-service state is real, separate follow-up work.
- **Montana (MT):** Full schema (id/owner/situs/area/value) confirmed live, 921,024 parcels. MCA 2-6-1017 restricts using owner names as a mailing list, which does not affect this app's use.
- **North Carolina (NC):** Full schema confirmed via item metadata XML (id/owner/situs/area/value all present), all 100 counties + Eastern Band of Cherokee. The URL's own '/secure/' path segment is ambiguous — the item's `access` field reads public, but this needs a live check to rule out a login wall before relying on it. services.nconemap.gov blocked in this sandbox.
- **North Dakota (ND):** id + acreage present on this layer; owner/situs/value live on a separate joinable TaxRoll table (layer 1), not wired here — same attribute-light shape as Utah/Delaware.
- **Nebraska (NE):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-09), not this sandbox — gis.ne.gov is blocked here. "Nebraska Statewide Parcels External" (note the path is /Enterprise/, not the old /Agency/), polygon, 1,154,898 features (the retracted TaxParcelsDED layer was 75,394), capabilities Query,Extract, maxRecordCount 2000. Fields: State_PID, Parcel_ID, Situs_Address, Ph_Full_Address, Legal_Description, Twn, Sect, Rng, Acres_Deeded, GIS_Acres, Subdivision, County_ID. Verified GENUINELY statewide by five point probes spread across Nebraska, each returning a real parcel with a DISTINCT county: Omaha 41.2565/-95.9345 → County_ID 055 (Douglas), Scottsbluff 41.8666/-103.6672 in the far western panhandle → 157 (Scotts Bluff), Norfolk 42.0286/-97.4170 in the north → 119 (Madison), McCook 40.2019/-100.6254 in the southwest → 145 (Red Willow), Lincoln 40.8136/-96.7026 → 109 (Lancaster). A whole-layer `returnExtentOnly` request timed out at 12s (this layer is slow at that specific op — see NEW-3's timing-budget note), so the five-point spread is the coverage evidence on record rather than a converted layer extent.
- **New Hampshire (NH):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — nhgeodata.unh.edu is blocked here. ⛔ Layer 1 ('Parcels', polygon) — NOT layer 0 ('Parcel Points', POINT geometry, unusable for the app's polygon click routing). 20 fields: PID, Town, StreetAddress, DisplayId, CountyId, SLU. No owner, no value.
- **New Jersey (NJ):** Full schema confirmed via item metadata XML (id/owner/situs/area/value all present in the field list) — but owner-name values are reported REDACTED for many records under NJ's Daniel's Law privacy statute, so the field exists without always carrying data. maps.nj.gov blocked in this sandbox.
- **New Mexico (NM):** NM Taxation & Revenue Dept. explicitly disclaims distributing parcel data ('contact the assessor's office'); a same-named layer under the Office of the State Engineer is unverified and not listed in OSE's own public catalog. No confirmed statewide source.
- **Nevada (NV):** The DCNR/State Demographer mosaic's NRS 250 disqualification above STANDS — that is a different, real service, and this note does not overturn it. A SEPARATE candidate exists, published by the Nevada DIVISION OF WATER RESOURCES rather than the state GIS office or the demographer's org — exactly why every earlier GIS-office-targeted search missed it. No public-record restriction is stated on this item. Fields: APN, County, SiteCity, Acres, SourceDate, Website — `Website` is a per-parcel deep link to the county assessor's own record, the only wired source in this repo with that field. Clark and Washoe counties' OWN per-county layers are superseded by this statewide layer and are deliberately NOT wired separately. ⛔ **B1455632 (2026-09-11):** the originally-wired service ("County_Parcels_in_Nevada") went empty overnight on 2026-09-10 — healthy at 8:50 PM Central (1,394,188 features, five-point spread all real), reporting ZERO layers by 10:57 PM with `/0` answering "404 Layer not found." Not a throttle (an earlier note here blamed rate-limiting from heavy testing that night; RETRACTED — a throttle cannot empty a service's own layer list). The state had republished the identical data one service name over on the same host: "County_Parcels_In_Nevada_Yellow" ("County Parcels Yellow"), re-verified 2026-09-11 morning Central with the IDENTICAL 1,394,188 count and field list, five fresh spread probes (Las Vegas 132ms, Reno 203ms, Elko 147ms, Carson City 103ms, Pahrump 178ms) — this is the URL now wired. This service rejects `resultRecordCount` outright ("Pagination is not supported"); it accepts `returnCountOnly`.
- **New York (NY):** The publicly-cited host (gisservices.its.ny.gov) is blocked in this sandbox — same as production is expected to reach it — but the SAME dataset is independently reachable via NY's own official ArcGIS Online organizational account (not a third party), so this wires the mirror rather than parking the whole state on an unreachable primary. 3,827,530 parcels, full schema, covers the 38 counties+NYC that opted in (a companion Footprint layer names which).
- **Ohio (OH):** 6.3M parcels; owner name and appraised value are deliberately absent from this privacy-scrubbed public view (a MailAddressAll field is present as a proxy).
- **Oklahoma (OK):** A real statewide mosaic exists (Property Records Preservation LLC for the OK Office of Geographic Information) but is explicitly published as view/WMS-only with no downloadable or queryable REST FeatureServer/MapServer found on any reachable host.
- **Oregon (OR):** The Tax Lot layer the state's own 'Oregon Parcel Viewer' web app points to returns a real HTTP 400 'Invalid URL' — the service has been retired/unpublished, a genuine dead reference rather than a sandbox block. Every other candidate host (gis.odf.oregon.gov, ormap.net, data.oregon.gov) is blocked. Needs a fresh live search, not just a re-probe of this URL.
- **Pennsylvania (PA):** RETRACTED, corrected 2026-09-08 from the owner's own browser (not this sandbox): PASDA's service directory carries 170 services and EXACTLY ONE parcel service, ErieCountyParcels — county-only. There is no statewide PA parcel mosaic on PASDA. This replaces the prior 'high-confidence follow-up candidate' framing, which is now a confirmed no.
- **Rhode Island (RI):** MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — risegis.ri.gov is a state .gov host this environment's egress allowlist blocks (the CONNECT tunnel never opens). 'Tax Parcels', polygon, 394,167 parcels, published by RIGIS_ADMIN — the state clearinghouse ITSELF, not a town and not a third-party rehost. Fields: PlatLot (RI's own parcel identifier — with no counties since 1842, each of the 39 towns keys parcels by plat + lot), Acres, E911 and E911_Type (address), TownCode, IMP_sqft, Last_UPD. NO owner, NO appraised value — the same attribute-light standing already given to Hawaii, New Hampshire and Virginia. ⛔ FOUND BY THE AGOL PASS (NEW-2): the item is discoverable on ArcGIS Online (searchable from this sandbox) even though the service it points at is not reachable from here.
- **South Carolina (SC):** The only statewide DNR/RFA service found (SC_County_Parcel_Viewers) is a lookup TABLE of links to each county's own separate viewer, not aggregated geometry; RFA's own page describes its aggregated parcels as available only via 'secure' (non-public) REST services.
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
| AL | Jefferson (Birmingham) | `al_jefferson` | 1 (dispatch browser; host blocked here) | 2026-09-10 | |

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
  still unresolved: routes 1/2/4 found several real "Wayne County" candidates, but every one either
  fails a spread point outright (covers only part of the county) or is itself stale — the
  best-scoring one, "Parcels - MI - Wayne County" (owner GDITAdmin), carries no year in its title
  but its own `editingInfo.dataLastEditDate` is 2018, 8 years stale, caught only because this
  session's harness was extended to check that field too (see BACKLOG.md). Route 3 found
  `gis.macombgov.org` for the neighboring county (Macomb, below) but no equivalently-named Wayne
  County host; a live pass should re-run route 3 against `gis.waynecounty.com` /
  `www.waynecounty.com` — this sandbox's pattern guesses for Wayne's own domain were all blocked
  before returning a result either way.

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
  "Parcels - PA - Luzerne County" (two, same host).
- **Lackawanna County, PA** — `gis.lackawannacounty.org`, AGOL item "Lackawanna County Parcels".

**Re-attempted this session, no good candidate on any route — every hit was either wrong-state
noise (a same-named county elsewhere: Jackson County OR for Jackson MO, Winnebago County WI for
Winnebago IL, Johnson County MO for Johnson KS, Niagara County NY for Orleans LA) or a generic,
unrelated "County Cadastral Layers"-titled host that recurred across many unrelated queries:**
Henry (GA) · Winnebago (IL) · Orleans (LA).

**Not found by routes 1-3 on 2026-09-11 — tried from Michael's OWN browser (open egress, not this
sandbox) and STILL did not answer, so these are genuinely harder than a sandbox block, never "no
source":**
- **Macomb County, MI** — `gis.macombgov.org` (the route 3 hostname harvest's own candidate,
  AGOL item "Parcels - MI - Macomb County") did not answer live either.
- **Johnson County, KS** — `aims.jocogov.org` did not answer live.
- **Jackson County, MO** — `gis.jacksongov.org` did not answer live.

**Not on this session's Tier 1 roster, unchanged from the 2026-09-10 pass — several almost
certainly publish parcels through a route not yet tried against them specifically:**
Ingham (MI) · Washington (OR) · Boone (KY).
