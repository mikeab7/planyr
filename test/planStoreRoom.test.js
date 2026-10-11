import "fake-indexeddb/auto"; // MUST be first
/* B2200385 — MAKE ROOM ON A NEAR-FULL DEVICE SO THE PER-PLAN STORE CAN MIGRATE.
 *
 * Fixtures are the two owner devices measured in production `client_errors` (event plan-store-migration-aborted), 2026-10-11:
 *   DEVICE A  Windows/Chromium · 77 plans · legacy 2,004,695 chars · 3,597,555 used · cap 5,200,000 · reason `headroom`, shortBy 658,240
 *   DEVICE B  iPhone/WebKit    · 77 plans · legacy 1,337,453 chars · reason `quota` — the 5.2M pre-check PASSED and the copy itself was refused
 * Rules under test: only data PROVEN duplicated in IndexedDB (read back, compared) or re-fetchable is removed; the legacy entry and the per-plan
 * entries are never touched; a failed/killed IndexedDB write keeps the localStorage copy; reverting to an older build still opens everything. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/shared/telemetry/clientErrors.js", async (orig) => ({ ...(await orig()), reportClientEvent: vi.fn() }));

import { reportClientEvent } from "../src/shared/telemetry/clientErrors.js";
import * as planStore from "../src/workspaces/site-planner/lib/planStore.js";
import {
  relocateHistoryToIdb, makeRoomForPlanStore, backupNowVerified, historyIdbOnly, initHistoryStore, listVersions, getVersion, snapshotVersion,
  saveSite, _resetHistoryForTest, _flushHistoryIdbForTest,
} from "../src/workspaces/site-planner/lib/storage.js";
import { idbGet, idbPut, idbDelete } from "../src/workspaces/site-planner/lib/localDb.js";
import { prefetchExtents, getCachedExtent, setLayerExtent, _resetCoverageCache } from "../src/workspaces/site-planner/lib/coverage.js";

const KEY = "planarfit:sites:v1";
const HISTORY_KEY = "planarfit:sites:history:v1";
const FLAG = "planarfit:sites:history:idbonly";
const HEADROOM = planStore.HEADROOM_AFTER_CHARS;
const events = (name) => reportClientEvent.mock.calls.filter((c) => c[0] === name);

function makeLS({ quota = Infinity } = {}) {
  const store = new Map();
  const ls = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      v = String(v);
      let used = 0; for (const [kk, vv] of store) if (kk !== k) used += kk.length + vv.length;
      if (used + k.length + v.length > quota) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
      store.set(k, v);
    },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    used: () => { let n = 0; for (const [k, v] of store) n += k.length + v.length; return n; },
    raw: store,
  };
  return ls;
}

/* n plans whose library JSON (with its key) is exactly `target` characters. */
function libraryOf(n, target) {
  const lib = {};
  for (let i = 0; i < n; i++) lib["p" + String(i).padStart(3, "0")] = { id: "p" + String(i).padStart(3, "0"), groupId: "g" + (i % 9), site: "S" + (i % 9), name: "Plan " + i, updatedAt: 1_700_000_000_000 + i, els: [{ id: "e" + i, type: "building", cx: 0, cy: 0, w: 10, h: 10 }], pad: "" };
  const base = JSON.stringify(lib).length;
  const per = Math.floor((target - KEY.length - base) / n);
  for (const r of Object.values(lib)) r.pad = "x".repeat(per);
  let text = JSON.stringify(lib);
  const rest = target - KEY.length - text.length;     // fine-tune on the last plan
  lib["p" + String(n - 1).padStart(3, "0")].pad += "y".repeat(Math.max(0, rest));
  return lib;
}
/* A version ring of `chars` characters across a few sites: snapshots are real shapes (id, els, at, sig …). */
function ringOf(chars) {
  const ring = {}; const sites = ["p001", "p002", "p003"]; let at = 1_700_000_100_000;
  const snap = (id, pad) => ({ at: (at += 5000), sig: "1/0/0/0/0/" + at + "/0", buildings: 1, name: "n", site: "s", model: { id, els: [{ id: "b", type: "building", cx: 0, cy: 0, w: 10, h: 10 }], pad } });
  for (const id of sites) ring[id] = [];
  const empty = JSON.stringify(ring).length;
  const per = Math.floor((chars - empty) / 9) - 160;
  for (let i = 0; i < 3; i++) for (const id of sites) ring[id].unshift(snap(id, "h".repeat(per)));
  return ring;
}
const seedDevice = (LS, { legacyChars, ringChars, usedTarget, plans = 77 }) => {
  const lib = libraryOf(plans, legacyChars);
  LS.setItem(KEY, JSON.stringify(lib));
  const ring = JSON.stringify(ringOf(ringChars));
  LS.setItem(HISTORY_KEY, ring);
  const filler = usedTarget - LS.used() - "planarfit:settings:other".length;
  if (filler > 0) LS.setItem("planarfit:settings:other", "z".repeat(filler));
  return { lib, ring };
};
const settle = async (cond, ms = 4000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("timed out"); await new Promise((r) => setTimeout(r, 10)); } };

