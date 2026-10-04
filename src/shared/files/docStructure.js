/* Legacy Word 97–2003 .doc → the editor's document (ProseMirror JSON), WITH its formatting. (NEW-2, B2022929)
 *
 * docText.js reads a .doc as plain text for the deed plotter. The Review editor needs more: paragraphs,
 * heading styles, bold / italic / underline, lists and tables. This module reads them from the same file,
 * dependency-free (DataView + the native UTF-16 decoder), by extending the piece-table reader rather than
 * pulling in a library — see the PR for the route and why (no browser-capable library reads .doc formatting:
 * `word-extractor` is Node-only and text-only, `mammoth` is .docx-only, SheetJS's `cfb` is just the container).
 *
 * How a .doc stores formatting (MS-DOC), and what we read of it:
 *   · TEXT lives in the WordDocument stream, located by the CLX piece table (docText.readWordFile).
 *   · CHARACTER formatting: PlcfBteChpx → 512-byte FKP pages → runs of file offsets (FC) → a CHPX of "sprms"
 *     (property-modifier records: opcode + operand). We read bold, italic, underline, strike, super/subscript,
 *     colour, highlight, size, font, character style, picture marker.
 *   · PARAGRAPH formatting: PlcfBtePapx → FKP → PAPX = style index (istd) + sprms. We read alignment, indents,
 *     list membership (ilfo / ilvl), "in table", "row end", nesting depth, and the table's column grid.
 *   · STYLES: the STSH names each style and chains it to a base. Heading 1–3 / Title become real headings; the
 *     style's own bold/size/font flows into its paragraphs (not into headings, which the editor draws itself).
 *   · LISTS: PlfLst (the list definitions: bullet or a number format per level) + PlfLfo (which definition a
 *     paragraph's ilfo points at).
 *   · TABLES are not objects in a .doc: a cell ends with a 0x07 mark, a row ends with a paragraph flagged "row end"
 *     whose sprm carries the column boundaries (and horizontal / vertical merge flags).
 *
 *   · PICTURES: an inline picture's bytes live in the separate `Data` stream (sprmCPicLocation → a PICF header, an
 *     OfficeArt shape container, then the BLIP). JPEG and PNG blips are carried as real images; other kinds
 *     (EMF / WMF / PICT / TIFF / DIB — vector or old formats a browser cannot draw) are not.
 *
 * What it does NOT carry (each is reported by name in `report`, never silently dropped): non-JPEG/PNG pictures and drawn
 * shapes (a visible “[picture not carried over]” placeholder holds the spot), text boxes, headers / footers /
 * footnotes / comments, nested tables (their text is flattened into the outer cell), tracked changes (shown as plain
 * text, counted), and cell borders / shading. */
import { parseCfb, readWordFile, decodePieces, SAVE_AS } from "./docText.js";
import { HIGHLIGHT } from "./docx/ooxml.js";

const FONT_SIZE_ATTR = "fontSize";
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const i16 = (b, o) => { const v = u16(b, o); return v & 0x8000 ? v - 0x10000 : v; };
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b, o) => u32(b, o) | 0;

