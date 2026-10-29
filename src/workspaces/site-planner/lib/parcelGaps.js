/* WHY A COUNTY HAS NO PARCEL DATA IN PLANYR — and the one-click way to ask for it (NEW-1, owner request 2026-10-21:
 * "for counties that aren't wired up, I'd like it to provide info to people when it doesn't work — like either 'email Michael'
 * or 'this county has parcel data hidden behind a paywall, email Michael to request'").
 *
 * Before this, clicking a lot in a county with no wired source printed the bare sentence "<County> — no parcel data wired here
 * yet." It said nothing about WHY and gave the person nothing to do. Now every such state reads one of four plain-words
 * reasons and carries an "Email Michael to request it" link.
 *
 * ONE SOURCE OF TRUTH. This table is the runtime answer; `counties.js` `noParcelSourceNote` and every call site read it through
 * `parcelGapNotice` below — nothing parses markdown at runtime. docs/STATEWIDE-PARCELS.md stays the research record (what was
 * searched, why), and `test/parcelGapsDoc.test.js` fails the build when a doc gap row has no entry here, when a doc row that says
 * login / token / relay-TLS is filed under "none", or when an entry here names a county that has since been wired. Wiring a county
 * means deleting its row here in the same commit.
 *
 * THE FOUR REASONS (a county with NO entry is "none" — the default for every county nobody has researched yet):
 *   paywall     — the county or its vendor SELLS the parcel map or keeps it behind a paid subscription / a login the public cannot
 *                 get (Kentucky qPublic "Access Restricted" pages, Equator Studios paid-download portals, lapsed vendor
 *                 subscriptions such as Georgia's token walls).
 *   locked      — a parcel layer exists but the publisher has not opened it to the public (Token Required, vendor sign-in,
 *                 a viewer that injects its own key). Planyr never replays or harvests a key.
 *   unreachable — a real county server that Planyr could not reach (down, timing out, rejected certificate).
 *   none        — nothing usable was found (also the owner-accepted gaps: Fulton KY, New Madrid and Pemiscot MO).
 * Where a county fits two, the reason a person would find most useful wins: paywall if the map itself is behind a login.
 *
 * KEYS are the county routing-key style (`<st>_<slug>`, Texas bare) built from the SAME `countyNameSlug` that `countyKeyForName`
 * uses, so a gap row is keyed exactly as the wired county it would become. VALUES are `[reason, internalNote?]` — the note is for
 * the next reader of this file and is never shown.
 *
 * ⛔ michael@planyr.io is public in exactly TWO places: the signed note on the landing page and the request link built here
 * (owner-requested 2026-10-21). `test/publicContactAddresses.test.js` names this file as the one exception — do not add a third.
 *
 * Pure — no DOM, no React. */
import { countyNameSlug } from "../../../shared/gis/countyKeys.js";

export const GAP_REASONS = Object.freeze(["paywall", "locked", "unreachable", "none"]);
export const PARCEL_REQUEST_EMAIL = "michael@planyr.io";

