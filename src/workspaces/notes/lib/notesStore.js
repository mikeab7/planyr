/* notesStore — the ONE storage seam for the Notes module.
 *
 * EVERY read and write of the page tree, a page body or a picture goes through this file.
 * That was deliberate and load-bearing, and B1291 is what it was for: cloud sync landed
 * HERE and (below) in lib/notesCloud.js — no component, no model function and no exporter
 * had to learn that storage moved.
 *
 * TWO KEY SHAPES ON THE DEVICE, and the reason there are two:
 *   planyr:notes:tree:v1:<SCOPE>            — the whole PAGE TREE (pages holding pages)
 *   planyr:notes:page:v1:<SCOPE>:<PAGEID>   — ONE page's document model
 * The tree holds no bodies. If one blob held every note, every keystroke's autosave would
 * rewrite every note ever written, and the cost of typing would grow with the size of the
 * tree for the rest of its life. The cloud mirrors that same split exactly.
 *
 * SCOPE is the signed-in user's id, or the literal `local` when signed out. Two accounts on
 * one machine therefore never read each other's notes, and signing out does not leak the
 * previous account's notes into the signed-out tree.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ROWS-CANONICAL-ON-SEED — WHICH COPY WINS, DECIDED, NOT LEFT TO ACCIDENT (B1291)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * A signed-in account now has TWO copies of every note: the SERVER row (the durable one)
 * and this device's localStorage MIRROR (the fast one). When they disagree, this is the
 * rule, written down the way the Site Planner's own rule is written down in /CLAUDE.md:
 *
 *   • For a page the SERVER HAS ALREADY SEEN, the ROW WINS the moment the store seeds from
 *     it — unless there is a PENDING LOCAL EDIT to explain the difference, which is a real
 *     edit and is kept. "Pending" is not a guess: a body is marked dirty at the instant
 *     `writePage` lands it, and the flag is cleared only when a push actually succeeds.
 *   • For a page the SERVER HAS NEVER SEEN, LOCAL WINS and is uploaded. That, and only
 *     that, is what "your notes are never dropped" covers — the same boundary the Site
 *     Planner draws.
 *   • The TREE follows the identical rule one level up: the server's tree wins on seed
 *     unless this device has unpushed structural changes, in which case the two are MERGED
 *     (never clobbered) — see `mergeTrees` in notesCloud.js for the merge's own four rules.
 *   • When BOTH moved on the same page AND THE TWO COPIES ACTUALLY DIFFER, nobody wins
 *     silently. The page enters a named CONFLICT state, the workspace says "this note also
 *     changed in another of your windows", and the user picks. Neither copy is destroyed to
 *     get there.
 *
 * The trap this closes is the same one B1113 closed for site elements: after a seed this
 * device holds the FRESH rev, so a stale cached body would commit CLEANLY — the revision
 * guard cannot help, because the client legitimately holds the current revision. Adopting
 * the row at seed time, rather than pushing over it, is what makes that impossible.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * TWO WINDOWS OF ONE ACCOUNT IS A NORMAL STATE, NOT AN EXCEPTION (B1391)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * The rule above was right and was firing far too often, because a lost REVISION RACE was
 * being reported as a disagreement without anyone comparing the two documents. One person
 * with Planyr open in two tabs (or a hard reload landing between a push and the ledger
 * write) produced "this also changed on another device… keep yours or theirs?" over two
 * copies of the SAME TEXT. Three things changed, and all three are load-bearing:
 *
 *   1. A NO-OP NEVER PROMPTS. Every path that loses the guard goes through `settleQuietly`
 *      → `judgeConflict` (pure, notesCloud.js) first: identical text, or nothing here to
 *      lose, reconciles in silence. Only a real divergence may interrupt.
 *   2. THE LEDGER MERGES INSTEAD OF OVERWRITING. Two windows share this browser's storage
 *      but not its memory, so a blind ledger write flattened what the sibling had learned
 *      and manufactured the stale bases that caused the refusals (`mergeSyncState`).
 *   3. THE OPEN EDITOR RE-READS A BODY THAT CHANGED UNDER IT (`onNotesPagesChanged`). This
 *      is the real self-race the prompt was only a symptom of: the editor reads its document
 *      once, so a page replaced by a sibling window or by the cloud seed left it holding a
 *      stale copy that the next keystroke wrote straight back — cleanly, past a guard this
 *      window legitimately satisfied. Silent loss, no conflict, nothing to notice.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * WHICH PAGES A PROJECT SHOWS — DECIDED, NOT LEFT ACCIDENTAL (B1374, AMENDED BY B1420)
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⛔ SUPERSEDED, and kept so nobody rebuilds it from a stale comment: the model used to be
 * `project › notebook › section › page`, and the project binding lived on the NOTEBOOK. It
 * is gone (B1420, owner's decision — **the project IS the notebook**). There are two concepts
 * now: a project, and PAGES THAT CAN HOLD SUBPAGES. The full rule and the one-way migration
 * live in the header of `notesModel.js`; read it there rather than re-deriving it.
 *
 * What replaces the old binding rule, and every surface obeys it:
 *
 *   • A TOP-LEVEL page carries `projectId` — a project, or `null` for the named
 *     "Not in a project" home. A SUBPAGE carries none: its project is its root's, DERIVED.
 *     Storing it on every node would make one fact writable in N places, which is the
 *     redundancy B1340 cost this repo eight PRs to remove from the Site Planner.
 *   • INSIDE A PROJECT you see that project's pages and nothing else — including nothing
 *     from the no-project home. That is a deliberate CHANGE from B1374's "a loose notebook
 *     shows up everywhere", and it is what lets the rail drop the per-row project badge
 *     entirely: everything on screen belongs to where you are standing.
 *   • THE DASHBOARD IS THE ALL-PROJECTS VIEW — every project's pages, GROUPED under the
 *     project's name, no-project group last. It is one click from the header crumb on every
 *     screen, which is what keeps B1374's load-bearing guarantee ("nothing can become
 *     unreachable") true after its in-rail scope switch was removed as duplicate chrome.
 *     A project id that no longer resolves still gets its own flagged group rather than
 *     being folded away — losing the label must never mean losing the pages.
 *   • A page created while a project is selected is FILED THERE by default with no extra
 *     step; created from the Dashboard it belongs to no project. Either way it is re-filed
 *     from the row's own menu, or by dragging it onto a project's heading.
 *   • MIGRATION: one-way, on read, and PERSISTED on the first load that sees the old shape
 *     (so the new shape rides the cloud tree blob to the other machine). Every section
 *     becomes a top-level page keeping its own ID; its pages become that page's subpages;
 *     two notebooks bound to the same project MERGE by construction, because `projectId`
 *     is the only grouping key there is. Nothing is dropped and no id can collide.
 *   • THE FILING RIDES IN THE TREE BLOB, so it syncs with everything else and needs no
 *     schema change and no SQL. `mergeTrees` carries it: a page present on one side only is
 *     kept whole (rule 2), and for a page on both sides the LOCAL filing wins (rule 3), the
 *     same as its title. Asserted in test/notesSync.test.js, not assumed.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * LOUD-FAILURE. A full quota, a disabled store, a private-mode browser, a refused upload or
 * a dead network must NEVER look like a clean save. Every local failure path broadcasts
 * through `onNotesStorageError`, which the workspace renders as a named banner; every write
 * returns a boolean the caller uses to drive the saved/unsaved badge honestly; and every
 * CLOUD outcome is published through `onNotesSyncState`, which the workspace renders as a
 * footer line that says which of saved-locally / syncing / synced / offline / failed is
 * actually true, with a reason when it failed. There is no swallowed catch in here, and
 * there is no state in which the footer claims a sync that did not happen.
 */
import { assetIdsInDoc, docToText, imageIdsInDoc } from "./notesMarkdown.js";
import { openTasksInDoc, rollUpOpenTasks, setTaskCheckedInDoc } from "./notesTasks.js";
import { MAX_VERSIONS_PER_PAGE, planRestore, planRetention, shouldSnapshot } from "./notesVersions.js";
import { safeAttachmentName } from "./notesFileMeta.js";
import { migrate, searchTitles, pagesInScope, trashEntries, walkPages, SCOPE_ALL, SCOPE_PROJECT } from "./notesModel.js";
import { relativeTime } from "./notesTime.js";

/* The key strings live in `notesKeys.js` — a leaf with no dependencies — so the ONE other
 * module allowed to touch these keys (`notesProjectLink.js`, which answers "what is this
 * project holding?" from a route where Notes is not mounted) cannot drift from this file's
 * idea of where a tree lives. Re-exported here so every existing importer is unchanged: this
 * is still the seam. */
