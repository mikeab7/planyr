/* NEW-1 (2026-11-02, after B2619760) — every auth outcome is reported through ONE helper, privacy-clean, and the three
 * wrappers in auth.js actually go through it. clientErrors.js + supabase.js are mocked: a unit test must never write a real row. */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({ events: [], next: null }));
vi.mock("../src/shared/telemetry/clientErrors.js", () => ({ reportClientEvent: (kind, message, extra) => { h.events.push({ kind, message, extra }); } }));
vi.mock("../src/workspaces/site-planner/lib/supabase.js", () => {
  const call = async () => { if (h.next instanceof Error) throw h.next; return h.next; };
  return { supabase: { auth: { signInWithPassword: call, signUp: call, resetPasswordForEmail: call } }, supabaseConfigured: () => true };
});

import { classifyAuthError, observeAuthCall, reportAuthOutcome, cleanExtra, emailDomain, AUTH_EVENT } from "../src/shared/auth/authTelemetry.js";
import { signIn, signUp, resetPassword } from "../src/workspaces/site-planner/lib/auth.js";

beforeEach(() => { h.events.length = 0; h.next = null; });

describe("classifyAuthError", () => {
  it("success", () => { expect(classifyAuthError(null)).toBe(AUTH_EVENT.OK); });
  it("a captcha refusal — by code or by words, object or string", () => {
    expect(classifyAuthError({ code: "captcha_failed", message: "x" })).toBe(AUTH_EVENT.CAPTCHA_REFUSED);
    expect(classifyAuthError({ message: "captcha protection: request disallowed (no captcha_token found)" })).toBe(AUTH_EVENT.CAPTCHA_REFUSED);
    expect(classifyAuthError("captcha protection: request disallowed")).toBe(AUTH_EVENT.CAPTCHA_REFUSED);
  });
  it("a wrong password is its own kind (counted, never an alarm)", () => {
    expect(classifyAuthError({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(AUTH_EVENT.WRONG_PASSWORD);
    expect(classifyAuthError({ message: "Invalid login credentials" })).toBe(AUTH_EVENT.WRONG_PASSWORD);
  });
  it("person-side outcomes are user-errors, not unexpected", () => {
    for (const code of ["email_not_confirmed", "over_request_rate_limit", "user_already_exists", "weak_password"]) expect(classifyAuthError({ code, message: "m" })).toBe(AUTH_EVENT.USER_ERROR);
  });
  it("person-side wording without a code is still a user-error", () => {
    for (const m of ["Password should be at least 6 characters.", "User already registered", "Email not confirmed"]) expect(classifyAuthError({ message: m })).toBe(AUTH_EVENT.USER_ERROR);
  });
  it("network failures", () => {
    expect(classifyAuthError({ name: "AuthRetryableFetchError", message: "Failed to fetch", status: 0 })).toBe(AUTH_EVENT.NETWORK);
    expect(classifyAuthError(new TypeError("Load failed"))).toBe(AUTH_EVENT.NETWORK);
  });
  it("anything else is unexpected", () => {
    expect(classifyAuthError({ message: "Database error querying schema", status: 500 })).toBe(AUTH_EVENT.UNEXPECTED);
  });
});

describe("privacy", () => {
  it("only the domain of an email ever leaves; never the address, never a password field", () => {
    reportAuthOutcome("signin", { code: "invalid_credentials", message: "Invalid login credentials" }, "Michael.Secret@Example.COM");
    const e = h.events[0];
    expect(JSON.stringify(e)).not.toMatch(/Michael|secret@/i);
    expect(e.extra).toEqual({ mode: "signin", domain: "example.com", code: "invalid_credentials" });
  });
  it("cleanExtra keeps only allow-listed primitive keys and drops anything else a caller passes", () => {
    expect(cleanExtra({ mode: "signin", password: "hunter2", email: "a@b.c", domain: "b.c", code: 110200, nested: { x: 1 }, reason: "r".repeat(300) }))
      .toEqual({ mode: "signin", domain: "b.c", code: 110200, reason: "r".repeat(80) });
  });
  it("emailDomain handles junk", () => { expect(emailDomain("nope")).toBe(""); expect(emailDomain(null)).toBe(""); expect(emailDomain("A@B.io")).toBe("b.io"); });
  it("the helper never takes a password argument", () => {
    const src = readFileSync(new URL("../src/shared/auth/authTelemetry.js", import.meta.url), "utf8");
    expect(src.split("\n").filter((l) => /^export (async )?function/.test(l)).join("\n")).not.toMatch(/password/i);
  });
});

describe("observeAuthCall", () => {
  it("returns the call's own result untouched and reports once", async () => {
    const res = { data: { session: {} }, error: null };
    expect(await observeAuthCall("signin", "a@b.c", async () => res)).toBe(res);
    expect(h.events.map((e) => e.kind)).toEqual(["auth-ok"]);
  });
  it("a THROWN error is reported and rethrown unchanged", async () => {
    const boom = new Error("Failed to fetch");
    await expect(observeAuthCall("signin", "a@b.c", async () => { throw boom; })).rejects.toBe(boom);
    expect(h.events.map((e) => e.kind)).toEqual(["auth-network"]);
  });
  it("never throws out of its own reporting", async () => {
    h.events.push = () => { throw new Error("sink broke"); };
    await expect(observeAuthCall("signin", "a@b.c", async () => ({ error: null }))).resolves.toBeTruthy();
    delete h.events.push;
  });
});

describe("the real auth.js wrappers report through the helper", () => {
  it("signIn: success, wrong password, server captcha refusal", async () => {
    h.next = { error: null }; await signIn("a@b.co", "pw", "tok");
    h.next = { error: { code: "invalid_credentials", message: "Invalid login credentials" } }; await signIn("a@b.co", "pw", "tok");
    h.next = { error: { code: "captcha_failed", message: "captcha protection: request disallowed" } }; const r = await signIn("a@b.co", "pw");
    expect(h.events.map((e) => e.kind)).toEqual(["auth-ok", "auth-wrong-password", "auth-captcha-refused"]);
    expect(r.error).not.toMatch(/captcha/i); // the screen copy is unchanged: plain words
    expect(h.events.every((e) => e.extra.mode === "signin" && e.extra.domain === "b.co")).toBe(true);
  });
  it("signUp and resetPassword report with their own mode", async () => {
    h.next = { data: { user: {}, session: null }, error: null }; await signUp("a@b.co", "pw", {}, "tok");
    h.next = { error: { code: "captcha_failed", message: "x" } }; await resetPassword("a@b.co");
    expect(h.events.map((e) => [e.kind, e.extra.mode])).toEqual([["auth-ok", "signup"], ["auth-captcha-refused", "reset"]]);
  });
  it("a thrown network error from supabase-js is reported and still thrown to the caller", async () => {
    h.next = new Error("Failed to fetch");
    await expect(signIn("a@b.co", "pw", "tok")).rejects.toThrow("Failed to fetch");
    expect(h.events[0].kind).toBe("auth-network");
  });
});

describe("Turnstile.jsx reports the three widget failures", () => {
  const src = readFileSync(new URL("../src/shared/turnstile/Turnstile.jsx", import.meta.url), "utf8");
  it("blocked script, widget error (with Cloudflare's code), timeout", () => {
    expect(src).toMatch(/AUTH_EVENT\.CAPTCHA_BLOCKED/);
    expect(src).toMatch(/AUTH_EVENT\.CAPTCHA_WIDGET_ERROR[\s\S]{0,60}code/);
    expect(src).toMatch(/AUTH_EVENT\.CAPTCHA_TIMEOUT/);
  });
  it("publishes the error code on the host element so the outside-in check can read it", () => {
    expect(src).toMatch(/data-turnstile-error=/);
  });
});
