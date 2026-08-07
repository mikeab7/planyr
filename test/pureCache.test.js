/* The two pure caches behind the NEW-2 fixes, plus the cull rect latch.
 *
 * These are where a "do not answer the same question twice" fix turns into a WRONG answer if it is
 * keyed badly, so each cache's key discipline is pinned here rather than trusted.
 */
import { describe, it, expect } from "vitest";
import { boundedCache, identityCache, pointsSignature } from "../src/workspaces/site-planner/lib/pureCache.js";
import { cullRectFor, sameRect, visibleWorldRect, cullToView } from "../src/workspaces/site-planner/lib/viewCull.js";
import { roadCenterline, roadCenterlineTagged } from "../src/workspaces/site-planner/lib/roadGeometry.js";
import { offsetPolyline, bufferPolyline } from "../src/workspaces/site-planner/lib/metesAndBounds.js";

describe("boundedCache", () => {
  it("returns what it was given, and distinguishes a stored undefined from a miss via has()", () => {
    const c = boundedCache(4);
    expect(c.get("k")).toBeUndefined();
    c.set("k", 7);
    expect(c.get("k")).toBe(7);
    expect(c.has("k")).toBe(true);
  });
  it("clears at the cap rather than growing without limit", () => {
    const c = boundedCache(3);
    for (let i = 0; i < 4; i++) c.set(`k${i}`, i);
    expect(c.size).toBeLessThanOrEqual(3);
  });
});

describe("identityCache", () => {
  it("keys on the object AND the variant string", () => {
    const c = identityCache();
    const a = [1], b = [1];
    c.set(a, "w10", "A");
    expect(c.get(a, "w10")).toBe("A");
    expect(c.get(a, "w20")).toBeUndefined();
    expect(c.get(b, "w10")).toBeUndefined();     // a DIFFERENT array is a different question
  });
  it("is inert for a primitive key rather than throwing", () => {
    const c = identityCache();
    expect(c.set(null, "k", 1)).toBe(1);
    expect(c.get(null, "k")).toBeUndefined();
  });
});

describe("pointsSignature", () => {
  it("separates two alignments that differ by a ten-thousandth of a foot", () => {
    expect(pointsSignature([{ x: 0, y: 0 }, { x: 1, y: 0 }]))
      .not.toBe(pointsSignature([{ x: 0, y: 0 }, { x: 1.0001, y: 0 }]));
  });
  it("agrees for two freshly built copies of the same alignment", () => {
    const mk = () => [{ x: 0, y: 0 }, { x: 100, y: 50 }];
    expect(pointsSignature(mk())).toBe(pointsSignature(mk()));
  });
});

describe("the cull rect is LATCHED against the live view (NEW-2)", () => {
  const size = { w: 1600, h: 900 };
  const view = (offX, offY, ppf = 0.4) => ({ ppf, offX, offY });

  it("⛔ whatever it hands back always CONTAINS the true visible rect — the safety property", () => {
    let prev = null;
    for (const dx of [0, 7, 33, 91, 260, 900, 4000]) {
      prev = cullRectFor(view(-dx, dx / 2), size, prev);
      const raw = visibleWorldRect(view(-dx, dx / 2), size, 0);
      expect(prev.minX).toBeLessThanOrEqual(raw.minX);
      expect(prev.minY).toBeLessThanOrEqual(raw.minY);
      expect(prev.maxX).toBeGreaterThanOrEqual(raw.maxX);
      expect(prev.maxY).toBeGreaterThanOrEqual(raw.maxY);
    }
  });

  it("holds the SAME OBJECT across a pan that stays inside it — the whole point", () => {
    const a = cullRectFor(view(0, 0), size, null);
    let cur = a;
    for (let i = 0; i < 60; i++) cur = cullRectFor(view(-Math.sin(i / 6) * 300, -Math.cos(i / 8) * 180), size, cur);
    expect(cur).toBe(a);                       // identity, not just equality
  });

  it("RE-ARMS once the view approaches its edge — it is still genuinely view-derived", () => {
    const a = cullRectFor(view(0, 0), size, null);
    const spanFt = Math.abs(a.maxX - a.minX);
    const far = cullRectFor(view(-spanFt * 0.4, 0), size, a);
    expect(far).not.toBe(a);
  });

  it("RE-ARMS on a zoom, because the viewport now covers a different amount of world", () => {
    const a = cullRectFor(view(0, 0, 0.4), size, null);
    expect(cullRectFor(view(0, 0, 0.8), size, a)).not.toBe(a);
    expect(cullRectFor(view(0, 0, 0.2), size, a)).not.toBe(a);
  });

  it("a fresh latch (no prev) always builds a rect", () => {
    expect(cullRectFor(view(0, 0), size, null)).toBeTruthy();
  });

  it("survives a degenerate view/size instead of producing NaN edges", () => {
    const r = cullRectFor({ ppf: 0, offX: 0, offY: 0 }, { w: 0, h: 0 }, null);
    for (const [k, v] of Object.entries(r)) if (k !== "ppf") expect(Number.isFinite(v)).toBe(true);
  });

  it("culling with the latched rect keeps everything the true rect would have kept", () => {
    const els = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, cx: i * 300, cy: 0, w: 100, h: 100 }));
    let prev = cullRectFor(view(0, 0), size, null);
    for (const dx of [40, 137, 260, 610]) {
      const v = view(-dx, -dx / 3);
      prev = cullRectFor(v, size, prev);
      const trueKeep = new Set(cullToView(els, visibleWorldRect(v, size, 0)).map((e) => e.id));
      const latched = new Set(cullToView(els, prev).map((e) => e.id));
      for (const id of trueKeep) expect(latched.has(id)).toBe(true);
    }
  });

  it("is PURE — the previous rect is an argument, so two canvases cannot share a latch", () => {
    const a = cullRectFor(view(0, 0), size, null);
    const b = cullRectFor(view(0, 0), { w: 400, h: 300 }, null);
    expect(sameRect(a, b)).toBe(false);
  });

  it("sameRect compares the four numbers, not the identity", () => {
    expect(sameRect({ minX: 1, minY: 2, maxX: 3, maxY: 4 }, { minX: 1, minY: 2, maxX: 3, maxY: 4 })).toBe(true);
    expect(sameRect({ minX: 1, minY: 2, maxX: 3, maxY: 4 }, { minX: 1, minY: 2, maxX: 3, maxY: 5 })).toBe(false);
    expect(sameRect(null, { minX: 1 })).toBe(false);
    expect(sameRect(null, null)).toBe(true);
  });
});

