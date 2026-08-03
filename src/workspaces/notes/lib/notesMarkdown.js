/* notesMarkdown — PURE export of a note's document model to Markdown, plus `docToText`
 * (the flattened plain text that body search reads).
 *
 * WHY MARKDOWN IS AN EXPORT AND NOT THE STORAGE FORMAT. Markdown cannot express a
 * merged table cell, a text colour, a font size, a highlight, or a checked task. Storing
 * Markdown would therefore cap the editor at what Markdown can spell — the exact inverse
 * of the functionality-first ordering this module was asked for. So the DOCUMENT MODEL
 * (ProseMirror JSON) is what persists, and Markdown is a one-way export.
 *
 * AND IT IS AN HONEST ONE. What Markdown can say, it says: GFM pipe tables, task lists,
 * code fences, block quotes, links, the four inline marks. What it cannot, falls back to
 * the small inline-HTML subset that every Markdown renderer passes through unchanged
 * (`<u>`, `<mark>`, `<span style>`, and a full `<table>` when cells are merged). Crucially
 * `docToMarkdown` RETURNS the list of constructs that needed a fallback, so the UI can
 * name them after an export instead of letting the user discover the gap in another app.
 *
 * ESCAPING — read this before touching the table writer. `escapeText` already escapes the
 * pipe character, because a pipe is a Markdown special everywhere, not just in a table.
 * The table writer must therefore NOT escape pipes a second time: doing so emits `\\|`
 * and every cell containing one renders with a stray backslash. There is a regression
 * test for exactly this (test/notesMarkdown.test.js).
 */

/* The node and mark names this exporter handles. test/notesModule.test.js asserts this
 * covers everything lib/notesExtensions.js lets into a document — so adding an extension
 * without teaching the exporter about it fails the build rather than silently exporting
 * a blank. */
export const NOTE_MD_HANDLED = {
  nodes: ["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem",
    "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak",
    "table", "tableRow", "tableHeader", "tableCell", "noteImage", "noteSketch"],
  marks: ["bold", "italic", "strike", "code", "underline", "link", "textStyle", "highlight"],
};

/* Human-readable names for the lossiness report — what the user sees, not node names. */
const LOSSY = {
  underline: "underlined text",
  highlight: "highlighted text",
  color: "text colour",
  fontSize: "font size",
  fontFamily: "font family",
  align: "text alignment",
  mergedCells: "merged table cells",
  richCells: "tables with multi-paragraph cells",
  headerlessTable: "tables with no header row",
  missingImage: "an image whose stored copy has gone",
  sketchPlacement: "where a sketch's boxes were dragged to",
};

/* ---- images -------------------------------------------------------------------------
 *
 * An image's BYTES are not in the document — the document holds an id and the bytes live
 * in IndexedDB (lib/notesImageDb.js). This module stays PURE, so it never reaches for
 * them: the caller passes an `images` map of `imageId → data URL` and the exporter inlines
 * what it was given. An exported note is therefore SELF-CONTAINED (open it anywhere and
 * the pictures are in it), and this file still has no storage dependency to test around.
 */

/** Every image id a document references, in document order, de-duplicated. The one place
 *  the app asks "which pictures does this page need?" — used by the export, the print
 *  sheet, and the purge that destroys a binned page's images along with its body. */
export function imageIdsInDoc(doc) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteImage") {
      const id = n.attrs?.imageId;
      if (id && !seen.has(id)) { seen.add(id); out.push(id); }
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}

/** Every image id across a whole map of `pageId → doc`. */
export function imageIdsInDocs(bodies) {
  const seen = new Set();
  for (const doc of Object.values(bodies || {})) for (const id of imageIdsInDoc(doc)) seen.add(id);
  return [...seen];
}

/** Markdown for one image. A picture whose bytes are gone is written as a NAMED broken
 *  reference and reported as lossy — silently emitting nothing would make an export look
 *  complete while a figure had quietly vanished from it. */
function imageMd(node, lossy, images) {
  const alt = String(node.attrs?.alt || "image").replace(/[[\]]/g, "");
  const src = images?.[node.attrs?.imageId];
  if (!src) { lossy.add(LOSSY.missingImage); return `![${alt}](#image-not-stored)`; }
  return `![${alt}](${src})`;
}

