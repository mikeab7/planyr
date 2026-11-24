import { describe, it, expect } from "vitest";
import { nextMenuIndex } from "../src/shared/ui/menuRoving.js";

describe("nextMenuIndex (ContextMenu roving focus)", () => {
  it("Down from nowhere enters at the first row; Up enters at the last", () => {
    expect(nextMenuIndex("ArrowDown", -1, 4)).toBe(0);
    expect(nextMenuIndex("ArrowUp", -1, 4)).toBe(3);
  });
  it("steps one row and wraps at both ends", () => {
    expect(nextMenuIndex("ArrowDown", 1, 4)).toBe(2);
    expect(nextMenuIndex("ArrowDown", 3, 4)).toBe(0);
    expect(nextMenuIndex("ArrowUp", 2, 4)).toBe(1);
    expect(nextMenuIndex("ArrowUp", 0, 4)).toBe(3);
  });
  it("Home and End jump", () => {
    expect(nextMenuIndex("Home", 2, 4)).toBe(0);
    expect(nextMenuIndex("End", 0, 4)).toBe(3);
  });
  it("is not ours with no rows or another key", () => {
    expect(nextMenuIndex("ArrowDown", 0, 0)).toBeNull();
    expect(nextMenuIndex("a", 0, 3)).toBeNull();
  });
});
