/* Rutherford County TN zoning (NEW-1, 2026-11-12) — the pure half: how a zoning polygon from each of FOUR governments' own layers is read, classed, painted, worded and linked.
 *
 * FOUR SOURCES, FOUR GOVERNMENTS (MEASURED 2026-11-12, each re-counted live; token-free ArcGIS Online feature services, read directly — CORS-open):
 *   county        Rutherford County Planning — Zoning_Hub_Data/FeatureServer/2 (2,065 polygons, edited 2026-10-28, WKID 2274). `ZONEABBRV` is the code, `ZONE_DIST` the district name, `EFF_DATE`, `CASE_NO`.
 *                 It also holds 258 "CITY" / "ANNEXED" FILL polygons for incorporated ground — a hole in the county's zoning, NEVER a district: `isCountyHole` / `COUNTY_WHERE` keep them out.
 *   murfreesboro  City of Murfreesboro — City_Zoning_inc_Historic_Zoning_WFL1/FeatureServer/45 (the current layer; 0–43 are dated snapshots; 4,346 polygons, edited 2024-04-09, WKID 3857).
 *                 `SubZoning` is the code and its coded-value domain carries the district name; 1,555 polygons are `ParcelType = 'r'` (street right-of-way carrying the neighbouring code) and are not drawn.
 *   smyrna        Town of Smyrna — Smyrna_Zoning/FeatureServer/0 (1,296 polygons, edited 2024-03-06). `ZONING_DIST` is an INTEGER with the layer's own coded-value domain (1–24); five codes the data
 *                 carries (26–30) are NOT in the domain and are shown as "Unlisted".
 *   lavergne      City of La Vergne — LaVergne_Zoning/FeatureServer/0 (579 polygons, edited 2024-03-06). `Zoning_Typ` is the code; its coded-value domain carries the district name.
 * A third-party merged copy ("RutherfordCountyZoning") exists and is NOT used.
 *
 * OWNER RULES THIS FILE CARRIES: a district NAME is only ever the layer's own (its field or coded-value domain) or the ordinance's — never from memory (#46, `NAME_SOURCE`); the legend is HEADED by the
 * government with ONE code per row (#50); a result is labelled by the government the SITE falls in, from the state's city limits (#41, rutherfordJurisdiction.js); a code the source does not
 * define shows as written / "Unlisted", never a guess.
 *
 * Pure: no network, no React, no Leaflet — unit-tested in test/rutherfordZoning.test.js. */

import { approvalDate } from "./desotoZoning.js";

export const COUNTY = "county", MURFREESBORO = "murfreesboro", SMYRNA = "smyrna", LAVERGNE = "lavergne";
export const MEMBERS = Object.freeze([MURFREESBORO, SMYRNA, LAVERGNE, COUNTY]); // cities first, the county last: the card's `dedupeKey` keeps the FIRST answer, so a city's own layer beats the county's older one

/* The government a member's polygons belong to — the legend heading, the card title and the jurisdiction the site's city limits are compared with. */
export const UNINCORPORATED = "Unincorporated Rutherford County";
export const JURISDICTION = Object.freeze({ [COUNTY]: UNINCORPORATED, [MURFREESBORO]: "Murfreesboro", [SMYRNA]: "Smyrna", [LAVERGNE]: "La Vergne" });
/* Shared by the four members' cards, so one click that touches several of them answers once (layers.js `identifyOverlaysAt`). */
export const DEDUPE_KEY = "tn-rutherford-zoning";

/* ───────────────────────── Server-side filters (what is NOT a district) ───────────────────────── */

/* Rutherford County's table mixes real districts with fill polygons for ground inside a city ("CITY") or annexed into one ("ANNEXED"). */
export const isCountyHole = (props) => {
  const p = props || {};
  const abbr = String(p.ZONEABBRV == null ? "" : p.ZONEABBRV).trim().toUpperCase();
  const z = String(p.ZONING == null ? "" : p.ZONING).trim().toUpperCase();
  return abbr === "CITY" || z === "CITY" || z === "ANNEXED";
};
export const COUNTY_WHERE = "(ZONEABBRV IS NULL OR ZONEABBRV <> 'CITY') AND (ZONING IS NULL OR ZONING NOT IN ('CITY','ANNEXED'))";
/* Murfreesboro's `ParcelType` is 'p' (a parcel) or 'r' (street right-of-way carrying the neighbouring code). Right-of-way is not a district. */
export const MURFREESBORO_WHERE = "ParcelType <> 'r' OR ParcelType IS NULL";

