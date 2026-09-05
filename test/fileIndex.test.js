import { describe, it, expect } from "vitest";
import {
  mergeFactsIntoReviews, factsRowToPatch, toFactsRow,
  findDuplicateReview, isRapidRepeatUpload, DUPLICATE_RAPID_REPEAT_MS,
} from "../src/workspaces/doc-review/lib/fileIndex.js";

describe("fileIndex — merging the facts index onto review rows", () => {
  it("returns reviews unchanged when there are no fact rows (pre-index / dormant backend)", () => {
    const reviews = [{ id: "rv1", discipline: "CAD", placed: true }];
    expect(mergeFactsIntoReviews(reviews, [])).toBe(reviews);
  });

  it("merges captured placement/needs-filing onto the matching review", () => {
    const reviews = [{ id: "rv1", discipline: "CAD" }];
    const facts = [toFactsRow({ needsFiling: true, placement: { boundary: { present: true } } }, { id: "rv1", reviewId: "rv1" })];
    const [m] = mergeFactsIntoReviews(reviews, facts);
    expect(m.needsFiling).toBe(true);
    expect(m.placement.boundary.present).toBe(true);
  });

  it("does NOT let an index row without placement.placed downgrade a placed review (NEW-3)", () => {
    const reviews = [{ id: "rv1", discipline: "CAD", placed: true }]; // already on the map
    const facts = [toFactsRow({ discipline: "CAD" }, { id: "rv1", reviewId: "rv1" })]; // index has no placed flag
    const [m] = mergeFactsIntoReviews(reviews, facts);
    expect(m.placed).toBe(true); // stays on-map — the index can't silently un-place it
  });

  it("lets the index mark a review placed when its data didn't (placement.placed wins true)", () => {
    const reviews = [{ id: "rv1", discipline: "CAD" }];
    const facts = [toFactsRow({ placement: { placed: true } }, { id: "rv1", reviewId: "rv1" })];
    expect(factsRowToPatch(facts[0]).placed).toBe(true);
    expect(mergeFactsIntoReviews(reviews, facts)[0].placed).toBe(true);
  });
});

// B1205297 — the Library filed the same upload again every time, with no duplicate check.
// Production repro (8 South, project smqiljx5fngg): "Eight South - CenterPoint Pre-Screen
// Questionnaire.xlsx" filed three times — two ingests 17 SECONDS apart (a double-click/retry)
// and a third 43 minutes later (a real re-upload). `reviews` here is fetchReviews()'s raw shape
// (reviewStore.js): plain `project_id`/`updated_at` columns, `sfile`/`orgScope` aliases.
describe("fileIndex — duplicate-upload screening (B1205297)", () => {
  const reviews = [
    { id: "rvmr9psoge1zglj", project_id: "smqiljx5fngg", sfile: "Eight South - CenterPoint Pre-Screen Questionnaire.xlsx", updated_at: "2026-07-06T21:10:58.583Z" },
    { id: "rvmr9pt1p8nbfc8", project_id: "smqiljx5fngg", sfile: "Eight South - CenterPoint Pre-Screen Questionnaire.xlsx", updated_at: "2026-07-06T21:11:15.736Z" },
    { id: "other1", project_id: "smqfy2r7pdec", sfile: "2026.06.23 GPL - Arch IFR (1).pdf", updated_at: "2026-06-23T10:00:00Z" },
    { id: "org1", project_id: null, orgScope: true, sfile: "Company handbook.pdf", updated_at: "2026-01-01T00:00:00Z" },
  ];

  it("finds a same-project, same-filename match (case/whitespace-insensitive) and ignores other projects", () => {
    const dup = findDuplicateReview(reviews, { projectId: "smqiljx5fngg", sourceFile: "  EIGHT SOUTH - CenterPoint Pre-Screen Questionnaire.XLSX  " });
    expect(dup.id).toBe("rvmr9pt1p8nbfc8"); // the two 8 South rows match; the newer one wins
  });

  it("returns null when no filename is given, or nothing in scope matches", () => {
    expect(findDuplicateReview(reviews, { projectId: "smqiljx5fngg", sourceFile: "" })).toBeNull();
    expect(findDuplicateReview(reviews, { projectId: "smqiljx5fngg", sourceFile: "not filed here.pdf" })).toBeNull();
    expect(findDuplicateReview(reviews, { projectId: "smqfy2r7pdec", sourceFile: "Eight South - CenterPoint Pre-Screen Questionnaire.xlsx" })).toBeNull();
  });

  it("Organization-scoped uploads screen against Organization rows only, never a project's", () => {
    expect(findDuplicateReview(reviews, { orgScope: true, sourceFile: "Company handbook.pdf" }).id).toBe("org1");
    expect(findDuplicateReview(reviews, { projectId: "smqiljx5fngg", sourceFile: "Company handbook.pdf" })).toBeNull();
  });

  it("picks the MOST RECENTLY filed match when more than one exists", () => {
    const dup = findDuplicateReview(reviews, { projectId: "smqiljx5fngg", sourceFile: "Eight South - CenterPoint Pre-Screen Questionnaire.xlsx" });
    expect(dup.id).toBe("rvmr9pt1p8nbfc8");
  });

  it("classifies the production case correctly: 17s apart is a rapid repeat, 43min apart is not", () => {
    const first = reviews[0];
    const seventeenSecondsLater = new Date(reviews[1].updated_at).getTime();
    expect(isRapidRepeatUpload(first, seventeenSecondsLater)).toBe(true);

    const fortyThreeMinutesLater = new Date("2026-07-06T21:53:20.138Z").getTime();
    expect(isRapidRepeatUpload(first, fortyThreeMinutesLater)).toBe(false);
  });

  it("the rapid-repeat window is exactly DUPLICATE_RAPID_REPEAT_MS, boundary exclusive", () => {
    const dup = { updated_at: "2026-01-01T00:00:00.000Z" };
    const t0 = new Date(dup.updated_at).getTime();
    expect(isRapidRepeatUpload(dup, t0 + DUPLICATE_RAPID_REPEAT_MS - 1)).toBe(true);
    expect(isRapidRepeatUpload(dup, t0 + DUPLICATE_RAPID_REPEAT_MS)).toBe(false);
    expect(isRapidRepeatUpload(dup, t0)).toBe(true); // 0ms apart (the same instant) still counts
  });

  it("a null/undefined existing review is never a rapid repeat", () => {
    expect(isRapidRepeatUpload(null)).toBe(false);
    expect(isRapidRepeatUpload(undefined)).toBe(false);
  });

  it("reads sourceFile off either the raw `sfile` column or a merged `sourceFile` patch", () => {
    const merged = [{ id: "rv2", project_id: "p1", sourceFile: "Plan.pdf", updated_at: "2026-01-01T00:00:00Z" }];
    expect(findDuplicateReview(merged, { projectId: "p1", sourceFile: "plan.pdf" }).id).toBe("rv2");
  });
});
