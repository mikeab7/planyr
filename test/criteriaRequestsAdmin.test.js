import { describe, it, expect } from "vitest";
import { isWired, prepareCriteriaRequestRows } from "../src/workspaces/admin/lib/criteriaRequestsAdmin.js";

// ⛔ B877442 — "wired" is decided by cross-referencing a request's county against the SAME
// modeled-jurisdiction lists the app itself routes against (detentionRules.COUNTY_AUTHORITY /
// easementRules.MODELED_COUNTIES), never a second, hand-maintained list that can drift.
describe("isWired", () => {
  it("a modeled county is wired for detention/pond/floodplain", () => {
    expect(isWired("harris", "detention")).toBe(true);
    expect(isWired("fortbend", "pond")).toBe(true);
    expect(isWired("waller", "floodplain")).toBe(true);
    expect(isWired("Montgomery", "detention")).toBe(true); // case/normalisation
  });
  it("an unmodeled county is outstanding", () => {
    expect(isWired("tarrant", "detention")).toBe(false);
    expect(isWired("dallas", "pond")).toBe(false);
    expect(isWired("potter", "floodplain")).toBe(false);
  });
  it("easement's modeled set is its OWN, smaller registry — chambers/waller are wired for", () => {
    // detention/pond/floodplain but NOT for easement (easementRules has no chambers/waller record).
    expect(isWired("chambers", "detention")).toBe(true);
    expect(isWired("chambers", "easement")).toBe(false);
    expect(isWired("harris", "easement")).toBe(true);
    expect(isWired("fortbend", "easement")).toBe(true);
  });
  it("an unknown family is never wired (fails closed, never throws)", () => {
    expect(isWired("harris", "nonsense")).toBe(false);
  });
});

describe("prepareCriteriaRequestRows", () => {
  it("sorts outstanding (unwired) requests before wired ones, most-requested first within each group", () => {
    const rows = [
      { county_key: "harris", family: "detention", request_count: 1 }, // wired
      { county_key: "tarrant", family: "detention", request_count: 5 }, // outstanding
      { county_key: "dallas", family: "detention", request_count: 9 }, // outstanding
    ];
    const out = prepareCriteriaRequestRows(rows);
    expect(out.map((r) => r.county_key)).toEqual(["dallas", "tarrant", "harris"]);
    expect(out.map((r) => r.wired)).toEqual([false, false, true]);
  });
  it("handles an empty/missing list without throwing", () => {
    expect(prepareCriteriaRequestRows(null)).toEqual([]);
    expect(prepareCriteriaRequestRows([])).toEqual([]);
  });
});
