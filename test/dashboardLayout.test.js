import { describe, it, expect } from "vitest";
import {
  CARD_KEYS, CARD_DEFS, GRID_COLS, DEFAULT_LAYOUT, DEFAULT_ORDER, normalizeLayout, resetLayout,
  availableToAdd, addCard, removeCard, applyGridChange, narrowOrder, toRglItem,
  newCatalogCards, appendNewCatalogCards, normalizeDismissed, dismissCard, undismissCard,
  JUMP_BACK_IN_COUNT_DEFAULT, JUMP_BACK_IN_COUNT_MIN, JUMP_BACK_IN_COUNT_MAX, normalizeJumpBackInCount,
} from "../src/workspaces/dashboard/lib/dashboardLayout.js";

describe("DEFAULT_LAYOUT", () => {
  it("covers the whole catalog — a first-run Dashboard is never empty", () => {
    expect(new Set(DEFAULT_LAYOUT.map((e) => e.key))).toEqual(new Set(CARD_KEYS));
  });

  it("every entry sits within the grid (x + w <= GRID_COLS) and respects its own minimums", () => {
    for (const e of DEFAULT_LAYOUT) {
      const def = CARD_DEFS[e.key];
      expect(e.x + e.w).toBeLessThanOrEqual(GRID_COLS);
      expect(e.w).toBeGreaterThanOrEqual(def.minW);
      expect(e.h).toBeGreaterThanOrEqual(def.minH);
    }
  });

  it("no two entries overlap (row-major pack)", () => {
    // Two entries overlap iff their x-ranges AND y-ranges both intersect.
    for (let i = 0; i < DEFAULT_LAYOUT.length; i++) {
      for (let j = i + 1; j < DEFAULT_LAYOUT.length; j++) {
        const a = DEFAULT_LAYOUT[i], b = DEFAULT_LAYOUT[j];
        const xOverlap = a.x < b.x + b.w && b.x < a.x + a.w;
        const yOverlap = a.y < b.y + b.h && b.y < a.y + a.h;
        expect(xOverlap && yOverlap).toBe(false);
      }
    }
  });
});

describe("resetLayout", () => {
  it("returns a fresh copy of DEFAULT_LAYOUT — mutating it never touches the shared default", () => {
    const out = resetLayout();
    expect(out).toEqual(DEFAULT_LAYOUT);
    out[0].x = 999;
    expect(DEFAULT_LAYOUT[0].x).not.toBe(999);
  });
});

describe("normalizeLayout — new (grid) shape", () => {
  it("passes through a valid grid layout unchanged", () => {
    const raw = [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }, { key: "compsSummary", x: 8, y: 0, w: 4, h: 8 }];
    expect(normalizeLayout(raw)).toEqual(raw);
  });

  it("drops unknown keys", () => {
    const out = normalizeLayout([{ key: "notARealCard", x: 0, y: 0, w: 4, h: 4 }, { key: "compsSummary", x: 0, y: 0, w: 4, h: 8 }]);
    expect(out).toEqual([{ key: "compsSummary", x: 0, y: 0, w: 4, h: 8 }]);
  });

  it("dedupes, keeping the first occurrence", () => {
    const out = normalizeLayout([
      { key: "compsSummary", x: 0, y: 0, w: 4, h: 8 },
      { key: "compsSummary", x: 4, y: 4, w: 8, h: 9 },
    ]);
    expect(out).toEqual([{ key: "compsSummary", x: 0, y: 0, w: 4, h: 8 }]);
  });

  it("clamps w/h up to the card's own minimums, and x so the card never spills past GRID_COLS", () => {
    const out = normalizeLayout([{ key: "compsSummary", x: 11, y: 0, w: 1, h: 1 }]);
    const def = CARD_DEFS.compsSummary;
    expect(out[0].w).toBe(def.minW);
    expect(out[0].h).toBe(def.minH);
    expect(out[0].x).toBe(GRID_COLS - def.minW);
  });

  it("drops a malformed grid-shaped entry missing x/y/w/h, silently, rather than throwing", () => {
    const out = normalizeLayout([{ key: "compsSummary", x: 0, y: 0, w: 4, h: 8 }, { key: "goingQuiet", x: 0 }]);
    expect(out).toEqual([{ key: "compsSummary", x: 0, y: 0, w: 4, h: 8 }]);
  });

  it("null/undefined/non-array/empty/all-invalid all fall back to DEFAULT_LAYOUT — never a blank grid", () => {
    for (const raw of [null, undefined, "nope", 42, [], [{ key: "notReal" }]]) {
      expect(normalizeLayout(raw)).toEqual(DEFAULT_LAYOUT);
    }
  });
});

