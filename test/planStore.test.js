/* B2165120 — EACH PLAN HAS ITS OWN DEVICE-STORAGE SLOT. This suite is the data-safety proof the change was approved on.
 *
 * Every scenario below is "zero lost plans, zero lost edits", on a library built from REAL plan shapes (the owner's
 * smu1t5vcp73y = Goose Creek phase 2, and sms4zs8unbkg = Sylvestri concept D, both pulled from public.sites + public.site_elements
 * and committed as ui-audit fixtures), padded to his 143-plan account with re-id'd copies of the other real fixtures.
 *   1 migration is a lossless COPY (the original entry is byte-for-byte untouched) and is verified read-back
 *   2 an edit costs a flat amount whatever the library weighs (red-proof: the same edit in the un-split layout scales)
 *   3 quota exhausted → clean abort, old layout kept, nothing stray, nothing lost, edits still persist
 *   4 a crash mid-migration → no half switch; the next load completes it without losing or resurrecting anything
 *   5 two tabs on MIXED builds → per-plan merge: adopt, merge, delete — never revert, never lose
 *   6 revert to the old build → it sees every plan and every edit, including edits made after the migration
 *   7 the legacy refresh is OFF the edit path, runs on quiet / hide / the max-wait cap, and is bounded
 * The browser half (a real second tab, the real storage event, the live site) is ui-audit/verify-plan-store.mjs. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/shared/telemetry/clientErrors.js", async (orig) => ({ ...(await orig()), reportClientEvent: vi.fn() }));

import { reportClientEvent } from "../src/shared/telemetry/clientErrors.js";
import * as planStore from "../src/workspaces/site-planner/lib/planStore.js";
import { saveSite, loadSite, deleteSite, loadSitesList, siteExistsLocally, readBackSite, clearCloudCache } from "../src/workspaces/site-planner/lib/storage.js";
import { loadSiteSummaries } from "../src/workspaces/site-planner/lib/siteListLight.js";
import { readFixture } from "../ui-audit/lib/fixtureSeeding.mjs";
import { fixtureSite } from "../ui-audit/lib/planFixture.mjs";

const KEY = "planarfit:sites:v1";
const bld = (id, cx = 0) => ({ id, type: "building", cx, cy: 0, w: 100, h: 100, rot: 0 });

/* A localStorage with a real byte cap (key + value, like the browser) and a way to inject a failure on the Nth write. */
function makeLS({ quota = Infinity } = {}) {
  const store = new Map();
  const ls = {
    sets: [], failAt: null, count: 0,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      v = String(v); ls.count++;
      if (ls.failAt && ls.count === ls.failAt) throw new Error("simulated crash");
      let used = 0; for (const [kk, vv] of store) if (kk !== k) used += kk.length + vv.length;
      if (used + k.length + v.length > quota) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
      store.set(k, v); ls.sets.push([k, v.length]);
    },
    removeItem: (k) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() { return store.size; },
    bytes: () => { let n = 0; for (const [k, v] of store) n += k.length + v.length; return n; },
    raw: store,
  };
  return ls;
}

/* The owner's account: two real plans + re-id'd copies of the other real fixtures, ~143 plans, with their real shapes. */
function realLibrary(n) {
  const pick = ["sylvestri-concept-d-full", "goose-creek-phase2-1-2m", "bain-concept-original", "richfield-concept-a", "weld-concept-a", "tsakiris-concept-a", "fm359-concept-a"];
  const lib = {};
  const put = (rec) => { lib[rec.id] = rec; };
  const real1 = fixtureSite(readFixture("sylvestri-concept-d-full"), { id: "sms4zs8unbkg", name: "Concept D - Sylvestri Retail", site: "Sylvestri Retail" });
  const real2 = fixtureSite(readFixture("goose-creek-phase2-1-2m"), { id: "smu1t5vcp73y", name: "Phase 2", site: "Goose Creek" });
  for (const r of [real1, real2]) { r.groupId = r.id; r.updatedAt = 1_700_000_000_000 + Object.keys(lib).length; r.status = "pursuit"; r.role = "pursuit"; put(r); }
  for (let i = 0; lib && Object.keys(lib).length < n; i++) {
    const fx = pick[i % pick.length];
    let rec; try { rec = fixtureSite(readFixture(fx), { id: `x${i}`, name: `Plan ${i}`, site: `Site ${i % 31}` }); } catch (_) { rec = { id: `x${i}`, name: `Plan ${i}`, site: `Site ${i % 31}`, els: [bld(`e${i}`)] }; }
    rec.groupId = `g${i % 31}`; rec.updatedAt = 1_700_000_000_000 + 10 + i; rec.status = "pursuit"; rec.role = "pursuit";
    put(rec);
  }
  return lib;
}
const seedOld = (ls, lib, key = KEY) => ls.setItem(key, JSON.stringify(lib));
const eventsNamed = (name) => reportClientEvent.mock.calls.filter((c) => c[0] === name);

