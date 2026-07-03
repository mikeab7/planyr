import { describe, it, expect } from "vitest";
import { dedupePlaced, isPlaced, placedKey } from "../src/workspaces/doc-review/lib/stitchDedupe.js";

// A minimal placed-sheet shape (only the fields dedupe cares about + a marker to prove identity).
const sheet = (srcId, pageNum, extra = {}) => ({ id: extra.id || `${srcId}p${pageNum}`, srcId, pageNum, ...extra });

describe("dedupePlaced — collapse exact (srcId,pageNum) duplicates (B633/NEW-4)", () => {
  it("collapses the owner's JACINTOPORT draft 14 → 8 unique, keeping the world frame", () => {
    // p1×4, p2×3, p28×2, and p3,p4,p5,p6,p7 ×1 each → 14 entries, 8 unique.
    const placed = [
      sheet("A", 1, { aligned: true, M: { A: 1, B: 0, e: 0, f: 0 } }), // the world frame (index 0)
      sheet("A", 2, { aligned: false }),
      sheet("A", 1, { aligned: false }), // dup of the world frame
      sheet("A", 3, { aligned: false }),
      sheet("A", 2, { aligned: false }), // dup
      sheet("A", 28, { aligned: false }),
      sheet("A", 4, { aligned: false }),
      sheet("A", 1, { aligned: false }), // dup
      sheet("A", 2, { aligned: false }), // dup
      sheet("A", 5, { aligned: false }),
      sheet("A", 28, { aligned: false }), // dup
      sheet("A", 6, { aligned: false }),
      sheet("A", 1, { aligned: false }), // dup
      sheet("A", 7, { aligned: false }),
    ];
    const { placed: out, removed } = dedupePlaced(placed);
    expect(out).toHaveLength(8);
    expect(removed).toBe(6);
    expect(out.map((s) => s.pageNum)).toEqual([1, 2, 3, 28, 4, 5, 6, 7]);
    // The FIRST instance of p1 (the aligned world frame with its transform) is the survivor.
    expect(out[0]).toMatchObject({ srcId: "A", pageNum: 1, aligned: true, M: { A: 1, B: 0, e: 0, f: 0 } });
  });

  it("keeps distinct pages that merely share a printed sheet number (different pageNum or srcId)", () => {
    // Same printed "C-2" from two sources, and two different pages — never merged.
    const placed = [
      sheet("A", 2, { sheetNumber: "C-2" }),
      sheet("B", 2, { sheetNumber: "C-2" }), // different source → distinct sheet
      sheet("A", 9, { sheetNumber: "C-2" }), // different page → distinct sheet
    ];
    const { placed: out, removed } = dedupePlaced(placed);
    expect(removed).toBe(0);
    expect(out).toHaveLength(3);
  });

  it("is a no-op on an already-unique array and tolerates empty/undefined", () => {
    const uniq = [sheet("A", 1), sheet("A", 2)];
    expect(dedupePlaced(uniq).removed).toBe(0);
    expect(dedupePlaced([])).toEqual({ placed: [], removed: 0 });
    expect(dedupePlaced(undefined)).toEqual({ placed: [], removed: 0 });
  });

  it("preserves survivor order (first-seen order is stable)", () => {
    const placed = [sheet("A", 5), sheet("A", 1), sheet("A", 5), sheet("A", 3)];
    expect(dedupePlaced(placed).placed.map((s) => s.pageNum)).toEqual([5, 1, 3]);
  });
});

describe("isPlaced — the add-time no-op guard", () => {
  it("detects an already-placed (srcId,pageNum) and ignores a different one", () => {
    const placed = [sheet("A", 1), sheet("A", 2)];
    expect(isPlaced(placed, "A", 1)).toBe(true);
    expect(isPlaced(placed, "A", 3)).toBe(false);
    expect(isPlaced(placed, "B", 1)).toBe(false); // same page, different source
    expect(isPlaced([], "A", 1)).toBe(false);
    expect(isPlaced(undefined, "A", 1)).toBe(false);
  });
});

describe("placedKey — distinct sources with the same page don't collide", () => {
  it("keys by both srcId and pageNum", () => {
    expect(placedKey(sheet("A", 1))).not.toBe(placedKey(sheet("B", 1)));
    expect(placedKey(sheet("A", 1))).toBe(placedKey(sheet("A", 1)));
  });
});
