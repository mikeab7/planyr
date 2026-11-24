/* NEW-1 (2026-11-24, owner: "curve off and trace the road … a proper design") — lib/parkingRoadTrim.js: a road that CUTS a car or trailer field trims it to
 * the road. Runs the real pipeline (roadNetSteps via netOf, and siteMetrics), never a hand-copied solver. The adjacent cases the owner asked for are here:
 * straight and curved roads, either side and the end, rotation, moving the road / field (the trim recomputes), the right-of-way, trailers, the count, the area. */
import { describe, it, expect } from "vitest";
import { makeField, SETTINGS, netOf, fieldWorld } from "./helpers/driveMatrix.js";
import { roadTrimOf, stallFieldLayout, rowRingOf, clipSegmentToRings, parkSetbackFor, PARK_SETBACK_DEFAULTS, TRIM_TOUCH_FRACTION, MIN_RUN_CAR } from "../src/workspaces/site-planner/lib/parkingRoadTrim.js";
import { siteMetrics } from "../src/workspaces/site-planner/lib/siteMetrics.js";
import { roadStripRing } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import ClipperLib from "clipper-lib";

/** a centerline road through local points of field `f` (a polyline; `curve(t)` sampled densely reads as a curve) */
function roadThrough(f, localPts, o = {}) {
  const W = fieldWorld(f);
  const pts = localPts.map((p) => W(p.x, p.y));
  const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
  const r = { id: o.id || "R", type: "road", z: 1, pts, vtx: pts.map(() => ({})), travelW: o.travelW ?? 26, curb: 0.5, roadClass: o.roadClass || "aisle",
    cx: (Math.min(...xs) + Math.max(...xs)) / 2, cy: (Math.min(...ys) + Math.max(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys), rot: 0 };
  if (o.row) r.xsection = { rowDesignFt: o.row };
  if (o.parkSetbackFt != null) r.parkSetbackFt = o.parkSetbackFt;
  return r;
}
const sample = (fn, x0, x1, n = 40) => Array.from({ length: n + 1 }, (_, i) => { const x = x0 + ((x1 - x0) * i) / n; return { x, y: fn(x) }; });
const bend = (x) => (x < 230 ? -40 : -40 + ((x - 230) / 240) ** 2 * 90);   // runs along the top face, then curves down into the far end
const FIELD = { w: 470, h: 120, cx: 235, cy: 60 };                        // two modules: aisles at local y 18..42 and 78..102

const SC = 100;
const toPath = (ring) => ring.map((p) => ({ X: Math.round(p.x * SC), Y: Math.round(p.y * SC) }));
function overlapArea(cellRing, rings) {
  const c = new ClipperLib.Clipper();
  c.AddPath(toPath(cellRing), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(rings.map(toPath), ClipperLib.PolyType.ptClip, true);
  const out = new ClipperLib.Paths();
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
  return out.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SC * SC);
}
const keptCells = (f, trim) => { const gone = new Set(trim.removed.map((r) => `${r.band}:${r.k}`)); return stallFieldLayout(f, SETTINGS).cells.filter((c) => !gone.has(`${c.band}:${c.k}`)); };
const cellRing = (c) => [{ x: c.x0, y: c.y0 }, { x: c.x1, y: c.y0 }, { x: c.x1, y: c.y1 }, { x: c.x0, y: c.y1 }];
const inRings = (p, rings) => { let i = false; for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) if ((r[a].y > p.y) !== (r[b].y > p.y) && p.x < ((r[b].x - r[a].x) * (p.y - r[a].y)) / (r[b].y - r[a].y) + r[a].x) i = !i; return i; };

describe("a road that only SKIMS a field leaves it exactly as it was", () => {
  it("a road lapping a foot over the outer row: no trim, no clip, the full count", async () => {
    const f = makeField(FIELD), r = roadThrough(f, [{ x: -80, y: -13.5 + 1 }, { x: 560, y: -13.5 + 1 }]);
    const { net } = await netOf([f, r]);
    expect(net.parkTrims.has("F")).toBe(false);
    expect(siteMetrics([f, r], [], [], SETTINGS).stalls).toBe(stallFieldLayout(f, SETTINGS).count);
  });
});

