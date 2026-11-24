import { describe, it, expect } from "vitest";
import {
  MIN_FRAME_FT, FRAME_GRIPS, frameGripAnchor, resizeFrame, orientationForAspect,
} from "../src/workspaces/site-planner/lib/printFrameDrag.js";

// The OLD locked-aspect corner drag, replayed verbatim from the pre-fix SitePlanner.jsx
// onMove handler, as a mutation check: this is what NEW-1 removes as the DEFAULT and keeps
// as the Shift-held behavior. If resizeFrame's free (non-snap) path ever regresses back to
// this formula, these tests catch it.
function legacyLockedResize({ opp, sx, sy, aspect, fp }) {
  const wFt = Math.max(Math.abs(fp.x - opp.x), Math.abs(fp.y - opp.y) * aspect, 40);
  const hFt = wFt / aspect;
  return { cx: opp.x + sx * wFt / 2, cy: opp.y + sy * hFt / 2, wFt, hFt };
}

describe("FRAME_GRIPS — eight grips, corners and mid-edges", () => {
  it("has exactly 4 corners (both axes non-zero) and 4 edges (exactly one axis zero)", () => {
    const corners = FRAME_GRIPS.filter((g) => g.sx !== 0 && g.sy !== 0);
    const edges = FRAME_GRIPS.filter((g) => g.sx === 0 || g.sy === 0);
    expect(corners.length).toBe(4);
    expect(edges.length).toBe(4);
    expect(FRAME_GRIPS.length).toBe(8);
  });
});

describe("frameGripAnchor — the fixed point a grip drags around", () => {
  const frame = { cx: 100, cy: 200, wFt: 80, hFt: 40 };
  it("a corner grip anchors the OPPOSITE corner", () => {
    expect(frameGripAnchor(frame, 1, 1)).toEqual({ x: 100 - 40, y: 200 - 20 }); // dragging SE anchors NW
    expect(frameGripAnchor(frame, -1, -1)).toEqual({ x: 100 + 40, y: 200 + 20 }); // dragging NW anchors SE
  });
  it("an edge grip anchors the opposite EDGE on its axis and the CENTER on the other", () => {
    expect(frameGripAnchor(frame, 1, 0)).toEqual({ x: 100 - 40, y: 200 }); // E grip: W edge + vertical center
    expect(frameGripAnchor(frame, 0, -1)).toEqual({ x: 100, y: 200 + 20 }); // N grip: horizontal center + S edge
  });
});

