/* .docx → editor document (ProseMirror JSON) + comments + the bookkeeping the writer needs.
 *
 *   readDocx(bytes) → { doc, comments, meta, files }
 *
 * Anything the editor can't model (drawings, fields, bookmarks, equations, page breaks…) is kept as an
 * opaque "raw" node carrying its original XML, so saving writes it back byte-for-byte. Anything that
 * genuinely can't survive (formatting-change records) is COUNTED into `meta.warnings` so the editor can
 * say so out loud — never dropped silently. */
import { readPackage, str } from "./package.js";
import { parseXml, serializeXml, el, kids, find, attr, textOf } from "./xml.js";
import { HIGHLIGHT, EMU_PER_PX, TWIP_PER_PX } from "./ooxml.js";

const FONT_SIZE_ATTR = "fontSize"; // the Tiptap text-style attribute name (not a CSS size literal)
const W = (n) => `w:${n}`;
const on = (n) => n && n.attrs["w:val"] !== "0" && n.attrs["w:val"] !== "false" && n.attrs["w:val"] !== "off";

/* ---------- package side tables ---------- */
function relsOf(files, path) {
  const f = files[path]; const m = {};
  if (!f) return m;
  for (const r of kids(parseXml(str(f)))) if (r.name === "Relationship") m[r.attrs.Id] = { target: r.attrs.Target, type: r.attrs.Type, mode: r.attrs.TargetMode };
  return m;
}
function readStyles(files) {
  const byId = {}; const nameToId = {};
  if (!files["word/styles.xml"]) return { byId, nameToId };
  for (const s of kids(parseXml(str(files["word/styles.xml"])))) {
    if (s.name !== "w:style") continue;
    const nm = attr(find(s, "w:name"), "w:val") || "";
    byId[s.attrs["w:styleId"]] = { name: nm, type: s.attrs["w:type"] };
    if (s.attrs["w:type"] === "paragraph" && nm) nameToId[nm.toLowerCase()] = s.attrs["w:styleId"];
  }
  return { byId, nameToId };
}
function readNumbering(files) {
  const abs = {}; const nums = {};
  if (!files["word/numbering.xml"]) return {};
  const root = parseXml(str(files["word/numbering.xml"]));
  for (const a of kids(root)) {
    if (a.name === "w:abstractNum") {
      const lv = {};
      for (const l of kids(a)) if (l.name === "w:lvl") lv[l.attrs["w:ilvl"]] = attr(find(l, "w:numFmt"), "w:val") || "decimal";
      abs[a.attrs["w:abstractNumId"]] = lv;
    } else if (a.name === "w:num") nums[a.attrs["w:numId"]] = attr(find(a, "w:abstractNumId"), "w:val");
  }
  const out = {};
  for (const [id, aid] of Object.entries(nums)) out[id] = abs[aid] || {};
  return out;
}

/* ---------- run properties ↔ marks ---------- */
function rPrMarks(rPr) {
  const marks = [];
  if (!rPr) return marks;
  const g = (n) => find(rPr, W(n));
  if (on(g("b"))) marks.push({ type: "bold" });
  if (on(g("i"))) marks.push({ type: "italic" });
  const u = g("u"); if (u && u.attrs["w:val"] !== "none") marks.push({ type: "underline" });
  if (on(g("strike")) || on(g("dstrike"))) marks.push({ type: "strike" });
  const va = attr(g("vertAlign"), "w:val");
  if (va === "superscript") marks.push({ type: "superscript" });
  if (va === "subscript") marks.push({ type: "subscript" });
  const ts = {};
  const col = attr(g("color"), "w:val"); if (col && col !== "auto" && /^[0-9a-fA-F]{6}$/.test(col)) ts.color = "#" + col.toUpperCase();
  const sz = attr(g("sz"), "w:val"); if (sz && /^\d+$/.test(sz)) ts[FONT_SIZE_ATTR] = `${Number(sz) / 2}pt`;
  const ff = g("rFonts"); const fam = ff && (ff.attrs["w:ascii"] || ff.attrs["w:hAnsi"]); if (fam) ts.fontFamily = fam;
  if (Object.keys(ts).length) marks.push({ type: "textStyle", attrs: ts });
  const hl = attr(g("highlight"), "w:val"); if (hl && hl !== "none" && HIGHLIGHT[hl]) marks.push({ type: "highlight", attrs: { color: HIGHLIGHT[hl] } });
  return marks;
}