/* ───────────────────────── District names — each from its own source ───────────────────────── */

const clean = (v) => { const t = String(v == null ? "" : v).trim(); return !t || /^(null|none|n\/a|<null>)$/i.test(t) ? "" : t; };
const upper = (v) => clean(v).toUpperCase();

/* Rutherford County: the layer's own `ZONE_DIST` text, one name per code (the 2,065 polygons were grouped by code and name on 2026-11-12; one CG polygon carries the text of LOW DENSITY RESIDENTIAL — see `alsoReads`). */
export const COUNTY_NAMES = Object.freeze({
  AR: "Agricultural Residential", CG: "Commercial General", CN: "Commercial Neighborhood", CS: "Commercial Services", EAC: "Employment & Activity Center",
  HI: "Heavy Industrial", IN: "Institutional", LI: "Light Industrial", OP: "Office Professional", PUD: "Planned Unit Development",
  RC: "Rural Center", RL: "Low Density Residential", RM: "Medium Density Residential", RMF: "Residential Multi-Family",
});

/* Murfreesboro: the `SubZoning` coded-value domain (34 codes) and the `GenZoning` domain (9 classes), read from the layer definition 2026-11-12. */
export const MURFREESBORO_NAMES = Object.freeze({
  CBD: "Central Business District", CF: "Commercial Fringe", CH: "Commercial Highway", CL: "Commercial Local", CM: "Commercial Medical", "CM-R": "Commercial Medical, Residential",
  "CM-RS-8": "Commercial Medical, Residential Single Family", CP: "Commercial Planned", CU: "College and University", "H-I": "Heavy Industrial", "L-I": "Light Industrial", MU: "Mixed Use",
  OG: "General Office", "OG-R": "Residential General Office", P: "Park", PID: "Planned Industrial District", "R-MO": "Residential Mobile Home", RD: "Residential Duplex",
  "RS-A1": "Residential SF detached, SF zero lot line", "RS-A2": "Residential SF attached townhouse suburban", "RS-A3": "Residential SF attached townhouse urban",
  "RM-12": "Residential MF (RM-12)", "RM-16": "Residential MF (RM-16)", "RS-10": "Residential SF (RS-10)", "RS-12": "Residential SF (RS-12)", "RS-15": "Residential SF (RS-15)",
  "RS-4": "Residential SF (RS-4)", "RS-6": "Residential SF (RS-6)", "RS-8": "Residential SF (RS-8)", "G-I": "General Industrial", PCD: "Planned Commercial District",
  PND: "Planned Institutional District", PRD: "Planned Residential District", PUD: "Planned Unit District",
});
export const MURFREESBORO_CLASSES = Object.freeze({
  COM: "Commercial", IND: "Industrial", MU: "Mixed Use", OFF: "Office", PK: "Park", RES: "Residential", UNV: "University", CBD: "Central Business District", PLN: "Planned",
});

/* Smyrna: ZONING_DIST integer → [code, name], from the layer's coded-value domain `Zoning_Dist` (24 values). The town's labels are ALL CAPS with three spelling slips (RESIDENTAIL,
 * DEVELPMENT, PLANNIED) — here title-cased and spelled; the districts are as the town lists them (I-1 and I-2 are both "Light Industrial" in its domain). */
