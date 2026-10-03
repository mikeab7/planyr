/* Editor document → a real .docx.
 *
 *   writeDocx({ doc, comments, meta, files }) → Uint8Array
 *
 * Rewrites ONLY word/document.xml + the comment parts (+ numbering when a brand-new list needs it).
 * Every other part of the original package (styles, theme, media, headers, footers, footnotes…) is
 * carried through unchanged, and "raw" nodes re-emit their original XML verbatim. Tracked changes are
 * written as Word's own <w:ins>/<w:del> and comments as comments.xml + commentsExtended.xml, so the file
 * opens in Microsoft Word with them showing. */
import { writePackage, str, bytes } from "./package.js";
import { parseXml, serializeXml, el, kids } from "./xml.js";
import { DOC_ROOT_ATTRS, PART, HIGHLIGHT_NAME, PPR_ORDER, RPR_ORDER, orderBy, TWIP_PER_PX, NS_W, REL_NS, CT_NS } from "./ooxml.js";

const FONT_SIZE_ATTR = "fontSize"; // the Tiptap text-style attribute name (not a CSS size literal)
const isoNow = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");
const cleanText = (s) => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
const frag = (s) => (s ? kids(parseXml(`<x>${s}</x>`)) : []);
const isLeaf = (n) => n.type === "text" || n.type === "hardBreak" || n.type === "docImage" || n.type === "docRaw";

/* ---------- package part editing ---------- */
function loadRels(files) {
  const path = "word/_rels/document.xml.rels";
  const root = files[path] ? parseXml(str(files[path])) : el("Relationships", { xmlns: REL_NS }, []);
  return { root, path };
}
function nextRid(root) { let n = 0; for (const r of kids(root)) { const m = /^rId(\d+)$/.exec(r.attrs.Id || ""); if (m) n = Math.max(n, Number(m[1])); } return `rId${n + 1}`; }
function ensureRel(rels, type, target, external) {
  const hit = kids(rels.root).find((r) => r.attrs.Type === type && r.attrs.Target === target);
  if (hit) return hit.attrs.Id;
  const id = nextRid(rels.root);
  rels.root.children.push(el("Relationship", { Id: id, Type: type, Target: target, ...(external ? { TargetMode: "External" } : {}) }));
  return id;
}
function dropRelsOfType(rels, type) { rels.root.children = rels.root.children.filter((r) => typeof r === "string" || r.attrs.Type !== type); }

function loadCT(files) { return files["[Content_Types].xml"] ? parseXml(str(files["[Content_Types].xml"])) : el("Types", { xmlns: CT_NS }, [el("Default", { Extension: "rels", ContentType: "application/vnd.openxmlformats-package.relationships+xml" }), el("Default", { Extension: "xml", ContentType: "application/xml" })]); }
function ensureOverride(ct, partName, contentType) { if (!kids(ct).some((o) => o.name === "Override" && o.attrs.PartName === partName)) ct.children.push(el("Override", { PartName: partName, ContentType: contentType })); }
function dropOverride(ct, partName) { ct.children = ct.children.filter((o) => typeof o === "string" || !(o.name === "Override" && o.attrs.PartName === partName)); }

