/* notesImageNode — the `noteImage` schema node: a picture inside a note page.
 *
 * ⛔ THE DOCUMENT NEVER HOLDS THE BYTES. The node's only real attribute is an `imageId`;
 * the pixels live in IndexedDB behind lib/notesStore.js. Base64-ing a photo into the
 * document model would put it into localStorage with every other note, where two phone
 * photos exhaust the whole origin and EVERY save after that fails — in every notebook, not
 * just this one. That is the single constraint this whole feature is shaped around.
 *
 * WHAT THE NODE VIEW BUYS. A picture cannot be rendered synchronously from an id, so the
 * view paints the frame first and fills it when the bytes arrive. It also owns the state
 * this module refuses to leave silent: an image whose bytes are GONE renders a visible,
 * named broken-image block, never a blank gap the user reads as "my picture deleted itself".
 *
 * PASTE AND DROP ARE THE SAME PATH. Both hand their files to `insertFiles`, which
 * downscales (notesImageIntake), stores (notesStore, which enforces the ceilings), and only
 * then inserts a node. A refusal at any step is a NAMED banner and NO node — the one thing
 * that must never happen is a paste that quietly does nothing.
 */
import { Node } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { newId } from "./notesModel.js";
import { putNoteImage, readNoteImage, reportImageProblem } from "./notesStore.js";
import { isImageFile, prepareNoteImage } from "./notesImageIntake.js";

const filesFrom = (dt) => (dt && dt.files ? Array.from(dt.files) : []).filter(isImageFile);

/** Store each file, then insert a node for it. Sequential on purpose: two 5 MB pastes
 *  encoding at once is a visible stall, and the ceiling check has to see the previous
 *  image's bytes already counted or a pair of pastes could straddle the limit. */
async function insertFiles(ext, view, files) {
  for (const file of files) {
    const prepared = await prepareNoteImage(file);
    if (!prepared.ok) { reportImageProblem(prepared.error); continue; }

    const ctx = (typeof ext.options.imageContext === "function" ? ext.options.imageContext() : null) || {};
    const imageId = newId("img");
    const stored = await putNoteImage({
      id: imageId,
      pageId: ctx.pageId || null,
      dataUrl: prepared.dataUrl,
      mime: prepared.mime,
      w: prepared.w,
      h: prepared.h,
      notebookPageIds: Array.isArray(ctx.notebookPageIds) ? ctx.notebookPageIds : null,
    });
    if (!stored.ok) continue;   // putNoteImage has already named the failure in the banner

    // Re-read the live state each time: the previous insert moved everything after it.
    const { state } = view;
    const node = state.schema.nodes.noteImage.create({
      imageId,
      alt: String(file.name || "image").slice(0, 120),
      mime: prepared.mime,
      w: prepared.w || null,
      h: prepared.h || null,
    });
    view.dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
  }
}

export const NoteImage = Node.create({
  name: "noteImage",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,

  addOptions() {
    // A function rather than a value: the page a picture belongs to, and the notebook it is
    // charged against, are read AT PASTE TIME. A captured value goes stale the moment a
    // page is added beside this one.
    return { imageContext: null };
  },

  addAttributes() {
    return {
      imageId: { default: null },
      alt: { default: "" },
      mime: { default: "" },
      w: { default: null },
      h: { default: null },
    };
  },

  parseHTML() {
    return [{
      tag: "img[data-note-image]",
      getAttrs: (el) => ({
        imageId: el.getAttribute("data-note-image"),
        alt: el.getAttribute("alt") || "",
        mime: el.getAttribute("data-mime") || "",
        w: Number(el.getAttribute("data-w")) || null,
        h: Number(el.getAttribute("data-h")) || null,
      }),
    }];
  },

  /* The HTML form carries the id, NOT a src — this is what the print sheet and any HTML
   * copy see, and it is deliberately resolvable only through the store. The print path
   * substitutes real data URLs in one pass (lib/notesDocHtml.js). */
  renderHTML({ HTMLAttributes: a }) {
    return ["img", {
      "data-note-image": a.imageId,
      alt: a.alt || "",
      "data-mime": a.mime || undefined,
      "data-w": a.w || undefined,
      "data-h": a.h || undefined,
      class: "planyr-note-img",
    }];
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement("figure");
      dom.className = "planyr-note-image";
      dom.setAttribute("data-testid", "note-image");
      dom.setAttribute("data-image-id", node.attrs.imageId || "");

      const img = document.createElement("img");
      img.alt = node.attrs.alt || "";
      img.draggable = false;
      dom.appendChild(img);

      let alive = true;
      const missing = (why) => {
        if (!alive) return;
        img.remove();
        dom.setAttribute("data-missing", "1");
        const box = document.createElement("span");
        box.className = "planyr-note-image-missing";
        box.textContent = why;
        dom.appendChild(box);
      };

      if (!node.attrs.imageId) missing("Image missing — this page refers to a picture with no id.");
      else {
        readNoteImage(node.attrs.imageId).then((src) => {
          if (!alive) return;
          if (src) img.src = src;
          // LOUD-FAILURE, drawn rather than logged: the bytes are gone (a purge, a cleared
          // browser store, a note copied to a device the picture never reached). Say so.
          else missing("Image missing — its stored copy is no longer on this device.");
        });
        // A data URL that will not decode is the same visible state, not a broken glyph.
        img.addEventListener("error", () => missing("Image missing — the stored copy could not be displayed."));
      }

      return {
        dom,
        ignoreMutation: () => true,
        destroy() { alive = false; },
      };
    };
  },

  addCommands() {
    return {
      // Used by the toolbar's picture button; paste and drop go through the plugin below.
      insertNoteImages: (files) => ({ view }) => {
        const list = (Array.isArray(files) ? files : Array.from(files || [])).filter(isImageFile);
        if (!list.length) return false;
        insertFiles(this, view, list);
        return true;
      },
    };
  },

  addProseMirrorPlugins() {
    const ext = this;
    return [new Plugin({
      key: new PluginKey("noteImageIntake"),
      props: {
        handlePaste(view, event) {
          const files = filesFrom(event.clipboardData);
          if (!files.length) return false;
          event.preventDefault();
          insertFiles(ext, view, files);
          return true;
        },
        handleDrop(view, event) {
          const files = filesFrom(event.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          insertFiles(ext, view, files);
          return true;
        },
      },
    })];
  },
});

export default NoteImage;
