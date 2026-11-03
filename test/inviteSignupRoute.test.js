/* NEW-1 (2026-11-02, item 8) — /api/auth/invite-signup: create an account from a valid invite link with NO Turnstile,
 * capped per invite. Drives the real handler with a fake Supabase. The invariants: the address is the INVITE's, never
 * the caller's; a used / unknown invite or an address with an account creates nothing; the cap and the pin checks hold;
 * only the new user's own session leaves the function; secrets are never echoed. */
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handleInviteSignup } from "../functions/api/lib/inviteSignup.js";

const INV = "7d1c0b5e-2f4a-4c3b-9a58-0b6a1f6e0001";
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", SUPABASE_SERVICE_ROLE_KEY: "service-secret" };
const NEW = "11111111-2222-4333-8444-555555555555";
const sleep = async () => {};

function net(o = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init) => {
    const u = String(url); calls.push({ url: u, init });
    const j = (b, s = 200) => new Response(JSON.stringify(b), { status: s });
    if (u.endsWith("/rpc/invite_signup_begin")) return j(o.begin || { ok: true, email: "newhire@hillwood.com", invite_id: INV });
    if (u.endsWith("/auth/v1/admin/users")) return o.create ? j(o.create.body, o.create.status) : j({ id: NEW, email: "newhire@hillwood.com" });
    if (u.endsWith("/rpc/invite_signup_finish")) return j(o.finish || { ok: true, status: "accepted", team_id: "t1", team_name: "USEC" });
    if (u.endsWith("/auth/v1/admin/generate_link")) return j(o.gen || { id: NEW, email: "newhire@hillwood.com", hashed_token: "HASH" });
    if (u.endsWith("/auth/v1/verify")) return j(o.verify || { access_token: "AT", refresh_token: "RT", token_type: "bearer", expires_in: 3600, user: { id: NEW, email: "newhire@hillwood.com" } });
    throw new Error("unexpected " + u);
  });
  return { fetch, calls, sleep };
}
const body = (o = {}) => JSON.stringify({ invite: INV, password: "hunter22", firstName: "New", lastName: "Hire", ...o });
const req = (b = body(), method = "POST") => new Request("https://planyr.io/api/auth/invite-signup", { method, headers: { "content-type": "application/json" }, body: method === "GET" ? undefined : b });
const run = async (n, r = req(), env = ENV) => { const res = await handleInviteSignup(r, env, n); const t = await res.text(); return { status: res.status, text: t, body: t ? JSON.parse(t) : null }; };

describe("invite-signup", () => {
  it("creates the account for the INVITE's address, proves + joins, and returns that user's session", async () => {
    const n = net(); const r = await run(n);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, access_token: "AT", refresh_token: "RT", user: { id: NEW, email: "newhire@hillwood.com" }, team: { id: "t1", name: "USEC" } });
    const create = JSON.parse(n.calls.find((c) => c.url.endsWith("/auth/v1/admin/users")).init.body);
    expect(create).toMatchObject({ email: "newhire@hillwood.com", email_confirm: true, password: "hunter22" });
    expect(create.user_metadata).toMatchObject({ first_name: "New", last_name: "Hire" });
    expect(JSON.parse(n.calls.find((c) => c.url.endsWith("/rpc/invite_signup_finish")).init.body)).toEqual({ p_invite: INV, p_user: NEW });
    // order: begin → create → finish → generate_link → verify
    expect(n.calls.map((c) => c.url.split("/").pop())).toEqual(["invite_signup_begin", "users", "invite_signup_finish", "generate_link", "verify"]);
  });
  it("never uses an address from the request — a smuggled 'email' field is ignored", async () => {
    const n = net(); await run(n, req(body({ email: "victim@x.com" })));
    expect(JSON.parse(n.calls.find((c) => c.url.endsWith("/auth/v1/admin/users")).init.body).email).toBe("newhire@hillwood.com");
  });
  it("an address that already has an account → 409 and NOTHING is created", async () => {
    const n = net({ begin: { ok: false, reason: "has_account" } });
    expect((await run(n)).status).toBe(409);
    expect(n.calls.some((c) => c.url.endsWith("/auth/v1/admin/users"))).toBe(false);
  });
  it("a used / declined / unknown invite → 404; the per-invite cap → 429; nothing is created either way", async () => {
    const a = net({ begin: { ok: false, reason: "not_open" } }); expect((await run(a)).status).toBe(404);
    const b = net({ begin: { ok: false, reason: "too_many" } }); expect((await run(b)).status).toBe(429);
    expect([...a.calls, ...b.calls].some((c) => c.url.endsWith("/auth/v1/admin/users"))).toBe(false);
  });
  it("bad input is refused before any call: not a uuid, no name, short password", async () => {
    for (const b of [body({ invite: "nope" }), body({ firstName: "" }), body({ password: "123" })]) {
      const n = net(); expect((await run(n, req(b))).status).toBe(400); expect(n.calls).toHaveLength(0);
    }
  });
  it("the pin checks hold: a link/session for a different user is never handed out", async () => {
    const n = net({ verify: { access_token: "AT", refresh_token: "RT", user: { id: "other-user", email: "x@y.com" } } });
    const r = await run(n);
    expect(r.status).toBe(502); expect(r.body.reason).toBe("account_created"); expect(r.text).not.toContain("AT");
  });
  it("a failure AFTER the account exists says so plainly (never 'try again to create')", async () => {
    const r = await run(net({ finish: { ok: false, reason: "wrong_account" } }));
    expect(r.status).toBe(502); expect(r.body.reason).toBe("account_created");
  });
  it("a refused password is 400 with the upstream's sanitised reason; a server error is 502", async () => {
    expect(await run(net({ create: { status: 422, body: { msg: "Password should be at least 6 characters" } } }))).toMatchObject({ status: 400, body: { reason: "rejected", error: expect.stringMatching(/Password/) } });
    expect((await run(net({ create: { status: 500, body: {} } }))).status).toBe(502);
  });
  it("POST only (405); not configured (503); the service key is never echoed", async () => {
    expect((await run(net(), req(undefined, "GET"))).status).toBe(405);
    expect((await run(net(), req(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" })).status).toBe(503);
    const ok = await run(net());
    expect(ok.text).not.toContain("service-secret"); expect(ok.text).not.toContain("HASH"); expect(ok.text).not.toContain("hunter22");
  });
  it("no CORS headers on any response, and the route file is a thin wrapper", async () => {
    const res = await handleInviteSignup(req(), ENV, net());
    expect([...res.headers.keys()].some((h) => h.startsWith("access-control"))).toBe(false);
    expect(readFileSync("functions/api/auth/invite-signup.js", "utf8")).toMatch(/handleInviteSignup/);
  });
});
