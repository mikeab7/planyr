import { describe, it, expect, vi } from "vitest";

/* B1181104 — cloudSetSiteRoleFallback (the degrade path for a DB without
 * db/set_site_group_role.sql) used to write `{ ...r.data, role }` with no `updatedAt` stamp —
 * the same defect the primary RPC had, fixed there by stamping `data.updatedAt`. This is the
 * fallback's own regression guard: mock the supabase client (same pattern as
 * test/siteRecency.test.js) so the write payload can be inspected directly. */
const h = vi.hoisted(() => ({ updateCalls: [] }));
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
          h.updateCalls.push(payload);
          return { eq: async () => ({ error: null }) };
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
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", role: "pursuit", updatedAt: 1000, site: "Keep" } }];
    h.updateCalls = [];
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
});
