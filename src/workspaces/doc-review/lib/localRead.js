/* Local (no-LLM) title-block read (B312) — the FREE, instant filing path.
 *
 * Owner direction (2026-06-20): do the common case with plain code, not the AI. This reads a
 * dropped PDF's EMBEDDED text with pdf.js (no Claude API, no tokens, no cloud) and runs the
 * pure deterministic parser + matcher to produce a filing decision in the SAME shape the
 * server reader returns — so the drawer's drop handler is unchanged. For a scanned/image-only
 * sheet (no text layer) it returns `hasText:false`, the caller's cue to fall back to the AI
 * reader (server/filing/) for that minority of files.
 *
 * MULTI-DISCIPLINE (owner request, 2026-06-23): a real drop is often a whole BOUND set, not one
 * sheet — and it may carry several disciplines (a make-ready package; a full IFC with C-/A-/S-/
 * M-/E-/P- sheets together). So this now reads EVERY page's text, classifies each page on its own
 * (prefix-first, disciplineSplit.js), and:
 *   • picks the file's discipline by MAJORITY (fixes the old "read the first 2 pages → label the
 *     whole file" misfile — a Mechanical set whose cover named the architect filed as Architectural),
 *   • when the set spans ≥2 substantive disciplines, returns the per-discipline `sets` (page ranges)
 *     so the library can file each block in its right folder instead of one wrong place.
 *
 * Thin glue only: the real logic is the unit-tested pure modules (titleBlockParse, matchProject,
 * disciplineSplit). Browser-only (rides the lazy doc-review chunk alongside the viewer's pdf.js).
 */
import { readTitleBlockText } from "../../../shared/files/titleBlockParse.js";
import { matchProjectInText } from "../../../shared/files/matchProject.js";
import { splitByDiscipline } from "../../../shared/files/disciplineSplit.js";

// Read every page's embedded text (the title blocks identify each sheet's project & discipline).
// pdf.js is imported lazily (it pulls a Vite-only worker URL) so this module loads anywhere and
// pdf.js only spins up when a file is actually read.
async function allPagesText(file) {
  const { extractAllPagesText: read } = await import("./pdf.js");
  return read(file);
}

/* Read + match a dropped PDF locally. Returns:
 *   { ok:true, hasText:true,  decision, fields, facts, split, source:"local" }   — a real free read
 *   { ok:true, hasText:false } — no embedded text (scanned) → caller falls back to the AI
 *   { ok:false, error }        — couldn't open the PDF
 * `decision` carries the file's MAJORITY discipline plus `multiDiscipline` + `sets` (per-discipline
 * page ranges) when the set spans several disciplines. `extractPages` is injectable for tests (so
 * the decision assembly is testable without pdf.js); it returns an array of per-page text strings. */
export async function localTitleBlockRead(file, projects = [], { extractPages = allPagesText, match = {} } = {}) {
  let pages = [];
  try { pages = await extractPages(file); }
  catch (e) { return { ok: false, error: (e && e.message) || "Couldn't open the PDF." }; }
  if (typeof pages === "string") pages = [pages]; // tolerate a single joined string (old seam)

  // Per-page deterministic read → the records the splitter classifies.
  const metas = pages.map((text, i) => {
    const f = readTitleBlockText(text);
    return { pageNum: i + 1, hasText: f.hasText, discipline: f.discipline, item: f.item, sheetNumber: f.sheetNumber, date: f.date, revision: f.revision };
  });
  if (!metas.some((m) => m.hasText)) return { ok: true, hasText: false }; // wholly scanned → AI fallback

  const joined = pages.join(" ");
  const whole = readTitleBlockText(joined); // file-level date / revision / scale
  const split = splitByDiscipline(metas);

  const m = matchProjectInText(joined, projects, match);
  const project = m.matched ? (projects.find((p) => p.id === m.projectId) || {}).name || m.matched.name || "" : "";
  const docDate = whole.date || new Date().toISOString().slice(0, 10);
  const discipline = split.dominant.discipline || "Other";
  const item = (split.dominant.item || "Document").trim();

  // The per-discipline filing plan (only the substantive, standalone blocks) — each ready to file
  // in its own folder, named the usual "<Project> - <Item> - date" way.
  const sets = (split.standaloneSets || []).map((s) => ({
    discipline: s.discipline, item: s.item, pageNums: s.pageNums, sheetRanges: s.sheetRanges, pages: s.pages,
  }));

  const decision = {
    matched: !!m.matched, projectId: m.projectId, project,
    discipline, item, revision: whole.revision || "", docDate,
    confidence: m.confidence, needsFiling: m.needsFiling, reason: m.reason,
    multiDiscipline: split.multiDiscipline, sets, scannedPages: split.scannedPages,
    candidates: (m.candidates || []).map((c) => ({ id: c.id, name: c.name, score: +(c.score || 0).toFixed(3) })),
    source: "local",
  };
  const facts = {
    projectId: m.projectId, discipline, item,
    sheetNumber: (sets[0] && sets[0].sheetRanges[0]) || whole.sheetNumber || "", sheetTitle: "",
    revision: decision.revision, docDate,
    matchConfidence: m.confidence, needsFiling: m.needsFiling, multiDiscipline: split.multiDiscipline, placement: null,
  };
  return { ok: true, hasText: true, decision, fields: whole, facts, split, source: "local" };
}
