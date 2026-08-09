/* notesProjectLink — "what is this project holding?", asked from OUTSIDE the Notes route.
 *
 * ⛔ WHY IT IS ITS OWN FILE, AND WHAT IT MAY NOT GROW INTO (NEW-3).
 *
 * Deleting a project has to be able to say how many notes it is about to orphan — the owner
 * deleted a dead pursuit and its notes simply reappeared a week later under a "from a project
 * you deleted" heading, with nothing having been said at the time. But the thing that deletes
 * a project is the SHARED HEADER BREADCRUMB, which is chrome on every route and is very often
 * nowhere near a mounted Notes module.
 *
 * Two constraints therefore have to hold at once:
 *   • IT MAY NOT DEPEND ON THE NOTES ROUTE BEING MOUNTED. The store points at whichever scope
 *     the workspace last set; asking it while Notes has never been opened answers with the
 *     SIGNED-OUT tree for a signed-in user, which is a confident wrong number in a
 *     confirmation dialog — the worst possible place for one. So the account is passed in
 *     EXPLICITLY, and nothing here re-points the store's own scope (that would stop a running
 *     sync and re-point a workspace that may be mounted and mid-edit).
 *   • IT MAY NOT DRAG THE STORAGE TIER ONTO EVERY ROUTE. Measured: pointing this at
 *     `notesStore.js` split the whole tier — the image database, the version history, the
 *     task rollup, the Markdown exporter — into a shared chunk and cost the Notes route 12 KB;
 *     pointing it at `notesModel.js` still cost 9 KB, because the one-way migration came too.
 *     So it depends on two LEAVES and nothing else.
 *
 * ⛔ SO IT STAYS A LEAF ITSELF. Two functions, both about the project↔notes binding. Anything
 * that needs a page BODY, a picture, a version or the network belongs in `notesStore.js`,
 * which is still the one storage seam; this is the narrow window cut through it for one
 * question that has to be answerable from anywhere.
 */
import { isLegacyTree, moveProjectNotes, projectNoteCensus } from "./notesProjectFiling.js";
import { SYNC_KEY_BASE, TREE_KEY_BASE, scopeFor } from "./notesKeys.js";

const store = () => {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch (_) { return null; }
};

const treeKey = (s) => `${TREE_KEY_BASE}:${s}`;
const syncKey = (s) => `${SYNC_KEY_BASE}:${s}`;

function readTree(s) {
  const st = store();
  if (!st) return null;
  try { return JSON.parse(st.getItem(treeKey(s)) || "null"); } catch (_) { return null; }
}

/** How many notes (and how many pages under them) one project is holding, including its
 *  share of the bin.
 *
 *  ⛔ `{ unknown: true }` IS A REAL ANSWER AND IS NOT THE SAME AS ZERO. A device that has not
 *  opened Notes since the four-level model was collapsed still holds the old tree shape,
 *  which this leaf cannot read (the migration lives in `notesModel.js`, deliberately not
 *  imported here). Saying "couldn't check" is honest; reporting no notes would be a confident
 *  lie at the exact moment the owner is deciding whether to delete something. */
export function projectNotes(userId, projectId) {
  const raw = readTree(scopeFor(userId));
  if (isLegacyTree(raw)) return { unknown: true, noteCount: 0, pageCount: 0, pageIds: [], titles: [], binnedNotes: 0, binnedPages: 0 };
  return { unknown: false, ...projectNoteCensus(raw, projectId) };
}

/** Re-file every note of one project into another (or into no project) — the "and take the
 *  notes with it" half of the delete confirmation.
 *
 *  ⛔ IT MARKS THE TREE AS OWING THE CLOUD A PUSH. Without that, the next seed would find the
 *  ledger clean, take the SERVER's tree as canonical (ROWS-CANONICAL-ON-SEED) and quietly
 *  undo the move — the notes would be back under a project that no longer exists, which is
 *  the exact state this feature removes. A spurious dirty flag costs a merge and nothing
 *  else; a missing one costs the edit.
 *
 *  ⛔ AND IT TELLS A MOUNTED NOTES WINDOW, by the same synthetic `storage` event the project
 *  list already uses. A same-tab write fires no native event, so a workspace holding the tree
 *  in memory would otherwise write its stale copy back over this one on the next keystroke. */
export function moveNotesBetweenProjects(userId, fromProjectId, toProjectId = null) {
  const s = scopeFor(userId);
  const st = store();
  if (!st) return { ok: false, moved: 0, error: "this browser's storage is unavailable, so nothing was moved" };
  const raw = readTree(s);
  if (isLegacyTree(raw)) return { ok: false, moved: 0, error: "those notes could not be re-filed — open Notes once and try again" };
  const { tree, moved } = moveProjectNotes(raw, fromProjectId, toProjectId);
  if (!moved) return { ok: true, moved: 0 };
  try {
    st.setItem(treeKey(s), JSON.stringify(tree));
  } catch (_) {
    return { ok: false, moved: 0, error: "those notes could not be re-filed on this device, so nothing was moved" };
  }
  try {
    const rawLedger = JSON.parse(st.getItem(syncKey(s)) || "null");
    const ledger = rawLedger && typeof rawLedger === "object" ? rawLedger : { treeRev: null, treeDirty: false, pages: {}, images: {}, adopted: [] };
    ledger.treeDirty = true;
    st.setItem(syncKey(s), JSON.stringify(ledger));
  } catch (_) {
    // The move itself landed. A ledger this device could not stamp means the next seed may
    // re-take the server's tree — reported, never swallowed, because "moved" would then be
    // a claim that does not hold (LOUD-FAILURE).
    return { ok: false, moved, error: "those notes were re-filed here but the change may not reach your other computers" };
  }
  try { window.dispatchEvent(new StorageEvent("storage", { key: treeKey(s) })); }
  catch (_) { /* a browser without the constructor simply re-reads on its next load */ }
  return { ok: true, moved };
}