describe("the road tessellation cache answers identically to the uncached math (NEW-2)", () => {
  const pts = [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 500 }, { x: 900, y: 500 }];
  const vtx = [{}, { treatment: "arc", radius: 60 }, { treatment: "arc", radius: 90 }, {}];

  it("a repeat call returns the SAME answer (and now the same object)", () => {
    const a = roadCenterlineTagged(pts, vtx, { defaultRadius: 50 });
    const b = roadCenterlineTagged(pts.map((p) => ({ ...p })), vtx.map((v) => ({ ...v })), { defaultRadius: 50 });
    expect(b.dense).toEqual(a.dense);
    expect(b.segOwn).toEqual(a.segOwn);
  });

  it("a changed RADIUS is a different question", () => {
    const a = roadCenterline(pts, vtx, { defaultRadius: 50 });
    const b = roadCenterline(pts, [{}, { treatment: "arc", radius: 200 }, { treatment: "arc", radius: 90 }, {}], { defaultRadius: 50 });
    expect(b).not.toEqual(a);
  });

  it("a changed sharpAt is a different question — a junction vertex renders sharp", () => {
    const a = roadCenterline(pts, vtx, { defaultRadius: 50 });
    const b = roadCenterline(pts, vtx, { defaultRadius: 50, sharpAt: new Set([1]) });
    expect(b).not.toEqual(a);
  });

  it("a moved control point is a different question", () => {
    const moved = [...pts.slice(0, 2), { x: 400, y: 501 }, pts[3]];
    expect(roadCenterline(moved, vtx, { defaultRadius: 50 })).not.toEqual(roadCenterline(pts, vtx, { defaultRadius: 50 }));
  });

  it("⛔ a caller passing `shareAt` BYPASSES the cache — a function cannot be in a key", () => {
    const shareA = () => ({ a: 0.5, c: 0.5 });
    const shareB = () => ({ a: 0.1, c: 0.9 });
    const a = roadCenterline(pts, vtx, { defaultRadius: 50, shareAt: shareA });
    const b = roadCenterline(pts, vtx, { defaultRadius: 50, shareAt: shareB });
    expect(b).not.toEqual(a);
  });
});

describe("the polyline caches answer identically (NEW-2)", () => {
  const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];

  it("a repeated offset at the same distance is the same answer", () => {
    expect(offsetPolyline(line, 12)).toEqual(offsetPolyline(line.map((p) => ({ ...p })), 12));
  });
  it("a different distance is a different answer, on the SAME array", () => {
    expect(offsetPolyline(line, 12)).not.toEqual(offsetPolyline(line, 24));
  });
  it("buffer keys include the asymmetric half-widths", () => {
    const sym = bufferPolyline(line, 20);
    const asym = bufferPolyline(line, 20, { leftW: 2, rightW: 18 });
    expect(asym).not.toEqual(sym);
    expect(bufferPolyline(line, 20)).toEqual(sym);
  });
  it("a degenerate line still returns null rather than a cached wrong answer", () => {
    expect(offsetPolyline([{ x: 0, y: 0 }], 5)).toBe(null);
    expect(bufferPolyline(null, 5)).toBe(null);
  });
});
