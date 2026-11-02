/* NEW-1 (2026-11-02) — the OUTSIDE-IN sign-in checks: classifiers (pure) and probes (fake network). The property that
 * matters most: "unknown" (a runner Cloudflare would not let through) is never reported as a pass. */
import { describe, it, expect } from "vitest";
import {
  scanForSiteKey, extractSupabaseConfig, canReachTurnstile, classifyGateAnswer, combineGate, checkSiteKey, checkGate, checkEmailLink, classifyPanel, classifySignIn,
} from "../scripts/lib/signinChecks.mjs";
import { channelVerdict, drillExitCode, DRILL_NOT_ARMED } from "../scripts/signin-health-check.mjs";

const KEY = "0x4AAAAAAAFFjERHSPvI4t-dJ";
const page = (body, ct = "application/javascript") => new Response(body, { status: 200, headers: { "content-type": ct } });
function site(files) {
  return async (url) => {
    const p = new URL(url).pathname;
    if (p in files) return page(files[p], p === "/" ? "text/html" : undefined);
    return new Response("nope", { status: 404 });
  };
}

describe("site key scan", () => {
  it("finds a real key, ignores Cloudflare's always-pass TEST keys (and says so)", () => {
    expect(scanForSiteKey(`x={sitekey:"${KEY}"}`).found).toBe(KEY);
    expect(scanForSiteKey(`turnstile sitekey:"1x00000000000000000000AA"`)).toMatchObject({ found: null, testKey: true });
    expect(scanForSiteKey("nothing here")).toMatchObject({ found: null, testKey: false });
  });
  it("pass when the key is in the entry script", async () => {
    const f = site({ "/": '<script type="module" src="/assets/index-A.js"></script>', "/assets/index-A.js": `const k="${KEY}"` });
    const r = await checkSiteKey({ base: "https://planyr.io", fetchImpl: f });
    expect(r.check.status).toBe("pass"); expect(r.siteKey).toBe(KEY);
  });
  it("finds the key in a lazily loaded chunk the entry only names", async () => {
    const f = site({ "/": '<script type="module" src="/assets/index-A.js"></script>', "/assets/index-A.js": 'import("./auth-B.js")', "/assets/auth-B.js": `k="${KEY}"` });
    expect((await checkSiteKey({ base: "https://planyr.io", fetchImpl: f })).check.status).toBe("pass");
  });
  it("FAIL when the bundle has no key (the 2026-10 outage's cause) — and when it ships a test key", async () => {
    const none = site({ "/": '<script type="module" src="/assets/index-A.js"></script>', "/assets/index-A.js": "no key" });
    expect((await checkSiteKey({ base: "https://planyr.io", fetchImpl: none })).check).toMatchObject({ status: "fail", detail: expect.stringMatching(/no Turnstile site key/) });
    const test = site({ "/": '<script type="module" src="/assets/index-A.js"></script>', "/assets/index-A.js": 'turnstile sitekey:"1x00000000000000000000AA"' });
    expect((await checkSiteKey({ base: "https://planyr.io", fetchImpl: test })).check.detail).toMatch(/TEST key/);
  });
  it("FAIL (not unknown) when the live site cannot be read at all", async () => {
    const r = await checkSiteKey({ base: "https://planyr.io", fetchImpl: async () => { throw new Error("ECONNRESET"); } });
    expect(r.check.status).toBe("fail");
  });
});

describe("supabase config extraction", () => {
  it("takes env first, then reads url + anon JWT out of the bundle", () => {
    const jwt = ["e30", Buffer.from(JSON.stringify({ role: "anon" })).toString("base64url").padEnd(30, "A"), "S".repeat(30)].join(".");
    expect(extractSupabaseConfig([`u="https://abcdefghijklmnopqrst.supabase.co" k="eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon", x: "y" })).toString("base64url")}.${"S".repeat(30)}"`]).url).toBe("https://abcdefghijklmnopqrst.supabase.co");
    const c = extractSupabaseConfig([`k="eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "anon", x: "y" })).toString("base64url")}.${"S".repeat(30)}"`]);
    expect(c.anon).toMatch(/^eyJ/);
    expect(extractSupabaseConfig(["x"], { VITE_SUPABASE_URL: "U", VITE_SUPABASE_ANON_KEY: "K" })).toEqual({ url: "U", anon: "K" });
    expect(jwt).toBeTruthy();
  });
  it("a service-role JWT in a bundle is NOT taken as the anon key", () => {
    const c = extractSupabaseConfig([`k="eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url")}.${"S".repeat(30)}"`]);
    expect(c.anon).toBeNull();
  });
});