export { TREE_KEY_BASE, PAGE_KEY_BASE, SYNC_KEY_BASE, LOCAL_SCOPE } from "./notesKeys.js";
import { LOCAL_SCOPE, PAGE_KEY_BASE, SYNC_KEY_BASE, TREE_KEY_BASE } from "./notesKeys.js";

/* ---- scope ------------------------------------------------------------------------- */

let scope = LOCAL_SCOPE;

/** Point the store at a user's notes (or back at the signed-out `local` set).
 *  Returns true when the scope actually changed, so the caller knows to re-read. */
export function setNotesScope(userId) {
  const next = userId ? String(userId) : LOCAL_SCOPE;
  if (next === scope) return false;
  stopNotesSync();
  scope = next;
  sync = readSyncState();
  conflicts.clear();
  cloudImagePages.clear();
  setSyncState(scope === LOCAL_SCOPE ? { mode: "local" } : { mode: "idle" });
  return true;
}

export function notesScope() { return scope; }
export const treeKey = (s = scope) => `${TREE_KEY_BASE}:${s}`;
export const pageKey = (pageId, s = scope) => `${PAGE_KEY_BASE}:${s}:${pageId}`;
export const syncKey = (s = scope) => `${SYNC_KEY_BASE}:${s}`;

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
      ? "This browser's storage is full, so the last change was NOT saved. Free some space or export your notes to Markdown."
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
 *  is reported — a corrupt tree read as "you have no notes" is how notes disappear. */
export function readTreeRaw(s = scope) {
  const st = store();
  if (!st) { fail("read", treeKey(s), new Error("localStorage is unavailable in this browser")); return null; }
  let text;
  try { text = st.getItem(treeKey(s)); } catch (e) { fail("read", treeKey(s), e); return null; }
  if (text == null) return null;
  try { return JSON.parse(text); } catch (e) { fail("read", treeKey(s), e); return null; }
}

/* The tree write, WITHOUT the sync bookkeeping. The seed and the merge use this: adopting
 * the server's tree must not mark the device dirty and bounce it straight back up. */
function writeTreeLocal(tree, s = scope) {
  const st = store();
  if (!st) { fail("write", treeKey(s), new Error("localStorage is unavailable in this browser")); return false; }
  try { st.setItem(treeKey(s), JSON.stringify(tree)); return true; }
  catch (e) { fail("write", treeKey(s), e); return false; }
}

/** Persist the tree. Returns true only when the bytes actually landed — and, when signed
 *  in, marks the tree as owing the cloud a push. */
export function writeTree(tree) {
  const ok = writeTreeLocal(tree);
  if (ok && scoped()) { sync.treeDirty = true; saveSyncState(); schedulePush(); }
  return ok;
}

/* ---- page bodies ---------------------------------------------------------------------- */

/** Read one page's document model, or null when the page has never been written. */
export function readPage(pageId, s = scope) {
  if (!pageId) return null;
  const st = store();
  if (!st) { fail("read", pageKey(pageId, s), new Error("localStorage is unavailable in this browser")); return null; }
  let text;
  try { text = st.getItem(pageKey(pageId, s)); } catch (e) { fail("read", pageKey(pageId, s), e); return null; }
  if (text == null) return null;
  try { return JSON.parse(text); } catch (e) { fail("read", pageKey(pageId, s), e); return null; }
}

/* The body write WITHOUT the sync bookkeeping — the seed's adopt path, which must not mark
 * a freshly-downloaded body as a local edit owing the cloud a push. */
function writePageLocal(pageId, doc, s = scope) {
  const st = store();
  if (!st) { fail("write", pageKey(pageId, s), new Error("localStorage is unavailable in this browser")); return false; }
  try { st.setItem(pageKey(pageId, s), JSON.stringify(doc)); return true; }
  catch (e) { fail("write", pageKey(pageId, s), e); return false; }
}

/** Persist one page's document model. Returns true only when the bytes actually landed —
 *  and, when signed in, marks THAT page as owing the cloud a push. */
export function writePage(pageId, doc) {
  if (!pageId) return false;
  const ok = writePageLocal(pageId, doc);
  if (ok && scoped()) {
    const prev = sync.pages[pageId] || {};
    // A deliberate write clears the device-level tombstone: only a real body write can, and
    // it keeps the revision it was based on so the push stays a guarded update.
    sync.pages[pageId] = { rev: Number.isFinite(prev.rev) ? prev.rev : null, dirty: true, purged: false };
    saveSyncState();
    schedulePush();
  }
  return ok;
}

/** Clear page bodies. Takes the FULL cascade set from `deleteNode`, never a single id the
 *  caller guessed at — TOMBSTONE-DELETES: deleting a page orphans its ENTIRE SUBTREE, at
 *  every depth, and a body left behind is a note that can never be reached and never be
 *  removed. Returns how many keys were actually cleared. */
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

/** Every page id that currently has a stored body in THIS scope. Used by the orphan sweep,
 *  by the cloud seed, and by the live harness's delete-cascade count. */
export function listStoredPageIds(s = scope) {
  const st = store();
  if (!st) return [];
  const prefix = `${PAGE_KEY_BASE}:${s}:`;
  const out = [];
  try {
    for (let i = 0; i < st.length; i += 1) {
      const k = st.key(i);
      if (k && k.startsWith(prefix)) out.push(k.slice(prefix.length));
    }
  } catch (e) { fail("read", prefix, e); }
  return out;
}

/** Clear any stored body whose page is no longer in the tree. A safety net for a delete
 *  that was interrupted (a closed tab mid-cascade), not a substitute for `deletePages`.
 *
 *  ⛔ It deliberately does NOT tombstone anything in the cloud. This sweep judges against
 *  THIS DEVICE's tree, which on a fresh sign-in is behind the account's; treating what it
 *  finds as a delete would let a device that has not synced yet erase the account.
 *
 *  ⛔ AND IT WILL NOT DESTROY A BODY THAT STILL HAS WORDS IN IT (NEW-4). Found in the
 *  owner's own account: a page whose TREE NODE had gone but whose body row was still in the
 *  cloud, holding real notes. The sweep deleted the local copy, the next seed downloaded it
 *  again (`planPageSeed` adopts any row this device does not have), and the loop ran for
 *  days with the note reachable from nowhere and nothing ever saying so. An interrupted
 *  delete leaves an EMPTY or a stray body; a body with paragraphs in it is somebody's work,
 *  and the honest thing to do with work whose home is missing is to SAY SO — which
 *  `unreachableNotes` (lib/notesScan.js) does — not to quietly delete it every time the tab
 *  opens.
 *
 *  Returns `{ removed, kept }`: what it cleared, and what it refused to. */
export function sweepOrphans(livePageIds) {
  const live = new Set(livePageIds || []);
  const orphans = listStoredPageIds().filter((id) => !live.has(id));
  const kept = [];
  const removed = [];
  for (const id of orphans) (hasWords(readPage(id)) ? kept : removed).push(id);
  if (removed.length) deletePages(removed);
  return { removed, kept };
}

/** Does this document have anything a person actually wrote in it? The bar for "worth
 *  keeping" — and deliberately lower than the duplicate detector's, because refusing to
 *  destroy something is a cheaper mistake than reporting a false duplicate. */
const hasWords = (doc) => docToText(doc).trim().length > 0;

/* ---- images (B1311) ------------------------------------------------------------------
 *
 * The document holds an image ID; the BYTES live in IndexedDB, and — since B1291 — in the
 * private `notes-images` Supabase bucket, with IndexedDB as the local CACHE in front of it.
 * Every function below is the SAME seam as everything else in this file: no component and
 * no extension ever reaches for `indexedDB` or for the network itself.
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
/** The most one ATTACHED FILE may take (NEW-5). Bigger than the picture ceiling because
 *  nothing downscales a DWG or a survey PDF — and enforced HERE, on the same seam as the
 *  image ceilings, so no future intake path can slip past it. The number is the stored
 *  data-URL length, which is ~4/3 of the file's own size; the cloud bucket's own limit is
 *  set to match in db/notes_attachments.sql. */
export const MAX_FILE_BYTES = 34 * 1024 * 1024;

