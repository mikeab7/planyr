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
import { remoteZipEntries, scanZipEntryChunks, readZipEntryText } from "./zipRange.js";

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

/** The 13-digit account that starts the FIRST COMPLETE line of a chunk, or null. Bytes only — no decoding. */
function firstAcct(c) {
  const i = c.indexOf(10);
  if (i < 0 || i + 14 > c.length) return null;
  let s = "";
  for (let k = i + 1; k < i + 14; k++) { const b = c[k]; if (b < 48 || b > 57) return null; s += String.fromCharCode(b); }
  return s;
}
const concat = (parts) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/**
 * The account's rows from jur_value.txt. The file is ~570 MB and SORTED by account, and Cloudflare kills a Worker
 * whose JavaScript works too hard (error 1102) — decoding the whole prefix to text did exactly that for any
 * account past ~30% of the file. So a chunk is judged by the 13 bytes after its first newline alone: only the
 * chunk(s) where the account can live (from the last chunk starting before it, up to the first chunk starting
 * AFTER it) are ever decoded. An account's rows are contiguous, so that window holds all of them.
 */
export async function findAccountRows(url, entry, acct, fetchImpl, seg) {
  let cand = [];
  await scanZipEntryChunks(url, entry, (c) => {
    const f = firstAcct(c);
    if (f !== null && f > acct) { if (cand.length) cand.push(c); return true; }
    if (f !== null && f < acct) cand = [c];      // the account may still sit inside this chunk
    else cand.push(c);                            // starts exactly at / unknown: keep with the window
    return false;
  }, fetchImpl, seg);
  if (!cand.length) return [];
  const text = "\n" + new TextDecoder().decode(concat(cand));
  const needle = `\n${acct}\t`;
  const lines = [];
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + 1)) {
    lines.push(text.slice(at + 1, text.indexOf("\n", at + 1)).replace(/\r$/, ""));
  }
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
    const text = await readZipEntryText(url, entries["jur_tax_dist_exempt_value_rate.txt"], fetchImpl);
    const built = buildUnits(rows, parseRateTable(text));
    if (built.complete) {
      return { complete: true, year, source: "Harris Central Appraisal District — taxing units & adopted rates", sourceUrl: HCAD_PDATA_URL, units: built.units, total: built.total };
    }
    lastReason = built.reason;
    if (!built.notAdopted) return { complete: false, year, reason: built.reason };
  }
  return { complete: false, reason: lastReason };
}
