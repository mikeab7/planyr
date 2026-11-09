/* NEW-1 (owner 2026-11-09) — the PAVING setback: a second, owner-added, per-edge setback over the same sections.
 * Storage + edge bookkeeping (the keyed-array rules), the split carry, the read round trip, and the conflict scan with its
 * driveway exemption. Every "fails on main" claim below is true of the untouched tree because the module and the key do not exist there. */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import {
  hasPaving, pavingValues, newPaving, pavingAll, setPavingSection, sectionValue, shiftPavingOnInsert, shiftPavingOnDelete,
  pavingRing, pavingConflicts, limitedByPaving, PAVING_TYPES,
} from "../src/workspaces/site-planner/lib/pavingSetback.js";
import { boundarySections } from "../src/workspaces/site-planner/lib/boundarySections.js";
import { ringOf } from "../src/workspaces/site-planner/lib/siteGeometry.js";
import { roadSurfaceRing } from "../src/workspaces/site-planner/lib/roadNetwork.js";
import { planSplit } from "../src/workspaces/site-planner/lib/parcelOps.js";
import { createSiteModel, mergeSiteContent } from "../src/workspaces/site-planner/lib/siteModel.js";

const sq = (w = 400, h = 300) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const lot = (extra = {}) => ({ id: "L1", points: sq(), active: true, ...extra });
const rect = (id, type, cx, cy, w, h, extra = {}) => ({ id, type, cx, cy, w, h, rot: 0, ...extra });
const roadEl = (id, pts, travelW = 24) => ({ id, type: "road", pts, travelW, curb: 0.5, vtx: pts.map(() => null) });
const roadCentreline = (el) => (el.type === "road" && el.pts ? el.pts : null);
const roadRingOf = (el, line) => roadSurfaceRing(line, el.travelW + 1) || [];
const scan = (parcels, els) => pavingConflicts({ parcels, els, ringOf, roadCentreline, roadRingOf });
const ids = (r) => r.map((c) => c.id).sort();

describe("storage — absent means not added, and it starts at 0", () => {
  it("a parcel that never added paving has no key, no values, no ring (old plans gain nothing)", () => {
    const pc = lot();
    expect(hasPaving(pc)).toBe(false);
    expect(pavingValues(pc)).toBeNull();
    expect(pavingRing(pc)).toBeNull();
    expect("pavingSetbacks" in pc).toBe(false);
  });
  it("adding starts at 0 on every edge and draws NOTHING until a value is typed — never the building value", () => {
    const pc = lot({ setbacks: [25, 25, 25, 25], pavingSetbacks: newPaving(4) });
    expect(pc.pavingSetbacks).toEqual([0, 0, 0, 0]);
    expect(hasPaving(pc)).toBe(true);
    expect(pavingRing(pc)).toBeNull();
  });
  it("'all sections' sets every edge, clamped ≥ 0; a short array pads with 0 rather than inventing a value", () => {
    expect(pavingAll(4, 10)).toEqual([10, 10, 10, 10]);
    expect(pavingAll(3, -5)).toEqual([0, 0, 0]);
    expect(pavingValues({ points: sq(), pavingSetbacks: [7] })).toEqual([7, 0, 0, 0]);
  });
  it("a typed value draws a ring inside the lot", () => {
    const r = pavingRing(lot({ pavingSetbacks: pavingAll(4, 10) }));
    expect(r).toHaveLength(4);
    const xs = r.map((p) => p.x), ys = r.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map(Math.round)).toEqual([10, 390, 10, 290]);
  });
});

describe("sections — one section system shared with the building setback", () => {
  const ring = JSON.parse(fs.readFileSync(new URL("./fixtures/academySplitParcel.json", import.meta.url))).points.map(([x, y]) => ({ x, y }));
  const secs = boundarySections(ring, { defaultSetback: 25 });
  it("setting a section's paving value writes only that section's edges and reads back as its common value", () => {
    const base = newPaving(ring.length);
    const out = setPavingSection(base, secs[1], 20, ring.length);
    secs.forEach((s, i) => expect(sectionValue(out, s)).toBe(i === 1 ? 20 : 0));
    expect(out).toHaveLength(ring.length);
  });
  it("a section whose edges differ reads null (mixed) — same convention as the building value", () => {
    const v = newPaving(ring.length); v[secs[0].edges[0]] = 5;
    expect(secs[0].edges.length > 1 ? sectionValue(v, secs[0]) : null).toBeNull();
  });
});

