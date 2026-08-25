import { describe, it, expect } from "vitest";
import {
  fixSurveyKeywords, normalizeOcrPunctuation, fixQuadrantGlyphs, repairOcrDeedText, flagSuspectDistances,
  fixDoubledDegreeSign, fixWordMerges,
} from "../src/shared/files/deedOcrRepair.js";
import { parseCalls, parseTracts } from "../src/workspaces/site-planner/lib/deedParse.js";

describe("deedOcrRepair — fixSurveyKeywords", () => {
  it("repairs THENGE and TFIENCE to THENCE (the exact misreads named in the brief)", () => {
    expect(fixSurveyKeywords("THENGE North 45° East, 150.00 feet;").text).toContain("THENCE");
    expect(fixSurveyKeywords("TFIENCE North 45° East, 150.00 feet;").text).toContain("THENCE");
  });
  it("repairs COMMENGING / COMENCING to COMMENCING", () => {
    expect(fixSurveyKeywords("COMMENGING at the section corner").text).toMatch(/\bCOMMENCING\b/);
    expect(fixSurveyKeywords("COMENCING at the section corner").text).toMatch(/\bCOMMENCING\b/);
  });
  it("repairs BEGlNNING / BEGINNIN to BEGINNING", () => {
    expect(fixSurveyKeywords("POINT OF BEGlNNING").text).toMatch(/\bBEGINNING\b/);
  });
  it("canonicalizes a lower-case keyword to the upper-case form deedParse.js's \\bTHENCE\\b expects", () => {
    const r = fixSurveyKeywords("thence north 45 east");
    expect(r.text).toMatch(/\bTHENCE\b/);
    expect(r.count).toBe(1);
  });
  it("leaves an already-correct-case keyword untouched with count 0", () => {
    const r = fixSurveyKeywords("THENCE North 45 East");
    expect(r.text).toBe("THENCE North 45 East");
    expect(r.count).toBe(0);
  });
  it("does NOT touch common deed prose words near the keywords in length/shape", () => {
    const untouchable = [
      "CONTAINING", "REMAINING", "BEARING", "RUNNING", "ADJOINING", "RECORDED", "SURVEY",
      "EASEMENT", "PARCEL", "TRACT", "CORNER", "FOUND", "MONUMENT", "DISTANCE", "RADIUS",
      "CURVE", "CHORD", "TANGENT", "NORTHERLY", "SOUTHERLY", "BOUNDARY", "DESCRIBED", "ACCORDING",
    ];
    for (const w of untouchable) {
      const r = fixSurveyKeywords(`some ${w} word here`);
      expect(r.text, `${w} should be untouched`).toContain(w);
      expect(r.count, `${w} should not count as a keyword fix`).toBe(0);
    }
  });
});

describe("deedOcrRepair — normalizeOcrPunctuation", () => {
  it("normalizes curly single quotes to a straight minutes mark", () => {
    expect(normalizeOcrPunctuation("N45°30’00\"E").text).toBe("N45°30'00\"E");
  });
  it("normalizes a doubled straight quote to a straight seconds mark", () => {
    expect(normalizeOcrPunctuation("N45°30'00''E").text).toBe('N45°30\'00"E');
  });
  it("normalizes curly double quotes and angle quotes to a straight seconds mark", () => {
    expect(normalizeOcrPunctuation("N45°30'00”E").text).toBe('N45°30\'00"E');
    expect(normalizeOcrPunctuation("N45°30'00«E").text).toBe("N45°30'00\"E");
  });
  it("normalizes a registered-trademark / masculine-ordinal glyph to a degree sign", () => {
    expect(normalizeOcrPunctuation("N45®30'00\"E").text).toBe("N45°30'00\"E");
    expect(normalizeOcrPunctuation("N45º30'00\"E").text).toBe("N45°30'00\"E");
  });
});

