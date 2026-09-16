/* B1703664 NEW-1 — the acceptance measure the dispatch demanded BEFORE any geometry fix. Three PRs
 * (B1645792 and its two amendments) shipped a fully green suite built entirely on
 * `floodFillEnclosed` — a border flood fill that can only ever see an ENCLOSED hole — while the
 * owner's real junction carried a bevel cut into the pavement that is OPEN to the surrounding grass:
 * a boundary CONCAVITY, reachable from the scan box's border, so the fill walked straight through it
 * and reported a true, meaningless zero. `convexDeficiency` (ui-audit/lib/paveFloodFill.mjs) is the
 * complementary measure: convex hull of the paved cells, count unpaved cells inside that hull. A
 * square corner rounded by a real curb return has a SMALL deficiency (the circular segment the
 * fillet itself cuts — expected, not a defect); a raw bevel or a missing return leaves a LARGE one
 * (the whole triangular gore). This file proves the measure itself works — on synthetic shapes whose
 * answer is known independently of any road-geometry code — before it is trusted on real junction
 * geometry in test/roadDriveJunctionFillet.test.js. */
import { describe, it, expect } from "vitest";
import {
  floodFillEnclosed, pointInRing, pavedPredicate, enclosedAreaSqFt,
  convexHullOf, convexDeficiency, deficiencyAreaSqFt,
  assertMeasurableFloodFill, assertMeasurableConvexDeficiency,
} from "../ui-audit/lib/paveFloodFill.mjs";

const square = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];