const trackAttrs = (n) => ({ id: String(n.attrs["w:id"] || ""), author: n.attrs["w:author"] || "", date: n.attrs["w:date"] || "" });

/* ---------- inline content ---------- */
const RAW_RUN_CHILD = new Set(["w:fldChar", "w:instrText", "w:footnoteReference", "w:endnoteReference", "w:sym", "w:ptab", "w:object", "w:pict", "mc:AlternateContent", "w:footnoteRef", "w:endnoteRef", "w:separator", "w:continuationSeparator", "w:annotationRef", "w:pgNum", "w:yearShort", "w:dayShort"]);

function rawAtom(xml, label, wrapMarks) {
  const n = { type: "docRaw", attrs: { xml, label: label || "" } };
  if (wrapMarks.length) n.marks = wrapMarks;
  return n;
}
const isWrapMark = (m) => m.type === "trackIns" || m.type === "trackDel" || m.type === "comment" || m.type === "link";
const dedupMarks = (ms) => ms.filter((m, i) => ms.findIndex((x) => x.type === m.type && JSON.stringify(x.attrs) === JSON.stringify(m.attrs)) === i);

function pushText(out, text, marks) {
  if (!text) return;
  const last = out[out.length - 1];
  const mk = marks.length ? marks : undefined;
  if (last && last.type === "text" && JSON.stringify(last.marks) === JSON.stringify(mk)) { last.text += text; return; }
  const n = { type: "text", text }; if (mk) n.marks = mk; out.push(n);
}

function drawingImage(run, drawing, ctx, wrapMarks) {
  const blip = findDeep(drawing, "a:blip");
  const rid = blip && (blip.attrs["r:embed"] || blip.attrs["r:link"]);
  const rel = rid && ctx.docRels[rid];
  let src = "";
  if (rel && rel.mode !== "External") {
    const path = rel.target.startsWith("/") ? rel.target.slice(1) : "word/" + rel.target.replace(/^\.\//, "");
    const data = ctx.files[path];
    if (data) {
      const ext = (path.split(".").pop() || "png").toLowerCase();
      const mime = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", bmp: "image/bmp", svg: "image/svg+xml", webp: "image/webp" }[ext];
      if (mime) src = `data:${mime};base64,${b64(data)}`;
    }
  }
  const ext = findDeep(drawing, "wp:extent");
  const attrs = { xml: serializeXml(run), src, width: ext ? Math.round(Number(ext.attrs.cx) / EMU_PER_PX) : null, height: ext ? Math.round(Number(ext.attrs.cy) / EMU_PER_PX) : null, alt: (findDeep(drawing, "wp:docPr") || { attrs: {} }).attrs.descr || "" };
  const n = { type: "docImage", attrs };
  if (wrapMarks.length) n.marks = wrapMarks;
  return n;
}
function findDeep(node, name) {
  if (typeof node === "string") return null;
  if (node.name === name) return node;
  for (const c of node.children || []) { const f = findDeep(c, name); if (f) return f; }
  return null;
}
function b64(u8) { let s = ""; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); }

function runToNodes(run, ctx, ambient) {
  const out = [];
  const rPr = find(run, "w:rPr");
  const fmt = rPrMarks(rPr);
  const wrap = ambient.filter(isWrapMark);
  const all = dedupMarks([...ambient, ...fmt]);
  // A run that only carries a comment anchor is regenerated by the writer.
  if (kids(run).some((c) => c.name === "w:commentReference")) return out;
  for (const c of kids(run)) {
    const nm = c.name;
    if (nm === "w:rPr") continue;
    if (nm === "w:t" || nm === "w:delText") pushText(out, textOf(c), all);
    else if (nm === "w:tab") pushText(out, "\t", all);
    else if (nm === "w:noBreakHyphen") pushText(out, "-", all);
    else if (nm === "w:br" && (!c.attrs["w:type"] || c.attrs["w:type"] === "textWrapping")) out.push(Object.assign({ type: "hardBreak" }, wrap.length ? { marks: wrap } : {}));
    else if (nm === "w:cr") out.push(Object.assign({ type: "hardBreak" }, wrap.length ? { marks: wrap } : {}));
    else if (nm === "w:br") out.push(rawAtom(serializeXml(el("w:r", {}, [c])), c.attrs["w:type"] === "page" ? "page break" : "break", wrap));
    else if (nm === "w:drawing") out.push(drawingImage(el("w:r", {}, [c]), c, ctx, wrap));
    else if (RAW_RUN_CHILD.has(nm)) out.push(rawAtom(serializeXml(el("w:r", {}, [rPr, c].filter(Boolean))), nm === "w:footnoteReference" ? "fn" : nm === "w:endnoteReference" ? "en" : nm === "w:pict" || nm === "w:object" ? "image" : "", wrap));
    // lastRenderedPageBreak, softHyphen etc. — layout hints, safe to drop
  }
  return out;
}

