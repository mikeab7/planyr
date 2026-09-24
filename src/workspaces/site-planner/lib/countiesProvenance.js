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
  /* ═══ NEW-1 (2026-09-23) — 11 more Georgia counties, all re-derived and verified live from THIS
   * sandbox (metadata + a real feature count + an outSR=4326 extent check against Georgia's own
   * bbox — never trusted from a title or field name alone). Full session record, including the 13
   * counties this dispatch named that could NOT be verified and the two wrong-source catches
   * (Walton = Florida, the dispatch's Paulding hint = Ohio), is in
   * docs/STATEWIDE-PARCELS.md's dated 2026-09-23 section. ═══ */
  ga_dekalb: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 245,688 parcel polygons, esriGeometryPolygon, extent -84.35..-84.02 / 33.62..33.97 (matches DeKalb County around Decatur). Published by the county's own GIS org (AGOL owner DeKalbGISAdmin).",
  },
  ga_clarke: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 41,989 parcel polygons, esriGeometryPolygon, extent -83.54..-83.24 / 33.85..34.04 (matches Athens). Published by the Athens-Clarke unified government's own GIS staff account (accgov.com).",
  },
  ga_columbia: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 66,097 parcel polygons, esriGeometryPolygon, extent -82.44..-82.03 / 33.35..33.70 (matches Evans/Martinez, near Augusta). Published by the county's own GIS org (AGOL owner ColumbiaCountyGA_publisher) — a materially better source than the dispatch's own self-hosted URL (mapsonline.columbiacountyga.gov, blocked by this build environment's egress policy).",
  },
  ga_lowndes: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 52,558 parcel polygons, esriGeometryPolygon, extent -83.49..-83.02 / 30.62..31.03 (matches Valdosta). Published under a Southwest Georgia Regional Commission GIS account whose owner name references the county's own CAMA vendor (valorgis.com, the host the dispatch itself named as blocked).",
  },
  ga_jackson: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 45,046 parcel polygons, esriGeometryPolygon, extent -83.82..-83.35 / 33.97..34.30 (matches Jefferson, GA — Jackson County's own seat). Resolved via the ArcGIS Online item the dispatch's own Hub item id (cb6bbe781e324c3abf6e135ed1bc0a32) pointed at; the real polygon layer is id 9 on that service, not 0. ⛔ SECOND PASS (2026-09-23, Michael's own browser): this layer's first ID-shaped column is PIN, a short partial (\"006A\") that matches several lots — an ID search through detectField's plain auto-detection returned 8 lots instead of one. Fixed by pinning PARCEL_NO (pinIdField: true, parcelQuery.js's resolveSearchField), which degrades back to detection if this layer ever drops PARCEL_NO.",
  },
  ga_bibb: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 68,899 parcel polygons, esriGeometryPolygon, extent -83.89..-83.49 / 32.66..32.95 (matches Macon-Bibb). Resolved via the dispatch's own Hub item id (23ef5481f8f24e6aa6e22e7367a4cf32). ⛔ SECOND PASS (2026-09-23, Michael's own browser): detectField was picking LOWPARCELID ahead of PARCELID on this layer, misrouting id searches. Fixed by pinning PARCELID (pinIdField: true, same mechanism as ga_jackson).",
  },
  ga_dougherty: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 38,007 parcel polygons, esriGeometryPolygon, extent -84.46..-83.98 / 31.44..31.65 (matches Albany). Resolved via the dispatch's own Hub item id (9729f520dfab47fab85484908994ef1f).",
  },
  ga_rockdale: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 36,856 parcel polygons, esriGeometryPolygon, extent -84.18..-83.91 / 33.53..33.79 (matches Conyers). ⛔ Two near-identical Rockdale services exist on the same AGOL org — a commercial real-estate broker's personal mirror (rbell@nationalland.com_CCIM) and this one, the county's own GIS staff account (gary.morris_RockdaleGA); wired to the county's own copy, not the broker's. ⛔ SECOND PASS (2026-09-23, Michael's own browser): the wired Address column holds ONLY the house number (\"1620\") — a street-name search on it found 0 lots, a bare house number found 32. The same layer's BOA_Addres column holds the whole situs line (\"1620 WALNUT ST SE\") — a street-name search on it found 55 lots, a full address exactly 1. Rewired addrField to BOA_Addres with pinAddrField: true so it wins over whatever detectField would otherwise pick.",
  },
  ga_paulding: {
    verifiedOn: "2026-09-23",
    verifiedNote: "⛔ CORRECTS the dispatch's own discovery hint — the Hub host it named (paulding-county-geospatial-hub-pcaud.hub.arcgis.com) is Paulding County, OHIO (native SR NAD83/Ohio South (ftUS); a sampled feature reads owner 'WEST OHIO GAS COMPANY'), confirmed live from this sandbox. VERIFIED LIVE instead: 68,018 parcel polygons, esriGeometryPolygon, extent -85.05..-84.72 / 33.77..34.08 (matches Dallas, GA); sampled features read county='paulding', state2='ga'. This is a third-party nationwide-parcel-schema republication (AGOL owner mhackman_UofMD, a University of Maryland researcher account — field prefixes match the Regrid/Loveland national parcel schema), not the county's own GIS; recorded honestly rather than presented as an official source. Vintage 2022 (editingInfo), within this repo's 5-year staleness bar.",
  },
  ga_bulloch: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 34,014 parcel polygons, esriGeometryPolygon, extent -82.03..-81.43 / 32.15..32.65 (matches Statesboro). ⛔ REJECTED CANDIDATE on the same AGOL org (xxKKavhytNgFUeV5): a layer named 'Bulloch_County_GA_Atlas_WFL1' / 'Bulloch County Parcels' holds only 136 features — the B1551616 'title is never the measurement' trap, a stale/partial extract rather than the county's fabric.",
  },
  ga_camden: {
    verifiedOn: "2026-09-23",
    verifiedNote: "VERIFIED LIVE from this sandbox: 31,649 parcel polygons, esriGeometryPolygon, extent -81.94..-81.40 / 30.71..31.17 (matches Kingsland/St. Marys). ⛔ CORRECTS the dispatch's own URL: that MapServer path advertises capabilities:\"Map\" only (no Query — /query 400s 'Invalid URL'); the identical dataset is also published as a FeatureServer at the same path with Query enabled, wired here instead.",
  },
  ga_tift: {
    verifiedOn: "2026-09-24",
    verifiedNote: "VERIFIED LIVE twice: first from Michael's own browser (planyr.io origin) — the SGRC layer (www.sgrcmaps.com/alma/rest/services/Tift/Tift_Parcels/MapServer/0) holds 19,194 parcel polygons and opens fine fetched directly, but the identical fetch FROM planyr.io fails with no Access-Control-Allow-Origin header on the response at all, which is why this county routes through the same-origin /gis-proxy/ pass-through (functions/gis-proxy/[[path]].js) instead of a direct URL. SECOND, independently, from THIS sandbox against the DEPLOYED proxy on this PR's Cloudflare preview build (sgrcmaps.com itself is still blocked by this sandbox's own egress policy, but the proxy's upstream fetch runs server-side in Cloudflare, which the block never reaches): /MapServer/0?f=json returned real layer metadata (fields OBJECTID/ParcelNum/OwnerName/Situs/QPLINK, esriGeometryPolygon); /query?returnCountOnly=true returned exactly 19,194, matching Michael's own count; a point query at Tifton (31.4504, -83.5085) returned a real parcel — OBJECTID 18560, ParcelNum \"T044  082\", OwnerName \"TIFTON DREAM VISION PROPERTIES, LLC\", Situs \"212 E 5TH ST\". idField (ParcelNum) / addrField (Situs) are this measurement, not a guess.",
  },
  /* ═══ NEW-2 (2026-09-23) — 11 more Georgia counties, MEASURED FROM MICHAEL'S OWN SIGNED-IN
   * CHROME on planyr.io (this build environment's egress policy blocks every one of these
   * county-owned hosts, so none could be re-probed from this sandbox) — amends B1870704/NEW-1
   * above, whose "13 deliberately not wired" list this shrinks to two (Long, Walton — neither has
   * a usable public parcel source). Each row was validated end to end through the app's own
   * request shapes: queryAtPoint at a real parcel centroid, then an id search and an address
   * search through the Map Finder search box. ═══ */
  ga_forsyth: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 105,480 parcel polygons. queryAtPoint at a real parcel centroid near Cumming, plus an id search and a street-address search through the Map Finder search box, all returned real lots.",
  },
  ga_henry: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 103,537 parcel polygons. The slowest of the eleven to click-identify (about 1.5s), comfortably inside the 8s fetch timeout. queryAtPoint + both search modes confirmed near McDonough.",
  },
  ga_clayton: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 92,100 parcel polygons. Host is weba.co.clayton.ga.us on a non-standard port (5443) — blocked by this build environment's egress policy, answers cleanly from a real browser (queryAtPoint + both search modes confirmed near Jonesboro).",
  },
  ga_cherokee: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 116,022 parcel polygons. queryAtPoint + both search modes confirmed near Canton; the Woodstock overlap point against ga_cobb resolved to this county, not the neighbour.",
  },
  ga_coweta: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 64,060 parcel polygons. Host is the county's own cccjcgiswa GIS server — blocked by this build environment's egress policy, answers cleanly from a real browser (queryAtPoint + both search modes confirmed near Newnan).",
  },
  ga_glynn: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 46,503 parcel polygons. Host is a webadaptor path on the county's own GIS server — blocked by this build environment's egress policy, answers cleanly from a real browser. No address column on this layer at all — id search only, addrField deliberately left unset.",
  },
  ga_screven: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 10,979 parcel polygons — smallest of the eleven. Published on the Coastal Regional Commission's shared GIS host (maps.crc.ga.gov), same publisher convention as ga_liberty below. No address column — id search only.",
  },
  ga_bryan: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 23,200 parcel polygons. ⛔ This server answers HTTP 200 with {error:{code:400,message:\"Pagination is not supported.\"}} to ANY query carrying resultRecordCount — every ordinary search — so the search box could not have worked here without arcgis.js's queryFeatures pagination fallback (isPaginationUnsupportedError → ids-only, then by objectIds); both fallback calls were measured working on this server. The click path (queryAtPoint, no pagination params) always worked. Layer is PropertyDetails/0 — the dispatch's own Parcels/MapServer path does not exist on this host. Situs is decomposed (no combined column) — addrField is the street-name column.",
  },
  ga_liberty: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 28,170 parcel polygons. Published on the same Coastal Regional Commission shared GIS host as ga_screven — the dispatch's own gis.libertycountyga.com host did not connect at all from that Chrome; this is a genuinely different, working source.",
  },
  ga_bartow: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 63,688 parcel polygons. Situs is decomposed (no combined column), same shape as ga_bryan — addrField is the street-name column.",
  },
  ga_cobb: {
    verifiedOn: "2026-09-23",
    verifiedNote: "MEASURED live on Michael's own Chrome, planyr.io origin: 279,635 parcel polygons — largest of the eleven. queryAtPoint + both search modes confirmed near Marietta; the north-Marietta overlap point against ga_cherokee resolved to this county, not the neighbour.",
  },

  /* ═══ NEW-1 (2026-09-24, third pass) — 34 more Georgia counties. ⛔ NONE OF THESE COULD BE
   * RE-VERIFIED FROM THIS SANDBOX — every host below is blocked by this build environment's
   * egress policy. Every count/date here is MEASURED from Michael's own signed-in Chrome at
   * the planyr.io origin on 2026-09-24 and recorded as reported, not independently re-derived;
   * the live-verify item on this batch (VERIFICATION.md) is the check that closes that gap.
   * Full session record, including the six counties with no usable public parcel source found,
   * is in docs/STATEWIDE-PARCELS.md's dated 2026-09-24 section. ═══ */
  ga_richmond: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 84,925 parcel polygons, last edited live county server. Augusta-Richmond consolidated government's own GIS host (gismap.augustaga.gov).",
  },
  ga_whitfield: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 46,673 parcel polygons, last edited live county server. The county's own GIS host (gis.whitfieldcountyga.com). ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_FUL' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_hall: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 91,921 parcel polygons, last edited live county server. The county's own GIS host (hallgis.hallcounty.org), layer 1 \"Parcel Boundary\". ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PIN' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_effingham: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 32,941 parcel polygons, last edited 2024-10. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_fayette: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 49,104 parcel polygons, last edited daily. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_spalding: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 33,700 parcel polygons, last edited daily. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_ID' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_newton: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 45,755 parcel polygons, last edited 2022-02. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_barrow: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 35,234 parcel polygons, last edited 2022-03. Layer 30 of the Greater Athens regional commission's shared FeatureServer (org Ug5xGQbHsD8zuZzM); ga_oconee shares the same service at layer 32 — same host, different layer id, not a URL conflict. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_no' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_oconee: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 19,068 parcel polygons, last edited 2022-03. Layer 32 of the same Greater Athens regional-commission service ga_barrow rides at layer 30. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCELID' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_butts: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 13,065 parcel polygons, last edited 2024-09. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'GSI_PIN' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_monroe: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 16,707 parcel polygons, last edited 2025-08. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCELID' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_troup: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 35,511 parcel polygons, last edited 2026-02. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'parcelnumb' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_peach: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 14,431 parcel polygons, last edited 2026-09. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCELS' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_muscogee: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 70,625 parcel polygons, last edited 2019-01. 2019 vintage — the oldest of this batch, still inside this repo's 5-year staleness bar; the help text says so. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'TaxPIN' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_morgan: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 12,190 parcel polygons, last edited 2018-11. 2018 vintage — the oldest county source in the whole registry, still inside this repo's 5-year staleness bar; the help text says so. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_baldwin: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 21,411 parcel polygons, last edited 2021-03.",
  },
  ga_brantley: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 13,301 parcel polygons, last edited 2025-10. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_charlton: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 7,357 parcel polygons, last edited 2023-07. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_clay: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 3,063 parcel polygons, last edited 2024-05. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_cook: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 5,103 parcel polygons, last edited 2023-11. ⚠ measured extent is narrower than the whole county (about -83.49..-83.37) — possibly city-of-Adel-only coverage. Wired anyway per this item's own instruction; the live-verify pass must click a lot outside Adel to confirm county-wide coverage. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_crawford: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 8,186 parcel polygons, last edited 2026-09. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCELNO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_crisp: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 12,351 parcel polygons, last edited 2022-03. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_dade: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 7,811 parcel polygons, last edited 2026-07. ⛔ Do not confuse with `Walker_Parcels_2026LLLT/4` on a different AGOL org — identical 7,811-feature count and Dade's own extent under a Walker-County-sounding name; that layer is Dade's data mislabeled, not a real Walker County source, and stays unwired. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_dooly: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 7,277 parcel polygons, last edited 2022-03. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_echols: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 2,206 parcel polygons, last edited 2026-06. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_emanuel: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 15,107 parcel polygons, last edited 2026-08. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_evans: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 6,672 parcel polygons, last edited 2023-01. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_greene: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 17,735 parcel polygons, last edited 2025-09. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_lanier: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 5,968 parcel polygons, last edited 2025-12. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_meriwether: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 16,511 parcel polygons, last edited 2023-06. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_sumter: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 16,415 parcel polygons, last edited 2026-07. Layer 9 of a regional-commission service named for trails, not parcels — same B1551616 \"title is never the measurement\" trap other GA rows in this file have already hit; the layer itself is the county's real parcel fabric. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCELID' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_turner: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 5,714 parcel polygons, last edited 2026-01. Service name really is \"TunerParcels\" (sic). ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'Parcel_No' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_twiggs: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 6,832 parcel polygons, last edited 2026-01. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCELID' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
  },
  ga_ware: {
    verifiedOn: null,
    verifiedNote: "MEASURED from Michael's own signed-in Chrome (this build environment's egress policy blocks this host): 23,119 parcel polygons, last edited 2026-09-22. ⛔ THIRD-PASS ID PIN 2026-09-24: pinned idField 'PARCEL_NO' (pinIdField: true) — this layer also publishes a FID/OBJECTID row-number column that plain detection would otherwise have picked, showing the layer's own row number instead of the real parcel number on the card (B1875248).",
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
  la_orleans: {
    verifiedNote: "gis.nola.gov is blocked by this build environment's egress policy (re-confirmed live while wiring this row, B1574256 — CONNECT tunnel rejected, HTTP 403 — the same standing as az_maricopa and al_jefferson). Endpoint, layer choice and the 3-point spread are from the dispatch's own live-browser measurement, 2026-09-11 evening Central — not independently re-probed here. Layer 0 'parcels' is the ONLY layer on the ParcelSearch service, capabilities Map/Query/Data; the spread was New Orleans CBD (114ms, 357 features, PARCELID 41036654, SITEADDRESS '826 UNION ST, LA', OWNERNME1 'CONDO MASTER'), Algiers across the Mississippi (94ms, 246 features, PARCELID 41001272, '1306 PACIFIC AVE, LA, 70114') and Lakeview (65ms, 224 features, PARCELID 41011510, '6198 MILNE BLVD, LA, 70124') — three real, distinct parcels at the far corners of the parish, not just its downtown. Found by route 3 (the jurisdiction's OWN GIS hostname, gis.nola.gov/arcgis/rest/services) after routes 1 and 2 both came up empty — the third consecutive time route 3 has succeeded where 1 and 2 failed (Maricopa, Allegheny, Orleans). → V1127504.",
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

  /* B1583296 — City of Detroit, wired CITY-scoped (see cityScopes.js), not as Wayne County. */
  mi_detroit: {
    verifiedOn: "2026-09-12",
    verifiedNote: "Layer metadata (field list: parcel_id, address, tax_status, tax_status_description, 51 fields total) confirmed LIVE from this sandbox — services2.arcgis.com is reachable here. The dispatch's own live-browser measurement (2026-09-11 evening Central) queried a real point at downtown Detroit (42.3314, -83.0458) and returned a parcel with 46 populated fields. Detroit_MP_Parcel_Authoritative was PREVIOUSLY declined as a Wayne County candidate (B1455635/B1551617) for exactly the reason it is now wired only as a CITY scope: it is Detroit's own authoritative parcel layer and would silently return nothing across the rest of Wayne County. The boundary geometry cityScopes.js uses to decide whether a point is inside Detroit at all — 'City of Detroit Boundary', City of Detroit's own ArcGIS Online org (OpenDataAdmin_detroitmi, item 86b221bb68ca4364afe81d156e54f95c, public_authoritative) — was independently queried and verified live from this sandbox the same session; see that module's own header for the full provenance and the three control points (downtown Detroit hits; Livonia and Taylor, both real Wayne County cities, do not).",
  },

  /* ═══ 2026-09-15 — South Dakota (Pennington + Minnehaha/Sioux Falls), Pennsylvania (Luzerne +
   * Lackawanna), Macomb MI, and the Kansas City/Independence MO city-scoped pair. All measured
   * live from Michael's own browser 2026-09-15; the *.arcgis.com endpoints (Pennington, Macomb,
   * Independence) were additionally confirmed reachable, with matching field lists, directly from
   * this sandbox the same day. ═══ */
  sd_pennington: {
    verifiedOn: "2026-09-15",
    verifiedNote: "VERIFIED LIVE from Michael's own browser and independently re-confirmed from this sandbox (services1.arcgis.com is reachable here): 52,547 parcel polygons, extent matching Pennington County (Rapid City), fields include PIN/TaxID/Acres/LotStreetN/LegalDescr/Subdivisio.",
  },
  sd_minnehaha: {
    verifiedNote: "gis.minnehahacounty.gov is blocked by this build environment's egress policy. VERIFIED LIVE from Michael's own browser 2026-09-15: 23,044 parcel polygons across the whole-county extent — but this layer has a HOLE exactly where Sioux Falls sits (a point query at downtown Sioux Falls, -96.7311/43.5460, returns ZERO; a rural point 15 miles away, -96.95/43.75, returns a real parcel). See sd_siouxfalls below for the city's own layer, which fills the hole, and cityScopes.js for the resolution mechanism. This is the worked example behind the parcel-source vetting 'city-hole' trap (ui-audit/discover-county-parcels.mjs).",
  },
  sd_siouxfalls: {
    verifiedNote: "gis.siouxfalls.gov is blocked by this build environment's egress policy. VERIFIED LIVE from Michael's own browser 2026-09-15: 67,022 parcel polygons, extent covering the city (not the county); ACREAGE is a real double, unlike Lackawanna's StatedArea below. City-scoped (cityScopes.js) — the boundary ring itself comes from Esri's own Living Atlas 'USA Census Populated Place Areas' (services.arcgis.com/P3ePLMYs2RVChkJx/…), queried live from this sandbox 2026-09-15 (the city's own AGOL account publishes no reachable mirror of its 'City Limits' layer — see cityScopes.js's own header for the full provenance).",
  },
  pa_luzerne: {
    verifiedNote: "gis.luzernecounty.org is blocked by this build environment's egress policy. VERIFIED LIVE from Michael's own browser 2026-09-15: 176,385 parcel polygons, extent matching Luzerne County. Layer 1 ('PublicMap/MapServer/1') is the parcel (tax parcels) layer; layer 6 on the same service is IMPROVEMENTS, a different table, and is not wired.",
  },
  pa_lackawanna: {
    verifiedNote: "gis.lackawannacounty.org is blocked by this build environment's egress policy. VERIFIED LIVE from Michael's own browser 2026-09-15: 103,145 parcel polygons, extent matching Lackawanna County, Esri parcel-fabric schema (Name = the 13-digit parcel PIN, confirmed by sampled attributes). Do not wire the sibling GISViewer/ParcelsPINs service — identical count and schema, no added value.",
  },
  mi_macomb: {
    verifiedOn: "2026-09-15",
    verifiedNote: "VERIFIED LIVE from Michael's own browser and independently re-confirmed from this sandbox (services6.arcgis.com is reachable here, field list matches exactly: TAX_ID/ADDRESS/TAX_TYPE/CVT_NAME/…): 332,971 parcel polygons, extent matching Macomb County. Layer ID is 10, NOT 0 (layer 0 does not exist on this service — 'Invalid URL'). ⛔ Published under a PERSONAL ArcGIS Online account, not a county-org account — the same provenance risk as the Texas statewide source whose owner deleted it (docs/STATEWIDE-PARCELS.md); flagged here so a future staleness check looks at this row first.",
  },
  mo_kansascity: {
    verifiedNote: "mapd.kcmo.org is blocked by this build environment's egress policy. VERIFIED LIVE from Michael's own browser 2026-09-15: 203,425 parcel polygons; a 3-point spread across the whole city (Crown Center/Jackson Co., Northland/Clay Co., the airport/Platte Co.) all answered with real, distinct parcels through this ONE layer. City-scoped (cityScopes.js) and spans Jackson, Clay, Platte and Cass counties — the ring test is county-agnostic, so no per-county branching is needed. The boundary ring comes from Esri's own Living Atlas 'USA Census Populated Place Areas' (services.arcgis.com/P3ePLMYs2RVChkJx/…), queried live from this sandbox 2026-09-15, after the city's own AGOL-hosted 'CityLimit' layer (services.arcgis.com/4o5uMWTHuOhUVJPd/…) was found to answer `returnCountOnly` with 0 features despite advertising a real extent — an empty hosted layer, confirmed live, not a reachability block. See cityScopes.js's own header for the full provenance.",
  },
  mo_independence: {
    verifiedOn: "2026-09-15",
    verifiedNote: "VERIFIED LIVE from Michael's own browser and independently re-confirmed from this sandbox (services.arcgis.com/sbDzK061dd6DNPHv is reachable here): 73,154 parcel polygons, extent covering the city (not Jackson County). `Name` is confirmed as the idField — its live field-list alias reads 'Parcel APN'. City-scoped (cityScopes.js), wholly within Jackson County, which publishes no open countywide parcel service of its own (docs/STATEWIDE-PARCELS.md) — Independence and Kansas City together are what Jackson County gets; the rest of the county has no source wired, an honest gap rather than a defect.",
  },

  /* ═══ NEW-1 (2026-09-24) — 17 Florida counties (Jacksonville + Polk/Lakeland markets), all
   * riding ONE shared statewide layer (FL_STATEWIDE_LAYER in counties.js) scoped via `CO_NO`, the
   * FDOR county code (NOT a FIPS code). "FDOR Cadastral 2025" (owner FloridaGIO), esriGeometryPolygon,
   * 10,831,924 features, last edited 2026-09-16 — reachable from THIS SANDBOX (unlike most county-
   * own hosts in this file). ⛔ Whole-layer `returnCountOnly`/`returnExtentOnly` both exceeded a 40s
   * timeout (see counties.js's FL_STATEWIDE_LAYER header and docs/STATEWIDE-PARCELS.md's Florida
   * section) — so every row below is verified by ITS OWN live point query against the shared layer,
   * run from this sandbox 2026-09-24, never by a whole-layer count/extent probe. All 17 CO_NO values
   * were independently confirmed this way (not merely copied from the dispatch's own table). */
  fl_duval: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at downtown Jacksonville (-81.6579, 30.3255): CO_NO 26, PARCEL_ID \"0744550000R\", PHY_ADDR1 \"3 E INDEPENDENT DR\", OWN_NAME \"JACKSONVILLE AREA CHAMBER OF C\" — the real lot at the measured address, on the shared FL_STATEWIDE_LAYER.",
  },
  fl_nassau: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Fernandina Beach (-81.4626, 30.6697): CO_NO 55, PARCEL_ID \"000031180000120290\", PHY_ADDR1 \"312 ASH ST\", OWN_NAME \"CLARK BRADFORD R\". ⛔ RECURRENCE FIX (2026-09-24, B1885600 ×2): the offline nationwide county-polygon asset's own Nassau ring used to be built from the GENERALIZED USA_Counties_Generalized_Boundaries source and did not reach the true tip of Amelia Island — this exact point resolved 'outside' against it, so the click router never fired a parcel request at all for this town, on the deployed build. Fixed by giving Florida its own dedicated FDEP shoreline source in build-county-polygons.mjs (the TX/CO treatment), rather than routing test coverage around the gap — this point now resolves 'ok'/Nassau against the rebuilt asset too. See docs/STATEWIDE-PARCELS.md's Florida section.",
  },
  fl_clay: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Green Cove Springs (-81.6777, 29.9911 — nudged ~0.001° from the exact seat point, which landed on Bay St with no parcel underneath): CO_NO 20, PARCEL_ID \"38-06-26-017310-000-00\", PHY_ADDR1 \"BAY St\", OWN_NAME \"Knight Brian\".",
  },
  fl_stjohns: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at St. Augustine (-81.3145, 29.8947): CO_NO 65, PARCEL_ID \"1980800000\", PHY_ADDR1 \"70 HYPOLITA ST\", OWN_NAME \"66 AND 70 HYPOLITA LLC\".",
  },
  fl_baker: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Macclenny (-82.1265, 30.2827): CO_NO 12, PARCEL_ID \"322S22004900250010\", PHY_ADDR1 \"57 SHUEY AVE\", OWN_NAME \"CITY OF MACCLENNY\".",
  },
  fl_polk: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Lakeland (-81.9498, 28.0395): CO_NO 63, PARCEL_ID \"242819000000031050\", PHY_ADDR1 \"72 LAKE MORTON DR\", OWN_NAME \"FIRST UNITED METHODIST CHURCH\". Polk County's seat is Bartow, FL — a city, not Bartow County, GA (already wired as ga_bartow).",
  },
  fl_hillsborough: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Tampa (-82.4572, 27.9516 — nudged ~0.001° from the exact seat point, which landed on E Polk St with no parcel underneath): CO_NO 39, PARCEL_ID \"1829244ZI000029000010A\", PHY_ADDR1 \"E POLK ST\", OWN_NAME \"U S A FEDERAL BUILDING\".",
  },
  fl_pasco: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Dade City (-82.1968, 28.3625): CO_NO 61, PARCEL_ID \"27-24-21-0000-09100-0000\", PHY_ADDR1 \"14031 14TH\", OWN_NAME \"DISTRICT SCHOOL BOARD OF\".",
  },
  fl_hernando: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Brooksville (-82.3819, 28.5553 — nudged ~0.006° from the exact seat point, which timed out/landed off-parcel): CO_NO 37, PARCEL_ID \"R23 122 19 1200 0060 0020\", PHY_ADDR1 \"504 E JEFFERSON ST\", OWN_NAME \"HARVEST TIME HERNANDO CHURCH I\".",
  },
  fl_sumter: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Bushnell (-82.1101, 28.6650): CO_NO 70, PARCEL_ID \"N16A205\", PHY_ADDR1 \"305 N FLORIDA ST\", OWN_NAME \"BARNES A DALE & KELLI L\".",
  },
  fl_lake: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Tavares (-81.7238, 28.8039 — nudged ~0.001° from the exact seat point, which landed with no parcel underneath): CO_NO 45, PARCEL_ID \"28-19-26-1800-026-00200\", PHY_ADDR1 \"418 E ALFRED ST\", OWN_NAME \"BUDD-MC GOWN CASSANDRA L\".",
  },
  fl_orange: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Orlando (-81.3792, 28.5393 — nudged ~0.001° from the exact seat point): CO_NO 58, PARCEL_ID \"262229002700050\", PHY_ADDR1 \"200 S ORANGE AVE\", OWN_NAME \"PIEDMONT 200 AND 250 SOUTH ORA\".",
  },
  fl_osceola: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Kissimmee (-81.4066, 28.2920 — nudged ~0.001° from the exact seat point, which timed out/landed off-parcel): CO_NO 59, PARCEL_ID \"2225292257000100C0\", PHY_ADDR1 \"PLEASANT ST\", OWN_NAME \"CITY OF KISSIMMEE\".",
  },
  fl_highlands: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Sebring (-81.4399, 27.4956 — nudged ~0.001° from the exact seat point, which landed with no parcel underneath): CO_NO 38, PARCEL_ID \"S29342907005800180\", PHY_ADDR1 \"127 E CENTER AVE BEAUTY SHOP\", OWN_NAME \"MEDINA DIANA\".",
  },
  fl_hardee: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox near Wauchula (-81.8085, 27.5372 — nudged ~0.001° from the exact seat point, which landed with no parcel underneath): CO_NO 35, PARCEL_ID \"1034250000008000000\", PHY_ADDR1 \"905 S  6TH AVE\", OWN_NAME \"DISCOUNT AUTO PARTS LLC\".",
  },
  fl_manatee: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Bradenton (-82.5748, 27.4989): CO_NO 51, PARCEL_ID \"3329300059\", PHY_ADDR1 \"1301 1ST AVE W\", OWN_NAME \"MANATEE COUNTY\". ⛔ The offline nationwide county-polygon asset's own Manatee ring has a small gap near downtown Bradenton's riverfront (likely the Manatee River channel) — this exact point resolves cleanly against the LIVE layer above but 'outside' against that offline asset; the COUNTIES_MAP bbox/routing test therefore uses a point just north of downtown (still within city limits) rather than this exact address.",
  },
  fl_desoto: {
    verifiedOn: "2026-09-24",
    verifiedNote: "Live point query from this sandbox at Arcadia (-81.8592, 27.2153): CO_NO 24, PARCEL_ID \"253724001200100045\", PHY_ADDR1 \"1 N  BREVARD AVE\", OWN_NAME \"VIRGINIA H LISKEY PROPS LLC\".",
  },
};

/* Convenience accessors so callers never reach into the shape directly. */
export const verifiedOnFor = (key) => (COUNTY_VERIFICATION[key] || {}).verifiedOn || null;
export const candidateUrlFor = (key) => (COUNTY_VERIFICATION[key] || {}).candidateUrl || null;
export const provenanceFor = (key) => {
  const r = COUNTY_VERIFICATION[key] || {};
  return r.candidateProvenance || r.verifiedNote || null;
};
