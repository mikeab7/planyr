import { describe, it, expect } from "vitest";
import { parseTracts, callsToPath, pathCloses, misclosure } from "../src/workspaces/site-planner/lib/deedParse.js";

/* Construct-coverage audit against a REAL recorded deed's character-level facts (Chambers County,
 * TX, "16 - Recorded Correction SWD.pdf" — 3-page, 1-bit CCITT-G4 scan, no text layer). The owner
 * ran stock Tesseract against it directly (19/19 bearings recovered, essentially perfect) and asked
 * the load-bearing question: does the EXISTING, already-shipped parser (used by paste/.docx/.doc/a
 * text-layer PDF, and now OCR too) correctly handle every construct this deed actually contains —
 * curves (incl. a chord bearing + radius + central angle + arc length), a "passing at … for a total
 * distance of" governing-distance clause, a parenthetical offset note, a "bears" monument tie call
 * ahead of the POB, a SAVE AND EXCEPT second tract, and a "the following N courses and distances"
 * numbered sub-list with no per-line THENCE? A naive from-scratch extraction of this deed measured a
 * 1,707 ft closure error on a 7,863 ft perimeter (~1:5) — but that was the owner's OWN quick script,
 * not this parser (his words: "entirely MY parser's fault, not the recognition").
 *
 * This fixture is geometry-exact (built from a closing hexagon computed independently, then
 * reverse-formatted into deed prose — see the scratchpad script this was authored from), NOT a
 * transcription of the real deed's actual bearings — the owner didn't attach the PDF, only its
 * measured facts. It reconstructs every CONSTRUCT the real deed contains rather than its literal
 * numbers, which is what this audit needs: proof the PARSER handles the shapes, independent of any
 * particular deed's values. */
const REAL_DEED_TEXT = `
COMMENCING at a found 1/2 inch iron pipe for reference, from which a found 5/8 inch iron rod bears South 01 degrees 13 minutes 45 seconds East, 1.73 feet, said point being the POINT OF BEGINNING of the herein described 94.53 acre tract;

THENCE North 00 degrees 00 minutes 00 seconds East, 400.00 feet to a point for corner;

THENCE Northeasterly, along a curve to the right, having a radius of 400.00 feet, a central angle of 60°00'00", an arc length of 418.88 feet, and a long chord which bears North 90 degrees 00 minutes 00 seconds East, 400.00 feet to a point for corner;

THENCE South 75 degrees 57 minutes 50 seconds East, passing at 200.00 feet a set 5/8 inch iron rod for reference, for a total distance of 412.31 feet to a point for corner;

THENCE South 00 degrees 00 minutes 00 seconds East, (0.24 feet left) 400.00 feet to a set iron rod;

THENCE with the following two (2) courses and distances:
1. South 78 degrees 41 minutes 24 seconds West, 509.90 feet to a point;
2. North 56 degrees 18 minutes 36 seconds West, 360.56 feet to the POINT OF BEGINNING, containing 94.53 acres of land, more or less.

SAVE AND EXCEPT out of the above described 94.53 acre tract a 12.584 acre tract, more particularly described as follows:

BEGINNING at a found iron rod for the southwest corner of said exception tract;
THENCE North 00 degrees 00 minutes 00 seconds East, 100.00 feet to a point;
THENCE North 90 degrees 00 minutes 00 seconds East, 100.00 feet to a point;
THENCE South 00 degrees 00 minutes 00 seconds East, 100.00 feet to a point;
THENCE South 90 degrees 00 minutes 00 seconds West, 100.00 feet to the PLACE OF BEGINNING, containing 12.584 acres of land, more or less.
`;

