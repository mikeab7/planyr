import { describe, it, expect } from "vitest";
import { describeHistoryStep, describeHistorySteps, historyRunLabel } from "../src/workspaces/site-planner/lib/historyLabel.js";

const doc = (over = {}) => ({
  parcels: [], els: [], measures: [], callouts: [], markups: [], sheetOverlays: [],
  underlay: null, origin: null, layerOverrides: {}, layerAbove: {},
  ...over,
});
const bldg = (id, over = {}) => ({ id, type: "building", cx: 0, cy: 0, w: 100, h: 60, rot: 0, ...over });

describe("historyLabel — naming an undo step from what actually changed (B648353)", () => {
  it("adding one element names its kind", () => {
    const before = doc();
    const after = doc({ els: [bldg("b1")] });
    expect(describeHistoryStep(before, after)).toBe("Added building");
  });

  it("adding several elements of a mixed kind is counted generically", () => {
    const before = doc();
    const after = doc({ els: [bldg("b1"), bldg("b2", { type: "paving" })] });
    expect(describeHistoryStep(before, after)).toBe("Added 2 elements");
  });

  it("deleting a callout says so, and distinguishes a text box (noLeader) from a callout", () => {
    const before = doc({ callouts: [{ id: "c1", tip: { x: 0, y: 0 }, box: {}, text: "hi" }] });
    const after = doc({ callouts: [] });
    expect(describeHistoryStep(before, after)).toBe("Deleted callout");

    const before2 = doc({ callouts: [{ id: "c2", noLeader: true, box: {}, text: "hi" }] });
    const after2 = doc({ callouts: [] });
    expect(describeHistoryStep(before2, after2)).toBe("Deleted text box");
  });

  it("moving a building (cx/cy only) says Moved, not Edited", () => {
    const before = doc({ els: [bldg("b1", { cx: 0, cy: 0 })] });
    const after = doc({ els: [bldg("b1", { cx: 40, cy: 0 })] });
    expect(describeHistoryStep(before, after)).toBe("Moved building");
  });

  it("resizing (w/h only) says Resized", () => {
    const before = doc({ els: [bldg("b1", { w: 100 })] });
    const after = doc({ els: [bldg("b1", { w: 140 })] });
    expect(describeHistoryStep(before, after)).toBe("Resized building");
  });

  it("rotating (rot only) says Rotated", () => {
    const before = doc({ els: [bldg("b1", { rot: 0 })] });
    const after = doc({ els: [bldg("b1", { rot: 15 })] });
    expect(describeHistoryStep(before, after)).toBe("Rotated building");
  });

  it("moving AND resizing at once falls back to the generic Edited (ambiguous axis)", () => {
    const before = doc({ els: [bldg("b1", { cx: 0, w: 100 })] });
    const after = doc({ els: [bldg("b1", { cx: 40, w: 140 })] });
    expect(describeHistoryStep(before, after)).toBe("Edited building");
  });

  it("an attribute-only change (no move/resize/rotate/reshape) is Edited", () => {
    const before = doc({ els: [bldg("b1", { fillColor: "#111" })] });
    const after = doc({ els: [bldg("b1", { fillColor: "#222" })] });
    expect(describeHistoryStep(before, after)).toBe("Edited building");
  });

  it("editing several elements at once is counted with the plural noun", () => {
    const before = doc({ els: [bldg("b1", { cx: 0 }), bldg("b2", { cx: 0 })] });
    const after = doc({ els: [bldg("b1", { cx: 5 }), bldg("b2", { cx: 5 })] });
    expect(describeHistoryStep(before, after)).toBe("Edited 2 elements");
  });

  it("a paste touching more than one collection at once is counted as objects, not per-collection", () => {
    const before = doc();
    const after = doc({ els: [bldg("b1")], markups: [{ id: "m1", kind: "rect" }] });
    expect(describeHistoryStep(before, after)).toBe("Added 2 objects");
  });

  it("setting the geo origin is named even though no collection changed", () => {
    const before = doc({ origin: null });
    const after = doc({ origin: { lat: 29.7, lon: -95.4 } });
    expect(describeHistoryStep(before, after)).toBe("Set location");
  });

  it("toggling a GIS layer override is named", () => {
    const before = doc({ layerOverrides: {} });
    const after = doc({ layerOverrides: { flood: true } });
    expect(describeHistoryStep(before, after)).toBe("Changed layer visibility");
  });

  it("a byte-identical pair (a true no-op) reads as the honest generic fallback", () => {
    const s = doc({ els: [bldg("b1")] });
    expect(describeHistoryStep(s, { ...s })).toBe("Edited plan");
  });

  it("never throws on a missing/partial snapshot (legacy frame)", () => {
    expect(describeHistoryStep(null, doc())).toBe("Edited plan");
    expect(describeHistoryStep(doc(), undefined)).toBe("Edited plan");
    expect(describeHistoryStep({}, {})).toBe("Edited plan");
  });

  it("describeHistorySteps labels a whole ordered list", () => {
    const s0 = doc(), s1 = doc({ els: [bldg("b1")] });
    expect(describeHistorySteps([{ before: s0, after: s1 }])).toEqual(["Added building"]);
    expect(describeHistorySteps([])).toEqual([]);
  });

  it("markup/measure/parcel/reference-image kinds all get real nouns", () => {
    expect(describeHistoryStep(doc(), doc({ markups: [{ id: "m1", kind: "cloud" }] }))).toBe("Added revision cloud");
    expect(describeHistoryStep(doc(), doc({ measures: [{ id: "x1", mode: "area", pts: [] }] }))).toBe("Added area measurement");
    expect(describeHistoryStep(doc(), doc({ parcels: [{ id: "p1", points: [] }] }))).toBe("Added parcel");
    expect(describeHistoryStep(doc(), doc({ sheetOverlays: [{ id: "o1" }] }))).toBe("Added reference image");
  });
});

describe("historyRunLabel — the dropdown footer text", () => {
  it("singular for one action, plural beyond it", () => {
    expect(historyRunLabel("Undo", 1)).toBe("Undo 1 Action");
    expect(historyRunLabel("Undo", 3)).toBe("Undo 3 Actions");
    expect(historyRunLabel("Redo", 2)).toBe("Redo 2 Actions");
  });
});
