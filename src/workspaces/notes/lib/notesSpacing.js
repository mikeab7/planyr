/* notesSpacing — HOW FAR APART THE LINES ARE.
 *
 * ⛔ IT IS A BLOCK PROPERTY, NOT A TEXT STYLE, and that is the one decision here that is not
 * obvious. Line spacing belongs to a PARAGRAPH: half a line cannot be one-and-a-half spaced
 * while the other half is single. Putting it on a text style would let a document express a
 * state no layout can honour, and the first person to select half a line would find out.
 *
 * ⛔ AND IT RIDES THE DOCUMENT, so it is saved, synced, printed and exported for free. The
 * value is written into the markup by `renderHTML`, which is what the print sheet serialises
 * through (`notesDocHtml.js` uses the editor's own `DOMSerializer`) — so paper agrees with the
 * screen BY CONSTRUCTION rather than by a second stylesheet that has to be kept in step.
 * PDF-PARITY.
 *
 * Markdown has no way to say any of this. `docToMarkdown` already reports the constructs that
 * needed an HTML fallback, and spacing is one of them — an honest export that names what it
 * could not carry, rather than a silent one.
 *
 * The pure half is here so it can be unit-tested without an editor.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⛔ "SINGLE" MEANS SINGLE (NEW-SPACING-1, owner report 2026-08-14). READ THIS BEFORE
 * CHANGING ANY NUMBER BELOW.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * HIS REPORT: *"I was hoping to just make the spacing smaller so I can save space and see more
 * information on screen. I put this on single line spacing. It gets this default single line
 * spacing. So I'm not really sure. Is this a line spacing issue?"*
 *
 * MEASURED on his note and reproduced here: **15px text in a 24.75px line box — a ratio of
 * 1.65.** Word and OneNote call roughly **1.15** single. So the loosest setting in this
 * control's own list was ALSO its default, and picking "Single" changed nothing because he was
 * already on it. **A control whose default option is the loosest one it offers reads as inert**,
 * and that is precisely what he experienced.
 *
 * ⛔ SO THE SCALE IS REBASED: the names now mean what they say, and `SINGLE` is the tightest.
 * `null` still means "inherit the note's density" — that is a real answer and it is what a
 * paragraph starts with — but the DENSITY it inherits is now single, not one-and-two-thirds.
 *
 * ⛔ EXISTING NOTES REFLOW, DELIBERATELY, AND HE WAS TOLD. Every note written before today
 * carries no explicit spacing, so it inherits the density — which means every one of them gets
 * tighter the moment this ships. That is the decision, not an accident: it is the thing he
 * asked for ("must actually tighten his notes today"), it loses no content, it is reversible
 * per-note and per-paragraph, and the alternative — stamping 1.65 onto every existing paragraph
 * to freeze them — would write a setting into thousands of blocks that nobody chose and leave
 * him unable to tighten an old note without re-selecting all of it.
 */

/** ⛔ THE DENSITY A NOTE STARTS AT, and the ONE number the whole scale is anchored to. It is
 *  used by the editor stylesheet, by the print sheet and by the Compact control, so the three
 *  cannot drift. Changing it changes what "Single" looks like everywhere at once. */
export const SINGLE = 1.15;

/** How much tighter Compact is than Comfortable. Deliberately modest: Compact is for fitting
 *  more on screen, not for making text hard to read. */
export const DENSITIES = [
  { id: "comfortable", label: "Comfortable", line: SINGLE, listGap: 2 },
  { id: "compact", label: "Compact", line: 1.02, listGap: 0 },
];
export const DEFAULT_DENSITY = "comfortable";

/** The density record for an id, falling back to the default rather than throwing — an unknown
 *  value in a stored document must render, not crash. */
export const densityFor = (id) => DENSITIES.find((d) => d.id === id) || DENSITIES[0];

/** The choices, in the order Word shows them. `null` is "whatever the note's own density is",
 *  which is a real answer and is what a paragraph starts with.
 *
 *  ⛔ `Single` IS AN EXPLICIT VALUE NOW, NOT `null`. It has to be pickable as a thing in its own
 *  right so that a paragraph inside a Compact note can be set back to normal single spacing —
 *  with `null` there was no way to say "single" as distinct from "whatever this note does". */
