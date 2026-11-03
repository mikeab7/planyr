/* NEW-1 (2026-11-02) — /api/team/invite-resend: the invitee emails themselves their invitation again.
 * Drives the real handler (functions/api/lib/inviteResend.js) with a fake Supabase + fake Gmail.
 * The invariants: the browser is told a COUNT and its own address — never an invite id (the bearer secret in the
 * link); the caller is identified only by its verified token; the throttle is the database's; a failed send hands
 * the slot back. */
import { describe, it, expect, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { handleInviteResend } from "../functions/api/lib/inviteResend.js";

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const SA_JSON = JSON.stringify({ client_email: "inviter@proj.iam.gserviceaccount.com", private_key: privateKey.export({ type: "pkcs8", format: "pem" }) });
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-secret", GMAIL_SERVICE_ACCOUNT_JSON: SA_JSON, INVITE_SENDER: "mike@planyr.io" };
const ITEM = { invite_id: "7d1c0b5e-2f4a-4c3b-9a58-0b6a1f6e0001", team_name: "USEC", role: "member", inviter_name: "Chris Seward", prev_sent_at: null, has_account: true };

function net({ claim = { ok: true, email: "paul@x.com", items: [ITEM] }, gmailOk = true } = {}) {
  const calls = [];
  const fetchImpl = vi.fn(async (url, init) => {
    const u = String(url); calls.push({ url: u, init });
    if (u.endsWith("/auth/v1/user")) return new Response(JSON.stringify({ id: "u-paul", email: "paul@x.com" }), { status: 200 });
    if (u.endsWith("/rpc/claim_invite_resend_for")) return new Response(JSON.stringify(claim), { status: 200 });
    if (u.endsWith("/rpc/release_invite_resend")) return new Response("null", { status: 200 });
    if (u === "https://oauth2.googleapis.com/token") return new Response('{"access_token":"g","expires_in":3600}', { status: 200 });
    if (u.includes("gmail.googleapis.com")) return new Response(gmailOk ? '{"id":"m1"}' : '{"error":"no"}', { status: gmailOk ? 200 : 500 });
    throw new Error("unexpected " + u);
  });
  return { fetchImpl, calls };
}
const req = (auth = "Bearer tok", method = "POST", body) => new Request("https://planyr.io/api/team/invite-resend", { method, headers: { authorization: auth, "content-type": "application/json" }, body });
const run = async (n, env = ENV, r = req()) => { const res = await handleInviteResend({ env, request: r, fetchImpl: n.fetchImpl }); const text = await res.text(); return { status: res.status, text, body: text ? JSON.parse(text) : null }; };

describe("invite-resend", () => {
  it("sends the invitation to the account's own address and tells the browser only a count and that address", async () => {
    const n = net(); const r = await run(n);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, sent: 1, email: "paul@x.com" });
    expect(r.text).not.toContain(ITEM.invite_id);         // the invite id is the bearer secret — it goes in the email only
    expect(r.text).not.toContain("USEC");                 // and an unproven account is not told which team
    const mail = JSON.parse(n.calls.find((c) => c.url.includes("gmail.googleapis.com")).init.body).raw;
    expect(Buffer.from(mail, "base64url").toString("utf8")).toMatch(/^To: paul@x\.com/m);
  });
  it("the claim runs with the SERVICE key for the VERIFIED user — the request body is never read", async () => {
    const n = net(); await run(n, ENV, req("Bearer tok", "POST", JSON.stringify({ p_user: "someone-else", email: "victim@x.com" })));
    const claim = n.calls.find((c) => c.url.endsWith("/rpc/claim_invite_resend_for"));
    expect(JSON.parse(claim.init.body)).toEqual({ p_user: "u-paul" });
    expect(claim.init.headers.authorization).toBe("Bearer service-secret");
  });
  it("throttled → 429 with the wait; no invites → 404; nothing is sent", async () => {
    const n1 = net({ claim: { ok: false, reason: "throttled", retry_after_seconds: 42 } });
    expect(await run(n1)).toMatchObject({ status: 429, body: { reason: "throttled", retryAfterSeconds: 42 } });
    const n2 = net({ claim: { ok: false, reason: "no_invites" } });
    expect((await run(n2)).status).toBe(404);
    expect(n1.calls.concat(n2.calls).some((c) => c.url.includes("gmail"))).toBe(false);
  });
  it("a provider failure is 502 and hands the throttle slot back", async () => {
    const n = net({ gmailOk: false }); const r = await run(n);
    expect(r.status).toBe(502);
    expect(n.calls.filter((c) => c.url.endsWith("/rpc/release_invite_resend"))).toHaveLength(1);
  });
  it("needs a valid token (401), POST only (405), and a configured service key + mail (503)", async () => {
    expect((await run(net(), ENV, req(""))).status).toBe(401);
    expect((await run(net(), ENV, new Request("https://planyr.io/x", { method: "GET" }))).status).toBe(405);
    expect((await run(net(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" })).status).toBe(503);
    expect((await run(net(), { ...ENV, GMAIL_SERVICE_ACCOUNT_JSON: "" })).status).toBe(503);
  });
});
