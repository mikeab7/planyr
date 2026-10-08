/* hcadUnits.js — Harris County: one CAD account → its COMPLETE taxing-unit list + adopted rates (B2158065).
 *
 * SOURCE (measured from Cloudflare 2026-10-08; the build sandbox cannot reach it): HCAD's published
 * appraisal data, https://download.hcad.org/data/CAMA/<year>/Real_jur_exempt.zip (+ pdata page
 * https://hcad.org/hcad-online-services/pdata/):
 *   jur_value.txt                        acct · tax_district · tp_cd · pct_district · appraised · taxable
 *                                         — one row per taxing unit the CAD assigns the account (sorted by acct)
 *   jur_tax_dist_exempt_value_rate.txt   RP_TYPE · tax_dist · name · exempt_cd · prop · curr · …
 *                                         — `name` is the CAD's own unit name; `curr` the tax year's adopted rate
 *                                         per $100 (`prop` = the prior year's). Same value on every exempt_cd row.
 * Nothing here is inferred: a unit's name and rate come from the rate file row for ITS code, or the answer is
 * incomplete and the table stays hidden (owner rule — a partial list understates the total).
 * Verified against HCAD's own page for acct 0591420000105: 016/040/041/042/043/044/046/640, total 1.970988.
 */
import { remoteZipEntries, scanZipEntryBlocks } from "./zipRange.js";

export const HCAD_PDATA_URL = "https://hcad.org/hcad-online-services/pdata/";
export const hcadZipUrl = (year) => `https://download.hcad.org/data/CAMA/${year}/Real_jur_exempt.zip`;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/** One `jur_value.txt` line → { acct, code, type, pct } or null (header / blank / short). Pure. */
export function parseJurValueLine(line) {
  const f = line.split("\t");
  if (f.length < 4 || !/^\d{13}$/.test(f[0])) return null;
  const pct = Number(f[3]);
  return { acct: f[0], code: f[1], type: f[2], pct: Number.isFinite(pct) ? pct : 1 };
}

/** Rate-file text → Map(code → { name, prop, curr }) from the first `Real` row of each unit. Pure. */
export function parseRateTable(text) {
  const out = new Map();
  for (const raw of String(text).split("\n")) {
    const f = raw.replace(/\r$/, "").split("\t");
    if (f.length < 6 || f[0] !== "Real" || out.has(f[1])) continue;
    const prop = Number(f[4]), curr = Number(f[5]);
    if (!Number.isFinite(prop) || !Number.isFinite(curr)) continue;
    out.set(f[1], { name: f[2].trim(), prop, curr });
  }
  return out;
}

/**
 * Join an account's unit rows with the rate table. Pure.
 *  → { complete:true, units:[{code,name,rate,type}], total }
 *  | { complete:false, reason, notAdopted? }   (notAdopted: a later roll should be tried at an earlier year)
 */
export function buildUnits(rows, rates) {
  if (!rows.length) return { complete: false, reason: "account not found in the CAD roll" };
  const units = [];
  for (const r of rows) {
    if (!(r.pct > 0)) continue;
    const rt = rates.get(r.code);
    if (!rt) {
      if (r.type === "Z") continue; // a TIRZ captures increment; it levies no rate of its own
      return { complete: false, reason: `no adopted rate published for unit ${r.code}` };
    }
    if (rt.curr === 0 && rt.prop > 0) return { complete: false, notAdopted: true, reason: `${rt.name} has not adopted a rate for this year yet` };
    if (rt.curr === 0) continue; // genuinely a zero-rate unit
    units.push({ code: r.code, name: rt.name, rate: rt.curr, type: r.type });
  }
  if (!units.length) return { complete: false, reason: "no taxing unit with an adopted rate" };
  return { complete: true, units, total: round6(units.reduce((s, u) => s + u.rate, 0)) };
}

/**
 * The account's rows from jur_value.txt, found with native substring search over whole blocks (no per-line JS —
 * a per-line parse of the ~1.8M-line prefix exceeded the Worker CPU budget, error 1102). The file is sorted by
 * account, so an account's rows are CONTIGUOUS: reading stops as soon as a different line follows a match.
 * Pure given `scan`.
 */
export async function findAccountRows(url, entry, acct, fetchImpl) {
  const needle = `\n${acct}\t`;
  const lines = [];
  let seen = false, tail = "\n"; // `tail` carries the boundary newline so a match at a block start is found
  await scanZipEntryBlocks(url, entry, (blk) => {
    const text = tail + blk;
    let at = text.indexOf(needle), lastEnd = -1;
    while (at !== -1) {
      const end = text.indexOf("\n", at + 1);
      lines.push(text.slice(at + 1, end).replace(/\r$/, ""));
      lastEnd = end;
      at = text.indexOf(needle, end);
    }
    if (lastEnd !== -1) seen = true;
    tail = "\n";
    // contiguous group: stop once a non-matching line follows a hit (or a whole block passes with none after hits)
    if (lastEnd !== -1) return lastEnd < text.length - 1;
    return seen;
  }, fetchImpl);
  return lines.map(parseJurValueLine).filter(Boolean);
}

/** Latest roll year first. Tries the current year, then the previous one (a roll appears once HCAD publishes it). */
export async function lookupHarris(acct, { years, fetchImpl = fetch } = {}) {
  const now = new Date().getUTCFullYear();
  const tryYears = years || [now, now - 1];
  let lastReason = "no HCAD roll published";
  for (const year of tryYears) {
    const url = hcadZipUrl(year);
    const entries = await remoteZipEntries(url, fetchImpl);
    if (!entries || !entries["jur_value.txt"] || !entries["jur_tax_dist_exempt_value_rate.txt"]) continue;
    const rows = await findAccountRows(url, entries["jur_value.txt"], acct, fetchImpl);
    if (!rows.length) { lastReason = `account ${acct} is not in the ${year} HCAD roll`; continue; }
    let text = "";
    await scanZipEntryBlocks(url, entries["jur_tax_dist_exempt_value_rate.txt"], (blk) => { text += blk; return false; }, fetchImpl);
    const built = buildUnits(rows, parseRateTable(text));
    if (built.complete) {
      return { complete: true, year, source: "Harris Central Appraisal District — taxing units & adopted rates", sourceUrl: HCAD_PDATA_URL, units: built.units, total: built.total };
    }
    lastReason = built.reason;
    if (!built.notAdopted) return { complete: false, year, reason: built.reason };
  }
  return { complete: false, reason: lastReason };
}
