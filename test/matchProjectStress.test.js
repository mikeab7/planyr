/* Adversarial STRESS TEST for the auto-filing project matcher (B350, round 4).
 *
 * The matcher is the same risk class as the stitcher's auto-stitch: an over-confident match here
 * silently MISFILES a drawing onto the wrong project — and per the owner rule, a misfile is worse
 * than an unfiled file. The browser path (`scoreProjectInText`) searches the sheet's raw text, so
 * it has two false-positive vectors the server twin (which compares extracted fields) avoids by
 * construction; this suite pins both, plus the general "never auto-guess" contract.
 */
import { describe, it, expect } from "vitest";
import { scoreProjectInText, matchProjectInText, decide } from "../src/shared/files/matchProject.js";

const PROJECTS = [
  { id: "g1", name: "Katy Grand", aliases: { addresses: ["1234 FM 1093, Katy TX"], parcels: ["1234567000001"], jobNumbers: ["KG-2025"] } },
  { id: "g2", name: "Cypress Logistics Park" },
  { id: "g3", name: "Grand Parkway Commerce Center" },
];

/* ───────────── 1. ID matches must be boundary-aligned, not a coincidental substring ───────────── */
describe("STRESS · a short id can't match as a substring of an unrelated digit run", () => {
  it("a job number is NOT matched inside a longer coincidental number elsewhere on the sheet", () => {
    const proj = [{ id: "x", name: "Northgate Yards", aliases: { jobNumbers: ["1045"] } }];
    // "210455" contains "1045" as a substring — the old normId(wholeText).includes() matched it.
    const m = matchProjectInText("SHEET 210455  GENERAL NOTES  DETAIL 33", proj);
    expect(m.needsFiling).toBe(true);
    expect(m.projectId).toBeNull();
    expect(scoreProjectInText("SHEET 210455 NOTES", proj[0]).signals.some((s) => s.kind === "jobNumber")).toBe(false);
  });

  it("a parcel is NOT matched inside a longer coincidental run", () => {
    const proj = [{ id: "x", name: "Northgate Yards", aliases: { parcels: ["123456"] } }];
    const m = matchProjectInText("ACCOUNT 91234567 ZONING NOTES", proj); // contains 123456
    expect(m.needsFiling).toBe(true);
  });

  it("but a real id split by punctuation or spaces STILL matches (recall preserved)", () => {
    expect(matchProjectInText("APPRAISAL ACCOUNT 1234567-000-001 GRADING PLAN", PROJECTS).projectId).toBe("g1");
    expect(matchProjectInText("APPRAISAL ACCOUNT 1234567 000 001 GRADING", PROJECTS).projectId).toBe("g1");
    expect(matchProjectInText("PROJECT NO. KG-2025  SHEET C-2.01", PROJECTS).projectId).toBe("g1");
  });
});

/* ───────────── 2. scattered name words can't auto-file (only a phrase or a corroborated read) ───────────── */
describe("STRESS · a 2-word common name scattered across an unrelated sheet does not auto-file", () => {
  it("'Katy' + 'Grand' appearing separately (different project) → needs filing, not a Katy Grand misfile", () => {
    const m = matchProjectInText("KATY MILLS — IMPROVEMENTS NEAR THE GRAND PARKWAY, FORT BEND", PROJECTS);
    expect(m.projectId).not.toBe("g1");
    expect(m.needsFiling).toBe(true);
    const s = scoreProjectInText("KATY MILLS NEAR GRAND PARKWAY", PROJECTS[0]);
    expect(s.score).toBeLessThan(0.6); // below the auto-file floor
  });

  it("the project name printed as a PHRASE still auto-files (recall preserved)", () => {
    expect(matchProjectInText("ALTA SURVEY OF KATY GRAND — BUILDING 1", PROJECTS).projectId).toBe("g1");
  });

  it("a scattered name corroborated by a real id DOES match (weak signal + strong signal)", () => {
    // scattered name (0.55) + exact job number (0.95) → noisy-or well over the floor.
    const m = matchProjectInText("KATY DRIVE … GRAND AVE … PROJECT NO. KG-2025", PROJECTS);
    expect(m.projectId).toBe("g1");
    expect(m.needsFiling).toBe(false);
  });
});

/* ───────────── 3. the "never auto-guess" decision contract under stress ───────────── */
describe("STRESS · decide() refuses on weak / ambiguous / empty reads", () => {
  it("empty or junk text → needs filing, never a guess", () => {
    expect(matchProjectInText("", PROJECTS)).toMatchObject({ needsFiling: true, reason: "no-readable-identifiers" });
    expect(matchProjectInText("   ··· —— ///", PROJECTS)).toMatchObject({ needsFiling: true });
    expect(matchProjectInText("GENERAL NOTES AND ABBREVIATIONS", PROJECTS)).toMatchObject({ needsFiling: true, reason: "no-match" });
  });

  it("two projects within the margin → ambiguous (no coin-flip)", () => {
    const ambig = [{ id: "a", name: "Grand Parkway Commerce Center" }, { id: "b", name: "Grand Parkway Commerce Center" }];
    expect(matchProjectInText("GRAND PARKWAY COMMERCE CENTER PHASE 2", ambig).reason).toBe("ambiguous");
  });

  it("decide() is monotonic + safe on degenerate candidate lists", () => {
    expect(decide([])).toMatchObject({ needsFiling: true, matched: null, confidence: 0 });
    expect(decide([{ id: "a", name: "A", score: 0.59, signals: [] }]).needsFiling).toBe(true);  // just under floor
    expect(decide([{ id: "a", name: "A", score: 0.61, signals: [] }]).needsFiling).toBe(false); // just over, alone
    // a clear winner over a weak runner-up still matches (margin satisfied)
    expect(decide([{ id: "a", name: "A", score: 0.95, signals: [] }, { id: "b", name: "B", score: 0.2, signals: [] }]).projectId).toBe("a");
  });

  it("a huge text blob doesn't throw or hang the matcher", () => {
    const blob = "GRADING PLAN  PROJECT KATY GRAND  ".repeat(8000);
    expect(() => matchProjectInText(blob, PROJECTS)).not.toThrow();
    expect(matchProjectInText(blob, PROJECTS).projectId).toBe("g1"); // phrase present → still matches
  });

  it("malformed projects/aliases don't crash scoring", () => {
    expect(() => scoreProjectInText("anything", null)).not.toThrow();
    expect(() => scoreProjectInText("anything", { id: "z", aliases: { parcels: null, names: "Solo Name", jobNumbers: 1234 } })).not.toThrow();
    expect(() => matchProjectInText("text", [null, { id: "z" }])).not.toThrow();
  });
});
