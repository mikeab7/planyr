/* notesCloud — the cloud tier UNDER the notes storage seam (B1291).
 *
 * ⛔ NOTHING OUTSIDE lib/notesStore.js MAY IMPORT THIS FILE. It is the exact twin of
 * lib/notesImageDb.js one layer down: the store stays the ONE seam every component, model
 * function and exporter talks to, and this is a private implementation tier beneath it.
 *
 * THAT IS THE DELIBERATE WIDENING OF THE SEAM the B1291 item asked to be named. The store's
 * PUBLIC surface (`readTreeRaw` / `writeTree` / `readPage` / `writePage` / `putNoteImage` /
 * `purgePages` …) did not change at all, so no caller learned that storage moved — the seam
 * held exactly as designed. What grew is what lives BEHIND it, and it grew into its own
 * file for the same reason the IndexedDB tier did: a sync engine inlined into notesStore.js
 * would have doubled that file and buried the LOCAL path, which is the path that must keep
 * working, byte-identically, for a signed-out user.
 *
 * TWO HALVES, and the split is what makes any of this provable:
 *   • PURE DECISIONS — `mergeTrees`, `planPageSeed`, `planImageSync`, `planAdoption`,
 *     `emptySyncState`. No network, no client, no storage. Every merge rule is decided here
 *     and unit-tested in test/notesSync.test.js.
 *   • TRANSPORT — every function takes the Supabase client as its FIRST parameter (the
 *     pinStore / folders.js pattern), so a test hands it a fake. Nothing here throws:
 *     every call resolves to `{ ok:true, … }` or `{ ok:false, error }`, because the caller
 *     has to turn a failure into a named banner (LOUD-FAILURE) and a swallowed rejection
 *     reads as a clean sync — which is the one thing this module must never do.
 *
 * ═══ THE SERVER CONTRACT (schema: src/workspaces/notes/db/notes_cloud_sync.sql) ═════════
 * Applied to production 2026-07-31 as migration `notes_cloud_sync_b1291`.
 *   notes_trees   (user_id PK)      data jsonb · rev · updated_at/by
 *   notes_pages   (user_id,id PK)   doc jsonb · rev · deleted_at · purged_at
 *   notes_images  (user_id,id PK)   path · mime · bytes · width/height · page_id · deleted_at
 *   storage bucket `notes-images`, PRIVATE, objects at <uid>/<imageId>
 *
 * ⛔ `rev` IS SERVER-OWNED. A BEFORE INSERT OR UPDATE trigger (`public.notes_touch_rev`)
 * bumps it and stamps `updated_at`/`updated_by`, so this file NEVER sends a rev on an
 * update — it sends the GUARD `.eq("rev", base)` and reads the new value back with
 * `.select("rev")`. Zero rows returned means the base moved: another device wrote first.
 * That is a CONFLICT and it is surfaced by name; there is no last-writer-wins path here,
 * and no blind retry over a refusal.
 *
 * ═══ WHICH COPY WINS (ROWS-CANONICAL-ON-SEED, the Notes edition) ════════════════════════
 * The rule is written out in full in the header of notesStore.js, where the next person to
 * touch storage will read it. The mechanical half is `planPageSeed`:
 *   • a page the SERVER HAS ALREADY SEEN → the server row wins on seed, UNLESS a pending
 *     local edit explains the difference (`adopt`);
 *   • a page the server has NEVER seen → local always wins and is uploaded (`upload`);
 *   • a pending local edit against a MOVED server rev → neither side wins silently
 *     (`conflicts`), and the workspace names it: "also changed on another device".
 *
 * ═══ DELETES (TOMBSTONE-DELETES) ════════════════════════════════════════════════════════
 * The client NEVER hard-deletes a row. `deleted_at` = binned and recoverable, body intact —
 * that is what makes a restore on the OTHER device work, and it is why a binned page's body
 * keeps syncing. `purged_at` = the bytes are gone for real, `doc` is NULL, and the page's
 * pictures were purged in the same cascade. A row that simply vanished would be
 * indistinguishable from one another device has not uploaded yet, which is exactly how a
 * deleted note comes back from the dead.
 */
import { supabase } from "../../site-planner/lib/supabase.js";
import { tombstoneIds, withTombstones } from "./notesModel.js";

/** The app's ONE Supabase client, handed to the store so every transport function below can
 *  still take its client as a parameter (and therefore still be testable against a fake).
 *  Null when Supabase is not configured, which is a supported state: the module falls back
 *  to the unchanged local-only behaviour rather than failing. */
export const cloudClient = () => supabase;

export const TREE_TABLE = "notes_trees";
export const PAGE_TABLE = "notes_pages";
export const IMAGE_TABLE = "notes_images";
export const IMAGE_BUCKET = "notes-images";

/** The bucket's own allow-list, mirrored so an unsupported picture is refused BY NAME here
 *  rather than as an opaque 400 from Storage (LOUD-FAILURE). */
export const IMAGE_MIME_ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"];

