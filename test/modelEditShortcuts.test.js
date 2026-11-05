/* lib/editShortcuts.js — the text half of the Excel shortcuts: F4 reference cycling, insert-at-caret, date / time text. */
import { describe, it, expect } from "vitest";
import { cycleReferenceAtCaret, insertAtCaret, todayIso, timeText } from "../src/workspaces/model/lib/editShortcuts.js";

describe("F4 cycles the reference at the caret", () => {
  it("A1 -> $A$1 -> A$1 -> $A1 -> A1", () => {
    let v = "=A1+B2", caret = 3;
    const seen = [];
    for (let i = 0; i < 4; i++) { const r = cycleReferenceAtCaret(v, caret); seen.push(r.value); v = r.value; caret = r.caret; }
    expect(seen).toEqual(["=$A$1+B2", "=A$1+B2", "=$A1+B2", "=A1+B2"]);
  });
  it("acts on the reference the caret touches, leaving the others alone", () => {
    expect(cycleReferenceAtCaret("=A1+B2", 6).value).toBe("=A1+$B$2"); // caret at the end of B2
    expect(cycleReferenceAtCaret("=SUM(A1:A5)", 7).value).toBe("=SUM($A$1:A5)");
  });
  it("returns null off a reference or outside a formula", () => {
    expect(cycleReferenceAtCaret("=A1 + B2", 4)).toBeNull(); // the caret sits on the '+', touching neither reference
  });
  it("a plain value is not a formula; function names and words are not references", () => {
    expect(cycleReferenceAtCaret("A1", 1)).toBeNull();
    expect(cycleReferenceAtCaret("=LOG10(2)", 4)).toBeNull();
  });
});

describe("insertAtCaret", () => {
  it("inserts at the caret and replaces a selection", () => {
    expect(insertAtCaret("abcd", 2, 2, "X")).toEqual({ value: "abXcd", caret: 3 });
    expect(insertAtCaret("abcd", 1, 3, "\n")).toEqual({ value: "a\nd", caret: 2 });
    expect(insertAtCaret("abcd", 3, 1, "-")).toEqual({ value: "a-d", caret: 2 });
  });
});

describe("date and time text", () => {
  it("today as an ISO date; time in 12-hour form", () => {
    expect(todayIso(new Date(2026, 9, 29))).toBe("2026-10-29");
    expect(timeText(new Date(2026, 9, 29, 15, 7))).toBe("3:07 PM");
    expect(timeText(new Date(2026, 9, 29, 0, 5))).toBe("12:05 AM");
    expect(timeText(new Date(2026, 9, 29, 12, 0))).toBe("12:00 PM");
  });
});
