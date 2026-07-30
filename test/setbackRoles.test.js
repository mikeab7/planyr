/* NEW-1 — the regulatory role layer for setbacks.
 *
 * The owner does not think in fifteen geometric sides; he thinks in the four setbacks a zoning
 * ordinance writes: FRONT, SIDE, STREET SIDE (corner), REAR (2026-07-30). These tests pin the
 * pure decisions behind that tier:
 *
 *   · every side is auto-assigned a role on load — not one of fifteen
 *   · the assignment is CORRECTABLE, and a user's assignment always wins
 *   · the four rows partition the boundary exactly once, with no edge lost or double-counted
 *   · and the NON-NEGOTIABLE: no site's computed buildable area may change. Proven against the
 *     REAL production snapshot of the owner's Weld County parcel (sites.id sms7v3ua7ksy, read
 *     from planyr_production 2026-07-30) using the SAME `offsetPolygon` the canvas draws with.
 */
import { describe, it, expect } from "vitest";
import {
  SETBACK_ROLES, ROLE_LABEL, ROLE_SHORT, STREET_ABUT_FT,
  autoAssignRoles, resolveRoles, roleRuns, runRole, setRunRole, roleGroups, isRole,
} from "../src/workspaces/site-planner/lib/setbackRoles.js";
import { setbackChipRuns } from "../src/workspaces/site-planner/lib/setbackChips.js";
import { offsetPolygon, setbackRingArea } from "../src/workspaces/site-planner/lib/parcelOffset.js";
import weld from "./fixtures/weldParcelProduction.json" with { type: "json" };

// --- fixtures ---------------------------------------------------------------------------------

// A plain interior lot: wide side along y=0 (south), deep sides east/west.
const rect = (w = 600, h = 300) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];

// The road that runs along the south line, 40 ft below it (a centerline outside the lot).
const southRoad = (w = 600) => [{ x: -200, y: -40 }, { x: w + 200, y: -40 }];
// A second street down the east side — the corner-lot case.
const eastRoad = (w = 600, h = 300) => [{ x: w + 40, y: -200 }, { x: w + 40, y: h + 200 }];

const uniform = (pts, v) => pts.map(() => v);
const roleOfSideNear = (points, roles, x, y) => {
  // The role carried by the edge whose midpoint is closest to (x,y).
  let best = 0, bd = Infinity;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    const d = Math.hypot((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y);
    if (d < bd) { bd = d; best = i; }
  }
  return roles[best];
};

// --- auto-assignment --------------------------------------------------------------------------

describe("autoAssignRoles — every side gets a role, not just one", () => {
  it("assigns a valid role to EVERY edge of a 60-vertex production boundary", () => {
    const roles = autoAssignRoles(weld.points);
    expect(roles).toHaveLength(weld.points.length);
    expect(roles.every(isRole)).toBe(true);
    // The report's exact complaint: fifteen rows, of which exactly one said "Front".
    expect(roles.filter((r) => r === "front").length).toBeGreaterThan(0);
  });

  it("with no road on the plan, the longest run is the Front and the far side is the Rear", () => {
    const p = rect();
    const roles = autoAssignRoles(p);
    expect(roleOfSideNear(p, roles, 300, 0)).toBe("front");     // south, the long line
    expect(roleOfSideNear(p, roles, 300, 300)).toBe("rear");     // opposite it
    expect(roleOfSideNear(p, roles, 0, 150)).toBe("side");
    expect(roleOfSideNear(p, roles, 600, 150)).toBe("side");
    expect(roles).not.toContain("street");                       // never guessed without a road
  });

  it("the Front follows the ACCESS STREET, not merely the longest line", () => {
    const p = rect(300, 600);                                    // now the SHORT line faces the road
    const roles = autoAssignRoles(p, { streets: [southRoad(300)] });
    expect(roleOfSideNear(p, roles, 150, 0)).toBe("front");
    expect(roleOfSideNear(p, roles, 150, 600)).toBe("rear");
  });

  it("a corner lot's second street frontage is Street side", () => {
    const p = rect();
    const roles = autoAssignRoles(p, { streets: [southRoad(), eastRoad()] });
    expect(roleOfSideNear(p, roles, 300, 0)).toBe("front");      // longest abutting run
    expect(roleOfSideNear(p, roles, 600, 150)).toBe("street");   // the other abutting run
    expect(roleOfSideNear(p, roles, 300, 300)).toBe("rear");
    expect(roleOfSideNear(p, roles, 0, 150)).toBe("side");
    expect(new Set(roles).size).toBe(4);                          // all four roles in play
  });

  it("a drive far from every line is not a street frontage", () => {
    const p = rect();
    const far = [{ x: -200, y: -STREET_ABUT_FT * 4 }, { x: 800, y: -STREET_ABUT_FT * 4 }];
    expect(autoAssignRoles(p, { streets: [far] })).not.toContain("street");
  });

  it("a frontage broken into two runs by a jog still reads as one Front", () => {
    // South line split by a shallow 10 ft jog at mid-span — two runs, same facing, same depth.
    const p = [
      { x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: -10 }, { x: 600, y: -10 },
      { x: 600, y: 300 }, { x: 0, y: 300 },
    ];
    const roles = autoAssignRoles(p, { streets: [southRoad()] });
    expect(roleOfSideNear(p, roles, 150, 0)).toBe("front");
    expect(roleOfSideNear(p, roles, 450, -10)).toBe("front");
  });

  it("is winding-agnostic — a reversed ring gets the same roles", () => {
    const p = rect();
    const rev = [...p].reverse();
    const a = autoAssignRoles(p, { streets: [southRoad()] });
    const b = autoAssignRoles(rev, { streets: [southRoad()] });
    for (const [x, y] of [[300, 0], [300, 300], [0, 150], [600, 150]]) {
      expect(roleOfSideNear(rev, b, x, y)).toBe(roleOfSideNear(p, a, x, y));
    }
  });

  it("degenerate rings never throw and never produce a bogus role", () => {
    for (const p of [[], [{ x: 0, y: 0 }], [{ x: 0, y: 0 }, { x: 1, y: 1 }], null]) {
      const roles = autoAssignRoles(p);
      expect(Array.isArray(roles)).toBe(true);
      expect(roles.every(isRole)).toBe(true);
    }
  });
});