/* ⛔ THE IMAGE DATABASE IS LOADED ON DEMAND, and that is a bundle decision, not a style
 * one. This file is on the Notes route's STATIC path (the rail reads the tree through it),
 * so anything it imports is downloaded before the notebook list can paint — and the image
 * plumbing is not needed until a page is opened, a picture is pasted, or something is
 * purged, all of which are already async. The seam is unchanged: `notesImageDb.js` still
 * has exactly one importer, it is just reached through a cached `import()`.
 *
 * lib/notesCloud.js is on the same side of that line and for the same reason: nothing on
 * the notebook rail's first paint needs the network. */
let imageDbMod = null;
const imageDb = () => (imageDbMod || (imageDbMod = import("./notesImageDb.js")));
let cloudMod = null;
const cloud = () => (cloudMod || (cloudMod = import("./notesCloud.js")));

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
  // The bytes are safe locally; the upload follows without blocking the paste. A failure
  // here is loud AND self-healing: the picture stays un-marked, so the next seed's
  // `planImageSync` finds it missing on the server and tries again.
  if (syncOn()) uploadImage({ id, pageId, dataUrl, mime, w, h, bytes });
  return { ok: true, bytes };
}

/** One image's data URL, or null when its bytes are gone. A null here is what makes the
 *  editor draw a visible BROKEN-IMAGE state — never a blank gap where a figure was.
 *
 *  THE SECOND MACHINE IS THE WHOLE POINT: IndexedDB is only a cache, so a miss on a device
 *  that has never seen this picture falls through to the cloud and writes the bytes back
 *  into the cache on the way past. That is why a note with a photo opens complete on the
 *  laptop, and it is why the download is lazy — pictures arrive with the page that needs
 *  them, not in a sign-in-time avalanche. */
export async function readNoteImage(imageId) {
  if (!imageId) return null;
  const rec = await (await imageDb()).idbGetImage(imageKey(imageId));
  if (rec?.dataUrl) return rec.dataUrl;
  if (!syncOn()) return null;
  const c = await cloud();
  const r = await c.fetchImage(client(), scope, imageId);
  if (!r.ok) return null;   // an honest miss → the visible broken-image state, not a blank
  const pageId = cloudImagePages.get(imageId) || null;
  await (await imageDb()).idbPutImage({
    key: imageKey(imageId), scope, id: imageId, pageId, dataUrl: r.dataUrl,
    mime: "", w: 0, h: 0, bytes: r.dataUrl.length, createdAt: Date.now(),
  });
  return r.dataUrl;
}

/* ---- attached files (NEW-5) -------------------------------------------------------------
 *
 * ⛔ AN ATTACHMENT RIDES THE PICTURE TIER. Same IndexedDB store, same cloud table, same
 * bucket, same purge cascade, same orphan sweep — it differs only by `kind: "file"` and by
 * carrying the file's NAME. That is a deliberate refusal to build a second blob tier: a
 * parallel one would need its own sync plan, its own cascade and its own way to leak bytes,
 * and this module already has exactly one of each. The account-side change it needed is one
 * migration (db/notes_attachments.sql): stop the bucket refusing non-image types, and carry
 * `name` + `kind` on the row.
 */

/** Store one attached file's bytes. `{ ok:true, bytes }` only when they actually landed. */
export async function putNoteFile({ id, pageId, dataUrl, name = "", mime = "", notebookPageIds = null }) {
  if (!id || !dataUrl) return { ok: false, error: "no file data" };
  const label = safeAttachmentName(name);
  const db = await imageDb();
  if (!db.notesIdbAvailable()) {
    return { ok: false, error: failImage(`This browser will not let Planyr store files, so “${label}” was NOT attached. Private browsing usually causes this.`).message };
  }
  const bytes = dataUrl.length;
  if (bytes > MAX_FILE_BYTES) {
    return { ok: false, error: failImage(`“${label}” is too large to attach (${mb(bytes)}; the limit is ${mb(MAX_FILE_BYTES)}), so it was NOT added. Put it in the Library and link to it instead.`).message };
  }
  if (Array.isArray(notebookPageIds)) {
    const used = await noteImageUsage(notebookPageIds);
    if (used + bytes > MAX_NOTEBOOK_IMAGE_BYTES) {
      return { ok: false, error: failImage(`This notebook has reached its storage limit (${mb(used)} of ${mb(MAX_NOTEBOOK_IMAGE_BYTES)}), so “${label}” was NOT attached. Delete some pictures or files first.`).message };
    }
  }
  const r = await db.idbPutImage({
    key: imageKey(id), scope, id, pageId: pageId || null, dataUrl,
    mime: mime || "application/octet-stream", w: 0, h: 0, bytes,
    kind: "file", name: label, createdAt: Date.now(),
  });
  if (!r.ok) return { ok: false, error: failImage(`“${label}” could NOT be stored, so it was not attached to the page.`, r.error).message };
  if (syncOn()) uploadImage({ id, pageId, dataUrl, mime: mime || "application/octet-stream", w: 0, h: 0, bytes, kind: "file", name: label });
  return { ok: true, bytes };
}

/** One attached file's bytes as a data URL, or null when they are gone. Same cloud
 *  fall-through as a picture, for the same reason: a file attached on the desktop has to be
 *  downloadable from the laptop, and it arrives with the page that needs it. */
export async function readNoteFile(fileId) { return readNoteImage(fileId); }

/** A map of `fileId → data URL` for a set of ids, skipping anything over `maxBytes`.
 *  The cap is what stops a Markdown export of a note with a 30 MB drawing producing a
 *  Markdown file no editor will open; the exporter NAMES what it did not embed. */