/* The 16-colour Word palette used by sprmCIco and sprmCHighlight (index 0 = automatic / none). */
const ICO = [null, "black", "blue", "cyan", "green", "magenta", "red", "yellow", "white", "darkBlue", "darkCyan", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray"];

/* ---------- sprms ---------- */
// Operand size by spra (the top 3 bits of the opcode). 6 = variable (length-prefixed).
const SPRA_SIZE = [1, 1, 2, 4, 2, 2, -1, 3];
function* sprms(b) {
  let p = 0;
  while (p + 2 <= b.length) {
    const op = u16(b, p); p += 2;
    const spra = op >> 13;
    let size = SPRA_SIZE[spra];
    if (size < 0) {
      if (op === 0xd608) { size = u16(b, p) + 1; } // sprmTDefTable: a 2-byte length that counts itself less one
      else { size = b[p] + 1; if (b[p] === 0xff && op === 0xc615) return; } // sprmPChgTabs' escape: stop rather than guess
    }
    if (p + size > b.length) return;
    yield { op, at: p, size, b };
    p += size;
  }
}
const sprmByte = (s) => s.b[s.at];
const sprmU16 = (s) => u16(s.b, s.at);
const sprmU32 = (s) => u32(s.b, s.at);

/* ---------- FKP / PLC readers ---------- */
function plcPairs(tbl, fc, lcb, cbData) { // a PLC: (n+1) cps then n data entries of cbData bytes
  if (!lcb) return { cps: [], data: [] };
  const n = Math.floor((lcb - 4) / (4 + cbData));
  const cps = [], data = [];
  for (let i = 0; i <= n; i++) cps.push(u32(tbl, fc + i * 4));
  for (let i = 0; i < n; i++) data.push(tbl.subarray(fc + (n + 1) * 4 + i * cbData, fc + (n + 1) * 4 + (i + 1) * cbData));
  return { cps, data };
}
/* All FKP pages of one kind → [{ fc0, fc1, grpprl, istd? }] sorted by file offset. */
function readFkps(f, pairIndex, kind) {
  const { fc, lcb } = f.fib(pairIndex);
  const { data } = plcPairs(f.tbl, fc, lcb, 4);
  const runs = [];
  for (const d of data) {
    const page = (u32(d, 0) & 0x3fffff) * 512;
    if (page + 512 > f.wd.length) continue;
    const pg = f.wd.subarray(page, page + 512);
    const crun = pg[511];
    for (let i = 0; i < crun; i++) {
      const fc0 = u32(pg, i * 4), fc1 = u32(pg, (i + 1) * 4);
      if (kind === "chp") {
        const o = pg[4 * (crun + 1) + i] * 2;
        const grpprl = o ? pg.subarray(o + 1, o + 1 + pg[o]) : new Uint8Array(0);
        runs.push({ fc0, fc1, grpprl });
      } else {
        const o = pg[4 * (crun + 1) + i * 13] * 2;
        if (!o) { runs.push({ fc0, fc1, istd: 0, grpprl: new Uint8Array(0) }); continue; }
        let cb = pg[o], start = o + 1, len;
        if (cb) len = cb * 2 - 1; else { cb = pg[o + 1]; start = o + 2; len = cb * 2; }
        const body = pg.subarray(start, start + len);
        runs.push({ fc0, fc1, istd: body.length >= 2 ? u16(body, 0) : 0, grpprl: body.subarray(2) });
      }
    }
  }
  runs.sort((a, b) => a.fc0 - b.fc0);
  return runs;
}
function runAt(runs, fc) { // binary search: the run containing file offset fc
  let lo = 0, hi = runs.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; const r = runs[m]; if (fc < r.fc0) hi = m - 1; else if (fc >= r.fc1) lo = m + 1; else return r; }
  return null;
}

/* ---------- styles (STSH) ---------- */
function readStyles(f) {
  const out = { styles: [], defaultFont: null };
  const { fc, lcb } = f.fib(1);
  if (!lcb) return out;
  const t = f.tbl;
  const cbStshi = u16(t, fc);
  const sh = t.subarray(fc + 2, fc + 2 + cbStshi);
  const cstd = u16(sh, 0), cbBase = u16(sh, 2);
  out.defaultFont = sh.length >= 14 ? u16(sh, 12) : null;
  let p = fc + 2 + cbStshi;
  const end = fc + lcb;
  for (let i = 0; i < cstd && p + 2 <= end; i++) {
    const cbStd = u16(t, p); p += 2;
    if (!cbStd) { out.styles.push(null); continue; }
    const s = t.subarray(p, p + cbStd); p += cbStd;
    const st = { sti: u16(s, 0) & 0xfff, stk: u16(s, 2) & 0xf, base: u16(s, 2) >> 4, name: "", papx: new Uint8Array(0), chpx: new Uint8Array(0) };
    try {
      const cch = u16(s, cbBase);
      st.name = new TextDecoder("utf-16le").decode(s.subarray(cbBase + 2, cbBase + 2 + cch * 2));
      let q = cbBase + 2 + (cch + 1) * 2;
      const cupx = u16(s, 4) & 0xf;
      const upx = [];
      for (let k = 0; k < cupx && q + 2 <= s.length; k++) { const cb = u16(s, q); upx.push(s.subarray(q + 2, q + 2 + cb)); q += 2 + cb + (cb & 1); }
      if (st.stk === 1) { if (upx[0] && upx[0].length >= 2) st.papx = upx[0].subarray(2); if (upx[1]) st.chpx = upx[1]; }
      else if (st.stk === 2 && upx[0]) st.chpx = upx[0];
    } catch { /* a malformed style simply carries no properties */ }
    out.styles.push(st);
  }
  return out;
}

