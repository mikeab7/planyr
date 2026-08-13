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
 */

/** The choices, in the order Word shows them. `null` is "whatever the note's own spacing is",
 *  which is a real answer and is what a paragraph starts with. */
export const LINE_SPACINGS = [
  { label: "Single", value: null },
  { label: "1.15", value: 1.15 },
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
export function spacingStyle({ lineHeight, spaceBefore, spaceAfter } = {}) {
  const out = [];
  const lh = num(lineHeight);
  const sb = num(spaceBefore);
  const sa = num(spaceAfter);
  if (lh) out.push(`line-height:${lh}`);
  if (sb) out.push(`margin-top:${Math.round(sb)}px`);
  if (sa) out.push(`margin-bottom:${Math.round(sa)}px`);
  return out.join(";");
}

/** Read the three back off an element, for `parseHTML` and for a round trip through the
 *  clipboard. Returns `null` for anything absent, which is the attribute's default. */
export function spacingFromElement(el) {
  const st = el?.style || {};
  return {
    lineHeight: num(st.lineHeight),
    spaceBefore: num(st.marginTop),
    spaceAfter: num(st.marginBottom),
  };
}

/** The label a control should show for the current value — "Spacing" when there is nothing to
 *  say, so the control never claims a setting the paragraph does not have. */
export function spacingLabel(lineHeight) {
  const lh = num(lineHeight);
  if (!lh) return "Spacing";
  return LINE_SPACINGS.find((s) => s.value === lh)?.label || String(lh);
}
