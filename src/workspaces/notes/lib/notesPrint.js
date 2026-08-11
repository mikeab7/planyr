/* notesPrint — the printed sheet: a note as paper, and as a PDF (B1314).
 *
 * WHY A SEPARATE SHEET RATHER THAN AN `@media print` BLOCK ON THE APP. The owner sends
 * PDFs, not Markdown, so this path has to be reliable rather than clever. Printing the live
 * app means fighting every ancestor of the editor — the flex column, the scroll container,
 * the sticky toolbar, the rail, the theme tokens (a dark surface prints as a black page) —
 * and one new wrapper anywhere above the note silently breaks it. Rendering the note into
 * its OWN document instead means the sheet has exactly the chrome we put on it: no rail, no
 * toolbar, no app furniture, always light-on-white, and a notebook can print as one
 * continuous document, which the on-screen layout could not express at all.
 *
 * PDF-PARITY. The body HTML is not written here — it comes from the editor's own serializer
 * (lib/notesDocHtml.js), so what the sheet shows is what the screen shows by construction.
 * What IS written here is the paper styling, and it is a deliberate MIRROR of the screen's
 * `EDITOR_CSS` (components/NoteEditor.jsx): the same construct list, at print weight, on
 * white. Change one and change the other in the same commit.
 *
 * This module is PURE — it builds a string. `printHtmlDocument` is the one DOM-side export,
 * kept beside it so a caller has one import.
 */

import { absoluteStamp } from "./notesTime.js";

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/* Mirrors src/workspaces/notes/components/NoteEditor.jsx → EDITOR_CSS, construct for
 * construct, translated to paper: ink is black, surfaces are white (a theme token here
 * would print a dark page), and each block declares how it may break across a sheet. */
