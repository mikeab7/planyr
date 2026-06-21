/* Verify a Supabase user access token server-side (B207 — files API auth).
 *
 * The /api/files endpoint writes to the company Drive, so it must confirm the caller is a
 * real signed-in Planyr user first. This calls the Supabase Auth API (/auth/v1/user) with
 * the caller's bearer token + the project's anon key: a 200 with a user id means the token
 * is valid and unexpired. No JWT secret needed (the anon key is publishable). Network is
 * injectable for tests; returns a result ({ ok, user } / { ok:false, error }), never throws.
 */
export async function verifySupabaseUser({ token, supabaseUrl, anonKey, fetchImpl = fetch } = {}) {
  if (!token) return { ok: false, error: "Missing bearer token." };
  if (!supabaseUrl || !anonKey) return { ok: false, error: "Auth is not configured on the server (SUPABASE_URL / SUPABASE_ANON_KEY)." };
  let res;
  try {
    res = await fetchImpl(`${String(supabaseUrl).replace(/\/+$/, "")}/auth/v1/user`, {
      headers: { authorization: `Bearer ${token}`, apikey: anonKey },
    });
  } catch (e) {
    return { ok: false, error: `Auth check failed: ${e && e.message ? e.message : e}` };
  }
  if (!res.ok) return { ok: false, error: `Invalid or expired session (${res.status}).` };
  let user = null;
  try { user = await res.json(); } catch (_) { /* fall through */ }
  if (!user || !user.id) return { ok: false, error: "Session did not resolve to a user." };
  return { ok: true, user: { id: user.id, email: user.email || null } };
}
