import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { hostIdMap } from "../src/workspaces/site-planner/lib/gradingBase.js";
import { hostBuildingIdOf, isPadMember, assemblyIds } from "../src/workspaces/site-planner/lib/gradingMembership.js";
import { withFfe } from "../src/workspaces/site-planner/lib/buildingGrade.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const els = [
  { id: "b1", type: "building", ring: rect(0, 0, 1000, 500) },
  { id: "d1", type: "building", attachedTo: "b1", dogEar: { side: "s", sign: 1 }, noLabel: true, ring: rect(0, 500, 55, 60), padElevFt: 31.8 },
  { id: "d2", type: "building", attachedTo: "b1", dogEar: { side: "s", sign: -1 }, noLabel: true, ring: rect(945, 500, 55, 60) },
  { id: "c1", type: "paving", attachedTo: "b1", ring: rect(0, 560, 1000, 185) },
  { id: "b2", type: "building", ring: rect(2000, 0, 400, 300) },
];
const byId = new Map(els.map((e) => [e.id, e]));

describe("bump-outs are pad members of their host (NEW-1)", () => {
  it("hostBuildingIdOf(dogEar) is the host; a real building is its own host", () => {
    expect(hostBuildingIdOf(byId.get("d1"), byId)).toBe("b1");
    expect(hostBuildingIdOf(byId.get("b1"), byId)).toBe("b1");
    expect(hostBuildingIdOf(byId.get("c1"), byId)).toBe("b1");
  });
  it("isPadMember: dog-ears yes, buildings no, an orphan dog-ear stays a building", () => {
    expect(isPadMember(byId.get("d1"), byId)).toBe(true);
    expect(isPadMember(byId.get("b1"), byId)).toBe(false);
    const orphan = { id: "o", type: "building", attachedTo: "gone", dogEar: {}, ring: rect(0, 0, 5, 5) };
    expect(isPadMember(orphan, new Map([["o", orphan]]))).toBe(false);
  });
  it("hostIdMap hosts both dog-ears; the assembly holds both; one graded building per host", () => {
    const m = hostIdMap(els);
    expect(m.get("d1")).toBe("b1"); expect(m.get("d2")).toBe("b1"); expect(m.has("b1")).toBe(false); expect(m.has("b2")).toBe(false);
    const gs = els.map((e) => (m.has(e.id) ? { ...e, hostId: m.get(e.id) } : e));
    expect([...assemblyIds(gs, "b1")].sort()).toEqual(["b1", "c1", "d1", "d2"]);
    expect(gs.filter((e) => e.type === "building" && !m.has(e.id)).map((e) => e.id)).toEqual(["b1", "b2"]);
  });
  it("withFfe sets the host's finish on its bump-outs too, and leaves other buildings alone", () => {
    const m = hostIdMap(els);
    const gs = els.map((e) => (m.has(e.id) ? { ...e, hostId: m.get(e.id) } : e));
    const out = withFfe(gs, "b1", 33.3);
    expect(["b1", "d1", "d2"].map((id) => out.find((e) => e.id === id).padElevFt)).toEqual([33.3, 33.3, 33.3]);
    expect(out.find((e) => e.id === "b2").padElevFt).toBeUndefined();
    expect(out.find((e) => e.id === "c1").padElevFt).toBeUndefined();
  });
  it("planner wiring: gsEls gives bump-outs the host's finish and the panel/selection use hosts only", () => {
    const sp = readFileSync("src/workspaces/site-planner/SitePlanner.jsx", "utf8");
    expect(sp).toMatch(/grBuildingsAll = grOn \? els\.filter\(\(e\) => e\.type === "building" && !grHosts\.has\(e\.id\)\)/);
    expect(sp).toMatch(/\.type === "building" \? grHosts\.get\(r\.id\) \?\? r\.id/);
    expect(sp).toMatch(/const fs = grOn && e\.type === "building" && grHosts\.get\(e\.id\)/);
    const gc = readFileSync("src/workspaces/site-planner/components/GradingController.jsx", "utf8");
    expect(gc).toMatch(/e\.type === "building" && !e\.hostId/);
  });
});
