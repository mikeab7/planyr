/* NEW-1 — junction outline-cut polylines were DOUBLE-ROTATED.
 *
 * Repro (owner, Tsakiris / Concept A): the east-end parking field a drive tees into (150×42, rot 270)
 * drew two parking-coloured lines 42 ft apart cutting across the field and projecting ~59 ft east into
 * bare aerial, plus a short vertical stub — and the field's own outline was missing entirely.
 *
 * Root cause: the interrupted-outline polylines are built in WORLD feet (el.rot baked into the corners)
 * and were pushed straight into `parts`, which renderElPx returns inside a `rotate(el.rot, c)` group —
 * so el.rot was applied TWICE. rot 0 / 180 are unaffected (0° / 360°); rot 90 / 270 land at 540° ≡ 180°,
 * and a rectangle rotated 180° about its own centre is congruent to the UNROTATED one, so a 42×150 field
 * drew its outline as 150×42 about the same centre — sticking ~54 ft out each way. The plain rect's own
 * stroke is blanked when outlineCut is active (the polylines are supposed to BE the outline), which is
 * why the real edge vanished as well.
 *
 * Fix: build the segments in the pure lib (`rectOutlineCutSegments`) and wrap them in a
 * `rotate(-el.rot, c)` group — the same counter-rotate the pond baseline ghost and the stage contours
 * have always applied for exactly this reason.
 *
 * This file guards BOTH halves:
 *   (a) the pure geometry — the segments' bbox IS the element's true rotated footprint bbox, and the
 *       outline is interrupted ONLY where the drive's pavement crosses it;
 *   (b) the render frame — the segments are counter-rotated, so the composed transform is the identity.
 *       Part (b) fails on the pre-fix source, and its premise is proved numerically here rather than
 *       asserted: the pre-fix composition is reproduced and shown to be wrong at rot 90/270 (and, tellingly,
 *       RIGHT at rot 0/180 — which is why every prior rot-0 mock passed while the plan rendered broken).
 * End-to-end confirmation through the real DOM (incl. export parity) is e2e/junction-outline-cut.spec.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { rectOutlineCutSegments } from "../src/workspaces/site-planner/lib/roadNetwork.js";

const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

/* ---- helpers: the same transform algebra the SVG group applies ---------------------------------- */
const rotPt = (p, deg, c) => {
  const r = (deg * Math.PI) / 180, co = Math.cos(r), si = Math.sin(r);
  const dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * co - dy * si, y: c.y + dx * si + dy * co };
};
const bboxOf = (segs) => {
  const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const seg of segs) for (const p of seg) {
    b.x0 = Math.min(b.x0, p.x); b.y0 = Math.min(b.y0, p.y);
    b.x1 = Math.max(b.x1, p.x); b.y1 = Math.max(b.y1, p.y);
  }
  return { ...b, w: b.x1 - b.x0, h: b.y1 - b.y0 };
};
/* The element's TRUE drawn footprint bbox — what the plain <rect> occupies once the element group's
 * rotate(el.rot) has been applied. Nothing the element draws may fall outside this. */
const footprintBbox = (el) => {
  const c = { x: el.cx, y: el.cy };
  const local = [
    { x: el.cx - el.w / 2, y: el.cy - el.h / 2 }, { x: el.cx + el.w / 2, y: el.cy - el.h / 2 },
    { x: el.cx + el.w / 2, y: el.cy + el.h / 2 }, { x: el.cx - el.w / 2, y: el.cy + el.h / 2 },
  ];
  return bboxOf([local.map((p) => rotPt(p, el.rot || 0, c))]);
};
const closeBox = (a, b, tol = 1e-6) => Math.abs(a.x0 - b.x0) < tol && Math.abs(a.y0 - b.y0) < tol
  && Math.abs(a.x1 - b.x1) < tol && Math.abs(a.y1 - b.y1) < tol;