describe("deedOcrRepair — fixQuadrantGlyphs", () => {
  it("repairs a bearing's second quadrant letter VV -> W", () => {
    const r = fixQuadrantGlyphs("THENCE N45°30'00\"VV, 150.00 feet");
    expect(r.text).toContain("N45°30'00\"W");
    expect(r.count).toBe(1);
  });
  it("repairs a bearing's second quadrant letter F -> E (E misread as F)", () => {
    const r = fixQuadrantGlyphs("THENCE S45°30'00\"F, 150.00 feet");
    expect(r.text).toContain("S45°30'00\"E");
  });
  it("does NOT touch an ordinary word containing VV or a lone F elsewhere in the text", () => {
    const r = fixQuadrantGlyphs("a found rod, feet, VValler county record");
    expect(r.text).toBe("a found rod, feet, VValler county record");
    expect(r.count).toBe(0);
  });
});

describe("deedOcrRepair — fixDoubledDegreeSign (measured on a real recorded deed)", () => {
  it("repairs a central angle whose minutes prime was read as a second degree sign", () => {
    const r = fixDoubledDegreeSign('a central angle of 07°18°59"');
    expect(r.text).toBe('a central angle of 07°18\'59"');
    expect(r.count).toBe(1);
  });
  it("works with a curly-double-quote seconds mark too", () => {
    const r = fixDoubledDegreeSign('07°18°59”');
    expect(r.text).toBe('07°18\'59”');
  });
  it("does not touch an ordinary single-degree-sign DMS run", () => {
    const r = fixDoubledDegreeSign('N45°30\'00"E');
    expect(r.text).toBe('N45°30\'00"E');
    expect(r.count).toBe(0);
  });
});

describe("deedOcrRepair — fixWordMerges (measured on a real recorded deed)", () => {
  it("splits a merged 'toa' back into 'to a'", () => {
    expect(fixWordMerges("150.00 feet toa point of curvature;").text).toContain("150.00 feet to a point");
  });
  it("repairs 'are' -> 'arc' only inside the 'along the ___' idiom", () => {
    const r = fixWordMerges("THENCE along the are of said curve to the right");
    expect(r.text).toContain("along the arc of said curve");
  });
  it("does not touch an ordinary use of the word 'are' elsewhere", () => {
    const r = fixWordMerges("these two tracts are described as follows");
    expect(r.text).toBe("these two tracts are described as follows");
    expect(r.count).toBe(0);
  });
});

describe("deedOcrRepair — flagSuspectDistances", () => {
  it("flags a bare digit run that looks like a lost decimal point before 'feet'", () => {
    const flags = flagSuspectDistances("THENCE North 45° East, 15000 feet to a point;");
    expect(flags.length).toBe(1);
    expect(flags[0].raw).toMatch(/15000 feet/i);
  });
  it("does not flag an ordinary short distance", () => {
    expect(flagSuspectDistances("THENCE North 45° East, 150.00 feet;").length).toBe(0);
    expect(flagSuspectDistances("THENCE North 45° East, 45 feet;").length).toBe(0);
  });
});

describe("deedOcrRepair — repairOcrDeedText end-to-end against deedParse.js", () => {
  it("recovers a course whose THENCE and quadrant letter were both mangled", () => {
    const broken = 'TFIENCE North 45°30\'00"VV, 150.00 feet to a point;';
    expect(parseCalls(broken)).toHaveLength(0); // unreadable before repair
    const { text } = repairOcrDeedText(broken);
    const calls = parseCalls(text);
    expect(calls).toHaveLength(1);
    expect(calls[0].bearing).toBe('N45°30\'00"W');
  });
  it("recovers a full multi-course traverse with mixed damage", () => {
    const broken = [
      "BEGlNNING at a found 1/2 inch iron rod;",
      "THENGE North 45°30'00”E, 150.00 feet to a point;",
      "TFIENCE South 44°30'00\"VV, 300.00 feet to a point;",
      "THENCE South 45°30'00\"W, 150.00 feet to a point;",
      "THENCE North 44°30'00\"E, 300.00 feet to the POINT OF BEGINNING.",
    ].join("\n");
    const { text } = repairOcrDeedText(broken);
    const tracts = parseTracts(text);
    expect(tracts[0].calls).toHaveLength(4);
  });
});
