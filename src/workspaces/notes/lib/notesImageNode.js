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
import { placeAnchor } from "./notesAnchorNode.js";

const filesFrom = (dt) => (dt && dt.files ? Array.from(dt.files) : []).filter(isImageFile);

/** ⛔ HOW WIDE A DROPPED PICTURE STARTS. Wider than a text column (a note's box default is 180,
 *  which is a column of words, not a picture) and capped so a phone photo does not arrive
 *  covering the page. A picture narrower than this keeps its own size — blowing a small logo up
 *  to 320 would be inventing detail that is not there. */
const DROPPED_IMAGE_WIDTH = 320;

/** ⛔ SEVERAL FILES DROPPED AT ONCE MUST NOT LAND IN ONE STACK. He asked for it by name — *"Same
 *  when several files are dropped at once"* — and dropping three photos on one point with no
 *  offset produces one visible picture and two invisible ones underneath it, which reads as two
 *  of the three having failed. A small diagonal step is what every canvas tool does. */
const DROP_STAGGER = 24;

/**
 * Store each file, then insert a node for it. Sequential on purpose: two 5 MB pastes
 * encoding at once is a visible stall, and the ceiling check has to see the previous
 * image's bytes already counted or a pair of pastes could straddle the limit.
 *
 * ⛔ `at` IS WHAT MAKES A PICTURE A CANVAS OBJECT (NEW-PICTURE-CANVAS). With a point, the picture
 * is wrapped in a `noteAnchor` AT THAT POINT — *"dropped where he drops it, not at the top, not
 * at the caret"*. Without one it goes inline at the selection, which is right for the toolbar
 * button and for a paste while somebody is typing. Same intake, same ceilings, same storage,
 * same purge cascade either way: the ONLY difference is whether the node is wrapped.
 */
async function insertFiles(ext, view, files, at = null) {
  let n = 0;
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

    const attrs = {
      imageId,
      alt: String(file.name || "image").slice(0, 120),
      mime: prepared.mime,
      w: prepared.w || null,
      h: prepared.h || null,
    };

    if (at) {
      /* ⛔ THE BOX'S STARTING SIZE COMES FROM THE PICTURE'S OWN PROPORTIONS, so it does not
       * arrive already distorted — the first thing a stretched-on-arrival picture teaches you is
       * that the resize does not work. The floors are applied by the placement/resize rule, not
       * guessed at here. */
      const iw = Number(prepared.w) || DROPPED_IMAGE_WIDTH;
      const ih = Number(prepared.h) || DROPPED_IMAGE_WIDTH;
      const w = Math.min(iw, DROPPED_IMAGE_WIDTH);
      const step = n * DROP_STAGGER;
      // Re-read the live commands each time: the previous insert moved everything after it.
      ext.editor.commands.addNoteAnchorAt({
        x: at.x + step,
        y: at.y + step,
        w,
        h: Math.round((w * ih) / (iw || 1)),
        content: [{ type: "noteImage", attrs }],
      });
    } else {
      // Re-read the live state each time: the previous insert moved everything after it.
      const { state } = view;
      view.dispatch(state.tr.replaceSelectionWith(state.schema.nodes.noteImage.create(attrs)).scrollIntoView());
    }
    n += 1;
  }
}

/** ⛔ WHERE A DROP LANDED, IN THE DOCUMENT'S OWN FRAME — never client coordinates and never
 *  scaled ones. The note has its own zoom, so storing what was on the screen at the time would
 *  move every picture the moment somebody zoomed. This is the same conversion `placeBlockAt` does
 *  in NoteEditor.jsx, and it is deliberately the same three lines: the scale is MEASURED
 *  (`offsetWidth` is unzoomed CSS pixels, the client rect is zoomed ones, so their ratio IS the
 *  zoom, whatever set it) rather than read from a setting that could be stale. */
function dropPoint(view, event) {
  const dom = view?.dom;
  if (!dom || typeof dom.getBoundingClientRect !== "function") return null;
  const box = dom.getBoundingClientRect();
  const scale = box.width / (dom.offsetWidth || 1) || 1;
  /* ⛔ ONLY THE POINT IS TAKEN FROM `placeAnchor`, NOT ITS WIDTH. That function narrows a block to
   * the room left before the right margin, which is the rule a TEXT box was placed by — and
   * B539648 already replaced "narrow it" with "grow the page" as the answer at the right edge. A
   * picture dropped near the margin keeps its proportions and the sheet extends; narrowing it
   * here would distort it on arrival, which is the crushed-box defect wearing a new hat. The one
   * thing kept is the LEFT-EDGE guard: a drop left of the page is not a place. */
  const { x, y } = placeAnchor({
    x: (event.clientX - box.left) / scale,
    y: (event.clientY - box.top) / scale,
    width: dom.offsetWidth,
  });
  return { x, y };
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
        /** ⛔ A PASTE GOES WHERE THE CARET IS — *"at the caret if he is typing"* — which is what
         *  `replaceSelectionWith` already does, so this path is deliberately unchanged. The one
         *  exception he named is *"at the pointer if he right-clicked or a box is selected
         *  there"*: with a BOX selected there is no caret in the flow to speak of, and the
         *  natural reading of "paste" is into the thing you have hold of — which is again what
         *  the selection already means, because selecting a box puts the ProseMirror selection on
         *  that node. So both halves of his rule are the selection's own behaviour, and adding a
         *  second pointer-tracking path would be a way for them to disagree. */
        handlePaste(view, event) {
          const files = filesFrom(event.clipboardData);
          if (!files.length) return false;
          event.preventDefault();
          insertFiles(ext, view, files);
          return true;
        },
        /** ⛔ A DROP LANDS WHERE IT WAS DROPPED (NEW-PICTURE-CANVAS). *"DRAG A FILE from his
         *  desktop onto the page and have it land where he dropped it — not at the top, not at
         *  the caret."* If the point cannot be measured the old inline behaviour is the fallback
         *  rather than a refusal: a picture in the wrong place is recoverable, a dropped file
         *  that vanishes is not. */
        handleDrop(view, event) {
          const files = filesFrom(event.dataTransfer);
          if (!files.length) return false;
          event.preventDefault();
          insertFiles(ext, view, files, dropPoint(view, event));
          return true;
        },
      },
    })];
  },
});

export default NoteImage;
