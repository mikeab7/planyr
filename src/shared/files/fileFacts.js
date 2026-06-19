/* Project Files — the tagged-index view-model (B176 / NEW-1).
 *
 * A project's "folders" are NOT a hand-maintained tree; they are SAVED VIEWS over a
 * tagged index of file facts. "All surveys", "all title commitments", "this project's
 * civil set" are all queries against the same flat list of facts. This module is the
 * pure, browser-free heart of that idea: it turns the records we already store (the
 * doc-review reviews + their source files, filed under projects by B14) into normalized
 * "file fact" rows, classifies each as spatial vs. reference, and runs saved-view
 * queries over them (per-project in the drawer, or cross-project by dropping the project
 * filter — the same query, wider scope).
 *
 * The index itself (auto-filing: read a title block → match a project → capture facts)
 * is the backend tranche. So the *capture* of facts is behind an interface
 * (`createIndexProvider`) with a stub default — the UI reads facts through the same shape
 * whether they came from a real title-block read or from the records we already have.
 * Nothing here blocks on the backend; when it lands, it just feeds richer facts in.
 */
import { emptyPlacementFacts, mergePlacementFacts } from "../placement/placementFacts.js";

/* Two document classes (NEW-1):
 *   spatial   — can live on the map (drawings, surveys, legal descriptions)
 *   reference — pulled and read, never a map object (geotech, environmental, contracts)
 *   both      — e.g. a title commitment: a reference document, but Schedule A's legal
 *               description feeds the boundary polygon and Schedule B's exceptions feed
 *               easement objects, so it is also spatial.
 */
export const DOC_CLASS = { SPATIAL: "spatial", REFERENCE: "reference", BOTH: "both" };

// Disciplines that produce map-placeable geometry by default.
const SPATIAL_DISCIPLINES = new Set(["Survey", "Civil", "Architectural", "Landscape"]);
// Disciplines that are read, not placed.
const REFERENCE_DISCIPLINES = new Set(["Geotech", "Environmental"]);

const lc = (s) => (s || "").toString().toLowerCase();
const isTitleCommitment = (item, title) =>
  /title\s*(commitment|policy|report)|schedule\s*[ab]\b|commitment\s*for\s*title/i.test(`${item || ""} ${title || ""}`);
const isLegalDescription = (item, title) =>
  /metes\s*(and|&)\s*bounds|legal\s*description|deed\b|boundary\s*description/i.test(`${item || ""} ${title || ""}`);

/* Classify a file's document class from its discipline + item/title. A title commitment
 * is BOTH (reference document whose Schedule A legal description is spatial); a bare
 * legal description is spatial; otherwise fall back to the discipline default, and to
 * reference when we genuinely can't tell (a reference doc misplaced on the map is the
 * worse error than a spatial doc left in the reading pile). */
export function classifyDocClass(discipline, item, title) {
  if (isTitleCommitment(item, title)) return DOC_CLASS.BOTH;
  if (isLegalDescription(item, title)) return DOC_CLASS.SPATIAL;
  if (SPATIAL_DISCIPLINES.has(discipline)) return DOC_CLASS.SPATIAL;
  if (REFERENCE_DISCIPLINES.has(discipline)) return DOC_CLASS.REFERENCE;
  return DOC_CLASS.REFERENCE;
}

export const isSpatial = (fact) => fact.docClass === DOC_CLASS.SPATIAL || fact.docClass === DOC_CLASS.BOTH;

/* Per-file state shown in the drawer:
 *   filed  — automatic, the moment it's indexed (every file is at least filed)
 *   on-map — a spatial file that has been calibrated/placed onto the map at least once
 * Reference-only files are never "on map" (no map object), so they stay "filed". */
export const FILE_STATE = { FILED: "filed", ON_MAP: "on-map" };
export function fileState(fact) {
  return isSpatial(fact) && fact.placed ? FILE_STATE.ON_MAP : FILE_STATE.FILED;
}

/* Normalize one review row (the lightweight `listReviews` shape, optionally carrying a
 * stored `placement` facts object + a `placed` flag in its data) into a file fact. */
export function toFileFact(row = {}) {
  const discipline = row.discipline || "Other";
  const item = row.item || row.title || "Document";
  const title = row.title || "";
  return {
    id: row.id,
    projectId: row.projectId || row.project_id || null,
    project: row.project || "",
    discipline,
    item,
    title,
    revision: row.revision || "",
    docDate: row.docDate || row.doc_date || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    kind: row.kind || "single",
    docClass: classifyDocClass(discipline, item, title),
    // NEW-2 placement-readiness flags (captured at filing time by the backend; until
    // then this is the empty shape merged with whatever the row already carries).
    placement: mergePlacementFacts(emptyPlacementFacts(), row.placement),
    placed: !!row.placed,           // has it been put on the map at least once?
    hasFile: !!(row.storageKey || row.hasFile) || row.oversize === false,
    unfiled: !(row.projectId || row.project_id),
  };
}

