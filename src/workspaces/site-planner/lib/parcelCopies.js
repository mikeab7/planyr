/* NEW-1 (2026-10-29, owner: "use the copy, but then just state that it's a copy and state the date that it came from") —
 * RUNTIME record of every county parcel row whose publisher is NOT the county and NOT the state: a copy someone else
 * published (a consultant, a city, a regional commission, an assessor-software vendor, a university, an unconfirmed
 * ArcGIS account). The parcel card reads it to say so, with the date of the data, and to offer "Email Michael to
 * request it" (the same mailto as the no-parcel-data message, B2428112) — see `parcelCopyNotice` below.
 *
 * WHY THIS IS NOT countiesProvenance.js: that record is BUILD-TIME documentation the browser never loads (it carried
 * ~2.5 KB of prose onto the Site route's bundle once). This table is tuples only, loaded by the lazy parcel card and
 * by the Add-parcel result, never by the map.
 *
 * Shape: `county key -> [publisher, asOf]`.
 *   publisher  the short name a reader recognises; `null` = an ArcGIS Online account Planyr could not tie to the county
 *              (the provenance record's "unverified" rows and its "org hidden" rows) — the line says so plainly.
 *   asOf       "YYYY-MM" (or "YYYY" where only the roll year is known) — the layer's own last-DATA-edit date, MEASURED
 *              from the service's `editingInfo` on 2026-10-29 (or the roll date the research record states, where the
 *              layer was re-saved after the roll: Chenango 2026-06, Herkimer / Dutchess 2025-09, Nassau the 2020 roll,
 *              Fulton data 2023-01). `null` = the service publishes no date (every relayed MapServer and the
 *              utility.arcgis.com proxies) — the line says "date not published", never a guessed one.
 *
 * COVERAGE IS A RULE, NOT A LIST: `test/parcelCopies.test.js` fails when a county-verification row with publisher
 * "third-party" or "unverified" is in neither PARCEL_COPIES nor PARCEL_COPY_EXEMPT, so a newly wired copy cannot ship
 * without its line. Official county rows and statewide-layer rows are absent on purpose — they show nothing.
 * Re-measure dates with the `editingInfo` of each row's `layerUrl` (docs/STATEWIDE-PARCELS.md "Copy rows").
 */
import { COUNTIES } from "./counties.js";
import { parcelRequestHref } from "./parcelGaps.js";