/* ---------- numbering ---------- */
function numberingHelper(files) {
  const root = files[PART.numbering.path] ? parseXml(str(files[PART.numbering.path])) : el("w:numbering", { "xmlns:w": NS_W }, []);
  const origNums = new Set(kids(root).filter((n) => n.name === "w:num").map((n) => n.attrs["w:numId"]));
  let maxAbs = 0, maxNum = 0;
  for (const n of kids(root)) { if (n.name === "w:abstractNum") maxAbs = Math.max(maxAbs, Number(n.attrs["w:abstractNumId"]) || 0); if (n.name === "w:num") maxNum = Math.max(maxNum, Number(n.attrs["w:numId"]) || 0); }
  const st = { root, origNums, used: false, bulletAbs: null, decAbs: null, bulletNum: null };
  const levels = (kind) => Array.from({ length: 9 }, (_, i) => {
    const fmt = kind === "bullet" ? "bullet" : ["decimal", "lowerLetter", "lowerRoman"][i % 3];
    const txt = kind === "bullet" ? ["•", "◦", "▪"][i % 3] : `%${i + 1}.`;
    return el("w:lvl", { "w:ilvl": String(i) }, [el("w:start", { "w:val": "1" }), el("w:numFmt", { "w:val": fmt }), el("w:lvlText", { "w:val": txt }), el("w:lvlJc", { "w:val": "left" }), el("w:pPr", {}, [el("w:ind", { "w:left": String(720 * (i + 1)), "w:hanging": "360" })])]);
  });
  const addAbs = (kind) => {
    const id = String(++maxAbs); st.used = true;
    const a = el("w:abstractNum", { "w:abstractNumId": id }, [el("w:multiLevelType", { "w:val": "hybridMultilevel" }), ...levels(kind)]);
    const firstNum = root.children.findIndex((c) => typeof c !== "string" && c.name === "w:num");
    if (firstNum < 0) root.children.push(a); else root.children.splice(firstNum, 0, a);
    return id;
  };
  const addNum = (abs, restart) => {
    const id = String(++maxNum); st.used = true;
    root.children.push(el("w:num", { "w:numId": id }, [el("w:abstractNumId", { "w:val": abs }), ...(restart ? Array.from({ length: 9 }, (_, i) => el("w:lvlOverride", { "w:ilvl": String(i) }, [el("w:startOverride", { "w:val": "1" })])) : [])]));
    return id;
  };
  st.bullet = () => { if (!st.bulletNum) { st.bulletAbs = addAbs("bullet"); st.bulletNum = addNum(st.bulletAbs, false); } return st.bulletNum; };
  st.ordered = () => { if (!st.decAbs) st.decAbs = addAbs("decimal"); return addNum(st.decAbs, true); };
  return st;
}