export const PARCEL_GAPS = Object.freeze({
  // Kentucky
  ky_adair: ["paywall", "qPublic map is subscriber-only"],
  ky_ballard: ["paywall", "qPublic map is subscriber-only"],
  ky_bath: ["paywall", "qPublic map is subscriber-only"],
  ky_bell: ["locked", "map viewable, parcel feed private"],
  ky_boyle: ["unreachable", "county layer has no parcel id; BGADD server unreachable"],
  ky_bracken: ["paywall", "qPublic map is subscriber-only"],
  ky_breckinridge: ["locked", "map viewable, parcel feed private"],
  ky_butler: ["paywall", "qPublic map is subscriber-only"],
  ky_caldwell: ["paywall", "qPublic map is subscriber-only"],
  ky_calloway: ["paywall", "qPublic map is subscriber-only"],
  ky_carlisle: ["paywall", "qPublic map is subscriber-only"],
  ky_carroll: ["paywall", "qPublic map is subscriber-only"],
  ky_carter: ["paywall", "qPublic map is subscriber-only"],
  ky_casey: ["paywall", "qPublic map is subscriber-only"],
  ky_christian: ["paywall", "qPublic map is subscriber-only"],
  ky_clark: ["unreachable", "county server times out through the relay"],
  ky_clay: ["paywall", "qPublic map is subscriber-only"],
  ky_clinton: ["paywall", "qPublic map is subscriber-only"],
  ky_crittenden: ["paywall", "qPublic map is subscriber-only"],
  ky_cumberland: ["locked", "map viewable, parcel feed private"],
  ky_edmonson: ["paywall", "qPublic map is subscriber-only"],
  ky_elliott: ["paywall", "qPublic map is subscriber-only"],
  ky_estill: ["paywall", "qPublic map is subscriber-only"],
  ky_fleming: ["paywall", "qPublic map is subscriber-only"],
  ky_floyd: ["paywall", "qPublic map is subscriber-only"],
  ky_fulton: ["none"],
  ky_gallatin: ["paywall", "qPublic map is subscriber-only"],
  ky_garrard: ["paywall", "qPublic map is subscriber-only"],
  ky_grant: ["paywall", "qPublic map is subscriber-only"],
  ky_graves: ["paywall", "qPublic map is subscriber-only"],
  ky_grayson: ["locked", "map viewable, parcel feed private"],
  ky_green: ["paywall", "qPublic map is subscriber-only"],
  ky_greenup: ["paywall", "qPublic map is subscriber-only"],
  ky_hancock: ["paywall", "qPublic map is subscriber-only"],
  ky_harlan: ["paywall", "qPublic map is subscriber-only"],
  ky_harrison: ["paywall", "qPublic map is subscriber-only"],
  ky_hart: ["locked", "map viewable, parcel feed private"],
  ky_hickman: ["locked", "map viewable, parcel feed private"],
  ky_jackson: ["paywall", "qPublic map is subscriber-only"],
  ky_johnson: ["paywall", "qPublic map is subscriber-only"],
  ky_knott: ["paywall", "qPublic map is subscriber-only"],
  ky_knox: ["paywall", "qPublic map is subscriber-only"],
  ky_larue: ["paywall", "qPublic map is subscriber-only"],
  ky_laurel: ["locked", "map viewable, parcel feed private"],
  ky_lawrence: ["paywall", "Equator sells the downloads"],
  ky_lee: ["paywall", "qPublic map is subscriber-only"],
  ky_leslie: ["paywall", "qPublic map is subscriber-only"],
  ky_letcher: ["locked", "map viewable, parcel feed private"],
  ky_lewis: ["paywall", "qPublic map is subscriber-only"],
  ky_lincoln: ["paywall", "qPublic map is subscriber-only"],
  ky_livingston: ["paywall", "qPublic map is subscriber-only"],
  ky_logan: ["paywall", "qPublic map is subscriber-only"],
  ky_lyon: ["paywall", "qPublic map is subscriber-only"],
  ky_magoffin: ["none"],
  ky_marion: ["paywall", "qPublic map is subscriber-only"],
  ky_marshall: ["paywall", "qPublic map is subscriber-only"],
  ky_martin: ["none"],
  ky_mason: ["paywall", "qPublic map is subscriber-only"],
  ky_mccreary: ["paywall", "qPublic map is subscriber-only"],
  ky_mclean: ["paywall", "qPublic map is subscriber-only"],
  ky_menifee: ["none"],
  ky_metcalfe: ["locked", "map viewable, parcel feed private"],
  ky_monroe: ["locked", "map viewable, parcel feed private"],
  ky_morgan: ["paywall", "qPublic map is subscriber-only"],
  ky_muhlenberg: ["paywall", "qPublic map is subscriber-only"],
  ky_nelson: ["paywall", "qPublic map is subscriber-only"],
  ky_nicholas: ["paywall", "qPublic map is subscriber-only"],
  ky_ohio: ["paywall", "qPublic map is subscriber-only"],
  ky_owen: ["paywall", "qPublic map is subscriber-only"],
  ky_owsley: ["paywall", "qPublic map is subscriber-only"],
  ky_perry: ["paywall", "qPublic map is subscriber-only"],
  ky_pike: ["paywall", "Equator sells the downloads"],
  ky_powell: ["locked", "map viewable, parcel feed private"],
  ky_robertson: ["none"],
  ky_rockcastle: ["paywall", "qPublic map is subscriber-only"],
  ky_russell: ["paywall", "qPublic map is subscriber-only"],
  ky_taylor: ["paywall", "qPublic map is subscriber-only"],
  ky_trigg: ["paywall", "qPublic map is subscriber-only"],
  ky_union: ["paywall", "qPublic map is subscriber-only"],
  ky_washington: ["paywall", "qPublic map is subscriber-only"],
  ky_wayne: ["paywall", "qPublic map is subscriber-only"],
  ky_whitley: ["locked", "map viewable, parcel feed private"],
  ky_wolfe: ["none"],
  // Georgia
  ga_bacon: ["none"],
  ga_baker: ["none"],
  ga_banks: ["none"],
  ga_berrien: ["none"],
  ga_burke: ["none"],
  ga_calhoun: ["none"],
  ga_carroll: ["none"],
  ga_catoosa: ["none"],
  ga_clinch: ["none"],
  ga_colquitt: ["none"],
  ga_early: ["none"],
  ga_fannin: ["none"],
  ga_gilmer: ["none"],
  ga_habersham: ["none"],
  ga_hancock: ["none"],
  ga_haralson: ["none"],
  ga_heard: ["none"],
  ga_jenkins: ["none"],
  ga_jones: ["none"],
  ga_lamar: ["none"],
  ga_lincoln: ["none"],
  ga_long: ["none"],
  ga_macon: ["none"],
  ga_madison: ["none"],
  ga_marion: ["none"],
  ga_mcduffie: ["none"],
  ga_miller: ["none"],
  ga_mitchell: ["none"],
  ga_murray: ["none"],
  ga_oglethorpe: ["paywall", "token wall = lapsed vendor subscription (2026-10-21 review)"],
  ga_pickens: ["none"],
  ga_pike: ["none"],
  ga_polk: ["none"],
  ga_pulaski: ["none"],
  ga_quitman: ["none"],
  ga_rabun: ["none"],
  ga_randolph: ["none"],
  ga_schley: ["none"],
  ga_seminole: ["none"],
  ga_stephens: ["none"],
  ga_taliaferro: ["none"],
  ga_terrell: ["none"],
  ga_towns: ["none"],
  ga_upson: ["paywall", "token wall = lapsed vendor subscription (2026-10-21 review)"],
  ga_walton: ["paywall", "token wall = lapsed vendor subscription (2026-10-21 review)"],
  ga_washington: ["none"],
  ga_webster: ["none"],
  ga_wilkes: ["none"],
  // Iowa
  ia_adams: ["none"],
  ia_allamakee: ["none"],
  ia_appanoose: ["none"],
  ia_audubon: ["none"],
  ia_calhoun: ["none"],
  ia_carroll: ["none"],
  ia_cherokee: ["none"],
  ia_clarke: ["none"],
  ia_clay: ["none"],
  ia_davis: ["none"],
  ia_desmoines: ["none"],
  ia_dubuque: ["unreachable", "county host fails from the relay"],
  ia_emmet: ["none"],
  ia_fayette: ["none"],
  ia_fremont: ["none"],
  ia_greene: ["none"],
  ia_hancock: ["none"],
  ia_henry: ["none"],
  ia_howard: ["none"],
  ia_ida: ["none"],
  ia_jackson: ["none"],
  ia_jones: ["none"],
  ia_keokuk: ["none"],
  ia_lucas: ["none"],
  ia_madison: ["none"],
  ia_marion: ["none"],
  ia_monroe: ["none"],
  ia_montgomery: ["none"],
  ia_obrien: ["none"],
  ia_page: ["none"],
  ia_paloalto: ["none"],
  ia_plymouth: ["none"],
  ia_pocahontas: ["none"],
  ia_poweshiek: ["none"],
  ia_ringgold: ["none"],
  ia_sac: ["none"],
  ia_shelby: ["none"],
  ia_sioux: ["paywall", "viewer is an Equator Studios storefront"],
  ia_tama: ["none"],
  ia_taylor: ["locked", "Integrity GIS login-gated"],
  ia_union: ["none"],
  ia_vanburen: ["none"],
  ia_washington: ["none"],
  // Michigan
  mi_alcona: ["none"],
  mi_alger: ["none"],
  mi_alpena: ["none"],
  mi_baraga: ["locked", "vendor sign-in / secured proxy"],
  mi_calhoun: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_chippewa: ["none"],
  mi_clare: ["none"],
  mi_crawford: ["none"],
  mi_delta: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_dickinson: ["locked", "vendor sign-in / secured proxy"],
  mi_gogebic: ["locked", "vendor sign-in / secured proxy"],
  mi_houghton: ["none"],
  mi_iosco: ["none"],
  mi_iron: ["none"],
  mi_kalkaska: ["locked", "vendor sign-in / secured proxy"],
  mi_keweenaw: ["locked", "vendor sign-in / secured proxy"],
  mi_livingston: ["locked", "vendor sign-in / secured proxy"],
  mi_luce: ["none"],
  mi_menominee: ["none"],
  mi_missaukee: ["none"],
  mi_montmorency: ["none"],
  mi_ogemaw: ["none"],
  mi_ontonagon: ["locked", "vendor sign-in / secured proxy"],
  mi_oscoda: ["none"],
  mi_otsego: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_presqueisle: ["none"],
  mi_schoolcraft: ["none"],
  mi_washtenaw: ["none"],
  mi_wexford: ["none"],
  // Missouri
  mo_butler: ["locked", "viewer injects its own key (Token Required)"],
  mo_caldwell: ["locked", "Integrity GIS login-gated"],
  mo_carroll: ["none"],
  mo_carter: ["locked", "Integrity GIS login-gated"],
  mo_cass: ["none"],
  mo_clark: ["none"],
  mo_clinton: ["none"],
  mo_crawford: ["none"],
  mo_daviess: ["locked", "Integrity GIS login-gated"],
  mo_dent: ["none"],
  mo_dunklin: ["locked", "viewer injects its own key (Token Required)"],
  mo_franklin: ["none"],
  mo_gentry: ["locked", "Integrity GIS login-gated"],
  mo_harrison: ["locked", "Integrity GIS login-gated"],
  mo_hickory: ["none"],
  mo_howard: ["locked", "Integrity GIS login-gated"],
  mo_howell: ["none"],
  mo_knox: ["none"],
  mo_lewis: ["none"],
  mo_linn: ["locked", "Integrity GIS login-gated"],
  mo_mercer: ["none"],
  mo_mississippi: ["locked", "Integrity GIS login-gated"],
  mo_monroe: ["none"],
  mo_montgomery: ["locked", "Integrity GIS login-gated"],
  mo_newmadrid: ["none"],
  mo_nodaway: ["locked", "Integrity GIS login-gated"],
  mo_oregon: ["locked", "Integrity GIS login-gated"],
  mo_ozark: ["none"],
  mo_pemiscot: ["none"],
  mo_pettis: ["none"],
  mo_pike: ["none"],
  mo_randolph: ["none"],
  mo_reynolds: ["none"],
  mo_ripley: ["locked", "viewer injects its own key (Token Required)"],
  mo_schuyler: ["none"],
  mo_scotland: ["none"],
  mo_shannon: ["none"],
  mo_shelby: ["none"],
  mo_stegenevieve: ["locked", "Integrity GIS login-gated"],
  mo_stoddard: ["none"],
  mo_sullivan: ["locked", "Integrity GIS login-gated"],
  mo_texas: ["none"],
  // Washington
  wa_columbia: ["none"],
  wa_ferry: ["locked", "Token Required"],
  wa_garfield: ["none"],
  wa_okanogan: ["none"],
  wa_pacific: ["none"],
  // Oregon
  or_polk: ["unreachable", "county ArcGIS server down (HTTP 500)"],
  or_sherman: ["none"],
  or_wallowa: ["none"],
  // Oklahoma
  ok_adair: ["none"],
  ok_alfalfa: ["none"],
  ok_atoka: ["none"],
  ok_beaver: ["none"],
  ok_blaine: ["none"],
  ok_bryan: ["none"],
  ok_caddo: ["none"],
  ok_carter: ["none"],
  ok_cherokee: ["none"],
  ok_choctaw: ["none"],
  ok_cimarron: ["none"],
  ok_coal: ["none"],
  ok_cotton: ["none"],
  ok_craig: ["none"],
  ok_custer: ["none"],
  ok_delaware: ["none"],
  ok_dewey: ["none"],
  ok_ellis: ["none"],
  ok_garvin: ["none"],
  ok_grady: ["none"],
  ok_grant: ["none"],
  ok_greer: ["none"],
  ok_harmon: ["none"],
  ok_harper: ["none"],
  ok_haskell: ["none"],
  ok_hughes: ["none"],
  ok_jackson: ["none"],
  ok_jefferson: ["none"],
  ok_johnston: ["none"],
  ok_kay: ["none"],
  ok_kingfisher: ["none"],
  ok_kiowa: ["none"],
  ok_latimer: ["none"],
  ok_leflore: ["none"],
  ok_lincoln: ["none"],
  ok_logan: ["none"],
  ok_love: ["none"],
  ok_major: ["none"],
  ok_marshall: ["none"],
  ok_mayes: ["none"],
  ok_mccurtain: ["none"],
  ok_mcintosh: ["none"],
  ok_murray: ["none"],
  ok_noble: ["none"],
  ok_nowata: ["none"],
  ok_okfuskee: ["none"],
  ok_okmulgee: ["none"],
  ok_osage: ["none"],
  ok_pawnee: ["none"],
  ok_pontotoc: ["none"],
  ok_pottawatomie: ["none"],
  ok_pushmataha: ["none"],
  ok_rogermills: ["none"],
  ok_seminole: ["none"],
  ok_sequoyah: ["none"],
  ok_stephens: ["none"],
  ok_texas: ["none"],
  ok_tillman: ["none"],
  ok_washita: ["none"],
  ok_woods: ["none"],
  ok_woodward: ["none"],
  // Kansas
  ks_allen: ["none"],
  ks_barton: ["none"],
  ks_bourbon: ["none"],
  ks_brown: ["none"],
  ks_chase: ["none"],
  ks_chautauqua: ["none"],
  ks_clay: ["none"],
  ks_comanche: ["none"],
  ks_crawford: ["none"],
  ks_decatur: ["none"],
  ks_edwards: ["none"],
  ks_gove: ["none"],
  ks_graham: ["locked", "login / Token Required"],
  ks_grant: ["none"],
  ks_gray: ["none"],
  ks_greeley: ["none"],
  ks_greenwood: ["none"],
  ks_hamilton: ["locked", "login / Token Required"],
  ks_haskell: ["none"],
  ks_hodgeman: ["none"],
  ks_jackson: ["none"],
  ks_jewell: ["none"],
  ks_johnson: ["locked", "login / Token Required"],
  ks_kearny: ["none"],
  ks_kingman: ["none"],
  ks_kiowa: ["none"],
  ks_lincoln: ["none"],
  ks_linn: ["locked", "login / Token Required"],
  ks_marion: ["none"],
  ks_marshall: ["none"],
  ks_miami: ["none"],
  ks_mitchell: ["none"],
  ks_morris: ["none"],
  ks_morton: ["none"],
  ks_neosho: ["none"],
  ks_ness: ["locked", "login / Token Required"],
  ks_norton: ["none"],
  ks_osborne: ["none"],
  ks_ottawa: ["none"],
  ks_phillips: ["none"],
  ks_pratt: ["none"],
  ks_rice: ["none"],
  ks_rooks: ["none"],
  ks_rush: ["locked", "login / Token Required"],
  ks_sheridan: ["none"],
  ks_smith: ["none"],
  ks_stanton: ["none"],
  ks_stevens: ["none"],
  ks_trego: ["none"],
  ks_wabaunsee: ["none"],
  ks_wallace: ["none"],
  ks_washington: ["none"],
  ks_wichita: ["none"],
  ks_wilson: ["none"],
  ks_woodson: ["locked", "login / Token Required"],
  // Illinois
  il_alexander: ["none"],
  il_calhoun: ["none"],
  il_carroll: ["locked", "Token Required"],
  il_cass: ["none"],
  il_champaign: ["none"],
  il_clark: ["none"],
  il_crawford: ["none"],
  il_edgar: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_ford: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_gallatin: ["none"],
  il_hardin: ["none"],
  il_jasper: ["none"],
  il_jersey: ["none"],
  il_jodaviess: ["paywall", "parcels sit in the county's paid subscription portal"],
  il_lee: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_livingston: ["locked", "Token Required"],
  il_macoupin: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_mason: ["none"],
  il_massac: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_menard: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_montgomery: ["none"],
  il_ogle: ["none"],
  il_perry: ["locked", "Token Required"],
  il_piatt: ["none"],
  il_pike: ["none"],
  il_pope: ["none"],
  il_pulaski: ["none"],
  il_richland: ["none"],
  il_saline: ["none"],
  il_scott: ["none"],
  il_shelby: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_stephenson: ["none"],
  il_vermilion: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_wabash: ["none"],
  il_warren: ["none"],
  il_williamson: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  // Louisiana
  la_beauregard: ["locked", "actDataScout / token / login"],
  la_caldwell: ["locked", "actDataScout / token / login"],
  la_concordia: ["locked", "actDataScout / token / login"],
  la_eastcarroll: ["locked", "actDataScout / token / login"],
  la_jackson: ["locked", "actDataScout / token / login"],
  la_morehouse: ["locked", "actDataScout / token / login"],
  la_redriver: ["locked", "actDataScout / token / login"],
  la_sabine: ["locked", "actDataScout / token / login"],
  la_union: ["locked", "actDataScout / token / login"],
  la_bienville: ["none"],
  la_rapides: ["locked", "actDataScout / token / login"],
  la_evangeline: ["locked", "actDataScout / token / login"],
  la_grant: ["locked", "actDataScout / token / login"],
  la_lincoln: ["locked", "actDataScout / token / login"],
  la_avoyelles: ["locked", "actDataScout / token / login"],
  la_catahoula: ["locked", "actDataScout / token / login"],
  la_vernon: ["locked", "actDataScout / token / login"],
  la_winn: ["locked", "actDataScout / token / login"],
  la_iberia: ["none"],
  la_lasalle: ["locked", "actDataScout / token / login"],
  la_pointecoupee: ["locked", "actDataScout / token / login"],
  la_vermilion: ["none"],
  la_franklin: ["none"],
  la_madison: ["none"],
  la_sthelena: ["none"],
  la_tensas: ["none"],
  // Idaho
  id_benewah: ["locked", "403 permissions on the Tax Commission services"],
  id_caribou: ["locked", "403 permissions on the Tax Commission services"],
  id_cassia: ["locked", "403 permissions on the Tax Commission services"],
  id_gem: ["locked", "403 permissions on the Tax Commission services"],
  id_lemhi: ["locked", "403 permissions on the Tax Commission services"],
  id_payette: ["locked", "403 permissions on the Tax Commission services"],
  id_power: ["locked", "403 permissions on the Tax Commission services"],
  id_twinfalls: ["locked", "403 permissions on the Tax Commission services"],
  id_clark: ["none"],
  id_custer: ["none"],
  // New York — (Niagara was a gap until 2026-10-28: its server had moved, now wired as ny_niagara)
  // Tennessee
  tn_knox: ["locked", "KGIS REST directory answers 401"],
});