describe("deedParse.js — real-deed construct audit (curves, passing-at, offset notes, tie calls, save-and-except, numbered sub-lists)", () => {
  const tracts = parseTracts(REAL_DEED_TEXT);

  it("finds exactly two tracts: the boundary and one SAVE AND EXCEPT", () => {
    expect(tracts).toHaveLength(2);
    expect(tracts[0].role).toBe("boundary");
    expect(tracts[1].role).toBe("except");
  });

  it("keeps the COMMENCING 'bears … 1.73 feet' monument tie as its own TIE traverse, separate from the boundary", () => {
    // it's a real, usable one-course tie (locates the POB from the reference monument) — deedParse.js
    // correctly keeps it OUT of the boundary traverse's own calls, which is what matters for closure.
    expect(tracts[0].tie).toHaveLength(1);
    expect(tracts[0].tie[0].bearing).toBe('S01°13\'45"E');
    expect(tracts[0].calls).toHaveLength(6); // not 7 — the tie call never becomes a 7th boundary course
  });

  it("parses the curve course with its full radius/central-angle/arc/chord meta, not as a straight chord", () => {
    const curve = tracts[0].calls[1];
    expect(curve.curve).toBe(true);
    expect(curve.curveMeta.turn).toBe("R");
    expect(curve.curveMeta.radiusFt).toBeCloseTo(400, 1);
    expect(curve.curveMeta.centralAngleDeg).toBeCloseTo(60, 1);
    expect(curve.curveMeta.arcFt).toBeCloseTo(418.88, 1);
    expect(curve.distFt).toBeCloseTo(400, 1); // the CHORD distance, used for dead-reckoning
  });

  it("takes the 'for a total distance of' governing length, not the 'passing at' waypoint", () => {
    const c = tracts[0].calls[2];
    expect(c.distFt).toBeCloseTo(412.31, 1); // not 200.00
  });

  it("strips a parenthetical offset note without corrupting the distance", () => {
    const c = tracts[0].calls[3];
    expect(c.distFt).toBeCloseTo(400, 1);
  });

  it("parses a numbered 'following N courses and distances' sub-list with no per-line THENCE", () => {
    expect(tracts[0].calls[4].bearing).toBe('S78°41\'24"W');
    expect(tracts[0].calls[5].bearing).toBe('N56°18\'36"W');
  });

  it("labels the SAVE AND EXCEPT tract with ITS OWN acreage, not the original tract's restated acreage", () => {
    // the except tract's header restates the ORIGINAL 94.53-acre tract before its own 12.584 acres —
    // the label must not pick up the wrong (first-mentioned) figure (this is the real, if minor, bug
    // this audit found and fixed in deedParse.js's tract-label heuristic)
    expect(tracts[1].label).toBe("12.584 acres");
  });

  it("closes the boundary traverse (curve included) to a tight tolerance — proves the FULL construct set together, not just each in isolation", () => {
    const path = callsToPath(tracts[0].calls, { x: 0, y: 0 });
    expect(pathCloses(path)).toBe(true);
    expect(misclosure(path)).toBeLessThan(1); // sub-foot — floating-point only, not a real gap
  });

  it("closes the SAVE AND EXCEPT tract's own traverse", () => {
    const path = callsToPath(tracts[1].calls, { x: 0, y: 0 });
    expect(pathCloses(path)).toBe(true);
    expect(misclosure(path)).toBeLessThan(0.01);
  });
});

// A second curve, opposite turn direction, immediately following the first — the "reverse curve"
// construct the real deed also contains. deedParse.js has no cross-course state (coursesOf parses
// each THENCE segment independently), so proving each turn direction in isolation is the complete
// proof; nothing about being adjacent changes how either one is read.
describe("deedParse.js — reverse curve pair (opposite turn directions, independently correct)", () => {
  it("reads a curve to the right correctly", () => {
    const t = parseTracts('THENCE along a curve to the right, having a radius of 300.00 feet, a central angle of 30°00\'00", an arc length of 157.08 feet, and a long chord which bears North 15°00\'00" East, 155.29 feet to a point;');
    expect(t[0].calls[0].curveMeta.turn).toBe("R");
  });
  it("reads a curve to the left correctly, immediately after a curve to the right", () => {
    const t = parseTracts([
      'THENCE along a curve to the right, having a radius of 300.00 feet, a central angle of 30°00\'00", an arc length of 157.08 feet, and a long chord which bears North 15°00\'00" East, 155.29 feet to a point;',
      'THENCE along a curve to the left, having a radius of 250.00 feet, a central angle of 20°00\'00", an arc length of 87.27 feet, and a long chord which bears North 20°00\'00" East, 86.82 feet to a point;',
    ].join("\n"));
    expect(t[0].calls).toHaveLength(2);
    expect(t[0].calls[0].curveMeta.turn).toBe("R");
    expect(t[0].calls[1].curveMeta.turn).toBe("L");
  });
});
