/* notesModel — the PURE page tree, and every structural op on it.
 *
 * ⛔ THE SHAPE, AND THE ONE SENTENCE THAT DEFINES IT (B1420, 2026-08-04, owner's decision,
 * verbatim: *"so i dont need a project to have multiple notebooks i dont think, like grand
 * port being its own notebook is great as long as i can have subpages there."*)
 *
 *   **THE PROJECT IS THE NOTEBOOK. There are exactly TWO concepts: a project, and PAGES
 *   THAT CAN HOLD SUBPAGES.**
 *
 * There is no notebook to pick and no separate species called a "section". "Entitlements"
 * is not a different KIND of thing from "Bonding" — it is simply a page that has pages under
 * it. **Anything can have children, at any depth.** That is precisely what OneNote cannot do
 * (its sections and pages are different types, and a page cannot nest under a page), so do
 * not reintroduce the distinction by the back door: no `kind` field, no depth ceiling, no
 * "container" flag. A page with children and a page without are the same node.
 *
 * ⛔ SUPERSEDED — kept so a future session cannot rebuild it from a stale comment. The old
 * model was FOUR levels, `project › notebook › section › page`, with the project binding on
 * the NOTEBOOK (B1374) and `addSection` / `moveSection` / `moveNotebook` / `setNotebookProject`
 * as its ops. It is gone. `migrate()` below converts it — that conversion is the ONLY code
 * in the module that may mention a notebook or a section, and it is one-way.
 *
 *   tree  = { v: 3, pages: [rootPage…], trash: [entry…] }
 *   page  = { id, title, createdAt, updatedAt, pages: [child…] }
 *   root  = a page in `tree.pages`; it ALSO carries `projectId` (a Site Planner site-group
 *           id, or `null` for "Not in a project").
 *
 * ⛔ `projectId` LIVES ON THE ROOT AND NOWHERE ELSE. A subpage's project is its root's,
 * DERIVED on demand (`projectOfPage`) and never stored. Storing it on every node would make
 * the same fact writable in N places, and redundant state updated by independent writes is
 * guaranteed to disagree eventually — the B1340 lesson, applied before it can cost anything.
 *
 * WHAT LIVES HERE AND WHAT DELIBERATELY DOES NOT. This module owns the SHAPE and nothing
 * else: no storage, no React, no editor. In particular the tree does **not** hold page
 * BODIES — a node carries only `{ id, title, timestamps, children }`. That split is the
 * load-bearing decision behind the whole module: the tree is one storage key and each page
 * body is its own key (see lib/notesStore.js). One blob holding every note would mean every
 * keystroke's autosave rewrites every note ever written.
 *
 * PURITY IS THE CONTRACT. Every exported mutator returns a NEW tree and never touches its
 * input (test/notesModel.test.js deep-freezes and asserts this). The tree is small by
 * construction — titles only — so these clone rather than share structure, which makes the
 * guarantee total instead of "total along the paths we remembered".
 */

export const NOTES_TREE_VERSION = 3;

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

export const DEFAULT_PAGE_TITLE = "Untitled page";
/** The home for pages that belong to no project — signed-out notes, and everything that
 *  was a loose notebook. It is a real place with the same shape as a project's pages, not a
 *  holding pen: nothing about a page changes by being here. */
export const NO_PROJECT = null;
export const NO_PROJECT_LABEL = "Not in a project";

/* ---- construction ---------------------------------------------------------------- */

export function emptyTree() {
  return { v: NOTES_TREE_VERSION, pages: [], trash: [], tombs: [] };
}

/** How long a purge is REMEMBERED. Far longer than the bin's own 30 days, because the job of
 *  a tombstone is to outlive every copy of the thing it buried: a device that has been asleep
 *  for a month must still be told, on the day it wakes up, that this was deleted for real. */
export const TOMB_RETENTION_DAYS = 400;

/** ⛔ A PURGE IS A FACT, NOT AN ABSENCE — and this list is where that fact lives.
 *
 * THE BUG IT CLOSES, measured on the owner's account with revisions. He emptied the bin; the
 * cloud tree went to rev 991 holding ONE entry. A tab that had been open a while was still on
 * rev 966 with all 23 entries and unpushed edits of its own. It reloaded, merged — and the
 * merge is a UNION, in which an addition wins and a deletion is merely the absence of an
 * entry. **Absence loses to any copy that still has it.** All 23 came back, and the stale tab
 * then PUSHED the resurrection up as rev 992 and overwrote the good state. So emptying the bin
 * could not stick as long as any other window had not yet seen it.
 *
 * A tombstone turns the deletion into something that can WIN a union. It records the ids a
 * purge destroyed, so the merge can refuse to re-add them however many copies still exist.
 * This is TOMBSTONE-DELETES, which the rest of the product has had since B276 and Notes did
 * not.
 *
 * It records the ENTRY id and every PAGE id the entry named, in one flat list, because both
 * kinds can be resurrected by the same union and both must be refused. */
export function tombstoneIds(tree) {
  const out = new Set();
  for (const t of Array.isArray(tree?.tombs) ? tree.tombs : []) {
    if (t && t.id) out.add(String(t.id));
  }
  return out;
}

/** Add tombstones, keeping one row per id and dropping any that have outlived their purpose. */
export function withTombstones(tree, ids, { at = Date.now() } = {}) {
  const next = { ...tree };
  const cutoff = at - TOMB_RETENTION_DAYS * 86400000;
  const byId = new Map();
  for (const t of Array.isArray(tree?.tombs) ? tree.tombs : []) {
    if (!t || !t.id) continue;
    if (Number.isFinite(t.at) && t.at < cutoff) continue;
    byId.set(String(t.id), { id: String(t.id), at: Number.isFinite(t.at) ? t.at : at });
  }
  for (const id of ids || []) {
    if (!id) continue;
    if (!byId.has(String(id))) byId.set(String(id), { id: String(id), at });
  }
  next.tombs = [...byId.values()];
  return next;
}

