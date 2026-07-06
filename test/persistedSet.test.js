/* persistedSet — the shared localStorage Set-of-ids helper behind "remember which Library
 * folders are expanded" (and any future per-surface id-set persistence). Corrupt storage
 * must read as empty AND clear itself; pruning drops ids that no longer exist. */
import { describe, it, expect, beforeEach } from "vitest";
import { loadIdSet, saveIdSet, pruneSet } from "../src/shared/ui/persistedSet.js";

function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

const KEY = "planyr:test:idset";

beforeEach(() => { globalThis.localStorage = makeStore(); });

describe("persistedSet — save/load round-trip", () => {
  it("round-trips a set of ids", () => {
    saveIdSet(KEY, new Set(["a", "b", "c"]));
    expect([...loadIdSet(KEY)].sort()).toEqual(["a", "b", "c"]);
  });

  it("missing key loads as an empty set", () => {
    expect(loadIdSet(KEY).size).toBe(0);
  });

  it("an empty set round-trips (explicitly-all-collapsed is a stored state, not a miss)", () => {
    saveIdSet(KEY, new Set(["a"]));
    saveIdSet(KEY, new Set());
    expect(loadIdSet(KEY).size).toBe(0);
    expect(localStorage.getItem(KEY)).toBe("[]");
  });
});

describe("persistedSet — corrupt storage", () => {
  it("non-JSON payload reads empty and clears the key", () => {
    localStorage.setItem(KEY, "{not json");
    expect(loadIdSet(KEY).size).toBe(0);
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it("JSON that isn't an array reads empty and clears the key", () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }));
    expect(loadIdSet(KEY).size).toBe(0);
    expect(localStorage.getItem(KEY)).toBe(null);
  });

  it("non-string entries are dropped, string entries kept", () => {
    localStorage.setItem(KEY, JSON.stringify(["a", 7, null, "b"]));
    expect([...loadIdSet(KEY)].sort()).toEqual(["a", "b"]);
  });

  it("no localStorage at all (SSR/sandbox) degrades to empty + no throw", () => {
    delete globalThis.localStorage;
    expect(loadIdSet(KEY).size).toBe(0);
    expect(() => saveIdSet(KEY, new Set(["a"]))).not.toThrow();
  });
});

describe("persistedSet — pruneSet", () => {
  it("keeps only ids present in the valid set (deleted folders don't haunt the store)", () => {
    const stored = new Set(["a", "gone", "b"]);
    const valid = new Set(["a", "b", "c"]);
    expect([...pruneSet(stored, valid)].sort()).toEqual(["a", "b"]);
  });

  it("empty inputs behave", () => {
    expect(pruneSet(new Set(), new Set(["x"])).size).toBe(0);
    expect(pruneSet(new Set(["x"]), new Set()).size).toBe(0);
  });
});
