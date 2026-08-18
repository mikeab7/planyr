import { describe, it, expect, beforeEach, vi } from "vitest";

/* NEW-1 — a site row's real PostgREST primary key (`id`) must win over whatever id happens to be
 * embedded in its jsonb `data`.
 *
 * Repro (see e2e/new1-team-plan-count.spec.js for the full end-to-end browser proof): a team's
 * shared project reportedly showed only ONE plan in the "Plans in this site" switcher when the
 * database genuinely held five rows for that group. `mergePulledSites` keys its ENTIRE merge map
 * by `id` (`map[n.id] = ...`), and before this fix `cloudList` never even SELECTed the row's own
 * primary key — it trusted `data.id` unconditionally. So two physical rows whose jsonb happened
 * to share one `id` (a stale duplicate, a hand-edited row, a migration slip — the exact anomaly
 * was never checked for on the real Goose Creek rows, only `group_id`/`data->>'groupId'` were)
 * silently collapse to ONE surviving plan in `map`, with no error anywhere: exactly the reported
 * shape of "the database has 5 rows, the app shows fewer."
 *
 * The fix: cloudList now selects `id` alongside `data` and corrects a drifted jsonb id to match
 * the row's real one BEFORE anything downstream ever sees it — the same pattern B714 already uses
 * to overlay DB-column truth (team_id/user_id/share_locked) onto the jsonb rather than trusting it
 * wholesale — and reports the correction loudly (LOUD-FAILURE), since a drifted id is itself a
 * genuine data anomaly worth surfacing even though this heals it in place.
 *
 * Mock the supabase client (same pattern as test/reconcileSite.test.js) so this runs without a
 * network/config. Hoisted holder — a vi.mock factory can't close over a normal top-level var.
 */
const h = vi.hoisted(() => ({ rows: [], reported: [] }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        is: () => ({ order: async () => ({ data: h.rows, error: null }) }),
      }),
    }),
  },
  supabaseRest: () => ({ url: "", anon: "" }),
  currentAccessToken: () => null,
}));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({
  reportClientEvent: (...args) => { h.reported.push(args); },
}));

import { cloudList, _siteVersions } from "../src/workspaces/site-planner/lib/cloudSync.js";
import { mergePulledSites } from "../src/workspaces/site-planner/lib/storage.js";

const row = ({ rowId, jsonId, groupId, name, version = 1, teamId = null, ownerId = null }) => ({
  id: rowId,
  data: { id: jsonId, groupId, name, site: "Goose Creek Industrial", updatedAt: 1000, els: [], markups: [], measures: [], callouts: [], parcels: [], elementsInRows: true },
  version, team_id: teamId, user_id: ownerId, share_locked: false,
});

describe("cloudList — the row's real primary key wins over a drifted jsonb id (NEW-1)", () => {
  beforeEach(() => { h.rows = []; h.reported.length = 0; for (const k of Object.keys(_siteVersions)) delete _siteVersions[k]; });

  it("a healthy row (jsonb id === row id) passes through unchanged, no report", async () => {
    h.rows = [row({ rowId: "s1", jsonId: "s1", groupId: "g1", name: "Concept A" })];
    const models = await cloudList("u1");
    expect(models).toHaveLength(1);
    expect(models[0].id).toBe("s1");
    expect(h.reported).toHaveLength(0);
  });

  it("corrects a drifted jsonb id to the row's real id, and reports it loudly", async () => {
    h.rows = [row({ rowId: "s2", jsonId: "s1", groupId: "g1", name: "Concept B" })]; // jsonb still claims s1
    const models = await cloudList("u1");
    expect(models[0].id).toBe("s2"); // corrected — the row's real PK wins
    expect(h.reported).toHaveLength(1);
    expect(h.reported[0][0]).toBe("cloud-id-mismatch");
    expect(h.reported[0][2]).toMatchObject({ rowId: "s2", jsonId: "s1" });
  });

  it("THE CORE REPRO: two rows whose jsonb collides on one id stay TWO DISTINCT plans (the fix)", async () => {
    // Five Goose Creek rows, five distinct real primary keys — exactly like the production
    // table (id is the PK; two physical rows can never share it). "Concept B"'s jsonb has
    // drifted to claim "Concept A"'s id. Pre-fix, cloudList returned both models with id "gc1",
    // and mergePulledSites' map[n.id] = ... silently kept only the LAST one processed.
    h.rows = [
      row({ rowId: "gc1", jsonId: "gc1", groupId: "gc", name: "Concept A" }),
      row({ rowId: "gc2", jsonId: "gc1", groupId: "gc", name: "Concept B" }), // <- the anomaly
      row({ rowId: "gc3", jsonId: "gc3", groupId: "gc", name: "Concept C" }),
      row({ rowId: "gc4", jsonId: "gc4", groupId: "gc", name: "Concept D" }),
      row({ rowId: "gc5", jsonId: "gc5", groupId: "gc", name: "Concept E" }),
    ];
    const models = await cloudList("u1");
    const ids = models.map((m) => m.id);
    expect(new Set(ids).size).toBe(5); // every id distinct — nothing collapses
    expect(models.map((m) => m.name).sort()).toEqual(["Concept A", "Concept B", "Concept C", "Concept D", "Concept E"]);
  });

  it("MUTATION CHECK: without the correction, the pre-fix shape is exactly what collapses a plan", () => {
    // Pins the actual failure mode `mergePulledSites` exhibits when handed two same-id models —
    // proves the merge step itself (not just cloudList) is where the data would be lost if the
    // id correction above were ever removed.
    const colliding = [
      { id: "gc1", groupId: "gc", name: "Concept A", updatedAt: 1000 },
      { id: "gc1", groupId: "gc", name: "Concept B", updatedAt: 1000 }, // uncorrected — same id as above
    ];
    const { map, idCollisions } = mergePulledSites({}, colliding, "u1", {});
    expect(Object.keys(map)).toHaveLength(1);       // ← the defect, reproduced directly: one survivor
    expect(map.gc1.name).toBe("Concept A");          // "Concept B" is gone, silently — no trace in `map`
    expect(idCollisions).toHaveLength(1);             // but it is no longer SILENT — the detector names it
    expect(idCollisions[0]).toMatchObject({ id: "gc1", groupId: "gc" });
  });
});
