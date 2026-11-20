/* notesPasteInherit — A PASTED RUN INHERITS THE FONT ITS SOURCE GAVE IT (NEW-5)
 *
 * ⛔ HIS REPORT: *"one bullet, 'Jerry Hayley Kandice Cabets' — first half carries font-family:
 * Calibri, second half carries none and falls back to Inter. The inconsistency runs through the
 * whole note, sometimes mid-line."* He asked, explicitly, to establish whether the paste
 * sanitiser drops marks unevenly or whether later editing strips them, and not to guess.
 *
 * ⛔ IT IS NEITHER, AND THAT MATTERS BECAUSE BOTH CANDIDATE CAUSES WOULD HAVE BEEN FIXED IN THE
 * WRONG PLACE. Measured by pasting real Word/Outlook clipboard HTML into the real editor and
 * reading the STORED document back (ui-audit/verify-notes-font-control.mjs, section 1):
 *
 *     run              declared on its own <span>        stored fontFamily
 *     ───────────────────────────────────────────────────────────────────────
 *     Contacts:        font-family + font-size           "Calibri",sans-serif   ✓
 *     Jerry Hayley     font-family                       "Calibri",sans-serif   ✓
 *     Kandice Cabets   nothing                           null                   ✗ → Inter
 *     713-416-5353     font-size only                    ""                     ✗ → Inter
 *
 * The clipboard HTML is INTERNALLY CONSISTENT: the wrapping `<div>` declares Calibri once, for
 * everything inside it, exactly as CSS inheritance intends. The sanitiser drops nothing — it
 * never sees a mark to drop — and later editing strips nothing. **A `parseHTML` that reads
 * `element.style` reads only what is declared on the run's OWN element, and inheritance is
 * invisible to it.** So the unevenness is manufactured at parse time, by us, out of consistent
 * input: a run whose author styled it directly keeps its font, and an identical run two words
 * later that relied on inheritance loses it. That is exactly the mid-line inconsistency he saw.
 *
 * The fix is to resolve the inherited value the way the browser would — walk up the pasted
 * fragment to the nearest ancestor that declares one — so every run in a pasted block is
 * treated the same way, which is what he asked for.
 *
 * ⛔ WHAT THIS DELIBERATELY DOES NOT DO: touch anything already saved. He was explicit — *"do
 * NOT silently rewrite formatting in notes he already has — a repair pass over existing content
 * is a separate decision he has not made."* This runs only while PARSING incoming HTML, so a
 * note that is already in the patchwork state stays exactly as it is until he changes it
 * himself. There is no migration and no sweep.
 *
 * PURE-ish: it touches only the element handed to it and that element's own ancestors, never
 * the editor, the document or storage — so it is exercised for real by the browser harness and
 * its walk is unit-tested against a tiny stand-in element tree.
 */

import { isNonValue } from "./notesResolvedValue.js";

/** How far up to look. A clipboard fragment is a handful of wrappers deep (Word nests
 *  `div > div > p > span`); a ceiling keeps a pathological paste from walking a long chain, and
 *  it is not a correctness bound — inheritance that starts further out than this is vanishingly
 *  rare and losing it degrades to exactly today's behaviour. */
const MAX_DEPTH = 12;

/** Elements a walk must never cross. `.ProseMirror` is the live editor: `parseHTML` also runs
 *  when the editor parses its OWN rendered DOM, and inheriting the EDITOR's font into a mark
 *  would write the app's own body font into the document as if the user had chosen it. */
function isBoundary(el) {
  if (!el || el.nodeType !== 1) return true;
  const tag = el.tagName;
  if (tag === "BODY" || tag === "HTML" || tag === "HEAD") return true;
  return !!(el.classList && el.classList.contains("ProseMirror"));
}

/** ⛔ AND THE HALF AN ANCESTOR WALK IN `parseHTML` CANNOT REACH, found by pointing the harness
 *  at the fix: a run whose element declares NOTHING AT ALL never gets a `parseHTML` call to walk
 *  from. Tiptap's `textStyle` mark refuses a bare `<span>` outright (`getAttrs` returns `false`
 *  when the element carries none of the styles it knows), so no mark is created and no attribute
 *  parser runs — and "Kandice Cabets", the very run he reported, is exactly a bare `<span>`.
 *
 *  So the inheritance is resolved one step EARLIER, on the clipboard HTML itself, before
 *  ProseMirror parses it: `pushDownInherited` writes each inherited value onto the element that
 *  actually holds the text. The input becomes explicit instead of implicit, and every run is then
 *  treated identically by a parser that only ever reads what is declared.
 *
 *  ⛔ THIS RUNS ON PASTE ONLY (`transformPastedHTML`), which is what makes it safe: the editor
 *  also parses its OWN rendered DOM, and a rule that pushed styles down there would gradually
 *  write the app's own body font into documents as though the user had chosen it. */
