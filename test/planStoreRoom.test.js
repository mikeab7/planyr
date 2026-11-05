import "fake-indexeddb/auto"; // MUST be first
/* B2200385 / B2200384 — MAKE ROOM WHEN THE PER-PLAN MOVE CANNOT PROCEED, AND PROVE THE TIGHT DEVICES NO LONGER NEED IT.
 *
 * Fixtures are the two owner devices measured in production `client_errors` (event plan-store-migration-aborted), 2026-10-11:
 *   DEVICE A  Windows/Chromium · 77 plans · legacy 2,004,695 chars · 3,597,555 used · cap 5,200,000 · reason `headroom`, shortBy 658,240
 *   DEVICE B  iPhone/WebKit    · 77 plans · legacy 1,337,453 chars · reason `quota` — the 5.2M pre-check PASSED and the copy itself was refused
 * B2200384 moves plans ONE AT A TIME (entry → read back → drop from the legacy entry), so neither device needs the library's size again; both now migrate
 * with NO help. The make-room ladder (retire the legacy entry if one exists and verifies → history ring to IndexedDB → re-fetchable caches) remains for the
 * case where not even ONE plan's entry fits. Rules under test: only data PROVEN duplicated in IndexedDB (read back, compared) or re-fetchable is removed;
 * a failed/killed IndexedDB write keeps the localStorage copy; every plan stays readable the whole time. */
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
    quota,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      v = String(v);
      let used = 0; for (const [kk, vv] of store) if (kk !== k) used += kk.length + vv.length;
      if (used + k.length + v.length > ls.quota) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
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
  await idbDelete(HISTORY_KEY);
  IDBObjectStore.prototype.put = origPut;
});
afterEach(() => { delete globalThis.__PLANYR_LS_CAP; IDBObjectStore.prototype.put = origPut; });

const A = { legacyChars: 2_004_695, ringChars: 716_000, usedTarget: 3_597_555 };
const configureNoRoom = () => planStore.configure({ makeRoom: null });
const configureRoom = () => planStore.configure({ makeRoom: (a) => makeRoomForPlanStore(a) });

/** A device whose free room is `free` chars — less than one plan's entry — so the move is genuinely stuck until something is freed. */
const stuckDevice = (spec, free = 20_000) => {
  LS = makeLS(); globalThis.localStorage = LS; planStore._resetForTest(); _resetHistoryForTest();
  const seeded = seedDevice(LS, spec);
  LS.quota = LS.used() + free; globalThis.__PLANYR_LS_CAP = LS.quota;
  return seeded;
};

describe("DEVICE A (Chromium, 3.6M of 5.2M used, legacy 2.0M): refused on every load before; now migrates by itself, plan by plan", () => {
  it("RED-PROOF of the old refusal: the all-at-once rule's arithmetic still says 'short by ~0.66M' for this device — the plan-by-plan move simply does not need that room", () => {
    const need = A.legacyChars + 77 * (KEY.length + 12) + 600;
    expect(A.usedTarget + need + HEADROOM - 5_200_000).toBeGreaterThan(600_000);     // what `plan-store-migration-aborted headroom` reported, shortBy 658,240
    expect(A.usedTarget + need + HEADROOM - 5_200_000).toBeLessThan(700_000);
  });
  it("with NO make-room hook at all: every plan moves, the legacy entry is gone, the history ring is NOT touched, no abort is reported", () => {
    configureNoRoom();
    try {
      globalThis.__PLANYR_LS_CAP = 5_200_000;
      LS = makeLS({ quota: 5_200_000 }); globalThis.localStorage = LS; planStore._resetForTest();
      const { lib, ring } = seedDevice(LS, A);
      planStore.readShared(KEY); planStore._drainMigration(KEY);
      expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", migrating: false, entries: 77 });
      expect(LS.getItem(KEY)).toBeNull();
      expect(LS.getItem(HISTORY_KEY)).toBe(ring);                                     // nothing else on the device was disturbed
      for (const id of Object.keys(lib)) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));
      expect(events("plan-store-migration-aborted")).toHaveLength(0);
      expect(events("plan-store-migrated")[0][2]).toMatchObject({ plans: 77, incremental: true });
      expect(5_200_000 - LS.used()).toBeGreaterThan(1_000_000);                       // and the device is left with MORE room than before, not less
    } finally { configureRoom(); }
  });
  it("a device so full that not even one plan fits: stuck (still fully readable), reported, then history moves to IndexedDB (verified) and the move resumes in the same load", async () => {
    const { lib, ring } = stuckDevice(A);
    const legacyBefore = LS.getItem(KEY);
    expect(Object.keys(planStore.readShared(KEY))).toHaveLength(77);
    expect(planStore.describe(KEY).migrating).toBe(true);
    expect(LS.getItem(KEY)).toBe(legacyBefore);                                       // untouched while stuck
    await settle(() => planStore.describe(KEY).migrating === false);
    expect(LS.getItem(KEY)).toBeNull();
    expect(LS.getItem(HISTORY_KEY)).toBeNull();                                       // the duplicate: gone
    expect(LS.getItem(FLAG)).toBe("1");
    for (const id of Object.keys(lib)) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));
    expect(await idbGet(HISTORY_KEY)).toBe(JSON.stringify(JSON.parse(ring)));         // IndexedDB holds the identical ring
    expect(events("plan-store-migration-aborted").map((c) => c[2].reason)).toEqual(["quota"]);
    const made = events("plan-store-room-made")[0][2];
    expect(made.enough).toBe(true); expect(made.freedChars).toBeGreaterThan(700_000);
    expect(events("plan-store-migrated").some((c) => c[2].afterRoom === true && c[2].freedChars > 0)).toBe(true);
  });
});

