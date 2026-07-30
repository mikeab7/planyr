/* notesStore — the ONE storage seam for the Notes module.
 *
 * EVERY read and write of a notebook tree or a page body goes through this file. That is
 * deliberate and load-bearing: the cloud-sync item ([Notes / sync]) is then a change HERE
 * and nowhere else — no component, no model function, and no exporter has to learn that
 * storage moved.
 *
 * TWO KEY SHAPES, and the reason there are two:
 *   planyr:notes:tree:v1:<SCOPE>            — the whole notebook › section › page tree
 *   planyr:notes:page:v1:<SCOPE>:<PAGEID>   — ONE page's document model
 * The tree holds no bodies. If one blob held every note, every keystroke's autosave would
 * rewrite every note ever written, and the cost of typing would grow with the size of the
 * notebook for the rest of its life.
 *
 * SCOPE is the signed-in user's id, or the literal `local` when signed out. Two accounts
 * on one machine therefore never read each other's notes, and signing out does not leak
 * the previous account's notebooks into the signed-out tree.
 *
 * LOUD-FAILURE. A full quota, a disabled store, or a private-mode browser must NEVER look
 * like a clean save. Every failure path broadcasts through `onNotesStorageError`, which
 * the workspace renders as a named banner, and every write returns a boolean the caller
 * uses to drive the saved/unsaved badge honestly. There is no swallowed catch in here.
 */
import { docToText } from "./notesMarkdown.js";
import { searchTitles, visibleNotebooks } from "./notesModel.js";

export const TREE_KEY_BASE = "planyr:notes:tree:v1";
export const PAGE_KEY_BASE = "planyr:notes:page:v1";
export const LOCAL_SCOPE = "local";

/* ---- scope ------------------------------------------------------------------------- */

let scope = LOCAL_SCOPE;

/** Point the store at a user's notes (or back at the signed-out `local` set).
 *  Returns true when the scope actually changed, so the caller knows to re-read. */
export function setNotesScope(userId) {
  const next = userId ? String(userId) : LOCAL_SCOPE;
  if (next === scope) return false;
  scope = next;
  return true;
}

export function notesScope() { return scope; }
export const treeKey = (s = scope) => `${TREE_KEY_BASE}:${s}`;
export const pageKey = (pageId, s = scope) => `${PAGE_KEY_BASE}:${s}:${pageId}`;

/** The honest one-line description of where these notes live, for the header.
 *
 *  ⛔ It says "on this device" because that is TRUE today — notes are not synced. When the
 *  [Notes / sync] item lands, this string MUST change with it. A label that claims sync
 *  before sync exists is the B209 / B595 failure class this module's LOUD-FAILURE rule
 *  exists to prevent: a note that LOOKS backed up and is not. */
export function notesScopeLabel() {
  return scope === LOCAL_SCOPE ? "Saved on this device" : "Saved on this device (this account)";
}

/* ---- failure broadcast -------------------------------------------------------------- */

const errorListeners = new Set();

/** Subscribe to storage failures. Returns an unsubscribe function. */
export function onNotesStorageError(fn) {
  errorListeners.add(fn);
  return () => errorListeners.delete(fn);
}

let lastError = null;
export function lastNotesStorageError() { return lastError; }
export function clearNotesStorageError() { lastError = null; broadcast(null); }

function broadcast(err) {
  for (const fn of errorListeners) { try { fn(err); } catch (_) { /* a bad listener must not mute the rest */ } }
}

function fail(op, key, e) {
  const quota = /quota|exceed|full/i.test(String(e?.name || "") + String(e?.message || ""));
  lastError = {
    op,
    key,
    message: quota
      ? "This browser's storage is full, so the last change was NOT saved. Free some space or export the notebook to Markdown."
      : `Notes could not be ${op === "read" ? "read from" : "written to"} this browser's storage, so the last change was NOT saved.`,
    detail: String(e?.message || e || "unknown"),
    at: Date.now(),
  };
  broadcast(lastError);
  return lastError;
}

/* ---- the raw store ------------------------------------------------------------------ */

/* Resolved per call rather than captured once: a store that is unavailable at module load
 * (SSR, a locked-down iframe) must not permanently poison the module. */
function store() {
  try {
    const s = typeof window !== "undefined" ? window.localStorage : null;
    if (!s) return null;
    return s;
  } catch (_) { return null; }  // Safari private mode throws on ACCESS, not just on write
}

/* ---- tree ---------------------------------------------------------------------------- */

/** Read the raw tree object, or null when absent. A PARSE failure is a real failure and
 *  is reported — a corrupt tree read as "you have no notebooks" is how notes disappear. */