/* ---- the per-scope sync state (persisted BY THE STORE, shaped here) ------------------
 *
 * `pages[id]` carries three facts and no more:
 *   rev        the server revision this device's body is BASED ON (null = never synced)
 *   dirty      there is a local edit that has not landed in the cloud
 *   purged     this page was purged (here or elsewhere) — never upload it again
 * That last flag is TOMBSTONE-DELETES at the DEVICE level: without it, a body written back
 * by a flush that lost a race with a purge would look like a brand-new page and resurrect.
 *
 * The ledger is PERSISTED by the store (it is device state, so it lives beside the device's
 * own keys); this file owns only its SHAPE and its empty value, so the pure planners below
 * have a default to reason against. */
export const emptySyncState = () => ({ treeRev: null, treeDirty: false, pages: {}, images: {} });

/* ---- pure: the tree merge ------------------------------------------------------------
 *
 * A tree merge only happens when BOTH sides changed since they last agreed — the ordinary
 * path is "the server row wins on seed" and never reaches this function. When it does, the
 * rules are, in order:
 *
 *   0. A PURGE ON EITHER SIDE WINS OVER EVERYTHING, including a copy that still has the entry
 *      or the page. It is the only rule that can beat a union, and it exists because a
 *      deletion is otherwise an ABSENCE and absence always loses. See rule 0 in the body, and
 *      `tombstoneIds` in the model for the measured resurrection that produced it.
 *   1. A DELETE ON EITHER SIDE WINS. The union of both bins IS the merged bin, and any live
 *      node whose id sits in that union is lifted out of the live tree. This is the
 *      conservative direction and it is safe by construction: a "lost" restore leaves the
 *      node IN THE BIN, where either device can restore it again for the rest of its 30
 *      days. The opposite choice — live wins — resurrects a note the user deleted, which is
 *      the B276 / B556 / B596 / B612 failure TOMBSTONE-DELETES exists to prevent.
 *   2. NOTHING ELSE IS EVER DROPPED. A notebook, section or page present on only one side is
 *      appended, never discarded. A merge cannot lose a note.
 *   3. FOR A NODE ON BOTH SIDES, THE LOCAL TITLE WINS — this function is only reached when
 *      the local tree has unpushed changes, so local is the side with something to say.
 *      Page timestamps take the LATER `updatedAt` and the EARLIER `createdAt`, which is the
 *      honest reading of both regardless of which side is "winning".
 *   4. A PAGE MOVED ON BOTH DEVICES keeps the LOCAL placement and appears exactly once.
 *   5. A DELETE ONLY TAKES WHAT IT ACTUALLY NAMED. See below — this is the rule that was
 *      missing, and its absence is what made a real note unreachable.
 *
 * ⛔ RULE 5, AND WHY IT IS NOT A REFINEMENT OF RULE 1 BUT A CORRECTION OF IT (NEW-1).
 *
 * THE BUG, reproduced in four lines and then found in the owner's live account. Device A adds
 * a subpage under a page and keeps typing in it. Device B — which has never seen that subpage
 * — bins the parent. `deleteNode` stamps the entry with the cascade IT could see, so the
 * entry names the parent and the children B knew about, and NOT A's new one. The merge then
 * hit the parent, saw its id in `deleted`, and returned **before recursing** — so A's subpage
 * was neither kept live nor carried into the bin. It was dropped on the floor, while its BODY
 * (a different storage key, untouched by any of this) stayed perfectly healthy.
 *
 * That is exactly the failure that reached the owner: `deleted_at` NULL, `purged_at` NULL, 215
 * revisions of real work, no node in the local tree, no node in the cloud tree, and nothing in
 * the bin naming it. Not destroyed — UNREACHABLE, which is worse, because nothing was
 * available to say so.
 *
 * THE FIX IS A DEFINITION, NOT A PATCH: **a delete's scope is exactly the set of ids its entry
 * names.** That set is not a guess — `deleteNode` computes the full cascade at delete time and
 * stamps it on the entry precisely so the scope is a fact rather than a re-derivation. A page
 * outside that set was not deleted by anybody: no user ever chose it, and the device that did
 * the deleting had never heard of it. So it is RESCUED — kept live, lifted to the top level of
 * the project its branch belonged to, and REPORTED through `onRescue` so the workspace can say
 * out loud that it moved.
 *
 * ⛔ THE ALTERNATIVE WAS CONSIDERED AND REFUSED: sweeping the unknown descendants into the bin
 * entry alongside their parent. It keeps rule 1 tidier, and it is wrong — the bin purges for
 * real at 30 days, so that choice quietly destroys work whose author never deleted it and
 * never saw a prompt. TOMBSTONE-DELETES exists to stop a deleted note coming BACK; it is not a
 * licence to destroy one nobody deleted. Rule 1 is untouched for every id an entry names.
 */
