/* notesAttachNode — the `noteAttachment` node: any file, sitting in a note (NEW-5).
 *
 * ⛔ SAME RULE AS A PICTURE, AND FOR THE SAME REASON: THE DOCUMENT NEVER HOLDS THE BYTES.
 * The node carries a `fileId`, a name, a mime type and a size; the bytes live behind the
 * one storage seam (IndexedDB on the device, the private Supabase bucket in the account).
 * A 4 MB survey base64'd into the document model would go into localStorage with every
 * other note and break EVERY save in EVERY note after it — which is the constraint the
 * whole pictures design was shaped around, and an attachment is strictly worse: nothing
 * downscales a DWG.
 *
 * ⛔ IT REUSES THE PICTURE TIER RATHER THAN BUILDING A SECOND ONE. Same IndexedDB store,
 * same cloud table, same bucket, same per-page cascade in the purge, same sweep. The only
 * schema change the account needed was to stop the bucket refusing non-image types and to
 * carry the file's NAME on the row (see db/notes_attachments.sql). A parallel blob tier
 * would have meant a second sync plan, a second purge cascade and a second way to leak
 * bytes; there is one of each.
 *
 * ⛔ AND A DROP OF A PICTURE IS STILL A PICTURE. This node's intake claims only what
 * `isImageFile` refuses, so pasting a screenshot still produces an inline image, not a chip
 * called `image.png`. Both plugins see the same drop; the image plugin is asked first
 * (lib/notesExtensions.js orders them), and this one takes what is left.
 */
import { Node, mergeAttributes } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { newId } from "./notesModel.js";
import { putNoteFile, readNoteFile, reportImageProblem } from "./notesStore.js";
import { isImageFile } from "./notesImageIntake.js";
import { attachmentLabel, fileExtLabel, fileSizeLabel, safeAttachmentName } from "./notesFileMeta.js";

/** Split what a drop or paste carried into pictures and everything else. */
function splitFiles(dt) {
  const all = (dt && dt.files ? Array.from(dt.files) : []).filter(Boolean);
  return { images: all.filter(isImageFile), files: all.filter((f) => !isImageFile(f)) };
}

/** ⛔ A MIXED DROP MUST NOT LOSE HALF OF ITSELF (LOUD-FAILURE, quietly). Two plugins both
 *  watching the same drop is a race the first one to `return true` wins outright — so a
 *  screenshot dragged in alongside a PDF would land the picture and drop the PDF on the
 *  floor with no message anywhere. This plugin runs FIRST and declines a drop that is
 *  pictures only (leaving the image node's own path exactly as it was); a drop with any
 *  non-picture in it, it claims WHOLE and routes both halves. */
const claims = ({ images, files }) => files.length > 0 && (images.length > 0 || files.length > 0);

/** Read a File as a data URL — the one shape the store, the cloud tier, the export and the
 *  print sheet already speak, so nothing downstream learns an attachment is different. */
function fileToDataUrl(file) {
  return new Promise((resolve) => {
    try {
      const fr = new FileReader();
      fr.onload = () => resolve(typeof fr.result === "string" ? fr.result : null);
      fr.onerror = () => resolve(null);
      fr.readAsDataURL(file);
    } catch (_) { resolve(null); }
  });
}

/** Hand the bytes to the browser as a download, under the file's real name. */
export function downloadDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = safeAttachmentName(name);
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Store each file, then insert its chip. Sequential for the same reason pictures are: the
 *  per-page ceiling has to see the previous file's bytes already counted, or two drops
 *  could straddle the limit between them. */
async function insertFiles(ext, view, files) {
  for (const file of files) {
    const dataUrl = await fileToDataUrl(file);
    if (!dataUrl) { reportImageProblem(`“${file.name}” could not be read, so it was NOT attached.`); continue; }

    const ctx = (typeof ext.options.imageContext === "function" ? ext.options.imageContext() : null) || {};
    const fileId = newId("file");
    const stored = await putNoteFile({
      id: fileId,
      pageId: ctx.pageId || null,
      dataUrl,
      name: file.name,
      mime: file.type || "",
      notebookPageIds: Array.isArray(ctx.notebookPageIds) ? ctx.notebookPageIds : null,
    });
    if (!stored.ok) continue;   // putNoteFile has already named the failure in the banner

    const { state } = view;
    const node = state.schema.nodes.noteAttachment.create({
      fileId,
      name: safeAttachmentName(file.name),
      mime: file.type || "",
      size: file.size || 0,
    });
    view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  }
}

