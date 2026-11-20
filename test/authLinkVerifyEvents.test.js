/* NEW-1 — PROVE what supabase-js does when the landing page's button calls verifyOtp({ token_hash }), because the
 * set-new-password form depends on it and the library's behaviour for a typed verify differs from its URL detection
 * (detectSessionInUrl only reads a #access_token fragment; our link carries a token HASH in the query, so none of
 * that machinery runs). Real @supabase/supabase-js, fake network + in-memory storage:
 *   · type "recovery"  → ONE PASSWORD_RECOVERY event, a stored session, and no SIGNED_IN for the same call
 *   · type "magiclink" → SIGNED_IN, a stored session
 *   · a spent/expired token → an error with status 403 (nothing stored, no event) that classifyVerifyFailure calls "expired"
 * The Shell's listener opens the form on PASSWORD_RECOVERY, AND the landing page calls onRecovery() itself, so a missed
 * event cannot leave the form closed (checked structurally in authLinkWiring.test.js). */
import { describe, it, expect } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { classifyVerifyFailure } from "../src/shared/auth/authLink.js";

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (sub) => `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
const USER = { id: "11111111-1111-4111-8111-111111111111", aud: "authenticated", role: "authenticated", email: "me@x.example", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };

function client(verifyReply) {
  const seen = [];
  const store = new Map();
  const fetch = async (url, init) => {
    seen.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    if (String(url).includes("/auth/v1/verify")) return verifyReply();
    return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
  };
  const sb = createClient("https://x.supabase.co", "anon-key", {
    global: { fetch },
    auth: { persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) }, storageKey: "sb-test-auth-token" },
  });
  return { sb, seen, store };
}
const ok = () => Response.json({ access_token: jwt(USER.id), refresh_token: "r", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: USER });

describe("verifyOtp with a token hash — the events the app relies on", () => {
  it("recovery → PASSWORD_RECOVERY (once), session stored, the request carries token_hash + type recovery", async () => {
    const { sb, seen, store } = client(ok);
    const events = [];
    sb.auth.onAuthStateChange((e) => { events.push(e); });
    await new Promise((r) => setTimeout(r, 20)); events.length = 0;   // drop INITIAL_SESSION
    const { data, error } = await sb.auth.verifyOtp({ token_hash: "h".repeat(56), type: "recovery" });
    await new Promise((r) => setTimeout(r, 20));
    expect(error).toBeNull(); expect(data.session && data.user && data.user.id).toBe(USER.id);
    expect(events).toEqual(["PASSWORD_RECOVERY"]);
    expect(seen.find((c) => c.url.includes("/verify")).body).toMatchObject({ token_hash: "h".repeat(56), type: "recovery" });
    expect(store.get("sb-test-auth-token")).toBeTruthy();
  });
  it("magiclink → SIGNED_IN, session stored", async () => {
    const { sb, store } = client(ok);
    const events = []; sb.auth.onAuthStateChange((e) => { events.push(e); });
    await new Promise((r) => setTimeout(r, 20)); events.length = 0;
    const { data, error } = await sb.auth.verifyOtp({ token_hash: "h".repeat(56), type: "magiclink" });
    await new Promise((r) => setTimeout(r, 20));
    expect(error).toBeNull(); expect(data.session).toBeTruthy();
    expect(events).toEqual(["SIGNED_IN"]); expect(store.get("sb-test-auth-token")).toBeTruthy();
  });
  it("a spent / expired token → an error classified 'expired', nothing stored, no event", async () => {
    const { sb, store } = client(() => Response.json({ code: 403, error_code: "otp_expired", msg: "Email link is invalid or has expired" }, { status: 403 }));
    const events = []; sb.auth.onAuthStateChange((e) => { events.push(e); });
    await new Promise((r) => setTimeout(r, 20)); events.length = 0;
    const { data, error } = await sb.auth.verifyOtp({ token_hash: "h".repeat(56), type: "magiclink" });
    await new Promise((r) => setTimeout(r, 20));
    expect(data.session).toBeNull(); expect(error).toBeTruthy();
    expect(classifyVerifyFailure(error)).toBe("expired");
    expect(events).toEqual([]); expect(store.get("sb-test-auth-token")).toBeFalsy();
  });
  it("a verify rate limit → 'rate'; the network down → 'network'", async () => {
    const r = client(() => Response.json({ code: 429, error_code: "over_request_rate_limit", msg: "Request rate limit reached" }, { status: 429 }));
    const { error } = await r.sb.auth.verifyOtp({ token_hash: "h".repeat(56), type: "recovery" });
    expect(classifyVerifyFailure(error)).toBe("rate");
    const n = client(() => { throw new TypeError("Failed to fetch"); });
    const { error: e2 } = await n.sb.auth.verifyOtp({ token_hash: "h".repeat(56), type: "recovery" });
    expect(classifyVerifyFailure(e2)).toBe("network");
  });
});