let LS;
const origPut = globalThis.IDBObjectStore && IDBObjectStore.prototype.put;
beforeEach(async () => {
  LS = makeLS(); globalThis.localStorage = LS;
  planStore._resetForTest(); _resetHistoryForTest(); reportClientEvent.mockClear();
  globalThis.__PLANYR_LEGACY_MIRROR = "idle";
  await idbDelete(HISTORY_KEY);
  IDBObjectStore.prototype.put = origPut;
});
afterEach(() => { delete globalThis.__PLANYR_LS_CAP; delete globalThis.__PLANYR_LEGACY_MIRROR; IDBObjectStore.prototype.put = origPut; });

const A = { legacyChars: 2_004_695, ringChars: 716_000, usedTarget: 3_597_555 };
const configureNoRoom = () => planStore.configure({ makeRoom: null });
const configureRoom = () => planStore.configure({ makeRoom: (a) => makeRoomForPlanStore(a) });

describe("DEVICE A (Chromium, 3.6M of 5.2M used, legacy 2.0M): refused today, migrates after the safe trim", () => {
  it("RED-PROOF: without the make-room step it aborts `headroom`, short by ~0.66M, exactly as in production", () => {
    configureNoRoom();
    try {
      globalThis.__PLANYR_LS_CAP = 5_200_000;
      LS = makeLS({ quota: 5_200_000 }); globalThis.localStorage = LS; planStore._resetForTest();
      seedDevice(LS, A);
      planStore.readShared(KEY);
      expect(planStore.describe(KEY).mode).toBe("blob");
      const e = events("plan-store-migration-aborted")[0][2];
      expect(e.reason).toBe("headroom");
      expect(e.shortBy).toBeGreaterThan(600_000); expect(e.shortBy).toBeLessThan(700_000);
      expect(e.top).toContain("planarfit:sites:v1=");        // the inventory rides the event
    } finally { configureRoom(); }
  });

  it("with the make-room step: history moves to IndexedDB (verified), the split runs, ≥ 250k stay free, the legacy entry is byte-identical", async () => {
    globalThis.__PLANYR_LS_CAP = 5_200_000;
    LS = makeLS({ quota: 5_200_000 }); globalThis.localStorage = LS; planStore._resetForTest();
    const { lib, ring } = seedDevice(LS, A);
    const legacyBefore = LS.getItem(KEY);
    planStore.readShared(KEY);
    expect(planStore.describe(KEY).mode).toBe("blob");                   // refused first …
    await settle(() => planStore.describe(KEY).mode === "plan");        // … then made room and retried, in the same page load
    expect(LS.getItem(KEY)).toBe(legacyBefore);                          // the original: untouched
    expect(LS.getItem(HISTORY_KEY)).toBeNull();                          // the duplicate: gone
    expect(LS.getItem(FLAG)).toBe("1");
    expect(5_200_000 - LS.used()).toBeGreaterThanOrEqual(HEADROOM);     // the existing 250k headroom rule still holds AFTER the split
    for (const id of Object.keys(lib)) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));
    expect(await idbGet(HISTORY_KEY)).toBe(JSON.stringify(JSON.parse(ring)));  // IndexedDB holds the identical ring
    const made = events("plan-store-room-made")[0][2];
    expect(made.enough).toBe(true); expect(made.freedChars).toBeGreaterThan(700_000);
    expect(events("plan-store-migrated").some((c) => c[2].afterRoom === true && c[2].freedChars > 0)).toBe(true);
  });
});

