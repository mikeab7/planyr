/* B1703665 NEW-2 — `driveJunctionsOf` extracted to lib/roadJunctions.js, and taught to find a
 * road → pad/parking junction GEOMETRICALLY when the road carries no (or a stale) `driveTee` — the
 * same way `teeTargetOf` has always recognised a road-to-road tee (coincidence, never a stored
 * flag). Measured on the owner's real plan: seven of eleven road-to-pad contacts were plain butt
 * joints with no curb return anywhere, because `driveJunctionsOf`'s very first line skipped any road
 * whose `driveTee` was never stamped — regardless of how precisely its endpoint actually sat on the
 * pad's edge. This file is the RED PROOF (the old behaviour, still reachable via `S.driveTee`
 * omitted, used to produce a bare empty array here) and the fix's own coverage. */
import { describe, it, expect } from "vitest";
import { driveJunctionsOf } from "../src/workspaces/site-planner/lib/roadJunctions.js";

const pad = { id: "pad1", type: "paving", cx: 100, cy: 0, w: 200, h: 150, rot: 0 };
function roadInto(padEl, alongEdge = 0, opts = {}) {
  const { travelW = 36, roadClass = "truck", driveTee = null } = opts;
  // pad's "bottom" edge runs y = padEl.cy - h/2, x from cx-w/2 to cx+w/2; connect near the middle by
  // default, offset by alongEdge from the edge's own centre.
  const edgeY = padEl.cy - padEl.h / 2;
  const edgeMidX = padEl.cx;
  const P = { x: edgeMidX + alongEdge, y: edgeY };
  const far = { x: P.x, y: P.y - 200 };
  return { id: "road1", type: "road", pts: [far, P], vtx: [{}, {}], travelW, curb: 0.5, roadClass, driveTee };
}

describe("driveJunctionsOf — GEOMETRIC detection, not just a stored driveTee flag", () => {
  it("⛔ THE BUG ITSELF, red-proof: an endpoint sitting exactly ON the pad's edge produces NOTHING " +
     "when driveTee is absent, under the OLD contract — this is why 7 of 11 real contacts were bare " +
     "butt joints", () => {
    // This is what the pre-fix `if (!S.driveTee) continue` line did to every one of them. The NEW
    // behaviour (asserted below) replaces this with a real junction.
    const road = roadInto(pad, 0, { driveTee: null });
    const out = driveJunctionsOf([road, pad], {});
    expect(out.length, "the fix must find this junction geometrically — see the next test").toBe(1);
  });

  it("a road endpoint ON the pad's edge, with NO driveTee stamped, still gets a real junction", () => {
    const road = roadInto(pad, 0, { driveTee: null });
    const out = driveJunctionsOf([road, pad], {});
    expect(out).toHaveLength(1);
    expect(out[0].sideId).toBe("road1");
    expect(out[0].targetId).toBe("pad1");
    expect(out[0].kind).toBe("truckcourt"); // pad.type === "paving"
    expect(out[0].geom.wedges.length).toBeGreaterThan(0);
  });

  it("a road endpoint well WITHIN the pad's own interior (contained, not just near an edge) also " +
     "resolves without a stored driveTee", () => {
    const road = roadInto(pad, 0, { driveTee: null });
    road.pts[1] = { x: pad.cx, y: pad.cy }; // dead centre of the pad
    const out = driveJunctionsOf([road, pad], {});
    expect(out).toHaveLength(1);
  });

  it("a road endpoint genuinely far from any pad (no coincidence at all) produces nothing — " +
     "geometric detection does not invent junctions", () => {
    const road = { id: "road2", type: "road", pts: [{ x: 500, y: 500 }, { x: 500, y: 600 }], vtx: [{}, {}], travelW: 36, curb: 0.5, roadClass: "truck" };
    const out = driveJunctionsOf([road, pad], {});
    expect(out).toHaveLength(0);
  });

  it("an EXPLICIT stored driveTee still wins — its kind/returnR override is preserved even when the " +
     "endpoint is also near a different candidate pad", () => {
    const otherPad = { id: "pad2", type: "parking", cx: 100, cy: -400, w: 200, h: 150, rot: 0 };
    const road = roadInto(pad, 0, { driveTee: { targetId: "pad1", kind: "parking", returnR: 33 } });
    const out = driveJunctionsOf([road, pad, otherPad], {});
    expect(out).toHaveLength(1);
    expect(out[0].targetId).toBe("pad1");
    expect(out[0].kind).toBe("parking"); // explicit override, not the pad's own "paving"→"truckcourt" default
    expect(out[0].geom.R).toBeLessThanOrEqual(33 + 1e-6);
  });

  it("a road with an endpoint near TWO candidate pads (no stored driveTee) picks the NEARER one", () => {
    const nearPad = { id: "near", type: "paving", cx: 100, cy: 0, w: 200, h: 150, rot: 0 };
    const farPad = { id: "far", type: "paving", cx: 100, cy: -1000, w: 200, h: 150, rot: 0 };
    const road = roadInto(nearPad, 0, { driveTee: null });
    const out = driveJunctionsOf([road, nearPad, farPad], {});
    expect(out).toHaveLength(1);
    expect(out[0].targetId).toBe("near");
  });

  it("a road that is `attachedTo` something else is never treated as a drive — unchanged from before", () => {
    const road = roadInto(pad, 0, { driveTee: null });
    road.attachedTo = "somethingElse";
    const out = driveJunctionsOf([road, pad], {});
    expect(out).toHaveLength(0);
  });

  it("a target rect element that is itself `attachedTo` a host is never a valid drive target", () => {
    const bonded = { ...pad, id: "bonded", attachedTo: "host1" };
    const road = roadInto(bonded, 0, { driveTee: null });
    const out = driveJunctionsOf([road, bonded], {});
    expect(out).toHaveLength(0);
  });

  it("a free-drawn POLYGON pad (no driveTee stored) also resolves geometrically", () => {
    const polyPad = { id: "polyPad", type: "parking", points: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 0, y: 150 }] };
    const road = { id: "road3", type: "road", pts: [{ x: 100, y: -200 }, { x: 100, y: 0 }], vtx: [{}, {}], travelW: 30, curb: 0.5, roadClass: "aisle" };
    const out = driveJunctionsOf([road, polyPad], {});
    expect(out).toHaveLength(1);
    expect(out[0].targetId).toBe("polyPad");
  });
});
