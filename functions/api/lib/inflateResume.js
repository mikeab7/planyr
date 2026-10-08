/* inflateResume.js — a RESUMABLE raw-DEFLATE decoder (B2158065).
 *
 * WHY: HCAD's account → taxing-unit roll is one 61 MB deflate stream (573 MB of text). Inflating it costs more
 * CPU than one Cloudflare Worker request is allowed (error 1102 at ~3 s, measured), and DEFLATE cannot be entered
 * mid-stream. But a stream can be paused at any BLOCK BOUNDARY: all that later blocks need is where the next
 * block starts (a bit offset) and the last 32 KiB of output (the back-reference window). So one request decodes
 * for a time budget, stops at a block boundary, and returns that state; the next request resumes from it.
 *
 * inflateBlocks({ input, startBit, window, maxOut, deadline, marginBytes, onOut, cap }) decodes whole blocks from
 * `input` (starting `startBit` bits in), hands each committed block's bytes to onOut(Uint8Array), and returns
 *   { bitPos, done, window }  — bitPos is RELATIVE to input[0] at the last committed block boundary.
 * NB `deadline` uses Date.now(), which a Cloudflare Worker FREEZES during pure computation — in a Worker bound the work
 * with `maxOut` (output bytes) instead; `deadline` is for Node/tests. A block that runs past the end of `input` is rolled back (never half-committed). Pure; no I/O.
 * Verified against node:zlib in test/inflateResume.test.js (stored, fixed and dynamic blocks, many resume points).
 */
const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const WIN = 32768;

class NeedMore extends Error {}

/** Canonical Huffman → direct lookup table indexed by the next `max` input bits (LSB first). Entry = (len<<16)|sym. */
function buildTable(lengths, n) {
  const count = new Uint16Array(16);
  let max = 0;
  for (let i = 0; i < n; i++) { count[lengths[i]]++; if (lengths[i] > max) max = lengths[i]; }
  if (max === 0) return { table: new Int32Array(1), max: 0 };
  const next = new Uint16Array(17);
  let code = 0;
  count[0] = 0;
  for (let l = 1; l <= 15; l++) { code = (code + count[l - 1]) << 1; next[l] = code; }
  const table = new Int32Array(1 << max);
  for (let sym = 0; sym < n; sym++) {
    const len = lengths[sym];
    if (!len) continue;
    let c = next[len]++, r = 0;
    for (let b = 0; b < len; b++) { r = (r << 1) | (c & 1); c >>= 1; }
    const entry = (len << 16) | sym;
    for (let k = r; k < table.length; k += 1 << len) table[k] = entry;
  }
  return { table, max };
}

let FIXED = null;
function fixedTables() {
  if (FIXED) return FIXED;
  const l = new Uint8Array(288);
  for (let i = 0; i < 144; i++) l[i] = 8;
  for (let i = 144; i < 256; i++) l[i] = 9;
  for (let i = 256; i < 280; i++) l[i] = 7;
  for (let i = 280; i < 288; i++) l[i] = 8;
  const d = new Uint8Array(30).fill(5);
  FIXED = { lit: buildTable(l, 288), dist: buildTable(d, 30) };
  return FIXED;
}

