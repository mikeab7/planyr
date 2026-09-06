#!/usr/bin/env node
/* B1162192 (owner report 2026-09-05) — orphan Library folder-tree audit + cleanup.
 * REPORT FIRST, always: this script never deletes anything unless run with --apply AND an
 * explicit --confirm list naming the exact project ids to touch. Read this whole header
 * before running --apply — it trashes real folders in the owner's actual Google Drive.
 *
 * THE FINDING THIS CLOSES. Merely opening a project's Library used to seed the full
 * 133-folder template and mirror every one of them to Google Drive (FolderTree.jsx's old
 * mount-time auto-seed, fixed going forward by B1162193) — including for project ids
 * nothing ever actually saved. Measured on production: 8,781 project_folders rows across
 * 66 trees, 21 of which (2,793 rows, 2,725 mirrored Drive folders) belong to project ids
 * with NO row in public.sites at all — a project that never existed. This script is the
 * one-time (and repeatable) cleanup for that wreckage, not a new feature.
 *
 * BUCKETS — every project_folders "tree" (one project_id), against public.sites:
 *   - live          — a real, non-deleted sites row exists. Never touched, never reported
 *                     as a candidate.
 *   - soft_deleted  — a sites row exists but is soft-deleted (deleted_at set). Reported
 *                     only, NEVER an --apply candidate: deleting a project does not
 *                     currently clean up its Drive mirror (a real, separate gap — see
 *                     B1162192's own item text), and a soft delete is restorable, so its
 *                     folders may be deliberate. A future item can decide whether project
 *                     deletion should cascade to this table; this script does not do it.
 *   - never_existed — no sites row for this project_id at all. The only bucket --apply can
 *                     ever touch, and only when this script's OWN Drive walk (never a
 *                     stored count) finds the tree holds zero files anywhere in it.
 *
 * THE EMPTINESS CHECK IS A REAL WALK, NOT AN ASSUMPTION: this finds the tree's Drive
 * project-root folder via parentsOf() on one of its own tracked category folders (never
 * guessed from a name pattern) and does a breadth-first walk of every descendant folder,
 * looking for any non-folder file. A tree that holds even one file is reported and is
 * NEVER an --apply candidate, no matter what — it is surfaced for a human to look at by
 * hand (a stray drop straight into Drive, outside anything Planyr tracks, is exactly the
 * case an automated delete must never eat).
 *
 * USAGE (report — always safe, never writes anything):
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… PLANYR_STORAGE_BACKEND=drive \
 *   GOOGLE_CLIENT_ID=… GOOGLE_CLIENT_SECRET=… GOOGLE_REFRESH_TOKEN=… \
 *   node scripts/audit-orphan-folders.mjs
 *
 * USAGE (apply — DESTRUCTIVE, only after a human has read the report and approved it BY
 * NAME): add --apply --confirm=<comma-separated project_ids taken from this run's own
 * "confirmed empty and eligible" list>. An id under --apply that isn't ALSO in that list,
 * or wasn't named on the command line, is left completely alone. Each confirmed id gets,
 * in this order: (1) one DELETE of all its project_folders rows (a single statement, so a
 * partial delete can't happen), then (2) client.trash() on its Drive project-root folder
 * — Drive cascades a trash to every descendant, and Drive's own trash is recoverable for
 * roughly 30 days if this was ever wrong.
 */
import { createClient } from "@supabase/supabase-js";
import { storageConfig, defaultDriveClientFactory } from "../server/storage/index.js";