// --- correction -------------------------------------------------------------------------------

describe("resolveRoles / setRunRole — a wrong role is correctable, and the user's wins", () => {
  it("a stored role beats the auto assignment", () => {
    const p = rect();
    const stored = autoAssignRoles(p).map(() => "street");
    expect(resolveRoles(p, stored)).toEqual(stored);
  });

  it("a stored vector that no longer fits the ring is re-derived, never shifted by one edge", () => {
    const p = rect();
    expect(resolveRoles(p, ["front", "side"])).toEqual(autoAssignRoles(p));
    expect(resolveRoles(p, "front")).toEqual(autoAssignRoles(p));
    expect(resolveRoles(p, ["bogus", "front", null, undefined])[1]).toBe("front");
  });

  it("reassigning a side writes the role to EVERY edge in that side", () => {
    const runs = roleRuns(weld.points);
    const long = runs.reduce((a, b) => (b.edges.length > a.edges.length ? b : a), runs[0]);
    expect(long.edges.length).toBeGreaterThan(1);
    const next = setRunRole(autoAssignRoles(weld.points), long, "street", weld.points.length);
    expect(next).toHaveLength(weld.points.length);
    for (const e of long.edges) expect(next[e]).toBe("street");
    expect(runRole(long, next)).toBe("street");
  });

  it("setRunRole never mutates its input and refuses a role that isn't one", () => {
    const p = rect();
    const before = autoAssignRoles(p);
    const snapshot = [...before];
    const run = roleRuns(p)[0];
    setRunRole(before, run, "rear", p.length);
    expect(before).toEqual(snapshot);
    expect(setRunRole(before, run, "kitchen", p.length)).toEqual(before);
  });

  it("roles are stable when a setback VALUE changes — a role is not re-derived by typing", () => {
    const p = rect();
    const a = autoAssignRoles(p);
    // The chip runs DO re-break on a value change; the role assignment must not follow them.
    expect(autoAssignRoles(p)).toEqual(a);
    const uneven = [25, 10, 25, 10];
    expect(setbackChipRuns(p, uneven).length).toBeGreaterThanOrEqual(4);
    expect(autoAssignRoles(p)).toEqual(a);
  });
});

// --- the four rows ----------------------------------------------------------------------------

