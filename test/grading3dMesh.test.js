// NEW-1 (2026-11-11) — the owner-only 3D cut-and-fill viewer's PURE halves: the heightfield sampler, the mesh builders and the camera.
// Everything here is arrays and numbers (no three.js, no DOM): "trimmed at the property line", "side faces from the boundary", "cut is
// rust where existing is above" are claims about typed arrays.
//
// Fixture: a five-sided parcel that is deliberately NOT lattice-aligned (so the clipped boundary cells are real), on ground that falls
// 6 ft west→east, with one building pad at a fixed finish floor whose cut and fill halves straddle the ground, and a probe standing in
// for the engine's `grid.probe` (the real engine is exercised separately on the Chehaw ground at the bottom).
import { describe, it, expect } from "vitest";
import { sampleFieldSteps, insideMask, fieldAt, pointInRegions, regionRings } from "../src/workspaces/site-planner/lib/grading3d/field.js";
import { buildTopSurface, buildWalls, buildGhost, buildOutlineRibbons, buildSlice, buildingFootprints, baseElevation, defaultSliceLine, slideRange, lineIntervals, triangulate, shiftLine } from "../src/workspaces/site-planner/lib/grading3d/meshBuild.js";
import { frame, orbitBy, panBy, zoomBy, boundsOf, EL_MIN, EL_MAX, cameraPosition } from "../src/workspaces/site-planner/lib/grading3d/orbit.js";
import { groundRgb, ghostRgb, NEUTRAL_RGB } from "../src/workspaces/site-planner/lib/grading3d/colors.js";
import { CUT_RGB, FILL_RGB } from "../src/workspaces/site-planner/lib/gradingPaint.js";
import { unionRings, ringAreaSf } from "../src/workspaces/site-planner/lib/gradingLimit.js";

const run = (gen) => { let r = gen.next(); while (!r.done) r = gen.next(); return r.value; };

// ---- the fixture ----
const PARCEL = [{ x: 0, y: 0 }, { x: 640, y: 40 }, { x: 700, y: 420 }, { x: 330, y: 520 }, { x: -20, y: 380 }];
const exist = (pt) => 100 + 6 * (pt.x / 700);                                  // falls... rises 6 ft west→east
const PAD = [{ x: 150, y: 150 }, { x: 450, y: 150 }, { x: 450, y: 330 }, { x: 150, y: 330 }];   // exist spans 101.3 → 103.9 under it
const FFE = 102.6;                                                              // below the east half of the ground (CUT), above the west (FILL)
const inPad = (pt) => pt.x >= 150 && pt.x <= 450 && pt.y >= 150 && pt.y <= 330;
const grid = {
  owners: [{}], parcelRings: [PARCEL], limit: { mode: "layout" },
  probe: (pt) => (inPad(pt) ? { status: "value", ft: FFE, elId: "b1", cls: "buildingPad", wedge: false } : { status: "none", reason: "outside" }),
};
const regions = unionRings([PARCEL]);
const field = run(sampleFieldSteps({ grid, existAt: exist, regions, maxSamples: 20000 }));
const shoelace = (ring) => ringAreaSf(ring);

