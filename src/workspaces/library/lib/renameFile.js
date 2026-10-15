/* renameFile — the ONE "rename a file's display title" write (NEW-2). The title is `doc_reviews.title`; the Library
 * list, the Review header and Home's pins all read it from there (pins keep only a fallback label, B1953793), so
 * this is the only place a title is typed in. A typed title is flagged `titleAuto: false` so a project rename never
 * rewrites it (reviewNaming.js). Empty is refused, never defaulted. */
import { loadReview, upsertReview } from "../../doc-review/lib/reviewStore.js";

export async function renameReviewTitle(id, title) {
  const next = String(title ?? "").trim();
  if (!next) return { ok: false, error: "A name can't be empty." };
  const rec = await loadReview(id);
  if (!rec) return { ok: false, error: "Couldn't find that file." };
  if ((rec.title || "") === next && rec.titleAuto === false) return { ok: true, unchanged: true };
  const res = await upsertReview({ ...rec, title: next, titleAuto: false, updatedAt: Date.now() });
  if (!res || !res.ok) return { ok: false, error: (res && res.error) || "the save failed" };
  return { ok: true };
}
