/* foodLandscapeLayout — the pure half of "Food on a phone, sideways" (B2046224 ×4). The browser half is
 * ui-audit/verify-food-landscape.mjs (WebKit iPhone 15 / SE, both rotations + portrait). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LANDSCAPE_PHONE_QUERY, isLandscapePhone, visibleMapBox, centringPan, SIDE_CARD_CSS_WIDTH } from "../src/workspaces/food/lib/phoneLayout.js";

const fakeWin = (matches) => ({ matchMedia: (q) => ({ matches: matches && q === LANDSCAPE_PHONE_QUERY }) });

describe("landscape phone detection", () => {
  it("matches only the landscape-phone query, never throws without matchMedia", () => {
    expect(isLandscapePhone(fakeWin(true))).toBe(true);
    expect(isLandscapePhone(fakeWin(false))).toBe(false);
    expect(isLandscapePhone({})).toBe(false);
    expect(isLandscapePhone(null)).toBe(false);
  });
  it("is height-bound and touch-only, so upright phones and desktop windows never match", () => {
    expect(LANDSCAPE_PHONE_QUERY).toMatch(/orientation: landscape/);
    expect(LANDSCAPE_PHONE_QUERY).toMatch(/max-height: \d+px/);
    expect(LANDSCAPE_PHONE_QUERY).toMatch(/pointer: coarse/);
  });
  it("side card is at most the desktop rail and a bounded share of a small screen", () => {
    expect(SIDE_CARD_CSS_WIDTH).toBe("min(340px, 44vw)");
  });
});

describe("visible map box", () => {
  it("excludes the card on the right and the notch on the left", () => {
    const b = visibleMapBox({ width: 700, height: 300, cardPx: 300, insetLeft: 50 });
    expect(b).toMatchObject({ left: 50, right: 400, top: 0, bottom: 300 });
    expect(b.cx).toBe(225);
    expect(b.cy).toBe(150);
  });
  it("never inverts when the card is wider than the container", () => {
    const b = visibleMapBox({ width: 200, height: 300, cardPx: 500 });
    expect(b.right).toBeGreaterThanOrEqual(b.left);
  });
  it("a bottom sheet shrinks the bottom instead", () => {
    expect(visibleMapBox({ width: 400, height: 800, sheetPx: 300 }).cy).toBe(250);
  });
});

describe("centringPan", () => {
  const box = visibleMapBox({ width: 700, height: 300, cardPx: 300 }); // 0..400 × 0..300
  it("leaves a pin that is comfortably visible where it is", () => {
    expect(centringPan({ point: { x: 120, y: 90 }, box })).toBeNull();
  });
  it("recentres a pin hidden under the card (RED on the old code: nothing moved it)", () => {
    const pan = centringPan({ point: { x: 560, y: 150 }, box });
    expect(pan).toEqual({ dx: 360, dy: 0 });
  });
  it("recentres a pin hugging an edge", () => {
    expect(centringPan({ point: { x: 395, y: 150 }, box })).not.toBeNull();
  });
  it("ignores garbage", () => {
    expect(centringPan({ point: { x: NaN, y: 1 }, box })).toBeNull();
    expect(centringPan({ point: null, box })).toBeNull();
  });
});

describe("wiring", () => {
  it("VisitPanel, FoodMap and FoodApp all read the one landscape query", () => {
    for (const f of ["components/VisitPanel.jsx", "components/FoodMap.jsx", "FoodApp.jsx"]) {
      expect(readFileSync(new URL(`../src/workspaces/food/${f}`, import.meta.url), "utf8")).toMatch(/useLandscapePhone/);
    }
  });
});
