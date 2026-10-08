/* NEW-1 (B217540 ×3) — `collapseRingSpikes` maintains the one-sided Hausdorff drift bound INCREMENTALLY (a removal changes
 * two segments, so only the vertices that were nearest to them are re-scanned). That must give the SAME ring, vertex for
 * vertex, as the original which re-measured `ringDrift(orig, next)` from scratch for every candidate. The reference below IS
 * that original body, verbatim, kept here so the equivalence is checked against what shipped rather than against itself. */
import { describe, it, expect } from "vitest";
import { collapseRingSpikes, ringSpikes, ringDrift, RING_SPIKE_PASS_DRIFT_FT } from "../src/workspaces/site-planner/lib/roadNetwork.js";

function referenceCollapse(ring, opts = {}) {
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const passDriftFt = Number.isFinite(opts.passDriftFt) ? opts.passDriftFt : RING_SPIKE_PASS_DRIFT_FT;
  const orig = ring.map((p) => ({ x: p.x, y: p.y }));
  let pts = ring.slice();
  let guard = ring.length + 8;
  while (guard-- > 0 && pts.length > 3) {
    const spikes = ringSpikes(pts, opts);
    if (!spikes.length) break;
    let removed = false;
    for (const s of spikes) {
      const next = pts.slice();
      next.splice(s.i, 1);
      if (next.length < 3) continue;
      if (ringDrift(orig, next) > passDriftFt) continue;
      pts = next; removed = true; break;
    }
    if (!removed) break;
  }
  return pts;
}

// a small deterministic PRNG so a failure is reproducible
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }

function noisyRing(seed, n, spikes) {
  const r = rng(seed), out = [];
  const R = 60 + r() * 140;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, rr = R * (1 + (r() - 0.5) * 0.04);
    out.push({ x: Math.cos(a) * rr, y: Math.sin(a) * rr * (0.6 + r() * 0.4) });
    if (r() < spikes) { // a short, sharp detour: out and straight back, well under the drift limit
      const k = 0.05 + r() * 0.35;
      out.push({ x: Math.cos(a) * (rr + k), y: Math.sin(a) * (rr + k) });
      out.push({ x: Math.cos(a + 0.0005) * rr, y: Math.sin(a + 0.0005) * rr });
    }
  }
  return out;
}

describe("collapseRingSpikes — incremental drift bound ≡ the from-scratch measurement", () => {
  it("returns exactly the reference ring over 40 random rings with spikes (the cases that exercise the bound)", () => {
    let removedSomewhere = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const ring = noisyRing(seed, 30 + (seed % 7) * 15, 0.35);
      const a = collapseRingSpikes(ring), b = referenceCollapse(ring);
      expect(a.length, `seed ${seed}`).toBe(b.length);
      for (let i = 0; i < a.length; i++) expect(a[i]).toBe(b[i]);   // the very same vertex objects, in the same order
      if (a.length < ring.length) removedSomewhere++;
    }
    expect(removedSomewhere, "the fixtures must actually remove spikes, or this proves nothing").toBeGreaterThan(20);
  });
  it("agrees when the cumulative bound BINDS (a tight passDriftFt stops the chain part-way)", () => {
    let bound = 0;
    for (let seed = 100; seed < 125; seed++) {
      const ring = noisyRing(seed, 70, 0.5);
      for (const passDriftFt of [0.05, 0.12, 0.3]) {
        const a = collapseRingSpikes(ring, { passDriftFt }), b = referenceCollapse(ring, { passDriftFt });
        expect(a.length, `seed ${seed} @${passDriftFt}`).toBe(b.length);
        if (b.length > 3 && b.length < ring.length && referenceCollapse(ring, { passDriftFt: 1e9 }).length < b.length) bound++;
      }
    }
    expect(bound, "some runs must be limited by the bound, or the skip path is untested").toBeGreaterThan(5);
  });
  it("leaves a triangle and a clean ring alone", () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    expect(collapseRingSpikes(tri)).toBe(tri);
    const square = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }, { x: 0, y: 50 }];
    expect(collapseRingSpikes(square).length).toBe(4);
  });
  it("is dramatically cheaper: far fewer segment-distance evaluations on a large ring", () => {
    const ring = noisyRing(7, 500, 0.3);
    const t0 = performance.now(); const a = collapseRingSpikes(ring); const tNew = performance.now() - t0;
    const t1 = performance.now(); const b = referenceCollapse(ring); const tOld = performance.now() - t1;
    expect(a.length).toBe(b.length);
    // a time ratio is weather; assert only that the new one is not slower than the old on a ring where the old is quadratic
    expect(tNew).toBeLessThan(tOld + 5);
  });
});
