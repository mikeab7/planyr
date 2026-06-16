import { describe, it, expect } from "vitest";
import {
  imagePointToWorld, scaleOverlayAbout, similarityTransform, alignOverlaySimilarity,
  solveSimilarityLSQ, applySimilarityToOverlay,
} from "../src/workspaces/site-planner/lib/overlayAlign.js";

const ov = (over = {}) => ({ x: 100, y: 50, imgW: 800, imgH: 600, ftPerPx: 0.5, rotation: 0, ...over });
const near = (a, b, p = 5) => { expect(a.x).toBeCloseTo(b.x, p); expect(a.y).toBeCloseTo(b.y, p); };

describe("overlay align — similarityTransform (B73)", () => {
  it("maps p1->q1 and p2->q2 with the right scale + rotation", () => {
    const T = similarityTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 15 });
    near(T.apply({ x: 0, y: 0 }), { x: 5, y: 5 });
    near(T.apply({ x: 10, y: 0 }), { x: 5, y: 15 });
    expect(T.scale).toBeCloseTo(1, 9);            // |vQ| = |vP| = 10
    expect(Math.abs(T.rotDeg)).toBeCloseTo(90, 5);
  });
  it("captures a pure scale change", () => {
    const T = similarityTransform({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 0 }, { x: 30, y: 0 });
    expect(T.scale).toBeCloseTo(3, 9);
    expect(T.rotDeg).toBeCloseTo(0, 9);
  });
  it("returns null for coincident drawing points", () => {
    expect(similarityTransform({ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 0 }, { x: 2, y: 2 })).toBe(null);
  });
});

describe("overlay align — scaleOverlayAbout / trace (B73)", () => {
  it("keeps the clicked point fixed and scales the sheet by k", () => {
    const o = ov();
    const p0 = imagePointToWorld(o, 200, 150);     // a drawing point, in world feet
    const o2 = { ...o, ...scaleOverlayAbout(o, p0, 2) };
    near(imagePointToWorld(o2, 200, 150), p0);     // pinned
    expect(o2.ftPerPx).toBeCloseTo(1.0, 9);        // 0.5 * 2
    const q = imagePointToWorld(o, 600, 450), q2 = imagePointToWorld(o2, 600, 450);
    expect(Math.hypot(q2.x - p0.x, q2.y - p0.y)).toBeCloseTo(2 * Math.hypot(q.x - p0.x, q.y - p0.y), 5);
  });
  it("rejects a non-positive factor", () => {
    expect(scaleOverlayAbout(ov(), { x: 0, y: 0 }, 0)).toBe(null);
  });
});

describe("overlay align — alignOverlaySimilarity 2-point (B73)", () => {
  it("lands both drawing points on their map targets (even when rotated)", () => {
    const o = ov({ rotation: 20 });
    const p1 = imagePointToWorld(o, 100, 120), p2 = imagePointToWorld(o, 700, 500);
    const q1 = { x: 1000, y: 2000 }, q2 = { x: 1600, y: 2200 };
    const o2 = { ...o, ...alignOverlaySimilarity(o, p1, p2, q1, q2) };
    near(imagePointToWorld(o2, 100, 120), q1);
    near(imagePointToWorld(o2, 700, 500), q2);
  });
  it("scales ftPerPx and composes rotation", () => {
    const o = ov();
    const p1 = imagePointToWorld(o, 0, 0), p2 = imagePointToWorld(o, 100, 0);
    const q1 = { x: 0, y: 0 }, q2 = { x: 0, y: 25 };  // 25 ft (vs 50 ft drawing) & +90° → scale 0.5
    const patch = alignOverlaySimilarity(o, p1, p2, q1, q2);
    expect(patch.ftPerPx).toBeCloseTo(o.ftPerPx * 0.5, 6);
    expect(patch.rotation).toBeCloseTo(90, 5);
  });
});

describe("overlay align — solveSimilarityLSQ N-point fit + residual (B73)", () => {
  const pair = (f, t) => ({ from: f, to: t });
  it("matches the exact 2-point similarity (≈0 residual)", () => {
    const T = solveSimilarityLSQ([pair({ x: 0, y: 0 }, { x: 5, y: 5 }), pair({ x: 10, y: 0 }, { x: 5, y: 15 })]);
    near(T.apply({ x: 0, y: 0 }), { x: 5, y: 5 });
    near(T.apply({ x: 10, y: 0 }), { x: 5, y: 15 });
    expect(T.residual).toBeCloseTo(0, 6);
    expect(T.scale).toBeCloseTo(1, 6);
  });
  it("recovers a known similarity from 4 consistent points (≈0 residual)", () => {
    const truth = (p) => ({ x: 100 + 2 * (p.x * Math.cos(0.5) - p.y * Math.sin(0.5)), y: 50 + 2 * (p.x * Math.sin(0.5) + p.y * Math.cos(0.5)) }); // scale 2, +0.5 rad
    const src = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 8 }, { x: 0, y: 8 }];
    const T = solveSimilarityLSQ(src.map((p) => pair(p, truth(p))));
    expect(T.scale).toBeCloseTo(2, 5);
    expect(T.rotDeg).toBeCloseTo((0.5 * 180) / Math.PI, 4);
    expect(T.residual).toBeCloseTo(0, 5);
    src.forEach((p) => near(T.apply(p), truth(p)));
  });
  it("reports a non-zero residual when a point is perturbed (no exact rigid fit)", () => {
    const T = solveSimilarityLSQ([
      pair({ x: 0, y: 0 }, { x: 0, y: 0 }), pair({ x: 10, y: 0 }, { x: 10, y: 0 }),
      pair({ x: 5, y: 5 }, { x: 5, y: 9 }), // off the rigid fit
    ]);
    expect(T.residual).toBeGreaterThan(0.5);
  });
  it("returns null for fewer than 2 pairs or coincident sources", () => {
    expect(solveSimilarityLSQ([pair({ x: 1, y: 1 }, { x: 0, y: 0 })])).toBe(null);
    expect(solveSimilarityLSQ([pair({ x: 2, y: 2 }, { x: 0, y: 0 }), pair({ x: 2, y: 2 }, { x: 9, y: 9 })])).toBe(null);
  });
  it("applySimilarityToOverlay lands all points via the fit (rotated overlay, 3 pts)", () => {
    const o = { x: 100, y: 50, imgW: 800, imgH: 600, ftPerPx: 0.5, rotation: 15 };
    const ipts = [[120, 90], [640, 110], [400, 520]];
    const from = ipts.map(([ix, iy]) => imagePointToWorld(o, ix, iy));
    const to = [{ x: 900, y: 1800 }, { x: 1500, y: 1850 }, { x: 1180, y: 2300 }];
    const T = solveSimilarityLSQ(from.map((f, i) => pair(f, to[i])));
    const o2 = { ...o, ...applySimilarityToOverlay(o, T) };
    // each drawing point lands on its fitted target (residual is tiny here)
    ipts.forEach(([ix, iy], i) => near(imagePointToWorld(o2, ix, iy), T.apply(from[i]), 4));
  });
});
