/* NEW-6 (data-risk 2026-10-29) — the SERVER-side liveness question behind `purge-project`.
 *
 * `functions/api/folders.js` action "purge-project" trashes a project's WHOLE Drive tree. Its client
 * (`library/lib/folders.js` → storage.js's `purgeProjectFoldersFor`) asks `groupStillHasLivePlans` first, but
 * a route that destroys a Drive tree must not rest on its caller having asked: the same question is asked here,
 * with the caller's own token (RLS-scoped), before anything is trashed.
 *
 * The key is `coalesce(data->>'groupId', id)` — the one `sites_block_delete_live_group` and
 * `rename_site_group` use — NOT the `group_id` column, which can drift or be NULL for a solo project:
 *   live ⇔ a sites row with deleted_at IS NULL where  data->>'groupId' = pid
 *                                                  OR (data->>'groupId' IS NULL AND id = pid)
 *
 * FAILS SAFE in the destructive direction: an unanswerable question (network, auth, an odd id) is
 * `{ ok:false }` and the caller trashes NOTHING. Only a clean "zero live rows" answer lets the purge go on. */
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,128}$/; // opaque ids; anything else is refused rather than put in a filter

export async function projectHasLivePlans({ supabaseUrl, anonKey, token, projectId, fetchImpl = fetch } = {}) {
  if (!projectId || !SAFE_ID.test(String(projectId))) return { ok: false, live: null, error: "Unusable project id." };
  if (!supabaseUrl || !anonKey || !token) return { ok: false, live: null, error: "Not configured to check liveness." };
  const or = encodeURIComponent(`(data->>groupId.eq.${projectId},and(id.eq.${projectId},data->>groupId.is.null))`);
  const url = `${String(supabaseUrl).replace(/\/+$/, "")}/rest/v1/sites?select=id&deleted_at=is.null&or=${or}&limit=1`;
  try {
    const resp = await fetchImpl(url, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
    if (!resp.ok) return { ok: false, live: null, error: `Liveness check answered HTTP ${resp.status}.` };
    const rows = await resp.json();
    if (!Array.isArray(rows)) return { ok: false, live: null, error: "Liveness check answered something unreadable." };
    return { ok: true, live: rows.length > 0 };
  } catch (e) { return { ok: false, live: null, error: (e && e.message) || "Liveness check failed." }; }
}
