/* NEW-1 (B2163344) — "Your last change didn't reach the cloud" fired on writes that DID land.
 * A write whose reply is lost in transit ("Failed to fetch") has an UNKNOWN outcome: the row may
 * already carry it. cloudUpsert must re-read the row and re-push once, and report only the FINAL
 * result — so the banner is driven by the outcome, never by one lost reply.
 * (Red on main: the lost reply was reported as { ok:false } although the row held the change.) */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = { rows: {}, script: [] };
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => {
  const builder = (table) => {
    const ctx = { op: null, patch: null, filters: {} };
    const b = {
      insert(row) { ctx.op = "insert"; ctx.patch = row; return b; },
      update(row) { ctx.op = "update"; ctx.patch = row; return b; },
      select() { if (!ctx.op) ctx.op = "select"; return b; },
      eq(k, v) { ctx.filters[k] = v; return b; },
      maybeSingle() { const r = state.rows[ctx.filters.id]; return Promise.resolve({ data: r ? { data: r.data, version: r.version } : null, error: null }); },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    const run = () => {
      if (ctx.op === "insert") { state.rows[ctx.patch.id] = { data: ctx.patch.data, version: 1 }; return { data: [{ version: 1 }], error: null }; }
      const row = state.rows[ctx.filters.id];
      const lose = state.script.shift() === "lose-reply"; // server applies the write, the reply never arrives
      const ok = row && row.version === ctx.filters.version;
      if (ok) { state.rows[ctx.filters.id] = { data: ctx.patch.data, version: ctx.patch.version }; }
      if (lose) return { data: null, error: { message: "TypeError: Failed to fetch" } };
      return ok ? { data: [{ version: ctx.patch.version }], error: null } : { data: [], error: null };
    };
    return b;
  };
  return { supabase: { from: builder }, supabaseRest: () => null, currentAccessToken: () => null };
});
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: vi.fn() }));

import { cloudUpsert } from "../src/workspaces/site-planner/lib/cloudSync.js";

const model = (n, id = "s1") => ({ id, site: "Throwaway", name: "Plan 1", settings: { n }, parcels: [], els: [], sheetOverlays: [] });

describe("cloudUpsert — a lost reply is not a failed write", () => {
  beforeEach(() => { state.rows = {}; state.script = []; });

  it("lost reply on a write that landed → re-read + re-push → final outcome ok", async () => {
    expect((await cloudUpsert("u1", model(1))).ok).toBe(true); // insert at v1
    state.script = ["lose-reply"];
    const r = await cloudUpsert("u1", model(2));
    expect(r.ok).toBe(true);
    expect(state.rows.s1.version).toBeGreaterThanOrEqual(3); // landed once, re-pushed once, never lost
  });

  it("a genuinely dead network still fails (and says so)", async () => {
    expect((await cloudUpsert("u1", model(1, "s2"))).ok).toBe(true);
    state.script = ["lose-reply", "lose-reply"];
    const r = await cloudUpsert("u1", model(3, "s2"));
    expect(r.ok).toBe(false);
  });
});