function inlineChildren(children, ctx, ambient, out) {
  for (const c of children) {
    if (typeof c === "string") continue;
    switch (c.name) {
      case "w:pPr": break;
      case "w:r": out.push(...runToNodes(c, ctx, ctx.stamp ? [...ambient, ...ctx.stamp()] : ambient)); break;
      case "w:ins": case "w:moveTo": inlineChildren(c.children, ctx, [...ambient, { type: "trackIns", attrs: trackAttrs(c) }], out); break;
      case "w:del": case "w:moveFrom": inlineChildren(c.children, ctx, [...ambient, { type: "trackDel", attrs: trackAttrs(c) }], out); break;
      case "w:hyperlink": {
        const rid = c.attrs["r:id"]; const rel = rid && ctx.docRels[rid];
        const href = rel ? rel.target : c.attrs["w:anchor"] ? "#" + c.attrs["w:anchor"] : "";
        const lm = { type: "link", attrs: { href, rid: rid || null, anchor: c.attrs["w:anchor"] || null } };
        inlineChildren(c.children, ctx, [...ambient, lm], out); break;
      }
      case "w:commentRangeStart": ctx.open.add(c.attrs["w:id"]); break;
      case "w:commentRangeEnd": ctx.open.delete(c.attrs["w:id"]); break;
      case "w:smartTag": case "w:customXml": inlineChildren(c.children, ctx, ambient, out); break;
      case "w:sdt": { const sc = find(c, "w:sdtContent"); if (sc) inlineChildren(sc.children, ctx, ambient, out); break; }
      case "w:proofErr": case "w:lastRenderedPageBreak": break;
      default: out.push(rawAtom(serializeXml(c), c.name === "w:fldSimple" ? textOf(c) : "", [...ambient, ...(ctx.stamp ? ctx.stamp() : [])].filter(isWrapMark)));
    }
  }
}

/* ---------- paragraphs ---------- */
function paragraph(p, ctx) {
  const pPr = find(p, "w:pPr");
  const attrs = { pStyle: null, textAlign: "left", pprx: "", pMark: null };
  let num = null;
  const extras = [];
  if (pPr) {
    for (const c of kids(pPr)) {
      if (c.name === "w:pStyle") {
        const id = c.attrs["w:val"]; const st = ctx.styles.byId[id]; const nm = ((st && st.name) || id || "").toLowerCase();
        const hm = /^heading ?([1-9])$/.exec(nm);
        if (hm && Number(hm[1]) <= 3) attrs.heading = Number(hm[1]);
        else if (nm === "title") attrs.pStyle = "Title";
        else if (nm !== "normal" && id !== "Normal") attrs.pStyle = id;
      } else if (c.name === "w:numPr") {
        const nid = attr(find(c, "w:numId"), "w:val"); const lvl = attr(find(c, "w:ilvl"), "w:val");
        if (nid && nid !== "0") num = { numId: nid, ilvl: Number(lvl || 0) };
      } else if (c.name === "w:jc") { const v = c.attrs["w:val"]; attrs.textAlign = v === "center" ? "center" : v === "right" || v === "end" ? "right" : v === "both" || v === "distribute" ? "justify" : "left"; }
      else if (c.name === "w:rPr") {
        const keep = kids(c).filter((x) => x.name !== "w:ins" && x.name !== "w:del" && x.name !== "w:moveFrom" && x.name !== "w:moveTo");
        const mk = kids(c).find((x) => x.name === "w:ins" || x.name === "w:del");
        if (mk) attrs.pMark = { type: mk.name === "w:ins" ? "ins" : "del", ...trackAttrs(mk) };
        if (keep.length) extras.push(el("w:rPr", {}, keep));
      } else if (c.name === "w:pPrChange") { /* counted as a warning up front */ }
      else extras.push(c);
    }
  }
  attrs.pprx = extras.map(serializeXml).join("");
  const inline = [];
  inlineChildren(p.children, ctx, [], inline);
  // comment ranges: re-walk so each node knows which comments were open at its position
  const node = { type: attrs.heading ? "heading" : "paragraph", attrs: { ...attrs, ...(attrs.heading ? { level: attrs.heading } : {}) } };
  delete node.attrs.heading;
  if (inline.length) node.content = inline;
  return { node, num };
}