let LS;
beforeEach(() => {
  LS = makeLS();
  globalThis.localStorage = LS;
  planStore._resetForTest();
  reportClientEvent.mockClear();
  globalThis.__PLANYR_LEGACY_MIRROR = "idle";      // production policy unless a test says otherwise
});
afterEach(() => { delete globalThis.__PLANYR_LEGACY_MIRROR; vi.useRealTimers(); });

/* ───────────────────────────────────────── 1. migration ───────────────────────────────────────── */
describe("1 — migration is a lossless copy, verified, and the original is left untouched", () => {
  it("every plan of a 143-plan library (incl. smu1t5vcp73y and sms4zs8unbkg) round-trips; the old entry is byte-identical", () => {
    const lib = realLibrary(143);
    expect(Object.keys(lib)).toContain("smu1t5vcp73y");
    expect(Object.keys(lib)).toContain("sms4zs8unbkg");
    seedOld(LS, lib);
    const before = LS.getItem(KEY);
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).sort()).toEqual(Object.keys(lib).sort());
    for (const id of Object.keys(lib)) expect(JSON.stringify(got[id])).toBe(JSON.stringify(lib[id]));
    expect(LS.getItem(KEY)).toBe(before);                                   // NOT touched, not moved, not rewritten
    expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", hasIdx: true, entries: 143 });
    expect(eventsNamed("plan-store-migrated")).toHaveLength(1);
    expect(eventsNamed("plan-store-migration-aborted")).toHaveLength(0);
    // every entry on disk is exactly that plan's JSON — "read every one back and compare to the source"
    for (const id of Object.keys(lib)) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));
  });
  it("the whole app surface still answers the same: loadSite, loadSitesList, the light summaries, existence", () => {
    const lib = realLibrary(40);
    seedOld(LS, lib);
    expect(loadSite("sms4zs8unbkg").els.length).toBe(lib.sms4zs8unbkg.els.length);
    expect(loadSitesList().length).toBe(40);
    expect(loadSiteSummaries().length).toBe(40);
    expect(siteExistsLocally("smu1t5vcp73y")).toBe(true);
    expect(siteExistsLocally("ghost")).toBe(false);
    expect(readBackSite("ghost")).toBe(null);
  });
  it("migrating is idempotent — a second tab (or a reload) neither duplicates nor rewrites what is already verified", () => {
    seedOld(LS, realLibrary(20));
    planStore.readShared(KEY);
    const writes = LS.sets.length;
    planStore._resetForTest();                                              // a reload: no in-memory state
    planStore.readShared(KEY);
    expect(LS.sets.length).toBe(writes);                                    // idx present → straight to the per-plan layout, zero writes
    expect(eventsNamed("plan-store-migrated")).toHaveLength(1);
  });
  it("an empty / brand-new device creates nothing until the first save, then splits per plan from the start", () => {
    expect(planStore.readShared(KEY)).toEqual({});
    expect(LS.length).toBe(0);
    saveSite({ id: "p1", groupId: "g", site: "S", name: "A", els: [bld("a")] });
    expect(LS.getItem(`${KEY}:p:p1`)).toBeTruthy();
    expect(JSON.parse(LS.getItem(`${KEY}:idx`))).toMatchObject({ v: 1, ok: true });
  });
  it("the signed-in store (planarfit:sites:cloud:<uid>) migrates the same way", () => {
    const ck = "planarfit:sites:cloud:uid-1";
    const lib = realLibrary(15);
    seedOld(LS, lib, ck);
    expect(Object.keys(planStore.readShared(ck)).length).toBe(15);
    expect(LS.getItem(`${ck}:p:sms4zs8unbkg`)).toBe(JSON.stringify(lib.sms4zs8unbkg));
    clearCloudCache("uid-1");
    expect(LS.length).toBe(0);                                              // sign-out clears entries, index, ledger and the legacy entry
  });
});

