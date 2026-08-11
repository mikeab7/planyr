/* notesAnchorNode — A BLOCK THAT STAYS WHERE YOU PUT IT (NEW-2, fourth round).
 *
 * ⛔ READ THE HISTORY BEFORE CHANGING ANYTHING HERE. "Double-click in blank space and type
 * there" has been attempted three times and reported four:
 *
 *   B1393    bound double-click to the mat. The caret took FOCUS but landed at the end of the
 *            TEXT. The check asserted focus, not placement, so it stayed green through two
 *            owner reports.
 *   B1393 ×2 emulated Word's Click and Type: pad with empty paragraphs down to the press, take
 *            the alignment from the horizontal position. The owner tested the shipped build:
 *            the line CRAWLED LEFT as he typed (every character re-centres a centred
 *            paragraph), the alignment was inherited by the next paragraph on Enter, the same
 *            gesture did different things depending on invisible document state, and the
 *            padding paragraphs were permanent — in the document, the Markdown and the PDF.
 *   B1393 ×3 removed all of it and made the rule "the caret goes to the nearest real text
 *            position and NOTHING else. Horizontal position is deliberately not honoured."
 *            That is a good rule for a CLICK, and it is not what was asked for.
 *   ⛔ AND THE FOURTH REPORT CAME WITH A WARNING ABOUT THE CHECK ITSELF: the previous round
 *            verified the WRONG PROPERTY — it confirmed the old hack was gone and that text
 *            landed left-aligned at the END OF THE DOCUMENT, and passed. Landing at the end of
 *            the document IS the reported bug. "The hack is gone", "the alignment is default"
 *            and "text appeared" are each insufficient and have each already produced a false
 *            pass.
 *
 * ⛔ SO THE ANSWER IS A REAL POSITIONED NODE, NOT AN EMULATION. `noteAnchor` stores the point
 * it was placed at, as two numbers on the node itself. That is what makes every one of the
 * previous failures structurally impossible:
 *
 *   • IT CANNOT CRAWL. The position is an attribute, not a consequence of the text's
 *     alignment, so typing into it cannot move it.
 *   • IT CANNOT LEAK. Alignment is not involved at all, so nothing is inherited on Enter.
 *   • IT LEAVES NOTHING BEHIND. No padding paragraphs — the node is out of flow, so the rest
 *     of the document does not know it exists.
 *   • IT PERSISTS AND SYNCS FOR FREE, because it is part of the document model, which is the
 *     thing that is stored and merged. Reload, another machine, the PDF: same place.
 *   • AND IT IS MOVABLE AFTERWARDS — drag its grip. A block you cannot reposition is a block
 *     you placed wrong once and live with.
 *
 * ⛔ THE COORDINATES ARE UNSCALED DOCUMENT PIXELS, MEASURED FROM THE TOP-LEFT OF THE EDITOR'S
 * OWN BOX — never client coordinates, and never scaled ones. The document has its own zoom
 * (NEW-3); storing what was on the screen at the time would move every anchored block the
 * moment somebody zoomed. The caller divides by the zoom before it gets here and multiplies on
 * the way back out; this file only ever sees the document's own frame.
 */
import { Node, mergeAttributes } from "@tiptap/core";

/** The width a block gets when there is room for it. */
export const ANCHOR_WIDTH = 180;
/** ⛔ THE NARROWEST A BLOCK MAY BE SQUEEZED TO — small on purpose. An earlier version of this
 *  fix used a READABLE floor (90 px) and slid the block left when the click did not leave room
 *  for one. That is the same defect in a smaller coat: his own acceptance test says "assert
 *  stored left equals click x minus editor left, for EVERY step. No clamping band anywhere."
 *  A narrow column at the far edge is a choice he is allowed to make, and he can drag it; a
 *  block that quietly went somewhere else is not. */
export const ANCHOR_MIN_WIDTH = 32;
/** How far from the editor's RIGHT edge a block keeps clear. */
export const ANCHOR_EDGE_PAD = 4;

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** ⛔ A BLOCK STARTS WHERE YOU CLICKED. IT IS NARROWED TO FIT — IT IS NEVER SLID SIDEWAYS.
 *
 *  THE BUG THIS REPLACES, measured on the owner's own window: a click at x=1010 produced a
 *  block at x=884, and so did a click at x=900. Everything right of about x=888 was clamped
 *  flush to the right margin — a silent jump of up to **126 px** — and the clamped value was
 *  WRITTEN TO STORAGE, so it survived a reload. From the far side of the screen that is
 *  indistinguishable from "it went somewhere else", which is the entire complaint.
 *
 *  The old rule kept a fixed 180 px block fully inside the box, which can only be done by
 *  moving it. The new rule keeps the thing the person actually chose — the LEFT EDGE — and
 *  spends the width instead: `w` shrinks to whatever is left before the margin, down to
 *  `ANCHOR_MIN_WIDTH`. Only past that floor, where a column would be unreadable anyway, does
 *  the left edge move — and then by the smallest amount that buys a usable column.
 *
 *  ⛔ AND THERE IS NO VERTICAL CLAMP AT ALL ANY MORE. `y` is returned untouched. A click near
 *  the bottom used to be nudged up (measured: a click at y=470 landed at 461) and a block that
 *  GREW while being typed into was pushed around by the same reasoning one layer up. The page
 *  extends to hold it instead — see `anchorExtent` and its use in NoteEditor.
 */
