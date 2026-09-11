/* notesTemplates — PURE: the seed content, and every structural op on the per-account
 * template list. NEW-1 (2026-09-11) turned this from a hardcoded registry (B1020931's
 * `NOTE_TEMPLATES`, one entry, no way to add or edit) into real stored records — the
 * dropdown lists whatever this account actually has, "Manage templates…" can create, rename,
 * re-body, duplicate and delete them, and "Save this page as a template" builds a new one
 * from anything already written.
 *
 * The split mirrors notesModel.js/notesStore.js exactly: this file is the PURE shape (no
 * storage, no React, no editor) and lib/notesStore.js (`readNoteTemplates`/`writeNoteTemplates`)
 * is the one place the list actually lands on disk. Like notesModel.js, this sits on
 * Notes.jsx's STATIC path — the template dropdown and the empty-state links need the list
 * before the editor engine has ever been asked for — so this module may not import
 * `@tiptap/*` or anything that reaches it (test/notesModule.test.js walks the static import
 * graph and fails the build if it ever does).
 *
 * ⛔ DEVICE-LOCAL FOR NOW, A STATED LIMIT NOT AN OVERSIGHT (see notesKeys.js's
 * TEMPLATES_KEY_BASE). Templates do not ride the cloud tree/page sync — they are scoped by
 * account (signed-in user id, or `local` signed out) exactly like everything else in this
 * module, so two accounts on one machine never see each other's templates, but two DEVICES
 * of the same account do not share a library yet. Cross-device sync is a natural follow-up,
 * not required by "per account, not hardcoded" — it needs the same rev-guarded push/merge
 * machinery notesCloud.js already built for the tree, and that is real, separate work.
 *
 * A template BODY is edited with the exact same rich-text editor a page uses
 * (components/NoteEditor.jsx, given a `loadDoc`/`saveDoc` pair that point at a template
 * record instead of a page's storage key) — never a second editor. Two things a template
 * body deliberately does NOT get, and both are stated rather than silently broken: a
 * template is not a page-tree node, so it never appears in search, Quick Open, the task
 * rollup, the duplicate scanner or the reachability sweep, and it carries no version
 * history (the History button will show "no earlier versions" — harmless, just not wired).
 * Pictures pasted into a template body DO survive (Notes.jsx threads template ids into the
 * same image-orphan sweep pages use), because that one is cheap to get right and silent data
 * loss is not an acceptable trade for saving a few lines.
 *
 * A template row is authored as a BOLD label plus a single plain space to type after, e.g.
 * `[{marks:[bold], text:"Owner:"}, {text:" "}]` — never one bold run with nothing following
 * it, which would leave the typed reply itself bold (the caret inherits the mark of whatever
 * it is next to).
 */

import { newId } from "./notesModel.js";

const clone = (v) => JSON.parse(JSON.stringify(v));

function labelRow(label) {
  return {
    type: "paragraph",
    content: [
      { type: "text", marks: [{ type: "bold" }], text: `${label}:` },
      { type: "text", text: " " },
    ],
  };
}

function fieldsDoc(heading, fields) {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: heading }] },
      ...fields.map(labelRow),
    ],
  };
}

const CONTACT_ROLES = [
  // Deal parties
  "Owner", "Seller", "Broker",
  // Design / engineering team
  "Architect", "Civil Engineer", "Structural Engineer", "Geotechnical Engineer", "Surveyor",
  // Construction, financing & closing
  "General Contractor", "Lender", "Title Company",
];
function contactsDoc() { return fieldsDoc("Project Contacts", CONTACT_ROLES); }

/* Michael's own example (NEW-1): "asset information or whatever" — the facts a developer
 * tracks about one property, not a deal's people. Kept to the same labelled-row shape; he
 * will reshape it with the editor once "Manage templates" ships, same as any other template. */
const ASSET_INFO_FIELDS = [
  "Address", "Parcel ID / APN", "Land area", "Building size (SF)", "Year built",
  "Construction type", "Zoning", "Clear height", "Dock doors", "Drive-in doors",
  "Parking spaces", "Power", "Sprinkler", "Current tenant(s)", "Lease expiration",
  "Purchase price", "Current basis",
];
function assetInfoDoc() { return fieldsDoc("Asset Information", ASSET_INFO_FIELDS); }

const BLANK_TEMPLATE_DOC = { type: "doc", content: [{ type: "paragraph" }] };

/** The templates every account starts with, seeded ONCE into storage on first read
 *  (lib/notesStore.js's `readNoteTemplates`) so nobody loses the original Project Contacts
 *  template and a second one (Asset Information) exists to prove the dropdown was never
 *  meant to hold just one. Stable ids (not `newId()`) so re-seeding is idempotent and a test
 *  can address them directly. */
