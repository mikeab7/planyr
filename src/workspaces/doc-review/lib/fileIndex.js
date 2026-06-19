/* Project Files — tagged-index view-model (B180 / NEW-1). Pure + browser-free, so the
 * query logic is unit-tested. The repository is a TAGGED INDEX, not a hand-maintained
 * tree: "All surveys", "All title commitments", "this project's civil set" are all
 * QUERIES (saved views) over file facts. Per-project views just add a project filter;
 * the same query run cross-project drops it.
 *
 * Each file is classified into a document class (NEW-2/fileFacts): `spatial` (can live
 * on the map), `reference` (read-only), or `both` (a title commitment). The drawer reads
 * these to show per-file state (Filed vs On map) and to gate "Place on map".
 *
 * Browser-first: the index here is built from the doc_reviews rows the app already has
 * (reviewStore.listReviews). The richer auto-filing index (title-block facts, Drive
 * routing) is the backend tranche — it fills the SAME entry shape, so this view-model
 * doesn't change when it lands. `buildIndex` is the seam.
 */
import { DOC_CLASS, classifyDocClass } from "../../../shared/files/fileFacts.js";

export { DOC_CLASS };

// Item-keyword → tag. Cheap, browser-side; the backend title-block pass can add more.
const TAG_RULES = [
  [/\bsurvey|alta|topo(graphic)?\b/i, "survey"],
  [/\btitle\s*(commitment|policy|report)|schedule\s*[ab]\b/i, "title-commitment"],
  [/\bplat|subdivision\b/i, "plat"],
  [/\bmetes|bounds|legal\s*desc|deed\b/i, "legal-description"],
  [/\bgrading|drainage|paving|utility|civil\b/i, "civil-set"],
  [/\blandscape|planting|irrigation\b/i, "landscape"],
  [/\bgeotech|soils?|boring\b/i, "geotech"],
  [/\benvironmental|phase\s*[i12]|esa\b/i, "environmental"],
  [/\bcontract|agreement\b/i, "contract"],
];

const fileTime = (r) => (r.docDate || r.doc_date ? new Date(r.docDate || r.doc_date).getTime() : 0) || new Date(r.updatedAt || r.updated_at || 0).getTime();

/* Normalize one doc_reviews row into a tagged index entry. Accepts either the camelCase
 * review record or the snake_case list row from PostgREST. */
export function indexEntry(review = {}) {
  const discipline = review.discipline || "Other";
  const item = review.item || review.title || "";
  const title = review.title || "";
  const docClass = classifyDocClass({ discipline, item, title });
  const text = `${item} ${title}`;
  const tags = new Set([discipline.toLowerCase(), docClass, review.kind || "single"]);
  for (const [re, tag] of TAG_RULES) if (re.test(text)) tags.add(tag);
  return {
    id: review.id,
    projectId: review.projectId || review.project_id || null,
    project: review.project || "",
    discipline, item, title,
    revision: review.revision || "",
    docDate: review.docDate || review.doc_date || null,
    kind: review.kind || "single",
    updatedAt: review.updatedAt || review.updated_at || null,
    time: fileTime(review),
    docClass,
    onMap: !!(review.onMap || review.placement),   // "calibrated once" → placed on the map
    tags: [...tags],
    raw: review,
  };
}

export function buildIndex(reviews = []) {
  return reviews.map(indexEntry);
}

const has = (e, tag) => e.tags.includes(tag);
const isSpatial = (e) => e.docClass === DOC_CLASS.SPATIAL || e.docClass === DOC_CLASS.BOTH;

/* A file needs filing when it isn't confidently under a project/discipline — the
 * "needs filing" holding area (one-click confirm). A misfiled drawing is worse than an
 * unfiled one, so anything unlinked or in the catch-all "Other" bucket lands here. */
export function needsFiling(e) {
  return !e.projectId || e.discipline === "Other" || !e.discipline;
}

/* Per-file state shown in the drawer: 'on-map' once calibrated, else 'filed'. */
export function fileState(e) {
  return e.onMap ? "on-map" : "filed";
}

/* Saved views = queries over the index. `scope:'project'` views take the active
 * project filter in the drawer; run any of them cross-project by passing no projectId. */
export const SAVED_VIEWS = [
  { id: "all", label: "All files", scope: "cross", test: () => true },
  { id: "spatial", label: "Map-ready (spatial)", scope: "project", test: isSpatial },
  { id: "surveys", label: "All surveys", scope: "cross", test: (e) => has(e, "survey") || e.discipline === "Survey" },
  { id: "title", label: "Title commitments", scope: "cross", test: (e) => has(e, "title-commitment") },
  { id: "civil", label: "Civil set", scope: "project", test: (e) => e.discipline === "Civil" || has(e, "civil-set") },
  { id: "reference", label: "Reference docs", scope: "cross", test: (e) => e.docClass === DOC_CLASS.REFERENCE },
  { id: "onmap", label: "On the map", scope: "cross", test: (e) => e.onMap },
  { id: "needs-filing", label: "Needs filing", scope: "cross", test: needsFiling },
];

export const viewById = (id) => SAVED_VIEWS.find((v) => v.id === id) || SAVED_VIEWS[0];

/* Run a saved view over the index. A 'project'-scoped view applies the project filter
 * only when a projectId is given (drop it → the same query, cross-project). Always
 * newest-first. `extra` lets a caller AND-in an ad-hoc predicate (e.g. a search box). */
export function runView(view, entries, { projectId = null, extra = null } = {}) {
  const v = typeof view === "string" ? viewById(view) : view;
  let list = entries.filter((e) => v.test(e));
  if (v.scope === "project" && projectId) list = list.filter((e) => e.projectId === projectId);
  if (typeof extra === "function") list = list.filter(extra);
  return list.sort((a, b) => b.time - a.time);
}

/* Count entries each view would return (for the view chips' badges), honoring the
 * active project filter the same way runView does. */
export function viewCounts(entries, { projectId = null } = {}) {
  const out = {};
  for (const v of SAVED_VIEWS) out[v.id] = runView(v, entries, { projectId }).length;
  return out;
}
