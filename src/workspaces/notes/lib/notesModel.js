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

export const NOTES_TREE_VERSION = 1;

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
  return { v: NOTES_TREE_VERSION, notebooks: [] };
}

export function makePage({ id, title = DEFAULT_PAGE_TITLE } = {}) {
  return { id: id || newId("pg"), title: String(title) };
}

export function makeSection({ id, title = DEFAULT_SECTION_TITLE, pages } = {}) {
  return { id: id || newId("sec"), title: String(title), pages: pages ? clone(pages) : [] };
}

/* A new notebook is BORN with one section and one page, so there is nothing to create
 * before typing. An empty notebook is a dead end that asks the user to do setup work
 * to reach the thing they came for. */
export function makeNotebook({ id, title = DEFAULT_NOTEBOOK_TITLE, projectId = null, ids = {} } = {}) {
  return {
    id: id || ids.notebook || newId("nb"),
    title: String(title),
    projectId: projectId == null ? null : String(projectId),
    sections: [makeSection({ id: ids.section, title: "Section 1", pages: [makePage({ id: ids.page, title: "Page 1" })] })],
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

export function addNotebook(tree, { title, projectId = null, ids } = {}) {
  const next = clone(tree || emptyTree());
  const nb = makeNotebook({ title, projectId, ids });
  next.notebooks.push(nb);
  return { tree: next, notebook: nb, notebookId: nb.id, sectionId: nb.sections[0].id, pageId: nb.sections[0].pages[0].id };
}

export function addSection(tree, notebookId, { title, ids = {} } = {}) {
  const next = clone(tree);
  const nb = next.notebooks.find((n) => n.id === notebookId);
  if (!nb) return { tree: next, sectionId: null, pageId: null };
  // A new section is born with one page, same reasoning as a new notebook.
  const sec = makeSection({ id: ids.section, title: title || `Section ${nb.sections.length + 1}`, pages: [makePage({ id: ids.page, title: "Page 1" })] });
  nb.sections.push(sec);
  return { tree: next, sectionId: sec.id, pageId: sec.pages[0].id };
}

export function addPage(tree, sectionId, { title, id } = {}) {
  const next = clone(tree);
  const hit = findSection(next, sectionId);
  if (!hit) return { tree: next, pageId: null };
  const pg = makePage({ id, title: title || `Page ${hit.section.pages.length + 1}` });
  hit.section.pages.push(pg);
  return { tree: next, pageId: pg.id };
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

/** Delete any node by id and report the FULL cascade of orphaned page ids.
 *
 *  TOMBSTONE-DELETES: the caller MUST clear a body for every id in `removedPageIds`,
 *  not just the one node it thought it was deleting. Deleting a notebook orphans every
 *  page under every one of its sections; the caller cannot compute that set itself
 *  without re-walking a tree it no longer has, so this returns it. */
export function deleteNode(tree, id) {
  const next = clone(tree);
  const removedPageIds = [];

  const nbIdx = next.notebooks.findIndex((n) => n.id === id);
  if (nbIdx > -1) {
    const [nb] = next.notebooks.splice(nbIdx, 1);
    for (const sec of nb.sections || []) for (const pg of sec.pages || []) removedPageIds.push(pg.id);
    return { tree: next, removedPageIds, kind: "notebook" };
  }

  for (const nb of next.notebooks) {
    const secIdx = nb.sections.findIndex((s) => s.id === id);
    if (secIdx > -1) {
      const [sec] = nb.sections.splice(secIdx, 1);
      for (const pg of sec.pages || []) removedPageIds.push(pg.id);
      return { tree: next, removedPageIds, kind: "section" };
    }
    for (const sec of nb.sections) {
      const pgIdx = sec.pages.findIndex((p) => p.id === id);
      if (pgIdx > -1) {
        const [pg] = sec.pages.splice(pgIdx, 1);
        removedPageIds.push(pg.id);
        return { tree: next, removedPageIds, kind: "page" };
      }
    }
  }
  return { tree: next, removedPageIds, kind: null };
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
export function migrate(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.notebooks)) return emptyTree();
  const notebooks = [];
  for (const nb of raw.notebooks) {
    if (!nb || typeof nb !== "object") continue;
    const sections = [];
    for (const sec of Array.isArray(nb.sections) ? nb.sections : []) {
      if (!sec || typeof sec !== "object") continue;
      const pages = [];
      for (const pg of Array.isArray(sec.pages) ? sec.pages : []) {
        if (!pg || typeof pg !== "object") continue;
        pages.push({ id: String(pg.id || newId("pg")), title: typeof pg.title === "string" ? pg.title : DEFAULT_PAGE_TITLE });
      }
      sections.push({ id: String(sec.id || newId("sec")), title: typeof sec.title === "string" ? sec.title : DEFAULT_SECTION_TITLE, pages });
    }
    notebooks.push({
      id: String(nb.id || newId("nb")),
      title: typeof nb.title === "string" ? nb.title : DEFAULT_NOTEBOOK_TITLE,
      projectId: nb.projectId == null ? null : String(nb.projectId),
      sections,
    });
  }
  return { v: NOTES_TREE_VERSION, notebooks };
}
