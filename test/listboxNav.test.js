/* listboxNav — the ONE rule set for typeahead suggestion lists (owner report 2026-10-29: arrow keys on address suggestions "don't work, or
 * I can't see it"; measured: they worked, the highlight was white on a white list). Pure rules + source guards so no list can grow its own
 * arrow handling or its own (invisible) highlight again. The browser proof is e2e/address-suggest-keyboard.spec.js (red on main). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { stepListIndex, listboxKeyAction, listboxRowStyle, listboxOptionId } from "../src/shared/ui/listboxNav.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const key = (k, extra = {}) => ({ key: k, altKey: false, ctrlKey: false, metaKey: false, ...extra });

describe("stepListIndex — one policy everywhere: enter at the ends, wrap, never dead-stop", () => {
  it("Down from nothing enters at row 1; Up from nothing enters at the last row", () => {
    expect(stepListIndex(-1, 1, 5)).toBe(0);
    expect(stepListIndex(-1, -1, 5)).toBe(4);
  });
  it("steps one row at a time and wraps at both ends", () => {
    expect(stepListIndex(0, 1, 5)).toBe(1);
    expect(stepListIndex(1, 1, 5)).toBe(2);
    expect(stepListIndex(4, 1, 5)).toBe(0);
    expect(stepListIndex(0, -1, 5)).toBe(4);
    expect(stepListIndex(3, -1, 5)).toBe(2);
  });
  it("an index left past the end (the list shrank) reads as nothing highlighted; no rows → -1", () => {
    expect(stepListIndex(9, 1, 3)).toBe(0);
    expect(stepListIndex(0, 1, 0)).toBe(-1);
  });
});

describe("listboxKeyAction — what a keydown means", () => {
  it("Up/Down are ours only when there are rows (so an empty list leaves the caret alone)", () => {
    expect(listboxKeyAction(key("ArrowDown"), { open: true, count: 3, active: -1 })).toBe("next");
    expect(listboxKeyAction(key("ArrowUp"), { open: false, count: 3, active: -1 })).toBe("prev"); // reopens a closed list
    expect(listboxKeyAction(key("ArrowDown"), { open: true, count: 0, active: -1 })).toBeNull();
  });
  it("Enter commits only a HIGHLIGHTED row of an OPEN list; otherwise it is the caller's own Enter", () => {
    expect(listboxKeyAction(key("Enter"), { open: true, count: 3, active: 1 })).toBe("commit");
    expect(listboxKeyAction(key("Enter"), { open: true, count: 3, active: -1 })).toBeNull();
    expect(listboxKeyAction(key("Enter"), { open: false, count: 3, active: 1 })).toBeNull();
  });
  it("Escape closes an open list and is not ours when closed", () => {
    expect(listboxKeyAction(key("Escape"), { open: true, count: 3, active: -1 })).toBe("close");
    expect(listboxKeyAction(key("Escape"), { open: false, count: 3, active: -1 })).toBeNull();
  });
  it("Alt/Ctrl/Meta chords are never ours", () => {
    expect(listboxKeyAction(key("ArrowDown", { altKey: true }), { open: true, count: 3, active: -1 })).toBeNull();
    expect(listboxKeyAction(key("ArrowUp", { ctrlKey: true }), { open: true, count: 3, active: -1 })).toBeNull();
  });
});

describe("listboxRowStyle — the highlight is a SOLID fill with on-accent ink, never a tint on the list's own colour", () => {
  it("active = accent fill + on-accent ink; inactive = transparent (the list's surface shows)", () => {
    expect(listboxRowStyle(true)).toEqual({ background: "var(--accent)", color: "var(--on-accent)" });
    expect(listboxRowStyle(false)).toEqual({ background: "transparent" });
    expect(listboxRowStyle(true, "var(--accent-food)", "var(--on-accent-food)")).toEqual({ background: "var(--accent-food)", color: "var(--on-accent-food)" });
  });
  it("option ids are stable per list", () => { expect(listboxOptionId("x", 2)).toBe("x-opt-2"); });
});

describe("every suggestion list uses the shared hook (no list rolls its own arrows or highlight)", () => {
  const LISTS = [
    "src/workspaces/site-planner/components/PlaceSearchField.jsx", // map toolbar address / place search (the geocoder list)
    "src/shared/comps/components/PartyNameField.jsx",              // comp form party names
    "src/workspaces/food/components/SearchBox.jsx",                // Food restaurant search
  ];
  for (const f of LISTS) {
    it(`${f} → useListboxNav + listbox row style, no private ArrowDown handling, no surface-token highlight`, () => {
      const src = read(f);
      expect(src).toContain("useListboxNav");
      expect(src).toContain("listboxRowStyle");
      expect(src, "no private arrow handling").not.toMatch(/e\.key === "Arrow(Down|Up)"/);
      expect(src, "the old invisible highlight (a surface token on a surface)").not.toMatch(/i === activeIndex \? "var\(--(surface-raised|hover-menu)\)"/);
    });
  }
  it("the hook scrolls the highlighted row into view and shares hover with the keyboard highlight (mousemove, not mouseenter)", () => {
    const h = read("src/shared/ui/useListboxNav.js");
    expect(h).toContain("scrollIntoView");
    expect(h).toContain("onMouseMove");
    expect(h).not.toContain("onMouseEnter"); // a list scrolling under a still pointer must not steal the keyboard highlight
    expect(h).toContain('"aria-activedescendant"');
    expect(h).toContain('role: "option"');
  });
});
