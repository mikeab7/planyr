/* RESIZING A PLACED BOX FROM ANY EDGE OR CORNER — the pure rule (NEW-PICTURE-CANVAS / NEW-2).
 *
 * ⛔ THE PROPERTY THIS FILE EXISTS FOR, stated once and then asserted for every handle:
 * **THE EDGES YOU ARE NOT HOLDING DO NOT MOVE.** Eight handles is eight chances to get the same
 * arithmetic subtly different, and the resulting failures are the quiet kind — a box that creeps
 * left a pixel every time its right edge is nudged, a corner that stops obeying the ratio at the
 * floor, a west drag that keeps sliding once the width has bottomed out. None of those look like
 * bugs in a screenshot.
 *
 * ⛔ AND THE FLOOR CASES ARE THE POINT, not an afterthought. The owner's report that produced the
 * whole right-edge item (B539648) was a box crushed to one character wide, and his instruction for
 * this one repeats it: *"Never crush below a usable size; same floor rule as the text boxes."* So
 * every handle is driven PAST the floor here, not merely up to it.
 */
import { describe, expect, it } from "vitest";

import {
  ANCHOR_MIN_HEIGHT, HANDLES, HANDLE_CURSOR, MOVES_ORIGIN,
  handlesFor, hasFixedHeight, isCorner, locksAspect, moveAnchorPoint, resizeBox,
} from "../src/workspaces/notes/lib/notesBoxResize.js";
import { ANCHOR_MIN_WIDTH } from "../src/workspaces/notes/lib/notesAnchorNode.js";

/** A picture box: 400×200, so its ratio is exactly 2 and a broken ratio is obvious by eye. */
const PIC = { x: 300, y: 100, w: 400, h: 200 };
const AR = 2;

const edges = (b) => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h });

describe("the shape of the rule", () => {
  it("there are exactly eight handles and each has a cursor", () => {
    expect(HANDLES).toHaveLength(8);
    for (const h of HANDLES) expect(HANDLE_CURSOR[h], `${h} has no cursor`).toBeTruthy();
  });

  it("a corner is two letters, an edge is one", () => {
    expect(HANDLES.filter(isCorner).sort()).toEqual(["ne", "nw", "se", "sw"]);
  });

  it("the handles that move the origin are exactly the ones naming a left or top edge", () => {
    expect([...MOVES_ORIGIN].sort()).toEqual(["n", "ne", "nw", "sw", "w"]);
  });

  /* ⛔ SHIFT INVERTS, IT DOES NOT ENABLE — his words, and the two halves must agree. */
  it("⛔ Shift INVERTS the ratio rule rather than enabling it", () => {
    for (const h of HANDLES) {
      expect(locksAspect(h, false), `${h} unshifted`).toBe(isCorner(h));
      expect(locksAspect(h, true), `${h} shifted`).toBe(!isCorner(h));
    }
  });

  it("an unknown handle is refused rather than guessed at", () => {
    expect(resizeBox({ box: PIC, handle: "middle", dx: 10 })).toBeNull();
    expect(resizeBox({ box: PIC, handle: "", dx: 10 })).toBeNull();
  });
});

describe("⛔ the edges you are not holding do not move", () => {
  /* Driven both ways on both axes, because a sign error shows up in only one direction. */
  for (const handle of HANDLES) {
    for (const [dx, dy] of [[60, 40], [-60, -40], [60, -40], [-60, 40]]) {
      it(`${handle} by (${dx},${dy}) holds every edge it does not name`, () => {
        const out = resizeBox({ box: PIC, handle, dx, dy, aspect: null });
        const was = edges(PIC);
        const now = edges({ ...out, h: out.h ?? PIC.h });
        if (!handle.includes("w")) expect(now.left, "left moved").toBe(was.left);
        if (!handle.includes("e")) expect(now.right, "right moved").toBe(was.right);
        if (!handle.includes("n")) expect(now.top, "top moved").toBe(was.top);
        if (!handle.includes("s")) expect(now.bottom, "bottom moved").toBe(was.bottom);
      });
    }
  }
});