export const SEED_TEMPLATES = [
  {
    id: "contacts",
    label: "Project Contacts",
    description: "Owner, seller, broker, and the design/construction team — labelled rows, ready to fill in.",
    buildDoc: contactsDoc,
  },
  {
    id: "asset-info",
    label: "Asset Information",
    description: "The facts a developer tracks about one property — size, zoning, tenants, basis.",
    buildDoc: assetInfoDoc,
  },
];

/** Build the real, storable records the seed describes — called once per account, the first
 *  time `readNoteTemplates` finds nothing there yet. `at` is a single timestamp base so the
 *  seed is deterministic in tests; the tiny per-index offset keeps a stable, readable order. */
export function seedTemplateRecords(at = Date.now()) {
  return SEED_TEMPLATES.map((t, i) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    doc: t.buildDoc(),
    createdAt: at + i,
    updatedAt: at + i,
  }));
}

/** Look up one record by id, or null — never throws, mirrors `findPage`'s own contract. */
export function templateById(list, id) {
  if (!id) return null;
  return (list || []).find((t) => t.id === id) || null;
}

/** Add a new, blank template (Manage templates → "＋ New template"). Returns `{ list, id }`
 *  in the same shape `addPage`/`createPage` already use, so callers read the same way. */
export function createTemplateRecord(list, { label, doc, at = Date.now() } = {}) {
  const rec = {
    id: newId("tpl"),
    label: label || "Untitled template",
    description: "",
    doc: doc ? clone(doc) : clone(BLANK_TEMPLATE_DOC),
    createdAt: at,
    updatedAt: at,
  };
  return { list: [...(list || []), rec], id: rec.id };
}

/** "Save this page as a template" — the cheapest way to grow the library, since it costs
 *  nothing once templates are records: read a page's own doc and title, hand them here. */
export function templateFromDoc(list, { label, doc, at = Date.now() } = {}) {
  return createTemplateRecord(list, { label, doc, at });
}

/** ⛔ RAW, ON PURPOSE — mirrors `notesModel.js`'s own `renameNode`/`commitTitle` split, and
 *  for the identical reason (that file's header names the bug this avoids): a live-typing
 *  title field that coerces blank to a default on EVERY keystroke can never be backspaced
 *  to nothing, because the very next keystroke writes the default straight back. This is
 *  the per-keystroke half; `commitTemplateLabel` below is the blur-time half that applies
 *  the default, and ONLY when the field is actually left blank. */
export function renameTemplateRecord(list, id, label) {
  return (list || []).map((t) => (t.id === id ? { ...t, label: String(label ?? ""), updatedAt: Date.now() } : t));
}

/** Apply the default name when the title field is LEFT, never while it is being typed in —
 *  a no-op tree clone (well, list copy) when the label already has real text. */
export function commitTemplateLabel(list, id) {
  const t = templateById(list, id);
  if (!t || String(t.label ?? "").trim()) return list;
  return renameTemplateRecord(list, id, "Untitled template");
}

/** What to SHOW for a template whose label is momentarily empty (mid-edit). Display only —
 *  never written back, same contract as `notesModel.js`'s `displayTitle`. */
export const displayTemplateLabel = (label) => (String(label ?? "").trim() ? String(label) : "Untitled template");

/** The body write for "edit its body in the same editor" (NoteEditor's `saveDoc` prop lands
 *  here, bound to one template's id). */
export function writeTemplateBody(list, id, doc) {
  return (list || []).map((t) => (t.id === id ? { ...t, doc: clone(doc), updatedAt: Date.now() } : t));
}

/** Duplicate — lands right after its source, same idea as the page tree's own
 *  `copyPageWithin`. Unknown id is a no-op, id null. */
export function duplicateTemplateRecord(list, id) {
  const src = templateById(list, id);
  if (!src) return { list: list || [], id: null };
  const at = Date.now();
  const rec = { ...src, id: newId("tpl"), label: `${src.label} copy`, doc: clone(src.doc), createdAt: at, updatedAt: at };
  const i = list.findIndex((t) => t.id === id);
  const next = [...list.slice(0, i + 1), rec, ...list.slice(i + 1)];
  return { list: next, id: rec.id };
}

/** Delete — the caller (Manage templates) gates this behind the app's normal inline
 *  "Delete? ✓ ✕" confirm; this function itself just does the removal. Unknown id is a no-op. */
export function deleteTemplateRecord(list, id) {
  return (list || []).filter((t) => t.id !== id);
}