describe("edge-index bookkeeping across a vertex insert / delete", () => {
  it("insert on edge i: both halves keep the value, later edges shift up one", () => {
    expect(shiftPavingOnInsert([10, 20, 30, 40], 1)).toEqual([10, 20, 20, 30, 40]);
    expect(shiftPavingOnInsert([10, 20, 30, 40], 3)).toEqual([10, 20, 30, 40, 40]);
  });
  it("delete vertex i: the merged edge keeps the first half's value", () => {
    expect(shiftPavingOnDelete([10, 20, 30, 40], 2)).toEqual([10, 20, 40]);
    expect(shiftPavingOnDelete([10, 20, 30, 40], 0)).toEqual([20, 30, 40]);
  });
  it("absent stays absent — nothing is invented for a parcel that never added paving", () => {
    expect(shiftPavingOnInsert(undefined, 1)).toBeUndefined();
    expect(shiftPavingOnDelete(null, 1)).toBeNull();
  });
  it("an insert then a delete of the new vertex returns the original values", () => {
    const v = [10, 20, 30, 40];
    expect(shiftPavingOnDelete(shiftPavingOnInsert(v, 1), 2)).toEqual(v);
  });
});

describe("split / combine / read / merge / duplicate", () => {
  const cut = [{ x: 200, y: -10 }, { x: 200, y: 310 }];
  const run = (pc) => planSplit([pc], cut, { newId: (() => { let k = 0; return () => `n${++k}`; })(), baseSetback: 25 });
  it("a split piece carries the parent's paving per edge; the edge the CUT made takes 0, not the building value", () => {
    const res = run(lot({ pavingSetbacks: [10, 11, 12, 13] }));
    expect(res.ok).toBe(true);
    for (const piece of res.made) {
      expect(piece.pavingSetbacks).toHaveLength(piece.points.length);
      expect(piece.pavingSetbacks.every((v) => v === 0 || [10, 11, 12, 13].includes(v))).toBe(true);
      expect(piece.pavingSetbacks.filter((v) => v === 0).length).toBeGreaterThanOrEqual(1); // the cut edge
      expect(piece.pavingSetbacks).not.toContain(25);
    }
  });
  it("a split of a parcel with no paving adds no key (byte-for-byte as before)", () => {
    const res = run(lot());
    expect(res.ok).toBe(true);
    for (const piece of res.made) expect("pavingSetbacks" in piece).toBe(false);
  });
  it("the key survives the model's read funnel; a parcel without it does not gain one", () => {
    const m = createSiteModel({ parcels: [lot({ id: "A", pavingSetbacks: [10, 0, 0, 5] }), lot({ id: "B", points: sq(10, 10) })] });
    expect(m.parcels.find((p) => p.id === "A").pavingSetbacks).toEqual([10, 0, 0, 5]);
    expect("pavingSetbacks" in m.parcels.find((p) => p.id === "B")).toBe(false);
  });
  it("a duplicated plan (whole-record copy) carries paving; add → remove leaves no key behind", () => {
    const src = createSiteModel({ parcels: [lot({ pavingSetbacks: [10, 10, 10, 10] })] });
    const dup = createSiteModel(JSON.parse(JSON.stringify({ ...src, id: "copy" })));
    expect(dup.parcels[0].pavingSetbacks).toEqual([10, 10, 10, 10]);
    const { pavingSetbacks: _gone, ...removed } = dup.parcels[0];
    expect("pavingSetbacks" in createSiteModel({ parcels: [removed] }).parcels[0]).toBe(false);
  });
  it("a merge of a newer copy that REMOVED paving does not resurrect it from the older copy", () => {
    const withP = createSiteModel({ updatedAt: 1000, parcels: [lot({ pavingSetbacks: [10, 10, 10, 10] })] });
    const without = createSiteModel({ updatedAt: 2000, parcels: [lot()] });
    const merged = mergeSiteContent(without, withP);
    expect("pavingSetbacks" in merged.parcels[0]).toBe(false);
  });
});

