/* "Connect to Claude" OAuth routes (2026-11-27): registration allow-list, the authorize step (an error PAGE and never
 * a redirect for a bad client or redirect), PKCE S256 at the token endpoint, and the discovery documents.
 * The database half is proven separately on the real SQL (test/mcpOauthSql.test.js). */
import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { redirectAllowed, s256, wwwAuthenticate, protectedResourceMetadata, authorizationServerMetadata } from "../functions/api/oauth/_lib.js";
import { handleRegister } from "../functions/api/oauth/register.js";
import { handleToken } from "../functions/api/oauth/token.js";
import { handleAuthorize } from "../functions/oauth/authorize.js";
import { onRequest as asMetadata } from "../functions/.well-known/oauth-authorization-server.js";
import { onRequest as prMetadataRoot } from "../functions/.well-known/oauth-protected-resource/index.js";
import { onRequest as prMetadataPath } from "../functions/.well-known/oauth-protected-resource/[[path]].js";

const ENV = { SUPABASE_URL: "https://main.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "svc-key" };
const CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";   // RFC 7636 appendix B
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";

function rpcStub(answers) {
  const calls = [];
  const fn = vi.fn(async (url, init) => {
    const name = String(url).split("/rpc/")[1];
    calls.push({ name, args: JSON.parse(init.body), headers: init.headers });
    const a = typeof answers[name] === "function" ? answers[name](JSON.parse(init.body)) : answers[name];
    if (a instanceof Response) return a;
    return new Response(JSON.stringify(a ?? { ok: false }), { status: 200 });
  });
  fn.calls_ = calls;
  return fn;
}
const post = (url, body, type = "application/json") => new Request(url, {
  method: "POST", headers: { "content-type": type, "cf-connecting-ip": "203.0.113.9" },
  body: type === "application/json" ? JSON.stringify(body) : new URLSearchParams(body).toString(),
});

describe("redirect allow-list and PKCE", () => {
  it("allows only Claude's callbacks and loopback", () => {
    for (const ok of [CALLBACK, "https://claude.com/api/mcp/auth_callback", "http://localhost:6274/oauth/callback", "http://127.0.0.1:33418", "http://localhost/cb"]) expect(redirectAllowed(ok)).toBe(true);
    for (const bad of ["https://evil.test/api/mcp/auth_callback", "https://claude.ai.evil.test/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback/", "https://claude.ai/api/mcp/auth_callback?x=1",
      "http://claude.ai/api/mcp/auth_callback", "http://localhost.evil.test/cb", "http://127.0.0.1@evil.test/cb", "https://localhost/cb", "javascript:alert(1)", "", null, 7]) {
      expect(redirectAllowed(bad)).toBe(false);
    }
  });
  it("matches the database's allow-list exactly (one rule, two enforcers)", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync(new URL("../server/mcp/db/mcp_oauth.sql", import.meta.url), "utf8");
    const lib = readFileSync(new URL("../functions/api/oauth/_lib.js", import.meta.url), "utf8");
    const sqlRe = /u ~ '(\^http:[^']+)'/.exec(sql)[1];
    const jsRe = /LOOPBACK_RE = \/(.+)\/;/.exec(lib)[1].replace(/\\\//g, "/");
    expect(jsRe).toBe(sqlRe);
    for (const u of ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"]) expect(sql).toContain(`'${u}'`);
  });
  it("S256 is RFC 7636's own example", async () => {
    expect(await s256(VERIFIER)).toBe(CHALLENGE);
    expect(await s256("x".repeat(43))).toBe(createHash("sha256").update("x".repeat(43)).digest("base64url"));
  });
});

