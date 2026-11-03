/* POST /api/auth/email-link — Planyr mails an EXISTING account's own inbox a sign-in / reset link (NEW-1).
 * Every requirement of the brief is one test here: existing accounts only (an unknown address creates and
 * mails nothing), the same reply either way, caps that fail closed, a failed send that never claims success,
 * no CORS, no secrets in replies. Network is injected (fake fetch + fake mailer). */
import { describe, it, expect, vi } from "vitest";
import { handleEmailLink, onRequest, hmacKey } from "../functions/api/auth/email-link.js";

const SUPA = "https://x.supabase.co";
const ENV = { SUPABASE_URL: SUPA, SUPABASE_SERVICE_ROLE_KEY: "SERVICE-SECRET-KEY", GMAIL_SERVICE_ACCOUNT_JSON: "{}", INVITE_SENDER: "mike@planyr.io", PUBLIC_APP_URL: "https://planyr.io" };
const USER = { id: "11111111-1111-4111-8111-111111111111", email: "me@x.example" };
const TOKEN = "t".repeat(56);

const req = (body, o = {}) => new Request("https://planyr.io/api/auth/email-link", {
  method: o.method || "POST",
  headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.9", ...(o.headers || {}) },
  body: o.rawBody !== undefined ? o.rawBody : JSON.stringify(body),
});
const noCors = (res) => { for (const [k] of res.headers) expect(k.toLowerCase().startsWith("access-control-")).toBe(false); };

/* Fake Supabase. `claim` decides the RPC answer; generate_link answers for known users only. */
function world({ claim, gen, rpcStatus = 200, users = { [USER.email]: USER } } = {}) {
  const calls = [];
  const fetch = vi.fn(async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url, body, headers: init && init.headers });
    if (url.endsWith("/rpc/claim_auth_email_link")) {
      if (rpcStatus !== 200) return new Response(JSON.stringify({ message: "boom" }), { status: rpcStatus });
      if (claim) return Response.json(claim(body));
      const u = users[String(body.p_email).toLowerCase()];
      return Response.json({ ok: true, claim_id: 7, user_id: u ? u.id : null, cooldown_seconds: 60 });
    }
    if (url.endsWith("/rpc/release_auth_email_link")) return new Response(null, { status: 204 });
    if (url.endsWith("/auth/v1/admin/generate_link")) {
      if (gen) return gen(body);
      const u = users[body.email];
      if (!u) return Response.json({ msg: "should never be asked" }, { status: 404 });
      return Response.json({ id: u.id, email: u.email, hashed_token: TOKEN, properties: { hashed_token: TOKEN } });
    }
    return new Response("unexpected " + url, { status: 500 });
  });
  const send = vi.fn(async () => ({ ok: true, id: "gm-1" }));
  const sleep = vi.fn(async () => {});
  return { fetch, send, sleep, calls, deps: { fetch, send, sleep, random: () => 0.5 } };
}
const run = (r, w = world(), env = ENV) => handleEmailLink(r, env, w.deps);
const urlsCalled = (w) => w.calls.map((c) => c.url.replace(SUPA, ""));

describe("email-link — the door", () => {
  it("POST only; no CORS headers on anything", async () => {
    for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
      const w = world(); const r = await run(new Request("https://planyr.io/api/auth/email-link", { method }), w);
      expect(r.status).toBe(405); noCors(r); expect(w.fetch).not.toHaveBeenCalled();
    }
    const w = world(); const ok = await run(req({ email: USER.email, purpose: "signin" }), w); noCors(ok);
  });
  it("a request from another website's page is refused before anything is contacted", async () => {
    const w = world(); const r = await run(req({ email: USER.email, purpose: "reset" }, { headers: { origin: "https://evil.example" } }), w);
    expect(r.status).toBe(403); expect(w.fetch).not.toHaveBeenCalled(); expect(w.send).not.toHaveBeenCalled(); noCors(r);
  });
  it("our own origins are fine (planyr.io, www, the request's own host, a pages preview)", async () => {
    for (const origin of ["https://planyr.io", "https://www.planyr.io", "https://abc.planyr.pages.dev"]) {
      const w = world(); const r = await run(req({ email: USER.email, purpose: "signin" }, { headers: { origin } }), w); expect(r.status).toBe(200);
    }
  });
  it("malformed input → 400 and nothing is contacted", async () => {
    const bad = [{ email: "nope", purpose: "reset" }, { email: "a@b.co", purpose: "admin" }, { purpose: "reset" }, { email: "a@b.co" }, { email: "a".repeat(300) + "@b.co", purpose: "reset" }, { email: ["a@b.co"], purpose: "reset" }, { email: "a@b.co\r\nBcc: x@y.z", purpose: "reset" }];
    for (const b of bad) { const w = world(); const r = await run(req(b), w); expect(r.status).toBe(400); expect(w.fetch).not.toHaveBeenCalled(); }
    const w = world(); expect((await run(req(null, { rawBody: "{not json" }), w)).status).toBe(400);
    expect((await run(req(null, { rawBody: "x".repeat(5000) }), world())).status).toBe(400);
  });
  it("not configured → 503 not_configured, and it does not claim anything was sent", async () => {
    for (const drop of ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_URL", "GMAIL_SERVICE_ACCOUNT_JSON", "INVITE_SENDER"]) {
      const w = world(); const r = await run(req({ email: USER.email, purpose: "signin" }), w, { ...ENV, [drop]: undefined });
      expect(r.status).toBe(503); const j = await r.json(); expect(j.ok).toBe(false); expect(j.reason).toBe("not_configured"); expect(w.send).not.toHaveBeenCalled();
    }
  });
  it("onRequest is exported for Pages", () => { expect(typeof onRequest).toBe("function"); });
});

