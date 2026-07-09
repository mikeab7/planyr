/* Browser-only legacy .doc (Word 97–2003) → plain text (no dependency).
 *
 * A .docx is a ZIP (see docxText.js); a legacy .doc is a completely different beast — an OLE
 * "Compound File Binary" (CFB / OLE2) container holding several byte streams, with the Word
 * text stored via a *piece table* rather than laid out linearly. We read it in three steps,
 * all with the platform's native APIs (DataView + TextDecoder) so it stays dependency-free and
 * runs in the browser and in Node 22 (vitest), unit-testable against real survey files:
 *
 *   1. CFB container  — verify the OLE magic, build the FAT from the DIFAT, read the directory,
 *      and pull named streams (main-FAT for big streams, mini-FAT for small ones).
 *   2. Word FIB       — the File Information Block at the start of the `WordDocument` stream:
 *      which table stream to use, whether it's encrypted, the body text length, and where the
 *      piece table (CLX) lives.
 *   3. Piece table    — walk the pieces; each is either 8-bit windows-1252 (compressed) or
 *      16-bit UTF-16LE, so we decode with the matching native TextDecoder and concatenate the
 *      body text (clamped to ccpText so footnote/header text doesn't bleed in).
 *
 * Why the native decoders matter: surveyors' minute/second marks are often the windows-1252
 * smart quotes 0x92/0x94 (→ U+2019/U+201D) in the 0x80–0x9F band where cp1252 ≠ Latin-1 — a
 * naive `String.fromCharCode` yields control chars the metes-and-bounds bearing parser won't
 * match, silently dropping the minutes/seconds. `TextDecoder("windows-1252")` maps them right.
 *
 * Scope: Word 97–2003 binary .doc (the common case). Word 6/95, encrypted, and non-Word files
 * throw a friendly, specific error (never silent garbage) telling the user to Save As .docx.
 */

const u16 = (dv, o) => dv.getUint16(o, true);
const u32 = (dv, o) => dv.getUint32(o, true);

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;

const SAVE_AS = "Save it as .docx (File ▸ Save As ▸ Word Document) or paste the description.";

function fail(msg) {
  throw new Error(msg);
}