/* TIMESTAMPS LIVE ON THE PAGE NODE, AND NOWHERE ELSE (B1312). The tree is read on every
 * render and rewritten on a short debounce, so it stays titles-and-numbers only. `null` is a
 * REAL value here and means "unknown", which is what every page written before timestamps
 * existed honestly is: it shows no time rather than claiming it was edited the moment you
 * upgraded. */
/* ⛔ A BLANK TITLE BECOMES THE DEFAULT **HERE**, AT THE ONE CONSTRUCTOR, NOT AT EACH CALLER
 * (NEW-1). Every caller used `title || DEFAULT_PAGE_TITLE`, which lets `"   "` straight
 * through — truthy, and invisible in the rail, so the row renders as a blank line and the
 * note reads as lost when it is merely unnamed. Found by the titleless-node sweep below
 * rather than by inspection. Doing it once, at construction, is what makes "no path can mint
 * an unnamed page" a property instead of a habit.
 *
 * ⛔ AND IT IS ONLY A DISPLAY DEFAULT. A title is NEVER load-bearing for identity or for
 * reachability anywhere in Notes — identity is the id, full stop (see the header of
 * notesStore.js). A node whose title is null, undefined, empty or whitespace survives every
 * path in this module intact; test/notesReachability.test.js runs all five falsy values
 * through eleven of them. Nothing here may start keying, filtering or deduping on a title. */
export function makePage({ id, title = DEFAULT_PAGE_TITLE, createdAt, updatedAt, at = Date.now(), pages, projectId } = {}) {
  const born = Number.isFinite(createdAt) ? createdAt : at;
  const named = String(title ?? "");
  const node = {
    id: id || newId("pg"),
    title: named.trim() ? named : DEFAULT_PAGE_TITLE,
    createdAt: born,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : born,
    pages: pages ? clone(pages) : [],
  };
  if (projectId !== undefined) node.projectId = projectId == null ? null : String(projectId);
  return node;
}

/* ---- walking (pure, non-throwing) -------------------------------------------------- */

const rootsOf = (tree) => (Array.isArray(tree?.pages) ? tree.pages : []);
const kidsOf = (page) => (Array.isArray(page?.pages) ? page.pages : []);

/** Depth-first walk. `fn(page, { parent, root, depth })`; return `false` to stop descending. */
export function walkPages(tree, fn) {
  const go = (page, parent, root, depth) => {
    if (fn(page, { parent, root, depth }) === false) return;
    for (const kid of kidsOf(page)) go(kid, page, root, depth + 1);
  };
  for (const r of rootsOf(tree)) go(r, null, r, 0);
}

/** Find a page anywhere in the tree. Returns `{ page, parent, root, depth }` or null.
 *  `parent` is null for a root. */
export function findPage(tree, pageId) {
  let hit = null;
  walkPages(tree, (page, ctx) => {
    if (hit) return false;
    if (page.id === pageId) { hit = { page, ...ctx }; return false; }
    return undefined;
  });
  return hit;
}

/** Every page id in the tree, in reading order — the universe the store's orphan sweep is
 *  checked against. */
export function allPageIds(tree) {
  const out = [];
  walkPages(tree, (p) => { out.push(p.id); });
  return out;
}

/** Every page id in one page's SUBTREE, itself included. This IS the delete cascade set. */
export function subtreePageIds(page) {
  const out = [];
  const go = (p) => { out.push(p.id); for (const k of kidsOf(p)) go(k); };
  if (page?.id) go(page);
  return out;
}

/** Everything a delete takes BESIDES the page you clicked.
 *
 *  ⛔ THE CASCADE SET IS NOT THE COUNT TO SHOW A PERSON (NEW-4). `subtreePageIds` includes the
 *  node itself, because that is what a DELETE needs — every body to clear. Rendering that same
 *  number as "and its N pages" counts the note you are deleting as one of its own subpages, so
 *  a page with a single child announced itself as "Delete 2?" and then "and its 2 pages". An
 *  inflated count is not a cosmetic problem: it is how somebody is led to believe they lost
 *  something they did not, which is exactly what sent a session chasing a phantom.
 *
 *  There is deliberately no "section" here to name. B1420 removed that species on purpose — an
 *  empty parent is a PAGE with children, not a different kind of thing — so the honest word for
 *  what else goes is SUBPAGES, at any depth. */
export function descendantPageIds(page) {
  return subtreePageIds(page).slice(1);
}

/** "and its 2 subpages", or an empty string when the page stands alone. One phrasing, used by
 *  the confirmation, the undo bar and the tests, so they cannot drift. */
export function subpagesPhrase(count) {
  const n = Number(count) || 0;
  if (n <= 0) return "";
  return `its ${n} ${n === 1 ? "subpage" : "subpages"}`;
}

/** The first page in reading order, or null. Used to pick a landing page. */
export function firstPageId(tree) {
  return allPageIds(tree)[0] || null;
}

/** The ids of every ancestor of a page, root first — what "open the path to the page I am
 *  on, and leave everything else shut" needs. Excludes the page itself. */
export function ancestorIds(tree, pageId) {
  const chain = [];
  const go = (page, trail) => {
    if (page.id === pageId) { chain.push(...trail); return true; }
    for (const k of kidsOf(page)) if (go(k, [...trail, page.id])) return true;
    return false;
  };
  for (const r of rootsOf(tree)) if (go(r, [])) break;
  return chain;
}

/** Which project a page belongs to — DERIVED from its root, never stored on the page. */
export function projectOfPage(tree, pageId) {
  const hit = findPage(tree, pageId);
  return hit ? (hit.root.projectId ?? null) : null;
}

