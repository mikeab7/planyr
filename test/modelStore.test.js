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
 * on this table and would raise Postgres 42P10 had it ever run. Never fired in production (the
 * version column has existed since the table was created), but it's real dead-wrong code.
 *
 * Mock the supabase client (same pattern as test/cloudListIdIntegrity.test.js /
 * test/reconcileSite.test.js) so this runs without a network/config.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ insertResult: { data: [{ version: 1 }], error: null }, captured: {} }));
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
          return { eq: () => ({ eq: () => ({ select: () => Promise.resolve({ data: [{ version: 2 }], error: null }) }) }) };
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

describe("modelStore.saveCloudSheet — the row payload actually carries id", () => {
  beforeEach(() => { h.captured = {}; h.insertResult = { data: [{ version: 1 }], error: null }; });

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
});

describe("modelStore's dormant degrade path targets the REAL composite constraint", () => {
  // Force the primary casUpsert call to degrade (simulate a pre-migration "version column
  // missing" error) so the fallback plain-upsert path actually runs and can be inspected.
  beforeEach(() => {
    h.captured = {};
    h.insertResult = { data: null, error: { code: "42703", message: 'column "version" does not exist' } };
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
