import { describe, it, expect } from "vitest";
import { roadPanelTitle, roadPanelSubtitle, xsStripBands, xsCaption, xsSummary, labelSummary, xsButtonLabel } from "../src/workspaces/site-planner/lib/roadPanelModel.js";

const plain = { id: "r1", type: "road", travelW: 36 };
const designed = {
  id: "r2", type: "road", travelW: 52, locked: true,
  xsection: { bands: [{ type: "sidewalk", w: 5 }, { type: "curbGutter", w: 2.5 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "median", w: 6 }, { type: "travel", w: 12 }, { type: "travel", w: 12 }, { type: "curbGutter", w: 2.5 }, { type: "sidewalk", w: 5 }], rowDesignFt: 100 },
};

describe("road panel header", () => {
  it("title is the name, or 'Road' when unnamed or blank", () => {
    expect(roadPanelTitle({ inlineLabel: "MAIN ST" })).toBe("MAIN ST");
    expect(roadPanelTitle({ inlineLabel: "   " })).toBe("Road");
    expect(roadPanelTitle(plain)).toBe("Road");
  });
  it("subtitle: length · width, ROW only when designated, 'locked' when pinned", () => {
    expect(roadPanelSubtitle(plain, { lengthFt: 1240.4, widthFt: 36 })).toBe("1,240 ft long · 36 ft wide");
    // a single-band wrapper with NO rowDesignFt is not a designated ROW
    expect(roadPanelSubtitle({ ...plain, xsection: { bands: [{ type: "travel", w: 36 }] } }, { lengthFt: 10, widthFt: 36 })).toBe("10 ft long · 36 ft wide");
    expect(roadPanelSubtitle(designed, { lengthFt: 4244, widthFt: 52 })).toBe("4,244 ft long · 52 ft wide · 100 ft ROW · locked");
  });
});

describe("cross-section strip", () => {
  it("a plain road is curb · paving · curb, to scale", () => {
    const b = xsStripBands(plain, { travelFt: 36, curbFt: 0.5 });
    expect(b.map((x) => x.type)).toEqual(["curb", "paving", "curb"]);
    expect(b.map((x) => x.w)).toEqual([0.5, 36, 0.5]);
  });
  it("a designed section draws exactly the stored bands, widths untouched", () => {
    const b = xsStripBands(designed, { travelFt: 52, curbFt: 0.5 });
    expect(b.map((x) => x.type)).toEqual(designed.xsection.bands.map((x) => x.type));
    expect(b.map((x) => x.w)).toEqual(designed.xsection.bands.map((x) => x.w));
    for (const x of b) { expect(x.fill).toMatch(/^var\(--/); expect(x.opacity).toBeGreaterThan(0); } // theme tokens, never a hex
  });
  it("caption: a plain road says so; a designed one merges runs and counts lanes", () => {
    expect(xsCaption(plain, { travelFt: 36 })).toBe("Curb face to curb face, 36 ft");
    expect(xsCaption(designed, { travelFt: 52 })).toBe("Walk · curb · 2 lanes · median · 2 lanes · curb · walk");
  });
  it("summary + button wording follow whether a REAL section is stored", () => {
    expect(xsSummary(plain)).toBe("Plain road");
    expect(xsSummary(designed)).toBe("9 bands · 69 ft");
    // the dialog's own single-band wrapper is still 'plain'
    const wrapper = { ...plain, xsection: { bands: [{ type: "travel", w: 36 }] } };
    expect(xsSummary(wrapper)).toBe("Plain road");
    expect(xsButtonLabel(plain)).toBe("Design cross-section");
    expect(xsButtonLabel(wrapper)).toBe("Design cross-section");
    expect(xsButtonLabel(designed)).toBe("Edit cross-section");
  });
});

describe("label section summary", () => {
  it("shows the name when collapsed, 'None' otherwise", () => {
    expect(labelSummary({ inlineLabel: "TURNING BASIN DR" })).toBe("TURNING BASIN DR");
    expect(labelSummary(plain)).toBe("None");
  });
});
