/* foodDishFlow — B2268433/34/35 (owner chat block 2026-10-17): the pure parts of "log a visit lands on the place page",
 * "saving dishes from a restaurant", and "notes on dishes". The browser proof is ui-audit/verify-food-dishes-phone.mjs. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { suggestDishes, sameDishName } from "../src/workspaces/food/lib/dishSuggest.js";
import { dishRowsForTable, dishDate } from "../src/workspaces/food/lib/dishAggregates.js";
import { cleanDraftDishes, newDraftDish } from "../src/workspaces/food/lib/draftDishes.js";
import { todayLocal } from "../src/workspaces/food/components/DishesSection.jsx";
import { dragVisibleHeight, RUBBER_CAP } from "../src/workspaces/food/lib/bottomSheetSnap.js";

const FOOD = join(__dirname, "../src/workspaces/food");
const read = (p) => readFileSync(join(FOOD, p), "utf8");
const rows = dishRowsForTable([
  { id: "1", visit_id: "v1", name: "Pad Thai", score: 8.5, visited_on: "2026-09-01", created_at: "2026-09-01T12:00:00Z", note: "extra lime" },
  { id: "2", visit_id: "v1", name: "Green Curry", score: 7, visited_on: "2026-09-01", created_at: "2026-09-01T12:01:00Z" },
  { id: "3", visit_id: "v1", name: "Tom Kha Soup", score: 9, visited_on: "2026-09-01", created_at: "2026-09-01T12:02:00Z" },
]);

describe("dish name suggestions (tolerant, like the restaurant search)", () => {
  it("prefix, word-prefix and contains hit", () => {
    expect(suggestDishes("pad", rows).map((r) => r.name)).toEqual(["Pad Thai"]);
    expect(suggestDishes("curry", rows).map((r) => r.name)).toEqual(["Green Curry"]);
    expect(suggestDishes("kha", rows).map((r) => r.name)).toEqual(["Tom Kha Soup"]);
  });
  it("a slight misspelling still finds the saved dish; an unrelated word and one letter find nothing", () => {
    expect(suggestDishes("pad thia", rows).map((r) => r.name)).toContain("Pad Thai");
    expect(suggestDishes("gren curry", rows).map((r) => r.name)).toContain("Green Curry");
    expect(suggestDishes("zzzz", rows)).toEqual([]);
    expect(suggestDishes("p", rows)).toEqual([]);
  });
  it("sameDishName ignores case, spacing and punctuation", () => {
    expect(sameDishName("  pad  THAI ", "Pad Thai")).toBe(true);
    expect(sameDishName("Pad Thai", "Pad See Ew")).toBe(false);
    expect(sameDishName("", "")).toBe(false);
  });
});

describe("a re-rate keeps the history and shows the latest (no duplicate dish)", () => {
  const dishes = [
    { id: "a", visit_id: "v1", name: "Pad Thai", score: 7, visited_on: "2026-08-01", created_at: "2026-08-01T10:00:00Z" },
    { id: "b", visit_id: "v2", name: "pad thai", score: 9, visited_on: "2026-09-01", created_at: "2026-09-01T10:00:00Z" },
    // a re-rate from the place page, hung on the most recent visit but dated the day it was given
    { id: "c", visit_id: "v2", name: "Pad Thai", score: 8, visited_on: "2026-09-01", rated_on: "2026-10-17", created_at: "2026-10-17T18:00:00Z" },
  ];
  it("one row, latest score wins, both earlier ratings ride along", () => {
    const r = dishRowsForTable(dishes);
    expect(r).toHaveLength(1);
    expect(r[0].latestScore).toBe(8);
    expect(r[0].history.map((h) => h.score)).toEqual([9, 7]);
    expect(r[0].timesHad).toBe(3);
  });
  it("two ratings on the SAME day order by when they were written", () => {
    const r = dishRowsForTable([
      { id: "x", visit_id: "v", name: "Soup", score: 5, visited_on: "2026-09-01", created_at: "2026-09-01T10:00:00Z" },
      { id: "y", visit_id: "v", name: "Soup", score: 9, visited_on: "2026-09-01", rated_on: "2026-09-01", created_at: "2026-09-01T10:05:00Z" },
    ]);
    expect(r[0].latestScore).toBe(9);
  });
  it("dishDate: the rating's own day, else the visit's, else unknown", () => {
    expect(dishDate({ rated_on: "2026-10-17", visited_on: "2026-09-01" })).toBe("2026-10-17");
    expect(dishDate({ visited_on: "2026-09-01" })).toBe("2026-09-01");
    expect(dishDate({})).toBe(null);
  });
  it("todayLocal is the LOCAL calendar day", () => {
    expect(todayLocal(new Date(2026, 9, 7, 23, 59))).toBe("2026-10-07");
  });
});

describe("dish notes (NEW-4)", () => {
  it("a draft dish carries its trimmed note; a note alone without a name is a loud error, an empty row is ignored", () => {
    const a = { ...newDraftDish(), name: "Pad Thai", score: 8, note: "  extra lime " };
    expect(cleanDraftDishes([a]).dishes[0]).toMatchObject({ name: "Pad Thai", note: "extra lime" });
    expect(cleanDraftDishes([{ ...newDraftDish(), note: "x" }]).error).toMatch(/Name the dish/);
    expect(cleanDraftDishes([newDraftDish()])).toEqual({ dishes: [], error: null });
    expect(cleanDraftDishes([{ ...a, note: "" }]).dishes[0]).not.toHaveProperty("note");
  });
  it("the row shows the note on its own truncated line and the panel shows it in full", () => {
    const d = read("components/DishesSection.jsx");
    expect(d).toMatch(/data-testid="dish-row-note"[^>]*textOverflow: "ellipsis"/);
    expect(d).toMatch(/data-testid="dish-sheet-note"/); // NEW-2: the full note is the sheet's own text box
  });
  it("the log-a-visit dish row has a Note field; the editor already had one", () => {
    expect(read("components/VisitPanel.jsx")).toMatch(/data-testid="visit-dish-note"/);
    expect(read("components/DishesSection.jsx")).toMatch(/data-testid="dish-note-input"/);
  });
});

describe("NEW-2 — a saved visit lands on the place page, never on another blank form", () => {
  const panel = read("components/VisitPanel.jsx"), app = read("FoodApp.jsx");
  it("the confirmed-save handler CLOSES the form", () => {
    expect(panel).toMatch(/const handleSaved = useCallback\(\(\) => \{ drafts\.clear\("new"\); setAdding\(false\); \}/);
  });
  it("the confirmation offers Edit visit, not Log another visit", () => {
    expect(panel).toMatch(/data-testid="food-saved-edit-btn"/);
    expect(panel).not.toMatch(/["`>][^"`<]*[Ll]og another visit/);
  });
  it("a new pin's page stays open after its first save; the save returns the visit id (truthy) and records the notice", () => {
    expect(app).toMatch(/kind: "manualPin", pin: \{ name: payload\.custom_name/);
    expect(app).toMatch(/return savedVisit\.id;/);
    expect(app).toMatch(/setSavedNotice\(\{ visitId: savedVisit\.id/);
  });
});

describe("one source of truth: a rename reaches every rating of the dish", () => {
  it("saveDish renames the whole group before the edit", () => {
    const app = read("FoodApp.jsx");
    expect(app).toMatch(/updateDishes\(ids, \{ name: rest\.name \}\)/);
    expect(read("lib/foodStore.js")).toMatch(/\.update\(rest\)\.in\("id", ids\)/);
  });
});

describe("sheet rubber band", () => {
  const b = { min: 100, max: 500 };
  it("follows the finger 1:1 inside the stops and resists past the ends, never beyond the cap", () => {
    expect(dragVisibleHeight(300, b)).toBe(300);
    expect(dragVisibleHeight(600, b)).toBeCloseTo(535);
    expect(dragVisibleHeight(5000, b)).toBe(500 + RUBBER_CAP);
    expect(dragVisibleHeight(40, b)).toBeCloseTo(79);
    expect(dragVisibleHeight(-900, { min: 0, max: 500 })).toBe(0);
  });
});