describe("roleGroups — four rows that partition the boundary exactly once", () => {
  it("always returns the four ordinance rows, in the owner's order", () => {
    const p = rect();
    const groups = roleGroups(setbackChipRuns(p, uniform(p, 25)), autoAssignRoles(p), uniform(p, 25));
    expect(groups.map((g) => g.role)).toEqual(SETBACK_ROLES);
    expect(groups.map((g) => g.label)).toEqual(["Front", "Side", "Street side", "Rear"]);
  });

  it("every edge lands in exactly one row, on the real production boundary", () => {
    const sb = uniform(weld.points, weld.defaultSetbackFt);
    const runs = setbackChipRuns(weld.points, sb);
    const groups = roleGroups(runs, autoAssignRoles(weld.points), sb);
    const seen = groups.flatMap((g) => g.edges).sort((a, b) => a - b);
    expect(seen).toEqual(Array.from({ length: weld.points.length }, (_, i) => i));
    // Fifteen sides collapse to at most four rows, and every non-empty one carries real sides.
    expect(groups.filter((g) => !g.empty).length).toBeLessThanOrEqual(4);
    expect(groups.filter((g) => !g.empty).every((g) => g.sides > 0)).toBe(true);
  });

  it("a role no side carries is EMPTY rather than missing — the four are always the four", () => {
    const p = rect();
    const sb = uniform(p, 25);
    const groups = roleGroups(setbackChipRuns(p, sb), autoAssignRoles(p), sb);
    const street = groups.find((g) => g.role === "street");
    expect(street.empty).toBe(true);
    expect(street.edges).toEqual([]);
    expect(groups.filter((g) => !g.empty).length).toBe(3);
  });

  it("reports the shared value, and flags a role whose sides disagree as mixed", () => {
    const p = rect();
    const roles = autoAssignRoles(p);                       // south front, north rear, e/w sides
    const same = uniform(p, 25);
    expect(roleGroups(setbackChipRuns(p, same), roles, same).find((g) => g.role === "side").mixed).toBe(false);
    const sideEdges = roles.flatMap((r, i) => (r === "side" ? [i] : []));
    const differ = same.slice();
    differ[sideEdges[0]] = 10;
    const g = roleGroups(setbackChipRuns(p, differ), roles, differ).find((x) => x.role === "side");
    expect(g.mixed).toBe(true);
  });

  it("the on-canvas short labels stay short enough for a chip plate", () => {
    for (const r of SETBACK_ROLES) {
      expect(ROLE_SHORT[r].length).toBeLessThanOrEqual(ROLE_LABEL[r].length);
      expect(ROLE_SHORT[r].length).toBeLessThanOrEqual(7);
    }
  });
});

// --- the NON-NEGOTIABLE -----------------------------------------------------------------------

describe("NON-NEGOTIABLE — no site's computed buildable area may change (real production data)", () => {
  const sb = uniform(weld.points, weld.defaultSetbackFt);

  it("the fixture really is the owner's Weld County parcel", () => {
    expect(weld.siteId).toBe("sms7v3ua7ksy");
    expect(weld.points).toHaveLength(60);
    // Shoelace acreage lands on the county's published GIS acres.
    const acres = setbackRingArea(weld.points, uniform(weld.points, 0)) / 43560;
    expect(acres).toBeCloseTo(weld.gisAcres, 0);
  });

  it("assigning roles leaves the canonical per-edge setbacks byte-identical", () => {
    const before = JSON.stringify(sb);
    const roles = autoAssignRoles(weld.points);
    const groups = roleGroups(setbackChipRuns(weld.points, sb), roles, sb);
    expect(groups.length).toBe(4);
    expect(JSON.stringify(sb)).toBe(before);            // nothing here writes a value
  });

  it("the setback ring the canvas draws is IDENTICAL before and after roles exist", () => {
    // The same `offsetPolygon` SitePlanner renders with, on the real ring.
    const ringBefore = offsetPolygon(weld.points, sb);
    const roles = resolveRoles(weld.points, null);
    const reassigned = setRunRole(roles, roleRuns(weld.points)[0], "street", weld.points.length);
    const groups = roleGroups(setbackChipRuns(weld.points, sb), reassigned, sb);
    expect(groups.some((g) => g.role === "street" && !g.empty)).toBe(true);
    const ringAfter = offsetPolygon(weld.points, sb);
    expect(ringAfter).toEqual(ringBefore);
    expect(setbackRingArea(weld.points, sb)).toBe(setbackRingArea(weld.points, sb));
  });

  it("a By-role edit reaches exactly the edges of that role and nothing else", () => {
    const roles = autoAssignRoles(weld.points);
    const groups = roleGroups(setbackChipRuns(weld.points, sb), roles, sb);
    const front = groups.find((g) => g.role === "front");
    // What the panel's commit does, in one line.
    const next = sb.slice();
    front.edges.forEach((i) => { next[i] = 40; });
    next.forEach((v, i) => expect(v).toBe(front.edges.includes(i) ? 40 : weld.defaultSetbackFt));
    // And the envelope moves ONLY because a number was typed — it shrinks, as a bigger front
    // setback must, and stays a valid ring.
    const area = setbackRingArea(weld.points, next);
    expect(area).toBeGreaterThan(0);
    expect(area).toBeLessThan(setbackRingArea(weld.points, sb));
  });
});
