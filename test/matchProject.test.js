import { describe, it, expect } from "vitest";
import { scoreProjectInText, matchProjectInText } from "../src/shared/files/matchProject.js";

const projects = [
  { id: "g1", name: "Katy Grand", aliases: { addresses: ["1234 FM 1093, Katy TX"], parcels: ["1234567000001"], jobNumbers: ["KG-2025"] } },
  { id: "g2", name: "Cypress Logistics Park" },
  { id: "g3", name: "Grand Parkway Commerce Center" },
];

describe("matchProjectInText — deterministic project match by searching the sheet text (B312)", () => {
  it("matches when the project name is printed on the sheet", () => {
    const m = matchProjectInText("ALTA SURVEY OF KATY GRAND — BUILDING 1, HARRIS COUNTY", projects);
    expect(m.matched).toBeTruthy();
    expect(m.projectId).toBe("g1");
    expect(m.needsFiling).toBe(false);
  });
  it("matches on a printed parcel/account number (exact, strong)", () => {
    const m = matchProjectInText("APPRAISAL ACCOUNT 1234567-000-001  GRADING PLAN", projects);
    expect(m.projectId).toBe("g1");
  });
  it("matches on a printed job number", () => {
    expect(matchProjectInText("PROJECT NO. KG-2025  SHEET C-2.01", projects).projectId).toBe("g1");
  });
  it("a sheet that names no project → needs filing (never auto-guess)", () => {
    const m = matchProjectInText("GENERAL NOTES AND ABBREVIATIONS", projects);
    expect(m.matched).toBeNull();
    expect(m.needsFiling).toBe(true);
    expect(m.reason).toBe("no-match");
  });
  it("empty text → needs filing, no-readable-identifiers", () => {
    expect(matchProjectInText("", projects)).toMatchObject({ needsFiling: true, reason: "no-readable-identifiers" });
  });
  it("two equally-named projects both present → ambiguous (no coin-flip)", () => {
    const ambig = [{ id: "a", name: "Grand Parkway Commerce Center" }, { id: "b", name: "Grand Parkway Commerce Center" }];
    const m = matchProjectInText("GRAND PARKWAY COMMERCE CENTER PHASE 2", ambig);
    expect(m.matched).toBeNull();
    expect(m.reason).toBe("ambiguous");
  });
  it("does not false-match on a stray common word", () => {
    // "Park" alone shouldn't pull in "Cypress Logistics Park".
    const m = matchProjectInText("CITY PARK IMPROVEMENTS — UNRELATED", projects);
    expect(m.projectId).not.toBe("g2");
  });
  it("scoreProjectInText is explainable — lists the signal it matched on", () => {
    const s = scoreProjectInText("ACCOUNT 1234567000001", projects[0]);
    expect(s.score).toBeGreaterThan(0.9);
    expect(s.signals.some((g) => g.kind === "parcel")).toBe(true);
  });
});