const PRINT_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: #FFFFFF; color: #14161C; }
body { font: 11.5pt/1.55 -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.sheet { max-width: 190mm; margin: 0 auto; padding: 10mm 8mm; }
.doc-title { font-size: 20pt; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 2mm; }
.doc-meta { font-size: 8.5pt; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #5B6270; margin: 0 0 6mm; }
.page-break { break-before: page; page-break-before: always; }
.note-trail { font-size: 9pt; font-weight: 600; letter-spacing: 0.03em; color: #5A6070; margin: 0 0 1mm; }
.note-page-head { font-size: 12.5pt; font-weight: 700; margin: 6mm 0 2mm; }
.note-page-meta { font-size: 8pt; font-weight: 600; color: #5B6270; margin: 0 0 2mm; }
.note-body > * + * { margin-top: 0.7em; }
/* PDF-PARITY for the Tab indent (B1392): a tab typed in a paragraph is a real character
   in the document, so the sheet has to honour it — and at the SAME width the screen
   does, or an indented line would land in a different place on paper. */
.note-body p { margin: 0; orphans: 2; widows: 2; white-space: pre-wrap; tab-size: 4; }
.note-body h1 { font-size: 1.7em; font-weight: 700; line-height: 1.25; margin: 0; break-after: avoid; }
.note-body h2 { font-size: 1.4em; font-weight: 700; line-height: 1.3; margin: 0; break-after: avoid; }
.note-body h3 { font-size: 1.18em; font-weight: 650; margin: 0; break-after: avoid; }
.note-body h4 { font-size: 1.05em; font-weight: 650; margin: 0; break-after: avoid; }
.note-body ul, .note-body ol { padding-left: 1.5em; margin: 0; }
.note-body li { margin: 0.15em 0; }
.note-body li p { margin: 0; }
.note-body blockquote { border-left: 3px solid #B8418C; padding-left: 0.9em; color: #3A3F4B; margin: 0; }
.note-body code { background: #F2F3F6; border: 1px solid #D8DBE2; border-radius: 3px; padding: 0.1em 0.32em; font-family: ui-monospace, "Courier New", monospace; font-size: 0.9em; }
.note-body pre { background: #F2F3F6; border: 1px solid #D8DBE2; border-radius: 6px; padding: 0.7em 0.85em; white-space: pre-wrap; word-break: break-word; break-inside: avoid; }
.note-body pre code { background: none; border: none; padding: 0; }
.note-body hr { border: none; border-top: 1px solid #9AA0AC; margin: 1.1em 0; }
.note-body a { color: #8C2F69; text-decoration: underline; }
.note-body ul[data-type="taskList"] { list-style: none; padding-left: 0.1em; }
.note-body ul[data-type="taskList"] li { display: flex; align-items: flex-start; gap: 0.5em; }
.note-body ul[data-type="taskList"] li > div { flex: 1 1 auto; min-width: 0; }
.note-body input[type="checkbox"] { width: 11px; height: 11px; margin-top: 0.3em; }
.note-body table { border-collapse: collapse; table-layout: fixed; width: 100%; break-inside: auto; }
.note-body table td, .note-body table th { border: 1px solid #9AA0AC; padding: 4px 7px; vertical-align: top; }
.note-body table th { background: #F2F3F6; font-weight: 650; text-align: left; }
.note-body tr { break-inside: avoid; }
.note-body figure.planyr-note-image, .note-body img { margin: 0; }
.note-body img { max-width: 100%; height: auto; break-inside: avoid; }
.note-body .planyr-note-image-missing { display: inline-block; border: 1px dashed #9AA0AC; color: #5B6270; font-size: 0.85em; padding: 0.6em 0.9em; }
/* A CALLOUT on paper (NEW-7). The node carries a NAME, never a colour, so this is the
   entire ink for it — printed light-on-white with a coloured rule and the same glyph the
   screen draws, mirroring components/NoteEditor.jsx → EDITOR_CSS rule for rule. */
/* ⛔ AN ANCHORED BLOCK PRINTS WHERE IT SITS (NEW-2, PDF-PARITY). Its left/top ride in the
   serialised markup (the node's own renderHTML writes them), so paper reads the same two
   numbers the screen does. There is no second stylesheet holding the position and therefore
   nothing to drift. .note-body is the positioned ancestor, as .ProseMirror is on screen. */
.note-body { position: relative; }
.note-body .planyr-anchor { position: absolute; margin: 0 !important; padding: 3px 6px; break-inside: avoid; }
.note-body .planyr-anchor-grip { display: none; }
.note-body .planyr-callout { position: relative; border: 1px solid #D8DBE2; border-left: 3px solid #5B6270; border-radius: 6px; background: #FAFAFC; padding: 7px 9px 7px 26px; break-inside: avoid; }
.note-body .planyr-callout > * + * { margin-top: 0.5em; }
.note-body .planyr-callout::before { position: absolute; left: 8px; top: 6px; font-size: 10pt; font-weight: 700; content: "i"; color: #5B6270; }
.note-body .planyr-callout[data-callout="info"] { border-left-color: #B8418C; }
.note-body .planyr-callout[data-callout="info"]::before { content: "i"; color: #8C2F69; }
.note-body .planyr-callout[data-callout="tip"] { border-left-color: #0F6E56; }
.note-body .planyr-callout[data-callout="tip"]::before { content: "*"; color: #0F6E56; }
.note-body .planyr-callout[data-callout="important"] { border-left-color: #EF9F27; }
.note-body .planyr-callout[data-callout="important"]::before { content: "*"; color: #8A5410; }
.note-body .planyr-callout[data-callout="warning"] { border-left-color: #8A5410; background: #FBEFD5; }
.note-body .planyr-callout[data-callout="warning"]::before { content: "!"; color: #8A5410; }
.note-body .planyr-callout[data-callout="danger"] { border-left-color: #B3261E; background: #FBE4E0; }
.note-body .planyr-callout[data-callout="danger"]::before { content: "!"; color: #B3261E; }

/* ⛔ A TOGGLE PRINTS **OPEN**, ALWAYS (NEW-7). lib/notesDocHtml.js sets the open
   attribute on every details element before serialising, unconditionally, so a folded section cannot print as
   missing text — the worst class of export bug, because nothing about the sheet looks
   wrong. The disclosure marker is hidden here: on paper it points at nothing. */
.note-body .planyr-toggle { border: 1px solid #D8DBE2; border-radius: 6px; background: #FAFAFC; padding: 6px 9px; break-inside: avoid; }
.note-body .planyr-toggle > * + * { margin-top: 0.5em; }
.note-body .planyr-toggle-title { font-weight: 650; list-style: none; }
.note-body .planyr-toggle-title::-webkit-details-marker { display: none; }

/* AN ATTACHED FILE on paper (NEW-5). Paper cannot carry bytes, so it carries the NAME, the
   type and the size — which is the whole of what a sheet can honestly say about a file, and
   is what stops an attachment vanishing silently out of a PDF. */
.note-body .planyr-note-file { display: inline-flex; align-items: baseline; gap: 6px; padding: 4px 8px; border: 1px solid #9AA0AC; border-radius: 5px; background: #F7F8FA; color: #14161C; text-decoration: none; font-size: 0.92em; font-weight: 650; break-inside: avoid; }
.note-body .planyr-note-file::before { content: "FILE"; font-size: 0.72em; font-weight: 800; letter-spacing: 0.06em; color: #5B6270; }

/* SKETCH MODE on paper. The drawing itself comes from the schema node's own renderHTML, so
   it cannot drift from the screen; what changes here is only the INK — black on white,
   because a theme token would print a dark page. Every box, every word (label AND body) and
   every arrow is on both surfaces: since the canvas started owning the text, a box simply
   draws its own detail, so there is no chevron and no separate detail list to keep in step.
   Mirrors components/NoteEditor.jsx → EDITOR_CSS; change one, change both. */
.note-body .planyr-sketch { break-inside: avoid; }
.note-body .planyr-sketch-canvas { display: block; max-width: 100%; height: auto; }
.note-body .planyr-sketch-surface { fill: transparent; }
.note-body .planyr-sketch-box { fill: #FFFFFF; stroke: #5B6270; stroke-width: 1.2; }
.note-body .planyr-sketch-label { fill: #14161C; font-size: 12.5px; font-weight: 650; }
.note-body .planyr-sketch-body { fill: #3A3F4B; font-size: 11px; font-weight: 500; }
.note-body .planyr-sketch-edge { stroke: #5B6270; stroke-width: 1.4; fill: none; }
.note-body .planyr-sketch-edge-hit { stroke: none; fill: none; }
.note-body .planyr-sketch-edge-g { fill: none; }
.note-body .planyr-sketch-head { fill: #5B6270; stroke: none; }
.note-body .planyr-sketch-empty { margin: 0; color: #5B6270; font-style: italic; }
.empty-note { color: #5B6270; font-style: italic; }
@page { margin: 14mm; }
`;

/** One printable page block. `html` is already-serialized body HTML. */
function pageBlock({ title, html, updatedAt, headingClass = "note-page-head", showTitle = true, breakBefore = false }) {
  const parts = [];
  parts.push(`<section class="note-page${breakBefore ? " page-break" : ""}">`);
  if (showTitle) parts.push(`<h2 class="${headingClass}">${esc(title || "Untitled page")}</h2>`);
  if (updatedAt) parts.push(`<p class="note-page-meta">Edited ${esc(absoluteStamp(updatedAt))}</p>`);
  parts.push(`<div class="note-body">${html && html.trim() ? html : '<p class="empty-note">This page is empty.</p>'}</div>`);
  parts.push("</section>");
  return parts.join("\n");
}

/** A whole print document.
 *
 *  `doc` = `{ title, meta, pages: [{ title, html, updatedAt, trail }] }`. A single page
 *  prints with its title as the document heading and no extra furniture; a branch prints
 *  each page on its own sheet, because a stack of pages run together is not what anyone
 *  hands to a consultant.
 *
 *  ⛔ PDF-PARITY WITH THE NEW SHAPE (B1420). There is no "section" any more, so a subpage
 *  cannot be printed under a section heading. What paper needs instead is WHERE a page sits,
 *  which the screen shows by indentation and paper shows as a **trail line** above the
 *  title — `Grand Port › Entitlements`. It is the same information the rail carries, and it
 *  is the reason a printed branch is still readable when the sheets get separated. */
export function buildPrintDocument({ title, meta = "", pages = [] } = {}) {
  const body = [];
  const single = pages.length === 1;

  body.push(`<h1 class="doc-title">${esc(title || "Note")}</h1>`);
  if (meta) body.push(`<p class="doc-meta">${esc(meta)}</p>`);

  pages.forEach((p, i) => {
    const trail = Array.isArray(p.trail) && p.trail.length ? p.trail.join(" › ") : "";
    if (!single && trail) body.push(`<p class="note-trail${i ? " page-break" : ""}">${esc(trail)}</p>`);
    body.push(pageBlock({ ...p, showTitle: !single, breakBefore: !single && i > 0 && !trail }));
  });

  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${esc(title || "Note")}</title>`,
    `<style>${PRINT_CSS}</style>`,
    "</head><body>",
    `<div class="sheet">${body.join("\n")}</div>`,
    "</body></html>",
  ].join("\n");
}

/** Hand a built document to the browser's print dialogue (which is also where "Save as
 *  PDF" lives). Uses a hidden same-document iframe rather than a popup: a popup is blocked
 *  by default in most browsers, which would make Print silently do nothing.
 *
 *  Resolves once print has been ASKED FOR — the dialogue itself is the browser's, and no
 *  page can know what the user did with it. */
export function printHtmlDocument(html, { testId = "notes-print-frame", settleMs = 350 } = {}) {
  return new Promise((resolve) => {
    let frame;
    try {
      frame = document.createElement("iframe");
      frame.setAttribute("data-testid", testId);
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0;border:0;";
      document.body.appendChild(frame);
    } catch (_) { resolve({ ok: false, error: "The print sheet could not be created." }); return; }

    const cleanup = () => { try { frame.remove(); } catch (_) { /* already gone */ } };

    let started = false;
    const go = () => {
      if (started) return;                 // `load` and the readyState check can both fire
      started = true;
      // Images are data URLs, so they decode locally — a short settle is enough for layout
      // to be final before the dialogue snapshots the document.
      setTimeout(() => {
        try {
          frame.contentWindow.focus();
          frame.contentWindow.print();
          resolve({ ok: true });
        } catch (e) {
          resolve({ ok: false, error: "This browser refused to open the print dialogue." });
        }
        // The frame must outlive the (modal, synchronous in some browsers) dialogue.
        setTimeout(cleanup, 60000);
      }, settleMs);
    };

    frame.addEventListener("load", go, { once: true });
    try {
      const d = frame.contentDocument;
      d.open();
      d.write(html);
      d.close();
      // Some browsers do not fire `load` for a document written this way.
      if (d.readyState === "complete") go();
    } catch (_) {
      cleanup();
      resolve({ ok: false, error: "The print sheet could not be written." });
    }
  });
}
