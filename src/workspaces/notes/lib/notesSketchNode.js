/* notesSketchNode — the `noteSketch` schema node: SKETCH MODE, inside a note page.
 *
 * ═══ WHY THIS IS A SCHEMA NODE AND NOT A CANVAS STORE BOLTED ALONGSIDE ═════════════════
 *
 * This is the load-bearing decision of the whole feature, it survived the authoring rebuild
 * untouched, and everything good about it falls out of this one choice. A sketch is a NODE
 * IN THE DOCUMENT MODEL, declared in lib/notesExtensions.js — the one place that says what a
 * note may contain. Therefore:
 *
 *   • it PERSISTS through the existing storage seam (lib/notesStore.js), because it is
 *     part of the page's document JSON and always has been;
 *   • it ROUND-TRIPS THROUGH CLOUD SYNC (B1291) with NO schema change, NO new table and NO
 *     migration — the page body is one JSON blob to the sync tier, and a sketch is inside it;
 *   • it PRINTS, because the print sheet is built from the editor's own DOMSerializer over
 *     this schema (lib/notesDocHtml.js), so `renderHTML` below IS the printed drawing;
 *   • it EXPORTS, because the Markdown exporter's coverage of the schema is asserted by the
 *     build (test/notesModule.test.js walks the real schema).
 *
 * A second store beside the document would have bought none of those and owed all four. If
 * a future change starts to want one — a sketch table, a sketch key in localStorage, a
 * second persistence path — that is the wrong branch; the answer is an attribute here.
 *
 * ═══ WHAT IS IN THE ATTRIBUTES, AND WHAT IS NOT ════════════════════════════════════════
 *
 * `boxes` — `[{ id, label, body, x, y }]`. THE CANVAS OWNS EVERYTHING: each box carries its
 *           own text AND its own position. There is no second representation.
 * `links` — the explicit `{ from, to }` arrows, drawn by dragging one box onto another.
 * `outline` / `positions` — ⛔ SUPERSEDED (B1400's outline-owns-content design). They are
 *           declared, default `null`, for ONE reason: a sketch saved under the old rule has
 *           them, and `normalizeSketch` migrates such a sketch into boxes on read so it
 *           opens looking exactly as it did. Every commit writes them back as `null`. Do not
 *           write to them, and do not remove them until no stored note can carry one.
 * The full rule, including the delete cascade, is written out at the top of
 * lib/notesSketchModel.js. Read it there before changing anything here.
 *
 * NOT in the attributes: which box or arrow is currently selected. That is view state, and
 * putting it in the document would sync one device's highlight to another and mark a note as
 * edited for clicking on it.
 *
 * ═══ THE BUNDLE SPLIT ══════════════════════════════════════════════════════════════════
 *
 * Sketch mode is a big feature and most notes contain no sketch. So this file — the schema
 * declaration plus the pure drawing — is all the editor chunk pays for, and the INTERACTIVE
 * half (double-click-to-create, in-box typing, dragging, arrow drags) is fetched by a CACHED
 * DYNAMIC IMPORT the first time a sketch is actually on screen, exactly the way
 * lib/notesCloud.js and lib/notesImageDb.js are fetched. A sketch therefore PAINTS
 * IMMEDIATELY from the pure spec and becomes interactive a moment later; it is never blank
 * while the chunk arrives.
 */
import { Node } from "@tiptap/core";
import { addBox, EMPTY_SKETCH, MARGIN, normalizeSketch } from "./notesSketchModel.js";
import { sketchSpec, specToDom } from "./notesSketchRender.js";

/* The interactive controller, fetched once per session and shared by every sketch on the
 * page. A failure to load is NOT silent (LOUD-FAILURE): the drawing stays, and the node
 * says it cannot be edited right now rather than looking editable and ignoring every press. */
let editorChunk = null;
function loadSketchEditor() {
  if (!editorChunk) {
    editorChunk = import("./notesSketchEditor.js").catch((e) => {
      editorChunk = null;                       // a later sketch may retry (an offline blip)
      throw e;
    });
  }
  return editorChunk;
}

const readAttrs = (el) => {
  try {
    const m = normalizeSketch(JSON.parse(el.getAttribute("data-note-sketch") || "null"));
    return { boxes: m.boxes, links: m.links, outline: null, positions: null };
  } catch (_) { return { ...EMPTY_SKETCH, outline: null, positions: null }; }
};

/** Selected text → a sketch holding ONE box with that text. The first line is the box's
 *  LABEL and anything after it is the BODY, because that is exactly what the box draws —
 *  not a syntax to learn, just the shape of the thing you are looking at. */
function sketchWithBox(raw) {
  const lines = String(raw == null ? "" : raw).split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const { model } = addBox(EMPTY_SKETCH, {
    x: MARGIN, y: MARGIN, label: lines[0] || "", body: lines.slice(1).join("\n"),
  });
  return { boxes: model.boxes, links: model.links, outline: null, positions: null };
}

