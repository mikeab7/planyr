/* Project Files — the tagged-index view-model (B180 / NEW-1).
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

// Disciplines that produce map-placeable geometry by default. CAD is the most placeable
// class of all — it IS the drawings — so it classifies spatial, not reference (NEW-1).
const SPATIAL_DISCIPLINES = new Set(["Survey", "Civil", "Architectural", "Landscape", "CAD"]);
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
    // The engineer's own sheet identity, captured by the filing index (B659) — the Library list
    // shows the range/code badge so a 40-sheet set isn't an opaque row.
    sheetNumber: row.sheetNumber || row.sheet_number || "",
    sheetTitle: row.sheetTitle || row.sheet_title || "",
    kind: row.kind || "single",
    // The original upload filename (B685; from the file-facts index). Its extension is how the
    // Library distinguishes a PDF (openable in Review) from any other stored file (downloadable).
    // Absent on legacy/interactive files — which were always PDFs, so absence reads as "PDF".
    sourceFile: row.sourceFile || row.source_file || "",
    docClass: classifyDocClass(discipline, item, title),
    // Work Item B IA fields. `category` (canonical top-level) + `state` are written by the
    // auto-filer / a re-file; when absent they're derived (categoryOf / stateOf) so the
    // tree works BEFORE the migration runs (graceful, like project_library). `subcategory`
    // reuses `discipline` (don't duplicate a column) — a manually-typed one overrides it.
    category: row.category || null,
    subcategory: row.subcategory || discipline,
    state: row.state || null,
    // NEW-2 placement-readiness flags (captured at filing time by the backend; until
    // then this is the empty shape merged with whatever the row already carries).
    placement: mergePlacementFacts(emptyPlacementFacts(), row.placement),
    // Has it been put on the map at least once? `listReviews` surfaces this from the
    // review's data (`placed:data->placed`), which can arrive as a JSON boolean or text
    // depending on the accessor — accept both so the on-map badge isn't dead (NEW-3).
    placed: row.placed === true || row.placed === "true",
    hasFile: !!(row.storageKey || row.hasFile) || row.oversize === false,
    unfiled: !(row.projectId || row.project_id),
    // An explicit needs-filing flag from the file-facts index (low/no-confidence match).
    needsFiling: row.needsFiling === true || row.needs_filing === true,
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

/* Newest-first by the DOCUMENT's own date — the issue/revision date read off the sheet — falling
 * back to upload time only when no docDate was captured (B659). Sorting on upload time alone put
 * an old drawing uploaded yesterday above last week's newer revision ("latest on top" lied).
 * Upload time still breaks ties between same-day documents. */
export function docRecency(a, b) {
  const ad = a.docDate || a.updatedAt || 0, bd = b.docDate || b.updatedAt || 0;
  const d = new Date(bd) - new Date(ad);
  return d || (new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
}

/* Run a saved view over the facts. `projectId` scopes "project" views to one project
 * unless `crossProject` is set (then the same predicate runs over every project). Always
 * sorted newest-first (document date) so a discipline folder shows the latest revision on top. */
export function runView(facts, viewId, { projectId = null, crossProject = false } = {}) {
  const view = getSavedView(viewId);
  let out = facts.filter(view.match);
  if (view.scope === "project" && !crossProject && projectId != null)
    out = out.filter((f) => f.projectId === projectId);
  return out.sort(docRecency);
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
      files: files.sort(docRecency),
    }))
    .sort((a, b) => a.discipline.localeCompare(b.discipline));
}

/* The "needs filing" holding area (NEW-1): files with no confident project match. Today
 * that's unfiled files; once the backend reports a match confidence, low-confidence /
 * multi-match files land here too (an explicit `needsFiling` flag overrides). */
export const needsFiling = (facts) => facts.filter((f) => f.unfiled || f.needsFiling);

/* ===================== Work Item B — the file-browser IA =====================
 *
 * Three SEPARATE axes (the old flat chip row jammed them into one):
 *   • Folder tree   = WHAT KIND of document it is — the one true hierarchy. A canonical,
 *                     code-defined top level (so a manual filer always has a target) with
 *                     data-driven second level (the disciplines actually present).
 *   • State facet   = WHAT STATE it's in (needs_filing | filed | superseded).
 *   • Usage facet   = HOW IT'S USED (on the map | reference).
 * State/usage are filters + per-file badges, never folders.
 */

// Canonical top-level categories. Code-defined + stable so the tree never wanders and a
// manual filer always has a clean target (a hardcoded discipline list would strand the
// first "Demolition" or "Process" set — disciplines are the DATA-driven second level).
export const CATEGORIES = [
  "Drawings", "Surveys", "Plats", "Title", "Geotechnical",
  "Environmental", "Permits/Entitlements", "Reports/Studies", "Agreements",
];