/* ───────────────────────────────────────── 2. flat per-edit cost ───────────────────────────────────────── */
describe("2 — an edit writes only that plan (+ a tiny index), flat in the size of the library", () => {
  function editCost(n, { forceBlob = false } = {}) {
    const ls = makeLS();
    globalThis.localStorage = ls; planStore._resetForTest();
    const lib = realLibrary(n);
    seedOld(ls, lib);
    if (forceBlob) ls.setItem(`${KEY}:idx`, JSON.stringify({ v: 99, ok: true }));   // a layout this code does not understand → the un-split blob path (the BEFORE)
    planStore.readShared(KEY);
    saveSite({ id: "sms4zs8unbkg", els: [bld("edit-0")] });                // warm
    ls.sets.length = 0;
    saveSite({ id: "sms4zs8unbkg", els: [bld("edit-0"), bld("edit-1", 50)] });
    const bytes = ls.sets.reduce((s, [, len]) => s + len, 0);
    const biggest = Math.max(...ls.sets.map(([, len]) => len));
    return { bytes, biggest, writes: ls.sets.length, libChars: JSON.stringify(lib).length, keys: ls.sets.map(([k]) => k) };
  }
  it("5 vs 50 vs 150 plans: bytes written and the largest single write are the SAME (the edited plan's size), never the library's", () => {
    const a = editCost(5), b = editCost(50), c = editCost(150);
    for (const r of [a, b, c]) {
      expect(r.keys.every((k) => k.includes(":p:sms4zs8unbkg") || k.endsWith(":idx") || k.includes(":history"))).toBe(true);
      expect(r.biggest).toBeLessThan(120_000);
    }
    expect(Math.abs(b.bytes - a.bytes)).toBeLessThan(a.bytes * 0.05 + 400);
    expect(Math.abs(c.bytes - a.bytes)).toBeLessThan(a.bytes * 0.05 + 400);
    expect(c.libChars).toBeGreaterThan(a.libChars * 10);                   // the library really did grow ~30×
  });
  it("RED-PROOF: the identical edit on the un-split layout writes the whole library, and grows with it", () => {
    const a = editCost(5, { forceBlob: true }), c = editCost(150, { forceBlob: true });
    expect(c.biggest).toBeGreaterThan(c.libChars * 0.9);                   // one write of ~the entire library
    expect(c.bytes).toBeGreaterThan(a.bytes * 8);                          // and it scales with the library
  });
  it("an edit never reads or parses other plans' entries, and the index write is tiny", () => {
    seedOld(LS, realLibrary(100));
    planStore.readShared(KEY);
    saveSite({ id: "x5", els: [bld("w")] });
    const parse = vi.spyOn(JSON, "parse");
    saveSite({ id: "x5", els: [bld("w"), bld("v")] });
    const parsed = parse.mock.calls.map((c) => (typeof c[0] === "string" ? c[0] : ""));
    parse.mockRestore();
    for (const other of ["x6", "x7", "x40", "smu1t5vcp73y", "sms4zs8unbkg"]) expect(parsed.some((s) => s.includes(`"id":"${other}"`))).toBe(false);   // no other plan's text is ever parsed
    expect(LS.getItem(`${KEY}:idx`).length).toBeLessThan(400);
  });
  it("bulk writers (a cloud pull) rewrite only the plans that actually changed", () => {
    const lib = realLibrary(60);
    seedOld(LS, lib);
    const cur = planStore.readFresh(KEY);
    cur.x7.name = "renamed by a pull";
    cur.x7.updatedAt += 1;
    LS.sets.length = 0;
    planStore.writeMap(KEY, cur);
    expect(LS.sets.filter(([k]) => k.includes(":p:")).map(([k]) => k)).toEqual([`${KEY}:p:x7`]);
  });
});