export function mergeTrees(local, server, { onRescue } = {}) {
  const L = local && typeof local === "object" ? local : { pages: [], trash: [] };
  const S = server && typeof server === "object" ? server : { pages: [], trash: [] };

  /* ⛔ RULE 0, AND IT RUNS BEFORE EVERYTHING ELSE: A PURGE WINS A UNION.
   *
   * THE BUG, measured on the owner's account with revisions. He emptied the bin — cloud tree
   * rev 991, one entry left. A tab open since rev 966 still held all 23 entries and had
   * unpushed edits, so its reload took THIS path. The union brought all 23 back, and the stale
   * tab then pushed the resurrection up as rev 992 and overwrote the good state. **Emptying
   * the bin could not stick while any other window had not yet seen it**, and the same is true
   * of any purge from anywhere.
   *
   * The cause is structural rather than a slip: in a union an ADDITION wins and a DELETION is
   * the ABSENCE of an entry, and absence loses to any copy that still has one. So the deletion
   * is made into a positive fact — a tombstone, carried in the tree itself, merged like
   * everything else and honoured before any of the rules below. This is TOMBSTONE-DELETES,
   * which the rest of the product has had since B276.
   *
   * It is deliberately the FIRST thing that happens: rule 1 lifts a live node out because a
   * bin entry names it, and a resurrected entry would do exactly that to a page somebody has
   * since restored. */
  const tombs = new Set([...tombstoneIds(L), ...tombstoneIds(S)]);
  const mergedTombs = [
    ...(Array.isArray(L.tombs) ? L.tombs : []),
    ...(Array.isArray(S.tombs) ? S.tombs : []),
  ];

  /** A bin entry with every purged page taken out of it, or `null` when nothing is left.
   *
   * ⛔ THIS IS THE HALF THE FUZZ FOUND, and no hand-written case would have. Two devices that
   * delete the SAME note mint two DIFFERENT entry ids, so purging one device's entry
   * tombstones its id and the OTHER device's entry sails through the union untouched — still
   * naming pages whose bytes are destroyed. That is precisely the zombie state on his account:
   * bin rows offering to restore notes whose content no longer exists anywhere. So an entry is
   * filtered by the ids it NAMES, not only by its own id. */
  const pruneEntry = (e) => {
    const pageIds = (e.pageIds || []).filter((id) => !tombs.has(String(id)));
    if ((e.pageIds || []).length && !pageIds.length) return null;   // nothing recoverable left
    if (pageIds.length === (e.pageIds || []).length && !tombs.has(String(e?.node?.id))) return e;
    if (tombs.has(String(e?.node?.id))) return null;                // its own root is gone
    const strip = (n) => (!n || tombs.has(String(n.id))
      ? null
      : { ...n, pages: (n.pages || []).map(strip).filter(Boolean) });
    return { ...e, pageIds, node: strip(e.node) };
  };

  const trash = [];
  const trashIds = new Set();
  for (const e of [...(L.trash || []), ...(S.trash || [])]) {
    if (!e || !e.id || trashIds.has(e.id)) continue;
    if (tombs.has(String(e.id))) continue;                       // purged for real (rule 0)
    const kept = pruneEntry(e);
    if (!kept) continue;
    trashIds.add(e.id);
    trash.push(kept);
  }
  // Every page id any bin ACTUALLY NAMES. A live copy on the other side loses to it (rule 1);
  // a page this set does not name was deleted by nobody and is rescued (rule 5).
  const deleted = new Set();
  for (const e of trash) {
    if (e?.node?.id) deleted.add(e.node.id);
    for (const pid of e?.pageIds || []) deleted.add(pid);
  }

  /* ⛔ THE OTHER SIDE'S COPY OF A PAGE IS FOUND BY ID, ANYWHERE IN ITS TREE — NEVER BY
   * POSITION (NEW-1, the second hole). The old walk looked the counterpart up among the
   * SIBLINGS at the same spot, so the moment a page was re-parented on one device, the merge
   * stopped being able to see the OTHER device's copy of it — and every child that copy had
   * gained was dropped. Found by a randomised sweep, not by reading: two devices, no bins
   * involved at all, one `move` on one side and one `add` on the other, and a brand-new page
   * disappeared. These indexes make "the same page" a question about identity rather than
   * about where it happens to sit. */
  const indexTree = (nodes, map) => {
    for (const n of nodes || []) {
      if (!n?.id) continue;
      if (!map.has(n.id)) map.set(n.id, n);
      indexTree(n.pages, map);
    }
    return map;
  };
  const aIndex = indexTree(L.pages, new Map());
  const bIndex = indexTree(S.pages, new Map());

  /* ONE RECURSIVE MERGE, because there is now ONE node type (B1420). The old model needed a
   * merge per level — pages inside sections inside notebooks — and each level was its own
   * chance to get the rules subtly different. A page and a subpage are the same thing, so
   * they merge by the same code at every depth. `seen` is global across the whole walk: a
   * page that was re-parented on one device must appear EXACTLY once, in the local
   * placement (rule 4), never in both its old and its new home. */
  const seen = new Set();
  const rescued = [];

  /** Walk one side's list. `fromServer` marks a list that came from the SERVER tree — every id
   *  the LOCAL tree also holds is skipped there, because local owns the placement (rule 4)
   *  whether or not the local walk has reached it yet. Ordering must not decide that. */
  const walk = (nodes, projectId, fromServer) => {
    const out = [];
    for (const pg of nodes || []) {
      if (!pg?.id || seen.has(pg.id)) continue;
      if (fromServer && aIndex.has(pg.id)) continue;          // local placement wins (rule 4)
      seen.add(pg.id);
      // A node's own project when it has one (a root), otherwise its branch's — which is what
      // a rescued page needs in order to land somewhere real rather than nowhere.
      const branchProject = pg.projectId !== undefined ? (pg.projectId ?? null) : projectId;
      const other = (fromServer ? aIndex : bIndex).get(pg.id) || null;
      // The children are the UNION of both sides' children of THIS page, local ones first.
      const kids = fromServer
        ? [...walk(other?.pages || [], branchProject, false), ...walk(pg.pages || [], branchProject, true)]
        : [...walk(pg.pages || [], branchProject, false), ...walk(other?.pages || [], branchProject, true)];

      /* ⛔ RULE 0 ON THE LIVE SIDE, AND IT SHARES RULE 5'S BODY DELIBERATELY. A page whose
       * bytes were destroyed may not come back as a node with nothing behind it — but it is
       * walked, not skipped, because the other device may have added a child under it AFTER
       * the purge, and that child is a page nobody deleted. Skipping early here would be
       * B342992's exact defect in a new costume: a delete taking more than it named. */
      if (deleted.has(pg.id) || tombs.has(String(pg.id))) {
        /* ⛔ RULE 5. This node really was deleted, so it goes — but `kids` are the survivors
         * the merge just built, and every one of them is a page NO bin entry names. Lift them
         * to the top level of the branch's project rather than letting the early return take
         * them with it. This is the line whose absence orphaned a real note. */
        for (const k of kids) rescued.push({ ...k, projectId: branchProject == null ? null : String(branchProject) });
        continue;
      }
      const merged = other
        ? { ...pg, updatedAt: laterOf(pg.updatedAt, other.updatedAt), createdAt: earlierOf(pg.createdAt, other.createdAt) }
        : { ...pg };
      merged.pages = kids;
      out.push(merged);
    }
    return out;
  };

  // Roots also carry `projectId`, and rule 3 (the local title wins) covers it: this function
  // is only reached when local has unpushed changes, so a re-filing done here is the one
  // with something to say. A root only the server has keeps the server's project.
  const pages = [...walk(L.pages || [], null, false), ...walk(S.pages || [], null, true)];

  // Rescued pages go at the END of the top level, so nothing that was already there moves.
  if (rescued.length && typeof onRescue === "function") {
    try { onRescue(rescued.map((p) => ({ pageId: p.id, title: p.title, projectId: p.projectId ?? null }))); }
    catch (_) { /* a bad listener must not lose the pages it was told about */ }
  }
  return {
    v: L.v || S.v || 3,
    pages: [...pages, ...rescued],
    trash,
    // The ledger merges like everything else, deduped and aged out by the model's own rule —
    // a tombstone that reached only one device has to reach the other one.
    tombs: withTombstones({ tombs: mergedTombs }, []).tombs,
  };
}

