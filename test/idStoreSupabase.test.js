import { describe, it, expect, vi } from "vitest";
import { supabaseIdStore } from "../server/storage/idStoreSupabase.js";
import { createIdMap } from "../server/storage/idMap.js";

const okRes = (json) => ({ ok: true, status: 200, json: async () => json });
const errRes = (status) => ({ ok: false, status, json: async () => ({}) });

describe("supabaseIdStore — durable Planyr↔Drive map (B207)", () => {
  it("get resolves a planyr key to its drive id (RLS-scoped via token)", async () => {
    const calls = [];
    const f = async (url, opts) => { calls.push({ url, opts }); return okRes([{ drive_id: "drive_9" }]); };
    const store = supabaseIdStore({ supabaseUrl: "https://p.supabase.co", anonKey: "anon", token: "tok", fetchImpl: f });
    expect(await store.get("u/proj/x.pdf")).toBe("drive_9");
    expect(calls[0].url).toMatch(/\/rest\/v1\/drive_files\?.*planyr_key=eq\./);
    expect(calls[0].opts.headers.authorization).toBe("Bearer tok");
    expect(calls[0].opts.headers.apikey).toBe("anon");
  });
  it("getByBackend reverses drive id → planyr key", async () => {
    const f = async () => okRes([{ planyr_key: "u/proj/x.pdf" }]);
    const store = supabaseIdStore({ supabaseUrl: "u", anonKey: "a", token: "t", fetchImpl: f });
    expect(await store.getByBackend("drive_9")).toBe("u/proj/x.pdf");
  });
  it("get returns null (not throw) on a missing table / error", async () => {
    const store = supabaseIdStore({ supabaseUrl: "u", anonKey: "a", token: "t", fetchImpl: async () => errRes(404) });
    expect(await store.get("k")).toBe(null);
  });
  it("set upserts and is best-effort (a failed write doesn't throw)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const calls = [];
    const f = async (url, opts) => { calls.push({ url, opts }); return errRes(404); };
    const store = supabaseIdStore({ supabaseUrl: "u", anonKey: "a", token: "t", fetchImpl: f });
    await expect(store.set("k", "drive_1")).resolves.toBeUndefined(); // no throw
    expect(calls[0].opts.method).toBe("POST");
    expect(calls[0].opts.headers.prefer).toMatch(/merge-duplicates/);
    warn.mockRestore();
  });
  it("works as a createIdMap store end-to-end (bind→resolve via the same backend)", async () => {
    const db = new Map();
    const f = async (url, opts) => {
      if (opts.method === "POST") { const b = JSON.parse(opts.body); db.set(b.planyr_key, b.drive_id); return okRes(null); }
      const m = /planyr_key=eq\.([^&]+)/.exec(url);
      const key = m && decodeURIComponent(m[1]);
      return okRes(db.has(key) ? [{ drive_id: db.get(key) }] : []);
    };
    const idMap = createIdMap(supabaseIdStore({ supabaseUrl: "u", anonKey: "a", token: "t", fetchImpl: f }));
    await idMap.bind("u/k.pdf", "drive_77");
    expect(await idMap.resolve("u/k.pdf")).toBe("drive_77");
    expect(await idMap.resolve("u/missing.pdf")).toBe(null);
  });
});