export async function readNoteFiles(fileIds, { maxBytes = Infinity } = {}) {
  const ids = [...new Set((fileIds || []).filter(Boolean))];
  if (!ids.length) return {};
  const meta = new Map((await (await imageDb()).idbListImageMeta(scope)).map((m) => [m.id, m]));
  const out = {};
  for (const id of ids) {
    if ((meta.get(id)?.bytes || 0) > maxBytes) continue;
    const src = await readNoteFile(id);
    if (src) out[id] = src;
  }
  return out;
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
 *  goes when its page is finally purged. Like `sweepOrphans` it is device-local and never
 *  tombstones the cloud. */
export async function sweepImagesOfMissingPages(pageIdsLiveAndBinned) {
  const live = new Set(pageIdsLiveAndBinned || []);
  const meta = await (await imageDb()).idbListImageMeta(scope);
  const orphans = meta.filter((m) => m.pageId && !live.has(m.pageId)).map((m) => m.id);
  if (orphans.length) await deleteNoteImages(orphans);
  return orphans;
}

/** Destroy image bytes by id (on this device). */
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
 *  and never be freed — the same leak the body cascade exists to prevent, one layer down.
 *
 *  IN THE CLOUD THE ROW STAYS, as a real tombstone (`purged_at` + a null document, and the
 *  picture rows marked gone). A row that simply vanished would read to the other device
 *  exactly like a page this one has not uploaded yet, and it would push the note straight
 *  back up — which is the resurrection this rule exists to make impossible. */
export async function purgePages(pageIds) {
  const ids = (Array.isArray(pageIds) ? pageIds : [pageIds]).filter(Boolean);
  if (!ids.length) return { pages: 0, images: 0 };
  const imageIds = [];
  for (const id of ids) {
    // ⛔ ASSETS, not images (NEW-5). An attachment left behind after its page is gone is
    // storage nothing can reach and nothing will ever free — the same leak the body
    // cascade exists to prevent, one layer down, and the reason `assetIdsInDoc` is the
    // one accessor a delete path may use.
    for (const assetId of assetIdsInDoc(readPage(id))) imageIds.push(assetId);
  }
  const pages = deletePages(ids);
  const img = await deleteNoteImages(imageIds);
  // A purged page's HISTORY goes with it (NEW-3). "Delete forever" that left thirty
  // snapshots of the deleted note on the device would be a bin with a hole in it.
  await deletePageVersions(ids);
  if (scoped()) {
    for (const id of ids) sync.pages[id] = { rev: sync.pages[id]?.rev ?? null, dirty: false, purged: true };
    for (const id of imageIds) sync.images[id] = { up: false, purged: true };
    saveSyncState();
  }
  if (syncOn()) {
    const c = await cloud();
    const rp = await c.purgePagesCloud(client(), ids);
    const ri = imageIds.length ? await c.purgeImagesCloud(client(), scope, imageIds) : { ok: true };
    if (!rp.ok || !ri.ok) reportSyncFailure(rp.error || ri.error);
    else noteSynced();
  }
  return { pages, images: img.removed || 0 };
}

/* ---- the bin, in the cloud -----------------------------------------------------------
 *
 * The 30-day bin is a TREE state (`tree.trash`), and the tree syncs, so a delete already
 * reaches the other device. These two additionally stamp the page ROWS, which is what makes
 * a row self-describing (`deleted_at` = binned, body intact) and what lets a restore on one
 * machine find something to restore on the other. Both are no-ops signed out. */

/** Mark a binned cascade in the cloud — the body deliberately stays. */
export async function markPagesBinned(pageIds) { return setBinned(pageIds, true); }
/** Un-mark a restored cascade. */
export async function markPagesRestored(pageIds) { return setBinned(pageIds, false); }

async function setBinned(pageIds, binned) {
  const ids = (Array.isArray(pageIds) ? pageIds : [pageIds]).filter(Boolean);
  if (!ids.length || !syncOn()) return { ok: true };
  const c = await cloud();
  const r = await c.binPages(client(), ids, binned);
  // The stamp bumps each row's rev server-side, so adopt the new ones here — otherwise the
  // next body push would be refused and reported as a conflict that was only ever a delete.
  for (const [id, rev] of Object.entries(r.revs || {})) {
    const prev = sync.pages[id] || {};
    sync.pages[id] = { rev, dirty: !!prev.dirty, purged: !!prev.purged };
  }
  saveSyncState();
  if (!r.ok) reportSyncFailure(r.error);
  return r;
}

/* ══════════════════════════════════════════════════════════════════════════════════════
 * CLOUD SYNC (B1291)
 * ════════════════════════════════════════════════════════════════════════════════════ */

let sync = { treeRev: null, treeDirty: false, pages: {}, images: {}, adopted: [] };  // see blankSync()
let syncState = { mode: "local", at: null, reason: null };
let cloudClient = null;
const conflicts = new Map();          // pageId → { serverDoc, serverRev, at }
const cloudImagePages = new Map();    // imageId → pageId, from the last seed's index
let busy = false;
let pushTimer = 0;
let pollTimer = 0;
let listening = false;
let onTreeChanged = null;

const PUSH_DEBOUNCE_MS = 1200;
const POLL_MS = 60000;

const client = () => cloudClient;

/** SCOPED = this is an account's notes, so every local write OWES the cloud a push. The
 *  bookkeeping is gated on this rather than on `syncOn` deliberately: the workspace reads
 *  and edits the moment it mounts, while the cloud module is still loading, and an edit made
 *  in that first second must not quietly escape the ledger and never be uploaded. */
const scoped = () => scope !== LOCAL_SCOPE;
/** SYNC ON = scoped AND a Supabase client actually exists — the gate for anything that
 *  touches the network. Signed out is not a degraded mode; it is the unchanged, complete
 *  behaviour the module shipped with, and nothing below runs at all. */
const syncOn = () => scoped() && !!cloudClient;

/* ---- the sync state, persisted per scope --------------------------------------------- */

const blankSync = () => ({ treeRev: null, treeDirty: false, pages: {}, images: {}, adopted: [] });

function readSyncRaw() {
  const s = store();
  if (!s) return null;
  try { return JSON.parse(s.getItem(syncKey()) || "null"); }
  catch (e) { fail("read", syncKey(), e); return null; }
}

/* A ledger that will not parse is REBUILT, not trusted: an unreadable one means this device
 * re-uploads work the cloud may already hold, which the revision guards make harmless — but
 * a half-read one could mark a real edit as already-pushed, which would lose it. */
function readSyncState() {
  const raw = readSyncRaw();
  const out = blankSync();
  if (!raw || typeof raw !== "object") return out;
  out.treeRev = Number.isFinite(raw.treeRev) ? raw.treeRev : null;
  out.treeDirty = !!raw.treeDirty;
  out.adopted = (Array.isArray(raw.adopted) ? raw.adopted : []).filter((x) => typeof x === "string");
  for (const [id, v] of Object.entries(raw.pages || {})) {
    if (v && typeof v === "object") out.pages[id] = { rev: Number.isFinite(v.rev) ? v.rev : null, dirty: !!v.dirty, purged: !!v.purged };
  }
  for (const [id, v] of Object.entries(raw.images || {})) {
    if (v && typeof v === "object") out.images[id] = { up: !!v.up, purged: !!v.purged };
  }
  return out;
}

/* A failure to persist the sync LEDGER is not a lost note — the bodies are already on disk
 * — but it does mean this device may re-push work it already pushed, so it is reported
 * rather than swallowed.
 *
 * ⛔ IT MERGES WITH WHAT IS ON DISK RATHER THAN OVERWRITING IT (B1391). Two windows of the
 * same account share this storage and not this memory, so a blind write here flattened
 * whatever the sibling window had just learned — which is how a base revision goes stale
 * and a perfectly ordinary push comes back refused, and reported as "someone else edited
 * this". The merge rules (including the one that keeps a DIRTY page's own base) live in
 * `mergeSyncState`, pure and unit-tested, in notesCloud.js. */
function saveSyncState() {
  const s = store();
  if (!s) return false;
  if (mergeState) sync = mergeState(sync, readSyncState());
  try { s.setItem(syncKey(), JSON.stringify(sync)); return true; }
  catch (e) { fail("write", syncKey(), e); return false; }
}

/* ---- the published sync state, and the ONE honest footer line ------------------------ */

const syncListeners = new Set();
export function onNotesSyncState(fn) { syncListeners.add(fn); return () => syncListeners.delete(fn); }
export function notesSyncState() { return { ...syncState }; }

function setSyncState(next) {
  syncState = { at: syncState.at, ...next };
  for (const fn of syncListeners) { try { fn({ ...syncState }); } catch (_) { /* a bad listener must not mute the rest */ } }
}

/* "Everything agrees" — but only when it actually does. A page still in conflict is NOT a
 * clean sync, so this reports the conflict state instead rather than letting the footer read
 * "Synced" over an unresolved note. Resolving one of two conflicts must not clear the line
 * for the other; that would be the same quiet lie one layer up. */
function noteSynced() {
  setSyncState(conflicts.size
    ? { mode: "conflict", at: Date.now(), reason: null }
    : { mode: "synced", at: Date.now(), reason: null });
}

/** LOUD-FAILURE, on the channel the footer reads. A sync that did not happen must never be
 *  able to render as "Synced" — so every failed push/pull lands here WITH a reason, and an
 *  offline browser is named as offline rather than as an error nobody can act on. */
function reportSyncFailure(error) {
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  setSyncState({ mode: offline ? "offline" : "error", reason: cloudReason(error), at: syncState.at });
  return false;
}

let reasonFn = null;
const cloudReason = (e) => (reasonFn ? reasonFn(e) : String(e || "an unknown problem").slice(0, 120));

/* Two pure decisions from the cloud tier, held here as plain functions because the paths
 * that need them are SYNCHRONOUS (a ledger write, a storage event). They are set the moment
 * the cloud module loads; until then `saveSyncState` simply writes without merging, which is
 * the pre-B1391 behaviour and is safe — nothing has synced yet. */
let mergeState = null;
let judgeConflictFn = null;

/** THE ONE LINE THE FOOTER SHOWS, and the only place the product says where a note lives.
 *
 *  ⛔ It may only claim a cloud copy when there IS one. Before B1291 this said "Saved on
 *  this device" plus the workspace's own "· not synced to the cloud yet", because that was
 *  true; that sentence is GONE, replaced (not joined) by the states below. A "Synced" that
 *  did not sync is the B209 / B595 / B610 failure class LOUD-FAILURE exists to prevent. */
export function notesStorageLine({ now = Date.now() } = {}) {
  if (scope === LOCAL_SCOPE) return { text: "Saved on this device", tone: "quiet" };
  switch (syncState.mode) {
    case "syncing": return { text: "Saved on this device · syncing", tone: "quiet" };
    case "synced": {
      const rel = relativeTime(syncState.at, { now });
      return { text: rel === "just now" || !rel ? "Synced to your account just now" : `Synced to your account ${rel} ago`, tone: "good" };
    }
    case "conflict": return { text: "Synced · one note also changed in another window", tone: "warn" };
    case "offline": return { text: "Saved on this device · offline, it will sync when you are back", tone: "warn" };
    case "error": return { text: `Saved on this device · sync failed: ${syncState.reason}`, tone: "error" };
    default: return { text: "Saved on this device", tone: "quiet" };
  }
}

/** The honest one-line description of where these notes live, for the page header's hover.
 *  Delegates to the footer line so the two can never disagree. */
export function notesScopeLabel() { return notesStorageLine().text; }

/** ⛔ THE CONFLICT BAR'S WORDS, AND THEY MAY NEVER IMPLY ANOTHER PERSON (B1391).
 *
 *  Notes are own-row and private by default: nobody but the account holder can read one,
 *  let alone write it. So every copy on this path names a WINDOW or a COMPUTER — never a
 *  someone. "The other person's copy" was not a clumsy phrase, it was a false statement
 *  about who has access, and it is what made a routine two-tab reconciliation read as a
 *  security event.
 *
 *  It lives HERE, beside `notesStorageLine`, because this file already owns the product's
 *  sentences about where a note lives — and because a pure function is something a test can
 *  hold to the rule, which a string inlined in JSX is not. */
export function notesConflictLine(title) {
  const name = String(title || "").trim() || "Untitled";
  return {
    text: `“${name}” also changed in another of your windows. Nothing was overwritten — pick which to keep.`,
    keepMine: "Keep this one",
    keepTheirs: "Use the other",
    /** What the un-picked copy is parked as, so choosing can never lose the other text. */
    parkedSuffix: "(this window’s copy)",
  };
}

/* ---- conflicts ------------------------------------------------------------------------
 *
 * TWO DEVICES, ONE PAGE, BOTH EDITED. Neither copy is destroyed and neither wins by
 * default: the page is named as conflicted and the user chooses. `resolveNotesConflict`
 * is the only way out, and both of its answers are explicit. */

/* ---- "this page's body changed underneath you" (B1391) --------------------------------
 *
 * THE SELF-RACE THE PROMPT WAS ONLY A SYMPTOM OF. A page's body can be replaced under an
 * open editor by three things that are not the person typing: the cloud seed adopting the
 * server's row, a silent reconciliation above, and — the common one — the SAME ACCOUNT in a
 * SECOND WINDOW of this browser writing the same key. The editor read its document once, at
 * mount (deliberately: see NoteEditor's header). So without this channel it holds a stale
 * copy, and the next keystroke writes that whole stale document back — guarded by a
 * revision this device now legitimately holds, so it commits CLEANLY and the other window's
 * paragraph is gone with no conflict, no banner and no way to notice. That is exactly the
 * B1113 / ROWS-CANONICAL-ON-SEED trap, in Notes.
 *
 * A page is announced ONLY when this device has no pending edit of its own on it — an
 * unflushed local edit is real work and must never be dropped to pick up a remote copy;
 * that case is the genuine conflict, and it still goes through `judgeConflict`. */
const pageListeners = new Set();
export function onNotesPagesChanged(fn) { pageListeners.add(fn); return () => pageListeners.delete(fn); }
function emitPagesChanged(pageIds) {
  const ids = (pageIds || []).filter((id) => id && !sync.pages[id]?.dirty);
  if (!ids.length) return;
  for (const fn of pageListeners) { try { fn(ids); } catch (_) { /* a bad listener must not mute the rest */ } }
}

/** ⛔ THE SAME ANNOUNCEMENT WITHOUT THE DIRTY GUARD — and it has exactly one legitimate
 *  caller shape (NEW-4). `emitPagesChanged` skips a page this window has unflushed edits
 *  on, because a remount would discard them: correct for a change arriving from OUTSIDE
 *  (a sibling window, the cloud seed), where we cannot know what the editor holds. This
 *  one is for a change THIS module just made itself, to a page it has already established
 *  no open editor is holding (`openDoc` is checked first). Never call it for a write whose
 *  page might be on screen. */
function announcePages(pageIds) {
  const ids = (pageIds || []).filter(Boolean);
  if (!ids.length) return;
  for (const fn of pageListeners) { try { fn(ids); } catch (_) { /* a bad listener must not mute the rest */ } }
}

const conflictListeners = new Set();
export function onNotesConflict(fn) { conflictListeners.add(fn); return () => conflictListeners.delete(fn); }
export function notesConflicts() { return [...conflicts.keys()]; }
export function notesConflictFor(pageId) { return conflicts.get(pageId) || null; }
function emitConflicts() {
  const ids = [...conflicts.keys()];
  for (const fn of conflictListeners) { try { fn(ids); } catch (_) { /* a bad listener must not mute the rest */ } }
}

/* ⛔ A NO-OP CONFLICT MUST NEVER PROMPT (B1391).
 *
 * Both paths that can lose a revision race — the seed's plan and a refused push — come
 * through here BEFORE anyone is interrupted. `judgeConflict` (pure, in notesCloud.js)
 * answers the only question worth asking: do the two copies actually say different things?
 *
 *   • identical      → adopt the server's revision and clear the dirty flag. Nothing to
 *                      write locally (the text is already the same) and nothing to say.
 *   • nothing-local  → this device has no body or an empty one; take the row's, and tell
 *                      the workspace so an editor open on that page re-reads it.
 *   • diverged       → return false. The caller names it, and the user chooses.
 *
 * Returns true when the page was settled without a word. A settled page is also REMOVED
 * from any existing conflict entry: a conflict that has since become a non-conflict must
 * not leave a bar on screen with nothing behind it. */
function settleQuietly(pageId, row) {
  if (!judgeConflictFn || !row || row.purged) return false;
  const localDoc = readPage(pageId);
  const verdict = judgeConflictFn({ localDoc, serverDoc: row.doc });
  if (!verdict.silent) return false;
  if (verdict.why === "nothing-local") {
    if (!writePageLocal(pageId, row.doc)) return false;   // LOUD-FAILURE: a refused write is not a resolution
    emitPagesChanged([pageId]);
  }
  sync.pages[pageId] = { rev: row.rev, dirty: false, purged: false };
  conflicts.delete(pageId);
  return true;
}

/** Resolve one conflict. `"mine"` forces this device's body up (guarded against whatever the
 *  server holds right now, so it is a checked update and not a blind overwrite). `"theirs"`
 *  writes the other device's body down.
 *
 *  ⛔ "theirs" DOES NOT DESTROY THE LOCAL COPY BY ITSELF. The workspace parks this device's
 *  text as a sibling page first and only then calls this — so "never a lost edit" holds
 *  literally, not approximately. */
export async function resolveNotesConflict(pageId, choice) {
  const entry = conflicts.get(pageId);
  if (!entry || !syncOn()) return { ok: false, error: "nothing to resolve" };
  const c = await cloud();
  if (choice === "theirs") {
    if (!writePageLocal(pageId, entry.serverDoc)) return { ok: false, error: "the other window’s copy could not be saved here" };
    sync.pages[pageId] = { rev: entry.serverRev, dirty: false, purged: false };
    saveSyncState();
    conflicts.delete(pageId);
    emitPagesChanged([pageId]);   // the editor must show the copy that was just chosen
    emitConflicts();
    noteSynced();
    return { ok: true };
  }
  const r = await c.forcePage(client(), pageId, readPage(pageId));
  if (!r.ok) return { ok: false, error: reportSyncFailure(r.error) || r.error || "the push was refused" };
  sync.pages[pageId] = { rev: r.rev, dirty: false, purged: false };
  saveSyncState();
  conflicts.delete(pageId);
  emitConflicts();
  noteSynced();
  return { ok: true };
}

/* ---- the sign-in migration ------------------------------------------------------------ */

/** Adopt the signed-OUT pages into this account. COPIES — the `local` scope is left
 *  exactly as it was, so signing out lands you back on the same notes rather than on
 *  nothing. Idempotent by top-level page id, so it cannot duplicate a page it already
 *  adopted, and it needs no "already done" marker to get out of step with. */
async function adoptLocalNotes() {
  const c = await cloud();
  const localTree = migrate(readTreeRaw(LOCAL_SCOPE));
  const accountTree = migrate(readTreeRaw(scope));
  const plan = c.planAdoption(localTree, accountTree, { already: sync.adopted || [] });
  if (!plan.pages.length) return { adopted: 0 };

  const merged = { ...accountTree, pages: [...(accountTree.pages || []), ...plan.pages] };
  for (const id of plan.pageIds) {
    const body = readPage(id, LOCAL_SCOPE);
    if (body != null) writePageLocal(id, body, scope);
  }
  // Pictures ride along, re-keyed into the account's scope. Without this half an adopted
  // note would open with every figure broken — the exact half this item refused to ship.
  const db = await imageDb();
  const wanted = new Set(plan.pageIds);
  for (const m of await db.idbListImageMeta(LOCAL_SCOPE)) {
    if (!wanted.has(m.pageId)) continue;
    const rec = await db.idbGetImage(imageKey(m.id, LOCAL_SCOPE));
    if (!rec?.dataUrl) continue;
    await db.idbPutImage({ ...rec, key: imageKey(m.id, scope), scope });
  }
  if (!writeTreeLocal(merged, scope)) return { adopted: 0, error: "the adopted notes could not be saved" };
  sync.treeDirty = true;
  for (const id of plan.pageIds) sync.pages[id] = { rev: null, dirty: true, purged: false };
  // ADOPTED-ONCE, EVER. Recorded before the push, so a notebook the user later deletes from
  // the account is not copied back in on the next sign-in (see planAdoption's header).
  sync.adopted = [...new Set([...(sync.adopted || []), ...plan.pages.map((n) => n.id)])];
  saveSyncState();
  return { adopted: plan.pages.length };
}

/* ---- the seed + the push -------------------------------------------------------------- */

/** Start syncing this scope. Signed out this is a no-op and the module behaves exactly as
 *  it did before cloud sync existed — that is the contract, not a fallback.
 *  `onTree` is called whenever the cloud changed the local tree, so the workspace re-reads. */
export async function startNotesSync({ onTree } = {}) {
  onTreeChanged = onTree || null;
  attachSiblingListener();   // every scope: a second window is a second window (B1391)
  if (scope === LOCAL_SCOPE) { setSyncState({ mode: "local" }); return { ok: true, mode: "local" }; }
  const c = await cloud();
  reasonFn = c.syncFailureReason;
  mergeState = c.mergeSyncState;
  judgeConflictFn = c.judgeConflict;
  cloudClient = c.cloudClient();
  if (!cloudClient) { setSyncState({ mode: "local" }); return { ok: true, mode: "local" }; }
  sync = readSyncState();
  attachListeners();
  await adoptLocalNotes();
  return { ok: await seed({ full: true }), mode: "cloud" };
}

export function stopNotesSync() {
  if (pushTimer) { clearTimeout(pushTimer); pushTimer = 0; }
  if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
  detachListeners();
  detachSiblingListener();
  cloudClient = null;
  onTreeChanged = null;
}

/* Cross-DEVICE refresh: coming back to the tab re-seeds, and a slow poll covers a tab left
 * open beside the other machine. Both are cheap by construction — the tree is compared by
 * its REVISION (one integer) and the page index carries no documents. */
const onVisible = () => { if (typeof document === "undefined" || document.visibilityState === "visible") refreshNotesSync(); };
function attachListeners() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onVisible);
  pollTimer = setInterval(onVisible, POLL_MS);
}
function detachListeners() {
  if (!listening || typeof window === "undefined") return;
  listening = false;
  window.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
  window.removeEventListener("online", onVisible);
}