export const SMYRNA_DISTRICTS = Object.freeze({
  1: ["F-1", "Floodway"], 2: ["A-1", "Airport District"], 3: ["C-1", "Central Business"], 4: ["C-2", "Highway Service"], 5: ["C-3", "Restrictive Highway Service"],
  6: ["C-4", "Neighborhood Service"], 7: ["I-1", "Light Industrial"], 8: ["I-2", "Light Industrial"], 9: ["I-3", "Heavy Industrial"], 10: ["P&O", "Professional and Office"],
  11: ["R-1", "Low Density Residential"], 12: ["R-2", "Low Density Residential"], 13: ["R-3", "Medium Density Residential"], 14: ["R-4", "Medium Density Residential"],
  15: ["R-5", "High Density Residential"], 16: ["R-6", "High Density Residential"], 17: ["PRD", "Planned Residential District"], 18: ["PUD", "Planned Unit Development"],
  19: [null, "Proposed"], 20: [null, "Historic Overlay District"], 21: ["PCD", "Planned Commercial District"], 22: ["P&O-2", "Professional and Office"],
  23: [null, "Height"], 24: ["PID", "Planned Industrial District"],
});
/* Three of the town's 24 districts have a NAME and no code in its domain (Proposed, Historic Overlay District, Height): they are shown by name alone — no code is invented — and print this short word on the map. */
export const SMYRNA_MAP_WORD = Object.freeze({ 19: "PROPOSED", 20: "HISTORIC", 23: "HEIGHT" });
/* The sibling field `ZONE_ID` has its own domain of CODES; it disagrees with ZONING_DIST on a handful of polygons (measured: 13 of 1,296), which the card shows rather than resolves. */
export const SMYRNA_ZONE_ID_CODES = Object.freeze({
  1: "F-1", 2: "A-1", 3: "C-1", 4: "C-2", 5: "C-3", 6: "C-4", 7: "I-1", 8: "I-2", 9: "I-3", 10: "P&O-1", 11: "R-1", 12: "R-2", 13: "R-3", 14: "R-4", 15: "R-5", 16: "R-6",
  17: "PRD", 18: "PUD", 19: "H-2", 20: "H-1", 21: "PCD", 22: "P&O-2", 23: "PID", 24: "PROPOSED",
});

/* La Vergne: the `Zoning_Typ` coded-value domain (17 codes), with the leading "(code) " of each label removed. */
export const LAVERGNE_NAMES = Object.freeze({
  A: "Agriculture", "R-1": "Low Density Residential", "R-2": "Medium Density Residential", "R-3": "High Density Residential", "R-3Z": "High Density Residential (Zero lot line)",
  "R-4": "Mobile Home Residential", PDR: "Planned Density Residential", "C-1": "Government and Public Use", "C-2": "Highway Service", "C-3": "Neighborhood Service", "C-4": "Shopping Center",
  "I-1": "Light Industrial", "I-2": "Heavy Industrial", "I-3": "Industrial District (Special)", "F-1": "Floodway",
  "R-2S": "Medium Density Residential (Grandfathered)", "R-2Z": "Medium Density Residential (Grandfathered)",
});

/* Where each government's names come from — shown behind the layer's (i), never on the card (#45). */
export const NAME_SOURCE = Object.freeze({
  [COUNTY]: "Rutherford County Planning — the layer's own district-name field (ZONE_DIST); the Rutherford County Zoning Resolution (adopted 11-15-12, as amended 12-11-2025) is the legal text.",
  [MURFREESBORO]: "City of Murfreesboro — the layer's own district list (SubZoning) and its Zoning Ordinance (Appendix A).",
  [SMYRNA]: "Town of Smyrna — the layer's own district list (Zoning_Dist), spelling corrected; the Municipal Zoning Ordinance is the legal text.",
  [LAVERGNE]: "City of La Vergne — the layer's own district list (Zoning_Typ); the Zoning Ordinance is the legal text.",
});
export const ORDINANCE_LINK = Object.freeze({
  [SMYRNA]: { href: "https://cms3.revize.com/revize/townofsmyrna/Documents/Departments/Public%20Works/FAQs/Municipal_Zoning_Ordinance.pdf", text: "Zoning ordinance (Smyrna)" },
  [LAVERGNE]: { href: "https://www.lavergnetn.gov/630/Zoning-Ordinance", text: "Zoning ordinance (La Vergne)" },
});

