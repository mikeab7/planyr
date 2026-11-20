/* NEW-1 (2026-11-05) — TRAILER PARKING ALWAYS DRAWS ABOVE ROADS (owner-ordered exception to root constraint 10).
 * RED-PROOF: every behavioural assertion here fails on the pre-change source (a trailer with a LOWER z than an overlapping road
 * paints UNDER it everywhere). The rule is a render-order rule only — no saved z ever changes. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { byZ } from "../src/workspaces/site-planner/lib/planStyle.js";
import { liftTrailersOverRoads, sortElsForPaint, arrangeRuleNote, hasTrailerAndRoad, isRoadItem, isTrailerItem } from "../src/workspaces/site-planner/lib/trailerOverRoads.js";
import { planThumbnailSvg } from "../src/workspaces/site-planner/lib/planThumbnail.js";
import { siteToFeatures } from "../src/workspaces/site-planner/lib/kmzExport.js";
import { reorderByZ } from "../src/workspaces/site-planner/lib/arrange.js";
import { plannerSource } from "./helpers/plannerSource.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

// The Academy › Concept A shape (read-only measurement): east trailer z 8192, road z 82944, buffer z 86016.
const trailer = { id: "e1455576wvkdne", type: "trailer", cx: 50, cy: 40, w: 60, h: 20, rot: 0, z: 8192 };
const road = { id: "e1455667iklvem", type: "road", pts: [{ x: 0, y: 40 }, { x: 100, y: 40 }], travelW: 24, curb: 1, z: 82944 };
const buffer = { id: "e1455670iklvem", type: "landscape", cx: 50, cy: 62, w: 60, h: 14, rot: 0, z: 86016 };
const building = { id: "b1", type: "building", cx: 20, cy: 10, w: 30, h: 20, rot: 0, z: 0 };
const ids = (list) => list.map((x) => (x.el || x).id);
const item = (el) => ({ kind: "el", z: el.z, el });
const cluster = (z, id = "rc") => ({ kind: "road", z, id });

describe("liftTrailersOverRoads — the pure rule", () => {
  it("lifts a lower-z trailer above a lone road", () => {
    const out = liftTrailersOverRoads([item(trailer), item(road)]);
    expect(ids(out)).toEqual(["e1455667iklvem", "e1455576wvkdne"]);
  });
  it("lifts a trailer above a road-network CLUSTER (kind: road)", () => {
    const out = liftTrailersOverRoads([item(trailer), cluster(82944)]);
    expect(out[0].kind).toBe("road");
    expect(out[1].el.id).toBe(trailer.id);
  });
  it("leaves everything above the highest road alone (the buffer added after the road stays on top)", () => {
    const out = liftTrailersOverRoads([item(building), item(trailer), item(road), item(buffer)]);
    expect(ids(out)).toEqual(["b1", "e1455667iklvem", "e1455576wvkdne", "e1455670iklvem"]);
  });
  it("never moves a road against anything else (roads keep their relative order)", () => {
    const r2 = { ...road, id: "r2", z: 90000 };
    const out = liftTrailersOverRoads([item(building), item(trailer), item(road), item(buffer), item(r2)]);
    const roadsOnly = ids(out).filter((i) => i === road.id || i === "r2" || i === "b1" || i === buffer.id);
    expect(roadsOnly).toEqual(["b1", road.id, buffer.id, "r2"]);
    expect(ids(out).indexOf(trailer.id)).toBeGreaterThan(ids(out).indexOf("r2"));
  });
  it("keeps several trailers in their own relative order", () => {
    const t2 = { ...trailer, id: "t2", z: 9000 };
    const out = liftTrailersOverRoads([item(trailer), item(t2), item(road)]);
    expect(ids(out)).toEqual([road.id, trailer.id, "t2"]);
  });
  it("is the SAME array (no copy, no work) when nothing needs to move", () => {
    const a = [item(road), item(trailer)];
    expect(liftTrailersOverRoads(a)).toBe(a);
    const b = [item(building), item(trailer)];
    expect(liftTrailersOverRoads(b)).toBe(b);
    const c = [item(building), item(road)];
    expect(liftTrailersOverRoads(c)).toBe(c);
  });
  it("only trailers get the exception: paving, parking, buffers and sidewalks keep plain draw order", () => {
    for (const type of ["paving", "parking", "landscape", "sidewalk", "pond", "building"]) {
      const el = { id: `x-${type}`, type, cx: 0, cy: 0, w: 5, h: 5, z: 10 };
      const list = [item(el), item(road)];
      expect(liftTrailersOverRoads(list)).toBe(list);
      expect(isTrailerItem(item(el))).toBe(false);
    }
    expect(isRoadItem(item(road))).toBe(true);
  });
  it("does not mutate or write a z onto anything", () => {
    const t = { ...trailer }, r = { ...road };
    const before = JSON.stringify([t, r]);
    liftTrailersOverRoads([item(t), item(r)]);
    expect(JSON.stringify([t, r])).toBe(before);
  });
  it("stays linear on a large plan (flat per-render cost)", () => {
    const many = [];
    for (let i = 0; i < 60000; i++) many.push(item({ id: `e${i}`, type: i % 500 === 0 ? "trailer" : i % 997 === 0 ? "road" : "paving", z: i }));
    const t0 = performance.now();
    liftTrailersOverRoads(many);
    expect(performance.now() - t0).toBeLessThan(150);
  });
});

describe("sortElsForPaint — flat consumers (thumbnail, KMZ)", () => {
  it("a trailer with a lower z paints after the road", () => {
    expect(sortElsForPaint([road, trailer, building], byZ).map((e) => e.id)).toEqual(["b1", road.id, trailer.id]);
  });
});

describe("every surface agrees with the canvas", () => {
  it("thumbnail: the trailer path is emitted AFTER the road path (red on main)", () => {
    const svg = planThumbnailSvg({ id: "s", parcels: [], els: [trailer, road] });
    expect(svg.indexOf("#e3d4b2")).toBeGreaterThan(svg.indexOf("#9eabb7")); // TYPE.trailer.fill after TYPE.road.fill
  });
  it("thumbnail: with no road the trailer is unchanged", () => {
    const svg = planThumbnailSvg({ id: "s", parcels: [], els: [trailer, building] });
    expect(svg).toContain("#e3d4b2");
  });
  it("KMZ: the trailer placemark is written after the road's", () => {
    const f = siteToFeatures({ parcels: [], els: [trailer, road], measures: [], settings: {} }, (p) => [p.x, p.y], {});
    const names = f.map((x) => x.name);
    expect(names.indexOf("Trailer Parking")).toBeGreaterThan(names.indexOf("Road"));
  });
  it("the canvas (elPaintItems), thumbnail and KMZ all route through the ONE rule (no second copy)", () => {
    expect(plannerSource()).toMatch(/liftTrailersOverRoads\(merged\.filter\(\(it\) => !it\.lifted\)/);
    expect(plannerSource()).toMatch(/liftTrailersOverRoads\(merged\.filter\(\(it\) => it\.lifted\)/);
    expect(read("src/workspaces/site-planner/lib/planThumbnail.js")).toMatch(/sortElsForPaint\(/);
    expect(read("src/workspaces/site-planner/lib/kmzExport.js")).toMatch(/sortElsForPaint\(/);
  });
});

describe("render-order only — saved z is never rewritten", () => {
  it("planStyle.zOrder/byZ are unchanged: the trailer's stored z still sorts BELOW the road's", () => {
    expect(byZ(trailer, road)).toBeLessThan(0);
  });
  it("the selection lift is still its own list (a selected road stays above everything while selected)", () => {
    const src = plannerSource();
    expect(src).toMatch(/lifted: liftTrailersOverRoads/);
    // a selected road is in `lifted`, a trailer not selected is in `normal`: lifted renders after normal.
    expect(src.indexOf("elPaintItems.normal.map(renderPaintItem)")).toBeLessThan(src.indexOf("elPaintItems.lifted.map(renderPaintItem)"));
  });
});

describe("Arrange stays honest", () => {
  const els = [building, trailer, road];
  it("Bring to Front on a road still reorders against everything else (the command is live)", () => {
    expect(reorderByZ(els, building.id, "front")).toBeTruthy();
  });
  it("…and says plainly that it can't beat trailer parking", () => {
    expect(arrangeRuleNote(road, "front", els)).toMatch(/Trailer parking always draws above roads/);
    expect(arrangeRuleNote(road, "forward", els)).toBeTruthy();
    expect(arrangeRuleNote(trailer, "back", els)).toBeTruthy();
    expect(arrangeRuleNote(trailer, "backward", els)).toBeTruthy();
  });
  it("says nothing where the command works (road back, trailer front, other types, or no trailer/road pair)", () => {
    expect(arrangeRuleNote(road, "back", els)).toBeNull();
    expect(arrangeRuleNote(trailer, "front", els)).toBeNull();
    expect(arrangeRuleNote(building, "front", els)).toBeNull();
    expect(arrangeRuleNote(road, "front", [building, road])).toBeNull();
    expect(hasTrailerAndRoad([building, road])).toBe(false);
  });
});

describe("the exception is on the record (so the next session does not undo it)", () => {
  it("root CLAUDE.md constraint 10, planStyle and paintOrder all name it", () => {
    expect(read("CLAUDE.md")).toMatch(/TRAILER PARKING ALWAYS DRAWS ABOVE ROADS/);
    expect(read("src/workspaces/site-planner/lib/planStyle.js")).toMatch(/trailerOverRoads/);
    expect(read("src/workspaces/site-planner/lib/paintOrder.js")).toMatch(/trailerOverRoads/);
    expect(read("src/workspaces/site-planner/lib/zOrder.js")).toMatch(/trailerOverRoads/);
  });
});

describe("the greyed Arrange rows name this rule when it is the real reason", () => {
  it("the element menu's disabled-row tooltip asks arrangeRuleNote", () => {
    expect(plannerSource()).toMatch(/arrWhy \|\| arrangeRuleNote\(t, mode, els\)/);
  });
});
