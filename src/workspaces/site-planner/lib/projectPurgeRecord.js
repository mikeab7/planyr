/* NEW-4 (data-risk 2026-10-29) — a permanently deleted project leaves a record.
 *
 * On 2026-10-27 `sites` dropped from 408 rows to 407 with no new soft-delete in the window: a trashed
 * project was permanently deleted and nothing could say WHICH one. This module is observability only —
 * it never changes what a purge does and never gates it. Before a purge runs, `collectPurgeManifest`
 * reads (read-only, best-effort) what the project holds; once the purge is PROVEN (a fresh read found
 * the rows gone), `buildPurgeEvent` shapes the one `client_errors` row — id, group_id, name, owner,
 * soft-delete timestamp, purge timestamp and counts of what went with it — which storage.js sends
 * through `reportClientEvent("project-purged", …)`.
 *
 * A count that could not be read is `null`, never 0: "unknown" and "none" must stay distinguishable
 * in the one place anyone will look to learn what was destroyed. Notes are `"unlinked"`: a note's
 * project lives inside the notes tree document, not in a column, so no read here can count them and a
 * purge deletes none of them (notes_pages has no foreign key to sites).
 *
 * What each count means for the project's removal: site_elements and project_folders rows are deleted
 * with it; comps / overlays are DETACHED (project_id set null — their FKs are ON DELETE SET NULL);
 * schedules are a soft link by linked_site_id and are left in place. */

const MAX_IDS = 60;

async function countOf(client, table, column, values) {
  const list = [...new Set((values || []).filter(Boolean))];
  if (!list.length) return 0;
  try {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).in(column, list);
    if (error || typeof count !== "number") return null;
    return count;
  } catch (_) { return null; }
}

/* Read-only. Never throws; every failed read is a null. `client` is a supabase client (injected for tests). */
export async function collectPurgeManifest(client, { ids, groupId } = {}) {
  const list = [...new Set((Array.isArray(ids) ? ids : [ids]).filter(Boolean))].slice(0, MAX_IDS);
  const manifest = { ids: list, groupId: groupId || null, rows: null, counts: null };
  if (!client || !list.length) return manifest;
  try {
    const { data, error } = await client.from("sites").select("id, group_id, site, name, user_id, deleted_at").in("id", list);
    if (!error && Array.isArray(data)) manifest.rows = data;
  } catch (_) { /* rows stays null */ }
  const keys = [...new Set([...(groupId ? [groupId] : []), ...(manifest.rows || []).map((r) => r.group_id).filter(Boolean)])];
  manifest.counts = {
    site_elements: await countOf(client, "site_elements", "site_id", list),
    comps: await countOf(client, "comps", "project_id", list),
    overlays: await countOf(client, "site_plan_overlays", "project_id", list),
    schedules: await countOf(client, "schedules", "linked_site_id", [...keys, ...list]),
    folder_rows: await countOf(client, "project_folders", "project_id", [...keys, ...list]),
    notes: "unlinked",
  };
  return manifest;
}

const iso = (ms) => { try { return new Date(ms).toISOString(); } catch (_) { return null; } };

/* Pure. `outcome` = { ok, gone: [ids proven gone] } from hardDeleteVerified. Returns the `extra` payload for
 * reportClientEvent, or null when nothing was proven gone (a failed purge is reported by its own events). */
export function buildPurgeEvent(manifest, outcome, now = Date.now()) {
  const gone = outcome && Array.isArray(outcome.gone) ? outcome.gone.filter(Boolean) : [];
  if (!gone.length || !manifest) return null;
  const rows = (manifest.rows || []).filter((r) => gone.includes(r.id));
  const first = rows[0] || null;
  const deletedAts = rows.map((r) => r.deleted_at).filter(Boolean).sort();
  return {
    ids: gone,
    groupId: manifest.groupId || (first && first.group_id) || null,
    name: first ? (first.site || first.name || null) : null,
    owner: first ? first.user_id || null : null,
    softDeletedAt: deletedAts.length ? deletedAts[deletedAts.length - 1] : null,
    purgedAt: iso(now),
    counts: manifest.counts || null,
    detail: first ? undefined : "the project's rows could not be read before the purge — name/owner/counts are unknown",
  };
}
