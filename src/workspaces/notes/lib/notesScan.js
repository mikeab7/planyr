/* notesScan — the integrity pass, reached by a LAZY import (NEW-4).
 *
 * ⛔ IT IS ITS OWN FILE FOR A BUNDLE REASON, exactly like `notesCloud.js` and the image
 * database. `notesStore.js` is on the Notes route's STATIC path — the rail reads the tree
 * through it — so anything it imports is downloaded before the notebook list can paint. This
 * scan runs a couple of seconds AFTER the tree settles and answers a question nobody is
 * waiting on, so it has no business on those bytes. The seam is unchanged: everything here
 * still reads through the store's public surface.
 *
 * It answers two questions, and both were unanswerable before the copy incident:
 *   • IS ONE NOTE LIVING IN TWO PROJECTS? (`scanNoteDuplicates`)
 *   • IS A NOTE FILED NOWHERE AT ALL? (`unreachableNotes`)
 */
import { docToText } from "./notesMarkdown.js";
import { findCrossProjectDuplicates } from "./notesDuplicates.js";
import { trashEntries, walkPages } from "./notesModel.js";
import { listStoredPageIds, readPage } from "./notesStore.js";

/**
 * Every set of pages that say the same thing while belonging to different projects.
 *
 * ⛔ ONLY ACTIONABLE ONES — see the long note at the filter below for why the bin and dead
 * projects are deliberately NOT scanned any more (NEW-4).
 */
export function scanNoteDuplicates(tree, { liveProjectIds = null, ignored = [], ...opts } = {}) {
  const rows = [];
  walkPages(tree, (pg, { root }) => {
    rows.push({
      pageId: pg.id, title: pg.title, projectId: root.projectId ?? null,
      where: "live", text: docToText(readPage(pg.id)),
    });
  });
  /* ⛔ THE BIN IS NOT SCANNED ANY MORE, AND THAT IS A CORRECTION (NEW-4).
   *
   * The first version searched it deliberately: both copies of the original incident were
   * binned by the time anyone looked, so a live-only scan would have reported a clean account.
   * That reasoning was right for a FORENSIC pass and wrong for a banner. What it produced on
   * his screen, verbatim: *"One note appears in 2 different projects (2 copies). “Coordination”
   * in Grand Port · “Page 1” in a project that no longer exists (in the bin)"* — one copy in
   * the bin, the other's project deleted a week earlier. **There was nothing to act on, and
   * Dismiss was the only exit.** A banner that cannot be satisfied teaches you to dismiss the
   * one that will one day be real, which costs more than it ever saved.
   *
   * So the rule is now: a duplicate is reportable only when it is ACTIONABLE — two or more
   * LIVE copies, in projects that still exist. A binned copy is already on its way out; a copy
   * in a deleted project is a tombstone. Neither is a decision anybody has to make.
   *
   * The forensic view did not go away, it moved: `unreachableNotes` and the bin's own facts
   * cover what is in there, and a scan across everything is a query to run deliberately, not a
   * bar to render at somebody. */
  const known = Array.isArray(liveProjectIds) ? new Set(liveProjectIds) : null;
  const actionable = rows.filter((r) => r.projectId == null || !known || known.has(r.projectId));
  const skip = new Set(ignored || []);
  return findCrossProjectDuplicates(actionable, opts).filter((g) => !skip.has(duplicateKey(g)));
}

/** A stable name for one finding, so "keep both and stop telling me" can be remembered across
 *  reloads without storing the documents themselves. Sorted, so the same pair in either order
 *  is the same finding. */
export function duplicateKey(group) {
  return (group?.pages || []).map((p) => p.pageId).sort().join("|");
}

/** Notes whose BODY is on this device but whose page is in no tree at all — not live, not in
 *  the bin. Reachable from nowhere in the app, so the workspace surfaces them and offers to
 *  file them back into the named "Not in a project" home.
 *
 *  ⛔ IT NEVER GUESSES A PROJECT. An orphan's project is exactly the fact that was lost, and
 *  inventing a plausible one is the defect NEW-1 exists to make impossible. "Not in a
 *  project" is a real place with a name, not a holding pen. */
export function unreachableNotes(tree) {
  const known = new Set();
  walkPages(tree, (pg) => { known.add(pg.id); });
  for (const e of trashEntries(tree)) for (const id of e.pageIds || []) known.add(id);
  const out = [];
  for (const id of listStoredPageIds()) {
    if (known.has(id)) continue;
    const text = docToText(readPage(id)).replace(/\s+/g, " ").trim();
    if (!text) continue;                              // an empty stray is not a lost note
    /* ⛔ EVERYTHING A PERSON NEEDS TO RECOGNISE IT, BECAUSE ITS NAME IS GONE. The TITLE lived
     * on the tree node, so a note that lost its node lost its name with it. There is nothing
     * to look up and nothing honest to invent — so the first line of what they wrote stands in
     * for it, and the size says how much is there. `createdAt` is decodable from the id (it is
     * `Date.now()` in base 36) and is the one date that survived the node. */
    out.push({
      pageId: id,
      text,
      preview: text.slice(0, 120),
      firstLine: text.slice(0, 72) + (text.length > 72 ? "…" : ""),
      chars: text.length,
      createdAt: createdAtFromId(id),
      titleLost: true,
    });
  }
  return out;
}

/** A page id is `pg_` + `Date.now().toString(36)` + a counter + noise, so the moment the page
 *  was made is recoverable from the id alone — which matters here precisely because every
 *  other record of this page's history lived on the node that went missing. Returns null
 *  rather than a guess when the id is not one this app minted. */
export function createdAtFromId(pageId) {
  const body = String(pageId || "").split("_")[1] || "";
  const t = parseInt(body.slice(0, 8), 36);
  return Number.isFinite(t) && t > 1.4e12 && t < 4e12 ? t : null;
}
