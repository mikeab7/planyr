/* B2165120 / B2200384 — EACH PLAN HAS ITS OWN DEVICE-STORAGE SLOT, AND THERE IS NO WHOLE-LIBRARY COPY. This suite is the data-safety proof.
 *
 * Every scenario below is "zero lost plans, zero lost edits", on a library built from REAL plan shapes (the owner's
 * smu1t5vcp73y = Goose Creek phase 2, and sms4zs8unbkg = Sylvestri concept D, both pulled from public.sites + public.site_elements
 * and committed as ui-audit fixtures), padded to his 143-plan account with re-id'd copies of the other real fixtures.
 *   1 the move is a lossless, read-back-verified copy; the legacy entry is removed afterwards and the freed room is reported
 *   2 an edit costs a flat amount whatever the library weighs (red-proof: the same edit in the un-split layout scales)
 *   3 a device the previous build split: the legacy entry goes only after every plan reads back; nothing is ever deleted for its absence
 *   4 a device with no room for a second copy moves PLAN BY PLAN (peak extra room = one entry), survives a crash, resumes
 *   5 an older tab that writes the legacy entry after retirement is folded in per plan (adopt / merge / keep) and removed — one way
 *   6 a revert to the old build is no longer supported (the one B2165120 rule this item deliberately ends)
 * The browser half (a real second tab, the real storage event, a real filled localStorage, the live site) is ui-audit/verify-plan-store.mjs. */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../src/shared/telemetry/clientErrors.js", async (orig) => ({ ...(await orig()), reportClientEvent: vi.fn() }));

import { reportClientEvent } from "../src/shared/telemetry/clientErrors.js";
import * as planStore from "../src/workspaces/site-planner/lib/planStore.js";
import { saveSite, loadSite, deleteSite, loadSitesList, siteExistsLocally, readBackSite, clearCloudCache, recordSiteTombstone } from "../src/workspaces/site-planner/lib/storage.js";
import { loadSiteSummaries } from "../src/workspaces/site-planner/lib/siteListLight.js";
import { readFixture } from "../ui-audit/lib/fixtureSeeding.mjs";
import { fixtureSite } from "../ui-audit/lib/planFixture.mjs";

const KEY = "planarfit:sites:v1";
const bld = (id, cx = 0) => ({ id, type: "building", cx, cy: 0, w: 100, h: 100, rot: 0 });

/* A localStorage with a real byte cap (key + value, like the browser) and a way to inject a failure on the Nth write. */
function makeLS({ quota = Infinity } = {}) {
  const store = new Map();
  const ls = {
    sets: [], failAt: null, count: 0, quota, peak: 0,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem(k, v) {
      v = String(v); ls.count++;
      if (ls.failAt && ls.count === ls.failAt) throw new Error("simulated crash");
      let used = 0; for (const [kk, vv] of store) if (kk !== k) used += kk.length + vv.length;
      if (used + k.length + v.length > ls.quota) throw Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });
      store.set(k, v); ls.sets.push([k, v.length]);
      ls.peak = Math.max(ls.peak, used + k.length + v.length);
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
});
afterEach(() => { delete globalThis.__PLANYR_LS_CAP; vi.useRealTimers(); });

