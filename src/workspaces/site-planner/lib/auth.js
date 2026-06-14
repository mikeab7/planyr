/* Supabase Auth — PHASE 2: login only (email + password).
 *
 * Thin wrappers around Supabase's BUILT-IN auth — we do NOT implement password
 * hashing, sessions, or any security-critical logic ourselves; Supabase handles
 * all of it. Login is ADDITIVE this phase: it does NOT change how sites are saved
 * or loaded (still 100% localStorage), gate any feature, or attach data to the
 * user. RLS is Phase 3; wiring save/load + migrating sites is Phase 4.
 */
import { supabase } from "./supabase.js";

// Where Supabase sends the user back after email confirmation / password reset.
// Must be allow-listed in Supabase → Auth → URL Configuration → Redirect URLs.
const redirectTo = (() => {
  try { return window.location.origin + window.location.pathname; } catch (_) { return undefined; }
})();

const errMsg = (e) => (e && e.message) || null;

export async function signUp(email, password, profile = {}) {
  if (!supabase) return { error: "Cloud not configured." };
  // First/last/org are stored in Supabase user_metadata (options.data).
  const meta = {};
  if (profile.firstName) meta.first_name = profile.firstName;
  if (profile.lastName) meta.last_name = profile.lastName;
  if (profile.org) meta.org = profile.org;
  const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo, data: meta } });
  // When email confirmation is on, signUp returns a user but no session yet.
  return { error: errMsg(error), needsConfirm: !!(data && data.user && !data.session) };
}

export async function signIn(email, password) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return { error: errMsg(error) };
}

export async function signOut() {
  if (!supabase) return;
  try { await supabase.auth.signOut(); } catch (_) {}
}

export async function resetPassword(email) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  return { error: errMsg(error) };
}

export async function updatePassword(password) {
  if (!supabase) return { error: "Cloud not configured." };
  const { error } = await supabase.auth.updateUser({ password });
  return { error: errMsg(error) };
}

// Current signed-in user (from the locally-stored session), or null.
export async function getUser() {
  if (!supabase) return null;
  try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.user) || null; }
  catch (_) { return null; }
}

// Subscribe to auth changes. Fires (event, user) on sign-in/out, token refresh,
// and PASSWORD_RECOVERY (when the user opens a reset link). Returns unsubscribe.
export function onAuthChange(cb) {
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((event, session) => cb(event, (session && session.user) || null));
  return () => { try { data.subscription.unsubscribe(); } catch (_) {} };
}