/* ---- sketches -------------------------------------------------------------------------
 *
 * A SKETCH EXPORTS AS THE OUTLINE IT WAS DRAWN FROM, and that is LOSSLESS FOR CONTENT: the
 * outline is the single source of truth for what exists and what connects to what (the full
 * rule is at the top of lib/notesSketchModel.js), so an indented Markdown list carries every
 * box, every label, every body and every parent→child arrow with nothing left behind.
 *
 * Two things a list cannot say, and NEITHER is dropped silently:
 *   • WHERE boxes were dragged to — a Markdown list has no coordinates, so this is reported
 *     by name in the lossy list, the same way a merged table cell is.
 *   • THE EXTRA ARROWS — the cross-links the outline's shape cannot express. These are
 *     WRITTEN OUT, as a short labelled list under the outline, because they are content and
 *     content does not get to vanish into a footnote.
 *
 * ⛔ THIS FILE IMPORTS NOTHING (it is on the Notes route's STATIC path, and the sketch model
 * deliberately is not — pulling it in here would put sketch code on every notebook's first
 * paint). The reading below is therefore hand-rolled and defensive. test/notesSketch.test.js
 * guards the drift that invites: it feeds a real sketch node through BOTH this exporter and
 * the model's own `parseOutlineText`, and fails if the two disagree about the outline.
 */
function sketchMd(node, lossy) {
  const a = node?.attrs || {};
  const outline = (Array.isArray(a.outline) ? a.outline : [])
    .filter((n) => n && typeof n === "object" && n.id)
    .map((n) => ({
      id: String(n.id),
      depth: Math.max(0, Math.trunc(Number(n.depth) || 0)),
      label: String(n.label == null ? "" : n.label),
      body: String(n.body == null ? "" : n.body),
    }));
  if (!outline.length) return "";

  // Same clamp the model applies: a line can only ever be one level deeper than the one above.
  let prev = -1;
  for (const n of outline) { n.depth = Math.min(n.depth, prev + 1); prev = n.depth; }

  const lines = [];
  for (const n of outline) {
    const pad = "  ".repeat(n.depth);
    lines.push(`${pad}- ${escapeText(n.label)}`);
    /* The body rides as an indented `>` line under its own bullet — the SAME syntax the
     * outline pane uses. Two things fall out of matching it rather than inventing a second
     * form: the label/body pair survives the export AS A PAIR (a plain indented
     * continuation would re-read as a box of its own), and the exported list can be pasted
     * straight back into a sketch and come out identical. It renders as an indented quote
     * in any Markdown viewer, which is what a detail note should look like. */
    if (n.body) for (const b of n.body.split("\n")) lines.push(`${pad}  > ${escapeText(b)}`);
  }

  const label = (id) => outline.find((n) => n.id === id)?.label || "";
  const links = (Array.isArray(a.links) ? a.links : [])
    .filter((l) => l && label(l.from) && label(l.to));
  if (links.length) {
    lines.push("");
    lines.push(`${escapeText("Also connected:")}`);
    for (const l of links) lines.push(`- ${escapeText(label(l.from))} → ${escapeText(label(l.to))}`);
  }

  if (Object.keys(a.positions || {}).length) lossy.add(LOSSY.sketchPlacement);
  return lines.join("\n");
}

/* ---- text escaping ---------------------------------------------------------------- */

