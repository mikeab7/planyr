/* NEW-1 / NEW-2 — the click-vs-drag gate: the property, and the wiring.
 *
 * Owner, 2026-08-09: "sometimes when I intend to just click on something to select it, it actually
 * also moves it, like, a couple feet or, like, a pixel or two just because my click is too slow …
 * And I'd like it to stop doing that."
 *
 * Two halves, and both are needed:
 *   · the PURE half — `lib/dragGate.js` — proven directly, including the three traps that make the
 *     obvious implementation wrong (a clock, a jump at the gate, and one algebra that only suits
 *     relative drags);
 *   · the WIRING half — a source guard, because the defect is the ABSENCE of a call. Every drag
 *     start that moves existing geometry must carry the gate, and none of them may push an undo
 *     frame on the press. A property test on the module cannot see a branch that never asks it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  DRAG_SLOP_PX, makeDragGate, dragTravelPx, gatedPoint, stepDragGate, dragArmed,
} from "../src/workspaces/site-planner/lib/dragGate.js";

const here = dirname(fileURLToPath(import.meta.url));
const SP_PATH = join(here, "../src/workspaces/site-planner/SitePlanner.jsx");
const SP = readFileSync(SP_PATH, "utf8");
const GATE_SRC = readFileSync(join(here, "../src/workspaces/site-planner/lib/dragGate.js"), "utf8");

/* A press at (100, 100) screen px == (50, 50) feet, at 2 px per foot. */
const press = () => makeDragGate({ x: 100, y: 100 }, { x: 50, y: 50 });
const PPF = 2;
const feetAt = (cx, cy) => ({ x: 50 + (cx - 100) / PPF, y: 50 + (cy - 100) / PPF });
const move = (g, cx, cy) => stepDragGate(g, { x: cx, y: cy }, feetAt(cx, cy));

describe("NEW-1: a press that does not travel is a CLICK and writes nothing", () => {
  it("zero travel does not arm", () => {
    const g = press();
    const r = move(g, 100, 100);
    expect(r.armed).toBe(false);
    expect(r.justArmed).toBe(false);
    expect(g.armed).toBe(false);
  });

  it("a pixel or two of hand tremor — the owner's exact case — does not arm", () => {
    const g = press();
    for (const [dx, dy] of [[1, 0], [1, 1], [0, 2], [-2, 1], [2, -2], [0, 0]]) {
      expect(move(g, 100 + dx, 100 + dy).armed, `travel (${dx},${dy}) armed a drag`).toBe(false);
    }
    expect(g.armed).toBe(false);
  });

  it("travel exactly AT the slop is still a click; past it is a drag", () => {
    const at = press();
    expect(move(at, 100 + DRAG_SLOP_PX, 100).armed).toBe(false);
    const past = press();
    expect(move(past, 100 + DRAG_SLOP_PX + 0.001, 100).armed).toBe(true);
  });

  it("travel is measured from the PRESS, not from the previous move — a slow crawl still arms", () => {
    const g = press();
    for (let i = 1; i <= DRAG_SLOP_PX + 1; i++) expect(move(g, 100 + i, 100).armed).toBe(i > DRAG_SLOP_PX);
    expect(g.armed).toBe(true);
  });

  it("it is a RADIUS, not a per-axis box: diagonal travel counts", () => {
    const g = press();
    expect(move(g, 104, 104).armed).toBe(true); // 4 px on each axis = 5.66 px of travel
    expect(dragTravelPx(press(), { x: 104, y: 104 })).toBeCloseTo(Math.hypot(4, 4), 10);
  });
});

