/* NEW-1 (Fort Bend County layers, 2026-11-12) — the VERIFICATION payload of the Fort Bend registry rows (`sourcesFortBend.js`), off the app bundle exactly like every other row's fixtures
 * (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there with one line each.
 *
 * Every point sits ON a real feature (a vertex of a feature, or the owner's named point) and every count is what the verifier's own ±0.01° box returned on 2026-11-12 against the county's
 * public server. Two points ≥ 2 km apart per row (the "local" fixture class). What a fixture cannot say is a NEGATIVE — "Fulshear (-95.90, 29.69) is in no LID" is asserted in
 * test/fortBendLayers.test.js against the recorded answer and re-checked in the live pass (V#). */

export const FORTBEND_FIXTURES = {
  fbLid: { fixtures: [
    { label: "Fort Bend LID #2 (owner's named point)", point: [-95.62, 29.58], expectMinCount: 1 }, // live 2026-11-12: 1 — "Fort Bend LID #2"
    { label: "Sienna LID", point: [-95.4928, 29.4973], expectMinCount: 1 }, // live: 2
    { label: "First Colony LID #2", point: [-95.5912, 29.5626], expectMinCount: 1 }, // live: 4
  ] },
  fbLevees: { fixtures: [
    { label: "Sienna Plantation levee", point: [-95.5408, 29.4912], expectMinCount: 1 }, // live: 2
    { label: "First Colony levee", point: [-95.6091, 29.5568], expectMinCount: 1 }, // live: 8
  ] },
  fbBrazosInundation: { fixtures: [
    { label: "Brazos corridor near Richmond", point: [-95.7629, 29.5911], expectMinCount: 1 }, // live: 2
    { label: "Brazos corridor near Fulshear", point: [-95.8769, 29.6577], expectMinCount: 1 }, // live: 2
  ] },
  fbBrazosFloodplain: { fixtures: [
    { label: "Brazos 55-ft floodplain near Fulshear", point: [-95.8977, 29.6325], expectMinCount: 1 }, // live: 34
    { label: "Brazos 55-ft floodplain, south-east", point: [-95.4755, 29.4595], expectMinCount: 1 }, // live: 4
    { label: "Brazos 55-ft floodplain, Rosenberg side", point: [-95.6119, 29.452], expectMinCount: 1 }, // live: 4
  ] },
  fbTirz: { fixtures: [
    { label: "C06 TIRZ 1", point: [-95.8019, 29.7735], expectMinCount: 1 }, // live: 1
    { label: "C09 TIRZ 1", point: [-95.5314, 29.5879], expectMinCount: 1 }, // live: 1
  ] },
  fbMmd: { fixtures: [
    { label: "Sienna Plantation Management District", point: [-95.5385, 29.5258], expectMinCount: 1 }, // live: 1
    { label: "First Colony Management District", point: [-95.6222, 29.6017], expectMinCount: 1 }, // live: 1
    { label: "Fort Bend County MMD #1", point: [-95.7145, 29.657], expectMinCount: 1 }, // live: 2
  ] },
  fbDevAgreements: { fixtures: [
    { label: "Candela (Hines Nursery) — FM 359 / Fulshear Gaston Rd", point: [-95.8272, 29.6778], expectMinCount: 1 }, // live: 1
    { label: "Savannah North — Post Rd", point: [-95.4483, 29.515], expectMinCount: 1 }, // live: 1
    { label: "Stonecreek Estates — A Myers Rd", point: [-95.7366, 29.5035], expectMinCount: 1 }, // live: 1
  ] },
  fbMtpProposed: { fixtures: [
    { label: "Bamore Ext, Rosenberg", point: [-95.8252, 29.5233], expectMinCount: 1 }, // live: 3
    { label: "Muegge Rd", point: [-95.8696, 29.5446], expectMinCount: 1 }, // live: 3
    { label: "Reading Rd Ext", point: [-95.7734, 29.5635], expectMinCount: 1 }, // live: 4
  ] },
};

export const FORTBEND_DOCS = {
  fbLid: { notes: "The county's Levee Improvement Districts (15), with TCEQ id, operator and engineer. The TCEQ water-district row also draws them; this one adds who runs and engineers each." },
  fbLevees: { notes: "Levee centerlines in FEMA's levee schema (56 rows, 28 distinct LEVEE_IDs — rows 49–76 repeat 1–28, so the card dedupes on the id). Accreditation reads 'NP' (not provided) on most." },
  fbBrazosInundation: { notes: "The Fort Bend County Drainage District's Brazos River 100-year inundation study (2 polygons, no attributes). A study, not the effective FEMA map." },
  fbBrazosFloodplain: { notes: "The Brazos River 55-foot floodplain study (492 polygons, all 'AE'; base flood elevation and depth are blank). A study, not the effective FEMA map." },
  fbTirz: { notes: "Tax increment reinvestment zones (29) in Fort Bend County, by the county's own entity code." },
  fbMmd: { notes: "Management districts (13). The district's point-of-contact name and phone are never requested." },
  fbDevAgreements: { notes: "County development agreements (48): the road dedication / construction / contribution obligations a subdivision owes (affected road, developer, type, status)." },
  fbMtpProposed: { notes: "Major Thoroughfare Plan proposed roadways (339). The plan's EXISTING roadways (1,429) are not requested." },
};