describe("convexHullOf — dependency-free hull, matches the shape it's given", () => {
  it("a solid square's own corners come back as the hull", () => {
    const hull = convexHullOf([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 5, y: 5 }]);
    expect(hull.length).toBe(4);
    for (const c of [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]) {
      expect(hull.some((p) => Math.abs(p.x - c.x) < 1e-9 && Math.abs(p.y - c.y) < 1e-9)).toBe(true);
    }
  });
  it("fewer than 3 distinct points → null", () => {
    expect(convexHullOf([])).toBeNull();
    expect(convexHullOf([{ x: 0, y: 0 }])).toBeNull();
    expect(convexHullOf([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
  });
});

describe("floodFillEnclosed — the ENCLOSED-hole measure this repo already shipped", () => {
  it("a solid square: zero unpaved cells anywhere in the scan box", () => {
    const isPaved = pavedPredicate([square(0, 0, 40, 40)], []);
    const r = floodFillEnclosed(isPaved, { x0: -10, y0: -10, x1: 50, y1: 50 }, 1);
    expect(r.enclosedCount).toBe(0);
  });

  it("⛔ THE ACCEPTANCE-TEST BUG ITSELF, reproduced on a synthetic shape: an OPEN notch (a bevel cut " +
     "from a corner, reachable from the border) reads as ZERO enclosed area — a true, meaningless " +
     "zero, exactly the shape that let three PRs ship green on a visibly broken junction", () => {
    // A 40x40 square with its top-right corner cut off by a straight diagonal (a "bevel") — the
    // missing triangle is OPEN to the grass outside the square, not enclosed by pavement.
    const bevel = [{ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 40, y: 25 }, { x: 25, y: 40 }, { x: 0, y: 40 }];
    const isPaved = pavedPredicate([bevel], []);
    const { real } = assertMeasurableFloodFill(isPaved, { x0: -10, y0: -10, x1: 50, y1: 50 }, 1, { x: 20, y: 20 }, 3, "bevel-notch");
    expect(real.enclosedCount, "the border flood fill cannot see an OPEN notch — this is the bug, not a bad assertion").toBe(0);
  });

  it("an ENCLOSED courtyard (a hole entirely surrounded by pavement) IS caught", () => {
    const outer = square(0, 0, 40, 40);
    const isPaved = (p) => pointInRing(p, outer) && !(p.x > 15 && p.x < 25 && p.y > 15 && p.y < 25);
    const { real } = assertMeasurableFloodFill(isPaved, { x0: -10, y0: -10, x1: 50, y1: 50 }, 1, { x: 5, y: 5 }, 2, "courtyard");
    expect(real.enclosedCount).toBeGreaterThan(0);
    expect(enclosedAreaSqFt(real)).toBeGreaterThan(50);
  });

  it("self-test control THROWS when the scan genuinely cannot see a hole (box far from the geometry)", () => {
    const isPaved = pavedPredicate([square(0, 0, 40, 40)], []);
    expect(() => assertMeasurableFloodFill(isPaved, { x0: 1000, y0: 1000, x1: 1010, y1: 1010 }, 1, { x: 1005, y: 1005 }, 2, "far-away"))
      .toThrow(/self-test FAILED/);
  });
});

describe("convexDeficiency — THE FIX: sees an open notch, not just an enclosed hole", () => {
  it("a solid square: zero deficiency (the hull IS the paved shape)", () => {
    const isPaved = pavedPredicate([square(0, 0, 40, 40)], []);
    const { real } = assertMeasurableConvexDeficiency(isPaved, { x0: -10, y0: -10, x1: 50, y1: 50 }, 1, { x: 20, y: 20 }, 3, "solid-square");
    expect(real.deficientCount).toBe(0);
  });

  // A single straight bevel cut off a lone convex shape is STILL convex (its own hull), so it shows
  // zero deficiency against ITSELF — that shape doesn't model the real defect at all. The real defect
  // is a T/L JUNCTION: a pad (a wide rect) with a driveway (a narrower rect) teeing into its edge —
  // the UNION is concave at the two "armpit" corners where the drive meets the pad, and THAT concave
  // union's own convex hull reaches past it into the armpits. A real curb return fills MOST of an
  // armpit (leaving only the circular segment the fillet itself can't reach); a raw butt joint or a
  // bevel leaves the WHOLE armpit as open, ungoverned deficiency — exactly what floodFillEnclosed
  // cannot see, because each armpit is open to the grass outside the union, not enclosed by pavement.
  const pad = square(0, 0, 300, 50);          // the wide pad, road ties into its TOP edge (y=50)
  // The driveway is wide (its own two corners far apart), same as the dispatch's real 37 ft road —
  // this window (below) is scoped to the LEFT corner only, exactly like the dispatch's own "32 ft
  // window on the BAD corner" / "same window on the GOOD corner", each measured separately.
  const driveRaw = square(40, 50, 240, 150);  // the driveway strip, teeing in with a raw square butt
  // The ADDITIVE curb-return wedge teeGeometry itself builds (see roadGeometry.js's own header): a
  // circle tangent to the pad's top edge (y=50) and the drive's left edge (x=40), centred INSIDE the
  // armpit at (40-R, 50+R), so its arc bulges toward the corner (40,50) — filling most of the armpit
  // and leaving only the small circular-segment residual between the arc and the sharp corner.
  function returnWedge(R) {
    const corner = { x: 40, y: 50 }, tan1 = { x: 40 - R, y: 50 }, tan2 = { x: 40, y: 50 + R };
    const cx = 40 - R, cy = 50 + R;
    const pts = [corner, tan1];
    for (let a = 270; a <= 360; a += 5) pts.push({ x: cx + R * Math.cos((a * Math.PI) / 180), y: cy + R * Math.sin((a * Math.PI) / 180) });
    pts.push(tan2);
    return pts;
  }
  // A window centred on the LEFT armpit corner (40,50) — scaled to the return radius the same way
  // the dispatch's own "32 ft window on the corner" was: big enough to see the whole return, small
  // enough that the corner's OWN treatment — not how far away the pad/drive edges happen to run —
  // dominates the reading. (A window many times wider than the return radius mostly measures how
  // far the pad and drive extend past the window edge, which swamps the corner signal entirely —
  // measured directly while building this fixture.)
  const CORNER = { x: 40, y: 50 }, HALF = 16;
  const win = { x0: CORNER.x - HALF, y0: CORNER.y - HALF, x1: CORNER.x + HALF, y1: CORNER.y + HALF };
  const discCenter = { x: 30, y: 40 }; // well inside the solid pad body, inside the window

  it("a RAW BUTT JOINT (no return at all) leaves a LARGE, real deficiency at the junction corner", () => {
    const isPaved = pavedPredicate([pad, driveRaw], []);
    const { real } = assertMeasurableConvexDeficiency(isPaved, win, 0.5, discCenter, 3, "raw-butt-joint");
    expect(deficiencyAreaSqFt(real)).toBeGreaterThan(100);
  });

  it("a REAL, TANGENT curb-return fillet leaves only the small circular-segment residual — the " +
     "SAME corner, ORDERS OF MAGNITUDE less deficiency than the raw butt joint above", () => {
    const R = 24;
    const isPaved = pavedPredicate([pad, driveRaw, returnWedge(R)], []);
    const { real } = assertMeasurableConvexDeficiency(isPaved, win, 0.5, discCenter, 3, "real-fillet-corner");
    const area = deficiencyAreaSqFt(real);
    expect(area).toBeGreaterThan(10);
    expect(area).toBeLessThan(60);
  });

  it("THE DISCRIMINATION THAT MATTERS: the fillet's deficiency is a small fraction of the raw joint's " +
     "— the same order of magnitude as the real junction's GOOD-vs-BAD-corner ratio in the dispatch " +
     "(≈5.5x)", () => {
    const isPavedRaw = pavedPredicate([pad, driveRaw], []);
    const isPavedFilleted = pavedPredicate([pad, driveRaw, returnWedge(24)], []);
    const rawArea = deficiencyAreaSqFt(convexDeficiency(isPavedRaw, win, 0.5));
    const filletArea = deficiencyAreaSqFt(convexDeficiency(isPavedFilleted, win, 0.5));
    expect(rawArea / filletArea).toBeGreaterThan(3);
  });

  it("floodFillEnclosed genuinely cannot see either armpit — it is 0 for BOTH the raw joint and the " +
     "fillet, which is exactly why it went green on a broken build three times", () => {
    const isPavedRaw = pavedPredicate([pad, driveRaw], []);
    const isPavedFilleted = pavedPredicate([pad, driveRaw, returnWedge(24)], []);
    expect(floodFillEnclosed(isPavedRaw, win, 0.5).enclosedCount).toBe(0);
    expect(floodFillEnclosed(isPavedFilleted, win, 0.5).enclosedCount).toBe(0);
  });

  it("BOTH measures agree on an enclosed courtyard (neither substitutes for the other)", () => {
    const outer = square(0, 0, 40, 40);
    const isPaved = (p) => pointInRing(p, outer) && !(p.x > 15 && p.x < 25 && p.y > 15 && p.y < 25);
    const { real } = assertMeasurableConvexDeficiency(isPaved, { x0: -10, y0: -10, x1: 50, y1: 50 }, 1, { x: 5, y: 5 }, 2, "courtyard-deficiency");
    expect(real.deficientCount).toBeGreaterThan(0);
  });

  it("self-test control THROWS when the scan genuinely cannot see a concavity", () => {
    const isPaved = pavedPredicate([square(0, 0, 40, 40)], []);
    expect(() => assertMeasurableConvexDeficiency(isPaved, { x0: 1000, y0: 1000, x1: 1010, y1: 1010 }, 1, { x: 1005, y: 1005 }, 2, "far-away"))
      .toThrow(/self-test FAILED/);
  });
});