describe("the heightfield — the planner's own two answers on a lattice", () => {
  it("covers the property with a one-cell margin, and marks exactly the nodes inside it", () => {
    expect(field.nx * field.ny).toBeGreaterThan(5000);
    expect(field.x0).toBeLessThan(-20); expect(field.y0).toBeLessThan(0);
    let wrong = 0, n = 0;
    for (let j = 0; j < field.ny; j++) for (let i = 0; i < field.nx; i++) {
      const x = field.x0 + i * field.cell, y = field.y0 + j * field.cell;
      if (!!field.inside[j * field.nx + i] !== pointInRegions(regions, x, y)) wrong++;
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect(wrong).toBe(0);                                                          // the scanline fill equals the even-odd test, node for node
  });
  it("proposed = the finish floor on the pad, = the ground everywhere the engine leaves alone (the property past the grading)", () => {
    expect(fieldAt(field, "prop", 300, 240)).toBeCloseTo(FFE, 3);
    expect(fieldAt(field, "exist", 300, 240)).toBeCloseTo(exist({ x: 300, y: 240 }), 2);
    expect(fieldAt(field, "prop", 600, 300)).toBeCloseTo(exist({ x: 600, y: 300 }), 2);       // undisturbed: Prop = Exist
    expect(field.zLo).toBeLessThanOrEqual(100.1); expect(field.zHi).toBeGreaterThanOrEqual(105.5);
  });
  it("a node the engine and the DEM both know nothing about stays NaN — never an invented height", () => {
    const blind = run(sampleFieldSteps({ grid: null, existAt: (pt) => (pt.x > 600 ? NaN : 100), regions, maxSamples: 4000 }));
    const k = Math.floor((250 - blind.y0) / blind.cell) * blind.nx + Math.floor((650 - blind.x0) / blind.cell);
    expect(Number.isNaN(blind.exist[k])).toBe(true); expect(Number.isNaN(blind.prop[k])).toBe(true);
  });
  it("EMPTY IS NOT ZERO: with most of the property's ground unknown there is no model at all (never a floating 'proposed' in a void)", () => {
    expect(run(sampleFieldSteps({ grid, existAt: () => null, regions, maxSamples: 4000 }))).toBeNull();
    expect(run(sampleFieldSteps({ grid, existAt: (pt) => (pt.x > 300 ? NaN : 100), regions, maxSamples: 4000 }))).toBeNull();
  });
  it("insideMask honours holes (even-odd)", () => {
    const ring = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }], hole = [{ x: 40, y: 40 }, { x: 60, y: 40 }, { x: 60, y: 60 }, { x: 40, y: 60 }];
    const m = insideMask([ring, hole], 12, 12, -5, -5, 10);
    expect(m[1 * 12 + 1]).toBe(1);                      // (5,5) in the ring
    expect(m[5 * 12 + 5]).toBe(0);                      // (45,45) in the hole
  });
});

describe("the top surface — a solid, trimmed AT the property line", () => {
  const top = buildTopSurface(field, regions);
  const P = top.positions, I = top.indices;
  it("is built (tens of thousands of triangles) and every triangle faces up", () => {
    expect(top.triangleCount).toBeGreaterThan(5000);
    let down = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
      if (uz * vx - ux * vz < 0) down++;
    }
    expect(down).toBe(0);
    for (let v = 1; v < top.normals.length; v += 3) expect(top.normals[v]).toBeGreaterThan(0);
  });
  it("TRIMMED: every vertex is on or inside the property polygon (nothing pokes past the line)", () => {
    const dist = (x, y) => {
      let best = Infinity;
      for (let k = 0; k < PARCEL.length; k++) {
        const a = PARCEL[k], b = PARCEL[(k + 1) % PARCEL.length], dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)));
      }
      return best;
    };
    let outside = 0;
    for (let v = 0; v < P.length; v += 3) { const x = P[v], y = P[v + 2]; if (!pointInRegions(regions, x, y) && dist(x, y) > 0.03) outside++; }
    expect(outside).toBe(0);
  });
  it("COVERS the property: the triangles' plan area equals the parcel's (within a hair)", () => {
    let area = 0;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      area += Math.abs((P[b] - P[a]) * (P[c + 2] - P[a + 2]) - (P[c] - P[a]) * (P[b + 2] - P[a + 2])) / 2;
    }
    expect(Math.abs(area - shoelace(PARCEL)) / shoelace(PARCEL)).toBeLessThan(0.004);
  });
  it("colours by cut / fill with the 2D palette: rust where the pad cuts the high ground, blue where it fills the low, grey where nothing changes", () => {
    const colorNear = (x, y) => {
      let best = -1, bd = Infinity;
      for (let v = 0; v < P.length / 3; v++) { const d = Math.hypot(P[v * 3] - x, P[v * 3 + 2] - y); if (d < bd) { bd = d; best = v; } }
      return top.colors.slice(best * 3, best * 3 + 3).map((c) => c * 255);
    };
    const cut = colorNear(430, 240), fill = colorNear(165, 240), none = colorNear(560, 100);   // east of the pad the ground is untouched
    expect(cut[0]).toBeGreaterThan(cut[2] + 25);        // rust: red over blue
    expect(fill[2]).toBeGreaterThan(fill[0] + 25);      // blue
    expect(Math.abs(none[0] - NEUTRAL_RGB[0])).toBeLessThan(2); expect(Math.abs(none[2] - NEUTRAL_RGB[2])).toBeLessThan(2);
    // …and the palette functions ARE gradingPaint's constants (one source of ink)
    expect(groundRgb(-40)[0]).toBeCloseTo(CUT_RGB[0], 3); expect(groundRgb(40)[2]).toBeCloseTo(FILL_RGB[2], 3);
  });
});

