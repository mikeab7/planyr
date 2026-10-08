/* xlsxRows.js — a minimal STREAMING .xlsx reader for the Comptroller's statewide workbooks
 * (B2158064). Zip central directory → inflate only `xl/sharedStrings.xml` and the first worksheet
 * through DecompressionStream → hand rows to a callback as they are parsed.
 *
 * WHY NOT SheetJS: `XLSX.read` materialises the WHOLE workbook object model; for the school-district
 * and special-district statewide files that sits at the Worker's memory ceiling, so a cache miss
 * was a coin-flip on GC timing and died with Cloudflare error 1102 (a platform kill — it cannot be
 * caught, and the browser then fails to JSON-parse the error page). Here memory is the compressed
 * file + the shared-string table + one row at a time; the caller keeps only the rows it wants.
 *
 * Rows are plain arrays indexed by column (a, b, c… → 0, 1, 2…), numbers as numbers and text as
 * strings — the same shape `sheet_to_json(ws, { header: 1, raw: true })` returned, so the pure
 * extractor in comptrollerRates.js is untouched.
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Central-directory listing: { name → { method, csize, localOffset } }. Pure. */
export function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip file (no end-of-central-directory)");
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const td = new TextDecoder();
  const out = {};
  for (let n = 0; n < count; n++) {
    if (u32(bytes, p) !== 0x02014b50) throw new Error("corrupt zip central directory");
    const method = u16(bytes, p + 10);
    const csize = u32(bytes, p + 20);
    const nameLen = u16(bytes, p + 28), extraLen = u16(bytes, p + 30), commentLen = u16(bytes, p + 32);
    const localOffset = u32(bytes, p + 42);
    out[td.decode(bytes.subarray(p + 46, p + 46 + nameLen))] = { method, csize, localOffset };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** ReadableStream of one entry's decompressed bytes. */
function entryStream(bytes, e) {
  if (u32(bytes, e.localOffset) !== 0x04034b50) throw new Error("corrupt zip local header");
  const start = e.localOffset + 30 + u16(bytes, e.localOffset + 26) + u16(bytes, e.localOffset + 28);
  const raw = bytes.subarray(start, start + e.csize);
  const src = new Blob([raw]).stream();
  if (e.method === 0) return src;
  if (e.method === 8) return src.pipeThrough(new DecompressionStream("deflate-raw"));
  throw new Error(`unsupported zip compression method ${e.method}`);
}

/** Decode a stream as UTF-8 text and call `onChunk(textBuffer) → remainder` repeatedly. */
async function eachTextChunk(stream, step) {
  const reader = stream.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (value) buf += dec.decode(value, { stream: !done });
    buf = step(buf, done);
    if (done) break;
  }
}

const unescapeXml = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
  if (g[0] === "#") return String.fromCodePoint(g[1].toLowerCase() === "x" ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10));
  return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[g.toLowerCase()];
});

/** Concatenated text of every <t> in a fragment (rich-text runs join). */
function textOf(frag) {
  let s = "";
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = re.exec(frag))) s += m[1];
  return unescapeXml(s);
}

export async function readSharedStrings(bytes, entries) {
  const e = entries["xl/sharedStrings.xml"];
  if (!e) return [];
  const out = [];
  await eachTextChunk(entryStream(bytes, e), (buf) => {
    let at = 0;
    for (;;) {
      const a = buf.indexOf("<si", at);
      if (a < 0) break;
      const b = buf.indexOf("</si>", a);
      if (b < 0) return buf.slice(a);
      out.push(textOf(buf.slice(a, b)));
      at = b + 5;
    }
    return buf.slice(Math.max(at, buf.length - 8)); // keep a tail so a split "<si" is not lost
  });
  return out;
}

const colIndex = (ref) => {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

function parseRow(rowXml, strings) {
  const row = [];
  const re = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m;
  while ((m = re.exec(rowXml))) {
    const attrs = m[1], inner = m[2];
    if (inner == null) continue;
    const r = /\br="([A-Z]+)\d+"/.exec(attrs);
    if (!r) continue;
    const t = /\bt="([^"]+)"/.exec(attrs);
    const type = t ? t[1] : "n";
    let val;
    if (type === "inlineStr") val = textOf(inner);
    else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      if (!v) continue;
      if (type === "s") val = strings[Number(v[1])];
      else if (type === "str" || type === "e") val = unescapeXml(v[1]);
      else if (type === "b") val = v[1] === "1";
      else val = Number(v[1]);
    }
    row[colIndex(r[1])] = val;
  }
  return row;
}

/** Stream the first worksheet's rows to `onRow(rowArray, rowNumber)`. */
export async function streamXlsxRows(buffer, onRow) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = zipEntries(bytes);
  const sheetName = Object.keys(entries).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10))[0];
  if (!sheetName) throw new Error("no worksheet found in workbook");
  const strings = await readSharedStrings(bytes, entries);
  let n = 0;
  await eachTextChunk(entryStream(bytes, entries[sheetName]), (buf) => {
    let at = 0;
    for (;;) {
      const a = buf.indexOf("<row", at);
      if (a < 0) break;
      const b = buf.indexOf("</row>", a);
      if (b < 0) return buf.slice(a);
      onRow(parseRow(buf.slice(a, b), strings), ++n);
      at = b + 6;
    }
    return buf.slice(Math.max(at, buf.length - 8));
  });
  return n;
}

const clean = (v) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());

/** Rows of a workbook worth keeping for one county: the leading rows (title + header) plus every
 * later row that carries the county's name in any cell. Feeds `extractCountyRows` unchanged. */
export async function countyRowsFromXlsx(buffer, countyName, headRows = 12) {
  const want = clean(countyName).toLowerCase();
  const kept = [];
  await streamXlsxRows(buffer, (row, n) => {
    if (n <= headRows) { kept.push(row); return; }
    for (let i = 0; i < row.length; i++) {
      if (typeof row[i] === "string" && clean(row[i]).toLowerCase() === want) { kept.push(row); return; }
    }
  });
  return kept;
}
