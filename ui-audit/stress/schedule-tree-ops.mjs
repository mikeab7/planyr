// Faithful extraction of the Scheduler's multi-row indent/outdent + delete-with-children tree
// mutations from public/sequence/index.html (flatOrderWithLevel/indentSelection/outdentSelection/
// promoteChildrenAndDelete, defined just after sortByVisualOrder). Copied VERBATIM so
// test/scheduleIndentOutdentDelete.test.js exercises the real code paths without a browser.
// Keep in sync if the source changes — test/scheduleIndentOutdentDelete.test.js's drift guard
// checks the source lines still exist verbatim in index.html.

export const flatOrderWithLevel = (tasks) => {
  const kidsBy = new Map();
  tasks.forEach(t => { const p = t.parentId ?? null; if (!kidsBy.has(p)) kidsBy.set(p, []); kidsBy.get(p).push(t); });
  const out = [];
  const walk = (parentId, level) => {
    (kidsBy.get(parentId) || []).forEach(t => {
      out.push({ ...t, level });
      if (t.isExpanded) walk(t.id, level + 1);
    });
  };
  walk(null, 0);
  return out;
};

export const indentSelection = (tasks, selectedIds) => {
  const flatOrder = flatOrderWithLevel(tasks);
  const posById = new Map(flatOrder.map((t, i) => [t.id, i]));
  const idSet = new Set(selectedIds.filter(id => posById.has(id)));
  if (!idSet.size) return null;
  let topPos = Infinity;
  idSet.forEach(id => { const p = posById.get(id); if (p < topPos) topPos = p; });
  if (topPos <= 0) return null; // nothing above the topmost row at all
  const top = flatOrder[topPos];
  const L = top.level;
  let newParent = null;
  for (let i = topPos - 1; i >= 0; i--) {
    if (flatOrder[i].level === L) { newParent = flatOrder[i]; break; }
    if (flatOrder[i].level < L) break; // hit the topmost row's own parent first — no eligible sibling above it
  }
  if (!newParent) return null;
  const rootIds = [...idSet].filter(id => !idSet.has(flatOrder[posById.get(id)].parentId));
  if (rootIds.every(id => flatOrder[posById.get(id)].parentId === newParent.id)) return null; // already there
  const rootSet = new Set(rootIds);
  return tasks.map(t => {
    if (rootSet.has(t.id)) return { ...t, parentId: newParent.id };
    if (t.id === newParent.id) return { ...t, isExpanded: true, focused: false };
    return t;
  });
};

export const outdentSelection = (tasks, selectedIds) => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const idSet = new Set(selectedIds.filter(id => byId.has(id)));
  if (!idSet.size) return null;
  const rootIds = selectedIds.filter(id => idSet.has(id) && !idSet.has(byId.get(id).parentId));
  // Group ADJACENT (in the given top-to-bottom order) root ids that share the same CURRENT parent
  // into one batch, so a whole run of siblings is promoted and re-sequenced together in a single
  // splice — moving them one row at a time would recompute "the end of the old parent's remaining
  // subtree" against an array that's already lost the earlier movers, placing later movers ahead
  // of earlier ones and reversing the block's visual order.
  const groups = [];
  rootIds.forEach(id => {
    const t = byId.get(id);
    const last = groups[groups.length - 1];
    if (last && last.parentId === t.parentId) last.ids.push(id);
    else groups.push({ parentId: t.parentId, ids: [id] });
  });
  let working = [...tasks];
  let changed = false;
  groups.forEach(g => {
    if (g.parentId === null || g.parentId === undefined) return; // already depth 0 — clean no-op for this run
    const parent = working.find(t => t.id === g.parentId);
    if (!parent) return; // orphaned parentId — nothing sane to promote to
    const grandParentId = parent.parentId ?? null;
    const moveSet = new Set(g.ids);
    const subtreeIds = new Set([g.parentId]);
    const collect = pid => { working.filter(t => t.parentId === pid && !moveSet.has(t.id)).forEach(c => { subtreeIds.add(c.id); collect(c.id); }); };
    collect(g.parentId);
    const moved = g.ids.map(id => working.find(t => t.id === id)).filter(Boolean).map(t => ({ ...t, parentId: grandParentId }));
    const remaining = working.filter(t => !moveSet.has(t.id));
    let insertAfter = -1;
    remaining.forEach((t, i) => { if (subtreeIds.has(t.id)) insertAfter = i; });
    const reordered = [...remaining];
    reordered.splice(insertAfter + 1, 0, ...moved);
    working = grandParentId !== null ? reordered.map(t => t.id === grandParentId ? { ...t, focused: false } : t) : reordered;
    changed = true;
  });
  return changed ? working : null;
};

