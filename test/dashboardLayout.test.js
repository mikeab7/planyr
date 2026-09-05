import { describe, it, expect } from "vitest";
import {
  moveCardToIndex, moveCardBy, cycleCardWidth, setCardWidth, removeCard, addCard, availableCardIds,
  DEFAULT_DASHBOARD_LAYOUT, DASHBOARD_CARD_IDS,
} from "../src/workspaces/dashboard/lib/dashboardLayout.js";

const L = (ids) => ids.map((id) => ({ id, width: "md" }));

describe("dashboardLayout — moveCardToIndex (the ONE reorder call, shared by drag and keyboard)", () => {
  it("moves a card to a later index", () => {
    const out = moveCardToIndex(L(["a", "b", "c"]), "a", 2);
    expect(out.map((c) => c.id)).toEqual(["b", "c", "a"]);
  });
  it("moves a card to an earlier index", () => {
    const out = moveCardToIndex(L(["a", "b", "c"]), "c", 0);
    expect(out.map((c) => c.id)).toEqual(["c", "a", "b"]);
  });
  it("clamps an out-of-range target instead of throwing", () => {
    expect(moveCardToIndex(L(["a", "b"]), "a", 99).map((c) => c.id)).toEqual(["b", "a"]);
    expect(moveCardToIndex(L(["a", "b"]), "b", -5).map((c) => c.id)).toEqual(["b", "a"]);
  });
  it("is an identity no-op for an absent id or an already-correct index", () => {
    const layout = L(["a", "b"]);
    expect(moveCardToIndex(layout, "zzz", 0)).toBe(layout);
    expect(moveCardToIndex(layout, "a", 0)).toBe(layout);
  });
});

describe("dashboardLayout — moveCardBy (Move-left/Move-right buttons)", () => {
  it("moves one step left and one step right, using the identical reorder as drag", () => {
    expect(moveCardBy(L(["a", "b", "c"]), "b", -1).map((c) => c.id)).toEqual(["b", "a", "c"]);
    expect(moveCardBy(L(["a", "b", "c"]), "b", 1).map((c) => c.id)).toEqual(["a", "c", "b"]);
  });
  it("is a no-op at either edge", () => {
    const layout = L(["a", "b", "c"]);
    expect(moveCardBy(layout, "a", -1)).toBe(layout);
    expect(moveCardBy(layout, "c", 1)).toBe(layout);
  });
});

describe("dashboardLayout — width controls", () => {
  it("cycles sm -> md -> lg -> sm", () => {
    let layout = [{ id: "a", width: "sm" }];
    layout = cycleCardWidth(layout, "a"); expect(layout[0].width).toBe("md");
    layout = cycleCardWidth(layout, "a"); expect(layout[0].width).toBe("lg");
    layout = cycleCardWidth(layout, "a"); expect(layout[0].width).toBe("sm");
  });
  it("setCardWidth sets directly and rejects an unknown width", () => {
    const layout = [{ id: "a", width: "md" }];
    expect(setCardWidth(layout, "a", "lg")[0].width).toBe("lg");
    expect(setCardWidth(layout, "a", "huge")).toBe(layout);
  });
});

describe("dashboardLayout — removeCard: the last-card rule", () => {
  it("removes a card when more than one remains", () => {
    expect(removeCard(L(["a", "b"]), "a").map((c) => c.id)).toEqual(["b"]);
  });
  it("refuses to remove the ONE remaining card — never an empty board", () => {
    const layout = L(["a"]);
    expect(removeCard(layout, "a")).toBe(layout);
    expect(removeCard(layout, "a").length).toBe(1);
  });
});

describe("dashboardLayout — addCard / availableCardIds (the Add-card tray)", () => {
  it("adds a catalog card not already present, appended at md width", () => {
    const out = addCard(L(["jumpBackIn"]), "goingQuiet");
    expect(out).toEqual([{ id: "jumpBackIn", width: "md" }, { id: "goingQuiet", width: "md" }]);
  });
  it("is a no-op for an unknown id or one already on the board", () => {
    const layout = L(["jumpBackIn"]);
    expect(addCard(layout, "not-a-real-card")).toBe(layout);
    expect(addCard(layout, "jumpBackIn")).toBe(layout);
  });
  it("availableCardIds is the catalog minus what's on the board", () => {
    const layout = L(["jumpBackIn", "goingQuiet"]);
    const avail = availableCardIds(layout);
    expect(avail).not.toContain("jumpBackIn");
    expect(avail).not.toContain("goingQuiet");
    expect(avail.length).toBe(DASHBOARD_CARD_IDS.length - 2);
  });
});

describe("dashboardLayout — default board", () => {
  it("the default layout carries every catalog card", () => {
    expect(DEFAULT_DASHBOARD_LAYOUT.map((c) => c.id)).toEqual(DASHBOARD_CARD_IDS);
  });
});
