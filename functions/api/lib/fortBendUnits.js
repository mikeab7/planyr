/* fortBendUnits.js — Fort Bend County: one FBCAD account → its taxing units + adopted rates (NEW-1 / B2158065).
 *
 * MEMBERSHIP  The FBCAD hosted parcel layer's TAXUNITS field ("C21,D01,G01,S07,CAD") by QUICKREFID — the CAD's own list.
 * LEGEND+RATE The Fort Bend County Tax Office "Truth in Taxation" portal (taxrateinfo.fortbendcountytx.gov): an index of
 *             every unit (ID = the SAME code FBCAD uses, type, name) and, per unit, the ADOPTED rate by year.
 *             Measured 2026-11-12: S07 2025 = 1.056900 (= the Comptroller's 2025 file), C21 2025 = 0.358827 (= Comptroller).
 *             WHY NOT THE COMPTROLLER JOIN THE BRIEF ASKED FOR: its county row's "TOTAL COUNTY TAX RATE" is 0.824 =
 *             general 0.412 + road&bridge 0.024 + FMFC 0.388, while the county's own rate for G01 is 0.412 — joining it
 *             would DOUBLE the county line on every Fort Bend parcel. The county portal is the unit's own published
 *             adopted rate, code-keyed, so no name/ID guessing either.
 * EDGE UNITS  CAD = the appraisal district (levies nothing, omitted). T### = a TIRZ (the county's TIRZ layer lists it;
 *             non-levying → 0 with a note). A code the portal does not list: FBCAD's own table (best effort) saying
 *             "NA" = dormant → 0 "no adopted rate"; anything else → the account is INCOMPLETE and the table is hidden.
 * YEAR        The newest year for which EVERY unit has a REPORTED rate. 0.000000 on the portal means "not provided by
 *             the district", so a 0 after a year that had a rate is NOT reported (the year is skipped); a unit whose
 *             whole history is 0 is a genuine zero (Stafford levies no property tax). One year for the whole table.
 * Complete or hidden: never a partial list, never a guess.
 */

export const PORTAL = "https://taxrateinfo.fortbendcountytx.gov";
export const FBCAD_LAYER = "https://services2.arcgis.com/D4saGHECICkCeoJm/arcgis/rest/services/FBCAD_Public_Data/FeatureServer/0";
export const TIRZ_LAYER = "https://gisportal.fortbendcountytx.gov/arcgis/rest/services/InteractiveMap/Boundaries_Public/MapServer/11";
export const FBCAD_RATES_URL = "https://www.fbcad.org/tax-rates/";
export const SOURCE = { source: "Fort Bend County Tax Office — adopted tax rates by taxing unit (FBCAD taxing-unit codes)", sourceUrl: `${PORTAL}/` };

