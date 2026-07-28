import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-1 — "I swear I delete sites and they don't actually delete."
 *
 * Proven live against production Supabase: deleting a project on client A worked (row gone, durable
 * tombstone written, then pruned on A's next pull precisely BECAUSE the cloud confirmed the
 * removal). Client B — untouched, never even opened on that site — then ran pullCloud →
 * mergePulledSites, which builds the merged map from its LOCAL cache first (the B124 never-drop-
 * local-work guarantee), hit `!(id in cloudAt)`, classified the absence as "a push that didn't
 * land", and cloudUpsert'd the row straight back. It came back GUTTED: site_elements cascades on
 * the hard DELETE, so the re-push restored only the slim `elementsInRows` header — the project card
 * returns and the site plan inside is empty. Silent DATA LOSS, not a cosmetic reappearance.
 *
 * Three holes, all covered below:
 *   1. tombstones were client-local and never server-side  → sites.deleted_at + serverDeleted
 *   2. the deleting client disarmed itself the moment the cloud confirmed  → the grace window
 *   3. saveSite ignored the durable tombstone                → the readSiteTombs gate
 *
 * The last describe block is the two-cache harness replaying the exact live repro, and it PROVES
 * ITS OWN TEETH by re-running with the guard disabled (B372 precedent).
 */

// ── An in-memory stand-in for the `sites` + `site_elements` tables, wired to the same seams the
// real client uses. `soft` / `guard` flip it between the fixed world and the pre-fix world.
const server = { rows: new Map(), elements: new Map(), soft: true, guard: true, deletedFetchFails: false };
function resetServer(opts = {}) {
  server.rows = new Map();
  server.elements = new Map();
  server.soft = opts.soft !== false;
  server.guard = opts.guard !== false;
  server.deletedFetchFails = !!opts.deletedFetchFails;
}
const liveRows = () => [...server.rows.values()].filter((r) => !r.deleted_at);

vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({
  // A content push writes the SLIM header (B672) and — critically — carries no `deleted_at` key,
  // so it can never un-bin a row. That property is what makes the soft delete hold even against a
  // stale peer that still tries to heal-the-split.
  cloudUpsert: vi.fn(async (uid, model) => {
    const prev = server.rows.get(model.id);
    server.rows.set(model.id, {
      id: model.id, group_id: model.groupId || null, site: model.site || null, name: model.name || null,
      county: model.county || null, updated_at: model.updatedAt, version: prev ? prev.version + 1 : 1,
      deleted_at: prev ? prev.deleted_at : null,
      data: { ...model, els: [], markups: [], measures: [], callouts: [], parcels: [], elementsInRows: true },
    });
    return { ok: true };
  }),
  cloudDelete: vi.fn(async (uid, id) => {
    const row = server.rows.get(id);
    if (!row) return { ok: true, removed: 0 };
    if (server.soft) row.deleted_at = new Date().toISOString();
    else { server.rows.delete(id); server.elements.delete(id); } // ON DELETE CASCADE destroys the elements
    return { ok: true, removed: 1 };
  }),
  cloudHardDelete: vi.fn(async (uid, id) => {
    const had = server.rows.delete(id); server.elements.delete(id);
    return { ok: true, removed: had ? 1 : 0 };
  }),
  cloudRestore: vi.fn(async (uid, id) => {
    const row = server.rows.get(id);
    if (!row) return { ok: false, restored: 0 };
    row.deleted_at = null;
    return { ok: true, restored: 1 };
  }),
  cloudDeletedRows: vi.fn(async () => {
    if (server.deletedFetchFails) return { ok: false, supported: true, rows: [], error: "offline" };
    if (!server.guard) return { ok: true, supported: false, rows: [] }; // pre-migration / pre-fix world
    return { ok: true, supported: true, rows: [...server.rows.values()].filter((r) => r.deleted_at) };
  }),
  cloudList: vi.fn(async () => liveRows().map((r) => r.data)),
  clearSiteVersions: vi.fn(),
  keepaliveCloudPush: vi.fn(() => true),
  fetchSiteForReconcile: vi.fn(async () => null),
}));

import {
  mergePulledSites, pullCloud, saveSite, loadSite, deleteSite, loadSitesList,
  clearRecentlyDeleted, recordSiteTombstone, _readSiteTombs, setActiveUser,
  listDeletedProjects, restoreDeletedProject, purgeExpiredDeletedProjects,
  SITE_TOMB_GRACE_MS,
} from "../src/workspaces/site-planner/lib/storage.js";

const UID = "u-1";
const rec = (id, updatedAt, extra) => ({ id, updatedAt, site: "S", name: "Plan 1", ...extra });
const bld = (id) => ({ id, type: "building", cx: 0, cy: 0, w: 100, h: 100 });