/** Colours that are "the default ink", not a choice: writing one would put a colour mark on every character, and black text
 *  pasted into a dark theme is invisible. (Shared with notesOfficeStyle.js, which reads colours from class rules.) */
export const DEFAULT_INK = /^(?:black|windowtext|automatic|auto|inherit|initial|unset|currentcolor|#0{3}|#0{6}|rgb\(\s*0\s*,\s*0\s*,\s*0\s*\))$/i;

/** Elements whose own style is NOT a text mark and which must keep the behaviour they have always had. A spreadsheet cell
 *  (Excel / Sheets repeat their font on EVERY cell; the Excel paste is pinned and must not grow a mark per cell). */
const CELLS = new Set(["TD", "TH"]);
const HEADINGS = /^H[1-6]$/;

/** Wrap `text` in a `<span style>` carrying `css` (an object of CSS properties), unless it is empty. */
function wrapInSpan(text, css) {
  const decls = Object.entries(css).filter(([, v]) => v).map(([k, v]) => `${k}:${v}`);
  if (!decls.length) return;
  const span = text.ownerDocument.createElement("span");
  span.setAttribute("style", decls.join(";"));
  text.replaceWith(span);
  span.appendChild(text);
}

export function pushDownInherited(root) {
  if (!root) return root;
  /* ⛔ AND STRIP THE NON-VALUES ON THE WAY IN (NEW-8). Outlook emits `color: inherit` on some
   * runs and nothing on others; both render identically, but one stores a mark that says
   * "inherit" and the other stores no mark, and the colour control then reported them as two
   * different states — a swatch on one, nothing on the other, and a false "mixed" across the
   * pair. `inherit` is not a colour. Removing it here means it stops being CREATED; notes that
   * already hold one are read correctly by `resolvedColor` and are deliberately not rewritten. */
  for (const el of root.querySelectorAll("[style]")) {
    for (const prop of ["color", "backgroundColor", "fontFamily", "fontSize"]) {
      if (isNonValue(el.style[prop])) el.style[prop] = "";
    }
  }
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const texts = [];
  let n;
  while ((n = walker.nextNode())) {
    if (!n.nodeValue || !n.nodeValue.trim()) continue;
    if (n.parentElement) texts.push(n);
  }
  const inkOf = (el) => {
    const c = inheritedStyle(el, "color");
    return c && !DEFAULT_INK.test(c) ? c : null;
  };
  for (const text of texts) {
    const el = text.parentElement;
    if (!el.style) continue;
    if (el.tagName === "SPAN") {
      /* A span IS what the parser reads: give it what it does not state itself but its ancestors do. */
      for (const prop of ["fontFamily", "fontSize", "color"]) {
        if (String(el.style[prop] || "").trim()) continue;   // already explicit
        const inherited = prop === "color" ? inkOf(el.parentElement) : inheritedStyle(el.parentElement, prop);
        if (inherited) el.style[prop] = inherited;
      }
    } else if (CELLS.has(el.tagName)) {
      /* Unchanged on purpose (see CELLS). */
      for (const prop of ["fontFamily", "fontSize"]) {
        if (String(el.style[prop] || "").trim()) continue;
        const inherited = inheritedStyle(el.parentElement, prop);
        if (inherited) el.style[prop] = inherited;
      }
    } else {
      /* ⛔ NEW-2 (2026-11-10, "Keep Source Formatting takes away the font"): THE PARSER ONLY READS A FONT, SIZE OR COLOUR OFF A
       * `<span>`. A browser copies a whole paragraph as `<p style="color:…; font-family:…">`, and Word / Outlook put the font on the
       * block or a wrapper `<div>` — so the text arrived in the app font (the colour too, in the same shape). The value is resolved
       * the way the browser would (this element, then the nearest ancestor that declares one) and written onto a span around the
       * text, which is exactly what a directly-styled run already looked like. A heading keeps its own size (it is structure), and
       * a link keeps its link colour — neither is a text style the person chose. */
      wrapInSpan(text, {
        "font-family": inheritedStyle(el, "fontFamily"),
        "font-size": HEADINGS.test(el.tagName) ? null : inheritedStyle(el, "fontSize"),
        color: el.tagName === "A" ? null : inkOf(el),
      });
    }
  }
  return root;
}

/** The value of `prop` declared on `el` itself, or on the nearest ancestor that declares one.
 *  `""` — which is what an undeclared inline style reads as, and what was being stored as a
 *  junk empty mark — is "not declared", never a value. */
export function inheritedStyle(el, prop, readOwn) {
  let node = el;
  let depth = 0;
  while (node && node.nodeType === 1 && depth <= MAX_DEPTH) {
    const own = readOwn ? readOwn(node) : null;
    const value = (own && String(own).trim()) || (node.style ? String(node.style[prop] || "").trim() : "");
    if (value) return value;
    if (isBoundary(node.parentElement)) return null;
    node = node.parentElement;
    depth += 1;
  }
  return null;
}
