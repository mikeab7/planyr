/* hcadIndex.js — the precomputed Harris account → taxing-units index (B2158065). Pure + range-driven; no env.
 * See src/workspaces/site-planner/db/cad_taxunit_index.sql for the stored shape.
 *
 * BUILDING IT: HCAD's jur_value.txt is one 61 MB deflate stream (573 MB of text, account-sorted) and one Worker
 * request can only afford a few seconds of CPU, so the build is RESUMABLE (lib/inflateResume.js): each
 * `resumeStep` fetches a few MB of the compressed stream from the saved bit offset, inflates whole blocks, folds
 * the text into per-account unit specs at the BYTE level (no string splitting — the line parse was the other half
 * of the cost), and returns the new checkpoint + the shards that are now complete.
 */
import { inflateBlocks } from "./inflateResume.js";
import { buildUnits, parseJurValueLine } from "./hcadUnits.js";

export const PREFIX_LEN = 8;

const spec1 = (code, type, pct) => `${typeof code === "number" ? String.fromCharCode((code >> 16) & 255, (code >> 8) & 255, code & 255) : code}${typeof type === "number" ? String.fromCharCode(type) : type}${pct !== 1 ? `@${pct}` : ""}`;
/** [{code,type,pct}] → "016I,040T,046J@0.5". */
export const specOf = (parts) => parts.map((p) => spec1(p.code, p.type, p.pct)).join(",");
/** Inverse of specOf. */
export function parseSpec(spec) {
  return String(spec).split(",").filter(Boolean).map((t) => {
    const [head, pct] = t.split("@");
    return { code: head.slice(0, 3), type: head.slice(3), pct: pct == null ? 1 : Number(pct) };
  });
}

const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return s; };
const unLatin1 = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; };
const ONE0000 = [49, 46, 48, 48, 48, 48]; // "1.0000"

/**
 * Folds jur_value.txt BYTES into shards. `feed(Uint8Array)` takes arbitrary chunk boundaries; completed prefix
 * shards come out of `take()`; `snapshot()` is plain JSON-able data so a later request can continue. Rows are
 * expected account-sorted (an account's rows contiguous), as HCAD publishes them.
 */
