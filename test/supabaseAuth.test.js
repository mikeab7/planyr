import { describe, it, expect } from "vitest";
import { verifySupabaseUser } from "../server/auth/supabaseAuth.js";

const fakeFetch = (status, body) => {
  const calls = [];
  const fn = async (url, opts) => { calls.push({ url, opts }); return { ok: status >= 200 && status < 300, status, json: async () => body }; };
  fn.calls = calls;
  return fn;
};

describe("supabaseAuth — verify a user token (B207 files API auth)", () => {
  it("accepts a valid token and returns the user", async () => {
    const f = fakeFetch(200, { id: "user-123", email: "m@x.com" });
    const r = await verifySupabaseUser({ token: "tok", supabaseUrl: "https://p.supabase.co", anonKey: "anon", fetchImpl: f });
    expect(r.ok).toBe(true);
    expect(r.user.id).toBe("user-123");
    expect(f.calls[0].url).toBe("https://p.supabase.co/auth/v1/user");
    expect(f.calls[0].opts.headers.authorization).toBe("Bearer tok");
    expect(f.calls[0].opts.headers.apikey).toBe("anon");
  });
  it("rejects an invalid/expired token (non-200)", async () => {
    const r = await verifySupabaseUser({ token: "bad", supabaseUrl: "https://p.supabase.co", anonKey: "anon", fetchImpl: fakeFetch(401, {}) });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/expired|invalid/i);
  });
  it("fails closed when no token is supplied (no network call)", async () => {
    const f = fakeFetch(200, {});
    expect((await verifySupabaseUser({ supabaseUrl: "u", anonKey: "a", fetchImpl: f })).ok).toBe(false);
    expect(f.calls).toHaveLength(0);
  });
  it("fails when the server isn't configured", async () => {
    expect((await verifySupabaseUser({ token: "t", fetchImpl: fakeFetch(200, {}) })).ok).toBe(false);
  });
  it("a 200 without a user id is rejected", async () => {
    const r = await verifySupabaseUser({ token: "t", supabaseUrl: "u", anonKey: "a", fetchImpl: fakeFetch(200, {}) });
    expect(r.ok).toBe(false);
  });
});
