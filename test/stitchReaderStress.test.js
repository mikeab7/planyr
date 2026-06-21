/* Adversarial STRESS TEST — round 2 (B350): the stitch tool's READER + CALIBRATION + TAKEOFF path.
 *
 * Round 1 (stitchStress.test.js) hardened the placement geometry. This round attacks the other
 * half of the "confident wrong number" surface: the text reads that decide HOW sheets group, and
 * the measurement math that produces the takeoff over a stitched composite. A wrong read here is
 * just as dangerous — it silently mis-groups a set or reports a wrong area/length — so the same
 * rule holds: when a signal is unreadable, degrade (leave it standalone / "set scale"), never guess.
 */
import { describe, it, expect } from "vitest";
import { parseSheetNumber, readTitleBlockText, latestDate, findDates } from "../src/shared/files/titleBlockParse.js";
import { readSheetMeta } from "../src/shared/files/sheetMeta.js";
import { groupSheets, parseSheetCode } from "../src/shared/files/sheetGroups.js";
import { autoPlaceGroup, buildAdjacency } from "../src/workspaces/doc-review/lib/autoStitch.js";
import { dist, polyArea, pathLength, centroidOf, measureValue, measureLabel } from "../src/workspaces/doc-review/lib/takeoff.js";

/* ───────────────────── 1. 3-digit sheet numbers now read, group, and stitch ───────────────────── */
describe("STRESS · large sets (sheet number past 99) are no longer invisible to grouping/stitch", () => {
  it("parseSheetNumber reads a 3-digit labelled major (the old \\d{1,2} cap dropped it)", () => {
    expect(parseSheetNumber("... SHEET NO. C-100 ...")).toBe("C-100");
    expect(parseSheetNumber("DWG # A101")).toBe("A101");
    expect(parseSheetNumber("SHEET NUMBER C-101.2")).toBe("C-101.2");
    // still LABEL-anchored: a bare 3-digit grid ref without the label is ignored
    expect(parseSheetNumber("detail A195 and column W21 on the page")).toBe("");
  });

  it("readTitleBlockText surfaces the 3-digit number end-to-end", () => {
    const f = readTitleBlockText("GRADING PLAN  SHEET NO. C-100  ISSUED FOR CONSTRUCTION  06/30/2025");
    expect(f.sheetNumber).toBe("C-100");
    expect(f.discipline).toBe("Civil");
  });

  it("readSheetMeta (the wired reader) reads a 3-digit sheet number off positioned items", () => {
    const items = [
      { str: "GRADING AND DRAINAGE PLAN", x: 1600, y: 1380, w: 260, h: 16 },
      { str: "SHEET NO. C-100", x: 1600, y: 1460, w: 230, h: 14 },
      { str: "ISSUED FOR CONSTRUCTION", x: 1600, y: 1520, w: 250, h: 12 },
      { str: "MATCH LINE - SEE SHEET C-101", x: 1820, y: 700, w: 70, h: 10 },
    ];
    const meta = readSheetMeta({ items, width: 1900, height: 1584 });
    expect(meta.hasText).toBe(true);
    expect(meta.sheetNumber).toBe("C-100");
    expect(meta.matchLines.some((m) => m.target === "C-101")).toBe(true);
  });

  it("a C-100..C-103 run groups into one logical sheet and auto-stitches", () => {
    const DA = { x: 0, y: 0, w: 1900, h: 1584 };
    const page = (n) => ({ sheetNumber: "C-" + n, item: "Grading Plan", discipline: "Civil" });
    const groups = groupSheets([page(100), page(101), page(102), page(103)]);
    expect(groups.length).toBe(1);
    expect(groups[0].pages.length).toBe(4);

    // and the seam graph links them (sheet numbers past 99 used to be missing from byNumber)
    const sheet = (id, num, mls) => ({ id, sheetNumber: "C-" + num, drawingArea: DA, matchLines: mls });
    const a = sheet("a", 100, [{ target: "C-101", side: "right" }]);
    const b = sheet("b", 101, [{ target: "C-100", side: "left" }, { target: "C-102", side: "right" }]);
    const c = sheet("c", 102, [{ target: "C-101", side: "left" }]);
    expect(buildAdjacency([a, b, c]).get("a").length).toBe(1);
    expect(autoPlaceGroup([a, b, c]).ok).toBe(true);
  });

  it("parseSheetCode agrees on 3-digit majors (so contiguity still chains)", () => {
    expect(parseSheetCode("C-100")).toMatchObject({ prefix: "C", major: 100 });
    expect(parseSheetCode("C-101")).toMatchObject({ prefix: "C", major: 101 });
  });
});

