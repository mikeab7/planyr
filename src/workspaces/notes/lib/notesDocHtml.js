/* notesDocHtml — a note's document model → HTML, through the EDITOR'S OWN serializer.
 *
 * ⛔ PDF-PARITY, BOUGHT BY CONSTRUCTION RATHER THAN BY DISCIPLINE. The obvious way to build
 * a print sheet is to write a second serializer beside the Markdown one. That is exactly
 * how a screen and its export drift: two hand-written walkers over one schema, and every
 * new construct has to be remembered twice. So this file writes NOTHING itself. It asks
 * ProseMirror's `DOMSerializer` to render the document using the very `renderHTML` each
 * extension already uses to paint the screen — the same schema, the same rules. A node that
 * renders on screen renders on paper, and a node added tomorrow does both with no edit here.
 *
 * The ONE thing it does add is the image src: the `noteImage` node's HTML deliberately
 * carries only an id (the bytes live in IndexedDB), so the caller passes a map of
 * `imageId → data URL` and this file inlines them — which is what makes a printed sheet,
 * like an exported Markdown file, self-contained. A missing one becomes a VISIBLE
 * "image missing" block, never a gap.
 *
 * ⛔ Reached only by dynamic import from the workspace root, and statically only from the
 * lazy editor chunk: it imports the schema, and the schema pulls the engine.
 */
import { getSchema } from "@tiptap/core";
import { DOMSerializer, Node as PMNode } from "@tiptap/pm/model";
import { NOTE_EXTENSIONS } from "./notesExtensions.js";

let cached = null;
const noteSchema = () => (cached || (cached = getSchema(NOTE_EXTENSIONS)));

/** One document model → an HTML fragment string. Returns "" for an unreadable document
 *  rather than throwing: one bad page must not take a whole notebook's print with it. */
export function docToHtml(doc, images = null) {
  if (!doc || typeof doc !== "object") return "";
  const schema = noteSchema();
  let node;
  try { node = PMNode.fromJSON(schema, doc); } catch (_) { return ""; }

  const box = document.createElement("div");
  try { box.appendChild(DOMSerializer.fromSchema(schema).serializeFragment(node.content)); }
  catch (_) { return ""; }

  for (const img of Array.from(box.querySelectorAll("img[data-note-image]"))) {
    const src = images ? images[img.getAttribute("data-note-image")] : null;
    if (src) { img.setAttribute("src", src); continue; }
    const miss = document.createElement("span");
    miss.className = "planyr-note-image-missing";
    miss.textContent = "Image missing — its stored copy is no longer on this device.";
    img.replaceWith(miss);
  }
  return box.innerHTML;
}
