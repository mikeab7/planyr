/* Word FORMATTING-change records (Track Changes' "Formatted: …" balloons) — the pure-XML side.
 *
 * Word records a formatting change as a `…PrChange` element sitting inside the property block it
 * changed, holding the OLD properties:
 *     run         <w:rPr> …new… <w:rPrChange w:id w:author w:date><w:rPr>…old…</w:rPr></w:rPrChange></w:rPr>
 *     paragraph   <w:pPr> …new… <w:pPrChange …><w:pPr>…old…</w:pPr></w:pPrChange></w:pPr>
 *     table / row / cell / grid / section / paragraph mark — the same shape (tblPrChange, trPrChange,
 *     tcPrChange, tblGridChange, sectPrChange, and an rPrChange inside the paragraph-mark rPr).
 * Nothing here is invented: the editor keeps the old block VERBATIM (so an un-acted change is written
 * back exactly as read) and only these helpers ever interpret it — to label it, to accept it (drop the
 * record; the new formatting stays) or to reject it (put the old block back). */
import { parseXml, serializeXml, el, kids, find } from "./xml.js";
import { rPrMarks } from "./rprMarks.js";

const frag = (s) => (s ? kids(parseXml(`<x>${s}</x>`)) : []);
const ser = (nodes) => nodes.map(serializeXml).join("");
export const kidsXml = (node) => (node ? ser(kids(node)) : "");
export const changeMeta = (n) => ({ id: String(n.attrs["w:id"] || ""), author: n.attrs["w:author"] || "", date: n.attrs["w:date"] || "" });

/* ---------- run formatting ---------- */
export const FORMAT_MARKS = ["bold", "italic", "underline", "strike", "superscript", "subscript", "textStyle", "highlight"];

/** `<w:rPrChange>` → the XML of its OLD run properties (verbatim children of the inner rPr). */
export const oldRunProps = (change) => kidsXml(find(change, "w:rPr"));

/** Old run properties (verbatim XML) → editor marks `[{type, attrs?}]`. */
export function oldRunMarks(oldXml) {
  try { return rPrMarks(parseXml(`<w:rPr>${oldXml || ""}</w:rPr>`)); } catch { return []; }
}

const FLAG_NAMES = { bold: "Bold", italic: "Italic", underline: "Underline", strike: "Strikethrough", superscript: "Superscript", subscript: "Subscript" };
const style = (ms) => { const m = ms.find((x) => x.type === "textStyle"); return (m && m.attrs) || {}; };

/** "Formatted: Bold" / "Formatted: Not bold, Font size" — what changed between the old marks and the current ones. */
export function runLabel(oldXml, curMarks) {
  const o = oldRunMarks(oldXml);
  const c = (curMarks || []).map((m) => ({ type: m.type.name || m.type, attrs: m.attrs }));
  const has = (ms, t) => ms.some((m) => m.type === t);
  const parts = [];
  for (const [t, name] of Object.entries(FLAG_NAMES)) {
    const a = has(o, t), b = has(c, t);
    if (!a && b) parts.push(name); else if (a && !b) parts.push(`Not ${name.toLowerCase()}`);
  }
  if (has(o, "highlight") !== has(c, "highlight")) parts.push(has(c, "highlight") ? "Highlight" : "No highlight");
  const so = style(o), sc = style(c);
  if ((so.color || null) !== (sc.color || null)) parts.push("Font color");
  if ((so.fontSize || null) !== (sc.fontSize || null)) parts.push("Font size");
  if ((so.fontFamily || null) !== (sc.fontFamily || null)) parts.push("Font");
  return `Formatted: ${parts.length ? parts.join(", ") : "character formatting"}`;
}

/* ---------- paragraph formatting (pPrChange) ---------- */
/** What the paragraph looked like BEFORE: `{ level, pStyle, textAlign, pprx, num }` (num = it was a list item). */
export function paraLabel(old, cur, inList) {
  const parts = [];
  if ((old.level || null) !== (cur.level || null) || (old.pStyle || null) !== (cur.pStyle || null)) parts.push("paragraph style");
  if ((old.textAlign || "left") !== (cur.textAlign || "left")) parts.push("alignment");
  const strip = (x) => ser(frag(x).filter((n) => n.name !== "w:rPr" && n.name !== "w:sectPr"));
  if (strip(old.pprx) !== strip(cur.pprx)) parts.push("indent / spacing");
  if (!!old.num !== !!inList) parts.push("bullets / numbering");
  return `Formatted: ${parts.length ? parts.join(", ") : "paragraph"}`;
}

/** Restoring old paragraph properties keeps the current paragraph-mark rPr and section break (they are not part of pPrChange). */
export function restorePprx(oldPprx, curPprx) {
  const keep = frag(curPprx).filter((n) => n.name === "w:rPr" || n.name === "w:sectPr");
  return ser([...frag(oldPprx), ...keep]);
}

