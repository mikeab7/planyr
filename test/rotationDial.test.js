/* NEW-1 (2026-10-21) — the Overlays panel's rotation DIAL: pointer → degrees, Shift snap, wrap through 0/360,
 * the keyboard step, and ONE undo step per drag. Pure maths (lib/rotationDial.js); the component only wires it. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  dialAngleFromPoint, dialDragAngle, snapDeg, dialKeyDelta, dialKeyAngle, stepRotation, needleEnd, createDialDrag, DIAL_TICKS,
} from "../src/workspaces/site-planner/lib/rotationDial.js";

const near = (a, b, e = 1e-9) => expect(Math.abs(a - b)).toBeLessThan(e);

describe("pointer position → degrees (0 = up, clockwise positive)", () => {
  const C = [100, 100];
  it("the four compass points", () => {
    near(dialAngleFromPoint(...C, 100, 40), 0);      // straight up
    near(dialAngleFromPoint(...C, 160, 100), 90);    // right
    near(dialAngleFromPoint(...C, 100, 160), 180);   // down
    near(dialAngleFromPoint(...C, 40, 100), 270);    // left
  });
  it("the diagonals are clockwise from up", () => {
    near(dialAngleFromPoint(...C, 160, 40), 45);
    near(dialAngleFromPoint(...C, 160, 160), 135);
    near(dialAngleFromPoint(...C, 40, 160), 225);
    near(dialAngleFromPoint(...C, 40, 40), 315);
  });
  it("distance from the centre does not matter, only direction", () => {
    near(dialAngleFromPoint(...C, 101, 99), 45);
    near(dialAngleFromPoint(...C, 1000, -800), dialAngleFromPoint(...C, 101, 99));
  });
  it("the exact centre has no direction (null, never NaN or 0)", () => {
    expect(dialAngleFromPoint(...C, 100, 100)).toBeNull();
    expect(dialAngleFromPoint(...C, NaN, 3)).toBeNull();
  });
  it("always lands in [0, 360)", () => {
    for (let a = 0; a < 360; a += 7) {
      const r = (a * Math.PI) / 180;
      const d = dialAngleFromPoint(0, 0, 50 * Math.sin(r), -50 * Math.cos(r));
      expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThan(360);
      near(d, a, 1e-6);
    }
  });
});

describe("what a drag writes", () => {
  it("rounds to 0.1°", () => {
    expect(dialDragAngle(33.333)).toBe(33.3);
    expect(dialDragAngle(33.36)).toBe(33.4);
    expect(dialDragAngle(0.04)).toBe(0);
  });
  it("wraps through 0/360 — 359.96° is 0°, never 360", () => {
    expect(dialDragAngle(359.96)).toBe(0);
    expect(dialDragAngle(359.94)).toBe(359.9);
    expect(dialDragAngle(360)).toBe(0);
  });
  it("Shift snaps to 15° steps and wraps", () => {
    expect(dialDragAngle(7.4, { shift: true })).toBe(0);
    expect(dialDragAngle(7.6, { shift: true })).toBe(15);
    expect(dialDragAngle(44, { shift: true })).toBe(45);
    expect(dialDragAngle(352.6, { shift: true })).toBe(0);     // 352.6 is nearer 360 than 345
    expect(dialDragAngle(351, { shift: true })).toBe(345);
    expect(snapDeg(97.4)).toBe(90);
  });
  it("a non-finite angle writes nothing", () => { expect(dialDragAngle(NaN)).toBeNull(); expect(dialDragAngle(null)).toBeNull(); });
});

describe("keyboard", () => {
  it("←/↓ −1°, →/↑ +1°, Shift ±15°", () => {
    expect(dialKeyDelta("ArrowRight")).toBe(1); expect(dialKeyDelta("ArrowUp")).toBe(1);
    expect(dialKeyDelta("ArrowLeft")).toBe(-1); expect(dialKeyDelta("ArrowDown")).toBe(-1);
    expect(dialKeyDelta("ArrowRight", true)).toBe(15); expect(dialKeyDelta("ArrowDown", true)).toBe(-15);
    expect(dialKeyDelta("a")).toBe(0); expect(dialKeyDelta("Enter", true)).toBe(0);
  });
  it("wraps and never drifts", () => {
    expect(dialKeyAngle(359.5, "ArrowRight")).toBe(0.5);
    expect(dialKeyAngle(0, "ArrowLeft")).toBe(359);
    expect(dialKeyAngle(10, "ArrowLeft", true)).toBe(355);
    expect(dialKeyAngle(33.3, "ArrowRight")).toBe(34.3);
    expect(dialKeyAngle(5, "x")).toBeNull();
  });
});

describe("the ▲▼ and quarter-turn steps", () => {
  it("±1° and ±90° wrap into [0, 360) and trim float residue", () => {
    expect(stepRotation(359.5, 1)).toBe(0.5);
    expect(stepRotation(0, -1)).toBe(359);
    expect(stepRotation(0, -90)).toBe(270);        // counterclockwise from 0
    expect(stepRotation(270, 90)).toBe(0);         // clockwise through 360
    expect(stepRotation(10.1, 1)).toBe(11.1);
    let r = 0.1; for (let i = 0; i < 30; i++) r = stepRotation(r, 1);
    expect(r).toBe(30.1);
  });
});

describe("needle geometry", () => {
  it("0° points up, 90° right, 180° down, 270° left", () => {
    const up = needleEnd(0, 16, 10); near(up.x, 16); near(up.y, 6);
    const rt = needleEnd(90, 16, 10); near(rt.x, 26); near(rt.y, 16);
    const dn = needleEnd(180, 16, 10); near(dn.x, 16); near(dn.y, 26);
    const lf = needleEnd(270, 16, 10); near(lf.x, 6); near(lf.y, 16);
  });
  it("the four tick dots are 0/90/180/270", () => { expect([...DIAL_TICKS]).toEqual([0, 90, 180, 270]); });
});

describe("ONE undo step per drag", () => {
  const make = (start = 0) => {
    const st = { rot: start, pushes: 0, patches: [] };
    const drag = createDialDrag({
      getRotation: () => st.rot, pushHistory: () => { st.pushes += 1; },
      patch: (deg, hist) => { st.patches.push({ deg, hist }); st.rot = deg; },
    });
    return { st, drag };
  };
  it("a 60-move drag pushes exactly one history frame; every patch is no-history", () => {
    const { st, drag } = make(0);
    drag.down(5);
    for (let i = 1; i <= 60; i++) drag.move(5 + i * 2);
    drag.up();
    expect(st.pushes).toBe(1);
    expect(st.patches.length).toBe(61);
    expect(st.patches.every((p) => p.hist === false)).toBe(true);
    expect(st.rot).toBe(125);
  });
  it("two drags are two steps", () => {
    const { st, drag } = make(0);
    drag.down(10); drag.move(20); drag.up();
    drag.down(40); drag.move(50); drag.up();
    expect(st.pushes).toBe(2);
  });
  it("a press that lands on the current angle writes nothing and leaves no empty frame", () => {
    const { st, drag } = make(90);
    drag.down(90); drag.up();
    expect(st.pushes).toBe(0); expect(st.patches.length).toBe(0);
  });
  it("moves with no press are ignored; a centre (null) move writes nothing", () => {
    const { st, drag } = make(0);
    drag.move(33);
    expect(st.patches.length).toBe(0);
    drag.down(10); drag.move(null); drag.up();
    expect(st.pushes).toBe(1); expect(st.patches.length).toBe(1);
  });
  it("a drag across 0/360 writes the wrapped value, still one step", () => {
    const { st, drag } = make(350);
    drag.down(355); drag.move(0); drag.move(5); drag.up();
    expect(st.rot).toBe(5); expect(st.pushes).toBe(1);
  });
});

describe("wiring (source guard)", () => {
  const panel = readFileSync("src/workspaces/site-planner/components/OverlaysPanel.jsx", "utf8");
  it("the dial is a focusable slider with the specified aria", () => {
    expect(panel).toContain('role="slider"');
    expect(panel).toContain('aria-label="Rotation dial"');
    expect(panel).toMatch(/aria-valuemin=\{0\}/); expect(panel).toMatch(/aria-valuemax=\{360\}/); expect(panel).toContain("aria-valuenow");
  });
  it("the number box has an up and a down arrow, and no − / + buttons", () => {
    expect(panel).toContain('upLabel="Increase rotation 1 degree"');
    expect(panel).toContain('downLabel="Decrease rotation 1 degree"');
    expect(panel).not.toMatch(/Rotate 1 degree/);
  });
  it("the quarter-turn buttons are spelled out with no left/right wording", () => {
    expect(panel).toContain("Turn 90° counterclockwise");
    expect(panel).toContain("Turn 90° clockwise");
    expect(panel).toContain('"overlay-rot-ccw90"'); expect(panel).toContain('"overlay-rot-cw90"');
    expect(panel).not.toMatch(/Rotate 90|anticlockwise|Turn 90° (left|right)/i);
  });
  it("nothing in the rotation block is gated on the overlay being locked", () => {
    const block = panel.slice(panel.indexOf("function RotationRow"), panel.indexOf("/* The equal scale buttons"));
    expect(block).not.toMatch(/locked/);
  });
});
