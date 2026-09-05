import { describe, it, expect } from "vitest";
import {
  CARD_KEYS, DEFAULT_LAYOUT, normalizeLayout, availableToAdd, addCard, removeCard,
  toggleCardSize, moveCard,
} from "../src/workspaces/dashboard/lib/dashboardLayout.js";

describe("normalizeLayout", () => {
  it("passes through a valid layout unchanged (aside from size normalization)", () => {
    const raw = [{ key: "jumpBackIn", size: "wide" }, { key: "compsSummary", size: "normal" }];
    expect(normalizeLayout(raw)).toEqual(raw);
  });

  it("drops unknown keys", () => {
    const out = normalizeLayout([{ key: "notARealCard", size: "wide" }, { key: "compsSummary" }]);
    expect(out).toEqual([{ key: "compsSummary", size: "normal" }]);
  });

  it("dedupes, keeping the first occurrence", () => {
    const out = normalizeLayout([{ key: "compsSummary", size: "wide" }, { key: "compsSummary", size: "normal" }]);
    expect(out).toEqual([{ key: "compsSummary", size: "wide" }]);
  });

  it("an invalid size falls back to normal", () => {
    expect(normalizeLayout([{ key: "compsSummary", size: "huge" }])).toEqual([{ key: "compsSummary", size: "normal" }]);
  });

  it("null/undefined/non-array/empty all fall back to the full DEFAULT_LAYOUT — never a blank grid", () => {
    for (const raw of [null, undefined, "nope", 42, [], [{ key: "notReal" }]]) {
      expect(normalizeLayout(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });

  it("DEFAULT_LAYOUT covers the whole catalog — a first-run Dashboard is never empty", () => {
    expect(new Set(DEFAULT_LAYOUT.map((e) => e.key))).toEqual(new Set(CARD_KEYS));
  });
});

describe("availableToAdd / addCard / removeCard", () => {
  it("availableToAdd is the catalog minus what's already in the layout", () => {
    const layout = [{ key: "jumpBackIn", size: "normal" }];
    expect(availableToAdd(layout).sort()).toEqual(CARD_KEYS.filter((k) => k !== "jumpBackIn").sort());
  });

  it("addCard appends a catalog card not already present, defaulting to normal size", () => {
    const out = addCard([], "compsSummary");
    expect(out).toEqual([{ key: "compsSummary", size: "normal" }]);
  });

  it("addCard is a no-op for an already-present card or an unknown key", () => {
    const layout = [{ key: "compsSummary", size: "wide" }];
    expect(addCard(layout, "compsSummary")).toBe(layout);
    expect(addCard(layout, "notReal")).toBe(layout);
  });

  it("removeCard drops exactly the named card", () => {
    const layout = [{ key: "a", size: "normal" }, { key: "b", size: "normal" }];
    expect(removeCard(layout, "a")).toEqual([{ key: "b", size: "normal" }]);
  });
});

describe("toggleCardSize", () => {
  it("flips normal<->wide for the named card only", () => {
    const layout = [{ key: "a", size: "normal" }, { key: "b", size: "wide" }];
    expect(toggleCardSize(layout, "a")).toEqual([{ key: "a", size: "wide" }, { key: "b", size: "wide" }]);
    expect(toggleCardSize(layout, "b")).toEqual([{ key: "a", size: "normal" }, { key: "b", size: "normal" }]);
  });
});

describe("moveCard", () => {
  const layout = [{ key: "a" }, { key: "b" }, { key: "c" }];

  it("reorders forward and backward", () => {
    expect(moveCard(layout, 0, 2)).toEqual([{ key: "b" }, { key: "c" }, { key: "a" }]);
    expect(moveCard(layout, 2, 0)).toEqual([{ key: "c" }, { key: "a" }, { key: "b" }]);
  });

  it("is a no-op for a same-index move or an out-of-range index", () => {
    expect(moveCard(layout, 1, 1)).toBe(layout);
    expect(moveCard(layout, -1, 1)).toBe(layout);
    expect(moveCard(layout, 0, 9)).toBe(layout);
  });
});
