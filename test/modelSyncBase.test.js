/* B2450528 — the Spreadsheet's false "different copy saved in the cloud" bar.
 *
 * Owner: "this should have never been presented. It should have always been uploading my changes."
 * Root cause (measured): `model_sheets.data` is jsonb, which re-orders object keys; the device copy keeps typing order;
 * the old compare was a raw JSON.stringify, so IDENTICAL content read as different. And with no record of which cloud
 * version a device copy was based on, a merely-OLD copy could not be told from one holding unsaved work.
 *
 * Four halves: (1) the compare, with a control arm proving the fixture really exercises the order difference;
 * (2) every branch of the load decision; (3) the sync-base store; (4) whole sessions replayed against a fake cloud
 * (the same rules ModelApp.jsx applies, driven through the REAL modelSyncBase/modelStore/sheetModel functions), plus
 * source guards on the wiring.
 */
import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  createWorkbook, migrateWorkbook, setRaw, setNumberFormat, sheetsDiverge, canonicalJson, applyToActiveSheet,
} from "../src/workspaces/model/lib/sheetModel.js";
import { decideLoadSync, isPlaceholderWorkbook } from "../src/workspaces/model/lib/modelSyncBase.js";
import { readSyncMeta, writeSyncMeta, readLocalSheet, writeLocalSheet } from "../src/workspaces/model/lib/modelStore.js";

/* Postgres jsonb key order: shorter keys first, then bytewise. Arrays keep their order. */
function jsonbRoundTrip(v) {
  if (Array.isArray(v)) return v.map(jsonbRoundTrip);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort((a, b) => (a.length - b.length) || (a < b ? -1 : a > b ? 1 : 0))) out[k] = jsonbRoundTrip(v[k]);
    return out;
  }
  return v;
}
const typed = (wb, r, c, text) => applyToActiveSheet(wb, (sh) => setRaw(sh, r, c, text));

/* A workbook the way a person types one: cells added in typing order, a format and a style later. */
function typedWorkbook() {
  let wb = createWorkbook();
  wb = typed(wb, 10, 3, "Costs to Date + Projected");   // c4:10 first
  wb = typed(wb, 2, 3, "Additional");                    // c4:2 — jsonb orders this BEFORE c4:10
  wb = typed(wb, 0, 0, "Land");
  wb = typed(wb, 100, 1, "5");                           // longer key, typed in the middle
  wb = applyToActiveSheet(wb, (sh) => setNumberFormat(sh, 2, 3, 2, 3, "$#,##0"));
  return wb;
}

describe("the compare is key-ORDER independent (jsonb re-orders object keys)", () => {
  it("CONTROL: the fixture's jsonb round trip really does change the raw JSON text — otherwise the test below proves nothing", () => {
    const wb = migrateWorkbook(typedWorkbook());
    expect(JSON.stringify(jsonbRoundTrip(wb))).not.toBe(JSON.stringify(wb)); // the OLD compare saw "different" here
  });

  it("identical content, jsonb key order vs typing order → NOT diverged (fails on the pre-fix raw-stringify compare)", () => {
    const local = migrateWorkbook(typedWorkbook());
    const cloud = migrateWorkbook(jsonbRoundTrip(local));
    expect(sheetsDiverge(local, cloud)).toBe(false);
    expect(sheetsDiverge(cloud, local)).toBe(false);
  });

  it("a real cell change still compares as different, in either order of arguments", () => {
    const local = migrateWorkbook(typedWorkbook());
    const cloud = migrateWorkbook(jsonbRoundTrip(typed(local, 2, 3, "Costs to Date + Projected")));
    expect(sheetsDiverge(local, cloud)).toBe(true);
    expect(sheetsDiverge(cloud, local)).toBe(true);
  });

  it("array ORDER is content: reordered sheets are a real difference", () => {
    expect(canonicalJson({ a: [1, 2] })).not.toBe(canonicalJson({ a: [2, 1] }));
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(canonicalJson({ a: { c: 2, d: 1 }, b: 1 }));
  });
});

