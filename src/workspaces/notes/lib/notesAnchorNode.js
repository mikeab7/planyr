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

/** The width a block gets when there is room for it. */
export const ANCHOR_WIDTH = 180;
/** ⛔ THE NARROWEST A BLOCK MAY BE, AND IT IS A USABLE COLUMN — NOT A SLIVER (NEW-RIGHT-EDGE,
 *  owner report 2026-08-14, and he named the instruction of his own that caused it).
 *
 *  THE REPORT: *"it's not letting me expand this box out to the right… it seems like there's a
 *  wall where when I go past it, it squeezes my text box down to where it's literally one
 *  character wide."* His screenshot shows "High Voltage Planning Study" rendered ONE LETTER PER
 *  LINE in a sliver against the right margin.
 *
 *  ⛔ THE CAUSE IS THIS CONSTANT, AND THE REASONING ABOVE IT WAS HALF RIGHT. When the block used
 *  to JUMP LEFT away from the click, he asked for *"if it will not fit, NARROW the block to the
 *  space available — do not slide it sideways."* That was right about not sliding and **wrong
 *  about narrowing without a usable floor**: 32 px is about two characters at the note's own text
 *  size, so a press near the right margin left a few pixels of room and the box was narrowed to
 *  them. The old comment here defended the small number on the grounds that "a narrow column at
 *  the far edge is a choice he is allowed to make" — but a column he cannot read or type in is
 *  not a choice, it is the failure, and he has now said so.
 *
 *  ⛔ THE FLOOR IS 160 PX and it is chosen rather than guessed: the default block is 180, and 160
 *  is about twenty characters at the note's 15 px text — a column somebody can actually write in,
 *  and close enough to the default that a box at the margin does not look like a different kind
 *  of thing. **Past this floor the block does NOT narrow further — THE PAGE GROWS TO THE RIGHT**
 *  and scrolls, exactly as it already grows downward when text runs past the bottom
 *  (`anchorExtent`). That is the symmetry that was missing: vertically the page grew, horizontally
 *  the content was crushed.
 *
 *  ⛔ AND HIS ORIGINAL ACCEPTANCE TEST STILL HOLDS, which is why this is safe: *"assert stored
 *  left equals click x minus editor left, for EVERY step. No clamping band anywhere."* The LEFT
 *  EDGE is still never moved by any of this — raising the floor spends the page's width, never
 *  the block's position. `verify-notes-anchor-zoom` is that test and it still passes. */
