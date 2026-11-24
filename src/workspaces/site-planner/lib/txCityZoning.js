/* Texas CITY zoning layers other than Sugar Land (NEW-1 / NEW-2, 2026-11-12) — the pure half: how a zoning polygon of Richmond, Fulshear, Stafford (and Webster) is read, classed, painted,
 * worded and linked. `sugarLandZoning.js` is the shape this follows; it is not copied — `titleWords` is imported from it.
 *
 * ONE FACTORY, FOUR CITIES. Each city publishes its own ArcGIS layer with its own fields, so a city is a small DEFINITION (`codeOf`, `nameOf`, `classOf`, `extraRows`) and `makeCityZoning`
 * returns the style / card / legend / label functions the registry rows (txCityZoningLayers.js) hand to the layer builder. Owner constraints that bind every city here:
 *   · #41 / #46 — the district NAME is the city's OWN text (its layer's description field, which is its own legend), never written from memory; a code the layer gives no name for shows bare;
 *   · #50 — the legend is HEADED by the city ("Richmond") and carries ONE code per row; the click card names the city once, in its title;
 *   · #45 — a clean card: plain labels, no raw field names, no blank rows, normal dates, links as short labelled links, never a raw URL;
 *   · #42 — 100 % opacity default is the registry's (layers.js normalises it), this file only scales the FILL from the opacity it is handed.
 *
 * WHAT THE DATA DOES TO YOU (measured 2026-11-12 over every polygon of each layer), and what is done about it:
 *   · RICHMOND (CORZONINGDISTRICTS020320, 114 polygons, layer edited 2021-03-23): `ZoneDesc` is "SC   SUBURBAN  COMMERCIAL" (code, three spaces, name, doubled spaces inside); `ECP_Zone_Description`
 *     is the same name without the code — the name is read from it, spaces collapsed, " - " closed ("MIXED - USE" → "Mixed-Use"). `ZoneChange` is a history line ("Ordinance Change from GR to SC",
 *     "Annexation into Suburban Commercial", or "Citywide Zoning Initiative" on 100 polygons); `ZoneDate` is an epoch-ms date (Sep 21, 2015 on those 100). The 17 `*_Standards` fields are links
 *     into the city's online code (online.encodeplus.com); four are offered, each only when present.
 *   · FULSHEAR (two layers, one city): ZONING (67 polygons, edited 2023-09-06) and ZONING_NEWER (9 polygons, edited 2026-10-26). They OVERLAP — the newer layer re-codes ground the older one
 *     already covers (the city's new codes: D, CD, SR…) and adds two areas the older one never covered (an ER and an SR block). Both draw, the newer one on top, and each card says which layer
 *     it is from. `Zone_Distr` is the code (blank on 3 older polygons — those show their name only, with no on-map label); `Zone_Rev` is the NAME the city's own renderer draws ("DOWNTOWN
 *     DISTRICT"); `Zone_Prev` is the district before the change; `Comments` is a free note ("Fulshear Run PUD", "R-1", "I-1") and is shown as the city's note, never read as a code;
 *     `Effect_Dat` holds 1900-01-01 on six polygons (a blank date typed as the epoch) — a date before 1950 is NOT shown. One older polygon reads code MU with name COMMERCIAL: the code and the
 *     name are both shown as the city's record carries them, never reconciled by a guess.
 *   · STAFFORD (Zoning_Designations_Current, 11 polygons, edited 2024-04-10): `ZONE_CODE` + `ZONE_DESCR`; `CODE_LINK` is a Municode link on ten and the text "SEE ORDINANCES #986, 1036, & 1037"
 *     on MU-2 — a link is offered only where it is one, and the text is shown as the city's note otherwise.
 *
 *   · WEBSTER (Landbase/Zoning/MapServer, the city's own ArcGIS Server, read through /gis-proxy; layers 0 and 1 both named "Zoning"): layer 0 is the base districts (226 polygons, 9 of the 10 renderer
 *     codes in use — C1 25 · C2 33 · C3 34 · NP 38 · O 17 · M1 16 · R1 37 · R1A 7 · R2 19; no M2), layer 1 the Planned Developments (45). The two do NOT overlap (0 % of 6,555 sampled PD points sit
 *     in a base polygon): they are one map in two layers, drawn as two rows. `ZONE_` is the code; its NAME is the layer's own renderer label ("R1-Single Family Residential", read from the layer's
 *     drawingInfo 2026-11-15 — `WEBSTER_ZONE_NAMES`). `ORDINANCE` is blank on 207 of 226 base polygons and `DATE_` null on 212 (a PD layer date reads 1899-12-30, the blank — dropped by
 *     `dateFromMs`). Links: `Zone_Link` / `Use_Link` are Municode sections (Chapter 98), `District_Summary` and `Ord_Link` PDFs on the city's own host; `PD_Guide_Hyperlink` is typed with
 *     BACKSLASHES on 16 of 17 PD polygons ("https://www1.cityofwebster.com\Link\Planned_Development\X.pdf") and is mended before it is offered.
 *
 *   · KATY (2026-11-24; zoning, future land use, thoroughfare plan): see the KATY block below.
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/txCityZoning.test.js. */

