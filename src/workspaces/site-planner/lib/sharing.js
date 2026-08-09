/* Project sharing (team feature) — share/unshare a whole PROJECT with a team, and lock an
 * individual plan to view-only.
 *
 * A "project" = a Site Planner site group (sites.group_id). Sharing stamps the `team_id` column on
 * that group's plans; RLS then makes them readable/editable by the team (or private again).
 *
 * ⛔ B326419 — SHARING NOW GOES THROUGH THE `set_project_team` RPC, NOT A DIRECT UPDATE.
 *    The database refuses any ordinary UPDATE that changes `sites.team_id` (db/team_share_default.sql):
 *    the RPC is the only thing that sets the transaction-local flag the trigger looks for. That is
 *    what makes "an existing project can never silently become shared" true of the DATA rather than
 *    true of this file — a bug here, a stale in-memory model or a replayed cache write is refused by
 *    Postgres instead of quietly exposing someone's plans.
 *
 *    The RPC also re-checks ownership and team membership server-side, so this module is a thin
 *    caller: it cannot grant access the database would not have granted anyway.
 *
 *    A pre-migration database (RPC absent) falls back to the old direct UPDATE, so shipping this
 *    client before the SQL is run degrades rather than breaks. Once the SQL is in, the fallback is
 *    unreachable — the trigger would refuse it.
 *
 * SITE PLANS ONLY (owner decision, 2026-08-09): this no longer touches `doc_reviews` / `file_facts`.
 * Michael was explicit that Notes, Library, Review and Schedule stay with their owner. Notes,
 * Schedule (planar_*), Library folders and pins have no team column at all, so they were never in
 * scope; Review and the file index did have one, and are now deliberately left alone.
 */
import { supabase } from "./supabase.js";
import { pullCloud } from "./storage.js";
import { currentIdentity } from "./teams.js";

// "That RPC isn't deployed in this database yet" — same detector shape as teams.js.
const isMissingFunction = (error) => {
  const msg = String((error && error.message) || "").toLowerCase();
  return (error && error.code === "PGRST202") || msg.includes("could not find the function") ||
    (msg.includes("function") && msg.includes("does not exist"));
};

async function setProjectTeam(groupId, teamId) {
  if (!supabase || !groupId) return { ok: false, error: "Cloud not configured." };
  const { uid } = await currentIdentity();
  if (!uid) return { ok: false, error: "Sign in first." };
  const val = teamId || null;

  const rpc = await supabase.rpc("set_project_team", { p_group_id: groupId, p_team_id: val });
  if (!rpc.error) {
    await pullCloud(uid).catch(() => {});
    return { ok: true, sites: typeof rpc.data === "number" ? rpc.data : 0 };
  }
  if (!isMissingFunction(rpc.error)) return { ok: false, error: rpc.error.message || "Couldn't change sharing." };

  // Pre-migration fallback (db/team_share_default.sql not run yet).
  const s = await supabase.from("sites").update({ team_id: val }).eq("group_id", groupId).select("id");
  if (s.error) {
    if (/team_id/i.test(s.error.message || "")) return { ok: false, error: "Run the team-sharing database migration first." };
    return { ok: false, error: s.error.message };
  }
  await pullCloud(uid).catch(() => {});
  return { ok: true, sites: (s.data || []).length, degraded: true };
}

// Share a project with a team (everyone on the team can see/edit it). Returns { ok, error, sites }.
export const shareProject = (groupId, teamId) => setProjectTeam(groupId, teamId);

// Pull a project back to private (only the owner sees it again). Returns { ok, error }.
export const makeProjectPrivate = (groupId) => setProjectTeam(groupId, null);

/**
 * Lock / unlock ONE plan (B326417). A locked plan stays fully readable to teammates but cannot be
 * written by them — not the header, not the drawing. The owner is never locked out of their own
 * plan, and only the owner can change the lock (enforced by RLS + the guard trigger, re-checked
 * inside the RPC; this call cannot grant what the database would refuse).
 *
 * LOUD-FAILURE: a refusal comes back as { ok:false, error } for the caller to show — never a
 * silent no-op that leaves the padlock looking as though it took.
 */
export async function setPlanLock(siteId, locked) {
  if (!supabase || !siteId) return { ok: false, error: "Cloud not configured." };
  const { uid } = await currentIdentity();
  if (!uid) return { ok: false, error: "Sign in first." };
  const rpc = await supabase.rpc("set_plan_lock", { p_site_id: siteId, p_locked: !!locked });
  if (rpc.error) {
    if (isMissingFunction(rpc.error)) return { ok: false, error: "Run the team-sharing database migration first." };
    return { ok: false, error: rpc.error.message || "Couldn't change the lock." };
  }
  await pullCloud(uid).catch(() => {});
  return { ok: true, locked: !!rpc.data };
}