/* Parse the OLE Compound File Binary container into a { entries, readStream } accessor. */
function parseCfb(arrayBuffer) {
  const bytes = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);
  if (bytes.length < 512) fail("Not a Word .doc file.");
  for (let i = 0; i < 8; i++) if (bytes[i] !== OLE_MAGIC[i]) fail("Not a Word .doc file.");

  const sectorShift = u16(dv, 0x1e);
  if (sectorShift !== 9 && sectorShift !== 12) fail("Unsupported .doc (unexpected sector size).");
  const sectorSize = 1 << sectorShift;
  const miniSectorSize = 1 << u16(dv, 0x20);
  const firstDirSector = u32(dv, 0x30);
  const miniCutoff = u32(dv, 0x38) || 4096;
  const firstMiniFatSector = u32(dv, 0x3c);
  const numMiniFatSectors = u32(dv, 0x40);
  const firstDifatSector = u32(dv, 0x44);
  const numDifatSectors = u32(dv, 0x48);

  // Sector N's bytes start at (N+1)*sectorSize (sector 0 sits right after the 512-byte header;
  // written generically so a 4096-byte-sector file would also resolve correctly).
  const sectorOffset = (n) => (n + 1) * sectorSize;
  const sectorView = (n) => {
    const off = sectorOffset(n);
    if (off + sectorSize > bytes.length) fail("Corrupt .doc (sector past end of file).");
    return new DataView(arrayBuffer, off, sectorSize);
  };

  // 1) DIFAT → the list of FAT sector numbers (109 in the header, then continuation sectors).
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = u32(dv, 0x4c + i * 4);
    if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
  }
  const difEntriesPerSector = sectorSize / 4 - 1; // last slot is the next-DIFAT pointer
  let dif = firstDifatSector;
  const seenDif = new Set();
  let difLeft = numDifatSectors;
  while (dif !== ENDOFCHAIN && dif !== FREESECT && difLeft-- > 0) {
    if (seenDif.has(dif)) fail("Corrupt .doc (cyclic DIFAT).");
    seenDif.add(dif);
    const sdv = sectorView(dif);
    for (let i = 0; i < difEntriesPerSector; i++) {
      const s = u32(sdv, i * 4);
      if (s !== FREESECT && s !== ENDOFCHAIN) fatSectors.push(s);
    }
    dif = u32(sdv, difEntriesPerSector * 4);
  }

  // 2) The FAT itself: concatenate the u32 entries across all FAT sectors.
  const perSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectors.length * perSector);
  for (let i = 0; i < fatSectors.length; i++) {
    const sdv = sectorView(fatSectors[i]);
    for (let j = 0; j < perSector; j++) fat[i * perSector + j] = u32(sdv, j * 4);
  }

  const followChain = (start, fatArr, capSectors) => {
    const chain = [];
    const seen = new Set();
    let s = start;
    while (s !== ENDOFCHAIN && s !== FREESECT) {
      if (s >= fatArr.length) fail("Corrupt .doc (sector index out of range).");
      if (seen.has(s) || chain.length > capSectors + 4) fail("Corrupt .doc (cyclic sector chain).");
      seen.add(s);
      chain.push(s);
      s = fatArr[s];
    }
    return chain;
  };

  const readFromMainFat = (start, size) => {
    const cap = size != null ? Math.ceil(size / sectorSize) : fat.length;
    const chain = followChain(start, fat, cap);
    const out = new Uint8Array(chain.length * sectorSize);
    for (let i = 0; i < chain.length; i++) {
      const off = sectorOffset(chain[i]);
      out.set(bytes.subarray(off, off + sectorSize), i * sectorSize);
    }
    return size != null ? out.subarray(0, size) : out;
  };

  // 3) Directory: 128-byte entries; flat-scan by name (Word's root storage is flat).
  const dirBytes = readFromMainFat(firstDirSector, null);
  const dirDv = new DataView(dirBytes.buffer, dirBytes.byteOffset, dirBytes.byteLength);
  const dec16 = new TextDecoder("utf-16le");
  const entries = {};
  let root = null;
  const count = Math.floor(dirBytes.length / 128);
  for (let e = 0; e < count; e++) {
    const base = e * 128;
    const objType = dirBytes[base + 0x42]; // 1=storage, 2=stream, 5=root
    if (objType !== 1 && objType !== 2 && objType !== 5) continue;
    const nameLen = u16(dirDv, base + 0x40); // bytes incl. UTF-16 terminator
    if (nameLen < 2 || nameLen > 64) continue;
    const name = dec16.decode(dirBytes.subarray(base, base + nameLen - 2));
    const startSector = u32(dirDv, base + 0x74);
    const size = u32(dirDv, base + 0x78) + u32(dirDv, base + 0x7c) * 0x100000000;
    const entry = { name, objType, startSector, size };
    if (objType === 5) root = entry;
    entries[name] = entry;
  }
  if (!root) fail("Corrupt .doc (no root directory entry).");

  // Mini-stream (the Root Entry's content, via the main FAT) + the mini-FAT, built on demand.
  let miniStream = null;
  let miniFat = null;
  const ensureMini = () => {
    if (miniStream) return;
    miniStream = readFromMainFat(root.startSector, root.size);
    const mf = firstMiniFatSector === ENDOFCHAIN ? new Uint8Array(0) : readFromMainFat(firstMiniFatSector, numMiniFatSectors * sectorSize);
    const mfDv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
    miniFat = new Uint32Array(Math.floor(mf.length / 4));
    for (let i = 0; i < miniFat.length; i++) miniFat[i] = u32(mfDv, i * 4);
  };

  const readFromMiniFat = (start, size) => {
    ensureMini();
    const cap = Math.ceil(size / miniSectorSize);
    const chain = followChain(start, miniFat, cap);
    const out = new Uint8Array(chain.length * miniSectorSize);
    for (let i = 0; i < chain.length; i++) {
      const off = chain[i] * miniSectorSize;
      out.set(miniStream.subarray(off, off + miniSectorSize), i * miniSectorSize);
    }
    return out.subarray(0, size);
  };

  const readStream = (entry) => {
    if (!entry) fail("Corrupt .doc (missing a required stream).");
    return entry.size >= miniCutoff ? readFromMainFat(entry.startSector, entry.size) : readFromMiniFat(entry.startSector, entry.size);
  };

  return { entries, readStream };
}

/* Turn a decoded raw Word text run into readable lines: paragraph/line/page marks → newlines,
 * field codes suppressed (instruction hidden, result kept — nesting-aware), special chars mapped. */
export function cleanWordText(raw) {
  let out = "";
  const stack = []; // one flag per open field: true = inside its (hidden) instruction
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c === 0x13) { stack.push(true); continue; }             // field begin → instruction starts
    if (c === 0x14) { if (stack.length) stack[stack.length - 1] = false; continue; } // separator → result
    if (c === 0x15) { if (stack.length) stack.pop(); continue; } // field end
    if (stack.some((inInstr) => inInstr)) continue;             // any enclosing field still in instruction → hide
    if (c === 0x0d || c === 0x0b || c === 0x0c || c === 0x07) { out += "\n"; continue; } // para/line/page/cell
    if (c === 0xa0) { out += " "; continue; }                   // non-breaking space
    if (c === 0x1e) { out += "-"; continue; }                   // non-breaking hyphen
    if (c === 0x1f) continue;                                   // optional hyphen → nothing
    if (c === 0x09 || c === 0x0a) { out += String.fromCharCode(c); continue; }
    if (c < 0x20) continue;                                     // drop other control chars
    if (c === 0xfffe || c === 0xffff) continue;                 // stray specials
    out += String.fromCharCode(c);
  }
  return out;
}