describe("server gate — both directions of a settings change", () => {
  const ans = (status, body) => classifyGateAnswer({ status, body });
  it("reads the token endpoint's answer", () => {
    expect(ans(400, { error_code: "captcha_failed", msg: "captcha protection: request disallowed" })).toBe("on");
    expect(ans(400, { error_code: "invalid_credentials", msg: "Invalid login credentials" })).toBe("off");
    expect(ans(429, {})).toBe("limited");
    expect(ans(500, {})).toBe("error");
    expect(ans(200, {})).toBe("error");
  });
  it("the four key × gate combinations", () => {
    expect(combineGate({ gate: "on", siteKey: KEY }).status).toBe("pass");
    expect(combineGate({ gate: "on", siteKey: null })).toMatchObject({ status: "fail", detail: expect.stringMatching(/nobody can sign in/) }); // = B2619760
    expect(combineGate({ gate: "off", siteKey: KEY })).toMatchObject({ status: "fail", detail: expect.stringMatching(/settings change/) });
    expect(combineGate({ gate: "off", siteKey: null }).status).toBe("fail");
    expect(combineGate({ gate: "error", siteKey: KEY, status: 502 }).status).toBe("fail");
    expect(combineGate({ gate: "limited", siteKey: KEY }).status).toBe("unknown");
  });
  it("the probe sends NO captcha token and no real account", async () => {
    let sent = null;
    const f = async (url, init) => { sent = { url, body: JSON.parse(init.body), headers: init.headers }; return Response.json({ error_code: "captcha_failed", msg: "captcha protection" }, { status: 400 }); };
    const r = await checkGate({ supabaseUrl: "https://x.supabase.co", anonKey: "ANON", siteKey: KEY, fetchImpl: f });
    expect(r.status).toBe("pass");
    expect(sent.url).toBe("https://x.supabase.co/auth/v1/token?grant_type=password");
    expect(JSON.stringify(sent.body)).not.toMatch(/captcha|gotrue_meta_security/);
    expect(sent.body.email).toMatch(/@invalid\.example$/);
  });
  it("an unreachable Supabase is a FAIL; no config to probe with is unknown, not pass", async () => {
    expect((await checkGate({ supabaseUrl: "https://x.supabase.co", anonKey: "A", siteKey: KEY, fetchImpl: async () => { throw new Error("down"); } })).status).toBe("fail");
    expect((await checkGate({ supabaseUrl: null, anonKey: null, siteKey: KEY })).status).toBe("unknown");
  });
});

describe("email-link route — skips cleanly until it exists", () => {
  const r = (status, ct, body = "") => async () => new Response(body, { status, headers: ct ? { "content-type": ct } : {} });
  it("absent: a bare 405 / 404 / the home page → skipped (measured 2026-11-02: planyr.io answers a bare 405)", async () => {
    for (const f of [r(405), r(404, "text/plain"), r(200, "text/html", "<html>")]) expect((await checkEmailLink({ base: "https://planyr.io", fetchImpl: f })).status).toBe("skipped");
  });
  it("present: JSON non-5xx → pass; 5xx → fail; no answer → fail", async () => {
    expect((await checkEmailLink({ base: "https://planyr.io", fetchImpl: r(400, "application/json", "{}") })).status).toBe("pass");
    expect((await checkEmailLink({ base: "https://planyr.io", fetchImpl: r(503, "application/json", "{}") })).status).toBe("fail");
    expect((await checkEmailLink({ base: "https://planyr.io", fetchImpl: async () => { throw new Error("x"); } })).status).toBe("fail");
  });
});

describe("panel", () => {
  const ok = { opened: true, emailVisible: true, passwordVisible: true, submitVisible: true, submitEnabled: true, text: "Email Password Sign in", widgetState: "ready", widgetError: null };
  it("healthy", () => { expect(classifyPanel(ok).status).toBe("pass"); });
  it("each broken form is a FAIL", () => {
    expect(classifyPanel({ ...ok, opened: false }).status).toBe("fail");
    expect(classifyPanel({ ...ok, passwordVisible: false }).status).toBe("fail");
    expect(classifyPanel({ ...ok, submitEnabled: false }).status).toBe("fail");
    expect(classifyPanel({ ...ok, text: "captcha protection: request disallowed" }).status).toBe("fail");
    expect(classifyPanel({ ...ok, text: "Something went wrong undefined" }).status).toBe("fail");
  });
  it("widget: script blocked / our config rejected → FAIL; some other Cloudflare error → UNKNOWN (never pass)", () => {
    expect(classifyPanel({ ...ok, widgetState: "error", widgetError: "script" }).status).toBe("fail");
    // A Cloudflare outage looks the same from the runner: it must ALARM, not read as unknown (the one outage nothing would see).
    expect(classifyPanel({ ...ok, widgetState: "error", widgetError: "script", scriptReachable: false })).toMatchObject({ status: "fail", detail: expect.stringMatching(/unreachable from the runner/) });
    expect(classifyPanel({ ...ok, widgetState: "error", widgetError: "110200" })).toMatchObject({ status: "fail", detail: expect.stringMatching(/allowed-domain/) });
    expect(classifyPanel({ ...ok, widgetState: "error", widgetError: "600010" }).status).toBe("unknown");
  });
});

