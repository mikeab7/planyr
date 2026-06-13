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

const SUPABASE_URL = (import.meta.env && import.meta.env.VITE_SUPABASE_URL) || "";
const SUPABASE_ANON = (import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || "";

export const supabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON);

// Only build a client when configured, so an un-configured app still runs fine.
export const supabase = supabaseConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON)
  : null;

/* Phase-1 connection test: confirms the app can REACH Supabase with a valid anon
 * key, without touching any table or site data. Hits the PostgREST root, which
 * returns 200 for a valid key and 401 for a bad one. */
export async function testConnection() {
  if (!supabaseConfigured())
    return { ok: false, state: "not-configured", message: "Supabase not configured — set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build." };
  try {
    const r = await fetch(`${SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/`, {
      headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${SUPABASE_ANON}` },
    });
    if (r.ok) return { ok: true, state: "connected", message: `Reached Supabase (HTTP ${r.status}).` };
    if (r.status === 401) return { ok: false, state: "bad-key", message: "Reached Supabase but the anon key was rejected (401)." };
    return { ok: false, state: "error", message: `Supabase responded HTTP ${r.status}.` };
  } catch (e) {
    return { ok: false, state: "error", message: `Couldn't reach Supabase: ${(e && e.message) || "network error"}.` };
  }
}
