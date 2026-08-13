/* B385041 — A BUILDING'S DOCK WALLS MUST NOT MOVE BECAUSE YOU RESIZED IT.
 *
 * Owner, verbatim: *"if I had a cross-dock and I shrink it lengthwise, it almost seemed to recompute
 * where the docks went versus where the parking went, when I made it deeper than it was long. I don't
 * really want it to do that. Let me just play around instead of correcting it for me — it doesn't help
 * if I'm just trying to figure out what will and won't fit."*
 *
 * `dockSidesFor` derived the loaded walls LIVE from `el.w >= el.h`, so shrinking a cross-dock building
 * past square rotated the whole dock assembly 90° mid-drag — and because the comparison is `>=`, one
 * foot either side of square flipped it and flipped it back.
 *
 * These tests are the mutation check on that: several of them REPLAY the pre-fix rule and require the
 * stored answer to differ from it, so a future "tidy" back to an aspect-ratio read goes red rather
 * than quietly restoring the bug.
 */
import { describe, it, expect } from "vitest";
import {
  dockSidesFor, dockAxisOf, dockAxisEstablished, establishDockAxisPatch, withDockAxis,
  healDockAxes, rotateDockAxisPatch, footprintAxes, footprintDepth, footprintLength, DOCK_AXES,
} from "../src/workspaces/site-planner/lib/dockZones.js";

// The rule as it stood before this item — kept verbatim so the tests below assert a DIFFERENCE.
const preFixLongSides = (el) => (el.w >= el.h ? ["top", "bottom"] : ["left", "right"]);

const B = (over = {}) => ({ id: "b1", type: "building", cx: 0, cy: 0, w: 900, h: 300, rot: 0, dock: "cross", ...over });

describe("the orientation is DERIVED until it is established, then PRESERVED", () => {
  it("with no stamp, the aspect ratio still decides — byte-identical to the old rule", () => {
    for (const [w, h] of [[900, 300], [300, 900], [580, 580], [301, 300], [300, 301]]) {
      const el = { w, h, dock: "cross" };
      expect(dockAxisEstablished(el)).toBe(false);
      expect(dockSidesFor(el).dockSides).toEqual(preFixLongSides(el));
    }
  });

  it("a stamped axis SURVIVES a resize that takes the building past square — the reported bug", () => {
    const wide = B({ dockAxis: "x", dockSide: "bottom" });           // 900 × 300 cross-dock
    expect(dockSidesFor(wide).dockSides).toEqual(["top", "bottom"]);
    // Shrink it lengthwise until it is deeper than it is long.
    const deep = { ...wide, w: 250 };                                // 250 × 300 — the old rule flips here
    expect(preFixLongSides(deep)).toEqual(["left", "right"]);        // …and this is the mutation check
    expect(dockSidesFor(deep).dockSides).toEqual(["top", "bottom"]); // the docks do NOT move
  });

  it("dragging THROUGH square never flips, and never flips back", () => {
    const el = B({ dockAxis: "x", dockSide: "bottom" });
    const seen = new Set();
    for (const w of [900, 400, 301, 300, 299, 200, 299, 300, 301, 900]) {
      seen.add(dockSidesFor({ ...el, w }).dockSides.join(","));
    }
    expect([...seen]).toEqual(["top,bottom"]);
  });

  it("a stored dockSide WINS over the derived axis, always (it is the more specific statement)", () => {
    // 300 × 900: the aspect ratio says left/right. An established building docked on "bottom" stays there.
    const el = { type: "building", w: 300, h: 900, dock: "single", dockAxis: "x", dockSide: "bottom" };
    expect(preFixLongSides(el)).toEqual(["left", "right"]);
    expect(dockAxisOf(el)).toBe("x");
    expect(dockSidesFor(el).dockSides).toEqual(["bottom"]);
  });

  it("an UN-established building keeps the old validation of dockSide (legacy appearance preserved)", () => {
    // This is the case the `established` gate exists for: a legacy record whose dockSide disagrees
    // with what it currently renders. Honouring it unconditionally would strand its bonded zones.
    const el = { type: "building", w: 300, h: 900, dock: "single", dockSide: "top" };
    expect(dockSidesFor(el).dockSides).toEqual(["right"]);
  });

  it("dock: none still reports no dock sides, at any orientation", () => {
    expect(dockSidesFor(B({ dock: "none", dockAxis: "y" })).dockSides).toEqual([]);
    expect(dockSidesFor({ w: 900, h: 300, dock: "none" }).dockSides).toEqual([]);
  });
});