describe("decideLoadSync — every branch", () => {
  const base = { cloudVersion: 7, sameContent: false, localIsPlaceholder: false };
  const L = {}, C = {};
  it("identical content → in-sync, whatever the record says", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, sameContent: true, meta: { dirty: true, baseVersion: 1 } }).action).toBe("in-sync");
    expect(decideLoadSync({ ...base, local: L, cloud: C, sameContent: true, meta: null }).action).toBe("in-sync");
  });
  it("local CLEAN (merely old) → silently adopt the cloud copy", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: { dirty: false, baseVersion: 3 } }).action).toBe("adopt-cloud");
  });
  it("local dirty and the cloud has not moved since its base → push local, no bar", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: { dirty: true, baseVersion: 7 } }).action).toBe("push-local");
  });
  it("local dirty AND the cloud moved → the one genuine two-sided edit: diverged", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: { dirty: true, baseVersion: 6 } }).action).toBe("diverged");
  });
  it("local dirty, never confirmed (base null), and a cloud row now exists → diverged", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: { dirty: true, baseVersion: null } }).action).toBe("diverged");
  });
  it("legacy copy (no record) that differs → one-time bar; but an untouched blank one adopts the cloud silently", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: null }).action).toBe("diverged");
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: null, localIsPlaceholder: true }).action).toBe("adopt-cloud");
  });
  it("a never-edited placeholder can never win or raise the bar, even if (wrongly) marked dirty", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: C, meta: { dirty: true, baseVersion: 1 }, localIsPlaceholder: true }).action).toBe("adopt-cloud");
  });
  it("no local copy → adopt the cloud copy", () => {
    expect(decideLoadSync({ ...base, local: null, cloud: C, meta: null }).action).toBe("adopt-cloud");
  });
  it("no cloud copy → upload only if the device holds REAL work (a placeholder creates no row)", () => {
    expect(decideLoadSync({ ...base, local: L, cloud: null, cloudVersion: null, meta: null })).toEqual({ action: "no-cloud-copy", dirty: true });
    expect(decideLoadSync({ ...base, local: L, cloud: null, cloudVersion: null, meta: null, localIsPlaceholder: true })).toEqual({ action: "no-cloud-copy", dirty: false });
  });
  it("isPlaceholderWorkbook: only a byte-for-byte untouched workbook", () => {
    expect(isPlaceholderWorkbook(createWorkbook())).toBe(true);
    expect(isPlaceholderWorkbook(typed(createWorkbook(), 0, 0, "x"))).toBe(false);
  });
});

describe("the sync-base store", () => {
  beforeEach(() => {
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
  });
  it("round-trips, is scoped by account, and reads null for a legacy copy or junk", () => {
    expect(readSyncMeta("u1", "p1")).toBe(null);
    expect(writeSyncMeta("u1", "p1", { baseVersion: 115, dirty: true })).toBe(true);
    expect(readSyncMeta("u1", "p1")).toEqual({ baseVersion: 115, dirty: true });
    expect(readSyncMeta("u2", "p1")).toBe(null);
    writeSyncMeta("u1", "p1", { baseVersion: undefined, dirty: false });
    expect(readSyncMeta("u1", "p1")).toEqual({ baseVersion: null, dirty: false });
    localStorage.setItem("planyr:model:sheet:meta:v1:u1:p1", "{not json");
    expect(readSyncMeta("u1", "p1")).toBe(null);
  });
});

/* ---- whole sessions against a fake cloud: the rules ModelApp.jsx applies, through the real functions ---- */
function makeCloud() {
  const c = { row: null, pushes: 0 };
  c.read = () => (c.row ? { sheet: jsonbRoundTrip(c.row.data), version: c.row.version } : { sheet: null, version: null }); // ALWAYS through jsonb
  c.write = (wb, expected) => {                                                                                       // casUpsert's contract
    if (expected == null) { if (c.row) return { ok: false, reason: "conflict" }; c.row = { data: JSON.parse(JSON.stringify(wb)), version: 1 }; }
    else { if (!c.row || c.row.version !== expected) return { ok: false, reason: "conflict" }; c.row = { data: JSON.parse(JSON.stringify(wb)), version: expected + 1 }; }
    c.pushes += 1; return { ok: true, version: c.row.version };
  };
  return c;
}
/** One device's tab. `open()` = the load effect; `edit()` = commit + write-through; `settle()` = the debounced push. */
function makeDevice(uid, pid, cloud) {
  const d = { wb: null, bar: false, dirty: false, base: null, cloudVersion: null, pushes: 0 };
  d.open = () => {
    const local = readLocalSheet(uid, pid);
    const meta0 = local ? readSyncMeta(uid, pid) : null;
    if (!local) writeSyncMeta(uid, pid, { baseVersion: null, dirty: false });
    d.base = meta0 ? meta0.baseVersion : null; d.dirty = !!(meta0 && meta0.dirty); d.bar = false;
    d.wb = local ? migrateWorkbook(local) : createWorkbook();
    writeLocalSheet(uid, pid, d.wb);                                   // the write-through of the initial reset
    const r = cloud.read(); d.cloudVersion = r.version;
    const cw = r.sheet ? migrateWorkbook(r.sheet) : null;
    const v = decideLoadSync({ local: d.wb, cloud: cw, cloudVersion: r.version, meta: readSyncMeta(uid, pid),
      sameContent: cw ? !sheetsDiverge(d.wb, cw) : false, localIsPlaceholder: isPlaceholderWorkbook(d.wb) });
    if (v.action === "adopt-cloud") { d.wb = cw; d.base = r.version; d.dirty = false; writeLocalSheet(uid, pid, cw); writeSyncMeta(uid, pid, { baseVersion: r.version, dirty: false }); }
    else if (v.action === "in-sync") { d.base = r.version; d.dirty = false; writeSyncMeta(uid, pid, { baseVersion: r.version, dirty: false }); }
    else if (v.action === "push-local") { d.dirty = true; d.base = r.version; }
    else if (v.action === "no-cloud-copy") { d.dirty = v.dirty; writeSyncMeta(uid, pid, { baseVersion: null, dirty: v.dirty }); }
    else d.bar = true;
    return v.action;
  };
  d.edit = (r, c, text) => { d.wb = typed(d.wb, r, c, text); writeLocalSheet(uid, pid, d.wb); d.dirty = true; writeSyncMeta(uid, pid, { baseVersion: d.base, dirty: true }); };
  d.settle = () => {                                                      // the debounce firing: only real unsynced work, never while the bar is up
    if (d.bar || !d.dirty) return null;
    const res = cloud.write(d.wb, d.cloudVersion);
    if (res.ok) { d.cloudVersion = res.version; d.base = res.version; d.dirty = false; writeSyncMeta(uid, pid, { baseVersion: res.version, dirty: false }); d.pushes += 1; }
    return res;
  };
  return d;
}

