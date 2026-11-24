// AUDIT BATCH G3 — the dock / wall-kid / ramp assembly engine as pure functions of the element array.
import { describe, it, expect } from "vitest";
import { plannerSource } from "./helpers/plannerSource.js";
import { DEFAULT_SETTINGS } from "../src/workspaces/site-planner/lib/plannerConstants.js";
import * as ops from "../src/workspaces/site-planner/lib/assemblyOps.js";

const S = DEFAULT_SETTINGS;
const bldg = { id: "B", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0, dock: "cross", dockAxis: "x", dockSide: "bottom" };
const chainOn = (side = "bottom") => {
  let arr = [bldg];
  for (let i = 0; i < 3; i++) { const z = ops.buildNextZoneIn(arr, bldg, side, S); if (z) arr = [...arr, z]; }
  return arr;
};

describe("assemblyOps — zones and chains", () => {
  it("buildNextZoneIn grows court → trailer → buffer, then stops", () => {
    const arr = chainOn();
    expect(ops.findCourtIn(arr, bldg, "bottom")).toBeTruthy();
    const court = ops.findCourtIn(arr, bldg, "bottom");
    const trailer = ops.findTrailerIn(arr, court), buffer = ops.findBufferIn(arr, trailer);
    expect(trailer && trailer.forCourt).toBe(court.id);
    expect(buffer && buffer.forTrailer).toBe(trailer.id);
    expect(ops.stackCountIn(arr, bldg, "bottom")).toBe(3);
    expect(ops.findZoneIn(arr, bldg, "bottom", 1)).toBe(trailer);
    expect(ops.buildNextZoneIn(arr, bldg, "bottom", S)).toBeNull();
  });
  it("classifies and indexes zones", () => {
    const [, court, trailer, buffer] = chainOn();
    expect([court, trailer, buffer].map(ops.zoneIndexOf)).toEqual([0, 1, 2]);
    expect([court, trailer, buffer].every(ops.isDockZone)).toBe(true);
    expect(ops.isDockZone(bldg)).toBe(false);
    expect(ops.isDockLayerEl(buffer)).toBe(true);
    expect([court, trailer, buffer].map(ops.chainKindOf)).toEqual(["strip", "trailer", "strip"]);
  });
  it("walks the chain from its head", () => {
    const arr = chainOn();
    const chain = ops.dockChainOnSide(arr, bldg, "bottom");
    expect(chain).toHaveLength(3);
    expect(ops.findHeadIn(arr, bldg, "bottom")).toBe(chain[0]);
    expect(ops.nextInChain(arr, chain[0])).toBe(chain[1]);
    expect(ops.chainFromHead(arr, chain[0])).toEqual(chain);
    expect(ops.dockChainOnSide(arr, bldg, "top")).toEqual([]);
  });
  it("relayoutSideIn lays the chain outward of the wall; relayoutAllSidesIn is idempotent", () => {
    const arr = ops.relayoutAllSidesIn(chainOn(), bldg, S);
    const chain = ops.dockChainOnSide(arr, bldg, "bottom");
    const ys = chain.map((z) => z.cy);
    expect(ys[0]).toBeGreaterThan(bldg.cy + bldg.h / 2);
    expect(ys[1]).toBeGreaterThan(ys[0]);
    expect(ys[2]).toBeGreaterThan(ys[1]);
    const again = ops.relayoutAllSidesIn(arr, bldg, S);
    expect(again.map((e) => [e.id, e.cx, e.cy, e.w, e.h])).toEqual(arr.map((e) => [e.id, e.cx, e.cy, e.w, e.h]));
    expect(ops.relayoutSideIn([bldg], bldg, "bottom", S)).toEqual([bldg]);
  });
  it("zoneDepthOfIn prefers the stored depth, else the settings default", () => {
    expect(ops.zoneDepthOfIn({ zd: 77, w: 1, h: 1 }, bldg, "bottom", 0, S)).toBe(77);
    expect(ops.zoneDepthOfIn({ w: 1, h: 1, rot: 0 }, bldg, "bottom", 1, S)).toBeGreaterThan(0);
  });
  it("zoneSideOf names the wall a zone sits on", () => {
    const arr = ops.relayoutAllSidesIn(chainOn(), bldg, S);
    expect(ops.zoneSideOf(arr, ops.findCourtIn(arr, bldg, "bottom"))).toBe("bottom");
  });
  it("makeChainZoneIn / makeCourtZoneIn stamp the host and the settings depth", () => {
    const c = ops.makeCourtZoneIn(bldg, "top", S);
    expect(c).toMatchObject({ attachedTo: "B", type: "paving", truckCourt: { side: "top" } });
    expect(ops.makeTrailerZoneIn(bldg, c, S)).toMatchObject({ forCourt: c.id, noFit: true, type: "trailer" });
    expect(ops.makeBufferZoneIn(bldg, { id: "t" }, S)).toMatchObject({ forTrailer: "t", buffer: true });
  });
});

