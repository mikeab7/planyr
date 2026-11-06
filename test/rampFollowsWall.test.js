/* B2671194 (2026-11-06) — a drive-in ramp is never left off its building. The owner's Academy › Concept A, Building 4: ramps placed against the far end of a
 * ~918-ft wall kept their absolute `at` (850.84) when the wall became 784, so two sat ~66 ft past the end of the building. The rule is lib/driveInRamp.js
 * `reseatRamps`, run at the planner's one write seam (SitePlanner.jsx `setEls`) and as the on-open heal. Numbers below are read-only from his real rows. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { newRampRecord, rampBox, rampSpan, reseatRamps, refitRamps, wallFrame, pickRampSpot, rampFitRange } from "../src/workspaces/site-planner/lib/driveInRamp.js";
import { rampDoorRunOf } from "../src/workspaces/site-planner/components/elementRender.jsx";
import { dockSidesFor } from "../src/workspaces/site-planner/lib/dockZones.js";
import { plannerSource } from "./helpers/plannerSource.js";

const IN = 48;
const sidesOf = (h) => dockSidesFor(h).dockSides;
const settings = { showDocks: true, showGrid: true, floodMitigation: { dockDropFt: 4 } };
const ctx = (over = {}) => ({ dockSidesOf: sidesOf, dockHeightIn: IN, runOf: (h, s, arr) => rampDoorRunOf(h, s, arr, settings), ...over });
// Building 4's real door grid is not in the rows; its two end spots are (the owner's own "+" clicks gave 68.16 and 718), so the heal tests pin a run with exactly those.
const B4_RUN = { startF: 60.16, endF: 726, doors: [] };
const b4ctx = (over = {}) => ctx({ runOf: () => B4_RUN, ...over });
const mk = (id, host, side, at) => { const ramp = newRampRecord(side, at); return { id, type: "driveInRamp", attachedTo: host.id, noLabel: true, ramp, ...rampBox(host, ramp, { dockHeightIn: IN }) }; };
/* Exactly what SitePlanner.jsx `setEls` does for a host edit: reseat (from the gesture base, or the previous list), then the box refit. */
const write = (base, prev, next, c = ctx()) => refitRamps(reseatRamps(base, prev, next, c), sidesOf, IN);
const L = (host, side) => wallFrame(host, side).L;
const onWall = (els, host) => els.filter((e) => e.type === "driveInRamp").every((e) => { const l = L(host, e.ramp.side); return e.ramp.at >= -0.01 && e.ramp.at <= l + 0.01; });
const ramps = (els) => els.filter((e) => e.type === "driveInRamp");

// Building 4, as it is now: h 784, w 400, rot 89, cross dock, dock walls along y (left / right). Its ramp rows are the owner's real ones.
const B4 = { id: "e1455622wvkdne", type: "building", cx: 5000, cy: 3000, w: 400, h: 784, rot: 89, dock: "cross", dockAxis: "y", dockSide: "right" };
const B4_ROWS = [
  ["e1455640iklvem", "right", 68.16], ["e1455643iklvem", "left", 68.16],
  ["e1455641iklvem", "right", 850.84], ["e1455642iklvem", "left", 850.84],
  ["e1455684okdqaa", "right", 718], ["e1455685okdqaa", "left", 718],
];

