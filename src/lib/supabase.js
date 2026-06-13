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

const SUPABASE_URL = (((import.meta.env && import.meta.env.VITE_SUPABASE_URL) || "").trim()).replace(/\/+$/, "");
const SUPABASE_ANON = ((import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || "").trim();

export const supabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON);

// Only build a client when configured, so an un-configured app still runs fine.
export const supabase = supabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

/* Phase-1 connection test: confirms the app can REACH Supabase with a valid anon
 * key, without touching any table or site data. Step 1 hits the auth health
 * endpoint (no key, CORS-open) to validate the URL; step 2 hits the PostgREST root
 * with the key to validate the key (200 ok / 401 bad key). */
export async function testConnection() {
  if (!supabaseConfigured())
    return { ok: false, state: "not-configured", message: "Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build." };
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(SUPABASE_URL))
    return { ok: false, state: "error", message: `URL looks off: "${SUPABASE_URL}". Expected https://<ref>.supabase.co (no path/slash/spaces).` };
  // 1) reachability — validates the Project URL
  try {
    const h = await fetch(`${SUPABASE_URL}/auth/v1/health`);
    if (!h.ok) return { ok: false, state: "error", message: `Reached host but health = HTTP ${h.status}; check VITE_SUPABASE_URL.` };
  } catch (e) {
    return { ok: false, state: "error", message: `Can't reach ${SUPABASE_URL} — check VITE_SUPABASE_URL (${(e && e.message) || "network error"}).` };
  }
  // 2) key validity — REST root with the anon key
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` } });
    if (r.ok) return { ok: true, state: "connected", message: `Reached Supabase (HTTP ${r.status}).` };
    if (r.status === 401) return { ok: false, state: "bad-key", message: "Reached Supabase but the anon key was rejected (401) — check VITE_SUPABASE_ANON_KEY." };
    return { ok: false, state: "error", message: `Supabase REST responded HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, state: "error", message: `Reached host but the REST check failed: ${(e && e.message) || "network error"}.` };
  }
}
