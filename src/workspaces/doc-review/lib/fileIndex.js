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

/* Build the one index row to persist from a filing decision's `facts` (server-side shape).
 * `id` keys the row (use the review id so it 1:1-tracks the filed review); snake_case to match
 * the Postgres columns. Placement is stored as a complete, safe object. */
export function toFactsRow(facts = {}, { id, reviewId = null, sourceFile = "" } = {}) {
  return {
    id,
    review_id: reviewId,
    project_id: facts.projectId || null,
    discipline: facts.discipline || "Other",
    item: facts.item || "",
    sheet_number: facts.sheetNumber || "",
    sheet_title: facts.sheetTitle || "",
    revision: facts.revision || "",
    doc_date: facts.docDate || null,
    source_file: sourceFile || "",
    match_confidence: typeof facts.matchConfidence === "number" ? facts.matchConfidence : null,
    needs_filing: !!facts.needsFiling,
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
    sheetNumber: row.sheet_number || "",
    sheetTitle: row.sheet_title || "",
    matchConfidence: typeof row.match_confidence === "number" ? row.match_confidence : null,
  };
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
    return fact ? { ...rev, ...factsRowToPatch(fact) } : rev;
  });
}