/* The sibling-window listener is attached for EVERY scope, signed in or out — two windows
 * of one browser share this storage whether or not a cloud is involved, and the stale-editor
 * self-race below is a local-storage race first and a sync race second. */
let siblingListening = false;
function attachSiblingListener() {
  if (siblingListening || typeof window === "undefined") return;
  siblingListening = true;
  window.addEventListener("storage", onSiblingWindow);
}
function detachSiblingListener() {
  if (!siblingListening || typeof window === "undefined") return;
  siblingListening = false;
  window.removeEventListener("storage", onSiblingWindow);
}

/* ---- the SECOND WINDOW of the same account (B1391) ------------------------------------
 *
 * `storage` fires in every OTHER tab of this origin when one of them writes — so it is the
 * one place a window can learn, immediately and for free, what its sibling just did. Before
 * this, two windows of one account only ever met at the server, minutes apart, through a
 * revision guard: the whole false-alarm class the owner hit ("someone else is editing this"
 * when the someone else was his own second tab).
 *
 * Three keys matter, and each has its own answer:
 *   the LEDGER  merge, never adopt wholesale — see `mergeSyncState` for why a dirty page
 *               keeps its own base revision
 *   the TREE    re-read it: a notebook added, renamed or binned next door is not news that
 *               should wait for a poll
 *   a PAGE      announce it, so an editor open on that page re-reads instead of writing its
 *               stale copy back over it
 *
 * It is attached only for a SIGNED-IN scope, alongside the rest of the sync listeners. The
 * signed-out multi-window case is covered too, by the workspace's own listener — the store
 * is not running there at all, by design. */
