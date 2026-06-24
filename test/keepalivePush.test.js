import { describe, it, expect } from "vitest";
import { keepaliveCasPush } from "../src/shared/cloud/optimisticUpsert.js";

// B452 — the keepalive cloud push that survives a forced reload. It is the SAME
// compare-and-swap as casUpsert (a conditional PATCH guarded by the version we last
// synced), so a stale flush can never clobber a newer row; and it never inserts.
describe("keepaliveCasPush (B452)", () => {
  const baseArgs = () => ({
    url: "https://ref.supabase.co", anon: "anon-key", token: "jwt-token",
    table: "sites", id: "s1", row: { id: "s1", data: { id: "s1" } }, expected: 5,
  });

  it("dispatches a version-guarded keepalive PATCH with the right URL + headers", () => {
    let captured = null;
    const fetchImpl = (url, opts) => { captured = { url, opts }; return { catch() {} }; };
    const ok = keepaliveCasPush({ ...baseArgs(), fetchImpl });
    expect(ok).toBe(true);
    expect(captured.url).toBe("https://ref.supabase.co/rest/v1/sites?id=eq.s1&version=eq.5");
    expect(captured.opts.method).toBe("PATCH");
    expect(captured.opts.keepalive).toBe(true);
    expect(captured.opts.headers.apikey).toBe("anon-key");
    expect(captured.opts.headers.Authorization).toBe("Bearer jwt-token");
    // bumps the version exactly like casUpsert's UPDATE branch
    expect(JSON.parse(captured.opts.body).version).toBe(6);
  });

  it("skips (no clobber, no request) when the version isn't tracked — leaves it to local+boot merge", () => {
    let called = false;
    const fetchImpl = () => { called = true; return { catch() {} }; };
    expect(keepaliveCasPush({ ...baseArgs(), expected: undefined, fetchImpl })).toBe(false);
    expect(keepaliveCasPush({ ...baseArgs(), expected: null, fetchImpl })).toBe(false);
    expect(called).toBe(false);
  });

  it("skips when it lacks a token / url / anon (signed out / unconfigured)", () => {
    const fetchImpl = () => ({ catch() {} });
    expect(keepaliveCasPush({ ...baseArgs(), token: null, fetchImpl })).toBe(false);
    expect(keepaliveCasPush({ ...baseArgs(), url: "", fetchImpl })).toBe(false);
    expect(keepaliveCasPush({ ...baseArgs(), anon: "", fetchImpl })).toBe(false);
  });

  it("never throws even if fetch throws synchronously", () => {
    const fetchImpl = () => { throw new Error("network gone"); };
    expect(() => keepaliveCasPush({ ...baseArgs(), fetchImpl })).not.toThrow();
    expect(keepaliveCasPush({ ...baseArgs(), fetchImpl })).toBe(false);
  });
});
