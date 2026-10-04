import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { handleE2eSession, safeEqual, E2E_EMAIL, E2E_USER_ID, onRequest } from "../functions/api/auth/e2e-session.js";

const KEY = "k".repeat(43);
const ENV = { E2E_LOGIN_KEY: KEY, SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "SERVICE-SECRET", SUPABASE_ANON_KEY: "ANON" };
const req = (o = {}) => new Request("https://planyr.io/api/auth/e2e-session", { method: "POST", headers: { "x-e2e-login-key": KEY, ...(o.headers || {}) }, body: o.body, ...(o.method ? { method: o.method } : {}) });
const noCors = (res) => { for (const [k] of res.headers) expect(k.toLowerCase().startsWith("access-control-")).toBe(false); };

/* Fake Supabase: generate_link resolves whatever email it is ASKED for to a user; verify returns that user. */
function fakeSupabase({ users = {}, calls = [] } = {}) {
  const all = { [E2E_EMAIL]: { id: E2E_USER_ID, email: E2E_EMAIL }, "michael@real.example": { id: "michael-id", email: "michael@real.example" }, ...users };
  const fn = vi.fn(async (url, init) => {
    const body = JSON.parse(init.body); calls.push({ url, body, headers: init.headers });
    if (url.endsWith("/admin/generate_link")) {
      const u = all[body.email]; if (!u) return Response.json({ msg: "nope" }, { status: 404 });
      return Response.json({ ...u, hashed_token: "H-" + u.id, properties: { hashed_token: "H-" + u.id } });
    }
    if (url.endsWith("/verify")) {
      const id = body.token_hash.slice(2); const u = Object.values(all).find((x) => x.id === id);
      return Response.json({ access_token: "AT", refresh_token: "RT", token_type: "bearer", expires_in: 3600, expires_at: 1, user: u });
    }
    return new Response("?", { status: 500 });
  });
  return fn;
}
const run = (r, env = ENV, f = fakeSupabase()) => handleE2eSession(r, env, { fetch: f });

describe("e2e-session route — closed by default", () => {
  it("no env key → 404", async () => { const r = await run(req(), { ...ENV, E2E_LOGIN_KEY: undefined }); expect(r.status).toBe(404); noCors(r); });
  it("short env key (31 chars) → 404 even when the caller presents it", async () => {
    const short = "s".repeat(31); const r = await run(req({ headers: { "x-e2e-login-key": short } }), { ...ENV, E2E_LOGIN_KEY: short });
    expect(r.status).toBe(404); noCors(r);
  });
  it("wrong key → 404, identical to disabled (does not reveal the route)", async () => {
    const wrong = await run(req({ headers: { "x-e2e-login-key": "w".repeat(43) } }));
    const off = await run(req(), { ...ENV, E2E_LOGIN_KEY: undefined });
    expect(wrong.status).toBe(404); expect(await wrong.text()).toBe(await off.text());
  });
  it("missing key header → 404; key in the URL is ignored", async () => {
    const r = await handleE2eSession(new Request(`https://planyr.io/api/auth/e2e-session?key=${KEY}`, { method: "POST" }), ENV, { fetch: fakeSupabase() });
    expect(r.status).toBe(404);
  });
  it("the upstream is never contacted without the key", async () => {
    const f = fakeSupabase(); await run(req({ headers: { "x-e2e-login-key": "nope" } }), ENV, f); expect(f).not.toHaveBeenCalled();
  });
  it("GET / PUT / DELETE / OPTIONS → 405 with no CORS headers", async () => {
    for (const method of ["GET", "PUT", "DELETE", "OPTIONS", "HEAD"]) {
      const r = await run(new Request("https://planyr.io/api/auth/e2e-session", { method, headers: { "x-e2e-login-key": KEY } }));
      expect(r.status).toBe(405); noCors(r);
    }
  });
});

