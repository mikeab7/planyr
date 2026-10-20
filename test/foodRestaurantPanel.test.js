/* foodRestaurantPanel — NEW-1 / NEW-2 (owner-approved mockup, 2026-10-20): the pure rules behind the redesigned restaurant panel
 * and the dish sheet, plus the source sweeps that keep the removed controls removed. The browser proof is
 * ui-audit/verify-food-restaurant-panel.mjs (live, WebKit, two iPhone sizes, both orientations). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  formatRating, nextPriceLevel, priceLevelText, PRICE_LEVELS, headerSubline, dishSectionOf, dishSections, dishSubline,
  visitRowLabel, visitsToShow, VISITS_SHOWN, dishHistoryEntries,
} from "../src/workspaces/food/lib/restaurantPanel.js";
import { formatScore, dishRowsForTable } from "../src/workspaces/food/lib/dishAggregates.js";
import { formatCuisine } from "../src/workspaces/food/lib/formatPlace.js";

const FOOD = join(__dirname, "../src/workspaces/food");
const read = (p) => readFileSync(join(FOOD, p), "utf8");

describe("one number, one precision — formatRating IS formatScore", () => {
  it("shows the exact quarter value with at least one decimal", () => {
    expect(formatRating(8.25)).toBe("8.25");
    expect(formatRating(8)).toBe("8.0");
    expect(formatRating("8.00")).toBe("8.0"); // PostgREST numeric string
    expect(formatRating(9.5)).toBe("9.5");
    expect(formatRating(7.75)).toBe("7.75");
    expect(formatRating(10)).toBe("10.0");
    expect(formatRating(null)).toBe(null);
    expect(formatRating("x")).toBe(null);
  });
  it("a mean lands on a quarter (8.75 + 8.25 → 8.5), never a stray 8.3", () => {
    expect(formatRating((8.75 + 8.25) / 2)).toBe("8.5");
    expect(formatRating(8.3)).toBe("8.25");
  });
  it("is the SAME function as the dish formatter (no second implementation), and dishAggregates stays import-free", () => {
    expect(formatRating).toBe(formatScore);
    expect(read("lib/dishAggregates.js")).not.toMatch(/^import/m);
    expect(read("lib/restaurantPanel.js")).toMatch(/export const formatRating = formatScore;/);
  });
  it("every panel display of a rating goes through it — no toFixed on a rating anywhere in the panel or the dish list", () => {
    expect(read("components/VisitPanel.jsx")).not.toMatch(/toFixed\(1\)/);
    expect(read("components/DishesSection.jsx")).not.toMatch(/toFixed\(1\)/);
  });
});

describe("price level — $ to $$$$, one per restaurant, tap the current one to clear", () => {
  it("sets, changes, clears, ignores nonsense", () => {
    expect(PRICE_LEVELS).toEqual([1, 2, 3, 4]);
    expect(nextPriceLevel(null, 3)).toBe(3);
    expect(nextPriceLevel(3, 2)).toBe(2);
    expect(nextPriceLevel(2, 2)).toBe(null);
    expect(nextPriceLevel(2, 7)).toBe(2);
    expect(priceLevelText(3)).toBe("$$$");
    expect(priceLevelText(null)).toBe("");
  });
  it("lives in food_place_prefs (owner-only RLS, 1-4 check, one row per restaurant), declared like every personal food column", () => {
    const sql = readFileSync(join(FOOD, "db/food_place_prefs.sql"), "utf8");
    expect(sql).toMatch(/price_level\s+smallint/);
    expect(sql).toMatch(/price_level is null or price_level between 1 and 4/);
    expect(sql).toMatch(/food_place_prefs_user_place_uidx/);
    expect(sql).toMatch(/food_place_prefs_user_manual_uidx/);
    for (const cmd of ["select", "insert", "update", "delete"]) expect(sql).toMatch(new RegExp(`for ${cmd} to authenticated`));
    expect(sql).not.toMatch(/to anon/);
    const manifest = JSON.parse(readFileSync(join(__dirname, "../scripts/denormalisedCopies.json"), "utf8"));
    expect(JSON.stringify(manifest)).toContain("food_place_prefs");
    expect(read("lib/foodStore.js")).toMatch(/export async function upsertPlacePref\(identity, patch\)/);
  });
  it("FoodApp writes it optimistically and REVERTS + says so on a failed write (LOUD-FAILURE)", () => {
    const app = read("FoodApp.jsx");
    expect(app).toMatch(/if \(err\) \{ setPlacePrefs\(before\); setError\(err\.message \|\| "Couldn't save the price level\."\); return false; \}/);
    expect(app).toMatch(/onSetPriceLevel=\{accountActive && selectedPrefIdentity \? setPriceLevel : undefined\}/);
  });
});

describe("header line 2 — '<cuisine> · <city>' then the price control", () => {
  it("drops the word Restaurant from the category, keeps a bare 'restaurant'", () => {
    expect(formatCuisine("japanese_restaurant")).toBe("Japanese");
    expect(formatCuisine("bar_and_grill_restaurant")).toBe("Bar and Grill");
    expect(formatCuisine("restaurant")).toBe("Restaurant");
    expect(formatCuisine("coffee_shop")).toBe("Coffee Shop");
    expect(formatCuisine(null)).toBe(null);
  });
  it("joins what exists", () => {
    expect(headerSubline({ cuisine: "Japanese", city: "Houston" })).toBe("Japanese · Houston");
    expect(headerSubline({ cuisine: "Japanese", city: null })).toBe("Japanese");
    expect(headerSubline({})).toBe("");
  });
});

describe("the dish list IS the order — sections by eat-again, score order, empty sections hidden", () => {
  const rows = dishRowsForTable([
    { id: "a", visit_id: "v2", name: "Salmon", score: 9.5, order_again: "yes", visited_on: "2026-10-01" },
    { id: "b", visit_id: "v2", name: "Miso", score: 7, order_again: "yes", visited_on: "2026-10-01" },
    { id: "c", visit_id: "v2", name: "Tempura", score: 6.5, order_again: "maybe", visited_on: "2026-10-01" },
    { id: "d", visit_id: "v2", name: "Edamame", score: null, order_again: null, visited_on: "2026-10-01" },
    { id: "e2", visit_id: "v2", name: "Udon", score: 5, order_again: "no", visited_on: "2026-10-01" },
    { id: "e1", visit_id: "v1", name: "udon", score: 4.5, order_again: "maybe", visited_on: "2026-09-20" },
  ]);
  it("yes → order, maybe/unanswered → maybe, no → skip; each sorted by score desc with unscored last", () => {
    expect(dishSectionOf({ order_again: "yes" })).toBe("order");
    expect(dishSectionOf({ order_again: "maybe" })).toBe("maybe");
    expect(dishSectionOf({ order_again: null })).toBe("maybe");
    expect(dishSectionOf({ order_again: "no" })).toBe("skip");
    const s = dishSections(rows);
    expect(s.order.map((r) => r.name)).toEqual(["Salmon", "Miso"]);
    expect(s.maybe.map((r) => r.name)).toEqual(["Tempura", "Edamame"]);
    expect(s.skip.map((r) => r.name)).toEqual(["Udon"]);
  });
  it("the LATEST answer places the dish (Udon said maybe before, no now → skip)", () => {
    expect(dishSections(rows).skip[0].timesHad).toBe(2);
  });
  it("an empty list gives three empty sections (the panel draws none of them)", () => {
    expect(dishSections([])).toEqual({ order: [], maybe: [], skip: [] });
  });
});

describe("the one grey line under a dish name", () => {
  it("the note wins; with 2+ ratings and no note the movement shows; else 'Add a note'", () => {
    expect(dishSubline({ note: "extra sauce", latestScore: 8, history: [{ score: 7 }] })).toEqual({ kind: "note", text: "extra sauce" });
    expect(dishSubline({ note: null, latestScore: 8, history: [{ score: 7.5 }] })).toEqual({ kind: "movement", text: "Was 7.5 · up from last time" });
    expect(dishSubline({ note: null, latestScore: 6, history: [{ score: 7 }] })).toEqual({ kind: "movement", text: "Was 7.0 · down from last time" });
    expect(dishSubline({ note: null, latestScore: 7, history: [{ score: 7 }] })).toEqual({ kind: "movement", text: "Was 7.0 · same as last time" });
    expect(dishSubline({ note: null, latestScore: 8, history: [] })).toEqual({ kind: "empty", text: "Add a note" });
    expect(dishSubline({ note: null, latestScore: 8, history: [{ score: null }] })).toEqual({ kind: "empty", text: "Add a note" });
  });
  it("history for the sheet: nothing for a once-rated dish, every rating newest-first for two or more", () => {
    expect(dishHistoryEntries({ id: "x", history: [] })).toEqual([]);
    expect(dishHistoryEntries({ id: "x", history: [{ id: "y" }] }).map((e) => e.id)).toEqual(["x", "y"]);
  });
});

describe("visits — one compact row each, two shown, the rest behind Show N more", () => {
  const fmt = (d) => `D${d}`;
  it("labels", () => {
    expect(visitRowLabel({ visited_on: "2026-10-01", rating: 8.25, rating_ambiance: 8 }, fmt)).toBe("D2026-10-01 · Food 8.25 · Ambiance 8.0");
    expect(visitRowLabel({ visited_on: null, rating: "8.25", rating_ambiance: null }, fmt)).toBe("No date · Food 8.25");
    expect(visitRowLabel({ visited_on: null, rating: null, rating_ambiance: null }, fmt)).toBe("No date");
  });
  it("shows two, counts the rest, expands fully", () => {
    expect(VISITS_SHOWN).toBe(2);
    const v = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
    expect(visitsToShow(v, false)).toEqual({ shown: [{ id: 1 }, { id: 2 }], hidden: 2 });
    expect(visitsToShow(v, true)).toEqual({ shown: v, hidden: 0 });
    expect(visitsToShow([{ id: 1 }], false)).toEqual({ shown: [{ id: 1 }], hidden: 0 });
  });
});

describe("the removed controls stay removed (source sweep)", () => {
  const panel = read("components/VisitPanel.jsx");
  const dishes = read("components/DishesSection.jsx");
  it("no 'The order' card, Copy button, Best dish line, Visits/Cost tile, Sort control, per-row kebab, per-row eat-again circle or ··· visit menu", () => {
    for (const bad of [/food-the-order/, /theOrderAsText/, /Best dish/, /bestDishRow/, /food-dishes-sort/, /dish-row-kebab/, /DishKebabMenu/, /dish-order-again-badge/, /food-visit-menu-btn/, /AnchoredMenu/, /avgCost/, /visitCount/]) {
      expect(panel, String(bad)).not.toMatch(bad);
      expect(dishes, String(bad)).not.toMatch(bad);
    }
  });
  it("the header: name + plain CloseX on ONE line, cuisine · city · price control, grey address ending in Directions", () => {
    const hdr = panel.slice(panel.indexOf("function PanelHeader"), panel.indexOf("/* Score pills"));
    expect(hdr).toMatch(/justifyContent: "space-between", alignItems: "center"/);
    expect(hdr).toMatch(/<CloseX onClick=\{onClose\} label="Close" testId="food-panel-close" style=\{\{ margin: "-10px -8px -10px 0" \}\} \/>/); // the 44-square target overhangs the name row
    expect(hdr).toMatch(/<PriceLevelControl level=\{priceLevel\} onChange=\{onSetPriceLevel\} \/>/);
    expect(hdr).toMatch(/· <span style=\{\{ fontWeight: 700 \}\}>Directions<\/span>/);
  });
  it("Log a visit is the LAST thing in the body and sticky — on every layout (no landscape-only placement left)", () => {
    expect(panel).not.toMatch(/\{!landscape && actionsRow\}|\{landscape && actionsRow\}/);
    const body = panel.slice(panel.indexOf("<PastVisitsSection"), panel.indexOf("if (landscape) {"));
    expect(body).toMatch(/\{actionsRow\}\s*<\/>/);
    expect(panel).toMatch(/data-testid="food-actions-row" data-sheet-sticky="bottom"/);
  });
  it("the dish sheet carries every per-dish action (rate again, delete) and no history for a once-rated dish", () => {
    expect(dishes).toMatch(/export function DishSheet\(/);
    expect(dishes).toMatch(/\{history\.length >= 2 && \(/);
    expect(dishes).toMatch(/data-testid="dish-rate-again-btn"/);
    expect(dishes).toMatch(/data-testid="dish-row-delete"/);
    expect(dishes).toMatch(/placeholder="How to order it next time"/);
    expect(dishes).toMatch(/label="Would I eat it again"/);
  });
  it("prior owner decisions hold: one shared quarter-step slider (no -/+), Yes/Maybe/No, no 'What was good' input, plain CloseX", () => {
    expect(dishes).toMatch(/<RatingSlider value=\{score\}/);
    expect(dishes).not.toMatch(/dish-score-(minus|plus|nudge)/);
    expect(dishes).toMatch(/\{ value: "yes", label: "Yes"/);
    expect(dishes).toMatch(/\{ value: "maybe", label: "Maybe"/);
    expect(dishes).toMatch(/\{ value: "no", label: "No"/);
    expect(panel).not.toMatch(/visit-highlights-input/);
    expect(read("components/CloseX.jsx")).not.toMatch(/borderRadius/);
  });
});
