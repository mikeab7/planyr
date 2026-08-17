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

import { anchorIsEmpty } from "./notesAnchorPrune.js";
import { moveSelection } from "./notesMarquee.js";
import {
  ANCHOR_EDGE_PAD, ANCHOR_MIN_HEIGHT, ANCHOR_MIN_WIDTH, ANCHOR_WIDTH,
  HANDLES, HANDLE_CURSOR, handlesFor, hasFixedHeight, moveAnchorPoint, resizeBox,
} from "./notesBoxResize.js";

/* ⛔ THE GEOMETRY CONSTANTS LIVE IN `notesBoxResize.js` AND ARE RE-EXPORTED HERE. A resize has to
 * honour the same floor a placement does; the two modules importing each other would be a cycle,
 * and each declaring its own copy of the floor is the two-sources-of-truth bug that produced
 * B539648. Their reasoning moved with them — read it there. Nothing that already imported these
 * names from this file had to change. */
export { ANCHOR_EDGE_PAD, ANCHOR_MIN_HEIGHT, ANCHOR_MIN_WIDTH, ANCHOR_WIDTH };


const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** ⛔ THE ONE PLACE A BOX'S GEOMETRY BECOMES CSS — used by `renderHTML` (which is what the print
 *  sheet and the HTML export serialise through) AND by the node view. Two copies of this string
 *  is how the screen and the paper drift apart by a height nobody notices until a PDF comes out
 *  wrong, which is exactly what PDF-PARITY exists to stop. A non-finite height writes NOTHING,
 *  so a text box's height stays its words. */
function boxStyle({ x, y, w, h }) {
  const base = `left:${Math.round(num(x))}px;top:${Math.round(num(y))}px;width:${Math.round(num(w, ANCHOR_WIDTH))}px`;
  return Number.isFinite(num(h, NaN)) ? `${base};height:${Math.round(num(h))}px` : base;
}

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
/** ⛔ HOW FAR RIGHT THE BLOCKS REACH — the horizontal twin of `anchorExtent`, and the half that
 *  was missing (NEW-RIGHT-EDGE). Vertically the page has always grown to hold a block that runs
 *  past the bottom; horizontally there was no equivalent, so a block near the right margin was
 *  narrowed into a sliver instead. Same arithmetic, same shape, one axis over.
 *
 *  The pad is smaller than the vertical one on purpose: a reader needs breathing room BELOW the
 *  last line far more than they need it to the right of a box they placed deliberately. */
export function anchorExtentX(blocks = [], { pad = 16 } = {}) {
  let right = 0;
  for (const b of blocks || []) {
    const x = num(b?.x);
    const w = num(b?.w, ANCHOR_WIDTH);
    if (x + w > right) right = x + w;
  }
  return right > 0 ? Math.ceil(right + pad) : 0;
}

export function anchorExtent(blocks = [], { pad = 40 } = {}) {
  let bottom = 0;
  for (const b of blocks || []) {
    const y = num(b?.y);
    const h = num(b?.height, 24);
    if (y + h > bottom) bottom = y + h;
  }
  return bottom > 0 ? Math.ceil(bottom + pad) : 0;
}

/** ⛔ HOW WIDE A BOX IS ALLOWED TO *RENDER*, WHICH IS NOT THE SAME AS HOW WIDE IT IS (B421490).
 *
 * `placeAnchor` spends the WIDTH to keep the LEFT EDGE somebody chose — that is B350000's rule and
 * it is right. But it only runs at PLACEMENT. Narrow the window afterwards, or open the same note
 * on a smaller screen, and a box placed toward the right of a wide page hangs off the end of the
 * sheet — where the outline panel is, which paints later and therefore wins the hit test. Measured
 * on a narrow window: a box's delete button and its width handle both answered `note-outline`
 * instead of themselves. The box was still there, still editable, and could be neither removed nor
 * resized.
 *
 * So the same rule is applied at RENDER: the left edge is never moved, the width is spent. The
 * STORED width is deliberately untouched — it is what the person asked for, and widening the
 * window must give it straight back rather than having quietly overwritten it with a number that
 * suited one screen. Store the intent, render within the room.
 */
