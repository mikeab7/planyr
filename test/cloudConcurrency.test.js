import { describe, it, expect } from "vitest";
import { interpretCas, interpretInsert, isMissingVersionColumn, casUpsert, degradeUpsert } from "../src/shared/cloud/optimisticUpsert.js";

// B314 — optimistic concurrency: a save carries the version it last synced; the DB applies it
// only if the stored version still matches, else the write is REJECTED as a conflict (no silent
// clobber). Until the `version` column is migrated in, writes degrade to a plain upsert.

describe("isMissingVersionColumn — detects the un-migrated state", () => {
  it("matches the Postgres undefined-column error for version (42703)", () => {
    expect(isMissingVersionColumn({ code: "42703", message: 'column "version" does not exist' })).toBe(true);
  });
  it("matches the PostgREST schema-cache miss for version (PGRST204)", () => {
    expect(isMissingVersionColumn({ code: "PGRST204", message: "Could not find the 'version' column of 'sites' in the schema cache" })).toBe(true);
  });
  it("does NOT misfire on a DIFFERENT missing column (e.g. doc_reviews' project_id)", () => {
    // critical: a missing library column must not be mistaken for "version guard is un-migrated"
    expect(isMissingVersionColumn({ code: "42703", message: 'column "project_id" does not exist' })).toBe(false);
  });
  it("is false for unrelated errors and for no error", () => {
    expect(isMissingVersionColumn({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(isMissingVersionColumn(null)).toBe(false);
  });
});

describe("interpretCas — the conditional-UPDATE outcome", () => {
  it("0 rows updated → conflict (someone advanced the row, or it's gone)", () => {
    expect(interpretCas([], null)).toEqual({ ok: false, conflict: true });
  });
  it("a returned row → applied, with the new version", () => {
    expect(interpretCas([{ version: 8 }], null)).toEqual({ ok: true, version: 8 });
  });
  it("missing-column error → degrade (caller plain-upserts)", () => {
    expect(interpretCas(null, { code: "42703", message: 'column "version" does not exist' })).toEqual({ degrade: true });
  });
  it("any other error → a plain error (not a conflict, not a degrade)", () => {
    const r = interpretCas(null, { message: "boom" });
    expect(r.ok).toBe(false); expect(r.conflict).toBeUndefined(); expect(r.degrade).toBeUndefined();
  });
});

describe("interpretInsert — the new-row outcome", () => {
  it("a unique-violation (23505) → conflict (the row already exists)", () => {
    expect(interpretInsert(null, { code: "23505" })).toEqual({ ok: false, conflict: true });
  });
  it("a returned row → applied at its version", () => {
    expect(interpretInsert([{ version: 1 }], null)).toEqual({ ok: true, version: 1 });
  });
  it("missing-column error → degrade", () => {
    expect(interpretInsert(null, { code: "42703", message: 'column "version" does not exist' })).toEqual({ degrade: true });
  });
});

// A tiny chainable stand-in for the supabase query builder.
function mockClient(result, capture = {}) {
  const chain = {
    insert(v) { capture.op = "insert"; capture.values = v; return chain; },
    update(v) { capture.op = "update"; capture.values = v; return chain; },
    eq(k, val) { (capture.eq ||= []).push([k, val]); return chain; },
    select() { return Promise.resolve(result); },
  };
  return { from(t) { capture.table = t; return chain; } };
}

describe("casUpsert — wires expected-version into the right write", () => {
  const row = { id: "s1", user_id: "u1", data: { id: "s1" } };

  it("a brand-new row (no expected version) inserts at version 1", async () => {
    const cap = {};
    const r = await casUpsert(mockClient({ data: [{ version: 1 }], error: null }, cap), "sites", { uid: "u1", id: "s1", row, expected: undefined });
    expect(r).toEqual({ ok: true, version: 1 });
    expect(cap.op).toBe("insert");
    expect(cap.values.version).toBe(1);
  });

  it("an existing row guards on the expected version and bumps it", async () => {
    const cap = {};
    const r = await casUpsert(mockClient({ data: [{ version: 6 }], error: null }, cap), "sites", { uid: "u1", id: "s1", row, expected: 5 });
    expect(r).toEqual({ ok: true, version: 6 });
    expect(cap.op).toBe("update");
    expect(cap.values.version).toBe(6); // expected + 1
    // TEAM: the CAS guard filters on (id, version) only — NOT user_id — so a teammate can update
    // a shared row without a false conflict; RLS enforces access. (B-TEAM)
    expect(cap.eq).toEqual([["id", "s1"], ["version", 5]]);
  });

  it("stamps the creator (user_id) on INSERT from the uid arg, not on UPDATE", async () => {
    const insCap = {};
    await casUpsert(mockClient({ data: [{ version: 1 }], error: null }, insCap), "sites",
      { uid: "creator-1", id: "s1", row: { id: "s1", data: { id: "s1" } }, expected: undefined });
    expect(insCap.op).toBe("insert");
    expect(insCap.values.user_id).toBe("creator-1"); // creator stamped here

    const updCap = {};
    await casUpsert(mockClient({ data: [{ version: 2 }], error: null }, updCap), "sites",
      { uid: "teammate-2", id: "s1", row: { id: "s1", data: { id: "s1" } }, expected: 1 });
    expect(updCap.op).toBe("update");
    expect("user_id" in updCap.values).toBe(false); // a teammate edit never re-stamps the owner
  });

  it("a stale write (0 rows match the expected version) is a conflict, not applied", async () => {
    const r = await casUpsert(mockClient({ data: [], error: null }), "sites", { uid: "u1", id: "s1", row, expected: 5 });
    expect(r).toEqual({ ok: false, conflict: true });
  });

  it("degrades when the version column is absent (pre-migration)", async () => {
    const r = await casUpsert(mockClient({ data: null, error: { code: "42703", message: 'column "version" does not exist' } }), "sites", { uid: "u1", id: "s1", row, expected: 5 });
    expect(r).toEqual({ degrade: true });
  });

  it("never throws — a thrown client becomes a typed error", async () => {
    const throwing = { from() { throw new Error("network down"); } };
    const r = await casUpsert(throwing, "sites", { uid: "u1", id: "s1", row, expected: 5 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network down/);
  });
});

// ⛔ B891184-FOLLOWUP-3 / model_sheets (2026-09-01) — casUpsert was written against
// doc_reviews/sites' single-column "id" PK and every write silently assumed it. model_sheets'
// real primary key is COMPOSITE (user_id, id) — deliberate: it scopes a sheet to one user × one
// project so two users can each hold their own model for the same project id. A caller on a
// composite-keyed table now passes its own `conflictTarget` explicitly instead of relying on the
// baked-in "id" assumption; the default keeps every existing single-column caller (sites,
// doc_reviews, site_plan_overlays) byte-for-byte unchanged.
describe("casUpsert — conflictTarget: composite-key tables filter on every key column, not just id", () => {
  const row = { id: "proj-1", data: { cells: {} } };

  it("default conflictTarget ('id') is UNCHANGED — every existing single-column-PK caller regresses to nothing", async () => {
    const cap = {};
    const r = await casUpsert(mockClient({ data: [{ version: 6 }], error: null }, cap), "sites", { uid: "u1", id: "s1", row, expected: 5 });
    expect(r).toEqual({ ok: true, version: 6 });
    expect(cap.eq).toEqual([["id", "s1"], ["version", 5]]);
  });

  it("conflictTarget 'user_id,id' filters the CAS update on BOTH columns, then version", async () => {
    const cap = {};
    const r = await casUpsert(
      mockClient({ data: [{ version: 2 }], error: null }, cap),
      "model_sheets",
      { uid: "u1", id: "proj-1", row, expected: 1, conflictTarget: "user_id,id" }
    );
    expect(r).toEqual({ ok: true, version: 2 });
    expect(cap.eq).toEqual([["user_id", "u1"], ["id", "proj-1"], ["version", 1]]);
  });

  it("a stale version is STILL rejected as a conflict on a composite target — the CAS guard itself is untouched", async () => {
    const r = await casUpsert(mockClient({ data: [], error: null }), "model_sheets", { uid: "u1", id: "proj-1", row, expected: 1, conflictTarget: "user_id,id" });
    expect(r).toEqual({ ok: false, conflict: true });
  });

  it("an unsupported conflict-target column is refused rather than silently guessed at", async () => {
    const r = await casUpsert(mockClient({ data: [{ version: 1 }], error: null }), "widgets", { uid: "u1", id: "w1", row, expected: 0, conflictTarget: "team_id" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unsupported conflict-target column "team_id"/);
  });
});

// The ONE place PostgREST's ON CONFLICT syntax appears in this module — the degrade-fallback
// plain upsert, used only while the `version` column itself is un-migrated. This is exactly
// where model_sheets' dormant fallback (fixed in B891184-FOLLOWUP-2) named the wrong column and
// would have raised Postgres 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
// specification") had it ever run un-migrated.
describe("degradeUpsert — the shared degrade-fallback targets the caller's OWN conflict target", () => {
  function mockUpsertClient(result, capture = {}) {
    return { from(t) { capture.table = t; return { upsert(v, opts) { capture.values = v; capture.opts = opts; return Promise.resolve(result); } }; } };
  }

  it("default target ('id') is unchanged for a single-column-PK table", async () => {
    const cap = {};
    const r = await degradeUpsert(mockUpsertClient({ error: null }, cap), "sites", { row: { id: "s1", data: {} } });
    expect(r).toEqual({ ok: true, error: null });
    expect(cap.opts).toEqual({ onConflict: "id" });
  });

  it("passes the caller's composite conflictTarget through verbatim — never 'id' for model_sheets", async () => {
    const cap = {};
    const row = { id: "proj-1", user_id: "u1", data: { cells: {} } };
    const r = await degradeUpsert(mockUpsertClient({ error: null }, cap), "model_sheets", { row, conflictTarget: "user_id,id" });
    expect(r).toEqual({ ok: true, error: null });
    expect(cap.opts).toEqual({ onConflict: "user_id,id" });
    expect(cap.values).toBe(row);
  });

  it("a write error (e.g. the 42P10 this closes) surfaces as a typed failure, never silence", async () => {
    const r = await degradeUpsert(
      mockUpsertClient({ error: { code: "42P10", message: "there is no unique or exclusion constraint matching the ON CONFLICT specification" } }),
      "model_sheets",
      { row: { id: "proj-1", user_id: "u1", data: {} }, conflictTarget: "id" } // deliberately wrong target — proves the failure is surfaced, not swallowed
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no unique or exclusion constraint/);
  });

  it("never throws — a thrown client becomes a typed error", async () => {
    const throwing = { from() { throw new Error("network down"); } };
    const r = await degradeUpsert(throwing, "model_sheets", { row: { id: "s1" }, conflictTarget: "user_id,id" });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network down/);
  });
});
