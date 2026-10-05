/* foodPhone — the CI-runnable half of "Food on a phone" (first visit, dish ratings, keyboard,
 * AutoFill). The on-phone half is ui-audit/verify-food-visit-phone.mjs (Playwright WebKit, emulated) and
 * V1476080 (real device). Each test below is red on the code before this change. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { keyboardInset, currentKeyboardInset, layoutViewportHeight, visualViewportBox, MIN_KEYBOARD_PX } from "../src/workspaces/food/lib/keyboardInset.js";
import { cleanDraftDishes, newDraftDish } from "../src/workspaces/food/lib/draftDishes.js";
import { noAutofill, CONTACT_WORDS } from "../src/workspaces/food/lib/noAutofill.js";
import ScoreMeter, { ScoreTapGrid } from "../src/workspaces/food/components/ScoreMeter.jsx";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FOOD = join(REPO, "src", "workspaces", "food");
const read = (rel) => readFileSync(join(FOOD, rel), "utf8");

describe("keyboardInset", () => {
  it("is the gap between the layout viewport's bottom and the visual viewport's bottom", () => {
    expect(keyboardInset({ layoutHeight: 659, vvHeight: 323 })).toBe(336);
    expect(keyboardInset({ layoutHeight: 659, vvHeight: 300, vvOffsetTop: 36 })).toBe(323); // iOS scrolled the visual viewport
  });
  it("ignores browser-chrome-sized differences (collapsing toolbar, pinch zoom)", () => {
    expect(keyboardInset({ layoutHeight: 800, vvHeight: 800 })).toBe(0);
    expect(keyboardInset({ layoutHeight: 800, vvHeight: 800 - MIN_KEYBOARD_PX })).toBe(0);
    expect(keyboardInset({ layoutHeight: 800, vvHeight: 800 - MIN_KEYBOARD_PX - 1 })).toBe(MIN_KEYBOARD_PX + 1);
  });
  it("is 0 for anything unreadable, and when there is no visualViewport", () => {
    expect(keyboardInset({ layoutHeight: NaN, vvHeight: 100 })).toBe(0);
    expect(currentKeyboardInset({ innerHeight: 600 })).toBe(0);
    expect(currentKeyboardInset({ innerHeight: 600, visualViewport: { height: 280, offsetTop: 0 } })).toBe(320);
  });
  // B2046224 ×2 — the real-iPhone failure. WebKit's innerHeight is the VISIBLE height, so with the
  // keyboard up innerHeight === visualViewport.height and the old formula cancelled to 0. The layout
  // height must come from the fixed-position containing block (a probe), never innerHeight alone.
  it("still finds the keyboard when innerHeight shrinks WITH the visual viewport (iOS WebKit)", () => {
    const probeEl = { style: {}, dataset: {}, setAttribute() {}, isConnected: true, offsetHeight: 659 };
    const doc = { body: { appendChild() {} }, createElement: () => { probeEl.ownerDocument = doc; return probeEl; } };
    const iosWin = { document: doc, innerHeight: 279, visualViewport: { height: 279, offsetTop: 0 } };
    expect(layoutViewportHeight(iosWin)).toBe(659);
    expect(currentKeyboardInset(iosWin)).toBe(380);
    expect(currentKeyboardInset({ ...iosWin, visualViewport: { height: 279, offsetTop: 60 } })).toBe(320); // iOS panned up
  });
  it("keyboardInset.js never derives the layout height from innerHeight alone", () => {
    const src = read("lib/keyboardInset.js");
    expect(src).toMatch(/import \{ layoutViewportHeight \} from "\.\.\/\.\.\/\.\.\/shared\/ui\/layoutViewport\.js"/);
    expect(readFileSync(join(REPO, "src/shared/ui/layoutViewport.js"), "utf8")).toMatch(/position:fixed;top:0;bottom:0/);
    expect(src).not.toMatch(/layoutHeight:\s*win\.innerHeight/);
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
  it("noAutofill carries a NON-STANDARD autocomplete token (iOS overrides \"off\") and a caller-chosen name", () => {
    expect(noAutofill("dish-pick")).toMatchObject({ name: "dish-pick", autoComplete: "x-food-dish-pick", "data-form-type": "other" });
    expect(noAutofill("dish-pick").autoComplete).not.toBe("off");
  });
  it("noAutofill refuses a contact-card word in the name — 'title' is a job title to iOS", () => {
    for (const bad of ["dish-title", "pin-name", "visit-address", "place-phone"]) expect(() => noAutofill(bad)).toThrow(/contact-card word/);
  });
  it("every free-text field in the Food module spreads noAutofill, and no wording around it reads as a contact field", () => {
    const offenders = [];
    for (const f of readdirSync(join(FOOD, "components")).filter((n) => n.endsWith(".jsx"))) {
      const src = read(join("components", f));
      // each <input ...> / <textarea ...> opening tag (tags here never contain ">" inside attributes except "=>" arrows)
      const tags = src.match(/<(input|textarea)\b(?:=>|[^>])*?\/?>/gs) || [];
      for (const t of tags) {
        if (/type="(range|checkbox|radio|hidden)"/.test(t)) continue;
        if (!/noAutofill\(\s*"[a-z-]+"\s*\)/.test(t)) offenders.push(`${f}: ${t.replace(/\s+/g, " ").slice(0, 90)}`);
        const m = t.match(/noAutofill\(\s*"([^"]*)"/);
        if (m && CONTACT_WORDS.test(m[1])) offenders.push(`${f}: contact-like name ${m[1]}`);
        for (const attr of ["placeholder", "aria-label", "id"]) {
          const a = t.match(new RegExp(`(?:^|\\s)${attr}=(?:"([^"]*)"|\\{\`([^\`]*)\`\\})`));
          const v = a && (a[1] ?? a[2]);
          if (v && CONTACT_WORDS.test(v)) offenders.push(`${f}: ${attr}="${v}" reads as a contact field`);
        }
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
  it("BottomSheet pins itself to the VISUAL viewport's own box while typing — never to a layout-height estimate (B2046224 ×3: the gap)", () => {
    const sheet = read("components/BottomSheet.jsx");
    expect(sheet).toMatch(/currentKeyboardInset/);
    expect(sheet).toMatch(/visualViewportBox/);
    expect(sheet).toMatch(/top:\s*vvBox\.top,\s*height:\s*vvBox\.height/);
    expect(sheet).not.toMatch(/bottom:\s*kbInset/);
  });
  it("a sheet-coloured skirt sits under the sheet while the keyboard is up, so a mis-read can never show the map", () => {
    expect(read("components/BottomSheet.jsx")).toMatch(/food-sheet-skirt[\s\S]{0,200}top:\s*"100%"[\s\S]{0,120}var\(--surface-raised\)/);
  });
  it("the sheet re-reads the visual viewport on window scroll and on a timer while typing (iOS can move it with no vv event)", () => {
    const sheet = read("components/BottomSheet.jsx");
    expect(sheet).toMatch(/window\.addEventListener\("scroll", onVv/);
    expect(sheet).toMatch(/setInterval\(measureViewport/);
  });
  it("while typing, 'Log a visit' steps aside and sticky bars stop floating over the card (B2046224 ×3: the cut-off card)", () => {
    const sheet = read("components/BottomSheet.jsx");
    expect(sheet).toMatch(/\[data-typing\] \[data-hide-while-typing\]\{display:none !important\}/);
    expect(sheet).toMatch(/\[data-typing\] \[data-sheet-sticky\]\{position:static !important\}/);
    expect(read("components/VisitPanel.jsx")).toMatch(/food-actions-row" data-sheet-sticky="bottom" data-hide-while-typing/);
  });
  it("every editable card is marked so the reveal shows the whole card, not just the field", () => {
    expect(read("components/DishesSection.jsx")).toMatch(/dish-edit-row" data-edit-card/);
    expect(read("components/VisitPanel.jsx").match(/data-edit-card/g)?.length).toBeGreaterThanOrEqual(6);
    expect(read("components/BottomSheet.jsx")).toMatch(/closest\("\[data-edit-card\]"\)/);
  });
  it("the map's own controls are confined below the sheet (B2046224 ×3: the zoom control over the sheet)", () => {
    expect(read("components/FoodMap.jsx")).toMatch(/data-testid="food-map" style=\{\{ position: "absolute", inset: 0, isolation: "isolate", zIndex: 0 \}\}/);
  });
  it("visualViewportBox reads the visual viewport's own box", () => {
    expect(visualViewportBox({ visualViewport: { offsetTop: 56.4, height: 279.2 } })).toEqual({ top: 56, height: 279 });
    expect(visualViewportBox({})).toBe(null);
  });
  it("reveals the focused field by scrolling the sheet's own box — never scrollIntoView (it scrolls the iOS page too)", () => {
    const sheet = read("components/BottomSheet.jsx");
    expect(sheet).not.toMatch(/\.scrollIntoView\s*\??\.?\(/);
    expect(sheet).toMatch(/box\.scrollTop/);
    expect(sheet).toMatch(/data-sheet-sticky/);
  });
  it("the sticky header and sticky Save bars are marked so the reveal keeps clear of them", () => {
    expect(read("components/VisitPanel.jsx").match(/data-sheet-sticky="(top|bottom)"/g)?.length).toBeGreaterThanOrEqual(3);
    expect(read("components/DishesSection.jsx")).toMatch(/dish-edit-buttons" data-sheet-sticky="bottom"/);
  });
  it("the form's Save row is sticky so it stays inside the visible part of the sheet", () => {
    expect(read("components/VisitPanel.jsx")).toMatch(/visit-form-actions[\s\S]{0,120}position:\s*"sticky"/);
  });
});