async function fetchAllFolderRows(sb) {
  const pageSize = 1000; // PostgREST default row cap — page explicitly
  let from = 0, rows = [];
  for (;;) {
    const { data, error } = await sb.from("project_folders")
      .select("id,project_id,parent_id,drive_folder_id")
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows = rows.concat(data || []);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchSitesGroupStatus(sb) {
  const pageSize = 1000;
  let from = 0;
  const byGroup = new Map();
  for (;;) {
    const { data, error } = await sb.from("sites").select("group_id,deleted_at").range(from, from + pageSize - 1);
    if (error) throw error;
    for (const r of data || []) {
      if (!r.group_id) continue;
      const cur = byGroup.get(r.group_id) || { hasLive: false, hasDeleted: false };
      if (r.deleted_at == null) cur.hasLive = true; else cur.hasDeleted = true;
      byGroup.set(r.group_id, cur);
    }
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return byGroup;
}

// Pure bucketing rule — exported so it's unit-testable without a database or Drive.
export function bucketFor(status) {
  if (!status) return "never_existed";
  return status.hasLive ? "live" : "soft_deleted";
}

// Real Google Drive project-root discovery: walk UP from one of the tree's own tracked
// category folders, never a title guess.
async function projectRootFolderId(client, rows) {
  const topLevel = rows.find((r) => r.parent_id == null && r.drive_folder_id);
  if (!topLevel) return null;
  const parents = await client.parentsOf(topLevel.drive_folder_id);
  return (parents && parents[0]) || null;
}

// Breadth-first walk from the project root: true the moment ANY non-folder file is found
// anywhere in the tree, false only once every folder has been listed and none held one.
async function treeHasAnyFile(client, rootFolderId) {
  const queue = [rootFolderId];
  const seen = new Set();
  while (queue.length) {
    const id = queue.shift();
    if (seen.has(id)) continue;
    seen.add(id);
    const children = await client.list({ parentFolderId: id });
    for (const c of children || []) {
      if (c.mimeType === "application/vnd.google-apps.folder") queue.push(c.id);
      else return true;
    }
  }
  return false;
}

async function main() {
  const URL = process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL || !KEY) {
    console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (service role — this reads every account's folder tree).");
    process.exit(2);
  }
  const sb = createClient(URL, KEY);

  const APPLY = process.argv.includes("--apply");
  const CONFIRM = (process.argv.find((a) => a.startsWith("--confirm=")) || "").split("=")[1] || "";
  const confirmedIds = new Set(CONFIRM.split(",").map((s) => s.trim()).filter(Boolean));

  const [folderRows, sitesByGroup] = await Promise.all([fetchAllFolderRows(sb), fetchSitesGroupStatus(sb)]);
  const byProject = new Map();
  for (const r of folderRows) {
    if (!byProject.has(r.project_id)) byProject.set(r.project_id, []);
    byProject.get(r.project_id).push(r);
  }

  const cfg = storageConfig(process.env);
  const client = defaultDriveClientFactory(cfg.drive);
  if (!client) {
    console.error("Google Drive isn't configured (GOOGLE_CLIENT_ID/SECRET/REFRESH_TOKEN + PLANYR_STORAGE_BACKEND=drive) — refusing to run without a way to check real Drive contents.");
    process.exit(2);
  }

  const buckets = { live: [], soft_deleted: [], never_existed: [] };
  for (const [projectId, rows] of byProject) {
    buckets[bucketFor(sitesByGroup.get(projectId))].push({ projectId, rows });
  }

  console.log(`Scanned ${folderRows.length} project_folders rows across ${byProject.size} project(s).`);
  console.log(`  live: ${buckets.live.length} · soft_deleted: ${buckets.soft_deleted.length} · never_existed: ${buckets.never_existed.length}\n`);

  const emptyNeverExisted = [];
  for (const bucketName of ["never_existed", "soft_deleted"]) {
    for (const { projectId, rows } of buckets[bucketName]) {
      let rootId = null, hasFiles = null, error = null;
      try {
        rootId = await projectRootFolderId(client, rows);
        if (rootId) hasFiles = await treeHasAnyFile(client, rootId);
      } catch (e) { error = e.message; }
      const verdict = !rootId ? "no Drive root found — can't check"
        : error ? `COULD NOT CHECK (${error})`
        : hasFiles ? "HAS FILES — never an --apply candidate"
        : "Drive tree is EMPTY";
      console.log(`[${bucketName}] ${projectId} — ${rows.length} folder rows, Drive root ${rootId || "n/a"} — ${verdict}`);
      if (bucketName === "never_existed" && rootId && hasFiles === false) emptyNeverExisted.push({ projectId, rootId, rowCount: rows.length });
    }
  }

  console.log(`\n${emptyNeverExisted.length} never_existed tree(s) confirmed EMPTY and eligible for cleanup:`);
  for (const e of emptyNeverExisted) console.log(`  - ${e.projectId} (${e.rowCount} rows, Drive root ${e.rootId})`);

  if (!APPLY) {
    console.log("\nReport only — nothing deleted. Re-run with --apply --confirm=<comma-separated project_ids from the list above> to clean up.");
    return;
  }

  const toDelete = emptyNeverExisted.filter((e) => confirmedIds.has(e.projectId));
  const skippedConfirm = emptyNeverExisted.filter((e) => !confirmedIds.has(e.projectId));
  if (skippedConfirm.length) console.log(`\n--apply given but NOT confirmed for: ${skippedConfirm.map((e) => e.projectId).join(", ")} — left untouched.`);
  if (!toDelete.length) { console.log("Nothing confirmed to delete."); return; }

  console.log(`\nDeleting ${toDelete.length} confirmed empty tree(s)...`);
  for (const { projectId, rootId, rowCount } of toDelete) {
    const { error: delErr } = await sb.from("project_folders").delete().eq("project_id", projectId);
    if (delErr) { console.error(`  ${projectId}: DB delete failed — ${delErr.message} — Drive folder left untouched.`); continue; }
    try {
      await client.trash(rootId);
      console.log(`  ${projectId}: deleted ${rowCount} rows, trashed Drive root ${rootId}.`);
    } catch (e) {
      console.error(`  ${projectId}: DB rows deleted but Drive trash FAILED (${e.message}) — trash ${rootId} by hand.`);
    }
  }
}

// Only run when invoked directly (`node scripts/audit-orphan-folders.mjs`) — importing
// this module (the pure `bucketFor` export, for unit tests) must never trigger a real run.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(2); });
}
