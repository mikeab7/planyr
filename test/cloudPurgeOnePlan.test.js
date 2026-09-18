import { describe, it, expect, beforeEach, vi } from "vitest";

/* B1767168 — `cloudPurgeOnePlan` is the client wrapper around the `purge_one_deleted_plan` RPC
 * (db/purge_one_deleted_plan.sql), the deliberate door through `sites_block_delete_live_group`'s
 * BEFORE DELETE trigger for exactly one plan out of an otherwise-live project (the plan menu's
 * per-project "Recently deleted" ✕ — see storage.js's `purgeOnePlanFromLiveGroup`).
 *
 * Mocks supabase.js directly (same pattern as test/cloudHardDeleteCompDetach.test.js) so the REAL
 * cloudPurgeOnePlan implementation runs against a scripted rpc() stub. */
const h = vi.hoisted(() => ({
  rpcData: [{ id: "plan-a" }],
  rpcError: null,
  hardDeleteCalls: [],
}));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    rpc: async (fn, args) => {
      h.lastRpcCall = { fn, args };
      return { data: h.rpcError ? null : h.rpcData, error: h.rpcError };
    },
    from: () => {
      throw new Error("cloudPurgeOnePlan must not fall back to a raw DELETE except via cloudHardDelete");
    },
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
const events = vi.hoisted(() => []);
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: (...args) => events.push(args) }));

import { cloudPurgeOnePlan } from "../src/workspaces/site-planner/lib/cloudSync.js";

describe("cloudPurgeOnePlan — the RPC-backed single-plan purge", () => {
  beforeEach(() => {
    h.rpcData = [{ id: "plan-a" }];
    h.rpcError = null;
    h.lastRpcCall = null;
    events.length = 0;
  });

  it("calls the purge_one_deleted_plan RPC with the plan id", async () => {
    const out = await cloudPurgeOnePlan("u1", "plan-a");
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(1);
    expect(h.lastRpcCall).toEqual({ fn: "purge_one_deleted_plan", args: { p_id: "plan-a" } });
  });

  it("reports a server-side PLYR2 refusal (ownership / not-in-trash / no-live-sibling) LOUDLY, never as a silent no-op", async () => {
    h.rpcError = { code: "PLYR2", message: "purge_one_deleted_plan: refusing — plan-a has no live sibling in group g1" };
    const out = await cloudPurgeOnePlan("u1", "plan-a");
    expect(out.ok).toBe(false);
    expect(out.removed).toBe(0);
    expect(out.error).toBeTruthy();
    expect(events.find((e) => e[0] === "purge-one-plan-blocked")).toBeTruthy();
  });

  it("a genuine write failure is reported and surfaced, not swallowed", async () => {
    h.rpcError = { code: "500", message: "connection reset" };
    const out = await cloudPurgeOnePlan("u1", "plan-a");
    expect(out.ok).toBe(false);
    expect(out.error).toBe("connection reset");
    expect(events.find((e) => e[0] === "cloud-write-failed")).toBeTruthy();
  });

  it("a response matching zero rows is a failure, never a false success", async () => {
    h.rpcData = [];
    const out = await cloudPurgeOnePlan("u1", "plan-a");
    expect(out.ok).toBe(false);
    expect(out.removed).toBe(0);
    expect(events.find((e) => e[0] === "delete-zero-rows")).toBeTruthy();
  });

  it("returns a clean no-op when signed out or unconfigured", async () => {
    const out = await cloudPurgeOnePlan(null, "plan-a");
    expect(out).toEqual({ ok: true, removed: 0, skipped: true });
  });
});

/* A pre-migration DB (the RPC not yet deployed) must degrade to the ordinary cloudHardDelete — the
 * SAME refusal this purge already gets today — never a hard error and never a silent success. */
describe("cloudPurgeOnePlan — degrades to cloudHardDelete when the RPC isn't deployed yet (PGRST202)", () => {
  it("falls back and still reports whatever cloudHardDelete reports", async () => {
    vi.resetModules();
    vi.doMock("../src/workspaces/site-planner/lib/supabase.js", () => ({
      supabase: {
        rpc: async () => ({ data: null, error: { code: "PGRST202", message: "Could not find the function public.purge_one_deleted_plan" } }),
        from: (table) => {
          if (table !== "sites") throw new Error(`unexpected table ${table}`);
          return {
            select: () => ({ eq: () => ({ is: async () => ({ count: 0, error: null }) }) }),
            delete: () => ({
              eq: () => ({
                select: async () => ({ data: null, error: { code: "PLYR1", message: "This plan's project still has another active plan — it can't be permanently deleted while any of them are live." } }),
              }),
            }),
          };
        },
      },
      supabaseRest: () => ({ url: "", anon: "" }),
      currentAccessToken: () => null,
    }));
    vi.doMock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));
    const { cloudPurgeOnePlan: purgeFallback } = await import("../src/workspaces/site-planner/lib/cloudSync.js");
    const out = await purgeFallback("u1", "plan-a");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/another active plan/i);
  });
});
