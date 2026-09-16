import { describe, it, expect, vi } from "vitest";

/* B1181104 — cloudSetSiteRoleFallback (the degrade path for a DB without
 * db/set_site_group_role.sql) used to write `{ ...r.data, role }` with no `updatedAt` stamp —
 * the same defect the primary RPC had, fixed there by stamping `data.updatedAt`. This is the
 * fallback's own regression guard: mock the supabase client (same pattern as
 * test/siteRecency.test.js) so the write payload can be inspected directly. */
// NEW-1 (2026-09-16) — the update mock now mirrors casUpsert's own shape (`.update(payload).eq(
// col, val).select("id")`, awaited for a `{data, error}` result) rather than resolving at `.eq()`,
// because the fallback now asks PostgREST for the row back and reads an empty return as a refusal
// — exactly the gap that let this path report success on a write `sites_enforce_version_monotonic`
// had refused (see cloudRole.js's own header). `h.updateReturns` lets each test control what each
// successive write's `.select("id")` reports; defaults to "one row came back" (an ordinary success).
const h = vi.hoisted(() => ({ updateCalls: [], updateReturns: null }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    from: (t) => {
      if (t !== "sites") throw new Error(`unexpected table ${t}`);
      return {
        select: () => ({
          then: (resolve) => resolve({ data: h.rows, error: null }),
        }),
        update: (payload) => {
          const idx = h.updateCalls.length;
          h.updateCalls.push(payload);
          return {
            eq: () => ({
              select: async () => (h.updateReturns ? h.updateReturns[idx] : { data: [{ id: "row" }], error: null }),
            }),
          };
        },
      };
    },
  },
}));
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({ _siteVersions: {}, _lastHeaderSig: {} }));
vi.mock("../src/workspaces/site-planner/lib/siteStatus.js", async (importOriginal) => importOriginal());

import { cloudSetSiteRole } from "../src/workspaces/site-planner/lib/cloudRole.js";

describe("cloudSetSiteRoleFallback (the no-RPC degrade path) stamps data.updatedAt on every write", () => {
  it("bumps updatedAt so the flip is recognized as newer by mergeSiteContent's tie-break", async () => {
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", role: "pursuit", updatedAt: 1000, site: "Keep" }, version: 4 }];
    h.updateCalls = []; h.updateReturns = null;
    const before = Date.now();
    const res = await cloudSetSiteRole("uid1", "g1", "tracked");
    expect(res.ok).toBe(true);
    expect(res.atomic).toBe(false); // took the fallback
    expect(h.updateCalls).toHaveLength(1);
    const written = h.updateCalls[0].data;
    expect(written.role).toBe("tracked");
    expect(written.site).toBe("Keep"); // every other field carried through untouched
    expect(written.updatedAt).toBeGreaterThanOrEqual(before);
    expect(written.updatedAt).toBeGreaterThan(1000);
  });

  it("advances version past what was just read, so sites_enforce_version_monotonic accepts the write", async () => {
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", role: "pursuit", site: "Keep" }, version: 9 }];
    h.updateCalls = []; h.updateReturns = null;
    await cloudSetSiteRole("uid1", "g1", "tracked");
    expect(h.updateCalls[0].version).toBe(10); // strictly greater than the row's stored version (9)
  });
});

// NEW-1 (2026-09-16) — the concrete instance of the bug this ticket is about: a write the
// database REFUSES (the version guard, or any writer racing this one) must never be reported as
// having landed. Before this fix the fallback wrote `{ data }` with no version and never asked for
// the row back, so `sites_enforce_version_monotonic` refusing every one of these writes (its
// `new.version > old.version` never holds when `version` is absent from the payload) was
// indistinguishable from success — `error` was null either way, and nothing checked `data`.
describe("cloudSetSiteRoleFallback detects a write the database refused (zero rows returned)", () => {
  it("treats an empty `.select()` return as a failed write, not a success", async () => {
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", role: "pursuit", site: "Keep" }, version: 2 }];
    h.updateCalls = [];
    h.updateReturns = [{ data: [], error: null }]; // exactly what a trigger refusal looks like over PostgREST
    const res = await cloudSetSiteRole("uid1", "g1", "tracked");
    expect(res.ok).toBe(false); // MUST NOT report success
    expect(res.rows).toBe(0);
    expect(res.error).toMatch(/couldn't be updated/i);
  });

  it("still reports success when the row genuinely comes back", async () => {
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", role: "pursuit", site: "Keep" }, version: 2 }];
    h.updateCalls = [];
    h.updateReturns = [{ data: [{ id: "g1" }], error: null }];
    const res = await cloudSetSiteRole("uid1", "g1", "tracked");
    expect(res.ok).toBe(true);
  });
});