describe("DEVICE B (iPhone: the 5.2M pre-check passes, the copy itself hits the real, smaller cap)", () => {
  const B = { legacyChars: 1_337_453, ringChars: 700_000, usedTarget: 2_930_000 };
  it("RED-PROOF: without make-room it aborts `quota`, and now REPORTS used / need / short / the cap bracket", () => {
    configureNoRoom();
    try {
      LS = makeLS({ quota: 4_000_000 }); globalThis.localStorage = LS; planStore._resetForTest();
      seedDevice(LS, B);
      planStore.readShared(KEY);
      const e = events("plan-store-migration-aborted")[0][2];
      expect(e.reason).toBe("quota");
      expect(e).toMatchObject({ plans: 77, structural: false });
      expect(e.usedChars).toBeGreaterThan(2_900_000); expect(e.needChars).toBeGreaterThan(1_337_453);
      expect(e.usedAtFail).toBeGreaterThan(e.usedChars); expect(e.capHiChars).toBeGreaterThanOrEqual(4_000_000);
      expect(e.shortBy).toBeGreaterThan(0);
      expect(planStore._learnedCap()).toBe(e.capHiChars);
      expect([...LS.raw.keys()].filter((k) => k.includes(":p:") || k.endsWith(":idx") || k.endsWith(":led"))).toEqual([]);   // clean abort
    } finally { configureRoom(); }
  });
  it("with make-room: the failed copy is cleaned up, history moves, the retry fits the learned cap and migrates", async () => {
    LS = makeLS({ quota: 4_000_000 }); globalThis.localStorage = LS; planStore._resetForTest();
    const { lib } = seedDevice(LS, B);
    planStore.readShared(KEY);
    await settle(() => planStore.describe(KEY).mode === "plan");
    expect(4_000_000 - LS.used()).toBeGreaterThanOrEqual(HEADROOM);
    expect(Object.keys(planStore.readShared(KEY)).sort()).toEqual(Object.keys(lib).sort());
    expect(events("plan-store-migration-aborted").map((c) => c[2].reason)).toEqual(["quota"]);   // exactly the one refusal, then success
  });
  it("STRUCTURAL: if even an empty origin could not hold the original plus a copy, it says so loudly, frees nothing and retries nothing", async () => {
    LS = makeLS({ quota: 2_500_000 }); globalThis.localStorage = LS; planStore._resetForTest();
    seedDevice(LS, { legacyChars: 1_337_453, ringChars: 100_000, usedTarget: 1_600_000 });
    const ringBefore = LS.getItem(HISTORY_KEY);
    planStore.readShared(KEY);
    await new Promise((r) => setTimeout(r, 60));
    const e = events("plan-store-migration-aborted")[0][2];
    expect(e.reason).toBe("quota"); expect(e.structural).toBe(true);
    expect(events("plan-store-room-none").some((c) => c[2].structural === true)).toBe(true);
    expect(events("plan-store-room-made")).toHaveLength(0);
    expect(LS.getItem(HISTORY_KEY)).toBe(ringBefore);                     // nothing was touched
    expect(planStore.describe(KEY).mode).toBe("blob");
  });
});

describe("the history move: IndexedDB must be PROVEN first — killed or lying IndexedDB keeps the localStorage copy", () => {
  const seed = () => {
    globalThis.__PLANYR_LS_CAP = 5_200_000;
    LS = makeLS({ quota: 5_200_000 }); globalThis.localStorage = LS; planStore._resetForTest(); _resetHistoryForTest();
    return seedDevice(LS, A);
  };
  it("IndexedDB write KILLED MID-WRITE (the transaction aborts): ring kept byte-for-byte, no flag, the split stays refused, the reason is reported", async () => {
    const { ring } = seed();
    IDBObjectStore.prototype.put = function (v, k) { if (k === HISTORY_KEY) { this.transaction.abort(); throw new Error("killed mid-write"); } return origPut.call(this, v, k); };
    const legacyBefore = LS.getItem(KEY);
    planStore.readShared(KEY);
    await new Promise((r) => setTimeout(r, 120));
    expect(LS.getItem(HISTORY_KEY)).toBe(ring);
    expect(LS.getItem(FLAG)).toBeNull();
    expect(LS.getItem(KEY)).toBe(legacyBefore);
    expect(planStore.describe(KEY).mode).toBe("blob");
    expect(events("history-relocate-skipped")[0][2].reason).toBe("idb-write");
    expect(events("plan-store-room-none")).toHaveLength(1);
    expect(events("plan-store-migrated")).toHaveLength(0);
  });
  it("IndexedDB that COMMITS BUT STORES SOMETHING ELSE (read-back mismatch): ring kept", async () => {
    const { ring } = seed();
    IDBObjectStore.prototype.put = function (v, k) { return origPut.call(this, k === HISTORY_KEY ? v + " " : v, k); };
    const r = await relocateHistoryToIdb();
    expect(r).toMatchObject({ ok: false, reason: "idb-readback", freedChars: 0 });
    expect(LS.getItem(HISTORY_KEY)).toBe(ring); expect(LS.getItem(FLAG)).toBeNull();
  });
  it("IndexedDB unavailable: ring kept, reported, nothing flagged", async () => {
    const { ring } = seed();
    const saved = globalThis.indexedDB; delete globalThis.indexedDB; vi.resetModules();
    try {
      const fresh = await import("../src/workspaces/site-planner/lib/storage.js");
      const r = await fresh.relocateHistoryToIdb();
      expect(r).toMatchObject({ ok: false, reason: "no-idb", freedChars: 0 });
    } finally { globalThis.indexedDB = saved; vi.resetModules(); }
    expect(LS.getItem(HISTORY_KEY)).toBe(ring); expect(LS.getItem(FLAG)).toBeNull();
  });
  it("a snapshot present in the localStorage copy but MISSING from IndexedDB's merged ring blocks the move", async () => {
    seed();
    // sabotage the merge: IndexedDB write succeeds but drops a snapshot
    IDBObjectStore.prototype.put = function (v, k) {
      if (k === HISTORY_KEY) { const o = JSON.parse(v); o.p001 = o.p001.slice(1); v = JSON.stringify(o); }
      return origPut.call(this, v, k);
    };
    const r = await relocateHistoryToIdb();
    expect(r.ok).toBe(false);
    expect(["idb-readback", "entry-missing"]).toContain(r.reason);
    expect(LS.getItem(HISTORY_KEY)).not.toBeNull();
  });
  it("snapshots IndexedDB already held (from another session) are merged, never overwritten", async () => {
    seed();
    const foreign = { p001: [{ at: 1_800_000_000_000, sig: "x", buildings: 1, name: "n", site: "s", model: { id: "p001", els: [] } }] };
    await idbPut(HISTORY_KEY, JSON.stringify(foreign));
    const r = await relocateHistoryToIdb();
    expect(r.ok).toBe(true);
    const stored = JSON.parse(await idbGet(HISTORY_KEY));
    expect(stored.p001.some((v) => v.at === 1_800_000_000_000)).toBe(true);
    expect(stored.p001.length).toBe(4);
  });
});