describe("normalizeLayout — migrates the pre-grid {key,size} shape (B1213313's original release)", () => {
  it("an old-format save (no x/y/w/h anywhere) is re-packed, preserving the saved order", () => {
    const legacy = [{ key: "goingQuiet", size: "normal" }, { key: "jumpBackIn", size: "wide" }];
    const migrated = normalizeLayout(legacy);
    expect(migrated.map((e) => e.key)).toEqual(["goingQuiet", "jumpBackIn"]);
    // Every migrated entry is a valid, in-bounds grid placement at its own card's default size.
    for (const e of migrated) {
      const def = CARD_DEFS[e.key];
      expect(e.w).toBe(def.defaultW);
      expect(e.h).toBe(def.defaultH);
      expect(e.x + e.w).toBeLessThanOrEqual(GRID_COLS);
    }
  });

  it("drops unknown keys and dedupes during migration too", () => {
    const legacy = [{ key: "notReal", size: "wide" }, { key: "compsSummary", size: "normal" }, { key: "compsSummary", size: "wide" }];
    expect(normalizeLayout(legacy).map((e) => e.key)).toEqual(["compsSummary"]);
  });
});

describe("availableToAdd / addCard / removeCard", () => {
  it("availableToAdd is the catalog minus what's already in the layout", () => {
    const layout = [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }];
    expect(availableToAdd(layout).sort()).toEqual(CARD_KEYS.filter((k) => k !== "jumpBackIn").sort());
  });

  it("addCard appends a catalog card at its own default size, below whatever is already placed", () => {
    const layout = [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }];
    const out = addCard(layout, "compsSummary");
    const def = CARD_DEFS.compsSummary;
    expect(out).toEqual([...layout, { key: "compsSummary", x: 0, y: 4, w: def.defaultW, h: def.defaultH }]);
  });

  it("addCard is a no-op for an already-present card or an unknown key", () => {
    const layout = [{ key: "compsSummary", x: 0, y: 0, w: 4, h: 4 }];
    expect(addCard(layout, "compsSummary")).toBe(layout);
    expect(addCard(layout, "notReal")).toBe(layout);
  });

  it("removeCard drops exactly the named card, leaving the rest untouched", () => {
    const layout = [{ key: "a", x: 0, y: 0, w: 4, h: 4 }, { key: "b", x: 4, y: 0, w: 4, h: 4 }];
    expect(removeCard(layout, "a")).toEqual([{ key: "b", x: 4, y: 0, w: 4, h: 4 }]);
  });

  it("a removed card round-trips back through addCard (never destroyed, just re-added at a default size)", () => {
    const layout = addCard([], "goingQuiet");
    const removed = removeCard(layout, "goingQuiet");
    expect(removed).toEqual([]);
    expect(availableToAdd(removed)).toContain("goingQuiet");
  });
});