describe("resizeFrame — free drag (NEW-1 default): unconstrained, no aspect coupling", () => {
  it("a corner grip sizes BOTH axes independently — this is exactly what the OLD code could never do", () => {
    // Old behavior would force hFt = wFt / aspect; prove the new one does not.
    const opp = { x: 0, y: 0 };
    const r = resizeFrame({ opp, sx: 1, sy: 1, wFt0: 80, hFt0: 40, fp: { x: 300, y: 60 }, aspect: 11 / 8.5, snap: false });
    expect(r.wFt).toBeCloseTo(300, 6);
    expect(r.hFt).toBeCloseTo(60, 6);
    // A frame this shape (5:1) could never have been produced by the pre-fix formula, which
    // forced hFt = wFt / aspect no matter where the pointer actually was — replaying it here
    // disagrees with the fix on height, which is exactly the regression this test guards.
    const legacy = legacyLockedResize({ opp, sx: 1, sy: 1, aspect: 11 / 8.5, fp: { x: 300, y: 60 } });
    expect(legacy.hFt).not.toBeCloseTo(r.hFt, 3);
    expect(legacy.hFt).toBeCloseTo(300 / (11 / 8.5), 6); // the old formula's forced coupling
  });

  it("an E/W edge grip changes width ONLY — height is untouched even if the pointer drifts vertically", () => {
    const frame = { cx: 0, cy: 0, wFt: 80, hFt: 40 };
    const opp = frameGripAnchor(frame, 1, 0); // E grip
    const r = resizeFrame({ opp, sx: 1, sy: 0, wFt0: frame.wFt, hFt0: frame.hFt, fp: { x: 200, y: 999 }, aspect: 11 / 8.5, snap: false });
    expect(r.wFt).toBeCloseTo(200 - opp.x, 6);
    expect(r.hFt).toBe(40); // untouched — the y-drift above must be ignored
    expect(r.cy).toBe(0); // vertical center never moves for a pure horizontal drag
  });

  it("an N/S edge grip changes height ONLY — width is untouched even if the pointer drifts horizontally", () => {
    const frame = { cx: 0, cy: 0, wFt: 80, hFt: 40 };
    const opp = frameGripAnchor(frame, 0, 1); // S grip
    const r = resizeFrame({ opp, sx: 0, sy: 1, wFt0: frame.wFt, hFt0: frame.hFt, fp: { x: -500, y: 90 }, aspect: 11 / 8.5, snap: false });
    expect(r.hFt).toBeCloseTo(90 - opp.y, 6);
    expect(r.wFt).toBe(80);
    expect(r.cx).toBe(0);
  });

  it("floors both axes at MIN_FRAME_FT rather than collapsing to zero/negative", () => {
    const opp = { x: 0, y: 0 };
    const r = resizeFrame({ opp, sx: 1, sy: 1, wFt0: 80, hFt0: 40, fp: { x: 1, y: -1 }, aspect: 1, snap: false });
    expect(r.wFt).toBe(MIN_FRAME_FT);
    expect(r.hFt).toBe(MIN_FRAME_FT);
  });

  it("dragging the opposite corner produces a wide (3:1) then a tall (1:3) frame — the reported bug", () => {
    // "he wants whatever aspect ratio he chooses" — prove both extremes are reachable.
    const frame0 = { cx: 0, cy: 0, wFt: 100, hFt: 100 };
    const opp = frameGripAnchor(frame0, 1, 1);
    const wide = resizeFrame({ opp, sx: 1, sy: 1, wFt0: frame0.wFt, hFt0: frame0.hFt, fp: { x: opp.x + 300, y: opp.y + 100 }, aspect: 11 / 8.5, snap: false });
    expect(wide.wFt / wide.hFt).toBeCloseTo(3, 6);
    const tall = resizeFrame({ opp, sx: 1, sy: 1, wFt0: frame0.wFt, hFt0: frame0.hFt, fp: { x: opp.x + 100, y: opp.y + 300 }, aspect: 11 / 8.5, snap: false });
    expect(tall.hFt / tall.wFt).toBeCloseTo(3, 6);
  });
});

describe("resizeFrame — Shift-held snap: reproduces the OLD locked-aspect drag exactly", () => {
  const aspect = 11 / 8.5;

  it("a corner grip snapped matches the legacy formula bit-for-bit", () => {
    const opp = { x: 10, y: 20 };
    const fp = { x: 400, y: 500 };
    const r = resizeFrame({ opp, sx: 1, sy: 1, wFt0: 80, hFt0: 40, fp, aspect, snap: true });
    const legacy = legacyLockedResize({ opp, sx: 1, sy: 1, aspect, fp });
    expect(r).toEqual(legacy);
    expect(r.wFt / r.hFt).toBeCloseTo(aspect, 9);
  });

  it("an edge grip snapped still yields the sheet's exact aspect", () => {
    const frame = { cx: 0, cy: 0, wFt: 80, hFt: 40 };
    const opp = frameGripAnchor(frame, 1, 0); // E grip
    const r = resizeFrame({ opp, sx: 1, sy: 0, wFt0: frame.wFt, hFt0: frame.hFt, fp: { x: 260, y: 12345 }, aspect, snap: true });
    expect(r.wFt / r.hFt).toBeCloseTo(aspect, 9);
    expect(r.cy).toBe(0); // symmetric about the frame's original vertical center
  });

  it("an N/S edge grip snapped also yields the sheet's exact aspect, anchored on the fixed horizontal center", () => {
    const frame = { cx: 5, cy: 5, wFt: 80, hFt: 40 };
    const opp = frameGripAnchor(frame, 0, 1); // S grip
    const r = resizeFrame({ opp, sx: 0, sy: 1, wFt0: frame.wFt, hFt0: frame.hFt, fp: { x: -9999, y: 205 }, aspect, snap: true });
    expect(r.wFt / r.hFt).toBeCloseTo(aspect, 9);
    expect(r.cx).toBe(5);
  });
});

describe("orientationForAspect", () => {
  it("wide-or-square is landscape, tall is portrait", () => {
    expect(orientationForAspect(11 / 8.5)).toBe("landscape");
    expect(orientationForAspect(1)).toBe("landscape");
    expect(orientationForAspect(8.5 / 11)).toBe("portrait");
    expect(orientationForAspect(3)).toBe("landscape");
    expect(orientationForAspect(1 / 3)).toBe("portrait");
  });
});