export function inflateBlocks({ input, startBit = 0, window = new Uint8Array(0), maxOut = Infinity, deadline = Infinity, marginBytes = 262144, onOut, cap = 1 << 24 }) {
  const out = new Uint8Array(WIN + cap);
  const wlen = Math.min(window.length, WIN);
  if (wlen) out.set(window.subarray(window.length - wlen), 0);
  let op = wlen, cp = wlen, emitted = 0;
  let ip = startBit >> 3, bb = 0, bc = 0;
  const inLen = input.length;

  const need = (n) => { while (bc < n) { bb |= (ip < inLen ? input[ip] : 0) << bc; ip++; bc += 8; } };
  const bits = (n) => { need(n); const v = bb & ((1 << n) - 1); bb >>>= n; bc -= n; return v; };

  if (startBit & 7) bits(startBit & 7);
  let boundary = ip * 8 - bc;
  let done = false;

  const decodeBlock = () => {
    const final = bits(1), type = bits(2);
    if (type === 0) {
      bb >>>= bc & 7; bc -= bc & 7;
      const len = bits(16), nlen = bits(16);
      if ((len ^ 0xffff) !== nlen) throw new Error("inflate: bad stored block");
      ip -= bc >> 3; bb = 0; bc = 0;
      if (ip + len > inLen) throw new NeedMore();
      if (op + len > out.length) throw new Error("inflate: block larger than the output cap");
      out.set(input.subarray(ip, ip + len), op);
      op += len; ip += len;
      return final;
    }
    let lit, dist;
    if (type === 1) ({ lit, dist } = fixedTables());
    else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) cl[CLORDER[i]] = bits(3);
      const clt = buildTable(cl, 19);
      const lens = new Uint8Array(nlen + ndist);
      let i = 0;
      while (i < nlen + ndist) {
        need(15);
        const e = clt.table[bb & ((1 << clt.max) - 1)], l = e >>> 16;
        if (!l) throw new Error("inflate: bad code-length code");
        bb >>>= l; bc -= l;
        const sym = e & 0xffff;
        if (sym < 16) lens[i++] = sym;
        else {
          let rep, val = 0;
          if (sym === 16) { if (!i) throw new Error("inflate: repeat with no previous length"); val = lens[i - 1]; rep = 3 + bits(2); }
          else if (sym === 17) rep = 3 + bits(3);
          else rep = 11 + bits(7);
          if (i + rep > nlen + ndist) throw new Error("inflate: too many code lengths");
          while (rep--) lens[i++] = val;
        }
        if (ip > inLen + 4) throw new NeedMore();
      }
      lit = buildTable(lens.subarray(0, nlen), nlen);
      dist = buildTable(lens.subarray(nlen), ndist);
    } else throw new Error("inflate: bad block type");

    const lt = lit.table, lmask = (1 << lit.max) - 1, dt = dist.table, dmask = (1 << dist.max) - 1;
    for (;;) {
      if (ip > inLen + 4) throw new NeedMore();
      need(15);
      const e = lt[bb & lmask], l = e >>> 16;
      if (!l) throw new Error("inflate: bad literal/length code");
      bb >>>= l; bc -= l;
      const sym = e & 0xffff;
      if (sym < 256) { if (op >= out.length) throw new Error("inflate: block larger than the output cap"); out[op++] = sym; continue; }
      if (sym === 256) break;
      const s = sym - 257;
      if (s >= 29) throw new Error("inflate: bad length symbol");
      let len = LBASE[s];
      const le = LEXT[s];
      if (le) { need(le); len += bb & ((1 << le) - 1); bb >>>= le; bc -= le; }
      need(15);
      const de = dt[bb & dmask], dl = de >>> 16;
      if (!dl) throw new Error("inflate: bad distance code");
      bb >>>= dl; bc -= dl;
      const ds = de & 0xffff;
      if (ds >= 30) throw new Error("inflate: bad distance symbol");
      let d = DBASE[ds];
      const dxe = DEXT[ds];
      if (dxe) { need(dxe); d += bb & ((1 << dxe) - 1); bb >>>= dxe; bc -= dxe; }
      if (d > op) throw new Error("inflate: distance too far back");
      if (op + len > out.length) throw new Error("inflate: block larger than the output cap");
      for (let k = 0; k < len; k++, op++) out[op] = out[op - d];
    }
    return final;
  };

  for (;;) {
    if (done) break;
    if (emitted >= maxOut || Date.now() >= deadline) break;
    if (inLen * 8 - boundary < marginBytes * 8) break; // too close to the end of what was fetched for a whole block
    let final;
    const saveOp = op;
    try { final = decodeBlock(); } catch (e) {
      if (e instanceof NeedMore) { op = saveOp; break; }
      throw e;
    }
    const consumed = ip * 8 - bc;
    if (consumed > inLen * 8) { op = saveOp; break; } // the block read zero padding past the input: roll it back
    if (op > cp) { onOut(out.subarray(cp, op)); emitted += op - cp; cp = op; }
    boundary = consumed;
    if (final) done = true;
    if (op > WIN + (cap >> 1)) { out.copyWithin(0, op - WIN, op); op = WIN; cp = WIN; }
  }
  return { bitPos: boundary, done, window: out.slice(Math.max(0, cp - WIN), cp) };
}