/* ───────────────────────────────────────── 1. migration ───────────────────────────────────────── */
describe("1 — the move to one entry per plan is lossless, verified, and leaves NO whole-library copy behind", () => {
  it("every plan of a 143-plan library (incl. smu1t5vcp73y and sms4zs8unbkg) round-trips; the legacy entry is gone and the space it held is reported", () => {
    const lib = realLibrary(143);
    expect(Object.keys(lib)).toContain("smu1t5vcp73y");
    expect(Object.keys(lib)).toContain("sms4zs8unbkg");
    seedOld(LS, lib);
    const legacyLen = KEY.length + LS.getItem(KEY).length;
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).sort()).toEqual(Object.keys(lib).sort());
    for (const id of Object.keys(lib)) expect(JSON.stringify(got[id])).toBe(JSON.stringify(lib[id]));
    expect(LS.getItem(KEY)).toBe(null);                                     // RETIRED: the whole-library copy is gone …
    expect(LS.getItem(KEY + ":led")).toBe(null);
    expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", hasIdx: true, entries: 143, migrating: false });
    expect(planStore.describe(KEY).idx.legacyRetired).toMatch(/^\d{4}-\d\d-\d\dT/);
    const retired = eventsNamed("plan-store-legacy-retired");
    expect(retired).toHaveLength(1);
    expect(retired[0][2]).toMatchObject({ plans: 143, via: "migration" });
    expect(Math.abs(retired[0][2].freedChars - legacyLen)).toBeLessThan(10);   // … and the report says how much room that gave back
    expect(eventsNamed("plan-store-migrated")).toHaveLength(1);
    expect(eventsNamed("plan-store-migration-aborted")).toHaveLength(0);
    for (const id of Object.keys(lib)) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));   // each entry is exactly that plan's JSON
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
  it("migrating is idempotent — a reload neither duplicates nor rewrites what is already verified", () => {
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
    expect(LS.getItem(KEY)).toBe(null);                                     // and never a whole-library entry
  });
  it("the signed-in store (planarfit:sites:cloud:<uid>) migrates the same way", () => {
    const ck = "planarfit:sites:cloud:uid-1";
    const lib = realLibrary(15);
    seedOld(LS, lib, ck);
    expect(Object.keys(planStore.readShared(ck)).length).toBe(15);
    expect(LS.getItem(`${ck}:p:sms4zs8unbkg`)).toBe(JSON.stringify(lib.sms4zs8unbkg));
    expect(LS.getItem(ck)).toBe(null);
    clearCloudCache("uid-1");
    expect(LS.length).toBe(0);                                              // sign-out clears entries and the index
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
});

/* A device exactly as the PREVIOUS build left it: one entry per plan, the index, the ledger, and the legacy entry kept as a mirror. */
function previousBuildDevice(lib, base = KEY, { mirror = lib, led = true } = {}) {
  for (const [id, rec] of Object.entries(lib)) LS.setItem(`${base}:p:${id}`, JSON.stringify(rec));
  LS.setItem(`${base}:idx`, JSON.stringify({ v: 1, ok: true, gen: "g0", stale: false, mig: { at: 1, count: Object.keys(lib).length, len: 1, ms: 1 } }));
  if (mirror) LS.setItem(base, JSON.stringify(mirror));
  if (led) LS.setItem(`${base}:led`, JSON.stringify({ sig: "old:1", len: 1, ids: Object.keys(lib), at: 1 }));
}

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

