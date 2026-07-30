/* NEW-6 — the user overrides which boundary is Front, Side and Rear.
 *
 * The app derives the role from frontage geometry (`autoAssignRoles`). That is a good default and
 * it is frequently wrong in the real world — a corner lot, a flag lot, a double-frontage lot, or
 * simply a reviewer who reads the plat differently (owner, 2026-07-30: "what if their
 * interpretation of the setbacks is different from your interpretation… we should be able to edit
 * which one is the rear setback and which one is the side setback, just in case"). Being wrong
 * changes the required dimension, so the correction has to stick.
 *
 * The model is the repo's derive-by-default / preserve-once-touched pattern: a SPARSE override
 * vector, `null` where the run still tracks the inference. These tests pin the four guarantees the
 * owner asked for — the override survives a re-derive, a reshape and a reload; clearing restores
 * the inference; and the role's required-value lookup follows the override.
 */
import { describe, it, expect } from "vitest";
import {
  autoAssignRoles, resolveRoles, resolveOverrides, roleRuns, runRole, runOverridden,
  setRunOverride, hasRoleOverrides, shiftOverridesOnInsert, shiftOverridesOnDelete, roleGroups,
} from "../src/workspaces/site-planner/lib/setbackRoles.js";
import { setbackChipRuns } from "../src/workspaces/site-planner/lib/setbackChips.js";
import weld from "./fixtures/weldParcelProduction.json" with { type: "json" };

// A plain interior lot: the long south line (y = 0) is the app's inferred FRONT.
const rect = (w = 600, h = 300) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
const uniform = (pts, v) => pts.map(() => v);

// The run whose anchor edge midpoint is nearest (x, y).
const runNear = (runs, points, x, y) => {
  let best = null, bd = Infinity;
  for (const r of runs) {
    const a = points[r.anchorEdge], b = points[(r.anchorEdge + 1) % points.length];
    const d = Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y);
    if (d < bd) { bd = d; best = r; }
  }
  return best;
};

// One round-trip through JSON — a parcel is persisted as its own object (site_elements.data), so
// this is exactly what a save + reload does to the override vector.
const reload = (v) => JSON.parse(JSON.stringify(v));

describe("resolveOverrides — sparse by default", () => {
  it("no override means every run keeps tracking the inference", () => {
    const p = rect();
    expect(resolveOverrides(p, {})).toEqual([null, null, null, null]);
    expect(resolveRoles(p, null, {})).toEqual(autoAssignRoles(p));
  });

  it("an override vector is honoured only where it names a real role", () => {
    const p = rect();
    const ov = [null, "rear", "bogus", null];
    expect(resolveOverrides(p, { overrides: ov })).toEqual([null, "rear", null, null]);
  });

  it("a MISALIGNED vector is ignored rather than shifting every label by one edge", () => {
    const p = rect();
    expect(resolveOverrides(p, { overrides: ["rear", "front"] })).toEqual([null, null, null, null]);
  });

  /* Legacy migration: the shipped model stored a DENSE `pc.roles` array, so correcting ONE side
   * stamped every other side with whatever was inferred at that moment — freezing fourteen
   * untouched sides against every later re-derivation. Reading it back narrows it to the entries
   * that genuinely differ from the inference, which changes nothing on screen. */
  it("a legacy dense vector narrows to the user's genuine corrections, and renders identically", () => {
    const p = rect();
    const auto = autoAssignRoles(p);
    const legacy = auto.slice();
    legacy[2] = auto[2] === "rear" ? "side" : "rear";        // one real correction
    const ov = resolveOverrides(p, { legacy });
    expect(ov.filter(Boolean)).toHaveLength(1);
    expect(ov[2]).toBe(legacy[2]);
    expect(resolveRoles(p, legacy, {})).toEqual(legacy);      // …and nothing on screen moves
  });
});

describe("setRunOverride — set, keep, and clear", () => {
  it("sets every edge of the run and leaves the other runs tracking the inference", () => {
    const p = weld.points;
    const runs = roleRuns(p);
    const target = runs[3];
    const next = setRunOverride(new Array(p.length).fill(null), target, "rear", p.length);
    expect(next).toHaveLength(p.length);
    for (const e of target.edges) expect(next[e]).toBe("rear");
    expect(next.filter(Boolean)).toHaveLength(target.edges.length);
    expect(runOverridden(target, next)).toBe(true);
    expect(runs.filter((r) => r !== target).every((r) => !runOverridden(r, next))).toBe(true);
  });

  it("clearing a run restores the inference for that run only", () => {
    const p = rect();
    const runs = roleRuns(p);
    const south = runNear(runs, p, 300, 0), north = runNear(runs, p, 300, 300);
    let ov = setRunOverride(new Array(p.length).fill(null), south, "rear", p.length);
    ov = setRunOverride(ov, north, "front", p.length);
    expect(hasRoleOverrides(ov)).toBe(true);

    ov = setRunOverride(ov, south, null, p.length);
    expect(runOverridden(south, ov)).toBe(false);
    expect(runOverridden(north, ov)).toBe(true);
    // The cleared side is back on the app's own reading…
    expect(runRole(south, resolveRoles(p, null, { overrides: ov }))).toBe(runRole(south, autoAssignRoles(p)));
    // …and clearing the last one takes the whole parcel back to automatic.
    ov = setRunOverride(ov, north, null, p.length);
    expect(hasRoleOverrides(ov)).toBe(false);
    expect(resolveRoles(p, null, { overrides: ov })).toEqual(autoAssignRoles(p));
  });

  it("never mutates the vector it was given", () => {
    const p = rect();
    const ov = new Array(p.length).fill(null);
    setRunOverride(ov, roleRuns(p)[0], "rear", p.length);
    expect(ov).toEqual([null, null, null, null]);
  });
});

