/* Colorado due-diligence layers (B2528688, 2026-10-29) — the layers an industrial developer checks on day one of a Colorado land deal that Planyr did not have.
 *
 * WHAT IS HERE, by where it comes from (every service was live-probed 2026-10-29; the registry rows with counts, fixtures and probe dates are in
 * src/shared/gis/sources.js, and `gis-source-coverage-verify` re-asks them weekly):
 *   · ECMC (Colorado's oil-and-gas regulator, formerly COGCC) — wells, flowlines, location footprints, facilities. Colorado DNR's own ArcGIS Server; the build
 *     sandbox's egress refuses it and it was measured through the planyr.io /gis-proxy relay, which the app also reads it through (`relayUrl`).
 *   · CDPHE — Superfund / natural-resource-damage sites, RCRA corrective action, institutional controls, closed landfills, solid-waste facilities.
 *   · DRMS — undermined areas (mine subsidence).  · CPW — prairie-dog colony potential, bald-eagle nest sites.  · NPS / USFWS — historic places, critical habitat.
 *   · OEDIT — enterprise zones.  · Weld County, Adams County, City of Aurora — their own zoning, growth boundaries, airport overlays / noise, right-of-way, landfills.
 *
 * EVERY ROW declares `states: ["CO"]`, and the county / city rows ALSO declare a `regions` area (serviceAreas.js: co_weld, co_adams, co_aurora), so a Texas, Georgia
 * or Tennessee site is offered none of them and a Weld row is not offered in Larimer. Site Analysis verdicts are NOT touched (TRUSTED_CHECKS): everything here is a
 * map layer, and the Site Analysis "Show on the map" pills (siteLayerPills.js) are the way in.
 *
 * NOT BUILT, with the reason (kept here and on the ledger item so the next session does not re-hunt them):
 *   · Irrigation ditch / canal rights-of-way — DWR publishes ditches as POINTS OF DIVERSION only on any reachable service (216,136 structures, no centreline); the only line
 *     copy found (CDPHE's DWR_Ditches, 806 lines, a spill-response extract) returns ZERO within 5 km of Commerce City, Denver, Aurora, Greeley and Fort Collins, so it would read as
 *     a false "no ditch". The national NHD "Streams, Canals & Ditches" row stays the stand-in.
 *   · Electric / gas service territories — the State OIT copies are FERC-714 / EIA-860 compilations dated 2015-2018 (Greeley shows overlapping co-op and municipal areas); a wrong power provider is worse than none.
 *   · Mine-subsidence HAZARD RATINGS — the DRMS service publishes seven regional sublayers (North Denver, North Colorado Springs) with the Boulder/Broomfield/Weld ratings absent; the statewide undermined-areas row stands in.
 *   · Larimer County geologic hazards — the layer covers a ~10 × 14 km foothills patch near Estes Park/Lyons, nowhere near the industrial market; Larimer's oil & gas well copy is a 2022 snapshot (ECMC's own is current).
 *   · ECMC Oil & Gas Development Plans / pending applications — docket numbers date 2019-2022 and the service states no refresh date; ECMC Rule 411 public-water-system buffers — a rule for oil-and-gas operations near public water supplies, not a development buffer.
 *   · Pits, UIC wells — pits are an oil-field waste feature with no day-one decision; UIC wells are 741 points (statewide, near-empty on the Front Range).
 *   · Denver zoning / DEN noise contours — Denver's GIS host answers Cloudflare error 1016 (origin unreachable) from the relay; Commerce City's, Brighton's and Greeley's zoning sit on city servers (c3gis.com.city is internal) that
 *     could not be reached or CORS-read. Commerce City sits inside Adams County's "Unincorporated" zoning only where it is unincorporated.
 *   · Wetland / stream BUFFERS — Colorado has no statewide stream or wetland buffer rule (Section 404 is federal, and the NWI "Wetlands" row is national); buffers are municipal / county (Fort Collins, Boulder County…), each different, so no one width is drawn.
 *   · Tribal land — Colorado's reservations (Southern Ute, Ute Mountain Ute) are in the southwest; none of the user base's markets touch them.
 *   · Rail, airports, high-voltage transmission, substations, wetlands, EPA sites, NHD — already national rows; this module adds only what the national rows lack.
 *
 * PURE: no network, no React, no Leaflet — the style / decode / card rules below unit-test standalone (test/coloradoLayers.test.js). */

import { GIS_SOURCES } from "../../../shared/gis/sources.js";
import { approvalDate } from "./desotoZoning.js";

/* The same-origin relay form of a registry URL: https://host/path → /gis-proxy/host/path (functions/gis-proxy allow-lists the host). */
export const relayUrl = (serviceUrl) => String(serviceUrl).replace(/^https:\/\/([^/]+)/, "/gis-proxy/$1");
const src = (key) => GIS_SOURCES[key].serviceUrl;
const viaRelay = (key) => relayUrl(src(key));