const laterOf = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.max(a, b) : (Number.isFinite(a) ? a : (Number.isFinite(b) ? b : null)));
const earlierOf = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.min(a, b) : (Number.isFinite(a) ? a : (Number.isFinite(b) ? b : null)));

/* ---- pure: what a seed has to do to the page bodies --------------------------------- */

/** Decide, per page, which copy wins — the whole of ROWS-CANONICAL-ON-SEED in one pure
 *  function, so it can be proven without a network or a browser.
 *
 *  `index`    [{ id, rev, binned, purged }] — the server's cheap page index (no documents).
 *  `state`    the persisted sync state for this scope.
 *  `localIds` every page id that currently has a stored body on this device.
 *
 *  Returns four disjoint sets:
 *    adopt      download the server's document (the server has seen it, we have not)
 *    conflicts  BOTH moved — name it, resolve nothing silently
 *    upload     [{ id, base }] local wins; `base` is the rev to guard the push on
 *    purged     purged elsewhere — clear the bytes here and never send them back
 *
 *  ⛔ A BINNED OR PURGED ROW NEVER PRODUCES A CONFLICT. Binning stamps `deleted_at`, which
 *  bumps `rev` through the server trigger — so a page sitting in the bin with an unflushed
 *  local edit would otherwise report "changed on another device" for a change that was only
 *  ever a delete. That is the false conflict this rule exists to rule out: a binned page's
 *  dirty body simply REBASES onto the server rev and pushes, and a purged page is dropped. */
export function planPageSeed({ index = [], state = emptySyncState(), localIds = [] } = {}) {
  const have = new Set(localIds);
  const seen = new Set();
  const adopt = [], conflicts = [], upload = [], purged = [];

  for (const row of index) {
    const id = row?.id;
    if (!id) continue;
    seen.add(id);
    const st = state.pages[id] || null;

    if (row.purged) {
      if (have.has(id) || !st?.purged) purged.push(id);
      continue;
    }

    const base = st && Number.isFinite(st.rev) ? st.rev : null;
    if (st?.dirty) {
      if (base === row.rev) upload.push({ id, base });
      else if (row.binned) upload.push({ id, base: row.rev });   // a delete is not a conflict
      else conflicts.push(id);
    } else if (base !== row.rev || !have.has(id)) {
      adopt.push(id);                                            // rows are canonical on seed
    }
  }

  for (const id of localIds) {
    if (seen.has(id)) continue;
    if (state.pages[id]?.purged) continue;   // purged for real — never resurrect it
    upload.push({ id, base: null });          // never seen by the server → local wins
  }

  return { adopt, conflicts, upload, purged };
}

