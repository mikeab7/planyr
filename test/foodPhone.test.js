/* foodPhone — the CI-runnable half of "Food on a phone" (first visit, dish ratings, keyboard,
 * AutoFill). The on-phone half is ui-audit/verify-food-visit-phone.mjs (Playwright WebKit, emulated) and
 * V1476080 (real device). Each test below is red on the code before this change. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { keyboardInset, currentKeyboardInset, MIN_KEYBOARD_PX } from "../src/workspaces/food/lib/keyboardInset.js";
import { cleanDraftDishes, newDraftDish } from "../src/workspaces/food/lib/draftDishes.js";
import { noAutofill } from "../src/workspaces/food/lib/noAutofill.js";
import ScoreMeter, { ScoreTapGrid } from "../src/workspaces/food/components/ScoreMeter.jsx";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOOD = join(REPO, "src", "workspaces", "food");
const read = (rel) => readFileSync(join(FOOD, rel), "utf8");

describe("keyboardInset", () => {
  it("is the gap between the layout viewport's bottom and the visual viewport's bottom", () => {
    expect(keyboardInset({ innerHeight: 659, vvHeight: 323 })).toBe(336);
    expect(keyboardInset({ innerHeight: 659, vvHeight: 300, vvOffsetTop: 36 })).toBe(323); // iOS scrolled the visual viewport
  });
  it("ignores browser-chrome-sized differences (collapsing toolbar, pinch zoom)", () => {
    expect(keyboardInset({ innerHeight: 800, vvHeight: 800 })).toBe(0);
    expect(keyboardInset({ innerHeight: 800, vvHeight: 800 - MIN_KEYBOARD_PX })).toBe(0);
    expect(keyboardInset({ innerHeight: 800, vvHeight: 800 - MIN_KEYBOARD_PX - 1 })).toBe(MIN_KEYBOARD_PX + 1);
  });
  it("is 0 for anything unreadable, and when there is no visualViewport", () => {
    expect(keyboardInset({ innerHeight: NaN, vvHeight: 100 })).toBe(0);
    expect(currentKeyboardInset({ innerHeight: 600 })).toBe(0);
    expect(currentKeyboardInset({ innerHeight: 600, visualViewport: { height: 280, offsetTop: 0 } })).toBe(320);
  });
});

describe("cleanDraftDishes", () => {
  it("keeps named dishes with their rating, trimmed", () => {
    const rows = [{ ...newDraftDish(), name: "  Brisket ", score: 8 }, { ...newDraftDish(), name: "Queso", score: null }];
    expect(cleanDraftDishes(rows)).toEqual({ dishes: [{ name: "Brisket", score: 8 }, { name: "Queso", score: null }], error: null });
  });
  it("ignores a completely blank slot but refuses a rated dish with no name (loud, not dropped)", () => {
    expect(cleanDraftDishes([newDraftDish()])).toEqual({ dishes: [], error: null });
    const r = cleanDraftDishes([{ ...newDraftDish(), name: " ", score: 7 }]);
    expect(r.dishes).toEqual([]);
    expect(r.error).toMatch(/name the dish/i);
  });
});

describe("AutoFill opt-out", () => {
  it("noAutofill carries autocomplete=off and a caller-chosen name", () => {
    expect(noAutofill("dish-title")).toMatchObject({ name: "dish-title", autoComplete: "off", "data-form-type": "other" });
  });
  it("every free-text field in the Food module spreads noAutofill with a non-contact name", () => {
    const contact = /["'](name|first|last|full|email|phone|tel|address|street|city|zip|org|company)["']/i;
    const offenders = [];
    for (const f of readdirSync(join(FOOD, "components")).filter((n) => n.endsWith(".jsx"))) {
      const src = read(join("components", f));
      // each <input ...> / <textarea ...> opening tag (tags here never contain ">" inside attributes except "=>" arrows)
      const tags = src.match(/<(input|textarea)\b(?:=>|[^>])*?\/?>/gs) || [];
      for (const t of tags) {
        if (/type="(range|checkbox|radio|hidden)"/.test(t)) continue;
        if (!/noAutofill\(\s*"[a-z-]+"\s*\)/.test(t)) offenders.push(`${f}: ${t.replace(/\s+/g, " ").slice(0, 90)}`);
        const m = t.match(/noAutofill\(\s*("[^"]*")/);
        if (m && contact.test(m[1])) offenders.push(`${f}: contact-like name ${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("a new visit takes dishes, not 'What I had'", () => {
  const panel = read("components/VisitPanel.jsx");
  it("VisitForm no longer renders or sends a 'What I had' field", () => {
    expect(panel).not.toMatch(/^\s*What I had\s*$/m);
    expect(panel).not.toMatch(/what_i_had:\s*whatIHad/);
    expect(panel).not.toMatch(/setWhatIHad/);
  });
  it("old visits keep their saved text readable (card line + edit-form legacy line)", () => {
    expect(panel).toMatch(/Had \{visit\.what_i_had\}/);
    expect(panel).toMatch(/visit-legacy-had/);
  });
  it("rating groups are not <label>s (a label around a button group forwards a tap to the first button)", () => {
    expect(panel).not.toMatch(/<label[^>]*>\s*(Food|Ambiance)\s*<RatingSlider/);
  });
});

describe("phone rating control", () => {
  it("ScoreTapGrid renders ten whole-point buttons 1-10, each at least 44 x 44", () => {
    const html = renderToStaticMarkup(createElement(ScoreTapGrid, { value: 8, onChange() {}, label: "Dish score" }));
    expect((html.match(/<button/g) || []).length).toBe(10);
    for (let n = 1; n <= 10; n++) expect(html).toContain(`data-testid="score-tap-${n}"`);
    expect(html).toContain("min-height:48px");
    expect(html).toContain("min-width:44px");
    expect(html).toMatch(/data-testid="score-tap-8"[^>]*|aria-pressed="true"[^>]*score-tap-8/);
  });
  it("on a phone the dish ScoreMeter has the tap grid and no drag slider; on desktop the reverse", () => {
    const phone = renderToStaticMarkup(createElement(ScoreMeter, { value: null, onChange() {}, isMobile: true }));
    expect(phone).toContain("score-tap-grid");
    expect(phone).not.toContain('type="range"');
    const desk = renderToStaticMarkup(createElement(ScoreMeter, { value: null, onChange() {}, isMobile: false }));
    expect(desk).toContain('type="range"');
    expect(desk).not.toContain("score-tap-grid");
  });
});

describe("keyboard-aware sheet", () => {
  it("BottomSheet lifts by the keyboard inset from visualViewport", () => {
    const sheet = read("components/BottomSheet.jsx");
    expect(sheet).toMatch(/currentKeyboardInset/);
    expect(sheet).toMatch(/visualViewport/);
    expect(sheet).toMatch(/bottom:\s*kbInset/);
  });
  it("the form's Save row is sticky so it stays inside the visible part of the sheet", () => {
    expect(read("components/VisitPanel.jsx")).toMatch(/visit-form-actions[\s\S]{0,120}position:\s*"sticky"/);
  });
});
