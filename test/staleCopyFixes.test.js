/* B1953796 — R3 (adopt signed-out workbook), R4 (comps-changed signal), R5 (one manual-pin key),
 * R6 (org workbook name has one writer), R9 (comp county rides the placement commit). */
import { describe, it, expect, vi } from "vitest";
import { decideAnonAdoption, orgContentRow } from "../src/workspaces/model/lib/modelStore.js";
import { onCompsChanged, notifyCompsChanged } from "../src/shared/comps/lib/compsChanged.js";
import { manualPinKey, manualGroupKey } from "../src/workspaces/food/lib/foodStore.js";
import { withResolvedCounties } from "../src/shared/sitePlans/lib/overlayCompCounty.js";

describe("R3 anon workbook adoption", () => {
  const base = { userId: "u1", userLocal: null, cloudOk: true, cloudSheet: null, anonLocal: { a: 1 }, diverges: false };
  it("adopts when the user's scope and the cloud are both empty", () => expect(decideAnonAdoption(base)).toBe("adopt"));
  it("never adopts over a non-empty user copy", () => expect(decideAnonAdoption({ ...base, userLocal: { b: 1 } })).toBe("none"));
  it("never overwrites a cloud workbook — surfaces divergence instead", () => {
    expect(decideAnonAdoption({ ...base, cloudSheet: { c: 1 }, diverges: true })).toBe("diverged");
    expect(decideAnonAdoption({ ...base, cloudSheet: { c: 1 }, diverges: false })).toBe("none");
  });
  it("does nothing signed out, with no anon copy, or when the cloud read failed", () => {
    expect(decideAnonAdoption({ ...base, userId: null })).toBe("none");
    expect(decideAnonAdoption({ ...base, anonLocal: null })).toBe("none");
    expect(decideAnonAdoption({ ...base, cloudOk: false })).toBe("none");
  });
});

describe("R4 comps-changed signal", () => {
  it("subscribers hear a comp write, and unsubscribe cleanly", () => {
    const seen = [];
    const win = new EventTarget();
    globalThis.window = win;
    globalThis.StorageEvent = class extends Event { constructor(t, o) { super(t); this.key = o && o.key; } };
    const off = onCompsChanged(() => seen.push(1));
    notifyCompsChanged();
    off();
    notifyCompsChanged();
    expect(seen).toHaveLength(1);
    delete globalThis.window;
  });
});

describe("R5 manual pin key", () => {
  it("two pins with one name at different spots get different keys; same spot same key", () => {
    expect(manualPinKey("Taco Stand", 29.7, -95.3)).not.toBe(manualPinKey("Taco Stand", 29.8, -95.4));
    expect(manualPinKey("Taco Stand", 29.70001, -95.3)).toBe(manualPinKey("Taco Stand", 29.70002, -95.3));
    expect(manualPinKey("A", 1, 2)).toBe(`pin:${manualGroupKey("A", 1, 2)}`);
  });
});

describe("R6 org workbook name has one writer", () => {
  it("a content save of an existing row carries no name; the insert does", () => {
    expect(orgContentRow({ id: "w", name: "Old", sheet: { s: 1 }, expected: 3 })).toEqual({ id: "w", data: { s: 1 } });
    expect(orgContentRow({ id: "w", name: "New", sheet: { s: 1 }, expected: null })).toEqual({ id: "w", name: "New", data: { s: 1 } });
  });
});

describe("R9 comp county on placement commit", () => {
  it("adds county only where it resolved; a failed lookup leaves the key off", async () => {
    const out = await withResolvedCounties([{ id: "a", lat: 1, lon: 2 }, { id: "b", lat: 3, lon: 4 }], async (lat) => (lat === 1 ? "harris" : null));
    expect(out[0].county).toBe("harris");
    expect("county" in out[1]).toBe(false);
  });
  it("vi is available", () => expect(typeof vi.fn).toBe("function"));
});