/* ── small, pure text helpers ─────────────────────────────────────────────────────────────── */
const EMPTY = /^(null|<null>|n\/a|na|\.|-)?$/i;
/* A cleaned attribute value, "" for absent / placeholder. */
export const tidy = (v) => {
  if (v == null) return "";
  const s = String(v).replace(/\s+/g, " ").trim();
  return EMPTY.test(s) ? "" : s;
};
const UPPER_KEEP = new Set(["LLC", "LP", "LLP", "INC", "II", "III", "IV", "USA", "US", "DJ", "CDOT", "ECMC", "OGDP", "NPL", "RCRA", "APZ", "DIA", "CO2", "NNW"]);
/* "KERR MCGEE OIL & GAS ONSHORE LP" → "Kerr McGee Oil & Gas Onshore LP". Only fully upper-case words are touched; mixed case is left as typed. */
export function nice(v) {
  const s = tidy(v);
  if (!s || s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])([a-z']*)/g, (m, a, rest, off, whole) => {
    const w = m.toUpperCase();
    if (UPPER_KEEP.has(w)) return w;
    if (w.length <= 4 && !/[AEIOUY]/.test(w)) return w; // PDC, LLC, LP, CNG — short vowel-less words are initials
    if (/^mc/i.test(m) && m.length > 2) return "Mc" + m[2].toUpperCase() + m.slice(3);
    return a.toUpperCase() + rest;
  });
}
const link = (label, href, hosts) => {
  const h = tidy(href);
  if (!/^https:\/\//i.test(h)) return null;
  if (hosts && !hosts.some((x) => new RegExp("^https://([^/]*\\.)?" + x.replace(/\./g, "\\.") + "(/|$)", "i").test(h))) return null;
  return { label, text: label, href: h };
};
/* rows: [[label, value | null], …] → [{label,text}] with empty values dropped (a card never shows a blank row). */
const rowsFrom = (spec) => spec.filter(([, v]) => v && (typeof v !== "string" || tidy(v))).map(([label, v]) => ({ label, text: typeof v === "string" ? tidy(v) : v }));
const card = (title, spec, links = []) => ({ title, rows: [...rowsFrom(spec), ...links.filter(Boolean).map((l) => ({ label: l.label, text: "Open", href: l.href }))] });

/* ── ECMC wells ─────────────────────────────────────────────────────────────────────────────── */
/* ECMC's two-letter well-status codes, decoded, and the four colour classes the map and the legend BOTH read from this one table. */
export const WELL_CLASSES = {
  live: { color: "#b91c1c", label: "Producing, active, drilling or injecting" },
  idle: { color: "#d97706", label: "Shut in, temporarily abandoned or suspended" },
  plugged: { color: "#4b5563", label: "Plugged and abandoned" },
  never: { color: "#94a3b8", label: "Permitted or located, never drilled" },
};
export const WELL_STATUS = {
  PR: ["Producing", "live"], AC: ["Active", "live"], DG: ["Drilling", "live"], WO: ["Waiting on completion", "live"], IJ: ["Injecting", "live"],
  SI: ["Shut in", "idle"], TA: ["Temporarily abandoned", "idle"], SO: ["Suspended operations", "idle"],
  PA: ["Plugged and abandoned", "plugged"],
  AP: ["Permit approved, not drilled", "never"], EP: ["Permit expired, not drilled", "never"], AL: ["Abandoned location, not drilled", "never"],
};
export const wellClassOf = (code) => { const e = WELL_STATUS[String(code == null ? "" : code).trim().toUpperCase()]; return e ? e[1] : null; };
export const wellStatusLabel = (code) => { const e = WELL_STATUS[String(code == null ? "" : code).trim().toUpperCase()]; return e ? e[0] : tidy(code); };
export function wellStyle(props, opacity) {
  const cls = wellClassOf(props && props.wellstat);
  const c = (cls && WELL_CLASSES[cls].color) || "#6b7280";
  return { color: c, weight: 1, opacity, fillColor: c, fillOpacity: opacity * (cls === "plugged" || cls === "never" ? 0.55 : 0.9), radius: cls === "plugged" || cls === "never" ? 3 : 4.5 };
}
const wellCard = (p) => card(
  `Oil & gas well · ${tidy(p.API_Label) || "API unknown"}`,
  [["Status", wellStatusLabel(p.wellstat)], ["Well", nice(p.WellName)], ["Operator", nice(p.Operator)], ["County", nice(p.County)], ["Basin", nice(p.BASIN)],
    ["Spud date", approvalDate(p.spud_date)], ["Status date", approvalDate(p.status_date)], ["Location", nice(p.loc_name_num)]],
  [link("ECMC well record", p.scout_card_public, ["ecmc.state.co.us", "ecmc.colorado.gov"])],
);

/* ── ECMC flowlines ─────────────────────────────────────────────────────────────────────────── */
/* ECMC's flowline Status is free text (≈70 spellings, 28% blank). A line is "out" — drawn dashed red, because an abandoned or unmarked line is the hazard — when its text says so;
 * everything else, including a blank, is drawn solid (blank is said in the note, never silently "active"). */
export const FLOWLINE_OUT = /aban|abaon|abnd|abip|\baip\b|remov|out.?of.?service|\boos|inactive|idle|decomm|decomis|retire|flushed|capped|plugged|^pa$|^ab$|shut.?in|discontinu|not in service/i;
export const flowlineIsOut = (status) => FLOWLINE_OUT.test(String(status == null ? "" : status).trim());
export const FLOWLINE_COLORS = { live: "#6d28d9", out: "#dc2626" };
export function flowlineStyle(props, opacity) {
  const out = flowlineIsOut(props && props.Status);
  return { color: out ? FLOWLINE_COLORS.out : FLOWLINE_COLORS.live, weight: out ? 2 : 1.8, opacity, fill: false, ...(out ? { dashArray: "6 4" } : {}) };
}
const FLUID_TIDY = (v) => { const s = tidy(v); if (!s) return ""; return /^[A-Z0-9\s/,&()-]+$/.test(s) ? nice(s) : s; };
const flowlineCard = (p) => card(
  "Oil & gas flowline",
  [["Status", tidy(p.Status) || "Not stated"], ["Fluid", FLUID_TIDY(p.FluidType)], ["Pipe size", Number(p.PipeSize) > 0 ? `${p.PipeSize} in` : ""], ["Material", tidy(p.MatType)],
    ["Operator", nice(p.Company)], ["Length", Number(p.Length_ft) > 0 ? `${Math.round(p.Length_ft).toLocaleString("en-US")} ft` : ""], ["Registration", tidy(p.Form_Type)]],
);

/* ── ECMC locations (pads) and facilities ──────────────────────────────────────────────────── */
export const LOCATION_STATUS = { AC: ["Active", "#b91c1c"], CL: ["Closed", "#6b7280"], AL: ["Abandoned location", "#94a3b8"] };
export const locationStatusLabel = (c) => (LOCATION_STATUS[String(c || "").trim().toUpperCase()] || [tidy(c)])[0];
export function locationStyle(props, opacity) {
  const e = LOCATION_STATUS[String(props && props.facility_status || "").trim().toUpperCase()];
  const c = e ? e[1] : "#78716c";
  const active = e && e[0] === "Active";
  return { color: c, weight: active ? 1.6 : 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * (active ? 0.4 : 0.2), ...(e && e[0] === "Abandoned location" ? { dashArray: "4 3" } : {}) };
}
const locationCard = (p) => card(
  `Oil & gas location · ${nice(p.location_name) || "unnamed"}`,
  [["Status", locationStatusLabel(p.facility_status)], ["Operator", nice(p.operator_name)], ["Permit form", tidy(p.form_type)], ["Permit expires", approvalDate(p.expire_date)]],
);
const facilityCard = (p) => card(
  `Oil & gas facility · ${nice(p.facility_name) || "unnamed"}`,
  [["Type", nice(p.facility_type)], ["Status", tidy(p.facility_status) === "AC" ? "Active" : tidy(p.facility_status)], ["Operator", nice(p.operator_name)], ["Status date", approvalDate(p.status_date)]],
  [link("ECMC facility record", p.LLink, ["ecmc.state.co.us", "ecmc.colorado.gov"])],
);

/* ── CDPHE ──────────────────────────────────────────────────────────────────────────────────── */
export const SUPERFUND_STATUS = { "NPL ACTIVE": "On the National Priorities List", "NPL DELETED": "Deleted from the National Priorities List", PROPOSED: "Proposed for the National Priorities List", NRD: "Natural-resource-damage site", "NRD / PROPOSED": "Natural-resource-damage site, proposed for listing" };
export const superfundStatusLabel = (s) => SUPERFUND_STATUS[String(s || "").trim().toUpperCase()] || tidy(s);
const superfundCard = (p) => card(
  `Superfund site · ${nice(String(p.NAME || p.Site || "").replace(/\/[A-Z]{2,4}$/, "")) || "unnamed"}`,
  [["Status", superfundStatusLabel(p.SiteStatus)], ["City", nice(p.CITY)], ["Contaminants", tidy(p.POLLUTANTS)]],
  [link("CDPHE site page", p.CDPHE_LINK), link("EPA site page", p.EPA_Links)],
);
export const rcraStyle = (props, opacity) => {
  const gw = String(props && props.gw_impacts_Y_or_N || "").trim().toUpperCase() === "Y";
  const c = gw ? "#b91c1c" : "#d97706";
  return { color: c, weight: 1.2, opacity, fillColor: c, fillOpacity: opacity * 0.85, radius: gw ? 5 : 4 };
};
const yn = (v) => { const s = String(v == null ? "" : v).trim().toUpperCase(); return s === "Y" ? "Yes" : s === "N" ? "No" : ""; };
const plume = (v) => { const s = tidy(v); if (!s || /^null$/i.test(s)) return ""; return /^\d+(\.\d+)?$/.test(s) ? `${s} ft` : s; };
const rcraCard = (p) => card(
  `RCRA corrective action · ${nice(p.facility_names) || "unnamed"}`,
  [["Status", nice(p.status)], ["Groundwater impacted", yn(p.gw_impacts_Y_or_N)], ["Impact beyond the property line", yn(p.offsite_impacts_Y_or_N)], ["Plume length", plume(p.plume_dist_ft)]],
);
const icCard = (p) => card(
  `Institutional control · ${nice(String(p.Site || "").replace(/\/[A-Z]{2,4}$/, "")) || "unnamed"}`,
  [["Type", tidy(p.IC_Type)], ["Applies to", tidy(p.Desc_)], ["Approved", approvalDate(p.Approved)], ["Area", Number(p.Acres) > 0 ? `${Number(p.Acres).toFixed(1)} acres` : ""]],
);
export const landfillStyle = (props, opacity) => {
  const sus = String(props && props.Known_Suspect_Release || "").trim().toUpperCase() === "Y";
  const c = sus ? "#b91c1c" : "#78350f";
  return { color: c, weight: 1.2, opacity, fillColor: c, fillOpacity: opacity * 0.85, radius: sus ? 5 : 4 };
};
const closedLandfillCard = (p) => card(
  `Closed landfill · ${nice(p.Facility_Name) || "unnamed"}`,
  [["City", nice(p.City)], ["County", nice(p.County)], ["Known or suspected release", String(p.Known_Suspect_Release || "").trim().toUpperCase() === "Y" ? "Yes (CDPHE's flag)" : ""]],
);
export const SWIS_CLASSES = {
  landfill: { color: "#78350f", label: "Landfill" },
  compost: { color: "#15803d", label: "Composting" },
  recycling: { color: "#0369a1", label: "Recycling" },
  asbestos: { color: "#b91c1c", label: "Asbestos disposal / storage" },
  other: { color: "#6b7280", label: "Transfer station, impoundment, other" },
};
export const swisClassOf = (c) => (SWIS_CLASSES[String(c || "").trim().toLowerCase()] ? String(c).trim().toLowerCase() : "other");
export const swisStyle = (props, opacity) => { const c = SWIS_CLASSES[swisClassOf(props && props.Category)].color; return { color: c, weight: 1, opacity, fillColor: c, fillOpacity: opacity * 0.8, radius: 4 }; };
const swisCard = (p) => card(`Solid waste facility · ${nice(p.Facility) || "unnamed"}`, [["Type", tidy(p.Type)], ["Status", tidy(p.Status)], ["City", nice(p.City)], ["County", nice(p.County)]]);

/* ── DRMS undermined areas, CPW wildlife ───────────────────────────────────────────────────── */
const undermCard = (p) => card(`Undermined area · ${tidy(p.MINE_NAME).replace(/,\s*$/, "") || "unnamed mine"}`, [["Mine type", tidy(p.TYPE)], ["Mineral", tidy(p.F_DESC)], ["Buffer", Number(p.BUFF_DIST) > 0 ? `${Math.round(Number(p.BUFF_DIST) * 3.28084)} ft around the workings` : ""]]);
export const PRAIRIE_DOG = { H: { color: "#b45309", label: "High potential" }, M: { color: "#d97706", label: "Moderate potential" }, L: { color: "#fcd34d", label: "Low potential" } };
export function prairieDogStyle(props, opacity) {
  const e = PRAIRIE_DOG[String(props && props.PotentialO || "").trim().toUpperCase()];
  const c = e ? e.color : "#9ca3af";
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.4 };
}
const prairieDogCard = (p) => card("Black-tailed prairie dog colony potential", [["Potential", (PRAIRIE_DOG[String(p.PotentialO || "").trim().toUpperCase()] || {}).label || ""]]);
export const EAGLE_STATUS = { ACTIVE: { color: "#15803d", label: "Active nest" }, INACTIVE: { color: "#ca8a04", label: "Inactive nest" }, UNKNOWN: { color: "#6b7280", label: "Nest, status unknown" }, DESTROYED: { color: "#9ca3af", label: "Destroyed nest" } };
export function eagleStyle(props, opacity) {
  const k = String(props && props.STATUS || "").trim().toUpperCase();
  const c = (EAGLE_STATUS[k] || EAGLE_STATUS.UNKNOWN).color;
  return { color: c, weight: k === "ACTIVE" ? 1.6 : 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * (k === "ACTIVE" ? 0.35 : 0.18) };
}
const eagleCard = (p) => card("Bald eagle nest site", [["Nest status", (EAGLE_STATUS[String(p.STATUS || "").trim().toUpperCase()] || EAGLE_STATUS.UNKNOWN).label]]);