/* ---------- property blocks held as XML strings on a node attr ---------- */
const SCOPES = {
  table: { attr: "tblpr", nodes: ["table"], change: "w:tblPrChange", inner: "w:tblPr", label: "Formatted: Table" },
  row: { attr: "trpr", nodes: ["tableRow"], change: "w:trPrChange", inner: "w:trPr", label: "Formatted: Table row", keepCurrent: ["w:ins", "w:del"] },
  cell: { attr: "tcpr", nodes: ["tableCell", "tableHeader"], change: "w:tcPrChange", inner: "w:tcPr", label: "Formatted: Table cell", dropOld: ["w:gridSpan", "w:vMerge"] },
  mark: { attr: "pprx", nodes: ["paragraph", "heading"], container: "w:rPr", change: "w:rPrChange", inner: "w:rPr", label: "Formatted: Paragraph mark", dropEmpty: true },
  section: { attr: "pprx", nodes: ["paragraph", "heading"], container: "w:sectPr", change: "w:sectPrChange", inner: "w:sectPr", label: "Formatted: Section", keepCurrent: ["w:headerReference", "w:footerReference"] },
};
export const ATTR_SCOPES = SCOPES;

function locate(def, xml) {
  const nodes = frag(xml);
  const holder = def.container ? nodes.find((n) => n.name === def.container) || null : null;
  const list = def.container ? (holder ? kids(holder) : []) : nodes;
  const change = list.find((c) => c.name === def.change) || null;
  return { nodes, holder, list, change };
}

/** `{ id, author, date }` when this XML string carries a change record of the scope, else null. */
export function attrChangeInfo(scope, xml) {
  const def = SCOPES[scope];
  if (!def || typeof xml !== "string" || !xml.includes(def.change)) return null;
  const { change } = locate(def, xml);
  return change ? changeMeta(change) : null;
}

/** Accept: drop the record; the current properties stay. Reject: put the old properties back. → new XML string. */
export function resolveAttrChange(scope, xml, accept) {
  const def = SCOPES[scope];
  const { nodes, holder, list, change } = locate(def, xml);
  if (!def || !change) return xml;
  const setList = (next) => { if (def.container) { holder.children = next; if (def.dropEmpty && !next.length) return ser(nodes.filter((n) => n !== holder)); } return def.container ? ser(nodes) : ser(next); };
  if (accept) return setList(list.filter((c) => c !== change));
  const old = kids(find(change, def.inner) || el(def.inner)).filter((c) => !(def.dropOld || []).includes(c.name));
  const keep = list.filter((c) => c !== change && (def.keepCurrent || []).includes(c.name));
  return setList([...old, ...keep]);
}

/* ---------- table grid (tblGridChange) ---------- */
const gridOf = (xml) => { const ch = frag(xml)[0]; return ch && ch.name === "w:tblGridChange" ? ch : null; };
export const gridChangeInfo = (xml) => { const g = gridOf(xml); return g ? changeMeta(g) : null; };
/** Old column widths (twips) from a tblGridChange record. */
export function oldGridCols(xml) {
  const g = gridOf(xml); const grid = g && find(g, "w:tblGrid");
  return grid ? kids(grid).filter((c) => c.name === "w:gridCol").map((c) => Number(c.attrs["w:w"] || 0)) : [];
}

/* ---------- the document's final section (meta.sectPr) ---------- */
export function sectChanges(sectPrXml) {
  const info = attrChangeInfo("section", `<w:sectPr>${sectPrXml ? kidsXml(parseXml(sectPrXml)) : ""}</w:sectPr>`);
  return info ? [{ key: `fmt:docsection:${info.id}`, kind: "fmt", scope: "docsection", ids: [`docsection:${info.id}`], ...info, text: "", label: SCOPES.section.label, meta: true }] : [];
}
export function resolveSect(sectPrXml, accept) {
  if (!sectPrXml) return sectPrXml;
  const root = parseXml(sectPrXml);
  const out = resolveAttrChange("section", `<w:sectPr>${kidsXml(root)}</w:sectPr>`, accept);
  const inner = frag(out)[0];
  return serializeXml({ ...root, children: inner ? inner.children : [] });
}

/* ---------- what we could not surface ---------- */
const ANY_CHANGE = /<w:(rPr|pPr|tblPr|tcPr|trPr|sectPr|tblGrid|numbering)Change\b/g;
/** Formatting-change records that live where the editor shows no editable text (images, fields, boxes in the
 * body; headers, footers, notes, list definitions). They are written back untouched but not listed. */
export function keptUnshownCount(doc, files) {
  let n = 0;
  const walk = (node) => {
    if (!node) return;
    if ((node.type === "docRaw" || node.type === "docRawBlock" || node.type === "docImage") && node.attrs && node.attrs.xml) n += (node.attrs.xml.match(ANY_CHANGE) || []).length;
    (node.content || []).forEach(walk);
  };
  walk(doc);
  for (const [path, bytes] of Object.entries(files || {})) {
    if (!/^word\/(header\d*|footer\d*|footnotes|endnotes|numbering)\.xml$/.test(path)) continue;
    try { n += (new TextDecoder().decode(bytes).match(ANY_CHANGE) || []).length; } catch { /* unreadable part: not counted */ }
  }
  return n;
}
