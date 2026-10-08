/* B2163346 — the click a handle drag's release produces must not deselect the armed site plan on the Map. */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { markGestureEnd, gestureJustEnded, _resetGestureClock, GESTURE_CLICK_GRACE_MS } from "../src/workspaces/site-planner/lib/handleGestureClock.js";

describe("handleGestureClock", () => {
  beforeEach(() => _resetGestureClock());
  it("no gesture yet → a background click is a real one", () => expect(gestureJustEnded(1000)).toBe(false));
  it("the click right after a release is swallowed", () => { markGestureEnd(1000); expect(gestureJustEnded(1001)).toBe(true); expect(gestureJustEnded(1000 + GESTURE_CLICK_GRACE_MS - 1)).toBe(true); });
  it("a genuine background click a moment later still deselects", () => { markGestureEnd(1000); expect(gestureJustEnded(1000 + GESTURE_CLICK_GRACE_MS)).toBe(false); });
  it("wiring: the handles mark the release and the map's background click honours it", () => {
    const h = readFileSync(new URL("../src/workspaces/site-planner/lib/overlayPlacementHandles.js", import.meta.url), "utf8");
    const m = readFileSync(new URL("../src/workspaces/site-planner/MapFinder.jsx", import.meta.url), "utf8");
    expect(h).toMatch(/const onUp = \(\) => \{\s*markGestureEnd\(\)/);
    expect(m).toMatch(/activeOverlayIdRef\.current && !gestureJustEnded\(\)\) setActiveOverlayId\(null\)/);
  });
});