/* ── shared small card builders for the plain polygon rows ─────────────────────────────────── */
const nrhpCard = (p) => card(`Historic place · ${tidy(p.RESNAME) || "unnamed"}`, [["Type", tidy(p.ResType)], ["Address", [tidy(p.Address), nice(p.City)].filter(Boolean).join(", ")], ["County", nice(p.County)], ["Listed", approvalDate(p.CertDate)]]);
const critCard = (p) => card(`Critical habitat · ${nice(p.comname) || "species"}`, [["Species", tidy(p.sciname)], ["Unit", tidy(p.unitname)], ["Status", tidy(p.status)]]);
const enterpriseCard = (p) => card(`Enterprise Zone · ${tidy(p.Admin_Zone) || "zone"}`, [["Statutory zone", tidy(p.Statutory_Zone)]]);

/* ── county / city rows ────────────────────────────────────────────────────────────────────── */
export const WELD_ZONE_COLORS = { A: "#4d7c0f", E: "#a16207", R: "#ca8a04", C: "#ea580c", I: "#7c3aed", PUD: "#0f766e" };
export function weldZoningStyle(props, opacity) {
  const k = String(props && props.MASTERZ || "").trim().toUpperCase();
  const c = WELD_ZONE_COLORS[k] || "#6b7280";
  const base = k === "A";
  return { color: c, weight: base ? 0.6 : 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * (base ? 0.12 : 0.4) };
}
const weldZoneCard = (p) => card(`Weld County zoning · ${tidy(p.ZONING) || tidy(p.MASTERZ) || "district"}`, [["Case", tidy(p.CASE_NAME)], ["Recorded", tidy(p.YEAR)], ["Reception", tidy(p.RECP_NUM)]]);
export const adamsZoneKind = (zone) => {
  const z = String(zone == null ? "" : zone).trim().toUpperCase();
  if (!z) return "other";
  if (/^I-/.test(z)) return "I";
  if (/^C-/.test(z)) return "C";
  if (/^A-/.test(z)) return "A";
  if (/^(R-|M-H|R-E|TOD)/.test(z)) return "R";
  if (/^P-U-D/.test(z)) return "PUD";
  if (/^(DIA|AV|CO|PL|CONDITIONS)$/.test(z)) return "other";
  return "city"; // ground inside a city is labelled by the CITY's name, not a district
};
export const ADAMS_ZONE_COLORS = { I: "#7c3aed", C: "#ea580c", A: "#4d7c0f", R: "#ca8a04", PUD: "#0f766e", other: "#6b7280", city: "#94a3b8" };
export function adamsZoningStyle(props, opacity) {
  const k = adamsZoneKind(props && props.ZONE_);
  const c = ADAMS_ZONE_COLORS[k];
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * (k === "city" ? 0.06 : 0.4), ...(k === "city" ? { dashArray: "3 3" } : {}) };
}
const adamsZoneCard = (p) => card(
  adamsZoneKind(p.ZONE_) === "city" ? `In ${nice(p.CITY_NAME || p.ZONE_)}` : `Adams County zoning · ${tidy(p.ZONE_) || "district"}`,
  adamsZoneKind(p.ZONE_) === "city" ? [["Zoning", "Set by the city, not the county"]] : [["Jurisdiction", nice(p.CITY_NAME)]],
  [link("Adams County development standards", p.LINK, ["adamscountyco.gov"])],
);
export const AVIATION_COLORS = { "DIA Noise": "#dc2626", "Front Range Noise": "#ea580c", AIZ: "#2563eb", Height: "#7c3aed" };
export const AVIATION_LABEL = { "DIA Noise": "Denver International noise (60 DNL)", "Front Range Noise": "Front Range Airport noise (60 DNL)", AIZ: "Airport influence zone", Height: "Airport height overlay" };
export function adamsAviationStyle(props, opacity) {
  const c = AVIATION_COLORS[tidy(props && props.Name)] || "#6b7280";
  return { color: c, weight: 1.6, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.12, dashArray: "6 4" };
}
const adamsAviationCard = (p) => card(AVIATION_LABEL[tidy(p.Name)] || `Aviation overlay · ${tidy(p.Name)}`, [["Note", tidy(p.Comments)]]);
export const ADAMS_FILL = { SW: "Solid waste", "SW/Sludge": "Solid waste and sludge", "SW/CD": "Solid waste and construction debris", "Inert Fill": "Inert fill", IF: "Inert fill" };
export const adamsFillLabel = (t) => { const s = tidy(t); return s ? (ADAMS_FILL[s] || s) : ""; }; // blank → "" (a card drops it; never "unknown")
export const adamsLandfillStyle = (props, opacity) => {
  const solid = /^SW/i.test(tidy(props && (props.DISP_SITE_TYPE || props.TYPE)));
  const c = solid ? "#78350f" : "#a16207";
  return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.4 };
};
const adamsLandfillCard = (p) => card(
  `Landfill / fill site · ${tidy(p.CASENAME) || tidy(p.LANDFILL)}`,
  [["County case", tidy(p.LANDFILL)], ["Type", adamsFillLabel(p.DISP_SITE_TYPE || p.TYPE)], ["Opened", approvalDate(p.OPENDATE)], ["Closed", approvalDate(p.CLOSEDATE)]],
);
export const weldOglaStyle = (props, opacity) => {
  const st = tidy(props && props.B1_APPL_STATUS);
  const done = /closed|expired|rescinded|withdrawn|denied|reclaimed|superseded/i.test(st);
  const c = done ? "#94a3b8" : "#b91c1c";
  return { color: c, weight: 1.2, opacity, fillColor: c, fillOpacity: opacity * (done ? 0.5 : 0.9), radius: done ? 3 : 5 };
};
const weldOglaCard = (p) => card(`Weld oil & gas location assessment · ${tidy(p.B1_ALT_ID)}`, [["Stage", tidy(p.B1_APPL_STATUS)], ["Permit type", tidy(p.B1_PER_SUB_TYPE) === "NA" ? "" : tidy(p.B1_PER_SUB_TYPE)]]);
const weldRowCard = (p) => card(`County road right-of-way · ${nice(p.ROADNAME) || "unnamed"}`, [["How acquired", nice(p.ROW_STAT)], ["Width", Number(p.ROW_WIDTH) > 0 ? `${p.ROW_WIDTH} ft` : ""], ["Recorded document", tidy(p.DOC_NUM)], ["Note", tidy(p.COMMENTS)]]);
const weldUgbCard = (p) => card(`Urban growth boundary · ${nice(p.TOWNNAME || p.DISTRICT)}`, []);
const weldIgaCard = (p) => card(`Intergovernmental agreement area · ${nice(p.TOWNNAME || p.MUNICIPALI)}`, [["Buffered", yn(p.BUFFERED)], ["Dated", approvalDate(p.DATE_)]]);
const weldAirportCard = (p) => card(`Airport overlay · ${tidy(p.Airport_Ov)}`, []);
export const NOISE_COLORS = { "55": "#facc15", "60": "#f97316", "65": "#dc2626", INF: "#94a3b8" };
export const noiseBand = (label) => { const s = String(label == null ? "" : label).trim(); if (/influence/i.test(s)) return "INF"; const m = s.match(/(\d{2})/); if (!m) return null; return Number(m[1]) >= 65 ? "65" : m[1]; };
export function auroraNoiseStyle(props, opacity) {
  const b = noiseBand(props && props.LOUDNESS_I);
  const c = (b && NOISE_COLORS[b]) || "#6b7280";
  return { color: c, weight: b === "INF" ? 1.2 : 1, opacity, fill: true, fillColor: c, fillOpacity: opacity * (b === "INF" ? 0.05 : 0.18), ...(b === "INF" ? { dashArray: "5 4" } : {}) };
}
const auroraNoiseCard = (p) => card(`Airport noise · ${nice(p.NAME)}`, [["Contour", /influence/i.test(tidy(p.LOUDNESS_I)) ? "Airport influence area" : tidy(p.LOUDNESS_I)]]);
export const APZ_COLORS = { CZ: "#7f1d1d", "APZ I": "#dc2626", "APZ II": "#f97316" };
export const apzKind = (z) => { const s = String(z == null ? "" : z).trim().toUpperCase(); if (s.startsWith("CZ")) return "CZ"; if (s.startsWith("APZ II")) return "APZ II"; if (s.startsWith("APZ I")) return "APZ I"; return null; };
export function auroraApzStyle(props, opacity) {
  const k = apzKind(props && props.CRASH_ZONE);
  const c = (k && APZ_COLORS[k]) || "#6b7280";
  return { color: c, weight: 1.4, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.22 };
}
const auroraApzCard = (p) => card(`Buckley SFB ${({ CZ: "clear zone", "APZ I": "accident potential zone I", "APZ II": "accident potential zone II" })[apzKind(p.CRASH_ZONE)] || "crash zone"}`, [["Zone", tidy(p.CRASH_ZONE)]]);
export function auroraZoningClass(distName) {
  const d = String(distName == null ? "" : distName).toLowerCase();
  if (/business\/?\s*tech|airport district|mixed use- airport/.test(d)) return "I";   // Aurora has no separate industrial district: the Business/Tech and Airport districts carry industrial / employment use
  if (/mixed-use/.test(d)) return "M";
  if (/residential/.test(d)) return "R";
  if (/accident potential|apz/.test(d)) return "APZ";
  return "other";
}
export const AURORA_ZONE_COLORS = { I: "#7c3aed", M: "#ea580c", R: "#ca8a04", APZ: "#dc2626", other: "#6b7280" };
export function auroraZoningStyle(props, opacity) {
  const c = AURORA_ZONE_COLORS[auroraZoningClass(props && props.Dist_Name)];
  return { color: c, weight: 0.8, opacity, fill: true, fillColor: c, fillOpacity: opacity * 0.38 };
}
const auroraZoningCard = (p) => card(`Aurora zoning · ${tidy(p.Dist_Name) || "district"}`, [["Case", tidy(p.NAME)], ["Subzone", tidy(p.Zone_Subzone)], ["Effective", approvalDate(p.EFFECTIVE_DATE)]]);

