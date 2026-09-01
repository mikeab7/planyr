/* B1020931 — note templates: an extensible seed-content mechanism for page creation.
 *
 * A template is {id, label, description, buildDoc()} — buildDoc returns a plain ProseMirror
 * document JSON object, hand-built here with NO import from `notesExtensions.js` or any
 * `@tiptap/*` package. That is deliberate, not an oversight: this module sits on Notes.jsx's
 * STATIC path (the page-creation button needs it before the editor engine has ever been
 * asked for), and the module's own house rule is that nothing on the static path may pull the
 * editor in — only `NoteEditor.jsx` may, via a dynamic import. A template is just data; it is
 * written straight to storage with `notesStore.js`'s `writePage(pageId, doc)`, the same seam
 * every autosave uses, so the editor never has to be mounted (or even downloaded) to seed a page.
 *
 * Adding a second template means adding one entry to NOTE_TEMPLATES — no other file changes.
 *
 * A template row is authored as a BOLD label plus a single plain space to type after, e.g.
 * `[{marks:[bold], text:"Owner:"}, {text:" "}]` — never one bold run with nothing following it,
 * which would leave the typed reply itself bold (the caret inherits the mark of whatever it is
 * next to). Deliberately plain paragraphs, not a table: this module's own tooling
 * (`notesTableToText.js`) already treats a table as something to convert AWAY from for
 * non-tabular content, and a labelled-rows sheet has no need of cell navigation, column resize,
 * or the boundary-key history a real table drags in (`notesBlockKeys.js`, B291536).
 */

const CONTACT_ROLES = [
  // Deal parties
  "Owner", "Seller", "Broker",
  // Design / engineering team
  "Architect", "Civil Engineer", "Structural Engineer", "Geotechnical Engineer", "Surveyor",
  // Construction, financing & closing
  "General Contractor", "Lender", "Title Company",
];

function contactRow(role) {
  return {
    type: "paragraph",
    content: [
      { type: "text", marks: [{ type: "bold" }], text: `${role}:` },
      { type: "text", text: " " },
    ],
  };
}

function contactsDoc() {
  return {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Project Contacts" }] },
      ...CONTACT_ROLES.map(contactRow),
    ],
  };
}

export const NOTE_TEMPLATES = [
  {
    id: "contacts",
    label: "Project Contacts",
    description: "Owner, seller, broker, and the design/construction team — labelled rows, ready to fill in.",
    buildDoc: contactsDoc,
  },
];

export function templateById(id) {
  return NOTE_TEMPLATES.find((t) => t.id === id) || null;
}
