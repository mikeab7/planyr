import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { docxToText } from "../src/shared/files/docxText.js";
import { parseTracts, parseCalls, callsToPath, pathCloses } from "../src/workspaces/site-planner/lib/metesAndBounds.js";

const ab = (rel) => {
  const b = readFileSync(fileURLToPath(new URL(rel, import.meta.url)));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
const textOf = (name) => docxToText(ab(`./fixtures/deeds/${name}`));

/* Synthetic forms — the exact patterns that defeated the old single-regex parser,
 * pulled out as fast, self-documenting unit checks. */
describe("metes-and-bounds parser — real-deed forms", () => {
  it("reads a spelled-out bearing (North … East), not just N … E", () => {
    const c = parseCalls("THENCE, North 45°30'00\" East, 150.00 feet to a point;");
    expect(c).toHaveLength(1);
    expect(c[0].bearing).toBe("N45°30'00\"E");
    expect(c[0].az).toBeCloseTo(45.5, 5);
    expect(c[0].distFt).toBeCloseTo(150, 3);
  });

  it("takes the governing 'total distance', NOT an intervening 'passing at' waypoint", () => {
    const c = parseCalls("THENCE North 87°04'16\" East, passing at 1264.25 feet a found rod, for a total distance of 1773.49 feet;");
    expect(c).toHaveLength(1);
    expect(c[0].distFt).toBeCloseTo(1773.49, 2);
  });

  it("ignores a monument tie call's distance ('…bears … , 1.73 feet')", () => {
    const c = parseCalls("THENCE North 87°15'45\" East, from which a found rod bears South 01°13'45\" East, 1.73 feet, in total a distance of 763.87 feet to a corner;");
    expect(c).toHaveLength(1);
    expect(c[0].bearing).toBe("N87°15'45\"E");
    expect(c[0].distFt).toBeCloseTo(763.87, 2);
  });

  it("ignores a parenthetical offset note '(0.14 feet left)'", () => {
    const c = parseCalls("THENCE South 00°00'00\" West, (0.14 feet left) 445.02 feet to a found rod;");
    expect(c[0].distFt).toBeCloseTo(445.02, 2);
  });

  it("reads a curve as its long chord and flags it + keeps the arc meta", () => {
    const c = parseCalls("THENCE along the arc of a curve to the right having a radius of 25.00 feet, a central angle of 40°07'10\", an arc length of 17.51 feet, and a long chord bearing North 69°56'26\" West, 17.15 feet to a point;");
    expect(c).toHaveLength(1);
    expect(c[0].curve).toBe(true);
    expect(c[0].bearing).toBe("N69°56'26\"W");
    expect(c[0].distFt).toBeCloseTo(17.15, 2);
    expect(c[0].curveMeta.radiusFt).toBeCloseTo(25, 3);
    expect(c[0].curveMeta.arcFt).toBeCloseTo(17.51, 2);
    expect(c[0].curveMeta.centralAngleDeg).toBeCloseTo(40.1194, 3);
    expect(c[0].curveMeta.turn).toBe("R");
  });

  it("does NOT split a tract on a lower-case 'save and except' inside prose", () => {
    const text = "BEGINNING at a point;\nTHENCE North 0 East, 100 feet;\nTHENCE South 90 East, 100 feet save and except a 1 acre tract;\nTHENCE South 0 West, 100 feet;\nTHENCE North 90 West, 100 feet to the POINT OF BEGINNING.";
    const t = parseTracts(text);
    expect(t).toHaveLength(1);
    expect(t[0].calls).toHaveLength(4);
  });

  it("splits a real 'SAVE AND EXCEPT' tract header at line start", () => {
    const text = "BEGINNING at a point;\nTHENCE North 0 East, 100 feet to the POINT OF BEGINNING.\nSAVE AND EXCEPT Tract 2\nCOMMENCING at a point;\nTHENCE South 0 West, 50 feet to the POINT OF BEGINNING of said tract;\nTHENCE North 0 East, 10 feet to the POINT OF BEGINNING.";
    const t = parseTracts(text);
    expect(t.map((x) => x.role)).toEqual(["boundary", "except"]);
    expect(t[1].tie.length).toBeGreaterThan(0); // commencing tie captured for hole placement
  });
});

/* Hardening from the adversarial review — the latent edge cases that didn't show
 * up on the 5 clean sample deeds but would bite a messier one. */
describe("metes-and-bounds parser — review hardening", () => {
  it("a monument tie that ENDS in 'to' does not beat the real leg length", () => {
    const c = parseCalls("THENCE North 0 East, a distance of 250.00 feet to a corner, from which a found rod bears North 45 East, 12.00 feet to a pipe;");
    expect(c).toHaveLength(1);
    expect(c[0].distFt).toBeCloseTo(250, 2); // not the tie's 12.00
  });
  it("rejects a bearing with minutes or seconds ≥ 60 as malformed", () => {
    expect(parseCalls("N 45°99'00\" E 100 ft")).toHaveLength(0);
    expect(parseCalls("N 45°00'75\" E 100 ft")).toHaveLength(0);
  });
  it("does NOT split on an upper-case 'SAVE AND EXCEPT' used in prose (no new traverse follows)", () => {
    const text = "BEGINNING at a point;\nTHENCE North 0 East, 100 feet;\nSAVE AND EXCEPT all oil, gas and minerals therein;\nTHENCE South 0 West, 100 feet to the POINT OF BEGINNING.";
    const t = parseTracts(text);
    expect(t).toHaveLength(1);
    expect(t[0].calls).toHaveLength(2);
  });
  it("reads a curve whose chord clause says 'which bears'", () => {
    const c = parseCalls("THENCE along a curve to the left having a radius of 100.00 feet, a long chord which bears South 18°17'04\" East, 23.39 feet to a point;");
    expect(c).toHaveLength(1);
    expect(c[0].curve).toBe(true);
    expect(c[0].bearing).toBe("S18°17'04\"E");
    expect(c[0].distFt).toBeCloseTo(23.39, 2);
  });
  it("a real misclosure on a big tract reads as NOT closed (old 2% rule masked it)", () => {
    // ~3960 ft of run, 40-ft gap (~1%): old tol (2% ≈ 79 ft) would falsely 'close'
    // it; new tol (0.5% ≈ 20 ft, cap 50) correctly reports it open.
    const calls = parseCalls("THENCE North 0 East 1000 ft; THENCE South 90 East 1000 ft; THENCE South 0 West 1000 ft; THENCE North 90 West 960 ft;");
    expect(pathCloses(callsToPath(calls, { x: 0, y: 0 }))).toBe(false);
  });
});

/* True-to-arc curve rendering (B566) — a curve course is tessellated into its real
 * circular arc, not drawn as a straight chord. Frame: +x east, +y south. */
describe("metes-and-bounds — curves render as true arcs", () => {
  // chord due east 100 ft; R = 70.71, Δ = 90° → sagitta = R(1 - cos45°) ≈ 20.71 ft.
  const curve = (turn) => ({ az: 90, distFt: 100, curve: true, curveMeta: { radiusFt: 70.71, centralAngleDeg: 90, turn } });

  it("a curve is tessellated (many points) and still ends exactly at the chord endpoint", () => {
    const path = callsToPath([curve("R")], { x: 0, y: 0 });
    expect(path.length).toBeGreaterThan(3);
    expect(path[0]).toEqual({ x: 0, y: 0 });
    const last = path[path.length - 1];
    expect(last.x).toBeCloseTo(100, 3);
    expect(last.y).toBeCloseTo(0, 3);
  });

  it("a right-hand curve bulges to the traveller's right (north of an east chord)", () => {
    const path = callsToPath([curve("R")], { x: 0, y: 0 });
    expect(Math.min(...path.map((p) => p.y))).toBeCloseTo(-20.71, 1); // north = -y
  });

  it("a left-hand curve bulges the other way (south)", () => {
    const path = callsToPath([curve("L")], { x: 0, y: 0 });
    expect(Math.max(...path.map((p) => p.y))).toBeCloseTo(20.71, 1); // south = +y
  });

  it("falls back to a straight chord when no radius/angle is stated", () => {
    const path = callsToPath([{ az: 90, distFt: 100, curve: true, curveMeta: { turn: "R" } }], { x: 0, y: 0 });
    expect(path.length).toBe(2); // POB + chord endpoint only
  });
});

/* Full real-survey corpus, verified course-for-course against an independent
 * ground-truth transcription (the parser must keep reading every one). */
const ORACLE = {
  "deed-94_91.docx": {
    tracts: [["boundary", 15]],
    spot: { tract: 0, first: ["N87°04'16\"E", 1773.49], last: ["N02°39'44\"W", 2477.79], curveAt: [4, "N69°56'26\"W", 17.15] },
  },
  "deed-82_33-save-except.docx": { tracts: [["boundary", 15], ["except", 7]] },
  "deed-kilgore-draft.docx": { tracts: [["boundary", 15], ["except", 7]] },
  "deed-76_531-save-except.docx": { tracts: [["boundary", 15], ["except", 5]] },
  "deed-81_95-save-except.docx": { tracts: [["boundary", 13], ["except", 7]] },
};

describe("metes-and-bounds parser — real survey .docx (end-to-end)", () => {
  for (const [name, exp] of Object.entries(ORACLE)) {
    it(`${name}: tracts, course counts, and the boundary closes`, async () => {
      const tracts = parseTracts(await textOf(name));
      expect(tracts.map((t) => [t.role, t.calls.length])).toEqual(exp.tracts);
      // the main boundary must close back to its POB (within the 2% tolerance)
      expect(pathCloses(callsToPath(tracts[0].calls, { x: 0, y: 0 }))).toBe(true);
      if (exp.spot) {
        const calls = tracts[exp.spot.tract].calls;
        expect(calls[0].bearing).toBe(exp.spot.first[0]);
        expect(calls[0].distFt).toBeCloseTo(exp.spot.first[1], 2);
        expect(calls.at(-1).bearing).toBe(exp.spot.last[0]);
        expect(calls.at(-1).distFt).toBeCloseTo(exp.spot.last[1], 2);
        const cv = calls[exp.spot.curveAt[0]];
        expect(cv.curve).toBe(true);
        expect(cv.bearing).toBe(exp.spot.curveAt[1]);
        expect(cv.distFt).toBeCloseTo(exp.spot.curveAt[2], 2);
      }
    });
  }
});