describe("whole sessions", () => {
  beforeEach(() => {
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => { mem.set(k, String(v)); }, removeItem: (k) => { mem.delete(k); } };
  });

  it("owner's case: edit, the cloud stores it through jsonb, reload → NO bar, and the next edit uploads", () => {
    const cloud = makeCloud(), d = makeDevice("u", "p", cloud);
    d.open();
    d.edit(10, 3, "Costs to Date + Projected"); d.edit(2, 3, "Additional"); d.edit(0, 0, "Land");
    expect(d.settle().ok).toBe(true);
    const v1 = cloud.row.version;
    expect(d.open()).toBe("in-sync");                       // reload; the cloud read came back key-sorted
    expect(d.bar).toBe(false);
    d.edit(2, 3, "Additional 2");
    expect(d.settle().ok).toBe(true);
    expect(cloud.row.version).toBe(v1 + 1);
    expect(cloud.row.data.sheets[0].sheet.cells["c4:2"]).toBe("Additional 2");
  });

  it("a plain reload with NO edit never bumps the cloud version", () => {
    const cloud = makeCloud(), d = makeDevice("u", "p", cloud);
    d.open(); d.edit(0, 0, "x"); d.settle();
    const before = cloud.pushes;
    d.open(); d.settle(); d.open(); d.settle();
    expect(cloud.pushes).toBe(before);
  });

  it("a closed-early blank placeholder neither creates a cloud row nor beats the real sheet later", () => {
    const cloud = makeCloud(), a = makeDevice("u", "p", cloud), b = makeDevice("u", "p", makeCloud());
    a.open(); a.settle();                                   // opened, closed: only the placeholder exists
    expect(cloud.row).toBe(null);
    // another browser profile made the real sheet
    const real = makeDevice("u2", "p", cloud); real.open(); real.edit(0, 0, "Pursuit Budget"); real.settle();
    // the first profile's blank placeholder is still on disk
    expect(readLocalSheet("u", "p")).not.toBe(null);
    expect(a.open()).toBe("adopt-cloud");
    expect(a.bar).toBe(false);
    expect(a.wb.sheets[0].sheet.cells["c1:0"]).toBe("Pursuit Budget");
    void b;
  });

  it("stale-but-CLEAN local copy + a newer cloud → the cloud is shown, no bar", () => {
    const cloud = makeCloud(), phone = makeDevice("u", "p", cloud);
    phone.open(); phone.edit(0, 0, "v1"); phone.settle();
    // the laptop (same account, its own storage) takes over and edits twice
    const laptopStore = new Map(); const keep = globalThis.localStorage;
    globalThis.localStorage = { getItem: (k) => (laptopStore.has(k) ? laptopStore.get(k) : null), setItem: (k, v) => { laptopStore.set(k, String(v)); }, removeItem: (k) => { laptopStore.delete(k); } };
    const laptop = makeDevice("u", "p", cloud); laptop.open(); laptop.edit(0, 0, "v2"); laptop.settle(); laptop.edit(0, 0, "v3"); laptop.settle();
    globalThis.localStorage = keep;
    expect(phone.open()).toBe("adopt-cloud");
    expect(phone.bar).toBe(false);
    expect(phone.wb.sheets[0].sheet.cells["c1:0"]).toBe("v3");
  });

  it("an offline edit on a device whose cloud has not moved → pushed silently on the next open", () => {
    const cloud = makeCloud(), d = makeDevice("u", "p", cloud);
    d.open(); d.edit(0, 0, "one"); d.settle();
    d.edit(0, 0, "two");                                    // tab closed before the debounce fired
    expect(d.open()).toBe("push-local");
    expect(d.bar).toBe(false);
    expect(d.settle().ok).toBe(true);
    expect(cloud.row.data.sheets[0].sheet.cells["c1:0"]).toBe("two");
  });

  it("BOTH sides edited since their common base → the bar still appears, and nothing is pushed over the cloud", () => {
    const cloud = makeCloud(), a = makeDevice("u", "p", cloud);
    a.open(); a.edit(0, 0, "base"); a.settle();
    const store = new Map(); const keepA = globalThis.localStorage;
    const swap = (m) => { globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
    const aStore = keepA;
    swap(store); const b = makeDevice("u", "p", cloud); b.open(); b.edit(0, 0, "from B"); b.settle();   // cloud moves
    globalThis.localStorage = aStore;
    a.edit(0, 0, "from A (unsynced)");                      // A edited offline since the common base
    const writesBefore = cloud.pushes;
    expect(a.open()).toBe("diverged");
    expect(a.bar).toBe(true);
    expect(a.settle()).toBe(null);
    expect(cloud.pushes).toBe(writesBefore);
  });

  it("a legacy device copy (saved before the record existed) that equals the cloud raises no bar and records its base", () => {
    const cloud = makeCloud(); const wb = typedWorkbook();
    cloud.row = { data: JSON.parse(JSON.stringify(wb)), version: 115 };
    writeLocalSheet("u", "p", wb);                          // no meta written: a legacy copy
    const d = makeDevice("u", "p", cloud);
    expect(d.open()).toBe("in-sync");
    expect(readSyncMeta("u", "p")).toEqual({ baseVersion: 115, dirty: false });
  });
});