export function createIndexer(snap) {
  const s = snap || {};
  let carry = s.carry ? unLatin1(s.carry) : null;
  let curAcct = s.curAcct || null;
  let curBytes = new Uint8Array(13);
  if (curAcct) curBytes.set(unLatin1(curAcct));
  let codes = s.codes || [], types = s.types || [], pcts = s.pcts || [];
  let pending = s.pending || { prefix: null, lines: [] };
  const flushed = [];
  let accounts = 0;

  const endAcct = () => {
    if (!curAcct) return;
    if (codes.length) {
      const pre = curAcct.slice(0, PREFIX_LEN);
      if (pending.prefix !== pre) {
        if (pending.prefix !== null) flushed.push([pending.prefix, pending.lines.join("\n")]);
        pending = { prefix: pre, lines: [] };
      }
      let spec = "";
      for (let i = 0; i < codes.length; i++) spec += (i ? "," : "") + spec1(codes[i], types[i], pcts[i]);
      pending.lines.push(`${curAcct.slice(PREFIX_LEN)}=${spec}`);
      accounts++;
    }
    curAcct = null; codes = []; types = []; pcts = [];
  };
  const begin = (acctStr) => { endAcct(); curAcct = acctStr; curBytes.set(unLatin1(acctStr)); };

  const slow = (buf, a, e) => {
    let t = latin1(buf.subarray(a, e));
    if (t.endsWith("\r")) t = t.slice(0, -1);
    const r = parseJurValueLine(t);
    if (!r) return;
    if (r.acct !== curAcct) begin(r.acct);
    if (r.pct > 0) { codes.push(r.code); types.push(r.type); pcts.push(r.pct); }
  };

  const line = (buf, a, e) => {
    // Fast path: "<13 digits>\t<3-char code>\t<1-char type>\t1.0000\t…" — fixed offsets, no string work.
    if (e - a >= 27 && buf[a + 13] === 9 && buf[a + 17] === 9 && buf[a + 19] === 9 && buf[a + 26] === 9) {
      let full = true;
      for (let k = 0; k < 6; k++) if (buf[a + 20 + k] !== ONE0000[k]) { full = false; break; }
      if (full) {
        let same = curAcct !== null;
        if (same) for (let k = 0; k < 13; k++) if (buf[a + k] !== curBytes[k]) { same = false; break; }
        if (!same) {
          for (let k = 0; k < 13; k++) { const b = buf[a + k]; if (b < 48 || b > 57) { slow(buf, a, e); return; } }
          begin(latin1(buf.subarray(a, a + 13)));
        }
        codes.push((buf[a + 14] << 16) | (buf[a + 15] << 8) | buf[a + 16]); types.push(buf[a + 18]); pcts.push(1);
        return;
      }
    }
    slow(buf, a, e);
  };

  return {
    feed(chunk) {
      let buf = chunk;
      if (carry && carry.length) { buf = new Uint8Array(carry.length + chunk.length); buf.set(carry); buf.set(chunk, carry.length); }
      let start = 0;
      for (;;) {
        const nl = buf.indexOf(10, start);
        if (nl < 0) break;
        line(buf, start, nl);
        start = nl + 1;
      }
      carry = start < buf.length ? buf.slice(start) : null;
    },
    finish() {
      if (carry && carry.length) { line(carry, 0, carry.length); carry = null; }
      endAcct();
      if (pending.prefix !== null) { flushed.push([pending.prefix, pending.lines.join("\n")]); pending = { prefix: null, lines: [] }; }
    },
    take() { return flushed.splice(0); },
    get accounts() { return accounts; },
    snapshot() { return { carry: carry && carry.length ? latin1(carry) : "", curAcct, codes, types, pcts, pending }; },
  };
}

/**
 * One resumable build step. `readRange(a, b)` returns the entry's compressed bytes at absolute inclusive offsets;
 * `dataStart` is where the entry's compressed data begins and `csize` its length. `state` is the previous step's
 * returned state (null on the first). Returns { state, flushed:[[prefix, data]], done, stats }.
 */
export async function resumeStep({ readRange, dataStart, csize, state, budgetMs = 1500, fetchBytes = 6 << 20, marginBytes = 300000, maxOut = Infinity }) {
  const st = state || { bit: 0, win: new Uint8Array(0), ix: null, accounts: 0 };
  const ix = createIndexer(st.ix);
  const startByte = st.bit >> 3;
  const endByte = Math.min(csize, startByte + fetchBytes);
  const input = await readRange(dataStart + startByte, dataStart + endByte - 1);
  let outBytes = 0;
  const r = inflateBlocks({ input, startBit: st.bit & 7, window: st.win, deadline: Date.now() + budgetMs, maxOut, marginBytes: endByte >= csize ? 0 : marginBytes, onOut: (u) => { outBytes += u.length; ix.feed(u); } });
  const bit = startByte * 8 + r.bitPos;
  if (!r.done && bit === st.bit) throw new Error("resumable inflate made no progress (fetch window smaller than one block?)");
  if (r.done) ix.finish();
  return {
    state: { bit, win: r.window, ix: r.done ? null : ix.snapshot(), accounts: st.accounts + ix.accounts },
    flushed: ix.take(), done: r.done, stats: { outBytes, inBytes: (bit - st.bit) / 8 },
  };
}

/** Rate table → the stored '_rates' JSON object { code: [name, prop, curr] }. */
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
    const built = buildUnits(parseSpec(line.slice(suf.length + 1)).map((p) => ({ acct, ...p })), ratesFromJson(JSON.parse(rates.data)));
    if (built.complete) return { complete: true, year, indexed: true, ...source, units: built.units, total: built.total };
    reason = built.reason;
    if (!built.notAdopted) return { complete: false, year, indexed: true, reason };
  }
  return { complete: false, indexed: true, reason };
}