describe("the owner's Building 4 — the stranded pair heals on open", () => {
  const els = [B4, ...B4_ROWS.map(([id, side, at]) => mk(id, B4, side, at))];
  it("setup: the walls are 784 and the 850.84 pair really is past the end (the defect, as measured)", () => {
    expect(sidesOf(B4).sort()).toEqual(["left", "right"]);
    expect(L(B4, "right")).toBe(784);
    expect(ramps(els).filter((r) => r.ramp.at > 784).map((r) => r.id).sort()).toEqual(["e1455641iklvem", "e1455642iklvem"]);
    expect(onWall(els, B4)).toBe(false);
  });
  it("the pair is re-seated by the end rule onto the existing 718 pair and dropped: one ramp at each corner of each dock wall", () => {
    const dropped = [];
    const out = write(els, els, els, b4ctx({ onDrop: (id) => dropped.push(id) }));
    expect(dropped.sort()).toEqual(["e1455641iklvem", "e1455642iklvem"]);
    expect(ramps(out).map((r) => `${r.ramp.side}:${r.ramp.at}`).sort()).toEqual(["left:68.16", "left:718", "right:68.16", "right:718"]);
    expect(onWall(out, B4)).toBe(true);
    expect(out.find((e) => e.id === "e1455640iklvem")).toBe(els.find((e) => e.id === "e1455640iklvem"));   // the ramps already on the wall are untouched
  });
  it("the heal is a fixed point and identity-stable once healed", () => {
    const once = write(els, els, els, b4ctx()), again = write(once, once, once, b4ctx());
    expect(again).toBe(once);
  });
  it("without the door grid (no runOf) the stranded ramp is clamped onto the wall, never left off it", () => {
    const solo = [B4, mk("s1", B4, "right", 850.84)];
    const out = write(solo, solo, solo, ctx({ runOf: undefined }));
    expect(ramps(out)).toHaveLength(1);
    expect(onWall(out, B4)).toBe(true);
    expect(rampSpan(ramps(out)[0].ramp).u1).toBeLessThanOrEqual(784.01);
  });
});

describe("shortening / lengthening a dock wall carries the ramps near its ends", () => {
  const H = { id: "h", type: "building", cx: 0, cy: 0, w: 900, h: 250, rot: 0, dock: "cross", dockAxis: "x" };
  const start = [H, mk("s", H, "bottom", 68), mk("e", H, "bottom", 900 - 68), mk("t", H, "top", 68), mk("u", H, "top", 900 - 68)];
  const resize = (els, patch) => els.map((e) => (e.id === "h" ? { ...e, ...patch } : e));
  const at = (els, id) => els.find((e) => e.id === id).ramp.at;
  it("RED on main: refitRamps alone leaves the far-end ramps past the end of a shortened wall", () => {
    const shorter = resize(start, { w: 784 });
    const old = refitRamps(shorter, sidesOf, IN);                       // what the write seam did before this change
    expect(onWall(old, shorter[0])).toBe(false);
    expect(at(old, "e")).toBe(900 - 68);
  });
  it("shorten from the FAR end (and from the NEAR end — the wall is the same length): the far-end ramps move with the end, the near-end ones stay", () => {
    for (const patch of [{ w: 784 }, { w: 784, cx: -58 }, { w: 784, cx: 58 }]) {
      const out = write(start, start, resize(start, patch));
      expect(at(out, "s")).toBe(68); expect(at(out, "t")).toBe(68);
      expect(at(out, "e")).toBeCloseTo(784 - 68, 6); expect(at(out, "u")).toBeCloseTo(784 - 68, 6);
      expect(onWall(out, out[0])).toBe(true);
      expect(out.find((e) => e.id === "e").cx).toBeCloseTo(rampBox(out[0], out.find((e) => e.id === "e").ramp, { dockHeightIn: IN }).cx, 9);   // the box follows too
    }
  });
  it("lengthen: the far-end ramps keep their distance from the end", () => {
    const out = write(start, start, resize(start, { w: 1100 }));
    expect(at(out, "s")).toBe(68); expect(at(out, "e")).toBeCloseTo(1100 - 68, 6);
  });
  it("a gesture is measured from where it BEGAN: shrink hard, then drag back out, and the ramps come back to where they were", () => {
    let prev = start;
    for (const w of [850, 700, 500, 300, 500, 700, 900]) prev = write(start, prev, resize(prev, { w }));
    expect(ramps(prev).map((r) => `${r.id}:${r.ramp.at}`).sort()).toEqual(ramps(start).map((r) => `${r.id}:${r.ramp.at}`).sort());
  });
  it("a wall too short for both ends: the far ramp lands on the near one and is dropped (modules back), the near one stays", () => {
    const dropped = [];
    const out = write(start, start, resize(start, { w: 20 }), ctx({ onDrop: (id) => dropped.push(id) }));
    expect(dropped.sort()).toEqual(["e", "u"]);
    expect(ramps(out).map((r) => r.id).sort()).toEqual(["s", "t"]);
  });
  it("a mid-wall ramp that no longer fits is clamped onto the wall", () => {
    const mid = [H, mk("m", H, "bottom", 450)];
    const out = write(mid, mid, resize(mid, { w: 10 }));
    const sp = rampFitRange(out[1].ramp, 10);
    expect(out[1].ramp.at).toBeCloseTo((sp.lo + sp.hi) / 2, 6);          // wall shorter than the ramp: centred
    const out2 = write(mid, mid, resize(mid, { w: 40 }));
    expect(out2[1].ramp.at).toBeGreaterThanOrEqual(8); expect(out2[1].ramp.at).toBeLessThanOrEqual(32);
  });
  it("rotation and moves do not touch `at` (0°, 315°, any angle): only the box follows", () => {
    for (const rot of [0, 89, 315]) {
      const out = write(start, start, resize(start, { rot, cx: 300, cy: -40 }));
      expect(ramps(out).map((r) => r.ramp.at).sort((a, b) => a - b)).toEqual([68, 68, 832, 832]);
    }
    // a rotated host shortened: the ramps follow along the host's own axis
    const R = { ...H, rot: 315 }, rs = [R, mk("s", R, "bottom", 68), mk("e", R, "bottom", 832)];
    const out = write(rs, rs, rs.map((e) => (e.id === "h" ? { ...e, w: 784 } : e)));
    expect(out.find((e) => e.id === "e").ramp.at).toBeCloseTo(716, 6);
    expect(onWall(out, out[0])).toBe(true);
  });
  it("a single dock wall behaves the same, and a position the owner TYPES in the same write is his choice, not followed", () => {
    const S = { ...H, dock: "single", dockSide: "bottom" }, ss = [S, mk("e", S, "bottom", 832)];
    const out = write(ss, ss, ss.map((e) => (e.id === "h" ? { ...e, w: 784 } : e)));
    expect(at(out, "e")).toBeCloseTo(716, 6);
    const typed = ss.map((e) => (e.id === "e" ? { ...e, ramp: { ...e.ramp, at: 300 } } : e));
    expect(at(write(ss, ss, typed), "e")).toBe(300);
  });
  it("undo / redo: snapshots restore exact geometry (setElsRaw) and are never re-interpreted; redo of the same resize reproduces the same list", () => {
    const after = write(start, start, resize(start, { w: 784 }));
    const undone = JSON.parse(JSON.stringify(start)), redone = write(undone, undone, resize(undone, { w: 784 }));
    expect(redone).toEqual(after);
    expect(JSON.parse(JSON.stringify(after))).toEqual(after);          // a reload keeps them (plain JSON)
  });
});