describe("wiring in ModelApp.jsx (source guards)", () => {
  const SRC = fs.readFileSync(path.join(process.cwd(), "src/workspaces/model/ModelApp.jsx"), "utf8");
  it("the load effect decides from the sync base on the workbook as it is NOW, via the one decision function", () => {
    expect(SRC).toMatch(/decideLoadSync\(\{/);
    expect(SRC).toMatch(/workbookRef\.current \|\| migrateWorkbook\(local\)/);
    expect(SRC).not.toMatch(/JSON\.stringify\(.*\)\s*!==\s*JSON\.stringify/);
  });
  it("only a person's edit (commit/undo/redo) marks the stored copy dirty — a load's reset never does", () => {
    expect(SRC).toMatch(/const commit = useCallback\(\(u\) => \{ userEditRef\.current = true; commitRaw\(u\); \}/);
    expect(SRC).toMatch(/const undo = useCallback\(\(\) => \{ userEditRef\.current = true; undoRaw\(\); \}/);
    expect(SRC).toMatch(/const redo = useCallback\(\(\) => \{ userEditRef\.current = true; redoRaw\(\); \}/);
    expect(SRC).toMatch(/adoptWorkbook = \(wb, \{ base, dirty \}\) => \{\s*userEditRef\.current = false;\s*reset\(wb\);/);
  });
  it("the push waits for the cloud's answer and for real unsynced work, and records the base it landed on", () => {
    expect(SRC).toMatch(/if \(!cloudSettled \|\| !dirtyRef\.current\) return undefined;/);
    expect(SRC).toMatch(/noteSynced\(version, workbook\);/);
  });
  it("the bar's two buttons record the new base", () => {
    const k = SRC.indexOf("const onKeepDeviceCopy"), u = SRC.indexOf("const onUseCloudCopy"), end = SRC.indexOf("Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z");
    expect(SRC.slice(k, u)).toMatch(/writeSyncMeta\(userId, storageKey, \{ baseVersion: baseVersionRef\.current, dirty: true \}\)/);
    expect(SRC.slice(u, end)).toMatch(/writeSyncMeta\(userId, storageKey, \{ baseVersion: baseVersionRef\.current, dirty: dirtyRef\.current \}\)/);
  });
  it("the signed-out → signed-in adoption ignores a never-edited placeholder", () => {
    expect(SRC).toMatch(/sheetsDiverge\(anonWb, migrateWorkbook\(r\.sheet\)\) && !isPlaceholderWorkbook\(anonWb\)/);
  });
});