const INLINE_SPECIALS = /[\\`*_[\]<>|~]/g;

/** Escape Markdown specials in a run of plain text. Includes `|` — see the header note. */
export function escapeText(s) {
  return String(s == null ? "" : s)
    .replace(INLINE_SPECIALS, (c) => `\\${c}`)
    // A line that STARTS with a block marker would otherwise become that block.
    .replace(/^(\s*)(#{1,6}\s|>\s|[-+]\s|\d+\.\s|={2,}$)/gm, (_m, ws, mk) => `${ws}\\${mk}`);
}

const attr = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* ---- inline marks ------------------------------------------------------------------ */

function applyMarks(text, marks, lossy) {
  let out = text;
  const has = (n) => marks.find((m) => m.type === n);

  /* Inline code is RAW — escaping inside it would defeat the point. A backtick in the
   * content is handled the way GFM specifies: widen the fence past the longest run inside,
   * and pad with spaces so a leading/trailing backtick is not eaten. (An earlier version
   * inserted a zero-width space here, which silently altered the user's code.) */
  const code = has("code");
  if (code) {
    const runs = String(text).match(/`+/g) || [];
    const fence = "`".repeat(Math.max(1, ...runs.map((r) => r.length)) + (runs.length ? 1 : 0));
    const pad = runs.length ? " " : "";
    out = `${fence}${pad}${text}${pad}${fence}`;
  }

  if (has("bold")) out = `**${out}**`;
  if (has("italic")) out = `*${out}*`;
  if (has("strike")) out = `~~${out}~~`;

  if (has("underline")) { out = `<u>${out}</u>`; lossy.add(LOSSY.underline); }

  const hl = has("highlight");
  if (hl) {
    const c = hl.attrs?.color;
    out = c ? `<mark style="background-color:${attr(c)}">${out}</mark>` : `<mark>${out}</mark>`;
    lossy.add(LOSSY.highlight);
  }

  const ts = has("textStyle");
  if (ts?.attrs) {
    const style = [];
    if (ts.attrs.color) { style.push(`color:${ts.attrs.color}`); lossy.add(LOSSY.color); }
    if (ts.attrs.fontSize) { style.push(`font-size:${ts.attrs.fontSize}`); lossy.add(LOSSY.fontSize); }
    if (ts.attrs.fontFamily) { style.push(`font-family:${ts.attrs.fontFamily}`); lossy.add(LOSSY.fontFamily); }
    if (style.length) out = `<span style="${attr(style.join(";"))}">${out}</span>`;
  }

  const link = has("link");
  if (link?.attrs?.href) out = `[${out}](${String(link.attrs.href).replace(/[()]/g, (c) => `\\${c}`)})`;

  return out;
}

/** Serialize a run of inline content (text nodes + hardBreaks) to Markdown. */
function inline(nodes, lossy, { inTableCell = false } = {}) {
  let out = "";
  for (const n of nodes || []) {
    if (!n || typeof n !== "object") continue;
    if (n.type === "hardBreak") { out += inTableCell ? "<br>" : "  \n"; continue; }
    if (n.type === "text") {
      const marks = Array.isArray(n.marks) ? n.marks : [];
      const base = marks.some((m) => m.type === "code") ? n.text : escapeText(n.text);
      out += applyMarks(base, marks, lossy);
      continue;
    }
    // Anything else nested inline (an inline node type we don't model) contributes its text.
    if (n.content) out += inline(n.content, lossy, { inTableCell });
  }
  return out;
}

/* ---- tables ------------------------------------------------------------------------ */

const cellIsSimple = (cell) => {
  const c = cell?.content || [];
  return c.length <= 1 && (c.length === 0 || c[0].type === "paragraph");
};
const spans = (cell) => ({ cs: Number(cell?.attrs?.colspan || 1), rs: Number(cell?.attrs?.rowspan || 1) });

function cellText(cell, lossy) {
  const para = (cell?.content || []).find((c) => c.type === "paragraph");
  return inline(para?.content, lossy, { inTableCell: true }).trim();
}

/** Full HTML table — the fallback for anything a pipe table structurally cannot hold. */
function htmlTable(node, lossy, images) {
  const rows = (node.content || []).filter((r) => r.type === "tableRow");
  const lines = ["<table>"];
  for (const row of rows) {
    lines.push("  <tr>");
    for (const cell of row.content || []) {
      const tag = cell.type === "tableHeader" ? "th" : "td";
      const { cs, rs } = spans(cell);
      const a = `${cs > 1 ? ` colspan="${cs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""}`;
      // Cell bodies may be several blocks; render each as its own paragraph-ish line.
      const body = (cell.content || []).map((b) => (b.type === "paragraph" ? inline(b.content, lossy, { inTableCell: true }) : blocks([b], lossy, 0, images).trim().replace(/\n/g, "<br>"))).filter(Boolean).join("<br>");
      lines.push(`    <${tag}${a}>${body}</${tag}>`);
    }
    lines.push("  </tr>");
  }
  lines.push("</table>");
  return lines.join("\n");
}