export const LINE_SPACINGS = [
  { label: "Default", value: null },
  { label: "Single", value: SINGLE },
  { label: "1.15", value: 1.3 },
  { label: "1.5", value: 1.5 },
  { label: "Double", value: 2 },
];

/** Space above and below a paragraph, in the same vocabulary. Kept coarse on purpose: a
 *  number box asking for points is a preference panel, not a writing tool. */
export const BLOCK_SPACES = [
  { label: "None", value: null },
  { label: "Small", value: 6 },
  { label: "Medium", value: 12 },
  { label: "Large", value: 20 },
];

const num = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The three attributes as a style string — the ONE place the shape is decided, used by the
 *  schema's `renderHTML` and therefore by the screen, the print sheet and the HTML export. */
export function spacingStyle({ lineHeight, spaceBefore, spaceAfter, fontSize } = {}) {
  const out = [];
  const lh = num(lineHeight);
  const sb = num(spaceBefore);
  const sa = num(spaceAfter);
  const fs = num(fontSize);
  if (lh) out.push(`line-height:${lh}`);
  /* ⛔ THE BLOCK'S OWN SIZE, AND IT IS WHAT MAKES A SMALLER PARAGRAPH A SHORTER ROW
   * (NEW-SPACING-2). Measured before the fix: a paragraph whose every word was set to 11px
   * rendered in a 24.75px row, exactly as tall as the 15px paragraph above it — because the
   * size lived on an INLINE span while the BLOCK stayed at 15px, and a block's line box can
   * never be shorter than its own font's strut. Bigger text grew the row (a 22px run made it
   * 36.3px); smaller text could not shrink it. Asymmetric, and invisible to anyone reading the
   * CSS, which already used a proportional multiplier and looked correct.
   *
   * Writing the size on the BLOCK when the whole block shares one makes the strut follow the
   * content, so the row scales in proportion — and a MIXED line still takes its height from the
   * tallest run, because that is ordinary inline layout and nothing here interferes with it. */
  if (fs) out.push(`font-size:${fs}px`);
  if (sb) out.push(`margin-top:${Math.round(sb)}px`);
  if (sa) out.push(`margin-bottom:${Math.round(sa)}px`);
  return out.join(";");
}

/** ⛔ THE SIZE A WHOLE BLOCK SHARES, or `null` when its runs disagree — the pure decision behind
 *  the rule above, so it can be proven without an editor.
 *
 *  Takes the block's inline children as `[{ fontSize }]` (absent meaning "the default size").
 *  Returns a number ONLY when every run agrees AND names a size; a block with any unsized run,
 *  or with two different sizes, keeps the default strut and lets inline layout decide. That is
 *  the conservative direction: it can make a row shorter than it was, never taller. */
export function blockFontSize(runs, { defaultPx = null } = {}) {
  if (!Array.isArray(runs) || !runs.length) return null;
  let seen = null;
  for (const r of runs) {
    const px = num(r && r.fontSize);
    if (!px) return null;                       // an unsized run keeps the block's own size
    if (seen == null) seen = px;
    else if (seen !== px) return null;          // two sizes on one line — tallest run wins
  }
  return seen === defaultPx ? null : seen;      // "the same as default" writes nothing
}

/** Read the three back off an element, for `parseHTML` and for a round trip through the
 *  clipboard. Returns `null` for anything absent, which is the attribute's default. */
export function spacingFromElement(el) {
  const st = el?.style || {};
  return {
    lineHeight: num(st.lineHeight),
    spaceBefore: num(st.marginTop),
    spaceAfter: num(st.marginBottom),
    fontSize: num(st.fontSize),
  };
}

/** The label a control should show for the current value — "Spacing" when there is nothing to
 *  say, so the control never claims a setting the paragraph does not have. */
export function spacingLabel(lineHeight) {
  const lh = num(lineHeight);
  if (!lh) return "Spacing";
  return LINE_SPACINGS.find((s) => s.value === lh)?.label || String(lh);
}

/** The style a NOTE carries for its density — one declaration block, used by the editor and by
 *  the print sheet from this one place so paper and screen cannot disagree (PDF-PARITY). */
export function densityStyle(id) {
  const d = densityFor(id);
  return { lineHeight: d.line, listGap: d.listGap };
}
