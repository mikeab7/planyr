import { describe, it, expect, vi } from "vitest";
import { findAccountRows, hcadZipUrl, parseJurValueLine, parseRateTable, buildUnits, lookupHarris } from "../functions/api/lib/hcadUnits.js";

// Ground truth (Cowork, search.hcad.org, acct 0591420000105, 2025 rates per $100) and the HCAD bulk-data
// rows measured from download.hcad.org on 2026-10-08.
const ACCT = "0591420000105";
const JUR = [
  "acct\ttax_district\ttp_cd\tpct_district\tappraised_val\ttaxable_val",
  "0010010000013\t001\tI\t1.0000\t1217073\t0",
  ...[["016", "I"], ["040", "T"], ["041", "T"], ["042", "T"], ["043", "T"], ["044", "T"], ["046", "J"], ["640", "B"]].map(([c, t]) => `${ACCT}\t${c}\t${t}\t1.0000\t1574335\t0`),
  "0591420000110\t044\tT\t1.0000\t43560\t43560",
].join("\r\n");
const RATE_ROWS = { "016": ["GOOSE CREEK CISD", 1.0725, 1.07], "040": ["HARRIS COUNTY", 0.4, 0.38096], "041": ["HARRIS CO FLOOD CNTRL", 0.05, 0.04966], "042": ["PORT OF HOUSTON AUTHY", 0.006, 0.0059],
  "043": ["HARRIS CO HOSP DIST", 0.19, 0.18761], "044": ["HARRIS CO EDUC DEPT", 0.005, 0.004798], "046": ["LEE JR COLLEGE DIST", 0.19, 0.18706], "640": ["HC EMERG SRV DIST 14", 0.09, 0.085], "265": ["TIRZ X", 0, 0] };
const RATES = ["RP_TYPE\ttax_dist\tname\texempt_cd\tprop\tcurr\texempt_val\texempt_rate",
  ...Object.entries(RATE_ROWS).flatMap(([c, [n, p, cu]]) => ["APD", "APO"].map((x) => `Real\t${c}\t${n}\t${x}\t${p.toFixed(6)}\t${cu.toFixed(6)}\t0\t0.000000`))].join("\r\n");

describe("hcadUnits pure parts", () => {
  it("parses unit rows and skips headers", () => {
    expect(parseJurValueLine(JUR.split("\r\n")[0])).toBeNull();
    expect(parseJurValueLine(`${ACCT}\t016\tI\t1.0000\t1\t0`)).toEqual({ acct: ACCT, code: "016", type: "I", pct: 1 });
  });
  it("takes name + current-year rate from the first Real row of each unit", () => {
    const m = parseRateTable(RATES);
    expect(m.get("016")).toEqual({ name: "GOOSE CREEK CISD", prop: 1.0725, curr: 1.07 });
    expect(m.size).toBe(9);
  });
  it("reproduces HCAD's own eight rows and the 1.970988 total", () => {
    const rows = JUR.split("\r\n").map(parseJurValueLine).filter((r) => r && r.acct === ACCT);
    const b = buildUnits(rows, parseRateTable(RATES));
    expect(b.complete).toBe(true);
    expect(b.units.map((u) => u.code)).toEqual(["016", "040", "041", "042", "043", "044", "046", "640"]);
    expect(b.units[0]).toMatchObject({ name: "GOOSE CREEK CISD", rate: 1.07 });
    expect(b.total).toBe(1.970988);
  });
  it("is INCOMPLETE (hidden) when a unit has no rate row, or has not adopted this year's rate", () => {
    const rows = [{ acct: ACCT, code: "999", type: "W", pct: 1 }];
    expect(buildUnits(rows, parseRateTable(RATES)).complete).toBe(false);
    const rates = parseRateTable(RATES.replace("0.380960", "0.000000"));
    const r = buildUnits([{ acct: ACCT, code: "040", type: "T", pct: 1 }], rates);
    expect(r).toMatchObject({ complete: false, notAdopted: true });
    expect(buildUnits([], rates).complete).toBe(false);
  });
  it("a TIRZ with no rate row levies nothing and is skipped; a zero-rate unit too", () => {
    const rows = [{ acct: ACCT, code: "040", type: "T", pct: 1 }, { acct: ACCT, code: "576", type: "Z", pct: 1 }, { acct: ACCT, code: "265", type: "Z", pct: 1 }];
    const b = buildUnits(rows, parseRateTable(RATES));
    expect(b.units.map((u) => u.code)).toEqual(["040"]);
  });
});

