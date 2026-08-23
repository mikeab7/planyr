import { describe, it, expect } from "vitest";
import { describeCoalescedLabel } from "../src/workspaces/site-planner/lib/conflictToasts.js";

describe("describeCoalescedLabel — NEW-1 round 2: one sentence names a whole gesture's members", () => {
  it("empty input → a safe generic fallback, never a blank sentence", () => {
    expect(describeCoalescedLabel([])).toBe("an item");
    expect(describeCoalescedLabel(undefined)).toBe("an item");
    expect(describeCoalescedLabel([null, "", 0])).toBe("an item");
  });

  it("one label → itself, unchanged", () => {
    expect(describeCoalescedLabel(["a building"])).toBe("a building");
  });

  it("two labels → \"X and Y\"", () => {
    expect(describeCoalescedLabel(["a building", "a paving area"])).toBe("a building and a paving area");
  });

  it("three labels → \"X, Y, and Z\"", () => {
    expect(describeCoalescedLabel(["a building", "a paving area", "a parking field"]))
      .toBe("a building, a paving area, and a parking field");
  });

  it("more than three → \"X, Y, and N more\", not a runaway sentence", () => {
    expect(describeCoalescedLabel(["a building", "a paving area", "a parking field", "an element", "a sidewalk"]))
      .toBe("a building, a paving area, and 3 more");
  });

  it("dedupes by TEXT, preserving first-seen order — two elements the app describes identically collapse to one", () => {
    expect(describeCoalescedLabel(["an element", "a building", "an element"])).toBe("an element and a building");
  });
});
