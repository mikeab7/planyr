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
import { isMissingVersionColumn } from "../../../shared/cloud/optimisticUpsert.js";

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
 * SERVER (never from local storage) and rewrites each one's role.
 *
 * NEW-1 (2026-09-16) — this used to write `{ data: {...} }` with no `version` in the payload at
 * all and no `.select()` on the update, so it never asked whether the write actually landed. Once
 * `sites_enforce_version_monotonic` (db/sites_version_monotonic_guard.sql) went live, THAT write
 * is refused outright every time: the trigger only lets a content-changing UPDATE through when its
 * incoming `version` is strictly greater than the row's stored one, and an update that never sets
 * `version` leaves it unchanged, so `new.version > old.version` is always false. PostgREST reports
 * that refusal as an ordinary 200 with zero rows — indistinguishable from success to code that
 * never asked for the row back, which is exactly what `if (error) failed += 1; else {...}` did.
 * Now every write both (a) advances `version` past what was just read, so the trigger has a real
 * claim of freshness to accept, and (b) asks for the row back via `.select("id")` and counts an
 * empty return as a failure exactly like an `error` — a write the database refused is reported as
 * refused, never as done. */
async function cloudSetSiteRoleFallback(uid, groupId, role) {
  let sel = await supabase.from("sites").select("id, data, version");
  if (sel.error && isMissingVersionColumn(sel.error)) sel = await supabase.from("sites").select("id, data"); // truly pre-B314 schema
  if (sel.error) {
    reportClientEvent("cloud-read-failed", "role flip fallback couldn't read the group", { groupId, error: sel.error.message || "" });
    return { ok: false, rows: 0, atomic: false, error: sel.error.message || "couldn't read the project" };
  }
  const rows = (sel.data || []).filter((r) => r && r.data && ((r.data.groupId || r.data.id) === groupId));
  if (!rows.length) return { ok: false, rows: 0, atomic: false, error: "That didn't match any project in your account." };
  let failed = 0;
  for (const r of rows) {
    // B1181104 — stamp the jsonb's OWN `updatedAt` too, same as the primary RPC now does: without
    // it a role flip here is invisible to `mergeSiteContent`'s newer-wins tie-break, and a client
    // holding a stale locally-cached copy of this row can never self-heal on a later pull.
    const payload = { data: { ...r.data, role, updatedAt: Date.now() } };
    if (r.version != null) payload.version = r.version + 1; // absent only on the version-less-schema fallback above
    const { data, error } = await supabase.from("sites").update(payload).eq("id", r.id).select("id");
    if (error) failed += 1;
    else if (r.version != null && (!Array.isArray(data) || data.length === 0)) {
      // The row was read but the write matched/advanced nothing — another writer moved it (or, on
      // a DB carrying the version guard, this row's version claim was stale by the time we wrote).
      failed += 1;
      reportClientEvent("role-flip-row-refused", "site role flip write affected no rows", { id: r.id, groupId });
    } else { delete lastHeaderSig[r.id]; delete siteVersions[r.id]; }
  }
  if (failed) {
    reportClientEvent("cloud-write-failed", "role flip fallback partly failed", { groupId, failed, total: rows.length });
    return { ok: false, rows: rows.length - failed, atomic: false, error: "Part of the project couldn't be updated in the cloud." };
  }
  return { ok: true, rows: rows.length, atomic: false };
}
