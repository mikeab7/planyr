/* harrisTaxRates.js — Harris County's real, live, dated tax-rate source (NEW-1).
 *
 * `TAX_RATE_SOURCES.harris` in counties.js was `null` from the day the tax panel shipped — no
 * Texas county exposes a live per-parcel combined-rate API, so the panel could only ever show
 * "not connected." This module builds a real answer from two sources that ARE reachable:
 *
 *   1. `/api/taxrates?county=Harris` (functions/api/taxrates.js) — the Texas Comptroller's own
 *      published annual "Rates and Levies" workbooks, parsed server-side. Real, adopted, DATED
 *      rates — never a number typed from memory.
 *   2. `identifyJurisdiction` (jurisdiction.js) — the SAME live city-limits + school-district
 *      (ISD) spatial lookup the header jurisdiction badge already uses, so this can't disagree
 *      with what the rest of the app calls the site's city/ISD.
 *
 * WHAT IS AND ISN'T COVERED — read before treating `total` as complete. Every Harris parcel owes
 * Harris County's own rate plus three countywide entities (Hospital District, Dept. of
 * Education, Port of Houston Authority — matched by name, never hardcoded values) plus its city
 * (if any), its school district, and any MUD/WCID/LID/DD/FWSD/SUD/WID whose boundary covers the
 * point (spatially resolved against the registry's statewide district layer). That is what
 * `total` sums — but a spatially-resolved unit joins the sum ONLY when the Comptroller's own
 * workbook has a matching rate row for it, which (measured live, 2026-09-02) is often NOT the
 * case for a small or newly created district — a district can show up on the county's own GIS
 * boundary layer with no adopted-rate row anywhere yet, or under a name the two sources spell
 * differently. Such a unit is still LISTED (never silently dropped — that's the whole point of
 * naming it "highlight the MUD line"), just with its rate shown as "—" and excluded from `total`;
 * summing a rate with no way to tell "$0" from "unknown" would be worse than flagging it.
 * A management/improvement district, PID, or community-college assessment can ALSO apply and is
 * NOT checked at all yet — `note` always says so, in the same breath as what IS included, so the
 * number is never presented as more complete than it is.
 */
import { identifyJurisdiction, identifySource } from "./jurisdiction.js";
import { GIS_SOURCES } from "../../../shared/gis/sources.js";

const RATES_URL = "/api/taxrates?county=Harris";

// The registry's statewide MUD/water-district boundary layer (the SAME source + SWR cache
// detentionRules.js already queries for drainage criteria — `identifySource` rides gisCache, so
// this doesn't cost a second network round trip on a plan that already checked drainage) — reused
// rather than a Harris-specific endpoint, per the GIS source registry rule (no inline service
// URLs). B177 asked specifically for a highlighted MUD line ("the variable that drives the
// underwriting delta"): it is now spatially resolved — and MORE THAN ONE can genuinely cover a
// single point (measured live 2026-09-02: the Richfield Ranch tract sits inside BOTH a MUD and a
// separate WCID at once) — so this returns every matching district, never just the first. Per the
// module header, a resolved district's rate joins `total` only when the Comptroller's own
// workbook has a matching row for it, which measured live is often NOT the case for a small or
// newly created district. `PARCEL_DISTRICT_TYPES` is a deliberate, minimal duplicate of
// `detentionRules.PARCEL_DISTRICT_TYPES` (same 7 codes) rather than an import of that whole
// module into this lazy chunk for one constant — the layer also carries county-blanket
// authorities (Coastal Water Authority, Port of Houston, river authorities) that must be
// excluded or every Harris point would read "in a district".
const PARCEL_DISTRICT_TYPES = new Set(["MUD", "WCID", "LID", "DD", "FWSD", "SUD", "WID"]);
const MUD_SOURCE = {
  id: "mud", role: "mud", label: "MUD / water district", kind: "polygon",
  url: `${GIS_SOURCES.mud.serviceUrl}/${GIS_SOURCES.mud.layerId}`,
  fields: GIS_SOURCES.mud.fields, ttl: 30 * 24 * 3600 * 1000, sourceName: GIS_SOURCES.mud.provider,
};
async function resolveMudDistricts(lng, lat) {
  try {
    const r = await identifySource(MUD_SOURCE, { lng, lat }).fresh;
    if (r.error) return [];
    return r.items
      .map((it) => ({ name: it.attrs[MUD_SOURCE.fields.name], type: String(it.attrs[MUD_SOURCE.fields.type] || "").toUpperCase() }))
      .filter((d) => d.name && PARCEL_DISTRICT_TYPES.has(d.type))
      .map((d) => String(d.name).trim());
  } catch (_) {
    return []; // an outage here degrades to "not checked", never a false "no district"
  }
}