describe("email-link — existing accounts only", () => {
  it("an unknown address: a normal-looking success, and NOTHING is created or mailed", async () => {
    const w = world(); const r = await run(req({ email: "stranger@nowhere.example", purpose: "signin" }), w);
    expect(r.status).toBe(200); expect((await r.json()).ok).toBe(true);
    expect(urlsCalled(w)).toEqual(["/rest/v1/rpc/claim_auth_email_link"]);   // no generate_link, no release, no /signup, no /admin/users
    expect(w.send).not.toHaveBeenCalled();
    expect(w.calls.some((c) => /generate_link|admin\/users|signup|invite|otp/i.test(c.url))).toBe(false);
  });
  it("both purposes: an unknown address never reaches generate_link (magiclink would create the account)", async () => {
    for (const purpose of ["signin", "reset"]) { const w = world(); await run(req({ email: "ghost@x.example", purpose }), w); expect(urlsCalled(w).some((u) => u.includes("generate_link"))).toBe(false); }
  });
  it("the reply is IDENTICAL for a known and an unknown address (status, body, headers)", async () => {
    const a = await run(req({ email: USER.email, purpose: "signin" }), world());
    const b = await run(req({ email: "ghost@x.example", purpose: "signin" }), world());
    expect(a.status).toBe(b.status); expect(await a.json()).toEqual(await b.json());
    expect([...a.headers].sort()).toEqual([...b.headers].sort());
  });
  it("an unknown address waits roughly as long as a real send would (jittered), a known one does not add that wait", async () => {
    const u = world(); await run(req({ email: "ghost@x.example", purpose: "reset" }), u);
    expect(u.sleep).toHaveBeenCalledTimes(1); const ms = u.sleep.mock.calls[0][0]; expect(ms).toBeGreaterThanOrEqual(300); expect(ms).toBeLessThanOrEqual(1500);
    const k = world(); await run(req({ email: USER.email, purpose: "reset" }), k); expect(k.sleep).not.toHaveBeenCalled();
  });
  it("case and spaces in the typed address are normalised before the lookup", async () => {
    const w = world(); await run(req({ email: "  Me@X.Example ", purpose: "signin" }), w);
    expect(w.calls[0].body.p_email).toBe("me@x.example"); expect(w.send).toHaveBeenCalledTimes(1);
  });
  it("generate_link must return the very user the lookup found, or nothing is mailed", async () => {
    const w = world({ gen: () => Response.json({ id: "22222222-2222-4222-8222-222222222222", email: "other@x.example", hashed_token: TOKEN }) });
    const r = await run(req({ email: USER.email, purpose: "signin" }), w);
    expect(r.status).toBe(502); expect(w.send).not.toHaveBeenCalled(); expect(urlsCalled(w)).toContain("/rest/v1/rpc/release_auth_email_link");
  });
});

