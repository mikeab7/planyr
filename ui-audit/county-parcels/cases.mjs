/* THE TABLE. One row per place; adding the next county is adding a row here (see README.md in this folder).
 * Row fields:
 *   id        unique, kebab-case.            covers   ledger V#s this row closes when it PASSes.
 *   place     human label.                   points   [{label, lat, lng, ...per-point overrides}] or [[label, lat, lng]].
 *   live      true = also ask the real county server through the shipped queryAtPoint.
 *   routes    the EXACT set of source keys candidateCountiesForPoint must return (the app asks all of them).
 *   routesNot / routesInclude   keys that must be absent / present when the exact set is not the claim.
 *   answeredBy  the key whose layer must return the parcel.      pin   regex the PIN must match (field = idField unless `field`).
 *   layer     regex the answering layer URL must match.          requests   max parcel requests fired (default routes.length).
 *   noRequestTo   hosts that must receive no parcel request.     distinct   true = PINs must differ across the row's points.
 *   attrs     { FIELD: /regex/ } extra attributes the parcel must carry (owner, address…).
 *   interior  false = this point has NOT been confirmed inside a lot: "no parcel" there is VOID, not FAIL (default true).
 *   live      false (on a point) = routing claim only, no county request.
 */
export const CASES = [
  {
    id: "sd-pennington-rapid-city", covers: ["V1179280"], place: "Pennington County, SD (Rapid City)",
    live: true, answeredBy: "sd_pennington", layer: /services1\.arcgis\.com\/.*PenningtonParcels\/FeatureServer\/0$/, pin: /\S/,
    points: [
      { label: "Rapid City", lat: 44.084602, lng: -103.234594, routes: ["sd_pennington"] },
      // Ledger step 3: a lot elsewhere in South Dakota must not ask this layer at all (a routing claim, no county request).
      { label: "outside Pennington (rural Minnehaha, SD)", lat: 43.75, lng: -96.95, live: false, routesNot: ["sd_pennington"] },
    ],
  },
  {
    id: "sd-sioux-falls-vs-minnehaha", covers: ["V1179281"], place: "Sioux Falls city layer vs rural Minnehaha",
    live: true,
    points: [
      { label: "downtown Sioux Falls", interior: false, lat: 43.5460, lng: -96.7311, routes: ["sd_siouxfalls"], answeredBy: "sd_siouxfalls", layer: /gis\.siouxfalls\.gov\/.*Property\/MapServer\/1$/, noRequestTo: ["gis.minnehahacounty.gov"] },
      { label: "rural Minnehaha", interior: false, lat: 43.75, lng: -96.95, routes: ["sd_minnehaha"], answeredBy: "sd_minnehaha", layer: /gis\.minnehahacounty\.gov\/.*Parcels\/MapServer\/0$/, noRequestTo: ["gis.siouxfalls.gov"] },
      { label: "just outside the Sioux Falls line (inside its bounding box)", lat: 43.5003, lng: -96.6488, interior: false, routes: ["sd_minnehaha", "sd_siouxfalls"], answeredBy: "sd_minnehaha", requests: 2 },
    ],
  },
  {
    id: "pa-luzerne-wilkes-barre", covers: ["V1179282"], place: "Luzerne County, PA (Wilkes-Barre)",
    live: true, answeredBy: "pa_luzerne", layer: /gis\.luzernecounty\.org\/server\/rest\/services\/PublicMap\/MapServer\/1$/, pin: /\S/,
    points: [{ label: "Wilkes-Barre", interior: false, lat: 41.2459, lng: -75.8813, routes: ["pa_luzerne"] }],
  },
  {
    id: "pa-lackawanna-scranton", covers: ["V1179283"], place: "Lackawanna County, PA (Scranton)",
    live: true, answeredBy: "pa_lackawanna", layer: /gis\.lackawannacounty\.org\/arcgis\/rest\/services\/GISViewer\/Parcels\/FeatureServer\/0$/, pin: /^\d{13}$/, field: "Name",
    points: [{ label: "Scranton", interior: false, lat: 41.4090, lng: -75.6624, routes: ["pa_lackawanna"] }],
  },
  {
    id: "mi-macomb-four-points", covers: ["V1179284"], place: "Macomb County, MI (four spread points)",
    live: true, answeredBy: "mi_macomb", layer: /services6\.arcgis\.com\/.*Macomb_County_Parcel_Data\/FeatureServer\/10$/, pin: /\S/, distinct: true,
    points: [
      { label: "Warren (lot interior)", lat: 42.481374, lng: -83.024644, routes: ["mi_macomb"] },
      { label: "Sterling Heights (lot interior)", lat: 42.583710, lng: -83.029089, routes: ["mi_macomb"] },
      { label: "Mount Clemens (lot interior)", lat: 42.599764, lng: -82.876652, routes: ["mi_macomb"] },
      { label: "Romeo (lot interior)", lat: 42.807020, lng: -83.012857, routes: ["mi_macomb"] },
    ],
  },
  {
    id: "mo-kansas-city-one-ring", covers: ["V1179285"], place: "Kansas City, MO — one ring across Jackson/Clay/Platte",
    live: true, answeredBy: "mo_kansascity", layer: /mapd\.kcmo\.org\/kcgis\/rest\/services\/AGOL\/MapServer\/6$/, requests: 1,
    points: [
      { label: "Crown Center (Jackson)", interior: false, lat: 39.0819, lng: -94.5810, routes: ["mo_kansascity"], pin: /^JA/ },
      { label: "Northland (Clay)", interior: false, lat: 39.2400, lng: -94.5500, routes: ["mo_kansascity"], pin: /^CL/ },
      { label: "KCI airport (Platte)", interior: false, lat: 39.2976, lng: -94.7139, routes: ["mo_kansascity"], pin: /^PL/ },
      { label: "Liberty, MO (Clay, outside KC)", lat: 39.242073, lng: -94.418733, routes: ["mo_clay"], answeredBy: "mo_clay", layer: /services7\.arcgis\.com\/.*ClayCountyParcelService\/FeatureServer\/0$/, pin: /\S/, noRequestTo: ["mapd.kcmo.org"] },
    ],
  },
  {
    id: "mo-independence-vs-kc", covers: ["V1179286"], place: "Independence, MO vs Kansas City",
    live: true,
    points: [
      { label: "Independence", lat: 39.089384, lng: -94.419338, routes: ["mo_independence"], answeredBy: "mo_independence", layer: /services\.arcgis\.com\/sbDzK061dd6DNPHv\/.*COI_Parcels_2_view\/FeatureServer\/0$/, pin: /\S/, field: "Name" },
      // Ledger step 2 is a ROUTING claim ("routes to mo_kansascity, never mo_independence"); the Kansas City layer's own live answer is the mo-kansas-city-one-ring row.
      { label: "downtown Kansas City (routing only)", lat: 39.0997, lng: -94.5786, live: false, routes: ["mo_kansascity"], routesNot: ["mo_independence"] },
    ],
  },
];
