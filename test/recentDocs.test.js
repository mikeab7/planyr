/* recentDocs — the Library Home "Recent" list: recently OPENED drawings, newest first,
 * deduped by id, capped, per-uid, corrupt storage boots clean. */
import { describe, it, expect, beforeEach } from "vitest";
import { listRecents, recordOpen, removeRecent, RECENTS_CAP } from "../src/shared/recents/recentDocs.js";

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

beforeEach(() => { globalThis.localStorage = makeStore(); });

describe("recentDocs", () => {
  it("records newest-first with a timestamp", () => {
    recordOpen("u1", { id: "a", projectId: "p1" }, 1000);
    recordOpen("u1", { id: "b", projectId: "p2" }, 2000);
    expect(listRecents("u1")).toEqual([
      { id: "b", projectId: "p2", openedAt: 2000 },
      { id: "a", projectId: "p1", openedAt: 1000 },
    ]);
  });

  it("re-opening moves the doc to the front (dedupe by id)", () => {
    recordOpen("u1", { id: "a", projectId: "p1" }, 1000);
    recordOpen("u1", { id: "b", projectId: "p1" }, 2000);
    recordOpen("u1", { id: "a", projectId: "p1" }, 3000);
    const list = listRecents("u1");
    expect(list.map((r) => r.id)).toEqual(["a", "b"]);
    expect(list[0].openedAt).toBe(3000);
  });

  it("caps the list", () => {
    for (let i = 0; i < RECENTS_CAP + 5; i++) recordOpen("u1", { id: `d${i}`, projectId: null }, i);
    const list = listRecents("u1");
    expect(list.length).toBe(RECENTS_CAP);
    expect(list[0].id).toBe(`d${RECENTS_CAP + 4}`); // newest kept, oldest dropped
  });

  it("uid buckets are isolated; signed-out uses the local bucket", () => {
    recordOpen("u1", { id: "a" }, 1);
    recordOpen(null, { id: "b" }, 2);
    expect(listRecents("u1").map((r) => r.id)).toEqual(["a"]);
    expect(listRecents(null).map((r) => r.id)).toEqual(["b"]);
  });

  it("removeRecent drops the entry", () => {
    recordOpen("u1", { id: "a" }, 1);
    recordOpen("u1", { id: "b" }, 2);
    removeRecent("u1", "a");
    expect(listRecents("u1").map((r) => r.id)).toEqual(["b"]);
  });

  it("junk ids are ignored; corrupt storage reads empty and clears", () => {
    recordOpen("u1", { id: "" }, 1);
    expect(listRecents("u1")).toEqual([]);
    localStorage.setItem("planyr:recentDocs:v1:u1", "{nope");
    expect(listRecents("u1")).toEqual([]);
    expect(localStorage.getItem("planyr:recentDocs:v1:u1")).toBe(null);
  });
});