/* ---------- fonts (SttbfFfn) ---------- */
function readFonts(f) {
  const { fc, lcb } = f.fib(15);
  const names = [];
  if (!lcb) return names;
  try {
    const t = f.tbl;
    const dec = new TextDecoder("utf-16le");
    let p = fc;
    const cData = u16(t, p); p += 2;
    p += 2; // cbExtra
    for (let i = 0; i < cData && p < fc + lcb; i++) {
      const cb = t[p]; // cbFfnM1: the FFN is cb+1 bytes after this byte
      const rec = t.subarray(p + 1, p + 1 + cb);
      let e = 39; while (e + 1 < rec.length && (rec[e] || rec[e + 1])) e += 2; // the name: UTF-16, null-terminated, after the fixed 39-byte header
      names.push(dec.decode(rec.subarray(39, e)));
      p += cb + 1;
    }
  } catch { /* fonts are cosmetic */ }
  return names;
}

/* ---------- lists (PlfLst + PlfLfo) ---------- */
/** → function (ilfo, ilvl) → "bullet" | "ordered" | null */
function readLists(f) {
  const lst = f.fib(73), lfo = f.fib(74);
  const kindOfLsid = new Map(); // lsid → [nfc per level]
  const lfoLsid = [];           // ilfo-1 → lsid
  try {
    if (lst.lcb) {
      const t = f.tbl; let p = lst.fc;
      const c = u16(t, p); p += 2;
      const lstf = [];
      for (let i = 0; i < c; i++) { lstf.push({ lsid: i32(t, p), simple: !!(t[p + 26] & 1) }); p += 28; }
      for (const l of lstf) {
        const levels = [];
        for (let k = 0; k < (l.simple ? 1 : 9); k++) {
          const nfc = t[p + 4], cbChp = t[p + 24], cbPap = t[p + 25];
          p += 28 + cbPap + cbChp;
          const cch = u16(t, p); p += 2 + cch * 2;
          levels.push(nfc);
        }
        kindOfLsid.set(l.lsid, levels);
      }
    }
    if (lfo.lcb) {
      const t = f.tbl; const n = i32(t, lfo.fc);
      for (let i = 0; i < n && i < 4096; i++) lfoLsid.push(i32(t, lfo.fc + 4 + i * 16));
    }
  } catch { /* an unreadable list table: paragraphs simply don't become lists */ }
  return (ilfo, ilvl) => {
    if (!ilfo || ilfo < 1 || ilfo > 2047) return null;
    const levels = kindOfLsid.get(lfoLsid[ilfo - 1]);
    if (!levels) return null;
    const nfc = levels[Math.min(ilvl, levels.length - 1)];
    return nfc === 23 ? "bullet" : nfc === 255 ? null : "ordered";
  };
}

/* ---------- property resolution ---------- */
const tog = (cur, v) => (v === 0 ? false : v === 1 ? true : v === 0x80 ? cur : v === 0x81 ? !cur : cur);
function applyChp(p, bytes) {
  for (const s of sprms(bytes)) {
    switch (s.op) {
      case 0x0835: p.bold = tog(!!p.bold, sprmByte(s)); break;
      case 0x0836: p.italic = tog(!!p.italic, sprmByte(s)); break;
      case 0x0837: case 0x2a53: p.strike = tog(!!p.strike, sprmByte(s)); break;
      case 0x2a3e: p.underline = sprmByte(s) !== 0; break;
      case 0x2a48: p.iss = sprmByte(s); break;
      case 0x4845: if (p.iss == null) p.pos = i16(s.b, s.at); break; // raised / lowered by half-points (LibreOffice writes this instead of iss)
      case 0x2a0c: p.highlight = sprmByte(s); break;
      case 0x2a42: p.ico = sprmByte(s); break;
      case 0x6870: p.cv = sprmU32(s); break;
      case 0x4a43: p.hps = sprmU16(s); break;
      case 0x4a4f: p.ftc = sprmU16(s); break;
      case 0x4a30: p.cstyle = sprmU16(s); break;
      case 0x0855: p.spec = sprmByte(s) === 1; break;
      case 0x6a03: p.pic = sprmU32(s); break;
      case 0x0806: p.data = sprmByte(s) === 1; break;
      case 0x0800: p.revDel = sprmByte(s) === 1; break;
      case 0x0801: p.revIns = sprmByte(s) === 1; break;
      default: break;
    }
  }
  return p;
}
function applyPap(p, bytes) {
  for (const s of sprms(bytes)) {
    switch (s.op) {
      case 0x2403: case 0x2461: p.jc = sprmByte(s); break;
      case 0x260a: p.ilvl = sprmByte(s); break;
      case 0x460b: p.ilfo = i16(s.b, s.at); break;
      case 0x2416: p.inTable = sprmByte(s) === 1; break;
      case 0x2417: p.ttp = sprmByte(s) === 1; break;
      case 0x6649: p.itap = sprmU32(s); break;
      case 0x840f: case 0x845e: p.left = i16(s.b, s.at); break;
      case 0x8411: case 0x8460: p.first = i16(s.b, s.at); break;
      case 0xd608: p.tdef = s.b.subarray(s.at, s.at + s.size); break;
      default: break;
    }
  }
  return p;
}