function table(node, lossy, images) {
  const rows = (node.content || []).filter((r) => r.type === "tableRow");
  if (!rows.length) return "";

  const merged = rows.some((r) => (r.content || []).some((c) => { const { cs, rs } = spans(c); return cs > 1 || rs > 1; }));
  const rich = rows.some((r) => (r.content || []).some((c) => !cellIsSimple(c)));
  const headerRow = (rows[0].content || []).length > 0 && (rows[0].content || []).every((c) => c.type === "tableHeader");

  if (merged) lossy.add(LOSSY.mergedCells);
  if (rich) lossy.add(LOSSY.richCells);
  if (!headerRow) lossy.add(LOSSY.headerlessTable);
  // A GFM pipe table has no way to express any of the three, so the whole table goes HTML.
  if (merged || rich || !headerRow) return htmlTable(node, lossy, images);

  const width = Math.max(...rows.map((r) => (r.content || []).length));
  const cells = (row) => {
    const c = (row.content || []).map((x) => cellText(x, lossy));
    while (c.length < width) c.push("");
    return c;
  };
  // NOTE: cellText already ran escapeText, which escapes `|`. Do NOT escape it again here.
  const line = (c) => `| ${c.join(" | ")} |`;
  const out = [line(cells(rows[0])), `| ${Array.from({ length: width }, () => "---").join(" | ")} |`];
  for (const r of rows.slice(1)) out.push(line(cells(r)));
  return out.join("\n");
}

/* ---- blocks ------------------------------------------------------------------------ */

function listBlock(node, lossy, depth, ordered, images) {
  const pad = "  ".repeat(depth);
  const out = [];
  let n = Number(node.attrs?.start || 1);
  for (const item of node.content || []) {
    const marker = ordered ? `${n++}. ` : "- ";
    const inner = (item.content || []);
    const first = inner[0];
    const head = first?.type === "paragraph" ? inline(first.content, lossy) : blocks(first ? [first] : [], lossy, depth, images).trim();
    out.push(`${pad}${marker}${head}`);
    for (const rest of inner.slice(1)) {
      const sub = blocks([rest], lossy, depth + 1, images).replace(/\n+$/, "");
      if (sub) out.push(sub);
    }
  }
  return out.join("\n");
}

function taskBlock(node, lossy, depth, images) {
  const pad = "  ".repeat(depth);
  const out = [];
  for (const item of node.content || []) {
    const box = item.attrs?.checked ? "[x]" : "[ ]";
    const inner = item.content || [];
    const first = inner[0];
    const head = first?.type === "paragraph" ? inline(first.content, lossy) : "";
    out.push(`${pad}- ${box} ${head}`.trimEnd());
    for (const rest of inner.slice(1)) {
      const sub = blocks([rest], lossy, depth + 1, images).replace(/\n+$/, "");
      if (sub) out.push(sub);
    }
  }
  return out.join("\n");
}

/** Alignment is not expressible in Markdown at all, so an aligned block becomes an HTML
 *  wrapper. Only non-default alignments pay that cost. */
function alignWrap(node, md, lossy, tag) {
  const a = node.attrs?.textAlign;
  if (!a || a === "left") return md;
  lossy.add(LOSSY.align);
  return `<${tag} style="text-align:${attr(a)}">${md}</${tag}>`;
}

function blocks(nodes, lossy, depth = 0, images = null) {
  const out = [];
  for (const node of nodes || []) {
    if (!node || typeof node !== "object") continue;
    switch (node.type) {
      case "paragraph": {
        const md = inline(node.content, lossy);
        out.push(alignWrap(node, md, lossy, "p"));
        break;
      }
      case "heading": {
        const lvl = Math.min(6, Math.max(1, Number(node.attrs?.level || 1)));
        const md = inline(node.content, lossy);
        const a = node.attrs?.textAlign;
        if (a && a !== "left") { lossy.add(LOSSY.align); out.push(`<h${lvl} style="text-align:${attr(a)}">${md}</h${lvl}>`); }
        else out.push(`${"#".repeat(lvl)} ${md}`);
        break;
      }
      case "bulletList": out.push(listBlock(node, lossy, depth, false, images)); break;
      case "orderedList": out.push(listBlock(node, lossy, depth, true, images)); break;
      case "taskList": out.push(taskBlock(node, lossy, depth, images)); break;
      case "blockquote": {
        const inner = blocks(node.content, lossy, depth, images).split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
        out.push(inner);
        break;
      }
      case "codeBlock": {
        const lang = node.attrs?.language || "";
        const text = (node.content || []).map((c) => c.text || "").join("");
        out.push(`\`\`\`${lang}\n${text}\n\`\`\``);
        break;
      }
      case "horizontalRule": out.push("---"); break;
      case "noteImage": out.push(imageMd(node, lossy, images)); break;
      case "noteSketch": out.push(sketchMd(node, lossy)); break;
      case "table": out.push(table(node, lossy, images)); break;
      case "hardBreak": out.push(""); break;
      default: {
        // An unmodelled block still contributes its content rather than vanishing.
        if (node.content) out.push(blocks(node.content, lossy, depth, images));
        else if (node.text) out.push(escapeText(node.text));
      }
    }
  }
  return out.filter((s) => s !== "").join("\n\n");
}