describe("an edge stretches, a corner keeps the ratio", () => {
  it("east stretches the width and leaves the height alone", () => {
    const out = resizeBox({ box: PIC, handle: "e", dx: 100, dy: 0, aspect: AR });
    expect(out).toMatchObject({ x: 300, y: 100, w: 500, h: 200 });
  });

  it("⛔ west moves the anchor as well as the size — his 'left handles move the anchor' clause", () => {
    const out = resizeBox({ box: PIC, handle: "w", dx: -100, dy: 0, aspect: AR });
    expect(out).toMatchObject({ x: 200, w: 500 });         // right edge still at 700
    expect(out.x + out.w).toBe(700);
  });

  it("north moves the top edge and keeps the bottom", () => {
    const out = resizeBox({ box: PIC, handle: "n", dx: 0, dy: -50, aspect: AR });
    expect(out).toMatchObject({ y: 50, h: 250 });
    expect(out.y + out.h).toBe(300);
  });

  it("south stretches downward only", () => {
    const out = resizeBox({ box: PIC, handle: "s", dx: 0, dy: 50, aspect: AR });
    expect(out).toMatchObject({ y: 100, w: 400, h: 250 });
  });

  it("⛔ a corner HOLDS the ratio — the picture is not distorted by a diagonal drag", () => {
    const out = resizeBox({ box: PIC, handle: "se", dx: 200, dy: 5, aspect: AR });
    expect(out.w).toBe(600);
    expect(out.h).toBe(300);                                // 600/2, not 205
    expect(out.w / out.h).toBeCloseTo(AR, 5);
  });

  it("…and the corner tracks whichever axis the pointer actually moved furthest", () => {
    const out = resizeBox({ box: PIC, handle: "se", dx: 5, dy: 200, aspect: AR });
    expect(out.h).toBe(400);                                // the vertical drag drove it
    expect(out.w).toBe(800);
    expect(out.w / out.h).toBeCloseTo(AR, 5);
  });

  it("⛔ Shift on a corner FREES the ratio", () => {
    const out = resizeBox({ box: PIC, handle: "se", dx: 200, dy: 5, aspect: AR, shift: true });
    expect(out).toMatchObject({ w: 600, h: 205 });
  });

  it("⛔ Shift on an edge LOCKS it", () => {
    const out = resizeBox({ box: PIC, handle: "e", dx: 200, dy: 0, aspect: AR, shift: true });
    expect(out).toMatchObject({ w: 600, h: 300 });
  });

  it("a north-west corner keeps the ratio AND keeps the bottom-right corner pinned", () => {
    const out = resizeBox({ box: PIC, handle: "nw", dx: -200, dy: -10, aspect: AR });
    expect(out.w).toBe(600);
    expect(out.h).toBe(300);
    expect(out.x + out.w).toBe(700);
    expect(out.y + out.h).toBe(300);
  });
});

