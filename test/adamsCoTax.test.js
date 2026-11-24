import { describe, it, expect, vi, beforeEach } from "vitest";
import { adamsTableFrom, dedupeValues, fetchAdamsTable, _resetAdamsCache } from "../src/workspaces/site-planner/lib/adamsCoTax.js";
import { TAX_COVERAGE } from "../src/workspaces/site-planner/lib/taxRates.js";

/* The three verified PINs (county data, measured 2026-11-22): PIN → AREAID → authority count → Σ TOTALLEVY == MILLLEVY.
 * The county's authority NAMES per district are not all recorded in the brief, so the levies below are SYNTHETIC splits
 * that reproduce the measured count and exact sum (they test the join/sum logic, not the county's real names/rates). */
const split = (area, n, total) => {
  const rows = []; let left = Math.round(total * 1e4);
  for (let i = 0; i < n; i++) { const v = i === n - 1 ? left : Math.floor(left / (n - i) / 7) * 3 + 1000 + i; rows.push(v); left -= v; }
  return rows.map((v, i) => ({ attributes: { TAXYEAR: "2026", TAXDISTRICT: area, TAXAUTHORITYCODE: `A${i}`, TAXAUTHORITYNAME: `Authority ${area}-${i}`, TOTALLEVY: v / 1e4, ALTTOTALLEVY: 9, CONTACTEMAIL: "x@y.z" } }));
};
const CASES = [["172121005023", "1250", 9, 51.822], ["181919409003", "1033", 8, 125.712], ["156908220017", "1316", 8, 56.348]];
const vals = (pin, area, mill) => [1, 2, 3].map(() => ({ attributes: { PIN: pin, AREAID: area, MILLLEVY: mill, ALTMILLLEVY: 5 } })); // repeats ~3x

describe("adamsTableFrom", () => {
  for (const [pin, area, n, mill] of CASES) {
    it(`PIN ${pin}: ${n} authorities sum to ${mill} exactly; the 3x repeats are deduped`, () => {
      const t = adamsTableFrom(vals(pin, area, mill), [...split(area, n, mill), ...split("9999", 3, 1)]);
      expect(t.hidden).toBeUndefined();
      expect(t.rows.length).toBe(n);
      expect(t.total).toBe(mill);
      expect(t.unit).toBe("mills");
      expect(t.year).toBe("2026");
    });
  }
  it("hides on a mismatch, with the reason", () => {
    const t = adamsTableFrom(vals("1", "1250", 51.9), split("1250", 9, 51.822));
    expect(t.hidden).toMatch(/add to/); expect(t.rows).toBeUndefined();
  });
  it("hides when no authorities, no account row, or the PIN's rows disagree", () => {
    expect(adamsTableFrom(vals("1", "1250", 5), []).hidden).toBeTruthy();
    expect(adamsTableFrom([], split("1250", 2, 5)).hidden).toBeTruthy();
    expect(dedupeValues([{ attributes: { AREAID: "1", MILLLEVY: 5 } }, { attributes: { AREAID: "2", MILLLEVY: 5 } }]).gap).toBeTruthy();
  });
  it("matches district codes with leading zeros and never carries contact or alternate-levy columns", () => {
    const t = adamsTableFrom(vals("1", "0001", 3), split("1", 2, 3));
    expect(t.total).toBe(3);
    expect(JSON.stringify(t)).not.toMatch(/CONTACT|x@y\.z|ALT/);
  });
});

describe("fetchAdamsTable", () => {
  beforeEach(() => _resetAdamsCache());
  it("joins PIN → district → authorities and never requests contact columns", async () => {
    const urls = [];
    const f = vi.fn(async (u) => { urls.push(u); const feats = u.includes("Property_Values") ? vals("172121005023", "1250", 51.822) : split("1250", 9, 51.822); return { ok: true, json: async () => ({ features: feats }) }; });
    const t = await fetchAdamsTable("172121005023", f);
    expect(t.total).toBe(51.822);
    expect(urls.join(" ")).not.toMatch(/CONTACT|ALT/i);
  });
  it("a network failure is null (hidden) and is retried next time", async () => {
    const f = vi.fn(async () => { throw new Error("down"); });
    expect(await fetchAdamsTable("1", f)).toBeNull();
    expect(await fetchAdamsTable("1", f)).toBeNull();
    expect(f.mock.calls.length).toBeGreaterThan(2);
  });
});

describe("coverage", () => {
  it("co_adams is recorded", () => { expect(TAX_COVERAGE.co_adams.server).toBe(true); expect(TAX_COVERAGE.co_adams.reason).toMatch(/mill/i); });
});