describe("what it limits — and what it does not", () => {
  it("limits car/trailer parking, paving (truck courts) and roads; not sidewalks, buildings, ponds, landscape/buffers", () => {
    expect([...PAVING_TYPES].sort()).toEqual(["parking", "paving", "road", "trailer"]);
    for (const t of ["building", "sidewalk", "pond", "landscape", "driveInRamp"]) expect(limitedByPaving({ type: t })).toBe(false);
    expect(limitedByPaving({ type: "landscape", buffer: true })).toBe(false);
  });
  const parcels = [lot({ pavingSetbacks: pavingAll(4, 10) })];
  it("known-good arm: the same elements flag when they cross the line and stay quiet when inside it", () => {
    const flagged = scan(parcels, [rect("p1", "parking", 395, 150, 40, 60)]);
    expect(ids(flagged)).toEqual(["p1"]);
    expect(flagged[0].areaSf).toBeGreaterThan(100);
    expect(scan(parcels, [rect("p2", "parking", 200, 150, 100, 60)])).toEqual([]);
  });
  it("each limited kind is flagged: parking, trailer parking, truck court (paving), a road", () => {
    const r = scan(parcels, [rect("a", "parking", 5, 150, 30, 50), rect("b", "trailer", 395, 60, 30, 60), rect("c", "paving", 200, 295, 80, 30), roadEl("d", [{ x: 100, y: 290 }, { x: 300, y: 290 }])]);
    expect(ids(r)).toEqual(["a", "b", "c", "d"]);
  });
  it("a sidewalk and a building across the line are NOT flagged by the paving setback", () => {
    expect(scan(parcels, [rect("s", "sidewalk", 395, 150, 40, 60), rect("bd", "building", 5, 150, 40, 60)])).toEqual([]);
  });
  it("with no paving added, or paving at 0, nothing is ever flagged", () => {
    const els = [rect("p1", "parking", 395, 150, 40, 60)];
    expect(scan([lot()], els)).toEqual([]);
    expect(scan([lot({ pavingSetbacks: newPaving(4) })], els)).toEqual([]);
  });
  it("an inactive parcel raises no flags", () => {
    expect(scan([lot({ active: false, pavingSetbacks: pavingAll(4, 10) })], [rect("p1", "parking", 395, 150, 40, 60)])).toEqual([]);
  });
  it("per-edge values: only the east edge has 30 ft, so a field 25 ft off the east line flags there and not at the west", () => {
    const pc = lot({ pavingSetbacks: [0, 30, 0, 0] });
    expect(ids(scan([pc], [rect("e", "parking", 375, 150, 20, 50)]))).toEqual(["e"]);
    expect(scan([pc], [rect("w", "parking", 5, 150, 6, 50)])).toEqual([]);
  });
});

describe("the driveway exemption — a drive to a road outside the site may cross the line", () => {
  const parcels = [lot({ pavingSetbacks: pavingAll(4, 10) })];
  it("a drive from OUTSIDE the lot across the band to the inside is not flagged", () => {
    expect(scan(parcels, [roadEl("drv", [{ x: -60, y: 150 }, { x: 150, y: 150 }])])).toEqual([]);
  });
  it("…but the same road, ending inside the band (it connects to nothing), IS flagged", () => {
    expect(ids(scan(parcels, [roadEl("stub", [{ x: 200, y: 150 }, { x: 396, y: 150 }])]))).toEqual(["stub"]);
  });
  it("a road that starts outside and runs ALONG the band, never entering the paving line, is flagged, not exempted", () => {
    expect(ids(scan(parcels, [roadEl("along", [{ x: -40, y: 4 }, { x: 300, y: 4 }])]))).toEqual(["along"]);
  });
  it("a drive that goes in then wanders back out through the band elsewhere flags the second crossing only", () => {
    const r = scan(parcels, [roadEl("loop", [{ x: -60, y: 150 }, { x: 150, y: 150 }, { x: 150, y: 296 }])]);
    expect(ids(r)).toEqual(["loop"]);
    expect(r[0].driveway).toBe(true);
    const whole = scan(parcels, [roadEl("loop2", [{ x: 150, y: 150 }, { x: 150, y: 296 }])]);
    expect(whole[0].areaSf).toBeGreaterThan(r[0].areaSf * 0.5);
  });
  it("a drive whose outside end belongs to ANOTHER lot of the site is not a street connection", () => {
    const two = [lot({ pavingSetbacks: pavingAll(4, 10) }), { id: "L2", active: true, points: sq(400, 300).map((p) => ({ x: p.x - 400, y: p.y })) }];
    expect(ids(scan(two, [roadEl("x", [{ x: -60, y: 150 }, { x: 150, y: 150 }])]))).toEqual(["x"]);
  });
});
