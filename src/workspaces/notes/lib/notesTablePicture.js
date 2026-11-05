/* notesTablePicture — "PASTE AS PICTURE" FOR A TABLE (Excel's Paste Options ▸ Picture, NEW-1).
 *
 * A pasted table becomes a NON-EDITABLE IMAGE of itself, placed in a box. The image is made here, in the browser, from the
 * table node the paste landed: serialise it with the editor's own DOMSerializer (so what is drawn is what the editor holds —
 * text marks, header cells, merged cells, the cell fills), lay it out in a hidden element on a white "paper" (so the GEOMETRY —
 * where every cell, border and line of text falls — is the browser's own), then DRAW that geometry onto a canvas at twice the
 * size: the cell fills and rules as rectangles, every line of text where the layout put it, in the font, weight, style and
 * colour it was laid out in. The PNG goes through the same intake every other picture in a note uses (downscale ceiling,
 * storage tier, purge cascade — notesImageIntake.js / notesStore.js). Nothing new is stored in the document: a `noteImage`
 * node holding an id, exactly as a pasted screenshot would.
 *
 * ⛔ WHY NOT SVG `<foreignObject>`, WHICH IS THE SHORTER WAY. Drawing HTML through a `<foreignObject>` and then onto a canvas
 * is the well-known trick, and it is where Safari / WebKit TAINTS the canvas — `toBlob` then throws and no picture comes out. A
 * Notes user is as likely to be on an iPhone as a PC, and this sandbox cannot install WebKit to find out, so the path that
 * cannot be proven on every engine is not the path used: reading layout rectangles and drawing them has no tainting step at all.
 *
 * ⛔ THE PICTURE IS DRAWN ON PAPER, NOT ON THE THEME. Light page, dark ink, a grey hairline between cells — the same
 * treatment as the print sheet (notesPrint.js), so a table pasted as a picture reads the same in the light and the
 * dark theme and prints the same. That is why this file carries literal colours: it is a drawing surface (an export),
 * not chrome, and sits on the design audit's drawing-surface list beside notesPrint.js.
 *
 * DOM-side (canvas, Range) and reached only from the editor chunk, on demand, when someone picks Picture. Never throws: every
 * failure comes back as `{ ok:false, error }` carrying a sentence a person can read (LOUD-FAILURE) — a table too large to draw,
 * a canvas the browser refuses to export.
 */
import { DOMSerializer } from "@tiptap/pm/model";
import { prepareNoteImage } from "./notesImageIntake.js";

/** The largest a table's picture may be, CSS px per side, before the render is refused rather than attempted — a
 *  200-row spreadsheet is not a picture, and a canvas that large fails in browser-specific ways. */
export const TABLE_PICTURE_MAX_SIDE = 4000;
const SCALE = 2;

const PAPER_CSS = [
  ".pt{display:inline-block;box-sizing:border-box;padding:6px;background:#ffffff;color:#1b1e26;font:14px/1.45 -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif}",
  ".pt table{border-collapse:collapse;table-layout:auto;margin:0}",
  ".pt td,.pt th{border:1px solid #9aa1ac;padding:5px 9px;vertical-align:top;text-align:left;min-width:48px}",
  ".pt th{background:#eef1f5;font-weight:650}",
  ".pt p{margin:0}",
  ".pt ul,.pt ol{margin:0;padding-left:1.3em}",
  ".pt a{color:#1d4ed8;text-decoration:underline}",
].join("");
const RULE = "#9aa1ac";

/** The picture's markup: a `.pt` paper wrapper holding the serialised table. */
function paperFor(tableNode, schema, doc) {
  const wrap = doc.createElement("div");
  wrap.className = "pt";
  const style = doc.createElement("style");
  style.textContent = PAPER_CSS;
  wrap.appendChild(style);
  wrap.appendChild(DOMSerializer.fromSchema(schema).serializeNode(tableNode, { document: doc }));
  return wrap;
}

const transparent = (c) => !c || c === "transparent" || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(c);

/** One line of text as the layout put it: the characters of a text node grouped by the line they fell on. */
function textLines(node, doc) {
  const lines = [];
  const range = doc.createRange();
  const text = node.nodeValue || "";
  for (let i = 0; i < text.length; i += 1) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const r = range.getClientRects()[0];
    if (!r || !r.width) continue;                     // collapsed whitespace has no box
    const last = lines[lines.length - 1];
    if (last && Math.abs(r.top - last.top) < r.height * 0.5) { last.text += text[i]; last.right = r.right; }
    else lines.push({ text: text[i], left: r.left, right: r.right, top: r.top, height: r.height });
  }
  return lines;
}

