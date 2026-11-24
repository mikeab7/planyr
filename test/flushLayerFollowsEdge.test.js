/* B2671304 (×2) — a wall's landscape BUFFER (and a road / wall trailer row beyond it) is bonded to the EDGE of what is
 * inboard of it, BOTH ways. Owner report 2026-11-24: "pushing out or expanding the building will move the buffer out,
 * but then shrinking the building doesn't bring it back." The cause was a one-directional clamp in
 * `wallStripBoxFor` ("pushed out … never pulled in"); the first fix (PR 3006) only repacked on a parking cfg edit.
 * Every case here is grow THEN shrink, so a push-only rule fails the shrink half. */
import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS } from "../src/workspaces/site-planner/lib/plannerConstants.js";
import * as ops from "../src/workspaces/site-planner/lib/assemblyOps.js";
import { repackFlushLayers } from "../src/workspaces/site-planner/lib/dogEar.js";
import { normalizeBondedChildren } from "../src/workspaces/site-planner/lib/siteModel.js";

const S = DEFAULT_SETTINGS;
const SIDES = ["left", "right", "top", "bottom"];
const N = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
const rot2 = (x, y, deg) => { const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); return { x: x * c - y * s, y: x * s + y * c }; };
const isV = (s) => s === "left" || s === "right";

// A child of depth `d` whose inner face sits `inner` ft out from the host centre on `side` (host-local), full wall run.
const kidOn = (b, side, id, type, d, inner, extra = {}) => {
  const [nx, ny] = N[side];
  const perp = inner + d / 2, run = isV(side) ? b.h : b.w;
  const l = isV(side) ? { x: nx * perp, y: 0 } : { x: 0, y: ny * perp };
  const o = rot2(l.x, l.y, b.rot);
  return { id, type, attachedTo: b.id, rot: b.rot, cx: b.cx + o.x, cy: b.cy + o.y, w: isV(side) ? d : run, h: isV(side) ? run : d, ...extra };
};
// Inner / outer face of a child on `side`, host-local, measured outward from the host centre.
const faces = (b, side, k) => {
  const [nx, ny] = N[side];
  const l = rot2(k.cx - b.cx, k.cy - b.cy, -b.rot);
  const perp = isV(side) ? nx * l.x : ny * l.y, d = isV(side) ? k.w : k.h;
  return { inner: perp - d / 2, outer: perp + d / 2 };
};
const wallFace = (b, side) => (isV(side) ? b.w : b.h) / 2;

// Grow or shrink the building on ONE side (the opposite edge held still), the way an edge drag / typed dimension does.
const resizeOn = (b, side, delta) => {
  const [nx, ny] = N[side];
  const o = rot2((nx * delta) / 2, (ny * delta) / 2, b.rot);
  return { ...b, cx: b.cx + o.x, cy: b.cy + o.y, w: b.w + (isV(side) ? delta : 0), h: b.h + (isV(side) ? 0 : delta) };
};
const refit = (arr, nb) => ops.refitChildrenIn(arr.map((e) => (e.id === nb.id ? nb : e)), nb.id, nb, [], {}, S);

const scene = (rot, side, { parking = true, road = false } = {}) => {
  const b = { id: "B", type: "building", cx: 1000, cy: -400, w: 400, h: 220, rot };
  const els = [b, kidOn(b, side, "sw", "sidewalk", 5, wallFace(b, side), { sidewalkSide: side })];
  let reach = wallFace(b, side) + 5;
  if (parking) { els.push(kidOn(b, side, "pk", "parking", 64, reach, { sideParkSide: side })); reach += 64; }
  els.push(kidOn(b, side, "buf", "landscape", 10, reach));
  if (road) els.push(kidOn(b, side, "rd", "road", 26, reach + 10));
  return els;
};
// Every flush layer starts exactly where the layer inboard of it ends (no gap, no overlap).
const expectFlush = (arr, side, { parking = true, road = false } = {}) => {
  const b = arr.find((e) => e.id === "B"), by = (id) => arr.find((e) => e.id === id);
  const sw = faces(b, side, by("sw"));
  expect(sw.inner).toBeCloseTo(wallFace(b, side), 6);
  const inboard = parking ? faces(b, side, by("pk")).outer : sw.outer;
  if (parking) expect(faces(b, side, by("pk")).inner).toBeCloseTo(sw.outer, 6);
  const buf = faces(b, side, by("buf"));
  expect(buf.inner).toBeCloseTo(inboard, 6);
  if (road) expect(faces(b, side, by("rd")).inner).toBeCloseTo(buf.outer, 6);
};

