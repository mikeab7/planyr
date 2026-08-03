/* notesSketchNode — the `noteSketch` schema node: SKETCH MODE, inside a note page.
 *
 * ═══ WHY THIS IS A SCHEMA NODE AND NOT A CANVAS STORE BOLTED ALONGSIDE ═════════════════
 *
 * This is the load-bearing decision of the whole feature, and everything good about it
 * falls out of this one choice. A sketch is a NODE IN THE DOCUMENT MODEL, declared in
 * lib/notesExtensions.js — the one place that says what a note may contain. Therefore:
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
 * `outline` — the SINGLE SOURCE OF TRUTH for what exists and what connects to what.
 * `positions` — `nodeId → {x,y}`, and NOTHING else the canvas knows.
 * `links` — the explicit `{from,to}` arrows an outline cannot express.
 * The full rule, including the delete cascade that keeps the three consistent, is written
 * out at the top of lib/notesSketchModel.js. Read it there before changing anything here.
 *
 * NOT in the attributes: which bodies are currently open. That is a view preference, and
 * putting it in the document would sync one device's disclosure state to another and mark
 * a note as edited for opening a box.
 *
 * ═══ THE BUNDLE SPLIT ══════════════════════════════════════════════════════════════════
 *
 * Sketch mode is a big feature and most notes contain no sketch. So this file — the schema
 * declaration plus the pure drawing — is all the editor chunk pays for, and the INTERACTIVE
 * half (dragging, the outline pane, arrow mode) is fetched by a CACHED DYNAMIC IMPORT the
 * first time a sketch is actually on screen, exactly the way lib/notesCloud.js and
 * lib/notesImageDb.js are fetched. A sketch therefore PAINTS IMMEDIATELY from the pure spec
 * and becomes interactive a moment later; it is never blank while the chunk arrives.
 */
import { Node } from "@tiptap/core";
import { EMPTY_SKETCH, normalizeSketch } from "./notesSketchModel.js";
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
  try { return normalizeSketch(JSON.parse(el.getAttribute("data-note-sketch") || "null")); }
  catch (_) { return { ...EMPTY_SKETCH }; }
};

export const NoteSketch = Node.create({
  name: "noteSketch",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  isolating: true,

  addAttributes() {
    return {
      outline: { default: [] },
      positions: { default: {} },
      links: { default: [] },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-note-sketch]", getAttrs: readAttrs }];
  },

  /* PDF-PARITY, by construction: this is the same builder the node view draws with, so the
   * printed sheet cannot drift from the screen. `detail: true` is the paper mode — every
   * body prints as a list under the drawing, because a chevron cannot be clicked on paper. */
  renderHTML({ node }) {
    return sketchSpec(node.attrs, { detail: true });
  },

  addCommands() {
    return {
      /* A new sketch is EMPTY. Seeding it with example boxes would be text the user has to
       * delete before they can type their own — and the empty canvas already says what to
       * do. The outline pane takes focus, so "click, type three words, see a box" is three
       * actions and no reading. */
      insertNoteSketch: () => ({ chain }) => chain().focus().insertContent({
        type: "noteSketch",
        attrs: { ...EMPTY_SKETCH },
      }).run(),
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
            outline: m.outline,
            positions: m.positions,
            links: m.links,
          });
          editor.view.dispatch(tr);
          return true;
        },
      };

      let current = normalizeSketch(node.attrs);
      let expanded = new Set();
      let attached = null;

      function draw(model = current, opts = {}) {
        const next = specToDom(sketchSpec(model, { detail: false, expanded: opts.expanded || expanded }));
        drawSlot.replaceChildren(next);
        return next;
      }

      handle.setExpanded = (set) => { expanded = set instanceof Set ? set : new Set(set || []); };
      handle.getExpanded = () => expanded;

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
        /* Everything inside the host is ours: a textarea, a drag, a chevron. ProseMirror
         * must not treat any of it as a document event, and must not try to reconcile the
         * DOM we are drawing by hand. */
        stopEvent: () => true,
        ignoreMutation: () => true,
        update(updated) {
          if (updated.type.name !== "noteSketch") return false;
          current = normalizeSketch(updated.attrs);
          // Expansion is a view preference; a node whose line is gone cannot stay open.
          const ids = new Set(current.outline.map((n) => n.id));
          expanded = new Set([...expanded].filter((id) => ids.has(id)));
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