/* ---- project scoping ----------------------------------------------------------------
 *
 * ⛔ WHAT A PAGE WITH NO PROJECT DOES — DECIDED, IN WRITING.
 * Standing INSIDE a project you see that project's pages and nothing else: everything on
 * screen belongs to where you are standing, which is what lets the rail drop the per-row
 * project badge entirely. Pages with no project live in their own named group, reachable
 * from the Dashboard — which shows EVERY project's pages, grouped, and is one click away
 * from the header crumb on every screen. That click is what keeps B1374's guarantee
 * ("nothing can become unreachable") true; do not remove it.
 */

export const SCOPE_PROJECT = "project";
export const SCOPE_ALL = "all";

/** The ROOT pages the rail should show. Inside a project (and in the default scope) that is
 *  exactly that project's roots; `SCOPE_ALL`, or no project at all, is every root. */
export function pagesInScope(tree, projectId, scope = SCOPE_PROJECT) {
  const roots = rootsOf(tree);
  if (scope === SCOPE_ALL || projectId == null) return roots.slice();
  return roots.filter((p) => (p.projectId ?? null) === projectId);
}

/** The Dashboard's shape: every root page grouped by the project it belongs to, in the order
 *  the projects were given, with the no-project group LAST. A group is emitted only when it
 *  has pages, so an account with one project sees one heading rather than a directory.
 *
 *  `projects` is `[{ id, name }]`; a page bound to an id that is not in that list still gets
 *  a group — named by the caller, never silently folded into "no project", because losing
 *  the binding is how a page becomes hard to find. */
export function projectGroups(tree, projects = []) {
  const byId = new Map((projects || []).filter(Boolean).map((p) => [p.id, p]));
  const order = [];
  const groups = new Map();
  const put = (key, page) => {
    if (!groups.has(key)) { groups.set(key, []); order.push(key); }
    groups.get(key).push(page);
  };
  for (const p of rootsOf(tree)) put(p.projectId ?? " none", p);
  const out = [];
  for (const key of order) {
    if (key === " none") continue;
    out.push({ projectId: key, name: byId.get(key)?.name || null, resolved: byId.has(key), pages: groups.get(key) });
  }
  if (groups.has(" none")) {
    out.push({ projectId: null, name: NO_PROJECT_LABEL, resolved: true, pages: groups.get(" none") });
  }
  return out;
}

/** Every project id any root page claims, in tree order. Lets a caller tell an id that
 *  resolves to a real project from one that no longer does, without guessing. */
export function boundProjectIds(tree) {
  const out = [];
  for (const p of rootsOf(tree)) {
    const pid = p.projectId ?? null;
    if (pid != null && !out.includes(pid)) out.push(pid);
  }
  return out;
}

/* ---- structural ops (all pure) ----------------------------------------------------- */

/** Add a page. With no `parentId` it becomes a ROOT page in `projectId` — which is what
 *  makes "a page created inside a project is filed there automatically" true with no extra
 *  step. With a `parentId` it becomes that page's LAST child, and its project is its root's
 *  by construction (nothing to pass, nothing to get wrong). */
export function addPage(tree, { parentId = null, projectId = null, title, id, at = Date.now() } = {}) {
  const next = clone(tree || emptyTree());
  if (!Array.isArray(next.pages)) next.pages = [];
  if (parentId == null) {
    const pg = makePage({ id, title: title || DEFAULT_PAGE_TITLE, at, projectId });
    next.pages.push(pg);
    return { tree: next, pageId: pg.id };
  }
  const hit = findPage(next, parentId);
  if (!hit) return { tree: next, pageId: null };
  const pg = makePage({ id, title: title || DEFAULT_PAGE_TITLE, at });
  if (!Array.isArray(hit.page.pages)) hit.page.pages = [];
  hit.page.pages.push(pg);
  return { tree: next, pageId: pg.id };
}

/** Stamp a page as edited. Called from the ONE place a body write is known to have LANDED
 *  (the editor's flush, on `writePage` returning true) — never on a keystroke, so the field
 *  cannot claim a save the storage layer refused. Returns the same tree object when the page
 *  is unknown, so a caller can skip a pointless write. */
export function touchPage(tree, pageId, at = Date.now()) {
  if (!findPage(tree, pageId)) return tree;
  const next = clone(tree);
  const hit = findPage(next, pageId);
  hit.page.updatedAt = at;
  if (!Number.isFinite(hit.page.createdAt)) hit.page.createdAt = at;
  return next;
}

/** Rename any page by id. Unknown id is a no-op clone. */
export function renameNode(tree, id, title) {
  const next = clone(tree);
  const hit = findPage(next, id);
  if (hit) hit.page.title = String(title ?? "").trim() || DEFAULT_PAGE_TITLE;
  return next;
}

/* Index clamping is shared so every move behaves the same at the bounds: a negative index
 * lands first, an over-long index lands last, and neither throws. */
const clampIndex = (i, len) => (Number.isFinite(i) ? Math.max(0, Math.min(Math.trunc(i), len)) : len);

/** Move a page — reorder among its siblings, nest it under another page, or lift it to root.
 *
 *  ⛔ A PAGE MAY NOT BE MOVED INTO ITS OWN SUBTREE. That would detach the whole branch from
 *  the tree in one operation — every page under it still exists in the object graph and is
 *  reachable from nowhere, which is the exact "renders in no scope" bug this model must not
 *  create. The move is REFUSED (returns the tree unchanged) rather than silently repaired.
 *
 *  `toParentId === null` means root. A page moved to root needs a project: `projectId` is
 *  used when given, otherwise it keeps the project of the root it came from. */
