/* NEW-1 (2026-11-02) — GUARD AGAINST B2619760 HAPPENING AGAIN.
 *
 * B2619760: Supabase's captcha protection was switched ON for every public auth call, but the app only sent a bot-check
 * token with sign-up. Sign-in and forgot-password sent none, so every signed-out person was locked out — for days — and no
 * test noticed, because every test (and every headless session) signs in through a route that skips the real path.
 *
 * Supabase's captcha gate covers: password sign-in, sign-up, password reset, one-time-password sign-in, resend, and
 * anonymous sign-in. This test lists EVERY `supabase.auth.<method>(` call and every raw `/auth/v1/<gated path>` request in
 * src/, functions/ and server/, and FAILS when a gated one is added without a captcha token in the same call — unless it is
 * a NAMED server route below, with the reason it is exempt. A new, unclassified auth method fails too: someone must decide
 * which side of the gate it is on, in writing, here.
 *
 * Scope on purpose: src/, functions/ and server/ (the shipped product). e2e/ and ui-audit/ are test tooling that signs in
 * through /api/auth/e2e-session; they are not the product's sign-in path and must not satisfy or trip this guard.
 *
 * If this fails for your change: pass `captchaToken` (supabase-js: `options.captchaToken`; raw: `gotrue_meta_security.captcha_token`)
 * from the Turnstile gate (src/shared/turnstile), report through `observeAuthCall` (src/shared/auth/authTelemetry.js), and
 * add the new path to scripts/lib/signinChecks.mjs if the outside-in check should exercise it. Do NOT add an exemption to
 * make it green unless the call truly cannot go through the public gate (an admin/service-role call). */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** supabase-js methods behind Supabase's captcha gate. */
export const GATED_METHODS = ["signInWithPassword", "signUp", "resetPasswordForEmail", "signInWithOtp", "resend", "signInAnonymously"];
/** supabase-js methods that are NOT behind it (each a deliberate classification — an unknown method fails the test). */
export const UNGATED_METHODS = {
  getUser: "reads the stored session", getSession: "reads the stored session", setSession: "installs tokens already minted",
  refreshSession: "refresh-token grant is not captcha-gated", onAuthStateChange: "a subscription, not a request",
  signOut: "ends a session", updateUser: "needs a live session", verifyOtp: "/auth/v1/verify is not captcha-gated (measured 2026-10-04)",
  exchangeCodeForSession: "PKCE exchange of a code already issued", signInWithOAuth: "redirects to the provider; no password path",
  reauthenticate: "needs a live session", getUserIdentities: "needs a live session",
};
/** Raw GoTrue paths behind the gate. */
const GATED_PATHS = ["token", "signup", "recover", "otp", "resend"];
/** NAMED exemptions: a gated-looking call that cannot go through the public gate. file → reason. Empty on purpose. */
export const NAMED_SERVER_ROUTES = {};

const TOKEN_RE = /captchaToken|captcha_token|gotrue_meta_security/;
const WINDOW_BEFORE = 15, WINDOW_AFTER = 3;

/** Blank out comments (keeping every newline so line numbers hold) — a comment must never satisfy or trip the guard. */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** → { violations: [{line, what}], unknown: [{line, method}], calls: [{line, kind, gated, hasToken}] } for one file's source. */
export function scanSource(src) {
  const text = stripComments(src);
  const lines = text.split("\n");
  const out = { violations: [], unknown: [], calls: [] };
  lines.forEach((ln, i) => {
    const win = lines.slice(Math.max(0, i - WINDOW_BEFORE), i + WINDOW_AFTER + 1).join("\n");
    for (const m of ln.matchAll(/\.auth\.([A-Za-z]+)\s*\(/g)) {
      const method = m[1];
      if (GATED_METHODS.includes(method)) {
        const hasToken = TOKEN_RE.test(win);
        out.calls.push({ line: i + 1, kind: method, gated: true, hasToken });
        if (!hasToken) out.violations.push({ line: i + 1, what: `supabase.auth.${method}() with no captcha token nearby` });
      } else if (!(method in UNGATED_METHODS)) out.unknown.push({ line: i + 1, method });
    }
    for (const m of ln.matchAll(/auth\/v1\/([a-z_]+)/g)) {
      if (!GATED_PATHS.includes(m[1])) continue;
      const hasToken = TOKEN_RE.test(win);
      out.calls.push({ line: i + 1, kind: "raw:" + m[1], gated: true, hasToken });
      if (!hasToken) out.violations.push({ line: i + 1, what: `raw request to /auth/v1/${m[1]} with no captcha token nearby` });
    }
  });
  return out;
}

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.(js|jsx|mjs|ts|tsx)$/.test(name) && !/\.test\./.test(name)) acc.push(p);
  }
  return acc;
}
const FILES = ["src", "functions", "server"].flatMap((d) => walk(join(ROOT, d)));