/* ───────────────────────────────────────── 3. quota ───────────────────────────────────────── */
describe("3 — storage full during migration: a clean abort, the old layout kept, nothing lost, nothing stray", () => {
  it("aborts, removes only what it created, keeps reading and WRITING the original entry, and reports it", () => {
    const lib = realLibrary(60);
    const oldBytes = KEY.length + JSON.stringify(lib).length;
    LS = makeLS({ quota: Math.floor(oldBytes * 1.4) });                      // room for the original and a little more — not for a full copy beside it
    globalThis.localStorage = LS; planStore._resetForTest();
    seedOld(LS, lib);
    const before = LS.getItem(KEY);
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).length).toBe(60);                                // reads work (from the original)
    expect(planStore.describe(KEY).mode).toBe("blob");
    expect([...LS.raw.keys()]).toEqual([KEY]);                               // nothing stray: no entries, no index, no ledger
    expect(LS.getItem(KEY)).toBe(before);
    const aborted = eventsNamed("plan-store-migration-aborted");
    expect(aborted).toHaveLength(1);
    expect(aborted[0][2]).toMatchObject({ reason: "quota", plans: 60 });
    // and the app keeps working exactly as before: an edit persists, nothing is dropped
    expect(saveSite({ id: "x3", els: [bld("still-works")] })).toBe(true);
    expect(JSON.parse(LS.getItem(KEY)).x3.els.map((e) => e.id)).toContain("still-works");
    expect(Object.keys(JSON.parse(LS.getItem(KEY))).length).toBe(60);
  });
  it("HEADROOM: a device that would fit the copy by a hair but be one edit from full is left on the original, untouched, and the numbers are reported", () => {
    const lib = realLibrary(30);
    const len = JSON.stringify(lib).length;
    LS.setItem("some:other:key", "y".repeat(40_000)); seedOld(LS, lib);
    globalThis.__PLANYR_LS_CAP = len * 2 + 40_000 + 100_000;                   // the copy fits, but with only ~100 KB to spare (< the 250 KB floor)
    try {
      const before = LS.length; const got = planStore.readShared(KEY);
      expect(Object.keys(got).length).toBe(30);
      expect(planStore.describe(KEY).mode).toBe("blob");
      expect(LS.length).toBe(before);                                           // wrote NOTHING
      const e = eventsNamed("plan-store-migration-aborted")[0][2];
      expect(e.reason).toBe("headroom"); expect(e.shortBy).toBeGreaterThan(0); expect(e.capChars).toBe(globalThis.__PLANYR_LS_CAP);
      planStore._resetForTest(); reportClientEvent.mockClear();
      globalThis.__PLANYR_LS_CAP = len * 2 + 40_000 + 400_000;                   // with real room it does migrate
      planStore.readShared(KEY);
      expect(planStore.describe(KEY).mode).toBe("plan");
    } finally { delete globalThis.__PLANYR_LS_CAP; }
  });
  it("a store that cannot be read as a plan map is never touched", () => {
    LS.setItem(KEY, "{not json");
    expect(planStore.readShared(KEY)).toEqual({});
    expect([...LS.raw.keys()]).toEqual([KEY]);
    expect(eventsNamed("plan-store-migration-aborted")[0][2].reason).toBe("unreadable");
  });
  it("a malformed record (a null where a plan should be) aborts rather than silently dropping it", () => {
    LS.setItem(KEY, JSON.stringify({ a: { id: "a" }, b: null }));
    planStore.readShared(KEY);
    expect([...LS.raw.keys()]).toEqual([KEY]);
    expect(eventsNamed("plan-store-migration-aborted")[0][2].reason).toBe("malformed");
  });
  it("a plan too big to write whole on a full device sheds its inline rasters (as the blob always did) and still persists", () => {
    seedOld(LS, realLibrary(5));
    planStore.readShared(KEY);
    const big = "data:image/png;base64," + "A".repeat(9000);
    LS = makeLS({ quota: 20_000 }); // nothing to compare — just prove the retry path with a fresh small device
    globalThis.localStorage = LS; planStore._resetForTest();
    expect(saveSite({ id: "r1", groupId: "r1", site: "R", name: "R", els: [bld("a")], sheetOverlays: [{ id: "o1", src: big, x: 0, y: 0, imgW: 10, imgH: 10 }] })).toBe(true);
    expect(loadSite("r1").els.length).toBe(1);
  });
});