/* ---------- tables ---------- */
function tableNode(tbl, ctx) {
  const tblPr = find(tbl, "w:tblPr"); const grid = find(tbl, "w:tblGrid");
  const gridCols = grid ? kids(grid).filter((g) => g.name === "w:gridCol").map((g) => Number(g.attrs["w:w"] || 0)) : [];
  const rows = [];
  const owner = {}; // col index → the cell currently spanning down it
  for (const tr of kids(tbl)) {
    if (tr.name !== "w:tr") continue;
    const trPr = find(tr, "w:trPr");
    const cells = [];
    let col = 0;
    for (const tc of kids(tr)) {
      if (tc.name !== "w:tc") continue;
      const tcPr = find(tc, "w:tcPr");
      const span = Number(attr(tcPr && find(tcPr, "w:gridSpan"), "w:val") || 1);
      const vm = tcPr && find(tcPr, "w:vMerge");
      if (vm && vm.attrs["w:val"] !== "restart") { // continuation of a vertical merge
        const o = owner[col]; if (o) o.attrs.rowspan = (o.attrs.rowspan || 1) + 1;
        col += span; continue;
      }
      const keep = tcPr ? kids(tcPr).filter((x) => x.name !== "w:gridSpan" && x.name !== "w:vMerge") : [];
      const widths = []; for (let k = 0; k < span; k++) widths.push(gridCols[col + k] ? Math.round(gridCols[col + k] / TWIP_PER_PX) : 0);
      const cell = { type: "tableCell", attrs: { colspan: span, rowspan: 1, colwidth: widths.every((w) => w > 0) ? widths : null, tcpr: keep.map(serializeXml).join("") } };
      cell.content = blocks(tc.children, ctx);
      if (!cell.content.length) cell.content = [{ type: "paragraph", attrs: { pStyle: null, textAlign: "left", pprx: "", pMark: null } }];
      cells.push(cell);
      if (vm) for (let k = 0; k < span; k++) owner[col + k] = cell; else for (let k = 0; k < span; k++) delete owner[col + k];
      col += span;
    }
    rows.push({ type: "tableRow", attrs: { trpr: trPr ? kids(trPr).map(serializeXml).join("") : "" }, content: cells });
  }
  return { type: "table", attrs: { tblpr: tblPr ? kids(tblPr).map(serializeXml).join("") : "", gridCols }, content: rows.filter((r) => r.content.length) };
}

/* ---------- blocks (with list grouping) ---------- */
function blocks(children, ctx) {
  const out = [];
  let stack = [];
  const flush = () => { stack = []; };
  for (const c of children) {
    if (typeof c === "string") continue;
    if (c.name === "w:p") {
      const { node, num } = paragraph(c, ctx);
      if (!num) { flush(); out.push(node); continue; }
      const fmt = (ctx.numbering[num.numId] || {})[String(num.ilvl)] || "decimal";
      const kind = fmt === "bullet" || fmt === "none" ? "bulletList" : "orderedList";
      while (stack.length && stack[stack.length - 1].ilvl > num.ilvl) stack.pop();
      if (stack.length && stack[stack.length - 1].ilvl === num.ilvl && stack[stack.length - 1].numId !== num.numId) stack.pop();
      if (!stack.length || stack[stack.length - 1].ilvl < num.ilvl) {
        const list = { type: kind, attrs: { numId: num.numId }, content: [] };
        const parent = stack[stack.length - 1];
        if (parent && parent.last) parent.last.content.push(list); else { out.push(list); }
        stack.push({ ilvl: num.ilvl, numId: num.numId, list, last: null });
      }
      const top = stack[stack.length - 1];
      const item = { type: "listItem", content: [node] };
      top.list.content.push(item); top.last = item;
    } else if (c.name === "w:tbl") { flush(); out.push(tableNode(c, ctx)); }
    else if (c.name === "w:sdt") { flush(); const sc = find(c, "w:sdtContent"); if (sc) out.push(...blocks(sc.children, ctx)); }
    else if (c.name === "w:sectPr" || c.name === "w:tcPr" || c.name === "w:bookmarkStart" || c.name === "w:bookmarkEnd" || c.name === "w:proofErr") continue;
    else { flush(); out.push({ type: "docRawBlock", attrs: { xml: serializeXml(c), label: c.name } }); }
  }
  return out;
}