export const ANCHOR_MIN_WIDTH = 160;
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
      dom.style.left = `${Math.round(num(node.attrs.x))}px`;
      dom.style.top = `${Math.round(num(node.attrs.y))}px`;
      dom.style.width = `${Math.round(num(node.attrs.w, ANCHOR_WIDTH))}px`;

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

      /* ⛔ A WAY TO GET RID OF IT. The box had a grab handle and no delete, so the only exits
       * were emptying it and clicking away — which is a discard and does not work once there
       * are words in it — or backspacing through the text. */
      const del = document.createElement("button");
      del.type = "button";
      del.className = "planyr-anchor-del";
      del.setAttribute("contenteditable", "false");
      del.setAttribute("title", "Delete this box");
      del.setAttribute("aria-label", "Delete this box");
      del.setAttribute("data-testid", "note-anchor-delete");
      del.textContent = "×";
      del.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); });
      del.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        editor.commands.removeNoteAnchor(pos);
        /* ⛔ AND THE FOCUS COMES BACK TO THE DOCUMENT, WHICH IS WHAT MAKES THE DELETE UNDOABLE
         * (B421489). The button suppresses `mousedown` so the press does not move the caret — but
         * the node the caret was IN has just been removed, so focus landed on `<body>` and Ctrl+Z
         * went nowhere: the box was gone and could not be brought back. Measured — after the
         * press, `document.activeElement` was BODY, the editor did not contain it, and a Ctrl+Z
         * left the box count at zero. A destructive control that cannot be undone is worse than
         * one that is missing, and this is the control somebody reaches for by accident. */
        editor.commands.focus();
      });

      /* ⛔ AND A WAY TO CHANGE HOW WIDE IT IS. Only the width: a box's height is its words. */
      const size = document.createElement("div");
      size.className = "planyr-anchor-size";
      size.setAttribute("contenteditable", "false");
      size.setAttribute("title", "Drag to change how wide this box is");
      size.setAttribute("data-testid", "note-anchor-size");

      dom.appendChild(grip);
      dom.appendChild(del);
      dom.appendChild(size);
      dom.appendChild(content);

      /* ⛔ THE LEFT EDGE IS READ FROM THE RENDERED BOX, NOT FROM THE CLOSURE'S `node`
       * (B400177). The node view is created once and `update()` re-styles the element without
       * rebinding `node`, so `node.attrs` describes the box as it was when the view was BUILT.
       * Resize a box you have already dragged and the width was computed against its OLD left
       * edge: measured on a ten-box page, a drag asking for 90 more produced 34 LESS. The
       * element's own geometry cannot go stale, so that is what it asks. (Found by driving the
       * control with a real mouse — it had been reported as present but never exercised, which
       * is the whole distance between "the button is there" and "the button works".) */
      let sizing = null;
      size.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const host = editor.view.dom;
        const hostRect = host.getBoundingClientRect();
        const scale = hostRect.width / (host.offsetWidth || 1) || 1;
        const boxRect = dom.getBoundingClientRect();
        sizing = {
          scale,
          left: (boxRect.left - hostRect.left) / scale,
          /* ⛔ WHERE ON THE HANDLE YOU GRABBED IT, kept — the same rule the move drag follows,
           * for the same reason. Without it the box's right edge jumps to the pointer the
           * instant you press, so asking for 90 more gave 86: a small silent re-seat, which is
           * precisely what the move drag's own comment forbids. */
          grab: e.clientX - boxRect.right,
          host,
          moved: false,
        };
        size.setPointerCapture(e.pointerId);
      });
      size.addEventListener("pointermove", (e) => {
        if (!sizing) return;
        sizing.moved = true;
        const hostRect = sizing.host.getBoundingClientRect();   // fresh: the page may scroll
        const wanted = (e.clientX - sizing.grab - hostRect.left) / sizing.scale - sizing.left;
        /* ⛔ THE DRAG IS NOT CAPPED AT THE PAGE EDGE ANY MORE (NEW-RIGHT-EDGE). It used to be
         * `min(wanted, room)`, so pulling the handle rightward stopped dead at the margin —
         * *"there's a wall"*. The page grows instead: the layout effect in NoteEditor.jsx reads
         * `anchorExtentX` and widens the sheet, and the scroller takes it from there. The FLOOR
         * still applies, because a box narrower than a usable column is the defect this whole
         * change exists to remove. */
        const next = Math.round(Math.max(ANCHOR_MIN_WIDTH, wanted));
        sizing.w = next;                 // ⛔ THE GESTURE'S OWN RECORD — see `endSize`
        dom.style.width = `${next}px`;
        /* ⛔ AND THE ATTRIBUTE MOVES WITH IT, OR THE LAYOUT FIT UNDOES THE DRAG IN REAL TIME
         * (B421490 ×2). `fitAnchorBox` runs from a ResizeObserver and re-derives the rendered
         * width from `data-anchor-w` — so while this handler wrote only the STYLE, every frame of
         * the drag was immediately overwritten with the OLD stored width and the handle appeared
         * dead. Caught by `verify-notes-box-drag` the same hour the fit landed, which is the
         * argument for that harness existing. The attribute is the live truth during a gesture;
         * the stored attrs are still only written at the end. */
        dom.setAttribute("data-anchor-w", String(next));
      });
      const endSize = (e) => {
        if (!sizing) return;
        const changed = sizing.moved;
        const done = sizing;              // the gesture's record, kept past the reset below
        sizing = null;
        try { size.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        if (!changed) return;                       // a press that never moved writes nothing
        const pos = typeof getPos === "function" ? getPos() : null;
        /* ⛔ COMMIT THE GESTURE'S OWN NUMBER, NEVER THE DOM'S (B434417). This used to read
         * `parseFloat(dom.style.width)` at pointer-up, and the DOM is not the gesture's memory —
         * anything that re-renders this node view between the last move and the release rewrites
         * that style from the node's CURRENT attrs. `num(w, ANCHOR_WIDTH)` then falls back to the
         * 180px default, so the drag committed the width the box already had.
         *
         * ⛔ AND THE FAILURE IS WORSE THAN "IT DOES NOT WORK", WHICH IS WHY THE OWNER'S WORD FOR
         * IT WAS "DOG SHIT": the box goes on RENDERING at the size you dragged it to, so the
         * gesture looks like it worked, and the size evaporates on the next reload. Measured on
         * his account — rendered 300, stored 180, 180 after a reload — and reproduced here by
         * forcing one interfering update mid-drag, which is what a sync tick does on a signed-in
         * account and what NOTHING does in a signed-out sandbox. That is exactly why the harness
         * that shipped this was green: it verified the visual and the storage in a window where
         * nothing could interfere between them. */
        if (pos != null && Number.isFinite(done?.w)) editor.commands.setNoteAnchorWidth(pos, done.w);
      };
      size.addEventListener("pointerup", endSize);
      size.addEventListener("pointercancel", endSize);

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
        from = {
          grabX: e.clientX - boxRect.left,
          grabY: e.clientY - boxRect.top,
          scale: hostRect.width / (host.offsetWidth || 1) || 1,
          moved: false,
        };
        grip.setPointerCapture(e.pointerId);
      });
      grip.addEventListener("pointermove", (e) => {
        if (!from) return;
        from.moved = true;
        const host = editor.view.dom;
        const hostRect = host.getBoundingClientRect();       // read FRESH: the page may scroll
        const c = placeAnchor({
          x: (e.clientX - from.grabX - hostRect.left) / from.scale,
          y: (e.clientY - from.grabY - hostRect.top) / from.scale,
          width: host.offsetWidth,
          preferred: dom.offsetWidth,
        });
        from.at = c;                     // ⛔ the gesture's own record — same reason as the width
        dom.style.left = `${c.x}px`;
        dom.style.top = `${c.y}px`;
        dom.style.width = `${c.w}px`;
        dom.setAttribute("data-anchor-x", String(c.x));      // same reason as the width handle
        dom.setAttribute("data-anchor-y", String(c.y));
      });
      const end = (e) => {
        if (!from) return;
        const dragged = from.moved;
        const at = from.at;               // kept past the reset below
        from = null;
        try { grip.releasePointerCapture(e.pointerId); } catch (_) { /* already released */ }
        /* ⛔ A PRESS THAT NEVER MOVED WRITES NOTHING AT ALL — not a transaction, not an undo
         * frame, not a save. It used to commit the box's own coordinates back over themselves,
         * which is a no-op only for as long as nothing in that round trip is ever wrong; the
         * reported symptom is a box moving on a press with no drag, so the honest answer is for
         * the press to have no write path to move it through. */
        if (!dragged) return;
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
          dom.style.left = `${Math.round(num(next.attrs.x))}px`;
          dom.style.top = `${Math.round(num(next.attrs.y))}px`;
          dom.style.width = `${Math.round(num(next.attrs.w, ANCHOR_WIDTH))}px`;
          dom.setAttribute("data-anchor-x", String(Math.round(num(next.attrs.x))));
          dom.setAttribute("data-anchor-y", String(Math.round(num(next.attrs.y))));
          dom.setAttribute("data-anchor-w", String(Math.round(num(next.attrs.w, ANCHOR_WIDTH))));
          if (next.attrs.aid) dom.setAttribute("data-anchor-id", String(next.attrs.aid));
          markEmpty(next);
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
