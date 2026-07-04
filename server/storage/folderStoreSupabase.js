/* Server-side reader/writer for the project_folders index (B645), backed by Supabase REST.
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

// Columns the reconcile needs (structure + drive bookkeeping), mapped to the planner's shape.
const SELECT =
  "id,parent_id,name,trashed,drive_folder_id,drive_parent_id,drive_name,drive_trashed";

const toRow = (r) => ({
  id: r.id,
  parentId: r.parent_id ?? null,
  name: r.name,
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
    // All of a project's folder rows (RLS scopes to the caller), in planner shape.
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
        return [];
      }
    },

    // Patch ONLY the drive_* bookkeeping of one row (by id; RLS enforces ownership). Returns
    // { ok } so the reconcile can surface a persistence failure instead of pretending success.
    async updateDrive(id, patch = {}) {
      const body = { updated_at: new Date().toISOString() };
      if ("driveFolderId" in patch) body.drive_folder_id = patch.driveFolderId;
      if ("driveParentId" in patch) body.drive_parent_id = patch.driveParentId;
      if ("driveName" in patch) body.drive_name = patch.driveName;
      if ("driveTrashed" in patch) body.drive_trashed = patch.driveTrashed;
      try {
        const res = await fetchImpl(`${REST(supabaseUrl)}?id=eq.${enc(id)}`, {
          method: "PATCH",
          headers: { ...headers, prefer: "return=minimal" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { ok: false, error: `project_folders update ${res.status}` };
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e && e.message) || "project_folders update failed" };
      }
    },
  };
}