/* ---- pure: is a refused push actually a CONFLICT? (B1391) ----------------------------
 *
 * A revision guard answers ONE question — "did the row move since I read it?" — and the
 * honest answer to that is not the same as "do the two copies disagree?". Every path that
 * loses the race lands here first, and only a REAL divergence is allowed to interrupt.
 *
 * The false alarm this closes, in the exact shape it reached the owner: ONE person with the
 * same account open in two windows. Both windows share this browser's storage but each holds
 * its own ledger in memory, so a push that landed in window A leaves window B's base rev
 * stale — and the moment B pushes, the guard refuses a write whose CONTENT IS THE ONE THE
 * SERVER ALREADY HAS. Same for a hard reload that lands between the push and the ledger
 * write. Prompting there asks the user to choose between two identical documents, which is
 * both meaningless and (worse) teaches them to distrust the sync that is working.
 *
 *   identical      the two documents say the same thing → adopt the server rev, in silence
 *   nothing-local  this device has no body, or an empty one, and the server has real text →
 *                  there is nothing here to lose, so take the row (ROWS-CANONICAL-ON-SEED)
 *   diverged       two different documents. NOBODY wins silently — this is the only case
 *                  that may raise the bar.
 *
 * ⛔ THE ASYMMETRY IN `nothing-local` IS DELIBERATE. Empty-here + text-there adopts the text;
 * text-here + empty-there does NOT adopt the blank, because that direction would delete
 * words with no prompt. The silent path may only ever ADD text back, never remove it. */
export function judgeConflict({ localDoc, serverDoc } = {}) {
  if (sameDoc(localDoc, serverDoc)) return { silent: true, why: "identical" };
  if (isEmptyDoc(localDoc) && !isEmptyDoc(serverDoc)) return { silent: true, why: "nothing-local" };
  return { silent: false, why: "diverged" };
}

/** Do two documents SAY THE SAME THING? Compared canonically, so the noise a round trip
 *  through the editor, the server's jsonb and JSON.stringify all add — key order, an attr
 *  written as null rather than left out, an empty marks/content array — cannot masquerade
 *  as an edit. This is the difference between "the bytes differ" and "the note differs". */
export function sameDoc(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(canonNode(a)) === JSON.stringify(canonNode(b));
}

function canonNode(n) {
  if (Array.isArray(n)) return n.map(canonNode);
  if (!n || typeof n !== "object") return n === undefined ? null : n;
  const out = {};
  for (const k of Object.keys(n).sort()) {
    const v = n[k];
    if (v == null) continue;                       // an absent attribute and a null one are one note
    if (k === "attrs") {
      const a = {};
      for (const ak of Object.keys(v).sort()) if (v[ak] != null) a[ak] = canonNode(v[ak]);
      if (Object.keys(a).length) out.attrs = a;
      continue;
    }
    if (k === "marks" || k === "content") {
      if (!Array.isArray(v) || !v.length) continue;   // an empty list and no list are one note
      // Marks are a SET on a node — bold+italic is the same text as italic+bold — so they
      // are ordered canonically. Content is a SEQUENCE and is never reordered.
      const list = v.map(canonNode);
      out[k] = k === "marks" ? list.sort((x, y) => (JSON.stringify(x) < JSON.stringify(y) ? -1 : 1)) : list;
      continue;
    }
    out[k] = canonNode(v);
  }
  return out;
}

/** A document with no words, no picture and no table in it — what a page that was never
 *  typed into looks like, and what `EMPTY_DOC` round-trips to. */
