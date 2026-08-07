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
};

/* Convenience accessors so callers never reach into the shape directly. */
export const verifiedOnFor = (key) => (COUNTY_VERIFICATION[key] || {}).verifiedOn || null;
export const candidateUrlFor = (key) => (COUNTY_VERIFICATION[key] || {}).candidateUrl || null;
export const provenanceFor = (key) => {
  const r = COUNTY_VERIFICATION[key] || {};
  return r.candidateProvenance || r.verifiedNote || null;
};