describe("a curve that cuts one end — every rotation", () => {
  for (const rot of [0, 90, 23, 200]) {
    it(`rot ${rot}: whole stalls only, all reachable, one connecting aisle, and the drawing, the count and the Yield agree`, async () => {
      const f = makeField({ ...FIELD, rot }), r = roadThrough(f, sample(bend, -80, 560));
      const { net } = await netOf([f, r]);
      const trim = net.parkTrims.get("F"), clip = net.stallClips.get("F");
      expect(trim).toBeTruthy();
      expect(clip.count).toBe(clip.base - clip.removed.length);
      expect(trim.crosses.length).toBe(1);
      // no kept stall sits under the road's pavement by more than the touch tolerance (field-local frame)
      const F = fieldWorld(f), c = Math.cos((rot * Math.PI) / 180), s = Math.sin((rot * Math.PI) / 180);
      const toLocal = (p) => { const dx = p.x - f.cx, dy = p.y - f.cy; return { x: c * dx + s * dy + f.w / 2, y: -s * dx + c * dy + f.h / 2 }; };
      void F;
      const strip = roadStripRing(r, SETTINGS).map(toLocal);
      for (const k of keptCells(f, trim)) expect(overlapArea(cellRing(k), [strip]) / ((k.x1 - k.x0) * (k.y1 - k.y0))).toBeLessThanOrEqual(TRIM_TOUCH_FRACTION + 1e-9);
      // every kept stall facing an aisle has paved aisle across its whole width in front of it
      const lay = stallFieldLayout(f, SETTINGS);
      for (const k of keptCells(f, trim)) {
        const a = lay.aisles.find((q) => Math.abs(q.y0 - k.y1) < 0.01 || Math.abs(q.y1 - k.y0) < 0.01);
        if (!a) continue;
        const yc = (a.y0 + a.y1) / 2;
        for (const x of [k.x0 + 0.5, (k.x0 + k.x1) / 2, k.x1 - 0.5]) expect(inRings({ x, y: yc }, trim.paved), `stall ${k.band}:${k.k} faces paved aisle at ${x}`).toBe(true);
      }
      // Yield = drawn count; paved area is less than the rect (the islands are landscape, the part under the road is the road's)
      const m = siteMetrics([f, r], [], [], SETTINGS);
      expect(m.stalls).toBe(clip.count);
      expect(m.trimmedCounts.get("F")).toBe(clip.count);
      expect(trim.pavedArea).toBeLessThan(f.w * f.h);
    });
  }
  it("the same layout at every rotation (the trim is computed in the field's own frame)", async () => {
    const counts = [];
    for (const rot of [0, 90, 23, 200]) { const f = makeField({ ...FIELD, rot }); const { net } = await netOf([f, roadThrough(f, sample(bend, -80, 560))]); counts.push(net.stallClips.get("F").count); }
    expect(new Set(counts).size).toBe(1);
  });
});

describe("no orphan stalls: a row the trim breaks keeps only runs of a few stalls or more", () => {
  it("curve and diagonal: every kept run in a broken band is at least MIN_RUN_CAR long", async () => {
    for (const fn of [bend, (x) => -30 + (x - 300) * 0.6]) {
      const f = makeField(FIELD), { net } = await netOf([f, roadThrough(f, sample(fn, -80, 560))]);
      const trim = net.parkTrims.get("F"), lay = stallFieldLayout(f, SETTINGS);
      const gone = new Set(trim.removed.map((q) => `${q.band}:${q.k}`));
      const bands = [...new Set(lay.cells.map((c) => c.band))];
      for (const b of bands) {
        const ks = lay.cells.filter((c) => c.band === b).map((c) => !gone.has(`${b}:${c.k}`));
        if (ks.every(Boolean)) continue;
        let run = 0;
        for (const kept of [...ks, false]) { if (kept) run++; else { if (run) expect(run, `band ${b}`).toBeGreaterThanOrEqual(MIN_RUN_CAR); run = 0; } }
      }
    }
  });
});

