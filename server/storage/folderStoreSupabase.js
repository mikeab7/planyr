/* Server-side reader/writer for the project_folders index (B650), backed by Supabase REST.
 *
 * The Drive-mirror reconcile runs in a stateless Pages Function (functions/api/folders.js) —
 * it can't hold the tree in memory between requests, so it reads the authoritative rows here
 * and writes ONLY the drive_* bookkeeping columns back (structure columns belong to the
 * client). Scoped to the caller by RLS via their bearer token. Network is injectable for
 * tests; reads never throw fatally (return []), writes report { ok } so a lost mapping is a
 * visible failure, never a silent success (the NEW-4 rule).
 *
 * Mirrors idStoreSupabase.js — same REST shape, same header set, same "own-row via token" model.
 */
const REST = (url) => `${String(url).replace(/\/+$/, "")}/rest/v1/project_folders`;
// drive_* columns are guarded against direct client writes; the server writes them only through
// this SECURITY DEFINER RPC (project_folders.sql), which the guard trigger allows.
const RPC = (url) => `${String(url).replace(/\/+$/, "")}/rest/v1/rpc/folder_set_drive_meta`;

// Columns the reconcile needs (structure + drive bookkeeping), mapped to the planner's shape.
// sort_order rides along so the server-side resolver orders siblings EXACTLY like the client
// (duplicate-ish labels must resolve to the same folder on both sides).
const SELECT =
  "id,parent_id,name,sort_order,trashed,drive_folder_id,drive_parent_id,drive_name,drive_trashed";

const toRow = (r) => ({
  id: r.id,
  parentId: r.parent_id ?? null,
  name: r.name,
  order: r.sort_order ?? 0,
  trashed: !!r.trashed,
  driveFolderId: r.drive_folder_id ?? null,
  driveParentId: r.drive_parent_id ?? null,
  driveName: r.drive_name ?? null,
  driveTrashed: !!r.drive_trashed,
});

export function folderStoreSupabase({ supabaseUrl, anonKey, token, fetchImpl = fetch } = {}) {
  const headers = { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
  const enc = encodeURIComponent;

  return {
    /* All of a project's folder rows (RLS scopes to the caller), in planner shape. Returns
     * NULL on a failed read — callers MUST treat that as "couldn't read the index", never as
     * "the project has no folders": an empty-array lookalike made a blipped read report
     * "Mirrored to Google Drive" with most of the tree unmirrored (the classic silent
     * false-success; LOUD-FAILURE / B209 class — caught by the B662 adversarial review). */
    async list(projectId) {
      try {
        const res = await fetchImpl(
          `${REST(supabaseUrl)}?select=${enc(SELECT)}&project_id=eq.${enc(projectId)}`,
          { headers },
        );
        if (!res.ok) throw new Error(`project_folders list ${res.status}`);
        const rows = await res.json();
        return (rows || []).map(toRow);
      } catch (e) {
        console.warn("project_folders list failed:", e && e.message);
        return null; // a failed read is a FAILURE, not an empty tree
      }
    },

    // Patch ONLY the drive_* bookkeeping of one row, through the server-only SECURITY DEFINER RPC
    // (a direct PATCH of drive_* is rejected by the guard trigger). The RPC scopes to the caller's
    // own row via auth.uid(). Returns { ok } so the reconcile can surface a persistence failure
    // instead of pretending success. Only present keys are written (a present null still sets null).
    async updateDrive(id, patch = {}) {
      const p = {};
      if ("driveFolderId" in patch) p.drive_folder_id = patch.driveFolderId;
      if ("driveParentId" in patch) p.drive_parent_id = patch.driveParentId;
      if ("driveName" in patch) p.drive_name = patch.driveName;
      if ("driveTrashed" in patch) p.drive_trashed = patch.driveTrashed;
      try {
        const res = await fetchImpl(RPC(supabaseUrl), {
          method: "POST",
          headers: { ...headers, prefer: "return=minimal" },
          body: JSON.stringify({ p_id: id, p_patch: p }),
        });
        if (!res.ok) return { ok: false, error: `folder_set_drive_meta ${res.status}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e && e.message) || "folder_set_drive_meta failed" };
      }
    },
  };
}
