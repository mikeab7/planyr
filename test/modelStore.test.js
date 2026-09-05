/* modelStore — the Model workspace's guarded cloud-save path (lib/modelStore.js).
 *
 * ⛔ B891184-FOLLOWUP-2 (live production finding, 2026-08-31) — the migration ran, the table
 * existed, RLS was fine, and every cloud save still silently did NOTHING: `upsertCore`'s `row`
 * was `{ data: sheet }` — no `id` — so casUpsert's INSERT branch (src/shared/cloud/
 * optimisticUpsert.js) sent `{ data, user_id, version }` with no `id` at all. Proven live
 * against production via a rolled-back, role-impersonated insert of that EXACT payload:
 * Postgres 23502 "null value in column \"id\" of relation \"model_sheets\" violates not-null
 * constraint" — a real error, but nothing in this whole path ever logs to the console, so it
 * reproduced the reported symptom exactly (zero rows, zero console messages). `sites`/
 * `doc_reviews` never hit this because their own row-builders (siteRowFor/reviewRowFor) already
 * include `id` — modelStore.js was the one caller that didn't.
 *
 * A second, separate defect: model_sheets' primary key is COMPOSITE — (user_id, id), not `id`
 * alone (deliberately: it scopes a sheet to one user × one project, so two users can each hold
 * their own model for the same project id) — confirmed live via `pg_constraint`. The dormant
 * degrade fallback (used only if the `version` column itself were ever un-migrated) called
 * `.upsert(..., { onConflict: "id" })`, which names a column with no matching unique constraint
 * on this table and would raise Postgres 42P10 had it ever run. Never fired in production at the
 * time (the version column had existed since the table was created), but it's real dead-wrong code.
 *
 * ⛔ 2026-09-01 — every guarded write on the PRIMARY (non-degrade) path had the SAME class of bug:
 * `casUpsert`'s CAS UPDATE filter — the real write path a live save actually takes once a row
 * exists — filtered on `id` alone, same "id names the row" assumption. `optimisticUpsert.js` now
 * takes an explicit `conflictTarget` (PostgREST onConflict-style, e.g. "user_id,id") instead of
 * assuming "id" anywhere, and modelStore.js passes "user_id,id" on every write, insert, CAS
 * update, and the degrade upsert alike (the degrade upsert now goes through the shared
 * `degradeUpsert` helper instead of a second hand-typed literal). sites/doc_reviews/
 * site_plan_overlays keep the "id" default untouched — see optimisticUpsert.js's own header.
 *
 * Mock the supabase client (same pattern as test/cloudListIdIntegrity.test.js /
 * test/reconcileSite.test.js) so this runs without a network/config.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  insertResult: { data: [{ version: 1 }], error: null },
  updateResult: { data: [{ version: 2 }], error: null },
  captured: {},
  ensureProjectResult: { ok: true, created: false },
}));
// B1202176 ×2 / B1160480 — modelStore's first cloud write for a project now ensures the
// project's own `sites` row exists first (storage.js's `ensureProjectRow`, re-exported here as
// `ensureProjectExists`) and BLOCKS the save if that fails — mocked directly so these tests
// control the verdict without a real network/config, same shape as the supabase mock above.
vi.mock("../src/shared/projects/projects.js", () => ({
  ensureProjectExists: vi.fn(async () => h.ensureProjectResult),
}));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({
  supabaseConfigured: () => true,
  supabase: {
    from(table) {
      h.captured.table = table;
      return {
        insert(v) {
          h.captured.op = "insert";
          h.captured.insertValues = v;
          return { select: () => Promise.resolve(h.insertResult) };
        },
        update(v) {
          h.captured.op = "update";
          h.captured.updateValues = v;
          h.captured.updateEq = [];
          // A real chainable .eq() — arbitrarily many calls before .select() — so the CAS
          // filter can name every conflict-target column (user_id AND id for model_sheets),
          // not just a hardcoded two-deep chain.
          const chain = {
            eq(k, val) { h.captured.updateEq.push([k, val]); return chain; },
            select: () => Promise.resolve(h.updateResult),
          };
          return chain;
        },
        upsert(v, opts) {
          h.captured.op = "degrade-upsert";
          h.captured.upsertValues = v;
          h.captured.upsertOpts = opts;
          return Promise.resolve({ error: null });
        },
        select() { return { eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }; },
      };
    },
  },
}));

import { saveCloudSheet } from "../src/workspaces/model/lib/modelStore.js";
import { ensureProjectExists } from "../src/shared/projects/projects.js";

describe("modelStore.saveCloudSheet — the row payload actually carries id", () => {
  beforeEach(() => {
    h.captured = {};
    h.insertResult = { data: [{ version: 1 }], error: null };
    h.updateResult = { data: [{ version: 2 }], error: null };
    h.ensureProjectResult = { ok: true, created: false };
    vi.clearAllMocks();
  });

  it("a brand-new project's first save inserts a payload that includes id (the fix)", async () => {
    const r = await saveCloudSheet({ uid: "u1", projectId: "proj-1", sheet: { cells: {} }, expected: null });
    expect(h.captured.op).toBe("insert");
    // THE regression check: before the fix this was `{ data, user_id, version }` — no id at
    // all — which is exactly what Postgres's real not-null constraint rejected live.
    expect(h.captured.insertValues.id).toBe("proj-1");
    expect(h.captured.insertValues.user_id).toBe("u1");
    expect(h.captured.insertValues.version).toBe(1);
    expect(r).toEqual({ ok: true, version: 1 });
  });

  it("a NOT NULL violation on id (proven live against production) surfaces as a real error, not silence", async () => {
    h.insertResult = { data: null, error: { code: "23502", message: 'null value in column "id" of relation "model_sheets" violates not-null constraint' } };
    const r = await saveCloudSheet({ uid: "u1", projectId: "proj-1", sheet: { cells: {} }, expected: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("error");
    expect(r.error).toMatch(/not-null constraint/);
  });

  it("a subsequent save (existing version) updates, not inserts", async () => {
    const r = await saveCloudSheet({ uid: "u1", projectId: "proj-1", sheet: { cells: { "c1:0": "1" } }, expected: 1 });
    expect(h.captured.op).toBe("update");
    expect(r).toEqual({ ok: true, version: 2 });
  });

  // ⛔ 2026-09-01 — the CAS UPDATE (the real, non-degrade write path — a PATCH, not the plain
  // POST insert) must filter on model_sheets' REAL composite identity, user_id AND id, not just
  // id. This is `casUpsert`'s new `conflictTarget` wired all the way through from modelStore.
  it("the CAS update filters on BOTH user_id and id (model_sheets' real composite key), plus version", async () => {
    await saveCloudSheet({ uid: "u1", projectId: "proj-1", sheet: { cells: { "c1:0": "1" } }, expected: 1 });
    expect(h.captured.updateEq).toEqual([["user_id", "u1"], ["id", "proj-1"], ["version", 1]]);
  });

  it("a stale version on the CAS update is rejected as a conflict, never silently applied", async () => {
    h.updateResult = { data: [], error: null }; // 0 rows matched — someone else advanced it
    const r = await saveCloudSheet({ uid: "u1", projectId: "proj-1", sheet: { cells: { "c1:0": "1" } }, expected: 1 });
    expect(r).toEqual({ ok: false, reason: "conflict" });
  });
});

// B1202176 ×2 / B1160480 — the project-row guard actually gates the write (never a silent
// best-effort): a failed/soft-deleted project means no model_sheets row is attempted at all.
describe("modelStore.saveCloudSheet — the project-row guard BLOCKS the write on failure", () => {
  beforeEach(() => {
    h.captured = {};
    h.ensureProjectResult = { ok: true, created: false };
    vi.clearAllMocks();
  });

  it("ensures the project's row exists, by id and a default name, before writing anything", async () => {
    await saveCloudSheet({ uid: "u1", projectId: "proj-new", sheet: { cells: {} }, expected: null });
    expect(ensureProjectExists).toHaveBeenCalledWith("proj-new", { name: "Untitled project" });
    expect(h.captured.table).toBe("model_sheets"); // the write proceeded
  });

  it("a project that can't be confirmed with the cloud refuses the save — no model_sheets write at all", async () => {
    h.ensureProjectResult = { ok: false, created: false, error: "couldn't reach the cloud" };
    const r = await saveCloudSheet({ uid: "u1", projectId: "proj-flaky", sheet: { cells: {} }, expected: null });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("error");
    expect(typeof r.error).toBe("string");
    expect(h.captured.table).toBeUndefined(); // model_sheets was never touched
  });

  it("a genuinely soft-deleted project refuses the save with a clear reason", async () => {
    h.ensureProjectResult = { ok: false, created: false, deleted: true, error: "This project has been deleted." };
    const r = await saveCloudSheet({ uid: "u1", projectId: "proj-deleted", sheet: { cells: {} }, expected: null });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/deleted/i);
    expect(h.captured.table).toBeUndefined();
  });
});

describe("modelStore's dormant degrade path targets the REAL composite constraint", () => {
  // Force the primary casUpsert call to degrade (simulate a pre-migration "version column
  // missing" error) so the fallback plain-upsert path actually runs and can be inspected.
  beforeEach(() => {
    h.captured = {};
    h.insertResult = { data: null, error: { code: "42703", message: 'column "version" does not exist' } };
    h.ensureProjectResult = { ok: true, created: false };
  });

  it("upserts onConflict 'user_id,id' — NOT the single-column 'id' that has no matching constraint", async () => {
    await saveCloudSheet({ uid: "u1", projectId: "proj-1", sheet: { cells: {} }, expected: null });
    expect(h.captured.op).toBe("degrade-upsert");
    // model_sheets' real primary key is (user_id, id) — proven live via pg_constraint. Before
    // the fix this was `{ onConflict: "id" }`, which names no unique constraint on this table
    // and would raise Postgres 42P10 the moment this dormant path ever ran.
    expect(h.captured.upsertOpts).toEqual({ onConflict: "user_id,id" });
    expect(h.captured.upsertValues).toMatchObject({ id: "proj-1", user_id: "u1" });
  });
});
