/* Project sharing (team feature) — share/unshare a whole PROJECT with a team.
 *
 * A "project" = a Site Planner site group (sites.group_id), together with the Document Review
 * reviews and file-facts filed under it (project_id = group_id). Sharing stamps the team_id
 * column on every one of those rows; unsharing clears it back to NULL (private). RLS then makes
 * the rows readable/editable by the team (or private again). Only the project OWNER can do this:
 * the DB UPDATE policy's WITH CHECK requires you to be the owner setting a team you belong to
 * (members can edit shared content but can't re-home or unshare someone else's project).
 *
 * We update the team_id COLUMN directly (one statement per table) rather than rewriting each
 * row's jsonb: cloudList / loadReview overlay the authoritative column back onto the in-app model
 * on the next read, so a re-pull is all that's needed to reflect the change locally.
 */
import { supabase } from "./supabase.js";
import { pullCloud } from "./storage.js";
import { currentIdentity } from "./teams.js";

async function setProjectTeam(groupId, teamId) {
  if (!supabase || !groupId) return { ok: false, error: "Cloud not configured." };
  const { uid } = await currentIdentity();
  if (!uid) return { ok: false, error: "Sign in first." };
  const val = teamId || null;

  // The plans (sites) of the group — the part that must succeed.
  const s = await supabase.from("sites").update({ team_id: val }).eq("group_id", groupId).select("id");
  if (s.error) {
    if (/team_id/i.test(s.error.message || "")) return { ok: false, error: "Run the team-sharing database migration first." };
    return { ok: false, error: s.error.message };
  }
  // Reviews + file-facts filed under the project — best-effort (tables may have none, or the
  // doc-review migrations may not be in). Never fail the whole share over these.
  const r = await supabase.from("doc_reviews").update({ team_id: val }).eq("project_id", groupId).select("id");
  const f = await supabase.from("file_facts").update({ team_id: val }).eq("project_id", groupId).select("id");

  // Refresh the local sites cache so the share badge + access reflect immediately.
  await pullCloud(uid).catch(() => {});
  return {
    ok: true,
    sites: (s.data || []).length,
    reviews: r.error ? 0 : (r.data || []).length,
    files: f.error ? 0 : (f.data || []).length,
  };
}

// Share a project with a team (everyone on the team can see/edit it). Returns { ok, error, counts }.
export const shareProject = (groupId, teamId) => setProjectTeam(groupId, teamId);

// Pull a project back to private (only the owner sees it again). Returns { ok, error }.
export const makeProjectPrivate = (groupId) => setProjectTeam(groupId, null);