describe("POST /api/oauth/register", () => {
  it("registers Claude and stores only a keyed hash of the address", async () => {
    const f = rpcStub({ mcp_oauth_register: { ok: true, client_id: "pmcp_client_1" } });
    const r = await handleRegister({ env: ENV, request: post("https://planyr.io/api/oauth/register", { client_name: "Claude", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"] }), fetchImpl: f });
    expect(r.status).toBe(201);
    expect(await r.json()).toMatchObject({ client_id: "pmcp_client_1", redirect_uris: [CALLBACK], token_endpoint_auth_method: "none" });
    const { args, headers } = f.calls_[0];
    expect(args.p_ip_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
    expect(headers.authorization).toBe("Bearer svc-key");
  });
  it("refuses a foreign redirect before touching the database", async () => {
    const f = rpcStub({});
    for (const uris of [["https://evil.test/cb"], [CALLBACK, "https://evil.test/cb"], [], "https://claude.ai/api/mcp/auth_callback", undefined]) {
      const r = await handleRegister({ env: ENV, request: post("https://planyr.io/api/oauth/register", { client_name: "Claude", redirect_uris: uris }), fetchImpl: f });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("invalid_redirect_uri");
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("refuses confidential-client and other grant types", async () => {
    const f = rpcStub({});
    const a = await handleRegister({ env: ENV, request: post("https://x/api/oauth/register", { redirect_uris: [CALLBACK], token_endpoint_auth_method: "client_secret_post" }), fetchImpl: f });
    const b = await handleRegister({ env: ENV, request: post("https://x/api/oauth/register", { redirect_uris: [CALLBACK], grant_types: ["client_credentials"] }), fetchImpl: f });
    expect([a.status, b.status]).toEqual([400, 400]);
  });
  it("strips markup from the self-reported name", async () => {
    const f = rpcStub({ mcp_oauth_register: { ok: true, client_id: "c" } });
    await handleRegister({ env: ENV, request: post("https://x/api/oauth/register", { client_name: "<b>Claude</b>\u0007", redirect_uris: [CALLBACK] }), fetchImpl: f });
    expect(f.calls_[0].args.p_name).toBe("bClaude/b");
  });
  it("throttled → 429; database down → 503", async () => {
    const t = await handleRegister({ env: ENV, request: post("https://x/api/oauth/register", { redirect_uris: [CALLBACK] }), fetchImpl: rpcStub({ mcp_oauth_register: { ok: false, reason: "throttled" } }) });
    expect(t.status).toBe(429);
    const d = await handleRegister({ env: ENV, request: post("https://x/api/oauth/register", { redirect_uris: [CALLBACK] }), fetchImpl: rpcStub({ mcp_oauth_register: new Response("x", { status: 500 }) }) });
    expect(d.status).toBe(503);
  });
});

describe("GET /oauth/authorize", () => {
  const url = (o) => "https://planyr.io/oauth/authorize?" + new URLSearchParams({ response_type: "code", client_id: "pmcp_client_1", redirect_uri: CALLBACK, code_challenge: CHALLENGE, code_challenge_method: "S256", state: "abc", scope: "planyr.read", ...o });
  const go = (o, f) => handleAuthorize({ env: ENV, request: new Request(url(o)), fetchImpl: f });
  const isPageNotRedirect = async (r) => {
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(r.headers.get("x-frame-options")).toBe("DENY");
    expect(r.headers.get("content-security-policy")).toMatch(/frame-ancestors 'none'/);
    return r.text();
  };

  it("a good request is stored and the browser goes to the Allow page with ONLY an id", async () => {
    const f = rpcStub({ mcp_oauth_begin: { ok: true, request_id: "11111111-2222-4333-8444-555555555555" } });
    const r = await go({}, f);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/#/connect/11111111-2222-4333-8444-555555555555");
    expect(f.calls_[0].args).toEqual({ p_client_id: "pmcp_client_1", p_redirect_uri: CALLBACK, p_state: "abc", p_code_challenge: CHALLENGE, p_scope: "planyr.read" });
  });
  it("an unknown client or an unregistered redirect gets a page, never a redirect", async () => {
    for (const reason of ["client", "redirect"]) {
      const html = await isPageNotRedirect(await go({}, rpcStub({ mcp_oauth_begin: { ok: false, reason } })));
      expect(html).toMatch(reason === "client" ? /Unknown assistant/ : /doesn&#39;t match/);
    }
  });
  it("plain PKCE, no PKCE, a wrong response type, or a wider scope get a page and never reach the database", async () => {
    const f = rpcStub({ mcp_oauth_begin: { ok: true, request_id: "x" } });
    for (const o of [{ code_challenge_method: "plain" }, { code_challenge: "" }, { code_challenge: "short" }, { response_type: "token" }, { scope: "planyr.read planyr.write" }, { client_id: "" }, { redirect_uri: "" }]) {
      const r = await go(o, f);
      expect(r.status).toBe(400);
      await isPageNotRedirect(r);
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("escapes nothing it echoes, because it echoes nothing from the request", async () => {
    const html = await isPageNotRedirect(await go({ client_id: "<script>x</script>" }, rpcStub({ mcp_oauth_begin: { ok: false, reason: "client" } })));
    expect(html).not.toContain("<script>");
  });
  it("a database outage is a visible error page", async () => {
    const r = await go({}, rpcStub({ mcp_oauth_begin: new Response("x", { status: 500 }) }));
    expect(r.status).toBe(503);
    await isPageNotRedirect(r);
  });
});

describe("POST /api/oauth/token", () => {
  const tokens = { ok: true, access_token: "pmcp_at_1", refresh_token: "pmcp_rt_1", token_type: "Bearer", expires_in: 3600, scope: "planyr.read" };
  const form = (o) => post("https://planyr.io/api/oauth/token", o, "application/x-www-form-urlencoded");

  it("authorization_code: sends the S256 of the verifier, never the verifier", async () => {
    const f = rpcStub({ mcp_oauth_exchange: tokens });
    const r = await handleToken({ env: ENV, request: form({ grant_type: "authorization_code", code: "pmcp_code_1", redirect_uri: CALLBACK, client_id: "c1", code_verifier: VERIFIER }), fetchImpl: f });
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(await r.json()).toEqual({ access_token: "pmcp_at_1", token_type: "Bearer", expires_in: 3600, refresh_token: "pmcp_rt_1", scope: "planyr.read" });
    expect(f.calls_[0].args).toEqual({ p_code: "pmcp_code_1", p_client_id: "c1", p_redirect_uri: CALLBACK, p_verifier_challenge: CHALLENGE });
  });
  it("a missing or malformed verifier is refused before the database (and the code is not spent by us)", async () => {
    const f = rpcStub({ mcp_oauth_exchange: tokens });
    for (const v of [undefined, "short", "x".repeat(129), "has space".padEnd(50, "x")]) {
      const r = await handleToken({ env: ENV, request: form({ grant_type: "authorization_code", code: "c", redirect_uri: CALLBACK, client_id: "c1", ...(v ? { code_verifier: v } : {}) }), fetchImpl: f });
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("invalid_grant");
    }
    expect(f).not.toHaveBeenCalled();
  });
  it("a refused code or refresh token is invalid_grant", async () => {
    const f = rpcStub({ mcp_oauth_exchange: { ok: false, error: "invalid_grant" }, mcp_oauth_refresh: { ok: false, error: "invalid_grant" } });
    const a = await handleToken({ env: ENV, request: form({ grant_type: "authorization_code", code: "c", redirect_uri: CALLBACK, client_id: "c1", code_verifier: VERIFIER }), fetchImpl: f });
    const b = await handleToken({ env: ENV, request: form({ grant_type: "refresh_token", refresh_token: "pmcp_rt_old", client_id: "c1" }), fetchImpl: f });
    expect([a.status, b.status]).toEqual([400, 400]);
    expect((await b.json()).error).toBe("invalid_grant");
  });
  it("refresh_token rotates through the database; JSON bodies work too", async () => {
    const f = rpcStub({ mcp_oauth_refresh: { ...tokens, access_token: "pmcp_at_2", refresh_token: "pmcp_rt_2" } });
    const r = await handleToken({ env: ENV, request: post("https://x/api/oauth/token", { grant_type: "refresh_token", refresh_token: "pmcp_rt_1", client_id: "c1" }), fetchImpl: f });
    expect((await r.json()).refresh_token).toBe("pmcp_rt_2");
    expect(f.calls_[0].args).toEqual({ p_refresh: "pmcp_rt_1", p_client_id: "c1" });
  });
  it("no client_id → 401; other grants → unsupported; GET → 405; outage → 503", async () => {
    expect((await handleToken({ env: ENV, request: form({ grant_type: "refresh_token", refresh_token: "r" }), fetchImpl: rpcStub({}) })).status).toBe(401);
    const u = await handleToken({ env: ENV, request: form({ grant_type: "client_credentials", client_id: "c1" }), fetchImpl: rpcStub({}) });
    expect((await u.json()).error).toBe("unsupported_grant_type");
    expect((await handleToken({ env: ENV, request: new Request("https://x/api/oauth/token") })).status).toBe(405);
    const d = await handleToken({ env: ENV, request: form({ grant_type: "refresh_token", refresh_token: "r", client_id: "c1" }), fetchImpl: rpcStub({ mcp_oauth_refresh: new Response("x", { status: 500 }) }) });
    expect(d.status).toBe(503);
  });
});

describe("discovery documents", () => {
  const ctx = (path, method = "GET") => ({ request: new Request("https://planyr.io" + path, { method }) });
  it("protected resource (root and /api/mcp) names Planyr as its own authorization server", async () => {
    for (const fn of [prMetadataRoot, prMetadataPath]) {
      const r = await fn(ctx("/.well-known/oauth-protected-resource/api/mcp"));
      expect(r.headers.get("content-type")).toMatch(/application\/json/);
      expect(await r.json()).toEqual(protectedResourceMetadata("https://planyr.io"));
    }
    expect(protectedResourceMetadata("https://planyr.io")).toMatchObject({ resource: "https://planyr.io/api/mcp", authorization_servers: ["https://planyr.io"] });
  });
  it("authorization server: S256 only, public clients, code + refresh", async () => {
    const m = await (await asMetadata(ctx("/.well-known/oauth-authorization-server"))).json();
    expect(m).toEqual(authorizationServerMetadata("https://planyr.io"));
    expect(m).toMatchObject({
      issuer: "https://planyr.io", authorization_endpoint: "https://planyr.io/oauth/authorize", token_endpoint: "https://planyr.io/api/oauth/token",
      registration_endpoint: "https://planyr.io/api/oauth/register", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
    });
  });
  it("the 401 challenge points at the path-specific protected-resource document", () => {
    expect(wwwAuthenticate("https://planyr.io", "invalid_token")).toBe('Bearer realm="planyr", resource_metadata="https://planyr.io/.well-known/oauth-protected-resource/api/mcp", error="invalid_token"');
  });
  it("POST to a discovery document is refused", async () => {
    expect((await asMetadata(ctx("/.well-known/oauth-authorization-server", "POST"))).status).toBe(405);
  });
});