import { titleWords } from "./sugarLandZoning.js";
import { streetName } from "./sugarLandThoroughfare.js";

const str = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const has = (v) => { const t = str(v); return !!t && !/^(null|none|n\/?a|<null>)$/i.test(t); };

/* The city's SHOUTED name as words: Sugar Land's title-caser, plus dotted initialisms kept whole ("U.S. 90-A ISLAND DISTRICT" → "U.S. 90-A Island District", not "U.s. …"). */
export const nameWords = (raw) => titleWords(raw).replace(/\b([A-Z])\.([a-z])\./g, (_m, a, b) => `${a}.${b.toUpperCase()}.`);

/* "R- 4" → "R-4", " dn " → "DN": a code is upper-case with no space around a hyphen. */
export const normalizeCode = (raw) => str(raw).toUpperCase().replace(/\s*-\s*/g, "-");

/* An epoch-ms date → "Sep 21, 2015", or null for blank / not a date / a placeholder date (the layers store a blank date as 1900-01-01). UTC, so the day never slips. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function dateFromMs(ms) {
  if (ms == null || ms === "" || !Number.isFinite(Number(ms))) return null;
  const d = new Date(Number(ms));
  const y = d.getUTCFullYear();
  if (!(y >= 1950 && y <= 2100)) return null;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${y}`;
}

/* A document link worth offering: an http(s) address on one of the city's own document hosts, exactly as the city published it (a host this code cannot reach is not "upgraded" to a scheme it
 * has not seen answer). Anything else — prose in a link field — is not a link. */
export function docHref(raw, hostRe) {
  const s = str(raw);
  if (!/^https?:\/\/[^\s]+$/i.test(s)) return null;
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  return hostRe.test(u.hostname) ? u.toString() : null;
}

/* Family colours — the same families and hues as Sugar Land's zoning (sugarLandZoning.ZONE_COLORS), plus institutional. Unknown is neutral and never guessed. */
export const ZONE_COLORS = Object.freeze({
  residential: "#ca8a04", business: "#ea580c", industrial: "#7c3aed", mixed: "#db2777", pud: "#0f766e", institutional: "#0369a1", other: "#6b7280",
});
const FAMILY_ORDER = ["residential", "business", "mixed", "industrial", "institutional", "pud", "other"];

/* "SC · Suburban Commercial", the bare code, or the bare name — whichever the city's record gives. */
export const withName = (code, name) => (code && name ? `${code} · ${name}` : code || name || "");