describe("after the move: the ring lives in IndexedDB only, degrades loudly, and an older build still sees everything", () => {
  const prep = async () => {
    LS = makeLS(); globalThis.localStorage = LS; planStore._resetForTest(); _resetHistoryForTest();
    const ring = ringOf(60_000);
    LS.setItem(HISTORY_KEY, JSON.stringify(ring));
    const r = await relocateHistoryToIdb();
    expect(r.ok).toBe(true);
    return ring;
  };
  it("new snapshots go to IndexedDB, not localStorage; listVersions sees old + new", async () => {
    const ring = await prep();
    expect(LS.getItem(HISTORY_KEY)).toBeNull();
    _resetHistoryForTest(); await initHistoryStore();
    expect(listVersions("p001").length).toBe(ring.p001.length);
    saveSite({ id: "p001", site: "S", els: [{ id: "a", type: "building", cx: 0, cy: 0, w: 10, h: 10 }, { id: "b", type: "building", cx: 20, cy: 0, w: 10, h: 10 }] });
    saveSite({ id: "p001", site: "S", els: [{ id: "a", type: "building", cx: 0, cy: 0, w: 10, h: 10 }] });
    _flushHistoryIdbForTest(); await new Promise((r) => setTimeout(r, 80));
    expect(LS.getItem(HISTORY_KEY)).toBeNull();                              // still not mirrored
    expect(JSON.parse(await idbGet(HISTORY_KEY)).p001.length).toBeGreaterThan(ring.p001.length - 1);
  });
  it("REVERT TO AN OLDER BUILD: it seeds from the (empty) localStorage ring and merges the full ring from the same IndexedDB key — every snapshot is there", async () => {
    const ring = await prep();
    LS.removeItem(FLAG);                       // an older build has no notion of the flag; this is exactly its path: LS seed ∪ IndexedDB
    _resetHistoryForTest(); await initHistoryStore();
    expect(listVersions("p001").map((v) => v.at).sort()).toEqual(ring.p001.map((v) => v.at).sort());
    expect(getVersion("p002", ring.p002[0].at)).toBeTruthy();
  });
  it("REVERT TO AN OLDER BUILD, plans: the legacy entry is refreshed from the per-plan entries, so the old build opens every plan", () => {
    globalThis.__PLANYR_LEGACY_MIRROR = "sync";
    LS = makeLS(); globalThis.localStorage = LS; planStore._resetForTest();
    const lib = libraryOf(12, 60_000);
    LS.setItem(KEY, JSON.stringify(lib));
    planStore.readShared(KEY);
    saveSite({ id: "p003", site: "S", name: "edited after the move", els: [] });
    planStore.flushMirror(KEY);
    const old = JSON.parse(LS.getItem(KEY));                                 // all an older build ever reads
    expect(Object.keys(old).sort()).toEqual(Object.keys(lib).sort());
  });
  it("IndexedDB failing AFTER the move: the localStorage mirror resumes at once and the failure is reported (the B126 net never has fewer copies)", async () => {
    await prep();
    _resetHistoryForTest(); await initHistoryStore();
    IDBObjectStore.prototype.put = function (v, k) { if (k === HISTORY_KEY) { this.transaction.abort(); throw new Error("killed"); } return origPut.call(this, v, k); };
    saveSite({ id: "p001", site: "S", els: [{ id: "a", type: "building", cx: 0, cy: 0, w: 10, h: 10 }, { id: "b", type: "building", cx: 20, cy: 0, w: 10, h: 10 }] });
    saveSite({ id: "p001", site: "S", els: [{ id: "a", type: "building", cx: 0, cy: 0, w: 10, h: 10 }] });
    _flushHistoryIdbForTest(); await new Promise((r) => setTimeout(r, 100));
    expect(events("history-idb-write-failed").length).toBeGreaterThanOrEqual(1);
    expect(LS.getItem(HISTORY_KEY)).not.toBeNull();
    expect(JSON.parse(LS.getItem(HISTORY_KEY)).p001.length).toBeGreaterThan(0);
  });
  it("Restore's backup is AWAITED, committed and read back on an idb-only device — and refuses honestly when it cannot be", async () => {
    await prep();
    saveSite({ id: "q1", site: "S", els: [{ id: "a", type: "building", cx: 0, cy: 0, w: 10, h: 10 }] });
    _resetHistoryForTest(); await initHistoryStore();
    expect(historyIdbOnly()).toBe(true);
    expect(await backupNowVerified("q1")).toBe(true);
    const stored = JSON.parse(await idbGet(HISTORY_KEY));
    expect(stored.q1.length).toBeGreaterThanOrEqual(1);                      // the claimed backup exists in the durable copy
    IDBObjectStore.prototype.put = function (v, k) { if (k === HISTORY_KEY) { this.transaction.abort(); throw new Error("killed"); } return origPut.call(this, v, k); };
    const keep = { flag: LS.getItem(FLAG), plan: [...LS.raw.entries()].filter(([k]) => k.startsWith(KEY)) };
    LS = makeLS({ quota: 30_000 }); globalThis.localStorage = LS; planStore._resetForTest(); _resetHistoryForTest();   // and the fallback mirror cannot hold the ring either
    LS.setItem(FLAG, keep.flag); for (const [k, v] of keep.plan) LS.setItem(k, v);
    expect(keep.plan.length).toBeGreaterThan(0);
    expect(await backupNowVerified("q1")).toBe(false);                       // nothing proven → Restore stays blocked
  });
});

