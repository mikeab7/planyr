import { describe, it, expect } from "vitest";
import { indexSlice, answerFromIndex, specOf, parseSpec, ratesToJson } from "../functions/api/lib/hcadIndex.js";
import { parseRateTable } from "../functions/api/lib/hcadUnits.js";

// A synthetic account-sorted roll in jur_value.txt's exact shape, fed through the real chunk/segment reader.
const accts = [];
for (let b = 0; b < 40; b++) for (let k = 1; k <= 7; k++) accts.push(`04210300${String(b).padStart(2, "0")}${String(k * 11).padStart(3, "0")}`.slice(0, 13));
const UNITS = (a) => (Number(a.slice(-1)) % 2 ? [["016", "I"], ["040", "T"], ["046", "J"]] : [["016", "I"], ["040", "T"], ["640", "B"]]);
const FILE = "acct\ttax_district\ttp_cd\tpct_district\tappraised_val\ttaxable_val\r\n" +
  accts.map((a) => UNITS(a).map(([c, t]) => `${a}\t${c}\t${t}\t1.0000\t5\t0\r\n`).join("")).join("");
const enc = new TextEncoder().encode(FILE);
const entry = { method: 0, csize: enc.length, off: 0 };
const fetchStub = async (_u, o) => {
  const m = /bytes=(\d+)-(\d+)/.exec(o.headers.range);
  const s = Number(m[1]), e = Math.min(enc.length + 29, Number(m[2]));
  if (s === 0 && e === 63) return new Response(new Uint8Array(64), { status: 206 });
  return new Response(enc.slice(s - 30, e - 30 + 1), { status: 206 });
};

async function buildAll(maxLines, seg) {
  const shards = new Map();
  let from = "", guard = 0, accounts = 0;
  do {
    const r = await indexSlice("u", entry, from, maxLines, fetchStub, seg);
    for (const [k, v] of r.shards) { expect(shards.has(k), `prefix ${k} written by two slices`).toBe(false); shards.set(k, v); }
    accounts += r.accounts;
    from = r.next;
  } while (from && ++guard < 500);
  return { shards, accounts };
}

describe("indexSlice", () => {
  for (const [max, seg] of [[20, 61], [50, 127], [1e9, 4096]]) {
    it(`slices (max ${max}, chunk ${seg}) cover every account exactly once`, async () => {
      const { shards, accounts } = await buildAll(max, seg);
      expect(accounts).toBe(accts.length);
      const rates = { "016": ["GOOSE CREEK CISD", 1.07, 1.07], "040": ["HARRIS COUNTY", 0.38, 0.38096], "046": ["LEE JR COLLEGE DIST", 0.19, 0.18706], "640": ["HC EMERG SRV DIST 14", 0.09, 0.085] };
      const rows = [{ roll_year: 2025, prefix: "_meta", data: "{}" }, { roll_year: 2025, prefix: "_rates", data: JSON.stringify(rates) }];
      for (const a of [accts[0], accts[17], accts[accts.length - 1]]) {
        const r = answerFromIndex(a, [...rows, { roll_year: 2025, prefix: a.slice(0, 8), data: shards.get(a.slice(0, 8)) }], { source: "s" });
        expect(r.complete, a).toBe(true);
        expect(r.units.map((u) => u.code)).toEqual(UNITS(a).map(([c]) => c));
      }
    });
  }
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
    const r = answerFromIndex("0421030000123", rows, {});
    expect(r).toMatchObject({ complete: true, year: 2025, total: 1.45096 });
  });
});