/* ───────────────────────────────────────── 3. retiring the legacy entry on an already-split device ───────────────────────────────────────── */
describe("3 — a device the previous build split: the whole-library entry is removed only after every plan is read back", () => {
  it("(a) RETIRE: the legacy entry and ledger are gone, freedChars ≈ their length, every plan still reads, the index says when", () => {
    const lib = realLibrary(30);
    previousBuildDevice(lib);
    const legacyLen = KEY.length + LS.getItem(KEY).length + KEY.length + ":led".length + LS.getItem(KEY + ":led").length;
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).sort()).toEqual(Object.keys(lib).sort());
    expect(LS.getItem(KEY)).toBe(null); expect(LS.getItem(KEY + ":led")).toBe(null);
    expect(planStore.describe(KEY).idx.legacyRetired).toBeTruthy();
    const r = eventsNamed("plan-store-legacy-retired");
    expect(r).toHaveLength(1);
    expect(r[0][2]).toMatchObject({ plans: 30, via: "mirror", recovered: 0 });
    expect(Math.abs(r[0][2].freedChars - legacyLen)).toBeLessThan(10);
    expect(eventsNamed("plan-store-legacy-kept")).toHaveLength(0);
    for (const id of Object.keys(lib)) expect(JSON.stringify(got[id])).toBe(JSON.stringify(lib[id]));
  });
  it("(a) a READ-BACK MISMATCH keeps it: an entry that does not read back as itself stops the retirement, and says why", () => {
    const lib = realLibrary(12);
    previousBuildDevice(lib);
    const bad = `${KEY}:p:x5`; let n = 0; const real = LS.getItem;
    LS.getItem = (k) => (k === bad && ++n > 1 ? "{garbage" : real(k));           // reads fine when scanned, garbage when the retirement reads it back
    planStore.readShared(KEY);
    LS.getItem = real;
    expect(LS.getItem(KEY)).not.toBe(null);                                       // KEPT
    const k = eventsNamed("plan-store-legacy-kept");
    expect(k).toHaveLength(1); expect(k[0][2].reason).toBe("entry-readback");
    expect(eventsNamed("plan-store-legacy-retired")).toHaveLength(0);
    for (const id of Object.keys(lib)) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));   // nothing touched
  });
  it("(a) a plan only the legacy entry holds (the entries lost it) is RECOVERED into an entry, never dropped", () => {
    const lib = realLibrary(10);
    previousBuildDevice(lib);
    LS.removeItem(`${KEY}:p:x4`);                                                 // an entry lost / removed by the old ledger inference
    const got = planStore.readShared(KEY);
    expect(Object.keys(got)).toContain("x4");
    expect(LS.getItem(`${KEY}:p:x4`)).toBe(JSON.stringify(lib.x4));
    expect(LS.getItem(KEY)).toBe(null);
    expect(eventsNamed("plan-store-legacy-retired")[0][2]).toMatchObject({ plans: 10, recovered: 1 });
  });
  it("(a) a plan deleted since the mirror (index says so / tombstoned) is NOT resurrected", () => {
    const ck = "planarfit:sites:cloud:uid-9";
    const lib = realLibrary(8);
    previousBuildDevice(lib, ck);
    LS.removeItem(`${ck}:p:x3`); LS.removeItem(`${ck}:p:x5`);
    recordSiteTombstone("uid-9", "x3", Date.now());                              // x3: a durable tombstone says it was deleted here
    LS.setItem(`${ck}:idx`, JSON.stringify({ v: 1, ok: true, gen: "g1", del: ["x5"] }));   // x5: the index remembers it
    const got = planStore.readShared(ck);
    expect(Object.keys(got)).not.toContain("x3"); expect(Object.keys(got)).not.toContain("x5");
    expect(Object.keys(got)).toHaveLength(6);
    expect(LS.getItem(ck)).toBe(null);                                           // and the count still agrees, so it retires
  });
  it("(a) a plan the legacy entry holds MORE RECENTLY than its entry (an older tab's edit) is merged, not lost", () => {
    const lib = realLibrary(6);
    const mirror = { ...lib, x2: { ...lib.x2, name: "edited in an old tab", updatedAt: lib.x2.updatedAt + 50_000 } };
    previousBuildDevice(lib, KEY, { mirror });
    expect(planStore.readShared(KEY).x2.name).toBe("edited in an old tab");
    expect(LS.getItem(KEY)).toBe(null);
    expect(eventsNamed("plan-store-legacy-retired")[0][2].merged).toBe(1);
  });
  it("REGRESSION (production, c5ddcae0, 2026-11): a failing mirror left a ledger listing plans the legacy entry never held — NO ENTRY is deleted for it", () => {
    const lib = realLibrary(30);
    const old = Object.fromEntries(Object.entries(lib).slice(0, 24));              // the last mirror that SUCCEEDED held 24 of the 30 plans
    previousBuildDevice(lib, KEY, { mirror: old });
    LS.setItem(KEY + ":led", JSON.stringify({ sig: "of-the-attempt-that-failed", len: 1, ids: Object.keys(lib), at: 1 }));   // the ledger was written AHEAD of the failed mirror write
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).sort()).toEqual(Object.keys(lib).sort());              // the old reconcile removed the 6 newest here
    expect(LS.length).toBe(30 + 1);                                               // 30 entries + the index, nothing else
  });
  it("(a) K never gets written again: edits, a quiet period and a hidden tab touch no whole-library entry", () => {
    seedOld(LS, realLibrary(20));
    planStore.readShared(KEY);
    LS.sets.length = 0;
    saveSite({ id: "x3", els: [bld("e1")] }); saveSite({ id: "x4", els: [bld("e2")] });
    planStore.writeMap(KEY, { ...planStore.readShared(KEY) });
    expect(LS.sets.some(([k]) => k === KEY || k === KEY + ":led")).toBe(false);
    expect(planStore.flushMirror).toBeUndefined(); expect(planStore.mirrorPolicy).toBeUndefined();   // the mirror is deleted, not disabled
  });
});

