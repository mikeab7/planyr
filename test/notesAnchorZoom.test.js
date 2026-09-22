/* The pure halves of "a block that stays put" (NEW-2) and "make the writing bigger" (NEW-3).
 *
 * The GEOMETRY — that a double-clicked block renders at the point pressed — is not provable
 * here and is not attempted here: it is asserted in a real browser, against real rects, by
 * ui-audit/verify-notes-anchor-zoom.mjs. That split is deliberate. The previous three rounds
 * of NEW-2 all passed checks that were true and did not answer the question; a unit test that
 * claimed to cover placement would be a fourth.
 *
 * What IS provable without a browser is every rule the browser then applies: the clamp, the
 * zoom ladder, what each gesture means, and the scroll arithmetic that keeps the same writing
 * under the eye across a step.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { anchorExtentLeft, anchorExtentTop, anchorExtentX,
  anchorExtent, placeAnchor, ANCHOR_EDGE_PAD, ANCHOR_MIN_WIDTH, ANCHOR_WIDTH,
} from "../src/workspaces/notes/lib/notesAnchorNode.js";
/* ⛔ THE ZOOM HALF OF THIS FILE MOVED TO `test/notesViewport.test.js` (NEW-1, 2026-09-21), AND
 * THE RULES IT TESTED NO LONGER EXIST. `lib/notesZoom.js` scaled the writing with CSS `zoom`
 * while the page kept the pane's width, so text RE-WRAPPED — a reading-size control. The page
 * now sits on a pannable, zoomable workspace (Bluebeam's model, which is what the owner asked
 * for), where zooming makes the PAGE bigger and line breaks never change. `scrollTopAfterZoom`
 * in particular has no successor at all: it existed to keep the same paragraph under the eye
 * across a step by adjusting a scroller, and an anchored-at-the-cursor zoom keeps the point under
 * the POINTER instead, which is a stronger guarantee and needs no scroller. See
 * `lib/notesViewport.js`'s header. This file keeps the anchor-placement half, unchanged. */

/* ⛔ THE NUMBERS IN THIS BLOCK ARE HIS, MEASURED ON HIS OWN WINDOW. The editor box was
 * x=281 w=787 (right edge 1068) and 240 tall. A click at x=1010 produced a block at x=884,
 * and so did a click at x=900 — everything right of ~888 was slid flush to the margin, up to
 * 126 px, and the slid value was written to storage. These cases are that report. */
