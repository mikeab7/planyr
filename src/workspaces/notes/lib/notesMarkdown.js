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
/* The ONE import here, and it is deliberately the smallest thing in the module: how an
 * attached file is described in words. It is its own file precisely so this one — which is
 * on the Notes route's STATIC path — can name a file without reaching into
 * lib/notesAttachNode.js, which imports the editor engine. */
import { attachmentLabel } from "./notesFileMeta.js";
import { readIndent } from "./notesIndentLevel.js";
import { sortTopLevelForReading } from "./notesReadingOrder.js";

/* The node and mark names this exporter handles. test/notesModule.test.js asserts this
 * covers everything lib/notesExtensions.js lets into a document — so adding an extension
 * without teaching the exporter about it fails the build rather than silently exporting
 * a blank. */
export const NOTE_MD_HANDLED = {
  nodes: ["doc", "paragraph", "text", "heading", "bulletList", "orderedList", "listItem",
    "taskList", "taskItem", "blockquote", "codeBlock", "horizontalRule", "hardBreak",
    "table", "tableRow", "tableHeader", "tableCell", "noteImage",
    "noteAttachment", "noteCallout", "noteToggle", "noteToggleTitle", "noteAnchor"],
  marks: ["bold", "italic", "strike", "code", "underline", "link", "textStyle", "highlight",
    "superscript", "subscript"],
};

/* Human-readable names for the lossiness report — what the user sees, not node names. */
const LOSSY = {
  underline: "underlined text",
  superscript: "superscript text",
  subscript: "subscript text",
  highlight: "highlighted text",
  color: "text colour",
  fontSize: "font size",
  fontFamily: "font family",
  align: "text alignment",
  mergedCells: "merged table cells",
  richCells: "tables with multi-paragraph cells",
  headerlessTable: "tables with no header row",
  missingImage: "an image whose stored copy has gone",
  missingAttachment: "an attached file whose stored copy has gone",
  largeAttachment: "attached files too large to embed (named, not included)",
};

/* An attachment is embedded as a data URL up to here and merely NAMED beyond it. The cost
 * of getting this wrong runs one way only: a 40 MB DWG base64'd into a `.md` produces a
 * file no editor will open, which is worse than a line of text saying what the file was and
 * how big. Named-not-embedded is reported as lossy, so it is a stated gap either way. */
export const MD_INLINE_ATTACHMENT_MAX = 2 * 1024 * 1024;

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

/** Every ATTACHED FILE id a document references, in document order, de-duplicated. Its own
 *  function rather than a flag on `imageIdsInDoc` because the two are asked for different
 *  reasons: pictures are always inlined into an export, attachments only up to a size. */
export function attachmentIdsInDoc(doc) {
  const out = [];
  const seen = new Set();
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAttachment") {
      const id = n.attrs?.fileId;
      if (id && !seen.has(id)) { seen.add(id); out.push(id); }
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}

/** Every STORED BLOB a document owns — pictures and attached files together.
 *
 *  ⛔ THIS IS WHAT THE PURGE AND THE ORPHAN SWEEP MUST USE (TOMBSTONE-DELETES). A cascade
 *  that asked only for image ids would leave a deleted page's attachments on the device and
 *  in the account forever: bytes nothing can reach and nothing will ever free. Adding a new
 *  kind of stored blob means adding it HERE, not only to its own accessor. */
export function assetIdsInDoc(doc) {
  return [...imageIdsInDoc(doc), ...attachmentIdsInDoc(doc)];
}

/** The same document with every stored-blob reference re-pointed through `idMap`
 *  (old asset id → new asset id) — the pictures AND the attached files, i.e. exactly the set
 *  `assetIdsInDoc` reports. A new copy, never an edit in place; an id with no entry in the
 *  map is left as it was.
 *
 *  ⛔ WHY A COPIED PAGE MAY NEVER SHARE A PICTURE WITH ITS SOURCE ("Copy a notebook", NEW-1).
 *  The purge clears every asset its page's body references, and the orphan sweep clears an
 *  asset whose OWNING page is gone. Two pages pointing at one id means deleting either one
 *  forever silently breaks the picture in the other. So a copy owns its own bytes, under its
 *  own ids — and a new kind of stored blob added to `assetIdsInDoc` must be added HERE too. */
