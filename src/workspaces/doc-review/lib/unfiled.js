/* Unfiled files (NEW-2) — the Library's answer to "I saved it with no project selected, where is it?"
 *
 * A Review file opened/saved with no project, and not the Organization, is stored (a doc_reviews row + its
 * bytes) but belongs to no project folder, so no per-project Library view lists it. The Library Home lists
 * every such file under "Unfiled" with a one-step "Move to project…". This module is the pure half:
 * which rows count as unfiled, and the one honest sentence Review shows after a save (the banner must name
 * where the file actually went). Works on the light `doc_reviews` rows from `fetchReviews`.
 */

const projectOf = (r) => (r && (r.project_id || r.projectId)) || null;

/* Unfiled = no project and not Organization-scoped. Soft-deleted rows never reach here (fetchReviews filters
 * them); a blank never-saved review has no row at all. Newest first so a file just saved is on top. */
export const isUnfiledRow = (r) => !!r && !!r.id && !projectOf(r) && r.orgScope !== true;

export function unfiledRows(rows) {
  const t = (r) => Date.parse(r.updated_at || r.updatedAt || "") || 0;
  return (rows || []).filter(isUnfiledRow).sort((a, b) => t(b) - t(a));
}

/* Where did a save go? scope = { projectId, project, orgScope }. */
export function savedPlace({ projectId = null, project = "", orgScope = false } = {}) {
  if (orgScope) return "Saved to the Library under Organization.";
  if (projectId) return project ? `Saved to the Library in ${project}.` : "Saved to the Library.";
  return "Saved to the Library under Unfiled — open the Library to move it into a project.";
}
