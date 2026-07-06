import { describe, it, expect } from "vitest";
import { nextZ, sortByZ, needsZ, normalizeZ, ensureZ, Z_GAP } from "../src/workspaces/site-planner/lib/zOrder.js";

// B671 — explicit z_index utilities. z is the within-type-layer tiebreak; these keep a collection
// deterministically ordered so array-position-derived features (Building N numbering, the byZ
// render tiebreak) stay stable after the array-order dependence is removed.

describe("nextZ", () => {
  it("returns 0 for an empty collection", () => {
    expect(nextZ([])).toBe(0);
    expect(nextZ(null)).toBe(0);
  });
  it("returns max z + Z_GAP so a new element lands on top", () => {
    expect(nextZ([{ id: "a", z: 0 }, { id: "b", z: 2048 }, { id: "c", z: 1024 }])).toBe(2048 + Z_GAP);
  });
  it("ignores non-numeric z", () => {
    expect(nextZ([{ id: "a" }, { id: "b", z: 512 }])).toBe(512 + Z_GAP);
  });
});

describe("sortByZ", () => {
  it("orders by z then id, without mutating the input", () => {
    const input = [{ id: "b", z: 1024 }, { id: "a", z: 0 }, { id: "c", z: 1024 }];
    const out = sortByZ(input);
    expect(out.map((e) => e.id)).toEqual(["a", "b", "c"]); // z tie (1024) broken by id
    expect(input.map((e) => e.id)).toEqual(["b", "a", "c"]); // input untouched
  });
  it("treats missing z as 0", () => {
    expect(sortByZ([{ id: "x", z: 5 }, { id: "y" }]).map((e) => e.id)).toEqual(["y", "x"]);
  });
});

describe("needsZ", () => {
  it("is false when every element has a distinct numeric z", () => {
    expect(needsZ([{ id: "a", z: 0 }, { id: "b", z: 1024 }])).toBe(false);
  });
  it("is true when any z is missing", () => {
    expect(needsZ([{ id: "a", z: 0 }, { id: "b" }])).toBe(true);
  });
  it("is true when two elements share a z (ambiguous tie)", () => {
    expect(needsZ([{ id: "a", z: 512 }, { id: "b", z: 512 }])).toBe(true);
  });
});

describe("normalizeZ", () => {
  it("reassigns z = index * Z_GAP on new objects, never mutating inputs", () => {
    const input = [{ id: "a", z: 99 }, { id: "b" }, { id: "c", z: 5 }];
    const out = normalizeZ(input);
    expect(out.map((e) => e.z)).toEqual([0, Z_GAP, 2 * Z_GAP]);
    expect(input[0].z).toBe(99); // untouched
    expect(out[0]).not.toBe(input[0]); // new object
  });
});

describe("ensureZ", () => {
  it("returns the SAME reference when every z is already distinct (cheap no-op)", () => {
    const list = [{ id: "a", z: 0 }, { id: "b", z: 1024 }];
    expect(ensureZ(list)).toBe(list);
  });
  it("assigns gapped z in array order for a fresh collection with no z (mirrors the SQL backfill)", () => {
    const out = ensureZ([{ id: "a" }, { id: "b" }, { id: "c" }]);
    expect(out.map((e) => e.z)).toEqual([0, Z_GAP, 2 * Z_GAP]);
  });
  it("keeps the result z-sorted so array position == z order", () => {
    const out = ensureZ([{ id: "b", z: 2048 }, { id: "a", z: 512 }, { id: "dup", z: 512 }]);
    // duplicate z forces a renormalize: sort by (z,id) → a, dup, b → gapped
    expect(out.map((e) => e.id)).toEqual(["a", "dup", "b"]);
    expect(out.map((e) => e.z)).toEqual([0, Z_GAP, 2 * Z_GAP]);
  });
  it("is idempotent after the first normalization", () => {
    const once = ensureZ([{ id: "a" }, { id: "b" }]);
    expect(ensureZ(once)).toBe(once);
  });
});