// Countywide special-purpose taxing entities that apply to every Harris parcel, matched by NAME
// PATTERN against the Comptroller's special-district workbook — never a hardcoded rate. Kept
// deliberately short and specific: a management/improvement district or a MUD must never match
// one of these, or an area-specific assessment would silently apply everywhere.
const COUNTYWIDE_SPECIAL = [
  { label: "Harris County Hospital District", re: /^harris county hospital district$/i },
  { label: "Harris Co. Department of Education", re: /^harris co(unty)?\.? department of education/i },
  { label: "Port of Houston Authority", re: /^port of houston authority$/i },
];

/** Case/whitespace/punctuation-insensitive unit-name match. Not fuzzy beyond that — a real
 * near-miss (e.g. a typo'd district name) stays unmatched rather than guessed at. Pure. */
function normalizeUnitName(s) {
  return String(s || "").toLowerCase().replace(/^city of\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function findRate(rows, name) {
  const want = normalizeUnitName(name);
  if (!want) return null;
  const hit = (rows || []).find((r) => normalizeUnitName(r.name) === want);
  return hit ? hit.rate : null;
}
const fmtRate = (r) => `${r.toFixed(5)} / $100`;

let ratesPromise = null;
function fetchHarrisRates() {
  if (!ratesPromise) {
    ratesPromise = fetch(RATES_URL)
      .then((r) => { if (!r.ok) return r.json().then((b) => { throw new Error(b?.error || `HTTP ${r.status}`); }); return r.json(); })
      .catch((e) => { ratesPromise = null; throw e; }); // never cache a failure — the next selection retries
  }
  return ratesPromise;
}

export async function resolveHarrisTaxRates({ lng, lat }) {
  const [rates, jur, mudNames] = await Promise.all([
    fetchHarrisRates(),
    identifyJurisdiction(lng, lat, { roles: ["city", "isd"] }).catch(() => null),
    resolveMudDistricts(lng, lat),
  ]);

  const units = [];
  const matched = [];
  const unmatched = [];
  const add = (name, rate, note) => {
    units.push({ name, value: rate != null ? fmtRate(rate) : "—" });
    if (rate != null) matched.push({ name, rate }); else unmatched.push(note ? `${name} (${note})` : name);
  };

  add(`${rates.county.name} County`, rates.county.rate);

  const cityNames = jur?.city || [];
  if (!cityNames.length) {
    units.push({ name: "City", value: "unincorporated" });
  } else {
    for (const name of cityNames) add(name, findRate(rates.cities, name), "not in the Comptroller's city workbook");
  }

  const isdNames = jur?.isd || [];
  if (!isdNames.length) {
    units.push({ name: "School district", value: "not resolved" });
    unmatched.push("school district (couldn't identify one at this point)");
  } else {
    for (const name of isdNames) add(name, findRate(rates.isds, name), "not in the Comptroller's school-district workbook");
  }

  for (const cw of COUNTYWIDE_SPECIAL) {
    const row = (rates.special || []).find((r) => cw.re.test(r.name));
    if (row) add(cw.label, row.rate);
  }

  // The MUD/WCID/etc. line(s) B177 asked to be highlighted — always shown when one covers this
  // point (more than one genuinely can, at once), each rate joining `total` only when the
  // Comptroller's workbook actually has it.
  for (const name of mudNames) add(name, findRate(rates.special, name), "no adopted rate on record with the Comptroller yet");

  const total = matched.reduce((s, u) => s + u.rate, 0);
  const noteParts = [
    `${rates.year} rates, as reported by the Comptroller${rates.versionDate ? ` as of ${rates.versionDate}` : ""}.`,
    `Includes ${matched.map((u) => u.name).join(", ")}.`,
    unmatched.length ? `Not included: ${unmatched.join("; ")}.` : null,
    "Community-college and other special-purpose district assessments beyond a MUD/WCID/ESD-type line are not checked yet — they can add materially on a served or platted site.",
  ].filter(Boolean).join(" ");

  return {
    units,
    rates: null,
    total: matched.length ? Number(total.toFixed(5)) : null,
    connected: true,
    taxYear: rates.year,
    versionDate: rates.versionDate,
    source: rates.source,
    note: noteParts,
  };
}