/* ---- public API --------------------------------------------------------------------- */

/** One page's document model → `{ markdown, lossy }`.
 *  `lossy` is the list of constructs that needed an HTML fallback — the UI names them
 *  after an export so the gap is stated, not discovered later in another app. */
export function docToMarkdown(doc, { title = "", images = null } = {}) {
  const lossy = new Set();
  const body = blocks(doc?.content, lossy, 0, images);
  const head = title ? `# ${escapeText(title)}\n\n` : "";
  return { markdown: `${head}${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", lossy: [...lossy] };
}

/** A whole notebook → one Markdown document, sections as `##`, pages as `###`.
 *  `bodies` maps pageId → document model (a missing body exports as an empty page,
 *  never as a thrown error mid-export). */
export function notebookToMarkdown(notebook, bodies = {}, { images = null } = {}) {
  const lossy = new Set();
  const parts = [`# ${escapeText(notebook?.title || "Notebook")}`];
  for (const sec of notebook?.sections || []) {
    parts.push(`## ${escapeText(sec.title || "Section")}`);
    for (const pg of sec.pages || []) {
      parts.push(`### ${escapeText(pg.title || "Page")}`);
      const body = blocks(bodies[pg.id]?.content, lossy, 0, images);
      if (body) parts.push(body);
    }
  }
  return { markdown: `${parts.join("\n\n")}\n`.replace(/\n{3,}/g, "\n\n"), lossy: [...lossy] };
}

/** Flatten a document model to plain text — what body SEARCH matches against.
 *  Block boundaries become newlines so a phrase can't be stitched across two paragraphs. */
export function docToText(doc) {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && n.text) { out.push(n.text); return; }
    if (n.type === "hardBreak") { out.push("\n"); return; }
    /* A sketch's words live in its ATTRIBUTES, not in child text nodes, so a plain walk
     * would make every box on it invisible to search — a note whose whole content was a
     * sketch would be unfindable by anything written on it. */
    if (n.type === "noteSketch") {
      for (const box of Array.isArray(n.attrs?.outline) ? n.attrs.outline : []) {
        if (box?.label) out.push(`${box.label}\n`);
        if (box?.body) out.push(`${box.body}\n`);
      }
      return;
    }
    const block = n.type && n.type !== "doc" && n.type !== "text";
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (block) out.push("\n");
  };
  walk(doc);
  return out.join("").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
}

/** A filesystem-safe download name. Strips path separators and reserved characters,
 *  collapses whitespace, and never returns an empty stem. */
export function safeFileName(title, ext = "md") {
  const stem = String(title || "")
    .replace(/[\\/:*?"<>| -]/g, " ")
    .replace(/\s+/g, " ")
    // Leading dots go AFTER the separators are flattened, and the class includes whitespace
    // so "../../etc" (which flattens to ".. .. etc") loses EVERY leading run, not just the
    // first. Stripping before the flatten left a ".." on the front of the download name.
    .replace(/^[.\s]+/, "")
    .slice(0, 80)
    .trim();
  return `${stem || "note"}.${ext}`;
}

/** Plain-English sentence naming what an export could not carry, or "" when nothing was
 *  lost. LOUD-FAILURE's quieter cousin: a lossy export must say so. */
export function lossyNote(lossy) {
  if (!lossy || !lossy.length) return "";
  const list = lossy.length === 1 ? lossy[0] : `${lossy.slice(0, -1).join(", ")} and ${lossy[lossy.length - 1]}`;
  return `Markdown can't carry ${list} — exported as HTML so it still displays.`;
}
