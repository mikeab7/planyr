import { describe, it, expect } from "vitest";
import {
  DOCK_ZONES, MAX_DOCK_ZONES, zoneDepthDefaults, zoneDepthDefault, layoutZone, layoutStack,
} from "../src/workspaces/site-planner/lib/dockZones.js";

const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

describe("DOCK_ZONES — fixed outward order (B228)", () => {
  it("is court → trailer parking → buffer, outward from the dock face", () => {
    expect(DOCK_ZONES.map((z) => z.key)).toEqual(["court", "trailer", "buffer"]);
    expect(MAX_DOCK_ZONES).toBe(3);
  });
  it("maps each zone to its drawn element type (buffer = sage landscape strip)", () => {
    expect(DOCK_ZONES.map((z) => z.type)).toEqual(["paving", "trailer", "landscape"]);
  });
});

describe("zoneDepthDefaults — user-configurable, not hardcoded", () => {
  it("falls back to 135 / 50 / 15 when settings are empty", () => {
    expect(zoneDepthDefaults({})).toEqual([135, 50, 15]);
    expect(zoneDepthDefaults()).toEqual([135, 50, 15]);
  });
  it("honours per-plan overrides (Michael's buffer default is 15)", () => {
    expect(zoneDepthDefaults({ truckCourtD: 140, trailerParkD: 60, bufferD: 20 })).toEqual([140, 60, 20]);
    expect(zoneDepthDefault(2, { bufferD: 25 })).toBe(25);
  });
  it("ignores non-positive / non-numeric overrides", () => {
    expect(zoneDepthDefaults({ truckCourtD: 0, trailerParkD: -5, bufferD: "x" })).toEqual([135, 50, 15]);
  });
});

describe("layoutZone — flush-outward stacking on each side", () => {
  // 300' x 600' building at the origin, no rotation. Long sides are top/bottom.
  const b = { cx: 0, cy: 0, w: 600, h: 300, rot: 0 };
  const depths = [135, 50, 15];

  it("court (i=0) hugs the building face, full wall length", () => {
    const g = layoutZone(b, "bottom", 0, depths);
    expect(g.w).toBe(600);              // full wall length
    expect(g.h).toBe(135);              // its depth
    expect(near(g.cy, 150 + 135 / 2)).toBe(true);  // half-height + half-depth outward (+y = bottom)
    expect(near(g.cx, 0)).toBe(true);
    expect(g.rot).toBe(0);
  });

  it("trailer (i=1) sits flush beyond the court, rotated to run along the wall", () => {
    const g = layoutZone(b, "bottom", 1, depths);
    expect(g.w).toBe(600);              // wall length
    expect(g.h).toBe(50);               // trailer depth
    // beyond the court: half-height + court depth + half its own depth
    expect(near(g.cy, 150 + 135 + 50 / 2)).toBe(true);
    expect(g.rot).toBe(0);              // bottom wall → no extra rotation
  });

  it("buffer (i=2) sits flush beyond the trailer", () => {
    const g = layoutZone(b, "bottom", 2, depths);
    expect(g.h).toBe(15);
    expect(near(g.cy, 150 + 135 + 50 + 15 / 2)).toBe(true);
  });

  it("the three zones never overlap and are gap-free (court out → buffer out)", () => {
    const [c, t, bf] = [0, 1, 2].map((i) => layoutZone(b, "bottom", i, depths));
    const farFace = (g) => g.cy + g.h / 2, nearFace = (g) => g.cy - g.h / 2;
    expect(near(nearFace(c), 150)).toBe(true);          // court near face = building face
    expect(near(nearFace(t), farFace(c))).toBe(true);   // trailer near face = court far face
    expect(near(nearFace(bf), farFace(t))).toBe(true);  // buffer near face = trailer far face
  });

  it("on a vertical (left/right) dock side the trailer is rotated 90° but still depth-correct", () => {
    const tall = { cx: 0, cy: 0, w: 300, h: 600, rot: 0 }; // long sides now left/right
    const g = layoutZone(tall, "right", 1, depths);
    expect(g.w).toBe(600);              // along the wall (the tall axis)
    expect(g.h).toBe(50);               // depth
    expect(g.rot).toBe(90);             // rotated so stalls stripe along the wall
    expect(near(g.cx, 150 + 135 + 50 / 2)).toBe(true); // +x = right, beyond the court
  });

  it("respects building rotation (zones extend along the rotated normal)", () => {
    const rb = { cx: 0, cy: 0, w: 600, h: 300, rot: 90 };
    const g = layoutZone(rb, "bottom", 0, depths);
    // bottom normal (0,1) rotated 90° → (-1, 0); centre at distance 150+67.5 along it
    expect(near(g.cx, -(150 + 135 / 2))).toBe(true);
    expect(near(g.cy, 0)).toBe(true);
  });
});

describe("layoutStack — positions every present zone at once", () => {
  const b = { cx: 10, cy: 20, w: 400, h: 200, rot: 0 };
  it("returns one entry per depth, indexed and gap-free", () => {
    const out = layoutStack(b, "top", [135, 50, 15]);
    expect(out.map((z) => z.i)).toEqual([0, 1, 2]);
    // top side: outward is -y; near faces chain outward
    const nearFace = (g) => g.cy + g.h / 2; // toward the building (since outward is -y)
    expect(near(nearFace(out[0].geom), b.cy - 100)).toBe(true);
  });
});