// Each "browser" is its own localStorage. Swapping the backing object is what makes this a genuine
// two-CACHE harness rather than one client pretending to be two.
function makeBrowser(seed = {}) {
  const store = { ...seed };
  return {
    store,
    activate() {
      globalThis.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { for (const k of Object.keys(store)) delete store[k]; },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; },
      };
    },
  };
}

describe("mergePulledSites — a server-tombstoned row can never be resurrected (NEW-1 hole 1)", () => {
  it("a cloud-ABSENT id the server reports as DELETED is dropped from the merge and never enters toPush", () => {
    // Exactly client B's state: the site still sits in its local cloud cache, its tombstone store is {}.
    const { map, toPush } = mergePulledSites({ dead: rec("dead", 100) }, [], UID, {}, { serverDeleted: ["dead"] });
    expect(map.dead).toBeUndefined();
    expect(toPush).not.toContain("dead");
  });

  it("WITHOUT the server-deleted set the same input DOES re-push it — the bug this closes", () => {
    const { map, toPush } = mergePulledSites({ dead: rec("dead", 100) }, [], UID, {});
    expect(map.dead).toBeTruthy();
    expect(toPush).toContain("dead"); // heal-the-split misreads "deleted" as "a push that didn't land"
  });

  it("B124 is intact: a genuinely local-only, never-pushed site still heals", () => {
    const { map, toPush } = mergePulledSites({ local: rec("local", 100) }, [], UID, {}, { serverDeleted: ["other"] });
    expect(map.local).toBeTruthy();
    expect(toPush).toContain("local");
  });

  it("a server-deleted row is dropped even for a client that has no tombstone, and is flagged for one", () => {
    const { map, tombAdd } = mergePulledSites({ dead: rec("dead", 100) }, [], UID, {}, { serverDeleted: ["dead"] });
    expect(map.dead).toBeUndefined();
    expect(tombAdd).toContain("dead");
  });

  it("a failed deleted-id fetch suspends the cloud-absent heal entirely (fail-safe, nothing local dropped)", () => {
    const { map, toPush } = mergePulledSites({ a: rec("a", 100) }, [], UID, {}, { healAbsent: false });
    expect(map.a).toBeTruthy();      // local work is never dropped
    expect(toPush).not.toContain("a"); // but we won't risk re-pushing something that may be deleted
  });
});

describe("mergePulledSites — the deleting client stays armed through a grace window (NEW-1 hole 2)", () => {
  const now = 1_000_000_000_000;

  it("keeps the tombstone (and suppresses the row) right after the cloud confirms the removal", () => {
    const tombs = { gone: now - 5000 };
    const { map, tombClear } = mergePulledSites({ gone: rec("gone", now - 9000) }, [], UID, tombs, { now });
    expect(map.gone).toBeUndefined();  // our own stale cache copy never re-enters the merge
    expect(tombClear).not.toContain("gone"); // and we do NOT disarm the moment the cloud confirms
  });

  it("expires the tombstone only once it has outlived the 30-day retention window", () => {
    const tombs = { gone: now - SITE_TOMB_GRACE_MS - 1000 };
    const { tombClear } = mergePulledSites({}, [], UID, tombs, { now });
    expect(tombClear).toContain("gone");
  });

  it("still drops a STALE tombstone when the cloud row was genuinely edited later on another device", () => {
    const tombs = { s: now - 5000 };
    const { map, tombClear, deleteRetry } = mergePulledSites({}, [rec("s", now)], UID, tombs, { now });
    expect(map.s).toBeTruthy();          // a real later edit wins over our older delete (B18/B511 rule)
    expect(tombClear).toContain("s");
    expect(deleteRetry).not.toContain("s");
  });

  it("still RETRIES a delete the cloud never honoured (row present, not newer than our delete)", () => {
    const tombs = { s: now };
    const { map, deleteRetry } = mergePulledSites({}, [rec("s", now - 5000)], UID, tombs, { now });
    expect(map.s).toBeUndefined();
    expect(deleteRetry).toContain("s");
  });
});

describe("saveSite consults the DURABLE tombstone, not just this tab's set (NEW-1 hole 3)", () => {
  beforeEach(() => { makeBrowser().activate(); clearRecentlyDeleted(); setActiveUser(UID); });

  it("a second tab (fresh in-memory set) cannot re-create a durably-deleted site", () => {
    saveSite({ id: "t1", site: "ZZ", els: [bld("a")] });
    deleteSite("t1");
    clearRecentlyDeleted();                  // simulate a different tab / a reload: per-tab set is empty
    expect(_readSiteTombs(UID).t1).toBeTruthy();
    saveSite({ id: "t1", site: "ZZ", els: [bld("a")] }); // a late flush from a still-mounted planner
    expect(loadSite("t1")).toBeNull();       // stays deleted
  });

  it("a deliberate re-create still works (clearRecentlyDeleted lifts BOTH tombstones)", () => {
    saveSite({ id: "t2", site: "ZZ" });
    deleteSite("t2");
    clearRecentlyDeleted("t2");
    saveSite({ id: "t2", site: "ZZ" });
    expect(loadSite("t2")).toBeTruthy();
  });

  it("does not block an ordinary edit of a site that still exists", () => {
    recordSiteTombstone(UID, "t3", Date.now()); // an unrelated stale tombstone
    saveSite({ id: "t4", site: "ZZ", els: [bld("a")] });
    saveSite({ id: "t4", site: "ZZ", els: [bld("a"), bld("b")] });
    expect(loadSite("t4").els.length).toBe(2);
  });
});