describe("applyGridChange — folding react-grid-layout's onLayoutChange payload back in", () => {
  const layout = [{ key: "a", x: 0, y: 0, w: 4, h: 4 }, { key: "b", x: 4, y: 0, w: 4, h: 4 }];

  it("updates x/y/w/h for items react-grid-layout named, by `i` matching `key`", () => {
    const rglItems = [{ i: "a", x: 4, y: 4, w: 6, h: 5 }, { i: "b", x: 0, y: 0, w: 4, h: 4 }];
    expect(applyGridChange(layout, rglItems)).toEqual([
      { key: "a", x: 4, y: 4, w: 6, h: 5 },
      { key: "b", x: 0, y: 0, w: 4, h: 4 },
    ]);
  });

  it("leaves an entry untouched if react-grid-layout didn't mention it, or sent a malformed item", () => {
    expect(applyGridChange(layout, [{ i: "a", x: 1, y: 1, w: 4, h: 4 }])).toEqual([
      { key: "a", x: 1, y: 1, w: 4, h: 4 },
      { key: "b", x: 4, y: 0, w: 4, h: 4 },
    ]);
    expect(applyGridChange(layout, [{ i: "a", x: "nope" }])).toEqual(layout);
  });

  it("empty/missing rglItems is a no-op", () => {
    expect(applyGridChange(layout, [])).toEqual(layout);
    expect(applyGridChange(layout, null)).toEqual(layout);
  });
});

describe("narrowOrder — the single-column stack's reading order", () => {
  it("sorts top-to-bottom, then left-to-right — never by array storage order", () => {
    const layout = [
      { key: "c", x: 4, y: 4, w: 4, h: 4 },
      { key: "a", x: 4, y: 0, w: 4, h: 4 },
      { key: "b", x: 0, y: 0, w: 4, h: 4 },
    ];
    expect(narrowOrder(layout).map((e) => e.key)).toEqual(["b", "a", "c"]);
  });

  it("does not mutate its input", () => {
    const layout = [{ key: "a", x: 4, y: 0, w: 4, h: 4 }, { key: "b", x: 0, y: 0, w: 4, h: 4 }];
    const copy = layout.map((e) => ({ ...e }));
    narrowOrder(layout);
    expect(layout).toEqual(copy);
  });
});

describe("toRglItem", () => {
  it("carries x/y/w/h through and injects the card's own minW/minH, keyed as `i`", () => {
    const entry = { key: "needsAttention", x: 0, y: 0, w: 8, h: 9 };
    expect(toRglItem(entry)).toEqual({
      i: "needsAttention", x: 0, y: 0, w: 8, h: 9,
      minW: CARD_DEFS.needsAttention.minW, minH: CARD_DEFS.needsAttention.minH,
    });
  });
});

