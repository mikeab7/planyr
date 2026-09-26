/* modelStore — the ORGANIZATION-scoped workbook functions (NEW-1, B1912209).
 *
 * Organization scope holds SEVERAL workbooks per account (unlike a project's exactly one), so
 * these functions have a real per-workbook id + name and a LIST, backed by `org_model_sheets`
 * (db/org_model_sheets.sql) rather than `model_sheets`. Everything else — the guarded CAS
 * upsert, the local write-through — is the SAME mechanism the project-scoped functions in
 * test/modelStore.test.js already exercise; this file proves the org half specifically:
 *   1. the cloud writes target `org_model_sheets`, never `model_sheets`, with the workbook's
 *      OWN id (never a project id) and the real composite conflict target;
 *   2. `saveOrgWorkbookCloud` never calls `ensureProjectExists` — an org workbook has no
 *      project row to confirm against;
 *   3. the local index (readLocalOrgIndex/touchLocalOrgIndex/removeLocalOrgIndexEntry) round-
 *      trips correctly and is scoped by account, exactly like every other local-storage tier
 *      in this workspace;
 *   4. the SAME local content key (`readLocalSheet`/`writeLocalSheet`) works for an org
 *      workbook id exactly as it does for a project id — this is what "keyed to org, not a
 *      project" actually means at the storage layer: the key is just a string, and this proves
 *      a workbook id round-trips through it independent of any project.
 *
 * Mock the supabase client (same pattern as test/modelStore.test.js) so this runs without a
 * network/config.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// vitest.config.js runs this suite under the "node" environment (no DOM), so
// `localStorage` needs the same plain in-memory polyfill test/lastDoc.test.js already uses.
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

const h = vi.hoisted(() => ({ captured: {}, results: {} }));

vi.mock("../src/shared/projects/projects.js", () => ({
  ensureProjectExists: vi.fn(async () => ({ ok: true, created: false })),
}));

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabaseConfigured: () => true,
  supabase: {
    from(table) {
      h.captured.table = table;
      return {
        insert(v) {
          h.captured.op = "insert";
          h.captured.insertValues = v;
          return { select: () => Promise.resolve(h.results.insert || { data: [{ version: 1 }], error: null }) };
        },
        update(v) {
          h.captured.op = "update";
          h.captured.updateValues = v;
          h.captured.updateEq = [];
          const chain = {
            eq(k, val) { h.captured.updateEq.push([k, val]); return chain; },
            select: () => Promise.resolve(h.results.update || { data: [{ version: 2 }], error: null }),
            // A plain metadata update (rename/soft-delete) never calls .select() — making the
            // chain itself thenable is what lets `await update().eq().eq()` resolve without one,
            // exactly like the real Supabase query builder.
            then(resolve, reject) { return Promise.resolve(h.results.plainUpdate || { error: null }).then(resolve, reject); },
          };
          return chain;
        },
        select(cols) {
          h.captured.selectCols = cols;
          const chain = {
            eq(k, val) { h.captured.selectEq = h.captured.selectEq || []; h.captured.selectEq.push([k, val]); return chain; },
            is(k, val) { h.captured.selectIs = h.captured.selectIs || []; h.captured.selectIs.push([k, val]); return chain; },
            order(...args) { h.captured.orderArgs = args; return chain; },
            maybeSingle: () => Promise.resolve(h.results.maybeSingle || { data: null, error: null }),
            then(resolve, reject) { return Promise.resolve(h.results.list || { data: [], error: null }).then(resolve, reject); },
          };
          return chain;
        },
      };
    },
  },
}));

import {
  saveOrgWorkbookCloud, loadOrgWorkbookCloud, listOrgWorkbooksCloud,
  renameOrgWorkbookCloud, deleteOrgWorkbookCloud,
  readLocalOrgIndex, writeLocalOrgIndex, touchLocalOrgIndex, removeLocalOrgIndexEntry,
  readLocalSheet, writeLocalSheet,
} from "../src/workspaces/model/lib/modelStore.js";
import { ensureProjectExists } from "../src/shared/projects/projects.js";

describe("modelStore — org workbook cloud writes target org_model_sheets, never model_sheets", () => {
  beforeEach(() => {
    h.captured = {};
    h.results = {};
    vi.clearAllMocks();
    globalThis.localStorage = makeStore();
  });

  it("a brand-new workbook's first save inserts into org_model_sheets with its OWN id, never a project id", async () => {
    const r = await saveOrgWorkbookCloud({ uid: "u1", id: "wb-1", name: "Portfolio pro forma", sheet: { cells: {} }, expected: null });
    expect(h.captured.table).toBe("org_model_sheets");
    expect(h.captured.op).toBe("insert");
    expect(h.captured.insertValues.id).toBe("wb-1");
    expect(h.captured.insertValues.user_id).toBe("u1");
    expect(h.captured.insertValues.name).toBe("Portfolio pro forma");
    expect(r).toEqual({ ok: true, version: 1 });
  });

  it("never confirms a project row — an org workbook has none to confirm against", async () => {
    await saveOrgWorkbookCloud({ uid: "u1", id: "wb-1", name: "Anything", sheet: { cells: {} }, expected: null });
    expect(ensureProjectExists).not.toHaveBeenCalled();
  });

  it("a subsequent save updates, filtering on the real composite key (user_id, id), plus version", async () => {
    const r = await saveOrgWorkbookCloud({ uid: "u1", id: "wb-1", name: "Portfolio pro forma", sheet: { cells: { a: 1 } }, expected: 1 });
    expect(h.captured.table).toBe("org_model_sheets");
    expect(h.captured.op).toBe("update");
    expect(h.captured.updateEq).toEqual([["user_id", "u1"], ["id", "wb-1"], ["version", 1]]);
    expect(r).toEqual({ ok: true, version: 2 });
  });

  it("a stale version is rejected as a conflict, never silently applied", async () => {
    h.results.update = { data: [], error: null }; // 0 rows matched
    const r = await saveOrgWorkbookCloud({ uid: "u1", id: "wb-1", name: "x", sheet: {}, expected: 1 });
    expect(r).toEqual({ ok: false, reason: "conflict" });
  });

  it("loadOrgWorkbookCloud reads from org_model_sheets by id, excluding soft-deleted rows", async () => {
    h.results.maybeSingle = { data: { data: { cells: { a: 1 } }, version: 3, name: "Cost database" }, error: null };
    const r = await loadOrgWorkbookCloud("wb-1");
    expect(h.captured.table).toBe("org_model_sheets");
    expect(h.captured.selectEq).toEqual([["id", "wb-1"]]);
    expect(h.captured.selectIs).toEqual([["deleted_at", null]]);
    expect(r).toEqual({ ok: true, sheet: { cells: { a: 1 } }, version: 3, name: "Cost database" });
  });

  it("listOrgWorkbooksCloud lists id/name/updatedAt, newest first, excluding soft-deleted rows", async () => {
    h.results.list = { data: [{ id: "wb-2", name: "Pipeline tracker", updated_at: "2026-09-20T00:00:00Z" }], error: null };
    const r = await listOrgWorkbooksCloud();
    expect(h.captured.table).toBe("org_model_sheets");
    expect(h.captured.selectIs).toEqual([["deleted_at", null]]);
    expect(r.ok).toBe(true);
    expect(r.rows).toEqual([{ id: "wb-2", name: "Pipeline tracker", updatedAt: Date.parse("2026-09-20T00:00:00Z") }]);
  });

  it("renameOrgWorkbookCloud only touches name — never data or version — filtered by id and owner", async () => {
    const r = await renameOrgWorkbookCloud("u1", "wb-1", "New name");
    expect(h.captured.table).toBe("org_model_sheets");
    expect(h.captured.updateValues).toEqual({ name: "New name" });
    expect(h.captured.updateEq).toEqual([["id", "wb-1"], ["user_id", "u1"]]);
    expect(r).toEqual({ ok: true });
  });

  it("deleteOrgWorkbookCloud is a tombstone UPDATE (deleted_at), never a row DELETE", async () => {
    const r = await deleteOrgWorkbookCloud("u1", "wb-1");
    expect(h.captured.table).toBe("org_model_sheets");
    expect(h.captured.op).toBe("update");
    expect(typeof h.captured.updateValues.deleted_at).toBe("string");
    expect(r).toEqual({ ok: true });
  });

  it("a missing table (not yet migrated) degrades to not-provisioned, never a crash", async () => {
    h.results.list = { data: null, error: { code: "42P01", message: "relation \"org_model_sheets\" does not exist" } };
    const r = await listOrgWorkbooksCloud();
    expect(r).toEqual({ ok: false, reason: "not-provisioned" });
  });
});

describe("modelStore — the local org index (offline/signed-out account scoping)", () => {
  beforeEach(() => { globalThis.localStorage = makeStore(); });

  it("starts empty for an account with no workbooks yet", () => {
    expect(readLocalOrgIndex("u1")).toEqual([]);
  });

  it("touchLocalOrgIndex adds an entry, newest-first, and persists it", () => {
    touchLocalOrgIndex("u1", { id: "wb-1", name: "A", updatedAt: 100 });
    const list = touchLocalOrgIndex("u1", { id: "wb-2", name: "B", updatedAt: 200 });
    expect(list.map((w) => w.id)).toEqual(["wb-2", "wb-1"]);
    expect(readLocalOrgIndex("u1").map((w) => w.id)).toEqual(["wb-2", "wb-1"]);
  });

  it("touchLocalOrgIndex on an EXISTING id updates it in place rather than duplicating", () => {
    touchLocalOrgIndex("u1", { id: "wb-1", name: "A", updatedAt: 100 });
    const list = touchLocalOrgIndex("u1", { id: "wb-1", name: "A renamed", updatedAt: 300 });
    expect(list).toEqual([{ id: "wb-1", name: "A renamed", updatedAt: 300 }]);
  });

  it("removeLocalOrgIndexEntry drops exactly the named workbook", () => {
    touchLocalOrgIndex("u1", { id: "wb-1", name: "A", updatedAt: 100 });
    touchLocalOrgIndex("u1", { id: "wb-2", name: "B", updatedAt: 200 });
    const list = removeLocalOrgIndexEntry("u1", "wb-1");
    expect(list.map((w) => w.id)).toEqual(["wb-2"]);
  });

  it("two different accounts (or an account vs signed-out \"local\") never see each other's index", () => {
    touchLocalOrgIndex("u1", { id: "wb-1", name: "u1's workbook", updatedAt: 100 });
    touchLocalOrgIndex("local", { id: "wb-2", name: "signed-out workbook", updatedAt: 100 });
    expect(readLocalOrgIndex("u1").map((w) => w.id)).toEqual(["wb-1"]);
    expect(readLocalOrgIndex("local").map((w) => w.id)).toEqual(["wb-2"]);
    expect(readLocalOrgIndex("u2")).toEqual([]);
  });

  it("writeLocalOrgIndex replaces the whole list (the cloud-reconcile write-back path)", () => {
    touchLocalOrgIndex("u1", { id: "stale", name: "gone after reconcile", updatedAt: 1 });
    writeLocalOrgIndex("u1", [{ id: "wb-1", name: "from the cloud", updatedAt: 500 }]);
    expect(readLocalOrgIndex("u1")).toEqual([{ id: "wb-1", name: "from the cloud", updatedAt: 500 }]);
  });
});

describe("modelStore — a workbook id round-trips through the SAME local content key a project id uses", () => {
  beforeEach(() => { globalThis.localStorage = makeStore(); });

  it("readLocalSheet/writeLocalSheet key by whatever string they're given — a workbook id works exactly like a project id, and the two never collide", () => {
    const orgWb = { activeSheetId: "s1", sheets: [{ id: "s1", name: "Sheet1", sheet: { cells: { a: 1 } } }] };
    const projectWb = { activeSheetId: "s1", sheets: [{ id: "s1", name: "Sheet1", sheet: { cells: { b: 2 } } }] };
    expect(writeLocalSheet("u1", "wb-1", orgWb)).toBe(true);
    expect(writeLocalSheet("u1", "proj-1", projectWb)).toBe(true);
    expect(readLocalSheet("u1", "wb-1")).toEqual(orgWb);
    expect(readLocalSheet("u1", "proj-1")).toEqual(projectWb);
    // Keyed to the WORKBOOK, never the project: nothing about "proj-1" leaks into "wb-1"'s read.
    expect(readLocalSheet("u1", "wb-1")).not.toEqual(projectWb);
  });
});