/* A city definition → the functions a registry row needs. def: { city, codeOf(props), nameOf(props), classOf(code, name), extraRows(props), titleSuffix?, citation, labelField } */
export function makeCityZoning(def) {
  const code = (p) => normalizeCode(def.codeOf(p || {})) || null;
  const name = (p) => str(def.nameOf(p || {})) || null;
  const family = (p) => def.classOf(code(p), name(p)) || "other";
  /* A city that paints by its OWN legend colours (Katy's future land use) hands `colorOf(code, name)`; otherwise the colour is the family's. */
  const color = (p) => (def.colorOf && def.colorOf(code(p), name(p))) || ZONE_COLORS[family(p)] || ZONE_COLORS.other;

  /* esri-leaflet per-feature style: a translucent fill in the family colour with a thin outline in the same colour. */
  const style = (props, opacity) => {
    const c = color(props);
    return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(0.45, opacity * 0.6) };
  };

  /* The click card: Zone (code · the city's name) then the city's own rows; nothing blank. */
  const card = (props) => {
    const p = props || {};
    const rows = [];
    const z = withName(code(p), name(p));
    if (z) rows.push({ label: "Zone", text: z });
    for (const r of def.extraRows(p) || []) if (r && has(r.text)) rows.push(r);
    return { title: `${def.kind || "Zoning"} · ${def.city}${def.titleSuffix ? ` ${def.titleSuffix}` : ""}`, rows };
  };

  /* The on-map label: the code when the city gives one (a polygon with no code carries no label — never a guess). */
  const labelText = (raw) => (def.labelText ? def.labelText(raw) : normalizeCode(raw)) || null;

  /* Legend items for what is in view: [{ code, name }] from the features' properties; duplicates fold. */
  const legendItemsOf = (features) => (features || []).map((f) => {
    const p = (f && f.properties) || {};
    return { code: code(p), name: name(p), family: family(p), color: color(p) };
  });
  /* ONE heading (the city — never a suffix on each row), then ONE row per code, in the family colour, sorted by family then label. */
  const legend = (items) => {
    const seen = new Map();
    for (const it of items || []) {
      const label = withName(it && it.code, it && it.name);
      if (label && !seen.has(label)) seen.set(label, { fam: it.family || "other", color: it.color || ZONE_COLORS[it.family] || ZONE_COLORS.other });
    }
    if (!seen.size) return [];
    const rows = [...seen.entries()].sort((a, b) => FAMILY_ORDER.indexOf(a[1].fam) - FAMILY_ORDER.indexOf(b[1].fam) || a[0].localeCompare(b[0], undefined, { numeric: true }));
    return [{ heading: true, label: def.city }, ...rows.map(([label, v]) => ({ label, color: v.color, row: true }))];
  };

  return { city: def.city, style, card, labelText, legendItemsOf, legend, codeOf: code, nameOf: name, familyOf: family, citation: def.citation, labelField: def.labelField };
}

/* ───────────────────────── RICHMOND ───────────────────────── */
const RICHMOND_FAMILY = Object.freeze({ SR: "residential", GR: "residential", SC: "business", GC: "business", DN: "mixed", OT: "mixed", MU: "mixed", IN: "industrial", PI: "institutional" });
const ENCODE_HOST = /(^|\.)encodeplus\.com$/i;
/* The four of the city's seventeen code links that matter for a site: why the district exists, what is allowed, lot and density standards, parking. */
const RICHMOND_LINKS = [
  ["District_Purpose", "District purpose"], ["Land_Use_Allowance", "Allowed uses"], ["Density_Lot_and_Scale_Standar_1", "Lot and density standards"], ["Parking_Requirements", "Parking requirements"],
];
/* "MIXED - USE" → "MIXED-USE" before it is title-cased; the layer pads some names with doubled spaces. */
const richmondName = (p) => {
  const d = str(p.ECP_Zone_Description) || str(p.ZoneDesc).replace(/^\S+\s+/, "");
  return d ? nameWords(d.replace(/\s*-\s*/g, "-")) : "";
};
export const RICHMOND = makeCityZoning({
  city: "Richmond",
  codeOf: (p) => str(p.Zone) || str(p.ECP_Zone),
  nameOf: richmondName,
  classOf: (code) => RICHMOND_FAMILY[code] || "other",
  labelField: "Zone",
  citation: "District names are the City of Richmond's own zoning-layer descriptions; the zoning ordinance in the city's online code is the legal text.",
  extraRows: (p) => {
    const rows = [];
    if (has(p.ZOrdinance)) rows.push({ label: "Ordinance", text: str(p.ZOrdinance) });
    if (has(p.ZoneChange)) rows.push({ label: "Last change", text: str(p.ZoneChange) });
    const dt = dateFromMs(p.ZoneDate);
    if (dt) rows.push({ label: "Adopted", text: dt });
    for (const [field, label] of RICHMOND_LINKS) {
      const href = docHref(p[field], ENCODE_HOST);
      if (href) rows.push({ label, text: "Open", href });
    }
    return rows;
  },
});

