/* foodRatingSlider — GUARD for the owner's rating decision (NEW-1, 2026-10-05; CLAUDE.md "Owner
 * product constraints" #16): a visit's Food rating and Ambiance rating are each ONE slider, 1 to 10
 * in HALF-point steps. This file fails if the range or step changes, or if tap buttons / a stepper
 * / whole numbers come back. Red on the code before this change (phone rendered a 1-10 tap grid;
 * desktop stepped by 0.25). Browser half: ui-audit/verify-food-rating-and-sheet.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RATING_MIN, RATING_MAX, RATING_STEP } from "../src/workspaces/food/lib/ratingScale.js";
import { RatingSlider } from "../src/workspaces/food/components/VisitPanel.jsx";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");
const render = (props) => renderToStaticMarkup(createElement(RatingSlider, { onChange() {}, label: "Food rating", ...props }));

describe("Food / Ambiance rating = one slider, 1 to 10, half-point steps", () => {
  it("the scale is exactly 1, 10, 0.5 — change a number here only with Michael's say-so", () => {
    expect([RATING_MIN, RATING_MAX, RATING_STEP]).toEqual([1, 10, 0.5]);
  });

  for (const isMobile of [true, false]) {
    it(`${isMobile ? "phone" : "desktop"}: renders ONE range input with min 1 / max 10 / step 0.5 and no tap buttons or stepper`, () => {
      const html = render({ value: null, isMobile });
      expect(html.match(/type="range"/g)).toHaveLength(1);
      expect(html).toMatch(/min="1"/);
      expect(html).toMatch(/max="10"/);
      expect(html).toMatch(/step="0.5"/);
      expect(html).not.toContain("score-tap");
      expect(html).not.toMatch(/<button[^>]*>\s*[−+-]\s*<\/button>/); // no stepper
      expect(html).toContain("Not rated"); // default: nothing rated until touched
    });
  }

  it("a saved half-point or quarter-point rating displays exactly as saved", () => {
    expect(render({ value: 7.5 })).toContain("7.5 / 10");
    expect(render({ value: 8.75 })).toContain("8.75 / 10"); // saved in the quarter-point period
    expect(render({ value: 8 })).toContain("8 / 10");
  });

  it("the visit form (first visit, log another, edit an old one — one component) uses it for BOTH Food and Ambiance", () => {
    const panel = read("src/workspaces/food/components/VisitPanel.jsx");
    expect(panel).toMatch(/<RatingSlider value=\{rating\} onChange=\{setRating\} label="Food rating"/);
    expect(panel).toMatch(/<RatingSlider value=\{ratingAmbiance\} onChange=\{setRatingAmbiance\} label="Ambiance rating"/);
    expect(panel).toMatch(/min=\{RATING_MIN\}\s*max=\{RATING_MAX\}\s*step=\{RATING_STEP\}/);
    const slider = panel.slice(panel.indexOf("export function RatingSlider"), panel.indexOf("function fieldStyle"));
    expect(slider).not.toMatch(/ScoreTapGrid|nudgeScore|score-tap/);
  });

  it("no tap-button rating grid exists anywhere in the Food components", () => {
    for (const f of ["VisitPanel", "ScoreMeter", "DishesSection"]) {
      expect(read(`src/workspaces/food/components/${f}.jsx`)).not.toMatch(/ScoreTapGrid|data-testid="score-tap/);
    }
  });

  it("the decision is written down where every session reads it (CLAUDE.md, Owner product constraints)", () => {
    const claude = read("CLAUDE.md");
    expect(claude).toMatch(/Food ratings are one slider each, 1 to 10 in half steps/);
    expect(claude).toMatch(/lib\/ratingScale\.js/);
  });
});
