/* foodType — the ONE type scale and spacing step for the /food place card, visit form and list view (NEW-1, 2026-10-27, owner on his iPhone
 * looking at a place card: "look at the text here. Like, it's all different sizes. There's no alignment. Like, we can do so much better.").
 *
 * WHY it drifted: every block picked its own number — the name 20, the subtitle 13, the address 12, "Visits" 11 bold caps, "Skip · 1 dish" 16
 * light caps (a <button> inheriting the browser's font), "+ Add a dish" 13, "Log a visit" 14 — and its own left inset (33 / 29 / 28 / 16), so the card
 * read as five dialects with no shared edge.
 *
 * THE SCALE (the only sizes text on the card may use; glyph icons — › ▾ the dot — are not text):
 *   title   20  the restaurant's name, once                         (the one hero line)
 *   body    13  meta, address, dish names, visit rows, buttons      (FONT_SIZE.emphasis)
 *   caption 12  chips, a dish's grey sub-line, notices              (FONT_SIZE.control)
 *   label   10.5 ONE caps section label for every group header — What to order · Maybe · Skip · Visits · the form's field headings
 *                                                                    (FONT_SIZE.label; bold, uppercase, tracked, secondary colour — never faded
 *                                                                    toward the background, per the app's text-hierarchy rule)
 * THE COLUMN: everything starts on COLUMN_X (16) from the card's edge; the status dot hangs in the gutter to its left and never pushes the text.
 * THE RHYTHM: a GROUP step (16) above every section label and between the header, the chips and the first group; an ITEM step (4) from a label to
 * its first row; rows carry their own height (≥ 44 tall). test/foodPlaceCardType.test.js pins these numbers; ui-audit/verify-food-place-card-type.mjs
 * measures the real card against them in WebKit and Chromium. A new text style on this card is a new entry HERE, never a literal at the call site. */
import { FONT_SIZE } from "../../../shared/ui/designTokens.js";

export const COLUMN_X = 16;
export const GROUP_STEP = 16;
export const ITEM_STEP = 4;
export const LABEL_LINE = 12; // px — the label's fixed line box, so a 44-tall toggle centres its text exactly GROUP_STEP below the previous block

export const FOOD_TYPE = Object.freeze({
  title: Object.freeze({ fontSize: 20, fontWeight: 680, letterSpacing: "-0.01em", lineHeight: 1.22 }), // design-exempt: the panel's one hero line (the restaurant name)
  body: Object.freeze({ fontSize: FONT_SIZE.emphasis }),
  caption: Object.freeze({ fontSize: FONT_SIZE.control }),
  label: Object.freeze({
    fontSize: FONT_SIZE.label, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", lineHeight: `${LABEL_LINE}px`, color: "var(--text-secondary)",
  }),
});

/** The sizes (px) text on the card may use — what the layout harness and the unit test check every text node against. */
export const FOOD_TYPE_SIZES = Object.freeze([FOOD_TYPE.title.fontSize, FOOD_TYPE.body.fontSize, FOOD_TYPE.caption.fontSize, FOOD_TYPE.label.fontSize]);
