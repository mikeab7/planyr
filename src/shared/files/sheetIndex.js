/* The Review "Current set" sheet index (NEW-1) — PURE, no React, no I/O.
 *
 * Input: file facts (fileFacts.toFileFact shape) for ONE project. Output: the project's drawings,
 * LATEST revision per sheet only, grouped by discipline, ready to render as a list.
 *
 * Reuses the repo's existing discipline logic rather than inventing a classifier:
 *   · the sheet CODE's letter prefix first (titleBlockParse.disciplineFromSheetNumber — the engineer's
 *     own filing code, same "prefix wins" rule disciplineSplit.resolvePageDiscipline uses),
 *   · then the filed `discipline` (fileFacts), ignoring the "Other" catch-all.
 * A file with neither a sheet number nor a discipline goes to a final "Other" group, listed by file
 * name — never dropped. Superseded files are not "the latest", so they are left out of the set.
 */
import { disciplineFromSheetNumber } from "./titleBlockParse.js";
import { docRecency, stateOf, FILE_STATES } from "./fileFacts.js";

export const OTHER_GROUP = "Other";

// Display order for the usual set; anything else sorts alphabetically after these, "Other" last.
const DISCIPLINE_ORDER = ["Civil", "Survey", "Geotech", "Landscape", "Architectural", "Structural",
  "Mechanical", "Electrical", "Plumbing", "Fire Sprinkler", "Fire Alarm"];

const norm = (s) => (s || "").toString().trim().toUpperCase().replace(/\s+/g, "");

/* The real name of the file behind a fact: the original upload filename, else its title/item. */
export const factFileName = (f) => f.sourceFile || f.title || f.item || "Untitled file";

/* Revision comparison: numeric when both read as numbers ("3" > "2"), else letter-wise ("B" > "A"),
 * else 0 (fall through to document recency). */
function revCmp(a, b) {
  const ra = (a || "").toString().trim(), rb = (b || "").toString().trim();
  if (!ra && !rb) return 0;
  if (!ra) return -1;
  if (!rb) return 1;
  const na = Number(ra), nb = Number(rb);
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  return ra.localeCompare(rb, undefined, { numeric: true, sensitivity: "base" });
}
/* >0 when `a` is the later issue of the same sheet. */
const laterThan = (a, b) => revCmp(a.revision, b.revision) || -docRecency(a, b);

export function disciplineOfFact(f) {
  const byCode = disciplineFromSheetNumber(f.sheetNumber);
  if (byCode) return byCode;
  const d = (f.discipline || "").trim();
  return d && d !== OTHER_GROUP ? d : OTHER_GROUP;
}

const groupRank = (label) => {
  if (label === OTHER_GROUP) return 1e6;
  const i = DISCIPLINE_ORDER.indexOf(label);
  return i < 0 ? 1000 : i;
};

const sheetSort = (a, b) =>
  (a.sheetNumber || "~").localeCompare(b.sheetNumber || "~", undefined, { numeric: true, sensitivity: "base" })
  || a.label.localeCompare(b.label, undefined, { numeric: true });

/* Latest revision per sheet. Files that carry a sheet number collapse by that number; a file with no
 * sheet number has no identity to collapse on, so it is kept as-is (never silently merged). */
export function latestPerSheet(facts = []) {
  const bySheet = new Map();
  const loose = [];
  for (const f of facts) {
    if (!f || stateOf(f) === FILE_STATES.SUPERSEDED) continue;
    const key = norm(f.sheetNumber);
    if (!key) { loose.push(f); continue; }
    const cur = bySheet.get(key);
    if (!cur || laterThan(f, cur) > 0) bySheet.set(key, f);
  }
  return [...bySheet.values(), ...loose];
}

/* → { total, groups: [{ label, rows: [{ id, fact, sheetNumber, title, revision, label }] }] } */
export function buildSheetIndex(facts = []) {
  const groups = new Map();
  let total = 0;
  for (const f of latestPerSheet(facts)) {
    const sheetNumber = (f.sheetNumber || "").toString().trim();
    // No sheet number AND no discipline → "Other", by file name. (Discipline without a number still
    // groups by discipline; its row is labelled by name since there's no number to show.)
    const label = disciplineOfFact(f);
    const title = sheetNumber ? ((f.sheetTitle || f.title || "").toString().trim()) : factFileName(f);
    const row = { id: f.id, fact: f, sheetNumber, title, revision: (f.revision || "").toString().trim(), label: sheetNumber || title };
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label).push(row);
    total++;
  }
  const out = [...groups.entries()]
    .map(([label, rows]) => ({ label, rows: rows.sort(sheetSort) }))
    .sort((a, b) => groupRank(a.label) - groupRank(b.label) || a.label.localeCompare(b.label));
  return { total, groups: out };
}

/* "12 drawings" / "1 drawing" / "No drawings yet" — the project card's count line. */
export const drawingCountLabel = (n) => (n > 0 ? `${n} drawing${n === 1 ? "" : "s"}` : "No drawings yet");