export function fitAnchorBox({ x, w, hostWidth, pad = ANCHOR_EDGE_PAD, minWidth = ANCHOR_MIN_WIDTH }) {
  const want = Math.max(minWidth, num(w, ANCHOR_WIDTH));
  const left = num(x);
  const host = num(hostWidth);
  if (!host) return { x: Math.round(left), w: Math.round(want) };   // unmeasured — never guess
  /* ⛔ THE LEFT EDGE IS NEVER MOVED. NOT EVEN PAST THE FLOOR (B421490 ×3).
   *
   * A first version moved it "by the smallest amount that buys a usable column", on the strength
   * of a sentence in `placeAnchor`'s header — and `verify-notes-anchor-zoom` went red within the
   * hour: a click at x=760 stored 751. That harness is the owner's OWN acceptance test for
   * B350000, the round where everything right of about the three-quarter mark was silently pushed
   * flush to the margin, and it exists precisely to stop a clamping band coming back by any door.
   * Reading `placeAnchor`'s CODE rather than its prose settles it: `left = max(EDGE_PAD, x)` — the
   * edge only ever moves away from the LEFT margin, never in from the right. The prose was wrong
   * and this fit followed it.
   *
   * So past the floor the box simply renders at its minimum and overhangs. The reachability
   * problem that overhang used to cause — its controls falling under the outline panel — is
   * solved where it belongs, by stacking, not by moving somebody's box. */
  const room = host - left - pad;
  return { x: Math.round(left), w: Math.round(Math.max(minWidth, Math.min(want, room))) };
}

