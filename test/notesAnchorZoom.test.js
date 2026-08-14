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

import { anchorExtentX,
  anchorExtent, placeAnchor, ANCHOR_EDGE_PAD, ANCHOR_MIN_WIDTH, ANCHOR_WIDTH,
} from "../src/workspaces/notes/lib/notesAnchorNode.js";
import {
  normalizeZoom, scrollTopAfterZoom, stepZoom, zoomForKey, zoomForWheel, zoomLabel, zoomKey,
  ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS,
} from "../src/workspaces/notes/lib/notesZoom.js";

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

  it("⛔ THERE IS NO VERTICAL CLAMP AT ALL — y comes back untouched, however far down", () => {
    // His other measurement: a click at y=470 landed at 461, a silent 9 px nudge upward.
    expect(placeAnchor({ x: 10, y: 470, ...box }).y).toBe(470);
    expect(placeAnchor({ x: 10, y: 99999, ...box }).y).toBe(99999);
  });

  it("never starts left of the margin", () => {
    expect(placeAnchor({ x: -400, y: 10, ...box }).x).toBe(ANCHOR_EDGE_PAD);
  });

  it("refuses nonsense instead of writing NaN into the document", () => {
    const r = placeAnchor({ x: undefined, y: "abc", ...box });
    expect(r).toEqual({ x: ANCHOR_EDGE_PAD, y: 0, w: ANCHOR_WIDTH });
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

describe("the zoom ladder", () => {
  it("100% is on it, and is where a reset goes", () => {
    expect(ZOOM_STEPS).toContain(1);
    expect(ZOOM_DEFAULT).toBe(1);
    expect(zoomForKey(2, { key: "0", ctrlKey: true })).toBe(1);
  });

  it("steps up and down through recognisable numbers, and stops at the ends", () => {
    expect(stepZoom(1, +1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(ZOOM_MAX, +1)).toBe(ZOOM_MAX);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });

  it("snaps onto the ladder from a level that is not on it (a wheel leaves you between steps)", () => {
    expect(stepZoom(1.17, +1)).toBe(1.25);
    expect(stepZoom(1.17, -1)).toBe(1.1);
  });

  it("a stored level that is corrupt lands on 100%, never on an unreadable page", () => {
    for (const bad of [null, undefined, "", "abc", NaN, 0, -3, {}]) expect(normalizeZoom(bad)).toBe(ZOOM_DEFAULT);
    expect(normalizeZoom("1.25")).toBe(1.25);
    expect(normalizeZoom(99)).toBe(ZOOM_MAX);
    expect(normalizeZoom(0.001)).toBe(ZOOM_MIN);
  });

  it("says the level out loud in one place", () => {
    expect(zoomLabel(1)).toBe("100%");
    expect(zoomLabel(1.25)).toBe("125%");
    expect(zoomLabel("nonsense")).toBe("100%");
  });

  it("is scoped per account, like every other notes key", () => {
    expect(zoomKey("u1")).toBe("planyr:notes:zoom:v1:u1");
    expect(zoomKey(null)).toBe("planyr:notes:zoom:v1:local");
  });
});

describe("what a gesture means", () => {
  it("a wheel notch UP zooms in, DOWN zooms out, and both stay in range", () => {
    expect(zoomForWheel(1, -120)).toBeGreaterThan(1);
    expect(zoomForWheel(1, 120)).toBeLessThan(1);
    expect(zoomForWheel(ZOOM_MAX, -10000)).toBe(ZOOM_MAX);
    expect(zoomForWheel(ZOOM_MIN, 10000)).toBe(ZOOM_MIN);
  });

  it("a trackpad's many small deltas are proportional, not a fixed step", () => {
    const one = zoomForWheel(1, -40);
    const two = zoomForWheel(one, -40);
    expect(two).toBeGreaterThan(one);
    // …and one big notch moves further than one small one, which a step-based rule cannot do.
    expect(zoomForWheel(1, -240)).toBeGreaterThan(zoomForWheel(1, -40));
  });

  it("a LINE or PAGE delta is normalised rather than taken as pixels", () => {
    expect(zoomForWheel(1, -3, { deltaMode: 1 })).toBeGreaterThan(1);
    expect(zoomForWheel(1, -1, { deltaMode: 2 })).toBeGreaterThan(zoomForWheel(1, -1, { deltaMode: 0 }));
  });

  it("a wheel with no delta changes nothing", () => {
    expect(zoomForWheel(1.25, 0)).toBe(1.25);
  });

  it("⛔ ONLY WITH CTRL/CMD — a plain wheel is scrolling and must stay scrolling", () => {
    expect(zoomForKey(1, { key: "=", ctrlKey: false, metaKey: false })).toBeNull();
  });

  it("every spelling of the zoom keys means the same thing", () => {
    for (const key of ["=", "+", "Add"]) expect(zoomForKey(1, { key, ctrlKey: true })).toBe(1.1);
    for (const key of ["-", "_", "Subtract"]) expect(zoomForKey(1, { key, ctrlKey: true })).toBe(0.9);
    expect(zoomForKey(1, { key: "=", metaKey: true })).toBe(1.1);          // a Mac
  });

  it("leaves every other keystroke completely alone", () => {
    for (const key of ["a", "Enter", "Tab", "z", "1", "ArrowUp"]) {
      expect(zoomForKey(1, { key, ctrlKey: true })).toBeNull();
    }
    expect(zoomForKey(1, { key: "=", ctrlKey: true, altKey: true })).toBeNull();
  });
});

describe("VIEWPORT-STABLE — the same writing stays under the eye", () => {
  it("keeps the anchor where it was on screen when the level changes", () => {
    // Sitting 1000 unzoomed pixels down the document, at the very top of the viewport.
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 0, from: 1, to: 2 })).toBe(2000);
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 0, from: 2, to: 1 })).toBe(1000);
  });

  it("accounts for where in the viewport the anchor was sitting", () => {
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 200, from: 1, to: 2 })).toBe(1800);
  });

  it("never asks for a negative scroll position", () => {
    expect(scrollTopAfterZoom({ anchorOffset: 10, viewportOffset: 500, from: 1, to: 1.1 })).toBe(0);
  });

  it("⛔ RETURNS NULL WHEN NOTHING CHANGED — a no-op must not touch the scroller at all", () => {
    expect(scrollTopAfterZoom({ anchorOffset: 1000, viewportOffset: 0, from: 1.25, to: 1.25 })).toBeNull();
  });
});

/* ⛔ PDF-PARITY, AS A SOURCE PROPERTY — because the two stylesheets are a deliberate mirror and
 * nothing else can catch them drifting. A block is now NARROWED to fit rather than slid sideways
 * (NEW-1), which means its width is doing work it never used to: if paper and screen disagree
 * about what that width MEANS — content box or border box, and how much of it the left padding
 * takes — the same block wraps its words in two different places, and a note that reads fine on
 * screen prints with a word on its own line. */
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
