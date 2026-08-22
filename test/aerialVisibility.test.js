// B688864 — see src/workspaces/site-planner/lib/aerialVisibility.js header for the bug this closes:
// the References panel's aerial Hide/Remove controls only ever touched the captured `underlay`
// image, never the LIVE basemap tile layer that actually paints the aerial on every georeferenced
// plan — so on the 48 production plans captured from the Map picker, Hide changed nothing on
// screen and Remove left the identical-looking aerial in place.
import { describe, it, expect } from "vitest";
import {
  isAerialVisible,
  withAerialVisible,
  isAerialTileActive,
  wantBasemapSrc,
} from "../src/workspaces/site-planner/lib/aerialVisibility.js";

describe("isAerialVisible", () => {
  it("is visible on an untouched plan (no aerialHidden key at all)", () => {
    expect(isAerialVisible({})).toBe(true);
    expect(isAerialVisible(undefined)).toBe(true);
  });
  it("is hidden once aerialHidden is stamped", () => {
    expect(isAerialVisible({ aerialHidden: true })).toBe(false);
  });
});

describe("withAerialVisible", () => {
  it("hiding stamps the key", () => {
    const out = withAerialVisible({ snap: true }, false);
    expect(out).toEqual({ snap: true, aerialHidden: true });
  });
  it("showing removes the key entirely — sparse, no residue", () => {
    const out = withAerialVisible({ snap: true, aerialHidden: true }, true);
    expect(out).toEqual({ snap: true });
    expect("aerialHidden" in out).toBe(false);
  });
  it("showing an already-visible plan is a true no-op — same object identity", () => {
    const s = { snap: true };
    expect(withAerialVisible(s, true)).toBe(s);
  });
  it("hiding an already-hidden plan is a true no-op — same object identity", () => {
    const s = { aerialHidden: true };
    expect(withAerialVisible(s, false)).toBe(s);
  });
  it("round-trips: hide then show returns to an equivalent (key-free) shape", () => {
    const start = { setback: 25 };
    const hidden = withAerialVisible(start, false);
    const shown = withAerialVisible(hidden, true);
    expect(shown).toEqual(start);
  });
  it("never mutates the input", () => {
    const s = { snap: true };
    withAerialVisible(s, false);
    expect(s).toEqual({ snap: true });
  });
});

describe("isAerialTileActive / wantBasemapSrc — the actual defect", () => {
  it("tiles are active only when the basemap technique is on AND the aerial is not hidden", () => {
    expect(isAerialTileActive(true, true)).toBe(true);
    expect(isAerialTileActive(true, false)).toBe(false);
    expect(isAerialTileActive(false, true)).toBe(false);
    expect(isAerialTileActive(false, false)).toBe(false);
  });

  it("REGRESSION — hiding the aerial on a georeferenced (basemapOn) plan must silence the live tile layer", () => {
    // This is the exact production shape: 48/48 plans opened from the Map picker carry
    // fromMap:true and load with basemapOn defaulting true. The owner hides the aerial from
    // the References panel (aerialVisible -> false); the live basemap must stop, not keep painting.
    expect(wantBasemapSrc(/* basemapOn */ true, /* aerialVisible */ false, "esri")).toBe(null);
  });

  it("shown + basemap on -> the live tile source is requested", () => {
    expect(wantBasemapSrc(true, true, "esri")).toBe("esri");
  });

  it("basemap off -> null regardless of the hide flag (the row-1 selector's own 'off' is untouched)", () => {
    expect(wantBasemapSrc(false, true, "esri")).toBe(null);
    expect(wantBasemapSrc(false, false, "esri")).toBe(null);
  });

  it("MUTATION CHECK — replaying the pre-fix formula (`basemapOn ? basemapSrc : null`, blind to aerialVisible) gets the regression case wrong", () => {
    const preFixWant = (basemapOn, _aerialVisible, basemapSrc) => (basemapOn ? basemapSrc : null);
    // Pre-fix: hiding a georeferenced plan's aerial left the live tiles on — this is the bug.
    expect(preFixWant(true, false, "esri")).toBe("esri");
    // Post-fix disagrees with it on exactly this case, which is the whole point of the fix.
    expect(wantBasemapSrc(true, false, "esri")).not.toBe(preFixWant(true, false, "esri"));
  });
});