/* ── The two-cache harness: the exact live repro, end to end. ─────────────────────────────────── */
describe("two clients, one delete — the live repro (NEW-1)", () => {
  async function runRepro({ soft, guard }) {
    resetServer({ soft, guard });
    // Client A: create a project with 4 buildings and get it into the cloud.
    const a = makeBrowser(); a.activate(); clearRecentlyDeleted(); setActiveUser(UID);
    saveSite({ id: "sms3z8jwlyf0", groupId: "g1", site: "ZZ-THROWAWAY-TEST", els: [bld("b1"), bld("b2"), bld("b3"), bld("b4")] });
    await pullCloud(UID);
    server.elements.set("sms3z8jwlyf0", 4); // the per-element rows the element-sync engine wrote
    expect(server.rows.has("sms3z8jwlyf0")).toBe(true);

    // Client B is a SECOND signed-in browser that pulled before the delete: the site sits in its
    // cloud cache, its tombstone store is {}. (Michael runs two Chrome browsers; the presence pill
    // read "2 here" the whole session.)
    const b = makeBrowser({ ["planarfit:sites:cloud:" + UID]: a.store["planarfit:sites:cloud:" + UID] });

    // Client A deletes the project. It deletes correctly on A.
    a.activate();
    await deleteSite("sms3z8jwlyf0");
    expect(loadSitesList()).toHaveLength(0);

    // Client B — untouched, not even open on that site — does ONE page load, zero user action.
    b.activate();
    clearRecentlyDeleted(); // a different browser has no per-tab memory of A's delete
    await pullCloud(UID);
    const row = server.rows.get("sms3z8jwlyf0");
    return { row, elements: server.elements.get("sms3z8jwlyf0") || 0, bList: loadSitesList() };
  }

  it("FIXED: the delete sticks on both clients, and nothing is gutted", async () => {
    const { row, bList } = await runRepro({ soft: true, guard: true });
    expect(row).toBeTruthy();
    expect(row.deleted_at).toBeTruthy();   // still binned — B's pull did not un-delete it
    expect(bList).toHaveLength(0);          // and B's own list no longer shows it
    expect(server.elements.get("sms3z8jwlyf0")).toBe(4); // no cascade fired: the buildings survive
  });

  it("TEETH: with the guard disabled (the pre-fix world) the SAME steps resurrect it, GUTTED", async () => {
    const { row, elements, bList } = await runRepro({ soft: false, guard: false });
    expect(row).toBeTruthy();               // the row is BACK on the server after B's zero-action load
    expect(row.version).toBe(1);            // re-created, not updated — exactly what the live probe saw
    expect(elements).toBe(0);               // and empty: the cascade destroyed every building
    expect(bList).toHaveLength(1);          // the project card returns, with an empty site plan inside
  });

  it("a restore from Recently deleted brings the project back WHOLE", async () => {
    await runRepro({ soft: true, guard: true });
    const bin = await listDeletedProjects();
    expect(bin.ok && bin.supported).toBe(true);
    expect(bin.projects).toHaveLength(1);
    expect(bin.projects[0].name).toBe("ZZ-THROWAWAY-TEST");

    const r = await restoreDeletedProject(bin.projects[0].ids);
    expect(r.ok).toBe(true);
    expect(server.rows.get("sms3z8jwlyf0").deleted_at).toBeNull();
    expect(server.elements.get("sms3z8jwlyf0")).toBe(4); // whole, not a slim header
    expect(loadSitesList().map((s) => s.id)).toContain("sms3z8jwlyf0");
  });

  it("the lazy purge hard-deletes only what has outlived the retention window", async () => {
    await runRepro({ soft: true, guard: true });
    const kept = await purgeExpiredDeletedProjects();
    expect(kept.purged).toBe(0);
    expect(server.rows.has("sms3z8jwlyf0")).toBe(true);

    server.rows.get("sms3z8jwlyf0").deleted_at = new Date(Date.now() - 31 * 86400000).toISOString();
    const purged = await purgeExpiredDeletedProjects();
    expect(purged.ok).toBe(true);
    expect(purged.purged).toBe(1);
    expect(server.rows.has("sms3z8jwlyf0")).toBe(false); // now the cascade is correct
  });
});