export function isEmptyDoc(doc) {
  if (doc == null) return true;
  let empty = true;
  const walk = (n) => {
    if (!n || typeof n !== "object" || !empty) return;
    if (n.type === "text" && String(n.text || "").trim()) { empty = false; return; }
    if (n.type && !["doc", "paragraph", "text"].includes(n.type)) { empty = false; return; }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return empty;
}

/* ---- pure: two windows, one browser, one ledger (B1391) -------------------------------
 *
 * SAME-ACCOUNT MULTI-WINDOW IS A NORMAL STATE, NOT AN EXCEPTION. Two tabs share this
 * browser's localStorage but not its memory, so each one holds its own copy of the sync
 * ledger and the last one to write used to flatten whatever the other had learned — which
 * is how a base revision goes stale and a push that should have sailed through gets
 * refused. This merges the in-memory ledger with whatever is on disk at the moment of
 * writing, so two windows CONVERGE instead of overwriting each other.
 *
 * ⛔ A DIRTY PAGE KEEPS *ITS OWN* BASE REVISION, even when the disk has a newer one. That
 * is the B1113 / ROWS-CANONICAL-ON-SEED trap in this file's terms: adopting the sibling
 * window's fresher rev as the base for a body this window edited from an OLDER one would
 * let a stale document commit CLEANLY, past a guard that is doing its job. The guard must
 * still refuse — and `judgeConflict` above is what then decides, cheaply, whether the
 * refusal was worth a word to the user. */
export function mergeSyncState(mine, disk) {
  const a = mine || emptySyncState();
  const b = disk || emptySyncState();
  const out = {
    treeRev: higherRev(a.treeRev, b.treeRev),
    treeDirty: !!a.treeDirty || !!b.treeDirty,     // an unpushed change on either side is still owed
    pages: {},
    images: {},
    adopted: [...new Set([...(a.adopted || []), ...(b.adopted || [])])],
  };
  for (const id of new Set([...Object.keys(a.pages || {}), ...Object.keys(b.pages || {})])) {
    const m = a.pages?.[id] || null;
    const d = b.pages?.[id] || null;
    const dirty = !!m?.dirty || !!d?.dirty;
    out.pages[id] = {
      // Dirty HERE → keep this window's base (see the rule above). Otherwise a revision only
      // ever moves forward, so the higher of the two is the current one.
      rev: m?.dirty ? (Number.isFinite(m.rev) ? m.rev : null) : higherRev(m?.rev, d?.rev),
      dirty,
      purged: !!m?.purged || !!d?.purged,          // a tombstone from either window stands
    };
  }
  for (const id of new Set([...Object.keys(a.images || {}), ...Object.keys(b.images || {})])) {
    out.images[id] = {
      up: !!a.images?.[id]?.up || !!b.images?.[id]?.up,
      purged: !!a.images?.[id]?.purged || !!b.images?.[id]?.purged,
    };
  }
  return out;
}

const higherRev = (x, y) => {
  const nx = Number.isFinite(x) ? x : null;
  const ny = Number.isFinite(y) ? y : null;
  if (nx == null) return ny;
  if (ny == null) return nx;
  return Math.max(nx, ny);
};

/* ---- pure: pictures ------------------------------------------------------------------
 *
 * The BYTES are LAZY on the way down and EAGER on the way up, and that asymmetry is the
 * decision, not an omission. Downloading every picture in the account at sign-in would cost
 * a phone plan for notes the user may never open — whereas an un-uploaded picture is a note
 * that opens BROKEN on the second machine, which is the half this item refused to ship
 * without. So: uploads happen on the seed, and a download happens when the page that needs
 * the picture is actually opened (notesStore.readNoteImage falls through to the cloud on a
 * local miss and writes the bytes back into IndexedDB, which stays the local cache). */
export function planImageSync({ index = [], localMeta = [], state = emptySyncState() } = {}) {
  const server = new Map(index.map((r) => [r.id, r]));
  const upload = [], dropLocal = [];
  for (const m of localMeta) {
    const row = server.get(m.id);
    if (row?.deleted) { dropLocal.push(m.id); continue; }
    if (!row && !state.images[m.id]?.purged) upload.push(m.id);
  }
  return { upload, dropLocal };
}

/* ---- pure: the sign-in migration ------------------------------------------------------
 *
 * Notes written signed OUT live under the `local` scope. On sign-in they are ADOPTED into
 * the account — COPIED, never moved, so signing out leaves the same notebooks exactly where
 * they were and nothing is stranded. Adoption is by NOTEBOOK, keyed on the notebook's id, so
 * a second run finds every notebook already present and copies nothing: no duplicates.
 *
 * ⛔ ADOPTION IS ALSO A DELETE PATH, WHICH IS THE TRAP (TOMBSTONE-DELETES). "Not in the
 * account tree" is NOT the same as "never adopted": adopt a signed-out notebook, then delete
 * it from the account, and a naive re-run would find it missing and copy it straight back in
 * — a deleted note resurrected by the migration that was supposed to be idempotent. So a
 * top-level page is skipped when ANY of three things is true: the account has it live, the
 * account has it IN THE BIN (including inside a binned branch's cascade set), or this device
 * has adopted it before (`already`, which the store keeps in its sync ledger). Only a page
 * that is genuinely new to the account is copied — and a copied page brings its whole
 * SUBTREE with it, which is why the body list is a recursive walk. */
export function planAdoption(localTree, accountTree, { already = [] } = {}) {
  const have = new Set((accountTree?.pages || []).filter(Boolean).map((n) => n.id));
  for (const id of already) have.add(id);
  for (const e of accountTree?.trash || []) {
    if (e?.node?.id) have.add(e.node.id);
    for (const pid of e?.pageIds || []) have.add(pid);
  }
  const pages = (localTree?.pages || []).filter((p) => p?.id && !have.has(p.id));
  const pageIds = [];
  const go = (p) => { pageIds.push(p.id); for (const k of (Array.isArray(p.pages) ? p.pages : [])) go(k); };
  for (const p of pages) go(p);
  return { pages, pageIds };
}

/* ---- transport: the tree ------------------------------------------------------------- */

export async function fetchTree(client) {
  const { data, error } = await client.from(TREE_TABLE).select("data,rev").maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: true, tree: null, rev: null };
  return { ok: true, tree: data.data, rev: Number(data.rev) };
}

/** Just the revision — the cheap poll. A tree can be a few kilobytes; its rev is one
 *  integer, so "has anything changed on another device?" costs a number, not a notebook. */
export async function fetchTreeRev(client) {
  const { data, error } = await client.from(TREE_TABLE).select("rev").maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, rev: data ? Number(data.rev) : null };
}

/** Push the tree, guarded on the revision it was based on. `{ conflict:true }` means another
 *  device wrote first — the caller MERGES and retries. It never clobbers.
 *  No `rev` is sent: the server trigger owns it. */
