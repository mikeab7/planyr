import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-1 (2026-09-20) — a write this account can never make succeed retires instead of retrying
 * forever. Measured on production: site `smqzpzi2b9pe`, owned by a totally different account with
 * no team_id, re-fired `event:cloud-conflict` ("stale write rejected twice (sites CAS)", reason
 * cas-409) on the owner's device across every deploy for 17 days — because this account's local
 * site cache had somehow picked the id up, and with no `ownerId` recorded on the cached copy,
 * `mine()` (storage.js's mergePulledSites) treated it as "ours" and re-queued the identical doomed
 * push on every pull. `cloudList`/`fetchSiteForReconcile` are BOTH RLS-scoped, so neither can ever
 * see a row this account doesn't own or share — there is no "cloud catches up" path that could ever
 * heal this, unlike an ordinary stale-version race against a row you genuinely own.
 *
 * This suite proves cloudUpsertCore now recognizes that shape (INSERT collides with an existing
 * row — the client never had a version for it — and the reconcile fetch that follows finds
 * NOTHING, because RLS hides the row) and retires the id: drops it from this account's persisted
 * local cache, stops tracking any version for it, and reports ONE distinctly-named event instead of
 * the generic recurring `cloud-conflict`. It also proves the ordinary, legitimate races — a genuine
 * INSERT-vs-INSERT collision with a row this account DOES own, and the everyday UPDATE-vs-UPDATE
 * version race the existing `siteConflictUnresolved.test.js` suite covers — are untouched.
 *
 * Mocks the supabase client the same way test/reconcileSite.test.js and
 * test/siteConflictUnresolved.test.js do, so this runs with no network/config. */
const h = vi.hoisted(() => ({ insertResponses: [], reconcileRow: null, insertCallCount: 0 }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (table) => {
      if (table !== "sites") throw new Error(`unexpected table ${table}`);
      return {
        insert: () => {
          const callIdx = h.insertCallCount++;
          return { select: async () => h.insertResponses[callIdx] ?? { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } } };
        },
        update: () => {
          const chain = { eq: () => chain, select: async () => ({ data: [], error: null }) };
          return chain;
        },
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: h.reconcileRow, error: null }),
          }),
        }),
      };
    },
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));

import { cloudUpsert, _siteVersions, clearSiteVersions } from "../src/workspaces/site-planner/lib/cloudSync.js";

const model = (over = {}) => ({ id: "ghost1", name: "Concept A", updatedAt: 1000, settings: {}, ...over });
const CLOUD_KEY = "planarfit:sites:cloud:uOwner";

beforeEach(() => {
  clearSiteVersions();
  h.insertCallCount = 0;
  h.insertResponses = [];
  h.reconcileRow = null;
  const store = {};
  globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { for (const k of Object.keys(store)) delete store[k]; },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() { return Object.keys(store).length; },
  };
});

describe("NEW-1 — a write against a row this account never owned retires instead of retrying forever", () => {
  it("drops the id from the local cache and reports abandoned:true when the INSERT collides with a row RLS hides from us", async () => {
    // The local cache holds a ghost entry (no ownerId — exactly the shape mergePulledSites's `mine()`
    // treats as "ours" when the row is absent from the current cloud fetch).
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ ghost1: model(), other: { id: "other" } }));
    // Never synced by this account: siteVersions["ghost1"] is unset → casUpsert takes the INSERT
    // branch, which collides (23505) because the row already exists, owned by someone else.
    // The default insert mock response above already answers 23505; fetchSiteForReconcile (RLS)
    // finds nothing at all.
    h.reconcileRow = null;

    const r = await cloudUpsert("uOwner", model());

    expect(r).toEqual({ ok: false, conflict: true, abandoned: true });
    expect(_siteVersions.ghost1).toBeUndefined();

    const cache = JSON.parse(localStorage.getItem(CLOUD_KEY));
    expect(cache).toEqual({ other: { id: "other" } }); // the ghost is gone; an unrelated entry is untouched
  });

  it("does NOT abandon a genuine INSERT-vs-INSERT race against a row this account actually owns (reconcile finds it)", async () => {
    localStorage.setItem(CLOUD_KEY, JSON.stringify({ ghost1: model() }));
    // RLS lets us see our own row this time — a real race (this tab and another of ours both
    // inserted), not an ownership gap.
    h.reconcileRow = { data: { id: "ghost1", name: "Concept A" }, version: 5 };
    // The retry (isRetry=true) then takes the UPDATE branch, which the mock's default `update()`
    // stub always returns 0 rows for — so this proves the heal was ATTEMPTED and the outcome is
    // the ordinary `unresolved` conflict, never `abandoned`.

    const r = await cloudUpsert("uOwner", model());

    expect(r.abandoned).toBeFalsy();
    expect(r.unresolved).toBe(true);
    expect(_siteVersions.ghost1).toBe(5); // reconcile refreshed it — this id is still tracked, not retired
    const cache = JSON.parse(localStorage.getItem(CLOUD_KEY));
    expect(cache).toEqual({ ghost1: model() }); // never dropped — this account DOES own it
  });

  it("an ordinary first-try INSERT success is unaffected", async () => {
    h.insertResponses = [{ data: [{ version: 1 }], error: null }];

    const r = await cloudUpsert("uOwner", model({ id: "brandNew" }));

    expect(r).toEqual({ ok: true });
    expect(_siteVersions.brandNew).toBe(1);
  });
});
