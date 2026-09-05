import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-1 (B843792 adversarial review, 2026-09-05) — `comps_project_id_fkey` is `ON DELETE SET
 * NULL`, so `cloudHardDelete` (the real row DELETE behind the 30-day lazy purge and "Delete
 * forever") could silently sever a Leasing Comp's link to its owning site with nothing recording
 * it happened. Fixed by taking a best-effort count of live comps still pointing at the row
 * BEFORE the delete and reporting it via telemetry AFTER a successful one — see cloudSync.js's
 * own header on `cloudHardDelete` for the full reasoning (this is recorded, not prevented: the
 * link genuinely cannot survive a real purge).
 *
 * Mocks supabase.js directly (same pattern as test/deletedProjectGate.test.js) so the REAL
 * cloudHardDelete implementation runs against a scripted query-builder stub, rather than
 * substituting a fake cloudHardDelete the way test/siteSoftDelete.test.js does for its own,
 * unrelated purpose.
 */
const h = vi.hoisted(() => ({ compsCount: 0, deleteRows: [{ id: "site-1" }], deleteError: null, calls: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (table) => {
      h.calls.push(table);
      if (table === "comps") {
        return {
          select: () => ({
            eq: () => ({
              is: async () => ({ count: h.compsCount, error: null }),
            }),
          }),
        };
      }
      // table === "sites"
      return {
        delete: () => ({
          eq: () => ({
            select: async () => ({ data: h.deleteError ? null : h.deleteRows, error: h.deleteError }),
          }),
        }),
      };
    },
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
const events = vi.hoisted(() => []);
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: (...args) => events.push(args) }));

import { cloudHardDelete } from "../src/workspaces/site-planner/lib/cloudSync.js";

describe("cloudHardDelete — reports a comp link severed by the FK's ON DELETE SET NULL (NEW-1)", () => {
  beforeEach(() => {
    h.compsCount = 0;
    h.deleteRows = [{ id: "site-1" }];
    h.deleteError = null;
    h.calls = [];
    events.length = 0;
  });

  it("no linked comps → deletes cleanly, no detach event", async () => {
    const out = await cloudHardDelete("u1", "site-1");
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(1);
    expect(events.find((e) => e[0] === "comp-project-detached-by-purge")).toBeUndefined();
  });

  it("2 live comps still pointing at this site → deletes, then reports the detach LOUDLY with the count", async () => {
    h.compsCount = 2;
    const out = await cloudHardDelete("u1", "site-1");
    expect(out.ok).toBe(true);
    expect(out.removed).toBe(1);
    const ev = events.find((e) => e[0] === "comp-project-detached-by-purge");
    expect(ev).toBeTruthy();
    expect(ev[2]).toEqual(expect.objectContaining({ id: "site-1", count: 2 }));
  });

  it("queries comps BEFORE deleting the site row (the count reflects pre-delete state)", async () => {
    h.compsCount = 1;
    await cloudHardDelete("u1", "site-1");
    expect(h.calls.indexOf("comps")).toBeLessThan(h.calls.lastIndexOf("sites"));
  });

  it("a delete that matches zero rows never reports a detach, even if comps were counted", async () => {
    h.compsCount = 3;
    h.deleteRows = [];
    const out = await cloudHardDelete("u1", "site-1");
    expect(out.removed).toBe(0);
    expect(events.find((e) => e[0] === "comp-project-detached-by-purge")).toBeUndefined();
    expect(events.find((e) => e[0] === "delete-zero-rows")).toBeTruthy();
  });

  it("a failed delete never reports a detach either", async () => {
    h.compsCount = 5;
    h.deleteError = { message: "permission denied" };
    const out = await cloudHardDelete("u1", "site-1");
    expect(out.ok).toBe(false);
    expect(events.find((e) => e[0] === "comp-project-detached-by-purge")).toBeUndefined();
  });
});
