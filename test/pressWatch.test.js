/* NEW-1 (map-finder) — the lost-press recovery + mode trace behind "first click on Select parcels
 * does nothing". Every branch is driven with an injected fake clock/timer. Mutation notes are on each
 * block: delete the named line in lib/pressWatch.js and the case goes red. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createPressWatch, createModeTrace, pointInRect, PRESS_CLICK_GRACE_MS } from "../src/workspaces/site-planner/lib/pressWatch.js";

function rig() {
  let t = 1000; const timers = new Map(); let n = 0; const lost = [];
  const watch = createPressWatch({
    onLost: (i) => lost.push(i), now: () => t,
    setTimer: (fn) => { timers.set(++n, fn); return n; }, clearTimer: (id) => timers.delete(id),
  });
  return { watch, lost, advance: (ms) => { t += ms; }, fire: () => { const fns = [...timers.values()]; timers.clear(); fns.forEach((f) => f()); }, timers };
}

describe("createPressWatch", () => {
  it("a press that completes over the button with NO click is reported lost (the node was replaced mid-press)", () => {
    const r = rig();
    r.watch.down(1); r.advance(90); r.watch.up(1, true);
    expect(r.watch.pending()).toBe(true);
    r.fire();
    expect(r.lost).toEqual([{ downToUpMs: 90 }]);
  });
  it("a genuine click cancels the recovery (no double activation, no report)", () => {
    const r = rig();
    r.watch.down(1); r.watch.up(1, true); r.watch.click(); r.fire();
    expect(r.lost).toEqual([]);
  });
  it("a release OUTSIDE the button's box is a deliberate drag-off, never recovered", () => {
    const r = rig();
    r.watch.down(1); r.watch.up(1, false); r.fire();
    expect(r.lost).toEqual([]);
  });
  it("a cancelled press (touch scroll takeover) is never recovered", () => {
    const r = rig();
    r.watch.down(1); r.watch.cancel(); r.watch.up(1, true); r.fire();
    expect(r.lost).toEqual([]);
  });
  it("a different pointer's release does not complete this press", () => {
    const r = rig();
    r.watch.down(1); r.watch.up(2, true); r.fire();
    expect(r.lost).toEqual([]);
  });
  it("a second press supersedes a pending one (one report at most per press)", () => {
    const r = rig();
    r.watch.down(1); r.watch.up(1, true); r.watch.down(1); r.watch.up(1, true); r.fire();
    expect(r.lost.length).toBe(1);
  });
  it("an onLost that throws never escapes into the app", () => {
    const timers = []; const w = createPressWatch({ onLost: () => { throw new Error("x"); }, setTimer: (f) => { timers.push(f); return 1; }, clearTimer: () => {} });
    w.down(1); w.up(1, true);
    expect(() => timers.forEach((f) => f())).not.toThrow();
  });
  it("the grace is short enough that a recovered press feels instant", () => { expect(PRESS_CLICK_GRACE_MS).toBeLessThanOrEqual(120); });
});

describe("pointInRect", () => {
  const r = { left: 10, top: 10, right: 50, bottom: 30 };
  it("edges are inside, outside is not, null is not", () => {
    expect(pointInRect(10, 30, r)).toBe(true); expect(pointInRect(51, 20, r)).toBe(false); expect(pointInRect(20, 20, null)).toBe(false);
  });
});

describe("createModeTrace", () => {
  const mk = () => { let t = 0; const tr = createModeTrace({ now: () => t }); return { tr, at: (ms) => { t = ms; } }; };
  it("an early exit nobody asked for is reported with its reason", () => {
    const { tr, at } = mk(); at(100); tr.transition(true); at(400); tr.willExit("visible-flip");
    expect(tr.transition(false)).toEqual({ reason: "visible-flip", heldMs: 300 });
  });
  it("an exit with no declared reason is 'unexplained', still reported", () => {
    const { tr, at } = mk(); tr.transition(true); at(50);
    expect(tr.transition(false)).toEqual({ reason: "unexplained", heldMs: 50 });
  });
  it("a user Cancel or a finished verb is never a reset", () => {
    for (const why of ["user", "verb"]) { const { tr, at } = mk(); tr.transition(true); at(20); tr.willExit(why); expect(tr.transition(false)).toBeNull(); }
  });
  it("an exit long after engaging is ordinary use, not a reset", () => {
    const { tr, at } = mk(); tr.transition(true); at(10_000);
    expect(tr.transition(false)).toBeNull();
  });
  it("the initial false and repeated false are silent; the ring is bounded", () => {
    const { tr } = mk(); expect(tr.transition(false)).toBeNull();
    for (let i = 0; i < 100; i++) tr.note("x");
    expect(tr.snapshot().length).toBeLessThanOrEqual(24);
  });
});

describe("wiring (source guard — a recovery nobody calls recovers nothing)", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
  it("the Select parcels button feeds the press watch AND its recovery engages the mode", () => {
    const at = src.indexOf('data-testid="map-toolbar-select-parcels"');
    const btn = src.slice(at, at + 1200);
    expect(btn).toMatch(/onPointerDown=/); expect(btn).toMatch(/onPointerUp=/); expect(btn).toMatch(/selectPressRef\.current\.click\(\)/);
    expect(src).toMatch(/onLost: \(info\) => \{[\s\S]{0,400}setSelectMode\(true\)/);
  });
  it("the visible-flip reset declares its reason so a swallowed engage names its cause", () => {
    expect(src).toMatch(/willExit\("visible-flip"\)\s*;\s*\n\s*setSelectMode\(false\)/);
  });
});