/** The width alone, for callers that only need that. */
export const fitAnchorWidth = (args) => fitAnchorBox(args).w;

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
      /* ⛔ A BOX HAS AN IDENTITY, BECAUSE A SELECTION NEEDS ONE (B421494). Multi-select has to
       * survive every re-render between picking boxes and moving them — a document position
       * shifts under any edit, and x/y are what the gesture is about to CHANGE, so neither can
       * name a box. This module's own rule already said it in as many words for pages: identity
       * is the id. Boxes written before this attribute existed simply have `null`, and the
       * editor stamps one the first time it needs to refer to them, so nothing has to migrate
       * and no stored document is rewritten just for opening it. */
      aid: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-anchor-id") || null,
        renderHTML: (a) => (a.aid ? { "data-anchor-id": String(a.aid) } : {}),
      },
      x: { default: 0, parseHTML: (el) => num(el.getAttribute("data-anchor-x")), renderHTML: (a) => ({ "data-anchor-x": Math.round(num(a.x)) }) },
      y: { default: 0, parseHTML: (el) => num(el.getAttribute("data-anchor-y")), renderHTML: (a) => ({ "data-anchor-y": Math.round(num(a.y)) }) },
      w: { default: ANCHOR_WIDTH, parseHTML: (el) => num(el.getAttribute("data-anchor-w"), ANCHOR_WIDTH), renderHTML: (a) => ({ "data-anchor-w": Math.round(num(a.w, ANCHOR_WIDTH)) }) },
      /* ⛔ A HEIGHT, AND `null` IS A MEANING RATHER THAN A MISSING NUMBER (NEW-PICTURE-CANVAS).
       *
       * `null` = **the content decides** — which is a text box, whose height is its words, and
       * which is what every box written before this attribute existed is. A NUMBER = the box is
       * that tall because somebody dragged it that tall, which only a box holding a PICTURE can
       * honour (B391073: a fixed height on text can only be kept by clipping the text).
       *
       * ⛔ SO NOTHING MIGRATES AND NOTHING IS REWRITTEN. An old box parses back with `h: null`
       * and behaves exactly as it did; the attribute renders NOTHING at `null`, so a document
       * that never had a picture in it is still byte-identical through a round trip. That is the
       * same discipline `indent` follows in `notesIndentLevel.js`, and for the same reason. */
      h: {
        default: null,
        parseHTML: (el) => {
          const raw = el.getAttribute("data-anchor-h");
          const n = raw == null ? NaN : parseFloat(raw);
          return Number.isFinite(n) ? n : null;
        },
        renderHTML: (a) => (Number.isFinite(num(a.h, NaN)) ? { "data-anchor-h": Math.round(num(a.h)) } : {}),
      },
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
    /* ⛔ THE HEIGHT RIDES THE SAME STYLE STRING AS THE POSITION, so paper and the HTML export get
     * a dragged picture at the size it was dragged to — PDF-PARITY by construction, exactly as
     * the position already is. A height applied only in the node view would print at the natural
     * size and nothing would say so. */
    const h = num(node?.attrs?.h, NaN);
    const box = boxStyle({ x, y, w, h });
    return [
      "div",
      mergeAttributes({ class: "planyr-anchor", style: box, ...(hasFixedHeight(node) ? { "data-anchor-kind": "image" } : {}) }, HTMLAttributes),
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
      /** ⛔ AND IT TAKES CONTENT NOW, WHICH IS THE WHOLE OF "GENERALISE THE BOX" (NEW-PICTURE-
       *  CANVAS). The owner asked for pictures to behave like the positioned text boxes and named
       *  the reason himself: *"a parallel image object implementation would be a second copy of
       *  every bug we have spent two days finding once."* So there is still exactly ONE placed
       *  node and ONE placement command — a box holding a paragraph is what a press makes, a box
       *  holding a picture is what a drop makes, and press-to-place, the selection ring, the drag
       *  grip, resize, Delete, the right-click menu, undo, the stored round trip and the tombstone
       *  cascade are all already written and are not written twice.
       *
       *  ⛔ THE CARET ONLY FOLLOWS INTO A BOX SOMEBODY IS GOING TO TYPE IN. Dropping a picture is
       *  not the start of a sentence, and an atom has no text position to land in anyway — asking
       *  for one puts the selection somewhere arbitrary. */
      addNoteAnchorAt: ({ x, y, w = ANCHOR_WIDTH, h = null, content = null }) => ({ chain, state }) => {
        const { doc } = state;
        const tail = doc.lastChild;
        const at = tail && tail.isTextblock ? doc.content.size - tail.nodeSize : doc.content.size;
        const body = Array.isArray(content) && content.length ? content : [{ type: "paragraph" }];
        const typing = !content;
        const c = chain().insertContentAt(at, {
          type: "noteAnchor",
          attrs: {
            x: Math.round(num(x)),
            y: Math.round(num(y)),
            w: Math.round(num(w, ANCHOR_WIDTH)),
            h: Number.isFinite(num(h, NaN)) ? Math.round(num(h)) : null,
          },
          content: body,
        });
        return (typing ? c.focus(at + 2) : c).run();
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

      /** ⛔ THE PROVISIONAL BLOCK'S OWN LIFECYCLE — every empty block that is not the one the
       *  caret is in, gone.
       *
       *  This is the half you SEE; `writePage`'s prune is the half that makes it true (read
       *  `notesAnchorPrune.js`'s header for the report that produced both). An empty block
       *  draws nothing and still takes the press, so one left behind by an abandoned gesture
       *  is an invisible dead zone at exactly the spot somebody just tried to use.
       *
       *  ⛔ IT WRITES NO UNDO FRAME. Ctrl+Z after abandoning a block must undo the last thing
       *  you MEANT to do, not put an empty box back; and nothing was lost, so there is nothing
       *  to restore. */
      dropEmptyAnchors: ({ keep = null } = {}) => ({ tr, state, dispatch }) => {
        const targets = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "noteAnchor") return true;
          if (pos !== keep && anchorIsEmpty(node.toJSON())) targets.push({ pos, size: node.nodeSize });
          return false;                       // nothing inside a block is another block
        });
        if (!targets.length) return false;
        if (dispatch) {
          // Back to front, so an earlier delete cannot move a later one's position.
          for (let i = targets.length - 1; i >= 0; i -= 1) tr.delete(targets[i].pos, targets[i].pos + targets[i].size);
          tr.setMeta("addToHistory", false);
          dispatch(tr);
        }
        return true;
      },

      /** ⛔ REMOVE ONE. A box had a grab handle and no way to get rid of it — the only exits
       *  were emptying it and clicking away (which is a discard, not a delete, and does not
       *  work on a box with words in it) or backspacing through its text. One transaction, so
       *  Ctrl+Z brings it back whole. */
      removeNoteAnchor: (pos) => ({ tr, dispatch }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "noteAnchor") return false;
        if (dispatch) dispatch(tr.delete(pos, pos + node.nodeSize));
        return true;
      },

      /** ⛔ SET ONE'S WIDTH. Height is deliberately NOT settable: a box's height is its words,
       *  and a fixed height can only be honoured by clipping them or by scrolling inside a box
       *  the size of a postage stamp. The width is the real control — the text reflows, the box
       *  grows downward, and the page grows to hold it (`anchorExtent`). */
      setNoteAnchorWidth: (pos, w) => ({ tr, dispatch }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "noteAnchor") return false;
        if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...node.attrs, w: Math.round(num(w, ANCHOR_WIDTH)) }));
        return true;
      },

      /** ⛔ THE WHOLE BOX IN ONE TRANSACTION — position AND size (NEW-PICTURE-CANVAS).
       *
       *  A west or north drag changes `x`/`y` and `w`/`h` together, and committing those as two
       *  commands would put TWO frames in the undo history for one gesture: the first Ctrl+Z
       *  would leave the box half-resized, at a position it was never in. That is the same
       *  reasoning `moveNoteAnchors` gives for a group drag, one gesture smaller.
       *
       *  ⛔ `h: null` is passed THROUGH, not treated as absent — it is how a box says "my height
       *  is my content", and dropping it here would let a text box quietly keep a stale height
       *  from whatever it held before. */
      setNoteAnchorBox: (pos, { x, y, w, h } = {}) => ({ tr, dispatch }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "noteAnchor") return false;
        if (dispatch) {
          dispatch(tr.setNodeMarkup(pos, undefined, {
            ...node.attrs,
            x: Math.round(num(x, node.attrs.x)),
            y: Math.round(num(y, node.attrs.y)),
            w: Math.round(num(w, node.attrs.w)),
            h: Number.isFinite(num(h, NaN)) ? Math.round(num(h)) : null,
          }));
        }
        return true;
      },

      /** Move one — the drag's commit, and the only way an anchor's position ever changes. */
      moveNoteAnchor: (pos, { x, y }) => ({ tr, dispatch }) => {
        const node = tr.doc.nodeAt(pos);
        if (!node || node.type.name !== "noteAnchor") return false;
        if (dispatch) dispatch(tr.setNodeMarkup(pos, undefined, { ...node.attrs, x: Math.round(num(x)), y: Math.round(num(y)) }));
        return true;
      },

      /** ⛔ GIVE EVERY BOX AN IDENTITY, IN ONE TRANSACTION THAT DOES NOT COUNT AS AN EDIT.
       *  Boxes written before `aid` existed have none, and a selection cannot refer to them
       *  without one. `setMeta("addToHistory", false)` is the load-bearing part: stamping an id
       *  is bookkeeping, and if it took an undo frame then the first Ctrl+Z after opening an old
       *  note would appear to do nothing at all. */
      ensureNoteAnchorIds: () => ({ tr, dispatch, state }) => {
        const seen = new Set();
        const missing = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "noteAnchor") return;
          const id = node.attrs.aid;
          if (!id || seen.has(id)) missing.push(pos); else seen.add(id);
        });
        if (!missing.length) return false;
        if (dispatch) {
          let n = 0;
          for (const pos of missing) {
            const node = tr.doc.nodeAt(pos);
            if (!node || node.type.name !== "noteAnchor") continue;
            n += 1;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, aid: `a${Date.now().toString(36)}${n}${Math.floor(Math.random() * 1e6).toString(36)}` });
          }
          dispatch(tr.setMeta("addToHistory", false));
        }
        return true;
      },

      /** ⛔ MOVE MANY AS ONE UNDO STEP. A group drag that produced N frames would need N presses
       *  of Ctrl+Z to put back, which is not an undo — it is a chore that looks like a bug. */
      moveNoteAnchors: (moves = []) => ({ tr, dispatch, state }) => {
        const want = new Map((moves || []).map((m) => [String(m.id), m]));
        if (!want.size) return false;
        const hits = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name !== "noteAnchor") return;
          const m = want.get(String(node.attrs.aid));
          if (m) hits.push({ pos, m });
        });
        if (!hits.length) return false;
        if (dispatch) {
          /* Descending, so an earlier `setNodeMarkup` cannot shift a later position. */
          for (const { pos, m } of hits.sort((a, b) => b.pos - a.pos)) {
            const node = tr.doc.nodeAt(pos);
            if (!node || node.type.name !== "noteAnchor") continue;
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, x: Math.round(num(m.x)), y: Math.round(num(m.y)) });
          }
          dispatch(tr);
        }
        return true;
      },

      /** ⛔ DELETE MANY AS ONE UNDO STEP, for the same reason. */
      removeNoteAnchors: (ids = []) => ({ tr, dispatch, state }) => {
        const want = new Set((ids || []).map(String));
        if (!want.size) return false;
        const hits = [];
        state.doc.descendants((node, pos) => {
          if (node.type.name === "noteAnchor" && want.has(String(node.attrs.aid))) hits.push({ pos, size: node.nodeSize });
        });
        if (!hits.length) return false;
        if (dispatch) {
          for (const { pos, size } of hits.sort((a, b) => b.pos - a.pos)) tr.delete(pos, pos + size);
          dispatch(tr);
        }
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
      if (node.attrs.aid) dom.setAttribute("data-anchor-id", String(node.attrs.aid));
      /* The same builder `renderHTML` uses, so the first paint and the printed sheet cannot
       * disagree about a box's geometry (PDF-PARITY by construction). */
      dom.style.cssText = boxStyle(node.attrs);
      if (Number.isFinite(num(node.attrs.h, NaN))) {
        dom.setAttribute("data-anchor-h", String(Math.round(num(node.attrs.h))));
      }

      /* ⛔ AN EMPTY BLOCK IS NEVER INVISIBLE. One that draws nothing still occupies its box
       * and still takes the press, so it becomes a dead zone at the exact spot somebody just
       * tried to use — which is what "it works intermittently" turned out to be. It is
       * outlined and it says what to do with it (the words are in the stylesheet).
       *
       * ⛔ AND IT ASKS THE SAME QUESTION THE STORAGE SEAM ASKS. `anchorIsEmpty` decides both
       * what is drawn as empty and what is discarded unwritten; two definitions would mean a
       * block that looks provisional and is kept, or looks real and is thrown away. */
      const markEmpty = (n) => {
        if (anchorIsEmpty(n.toJSON())) dom.setAttribute("data-empty", "1");
        else dom.removeAttribute("data-empty");
      };
      markEmpty(node);

      const grip = document.createElement("div");
      grip.className = "planyr-anchor-grip";
      grip.setAttribute("contenteditable", "false");
      grip.setAttribute("title", "Drag to move this block");
      grip.setAttribute("data-testid", "note-anchor-grip");

      const content = document.createElement("div");
      content.className = "planyr-anchor-content";

      /* ⛔ THE DELETE × IS GONE (B539651, owner instruction 2026-08-14). *"the delete option
       * shouldn't just be shown, like, anytime I click on the box… I should only be able to use
       * the keystroke to delete or a right click and then delete option."*
       *
       * Selecting a box now shows the ring and the resize handles and NOTHING destructive. There
       * are still two ways to remove one, and both are deliberate acts rather than a button
       * sitting under the pointer: **Delete/Backspace** while it is selected, and **Delete this
       * box** on the right-click menu, where it is last and separated because it is the
       * destructive one. Do not re-add a visible ×.
       *
       * ⛔ WHAT MUST SURVIVE ITS REMOVAL, because it was learned the hard way (B421489): both
       * remaining routes hand FOCUS BACK TO THE DOCUMENT after removing the node, or Ctrl+Z has
       * nowhere to land and a destructive action becomes un-undoable. Both do. */

      dom.appendChild(grip);
      dom.appendChild(content);

      /* ⛔ THE LIVE NODE, TRACKED EXPLICITLY — never the closure's `node` (B400177, generalised).
       * That rule was written about `node.attrs` and the reason is broader than attributes: a node
       * view is built ONCE and `update(next)` re-styles it without rebinding `node`, so every read
       * of the closure describes the box as it was when the view was created. Now that a box's
       * CONTENT decides which handles it may offer, a stale content read would leave a box that
       * has become a picture still wearing a text box's two handles — and nothing would say so. */
      let live = node;

      /* ═══ EIGHT HANDLES, ONE GESTURE (NEW-PICTURE-CANVAS / NEW-2) ═════════════════════════════
       *
       * ⛔ HIS ASK: *"resize from all four corners and all four edges, Bluebeam-style; left/top
       * handles move the anchor as well as the size."* Every decision about WHERE the box ends up
       * lives in `notesBoxResize.js` and is unit-tested there against every handle, the floors,
       * the ratio and Shift both ways. Nothing below decides geometry — it reads a pointer,
       * asks, and paints the answer. Eight handles each doing their own arithmetic is eight
       * chances to get it subtly different, and those failures are the quiet kind.
       *
       * ⛔ WHICH handles exist is read from the CONTENT (`handlesFor`), because a text box's
       * height is its words (B391073) and a north handle on one would have to mean something
       * other than "resize" — an open question with the owner (B539650). A picture has a real
       * height, so all eight are honest on one. East and west are offered to everything.
       *
       * ⛔ AND THE EAST HANDLE KEEPS THE OLD CLASS AND TEST ID. `verify-notes-anchor-zoom`,
       * `measure-notes-right-edge` and `verify-notes-context-menu` all drive `.planyr-anchor-size`
       * / `note-anchor-size`, and east IS the width handle they were written against. Renaming it
       * would take three working guards red for no behavioural reason, and a guard that has to be
       * rewritten to stay green is a guard nobody trusts. */
      const handles = new Map();
      const makeHandle = (name) => {
        const el = document.createElement("div");
        el.className = `planyr-anchor-h planyr-anchor-h-${name}${name === "e" ? " planyr-anchor-size" : ""}`;
        el.setAttribute("contenteditable", "false");
        el.setAttribute("data-handle", name);
        el.setAttribute("data-testid", name === "e" ? "note-anchor-size" : `note-anchor-h-${name}`);
        el.setAttribute("title", name === "e" || name === "w"
          ? "Drag to change how wide this box is"
          : "Drag to resize — hold Shift to ignore the picture's proportions");
        el.style.cursor = HANDLE_CURSOR[name];
        el.addEventListener("pointerdown", (e) => beginSize(e, name));
        el.addEventListener("pointermove", moveSize);
        el.addEventListener("pointerup", endSize);
        el.addEventListener("pointercancel", endSize);
        return el;
      };

      /** Paint exactly the handles this box may offer, adding and removing only what changed —
       *  rebuilding them all on every transaction would drop a pointer capture mid-drag. */
      const syncHandles = (n) => {
        const want = new Set(handlesFor(n));
        for (const [name, el] of handles) {
          if (want.has(name)) continue;
          el.remove();
          handles.delete(name);
        }
        for (const name of HANDLES) {
          if (!want.has(name) || handles.has(name)) continue;
          const el = makeHandle(name);
          handles.set(name, el);
          dom.appendChild(el);
        }
        dom.setAttribute("data-anchor-kind", hasFixedHeight(n) ? "image" : "text");
      };

      /* ⛔ THE BOX IS MEASURED FROM THE RENDERED ELEMENT, NOT FROM ANY STORED ATTRIBUTE (B400177).
       * The node view is created once and re-styled in place, so the closure's attrs describe the
       * box as it was BUILT: a drag asking for 90 more once produced 34 LESS because the width was
       * computed against a left edge the box had since been dragged away from. Live geometry
       * cannot go stale, so that is what this asks — and it is read ONCE, at the press, because a
       * resize is relative to where the gesture began (re-reading each move compounds rounding
       * and lets the box chase its own tail). */
      let sizing = null;
      function beginSize(e, name) {
        e.preventDefault();
        e.stopPropagation();
        const host = editor.view.dom;
        const hostRect = host.getBoundingClientRect();
        const scale = hostRect.width / (host.offsetWidth || 1) || 1;
        const boxRect = dom.getBoundingClientRect();
        const fixedH = hasFixedHeight(live);
        const w0 = boxRect.width / scale;
        const h0 = boxRect.height / scale;
        sizing = {
          name,
          scale,
          host,
          startX: e.clientX,
          startY: e.clientY,
          /* The box in the document's own frame — the same frame every stored coordinate is in. */
          box: {
            x: (boxRect.left - hostRect.left) / scale,
            y: (boxRect.top - hostRect.top) / scale,
            w: w0,
            ...(fixedH ? { h: h0 } : {}),
          },
          /* ⛔ THE RATIO IS THE ONE IT CURRENTLY HAS, not the picture's intrinsic one. A picture
           * somebody has deliberately stretched must not snap back to its original proportions
           * the first time they touch a corner — that is Word's and Bluebeam's behaviour and it
           * is what "keeps the aspect ratio" means to somebody who has already changed it. */
          aspect: fixedH && h0 > 0 ? w0 / h0 : null,
          moved: false,
        };
        try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* not capturable */ }
      }

      function moveSize(e) {
        if (!sizing) return;
        sizing.moved = true;
        const next = resizeBox({
          box: sizing.box,
          handle: sizing.name,
          dx: (e.clientX - sizing.startX) / sizing.scale,
          dy: (e.clientY - sizing.startY) / sizing.scale,
          aspect: sizing.aspect,
          /* Read LIVE, per move: somebody presses and releases Shift mid-drag and expects the
           * box to follow, which a value captured at pointer-down cannot do. */
          shift: e.shiftKey,
        });
        if (!next) return;
        sizing.at = next;                // ⛔ THE GESTURE'S OWN RECORD — see `endSize`
        paint(next);
      }

      /* ⛔ THE ATTRIBUTES MOVE WITH THE STYLE, OR THE LAYOUT FIT UNDOES THE DRAG IN REAL TIME
       * (B421490 ×2). `fitAnchorBox` runs from a ResizeObserver and re-derives the rendered width
       * from `data-anchor-w` — so while a handler wrote only the STYLE, every frame of the drag
       * was immediately overwritten with the OLD stored width and the handle appeared dead. The
       * attribute is the live truth DURING a gesture; the stored attrs are still only written at
       * the end. */
      function paint({ x, y, w, h }) {
        dom.style.left = `${x}px`;
        dom.style.top = `${y}px`;
        dom.style.width = `${w}px`;
        dom.setAttribute("data-anchor-x", String(x));
        dom.setAttribute("data-anchor-y", String(y));
        dom.setAttribute("data-anchor-w", String(w));
        if (Number.isFinite(h)) {
          dom.style.height = `${h}px`;
          dom.setAttribute("data-anchor-h", String(h));
        }
      }

      function endSize(e) {
        if (!sizing) return;
        const done = sizing;              // the gesture's record, kept past the reset below
        sizing = null;
        try { e.target.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        const pos = typeof getPos === "function" ? getPos() : null;
        /* ⛔ A PRESS THAT NEVER MOVED IS A PRESS ON THE BOX, NOT A RESIZE (B539652) — and this is
         * CHROME-NEVER-EATS-A-PRESS clause 4 in its purest form. The handles only EXIST once the
         * box is selected, so press 1 of the two-stage gesture summons them and press 2, at the
         * very same point, lands on chrome that was not there when the gesture began. The result
         * was measured by the owner's own acceptance harness (§10 of `verify-notes-anchor-zoom`):
         * type into box A, then B, then A again, and the markers come back in the wrong boxes.
         *
         * ⛔ THE FIX IS AT THE RESOLVER, NOT ON THE OBJECT (clause 5): a handle is chrome
         * belonging to its box, so a press on it that did not DRAG is transparent — it forwards
         * to the box and puts the caret where it landed, which is what press 2 was always for. A
         * press that did drag is a resize and is untouched. ⛔ Eight handles is eight times the
         * surface for that defect, which is why this branch is shared by all of them rather than
         * living on the one handle that was reported. */
        if (!done.moved) {
          if (pos != null) editor.chain().focus().setTextSelection(pos + 1).run();
          return;                                   // …and it still writes nothing
        }
        /* ⛔ COMMIT THE GESTURE'S OWN NUMBER, NEVER THE DOM'S (B434417). This used to read
         * `parseFloat(dom.style.width)` at pointer-up, and the DOM is not the gesture's memory —
         * anything that re-renders this node view between the last move and the release rewrites
         * that style from the node's CURRENT attrs, so the drag committed the width the box
         * already had. ⛔ AND THE FAILURE IS WORSE THAN "IT DOES NOT WORK": the box goes on
         * RENDERING at the size you dragged it to, so the gesture looks like it worked and the
         * size evaporates on the next reload. Measured on his account — rendered 300, stored 180,
         * 180 after a reload. That is why the harness that shipped it was green: a signed-out
         * sandbox has nothing that re-renders mid-gesture. */
        if (pos != null && done.at) editor.commands.setNoteAnchorBox(pos, done.at);
      }

      syncHandles(node);

      /* The drag. Pointer capture rather than a document-level listener, so releasing outside
       * the window still ends it — a drag that never ends is a note you cannot type in. */
      let from = null;
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        /* ⛔ WHERE IN THE BOX YOU GRABBED IT, kept — so the box cannot re-seat itself under the
         * cursor when the drag starts. Every position below is then derived from the pointer's
         * offset INSIDE THE EDITOR, read fresh on each move, which makes the whole gesture
         * immune to the page scrolling underneath it: the old form measured a delta between two
         * CLIENT coordinates, and a client coordinate means something different the moment the
         * scroller moves. That is one of the two mechanisms that could produce the reported
         * jump; it is now impossible rather than merely unobserved. */
        const host = editor.view.dom;
        const hostRect = host.getBoundingClientRect();
        const boxRect = dom.getBoundingClientRect();
        /* ⛔ NOTHING HERE READS `node.attrs` — deliberately, and the two fields that used to
         * are gone rather than left unused. The closure's `node` is the node as it was when
         * this view was BUILT (see the width handle above), so a stale read of it is a bug
         * waiting for whoever edits this next. Every number below comes from the pointer and
         * from live geometry. */
        /* ⛔ IF SEVERAL BOXES ARE SELECTED, THE GRIP MOVES ALL OF THEM (NEW-MULTI-DRAG).
         *
         * HIS REPORT: *"if I select multiple things and then I grab one of them to move it, it
         * should move all of the items together."* He also guessed the cause and was right about
         * its shape: a group drag DOES exist (`beginGroupDrag` in NoteEditor.jsx) and it is wired
         * to the MAT's press handler — but the grip calls `preventDefault()` on `pointerdown`,
         * which suppresses the compatibility `mousedown` the mat listens for. So grabbing a box
         * by the one affordance built for moving it was the single path the group drag could
         * never see, and marquee-select became pointless for the thing people select for.
         *
         * ⛔ THE SELECTION IS READ FROM THE DOM, NOT PASSED IN. A node view has no access to the
         * editor's React state, and opening a channel for it would be a second copy of "what is
         * selected" that can disagree with the ring on screen. `[data-selected="1"]` IS the ring
         * — the same attribute the stylesheet uses to paint it — so the boxes that move are
         * exactly the boxes he can see are selected, by construction. */
        const selected = [...host.querySelectorAll('.planyr-anchor[data-selected="1"][data-anchor-id]')];
        const mine = String(node.attrs.aid || dom.getAttribute("data-anchor-id") || "");
        const group = selected.length > 1 && selected.some((el) => el.getAttribute("data-anchor-id") === mine)
          ? selected.map((el) => ({
            id: el.getAttribute("data-anchor-id"),
            el,
            x: Math.round(parseFloat(el.style.left) || 0),
            y: Math.round(parseFloat(el.style.top) || 0),
            w: Math.round(parseFloat(el.style.width) || ANCHOR_WIDTH),
          }))
          : null;

        from = {
          grabX: e.clientX - boxRect.left,
          grabY: e.clientY - boxRect.top,
          startX: e.clientX,
          startY: e.clientY,
          scale: hostRect.width / (host.offsetWidth || 1) || 1,
          hostWidth: host.offsetWidth,
          group,
          moved: false,
        };
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener("pointermove", (e) => {
        if (!from) return;
        from.moved = true;
        const host = editor.view.dom;
        const hostRect = host.getBoundingClientRect();       // read FRESH: the page may scroll
        /* ⛔ A MOVE NEVER TOUCHES THE WIDTH (NEW-DRAG-NARROWS) — and this line used to be
         * `placeAnchor`, whose whole job is to narrow a block to the space available. Dragging
         * rightward shrank that space, so the box REFLOWED UNDER HIS HAND, then sprang back on
         * release because the commit below writes only x/y. It is the B539648 right-edge crush
         * surviving in the one path that item did not touch. `moveAnchorPoint` has no width
         * arithmetic in it at all, so the gesture cannot resize by any route. */
        /* ⛔ A GROUP MOVES BY ONE DELTA, APPLIED TO THE WHOLE SET (NEW-MULTI-DRAG). Clamping each
         * box against the page individually DEFORMS the arrangement — the ones at the edge stop
         * while the rest keep going — which is why `moveSelection` clamps the set's bounding box
         * once and shifts every member by the same amount. It is the same pure rule the marquee's
         * own group drag already uses; reusing it is what keeps the two gestures agreeing. */
        if (from.group) {
          const moves = moveSelection(from.group, {
            dx: (e.clientX - from.startX) / from.scale,
            dy: (e.clientY - from.startY) / from.scale,
          }, { maxX: from.hostWidth });
          from.moves = moves;            // ⛔ the gesture's own record — same reason as the width
          const byId = new Map(from.group.map((g) => [String(g.id), g.el]));
          for (const m of moves) {
            const el = byId.get(String(m.id));
            if (!el) continue;
            el.style.left = `${m.x}px`;
            el.style.top = `${m.y}px`;
            el.setAttribute("data-anchor-x", String(m.x));
            el.setAttribute("data-anchor-y", String(m.y));
          }
          return;
        }
        const c = moveAnchorPoint({
          x: (e.clientX - from.grabX - hostRect.left) / from.scale,
          y: (e.clientY - from.grabY - hostRect.top) / from.scale,
        });
        from.at = c;                     // ⛔ the gesture's own record — same reason as the width
        dom.style.left = `${c.x}px`;
        dom.style.top = `${c.y}px`;
        dom.setAttribute("data-anchor-x", String(c.x));      // same reason as the width handle
        dom.setAttribute("data-anchor-y", String(c.y));
      });
      const end = (e) => {
        if (!from) return;
        const dragged = from.moved;
        const at = from.at;               // kept past the reset below
        const moves = from.moves;         // …and the group's, when this was a group drag
        from = null;
        try { grip.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        /* ⛔ A PRESS THAT NEVER MOVED WRITES NOTHING AT ALL — not a transaction, not an undo
         * frame, not a save. It used to commit the box's own coordinates back over themselves,
         * which is a no-op only for as long as nothing in that round trip is ever wrong; the
         * reported symptom is a box moving on a press with no drag, so the honest answer is for
         * the press to have no write path to move it through. */
        if (!dragged) return;
        /* ⛔ ONE TRANSACTION FOR THE WHOLE GROUP, so ONE Ctrl+Z puts it back. N frames for one
         * gesture is not an undo, it is a chore that looks like a bug — `moveNoteAnchors` exists
         * for exactly this and is what the marquee's own drag commits through. */
        if (moves) { editor.commands.moveNoteAnchors(moves); return; }
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null || !at) return;
        // One transaction at the END of the drag, not per pointermove: a hundred undo frames
        // for one gesture is its own bug.
        // ⛔ FROM THE GESTURE'S RECORD, NOT FROM `dom.style` — the width handle's exact defect
        // (B434417) applied to the other axis, and it would have been the next one reported.
        editor.commands.moveNoteAnchor(pos, { x: at.x, y: at.y });
      };
      grip.addEventListener("pointerup", end);
      grip.addEventListener("pointercancel", end);

      return {
        dom,
        contentDOM: content,
        update(next) {
          if (next.type.name !== "noteAnchor") return false;
          live = next;                    // ⛔ the closure's `node` is the node as BUILT (B400177)
          const h = num(next.attrs.h, NaN);
          dom.style.left = `${Math.round(num(next.attrs.x))}px`;
          dom.style.top = `${Math.round(num(next.attrs.y))}px`;
          dom.style.width = `${Math.round(num(next.attrs.w, ANCHOR_WIDTH))}px`;
          dom.setAttribute("data-anchor-x", String(Math.round(num(next.attrs.x))));
          dom.setAttribute("data-anchor-y", String(Math.round(num(next.attrs.y))));
          dom.setAttribute("data-anchor-w", String(Math.round(num(next.attrs.w, ANCHOR_WIDTH))));
          /* ⛔ A HEIGHT THAT HAS GONE BACK TO `null` MUST CLEAR THE STYLE, not merely stop being
           * written. Leaving the last number in place is how an undone resize keeps rendering at
           * the size it was undone from — the document says one thing and the screen another,
           * with nothing to notice the difference until a reload. */
          if (Number.isFinite(h)) {
            dom.style.height = `${Math.round(h)}px`;
            dom.setAttribute("data-anchor-h", String(Math.round(h)));
          } else {
            dom.style.removeProperty("height");
            dom.removeAttribute("data-anchor-h");
          }
          if (next.attrs.aid) dom.setAttribute("data-anchor-id", String(next.attrs.aid));
          markEmpty(next);
          syncHandles(next);
          return true;
        },
        ignoreMutation: (m) => m.type === "attributes" && m.target === dom,
      };
    };
  },
});

/** Where the block holding the caret starts, or `null` when the caret is not in one. The
 *  position, not the node, because that is what `dropEmptyAnchors` needs to spare it. */
export function anchorPosAtSelection(state) {
  const $from = state?.selection?.$from;
  if (!$from) return null;
  for (let d = $from.depth; d > 0; d -= 1) {
    if ($from.node(d).type.name === "noteAnchor") return $from.before(d);
  }
  return null;
}

export default NoteAnchor;