/* ⛔ A row that limits `fields` MUST list "OBJECTID": esri-leaflet keys every painted feature by its object id, and without it in outFields every feature in a batch gets the same (undefined)
 * key and overwrites the last — a layer that answers thousands of features then PAINTS ONE (measured 2026-10-29: ECMC wells, NRHP, Weld road right-of-way all reported 1 painted feature).
 * test/coloradoLayers.test.js pins it. */
/* ── the registry rows ─────────────────────────────────────────────────────────────────────── */
const ECMC_SOURCE = "Colorado Energy & Carbon Management Commission (ECMC)";
const ECMC_RULE604 = "Setback context: ECMC Rule 604 (2 CCR 404-1, adopted under SB 19-181) sets how close a NEW oil-and-gas working pad may be to homes, schools and child-care centers — 2,000 ft, with exceptions such as owner consent or an approved plan. It governs where an operator may put a NEW pad; it does not stop anyone building near an existing well, which is set by the local government, your lender and your insurer. ECMC amends its rules — confirm the current text.";

const R = (o) => ({ kind: "esriFeature", states: ["CO"], hoverIdentify: true, canvasIdentify: true, ...o });
const legendOf = (table, order) => order.map((k) => ({ label: table[k].label, color: table[k].color }));

export const COLORADO_LAYERS = {
  /* ---- Environmental: ECMC oil & gas ---- */
  co_ecmc_wells: R({
    label: "Oil & Gas Wells", source: ECMC_SOURCE, hoverSource: "ECMC",
    url: viaRelay("ecmcWells"), fields: ["OBJECTID", "API_Label", "wellstat", "WellName", "Operator", "County", "BASIN", "spud_date", "status_date", "loc_name_num", "scout_card_public"],
    minZoom: 14, color: "#b91c1c", weight: 1, opacity: 0.55, pointRadius: 4.5, styleFn: wellStyle,
    legend: legendOf(WELL_CLASSES, ["live", "idle", "plugged", "never"]),
    hoverTitle: "Oil & gas well",
    hoverFields: [{ names: ["API_Label"] }, { format: (p) => wellStatusLabel(p.wellstat) }, { names: ["WellName"] }, { names: ["Operator"] }, { names: ["County"] }],
    identifyCard: wellCard,
    note: `ECMC's statewide well register — every spot, colour by status (producing / active, shut in, plugged and abandoned, never drilled). A plugged well is still a physical well: a former wellbore under a building pad is the issue, not the label. ${ECMC_RULE604}`,
    infoCaveat: "A well is one surface point. The pad, tanks and flowlines around it are separate rows, and a spot's accuracy is the operator's survey.",
    role: "point", group: "environmental", order: 20,
  }),
  co_ecmc_flowlines: R({
    label: "Oil & Gas Flowlines", source: ECMC_SOURCE + " — flowline registrations (Forms 12 and 44)", hoverSource: "ECMC",
    url: viaRelay("ecmcFlowlines"), fields: ["OBJECTID", "Status", "FluidType", "MatType", "PipeSize", "Company", "Length_ft", "Form_Type"],
    minZoom: 14, color: FLOWLINE_COLORS.live, weight: 1.8, opacity: 0.8, styleFn: flowlineStyle,
    legend: [{ label: "Registered flowline (in service, or status not stated)", color: FLOWLINE_COLORS.live }, { label: "Abandoned, removed, out of service or idle", color: FLOWLINE_COLORS.out, dash: true }],
    hoverTitle: "Oil & gas flowline",
    hoverFields: [{ names: ["Status"] }, { names: ["FluidType"] }, { names: ["PipeSize"], unit: "in" }, { names: ["Company"] }],
    identifyCard: flowlineCard,
    note: "Oil and gas flowlines operators have registered with ECMC (off-location flowlines and produced-water / crude transfer lines): path, fluid, size and status. Abandoned and out-of-service lines are drawn dashed red, because an abandoned, unmarked line is exactly the one that gets cut. About a quarter of segments carry no status and draw solid.",
    infoCaveat: "Operator-submitted GIS. A line that was never registered, an on-location line, and a gas gathering pipeline regulated by PHMSA are NOT here — an empty map is never proof there is no flowline. Pot-hole and locate before excavating.",
    role: "line", group: "environmental", order: 21,
  }),
  co_ecmc_locations: R({
    label: "Oil & Gas Well Pads", source: ECMC_SOURCE + " — oil and gas locations (Form 2A)", hoverSource: "ECMC",
    url: viaRelay("ecmcLocations"), fields: ["OBJECTID", "location_name", "operator_name", "facility_status", "form_type", "expire_date"],
    minZoom: 13, color: "#b91c1c", weight: 1.2, opacity: 0.55, styleFn: locationStyle,
    legend: [{ label: "Active location", color: LOCATION_STATUS.AC[1] }, { label: "Closed location", color: LOCATION_STATUS.CL[1] }, { label: "Abandoned location (never built)", color: LOCATION_STATUS.AL[1], dash: true }],
    hoverTitle: "Oil & gas location",
    hoverFields: [{ names: ["location_name"] }, { format: (p) => locationStatusLabel(p.facility_status) }, { names: ["operator_name"] }],
    identifyCard: locationCard,
    note: `The permitted footprint of each oil-and-gas location (the pad) with ECMC's status. This is the footprint ECMC measures setbacks from. ${ECMC_RULE604}`,
    infoCaveat: "A footprint is the permitted disturbance, not a clearance contour. A closed location can still hold a plugged wellbore and buried lines.",
    role: "area", group: "environmental", order: 22,
  }),
  co_ecmc_facilities: R({
    label: "Oil & Gas Facilities", source: ECMC_SOURCE + " — facilities", hoverSource: "ECMC",
    url: viaRelay("ecmcFacilities"), where: "facility_type NOT IN ('Nonfacility','Domestic tap')", fields: ["OBJECTID", "facility_name", "facility_type", "facility_status", "operator_name", "status_date", "LLink"],
    minZoom: 13, color: "#92400e", weight: 1.2, opacity: 0.55, pointRadius: 4,
    hoverTitle: "Oil & gas facility",
    hoverFields: [{ names: ["facility_name"] }, { names: ["facility_type"] }, { names: ["operator_name"] }],
    identifyCard: facilityCard,
    note: "Tank batteries, gas compressor stations, gas processing plants, injection and disposal facilities, land-application sites and flowline systems registered with ECMC. Compressors and plants are the facilities that bring odor, noise and air-permit questions to a neighbouring site.",
    infoCaveat: "A registered facility, at the operator's reported point. Domestic gas taps and non-facility records are left off.",
    role: "point", group: "environmental", order: 23,
  }),

  /* ---- Environmental: contamination and waste (CDPHE) ---- */
  co_superfund: R({
    label: "Superfund Sites", source: "Colorado Dept. of Public Health & Environment (CDPHE) — Hazardous Materials & Waste Management Division", hoverSource: "CDPHE",
    url: src("cdpheSuperfund"), minZoom: 8, color: "#9a3412", weight: 1.6, opacity: 0.6,
    styleFn: (_p, opacity) => ({ color: "#9a3412", weight: 1.6, opacity, fill: true, fillColor: "#9a3412", fillOpacity: opacity * 0.3 }),
    hoverTitle: "Superfund site",
    hoverFields: [{ names: ["NAME", "Site"] }, { format: (p) => superfundStatusLabel(p.SiteStatus) }, { names: ["POLLUTANTS"] }],
    identifyCard: superfundCard,
    note: "The boundaries CDPHE keeps for Colorado's Superfund (National Priorities List) and natural-resource-damage sites — Rocky Mountain Arsenal, Sand Creek, Woodbury Chemical, ASARCO Globeville, Lowry Landfill, Denver Radium and the rest. Inside a boundary is a different question from near one.",
    infoCaveat: "A Phase I ESA PRE-SCREEN, not a substitute. A deleted-from-the-list site can still carry deed restrictions — see Institutional Controls.",
    role: "area", group: "environmental", order: 24,
  }),
  co_rcra_ca: R({
    label: "RCRA Corrective Action", source: "Colorado Dept. of Public Health & Environment (CDPHE) — Hazardous Materials & Waste Management Division", hoverSource: "CDPHE",
    url: src("cdpheRcraCa"), minZoom: 9, color: "#d97706", weight: 1.2, opacity: 0.55, pointRadius: 4, styleFn: rcraStyle,
    legend: [{ label: "Groundwater impacted", color: "#b91c1c" }, { label: "No groundwater impact recorded", color: "#d97706" }],
    hoverTitle: "RCRA corrective action",
    hoverFields: [{ names: ["facility_names"] }, { names: ["status"] }, { format: (p) => (yn(p.gw_impacts_Y_or_N) === "Yes" ? "groundwater impacted" : "") }],
    identifyCard: rcraCard,
    note: "Facilities under CDPHE's RCRA corrective-action program — hazardous-waste sites being investigated or cleaned up, with whether groundwater is impacted, whether the impact crosses the property line and the plume length where CDPHE has one. Dry cleaners and industrial laundries are among them.",
    infoCaveat: "A point at the facility, not the plume. Plume length is CDPHE's tracking value; a plume can run past the property line (that column is shown on the card).",
    role: "point", group: "environmental", order: 25,
  }),
  co_inst_controls: R({
    label: "Institutional Controls", source: "Colorado Dept. of Public Health & Environment (CDPHE)", hoverSource: "CDPHE",
    url: src("cdpheInstControls"), minZoom: 11, color: "#7c3aed", weight: 1.4, opacity: 0.6,
    styleFn: (_p, opacity) => ({ color: "#7c3aed", weight: 1.4, opacity, fill: true, fillColor: "#7c3aed", fillOpacity: opacity * 0.28 }),
    hoverTitle: "Institutional control",
    hoverFields: [{ names: ["Site"] }, { names: ["IC_Type"] }, { names: ["Approved"], date: true }],
    identifyCard: icCard,
    note: "Parcels where CDPHE has a completed institutional control on file with the county clerk — a recorded land-use restriction (no groundwater use, no residential use, soil-management plan) that runs with the land and survives a sale.",
    infoCaveat: "CDPHE's list of completed controls. Read the recorded instrument on the title commitment; a control CDPHE has not catalogued would not be here.",
    role: "area", group: "environmental", order: 26,
  }),
  co_closed_landfills: R({
    label: "Closed Landfills", source: "Colorado Dept. of Public Health & Environment (CDPHE) — closed landfill inventory", hoverSource: "CDPHE",
    url: src("cdpheClosedLandfills"), minZoom: 10, color: "#78350f", weight: 1.2, opacity: 0.55, pointRadius: 4, styleFn: landfillStyle,
    legend: [{ label: "Closed landfill", color: "#78350f" }, { label: "Known or suspected release (CDPHE)", color: "#b91c1c" }],
    hoverTitle: "Closed landfill",
    hoverFields: [{ names: ["Facility_Name"] }, { names: ["City"] }, { format: (p) => (String(p.Known_Suspect_Release || "").trim().toUpperCase() === "Y" ? "known or suspected release" : "") }],
    identifyCard: closedLandfillCard,
    note: "CDPHE's inventory of closed landfills, with its flag where a release is known or suspected. Fill ground can settle, make methane and fail soil-bearing tests — a geotechnical and Phase I flag.",
    infoCaveat: "A point at the facility, not the fill limits (for Adams County the county's own fill polygons are a separate row). Old unpermitted dumps are not on any list.",
    role: "point", group: "environmental", order: 27,
  }),
  co_solid_waste: R({
    label: "Solid Waste Facilities", source: "Colorado Dept. of Public Health & Environment (CDPHE) — Solid Waste Information System", hoverSource: "CDPHE",
    url: src("cdpheSolidWaste"), minZoom: 11, color: "#6b7280", weight: 1, opacity: 0.55, pointRadius: 4, styleFn: swisStyle,
    legend: legendOf(SWIS_CLASSES, ["landfill", "compost", "recycling", "asbestos", "other"]),
    hoverTitle: "Solid waste facility",
    hoverFields: [{ names: ["Facility"] }, { names: ["Type"] }, { names: ["Status"] }],
    identifyCard: swisCard,
    note: "Permitted and registered solid-waste facilities: landfills, transfer stations, composting, recycling, asbestos disposal, medical waste, impoundments. Odor, truck traffic and methane questions come with any of them next door.",
    infoCaveat: "CDPHE's register; the point is the facility address, not its limits.",
    role: "point", group: "environmental", order: 28,
  }),

  /* ---- Environmental: ground, wildlife, heritage ---- */
  co_undermined: R({
    label: "Undermined Areas", source: "Colorado Division of Reclamation, Mining and Safety (DRMS) — Mine Subsidence Protection Program", hoverSource: "DRMS",
    url: src("drmsUndermined"), minZoom: 11, color: "#92400e", weight: 1.2, opacity: 0.65,
    styleFn: (_p, opacity) => ({ color: "#92400e", weight: 1.2, opacity, fill: true, fillColor: "#b45309", fillOpacity: opacity * 0.35 }),
    hoverTitle: "Undermined area",
    hoverFields: [{ names: ["MINE_NAME"] }, { names: ["TYPE"] }],
    identifyCard: undermCard,
    note: "Ground over old underground coal and clay mine workings (and a 100 ft buffer), from DRMS's statewide update — the Boulder–Weld coal field (the Erie area), the Colorado Springs and Durango districts. Ground over old workings can sink or collapse under a slab; only a geotechnical investigation clears it.",
    infoCaveat: "Mapped workings only — old, unmapped mines exist. Zero in Commerce City, Denver and Greeley is correct, not a gap. DRMS's hazard RATINGS cover only parts of two districts and are not here.",
    role: "area", group: "environmental", order: 29,
  }),
  co_prairie_dog: R({
    label: "Prairie Dog Colonies", source: "Colorado Parks and Wildlife (CPW) — black-tailed prairie dog colony potential occurrence", hoverSource: "CPW",
    url: src("cpwPrairieDog"), minZoom: 9, color: "#d97706", weight: 1, opacity: 0.5, simplifyFactor: 1.5, styleFn: prairieDogStyle,
    legend: legendOf(PRAIRIE_DOG, ["H", "M", "L"]),
    hoverTitle: "Prairie dog colony potential",
    hoverFields: [{ format: (p) => (PRAIRIE_DOG[String(p.PotentialO || "").trim().toUpperCase()] || {}).label || "" }],
    identifyCard: prairieDogCard,
    note: "CPW's modelled chance, by high / moderate / low, that black-tailed prairie dog colonies occur here across the Front Range and eastern plains. A colony on or beside a site is the common Front Range flag: burrowing owls (state-listed threatened) live in the burrows, so a wildlife survey is the usual first step before ground disturbance.",
    infoCaveat: "A habitat screen, not a colony survey or a clearance — colonies move. It is empty west of the plains by design.",
    role: "area", group: "environmental", order: 30,
  }),
  co_eagle_nests: R({
    label: "Bald Eagle Nests", source: "Colorado Parks and Wildlife (CPW) — bald eagle nest sites", hoverSource: "CPW",
    url: src("cpwEagleNests"), minZoom: 10, color: "#15803d", weight: 1.2, opacity: 0.55, styleFn: eagleStyle,
    legend: legendOf(EAGLE_STATUS, ["ACTIVE", "INACTIVE", "UNKNOWN", "DESTROYED"]),
    hoverTitle: "Bald eagle nest site",
    hoverFields: [{ format: (p) => (EAGLE_STATUS[String(p.STATUS || "").trim().toUpperCase()] || EAGLE_STATUS.UNKNOWN).label }],
    identifyCard: eagleCard,
    note: "CPW's mapped bald eagle nest-site areas, densest along the Front Range river corridors. Bald and golden eagles are federally protected (Bald and Golden Eagle Protection Act), so work near an active nest can need USFWS / CPW guidance and seasonal limits.",
    infoCaveat: "The nest-site area as CPW maps it — not a buffer distance or a permit determination. CPW and USFWS set those case by case.",
    role: "area", group: "environmental", order: 31,
  }),
  co_crit_habitat: R({
    label: "Critical Habitat", source: "U.S. Fish & Wildlife Service", hoverSource: "USFWS",
    url: src("critHabitatCo"), minZoom: 8, color: "#15803d", weight: 1.5, opacity: 0.45, simplifyFactor: 1.5,
    styleFn: (_p, opacity) => ({ color: "#15803d", weight: 1.5, opacity, fillColor: "#15803d", fillOpacity: opacity * 0.5 }),
    hoverTitle: "Critical habitat",
    hoverFields: [{ names: ["comname"] }, { names: ["sciname"] }, { names: ["status"] }],
    identifyCard: critCard,
    note: "USFWS final critical habitat. It binds FEDERAL actions, not private land directly — but a Corps wetlands permit is a federal action, so it matters wherever there is a stream or wetland. Sparse in Colorado (Colorado River fish reaches, a Colorado Springs unit). A screen; USFWS IPaC is the authoritative species list.",
    role: "area", group: "environmental", order: 32,
  }),
  co_nrhp: R({
    label: "Historic Places", source: "National Park Service — National Register of Historic Places", hoverSource: "NPS National Register",
    url: src("nrhpCo"), fields: ["OBJECTID", "RESNAME", "ResType", "Address", "City", "County", "CertDate"], minZoom: 11, color: "#6d28d9", weight: 2, opacity: 0.55, pointRadius: 4,
    hoverTitle: "Historic place",
    hoverFields: [{ names: ["RESNAME"] }, { names: ["ResType"], label: "type" }, { names: ["City"] }],
    identifyCard: nrhpCard,
    note: "National Register listings — one point per listing (a district is one point, not its boundary). Colorado's own listings and the inventory of unlisted older buildings (History Colorado's Compass database) are NOT here. A flag to check with the State Historic Preservation Office, not a clearance.",
    role: "point", group: "environmental", order: 33,
  }),
  co_weld_ogla: R({
    label: "Weld Oil & Gas Assessments", source: "Weld County, Colorado — Oil and Gas Location Assessment permits", hoverSource: "Weld County",
    url: src("weldOilGasAssessment"), fields: ["OBJECTID", "B1_ALT_ID", "B1_APPL_STATUS", "B1_PER_SUB_TYPE"], minZoom: 10, color: "#b91c1c", weight: 1.2, opacity: 0.55, pointRadius: 5, styleFn: weldOglaStyle,
    regions: ["co_weld"],
    legend: [{ label: "Application, construction, drilling or production", color: "#b91c1c" }, { label: "Closed, expired, withdrawn or reclaimed", color: "#94a3b8" }],
    hoverTitle: "Oil & gas location assessment",
    hoverFields: [{ names: ["B1_ALT_ID"] }, { names: ["B1_APPL_STATUS"] }],
    identifyCard: weldOglaCard,
    note: "Weld County's own land-use permits for oil-and-gas locations (WOGLA), by stage — the local permit that sits alongside ECMC's state permit. A pending application is where a pad is about to be built.",
    infoCaveat: "The county's permit register, not ECMC's: a location can have one without the other. Use it with the ECMC rows.",
    role: "point", group: "environmental", order: 34,
  }),
  co_adams_landfills: R({
    label: "Adams County Fill Sites", source: "Adams County, Colorado — landfills and fill sites", hoverSource: "Adams County",
    url: src("adamsLandfills"), minZoom: 11, color: "#78350f", weight: 1, opacity: 0.55, styleFn: adamsLandfillStyle,
    regions: ["co_adams"],
    legend: [{ label: "Solid-waste landfill", color: "#78350f" }, { label: "Inert fill, construction debris or other", color: "#a16207" }],
    hoverTitle: "Landfill or fill site",
    hoverFields: [{ names: ["CASENAME", "LANDFILL"] }, { format: (p) => adamsFillLabel(p.DISP_SITE_TYPE || p.TYPE) }],
    identifyCard: adamsLandfillCard,
    note: "The county's polygons for landfills and fill sites — solid-waste landfills, inert-fill pits, construction-debris dumps and sludge sites, with open and close dates where the county has them.",
    infoCaveat: "A county case-file layer; a polygon marks a permitted or known site, not a geotechnical boundary. Unpermitted fill is not on it.",
    role: "area", group: "environmental", order: 35,
  }),

  /* ---- Jurisdictions ---- */
  co_enterprise_zones: R({
    label: "Enterprise Zones", source: "Colorado Office of Economic Development and International Trade (OEDIT)", hoverSource: "OEDIT",
    url: src("enterpriseZonesCo"), minZoom: 7, color: "#0e7490", weight: 1.4, opacity: 0.4,
    styleFn: (_p, opacity) => ({ color: "#0e7490", weight: 1.4, opacity, fill: true, fillColor: "#0e7490", fillOpacity: opacity * 0.12, dashArray: "6 4" }),
    hoverTitle: "Enterprise Zone",
    hoverFields: [{ names: ["Admin_Zone"] }],
    identifyCard: enterpriseCard,
    note: "Colorado's 19 enterprise zones (2026–2035 designation). Investment, job-creation and rehabilitation inside a zone can earn state income-tax credits under the Enterprise Zone Act (C.R.S. 39-30-101 et seq.), administered by OEDIT.",
    infoCaveat: "A boundary, not eligibility: the credits depend on the project, the taxpayer and a certification from the zone administrator.",
    role: "line", group: "jurisdiction", order: 20,
  }),
  co_weld_zoning: R({
    label: "Weld County Zoning", source: "Weld County, Colorado — zoning (unincorporated)", hoverSource: "Weld County",
    url: src("weldZoning"), fields: ["OBJECTID", "ZONING", "MASTERZ", "CASE_NAME", "YEAR", "RECP_NUM"], minZoom: 10, color: "#6b7280", weight: 1, opacity: 0.4, simplifyFactor: 1.5, styleFn: weldZoningStyle,
    regions: ["co_weld"],
    lineLabel: { field: "ZONING", minZoom: 14, format: (v) => { const t = tidy(v); return t && t.length <= 18 ? t : null; } },
    legend: [{ label: "Agricultural (A)", color: WELD_ZONE_COLORS.A }, { label: "Estate (E)", color: WELD_ZONE_COLORS.E }, { label: "Residential (R)", color: WELD_ZONE_COLORS.R }, { label: "Commercial (C)", color: WELD_ZONE_COLORS.C }, { label: "Industrial (I)", color: WELD_ZONE_COLORS.I }, { label: "Planned unit development (PUD)", color: WELD_ZONE_COLORS.PUD }],
    hoverTitle: "Weld County zoning",
    hoverFields: [{ names: ["ZONING"] }, { names: ["CASE_NAME"], label: "case" }],
    identifyCard: weldZoneCard,
    note: "Weld County's zoning for UNINCORPORATED ground — cities zone their own land. Colour = the master zone class; the code (a PUD lists the base zones it carries) prints at close zoom. The county-wide agricultural base is drawn faint.",
    infoCaveat: "Inside a city's limits the city's zoning governs, not this layer. Confirm with Weld County Planning — a PUD's rules are in its recorded plan.",
    role: "area", group: "jurisdiction", order: 30,
  }),
  co_weld_ugb: R({
    label: "Weld Growth Boundaries", source: "Weld County, Colorado — urban growth boundaries", hoverSource: "Weld County",
    url: src("weldGrowthBoundary"), minZoom: 8, color: "#0f766e", weight: 1.6, opacity: 0.4,
    styleFn: (_p, opacity) => ({ color: "#0f766e", weight: 1.6, opacity, fill: false, dashArray: "8 4" }),
    regions: ["co_weld"],
    lineLabel: { field: "TOWNNAME", minZoom: 9, format: (v) => nice(v) || null },
    hoverTitle: "Urban growth boundary",
    hoverFields: [{ names: ["TOWNNAME"] }],
    identifyCard: weldUgbCard,
    note: "Weld County's urban growth boundaries (Brighton, Erie, Greeley, Lochbuie, Pierce): the ground a city expects to annex and serve. Inside one, expect city standards and annexation to be on the table.",
    role: "line", group: "jurisdiction", order: 31,
  }),
  co_weld_iga: R({
    label: "Weld IGA Areas", source: "Weld County, Colorado — intergovernmental agreement areas", hoverSource: "Weld County",
    url: src("weldIga"), minZoom: 8, color: "#7c3aed", weight: 1.4, opacity: 0.4,
    styleFn: (_p, opacity) => ({ color: "#7c3aed", weight: 1.4, opacity, fill: false, dashArray: "2 4" }),
    regions: ["co_weld"],
    lineLabel: { field: "TOWNNAME", minZoom: 10, format: (v) => nice(v) || null },
    hoverTitle: "Intergovernmental agreement area",
    hoverFields: [{ names: ["TOWNNAME"] }],
    identifyCard: weldIgaCard,
    note: "The areas around 21 Weld County towns covered by an intergovernmental agreement between the town and the county — who reviews a development proposal there, and under whose standards, is set by that agreement.",
    infoCaveat: "A boundary only; the agreement itself (from the town or Weld County Planning) says what it requires.",
    role: "line", group: "jurisdiction", order: 32,
  }),
  co_adams_zoning: R({
    label: "Adams County Zoning", source: "Adams County, Colorado — zoning", hoverSource: "Adams County",
    url: src("adamsZoning"), fields: ["OBJECTID", "ZONE_", "CITY_NAME", "LINK"], minZoom: 10, color: "#6b7280", weight: 1, opacity: 0.4, simplifyFactor: 1.5, styleFn: adamsZoningStyle,
    regions: ["co_adams"],
    lineLabel: { field: "ZONE_", minZoom: 14, format: (v) => { const t = tidy(v); return t && adamsZoneKind(t) !== "city" && t.length <= 14 ? t : null; } },
    legend: [{ label: "Industrial (I)", color: ADAMS_ZONE_COLORS.I }, { label: "Commercial (C)", color: ADAMS_ZONE_COLORS.C }, { label: "Agricultural (A)", color: ADAMS_ZONE_COLORS.A }, { label: "Residential / mobile home (R)", color: ADAMS_ZONE_COLORS.R }, { label: "Planned unit development", color: ADAMS_ZONE_COLORS.PUD }, { label: "Inside a city — the city zones it", color: ADAMS_ZONE_COLORS.city, dash: true }],
    hoverTitle: "Adams County zoning",
    hoverFields: [{ format: (p) => (adamsZoneKind(p.ZONE_) === "city" ? `inside ${nice(p.CITY_NAME || p.ZONE_)}` : tidy(p.ZONE_)) }],
    identifyCard: adamsZoneCard,
    note: "Adams County's zoning districts for UNINCORPORATED ground. Land inside Commerce City, Aurora, Brighton, Thornton and the other cities is drawn faint and labelled by the city — their own zoning governs there and is not in this layer.",
    infoCaveat: "City zoning is not in this layer — check the city for any incorporated parcel.",
    role: "area", group: "jurisdiction", order: 33,
  }),
  co_aurora_zoning: R({
    label: "Aurora Zoning", source: "City of Aurora, Colorado — zoning", hoverSource: "City of Aurora",
    url: relayUrl(src("auroraZoning")), fields: ["OBJECTID", "Dist_Name", "NAME", "Zone_Subzone", "EFFECTIVE_DATE"], minZoom: 11, color: "#6b7280", weight: 0.8, opacity: 0.4, simplifyFactor: 1.5, styleFn: auroraZoningStyle,
    regions: ["co_aurora"],
    legend: [{ label: "Business/Tech or Airport district (employment / industrial)", color: AURORA_ZONE_COLORS.I }, { label: "Mixed-use district", color: AURORA_ZONE_COLORS.M }, { label: "Residential district", color: AURORA_ZONE_COLORS.R }, { label: "Buckley accident potential zone", color: AURORA_ZONE_COLORS.APZ }, { label: "Other", color: AURORA_ZONE_COLORS.other }],
    hoverTitle: "Aurora zoning",
    hoverFields: [{ names: ["Dist_Name"] }, { names: ["NAME"], label: "case" }],
    identifyCard: auroraZoningCard,
    note: "Aurora's zoning districts as the city publishes them (Aurora's code names districts, e.g. Business/Tech, Airport, Mixed-Use Regional, rather than using letter codes). Colour is a grouping for the eye; the district name is the city's.",
    infoCaveat: "Aurora uses a unified development ordinance with overlays and rezoning cases not all shown here — confirm with Aurora Planning.",
    role: "area", group: "jurisdiction", order: 34,
  }),

  /* ---- Access / airports ---- */
  co_weld_airport: R({
    label: "Weld Airport Overlay", source: "Weld County, Colorado — Greeley-Weld airport overlay district", hoverSource: "Weld County",
    url: src("weldAirportOverlay"), minZoom: 9, color: "#2563eb", weight: 1.6, opacity: 0.55,
    styleFn: (_p, opacity) => ({ color: "#2563eb", weight: 1.6, opacity, fill: true, fillColor: "#2563eb", fillOpacity: opacity * 0.1, dashArray: "6 4" }),
    regions: ["co_weld"],
    hoverTitle: "Airport overlay district",
    hoverFields: [{ names: ["Airport_Ov"] }],
    identifyCard: weldAirportCard,
    note: "Weld County's airport overlay district around the Greeley-Weld County Airport, layered on top of the base zoning.",
    infoCaveat: "The overlay's rules are in the Weld County Code — this is the boundary only.",
    role: "area", group: "access", order: 20,
  }),
  co_adams_aviation: R({
    label: "Adams Airport Overlays", source: "Adams County, Colorado — aviation overlays (Denver International and Front Range airports)", hoverSource: "Adams County",
    url: src("adamsAviation"), minZoom: 8, color: "#dc2626", weight: 1.6, opacity: 0.55, styleFn: adamsAviationStyle,
    regions: ["co_adams"],
    legend: Object.keys(AVIATION_COLORS).map((k) => ({ label: AVIATION_LABEL[k], color: AVIATION_COLORS[k], dash: true })),
    hoverTitle: "Airport overlay",
    hoverFields: [{ format: (p) => AVIATION_LABEL[tidy(p.Name)] || tidy(p.Name) }],
    identifyCard: adamsAviationCard,
    note: "Adams County's aviation overlays: the airport height area, the 60 DNL noise contours of Denver International and Front Range airports, and the airport influence zone (AIZ). Noise and height limits layered on the base zoning matter to housing and office uses far more than to a warehouse.",
    infoCaveat: "The county's overlay boundaries; the county's note on this data says its source is under verification. Confirm with Adams County Planning.",
    role: "area", group: "access", order: 21,
  }),
  co_aurora_noise: R({
    label: "Aurora Airport Noise", source: "City of Aurora, Colorado — airport noise contours (Buckley SFB, Denver International, Centennial, Colorado Air and Space Port)", hoverSource: "City of Aurora",
    url: relayUrl(src("auroraAirportNoise")), minZoom: 9, color: "#f97316", weight: 1, opacity: 0.5, styleFn: auroraNoiseStyle,
    regions: ["co_aurora"],
    legend: [{ label: "55 LDN", color: NOISE_COLORS["55"] }, { label: "60 LDN", color: NOISE_COLORS["60"] }, { label: "65 LDN and above", color: NOISE_COLORS["65"] }, { label: "Airport influence area", color: NOISE_COLORS.INF, dash: true }],
    hoverTitle: "Airport noise",
    hoverFields: [{ names: ["NAME"] }, { names: ["LOUDNESS_I"] }],
    identifyCard: auroraNoiseCard,
    note: "Day-night average sound level (LDN) contours the City of Aurora publishes for the airports that affect it, plus each airport's influence area. Noise matters most to housing, offices and hotels; a warehouse is the quiet-tolerant use.",
    infoCaveat: "As the city publishes them; the airports' own noise studies and any recorded avigation easement control. Confirm with Aurora Planning.",
    role: "area", group: "access", order: 22,
  }),
  co_aurora_apz: R({
    label: "Buckley Crash Zones", source: "City of Aurora, Colorado — Buckley SFB accident potential zones", hoverSource: "City of Aurora",
    url: relayUrl(src("auroraBuckleyApz")), minZoom: 10, color: "#dc2626", weight: 1.4, opacity: 0.55, styleFn: auroraApzStyle,
    regions: ["co_aurora"],
    legend: [{ label: "Clear zone (CZ)", color: APZ_COLORS.CZ }, { label: "Accident potential zone I (APZ I)", color: APZ_COLORS["APZ I"] }, { label: "Accident potential zone II (APZ II)", color: APZ_COLORS["APZ II"] }],
    hoverTitle: "Buckley crash zone",
    hoverFields: [{ names: ["CRASH_ZONE"] }],
    identifyCard: auroraApzCard,
    note: "The clear zones and accident potential zones off the ends of Buckley Space Force Base's runway, as Aurora publishes them. Military land-use compatibility guidance limits people-intensive uses (housing, schools, large assembly) inside them; uses with few people on site, such as warehouse and light industrial, are the ones it generally allows.",
    infoCaveat: "The city's rendering of the zones; Buckley SFB and the city's zoning (Aurora has an accident-potential overlay) govern.",
    role: "area", group: "access", order: 23,
  }),
  co_weld_row: R({
    label: "Weld Road Right-of-Way", source: "Weld County, Colorado — road right-of-way", hoverSource: "Weld County",
    url: src("weldRoadRow"), fields: ["OBJECTID", "ROADNAME", "ROW_STAT", "ROW_WIDTH", "DOC_NUM", "COMMENTS"], minZoom: 13, color: "#92400e", weight: 1, opacity: 0.5,
    styleFn: (_p, opacity) => ({ color: "#92400e", weight: 1, opacity, fill: true, fillColor: "#b45309", fillOpacity: opacity * 0.22 }),
    regions: ["co_weld"],
    hoverTitle: "County road right-of-way",
    hoverFields: [{ names: ["ROADNAME"] }, { names: ["ROW_STAT"] }, { names: ["ROW_WIDTH"], unit: "ft" }],
    identifyCard: weldRowCard,
    note: "Weld County's recorded road right-of-way polygons: how each was acquired (plat, dedication, resolution, deed…), the width where recorded and the instrument number. Setbacks and the access permit are measured from this line, not from the pavement.",
    infoCaveat: "The county's mapping of recorded instruments — a county-road ROW can be wider than its pavement by a lot. Order the instrument for any parcel that fronts a county road.",
    role: "area", group: "access", order: 24,
  }),
};

