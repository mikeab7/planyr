/* Spreadsheet file inspection — what a dropped file REALLY is, and what it contains that the
 * Spreadsheet module cannot show (NEW-1, "open an uploaded Excel in Spreadsheet").
 *
 * PURE and dependency-light (fflate only — already in the bundle for the .docx reader), so it runs
 * identically in the parse Web Worker, on the main thread, and under vitest. It never builds a
 * workbook; it only answers three questions BEFORE the heavy parser runs, so each gets a plain
 * message instead of a dependency's developer-facing error:
 *   1. Is this a ZIP (.xlsx/.xlsm), an old Compound-File (.xls — or an ENCRYPTED .xlsx, which is
 *      also a Compound File), or something else entirely?
 *   2. Is it password-protected? (An encrypted .xlsx is NOT a zip; it is an OLE container holding
 *      an `EncryptedPackage` stream — the string below is how Excel itself tells.)
 *   3. Which parts of the package carry content this module does not represent — charts, pivot
 *      tables, pictures, macros, data validation, conditional formatting, cell notes, …? The caller
 *      shows these in a banner; NOTHING is silently dropped (LOUD-FAILURE).
 */
import { unzipSync, zipSync } from "fflate";

const MAX_UNZIPPED_BYTES = 400 * 1024 * 1024; // a zip bomb must not take the tab down
const MAX_SHEET_XML_SCAN = 40 * 1024 * 1024;  // per worksheet; a bigger one is still imported, just not scanned

export const CFB_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const toU8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

export function isZipBytes(u8) { return u8.length > 3 && u8[0] === 0x50 && u8[1] === 0x4b; }
export function isCfbBytes(u8) { return u8.length > 8 && CFB_MAGIC.every((v, i) => u8[i] === v); }

/** Does a Compound File hold Excel's `EncryptedPackage` (an encrypted .xlsx)? The directory stores
 *  stream names as UTF-16LE, so the needle is the UTF-16LE spelling. */
