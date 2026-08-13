/* HOW FAR APART THE LINES ARE (NEW-7) — the pure half.
 *
 * ⛔ SPACING IS A BLOCK PROPERTY, NOT A TEXT STYLE. Half a line cannot be one-and-a-half
 * spaced; putting it on a text style would let the document express a state no layout can
 * honour. And ONE attribute writes the whole style string, because three that each wrote
 * `style` would overwrite one another — the last rendered would win and the other two would
 * silently vanish, which is the sort of bug that only appears on the third setting.
 */
import { describe, expect, it } from "vitest";

import {
  BLOCK_SPACES, LINE_SPACINGS, spacingFromElement, spacingLabel, spacingStyle,
} from "../src/workspaces/notes/lib/notesSpacing.js";

describe("spacingStyle", () => {
  it("says nothing when there is nothing to say — a paragraph starts with no spacing of its own", () => {
    expect(spacingStyle({})).toBe("");
    expect(spacingStyle({ lineHeight: null, spaceBefore: null, spaceAfter: null })).toBe("");
    expect(spacingStyle()).toBe("");
  });

  it("⛔ WRITES ALL THREE IN ONE STRING, so none of them can overwrite another", () => {
    expect(spacingStyle({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12 }))
      .toBe("line-height:1.5;margin-top:6px;margin-bottom:12px");
  });

  it("writes only what was set", () => {
    expect(spacingStyle({ lineHeight: 2 })).toBe("line-height:2");
    expect(spacingStyle({ spaceAfter: 20 })).toBe("margin-bottom:20px");
  });

  it("refuses a value that is not a positive number, rather than emitting nonsense into the markup", () => {
    expect(spacingStyle({ lineHeight: 0 })).toBe("");
    expect(spacingStyle({ lineHeight: -1 })).toBe("");
    expect(spacingStyle({ lineHeight: "wide" })).toBe("");
    expect(spacingStyle({ spaceBefore: NaN })).toBe("");
  });

  it("rounds the pixel values — a fractional margin in the markup helps nobody", () => {
    expect(spacingStyle({ spaceBefore: 6.4, spaceAfter: 11.6 })).toBe("margin-top:6px;margin-bottom:12px");
  });
});

describe("spacingFromElement — the round trip, which is what a paste and a reload need", () => {
  const el = (style) => ({ style });

  it("reads all three back", () => {
    expect(spacingFromElement(el({ lineHeight: "1.5", marginTop: "6px", marginBottom: "12px" })))
      .toEqual({ lineHeight: 1.5, spaceBefore: 6, spaceAfter: 12 });
  });

  it("an absent value comes back as null, which is the attribute's default", () => {
    expect(spacingFromElement(el({}))).toEqual({ lineHeight: null, spaceBefore: null, spaceAfter: null });
    expect(spacingFromElement(null)).toEqual({ lineHeight: null, spaceBefore: null, spaceAfter: null });
  });

  it("⛔ SURVIVES THE ROUND TRIP — what renderHTML writes is what parseHTML reads", () => {
    for (const attrs of [
      { lineHeight: 1.15, spaceBefore: null, spaceAfter: null },
      { lineHeight: 2, spaceBefore: 12, spaceAfter: 20 },
      { lineHeight: null, spaceBefore: 6, spaceAfter: null },
    ]) {
      const style = {};
      for (const rule of spacingStyle(attrs).split(";").filter(Boolean)) {
        const [k, v] = rule.split(":");
        style[k === "line-height" ? "lineHeight" : (k === "margin-top" ? "marginTop" : "marginBottom")] = v;
      }
      expect(spacingFromElement({ style })).toEqual(attrs);
    }
  });
});

describe("the choices", () => {
  it("Single is the absence of a setting, not a number — so a note keeps its own spacing", () => {
    expect(LINE_SPACINGS[0]).toEqual({ label: "Single", value: null });
    expect(spacingStyle({ lineHeight: LINE_SPACINGS[0].value })).toBe("");
  });

  it("offers Word's four, in Word's order", () => {
    expect(LINE_SPACINGS.map((s) => s.label)).toEqual(["Single", "1.15", "1.5", "Double"]);
  });

  it("space before/after are coarse on purpose — a points box is a preference panel", () => {
    expect(BLOCK_SPACES.map((s) => s.label)).toEqual(["None", "Small", "Medium", "Large"]);
  });

  it("⛔ THE CONTROL NEVER CLAIMS A SETTING THE PARAGRAPH DOES NOT HAVE", () => {
    expect(spacingLabel(null)).toBe("Spacing");
    expect(spacingLabel(0)).toBe("Spacing");
    expect(spacingLabel(1.5)).toBe("1.5");
    expect(spacingLabel(2)).toBe("Double");
    expect(spacingLabel(1.37)).toBe("1.37");     // a value from elsewhere is shown, not hidden
  });
});