/* ───────────────────────────────────────── 4. plan by plan, on a device that cannot hold a second copy ───────────────────────────────────────── */
/* A device filled to the point where the legacy entry plus ONE more plan's entry fit — and not one character more. */
function tightDevice(lib, factor = 1.2, extra = 0) {
  const text = JSON.stringify(lib);
  const maxEntry = Math.max(...Object.values(lib).map((r) => JSON.stringify(r).length + KEY.length + 12));
  const used0 = KEY.length + text.length + extra;
  const ls = makeLS({ quota: used0 + Math.floor(maxEntry * factor) });
  globalThis.__PLANYR_LS_CAP = ls.quota;                                      // what the browser's cap looks like to the app on this device
  if (extra) ls.setItem("filler:other:data", "y".repeat(extra - "filler:other:data".length));
  ls.setItem(KEY, text);
  globalThis.localStorage = ls; planStore._resetForTest();
  return { ls, maxEntry, used0, text };
}
/** The shim's setItem count at which the Nth per-plan ENTRY write happens, found by a dry run of the same migration on an identical device. */
function failAtEntry(lib, n, factor = 3) {
  const { ls } = tightDevice(lib, factor);
  const c0 = ls.count, s0 = ls.sets.length;
  planStore.readShared(KEY); planStore._drainMigration(KEY);
  let seen = 0, pos = -1;
  ls.sets.slice(s0).forEach(([k], i) => { if (pos < 0 && k.includes(":p:") && ++seen === n) pos = i; });
  planStore._resetForTest();
  return c0 + pos + 1;
}
describe("4 — a tight device moves plan by plan: it never needs the library's size again", () => {
  it("(b) 76 plans on a store filled to within one plan of the cap: ALL move, the peak extra room is one plan's entry, nothing is lost", () => {
    const lib = realLibrary(76);
    const { ls, maxEntry, used0 } = tightDevice(lib);
    LS = ls;
    const old = Object.keys(lib);
    // the OLD all-at-once split could not even start here: it needed the whole library again
    expect(ls.quota - used0).toBeLessThan(JSON.stringify(lib).length);
    const got = planStore.readShared(KEY);
    expect(Object.keys(got).sort()).toEqual(old.sort());                        // reads are complete at every moment, mid-move included
    planStore._drainMigration(KEY);
    expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", entries: 76, migrating: false });
    expect(LS.getItem(KEY)).toBe(null);
    for (const id of old) expect(LS.getItem(`${KEY}:p:${id}`)).toBe(JSON.stringify(lib[id]));
    expect(ls.quota - used0).toBeLessThanOrEqual(maxEntry * 1.2 + 1);          // the whole device had room for ONE plan's entry (+20%) beyond the legacy entry …
    expect(ls.peak).toBeLessThanOrEqual(ls.quota);                              // … and the move never needed more
    expect(eventsNamed("plan-store-migrated")[0][2]).toMatchObject({ plans: 76, incremental: true });
    expect(eventsNamed("plan-store-migration-aborted")).toHaveLength(0);
  });
  it("(b) the legacy entry shrinks as plans move, and an entry present beside the legacy copy WINS", () => {
    const lib = realLibrary(20);
    const crashCount = failAtEntry(lib, 8) - 0;
    const { ls } = tightDevice(lib);
    LS = ls;
    ls.failAt = ls.count + (crashCount - 0) - (ls.count - ls.count);             // die on the 8th entry write
    planStore.readShared(KEY);
    ls.failAt = null;
    const left = Object.keys(JSON.parse(LS.getItem(KEY) || "{}")).length, entries = planStore.describe(KEY).entries;
    expect(entries).toBeGreaterThan(0); expect(entries).toBeLessThan(20);
    expect(left).toBeLessThan(20);
    expect(left + entries).toBeGreaterThanOrEqual(20);                          // every plan is in one place or the other (or both)
    // an entry edited while the move is unfinished beats the stale copy still in the legacy entry
    const id = Object.keys(lib).find((i) => LS.getItem(`${KEY}:p:${i}`) != null);
    LS.setItem(`${KEY}:p:${id}`, JSON.stringify({ ...lib[id], name: "edited after it moved", updatedAt: lib[id].updatedAt + 1 }));
    planStore._resetForTest();
    planStore.readShared(KEY); planStore._drainMigration(KEY);
    expect(planStore.readShared(KEY)[id].name).toBe("edited after it moved");
  });
  it("(b) a crash after plan ~30 resumes on the next load and loses nothing; a plan deleted mid-move is not copied back", () => {
    const lib = realLibrary(76);
    const crashCount = failAtEntry(lib, 31);
    const { ls } = tightDevice(lib, 3);                                          // room for a couple of plans' worth of edits while the move is unfinished
    LS = ls;
    ls.failAt = crashCount;                                                     // "throw from the shim" on plan 31
    const mid = planStore.readShared(KEY);
    expect(Object.keys(mid)).toHaveLength(76);
    ls.failAt = null;
    expect(planStore.describe(KEY).migrating).toBe(true);
    const entriesAtCrash = planStore.describe(KEY).entries;
    expect(entriesAtCrash).toBeGreaterThan(5); expect(entriesAtCrash).toBeLessThan(76);
    // while the move is unfinished: edit one plan that has moved, edit one that has not, delete one that has not
    const moved = Object.keys(lib).find((i) => LS.getItem(`${KEY}:p:${i}`) != null);
    const notYet = Object.keys(lib).reverse().find((i) => LS.getItem(`${KEY}:p:${i}`) == null);
    planStore.writeOne(KEY, moved, { ...planStore.readShared(KEY)[moved], name: "edited while moving" });
    planStore.writeOne(KEY, notYet, { ...planStore.readShared(KEY)[notYet], name: "edited while still in the legacy entry" });
    expect(planStore.removeOne(KEY, Object.keys(lib).reverse().filter((i) => LS.getItem(`${KEY}:p:${i}`) == null)[1])).toBe(true);
    const deleted = Object.keys(lib).reverse().filter((i) => !(i in planStore.readShared(KEY)))[0];
    planStore._resetForTest();                                                  // reload → the move resumes
    planStore.readShared(KEY); planStore._drainMigration(KEY);
    const done = planStore.readShared(KEY);
    expect(planStore.describe(KEY).migrating).toBe(false);
    expect(Object.keys(done)).toHaveLength(75);
    expect(done[deleted]).toBeUndefined(); expect(LS.getItem(`${KEY}:p:${deleted}`)).toBe(null);
    expect(done[moved].name).toBe("edited while moving"); expect(done[notYet].name).toBe("edited while still in the legacy entry");
    for (const id of Object.keys(lib).filter((i) => ![deleted, moved, notYet].includes(i))) expect(JSON.stringify(done[id])).toBe(JSON.stringify(lib[id]));
    expect(LS.getItem(KEY)).toBe(null);
  });
  it("(b) an entry that does not read back as written stops the move at that plan: it is removed, the plan stays in the legacy entry, nothing is lost", () => {
    const lib = realLibrary(20);
    const { ls } = tightDevice(lib, 3);
    LS = ls;
    const bad = `${KEY}:p:x7`; let written = false; const realSet = ls.setItem, realGet = ls.getItem;
    ls.setItem = (k, v) => { if (k === bad) written = true; return realSet(k, v); };
    ls.getItem = (k) => (k === bad && written ? "{what the device actually stored" : realGet(k));
    const got = planStore.readShared(KEY);
    ls.setItem = realSet; ls.getItem = realGet;
    expect(Object.keys(got)).toHaveLength(20);                                  // every plan still readable
    expect(JSON.parse(LS.getItem(KEY))).toHaveProperty("x7");                    // x7 was NOT dropped from the legacy entry
    expect(LS.getItem(bad)).toBe(null);                                         // and its bad entry was removed
    expect(eventsNamed("plan-store-migration-aborted")[0][2]).toMatchObject({ reason: "readback-mismatch", id: "x7" });
    expect(eventsNamed("plan-store-legacy-retired")).toHaveLength(0);
  });
  it("(d) the owner's real fixture (smu1t5vcp73y + sms4zs8unbkg padded to 143 plans) migrates incrementally at 3.46M used", () => {
    const lib = realLibrary(143);
    const legacyLen = JSON.stringify(lib).length;
    const { ls, maxEntry } = tightDevice(lib, 1.2, Math.max(0, 3_456_730 - legacyLen - KEY.length));
    LS = ls;
    planStore.readShared(KEY); planStore._drainMigration(KEY);
    expect(planStore.describe(KEY)).toMatchObject({ mode: "plan", entries: 143, migrating: false });
    for (const id of ["smu1t5vcp73y", "sms4zs8unbkg"]) expect(JSON.stringify(planStore.readShared(KEY)[id])).toBe(JSON.stringify(lib[id]));
    expect(ls.getItem("filler:other:data")).toBeTruthy();                       // nothing else on the device was touched
    expect(maxEntry).toBeGreaterThan(1000);
    const m = eventsNamed("plan-store-migrated");
    expect(m).toHaveLength(1); expect(m[0][2].incremental).toBe(true);
    expect(eventsNamed("plan-store-migration-aborted")).toHaveLength(0);
  });
  it("a device that cannot hold even ONE more plan's entry stays readable, loses nothing, says so, and resumes when room appears", () => {
    const lib = realLibrary(20);
    const text = JSON.stringify(lib);
    LS = makeLS({ quota: KEY.length + text.length + 300 });                     // not one plan's worth of room
    globalThis.__PLANYR_LS_CAP = LS.quota;
    globalThis.localStorage = LS; planStore._resetForTest();
    LS.setItem(KEY, text);
    const got = planStore.readShared(KEY);
    expect(Object.keys(got)).toHaveLength(20);                                  // reads work (from the legacy entry)
    expect(planStore.describe(KEY).migrating).toBe(true);
    expect(LS.getItem(KEY)).toBe(text);                                         // untouched
    const a = eventsNamed("plan-store-migration-aborted");
    expect(a).toHaveLength(1); expect(a[0][2]).toMatchObject({ reason: "quota", remaining: 20 });
    expect(() => saveSite({ id: "x3", els: [bld("still-works")] })).not.toThrow();   // the app keeps running either way
    LS.quota = Infinity; globalThis.__PLANYR_LS_CAP = Infinity; planStore._resetForTest();   // room appears
    planStore.readShared(KEY); planStore._drainMigration(KEY);
    expect(Object.keys(planStore.readShared(KEY))).toHaveLength(20);
    expect(LS.getItem(KEY)).toBe(null);
  });
  it("the make-room hook is offered the work, and 'retire the legacy entry' is its FIRST step when a verified one exists", async () => {
    const { makeRoomForPlanStore } = await import("../src/workspaces/site-planner/lib/storage.js");
    const lib = realLibrary(10);
    previousBuildDevice(lib, KEY, { led: false });                              // the previous build's device, not yet loaded by this build
    const legacyLen = KEY.length + LS.getItem(KEY).length;
    const res = await makeRoomForPlanStore({ base: KEY, reason: "quota", shortBy: 1000 });
    expect(res.steps[0]).toMatch(/^legacy:retired:/);
    expect(Math.abs(res.freedChars - legacyLen)).toBeLessThan(10);
    expect(LS.getItem(KEY)).toBe(null);
    expect(Object.keys(planStore.readShared(KEY))).toHaveLength(10);
  });
});

