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
    candidateProvenance: "ArcGIS Online item 'Parcels - Arapahoe County' (owner gis@mhfd); host gis.arapahoegov.com blocked by build-environment egress policy — probe pending (V507).",
    verifiedOn: null,
  },
  co_larimer: {
    candidateUrl: "https://maps1.larimer.org/arcgis/rest/services/MapServices/Parcels/MapServer/3",
    candidateProvenance: "ArcGIS Online item 'Larimer County Tax Parcels' (owner ftc_geoevent); host maps1.larimer.org blocked by build-environment egress policy — probe pending (V507).",
    verifiedOn: null,
  },
  co_jefferson: {
    verifiedOn: null,
  },
  co_elpaso: {
    candidateUrl: "https://gisservices.elpasoco.com/arcgis2/rest/services/HubPublic/Parcels/MapServer",
    candidateProvenance: "ArcGIS Online item 'Parcels' (owner BaileyG, El Paso County); host gisservices.elpasoco.com blocked by build-environment egress policy — probe pending (V507). A regional alternative WAS verified live 2026-07-29 — PPACG Parcels (2025), https://services1.arcgis.com/0plDVQODvYjBRQXP/arcgis/rest/services/PPACG_Parcels/FeatureServer/0, native SR EPSG:2232 — but it is the MPO's derived planning layer, not the assessor's fabric, so it is not shipped as a parcel source.",
    verifiedOn: null,
  },
  co_boulder: {
    candidateUrl: "https://maps.bouldercounty.org/arcgis/rest/services/PARCELS/PARCELS_OWNER/FeatureServer/0",
    candidateProvenance: "ArcGIS Online item 'Parcels - Boulder County' (owner gis@mhfd); host maps.bouldercounty.org blocked by build-environment egress policy — probe pending (V507).",
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
