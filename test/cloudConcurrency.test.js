import { describe, it, expect } from "vitest";
import { interpretCas, interpretInsert, isMissingVersionColumn, casUpsert } from "../src/shared/cloud/optimisticUpsert.js";

// B274 — optimistic concurrency: a save carries the version it last synced; the DB applies it
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
    expect(cap.eq).toEqual([["user_id", "u1"], ["id", "s1"], ["version", 5]]); // CAS guard
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
