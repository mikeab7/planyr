/* notesOfficeStyle — OFFICE'S OTHER SPELLINGS OF TEXT FORMATTING, TURNED INTO THE INLINE MARKUP THE EDITOR'S PARSER READS
 * (NEW-1, 2026-11-05; found by the Notes paste bank, ui-audit/lib/pasteBank.mjs, red on unmodified main).
 *
 * The parser reads formatting from the element's own `style=` and from `<b> <i> <u> <s>`. Office also writes it two other ways,
 * and a paste lost both:
 *   1. A CLASS whose rule sits in the clipboard's `<style>` — Excel's whole-cell format (`<td class=xl65>` + `.xl65 { font-weight:700;
 *      color:#C00000 }`). Bold and a text colour set that way arrived plain. Only declarations that become a MARK are read (bold,
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

/** Colours that are "the default ink", not a choice: writing them would put a colour mark on every character. */
const DEFAULT_INK = /^(?:black|windowtext|automatic|auto|inherit|initial|unset|currentcolor|#0{3}|#0{6}|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

/** The mark-bearing declarations of one CSS block → { bold, italic, underline, strike, color } (only those present). */
function markDeclarations(block) {
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
  }
  return out;
}

/** `{ className: marks }` from the clipboard's `<style>` text — class selectors only (`.xl65`, `td.xl65`). */
export function marksByClass(cssText) {
  const out = {};
  for (const [cls, block] of classRules(cssText)) {
    const marks = markDeclarations(block);
    if (Object.values(marks).some((v) => v)) out[cls] = { ...(out[cls] || {}), ...marks };
  }
  return out;
}

const PROPS = ["bold", "italic", "underline", "strike", "color"];

/** The marks a run needs to carry that its ANCESTORS' CLASSES give it, as `{ tags: ["b","i","u","s"], color }` — nearest declaration wins, and an element that
 *  states the property itself inline stops the search (the parser already reads that one). */
function styleFor(text, byClass, root) {
  const got = {};
  for (let el = text.parentElement; el && el !== root.parentElement; el = el.parentElement) {
    const inline = markDeclarations(el.getAttribute?.("style"));
    const own = {};
    for (const c of String(el.getAttribute?.("class") || "").split(/\s+/)) if (byClass[c]) Object.assign(own, byClass[c]);
    for (const p of PROPS) {
      if (p in got) continue;
      if (p in inline) got[p] = "inline";            // stated on the element: the parser reads it, nothing to add
      else if (p in own) got[p] = own[p];
    }
    if (PROPS.every((p) => p in got)) break;
  }
  const tags = [got.bold === true && "b", got.italic === true && "i", got.underline === true && "u", got.strike === true && "s"].filter(Boolean);
  const color = got.color && got.color !== "inline" ? got.color : null;
  return { tags, color };
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

/** The whole pre-pass over a clipboard document (`doc.body` is the root; its `<style>` blocks are read from `doc`). */
export function normalizeOfficeStyle(doc) {
  const root = doc.body;
  replaceFontElements(root);
  const byClass = marksByClass(Array.from(doc.querySelectorAll("style")).map((s) => s.textContent).join("\n"));
  if (!Object.keys(byClass).length) return doc;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const runs = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.nodeValue && n.nodeValue.trim()) runs.push(n);
  for (const text of runs) {
    const { tags, color } = styleFor(text, byClass, root);
    if (!tags.length && !color) continue;
    /* ⛔ SEMANTIC ELEMENTS, NOT A STYLED SPAN. Tiptap's textStyle mark takes ANY `<span style>` and makes a mark of it, so a span
     * carrying only `font-weight` stored an empty textStyle mark beside the bold one — which "Merge Formatting" then stripped,
     * turning a no-op into an edit (verify-notes-paste-options caught it). `<b> <i> <u> <s>` are exactly what Chrome writes for
     * rich text; only a COLOUR needs a span, and a colour is a real textStyle. */
    let wrapped = text;
    if (color) { const span = doc.createElement("span"); span.setAttribute("style", `color:${color}`); text.replaceWith(span); span.appendChild(text); wrapped = span; }
    for (const tag of tags) { const el = doc.createElement(tag); wrapped.replaceWith(el); el.appendChild(wrapped); wrapped = el; }
  }
  return doc;
}
