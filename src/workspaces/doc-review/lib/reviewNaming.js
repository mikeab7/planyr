/* reviewNaming.js — a review's project label and auto-generated title are READ-TIME answers.
 *
 * ⛔ NEW-1 (B1991040). `doc_reviews.project` and the project part of `doc_reviews.title` are copies of
 * the project's name taken when the file was filed (measured live 2026-09-29: id rvmqzs201bfcc2d,
 * project "Pappadoupolos" / title "Pappadoupolos - Other - 2026.06.29" against a project since
 * renamed "Papadopoulos"). The id (`project_id`) is the truth; the name is looked up from it every
 * time a list is built, and the stored text is only the fallback for a row with no resolvable link.
 *
 * TITLE RULE (decided from the code that generates it). A title is AUTO-GENERATED when the app
 * composed it — `composeTitle({project, item, docDate})` at filing (reviewStore.ingest) or at save
 * (`meta.title || composeTitle(meta)`) — and USER-TYPED when a person entered text in the Name field.
 * New saves record which (`titleAuto`). A legacy row has no flag, so it is inferred: the title is auto
 * iff it EQUALS composeTitle of the row's own stored project/item/date — a string that matches what
 * the generator would have produced is generated; anything else was typed. Auto titles follow a
 * rename; typed titles are NEVER touched.
 *
 * PURE — no storage, no network — so the rule is unit-tested directly.
 */
const pad = (n) => String(n).padStart(2, "0");
export function fmtDocDate(d) {
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) { const [y, m, day] = d.slice(0, 10).split("-"); return `${y}.${m}.${day}`; }
  const dt = d ? new Date(d) : new Date();
  if (isNaN(dt)) return "";
  return `${dt.getFullYear()}.${pad(dt.getMonth() + 1)}.${pad(dt.getDate())}`;
}
export function composeTitle({ project, item, docDate } = {}) {
  // DATE-FIRST — the owner's own filing convention ("2026.06.23 GPL - Arch IFR"): every file he
  // names starts with the document date, so auto-named files sort and read the same way his do
  // (B659; was "<Project> - <Item> - date"). Keep server/filing/naming.js in lockstep.
  const head = [project, item].map((s) => (s || "").trim()).filter(Boolean).join(" - ") || "Untitled";
  const date = fmtDocDate(docDate);
  return date ? `${date} ${head}` : head;
}

const dateOf = (r) => (r ? (r.docDate != null ? r.docDate : r.doc_date) : undefined);
const projectIdOf = (r) => (r ? (r.projectId != null ? r.projectId : r.project_id) : null) || null;

// The generator has had TWO shapes. B659 made it date-first ("2026.06.29 GPL - Other"); every file
// filed before that was "<Project> - <Item> - 2026.06.29" (the live row that prompted this rule).
// Both are recognised and a recomposed title keeps the shape it was found in.
function composeLegacyTitle({ project, item, docDate } = {}) {
  const head = [project, item].map((s) => (s || "").trim()).filter(Boolean).join(" - ") || "Untitled";
  const date = fmtDocDate(docDate);
  return date ? `${head} - ${date}` : head;
}
function autoShape(rec) {
  if (!rec || !rec.title) return null;
  const date = dateOf(rec);
  const cur = date && rec.title === composeTitle({ project: rec.project, item: rec.item, docDate: date });
  const old = date && rec.title === composeLegacyTitle({ project: rec.project, item: rec.item, docDate: date });
  if (rec.titleAuto === false) return null;
  if (rec.titleAuto === true) return old && !cur ? "legacy" : "current";
  // Legacy row (no flag): auto iff it is exactly what a generator produces from its own stored
  // fields. No date → composeTitle would have stamped TODAY, so there is nothing to compare against.
  return cur ? "current" : old ? "legacy" : null;
}

/** Was this review's title composed by the app (follows a rename) rather than typed (never touched)? */
export function isAutoTitle(rec) { return autoShape(rec) != null; }

/** The project label to SHOW: the live name by id, else the stored text. */
export function liveReviewProject(rec, nameOf) {
  const id = projectIdOf(rec);
  const live = id && typeof nameOf === "function" ? nameOf(id) : null;
  return live || (rec && rec.project) || "";
}

/** The title to SHOW: an auto title is recomposed (same shape it was found in) with the live project;
 *  a typed one is returned exactly as stored. */
export function liveReviewTitle(rec, nameOf) {
  if (!rec) return "";
  const shape = autoShape(rec);
  if (!shape) return rec.title || "";
  const args = { project: liveReviewProject(rec, nameOf), item: rec.item, docDate: dateOf(rec) };
  return shape === "legacy" ? composeLegacyTitle(args) : composeTitle(args);
}

/** A list row with its display fields resolved live. Everything else passes through untouched. */
export function withLiveReviewNames(rec, nameOf) {
  if (!rec) return rec;
  const project = liveReviewProject(rec, nameOf);
  const title = liveReviewTitle(rec, nameOf);
  return { ...rec, project: project || rec.project, title: title || rec.title };
}
