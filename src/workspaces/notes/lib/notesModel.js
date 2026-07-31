/* notesModel — the PURE notebook › section › page tree, and every structural op on it.
 *
 * WHAT LIVES HERE AND WHAT DELIBERATELY DOES NOT. This module owns the SHAPE of the
 * notes hierarchy and nothing else: no storage, no React, no editor. In particular the
 * tree does **not** hold page BODIES — a page node carries only `{ id, title }`. That
 * split is the load-bearing decision behind the whole module: the tree is one storage
 * key, and each page body is its own key (see lib/notesStore.js). One blob holding
 * every note would mean every keystroke's autosave rewrites every note ever written,
 * which gets slower for the rest of the notebook's life.
 *
 * PROJECT BINDING IS AT THE NOTEBOOK LEVEL, not the page. A notebook carries an
 * optional `projectId` (a Site Planner site-group id) or `null` for a loose notebook.
 * Binding the notebook makes "everything on Goose Creek" a one-line filter
 * (`visibleNotebooks`), and a LOOSE notebook is visible from inside EVERY project —
 * a scratch notebook you can't reach from where you're working is one you stop using.
 *
 * PURITY IS THE CONTRACT. Every exported mutator returns a NEW tree and never touches
 * its input (test/notesModel.test.js deep-freezes and asserts this). The tree is small
 * by construction — titles only — so these clone rather than share structure, which
 * makes the guarantee total instead of "total along the paths we remembered".
 */

export const NOTES_TREE_VERSION = 2;

/** How long a binned node is kept before its bodies and images are destroyed for real.
 *  Matched to the Site Planner's own bin (`storage.DELETED_RETENTION_DAYS`) on purpose:
 *  one product should not have two different answers to "how long do I have to change my
 *  mind?" (B1310). */
export const TRASH_RETENTION_DAYS = 30;

/* ---- ids ------------------------------------------------------------------------- */

