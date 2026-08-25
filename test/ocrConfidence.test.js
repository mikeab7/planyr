import { describe, it, expect } from "vitest";
import { locateWordSpans, lowConfidenceSpans, culpritCalls } from "../src/shared/files/ocrConfidence.js";
import { canonicalizeOcrWord, repairOcrDeedText } from "../src/shared/files/deedOcrRepair.js";
import { parseCalls } from "../src/workspaces/site-planner/lib/deedParse.js";

describe("ocrConfidence — locateWordSpans", () => {
  it("finds each word's span in reading order against unmodified text", () => {
    const text = "THENCE North 45 East 150.00 feet";
    const words = [
      { text: "THENCE", confidence: 95 },
      { text: "North", confidence: 90 },
      { text: "45", confidence: 40 },
      { text: "East", confidence: 92 },
      { text: "150.00", confidence: 55 },
      { text: "feet", confidence: 97 },
    ];
    const spans = locateWordSpans(text, words);
    expect(spans).toHaveLength(6);
    expect(text.slice(spans[2].start, spans[2].end)).toBe("45");
    expect(spans[2].confidence).toBe(40);
  });

  it("falls back to a repaired word's canonical form via lookupAlt", () => {
    const text = "THENCE North 45 East 150.00 feet"; // "THENGE" was repaired to "THENCE"
    const words = [{ text: "THENGE", confidence: 61 }];
    const spans = locateWordSpans(text, words, { lookupAlt: canonicalizeOcrWord });
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0].start, spans[0].end)).toBe("THENCE");
  });

  it("skips (not mis-locates) a word it genuinely cannot find", () => {
    const spans = locateWordSpans("THENCE North", [{ text: "zzz-not-present", confidence: 10 }]);
    expect(spans).toHaveLength(0);
  });

  it("respects baseOffset for concatenating multiple pages", () => {
    const spans = locateWordSpans("feet", [{ text: "feet", confidence: 50 }], { baseOffset: 100 });
    expect(spans[0].start).toBe(100);
  });
});

describe("ocrConfidence — lowConfidenceSpans", () => {
  it("filters by threshold (default 70)", () => {
    const spans = [{ confidence: 95 }, { confidence: 40 }, { confidence: 69 }, { confidence: 70 }];
    expect(lowConfidenceSpans(spans)).toHaveLength(2);
  });
  it("accepts a custom threshold", () => {
    const spans = [{ confidence: 95 }, { confidence: 40 }];
    expect(lowConfidenceSpans(spans, 50)).toHaveLength(1);
  });
});

describe("ocrConfidence — culpritCalls (the closure safety net)", () => {
  it("names the call overlapping a low-confidence OCR span", () => {
    const raw = "THENCE North 45°30'00\"E, 150.00 feet to a point;\nTHENCE South 44°30'00\"W, 300.00 feet to a point;";
    const calls = parseCalls(raw);
    expect(calls).toHaveLength(2);
    // pretend Tesseract was unsure about the distance in the SECOND course
    const secondCourseIdx = raw.indexOf("300.00");
    const lcSpans = [{ start: secondCourseIdx, end: secondCourseIdx + 6, confidence: 35 }];
    const culprits = culpritCalls(raw, calls, lcSpans, []);
    expect(culprits).toHaveLength(1);
    expect(culprits[0].index).toBe(1);
    expect(culprits[0].minConfidence).toBe(35);
  });

  it("names a call whose distance was flagged as a suspected lost decimal point", () => {
    const raw = "THENCE North 45°30'00\"E, 15000 feet to a point;";
    const calls = parseCalls(raw);
    expect(calls).toHaveLength(1);
    const suspect = [{ index: raw.indexOf("15000"), length: 10 }];
    const culprits = culpritCalls(raw, calls, [], suspect);
    expect(culprits).toHaveLength(1);
    expect(culprits[0].suspect).toBe(true);
  });

  it("returns nothing when every call reads at high confidence with no suspect distances", () => {
    const raw = "THENCE North 45°30'00\"E, 150.00 feet to a point;";
    const calls = parseCalls(raw);
    expect(culpritCalls(raw, calls, [], [])).toHaveLength(0);
  });

  it("works end-to-end on OCR-repaired text (keywords rewritten, offsets still resolve)", () => {
    const brokenRaw = 'TFIENCE North 45°30\'00"VV, 150.00 feet to a point;';
    const { text } = repairOcrDeedText(brokenRaw);
    const calls = parseCalls(text);
    expect(calls).toHaveLength(1);
    const distIdx = text.indexOf("150.00");
    const lcSpans = [{ start: distIdx, end: distIdx + 6, confidence: 20 }];
    const culprits = culpritCalls(text, calls, lcSpans, []);
    expect(culprits).toHaveLength(1);
  });
});