describe("email-link — the link that is mailed", () => {
  it("signin → magiclink; reset → recovery; each mailed once, to the account's own address, from Planyr", async () => {
    for (const [purpose, type, kind] of [["signin", "magiclink", "signin"], ["reset", "recovery", "reset"]]) {
      const w = world(); const r = await run(req({ email: USER.email, purpose }), w);
      expect(r.status).toBe(200);
      const gen = w.calls.find((c) => c.url.endsWith("/generate_link")); expect(gen.body).toEqual({ type, email: USER.email });
      expect(w.send).toHaveBeenCalledTimes(1);
      const m = w.send.mock.calls[0][0];
      expect(m.to).toBe(USER.email); expect(m.sender).toBe("mike@planyr.io"); expect(m.fromEmail).toBe("no-reply@planyr.io"); expect(m.replyTo).toBe("support@planyr.io");
      const link = (m.text.match(/https:\/\/planyr\.io\/\?[^\s]+/) || [])[0]; expect(link).toBeTruthy();
      const u = new URL(link); expect(u.searchParams.get("authlink")).toBe(TOKEN); expect(u.searchParams.get("kind")).toBe(kind);
      expect(m.html).toContain("authlink=" + TOKEN);
      expect(link).not.toContain("supabase"); expect(link).not.toContain("/verify");
      expect(link).not.toContain("me%40x"); expect(link).not.toContain("me@x");
      expect(m.subject).toMatch(purpose === "reset" ? /password reset/i : /sign-in/i);
    }
  });
  it("the browser never receives the token, the link or a key", async () => {
    const w = world(); const r = await run(req({ email: USER.email, purpose: "reset" }), w); const t = await r.text();
    expect(t).not.toContain(TOKEN); expect(t).not.toContain("SERVICE-SECRET"); expect(t).not.toContain("authlink");
  });
  it("carries a safe in-app route and drops an unsafe one", async () => {
    const a = world(); await run(req({ email: USER.email, purpose: "signin", next: "#/library" }), a);
    expect(new URL(a.send.mock.calls[0][0].text.match(/https:\/\/planyr\.io\/\?[^\s]+/)[0]).searchParams.get("next")).toBe("/library");
    for (const bad of ["https://evil.example", "//evil.example", "javascript:alert(1)"]) {
      const b = world(); await run(req({ email: USER.email, purpose: "signin", next: bad }), b);
      expect(new URL(b.send.mock.calls[0][0].text.match(/https:\/\/planyr\.io\/\?[^\s]+/)[0]).searchParams.has("next")).toBe(false);
    }
  });
});

describe("email-link — the caps", () => {
  it("what is stored/keyed is a keyed hash, never the raw address or IP; the service key is only a header", async () => {
    const w = world(); await run(req({ email: USER.email, purpose: "signin" }), w);
    const c = w.calls[0]; expect(c.url).toBe(`${SUPA}/rest/v1/rpc/claim_auth_email_link`);
    expect(c.body.p_purpose).toBe("signin"); expect(c.body.p_email_key).toMatch(/^[0-9a-f]{64}$/); expect(c.body.p_ip_key).toMatch(/^[0-9a-f]{64}$/);
    expect(c.body.p_email_key).toBe(await hmacKey("SERVICE-SECRET-KEY", "email:me@x.example"));
    expect(JSON.stringify(c.body)).not.toContain("203.0.113.9");
    expect(c.headers.apikey).toBe("SERVICE-SECRET-KEY");
  });
  it("two different addresses behind one IP share the IP bucket; one address from two IPs shares the address bucket", async () => {
    const a = world(); await run(req({ email: "a@x.example", purpose: "signin" }), a); await run(req({ email: "b@x.example", purpose: "signin" }), a);
    expect(a.calls[0].body.p_ip_key).toBe(a.calls.find((c, i) => i > 0 && c.url.includes("claim")).body.p_ip_key);
    const b = world(); await run(req({ email: "a@x.example", purpose: "signin" }, { headers: { "cf-connecting-ip": "198.51.100.1" } }), b); await run(req({ email: "a@x.example", purpose: "signin" }, { headers: { "cf-connecting-ip": "198.51.100.2" } }), b);
    const keys = b.calls.filter((c) => c.url.includes("claim")); expect(keys[0].body.p_email_key).toBe(keys[1].body.p_email_key); expect(keys[0].body.p_ip_key).not.toBe(keys[1].body.p_ip_key);
  });
  it("a refusal → 429 with when to try again; nothing is generated or mailed — and it is the same for a known and unknown address", async () => {
    const claim = () => ({ ok: false, reason: "address_cooldown", retry_after_seconds: 41 });
    const k = world({ claim }); const u = world({ claim });
    const rk = await run(req({ email: USER.email, purpose: "reset" }), k); const ru = await run(req({ email: "ghost@x.example", purpose: "reset" }), u);
    expect(rk.status).toBe(429); const jk = await rk.json(); expect(jk).toEqual({ ok: false, reason: "throttled", retryAfterSeconds: 41 }); expect(await ru.json()).toEqual(jk);
    expect(urlsCalled(k)).toEqual(["/rest/v1/rpc/claim_auth_email_link"]); expect(k.send).not.toHaveBeenCalled();
  });
  it("EVERY cap reason refuses (cooldown, address/hour, ip/hour, project-wide)", async () => {
    for (const reason of ["address_cooldown", "address_hour", "ip_hour", "global_hour"]) {
      const w = world({ claim: () => ({ ok: false, reason, retry_after_seconds: 5 }) }); const r = await run(req({ email: USER.email, purpose: "signin" }), w);
      expect(r.status).toBe(429); expect(w.send).not.toHaveBeenCalled();
    }
  });
  it("FAILS CLOSED: the cap store erroring (500, network, garbage, missing fields) sends nothing and logs", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const cases = [world({ rpcStatus: 500 }), world({ claim: () => ({ weird: true }) }), world({ claim: () => null }), (() => { const w = world(); w.deps.fetch = vi.fn(async () => { throw new TypeError("network"); }); return w; })()];
    for (const w of cases) {
      const r = await run(req({ email: USER.email, purpose: "signin" }), w); expect(r.status).toBe(503);
      const j = await r.json(); expect(j.ok).toBe(false); expect(j.reason).toBe("unavailable"); expect(w.send).not.toHaveBeenCalled();
    }
    expect(log.mock.calls.some((c) => String(c[0]).includes("email-link") && String(c[0]).includes("claim-failed"))).toBe(true);
    log.mockRestore();
  });
});