let seq = 0;
/** Collision-resistant local id. Callers may pass explicit ids for determinism. */
export function newId(prefix = "n") {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

export const DEFAULT_NOTEBOOK_TITLE = "Untitled notebook";
export const DEFAULT_SECTION_TITLE = "Untitled section";
export const DEFAULT_PAGE_TITLE = "Untitled page";

/* ---- construction ---------------------------------------------------------------- */

export function emptyTree() {
  return { v: NOTES_TREE_VERSION, notebooks: [], trash: [] };
}

/* TIMESTAMPS LIVE ON THE PAGE NODE, AND NOWHERE ELSE (B1312). The tree is read on every
 * render and rewritten on a 400 ms debounce, so it stays titles-and-numbers only — two
 * integers per page is the whole cost. `null` is a REAL value here and means "unknown",
 * which is what every page written before this landed honestly is: a migrated page shows
 * no time rather than claiming it was edited the moment you upgraded. */
export function makePage({ id, title = DEFAULT_PAGE_TITLE, createdAt, updatedAt, at = Date.now() } = {}) {
  const born = Number.isFinite(createdAt) ? createdAt : at;
  return {
    id: id || newId("pg"),
    title: String(title),
    createdAt: born,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : born,
  };
}

export function makeSection({ id, title = DEFAULT_SECTION_TITLE, pages } = {}) {
  return { id: id || newId("sec"), title: String(title), pages: pages ? clone(pages) : [] };
}

/* A new notebook is BORN with one section and one page, so there is nothing to create
 * before typing. An empty notebook is a dead end that asks the user to do setup work
 * to reach the thing they came for. */
export function makeNotebook({ id, title = DEFAULT_NOTEBOOK_TITLE, projectId = null, ids = {}, at = Date.now() } = {}) {
  return {
    id: id || ids.notebook || newId("nb"),
    title: String(title),
    projectId: projectId == null ? null : String(projectId),
    sections: [makeSection({ id: ids.section, title: "Section 1", pages: [makePage({ id: ids.page, title: "Page 1", at })] })],
  };
}

/* ---- lookup (pure, non-throwing) -------------------------------------------------- */

export function findPage(tree, pageId) {
  for (const nb of tree?.notebooks || []) {
    for (const sec of nb.sections || []) {
      for (const pg of sec.pages || []) {
        if (pg.id === pageId) return { notebook: nb, section: sec, page: pg };
      }
    }
  }
  return null;
}

export function findSection(tree, sectionId) {
  for (const nb of tree?.notebooks || []) {
    for (const sec of nb.sections || []) if (sec.id === sectionId) return { notebook: nb, section: sec };
  }
  return null;
}

export function findNotebook(tree, notebookId) {
  return (tree?.notebooks || []).find((nb) => nb.id === notebookId) || null;
}

/** Every page id in the tree — the universe the store's orphan sweep is checked against. */
export function allPageIds(tree) {
  const out = [];
  for (const nb of tree?.notebooks || []) for (const sec of nb.sections || []) for (const pg of sec.pages || []) out.push(pg.id);
  return out;
}

/** The first page in the tree (reading order), or null. Used to pick a landing page. */
export function firstPageId(tree) {
  return allPageIds(tree)[0] || null;
}

/* ---- project visibility ----------------------------------------------------------- */

/** Notebooks visible from a given project: that project's own, PLUS every loose one.
 *  With no project selected (`null`) nothing is out of scope, so all are visible. */
export function visibleNotebooks(tree, projectId) {
  const list = tree?.notebooks || [];
  if (projectId == null) return list.slice();
  return list.filter((nb) => nb.projectId == null || nb.projectId === projectId);
}

/* ---- structural ops (all pure) ----------------------------------------------------- */

export function addNotebook(tree, { title, projectId = null, ids, at = Date.now() } = {}) {
  const next = clone(tree || emptyTree());
  const nb = makeNotebook({ title, projectId, ids, at });
  next.notebooks.push(nb);
  return { tree: next, notebook: nb, notebookId: nb.id, sectionId: nb.sections[0].id, pageId: nb.sections[0].pages[0].id };
}

export function addSection(tree, notebookId, { title, ids = {}, at = Date.now() } = {}) {
  const next = clone(tree);
  const nb = next.notebooks.find((n) => n.id === notebookId);
  if (!nb) return { tree: next, sectionId: null, pageId: null };
  // A new section is born with one page, same reasoning as a new notebook.
  const sec = makeSection({ id: ids.section, title: title || `Section ${nb.sections.length + 1}`, pages: [makePage({ id: ids.page, title: "Page 1", at })] });
  nb.sections.push(sec);
  return { tree: next, sectionId: sec.id, pageId: sec.pages[0].id };
}

export function addPage(tree, sectionId, { title, id, at = Date.now() } = {}) {
  const next = clone(tree);
  const hit = findSection(next, sectionId);
  if (!hit) return { tree: next, pageId: null };
  const pg = makePage({ id, title: title || `Page ${hit.section.pages.length + 1}`, at });
  hit.section.pages.push(pg);
  return { tree: next, pageId: pg.id };
}

/** Stamp a page as edited. Called from the ONE place a body write is known to have LANDED
 *  (the editor's flush, on `writePage` returning true) — never on a keystroke, so the field
 *  cannot claim a save that the storage layer refused. Returns the same tree object when
 *  the page is unknown, so a caller can skip a pointless write. */
export function touchPage(tree, pageId, at = Date.now()) {
  if (!findPage(tree, pageId)) return tree;
  const next = clone(tree);
  const hit = findPage(next, pageId);
  hit.page.updatedAt = at;
  if (!Number.isFinite(hit.page.createdAt)) hit.page.createdAt = at;
  return next;
}

/** Pages in most-recently-edited order, scoped by project visibility. A page whose time is
 *  unknown (written before timestamps existed) sorts last rather than pretending to be old
 *  or new — it simply has nothing to say. */
export function recentPages(tree, { projectId = null, limit = 40 } = {}) {
  const out = [];
  for (const nb of visibleNotebooks(tree, projectId)) {
    for (const sec of nb.sections || []) {
      for (const pg of sec.pages || []) {
        out.push({
          pageId: pg.id, pageTitle: pg.title, sectionId: sec.id, sectionTitle: sec.title,
          notebookId: nb.id, notebookTitle: nb.title,
          updatedAt: Number.isFinite(pg.updatedAt) ? pg.updatedAt : null,
          createdAt: Number.isFinite(pg.createdAt) ? pg.createdAt : null,
        });
      }
    }
  }
  out.sort((a, b) => (b.updatedAt ?? -1) - (a.updatedAt ?? -1));
  return out.slice(0, Math.max(0, limit));
}

/** Rename any node by id — notebook, section or page. Unknown id is a no-op clone. */
export function renameNode(tree, id, title) {
  const next = clone(tree);
  const t = String(title ?? "").trim();
  for (const nb of next.notebooks) {
    if (nb.id === id) { nb.title = t || DEFAULT_NOTEBOOK_TITLE; return next; }
    for (const sec of nb.sections) {
      if (sec.id === id) { sec.title = t || DEFAULT_SECTION_TITLE; return next; }
      for (const pg of sec.pages) if (pg.id === id) { pg.title = t || DEFAULT_PAGE_TITLE; return next; }
    }
  }
  return next;
}

/* ---- the bin (B1310) ----------------------------------------------------------------
 *
 * ⛔ DELETE IS A MOVE, NOT A DESTRUCTION — and TOMBSTONE-DELETES is intact, not weakened.
 * The full cascade of orphaned page ids is still computed at the moment of the delete,
 * by the same walk as before, and still returned to the caller. What changed is WHEN it
 * is executed: the caller now stores it on a trash ENTRY and clears the bodies at PURGE
 * time. Nothing can be resurrected in between, because the pages are out of the live tree
 * and no read path looks in `trash` — so a merge or a sync sees exactly what it saw
 * before. What the deferral buys is the thing the rest of Planyr already had and Notes
 * did not: one inline tick used to destroy a whole notebook forever, with no undo, no
 * bin, and no export-first prompt, while deleting a PROJECT bins it for 30 days.
 *
 * An ENTRY carries everything a restore needs and nothing it doesn't:
 *   { id, kind, node, parentId, index, title, deletedAt, pageIds }
 * `parentId` is the notebook for a section and the section for a page (null for a
 * notebook), `index` is where it sat, and `pageIds` IS the cascade set — so the purge
 * never has to re-walk a tree that no longer holds the node.
 */

const trashOf = (tree) => (Array.isArray(tree?.trash) ? tree.trash : []);

/** Every page id currently held IN THE BIN. The store's orphan sweep MUST union this with
 *  `allPageIds` — a binned page's body is deliberately still on disk, and a sweep that
 *  only knew about the live tree would call every one of them an orphan and destroy the
 *  bin's whole reason to exist. */
export function trashPageIds(tree) {
  const out = [];
  for (const e of trashOf(tree)) for (const id of e.pageIds || []) out.push(id);
  return out;
}

/** The bin, newest first, with each entry's expiry stamped on. */
export function trashEntries(tree, { days = TRASH_RETENTION_DAYS } = {}) {
  return trashOf(tree)
    .map((e) => ({ ...e, expiresAt: (e.deletedAt || 0) + days * 86400000, restorable: !!(e.kind && e.node) }))
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

/** Entry ids that have sat past the retention window. The caller purges each one. */
export function expiredTrashIds(tree, { now = Date.now(), days = TRASH_RETENTION_DAYS } = {}) {
  const cutoff = now - days * 86400000;
  return trashOf(tree).filter((e) => (e.deletedAt || 0) < cutoff).map((e) => e.id);
}

/** Delete any node by id: lift it out of the live tree, park it in the bin, and report
 *  the FULL cascade of orphaned page ids.
 *
 *  TOMBSTONE-DELETES: the caller MUST hold a body for every id in `removedPageIds` until
 *  the entry is purged, and MUST then clear every one of them — not just the node that
 *  was clicked. Deleting a notebook orphans every page under every one of its sections;
 *  the caller cannot compute that set itself without re-walking a tree it no longer has,
 *  so this returns it AND stamps it onto the entry. */
export function deleteNode(tree, id, { at = Date.now(), entryId } = {}) {
  const next = clone(tree);
  if (!Array.isArray(next.trash)) next.trash = [];
  const removedPageIds = [];

  const bin = (kind, node, parentId, index) => {
    const entry = { id: entryId || newId("tr"), kind, node, parentId, index, title: String(node.title || ""), deletedAt: at, pageIds: removedPageIds.slice() };
    next.trash.push(entry);
    return { tree: next, removedPageIds, kind, entry };
  };

  const nbIdx = next.notebooks.findIndex((n) => n.id === id);
  if (nbIdx > -1) {
    const [nb] = next.notebooks.splice(nbIdx, 1);
    for (const sec of nb.sections || []) for (const pg of sec.pages || []) removedPageIds.push(pg.id);
    return bin("notebook", nb, null, nbIdx);
  }

  for (const nb of next.notebooks) {
    const secIdx = nb.sections.findIndex((s) => s.id === id);
    if (secIdx > -1) {
      const [sec] = nb.sections.splice(secIdx, 1);
      for (const pg of sec.pages || []) removedPageIds.push(pg.id);
      return bin("section", sec, nb.id, secIdx);
    }
    for (const sec of nb.sections) {
      const pgIdx = sec.pages.findIndex((p) => p.id === id);
      if (pgIdx > -1) {
        const [pg] = sec.pages.splice(pgIdx, 1);
        removedPageIds.push(pg.id);
        return bin("page", pg, sec.id, pgIdx);
      }
    }
  }
  return { tree: next, removedPageIds, kind: null, entry: null };
}

/* A restore must never fail into nothing. If the place a node came from is itself in the
 * bin, that parent is restored FIRST (recursively); if it is gone for good, the node lands
 * in a clearly-named "Recovered notes" home rather than being refused. Refusing a restore
 * because a container disappeared would make the bin exactly as lossy as the delete it
 * replaced. */
const RECOVERED_TITLE = "Recovered notes";

function ensureRecoveredSection(tree, at) {
  let nb = tree.notebooks.find((n) => n.title === RECOVERED_TITLE);
  if (!nb) { nb = { id: newId("nb"), title: RECOVERED_TITLE, projectId: null, sections: [] }; tree.notebooks.push(nb); }
  if (!nb.sections.length) nb.sections.push({ id: newId("sec"), title: "Restored", pages: [] });
  return { notebook: nb, section: nb.sections[0], at };
}

/** Put a binned node back where it came from. Returns `{ tree, restored, pageIds }`;
 *  `restored` is null when the entry id is unknown (a double-click on Undo, say). */
export function restoreNode(tree, entryId, { at = Date.now() } = {}) {
  let next = clone(tree);
  if (!Array.isArray(next.trash)) next.trash = [];
  const idx = next.trash.findIndex((e) => e.id === entryId);
  if (idx < 0) return { tree: next, restored: null, pageIds: [] };

  const entry = next.trash[idx];

  // The parent is in the bin too — bring it back first, then retry against that tree.
  if (entry.parentId && !findNotebook(next, entry.parentId) && !findSection(next, entry.parentId)) {
    const parentEntry = next.trash.find((e) => e.node?.id === entry.parentId);
    if (parentEntry) {
      const up = restoreNode(next, parentEntry.id, { at });
      next = up.tree;
    }
  }

  const here = next.trash.findIndex((e) => e.id === entryId);
  if (here < 0) return { tree: next, restored: null, pageIds: [] };
  const e = next.trash[here];
  // A corrupted entry (see `migrateTrashEntry`) has page ids but no node: it can free its
  // bytes and nothing else. Refuse the restore honestly rather than splicing a null in.
  if (!e.kind || !e.node) return { tree: next, restored: null, pageIds: [] };
  next.trash.splice(here, 1);

  if (e.kind === "notebook") {
    next.notebooks.splice(clampIndex(e.index, next.notebooks.length), 0, e.node);
  } else if (e.kind === "section") {
    const nb = findNotebook(next, e.parentId) || next.notebooks[0] || ensureRecoveredSection(next, at).notebook;
    nb.sections.splice(clampIndex(e.index, nb.sections.length), 0, e.node);
  } else if (e.kind === "page") {
    const sec = findSection(next, e.parentId)?.section || ensureRecoveredSection(next, at).section;
    sec.pages.splice(clampIndex(e.index, sec.pages.length), 0, e.node);
  }
  return { tree: next, restored: e, pageIds: (e.pageIds || []).slice() };
}

/** Drop an entry from the bin for good and hand back the page ids whose bodies (and whose
 *  images) the caller must now destroy. This is the ONLY point at which a note's bytes are
 *  actually removed. */
export function purgeTrashEntry(tree, entryId) {
  const next = clone(tree);
  if (!Array.isArray(next.trash)) next.trash = [];
  const idx = next.trash.findIndex((e) => e.id === entryId);
  if (idx < 0) return { tree: next, pageIds: [] };
  const [e] = next.trash.splice(idx, 1);
  return { tree: next, pageIds: (e.pageIds || []).slice() };
}

/* Index clamping is shared so every move behaves the same at the bounds: a negative
 * index lands first, an over-long index lands last, and neither throws. */
const clampIndex = (i, len) => (Number.isFinite(i) ? Math.max(0, Math.min(Math.trunc(i), len)) : len);

/** Move a page into a section at an index (same section = reorder). */
export function movePage(tree, pageId, toSectionId, index) {
  const next = clone(tree);
  const from = findPage(next, pageId);
  const to = findSection(next, toSectionId);
  if (!from || !to) return next;
  const fromPages = from.section.pages;
  fromPages.splice(fromPages.indexOf(from.page), 1);
  to.section.pages.splice(clampIndex(index, to.section.pages.length), 0, from.page);
  return next;
}

/** Move a section into a notebook at an index (same notebook = reorder). */
export function moveSection(tree, sectionId, toNotebookId, index) {
  const next = clone(tree);
  const from = findSection(next, sectionId);
  const nb = next.notebooks.find((n) => n.id === toNotebookId);
  if (!from || !nb) return next;
  from.notebook.sections.splice(from.notebook.sections.indexOf(from.section), 1);
  nb.sections.splice(clampIndex(index, nb.sections.length), 0, from.section);
  return next;
}

/** Reorder a notebook within the tree. */
export function moveNotebook(tree, notebookId, index) {
  const next = clone(tree);
  const i = next.notebooks.findIndex((n) => n.id === notebookId);
  if (i < 0) return next;
  const [nb] = next.notebooks.splice(i, 1);
  next.notebooks.splice(clampIndex(index, next.notebooks.length), 0, nb);
  return next;
}

/** Re-bind a notebook to a project (or to `null` = loose). */
export function setNotebookProject(tree, notebookId, projectId) {
  const next = clone(tree);
  const nb = next.notebooks.find((n) => n.id === notebookId);
  if (nb) nb.projectId = projectId == null ? null : String(projectId);
  return next;
}

/* ---- search (titles only — bodies need storage, so they live in notesStore) -------- */

/** Case-insensitive page-TITLE search, scoped by project visibility. Pure. */
export function searchTitles(tree, query, { projectId = null } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const nb of visibleNotebooks(tree, projectId)) {
    for (const sec of nb.sections || []) {
      for (const pg of sec.pages || []) {
        if (String(pg.title || "").toLowerCase().includes(q)) {
          out.push({ pageId: pg.id, pageTitle: pg.title, sectionId: sec.id, sectionTitle: sec.title, notebookId: nb.id, notebookTitle: nb.title, where: "title" });
        }
      }
    }
  }
  return out;
}

/* ---- migration --------------------------------------------------------------------- */

/** Tolerant read of anything that claims to be a tree. Never throws, never returns
 *  null: junk, a missing key, a future version, a half-written object all resolve to a
 *  usable tree. A notes module that refuses to open because one field is the wrong type
 *  is worse than one that quietly drops the field. */
const num = (v) => (Number.isFinite(v) ? v : null);

/* A v1 page had no timestamps at all, and inventing one would be a lie the UI then repeats
 * for the life of the note. So a migrated page keeps `null` and the rail shows it no time.
 * This is ADDITIVE in both directions: a v2 tree read by an older build loses only the two
 * fields and the bin, and neither is load-bearing for opening a note. */
function migratePage(pg) {
  return {
    id: String(pg.id || newId("pg")),
    title: typeof pg.title === "string" ? pg.title : DEFAULT_PAGE_TITLE,
    createdAt: num(pg.createdAt),
    updatedAt: num(pg.updatedAt),
  };
}

function migrateSection(sec) {
  const pages = [];
  for (const pg of Array.isArray(sec.pages) ? sec.pages : []) {
    if (pg && typeof pg === "object") pages.push(migratePage(pg));
  }
  return { id: String(sec.id || newId("sec")), title: typeof sec.title === "string" ? sec.title : DEFAULT_SECTION_TITLE, pages };
}

function migrateNotebook(nb) {
  const sections = [];
  for (const sec of Array.isArray(nb.sections) ? nb.sections : []) {
    if (sec && typeof sec === "object") sections.push(migrateSection(sec));
  }
  return {
    id: String(nb.id || newId("nb")),
    title: typeof nb.title === "string" ? nb.title : DEFAULT_NOTEBOOK_TITLE,
    projectId: nb.projectId == null ? null : String(nb.projectId),
    sections,
  };
}

/* A trash entry whose node is unreadable is dropped rather than kept as a row that can
 * never restore anything. Its page ids are kept on a BODYLESS entry so the purge sweep
 * still frees the bytes — losing the ability to restore must never also leak storage. */
function migrateTrashEntry(e) {
  if (!e || typeof e !== "object") return null;
  const kind = e.kind === "notebook" || e.kind === "section" || e.kind === "page" ? e.kind : null;
  const pageIds = (Array.isArray(e.pageIds) ? e.pageIds : []).filter((x) => typeof x === "string");
  const base = {
    id: String(e.id || newId("tr")),
    kind,
    parentId: e.parentId == null ? null : String(e.parentId),
    index: Number.isFinite(e.index) ? e.index : 0,
    title: typeof e.title === "string" ? e.title : "",
    deletedAt: Number.isFinite(e.deletedAt) ? e.deletedAt : 0,
    pageIds,
  };
  if (!kind || !e.node || typeof e.node !== "object") return { ...base, kind: null, node: null };
  const node = kind === "notebook" ? migrateNotebook(e.node) : kind === "section" ? migrateSection(e.node) : migratePage(e.node);
  return { ...base, node };
}

export function migrate(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.notebooks)) return emptyTree();
  const notebooks = [];
  for (const nb of raw.notebooks) {
    if (!nb || typeof nb !== "object") continue;
    notebooks.push(migrateNotebook(nb));
  }
  const trash = [];
  for (const e of Array.isArray(raw.trash) ? raw.trash : []) {
    const m = migrateTrashEntry(e);
    if (m) trash.push(m);
  }
  return { v: NOTES_TREE_VERSION, notebooks, trash };
}