describe("e2e-session route — only ever the test account", () => {
  it("valid key → test account session; success carries no CORS header", async () => {
    const r = await run(req()); expect(r.status).toBe(200); noCors(r);
    const j = await r.json(); expect(j.user).toEqual({ id: E2E_USER_ID, email: E2E_EMAIL }); expect(j.access_token).toBe("AT");
  });
  it("a body naming another user's email/id is ignored — still only the test account", async () => {
    const calls = []; const f = fakeSupabase({ calls });
    const r = await run(req({ body: JSON.stringify({ email: "michael@real.example", id: "michael-id", user_id: "michael-id" }) }), ENV, f);
    expect(r.status).toBe(200); expect((await r.json()).user.id).toBe(E2E_USER_ID);
    expect(calls.every((c) => c.body.email === undefined || c.body.email === E2E_EMAIL)).toBe(true);
    expect(calls[0].body.email).toBe(E2E_EMAIL);
  });
  it("PIN: if the fixed email ever resolves to a different user id, nothing is issued", async () => {
    const f = fakeSupabase({ users: { [E2E_EMAIL]: { id: "someone-else", email: E2E_EMAIL } } });
    const r = await run(req(), ENV, f); expect(r.status).toBe(403);
    expect(f.mock.calls.some(([u]) => u.endsWith("/verify"))).toBe(false); // refused BEFORE exchanging
    expect(await r.text()).not.toContain("AT");
  });
  it.each([
    ["right email, wrong id", { id: "michael-id", email: E2E_EMAIL }],
    ["right id, wrong email", { id: E2E_USER_ID, email: "michael@real.example" }],
  ])("PIN: a session from /verify with %s is not returned", async (_n, user) => {
    const f = vi.fn(async (url) => url.endsWith("/admin/generate_link")
      ? Response.json({ id: E2E_USER_ID, email: E2E_EMAIL, hashed_token: "h" })
      : Response.json({ access_token: "AT", refresh_token: "RT", user }));
    const r = await run(req(), ENV, f); expect(r.status).toBe(403); expect(await r.text()).not.toContain("AT");
  });
  it("service key goes only to the admin call; anon key to /verify; neither appears in any response or log", async () => {
    const calls = []; const logs = []; const spy = vi.spyOn(console, "log").mockImplementation((s) => logs.push(String(s)));
    const r = await run(req(), ENV, fakeSupabase({ calls })); const text = await r.text(); spy.mockRestore();
    expect(JSON.stringify(calls[1].headers)).not.toContain("SERVICE-SECRET");
    for (const s of [text, ...logs]) { expect(s).not.toContain("SERVICE-SECRET"); expect(s).not.toContain(KEY); expect(s).not.toContain("H-"); }
    expect(logs.some((l) => l.includes('"ok":true'))).toBe(true);
  });
  it("failed calls are logged too (misuse visible), without the presented key", async () => {
    const logs = []; const spy = vi.spyOn(console, "log").mockImplementation((s) => logs.push(String(s)));
    await run(req({ headers: { "x-e2e-login-key": "guess-guess-guess-guess-guess-guess-guess" } })); spy.mockRestore();
    expect(logs.join("")).toContain('"ok":false'); expect(logs.join("")).not.toContain("guess-guess");
  });
  it("upstream failure → 502, never a partial session", async () => {
    const r = await run(req(), ENV, vi.fn(async () => { throw new Error("boom"); })); expect(r.status).toBe(502);
  });
  it("valid key but missing Supabase config → 503 (post-auth only)", async () => {
    expect((await run(req(), { ...ENV, SUPABASE_SERVICE_ROLE_KEY: "" })).status).toBe(503);
  });
  it("Pages entry point wires context.request/env through", async () => {
    const r = await onRequest({ request: req({ method: "GET" }), env: ENV }); expect(r.status).toBe(405);
  });
});

describe("constant-time compare", () => {
  it("equal / unequal / different length", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true); expect(await safeEqual("abc", "abd")).toBe(false); expect(await safeEqual("abc", "abcd")).toBe(false); expect(await safeEqual("", "")).toBe(true);
  });
  it("source uses no early-exit string compare on the key", () => {
    const src = readFileSync(new URL("../functions/api/auth/e2e-session.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/presented\s*[!=]==?\s*loginKey|loginKey\s*[!=]==?\s*presented/);
    expect(src).toMatch(/safeEqual\(presented, loginKey\)/);
    expect(/access-control/i.test(src.replace(/\/\*[\s\S]*?\*\//, ""))).toBe(false);
  });
});