/* Murfreesboro's `URL` column holds the ordinance link, but also a REST address, two local file paths and a truncated "?bidI*" tail. Only a murfreesborotn.gov DocumentCenter link is a link; its query string is dropped. */
export function murfreesboroOrdinanceHref(raw) {
  const s = clean(raw);
  const m = /^https:\/\/(?:www\.)?murfreesborotn\.gov(\/DocumentCenter\/View\/[A-Za-z0-9/_.\-%]+)/i.exec(s);
  return m ? `https://www.murfreesborotn.gov${m[1]}` : null;
}

/* ───────────────────────── Reading one polygon ───────────────────────── */

const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, " ").trim();
const TYPOS = { RESIDENTAIL: "RESIDENTIAL", DEVELPMENT: "DEVELOPMENT", PLANNIED: "PLANNED" };
const SMALL = new Set(["and", "of", "the"]);
/* "LOW DENSITY RESIDENTIAL" → "Low Density Residential" (ALL-CAPS county text; the three Smyrna spelling slips are fixed). */
export function titleName(s) {
  const t = String(s == null ? "" : s).trim();
  if (!t) return "";
  return t.split(/\s+/).map((w, i) => {
    const u = TYPOS[w.toUpperCase()] || w.toUpperCase();
    const l = u.toLowerCase();
    if (u === "&") return "&";
    if (i > 0 && SMALL.has(l)) return l;
    return l.replace(/(^|[-(/])([a-z])/g, (_m, a, c) => a + c.toUpperCase());
  }).join(" ");
}

/* What one polygon says: { member, code, name|null, listed, alsoReads?, ... } — the ONE reader every surface (style, label, legend, card) goes through. `listed` is false only for a
 * Smyrna code the town's own domain does not define. */
export function readZone(member, props) {
  const p = props || {};
  if (member === COUNTY) {
    const code = upper(p.ZONEABBRV);
    const name = COUNTY_NAMES[code] || null;
    const text = clean(p.ZONE_DIST);
    const alsoReads = name && text && norm(text) !== norm(name) ? titleName(text) : (!name && text ? titleName(text) : null);
    return { member, code, name, listed: true, alsoReads, date: approvalDate(p.EFF_DATE), cases: [clean(p.CASE_NO), clean(p.CASE_NO_2)].filter(Boolean), notes: [clean(p.COMMENT), clean(p.COMMENT_2)].filter(Boolean) };
  }
  if (member === MURFREESBORO) {
    const code = upper(p.SubZoning);
    return { member, code, name: MURFREESBORO_NAMES[code] || null, listed: true, classWord: MURFREESBORO_CLASSES[upper(p.GenZoning)] || null, href: murfreesboroOrdinanceHref(p.URL), isRow: clean(p.ParcelType).toLowerCase() === "r" };
  }
  if (member === SMYRNA) {
    const n = Number(p.ZONING_DIST);
    if (p.ZONING_DIST == null || p.ZONING_DIST === "" || !Number.isFinite(n)) return { member, code: "", name: null, listed: false, unlistedCode: null };
    const d = SMYRNA_DISTRICTS[n];
    const idCode = SMYRNA_ZONE_ID_CODES[Number(p.ZONE_ID)] || null;
    // the sibling ZONE_ID field is only a DISAGREEMENT when it names a different district: a different number AND a different code (24 / 23 are both PID)
    const alsoReads = d && idCode && Number(p.ZONE_ID) !== n && (!d[0] || idCode.toUpperCase() !== d[0].toUpperCase()) ? idCode : null;
    if (!d) return { member, code: "", name: null, listed: false, unlistedCode: n, date: approvalDate(p.LastUpdate) };
    return { member, code: d[0] || "", name: d[1], listed: true, nameOnly: !d[0], alsoReads, date: approvalDate(p.LastUpdate) };
  }
  if (member === LAVERGNE) {
    const code = upper(p.Zoning_Typ);
    return { member, code, name: LAVERGNE_NAMES[code] || null, listed: true };
  }
  return { member, code: "", name: null, listed: false };
}

/* The code printed on the polygon (on-map label). A Smyrna integer is turned into the town's code; an unlisted code prints nothing rather than a bare number. */
export const labelOf = (member, raw) => {
  if (member === SMYRNA) { const d = SMYRNA_DISTRICTS[Number(raw)]; return d ? (d[0] || SMYRNA_MAP_WORD[Number(raw)] || null) : null; }
  const t = clean(raw);
  return t ? t.toUpperCase() : null;
};
/* `lineLabel.format` per member — receives the layer's label field value. */
export const labelFormat = (member) => (raw) => labelOf(member, raw);
export const LABEL_FIELD = Object.freeze({ [COUNTY]: "ZONEABBRV", [MURFREESBORO]: "SubZoning", [SMYRNA]: "ZONING_DIST", [LAVERGNE]: "Zoning_Typ" });

/* "LI · Light Industrial", or the bare code when the source gives no name, or "Unlisted" for an undefined Smyrna code. */
export function zoneText(z) {
  if (!z) return "";
  if (!z.listed) return z.unlistedCode != null ? `Unlisted district (code ${z.unlistedCode})` : "Unlisted district";
  if (!z.code) return z.nameOnly && z.name ? z.name : "";
  return z.name ? `${z.code} · ${z.name}` : z.code;
}

/* ───────────────────────── Families: colour and legend order ───────────────────────── */

/* The family of a district, decided from the SOURCE'S OWN NAME for it (so no per-code opinion lives here), else from the code; unknown = "other", drawn neutral. */
export function zoneClass(code, name) {
  const t = `${name || ""} ${code || ""}`.toLowerCase();
  if (!t.trim()) return "other";
  if (/overlay|floodway|\bheight\b|historic|\bf-1\b/.test(t)) return "overlay";
  if (/\bplanned (unit|residential|commercial|industrial|institutional|density)\b|\b(pud|prd|pcd|pnd|pdr)\b/.test(t)) return "pud";
  if (/industrial|\bpid\b/.test(t)) return "industrial";
  if (/institutional|\bpark\b|university|college|government|public use|airport/.test(t)) return "civic";
  if (/mixed|activity center|rural center|central business|special/.test(t)) return "mixed"; // before "business": a Central Business District is a downtown mix, not a plain commercial strip
  if (/commercial|business|highway service|shopping|neighborhood service/.test(t)) return "commercial";
  if (/office|professional|p&o/.test(t)) return "office";
  if (/agricultur/.test(t)) return "agricultural";
  if (/residential|mobile home|duplex|dwelling|\brs-|\brm-|\brd\b/.test(t)) return "residential";
  return "other";
}
export const ZONE_COLORS = Object.freeze({
  industrial: "#7c3aed", commercial: "#ea580c", office: "#0891b2", mixed: "#db2777", civic: "#2563eb", residential: "#ca8a04", agricultural: "#4d7c0f", pud: "#0f766e", overlay: "#64748b", other: "#6b7280",
});
export const CLASS_ORDER = ["residential", "agricultural", "commercial", "office", "mixed", "industrial", "civic", "pud", "overlay", "other"];
export const colorOf = (z) => ZONE_COLORS[z && z.listed ? zoneClass(z.code, z.name) : "other"];

/* esri-leaflet per-feature style for a member: a translucent fill in the family colour with a thin outline; overlay districts are dashed and fainter. */
export function zoningStyleFor(member) {
  return (props, opacity) => {
    const z = readZone(member, props);
    const klass = z.listed ? zoneClass(z.code, z.name) : "other";
    const c = ZONE_COLORS[klass];
    const overlay = klass === "overlay";
    return { color: c, weight: 1, opacity, fill: true, fillColor: c, fillOpacity: Math.min(overlay ? 0.2 : 0.45, opacity * (overlay ? 0.3 : 0.6)), ...(overlay ? { dashArray: "4 3" } : {}) };
  };
}

/* ───────────────────────── The click card ───────────────────────── */

/* `site` = what the state's city limits say about the clicked POINT: a city's name ("Murfreesboro", "Smyrna", "La Vergne", "Eagleville"), UNINCORPORATED, or null while the limits are still loading
 * (rutherfordJurisdiction.js). The card names the government ONCE, in its title (#41/#50). */
export function zoningCard(member, props, site) {
  const z = readZone(member, props);
  const own = JURISDICTION[member];
  const rows = [];

  if (member === COUNTY) {
    if (site && site !== UNINCORPORATED) {
      /* The county's table is older than the cities' annexations (and the State's limits newer than some cities' zoning layers): inside a city the county's polygon is NOT the zoning. The card is
       * the CITY'S (title) and says what is true — the city's own layer has no district here — and shows the county's older answer only under a label that attributes it to the county. */
      const hasLayer = site === JURISDICTION[MURFREESBORO] || site === JURISDICTION[SMYRNA] || site === JURISDICTION[LAVERGNE];
      const out = [{ label: "Zoning", text: hasLayer ? `${site}'s own zoning layer shows no district at this point (newly annexed ground, a street, or a gap in the layer). Confirm with ${site} Planning.` : `${site} has no zoning layer in Planyr yet — ask the city.` }];
      const older = zoneText(z);
      if (older) out.push({ label: "County's older layer shows", text: older });
      return { title: `Zoning · ${site}`, dedupeKey: DEDUPE_KEY, rows: out };
    }
    const t = zoneText(z);
    if (t) rows.push({ label: "Zone", text: t });
    if (z.alsoReads) rows.push({ label: "County record also reads", text: z.alsoReads });
    if (z.date) rows.push({ label: "Effective", text: z.date });
    if (z.cases.length) rows.push({ label: "Case", text: z.cases.join(" · ") });
    if (z.notes.length) rows.push({ label: "Note", text: z.notes.join(" · ") });
    if (!site) rows.push({ label: "Jurisdiction", text: "Checking city limits…" });
    return { title: site ? `Zoning · ${UNINCORPORATED}` : "Zoning · Rutherford County", dedupeKey: DEDUPE_KEY, rows };
  }

  const t = zoneText(z);
  if (t) rows.push({ label: "Zone", text: t });
  if (z.alsoReads) rows.push({ label: "City record also reads", text: z.alsoReads });
  if (z.classWord) rows.push({ label: "Class", text: z.classWord });
  if (z.date) rows.push({ label: "Record updated", text: z.date });
  const link = member === MURFREESBORO ? (z.href ? { href: z.href, text: "Zoning ordinance (Murfreesboro)" } : null) : ORDINANCE_LINK[member];
  if (link) rows.push({ label: "Ordinance", text: link.text, href: link.href });
  if (site && site !== own) {
    rows.push({ label: "City limits", text: site === UNINCORPORATED ? `Outside ${own}'s limits on the state's city map — confirm which government zones this land.` : `Inside ${site}'s limits on the state's city map — confirm which government zones this land.` });
  }
  return { title: `Zoning · ${own}`, dedupeKey: DEDUPE_KEY, rows };
}

/* ───────────────────────── The legend ───────────────────────── */

/* The Zoning dropdown legend for what one member has in view (constraint #50): ONE heading naming the government, then ONE row per code in the family colour. `items` = [{ props }] or
 * pre-read zones; duplicates fold; sorted by family then code. */
export function memberLegend(member, propsList) {
  const seen = new Map();
  for (const props of propsList || []) {
    const z = readZone(member, props);
    const key = z.listed ? (z.code || (z.nameOnly ? `name:${z.name}` : "")) : `unlisted:${z.unlistedCode}`;
    if (!key || key === "unlisted:null") continue;
    if (!seen.has(key)) seen.set(key, z);
  }
  if (!seen.size) return [];
  const rank = (z) => CLASS_ORDER.indexOf(z.listed ? zoneClass(z.code, z.name) : "other");
  const rows = [...seen.values()].sort((a, b) => rank(a) - rank(b) || String(a.code || a.name || a.unlistedCode).localeCompare(String(b.code || b.name || b.unlistedCode), undefined, { numeric: true }));
  return [{ heading: true, label: JURISDICTION[member] }, ...rows.map((z) => ({ label: z.listed ? zoneText(z) : `Unlisted · code ${z.unlistedCode}`, color: colorOf(z), row: true }))];
}