/* The owner's field: e52duuwgj, Tsakiris / Concept A. */
const FIELD = (rot) => ({ id: "e52duuwgj", type: "parking", cx: -224.63, cy: 360.7, w: 150, h: 42, rot });
/* A cutter standing in for the drive's dissolved pavement: a 30 ft band crossing the field's centre,
 * built in world feet so it lands on the rotated footprint regardless of rot. */
const driveCutter = (el, halfW = 15, reach = 400) => {
  const c = { x: el.cx, y: el.cy };
  const ring = [
    { x: el.cx - halfW, y: el.cy - reach }, { x: el.cx + halfW, y: el.cy - reach },
    { x: el.cx + halfW, y: el.cy + reach }, { x: el.cx - halfW, y: el.cy + reach },
  ];
  return [ring.map((p) => rotPt(p, el.rot || 0, c))];
};

const ORTHO = [0, 90, 180, 270];

/* -------------------------------------------------------------------------------------------------
 * (a) pure geometry
 * ---------------------------------------------------------------------------------------------- */
describe("rectOutlineCutSegments — the interrupted outline is the element's real footprint", () => {
  it.each(ORTHO)("rot %i: the UNCUT outline traces exactly the true rotated footprint", (rot) => {
    const el = FIELD(rot);
    const segs = rectOutlineCutSegments(el, []);
    expect(segs.length).toBe(4);                       // four edges, none interrupted
    expect(closeBox(bboxOf(segs), footprintBbox(el), 1e-9)).toBe(true);
  });

  it.each([37, 123, 268.5])("rot %s: an oblique rotation traces the true footprint too", (rot) => {
    const el = FIELD(rot);
    expect(closeBox(bboxOf(rectOutlineCutSegments(el, [])), footprintBbox(el), 1e-9)).toBe(true);
  });

  it.each(ORTHO)("rot %i: a drive interrupts the outline WITHOUT pushing any line outside the footprint", (rot) => {
    const el = FIELD(rot);
    const segs = rectOutlineCutSegments(el, driveCutter(el));
    expect(segs.length).toBeGreaterThan(4);            // at least one edge split by the drive mouth
    const bb = bboxOf(segs), fp = footprintBbox(el);
    // The cut can only ever REMOVE outline, so the drawn bbox must sit inside the footprint (and, since
    // the drive crosses mid-edge, it still reaches all four sides — the clip tolerance is sub-inch).
    expect(bb.x0).toBeGreaterThanOrEqual(fp.x0 - 0.02);
    expect(bb.y0).toBeGreaterThanOrEqual(fp.y0 - 0.02);
    expect(bb.x1).toBeLessThanOrEqual(fp.x1 + 0.02);
    expect(bb.y1).toBeLessThanOrEqual(fp.y1 + 0.02);
    expect(Math.abs(bb.w - fp.w)).toBeLessThan(0.05);
    expect(Math.abs(bb.h - fp.h)).toBeLessThan(0.05);
  });

  it("the gap is exactly the drive mouth — total drawn length = perimeter minus the two crossings", () => {
    const el = FIELD(270);
    const halfW = 15;
    const len = (segs) => segs.reduce((s, seg) => s + seg.slice(1).reduce((t, p, i) => t + Math.hypot(p.x - seg[i].x, p.y - seg[i].y), 0), 0);
    const whole = len(rectOutlineCutSegments(el, []));
    const cut = len(rectOutlineCutSegments(el, driveCutter(el, halfW)));
    expect(whole).toBeCloseTo(2 * (el.w + el.h), 6);
    // The band crosses two opposite edges, removing 2·(2·halfW) of outline.
    expect(whole - cut).toBeCloseTo(2 * 2 * halfW, 1);
  });

  it("a polygon element or a degenerate rect draws no cut outline at all (the rect path owns this)", () => {
    expect(rectOutlineCutSegments({ points: [{ x: 0, y: 0 }], cx: 0, cy: 0, w: 10, h: 10 }, [])).toEqual([]);
    expect(rectOutlineCutSegments({ cx: 0, cy: 0, w: 0, h: 10 }, [])).toEqual([]);
    expect(rectOutlineCutSegments(null, [])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------------------------------
 * (b) render frame — the segments live inside the element's rotate(el.rot) group, so they must be
 *     counter-rotated. This is the half that FAILED before the fix.
 * ---------------------------------------------------------------------------------------------- */
describe("the outline-cut group counter-rotates, so the composed transform is the identity", () => {
  const src = read("../src/workspaces/site-planner/SitePlanner.jsx");

  it("renderElPx returns every rect element's parts inside a rotate(el.rot) group", () => {
    // The premise of the whole bug: `parts` is rotated by the element group on the way out.
    // Inert attributes may sit between `key` and `transform` (NEW-2/NEW-3 added `data-el-id` so a
    // headless harness can measure one element's real geometry) — what must not change is that the
    // group still applies rotate(el.rot) about the element centre.
    expect(src).toMatch(/return <g key=\{el\.id\}[^>]*? transform=\{`rotate\(\$\{el\.rot\} \$\{c\.x\} \$\{c\.y\}\)`\}/);
  });

  it("the outline-cut polylines are wrapped in rotate(-el.rot) — NOT pushed bare into parts", () => {
    const i = src.indexOf("const segs = rectOutlineCutSegments(el, outlineCut);");
    expect(i, "rectOutlineCutSegments call site not found — has the outline-cut render moved or been reverted?").toBeGreaterThan(-1);
    const block = src.slice(i, i + 700);
    expect(block).toMatch(/<g key="olcut" transform=\{`rotate\(\$\{-\(el\.rot \|\| 0\)\} \$\{c\.x\} \$\{c\.y\}\)`\}/);
    // …and the polylines are inside that group, not siblings of it.
    expect(block.indexOf("<polyline")).toBeGreaterThan(block.indexOf('<g key="olcut"'));
  });

  it.each(ORTHO)("rot %i: world segments ∘ counter-rotate ∘ element rotate == the true footprint", (rot) => {
    const el = FIELD(rot), c = { x: el.cx, y: el.cy };
    const world = rectOutlineCutSegments(el, []);
    // What the DOM actually composes: inner rotate(-rot) then the element group's rotate(rot).
    const drawn = world.map((seg) => seg.map((p) => rotPt(rotPt(p, -rot, c), rot, c)));
    expect(closeBox(bboxOf(drawn), footprintBbox(el), 1e-6)).toBe(true);
  });

  /* The premise, proved rather than asserted: this is what the pre-fix code composed. It is why every
   * previous rot-0 mock passed while the owner's rot-270 field rendered broken. */
  it.each([0, 180])("rot %i: the PRE-FIX composition happened to be correct (why the bug hid so long)", (rot) => {
    const el = FIELD(rot), c = { x: el.cx, y: el.cy };
    const broken = rectOutlineCutSegments(el, []).map((seg) => seg.map((p) => rotPt(p, rot, c)));
    expect(closeBox(bboxOf(broken), footprintBbox(el), 1e-6)).toBe(true);
  });

  it.each([90, 270])("rot %i: the PRE-FIX composition threw the outline far outside the footprint", (rot) => {
    const el = FIELD(rot), c = { x: el.cx, y: el.cy };
    const broken = rectOutlineCutSegments(el, []).map((seg) => seg.map((p) => rotPt(p, rot, c)));
    const bb = bboxOf(broken), fp = footprintBbox(el);
    expect(closeBox(bb, fp, 1e-6)).toBe(false);
    // 540° ≡ 180° → the w×h footprint is drawn transposed about the same centre.
    expect(bb.w).toBeCloseTo(fp.h, 6);
    expect(bb.h).toBeCloseTo(fp.w, 6);
    // …overhanging the true footprint by half the difference on each side — the owner's stray lines.
    expect(bb.x1 - fp.x1).toBeCloseTo((el.w - el.h) / 2, 6);
    expect(fp.x0 - bb.x0).toBeCloseTo((el.w - el.h) / 2, 6);
  });
});