export function cfbIsEncryptedPackage(u8) {
  const needle = [];
  for (const ch of "EncryptedPackage") { needle.push(ch.charCodeAt(0), 0); }
  const n = needle.length;
  outer: for (let i = 0; i + n <= u8.length; i++) {
    if (u8[i] !== needle[0]) continue;
    for (let j = 1; j < n; j++) if (u8[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

const count = (s, re) => { const m = s.match(re); return m ? m.length : 0; };

/** The feature table. Each entry: key, plain label (singular, plural), and how to count it from the
 *  zip's part NAMES and from the worksheet XML text. */
const NAME_FEATURES = [
  { key: "charts", one: "chart", many: "charts", re: /^xl\/charts\/chart\d+\.xml$/i },
  { key: "pivots", one: "pivot table", many: "pivot tables", re: /^xl\/pivotTables\/pivotTable\d+\.xml$/i },
  { key: "pictures", one: "picture", many: "pictures", re: /^xl\/media\//i },
  { key: "macros", one: "macro (VBA) project", many: "macro (VBA) projects", re: /^xl\/vbaProject\.bin$/i },
  { key: "notes", one: "cell comment/note sheet", many: "cell comment/note sheets", re: /^xl\/(comments\d*\.xml|threadedComments\/)/i },
  { key: "externals", one: "link to another workbook", many: "links to other workbooks", re: /^xl\/externalLinks\/externalLink\d+\.xml$/i },
  { key: "slicers", one: "slicer or timeline", many: "slicers or timelines", re: /^xl\/(slicers|timelines)\//i },
  { key: "tables", one: "Excel table (kept as plain cells)", many: "Excel tables (kept as plain cells)", re: /^xl\/tables\/table\d+\.xml$/i },
];
const SHEET_FEATURES = [
  { key: "validation", one: "data-validation rule (drop-down/limits)", many: "data-validation rules (drop-downs/limits)", re: /<dataValidation[\s>]/g },
  { key: "conditional", one: "conditional-formatting rule", many: "conditional-formatting rules", re: /<cfRule[\s>]/g },
  { key: "sparklines", one: "sparkline", many: "sparklines", re: /<(?:x14:)?sparkline[\s>]/g },
  { key: "hyperlinks", one: "hyperlink (the text stays, the link does not)", many: "hyperlinks (the text stays, the links do not)", re: /<hyperlink[\s>]/g },
];

/** Inspect a package. Returns
 *  { kind: "zip"|"cfb"|"unknown", encrypted, features: [{key, count, label}], sheetCount }.
 *  Never throws on a malformed zip — it reports `kind: "unknown"` and lets the caller word it. */
export function inspectSpreadsheetBytes(bytes) {
  const u8 = toU8(bytes);
  if (isCfbBytes(u8)) return { kind: "cfb", encrypted: cfbIsEncryptedPackage(u8), features: [], sheetCount: 0 };
  if (!isZipBytes(u8)) return { kind: "unknown", encrypted: false, features: [], sheetCount: 0 };

  const names = [];
  let total = 0;
  let files;
  try {
    files = unzipSync(u8, {
      filter: (f) => {
        names.push(f.name);
        total += f.originalSize;
        if (total > MAX_UNZIPPED_BYTES) throw new Error("too-big");
        return /^xl\/worksheets\/sheet\d+\.xml$/i.test(f.name) && f.originalSize <= MAX_SHEET_XML_SCAN;
      },
    });
  } catch (e) {
    if (e && e.message === "too-big") return { kind: "zip", encrypted: false, tooBig: true, features: [], sheetCount: 0 };
    return { kind: "unknown", encrypted: false, features: [], sheetCount: 0 };
  }

  const tally = new Map();
  const add = (def, n) => { if (n > 0) tally.set(def.key, { key: def.key, count: (tally.get(def.key)?.count || 0) + n, def }); };

  for (const def of NAME_FEATURES) add(def, names.filter((n) => def.re.test(n)).length);

  let dec = null;
  try { dec = new TextDecoder("utf-8"); } catch (_) { /* no TextDecoder: skip the XML scans */ }
  let sheetCount = 0;
  let shapes = 0;
  for (const name of Object.keys(files)) {
    sheetCount++;
    if (!dec) continue;
    const xml = dec.decode(files[name]);
    for (const def of SHEET_FEATURES) add(def, count(xml, def.re));
  }
  // Shapes / text boxes live in drawings; a drawing that only holds a chart or picture is already counted.
  if (dec) {
    // drawings are not in the filtered `files`; a coarse name-based flag is enough here
    shapes = names.filter((n) => /^xl\/drawings\/drawing\d+\.xml$/i.test(n)).length;
    const hasChartOrPic = tally.has("charts") || tally.has("pictures");
    if (shapes > 0 && !hasChartOrPic) add({ key: "drawings", one: "drawing or shape", many: "drawings or shapes" }, shapes);
  }

  const features = [...tally.values()].map(({ key, count: n, def }) => ({ key, count: n, label: `${n} ${n === 1 ? def.one : def.many}` }));
  return { kind: "zip", encrypted: false, features, sheetCount: sheetCount || names.filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)).length };
}

/** One plain sentence for a banner, e.g. "This file also contains 2 charts and 1 pivot table, which
 *  Spreadsheet can't show or keep." Empty string when there is nothing to say. */
export function describeUnsupported(features) {
  const list = (features || []).map((f) => f.label);
  if (!list.length) return "";
  const joined = list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
  return `This file also contains ${joined}, which Spreadsheet can't show or keep.`;
}

/* ---------- a parse-only copy without the parts the reader chokes on ---------- */

const STRIP_PART_RE = /^xl\/(drawings|charts|chartsheets|pivotTables|pivotCache|slicers|slicerCaches|timelines|timelineCaches|media|embeddings|ctrlProps|activeX|diagrams)\//i;

/** ExcelJS 4.4.0 throws on some workbooks that carry a chart or a drawing (`Cannot read properties of
 *  undefined (reading 'anchors')`) — a perfectly good file the user could open in Excel. This returns a
 *  copy of the package with every drawing/chart/pivot/picture part and every reference to one removed,
 *  so the CELLS can still be read. It is used ONLY for the retry after a failed first parse, and ONLY
 *  to read — the original upload is never rewritten from it (the "unsupported content" banner already
 *  told the user what the edited copy won't contain). Returns null when there was nothing to strip. */
export function stripNonCellParts(bytes) {
  const u8 = toU8(bytes);
  let files;
  try { files = unzipSync(u8); } catch (_) { return null; }
  const removed = Object.keys(files).filter((n) => STRIP_PART_RE.test(n));
  if (!removed.length) return null;
  const removedSet = new Set(removed);
  const dec = new TextDecoder("utf-8"), enc = new TextEncoder();
  const edit = (name, fn) => { if (files[name]) files[name] = enc.encode(fn(dec.decode(files[name]))); };
  for (const n of removed) delete files[n];
  // A Relationship pointing into a removed part must go (matched by its Target's resolved name).
  const dropRels = (xml) => xml.replace(/<Relationship\b[^>]*?\/>/g, (tag) => {
    const t = /Target="([^"]+)"/.exec(tag);
    if (!t) return tag;
    const target = t[1].replace(/^\.\.\//, "xl/").replace(/^\//, "").replace(/^(?!xl\/)/, "xl/");
    return [...removedSet].some((p) => p === target || p.endsWith("/" + t[1].replace(/^.*\//, "")) && STRIP_PART_RE.test(target)) ? "" : tag;
  });
  for (const n of Object.keys(files)) {
    if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(n)) {
      edit(n, (x) => x
        .replace(/<drawing\b[^>]*\/>/g, "").replace(/<legacyDrawing(?:HF)?\b[^>]*\/>/g, "").replace(/<picture\b[^>]*\/>/g, "")
        .replace(/<oleObjects\b[\s\S]*?<\/oleObjects>/g, "").replace(/<controls\b[\s\S]*?<\/controls>/g, ""));
    } else if (/^xl\/worksheets\/_rels\/.*\.rels$/i.test(n) || n === "xl/_rels/workbook.xml.rels") {
      edit(n, dropRels);
    } else if (n === "xl/workbook.xml") {
      edit(n, (x) => x.replace(/<pivotCaches\b[\s\S]*?<\/pivotCaches>/g, ""));
    } else if (n === "[Content_Types].xml") {
      edit(n, (x) => x.replace(/<Override\b[^>]*?\/>/g, (tag) => {
        const p = /PartName="\/([^"]+)"/.exec(tag);
        return p && removedSet.has(p[1]) ? "" : tag;
      }));
    }
  }
  return zipSync(files);
}
