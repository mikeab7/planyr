/* cloudRename.js — the project-rename CLOUD write, LOADED ON DEMAND.
 *
 * ⛔ Nothing on the boot path may static-import this module. It is reached ONLY by the dynamic
 * `import()` in `storage.renameSiteGroup`, for the same reason `exportSheet.js` and
 * `rasterIdentifyLazy.js` are split out: a rename is a rare, deliberate, user-initiated action, so
 * its code (an RPC call plus a whole degrade path for an un-migrated DB) has no business riding the
 * chunk every page load pays for. Splitting it is also what paid this feature's bundle budget back.
 *
 * It reaches into `cloudSync`'s per-tab CAS bookkeeping through the `_siteVersions` / `_lastHeaderSig`
 * seams rather than duplicating them — after a group-wide rename the server has bumped `version` on
 * every row it touched, so a tab still holding the pre-rename token would take a needless conflict on
 * its next ordinary content push.
 */
import { supabase } from "./supabase.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { _siteVersions as siteVersions, _lastHeaderSig as lastHeaderSig } from "./cloudSync.js";

/* NEW-1/NEW-2 — RENAME A PROJECT AT THE SOURCE OF TRUTH, IN ONE WRITE.
 *
 * The bug this replaces: the rename iterated `loadPlansOfGroup()` — the LOCAL store — and pushed
 * each hydrated plan individually. A plan not in this browser's localStorage at rename time was
 * never written and never pushed; it kept the old name in the cloud and RE-PUBLISHED it the next
 * time it saved for any reason. Proven in production on group smrp1wrgg6u5 (Silvestri/Sylvestri),
 * where the straggler was saved seventeen minutes after the rename and still carried the old name.
 *
 * So the rename never enumerates plans on the client at all. It names the GROUP and lets the
 * server touch every row in it:
 *   • PRIMARY — the `rename_site_group` RPC (db/rename_site_group.sql): ONE `update … where
 *     coalesce(data->>'groupId', id) = $group` statement, which Postgres applies atomically, so it
 *     cannot half-land. Returns each affected row's fresh `version` so this tab's CAS tokens stay
 *     valid and the next ordinary content push isn't a false stale-version conflict.
 *   • FALLBACK — on a DB where the migration hasn't run (PostgREST answers an unknown function
 *     with PGRST202), fetch the group's rows and write each one. Not atomic, but it still reaches
 *     every plan in the group including ones this browser has never loaded, so renaming is never
 *     blocked on the migration and the split-name bug is fixed either way.
 *
 * LOUD-FAILURE: returns { ok, rows, atomic, error } — a partial or failed rename is reported to the
 * caller, which surfaces it. The old path failed SILENTLY, which is why the owner only found out by
 * noticing the name had reverted. */
export async function cloudRenameGroup(uid, groupId, site, renamedAt) {
  if (!supabase || !uid || !groupId || typeof site !== "string" || !site.trim()) {
    return { ok: false, rows: 0, atomic: false, error: "not ready" };
  }
  const at = Number(renamedAt) || Date.now();
  const { data, error } = await supabase.rpc("rename_site_group", {
    p_group_id: groupId, p_site: site, p_renamed_at: at,
  });
  if (!error) {
    const rows = Array.isArray(data) ? data : [];
    // Adopt the fresh versions: the RPC bumped `version` on every row it touched, so a tab holding
    // the pre-rename token would otherwise take a needless CAS conflict on its next content push.
    for (const r of rows) if (r && r.id != null && r.version != null) {
      siteVersions[r.id] = r.version;
      delete lastHeaderSig[r.id]; // the stored header changed server-side → force the next push to compare fresh
    }
    if (!rows.length) {
      // Nothing matched: the group is not ours / not visible under RLS, or has no live rows.
      reportClientEvent("rename-zero-rows", "project rename matched no cloud rows", { groupId });
      return { ok: false, rows: 0, atomic: true, error: "The rename didn't match any project in your account." };
    }
    return { ok: true, rows: rows.length, atomic: true };
  }
  if (isMissingFunction(error)) return cloudRenameGroupFallback(uid, groupId, site, at);
  reportClientEvent("cloud-write-failed", "project rename failed (rename_site_group)", { groupId, error: error.message || "" });
  return { ok: false, rows: 0, atomic: true, error: error.message || "rename failed" };
}

// PostgREST reports an unknown RPC as PGRST202 ("Could not find the function … in the schema cache").
// Mirrors elementApi's fallback latch: an un-migrated DB must degrade, never surface as a write error.
const isMissingFunction = (e) =>
  !!e && (e.code === "PGRST202" || /could not find the function|does not exist/i.test(e.message || ""));

/* Degrade path for a DB without db/rename_site_group.sql. Reads the group's rows FROM THE SERVER
 * (never from local storage — that is the whole defect) and rewrites each one's name. */
async function cloudRenameGroupFallback(uid, groupId, site, at) {
  // ONE select, deliberately: `id, data` are the only columns every version of this schema has, so
  // this needs no column-missing degrade ladder of its own — and `data` is the authoritative group
  // key anyway. Soft-deleted rows are not filtered out (the `deleted_at` column may not exist on a
  // DB this old); renaming a binned project's rows is harmless and correct — if it is ever restored
  // it comes back under the project's current name rather than a stale one.
  const sel = await supabase.from("sites").select("id, data");
  if (sel.error) {
    reportClientEvent("cloud-read-failed", "project rename fallback couldn't read the group", { groupId, error: sel.error.message || "" });
    return { ok: false, rows: 0, atomic: false, error: sel.error.message || "couldn't read the project" };
  }
  // Match on the SAME key the client's groupOf() uses — the group_id column is a mirror that drifts.
  const rows = (sel.data || []).filter((r) => r && r.data && ((r.data.groupId || r.data.id) === groupId));
  if (!rows.length) return { ok: false, rows: 0, atomic: false, error: "The rename didn't match any project in your account." };
  let failed = 0;
  for (const r of rows) {
    const { error } = await supabase.from("sites")
      .update({ site, data: { ...r.data, site, siteRenamedAt: at }, updated_at: new Date(at).toISOString() }).eq("id", r.id);
    if (error) failed += 1;
    else { delete lastHeaderSig[r.id]; delete siteVersions[r.id]; } // re-read the version on the next push
  }
  if (failed) {
    reportClientEvent("cloud-write-failed", "project rename fallback partly failed", { groupId, failed, total: rows.length });
    return { ok: false, rows: rows.length - failed, atomic: false, error: "Part of the project couldn't be renamed in the cloud." };
  }
  return { ok: true, rows: rows.length, atomic: false };
}