describe("an override survives a re-derive, a reshape and a reload", () => {
  const p = rect();
  const runs = roleRuns(p);
  const south = runNear(runs, p, 300, 0);       // the app's inferred FRONT
  const ov = setRunOverride(new Array(p.length).fill(null), south, "rear", p.length);

  it("survives repeated RE-DERIVATION (the roles are recomputed on every render)", () => {
    expect(runRole(south, autoAssignRoles(p))).toBe("front");
    for (let i = 0; i < 5; i++) {
      expect(runRole(south, resolveRoles(p, null, { overrides: ov }))).toBe("rear");
    }
  });

  it("survives a RESHAPE that drags a corner (the ring length is unchanged)", () => {
    const moved = p.map((q, i) => (i === 2 ? { x: q.x + 40, y: q.y + 25 } : q));
    const roles = resolveRoles(moved, null, { overrides: ov });
    const movedRuns = roleRuns(moved);
    expect(runRole(runNear(movedRuns, moved, 300, 0), roles)).toBe("rear");
  });

  it("survives a RESHAPE that inserts a control point — the split keeps both halves", () => {
    const edgeIndex = south.anchorEdge;
    const pts = p.slice(); pts.splice(edgeIndex + 1, 0, { x: 300, y: -5 });
    const next = shiftOverridesOnInsert(ov, edgeIndex);
    expect(next).toHaveLength(pts.length);
    expect(next[edgeIndex]).toBe("rear");
    expect(next[edgeIndex + 1]).toBe("rear");
    // Every edge that was NOT part of the override is still tracking the inference.
    expect(next.filter(Boolean)).toHaveLength(2);
    const roles = resolveRoles(pts, null, { overrides: next });
    expect(roles[edgeIndex]).toBe("rear");
    expect(roles[edgeIndex + 1]).toBe("rear");
  });

  it("survives a RESHAPE that deletes a control point — the merged edge keeps its role", () => {
    // Override the WEST side (edges 3 on this ring), then delete vertex 1 (a corner of the south
    // side) — the west override must neither vanish nor slide onto the wrong edge.
    const west = runNear(runs, p, 0, 150);
    const wov = setRunOverride(new Array(p.length).fill(null), west, "street", p.length);
    const idx = wov.findIndex(Boolean);
    const pts = p.filter((_, j) => j !== 1);
    const next = shiftOverridesOnDelete(wov, 1);
    expect(next).toHaveLength(pts.length);
    expect(next.filter(Boolean)).toHaveLength(1);
    expect(next[idx - 1]).toBe("street");           // shifted down with its own edge
    expect(resolveRoles(pts, null, { overrides: next })[idx - 1]).toBe("street");
  });

  it("survives a RELOAD (it is plain JSON on the parcel)", () => {
    const back = reload({ points: p, roleOverrides: ov });
    expect(runRole(south, resolveRoles(back.points, null, { overrides: back.roleOverrides }))).toBe("rear");
  });
});

describe("the required-value lookup follows the override", () => {
  /* A role is a LABEL, never an input to a measurement — nothing here writes a setback VALUE. What
   * it DOES drive is which ordinance row a side belongs to, i.e. which edges the Front / Side /
   * Street side / Rear input writes when the user types the jurisdiction's required number. So
   * re-roling a side must move it, and its value, into the other row. */
  const p = rect();
  const sb = uniform(p, 25);

  it("moves the side's edges into the new role's row, and its value with them", () => {
    const runs = setbackChipRuns(p, sb);
    const south = runNear(runs, p, 300, 0);
    const before = roleGroups(runs, resolveRoles(p, null, {}), sb);
    expect(before.find((g) => g.role === "front").edges).toEqual(expect.arrayContaining(south.edges));

    const ov = setRunOverride(new Array(p.length).fill(null), south, "rear", p.length);
    const after = roleGroups(runs, resolveRoles(p, null, { overrides: ov }), sb);
    const rear = after.find((g) => g.role === "rear"), front = after.find((g) => g.role === "front");
    expect(rear.edges).toEqual(expect.arrayContaining(south.edges));
    expect(front.edges).not.toEqual(expect.arrayContaining(south.edges));
    expect(rear.value).toBe(25);
  });

  it("typing the role's required value then writes exactly the overridden side's edges", () => {
    const runs = setbackChipRuns(p, sb);
    const south = runNear(runs, p, 300, 0);
    const ov = setRunOverride(new Array(p.length).fill(null), south, "rear", p.length);
    const groups = roleGroups(runs, resolveRoles(p, null, { overrides: ov }), sb);
    const rearEdges = groups.find((g) => g.role === "rear").edges;

    // The same write `setRoleSetback` performs in the panel.
    const next = sb.slice();
    rearEdges.forEach((i) => { next[i] = 40; });
    south.edges.forEach((i) => expect(next[i]).toBe(40));
    expect(next.filter((v) => v === 40)).toHaveLength(rearEdges.length);
  });

  it("the four rows still partition the boundary exactly once after an override", () => {
    const runs = setbackChipRuns(weld.points, uniform(weld.points, 25));
    const ov = setRunOverride(new Array(weld.points.length).fill(null), runs[2], "street", weld.points.length);
    const groups = roleGroups(runs, resolveRoles(weld.points, null, { overrides: ov }), uniform(weld.points, 25));
    const edges = groups.flatMap((g) => g.edges).sort((a, b) => a - b);
    expect(edges).toEqual(Array.from({ length: weld.points.length }, (_, i) => i));
  });
});