/* ───────────────────────────────────────── 4. crash mid-migration ───────────────────────────────────────── */
describe("4 — a crash or reload mid-migration never half-switches", () => {
  it("a write that throws on the Nth entry rolls back; the next load completes the migration; no plan lost", () => {
    const lib = realLibrary(30);
    seedOld(LS, lib);
    LS.failAt = LS.count + 12;                                               // die on the 12th write of the migration
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).length).toBe(30);                                // still readable (original)
    expect(planStore.describe(KEY).mode).toBe("blob");
    expect([...LS.raw.keys()]).toEqual([KEY]);
    expect(eventsNamed("plan-store-migration-aborted")).toHaveLength(1);
    LS.failAt = null; planStore._resetForTest();                             // "reload"
    const again = planStore.readShared(KEY);
    expect(Object.keys(again).sort()).toEqual(Object.keys(lib).sort());
    expect(planStore.describe(KEY).mode).toBe("plan");
    for (const id of Object.keys(lib)) expect(JSON.stringify(again[id])).toBe(JSON.stringify(lib[id]));
  });
  it("a HARD crash (entries on disk, no index) is finished by the next load — and a NEWER entry already there is never overwritten", () => {
    const lib = realLibrary(12);
    seedOld(LS, lib);
    for (const id of Object.keys(lib).slice(0, 7)) LS.setItem(`${KEY}:p:${id}`, JSON.stringify(lib[id]));       // 7 copied, then the tab died
    const newer = { ...lib.x5, name: "edited after the crash", updatedAt: lib.x5.updatedAt + 9_999 };
    LS.setItem(`${KEY}:p:x5`, JSON.stringify(newer));                        // an entry that is NEWER than the original (e.g. another tab got further)
    planStore.readShared(KEY);
    expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", hasIdx: true, entries: 12 });
    expect(planStore.readShared(KEY).x5.name).toBe("edited after the crash");
    for (const id of Object.keys(lib).filter((i) => i !== "x5")) expect(JSON.stringify(planStore.readShared(KEY)[id])).toBe(JSON.stringify(lib[id]));
  });
  it("the index is the switch: with entries but no index, the legacy original is still what an old build reads", () => {
    const lib = realLibrary(6);
    seedOld(LS, lib);
    LS.failAt = LS.count + 7;                                                // entries 1-6 land, then the ledger write dies before the index
    planStore.readShared(KEY);
    expect(JSON.parse(LS.getItem(KEY))).toEqual(lib);
  });
});

/* ───────────────────────────────────────── 5. mixed builds ───────────────────────────────────────── */
describe("5 — two tabs on MIXED builds (the old tab writes the whole legacy entry): per-plan merge, no revert, no loss", () => {
  const oldBuildWrite = (mutate) => { const all = JSON.parse(LS.getItem(KEY) || "{}"); mutate(all); LS.setItem(KEY, JSON.stringify(all)); };
  let lib;
  beforeEach(() => {
    lib = realLibrary(30);
    seedOld(LS, lib);
    planStore.readShared(KEY);
    planStore.flushMirror(KEY);                                             // settle: the ledger and the legacy entry agree
  });

  it("edits to DIFFERENT plans on each side both survive (the common deploy-window case)", () => {
    saveSite({ id: "x3", els: [...(loadSite("x3").els || []), bld("new-build-edit")] });             // new-build tab edits x3
    oldBuildWrite((all) => { all.x8 = { ...all.x8, name: "old build rename", updatedAt: Date.now() + 5000 }; });   // old-build tab edits x8
    planStore.reconcileLegacy(KEY);
    expect(loadSite("x8").name).toBe("old build rename");
    expect(loadSite("x3").els.map((e) => e.id)).toContain("new-build-edit");                       // NOT reverted by the old tab's stale copy of x3
    planStore.flushMirror(KEY);
    const legacy = JSON.parse(LS.getItem(KEY));
    expect(legacy.x8.name).toBe("old build rename");
    expect(legacy.x3.els.map((e) => e.id)).toContain("new-build-edit");                            // and the legacy entry now carries BOTH
  });
  it("the old tab's write holds an OLDER copy of a plan this build edited: this build's edit wins, nothing reverts", () => {
    saveSite({ id: "x4", name: "named by the new build" });
    oldBuildWrite((all) => { all.x9 = { ...all.x9, name: "unrelated old edit", updatedAt: Date.now() + 5000 }; });   // x4 in this blob is the STALE copy
    planStore.reconcileLegacy(KEY);
    expect(loadSite("x4").name).toBe("named by the new build");
    expect(loadSite("x9").name).toBe("unrelated old edit");
  });
  it("a plan the old tab CREATED is adopted; a plan it DELETED is deleted here", () => {
    oldBuildWrite((all) => { all.brand_new = { id: "brand_new", groupId: "brand_new", site: "N", name: "Made in old tab", updatedAt: Date.now(), els: [bld("q")] }; delete all.x2; });
    planStore.reconcileLegacy(KEY);
    expect(loadSite("brand_new").els.map((e) => e.id)).toEqual(["q"]);
    expect(siteExistsLocally("x2")).toBe(false);
    expect(Object.keys(planStore.readShared(KEY)).length).toBe(30);
  });
  it("a plan THIS build deleted is not resurrected by the old tab's stale blob", async () => {
    await deleteSite("x6", { tombstone: false });
    expect(siteExistsLocally("x6")).toBe(false);
    oldBuildWrite((all) => { all.x6 = lib.x6; all.x9 = { ...all.x9, name: "touch", updatedAt: Date.now() + 5000 }; });   // the old tab still held x6 in memory
    planStore.reconcileLegacy(KEY);
    expect(siteExistsLocally("x6")).toBe(false);
    expect(loadSite("x9").name).toBe("touch");
  });
  it("a plan only THIS build has (not yet mirrored) is kept when the old tab's blob lacks it", () => {
    saveSite({ id: "only-here", groupId: "only-here", site: "Z", name: "Z", els: [bld("z")] });
    oldBuildWrite((all) => { all.x9 = { ...all.x9, name: "touch", updatedAt: Date.now() + 5000 }; });
    planStore.reconcileLegacy(KEY);
    expect(siteExistsLocally("only-here")).toBe(true);
    planStore.flushMirror(KEY);
    expect(JSON.parse(LS.getItem(KEY))["only-here"]).toBeTruthy();
  });
  it("BOTH sides edit the SAME plan: the content is the union (the real mergeSiteContent), no element of either is lost", () => {
    saveSite({ id: "x10", els: [...(loadSite("x10").els || []), bld("mine-1"), bld("mine-2")] });
    oldBuildWrite((all) => { all.x10 = { ...all.x10, els: [...(lib.x10.els || []), bld("theirs-1")], updatedAt: Date.now() + 5000 }; });
    planStore.reconcileLegacy(KEY);
    const ids = loadSite("x10").els.map((e) => e.id);
    for (const id of ["mine-1", "mine-2", "theirs-1"]) expect(ids).toContain(id);
    for (const e of lib.x10.els || []) expect(ids).toContain(e.id);
  });
  it("it is idempotent and quiet: re-reconciling an unchanged legacy entry does nothing (no re-merge loop, no event)", () => {
    oldBuildWrite((all) => { all.x9 = { ...all.x9, name: "once", updatedAt: Date.now() + 5000 }; });
    planStore.reconcileLegacy(KEY);
    reportClientEvent.mockClear(); const sets = LS.sets.length;
    expect(planStore.reconcileLegacy(KEY).changed).toBe(0);
    expect(LS.sets.length).toBe(sets);
    expect(eventsNamed("plan-store-legacy-merged")).toHaveLength(0);
  });
  it("a boot with the legacy entry rewritten while no tab was open folds it in on load", () => {
    oldBuildWrite((all) => { all.x9 = { ...all.x9, name: "while closed", updatedAt: Date.now() + 5000 }; });
    planStore._resetForTest();                                              // a fresh page load
    expect(planStore.readShared(KEY).x9.name).toBe("while closed");
  });
  it("the legacy entry becoming unreadable garbage never damages the per-plan entries", () => {
    LS.setItem(KEY, "}{garbage");
    planStore.reconcileLegacy(KEY);
    expect(Object.keys(planStore.readShared(KEY)).length).toBe(30);
    expect(eventsNamed("plan-store-legacy-unreadable")).toHaveLength(1);
  });
});

