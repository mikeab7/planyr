/* Local (no-LLM) title-block read (B312) — the FREE, instant filing path.
 *
 * Owner direction (2026-06-20): do the common case with plain code, not the AI. This reads a
 * dropped PDF's EMBEDDED text with pdf.js (no Claude API, no tokens, no cloud) and runs the
 * pure deterministic parser + matcher to produce a filing decision in the SAME shape the
 * server reader returns — so the drawer's drop handler is unchanged. For a scanned/image-only
 * sheet (no text layer) it returns `hasText:false`, the caller's cue to fall back to the AI
 * reader (server/filing/) for that minority of files.
 *
 * Thin glue only: the real logic is the unit-tested pure modules (titleBlockParse, matchProject);
 * here we just pull the text and assemble the result. Browser-only (rides the lazy doc-review
 * chunk alongside the viewer's own pdf.js).
 */
import { readTitleBlockText } from "../../../shared/files/titleBlockParse.js";
import { matchProjectInText } from "../../../shared/files/matchProject.js";

// Read the first couple of pages' text — the title block / cover identifies the project & set.
// pdf.js is imported lazily (it pulls a Vite-only worker URL) so this module loads anywhere and
// pdf.js only spins up when a file is actually read.
async function firstPagesText(file, maxPages = 2) {
  const { loadPdf, extractPageText } = await import("./pdf.js");
  const pdf = await loadPdf(file);
  const n = Math.min(maxPages, pdf.numPages || 1);
  const parts = [];
  for (let p = 1; p <= n; p++) parts.push(await extractPageText(pdf, p));
  try { pdf.destroy(); } catch (_) { /* best-effort */ }
  return parts.join(" ");
}

/* Read + match a dropped PDF locally. Returns:
 *   { ok:true, hasText:true,  decision, fields, facts, source:"local" }   — a real free read
 *   { ok:true, hasText:false } — no embedded text (scanned) → caller falls back to the AI
 *   { ok:false, error }        — couldn't open the PDF
 * `extractText` is injectable for tests (so the decision assembly is testable without pdf.js). */
export async function localTitleBlockRead(file, projects = [], { extractText = firstPagesText, match = {} } = {}) {
  let text = "";
  try { text = await extractText(file); }
  catch (e) { return { ok: false, error: (e && e.message) || "Couldn't open the PDF." }; }

  const fields = readTitleBlockText(text);
  if (!fields.hasText) return { ok: true, hasText: false }; // scanned/image-only → AI fallback

  const m = matchProjectInText(text, projects, match);
  const project = m.matched ? (projects.find((p) => p.id === m.projectId) || {}).name || m.matched.name || "" : "";
  const docDate = fields.date || new Date().toISOString().slice(0, 10);
  const item = (fields.item || "Document").trim();

  const decision = {
    matched: !!m.matched, projectId: m.projectId, project,
    discipline: fields.discipline || "Other", item, revision: fields.revision || "", docDate,
    confidence: m.confidence, needsFiling: m.needsFiling, reason: m.reason,
    candidates: (m.candidates || []).map((c) => ({ id: c.id, name: c.name, score: +(c.score || 0).toFixed(3) })),
    source: "local",
  };
  const facts = {
    projectId: m.projectId, discipline: decision.discipline, item,
    sheetNumber: fields.sheetNumber || "", sheetTitle: "", revision: decision.revision, docDate,
    matchConfidence: m.confidence, needsFiling: m.needsFiling, placement: null, // placement is the AI/CV step, not Tier-1
  };
  return { ok: true, hasText: true, decision, fields, facts, source: "local" };
}
