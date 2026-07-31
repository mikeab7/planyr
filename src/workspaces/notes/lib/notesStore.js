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
import { docToText, imageIdsInDoc } from "./notesMarkdown.js";
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

/* ---- images (B1311) ------------------------------------------------------------------
 *
 * The document holds an image ID; the BYTES live in IndexedDB. Every function below is the
 * SAME seam as everything else in this file — no component and no extension ever reaches
 * for `indexedDB` itself, so the cloud-sync item still has exactly one file to change.
 *
 * THE CEILINGS ARE ENFORCED HERE, not at the paste site, so no future intake path can
 * bypass them. Both are deliberately generous but FINITE: a browser database is large, not
 * infinite, and an eviction under storage pressure takes the whole origin's data with it.
 * Going over is a NAMED, VISIBLE refusal (LOUD-FAILURE) — the one behaviour this feature
 * must never have is dropping a pasted picture on the floor with a shrug.
 */

/** The most one stored picture may take, after downscaling. A phone photo shrinks well
 *  under this; a very large scan is refused BY NAME rather than silently. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
/** The most one notebook's pictures may take in total. */
export const MAX_NOTEBOOK_IMAGE_BYTES = 200 * 1024 * 1024;

/* ⛔ THE IMAGE DATABASE IS LOADED ON DEMAND, and that is a bundle decision, not a style
 * one. This file is on the Notes route's STATIC path (the rail reads the tree through it),
 * so anything it imports is downloaded before the notebook list can paint — and the image
 * plumbing is not needed until a page is opened, a picture is pasted, or something is
 * purged, all of which are already async. The seam is unchanged: `notesImageDb.js` still
 * has exactly one importer, it is just reached through a cached `import()`. */
let imageDbMod = null;
const imageDb = () => (imageDbMod || (imageDbMod = import("./notesImageDb.js")));