describe("the side faces — vertical, down the property line, to one flat base", () => {
  const base = baseElevation(field.zLo, field.zHi);
  const walls = buildWalls(field, regions, base);
  it("reach the flat base and the top surface's boundary height, and stand only on the property line", () => {
    const P = walls.positions;
    let minY = Infinity, maxY = -Infinity, off = 0;
    const onRing = (x, y) => { for (let k = 0; k < PARCEL.length; k++) { const a = PARCEL[k], b = PARCEL[(k + 1) % PARCEL.length], dx = b.x - a.x, dy = b.y - a.y; const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy))); if (Math.hypot(x - (a.x + t * dx), y - (a.y + t * dy)) < 0.05) return true; } return false; };
    for (let v = 0; v < P.length; v += 3) { minY = Math.min(minY, P[v + 1]); maxY = Math.max(maxY, P[v + 1]); if (!onRing(P[v], P[v + 2])) off++; }
    expect(minY).toBeCloseTo(base, 3);
    expect(base).toBeLessThan(field.zLo - 5);
    expect(maxY).toBeLessThanOrEqual(field.zHi + 0.01); expect(maxY).toBeGreaterThan(field.zLo);
    expect(off).toBe(0);
  });
  it("every face is horizontal-facing and points OUT of the property", () => {
    const N = walls.normals, P = walls.positions;
    let bad = 0;
    for (let v = 0; v < N.length; v += 3) {
      if (Math.abs(N[v + 1]) > 1e-6) bad++;
      if (pointInRegions(regions, P[v] + N[v] * 2, P[v + 2] + N[v + 2] * 2)) bad++;
    }
    expect(bad).toBe(0);
  });
  it("is banded at absolute elevations (strata) — more than one shade of earth", () => {
    const shades = new Set(); for (let v = 0; v < walls.colors.length; v += 3) shades.add(walls.colors[v].toFixed(2));
    expect(shades.size).toBeGreaterThan(3);
  });
});

describe("the ghost (existing ground)", () => {
  const ghost = buildGhost(field);
  it("is wire segments inside the property only, lying ON the existing ground", () => {
    expect(ghost.segmentCount).toBeGreaterThan(100);
    let off = 0, wrong = 0;
    for (let v = 0; v < ghost.positions.length; v += 3) {
      const x = ghost.positions[v], y = ghost.positions[v + 2];
      if (!pointInRegions(regions, x, y)) off++;
      if (Math.abs(ghost.positions[v + 1] - exist({ x, y })) > 0.01) wrong++;
    }
    expect(off).toBe(0); expect(wrong).toBe(0);
  });
  it("is bright where existing is ABOVE the finished grade (cut) and dim where it is below (fill) or on grade", () => {
    const bright = ghostRgb(-8), dim = ghostRgb(5), same = ghostRgb(0);
    expect(bright[0]).toBeGreaterThan(dim[0] + 60);
    expect(same[0]).toBe(dim[0]);
    // on the fixture: the cut half (east of the pad) carries bright vertex colours, the fill half dim ones
    let nCut = 0, nFill = 0;
    for (let v = 0; v < ghost.positions.length / 3; v++) {
      const x = ghost.positions[v * 3], y = ghost.positions[v * 3 + 2], r = ghost.colors[v * 3] * 255;
      if (inPad({ x, y }) && x > 440) { if (r > 150) nCut++; }
      if (inPad({ x, y }) && x < 160) { if (r < 145) nFill++; }
    }
    expect(nCut).toBeGreaterThan(0); expect(nFill).toBeGreaterThan(0);
  });
});

