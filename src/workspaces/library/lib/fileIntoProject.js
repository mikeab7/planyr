/* fileReviewIntoProject — the ONE implementation of "put this existing Library file into a project" (B217's
 * refile, shared since NEW-2 so the Library Home's Unfiled "Move to project…" and the browser's Needs-filing
 * row cannot drift): re-point the review, mirror the filing into the file index, then move the Drive bytes to
 * the matching folder. A failed first step writes nothing and says so; the later steps are best-effort but LOUD
 * (each failure comes back as a notice naming exactly what is still pending). */
import { refileReview, upsertFileFacts, loadReview } from "../../doc-review/lib/reviewStore.js";
import { toFactsRow } from "../../doc-review/lib/fileIndex.js";
import { moveDriveFileToFolder } from "./folders.js";

export async function fileReviewIntoProject({ f, projectId, projectName = "", discipline, category }) {
  const res = await refileReview(f.id, { projectId, project: projectName, discipline });
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || "the save failed" };
  let notice = "";
  // Preserve the REAL upload filename (B685): source_file is what isPdfFile reads to decide open-in-Review vs. download.
  const ff = await upsertFileFacts(toFactsRow({ projectId, discipline, item: f.item, category: category || undefined, needsFiling: false }, { id: f.id, reviewId: f.id, sourceFile: f.sourceFile || "" })).catch((e) => ({ ok: false, error: e && e.message }));
  if (ff && ff.ok === false) notice = `Filed, but the Library index wasn't updated (${ff.error || "write failed"}) — refresh and try again if the file looks misplaced.`;
  // Move the Drive BYTES to match the confirmed discipline (B662 review #3).
  try {
    const rec = await loadReview(f.id);
    const keys = ((rec && rec.sources) || []).map((s) => s && s.driveKey).filter(Boolean);
    for (const k of keys) {
      const mv = await moveDriveFileToFolder(projectId, k, discipline);
      if (mv && mv.ok === false) { notice = `Filed as ${discipline}, but the Google Drive copy couldn't be moved (${mv.error || "move failed"}) — it stays in its old folder.`; break; }
    }
  } catch (_) {
    notice = `Filed as ${discipline}, but the Google Drive copy couldn't be moved — it stays in its old folder.`;
  }
  return { ok: true, notice };
}