function onSiblingWindow(e) {
  try {
    if (!e || (e.storageArea && typeof window !== "undefined" && e.storageArea !== window.localStorage)) return;
    const key = e.key;
    if (!key) return;                                  // a whole-store clear: nothing specific to reconcile
    if (key === syncKey()) { sync = mergeState ? mergeState(sync, readSyncState()) : readSyncState(); return; }
    if (key === treeKey()) { onTreeChanged?.(); return; }
    const prefix = `${PAGE_KEY_BASE}:${scope}:`;
    if (key.startsWith(prefix)) emitPagesChanged([key.slice(prefix.length)]);
  } catch (e) {
    // LOUD-FAILURE: reaching here means this browser's storage refused a plain read, which
    // is a real failure and is named on the same banner as every other one — it is never
    // swallowed just because the trigger was a background event.
    fail("read", syncKey(), e);
  }
}

/** Pick up anything another device changed, and push anything this one owes. */
export async function refreshNotesSync() {
  if (!syncOn() || busy) return true;
  return seed({ full: false });
}

/* The whole pull-reconcile-push pass. Returns a plain boolean because every one of its
 * failure paths is already reported through `reportSyncFailure` — the return value only
 * tells the caller whether the account and this device now agree. */
async function seed({ full }) {
  if (!syncOn() || busy) return true;
  busy = true;
  setSyncState({ mode: "syncing" });
  try {
    const c = await cloud();
    let treeChanged = false;

    /* ---- the tree: rows canonical on seed, MERGED (never clobbered) when both moved ---- */
    const srv = await c.fetchTree(client());
    if (!srv.ok) return reportSyncFailure(srv.error);
    if (srv.tree) {
      if (!sync.treeDirty) {
        if (srv.rev !== sync.treeRev) { treeChanged = writeTreeLocal(migrate(srv.tree)); }
        sync.treeRev = srv.rev;
      } else {
        treeChanged = writeTreeLocal(c.mergeTrees(migrate(readTreeRaw()), migrate(srv.tree)));
        sync.treeRev = srv.rev;
      }
    } else {
      sync.treeRev = null;
      sync.treeDirty = true;      // nothing up there yet — this device's tree is the seed
    }

    /* ---- page bodies ---------------------------------------------------------------- */
    const idx = await c.fetchPageIndex(client());
    if (!idx.ok) { saveSyncState(); return reportSyncFailure(idx.error); }
    const plan = c.planPageSeed({ index: idx.index, state: sync, localIds: listStoredPageIds() });

    // Purged elsewhere: clear the bytes here (body AND pictures) and remember the tombstone,
    // so a late local flush can never push the note back up.
    if (plan.purged.length) {
      const imgs = [];
      for (const id of plan.purged) for (const imgId of imageIdsInDoc(readPage(id))) imgs.push(imgId);
      deletePages(plan.purged);
      if (imgs.length) await deleteNoteImages(imgs);
      for (const id of plan.purged) sync.pages[id] = { rev: sync.pages[id]?.rev ?? null, dirty: false, purged: true };
      for (const id of imgs) sync.images[id] = { up: false, purged: true };
    }

    const need = [...plan.adopt, ...plan.conflicts];
    if (need.length) {
      const got = await c.fetchPages(client(), need);
      if (!got.ok) { saveSyncState(); return reportSyncFailure(got.error); }
      const adopted = [];
      for (const id of plan.adopt) {
        const row = got.pages[id];
        if (!row || row.purged) continue;
        if (writePageLocal(id, row.doc)) { sync.pages[id] = { rev: row.rev, dirty: false, purged: false }; adopted.push(id); }
      }
      // An adopted body under an OPEN editor is the self-race, not a background detail —
      // the workspace re-reads it rather than letting a stale document commit cleanly.
      emitPagesChanged(adopted);
      let changed = false;
      for (const id of plan.conflicts) {
        const row = got.pages[id];
        if (!row) continue;
        // A MOVED REVISION IS NOT YET A DISAGREEMENT (B1391). Only a real divergence may
        // interrupt; identical text, or nothing here to lose, reconciles in silence.
        if (settleQuietly(id, row)) { changed = true; continue; }
        conflicts.set(id, { serverDoc: row.doc, serverRev: row.rev, at: Date.now() });
        changed = true;
      }
      if (changed) emitConflicts();
    }

    // Whatever the plan says local wins on, carry the rev it must be guarded against.
    for (const u of plan.upload) sync.pages[u.id] = { rev: u.base, dirty: true, purged: false };
    saveSyncState();

    /* ---- pictures: eager UP, lazy DOWN (see planImageSync) ---------------------------- */
    if (full) {
      const iIdx = await c.fetchImageIndex(client());
      if (iIdx.ok) {
        cloudImagePages.clear();
        for (const r of iIdx.index) if (r.pageId) cloudImagePages.set(r.id, r.pageId);
        const db = await imageDb();
        const meta = await db.idbListImageMeta(scope);
        const imgPlan = c.planImageSync({ index: iIdx.index, localMeta: meta, state: sync });
        if (imgPlan.dropLocal.length) {
          await deleteNoteImages(imgPlan.dropLocal);
          for (const id of imgPlan.dropLocal) sync.images[id] = { up: false, purged: true };
        }
        for (const id of imgPlan.upload) {
          const rec = await db.idbGetImage(imageKey(id));
          if (!rec?.dataUrl) continue;
          // `kind`/`name` ride along so an ATTACHMENT re-uploads as one (NEW-5) — a v1
          // record has neither, and absent means picture, which is what every one was.
          await uploadImage({ id, pageId: rec.pageId, dataUrl: rec.dataUrl, mime: rec.mime, w: rec.w, h: rec.h, bytes: rec.bytes, kind: rec.kind || "image", name: rec.name || "" });
        }
        saveSyncState();
      } else { reportSyncFailure(iIdx.error); }
    }

    busy = false;
    const pushed = await pushPending();
    if (treeChanged) onTreeChanged?.();
    return pushed;
  } catch (e) {
    // Nothing in the transport throws by contract, so reaching here means something
    // unexpected did. It is still NAMED on the footer rather than left as a silent
    // "syncing…" that never resolves, which is the state this rule exists to forbid.
    reportSyncFailure(e?.message || e);
    return false;
  } finally { busy = false; }
}