function tidy(s) {
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* Read the WordDocument FIB + piece table, decode the body text. */
function extractWordText(cfb) {
  const wd = cfb.readStream(cfb.entries.WordDocument);
  if (!wd || wd.length < 0x300) fail("Not a Word .doc file.");
  const wdv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);

  if (u16(wdv, 0x00) !== 0xa5ec) fail(`This looks like a very old or non-Word .doc. ${SAVE_AS}`);
  if (u16(wdv, 0x02) < 0x00c1) fail(`This looks like a very old Word .doc (Word 6/95). ${SAVE_AS}`); // nFib < 193
  const flags = u16(wdv, 0x0a);
  if (flags & 0x0100) fail(`This .doc is password-protected — remove the password, then re-drop it. ${SAVE_AS}`);
  const whichTable = flags & 0x0200 ? "1Table" : "0Table";
  const ccpText = u32(wdv, 0x4c);

  // fcClx / lcbClx live in the FibRgFcLcb97 blob; compute its start defensively from the header
  // vector counts (equals the canonical 0x9A for standard Word docs), then pair index 33.
  const blobStart = 0x22 + u16(wdv, 0x20) * 2 + 2 + u16(wdv, 0x3e) * 4 + 2;
  const fcClx = u32(wdv, blobStart + 33 * 8);
  const lcbClx = u32(wdv, blobStart + 33 * 8 + 4);
  if (!lcbClx) fail(`Couldn't read the text from that .doc. ${SAVE_AS}`);

  const tbl = cfb.readStream(cfb.entries[whichTable] || cfb.entries["1Table"] || cfb.entries["0Table"]);
  if (!tbl || fcClx + lcbClx > tbl.length) fail(`Couldn't read the text from that .doc. ${SAVE_AS}`);
  const tdv = new DataView(tbl.buffer, tbl.byteOffset, tbl.byteLength);

  // Walk the CLX: skip any leading Prc (0x01) blocks, then the Pcdt (0x02) holding the plcPcd.
  let p = fcClx;
  const clxEnd = fcClx + lcbClx;
  let pcdtPos = -1;
  let lcbPlc = 0;
  while (p < clxEnd) {
    const clxt = tbl[p];
    if (clxt === 0x01) {
      p += 3 + u16(tdv, p + 1); // 0x01 + u16 cbGrpprl + grpprl
    } else if (clxt === 0x02) {
      lcbPlc = u32(tdv, p + 1);
      pcdtPos = p + 5;
      break;
    } else break;
  }
  if (pcdtPos < 0 || lcbPlc <= 4) fail(`Couldn't read the text from that .doc. ${SAVE_AS}`);

  const n = Math.floor((lcbPlc - 4) / 12); // (n+1) CPs (4B) + n PCDs (8B) = 12n + 4
  const cpBase = pcdtPos;
  const pcdBase = pcdtPos + (n + 1) * 4;
  if (n <= 0 || pcdBase + n * 8 > clxEnd) fail(`Couldn't read the text from that .doc. ${SAVE_AS}`);

  const dec1252 = new TextDecoder("windows-1252");
  const decU16 = new TextDecoder("utf-16le");
  let raw = "";
  let cpSoFar = 0;
  for (let i = 0; i < n && cpSoFar < ccpText; i++) {
    const cpStart = u32(tdv, cpBase + i * 4);
    const cpEnd = u32(tdv, cpBase + (i + 1) * 4);
    let chars = cpEnd - cpStart;
    if (chars <= 0) continue;
    if (cpSoFar + chars > ccpText) chars = ccpText - cpSoFar; // clamp the final piece to the body length
    const fcRaw = u32(tdv, pcdBase + i * 8 + 2);
    const compressed = (fcRaw & 0x40000000) !== 0;
    const fcVal = fcRaw & 0x3fffffff;
    if (compressed) {
      const off = fcVal >>> 1; // 8-bit windows-1252, one byte per char
      const avail = Math.max(0, Math.min(chars, wd.length - off));
      raw += dec1252.decode(wd.subarray(off, off + avail));
    } else {
      const off = fcVal; // 16-bit UTF-16LE, two bytes per char
      const avail = Math.max(0, Math.min(chars, Math.floor((wd.length - off) / 2)));
      raw += decU16.decode(wd.subarray(off, off + avail * 2));
    }
    cpSoFar += chars;
  }
  return raw;
}

/* Read a legacy .doc (as an ArrayBuffer) into plain text. Async to match readDeedFile's docx path. */
export async function docToText(arrayBuffer) {
  let cfb;
  try {
    cfb = parseCfb(arrayBuffer);
  } catch (e) {
    const m = (e && e.message) || "";
    if (/\.doc|Save it as|password|old/i.test(m)) throw e; // pass our friendly errors through
    throw new Error(`Couldn't read that .doc — it may be corrupt or not a Word file. ${SAVE_AS}`);
  }
  const text = tidy(cleanWordText(extractWordText(cfb)));
  if (text.replace(/\s+/g, "").length < 1) fail(`Couldn't find any text in that .doc. ${SAVE_AS}`);
  return text;
}
