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

const RAW_URL = ((import.meta.env && import.meta.env.VITE_SUPABASE_URL) || "").trim();
// Normalize to the bare origin so a pasted "/rest/v1" suffix or trailing slash
// (a common copy-the-wrong-field mistake) doesn't double up the path.
let SUPABASE_URL = RAW_URL.replace(/\/+$/, "");
try { if (RAW_URL) SUPABASE_URL = new URL(RAW_URL).origin; } catch (_) {}
const SUPABASE_ANON = ((import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || "").trim();

export const supabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON);

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