export const buildFileFacts = (rows = []) => rows.map(toFileFact);

/* ----------------------------- saved views ------------------------------- */
/* A saved view is a query, not a folder. `scope: "project"` views are filtered to the
 * drawer's current project; `scope: "global"` views always span all projects. Any view
 * can be widened to cross-project by passing `{ crossProject: true }` to runView — the
 * SAME query, with the project filter dropped (per NEW-1: "support both per-project
 * views (the drawer) and cross-project views (same query, project filter dropped)"). */
export const SAVED_VIEWS = [
  { id: "all", label: "All files", scope: "project", match: () => true },
  { id: "surveys", label: "All surveys", scope: "project", match: (f) => f.discipline === "Survey" },
  { id: "title", label: "Title commitments", scope: "project", match: (f) => isTitleCommitment(f.item, f.title) },
  { id: "civil", label: "Civil set", scope: "project", match: (f) => f.discipline === "Civil" },
  { id: "spatial", label: "On-the-map docs", scope: "project", match: (f) => isSpatial(f) },
  { id: "reference", label: "Reference docs", scope: "project", match: (f) => f.docClass === DOC_CLASS.REFERENCE },
  { id: "needs-filing", label: "Needs filing", scope: "global", match: (f) => f.unfiled },
];

export const getSavedView = (id) => SAVED_VIEWS.find((v) => v.id === id) || SAVED_VIEWS[0];

/* Run a saved view over the facts. `projectId` scopes "project" views to one project
 * unless `crossProject` is set (then the same predicate runs over every project). Always
 * sorted newest-first so a discipline folder shows the latest revision on top. */
export function runView(facts, viewId, { projectId = null, crossProject = false } = {}) {
  const view = getSavedView(viewId);
  let out = facts.filter(view.match);
  if (view.scope === "project" && !crossProject && projectId != null)
    out = out.filter((f) => f.projectId === projectId);
  return out.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/* Group facts by discipline, newest-first within each group — the drawer's default
 * "files grouped by discipline" rendering. Returns [{ discipline, files: [...] }]. */
export function groupByDiscipline(facts) {
  const byDisc = new Map();
  for (const f of facts) {
    if (!byDisc.has(f.discipline)) byDisc.set(f.discipline, []);
    byDisc.get(f.discipline).push(f);
  }
  return [...byDisc.entries()]
    .map(([discipline, files]) => ({
      discipline,
      files: files.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
    }))
    .sort((a, b) => a.discipline.localeCompare(b.discipline));
}

/* The "needs filing" holding area (NEW-1): files with no confident project match. Today
 * that's unfiled files; once the backend reports a match confidence, low-confidence /
 * multi-match files land here too (an explicit `needsFiling` flag overrides). */
export const needsFiling = (facts) => facts.filter((f) => f.unfiled || f.needsFiling);

/* --------------------------- index provider ------------------------------ */
/* The auto-filing index (read a title block → match a project → capture facts incl. the
 * NEW-2 placement flags) is the backend tranche. The UI talks to it ONLY through this
 * interface, so it can ship browser-first against the stub and pick up the real backend
 * with no UI change. `capturePlacementFacts` is the seam where the title-block read pass
 * will fill in embedded coords / scale bar / north arrow / boundary / dimensions. */
export function createIndexProvider(impl = {}) {
  return {
    // Read facts for a project (or all). Default: caller supplies already-loaded rows.
    async listFacts(rows = []) {
      if (impl.listFacts) return impl.listFacts(rows);
      return buildFileFacts(rows);
    },
    // Capture placement-readiness facts for a file at filing time (NEW-2). The stub
    // returns the empty shape (backend not wired); a real impl reads the title block.
    async capturePlacementFacts(file) {
      if (impl.capturePlacementFacts) return impl.capturePlacementFacts(file);
      return emptyPlacementFacts();
    },
    // Whether a real backend is wired (the UI uses this to label "auto-detected" vs
    // "set by hand" honestly rather than implying detection that didn't happen).
    backendReady: !!impl.capturePlacementFacts,
  };
}

// The browser-first default: no auto-filing backend yet, facts come from existing rows.
export const stubIndexProvider = createIndexProvider();
