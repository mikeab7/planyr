/* NEW-1 / NEW-2 (Nashville buffers + Metro pending flood maps, 2026-11-12) — the VERIFICATION payload of the Metro Nashville registry rows (`sourcesNashville.js`), off the app bundle exactly like
 * every other row's fixtures (see sourceFixtures.js). Spread into SOURCE_FIXTURES / SOURCE_DOCS there with one line each.
 *
 * Every point is a vertex of a real feature (found by the sweep's own query), and every count is what the verifier's ±0.01° box returned on 2026-11-12. The two ends are ≥ 15 km apart (Davidson County is
 * ~45 km across): Antioch / south-east and Whites Creek / north.
 *
 * ⛔ PENDING / PRELIMINARY ARE EMPTY TODAY, so their fixtures cannot assert a count on them: they probe the SIBLING Approved layer (layer 1 of the same service, `layer: 1`) to prove the SERVICE answers at both
 * ends — the same "service-alive probe" the EIA crude row uses. The day Metro posts a revision, add a fixture on the layer itself. */

const ANTIOCH = [-86.65461, 36.02578], NORTH = [-86.81005, 36.29407];
const APPROVED_ALIVE = (label) => ({ label, point: [-86.8199, 36.1029], layer: 1, expectMinCount: 1 }); // live 2026-11-12: 66 approved polygons in the box

export const NASHVILLE_FIXTURES = {
  metroFloodwayBuffer: { fixtures: [
    { label: "South-west Davidson (Bell Road / Mill Creek side)", point: [-87.0411, 36.0502], expectMinCount: 1 }, // live 2026-11-12: 4
    { label: "North Davidson", point: [-86.7505, 36.4046], expectMinCount: 1 }, // live: 5
  ] },
  metroPondBuffer: { fixtures: [
    { label: "Antioch / south-east", point: [-86.63856, 36.05931], expectMinCount: 1 }, // live: 7
    { label: "Whites Creek / north", point: [-86.82591, 36.29331], expectMinCount: 1 }, // live: 6
  ] },
  metroStreamBuffer: { fixtures: [
    { label: "Antioch / south-east", point: ANTIOCH, expectMinCount: 1 }, // live: 100
    { label: "Whites Creek / north", point: NORTH, expectMinCount: 1 }, // live: 122
    { label: "Downtown", point: [-86.75648, 36.14105], expectMinCount: 1 }, // live: 29
    { label: "Antioch box (the sweep's own probe)", bbox: [-86.64, 36.03, -86.62, 36.045], expectMinCount: 50 }, // live 2026-11-12: 72 (sweep 2026-11-01: 72)
  ] },
  metroWetlandBuffer: { fixtures: [
    { label: "Antioch / south-east", point: [-86.61665, 36.05971], expectMinCount: 1 }, // live: 18
    { label: "Whites Creek / north", point: [-86.81172, 36.29397], expectMinCount: 1 }, // live: 12
  ] },
  metroFemaPending: { fixtures: [
    APPROVED_ALIVE("Service alive — Approved layer, west Davidson (Pending itself holds 0 features)"),
    { label: "Service alive — Approved layer, Antioch", point: [-86.5998, 36.015], layer: 1, expectMinCount: 1 }, // live: 26
  ] },
  metroFemaPreliminary: { fixtures: [
    APPROVED_ALIVE("Service alive — Approved layer, west Davidson (Preliminary itself holds 0 features)"),
    { label: "Service alive — Approved layer, Antioch", point: [-86.5998, 36.015], layer: 1, expectMinCount: 1 }, // live: 26
  ] },
};

export const NASHVILLE_DOCS = {
  metroFloodwayBuffer: { notes: "Metro Water Services' FEMA floodway buffer (174; BufferDistance 50 on 91, 75 on 83; edited 2025-06-06). Metro Stormwater Manual Vol. 1 ch. 6 §6.10." },
  metroPondBuffer: { notes: "Metro pond buffer (993; BufferDistance 25 on all; edited 2025-06-06): 25 ft from normal pool per §6.10." },
  metroStreamBuffer: { notes: "Metro stream buffer (25,287; no width attribute, edited 2025-06-06). The width is 30 / 50 / 75 ft by drainage area and flood study (§6.10); the polygon does not say which. Page size 2,000 — read with fetchAll." },
  metroWetlandBuffer: { notes: "Metro wetland buffer (2,747; no width attribute, edited 2025-06-06): 25 ft from the delineation per §6.10." },
  metroFemaPending: { notes: "Metro's FEMA Pending Flood Hazard Areas. EMPTY on 2026-11-12 (0 features). Fixtures probe the sibling Approved layer (17,784 polygons, all adopted 2024-06-20) to prove the service answers." },
  metroFemaPreliminary: { notes: "Metro's FEMA Preliminary Flood Hazard Areas. EMPTY on 2026-11-12 (0 features). Fixtures probe the sibling Approved layer to prove the service answers." },
};
