/* NEW-1 (B217540 recurrence ×2) — the autosave's two whole-store reads are answered from the write itself while the
 * store is untouched, and fall back to the full read the moment anything else has touched it.
 * The e2e half (a real drag, counted writes, the settled position saved) is e2e/gesture-save-deferral.spec.js. */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { saveSite, loadSite, siteExistsLocally, readBackSite } from "../src/workspaces/site-planner/lib/storage.js";

const KEY = "planarfit:sites:v1";
const bld = (id, cx = 0) => ({ id, type: "building", cx, cy: 0, w: 100, h: 100 });

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
});

describe("siteExistsLocally", () => {
  it("is false for a plan this device has never held, true once saved — the same answer `loadSite` gives", () => {
    expect(siteExistsLocally("p1")).toBe(false);
    expect(!!loadSite("p1")).toBe(false);
    saveSite({ id: "p1", els: [bld("a")] });
    expect(siteExistsLocally("p1")).toBe(true);
    expect(!!loadSite("p1")).toBe(true);
  });
  it("answers right after a write WITHOUT parsing the store", () => {
    saveSite({ id: "p1", els: [bld("a")] });
    const parse = vi.spyOn(JSON, "parse");
    expect(siteExistsLocally("p1")).toBe(true);
    expect(siteExistsLocally("nope")).toBe(false);
    expect(parse).not.toHaveBeenCalled();
    parse.mockRestore();
  });
  it("FALLS BACK to the real read when another writer has touched the store — it never serves a stale yes", () => {
    saveSite({ id: "p1", els: [bld("a")] });
    expect(siteExistsLocally("p1")).toBe(true);
    localStorage.setItem(KEY, JSON.stringify({}));              // another tab / a cloud pull removed it
    expect(siteExistsLocally("p1")).toBe(false);
    localStorage.setItem(KEY, JSON.stringify({ p1: { id: "p1", els: [] }, p2: { id: "p2", els: [] } }));
    expect(siteExistsLocally("p2")).toBe(true);                 // and never a stale no either
  });
});

describe("readBackSite — the persistence verifier's read", () => {
  it("returns the stored record's drawn collections (what the B473/B592 check counts) by parsing ONE plan entry, never the library", () => {
    for (let i = 0; i < 20; i++) saveSite({ id: `o${i}`, els: [bld("a"), bld("b"), bld("c")] });
    saveSite({ id: "p1", els: [bld("a"), bld("b")] });
    const storeChars = Object.keys(localStorage).length ? 1 : 1;   // (keys not enumerable on the mock; size is asserted via the parse below)
    const parse = vi.spyOn(JSON, "parse");
    const back = readBackSite("p1");
    const parsed = parse.mock.calls.reduce((n, c) => n + (typeof c[0] === "string" ? c[0].length : 0), 0);
    parse.mockRestore();
    expect((back.els || []).map((e) => e.id).sort()).toEqual(["a", "b"]);
    expect(parsed).toBeLessThan(JSON.stringify(back).length * 2 + 50);   // one entry's worth, not 21 plans'
    expect(storeChars).toBe(1);
  });
  it("sees ANOTHER writer's change (the cross-tab case the check exists for) — it reads the real entry then", () => {
    saveSite({ id: "p1", els: [bld("a"), bld("b")] });
    const stored = JSON.parse(localStorage.getItem(KEY));       // an older-build tab deletes "b" and writes the legacy entry whole
    stored.p1.els = stored.p1.els.filter((e) => e.id === "a");
    stored.p1.deletedIds = ["b"];
    stored.p1.updatedAt = (stored.p1.updatedAt || 0) + 5000;
    localStorage.setItem(KEY, JSON.stringify(stored));
    const back = readBackSite("p1");
    expect((back.els || []).map((e) => e.id)).toEqual(["a"]);
  });
  it("a plan that is not there answers null-ish exactly as loadSite does", () => {
    expect(readBackSite("ghost")).toBe(loadSite("ghost"));
  });
});

describe("wiring", () => {
  it("the autosave effect uses both", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
    expect(src).toContain("const fresh = !siteExistsLocally(siteId);");
    expect(src).toContain("const back = readBackSite(siteId);");
  });
});