describe("NEW-1: DURATION IS NOT PART OF THE TEST (the mirror-image bug)", () => {
  /* The pan path's tap classifier pairs slop with a 400 ms limit. Copying it here would mean a
   * deliberate, slow, careful press that never moves eventually starts dragging — which is the
   * complaint, not the fix. The gate has no clock, and cannot acquire one without failing here. */
  it("a press held indefinitely without moving never arms", () => {
    const g = press();
    for (let i = 0; i < 5000; i++) expect(move(g, 100, 100).armed).toBe(false);
    expect(g.armed).toBe(false);
  });

  it("a single fast flick past the slop arms immediately, however brief", () => {
    const g = press();
    expect(move(g, 300, 100).armed).toBe(true);
  });

  it("the module holds no clock at all", () => {
    for (const clock of ["Date.now", "performance.now", "new Date", "timeStamp", "setTimeout"]) {
      expect(GATE_SRC.includes(clock), `dragGate.js reached for ${clock}`).toBe(false);
    }
  });
});

describe("NEW-1: opening the gate must not JUMP the geometry", () => {
  it("at the arming frame the rebased point IS the press point, exactly", () => {
    const g = press();
    const r = move(g, 110, 100); // 10 px past the slop
    expect(r.justArmed).toBe(true);
    expect(r.pt.x).toBeCloseTo(50, 12);
    expect(r.pt.y).toBeCloseTo(50, 12);
  });

  it("a RELATIVE drag (dx = fp.x - d.fx) starts at a zero delta and then tracks 1:1", () => {
    const g = press();
    const armFrame = move(g, 112, 103);
    expect({ dx: armFrame.pt.x - 50, dy: armFrame.pt.y - 50 }).toEqual({ dx: 0, dy: 0 });
    // 20 px further right: the element must move 20 px worth of feet, not 32.
    const next = move(g, 132, 103);
    expect(next.pt.x - 50).toBeCloseTo(20 / PPF, 12);
    expect(next.pt.y - 50).toBeCloseTo(0, 12);
  });

  it("a ROTATE/SCALE drag reads a zero angle and a unit ratio on the arming frame", () => {
    const pivot = { x: 0, y: 0 };
    const g = press();
    const a0 = Math.atan2(50 - pivot.y, 50 - pivot.x);
    const grab = Math.hypot(50 - pivot.x, 50 - pivot.y);
    const r = move(g, 100, 115);
    expect(Math.atan2(r.pt.y - pivot.y, r.pt.x - pivot.x) - a0).toBeCloseTo(0, 12);
    expect(Math.hypot(r.pt.x - pivot.x, r.pt.y - pivot.y) / grab).toBeCloseTo(1, 12);
  });

  it("the rebase is a CONSTANT offset — it never re-accumulates on later moves", () => {
    const g = press();
    move(g, 120, 100);
    const off = { ...g.off };
    move(g, 400, 260);
    move(g, 90, 40);
    expect(g.off).toEqual(off);
  });
});

describe("NEW-1: a POINT drag opts out of the rebase and stays under the pointer", () => {
  /* The distinction is not cosmetic. A vertex written to `snapPt(fp)` that is rebased trails the
   * cursor by the travel the gate swallowed for the WHOLE gesture — which is enough to release a
   * road endpoint outside the snap-and-connect magnet, so it silently never welds. The first cut
   * of this fix rebased everything and `e2e/road-connect-radius` caught it. */
  const pointPress = () => makeDragGate({ x: 100, y: 100 }, { x: 50, y: 50 }, { rebase: false });

  it("it still gates: a tremor writes nothing", () => {
    const g = pointPress();
    expect(move(g, 102, 101).armed).toBe(false);
  });

  it("once armed the point IS the pointer, with no offset — now and on every later move", () => {
    const g = pointPress();
    const armed = move(g, 113, 100);
    expect(armed.justArmed).toBe(true);
    expect(armed.pt).toEqual(feetAt(113, 100));
    expect(move(g, 260, 40).pt).toEqual(feetAt(260, 40));
    expect(g.off).toBe(null);
  });

  it("a rebased drag would MISS a target the pointer is released on; a point drag hits it", () => {
    const target = feetAt(300, 300);
    const rebased = press(), point = pointPress();
    for (const [x, y] of [[160, 220], [300, 300]]) { move(rebased, x, y); move(point, x, y); }
    expect(point.armed && rebased.armed).toBe(true);
    expect(gatedPoint(point, target)).toEqual(target);
    expect(gatedPoint(rebased, target)).not.toEqual(target);
  });

  it("the planner opts every vertex layer and the road end out, and nothing else", () => {
    const optedOut = DRAG_STARTS.filter((d) => /rebase: false/.test(d.literal)).map((d) => d.mode).sort();
    expect(optedOut).toEqual(["easeVertex", "elVertex", "measureVertex", "mkVertex", "roadEnd", "roadVtx", "vertex"]);
  });
});

