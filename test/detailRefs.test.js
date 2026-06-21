import { describe, it, expect } from "vitest";
import { parseDetailRefs, parseDetailAnchors, normSheet } from "../src/shared/files/detailRefs.js";
import { reconstructLines } from "../src/shared/files/sheetMeta.js";

const dims = { width: 1224, height: 792 };

describe("normSheet — match a callout target against a sheet number", () => {
  it("strips punctuation/space and uppercases", () => {
    expect(normSheet("A-3")).toBe("A3");
    expect(normSheet("a 3")).toBe("A3");
    expect(normSheet("C-2.01")).toBe("C2.01");
  });
});

describe("parseDetailRefs — detail-callout bubbles (B350)", () => {
  it("reads a STACKED bubble (detail id over a sheet code) as one ref", () => {
    const items = [
      { str: "5", x: 300, y: 400, w: 8, h: 12 },
      { str: "A-3", x: 294, y: 418, w: 26, h: 12 },
    ];
    const refs = parseDetailRefs(items, [], dims);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ detail: "5", sheet: "A3" });
    // positioned near the bubble so a hotspot lands on it
    expect(refs[0].x).toBeGreaterThan(280);
    expect(refs[0].y).toBeGreaterThan(400);
  });

  it("ignores a plain fraction (no lettered sheet) — '1' over '2' is not a callout", () => {
    const items = [
      { str: "1", x: 300, y: 400, w: 8, h: 12 },
      { str: "2", x: 300, y: 418, w: 8, h: 12 },
    ];
    expect(parseDetailRefs(items, [], dims)).toHaveLength(0);
  });

  it("reads an inline '5/A-3' off a reconstructed line", () => {
    const items = [{ str: "SEE", x: 100, y: 200, w: 30, h: 12 }, { str: "5/A-3", x: 140, y: 200, w: 40, h: 12 }];
    const lines = reconstructLines(items);
    const refs = parseDetailRefs([], lines, dims);
    expect(refs.some((r) => r.detail === "5" && r.sheet === "A3")).toBe(true);
  });

  it("reads the keyword form 'DETAIL 5 ON SHEET A-3'", () => {
    const items = [
      { str: "SEE", x: 100, y: 300, w: 26, h: 12 }, { str: "DETAIL", x: 130, y: 300, w: 44, h: 12 },
      { str: "5", x: 178, y: 300, w: 8, h: 12 }, { str: "ON", x: 190, y: 300, w: 18, h: 12 },
      { str: "SHEET", x: 212, y: 300, w: 40, h: 12 }, { str: "A-3", x: 256, y: 300, w: 26, h: 12 },
    ];
    const lines = reconstructLines(items);
    const refs = parseDetailRefs([], lines, dims);
    expect(refs.some((r) => r.detail === "5" && r.sheet === "A3")).toBe(true);
  });

  it("dedupes the same callout at the same spot read two ways", () => {
    const items = [{ str: "5", x: 304, y: 400, w: 8, h: 12 }, { str: "A-3", x: 295, y: 416, w: 26, h: 12 }];
    // an inline line centered on the SAME bubble (same cell) → one ref, not two
    const lines = reconstructLines([{ str: "5/A-3", x: 288, y: 408, w: 40, h: 12 }]);
    const refs = parseDetailRefs(items, lines, dims);
    expect(refs.filter((r) => r.detail === "5" && r.sheet === "A3")).toHaveLength(1);
  });
});

describe("parseDetailAnchors — where a detail is DEFINED (B350)", () => {
  it("anchors on 'DETAIL 5' and 'SECTION A-A'", () => {
    const lines = reconstructLines([
      { str: "DETAIL", x: 100, y: 100, w: 44, h: 14 }, { str: "5", x: 148, y: 100, w: 8, h: 14 },
      { str: "SECTION", x: 600, y: 500, w: 56, h: 14 }, { str: "A-A", x: 660, y: 500, w: 26, h: 14 },
    ]);
    const anchors = parseDetailAnchors(lines, dims);
    expect(anchors.find((a) => a.detail === "5")).toBeTruthy();
    expect(anchors.find((a) => a.detail === "A")).toBeTruthy();
  });

  it("does not anchor on an ordinary notes heading", () => {
    const lines = reconstructLines([{ str: "GENERAL", x: 100, y: 100, w: 60, h: 14 }, { str: "NOTES", x: 164, y: 100, w: 44, h: 14 }]);
    expect(parseDetailAnchors(lines, dims)).toHaveLength(0);
  });
});