export function placeAnchor({ x, y, width, minWidth = ANCHOR_MIN_WIDTH, preferred = ANCHOR_WIDTH }) {
  const boxW = num(width);
  // The left edge is what was chosen, and it is kept — always. The only thing that ever moves
  // it is a click left of the page itself, which is not a place.
  const left = Math.max(ANCHOR_EDGE_PAD, num(x));
  const room = boxW - left - ANCHOR_EDGE_PAD;
  const w = Math.max(minWidth, Math.min(preferred, room));
  return { x: Math.round(left), y: Math.round(num(y)), w: Math.round(w) };
}

/** How far down the page the anchored blocks reach, so the editor can be told to be at least
 *  that tall. Pure, and deliberately takes the measured heights rather than guessing them —
 *  a block's height is its text, which only the browser knows. */
export function anchorExtent(blocks = [], { pad = 40 } = {}) {
  let bottom = 0;
  for (const b of blocks || []) {
    const y = num(b?.y);
    const h = num(b?.height, 24);
    if (y + h > bottom) bottom = y + h;
  }
  return bottom > 0 ? Math.ceil(bottom + pad) : 0;
}

export const NoteAnchor = Node.create({
  name: "noteAnchor",
  group: "block",
  // `block+`, not `paragraph+`: a note you started in the middle of the page is still a note,
  // and capping it at one paragraph is the sort of limit you discover at the worst moment.
  content: "block+",
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      x: { default: 0, parseHTML: (el) => num(el.getAttribute("data-anchor-x")), renderHTML: (a) => ({ "data-anchor-x": Math.round(num(a.x)) }) },
      y: { default: 0, parseHTML: (el) => num(el.getAttribute("data-anchor-y")), renderHTML: (a) => ({ "data-anchor-y": Math.round(num(a.y)) }) },
      w: { default: ANCHOR_WIDTH, parseHTML: (el) => num(el.getAttribute("data-anchor-w"), ANCHOR_WIDTH), renderHTML: (a) => ({ "data-anchor-w": Math.round(num(a.w, ANCHOR_WIDTH)) }) },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-anchor-x]" }];
  },

  /** ⛔ THE POSITION IS IN THE MARKUP, NOT IN A STYLESHEET. `renderHTML` is what the PRINT
   *  sheet and the HTML export serialise through, so writing `left`/`top` here is what makes
   *  paper agree with the screen (PDF-PARITY by construction — the alternative is a rule in
   *  two stylesheets that drift). */
  renderHTML({ HTMLAttributes, node }) {
    const x = Math.round(num(node?.attrs?.x));
    const y = Math.round(num(node?.attrs?.y));
    const w = Math.round(num(node?.attrs?.w, ANCHOR_WIDTH));
    return [
      "div",
      mergeAttributes({ class: "planyr-anchor", style: `left:${x}px;top:${y}px;width:${w}px` }, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      /** Put a new anchored block at a point in the document's own frame, and leave the caret
       *  inside it.
       *
       *  ⛔ IT GOES IMMEDIATELY BEFORE THE DOCUMENT'S LAST BLOCK, NOT AFTER IT — and that is
       *  the one non-obvious line in this file. Appending at the very end reads better and
       *  leaves a blank line behind every single time: an `isolating` node as the last child
       *  means there is no text position at the end of the document, so ProseMirror restores
       *  one. Two attempts to delete that paragraph afterwards both failed, because it is not
       *  litter from the insert — it is the editor keeping the document editable, and it comes
       *  straight back. Inserting one position earlier means the document still ENDS in the
       *  text block it already ended in, so nothing needs restoring and nothing is left
       *  behind. The node is out of flow, so where it sits in the document order changes
       *  nothing about what anybody sees. */
      addNoteAnchorAt: ({ x, y, w = ANCHOR_WIDTH }) => ({ chain, state }) => {
        const { doc } = state;
        const tail = doc.lastChild;
        const at = tail && tail.isTextblock ? doc.content.size - tail.nodeSize : doc.content.size;
        return chain()
          .insertContentAt(at, {
            type: "noteAnchor",
            attrs: { x: Math.round(num(x)), y: Math.round(num(y)), w: Math.round(num(w, ANCHOR_WIDTH)) },
            content: [{ type: "paragraph" }],
          })
          .focus(at + 2)
          .run();
      },

      /** ⛔ AND NOT ONE BLANK LINE LEFT BEHIND. Appending a block at the very end leaves a
       *  trailing empty paragraph after it — ProseMirror keeps a text position available at
       *  the end of the document, which is right in general and is litter here: a stray blank
       *  line in the Markdown and on the PDF. That is exactly what round 2 shipped and got
       *  removed for. Run as its own command AFTER the insert rather than chained into it,
       *  because the insert's own trailing paragraph is not in the transaction's document
       *  until the insert has been applied — chaining it looked right and silently did
       *  nothing, which is how it reached the harness.
       *
       *  ⛔ GUARDED ON THE PREVIOUS SIBLING BEING OUR OWN NODE, so a blank line somebody
       *  actually left at the end of their note is never touched. */
      trimAnchorTrailingBlank: () => ({ tr, dispatch }) => {
        const d = tr.doc;
        const last = d.lastChild;
        const prev = d.childCount >= 2 ? d.child(d.childCount - 2) : null;
        const stranded = last && last.type.name === "paragraph" && last.content.size === 0
          && prev && prev.type.name === "noteAnchor";
        if (!stranded) return false;
        if (dispatch) tr.delete(d.content.size - last.nodeSize, d.content.size);
        return true;
      },

      /** Move one — the drag's commit, and the only way an anchor's position ever changes. */
      moveNoteAnchor: (pos, { x, y }) => ({ tr, dispatch }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "noteAnchor") return false;
        if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...node.attrs, x: Math.round(num(x)), y: Math.round(num(y)) }));
        return true;
      },
    };
  },

  /** The node view exists for ONE reason: the drag grip. Position itself comes from
   *  `renderHTML`, so a build with no node view still draws every block in the right place —
   *  which is what keeps the print path honest. */
  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement("div");
      dom.className = "planyr-anchor";
      dom.setAttribute("data-anchor-x", String(Math.round(num(node.attrs.x))));
      dom.setAttribute("data-anchor-y", String(Math.round(num(node.attrs.y))));
      dom.setAttribute("data-anchor-w", String(Math.round(num(node.attrs.w, ANCHOR_WIDTH))));
      dom.setAttribute("data-testid", "note-anchor");
      dom.style.left = `${Math.round(num(node.attrs.x))}px`;
      dom.style.top = `${Math.round(num(node.attrs.y))}px`;
      dom.style.width = `${Math.round(num(node.attrs.w, ANCHOR_WIDTH))}px`;

      const grip = document.createElement("div");
      grip.className = "planyr-anchor-grip";
      grip.setAttribute("contenteditable", "false");
      grip.setAttribute("title", "Drag to move this block");
      grip.setAttribute("data-testid", "note-anchor-grip");

      const content = document.createElement("div");
      content.className = "planyr-anchor-content";

      dom.appendChild(grip);
      dom.appendChild(content);

      /* The drag. Pointer capture rather than a document-level listener, so releasing outside
       * the window still ends it — a drag that never ends is a note you cannot type in. */
      let from = null;
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const host = editor.view.dom;
        const scale = host.getBoundingClientRect().width / (host.offsetWidth || 1) || 1;
        from = { px: e.clientX, py: e.clientY, x: num(node.attrs.x), y: num(node.attrs.y), scale };
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener("pointermove", (e) => {
        if (!from) return;
        const nx = from.x + (e.clientX - from.px) / from.scale;
        const ny = from.y + (e.clientY - from.py) / from.scale;
        const host = editor.view.dom;
        const c = placeAnchor({ x: nx, y: ny, width: host.offsetWidth, preferred: dom.offsetWidth });
        dom.style.left = `${c.x}px`;
        dom.style.top = `${c.y}px`;
        dom.style.width = `${c.w}px`;
      });
      const end = (e) => {
        if (!from) return;
        from = null;
        try { grip.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        // One transaction at the END of the drag, not per pointermove: a hundred undo frames
        // for one gesture is its own bug.
        editor.commands.moveNoteAnchor(pos, { x: parseFloat(dom.style.left), y: parseFloat(dom.style.top) });
      };
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);

      return {
        dom,
        contentDOM: content,
        update(next) {
          if (next.type.name !== "noteAnchor") return false;
          dom.style.left = `${Math.round(num(next.attrs.x))}px`;
          dom.style.top = `${Math.round(num(next.attrs.y))}px`;
          dom.style.width = `${Math.round(num(next.attrs.w, ANCHOR_WIDTH))}px`;
          dom.setAttribute("data-anchor-x", String(Math.round(num(next.attrs.x))));
          dom.setAttribute("data-anchor-y", String(Math.round(num(next.attrs.y))));
          return true;
        },
        ignoreMutation: (m) => m.type === "attributes" && m.target === dom,
      };
    };
  },
});

export default NoteAnchor;