describe("lookupHarris (stubbed zip)", () => {
  const stubFiles = { "jur_value.txt": JUR, "jur_tax_dist_exempt_value_rate.txt": RATES };
  async function rangedFetch() {
    // Build a real stored (method 0) zip in memory so the whole ranged-read path runs.
    const enc = new TextEncoder();
    const parts = [], central = [];
    let off = 0;
    for (const [name, text] of Object.entries(stubFiles)) {
      const data = enc.encode(text), nm = enc.encode(name);
      const lh = new Uint8Array(30 + nm.length); const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(26, nm.length, true); lh.set(nm, 30);
      parts.push(lh, data);
      const ch = new Uint8Array(46 + nm.length); const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 0, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nm.length, true); cv.setUint32(42, off, true); ch.set(nm, 46);
      central.push(ch); off += lh.length + data.length;
    }
    const cdSize = central.reduce((s, c) => s + c.length, 0);
    const eocd = new Uint8Array(22); const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, central.length, true); ev.setUint32(12, cdSize, true); ev.setUint32(16, off, true);
    const all = new Uint8Array([...parts, ...central, eocd].reduce((a, p) => a + p.length, 0));
    let p = 0; for (const x of [...parts, ...central, eocd]) { all.set(x, p); p += x.length; }
    return vi.fn(async (url, opts) => {
      if (!url.includes("/2026/")) return new Response("nope", { status: 404 });
      const m = /bytes=(-?)(\d+)-?(\d*)/.exec(opts.headers.range);
      const [s, e] = m[1] === "-" ? [Math.max(0, all.length - Number(m[2])), all.length - 1] : [Number(m[2]), Math.min(all.length - 1, Number(m[3]))];
      const slice = all.slice(s, e + 1);
      // deliver in 37-byte chunks so account groups and lines straddle chunk boundaries
      const body = new ReadableStream({ start(c) { for (let i = 0; i < slice.length; i += 37) c.enqueue(slice.slice(i, i + 37)); c.close(); } });
      return new Response(body, { status: 206, headers: { "content-range": `bytes ${s}-${e}/${all.length}` } });
    });
  }
  it("walks zip tail → entry → early-stop scan and returns the eight units", async () => {
    const f = await rangedFetch();
    const r = await lookupHarris(ACCT, { years: [2026], fetchImpl: f });
    expect(r).toMatchObject({ complete: true, year: 2026, total: 1.970988 });
    expect(r.units).toHaveLength(8);
  });
  it("reports an unknown account as incomplete, never an empty table", async () => {
    const f = await rangedFetch();
    const r = await lookupHarris("0000000000001", { years: [2026], fetchImpl: f });
    expect(r.complete).toBe(false);
  });
  it("falls back to the previous year folder when the newest 404s", async () => {
    const f = await rangedFetch();
    const r = await lookupHarris(ACCT, { years: [2027, 2026], fetchImpl: f });
    expect(r.year).toBe(2026);
  });
});

describe("findAccountRows — segment boundaries and early exit", () => {
  const FILE = ["acct\ttax_district\ttp_cd\tpct_district\tappraised_val\ttaxable_val",
    "0000000000001\t001\tI\t1.0000\t1\t0", "0000000000001\t040\tT\t1.0000\t1\t0",
    "0000000000007\t001\tI\t1.0000\t1\t0", "0000000000007\t040\tT\t1.0000\t1\t0", "0000000000007\t041\tT\t1.0000\t1\t0",
    "0000000000009\t001\tI\t1.0000\t1\t0"].join("\r\n") + "\r\n";
  const enc = new TextEncoder().encode(FILE);
  const entry = { method: 0, csize: enc.length, off: 0 };
  const mk = (counter) => async (_u, o) => {
    counter.n++;
    const m = /bytes=(\d+)-(\d+)/.exec(o.headers.range);
    const s = Number(m[1]), e = Math.min(enc.length - 1, Number(m[2]));
    // the "local header" probe at off 0 must report name/extra lengths of 0 → data starts at 30
    if (s === 0 && e === 63) return new Response(new Uint8Array(64), { status: 206 });
    return new Response(enc.slice(s - 30, e - 30 + 1), { status: 206 });
  };
  for (const seg of [7, 50, 1e6]) {
    it(`finds the contiguous group whatever the segment size (${seg})`, async () => {
      const rows = await findAccountRows("u", entry, "0000000000007", mk({ n: 0 }), seg);
      expect(rows.map((r) => r.code)).toEqual(["001", "040", "041"]);
    });
  }
  it("returns nothing for an account that is absent, and stops reading once past it", async () => {
    const c = { n: 0 };
    const rows = await findAccountRows("u", entry, "0000000000005", mk(c), 25);
    expect(rows).toEqual([]);
    expect(c.n).toBeLessThan(1 + Math.ceil(enc.length / 25)); // did not read the whole file
  });
});
