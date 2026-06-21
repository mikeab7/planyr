import { describe, it, expect } from "vitest";
import { scoreProjectInText, matchProjectInText } from "../src/shared/files/matchProject.js";

const projects = [
  { id: "g1", name: "Katy Grand", aliases: { addresses: ["1234 FM 1093, Katy TX"], parcels: ["1234567000001"], jobNumbers: ["KG-2025"] } },
  { id: "g2", name: "Cypress Logistics Park" },
  { id: "g3", name: "Grand Parkway Commerce Center" },
];

describe("matchProjectInText — deterministic project match by searching the sheet text (B312)", () => {
  it("matches a distinctive name on its own, or a generic name corroborated by a parcel/job#", () => {
    // A distinctive name (rare/long token) files on a single mention.
    expect(matchProjectInText("CYPRESS LOGISTICS PARK — PHASE 1 SITE PLAN", projects).projectId).toBe("g2");
    // A generic name ("Katy Grand") needs corroboration — a real survey prints the name AND its
    // parcel, which combine via noisy-or. (A generic name ALONE no longer auto-files — next test.)
    const m = matchProjectInText("ALTA SURVEY OF KATY GRAND — BUILDING 1  APPRAISAL ACCOUNT 1234567-000-001", projects);
    expect(m.matched).toBeTruthy();
    expect(m.projectId).toBe("g1");
    expect(m.needsFiling).toBe(false);
  });
  it("a GENERIC name mentioned once, with nothing to corroborate it, HOLDS (never auto-guess; B360)", () => {
    // "Katy Grand" is two common words; a single coincidental mention (the Katy / Grand Parkway area)
    // must NOT auto-file — it needs a second signal or the name repeated in a real title block.
    const m = matchProjectInText("DETENTION POND NEAR THE KATY GRAND PARKWAY INTERCHANGE", projects);
    expect(m.matched).toBeNull();
    expect(m.needsFiling).toBe(true);
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
