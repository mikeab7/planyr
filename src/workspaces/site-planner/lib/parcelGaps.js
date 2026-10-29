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
 * A Schneider (Beacon / qPublic) note — "Schneider map subscriber-only (2026-10-29)" = paywall, "Schneider map public, parcel feed
 * private (2026-10-29)" = locked — is the owner's own-Chrome measurement and must match the same words on the doc row (tested).
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
  ga_bacon: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_baker: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_banks: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_berrien: ["none"],
  ga_burke: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_calhoun: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_carroll: ["none"],
  ga_catoosa: ["none"],
  ga_clinch: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_colquitt: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_early: ["none"],
  ga_fannin: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_gilmer: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_habersham: ["none"],
  ga_hancock: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_haralson: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_heard: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_jenkins: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_jones: ["none"],
  ga_lamar: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_lincoln: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_long: ["none"],
  ga_macon: ["none"],
  ga_madison: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_marion: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_mcduffie: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_miller: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_mitchell: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_murray: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_oglethorpe: ["paywall", "token wall = lapsed vendor subscription (2026-10-21 review)"],
  ga_pickens: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_pike: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_polk: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_pulaski: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_quitman: ["paywall", "Schneider map subscriber-only (2026-10-29)"],
  ga_rabun: ["none"],
  ga_randolph: ["paywall", "Schneider map subscriber-only (2026-10-29)"],
  ga_schley: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_seminole: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_stephens: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_taliaferro: ["paywall", "Schneider map subscriber-only (2026-10-29)"],
  ga_terrell: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_towns: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_upson: ["paywall", "token wall = lapsed vendor subscription (2026-10-21 review)"],
  ga_walton: ["paywall", "token wall = lapsed vendor subscription (2026-10-21 review)"],
  ga_washington: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_webster: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ga_wilkes: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  // Iowa
  ia_adams: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_allamakee: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_audubon: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_clay: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_davis: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_dubuque: ["unreachable", "county host fails from the relay"],
  ia_emmet: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_fayette: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_fremont: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_jones: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_keokuk: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_marion: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_montgomery: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_page: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_pocahontas: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_poweshiek: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_ringgold: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_sac: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_shelby: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ia_sioux: ["paywall", "viewer is an Equator Studios storefront"],
  ia_taylor: ["locked", "Integrity GIS login-gated"],
  ia_union: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  // Michigan
  mi_alcona: ["none", "Schneider Beacon viewer (beacon.schneidercorp.com AppID 1164, linked from the county home page); access not measured on 2026-10-29 (not in the owner's measured list)"],
  mi_alger: ["locked", "vendor sign-in (Colligo); the county also sells its parcel file; the CUPPAD draft server answers 522"],
  mi_alpena: ["none", "the county publishes no parcel map (GIS information by phone); BS&A property search only"],
  mi_baraga: ["locked", "vendor sign-in / secured proxy"],
  mi_calhoun: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_chippewa: ["locked", "FetchGIS service refuses non-browser requests (county's Eastern UP GIS map)"],
  mi_clare: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_crawford: ["locked", "vendor sign-in (Colligo)"],
  mi_delta: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_dickinson: ["locked", "vendor sign-in / secured proxy"],
  mi_gogebic: ["locked", "vendor sign-in / secured proxy"],
  mi_houghton: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  mi_iosco: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_iron: ["locked", "vendor sign-in (Colligo); the assessor's per-township ArcGIS layers cover only part of the county"],
  mi_kalkaska: ["locked", "vendor sign-in / secured proxy"],
  mi_keweenaw: ["locked", "vendor sign-in / secured proxy"],
  mi_livingston: ["locked", "vendor sign-in / secured proxy"],
  mi_luce: ["locked", "vendor sign-in (Colligo)"],
  mi_menominee: ["locked", "vendor sign-in (Colligo)"],
  mi_missaukee: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  mi_montmorency: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  mi_ogemaw: ["locked", "FetchGIS service refuses non-browser requests; the county also sells its parcel shapefile"],
  mi_ontonagon: ["locked", "vendor sign-in / secured proxy"],
  mi_oscoda: ["none", "Schneider Beacon viewer (App=OscodaCountyMI); access not measured on 2026-10-29 (not in the owner's measured list)"],
  mi_otsego: ["locked", "FetchGIS service refuses non-browser requests"],
  mi_presqueisle: ["none", "Schneider Beacon viewer (App=PresqueIsleCountyMI); access not measured on 2026-10-29 (not in the owner's measured list)"],
  mi_schoolcraft: ["locked", "FetchGIS service refuses non-browser requests (CUPPAD map)"],
  mi_washtenaw: ["locked", "county restricts its parcel service to county-approved apps (403); open copies have no parcel id"],
  mi_wexford: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
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
  mo_pettis: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
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
  ks_miami: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
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
  ks_wilson: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  ks_woodson: ["locked", "login / Token Required"],
  // Illinois
  il_calhoun: ["none"],
  il_carroll: ["locked", "Token Required"],
  il_crawford: ["none"],
  il_edgar: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_ford: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_gallatin: ["locked", "WTH Technology viewer (gallatinil.wthgis.com) is proprietary, no ArcGIS REST (2026-10-29)"],
  il_hardin: ["none"],
  il_jodaviess: ["paywall", "parcels sit in the county's paid subscription portal"],
  il_lee: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_livingston: ["locked", "Token Required"],
  il_macoupin: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_massac: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_menard: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_montgomery: ["none"],
  il_ogle: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  il_perry: ["locked", "Token Required"],
  il_piatt: ["paywall", "CCGISC runs and sells the parcel layer; its server answers Token Required (2026-10-29)"],
  il_pike: ["locked", "WTH Technology viewer (pikeil.wthgis.com) is proprietary, no ArcGIS REST; the one open layer is Pittsfield only (2026-10-29)"],
  il_pope: ["none"],
  il_pulaski: ["none"],
  il_richland: ["locked", "WTH Technology viewer (richlandil.wthgis.com) is proprietary, no ArcGIS REST (2026-10-29)"],
  il_saline: ["none"],
  il_scott: ["none"],
  il_shelby: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
  il_stephenson: ["locked", "WinGIS parcel service answers Token Required; the public viewer injects its own key (2026-10-29)"],
  il_vermilion: ["unreachable", "TLS certificate rejected from the relay / origin timeout"],
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
  // South Dakota — all 49 researched in docs/STATEWIDE-PARCELS.md "South Dakota counties (2026-10-19)"; they were missing from this table until 2026-10-29 (B2486192)
  sd_aurora: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_bennett: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_bonhomme: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_brule: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_buffalo: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_butte: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_campbell: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_charlesmix: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_davison: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_day: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_douglas: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_faulk: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_gregory: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_haakon: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_hanson: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_hutchinson: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_hyde: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_jackson: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_jerauld: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_jones: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_lyman: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_marshall: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_mcpherson: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_mellette: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_potter: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_sanborn: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_stanley: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_sully: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_todd: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_tripp: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_turner: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_ziebach: ["unreachable", "gis.districtiii.org (Planning District III) answers 404/403 on every path since 2026-10-20"],
  sd_fallriver: ["unreachable", "vendor host (arcgis.mobile311.com) times out through the relay"],
  sd_meade: ["unreachable", "staff web adapter (gisstaffweb.rcgov.org) does not resolve from the relay"],
  sd_lincoln: ["locked", "real county service sits behind a Cloudflare managed bot challenge"],
  sd_brookings: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  sd_custer: ["locked", "Schneider map public, parcel feed private (2026-10-29)"],
  sd_clay: ["paywall", "Schneider map subscriber-only (2026-10-29)"],
  sd_hughes: ["paywall", "Schneider map subscriber-only (2026-10-29); the District III viewer host is dead too"],
  sd_mccook: ["paywall", "Schneider map subscriber-only (2026-10-29)"],
  sd_corson: ["paywall", "Equator Studios paid portal"],
  sd_perkins: ["paywall", "Equator Studios paid portal"],
  sd_spink: ["paywall", "county sells / licenses its parcel GIS layer; no viewer service"],
  sd_harding: ["none"],
  sd_lake: ["none"],
  sd_oglalalakota: ["none"],
  sd_walworth: ["none"],
  sd_yankton: ["none", "only a city-of-Yankton layer exists, rejected as a county source"],
  sd_union: ["none", "Schneider Beacon; access not measured on 2026-10-29 (not in the owner's measured list)"],
  // New York — (Niagara was a gap until 2026-10-28: its server had moved, now wired as ny_niagara)
  // Tennessee
  tn_knox: ["locked", "KGIS REST directory answers 401"],
});

/* Counties nobody has researched yet, listed on purpose so an unsearched county can never silently fall to the default `none`.
 * `test/parcelGapsCoverage.test.js` fails when a county the registry does not wire is in NEITHER this list NOR `PARCEL_GAPS`
 * (the 49 South Dakota counties once sat in neither — owner, 2026-10-29: "if they weren't searched, then search the counties").
 * A county here reads exactly like a `none` entry at runtime; the difference is the honesty of the record. Empty on 2026-10-29. */
export const NEVER_RESEARCHED = Object.freeze([]);

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