describe("B1422496 — a card added to the catalog after a layout was saved reaches it automatically", () => {
  it("newCatalogCards/appendNewCatalogCards exist and reconcile a legacy saved layout without disturbing it", () => {
    // Simulate a layout saved back when the catalog didn't yet include one of today's cards
    // (Michael's real report: needsAttention/pursuitsTable/recentPlans/sinceLastHere shipped and
    // never reached his saved six-card layout). `dismissed` models "every other catalog card has
    // already been decided" so only the one simulated-new card is reachable.
    const saved = [
      { key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 },
      { key: "goingQuiet", x: 8, y: 0, w: 4, h: 6 },
    ];
    const before = saved.map((e) => ({ ...e }));
    const dismissed = CARD_KEYS.filter((k) => k !== "compsSummary" && !saved.some((e) => e.key === k));

    const reachable = newCatalogCards(saved, dismissed);
    expect(reachable).toEqual(["compsSummary"]);

    const reconciled = appendNewCatalogCards(saved, dismissed);
    // Existing cards' own position/size is untouched — same order, same x/y/w/h.
    expect(reconciled.slice(0, saved.length)).toEqual(before);
    // The new card reached the layout without the user opening Customize.
    expect(reconciled.some((e) => e.key === "compsSummary")).toBe(true);
  });

  it("a card the user deliberately removed does not come back, even though it's just as absent", () => {
    const layout = [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }];
    const dismissed = CARD_KEYS.filter((k) => k !== "jumpBackIn");
    expect(newCatalogCards(layout, dismissed)).toEqual([]);
    expect(appendNewCatalogCards(layout, dismissed)).toBe(layout);
  });

  it("appends every newly-reachable card, in DEFAULT_ORDER, when more than one is new at once", () => {
    const layout = [{ key: "compsSummary", x: 0, y: 0, w: 4, h: 8 }];
    // Nothing else has been decided — a brand-new-to-this-mechanism account with a real save.
    expect(newCatalogCards(layout, [])).toEqual(DEFAULT_ORDER.filter((k) => k !== "compsSummary"));
  });

  describe("normalizeDismissed — bootstrap for accounts saved before this reconciliation existed", () => {
    it("undefined (never recorded) defaults to every catalog card currently missing — a legacy layout is never retroactively changed", () => {
      const layout = [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }];
      const dismissed = normalizeDismissed(undefined, layout);
      expect(new Set(dismissed)).toEqual(new Set(CARD_KEYS.filter((k) => k !== "jumpBackIn")));
      // Reconciling against that bootstrap set is a no-op, by construction.
      expect(appendNewCatalogCards(layout, dismissed)).toBe(layout);
    });

    it("null is treated the same as undefined", () => {
      const layout = [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }];
      expect(new Set(normalizeDismissed(null, layout))).toEqual(new Set(CARD_KEYS.filter((k) => k !== "jumpBackIn")));
    });

    it("an explicitly-saved empty list means nothing has been dismissed yet — any missing catalog card IS new", () => {
      expect(normalizeDismissed([], [{ key: "jumpBackIn", x: 0, y: 0, w: 8, h: 4 }])).toEqual([]);
    });

    it("drops unknown/malformed entries and dedupes an explicitly-saved list", () => {
      expect(normalizeDismissed(["compsSummary", "notReal", "compsSummary", 5, null], [])).toEqual(["compsSummary"]);
    });
  });

  describe("dismissCard / undismissCard", () => {
    it("dismissCard records a key once, idempotently", () => {
      expect(dismissCard([], "compsSummary")).toEqual(["compsSummary"]);
      expect(dismissCard(["compsSummary"], "compsSummary")).toEqual(["compsSummary"]);
      expect(dismissCard(["goingQuiet"], "compsSummary")).toEqual(["goingQuiet", "compsSummary"]);
    });

    it("undismissCard clears a key, leaving the rest untouched", () => {
      expect(undismissCard(["goingQuiet", "compsSummary"], "compsSummary")).toEqual(["goingQuiet"]);
      expect(undismissCard(["goingQuiet"], "notThere")).toEqual(["goingQuiet"]);
    });

    it("round-trips through the picker: remove then re-add clears the dismissal, so a later removal is a fresh decision", () => {
      let dismissed = [];
      dismissed = dismissCard(dismissed, "compsSummary");
      expect(newCatalogCards([], dismissed)).not.toContain("compsSummary");
      dismissed = undismissCard(dismissed, "compsSummary");
      expect(newCatalogCards([], dismissed)).toContain("compsSummary");
    });
  });
});

describe("normalizeJumpBackInCount (NEW-1, 2026-09-17)", () => {
  it("a user who has never touched the setting gets the default, not zero or empty", () => {
    expect(normalizeJumpBackInCount(undefined)).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
    expect(normalizeJumpBackInCount(null)).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
  });

  it("a non-finite/garbage value falls back to the default", () => {
    expect(normalizeJumpBackInCount("nope")).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
    expect(normalizeJumpBackInCount(NaN)).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
    expect(normalizeJumpBackInCount({})).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
  });

  it("clamps below MIN up to MIN, and above MAX down to MAX — never zero, never unbounded", () => {
    expect(normalizeJumpBackInCount(0)).toBe(JUMP_BACK_IN_COUNT_MIN);
    expect(normalizeJumpBackInCount(-5)).toBe(JUMP_BACK_IN_COUNT_MIN);
    expect(normalizeJumpBackInCount(999)).toBe(JUMP_BACK_IN_COUNT_MAX);
  });

  it("rounds a fractional value and passes an in-range integer through unchanged", () => {
    expect(normalizeJumpBackInCount(4.6)).toBe(5);
    expect(normalizeJumpBackInCount(2)).toBe(2);
  });
});