/* ───────────────────────── FULSHEAR ───────────────────────── */
/* The city's own names (the `Zone_Rev` text its layer draws by) → a colour family. Closed list: its renderer carries exactly these eight (+ SUBURBAN RESIDENTIAL on the newer layer). */
const FULSHEAR_FAMILY = Object.freeze({
  "SEMI-URBAN RESIDENTIAL": "residential", "SUBURBAN RESIDENTIAL": "residential", "ESTATE RESIDENTIAL": "residential", "MANUFACTURED HOMES": "residential",
  "COMMERCIAL": "business", "DOWNTOWN DISTRICT": "mixed", "MIXED USE": "mixed", "INDUSTRIAL": "industrial", "PLANNED UNIT DEVELOPMENT": "pud",
});
const fulshearName = (p) => { const n = str(p.Zone_Rev) || str(p.Zone_Prev); return n ? nameWords(n) : ""; };
const fulshearDef = (suffix, layerNote) => ({
  city: "Fulshear",
  titleSuffix: suffix,
  codeOf: (p) => str(p.Zone_Distr),
  nameOf: fulshearName,
  classOf: (_code, name) => FULSHEAR_FAMILY[str(name).toUpperCase()] || "other",
  labelField: "Zone_Distr",
  citation: "District names are the City of Fulshear's own zoning-layer descriptions; the city's Coordinated Development Ordinance is the legal text. The city keeps two zoning layers — the newer one is drawn above the earlier map.",
  extraRows: (p) => {
    const rows = [{ label: "Layer", text: layerNote }];
    const prev = fulshearName({ Zone_Rev: p.Zone_Prev });
    if (prev && prev !== fulshearName(p)) rows.push({ label: "Previously", text: prev });
    if (has(p.OrdNo)) rows.push({ label: "Ordinance", text: str(p.OrdNo) });
    const dt = dateFromMs(p.Effect_Dat);
    if (dt) rows.push({ label: "Effective", text: dt });
    if (has(p.Comments)) rows.push({ label: "City's note", text: str(p.Comments) });
    return rows;
  },
});
/* Fulshear's two layers differ only in their card's title suffix and its "Layer" row. */
export const FULSHEAR = makeCityZoning(fulshearDef("(earlier map)", "Earlier city zoning layer (edited Sep 2023)"));
export const FULSHEAR_NEWER = makeCityZoning(fulshearDef("(newer map)", "Newer city zoning layer (edited Oct 2026), drawn above the earlier map"));

