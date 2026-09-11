/* notesTableWidth — the pure decision behind NEW-1/NEW-2: a table that has ever been resized
 * always carries an explicit width per column, floored and defaulted, so widening one column
 * can never starve its neighbours and a manual drag can never collapse one to a sliver. */
import { describe, it, expect } from "vitest";
import {
  TABLE_COL_MIN_WIDTH, TABLE_DEFAULT_COL_WIDTH,
  isTableTouched, normalizedColumnWidths, tableTotalWidth,
} from "../src/workspaces/notes/lib/notesTableWidth.js";

describe("isTableTouched", () => {
  it("is false for a table where no column has ever been resized", () => {
    expect(isTableTouched([null, null, null])).toBe(false);
  });
  it("is true the moment any one column has an explicit width", () => {
    expect(isTableTouched([null, 250, null])).toBe(true);
  });
});

describe("normalizedColumnWidths", () => {
  it("leaves an untouched table alone — null means no change needed", () => {
    expect(normalizedColumnWidths([null, null, null])).toBeNull();
  });

  it("leaves an already-normalized touched table alone", () => {
    expect(normalizedColumnWidths([200, 150, 300])).toBeNull();
  });

  it("defaults an unset column once any sibling is explicit — never narrows the one already set", () => {
    const next = normalizedColumnWidths([250, null, null]);
    expect(next).toEqual([250, TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_COL_WIDTH]);
  });

  it("this is the owner's exact repro: two wide trailing columns starve three untouched ones", () => {
    // Before this fix, AHJ/Permit/Number rendered at ~25px (one character per line) once the
    // two trailing columns were dragged wide, because the table's own rendered width was capped
    // to the sheet and the untouched columns got whatever was left over.
    const next = normalizedColumnWidths([null, null, null, 300, 300]);
    expect(next).toEqual([
      TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_COL_WIDTH, TABLE_DEFAULT_COL_WIDTH, 300, 300,
    ]);
    // The two columns he actually dragged keep exactly the width he gave them.
    expect(next[3]).toBe(300);
    expect(next[4]).toBe(300);
  });

  it("floors an already-stored sliver column up to the readable minimum, never above it", () => {
    // The already-broken case: a table saved under the old code with a column dragged (or
    // squeezed) down to a couple of pixels.
    const next = normalizedColumnWidths([12, 400, 8]);
    expect(next).toEqual([TABLE_COL_MIN_WIDTH, 400, TABLE_COL_MIN_WIDTH]);
  });

  it("never touches a column already at or above the floor", () => {
    const next = normalizedColumnWidths([TABLE_COL_MIN_WIDTH, 5, 999]);
    expect(next[0]).toBe(TABLE_COL_MIN_WIDTH);
    expect(next[2]).toBe(999);
  });

  it("rounds a fractional stored width", () => {
    const next = normalizedColumnWidths([250.6, null]);
    expect(next[0]).toBe(251);
  });

});

describe("tableTotalWidth", () => {
  it("is 0 for a table with no columns", () => {
    expect(tableTotalWidth([])).toBe(0);
  });

  it("sums explicit widths and defaults an unset column, without needing normalization first", () => {
    expect(tableTotalWidth([300, null, 300])).toBe(300 + TABLE_DEFAULT_COL_WIDTH + 300);
  });

  it("never counts a stored sliver below the floor at face value", () => {
    expect(tableTotalWidth([10, 10])).toBe(TABLE_COL_MIN_WIDTH * 2);
  });
});
