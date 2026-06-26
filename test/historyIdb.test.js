import "fake-indexeddb/auto"; // MUST be first — makes `indexedDB` available before storage.js/localDb.js load
import { describe, it, expect, beforeEach } from "vitest";
import { saveSite, listVersions, getVersion, backupNow, initHistoryStore, _resetHistoryForTest } from "../src/workspaces/site-planner/lib/storage.js";
import { idbGet, idbPut, idbDelete, idbAvailable } from "../src/workspaces/site-planner/lib/localDb.js";

// B474 — the version-history ring is backed by IndexedDB (gigabytes) with a synchronous in-memory ring +
// a localStorage fallback. These run with IndexedDB PRESENT (fake-indexeddb). The existing storage.test.js
// runs with IndexedDB ABSENT and is the faithfulness guard for the localStorage path.
const HISTORY_KEY = "planarfit:sites:history:v1";
const bld = (id) => ({ id, type: "building", cx: 0, cy: 0, w: 10, h: 10 });
const flush = () => new Promise((r) => setTimeout(r, 50)); // let fire-and-forget idbPut commit

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

describe("B474 — version history backed by IndexedDB", () => {
  beforeEach(async () => {
    freshLocalStorage();
    await idbDelete(HISTORY_KEY); // clear the one key (avoids the open-connection deleteDatabase block)
    _resetHistoryForTest();
  });

  it("IndexedDB is present in this suite (otherwise it'd silently test the fallback)", () => {
    expect(idbAvailable()).toBe(true);
  });

  it("snapshot → list → get round-trips through the in-memory ring", async () => {
    await initHistoryStore();
    saveSite({ id: "s", site: "X", els: [bld("a"), bld("b"), bld("c")] }); // no prior → no snapshot
    saveSite({ id: "s", site: "X", els: [bld("a")] });                     // thinned → snapshots the 3-building prior
    const vs = listVersions("s");
    expect(vs.length).toBeGreaterThanOrEqual(1);
    expect(vs[0].buildings).toBe(3);
    expect(getVersion("s", vs[0].at).els.map((e) => e.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("writes the ring through to IndexedDB (durable, off the localStorage budget)", async () => {
    await initHistoryStore();
    saveSite({ id: "s", els: [bld("a"), bld("b")] });
    saveSite({ id: "s", els: [bld("a")] }); // snapshot the prior
    await flush();
    const ring = JSON.parse(await idbGet(HISTORY_KEY));
    expect(ring.s.length).toBeGreaterThanOrEqual(1);
    expect(ring.s[0].buildings).toBe(2);
  });

  it("migrates a pre-existing localStorage-only ring into IndexedDB on init (loses nothing)", async () => {
    const seeded = { s: [{ at: 1000, sig: "x", buildings: 5, name: null, site: null, model: { id: "s", els: [bld("a"), bld("b"), bld("c"), bld("d"), bld("e")] } }] };
    localStorage.setItem(HISTORY_KEY, JSON.stringify(seeded));
    _resetHistoryForTest();
    await initHistoryStore();                                   // hydrate + migrate
    expect(listVersions("s").map((v) => v.at)).toContain(1000); // still visible
    await flush();
    const ring = JSON.parse(await idbGet(HISTORY_KEY));
    expect(ring.s.find((v) => v.at === 1000)).toBeTruthy();     // now in IndexedDB
  });

  it("merges the localStorage seed with the IndexedDB copy on init (union by timestamp)", async () => {
    await idbPut(HISTORY_KEY, JSON.stringify({ s: [{ at: 1000, sig: "a", buildings: 1, model: { id: "s", els: [bld("a")] } }] }));
    localStorage.setItem(HISTORY_KEY, JSON.stringify({ s: [{ at: 2000, sig: "b", buildings: 2, model: { id: "s", els: [bld("a"), bld("b")] } }] }));
    _resetHistoryForTest();
    await initHistoryStore();
    const ats = listVersions("s").map((v) => v.at);
    expect(ats).toContain(1000);
    expect(ats).toContain(2000);
  });

  it("backupNow still gates Restore (true once a real backup persisted)", async () => {
    await initHistoryStore();
    saveSite({ id: "s", els: [bld("a"), bld("b")] });
    expect(backupNow("s")).toBe(true);
  });
});
