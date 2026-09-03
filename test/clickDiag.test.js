import { describe, it, expect } from "vitest";
import { labelFor, describeSuspect } from "../src/shared/ui/clickDiag.js";

describe("clickDiag — labelFor", () => {
  it("prefers aria-label over text content", () => {
    const el = { getAttribute: (k) => (k === "aria-label" ? "Delete comp" : null), textContent: "Delete" };
    expect(labelFor(el)).toBe("Delete comp");
  });
  it("falls back to trimmed, collapsed text content", () => {
    const el = { getAttribute: () => null, textContent: "  Place  \n  on map  " };
    expect(labelFor(el)).toBe("Place on map");
  });
  it("truncates a very long label", () => {
    const el = { getAttribute: () => null, textContent: "x".repeat(200) };
    expect(labelFor(el)).toHaveLength(60);
  });
  it("never throws on a null element", () => {
    expect(labelFor(null)).toBe("");
  });
});

describe("clickDiag — describeSuspect (pure report builder)", () => {
  const rect = { x: 100, y: 200, w: 90, h: 25 };

  it("reports a swallowed press that's still in the DOM, unmoved, uncovered", () => {
    const r = describeSuspect(
      { label: "Edit", disabled: false, rect },
      { stillInDom: true, rectNow: { x: 100, y: 200, w: 90, h: 25 }, coveredBy: null }
    );
    expect(r.kind).toBe("click-swallowed");
    expect(r.message).toContain('"Edit"');
    expect(r.extra).toEqual({
      label: "Edit", disabledAtPress: false, stillInDom: true, moved: false,
      rectAtPress: rect, rectNow: { x: 100, y: 200, w: 90, h: 25 }, coveredBy: null,
    });
  });

  it("flags a genuine position shift between press and the grace-period check", () => {
    const r = describeSuspect(
      { label: "Place on map", disabled: false, rect },
      { stillInDom: true, rectNow: { x: 100, y: 260, w: 90, h: 25 }, coveredBy: null }
    );
    expect(r.extra.moved).toBe(true);
  });

  it("reports a button that no longer exists (removed/replaced by a re-render)", () => {
    const r = describeSuspect(
      { label: "Delete", disabled: false, rect },
      { stillInDom: false, rectNow: null, coveredBy: null }
    );
    expect(r.extra.stillInDom).toBe(false);
    expect(r.extra.moved).toBe(null); // can't ask whether it moved if it's gone
    expect(r.extra.rectNow).toBe(null);
  });

  it("names what now covers the button's own center point, when something does", () => {
    const r = describeSuspect(
      { label: "Confirm", disabled: false, rect },
      { stillInDom: true, rectNow: { x: 100, y: 200, w: 90, h: 25 }, coveredBy: "DIV.overlay" }
    );
    expect(r.extra.coveredBy).toBe("DIV.overlay");
  });

  it("records whether the button was disabled at the moment it was pressed", () => {
    const r = describeSuspect(
      { label: "Save", disabled: true, rect },
      { stillInDom: true, rectNow: rect, coveredBy: null }
    );
    expect(r.extra.disabledAtPress).toBe(true);
  });
});
