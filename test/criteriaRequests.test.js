import { describe, it, expect } from "vitest";
import { requestCriteria, wasRequested } from "../src/workspaces/site-planner/lib/criteriaRequests.js";

// A minimal injectable localStorage-shaped store, so this stays Node-testable with no DOM.
function fakeStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}
// A minimal injectable supabase-js-shaped client. `insertResult` is what .insert() resolves to.
function fakeClient(insertResult, { throwErr } = {}) {
  const calls = [];
  return {
    calls,
    from: (table) => ({
      insert: (row) => {
        calls.push({ table, row });
        if (throwErr) return Promise.reject(throwErr);
        return Promise.resolve(insertResult);
      },
    }),
  };
}

// ⛔ B877440/B877441 — "Request criteria for this county" is the ONE action a no-data state
// offers. LOUD-FAILURE: a request that doesn't reach the server must say so and must NEVER
// render as filed; a second click from the same user/plan must never file twice.
describe("requestCriteria", () => {
  it("refuses with no countyKey/family — never silently no-ops as success", async () => {
    const r = await requestCriteria(fakeClient({ error: null }), { family: "detention" }, fakeStore());
    expect(r.ok).toBe(false);
    const r2 = await requestCriteria(fakeClient({ error: null }), { countyKey: "tarrant" }, fakeStore());
    expect(r2.ok).toBe(false);
  });

  it("files a fresh request and marks it — a second call reads back as a duplicate WITHOUT hitting the server again", async () => {
    const store = fakeStore();
    const client = fakeClient({ error: null });
    const r1 = await requestCriteria(client, { countyKey: "tarrant", countyLabel: "Tarrant County", state: "TX", family: "detention" }, store);
    expect(r1).toMatchObject({ ok: true, duplicate: false });
    expect(client.calls.length).toBe(1);
    expect(client.calls[0].row).toMatchObject({ county_key: "tarrant", county_label: "Tarrant County", state: "TX", family: "detention" });

    const r2 = await requestCriteria(client, { countyKey: "tarrant", family: "detention" }, store);
    expect(r2).toMatchObject({ ok: true, duplicate: true });
    // The second call never reached the server — the local mark alone is enough to refuse a re-file.
    expect(client.calls.length).toBe(1);
    expect(wasRequested("tarrant", "detention", store)).toBe(r1.at);
  });

  it("a server unique-violation (23505) reports duplicate, not an error — the row already exists", async () => {
    const store = fakeStore();
    const client = fakeClient({ error: { code: "23505", message: "duplicate key" } });
    const r = await requestCriteria(client, { countyKey: "dallas", family: "easement" }, store);
    expect(r).toMatchObject({ ok: true, duplicate: true });
    expect(wasRequested("dallas", "easement", store)).toBeTruthy();
  });

  it("LOUD-FAILURE: a real server error is reported honestly and never marked as filed", async () => {
    const store = fakeStore();
    const client = fakeClient({ error: { code: "42501", message: "permission denied" } });
    const r = await requestCriteria(client, { countyKey: "hartley", family: "pond" }, store);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/permission denied/);
    expect(wasRequested("hartley", "pond", store)).toBeNull();
  });

  it("LOUD-FAILURE: no client (offline/unconfigured) is reported honestly, never rendered as filed", async () => {
    const store = fakeStore();
    const r = await requestCriteria(null, { countyKey: "webb", family: "detention" }, store);
    expect(r.ok).toBe(false);
    expect(wasRequested("webb", "detention", store)).toBeNull();
  });

  it("LOUD-FAILURE: a thrown network error is reported honestly, never rendered as filed", async () => {
    const store = fakeStore();
    const client = fakeClient(null, { throwErr: new Error("network down") });
    const r = await requestCriteria(client, { countyKey: "potter", family: "detention" }, store);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network down/);
    expect(wasRequested("potter", "detention", store)).toBeNull();
  });

  it("different families for the same county are independent requests", async () => {
    const store = fakeStore();
    const client = fakeClient({ error: null });
    await requestCriteria(client, { countyKey: "tarrant", family: "detention" }, store);
    const r = await requestCriteria(client, { countyKey: "tarrant", family: "easement" }, store);
    expect(r.duplicate).toBe(false);
    expect(client.calls.length).toBe(2);
  });
});