describe("the building outline — one footprint per building, dashed, flat on the pad", () => {
  const host = { id: "b1", type: "building", ring: PAD };
  const bump = { id: "b1-bump", type: "building", hostId: "b1", ring: [{ x: 450, y: 200 }, { x: 480, y: 200 }, { x: 480, y: 250 }, { x: 450, y: 250 }] };
  const other = { id: "b2", type: "building", ring: [{ x: 500, y: 60 }, { x: 560, y: 60 }, { x: 560, y: 100 }, { x: 500, y: 100 }] };
  const fps = buildingFootprints([host, bump, other, { id: "x", type: "paving", ring: PAD }]);
  it("a host and its bump-outs are ONE outline; paving is not a building; largest first", () => {
    expect(fps.length).toBe(2);
    expect(fps[0].id).toBe("b1"); expect(fps[0].regions.length).toBe(1);
    expect(ringAreaSf(fps[0].regions[0].outer)).toBeCloseTo(300 * 180 + 30 * 50, 0);
  });
  it("is a dashed ribbon on the proposed surface (the pad is flat at the finish floor), with gaps", () => {
    const rib = buildOutlineRibbons(field, [fps[0].regions], { widthFt: 3, liftFt: 0.5 });
    expect(rib.triangleCount).toBeGreaterThan(20);
    const ys = new Set(); for (let v = 1; v < rib.positions.length; v += 3) ys.add(rib.positions[v].toFixed(1));
    expect([...ys].some((y) => Math.abs(+y - (FFE + 0.5)) < 0.15)).toBe(true);
    // dashed: the inked length is well under the perimeter
    let inked = 0; for (let t = 0; t < rib.indices.length; t += 3) { const a = rib.indices[t] * 3, b = rib.indices[t + 1] * 3, c = rib.indices[t + 2] * 3; inked += Math.abs((rib.positions[b] - rib.positions[a]) * (rib.positions[c + 2] - rib.positions[a + 2]) - (rib.positions[c] - rib.positions[a]) * (rib.positions[b + 2] - rib.positions[a + 2])) / 2; }
    const perimeter = 2 * (300 + 180) + 2 * 50;
    expect(inked / 3).toBeLessThan(perimeter * 0.8); expect(inked / 3).toBeGreaterThan(perimeter * 0.3);
  });
});

