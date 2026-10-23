// NEW-1..5 (2026-10-11) — Food "Log a visit" sheet: eat-again choice back on a dish, no "What was good" field, nothing pans
// sideways, one plain close X, and the sheet-drag rules. The browser half is ui-audit/verify-food-visit-sheet-touch.mjs.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cleanDraftDishes, newDraftDish } from "../src/workspaces/food/lib/draftDishes.js";

const FOOD = join(__dirname, "..", "src", "workspaces", "food");
const read = (p) => readFileSync(join(FOOD, p), "utf8");

describe("NEW-1 — would I order it again (Yes / Maybe / No) on a dish in the visit form", () => {
  it("a draft dish row starts with no answer and carries order_again", () => {
    expect(newDraftDish()).toMatchObject({ name: "", score: null, order_again: null });
  });
  it("the chosen answer is part of the saved payload (food_dishes.order_again); no answer adds no key", () => {
    const rows = [{ key: "a", name: " Hamachi ", score: 9, order_again: "yes" }, { key: "b", name: "Soup", score: null, order_again: null }];
    expect(cleanDraftDishes(rows).dishes).toEqual([{ name: "Hamachi", score: 9, order_again: "yes" }, { name: "Soup", score: null }]);
  });
  it("an answer with no dish name is the same loud error as a score with no name", () => {
    expect(cleanDraftDishes([{ key: "a", name: "", score: null, order_again: "maybe" }]).error).toMatch(/Name the dish/);
  });
  it("the visit form renders the one OrderAgainControl on every dish row, and it offers Yes / Maybe / No", () => {
    const panel = read("components/VisitPanel.jsx");
    expect(panel).toMatch(/<OrderAgainControl value=\{r\.order_again \?\? null\} onChange=\{\(order_again\) => update\(r\.key, \{ order_again \}\)\}/);
    const dishes = read("components/DishesSection.jsx");
    expect(dishes).toMatch(/export function OrderAgainControl\(/);
    for (const v of ["yes", "maybe", "no"]) expect(dishes).toContain(`value: "${v}"`);
  });
  it("saved answers still display (dish list badge) and FoodApp writes the whole draft dish", () => {
    expect(read("components/DishesSection.jsx")).toMatch(/data-dish-section=\{section\}/); // NEW-1 (2026-10-20): the answer places the dish in its section
    expect(read("FoodApp.jsx")).toMatch(/insertDish\(\{ \.\.\.d, visit_id: savedVisit\.id \}\)/);
  });
});

describe("NEW-2 — no 'What was good' input; saved text is kept read-only", () => {
  it("no component offers an input for it", () => {
    for (const f of readdirSync(join(FOOD, "components")).filter((n) => n.endsWith(".jsx"))) {
      const src = read(join("components", f));
      expect(src, f).not.toMatch(/visit-highlights-input/);
      if (f === "VisitPanel.jsx") expect(src.slice(src.indexOf("function VisitForm("), src.indexOf("/* The header"))).not.toMatch(/What was good|what_was_good/);
    }
  });
  it("the visit card still shows saved text and the list keeps its column", () => {
    expect(read("components/VisitPanel.jsx")).toMatch(/data-testid="visit-legacy-good"/); // read-only in the edit form (NEW-1, 2026-10-20)
    expect(read("components/VisitList.jsx")).toMatch(/v\.what_was_good/);
  });
});

describe("NEW-3 — nothing in the sheet can pan sideways", () => {
  const sheet = read("components/BottomSheet.jsx"), panel = read("components/VisitPanel.jsx"), dock = read("components/SideDock.jsx");
  it("both scrollers allow only vertical pans and never scroll sideways", () => {
    expect(sheet).toMatch(/overflowY: "auto", overflowX: "hidden", overscrollBehavior: "contain", touchAction: "pan-y"/);
    expect(dock).toMatch(/overflowX: "hidden"[^}]*touchAction: "pan-y"/);
  });
  it("a sideways nudge of the content box is put back and reported (self-capturing)", () => {
    expect(sheet).toMatch(/scrollLeft !== 0\) \{ reportSheetSideways\(/);
    expect(sheet).toMatch(/box\.scrollLeft = 0/);
  });
  it("fields can shrink to their cell (the iOS date input's intrinsic width was the likeliest pusher)", () => {
    expect(panel).toMatch(/minWidth: 0, maxWidth: "100%", display: "block"/);
  });
});

describe("NEW-4 — one plain close X", () => {
  it("CloseX has no ring or fill; every X in /food goes through it", () => {
    const x = read("components/CloseX.jsx");
    expect(x).not.toMatch(/borderRadius|border:\s*"1px/);
    expect(x).toMatch(/border: "none", background: "none"/);
    for (const [f, id] of [["VisitPanel.jsx", "food-panel-close"], ["VisitPanel.jsx", "visit-dish-remove"], ["DishesSection.jsx", "dish-edit-close"]]) {
      expect(read(`components/${f}`), id).toMatch(new RegExp(`<CloseX [\\s\\S]{0,220}?testId="${id}"`));
    }
    expect(read("components/ListPanel.jsx")).toMatch(/<CloseX /);
  });
  it("no other component draws its own ✕ button", () => {
    for (const f of readdirSync(join(FOOD, "components")).filter((n) => n.endsWith(".jsx") && n !== "CloseX.jsx")) {
      const src = read(join("components", f));
      const own = src.split("\n").filter((l) => /^\s*✕\s*$/.test(l));
      expect(own, f).toEqual([]);
    }
  });
});

describe("NEW-5 — the sheet's drag rules", () => {
  const sheet = read("components/BottomSheet.jsx");
  it("the grab zone is tall (>= 56) and the header is a grab area", () => {
    expect(sheet).toMatch(/const HANDLE_ZONE_PX = 56;/);
    expect(sheet).toMatch(/minHeight: HANDLE_ZONE_PX, cursor: "grab"/);
    expect(sheet).toMatch(/closest\?\.\("\[data-sheet-grab\]"\)/);
    expect(read("components/VisitPanel.jsx")).toMatch(/data-sheet-grab=""/);
  });
  it("a list scrolled by a hair still counts as at its top; a sideways finger is never the sheet's", () => {
    expect(sheet).toMatch(/const TOP_EPS = 2/);
    expect(sheet).toMatch(/Math\.abs\(dx\) > Math\.abs\(dy\)\) \{ t\.mode = "ignore"/);
  });
  it("a drag starts from the height the sheet is DRAWN at, and a list reaching its top hands over to the sheet", () => {
    expect(sheet).toMatch(/getBoundingClientRect\(\)\.height/);
    expect(sheet).toMatch(/t\.mode === "scroll"/);
  });
  it("a rating slider is never a drag start", () => {
    expect(sheet).toMatch(/closest\?\.\('input\[type="range"\], \[data-no-sheet-drag\]'\)/);
  });
});