describe("⛔ the floors — nothing is ever crushed below a usable size", () => {
  it("east dragged far left stops at the width floor", () => {
    const out = resizeBox({ box: PIC, handle: "e", dx: -5000, dy: 0, aspect: null });
    expect(out.w).toBe(ANCHOR_MIN_WIDTH);
    expect(out.x).toBe(300);                                 // …and the left edge never moved
  });

  /* ⛔ THE ONE THAT SLIDES IF THE POSITION IS NOT RE-DERIVED. A naive `x += dx` keeps travelling
   * after the width has bottomed out, so the box walks across the page with a frozen width. */
  it("⛔ west dragged past the floor STOPS — it does not slide with a frozen width", () => {
    const near = resizeBox({ box: PIC, handle: "w", dx: 5000, dy: 0, aspect: null });
    const far = resizeBox({ box: PIC, handle: "w", dx: 9000, dy: 0, aspect: null });
    expect(near.w).toBe(ANCHOR_MIN_WIDTH);
    expect(far).toEqual(near);                               // the same answer, not a further slide
    expect(far.x + far.w).toBe(700);                         // right edge still pinned
  });

  it("south dragged up stops at the height floor", () => {
    const out = resizeBox({ box: PIC, handle: "s", dx: 0, dy: -5000, aspect: null });
    expect(out.h).toBe(ANCHOR_MIN_HEIGHT);
    expect(out.y).toBe(100);
  });

  it("⛔ north dragged past the floor stops, keeping the bottom pinned", () => {
    const a = resizeBox({ box: PIC, handle: "n", dx: 0, dy: 5000, aspect: null });
    const b = resizeBox({ box: PIC, handle: "n", dx: 0, dy: 9000, aspect: null });
    expect(a.h).toBe(ANCHOR_MIN_HEIGHT);
    expect(b).toEqual(a);
    expect(b.y + b.h).toBe(300);
  });

  /* ⛔ A BROKEN RATIO IS MOST VISIBLE EXACTLY WHEN THE BOX IS SMALLEST, so both axes clamp
   * together under a lock. Clamping only the axis that hit its floor is the quiet version of
   * this bug: the picture squashes as you shrink it. */
  it("⛔ a locked corner clamps BOTH axes together, so the ratio survives the floor", () => {
    const out = resizeBox({ box: PIC, handle: "se", dx: -5000, dy: -5000, aspect: AR });
    expect(out.w / out.h).toBeCloseTo(AR, 5);
    expect(out.w).toBeGreaterThanOrEqual(ANCHOR_MIN_WIDTH);
    expect(out.h).toBeGreaterThanOrEqual(ANCHOR_MIN_HEIGHT);
  });

  it("…and a TALL picture's floor is driven by the width, not the height", () => {
    // 100×400 — ratio 0.25. The width floor is the binding one and the height follows it up.
    const tall = { x: 300, y: 100, w: 100, h: 400 };
    const out = resizeBox({ box: tall, handle: "se", dx: -5000, dy: -5000, aspect: 0.25 });
    expect(out.w).toBe(ANCHOR_MIN_WIDTH);
    expect(out.h).toBe(ANCHOR_MIN_WIDTH / 0.25);
  });

  it("the page's own left edge is still a wall — a box is not dragged off the sheet", () => {
    const out = resizeBox({ box: { x: 20, y: 100, w: 400, h: 200 }, handle: "w", dx: -500, aspect: null });
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBe(420);                          // the right edge still did not move
  });

  it("…and the top edge likewise", () => {
    const out = resizeBox({ box: { x: 300, y: 10, w: 400, h: 200 }, handle: "n", dx: 0, dy: -500, aspect: null });
    expect(out.y).toBe(0);
    expect(out.y + out.h).toBe(210);
  });
});

describe("a box with no height of its own", () => {
  const TEXT = { x: 300, y: 100, w: 400 };                    // no `h` — its height is its words

  it("⛔ gives back no height at all rather than inventing one", () => {
    expect(resizeBox({ box: TEXT, handle: "e", dx: 50 }).h).toBeNull();
  });

  it("still resizes horizontally, and west still moves the anchor", () => {
    expect(resizeBox({ box: TEXT, handle: "e", dx: 50 })).toMatchObject({ x: 300, w: 450 });
    expect(resizeBox({ box: TEXT, handle: "w", dx: 50 })).toMatchObject({ x: 350, w: 350 });
  });

  it("a vertical drag on it changes nothing vertical", () => {
    const out = resizeBox({ box: TEXT, handle: "s", dx: 0, dy: 100 });
    expect(out).toMatchObject({ x: 300, y: 100, w: 400, h: null });
  });
});