/* ---------- pictures (the Data stream) ---------- */
const BLIP = { 0x46a: "jpeg", 0x46b: "jpeg", 0x6e2: "jpeg", 0x6e3: "jpeg", 0x6e0: "png", 0x6e1: "png" }; // recInstance → kind (JPEG, CMYK JPEG, PNG)
const MIME = { jpeg: "image/jpeg", png: "image/png" };
const hasMagic = (b, kind) => (kind === "png" ? b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 : b[0] === 0xff && b[1] === 0xd8);
/** → { kind, bytes, wTw, hTw } for a JPEG/PNG picture at `pos` in the Data stream, or { kind: other|null } when it cannot be carried. */
function readPicture(d, pos) {
  try {
    if (!d || pos + 0x44 > d.length) return { kind: null };
    const cbHeader = u16(d, pos + 4);
    let p = pos + cbHeader;
    if (u16(d, pos + 6) === 0x66) p += 1 + d[p]; // a named picture: a length byte + name precede the OfficeArt data
    const end = Math.min(d.length, pos + u32(d, pos));
    const dxa = i16(d, pos + 28), dya = i16(d, pos + 30), mx = u16(d, pos + 32), my = u16(d, pos + 34);
    let other = null;
    while (p + 8 <= end) {
      const w = u16(d, p), type = u16(d, p + 2), len = u32(d, p + 4);
      if (type === 0xf007) { // OfficeArtFBSE — a file-block entry wrapping the BLIP
        const q = p + 8 + 36 + d[p + 8 + 33];
        const bi = u16(d, q) >> 4, bt = u16(d, q + 2), bl = u32(d, q + 4);
        const kind = BLIP[bi];
        if (kind) {
          const skip = (bi === 0x46b || bi === 0x6e3 || bi === 0x6e1 ? 32 : 16) + 1; // the UID(s) and a tag byte
          const bytes = d.slice(q + 8 + skip, q + 8 + bl);
          if (hasMagic(bytes, kind)) return { kind, bytes, wTw: Math.round((dxa * mx) / 1000), hTw: Math.round((dya * my) / 1000) };
        }
        other = other || (bt === 0xf01a ? "EMF" : bt === 0xf01b ? "WMF" : bt === 0xf01c ? "PICT" : bt === 0xf01f ? "bitmap" : bt === 0xf029 ? "TIFF" : "image");
        p += 8 + len; continue;
      }
      p += (w & 15) === 15 && type !== 0xf007 ? 8 : 8 + len; // containers: descend; atoms: skip
    }
    return { kind: other ? "other" : null, other };
  } catch { return { kind: null }; }
}
const b64 = (u8) => { let s = ""; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH)); return btoa(s); };
const pngSize = (b) => (b.length > 24 ? { w: ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0, h: ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0 } : null);

/* ---------- the reader ---------- */
const PLACEHOLDER = (what) => `<w:r><w:rPr><w:i/></w:rPr><w:t>[${what} not carried over from the .doc]</w:t></w:r>`;
const PAGE_BREAK = '<w:r><w:br w:type="page"/></w:r>';