/* ───────────────────────── STAFFORD ───────────────────────── */
const STAFFORD_FAMILY = Object.freeze({
  SFR: "residential", MFR: "residential", RCLM: "business", RCT: "business", PC: "business", MU: "mixed", "MU-1": "mixed", "MU-2": "mixed",
  AE: "institutional", PDD: "pud", IS: "other",
});
const MUNICODE_HOST = /(^|\.)municode\.com$/i;
export const STAFFORD = makeCityZoning({
  city: "Stafford",
  codeOf: (p) => str(p.ZONE_CODE),
  nameOf: (p) => (has(p.ZONE_DESCR) ? nameWords(str(p.ZONE_DESCR)) : ""),
  classOf: (code) => STAFFORD_FAMILY[code] || "other",
  labelField: "ZONE_CODE",
  citation: "District names are the City of Stafford's own zoning-layer descriptions; Chapter 102 of the city's code of ordinances is the legal text.",
  extraRows: (p) => {
    const href = docHref(p.CODE_LINK, MUNICODE_HOST);
    if (href) return [{ label: "Zoning code", text: "Open", href }];
    return has(p.CODE_LINK) ? [{ label: "City's note", text: nameWords(str(p.CODE_LINK)) }] : [];
  },
});

/* ───────────────────────── WEBSTER ───────────────────────── */
/* The city's own district names: the labels of its zoning layer's renderer ("R1-Single Family Residential" → code R1, name "Single Family Residential"), read from the layer 2026-11-15. */
export const WEBSTER_ZONE_NAMES = Object.freeze({
  NP: "NASA Parkway District", R1: "Single Family Residential", R1A: "Enhanced Single Family Residential", R2: "Multiple Family Residential", O: "Office District",
  C1: "First Commercial District", C2: "Second Commercial District", C3: "Third Commercial District", M1: "First Industrial District", M2: "Second Industrial District", PD: "Planned Development",
});
const WEBSTER_FAMILY = Object.freeze({ R1: "residential", R1A: "residential", R2: "residential", O: "business", C1: "business", C2: "business", C3: "business", NP: "mixed", M1: "industrial", M2: "industrial", PD: "pud" });
const WEBSTER_HOST = /(^|\.)(municode\.com|cityofwebster\.com)$/i;
const websterDef = (suffix, extra) => ({
  city: "Webster",
  titleSuffix: suffix,
  codeOf: (p) => str(p.ZONE_),
  nameOf: (p) => WEBSTER_ZONE_NAMES[normalizeCode(p.ZONE_)] || "",
  classOf: (code) => WEBSTER_FAMILY[code] || "other",
  labelField: "ZONE_",
  citation: "District names are the City of Webster's own zoning-layer labels; Chapter 98 of the city's code of ordinances is the legal text.",
  extraRows: (p) => {
    const rows = [];
    for (const r of extra(p)) rows.push(r);
    if (has(p.ORDINANCE)) rows.push({ label: "Ordinance", text: str(p.ORDINANCE) });
    const dt = dateFromMs(p.DATE_);
    if (dt) rows.push({ label: "Adopted", text: dt });
    for (const [field, label] of [["Zone_Link", "District section of the code"], ["Use_Link", "Allowed uses"], ["District_Summary", "District summary (PDF)"]]) {
      const href = docHref(p[field], WEBSTER_HOST);
      if (href) rows.push({ label, text: "Open", href });
    }
    return rows;
  },
});
export const WEBSTER = makeCityZoning(websterDef("", () => []));
export const WEBSTER_PD = makeCityZoning(websterDef("(planned development)", (p) => {
  const rows = [];
  if (has(p.PD_Guide_Name)) rows.push({ label: "Planned development", text: str(p.PD_Guide_Name) });
  if (has(p.PD_Guide_Location)) rows.push({ label: "Location", text: str(p.PD_Guide_Location) });
  if (has(p.PD_Guide_Ordinance)) rows.push({ label: "Development guide ordinance", text: str(p.PD_Guide_Ordinance) });
  // the city types some PD links with backslashes; mend them to slashes before they are checked as links
  for (const [field, label] of [["Ord_Link", "Ordinance (PDF)"], ["PD_Guide_Hyperlink", "Development guide (PDF)"]]) {
    const href = docHref(str(p[field]).replace(/\\/g, "/"), WEBSTER_HOST);
    if (href) rows.push({ label, text: "Open", href });
  }
  return rows;
}));