export function movePage(tree, pageId, toParentId = null, index, { projectId } = {}) {
  const next = clone(tree);
  const from = findPage(next, pageId);
  if (!from) return next;

  if (toParentId != null) {
    const to = findPage(next, toParentId);
    if (!to) return next;
    if (toParentId === pageId) return next;
    if (subtreePageIds(from.page).includes(toParentId)) return next;   // into its own subtree — refused
  }

  const wasProject = from.root.projectId ?? null;
  // Detach.
  const siblings = from.parent ? from.parent.pages : next.pages;
  siblings.splice(siblings.indexOf(from.page), 1);
  const node = from.page;

  if (toParentId == null) {
    node.projectId = projectId !== undefined ? (projectId == null ? null : String(projectId)) : wasProject;
    next.pages.splice(clampIndex(index, next.pages.length), 0, node);
  } else {
    delete node.projectId;                       // a child's project is its root's, derived
    const to = findPage(next, toParentId);
    if (!Array.isArray(to.page.pages)) to.page.pages = [];
    to.page.pages.splice(clampIndex(index, to.page.pages.length), 0, node);
  }
  return next;
}

/** Re-bind a ROOT page to a project (or to `null` = not in a project). A non-root id is a
 *  no-op: a subpage's project is its root's, and letting a child claim a different one is
 *  exactly the redundant-state trap this model exists to avoid. */
export function setPageProject(tree, pageId, projectId) {
  const next = clone(tree);
  const root = next.pages.find((p) => p.id === pageId);
  if (root) root.projectId = projectId == null ? null : String(projectId);
  return next;
}

/** The suffix that makes a copy READ as a copy in the rail, without a second field to keep
 *  in step with the title. */
export const COPY_SUFFIX = "(copy)";

/** ⛔ THE ONE WAY A PAGE IS COPIED — AND IT TAKES NO `projectId`, BY CONSTRUCTION (NEW-1).
 *
 *  A PAGE'S PROJECT IS A PROPERTY OF THE PAGE, NEVER OF WHOEVER HAPPENS TO BE LOOKING AT IT.
 *  Every copy this module makes is a copy of a page that is already IN the tree, so its home
 *  is knowable from the record: the copy lands as the SOURCE'S NEXT SIBLING — under the same
 *  parent when the source has one (its project is then its root's, derived, and there is
 *  nothing to pass and nothing to get wrong), and at the top level of the SOURCE ROOT'S OWN
 *  project when the source is a root itself.
 *
 *  There is deliberately no way to say "put the copy over there". A caller that could pass a
 *  project would eventually pass the one it happens to be showing — which is exactly how a
 *  note gets copied into an unrelated pursuit and nobody notices for a week.
 *
 *  An UNKNOWN source is REFUSED and named (`refused: "unknown-source"`), never quietly filed
 *  somewhere plausible: a copy with no source has no project, and guessing one is the bug.
 *  The tree comes back untouched so a caller can report the refusal without having to undo. */
export function copyPageWithin(tree, sourcePageId, { title, id, at = Date.now() } = {}) {
  const base = tree || emptyTree();
  const next = clone(base);
  const hit = findPage(next, sourcePageId);
  if (!hit) return { tree: base, pageId: null, projectId: null, refused: "unknown-source" };

  const projectId = hit.root.projectId ?? null;
  const name = String(title ?? "").trim() || `${hit.page.title} ${COPY_SUFFIX}`;
  // A SUBPAGE copy carries no `projectId` at all — its root's is the only answer, and storing
  // a second one is the redundant-state trap this model exists to avoid.
  const pg = hit.parent
    ? makePage({ id, title: name, at })
    : makePage({ id, title: name, at, projectId });

  const siblings = hit.parent
    ? (Array.isArray(hit.parent.pages) ? hit.parent.pages : (hit.parent.pages = []))
    : next.pages;
  siblings.splice(siblings.indexOf(hit.page) + 1, 0, pg);
  return { tree: next, pageId: pg.id, projectId, refused: null };
}

/* ---- nothing may exist without a home (NEW-1) -------------------------------------------
 *
 * ⛔ THE GUARANTEE THIS MODULE OWES, STATED AS A PROPERTY: **every stored page body has a node
 * in this tree — live or in the bin.** It was true of notebooks and it was never enforced for
 * bodies, and the gap cost a real note: 215 revisions of the owner's Bain meeting notes,
 * healthy in storage and in the cloud, with no node in either tree and nothing in the bin
 * naming it. Not destroyed. UNREACHABLE, which is worse, because nothing could say so.
 *
 * `adoptUnreachable` is the SELF-HEALING half. The detector finds a body with no node; this
 * gives it one, in a place a person can actually see, without inventing a single fact:
 *
 *   • THE HOME IS NAMED AND REAL — a top-level page called "Recovered notes", in NO project.
 *     It is found by title-and-shape and reused, so a second run adds to it rather than
 *     making a second one.
 *   • THE PROJECT IS NEVER GUESSED. Which project the note belonged to is precisely the fact
 *     that was lost with its node. "Not in a project" is a real, named place; a guess is the
 *     defect this whole family of items exists to make impossible.
 *   • THE TITLE IS NOT INVENTED EITHER. The title lived on the node, so it is gone. The
 *     recovered page is named from the first words the person actually wrote, and the
 *     workspace says out loud that the original name was lost — a plausible-looking title
 *     would be a small lie told at exactly the wrong moment.
 *   • THE BODY IS NOT TOUCHED. This adds a node and nothing else. The document is theirs.
 */
/** Name a recovered page from its own first words — never from a guess. */
export function recoveredTitle(firstLine) {
  const words = String(firstLine || "").replace(/\s+/g, " ").trim();
  if (!words) return "Recovered note (name lost)";
  return `Recovered — ${words.slice(0, 48)}${words.length > 48 ? "…" : ""}`;
}