export const NoteSketch = Node.create({
  name: "noteSketch",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      boxes: { default: [] },
      links: { default: [] },
      // ⛔ superseded, read-only, migrated by normalizeSketch — see the header.
      outline: { default: null },
      positions: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-note-sketch]", getAttrs: readAttrs }];
  },

  /* PDF-PARITY, by construction: this is the same builder the node view draws with, so the
   * printed sheet cannot drift from the screen. Paper gets no `interactive` flag, which
   * costs it nothing but the grip you would drag an arrow out of — every box, every word
   * and every arrow is identical on both surfaces. */
  renderHTML({ node }) {
    return sketchSpec(node.attrs);
  },

  addCommands() {
    return {
      /* THE ONE WAY IN, and it is the owner's second sentence: "maybe there's a button where
       * I can just put a box around it."
       *
       * WHAT BOXING DOES, decided rather than left ambiguous: it CONVERTS the text into a
       * real sketch box — it does not draw a border around the text where it sits. A border
       * in place would be a dead end: you could not drag it, and you could not draw an arrow
       * from it to another box, which is the very next thing he asked for. A box you cannot
       * connect is a decoration, and he asked for a chart.
       *
       * With nothing selected the sketch arrives holding ONE EMPTY BOX, and the node view
       * puts the caret straight in it — so the button is also "start a sketch and type". */
      boxSelection: () => ({ state, tr, dispatch }) => {
        const { selection } = state;
        const { $from, empty } = selection;
        const node = state.schema.nodes.noteSketch.create(sketchWithBox(empty
          ? $from.parent.textContent
          : state.doc.textBetween(selection.from, selection.to, "\n", " ")));
        if (!dispatch) return true;

        /* Caret in a top-level block: the block BECOMES the sketch, so boxing a paragraph
         * does not leave the emptied paragraph behind it. Anywhere else (a list item, a
         * table cell, a real selection) replaces just the selection and lets ProseMirror do
         * its own splitting. */
        if (empty && $from.depth === 1 && $from.parent.isTextblock) tr.replaceWith($from.before(1), $from.after(1), node);
        else tr.replaceSelectionWith(node);

        /* A sketch is an ATOM. If it ends up last in the document there is nowhere left to
         * put the caret, and the next thing typed would land ON the sketch and replace it —
         * so boxing your only paragraph always leaves a line to keep writing on. */
        const last = tr.doc.lastChild;
        if (last && last.type.name === "noteSketch") tr.insert(tr.doc.content.size, state.schema.nodes.paragraph.create());
        dispatch(tr);
        return true;
      },
    };
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const dom = document.createElement("div");
      dom.className = "planyr-sketch-host";
      dom.setAttribute("data-testid", "note-sketch");
      dom.contentEditable = "false";

      /* Three stable slots, created here and never replaced, so the redraw can swap the
       * drawing on every pointer move without tearing down the controller's own chrome —
       * and, critically, without destroying the element the pointer capture is on. */
      const toolsSlot = document.createElement("div");
      toolsSlot.className = "planyr-sketch-tools";
      const drawSlot = document.createElement("div");
      drawSlot.className = "planyr-sketch-draw";
      const paneSlot = document.createElement("div");
      paneSlot.className = "planyr-sketch-pane";
      dom.append(toolsSlot, drawSlot, paneSlot);

      /* The shell owns two things and delegates everything else: it DRAWS (synchronously,
       * from the pure spec) and it WRITES BACK (one transaction per committed edit). The
       * controller that arrives later drives both through this handle, which is why a drag
       * is one undo step rather than one per pointer move — the controller previews
       * locally and calls `commit` once. */
      const handle = {
        dom,
        toolsSlot,
        drawSlot,
        paneSlot,
        get attrs() { return normalizeSketch(current); },
        isEditable: () => editor.isEditable,
        draw,
        commit(next) {
          const m = normalizeSketch(next);
          current = m;
          const pos = typeof getPos === "function" ? getPos() : null;
          if (pos == null || Number.isNaN(pos)) { draw(); return false; }
          const tr = editor.view.state.tr.setNodeMarkup(pos, undefined, {
            boxes: m.boxes,
            links: m.links,
            outline: null,          // the superseded shape is cleared the first time we write
            positions: null,
          });
          editor.view.dispatch(tr);
          return true;
        },
      };

      let current = normalizeSketch(node.attrs);
      let selected = null;
      let attached = null;

      function draw(model = current, opts = {}) {
        const next = specToDom(sketchSpec(model, {
          interactive: editor.isEditable,
          selected: opts.selected === undefined ? selected : opts.selected,
        }));
        drawSlot.replaceChildren(next);
        return next;
      }

      handle.setSelected = (sel) => { selected = sel || null; };
      handle.getSelected = () => selected;

      draw();

      if (editor.isEditable) {
        loadSketchEditor()
          .then((mod) => { attached = mod.attachSketchEditor(handle); })
          .catch(() => {
            // LOUD-FAILURE: the drawing is still correct, so say precisely what is missing.
            const note = document.createElement("p");
            note.className = "planyr-sketch-offline";
            note.setAttribute("data-testid", "note-sketch-offline");
            note.textContent = "Sketch editing could not load — the drawing is intact; reload the page to edit it.";
            dom.appendChild(note);
          });
      }

      return {
        dom,
        /* Everything inside the host is ours: an in-box field, a drag, a grip. ProseMirror
         * must not treat any of it as a document event, and must not try to reconcile the
         * DOM we are drawing by hand. This is also what makes "double-click the canvas even
         * while you are writing somewhere else" work: the press never reaches the document. */
        stopEvent: () => true,
        ignoreMutation: () => true,
        update(updated) {
          if (updated.type.name !== "noteSketch") return false;
          current = normalizeSketch(updated.attrs);
          // A selection is view state; a box that is gone cannot stay selected.
          const ids = new Set(current.boxes.map((b) => b.id));
          if (selected?.kind === "box" && !ids.has(selected.id)) selected = null;
          if (selected?.kind === "edge" && !(ids.has(selected.from) && ids.has(selected.to))) selected = null;
          if (attached?.refresh) attached.refresh();
          else draw();
          return true;
        },
        destroy() { attached?.destroy?.(); },
      };
    };
  },
});

export default NoteSketch;
