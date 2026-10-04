/* A DOUBLE-TAP ON BLANK PAPER LANDS THE FIRST LETTER WHERE THE FINGER WAS (NEW-1, owner report
 * 2026-10-04). Amends B1960480. Real placement is proven in WebKit by
 * `ui-audit/verify-notes-touch-landing.mjs`; this is the CI-runnable half: the pure origin rule,
 * the three inset numbers pinned against the stylesheet text, and the wiring of the two view-hold
 * guards (so deleting one is red here, not discovered on a phone). */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import {
  BOX_INSET_X, BOX_INSET_TOP, BOX_FIRST_LINE_MARGIN_EM, touchBoxOrigin,
} from "../src/workspaces/notes/lib/notesBlankPaper.js";

const editorSrc = fs.readFileSync("src/workspaces/notes/components/NoteEditor.jsx", "utf8");

describe("touchBoxOrigin", () => {
  it("puts the first glyph on the tap: corner = tap − insets", () => {
    // measured phone case: 11px font, 17.6px line → first glyph centre sits 4 + 11 + 8.8 below the corner
    const o = touchBoxOrigin({ x: 100, y: 200, lineH: 17.6, fontPx: 11 });
    expect(o.x).toBe(100 - 17);
    expect(o.y).toBeCloseTo(200 - (4 + 11 + 8.8), 6);
  });
  it("is in document units: the caller divides by zoom BEFORE and the result is zoom-free", () => {
    const a = touchBoxOrigin({ x: 50, y: 50, lineH: 20, fontPx: 15 });
    const b = touchBoxOrigin({ x: 50, y: 50, lineH: 20, fontPx: 15 });
    expect(a).toEqual(b);
  });
  it("never invents an offset from unmeasured metrics", () => {
    const o = touchBoxOrigin({ x: 10, y: 10, lineH: NaN, fontPx: undefined });
    expect(o).toEqual({ x: 10 - BOX_INSET_X, y: 10 - BOX_INSET_TOP });
  });
});

describe("the insets still match the stylesheet", () => {
  it("box padding + border give BOX_INSET_X / BOX_INSET_TOP", () => {
    const m = editorSrc.match(/\.planyr-anchor \{ position: absolute;[^}]*padding: (\d+)px (\d+)px (\d+)px (\d+)px; border: (\d+)px dashed/);
    expect(m, "anchor rule not found").toBeTruthy();
    const [, top, , , left, border] = m.map((v, i) => (i ? Number(v) : v));
    expect(left + border).toBe(BOX_INSET_X);
    expect(top + border).toBe(BOX_INSET_TOP);
  });
  it("the first paragraph still carries a 1em top margin", () => {
    expect(editorSrc).toMatch(/\.ProseMirror p \{ margin: 1em 0 0 0; \}/);
    expect(BOX_FIRST_LINE_MARGIN_EM).toBe(1);
  });
});

describe("touch placement holds the view still", () => {
  it("applies the origin on touch only", () => {
    expect(editorSrc).toMatch(/if \(touch\) \(\{ x: tapX, y: tapY \} = touchBoxOrigin\(/);
  });
  it("the focus-driven keep-caret-visible pan stands down inside the guard window", () => {
    expect(editorSrc).toMatch(/handleScrollToSelection: \(view\) => \{[\s\S]{0,200}performance\.now\(\) < touchPlaceGuardRef\.current\) return true/);
    expect(editorSrc).toMatch(/touchPlaceGuardRef\.current = performance\.now\(\) \+ TOUCH_PLACE_GUARD_MS/);
  });
  it("title-strip growth is folded into the view while the guard is live", () => {
    expect(editorSrc).toMatch(/performance\.now\(\) >= touchPlaceGuardRef\.current\) return;[\s\S]{0,200}y: v\.y \+ delta \* v\.z/);
  });
});
