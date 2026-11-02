/* POST /api/auth/mailbox-proof — after a person redeems an EMAILED link (sign-in or reset) the landing page calls this so the
 * mailbox is recorded as proven (public.prove_mailbox, service-role only; consumed by the team-invite functions).
 *
 * What it must never do: let a session that did NOT come from an emailed token claim a mailbox. A password sign-in proves a
 * password, not a mailbox — so the proof is read from the session's own `amr` (how it was authenticated), measured on
 * production 2026-11-02: redeeming an emailed token yields amr [{method:"otp"}]; a password session says "password".
 * The address and user id come from the account GoTrue resolved the token to — never from the request body. */
import { describe, it, expect, vi } from "vitest";
import { handleMailboxProof, onRequest } from "../functions/api/auth/mailbox-proof.js";

const SUPA = "https://x.supabase.co";
const ENV = { SUPABASE_URL: SUPA, SUPABASE_ANON_KEY: "ANON-KEY", SUPABASE_SERVICE_ROLE_KEY: "SERVICE-SECRET-KEY" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "Me@X.Example" };
const NOW = 1_800_000_000;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (claims) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: USER.id, email: USER.email, ...claims })}.sig`;
const tokenWith = (amr, extra = {}) => jwt({ amr, ...extra });
const FRESH = [{ method: "otp", timestamp: NOW - 20 }];

const req = (token, o = {}) => new Request("https://planyr.io/api/auth/mailbox-proof", {
  method: o.method || "POST",
  headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "content-type": "application/json", ...(o.headers || {}) },
  body: o.method === "GET" ? undefined : (o.body === undefined ? "{}" : o.body),
});
const noCors = (res) => { for (const [k] of res.headers) expect(k.toLowerCase().startsWith("access-control-")).toBe(false); };

function world({ userRes, rpc } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url: String(url), headers: init && init.headers, body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).endsWith("/auth/v1/user")) return userRes ? userRes() : Response.json({ id: USER.id, email: USER.email });
    if (String(url).endsWith("/rpc/prove_mailbox")) return rpc ? rpc() : Response.json({ ok: true });
    return new Response("unexpected", { status: 500 });
  });
  return { fetch, calls, deps: { fetch, now: () => NOW * 1000 } };
}
const run = (r, w = world(), env = ENV) => handleMailboxProof(r, env, w.deps);
const rpcCalls = (w) => w.calls.filter((c) => c.url.endsWith("/rpc/prove_mailbox"));

describe("mailbox-proof — the door", () => {
  it("POST only, no CORS, nothing contacted otherwise", async () => {
    for (const method of ["GET", "PUT", "DELETE", "OPTIONS"]) { const w = world(); const r = await run(req(tokenWith(FRESH), { method }), w); expect(r.status).toBe(405); noCors(r); expect(w.fetch).not.toHaveBeenCalled(); }
  });
  it("a request from another website is refused first", async () => {
    const w = world(); const r = await run(req(tokenWith(FRESH), { headers: { origin: "https://evil.example" } }), w); expect(r.status).toBe(403); expect(w.fetch).not.toHaveBeenCalled(); noCors(r);
  });
  it("no bearer token → 401, nothing contacted", async () => { const w = world(); expect((await run(req(null), w)).status).toBe(401); expect(w.fetch).not.toHaveBeenCalled(); });
  it("not configured → 503, no proof", async () => {
    for (const drop of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) { const w = world(); const r = await run(req(tokenWith(FRESH)), w, { ...ENV, [drop]: undefined }); expect(r.status).toBe(503); expect(rpcCalls(w)).toHaveLength(0); }
  });
  it("onRequest is exported for Pages", () => expect(typeof onRequest).toBe("function"));
});

describe("mailbox-proof — only a session that came from an EMAILED token can prove a mailbox", () => {
  it("amr otp (measured on production for a redeemed emailed token) → the proof is recorded, as 'emailed_link', for the account GoTrue resolved", async () => {
    const w = world(); const r = await run(req(tokenWith(FRESH)), w);
    expect(r.status).toBe(200); expect(await r.json()).toEqual({ ok: true }); noCors(r);
    const c = rpcCalls(w); expect(c).toHaveLength(1);
    expect(c[0].url).toBe(`${SUPA}/rest/v1/rpc/prove_mailbox`);
    expect(c[0].body).toEqual({ p_user: USER.id, p_email: "Me@X.Example", p_via: "emailed_link" });
    expect(c[0].headers.apikey).toBe("SERVICE-SECRET-KEY");
  });
  it("magiclink and recovery method names are accepted too (recovery's was not measurable without a mailbox)", async () => {
    for (const method of ["magiclink", "recovery"]) { const w = world(); expect((await run(req(tokenWith([{ method, timestamp: NOW - 5 }])), w)).status).toBe(200); expect(rpcCalls(w)).toHaveLength(1); }
  });
  it("a PASSWORD session cannot claim a mailbox", async () => {
    const w = world(); const r = await run(req(tokenWith([{ method: "password", timestamp: NOW - 5 }])), w);
    expect(r.status).toBe(403); expect((await r.json()).reason).toBe("not_emailed_link"); expect(rpcCalls(w)).toHaveLength(0);
  });
  it("oauth / totp / anonymous / missing / malformed amr: all refused", async () => {
    for (const amr of [[{ method: "oauth", timestamp: NOW }], [{ method: "totp", timestamp: NOW }], [], undefined, "otp", [{ method: "otp" }], [null], [{ method: "password", timestamp: NOW }, { method: "x" }]]) {
      const w = world(); const r = await run(req(tokenWith(amr)), w); expect(r.status).toBe(403); expect(rpcCalls(w)).toHaveLength(0);
    }
  });
  it("a session whose emailed-token sign-in is old (> 10 minutes) is not accepted as a fresh redemption", async () => {
    const w = world(); const r = await run(req(tokenWith([{ method: "otp", timestamp: NOW - 11 * 60 }])), w);
    expect(r.status).toBe(403); expect((await r.json()).reason).toBe("stale"); expect(rpcCalls(w)).toHaveLength(0);
  });
  it("a token GoTrue rejects (expired / forged) → 401, no proof", async () => {
    const w = world({ userRes: () => new Response("{}", { status: 401 }) }); const r = await run(req(tokenWith(FRESH)), w);
    expect(r.status).toBe(401); expect(rpcCalls(w)).toHaveLength(0);
  });
  it("a token whose claims name a different user than the one GoTrue resolved is refused", async () => {
    const w = world(); const r = await run(req(tokenWith(FRESH, { sub: "22222222-2222-4222-8222-222222222222" })), w);
    expect(r.status).toBe(403); expect(rpcCalls(w)).toHaveLength(0);
  });
  it("not a JWT at all → 401", async () => { const w = world(); expect((await run(req("not.a-jwt"), w)).status).toBe(401); expect(rpcCalls(w)).toHaveLength(0); });
  it("the user id and address come from the verified account — a body naming someone else changes nothing", async () => {
    const w = world(); await run(req(tokenWith(FRESH), { body: JSON.stringify({ p_user: "99999999-9999-4999-8999-999999999999", email: "victim@x.example", via: "admin" }) }), w);
    expect(rpcCalls(w)[0].body).toEqual({ p_user: USER.id, p_email: "Me@X.Example", p_via: "emailed_link" });
  });
});

describe("mailbox-proof — failures are reported, never swallowed", () => {
  it("prove_mailbox says the address does not match → 409 address_mismatch", async () => {
    const w = world({ rpc: () => Response.json({ ok: false, reason: "address_mismatch" }) }); const r = await run(req(tokenWith(FRESH)), w);
    expect(r.status).toBe(409); expect(await r.json()).toEqual({ ok: false, reason: "address_mismatch" });
  });
  it("the database erroring or the network failing → 502 unavailable, logged without secrets", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const a = world({ rpc: () => new Response("{}", { status: 500 }) }); expect((await run(req(tokenWith(FRESH)), a)).status).toBe(502);
    const b = world(); const orig = b.deps.fetch; b.deps.fetch = vi.fn(async (u, i) => { if (String(u).includes("prove_mailbox")) throw new TypeError("net"); return orig(u, i); });
    const rb = await run(req(tokenWith(FRESH)), b); expect(rb.status).toBe(502); expect((await rb.json()).reason).toBe("unavailable");
    const all = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toContain("mailbox-proof"); expect(all).not.toContain("SERVICE-SECRET"); expect(all).not.toContain(USER.email); expect(all).not.toContain(USER.id);
    log.mockRestore();
  });
  it("an unexpected RPC answer (no ok:true) is not treated as a proof", async () => {
    const w = world({ rpc: () => Response.json({ weird: 1 }) }); const r = await run(req(tokenWith(FRESH)), w); expect(r.status).toBe(502);
  });
  it("replies carry no token, key or address", async () => {
    const w = world(); const t = await (await run(req(tokenWith(FRESH)), w)).text();
    expect(t).not.toContain("SERVICE-SECRET"); expect(t).not.toContain("ANON-KEY"); expect(t).not.toContain(USER.email);
  });
});