/* ───────────────────────── KATY (2026-11-24) ─────────────────────────
 * One ArcGIS Online service (Planning_Map, services8.arcgis.com/ihZy0ZJt5Ea5u0dK), public and CORS-open, read directly. Layer 11 ZONING (18 polygons, edited 2024-12-02): `ZONECODE` + `ZONDESC` (the city's
 * own text, already in words) + `LINK` (an ecode360 section of the city's code). Eight of the 18 are named districts with a short code (C-1, C-2, M, R-1, MH, OKD …); the other ten are planned districts whose
 * "code" IS the development's name ("Katy Boardwalk PDD", "Cane Island MPC") — so for those the code is dropped (the name carries it, never "Katy Boardwalk PDD · Katy Boardwalk Planned Development
 * District") and the on-map label prints the city's own text as written. */
const KATY_CODE = /^[A-Za-z]{1,4}(-\d+)?$/; // R-1, C-2, M, MH, OKD — a short district code, as opposed to a development's name
const katyCode = (p) => { const c = str(p.ZONECODE); return KATY_CODE.test(c) ? c : ""; };
const KATY_HOST = /(^|\.)ecode360\.com$/i;
const katyFamily = (code, name) => {
  if (/planned (development|community)/i.test(name || "")) return "pud";
  if (/^(R-\d+|MH)$/.test(code)) return "residential";
  if (/^C-\d+$/.test(code)) return "business";
  if (code === "M") return "industrial";
  if (code === "OKD") return "mixed";
  return "other";
};
export const KATY = makeCityZoning({
  city: "Katy",
  codeOf: katyCode,
  nameOf: (p) => str(p.ZONDESC) || (katyCode(p) ? "" : str(p.ZONECODE)),
  classOf: katyFamily,
  labelField: "ZONECODE",
  labelText: (raw) => str(raw),
  citation: "District names are the City of Katy's own zoning-layer descriptions; the city's code of ordinances (Chapter 14, Zoning) is the legal text.",
  extraRows: (p) => {
    const href = docHref(p.LINK, KATY_HOST);
    return href ? [{ label: "Ordinance", text: "Open", href }] : [];
  },
});

/* Katy's FUTURE LAND USE — layer 15 of the same service: 10,967 PARCEL-shaped polygons carrying the planned use in `FLU`. Their owner, address and parcel number are never requested. The names and colours
 * are the layer's own renderer (read 2026-11-24: 15 classes); `ROW` (21 polygons) and a blank (7) are not on the city's legend, so `ROW` shows as the bare code and a blank draws neutral with no label. `Jurisdiction`
 * tells whether the parcel sits in the City or its ETJ; the 8 marked "NOT IN" (outside both) are left out by the registry `where`. */
export const KATY_FLU_CLASSES = Object.freeze({
  PR: ["Parks, Recreation and Open Space", "#00d990"], ER: ["Estate Residential", "#c5d962"], SR: ["Suburban Residential", "#ffff00"], GR: ["General Residential", "#ffcd59"],
  MFR: ["Attached Residential", "#ff8000"], NC: ["Neighborhood Conservation", "#bbff99"], NCM: ["Neighborhood Commercial", "#ffcccc"], GC: ["General Commercial", "#f26661"],
  CMU: ["Corridor Mixed Use", "#bb99ff"], BWMU: ["Boardwalk District Mixed Use", "#ff8cec"], DMU: ["Downtown Mixed Use", "#73fff3"], KTMU: ["KT Entertainment District Mixed Use", "#009aa8"],
  MSMU: ["Main Street Mixed Use", "#e1e1e1"], I: ["Industrial", "#7a81cc"], PI: ["Public/Institutional", "#99ccff"],
});
export const KATY_FLU_WHERE = "Jurisdiction <> 'NOT IN'";
export const KATY_FLU = makeCityZoning({
  city: "Katy",
  kind: "Future land use",
  codeOf: (p) => str(p.FLU),
  nameOf: (p) => (KATY_FLU_CLASSES[normalizeCode(p.FLU)] || [])[0] || "",
  classOf: () => "other",
  colorOf: (code) => (KATY_FLU_CLASSES[code] || [])[1] || null,
  labelField: "FLU",
  citation: "Land-use names are the City of Katy's own future-land-use legend; the plan guides rezoning and is not itself zoning.",
  extraRows: (p) => {
    const j = str(p.Jurisdiction);
    return has(j) && !/^not in$/i.test(j) ? [{ label: "Jurisdiction", text: j }] : [];
  },
});