export const PARCEL_COPIES = {
  // AL
  al_autauga: ["Central Alabama Regional Planning & Development Commission", "2026-06"],
  al_houston: ["City of Dothan", "2023-12"],
  al_lee: ["City of Opelika", null],
  al_madison: ["City of Madison", null],
  al_montgomery: ["Central Alabama Regional Planning & Development Commission", "2026-06"],

  // AZ
  az_pinal: ["City of Maricopa GIS", "2026-08"],

  // TX (Fort Bend)
  fortbend: [null, "2026-10"],

  // GA
  ga_appling: ["Heart of Georgia Altamaha Regional Commission", "2026-07"],
  ga_atkinson: ["Southern Georgia Regional Commission", null],
  ga_benhill: ["Southern Georgia Regional Commission", null],
  ga_bleckley: ["Heart of Georgia Altamaha Regional Commission", "2025-09"],
  ga_brooks: ["Southern Georgia Regional Commission", null],
  ga_bulloch: [null, "2024-02"],
  ga_butts: [null, "2024-09"],
  ga_camden: [null, "2021-01"],
  ga_candler: ["Heart of Georgia Altamaha Regional Commission", "2026-01"],
  ga_chattahoochee: ["River Valley Regional Commission", "2023-05"],
  ga_chattooga: ["a Georgia county appraisal contractor", "2025-09"],
  ga_coffee: ["Southern Georgia Regional Commission", null],
  ga_cook: ["Southern Georgia Regional Commission", null],
  ga_dade: ["a university research lab", "2026-06"],
  ga_dawson: ["a Georgia county appraisal contractor", "2026-03"],
  ga_decatur: [null, "2026-05"],
  ga_dodge: ["Heart of Georgia Altamaha Regional Commission", "2026-06"],
  ga_dougherty: [null, "2026-10"],
  ga_effingham: [null, "2024-10"],
  ga_elbert: ["Northeast Georgia Regional Commission", "2026-10"],
  ga_emanuel: [null, "2026-08"],
  ga_franklin: ["Georgia Association of Regional Commissions", "2023-05"],
  ga_glascock: ["a Georgia county appraisal contractor", "2026-08"],
  ga_grady: [null, "2021-03"],
  ga_harris: ["River Valley Regional Commission", "2026-04"],
  ga_hart: ["Georgia Association of Regional Commissions", "2023-04"],
  ga_houston: ["Middle Georgia Regional Commission", "2025-03"],
  ga_irwin: ["Southern Georgia Regional Commission", null],
  ga_jasper: ["Georgia Association of Regional Commissions", "2023-05"],
  ga_jeffdavis: ["a Georgia county appraisal contractor", "2026-07"],
  ga_jefferson: ["a Georgia county appraisal contractor", "2025-07"],
  ga_johnson: [null, "2026-10"],
  ga_laurens: ["a Georgia county appraisal contractor", "2025-09"],
  ga_lee: [null, "2022-07"],
  ga_lumpkin: [null, "2025-02"],
  ga_mcintosh: ["a Georgia county appraisal contractor", "2025-09"],
  ga_montgomery: ["Heart of Georgia Altamaha Regional Commission", "2023-06"],
  ga_muscogee: [null, "2019-01"],
  ga_newton: ["a University of Maryland researcher", "2022-02"],
  ga_paulding: ["a University of Maryland researcher", "2022-02"],
  ga_pierce: ["Southern Georgia Regional Commission", null],
  ga_putnam: [null, "2023-06"],
  ga_stewart: ["River Valley Regional Commission", "2022-02"],
  ga_talbot: ["River Valley Regional Commission", "2025-07"],
  ga_tattnall: ["Heart of Georgia Altamaha Regional Commission", "2026-09"],
  ga_taylor: ["a Georgia county appraisal contractor", "2025-07"],
  ga_telfair: ["a Georgia county appraisal contractor", "2025-05"],
  ga_toombs: ["Heart of Georgia Altamaha Regional Commission", "2023-06"],
  ga_treutlen: ["Heart of Georgia Altamaha Regional Commission", "2025-09"],
  ga_troup: [null, "2026-02"],
  ga_union: ["a Georgia county appraisal contractor", "2026-10"],
  ga_walker: [null, "2025-12"],
  ga_warren: [null, "2026-02"],
  ga_wayne: ["Heart of Georgia Altamaha Regional Commission", "2026-09"],
  ga_wheeler: ["Heart of Georgia Altamaha Regional Commission", "2024-08"],
  ga_white: ["Georgia Association of Regional Commissions", "2023-06"],
  ga_wilcox: ["Heart of Georgia Altamaha Regional Commission", "2025-09"],
  ga_wilkinson: [null, "2026-10"],
  ga_worth: [null, "2023-05"],

  // IA
  ia_adair: ["Schneider Geospatial", null],
  ia_benton: [null, "2024-06"],
  ia_buchanan: [null, "2026-09"],
  ia_buenavista: ["Schneider Geospatial", null],
  ia_butler: ["Schneider Geospatial", "2026-06"],
  ia_cass: ["Schneider Geospatial", null],
  ia_cedar: [null, "2023-03"],
  ia_chickasaw: ["Schneider Geospatial", null],
  ia_clayton: [null, "2025-04"],
  ia_clinton: ["Schneider Geospatial", null],
  ia_crawford: ["Schneider Geospatial", "2026-03"],
  ia_decatur: ["Schneider Geospatial", "2026-06"],
  ia_delaware: [null, "2021-07"],
  ia_dickinson: ["Iowa Great Lakes Sanitary District", "2026-01"],
  ia_franklin: ["Schneider Geospatial", null],
  ia_guthrie: ["Schneider Geospatial", null],
  ia_hamilton: ["Schneider Geospatial", null],
  ia_hardin: ["Schneider Geospatial", null],
  ia_harrison: ["Schneider Geospatial", null],
  ia_humboldt: ["Schneider Geospatial", null],
  ia_iowa: ["Schneider Geospatial", null],
  ia_jasper: ["Schneider Geospatial", null],
  ia_jefferson: ["Schneider Geospatial", null],
  ia_kossuth: ["Schneider Geospatial", "2026-10"],
  ia_louisa: ["Schneider Geospatial", null],
  ia_lyon: ["Schneider Geospatial", null],
  ia_mahaska: ["Schneider Geospatial", null],
  ia_marshall: ["City of Le Grand", "2020-12"],
  ia_mills: [null, "2020-05"],
  ia_mitchell: ["Schneider Geospatial", "2026-07"],
  ia_monona: ["Schneider Geospatial", "2026-03"],
  ia_osceola: ["Schneider Geospatial", null],
  ia_wapello: ["Schneider Geospatial", null],
  ia_warren: [null, "2026-10"],
  ia_wayne: ["City of Corydon", "2023-01"],
  ia_webster: ["Schneider Geospatial", null],
  ia_winnebago: ["Schneider Geospatial", null],
  ia_worth: ["Schneider Geospatial", null],
  ia_wright: ["Schneider Geospatial", null],

  // IL
  il_bond: [null, "2026-10"],
  il_bureau: ["The Sidwell Company", "2024-07"],
  il_clay: ["The Sidwell Company", "2024-02"],
  il_clinton: [null, "2025-02"],
  il_coles: [null, null],
  il_dekalb: [null, "2026-10"],
  il_dewitt: ["The Sidwell Company", "2026-10"],
  il_douglas: [null, "2026-08"],
  il_effingham: ["City of Effingham", "2026-10"],
  il_fayette: ["The Sidwell Company", "2024-03"],
  il_fulton: [null, "2024-05"],
  il_greene: ["Western Illinois University GIS Center", "2016-12"],
  il_hamilton: [null, "2026-09"],
  il_hancock: [null, "2026-07"],
  il_henderson: ["Western Illinois University GIS Center", null],
  il_henry: ["The Sidwell Company", "2026-10"],
  il_iroquois: [null, "2026-09"],
  il_jackson: [null, "2025-03"],
  il_jefferson: ["The Sidwell Company", "2026-10"],
  il_johnson: [null, "2026-02"],
  il_knox: [null, null],
  il_lawrence: [null, "2026-10"],
  il_logan: ["Tri-County Regional Planning", "2026-10"],
  il_marion: [null, "2026-10"],
  il_marshall: ["The Sidwell Company", "2026-10"],
  il_mcdonough: ["Western Illinois University GIS Center", null],
  il_mercer: [null, "2023-09"],
  il_moultrie: [null, null],
  il_randolph: [null, "2026-10"],
  il_schuyler: [null, "2026-05"],
  il_stark: [null, "2025-12"],
  il_union: ["DEVNET Incorporated", "2021-04"],
  il_washington: ["DEVNET Incorporated", "2026-01"],
  il_white: ["The Sidwell Company", "2026-10"],
  il_winnebago: ["City of Rockford GIS", null],
  il_woodford: [null, "2026-10"],

  // KS
  ks_lane: ["Tyler Technologies", null],
  ks_meade: ["Tyler Technologies", null],
  ks_scott: ["Tyler Technologies", null],
  ks_seward: ["City of Liberal", "2023-12"],

  // KY
  ky_bourbon: [null, "2024-09"],
  ky_boyd: [null, "2026-06"],
  ky_breathitt: [null, "2023-05"],
  ky_bullitt: [null, "2026-10"],
  ky_franklin: [null, "2019-01"],
  ky_todd: [null, "2026-06"],

  // LA
  la_allen: ["DesireLine LLC", "2023-01"],
  la_ascension: ["Westwood (CSRS)", "2026-06"],
  la_assumption: ["Westwood (CSRS)", "2026-05"],
  la_bossier: ["Northwest Louisiana Council of Governments", null],
  la_caddo: ["Northwest Louisiana Council of Governments", null],
  la_cameron: [null, "2023-03"],
  la_claiborne: ["1803 Electric Cooperative", "2025-12"],
  la_iberville: ["Westwood (CSRS)", "2026-06"],
  la_lafayette: ["ES2", "2025-12"],
  la_lafourche: ["North Lafourche Conservation, Levee & Drainage District", "2024-01"],
  la_natchitoches: [null, "2023-04"],
  la_ouachita: ["City of Monroe", "2026-02"],
  la_plaquemines: ["Westwood (CSRS)", "2026-06"],
  la_richland: ["1803 Electric Cooperative", "2025-12"],
  la_stbernard: ["Westwood (CSRS)", "2026-06"],
  la_stcharles: ["Westwood (CSRS)", "2026-06"],
  la_stjames: ["Westwood (CSRS)", "2026-06"],
  la_stjohnthebaptist: ["Westwood (CSRS)", "2026-06"],
  la_stmartin: ["Westwood (CSRS)", "2026-05"],
  la_stmary: ["St. Mary Parish levee district", null],
  la_tangipahoa: ["DesireLine LLC", "2026-09"],
  la_terrebonne: ["DesireLine LLC", "2026-03"],
  la_webster: ["Northwest Louisiana Council of Governments", null],
  la_westcarroll: ["1803 Electric Cooperative", "2025-12"],

  // MI
  mi_benzie: [null, "2026-09"],
  mi_berrien: [null, "2024-11"],
  mi_branch: [null, "2024-06"],
  mi_clinton: ["Tri-County Regional Planning", "2026-10"],
  mi_detroit: ["SmithGroup", "2025-06"],
  mi_gladwin: ["Spicer Group", "2026-04"],
  mi_gratiot: [null, "2024-10"],
  mi_hillsdale: [null, "2024-10"],
  mi_huron: [null, "2025-04"],
  mi_isabella: ["HDR Inc.", "2026-10"],
  mi_lapeer: [null, "2024-12"],
  mi_mackinac: ["Northrop Assessing", "2026-08"],
  mi_macomb: [null, "2026-10"],
  mi_marquette: ["a land-owner-classification project (ArcGIS Online)", "2024-05"],
  mi_mecosta: ["HDR Inc.", "2026-10"],
  mi_muskegon: ["Spatial Data Logic", "2025-03"],
  mi_sanilac: ["a Sanilac / St. Clair drain-district project", "2024-04"],
  mi_shiawassee: ["PEA, Inc.", "2026-08"],
  mi_stjoseph: [null, "2026-05"],
  mi_vanburen: [null, "2026-06"],

  // MO
  mo_platte: ["City of Parkville", "2026-09"],
  mo_taney: ["Taney County Regional Sewer District", "2026-10"],

  // MS
  ms_desoto: ["ETR Business Development / Tristate Consulting", "2024-06"],

  // NM
  nm_bernalillo: ["City of Albuquerque AGIS", "2026-08"],
  nm_cibola: ["Magnasoft", "2026-10"],
  nm_colfax: ["Magnasoft", "2026-05"],
  nm_eddy: ["the county's GIS vendor", "2026-08"],

  // NY
  ny_chenango: ["LaBella Associates", "2026-06"],
  ny_dutchess: [null, "2025-09"],
  ny_fulton: ["NYS Department of State (Mohawk River watershed layer)", "2023-01"],
  ny_herkimer: ["Byer Planning LLC", "2025-09"],
  ny_nassau: ["Peconic Land Trust", "2020"],

  // OK
  ok_oklahoma: [null, "2026-10"],

  // OR
  or_lake: ["Klamath County GIS", "2021-07"],
  or_union: ["a shared eastern-Oregon county GIS org", "2022-09"],

  // PA
  pa_armstrong: [null, "2026-10"],
  pa_fayette: [null, "2023-09"],
  pa_jefferson: ["North Central Pennsylvania regional planning commission", "2025-12"],
  pa_lehigh: [null, "2026-10"],
  pa_somerset: [null, "2026-10"],

  // SC
  sc_greenville: [null, "2024-09"],

  // TN
  tn_montgomery: ["City of Clarksville", "2025-11"],

  // WA
  wa_adams: ["SCJ Alliance", "2025-10"],
  wa_graysharbor: [null, "2024-07"],
  wa_klickitat: ["Mt. Adams Resource Stewards", "2026-09"],
};

