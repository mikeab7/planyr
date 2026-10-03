/* Plain-text files ↔ the editor's paragraph-per-line document, byte-faithful on save:
 * the file's own line endings, BOM, encoding and trailing newline are remembered and written back. */
const P = (t) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" });

export function decodeText(input) {
  const u8 = input instanceof Uint8Array ? input : new Uint8Array(input);
  let encoding = "utf-8", off = 0;
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) { encoding = "utf-8-bom"; off = 3; }
  else if (u8[0] === 0xFF && u8[1] === 0xFE) { encoding = "utf-16le"; off = 2; }
  else if (u8[0] === 0xFE && u8[1] === 0xFF) { encoding = "utf-16be"; off = 2; }
  let text;
  if (encoding === "utf-16le") text = new TextDecoder("utf-16le").decode(u8.subarray(off));
  else if (encoding === "utf-16be") text = new TextDecoder("utf-16be").decode(u8.subarray(off));
  else {
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(u8.subarray(off)); }
    catch { text = new TextDecoder("windows-1252").decode(u8.subarray(off)); encoding = "windows-1252"; }
  }
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(^|[^\r])\n/g) || []).length;
  const eol = crlf > lf ? "\r\n" : "\n";
  return { text, encoding, eol };
}

export function txtToDoc(text) {
  const lines = String(text).split(/\r\n|\n|\r/);
  const trailing = lines.length > 1 && lines[lines.length - 1] === "";
  if (trailing) lines.pop();
  return { doc: { type: "doc", content: lines.map(P) }, trailing };
}

export function docToText(doc, { eol = "\n", trailing = false } = {}) {
  const lines = (doc.content || []).map((p) => (p.content || []).map((n) => (n.type === "hardBreak" ? "" : n.text || "")).join(""));
  return lines.join(eol) + (trailing ? eol : "");
}

export function encodeText(text, encoding = "utf-8") {
  if (encoding === "utf-16le" || encoding === "utf-16be") {
    const out = new Uint8Array(2 + text.length * 2);
    const le = encoding === "utf-16le";
    out[0] = le ? 0xFF : 0xFE; out[1] = le ? 0xFE : 0xFF;
    for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i); out[2 + i * 2] = le ? c & 255 : c >> 8; out[3 + i * 2] = le ? c >> 8 : c & 255; }
    return out;
  }
  const body = new TextEncoder().encode(text);
  if (encoding === "utf-8-bom") { const out = new Uint8Array(3 + body.length); out.set([0xEF, 0xBB, 0xBF]); out.set(body, 3); return out; }
  return body; // utf-8 (also the honest landing place for a windows-1252 original — the editor says so)
}