describe("placeAnchor — a block starts where you clicked, and is NARROWED to fit", () => {
  const box = { width: 787 };

  it("leaves a click with room to spare exactly where it was, at the full width", () => {
    expect(placeAnchor({ x: 69, y: 99, ...box })).toEqual({ x: 69, y: 99, w: ANCHOR_WIDTH });
  });

  /* ⛔ AMENDED (NEW-RIGHT-EDGE, owner report 2026-08-14). The LEFT EDGE assertion is the point of
   * this case and is UNCHANGED — that is his original acceptance test and it still holds. What
   * changed is the width: it used to be spent all the way down to whatever room was left, which
   * near the margin is a few pixels, and he reported the result — a box rendering "literally one
   * character wide". The block now stops at a USABLE floor and THE PAGE GROWS instead, which is
   * what already happens vertically. So the box may now legitimately overhang the old margin. */
  it("⛔ HIS CASE: a click near the right edge KEEPS ITS LEFT EDGE and gives up width to the FLOOR", () => {
    // x=1010 client → 729 inside the editor. The old rule answered 603 (a 126 px slide).
    const r = placeAnchor({ x: 729, y: 200, ...box });
    expect(r.x).toBe(729);                                          // his left edge, kept
    expect(r.w).toBe(ANCHOR_MIN_WIDTH);                             // …and a column he can type in
    expect(r.w).toBeGreaterThan(787 - 729 - ANCHOR_EDGE_PAD);       // wider than the room: the PAGE grows
  });

  it("…and so does a click hard against the edge, at the narrowest the block goes", () => {
    const r = placeAnchor({ x: 782, y: 0, ...box });
    expect(r.x).toBe(782);                                          // his left edge, kept
    expect(r.w).toBe(ANCHOR_MIN_WIDTH);
  });

  it("⛔ AND TWO DIFFERENT CLICKS NEVER LAND IN THE SAME PLACE — the tell that gave it away", () => {
    // x=1010 and x=900 both produced 884 before. 729 and 619 inside the editor.
    expect(placeAnchor({ x: 729, y: 0, ...box }).x).not.toBe(placeAnchor({ x: 619, y: 0, ...box }).x);
  });

  it("⛔ HIS OWN ACCEPTANCE TEST: a 20px sweep across the FULL width, no clamping band anywhere", () => {
    const slid = [];
    for (let x = ANCHOR_EDGE_PAD; x <= 787; x += 20) {
      const r = placeAnchor({ x, y: 0, ...box });
      if (r.x !== x) slid.push({ clicked: x, got: r.x });
    }
    expect(slid).toEqual([]);
  });

  it("⛔ NO CLAMP DOWNWARD — y comes back untouched, however far down", () => {
    // His other measurement: a click at y=470 landed at 461, a silent 9 px nudge upward.
    expect(placeAnchor({ x: 10, y: 470, ...box }).y).toBe(470);
    expect(placeAnchor({ x: 10, y: 99999, ...box }).y).toBe(99999);
  });

  /* ⛔ NOTES-PAGE-GROWTH (2026-09-06): the floor above IS a real clamp, added defensively after
   * a production note was found with an anchor stored at y: -21 — data from before this file's
   * own moveAnchorPoint/resizeBox floors existed, or from a click geometry edge case this test
   * suite cannot reconstruct. `placeAnchor` never had the floor those two functions have always
   * had; it does now, for the same reason they do — the page's own top edge is a fixed origin
   * and nothing may be placed above it. */
  /* ⛔ SUPERSEDED BY NOTES-FREE-PLACEMENT (owner report 2026-09-08). These asserted the page's top
   * and left edges were FLOORS. The owner measured what that cost from the other side — the page
   * grew right and down and CLAMPED left and up, so a box dragged past the left margin stopped
   * dead at `left: 4px` while the page stayed its natural width. The page now grows on all four
   * edges (`anchorExtentLeft`/`anchorExtentTop`) and a negative coordinate is an ordinary
   * position, so the property is the opposite one and is asserted rather than merely dropped. */
  it("⛔ THE PAGE'S TOP EDGE IS NOT A FLOOR — a negative y is kept and the page grows to reach it", () => {
    expect(placeAnchor({ x: 10, y: -21, ...box }).y).toBe(-21);
    expect(placeAnchor({ x: 10, y: -1, ...box }).y).toBe(-1);
    expect(placeAnchor({ x: 10, y: 0, ...box }).y).toBe(0);
  });

  it("⛔ …and neither is the left margin", () => {
    expect(placeAnchor({ x: -400, y: 10, ...box }).x).toBe(-400);
  });

  it("⛔ …but a box left of the origin still gets its ordinary width, not a bonus for being out there", () => {
    /* `room` is measured from the page's own origin rather than from a negative left, so the
     * arithmetic cannot hand a box at x = -300 an extra 300px of width by accident. */
    expect(placeAnchor({ x: -300, y: 10, ...box }).w).toBe(placeAnchor({ x: 0, y: 10, ...box }).w);
  });

  it("refuses nonsense instead of writing NaN into the document", () => {
    const r = placeAnchor({ x: undefined, y: "abc", ...box });
    expect(r).toEqual({ x: 0, y: 0, w: ANCHOR_WIDTH });
  });
});