describe("every Supabase auth call behind the captcha gate carries a bot-check token (B2619760)", () => {
  const scanned = FILES.map((f) => ({ file: relative(ROOT, f), ...scanSource(readFileSync(f, "utf8")) }));

  it("no gated call is missing its token (or named as an exempt server route)", () => {
    const bad = scanned.flatMap((s) => s.violations.map((v) => ({ ...v, file: s.file }))).filter((v) => !(v.file in NAMED_SERVER_ROUTES));
    expect(bad.map((v) => `${v.file}:${v.line} — ${v.what}`)).toEqual([]);
  });

  it("no auth method exists that nobody has classified as gated or not", () => {
    const unknown = scanned.flatMap((s) => s.unknown.map((u) => `${s.file}:${u.line} — supabase.auth.${u.method}() is neither in GATED_METHODS nor UNGATED_METHODS`));
    expect(unknown).toEqual([]);
  });

  it("the guard actually SEES the product's real gated calls (not vacuously green): sign in, sign up, reset", () => {
    const kinds = new Set(scanned.flatMap((s) => s.calls.map((c) => c.kind)));
    for (const k of ["signInWithPassword", "signUp", "resetPasswordForEmail"]) expect(kinds.has(k), k).toBe(true);
    const all = scanned.flatMap((s) => s.calls);
    expect(all.length).toBeGreaterThanOrEqual(3);
    expect(all.every((c) => c.hasToken)).toBe(true);
  });

  it("the server routes that call GoTrue directly use only ungated paths (verify / admin / user)", () => {
    const raw = scanned.filter((s) => s.file.startsWith("functions/") || s.file.startsWith("server/")).flatMap((s) => s.calls.filter((c) => c.kind.startsWith("raw:")));
    expect(raw).toEqual([]);
  });

  it("every exemption still names a file that exists", () => {
    for (const f of Object.keys(NAMED_SERVER_ROUTES)) expect(() => statSync(join(ROOT, f)), f).not.toThrow();
  });
});

describe("the scanner itself — RED-PROOF on synthetic sources (a guard nobody has seen fail is not a guard)", () => {
  it("flags a token-less sign-in", () => {
    const r = scanSource("export async function go(e, p) {\n  return supabase.auth.signInWithPassword({ email: e, password: p });\n}\n");
    expect(r.violations).toEqual([{ line: 2, what: "supabase.auth.signInWithPassword() with no captcha token nearby" }]);
  });
  it("passes the same call when it carries a token", () => {
    expect(scanSource("const creds = { email: e, password: p, options: { captchaToken } };\nsupabase.auth.signInWithPassword(creds);").violations).toEqual([]);
  });
  it("flags every other gated method: sign-up, reset, OTP, resend, anonymous", () => {
    for (const m of ["signUp", "resetPasswordForEmail", "signInWithOtp", "resend", "signInAnonymously"]) {
      expect(scanSource(`await supabase.auth.${m}({ email });`).violations, m).toHaveLength(1);
    }
  });
  it("flags a raw fetch to a gated GoTrue path, and not to an ungated one", () => {
    expect(scanSource('fetch(`${base}/auth/v1/token?grant_type=password`, { method: "POST" });').violations).toHaveLength(1);
    expect(scanSource('fetch(`${base}/auth/v1/recover`, { method: "POST" });').violations).toHaveLength(1);
    expect(scanSource('fetch(`${base}/auth/v1/verify`, { method: "POST" });').violations).toEqual([]);
    expect(scanSource('fetch(`${base}/auth/v1/admin/generate_link`);').violations).toEqual([]);
  });
  it("a token mentioned only in a COMMENT does not count; a gated call mentioned only in a comment does not trip", () => {
    expect(scanSource("// captchaToken goes here\nsupabase.auth.signUp({ email });").violations).toHaveLength(1);
    expect(scanSource("/* supabase.auth.signUp({ email }) */\nconst x = 1;").violations).toEqual([]);
    expect(scanSource("// supabase.auth.signInWithPassword(x)\n").violations).toEqual([]);
  });
  it("an unclassified auth method is reported, a classified one is not", () => {
    expect(scanSource("supabase.auth.signInWithIdToken({});").unknown).toEqual([{ line: 1, method: "signInWithIdToken" }]);
    expect(scanSource("supabase.auth.getUser();").unknown).toEqual([]);
  });
});