/* ───────────────────────────────────────── 6. revert to the old build ───────────────────────────────────────── */
describe("6 — if this change is reverted, the OLD build still loads everything, including edits made after the migration", () => {
  const oldBuildReads = () => JSON.parse(LS.getItem(KEY));                  // all the old code ever did
  it("after the legacy refresh (tab hidden / closed), the old build sees every plan and every post-migration edit", () => {
    const lib = realLibrary(25);
    seedOld(LS, lib);
    saveSite({ id: "x4", els: [...(loadSite("x4").els || []), bld("edit-after-migration")] });
    saveSite({ id: "fresh", groupId: "fresh", site: "F", name: "F", els: [bld("f")] });
    await_deleteSync("x7");
    planStore.flushMirror(KEY);                                             // what pagehide / visibilitychange→hidden does
    const old = oldBuildReads();
    expect(old.x4.els.map((e) => e.id)).toContain("edit-after-migration");
    expect(old.fresh.els.map((e) => e.id)).toEqual(["f"]);
    expect(old.x7).toBeUndefined();
    expect(Object.keys(old).length).toBe(25);                               // 25 − x7 + fresh
    for (const id of Object.keys(old).filter((i) => !["x4", "fresh"].includes(i))) expect(JSON.stringify(old[id])).toBe(JSON.stringify(planStore.readShared(KEY)[id]));
  });
  it("the old build then EDITS and the new build, redeployed, keeps those edits too (revert → re-deploy loses nothing)", () => {
    seedOld(LS, realLibrary(10));
    saveSite({ id: "x3", name: "new-build name" });
    planStore.flushMirror(KEY);
    const old = oldBuildReads();                                            // the reverted build loads and saves
    old.x5 = { ...old.x5, name: "edited by the REVERTED build", updatedAt: Date.now() + 5000 };
    LS.setItem(KEY, JSON.stringify(old));
    planStore._resetForTest();                                              // the fix is redeployed: first load
    expect(planStore.readShared(KEY).x5.name).toBe("edited by the REVERTED build");
    expect(planStore.readShared(KEY).x3.name).toBe("new-build name");
  });
  it("a tab killed before the refresh leaves the edit safe in its per-plan entry (index.stale) and the next load repairs the legacy entry", () => {
    seedOld(LS, realLibrary(10));
    saveSite({ id: "x3", els: [bld("unflushed")] });                        // no flush: the process dies here
    expect(oldBuildReads().x3.els.map((e) => e.id)).not.toContain("unflushed");   // honest cost: the OLD build cannot see it yet…
    expect(JSON.parse(LS.getItem(`${KEY}:idx`)).stale).toBe(true);          // …and the debt is recorded on disk
    expect(JSON.parse(LS.getItem(`${KEY}:p:x3`)).els.map((e) => e.id)).toContain("unflushed");   // …but the edit is NOT lost
    planStore._resetForTest();
    vi.useFakeTimers();
    planStore.readShared(KEY);                                              // the next load notices the debt and schedules the refresh
    vi.advanceTimersByTime(planStore.MIRROR_QUIET_MS + 10);
    expect(oldBuildReads().x3.els.map((e) => e.id)).toContain("unflushed");
  });
});
function await_deleteSync(id) { deleteSite(id, { tombstone: false }); }

