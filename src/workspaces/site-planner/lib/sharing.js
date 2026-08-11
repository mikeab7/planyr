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

/* ⛔ NEW-1 — "0 ROWS CHANGED" IS NOT "0 ROWS EXIST", AND THE CALLER MUST NEVER HAVE TO GUESS.
 *
 * `set_project_team` returns the row count of an UPDATE carrying `team_id is distinct from
 * p_team_id`, so re-sharing a project to the team it is ALREADY shared with legitimately writes
 * nothing and answers 0. The caller read that 0 as "this project isn't in the cloud yet" — on
 * "8 South", version 587, shared for weeks. The message was most wrong in exactly the case it fired.
 *
 * The codebase already knew this idiom bites: storage.js documents that cloudDelete's removed:0
 * means RLS REFUSED rather than "nothing was there". The share path just never got the same care.
 *
 * So this returns a NAMED outcome and no bare count for the caller to interpret:
 *   "not-found" — no live plan of yours in that group. The ONLY state in which "not in the cloud
 *                 yet" is a true thing to say, so it is the only one that may say it.
 *   "changed"   — rows were written. A share (or unshare) just happened.
 *   "already"   — rows exist and were ALREADY in that state. A SUCCESS, and it must read as one.
 * plus `mismatched` — NEW-3's completeness self-check, non-zero only if the write half-landed.
 *
 * Note the three tiers below answer this differently and that is the whole point of normalising
 * here rather than at the UI: the state RPC says outright; the older integer RPC RAISES for
 * not-found (so a 0 from it can only mean "already"); and the pre-migration direct UPDATE returns
 * every matched row, so 0 there really does mean none exist.
 */
const shareOutcome = (o) => ({ ok: true, ...o, shared: !!o.teamId, sites: o.changed || 0 });

async function setProjectTeam(groupId, teamId) {
  if (!supabase || !groupId) return { ok: false, error: "Cloud not configured." };
  const { uid } = await currentIdentity();
  if (!uid) return { ok: false, error: "Sign in first." };
  const val = teamId || null;

  // Preferred: the RPC that names its own outcome (db/team_share_state.sql).
  const st = await supabase.rpc("set_project_team_state", { p_group_id: groupId, p_team_id: val });
  if (!st.error) {
    const d = (st.data && typeof st.data === "object") ? st.data : {};
    await pullCloud(uid).catch(() => {});
    return shareOutcome({
      outcome: d.outcome || "changed", teamId: val,
      matched: Number(d.matched) || 0, changed: Number(d.changed) || 0, already: Number(d.already) || 0,
      plans: Number(d.plans) || 0, foreign: Number(d.foreign) || 0, mismatched: Number(d.mismatched) || 0,
    });
  }
  if (!isMissingFunction(st.error)) return { ok: false, error: st.error.message || "Couldn't change sharing." };

  // Fallback: the older integer RPC. It RAISES 'No project of yours with that id.' for the absent
  // case, so a numeric answer here can only be "changed" (>0) or "already" (0) — never not-found.
  const rpc = await supabase.rpc("set_project_team", { p_group_id: groupId, p_team_id: val });
  if (!rpc.error) {
    const n = typeof rpc.data === "number" ? rpc.data : 0;
    await pullCloud(uid).catch(() => {});
    return shareOutcome({ outcome: n > 0 ? "changed" : "already", teamId: val, matched: n, changed: n, already: 0, plans: n, foreign: 0, mismatched: 0 });
  }
  if (!isMissingFunction(rpc.error)) return { ok: false, error: rpc.error.message || "Couldn't change sharing." };

  // Pre-migration fallback (db/team_share_default.sql not run yet). This UPDATE has no
  // "is distinct from" clause, so its row count IS the number of matching rows — the one tier where
  // 0 genuinely means "no such rows".
  const s = await supabase.from("sites").update({ team_id: val }).eq("group_id", groupId).select("id");
  if (s.error) {
    if (/team_id/i.test(s.error.message || "")) return { ok: false, error: "Run the team-sharing database migration first." };
    return { ok: false, error: s.error.message };
  }
  const n = (s.data || []).length;
  await pullCloud(uid).catch(() => {});
  return shareOutcome({ outcome: n > 0 ? "changed" : "not-found", teamId: val, matched: n, changed: n, already: 0, plans: n, foreign: 0, mismatched: 0, degraded: true });
}

/* Share a project with a team (everyone on the team can see/edit it).
 * Returns { ok, error } or { ok:true, outcome:"not-found"|"changed"|"already", shared, matched,
 * changed, already, plans, foreign, mismatched }. ⛔ Branch on `outcome`, never on a count:
 * `changed:0` means "already shared", which is a SUCCESS (see setProjectTeam's header). */
export const shareProject = (groupId, teamId) => setProjectTeam(groupId, teamId);

// Pull a project back to private (only the owner sees it again). Same answer shape as shareProject
// — including `mismatched`, because a HALF-unshare leaves a collaborator with access the owner
// believes he revoked, which is worse than a half-share.
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
