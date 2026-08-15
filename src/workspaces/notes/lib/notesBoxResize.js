/* notesBoxResize — RESIZING A PLACED BOX FROM ANY EDGE OR CORNER (NEW-PICTURE-CANVAS / NEW-2).
 *
 * ⛔ HIS ASK, and it names the convention rather than leaving it to taste: *"resize from all four
 * corners and all four edges, Bluebeam-style; left/top handles move the anchor as well as the
 * size"*, and *"corners keep the aspect ratio, edges stretch, Shift inverts that — the convention
 * people already know from Office and Bluebeam. Never crush below a usable size; same floor rule
 * as the text boxes."*
 *
 * ⛔ WHY THIS IS A PURE MODULE AND NOT EIGHT LISTENERS. Eight handles is eight chances to get the
 * same arithmetic subtly different, and the failures are the kind nobody notices until a real
 * drawing is on the page: a box that creeps left by a pixel every time you nudge its right edge,
 * a corner that stops obeying the ratio once the floor is hit, a west drag that keeps sliding
 * after the width has bottomed out. So the decision is ONE function over numbers, exercised by
 * `test/notesBoxResize.test.js` at every handle, at the floor, at the ratio, and with Shift both
 * ways — and the node view below it does nothing but read a pointer and dispatch the answer.
 *
 * ⛔ THE ONE INVARIANT THAT IS EASY TO LOSE: **THE EDGES YOU ARE NOT HOLDING DO NOT MOVE.** That
 * is what makes a resize feel like a resize instead of a drag. It is stated once, structurally —
 * every result is derived from the FIXED edges (`right` and `bottom` stay put unless the handle
 * names them) rather than by adding deltas to `x` and `w` independently, which is how the two
 * drift apart. The floor is applied to the SIZE, and the position is then re-derived, so a west
 * drag past the floor stops dead instead of sliding the box left with a frozen width.
 *
 * Pure and engine-free on purpose: `notesAnchorNode.js` pulls the schema, and this has to be
 * unit-testable without one.
 *
 * ⛔ AND IT OWNS THE BOX'S GEOMETRY CONSTANTS — the floors, the pad and the default width — which
 * is why they moved here from `notesAnchorNode.js` rather than being imported back from it. A
 * resize has to honour the same floor a placement does, and the two modules importing each other
 * would be a cycle; the alternative, each declaring its own copy of the floor, is precisely the
 * two-sources-of-truth bug that produced B539648 in the first place (a placement rule and a
 * stylesheet floor both owning the width). `notesAnchorNode.js` re-exports all three under their
 * original names, so nothing that already imports them had to change.
 */

/** The width a block gets when there is room for it. */
export const ANCHOR_WIDTH = 180;

/** ⛔ THE NARROWEST A BLOCK MAY BE, AND IT IS A USABLE COLUMN — NOT A SLIVER (B539648, owner
 *  report 2026-08-14, and he named the instruction of his own that caused it).
 *
 *  THE REPORT: *"it's not letting me expand this box out to the right… it seems like there's a
 *  wall where when I go past it, it squeezes my text box down to where it's literally one
 *  character wide."* His screenshot shows "High Voltage Planning Study" rendered ONE LETTER PER
 *  LINE in a sliver against the right margin.
 *
 *  ⛔ THE CAUSE WAS THIS CONSTANT, AND THE REASONING ABOVE IT WAS HALF RIGHT. When the block used
 *  to JUMP LEFT away from the click, he asked for *"if it will not fit, NARROW the block to the
 *  space available — do not slide it sideways."* That was right about not sliding and **wrong
 *  about narrowing without a usable floor**: 32 px is about two characters at the note's own text
 *  size, so a press near the right margin left a few pixels of room and the box was narrowed to
 *  them. The old comment defended the small number on the grounds that "a narrow column at the far
 *  edge is a choice he is allowed to make" — but a column he cannot read or type in is not a
 *  choice, it is the failure, and he has now said so.
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

/** ⛔ THE VERTICAL FLOOR, and it is a different question from the horizontal one.
 *
 *  `ANCHOR_MIN_WIDTH` is about READABILITY — 160px is roughly twenty characters, a column
 *  somebody can write in. Height has no such argument: a picture two-thirds of an inch tall is a
 *  perfectly reasonable thing to want. The only thing a height floor has to buy is that the box
 *  stays GRABBABLE — the corner handles are 12px and the grip is 14px, so below about 48px the
 *  chrome starts colliding with itself and the thing you have made can no longer be picked up,
 *  moved or resized. That is the same failure the width floor exists to prevent, arrived at from
 *  the other direction, so the number is chosen against the chrome rather than against the text. */
