import { describe, it, expect } from "vitest";
import { reflowLines } from "../src/shared/files/deedTextReflow.js";

describe("deedTextReflow — reflowLines", () => {
  it("joins a course's word-wrapped visual lines into one logical line", () => {
    const lines = [
      "THENCE South 75 degrees 57 minutes 50",
      "seconds East, 412.31 feet to a point;",
    ];
    const out = reflowLines(lines);
    expect(out).toBe("THENCE South 75 degrees 57 minutes 50 seconds East, 412.31 feet to a point;");
  });

  it("keeps each THENCE/COMMENCING/BEGINNING/SAVE AND EXCEPT/numbered course on its own line", () => {
    const lines = [
      "BEGINNING at a point;",
      "THENCE North 00 degrees East,",
      "400.00 feet to a point;",
      "THENCE with the following two",
      "(2) courses and distances:",
      "1. South 78 degrees West, 509.90",
      "feet to a point;",
      "2. North 56 degrees West, 360.56 feet",
      "to the POINT OF BEGINNING.",
    ];
    const out = reflowLines(lines).split("\n");
    // a numbered sub-course ("1." / "2.") is ALWAYS its own course-start, even right after a
    // "THENCE with the following..." preamble line — so that preamble stays on its own line too.
    expect(out).toHaveLength(5);
    expect(out[0]).toBe("BEGINNING at a point;");
    expect(out[1]).toBe("THENCE North 00 degrees East, 400.00 feet to a point;");
    expect(out[2]).toBe("THENCE with the following two (2) courses and distances:");
    expect(out[3]).toBe("1. South 78 degrees West, 509.90 feet to a point;");
    expect(out[4]).toBe("2. North 56 degrees West, 360.56 feet to the POINT OF BEGINNING.");
  });

  it("drops blank lines", () => {
    expect(reflowLines(["THENCE North 45 East 150 feet;", "", "  ", "THENCE South 45 East 150 feet;"]))
      .toBe("THENCE North 45 East 150 feet;\nTHENCE South 45 East 150 feet;");
  });

  it("collapses internal whitespace runs", () => {
    expect(reflowLines(["THENCE   North    45   East   150  feet;"]))
      .toBe("THENCE North 45 East 150 feet;");
  });
});
