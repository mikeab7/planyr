/* User profile I/O (B297 / NEW-1) — read/write the signed-in user's row in
 * public.profiles, RLS-scoped so a request can only ever touch the caller's own
 * row. The names normally land via the signup trigger (handle_new_user, see
 * db/profiles.sql); this module reads them for display and lets the account panel
 * edit them. Pure async functions (no React) — the useProfile hook wraps these.
 *
 * Reuses the app's existing anon Supabase client + auth session; no new client,
 * no service-role key in the browser. Mirrors cloudSync.js in shape.
 */
import { supabase } from "./supabase.js";

// Load the signed-in user's profile row, or null (no row yet / not signed in).
// THROWS on a real fetch error so a caller can tell "no row" apart from "offline".
export async function loadProfile(uid) {
  if (!supabase || !uid) return null;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", uid).maybeSingle();
  if (error) throw new Error(error.message || "profile load failed");
  return data || null;
}

// Upsert the profile (first/last/org). The row normally already exists (the signup
// trigger created it), but upsert also covers a pre-trigger user or a backfill miss.
// RLS scopes the write to the caller; we also pin id = uid as defense-in-depth.
export async function saveProfile(uid, fields = {}) {
  if (!supabase || !uid) return { ok: false, error: "not signed in" };
  const clean = (v) => {
    const s = (v == null ? "" : String(v)).trim();
    return s ? s : null;
  };
  const row = {
    id: uid,
    first_name: clean(fields.firstName),
    last_name: clean(fields.lastName),
    org: clean(fields.org),
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from("profiles").upsert(row, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };
  // Keep the auth record's user_metadata in sync with the table so the two name
  // stores never disagree (and the offline display fallback stays fresh). The table
  // is the source of truth — a metadata hiccup is best-effort, it doesn't fail the save.
  try {
    await supabase.auth.updateUser({ data: { first_name: row.first_name, last_name: row.last_name, org: row.org } });
  } catch (_) {}
  return { ok: true, error: null };
}