/** Give every unreachable body a node, at the TOP LEVEL, in no project.
 *
 *  `orphans` is `[{ pageId, firstLine, createdAt }]` from `unreachableNotes`. Returns the new
 *  tree and what it adopted — so the caller can say so rather than healing in a silence
 *  indistinguishable from the failure itself.
 *
 *  ⛔ THERE IS NO "RECOVERED" CONTAINER NODE, AND THAT IS A DELIBERATE REVERSAL. A grouping
 *  page would have to be found again on the next run, and the only thing available to find it
 *  by is its TITLE — which would make a title load-bearing for identity in the one code path
 *  whose entire job is repairing a reachability failure. The same item forbids exactly that
 *  (see the header of notesStore.js). Top-level pages in the named "Not in a project" home are
 *  just as visible — the Dashboard groups them under that heading — and every lookup here
 *  stays keyed on the id, which is the only thing that identifies a page. */
export function adoptUnreachable(tree, orphans = [], { at = Date.now() } = {}) {
  const list = (orphans || []).filter((o) => o?.pageId);
  if (!list.length) return { tree, adopted: [] };
  const known = new Set(allPageIds(tree));
  for (const e of trashOfSafe(tree)) for (const id of e?.pageIds || []) known.add(id);
  const fresh = list.filter((o) => !known.has(o.pageId));
  if (!fresh.length) return { tree, adopted: [] };

  const next = clone(tree || emptyTree());
  if (!Array.isArray(next.pages)) next.pages = [];
  const adopted = [];
  for (const o of fresh) {
    // The page keeps its OWN id, so this re-attaches the existing body rather than copying it.
    const node = makePage({
      id: o.pageId,
      title: recoveredTitle(o.firstLine || o.preview),
      at,
      createdAt: Number.isFinite(o.createdAt) ? o.createdAt : at,
      projectId: null,
    });
    next.pages.push(node);
    adopted.push({ pageId: node.id, title: node.title });
  }
  return { tree: next, adopted };
}

/* `trashOf` is declared further down (the bin section owns it); this is the same read, safe to
 * use above that point. Kept tiny and local rather than hoisting the bin section up here. */
const trashOfSafe = (tree) => (Array.isArray(tree?.trash) ? tree.trash : []);

/** `pageId → projectId` for every LIVE page, at every depth — the one answer to "which
 *  project does this page belong to?" asked of a whole tree at once. The duplicate detector
 *  and the copy invariant both read it, so neither has to re-derive the derivation rule. */
export function pageProjectIndex(tree) {
  const out = new Map();
  walkPages(tree, (pg, { root }) => { out.set(pg.id, root.projectId ?? null); });
  return out;
}

/* ---- the bin (B1310) ----------------------------------------------------------------
 *
 * ⛔ DELETE IS A MOVE, NOT A DESTRUCTION — and TOMBSTONE-DELETES is intact, not weakened.
 * The full cascade of orphaned page ids is still computed at the moment of the delete, by
 * the same walk as before, and still returned to the caller. What changed is WHEN it is
 * executed: the caller stores it on a trash ENTRY and clears the bodies at PURGE time.
 * Nothing can be resurrected in between, because the pages are out of the live tree and no
 * read path looks in `trash`.
 *
 * ⛔ AND THE CASCADE IS NOW THE WHOLE SUBTREE, AT ANY DEPTH. Deleting a page takes every
 * page under it, however deep — `subtreePageIds` is the one walk that answers it, and it is
 * what the entry carries so a restore brings the branch back WHOLE.
 *
 * An ENTRY carries everything a restore needs and nothing it doesn't:
 *   { id, kind: "page", node, parentId, index, projectId, title, deletedAt, pageIds }
 * `parentId` is the parent page (null when it was a root), `index` is where it sat,
 * `projectId` is the root's project (so a deleted root returns to the right project even if
 * every other page in it has gone), and `pageIds` IS the cascade set.
 */

const trashOf = (tree) => (Array.isArray(tree?.trash) ? tree.trash : []);

/** Every page id currently held IN THE BIN. The store's orphan sweep MUST union this with
 *  `allPageIds` — a binned page's body is deliberately still on disk, and a sweep that only
 *  knew about the live tree would call every one of them an orphan and destroy the bin's
 *  whole reason to exist. */
export function trashPageIds(tree) {
  const out = [];
  for (const e of trashOf(tree)) for (const id of e.pageIds || []) out.push(id);
  return out;
}

/* WHAT A PROJECT IS HOLDING (NEW-3) lives in its own leaf, `notesProjectFiling.js`, and is
 * re-exported here so this module stays the one place the tree's shape is reasoned about.
 * The split is a measured BUNDLE decision, not a taxonomy one: the project-delete
 * confirmation lives in the shared header breadcrumb — chrome on every route — and reaches
 * these two functions by a dynamic import. Pointing that import at this file would drag the
 * whole model (and the one-way migration) into a chunk shared with every route. */
export { projectNoteCensus, moveProjectNotes } from "./notesProjectFiling.js";

/** The bin, newest first, with each entry's expiry stamped on. */
export function trashEntries(tree, { days = TRASH_RETENTION_DAYS } = {}) {
  return trashOf(tree)
    .map((e) => ({ ...e, expiresAt: (e.deletedAt || 0) + days * 86400000, restorable: !!e.node }))
    .sort((a, b) => (b.deletedAt || 0) - (a.deletedAt || 0));
}

/** Entry ids that have sat past the retention window. The caller purges each one. */
export function expiredTrashIds(tree, { now = Date.now(), days = TRASH_RETENTION_DAYS } = {}) {
  const cutoff = now - days * 86400000;
  return trashOf(tree).filter((e) => (e.deletedAt || 0) < cutoff).map((e) => e.id);
}

