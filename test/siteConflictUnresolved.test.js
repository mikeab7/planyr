import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-1 (2026-09-16) — "a save the database refuses is reported to the user as a save that
 * worked." `public.sites_enforce_version_monotonic` refuses a non-advancing content write by
 * returning null from its BEFORE UPDATE trigger; PostgREST reports that identically to an
 * ordinary optimistic-concurrency loss — "200, zero rows returned" — which `interpretCas`
 * (shared/cloud/optimisticUpsert.js) already turns into `{ok:false, conflict:true}`. What was
 * missing is what happens AFTER that: cloudUpsertCore's one-shot self-heal (refetch the fresh
 * version, retry once) usually resolves an ordinary stale-version race, but when the retry ALSO
 * comes back empty — which is exactly what a genuine trigger refusal or a live write race looks
 * like — the caller had no way to tell "this is done retrying and needs a person to act" apart
 * from an ordinary transient failure that heals itself on the next edit. This suite proves the
 * `unresolved:true` outcome cloudUpsertCore now returns for exactly that case, and that the
 * ordinary (and far more common) self-heals-successfully path is untouched.
 *
 * Mocks the supabase client the same way test/reconcileSite.test.js does, so this runs with no
 * network/config — the two-window repro this ticket asks for, expressed as the two SERVER
 * RESPONSES a real trigger refusal and a real self-heal produce, rather than two browser windows
 * (which this environment cannot drive — see BACKLOG.md's NEW-1 for why that path was ruled out). */
const h = vi.hoisted(() => ({ updateResponses: [], reconcileRow: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (table) => {
      if (table !== "sites") throw new Error(`unexpected table ${table}`);
      return {
        update: () => {
          const callIdx = h.updateCallCount++;
          const chain = {
            eq: () => chain,
            select: async () => h.updateResponses[callIdx] ?? { data: [], error: null },
          };
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

const model = (over = {}) => ({ id: "s1", name: "Concept A", updatedAt: 1000, settings: { grid: true }, ...over });

describe("NEW-1 — cloudUpsertCore surfaces a write the database refused, never as success", () => {
  beforeEach(() => {
    clearSiteVersions();
    h.updateCallCount = 0;
    h.updateResponses = [];
    h.reconcileRow = null;
  });

  it("returns { ok:false, conflict:true, unresolved:true } when the self-heal retry ALSO comes back empty", async () => {
    _siteVersions.s1 = 1; // this tab's stale local token
    h.updateResponses = [
      { data: [], error: null }, // 1st attempt: 0 rows — a stale write OR a trigger refusal; the client can't and needn't tell which
      { data: [], error: null }, // the self-heal's own retry ALSO refused/lost the race
    ];
    h.reconcileRow = { data: { id: "s1", name: "Concept A (elsewhere)" }, version: 5 }; // what fetchSiteForReconcile finds

    const r = await cloudUpsert("u1", model());

    expect(r).toEqual({ ok: false, conflict: true, unresolved: true });
    expect(h.updateCallCount).toBe(2); // proves the one-shot self-heal really was attempted before giving up
    expect(_siteVersions.s1).toBe(5); // the token IS refreshed by the reconcile fetch, so a later manual retry isn't doomed either
  });

  it("does NOT mark unresolved when the self-heal retry succeeds (the ordinary, common case)", async () => {
    _siteVersions.s1 = 1;
    h.updateResponses = [
      { data: [], error: null },              // 1st attempt loses the race
      { data: [{ version: 6 }], error: null }, // retry at the refreshed version lands
    ];
    h.reconcileRow = { data: { id: "s1", name: "Concept A" }, version: 5 };

    const r = await cloudUpsert("u1", model());

    expect(r.ok).toBe(true);
    expect(r.unresolved).toBeFalsy();
    expect(_siteVersions.s1).toBe(6);
  });

  it("an ordinary first-try success never carries conflict/unresolved", async () => {
    _siteVersions.s1 = 3;
    h.updateResponses = [{ data: [{ version: 4 }], error: null }];

    const r = await cloudUpsert("u1", model());

    expect(r).toEqual({ ok: true });
    expect(h.updateCallCount).toBe(1);
  });
});