describe("the slice — a vertical section, cut and fill wedges at known points", () => {
  // a section across the PAD, east-west: flat finish floor 102.6; the ground crosses it at x where 100 + 6x/700 = 102.6 → x ≈ 303.3
  const line = { px: 0, py: 240, dx: 1, dy: 0, nx: 0, ny: 1 };
  const base = baseElevation(field.zLo, field.zHi);
  const s = buildSlice(field, regions, line, base);
  const faceAt = (x, y) => {                                   // the colour of the face triangle covering plan x and elevation y
    const P = s.faces.positions, I = s.faces.indices, C = s.faces.colors;
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t], I[t + 1], I[t + 2]];
      const xs = ids.map((i) => P[i * 3]), ys = ids.map((i) => P[i * 3 + 1]);
      const sgn = (ax, ay, bx, by, cx, cy) => (ax - cx) * (by - cy) - (bx - cx) * (ay - cy);
      const d1 = sgn(x, y, xs[0], ys[0], xs[1], ys[1]), d2 = sgn(x, y, xs[1], ys[1], xs[2], ys[2]), d3 = sgn(x, y, xs[2], ys[2], xs[0], ys[0]);
      if (!((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return ids.slice(0, 1).map((i) => [C[i * 3] * 255, C[i * 3 + 1] * 255, C[i * 3 + 2] * 255])[0];
    }
    return null;
  };
  it("lies in the property only: its samples run from the line's entry to its exit", () => {
    expect(s.intervals.length).toBe(1);
    expect(s.samples).toBeGreaterThan(20);
    for (const [a, b] of s.intervals) { expect(pointInRegions(regions, a + 1, 240)).toBe(true); expect(pointInRegions(regions, b - 1, 240)).toBe(true); }
  });
  it("a BLUE wedge where the finished grade is above today's ground (west of the crossing), a RUST wedge where it is below (east)", () => {
    const fillAt = faceAt(250, (FFE + exist({ x: 250, y: 240 })) / 2);           // between the ground (101.9) and the pad (102.6) at x=250
    const cutAt = faceAt(400, (FFE + exist({ x: 400, y: 240 })) / 2);            // between the pad (102.6) and the ground (103.4) at x=400
    expect(fillAt).not.toBeNull(); expect(cutAt).not.toBeNull();
    expect(fillAt[2]).toBeGreaterThan(fillAt[0] + 50);
    expect(cutAt[0]).toBeGreaterThan(cutAt[2] + 50);
  });
  it("earth-brown below both grades, all the way down to the base", () => {
    const e = faceAt(250, base + 3);
    expect(e).not.toBeNull();
    expect(e[0]).toBeGreaterThan(e[2]); expect(Math.abs(e[0] - CUT_RGB[0])).toBeGreaterThan(20);   // brown, not the rust wedge
    expect(Math.min(...Array.from(s.faces.positions).filter((_, k) => k % 3 === 1))).toBeCloseTo(base, 3);
  });
  it("the finished grade is a SOLID line and today's ground a DASHED one (fewer inked segments), strata below", () => {
    const n = (a) => a.positions.length / 6;
    expect(n(s.proposed)).toBeGreaterThan(20);
    expect(n(s.existing)).toBeLessThan(n(s.proposed) * 0.85); expect(n(s.existing)).toBeGreaterThan(5);
    expect(n(s.strata)).toBeGreaterThan(5);
    for (let v = 1; v < s.proposed.positions.length; v += 3) { const x = s.proposed.positions[v - 1]; if (x > 170 && x < 430) expect(s.proposed.positions[v]).toBeCloseTo(FFE, 3); }
  });
  it("read EXACTLY from the planner's samplers it is crisp at the pad's edge (the lattice blurs it over a cell)", () => {
    const exact = buildSlice(field, regions, line, base, { sample: (x, y) => ({ p: inPad({ x, y }) ? FFE : exist({ x, y }), e: exist({ x, y }) }) });
    const at = (arr, x0) => { let best = null, bd = Infinity; for (let v = 0; v < arr.length; v += 6) { const d = Math.abs(arr[v] - x0); if (d < bd) { bd = d; best = arr[v + 1]; } } return best; };
    expect(at(exact.proposed.positions, 160)).toBeCloseTo(FFE, 3);
    expect(at(exact.proposed.positions, 140)).toBeCloseTo(exist({ x: 140, y: 240 }), 1);   // the next samples either side of x=150 are the ground and the pad
    expect(exact.samples).toBeGreaterThan(s.samples);
  });
  it("the default section runs through the middle of the largest building across its short axis; the handle slides it along the length", () => {
    const fps = buildingFootprints([{ id: "b1", type: "building", ring: PAD }]);
    const ln = defaultSliceLine(fps, field.bounds);
    expect(ln.px).toBeCloseTo(300, 0); expect(ln.py).toBeCloseTo(240, 0);
    expect(Math.abs(ln.dx)).toBeLessThan(1e-9); expect(Math.abs(ln.dy)).toBeCloseTo(1, 6);      // the building is longer in x, so the cut runs N-S
    const r = slideRange(ln, regions);
    expect(r.lo).toBeLessThan(-250); expect(r.hi).toBeGreaterThan(300);
    const moved = shiftLine(ln, 100);
    expect(moved.px).toBeCloseTo(400, 0);
    expect(lineIntervals(moved, regions).length).toBe(1);
  });
  it("a line that misses the property builds nothing", () => {
    const miss = buildSlice(field, regions, { px: 0, py: 9000, dx: 1, dy: 0, nx: 0, ny: 1 }, base);
    expect(miss.intervals.length).toBe(0); expect(miss.faces.triangleCount).toBe(0);
  });
});

