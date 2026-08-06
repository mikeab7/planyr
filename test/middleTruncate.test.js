import { describe, it, expect } from "vitest";
import { splitLabel, middleEllipsis } from "../src/shared/files/middleTruncate.js";

/* NEW-4 — the owner's report, verbatim: the Stitch sheet list showed 32 rows ALL reading the
 * identical string "2024-10-08 - JACI...". The page number is the only distinguishing part and it
 * is exactly what gets cut. These assert the OUTCOME that matters — that 32 real names produce 32
 * DISTINGUISHABLE rendered labels — not that a helper was called. */
const SET = Array.from({ length: 32 }, (_, i) => `2024-10-08 - JACINTOPORT - MEP - ISSUE FOR CONSTRUCTION - p${i + 1}`);

describe("splitLabel — the distinguishing tail survives", () => {
  it("keeps the page number out of the ellipsized head", () => {
    const { head, tail } = splitLabel(SET[16]); // "- p17"
    expect(tail).toBe(" - p17");
    expect(head).toBe("2024-10-08 - JACINTOPORT - MEP - ISSUE FOR CONSTRUCTION");
  });

  it("never invents or drops characters — head + tail is exactly the input", () => {
    for (const name of SET) {
      const { head, tail } = splitLabel(name);
      expect(head + tail).toBe(name);
    }
  });

  it("all 32 sheets of the owner's set stay TELLABLE APART once the head is cut to nothing", () => {
    // The worst case a real rail can impose: the head box collapses and only the pinned tail is
    // painted. Before this fix every row rendered the identical "2024-10-08 - JACI…".
    const tails = SET.map((n) => splitLabel(n).tail);
    expect(new Set(tails).size).toBe(32);
    // And the tails are the part a human navigates by.
    expect(tails[0]).toBe(" - p1");
    expect(tails[31]).toBe(" - p32");
  });

  it("prefers an explicit delimiter over a bare word break, so the tail reads as a token", () => {
    expect(splitLabel("Grand Port Architectural · A227").tail).toBe(" · A227");
    expect(splitLabel("SITE PLAN OVERALL ROOF PLAN").tail).toBe(" ROOF PLAN");
  });

  it("keeps the last characters even when there is no usable boundary at all", () => {
    const s = "A".repeat(40) + "ZQ7";
    const { head, tail } = splitLabel(s, { maxTail: 6 });
    expect(tail).toBe("AAAZQ7");
    expect(head + tail).toBe(s);
  });

  it("leaves a short label whole — nothing to pin, nothing to cut", () => {
    expect(splitLabel("A101")).toEqual({ head: "A101", tail: "" });
    expect(splitLabel("")).toEqual({ head: "", tail: "" });
    expect(splitLabel(null)).toEqual({ head: "", tail: "" });
    expect(splitLabel(undefined)).toEqual({ head: "", tail: "" });
  });

  it("never pins a tail that is only punctuation, and never leaves an empty head", () => {
    // A trailing delimiter must not become the pinned tail — that would throw away every word on
    // the row to keep a dash. Empty tail is the right answer here, not " - ".
    const trailing = splitLabel("SHEET LIST - ");
    expect(trailing.tail === "" || /[^\s·—–_/\\-]/.test(trailing.tail)).toBe(true);
    const leading = splitLabel(" - p3");
    expect(leading.head.length > 0 || leading.tail === "").toBe(true);
  });

  it("respects the caller's tail budget", () => {
    // " - ISSUE FOR CONSTRUCTION" is 25 chars — too long for a 14-char budget, so the split falls
    // through to a later (shorter) boundary rather than pinning a quarter of the row.
    const { tail } = splitLabel("PLAN SET - ISSUE FOR CONSTRUCTION", { maxTail: 14 });
    expect(tail.length).toBeLessThanOrEqual(14);
  });
});

describe("middleEllipsis — the non-DOM rendering of the same split", () => {
  it("produces the label the owner asked for", () => {
    const out = middleEllipsis(SET[16], 26);
    expect(out).toBe("2024-10-08 - JACINT… - p17");
    expect(out.length).toBe(26);           // fits the budget exactly
    expect(out.endsWith(" - p17")).toBe(true); // and the identity is at the end, where it belongs
  });
  it("collapses 32 identical-prefix names to 32 distinct strings", () => {
    expect(new Set(SET.map((n) => middleEllipsis(n, 26))).size).toBe(32);
  });
  it("leaves anything that already fits completely alone", () => {
    expect(middleEllipsis("A101 - ROOF", 40)).toBe("A101 - ROOF");
  });
});