/** Paint the laid-out paper onto a 2D context: cell fills, cell rules, then every line of text. Coordinates are
 *  the layout's own, relative to the paper's top-left. */
function paintPaper(ctx, paper, doc) {
  const origin = paper.getBoundingClientRect();
  const X = (v) => v - origin.left;
  const Y = (v) => v - origin.top;
  const view = doc.defaultView;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, origin.width, origin.height);
  for (const cell of paper.querySelectorAll("td,th")) {
    const r = cell.getBoundingClientRect();
    const bg = view.getComputedStyle(cell).backgroundColor;
    if (!transparent(bg)) { ctx.fillStyle = bg; ctx.fillRect(X(r.left), Y(r.top), r.width, r.height); }
  }
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  for (const cell of paper.querySelectorAll("td,th")) {
    const r = cell.getBoundingClientRect();
    /* On the cell's own edge, not inset: with collapsed borders two neighbours share an edge, and a rule drawn inside each
     * would be two lines a pixel apart (measured: a doubled hairline between every pair of columns). */
    ctx.strokeRect(X(r.left), Y(r.top), r.width, r.height);
  }
  const walker = doc.createTreeWalker(paper, 4 /* NodeFilter.SHOW_TEXT */);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    if (!parent || parent.tagName === "STYLE" || !(n.nodeValue || "").trim()) continue;
    const cs = view.getComputedStyle(parent);
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.textBaseline = "alphabetic";
    const ascent = ctx.measureText("Hg").fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
    const highlight = !transparent(cs.backgroundColor) && !/^(TD|TH)$/.test(parent.tagName);
    const underline = /underline/.test(cs.textDecorationLine || "");
    for (const line of textLines(n, doc)) {
      if (highlight) { ctx.fillStyle = cs.backgroundColor; ctx.fillRect(X(line.left), Y(line.top), line.right - line.left, line.height); }
      ctx.fillStyle = cs.color;
      ctx.fillText(line.text, X(line.left), Y(line.top) + ascent);
      if (underline) { ctx.fillRect(X(line.left), Y(line.top) + ascent + 1.5, line.right - line.left, 1); }
    }
  }
}

/** Draw `tableNode` to a PNG `File` and return `{ ok, file, cssW, cssH }` (the size it was drawn at in CSS px, so the box
 *  can match it), or `{ ok:false, error }`. `schema` is the editor's own. */
export async function renderTableToPng(tableNode, schema, { doc = document } = {}) {
  let host = null;
  try {
    host = doc.createElement("div");
    host.style.cssText = "position:fixed;left:-20000px;top:0;visibility:hidden;pointer-events:none;";
    const paper = paperFor(tableNode, schema, doc);
    host.appendChild(paper);
    doc.body.appendChild(host);
    const r = paper.getBoundingClientRect();
    const cssW = Math.ceil(r.width);
    const cssH = Math.ceil(r.height);
    if (!cssW || !cssH) return { ok: false, error: "That table has nothing to draw, so no picture was made." };
    if (cssW > TABLE_PICTURE_MAX_SIDE || cssH > TABLE_PICTURE_MAX_SIDE) {
      return { ok: false, error: "That table is too large to turn into a picture. Paste it as a table, or copy a smaller range." };
    }
    const canvas = doc.createElement("canvas");
    canvas.width = cssW * SCALE;
    canvas.height = cssH * SCALE;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) return { ok: false, error: "Your browser could not draw that table as a picture." };
      ctx.scale(SCALE, SCALE);
      paintPaper(ctx, paper, doc);
      const blob = await new Promise((resolve) => { try { canvas.toBlob(resolve, "image/png"); } catch (_) { resolve(null); } });
      if (!blob) return { ok: false, error: "Your browser would not save that table as a picture." };
      return { ok: true, file: new File([blob], "Pasted table.png", { type: "image/png" }), cssW, cssH };
    } finally {
      try { canvas.width = 0; canvas.height = 0; } catch (_) { /* already gone */ }
    }
  } catch (e) {
    return { ok: false, error: "That table could not be turned into a picture." };
  } finally {
    try { host?.remove(); } catch (_) { /* nothing to clean */ }
  }
}

/** A table node → a prepared, storable picture: `{ ok, prepared, cssW, cssH }` (see notesImageIntake `prepareNoteImage`). */
export async function prepareTablePicture(tableNode, schema, opts) {
  const drawn = await renderTableToPng(tableNode, schema, opts);
  if (!drawn.ok) return drawn;
  const prepared = await prepareNoteImage(drawn.file);
  if (!prepared.ok) return { ok: false, error: prepared.error };
  return { ok: true, prepared, cssW: drawn.cssW, cssH: drawn.cssH };
}
