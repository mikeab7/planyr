/* notesTasks — every open checklist item, across every note (NEW-4).
 *
 * THE PROBLEM THIS EXISTS FOR, in the owner's terms: Tuesday's water-district call,
 * Thursday's site walk and the broker's LOI comment each produce an item, each lands in a
 * different note, and nothing should depend on remembering to re-read those notes. A
 * checkbox trapped inside one page is a reminder you have to go looking for.
 *
 * PURE, over the stored DOCUMENT MODEL. No editor, no storage, no React — which is what
 * lets the load-bearing claim ("ticking it in the list flips the checkbox in the note") be
 * asserted as a property of a document transform rather than as a click that appeared to
 * work (test/notesTasks.test.js).
 *
 * ⛔ THE KEY IS AN INDEX **AND** THE TEXT, and that pairing is the whole of the safety.
 * An index alone is a position in a document somebody may have edited since the list was
 * built — tick "call the district" and you flip whatever moved into slot three. Text alone
 * cannot tell two identical "Follow up" items apart. So `setTaskCheckedInDoc` takes both,
 * uses the index only when the text at that index still agrees, and otherwise falls back to
 * the first item whose text matches AND whose state is the one being changed FROM. When
 * neither resolves it changes NOTHING and says so (`changed: false`) — a rollup that
 * silently ticks the wrong line is worse than one that declines.
 */

/** The plain text of a node and everything under it. */
function textOf(node) {
  if (!node || typeof node !== "object") return "";
  if (node.type === "text") return String(node.text || "");
  return (node.content || []).map(textOf).join("");
}

const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

/** Every checklist item in one document, in reading order.
 *
 *  `text` is the item's OWN words only — a nested sub-item is its own row, so a parent's
 *  text is not the parent plus everything under it. That matters because the rollup shows
 *  the text, and a parent that reads as its whole subtree is unusable. */
export function tasksInDoc(doc) {
  const out = [];
  const walk = (node) => {
    for (const child of node?.content || []) {
      if (child?.type === "taskItem") {
        // The item's own paragraph(s), not its nested taskList.
        const own = (child.content || []).filter((c) => c?.type !== "taskList" && c?.type !== "bulletList" && c?.type !== "orderedList");
        out.push({
          index: out.length,
          text: norm(own.map(textOf).join(" ")),
          checked: child.attrs?.checked === true,
        });
      }
      walk(child);
    }
  };
  walk(doc);
  return out;
}

/** Only the ones still open — what the rollup lists. */
export function openTasksInDoc(doc) {
  return tasksInDoc(doc).filter((t) => !t.checked && t.text);
}

/** Flip ONE checklist item, identified by index + text. Returns a NEW document (the input
 *  is never mutated) and whether anything actually moved. */
export function setTaskCheckedInDoc(doc, { index, text }, checked) {
  const want = norm(text);
  const items = tasksInDoc(doc);
  let target = -1;

  /* ⛔ THE INDEX IS ONLY TRUSTED WHEN IT STILL DESCRIBES THE ROW THE ROLLUP SHOWED — same
   * words AND still in the state we are changing away FROM. The second half is not
   * belt-and-braces: with two identical "Follow up" lines, one already ticked, an index that
   * merely matched by text would tick the DONE one and leave the open one on the list
   * forever. Requiring the state to differ makes the fallback below take over and find the
   * one the rollup was actually offering. */
  if (Number.isInteger(index) && items[index]
      && (!want || items[index].text === want)
      && items[index].checked !== checked) target = index;
  // The note moved under us. Fall back to the first item that still says the same thing AND
  // is still in the state we are changing away from.
  if (target < 0 && want) target = items.findIndex((t) => t.text === want && t.checked !== checked);
  if (target < 0) return { doc, changed: false };

  let seen = -1;
  const rewrite = (node) => {
    if (!node || typeof node !== "object") return node;
    if (!Array.isArray(node.content)) return node;
    const content = node.content.map((child) => {
      if (child?.type === "taskItem") {
        seen += 1;
        const mine = seen === target;
        const inner = rewrite(child);
        if (!mine) return inner;
        return { ...inner, attrs: { ...(inner.attrs || {}), checked } };
      }
      return rewrite(child);
    });
    return { ...node, content };
  };

  return { doc: rewrite(doc), changed: true };
}

/** Roll the open items of many pages into ONE list, in the order the pages were given.
 *
 *  `pages` is `[{ pageId, pageTitle, projectId, trail }]` and `bodies` is `pageId → doc`.
 *  Pure, so "which items appear, and in what order" is decided here and tested here rather
 *  than emerging from a component's render. */
export function rollUpOpenTasks(pages, bodies) {
  const out = [];
  for (const p of pages || []) {
    const doc = bodies?.[p.pageId];
    if (!doc) continue;
    for (const t of openTasksInDoc(doc)) {
      out.push({
        key: `${p.pageId}#${t.index}`,
        pageId: p.pageId,
        pageTitle: p.pageTitle,
        projectId: p.projectId ?? null,
        trail: p.trail || [],
        index: t.index,
        text: t.text,
      });
    }
  }
  return out;
}

/** Group a rolled-up list by project, for the Dashboard's all-projects view. Keeps the
 *  incoming order within each group and returns groups in first-seen order, so the list
 *  does not re-shuffle itself as items are ticked off. */
export function groupTasksByProject(tasks, projects = []) {
  const name = new Map((projects || []).map((p) => [p.id, p.name]));
  const groups = [];
  const byId = new Map();
  for (const t of tasks || []) {
    const key = t.projectId ?? "none";
    if (!byId.has(key)) {
      const g = { projectId: t.projectId ?? null, name: t.projectId ? (name.get(t.projectId) || "Project") : null, tasks: [] };
      byId.set(key, g);
      groups.push(g);
    }
    byId.get(key).tasks.push(t);
  }
  return groups;
}
