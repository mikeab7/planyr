import { describe, it, expect, vi } from "vitest";

/* B2 audit item 2: cloudRenameGroupFallback must not call a write the version guard refused (HTTP 200,
 * zero rows) a success — it advances `version` and asks for the row back, like cloudRole's fallback. */
const h = vi.hoisted(() => ({ updateCalls: [], updateReturns: null, rows: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function" } }),
    from: () => ({
      select: () => ({ then: (resolve) => resolve({ data: h.rows, error: null }) }),
      update: (payload) => {
        const idx = h.updateCalls.length;
        h.updateCalls.push(payload);
        return { eq: () => ({ select: async () => (h.updateReturns ? h.updateReturns[idx] : { data: [{ id: "row" }], error: null }) }) };
      },
    }),
  },
}));
vi.mock("../src/workspaces/site-planner/lib/cloudSync.js", () => ({ _siteVersions: {}, _lastHeaderSig: {} }));

import { cloudRenameGroup } from "../src/workspaces/site-planner/lib/cloudRename.js";

describe("cloudRenameGroupFallback refused-write guard", () => {
  it("a zero-row (refused) write reports ok:false", async () => {
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", site: "Old" }, version: 4 }];
    h.updateCalls = []; h.updateReturns = [{ data: [], error: null }];
    const res = await cloudRenameGroup("u", "g1", "New", 123);
    expect(res.ok).toBe(false);
  });
  it("advances version and succeeds when the row comes back", async () => {
    h.rows = [{ id: "g1", data: { id: "g1", groupId: "g1", site: "Old" }, version: 4 }];
    h.updateCalls = []; h.updateReturns = null;
    const res = await cloudRenameGroup("u", "g1", "New", 123);
    expect(res.ok).toBe(true);
    expect(h.updateCalls[0].version).toBe(5);
  });
});
