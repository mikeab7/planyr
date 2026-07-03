import { describe, it, expect } from "vitest";
import { fitEdgeLine, orderEndpoints, matchSeamEdges } from "../src/shared/files/edgeGeomMatch.js";

// A dashed vertical match line at x=900 spanning y 100..1500, as several colinear dashes.
function verticalDashes(x, y0, y1, { dashes = 6, skew = 0 } = {}) {
  const segs = [];
  const step = (y1 - y0) / dashes;
  for (let i = 0; i < dashes; i += 2) { // every other dash = a gap
    const ya = y0 + i * step, yb = y0 + (i + 1) * step;
    segs.push({ x1: x + skew * (ya - y0), y1: ya, x2: x + skew * (yb - y0), y2: yb });
  }
  return segs;
}

describe("fitEdgeLine — total-least-squares fit through drawn segments (B340 tail #2)", () => {
  it("fits a vertical dashed line and returns its extent endpoints + high straightness", () => {
    const fit = fitEdgeLine(verticalDashes(900, 100, 1500));
    expect(fit).not.toBeNull();
    expect(fit.span).toBeGreaterThan(1000);
    expect(fit.straightness).toBeGreaterThan(0.99);
    // Endpoints hug x≈900.
    expect(Math.abs(fit.p1.x - 900)).toBeLessThan(1);
    expect(Math.abs(fit.p2.x - 900)).toBeLessThan(1);
  });

  it("returns null for too few points", () => {
    expect(fitEdgeLine([])).toBeNull();
    expect(fitEdgeLine([{ x1: 0, y1: 0, x2: NaN, y2: 0 }])).toBeNull();
  });

  it("orderEndpoints puts a vertical seam top→bottom (matches detectedEndpointsFor)", () => {
    const [a, b] = orderEndpoints({ x: 900, y: 1500 }, { x: 900, y: 100 });
    expect(a.y).toBeLessThan(b.y);
  });
});

describe("matchSeamEdges — correspond a drawn cut across two sheets", () => {
  it("matches two clean vertical match lines and returns ordered endpoint pairs", () => {
    // Anchor's RIGHT-edge line and neighbor's LEFT-edge line — same physical cut, same length.
    const anchor = verticalDashes(1850, 80, 1520);
    const neighbor = verticalDashes(60, 80, 1520);
    const m = matchSeamEdges(anchor, neighbor);
    expect(m).not.toBeNull();
    expect(m.confidence).toBeGreaterThan(0.8);
    // Ordered top→bottom on both, so solveM won't 180°-flip the neighbor.
    expect(m.a1.y).toBeLessThan(m.a2.y);
    expect(m.b1.y).toBeLessThan(m.b2.y);
  });

  it("rejects (null) when the two lines disagree in orientation — fail open", () => {
    const vertical = verticalDashes(900, 100, 1500);
    const horizontal = [{ x1: 100, y1: 700, x2: 1600, y2: 700 }];
    expect(matchSeamEdges(vertical, horizontal)).toBeNull();
  });

  it("rejects when one line is far shorter than the other (not the same cut)", () => {
    const long = verticalDashes(900, 100, 1500);
    const short = verticalDashes(900, 700, 780);
    expect(matchSeamEdges(long, short)).toBeNull();
  });

  it("tolerates a small consistent skew (each plot is rotated ~1° from the next)", () => {
    const anchor = verticalDashes(1850, 80, 1520, { skew: 0.01 });
    const neighbor = verticalDashes(60, 80, 1520, { skew: 0.01 });
    const m = matchSeamEdges(anchor, neighbor);
    expect(m).not.toBeNull();
  });
});
