import { describe, it, expect } from "vitest";
import {
  DOC_CLASS, classifyDocClass, isSpatial, fileState, FILE_STATE,
  toFileFact, buildFileFacts, SAVED_VIEWS, runView, groupByDiscipline,
  needsFiling, createIndexProvider, stubIndexProvider,
  CATEGORIES, categoryFor, categoryOf, FILE_STATES, stateOf, onMap, isReference,
  deriveTree, browseFiles, holdingArea, FACETS,
} from "../src/shared/files/fileFacts.js";
import { emptyPlacementFacts } from "../src/shared/placement/placementFacts.js";

describe("fileFacts — document class (B180/NEW-1)", () => {
  it("classifies a survey as spatial, geotech as reference", () => {
    expect(classifyDocClass("Survey", "ALTA Survey")).toBe(DOC_CLASS.SPATIAL);
    expect(classifyDocClass("Geotech", "Boring logs")).toBe(DOC_CLASS.REFERENCE);
  });
  it("classifies CAD as spatial — it IS the drawings (NEW-1)", () => {
    expect(classifyDocClass("CAD", "Overall site plan")).toBe(DOC_CLASS.SPATIAL);
    expect(isSpatial(toFileFact({ id: "c1", discipline: "CAD", item: "Plan" }))).toBe(true);
    // "Other" still defaults to reference (only CAD was promoted, not the ambiguous bucket).
    expect(classifyDocClass("Other", "Unlabeled drawing")).toBe(DOC_CLASS.REFERENCE);
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
  it("parses the `placed` flag from a list row whether it's a JSON bool or text (NEW-3)", () => {
    // listReviews surfaces it via `data->placed`, which can arrive as either.
    expect(toFileFact({ id: "a", discipline: "CAD", placed: true }).placed).toBe(true);
    expect(toFileFact({ id: "b", discipline: "CAD", placed: "true" }).placed).toBe(true);
    expect(toFileFact({ id: "c", discipline: "CAD", placed: false }).placed).toBe(false);
    expect(toFileFact({ id: "d", discipline: "CAD" }).placed).toBe(false); // absent → not on map
    // End to end: a placed CAD drawing now reads as on-map (the dead-badge bug).
    expect(fileState(toFileFact({ id: "e", discipline: "CAD", placed: true }))).toBe(FILE_STATE.ON_MAP);
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

describe("fileFacts — canonical categories (Work Item B)", () => {
  it("maps disciplines to canonical top-level categories", () => {
    expect(categoryFor("Civil", "Grading Plan")).toBe("Drawings");
    expect(categoryFor("Architectural", "Floor Plan")).toBe("Drawings");
    expect(categoryFor("Survey", "Boundary Survey")).toBe("Surveys");
    expect(categoryFor("Geotech", "Boring logs")).toBe("Geotechnical");
    expect(categoryFor("Environmental", "Phase I ESA")).toBe("Environmental");
  });
  it("item/title overrides discipline for plats, title, permits, agreements", () => {
    expect(categoryFor("Survey", "Final Plat of Mesa")).toBe("Plats");
    expect(categoryFor("Other", "Title Commitment")).toBe("Title");
    expect(categoryFor("Civil", "Zoning Variance Application")).toBe("Permits/Entitlements");
    expect(categoryFor("Other", "Development Agreement")).toBe("Agreements");
  });
  it("an unclassifiable doc lands in Reports/Studies, never a phantom drawing", () => {
    expect(categoryFor("Other", "Random memorandum")).toBe("Reports/Studies");
    expect(categoryFor("Other", "Mystery document")).toBe("Reports/Studies");
  });
  it("categoryOf prefers an explicitly stored category over the derivation", () => {
    expect(categoryOf(toFileFact({ id: "x", discipline: "Civil", category: "Surveys" }))).toBe("Surveys");
    expect(categoryOf(toFileFact({ id: "y", discipline: "Civil", item: "Grading" }))).toBe("Drawings");
  });
  it("every canonical category is a non-empty string", () => {
    expect(CATEGORIES.length).toBeGreaterThan(0);
    for (const c of CATEGORIES) expect(typeof c).toBe("string");
  });
});

describe("fileFacts — state model + facets (Work Item B)", () => {
  it("derives needs_filing for an unfiled file, filed for a matched one", () => {
    expect(stateOf(toFileFact({ id: "a", discipline: "Civil" }))).toBe(FILE_STATES.NEEDS_FILING); // no project
    expect(stateOf(toFileFact({ id: "b", projectId: "g1", discipline: "Civil" }))).toBe(FILE_STATES.FILED);
  });
  it("honors an explicit needs_filing / superseded state", () => {
    expect(stateOf(toFileFact({ id: "c", projectId: "g1", discipline: "Civil", needs_filing: true }))).toBe(FILE_STATES.NEEDS_FILING);
    expect(stateOf(toFileFact({ id: "d", projectId: "g1", discipline: "Civil", state: "superseded" }))).toBe(FILE_STATES.SUPERSEDED);
  });
  it("usage facets: on-map = placed spatial; reference = read-only class", () => {
    expect(onMap(toFileFact({ id: "e", projectId: "g1", discipline: "Civil", placed: true }))).toBe(true);
    expect(onMap(toFileFact({ id: "f", projectId: "g1", discipline: "Civil", placed: false }))).toBe(false);
    expect(isReference(toFileFact({ id: "g", projectId: "g1", discipline: "Geotech" }))).toBe(true);
  });
  it("FACETS each have an id + matcher", () => {
    for (const f of FACETS) { expect(typeof f.id).toBe("string"); expect(typeof f.match).toBe("function"); }
  });
});

describe("fileFacts — tree derivation + browse (Work Item B)", () => {
  const rows = [
    { id: "a", projectId: "g1", discipline: "Survey", item: "ALTA", updated_at: "2026-01-01" },
    { id: "b", projectId: "g1", discipline: "Civil", item: "Grading", updated_at: "2026-03-01" },
    { id: "c", projectId: "g1", discipline: "Civil", item: "Paving", updated_at: "2026-05-01" },
    { id: "d", projectId: "g1", discipline: "Geotech", item: "Borings", updated_at: "2026-02-01" },
    { id: "e", projectId: null, discipline: "Civil", item: "Loose plan", updated_at: "2026-04-01" }, // needs-filing
    { id: "f", projectId: "g1", discipline: "Civil", item: "Old grading", state: "superseded", updated_at: "2025-12-01" },
  ];
  const facts = buildFileFacts(rows);
  it("derives canonical categories with data-driven subcategories; empties hidden; needs-filing + superseded excluded", () => {
    const tree = deriveTree(facts);
    expect(tree.map((n) => n.category)).toEqual(["Drawings", "Surveys", "Geotechnical"].filter((c) => ["Drawings", "Surveys", "Geotechnical"].includes(c)));
    const drawings = tree.find((n) => n.category === "Drawings");
    expect(drawings.count).toBe(2); // b, c — not the superseded f, not the unfiled e
    expect(drawings.subs).toEqual([{ name: "Civil", count: 2 }]);
    // No empty canonical categories present (e.g. Plats/Title/Agreements absent).
    expect(tree.find((n) => n.category === "Plats")).toBeUndefined();
  });
  it("includeSuperseded brings the superseded file back into its node", () => {
    const tree = deriveTree(facts, { includeSuperseded: true });
    expect(tree.find((n) => n.category === "Drawings").count).toBe(3);
  });
  it("browseFiles scopes to a node, newest-first, excluding holding-area + superseded", () => {
    const civil = browseFiles(facts, { category: "Drawings", subcategory: "Civil" });
    expect(civil.map((f) => f.id)).toEqual(["c", "b"]); // newest first, no e (unfiled) or f (superseded)
  });
  it("the on-map facet filters the node's files", () => {
    const withPlaced = buildFileFacts([
      { id: "p1", projectId: "g1", discipline: "Civil", item: "Plan", placed: true, updated_at: "2026-06-01" },
      { id: "p2", projectId: "g1", discipline: "Civil", item: "Plan2", placed: false, updated_at: "2026-06-02" },
    ]);
    expect(browseFiles(withPlaced, { category: "Drawings", facet: "on-map" }).map((f) => f.id)).toEqual(["p1"]);
  });
  it("the holding area is exactly the needs-filing files", () => {
    expect(holdingArea(facts).map((f) => f.id)).toEqual(["e"]);
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
