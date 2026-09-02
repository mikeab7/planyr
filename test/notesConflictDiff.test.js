/* notesConflictDiff — the pure word/line/anchor diff behind the conflict-resolution comparison
 *  bar (B842624). PURE, so every case here is a plain function call — no ProseMirror, no DOM.
 */
import { describe, it, expect } from "vitest";
import { diffNoteText, diffHasChanges, sideOps } from "../src/workspaces/notes/lib/notesConflictDiff.js";

/** Reconstruct one side from the ops, the way ConflictCompare renders it. */
function sideText(ops, side) {
  return sideOps(ops, side).map((op) => op.text).join("");
}

describe("diffNoteText — identical text", () => {
  it("reports no changes and both sides read back exactly", () => {
    const { granularity, ops } = diffNoteText("MUD 377\nActive", "MUD 377\nActive");
    expect(granularity).toBe("none");
    expect(diffHasChanges(ops)).toBe(false);
    expect(sideText(ops, "a")).toBe("MUD 377\nActive");
    expect(sideText(ops, "b")).toBe("MUD 377\nActive");
  });

  it("two empty strings produce no ops and no changes", () => {
    const { ops } = diffNoteText("", "");
    expect(ops).toEqual([]);
    expect(diffHasChanges(ops)).toBe(false);
  });
});

describe("diffNoteText — word-level (the common case)", () => {
  it("a pure addition marks only the added words, on the side that has them", () => {
    const { granularity, ops } = diffNoteText("Discharge Permit may be 18 months", "Discharge Permit may be 18 to 24 months");
    expect(granularity).toBe("word");
    expect(diffHasChanges(ops)).toBe(true);
    expect(sideText(ops, "a")).toBe("Discharge Permit may be 18 months");
    expect(sideText(ops, "b")).toBe("Discharge Permit may be 18 to 24 months");
    // Side "a" (the shorter text) carries no side-only runs — nothing of it was removed.
    expect(sideOps(ops, "a").some((op) => op.changed)).toBe(false);
    expect(sideOps(ops, "b").some((op) => op.changed)).toBe(true);
  });

  it("a pure removal marks only the removed words, on the side that has them", () => {
    const { ops } = diffNoteText("P: 713-428-2400 direct line", "P: 713-428-2400");
    expect(sideOps(ops, "a").some((op) => op.changed)).toBe(true);
    expect(sideOps(ops, "b").some((op) => op.changed)).toBe(false);
    expect(sideText(ops, "a")).toBe("P: 713-428-2400 direct line");
    expect(sideText(ops, "b")).toBe("P: 713-428-2400");
  });

  it("a word substitution marks the changed word on BOTH sides, and leaves the rest untouched", () => {
    const { ops } = diffNoteText("Load Study — 4.2 MW", "Load Study — 6.0 MW");
    expect(sideText(ops, "a")).toBe("Load Study — 4.2 MW");
    expect(sideText(ops, "b")).toBe("Load Study — 6.0 MW");
    const changedA = sideOps(ops, "a").filter((op) => op.changed).map((op) => op.text).join("");
    const changedB = sideOps(ops, "b").filter((op) => op.changed).map((op) => op.text).join("");
    expect(changedA).toContain("4.2");
    expect(changedB).toContain("6.0");
    expect(changedA).not.toContain("Load Study");
    expect(changedB).not.toContain("Load Study");
  });

  it("reorders block boundaries as real lines, not run together into one word", () => {
    const { ops } = diffNoteText("MUD 377\nActive", "MUD 377\nOn hold");
    expect(sideText(ops, "a")).toBe("MUD 377\nActive");
    expect(sideText(ops, "b")).toBe("MUD 377\nOn hold");
  });
});

