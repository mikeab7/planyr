/* phoneTyping — B2088384, the CI-runnable half of "every place you type in Planyr, on a phone".
 * The browser half is ui-audit/verify-phone-typing.mjs (WebKit, iPhone descriptors, the iOS keyboard
 * modelled INCLUDING iOS's page scroll and the page-containment guard pinning it back). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { autofillStamp, keyboardBand, revealDelta, revealTarget, isTextEntry } from "../src/shared/ui/phoneTyping.js";
import { keyboardInsetPx } from "../src/workspaces/site-planner/lib/propertiesSheet.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

describe("autofillStamp — no contact AutoFill on a field that isn't a contact field", () => {
  it("gives a plain field (no token, or the 'off' iOS ignores) a non-standard token and a neutral name", () => {
    expect(autofillStamp({ tagName: "INPUT", autocomplete: "" })).toEqual({ autocomplete: "x-planyr", name: "planyr-field" });
    expect(autofillStamp({ tagName: "INPUT", autocomplete: "off", name: "q" })).toEqual({ autocomplete: "x-planyr" });
    expect(autofillStamp({ tagName: "TEXTAREA", autocomplete: "on" })).toEqual({ autocomplete: "x-planyr", name: "planyr-field" });
  });
  it("leaves a REAL contact / credential field alone — AutoFill is wanted there", () => {
    for (const ac of ["email", "given-name", "family-name", "organization", "current-password", "new-password", "username"]) {
      expect(autofillStamp({ tagName: "INPUT", autocomplete: ac, type: /password/.test(ac) ? "password" : "text" })).toBe(null);
    }
    expect(autofillStamp({ tagName: "INPUT", contactField: true })).toBe(null);
  });
  it("respects a field already carrying its own non-standard token (Food's x-food-*)", () => {
    expect(autofillStamp({ tagName: "INPUT", autocomplete: "x-food-dish-pick", name: "dish-pick" })).toBe(null);
  });
  it("never touches a <select>", () => {
    expect(autofillStamp({ tagName: "SELECT" })).toBe(null);
  });
});

// NEW-1 (2026-10-06): the reveal brings a field's whole edit CARD into view when the card fits "the room". It measured the room
// against the keyboard-free BAND, not against the scroller the card actually scrolls in — so in a short bottom sheet (visible band
// 279, sheet scroller 211) a 230-tall card "fit", its top was targeted, and the field in its lower half stayed under the keyboard.
describe("revealTarget", () => {
  const field = { top: 650, bottom: 694, height: 44 }, card = { top: 440, bottom: 700, height: 260 };
  it("brings the card into view only when it fits the room it will scroll in", () => {
    expect(revealTarget(field, card, 280)).toBe(card);
    expect(revealTarget(field, card, 187)).toBe(field);
  });
  it("is the field when there is no card", () => { expect(revealTarget(field, null, 500)).toBe(field); });
});

describe("keyboardBand / revealDelta", () => {
  it("is null with no keyboard, the visible strip with one", () => {
    expect(keyboardBand({ layoutHeight: 659, vvHeight: 659 })).toBe(null);
    expect(keyboardBand({ layoutHeight: 659, vvHeight: 279 })).toEqual({ top: 0, bottom: 279 });
    expect(keyboardBand({ layoutHeight: 659, vvHeight: 279, vvOffsetTop: 60 })).toEqual({ top: 60, bottom: 339 });
  });
  // NEW-1 (2026-10-06): iOS reveals a field low in a bottom sheet by scrolling the view by up to the keyboard's FULL height, which
  // puts the visible area's bottom at the layout bottom (layout − visible − offsetTop = 0). That read as "no keyboard", so the
  // field-reveal never ran and a field sitting on the sheet's bottom edge stayed there, half under the keyboard's old place.
  it("still sees the keyboard when iOS has scrolled the view by its full height", () => {
    expect(keyboardBand({ layoutHeight: 659, vvHeight: 279, vvOffsetTop: 380 })).toEqual({ top: 380, bottom: 659 });
  });
  it("moves a box just enough to sit inside the strip, preferring its top", () => {
    expect(revealDelta({ top: 100, bottom: 140 }, 12, 267)).toBe(0);
    expect(revealDelta({ top: 300, bottom: 340 }, 12, 267)).toBe(73);
    expect(revealDelta({ top: -20, bottom: 20 }, 12, 267)).toBe(-32);
    expect(revealDelta({ top: 40, bottom: 600 }, 12, 267)).toBe(28); // taller than the strip: its top lands at the top
  });
  it("treats text inputs, textareas and selects as places you type; buttons and checkboxes not", () => {
    expect(isTextEntry({ tagName: "INPUT", type: "text" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "number" })).toBe(true);
    expect(isTextEntry({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextEntry({ tagName: "INPUT", type: "checkbox" })).toBe(false);
    expect(isTextEntry({ tagName: "BUTTON" })).toBe(false);
  });
});

describe("the Site Planner phone sheet measures the keyboard like Food does (B2088384)", () => {
  it("still finds the keyboard when iOS shrinks innerHeight WITH it", () => {
    const probeEl = { style: {}, dataset: {}, setAttribute() {}, isConnected: true, offsetHeight: 659 };
    const doc = { body: { appendChild() {} }, createElement: () => { probeEl.ownerDocument = doc; return probeEl; } };
    expect(keyboardInsetPx({ document: doc, innerHeight: 279, visualViewport: { height: 279, offsetTop: 0 } })).toBe(380);
  });
  it("is wired: installed once in main.jsx, SitePlanner uses the measured layout height", () => {
    expect(read("src/main.jsx")).toMatch(/installPhoneTyping\(window\)/);
    expect(read("src/workspaces/site-planner/SitePlanner.jsx")).toMatch(/vh = layoutViewportHeight\(window\)/);
    expect(read("src/workspaces/site-planner/lib/propertiesSheet.js")).toMatch(/const innerH = layoutViewportHeight\(win\)/);
  });
  it("the Food sheet opts out (it manages the keyboard itself)", () => {
    expect(read("src/workspaces/food/components/BottomSheet.jsx")).toMatch(/data-food-sheet-root=""\s*\n\s*data-keyboard-managed=""/);
  });
});