// Disciplines whose default home is the drawing set.
const DRAWING_DISCIPLINES = new Set([
  "Architectural", "Structural", "Civil", "Mechanical", "Electrical",
  "Plumbing", "Landscape", "Fire Alarm", "Fire Sprinkler", "CAD",
]);
const isPlat = (item, title) => /\b(re)?plat\b|subdivision\s*plat|final\s*plat|preliminary\s*plat/i.test(`${item || ""} ${title || ""}`);
const isPermit = (item, title) => /\bpermit\b|zoning|entitlement|variance\b|\bSUP\b|special\s*use|site\s*plan\s*approval|plat\s*application/i.test(`${item || ""} ${title || ""}`);
const isAgreement = (item, title) => /agreement|\bcontract\b|\bMOU\b|covenant|\bCC&Rs?\b|deed\s*restriction|easement\s*(agreement|grant)/i.test(`${item || ""} ${title || ""}`);
const isReport = (item, title) => /\breport\b|\bstudy\b|\banalysis\b|assessment|memorandum|\bmemo\b/i.test(`${item || ""} ${title || ""}`);

/* Map a file to its canonical category from discipline + item/title. Most-specific first
 * (a plat/title is its own category even though it's a survey product). Pure; deterministic
 * so the tree can derive a category when one wasn't stored. */
export function categoryFor(discipline, item, title) {
  if (isTitleCommitment(item, title)) return "Title";
  if (isPlat(item, title)) return "Plats";
  if (discipline === "Survey" || isLegalDescription(item, title)) return "Surveys";
  if (discipline === "Geotech") return "Geotechnical";
  if (discipline === "Environmental") return "Environmental";
  if (isPermit(item, title)) return "Permits/Entitlements";
  if (isAgreement(item, title)) return "Agreements";
  if (DRAWING_DISCIPLINES.has(discipline)) return "Drawings";
  if (isReport(item, title)) return "Reports/Studies";
  return "Reports/Studies"; // a read-pile fallback — never a phantom drawing node
}

// The file's category: an explicit stored one (auto-filer / re-file) wins; else derived.
export const categoryOf = (f) => f.category || categoryFor(f.discipline, f.item, f.title);
export const subcategoryOf = (f) => f.subcategory || f.discipline || "Other";

/* Filing-lifecycle state (the STATE facet). Explicit `superseded`/`needs_filing` win; an
 * unfiled / low-confidence file is needs_filing; everything else is filed. */
export const FILE_STATES = { NEEDS_FILING: "needs_filing", FILED: "filed", SUPERSEDED: "superseded" };
export function stateOf(f) {
  if (f.state === FILE_STATES.SUPERSEDED) return FILE_STATES.SUPERSEDED;
  if (f.state === FILE_STATES.NEEDS_FILING || f.unfiled || f.needsFiling) return FILE_STATES.NEEDS_FILING;
  return FILE_STATES.FILED;
}

// Usage facet predicates: on-the-map (placed spatial) vs. reference (read-only class).
export const onMap = (f) => isSpatial(f) && !!f.placed;
export const isReference = (f) => f.docClass === DOC_CLASS.REFERENCE;

/* The usage/state facet row above the list. "Needs filing" is handled separately (it's the
 * holding area, not a filter over the tree node) so it carries its own live count. */
export const FACETS = [
  { id: "all", label: "All", match: () => true },
  { id: "on-map", label: "On the map", match: onMap },
  { id: "reference", label: "Reference", match: isReference },
];

// A file belongs to the tree (a real category node) only once it's filed; needs-filing
// lives in the holding area and superseded is hidden unless asked for.
const inTree = (f, includeSuperseded) => {
  const st = stateOf(f);
  return st === FILE_STATES.FILED || (includeSuperseded && st === FILE_STATES.SUPERSEDED);
};

/* Derive the category tree from facts (metadata only — never touches file bytes). Canonical
 * order; EMPTY categories don't render; each node carries a count and its data-driven
 * subcategories (the disciplines present), also with counts. */
export function deriveTree(facts, { includeSuperseded = false } = {}) {
  const byCat = new Map(); // category -> Map(subcategory -> count)
  for (const f of facts) {
    if (!inTree(f, includeSuperseded)) continue;
    const cat = categoryOf(f), sub = subcategoryOf(f);
    if (!byCat.has(cat)) byCat.set(cat, new Map());
    const subs = byCat.get(cat);
    subs.set(sub, (subs.get(sub) || 0) + 1);
  }
  return CATEGORIES.filter((c) => byCat.has(c)).map((category) => {
    const subs = [...byCat.get(category).entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { category, count: subs.reduce((n, s) => n + s.count, 0), subs };
  });
}

// Does a fact fall under the selected tree node (category / subcategory)?
export function nodeMatch(f, { category = null, subcategory = null } = {}) {
  if (category && categoryOf(f) !== category) return false;
  if (subcategory && subcategoryOf(f) !== subcategory) return false;
  return true;
}

/* The file list for the current tree node + facet, newest-first. Excludes the holding area
 * (needs-filing) and, by default, superseded files. Pure + metadata-only. */
export function browseFiles(facts, { category = null, subcategory = null, facet = "all", includeSuperseded = false } = {}) {
  const facetFn = (FACETS.find((x) => x.id === facet) || FACETS[0]).match;
  return facts
    .filter((f) => inTree(f, includeSuperseded) && nodeMatch(f, { category, subcategory }) && facetFn(f))
    .sort(docRecency);
}

// The project's needs-filing holding area (a loud, truthful to-do — a stuck/invisible
// needs-filing item is a silent failure). Upload-time order here: the user's to-do queue.
export const holdingArea = (facts) => facts.filter((f) => stateOf(f) === FILE_STATES.NEEDS_FILING)
  .sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));

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