/** Push everything this device owes, each write guarded on the revision it was based on.
 *  A refusal is a CONFLICT, never a retry that clobbers. */
async function pushPending() {
  if (!syncOn()) return true;
  const c = await cloud();
  let ok = true;

  const dirtyPages = Object.keys(sync.pages).filter((id) => sync.pages[id].dirty && !sync.pages[id].purged && !conflicts.has(id));
  if (dirtyPages.length || sync.treeDirty) setSyncState({ mode: "syncing" });
  for (const id of dirtyPages) {
    const doc = readPage(id);
    if (doc == null) { sync.pages[id] = { ...sync.pages[id], dirty: false }; continue; }
    const r = await c.pushPage(client(), id, doc, sync.pages[id].rev);
    if (r.ok) { sync.pages[id] = { rev: r.rev, dirty: false, purged: false }; continue; }
    if (r.conflict) {
      const got = await c.fetchPages(client(), [id]);
      const row = got.pages?.[id];
      if (row?.purged) { deletePages([id]); sync.pages[id] = { rev: row.rev, dirty: false, purged: true }; continue; }
      // THE REFUSAL IS NOT THE BUG REPORT (B1391). The guard did its job — now find out
      // whether the two copies actually differ before saying a word to anyone.
      if (row && settleQuietly(id, row)) { emitConflicts(); continue; }
      if (row) { conflicts.set(id, { serverDoc: row.doc, serverRev: row.rev, at: Date.now() }); emitConflicts(); }
      ok = false;
      continue;
    }
    ok = reportSyncFailure(r.error) && ok;
  }

  if (sync.treeDirty) {
    let r = await c.pushTree(client(), readTreeRaw(), sync.treeRev);
    if (!r.ok && r.conflict) {
      // Someone else wrote the structure. MERGE and push once more — never overwrite, and
      // never spin: a second refusal simply leaves the tree dirty for the next seed.
      const again = await c.fetchTree(client());
      if (again.ok) {
        const merged = c.mergeTrees(migrate(readTreeRaw()), migrate(again.tree));
        writeTreeLocal(merged);
        onTreeChanged?.();
        r = await c.pushTree(client(), merged, again.rev);
      }
    }
    if (r.ok) { sync.treeRev = r.rev; sync.treeDirty = false; }
    else { ok = r.conflict ? false : reportSyncFailure(r.error) && ok; }
  }

  saveSyncState();
  if (ok) noteSynced();   // …which reports the conflict state when one is still open
  return ok;
}

/* The debounced push. It exists so a keystroke stream costs one request, not one per
 * character — the same reasoning as the local save debounce, one layer out. */
function schedulePush() {
  if (!syncOn()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = 0; pushPending(); }, PUSH_DEBOUNCE_MS);
}

async function uploadImage(rec) {
  const c = await cloud();
  const r = await c.pushImage(client(), scope, rec);
  if (r.ok) { sync.images[rec.id] = { up: true, purged: false }; saveSyncState(); return true; }
  // Named, not swallowed — and self-healing: the picture stays unmarked, so the next seed
  // finds it missing on the server and tries again.
  const what = rec.kind === "file" ? `“${rec.name || "a file"}” was attached on this device` : "A picture was saved on this device";
  failImage(`${what} but could NOT be copied to your account, so it will not appear on your other computers yet.`, r.error);
  return reportSyncFailure(r.error);
}

/* ---- version history (NEW-3) ------------------------------------------------------------
 *
 * ⛔ SNAPSHOTS GO TO INDEXEDDB, NEVER TO LOCALSTORAGE (TIER-BY-REBUILDABILITY). The small
 * tier was measured at ~78% of a hard ~5 MB cap on the owner's own browser with real saved
 * plans in it; a note's typing history is bulky and bursty and would crowd irreplaceable
 * work out of exactly the store that must never fill. Snapshots are user work, so they are
 * BUDGETED rather than evicted under pressure — the budget is `planRetention`, which runs
 * after every write.
 *
 * ⛔ AND THEY ARE DEVICE-LOCAL IN THIS VERSION, WHICH IS A STATED LIMIT, NOT AN OVERSIGHT.
 * History does not ride the cloud sync: it needs no schema change, it cannot fight the
 * server-owned `rev`, and it covers the risk the feature was asked for — a note mangled on
 * the machine you are sitting at, including by a second window of the same account writing
 * over it, because THIS device snapshotted the state before that arrived. What it does not
 * cover is losing the device itself; that is on the backlog by name rather than implied.
 */
const versionKey = (pageId, at) => `${scope}:${pageId}:${at}`;
const versionPageKey = (pageId, s = scope) => `${s}:${pageId}`;

/** A short plain-text preview, stored WITH the row so listing a history costs no document
 *  reads — the same reasoning as the image metadata index. */
const previewOf = (doc) => docToText(doc).replace(/\s+/g, " ").slice(0, 160);

/** Take a snapshot of one page, if one is due. `force` is for the moments that always
 *  deserve a row: leaving the page, and either side of a restore.
 *
 *  Returns `{ ok, taken, at }` — never throws, and a refusal is named on the one error
 *  channel like every other storage failure (LOUD-FAILURE). */
export async function snapshotPage(pageId, doc, { reason = "typing", pinned = false, force = false, now = Date.now() } = {}) {
  if (!pageId || !doc) return { ok: false, taken: false, error: "nothing to snapshot" };
  const db = await imageDb();
  if (!db.notesIdbAvailable()) return { ok: false, taken: false, error: "this browser will not let Planyr keep version history" };

  const existing = await db.idbListVersions(versionPageKey(pageId));
  const newest = existing[0] || null;
  if (!force && !shouldSnapshot(newest?.at, now)) return { ok: true, taken: false, at: newest?.at ?? null };
  // Nothing changed since the last snapshot → no row. A history of identical entries is
  // noise that pushes the useful one off the bottom of the list.
  if (newest && !force) {
    const prev = await db.idbGetVersion(newest.key);
    if (prev?.doc && JSON.stringify(prev.doc) === JSON.stringify(doc)) return { ok: true, taken: false, at: newest.at };
  }

  const at = newest && newest.at >= now ? newest.at + 1 : now;   // one row per instant, always
  const body = JSON.stringify(doc);
  const r = await db.idbPutVersion({
    key: versionKey(pageId, at), page: versionPageKey(pageId), scope, pageId,
    at, reason, pinned: !!pinned, bytes: body.length, preview: previewOf(doc), doc,
  });
  if (!r.ok) {
    failImage("A version of this note could NOT be kept, so its history may have a gap. Your note itself is unaffected.", r.error);
    return { ok: false, taken: false, error: r.error };
  }
  await applyRetention(pageId, now);
  return { ok: true, taken: true, at };
}

