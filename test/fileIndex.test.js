import { describe, it, expect } from "vitest";
import { indexEntry, buildIndex, runView, viewById, viewCounts, needsFiling, fileState, SAVED_VIEWS, DOC_CLASS } from "../src/workspaces/doc-review/lib/fileIndex.js";

const rows = [
  { id: "a", project_id: "p1", project: "Katy 99", discipline: "Survey", item: "ALTA survey", doc_date: "2026-03-01", kind: "single" },
  { id: "b", project_id: "p1", project: "Katy 99", discipline: "Civil", item: "Grading plan", doc_date: "2026-05-01", kind: "stitch" },
  { id: "c", project_id: "p2", project: "Pearland", discipline: "Survey", item: "Boundary survey", doc_date: "2026-04-01" },
  { id: "d", project_id: "p1", project: "Katy 99", discipline: "Other", item: "Title Commitment", doc_date: "2026-02-01" },
  { id: "e", project_id: "p2", project: "Pearland", discipline: "Geotech", item: "Soils report", doc_date: "2026-01-15" },
  { id: "f", project_id: null, project: "", discipline: "Other", item: "mystery.pdf", doc_date: "2026-06-01" },
];

describe("fileIndex — indexEntry tagging + classes (B180/NEW-1)", () => {
  it("tags and classifies a survey as spatial", () => {
    const e = indexEntry(rows[0]);
    expect(e.docClass).toBe(DOC_CLASS.SPATIAL);
    expect(e.tags).toContain("survey");
    expect(e.tags).toContain("survey"); // discipline tag (lowercased) too
  });
  it("classifies a title commitment as BOTH and tags it", () => {
    const e = indexEntry(rows[3]);
    expect(e.docClass).toBe(DOC_CLASS.BOTH);
    expect(e.tags).toContain("title-commitment");
  });
  it("classifies a soils report as reference", () => {
    expect(indexEntry(rows[4]).docClass).toBe(DOC_CLASS.REFERENCE);
  });
});

describe("fileIndex — saved views are queries (per-project vs cross-project)", () => {
  const idx = buildIndex(rows);
  it("'All surveys' is cross-project: both projects' surveys", () => {
    const out = runView("surveys", idx);
    expect(out.map((e) => e.id).sort()).toEqual(["a", "c"]);
  });
  it("'Civil set' scoped to a project filters by it; dropped → cross-project", () => {
    expect(runView("civil", idx, { projectId: "p1" }).map((e) => e.id)).toEqual(["b"]);
    expect(runView("civil", idx).map((e) => e.id)).toEqual(["b"]); // only one civil file overall here
  });
  it("'Title commitments' finds the dual-class doc", () => {
    expect(runView("title", idx).map((e) => e.id)).toEqual(["d"]);
  });
  it("'Map-ready (spatial)' includes spatial + both, excludes reference", () => {
    const out = runView("spatial", idx).map((e) => e.id).sort();
    expect(out).toContain("a"); expect(out).toContain("c"); expect(out).toContain("d"); // survey + survey + title(both)
    expect(out).not.toContain("e"); // geotech reference
  });
  it("sorts newest-first by doc date", () => {
    const out = runView("all", idx);
    expect(out[0].id).toBe("f"); // 2026-06-01 newest
  });
  it("an extra predicate AND-filters (e.g. a search box)", () => {
    const out = runView("all", idx, { extra: (e) => /grading/i.test(e.item) });
    expect(out.map((e) => e.id)).toEqual(["b"]);
  });
});

describe("fileIndex — needs-filing holding area + per-file state", () => {
  const idx = buildIndex(rows);
  it("flags unlinked or catch-all files as needing filing", () => {
    expect(needsFiling(indexEntry(rows[5]))).toBe(true);  // no project
    expect(needsFiling(indexEntry(rows[3]))).toBe(true);  // discipline 'Other'
    expect(needsFiling(indexEntry(rows[0]))).toBe(false); // filed survey
  });
  it("the 'Needs filing' view collects exactly those", () => {
    expect(runView("needs-filing", idx).map((e) => e.id).sort()).toEqual(["d", "f"]);
  });
  it("fileState reflects on-map calibration", () => {
    expect(fileState(indexEntry({ ...rows[0], onMap: true }))).toBe("on-map");
    expect(fileState(indexEntry(rows[0]))).toBe("filed");
  });
});

describe("fileIndex — viewCounts + viewById", () => {
  it("counts honor the project filter", () => {
    const idx = buildIndex(rows);
    const counts = viewCounts(idx, { projectId: "p1" });
    expect(counts.civil).toBe(1);
    expect(counts.surveys).toBe(2); // cross-project view ignores the filter
  });
  it("viewById falls back to the first view", () => {
    expect(viewById("nope").id).toBe(SAVED_VIEWS[0].id);
  });
});