/* ───────────────────────────────────────── 5. an older tab writes the legacy entry AFTER it was retired ───────────────────────────────────────── */
describe("5 — one-way re-adopt: a legacy entry that REAPPEARS is folded in per plan and removed again — never a delete", () => {
  let lib;
  const oldTabWrite = (mutate, base = KEY) => { const all = JSON.parse(LS.getItem(base) || "{}"); for (const [id, r] of Object.entries(planStore.readShared(base))) if (!(id in all)) all[id] = JSON.parse(JSON.stringify(r)); mutate(all); LS.setItem(base, JSON.stringify(all)); };
  beforeEach(() => {
    lib = realLibrary(30);
    seedOld(LS, lib);
    planStore.readShared(KEY);                                                  // migrated + retired
    reportClientEvent.mockClear();
  });
  it("edits to DIFFERENT plans on each side both survive (the common deploy-window case)", () => {
    saveSite({ id: "x3", els: [...(loadSite("x3").els || []), bld("new-build-edit")] });
    oldTabWrite((all) => { all.x8 = { ...all.x8, name: "old build rename", updatedAt: Date.now() + 5000 }; });
    expect(loadSite("x8").name).toBe("old build rename");
    expect(loadSite("x3").els.map((e) => e.id)).toContain("new-build-edit");   // NOT reverted by the old tab's stale copy of x3
    expect(LS.getItem(KEY)).toBe(null);                                        // folded in, then deleted again
    const e = eventsNamed("plan-store-legacy-readopted"); expect(e).toHaveLength(1);
    expect(e[0][2]).toMatchObject({ merged: 1 });
  });
  it("a plan the old tab CREATED is adopted", () => {
    oldTabWrite((all) => { all.brand_new = { id: "brand_new", groupId: "brand_new", site: "N", name: "Made in old tab", updatedAt: Date.now(), els: [bld("q")] }; });
    expect(loadSite("brand_new").els.map((e) => e.id)).toEqual(["q"]);
    expect(eventsNamed("plan-store-legacy-readopted")[0][2]).toMatchObject({ adopted: 1 });
    expect(Object.keys(planStore.readShared(KEY)).length).toBe(31);
  });
  it("a plan the old tab's blob LACKS is never deleted here — absence in the legacy entry is not a delete", () => {
    oldTabWrite((all) => { delete all.x2; delete all.x7; all.x9 = { ...all.x9, name: "touch", updatedAt: Date.now() + 5000 }; });
    expect(siteExistsLocally("x2")).toBe(true); expect(siteExistsLocally("x7")).toBe(true);
    expect(Object.keys(planStore.readShared(KEY)).length).toBe(30);
  });
  it("a plan THIS build deleted (tombstoned) is not resurrected by the old tab's stale blob", () => {
    const ck = "planarfit:sites:cloud:uid-5";
    seedOld(LS, lib, ck); planStore.readShared(ck);
    planStore.removeOne(ck, "x6"); recordSiteTombstone("uid-5", "x6", Date.now());
    oldTabWrite((all) => { all.x6 = lib.x6; all.x9 = { ...all.x9, name: "touch", updatedAt: Date.now() + 5000 }; }, ck);
    expect(planStore.has(ck, "x6")).toBe(false);
    expect(planStore.readShared(ck).x9.name).toBe("touch");
  });
  it("the old tab holds an OLDER copy of a plan this build edited: this build's edit wins, nothing reverts", () => {
    saveSite({ id: "x4", name: "named by the new build" }, { planRename: true });   // a deliberate rename (a content save may no longer move a plan name — B2671215)
    oldTabWrite((all) => { all.x4 = lib.x4; all.x9 = { ...all.x9, name: "unrelated old edit", updatedAt: Date.now() + 5000 }; });
    expect(loadSite("x4").name).toBe("named by the new build");
    expect(loadSite("x9").name).toBe("unrelated old edit");
  });
  it("BOTH sides edit the SAME plan: the content is the union (the real mergeSiteContent), no element of either is lost", () => {
    saveSite({ id: "x5", els: [...(loadSite("x5").els || []), bld("from-new")] });
    oldTabWrite((all) => { all.x5 = { ...all.x5, els: [...(lib.x5.els || []), bld("from-old", 700)], updatedAt: Date.now() + 5000 }; });
    const ids = loadSite("x5").els.map((e) => e.id);
    expect(ids).toContain("from-new"); expect(ids).toContain("from-old");
  });
  it("it is quiet when nothing changed: re-reading with no legacy entry present does nothing and reports nothing", () => {
    const writes = LS.sets.length;
    for (let i = 0; i < 5; i++) planStore.readShared(KEY);
    expect(LS.sets.length).toBe(writes);
    expect(eventsNamed("plan-store-legacy-readopted")).toHaveLength(0);
  });
  it("a boot with the legacy entry rewritten while no tab was open folds it in on load", () => {
    oldTabWrite((all) => { all.x1 = { ...all.x1, name: "offline old tab", updatedAt: Date.now() + 5000 }; });
    planStore._resetForTest();
    expect(planStore.readShared(KEY).x1.name).toBe("offline old tab");
    expect(LS.getItem(KEY)).toBe(null);
  });
  it("the legacy entry becoming unreadable garbage never damages the per-plan entries — it is kept and reported, once", () => {
    const before = [...LS.raw.keys()].filter((k) => k.includes(":p:")).length;
    LS.setItem(KEY, "{{{not json");
    planStore.readShared(KEY); planStore.readShared(KEY); planStore.readShared(KEY);
    expect([...LS.raw.keys()].filter((k) => k.includes(":p:")).length).toBe(before);
    expect(eventsNamed("plan-store-legacy-kept")).toHaveLength(1);
    expect(eventsNamed("plan-store-legacy-kept")[0][2].reason).toBe("unreadable");
  });
});

