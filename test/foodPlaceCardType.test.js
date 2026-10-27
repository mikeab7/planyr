/* foodPlaceCardType — the source-level half of NEW-1 + NEW-2 (2026-10-27, owner on his iPhone: "it's all different sizes. There's no alignment.").
 * The picture is ui-audit/verify-food-place-card-type.mjs (WebKit + Chromium, 393 / 430 wide + desktop); these are the guards a plain `vitest run`
 * can enforce. Each fails on the main that preceded the change. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { FOOD_TYPE, FOOD_TYPE_SIZES, COLUMN_X, GROUP_STEP, ITEM_STEP, LABEL_LINE } from "../src/workspaces/food/lib/foodType.js";
import { visitRowParts, visitRowLabel } from "../src/workspaces/food/lib/restaurantPanel.js";

const root = new URL("../src/workspaces/food/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const panel = read("components/VisitPanel.jsx");
const dishes = read("components/DishesSection.jsx");
const label = read("components/SectionLabel.jsx");

describe("NEW-1 — one type scale, in one place", () => {
  it("the scale is four sizes: title 20 · body 13 · caption 12 · label 10.5", () => {
    expect([FOOD_TYPE.title.fontSize, FOOD_TYPE.body.fontSize, FOOD_TYPE.caption.fontSize, FOOD_TYPE.label.fontSize]).toEqual([20, 13, 12, 10.5]);
    expect(FOOD_TYPE_SIZES).toEqual([20, 13, 12, 10.5]);
  });
  it("the layout harness checks the SAME sizes the app defines (a number changed in only one place fails here)", () => {
    const h = readFileSync(new URL("../ui-audit/verify-food-place-card-type.mjs", import.meta.url), "utf8");
    const m = h.match(/const SIZES = \[([^\]]+)\];/);
    expect(m && m[1].split(",").map((x) => Number(x.trim()))).toEqual([...FOOD_TYPE_SIZES]);
  });
  it("ONE section label: bold, uppercase, tracked, in the SECONDARY text token (never faded toward the background), a fixed line box", () => {
    expect(FOOD_TYPE.label).toMatchObject({ fontWeight: 700, textTransform: "uppercase", color: "var(--text-secondary)", lineHeight: `${LABEL_LINE}px` });
    expect(Object.isFrozen(FOOD_TYPE) && Object.isFrozen(FOOD_TYPE.label)).toBe(true);
  });
  it("the column and the steps: 16 side, 16 between groups, 4 from a label to its rows", () => {
    expect([COLUMN_X, GROUP_STEP, ITEM_STEP]).toEqual([16, 16, 4]);
  });
  it("every section header goes through SectionLabel — no local caps-label recipe survives in the card, the dish list or the list view", () => {
    for (const [name, src] of [["VisitPanel", panel], ["DishesSection", dishes]]) {
      expect(src, `${name}: a hand-rolled uppercase label`).not.toMatch(/textTransform: "uppercase"/);
    }
    expect(read("components/VisitList.jsx")).toMatch(/<tr style=\{\{ textAlign: "left", \.\.\.FOOD_TYPE\.label \}\}>/); // the list view's column headings (its status tags are chips, not labels)
    expect(panel).toMatch(/<SectionLabel count=\{pastVisits\.length\}>Visits<\/SectionLabel>/);
    expect(dishes).toMatch(/<SectionLabel inset=\{0\} count=\{dishCount\(sections\.order\.length\)\}>What to order<\/SectionLabel>/);
    expect(dishes).toMatch(/<SectionLabel inset=\{0\} count=\{dishCount\(sections\.maybe\.length\)\}>Maybe<\/SectionLabel>/);
    expect(dishes).toMatch(/onToggle=\{\(\) => setSkipOpen\(\(o\) => !o\)\} testId="food-dishes-skip-toggle">Skip<\/SectionLabel>/);
  });
  it("a collapsible label's <button> never falls back to the browser's own font size (font: inherit comes BEFORE the label's size, not after)", () => {
    const i = label.indexOf('font: "inherit"'), j = label.indexOf("...FOOD_TYPE.label", i);
    expect(i).toBeGreaterThan(-1);
    expect(j).toBeGreaterThan(i);
    expect(label).not.toMatch(/textAlign: "left", font: "inherit"/); // the shipped defect: font:inherit last wiped the 10.5 and drew "SKIP · 1 DISH" at 16
  });
  it("the card's text sizes come from FOOD_TYPE — no raw 11 / 12.5 / 14 literal in the header, rows, notices or the dish list", () => {
    for (const [name, src] of [["VisitPanel", panel], ["DishesSection", dishes]]) {
      expect(src, `${name}: raw 11`).not.toMatch(/fontSize: 11[,\s}]/);
      expect(src, `${name}: raw 12.5`).not.toMatch(/fontSize: 12\.5/);
    }
    expect(panel).toMatch(/\.\.\.FOOD_TYPE\.title, color: "var\(--text-primary\)"/);
    expect(panel).not.toMatch(/FONT_SIZE\.display, background: "var\(--accent-food\)"/); // "Log a visit" is body size, not a fifth size
  });
});

describe("NEW-1 — one left edge", () => {
  it("the status dot HANGS in the gutter (absolute, left of the column) and no block carries the old 17 px inset", () => {
    expect(panel).toMatch(/data-testid="food-panel-accent-dot"[\s\S]{0,120}position: "absolute", left: -12/);
    expect(panel).not.toMatch(/marginLeft: 17/);
  });
  it("dish rows are flat on the column edge — no rounded box inset 12 px — and '+ Add a dish' has no left padding", () => {
    expect(dishes).toMatch(/padding: "9px 0", cursor: "pointer", minHeight: 48/);
    expect(dishes).not.toMatch(/border: "1px solid var\(--border-default\)", borderRadius: RADIUS\.lg, overflow: "clip" \}\}>\{list\(/);
    expect(dishes).toMatch(/border: "none", borderBottom: "1px solid var\(--border-default\)", padding: 0, minHeight: 44/);
  });
  it("the visit row sits on the same inset as everything else (margin, not padding) and keeps a 44 target", () => {
    expect(panel).toMatch(/margin: `0 \$\{COLUMN_X\}px`, minHeight: 44/);
  });
});

describe("NEW-1 — a visit row reads date (quiet) · scores (answer)", () => {
  const fmt = (d) => `D${d}`;
  it("visitRowParts splits the date from the scores; visitRowLabel is the same parts as the one plain string", () => {
    expect(visitRowParts({ visited_on: "2026-10-01", rating: 8.25, rating_ambiance: 8 }, fmt)).toEqual([
      { kind: "date", text: "D2026-10-01", undated: false }, { kind: "score", label: "Food", value: "8.25" }, { kind: "score", label: "Ambiance", value: "8.0" },
    ]);
    expect(visitRowParts({ visited_on: null, rating: 7.5, rating_ambiance: null }, fmt)).toEqual([{ kind: "date", text: "No date", undated: true }, { kind: "score", label: "Food", value: "7.5" }]);
    expect(visitRowLabel({ visited_on: null, rating: 7.5, rating_ambiance: 7.5 }, fmt)).toBe("No date · Food 7.5 · Ambiance 7.5");
  });
  it("the row paints the date in the secondary colour and the score numbers bold in the primary one", () => {
    expect(panel).toMatch(/\.\.\.FOOD_TYPE\.body, color: "var\(--text-secondary\)", fontVariantNumeric: "tabular-nums"/);
    expect(panel).toMatch(/<b style=\{\{ color: "var\(--text-primary\)", fontWeight: 700 \}\}>\{p\.value\}<\/b>/);
  });
});

describe("NEW-2 — one add-a-dish control at a time", () => {
  it("the place card's dish list is told to step aside while ANY form (log a visit or edit a past visit) is open", () => {
    expect(panel).toMatch(/hideAdd=\{adding \|\| !!editingVisitId\}/);
  });
  it("DishesSection draws neither the add row nor its open editor when hideAdd is set (the draft stays in the store for when the form closes)", () => {
    expect(dishes).toMatch(/hideAdd = false \}\) \{/);
    expect(dishes).toMatch(/\{!hideAdd && \(\s*<div style=\{\{ marginTop: ITEM_STEP \* 2 \}\}>/);
    expect(dishes).toMatch(/useDraftField\(`dishes-ui:\$\{scope\}`, "addingNew", false\)/);
  });
});
