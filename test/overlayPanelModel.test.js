import { describe, it, expect } from "vitest";
import { overlayKind, isOverlayScaled, overlaySubline, placementPlan, scaledPatch, formatScaleRatio } from "../src/workspaces/site-planner/lib/overlayPanelModel.js";
import { moveOverlayStep, dropOverlay, overlayPanelOrder } from "../src/workspaces/site-planner/lib/overlayOrder.js";

const pdf = (o = {}) => ({ id: "p", name: "a.pdf", sheet: { std: true, label: "ANSI D" }, imgW: 2448, imgH: 1584, ftPerPx: 200 / 72, page: 1, pageCount: 1, ...o });
const img = (o = {}) => ({ id: "i", name: "a.png", imgW: 800, imgH: 600, ftPerPx: 1, ...o });

describe("overlay kinds + scaled state (NEW-1 redesign)", () => {
  it("classifies pdf / image / dxf / map", () => {
    expect(overlayKind(pdf())).toBe("pdf");
    expect(overlayKind(img())).toBe("image");
    expect(overlayKind({ ...img(), kind: "dxf" })).toBe("dxf");
    expect(overlayKind({ ...img(), fromMap: true })).toBe("map");
  });
  it("a legacy overlay with no flag reads as SCALED (no amber on anything that exists today)", () => {
    expect(isOverlayScaled(pdf())).toBe(true);
    expect(isOverlayScaled(img())).toBe(true);
    expect(isOverlayScaled(pdf({ unscaled: false }))).toBe(true);
  });
  it("unscaled:true reads not scaled; a DXF with assumed units reads not scaled; a map capture never does", () => {
    expect(isOverlayScaled(img({ unscaled: true }))).toBe(false);
    expect(isOverlayScaled({ ...img(), kind: "dxf", unitsAssumed: true })).toBe(false);
    expect(isOverlayScaled({ ...img(), kind: "dxf", unitsAssumed: false })).toBe(true);
    expect(isOverlayScaled({ ...img(), fromMap: true, unscaled: true })).toBe(true);
  });
  it("scaledPatch marks scaled, and confirms a DXF's guessed units", () => {
    expect(scaledPatch(img())).toEqual({ unscaled: false });
    expect(scaledPatch({ ...img(), kind: "dxf" })).toEqual({ unscaled: false, unitsAssumed: false });
  });
});

describe("row sub-line", () => {
  it("PDF shows the ratio; multi-page appends p. N", () => {
    expect(overlaySubline(pdf())).toEqual({ text: `1" = 200'`, warn: false });
    expect(overlaySubline(pdf({ pageCount: 5, page: 3 })).text).toBe(`1" = 200' · p. 3`);
  });
  it("architectural scale uses the preset label; odd scale rounds", () => {
    expect(formatScaleRatio(8)).toBe(`1/8" = 1'-0"`);
    expect(formatScaleRatio(37.46)).toBe(`1" = 37.5'`);
  });
  it("unscaled shows amber 'not scaled' and NEVER a ratio", () => {
    expect(overlaySubline(pdf({ unscaled: true }))).toEqual({ text: "not scaled", warn: true });
    expect(overlaySubline(img({ unscaled: true }))).toEqual({ text: "not scaled", warn: true });
  });
  it("an image never shows a ratio; a dxf shows drawing units; assumed units read not scaled", () => {
    expect(overlaySubline(img()).text).not.toMatch(/=/);
    expect(overlaySubline({ ...img(), kind: "dxf", unitsLabel: "feet" }).text).toBe("Drawing units · feet");
    expect(overlaySubline({ ...img(), kind: "dxf", unitsAssumed: true })).toEqual({ text: "not scaled", warn: true });
  });
});

describe("placement plan per kind", () => {
  it("PDF gets all three scale buttons + ratio + knockout", () => {
    const p = placementPlan(pdf());
    expect(p.scaleButtons).toEqual(["set", "trace", "match"]);
    expect(p.showRatio && p.knockout && p.rotate && p.crop).toBe(true);
  });
  it("image gets only trace + match, no ratio, no knockout", () => {
    const p = placementPlan(img());
    expect(p.scaleButtons).toEqual(["trace", "match"]);
    expect(p.showRatio || p.knockout).toBe(false);
  });
  it("unscaled shows the amber box for pdf/image/dxf but not the map capture", () => {
    expect(placementPlan(img({ unscaled: true })).notScaledBox).toBe(true);
    expect(placementPlan(pdf({ unscaled: true })).showRatio).toBe(false);
    expect(placementPlan({ ...img(), fromMap: true, unscaled: true }).notScaledBox).toBe(false);
  });
  it("map capture: no scale row, no rotate, no crop", () => {
    const p = placementPlan({ ...img(), fromMap: true });
    expect(p.scaleButtons).toEqual([]);
    expect(p.rotate || p.crop || p.showRatio).toBe(false);
  });
  it("page change only for multi-page PDFs", () => {
    expect(placementPlan(pdf()).pageChange).toBe(false);
    expect(placementPlan(pdf({ pageCount: 3 })).pageChange).toBe(true);
  });
});

describe("panel reorder", () => {
  const L = () => [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "up", aboveParcel: true }]; // array = back → front
  const ids = (l) => l.map((o) => o.id).join("");
  it("moveOverlayStep +1 moves toward the front within its band; ends and cross-band are no-ops", () => {
    expect(ids(moveOverlayStep(L(), "a", 1))).toBe("bacup");
    expect(ids(moveOverlayStep(L(), "c", -1))).toBe("acbup");
    const l = L(); expect(moveOverlayStep(l, "c", 1)).toBe(l);   // at front of its band
    expect(moveOverlayStep(l, "a", -1)).toBe(l);
  });
  it("dropOverlay puts the dragged row in front of / behind the target", () => {
    expect(ids(dropOverlay(L(), "a", "c", "front"))).toBe("bcaup");
    expect(ids(dropOverlay(L(), "c", "a", "behind"))).toBe("cabup");
  });
  it("dropOverlay refuses a cross-band drop, a self drop and a no-change drop (same array back)", () => {
    const l = L();
    expect(dropOverlay(l, "a", "up", "front")).toBe(l);
    expect(dropOverlay(l, "a", "a", "front")).toBe(l);
    expect(dropOverlay(l, "c", "b", "front")).toBe(l);
  });
  it("a pinned map capture never moves and nothing lands beneath it", () => {
    const l = [{ id: "m", fromMap: true }, { id: "a" }, { id: "b" }];
    expect(moveOverlayStep(l, "m", 1)).toBe(l);
    expect(dropOverlay(l, "m", "b", "front")).toBe(l);
    expect(dropOverlay(l, "b", "m", "behind")).toBe(l);            // nothing lands beneath the pinned capture (indicator must not promise it)
    expect(ids(dropOverlay(l, "b", "m", "front"))).toBe("mba");
  });
  it("the panel lists front-most first", () => { expect(ids(overlayPanelOrder(L()))).toBe("upcba"); });
});