const imageKey = (imageId, s = scope) => `${s}:${imageId}`;
const mb = (n) => `${(n / (1024 * 1024)).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Broadcast an image failure on the SAME channel as every other storage failure, so the
 *  workspace's one banner covers it and there is no second, quieter error surface. */
function failImage(message, detail) {
  lastError = { op: "image", key: PAGE_KEY_BASE, message, detail: String(detail || ""), at: Date.now() };
  broadcast(lastError);
  return lastError;
}

/** Report an image problem raised OUTSIDE this file (a file the browser could not decode,
 *  say) on the same one channel, so there is never a second, quieter error surface. */
export function reportImageProblem(message, detail) { return failImage(message, detail); }

/** Store one image's bytes. `{ ok:true, bytes }` only when they actually landed.
 *  `notebookPageIds` is the page-id set of the notebook being written into — the per
 *  notebook ceiling is measured against exactly those pages' images. */
export async function putNoteImage({ id, pageId, dataUrl, mime = "", w = 0, h = 0, notebookPageIds = null }) {
  if (!id || !dataUrl) return { ok: false, error: "no image data" };
  const db = await imageDb();
  if (!db.notesIdbAvailable()) {
    return { ok: false, error: failImage("This browser will not let Planyr store images, so the picture was NOT added. Private browsing usually causes this.").message };
  }
  const bytes = dataUrl.length;
  if (bytes > MAX_IMAGE_BYTES) {
    return { ok: false, error: failImage(`That image is too large to store (${mb(bytes)} after shrinking; the limit is ${mb(MAX_IMAGE_BYTES)}), so it was NOT added. Crop it or save it into the Library instead.`).message };
  }
  if (Array.isArray(notebookPageIds)) {
    const used = await noteImageUsage(notebookPageIds);
    if (used + bytes > MAX_NOTEBOOK_IMAGE_BYTES) {
      return { ok: false, error: failImage(`This notebook has reached its picture limit (${mb(used)} of ${mb(MAX_NOTEBOOK_IMAGE_BYTES)}), so the image was NOT added. Delete some pictures, or start another notebook.`).message };
    }
  }
  const r = await db.idbPutImage({ key: imageKey(id), scope, id, pageId: pageId || null, dataUrl, mime, w, h, bytes, createdAt: Date.now() });
  if (!r.ok) return { ok: false, error: failImage("The picture could NOT be stored, so it was not added to the page.", r.error).message };
  return { ok: true, bytes };
}

/** One image's data URL, or null when its bytes are gone. A null here is what makes the
 *  editor draw a visible BROKEN-IMAGE state — never a blank gap where a figure was. */
export async function readNoteImage(imageId) {
  if (!imageId) return null;
  const rec = await (await imageDb()).idbGetImage(imageKey(imageId));
  return rec?.dataUrl || null;
}

/** A map of `imageId → data URL` for a set of ids. Missing ids are simply absent, which is
 *  the signal the exporter turns into its named broken reference. */
export async function readNoteImages(imageIds) {
  const ids = [...new Set((imageIds || []).filter(Boolean))];
  const out = {};
  for (const id of ids) {
    const src = await readNoteImage(id);
    if (src) out[id] = src;
  }
  return out;
}

/** Total stored image bytes. `null` means the whole scope; an ARRAY means exactly those
 *  pages — including an EMPTY array, which honestly totals zero. (Treating an empty set as
 *  "everything" would price a brand-new notebook at the whole account's usage and refuse
 *  its first picture.) */
export async function noteImageUsage(pageIds = null) {
  const want = Array.isArray(pageIds) ? new Set(pageIds) : null;
  const meta = await (await imageDb()).idbListImageMeta(scope);
  let total = 0;
  for (const m of meta) if (!want || want.has(m.pageId)) total += m.bytes || 0;
  return total;
}

/** Clear image bytes belonging to a page that no longer exists ANYWHERE — not in the live
 *  tree and not in the bin. The image twin of `sweepOrphans`, and the safety net for a
 *  delete interrupted mid-cascade (a tab closed between the tree write and the purge).
 *
 *  ⛔ THE CALLER MUST PASS LIVE **AND** BINNED PAGE IDS. A binned page's body and pictures
 *  are deliberately still on disk — that is the whole point of the bin — so a sweep that
 *  knew only about the live tree would destroy exactly the thing a restore needs.
 *
 *  It judges by PAGE, from the metadata index alone, so it costs no body reads: a picture
 *  removed from a page that still exists is left alone (it may yet be un-done back in) and
 *  goes when its page is finally purged. */
export async function sweepImagesOfMissingPages(pageIdsLiveAndBinned) {
  const live = new Set(pageIdsLiveAndBinned || []);
  const meta = await (await imageDb()).idbListImageMeta(scope);
  const orphans = meta.filter((m) => m.pageId && !live.has(m.pageId)).map((m) => m.id);
  if (orphans.length) await deleteNoteImages(orphans);
  return orphans;
}

/** Destroy image bytes by id. */
export async function deleteNoteImages(imageIds) {
  const ids = [...new Set((imageIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true, removed: 0 };
  const r = await (await imageDb()).idbDeleteImages(ids.map((id) => imageKey(id)));
  if (!r.ok) failImage("Some pictures could not be removed from this browser's storage, so they may still be taking up space.", r.error);
  return r;
}

/** THE PURGE — the ONE place a note's bytes are actually destroyed (TOMBSTONE-DELETES).
 *
 *  Takes the FULL cascade set the model reported at delete time and, for every page in it,
 *  clears the body AND every image that body referenced. Reading each body first is what
 *  makes the image half possible at all: nothing else knows which pictures a page owned,
 *  and an image left behind after its page is gone is storage that can never be reached
 *  and never be freed — the same leak the body cascade exists to prevent, one layer down. */
export async function purgePages(pageIds) {
  const ids = (Array.isArray(pageIds) ? pageIds : [pageIds]).filter(Boolean);
  if (!ids.length) return { pages: 0, images: 0 };
  const imageIds = [];
  for (const id of ids) {
    for (const imgId of imageIdsInDoc(readPage(id))) imageIds.push(imgId);
  }
  const pages = deletePages(ids);
  const img = await deleteNoteImages(imageIds);
  return { pages, images: img.removed || 0 };
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