/* The table key for a county: "Pike County" + "KY" → "ky_pike" (Texas bare, like the wired keys). Null with no name or state. */
export function gapKey(name, state) {
  const slug = countyNameSlug(name);
  const st = String(state || "").toUpperCase();
  if (!slug || !st) return null;
  return st === "TX" ? slug : `${st.toLowerCase()}_${slug}`;
}

/* Why this county has no parcel data — one of GAP_REASONS; "none" for any county with no recorded reason. */
export function gapReasonFor(name, state) {
  const k = gapKey(name, state);
  const e = k && Object.prototype.hasOwnProperty.call(PARCEL_GAPS, k) ? PARCEL_GAPS[k] : null;
  return e ? e[0] : "none";
}

/* The name a sentence uses. The nationwide geometry carries its own designation ("Pike County", "Orleans Parish"); Texas's and
 * Colorado's boundary sources publish BARE names ("Harris", "Mesa"), which need " County" to read as prose. */
export function gapDisplayName(identity) {
  const nm = String((identity && identity.name) || "").trim();
  return identity && (identity.state === "TX" || identity.state === "CO") ? `${nm} County` : nm;
}

/* The one-sentence plain-words reason (PANEL-BREVITY: one short sentence, the county name is the fact). */
export function gapSentence(reason, name) {
  switch (reason) {
    case "paywall": return `${name} keeps its parcel map behind a paid subscription, so Planyr can't show lots here yet.`;
    case "locked": return `${name} has a parcel map, but it isn't open to the public, so Planyr can't show lots here yet.`;
    case "unreachable": return `${name}'s parcel map server isn't reachable from Planyr right now.`;
    default: return `Planyr hasn't found a public parcel map it can use for ${name}.`;
  }
}