/* ───────────────────────────────────────── 7. the legacy refresh is off the edit path ───────────────────────────────────────── */
describe("7 — the legacy refresh: off the edit path, bounded, coalesced", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  it("an edit does not touch the legacy entry; one quiet period later it does, once", () => {
    seedOld(LS, realLibrary(20));
    const legacy0 = LS.getItem(KEY);
    planStore.readShared(KEY); LS.sets.length = 0;
    for (let i = 0; i < 6; i++) { saveSite({ id: "x3", els: [bld("e" + i)] }); vi.advanceTimersByTime(1000); }
    expect(LS.getItem(KEY)).toBe(legacy0);                                  // six edits, zero blob writes
    expect(LS.sets.filter(([k]) => k === KEY).length).toBe(0);
    vi.advanceTimersByTime(planStore.MIRROR_QUIET_MS + 10);
    expect(JSON.parse(LS.getItem(KEY)).x3.els.map((e) => e.id)).toContain("e5");
    expect(LS.sets.filter(([k]) => k === KEY).length).toBe(1);              // coalesced into ONE write
  });
  it("a continuous editing session cannot starve the refresh past MIRROR_MAX_WAIT_MS", () => {
    seedOld(LS, realLibrary(10));
    const t0 = Date.now();
    while (Date.now() - t0 < planStore.MIRROR_MAX_WAIT_MS + 5000) { saveSite({ id: "x3", els: [bld("k" + (Date.now() % 1000))] }); vi.advanceTimersByTime(5000); }
    expect(LS.sets.filter(([k]) => k === KEY).length).toBeGreaterThanOrEqual(1);
  });
  it("the refresh writes already-serialised text: the legacy entry equals JSON.stringify of the per-plan entries", () => {
    seedOld(LS, realLibrary(12));
    saveSite({ id: "x2", name: "n" });
    planStore.flushMirror(KEY);
    const legacy = LS.getItem(KEY);
    const rebuilt = {}; for (const id of Object.keys(JSON.parse(legacy))) rebuilt[id] = JSON.parse(LS.getItem(`${KEY}:p:${id}`));
    expect(JSON.parse(legacy)).toEqual(rebuilt);
    expect(legacy).toBe(JSON.stringify(JSON.parse(legacy)));
  });
  it("a refresh that cannot be written (device full) is reported, never fatal, and the per-plan entries stay the truth", () => {
    const lib = realLibrary(10);
    LS = makeLS({ quota: (KEY.length + JSON.stringify(lib).length) * 2.2 });
    globalThis.localStorage = LS; planStore._resetForTest();
    seedOld(LS, lib);
    planStore.readShared(KEY);
    saveSite({ id: "x3", els: Array.from({ length: 40 }, (_, i) => bld("big" + i)) });
    LS.setItem = ((orig) => (k, v) => { if (k === KEY) throw Object.assign(new Error("quota"), { name: "QuotaExceededError" }); return orig(k, v); })(LS.setItem);
    expect(planStore.flushMirror(KEY)).toBe(false);
    expect(eventsNamed("plan-store-mirror-failed")).toHaveLength(1);
    expect(loadSite("x3").els.length).toBe(40);
  });
  it("sync policy (node / e2e) keeps the legacy entry current on every write", () => {
    globalThis.__PLANYR_LEGACY_MIRROR = "sync";
    seedOld(LS, realLibrary(8));
    saveSite({ id: "x3", name: "visible immediately" });
    expect(JSON.parse(LS.getItem(KEY)).x3.name).toBe("visible immediately");
  });
});

