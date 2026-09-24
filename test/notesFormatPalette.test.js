/* THE SIZE PRESET LADDER AND ITS FLOOR/CEILING (NEW-4, toolbar redesign, 2026-09-24) — the pure
 * half. The toolbar redesign dropped the old leading `null`/"Default" row and the floor of 9,
 * replaced by a typed stepper that accepts any integer in [SIZE_MIN, SIZE_MAX] beside a plain
 * numeric preset list whose default is 11, not 15.
 */
import { describe, expect, it } from "vitest";

import { SIZES, DEFAULT_SIZE, SIZE_MIN, SIZE_MAX } from "../src/workspaces/notes/lib/notesFormatPalette.js";

describe("SIZES — the preset ladder", () => {
  it("is the exact 13-value list the redesign specified, no leading null/Default row", () => {
    expect(SIZES).toEqual([8, 9, 10, 11, 12, 14, 16, 18, 24, 30, 36, 48, 72]);
  });

  it("every entry is a real number — never the old null/'Default' placeholder", () => {
    for (const s of SIZES) expect(typeof s).toBe("number");
  });

  it("is strictly increasing, so a caller can render it as-is without sorting", () => {
    for (let i = 1; i < SIZES.length; i++) expect(SIZES[i]).toBeGreaterThan(SIZES[i - 1]);
  });

  it("carries the Default size (11) as a real member of the list", () => {
    expect(SIZES).toContain(DEFAULT_SIZE);
  });
});

describe("DEFAULT_SIZE — the body default", () => {
  it("is 11, not the old 15", () => {
    expect(DEFAULT_SIZE).toBe(11);
  });
});

describe("SIZE_MIN / SIZE_MAX — the typed stepper's floor and ceiling", () => {
  it("removes the old floor of 9 — 4 is now reachable", () => {
    expect(SIZE_MIN).toBe(4);
    expect(SIZE_MIN).toBeLessThan(9);
  });

  it("accepts a large size before refusing — 400 is the stated ceiling", () => {
    expect(SIZE_MAX).toBe(400);
  });

  it("every preset falls inside the typed range", () => {
    for (const s of SIZES) {
      expect(s).toBeGreaterThanOrEqual(SIZE_MIN);
      expect(s).toBeLessThanOrEqual(SIZE_MAX);
    }
  });
});