describe("establishing the orientation preserves exactly what the plan renders today", () => {
  it("stamps the DERIVED axis, so nothing on screen moves", () => {
    for (const [w, h] of [[900, 300], [300, 900], [580, 580]]) {
      const el = { id: "b", type: "building", w, h, dock: "cross" };
      const before = dockSidesFor(el).dockSides;
      const after = dockSidesFor(withDockAxis(el)).dockSides;
      expect(after).toEqual(before);
    }
  });

  it("normalises a stale single-load dockSide to the wall the plan actually shows", () => {
    const el = { id: "b", type: "building", w: 300, h: 900, dock: "single", dockSide: "top" };
    expect(dockSidesFor(el).dside).toBe("right");            // what it renders
    const stamped = withDockAxis(el);
    expect(stamped.dockAxis).toBe("y");
    expect(stamped.dockSide).toBe("right");                  // the stale "top" is corrected, not enshrined
    expect(dockSidesFor(stamped).dockSides).toEqual(["right"]);
  });

  it("is a no-op for an already-stamped building, a dog-ear, and a non-building", () => {
    expect(establishDockAxisPatch(B({ dockAxis: "x" }))).toBe(null);
    expect(establishDockAxisPatch({ type: "building", w: 9, h: 3, dogEar: { side: "top", sign: 1 } })).toBe(null);
    expect(establishDockAxisPatch({ type: "pond", w: 9, h: 3 })).toBe(null);
    expect(establishDockAxisPatch(null)).toBe(null);
  });

  it("healDockAxes is IDENTITY-STABLE when there is nothing to establish", () => {
    const els = [B({ dockAxis: "x" }), { id: "p", type: "pond", w: 1, h: 1 }];
    expect(healDockAxes(els)).toBe(els);
    const dirty = [B(), { id: "p", type: "pond", w: 1, h: 1 }];
    const healed = healDockAxes(dirty);
    expect(healed).not.toBe(dirty);
    expect(healed[0].dockAxis).toBe("x");
    expect(healed[1]).toBe(dirty[1]);                        // untouched members keep their identity
  });
});

describe("turning the dock face is DELIBERATE, and it is the only thing that moves it", () => {
  it("cross-dock swaps the pair", () => {
    const el = B({ dockAxis: "x", dockSide: "bottom" });
    const turned = { ...el, ...rotateDockAxisPatch(el) };
    expect(dockSidesFor(turned).dockSides).toEqual(["left", "right"]);
    const back = { ...turned, ...rotateDockAxisPatch(turned) };
    expect(dockSidesFor(back).dockSides).toEqual(["top", "bottom"]);
  });

  it("single-load maps its wall a quarter turn and stays on one wall", () => {
    for (const [from, to] of [["top", "left"], ["bottom", "right"], ["left", "top"], ["right", "bottom"]]) {
      const el = { type: "building", w: 900, h: 300, dock: "single", dockAxis: DOCK_AXES.x.includes(from) ? "x" : "y", dockSide: from };
      const turned = { ...el, ...rotateDockAxisPatch(el) };
      expect(dockSidesFor(turned).dockSides).toEqual([to]);
    }
  });
});

describe("B548 — the readouts follow the STORED orientation, and cannot disagree with it", () => {
  it("depth stays perpendicular to the loaded wall even when it exceeds the length", () => {
    const el = B({ dockAxis: "x", dockSide: "bottom", w: 250, h: 300 }); // deeper than it is long
    expect(footprintAxes(el)).toEqual({ depth: "h", length: "w" });
    expect(footprintDepth(el)).toBe(300);
    expect(footprintLength(el)).toBe(250);
    // The old rule would have swapped both, which is exactly the "it recomputed where the docks
    // went versus where the parking went" the owner saw.
    expect(preFixLongSides(el)).toEqual(["left", "right"]);
  });

  it("length is always measured along a wall that dockSidesFor calls a dock side", () => {
    for (const el of [
      B({ dockAxis: "x", dockSide: "bottom", w: 250, h: 300 }),
      B({ dockAxis: "y", dockSide: "left", w: 900, h: 300 }),
      { type: "building", w: 900, h: 300, dock: "single", dockAxis: "y", dockSide: "left" },
    ]) {
      const { dockSides, dside } = dockSidesFor(el);
      const side = dockSides[0] || dside;
      const horiz = side === "top" || side === "bottom";
      expect(footprintAxes(el).length).toBe(horiz ? "w" : "h");
    }
  });
});
