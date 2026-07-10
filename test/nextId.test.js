/* next-id scanner (B755). Guards the deterministic "next free B#/V#" helper that replaces reading the
 * 464 KB BACKLOG.md + 1.4 MB BACKLOG-DONE.md into model context just to find the max. The parse must
 * (a) count the two authoritative id forms — `### B123` headings and `**B123**` bold mints, incl.
 * ranges — and (b) be IMMUNE to a stray inline prose mention inflating the max (the one dangerous
 * error is UNDER-counting, i.e. reusing a live number; over-counting from a typo is what we prevent). */
import { describe, it, expect } from "vitest";
import { maxId, computeNextIds } from "../scripts/next-id.mjs";

describe("maxId — parses only the authoritative id forms", () => {
  it("reads a plain `### B123` heading", () => {
    expect(maxId("### B123 — a thing `[mod]` (bug)", "B")).toBe(123);
  });

  it("reads a `**B123**` bold mint", () => {
    expect(maxId("... minted **B412** = highest + 1 ...", "B")).toBe(412);
  });

  it("captures the END of a heading range (`### B300–B302`)", () => {
    expect(maxId("### B300–B302 — a multi-mint", "B")).toBe(302);
  });

  it("captures the END of a bold range in either dash style", () => {
    expect(maxId("minted **B378–B379**", "B")).toBe(379); // en-dash
    expect(maxId("minted **B378-B379**", "B")).toBe(379); // hyphen
    expect(maxId("minted **B378—B379**", "B")).toBe(379); // em-dash
    expect(maxId("minted **B300–302**", "B")).toBe(302); // range end without repeated letter
  });

  it("takes the MAX across mixed forms", () => {
    const text = "### B100 — a\n### B250 — b\n... see **B090** ...\n### B222 — c";
    expect(maxId(text, "B")).toBe(250);
  });

  it("is IMMUNE to a stray inline prose mention (no heading, no bold)", () => {
    // A bare "B99999" in prose must NOT inflate the max — it is not an assigned id.
    const text = "### B120 — real\nsome note about B99999 in passing, and box B2B sizing";
    expect(maxId(text, "B")).toBe(120);
  });

  it("handles the V family the same way", () => {
    expect(maxId("### V267 — live check\n**V189** archived", "V")).toBe(267);
  });

  it("returns 0 when nothing matches", () => {
    expect(maxId("no ids here at all", "B")).toBe(0);
    expect(maxId("", "V")).toBe(0);
  });

  it("does not confuse the B family with the V family", () => {
    expect(maxId("### V900 — a", "B")).toBe(0);
    expect(maxId("### B900 — a", "V")).toBe(0);
  });
});

describe("computeNextIds — real repo files", () => {
  it("returns nextB = maxB + 1 and nextV = maxV + 1", () => {
    const { maxB, maxV, nextB, nextV } = computeNextIds();
    expect(nextB).toBe(maxB + 1);
    expect(nextV).toBe(maxV + 1);
  });

  it("finds real, plausibly-large maxes (the archive is scanned, not just the open file)", () => {
    const { maxB, maxV } = computeNextIds();
    expect(maxB).toBeGreaterThan(700); // sanity floor as of B755
    expect(maxV).toBeGreaterThan(200);
  });
});