describe("anchorExtent — the page grows to hold the blocks", () => {
  it("reports how far down the lowest block reaches, plus breathing room", () => {
    expect(anchorExtent([{ y: 100, height: 24 }], { pad: 40 })).toBe(164);
    expect(anchorExtent([{ y: 100, height: 24 }, { y: 380, height: 156 }], { pad: 40 })).toBe(576);
  });

  it("⛔ IT IS THE BLOCK'S REAL HEIGHT THAT COUNTS — which is why the caller measures the DOM", () => {
    // The crawl he measured: a block at y=380 that grew to 156 px tall. Before this the page
    // did not know it was there at all, so the browser scrolled to reach the caret instead.
    expect(anchorExtent([{ y: 380, height: 24 }])).toBeLessThan(anchorExtent([{ y: 380, height: 156 }]));
  });

  it("asks for nothing when there are no blocks — an ordinary note is unaffected", () => {
    expect(anchorExtent([])).toBe(0);
    expect(anchorExtent(null)).toBe(0);
  });

  it("survives a block with no measured height rather than producing NaN", () => {
    expect(Number.isFinite(anchorExtent([{ y: 10 }]))).toBe(true);
  });
});

describe("the screen and the paper measure an anchored block the same way", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const rule = (css, sel) => {
    const at = css.indexOf(`${sel} {`);
    return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
  };
  const screen = rule(read("../src/workspaces/notes/components/NoteEditor.jsx"), ".planyr-note .ProseMirror .planyr-anchor");
  const paper = rule(read("../src/workspaces/notes/lib/notesPrint.js"), ".note-body .planyr-anchor");

  it("both exist — a missing rule would silently drop the position on one of them", () => {
    expect(screen).toContain("position: absolute");
    expect(paper).toContain("position: absolute");
  });

  it("⛔ BOTH COUNT THE BOX THE SAME WAY", () => {
    expect(screen).toContain("box-sizing: border-box");
    expect(paper).toContain("box-sizing: border-box");
  });

  it("⛔ AND BOTH SPEND THE SAME PADDING, so the words break in the same places", () => {
    const pad = (css) => (css.match(/padding:\s*([^;]+);/) || [])[1]?.trim();
    expect(pad(screen)).toBe("3px 6px 3px 16px");
    expect(pad(paper)).toBe(pad(screen));
  });

  it("⛔ AND NEITHER PUTS A WIDTH FLOOR UNDER IT — that floor defeated the whole of NEW-1", () => {
    expect(screen).not.toContain("min-width");
    expect(paper).not.toContain("min-width");
  });
});

/* ⛔ THE PAGE GROWS RIGHT INSTEAD OF CRUSHING THE BOX (NEW-RIGHT-EDGE, owner report 2026-08-14).
 *
 * HIS REPORT: *"there's a wall where when I go past it, it squeezes my text box down to where
 * it's literally one character wide."* And he named the cause as his OWN earlier instruction —
 * *"if it will not fit, NARROW the block to the space available"* — which was right about not
 * sliding the block and wrong about narrowing with no usable floor.
 *
 * `anchorExtentX` is the horizontal twin of `anchorExtent`, and its absence WAS the bug:
 * vertically the page had always grown to hold a block past the bottom; horizontally there was
 * no equivalent, so the only way to keep a block on the sheet was to squeeze it. */
describe("anchorExtentX — how far right the blocks reach", () => {
  it("is the rightmost edge plus a pad", () => {
    expect(anchorExtentX([{ x: 100, w: 180 }], { pad: 16 })).toBe(296);
  });

  it("takes the FURTHEST block, not the last one", () => {
    expect(anchorExtentX([{ x: 900, w: 200 }, { x: 10, w: 50 }], { pad: 0 })).toBe(1100);
  });

  it("is 0 when there is nothing to hold — the page keeps its natural width", () => {
    expect(anchorExtentX([])).toBe(0);
    expect(anchorExtentX(null)).toBe(0);
  });

  it("assumes the default width for a block that does not state one, rather than 0", () => {
    expect(anchorExtentX([{ x: 100 }], { pad: 0 })).toBe(100 + ANCHOR_WIDTH);
  });

  it("⛔ mirrors anchorExtent's shape — the two axes must not drift apart", () => {
    expect(anchorExtent([{ y: 100, height: 50 }], { pad: 0 })).toBe(150);
    expect(anchorExtentX([{ x: 100, w: 50 }], { pad: 0 })).toBe(150);
  });
});

/* ⛔ THE OTHER TWO EDGES (NOTES-FREE-PLACEMENT, owner report 2026-09-08). Their ABSENCE was the
 * whole of NEW-1: `anchorExtent`/`anchorExtentX` grew the page down and right, nothing asked the
 * same question of the top and left, and so those two were CLAMPED instead — a box dragged 434px
 * past the left margin landed at `left: 4px` with the page still 580 wide. */