export function readTreeRaw() {
  const s = store();
  if (!s) { fail("read", treeKey(), new Error("localStorage is unavailable in this browser")); return null; }
  let text;
  try { text = s.getItem(treeKey()); } catch (e) { fail("read", treeKey(), e); return null; }
  if (text == null) return null;
  try { return JSON.parse(text); } catch (e) { fail("read", treeKey(), e); return null; }
}

/** Persist the tree. Returns true only when the bytes actually landed. */
export function writeTree(tree) {
  const s = store();
  if (!s) { fail("write", treeKey(), new Error("localStorage is unavailable in this browser")); return false; }
  try { s.setItem(treeKey(), JSON.stringify(tree)); return true; }
  catch (e) { fail("write", treeKey(), e); return false; }
}

/* ---- page bodies ---------------------------------------------------------------------- */

/** Read one page's document model, or null when the page has never been written. */
export function readPage(pageId) {
  if (!pageId) return null;
  const s = store();
  if (!s) { fail("read", pageKey(pageId), new Error("localStorage is unavailable in this browser")); return null; }
  let text;
  try { text = s.getItem(pageKey(pageId)); } catch (e) { fail("read", pageKey(pageId), e); return null; }
  if (text == null) return null;
  try { return JSON.parse(text); } catch (e) { fail("read", pageKey(pageId), e); return null; }
}

/** Persist one page's document model. Returns true only when the bytes actually landed. */
export function writePage(pageId, doc) {
  if (!pageId) return false;
  const s = store();
  if (!s) { fail("write", pageKey(pageId), new Error("localStorage is unavailable in this browser")); return false; }
  try { s.setItem(pageKey(pageId), JSON.stringify(doc)); return true; }
  catch (e) { fail("write", pageKey(pageId), e); return false; }
}

/** Clear page bodies. Takes the FULL cascade set from `deleteNode`, never a single id the
 *  caller guessed at — TOMBSTONE-DELETES: deleting a notebook orphans every page beneath
 *  every one of its sections, and a body left behind is a note that can never be reached
 *  and never be removed. Returns how many keys were actually cleared. */
export function deletePages(pageIds) {
  const ids = (Array.isArray(pageIds) ? pageIds : [pageIds]).filter(Boolean);
  if (!ids.length) return 0;
  const s = store();
  if (!s) { fail("write", PAGE_KEY_BASE, new Error("localStorage is unavailable in this browser")); return 0; }
  let n = 0;
  for (const id of ids) {
    try { s.removeItem(pageKey(id)); n += 1; }
    catch (e) { fail("write", pageKey(id), e); }
  }
  return n;
}

/** Every page id that currently has a stored body in THIS scope. Used by the orphan sweep
 *  and by the live harness's delete-cascade count. */
export function listStoredPageIds() {
  const s = store();
  if (!s) return [];
  const prefix = `${PAGE_KEY_BASE}:${scope}:`;
  const out = [];
  try {
    for (let i = 0; i < s.length; i += 1) {
      const k = s.key(i);
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
  } catch (e) { fail("read", prefix, e); }
  return out;
}

/** Clear any stored body whose page is no longer in the tree. A safety net for a delete
 *  that was interrupted (a closed tab mid-cascade), not a substitute for `deletePages`. */
export function sweepOrphans(livePageIds) {
  const live = new Set(livePageIds || []);
  const orphans = listStoredPageIds().filter((id) => !live.has(id));
  if (orphans.length) deletePages(orphans);
  return orphans;
}

/* ---- search --------------------------------------------------------------------------- */

const EXCERPT = 90;

function excerptAround(text, q) {
  const i = text.toLowerCase().indexOf(q);
  if (i < 0) return "";
  const from = Math.max(0, i - Math.floor(EXCERPT / 3));
  const slice = text.slice(from, from + EXCERPT).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${slice}${from + EXCERPT < text.length ? "…" : ""}`;
}

/** Titles + BODIES, merged. Title hits come first (a page whose NAME matches is what the
 *  user meant); body hits follow with an excerpt showing the phrase in context. A page
 *  that matches on both appears once, as a title hit. */
export function searchNotes(tree, query, { projectId = null } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  const titleHits = searchTitles(tree, query, { projectId });
  const seen = new Set(titleHits.map((h) => h.pageId));
  const bodyHits = [];
  for (const nb of visibleNotebooks(tree, projectId)) {
    for (const sec of nb.sections || []) {
      for (const pg of sec.pages || []) {
        if (seen.has(pg.id)) continue;
        const text = docToText(readPage(pg.id));
        if (!text || !text.toLowerCase().includes(q)) continue;
        bodyHits.push({
          pageId: pg.id, pageTitle: pg.title, sectionId: sec.id, sectionTitle: sec.title,
          notebookId: nb.id, notebookTitle: nb.title, where: "body", excerpt: excerptAround(text, q),
        });
      }
    }
  }
  return [...titleHits, ...bodyHits];
}