export const NoteAttachment = Node.create({
  name: "noteAttachment",
  // Above the picture node's own intake, so a MIXED drop is decided in one place. See the
  // `claims` note above: a pictures-only drop is declined here and the image path runs
  // exactly as it always did.
  priority: 150,
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    // Same shape and same reason as the picture node: WHICH page a file belongs to is read
    // at DROP time, because a value captured at mount goes stale the moment a page is added.
    return { imageContext: null };
  },

  addAttributes() {
    return {
      fileId: { default: null },
      name: { default: "" },
      mime: { default: "" },
      size: { default: 0 },
    };
  },

  parseHTML() {
    return [{
      tag: "a[data-note-file]",
      getAttrs: (el) => ({
        fileId: el.getAttribute("data-note-file"),
        name: el.getAttribute("data-name") || el.textContent || "",
        mime: el.getAttribute("data-mime") || "",
        size: Number(el.getAttribute("data-size")) || 0,
      }),
    }];
  },

  /* The HTML form carries the ID and the DESCRIPTION, never the bytes — exactly like the
   * picture node, and for the same reason. The print path fills in an href where it has
   * one (lib/notesDocHtml.js); on paper the words are the point anyway, which is what
   * makes an attachment survive a PDF instead of vanishing from it. */
  renderHTML({ HTMLAttributes: a }) {
    return ["a", {
      "data-note-file": a.fileId,
      "data-name": a.name || "",
      "data-mime": a.mime || undefined,
      "data-size": a.size || undefined,
      class: "planyr-note-file",
      href: "#",
    }, attachmentLabel({ name: a.name, mime: a.mime, size: a.size })];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "planyr-note-file";
      dom.setAttribute("data-testid", "note-attachment");
      dom.setAttribute("data-file-id", node.attrs.fileId || "");
      dom.setAttribute("data-name", node.attrs.name || "");

      const badge = document.createElement("span");
      badge.className = "planyr-note-file-badge";
      badge.textContent = fileExtLabel(node.attrs.name, node.attrs.mime);

      const label = document.createElement("span");
      label.className = "planyr-note-file-name";
      label.textContent = safeAttachmentName(node.attrs.name);

      const size = document.createElement("span");
      size.className = "planyr-note-file-size";
      size.textContent = fileSizeLabel(node.attrs.size);

      const get = document.createElement("button");
      get.type = "button";
      get.className = "planyr-note-file-get";
      get.setAttribute("data-testid", "note-attachment-download");
      get.textContent = "Download";
      get.title = `Download ${safeAttachmentName(node.attrs.name)}`;

      /* LOUD-FAILURE: bytes that are gone say so IN THE CHIP. An attachment that silently
       * downloads nothing is the same lie as a picture that renders a blank gap. */
      get.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        const src = node.attrs.fileId ? await readNoteFile(node.attrs.fileId) : null;
        if (!src) {
          dom.setAttribute("data-missing", "1");
          get.textContent = "File missing";
          get.disabled = true;
          reportImageProblem(`“${safeAttachmentName(node.attrs.name)}” is not stored on this device any more, so it could not be downloaded.`);
          return;
        }
        downloadDataUrl(src, node.attrs.name);
      });
      // A press anywhere on the chip must not put a caret inside an atom node.
      dom.addEventListener("mousedown", (e) => { if (e.target === get) e.stopPropagation(); });

      dom.append(badge, label, size, get);
      return { dom, ignoreMutation: () => true };
    };
  },

  addCommands() {
    return {
      /** Used by the toolbar's attach button and by the slash menu's Attachment item. */
      insertNoteFiles: (files) => ({ view }) => {
        const list = (Array.isArray(files) ? files : Array.from(files || [])).filter(Boolean);
        if (!list.length) return false;
        insertFiles(this, view, list);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    const take = async (view, split) => {
      if (split.images.length) ext.editor?.commands.insertNoteImages(split.images);
      await insertFiles(ext, view, split.files);
    };
    return [new Plugin({
      key: new PluginKey("noteAttachmentIntake"),
      props: {
        handlePaste(view, event) {
          const split = splitFiles(event.clipboardData);
          if (!claims(split)) return false;
          event.preventDefault();
          take(view, split);
          return true;
        },
        handleDrop(view, event) {
          const split = splitFiles(event.dataTransfer);
          if (!claims(split)) return false;
          event.preventDefault();
          take(view, split);
          return true;
        },
      },
    })];
  },
});

export default NoteAttachment;
