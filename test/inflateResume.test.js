import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { inflateBlocks } from "../functions/api/lib/inflateResume.js";

// The resumable decoder must reproduce node:zlib byte for byte, whatever the block types and wherever it is
// paused and resumed (state = bit offset + last 32 KiB of output, round-tripped through plain data).
function textRoll(n) {
  let s = "acct\ttax_district\ttp_cd\tpct_district\tappraised_val\ttaxable_val\r\n";
  for (let i = 0; i < n; i++) {
    const a = String(100000000 + i * 37).padStart(13, "0");
    for (const [c, t] of [["001", "I"], ["040", "T"], ["041", "T"], ["640", "B"]]) s += `${a}\t${c}\t${t}\t1.0000\t${(i * 7919) % 1000003}\t0\r\n`;
  }
  return Buffer.from(s);
}
function random(n) { const b = Buffer.alloc(n); let x = 12345; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; b[i] = x >> 16; } return b; }

function runResumable(comp, { maxOut, margin = 64, fetchWindow = comp.length }) {
  const chunks = [];
  let bit = 0, win = new Uint8Array(0), calls = 0, done = false;
  while (!done) {
    const startByte = bit >> 3;
    const input = comp.subarray(startByte, Math.min(comp.length, startByte + fetchWindow)); // a ranged fetch
    const r = inflateBlocks({ input, startBit: bit & 7, window: win, maxOut, marginBytes: input.length === comp.length - startByte ? 0 : margin, onOut: (u) => chunks.push(Buffer.from(u)) });
    bit = startByte * 8 + r.bitPos; win = r.window; done = r.done;
    if (++calls > 5000) throw new Error("no progress");
  }
  return { out: Buffer.concat(chunks), calls };
}

describe("inflateBlocks vs node:zlib", () => {
  const cases = {
    "dynamic (text, level 6)": () => zlib.deflateRawSync(textRoll(3000), { level: 6 }),
    "dynamic, many small blocks (level 9, memLevel 1)": () => zlib.deflateRawSync(textRoll(1500), { level: 9, memLevel: 1 }),
    "fixed Huffman (strategy FIXED)": () => zlib.deflateRawSync(textRoll(300), { strategy: zlib.constants.Z_FIXED }),
    "stored blocks (level 0) and incompressible data": () => zlib.deflateRawSync(random(200000), { level: 0 }),
    "incompressible at level 6 (stored fallback)": () => zlib.deflateRawSync(random(100000), { level: 6 }),
  };
  const originals = {
    "dynamic (text, level 6)": () => textRoll(3000), "dynamic, many small blocks (level 9, memLevel 1)": () => textRoll(1500),
    "fixed Huffman (strategy FIXED)": () => textRoll(300), "stored blocks (level 0) and incompressible data": () => random(200000),
    "incompressible at level 6 (stored fallback)": () => random(100000),
  };
  for (const name of Object.keys(cases)) {
    it(`${name}: one shot`, () => {
      const comp = cases[name](), want = originals[name]();
      const { out } = runResumable(comp, { maxOut: Infinity });
      expect(out.equals(want)).toBe(true);
    });
    it(`${name}: paused after ~20 KB of output each time, resumed from a ranged fetch`, () => {
      const comp = cases[name](), want = originals[name]();
      // a fetch window must hold a whole block (stored blocks are up to 64 KiB), as the 4 MB window does in production
      const stored = /stored|incompressible/.test(name);
      const { out, calls } = runResumable(comp, { maxOut: 20000, fetchWindow: stored ? 200000 : 40000, margin: stored ? 70000 : 8000 });
      expect(out.equals(want)).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(1);
    });
  }
  it("a block that runs past the fetched input is rolled back, not half-committed", () => {
    const want = textRoll(3000), comp = zlib.deflateRawSync(want, { level: 6 });
    const chunks = [];
    const r = inflateBlocks({ input: comp.subarray(0, comp.length >> 1), onOut: (u) => chunks.push(Buffer.from(u)), marginBytes: 0 });
    expect(r.done).toBe(false);
    const got = Buffer.concat(chunks);
    expect(want.subarray(0, got.length).equals(got)).toBe(true); // a clean PREFIX of the original
    expect(got.length).toBeGreaterThan(0);
  });
  it("corrupt data is a loud error, never silent garbage", () => {
    expect(() => inflateBlocks({ input: Buffer.from([0xff, 0xff, 0xff, 0xff]), onOut() {}, marginBytes: 0 })).toThrow(/inflate/);
  });
});