describe("NEW-1: the gate's other contracts", () => {
  it("an UNGATED gesture (pan / draw / marquee) passes through untouched", () => {
    const r = stepDragGate(undefined, { x: 1, y: 2 }, { x: 3, y: 4 });
    expect(r).toEqual({ armed: true, justArmed: false, pt: { x: 3, y: 4 } });
    expect(dragArmed(null)).toBe(true);
    expect(dragArmed({ mode: "pan" })).toBe(true);
  });

  it("justArmed fires exactly ONCE per gesture — so exactly one undo frame is pushed", () => {
    const g = press();
    let armings = 0;
    for (const x of [101, 103, 110, 140, 141, 90]) if (move(g, x, 100).justArmed) armings++;
    expect(armings).toBe(1);
  });

  it("dragArmed reports an in-flight gesture honestly", () => {
    const d = { mode: "move", gate: press() };
    expect(dragArmed(d)).toBe(false);
    stepDragGate(d.gate, { x: 200, y: 100 }, feetAt(200, 100));
    expect(dragArmed(d)).toBe(true);
  });

  it("gatedPoint is inert before arming", () => {
    const g = press();
    expect(gatedPoint(g, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });

  it("the threshold is the SAME number the pan path's tap test uses", () => {
    expect(SP).toMatch(/const PARCEL_CLICK_SLOP_PX = DRAG_SLOP_PX;/);
  });
});

/* ------------------------------------------------------------------------------------------ *
 * The WIRING guard. The bug was a missing test, so the guard has to be about presence.
 * ------------------------------------------------------------------------------------------ */

/* Every `drag.current = { mode: "<x>", … }` in the planner, with the literal it was given.
 * Anchored to the start of a line so a drag start QUOTED in a comment (this fix leaves one, in
 * `startGate`'s own doc block) is not scanned as if it were code — it would otherwise pass every
 * check below by containing the very text they look for. */
const DRAG_STARTS = [...SP.matchAll(/^[ \t]*drag\.current = \{ mode: "(\w+)"([^\n]*)/gm)]
  .map((m) => ({ mode: m[1], literal: m[0], index: m.index }));

/* The gestures that CREATE geometry or move the CAMERA rather than moving what is already drawn.
 * A slop gate on these would change what they mean (a click-to-place draw, a tap-to-clear pan),
 * so they are deliberately out of scope — and named here so the exemption is a decision on the
 * record rather than an oversight. */
const UNGATED = new Set(["pan", "draw", "mkDraw", "mkFreehand", "marquee"]);

describe("NEW-1 (wiring): every drag that moves existing geometry carries the gate", () => {
  it("the planner has drag starts to check at all", () => {
    expect(DRAG_STARTS.length).toBeGreaterThan(20);
  });

  it("each geometry-moving drag start spreads ...startGate(", () => {
    const missing = DRAG_STARTS
      .filter((d) => !UNGATED.has(d.mode) && !/\.\.\.startGate\(/.test(d.literal))
      .map((d) => d.mode);
    expect(missing, `these drag modes write geometry on the FIRST pointermove: ${missing.join(", ")}`)
      .toEqual([]);
  });

  it("the camera / creation gestures are NOT gated (a click-to-place draw must still work)", () => {
    for (const d of DRAG_STARTS.filter((x) => UNGATED.has(x.mode))) {
      expect(/\.\.\.startGate\(/.test(d.literal), `${d.mode} was gated`).toBe(false);
    }
  });

  it("the gate is applied ONCE, above every branch, rather than per branch", () => {
    const guard = SP.indexOf("if (d.gate) {");
    expect(guard, "the central gate in onMove is gone").toBeGreaterThan(-1);
    // …and it precedes the first mode branch in the move handler, so no branch can slip past it.
    const firstBranch = SP.indexOf('if (d.mode === "acChip")', guard);
    expect(firstBranch).toBeGreaterThan(guard);
    expect(SP.slice(guard, firstBranch)).toContain("if (!g.armed) return;");
  });
});

describe("NEW-2 (wiring): the undo frame belongs to the MOVE, not to the press", () => {
  /* The reported symptom is "Ctrl+Z does nothing, several times in a row": every plain click on an
   * element pushed a no-op frame, so the first few undos restored identical state. */
  /* Everything between a drag start and the opening of the handler that owns it — i.e. the code
   * that runs on the PRESS. Comments are stripped, so prose naming pushHistory() (of which this
   * fix leaves a lot, deliberately) cannot mask a real call or fake one. */
  const pressBodyOf = (start) => {
    const decls = [...SP.slice(0, start.index).matchAll(/\n  const \w+ = (?:useCallback\()?\(/g)];
    const from = decls.length ? decls[decls.length - 1].index : 0;
    return SP.slice(from, start.index).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  };

  it("no gated drag start pushes history on pointer-down", () => {
    const offenders = DRAG_STARTS
      .filter((d) => !UNGATED.has(d.mode) && /\bpushHistory\(\)/.test(pressBodyOf(d)))
      .map((d) => d.mode);
    expect(offenders, `these push an undo frame before anything has moved: ${offenders.join(", ")}`)
      .toEqual([]);
  });

  it("…and that guard can actually SEE a press-time pushHistory (it is mutation-checked)", () => {
    // The first version of this check sliced backwards to `const start`, which most of these
    // handlers do not contain — so it read an empty string and passed on a deliberately broken
    // build. Prove the window really covers the press body.
    const move = DRAG_STARTS.find((d) => d.mode === "move");
    expect(pressBodyOf(move)).toMatch(/setSel\(\{ kind: "el", id \}\)/);
    expect(/\bpushHistory\(\)/.test(`${pressBodyOf(move)}\n    pushHistory();`)).toBe(true);
  });

  it("the frame is pushed on the arming frame instead, exactly once", () => {
    const guard = SP.slice(SP.indexOf("if (d.gate) {"), SP.indexOf('if (d.mode === "acChip")'));
    expect(guard).toMatch(/if \(g\.justArmed\)/);
    expect(guard).toMatch(/if \(d\.histOnArm\) \{ pushHistory\(\); d\.pushed = true; \}/);
  });

  it("a cancelled gesture that never armed does NOT drop someone else's undo frame", () => {
    const cancel = SP.slice(SP.indexOf("const cancelActiveMove = ()"), SP.indexOf("const cancelActiveMove = ()") + 800);
    expect(cancel).toMatch(/if \(d\.gate && !d\.gate\.armed\) return false;/);
    expect(cancel.indexOf("if (d.gate && !d.gate.armed) return false;"))
      .toBeLessThan(cancel.indexOf("histRef.current.drop()"));
  });

  it("release-time WRITES are gated too — a click must not prune, weld or re-derive", () => {
    for (const guarded of [
      'if (d && dragArmed(d) && (d.mode === "resize" || d.mode === "edgeResize"))',
      'if (d && dragArmed(d) && d.mode === "roadVtx")',
      'if (d && dragArmed(d) && d.mode === "elVertex" && d.footEdit)',
    ]) expect(SP, `unguarded release path: ${guarded}`).toContain(guarded);
  });
});