/** Delete a page and its whole subtree: lift it out of the live tree, park it in the bin,
 *  and report the FULL cascade of orphaned page ids.
 *
 *  TOMBSTONE-DELETES: the caller MUST hold a body for every id in `removedPageIds` until the
 *  entry is purged, and MUST then clear every one of them — not just the page that was
 *  clicked. */
export function deleteNode(tree, id, { at = Date.now(), entryId } = {}) {
  const next = clone(tree);
  if (!Array.isArray(next.trash)) next.trash = [];
  const hit = findPage(next, id);
  if (!hit) return { tree: next, removedPageIds: [], entry: null };

  const removedPageIds = subtreePageIds(hit.page);
  const siblings = hit.parent ? hit.parent.pages : next.pages;
  const index = siblings.indexOf(hit.page);
  const projectId = hit.root.projectId ?? null;
  siblings.splice(index, 1);

  const entry = {
    id: entryId || newId("tr"),
    kind: "page",
    node: hit.page,
    parentId: hit.parent ? hit.parent.id : null,
    index,
    projectId,
    title: String(hit.page.title || ""),
    deletedAt: at,
    pageIds: removedPageIds,
  };
  next.trash.push(entry);
  return { tree: next, removedPageIds, entry };
}

/** Put a binned page back where it came from, subtree and all.
 *
 *  A restore must never fail into nothing. If the page it hung under is itself in the bin,
 *  that parent is restored FIRST (recursively); if the parent is gone for good the page
 *  lands at ROOT, in the project it was deleted from — visible, rather than refused.
 *  Refusing a restore because a container disappeared would make the bin exactly as lossy as
 *  the delete it replaced.
 *
 *  Returns `{ tree, restored, pageIds }`; `restored` is null when the entry id is unknown
 *  (a double-click on Undo, say). */
export function restoreNode(tree, entryId, { at = Date.now() } = {}) {
  let next = clone(tree);
  if (!Array.isArray(next.trash)) next.trash = [];
  const idx = next.trash.findIndex((e) => e.id === entryId);
  if (idx < 0) return { tree: next, restored: null, pageIds: [] };

  const entry = next.trash[idx];
  // The parent is in the bin too — bring it back first, then retry against that tree.
  if (entry.parentId && !findPage(next, entry.parentId)) {
    const parentEntry = next.trash.find((e) => (e.pageIds || []).includes(entry.parentId));
    if (parentEntry && parentEntry.id !== entryId) {
      next = restoreNode(next, parentEntry.id, { at }).tree;
      // Restoring the parent may have brought this page back with it (it was in that
      // subtree), in which case this entry is already satisfied.
      if (findPage(next, entry.node?.id)) {
        const gone = next.trash.findIndex((e) => e.id === entryId);
        if (gone > -1) next.trash.splice(gone, 1);
        return { tree: next, restored: entry, pageIds: (entry.pageIds || []).slice() };
      }
    }
  }

  const here = next.trash.findIndex((e) => e.id === entryId);
  if (here < 0) return { tree: next, restored: null, pageIds: [] };
  const e = next.trash[here];
  // A corrupted entry (see `migrateTrashEntry`) has page ids but no node: it can free its
  // bytes and nothing else. Refuse the restore honestly rather than splicing a null in.
  if (!e.node || typeof e.node !== "object") return { tree: next, restored: null, pageIds: [] };
  next.trash.splice(here, 1);

  const node = e.node;
  const parent = e.parentId ? findPage(next, e.parentId) : null;
  if (parent) {
    delete node.projectId;
    if (!Array.isArray(parent.page.pages)) parent.page.pages = [];
    parent.page.pages.splice(clampIndex(e.index, parent.page.pages.length), 0, node);
  } else {
    node.projectId = e.projectId == null ? null : String(e.projectId);
    /* It came from root → back to its old slot. It came from a parent that is gone for good
     * → append, because its recorded index belonged to a list that no longer exists. */
    next.pages.splice(e.parentId ? next.pages.length : clampIndex(e.index, next.pages.length), 0, node);
  }
  return { tree: next, restored: e, pageIds: (e.pageIds || []).slice() };
}

/** Drop an entry from the bin for good and hand back the page ids whose bodies (and whose
 *  images) the caller must now destroy. This is the ONLY point at which a note's bytes are
 *  actually removed. */
export function purgeTrashEntry(tree, entryId, { at = Date.now() } = {}) {
  const next = clone(tree);
  if (!Array.isArray(next.trash)) next.trash = [];
  const idx = next.trash.findIndex((e) => e.id === entryId);
  if (idx < 0) return { tree: next, pageIds: [] };
  const [e] = next.trash.splice(idx, 1);
  const pageIds = (e.pageIds || []).slice();
  /* ⛔ THE PURGE IS RECORDED, NOT JUST PERFORMED — read `tombstoneIds`' header for the
   * measured resurrection this closes. The entry id AND every page id it named, because a
   * union merge can bring either back. */
  return { tree: withTombstones(next, [entryId, e?.node?.id, ...pageIds], { at }), pageIds };
}

/* ---- listing + search --------------------------------------------------------------- */

/** A page's trail of ancestor titles, root first, for a search hit or a Recent row — the
 *  "where is this?" that a flat list otherwise leaves you to guess. */
function trailOf(tree, pageId) {
  return ancestorIds(tree, pageId).map((id) => findPage(tree, id)?.page?.title).filter(Boolean);
}

/** Pages in most-recently-edited order, scoped by project. A page whose time is unknown
 *  (written before timestamps existed) sorts last rather than pretending to be old or new. */
