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
 * paragraph starts with.
 *
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * ⛔ B1203504, 2026-09-05 — "COMFORTABLE" STOPPED BEING SINGLE. READ THIS BEFORE CHANGING
 * EITHER NUMBER BELOW; IT AMENDS THE DECISION DIRECTLY ABOVE, IT DOES NOT UNDO IT.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 *
 * HIS REPORT, three weeks later, unprompted: *"the field just feels off to me for some
 * reason, and I can't explain it… I feel like we can do a lot better."* Measured, not
 * inferred: `DEFAULT_DENSITY` is `"comfortable"`, and `comfortable.line` WAS `SINGLE` (1.15)
 * — so every note he opens, by default, rendered at the exact ratio Word/OneNote call
 * "single" (a spreadsheet-cell tightness), because NEW-SPACING-1 above made "Comfortable"
 * and "Single" the SAME number on purpose. That was correct for what he asked for THEN
 * ("save space and see more information on screen") and it is why the field now reads as a
 * form input rather than a document next to Craft, Bear, Notion, Apple Notes — all of which
 * sit prose at 1.5–1.7, never at Word's single.
 *
 * ⛔ THE OLD REQUEST IS NOT WRONG, IT WAS INCOMPLETE. He still gets a real, working, tight
 * "fit more on screen" option — it just moves under the name that already means that:
 * **Compact now carries the exact numbers Comfortable used to** (`SINGLE` / a 2px list gap),
 * so nothing he relied on stops existing, it is simply filed under its honest name. Comfortable
 * — the density every note STARTS on — becomes a genuine prose ratio, matching the reference
 * band the owner named (Craft/Bear/Notion sit 1.5–1.7): 1.6, roughly Bear's own number and the
 * middle of that band. The tightest selectable value, `SINGLE` (1.15), is UNCHANGED and still
 * exactly what it says on the per-paragraph `LINE_SPACINGS` control — nobody who explicitly
 * picked "Single" for a paragraph, or "Compact" for a whole note, sees any different number
 * than before. What changes is only what a note gets with NO explicit choice at all.
 */

/** ⛔ WORD'S TRUE "SINGLE," and it is the tightest number this module offers. Still what the
 *  per-paragraph `LINE_SPACINGS` "Single" option means, and — since B1203504 — also what the
 *  `compact` density means: Compact IS single spacing, unchanged from before that item. It is
 *  used by the editor stylesheet, the print sheet and the density control, so the three cannot
 *  drift. */
export const SINGLE = 1.15;

/** ⛔ THE PROSE RATIO COMFORTABLE STARTS AT (B1203504) — the number a brand-new note, or any
 *  paragraph left on "Default," actually reads at. Chosen from the reference band the owner
 *  named directly (Craft, Bear, Notion, iA Writer all sit 1.5–1.7 for body prose; this repo's
 *  own report measured Notion at 1.5 and Bear at ~1.6) — the middle of that band, not its floor,
 *  because "a lot better" was the ask, not "technically inside the range." */
export const COMFORTABLE_LINE = 1.6;

/** How much tighter Compact is than Comfortable. Compact is for fitting more on screen, not for
 *  making text hard to read — which is why, since B1203504, it is exactly Word's single spacing
 *  rather than a third, tighter number nobody asked for. */
