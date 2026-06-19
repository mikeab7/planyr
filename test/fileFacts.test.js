import { describe, it, expect } from "vitest";
import {
  DOC_CLASS, classifyDocClass, isSpatial, fileState, FILE_STATE,
  toFileFact, buildFileFacts, SAVED_VIEWS, runView, groupByDiscipline,
  needsFiling, createIndexProvider, stubIndexProvider,
} from "../src/shared/files/fileFacts.js";
import { emptyPlacementFacts } from "../src/shared/placement/placementFacts.js";

describe("fileFacts — document class (B176/NEW-1)", () => {
  it("classifies a survey as spatial, geotech as reference", () => {
    expect(classifyDocClass("Survey", "ALTA Survey")).toBe(DOC_CLASS.SPATIAL);
    expect(classifyDocClass("Geotech", "Boring logs")).toBe(DOC_CLASS.REFERENCE);
  });
  it("treats a title commitment as BOTH (reference doc + spatial schedules)", () => {
    expect(classifyDocClass("Other", "Title Commitment")).toBe(DOC_CLASS.BOTH);
    expect(classifyDocClass("Survey", "Schedule B exceptions")).toBe(DOC_CLASS.BOTH);
    expect(isSpatial({ docClass: DOC_CLASS.BOTH })).toBe(true);
  });
  it("treats a bare legal description as spatial", () => {
    expect(classifyDocClass("Other", "Metes and bounds description")).toBe(DOC_CLASS.SPATIAL);
  });
  it("falls back to reference when it can't tell (misplacing a doc is worse)", () => {
    expect(classifyDocClass("Other", "Random memo")).toBe(DOC_CLASS.REFERENCE);
  });
});

describe("fileFacts — normalization + file state", () => {
  it("normalizes a review row and defaults placement facts", () => {
    const f = toFileFact({ id: "rv1", project: "Katy", projectId: "g1", discipline: "Civil", item: "Grading plan", updated_at: "2026-06-10" });
    expect(f.projectId).toBe("g1");
    expect(f.docClass).toBe(DOC_CLASS.SPATIAL);
    expect(f.placement).toEqual(emptyPlacementFacts());
    expect(f.unfiled).toBe(false);
  });
  it("flags an unfiled row", () => {
    expect(toFileFact({ id: "x", discipline: "Civil" }).unfiled).toBe(true);
  });
  it("spatial+placed = on-map; reference never on-map", () => {
    expect(fileState({ docClass: DOC_CLASS.SPATIAL, placed: true })).toBe(FILE_STATE.ON_MAP);
    expect(fileState({ docClass: DOC_CLASS.SPATIAL, placed: false })).toBe(FILE_STATE.FILED);
    expect(fileState({ docClass: DOC_CLASS.REFERENCE, placed: true })).toBe(FILE_STATE.FILED);
  });
});

describe("fileFacts — saved views as queries (per-project + cross-project)", () => {
  const rows = [
    { id: "a", projectId: "g1", project: "Katy", discipline: "Survey", item: "ALTA", updated_at: "2026-01-01" },
    { id: "b", projectId: "g1", project: "Katy", discipline: "Civil", item: "Grading", updated_at: "2026-03-01" },
    { id: "c", projectId: "g2", project: "Conroe", discipline: "Survey", item: "Boundary", updated_at: "2026-02-01" },
    { id: "d", projectId: null, discipline: "Civil", item: "Loose plan", updated_at: "2026-04-01" },
  ];
  const facts = buildFileFacts(rows);
  it("a project-scoped view filters to the project and sorts newest-first", () => {
    const r = runView(facts, "surveys", { projectId: "g1" });
    expect(r.map((f) => f.id)).toEqual(["a"]);
  });
  it("the same view goes cross-project when the project filter is dropped", () => {
    const r = runView(facts, "surveys", { projectId: "g1", crossProject: true });
    expect(r.map((f) => f.id).sort()).toEqual(["a", "c"]);
  });
  it("the civil view picks civil docs only", () => {
    expect(runView(facts, "civil", { projectId: "g1" }).map((f) => f.id)).toEqual(["b"]);
  });
  it("needs-filing surfaces only unfiled docs (global scope)", () => {
    expect(needsFiling(facts).map((f) => f.id)).toEqual(["d"]);
    expect(runView(facts, "needs-filing", { projectId: "g1" }).map((f) => f.id)).toEqual(["d"]);
  });
  it("every saved view has a stable id + matcher", () => {
    for (const v of SAVED_VIEWS) { expect(typeof v.id).toBe("string"); expect(typeof v.match).toBe("function"); }
  });
});

describe("fileFacts — discipline grouping", () => {
  it("groups by discipline, newest-first within a group, alpha by discipline", () => {
    const facts = buildFileFacts([
      { id: "a", projectId: "g1", discipline: "Survey", updated_at: "2026-01-01" },
      { id: "b", projectId: "g1", discipline: "Civil", updated_at: "2026-03-01" },
      { id: "c", projectId: "g1", discipline: "Civil", updated_at: "2026-05-01" },
    ]);
    const g = groupByDiscipline(facts);
    expect(g.map((x) => x.discipline)).toEqual(["Civil", "Survey"]);
    expect(g[0].files.map((f) => f.id)).toEqual(["c", "b"]);
  });
});

describe("fileFacts — index provider interface (backend stubbed)", () => {
  it("the stub reports no backend and empty placement facts", async () => {
    expect(stubIndexProvider.backendReady).toBe(false);
    expect(await stubIndexProvider.capturePlacementFacts({})).toEqual(emptyPlacementFacts());
  });
  it("a real backend impl is honored through the same interface", async () => {
    const p = createIndexProvider({ capturePlacementFacts: async () => ({ captured: true, boundary: { present: true } }) });
    expect(p.backendReady).toBe(true);
    const facts = await p.capturePlacementFacts({});
    expect(facts.captured).toBe(true);
    expect(facts.boundary.present).toBe(true);
  });
});
