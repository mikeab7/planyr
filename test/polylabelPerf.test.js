/* polylabelPerf — NEW-1 / B2224000 (plan-open hitch). The acreage-badge anchor (`polylabel`) cost 416 ms for Concept A's 16 parcels, inside one React
 * render on every plan open: (1) its candidate queue was rescanned on every pop (O(n) per step) and a long thin strip keeps thousands of cells
 * alive; (2) its cache was keyed by ARRAY IDENTITY, and every open re-seeds parcels from rows into new arrays with identical coordinates.
 * This pins: the heap answer is as good as the original (against a verbatim copy of the original search), it is much cheaper, and identical
 * geometry in a fresh array is answered from the content cache. The fixture is the owner's real plan (ui-audit/fixtures/plan-load). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { polylabel, signedDist } from "../src/workspaces/site-planner/lib/polylabel.js";

const SQRT2 = Math.SQRT2;
const cellOf = (x, y, h, ring) => { const d = signedDist({ x, y }, ring); return { x, y, h, d, max: d + h * SQRT2 }; };
/* VERBATIM original search (linear-scan popBest), no cache — the reference the heap must match in quality. */
function referencePolylabel(ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  const w = maxX - minX, h = maxY - minY; const centre = { x: minX + w / 2, y: minY + h / 2 };
  const cellSize = Math.min(w, h); if (!(cellSize > 0)) return { pt: centre, prec: 0 };
  const prec = Math.max(0.25, cellSize / 200);
  let best = cellOf(centre.x, centre.y, 0, ring); const queue = [];
  const popBest = () => { let bi = 0; for (let i = 1; i < queue.length; i++) if (queue[i].max > queue[bi].max) bi = i; const c = queue[bi]; queue[bi] = queue[queue.length - 1]; queue.pop(); return c; };
  const half = cellSize / 2;
  for (let x = minX; x < maxX; x += cellSize) for (let y = minY; y < maxY; y += cellSize) queue.push(cellOf(x + half, y + half, half, ring));
  let guard = 20000;
  while (queue.length && guard-- > 0) {
    const c = popBest(); if (c.d > best.d) best = c; if (c.max - best.d <= prec) continue;
    const q = c.h / 2; queue.push(cellOf(c.x - q, c.y - q, q, ring), cellOf(c.x + q, c.y - q, q, ring), cellOf(c.x - q, c.y + q, q, ring), cellOf(c.x + q, c.y + q, q, ring));
  }
  return { pt: best.d > 0 ? { x: best.x, y: best.y } : centre, prec };
}
const fixture = JSON.parse(readFileSync(new URL("../ui-audit/fixtures/plan-load/concept-a.json", import.meta.url), "utf8"));
const rings = () => fixture.rows.filter((r) => r.kind === "parcel").map((r) => r.data.points.map((p) => ({ x: p.x, y: p.y })));
const time = (fn) => { const t = performance.now(); fn(); return performance.now() - t; };

describe("polylabel — heap search (NEW-1 plan-open hitch)", () => {
  it("every Concept A parcel anchor is inside the ring and within the search precision of the original's clearance", () => {
    for (const ring of rings()) {
      const ref = referencePolylabel(ring), got = polylabel(ring);
      expect(signedDist(got, ring)).toBeGreaterThan(0);
      expect(signedDist(got, ring)).toBeGreaterThanOrEqual(signedDist(ref.pt, ring) - ref.prec);
    }
  });
  it("is much cheaper than the original on the real plan (ratio, not a wall-clock figure)", () => {
    const rs = rings();
    const orig = time(() => rs.forEach((r) => referencePolylabel(r)));
    const fresh = rings();
    const heap = time(() => fresh.forEach((r) => polylabel(r)));
    expect(orig).toBeGreaterThan(heap * 3);
  });
  it("identical coordinates in a FRESH array are answered from the content cache (a plan open re-seeds new arrays)", () => {
    const a = rings()[3];
    const first = polylabel(a);
    const b = a.map((p) => ({ x: p.x, y: p.y }));
    expect(b).not.toBe(a);
    let got; const ms = time(() => { got = polylabel(b); });
    expect(got).toBe(first);
    expect(ms).toBeLessThan(2);
  });
  it("a moved vertex is NOT answered from the cache", () => {
    const a = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const first = polylabel(a);
    const b = a.map((p, i) => (i === 2 ? { x: 400, y: 400 } : i === 1 ? { x: 400, y: 0 } : i === 3 ? { x: 0, y: 400 } : { ...p }));   // same vertex count, three vertices moved
    const got = polylabel(b);
    expect(got).not.toBe(first);
    expect(Math.abs(got.x - first.x) + Math.abs(got.y - first.y)).toBeGreaterThan(5);
  });
  it("degenerate rings are still handled (null / bbox centre) and never cached as something else", () => {
    expect(polylabel([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    expect(polylabel([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }])).toEqual({ x: 5, y: 0 });
    expect(polylabel([{ x: 0, y: 0 }, { x: NaN, y: 1 }, { x: 4, y: 4 }])).toBeNull();
  });
});