export const DENSITIES = [
  { id: "comfortable", label: "Comfortable", line: COMFORTABLE_LINE, listGap: 6 },
  { id: "compact", label: "Compact", line: SINGLE, listGap: 2 },
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

/* ⛔ A FONT SIZE CARRIES A UNIT, AND STRIPPING IT IS NOT READING IT (NEW-4).
 *
 * `num` is a bare `parseFloat`, which is right for a line height (unitless) and for a margin
 * (this module only ever writes px). It is WRONG for a font size, because a pasted document
 * does not use px — Word and Outlook emit POINTS. `num("11pt")` returns 11, the same answer it
 * returns for `"11px"`, and the two are not the same size: 11pt is 14.67px, a third bigger.
 *
 * MEASURED, on the fixture rebuilt from his own Silvestri > Utility note — this is his NEW-4
 * report reproduced end to end, and it is worse than a cosmetic mislabel:
 *   • "Contacts:" (declared 11pt) computes 14.67px on screen, and the size box reads **11**.
 *   • "713-416-5353" (declared 11px) computes 11px on screen, and the size box reads **11**.
 *   • Selecting the 11pt run and picking the "11" the box was ALREADY SHOWING took it from
 *     14.67px to 11px — the control silently shrank his text by a quarter to "set" it to the
 *     value it claimed it already had.
 * Two visibly different sizes presented as one number, and the obvious no-op gesture was a
 * destructive one.
 *
 * So every font size is resolved to ONE unit — px, the unit this app writes and the unit the
 * size menu's own values are in — at the two boundaries where a foreign unit can enter: the
 * `parseHTML` that reads a pasted element, and the toolbar's read of what to display.
 *
 * ⛔ ONLY ABSOLUTE UNITS ARE CONVERTED. `em` / `rem` / `%` / `larger` are RELATIVE to something
 * this pure function cannot see, so they return `null` — "I do not know", which reads as no
 * override and leaves the text alone. A guessed base would be a wrong number that looks right,
 * which is the one outcome this repo treats as worse than no number at all. */
const PER_PX = { px: 1, pt: 96 / 72, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4, q: 96 / 101.6 };

export function fontSizePx(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (typeof value !== "string") return null;
  const m = /^\s*([0-9]*\.?[0-9]+)\s*([a-z%]*)\s*$/i.exec(value);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] || "px").toLowerCase();
  const per = PER_PX[unit];
  if (!per) return null;                       // em/rem/% — relative to something unknowable here
  return Math.round(n * per * 100) / 100;      // two decimals: 11pt → 14.67px, never 14.666666
}

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
    const px = fontSizePx(r && r.fontSize);
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
    fontSize: fontSizePx(st.fontSize),
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

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * ⛔ THE SPACING POPOVER REDESIGN (NEW-4, toolbar rebuild, 2026-09-24) — a NEW, additive
 * vocabulary for the toolbar's spacing control. `LINE_SPACINGS`/`BLOCK_SPACES` above are
 * UNCHANGED (test/notesSpacing.test.js pins them) and still the two values every stored
 * paragraph attribute round-trips through — `setNoteSpacing({lineHeight, spaceAfter, ...})`
 * writes the SAME two attributes either way. What changed is only which options the POPOVER
 * offers and how it labels them: the old menu's rows read "Whole note: Comfortable" / "Lines:
 * 1.15" / "Space before: Small" — none of them a real, sayable name. These are.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

/** The four per-paragraph line-spacing choices the new popover's segmented control offers,
 *  in the Word/Google Docs convention: 1.0 is genuinely "Single" (not `SINGLE` above, which is
 *  1.15 — the OLD control's idea of single. This is intentionally a different, simpler ladder
 *  for the new UI; the underlying `lineHeight` attribute accepts any of these numbers same as
 *  it always has). */
export const SPACING_LINE_OPTIONS = [
  { id: "1", name: "Single", value: 1 },
  { id: "1.15", name: "Default", value: 1.15 },
  { id: "1.5", name: "1.5", value: 1.5 },
  { id: "2", name: "Double", value: 2 },
];

/** The space-before/space-after steppers' starting point for a paragraph with no explicit
 *  value — matches the "Standard" preset below, so picking Standard and leaving the steppers
 *  alone are the same thing. */
export const SPACE_BEFORE_DEFAULT = 0;
export const SPACE_AFTER_DEFAULT = 8;

/** Three named combinations of {line spacing, space after} — a one-click shortcut for the
 *  two numbers together, never stored as a preset id of its own: picking one just writes the
 *  same `lineHeight`/`spaceAfter` attributes a person could set by hand with the controls
 *  above. Space-before is deliberately left alone by every preset (a preset changes density,
 *  not indentation-from-the-block-above). */
export const SPACING_PRESETS = [
  { id: "compact", label: "Compact", lineHeight: 1, spaceAfter: 0 },
  { id: "standard", label: "Standard", lineHeight: 1.15, spaceAfter: 8 },
  { id: "relaxed", label: "Relaxed", lineHeight: 1.5, spaceAfter: 12 },
];

/** The short glyph the closed spacing trigger shows — just the number, "Spacing" when there is
 *  nothing to say (mirrors `spacingLabel` above but against the new ladder's plain numbers
 *  rather than the old ladder's named rows). */
export function spacingGlyphFor(lineHeight) {
  const lh = typeof lineHeight === "number" ? lineHeight : parseFloat(lineHeight);
  if (!Number.isFinite(lh) || lh <= 0) return "Spacing";
  return String(lh);
}