describe("re-fetchable caches: dropping them is safe because they rebuild on next use", () => {
  it("makeRoom reclaims only declared-rebuildable keys, and a dropped layer extent is re-probed", async () => {
    LS = makeLS(); globalThis.localStorage = LS; _resetCoverageCache();
    setLayerExtent("coh_water", { s: 1, w: 2, n: 3, e: 4 });
    LS.setItem("planyr:giscache:v1:x", "c".repeat(1000));
    LS.setItem("planarfit:sitesGroups", "[]");
    LS.setItem("planarfit:autosave", "A".repeat(50));
    const r = await makeRoomForPlanStore({ reason: "headroom", shortBy: 10_000_000 });
    expect(r.freedChars).toBeGreaterThan(1000);
    expect(LS.getItem("planyr:giscache:v1:x")).toBeNull();
    expect(LS.getItem("planarfit:layerExtent:v1")).toBeNull();
    expect(LS.getItem("planarfit:sitesGroups")).toBe("[]");                   // user data: never on the list
    expect(LS.getItem("planarfit:autosave")).toBe("A".repeat(50));
    _resetCoverageCache();                                                    // "next page load": nothing in memory, nothing in storage
    expect(getCachedExtent("coh_water")).toBeUndefined();                    // dropped …
    let probed = 0;
    await prefetchExtents({ coh_water: { url: "https://example.test/x" } }, async () => { probed++; return { fullExtent: { xmin: -96, ymin: 29, xmax: -95, ymax: 30, spatialReference: { wkid: 4326 } } }; });
    expect(probed).toBe(1);                                                  // … and read again on next use, no error, no user step
    expect(getCachedExtent("coh_water")).toBeTruthy();
  });
});
