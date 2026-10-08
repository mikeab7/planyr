/* hcadIndex.js — the precomputed Harris account → taxing-units index (B2158065). Pure + stream-driven; no env.
 * See src/workspaces/site-planner/db/cad_taxunit_index.sql for the stored shape. */
import { scanZipEntryChunks, firstAcct, concatBytes } from "./zipRange.js";
import { buildUnits, parseJurValueLine } from "./hcadUnits.js";

export const PREFIX_LEN = 8;

/** [{code,type,pct}] → "016I,040T,046J@0.5". */
export const specOf = (parts) => parts.map((p) => `${p.code}${p.type}${p.pct !== 1 ? `@${p.pct}` : ""}`).join(",");
/** Inverse of specOf. */
export function parseSpec(spec) {
  return String(spec).split(",").filter(Boolean).map((t) => {
    const [head, pct] = t.split("@");
    return { code: head.slice(0, 3), type: head.slice(3), pct: pct == null ? 1 : Number(pct) };
  });
}

/**
 * Index one SLICE of jur_value.txt: whole 8-digit-prefix shards for accounts >= `from`, stopping at the first
 * prefix boundary after `maxLines` rows. Returns { shards: Map(prefix → "suffix=spec\n…"), accounts, lines,
 * next } where `next` is the `from` for the following slice (null at end of file). Reaching `from` costs only
 * a 13-byte look at each chunk, so a late slice never decodes the prefix before it.
 */
export async function indexSlice(url, entry, from, maxLines, fetchImpl, seg) {
  const dec = new TextDecoder();
  const shards = new Map();
  let mode = "skip", prev = null, carry = "", lines = 0, accounts = 0;
  let curAcct = null, curParts = [], limitPrefix = null, next = null;
  const flush = () => {
    if (!curAcct || !curParts.length) { curAcct = null; curParts = []; return; }
    const pre = curAcct.slice(0, PREFIX_LEN);
    if (!shards.has(pre)) shards.set(pre, []);
    shards.get(pre).push(`${curAcct.slice(PREFIX_LEN)}=${specOf(curParts)}`);
    accounts++; curAcct = null; curParts = [];
  };
  const feed = (text) => {
    carry += text;
    const L = carry.lastIndexOf("\n");
    if (L < 0) return false;
    const block = carry.slice(0, L + 1);
    carry = carry.slice(L + 1);
    for (const line of block.split("\n")) {
      const r = parseJurValueLine(line.replace(/\r$/, ""));
      if (!r || r.acct < from) continue;
      if (r.acct !== curAcct) {
        flush();
        if (!limitPrefix && lines >= maxLines) limitPrefix = r.acct.slice(0, PREFIX_LEN);
        if (limitPrefix && r.acct.slice(0, PREFIX_LEN) !== limitPrefix) { next = r.acct.slice(0, PREFIX_LEN) + "00000"; return true; }
        curAcct = r.acct;
      }
      lines++;
      if (r.pct > 0) curParts.push({ code: r.code, type: r.type, pct: r.pct });
    }
    return false;
  };
  const { stopped } = await scanZipEntryChunks(url, entry, (c) => {
    if (mode === "skip") {
      const fa = firstAcct(c);
      if (fa === null || fa < from) { prev = prev && fa === null ? concatBytes([prev, c]) : c; return false; }
      mode = "parse";
      if (prev && feed(dec.decode(prev, { stream: true }))) return true;
    }
    return feed(dec.decode(c, { stream: true }));
  }, fetchImpl, seg);
  if (!stopped) { feed("\n"); flush(); next = null; }
  const out = new Map();
  for (const [k, v] of shards) out.set(k, v.join("\n"));
  return { shards: out, accounts, lines, next };
}

/** Rate-table text → the stored '_rates' JSON object { code: [name, prop, curr] }. Pure (takes the parsed Map). */
export const ratesToJson = (map) => { const o = {}; for (const [c, r] of map) o[c] = [r.name, r.prop, r.curr]; return o; };
export const ratesFromJson = (o) => new Map(Object.entries(o).map(([c, [name, prop, curr]]) => [c, { name, prop, curr }]));

/**
 * Answer one account from rows read out of cad_taxunit_shards (`[{ roll_year, prefix, data }]`, covering the
 * account's shard plus '_meta' and '_rates' of every year present). Newest COMPLETE index year first; a year
 * whose rates are not yet adopted, or that does not hold the account, falls back to the previous year.
 * Returns the same shape as lookupHarris, or null when no complete index exists at all.
 */
export function answerFromIndex(acct, rows, source) {
  const years = [...new Set(rows.filter((r) => r.prefix === "_meta").map((r) => r.roll_year))].sort((a, b) => b - a);
  if (!years.length) return null;
  const pre = acct.slice(0, PREFIX_LEN), suf = acct.slice(PREFIX_LEN);
  let reason = `account ${acct} is not in the HCAD roll`;
  for (const year of years) {
    const rates = rows.find((r) => r.roll_year === year && r.prefix === "_rates");
    if (!rates) continue;
    const shard = rows.find((r) => r.roll_year === year && r.prefix === pre);
    const line = shard && shard.data.split("\n").find((l) => l.startsWith(suf + "="));
    if (!line) { reason = `account ${acct} is not in the ${year} HCAD roll`; continue; }
    const built = buildUnits(parseSpec(line.slice(6)).map((p) => ({ acct, ...p })), ratesFromJson(JSON.parse(rates.data)));
    if (built.complete) return { complete: true, year, indexed: true, ...source, units: built.units, total: built.total };
    reason = built.reason;
    if (!built.notAdopted) return { complete: false, year, indexed: true, reason };
  }
  return { complete: false, indexed: true, reason };
}