export const moveSelectionToDestination = (tasks, selectedIds, destParentId, insertAfterId = "end") => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const idSet = new Set(selectedIds.filter(id => byId.has(id)));
  if (!idSet.size) return null;
  if (destParentId != null && !byId.has(destParentId)) return null; // destination vanished

  // A row can never move into itself or its own descendant — walk every moved row's subtree (in the
  // ORIGINAL tree, before any reparenting) and refuse if destParentId falls inside any of them. This
  // also catches destParentId being one of the moved rows itself (rootId === targetId base case).
  const isInSubtree = (rootId, targetId) => rootId === targetId || tasks.some(t => t.parentId === rootId && isInSubtree(t.id, targetId));
  if (destParentId != null && [...idSet].some(id => isInSubtree(id, destParentId))) return null;

  const rootIds = [...idSet].filter(id => !idSet.has(byId.get(id).parentId));
  if (!rootIds.length) return null;
  const rootSet = new Set(rootIds);

  let working = tasks.map(t => rootSet.has(t.id) ? { ...t, parentId: destParentId } : t);
  // Auto-expand the destination so the moved block is immediately visible where it landed — the
  // only way to "see" a drop into a collapsed group without requiring it to be expanded first.
  if (destParentId != null) working = working.map(t => t.id === destParentId ? { ...t, isExpanded: true, focused: false } : t);

  const movedInOrder = rootIds.map(id => working.find(t => t.id === id));
  const remaining = working.filter(t => !rootSet.has(t.id));

  let insertAt = -1;
  if (insertAfterId === "start") {
    const firstChildIdx = remaining.findIndex(t => t.parentId === destParentId);
    insertAt = firstChildIdx >= 0 ? firstChildIdx - 1 : (destParentId != null ? remaining.findIndex(t => t.id === destParentId) : -1);
  } else if (insertAfterId !== "end" && insertAfterId != null && !rootSet.has(insertAfterId) && remaining.some(t => t.id === insertAfterId)) {
    insertAt = remaining.findIndex(t => t.id === insertAfterId);
  } else {
    remaining.forEach((t, i) => { if (t.parentId === destParentId) insertAt = i; }); // after the last existing child
    if (insertAt === -1 && destParentId != null) insertAt = remaining.findIndex(t => t.id === destParentId);
    if (insertAt === -1) insertAt = remaining.length - 1; // top-level fallback: end of the array
  }
  const result = [...remaining];
  result.splice(insertAt + 1, 0, ...movedInOrder);

  // No-op guard: refuse (return null) when the move changes nothing about the tree's shape — same
  // parents, same relative order for every row, not just the moved ones (a splice that lands a block
  // back exactly where it started must not manufacture an undo entry).
  const key = list => list.map(t => `${t.id}:${t.parentId ?? "null"}`).join(",");
  return key(result) === key(tasks) ? null : result;
};

export const promoteChildrenAndDelete = (tasks, deleteIds) => {
  const delSet = new Set(deleteIds);
  const byId = new Map(tasks.map(t => [t.id, t]));
  const survivingAncestor = (parentId) => {
    let cur = parentId;
    while (cur !== null && cur !== undefined && delSet.has(cur)) cur = byId.get(cur)?.parentId ?? null;
    return cur ?? null;
  };
  return tasks.filter(t => !delSet.has(t.id)).map(t => (
    t.parentId != null && delSet.has(t.parentId) ? { ...t, parentId: survivingAncestor(t.parentId) } : t
  ));
};