describe("one answer for the end spot: the '+' button and the heal", () => {
  it("pickRampSpot with and without `taken` agrees with the corner module, and refuses a taken one", () => {
    const run = B4_RUN;
    const end = pickRampSpot({ run, L: 784, W: 16, where: "end" }), start = pickRampSpot({ run, L: 784, W: 16, where: "start" });
    expect(end).toBe(718); expect(start).toBe(68.16);
    // …and over the REAL door grid (a plain 784-ft wall) the same function lands each end on a clear module inside the wall
    const real = rampDoorRunOf(B4, "right", [B4], settings), e2 = pickRampSpot({ run: real, L: 784, W: 16, where: "end" });
    expect(e2).toBeGreaterThan(700); expect(e2 + 8).toBeLessThanOrEqual(784 + 0.01);
    const taken = [rampSpan(newRampRecord("right", 718), { dockHeightIn: IN })];
    expect(pickRampSpot({ run, L: 784, W: 16, where: "end", taken })).not.toBe(718);
  });
  it("SitePlanner wires the seam: reseatRamps in setEls, the heal effect, the tombstone flush, and planRampAt through pickRampSpot", () => {
    const src = plannerSource();
    expect(src).toMatch(/refitRamps\(reseatRamps\(gestureBase \|\| prev, prev, next, rampSeatCtx\(\)\)/);
    expect(src).toMatch(/reseatRamps\(prev, prev, prev, rampSeatCtx\(\)\)/);
    expect(src).toMatch(/rampDropQueue\.current/);
    expect(src).toMatch(/pickRampSpot\(\{ run: isDock/);
  });
});