describe("assemblyOps — wall kids, strips and removal", () => {
  it("outwardUnit and sideOuterPerp follow the side (and the building's rotation)", () => {
    expect(ops.outwardUnit(bldg, "bottom")).toEqual({ x: 0, y: 1 });
    expect(ops.outwardUnit({ ...bldg, rot: 90 }, "bottom").x).toBeCloseTo(-1, 6);
    expect(ops.SIDE_N.left).toEqual([-1, 0]);
  });
  it("makeStrip builds a flush strip on the clicked wall and isWallStrip recognises it", () => {
    const s = ops.makeStrip(bldg, 0, 1, "sidewalk", ops.SIDEWALK_W);
    expect(ops.isWallStrip(s)).toBe(true);
    expect(s.attachedTo).toBe("B");
    expect(ops.sideOfKid(bldg, s)).toBe("bottom");
    expect(ops.isWallStrip({ type: "parking" })).toBe(false);
  });
  it("killSetWithChildren / removeWithChildren take the whole chain below a zone", () => {
    const arr = chainOn();
    const court = ops.findCourtIn(arr, bldg, "bottom");
    const kill = ops.killSetWithChildren(arr, [court.id]);
    expect(kill.size).toBeGreaterThanOrEqual(3);
    expect(ops.removeWithChildren(arr, [court.id]).map((e) => e.id)).toEqual(["B"]);
  });
  it("resyncBondedRot snaps drifted children to host.rot + their quarter-turn offset", () => {
    const list = [{ id: "H", rot: 90, cx: 0, cy: 0, w: 1, h: 1 }, { id: "k", attachedTo: "H", rot: 0.0, cx: 0, cy: 0, w: 1, h: 1 }];
    const out = ops.resyncBondedRot(list, "H");
    expect(out[1].rot % 90).toBe(0);
    expect(ops.resyncBondedRot(out, "H")[1]).toBe(out[1]);        // already in sync → same object
    expect(ops.resyncBondedRot(list, "nope")).toBe(list);
  });
  it("relayoutWallKids keeps a strip flush against its wall", () => {
    const s = ops.makeStrip(bldg, 0, 1, "sidewalk", ops.SIDEWALK_W);
    const out = ops.relayoutWallKids([bldg, { ...s, cy: s.cy + 40 }], bldg);
    const moved = out.find((e) => e.id === s.id);
    expect(moved.cy).toBeCloseTo(s.cy, 3);
  });
  it("rampsOnHost / isWallTrailer / ownedWallStrip are host-scoped predicates", () => {
    const r = { id: "r", type: "driveInRamp", attachedTo: "B" };
    expect(ops.rampsOnHost([bldg, r, { ...r, id: "r2", attachedTo: "X" }], bldg)).toEqual([r]);
    expect(ops.isWallTrailer({ type: "trailer", wallTrailer: true })).toBe(true);
    expect(ops.isWallTrailer({ type: "trailer", wallTrailer: true, points: [] })).toBe(false);
    expect(ops.ownedWallStrip(ops.makeStrip(bldg, 0, 1, "sidewalk", 5), bldg)).toBe(true);
  });
  it("refitChildrenIn keeps attached children with a resized building", () => {
    const arr = ops.relayoutAllSidesIn(chainOn(), bldg, S);
    const grown = { ...bldg, w: 500 };
    const out = ops.refitChildrenIn(arr.map((e) => (e.id === "B" ? grown : e)), "B", grown, [], {}, S);
    expect(out.find((e) => e.id === "B").w).toBe(500);
    expect(out.length).toBe(arr.length);
  });
});

describe("the component keeps thin wrappers (no second copy of the engine)", () => {
  const src = plannerSource();
  it("hands settings to the pure functions", () => {
    for (const n of ["zoneDepthOf", "relayoutSide", "relayoutAllSides", "makeCourtZone", "makeTrailerZone", "makeBufferZone", "makeChainZone", "buildNextZone", "refitChildren"])
      expect(src).toMatch(new RegExp(`const ${n} = \\([^)]*\\) => ${n}In\\(`));
  });
  it("the moved bodies are not defined in the component any more", () => {
    const comp = src.split("export default function SitePlanner")[1] || src;
    expect(comp).not.toMatch(/\n  const (relayoutWallKids|chainFromHead|courtBumpOpts|killSetWithChildren) = /);
  });
});
