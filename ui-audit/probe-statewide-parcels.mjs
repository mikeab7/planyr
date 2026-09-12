#!/usr/bin/env node
/* probe-statewide-parcels.mjs — NEW-1: does a FREE statewide parcel GIS service exist for each
 * of the 50 states + DC, and can Planyr's own environment actually reach it?
 *
 * THE PREMISE CORRECTION THIS PROBE ANSWERS (dispatch brief, 2026-09-08). "Appraisal district" is
 * a Texas-specific legal construct; most states assess at the county level, several (CT, ME, MA,
 * MI, MN, NH, NJ, RI, VT, WI, IL, IN in places) assess at the town/township level with no county
 * role at all, and Louisiana uses parishes. There is no 50-state roster of "appraisal districts"
 * to enumerate — the only honest approach is to probe each state for whatever free STATEWIDE
 * AGGREGATION effort (if any) exists, regardless of the assessing unit underneath it.
 *
 * ⛔ A NULL RESULT IS A RESULT. Most states have no such aggregation — that is the expected,
 * correct finding for the majority of rows, not a probe failure. Never omit a state because
 * nothing was found; the "no free source" row is exactly as load-bearing as a "yes" row.
 *
 * ⛔ THIS BUILD ENVIRONMENT SITS BEHIND AN EGRESS ALLOWLIST, MEASURED 2026-09-08. Any `*.arcgis.com`
 * host (services.arcgis.com, services1-9.arcgis.com, utility.arcgis.com, hub.arcgis.com,
 * opendata.arcgis.com, www.arcgis.com) is reachable — Esri's own SaaS hosting is broadly
 * allowlisted. Most individual state .gov/.us GIS domains are NOT — curl gets
 * `CONNECT tunnel failed, response 403`. THAT 403 MEANS "blocked by this build environment's
 * policy", not "the service is down." This probe reports the two cases distinctly
 * (`reachable:false, blocked:true` vs a real host response) — never conflate them. A state whose
 * only candidate sits on a blocked custom domain is not wireable as *sandbox-verified*, but it can
 * still be wired the way this repo already wires Chambers/Larimer County (CLAUDE.md's
 * countiesProvenance.js pattern): shipped on the strength of independent evidence (an official
 * ArcGIS Online item's own cached schema, reachable via the allowlisted *.arcgis.com API even when
 * the origin service itself is not), filed `Verify: live` with the exact blocked host named.
 *
 * WHAT COUNTS. One endpoint (ArcGIS REST FeatureServer/MapServer preferred) published by a state
 * government, its GIS coordinating office, or a state-designated body, aggregating parcel data
 * across many/all counties (or towns/parishes), free, no login. A single county's own CAD/assessor
 * site is out of scope — that's the existing per-county tier in counties.js.
 *
 * Run:  node ui-audit/probe-statewide-parcels.mjs          (writes docs/STATEWIDE-PARCELS.md)
 *       node ui-audit/probe-statewide-parcels.mjs --json    (machine-readable dump, no doc write)
 *       node ui-audit/probe-statewide-parcels.mjs --no-write (probe + print, skip the doc write)
 *
 * Deliberately kept OUT of the required CI `build` gate (.github/ci-gates.yml) — it makes live
 * network calls to 50+ hosts, most of which this environment can't even reach, so a red run here
 * would say nothing about the correctness of a code change. Exposed via `npm run probe:parcels`
 * (NEW-2) so it can be re-run on demand — an endpoint that moves or retires silently turns a wired
 * source into a silent wrong answer, exactly the class `normCountyKey`/countiesProvenance.js exist
 * to keep visible. Never exits non-zero — an instrument, not a gate (retention-probe.mjs precedent).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  searchState, makeOrgResolver, classifyPublisher, looksParcelShaped,
  serviceLayerUrl, assessKnownGood,
} from "./lib/agolParcelSearch.mjs";
import {
  STATE_PROBE_POINT, ENVELOPE_QUERY_BUDGET_MS,
  projectExtentToWgs84, extentCoverageCheck, probeEnvelopeTiming, pointInsideExtent,
} from "./lib/statewideCoverage.mjs";
import { hostnameOf, isHostOpen, hostCooldownMs, recordHostOutcome, waitForHostSlot } from "./lib/hostThrottle.mjs";
import { walkForReplacement } from "./lib/serviceNeighbourWalk.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DOC_PATH = join(ROOT, "docs", "STATEWIDE-PARCELS.md");
const TIMEOUT_MS = 15000;
const JSON_OUT = process.argv.includes("--json");
const NO_WRITE = process.argv.includes("--no-write") || JSON_OUT || process.argv.includes("--agol-only");
/* NEW-2 — the AGOL organization pass runs by default; `--no-agol` skips it (it costs ~200 extra
 * arcgis.com requests, which is fine for an on-demand instrument and pointless when you only want
 * to re-verify the endpoints already wired). */
const NO_AGOL = process.argv.includes("--no-agol");
/* `--agol-only` runs pass 2 alone (no `.gov` re-probe) for a quick discovery sweep. It NEVER
 * writes the doc: with pass 1 skipped, every pass-1 cell would be hollowed out, and a doc that
 * loses measured rows because someone ran a faster flag is worse than no refresh at all. */
const AGOL_ONLY = process.argv.includes("--agol-only");

/* ---------------------------------------------------------------------------------------------
 * CANDIDATES — one entry per state + DC, filled from a live web-search + curl research pass
 * (2026-09-08, dispatched across 6 parallel research agents, one per ~8-9 states — never typed
 * from memory; every URL below was found via search and hit at least once, either directly or
 * through an ArcGIS Online item/Hub metadata mirror when the origin host was sandbox-blocked).
 *
 * `sources`: candidate service layer URLs this probe re-verifies LIVE on every run — empty when
 * research found no free statewide aggregation. `noSource`: the reason, when `sources` is empty.
 * `note`: research context a live probe can't measure itself (staleness disclaimers, licensing
 * restrictions, third-party-rehost provenance, coverage caveats) — carried into the doc verbatim.
 * -------------------------------------------------------------------------------------------- */