export const ANCHOR_MIN_HEIGHT = 48;

/** Every handle, in the order they are painted. `""` would be the box itself and is not one. */
export const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** The ones that move the box's LEFT or TOP edge — i.e. that change `x`/`y` as well as the size. */
export const MOVES_ORIGIN = new Set(["nw", "n", "ne", "w", "sw"]);

/** A corner drives both axes at once; an edge drives one. This is the whole basis of the
 *  Shift rule below, so it is named rather than re-derived from string length at each site. */
export const isCorner = (handle) => String(handle || "").length === 2;

const num = (v, fallback = 0) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
};

/** ⛔ SHIFT INVERTS, IT DOES NOT ENABLE. A corner locks the ratio by default and a Shift-corner
 *  frees it; an edge stretches by default and a Shift-edge locks it. Written as one expression
 *  because the alternative — two branches that each decide — is how the two halves of "inverts"
 *  end up disagreeing. */
export const locksAspect = (handle, shift) => isCorner(handle) !== Boolean(shift);

/**
 * Where a box ends up when one of its handles is dragged.
 *
 * @param box     the box as the gesture STARTED — `{x, y, w, h}` in document pixels. Never the
 *                live DOM, and never re-read mid-gesture: a resize is relative to where it began,
 *                so accumulating against the current box compounds every rounding error.
 * @param handle  one of `HANDLES`.
 * @param dx/dy   how far the pointer has travelled since the press, in document pixels.
 * @param aspect  `w / h` to hold, or `null` for a box with no ratio to keep (a text box, whose
 *                height is its words). A locked drag with no aspect simply stretches.
 * @param shift   the modifier's live state — read per move, because somebody presses and releases
 *                it mid-drag and expects the box to follow.
 *
 * Returns `{x, y, w, h}`, all rounded, with `h` omitted (`null`) when the box has no height of
 * its own to set.
 */