describe("the connecting aisle", () => {
  it("a road straight through the middle keeps both halves, each with its own connecting aisle", async () => {
    const f = makeField(FIELD), { net } = await netOf([f, roadThrough(f, [{ x: 240, y: -120 }, { x: 240, y: 240 }])]);
    const trim = net.parkTrims.get("F");
    expect(trim.crosses.length).toBe(2);
    expect(trim.crosses[0].x1 < 240 && trim.crosses[1].x0 > 240).toBe(true);
    const kept = keptCells(f, trim);
    expect(kept.some((c) => c.x1 < 200) && kept.some((c) => c.x0 > 280)).toBe(true);
  });
  it("spans only from the first aisle to the last — never a stub over the outer rows", async () => {
    const f = makeField(FIELD), { net } = await netOf([f, roadThrough(f, sample(bend, -80, 560))]);
    const [x] = net.parkTrims.get("F").crosses;
    expect(x.y0).toBe(18); expect(x.y1).toBe(102);
  });
  it("a single-aisle field gets none (there is nothing to connect)", async () => {
    const f = makeField({ w: 200, h: 60, cx: 100, cy: 30 }), { net } = await netOf([f, roadThrough(f, sample((x) => -30 + (x - 120) * 0.8, -80, 300))]);
    expect(net.parkTrims.get("F").crosses).toEqual([]);
  });
  it("a scrap of stalls stranded across the road is dropped, not given an aisle of its own", async () => {
    const f = makeField(FIELD), { net } = await netOf([f, roadThrough(f, sample((x) => -30 + (x - 300) * 0.6, -80, 560))]);
    const trim = net.parkTrims.get("F");
    expect(trim.crosses.length).toBe(1);
    expect(trim.lot.filter((r) => ClipperLib.Clipper.Orientation(toPath(r))).length).toBe(1);   // one piece of lot
  });
});

describe("moving the road or the field recomputes the trim (nothing is stored)", () => {
  it("road moved clear → the field is whole again; field moved back into it → trimmed again", async () => {
    const f = makeField(FIELD), r = roadThrough(f, sample(bend, -80, 560));
    expect((await netOf([f, r])).net.parkTrims.has("F")).toBe(true);
    const away = { ...r, pts: r.pts.map((p) => ({ x: p.x, y: p.y - 300 })) };
    expect((await netOf([f, away])).net.parkTrims.has("F")).toBe(false);
    const fMoved = { ...f, cy: f.cy - 300 };
    expect((await netOf([fMoved, away])).net.parkTrims.has("F")).toBe(true);
    expect(f.trim === undefined && f.removed === undefined).toBe(true);   // the element itself never carries the answer
  });
});

describe("the right-of-way", () => {
  it("a designated ROW keeps every kept stall out of the whole ROW band, and widening it re-trims", async () => {
    const f = makeField(FIELD);
    const base = roadThrough(f, sample(bend, -80, 560));
    const narrow = (await netOf([f, base])).net.stallClips.get("F").count;
    const withRow = roadThrough(f, sample(bend, -80, 560), { row: 70 });
    const { net } = await netOf([f, withRow]);
    const trim = net.parkTrims.get("F");
    expect(net.stallClips.get("F").count).toBeLessThan(narrow);
    const c = 1, s = 0; void c; void s;
    const toLocal = (p) => ({ x: p.x - f.cx + f.w / 2, y: p.y - f.cy + f.h / 2 });
    const row = rowRingOf(withRow, SETTINGS).map(toLocal);
    for (const k of keptCells(f, trim)) expect(overlapArea(cellRing(k), [row]) / ((k.x1 - k.x0) * (k.y1 - k.y0))).toBeLessThanOrEqual(TRIM_TOUCH_FRACTION + 1e-9);
    const wider = roadThrough(f, sample(bend, -80, 560), { row: 100 });
    expect((await netOf([f, wider])).net.stallClips.get("F").count).toBeLessThan(net.stallClips.get("F").count);
  });
  it("an invalid ROW (narrower than the road's own bands) is ignored, exactly as the canvas draws no ROW line for it", () => {
    const f = makeField(FIELD);
    const r = roadThrough(f, sample(bend, -80, 560));
    r.xsection = { bands: [{ type: "travel", w: 20 }, { type: "travel", w: 20 }], rowDesignFt: 20 };
    expect(rowRingOf(r, SETTINGS)).toBeNull();
  });
});

describe("trailer parking gets the same treatment", () => {
  it("a curve through the end of a trailer field drops the trailers it touches or cuts off, and the count follows", async () => {
    const tset = { ...SETTINGS, trailerW: 12, trailerL: 53, trailerAisle: 60 };
    const t = { id: "T", type: "trailer", z: 0, cx: 300, cy: 83, w: 600, h: 166, rot: 0 };
    const r = roadThrough(t, sample((x) => (x < 300 ? -40 : -40 + ((x - 300) / 300) ** 2 * 140), -80, 700));
    const { net } = await netOf([t, r], tset);
    const clip = net.stallClips.get("T"), lay = stallFieldLayout(t, tset);
    expect(net.parkTrims.has("T")).toBe(true);
    expect(clip.base).toBe(lay.count);
    expect(clip.count).toBeLessThan(lay.count);
    expect(siteMetrics([t, r], [], [], tset).trailers).toBe(clip.count);
  });
});

