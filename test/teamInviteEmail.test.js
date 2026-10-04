/* NEW-1 — team invite emails. Drives the real server core (functions/api/lib/inviteEmail.js)
 * with a fake Supabase + fake Resend, and the real client wrappers (lib/teams.js) with a mocked
 * supabase client + fetch. Acceptance rows: invite → exactly one send · resend → one send, no new
 * row · second resend inside the window refused server-side · a send failure keeps the row and
 * surfaces the failure · provider failure/no key releases the throttle slot. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { handleInviteEmail, buildInviteEmail, inviteLink } from "../functions/api/lib/inviteEmail.js";
import { resendCooldownMs, groupRoster } from "../src/workspaces/site-planner/lib/teamRoster.js";

const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", RESEND_API_KEY: "re_test" };
const CLAIM_OK = { ok: true, invite_id: "inv1", email: "a@b.com", role: "member", team_name: "HIP Houston", inviter_name: "Mike Abbott", prev_sent_at: null };

function fakeNet({ claim = CLAIM_OK, resend = { ok: true, status: 200 } } = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1", email: "m@x.com" }), { status: 200 });
    if (u.endsWith("/rpc/claim_invite_send")) return new Response(JSON.stringify(claim), { status: 200 });
    if (u.endsWith("/rpc/release_invite_send")) return new Response("null", { status: 200 });
    if (u === "https://api.resend.com/emails") {
      if (resend.throw) throw new Error("network down");
      return new Response(resend.ok ? '{"id":"e1"}' : '{"message":"domain not verified"}', { status: resend.status });
    }
    throw new Error("unexpected " + u);
  });
  return { fetchImpl, calls, sends: () => calls.filter((c) => c.url.includes("api.resend.com")).length, released: () => calls.filter((c) => c.url.endsWith("release_invite_send")).length };
}
const req = (body = { teamId: "t1", email: "a@b.com" }, auth = "Bearer tok") =>
  new Request("https://planyr.io/api/team/invite-email", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
const run = async (net, env = ENV, r = req()) => { const res = await handleInviteEmail({ env, request: r, fetchImpl: net.fetchImpl }); return { status: res.status, body: await res.json() }; };

describe("server send core", () => {
  it("one request = exactly one provider send, from a planyr.io address, with the right content", async () => {
    const net = fakeNet(); const r = await run(net);
    expect(r).toEqual({ status: 200, body: { ok: true } });
    expect(net.sends()).toBe(1);
    const sent = JSON.parse(net.calls.find((c) => c.url.includes("resend")).init.body);
    expect(sent.from).toMatch(/@planyr\.io>/);
    expect(sent.to).toEqual(["a@b.com"]);
    expect(sent.subject).toBe("Mike Abbott invited you to HIP Houston on Planyr");
    expect(sent.html).toContain("HIP Houston"); expect(sent.text).toContain("a@b.com");
    expect(sent.text).toContain("auth=signin&email=a%40b.com");
    expect(net.released()).toBe(0);
  });
  it("a second send inside the window is refused (429) and sends nothing", async () => {
    const net = fakeNet({ claim: { ok: false, reason: "throttled", retry_after_seconds: 42 } });
    const r = await run(net);
    expect(r.status).toBe(429); expect(r.body.retryAfterSeconds).toBe(42);
    expect(net.sends()).toBe(0);
  });
  it("provider failure → 502, slot released, nothing claims success", async () => {
    const net = fakeNet({ resend: { ok: false, status: 403 } });
    const r = await run(net);
    expect(r.status).toBe(502); expect(r.body.reason).toBe("send_failed");
    expect(net.released()).toBe(1);
  });
  it("provider unreachable → 502 and slot released", async () => {
    const net = fakeNet({ resend: { throw: true } });
    expect((await run(net)).status).toBe(502); expect(net.released()).toBe(1);
  });
  it("no RESEND_API_KEY yet → 503 not_configured, slot released, no send", async () => {
    const net = fakeNet(); const r = await run(net, { ...ENV, RESEND_API_KEY: undefined });
    expect(r.status).toBe(503); expect(r.body.reason).toBe("not_configured");
    expect(net.sends()).toBe(0); expect(net.released()).toBe(1);
  });
  it("unauthenticated / non-admin / unknown invite are refused without sending", async () => {
    let net = fakeNet(); expect((await run(net, ENV, req(undefined, ""))).status).toBe(401);
    net = fakeNet({ claim: { ok: false, reason: "forbidden" } }); expect((await run(net)).status).toBe(403);
    net = fakeNet({ claim: { ok: false, reason: "not_found" } }); expect((await run(net)).status).toBe(404);
    expect(net.sends()).toBe(0);
  });
  it("escapes HTML in names", () => {
    const m = buildInviteEmail({ inviterName: "<b>x</b>", teamName: "A&B", role: "admin", email: "a@b.com" });
    expect(m.html).not.toContain("<b>x</b>"); expect(m.html).toContain("A&amp;B"); expect(m.html).toContain("an admin");
  });
  it("link goes to planyr.io sign-in with email prefilled", () => {
    expect(inviteLink(undefined, "a+b@c.com")).toBe("https://planyr.io/?app&auth=signin&email=a%2Bb%40c.com");
  });
});

describe("throttle helper", () => {
  it("counts down a minute from the last send", () => {
    const now = 1_000_000;
    expect(resendCooldownMs(null, now)).toBe(0);
    expect(resendCooldownMs(now - 10_000, now)).toBe(50_000);
    expect(resendCooldownMs(now - 61_000, now)).toBe(0);
    expect(resendCooldownMs(new Date(now - 5000).toISOString(), now)).toBe(55_000);
  });
  it("roster carries lastSentAt onto invite rows", () => {
    const g = groupRoster([], [{ id: "i", email: "a@b.com", role: "member", lastSentAt: "2026-01-01T00:00:00Z" }], null);
    expect(g.sections[0].rows[0].lastSentAt).toBe("2026-01-01T00:00:00Z");
  });
});

// ── client wrappers, with a mocked supabase client ─────────────────────────────────────────────
const sb = { upserts: [], from: null, auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } };
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => ({ supabase: sb }));

describe("client invite / resend", () => {
  let teams;
  beforeEach(async () => {
    sb.upserts = [];
    sb.from = () => ({ upsert: async (row, opts) => { sb.upserts.push({ row, opts }); return { error: null }; } });
    teams = await import("../src/workspaces/site-planner/lib/teams.js");
  });
  const stubFetch = (resp) => { const f = vi.fn(async () => resp); globalThis.fetch = f; return f; };

  it("invite inserts the row then triggers exactly one send", async () => {
    const f = stubFetch(new Response('{"ok":true}', { status: 200 }));
    const r = await teams.inviteByEmail("t1", "A@B.com", "member");
    expect(sb.upserts).toHaveLength(1); expect(f).toHaveBeenCalledTimes(1);
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ teamId: "t1", email: "a@b.com" });
    expect(r).toMatchObject({ ok: true, emailed: true });
  });
  it("a send failure keeps the invite (ok:true, emailed:false) so the UI can say 'saved, but…'", async () => {
    stubFetch(new Response('{"ok":false,"error":"nope"}', { status: 502 }));
    const r = await teams.inviteByEmail("t1", "a@b.com", "member");
    expect(sb.upserts).toHaveLength(1);
    expect(r).toMatchObject({ ok: true, emailed: false });
  });
  it("resend sends once and writes NO row", async () => {
    const f = stubFetch(new Response('{"ok":true}', { status: 200 }));
    const r = await teams.resendInvite("t1", "a@b.com");
    expect(r.ok).toBe(true); expect(f).toHaveBeenCalledTimes(1); expect(sb.upserts).toHaveLength(0);
  });
  it("a throttled resend reports throttled", async () => {
    stubFetch(new Response('{"ok":false,"reason":"throttled","retryAfterSeconds":30}', { status: 429 }));
    expect(await teams.resendInvite("t1", "a@b.com")).toMatchObject({ ok: false, throttled: true });
  });
});

describe("migration shape", () => {
  const sql = readFileSync(new URL("../src/workspaces/site-planner/db/team_invite_email.sql", import.meta.url), "utf8");
  it("adds last_sent_at, enforces a 60 s window for admins only, and emails nothing by itself", () => {
    expect(sql).toMatch(/add column if not exists last_sent_at timestamptz/i);
    expect(sql).toMatch(/is_team_admin\(p_team\)/);
    expect(sql).toMatch(/interval '60 seconds'/);
    expect(sql).not.toMatch(/update public\.team_invites set last_sent_at = now\(\)\s*;/i); // never a blanket backfill
  });
});
