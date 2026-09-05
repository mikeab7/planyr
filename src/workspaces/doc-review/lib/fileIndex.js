/* Auto-filing file-facts index — pure view-model helpers (B299).
 *
 * The queryable index of what each filed drawing IS (project / discipline / sheet / revision
 * / date + placement-readiness facts), captured once by the server-side title-block read
 * (server/filing/) and persisted in Supabase Postgres (db/file_facts.sql). This module is the
 * browser-free heart: it turns a filing decision into the one small DB row to store, and
 * merges stored facts back onto the lightweight review rows the drawer already loads — so the
 * existing `buildFileFacts` (shared/files/fileFacts.js) surfaces REAL placement + needs-filing
 * state, not the empty stub. No Supabase import here (the I/O lives in reviewStore.js); kept
 * pure so it's unit-tested directly.
 */
import { emptyPlacementFacts, mergePlacementFacts } from "../../../shared/placement/placementFacts.js";
import { categoryFor, FILE_STATES } from "../../../shared/files/fileFacts.js";

/* Build the one index row to persist from a filing decision's `facts` (server-side shape).
 * `id` keys the row (use the review id so it 1:1-tracks the filed review); snake_case to match
 * the Postgres columns. Placement is stored as a complete, safe object.
 *
 * Work Item B: the filing decision now WRITES the canonical `category` (top-level tree node,
 * derived from discipline + item when not given) and `state` (needs_filing | filed). The
 * subcategory reuses `discipline` (no duplicate column). A no/low-confidence file is
 * needs_filing — never a guessed category (misfiled is worse than unfiled). */
export function toFactsRow(facts = {}, { id, reviewId = null, sourceFile = "" } = {}) {
  const discipline = facts.discipline || "Other";
  const needsFiling = !!facts.needsFiling; // the caller decides this (it knows the project context)
  return {
    id,
    review_id: reviewId,
    project_id: facts.projectId || null,
    category: facts.category || categoryFor(discipline, facts.item, facts.sheetTitle),
    discipline, // = the data-driven subcategory (reused, not duplicated)
    item: facts.item || "",
    sheet_number: facts.sheetNumber || "",
    sheet_title: facts.sheetTitle || "",
    revision: facts.revision || "",
    doc_date: facts.docDate || null,
    source_file: sourceFile || "",
    match_confidence: typeof facts.matchConfidence === "number" ? facts.matchConfidence : null,
    needs_filing: needsFiling,
    state: facts.state || (needsFiling ? FILE_STATES.NEEDS_FILING : FILE_STATES.FILED),
    placement: mergePlacementFacts(emptyPlacementFacts(), facts.placement),
    updated_at: new Date().toISOString(),
  };
}

/* Turn a stored facts row back into the partial a review row carries so `toFileFact` reads
 * real placement/needs-filing (it already looks at `row.placement` / `row.needsFiling`). */
export function factsRowToPatch(row = {}) {
  return {
    placement: mergePlacementFacts(emptyPlacementFacts(), row.placement),
    placed: !!(row.placement && row.placement.placed),
    needsFiling: !!row.needs_filing,
    // The original upload's filename (B685) — carries the extension, so the Library can tell a
    // PDF (open in Review) from any other file (offer a download) without loading the record.
    sourceFile: row.source_file || "",
    sheetNumber: row.sheet_number || "",
    sheetTitle: row.sheet_title || "",
    matchConfidence: typeof row.match_confidence === "number" ? row.match_confidence : null,
    // Work Item B IA fields surfaced onto the review row → toFileFact reads them.
    category: row.category || null,
    state: row.state || null,
  };
}

/* Duplicate-upload screening (B1205297, owner-reported: the same spreadsheet filed three times
 * into one project — two ingests 17 SECONDS apart, a third 43 minutes later). `reviews` is the
 * raw fetchReviews() shape (reviewStore.js) — `project_id` / `sfile` / `updated_at` / `orgScope`
 * are plain columns/aliases straight off `doc_reviews`, already scoped to non-deleted rows, so
 * this needs no separate query and can never flag a row already in Recently Deleted. Screening
 * is FILENAME equality (case/whitespace-insensitive) — the same axis a content-hash check would
 * refine later if one is ever computed at upload time, never a second, independent rule. */
export const DUPLICATE_RAPID_REPEAT_MS = 60000; // a second ingest inside this window is a retry, not a re-file

function normalizedFileName(name) {
  return String(name || "").trim().toLowerCase();
}

/* The most-recently-filed non-deleted review with the SAME source_file in the SAME filing scope
 * (a project, or the Organization scope) — or null. `sourceFile` empty/unreadable never matches
 * anything (an unnamed drop can't collide). */
export function findDuplicateReview(reviews = [], { projectId = null, orgScope = false, sourceFile = "" } = {}) {
  const name = normalizedFileName(sourceFile);
  if (!name) return null;
  let best = null;
  for (const r of reviews || []) {
    const inScope = orgScope ? !!r.orgScope : (!r.orgScope && (r.project_id ?? null) === projectId);
    if (!inScope) continue;
    if (normalizedFileName(r.sourceFile ?? r.sfile) !== name) continue;
    if (!best || new Date(r.updated_at || 0) > new Date(best.updated_at || 0)) best = r;
  }
  return best;
}

/* True when `existingReview` was filed within the rapid-repeat window of `now` — a double-click
 * or an upload retry, not a deliberate second filing of the same document. Such a repeat
 * collapses onto the existing row silently (no second file_facts card, no prompt). */
export function isRapidRepeatUpload(existingReview, now = Date.now()) {
  if (!existingReview) return false;
  const t = new Date(existingReview.updated_at || 0).getTime();
  return Number.isFinite(t) && now >= t && now - t < DUPLICATE_RAPID_REPEAT_MS;
}

/* Merge stored facts onto the lightweight review rows (matched by review id, newest fact
 * winning). Reviews with no fact row are returned unchanged — so a pre-index file still shows,
 * just without captured placement. Additive + lossless; safe to run on every refresh. */
export function mergeFactsIntoReviews(reviews = [], factsRows = []) {
  if (!factsRows.length) return reviews;
  const byReview = new Map();
  for (const r of factsRows) {
    const key = r.review_id || r.id;
    if (!key) continue;
    const prev = byReview.get(key);
    if (!prev || new Date(r.updated_at || 0) >= new Date(prev.updated_at || 0)) byReview.set(key, r);
  }
  return reviews.map((rev) => {
    const fact = byReview.get(rev.id);
    if (!fact) return rev;
    const patch = factsRowToPatch(fact);
    // `placed` is true if EITHER the review's own data or the index says so — an index row
    // without placement.placed must not downgrade a review already placed on the map (NEW-3).
    return { ...rev, ...patch, placed: !!rev.placed || !!patch.placed };
  });
}