describe("⛔ which handles a box may OFFER — a product rule, read off its content", () => {
  const img = { type: "noteAnchor", content: [{ type: "noteImage", attrs: { imageId: "i1" } }] };
  const text = { type: "noteAnchor", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] };

  it("a picture box has a real height, so it offers all eight", () => {
    expect(handlesFor(img).sort()).toEqual([...HANDLES].sort());
  });

  /* ⛔ A TEXT BOX'S HEIGHT IS ITS WORDS (B391073), so north/south would have to mean something
   * other than "resize" — an open question with the owner. East and west are fully defined and
   * are offered; the rest wait for his answer rather than being guessed at. */
  it("⛔ a text box offers east and west ONLY — its height is its words", () => {
    expect(handlesFor(text).sort()).toEqual(["e", "w"]);
  });

  it("a box holding a picture AND words is text, not a picture", () => {
    const mixed = { type: "noteAnchor", content: [img.content[0], text.content[0]] };
    expect(hasFixedHeight(mixed)).toBe(false);
    expect(handlesFor(mixed).sort()).toEqual(["e", "w"]);
  });

  it("an empty box is text", () => {
    expect(hasFixedHeight({ type: "noteAnchor", content: [] })).toBe(false);
  });

  /* ⛔ IT MUST ANSWER FOR A LIVE PROSEMIRROR NODE TOO — that is the shape the node view holds,
   * and a second hand-rolled copy of "is it an image?" there is how the two come to disagree. */
  it("⛔ it reads a live ProseMirror node as well as JSON — one answer, not two", () => {
    const pmImage = { childCount: 1, firstChild: { type: { name: "noteImage" } } };
    const pmText = { childCount: 1, firstChild: { type: { name: "paragraph" } } };
    expect(hasFixedHeight(pmImage)).toBe(true);
    expect(hasFixedHeight(pmText)).toBe(false);
  });

  it("and it never throws on rubbish", () => {
    for (const junk of [null, undefined, 0, "", "noteAnchor", []]) expect(hasFixedHeight(junk)).toBe(false);
  });
});

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * A MOVE CHANGES WHERE A BOX IS. IT NEVER CHANGES HOW BIG IT IS.
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
describe("⛔ a move never resizes (NEW-DRAG-NARROWS)", () => {
  /* ⛔ THE REPORT: *"when I grab this, it's normally wider if I let go, but when I grab it, it
   * shortens up."* The drag ran `placeAnchor`, whose job is to narrow a block to the space
   * available — so dragging rightward shrank the room and the box reflowed under his hand, then
   * sprang back on release because only x/y are committed. It is B539648's right-edge crush
   * surviving in the one path that item did not touch. */
  it("⛔ returns a POINT and nothing else — there is no width to get wrong", () => {
    expect(Object.keys(moveAnchorPoint({ x: 500, y: 200 })).sort()).toEqual(["x", "y"]);
  });

  it("⛔ the far right of the page is not a wall — a move there is still just a move", () => {
    // The old rule turned x=740 into a 160px box; this one has no opinion about width at all.
    expect(moveAnchorPoint({ x: 740, y: 200 })).toEqual({ x: 740, y: 200 });
    expect(moveAnchorPoint({ x: 5000, y: 200 })).toEqual({ x: 5000, y: 200 });
  });

  it("keeps the left and top guards — a drag past the corner of the page is not a place", () => {
    expect(moveAnchorPoint({ x: -80, y: -80 })).toEqual({ x: 4, y: 0 });
  });

  it("rounds to whole pixels, like every other stored coordinate here", () => {
    expect(moveAnchorPoint({ x: 120.6, y: 40.4 })).toEqual({ x: 121, y: 40 });
  });

  it("never throws on rubbish, which is what a listener gets before the first move", () => {
    expect(moveAnchorPoint()).toEqual({ x: 4, y: 0 });
    expect(moveAnchorPoint({})).toEqual({ x: 4, y: 0 });
    expect(moveAnchorPoint({ x: NaN, y: "abc" })).toEqual({ x: 4, y: 0 });
  });

  /* ⛔ THE CONTRAST THAT IS THE WHOLE POINT, asserted rather than described: at the same x,
   * `placeAnchor` narrows and `moveAnchorPoint` does not. If these two ever agree about width
   * again, the defect is back. */
  it("⛔ `placeAnchor` still narrows at the margin — and a MOVE deliberately does not", async () => {
    const { placeAnchor } = await import("../src/workspaces/notes/lib/notesAnchorNode.js");
    const placed = placeAnchor({ x: 740, y: 200, width: 787, preferred: 300 });
    expect(placed.w, "placement still spends the width, which is its job").toBe(ANCHOR_MIN_WIDTH);
    expect(moveAnchorPoint({ x: 740, y: 200 })).not.toHaveProperty("w");
  });
});
