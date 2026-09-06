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

/* B1227984 — "a project created after PR #1464 still never reaches the cloud" (owner repro,
 * Spreadsheet/Model path — `public.sites` AND `public.model_sheets` both stay at zero, forever,
 * even after a real edit made once connectivity is confirmed back). AUDIT-FIRST traced this to
 * TWO independent defects, only the SECOND of which is fixed here:
 *
 * (1) `SitePlanner.jsx`'s `persistOrDrop` calling `deleteSite` on a still-blank, never-saved
 *     project id (abandoning a "New project" draft the instant the user switches to a non-Site
 *     tab) used to tombstone that id unconditionally, permanently blocking `ensureProjectRow`'s
 *     own local write forever. **NOT fixed in this item** — confirmed, by reading its diff, that
 *     an ALREADY-OPEN PR (#1475, "B1202176 (amendment)", branch `claude/notes-ensure-site-row-k9vuy8`)
 *     independently found and fixed this EXACT mechanism (same root cause, same call site:
 *     `persistOrDrop` → `deleteSite`) via a `{tombstone: !!stored}` option, days/hours before this
 *     item was filed. Landing a second, differently-shaped fix for the identical root cause here
 *     would be a real collision, so this item defers to #1475 for that half entirely and does not
 *     touch `deleteSite`/`persistOrDrop` at all. **A gap in #1475's own fix worth flagging (not
 *     fixed here, per the same instruction to avoid overlapping work): its `stored = loadSite(siteId)`
 *     check reads whatever the local record is AT THE MOMENT persistOrDrop runs — if a SIBLING
 *     module's own `ensureProjectRow` call wins a race and materializes a real local+cloud row for
 *     this same id in the gap between the user switching tabs and this cleanup firing, `stored` is
 *     now truthy, so #1475's fix takes the "genuinely real, keep the tombstone" branch and soft-deletes
 *     the project a sibling module just created — moments after it was created. This matches a
 *     SEPARATE, already-observed production shape (a project's `sites` row created, then genuinely
 *     soft-deleted ~34s later with no user delete action) that is NOT the same shape as this item's
 *     own Spreadsheet/Model repro (no row ever). Left for whichever session is driving the
 *     soft-delete-writer investigation (`sites.deleted_at`) to confirm or refute against #1475's
 *     actual code, and posted as a review comment on #1475 rather than silently patched here.
 *
 * (2) `ensureProjectRow` itself never retried a failed cloud push once the connection returned — a
 *     failed push (offline, a deploy blip) leaves a local-only record behind (correct — LOUD-FAILURE,
 *     nothing typed is lost), but every LATER call's `readSites()[id]` fast path then trusted that
 *     local-only record as proof the cloud already had it, and never re-attempted the push. THIS is
 *     the genuinely independent, non-overlapping defect this item fixes (see the `storage.js` diff:
 *     `unconfirmedProjectPush`). It does not touch `deleteSite` or `persistOrDrop` at all, so it
 *     cannot collide with #1475 regardless of how that PR resolves. */
describe("ensureProjectRow retries a failed cloud push once the connection returns (B1227984)", () => {
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

  it("a cloud push that fails while offline is retried on the very next call and lands once the connection returns", async () => {
    setActiveUser("u-owner");
    const id = "smretryonline1";
    h.cloudUpsertResult = { ok: false, error: "network down" };
    const r1 = await ensureProjectRow(id, { name: "Untitled project" });
    expect(r1.ok).toBe(false);
    expect(loadSite(id)).toBeTruthy(); // local copy survives the offline attempt
    expect(cloudUpsert).toHaveBeenCalledTimes(1);

    // The connection returns; the next child-module save must retry the push rather than trusting
    // the local record (written by the failed attempt above) as proof the cloud already has it.
    h.cloudUpsertResult = { ok: true };
    const r2 = await ensureProjectRow(id, { name: "Untitled project" });
    expect(cloudUpsert).toHaveBeenCalledTimes(2); // proves the retry actually happened
    expect(r2.ok).toBe(true);

    // And now that it's confirmed, a THIRD call is the normal fast path — no further network call.
    const r3 = await ensureProjectRow(id, { name: "Untitled project" });
    expect(r3).toEqual({ ok: true, created: false });
    expect(cloudUpsert).toHaveBeenCalledTimes(2);
  });
});

/* B1235168 — `confirmLive` opts a caller OUT of the fast path above, for exactly the callers that
 * mint a durable EXTERNAL side effect off an "already real" verdict (library/lib/folders.js's
 * `ensureSeeded`, which materializes 12+ `project_folders` rows and mirrors a Drive tree). Measured
 * on production: a project binned from another tab/device still read "already real" here — via the
 * plain fast path — and grew a full 133-folder Drive tree one to two days after being binned. */
describe("ensureProjectRow — confirmLive forces the deletion check even when a local row already exists (B1235168)", () => {
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

  it("without confirmLive, a local row short-circuits and never asks the cloud (unchanged — ordinary saves stay cheap)", async () => {
    setActiveUser("u-owner");
    await ensureProjectRow("smstale1", { name: "Untitled project" }); // materializes a local row
    cloudCheckDeleted.mockClear();
    const r = await ensureProjectRow("smstale1", { name: "Untitled project" });
    expect(r).toEqual({ ok: true, created: false });
    expect(cloudCheckDeleted).not.toHaveBeenCalled();
  });

  it("with confirmLive, a project binned from another device is refused even though THIS device's local row is stale", async () => {
    setActiveUser("u-owner");
    await ensureProjectRow("smstale2", { name: "Untitled project" }); // this device still thinks it's real
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: true }; // binned elsewhere since
    const r = await ensureProjectRow("smstale2", { name: "Untitled project", confirmLive: true });
    expect(r.ok).toBe(false);
    expect(r.deleted).toBe(true);
    expect(cloudCheckDeleted).toHaveBeenCalled();
  });

  it("with confirmLive, a genuinely live project (still real everywhere) proceeds exactly like the fast path would", async () => {
    setActiveUser("u-owner");
    await ensureProjectRow("smstale3", { name: "Untitled project" });
    h.cloudCheckDeletedResult = { ok: true, exists: true, deleted: false };
    const r = await ensureProjectRow("smstale3", { name: "Untitled project", confirmLive: true });
    expect(r).toEqual({ ok: true, created: false });
  });

  it("with confirmLive, a failed deletion check (offline) refuses rather than trusting the stale local row", async () => {
    setActiveUser("u-owner");
    await ensureProjectRow("smstale4", { name: "Untitled project" });
    h.cloudCheckDeletedResult = { ok: false }; // the check itself failed — no answer either way
    const r = await ensureProjectRow("smstale4", { name: "Untitled project", confirmLive: true });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/couldn't confirm/i);
  });

  it("with confirmLive, a brand-new project (never persisted anywhere) still creates + pushes normally", async () => {
    setActiveUser("u-owner");
    const r = await ensureProjectRow("smbrandnewcl", { name: "Untitled project", confirmLive: true });
    expect(r).toEqual({ ok: true, created: true });
    expect(loadSite("smbrandnewcl")).toBeTruthy();
  });
});