describe("diffNoteText — the two large-input fallback tiers", () => {
  it("falls back to LINE granularity once either side exceeds the word cap, and both sides still read back exactly", () => {
    const linesA = Array.from({ length: 40 }, (_, i) => `line ${i} ${"word ".repeat(35)}`).join("\n");
    const linesB = linesA.replace("line 20 ", "LINE TWENTY ");
    const { granularity, ops } = diffNoteText(linesA, linesB);
    expect(granularity).toBe("line");
    expect(sideText(ops, "a")).toBe(linesA);
    expect(sideText(ops, "b")).toBe(linesB);
    expect(diffHasChanges(ops)).toBe(true);
  });

  it("falls back to the linear ANCHOR diff once line count is also past its cap, and stays correct", () => {
    // Enough LINES (not just words) to blow the line-level cap too, so both capped tiers
    // decline and the linear anchor diff is what actually runs.
    const linesOf = (marker) => Array.from({ length: 1400 }, (_, i) => `line ${i} word word`).join("\n").replace("line 700 word word", `line 700 ${marker} word`);
    const bigA = linesOf("MIDDLE-A");
    const bigB = linesOf("MIDDLE-B");
    const { granularity, ops } = diffNoteText(bigA, bigB);
    expect(granularity).toBe("anchor");
    expect(sideText(ops, "a")).toBe(bigA);
    expect(sideText(ops, "b")).toBe(bigB);
    // A single differing character between two otherwise-identical documents is found exactly
    // — the common prefix/suffix scan is precise for one localized change.
    const changedA = sideOps(ops, "a").filter((op) => op.changed).map((op) => op.text).join("");
    const changedB = sideOps(ops, "b").filter((op) => op.changed).map((op) => op.text).join("");
    expect(changedA).toBe("A");
    expect(changedB).toBe("B");
  });

  it("the anchor tier is COARSE when a document has two separate changes — everything between the first and last divergence reads as differing, not just the two changed spots", () => {
    const base = Array.from({ length: 1400 }, (_, i) => `line ${i} word word`).join("\n");
    const bigA = base.replace("line 100 word word", "line 100 FIRST-A word").replace("line 1300 word word", "line 1300 LAST-A word");
    const bigB = base.replace("line 100 word word", "line 100 FIRST-B word").replace("line 1300 word word", "line 1300 LAST-B word");
    const { granularity, ops } = diffNoteText(bigA, bigB);
    expect(granularity).toBe("anchor");
    expect(sideText(ops, "a")).toBe(bigA);
    expect(sideText(ops, "b")).toBe(bigB);
    const changedA = sideOps(ops, "a").filter((op) => op.changed).map((op) => op.text).join("");
    // The whole span from the first divergence to the last is marked as one block — including
    // the untouched "line 101" .. "line 1299" lines sitting between the two real edits. (The
    // shared "FIRST-"/"LAST-" prefixes of the two markers are correctly excluded — only the
    // single character that actually differs at each spot starts/ends the marked span.)
    expect(changedA.startsWith("A word\nline 101")).toBe(true);
    expect(changedA.endsWith("line 1300 LAST-A")).toBe(true);
    expect(changedA).toContain("line 700 word word");
  });

  it("an anchor diff with no common prefix or suffix still reconstructs both sides", () => {
    const { ops } = diffNoteText("abc".repeat(2000), "xyz".repeat(2000));
    expect(sideText(ops, "a")).toBe("abc".repeat(2000));
    expect(sideText(ops, "b")).toBe("xyz".repeat(2000));
  });
});

describe("sideOps — reconstructs the ORIGINAL text on its own side, always", () => {
  const cases = [
    ["", ""],
    ["one word", "one word"],
    ["Dustin O'Neal\nP: 713-428-2400\ndoneal@pape-dawson.com", "Dustin O'Neal\nP: 281-555-0100\ndoneal@pape-dawson.com"],
    ["a b c d e", "a c d e f"],
    ["", "brand new text that did not exist before"],
    ["text that used to be here", ""],
  ];
  for (const [a, b] of cases) {
    it(`round-trips ${JSON.stringify(a)} / ${JSON.stringify(b)}`, () => {
      const { ops } = diffNoteText(a, b);
      expect(sideText(ops, "a")).toBe(a);
      expect(sideText(ops, "b")).toBe(b);
    });
  }
});