describe("real sign-in — Cloudflare refusing a datacenter is UNKNOWN, a broken gate is FAIL", () => {
  it("signed in → pass", () => { expect(classifySignIn({ signedIn: true }).status).toBe("pass"); });
  it("no request ever made (no token from the widget) → unknown", () => {
    expect(classifySignIn({ signedIn: false, tokenResponse: null, widgetState: "interactive" })).toMatchObject({ status: "unknown", detail: expect.stringMatching(/not a pass/) });
  });
  it("Supabase refused a token the real widget produced → FAIL", () => {
    expect(classifySignIn({ signedIn: false, tokenSeen: true, tokenResponse: { status: 400, errorCode: "captcha_failed" } }).status).toBe("fail");
  });
  it("Supabase refused for a MISSING token → FAIL", () => {
    expect(classifySignIn({ signedIn: false, tokenSeen: false, tokenResponse: { status: 400, errorCode: "captcha_failed" } }).status).toBe("fail");
  });
  it("script failed to load: FAIL whether or not the runner can reach Cloudflare (an outage there must alarm)", () => {
    expect(classifySignIn({ signedIn: false, tokenResponse: null, widgetState: "error", widgetError: "script", scriptReachable: true }).status).toBe("fail");
    expect(classifySignIn({ signedIn: false, tokenResponse: null, widgetState: "error", widgetError: "script", scriptReachable: false }).status).toBe("fail");
  });
  it("Supabase 5xx → FAIL; our Cloudflare config rejected → FAIL", () => {
    expect(classifySignIn({ signedIn: false, tokenResponse: { status: 502, errorCode: "" } }).status).toBe("fail");
    expect(classifySignIn({ signedIn: false, tokenResponse: null, widgetState: "error", widgetError: "110200" }).status).toBe("fail");
  });
  it("bot check passed but the test account's password was rejected → unknown (the checker's credentials, not the product)", () => {
    expect(classifySignIn({ signedIn: false, tokenSeen: true, tokenResponse: { status: 400, errorCode: "invalid_credentials" } }).status).toBe("unknown");
  });
});

describe("the channel verdict (what makes the workflow go red or raise the second alert)", () => {
  it("ok when delivery is sent / not needed / suppressed", () => {
    for (const d of ["sent", "not-needed", "recovery-sent", "suppressed-cooldown"]) expect(channelVerdict({ ok: true, body: { ok: true, delivery: d } }).code).toBe(0);
  });
  it("code 4 when an alert was due and mail did not go out", () => {
    expect(channelVerdict({ ok: true, body: { ok: true, delivery: "not-configured", mail: { error: "e" } } })).toMatchObject({ code: 4, status: "not-configured" });
    expect(channelVerdict({ ok: true, body: { ok: true, delivery: "failed", mail: { error: "e" } } })).toMatchObject({ code: 4, status: "mail-failed" });
  });
  it("not_migrated is a loud-but-clean 'not armed' (exit 0): no red every hour before the SQL is run", () => {
    expect(channelVerdict({ ok: false, status: 503, body: { ok: false, reason: "not_migrated", error: "run the sql" } })).toMatchObject({ status: "not-armed", code: 0 });
    expect(channelVerdict({ ok: false, status: 503, body: { ok: false, error: "other" } }).code).toBe(3);   // any other 503 is still a failure
  });
  it("code 3 when the route was refused / unreachable / failed", () => {
    expect(channelVerdict({ ok: false, status: 401, error: "not authorized" })).toMatchObject({ code: 3, status: "unreachable" });
    expect(channelVerdict({ ok: false, status: 0, error: "fetch failed" }).code).toBe(3);
  });
});

describe("canReachTurnstile", () => {
  it("true on a 200, false on a refusal or a network error", async () => {
    expect(await canReachTurnstile(async () => new Response("x", { status: 200 }))).toBe(true);
    expect(await canReachTurnstile(async () => new Response("x", { status: 403 }))).toBe(false);
    expect(await canReachTurnstile(async () => { throw new Error("ECONNREFUSED"); })).toBe(false);
  });
});

describe("drill exit codes (found live 2026-11-02: the first drill raised a false 'alarm channel is not delivering' issue)", () => {
  it("'not armed' (SQL not run) has its own code, distinct from a broken channel, so the workflow raises no issue for it", () => {
    expect(drillExitCode(channelVerdict({ ok: false, status: 503, body: { reason: "not_migrated", error: "run the sql" } }))).toBe(DRILL_NOT_ARMED);
    expect(DRILL_NOT_ARMED).toBe(5);
  });
  it("a genuinely broken channel keeps its code; a verdict with no code still ends non-zero", () => {
    expect(drillExitCode(channelVerdict({ ok: false, status: 401, error: "not authorized" }))).toBe(3);
    expect(drillExitCode({ status: "mail-failed", code: 4 })).toBe(4);
    expect(drillExitCode({ status: "ok", code: 0 })).toBe(1);
  });
  it("the workflow's issue step excludes exactly that code", () => {
    const wf = require("node:fs").readFileSync(new URL("../.github/workflows/signin-health.yml", import.meta.url), "utf8");
    expect(wf).toMatch(/steps\.check\.outputs\.code != '0' && steps\.check\.outputs\.code != '5'/);
  });
});