export function recentPages(tree, { projectId = null, limit = 40 } = {}) {
  const out = [];
  for (const root of pagesInScope(tree, projectId, projectId == null ? SCOPE_ALL : SCOPE_PROJECT)) {
    const go = (page, trail) => {
      out.push({
        pageId: page.id, pageTitle: page.title, trail,
        projectId: root.projectId ?? null,
        updatedAt: Number.isFinite(page.updatedAt) ? page.updatedAt : null,
        createdAt: Number.isFinite(page.createdAt) ? page.createdAt : null,
      });
      for (const k of kidsOf(page)) go(k, [...trail, page.title]);
    };
    go(root, []);
  }
  out.sort((a, b) => (b.updatedAt ?? -1) - (a.updatedAt ?? -1));
  return out.slice(0, Math.max(0, limit));
}

/** Case-insensitive page-TITLE search, scoped by project. Pure. */
export function searchTitles(tree, query, { projectId = null } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const out = [];
  for (const root of pagesInScope(tree, projectId, projectId == null ? SCOPE_ALL : SCOPE_PROJECT)) {
    const go = (page, trail) => {
      if (String(page.title || "").toLowerCase().includes(q)) {
        out.push({ pageId: page.id, pageTitle: page.title, trail, projectId: root.projectId ?? null, where: "title" });
      }
      for (const k of kidsOf(page)) go(k, [...trail, page.title]);
    };
    go(root, []);
  }
  return out;
}

/* ---- migration ---------------------------------------------------------------------
 *
 * ⛔ FOUR LEVELS → TWO CONCEPTS, and NOTHING MAY BE LOST OR BECOME UNREACHABLE.
 *
 * THE RULES, stated once so they are not re-derived from the code:
 *   1. **Every SECTION becomes a top-level page**, and the section's pages become its
 *      children. So `Grand Port › Entitlements › Bonding` becomes the page `Entitlements`
 *      with the subpage `Bonding`, in the project Grand Port.
 *   2. **The section keeps its own ID.** That is not cosmetic: it is what makes a binned
 *      page whose `parentId` names its old section restore to exactly the right place, and
 *      what makes the migration safe to run against a tree that is mid-sync.
 *   3. **TWO NOTEBOOKS BOUND TO THE SAME PROJECT MERGE**, and they merge *by construction*
 *      rather than by a merge step: `projectId` is the only grouping key there is, so their
 *      sections simply arrive as sibling top-level pages of the same project. No id can
 *      collide, because every id is preserved exactly.
 *   4. **A notebook's TITLE is consumed by the merge** — the project IS the notebook now, so
 *      the notebook's name is the project's name. Two exceptions, both of which only ever
 *      RECOVER a name that would otherwise be lost, never discard one:
 *        (a) a notebook with exactly ONE section whose section title is generic
 *            ("Section 1", "Untitled section") lends its OWN title to that page — this is
 *            what stops "Section 1" surviving as a top-level page name;
 *        (b) if BOTH titles are generic and that one section holds exactly ONE page, that
 *            page becomes the top-level page itself. `Untitled notebook › Section 1 › Load
 *            Study` becomes simply `Load Study`.
 *   5. **A loose notebook (`projectId: null`) lands in the no-project home**, same shape.
 *   6. **The BIN is preserved.** A binned notebook or section converts to a single page
 *      carrying its former contents as children, so a restore returns the branch whole. Its
 *      `pageIds` — the cascade set the purge depends on — are copied verbatim.
 *
 * IDEMPOTENCE: the conversion runs only when the input has `notebooks` and no `pages`, so
 * `migrate(migrate(x))` is `migrate(x)` for every input. test/notesModel.test.js asserts it
 * by deep equality on the owner's own data.
 */

const num = (v) => (Number.isFinite(v) ? v : null);
const GENERIC_SECTION = /^(section\s*\d*|untitled section)$/i;
const GENERIC_NOTEBOOK = /^(untitled notebook|notebook\s*\d*)$/i;

function migratePageNode(pg) {
  const kids = [];
  for (const k of Array.isArray(pg?.pages) ? pg.pages : []) {
    if (k && typeof k === "object") kids.push(migratePageNode(k));
  }
  return {
    id: String(pg?.id || newId("pg")),
    title: typeof pg?.title === "string" ? pg.title : DEFAULT_PAGE_TITLE,
    createdAt: num(pg?.createdAt),
    updatedAt: num(pg?.updatedAt),
    pages: kids,
  };
}

const withProject = (node, projectId) => ({ ...node, projectId: projectId == null ? null : String(projectId) });

/** One legacy notebook → the top-level pages it becomes. Rules 1, 2 and 4 live here. */
function notebookToPages(nb) {
  const projectId = nb?.projectId == null ? null : String(nb.projectId);
  const sections = (Array.isArray(nb?.sections) ? nb.sections : []).filter((s) => s && typeof s === "object");
  const nbTitle = typeof nb?.title === "string" ? nb.title : "";
  const out = [];

  for (const sec of sections) {
    const kids = (Array.isArray(sec.pages) ? sec.pages : []).filter((p) => p && typeof p === "object").map(migratePageNode);
    const secTitle = typeof sec.title === "string" ? sec.title : "";
    const only = sections.length === 1;

    // 4(b): both names are noise and there is exactly one page — that page IS the top level.
    if (only && GENERIC_SECTION.test(secTitle.trim()) && GENERIC_NOTEBOOK.test(nbTitle.trim()) && kids.length === 1) {
      out.push(withProject(kids[0], projectId));
      continue;
    }
    // 4(a): recover the notebook's name rather than keep "Section 1".
    const title = (only && GENERIC_SECTION.test(secTitle.trim()) && nbTitle.trim())
      ? nbTitle
      : (secTitle || nbTitle || DEFAULT_PAGE_TITLE);

    out.push(withProject({
      id: String(sec.id || newId("pg")),   // rule 2 — the section KEEPS its id
      title,
      createdAt: null,
      updatedAt: null,
      pages: kids,
    }, projectId));
  }
  return out;
}

