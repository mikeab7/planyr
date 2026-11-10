/* notesOfficeStyle — OFFICE'S OTHER SPELLINGS OF TEXT FORMATTING, TURNED INTO THE INLINE MARKUP THE EDITOR'S PARSER READS
 * (NEW-1, 2026-11-05; found by the Notes paste bank, ui-audit/lib/pasteBank.mjs, red on unmodified main).
 *
 * The parser reads formatting from the element's own `style=` and from `<b> <i> <u> <s>`. Office also writes it two other ways,
 * and a paste lost both:
 *   1. A CLASS whose rule sits in the clipboard's `<style>` — Excel's whole-cell format (`<td class=xl65>` + `.xl65 { font-weight:700;
 *      color:red }`). Bold and a text colour set that way arrived plain. Only declarations that become a MARK are read (bold,
 *      italic, underline, strike, colour): the font and size Excel repeats on EVERY cell are not turned into a mark on every cell.
 *   2. The HTML-3.2 `<font color= face=>` element (Outlook, Word-for-web). No parse rule matches `<font>`, so colour and typeface
 *      were dropped — the same loss the 2026-10-30 BlockNote spike measured.
 *
 * ⛔ DECIDED, NOT TOUCHED: a foreign table's cell SHADING is still not imported by the ordinary paste (notesTableFill.js /
 * notesPasteModes.js — the options that ask for it do). This module writes text marks only, never a background.
 *
 * Paste only (`transformPastedHTML`), the same boundary as `pushDownInherited` (notesPasteInherit.js): the editor also parses its own
 * rendered DOM, and rewriting that would write styles nobody chose. The caller catches a throw and the paste goes through unchanged. */
import { classRules } from "./notesTablePaste.js";
import { DEFAULT_INK } from "./notesPasteInherit.js";

/** The mark-bearing declarations of one CSS block → { bold, italic, underline, strike, color } (only those present). */
function markDeclarations(block, { fonts = false } = {}) {
  const out = {};
  for (const decl of String(block || "").split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, "");
    if (prop === "font-weight") out.bold = value === "bold" || value === "bolder" || Number(value) >= 600;
    else if (prop === "font-style") out.italic = /^(italic|oblique)/i.test(value);
    else if (prop === "text-decoration" || prop === "text-decoration-line") {
      out.underline = /underline/i.test(value);
      out.strike = /line-through/i.test(value);
    } else if (prop === "color") out.color = DEFAULT_INK.test(value) ? null : value;
    else if (fonts && prop === "font-family") out.fontFamily = /^(inherit|initial|unset)$/i.test(value) ? null : value;
    else if (fonts && prop === "font-size") out.fontSize = /^(inherit|initial|unset|medium)$/i.test(value) ? null : value;
  }
  return out;
}

/** `{ className: marks }` from the clipboard's `<style>` text — class selectors only (`.xl65`, `td.xl65`). Mark-bearing declarations
 *  only (bold, italic, underline, strike, colour); `fonts: true` also reads font-family / font-size (the paste uses that, with the
 *  spreadsheet-cell exception in `styleFor`). */
export function marksByClass(cssText, { fonts = false } = {}) {
  const out = {};
  for (const [cls, block] of classRules(cssText)) {
    const marks = markDeclarations(block, { fonts });
    if (Object.values(marks).some((v) => v)) out[cls] = { ...(out[cls] || {}), ...marks };
  }
  return out;
}

const PROPS = ["bold", "italic", "underline", "strike", "color", "fontFamily", "fontSize"];
/** ⛔ A SPREADSHEET CELL'S CLASS NEVER GIVES TEXT A FONT OR SIZE: Excel repeats Calibri 11 on every cell, and the Excel paste is pinned
 *  to arrive without a text mark per cell (the decision above). Word's `p.MsoNormal { font-family: Calibri }` is the case this reads. */
const FONT_PROPS = new Set(["fontFamily", "fontSize"]);

/** The marks a run needs to carry that its ANCESTORS' CLASSES give it, as `{ tags: ["b","i","u","s"], color }` — nearest declaration wins, and an element that
 *  states the property itself inline stops the search (the parser already reads that one). */
function styleFor(text, byClass, root) {
  const got = {};
  for (let el = text.parentElement; el && el !== root.parentElement; el = el.parentElement) {
    const inline = markDeclarations(el.getAttribute?.("style"), { fonts: true });
    const own = {};
    for (const c of String(el.getAttribute?.("class") || "").split(/\s+/)) if (byClass[c]) Object.assign(own, byClass[c]);
    const isCell = /^t[dh]$/i.test(el.tagName || "");
    for (const p of PROPS) {
      if (p in got) continue;
      if (p in inline) got[p] = "inline";            // stated on the element: the parser reads it, nothing to add
      else if (p in own && !(isCell && FONT_PROPS.has(p))) got[p] = own[p];
    }
    if (PROPS.every((p) => p in got)) break;
  }
  const tags = [got.bold === true && "b", got.italic === true && "i", got.underline === true && "u", got.strike === true && "s"].filter(Boolean);
  const val = (p) => (got[p] && got[p] !== "inline" ? got[p] : null);
  return { tags, color: val("color"), fontFamily: val("fontFamily"), fontSize: val("fontSize") };
}