describe("anchorExtentLeft / anchorExtentTop — how far past the origin the blocks reach", () => {
  it("answers 0 when nothing overhangs — the ordinary page costs nothing", () => {
    expect(anchorExtentLeft([{ x: 100, w: 180 }])).toBe(0);
    expect(anchorExtentTop([{ x: 100, y: 40 }])).toBe(0);
    expect(anchorExtentLeft([{ x: 0 }])).toBe(0);
    expect(anchorExtentTop([{ y: 0 }])).toBe(0);
  });

  it("⛔ RETURNS A POSITIVE DISTANCE, never a negative coordinate — one direction for every caller", () => {
    expect(anchorExtentLeft([{ x: -260 }], { pad: 16 })).toBe(276);
    expect(anchorExtentTop([{ y: -140 }], { pad: 16 })).toBe(156);
  });

  it("takes the furthest box, not the last one", () => {
    expect(anchorExtentLeft([{ x: -50 }, { x: -400 }, { x: 900 }], { pad: 0 })).toBe(400);
    expect(anchorExtentTop([{ y: -5 }, { y: -300 }, { y: 900 }], { pad: 0 })).toBe(300);
  });

  it("survives an empty or unreadable list rather than throwing", () => {
    expect(anchorExtentLeft([])).toBe(0);
    expect(anchorExtentLeft(null)).toBe(0);
    expect(anchorExtentTop([])).toBe(0);
    expect(anchorExtentTop(undefined)).toBe(0);
    expect(anchorExtentLeft([{ x: "nonsense" }])).toBe(0);
    expect(anchorExtentTop([{ y: null }])).toBe(0);
  });

  it("⛔ anchorExtentTop needs no measured height — which is why paper can answer it too", () => {
    /* `anchorExtent` (downward) takes a rendered `height` because a box's height is its words.
     * Upward, a box's top IS its stored `y`, so the print path gets the same answer as the screen
     * from the raw document — see notesPrint.js's pageAnchorExtentTopPx. */
    expect(anchorExtentTop([{ y: -100, height: 999 }], { pad: 0 })).toBe(100);
    expect(anchorExtentTop([{ y: -100 }], { pad: 0 })).toBe(100);
  });

  it("⛔ the four edges are ONE symmetry — a box 300 out reserves the same room on every side", () => {
    expect(anchorExtentLeft([{ x: -300 }], { pad: 0 })).toBe(300);
    expect(anchorExtentTop([{ y: -300 }], { pad: 0 })).toBe(300);
    expect(anchorExtentX([{ x: 300, w: 0 }], { pad: 0 })).toBe(300);
    expect(anchorExtent([{ y: 300, height: 0 }], { pad: 0 })).toBe(300);
  });
});

describe("⛔ THE FLOOR IS A USABLE COLUMN, not a sliver", () => {
  it("is wide enough to write in — measured against the note's own text size", () => {
    // 15px text: ~20 characters. A 32px floor was about two, which is what he photographed.
    expect(ANCHOR_MIN_WIDTH).toBeGreaterThanOrEqual(140);
    expect(ANCHOR_MIN_WIDTH).toBeLessThanOrEqual(ANCHOR_WIDTH);
  });

  it("⛔ a click hard against the right margin keeps its edge AND a usable width", () => {
    const r = placeAnchor({ x: 780, y: 0, width: 787, minWidth: ANCHOR_MIN_WIDTH, preferred: ANCHOR_WIDTH });
    expect(r.x).toBe(780);                       // his acceptance test, unchanged
    expect(r.w).toBe(ANCHOR_MIN_WIDTH);          // and never a sliver
  });

  it("…and the page is then asked to be wide enough to hold it", () => {
    const r = placeAnchor({ x: 780, y: 0, width: 787, minWidth: ANCHOR_MIN_WIDTH, preferred: ANCHOR_WIDTH });
    expect(anchorExtentX([r], { pad: 0 })).toBeGreaterThan(787);
  });
});