describe("triangulate", () => {
  it("covers a concave polygon exactly (an L)", () => {
    const L = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 4 }, { x: 4, y: 4 }, { x: 4, y: 10 }, { x: 0, y: 10 }];
    const tris = triangulate(L);
    let a = 0; for (const [p, q, r] of tris) a += Math.abs((L[q].x - L[p].x) * (L[r].y - L[p].y) - (L[r].x - L[p].x) * (L[q].y - L[p].y)) / 2;
    expect(a).toBeCloseTo(64, 6);
  });
});

describe("the camera — orbit, pan, zoom, and the clamps (never under the model, never lost)", () => {
  const b = boundsOf({ minX: 0, maxX: 700, minY: 98, maxY: 108, minZ: 0, maxZ: 520 }, 3);
  const s0 = frame(b, 1.6);
  it("frames the whole model", () => {
    expect(s0.dist).toBeGreaterThan(b.radius); expect(s0.tx).toBeCloseTo(350, 3);
    const cam = cameraPosition(s0); expect(cam.y).toBeGreaterThan(s0.ty); expect(cam.z).toBeGreaterThan(s0.tz);   // starts south of the site, above it
  });
  it("orbit can't flip under the model nor past straight down, however hard it is dragged", () => {
    expect(orbitBy(s0, 0, 100000, b).el).toBeLessThanOrEqual(EL_MAX);
    expect(orbitBy(s0, 0, -100000, b).el).toBeGreaterThanOrEqual(EL_MIN);
    expect(cameraPosition(orbitBy(s0, 0, -100000, b)).y).toBeGreaterThan(s0.ty);
    expect(orbitBy(s0, 200, 0, b).az).not.toBe(s0.az);
  });
  it("zoom is clamped to a close-up and a few site-widths", () => {
    expect(zoomBy(s0, -1e7, b).dist).toBeCloseTo(s0.distMin, 6);
    expect(zoomBy(s0, 1e7, b).dist).toBeCloseTo(s0.distMax, 6);
  });
  it("pan can't carry the model off the screen (the target stays near the model's box)", () => {
    let s = s0; for (let i = 0; i < 400; i++) s = panBy(s, -900, 900, 800, b);
    expect(s.tx).toBeGreaterThanOrEqual(b.minX - b.radius * 0.35 - 1e-6); expect(s.tx).toBeLessThanOrEqual(b.maxX + b.radius * 0.35 + 1e-6);
    expect(s.tz).toBeGreaterThanOrEqual(b.minZ - b.radius * 0.35 - 1e-6); expect(s.tz).toBeLessThanOrEqual(b.maxZ + b.radius * 0.35 + 1e-6);
  });
  it("dragging right pans the ground right (the target moves left)", () => {
    const s = panBy({ ...s0, az: 0 }, 50, 0, 800, b);
    expect(s.tx).toBeLessThan(s0.tx);
  });
});

describe("regionRings", () => { it("lists every outer ring and hole", () => { expect(regionRings([{ outer: [1], holes: [[2], [3]] }, { outer: [4], holes: [] }]).length).toBe(4); }); });
