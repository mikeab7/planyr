/* NEW-1 — team invite emails. Drives the real server core (functions/api/lib/inviteEmail.js)
 * with a fake Supabase + fake Gmail, and the real client wrappers (lib/teams.js) with a mocked
 * supabase client + fetch. Acceptance rows: invite → exactly one send · resend → one send, no new
 * row · second resend inside the window refused server-side · a send failure keeps the row and
 * surfaces the failure · provider failure/no key releases the throttle slot. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { handleInviteEmail, buildInviteEmail, inviteLink, inviteCopy } from "../functions/api/lib/inviteEmail.js";
import { resendCooldownMs, groupRoster } from "../src/workspaces/site-planner/lib/teamRoster.js";

// A real throwaway RSA key so the service-account JWT is genuinely signed in these tests.
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({ client_email: "inviter@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", GMAIL_SERVICE_ACCOUNT_JSON: SA_JSON, INVITE_SENDER: "mike@planyr.io" };
const CLAIM_OK = { ok: true, invite_id: "inv1", email: "a@b.com", role: "member", team_name: "HIP Houston", inviter_name: "Mike Abbott", prev_sent_at: null, has_account: true };

function fakeNet({ claim = CLAIM_OK, resend = { ok: true, status: 200 } } = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    calls.push({ url: String(url), init });
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u1", email: "m@x.com" }), { status: 200 });
    if (u.endsWith("/rpc/claim_invite_send")) return new Response(JSON.stringify(claim), { status: 200 });
    if (u.endsWith("/rpc/release_invite_send")) return new Response("null", { status: 200 });
    if (u === "https://oauth2.googleapis.com/token") return new Response('{"access_token":"gat","expires_in":3600}', { status: 200 });
    if (u === "https://gmail.googleapis.com/gmail/v1/users/me/messages/send") {
      if (resend.throw) throw new Error("network down");
      return new Response(resend.ok ? '{"id":"m1"}' : '{"error":"forbidden"}', { status: resend.status });
    }
    throw new Error("unexpected " + u);
  });
  return { fetchImpl, calls, sends: () => calls.filter((c) => c.url.includes("gmail.googleapis.com")).length, released: () => calls.filter((c) => c.url.endsWith("release_invite_send")).length };
}
const req = (body = { teamId: "t1", email: "a@b.com" }, auth = "Bearer tok") =>
  new Request("https://planyr.io/api/team/invite-email", { method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body) });
const run = async (net, env = ENV, r = req()) => { const res = await handleInviteEmail({ env, request: r, fetchImpl: net.fetchImpl }); return { status: res.status, body: await res.json() }; };

describe("server send core", () => {
  it("one request = exactly one provider send, from a planyr.io address, with the right content", async () => {
    const net = fakeNet(); const r = await run(net);
    expect(r).toEqual({ status: 200, body: { ok: true, messageId: "m1" } });
    expect(net.sends()).toBe(1);
    const raw = JSON.parse(net.calls.find((c) => c.url.includes("gmail.googleapis.com")).init.body).raw;
    const mime = Buffer.from(raw, "base64url").toString("utf8");
    expect(mime).toMatch(/^From: Planyr <no-reply@planyr\.io>/m); // From = the public alias; auth `sub` below stays the mailbox
    expect(mime).toMatch(/^To: a@b\.com/m);
    expect(mime).toMatch(/^Reply-To: support@planyr\.io$/m);   // NEW-1: replies reach a real alias, not no-reply
    const subj = /^Subject: =\?UTF-8\?B\?(.+)\?=/m.exec(mime)[1];
    expect(Buffer.from(subj, "base64").toString("utf8")).toBe("Mike Abbott invited you to HIP Houston on Planyr");
    const parts = mime.split(/--planyr-[a-z0-9]+/).map((p) => Buffer.from(p.split("\r\n\r\n")[1] || "", "base64").toString("utf8"));
    expect(parts.join("\n")).toContain("HIP Houston");
    expect(parts.join("\n")).toContain("/?app&invite=inv1"); // NEW-2: the opaque invite id, never the address
    expect(parts.join("\n")).not.toContain("a%40b.com");
    expect(parts.join("\n")).not.toMatch(/exact address/i);   // NEW-2: the sign-in puzzle line is gone
    // the token request carried the delegated mailbox as `sub`
    const tokCall = net.calls.find((c) => c.url.includes("oauth2.googleapis.com"));
    if (tokCall) { const jwt = new URLSearchParams(tokCall.init.body).get("assertion").split(".")[1]; expect(JSON.parse(Buffer.from(jwt, "base64url")).sub).toBe("mike@planyr.io"); }
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
  it("no Gmail credentials yet → 503 not_configured, slot released, no send", async () => {
    const net = fakeNet(); const r = await run(net, { ...ENV, GMAIL_SERVICE_ACCOUNT_JSON: undefined });
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
  it("link carries the invite id (opaque), never the email", () => {
    const id = "2c2c2b7e-9b88-46f6-97de-a807a4b756b3";
    expect(inviteLink(undefined, id)).toBe(`https://planyr.io/?app&invite=${id}`);
    expect(inviteLink("https://x.test/", id)).toBe(`https://x.test/?app&invite=${id}`);
    expect(inviteLink(undefined, undefined)).toBe("https://planyr.io/?app");
  });
});

// NEW-3 — the wording follows whether the invited address already has an account (claim_invite_send's has_account).
describe("template branching: existing account vs new", () => {
  const base = { inviterName: "Mike", teamName: "HIP Houston", role: "member", inviteId: "inv1" };
  it("existing account → 'Accept invitation' + accept-from-the-account-menu line", () => {
    const m = buildInviteEmail({ ...base, hasAccount: true });
    expect(m.html).toContain(">Accept invitation</a>");
    expect(m.html).toContain("Open Planyr and accept from your account menu.");
    expect(m.text).toContain("Accept invitation:");
    expect(m.html + m.text).not.toMatch(/added to the team|automatically|exact address/i);
  });
  it("no account yet → 'Join team' + create-your-account line", () => {
    const m = buildInviteEmail({ ...base, hasAccount: false });
    expect(m.html).toContain(">Join team</a>");
    expect(m.html).toContain("Create your Planyr account to join");
    expect(m.html).toContain("as soon as you sign up");
    expect(m.html + m.text).not.toContain("account menu");
  });
  it("unknown (database not yet migrated) → neutral wording that is true either way", () => {
    expect(inviteCopy(undefined)).toEqual({ button: "Open Planyr", note: "Sign in or create your Planyr account to join." });
    expect(inviteCopy(null).button).toBe("Open Planyr");
  });
  it("the subject and the inviter's name are unchanged (the name stays in the subject and body)", () => {
    const m = buildInviteEmail({ ...base, hasAccount: false });
    expect(m.subject).toBe("Mike invited you to HIP Houston on Planyr");
    expect(m.html).toContain("Mike invited you to join");
  });
  it("end to end: the claim's has_account picks the wording that is actually sent", async () => {
    const decode = (net) => {
      const raw = JSON.parse(net.calls.find((c) => c.url.includes("gmail.googleapis.com")).init.body).raw;
      const mime = Buffer.from(raw, "base64url").toString("utf8");
      return mime.split(/--planyr-[a-z0-9]+/).map((p) => Buffer.from(p.split("\r\n\r\n")[1] || "", "base64").toString("utf8")).join("\n");
    };
    let net = fakeNet({ claim: { ...CLAIM_OK, has_account: true } }); await run(net);
    expect(decode(net)).toContain("Accept invitation");
    net = fakeNet({ claim: { ...CLAIM_OK, has_account: false } }); await run(net);
    expect(decode(net)).toContain("Join team");
  });
  it("INVITE_REPLY_TO overrides the Reply-To default", async () => {
    const net = fakeNet(); await run(net, { ...ENV, INVITE_REPLY_TO: "help@planyr.io" });
    const raw = JSON.parse(net.calls.find((c) => c.url.includes("gmail.googleapis.com")).init.body).raw;
    expect(Buffer.from(raw, "base64url").toString("utf8")).toMatch(/^Reply-To: help@planyr\.io$/m);
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
    sb.upserts = []; sb.calls = [];
    // NEW-1 (invite inbox): inviteByEmail first deletes a DECLINED invite for the same team+email (the table
    // has no UPDATE policy, so a fresh row is the only way to re-invite) — a chainable, awaitable stub.
    const del = () => { const c = { eq: () => c, not: (...a) => { sb.calls.push(["delete-declined", a]); return c; }, then: (res) => res({ error: null }) }; return c; };
    sb.from = () => ({ delete: del, upsert: async (row, opts) => { sb.calls.push(["upsert"]); sb.upserts.push({ row, opts }); return { error: null }; } });
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
  it("re-inviting clears a DECLINED invite first, then inserts (NEW-1 invite inbox)", async () => {
    stubFetch(new Response('{"ok":true}', { status: 200 }));
    await teams.inviteByEmail("t1", "a@b.com", "member");
    expect(sb.calls.map((c) => c[0])).toEqual(["delete-declined", "upsert"]);
    expect(sb.calls[0][1]).toEqual(["declined_at", "is", null]);
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

describe("link migration shape (NEW-2 / NEW-3)", () => {
  const sql = readFileSync(new URL("../src/workspaces/site-planner/db/team_invite_link.sql", import.meta.url), "utf8");
  it("claim_invite_send reports has_account from auth.users, inside the SECURITY DEFINER function", () => {
    expect(sql).toMatch(/'has_account'/);
    expect(sql).toMatch(/from auth\.users u where lower\(trim\(u\.email\)\)/i);
  });
  it("invite_preview is callable signed out, keyed by the invite id, and withholds the address once the invite is used", () => {
    expect(sql).toMatch(/grant execute on function public\.invite_preview\(uuid\) to anon, authenticated/i);
    const used = sql.slice(sql.indexOf("'claimed'"), sql.indexOf("select coalesce(nullif(trim(concat_ws(' ', p.first_name", sql.indexOf("'claimed'")));
    expect(used).not.toMatch(/'email'/);
  });
});