/** Enforce the retention plan for one page. Pure decision, storage-side effect — the split
 *  is what makes every tier boundary a unit test rather than a hope. */
async function applyRetention(pageId, now = Date.now()) {
  const db = await imageDb();
  const rows = await db.idbListVersions(versionPageKey(pageId));
  const { drop } = planRetention(rows.map((r) => ({ id: r.key, at: r.at, pinned: r.pinned })), { now, max: MAX_VERSIONS_PER_PAGE });
  if (drop.length) await db.idbDeleteVersions(drop);
  return drop.length;
}

/** One page's history, newest first, without the documents (a list of dates costs no
 *  document reads). */
export async function readPageVersions(pageId) {
  if (!pageId) return [];
  const db = await imageDb();
  return db.idbListVersions(versionPageKey(pageId));
}

/** One snapshot's document. */
export async function readPageVersion(key) {
  if (!key) return null;
  const rec = await (await imageDb()).idbGetVersion(key);
  return rec?.doc || null;
}

/** ⛔ RESTORE — AND IT CREATES A NEW VERSION RATHER THAN DESTROYING HISTORY.
 *
 *  The state being left is snapshotted FIRST and pinned, so restoring the wrong version is
 *  itself undoable by restoring the one taken a second earlier. Nothing here deletes a row.
 *  `planRestore` (pure) decides the two writes; this function performs them, in that order,
 *  and reports honestly if either refuses. */
export async function restorePageVersion(pageId, key, { now = Date.now() } = {}) {
  if (!pageId || !key) return { ok: false, error: "nothing to restore" };
  const rec = await (await imageDb()).idbGetVersion(key);
  if (!rec?.doc) return { ok: false, error: failImage("That version could not be read back, so nothing was changed.").message };

  const plan = planRestore({ currentDoc: readPage(pageId), versionDoc: rec.doc, versionAt: rec.at, now });
  if (!plan.ok) return { ok: false, error: plan.error };

  if (plan.snapshotCurrent) {
    await snapshotPage(pageId, plan.snapshotCurrent.doc, { reason: "before-restore", pinned: true, force: true, now: plan.snapshotCurrent.at });
  }

  /* ⛔ WHEN THE PAGE IS OPEN, THE RESTORE IS AN **EDIT**, NOT A WRITE BEHIND THE EDITOR'S
   * BACK. Writing the JSON straight to storage while an editor holds the old document is
   * the same silent-loss shape the task rollup guards against, only worse: the editor's
   * own unmount flush would write its stale copy back over the restored one a moment
   * later. Handed to the editor it becomes one ordinary transaction — undoable, saved
   * through the one save path, and visible immediately. */
  if (openDoc && openDoc.pageId === pageId && typeof openDoc.applyDocument === "function") {
    const applied = openDoc.applyDocument(plan.apply.doc);
    if (!applied?.ok) return { ok: false, error: applied?.error || "the restored version could not be applied" };
  } else if (!writePage(pageId, plan.apply.doc)) {
    return { ok: false, error: "the restored version could not be saved, so nothing was changed" };
  }
  await snapshotPage(pageId, plan.apply.doc, { reason: "restored", pinned: true, force: true, now: plan.apply.at });
  return { ok: true, at: plan.apply.at };
}

/** Destroy a set of pages' history — the purge's hands only. */
export async function deletePageVersions(pageIds) {
  const ids = (Array.isArray(pageIds) ? pageIds : [pageIds]).filter(Boolean);
  if (!ids.length) return { ok: true, removed: 0 };
  const db = await imageDb();
  const keys = [];
  for (const id of ids) for (const row of await db.idbListVersions(versionPageKey(id))) keys.push(row.key);
  if (!keys.length) return { ok: true, removed: 0 };
  return db.idbDeleteVersions(keys);
}

/* ---- the task rollup (NEW-4) -------------------------------------------------------------
 *
 * ⛔ TICKING AN ITEM IN THE ROLLUP GOES THROUGH THE OPEN EDITOR WHEN THERE IS ONE.
 * The obvious implementation — read the page's JSON, flip the flag, write it back — is a
 * silent data-loss bug whenever the page being ticked is the page on screen: the editor
 * holds its document in memory, has up to a debounce of unflushed typing, and would write
 * the whole of its stale copy back over the change a moment later. So an editor REGISTERS
 * itself here while it is mounted, and a toggle for that page is handed to it as a real
 * editor transaction — which lands in the same document, in the same undo history, and
 * flushes through the same save path as any other edit. Every OTHER page takes the JSON
 * route and the store announces the change so nothing else is holding a stale copy either.
 */
let openDoc = null;

/** The mounted editor claims its page, handing over the two operations that must go
 *  through it rather than round the back of it: ticking one checklist item (NEW-4) and
 *  replacing the whole document on a restore (NEW-3). Returns the un-register, so a page
 *  switch cannot leave a dead claim behind (which would send an edit into a torn-down
 *  editor). */
export function registerOpenNoteDoc(pageId, { applyTaskToggle, applyDocument } = {}) {
  openDoc = { pageId, applyTaskToggle, applyDocument };
  return () => { if (openDoc && openDoc.pageId === pageId) openDoc = null; };
}

/** Every UNCHECKED checklist item across a scope, in the rail's own page order. Reads
 *  bodies, so it lives here rather than in the pure model — the roll-up itself is pure
 *  (lib/notesTasks.js) and is unit-tested there. */
export function collectOpenTasks(tree, { projectId = null, scope: sc = SCOPE_PROJECT } = {}) {
  const pid = sc === SCOPE_ALL ? null : projectId;
  const pages = [];
  const scoped = { pages: pagesInScope(tree, pid, pid == null ? SCOPE_ALL : SCOPE_PROJECT) };
  walkPages(scoped, (pg, { root, trail }) => {
    pages.push({ pageId: pg.id, pageTitle: pg.title, projectId: root.projectId ?? null, trail: trail || [] });
  });
  const bodies = {};
  for (const p of pages) bodies[p.pageId] = readPage(p.pageId);
  return rollUpOpenTasks(pages, bodies);
}

/** Tick (or un-tick) one checklist item from the rollup. Returns `{ ok, changed }`. */
export function toggleNoteTask(pageId, { index, text }, checked) {
  if (!pageId) return { ok: false, changed: false };
  if (openDoc && openDoc.pageId === pageId && typeof openDoc.applyTaskToggle === "function") {
    return openDoc.applyTaskToggle({ index, text }, checked);
  }
  const doc = readPage(pageId);
  if (!doc) return { ok: false, changed: false };
  const r = setTaskCheckedInDoc(doc, { index, text }, checked);
  if (!r.changed) return { ok: true, changed: false };
  if (!writePage(pageId, r.doc)) return { ok: false, changed: false };
  announcePages([pageId]);
  return { ok: true, changed: true };
}

/** How many open items one page has — used nowhere but the tests and any future badge;
 *  exported so the rollup's definition of "open" has exactly one home. */
export function openTaskCount(pageId) {
  return openTasksInDoc(readPage(pageId)).length;
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
export function searchNotes(tree, query, { projectId = null, scope = SCOPE_PROJECT } = {}) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];
  // Search obeys the SAME scope the rail is showing (B1374). A search that silently spans
  // notebooks the rail is hiding would answer a question the user did not ask; one that
  // could never span them would make a mis-bound note unfindable, which is the bug.
  const pid = scope === SCOPE_ALL ? null : projectId;
  const titleHits = searchTitles(tree, query, { projectId: pid });
  const seen = new Set(titleHits.map((h) => h.pageId));
  const bodyHits = [];
  // The SAME scoped roots the title search walked, at every depth — a subpage's body has to
  // be as findable as a top-level one, or nesting would quietly hide notes.
  const scoped = { pages: pagesInScope(tree, pid, pid == null ? SCOPE_ALL : SCOPE_PROJECT) };
  walkPages(scoped, (pg, { root, depth }) => {
    if (seen.has(pg.id)) return;
    const text = docToText(readPage(pg.id));
    if (!text || !text.toLowerCase().includes(q)) return;
    bodyHits.push({
      pageId: pg.id, pageTitle: pg.title, projectId: root.projectId ?? null, depth,
      where: "body", excerpt: excerptAround(text, q),
    });
  });
  return [...titleHits, ...bodyHits];
}