describe("DEVICE B (iPhone: the 5.2M pre-check passes, the real cap is smaller)", () => {
  const B = { legacyChars: 1_337_453, ringChars: 700_000, usedTarget: 2_930_000 };
  it("with no help: the smaller real cap no longer matters — one plan's entry at a time fits, so all 77 move", () => {
    configureNoRoom();
    try {
      LS = makeLS({ quota: 4_000_000 }); globalThis.localStorage = LS; planStore._resetForTest();
      const { lib } = seedDevice(LS, B);
      planStore.readShared(KEY); planStore._drainMigration(KEY);
      expect(Object.keys(planStore.readShared(KEY)).sort()).toEqual(Object.keys(lib).sort());
      expect(LS.getItem(KEY)).toBeNull();
      expect(events("plan-store-migration-aborted")).toHaveLength(0);
    } finally { configureRoom(); }
  });
  it("the old 'structural' device (an empty origin could not hold the original plus a copy) migrates too — only ONE plan's room is ever needed", () => {
    configureNoRoom();
    try {
      LS = makeLS({ quota: 2_500_000 }); globalThis.localStorage = LS; planStore._resetForTest();
      const { lib } = seedDevice(LS, { legacyChars: 1_337_453, ringChars: 100_000, usedTarget: 1_600_000 });
      planStore.readShared(KEY); planStore._drainMigration(KEY);
      expect(Object.keys(planStore.readShared(KEY))).toHaveLength(Object.keys(lib).length);
      expect(events("plan-store-room-none").some((c) => c[2].structural === true)).toBe(false);
    } finally { configureRoom(); }
  });
  it("a refusal REPORTS used / need / short / the cap bracket, learns the cap, and is cleaned up: no stray keys, nothing lost", () => {
    configureNoRoom();
    try {
      stuckDevice(B, 5_000);
      const lib = JSON.parse(LS.getItem(KEY));
      expect(Object.keys(planStore.readShared(KEY)).sort()).toEqual(Object.keys(lib).sort());
      const e = events("plan-store-migration-aborted")[0][2];
      expect(e.reason).toBe("quota");
      expect(e.needChars).toBeGreaterThan(10_000); expect(e.usedAtFail).toBeGreaterThan(2_900_000); expect(e.capHiChars).toBeGreaterThan(e.usedAtFail);
      expect(e.remaining).toBe(77);
      expect(planStore._learnedCap()).toBe(e.capHiChars);
      expect([...LS.raw.keys()].filter((k) => k.includes(":p:"))).toEqual([]);          // no half-written entry left behind
    } finally { configureRoom(); }
  });
});

describe("the history move: IndexedDB must be PROVEN first — killed or lying IndexedDB keeps the localStorage copy", () => {
  const seed = () => stuckDevice(A);
  it("IndexedDB write KILLED MID-WRITE (the transaction aborts): ring kept byte-for-byte, no flag, the move stays unfinished (every plan still readable), the reason is reported", async () => {
    const { ring } = seed();
    IDBObjectStore.prototype.put = function (v, k) { if (k === HISTORY_KEY) { this.transaction.abort(); throw new Error("killed mid-write"); } return origPut.call(this, v, k); };
    const legacyBefore = LS.getItem(KEY);
    planStore.readShared(KEY);
    await new Promise((r) => setTimeout(r, 120));
    expect(LS.getItem(HISTORY_KEY)).toBe(ring);
    expect(LS.getItem(FLAG)).toBeNull();
    expect(LS.getItem(KEY)).toBe(legacyBefore);
    expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", migrating: true });
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

describe("after the move: the ring lives in IndexedDB only and degrades loudly", () => {
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
  it("an older build's history path (no flag): it seeds from the (empty) localStorage ring and merges the full ring from the same IndexedDB key — every snapshot is there", async () => {
    const ring = await prep();
    LS.removeItem(FLAG);                       // an older build has no notion of the flag; this is exactly its path: LS seed ∪ IndexedDB
    _resetHistoryForTest(); await initHistoryStore();
    expect(listVersions("p001").map((v) => v.at).sort()).toEqual(ring.p001.map((v) => v.at).sort());
    expect(getVersion("p002", ring.p002[0].at)).toBeTruthy();
  });
  it("plans: no whole-library entry is ever written, so there is nothing for an older build to read (a revert is no longer supported — B2200384)", () => {
    LS = makeLS(); globalThis.localStorage = LS; planStore._resetForTest();
    const lib = libraryOf(12, 60_000);
    LS.setItem(KEY, JSON.stringify(lib));
    planStore.readShared(KEY);
    saveSite({ id: "p003", site: "S", name: "edited after the move", els: [] });
    expect(LS.getItem(KEY)).toBeNull();
    expect(Object.keys(planStore.readShared(KEY)).sort()).toEqual(Object.keys(lib).sort());
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