export function readDocStructure(arrayBuffer) {
  const cfb = parseCfb(arrayBuffer);
  const f = readWordFile(cfb);
  const raw = decodePieces(f.wd, f.pieces);
  const st = readStyles(f);
  const fonts = readFonts(f);
  const listKind = readLists(f);
  const chpRuns = readFkps(f, 12, "chp");
  const papRuns = readFkps(f, 13, "pap");
  const dataStream = cfb.entries.Data ? cfb.readStream(cfb.entries.Data) : null;
  const media = [];
  const report = { pictures: 0, picturesLost: 0, shapes: 0, nestedTables: 0, trackedChanges: 0, lists: 0, tables: 0, paragraphs: 0 };

  // cp → file offset
  const pieceAt = (cp) => { let lo = 0, hi = f.pieces.length - 1; while (lo <= hi) { const m = (lo + hi) >> 1; const q = f.pieces[m]; if (cp < q.cp) hi = m - 1; else if (cp >= q.cp + q.chars) lo = m + 1; else return q; } return null; };
  const fcOf = (cp) => { const pc = pieceAt(cp); return pc ? pc.fc + (cp - pc.cp) * (pc.compressed ? 1 : 2) : -1; };

  /* style chains */
  const style = (i) => (i != null && st.styles[i]) || null;
  const chain = (i) => { const out = []; const seen = new Set(); let s = style(i); while (s && !seen.has(s)) { seen.add(s); out.unshift(s); s = s.base !== 0xfff && s.base !== 4095 ? style(s.base) : null; } return out; };
  const chpCache = new Map(), papCache = new Map();
  const styleChp = (i) => { if (!chpCache.has(i)) chpCache.set(i, chain(i).reduce((p, s) => applyChp(p, s.chpx), {})); return chpCache.get(i); };
  const stylePap = (i) => { if (!papCache.has(i)) papCache.set(i, chain(i).reduce((p, s) => applyPap(p, s.papx), {})); return papCache.get(i); };
  const headingLevel = (i) => { const s = style(i); if (!s) return null; const m = /^heading ([1-9])$/.exec(s.name.toLowerCase()); const lvl = m ? Number(m[1]) : s.sti >= 1 && s.sti <= 9 ? s.sti : null; return lvl && lvl <= 3 ? lvl : null; };
  const isTitle = (i) => { const s = style(i); return !!s && (s.sti === 62 || s.name.toLowerCase() === "title"); };

  // defaults come from the Normal style so the saved .docx can inherit them instead of repeating them on every run
  const normal = styleChp(0);
  const fontName = (ftc) => (ftc != null && fonts[ftc]) || null;
  const baseFont = fontName(normal.ftc != null ? normal.ftc : st.defaultFont);
  const baseHps = normal.hps || 20;
  const defaults = { font: baseFont, halfPts: baseHps };

  const marksOf = (p) => {
    const marks = [];
    if (p.bold) marks.push({ type: "bold" });
    if (p.italic) marks.push({ type: "italic" });
    if (p.underline) marks.push({ type: "underline" });
    if (p.strike) marks.push({ type: "strike" });
    const sup = p.iss === 1 || (p.iss == null && p.pos > 0), sub = p.iss === 2 || (p.iss == null && p.pos < 0);
    if (sup) marks.push({ type: "superscript" });
    if (sub) marks.push({ type: "subscript" });
    if (p.highlight && ICO[p.highlight] && HIGHLIGHT[ICO[p.highlight]]) marks.push({ type: "highlight", attrs: { color: HIGHLIGHT[ICO[p.highlight]] } });
    const ts = {};
    let hex = null;
    if (p.cv != null && p.cv >>> 24 !== 0xff) hex = "#" + [p.cv & 0xff, (p.cv >> 8) & 0xff, (p.cv >> 16) & 0xff].map((n) => n.toString(16).padStart(2, "0")).join("").toUpperCase();
    else if (p.ico && ICO[p.ico] && ICO[p.ico] !== "black") hex = HIGHLIGHT[ICO[p.ico]] || null;
    if (hex && hex !== "#000000") ts.color = hex; // design-exempt: file-format colour data (not UI colour)
    if (p.hps && p.hps !== baseHps && !((sup || sub) && p.hps < baseHps)) ts[FONT_SIZE_ATTR] = `${p.hps / 2}pt`;
    const fam = fontName(p.ftc);
    if (fam && fam !== baseFont) ts.fontFamily = fam;
    if (Object.keys(ts).length) marks.push({ type: "textStyle", attrs: ts });
    return marks;
  };

  /* chars → [{cp0, cp1, props}] — the formatting runs covering a cp range */
  const charRuns = (cp0, cp1) => {
    const out = [];
    for (let pi = Math.max(0, f.pieces.indexOf(pieceAt(cp0))); pi < f.pieces.length; pi++) {
      const pc = f.pieces[pi];
      if (pc.cp >= cp1) break;
      if (pc.cp + pc.chars <= cp0) continue;
      const bpc = pc.compressed ? 1 : 2;
      let cp = Math.max(cp0, pc.cp);
      const stop = Math.min(cp1, pc.cp + pc.chars);
      while (cp < stop) {
        const fc = pc.fc + (cp - pc.cp) * bpc;
        const r = runAt(chpRuns, fc);
        let next = stop;
        if (r) next = Math.min(stop, pc.cp + Math.max(1, Math.ceil((r.fc1 - pc.fc) / bpc)));
        out.push({ cp0: cp, cp1: next, grp: r ? r.grpprl : null });
        cp = next;
      }
    }
    return out;
  };

  /* inline content of one paragraph's text range */
  const fields = [];
  const inlineOf = (cp0, cp1, para) => {
    const out = [];
    const pushText = (text, marks) => {
      if (!text) return;
      const mk = marks.length ? marks : undefined;
      const last = out[out.length - 1];
      if (last && last.type === "text" && JSON.stringify(last.marks) === JSON.stringify(mk)) { last.text += text; return; }
      const n = { type: "text", text }; if (mk) n.marks = mk; out.push(n);
    };
    const atom = (xml, label, marks) => { const n = { type: "docRaw", attrs: { xml, label } }; if (marks && marks.length) n.marks = marks; out.push(n); };
    for (const run of charRuns(cp0, cp1)) {
      // paragraph style → character style → direct sprms (toggles resolve against whatever is beneath them)
      let p = { ...(para.suppressStyle ? {} : styleChp(para.istd)) };
      const cs = run.grp ? [...sprms(run.grp)].find((x) => x.op === 0x4a30) : null;
      if (cs) p = { ...p, ...styleChp(sprmU16(cs)) };
      if (run.grp) applyChp(p, run.grp);
      if (p.revDel || p.revIns) report.trackedChanges++;
      const marks = marksOf(p);
      const link = fields.length ? fields.map((x) => x.link).filter(Boolean).pop() : null;
      const allMarks = link ? [...marks, { type: "link", attrs: link }] : marks;
      for (let cp = run.cp0; cp < run.cp1; cp++) {
        const c = raw.charCodeAt(cp);
        if (c === 0x13) { fields.push({ phase: "instr", instr: "", link: null }); continue; }
        if (c === 0x14) { const top = fields[fields.length - 1]; if (top) { top.phase = "result"; const m = /^\s*HYPERLINK\s+(?:\\l\s+"([^"]*)"|"([^"]*)")/i.exec(top.instr); if (m) top.link = m[1] != null ? { href: "#" + m[1], rid: null, anchor: m[1] } : { href: m[2], rid: null, anchor: null }; } continue; }
        if (c === 0x15) { fields.pop(); continue; }
        const top = fields[fields.length - 1];
        if (fields.some((x) => x.phase === "instr")) { if (top && top.phase === "instr" && c >= 0x20) top.instr += raw[cp]; continue; }
        if (c === 0x01) {
          if (!(p.spec && p.pic != null && !p.data)) continue; // a field marker or form-field data, not a picture
          const pic = readPicture(dataStream, p.pic);
          if (pic.kind === "jpeg" || pic.kind === "png") {
            const n = media.length + 1, ext = pic.kind === "png" ? "png" : "jpg", rid = `rIdPic${n}`;
            media.push({ name: `image${n}.${ext}`, ext, rid, bytes: pic.bytes });
            const nat = pic.kind === "png" ? pngSize(pic.bytes) : null;
            const wPx = pic.wTw > 0 ? Math.max(1, Math.round(pic.wTw / 15)) : nat ? nat.w : 200, hPx = pic.hTw > 0 ? Math.max(1, Math.round(pic.hTw / 15)) : nat ? nat.h : 150;
            const cx = wPx * 9525, cy = hPx * 9525;
            const xml = `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${n}" name="Picture ${n}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${n}" name="image${n}.${ext}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
            out.push({ type: "docImage", attrs: { xml, src: `data:${MIME[pic.kind]};base64,${b64(pic.bytes)}`, width: wPx, height: hPx, alt: "" } });
            report.pictures++;
          } else { report.picturesLost++; atom(PLACEHOLDER(pic.other ? `${pic.other} picture` : "picture"), "picture not carried over", []); }
          continue;
        }
        if (c === 0x08) { report.shapes++; atom(PLACEHOLDER("shape"), "shape not carried over", []); continue; }
        if (c === 0x02 || c === 0x05 || c === 0x0d || c === 0x07) continue;
        if (c === 0x09) { pushText("\t", allMarks); continue; }
        if (c === 0x0b) { out.push({ type: "hardBreak" }); continue; }
        if (c === 0x0c) { atom(PAGE_BREAK, "page break", []); continue; }
        if (c === 0x1e) { pushText("-", allMarks); continue; }
        if (c === 0x1f || c < 0x20 || c === 0xfffe || c === 0xffff) continue;
        pushText(raw[cp], allMarks);
      }
    }
    return out;
  };

  /* paragraph units: split the body at paragraph marks */
  const units = [];
  const boundaries = new Set(papRuns.map((r) => r.fc1));
  let start = 0;
  for (let cp = 0; cp < raw.length; cp++) {
    const c = raw.charCodeAt(cp);
    let ends = c === 0x0d || c === 0x07;
    if (!ends && c === 0x0c) { const pc = pieceAt(cp); ends = !!pc && boundaries.has(fcOf(cp) + (pc.compressed ? 1 : 2)); } // a section break ends its paragraph; a page break does not
    if (ends || cp === raw.length - 1) { units.push({ cp0: start, cp1: cp + 1, textEnd: ends ? cp : cp + 1, term: ends ? c : 0 }); start = cp + 1; }
  }
  for (const u of units) {
    const fc = fcOf(u.cp1 - 1);
    const r = fc >= 0 ? runAt(papRuns, fc) : null;
    const istd = r ? r.istd : 0;
    u.istd = istd;
    u.props = applyPap({ ...stylePap(istd) }, r ? r.grpprl : new Uint8Array(0));
    u.heading = headingLevel(istd);
    u.title = isTitle(istd);
  }

  /* block building (lists grouped like the .docx reader does) */
  const paraNode = (u) => {
    const p = u.props;
    const attrs = { pStyle: u.title ? "Title" : null, textAlign: ["left", "center", "right", "justify"][p.jc] || "left", pprx: "", pMark: null, pFmt: null };
    if (!p.ilfo && (p.left || p.first) && !u.heading) attrs.pprx = `<w:ind w:left="${Math.max(0, p.left || 0)}"${p.first ? (p.first < 0 ? ` w:hanging="${-p.first}"` : ` w:firstLine="${p.first}"`) : ""}/>`;
    const suppressStyle = !!(u.heading || u.title);
    const content = inlineOf(u.cp0, u.textEnd, { istd: u.istd, suppressStyle });
    const node = { type: u.heading ? "heading" : "paragraph", attrs: u.heading ? { ...attrs, level: u.heading } : attrs };
    if (content.length) node.content = content;
    report.paragraphs++;
    return node;
  };
  const buildBlocks = (list) => {
    const out = [];
    let stack = [];
    for (const u of list) {
      const node = paraNode(u);
      const kind = u.props.ilfo ? listKind(u.props.ilfo, u.props.ilvl || 0) : null;
      if (!kind) { stack = []; out.push(node); continue; }
      const lvl = u.props.ilvl || 0;
      const lk = kind === "bullet" ? "bulletList" : "orderedList";
      while (stack.length && stack[stack.length - 1].ilvl > lvl) stack.pop();
      if (stack.length && stack[stack.length - 1].ilvl === lvl && stack[stack.length - 1].key !== u.props.ilfo) stack.pop();
      if (!stack.length || stack[stack.length - 1].ilvl < lvl) {
        const l = { type: lk, attrs: { numId: null }, content: [] };
        const parent = stack[stack.length - 1];
        if (parent && parent.last) parent.last.content.push(l); else out.push(l);
        stack.push({ ilvl: lvl, key: u.props.ilfo, list: l, last: null });
        report.lists++;
      }
      const top = stack[stack.length - 1];
      const item = { type: "listItem", content: [node] };
      top.list.content.push(item); top.last = item;
    }
    return out;
  };

  /* tables: cell mark 0x07 ends a cell; a "row end" paragraph ends the row and carries the column grid */
  const parseTdef = (b) => {
    if (!b || b.length < 4) return null;
    const n = b[2]; // itcMac (after the 2-byte length)
    if (!n || 3 + (n + 1) * 2 > b.length) return null;
    const centers = []; for (let i = 0; i <= n; i++) centers.push(i16(b, 3 + i * 2));
    const tcs = [];
    const tc0 = 3 + (n + 1) * 2;
    for (let i = 0; i < n; i++) { const o = tc0 + i * 20; tcs.push(o + 2 <= b.length ? u16(b, o) : 0); }
    return { centers, tcs };
  };
  const tableNode = (rows) => {
    // ONE grid for the whole table: every distinct column boundary in any row. A cell then spans however many grid
    // columns lie between its own left and right edge — which is how a horizontal merge (or a ragged row) shows up.
    const edges = [];
    for (const r of rows) if (r.tdef) for (const c of r.tdef.centers) edges.push(c);
    edges.sort((a, b) => a - b);
    const grid = [];
    for (const e of edges) if (!grid.length || e - grid[grid.length - 1] > 8) grid.push(e);
    const gridCols = grid.slice(1).map((c, i) => Math.max(1, c - grid[i]));
    const colAt = (twip) => { let best = 0, d = Infinity; grid.forEach((g, i) => { const x = Math.abs(g - twip); if (x < d) { d = x; best = i; } }); return best; };
    const owners = []; // grid column → the cell spanning down it
    const trs = rows.map((r) => {
      const t = r.tdef; const cells = [];
      const tcgrfs = t ? t.tcs : [];
      // tdef cells that make ONE cell: a first-merged cell followed by its merged-away neighbours
      const groups = [];
      for (let i = 0; i < tcgrfs.length; i++) { if ((tcgrfs[i] & 2) && groups.length) groups[groups.length - 1].push(i); else groups.push([i]); }
      const grp = (i) => (t && groups.length === r.cells.length ? groups[i] : t && tcgrfs.length === r.cells.length ? [i] : null);
      let nextCol = 0;
      r.cells.forEach((cellBlocks, i) => {
        const g = grp(i);
        let c0 = nextCol, span = 1, widths = null;
        if (g && grid.length > 1) {
          c0 = colAt(t.centers[g[0]]);
          const c1 = colAt(t.centers[g[g.length - 1] + 1]);
          span = Math.max(1, c1 - c0);
          widths = gridCols.slice(c0, c0 + span).map((w) => Math.max(1, Math.round(w / 15)));
        }
        nextCol = c0 + span;
        const flags = g ? tcgrfs[g[0]] : 0;
        const vMerge = !!(flags & 0x20), vRestart = !!(flags & 0x40);
        if (vMerge && !vRestart && owners[c0]) { owners[c0].attrs.rowspan += 1; return; } // continues the cell above
        const cell = { type: "tableCell", attrs: { colspan: span, rowspan: 1, colwidth: widths, tcpr: "" }, content: cellBlocks.length ? cellBlocks : [{ type: "paragraph", attrs: { pStyle: null, textAlign: "left", pprx: "", pMark: null, pFmt: null } }] };
        cells.push(cell);
        for (let k = 0; k < span; k++) owners[c0 + k] = vMerge ? cell : null;
      });
      return { type: "tableRow", attrs: { trpr: "" }, content: cells };
    }).filter((r) => r.content.length);
    report.tables++;
    return { type: "table", attrs: { tblpr: "", gridCols, gridChange: "" }, content: trs };
  };

  const body = [];
  let pending = [];
  let tbl = null; // { rows: [], cur: [], cell: [] }
  const flushPending = () => { if (pending.length) { body.push(...buildBlocks(pending)); pending = []; } };
  const flushTable = () => { if (tbl) { if (tbl.cell.length) { tbl.cur.push(buildBlocks(tbl.cell)); tbl.cell = []; } if (tbl.cur.length) tbl.rows.push({ cells: tbl.cur, tdef: tbl.tdef }); body.push(tableNode(tbl.rows)); tbl = null; } };
  for (const u of units) {
    const p = u.props;
    const inTbl = p.inTable || (p.itap || 0) >= 1;
    if (!inTbl) { flushTable(); pending.push(u); continue; }
    flushPending();
    if (!tbl) tbl = { rows: [], cur: [], cell: [], tdef: null };
    const depth = p.itap || 1;
    if (depth > 1) { report.nestedTables++; tbl.cell.push(u); continue; } // nested table: its text joins the outer cell
    if (p.ttp) { // end of row
      if (tbl.cell.length) { tbl.cur.push(buildBlocks(tbl.cell)); tbl.cell = []; }
      tbl.tdef = parseTdef(p.tdef) || tbl.tdef;
      tbl.rows.push({ cells: tbl.cur, tdef: parseTdef(p.tdef) });
      tbl.cur = [];
      continue;
    }
    if (u.cp1 - u.cp0 === 1 && u.term === 0x07 && !tbl.cell.length) { tbl.cur.push([]); continue; } // an empty cell
    tbl.cell.push(u);
    if (u.term === 0x07) { tbl.cur.push(buildBlocks(tbl.cell)); tbl.cell = []; }
  }
  flushTable(); flushPending();
  if (!body.length) body.push({ type: "paragraph", attrs: { pStyle: null, textAlign: "left", pprx: "", pMark: null, pFmt: null } });
  return { doc: { type: "doc", content: body }, report, defaults, media };
}

/** The sentence the editor shows above a converted .doc — names exactly what did and did not come across. */
export function describeDocImport(report) {
  const missing = [];
  if (report.picturesLost) missing.push(`${report.picturesLost} picture${report.picturesLost === 1 ? "" : "s"} in a format a browser cannot draw (marked in the text)`);
  if (report.shapes) missing.push(`${report.shapes} drawn shape${report.shapes === 1 ? "" : "s"} (marked in the text)`);
  if (report.nestedTables) missing.push("nested tables (their text sits in the outer cell)");
  if (report.trackedChanges) missing.push("tracked changes (shown as plain text — open and save it as .docx in Word first to keep them)");
  const tail = missing.length ? ` Not carried over: ${missing.join("; ")}; also text boxes, headers, footers and footnotes.` : " Not carried over: text boxes, headers, footers and footnotes.";
  return `Word 97–2003 file — its text, headings, bold / italic / underline, lists, tables and JPEG / PNG pictures come across.${tail} Saving creates a new .docx next to it; the original .doc is kept.`;
}

export { SAVE_AS };
