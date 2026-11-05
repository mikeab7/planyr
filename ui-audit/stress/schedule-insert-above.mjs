// Faithful extraction of the Scheduler's insert-row-above positioning (NEW-1) from
// public/sequence/index.html (sortByVisualOrder + insertRowAbove). Copied VERBATIM so
// test/scheduleInsertAbove.test.js exercises the real code without a browser; that test's drift
// guard fails if either body diverges from index.html.

export const sortByVisualOrder = (tasks) => {
  const childMap = {};
  tasks.forEach(t => {
    const p = t.parentId ?? null;
    if (!childMap[p]) childMap[p] = [];
    childMap[p].push(t);
  });
  const result = [];
  const walk = (parentId) => {
    (childMap[parentId] || []).forEach(t => { result.push(t); walk(t.id); });
  };
  walk(null);
  // Append any orphaned tasks (parentId pointing to non-existent task) at the end
  const seen = new Set(result.map(t => t.id));
  tasks.filter(t => !seen.has(t.id)).forEach(t => result.push(t));
  return result;
};

export const insertRowAbove = (tasks, visibleIds, anchorId, newTask) => {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const anchor = anchorId == null ? null : byId.get(anchorId);
  if (!anchor) return [...tasks, { ...newTask, parentId: null }];
  const pos = visibleIds.indexOf(anchorId);
  const above = pos > 0 ? byId.get(visibleIds[pos - 1]) : null;
  const out = [...tasks];
  const anchorParent = anchor.parentId ?? null;
  if (!above || above.id === anchorParent) {
    out.splice(out.indexOf(anchor), 0, { ...newTask, parentId: anchorParent });
    return out;
  }
  const parentId = above.parentId ?? null;
  const visible = new Set(visibleIds);
  const siblings = tasks.filter(t => (t.parentId ?? null) === parentId);
  const after = siblings.slice(siblings.indexOf(above) + 1);
  const nextVisible = after.find(t => visible.has(t.id));
  const row = { ...newTask, parentId };
  if (nextVisible) out.splice(out.indexOf(nextVisible), 0, row);
  else out.splice(out.indexOf(siblings[siblings.length - 1]) + 1, 0, row);
  return out;
};
