import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1160480 — follow-on to B1202176. A project minted with no located origin has no local
 * record and no `public.sites` row until its first drawing save (see storage.js's own
 * `newBlankSite`/`ensureProjectRow` headers). A Library upload used to write doc_reviews/
 * file_facts rows keyed to such a project id anyway — surviving a reload — while the project's
 * own row never got created, so a hard reload reported "This project doesn't exist" and
 * stranded the just-filed file. `ensureProjectRow` is the one materialization point that closes
 * this: called before any non-planner surface writes something durable into a project id.
 *
 * Mocks cloudSync.js directly (the module boundary storage.js actually calls through), same
 * approach as resolveOrCreateTrackedSiteForComp.signedIn.test.js.
 */
const h = vi.hoisted(() => ({
  cloudListResult: [],
  cloudDeletedRowsResult: { ok: true, supported: true, rows: [] },
  cloudUpsertResult: { ok: true },
  cloudCheckDeletedResult: { ok: true, exists: false, deleted: false },
}));
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudList: vi.fn(async () => h.cloudListResult),
  cloudDeletedRows: vi.fn(async () => h.cloudDeletedRowsResult),
  cloudUpsert: vi.fn(async () => h.cloudUpsertResult),
  cloudDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudHardDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudRestore: vi.fn(async () => ({ ok: true, restored: 1 })),
  cloudCheckDeleted: vi.fn(async () => h.cloudCheckDeletedResult),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(),
  fetchSiteForReconcile: vi.fn(async () => null),
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));

import { ensureProjectRow, loadSite, saveSite, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { cloudUpsert, cloudCheckDeleted } from "../src/workspaces/site-planner/lib/cloudSync.js";

describe("ensureProjectRow — materializes a project's public.sites row before a non-planner write (B1160480)", () => {
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
    h.cloudListResult = [];
    h.cloudDeletedRowsResult = { ok: true, supported: true, rows: [] };
    h.cloudUpsertResult = { ok: true };
    h.cloudCheckDeletedResult = { ok: true, exists: false, deleted: false };
    vi.clearAllMocks();
    setActiveUser(null);
  });

  it("signed out: no-op — there is no cloud row concept for a local-only plan, and no cloud call is made", async () => {
    const r = await ensureProjectRow("smbrandnew1", { name: "A Library upload's project" });
    expect(r).toEqual({ ok: true, created: false });
    expect(loadSite("smbrandnew1")).toBeNull();
    expect(cloudCheckDeleted).not.toHaveBeenCalled();
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it("signed in, id genuinely unknown anywhere: creates a minimal row and pushes it to the cloud", async () => {
    setActiveUser("u-owner");
    const r = await ensureProjectRow("smbrandnew1", { name: "Untitled project" });
    expect(r).toEqual({ ok: true, created: true });
    const model = loadSite("smbrandnew1");
    expect(model).toBeTruthy();
    expect(model.id).toBe("smbrandnew1");
    expect(model.groupId).toBe("smbrandnew1"); // single-plan project — group anchors on its own id
    expect(model.site).toBe("Untitled project");
    expect(cloudUpsert).toHaveBeenCalled();
  });

  it("idempotent: a second call for the SAME id, now real on this device, creates nothing and never re-pushes", async () => {
    setActiveUser("u-owner");
    await ensureProjectRow("smbrandnew1", { name: "Untitled project" });
    cloudUpsert.mockClear();
    const r2 = await ensureProjectRow("smbrandnew1", { name: "Untitled project" });
    expect(r2).toEqual({ ok: true, created: false });
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it("the cloud already has the row (pulled on another device, not yet hydrated here) — adopts it as real without overwriting it", async () => {
    setActiveUser("u-owner");
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: false };
    const r = await ensureProjectRow("smalreadyreal", { name: "Untitled project" });
    expect(r).toEqual({ ok: true, created: false });
    expect(loadSite("smalreadyreal")).toBeNull(); // never locally minted a competing copy
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it("a genuinely soft-deleted project is refused, never resurrected", async () => {
    setActiveUser("u-owner");
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: true };
    const r = await ensureProjectRow("smdeletedproj", { name: "Untitled project" });
    expect(r.ok).toBe(false);
    expect(r.deleted).toBe(true);
    expect(loadSite("smdeletedproj")).toBeNull(); // no local row was minted for a deleted project
    expect(cloudUpsert).not.toHaveBeenCalled();
  });

  it("a cloud push failure is reported honestly, but the local row is kept (nothing already-filed is lost)", async () => {
    setActiveUser("u-owner");
    h.cloudUpsertResult = { ok: false, error: "network down" };
    const r = await ensureProjectRow("smpushfails", { name: "Untitled project" });
    expect(r.ok).toBe(false);
    expect(r.created).toBe(true);
    expect(typeof r.error).toBe("string");
    expect(loadSite("smpushfails")).toBeTruthy(); // local copy survives; the next save/reload retries the push
  });

  it("no id → a named failure, never a silent no-op", async () => {
    const r = await ensureProjectRow(null);
    expect(r.ok).toBe(false);
    expect(r.created).toBe(false);
  });
});
