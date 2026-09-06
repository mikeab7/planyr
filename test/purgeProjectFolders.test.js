import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1235169 — "Delete forever" and the 30-day expiry purge abandoned a purged project's
 * `project_folders` rows and its Google Drive folder tree: `cloudHardDelete` only ever removed the
 * `sites` row, and nothing else in storage.js ever referenced `project_folders` at all. Measured on
 * production: 15 abandoned Drive trees, 1,995 real folders, none with a surviving `sites` or
 * `project_folders` row.
 *
 * This proves the WIRING in storage.js's purgeDeletedProject / purgeExpiredDeletedProjects: one
 * folder purge per site GROUP (a project is a group, never a single plan — `project_folders.
 * project_id` is the group id), best-effort (a folder-purge failure must never fail the sites purge
 * that already genuinely happened), and LOUD on failure (reportClientEvent), never silent. The
 * folder/Drive purge mechanics themselves (deleting rows, resolving + trashing the Drive root) are
 * covered separately: folderMirror.test.js (`purgeProjectDrive`, server-side) and the client
 * wrapper's own contract is exercised through this mock.
 */
const h = vi.hoisted(() => ({
  cloudDeletedRowsResult: { ok: true, supported: true, rows: [] },
  hardDeleteResults: {},
  purgeProjectFoldersResult: { ok: true, rowsDeleted: true, driveTrashed: true },
}));

vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudList: vi.fn(async () => []),
  cloudDeletedRows: vi.fn(async () => h.cloudDeletedRowsResult),
  cloudUpsert: vi.fn(async () => ({ ok: true })),
  cloudDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudHardDelete: vi.fn(async (uid, id) => h.hardDeleteResults[id] || { ok: true, removed: 1 }),
  cloudRestore: vi.fn(async () => ({ ok: true, restored: 1 })),
  cloudCheckDeleted: vi.fn(async () => ({ ok: true, exists: false, deleted: false })),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(),
  fetchSiteForReconcile: vi.fn(async () => null),
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));
vi.mock("../src/workspaces/library/lib/folders.js", () => ({
  purgeProjectFolders: vi.fn(async () => h.purgeProjectFoldersResult),
}));

import { purgeDeletedProject, purgeExpiredDeletedProjects, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { reportClientEvent } from "../src/shared/telemetry/clientErrors.js";
import { purgeProjectFolders } from "../src/workspaces/library/lib/folders.js";

beforeEach(() => {
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
  h.cloudDeletedRowsResult = { ok: true, supported: true, rows: [] };
  h.hardDeleteResults = {};
  h.purgeProjectFoldersResult = { ok: true, rowsDeleted: true, driveTrashed: true };
  vi.clearAllMocks();
  setActiveUser("u-owner");
});

describe("purgeDeletedProject — purges the project's folder tree ONCE per group (B1235169)", () => {
  it("passes the explicit groupId through to the folder purge, once, even for a multi-plan group", async () => {
    const r = await purgeDeletedProject(["plan-a", "plan-b"], "group-1");
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(2);
    expect(purgeProjectFolders).toHaveBeenCalledTimes(1);
    expect(purgeProjectFolders).toHaveBeenCalledWith("group-1");
  });

  it("defaults to the first purged id when no groupId is given (a fresh single-plan project's group anchors on its own id)", async () => {
    await purgeDeletedProject(["plan-solo"]);
    expect(purgeProjectFolders).toHaveBeenCalledWith("plan-solo");
  });

  it("a folder-purge failure is reported LOUDLY but never fails the sites purge that already happened", async () => {
    h.purgeProjectFoldersResult = { ok: false, error: "Drive unreachable" };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.ok).toBe(true); // the sites purge succeeded — that's what `ok` reports
    expect(r.purged).toBe(1);
    expect(reportClientEvent).toHaveBeenCalledWith(
      "project-folder-purge-failed",
      expect.any(String),
      expect.objectContaining({ groupId: "group-1", error: "Drive unreachable" }),
    );
  });

  it("never attempts a folder purge when nothing was actually purged", async () => {
    h.hardDeleteResults["plan-a"] = { ok: false, error: "network down" };
    const r = await purgeDeletedProject(["plan-a"], "group-1");
    expect(r.ok).toBe(false);
    expect(r.purged).toBe(0);
    expect(purgeProjectFolders).not.toHaveBeenCalled();
  });
});

describe("purgeExpiredDeletedProjects — one folder purge per GROUP, not per plan (B1235169)", () => {
  it("purges the folder tree once even when several plans of the same group expire together", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "plan-a", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
        { id: "plan-b", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      ],
    };
    const r = await purgeExpiredDeletedProjects();
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(2);
    expect(purgeProjectFolders).toHaveBeenCalledTimes(1);
    expect(purgeProjectFolders).toHaveBeenCalledWith("group-1");
  });

  it("purges each distinct group's folders separately", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [
        { id: "plan-a", group_id: "group-1", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
        { id: "plan-c", group_id: "group-2", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() },
      ],
    };
    await purgeExpiredDeletedProjects();
    expect(purgeProjectFolders).toHaveBeenCalledTimes(2);
    expect(purgeProjectFolders.mock.calls.map((c) => c[0]).sort()).toEqual(["group-1", "group-2"]);
  });

  it("falls back to the row's own id when it carries no group_id", async () => {
    h.cloudDeletedRowsResult = {
      ok: true, supported: true,
      rows: [{ id: "plan-solo", deleted_at: new Date(Date.now() - 31 * 86400000).toISOString() }],
    };
    await purgeExpiredDeletedProjects();
    expect(purgeProjectFolders).toHaveBeenCalledWith("plan-solo");
  });
});
