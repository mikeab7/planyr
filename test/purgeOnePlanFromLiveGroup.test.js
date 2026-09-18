import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1767168 — the plan menu's per-project "Recently deleted" ✕ (SitePlanner.jsx's
 * handlePurgeDeletedPlan) now calls `purgeOnePlanFromLiveGroup`, NOT `purgeDeletedProject` — see
 * storage.js's own header on both functions. The one thing this test exists to prove: unlike
 * `purgeDeletedProject`, this path must NEVER run the whole-project folder/Drive/Doc-Review
 * cleanup, because by construction the project it purges from is still live (that cascade is
 * correct only once the WHOLE group is gone — see purgeProjectFolders.test.js for that path).
 */
const h = vi.hoisted(() => ({
  purgeOneResult: { ok: true, removed: 1 },
  purgeOneCalls: [],
}));

vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  cloudList: vi.fn(async () => []),
  cloudDeletedRows: vi.fn(async () => ({ ok: true, supported: true, rows: [] })),
  cloudUpsert: vi.fn(async () => ({ ok: true })),
  cloudDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudHardDelete: vi.fn(async () => ({ ok: true, removed: 1 })),
  cloudPurgeOnePlan: vi.fn(async (uid, id) => {
    h.purgeOneCalls.push({ uid, id });
    return h.purgeOneResult;
  }),
  cloudRestore: vi.fn(async () => ({ ok: true, restored: 1 })),
  cloudCheckDeleted: vi.fn(async () => ({ ok: true, exists: false, deleted: false })),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(),
  fetchSiteForReconcile: vi.fn(async () => null),
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));
vi.mock("../src/workspaces/library/lib/folders.js", () => ({
  purgeProjectFolders: vi.fn(async () => ({ ok: true })),
}));
vi.mock("../src/workspaces/doc-review/lib/reviewStore.js", () => ({
  unfileReviewsForDeletedProject: vi.fn(async () => ({ ok: true, unfiled: 0 })),
}));

import { purgeOnePlanFromLiveGroup, setActiveUser } from "../src/workspaces/site-planner/lib/storage.js";
import { cloudPurgeOnePlan } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { purgeProjectFolders } from "../src/workspaces/library/lib/folders.js";
import { unfileReviewsForDeletedProject } from "../src/workspaces/doc-review/lib/reviewStore.js";

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
  h.purgeOneResult = { ok: true, removed: 1 };
  h.purgeOneCalls = [];
  vi.clearAllMocks();
  setActiveUser("u-owner");
});

describe("purgeOnePlanFromLiveGroup — purges exactly one plan, never the project's shared cleanup", () => {
  it("calls cloudPurgeOnePlan with the signed-in user and the plan id", async () => {
    const r = await purgeOnePlanFromLiveGroup("plan-a");
    expect(r.ok).toBe(true);
    expect(r.purged).toBe(1);
    expect(h.purgeOneCalls).toEqual([{ uid: "u-owner", id: "plan-a" }]);
  });

  it("NEVER runs the project folder/Drive purge on this path", async () => {
    await purgeOnePlanFromLiveGroup("plan-a");
    expect(purgeProjectFolders).not.toHaveBeenCalled();
  });

  it("NEVER unfiles Doc Review documents on this path", async () => {
    await purgeOnePlanFromLiveGroup("plan-a");
    expect(unfileReviewsForDeletedProject).not.toHaveBeenCalled();
  });

  it("surfaces a server-side refusal (e.g. the RPC's own safety checks) rather than a false success", async () => {
    h.purgeOneResult = { ok: false, removed: 0, error: "This plan couldn't be permanently deleted right now." };
    const r = await purgeOnePlanFromLiveGroup("plan-a");
    expect(r.ok).toBe(false);
    expect(r.purged).toBe(0);
    expect(r.error).toBe("This plan couldn't be permanently deleted right now.");
    expect(purgeProjectFolders).not.toHaveBeenCalled();
    expect(unfileReviewsForDeletedProject).not.toHaveBeenCalled();
  });

  it("a thrown rejection is caught and reported as a failure, never left unhandled", async () => {
    cloudPurgeOnePlan.mockRejectedValueOnce(new Error("network down"));
    const r = await purgeOnePlanFromLiveGroup("plan-a");
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network down/);
  });

  it("returns an honest failure when signed out", async () => {
    setActiveUser(null);
    const r = await purgeOnePlanFromLiveGroup("plan-a");
    expect(r.ok).toBe(false);
    expect(h.purgeOneCalls).toEqual([]);
  });
});
