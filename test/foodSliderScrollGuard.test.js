/* foodSliderScrollGuard — the CI-runnable half of "a vertical swipe that starts on a rating slider scrolls the card and leaves the rating
 * alone" (V1476080 step 3). The browser half is ui-audit/verify-food-visit-phone.mjs arm 7 (Chromium + real touch events: RED on main —
 * mid-track swipe moved 7.75 → 5.5, left end 7.75 → 1.75 — and green with the guard). iOS Safari's own behaviour is a real-finger step. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { isVerticalScroll, SCROLL_SLOP_PX } from "../src/workspaces/food/lib/sliderScrollGuard.js";

const FOOD = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src", "workspaces", "food");
const read = (rel) => readFileSync(join(FOOD, rel), "utf8");

describe("isVerticalScroll", () => {
  it("is a scroll only when vertical movement is past the slop AND dominates the horizontal", () => {
    expect(isVerticalScroll(0, 40)).toBe(true);
    expect(isVerticalScroll(5, -60)).toBe(true);
    expect(isVerticalScroll(30, 40)).toBe(true);
  });
  it("a horizontal drag (the slider's own gesture) and a tap are never a scroll", () => {
    expect(isVerticalScroll(80, 4)).toBe(false);
    expect(isVerticalScroll(40, 30)).toBe(false);   // a diagonal that is still mostly sideways
    expect(isVerticalScroll(0, 0)).toBe(false);     // a tap
    expect(isVerticalScroll(0, SCROLL_SLOP_PX)).toBe(false); // wobble within the slop
    expect(isVerticalScroll(0, SCROLL_SLOP_PX + 1)).toBe(true);
  });
});

describe("both rating sliders use the guard (a refactor that drops it silently brings the defect back)", () => {
  it("the visit's Food/Ambiance RatingSlider spreads it onto the range input", () => {
    const src = read("components/VisitPanel.jsx");
    expect(src).toMatch(/const scrollGuard = useScrollSafeSlider\(value, onChange\)/);
    expect(src).toMatch(/data-testid="rating-slider" \{\.\.\.scrollGuard\}/);
  });
  it("the per-dish ScoreMeter spreads it onto its range input", () => {
    const src = read("components/ScoreMeter.jsx");
    expect(src).toMatch(/const scrollGuard = useScrollSafeSlider\(value, onChange\)/);
    expect(src).toMatch(/data-testid="dish-score-slider" \{\.\.\.scrollGuard\}/);
  });
});