describe("B2671304 (×2) — the buffer follows its edge both ways on a building resize", () => {
  for (const rot of [0, 33, 90, 180, 247])
    for (const side of SIDES)
      for (const cfg of [{ parking: true }, { parking: false }, { parking: true, road: true }])
        it(`rot ${rot} · ${side} wall · ${cfg.parking ? "with" : "without"} parking${cfg.road ? " + road" : ""}: grow, then shrink`, () => {
          let arr = scene(rot, side, cfg);
          const b0 = arr[0];
          // Grow the building out on THIS wall (pushes everything out), then shrink it past where it started.
          arr = refit(arr, resizeOn(b0, side, 60));
          expectFlush(arr, side, cfg);
          arr = refit(arr, resizeOn(arr[0], side, -110));
          expectFlush(arr, side, cfg);
          // Grow / shrink on the OPPOSITE wall too (moves the host centre, not this wall).
          const opp = { left: "right", right: "left", top: "bottom", bottom: "top" }[side];
          arr = refit(arr, resizeOn(arr[0], opp, 80));
          expectFlush(arr, side, cfg);
          arr = refit(arr, resizeOn(arr[0], opp, -80));
          expectFlush(arr, side, cfg);
        });
});

describe("B2671304 (×2) — a buffer left out in space by an earlier shrink snaps back", () => {
  const detached = (rot, side) => {
    const arr = scene(rot, side);
    return arr.map((e) => {
      if (e.id !== "buf") return e;
      const [nx, ny] = N[side], o = rot2(nx * 48, ny * 48, rot);
      return { ...e, cx: e.cx + o.x, cy: e.cy + o.y };   // 48 ft of bare ground between parking and buffer
    });
  };
  for (const rot of [0, 33, 180])
    for (const side of SIDES) {
      it(`on open (load heal) · rot ${rot} · ${side}`, () => {
        const heals = [];
        expectFlush(normalizeBondedChildren(detached(rot, side), (h) => heals.push(h)), side);
        expect(heals.some((h) => h.id === "buf")).toBe(true);
      });
      it(`on any refit · rot ${rot} · ${side}`, () => {
        const arr = detached(rot, side);
        expectFlush(ops.relayoutWallKids(arr, arr[0]), side);
      });
    }
  it("leaves a plan that is already flush byte-for-byte alone (no save churn)", () => {
    const arr = scene(33, "right", { road: true });
    expect(repackFlushLayers(arr, arr[0], "right")).toBe(arr);
    expect(ops.relayoutWallKids(arr, arr[0])).toEqual(arr);
  });
  it("never touches a dock wall's chain (court / trailer / chain buffer is relayoutSide's job)", () => {
    const b = { id: "B", type: "building", cx: 0, cy: 0, w: 400, h: 200, rot: 0, dock: "cross", dockAxis: "x", dockSide: "bottom" };
    let arr = [b];
    for (let i = 0; i < 3; i++) { const z = ops.buildNextZoneIn(arr, b, "bottom", S); if (z) arr = [...arr, z]; }
    arr = ops.relayoutAllSidesIn(arr, b, S);
    expect(repackFlushLayers(arr, b, "bottom")).toBe(arr);
  });
});