export function remapAssetIds(doc, idMap) {
  const map = idMap instanceof Map ? idMap : new Map(Object.entries(idMap || {}));
  const walk = (n) => {
    if (!n || typeof n !== "object") return n;
    let out = n;
    const key = n.type === "noteImage" ? "imageId" : n.type === "noteAttachment" ? "fileId" : null;
    if (key && n.attrs?.[key] && map.has(n.attrs[key])) {
      out = { ...n, attrs: { ...n.attrs, [key]: map.get(n.attrs[key]) } };
    }
    if (Array.isArray(n.content)) out = { ...out, content: n.content.map(walk) };
    return out;
  };
  return walk(doc);
}

/** Every image id across a whole map of `pageId → doc`. */
export function imageIdsInDocs(bodies) {
  const seen = new Set();
  for (const doc of Object.values(bodies || {})) for (const id of imageIdsInDoc(doc)) seen.add(id);
  return [...seen];
}

/** Every attached-file id across a whole map of `pageId → doc`. */
export function attachmentIdsInDocs(bodies) {
  const seen = new Set();
  for (const doc of Object.values(bodies || {})) for (const id of attachmentIdsInDoc(doc)) seen.add(id);
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

  /* ⛔ SUPERSCRIPT/SUBSCRIPT (NEW-4, toolbar rebuild, 2026-09-24) — the same HTML-fallback
   * shape `underline` already uses: Markdown has no native syntax for either, so `<sup>`/
   * `<sub>` is the honest export (readable as-is on GitHub and most renderers) and the
   * lossiness report names it, same as every other HTML-fallback construct here. */
  if (has("superscript")) { out = `<sup>${out}</sup>`; lossy.add(LOSSY.superscript); }
  if (has("subscript")) { out = `<sub>${out}</sub>`; lossy.add(LOSSY.subscript); }

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

/* ⛔ AN ITEM'S OWN LEVEL RIDES IN THE INDENTATION, WHICH IS HOW MARKDOWN SPELLS NESTING
 * ANYWAY — so this is not lossy and nothing joins the lossy list. `readIndent` returns 0 for
 * an item that was never indented, and 0 extra pad is byte-identical to the old output, which
 * is what makes an indent/outdent pair round-trip through the export unchanged. See
 * lib/notesListIndent.js. */
function listBlock(node, lossy, depth, ordered, images) {
  const out = [];
  let n = Number(node.attrs?.start || 1);
  for (const item of node.content || []) {
    const at = depth + readIndent(item.attrs);
    const pad = "  ".repeat(at);
    const marker = ordered ? `${n++}. ` : "- ";
    const inner = (item.content || []);
    const first = inner[0];
    const head = first?.type === "paragraph" ? inline(first.content, lossy) : blocks(first ? [first] : [], lossy, at, images).trim();
    out.push(`${pad}${marker}${head}`);
    for (const rest of inner.slice(1)) {
      const sub = blocks([rest], lossy, at + 1, images).replace(/\n+$/, "");
      if (sub) out.push(sub);
    }
  }
  return out.join("\n");
}

function taskBlock(node, lossy, depth, images) {
  const out = [];
  for (const item of node.content || []) {
    const at = depth + readIndent(item.attrs);          // the item's own level — see listBlock
    const pad = "  ".repeat(at);
    const box = item.attrs?.checked ? "[x]" : "[ ]";
    const inner = item.content || [];
    const first = inner[0];
    const head = first?.type === "paragraph" ? inline(first.content, lossy) : "";
    out.push(`${pad}- ${box} ${head}`.trimEnd());
    for (const rest of inner.slice(1)) {
      const sub = blocks([rest], lossy, at + 1, images).replace(/\n+$/, "");
      if (sub) out.push(sub);
    }
  }
  return out.join("\n");
}

/* ---- callouts, toggles and attachments (NEW-5 / NEW-7) --------------------------------
 *
 * ⛔ A CALLOUT IS **NOT** LOSSY, AND THAT IS WHY THE FIVE TONES ARE THE FIVE THEY ARE.
 * `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` is a real, rendered
 * construct in GitHub-flavoured Markdown, so the export is the same thing with a different
 * spelling rather than an approximation — no HTML fallback, nothing added to the lossy list.
 * A sixth tone would have no marker to map to; do not add one without deciding its fallback
 * first (lib/notesCalloutNode.js says the same thing from the other end).
 *
 * ⛔ A TOGGLE ALWAYS EXPORTS **OPEN**. Paper and a Markdown file have no disclosure
 * triangle, so a folded section written out folded is simply missing text — the worst class
 * of export bug, because nothing about the output looks wrong. `<details open>` renders
 * expanded everywhere and still collapses in viewers that support it.
 */
const CALLOUT_MD_MARKER = {
  info: "NOTE", tip: "TIP", important: "IMPORTANT", warning: "WARNING", danger: "CAUTION",
};

function calloutMd(node, lossy, depth, images) {
  const marker = CALLOUT_MD_MARKER[node.attrs?.tone] || CALLOUT_MD_MARKER.info;
  const inner = blocks(node.content, lossy, depth, images);
  const body = inner.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
  return `> [!${marker}]\n${body}`;
}

function toggleMd(node, lossy, depth, images) {
  const kids = node.content || [];
  const titleNode = kids.find((k) => k?.type === "noteToggleTitle");
  const rest = kids.filter((k) => k?.type !== "noteToggleTitle");
  const title = inline(titleNode?.content, lossy).trim() || "Details";
  const body = blocks(rest, lossy, depth, images);
  return `<details open>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
}

/** An attached file. Named ALWAYS; embedded when it is small enough to embed. Silence is
 *  the one thing this may never do — an export that drops a survey without a word is a
 *  document that looks complete and is not. */
function attachmentMd(node, lossy, images) {
  const label = escapeText(attachmentLabel({
    name: node.attrs?.name, mime: node.attrs?.mime, size: node.attrs?.size,
  }));
  const src = images?.[node.attrs?.fileId];
  if (!src) {
    lossy.add(Number(node.attrs?.size) > MD_INLINE_ATTACHMENT_MAX ? LOSSY.largeAttachment : LOSSY.missingAttachment);
    return `📎 **${label}** — attached file, not included in this export`;
  }
  return `📎 [${label}](${src})`;
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
      case "noteCallout": out.push(calloutMd(node, lossy, depth, images)); break;
      /* ⛔ AN ANCHORED BLOCK EXPORTS ITS WORDS, AND SAYS THE PLACEMENT DID NOT SURVIVE
       * (NEW-2). Markdown has no way to say "this sits here on the page", so the honest
       * thing is to carry the text and NAME the loss — the same contract every other
       * construct here has. Silently exporting it as an ordinary paragraph would make the
       * Markdown claim to be a faithful copy when it is not. */
      case "noteAnchor": {
        lossy.add("a block placed at a point on the page (its position)");
        out.push(blocks(node.content, lossy, depth, images));
        break;
      }
      case "noteToggle": out.push(toggleMd(node, lossy, depth, images)); break;
      case "noteAttachment": out.push(attachmentMd(node, lossy, images)); break;
      case "noteImage": out.push(imageMd(node, lossy, images)); break;
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

/* ---- arrows between boxes (NEW-2) ------------------------------------------------------
 *
 * `doc.attrs.arrows` is a list of `{from,to}` box ids (lib/notesArrows.js) — not a node, so
 * it never goes through `blocks()`. A box has no short "label" field any more (it holds
 * arbitrary rich content), so the reference used here is the box's own flattened text,
 * trimmed short; an untitled box still reports its id rather than being silently dropped
 * from the list — the same "content never vanishes" contract the old sketch export had. */
const ARROW_LABEL_MAX = 40;
function shortBoxLabel(node) {
  const text = docToText({ type: "doc", content: node.content || [] }).replace(/\s+/g, " ").trim();
  if (!text) return "(empty box)";
  return text.length > ARROW_LABEL_MAX ? `${text.slice(0, ARROW_LABEL_MAX)}…` : text;
}

/** `doc` → a "Connected boxes:" section for every `{from,to}` arrow whose two ends are both
 *  TOP-LEVEL boxes in this document — a Markdown list has no drawing surface, so an arrow is
 *  written out as words rather than silently dropped (the same rule the old sketch export
 *  applied to what its own nesting could not express). Returns "" when there is nothing to
 *  report, so a document with no arrows exports exactly as it did before this existed. */
function arrowsMd(doc) {
  const arrows = Array.isArray(doc?.attrs?.arrows) ? doc.attrs.arrows : [];
  if (!arrows.length) return "";
  const labelOf = new Map();
  for (const n of Array.isArray(doc?.content) ? doc.content : []) {
    if (n?.type === "noteAnchor" && n.attrs?.aid) labelOf.set(String(n.attrs.aid), shortBoxLabel(n));
  }
  const named = arrows.filter((a) => labelOf.has(a?.from) && labelOf.has(a?.to));
  if (!named.length) return "";
  const out = ["Connected boxes:"];
  for (const a of named) out.push(`- ${escapeText(labelOf.get(a.from))} → ${escapeText(labelOf.get(a.to))}`);
  return out.join("\n");
}

/* ---- public API --------------------------------------------------------------------- */

/** One page's document model → `{ markdown, lossy }`.
 *  `lossy` is the list of constructs that needed an HTML fallback — the UI names them
 *  after an export so the gap is stated, not discovered later in another app. */
export function docToMarkdown(doc, { title = "", images = null } = {}) {
  const lossy = new Set();
  /* ⛔ READING ORDER, TOP LEVEL ONLY (NEW-1) — see notesReadingOrder.js's own header. A
   * one-box document (the common case, and every migrated flow-body page) sorts to itself
   * unchanged, which is what keeps a migration's Markdown export byte-identical. */
  const body = [blocks(sortTopLevelForReading(doc?.content), lossy, 0, images), arrowsMd(doc)]
    .filter(Boolean).join("\n\n");
  const head = title ? `# ${escapeText(title)}\n\n` : "";
  return { markdown: `${head}${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", lossy: [...lossy] };
}

/** A page and everything under it → one Markdown document (B1420).
 *
 *  ⛔ NESTING IS HEADING DEPTH, AND IT IS LOSSLESS FOR CONTENT. A top-level page is `#`, its
 *  subpages `##`, theirs `###`, and so on. Markdown runs out of heading levels at six, and a
 *  note tree does not — so past that depth the heading stays `######` and the page's place is
 *  carried by a **trail line** (`Grand Port › Entitlements › Bonding`) instead of being
 *  silently flattened. Depth is the ONLY thing that can degrade here; not one page, title or
 *  byte of body is ever dropped, which is what "losslessly for content" has to mean.
 *
 *  `bodies` maps pageId → document model (a missing body exports as an empty page, never as
 *  a thrown error mid-export). Named `pageToMarkdown`; the old `notebookToMarkdown` is gone
 *  along with the notebook it took. */
export const MD_MAX_HEADING = 6;

export function pageToMarkdown(page, bodies = {}, { images = null } = {}) {
  const lossy = new Set();
  const parts = [];
  const walk = (node, depth, trail) => {
    const level = Math.min(depth + 1, MD_MAX_HEADING);
    parts.push(`${"#".repeat(level)} ${escapeText(node?.title || "Page")}`);
    if (depth + 1 > MD_MAX_HEADING) {
      // Deeper than Markdown can spell. Say where it sits rather than let it read as a
      // sibling of the page six levels up.
      parts.push(`*${escapeText([...trail, node?.title || "Page"].join(" › "))}*`);
      lossy.add("how deeply a subpage is nested");
    }
    const body = blocks(sortTopLevelForReading(bodies[node?.id]?.content), lossy, 0, images);
    if (body) parts.push(body);
    const arrows = arrowsMd(bodies[node?.id]);
    if (arrows) parts.push(arrows);
    for (const kid of Array.isArray(node?.pages) ? node.pages : []) {
      walk(kid, depth + 1, [...trail, node?.title || "Page"]);
    }
  };
  walk(page, 0, []);
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
    /* An attachment's NAME is in its attributes, not in a child text node — so without
     * this a note whose survey PDF is the whole point could not be found by searching for
     * the survey's filename, which is exactly how anyone would look for it. */
    if (n.type === "noteAttachment") { if (n.attrs?.name) out.push(`${n.attrs.name}\n`); return; }
    /* A sketch's words live in its ATTRIBUTES, not in child text nodes, so a plain walk
     * would make every box on it invisible to search — a note whose whole content was a
     * sketch would be unfindable by anything written on it. */
    if (n.type === "noteSketch") {
      const boxes = Array.isArray(n.attrs?.boxes) && n.attrs.boxes.length
        ? n.attrs.boxes
        : Array.isArray(n.attrs?.outline) ? n.attrs.outline : [];   // the superseded shape
      for (const box of boxes) {
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
