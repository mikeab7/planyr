import { describe, it, expect } from "vitest";
import { candidateCountiesForPoint, COUNTIES_MAP } from "../src/workspaces/site-planner/lib/counties.js";

// candidateCountiesForPoint routes a map click to the CAD service(s) that could
// own the clicked lot, WITHOUT a county pre-pick (B11). The statewide TxGIO layer
// (configured under `chambers`) paints parcel outlines across all of Texas, so it
// must also be queryable everywhere as a universal fallback — otherwise a click
// over a county whose own CAD is down/unconfigured sees an outline it can't select
// (the Fort Bend symptom, B130).
describe("candidateCountiesForPoint — click routing (B11/B130)", () => {
  const STATEWIDE = Object.entries(COUNTIES_MAP).filter(([, c]) => c.statewide).map(([k]) => k);

  it("a Fort Bend point includes fortbend AND the statewide source (the B130 fix)", () => {
    // Sugar Land — squarely in Fort Bend, outside the narrow Chambers bbox.
    const cand = candidateCountiesForPoint(29.6197, -95.6349);
    expect(cand).toContain("fortbend");
    // chambers == the statewide TxGIO layer; before B130 it was NOT a candidate here,
    // so a click found nothing whenever FBCAD was down.
    expect(cand).toContain("chambers");
    expect(STATEWIDE).toContain("chambers"); // the statewide flag is what pulls it in
  });

  it("the statewide source is appended LAST so a county's own CAD answers first", () => {
    const cand = candidateCountiesForPoint(29.6197, -95.6349);
    // every non-statewide (real CAD bbox match) precedes every statewide key
    const lastBboxIdx = Math.max(...cand.filter((k) => !STATEWIDE.includes(k)).map((k) => cand.indexOf(k)));
    const firstStatewideIdx = Math.min(...STATEWIDE.map((k) => cand.indexOf(k)).filter((i) => i >= 0));
    expect(lastBboxIdx).toBeLessThan(firstStatewideIdx);
  });

  it("does not duplicate the statewide key when the point is in its own bbox", () => {
    // A point inside the Chambers bbox: chambers matches by bbox, must appear once.
    const cand = candidateCountiesForPoint(29.7, -94.66);
    expect(cand.filter((k) => k === "chambers")).toHaveLength(1);
  });

  it("a Harris point still routes to harris first, with statewide as the trailing fallback", () => {
    const cand = candidateCountiesForPoint(29.76, -95.37);
    expect(cand[0]).toBe("harris");
    expect(cand).toContain("chambers"); // fallback present, but harris answers first
  });

  it("a point outside every county bbox still includes the statewide source", () => {
    // Far West Texas — outside all three configured county bboxes, but TxGIO covers it.
    const cand = candidateCountiesForPoint(31.7619, -106.485); // El Paso
    expect(cand).toContain("chambers");
    expect(cand.length).toBeGreaterThan(0);
  });
});
