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
    "table", "tableRow", "tableHeader", "tableCell"],
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
};

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
function htmlTable(node, lossy) {
  const rows = (node.content || []).filter((r) => r.type === "tableRow");
  const lines = ["<table>"];
  for (const row of rows) {
    lines.push("  <tr>");
    for (const cell of row.content || []) {
      const tag = cell.type === "tableHeader" ? "th" : "td";
      const { cs, rs } = spans(cell);
      const a = `${cs > 1 ? ` colspan="${cs}"` : ""}${rs > 1 ? ` rowspan="${rs}"` : ""}`;
      // Cell bodies may be several blocks; render each as its own paragraph-ish line.
      const body = (cell.content || []).map((b) => (b.type === "paragraph" ? inline(b.content, lossy, { inTableCell: true }) : blocks([b], lossy).trim().replace(/\n/g, "<br>"))).filter(Boolean).join("<br>");
      lines.push(`    <${tag}${a}>${body}</${tag}>`);
    }
    lines.push("  </tr>");
  }
  lines.push("</table>");
  return lines.join("\n");
}

function table(node, lossy) {
  const rows = (node.content || []).filter((r) => r.type === "tableRow");
  if (!rows.length) return "";

  const merged = rows.some((r) => (r.content || []).some((c) => { const { cs, rs } = spans(c); return cs > 1 || rs > 1; }));
  const rich = rows.some((r) => (r.content || []).some((c) => !cellIsSimple(c)));
  const headerRow = (rows[0].content || []).length > 0 && (rows[0].content || []).every((c) => c.type === "tableHeader");

  if (merged) lossy.add(LOSSY.mergedCells);
  if (rich) lossy.add(LOSSY.richCells);
  if (!headerRow) lossy.add(LOSSY.headerlessTable);
  // A GFM pipe table has no way to express any of the three, so the whole table goes HTML.
  if (merged || rich || !headerRow) return htmlTable(node, lossy);

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

function listBlock(node, lossy, depth, ordered) {
  const pad = "  ".repeat(depth);
  const out = [];
  let n = Number(node.attrs?.start || 1);
  for (const item of node.content || []) {
    const marker = ordered ? `${n++}. ` : "- ";
    const inner = (item.content || []);
    const first = inner[0];
    const head = first?.type === "paragraph" ? inline(first.content, lossy) : blocks(first ? [first] : [], lossy, depth).trim();
    out.push(`${pad}${marker}${head}`);
    for (const rest of inner.slice(1)) {
      const sub = blocks([rest], lossy, depth + 1).replace(/\n+$/, "");
      if (sub) out.push(sub);
    }
  }
  return out.join("\n");
}

function taskBlock(node, lossy, depth) {
  const pad = "  ".repeat(depth);
  const out = [];
  for (const item of node.content || []) {
    const box = item.attrs?.checked ? "[x]" : "[ ]";
    const inner = item.content || [];
    const first = inner[0];
    const head = first?.type === "paragraph" ? inline(first.content, lossy) : "";
    out.push(`${pad}- ${box} ${head}`.trimEnd());
    for (const rest of inner.slice(1)) {
      const sub = blocks([rest], lossy, depth + 1).replace(/\n+$/, "");
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

function blocks(nodes, lossy, depth = 0) {
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
      case "bulletList": out.push(listBlock(node, lossy, depth, false)); break;
      case "orderedList": out.push(listBlock(node, lossy, depth, true)); break;
      case "taskList": out.push(taskBlock(node, lossy, depth)); break;
      case "blockquote": {
        const inner = blocks(node.content, lossy, depth).split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n");
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
      case "table": out.push(table(node, lossy)); break;
      case "hardBreak": out.push(""); break;
      default: {
        // An unmodelled block still contributes its content rather than vanishing.
        if (node.content) out.push(blocks(node.content, lossy, depth));
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
export function docToMarkdown(doc, { title = "" } = {}) {
  const lossy = new Set();
  const body = blocks(doc?.content, lossy);
  const head = title ? `# ${escapeText(title)}\n\n` : "";
  return { markdown: `${head}${body}`.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", lossy: [...lossy] };
}

/** A whole notebook → one Markdown document, sections as `##`, pages as `###`.
 *  `bodies` maps pageId → document model (a missing body exports as an empty page,
 *  never as a thrown error mid-export). */
export function notebookToMarkdown(notebook, bodies = {}) {
  const lossy = new Set();
  const parts = [`# ${escapeText(notebook?.title || "Notebook")}`];
  for (const sec of notebook?.sections || []) {
    parts.push(`## ${escapeText(sec.title || "Section")}`);
    for (const pg of sec.pages || []) {
      parts.push(`### ${escapeText(pg.title || "Page")}`);
      const body = blocks(bodies[pg.id]?.content, lossy);
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
