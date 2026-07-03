// B633 — the pond auto-size solvers, exercised against the REAL detentionStorage
// (end-to-end pure: bisection over actual clipper stage areas).
import { describe, it, expect } from "vitest";
import { detentionStorage } from "../src/workspaces/site-planner/lib/pondGeom.js";
import { solvePondExpansion, solvePondDepth } from "../src/workspaces/site-planner/lib/detentionRules.js";

const rect = (w, h) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: h },
  { x: 0, y: h },
];
// "Push the banks out N ft" on an axis-aligned rect = grow each side by N.
const volumeAtFor = (w, h, depth, fb, slope) => (n) => detentionStorage(rect(w + 2 * n, h + 2 * n), depth, fb, slope);

describe("solvePondExpansion", () => {
  const base = detentionStorage(rect(300, 300), 8, 1, 3); // 522,774 cf

  it("converges on an integer offset that meets 1.5× the current volume", () => {
    const target = base.vol * 1.5;
    const s = solvePondExpansion({ requiredCf: target, volumeAt: volumeAtFor(300, 300, 8, 1, 3) });
    expect(s.ok).toBe(true);
    expect(Number.isInteger(s.expandFt)).toBe(true);
    expect(s.expandFt).toBeGreaterThan(0);
    expect(s.achievedCf).toBeGreaterThanOrEqual(target - 436); // met within tolerance
    // …and the PREVIOUS foot would not have been enough (the solve is tight, rounded UP).
    const prev = volumeAtFor(300, 300, 8, 1, 3)(s.expandFt - 1);
    expect(prev.vol).toBeLessThan(target);
  });

  it("already big enough → 'already-sufficient', no geometry churn", () => {
    const s = solvePondExpansion({ requiredCf: base.vol * 0.5, volumeAt: volumeAtFor(300, 300, 8, 1, 3) });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("already-sufficient");
  });

  it("geometry failing mid-search (self-intersecting grow) → explicit 'geometry-failed' at the offset", () => {
    const inner = volumeAtFor(300, 300, 8, 1, 3);
    const flaky = (n) => (n >= 40 ? null : inner(n));
    const s = solvePondExpansion({ requiredCf: base.vol * 10, volumeAt: flaky });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("geometry-failed");
    expect(s.atFt).toBeGreaterThanOrEqual(40);
  });

  it("an unreachable target inside the search cap → 'no-bracket' with the best achieved", () => {
    const s = solvePondExpansion({ requiredCf: 1e9, volumeAt: volumeAtFor(300, 300, 8, 1, 3), maxExpandFt: 100 });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("no-bracket");
    expect(s.bestCf).toBeGreaterThan(base.vol);
  });

  it("Regime-B dead storage strictly enlarges the solve (usable = required + dead)", () => {
    const target = base.vol * 1.3;
    const plain = solvePondExpansion({ requiredCf: target, volumeAt: volumeAtFor(300, 300, 8, 1, 3) });
    const withDead = solvePondExpansion({ requiredCf: target, deadStorageCf: 100_000, volumeAt: volumeAtFor(300, 300, 8, 1, 3) });
    expect(plain.ok && withDead.ok).toBe(true);
    expect(withDead.expandFt).toBeGreaterThan(plain.expandFt);
  });
});

describe("solvePondDepth — the 'or dig N ft deeper' lever", () => {
  it("converges on the square when the footprint can grade deep enough", () => {
    const v = (d) => detentionStorage(rect(300, 300), d, 1, 3);
    const target = 700_000; // above the 8-ft volume (522,774), well below the 50-ft cap
    const s = solvePondDepth({ requiredCf: target, volumeAtDepth: v, startDepthFt: 8 });
    expect(s.ok).toBe(true);
    expect(s.depthFt).toBeGreaterThan(8);
    expect(s.achievedCf).toBeGreaterThanOrEqual(target - 436);
  });

  it("slopes meeting before enough storage exists → explicit 'slopes-collapse' with the usable depth", () => {
    // A 60-ft sliver at 3:1 pinches at 10 ft — its volume plateaus ~140k cf.
    const v = (d) => detentionStorage(rect(60, 600), d, 1, 3);
    const s = solvePondDepth({ requiredCf: 200_000, volumeAtDepth: v, startDepthFt: 8 });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("slopes-collapse");
    expect(s.maxUsableDepthFt).toBeCloseTo(10, 0);
    expect(s.bestCf).toBeLessThan(200_000);
  });

  it("already sufficient at the current depth → says so", () => {
    const v = (d) => detentionStorage(rect(300, 300), d, 1, 3);
    const s = solvePondDepth({ requiredCf: 100_000, volumeAtDepth: v, startDepthFt: 8 });
    expect(s.ok).toBe(false);
    expect(s.reason).toBe("already-sufficient");
  });
});
