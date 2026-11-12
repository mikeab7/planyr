import { describe, it, expect } from "vitest";
import { decideStaleness, adoptionOf, staleCaption, ADOPTED_SHARE } from "../functions/api/lib/rollStale.js";
import { parseRateTable } from "../functions/api/lib/hcadUnits.js";

// NEW-3 (2026-11-12) — a fake 2026 rate file in HCAD's real column layout: RP_TYPE · tax_dist · name · exempt_cd · prop · curr.
const rateFile = (rows) => rows.map(([c, name, prop, curr]) => ["Real", c, name, "ALL", prop, curr].join("\t")).join("\n");
const NOT_ADOPTED = parseRateTable(rateFile([["016", "GOOSE CREEK CISD", 1.07, 0], ["040", "HARRIS COUNTY", 0.38, 0], ["041", "FLOOD", 0.05, 0], ["640", "ESD 14", 0.085, 0]]));
const ADOPTED = parseRateTable(rateFile([["016", "GOOSE CREEK CISD", 1.07, 1.05], ["040", "HARRIS COUNTY", 0.38, 0.37], ["041", "FLOOD", 0.05, 0.049], ["640", "ESD 14", 0.085, 0.08]]));

describe("decideStaleness", () => {
  it("answer on this year's roll → current, no check needed", () => {
    expect(decideStaleness({ rollYear: 2026, nowYear: 2026 })).toEqual({ state: "current", stale: false, rollYear: 2026 });
  });
  it("2026 file exists but rates are placeholders (curr 0 where 2025 was positive) → not adopted, NOT stale", () => {
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, newer: [{ year: 2026, rates: NOT_ADOPTED }] });
    expect(v).toMatchObject({ state: "not-adopted", stale: false, rollYear: 2025, newerYear: 2026 });
    expect(staleCaption(v)).toBe("2025 rates — 2026 not yet adopted");
  });
  it("no 2026 file at all → not adopted", () => {
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, newer: [{ year: 2026, rates: null }] });
    expect(v).toMatchObject({ state: "not-adopted", stale: false, newerYear: 2026 });
    expect(decideStaleness({ rollYear: 2025, nowYear: 2026 }).state).toBe("not-adopted");
  });
  it("2026 file with adopted rates → STALE, refresh pending", () => {
    const v = decideStaleness({ rollYear: 2025, nowYear: 2026, newer: [{ year: 2026, rates: ADOPTED }] });
    expect(v).toMatchObject({ state: "refresh-pending", stale: true, rollYear: 2025, newerYear: 2026 });
    expect(staleCaption(v)).toBe("2025 rates — newer roll published, refresh pending");
  });
  it("two years behind: the newest ADOPTED year wins the verdict", () => {
    const v = decideStaleness({ rollYear: 2024, nowYear: 2026, newer: [{ year: 2025, rates: ADOPTED }, { year: 2026, rates: NOT_ADOPTED }] });
    expect(v).toMatchObject({ stale: true, newerYear: 2025 });
  });
  it("one dormant district that never posts does not hold the verdict (share threshold)", () => {
    const rows = []; for (let i = 0; i < 40; i++) rows.push([String(100 + i), `U${i}`, 0.1, 0.1]);
    rows.push(["999", "DORMANT", 0.2, 0]);
    const r = parseRateTable(rateFile(rows));
    expect(adoptionOf(r).share).toBeGreaterThanOrEqual(ADOPTED_SHARE);
    expect(decideStaleness({ rollYear: 2025, nowYear: 2026, newer: [{ year: 2026, rates: r }] }).stale).toBe(true);
  });
  it("a unit that did not levy last year is ignored by the adoption share", () => {
    expect(adoptionOf(parseRateTable(rateFile([["1", "NEW", 0, 0]]))).levied).toBe(0);
  });
  it("captions say nothing when current", () => expect(staleCaption({ state: "current", rollYear: 2026 })).toBeNull());
});
