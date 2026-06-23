/* Byte-level PDF split (owner decision, 2026-06-23: "split into separate PDFs").
 *
 * Given a source PDF blob and a filing PLAN (disciplineSplit.buildFilingPlan — a partition of every
 * page into the per-discipline PDFs to create), carve one clean PDF per discipline so a combined set
 * (Bergstrom = Architectural + a bound-in Structural set) files as separate, correct documents in
 * their own folders. No page is dropped: the plan is a complete partition, leftover pages riding with
 * the dominant entry.
 *
 * pdf-lib is imported LAZILY (only when a real split happens) so it never weighs on first load and
 * stays inside the doc-review lazy chunk. Browser-only (Blob/ArrayBuffer). Pure-ish: given the same
 * bytes + plan it yields the same per-discipline blobs.
 */

// "Bergstrom Phase 2a.pdf" + "Structural" → "Bergstrom Phase 2a - Structural.pdf".
export function partFileName(srcName, discipline) {
  const base = (srcName || "document.pdf").replace(/\.pdf$/i, "");
  const safe = (discipline || "Other").replace(/[\\/:*?"<>|]+/g, " ").trim();
  return `${base} - ${safe}.pdf`;
}

/* Split `blob` into one PDF per plan entry. Returns
 *   [{ discipline, item, pageNums, fileName, blob }]
 * in plan order. A plan with a single entry covering the whole file still round-trips (one output =
 * effectively the original), so callers can use this uniformly. `loadLib` is injectable for tests. */
export async function splitPdfByPlan(blob, plan, srcName, { loadLib } = {}) {
  if (!blob || !Array.isArray(plan) || !plan.length) return [];
  const { PDFDocument } = loadLib ? await loadLib() : await import("pdf-lib");
  const bytes = blob.arrayBuffer ? await blob.arrayBuffer() : blob;
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pageCount = src.getPageCount();
  const out = [];
  for (const entry of plan) {
    const idx = (entry.pageNums || [])
      .map((n) => n - 1)
      .filter((i) => i >= 0 && i < pageCount);
    if (!idx.length) continue;
    const doc = await PDFDocument.create();
    const copied = await doc.copyPages(src, idx);
    for (const pg of copied) doc.addPage(pg);
    const saved = await doc.save();
    out.push({
      discipline: entry.discipline,
      item: entry.item || entry.discipline,
      pageNums: entry.pageNums,
      fileName: partFileName(srcName, entry.discipline),
      blob: new Blob([saved], { type: "application/pdf" }),
    });
  }
  return out;
}