/* ───────────────────────────────────────── 6. what a revert looks like now ───────────────────────────────────────── */
describe("6 — a revert to an older build is NO LONGER supported once a device has retired its entry (B2165120's rule, ended on purpose)", () => {
  it("after retirement there is no whole-library entry for an older build to read — said in the header, asserted here so it cannot be lost quietly", async () => {
    seedOld(LS, realLibrary(10)); planStore.readShared(KEY);
    expect(LS.getItem(KEY)).toBe(null);
    const { readFileSync } = await import("node:fs");
    const hdr = readFileSync("src/workspaces/site-planner/lib/planStore.js", "utf8").slice(0, 6000);
    expect(hdr).toMatch(/REVERT TO AN OLDER BUILD IS NO LONGER SUPPORTED/);
    expect(hdr).not.toMatch(/blob.{0,10}forever/i);
  });
  it("the kill switch is deleted: the old localStorage key is ignored", () => {
    LS.setItem("planarfit:planStore:layout", "blob");
    seedOld(LS, realLibrary(6));
    planStore.readShared(KEY);
    expect(planStore.describe(KEY).mode).toBe("plan");
    expect(planStore.LAYOUT_SWITCH).toBeUndefined();
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
  const ok = (plans, kb, largest = 90, layout = { indexed: true, entries: plans + 1, legacyKB: plans * 8, planWrites: 6 }) => ({ plans, edits: 8, writeKBMedian: kb, writeKBMax: kb + 5, largestWriteKB: largest, layoutObserved: layout });
  const blobArm = (plans, kb) => ({ plans, edits: 8, writeKBMedian: kb, writeKBMax: kb, largestWriteKB: kb, layoutObserved: { indexed: false, entries: 0, legacyKB: kb, planWrites: 0 } });
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
