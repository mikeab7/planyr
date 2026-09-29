import { describe, it, expect } from "vitest";
import {
  emptyHistory, pushHistory, undoHistory, redoHistory, canUndo, canRedo, HIST_CAP, scaleToSlider, sliderToScale,
} from "../src/workspaces/site-planner/lib/cropHistory.js";

describe("cropHistory — undo/redo for both crop shapes (NEW-4)", () => {
  it("starts with nothing to undo or redo", () => {
    const h = emptyHistory();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
    expect(undoHistory(h, "now")).toBeNull();
    expect(redoHistory(h, "now")).toBeNull();
  });
  it("undo returns the pushed snapshot and lands the current one on the redo side", () => {
    let h = pushHistory(emptyHistory(), "A");
    const u = undoHistory(h, "B");
    expect(u.snap).toBe("A");
    expect(canUndo(u.history)).toBe(false);
    expect(canRedo(u.history)).toBe(true);
    const r = redoHistory(u.history, "A");
    expect(r.snap).toBe("B");
    expect(canUndo(r.history)).toBe(true);
    expect(canRedo(r.history)).toBe(false);
  });
  it("a new action after an undo forgets the undone future", () => {
    let h = pushHistory(pushHistory(emptyHistory(), "A"), "B");
    h = undoHistory(h, "C").history;
    expect(canRedo(h)).toBe(true);
    h = pushHistory(h, "D");
    expect(canRedo(h)).toBe(false);
  });
  it("steps back several actions in order", () => {
    let h = emptyHistory();
    ["s0", "s1", "s2"].forEach((s) => { h = pushHistory(h, s); });
    const seen = [];
    let cur = "s3";
    for (let i = 0; i < 3; i++) { const u = undoHistory(h, cur); seen.push(u.snap); cur = u.snap; h = u.history; }
    expect(seen).toEqual(["s2", "s1", "s0"]);
  });
  it("is capped so a long session cannot grow without bound", () => {
    let h = emptyHistory();
    for (let i = 0; i < HIST_CAP + 20; i++) h = pushHistory(h, i);
    expect(h.past.length).toBe(HIST_CAP);
    expect(h.past[0]).toBe(20);
  });
  it("does not mutate the history it was given", () => {
    const h = pushHistory(emptyHistory(), "A");
    const before = JSON.stringify(h);
    undoHistory(h, "B"); redoHistory(h, "B"); pushHistory(h, "C");
    expect(JSON.stringify(h)).toBe(before);
  });
});

describe("zoom slider mapping (NEW-3)", () => {
  it("is logarithmic and round-trips", () => {
    for (const s of [0.02, 0.1, 0.5, 1, 4, 16]) expect(sliderToScale(scaleToSlider(s, 0.02, 16), 0.02, 16)).toBeCloseTo(s, 6);
    expect(scaleToSlider(0.02, 0.02, 16)).toBe(0);
    expect(scaleToSlider(16, 0.02, 16)).toBe(1);
  });
  it("clamps out-of-range input", () => {
    expect(scaleToSlider(100, 0.02, 16)).toBe(1);
    expect(sliderToScale(-1, 0.02, 16)).toBeCloseTo(0.02, 9);
    expect(sliderToScale(2, 0.02, 16)).toBeCloseTo(16, 9);
  });
});
