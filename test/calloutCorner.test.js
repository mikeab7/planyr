import { describe, it, expect } from "vitest";
import { calloutCornerRadius, CALLOUT_CORNER_FRAC } from "../src/shared/markup/geometry.js";
import { calloutDblZone } from "../src/shared/markup/hitTest.js";

/* NEW-1 — the callout border corner radius must be ZOOM-INVARIANT (identical shape at every zoom)
 * and read as a near-rectangle. The old bug was a FIXED-pixel radius: a small (zoomed-out) box
 * rounded into a bubble while a large (zoomed-in) box stayed square. The fix ties the radius to a
 * small, constant fraction of the box's shorter side, so the shape is a scaled copy at every zoom. */
describe("calloutCornerRadius — zoom-invariant, rectangular", () => {
  it("is a constant fraction of the SHORTER side (orientation-independent)", () => {
    expect(calloutCornerRadius(100, 40)).toBeCloseTo(40 * CALLOUT_CORNER_FRAC, 9);
    expect(calloutCornerRadius(40, 100)).toBeCloseTo(40 * CALLOUT_CORNER_FRAC, 9); // same box, rotated
  });

  it("gives the SAME shape at every zoom (radius / shorter-side is constant)", () => {
    // A box drawn at zoom z, then re-drawn at 2×/4× zoom, is the same box scaled — so the ratio of
    // corner radius to the box's shorter side must not change (that ratio IS the corner's shape).
    const ratio = (w, h) => calloutCornerRadius(w, h) / Math.min(w, h);
    expect(ratio(100, 40)).toBeCloseTo(ratio(200, 80), 9);
    expect(ratio(200, 80)).toBeCloseTo(ratio(400, 160), 9);
    expect(ratio(30, 30)).toBeCloseTo(ratio(300, 300), 9);
  });

  it("stays LOW so it reads as a rectangle (well under a rounded-bubble)", () => {
    expect(CALLOUT_CORNER_FRAC).toBeLessThanOrEqual(0.1);
  });

  it("can never round into a pill (radius is far below the half-side)", () => {
    for (const [w, h] of [[24, 24], [200, 18], [18, 200], [90, 32]]) {
      expect(calloutCornerRadius(w, h)).toBeLessThan(Math.min(w, h) / 2);
    }
  });

  it("guards degenerate sizes → 0 (never NaN / negative)", () => {
    expect(calloutCornerRadius(0, 0)).toBe(0);
    expect(calloutCornerRadius(-50, 20)).toBe(0);
  });
});

/* NEW-2 — the location-based double-click zone: interior text → edit, border band → Properties,
 * outside the box (e.g. a leader) → the caller opens Properties. Unit-agnostic (px or world). */
describe("calloutDblZone — interior vs border vs outside", () => {
  const box = { x: 100, y: 100, w: 120, h: 60 };

  it("dead-centre is INTERIOR (edit text)", () => {
    expect(calloutDblZone(box, { x: 160, y: 130 }, 6)).toBe("interior");
  });

  it("within the tol band of any edge is BORDER (open Properties)", () => {
    expect(calloutDblZone(box, { x: 103, y: 130 }, 6)).toBe("border"); // 3 in from the left edge
    expect(calloutDblZone(box, { x: 160, y: 158 }, 6)).toBe("border"); // 2 in from the bottom edge
    expect(calloutDblZone(box, { x: 100, y: 100 }, 6)).toBe("border"); // exactly a corner
  });

  it("just inside the band boundary flips to INTERIOR", () => {
    expect(calloutDblZone(box, { x: 100 + 7, y: 130 }, 6)).toBe("interior"); // 7 in > 6 band
  });

  it("off the box is OUTSIDE (leader / miss)", () => {
    expect(calloutDblZone(box, { x: 50, y: 130 }, 6)).toBe("outside");
    expect(calloutDblZone(box, { x: 160, y: 400 }, 6)).toBe("outside");
  });

  it("a tiny box always keeps a reachable interior (band clamped to 35% of the short side)", () => {
    // short side 10, tol 6 would be > half → clamp to 3.5 so the centre stays editable.
    const tiny = { x: 0, y: 0, w: 40, h: 10 };
    expect(calloutDblZone(tiny, { x: 20, y: 5 }, 6)).toBe("interior"); // centre → edit
    expect(calloutDblZone(tiny, { x: 20, y: 1 }, 6)).toBe("border");   // 1 from top edge → props
  });

  it("scales with the viewport (world units: pass tol = px / scale)", () => {
    // Same geometry as `box` but in world units at scale 2 → the 6px band is 3 world units.
    const wbox = { x: 50, y: 50, w: 60, h: 30 };
    expect(calloutDblZone(wbox, { x: 80, y: 65 }, 6 / 2)).toBe("interior"); // centre
    expect(calloutDblZone(wbox, { x: 51.5, y: 65 }, 6 / 2)).toBe("border"); // 1.5 world in < 3 band
  });

  it("guards a null / zero-area box", () => {
    expect(calloutDblZone(null, { x: 0, y: 0 }, 6)).toBe("outside");
    expect(calloutDblZone({ x: 0, y: 0, w: 0, h: 0 }, { x: 0, y: 0 }, 6)).toBe("outside");
  });
});
