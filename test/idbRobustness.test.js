import "fake-indexeddb/auto"; // MUST be first — makes `indexedDB` available before storage.js/localDb.js load
import { describe, it, expect, beforeEach } from "vitest";
import { idbPut, idbGet, idbDelete, idbDeleteByPrefix, idbAvailable } from "../src/workspaces/site-planner/lib/localDb.js";
import { saveSite, deleteSite, backupNow, initHistoryStore, _resetHistoryForTest, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";

// B474 REVIEW hardening — these run with IndexedDB PRESENT (fake-indexeddb). They lock in the leak-cleanup
// (idbDelete was dead code → deletes orphaned rasters forever) and backupNow's honesty (it must not claim a
// backup persisted off a fire-and-forget idb write it can't synchronously verify). The IndexedDB-ABSENT
// faithfulness guard lives in storage.test.js.
const bld = (id) => ({ id, type: "building", cx: 0, cy: 0, w: 10, h: 10 });

function freshLocalStorage() {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
}
// A store whose CONTENTS stay readable but whose WRITES start failing on demand (simulates a device that
// fills mid-session). `block()` flips it — getItem still returns what was saved before the block.
function blockableLocalStorage() {
  const store = {};
  let blocked = false;
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { if (blocked) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; } store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  return { block: () => { blocked = true; } };
}

describe("B474 review — idbDeleteByPrefix evicts only the matching prefix (#13/#24)", () => {
  beforeEach(() => { freshLocalStorage(); setActiveUser(null); });

  it("deletes every key under a prefix and leaves siblings untouched", async () => {
    expect(idbAvailable()).toBe(true);
    await idbPut("raster:s1:underlay", "A");
    await idbPut("raster:s1:overlay:o1", "B");
    await idbPut("raster:s1:drawing:d1", "C");
    await idbPut("raster:s2:underlay", "D");      // a DIFFERENT site — must survive
    const ok = await idbDeleteByPrefix("raster:s1:");
    expect(ok).toBe(true);
    expect(await idbGet("raster:s1:underlay")).toBe(null);
    expect(await idbGet("raster:s1:overlay:o1")).toBe(null);
    expect(await idbGet("raster:s1:drawing:d1")).toBe(null);
    expect(await idbGet("raster:s2:underlay")).toBe("D"); // colon delimiter prevents s1/s12-style prefix bleed
  });

  it("a prefix that is itself a key-prefix of another site does not bleed (s1 vs s12)", async () => {
    await idbPut("raster:s1:underlay", "A");
    await idbPut("raster:s12:underlay", "Z");
    await idbDeleteByPrefix("raster:s1:");
    expect(await idbGet("raster:s1:underlay")).toBe(null);
    expect(await idbGet("raster:s12:underlay")).toBe("Z");
  });
});

describe("B474 review — deleteSite evicts that site's cached rasters from IndexedDB (#19, no orphans)", () => {
  beforeEach(async () => { freshLocalStorage(); setActiveUser(null); await idbDelete("raster:gone:underlay"); });

  it("removes raster:<id>:* on delete; an unrelated site's rasters remain", async () => {
    saveSite({ id: "gone", site: "X", els: [bld("a")], underlay: { src: "data:image/png;base64,AAA", idbKey: "raster:gone:underlay" } });
    saveSite({ id: "keep", site: "Y", els: [bld("b")], underlay: { src: "data:image/png;base64,BBB", idbKey: "raster:keep:underlay" } });
    await idbPut("raster:gone:underlay", "data:image/png;base64,AAA");
    await idbPut("raster:gone:overlay:o9", "data:image/png;base64,AAA");
    await idbPut("raster:keep:underlay", "data:image/png;base64,BBB");
    deleteSite("gone");
    // deleteSite fires idbDeleteByPrefix fire-and-forget; give it a tick to commit.
    await new Promise((r) => setTimeout(r, 60));
    expect(await idbGet("raster:gone:underlay")).toBe(null);
    expect(await idbGet("raster:gone:overlay:o9")).toBe(null);
    expect(await idbGet("raster:keep:underlay")).toBe("data:image/png;base64,BBB"); // untouched
  });
});

describe("B474 review — backupNow is honest, never claims an unverifiable backup (#14)", () => {
  it("returns FALSE when the localStorage write fails, even though the idb write is attempted", async () => {
    const ls = blockableLocalStorage();
    setActiveUser(null);
    _resetHistoryForTest();
    await initHistoryStore();
    saveSite({ id: "s", site: "X", els: [bld("a"), bld("b")] }); // real content to protect (stays readable)
    // Now the device store goes unwritable. backupNow must NOT report success off the fire-and-forget
    // idb write it can't synchronously confirm — Restore would otherwise wipe the canvas with no real backup.
    ls.block();
    expect(backupNow("s")).toBe(false);
  });

  it("returns TRUE in the normal case (localStorage write succeeds)", async () => {
    freshLocalStorage();
    setActiveUser(null);
    _resetHistoryForTest();
    await initHistoryStore();
    saveSite({ id: "s2", site: "X", els: [bld("a"), bld("b")] });
    expect(backupNow("s2")).toBe(true);
  });
});
