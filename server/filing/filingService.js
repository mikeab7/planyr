/* Auto-filing orchestration (B299) — read → match → decide, in one place.
 *
 * Policy: read the drawing's title block ONCE, match it against the named projects, and:
 *   - confident single project  → auto-route + auto-name (a filing decision the client applies)
 *   - no / multiple / low-confidence match → "needs filing" tray (never auto-guess)
 * The same read also yields the placement-readiness facts, so filing and "Place on map"
 * share one pass. The reader is injectable so this policy is unit-testable without a key.
 *
 * Everything is result-shaped ({ ok } / { ok:false, error }) — a read failure is surfaced,
 * never swallowed into a fabricated "filed it somewhere" success.
 */
import { ok, fail } from "../storage/result.js";
import { readTitleBlock } from "./titleBlockReader.js";
import { matchProject } from "./matcher.js";
import { composeFiledName } from "./naming.js";

/* File one drawing. `pdfBytes` = the PDF; `projects` = [{ id, name, aliases? }] the read is
 * matched against; `cfg` = filingConfig(). Returns ok({ decision, fields, placement, facts }):
 *   decision: { matched, projectId, project, discipline, item, revision, docDate,
 *               suggestedName, confidence, needsFiling, reason, candidates }
 *   facts:    the one small index row to persist (queryable later without re-reading).
 */
export async function fileDocument(pdfBytes, { projects = [] } = {}, cfg = {}, { read = readTitleBlock } = {}) {
  if (!pdfBytes || !pdfBytes.length) return fail("No PDF in the request.");

  const r = await read(pdfBytes, cfg, {});
  if (!r.ok) return r; // not-configured / read failure surfaces honestly

  const { fields, placement } = r;
  const m = matchProject(fields, projects, (cfg && cfg.match) || {});
  const project = m.matched ? (projects.find((p) => p.id === m.projectId) || {}).name || m.matched.name || "" : "";
  // The "item" label is the sheet's own title (then sheet number, then a safe default) — the
  // human-meaningful middle piece of "<Project> - <Item> - YYYY.MM.DD".
  const item = (fields.sheetTitle || fields.sheetNumber || "Document").trim();
  const docDate = fields.date || new Date().toISOString().slice(0, 10);

  const decision = {
    matched: !!m.matched,
    projectId: m.projectId,
    project,
    discipline: fields.discipline || "Other",
    item,
    revision: fields.revision || "",
    docDate,
    suggestedName: composeFiledName({ project, item, docDate }),
    confidence: m.confidence,
    needsFiling: m.needsFiling,
    reason: m.reason,
    candidates: m.candidates.map((c) => ({ id: c.id, name: c.name, score: +c.score.toFixed(3) })),
  };

  // The lightweight index row — one per filed drawing, queryable later (project → discipline
  // → latest revision) WITHOUT re-reading the PDF. Placement facts ride along for "Place on map".
  const facts = {
    projectId: m.projectId,
    discipline: decision.discipline,
    item,
    sheetNumber: fields.sheetNumber || "",
    sheetTitle: fields.sheetTitle || "",
    revision: decision.revision,
    docDate,
    matchConfidence: m.confidence,
    needsFiling: m.needsFiling,
    placement,
  };

  return ok({ decision, fields, placement, facts });
}
