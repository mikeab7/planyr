import "fake-indexeddb/auto"; // MUST be first
/* NEW-1 (2026-11-03) — A DUPLICATE THE DEVICE REFUSED MUST BE REFUSED OUT LOUD.
 *
 * The owner's report (a teammate on Goose Creek): duplicate a plan → banner "saved on this device but couldn't sync" → reload → "This project doesn't
 * exist". Production `client_errors`: 8× `cloud-push-failed … {"error":"missing"}`. Cause: the device's storage refused the new plan's entry
 * (`QuotaExceededError`, twice — the slimmed retry too), `writeEntry`/`blobWrite` returned false with ZERO telemetry, `saveSite` returned that false,
 * `duplicatePlan` IGNORED it, pushed the (non-existent) record, said "saved on this device", and navigated into an id with no record.
 *
 * Red-proof: each assertion below fails on main (no event, `duplicatePlan` navigates, the banner says "saved on this device"). Mutation-proven in the
 * commit message: removing the event calls, or making the mint navigate unconditionally, turns this suite red. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../src/shared/telemetry/clientErrors.js", async (orig) => ({ ...(await orig()), reportClientEvent: vi.fn() }));

import { reportClientEvent } from "../src/shared/telemetry/clientErrors.js";
import * as planStore from "../src/workspaces/site-planner/lib/planStore.js";
import { saveSite, loadSite, siteExistsLocally, lastSaveRefusal, requestPlanStoreRoom, pushSiteToCloud, _resetHistoryForTest } from "../src/workspaces/site-planner/lib/storage.js";
import { runMint, describePushFailure, mintRefusedMessage, saveRefusedMessage, PUSH_MISSING } from "../src/workspaces/site-planner/lib/planMint.js";

const events = (name) => reportClientEvent.mock.calls.filter((c) => c[0] === name);

/* A localStorage whose setItem throws QuotaExceededError once the origin would hold more than `quota` characters (keys + values) — Chromium's rule. */
function makeLS({ quota = Infinity } = {}) {
  const store = new Map();
  return {
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
}

const SRC = { id: "src1", groupId: "g1", site: "Goose Creek", name: "Concept A", origin: { lat: 29.8, lon: -95.3 }, parcels: [], els: [{ id: "e1", type: "building", cx: 0, cy: 0, w: 100, h: 100 }], measures: [], settings: {} };
let LS;
beforeEach(() => {
  LS = makeLS(); globalThis.localStorage = LS;
  globalThis.__PLANYR_LEGACY_MIRROR = "idle";
  planStore._resetForTest(); planStore._resetRoomForTest(); _resetHistoryForTest();
  /* The REAL make-room hook (storage.js's IndexedDB relocation) is async: a refusal in one test would otherwise finish during a LATER test on a slow
   * runner and add its own plan-store-write-room event (CI saw 3 where 1 was expected). Every test starts with no hook; the ones that care install theirs. */
  planStore.configure({ makeRoom: null });
  reportClientEvent.mockClear();
});
afterEach(async () => {
  await new Promise((r) => setTimeout(r, 25));                       // let any in-flight make-room chain settle before the next test's counts
  planStore.configure({ makeRoom: null });
  delete globalThis.__PLANYR_LS_CAP; delete globalThis.__PLANYR_LEGACY_MIRROR;
});

/* Seed the library, then shrink the quota so the next write cannot fit. */
function fillTo(freeChars) {
  expect(saveSite(SRC)).toBe(true);
  LS.raw.set("filler", "x".repeat(10));
  const used = LS.used();
  LS = Object.assign(makeLS({ quota: used + freeChars }), {});
  for (const [k, v] of globalThis.localStorage.raw) LS.raw.set(k, v);
  globalThis.localStorage = LS;
  planStore._resetForTest();
}

describe("planStore / saveSite report a refused device write", () => {
  it("saveSite → false AND plan-store-write-refused + site-save-refused fire with reason quota", () => {
    fillTo(50);                                                    // not even a small plan entry fits
    const ok = saveSite({ ...SRC, id: "copy1", name: "Concept A (copy)" });
    expect(ok).toBe(false);
    const a = events("plan-store-write-refused");
    expect(a.length).toBe(1);
    expect(a[0][2]).toMatchObject({ reason: "quota", id: "copy1", mode: "plan" });
    expect(a[0][2].fragChars).toBeGreaterThan(0);
    expect(typeof a[0][2].usedChars).toBe("number");
    const b = events("site-save-refused");
    expect(b.length).toBe(1);
    expect(b[0][2]).toMatchObject({ id: "copy1", reason: "quota", existing: false });
    expect(siteExistsLocally("copy1")).toBe(false);                // nothing was written anywhere
    expect(lastSaveRefusal("copy1")).toMatchObject({ reason: "quota" });
  });

  it("a successful write fires neither event", () => {
    expect(saveSite(SRC)).toBe(true);
    expect(events("plan-store-write-refused")).toHaveLength(0);
    expect(events("site-save-refused")).toHaveLength(0);
  });

  it("blob mode (a device that could not split) reports the same refusal", () => {
    globalThis.localStorage = LS = makeLS({ quota: 400 }); planStore._resetForTest();
    LS.setItem("planarfit:planStore:layout", "blob");
    expect(saveSite({ ...SRC, id: "b1" })).toBe(false);
    const a = events("plan-store-write-refused");
    expect(a.length).toBe(1);
    expect(a[0][2]).toMatchObject({ reason: "quota", mode: "blob", id: "b1" });
  });

  it("the first refusal of a page load asks for room ONCE; a second refusal does not run it again", async () => {
    const makeRoom = vi.fn(async () => ({ freedChars: 0, steps: "none" }));
    planStore.configure({ makeRoom });
    try {
      fillTo(50);
      saveSite({ ...SRC, id: "c1" }); saveSite({ ...SRC, id: "c2" });
      await new Promise((r) => setTimeout(r, 5));
      expect(makeRoom).toHaveBeenCalledTimes(1);
      expect(makeRoom.mock.calls[0][0]).toMatchObject({ reason: "quota" });
      expect(events("plan-store-write-room")).toHaveLength(1);
    } finally { planStore.configure({ makeRoom: null }); }
  });

  it("when room is made, a refused EDIT of an existing plan is retried once and lands", async () => {
    expect(saveSite(SRC)).toBe(true);
    LS.raw.set("filler", "x".repeat(8000));
    const small = makeLS({ quota: LS.used() + 20 }); for (const [k, v] of LS.raw) small.raw.set(k, v);
    LS = small; globalThis.localStorage = LS; planStore._resetForTest();
    const hook = vi.fn(async () => { LS.raw.set("filler", ""); return { freedChars: 8000, steps: "test" }; });   // frees the filler through the SAME shim
    planStore.configure({ makeRoom: hook });
    try {
      const longName = "Renamed while full " + "R".repeat(400);
      expect(saveSite({ id: "src1", name: longName })).toBe(false);
      await new Promise((r) => setTimeout(r, 10));
      expect(hook).toHaveBeenCalledTimes(1);
      expect(events("plan-store-write-retried")).toHaveLength(1);
      expect(events("plan-store-write-retried")[0][2]).toMatchObject({ id: "src1", ok: true });
      expect(loadSite("src1").name).toBe(longName);
    } finally { planStore.configure({ makeRoom: null }); }
  });
});

describe("runMint — the duplicate decision", () => {
  const base = (over = {}) => ({ id: "n1", noun: "copy", what: "The duplicated plan", report: reportClientEvent, ...over });

  it("device refuses → do NOT navigate, honest words, site-mint-refused (not cloud-push-failed)", async () => {
    fillTo(50);
    const makeRoom = vi.fn(async () => ({ freedChars: 0 }));
    const r = await runMint(base({
      save: () => saveSite({ ...SRC, id: "n1", name: "Concept A (copy)" }),
      exists: () => siteExistsLocally("n1"), makeRoom, refusal: () => lastSaveRefusal("n1"),
    }));
    expect(r.ok).toBe(false);
    expect(r.navigate).toBe(false);
    expect(r.reason).toBe("quota");
    expect(r.message).toBe("Couldn't make the copy. This browser's storage for Planyr is full, so nothing was saved. Free up space, or try on another device.");
    expect(r.message).not.toMatch(/saved on this device/i);
    expect(r.message).not.toMatch(/sync/i);
    expect(makeRoom).toHaveBeenCalledTimes(1);
    const ev = events("site-mint-refused");
    expect(ev).toHaveLength(1);
    expect(ev[0][2]).toMatchObject({ what: "The duplicated plan", id: "n1", reason: "quota" });
    expect(events("cloud-push-failed")).toHaveLength(0);
    expect(siteExistsLocally("n1")).toBe(false);
  });

  it("makeRoom frees space → the SAME id is written on the retry and the mint navigates", async () => {
    expect(saveSite(SRC)).toBe(true);
    LS.raw.set("filler", "x".repeat(8000));
    const small = makeLS({ quota: LS.used() + 20 }); for (const [k, v] of LS.raw) small.raw.set(k, v);
    LS = small; globalThis.localStorage = LS; planStore._resetForTest();
    const makeRoom = vi.fn(async () => { LS.raw.set("filler", ""); return { freedChars: 8000 }; });
    const save = vi.fn(() => saveSite({ ...SRC, id: "n2", name: "Concept A (copy)" }));
    const r = await runMint(base({ id: "n2", save, exists: () => siteExistsLocally("n2"), makeRoom, refusal: () => lastSaveRefusal("n2") }));
    expect(makeRoom).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);                            // refused, room made, retried once
    expect(r).toMatchObject({ ok: true, navigate: true });
    expect(siteExistsLocally("n2")).toBe(true);
    expect(events("site-mint-refused")).toHaveLength(0);
  });

  it("a save that says true but left no record never navigates", async () => {
    const r = await runMint(base({ save: () => true, exists: () => false, refusal: () => null }));
    expect(r.navigate).toBe(false);
    expect(events("site-mint-refused")).toHaveLength(1);
  });

  it("the happy path navigates with no room request and no event", async () => {
    const makeRoom = vi.fn();
    const r = await runMint(base({ save: () => saveSite({ ...SRC, id: "n3" }), exists: () => siteExistsLocally("n3"), makeRoom }));
    expect(r).toMatchObject({ ok: true, navigate: true });
    expect(makeRoom).not.toHaveBeenCalled();
  });

  it("copy for the other two mints and for a non-quota refusal never claims anything was saved", () => {
    for (const noun of ["copy", "plan", "site"]) for (const reason of ["quota", "SecurityError"]) {
      const m = mintRefusedMessage(noun, reason);
      expect(m).toMatch(/^Couldn't /); expect(m).toMatch(/nothing was saved/); expect(m).not.toMatch(/saved on this device|sync/i);
    }
    expect(saveRefusedMessage("The plan rename", "quota")).toMatch(/nothing was changed/);
  });
});

describe("pushSiteToCloud 'missing' is its own kind", () => {
  it("keeps the 'missing' string, and describePushFailure says the plan is not on this device, with no cloud retry", () => {
    expect(PUSH_MISSING).toBe("missing");
    const d = describePushFailure("The duplicated plan", "missing");
    expect(d).toMatchObject({ kind: "missing", retryable: false, record: false });
    expect(d.text).not.toMatch(/saved on this device/i);
    expect(d.text).toMatch(/not on this device/);
    const c = describePushFailure("The duplicated plan", "network down");
    expect(c).toMatchObject({ kind: "cloud", retryable: true, record: true });
    expect(c.text).toMatch(/saved on this device but couldn't sync to the cloud/);
  });
  it("signed out, pushSiteToCloud is a no-op (the 'missing' answer only exists signed in)", async () => {
    expect(await pushSiteToCloud("nope")).toMatchObject({ ok: true, skipped: true });
  });
});

describe("the call sites (source guard — SitePlannerApp.jsx cannot be mounted under Node)", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlannerApp.jsx", import.meta.url), "utf8");
  const body = (name) => { const i = src.indexOf(`const ${name} = async`); expect(i, name).toBeGreaterThan(-1); return src.slice(i, i + 2600); };
  it.each(["duplicatePlan", "newPlanSameParcel"])("%s mints through runMint, stops on a refusal, and navigates only via goPlanChecked", (name) => {
    const b = body(name);
    expect(b).toMatch(/mintSave\(/);
    expect(b).toMatch(/if \(!mint\.ok\)/);
    expect(b.indexOf("if (!mint.ok)")).toBeLessThan(b.indexOf("pushLoud("));
    expect(b.indexOf("if (!mint.ok)")).toBeLessThan(b.indexOf("goPlanChecked("));
    expect(b).not.toMatch(/\bgoPlan\(id\)/);
  });
  it("newSiteFromMap stops on a refusal before it pushes or navigates", () => {
    const i = src.indexOf("const newSiteFromMap = async"); const b = src.slice(i, i + 4200);
    expect(b.indexOf("if (!mint.ok)")).toBeGreaterThan(-1);
    expect(b.indexOf("if (!mint.ok)")).toBeLessThan(b.indexOf("pushLoud("));
    expect(b).toMatch(/goPlanChecked\(id, "newSiteFromMap"\)/);
  });
  it("goPlanChecked refuses an id with no record and reports it; newBlankSite keeps plain goPlan (a lazy blank has no record by design)", () => {
    expect(src).toMatch(/goplan-refused-missing/);
    const i = src.indexOf("const newBlankSite = async"); const b = src.slice(i, i + 2400);
    expect(b).toMatch(/\bgoPlan\(id\)/);
  });
  it("pushLoud's 'missing' branch neither records the failure for replay nor says 'saved on this device'", () => {
    const i = src.indexOf("const pushLoud = async"); const b = src.slice(i, i + 2200);
    const miss = b.slice(b.indexOf('why.kind === "missing"'), b.indexOf("recordCloudWriteFailure"));
    expect(miss).toMatch(/return false/);
    expect(miss).not.toMatch(/recordCloudWriteFailure/);
  });
});
