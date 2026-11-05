/* foodVisitSheetLayout — the source-level half of NEW-1..4 + NEW-6 (2026-10-23, owner on his iPhone). The picture is
 * ui-audit/verify-food-visit-sheet-layout.mjs (WebKit + Chromium, both iPhone sizes, ink measured from pixels); these are the guards
 * a plain `vitest run` can enforce. Each fails on the main that preceded the change. */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { opensKeyboard } from "../src/workspaces/food/lib/textEntry.js";
import { chipBox, CHIP_BASE } from "../src/workspaces/food/lib/chipStyle.js";

const root = new URL("../src/workspaces/food/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const sheet = read("components/BottomSheet.jsx");
const panel = read("components/VisitPanel.jsx");

describe("NEW-1 — the grab zone stays tall but the header sits right under the bar", () => {
  it("the bar is at the TOP of the zone, and the zone's lower part is overlapped by the header, not given its own space", () => {
    expect(sheet).toMatch(/const HANDLE_ZONE_PX = 56;/);
    expect(sheet).toMatch(/const HANDLE_OVERLAP_PX = 32;/);
    expect(sheet).toMatch(/marginBottom: -HANDLE_OVERLAP_PX/);
    expect(sheet).toMatch(/alignItems: "flex-start", paddingTop: 8/);
    expect(sheet).not.toMatch(/alignItems: "flex-end", paddingBottom: 8/); // the old bottom-pinned bar over 44 px of empty white
  });
  it("the sheet's height maths counts only the handle's LAYOUT height (the overlap belongs to the header)", () => {
    expect(sheet).toMatch(/offsetHeight \?\? 0\) - HANDLE_OVERLAP_PX/);
  });
  it("the header is still a grab area, so the overlapped part of the zone still drags", () => {
    expect(panel).toMatch(/data-sheet-grab=""/);
    expect(sheet).toMatch(/closest\?\.\("\[data-sheet-grab\]"\)/);
  });
});

describe("NEW-2 — the ✕ rides the title's FIRST line", () => {
  it("the header row aligns to flex-start (the ✕'s -10 overhang centres it on a 24-high first line)", () => {
    expect(panel).toMatch(/alignItems: manualNameEditable \? "center" : "flex-start"/);
    expect(panel).toMatch(/margin: "-10px -8px -10px 0"/);
  });
});

describe("NEW-3 — one centred box for every chip", () => {
  it("chipBox: explicit height, centred on both axes, line-height 1, horizontal padding only", () => {
    const c = chipBox(28, 10, { fontSize: 12 });
    expect(c).toMatchObject({ display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1, height: 28, minHeight: 28, padding: "0 10px", fontSize: 12 });
    expect(Object.isFrozen(CHIP_BASE)).toBe(true);
  });
  it("no chip recipe grows back: baseline-aligned inline-flex pills and inline-block rating pills are gone", () => {
    const files = readdirSync(new URL("components/", root)).filter((f) => f.endsWith(".jsx"));
    for (const f of files) {
      const src = read(`components/${f}`);
      expect(src, `${f}: a baseline-aligned inline-flex pill`).not.toMatch(/display: "inline-flex", alignItems: "baseline"[^}]*borderRadius: RADIUS\.pill/);
      expect(src, `${f}: an inline-block pill with vertical padding`).not.toMatch(/display: "inline-block", borderRadius: RADIUS\.(sm|pill), padding: "1px/);
    }
  });
  it("every pill / badge / readout the sweep named renders through chipBox and carries data-chip", () => {
    for (const [f, needle] of [["components/VisitPanel.jsx", "chipBox(28, 10"], ["components/AddToListControl.jsx", "chipBox(28, 10)"], ["components/RatingSlider.jsx", "chipBox(active ? 20 : 14"], ["components/DishesSection.jsx", "chipBox(26, 6)"], ["components/VisitList.jsx", "chipBox(20, 6)"], ["components/ListPanel.jsx", "chipBox(18, 7)"], ["components/SearchBox.jsx", "chipBox(18, 6)"]]) {
      const src = read(f);
      expect(src, f).toContain(needle);
      expect(src, f).toContain('data-chip');
    }
  });
});

describe("NEW-4 — the form asks Food and Ambiance before the dishes, then Date", () => {
  const form = panel.slice(panel.indexOf("<form onSubmit={submit}"), panel.indexOf("<label data-edit-card=\"\" style={groupLabel}>\n        Cost"));
  it("source order: Food, Ambiance, the dishes, Date", () => {
    const at = (s) => form.indexOf(s);
    expect(at('aria-label="Food"')).toBeGreaterThan(0);
    expect(at('aria-label="Ambiance"')).toBeGreaterThan(at('aria-label="Food"'));
    expect(at("<DraftDishes")).toBeGreaterThan(at('aria-label="Ambiance"'));
    expect(at('type="date"')).toBeGreaterThan(at("<DraftDishes"));
  });
  it("there is exactly one visit entry form (VisitForm) — the add-restaurant, manual-pin and edit flows all render it, so the order cannot differ", () => {
    expect((panel.match(/<VisitForm\b/g) || []).length).toBe(2); // the new-visit mount and the inline edit mount
    expect((panel.match(/<form\b/g) || []).length).toBe(1);
    expect(readFileSync(new URL("FoodApp.jsx", root), "utf8")).not.toMatch(/<form\b/);
  });
});

describe("NEW-6 — the Date field and the focus rule", () => {
  it("Date is a full-width, 44-high, native-chrome-free field pinned to the column", () => {
    expect(panel).toMatch(/className="food-date-input"/);
    const css = readFileSync(new URL("../../index.css", root), "utf8");
    expect(css).toMatch(/\.food-date-input \{[^}]*appearance: none[^}]*width: 100%[^}]*max-width: 100%[^}]*min-width: 0[^}]*min-height: 44px/);
  });
  it("opensKeyboard: text-like inputs, date, textarea and select open one; a rating slider, checkbox and buttons do not", () => {
    const el = (tagName, type) => ({ tagName, type });
    for (const t of ["text", "search", "number", "date", "email", "tel", undefined]) expect(opensKeyboard(el("INPUT", t)), String(t)).toBe(true);
    expect(opensKeyboard(el("TEXTAREA"))).toBe(true);
    expect(opensKeyboard(el("SELECT"))).toBe(true);
    for (const t of ["range", "checkbox", "radio", "button", "submit", "file", "color"]) expect(opensKeyboard(el("INPUT", t)), t).toBe(false);
    expect(opensKeyboard(el("BUTTON"))).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });
  it("the sheet and the side dock both key `typing` on it, never on the tag alone", () => {
    for (const f of ["components/BottomSheet.jsx", "components/SideDock.jsx"]) {
      const src = read(f);
      expect(src, f).toMatch(/opensKeyboard\(/);
      expect(src, f).not.toMatch(/INPUT\|TEXTAREA\|SELECT/);
    }
  });
});
