/* B1139216 — a mixed selection must not present one of its values as THE value, and the same
 * value re-picked must always be a real decision, never a no-op the box already believed true.
 * See src/workspaces/notes/lib/notesMixedSelection.js for the reasoning. */
import { describe, expect, it } from "vitest";

import {
  MIXED,
  formatDisplayValue,
  selectionBlockShapes,
  selectionFontSizes,
  uniformValue,
} from "../src/workspaces/notes/lib/notesMixedSelection.js";

describe("uniformValue", () => {
  it("returns the shared value when every item agrees", () => {
    expect(uniformValue(["18px", "18px", "18px"])).toBe("18px");
  });

  it("⛔ returns MIXED the moment two items disagree — the reported case (24/18/9)", () => {
    expect(uniformValue(["24px", "18px", "9px"])).toBe(MIXED);
  });

  it("MIXED even when only the LAST item breaks agreement", () => {
    expect(uniformValue(["18px", "18px", "20px"])).toBe(MIXED);
  });

  it("agrees on `null` (every run explicitly carries no override) — not MIXED", () => {
    expect(uniformValue([null, null, null])).toBeNull();
  });

  it("null vs a real value IS a disagreement", () => {
    expect(uniformValue([null, "18px"])).toBe(MIXED);
  });

  it("an empty selection has nothing to disagree with — null, not MIXED", () => {
    expect(uniformValue([])).toBeNull();
    expect(uniformValue(undefined)).toBeNull();
  });

  it("a single value can never be mixed", () => {
    expect(uniformValue(["24px"])).toBe("24px");
  });
});

describe("formatDisplayValue", () => {
  it("a collapsed caret always trusts the caret's own value, never the range logic", () => {
    expect(formatDisplayValue({ selectionEmpty: true, caretValue: "24px", rangeValues: ["9px", "9px"] })).toBe("24px");
  });

  it("a caret with no override reads null, not undefined", () => {
    expect(formatDisplayValue({ selectionEmpty: true, caretValue: undefined, rangeValues: [] })).toBeNull();
  });

  it("⛔ THE MEASURED CASE: three blocks at 24/18/9, all selected, comes back MIXED — never '24'", () => {
    const v = formatDisplayValue({ selectionEmpty: false, caretValue: "24px", rangeValues: ["24px", "18px", "9px"] });
    expect(v).toBe(MIXED);
    expect(v).not.toBe("24px");
  });

  it("a uniform range reports the shared value even though it is a range, not a caret", () => {
    expect(formatDisplayValue({ selectionEmpty: false, caretValue: "24px", rangeValues: ["12px", "12px"] })).toBe("12px");
  });
});

describe("selectionFontSizes — walks a fake ProseMirror doc's nodesBetween", () => {
  const fakeDoc = (nodes) => ({
    nodesBetween(from, to, cb) { nodes.forEach((n) => cb(n)); },
  });
  const textStyle = (fontSize) => ({ type: { name: "textStyle" }, attrs: { fontSize } });
  const text = (marks) => ({ isText: true, marks });

  it("collects each text node's textStyle.fontSize", () => {
    const doc = fakeDoc([text([textStyle("24px")]), text([textStyle("18px")]), text([textStyle("9px")])]);
    expect(selectionFontSizes(doc, 0, 10)).toEqual(["24px", "18px", "9px"]);
  });

  it("a run with no textStyle mark contributes null, not undefined", () => {
    const doc = fakeDoc([text([]), text([textStyle("18px")])]);
    expect(selectionFontSizes(doc, 0, 10)).toEqual([null, "18px"]);
  });

  it("ignores non-text nodes entirely", () => {
    const doc = fakeDoc([{ isText: false, isTextblock: true, type: { name: "paragraph" } }, text([textStyle("18px")])]);
    expect(selectionFontSizes(doc, 0, 10)).toEqual(["18px"]);
  });
});

describe("selectionBlockShapes — walks a fake ProseMirror doc's nodesBetween", () => {
  const fakeDoc = (nodes) => ({
    nodesBetween(from, to, cb) { nodes.forEach((n) => cb(n)); },
  });
  const heading = (level) => ({ isTextblock: true, type: { name: "heading" }, attrs: { level } });
  const paragraph = () => ({ isTextblock: true, type: { name: "paragraph" }, attrs: {} });

  it("⛔ a heading and two paragraphs — the reported case (H2 + Body text) — is MIXED, not 'Body text'", () => {
    const doc = fakeDoc([heading(2), paragraph(), paragraph()]);
    expect(uniformValue(selectionBlockShapes(doc, 0, 10))).toBe(MIXED);
  });

  it("a uniform run of paragraphs reads 'p'", () => {
    const doc = fakeDoc([paragraph(), paragraph()]);
    expect(uniformValue(selectionBlockShapes(doc, 0, 10))).toBe("p");
  });

  it("a uniform run of same-level headings reads 'hN'", () => {
    const doc = fakeDoc([heading(3), heading(3)]);
    expect(uniformValue(selectionBlockShapes(doc, 0, 10))).toBe("h3");
  });

  it("two different heading levels are MIXED", () => {
    const doc = fakeDoc([heading(1), heading(2)]);
    expect(uniformValue(selectionBlockShapes(doc, 0, 10))).toBe(MIXED);
  });

  it("a list item's paragraph, a blockquote's paragraph and a plain paragraph all bucket as 'p'", () => {
    const doc = fakeDoc([paragraph(), paragraph(), paragraph()]);
    expect(uniformValue(selectionBlockShapes(doc, 0, 10))).toBe("p");
  });

  it("skips non-textblock nodes (a bulletList wrapper, a table)", () => {
    const doc = fakeDoc([{ isTextblock: false, type: { name: "bulletList" } }, paragraph()]);
    expect(selectionBlockShapes(doc, 0, 10)).toEqual(["p"]);
  });
});