function countWarnings(root) {
  const w = { formatChanges: 0 };
  const walk = (n) => { if (typeof n === "string") return; if (/^w:(rPrChange|pPrChange|tblPrChange|tcPrChange|trPrChange|sectPrChange|tblGridChange|numberingChange)$/.test(n.name)) w.formatChanges++; (n.children || []).forEach(walk); };
  walk(root);
  return w;
}

/* ---------- public ---------- */
export function readDocx(input) {
  const files = readPackage(input);
  const docRoot = parseXml(str(files["word/document.xml"]));
  const body = find(docRoot, "w:body");
  if (!body) throw new Error("This Word file has no body.");
  const styles = readStyles(files);
  const ctx = { files, docRels: relsOf(files, "word/_rels/document.xml.rels"), styles, numbering: readNumbering(files), open: new Set() };

  // comments
  const comments = [];
  const ext = {};
  if (files["word/commentsExtended.xml"]) for (const c of kids(parseXml(str(files["word/commentsExtended.xml"])))) ext[c.attrs["w15:paraId"]] = { parent: c.attrs["w15:paraIdParent"] || null, done: c.attrs["w15:done"] === "1" };
  const paraToId = {};
  if (files["word/comments.xml"]) {
    for (const c of kids(parseXml(str(files["word/comments.xml"])))) {
      if (c.name !== "w:comment") continue;
      const ps = kids(c).filter((p) => p.name === "w:p");
      const paraId = ps.length ? ps[ps.length - 1].attrs["w14:paraId"] : null;
      const id = "c" + c.attrs["w:id"];
      if (paraId) paraToId[paraId] = id;
      comments.push({ id, author: c.attrs["w:author"] || "", initials: c.attrs["w:initials"] || "", date: c.attrs["w:date"] || "", text: ps.map((p) => textOf(p)).join("\n"), parentId: null, resolved: false, _para: paraId });
    }
    for (const c of comments) { const e = c._para && ext[c._para]; if (e) { c.resolved = e.done; c.parentId = e.parent ? paraToId[e.parent] || null : null; } delete c._para; }
  }
  const replyIds = new Set(comments.filter((c) => c.parentId).map((c) => c.id));

  // Walk the body; every run read while a comment range is open is stamped with that comment's mark.
  ctx.stamp = () => [...ctx.open].map((id) => "c" + id).filter((id) => !replyIds.has(id)).map((id) => ({ type: "comment", attrs: { id } }));
  const docJson = { type: "doc", content: blocks(body.children, ctx) };
  if (!docJson.content.length) docJson.content = [{ type: "paragraph", attrs: { pStyle: null, textAlign: "left", pprx: "", pMark: null } }];

  const sectPr = find(body, "w:sectPr");
  const warnings = [];
  const wc = countWarnings(docRoot);
  if (wc.formatChanges) warnings.push(`${wc.formatChanges} formatting-change record${wc.formatChanges === 1 ? "" : "s"} (Word’s “formatted: …” balloons) can’t be shown here and will not be kept when you save.`);
  return {
    doc: docJson,
    comments,
    meta: { sectPr: sectPr ? serializeXml(sectPr) : "", rootAttrs: docRoot.attrs, nameToId: styles.nameToId, warnings, nextTrackId: 1 },
    files,
  };
}

export const _internals = { rPrMarks };
