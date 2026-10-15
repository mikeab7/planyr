/* Where a filed document lands in the project's folder tree — ONE answer for the client list, the File
 * picker and the server Drive move (NEW-1 of the Library File fix). Pure; rows = project_folders.
 *
 * Before: placement was `resolveDrawingTarget(discipline)` alone, which ALWAYS walks Design → Drawings, so a
 * survey filed from "Needs filing" landed in 04. Design › 01. Drawings and the Land folders were unreachable.
 * Now: an explicit stored `folderId` wins everywhere (same rule as a folder drop, B686); the drawing resolver
 * is only the fallback for a file that has no explicit folder. */
import { childrenOf, liveRows, resolveDrawingTarget, stripPrefix } from "./folderTree.js";

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/* Category → the path of folder-label KEYWORDS to walk from the tree root, plus the discipline that category
 * implies. A keyword matches a folder whose label (number prefix stripped) starts with it, so
 * "survey" finds "03. Survey & Legal Descriptions". The walk stops at the deepest folder found, so a project
 * whose tree lacks the leaf lands in the SECTION (e.g. Land), never in Design › Drawings. */
export const CATEGORY_FOLDER_HINTS = {
  Surveys:                { path: ["land", "survey"], discipline: "Survey" },
  Plats:                  { path: ["land", "plat"], discipline: "Survey" },
  Title:                  { path: ["land", "title"] },
  Geotechnical:           { path: ["land", "geotech"], discipline: "Geotech" },
  Environmental:          { path: ["land", "environmental"], discipline: "Environmental" },
  "Permits/Entitlements": { path: ["entitlements", "permits"] },
  "Reports/Studies":      { path: ["design", "reports"] },
  Agreements:             { path: ["land", "purchase"] },
};

const childStartingWith = (rows, parentId, keyword) => {
  const k = norm(keyword);
  return childrenOf(rows, parentId).find((r) => norm(stripPrefix(r.name)).startsWith(k)) || null;
};

/* The folder row a (category, discipline) pair suggests, or null when the pair gives no honest suggestion
 * (an unclassified file: category unset and discipline Other/empty). Never returns Design › Drawings for a
 * non-drawing category. `Drawings` goes through the drawing resolver. */
export function suggestFolder(rows, { category = "", discipline = "" } = {}) {
  const live = liveRows(rows);
  if (!live.length) return null;
  if (category === "Drawings") {
    const t = resolveDrawingTarget(live, discipline);
    return t ? t.row : null;
  }
  const hint = CATEGORY_FOLDER_HINTS[category];
  if (!hint) return null;
  let parent = null, found = null;
  for (const kw of hint.path) {
    const next = childStartingWith(live, parent, kw);
    if (!next) break;
    found = next; parent = next.id;
  }
  return found;
}

/* The discipline a category implies when the file's own is unset/"Other" (so a survey filed under Surveys is
 * recorded as a Survey, not left as "Other"). */
export const disciplineForCategory = (category) => (CATEGORY_FOLDER_HINTS[category] && CATEGORY_FOLDER_HINTS[category].discipline) || "";

/* Flat, tree-ordered picker rows: [{ id, name, depth }] over the live rows. */
export function folderChoices(rows) {
  const live = liveRows(rows);
  const out = [];
  const walk = (parentId, depth) => {
    for (const r of childrenOf(live, parentId)) {
      out.push({ id: r.id, name: r.name, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/* THE placement rule: an explicit `folderId` that still names a live folder wins; otherwise the discipline
 * resolver. Returns { row, driveFolderId, explicit } or null. */
export function resolvePlacement(rows, { folderId = null, discipline = "", archive = false } = {}) {
  const live = liveRows(rows);
  if (folderId) {
    const row = live.find((r) => r.id === folderId);
    if (row) return { row, driveFolderId: row.driveFolderId || null, explicit: true };
  }
  const t = resolveDrawingTarget(live, discipline, { archive });
  return t ? { ...t, explicit: false } : null;
}

/* The folder the File picker PRE-SELECTS for a document, from the same category/discipline mapping the
 * rest of the Library uses. `sel` is what the owner has chosen so far ({ category, discipline }); an
 * unclassified file (discipline Other/empty, no category chosen) gets NO suggestion — never a guess. */
export function refileDefault(rows, { discipline = "", item = "", title = "", category = "" } = {}, categoryFor) {
  const unclassified = !discipline || discipline === "Other";
  const cat = category || (unclassified ? "" : categoryFor(discipline, item, title));
  if (!cat) return { category: "", row: null };
  const disc = unclassified ? disciplineForCategory(cat) : discipline;
  return { category: cat, row: suggestFolder(rows, { category: cat, discipline: disc }) };
}
