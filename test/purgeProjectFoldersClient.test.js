import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1235169 — the CLIENT half of the whole-project folder purge (library/lib/folders.js's
 * purgeProjectFolders): trash the project's Drive root FIRST via the server (while the project's
 * project_folders rows still exist for the server to read — see folderMirror.js's purgeProjectDrive,
 * covered separately in folderMirror.test.js), then delete every project_folders row for the
 * project REGARDLESS of whether the Drive half succeeded — so a purge never again leaves orphaned
 * project_folders rows behind even when Drive itself couldn't be reached, and the caller is told
 * about a Drive failure honestly (LOUD-FAILURE) rather than left to discover it later.
 *
 * The supabase client module is mocked with a chainable builder (same approach as
 * reviewDeleteSafety.test.js); `fetch` is mocked directly.
 */
const h = vi.hoisted(() => ({
  exec: () => ({ data: null, error: null }),
  calls: [],
}));

function builder(table) {
  const ops = [];
  const settle = () => { const r = h.exec({ table, ops }); h.calls.push({ table, ops }); return r; };
  const b = { then(resolve, reject) { try { resolve(settle()); } catch (e) { reject(e); } } };
  for (const m of ["select", "update", "delete", "insert", "eq", "in"]) b[m] = (...args) => { ops.push([m, ...args]); return b; };
  return b;
}

vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (t) => builder(t),
    auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) },
  },
}));

import { purgeProjectFolders } from "../src/workspaces/library/lib/folders.js";

const fetchCalls = [];
beforeEach(() => {
  h.calls = [];
  h.exec = () => ({ data: null, error: null });
  fetchCalls.length = 0;
  globalThis.fetch = vi.fn(async (url, opts) => {
    fetchCalls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null });
    return { ok: true, status: 200, json: async () => ({ ok: true, trashed: true }) };
  });
});

describe("purgeProjectFolders — trash Drive FIRST, then delete the rows regardless (B1235169)", () => {
  it("calls the server purge, then deletes every project_folders row for the project", async () => {
    const r = await purgeProjectFolders("group-1");
    expect(r).toEqual({ ok: true, rowsDeleted: true, driveTrashed: true, error: null });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe("/api/folders");
    expect(fetchCalls[0].body).toEqual({ action: "purge-project", projectId: "group-1" });
    const del = h.calls.find((c) => c.table === "project_folders");
    expect(del.ops[0]).toEqual(["delete"]);
    expect(del.ops[1]).toEqual(["eq", "project_id", "group-1"]);
  });

  it("still deletes the rows even when the server call fails, and reports the failure honestly", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: "Drive 500" }) }));
    const r = await purgeProjectFolders("group-2");
    expect(r.ok).toBe(false);
    expect(r.rowsDeleted).toBe(true); // the DB rows are STILL gone
    expect(r.error).toBe("Drive 500");
    expect(h.calls.find((c) => c.table === "project_folders")).toBeTruthy();
  });

  it("Drive not enabled (404/503) is a graceful skip, not a failure — rows still delete", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) }));
    const r = await purgeProjectFolders("group-3");
    expect(r.ok).toBe(true);
    expect(r.driveTrashed).toBe(false);
    expect(r.rowsDeleted).toBe(true);
  });

  it("a row-delete failure is surfaced even when the Drive half succeeded", async () => {
    h.exec = () => ({ data: null, error: { message: "RLS denied" } });
    const r = await purgeProjectFolders("group-4");
    expect(r.ok).toBe(false);
    expect(r.rowsDeleted).toBe(false);
    expect(r.error).toBe("RLS denied");
  });

  it("skips entirely with no projectId — never calls the server or touches the table", async () => {
    const r = await purgeProjectFolders(null);
    expect(r).toEqual({ ok: true, skipped: true });
    expect(fetchCalls).toHaveLength(0);
    expect(h.calls).toHaveLength(0);
  });
});