/** A legacy trash entry → the one-page-shaped entry the new bin holds (rule 6). */
function legacyTrashEntry(e) {
  const kind = e.kind;
  const pageIds = (Array.isArray(e.pageIds) ? e.pageIds : []).filter((x) => typeof x === "string");
  const base = {
    id: String(e.id || newId("tr")),
    kind: "page",
    parentId: null,
    index: Number.isFinite(e.index) ? e.index : 0,
    projectId: null,
    title: typeof e.title === "string" ? e.title : "",
    deletedAt: Number.isFinite(e.deletedAt) ? e.deletedAt : 0,
    pageIds,
  };
  if (!e.node || typeof e.node !== "object") return { ...base, node: null };

  if (kind === "notebook") {
    // The whole notebook comes back as ONE page holding its sections as children, so the
    // restore is a single reversible act rather than N loose pages.
    const sections = (Array.isArray(e.node.sections) ? e.node.sections : []).filter((s) => s && typeof s === "object");
    const node = {
      id: String(e.node.id || newId("pg")),
      title: typeof e.node.title === "string" ? e.node.title : DEFAULT_PAGE_TITLE,
      createdAt: null, updatedAt: null,
      pages: sections.map((s) => ({
        id: String(s.id || newId("pg")),
        title: typeof s.title === "string" ? s.title : DEFAULT_PAGE_TITLE,
        createdAt: null, updatedAt: null,
        pages: (Array.isArray(s.pages) ? s.pages : []).filter((p) => p && typeof p === "object").map(migratePageNode),
      })),
    };
    return { ...base, node, projectId: e.node.projectId == null ? null : String(e.node.projectId) };
  }
  if (kind === "section") {
    const node = {
      id: String(e.node.id || newId("pg")),
      title: typeof e.node.title === "string" ? e.node.title : DEFAULT_PAGE_TITLE,
      createdAt: null, updatedAt: null,
      pages: (Array.isArray(e.node.pages) ? e.node.pages : []).filter((p) => p && typeof p === "object").map(migratePageNode),
    };
    // Its old parent was a notebook, which no longer exists — so it returns to root.
    return { ...base, node, parentId: null };
  }
  // A binned PAGE: its parentId named a section, and a section kept its id — so it restores
  // to exactly the page that section became.
  return { ...base, node: migratePageNode(e.node), parentId: e.parentId == null ? null : String(e.parentId) };
}

/** A v3 trash entry, read tolerantly. */
function migrateTrashEntry(e) {
  if (!e || typeof e !== "object") return null;
  const pageIds = (Array.isArray(e.pageIds) ? e.pageIds : []).filter((x) => typeof x === "string");
  const base = {
    id: String(e.id || newId("tr")),
    kind: "page",
    parentId: e.parentId == null ? null : String(e.parentId),
    index: Number.isFinite(e.index) ? e.index : 0,
    projectId: e.projectId == null ? null : String(e.projectId),
    title: typeof e.title === "string" ? e.title : "",
    deletedAt: Number.isFinite(e.deletedAt) ? e.deletedAt : 0,
    pageIds,
  };
  if (!e.node || typeof e.node !== "object") return { ...base, node: null };
  return { ...base, node: migratePageNode(e.node) };
}

/** Tolerant read of anything that claims to be a tree. Never throws, never returns null:
 *  junk, a missing key, a future version, a half-written object all resolve to a usable
 *  tree. A notes module that refuses to open because one field is the wrong type is worse
 *  than one that quietly drops the field. */
export function migrate(raw) {
  if (!raw || typeof raw !== "object") return emptyTree();

  // ---- the LEGACY four-level shape (v1/v2). One-way; see the rules above.
  if (!Array.isArray(raw.pages) && Array.isArray(raw.notebooks)) {
    const pages = [];
    for (const nb of raw.notebooks) {
      if (!nb || typeof nb !== "object") continue;
      pages.push(...notebookToPages(nb));
    }
    const trash = [];
    for (const e of Array.isArray(raw.trash) ? raw.trash : []) {
      if (!e || typeof e !== "object") continue;
      trash.push(legacyTrashEntry(e));
    }
    return { v: NOTES_TREE_VERSION, pages, trash, tombs: [] };
  }

  if (!Array.isArray(raw.pages)) return emptyTree();
  const pages = [];
  for (const p of raw.pages) {
    if (!p || typeof p !== "object") continue;
    pages.push(withProject(migratePageNode(p), p.projectId));
  }
  const trash = [];
  for (const e of Array.isArray(raw.trash) ? raw.trash : []) {
    const m = migrateTrashEntry(e);
    if (m) trash.push(m);
  }
  /* ⛔ `raw.tombs` — AND THAT ARGUMENT IS THE WHOLE OF THE FIRST FIX'S FAILURE. It was omitted,
   * so `withTombstones` read the ledger off the fresh object being built, found none, and
   * returned an empty one. Every read of the tree goes through here, so the ledger was
   * destroyed the instant it was written and the merge fell straight back to a plain union.
   *
   * WHAT THAT COST, measured on his account: he created a page, binned it, pressed Delete
   * forever — correct, the row went — and RELOADED. The page came back **into the live list**,
   * as a note with nothing in it and nothing recoverable, and was pushed to the cloud. Worse
   * than the bug it replaced, which at least put things back in the bin.
   *
   * ⛔ AND IT WAS INVISIBLE TO EVERY TEST WRITTEN FOR IT, which is the part worth remembering:
   * the whole suite — including a 6,000-merge fuzz — worked on in-memory trees and never once
   * went through `migrate` or through storage. A purge-then-RELOAD on ONE client was not a
   * case anybody had. `test/notesBinPurge.test.js` now round-trips every case through the real
   * store, and the fuzz reloads between rounds. */
  return withTombstones({ v: NOTES_TREE_VERSION, pages, trash, tombs: raw.tombs }, [], { at: Date.now() });
}