describe("email-link — a failure is reported as a failure", () => {
  it("generate_link failing → 502 link_failed, the claim is given back, nothing mailed", async () => {
    const w = world({ gen: () => new Response("{}", { status: 500 }) }); const r = await run(req({ email: USER.email, purpose: "signin" }), w);
    const j = await r.json(); expect(r.status).toBe(502); expect(j).toMatchObject({ ok: false, reason: "link_failed" }); expect(w.send).not.toHaveBeenCalled();
    expect(w.calls.some((c) => c.url.endsWith("release_auth_email_link") && c.body.p_claim_id === 7)).toBe(true);
  });
  it("the mail provider refusing → 502 send_failed, claim released, and the reply never says it was sent", async () => {
    const w = world(); w.send.mockResolvedValueOnce({ ok: false, error: "Gmail refused the send (403)." });
    const r = await run(req({ email: USER.email, purpose: "reset" }), w); const j = await r.json();
    expect(r.status).toBe(502); expect(j).toMatchObject({ ok: false, reason: "send_failed" }); expect(j.ok).toBe(false); expect(JSON.stringify(j)).not.toMatch(/\bsent\b/i);
    expect(w.calls.some((c) => c.url.endsWith("release_auth_email_link"))).toBe(true);
    expect(JSON.stringify(j)).not.toContain("403");   // provider detail stays in the log, not in the reply
  });
  it("the mailer throwing is the same as it refusing", async () => {
    const w = world(); w.send.mockRejectedValueOnce(new Error("boom")); const r = await run(req({ email: USER.email, purpose: "reset" }), w);
    expect(r.status).toBe(502); expect((await r.json()).reason).toBe("send_failed");
  });
  it("success says how long the link lasts and how long until another can be sent", async () => {
    const r = await run(req({ email: USER.email, purpose: "signin" }), world()); const j = await r.json();
    expect(j).toEqual({ ok: true, retryAfterSeconds: 60, expiresMinutes: 60 });
  });
  it("logs outcomes without addresses, tokens or keys", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await run(req({ email: USER.email, purpose: "signin" }), world());
    const all = log.mock.calls.map((c) => String(c[0])).join("\n");
    expect(all).toContain("email-link"); expect(all).not.toContain(USER.email); expect(all).not.toContain(TOKEN); expect(all).not.toContain("SERVICE-SECRET"); expect(all).not.toContain("203.0.113.9");
    log.mockRestore();
  });
});

/* The browser half of the mailbox proof (lib/emailLinkClient.js). */
import { recordMailboxProof } from "../src/workspaces/site-planner/lib/emailLinkClient.js";
describe("recordMailboxProof — the browser's call after an emailed link is redeemed", () => {
  const fx = (res) => vi.fn(async () => res);
  it("sends the fresh session as a bearer token and reports ok only on the route's ok:true", async () => {
    const f = fx(Response.json({ ok: true })); expect(await recordMailboxProof("TOKEN", f)).toEqual({ ok: true });
    expect(f.mock.calls[0][0]).toBe("/api/auth/mailbox-proof"); expect(f.mock.calls[0][1].headers.authorization).toBe("Bearer TOKEN"); expect(f.mock.calls[0][1].method).toBe("POST");
  });
  it("every failure is reported with a reason, never thrown", async () => {
    expect(await recordMailboxProof("T", fx(Response.json({ ok: false, reason: "address_mismatch" }, { status: 409 })))).toEqual({ ok: false, reason: "address_mismatch" });
    expect(await recordMailboxProof("T", fx(new Response("<html>", { status: 404 })))).toEqual({ ok: false, reason: "http_404" });
    expect(await recordMailboxProof("T", vi.fn(async () => { throw new TypeError("net"); }))).toEqual({ ok: false, reason: "network" });
    expect(await recordMailboxProof("", fx(Response.json({ ok: true })))).toEqual({ ok: false, reason: "no_session" });
  });
});