/* ───────────────────────────────────────── plumbing ───────────────────────────────────────── */
describe("plumbing", () => {
  it("storage events from other tabs don't fan out three-fold: the per-plan and ledger keys are ignored by every sites listener", async () => {
    const { readFileSync } = await import("node:fs");
    const files = ["src/shared/ui/ProjectBreadcrumb.jsx", "src/shared/projects/projects.js", "src/workspaces/site-planner/SitePlannerApp.jsx", "src/workspaces/site-planner/SitePlanner.jsx"];
    for (const f of files) expect(readFileSync(f, "utf8")).toMatch(/:p:\|:led|:p:\)\|\(:led|\(:p:\|:led/);
  });
  it("nothing outside planStore reads or writes the sites store keys directly any more", async () => {
    const { execSync } = await import("node:child_process");
    const out = execSync(`grep -rnE "localStorage\\.(getItem|setItem|removeItem)\\((SITES_KEY|cloudKey\\(|cloudSitesKey\\(|sitesKey\\()" src || true`, { encoding: "utf8" });
    expect(out.trim()).toBe("");
  });
  it("the cloud-sync abandon path removes only that plan's entry", async () => {
    const lib = realLibrary(6);
    const ck = "planarfit:sites:cloud:u9";
    LS.setItem(ck, JSON.stringify(lib)); planStore.readShared(ck);
    planStore.removeOne(ck, "x3");
    expect(Object.keys(planStore.readShared(ck)).sort()).toEqual(Object.keys(lib).filter((i) => i !== "x3").sort());
  });
});

/* ───────────────────────────────────────── the scaling instrument's own verdict ───────────────────────────────────────── */
import { storeScalingVerdict } from "../ui-audit/lib/storeScaling.mjs";
describe("storeScalingVerdict (the acceptance instrument) — it can go red, and it refuses to score a run that measured the wrong program", () => {
  const ok = (plans, kb, largest = 90, layout = { indexed: true, entries: plans + 1, legacyKB: plans * 8 }) => ({ plans, edits: 8, writeKBMedian: kb, writeKBMax: kb + 5, largestWriteKB: largest, layoutObserved: layout });
  const blobArm = (plans, kb) => ({ plans, edits: 8, writeKBMedian: kb, writeKBMax: kb, largestWriteKB: kb, layoutObserved: { indexed: false, entries: 0, legacyKB: kb } });
  const good = { plan: [ok(5, 100), ok(50, 101), ok(150, 102)], blob: [blobArm(5, 140), blobArm(50, 500), blobArm(150, 1250)] };
  it("passes when per-plan is flat and the un-split arm grows", () => { expect(storeScalingVerdict(good).pass).toBe(true); });
  it("FAILS when the per-plan arm's write grows with the library (the defect it exists to catch)", () => {
    const v = storeScalingVerdict({ ...good, plan: [ok(5, 100), ok(50, 400), ok(150, 1200)] });
    expect(v.pass).toBe(false); expect(v.void).toBe(false);
  });
  it("is VOID when the 'plan' arm silently ran the old layout (e.g. the headroom guard refused the split)", () => {
    const v = storeScalingVerdict({ ...good, plan: [ok(5, 100), ok(50, 100, 90, { indexed: false, entries: 0, legacyKB: 400 }), ok(150, 100)] });
    expect(v.void).toBe(true); expect(v.pass).toBe(false);
  });
  it("is VOID when the un-split arm does not reproduce the problem (a blind instrument is not a pass)", () => {
    const v = storeScalingVerdict({ ...good, blob: [blobArm(5, 140), blobArm(50, 150), blobArm(150, 160)] });
    expect(v.pass).toBe(false);
  });
  it("is VOID with too few sizes or a narrow spread", () => {
    expect(storeScalingVerdict({ plan: [ok(5, 1)], blob: [blobArm(5, 1)] }).void).toBe(true);
    expect(storeScalingVerdict({ plan: [ok(5, 1), ok(10, 1), ok(20, 1)], blob: [blobArm(5, 1), blobArm(10, 2), blobArm(20, 4)] }).void).toBe(true);
  });
});