/* Rows the provenance record calls "third-party" that a STATE AGENCY publishes — official under the owner's rule
 * ("copy = not the county's and not the state's"), so no line. Each carries the reason, so the exemption is a decision
 * on the record and not a gap. (NYS Dept. of State's Fulton layer is NOT here: the owner named Fulton as a copy.) */
export const PARCEL_COPY_EXEMPT = {
  ks_anderson: "Kansas DASC (state GIS) statewide ORKA layer — published by the state",
  ks_cheyenne: "Kansas DASC (state GIS) statewide ORKA layer — published by the state",
  ks_rawlins: "Kansas DASC (state GIS) statewide ORKA layer — published by the state",
  ks_sherman: "Kansas DASC (state GIS) statewide ORKA layer — published by the state",
  ks_thomas: "Kansas DASC (state GIS) statewide ORKA layer — published by the state",
  or_curry: "Oregon Water Resources Department tax-lot query — published by the state",
  or_jefferson: "Oregon Water Resources Department tax-lot query — published by the state",
  or_lincoln: "Oregon Water Resources Department tax-lot query — published by the state",
  pa_clearfield: "PA Department of Environmental Protection PA_Parcels layer — published by the state",
  pa_elk: "PA Department of Environmental Protection PA_Parcels layer — published by the state",
  pa_northumberland: "PA Department of Environmental Protection PA_Parcels layer — published by the state",
  pa_westmoreland: "PA Department of Environmental Protection PA_Parcels layer — published by the state",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* "2026-06" → "June 2026"; "2020" → "2020"; null / anything unreadable → null (never a guessed date). */
export function formatCopyAsOf(asOf) {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(String(asOf || ""));
  if (!m) return null;
  if (!m[2]) return m[1];
  const mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${MONTHS[mo - 1]} ${m[1]}` : null;
}

/* The copy record for a county key, or null for an official county / statewide row (which show nothing new). */
export function parcelCopyOf(countyKey) {
  const e = countyKey && Object.prototype.hasOwnProperty.call(PARCEL_COPIES, countyKey) ? PARCEL_COPIES[countyKey] : null;
  return e ? { publisher: e[0], asOf: e[1] } : null;
}

/* "Chenango County, NY" → { name: "Chenango County", state: "NY" } from the county row's own label (one source for the name). */
function countyNameOf(countyKey) {
  const c = COUNTIES[countyKey];
  const label = String((c && c.label) || "").trim();
  const m = /^(.*?),\s*([A-Z]{2})$/.exec(label);
  return m ? { name: m[1], state: m[2] } : { name: label || "this county", state: (c && c.state) || "" };
}

/* The one plain sentence the card carries. A named publisher is stated as such; an account Planyr could not tie to the county
 * says that instead and only claims "may not be the county's own" (we do not know it is not). No date → "date not published". */
export function parcelCopyLine({ name, publisher, asOf }) {
  const when = formatCopyAsOf(asOf);
  const dated = when ? `, as of ${when}` : " (date not published)";
  if (publisher) return `Copy of ${name} parcel data published by ${publisher}${dated} — not the county’s own.`;
  return `Copy of ${name} parcel data from an ArcGIS account Planyr couldn’t tie to the county${dated} — may not be the county’s own.`;
}

export const PARCEL_COPY_ASK = "Need the county’s official or newer data?";

/* → { line, ask, href, publisher, asOf, county, state } for a copy county, or null (official rows render nothing).
 * `point` ({lat, lng}) is the clicked point, carried into the email like the no-data message does. */
export function parcelCopyNotice(countyKey, point) {
  const copy = parcelCopyOf(countyKey);
  if (!copy) return null;
  const { name, state } = countyNameOf(countyKey);
  const line = parcelCopyLine({ name, publisher: copy.publisher, asOf: copy.asOf });
  const href = parcelRequestHref({ name, state, sentence: line, lat: point && point.lat, lng: point && point.lng, sentenceLabel: "Data shown" });
  return { line, ask: PARCEL_COPY_ASK, href, publisher: copy.publisher, asOf: copy.asOf, county: name, state };
}
