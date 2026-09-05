/* cloudRole.js — the site-ROLE-flip CLOUD write, LOADED ON DEMAND (B843792, NEW-1).
 *
 * Mirrors cloudRename.js exactly — same reasoning, same shape, same reason it's a dynamic import
 * (a role flip is rare and user-initiated; its code has no business riding the boot chunk).
 *
 * ⛔ Nothing on the boot path may static-import this module. It is reached ONLY by the dynamic
 * `import()` in `storage.setSiteGroupRole`.
 */
import { supabase } from "./supabase.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { ROLES } from "./siteStatus.js";
import { _siteVersions as siteVersions, _lastHeaderSig as lastHeaderSig } from "./cloudSync.js";

/* NEW-1 — FLIP A SITE'S ROLE AT THE SOURCE OF TRUTH, IN ONE WRITE.
 *
 * "A site can be flipped from tracked to pursuit later without re-entering anything" is a
 * required NEW-1 outcome, not a nice-to-have — this is the write path that makes it real:
 *   • PRIMARY — the `set_site_group_role` RPC (db/set_site_group_role.sql): ONE `update … where
 *     coalesce(data->>'groupId', id) = $group` statement, atomic by construction, reaching every
 *     plan in the group including ones this browser has never loaded.
 *   • FALLBACK — on a DB where the migration hasn't run, fetch the group's rows and write each one.
 *
 * LOUD-FAILURE: returns { ok, rows, atomic, error }.
 */
export async function cloudSetSiteRole(uid, groupId, role) {
  if (!supabase || !uid || !groupId || !ROLES.includes(role)) {
    return { ok: false, rows: 0, atomic: false, error: "not ready" };
  }
  const { data, error } = await supabase.rpc("set_site_group_role", { p_group_id: groupId, p_role: role });
  if (!error) {
    const rows = Array.isArray(data) ? data : [];
    for (const r of rows) if (r && r.id != null && r.version != null) {
      siteVersions[r.id] = r.version;
      delete lastHeaderSig[r.id]; // the stored header changed server-side → force the next push to compare fresh
    }
    if (!rows.length) {
      reportClientEvent("role-flip-zero-rows", "site role flip matched no cloud rows", { groupId, role });
      return { ok: false, rows: 0, atomic: true, error: "That didn't match any project in your account." };
    }
    return { ok: true, rows: rows.length, atomic: true };
  }
  if (isMissingFunction(error)) return cloudSetSiteRoleFallback(uid, groupId, role);
  reportClientEvent("cloud-write-failed", "site role flip failed (set_site_group_role)", { groupId, role, error: error.message || "" });
  return { ok: false, rows: 0, atomic: true, error: error.message || "role flip failed" };
}

// PostgREST reports an unknown RPC as PGRST202 ("Could not find the function … in the schema cache").
const isMissingFunction = (e) =>
  !!e && (e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message || ""));

/* Degrade path for a DB without db/set_site_group_role.sql. Reads the group's rows FROM THE
 * SERVER (never from local storage) and rewrites each one's role. */
async function cloudSetSiteRoleFallback(uid, groupId, role) {
  const sel = await supabase.from("sites").select("id, data");
  if (sel.error) {
    reportClientEvent("cloud-read-failed", "role flip fallback couldn't read the group", { groupId, error: sel.error.message || "" });
    return { ok: false, rows: 0, atomic: false, error: sel.error.message || "couldn't read the project" };
  }
  const rows = (sel.data || []).filter((r) => r && r.data && ((r.data.groupId || r.data.id) === groupId));
  if (!rows.length) return { ok: false, rows: 0, atomic: false, error: "That didn't match any project in your account." };
  let failed = 0;
  for (const r of rows) {
    const { error } = await supabase.from("sites")
      .update({ data: { ...r.data, role } }).eq("id", r.id);
    if (error) failed += 1;
    else { delete lastHeaderSig[r.id]; delete siteVersions[r.id]; }
  }
  if (failed) {
    reportClientEvent("cloud-write-failed", "role flip fallback partly failed", { groupId, failed, total: rows.length });
    return { ok: false, rows: rows.length - failed, atomic: false, error: "Part of the project couldn't be updated in the cloud." };
  }
  return { ok: true, rows: rows.length, atomic: false };
}
