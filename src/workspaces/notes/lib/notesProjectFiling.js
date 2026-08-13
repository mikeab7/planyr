/* notesProjectFiling — WHAT A PROJECT IS HOLDING, and how to move it (NEW-3).
 *
 * DELETING A PROJECT MUST SAY WHAT IT IS ABOUT TO ORPHAN. The note-delete confirmation
 * already does this well ("Delete 2?" … "Deleted DEV COORDINATION and its 2 pages. It is in
 * the bin for 30 days"), and project deletion did not: notes filed to a deleted project
 * simply reappeared later under a "from a project you deleted" heading, which is where the
 * owner found two of them a week afterwards. These two functions are the honest half of that
 * confirmation — one counts, one moves — and both are pure, so the count on screen and the
 * move that follows can never disagree about which notes are involved.
 *
 * ⛔ IT IS A LEAF WITH NO IMPORTS, AND THAT IS A MEASURED BUNDLE DECISION. The project-delete
 * confirmation lives in the shared header breadcrumb — chrome on EVERY route — so it reaches
 * these by a dynamic import. Reaching them through `notesModel.js` instead would drag the
 * whole model, including the one-way migration off the superseded four-level shape, into a
 * chunk shared across routes. `notesModel.js` re-exports both, so nothing else had to learn
 * they moved.
 *
 * The tree shape it reads is the v3 one: `{ pages: [root…], trash: [entry…] }`, `projectId`
 * on the ROOT and nowhere else.
 */

const rootsOf = (tree) => (Array.isArray(tree?.pages) ? tree.pages : []);
const kidsOf = (page) => (Array.isArray(page?.pages) ? page.pages : []);
const trashOf = (tree) => (Array.isArray(tree?.trash) ? tree.trash : []);
const clone = (v) => JSON.parse(JSON.stringify(v));

const subtreeIds = (page) => {
  const out = [];
  const go = (p) => { out.push(p.id); for (const k of kidsOf(p)) go(k); };
  if (page?.id) go(page);
  return out;
};

/** What a project is holding: its top-level notes, the FULL page count under them (a note
 *  with subpages is not one note), and the same for anything of its already in the bin. */
export function projectNoteCensus(tree, projectId) {
  const pid = projectId == null ? null : String(projectId);
  const roots = rootsOf(tree).filter((p) => (p.projectId ?? null) === pid);
  const pageIds = [];
  for (const r of roots) pageIds.push(...subtreeIds(r));
  let binnedPages = 0;
  let binnedNotes = 0;
  for (const e of trashOf(tree)) {
    if ((e?.projectId ?? null) !== pid) continue;
    binnedNotes += 1;
    binnedPages += (e.pageIds || []).length;
  }
  return {
    noteCount: roots.length,
    pageCount: pageIds.length,
    pageIds,
    titles: roots.map((r) => r.title),
    binnedNotes,
    binnedPages,
  };
}

/** Re-file every note of one project into another (or into no project). Covers the BIN
 *  entries too — a note restored after the project went would otherwise come back wearing
 *  the dead project's id, which is the orphan this exists to prevent, just delayed. */
export function moveProjectNotes(tree, fromProjectId, toProjectId = null) {
  const from = fromProjectId == null ? null : String(fromProjectId);
  const to = toProjectId == null ? null : String(toProjectId);
  const next = clone(tree && typeof tree === "object" ? tree : { v: 3, pages: [], trash: [] });
  let moved = 0;
  for (const p of rootsOf(next)) {
    if ((p.projectId ?? null) !== from) continue;
    p.projectId = to;
    moved += 1;
  }
  for (const e of trashOf(next)) {
    if ((e?.projectId ?? null) !== from) continue;
    e.projectId = to;
    if (e.node && e.node.projectId !== undefined) e.node.projectId = to;
  }
  return { tree: next, moved };
}

/** ⛔ THE ONE SHAPE THESE CANNOT ANSWER FOR. A device that has not opened Notes since the
 *  four-level model was collapsed still holds the OLD tree on disk, and the migration lives
 *  in `notesModel.js` — which this leaf deliberately does not import. Reading a legacy tree
 *  here would find no roots and report a confident ZERO, in a confirmation dialog, about
 *  notes that exist. So the caller asks first and says "couldn't check" instead. */
export const isLegacyTree = (raw) => !!raw && typeof raw === "object" && Array.isArray(raw.notebooks) && !Array.isArray(raw.pages);