/** `<font color= face=>` → `<span style="color:…;font-family:…">`, children kept. (`size=` is the 1–7 scale, which maps to no
 *  size anyone chose — left alone.) */
function replaceFontElements(root) {
  for (const f of Array.from(root.querySelectorAll("font"))) {
    const span = f.ownerDocument.createElement("span");
    const css = [];
    const color = (f.getAttribute("color") || "").trim();
    const face = (f.getAttribute("face") || "").trim();
    if (color && !DEFAULT_INK.test(color)) css.push(`color:${/^[0-9a-f]{6}$/i.test(color) ? `#${color}` : color}`);
    if (face) css.push(`font-family:${face}`);
    if (css.length) span.setAttribute("style", css.join(";"));
    while (f.firstChild) span.appendChild(f.firstChild);
    f.replaceWith(span);
  }
}

/** A background that is a HIGHLIGHT, as a CSS colour, or null. Word writes a highlighter as `background:yellow;mso-highlight:yellow`,
 *  a browser as `background-color: rgb(…)` on a span; "no background" in any spelling is not a highlight. */
const NO_BACKGROUND = /^(?:|none|transparent|inherit|initial|unset|auto|windowtext|window|white|#f{3}|#f{6}|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|rgba\([^)]*,\s*0\s*\))$/i;
export function highlightOf(styleText) {
  let mso = null; let bg = null;
  for (const decl of String(styleText || "").split(";")) {
    const i = decl.indexOf(":");
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim().replace(/\s*!important\s*$/i, "");
    if (prop === "mso-highlight") mso = value;
    else if (prop === "background-color" || prop === "background") bg = value.split(/\s+(?=[a-z#])/i).find((part) => !NO_BACKGROUND.test(part) && /^(#[0-9a-f]{3,8}|rgba?\(|hsla?\(|[a-z]+$)/i.test(part)) || null;
  }
  const pick = mso && !NO_BACKGROUND.test(mso) ? mso : bg;
  return pick && !NO_BACKGROUND.test(pick) ? pick : null;
}

/** ⛔ A HIGHLIGHT ARRIVES AS A HIGHLIGHT (NEW-2, 2026-11-10). The editor's highlight mark is read from `<mark>`; Word and browsers
 *  write it as a background on a SPAN, so a highlighted word pasted plain. The span's children go inside a `<mark>` carrying that
 *  colour (a span's own background is not read — the textStyle mark has no background). Spans only: a table cell's or a block's
 *  shading is not a highlight and is decided elsewhere (notesTableFill.js). */
function highlightSpans(root) {
  for (const span of Array.from(root.querySelectorAll("span[style]"))) {
    const color = highlightOf(span.getAttribute("style"));
    if (!color || !span.textContent.trim()) continue;
    const mark = span.ownerDocument.createElement("mark");
    mark.setAttribute("style", `background-color:${color}`);
    while (span.firstChild) mark.appendChild(span.firstChild);
    span.appendChild(mark);
  }
}

/** The whole pre-pass over a clipboard document (`doc.body` is the root; its `<style>` blocks are read from `doc`). */
export function normalizeOfficeStyle(doc) {
  const root = doc.body;
  replaceFontElements(root);
  highlightSpans(root);
  const byClass = marksByClass(Array.from(doc.querySelectorAll("style")).map((s) => s.textContent).join("\n"), { fonts: true });
  if (!Object.keys(byClass).length) return doc;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue && n.nodeValue.trim()) runs.push(n);
  for (const text of runs) {
    const { tags, color, fontFamily, fontSize } = styleFor(text, byClass, root);
    if (!tags.length && !color && !fontFamily && !fontSize) continue;
    /* ⛔ SEMANTIC ELEMENTS, NOT A STYLED SPAN. Tiptap's textStyle mark takes ANY `<span style>` and makes a mark of it, so a span
     * carrying only `font-weight` stored an empty textStyle mark beside the bold one — which "Merge Formatting" then stripped,
     * turning a no-op into an edit (verify-notes-paste-options caught it). `<b> <i> <u> <s>` are exactly what Chrome writes for
     * rich text; only a COLOUR needs a span, and a colour is a real textStyle. */
    let wrapped = text;
    const css = [color && `color:${color}`, fontFamily && `font-family:${fontFamily}`, fontSize && `font-size:${fontSize}`].filter(Boolean);
    if (css.length) { const span = doc.createElement("span"); span.setAttribute("style", css.join(";")); text.replaceWith(span); span.appendChild(text); wrapped = span; }
    for (const tag of tags) { const el = doc.createElement(tag); wrapped.replaceWith(el); el.appendChild(wrapped); wrapped = el; }
  }
  return doc;
}
