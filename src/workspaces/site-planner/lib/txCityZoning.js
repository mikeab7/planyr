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
 * Pure: no network, no React, no Leaflet — unit-tested in test/txCityZoning.test.js. */

import { titleWords } from "./sugarLandZoning.js";

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
  const color = (p) => ZONE_COLORS[family(p)] || ZONE_COLORS.other;

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
    return { title: `Zoning · ${def.city}${def.titleSuffix ? ` ${def.titleSuffix}` : ""}`, rows };
  };

  /* The on-map label: the code when the city gives one (a polygon with no code carries no label — never a guess). */
  const labelText = (raw) => normalizeCode(raw) || null;

  /* Legend items for what is in view: [{ code, name }] from the features' properties; duplicates fold. */
  const legendItemsOf = (features) => (features || []).map((f) => {
    const p = (f && f.properties) || {};
    return { code: code(p), name: name(p), family: family(p) };
  });
  /* ONE heading (the city — never a suffix on each row), then ONE row per code, in the family colour, sorted by family then label. */
  const legend = (items) => {
    const seen = new Map();
    for (const it of items || []) {
      const label = withName(it && it.code, it && it.name);
      if (label && !seen.has(label)) seen.set(label, it.family || "other");
    }
    if (!seen.size) return [];
    const rows = [...seen.entries()].sort((a, b) => FAMILY_ORDER.indexOf(a[1]) - FAMILY_ORDER.indexOf(b[1]) || a[0].localeCompare(b[0], undefined, { numeric: true }));
    return [{ heading: true, label: def.city }, ...rows.map(([label, fam]) => ({ label, color: ZONE_COLORS[fam] || ZONE_COLORS.other, row: true }))];
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

/* The layers.js `lineLabel.format` for each city is its `labelText`. */
export const TX_CITY_ZONING = Object.freeze({ richmond: RICHMOND, fulshear: FULSHEAR, fulshearNewer: FULSHEAR_NEWER, stafford: STAFFORD });
