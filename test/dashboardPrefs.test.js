import { describe, it, expect, beforeEach, vi } from "vitest";

/* dashboardPrefs — NEW-1 (2026-09-17): the Jump-back-in card's persisted row count rides the
 * SAME `profiles.prefs` read-modify-write cycle as the rest of the Dashboard layout (owner
 * instruction: "extend that persistence rather than inventing a second settings store"). These
 * tests exercise the cloud round trip; the pure clamp/default logic itself is covered by
 * dashboardLayout.test.js's `normalizeJumpBackInCount` suite.
 *
 * Mocks the one shared Supabase client module both dashboardPrefs.js AND profileRowCache.js
 * import (same resolved path from both locations) — same shape as dashboardDocFetch.test.js's
 * mock of the `sites` table.
 */
const h = vi.hoisted(() => ({ row: null, upsertErr: null, upserts: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: (table) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: h.row, error: null }),
          }),
        }),
        upsert: (payload) => {
          h.upserts.push(payload);
          if (h.upsertErr) return Promise.resolve({ error: h.upsertErr });
          h.row = { id: payload.id, prefs: payload.prefs };
          return Promise.resolve({ error: null });
        },
      };
    },
  },
}));

import { invalidateProfileRow } from "../src/shared/profile/profileRowCache.js";
import { loadDashboardLayout, saveDashboardLayout } from "../src/workspaces/dashboard/lib/dashboardPrefs.js";
import { JUMP_BACK_IN_COUNT_DEFAULT, JUMP_BACK_IN_COUNT_MAX, DEFAULT_LAYOUT } from "../src/workspaces/dashboard/lib/dashboardLayout.js";

describe("dashboardPrefs — jumpBackInCount persistence (NEW-1, 2026-09-17)", () => {
  beforeEach(() => {
    h.row = null; h.upsertErr = null; h.upserts = [];
    invalidateProfileRow(); // clear the shared session cache between tests (no uid = clear all)
  });

  it("signed out (no uid) — falls back to the default", async () => {
    const { jumpBackInCount, source } = await loadDashboardLayout(null);
    expect(jumpBackInCount).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
    expect(source).toBe("local");
  });

  it("a user who has never touched the setting (no dashboardJumpBackInCount in prefs yet) gets the default, not zero or empty", async () => {
    h.row = { prefs: { dashboardLayout: DEFAULT_LAYOUT, dashboardDismissedCards: [] } };
    const { jumpBackInCount, source } = await loadDashboardLayout("u1");
    expect(jumpBackInCount).toBe(JUMP_BACK_IN_COUNT_DEFAULT);
    expect(source).toBe("cloud");
  });

  it("round-trips a saved count through the cloud row", async () => {
    h.row = { prefs: {} };
    const save = await saveDashboardLayout("u2", DEFAULT_LAYOUT, [], 5);
    expect(save.ok).toBe(true);
    expect(save.jumpBackInCount).toBe(5);
    invalidateProfileRow("u2");
    const loaded = await loadDashboardLayout("u2");
    expect(loaded.jumpBackInCount).toBe(5);
  });

  it("saving normalizes an out-of-range count before it reaches the cloud row", async () => {
    h.row = { prefs: {} };
    const save = await saveDashboardLayout("u3", DEFAULT_LAYOUT, [], 999);
    expect(save.jumpBackInCount).toBe(JUMP_BACK_IN_COUNT_MAX);
    expect(h.upserts[0].prefs.dashboardJumpBackInCount).toBe(JUMP_BACK_IN_COUNT_MAX);
  });

  it("saving preserves every OTHER key already in prefs (read-modify-write, doesn't clobber sibling settings)", async () => {
    h.row = { prefs: { someOtherFeature: { foo: "bar" } } };
    await saveDashboardLayout("u4", DEFAULT_LAYOUT, [], 2);
    expect(h.upserts[0].prefs.someOtherFeature).toEqual({ foo: "bar" });
  });

  it("a failed cloud write is reported, never swallowed into a silent success (LOUD-FAILURE)", async () => {
    h.row = { prefs: {} };
    h.upsertErr = { message: "network down" };
    const save = await saveDashboardLayout("u5", DEFAULT_LAYOUT, [], 4);
    expect(save.ok).toBe(false);
    expect(save.error).toBe("network down");
  });
});
