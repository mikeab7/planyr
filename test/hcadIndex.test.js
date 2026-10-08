import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { createIndexer, resumeStep, answerFromIndex, specOf, parseSpec } from "../functions/api/lib/hcadIndex.js";

// An account-sorted roll in jur_value.txt's exact shape, deflated by real zlib, then built through the SAME
// resumable path production uses (ranged reads, checkpoints round-tripped through JSON, tiny steps).
const UNITS = (i) => (i % 2 ? [["016", "I"], ["040", "T"], ["046", "J"]] : [["016", "I"], ["040", "T"], ["640", "B"]]);
const accts = [];
for (let i = 0; i < 4000; i++) accts.push(String(42103000000 + i * 9).padStart(13, "0"));
const PARTIAL = accts[1234];
const rollText = "acct\ttax_district\ttp_cd\tpct_district\tappraised_val\ttaxable_val\r\n" +
  accts.map((a, i) => UNITS(i).map(([c, t]) => `${a}\t${c}\t${t}\t${a === PARTIAL && c === "046" ? "0.5000" : "1.0000"}\t5\t0\r\n`).join("")).join("");
const comp = zlib.deflateRawSync(Buffer.from(rollText), { level: 6, memLevel: 4 });

async function buildAll({ fetchBytes, marginBytes }) {
  const shards = new Map();
  let state = null, steps = 0, done = false, accounts = 0;
  while (!done) {
    const r = await resumeStep({
      readRange: async (a, b) => new Uint8Array(comp.subarray(a, b + 1)), dataStart: 0, csize: comp.length,
      state, fetchBytes, marginBytes, maxOut: 30000,
    });
    for (const [k, v] of r.flushed) { expect(shards.has(k), `prefix ${k} written twice`).toBe(false); shards.set(k, v); }
    // the checkpoint must survive a JSON round trip (it is stored in a database row)
    state = r.state.ix === null ? r.state : { ...r.state, win: Uint8Array.from(Object.values(JSON.parse(JSON.stringify(Array.from(r.state.win))))), ix: JSON.parse(JSON.stringify(r.state.ix)) };
    done = r.done; accounts = r.state.accounts;
    if (++steps > 2000) throw new Error("no progress");
  }
  return { shards, steps, accounts };
}

describe("resumeStep → shards", () => {
  it("builds every account exactly once across many tiny resumable steps", async () => {
    const { shards, steps, accounts } = await buildAll({ fetchBytes: 12000, marginBytes: 3000 });
    expect(steps).toBeGreaterThan(5);
    expect(accounts).toBe(accts.length);
    const rates = { "016": ["GOOSE CREEK CISD", 1.07, 1.07], "040": ["HARRIS COUNTY", 0.38, 0.38096], "046": ["LEE JR COLLEGE DIST", 0.19, 0.18706], "640": ["HC EMERG SRV DIST 14", 0.09, 0.085] };
    const rows = [{ roll_year: 2025, prefix: "_meta", data: "{}" }, { roll_year: 2025, prefix: "_rates", data: JSON.stringify(rates) }];
    for (const i of [0, 1, 1233, 1234, 2500, 3999]) {
      const a = accts[i];
      const r = answerFromIndex(a, [...rows, { roll_year: 2025, prefix: a.slice(0, 8), data: shards.get(a.slice(0, 8)) }], { source: "s" });
      expect(r.complete, a).toBe(true);
      expect(r.units.map((u) => u.code), a).toEqual(UNITS(i).map(([c]) => c));
    }
  });
  it("one big step gives the same shards as many small ones", async () => {
    const a = await buildAll({ fetchBytes: 12000, marginBytes: 3000 });
    const b = await buildAll({ fetchBytes: comp.length, marginBytes: 0 });
    expect([...a.shards].sort()).toEqual([...b.shards].sort());
  });
});

describe("createIndexer", () => {
  it("a partial-lot unit keeps its share in the spec, and the slow path agrees with the fast path", () => {
    const ix = createIndexer();
    ix.feed(new TextEncoder().encode(`0421030000009\t016\tI\t1.0000\t5\t0\r\n0421030000009\t046\tJ\t0.5000\t5\t0\r\n0421030000018\t016\tI\t1.0000\t5\t0\r\n`));
    ix.finish();
    const [[prefix, data]] = ix.take();
    expect(prefix).toBe("04210300");
    expect(data.split("\n")).toEqual(["00009=016I,046J@0.5", "00018=016I"]);
  });
  it("chunk boundaries anywhere (even mid-line) give the same answer", () => {
    const bytes = new TextEncoder().encode(rollText.slice(0, 20000));
    const whole = createIndexer(); whole.feed(bytes); whole.finish();
    const bits = createIndexer();
    for (let i = 0; i < bytes.length; i += 17) bits.feed(bytes.subarray(i, i + 17));
    bits.finish();
    expect(bits.take()).toEqual(whole.take());
  });
  it("a snapshot taken mid-account resumes exactly", () => {
    const bytes = new TextEncoder().encode(rollText.slice(0, 5000));
    const ref = createIndexer(); ref.feed(bytes); ref.finish();
    const one = createIndexer(); one.feed(bytes.subarray(0, 1234));
    const two = createIndexer(JSON.parse(JSON.stringify(one.snapshot()))); two.feed(bytes.subarray(1234)); two.finish();
    expect([...one.take(), ...two.take()]).toEqual(ref.take());
  });
});

describe("answerFromIndex", () => {
  const rates = { "016": ["GOOSE CREEK CISD", 1.07, 1.07], "040": ["HARRIS COUNTY", 0.38, 0.0] };
  const meta = (y) => [{ roll_year: y, prefix: "_meta", data: "{}" }];
  it("spec round-trips, including a partial-lot unit", () => {
    const parts = [{ code: "016", type: "I", pct: 1 }, { code: "046", type: "J", pct: 0.5 }];
    expect(specOf(parts)).toBe("016I,046J@0.5");
    expect(parseSpec(specOf(parts))).toEqual(parts);
  });
  it("no index at all → null (caller falls back); account absent → incomplete, never an empty table", () => {
    expect(answerFromIndex("0421030000123", [], {})).toBeNull();
    const r = answerFromIndex("0421030000123", [...meta(2025), { roll_year: 2025, prefix: "_rates", data: JSON.stringify(rates) }], {});
    expect(r).toMatchObject({ complete: false, indexed: true });
  });
  it("a newer roll whose rates are not adopted falls back to the previous year's", () => {
    const rows = [...meta(2026), ...meta(2025),
      { roll_year: 2026, prefix: "_rates", data: JSON.stringify(rates) }, { roll_year: 2025, prefix: "_rates", data: JSON.stringify({ ...rates, "040": ["HARRIS COUNTY", 0.4, 0.38096] }) },
      { roll_year: 2026, prefix: "04210300", data: "00123=016I,040T" }, { roll_year: 2025, prefix: "04210300", data: "00123=016I,040T" }];
    expect(answerFromIndex("0421030000123", rows, {})).toMatchObject({ complete: true, year: 2025, total: 1.45096 });
  });
});