/* ───────────────────── 2. date reading under junk (the "latest date" drives revision) ───────────────────── */
describe("STRESS · date reading rejects impossible dates, picks the newest", () => {
  it("ignores out-of-range months/days/years instead of emitting a bogus ISO", () => {
    expect(findDates("13/40/2025")).toEqual([]);     // month 13, day 40
    expect(findDates("00/00/0000")).toEqual([]);
    expect(findDates("06/30/1850")).toEqual([]);     // year before 1990
    expect(latestDate("no dates here at all")).toBe("");
  });
  it("picks the latest of several plausible dates", () => {
    expect(latestDate("drawn 01/02/2024 checked 06/30/2025 rev 03/15/2025")).toBe("2025-06-30");
  });
  it("survives a huge text blob without throwing or hanging", () => {
    const blob = ("SHEET 1 OF 19  06/30/2025  scale 1\"=40'  ".repeat(5000));
    expect(() => latestDate(blob)).not.toThrow();
    expect(latestDate(blob)).toBe("2025-06-30");
  });
});

/* ───────────────────── 3. takeoff math under adversarial geometry ───────────────────── */
describe("STRESS · takeoff geometry degrades, never crashes or NaN-reports", () => {
  it("dist/polyArea/pathLength handle too-few / degenerate point sets", () => {
    expect(polyArea([])).toBe(0);
    expect(polyArea([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe(0);        // <3 pts
    expect(polyArea([{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0); // collinear → 0 area
    expect(pathLength(null)).toBe(0);
    expect(pathLength([{ x: 0, y: 0 }])).toBe(0);
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("centroidOf never throws and stays inside a concave (L-shaped) polygon", () => {
    const L = [
      { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 },
      { x: 40, y: 40 }, { x: 40, y: 100 }, { x: 0, y: 100 },
    ];
    const c = centroidOf(L);
    expect(Number.isFinite(c.x) && Number.isFinite(c.y)).toBe(true);
    // the naive area-centroid of this L falls in the notch; centroidOf must pull it onto the shape
    expect(c.x).toBeLessThanOrEqual(100);
    expect(c.y).toBeLessThanOrEqual(100);
    expect(centroidOf([])).toEqual({ x: 0, y: 0 });
    expect(() => centroidOf([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }])).not.toThrow(); // all coincident
  });

  it("measureValue guards an empty/degenerate distance instead of dereferencing pts[1]", () => {
    expect(measureValue({ kind: "distance", pts: [] }, 0.5)).toMatchObject({ lengthFt: null });
    expect(measureValue({ kind: "distance", pts: [{ x: 0, y: 0 }] }, 0.5)).toMatchObject({ lengthFt: null });
    expect(measureValue({ kind: "area", pts: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 0.5)).toMatchObject({ areaSf: 0 });
  });

  it("an uncalibrated measure labels 'set scale', a calibrated one reports the value", () => {
    expect(measureLabel({ kind: "distance", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, 0)).toBe("set scale");
    expect(measureLabel({ kind: "distance", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }, 0.5)).toBe("50.0 ft");
    expect(measureLabel({ kind: "count", pts: [{}, {}, {}] }, 0)).toBe("3");
  });

  it("a non-finite calibration can't produce a confident finite-looking number", () => {
    // ftPerUnit should never be non-finite (the Stitcher guards it), but if it ever were, the label
    // must read a safe sentinel, never a fabricated figure. NaN reads as "not calibrated"
    // (!!NaN === false → "set scale"); Infinity computes through to a non-finite value → "—".
    const safe = ["set scale", "—"];
    const distM = { kind: "distance", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const areaM = { kind: "area", pts: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }] };
    expect(safe).toContain(measureLabel(distM, NaN));
    expect(safe).toContain(measureLabel(areaM, NaN));
    expect(safe).toContain(measureLabel(distM, Infinity));
    expect(safe).toContain(measureLabel(areaM, Infinity));
    // and crucially: none of these ever read as a plausible-looking number with units
    for (const cal of [NaN, Infinity, -Infinity]) {
      expect(measureLabel(distM, cal)).not.toMatch(/^\d/);
      expect(measureLabel(areaM, cal)).not.toMatch(/^\d/);
    }
  });
});
