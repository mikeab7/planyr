import { describe, it, expect } from "vitest";
import { decideStaleness, summariseRates, accountAdopted, staleCaption } from "../functions/api/lib/rollStale.js";
import { parseRateTable } from "../functions/api/lib/hcadUnits.js";

// NEW-3 (2026-11-12; per-account rule 2026-11-15) — a fake 2026 rate file in HCAD's real column layout:
// RP_TYPE · tax_dist · name · exempt_cd · prop (prior year) · curr (this year).
const rateFile = (rows) => rows.map(([c, name, prop, curr]) => ["Real", c, name, "ALL", prop, curr].join("\t")).join("\n");
const sum = (rows) => summariseRates(parseRateTable(rateFile(rows)));
const NOT_ADOPTED = sum([["016", "GOOSE CREEK CISD", 1.07, 0], ["040", "HARRIS COUNTY", 0.38, 0], ["041", "FLOOD", 0.05, 0], ["640", "ESD 14", 0.085, 0]]);
const ADOPTED = sum([["016", "GOOSE CREEK CISD", 1.07, 1.05], ["040", "HARRIS COUNTY", 0.38, 0.37], ["041", "FLOOD", 0.05, 0.049], ["640", "ESD 14", 0.085, 0.08]]);
const CODES = ["016", "040", "041"];

describe("decideStaleness (per account)", () => {
  it("answer on this year's roll → current, no check needed", () => {
    expect(decideStaleness({ rollYear: 2026, nowYear: 2026 })).toEqual({ state: "current", stale: false, rollYear: 2026 });
  });
  it("2026 file exists but this account's rates are placeholders (curr 0 where 2025 was positive) → not adopted, NOT stale", () => {
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, codes: CODES, newer: [{ year: 2026, summary: NOT_ADOPTED }] });
    expect(v).toMatchObject({ state: "not-adopted", stale: false, rollYear: 2025, newerYear: 2026 });
    expect(v.missing).toEqual(CODES);
    expect(staleCaption(v)).toBe("2025 rates — 2026 not yet adopted");
  });
  it("no 2026 file at all → not adopted", () => {
    expect(decideStaleness({ rollYear: 2025, nowYear: 2026, codes: CODES, newer: [{ year: 2026, summary: null }] })).toMatchObject({ state: "not-adopted", stale: false, newerYear: 2026 });
    expect(decideStaleness({ rollYear: 2025, nowYear: 2026, codes: CODES }).state).toBe("not-adopted");
  });
  it("2026 file with this account's units adopted → STALE, refresh pending", () => {
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, codes: CODES, newer: [{ year: 2026, summary: ADOPTED }] });
    expect(v).toMatchObject({ state: "refresh-pending", stale: true, rollYear: 2025, newerYear: 2026 });
    expect(staleCaption(v)).toBe("2025 rates — newer roll published, refresh pending");
  });
  it("REGRESSION 2026-11-15: hundreds of small districts lagging do NOT hold back an account whose own units have adopted", () => {
    const rows = [["016", "A", 1, 1.1], ["040", "B", 0.4, 0.41], ["041", "C", 0.05, 0.05]];
    for (let i = 0; i < 300; i++) rows.push([String(700 + i), `MUD ${i}`, 0.5, 0]); // 300 lagging districts
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, codes: CODES, newer: [{ year: 2026, summary: sum(rows) }] });
    expect(v.state).toBe("refresh-pending");
  });
  it("one lagging unit ON this account holds it at not-adopted, naming the unit", () => {
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, codes: ["016", "640"], newer: [{ year: 2026, summary: sum([["016", "A", 1, 1.1], ["640", "ESD", 0.085, 0]]) }] });
    expect(v).toMatchObject({ state: "not-adopted", missing: ["640"] });
  });
  it("a unit absent from the newer file is NOT adopted (never an alarm on a guess)", () => {
    expect(accountAdopted(sum([["016", "A", 1, 1.1]]), ["016", "999"])).toEqual({ ok: false, missing: ["999"] });
  });
  it("a unit that never levied (prior 0, current 0) counts as settled", () => {
    expect(accountAdopted(sum([["016", "A", 1, 1.1], ["042", "Z", 0, 0]]), ["016", "042"]).ok).toBe(true);
  });
  it("no codes → never claims a refresh is pending", () => {
    expect(accountAdopted(ADOPTED, []).ok).toBe(false);
  });
  it("two years behind: the newest year the account has adopted wins the verdict", () => {
    const v = decideStaleness({ rollYear: 2024, nowYear: 2026, codes: CODES, newer: [{ year: 2025, summary: ADOPTED }, { year: 2026, summary: NOT_ADOPTED }] });
    expect(v).toMatchObject({ stale: true, newerYear: 2025 });
  });
  it("captions say nothing when current", () => expect(staleCaption({ state: "current", rollYear: 2026 })).toBeNull());
});