/* ---------- run properties ---------- */
function marksToRPr(marks) {
  const kidsOut = [];
  for (const m of marks || []) {
    const a = m.attrs || {};
    switch (m.type) {
      case "bold": kidsOut.push(el("w:b")); break;
      case "italic": kidsOut.push(el("w:i")); break;
      case "underline": kidsOut.push(el("w:u", { "w:val": "single" })); break;
      case "strike": kidsOut.push(el("w:strike")); break;
      case "superscript": kidsOut.push(el("w:vertAlign", { "w:val": "superscript" })); break;
      case "subscript": kidsOut.push(el("w:vertAlign", { "w:val": "subscript" })); break;
      case "highlight": { const nm = HIGHLIGHT_NAME[String(a.color || "").toLowerCase()] || "yellow"; kidsOut.push(el("w:highlight", { "w:val": nm })); break; }
      case "textStyle": {
        if (a.color && /^#[0-9a-fA-F]{6}$/.test(a.color)) kidsOut.push(el("w:color", { "w:val": a.color.slice(1).toUpperCase() }));
        const fsz = a[FONT_SIZE_ATTR]; if (fsz) { const mm = /^([\d.]+)(pt|px)?$/.exec(String(fsz)); if (mm) { const pt = mm[2] === "px" ? Number(mm[1]) * 0.75 : Number(mm[1]); kidsOut.push(el("w:sz", { "w:val": String(Math.round(pt * 2)) })); } }
        if (a.fontFamily) { const f = String(a.fontFamily).split(",")[0].replace(/["']/g, "").trim(); if (f) kidsOut.push(el("w:rFonts", { "w:ascii": f, "w:hAnsi": f, "w:cs": f })); }
        break;
      }
      default: break;
    }
  }
  return kidsOut.length ? el("w:rPr", {}, orderBy(kidsOut, RPR_ORDER)) : null;
}

/* ---------- the writer ---------- */
export function writeDocx({ doc, comments = [], meta = {}, files }) {
  const out = { ...files };
  const nameToId = meta.nameToId || {};
  const rels = loadRels(out);
  const ct = loadCT(out);
  const num = numberingHelper(out);
  const author = meta.author || "Reviewer";
  const st = { track: Math.max(1000, meta.nextTrackId || 1000) }; // clear of comment ids: Word wants annotation ids unique across kinds
  const nextTrack = () => st.track++;

  // comment ids → Word's numeric ids; replies share their parent's anchor
  const cnum = new Map(comments.map((c, i) => [c.id, i]));
  const repliesOf = new Map();
  for (const c of comments) if (c.parentId && cnum.has(c.parentId)) { if (!repliesOf.has(c.parentId)) repliesOf.set(c.parentId, []); repliesOf.get(c.parentId).push(c.id); }
  const anchored = (c) => (cnum.has(c) ? [c, ...(repliesOf.get(c) || [])] : []);

  // pre-pass: first/last leaf index per comment
  const first = new Map(), last = new Map();
  { let idx = 0; const walk = (n) => { if (isLeaf(n)) { for (const m of n.marks || []) if (m.type === "comment" && cnum.has(m.attrs.id)) { if (!first.has(m.attrs.id)) first.set(m.attrs.id, idx); last.set(m.attrs.id, idx); } idx++; return; } (n.content || []).forEach(walk); }; walk(doc); }
  const startsAt = new Map(), endsAt = new Map();
  for (const [c, i] of first) { if (!startsAt.has(i)) startsAt.set(i, []); startsAt.get(i).push(c); }
  for (const [c, i] of last) { if (!endsAt.has(i)) endsAt.set(i, []); endsAt.get(i).push(c); }
  const unanchored = comments.filter((c) => !c.parentId && !first.has(c.id)).map((c) => c.id);
  let unanchoredPending = unanchored.length > 0;
  let leafIdx = 0;

  const styleId = (name, fb) => nameToId[name] || fb;
  const trackAttrsOf = (m) => ({ "w:id": String(nextTrack()), "w:author": (m.attrs && m.attrs.author) || author, "w:date": (m.attrs && m.attrs.date) || isoNow() });

  const commentStart = (ids) => ids.flatMap(anchored).map((c) => ({ marker: true, xml: [el("w:commentRangeStart", { "w:id": String(cnum.get(c)) })] }));
  const commentEnd = (ids) => ids.flatMap(anchored).map((c) => ({ marker: true, xml: [el("w:commentRangeEnd", { "w:id": String(cnum.get(c)) }), el("w:r", {}, [el("w:commentReference", { "w:id": String(cnum.get(c)) })])] }));

  const hyperlinkNode = (m, children) => {
    const a = m.attrs || {};
    if (a.anchor) return el("w:hyperlink", { "w:anchor": a.anchor, "w:history": "1" }, children);
    const rid = ensureRel(rels, "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink", a.href || "", true);
    return el("w:hyperlink", { "r:id": rid, "w:history": "1" }, children);
  };

  function leafItem(n) {
    const marks = n.marks || [];
    const it = { xml: [], ins: marks.find((m) => m.type === "trackIns") || null, del: marks.find((m) => m.type === "trackDel") || null, link: marks.find((m) => m.type === "link") || null };
    if (n.type === "text") {
      const rpr = marksToRPr(marks);
      const parts = cleanText(n.text).split("\t");
      const tn = it.del ? "w:delText" : "w:t";
      const rc = [];
      parts.forEach((p, i) => { if (i > 0) rc.push(el("w:tab")); if (p) rc.push(el(tn, { "xml:space": "preserve" }, [p])); });
      if (rc.length) it.xml.push(el("w:r", {}, rpr ? [rpr, ...rc] : rc));
    } else if (n.type === "hardBreak") it.xml.push(el("w:r", {}, [el("w:br")]));
    else it.xml.push(parseXml(n.attrs.xml));
    return it;
  }
  const keyOf = (it, lvl) => (lvl === "link" ? (it.link ? JSON.stringify([it.link.attrs.rid, it.link.attrs.href, it.link.attrs.anchor]) : null) : it[lvl] ? String(it[lvl].attrs.id) : null);
  function wrapItems(items, levels) {
    if (!levels.length) return items.flatMap((i) => i.xml);
    const [lvl, ...rest] = levels;
    const res = [];
    let i = 0;
    while (i < items.length) {
      const k = items[i].marker ? null : keyOf(items[i], lvl);
      let j = i + 1;
      while (j < items.length && !items[j].marker && !items[i].marker && keyOf(items[j], lvl) === k) j++;
      const group = items.slice(i, j);
      const inner = wrapItems(group, rest);
      if (k == null) res.push(...inner);
      else if (lvl === "link") res.push(hyperlinkNode(group[0].link, inner));
      else res.push(el(lvl === "ins" ? "w:ins" : "w:del", trackAttrsOf(group[0][lvl]), inner));
      i = j;
    }
    return res;
  }

  function paragraphXml(node, numPr) {
    const a = node.attrs || {};
    const pc = [];
    if (node.type === "heading") pc.push(el("w:pStyle", { "w:val": styleId(`heading ${a.level || 1}`, `Heading${a.level || 1}`) }));
    else if (a.pStyle === "Title") pc.push(el("w:pStyle", { "w:val": styleId("title", "Title") }));
    else if (a.pStyle) pc.push(el("w:pStyle", { "w:val": a.pStyle }));
    if (numPr) pc.push(el("w:numPr", {}, [el("w:ilvl", { "w:val": String(numPr.ilvl) }), el("w:numId", { "w:val": String(numPr.numId) })]));
    const jc = { center: "center", right: "right", justify: "both" }[a.textAlign]; if (jc) pc.push(el("w:jc", { "w:val": jc }));
    let rPr = null;
    for (const x of frag(a.pprx)) { if (x.name === "w:rPr") rPr = el("w:rPr", {}, [...kids(x)]); else pc.push(x); }
    if (a.pMark && a.pMark.type) { rPr = rPr || el("w:rPr", {}, []); rPr.children.push(el(a.pMark.type === "ins" ? "w:ins" : "w:del", trackAttrsOf({ attrs: a.pMark }))); }
    if (rPr) { rPr.children = orderBy(kids(rPr), RPR_ORDER); pc.push(rPr); }
    const items = [];
    if (unanchoredPending) { unanchoredPending = false; for (const c of unanchored) { items.push(...commentStart([c]), ...commentEnd([c])); } }
    for (const n of node.content || []) {
      const idx = leafIdx++;
      if (startsAt.has(idx)) items.push(...commentStart(startsAt.get(idx)));
      items.push(leafItem(n));
      if (endsAt.has(idx)) items.push(...commentEnd(endsAt.get(idx)));
    }
    const ch = [];
    if (pc.length) ch.push(el("w:pPr", {}, orderBy(pc, PPR_ORDER)));
    ch.push(...wrapItems(items, ["link", "ins", "del"]));
    return el("w:p", {}, ch);
  }

  function listXml(list, depth) {
    const bullet = list.type === "bulletList";
    let nid = list.attrs && list.attrs.numId;
    if (!nid || !num.origNums.has(String(nid))) nid = bullet ? num.bullet() : num.ordered();
    const res = [];
    for (const item of list.content || []) {
      let first = true;
      for (const c of item.content || []) {
        if (c.type === "bulletList" || c.type === "orderedList") res.push(...listXml(c, depth + 1));
        else if ((c.type === "paragraph" || c.type === "heading") && first) { res.push(paragraphXml(c, { numId: nid, ilvl: depth })); first = false; }
        else res.push(...blockXml(c));
      }
    }
    return res;
  }

  function tableXml(t) {
    const rows = t.content || [];
    const colsOfRow = (r) => (r.content || []).reduce((s, c) => s + ((c.attrs && c.attrs.colspan) || 1), 0);
    // total grid columns = widest row once vertical spans are counted back in
    let ncols = 0; const carry = [];
    for (const r of rows) { const cells = r.content || []; let k = 0; let col = 0; while (k < cells.length || (carry[col] > 0)) { if (carry[col] > 0) { carry[col]--; col++; continue; } const cell = cells[k++]; const sp = (cell.attrs && cell.attrs.colspan) || 1; const rs = (cell.attrs && cell.attrs.rowspan) || 1; for (let q = 0; q < sp; q++) carry[col + q] = rs - 1; col += sp; } ncols = Math.max(ncols, col, colsOfRow(r)); }
    let grid = (t.attrs && t.attrs.gridCols) || [];
    if (grid.length !== ncols) { // columns were added/removed: rebuild from the cell widths, else split a page evenly
      grid = Array.from({ length: ncols }, () => Math.round(9360 / Math.max(1, ncols)));
      const r0 = rows[0] && rows[0].content || []; let col = 0;
      for (const cell of r0) { const cw = cell.attrs && cell.attrs.colwidth; const sp = (cell.attrs && cell.attrs.colspan) || 1; if (cw && cw.length === sp && cw.every((w) => w > 0)) for (let q = 0; q < sp; q++) grid[col + q] = Math.round(cw[q] * TWIP_PER_PX); col += sp; }
    }
    const tblPrKids = frag(t.attrs && t.attrs.tblpr);
    const defaultPr = [el("w:tblW", { "w:w": "0", "w:type": "auto" }), el("w:tblBorders", {}, ["top", "left", "bottom", "right", "insideH", "insideV"].map((b) => el(`w:${b}`, { "w:val": "single", "w:sz": "4", "w:space": "0", "w:color": "808080" })))];
    const tr = [];
    const occ = []; // col → { left, span, tcpr } for cells still spanning down
    for (const r of rows) {
      const cells = r.content || [];
      const rc = [];
      let col = 0, k = 0;
      const flush = () => { while (occ[col] && occ[col].left > 0) { const o = occ[col]; rc.push(el("w:tc", {}, [el("w:tcPr", {}, [...(o.w ? [o.w] : []), ...(o.span > 1 ? [el("w:gridSpan", { "w:val": String(o.span) })] : []), el("w:vMerge")]), el("w:p")])); o.left--; col += o.span; } };
      while (k < cells.length || (occ[col] && occ[col].left > 0)) {
        flush();
        if (k >= cells.length) break;
        const cell = cells[k++]; const ca = cell.attrs || {}; const sp = ca.colspan || 1; const rs = ca.rowspan || 1;
        const keep = frag(ca.tcpr); const tcW = keep.find((x) => x.name === "w:tcW") || el("w:tcW", { "w:w": String(grid.slice(col, col + sp).reduce((s, w) => s + w, 0)), "w:type": "dxa" });
        const rest = keep.filter((x) => x.name !== "w:tcW");
        const pr = [tcW]; if (sp > 1) pr.push(el("w:gridSpan", { "w:val": String(sp) })); if (rs > 1) pr.push(el("w:vMerge", { "w:val": "restart" })); pr.push(...rest);
        const content = (cell.content || []).flatMap(blockXml);
        rc.push(el("w:tc", {}, [el("w:tcPr", {}, pr), ...(content.length ? content : [el("w:p")])]));
        if (rs > 1) for (let q = 0; q < sp; q++) occ[col + q] = q === 0 ? { left: rs - 1, span: sp, w: tcW } : { left: 0, span: 1 };
        col += sp;
      }
      flush();
      const trKids = frag(r.attrs && r.attrs.trpr);
      tr.push(el("w:tr", {}, [...(trKids.length ? [el("w:trPr", {}, trKids)] : []), ...rc]));
    }
    return el("w:tbl", {}, [el("w:tblPr", {}, tblPrKids.length ? tblPrKids : defaultPr), el("w:tblGrid", {}, grid.map((w) => el("w:gridCol", { "w:w": String(w) }))), ...tr]);
  }

  function blockXml(n) {
    if (n.type === "paragraph" || n.type === "heading") return [paragraphXml(n)];
    if (n.type === "bulletList" || n.type === "orderedList") return listXml(n, 0);
    if (n.type === "table") return [tableXml(n)];
    if (n.type === "docRawBlock") return [parseXml(n.attrs.xml)];
    if (n.type === "blockquote" || n.type === "codeBlock") return (n.content || []).flatMap(blockXml).length ? (n.type === "codeBlock" ? [paragraphXml({ type: "paragraph", attrs: {}, content: n.content })] : (n.content || []).flatMap(blockXml)) : [];
    if (n.type === "horizontalRule") return [el("w:p")];
    return [];
  }

  const bodyKids = (doc.content || []).flatMap(blockXml);
  const sect = meta.sectPr ? parseXml(meta.sectPr) : el("w:sectPr", {}, [el("w:pgSz", { "w:w": "12240", "w:h": "15840" }), el("w:pgMar", { "w:top": "1440", "w:right": "1440", "w:bottom": "1440", "w:left": "1440", "w:header": "720", "w:footer": "720", "w:gutter": "0" })]);
  const rootAttrs = { "xmlns:w": NS_W, "xmlns:r": DOC_ROOT_ATTRS["xmlns:r"], ...(meta.rootAttrs || (({ ...DOC_ROOT_ATTRS }))) };
  out["word/document.xml"] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeXml(el("w:document", rootAttrs, [el("w:body", {}, [...bodyKids, sect])])));

  /* comments */
  dropRelsOfType(rels, PART.commentsIds.rel); dropRelsOfType(rels, PART.commentsExtensible.rel);
  for (const p of [PART.commentsIds, PART.commentsExtensible]) { delete out[p.path]; dropOverride(ct, "/" + p.path); }
  if (comments.length) {
    const paraId = (i) => (0x1A000000 + i * 17 + 1).toString(16).toUpperCase().padStart(8, "0");
    const cx = comments.map((c, i) => el("w:comment", { "w:id": String(i), "w:author": c.author || author, "w:date": c.date || isoNow(), "w:initials": c.initials || (c.author || author).split(/\s+/).map((w) => w[0] || "").join("").slice(0, 3).toUpperCase() }, String(c.text || "").split("\n").map((line, li, arr) => el("w:p", li === arr.length - 1 ? { "w14:paraId": paraId(i) } : {}, [el("w:r", {}, [el("w:t", { "xml:space": "preserve" }, [cleanText(line)])])]))));
    out[PART.comments.path] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeXml(el("w:comments", { "xmlns:w": NS_W, "xmlns:mc": DOC_ROOT_ATTRS["xmlns:mc"], "xmlns:w14": DOC_ROOT_ATTRS["xmlns:w14"], "mc:Ignorable": "w14" }, cx)));
    const ex = comments.map((c, i) => el("w15:commentEx", { "w15:paraId": paraId(i), ...(c.parentId && cnum.has(c.parentId) ? { "w15:paraIdParent": paraId(cnum.get(c.parentId)) } : {}), "w15:done": c.resolved ? "1" : "0" }));
    out[PART.commentsExt.path] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeXml(el("w15:commentsEx", { "xmlns:w15": DOC_ROOT_ATTRS["xmlns:w15"] }, ex)));
    ensureRel(rels, PART.comments.rel, "comments.xml"); ensureOverride(ct, "/" + PART.comments.path, PART.comments.ct);
    ensureRel(rels, PART.commentsExt.rel, "commentsExtended.xml"); ensureOverride(ct, "/" + PART.commentsExt.path, PART.commentsExt.ct);
  } else {
    for (const p of [PART.comments, PART.commentsExt]) { delete out[p.path]; dropRelsOfType(rels, p.rel); dropOverride(ct, "/" + p.path); }
  }
  if (num.used) { out[PART.numbering.path] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeXml(num.root)); ensureRel(rels, PART.numbering.rel, "numbering.xml"); ensureOverride(ct, "/" + PART.numbering.path, PART.numbering.ct); }

  out[rels.path] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeXml(rels.root));
  out["[Content_Types].xml"] = bytes('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + serializeXml(ct));
  return writePackage(out);
}

/* A minimal valid package (used for "Save as Word document" from a .txt). */
export function blankPackage() {
  const hdr = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const sty = (id, name, extra = "", based = "Normal") => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${id === "Normal" ? "" : `<w:basedOn w:val="${based}"/><w:next w:val="Normal"/>`}<w:qFormat/>${extra}</w:style>`;
  const styles = hdr + `<w:styles xmlns:w="${NS_W}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
    + sty("Title", "Title", '<w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:sz w:val="56"/></w:rPr>')
    + [1, 2, 3].map((n) => sty(`Heading${n}`, `heading ${n}`, `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${[32, 28, 24][n - 1]}"/></w:rPr>`)).join("")
    + "</w:styles>";
  return {
    "[Content_Types].xml": bytes(hdr + `<Types xmlns="${CT_NS}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    "_rels/.rels": bytes(hdr + `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    "word/document.xml": bytes(hdr + `<w:document ${Object.entries(DOC_ROOT_ATTRS).map(([k, v]) => `${k}="${v}"`).join(" ")}><w:body><w:p/></w:body></w:document>`),
    "word/_rels/document.xml.rels": bytes(hdr + `<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "word/styles.xml": bytes(styles),
  };
}
