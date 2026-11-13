/* NEW-1 (2026-11-12) — the unresolved-county watch: request shape, verdict, the setup-not-done paths, and the SQL's own guards. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildWatchRequest, judgeWatch, runWatch, ALERT_AFTER_DAYS } from "../scripts/ops-county-watch.mjs";

const env = { VITE_SUPABASE_URL: "https://x.supabase.co/", VITE_SUPABASE_ANON_KEY: "anon", OPS_INGEST_TOKEN: "t".repeat(40) };
const res = (status, body) => ({ ok: status < 300, status, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) });

describe("judgeWatch", () => {
  it("0 is clean and green", () => expect(judgeWatch({ count: 0 })).toMatchObject({ code: 0, level: "notice" }));
  it("above zero for a week or less warns but stays green", () => {
    expect(judgeWatch({ count: 1, since: "2026-11-10T00:00:00Z", days: 2.5, alert: false })).toMatchObject({ code: 0, level: "warning" });
    expect(judgeWatch({ count: 1, days: ALERT_AFTER_DAYS, alert: false }).code).toBe(0);
  });
  it("above zero for MORE than a week is red, naming the count and the start", () => {
    const j = judgeWatch({ count: 3, since: "2026-11-01T05:00:00Z", days: 11.2, alert: true });
    expect(j.code).toBe(1);
    expect(j.line).toMatch(/3 live plan/);
    expect(j.line).toMatch(/2026-11-01/);
  });
  it("a non-count answer is a failure, never a pass", () => {
    expect(judgeWatch({}).code).toBe(1);
    expect(judgeWatch(null).code).toBe(1);
    expect(judgeWatch({ count: -1 }).code).toBe(1);
  });
});

describe("runWatch", () => {
  it("sends the token in the body only", () => {
    const r = buildWatchRequest({ url: "https://x.supabase.co/", anonKey: "a", token: "TOKEN" });
    expect(r.url).toBe("https://x.supabase.co/rest/v1/rpc/ops_unresolved_county_watch");
    expect(r.url).not.toContain("TOKEN");
    expect(JSON.parse(r.init.body)).toEqual({ p_token: "TOKEN" });
  });
  it("no token → loud warning, exit 0", async () => {
    const logs = [];
    const r = await runWatch({ env: { ...env, OPS_INGEST_TOKEN: "" }, fetchImpl: async () => { throw new Error("must not call"); }, log: (l) => logs.push(l) });
    expect(r).toMatchObject({ code: 0, skipped: true });
    expect(logs.join()).toMatch(/::warning/);
  });
  it("function not created yet (404 / PGRST202) → loud warning, exit 0", async () => {
    for (const rr of [res(404, ""), res(400, { code: "PGRST202", message: "Could not find the function" })]) {
      const logs = [];
      const r = await runWatch({ env, fetchImpl: async () => rr, log: (l) => logs.push(l) });
      expect(r).toMatchObject({ code: 0, skipped: true });
      expect(logs.join()).toMatch(/admin_ops_county_watch\.sql/);
    }
  });
  it("a refused token or a server error is a failure, and the token never reaches the log", async () => {
    const logs = [];
    const r = await runWatch({ env, fetchImpl: async () => res(401, `not authorized ${env.OPS_INGEST_TOKEN}`), log: (l) => logs.push(l) });
    expect(r.code).toBe(1);
    expect(logs.join()).not.toContain(env.OPS_INGEST_TOKEN);
  });
  it("a thrown fetch fails; an over-a-week answer fails with ::error::; a clean answer passes", async () => {
    expect((await runWatch({ env, fetchImpl: async () => { throw new Error("net"); }, log() {} })).code).toBe(1);
    const logs = [];
    expect((await runWatch({ env, fetchImpl: async () => res(200, { count: 1, since: "2026-10-21", days: 9, alert: true }), log: (l) => logs.push(l) })).code).toBe(1);
    expect(logs.join()).toMatch(/::error/);
    expect((await runWatch({ env, fetchImpl: async () => res(200, { count: 0, alert: false }), log() {} })).code).toBe(0);
  });
});

describe("the SQL and the workflow", () => {
  const sql = readFileSync(new URL("../src/workspaces/admin/db/admin_ops_county_watch.sql", import.meta.url), "utf8");
  it("is token-gated like the digest door, aggregate-only, and reads sites without writing it", () => {
    expect(sql).toMatch(/ops_ingest_tokens/);
    expect(sql).toMatch(/length\(p_token\) < 32/);
    expect(sql).toMatch(/s\.deleted_at is null/);
    expect(sql).toMatch(/s\.county is null/);
    expect(sql).toMatch(/jsonb_typeof\(s\.data -> 'parcels'\) = 'array'/);
    expect(sql).not.toMatch(/(update|delete from|insert into)\s+public\.sites\b/i);
    expect(sql).not.toMatch(/return[^;]*\bs\.id\b/i);
    expect(sql).toMatch(/revoke all on function public\.ops_unresolved_county_watch/);
  });
  it("ops-digest.yml runs the watch on schedule, not on the per-merge trigger", () => {
    const y = readFileSync(new URL("../.github/workflows/ops-digest.yml", import.meta.url), "utf8");
    expect(y).toMatch(/node scripts\/ops-county-watch\.mjs/);
    expect(y).toMatch(/github\.event_name != 'workflow_run'/);
  });
});