describe("parking keeps back from a road (owner: \"parking should never really be like right against the roads\")", () => {
  // the road runs ALONGSIDE the top face, its curb a little clear of the outer row: an aisle-class road leaves the field whole,
  // a public road (10 ft keep-back) plants the outer row it would overhang.
  const along = (f, o) => roadThrough(f, [{ x: -80, y: -16 }, { x: 560, y: -16 }], o);
  it("the class defaults: drive aisle none, fire 5, public / truck / custom 10", () => {
    expect(PARK_SETBACK_DEFAULTS).toEqual({ truck: 10, aisle: 0, public: 10, fire: 5, custom: 10 });
    expect(parkSetbackFor({ roadClass: "public" }, SETTINGS)).toBe(10);
    expect(parkSetbackFor({ roadClass: "aisle" }, SETTINGS)).toBe(0);
    expect(parkSetbackFor({}, SETTINGS)).toBe(0);                         // no class = the default class (drive aisle), as everywhere else
  });
  it("the plan's class value (Standards → Roads) beats the seed; the road's own value beats both; 0 on the road is a real answer", () => {
    const st = { ...SETTINGS, roadClasses: [{ key: "public", label: "Public", parkSetback: 15 }, { key: "aisle", label: "Aisle", parkSetback: 0 }] };
    expect(parkSetbackFor({ roadClass: "public" }, st)).toBe(15);
    expect(parkSetbackFor({ roadClass: "public", parkSetbackFt: 4 }, st)).toBe(4);
    expect(parkSetbackFor({ roadClass: "public", parkSetbackFt: 0 }, st)).toBe(0);
    expect(parkSetbackFor({ roadClass: "public", parkSetbackFt: null }, st)).toBe(15);
    // a plan saved before the key existed reads the seed for its class
    expect(parkSetbackFor({ roadClass: "fire" }, { ...SETTINGS, roadClasses: [{ key: "fire", label: "Fire lane", minRadius: 28 }] })).toBe(5);
  });
  it("a public road alongside plants the outer row; a drive aisle in the same place does not; the road's own 0 lets the stalls come back", async () => {
    const f = makeField(FIELD), full = stallFieldLayout(f, SETTINGS).count;
    const aisle = await netOf([f, along(f, { roadClass: "aisle" })]);
    expect(aisle.net.parkTrims.has("F")).toBe(false);
    const pub = await netOf([f, along(f, { roadClass: "public" })]);
    const trim = pub.net.parkTrims.get("F");
    expect(trim).toBeTruthy();
    expect(pub.net.stallClips.get("F").count).toBeLessThan(full);
    expect(trim.removed.every((c) => c.band === 0)).toBe(true);          // only the row facing the road
    const own0 = await netOf([f, along(f, { roadClass: "public", parkSetbackFt: 0 })]);
    expect(own0.net.parkTrims.has("F")).toBe(false);
    // the Yield follows the drawing
    expect(siteMetrics([f, along(f, { roadClass: "public" })], [], [], SETTINGS).stalls).toBe(pub.net.stallClips.get("F").count);
  });
});

describe("primitives", () => {
  it("clipSegmentToRings returns the inside pieces of a segment (even-odd, holes respected)", () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], hole = [{ x: 4, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 6 }, { x: 4, y: 6 }];
    const pcs = clipSegmentToRings({ x: -5, y: 5 }, { x: 15, y: 5 }, [sq, hole]);
    expect(pcs.length).toBe(2);
    expect(pcs[0][0].x).toBeCloseTo(0, 6); expect(pcs[0][1].x).toBeCloseTo(4, 6); expect(pcs[1][0].x).toBeCloseTo(6, 6); expect(pcs[1][1].x).toBeCloseTo(10, 6);
  });
  it("a free-drawn field has no stall layout and is never trimmed", () => {
    expect(roadTrimOf(makeField({ ...FIELD, shape: "poly" }), SETTINGS, [], () => null)).toBeNull();
  });
});
