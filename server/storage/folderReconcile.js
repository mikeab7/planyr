/* One-way folder-mirror reconcile planner (B645) — pure, server-side, no network.
 *
 * Planyr's Supabase folder index is authoritative; Google Drive is a live mirror that
 * FOLLOWS it. This module diffs the desired tree (the project_folders rows) against what was
 * last pushed to Drive (the drive_* bookkeeping columns) and emits the minimal, ordered set
 * of Drive operations to make Drive match. It reconciles BY STORED DRIVE ID, never by path —
 * so a rename/move acts on the existing Drive folder in place instead of orphaning it and
 * creating a duplicate (the exact failure the brief forbids).
 *
 * Input rows: [{ id, parentId, name, trashed,
 *                driveFolderId, driveParentId, driveName, driveTrashed }]
 *   parentId null  → a top-level category; its Drive parent is the project's own root folder.
 *   drive* null    → never pushed yet (a create).
 *
 * Output (folderReconcilePlan):
 *   { creates:[{ id, name, parentId }],           // depth-ordered: a parent always precedes its child
 *     renames:[{ id, driveFolderId, name }],
 *     moves:[{ id, driveFolderId, newParentId, removeParent }],
 *     trashes:[{ id, driveFolderId }] }           // subtree ROOTS only (Drive trash cascades)
 * The executor resolves parentId/newParentId (null = project root) to a Drive id via the map
 * it fills as it creates, so creates must be applied in the returned order.
 */

// Depth of a row (0 at top), walking the parentId chain. Cycle-safe (bails at rows.length).
function depthOf(row, byId) {
  let d = 0;
  let cur = row;
  const guard = byId.size + 1;
  while (cur && cur.parentId != null && byId.has(cur.parentId) && d <= guard) {
    cur = byId.get(cur.parentId);
    d += 1;
  }
  return d;
}

// Is any ancestor of `row` also flagged trashed? (Then Drive-trashing the ancestor cascades to
// it — we must NOT emit a separate trash for it.)
function hasTrashedAncestor(row, byId) {
  let cur = row.parentId != null ? byId.get(row.parentId) : null;
  const guard = byId.size + 1;
  let n = 0;
  while (cur && n <= guard) {
    if (cur.trashed) return true;
    cur = cur.parentId != null ? byId.get(cur.parentId) : null;
    n += 1;
  }
  return false;
}

export function folderReconcilePlan(rows = []) {
  const byId = new Map((rows || []).filter((r) => r && r.id != null).map((r) => [r.id, r]));

  const creates = [];
  const renames = [];
  const moves = [];
  const trashes = [];

  for (const r of byId.values()) {
    if (r.trashed) {
      // Trash only the subtree ROOTS that are actually in Drive and not already trashed there;
      // a trashed folder whose ancestor is also being trashed rides along for free (cascade).
      if (r.driveFolderId && !r.driveTrashed && !hasTrashedAncestor(r, byId)) {
        trashes.push({ id: r.id, driveFolderId: r.driveFolderId });
      }
      continue; // never rename/move a doomed folder
    }

    if (!r.driveFolderId) {
      creates.push({ id: r.id, name: r.name, parentId: r.parentId ?? null });
      continue; // a brand-new folder is created with the right name+parent — no follow-up op
    }

    // Rename in place when the label changed since the last push.
    if (r.name !== r.driveName) {
      renames.push({ id: r.id, driveFolderId: r.driveFolderId, name: r.name });
    }

    // Move in place when the desired parent differs from what we last pushed. Resolve the
    // desired parent's Drive id; null parentId → the project root (executor: `newParentId ===
    // null`). A move UNDER A FOLDER BEING CREATED IN THIS SAME PASS is still emitted: the
    // executor runs creates before moves and threads each new id into its map, so by the time
    // the move runs `driveId.get(newParentId)` resolves. (Skipping it — the old behaviour — left
    // the folder mis-parented in Drive while the sync falsely reported success, until some later
    // unrelated edit happened to re-reconcile it.)
    const parentRow = r.parentId == null ? null : byId.get(r.parentId);
    const parentIsPendingCreate = !!(parentRow && !parentRow.driveFolderId && !parentRow.trashed);
    const desiredParentDrive = r.parentId == null ? null : (parentRow && parentRow.driveFolderId) || undefined;
    const parentResolvable = r.parentId == null || desiredParentDrive !== undefined || parentIsPendingCreate;
    // A pending-create parent always means the child sits somewhere else today, so it's a move.
    const changedParent = parentIsPendingCreate || (desiredParentDrive ?? null) !== (r.driveParentId ?? null);
    if (parentResolvable && changedParent) {
      moves.push({
        id: r.id,
        driveFolderId: r.driveFolderId,
        newParentId: r.parentId ?? null,
        removeParent: r.driveParentId ?? null,
      });
    }
  }

  // Depth-ascending so a parent is always created before its children.
  creates.sort((a, b) => depthOf(byId.get(a.id), byId) - depthOf(byId.get(b.id), byId));

  return { creates, renames, moves, trashes };
}

// Convenience: is there anything to do? Lets the executor short-circuit a no-op reconcile.
export function planIsEmpty(plan) {
  return (
    !plan ||
    ((plan.creates || []).length === 0 &&
      (plan.renames || []).length === 0 &&
      (plan.moves || []).length === 0 &&
      (plan.trashes || []).length === 0)
  );
}
