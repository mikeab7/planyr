import { describe, it, expect } from "vitest";
import {
  expectedFromFilename,
  projectFromFilename,
  disciplineFromFilename,
  scoreFile,
  scoreCorpus,
  SYNTHETIC_FIXTURES,
} from "../ui-audit/lib/filingScore.mjs";

/* The scoring harness (B360) is a dev tool, but its ground-truth-from-filename parser and its
 * field comparison are pure logic worth locking into CI so a future tuning session trusts the
 * scorecard. (The REAL accuracy numbers come from the owner's corpus once Drive is re-authed;
 * these fixtures are synthetic and only prove the engine.) */
describe("expectedFromFilename — ground truth from the owner's descriptive names", () => {
  it("pulls project, discipline, date, revision out of a full descriptive name", () => {
    expect(expectedFromFilename("2024-10-22 - JACINTOPORT - STRUCTURAL - IFC.pdf")).toEqual({
      project: "Jacintoport", discipline: "Structural", date: "2024-10-22", revision: "IFC",
    });
  });
  it("handles dotted dates and a trailing date", () => {
    expect(expectedFromFilename("Bergstrom Phase 2a - Arch IFP 2025.10.24.pdf")).toEqual({
      project: "Bergstrom", discipline: "Architectural", date: "2025-10-24", revision: "IFP",
    });
  });
  it("matches a project by alias and leaves unknown fields empty", () => {
    const e = expectedFromFilename("HC Approved Kennedy Greens Plans.pdf");
    expect(e.project).toBe("Kennedy Greens");
    expect(e.discipline).toBe(""); // "Plans" names no discipline → not graded
    expect(e.date).toBe("");
  });
  it("reads the owner's per-discipline tokens (Plumbing / Fire / Structural)", () => {
    expect(disciplineFromFilename("2023.05.30 Mesa - Plumbing.pdf")).toBe("Plumbing");
    expect(disciplineFromFilename("2023.05.10 Mesa - Fire Protection & Alarm.pdf")).toBe("Fire Sprinkler"); // "fire protection" → Sprinkler bucket
    expect(disciplineFromFilename("Mesa - Fire Alarm.pdf")).toBe("Fire Alarm");
    expect(disciplineFromFilename("2023.05.19 Mesa - Structural.pdf")).toBe("Structural");
    expect(disciplineFromFilename("Mesa - Civil Site Plan.pdf")).toBe("Civil");
  });
  it("project search is case-insensitive and ignores the extension", () => {
    expect(projectFromFilename("JACINTOPORT fire sprinkler ifc.PDF")).toBe("Jacintoport");
    expect(projectFromFilename("random unrelated drawing.pdf")).toBe("");
  });
});

describe("scoreFile — compares the REAL readers to the filename ground truth", () => {
  it("marks an exact discipline + project + date + revision read as passing", () => {
    const r = scoreFile({
      name: "Bergstrom Phase 2a - Arch IFP 2025.10.24.pdf",
      text: "BERGSTROM PHASE 2A  FLOOR PLAN  ARCHITECTURAL  SHEET A-201  ISSUED FOR PERMIT IFP  10/24/2025  1/8\"=1'-0\"",
    });
    expect(r.fields.project.ok).toBe(true);
    expect(r.fields.discipline.ok).toBe(true);
    expect(r.fields.discipline.gap).toBe(false);
    expect(r.fields.date.ok).toBe(true);
    expect(r.fields.revision.ok).toBe(true);
    expect(r.fields.scale.got).toBe("1/8\"=1'-0\""); // the just-fixed embedded-date arch read
  });
  it("routes the now-bucketed disciplines (Structural → Structural, not Other)", () => {
    const r = scoreFile({
      name: "2024-10-22 - JACINTOPORT - STRUCTURAL - IFC.pdf",
      text: "JACINTOPORT  FOUNDATION PLAN  STRUCTURAL  SHEET S-101  ISSUED FOR CONSTRUCTION IFC  10/22/2024",
    });
    // Structural now has a dedicated bucket (owner taxonomy 2026-06-21) → a clean pass, no gap.
    expect(r.fields.discipline.got).toBe("Structural");
    expect(r.fields.discipline.ok).toBe(true);
    expect(r.fields.discipline.gap).toBe(false);
  });
  it("does not grade a field the filename does not state (ok:null)", () => {
    const r = scoreFile({ name: "Mesa - Architectural Record Drawings.pdf", text: "MESA RECORD DRAWINGS ARCHITECTURAL FLOOR PLAN SHEET A-101" });
    expect(r.fields.date.ok).toBeNull();     // no date in the name
    expect(r.fields.revision.ok).toBeNull(); // no revision code in the name
  });
});

describe("scoreCorpus — aggregate over the synthetic fixtures", () => {
  it("tallies graded fields and counts the taxonomy gaps separately", () => {
    const res = scoreCorpus(SYNTHETIC_FIXTURES);
    expect(res.count).toBe(SYNTHETIC_FIXTURES.length);
    // every graded field in the (correct-by-construction) synthetic set passes
    for (const k of ["project", "discipline", "date", "revision"]) {
      if (res.totals[k].scored) expect(res.totals[k].pass).toBe(res.totals[k].scored);
    }
    // every discipline now has a real bucket (owner taxonomy 2026-06-21) → no taxonomy gaps
    expect(res.totals.discipline.gaps).toBe(0);
  });
});
