/* NEW-4 — recently-used colors: one shared most-recently-used list, seeded from the app's default
 * palette so the row is never blank, persisted across sessions. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  RECENTS_MAX, normalizeHex, mergeRecent, recentsWithSeed,
  loadRecents, saveRecents, getRecents, pushRecent, subscribeRecents, _resetRecentsCache,
} from "../src/shared/ui/colorRecents.js";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

beforeEach(() => { store.clear(); _resetRecentsCache(); });

describe("normalizeHex", () => {
  it("accepts #rrggbb and lowercases it", () => expect(normalizeHex("#AABBCC")).toBe("#aabbcc"));
  it("expands #rgb shorthand", () => expect(normalizeHex("#f0a")).toBe("#ff00aa"));
  it("rejects anything an <input type=color> can't round-trip", () => {
    ["red", "rgb(1,2,3)", "", null, undefined, 12, "#12345"].forEach((v) => expect(normalizeHex(v)).toBe(null));
  });
});

describe("mergeRecent — most-recently-used order", () => {
  it("puts the newest color first", () => {
    expect(mergeRecent(["#111111"], "#222222")).toEqual(["#222222", "#111111"]);
  });
  it("re-using a color MOVES it up instead of duplicating it (the distinct-colors rule)", () => {
    expect(mergeRecent(["#111111", "#222222", "#333333"], "#333333"))
      .toEqual(["#333333", "#111111", "#222222"]);
  });
  it("caps the list", () => {
    let list = [];
    for (let i = 0; i < 30; i++) list = mergeRecent(list, `#0000${String(i % 100).padStart(2, "0")}`);
    expect(list.length).toBe(RECENTS_MAX);
  });
  it("an unparseable color is ignored, not stored", () => {
    expect(mergeRecent(["#111111"], "chartreuse")).toEqual(["#111111"]);
  });
  it("normalizes existing entries so #ABC and #aabbcc never both sit in the row", () => {
    expect(mergeRecent(["#ABC"], "#aabbcc")).toEqual(["#aabbcc"]);
  });
});

describe("recentsWithSeed — never blank on first run", () => {
  it("fills an empty list from the default palette", () => {
    expect(recentsWithSeed([], ["#111111", "#222222"], 4)).toEqual(["#111111", "#222222"]);
  });
  it("real recents come FIRST, palette pads the tail", () => {
    expect(recentsWithSeed(["#999999"], ["#111111", "#222222"], 3)).toEqual(["#999999", "#111111", "#222222"]);
  });
  it("a seed color already used isn't shown twice", () => {
    expect(recentsWithSeed(["#111111"], ["#111111", "#222222"], 4)).toEqual(["#111111", "#222222"]);
  });
  it("respects the cap", () => {
    expect(recentsWithSeed(["#111111"], ["#222222", "#333333", "#444444"], 2)).toEqual(["#111111", "#222222"]);
  });
});

describe("persistence", () => {
  it("round-trips through storage so a color survives a reload", () => {
    saveRecents(["#123456", "#abcdef"]);
    expect(loadRecents()).toEqual(["#123456", "#abcdef"]);
  });
  it("a corrupt entry reads as empty — never a crash on boot", () => {
    store.set("planyr:colorRecents:v1", "{not json");
    expect(loadRecents()).toEqual([]);
  });
  it("a storage write failure never breaks the color change itself", () => {
    const spy = vi.spyOn(globalThis.localStorage, "setItem").mockImplementation(() => { throw new Error("QuotaExceeded"); });
    expect(() => pushRecent("#123456")).not.toThrow();
    expect(getRecents()[0]).toBe("#123456"); // still applied in-session
    spy.mockRestore();
  });
});

describe("pushRecent — the live shared list", () => {
  it("records a color and notifies every open picker", () => {
    const seen = [];
    const off = subscribeRecents((l) => seen.push(l));
    pushRecent("#ff0000");
    pushRecent("#00ff00");
    off();
    pushRecent("#0000ff");
    expect(seen.length).toBe(2);                    // no notification after unsubscribe
    expect(getRecents()).toEqual(["#0000ff", "#00ff00", "#ff0000"]);
  });
  it("is a no-op for an unparseable value (no phantom row entry)", () => {
    pushRecent("#123456");
    const before = getRecents();
    expect(pushRecent("not-a-color")).toBe(before);
  });
  it("the list is SHARED — a color recorded from one control is available to the next", () => {
    pushRecent("#c2410c");   // e.g. picked on a parcel outline
    expect(getRecents()).toContain("#c2410c"); // …now one click away on a markup
  });
});