/* Katy's THOROUGHFARE PLAN — layer 25: 391 street centrelines, each classed (`ThoroClass`) as the city's own legend does: Interstate Freeway, Major Street, Collector Street and the two PROPOSED classes (drawn dashed — roads
 * the plan calls for that are not built). Names, colours and dashes are the layer's renderer (read 2026-11-24); a class not on it is not drawn (the registry `where` keeps the five). The layer's `Maintain` is an
 * unlabelled 0/1/blank flag and `RoadClass` mixes other governments' words ("Fulshear Major Arterial") — neither is shown. */
export const KATY_TP_CLASSES = Object.freeze({
  "Interstate Freeway": { label: "Interstate Freeway", color: "#ff0000", weight: 4, dash: null },
  "Major": { label: "Major Street", color: "#0070ff", weight: 3.4, dash: null },
  "Collector": { label: "Collector Street", color: "#ffaa00", weight: 2.8, dash: null },
  "Proposed Major": { label: "Proposed Major Street", color: "#0070ff", weight: 3.4, dash: "8 6" },
  "Proposed Collector": { label: "Proposed Collector Street", color: "#e69800", weight: 2.8, dash: "8 6" },
});
export const KATY_TP_WHERE = `ThoroClass IN (${Object.keys(KATY_TP_CLASSES).map((k) => `'${k}'`).join(",")})`;
const tpClass = (p) => KATY_TP_CLASSES[str(p && p.ThoroClass)] || null;
const tpStreet = (raw) => streetName(raw);
export const KATY_TP = Object.freeze({
  city: "Katy",
  style(props, opacity) {
    const c = tpClass(props);
    return { color: c ? c.color : "#6b7280", weight: c ? c.weight : 1.2, opacity, fill: false, lineCap: "round", lineJoin: "round", ...(c && c.dash ? { dashArray: c.dash } : {}) };
  },
  card(props) {
    const p = props || {};
    const c = tpClass(p);
    return { title: tpStreet(p.FullStreet) || tpStreet(p.StreetName) || "Thoroughfare", rows: c ? [{ label: "Class", text: c.label }] : [] };
  },
  legendItemsOf: (features) => (features || []).map((f) => tpClass(f && f.properties)).filter(Boolean),
  legend(items) {
    const have = new Set((items || []).map((c) => c.label));
    const rows = Object.values(KATY_TP_CLASSES).filter((c) => have.has(c.label)).map((c) => ({ label: c.label, color: c.color, weight: c.weight, row: true }));
    return rows.length ? [{ heading: true, label: "Katy" }, ...rows] : [];
  },
  citation: "Classes are the City of Katy's own thoroughfare-plan legend; proposed streets are the plan's, not built roads.",
});

/* The layers.js `lineLabel.format` for each city is its `labelText`. */
export const TX_CITY_ZONING = Object.freeze({ richmond: RICHMOND, fulshear: FULSHEAR, fulshearNewer: FULSHEAR_NEWER, stafford: STAFFORD, webster: WEBSTER, websterPd: WEBSTER_PD, katy: KATY, katyFlu: KATY_FLU });