/* encodeURIComponent leaves ' ! ( ) * bare; a county or a sentence carries apostrophes ("O'Brien", "isn't"), and a mail client or an
 * HTML attribute should never have to guess — escape those too. */
const enc = (v) => encodeURIComponent(v).replace(/['!()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

/* The "Email Michael to request it" link: a prefilled mailto. Subject names the county + state; the body names them, the
 * sentence the person was shown, the clicked point when there is one, and leaves an empty line for their own note. */
export function parcelRequestHref({ name, state, sentence, lat, lng, sentenceLabel = "Reason shown" }) {
  const where = `${name}, ${state}`;
  const lines = [`County: ${where}`, `${sentenceLabel}: ${sentence}`];
  if (Number.isFinite(lat) && Number.isFinite(lng)) lines.push(`Point I clicked: ${lat.toFixed(5)}, ${lng.toFixed(5)}`);
  const body = `${lines.join("\r\n")}\r\n\r\n`;
  return `mailto:${PARCEL_REQUEST_EMAIL}?subject=${enc(`Parcel data request: ${where}`)}&body=${enc(body)}`;
}

/* The notice for a `countyIdentity()` answer, or null when there is nothing to say: a county that IS wired (a missed click on
 * water or right-of-way is "No lot here", never this), a county a statewide layer covers (a failing statewide layer is an outage,
 * not a gap), and every `pending` / `outside` answer keep their existing behaviour untouched.
 * `point` ({lat, lng}) is the clicked point, carried into the email. → { reason, county, state, message, href } */
export function parcelGapNotice(identity, point) {
  if (!identity || identity.status !== "no-source") return null;
  if (identity.statewideKey) return null; // a statewide layer covers this county
  const county = gapDisplayName(identity);
  const reason = gapReasonFor(identity.name, identity.state);
  const message = gapSentence(reason, county);
  const href = parcelRequestHref({ name: county, state: identity.state, sentence: message, lat: point && point.lat, lng: point && point.lng });
  return { reason, county, state: identity.state, message, href };
}

/* The label on the request link, everywhere it appears. */
export const PARCEL_REQUEST_LABEL = "Email Michael to request it";