export const CANDIDATES = {
  AL: { name: "Alabama", assessingUnit: "county", sources: [],
    noSource: "No state-level parcel aggregation found (Alabama GeoHub, ADOR mapping pages, AGIC hubs checked) — parcels are county-only." },
  AK: { name: "Alaska", wired: true, assessingUnit: "borough/municipality (organized); no local assessor in the unorganized borough",
    sources: [{ name: "Alaska Statewide Parcels (AK DNR, Div. of Forestry & Fire Protection)", url: "https://services1.arcgis.com/7HDiw78fcUiM2BWn/arcgis/rest/services/AK_Parcels/FeatureServer/0", cite: "hub.arcgis.com/maps/SOA-DNR::alaska-statewide-parcels" }],
    note: "Explicitly a best-effort mosaic — not every borough has its own parcel service, coverage is uneven; publisher says use the original per-borough services for authoritative data." },
  AZ: { name: "Arizona", assessingUnit: "county", sources: [],
    noSource: "AZGeo/AGIC checked; the only state-run 'parcels' layer (ASLD State_Trust_Parcels) covers only state-trust land, not general private parcels. server.azgeo.az.gov blocked in this sandbox." },
  AR: { name: "Arkansas", wired: true, verify: "live", blocker: "gis.arkansas.gov", assessingUnit: "county",
    sources: [{ name: "Parcel Polygon — County Assessor Mapping Program (CAMP), Arkansas GIS Office", url: "https://gis.arkansas.gov/arcgis/rest/services/FEATURESERVICES/Planning_Cadastre/FeatureServer/6", cite: "gis.arkansas.gov/product/parcel-polygon-county-assessor-mapping-program-polygon" }],
    note: "Rich schema (id/owner/situs/area/value all present) confirmed via ArcGIS Hub's cached item metadata (2,117,780 features) — gis.arkansas.gov itself is blocked in this sandbox." },
  AZ_UNUSED: undefined,
  CA: { name: "California", wired: true, assessingUnit: "county",
    sources: [{ name: "California Statewide Parcels Public View (CAL FIRE — CA Dept. of Forestry & Fire Protection, org ITS.CALFIRE)", url: "https://bz1uwWPKUInZBK94.svcs5.arcgis.com/bz1uwWPKUInZBK94/arcgis/rest/services/CA_Statewide_Parcels_Public_view/FeatureServer/0", cite: "arcgis.com item 2061fbc963464c5198ec064100802624", pass: "agol" }],
    // ⛔ RETRACTED OUTRIGHT, 2026-09-08 (NEW-1), not softened. This row previously read
    // `no-free-source` / `Candidate: none found`, with the note: "Only a static 2014
    // file-geodatabase download exists (UC Davis ICE, mirrored via LA County ArcGIS Hub) — 51 of
    // 58 counties, PARNO only, not a live REST service. No free live statewide equivalent to
    // Colorado's." Every operative clause of that is FALSE. A live, public, official REST Feature
    // Service exists, published by a state agency, covering the whole state, last modified
    // 2026-07-13 — and it was reachable from this very sandbox the entire time.
    note: "MEASURED FROM THIS SANDBOX (HTTP 200) and independently from the owner's own browser, 2026-09-08. 13,138,000 parcels — the largest source in counties.js, ~21% above Florida's 10.8M, which the same wiring already handles (nothing ever fetches a layer whole: the display layer is viewport-queried and gated at PARCEL_MINZOOM, and a truncated draw is reported loudly). Polygon, 21 fields: PARCEL_APN, FIPS_CODE, PARCEL_DMP_ID, COUNTYNAME, SITE_ADDR/CITY/STATE/ZIP, FullStreetAddress, Search_PARCELAPN. NO owner and NO appraised value — attribute-light, the same standing already given to Hawaii, New Hampshire and Virginia. ⛔ FOUND BY THE AGOL PASS (NEW-2), NOT BY A .gov PROBE: the prior 'no free source' finding came from searching California's own .gov GIS hosts, which this sandbox cannot reach, and never searching California's state-agency ArcGIS Online organization, which it can. That blind spot is what NEW-2 closes systematically." },
  CO: { name: "Colorado", assessingUnit: "county", sources: [], alreadyWired: true,
    note: "Already wired (co_statewide) — Colorado Public Parcels composite, gis.colorado.gov. Not re-probed here; that host is blocked in this sandbox (as expected — production reaches it fine)." },
  CT: { name: "Connecticut", wired: true, assessingUnit: "town/municipal (no functioning county government); CT OPM GIS Office aggregates via the regional Councils of Government under CGS §4d-90–92",
    sources: [{ name: "Connecticut State Parcel Layer 2023", url: "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_State_Parcel_Layer_2023/FeatureServer/0", cite: "maps.cteco.uconn.edu/map-services" }],
    note: "Rich CAMA-style schema (owner/situs/value present) but no dedicated parcel-ID field surfaced on this hosted copy — only OBJECTID." },
  DE: { name: "Delaware", wired: true, verify: "live", blocker: "enterprise.firstmap.delaware.gov", assessingUnit: "county (3: Kent, New Castle, Sussex)",
    sources: [{ name: "Delaware State Parcels 2.0 — without Ownership Information (FirstMap)", url: "https://enterprise.firstmap.delaware.gov/arcgis/rest/services/PlanningCadastre/DE_StateParcels/FeatureServer/0", cite: "de-firstmap-delaware.hub.arcgis.com" }],
    note: "id + acreage confirmed via Hub metadata (451,344 features); owner/situs deliberately absent from this public copy (a fuller version requires a FirstMap login). enterprise.firstmap.delaware.gov blocked in this sandbox." },
  DC: { name: "District of Columbia", assessingUnit: "none — single consolidated city government (DC Office of Tax & Revenue)",
    sources: [],
    // Owner correction, round 2 (2026-09-08): same bucket as Mississippi, not `no-free-source` —
    // a real source exists and one half of it was confirmed reachable, declined on SHAPE (a join
    // across two services), never on absence. No full REST URL is on record for either half (only
    // the item name / host), so the cell names them in plain text rather than a guessed link.
    shapeMismatch: true,
    shapeCandidate: "ITSPE attribute table (arcgis.com-hosted, reachable) + Tax Lots geometry layer (maps2.dcgis.dc.gov) — real, joined by an SSL key, two services",
    noSource: "Real, rich data exists but is split across two services — an attribute table (ITSPE, arcgis.com-hosted, reachable) and a separate Tax Lots geometry layer (maps2.dcgis.dc.gov, blocked), joined by an SSL key. Not wired this round: the existing per-county pattern is a single layerUrl, and joining two services is real follow-up work, not a same-shape wire." },
  FL: { name: "Florida", wired: true, assessingUnit: "county",
    sources: [{ name: "Florida Statewide Cadastral (FL Dept. of Revenue, Property Tax Oversight)", url: "https://services9.arcgis.com/Gh9awoU677aKree0/arcgis/rest/services/Florida_Statewide_Cadastral/FeatureServer/0", cite: "arcgis.com item efa909d6b1c841d298b0a649e7f71cf2" }],
    note: "Best-in-class: full attribute set, 10.8M parcels, updated annually every August from all 67 counties." },
  GA: { name: "Georgia", assessingUnit: "county", sources: [],
    noSource: "Georgia GIS Clearinghouse covers 'more than 20% of counties' and is a per-county directory, not a mosaic; DOR's 'tax digest' is tabular jurisdiction totals, not parcel geometry. No state aggregation effort found." },
  HI: { name: "Hawaii", wired: true, verify: "live", blocker: "geodata.hawaii.gov", assessingUnit: "county (4 counties only; state has had zero role in valuation since a 1981 constitutional amendment)",
    sources: [{ name: "Hawaii Statewide TMKs (State Office of Planning & Sustainable Development, ParcelsZoning MapServer layer 25)", url: "https://geodata.hawaii.gov/arcgis/rest/services/ParcelsZoning/MapServer/25", cite: "measured live in the owner's own browser, 2026-09-08 — not this sandbox" }],
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — geodata.hawaii.gov is blocked here. Layer 25 'Statewide TMKs', polygon, 18 fields: tmk, tmk_txt, county, island, gisacres, qpub_link. No owner, no value. ⛔ Layer 0 is a GROUP LAYER with zero fields; layers 5/9/11/30 are per-county and were deliberately NOT wired — layer 25 is the statewide mosaic." },
  ID: { name: "Idaho", assessingUnit: "county",
    sources: [{ name: "Public Idaho Parcels (Idaho Geospatial Office)", url: "https://services1.arcgis.com/CNPdEkvnGl65jCX8/arcgis/rest/services/Public_Idaho_Parcels_/FeatureServer/0", cite: "the-idaho-map-open-data-idaho.hub.arcgis.com" }],
    note: "Reachable with real fields, but geometry is POINT (parcel centroids), not polygon — incompatible with the app's polygon-outline click routing — and only 13 of 44 counties currently participate. Not wired: geometry-type mismatch, not a reachability problem." },
  IL: { name: "Illinois", assessingUnit: "township assessors within most counties do the initial valuation (Cook County is the exception, assessing directly); county Supervisor of Assessments reviews/equalizes", sources: [],
    noSource: "Illinois State Geological Survey clearinghouse hosts many statewide layers but no parcel mosaic. No aggregation found — matches the township-assessed pattern the brief names." },
  IN: { name: "Indiana", wired: true, verify: "live", blocker: "gisdata.in.gov", assessingUnit: "county assessor by default since a 2008 reform; a handful of larger townships above a population threshold retain their own elected township assessor",
    sources: [{ name: "Parcel Boundaries of Indiana (Indiana Geographic Information Office, Data Harvest)", url: "https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_Current/FeatureServer/0", cite: "indianamap.org/datasets/INMap::parcel-boundaries-of-indiana-current" }],
    note: "Schema confirmed via ArcGIS item metadata XML: id + address present, owner and value fields absent from this layer entirely. gisdata.in.gov blocked in this sandbox." },
  IA: { name: "Iowa", assessingUnit: "county assessor generally; 8 larger cities (Cedar Rapids, Iowa City, Des Moines, etc.) run an independent City Assessor",
    sources: [],
    noSource: "The only free statewide layer found (Iowa_Parcels_2017, reachable, id+owner present) is EXPLICITLY disclaimed by its own publisher as deprecated/frozen at Nov 2017 and 'not current' — 9 years stale. Not wired: a data-currency disqualification, not a reachability one." },
  KS: { name: "Kansas", assessingUnit: "county", sources: [],
    noSource: "RETRACTED, corrected 2026-09-08 from the owner's own browser (not this sandbox): services.kansasgis.org root has ZERO services; its folders are FIRSTNET, ORKA, Utilities, water, wimas, wizard, and ORKA — the one folder that could plausibly hold parcels — holds only KS_ORKA_Extras and sketch. No parcel mosaic exists there. This replaces the prior 'not confirmed either way' finding, which is now a confirmed no." },
  KY: { name: "Kentucky", assessingUnit: "county", sources: [],
    noSource: "Kentucky's own open-data portal (opengisdata.ky.gov) files every parcel dataset per-county with no combined statewide layer; DOR Mapping Services page describes supporting individual county PVAs, not running one central layer." },
  LA: { name: "Louisiana", assessingUnit: "parish (64 parishes, each with an elected parish assessor — no county, no appraisal-district concept)", sources: [],
    noSource: "LAGIC / LSU Atlas / LA Division of Administration GIS / LA Tax Commission checked — no state-run parcel aggregation found. qpublic.net/la is a private directory of parish links, not a state service." },
  ME: { name: "Maine", assessingUnit: "town/municipality (482 towns); Unorganized Territory assessed directly by Maine Revenue Services",
    sources: [],
    // Owner correction, round 2 (2026-09-08): same bucket as Mississippi/DC — a real, reachable,
    // 708,382-parcel mosaic exists, declined on SHAPE (needs an ADB join) AND on the publisher's
    // own currency disclaimer, never on absence. No full REST URL is on record (only the item
    // description), so the cell names it in plain text rather than a guessed link.
    shapeMismatch: true,
    shapeCandidate: "\"Maine Parcels Organized Towns\" mosaic (arcgis.com-hosted, reachable, 708,382 parcels) + a separate ADB ownership/value table — real, needs a join, publisher disclaims currency",
    noSource: "A real, live 'Maine Parcels Organized Towns' mosaic exists (arcgis.com-hosted, reachable, 708,382 parcels) but requires joining a separate ADB ownership/value table by ID, and the publisher's own notice states 'there is no complete statewide parcel data layer for Maine... data for many towns is more than fifteen years old.' Not wired this round: the join isn't the existing single-layerUrl shape, and the publisher itself disclaims completeness/currency." },
  MD: { name: "Maryland", wired: true, verify: "live", blocker: "mdgeodata.md.gov", assessingUnit: "state-run — SDAT (Dept. of Assessments & Taxation) runs 24 local offices directly; not independent county assessors",
    sources: [{ name: "MD iMAP — Parcel Boundaries (SDAT-sourced, monthly)", url: "https://mdgeodata.md.gov/imap/rest/services/PlanningCadastre/MD_ParcelBoundaries/MapServer/0", cite: "measured live in the owner's own browser, 2026-09-08 — not this sandbox" }],
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — mdgeodata.md.gov is blocked here. 'Parcel Boundaries', polygon, 117 fields: ACCTID, ADDRESS, ACRES, LANDAREA, NFMTTLVL (total value). Owner NAME is absent — only owner MAILING ADDRESS (OWNADD1 etc); the app leaves owner absent rather than fabricating it from the mailing fields." },
  MA: { name: "Massachusetts", wired: true, assessingUnit: "city/town (351 cities/towns; counties have no assessing function)",
    sources: [{ name: "Massachusetts Property Tax Parcels (MassGIS, EOTSS)", url: "https://services1.arcgis.com/hGdibHYSPO59RG1h/arcgis/rest/services/Massachusetts_Property_Tax_Parcels/FeatureServer/0", cite: "gis.data.mass.gov/datasets/massgis::massachusetts-property-tax-parcels" }],
    note: "Best-in-class of the whole probe: full schema (id/owner/situs/area/value), 2.56M parcels, semi-annual refresh." },
  MI: { name: "Michigan", assessingUnit: "township/city (local unit assessor); county Equalization Department only reviews aggregate classes, cannot change an individual assessment", sources: [],
    noSource: "Michigan DTMB confirms a statewide parcel layer exists inside its Michigan Geographic Framework, but states outright it is for internal state use only and is not published to the public Open Data portal — a real effort, deliberately not public." },
  MN: { name: "Minnesota", wired: true, assessingUnit: "county (87 counties)",
    sources: [{ name: "Minnesota Parcels — Opt-In Open Data (MnGeo)", url: "https://utility.arcgis.com/usrsvcs/servers/1627519e8d3f42bcb55532d48e9a61e5/rest/services/OpenParcels/plan_parcels_open/MapServer/0", cite: "gisdata.mn.gov/dataset/plan-parcels-open" }],
    note: "Live-confirmed with real owner/value data on a sample feature. Coverage is OPT-IN — counties choose to participate quarterly, so completeness varies by county." },
  MS: { name: "Mississippi", assessingUnit: "county", sources: [],
    // Owner correction, round 2 (2026-09-08): this row used to read `no-free-source` +
    // `Candidate: none found` despite BOTH real endpoints being on record — the exact defect the
    // round-1 correction was supposed to close, reproduced on the one state it decided about.
    // `shapeMismatch` + `shapeCandidate` are the fix: a real, measured, best-in-the-whole-probe
    // schema, declined on SHAPE (two half-state services), never presented as "nothing here".
    // West's `/MapServer/0` layer id is INFERRED consistent with East's (the same MARIS publishing
    // pattern) — not independently confirmed the way East's was; flagged so a future session
    // re-verifies rather than assumes.
    shapeMismatch: true,
    shapeCandidate: "[MS_East_Parcels](https://gis.mississippi.edu/server/rest/services/Cadastral/MS_East_Parcels/MapServer/0) + [MS_West_Parcels](https://gis.mississippi.edu/server/rest/services/Cadastral/MS_West_Parcels/MapServer/0) — real, measured, two half-state services",
    noSource: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — every MARIS host is blocked here. Real, rich statewide cadastral data exists — the best schema of the whole probe (55 fields: PARNO, OWNNAME, SITEADD, TAXACRES, GISACRES, LANDVAL, IMPVAL1, IMPVAL2, TOTVAL, DEEDREF, DEEDDATE, section/township/range) — but it ships as TWO half-state ArcGIS services, MS_East_Parcels and MS_West_Parcels (gis.mississippi.edu/server/rest/services/Cadastral/), never one statewide layerUrl. Not wired this round, same shape B1332016 already declined for DC: the per-county pattern in counties.js is a single layerUrl, and wiring only the East half would silently present half the state's coverage as the whole (the exact silent-wrong-answer class this repo keeps closing) — so it ships as not-wired-at-all rather than half-wired. Extending the source shape to a real two-service state is real, separate follow-up work." },
  MO: { name: "Missouri", assessingUnit: "county", sources: [],
    noSource: "MSDIS's full open-data catalog (176 datasets, checked directly) contains no parcels/cadastral dataset; the one parcel-shaped layer found (gis.mo.gov FMDCrealEstate) is scoped to state-OWNED real estate, not general private parcels." },
  MT: { name: "Montana", wired: true, assessingUnit: "state-run — MT Dept. of Revenue (ORION CAMA) appraises nearly all property statewide per the MT Constitution; counties bill/collect",
    sources: [{ name: "Montana Cadastral Framework (Montana State Library, MSDI)", url: "https://services.arcgis.com/qnjIrwR8z5Izc0ij/ArcGIS/rest/services/Montana_Cadastral_Framework/FeatureServer/1", cite: "arcgis.com item f161a98b347b4cf29d371a6d7697912a" }],
    note: "Full schema (id/owner/situs/area/value) confirmed live, 921,024 parcels. MCA 2-6-1017 restricts using owner names as a mailing list, which does not affect this app's use." },
  NE: { name: "Nebraska", wired: true, verify: "live", blocker: "gis.ne.gov", assessingUnit: "county",
    sources: [{ name: "Nebraska Statewide Parcels External (NE OCIO, Enterprise)", url: "https://gis.ne.gov/Enterprise/rest/services/StatewideParcelsExternal/FeatureServer/0", cite: "measured live in the owner's own browser, 2026-09-09 — not this sandbox" }],
    // ⛔ RETRACTED OUTRIGHT, 2026-09-09 (NEW-1). This row previously wired
    // gis.ne.gov/Agency/rest/services/TaxParcelsDED/MapServer/0 as "the OFFICIAL source directly" —
    // WRONG: it is a real, official NE OCIO layer, but its own extent (measured by the first real
    // spatial query run against every wired state) converts to roughly 40.98–41.21°N /
    // -96.34 to -95.84°W — Douglas/Sarpy/Cass/Saunders counties (the Omaha metro) plus
    // Pottawattamie/Mills counties across the line in Iowa, 75,394 features — and a query at
    // Omaha's own coordinates (41.2565, -95.9345) returned ZERO, because Omaha sits just north of
    // that layer's own covered extent. Every prior probe of this row checked METADATA only
    // (capabilities, field list) and never asked it a question at a real coordinate.
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-09), not this sandbox — gis.ne.gov is blocked here. \"Nebraska Statewide Parcels External\" (note the path is /Enterprise/, not the old /Agency/), polygon, 1,154,898 features (the retracted TaxParcelsDED layer was 75,394), capabilities Query,Extract, maxRecordCount 2000. Fields: State_PID, Parcel_ID, Situs_Address, Ph_Full_Address, Legal_Description, Twn, Sect, Rng, Acres_Deeded, GIS_Acres, Subdivision, County_ID. Verified GENUINELY statewide by five point probes spread across Nebraska, each returning a real parcel with a DISTINCT county: Omaha 41.2565/-95.9345 → County_ID 055 (Douglas), Scottsbluff 41.8666/-103.6672 in the far western panhandle → 157 (Scotts Bluff), Norfolk 42.0286/-97.4170 in the north → 119 (Madison), McCook 40.2019/-100.6254 in the southwest → 145 (Red Willow), Lincoln 40.8136/-96.7026 → 109 (Lancaster). A whole-layer `returnExtentOnly` request timed out at 12s (this layer is slow at that specific op — see NEW-3's timing-budget note), so the five-point spread is the coverage evidence on record rather than a converted layer extent." },
  NV: { name: "Nevada", assessingUnit: "county", sources: [], alreadyWired: true,
    noSource: "The NV DCNR / State Demographer mosaic is legally restricted under NRS 250 from being downloaded, exported, or shared with the public or another government agency — disqualified on a legal basis, independent of reachability. A SEPARATE service, published by the Nevada Division of Water Resources (arcgis.water.nv.gov — a distinct agency from DCNR, not represented as a `sources` entry here), is what's actually wired as nv_statewide in counties.js. Not re-probed here: that host is blocked in this sandbox (as expected); see docs/STATEWIDE-PARCELS.md's Nevada row for its live-verified status, and counties.js's own nv_statewide comment for the 2026-09-11 service-rename incident (B1455632)." },
  NH: { name: "New Hampshire", wired: true, verify: "live", blocker: "nhgeodata.unh.edu", assessingUnit: "town/municipal (RSA 76; NH DRA provides oversight/equalization only)",
    sources: [{ name: "NH Parcel Mosaic — layer 1 'Parcels' (NH GRANIT / UNH)", url: "https://nhgeodata.unh.edu/nhgeodata/rest/services/CAD/ParcelMosaic/MapServer/1", cite: "measured live in the owner's own browser, 2026-09-08 — not this sandbox" }],
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — nhgeodata.unh.edu is blocked here. ⛔ Layer 1 ('Parcels', polygon) — NOT layer 0 ('Parcel Points', POINT geometry, unusable for the app's polygon click routing). 20 fields: PID, Town, StreetAddress, DisplayId, CountyId, SLU. No owner, no value." },
  NJ: { name: "New Jersey", wired: true, verify: "live", blocker: "maps.nj.gov", assessingUnit: "municipal (each municipality has its own Tax Assessor)",
    sources: [{ name: "Parcels and MOD-IV Composite of New Jersey (NJOGIS + NJ Treasury MOD-IV)", url: "https://maps.nj.gov/arcgis/rest/services/Framework/Cadastral/MapServer/0", cite: "arcgis.com item 852937c223e94fcf8e167a23b500935d" }],
    note: "Full schema confirmed via item metadata XML (id/owner/situs/area/value all present in the field list) — but owner-name values are reported REDACTED for many records under NJ's Daniel's Law privacy statute, so the field exists without always carrying data. maps.nj.gov blocked in this sandbox." },
  NM: { name: "New Mexico", assessingUnit: "county", sources: [],
    noSource: "NM Taxation & Revenue Dept. explicitly disclaims distributing parcel data ('contact the assessor's office'); a same-named layer under the Office of the State Engineer is unverified and not listed in OSE's own public catalog. No confirmed statewide source." },
  NY: { name: "New York", wired: true, assessingUnit: "town/municipal (city/town assessors; NYS ORPTS provides oversight/certification)",
    sources: [{ name: "NYS Tax Parcels Public — official ArcGIS Online mirror (NYS ITS Geospatial Services + Dept. of Taxation & Finance ORPTS, org account NYSGIS_GPO)", url: "https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/arcgis/rest/services/NYS_Tax_Parcels_Public/FeatureServer/1", cite: "arcgis.com item 8af5cef967f8474a9f262684b8908737" }],
    note: "The publicly-cited host (gisservices.its.ny.gov) is blocked in this sandbox — same as production is expected to reach it — but the SAME dataset is independently reachable via NY's own official ArcGIS Online organizational account (not a third party), so this wires the mirror rather than parking the whole state on an unreachable primary. 3,827,530 parcels, full schema, covers the 38 counties+NYC that opted in (a companion Footprint layer names which)." },
  NC: { name: "North Carolina", wired: true, verify: "live", blocker: "services.nconemap.gov (also confirm the '/secure/' path is not a login wall)", assessingUnit: "county",
    sources: [{ name: "NC OneMap Parcels — NC Integrated Cadastral Data Exchange", url: "https://services.nconemap.gov/secure/rest/services/NC1Map_Parcels/MapServer", cite: "arcgis.com item 943c5690291445c4bb679a7422dd8b93" }],
    note: "Full schema confirmed via item metadata XML (id/owner/situs/area/value all present), all 100 counties + Eastern Band of Cherokee. The URL's own '/secure/' path segment is ambiguous — the item's `access` field reads public, but this needs a live check to rule out a login wall before relying on it. services.nconemap.gov blocked in this sandbox." },
  ND: { name: "North Dakota", wired: true, assessingUnit: "county",
    sources: [{ name: "ND State Parcel Program (NDIT, aggregated by AppGeo from 51+ counties)", url: "https://services1.arcgis.com/GOcSXpzwBHyk2nog/arcgis/rest/services/NDGISHUB_Parcels/FeatureServer/0", cite: "gishubdata-ndgov.hub.arcgis.com/datasets/NDGOV::parcels" }],
    note: "id + acreage present on this layer; owner/situs/value live on a separate joinable TaxRoll table (layer 1), not wired here — same attribute-light shape as Utah/Delaware." },
  OH: { name: "Ohio", wired: true, assessingUnit: "county (elected County Auditor)",
    sources: [{ name: "Ohio Statewide Parcels — public view (OGRIP)", url: "https://services2.arcgis.com/MlJ0G8iWUyC7jAmu/arcgis/rest/services/OhioStatewidePacels_full_view/FeatureServer/0", cite: "ohioparcels-geohio.hub.arcgis.com/datasets/geohio::parcels-1" }],
    note: "6.3M parcels; owner name and appraised value are deliberately absent from this privacy-scrubbed public view (a MailAddressAll field is present as a proxy)." },
  OK: { name: "Oklahoma", assessingUnit: "county", sources: [],
    noSource: "A real statewide mosaic exists (Property Records Preservation LLC for the OK Office of Geographic Information) but is explicitly published as view/WMS-only with no downloadable or queryable REST FeatureServer/MapServer found on any reachable host." },
  OR: { name: "Oregon", assessingUnit: "county (ORMAP is the state's own cooperative cadastral base-map program)", sources: [],
    noSource: "The Tax Lot layer the state's own 'Oregon Parcel Viewer' web app points to returns a real HTTP 400 'Invalid URL' — the service has been retired/unpublished, a genuine dead reference rather than a sandbox block. Every other candidate host (gis.odf.oregon.gov, ormap.net, data.oregon.gov) is blocked. Needs a fresh live search, not just a re-probe of this URL." },
  PA: { name: "Pennsylvania", assessingUnit: "county (67 autonomous assessing authorities)", sources: [],
    noSource: "RETRACTED, corrected 2026-09-08 from the owner's own browser (not this sandbox): PASDA's service directory carries 170 services and EXACTLY ONE parcel service, ErieCountyParcels — county-only. There is no statewide PA parcel mosaic on PASDA. This replaces the prior 'high-confidence follow-up candidate' framing, which is now a confirmed no." },
  RI: { name: "Rhode Island", wired: true, verify: "live", blocker: "risegis.ri.gov", assessingUnit: "town/municipal — RI abolished county government in 1842; 39 towns/cities each run their own independent Tax Assessor",
    sources: [{ name: "Tax Parcels (RIGIS — the RI state GIS clearinghouse, org RIGIS_ADMIN / RIDEM Map Room)", url: "https://risegis.ri.gov/hosting/rest/services/RIDEM/Tax_Parcels/MapServer/0", cite: "arcgis.com item 9d73d1a7615b4c09a7b8e019ed37d77d — measured live in the owner's own browser, 2026-09-08", pass: "agol" }],
    // ⛔ RETRACTED OUTRIGHT, 2026-09-08 (NEW-1), not softened. This row previously read
    // `no-free-source` / `Candidate: none found`, with the note: "RIGIS publishes parcel-data
    // STANDARDS and a per-town completion tracker, not a merged statewide layer. No aggregation
    // found." The merged statewide layer exists and is published by RIGIS itself.
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — risegis.ri.gov is a state .gov host this environment's egress allowlist blocks (the CONNECT tunnel never opens). 'Tax Parcels', polygon, 394,167 parcels, published by RIGIS_ADMIN — the state clearinghouse ITSELF, not a town and not a third-party rehost. Fields: PlatLot (RI's own parcel identifier — with no counties since 1842, each of the 39 towns keys parcels by plat + lot), Acres, E911 and E911_Type (address), TownCode, IMP_sqft, Last_UPD. NO owner, NO appraised value — the same attribute-light standing already given to Hawaii, New Hampshire and Virginia. ⛔ FOUND BY THE AGOL PASS (NEW-2): the item is discoverable on ArcGIS Online (searchable from this sandbox) even though the service it points at is not reachable from here." },
  SC: { name: "South Carolina", assessingUnit: "county (46 counties, elected/appointed Assessor)", sources: [],
    noSource: "The only statewide DNR/RFA service found (SC_County_Parcel_Viewers) is a lookup TABLE of links to each county's own separate viewer, not aggregated geometry; RFA's own page describes its aggregated parcels as available only via 'secure' (non-public) REST services." },
  SD: { name: "South Dakota", assessingUnit: "county", sources: [],
    noSource: "No credible statewide aggregation found; a same-named 'SD_Parcels' service turned out to be a flood substantial-damage-assessment layer (SD = Substantial Damage), a false positive ruled out by inspecting its schema. Individual counties run independent systems." },
  TN: { name: "Tennessee", wired: true, assessingUnit: "county (elected County Assessor; Comptroller's Division of Property Assessments provides oversight)",
    sources: [{ name: "Tennessee Property Boundaries Public Use (TN Comptroller, Base Mapping Program)", url: "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0", cite: "arcgis.com item e356f1a241844d6f9025f2fa4e977df3" }],
    note: "2,141,289 parcels, id/owner/situs/area present; appraised value requires a join to a separate tax table (LINK_TPAD/LINK_TPV) not included here. Covers 86 of 95 counties — 9 use non-state assessment systems and are excluded." },
  TX: { name: "Texas", assessingUnit: "appraisal district (a separate legal entity per county under the TX Property Tax Code — not a county government department)",
    sources: [], alreadyWired: true,
    note: "Already wired (txgio_statewide) — TxGIO / StratMap Land Parcels, confirmed still healthy this session (HTTP 200, full field set)." },
  UT: { name: "Utah", wired: true, assessingUnit: "county (29 counties)",
    sources: [{ name: "Utah Statewide Parcels (UGRC/AGRC)", url: "https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0", cite: "gis.utah.gov/products/sgid/cadastre/parcels" }],
    note: "Attribute-light by design: id + situs address present; owner/value require the per-county CAMA system (a CoParcel_URL field links out) and are absent from this layer." },
  VT: { name: "Vermont", wired: true, assessingUnit: "town (247 towns; VT counties have no assessing role)",
    sources: [{ name: "VT Parcel Program (Vermont Center for Geographic Information, joined to the Dept. of Taxes Grand List)", url: "https://services.arcgis.com/XG15cJAlne2vxtgt/ArcGIS/rest/services/VT_Parcel/FeatureServer/665", cite: "arcgis.com item 1c12a80bb16249ae9235525e3525c89f" }],
    note: "One of the richest schemas of the whole probe (full id/owner/situs/area/value), all 247 towns, 339,251 parcels. Layer id is non-standard (665, not 0) — confirmed, not a typo." },
  VA: { name: "Virginia", wired: true, verify: "live", blocker: "vginmaps.vdem.virginia.gov", assessingUnit: "county/independent city (98 counties + 39 independent cities, each its own assessing jurisdiction)",
    sources: [{ name: "Virginia Parcels (VDEM, VA_Base_Layers)", url: "https://vginmaps.vdem.virginia.gov/arcgis/rest/services/VA_Base_Layers/VA_Parcels/FeatureServer/0", cite: "measured live in the owner's own browser, 2026-09-08 — not this sandbox" }],
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — vginmaps.vdem.virginia.gov is blocked here. B1345824 round 1 declined this state on 'the only reachable copy is a third-party rehost' — WRONG: that reading traced to this sandbox never being able to reach VGIN's own host at all, not to the official host being unreachable from a real browser. This IS VGIN's own official host. 'Virginia Parcels', polygon, 9 fields: PARCELID, VGIN_QPID, FIPS, LOCALITY, LASTUPDATE, PTM_ID, OBJECTID, Shape__Area, Shape__Length. Attribute-light by design — no owner, no value, no acreage field (only Shape__Area) — the same standing this repo already gives Hawaii's and New Hampshire's thin schemas; wired anyway on that precedent." },
  WA: { name: "Washington", assessingUnit: "county (39 counties)", sources: [],
    noSource: "A real, reachable statewide mosaic exists ('Current Parcels', geo.wa.gov) with decent fields, but its own license text states some counties restrict use of their parcels to 'State of Washington business only' — an explicit use restriction, not just a liability disclaimer, that this app's commercial real-estate use may not clear. Flagged for an owner/legal decision rather than wired silently." },
  WV: { name: "West Virginia", wired: true, verify: "live", blocker: "services.wvgis.wvu.edu", assessingUnit: "county (55 counties)",
    sources: [{ name: "WVParcels (WV GIS Technical Center)", url: "https://services.wvgis.wvu.edu/arcgis/rest/services/Planning_Cadastre/WV_Parcels/MapServer/0", cite: "measured live in the owner's own browser, 2026-09-08 — not this sandbox" }],
    note: "MEASURED LIVE FROM THE OWNER'S OWN BROWSER (2026-09-08), not this sandbox — services.wvgis.wvu.edu is blocked here. B1345824 round 1 declined this state on 'the only reachable copy is a third-party rehost under a named individual's personal account' — WRONG, same mistake as Virginia: this sandbox never reached the WV GIS Technical Center's own host at all. 'WVParcels', polygon, 21 fields: CleanParcelID, FullOwnerName, OWNER1, OWNER2, FullPhysicalAddress, CALC_ACRE, COUNTY, Map, Parcel, Dist, CountyID. No appraised-value field — left absent, never zero or blank. ⛔ Layer 0 is the parcels; sibling layers on the same service are 1 (Districts) and 5 (Site Address Points)." },
  WI: { name: "Wisconsin", wired: true, assessingUnit: "municipal (town/village/city; a minority of counties use a county-assessor system)",
    sources: [{ name: "Wisconsin Statewide Parcels DB V12 (State Cartographer's Office / DOA Land Information Program)", url: "https://services3.arcgis.com/n6uYoouQZW75n5WI/arcgis/rest/services/Wisconsin_Statewide_Parcels_DB/FeatureServer/0", cite: "arcgis.com item 2386813b23ea4e51a009f7d1d6b76e02" }],
    note: "Fullest field set of the whole probe (id/owner/situs/three acreage measures/five value fields), 3,574,646 parcels, hosted by the official WI DOA account, explicitly 'free for public consumption.'" },
  WY: { name: "Wyoming", wired: true, assessingUnit: "county (23 counties)",
    sources: [{ name: "Wyoming Parcels for 2026 (WY Dept. of Revenue Property Tax Division)", url: "https://services3.arcgis.com/r0iJ85SKZ4zAzz3P/arcgis/rest/services/Wyoming_Parcels_for_2026/FeatureServer/0", cite: "arcgis.com org wyo-prop-div" }],
    note: "Full schema, 373,666 parcels, hosted directly by the state Property Tax Division's own org, annually updated." },
};
delete CANDIDATES.AZ_UNUSED;

/* ---------------------------------------------------------------------------------------------
 * Measurement engine
 * -------------------------------------------------------------------------------------------- */
export async function fetchJson(url, { timeout = TIMEOUT_MS } = {}) {
  // B1461731 — a host with an OPEN breaker (repeated failures or repeated slow responses — see
  // hostThrottle.mjs / sourceHealth.js) is skipped outright rather than retried into: the exact
  // response to Nevada's window (one 18s error, then the host going fully unresponsive). This
  // never issues the request, so it costs nothing and doesn't restart the host's own cooldown.
  if (isHostOpen(url)) {
    return { ok: false, status: 0, ms: 0, error: `host breaker open, cooling off ${Math.ceil(hostCooldownMs(url) / 1000)}s — ${hostnameOf(url)}`, breakerOpen: true };
  }
  await waitForHostSlot(url); // a floor on spacing between requests to the SAME host
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  const started = Date.now();
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const ms = Date.now() - started;
    // Host-level health is about the TRANSPORT (did the host answer, and how fast) — an ArcGIS
    // error body or an HTTP error status still means the host responded, so those are a SOURCE
    // problem (handled by probeSource/walkForReplacement reading the body) and not counted against
    // the host itself here. A response landing at/after the timeout counts as slow either way.
    recordHostOutcome(url, true, ms);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* non-JSON response */ }
    /* Owner correction, 2026-09-08: `blocked` was previously computed ONLY in the `catch` branch
     * below, on the theory that a CONNECT-tunnel policy denial always surfaces as a thrown network
     * error. Measured directly against this proxy (curl -D- on a known-blocked host): the CONNECT
     * tunnel itself fails ("CONNECT tunnel failed, response 403"), but Node's fetch() does NOT
     * throw for it — it resolves normally with `res.status === 403` and a short, non-JSON,
     * `text/plain` body (68 bytes, no ArcGIS error envelope), landing here in the non-throwing
     * branch. So `blocked` was NEVER set true for the dominant case in this environment, and every
     * blocked-.gov row fell through to the generic `host-error` verdict instead of the doc's own
     * documented `blocked-in-sandbox` one — the exact contradiction the doc's header warned readers
     * NOT to make (host-error reading as "something is wrong with this GIS host" when the truth is
     * "this sandbox's own policy never let the request through"). A bare 403 is still a best-effort
     * read, not a certainty (a real target could in principle also answer 403), so this only fires
     * when the body ALSO failed to parse as JSON — an ArcGIS REST error response is JSON, so a
     * genuine target-side 403 would still show `json` non-null and stay classified as `host-error`. */
    const blocked = res.status === 403 && json === null;
    return { ok: res.ok, status: res.status, ms, json, blocked };
  } catch (err) {
    const ms = Date.now() - started;
    recordHostOutcome(url, false, ms); // a thrown fetch (timeout, network, or a blocked tunnel) is a genuine host-level miss
    const msg = String((err && err.message) || err);
    // A CONNECT-tunnel policy denial surfaces as a generic fetch failure with no HTTP status at
    // all (the TLS tunnel itself never opened) — distinct from a real host timeout/DNS failure,
    // but this Node fetch error shape can't always tell them apart, so `blocked` is a best-effort
    // read, not a certainty; the doc always shows the raw error text too.
    const blocked = /fetch failed|ECONNREFUSED|ENOTFOUND|CONNECT/i.test(msg);
    return { ok: false, status: 0, ms, error: msg, blocked };
  } finally {
    clearTimeout(timer);
  }
}

// Field-name heuristics, reported as WHICH field matched — never a claim about what the field
// means. Mirrors the app's own idField/addrField "hint, not authority" convention (counties.js).
const FIELD_PATTERNS = {
  /* NEW-2 correction, 2026-09-08: `PARCEL_APN` (California) and `PlatLot` (Rhode Island) both
   * read as `parcelId=absent` in this doc while plainly BEING the parcel identifier — `\bapn\b`
   * cannot match inside `PARCEL_APN` because an underscore is a word character, so there is no
   * word boundary before "APN". A doc that reports a real id column as absent understates a
   * source and is exactly the kind of quiet wrong number this repo keeps closing; the app's own
   * live field auto-detect was never affected (these are reporting hints, not authority).
   * B1551616 correction, 2026-09-11: `_apn(?:_|$)` only caught APN AFTER an underscore
   * ("PARCEL_APN"), not BEFORE one — `APN_CHR` (a real field on a Macomb County MI candidate)
   * read the same false "absent". `(?:^|_)apn(?:_|$)` is a strict superset of the old clause
   * (identical on `_apn$`/`_apn_`, plus now `^apn_`/`^apn$`) — it can only ADD matches. */
  parcelId: /parcel.?id|parcel.?apn|\bapn\b|(?:^|_)apn(?:_|$)|platlot|(?:^|_)pin(?:_|$)|prop.?id|acctid|account|parcelnb|parcelnum|gispid|statepar|stateid|(?:^|_)pid(?:_|$)/i,
  owner: /owner/i,
  situsAddress: /situs|site.?add|prop.?add|premisead|full.?address|prop_loc/i,
  landArea: /acre|sqfoot|lot_size|land.?area/i,
  // requires a VALUE-shaped suffix alongside the assess/apprais/market word — a bare "assess"
  // (e.g. "AssessmentCode", a classification, not a dollar figure) must not match.
  appraisedValue: /(assess|apprais|market|mkt|total|land).{0,6}val|actualvalu|assessedva/i,
};

export function matchFields(fieldNames) {
  const out = {};
  for (const [key, re] of Object.entries(FIELD_PATTERNS)) {
    out[key] = fieldNames.find((f) => re.test(f)) || null;
  }
  return out;
}

export async function probeSource(src, abbr) {
  const meta = await fetchJson(`${src.url}?f=json`);
  if (!meta.ok || !meta.json) {
    return { ...src, reachable: false, blocked: !!meta.blocked, status: meta.status, ms: meta.ms, error: meta.error };
  }
  // B1461729 — ArcGIS answers a dead/misconfigured layer with HTTP 200 and a JSON `{error:{…}}`
  // body (measured live against Nevada's emptied service, 2026-09-10: HTTP 200, `{"error":
  // {"code":400,"message":"Failed to execute query."}}`, zero features). A check reading the HTTP
  // status alone — `meta.ok` — calls that healthy; this is exactly what recorded Nevada as
  // reachable while it was already failing. `meta.ok` only proves the TRANSPORT succeeded, never
  // that the SERVICE answered the question, so the body is checked before anything downstream
  // (field list, extent, count, envelope) is trusted — none of it means anything against an error
  // response, and probing further would just manufacture a plausible-looking empty result.
  if (meta.json.error) {
    const code = meta.json.error.code != null ? ` (code ${meta.json.error.code})` : "";
    return { ...src, reachable: false, arcgisError: true, status: meta.status, ms: meta.ms, error: `${meta.json.error.message || "ArcGIS error"}${code}` };
  }
  const fieldNames = Array.isArray(meta.json.fields) ? meta.json.fields.map((f) => f.name) : [];
  const geometryType = meta.json.geometryType || (meta.json.type === "Table" ? "table" : null);
  let featureCount = null;
  const countRes = await fetchJson(`${src.url}/query?where=1%3D1&returnCountOnly=true&f=json`);
  // Same body check as the metadata call above, against the actual QUERY endpoint this time — a
  // layer can describe itself fine (the metadata call above succeeds) while its own /query 400s,
  // which is at least as disqualifying as an unreachable metadata call: nothing that draws or
  // clicks a parcel goes through metadata alone. Short-circuits like the metadata check, for the
  // same reason — a source whose basic count query is broken has nothing left worth measuring.
  if (countRes.json && countRes.json.error) {
    const code = countRes.json.error.code != null ? ` (code ${countRes.json.error.code})` : "";
    return { ...src, reachable: false, arcgisError: true, status: meta.status, ms: meta.ms, geometryType, fieldNames, fields: matchFields(fieldNames), error: `${countRes.json.error.message || "ArcGIS error"}${code}` };
  }
  if (countRes.ok && countRes.json && typeof countRes.json.count === "number") featureCount = countRes.json.count;
  const extentLatLon = await projectExtentToWgs84(meta.json.extent, { fetchJson });
  const coverage = extentCoverageCheck(extentLatLon, abbr);
  const probePoint = STATE_PROBE_POINT[abbr];
  const centroid = !extentLatLon.failed ? [(extentLatLon.ymin + extentLatLon.ymax) / 2, (extentLatLon.xmin + extentLatLon.xmax) / 2] : null;
  const [pLat, pLng] = probePoint || centroid || [];
  const envelopeTimingRaw = await probeEnvelopeTiming(src.url, pLat, pLng, { fetchJson });
  // NEW-3, second half of the Tennessee finding: an empty answer at a point the layer's OWN
  // extent claims to reach is a defect independent of timing — Tennessee measured both a slow AND
  // (separately, on other runs) a fast-but-empty answer at Nashville, which its own extent covers.
  const insideExtent = pointInsideExtent(pLat, pLng, extentLatLon);
  const emptyDespiteCoverage = envelopeTimingRaw.featureCountInEnvelope === 0 && insideExtent === true;
  const envelopeTiming = { ...envelopeTimingRaw, insideExtent, emptyDespiteCoverage };
  return {
    ...src,
    reachable: true,
    status: meta.status,
    ms: meta.ms,
    geometryType,
    featureCount,
    fieldNames,
    fields: matchFields(fieldNames),
    extentLatLon,
    coverage,
    envelopeTiming,
  };
}

/* ---------------------------------------------------------------------------------------------
 * NEW-2 — THE SECOND RESOLUTION PASS: official state ArcGIS Online organizations.
 *
 * Pass 1 (everything above) resolves a state's candidate from that STATE'S OWN `.gov` GIS host.
 * This environment reaches `*.arcgis.com` and cannot reach most state `.gov` domains, so pass 1 is
 * structurally blind to any state that publishes the same dataset to its own ArcGIS Online
 * ORGANIZATIONAL ACCOUNT — and several do. New York was rescued by exactly that route and it was
 * recorded as a one-off workaround for one state rather than as a method. A hand-run of this pass
 * over 13 `no-free-source` states returned two real, live, official statewide layers (California,
 * Rhode Island), both of which this file had on record as `Candidate: none found`.
 *
 * THE SHAPE, and every step of it is a measurement rather than an inference:
 *   1. search ArcGIS Online for parcel-shaped public Feature/Map Services naming the state;
 *   2. drop items whose TITLE names a known false lead (a leases register, state-TRUST land, a
 *      substantial-damage layer) — cheap triage, not the verdict;
 *   3. resolve each surviving item's ORGANIZATION and classify the publisher into three tiers
 *      (official / review / excluded — see lib/agolParcelSearch.mjs for why the middle tier is
 *      the whole point, and why a two-way filter silently discards real state sources);
 *   4. MEASURE what survives — geometry type, field list, feature count — because a layer id is a
 *      guess (Hawaii's statewide mosaic is layer 25; New Hampshire's polygons are layer 1) and
 *      because a parcel-shaped title is not a parcel layer (Oregon's "State Parcels" resolves to
 *      146 POINTS of facility leases).
 *
 * ⛔ IT REFUSES TO PRINT A SCORE IF ITS OWN KNOWN-GOOD ARMS FAIL. A search-and-filter pipeline
 * tightened one notch too far returns a clean, confident ZERO for every state, and nothing
 * downstream can tell that apart from a world with nothing in it. `assessKnownGood` is checked
 * FIRST, every run.
 * -------------------------------------------------------------------------------------------- */

/* A statewide parcel layer is big. Below this, a "statewide" candidate is almost always one town,
 * one county, or a sample — reported, never silently dropped. The floor is set beneath the
 * smallest real statewide source on record (Vermont, 339,251) with room to spare. */
const STATEWIDE_COUNT_FLOOR = 100_000;

const PARCELISH_FIELD = /parcel|\bapn\b|platlot|\bpin\b|taxlot|tms|gispid|acct/i;

/* Measure one shortlisted AGOL candidate and say plainly what it is. Never a verdict on its own —
 * the caller reports every measured candidate, and a human decides what gets wired. */
async function measureAgolCandidate(item, layerId = 0) {
  const url = serviceLayerUrl(item, layerId);
  if (!url) return { url: null, measured: false, why: "item carries no Feature/Map Service URL" };
  const meta = await fetchJson(`${url}?f=json`);
  if (!meta.ok || !meta.json)
    return { url, measured: false, blocked: !!meta.blocked, status: meta.status, why: meta.blocked ? "host blocked by this sandbox's egress policy" : `no JSON (${meta.status})` };
  const fieldNames = Array.isArray(meta.json.fields) ? meta.json.fields.map((f) => f.name) : [];
  const geometryType = meta.json.geometryType || (meta.json.type === "Table" ? "table" : null);
  let featureCount = null;
  const c = await fetchJson(`${url}/query?where=1%3D1&returnCountOnly=true&f=json`);
  if (c.ok && c.json && typeof c.json.count === "number") featureCount = c.json.count;
  const polygon = geometryType === "esriGeometryPolygon";
  const parcelish = fieldNames.some((f) => PARCELISH_FIELD.test(f));
  const bigEnough = featureCount != null && featureCount >= STATEWIDE_COUNT_FLOOR;
  return {
    url, measured: true, geometryType, featureCount, fieldNames, fields: matchFields(fieldNames),
    polygon, parcelish, bigEnough,
    // "plausible" is a SHORTLISTING verdict, never a wiring decision: it says this is worth a
    // human's five minutes, not that it is correct. Each failing property is named so the reason
    // survives into the doc (a POINT layer and a 146-feature layer are very different findings).
    plausible: polygon && parcelish && bigEnough,
  };
}

/* Run the AGOL pass for one state. Returns every candidate it looked at, with its tier and — for
 * anything that survived triage — its measurement. Nothing is discarded silently. */
async function agolPassForState(abbr, cfg, orgName, { maxProbe = 6 } = {}) {
  const stateName = cfg.name;
  const raw = await searchState(stateName, { fetchJson });
  const looked = [];
  let probed = 0;
  for (const item of raw) {
    if (!looksParcelShaped(item)) continue;
    /* The org lives on the ITEM DETAIL, not reliably on the search hit — measured 2026-09-08:
     * the search result for Rhode Island's own RIGIS_ADMIN item carries `orgId: null`, so
     * classifying off search results alone would have left the state's own publisher unresolved. */
    let orgId = item.orgId || "";
    if (!orgId) {
      const det = await fetchJson(`https://www.arcgis.com/sharing/rest/content/items/${item.id}?f=json`);
      orgId = (det.json && det.json.orgId) || "";
      if (det.json && det.json.url && !item.url) item.url = det.json.url;
    }
    const org = await orgName(orgId);
    const cls = classifyPublisher({ owner: item.owner, orgName: org, orgId, title: item.title, stateName, stateAbbr: abbr });
    const row = { id: item.id, title: item.title, owner: item.owner, orgId, orgName: org, url: item.url, foundBy: item.foundBy, ...cls };
    // Only OFFICIAL and REVIEW candidates are worth the two requests to measure; `excluded` is a
    // positive finding (a vendor, a county) and is recorded with its reason, unmeasured.
    if (cls.tier !== "excluded" && probed < maxProbe) { row.measure = await measureAgolCandidate(item); probed++; }
    looked.push(row);
  }
  return looked;
}

async function runAgolPass(results) {
  const orgName = makeOrgResolver({ fetchJson });
  const out = {};
  for (const [abbr, cfg] of Object.entries(CANDIDATES)) {
    out[abbr] = await agolPassForState(abbr, cfg, orgName);
    const hits = out[abbr].filter((r) => r.tier === "official" && r.measure && r.measure.plausible);
    const rev = out[abbr].filter((r) => r.tier === "review" && r.measure && r.measure.plausible);
    const wired = results[abbr] && (results[abbr].wired || results[abbr].alreadyWired);
    const flag = hits.length && !wired ? "  ⚑ NEW OFFICIAL HIT, STATE NOT WIRED" : "";
    console.error(`[agol] ${abbr} — ${out[abbr].length} looked at · ${hits.length} official+plausible · ${rev.length} review+plausible${flag}`);
  }
  return out;
}

export function verdictFor(state) {
  if (state.alreadyWired) return "already-wired";
  // Owner correction, 2026-09-08 (round 2): a real, findable, sometimes fully-measured source
  // that is declined on SHAPE (needs a join, or ships as more than one service) is not the same
  // finding as "nothing exists" — the first Mississippi pass proved this the hard way, landing on
  // `no-free-source` + `Candidate: none found` despite the note recording a real 55-field schema
  // measured live. `shapeMismatch` is checked before the empty-sources fallback so a state that
  // GENUINELY has nothing (sources: [] and no real candidate on record) still reads no-free-source.
  if (state.shapeMismatch) return "shape-mismatch";
  if (!state.sources.length) return "no-free-source";
  const any = state.sources.some((s) => s.reachable);
  if (any) return "measured-reachable";
  // B1461729 — HTTP 200 with an ArcGIS `{error}` body is neither "blocked" (the transport worked)
  // nor a bare "host-error" (something answered, and it named a real problem) — a source whose
  // service root or layer index itself reports an ArcGIS error gets its own verdict so a reader
  // (or a future neighbour-walk pass, B1461730) can tell "the endpoint moved/broke" apart from
  // "this sandbox can't reach the host at all."
  if (state.sources.some((s) => s.arcgisError)) return "arcgis-error";
  const allBlocked = state.sources.every((s) => s.blocked);
  return allBlocked ? "blocked-in-sandbox" : "host-error";
}

async function probeAll() {
  const out = {};
  for (const [abbr, cfg] of Object.entries(CANDIDATES)) {
    const sources = [];
    for (const src of cfg.sources || []) {
      const probed = await probeSource(src, abbr);
      sources.push(probed);
      // NEW-1/NEW-2 — loud, live, as the probe runs (an 8-second-budget timing check per state
      // costs real wall-clock; don't make the operator wait for the whole run to see a hit).
      if (probed.reachable) {
        if (probed.coverage && probed.coverage.insufficient) {
          const pct = (f) => (f == null ? "?" : `${Math.round(f * 100)}%`);
          console.error(`⛔ [coverage] ${abbr} — extent covers only lat ${pct(probed.coverage.latFrac)} / lon ${pct(probed.coverage.lonFrac)} of the state — ${src.url}`);
        }
        if (probed.envelopeTiming && probed.envelopeTiming.overBudget) {
          console.error(`⛔ [timing] ${abbr} — envelope query took ${probed.envelopeTiming.ms}ms, over the ${ENVELOPE_QUERY_BUDGET_MS}ms budget — ${src.url}`);
        }
        if (probed.envelopeTiming && probed.envelopeTiming.emptyDespiteCoverage) {
          console.error(`⛔ [empty] ${abbr} — a point inside this layer's OWN declared extent returned zero features (${probed.envelopeTiming.ms}ms) — ${src.url}`);
        }
      } else if (probed.arcgisError) {
        console.error(`⛔ [arcgis-error] ${abbr} — HTTP ${probed.status ?? "200"} with an ArcGIS error body: ${probed.error} — ${src.url}`);
      }
      // B1461730 — a WIRED source (this run already re-verifying it, not merely a discovery
      // candidate) that has genuinely gone missing gets its own server's neighbours walked, so the
      // report names a replacement candidate instead of only "this source failed" — exactly what
      // would have caught the Nevada rename on the same run that found the outage. Skipped for a
      // source this sandbox's own egress policy blocked (`probed.blocked`) — that host answers
      // nothing at all here, so walking its directory would just be more blocked requests.
      if ((cfg.wired || cfg.alreadyWired) && !probed.reachable && !probed.blocked) {
        console.error(`⛔ [missing] ${abbr} — wired source unreachable, walking its own server for a replacement — ${src.url}`);
        const walk = await walkForReplacement({ failedUrl: src.url, knownGood: src.lastKnownGood, fetchJson });
        probed.neighbourWalk = walk;
        if (!walk.ok) {
          console.error(`   → ${walk.reason}`);
        } else {
          const best = walk.results.find((r) => r.matchesKnownGood) || walk.results[0];
          if (best) console.error(`   → candidate: ${best.url} (name similarity ${best.similarity.toFixed(2)}${best.matchesKnownGood != null ? `, ${best.matchesKnownGood ? "CONFIRMED match on count + fields" : "unconfirmed"}` : ""})`);
          else console.error(`   → no plausible candidate found on the same server (${walk.candidatesChecked} checked)`);
        }
      }
    }
    out[abbr] = { abbr, ...cfg, sources };
    out[abbr].verdict = verdictFor(out[abbr]);
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------
 * Output
 * -------------------------------------------------------------------------------------------- */
function fmtFields(f) {
  if (!f) return "—";
  const parts = [];
  for (const k of ["parcelId", "owner", "situsAddress", "landArea", "appraisedValue"]) {
    parts.push(`${k}=${f[k] ? "`" + f[k] + "`" : "absent"}`);
  }
  return parts.join(", ");
}

/* NEW-2 — the AGOL pass's own section. Reports EVERY official-or-review candidate it measured,
 * including in states already wired (a second, better source is a real finding) and including
 * candidates it could not positively classify — `review` rows exist precisely so a filter cannot
 * silently retire a real state source, which is how California and Rhode Island were lost. */
function agolSection(results, agol, knownGood) {
  const lines = [];
  lines.push("## Pass 2 — official state ArcGIS Online organizations (NEW-2)");
  lines.push("");
  lines.push("> Pass 1 above resolves each state's candidate from that STATE'S OWN `.gov` GIS host. This environment reaches");
  lines.push("> `*.arcgis.com` and cannot reach most state `.gov` domains, so pass 1 is structurally blind to a state that");
  lines.push("> publishes the same dataset to its own ArcGIS Online ORGANIZATIONAL ACCOUNT. New York was rescued by exactly");
  lines.push("> that route and it was filed as a one-off workaround rather than a method; running it properly found");
  lines.push("> **California** (13.1M parcels, CAL FIRE) and **Rhode Island** (394k parcels, RIGIS) — both of which this");
  lines.push("> document previously recorded as `no-free-source` / `Candidate: none found`.");
  lines.push(">");
  lines.push("> Publishers are sorted into THREE tiers, never two. **official** — a verified state organization, or an org whose");
  lines.push("> name both names the state and names a government body. **review** — parcel-shaped, published by somebody this pass");
  lines.push("> cannot positively classify; SURFACED for a human, never dropped. **excluded** — a commercial vendor (Regrid /");
  lines.push("> LandGrid and similar are filtered in every state; the owner has declined paid data) or a positively-identified");
  lines.push("> county, city, school or university. The middle tier is the point: an organization's display NAME is not a reliable");
  lines.push("> signal — New York's is \"ShareGIS NY\" and Rhode Island's \"RIDEM - Map Room\", so a two-way filter DISCARDS two of");
  lines.push("> the three state publishers this repo has verified, and each discard reads downstream as an authoritative \"nothing");
  lines.push("> exists here\".");
  lines.push("");
  if (knownGood && knownGood.vacuous) {
    lines.push("> ### ⛔ THIS RUN IS VACUOUS — NO SCORE IS REPORTED");
    lines.push("> The pass's own known-good arms did not report their known answers, so it measured its own filter rather than the");
    lines.push("> world. Failures:");
    for (const f of knownGood.failures) lines.push(`> - ${f}`);
    lines.push("");
    return lines.join("\n");
  }
  if (!agol) {
    lines.push("_Not run in this pass (`--no-agol`). Re-run `npm run probe:parcels` to refresh it._");
    lines.push("");
    return lines.join("\n");
  }
  lines.push("Known-good arms all reported their known answers, so the counts below are real (see `ui-audit/lib/agolParcelSearch.mjs`).");
  lines.push("");
  lines.push("| State | Tier | Publisher (org) | Item | Measured | Wired already? |");
  lines.push("|---|---|---|---|---|---|");
  let officialNew = 0, reviewNew = 0, unmeasuredLeads = 0;
  const unlinked = [];
  const row = (abbr, r, measured, wired) =>
    `| ${abbr} | ${r.tier} | ${r.owner} (${r.orgName || "org unresolved"}) | ${measured.link || r.title} | ${measured.desc} | ${wired ? "yes" : "**no**"} |`;
  for (const abbr of Object.keys(agol).sort()) {
    const wired = !!(results[abbr] && (results[abbr].wired || results[abbr].alreadyWired));
    for (const r of agol[abbr]) {
      if (r.tier === "excluded") continue;
      const m = r.measure;
      let cell;
      if (!m || !m.measured) {
        // A candidate this pass could not measure is still REPORTED — an unmeasured official
        // publisher in an unwired state is exactly the kind of lead that must not evaporate.
        if (r.tier !== "official" || wired) continue;
        cell = { desc: `not measured — ${(m && m.why) || "no service URL"}` };
        cell.unmeasured = true;
      } else {
        if (!m.plausible) continue; // measured and positively NOT a statewide parcel polygon layer
        cell = { link: `[${r.title}](${m.url})`, desc: `${m.featureCount != null ? m.featureCount.toLocaleString() : "?"} features, ${m.geometryType}` };
      }
      /* ⛔ CROSS-STATE SEARCH NOISE IS BUCKETED, NEVER DROPPED, AND NEVER COUNTED. ArcGIS Online
       * ranks by relevance, not geography, so a search for one state routinely returns another
       * state's (or another country's) layer — measured on the first full run: Florida's cadastral
       * layer answered a Washington search, Canada's parcel mapping answered Maine and DC. Rolling
       * those into the headline count would inflate it with nonsense. But dropping them silently is
       * how a real source disappears: Rhode Island's own layer is titled `Tax_Parcels` and published
       * by "RIDEM - Map Room", and links to its state through neither its title nor its org name. */
      if (r.stateLink === "none") { unlinked.push(row(abbr, r, cell, wired)); continue; }
      /* ⛔ AN UNMEASURED LEAD IS COUNTED SEPARATELY, never folded into the headline. It is a
       * publisher and a title and nothing else — no geometry, no field list, no feature count —
       * so calling it "plausible" would be claiming a measurement that was never taken. */
      if (!wired) { if (cell.unmeasured) unmeasuredLeads++; else if (r.tier === "official") officialNew++; else reviewNew++; }
      lines.push(row(abbr, r, cell, wired));
    }
  }
  lines.push("");
  lines.push(`**${officialNew} official + MEASURED-plausible candidate(s) in states NOT yet wired · ${reviewNew} needing a publisher review · ${unmeasuredLeads} official lead(s) that could not be measured at all.**`);
  lines.push("Each one is a FILED lead, not a wiring decision: a candidate is wired only after its layer id, coverage and");
  lines.push("licence are checked by hand — a layer id is a guess (Hawaii's statewide mosaic is layer 25, New Hampshire's");
  lines.push("polygons are layer 1) and a parcel-shaped title is not a parcel layer (Oregon's \"State Parcels\" resolves to 146");
  lines.push("POINTS of facility leases).");
  lines.push("");
  /* ⛔ A NULL FROM THIS PASS IS A FINDING AND IS RECORDED AS ONE. Several states are on record as
   * declined for reasons that had nothing to do with reachability, and every one of those
   * declines predates this pass — so each rests on the same incomplete `.gov`-only search that
   * lost California and Rhode Island. Printing "pass 2 re-checked it and found nothing" is what
   * stops the next session re-deriving the same null, and what makes it visible if a later run
   * turns one of them green. */
  const RECHECKED = ["MI", "IA", "ID", "OK", "OR", "MO", "GA"];
  lines.push("### States previously declined for NON-reachability reasons — re-checked by pass 2");
  lines.push("");
  lines.push("Every one of these declines predates this pass and therefore rested on the same `.gov`-only search that lost");
  lines.push("California and Rhode Island. Re-checked here so the null is on the record rather than re-derived next time.");
  lines.push("");
  lines.push("| State | Prior reason for the decline | Pass 2 result |");
  lines.push("|---|---|---|");
  for (const abbr of RECHECKED) {
    const rows = agol[abbr] || [];
    const off = rows.filter((r) => r.tier === "official" && r.measure && r.measure.plausible && r.stateLink !== "none").length;
    const rev = rows.filter((r) => r.tier === "review" && r.measure && r.measure.plausible && r.stateLink !== "none").length;
    const verdict = off ? `**${off} official + plausible — LOOK AT THIS**` : rev ? `nothing official; ${rev} review-tier candidate(s) above` : "nothing — decline stands";
    const prior = (results[abbr] && (results[abbr].noSource || results[abbr].note) || "").split(".")[0];
    lines.push(`| ${abbr} | ${prior}. | ${rows.length} looked at · ${verdict} |`);
  }
  lines.push("");
  lines.push("### Unlinked hits — recorded, not counted, not dropped");
  lines.push("");
  lines.push("Candidates a state's search returned that carry NO positive link to that state — neither the publisher's");
  lines.push("organization nor the item's own title names it. Almost always ArcGIS Online relevance noise (it ranks by");
  lines.push("relevance, not geography), so they are kept out of the count above. They are listed rather than discarded");
  lines.push("because the link test is not sound in one direction: Rhode Island's own statewide layer is titled");
  lines.push("`Tax_Parcels` and published by \"RIDEM - Map Room\", and would fail it too.");
  lines.push("");
  if (!unlinked.length) {
    lines.push("_None this run._");
  } else {
    lines.push("| State searched | Tier | Publisher (org) | Item | Measured | Wired already? |");
    lines.push("|---|---|---|---|---|---|");
    for (const u of unlinked) lines.push(u);
  }
  lines.push("");
  return lines.join("\n");
}

function buildMarkdown(results, probedAt, agol = null, knownGood = null) {
  const lines = [];
  lines.push("# STATEWIDE-PARCELS.md — free statewide parcel GIS probe (NEW-1)");
  lines.push("");
  lines.push(`> **Last probed:** ${probedAt} · **Re-run:** \`npm run probe:parcels\` (NEW-2) · script: \`ui-audit/probe-statewide-parcels.mjs\``);
  lines.push(">");
  lines.push("> One row per state + DC, MEASURED by this script hitting each candidate endpoint live — never typed from memory.");
  lines.push("> This build environment sits behind an egress allowlist: `*.arcgis.com` hosts are reachable, most individual state");
  lines.push("> `.gov` domains are not (`blocked-in-sandbox` below means exactly that policy block, not a real outage). A `no-free-source`");
  lines.push("> row is a legitimate, expected finding for most states — record it plainly, never omit it. A `no-free-source` row whose");
  lines.push("> Candidate cell names a real service (rather than reading `none found`) means a real candidate WAS found but was never");
  lines.push("> queried from here — its own per-state note below says why (blocked host + bad third-party-provenance being the usual case).");
  lines.push("> A `shape-mismatch` row is a DIFFERENT finding from `no-free-source` and must never be read as one: a real statewide source");
  lines.push("> exists (sometimes fully measured, live, with a real field list — Mississippi's is the best schema of the whole probe) but its");
  lines.push("> SHAPE doesn't fit this app's single-`layerUrl` wiring — it needs a join to a second table, or ships as more than one service");
  lines.push("> covering different halves of the state. That is an INTEGRATION gap, never a DATA gap; its Candidate cell always names the");
  lines.push("> real service(s), with a real clickable URL when one is on record.");
  lines.push(">");
  lines.push("> **Hawaii, Maryland, Nebraska, New Hampshire, Virginia, West Virginia, Mississippi, Pennsylvania, Kansas and");
  lines.push("> RHODE ISLAND were additionally measured LIVE FROM THE OWNER'S OWN BROWSER on 2026-09-08 — a real, unrestricted network, never this");
  lines.push("> sandbox.** Their per-state notes below say so explicitly; do not read their `blocked-in-sandbox`/`host-error`");
  lines.push("> reachability columns (a property of THIS sandbox's own probe run) as evidence the sandbox itself ever reached them —");
  lines.push("> it did not, and cannot. Virginia and West Virginia were previously declined (B1345824 round 1) on a mistaken reading");
  lines.push("> of this exact blind spot — their official hosts were never actually unreachable, only unreachable FROM HERE.");
  lines.push(">");
  lines.push("> **⛔ CALIFORNIA AND RHODE ISLAND were, until 2026-09-08, recorded here as `no-free-source` with `Candidate: none");
  lines.push("> found`. BOTH FINDINGS WERE FALSE, and they are retracted outright rather than softened** — see their per-state");
  lines.push("> notes. California's claimed \"only a static 2014 file-geodatabase, 51 of 58 counties, not a live REST service\" was");
  lines.push("> wrong in every operative clause (a live, public, official 13,138,000-parcel Feature Service exists, and was");
  lines.push("> reachable FROM THIS SANDBOX the whole time); Rhode Island's claimed \"RIGIS publishes standards and a per-town");
  lines.push("> tracker, not a merged statewide layer\" was wrong too (the merged layer exists and RIGIS itself publishes it).");
  lines.push("> Both were found by **pass 2** below — searching states' own official ArcGIS Online ORGANIZATIONS rather than only");
  lines.push("> their `.gov` GIS hosts. The `Found by` column records which pass produced every candidate in the table.");
  lines.push("");
  lines.push("> **NEW-1/NEW-2 (2026-09-09) — the `Extent covers state?` and `Envelope query (≤8s)` columns are the first real");
  lines.push("> SPATIAL checks this probe runs, not just metadata.** Nebraska's `ne_statewide` had a real capabilities list and a");
  lines.push("> real field set — every check a prior pass ran — while its layer extent covered the Omaha metro plus two Iowa");
  lines.push("> counties, not Nebraska; a query at Omaha's own coordinates returned zero. `Extent covers state?` projects each");
  lines.push("> reachable layer's own declared extent to lat/lon (via Esri's public Geometry Service — one extra request, no");
  lines.push("> guessed reprojection math) and reports what fraction of the claimed state's own lat/lon span it reaches, flagged");
  lines.push("> ⛔ below a generous floor. `Envelope query (≤8s)` times a real ~7-mile envelope-intersect/attributes-only query —");
  lines.push("> the shape the app's own viewport draw runs — against the SAME 8-second budget the app's click-lookup path already");
  lines.push("> enforces (`PARCEL_FETCH_TIMEOUT_MS`), flagged ⛔ when a source can't answer inside it (Florida timed out past 32s;");
  lines.push("> Tennessee took 25.5s and returned zero; California — MORE features than Florida — answered in under 2s). A second,");
  lines.push("> INDEPENDENT ⛔ (\"zero at a covered point\") fires whenever a source answers a query centered INSIDE its own declared");
  lines.push("> extent with zero features — Tennessee's own re-runs varied in TIMING (4.2s–25.5s across repeated probes) but were");
  lines.push("> CONSISTENTLY empty at Nashville, which its own extent claims to cover, so timing alone would miss it on a fast day.");
  lines.push("> Both checks are DIAGNOSTIC, not a hard gate: an irregularly-shaped or far-flung state (Alaska, Hawaii, Michigan's two");
  lines.push("> peninsulas) can legitimately read a lower coverage fraction without that being a defect — read the numbers.");
  lines.push("");
  lines.push("| State | Assessing unit | Verdict | Candidate | Found by | Reachable here | Feature count | Geometry | Fields | Extent covers state? | Envelope query (≤8s) | Wired? |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  const wired = [];
  const coverageFlags = [];
  const timingFlags = [];
  for (const abbr of Object.keys(results).sort()) {
    const s = results[abbr];
    const src = s.sources[0];
    const reach = !src ? "—" : src.reachable ? `yes (${src.status}, ${src.ms}ms)` : src.blocked ? "blocked (sandbox policy)" : `no (${src.error || src.status})`;
    const fc = src && src.featureCount != null ? src.featureCount.toLocaleString() : "—";
    const geom = src ? src.geometryType || "—" : "—";
    const fields = src ? fmtFields(src.fields) : "—";
    const pctOf = (f) => (f == null ? "?" : `${Math.round(f * 100)}%`);
    let coverageCol = "—";
    if (src && src.reachable) {
      const c = src.coverage;
      if (c) {
        coverageCol = `${c.insufficient ? "⛔ " : ""}lat ${pctOf(c.latFrac)} · lon ${pctOf(c.lonFrac)} of state`;
        if (c.insufficient && (s.wired || s.alreadyWired)) coverageFlags.push({ abbr, name: s.name, coverageCol, url: src.url });
      } else if (src.extentLatLon && src.extentLatLon.failed) {
        coverageCol = `unmeasured (${src.extentLatLon.why})`;
      } else {
        coverageCol = "no reference bbox";
      }
    }
    let timingCol = "—";
    if (src && src.reachable && src.envelopeTiming && !src.envelopeTiming.skipped) {
      const t = src.envelopeTiming;
      const fcStr = t.featureCountInEnvelope != null ? `, ${t.featureCountInEnvelope} feat.` : "";
      const flagged = t.overBudget || t.emptyDespiteCoverage;
      timingCol = `${flagged ? "⛔ " : ""}${t.ms}ms${fcStr}${t.timedOut ? " (timed out)" : ""}${t.emptyDespiteCoverage ? " — zero at a covered point" : ""}`;
      if (flagged && (s.wired || s.alreadyWired)) timingFlags.push({ abbr, name: s.name, timingCol, url: src.url });
    }
    // Owner correction, 2026-09-08: a row with `sources: []` used to print "none found" even when
    // its own note names a real, specific candidate that simply couldn't be queried from here (a
    // blocked host, a third-party-provenance decline) — a silent contradiction between the cell
    // everyone actually reads and the prose next to it. `unmeasuredCandidate` names that candidate
    // in the cell itself (never a clickable URL — none was confirmed reachable) with why it wasn't
    // queried; `shapeCandidate` (round 2 of the same correction) is its sibling for a candidate that
    // WAS reachable/measured but is declined on SHAPE (a join, or more than one service) — a real
    // URL when one is on record (Mississippi), plain text naming the real services when it isn't
    // (DC, Maine). "Candidate: none found" is reserved for rows where no real candidate exists at all.
    const cand = src ? `[${src.name}](${src.url})` : (s.shapeCandidate || s.unmeasuredCandidate || "none found");
    const isWired = s.alreadyWired || s.wired;
    if (isWired) wired.push(abbr);
    const wireCol = s.alreadyWired ? "✅ (already)" : s.wired ? (s.verify === "live" ? `✅ (Verify: live — ${s.blocker})` : "✅") : "—";
    /* NEW-2 — WHICH PASS FOUND THIS CANDIDATE, so a future reader can tell a `.gov` hit from an
     * ArcGIS-Online-organization hit without re-deriving it. `gov` is the original pass (the
     * state's own GIS host / a web-search research pass); `agol` is the second pass over official
     * state ArcGIS Online organizations, which is the one that found California and Rhode Island
     * after both had been recorded as `Candidate: none found`. */
    const foundBy = src ? (src.pass === "agol" ? "agol" : "gov") : "—";
    lines.push(`| ${s.name} (${abbr}) | ${s.assessingUnit} | ${s.verdict} | ${cand} | ${foundBy} | ${reach} | ${fc} | ${geom} | ${fields} | ${coverageCol} | ${timingCol} | ${wireCol} |`);
  }
  lines.push("");
  lines.push(`**${wired.length} states wired** (incl. TX/CO already live): ${wired.sort().join(", ")}.`);
  lines.push("");
  if (coverageFlags.length || timingFlags.length) {
    lines.push("### ⛔ WIRED SOURCES FLAGGED BY THE NEW-1/NEW-2 SPATIAL CHECKS — look at these before trusting the row above");
    lines.push("");
    if (coverageFlags.length) {
      lines.push("**Extent covers materially less than the claimed state:**");
      for (const f of coverageFlags) lines.push(`- **${f.name} (${f.abbr})** — ${f.coverageCol} — [layer](${f.url})`);
      lines.push("");
    }
    if (timingFlags.length) {
      lines.push(`**Envelope query exceeded the ${ENVELOPE_QUERY_BUDGET_MS}ms budget (the app's own click-lookup hang-guard), or returned zero features at a point inside the layer's own declared extent:**`);
      for (const f of timingFlags) lines.push(`- **${f.name} (${f.abbr})** — ${f.timingCol} — [layer](${f.url})`);
      lines.push("");
    }
  } else {
    lines.push("_No wired source failed either spatial check this run._");
    lines.push("");
  }
  lines.push(agolSection(results, agol, knownGood));
  lines.push("## Per-state notes (research context this probe can't measure itself)");
  lines.push("");
  for (const abbr of Object.keys(results).sort()) {
    const s = results[abbr];
    const note = s.note || s.noSource;
    if (note) lines.push(`- **${s.name} (${abbr}):** ${note}`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  /* ⛔ THE VACUITY CHECK RUNS FIRST, BEFORE ANY NETWORK CALL. If the publisher classifier no
   * longer reports its own known answers, this run cannot distinguish "found nothing" from
   * "filtered everything away", and it must say so instead of printing a score. */
  const knownGood = assessKnownGood();
  if (knownGood.vacuous) {
    console.error("⛔ AGOL pass is VACUOUS — its known-good arms did not report their known answers:");
    for (const f of knownGood.failures) console.error("   " + f);
    console.error("   No AGOL score will be reported. Fix lib/agolParcelSearch.mjs before trusting this run.");
  }
  const results = AGOL_ONLY ? Object.fromEntries(Object.entries(CANDIDATES).map(([k, v]) => [k, { abbr: k, ...v, sources: [] }])) : await probeAll();
  const agol = (NO_AGOL || knownGood.vacuous) ? null : await runAgolPass(results);
  const probedAt = new Date().toISOString().slice(0, 10);
  if (JSON_OUT) {
    console.log(JSON.stringify({ probedAt, knownGood, results, agol }, null, 2));
    return;
  }
  const md = buildMarkdown(results, probedAt, agol, knownGood);
  if (!NO_WRITE) {
    writeFileSync(DOC_PATH, md, "utf8");
    console.log(`Wrote ${DOC_PATH}`);
  } else {
    console.log(md);
  }
  const counts = {};
  for (const s of Object.values(results)) counts[s.verdict] = (counts[s.verdict] || 0) + 1;
  console.log("\nVerdict counts:", counts);
}

// B1461729 — guarded so importing this module's testable pieces (probeSource, verdictFor,
// fetchJson, matchFields — added for unit tests covering the 200-with-ArcGIS-error-body fix)
// never triggers a real 50-state network probe as a side effect. `node
// ui-audit/probe-statewide-parcels.mjs` (the only way this ran before) still executes normally.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
