import { describe, it, expect } from "vitest";
import {
  refineSheetTitles, candidateFrequency, isStopText, projectStopTexts, DRAWING_TYPE_WORD,
} from "../src/shared/files/sheetTitleSet.js";

// A page record the way readSheetMeta emits it: ranked titleCandidates (score-sorted).
const cand = (text, h = 10) => ({ text, h, score: h * 100 + Math.min(24, text.replace(/[^a-z]/gi, "").length) });
const page = (title, cands, extra = {}) => ({ hasText: true, item: "Architectural", sheetTitle: title, titleCandidates: cands, ...extra });

/* The B659 failure class, as read off the owner's real GPL arch set: the title block prints the
 * PROJECT NAME (and the architect's stamp) LARGER than the sheet's own title, so the per-page
 * tallest-line pick returns the project name for every sheet. */
function gplLikeSet(n = 12) {
  const uniqueTitles = ["BUILDING ELEVATIONS - SOUTH", "TILTWALL PARAPET COPING DETAILS", "WALL SECTIONS AND DETAILS", "OVERALL ELEVATION - EAST"];
  return Array.from({ length: n }, (_, i) => {
    const t = `${uniqueTitles[i % uniqueTitles.length]} ${i}`;
    // Project stamp is the TALLEST candidate on every page; the real title is smaller type.
    return page("GRAND PORT LOGISTICS", [cand("GRAND PORT LOGISTICS", 30), cand("NAZIR KHALFE", 22), cand(t, 14)]);
  });
}

describe("refineSheetTitles — cross-page boilerplate demotion (B659)", () => {
  it("demotes the ubiquitous project-name stamp to the per-sheet unique title", () => {
    const out = refineSheetTitles(gplLikeSet());
    for (const p of out) {
      expect(p.sheetTitle).not.toBe("GRAND PORT LOGISTICS"); // the screenshot bug
      expect(p.sheetTitle).not.toBe("NAZIR KHALFE");          // the architect stamp
      expect(p.titleRefined).toBe(true);
    }
    expect(out[0].sheetTitle).toMatch(/BUILDING ELEVATIONS/);
  });
  it("known project names are stop texts even on a small file (frequency can't fire)", () => {
    const pages = [
      page("GRAND PORT LOGISTICS", [cand("GRAND PORT LOGISTICS", 30), cand("FLOOR PLAN", 14)]),
      page("GRAND PORT LOGISTICS", [cand("GRAND PORT LOGISTICS", 30), cand("ROOF PLAN", 14)]),
    ];
    const out = refineSheetTitles(pages, { stopTexts: ["Grand Port Logistics"] });
    expect(out.map((p) => p.sheetTitle)).toEqual(["FLOOR PLAN", "ROOF PLAN"]);
  });
  it("protects a legitimate tiled-run title (drawing-type word) from the ubiquity demotion", () => {
    const pages = Array.from({ length: 5 }, () =>
      page("GRADING PLAN", [cand("GRADING PLAN", 20), cand("KEYNOTES LIST", 10)]));
    const out = refineSheetTitles(pages);
    for (const p of out) expect(p.sheetTitle).toBe("GRADING PLAN"); // tiles keep their shared title
  });
  it("fails open: a page whose every candidate is ubiquitous keeps its best line", () => {
    const pages = Array.from({ length: 6 }, () => page("SPEC OFFICE", [cand("SPEC OFFICE", 14)]));
    const out = refineSheetTitles(pages);
    for (const p of out) expect(p.sheetTitle).toBe("SPEC OFFICE");
  });
  it("a page whose every candidate is a KNOWN name falls back to the item, never the project name", () => {
    const pages = [page("Jacintoport", [cand("JACINTOPORT", 16)], { item: "Architectural" })];
    const out = refineSheetTitles(pages, { stopTexts: ["Jacintoport"] });
    expect(out[0].sheetTitle).toBe("Architectural");
  });
  it("leaves no-text and candidate-less pages untouched (same object identity)", () => {
    const a = { hasText: false };
    const b = page("X", []);
    const out = refineSheetTitles([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
  it("the real-corpus regression: 'SPEC OFFICE' (a spec building, not 'specifications') is demotable", () => {
    expect(DRAWING_TYPE_WORD.test("SPEC OFFICE")).toBe(false);
    // 5 of 11 pages carry the stamp — the Jacintoport make-ready set (B659 corpus run).
    const stamped = (alt) => page("SPEC OFFICE", [cand("SPEC OFFICE", 14), ...(alt ? [cand(alt, 10)] : [])]);
    const pages = [
      page("COMMENTS & NOTES", [cand("COMMENTS & NOTES", 12)]),
      stamped(null), stamped(null),
      stamped("CODE COMPLIANCE"), stamped("ENLARGED RESTROOM PLAN"), stamped("DOOR SCHEDULE"),
      page("GENERAL NOTES", [cand("GENERAL NOTES", 14)]),
      page("FINISH KEYNOTES", [cand("FINISH KEYNOTES", 14)]),
      page("MILLWORK ELEVATION", [cand("MILLWORK ELEVATION", 14)]),
      page("OVERALL FLOORPLAN AND NOTES", [cand("OVERALL FLOORPLAN AND NOTES", 14)]),
      page("REFLECTED CEILING PLAN", [cand("REFLECTED CEILING PLAN", 14)]),
    ];
    const out = refineSheetTitles(pages);
    expect(out[3].sheetTitle).toBe("CODE COMPLIANCE");
    expect(out[4].sheetTitle).toBe("ENLARGED RESTROOM PLAN");
    expect(out[5].sheetTitle).toBe("DOOR SCHEDULE");
  });
});

describe("isStopText — known-identity matching (B659)", () => {
  const stops = ["grand port logistics", "6955 mesa drive"];
  it("matches equality and ±1-word containment", () => {
    expect(isStopText("GRAND PORT LOGISTICS", stops)).toBe(true);
    expect(isStopText("GRAND PORT LOGISTICS BLDG", stops)).toBe(true);
  });
  it("keeps a real title that merely mentions the project (≥2 extra words)", () => {
    expect(isStopText("GRAND PORT LOGISTICS OVERALL SITE PLAN", stops)).toBe(false);
  });
  it("matches a ≥2-word FRAGMENT of a known identity string (the address case)", () => {
    expect(isStopText("MESA DRIVE -", stops)).toBe(true);
  });
  it("collapses a doubled cell before comparing ('MESA DRIVE - MESA DRIVE -')", () => {
    expect(isStopText("MESA DRIVE - MESA DRIVE -", stops)).toBe(true);
  });
});

describe("projectStopTexts + candidateFrequency", () => {
  it("collects names, alias names, and addresses", () => {
    const stops = projectStopTexts([
      { name: "Mesa", aliases: { names: ["Mesa Verde"], addresses: ["6955 Mesa Drive"] } },
      { name: "Jacintoport" },
      null,
    ]);
    expect(stops).toEqual(["Mesa", "Mesa Verde", "6955 Mesa Drive", "Jacintoport"]);
  });
  it("counts per-page presence, not occurrences", () => {
    const freq = candidateFrequency([
      page("A", [cand("SPEC OFFICE"), cand("SPEC OFFICE")]), // twice on one page = 1
      page("B", [cand("spec office")]),                       // normalization folds case
    ]);
    expect(freq.get("spec office")).toBe(2);
  });
});
