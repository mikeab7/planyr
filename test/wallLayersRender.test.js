/* NEW-1 (wall layers) — what a wall's strip lists, the plan must draw.
 *
 * Owner report: single-load building, docks E, rear W set to Walk 5′ + Buffer 10′, ends Walk 5′ + Parking. The panel
 * listed every layer; the canvas drew no sidewalk on the rear. Cause: a buffer added to a non-dock wall is a FLUSH
 * layer (it sits beyond the walk), but both relayout paths treated any `landscape` without `noFit` as a wall STRIP
 * and snapped it flush to the wall — on top of the sidewalk, which (newest-on-top stacking) then painted over it.
 *
 * Judged on geometry: for every wall × rotation × layer combination, no two layers of one wall may overlap and each
 * must start where the one inboard of it ends. The "saved" shape is exactly what the old code wrote: the buffer flush
 * against the wall, overlapping the walk.
 */
import { describe, it, expect } from "vitest";
import { normalizeBondedChildren } from "../src/workspaces/site-planner/lib/siteModel.js";
import { wallStripBox, wallKidBox, hostAxisExtents, localToWorld, isFlushWallLayer } from "../src/workspaces/site-planner/lib/dogEar.js";
import { createIdMinter } from "../src/shared/ids.js";

const SIDE_N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const SIDES = ["left", "right", "top", "bottom"];
const ROTS = [0, 45, 90, 315];
const W = 1200, H = 400;
const host = (rot) => ({ id: "b1", type: "building", cx: 1000, cy: 800, w: W, h: H, rot, dock: "single" });

// A kid on `side` whose thickness starts `gap` ft from the wall, `depth` deep (the geometry the app writes).
function kid(b, side, type, depth, gap, extra = {}) {
  const box = wallKidBox(b, side, { depth, gap, run: side === "left" || side === "right" ? H : W, alongShift: 0 });
  const c = localToWorld(b, box.lx, box.ly);
  return { id: `${type}-${side}-${gap}`, type, cx: c.x, cy: c.y, w: box.dimBX, h: box.dimBY, rot: b.rot, attachedTo: b.id, ...extra };
}
// [inner, outer] distance of a kid from the wall face, measured along the wall's outward normal.
function span(b, side, k) {
  const [nx, ny] = SIDE_N[side];
  const isVert = side === "left" || side === "right";
  const a = (Math.cos((b.rot * Math.PI) / 180)), s = Math.sin((b.rot * Math.PI) / 180);
  const dx = k.cx - b.cx, dy = k.cy - b.cy;
  const lx = dx * a + dy * s, ly = -dx * s + dy * a;                     // host-local
  const perp = (isVert ? nx : ny) * (isVert ? lx : ly) - (isVert ? b.w : b.h) / 2;
  const { dimBX, dimBY } = hostAxisExtents(b, k);
  const d = isVert ? dimBX : dimBY;
  return [perp - d / 2, perp + d / 2];
}
const heal = (els) => normalizeBondedChildren(JSON.parse(JSON.stringify(els)), null, { mintId: createIdMinter("zztest") });
const get = (list, id) => list.find((e) => e.id === id);

describe("a buffer added to a wall strip is a flush layer, not a wall strip", () => {
  it("the predicate: a landscape with no named wall and no stack bond", () => {
    expect(isFlushWallLayer({ type: "landscape" })).toBe(true);
    expect(isFlushWallLayer({ type: "landscape", sidewalkSide: "left" })).toBe(false);   // legacy named strip
    expect(isFlushWallLayer({ type: "landscape", noFit: true })).toBe(false);            // dock-chain member
    expect(isFlushWallLayer({ type: "sidewalk" })).toBe(false);
  });

  for (const rot of ROTS) for (const side of SIDES) {
    it(`Walk 5′ + Buffer 10′ on ${side}, rot ${rot}: saved overlapping, the heal puts the buffer BEYOND the walk`, () => {
      const b = host(rot);
      const walk = kid(b, side, "sidewalk", 5, 0, { sidewalkSide: side });
      const buf = kid(b, side, "landscape", 10, 0, { stackSide: side, buffer: true });   // the old code's saved shape: flush to the wall
      const out = heal([b, walk, buf]);
      const [wi, wo] = span(b, side, get(out, walk.id));
      const [bi, bo] = span(b, side, get(out, buf.id));
      expect(wi).toBeCloseTo(0, 4); expect(wo).toBeCloseTo(5, 4);            // the walk stays against the wall, 5′
      expect(bi).toBeCloseTo(5, 4); expect(bo).toBeCloseTo(15, 4);           // the buffer starts where the walk ends, 10′ deep
    });

    it(`a buffer already beyond the walk is left exactly where it is (${side}, rot ${rot})`, () => {
      const b = host(rot);
      const walk = kid(b, side, "sidewalk", 5, 0, { sidewalkSide: side });
      const buf = kid(b, side, "landscape", 10, 5, { stackSide: side, buffer: true });
      const out = heal([b, walk, buf]);
      for (const k of [walk, buf]) { const o = get(out, k.id); expect(o.cx).toBeCloseTo(k.cx, 6); expect(o.cy).toBeCloseTo(k.cy, 6); expect(o.w).toBeCloseTo(k.w, 6); expect(o.h).toBeCloseTo(k.h, 6); }
    });

    it(`Walk + Parking + Buffer on ${side}, rot ${rot}: the buffer clears the parking too`, () => {
      const b = host(rot);
      const walk = kid(b, side, "sidewalk", 5, 0, { sidewalkSide: side });
      const park = kid(b, side, "parking", 42, 5, { sideParkSide: side });
      const buf = kid(b, side, "landscape", 10, 0, { stackSide: side, buffer: true });
      const out = heal([b, walk, park, buf]);
      const [pi, po] = span(b, side, get(out, park.id));
      const [bi] = span(b, side, get(out, buf.id));
      expect(pi).toBeCloseTo(5, 4); expect(po).toBeCloseTo(47, 4);
      expect(bi).toBeGreaterThanOrEqual(po - 1e-6);
    });
  }

  it("a legacy named landscape strip is still derived flush to the wall", () => {
    const b = host(0);
    const old = kid(b, "left", "landscape", 5, 30, { sidewalkSide: "left" });   // wrong place on purpose
    const out = heal([b, old]);
    const [i] = span(b, "left", get(out, old.id));
    expect(i).toBeCloseTo(0, 4);
  });

  it("the along-wall length still follows a bump-out (the flush layer keeps the span rule on that axis)", () => {
    const b = host(0);
    const buf = kid(b, "left", "landscape", 10, 5, { stackSide: "left", buffer: true });
    const bump = { id: "bo", type: "building", attachedTo: b.id, dogEar: { side: "right", sign: 1, along: 55, proj: 60 }, cx: 1000 + W / 2 + 30, cy: 800 - H / 2 + 27.5, w: 60, h: 55, rot: 0 };
    const out = heal([b, buf, bump]);
    const o = get(out, buf.id);
    const box = wallStripBox(b, "left", [bump], 10);
    expect(o.h).toBeCloseTo(box.dimBY, 4);                                   // the length is the span rule's
  });
});