/* The vintage (the (i) "As of" line) of every Colorado row — the data's own edition or cadence, stated rather than guessed. */
export const COLORADO_VINTAGE = {
  co_ecmc_wells: "ECMC well register — continuously updated; probed 2026-10-29 (124,462 well spots)",
  co_ecmc_flowlines: "ECMC flowline registrations — operator-submitted, continuously updated; probed 2026-10-29 (244,856 segments)",
  co_ecmc_locations: "ECMC oil and gas locations — continuously updated; probed 2026-10-29 (95,486 footprints)",
  co_ecmc_facilities: "ECMC facilities — continuously updated; probed 2026-10-29 (18,633 facilities)",
  co_superfund: "CDPHE Superfund sites — layer edited 2026-08-10",
  co_rcra_ca: "CDPHE RCRA corrective action — layer edited 2026-08-27",
  co_inst_controls: "CDPHE institutional controls — layer edited 2026-08-24",
  co_closed_landfills: "CDPHE closed landfills — layer edited 2025-01-27",
  co_solid_waste: "CDPHE Solid Waste Information System — layer edited 2026-08-24",
  co_undermined: "DRMS statewide undermined areas, 2023 update — layer edited 2026-02-24",
  co_prairie_dog: "CPW species activity mapping — layer edited 2026-05-07",
  co_eagle_nests: "CPW bald eagle nest sites — layer edited 2026-05-07",
  co_crit_habitat: "USFWS final critical habitat — layer edited 2026-10-21",
  co_nrhp: "NPS National Register — Esri Federal Data copy, edited 2026-10-28",
  co_weld_ogla: "Weld County WOGLA permits — layer edited 2026-10-28",
  co_adams_landfills: "Adams County landfills and fill sites — layer edited 2026-08-30",
  co_enterprise_zones: "OEDIT Enterprise Zones, 2026–2035 designation — layer edited 2026-10-29",
  co_weld_zoning: "Weld County zoning — layer edited 2026-10-28",
  co_weld_ugb: "Weld County urban growth boundaries — layer edited 2026-10-28",
  co_weld_iga: "Weld County intergovernmental agreement areas — layer edited 2026-10-28",
  co_adams_zoning: "Adams County zoning — layer edited 2026-08-30",
  co_aurora_zoning: "City of Aurora zoning — current edition, probed 2026-10-29",
  co_weld_airport: "Weld County airport overlay — layer edited 2020-12-02",
  co_adams_aviation: "Adams County aviation overlays — layer edited 2026-10-25",
  co_aurora_noise: "City of Aurora airport noise contours — current edition, probed 2026-10-29",
  co_aurora_apz: "City of Aurora Buckley accident potential zones — current edition, probed 2026-10-29",
  co_weld_row: "Weld County road right-of-way — layer edited 2026-10-28",
};