export async function pushTree(client, tree, baseRev) {
  if (baseRev == null) {
    const { data, error } = await client.from(TREE_TABLE).insert({ data: tree }).select("rev").maybeSingle();
    if (error) return isDuplicate(error) ? { ok: false, conflict: true } : { ok: false, error: error.message };
    return { ok: true, rev: Number(data?.rev ?? 1) };
  }
  const { data, error } = await client.from(TREE_TABLE).update({ data: tree }).eq("rev", baseRev).select("rev");
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, conflict: true };
  return { ok: true, rev: Number(data[0].rev) };
}

/* ---- transport: page bodies ----------------------------------------------------------- */

/** The cheap index — ids, revisions and delete state, never documents. This is what makes a
 *  seed or a poll affordable on a notebook with hundreds of pages. */
export async function fetchPageIndex(client) {
  const { data, error } = await client.from(PAGE_TABLE).select("id,rev,deleted_at,purged_at");
  if (error) return { ok: false, error: error.message, index: [] };
  return {
    ok: true,
    index: (data || []).map((r) => ({ id: r.id, rev: Number(r.rev), binned: !!r.deleted_at, purged: !!r.purged_at })),
  };
}

const CHUNK = 120;

/** Documents for a set of page ids, chunked so a long id list cannot blow the URL limit. */
export async function fetchPages(client, pageIds) {
  const ids = [...new Set((pageIds || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client.from(PAGE_TABLE)
      .select("id,doc,rev,deleted_at,purged_at").in("id", ids.slice(i, i + CHUNK));
    if (error) return { ok: false, error: error.message, pages: out };
    for (const r of data || []) out[r.id] = { doc: r.doc, rev: Number(r.rev), binned: !!r.deleted_at, purged: !!r.purged_at };
  }
  return { ok: true, pages: out };
}

/** Push ONE page body, guarded on its revision. No `rev` is sent — the trigger owns it. */
export async function pushPage(client, pageId, doc, baseRev) {
  if (baseRev == null) {
    const { data, error } = await client.from(PAGE_TABLE).insert({ id: pageId, doc }).select("rev").maybeSingle();
    if (error) return isDuplicate(error) ? { ok: false, conflict: true } : { ok: false, error: error.message };
    return { ok: true, rev: Number(data?.rev ?? 1) };
  }
  const { data, error } = await client.from(PAGE_TABLE)
    .update({ doc }).eq("id", pageId).eq("rev", baseRev).select("rev");
  if (error) return { ok: false, error: error.message };
  if (!data || !data.length) return { ok: false, conflict: true };
  return { ok: true, rev: Number(data[0].rev) };
}

/** Read one page's current revision — how a conflict resolution rebases onto what is really
 *  there, rather than guessing. */
export async function pageRev(client, pageId) {
  const { data, error } = await client.from(PAGE_TABLE).select("rev").eq("id", pageId).maybeSingle();
  if (error) return { ok: false, error: error.message };
  return { ok: true, rev: data ? Number(data.rev) : null };
}

/** "Keep this device's copy" — the ONE deliberately unguarded write in this file. It exists
 *  because a user who has been SHOWN both states and picked one is not a race; the guard is
 *  re-armed against whatever the server holds right now, so it is still a single-step,
 *  checked update rather than a blind overwrite. */
export async function forcePage(client, pageId, doc) {
  const r = await pageRev(client, pageId);
  if (!r.ok) return { ok: false, error: r.error };
  return pushPage(client, pageId, doc, r.rev);
}

/** BIN a set of pages: stamp `deleted_at`, keep the body. This is what lets a restore on the
 *  other device find something to restore. Unguarded on rev BY DESIGN — a delete is not an
 *  edit and must never lose a race to one; the body itself is untouched. */
export async function binPages(client, pageIds, binned = true) {
  const ids = [...new Set((pageIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true, revs: {} };
  const revs = {};
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data, error } = await client.from(PAGE_TABLE)
      .update({ deleted_at: binned ? new Date().toISOString() : null })
      .in("id", ids.slice(i, i + CHUNK)).select("id,rev");
    if (error) return { ok: false, error: error.message, revs };
    for (const r of data || []) revs[r.id] = Number(r.rev);
  }
  return { ok: true, revs };
}

/** PURGE: the bytes go, the ROW STAYS as the tombstone. `purged_at` + a NULL doc is what
 *  another device reads to clear its own copy — a row that simply vanished would read as
 *  "not uploaded yet" and be resurrected on the next push. */
export async function purgePagesCloud(client, pageIds) {
  const ids = [...new Set((pageIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true };
  const stamp = new Date().toISOString();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { error } = await client.from(PAGE_TABLE)
      .update({ doc: null, purged_at: stamp, deleted_at: stamp }).in("id", ids.slice(i, i + CHUNK));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/* ---- transport: pictures --------------------------------------------------------------
 *
 * Bytes to the private bucket at <uid>/<imageId>; one index row beside them. IndexedDB
 * stays the local CACHE — a download writes straight back into it (the store owns that
 * half; this file only fetches). */

export const imagePath = (uid, imageId) => `${uid}/${imageId}`;

export async function fetchImageIndex(client) {
  const { data, error } = await client.from(IMAGE_TABLE).select("id,page_id,deleted_at");
  if (error) return { ok: false, error: error.message, index: [] };
  return { ok: true, index: (data || []).map((r) => ({ id: r.id, pageId: r.page_id || null, deleted: !!r.deleted_at })) };
}

export async function pushImage(client, uid, { id, pageId, dataUrl, mime = "", w = 0, h = 0, bytes = 0, kind = "image", name = "" }) {
  const blob = dataUrlToBlob(dataUrl);
  const what = kind === "file" ? "file" : "picture";
  if (!blob) return { ok: false, error: `the ${what} could not be read back for upload` };
  const type = blob.type || mime || "";
  /* The bucket's allow-list, checked HERE so an unsupported picture is refused by name
   * instead of coming back as an opaque 400 nobody can act on.
   *
   * ⛔ IT APPLIES TO PICTURES ONLY (NEW-5). An ATTACHMENT is any file by definition — a
   * DWG, an XLSX, whatever a consultant sends — and the bucket's own mime restriction was
   * lifted for exactly that in db/notes_attachments.sql. Keeping the check for images is
   * still worth it: a picture with an odd type is a mistake worth naming, and this is the
   * only place that can name it before the network does. */
  if (kind !== "file" && !IMAGE_MIME_ALLOWED.includes(type)) {
    return { ok: false, error: `pictures of type ${type || "unknown"} cannot be stored in the cloud` };
  }
  const path = imagePath(uid, id);
  const up = await client.storage.from(IMAGE_BUCKET).upload(path, blob, { contentType: type || "application/octet-stream", upsert: true });
  if (up.error) return { ok: false, error: up.error.message };
  const { error } = await client.from(IMAGE_TABLE).upsert(
    { id, page_id: pageId || null, path, mime: type, bytes, width: w, height: h, kind, name: name || null, deleted_at: null },
    { onConflict: "user_id,id" },
  );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** One picture's bytes back as a data URL — the shape IndexedDB, the document, the export
 *  and the print sheet all already speak, so nothing downstream learns it came over a wire. */
export async function fetchImage(client, uid, imageId) {
  const { data, error } = await client.storage.from(IMAGE_BUCKET).download(imagePath(uid, imageId));
  if (error || !data) return { ok: false, error: error?.message || "that picture is not in the cloud" };
  const dataUrl = await blobToDataUrl(data);
  if (!dataUrl) return { ok: false, error: "the downloaded picture could not be read" };
  return { ok: true, dataUrl };
}

/** Purge pictures: the BYTES go for real (they are the expensive half), the index row stays
 *  as the tombstone so another device learns the picture is gone instead of re-uploading it. */
export async function purgeImagesCloud(client, uid, imageIds) {
  const ids = [...new Set((imageIds || []).filter(Boolean))];
  if (!ids.length) return { ok: true };
  const rm = await client.storage.from(IMAGE_BUCKET).remove(ids.map((id) => imagePath(uid, id)));
  const { error } = await client.from(IMAGE_TABLE).update({ deleted_at: new Date().toISOString() }).in("id", ids);
  if (error) return { ok: false, error: error.message };
  if (rm?.error) return { ok: false, error: rm.error.message };
  return { ok: true };
}

/* ---- codecs -------------------------------------------------------------------------- */

/** `data:<mime>;base64,<payload>` → a Blob. Written by hand rather than via `fetch(dataUrl)`
 *  because a `data:` fetch is blocked outright under a strict content-security policy, and a
 *  picture that silently fails to upload is precisely the failure this item exists to fix. */
export function dataUrlToBlob(dataUrl) {
  try {
    const s = String(dataUrl || "");
    const comma = s.indexOf(",");
    if (!s.startsWith("data:") || comma < 0) return null;
    const head = s.slice(5, comma);
    const mime = head.split(";")[0] || "application/octet-stream";
    const body = s.slice(comma + 1);
    if (!/;base64/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime });
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch (_) { return null; }
}

export function blobToDataUrl(blob) {
  return new Promise((resolve) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(blob);
    } catch (_) { resolve(null); }
  });
}

/* A primary-key clash. PostgREST reports 23505; the message match is the fallback for a
 * client that has already stringified the error. */
const isDuplicate = (e) => e?.code === "23505" || /duplicate key|already exists/i.test(String(e?.message || ""));

/** Plain English for the footer. A sync failure has to say WHY — "sync failed" with no
 *  reason is the same unhelpful lie as a "Saved ✓" that did not save. */
export function syncFailureReason(error) {
  const s = String(error || "").toLowerCase();
  if (!s) return "an unknown problem";
  if (/failed to fetch|networkerror|network request failed|load failed|offline/.test(s)) return "no connection";
  if (/jwt|token|not authenticated|401|unauthorized/.test(s)) return "your sign-in expired — sign in again";
  if (/row-level security|permission|403|forbidden/.test(s)) return "the server refused the write";
  if (/does not exist|schema cache|pgrst205/.test(s)) return "the notes tables are missing on the server";
  if (/payload too large|413|exceeded the maximum|too large/.test(s)) return "a note or picture is too large";
  return String(error).slice(0, 120);
}
