/* Supabase backend — PHASE 1: connection only.
 *
 * This file ONLY establishes (and lets us test) a connection to Supabase. It does
 * NOT read or write any site data — the app's persistence is still 100%
 * localStorage (see storage.js / siteModel.js). Login (Phase 2), row-level
 * security (Phase 3), and wiring save/load + migrating existing sites (Phase 4)
 * come later. See CLAUDE.md "## Backend (Supabase)".
 *
 * Config comes from build-time env (never committed) per the repo secrets rule:
 *   VITE_SUPABASE_URL        e.g. https://abcd1234.supabase.co
 *   VITE_SUPABASE_ANON_KEY   the anon/public key
 * The anon key is SAFE to expose in a frontend bundle — it's public by design and
 * only grants what Row-Level Security permits (RLS is a later phase).
 */
import { createClient } from "@supabase/supabase-js";

/* B1843888 — vitest must NEVER build a client that can reach a real project, regardless of
 * what VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY are set to in the process. CI's required
 * `build` check runs every gate — including `npm test` — inside ONE step that carries the
 * real production secrets as env (needed by the later `vite build`/bundle-budget gates in the
 * same step; see .github/ci-gates.yml), so the vitest suite was inheriting them too and
 * writing live telemetry + one destructive `project_folders` DELETE to production on every CI
 * run (measured: 44 `project-folder-purge-failed` events on 2026-09-19 alone, all carrying
 * build:"dev", the test suite's signature). Vitest itself sets import.meta.env.VITEST, which a
 * test can't spoof away by re-stubbing the Supabase URL, so this refuses to read the real env
 * at all rather than trusting the two var values. */
const UNDER_VITEST = !!(import.meta.env && import.meta.env.VITEST);

const RAW_URL = UNDER_VITEST ? "" : ((import.meta.env && import.meta.env.VITE_SUPABASE_URL) || "").trim();
// Normalize to the bare origin so a pasted "/rest/v1" suffix or trailing slash
// (a common copy-the-wrong-field mistake) doesn't double up the path.
let SUPABASE_URL = RAW_URL.replace(/\/+$/, "");
try { if (RAW_URL) SUPABASE_URL = new URL(RAW_URL).origin; } catch (_) {}
const SUPABASE_ANON = UNDER_VITEST ? "" : ((import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || "").trim();

export const supabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON);

// The bare origin + anon key, for the rare path that must talk to PostgREST directly
// instead of via the JS client — currently the keepalive cloud push on a forced reload
// (B452), which needs a fetch({keepalive:true}) the supabase-js client doesn't expose.
export const supabaseRest = () => ({ url: SUPABASE_URL, anon: SUPABASE_ANON });

// Read the signed-in user's access token SYNCHRONOUSLY from supabase-js's persisted
// session (localStorage key `sb-<ref>-auth-token`). The async supabase.auth.getSession()
// can't finish during a page-unload flush, so the keepalive push (B452) reads the token
// directly. Returns null when signed out / unconfigured / token absent. Never throws.
export function currentAccessToken() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !/^sb-.*-auth-token$/.test(k)) continue;
      // B539: parse PER ENTRY — a single corrupt/truncated auth-token blob must not abort the whole
      // scan (the old loop-wide try/catch returned null on the first bad key, missing a later valid
      // session → a signed-in user looked signed-out to the keepalive push). Skip the bad one, keep going.
      try {
        const v = JSON.parse(localStorage.getItem(k) || "null");
        const tok = v && (v.access_token || (v.currentSession && v.currentSession.access_token));
        if (tok) return tok;
      } catch (_) { /* corrupt entry — skip and keep scanning */ }
    }
  } catch (_) { /* storage blocked — treat as no token */ }
  return null;
}

// Diagnostic snapshot of what the build actually baked in (no full key dump).
export const connectionInfo = () => ({
  configured: supabaseConfigured(),
  url: SUPABASE_URL || "(unset)",
  rawUrl: RAW_URL || "(unset)",
  keyLen: SUPABASE_ANON.length,
  keyPrefix: SUPABASE_ANON ? SUPABASE_ANON.slice(0, 8) + "…" : "(unset)",
});

// Only build a client when configured, so an un-configured app still runs fine.
export const supabase = supabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

// Diagnostic handle for the Phase-3 RLS two-account isolation test (run from the
// live console). Uses the public anon key + the signed-in user's JWT, so it
// exercises Row-Level Security exactly as a real client would. No effect on the
// app's localStorage save/load.
try { if (typeof window !== "undefined") window.pfSupabase = supabase; } catch (_) {}

/* Phase-1 connection test: confirms the app can REACH Supabase AND that the anon/
 * publishable key is accepted — without touching any table or site data. Uses the
 * auth health endpoint WITH the apikey header (200 = reachable + key accepted).
 * Note: we deliberately do NOT probe the PostgREST root `/rest/v1/` — under
 * Supabase's new API-key model that endpoint is secret-key-only and (correctly)
 * 401s a publishable/anon key, which is the only key that belongs in a browser. */
export async function testConnection() {
  if (!supabaseConfigured())
    return { ok: false, state: "not-configured", message: "Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build." };
  // Accept any https origin (custom Supabase domains are valid), only flagging a
  // clearly-wrong value — a path, space, or non-https (B37d). The URL was already
  // normalized to its origin above.
  if (!/^https:\/\/[^/\s]+$/i.test(SUPABASE_URL))
    return { ok: false, state: "error", message: `URL looks off: "${SUPABASE_URL}". Expected an https origin like https://<ref>.supabase.co (no path/slash/spaces).` };
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: { apikey: SUPABASE_ANON } });
    if (r.ok) return { ok: true, state: "connected", message: `Reached Supabase, key accepted (HTTP ${r.status}).` };
    if (r.status === 401) return { ok: false, state: "bad-key", message: "Supabase rejected the key (401) — check VITE_SUPABASE_ANON_KEY (use the anon/publishable key)." };
    return { ok: false, state: "error", message: `Supabase health responded HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, state: "error", message: `Can't reach ${SUPABASE_URL} — check VITE_SUPABASE_URL (${(e && e.message) || "network error"}).` };
  }
}
