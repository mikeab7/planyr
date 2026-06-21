import { describe, it, expect } from "vitest";
import { mergeFactsIntoReviews, factsRowToPatch, toFactsRow } from "../src/workspaces/doc-review/lib/fileIndex.js";

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
