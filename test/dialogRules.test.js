import { describe, it, expect } from "vitest";
import { dialogBackdropShouldClose, dialogTabTarget } from "../src/shared/ui/controls.jsx";

// The shared Dialog's pure rules (audit I4; owner constraint #54).
describe("dialog backdrop", () => {
  it("closes only when the press AND the release are on the backdrop", () => {
    expect(dialogBackdropShouldClose(true, true)).toBe(true);
    expect(dialogBackdropShouldClose(true, false)).toBe(false);   // drag that ended outside the press
    expect(dialogBackdropShouldClose(false, true)).toBe(false);   // press began in a field, released on the backdrop
    expect(dialogBackdropShouldClose(false, false)).toBe(false);
  });
});
describe("dialog focus trap", () => {
  it("wraps Tab at the last item and Shift+Tab at the first", () => {
    expect(dialogTabTarget(3, 2, false)).toBe(0);
    expect(dialogTabTarget(3, 0, true)).toBe(2);
  });
  it("lets the browser move focus in the middle", () => {
    expect(dialogTabTarget(3, 1, false)).toBeNull();
    expect(dialogTabTarget(3, 1, true)).toBeNull();
  });
  it("pulls focus in when it is outside, and parks it on the card when nothing is focusable", () => {
    expect(dialogTabTarget(3, -1, false)).toBe(0);
    expect(dialogTabTarget(3, -1, true)).toBe(2);
    expect(dialogTabTarget(0, -1, false)).toBe(-1);
  });
});
