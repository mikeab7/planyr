/* Browser-only .docx → plain text (no dependency).
 *
 * A .docx is a ZIP whose `word/document.xml` holds the body as WordprocessingML.
 * We read just that one entry — locate it via the ZIP central directory and inflate
 * it with the platform's native DecompressionStream (`deflate-raw`) — then turn the
 * XML into text: each `<w:p>` is a paragraph (newline), `<w:tab/>`/`<w:br/>` become
 * tab/newline, and the visible text lives in `<w:t>` runs. Pure + async; runs in the
 * browser and in Node 22 (vitest), so it's unit-testable against real survey files.
 *
 * Scope: standard (non-ZIP64, non-encrypted) .docx, which is what Word/Google Docs
 * emit. We read the central directory (always carries correct sizes/offsets), so a
 * streamed entry with a trailing data descriptor is handled fine. */

const u16 = (dv, o) => dv.getUint16(o, true);
const u32 = (dv, o) => dv.getUint32(o, true);

const EOCD_SIG = 0x06054b50; // PK\x05\x06 — end of central directory
const CEN_SIG = 0x02014b50;  // PK\x01\x02 — central directory file header
const LOC_SIG = 0x04034b50;  // PK\x03\x04 — local file header

// Find the End Of Central Directory record by scanning backward from the end
// (it sits in the last 22 bytes + an optional ≤64 KB comment).
function findEOCD(dv) {
  const len = dv.byteLength;
  const min = Math.max(0, len - 22 - 0xffff);
  for (let i = len - 22; i >= min; i--) {
    // A bare signature can also appear inside the comment/stored data — accept it
    // only when the comment-length field is consistent with the file end.
    if (u32(dv, i) === EOCD_SIG && i + 22 + u16(dv, i + 20) === len) return i;
  }
  return -1;
}

// Inflate raw DEFLATE bytes via the native stream API → Uint8Array.
async function inflateRaw(bytes) {
  try {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    throw new Error("Corrupt .docx (could not inflate word/document.xml).");
  }
}

// Pull one named entry's raw bytes out of a ZIP ArrayBuffer (inflating if needed).
async function readZipEntry(arrayBuffer, wantName) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  const eocd = findEOCD(dv);
  if (eocd < 0) throw new Error("Not a .docx (no ZIP end-of-directory record).");
  const count = u16(dv, eocd + 10);
  let p = u32(dv, eocd + 16); // central directory offset
  const dec = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length) throw new Error("Corrupt .docx (truncated central directory).");
    if (u32(dv, p) !== CEN_SIG) break;
    const method = u16(dv, p + 10);
    const compSize = u32(dv, p + 20);
    const nameLen = u16(dv, p + 28);
    const extraLen = u16(dv, p + 30);
    const commentLen = u16(dv, p + 32);
    const localOff = u32(dv, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    if (name === wantName) {
      // Jump to the local header to find where the data actually starts (its
      // name/extra lengths can differ from the central record's).
      if (localOff + 30 > bytes.length) throw new Error("Corrupt .docx (bad local header offset).");
      if (u32(dv, localOff) !== LOC_SIG) throw new Error("Corrupt .docx (bad local header).");
      const lNameLen = u16(dv, localOff + 26);
      const lExtraLen = u16(dv, localOff + 28);
      const dataStart = localOff + 30 + lNameLen + lExtraLen;
      if (dataStart + compSize > bytes.length) throw new Error("Corrupt .docx (truncated entry data).");
      const data = bytes.subarray(dataStart, dataStart + compSize);
      if (method === 0) return data;          // stored
      if (method === 8) return inflateRaw(data); // deflate
      throw new Error(`Unsupported .docx compression (method ${method}).`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`Entry "${wantName}" not found in the .docx.`);
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decodeEntities(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      // valid Unicode scalar value only (≤ 0x10FFFF, not a surrogate) — else leave as-is
      return (cp >= 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff)) ? String.fromCodePoint(cp) : m;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, e) ? ENTITIES[e] : m;
  });
}

/* Turn a WordprocessingML document.xml string into readable text. Exported so the
 * XML→text step is unit-testable without building a ZIP. Each paragraph becomes its
 * own line — which the metes-and-bounds parser relies on to segment courses. */
export function documentXmlToText(xml) {
  if (!xml) return "";
  let s = String(xml)
    .replace(/<w:tab\b[^>]*\/?>/g, "\t")
    .replace(/<w:br\b[^>]*\/?>/g, "\n")
    .replace(/<\/w:p>/g, "\n") // paragraph end → newline
    .replace(/<[^>]+>/g, "");  // drop every remaining tag (only run text is left)
  s = decodeEntities(s);
  // Tidy whitespace without collapsing the paragraph structure.
  s = s.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

/* Read a .docx (as an ArrayBuffer) into plain text. */
export async function docxToText(arrayBuffer) {
  let xmlBytes;
  try {
    xmlBytes = await readZipEntry(arrayBuffer, "word/document.xml");
  } catch (e) {
    // Reframe any low-level ZIP/inflate fault (e.g. a DataView RangeError on a
    // truncated file) into a friendly message; pass our own .docx errors through.
    if (/docx|not found|unsupported|zip/i.test((e && e.message) || "")) throw e;
    throw new Error("Couldn't read that .docx — it may be corrupt or not a Word file.");
  }
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  return documentXmlToText(xml);
}

const isDocx = (file) =>
  /\.docx$/i.test(file.name || "") ||
  file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const isPlainText = (file) =>
  /\.(txt|text|md)$/i.test(file.name || "") || (file.type || "").startsWith("text/");

/* Read a dropped/selected file into a legal-description text string. Handles .docx
 * (Word) and plain text; throws a friendly error for anything else (the caller shows
 * it). PDFs are read by the Schedule-B uploader, not here. */
export async function readDeedFile(file) {
  if (!file) throw new Error("No file.");
  if (isDocx(file)) return docxToText(await file.arrayBuffer());
  if (isPlainText(file)) return (await file.text()).trim();
  const ext = (file.name || "").split(".").pop();
  throw new Error(`Can't read a .${ext || "?"} here — drop a Word (.docx) or text (.txt) legal description.`);
}