export function resizeBox({
  box,
  handle,
  dx = 0,
  dy = 0,
  aspect = null,
  shift = false,
  minWidth = ANCHOR_MIN_WIDTH,
  minHeight = ANCHOR_MIN_HEIGHT,
  edgePad = ANCHOR_EDGE_PAD,
} = {}) {
  const h0 = String(handle || "");
  if (!HANDLES.includes(h0)) return null;

  const x0 = num(box?.x);
  const y0 = num(box?.y);
  const w0 = Math.max(minWidth, num(box?.w, minWidth));
  /* A box with no height of its own still needs one to compute against — the node view measures
   * the rendered height at pointer-down for exactly this reason. `hasHeight` is what decides
   * whether the answer carries an `h` back out. */
  const hasHeight = Number.isFinite(num(box?.h, NaN));
  const hh0 = hasHeight ? Math.max(minHeight, num(box?.h)) : 0;

  const west = h0.includes("w");
  const east = h0.includes("e");
  const north = h0.includes("n");
  const south = h0.includes("s");

  /* The edges that are NOT being held stay exactly where they were. Everything below is
   * expressed against these two numbers rather than against `x`/`y`, which is the invariant. */
  const right = x0 + w0;
  const bottom = y0 + hh0;

  // 1 ── the free result: how big the pointer is asking for, per axis it actually drives.
  let w = w0;
  if (east) w = w0 + dx;
  else if (west) w = w0 - dx;

  let hh = hh0;
  if (hasHeight) {
    if (south) hh = hh0 + dy;
    else if (north) hh = hh0 - dy;
  }

  // 2 ── the ratio, when this gesture holds one.
  const ratio = num(aspect, 0);
  if (hasHeight && ratio > 0 && locksAspect(h0, shift)) {
    if (isCorner(h0)) {
      /* ⛔ THE AXIS THAT MOVED FURTHEST DRIVES. Picking one axis unconditionally makes a corner
       * drag feel dead whenever you pull it the other way — you travel 200px vertically and the
       * box grows by whatever your incidental horizontal wobble was. Comparing the two deltas is
       * what makes it track the pointer. */
      const wantW = Math.abs(dx) >= Math.abs(dy);
      if (wantW) hh = w / ratio;
      else w = hh * ratio;
    } else if (east || west) {
      hh = w / ratio;                       // a horizontal edge with Shift: width drives
    } else {
      w = hh * ratio;                       // a vertical edge with Shift: height drives
    }
  }

  // 3 ── the floors, applied to the SIZE. Under a lock both axes clamp together, or the ratio
  //      silently breaks at exactly the moment the box gets small — which is when a broken
  //      ratio is most visible.
  const locked = hasHeight && ratio > 0 && locksAspect(h0, shift);
  if (locked) {
    if (w < minWidth) { w = minWidth; hh = w / ratio; }
    if (hh < minHeight) { hh = minHeight; w = hh * ratio; }
    if (w < minWidth) w = minWidth;         // a ratio so extreme both floors fight: width wins
  } else {
    if (w < minWidth) w = minWidth;
    if (hasHeight && hh < minHeight) hh = minHeight;
  }

  // 4 ── the position, RE-DERIVED from the fixed edges. This is what stops a west drag sliding
  //      the box after its width has bottomed out.
  let x = west ? right - w : x0;
  let y = hasHeight && north ? bottom - hh : y0;

  /* ⛔ AND THE PAGE'S OWN LEFT EDGE IS STILL A WALL, exactly as it is for placement: the one
   * thing that ever moves a left edge in this module is a click left of the page, which is not a
   * place. Past it the box stops growing rather than growing off the sheet. */
  if (x < edgePad) {
    if (west) w = Math.max(minWidth, right - edgePad);
    x = edgePad;
  }
  if (y < 0) {
    if (hasHeight && north) hh = Math.max(minHeight, bottom);
    y = 0;
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: hasHeight ? Math.round(hh) : null,
  };
}

/** The CSS cursor a handle wears. Its own map rather than eight rules in the stylesheet, because
 *  the handles are built in a loop and a lookup cannot drift out of step with the loop the way a
 *  parallel list of selectors does. */
export const HANDLE_CURSOR = {
  n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize",
  ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize",
};

/** ⛔ WHICH HANDLES A BOX IS ALLOWED TO OFFER — and this is a PRODUCT rule, not a mechanical one.
 *
 *  A text box's height is its words (B391073): there is no height to drag, so a north or south
 *  handle on one would have to either clip the text or mean something other than "resize", and
 *  which of those it should mean is an open question with the owner. A box holding a PICTURE has
 *  a real height, so that question does not arise for it and all eight are honest.
 *
 *  So the rule is read off the CONTENT, which is the whole point of generalising the box: the
 *  same node offers what it can actually honour. East and west are offered to everything —
 *  both are fully defined for text, and west is exactly the *"left handles move the anchor as
 *  well as the size"* half of his ask.
 */
export function handlesFor(node) {
  return hasFixedHeight(node) ? HANDLES : ["e", "w"];
}

/** Does this box have a height of its own to set — i.e. is its content a picture rather than
 *  words? Exported because the node view, the stylesheet hook and the resize all need the same
 *  answer and three copies of "is it an image?" is how they come to disagree.
 *
 *  ⛔ IT TAKES EITHER SHAPE ON PURPOSE — a plain JSON node (what the store, the prune and the
 *  exporter hold) or a live ProseMirror node (what the node view holds). Making the caller
 *  convert would put a `toJSON()` of the whole subtree on every re-render of every box; making
 *  it JSON-only would tempt the node view to hand-roll its own second answer, which is the
 *  disagreement this function exists to prevent. */
export function hasFixedHeight(node) {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node.content)) {                       // JSON
    return node.content.length === 1 && node.content[0]?.type === "noteImage";
  }
  if (typeof node.childCount === "number") {               // a live ProseMirror node
    return node.childCount === 1 && node.firstChild?.type?.name === "noteImage";
  }
  return false;
}

export default resizeBox;
