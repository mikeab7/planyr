/* Team workspaces I/O (team feature) — read/write teams, membership, and invites in
 * public.teams / public.team_members / public.team_invites (see db/teams.sql). Pure async
 * functions (no React); the Team panel calls these. Mirrors cloudSync.js / profile.js in shape:
 * reuses the app's existing anon Supabase client + auth session — no new client, no keys, no
 * service-role in the browser. RLS scopes everything (you only ever see teams you're in).
 *
 * Roles: 'admin' (manage members + invites) | 'member' (do project work, can't manage people).
 * Invites are keyed by email so you can invite someone who has no account yet — the invite waits
 * and activates when they sign up (signup trigger) or next sign in (claimInvites RPC).
 */
import { supabase } from "./supabase.js";

const lower = (s) => (s == null ? "" : String(s)).trim().toLowerCase();
const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lower(s));

// The signed-in user's id + verified email (for "an invite addressed to me" checks). Null when
// signed out. Best-effort — never throws.
export async function currentIdentity() {
  if (!supabase) return { uid: null, email: null };
  try {
    const { data } = await supabase.auth.getUser();
    const u = data && data.user;
    return { uid: u ? u.id : null, email: u ? lower(u.email) : null };
  } catch (_) { return { uid: null, email: null }; }
}

// Create a team and make the creator its first admin. Returns { ok, teamId, error }.
export async function createTeam(name) {
  if (!supabase) return { ok: false, error: "Cloud not configured." };
  const { uid } = await currentIdentity();
  if (!uid) return { ok: false, error: "Sign in to create a team." };
  const clean = (name == null ? "" : String(name)).trim();
  if (!clean) return { ok: false, error: "Give the team a name." };
  const { data, error } = await supabase.from("teams").insert({ name: clean, created_by: uid }).select("id").single();
  if (error || !data) return { ok: false, error: (error && error.message) || "Couldn't create the team." };
  const teamId = data.id;
  const { error: mErr } = await supabase.from("team_members").insert({ team_id: teamId, user_id: uid, role: "admin", added_by: uid });
  if (mErr) return { ok: false, error: mErr.message, teamId }; // team exists but membership failed — surface it
  return { ok: true, teamId };
}

// Teams the signed-in user belongs to, with their own role in each. Newest first.
// Returns [{ id, name, role, created_by }]. Throws on a real fetch error (caller distinguishes
// "no teams" from "offline"), matching cloudList.
export async function listMyTeams() {
  if (!supabase) return [];
  const { uid } = await currentIdentity();
  if (!uid) return [];
  // My membership rows (role) joined to the team (name). RLS returns only teams I'm in.
  const { data, error } = await supabase
    .from("team_members")
    .select("role, team:teams(id, name, created_by, created_at)")
    .eq("user_id", uid);
  if (error) throw new Error(error.message || "couldn't load teams");
  return (data || [])
    .filter((r) => r && r.team)
    .map((r) => ({ id: r.team.id, name: r.team.name, role: r.role, created_by: r.team.created_by, created_at: r.team.created_at }))
    .sort((a, b) => (new Date(b.created_at || 0)) - (new Date(a.created_at || 0)));
}

// Roster of a team (name + email + role), via the SECURITY DEFINER RPC so we don't open
// profiles to teammates. Returns [{ userId, role, firstName, lastName, email, displayName }].
export async function listMembers(teamId) {
  if (!supabase || !teamId) return [];
  const { data, error } = await supabase.rpc("list_team_members", { p_team: teamId });
  if (error) return [];
  return (data || []).map((r) => {
    const name = [r.first_name, r.last_name].filter(Boolean).join(" ").trim();
    return { userId: r.user_id, role: r.role, firstName: r.first_name || null, lastName: r.last_name || null,
      email: r.email || null, displayName: name || r.email || "Teammate" };
  });
}

// Pending (unclaimed) invites for a team — admins only (RLS). Returns [{ id, email, role, createdAt }].
export async function listInvites(teamId) {
  if (!supabase || !teamId) return [];
  const { data, error } = await supabase
    .from("team_invites")
    .select("id, email, role, created_at, claimed_at")
    .eq("team_id", teamId)
    .is("claimed_at", null)
    .order("created_at", { ascending: false });
  if (error) return [];
  return (data || []).map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at }));
}

// Invite a person by email (admin action). The email is lower-cased; one open invite per
// team+email (unique constraint). If they already have an account they'll join on next sign-in;
// if not, the signup trigger adds them when they register. Returns { ok, error }.
export async function inviteByEmail(teamId, email, role = "member") {
  if (!supabase || !teamId) return { ok: false, error: "Cloud not configured." };
  const e = lower(email);
  if (!isEmail(e)) return { ok: false, error: "Enter a valid email address." };
  const r = role === "admin" ? "admin" : "member";
  const { error } = await supabase.from("team_invites").upsert(
    { team_id: teamId, email: e, role: r }, { onConflict: "team_id,email" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

// Activate any invites waiting on the signed-in user's email (existing account invited later).
// Call on every sign-in. Returns the number of new memberships (0 if none / signed out).
export async function claimInvites() {
  if (!supabase) return 0;
  const { uid } = await currentIdentity();
  if (!uid) return 0;
  const { data, error } = await supabase.rpc("claim_team_invites");
  if (error) return 0;
  return typeof data === "number" ? data : 0;
}

// Change a member's role (admin action). Returns { ok, error }.
export async function setRole(teamId, userId, role) {
  if (!supabase || !teamId || !userId) return { ok: false, error: "missing args" };
  const r = role === "admin" ? "admin" : "member";
  const { error } = await supabase.from("team_members").update({ role: r }).eq("team_id", teamId).eq("user_id", userId);
  return { ok: !error, error: error ? error.message : null };
}

// Remove a member (admin action). Returns { ok, error }.
export async function removeMember(teamId, userId) {
  if (!supabase || !teamId || !userId) return { ok: false, error: "missing args" };
  const { error } = await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", userId);
  return { ok: !error, error: error ? error.message : null };
}

// Cancel a pending invite (admin action). Returns { ok, error }.
export async function cancelInvite(inviteId) {
  if (!supabase || !inviteId) return { ok: false, error: "missing args" };
  const { error } = await supabase.from("team_invites").delete().eq("id", inviteId);
  return { ok: !error, error: error ? error.message : null };
}

// Leave a team (self). Returns { ok, error }.
export async function leaveTeam(teamId) {
  if (!supabase || !teamId) return { ok: false, error: "missing args" };
  const { uid } = await currentIdentity();
  if (!uid) return { ok: false, error: "Not signed in." };
  const { error } = await supabase.from("team_members").delete().eq("team_id", teamId).eq("user_id", uid);
  return { ok: !error, error: error ? error.message : null };
}
