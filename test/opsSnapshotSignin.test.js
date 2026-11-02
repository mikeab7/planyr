/* NEW-1 (2026-11-02) — scripts/ops-snapshot.mjs --signin: the sweep reads sign-in health, and a check that STOPPED reads as stopped. */
import { describe, it, expect } from "vitest";
import { signinVerdict, runSignin, SIGNIN_SQL } from "../scripts/ops-snapshot.mjs";

const NOW = Date.parse("2026-11-02T12:00:00Z");
const row = (minsAgo, over = {}) => ({ updated_at: new Date(NOW - minsAgo * 60000).toISOString(), payload: { lastCheckAt: new Date(NOW - minsAgo * 60000).toISOString(), overall: "pass", failStreak: 0, incident: null, events: { ok: 2 }, ...over } });
const run = async (argv, extra = {}) => { const out = []; const code = await runSignin({ argv: ["node", "x", ...argv], log: (m) => out.push(m), now: NOW, ...extra }); return { code, out: out.join("\n") }; };

describe("signinVerdict", () => {
  it("a fresh pass is ok", () => { expect(signinVerdict(row(20), NOW)).toMatchObject({ state: "ok", ok: true }); });
  it("a check that has not reported in hours reads STOPPED, whatever it last said", () => {
    const v = signinVerdict(row(400), NOW);
    expect(v).toMatchObject({ state: "stale", ok: false }); expect(v.line).toMatch(/stopped/);
  });
  it("no row at all = never reported, not ok", () => { expect(signinVerdict(null, NOW)).toMatchObject({ state: "none", ok: false }); });
  it("an open incident is not ok", () => { expect(signinVerdict(row(10, { incident: { kind: "outside-in", emailedAt: "x" } }), NOW).ok).toBe(false); });
});

describe("runSignin", () => {
  it("with no credentials it prints the read-only SQL and how to read it", async () => {
    const r = await run(["--signin"]);
    expect(r.code).toBe(0); expect(r.out).toContain(SIGNIN_SQL); expect(r.out).toMatch(/150 minutes/);
  });
  it("--stdin takes the row the SQL returned (object or one-element array) and exits 1 when not ok", async () => {
    expect((await run(["--signin", "--stdin"], { readStdin: async () => JSON.stringify([row(5)]) })).code).toBe(0);
    const stale = await run(["--signin", "--stdin"], { readStdin: async () => JSON.stringify(row(500)) });
    expect(stale.code).toBe(1); expect(stale.out).toMatch(/STALE/);
    expect((await run(["--signin", "--stdin"], { readStdin: async () => "[]" })).out).toMatch(/NONE/);
  });
  it("with service credentials it fetches the snapshot", async () => {
    const f = async (url, init) => { expect(url).toContain("ops_snapshots?select=updated_at,payload&key=eq.signin"); expect(init.headers.apikey).toBe("SVC"); return new Response(JSON.stringify([row(5)]), { status: 200 }); };
    const r = await run(["--signin"], { env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "SVC" }, fetchImpl: f });
    expect(r.code).toBe(0); expect(r.out).toMatch(/OK/);
  });
  it("a failed read is exit 2 and says so", async () => {
    const r = await run(["--signin"], { env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "SVC" }, fetchImpl: async () => new Response("no", { status: 500 }) });
    expect(r.code).toBe(2);
  });
});