const unescapeHtml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (m, g) => {
  if (g[0] === "#") return String.fromCodePoint(g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }[g.toLowerCase()];
});
const cellText = (s) => unescapeHtml(String(s).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
const rowsOf = (html) => [...String(html).matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) => ({
  th: [...m[1].matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((c) => cellText(c[1])),
  td: [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => cellText(c[1])),
}));

/** "C21,D01,G01,S07,CAD" → ["C21","D01","G01","S07","CAD"]. Pure. */
export const parseTaxUnitsField = (v) => [...new Set(String(v || "").split(/[,;]/).map((c) => c.trim().toUpperCase()).filter(Boolean))];

/** The portal's index page → { CODE: { name, type } }. Columns: Type · ID · Name · … (a hidden record-number cell leads). Pure. */
export function parsePortalIndex(html) {
  const out = {};
  for (const r of rowsOf(html)) {
    const i = r.td.findIndex((c) => /^[A-Z]{1,2}\d{1,4}$/.test(c));
    if (i < 1 || !r.td[i + 1]) continue;
    out[r.td[i]] = { type: r.td[i - 1], name: r.td[i + 1] };
  }
  return out;
}

/** A unit's portal page → [{ year, rate, mo, debt }] newest first (rate null = unreadable cell). Pure. */
export function parsePortalRates(html) {
  const out = [];
  let on = false;
  for (const r of rowsOf(html)) {
    if (r.th.some((c) => /^adopted tax rate$/i.test(c))) { on = true; continue; }
    if (!on || r.td.length < 4 || !/^\d{4}$/.test(r.td[0])) continue;
    const n = (v) => { const x = Number(v); return v !== "" && Number.isFinite(x) ? x : null; };
    out.push({ year: Number(r.td[0]), rate: n(r.td[1]), mo: n(r.td[2]), debt: n(r.td[3]) });
  }
  return out.sort((a, b) => b.year - a.year);
}

/** FBCAD's tax-rates table → { CODE: { name, type, stateNo, total } } where total is a number, "NA", or null (blank). Header-driven. Pure. */
export function parseFbcadLegend(html) {
  const out = {};
  let cols = null;
  for (const r of rowsOf(html)) {
    const cells = r.th.length ? r.th : r.td;
    if (!cols) {
      const at = (re) => cells.findIndex((c) => re.test(c));
      const code = at(/^code$/i), desc = at(/^description$/i), total = at(/^total rate$/i);
      if (code >= 0 && desc >= 0 && total >= 0) cols = { code, desc, total, type: at(/^type$/i), stateNo: at(/^state number$/i) };
      continue;
    }
    if (r.td.length <= cols.total) continue;
    const code = (r.td[cols.code] || "").toUpperCase();
    if (!/^[A-Z]{1,2}\d{1,4}$/.test(code)) continue;
    const raw = r.td[cols.total];
    out[code] = {
      name: r.td[cols.desc], type: cols.type >= 0 ? r.td[cols.type] : "", stateNo: cols.stateNo >= 0 ? r.td[cols.stateNo] : "",
      total: /^na$/i.test(raw) ? "NA" : raw !== "" && Number.isFinite(Number(raw)) ? Number(raw) : null,
    };
  }
  return out;
}

const r6 = (n) => Math.round(n * 1e6) / 1e6;
const ACRONYM = /^(ISD|CISD|MSD|MUD|WCID|ESD|FWSD|LID|MMD|PID|ID|UD|SUD|MD|TIRZ|HCC|[A-Z]{1,2}\d+|\d+[A-Z]?|C|[IVX]+)$/;
const titleCase = (s) => String(s).replace(/[A-Za-z0-9&']+/g, (w, off) => (ACRONYM.test(w) ? w : /^of$/i.test(w) && off > 0 ? "of" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
export const unitName = (raw) => {
  const s = String(raw || "").trim();
  const m = /^(.+?),\s*CITY OF$/i.exec(s);
  return titleCase(m ? `City of ${m[1]}` : s);
};

/** Is `rate` for a unit a REPORTED rate in `year` (see the header)? `hist` = [{year,rate}]. Pure. */
export function reportedIn(hist, year) {
  if (hist.length && hist.every((h) => !(h.rate > 0))) return true; // never showed a rate: a genuine zero in every year
  const row = hist.find((h) => h.year === year);
  return !!row && row.rate > 0;
}

/**
 * Pure assembly. `codes` = the account's TAXUNITS; `index` = parsePortalIndex; `hist` = { CODE: parsePortalRates };
 * `tirz` = { CODE: name } for T-codes the TIRZ layer knows; `fbcad` = parseFbcadLegend or null. Returns the taxunits shape.
 */
export function assemble({ codes, index, hist, tirz = {}, fbcad = null, maxYear = new Date().getUTCFullYear() }) {
  const levying = [], fixed = [];
  const bad = [];
  for (const code of codes) {
    if (code === "CAD") continue; // the appraisal district levies nothing
    const p = index[code];
    if (p) { levying.push({ code, name: unitName(p.name), type: p.type }); continue; }
    if (tirz[code]) { fixed.push({ code, name: unitName(tirz[code]), rate: 0, type: "TIRZ", note: "TIRZ — levies no tax" }); continue; }
    const f = fbcad && fbcad[code];
    if (f && f.total === "NA") { fixed.push({ code, name: unitName(f.name), rate: 0, type: f.type || "", note: "no adopted rate" }); continue; }
    bad.push(code);
  }
  if (bad.length) return { complete: false, reason: `no published rate for taxing unit${bad.length > 1 ? "s" : ""} ${bad.join(", ")} (Fort Bend publishes no adopted rate for ${bad.length > 1 ? "them" : "it"})` };
  const withHist = levying.map((u) => ({ ...u, hist: hist[u.code] || [] }));
  const years = [...new Set(withHist.flatMap((u) => u.hist.map((h) => h.year)))].filter((y) => y <= maxYear).sort((a, b) => b - a);
  if (!withHist.length) return { complete: false, reason: "no levying taxing unit is on record for this account" };
  const year = years.find((y) => withHist.every((u) => reportedIn(u.hist, y))) ?? null;
  if (year == null) {
    const none = withHist.filter((u) => !u.hist.length).map((u) => u.code);
    return { complete: false, reason: none.length ? `no rate history on the county portal for ${none.join(", ")}` : "no single tax year has an adopted rate for every taxing unit on this account" };
  }
  const units = withHist.map((u) => {
    const h = u.hist.find((x) => x.year === year);
    const never = !u.hist.some((x) => x.rate > 0);
    return { code: u.code, name: u.name, rate: never ? 0 : r6(h.rate), type: u.type, ...(never ? { note: "no adopted rate" } : {}) };
  }).concat(fixed);
  units.sort((a, b) => (a.code < b.code ? -1 : 1));
  return { complete: true, year, ...SOURCE, units, total: r6(units.reduce((s, u) => s + u.rate, 0)) };
}

/**
 * Network half. `get(url, { ttl })` → Response-like (ok/text/json) with the caller's caching; injectable for tests.
 * Returns the taxunits answer, or { complete:false, transient:true } when a source could not be reached.
 */
export async function lookupFortBend(acct, get) {
  const q = new URLSearchParams({ where: `QUICKREFID='${acct}'`, outFields: "QUICKREFID,TAXUNITS", returnGeometry: "false", f: "json" });
  let feats;
  try {
    const r = await get(`${FBCAD_LAYER}/query?${q}`, { ttl: 3600 });
    if (!r.ok) return { complete: false, transient: true, reason: "the FBCAD parcel service could not be reached just now" };
    const j = await r.json();
    if (j.error) return { complete: false, transient: true, reason: "the FBCAD parcel service could not be reached just now" };
    feats = j.features || [];
  } catch (_) { return { complete: false, transient: true, reason: "the FBCAD parcel service could not be reached just now" }; }
  if (!feats.length) return { complete: false, reason: `account ${acct} is not on the FBCAD parcel layer` };
  const field = feats[0].attributes && feats[0].attributes.TAXUNITS;
  const codes = parseTaxUnitsField(field);
  if (!codes.length) return { complete: false, reason: "FBCAD lists no taxing units for this account" };

  let index;
  try {
    const r = await get(`${PORTAL}/`, { ttl: 24 * 3600 });
    if (!r.ok) throw new Error("index");
    index = parsePortalIndex(await r.text());
    if (Object.keys(index).length < 50) throw new Error("index shape");
  } catch (_) { return { complete: false, transient: true, reason: "the Fort Bend County tax-rate portal could not be read just now" }; }

  const need = codes.filter((c) => c !== "CAD" && index[c]);
  const hist = {};
  try {
    await Promise.all(need.map(async (c) => {
      const r = await get(`${PORTAL}/Home/View_TaxUnit?VarTaxUnitID=${encodeURIComponent(c)}`, { ttl: 12 * 3600 });
      if (!r.ok) throw new Error(c);
      hist[c] = parsePortalRates(await r.text());
    }));
  } catch (_) { return { complete: false, transient: true, reason: "the Fort Bend County tax-rate portal could not be read just now" }; }

  const unknown = codes.filter((c) => c !== "CAD" && !index[c]);
  const tcodes = unknown.filter((c) => /^T\d+$/.test(c));
  const tirz = {};
  if (tcodes.length) {
    try {
      const tq = new URLSearchParams({ where: `ENTITYCODE IN (${tcodes.map((c) => `'${c}'`).join(",")})`, outFields: "NAME,ENTITYCODE", returnGeometry: "false", f: "json" });
      const r = await get(`${TIRZ_LAYER}/query?${tq}`, { ttl: 24 * 3600 });
      if (r.ok) for (const f of (await r.json()).features || []) if (f.attributes && f.attributes.ENTITYCODE) tirz[String(f.attributes.ENTITYCODE).toUpperCase()] = f.attributes.NAME || f.attributes.ENTITYCODE;
    } catch (_) { /* unknown TIRZ stays unknown → incomplete */ }
  }
  let fbcad = null;
  if (unknown.some((c) => !tirz[c])) {
    try {
      const r = await get(FBCAD_RATES_URL, { ttl: 24 * 3600 });
      if (r.ok) fbcad = parseFbcadLegend(await r.text());
    } catch (_) { /* best effort — absent means incomplete */ }
  }
  return assemble({ codes, index, hist, tirz, fbcad });
}
