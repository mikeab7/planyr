// imagePdf.js (NEW-1) — wrap a single raster image into a one-page PDF at an EXACT
// physical page size. Pure + dependency-free (no jsPDF/pdf-lib) so it's unit-testable
// and adds zero bundle weight, matching the codebase's "pure lib + tests" pattern
// (cf. printSheet.js).
//
// WHY THIS EXISTS: the Site Planner used to "print" by opening a blank browser window
// and calling window.print(), which routes through the browser's print dialog. That
// dialog stamps on chrome we can't strip — a date/time header, the about:blank URL, a
// page number — and bleeds the on-screen cream page colour onto paper. The fix is to
// stop using the browser as the page-layout engine: Planyr composes the whole sheet as
// ONE SVG (printSheet.js), rasterizes it to a high-DPI JPEG, and this wraps that JPEG
// into a real PDF handed straight to the user. Because we generate the PDF ourselves,
// the browser-injected chrome simply can't appear, and the page size is declared
// explicitly (a 1100x850 Letter sheet is a Letter PDF — never floats inside a Tabloid).
//
// A single full-page image is the entire PDF, so the file is tiny and the structure is
// fixed: catalog -> pages -> page -> {image XObject, content stream} -> info. The image
// is embedded with /DCTDecode, which stores the JPEG bytes verbatim (no re-encode).

const PT_PER_IN = 72; // PDF user-space unit = 1/72 inch

// ASCII string -> bytes. PDF structural syntax is ASCII; the only binary in the file is
// the JPEG stream, which we keep as raw bytes (never routed through a JS string, whose
// UTF-16 would corrupt it).
function strBytes(s) {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
}

// PDF date string, e.g. D:20260620211500.
const pdfDate = (d) => {
  const p = (x) => String(x).padStart(2, "0");
  return `D:${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};
// Escape a PDF literal-string: backslash, parens, and newlines.
const escPdfStr = (s) =>
  String(s == null ? "" : s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\r\n\t]+/g, " ");
const pad10 = (n) => String(n).padStart(10, "0");

// Build a one-page PDF (Uint8Array) that draws `jpeg` to fill a `widthIn` x `heightIn`
// page. `pixelW`/`pixelH` are the JPEG's pixel dimensions (they set resolution only;
// the cm matrix scales the image to fill the page regardless). DeviceRGB / 8-bpc, which
// is what a browser canvas toBlob("image/jpeg") always produces.
export function jpegToPdf({ jpeg, pixelW, pixelH, widthIn, heightIn, title = "", date = new Date() } = {}) {
  if (!(jpeg instanceof Uint8Array) || jpeg.length === 0) throw new TypeError("jpeg must be a non-empty Uint8Array");
  if (!(pixelW > 0 && pixelH > 0)) throw new RangeError("pixelW/pixelH must be > 0");
  if (!(widthIn > 0 && heightIn > 0)) throw new RangeError("widthIn/heightIn must be > 0");

  const pageW = +(widthIn * PT_PER_IN).toFixed(3);
  const pageH = +(heightIn * PT_PER_IN).toFixed(3);
  // Content stream: scale the unit image square up to the full page (cm matrix), draw it.
  const content = strBytes(`q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`);

  const dicts = {
    1: `<< /Type /Catalog /Pages 2 0 R >>`,
    2: `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    3: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}]`
      + ` /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    4: `<< /Type /XObject /Subtype /Image /Width ${pixelW} /Height ${pixelH}`
      + ` /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`,
    5: `<< /Length ${content.length} >>`,
    6: `<< /Title (${escPdfStr(title)}) /Producer (Planyr) /Creator (Planyr Site Planner) /CreationDate (${pdfDate(date)}) >>`,
  };

  const parts = [];
  let offset = 0;
  const offsets = []; // offsets[objNum] = byte offset of "N 0 obj"
  const push = (bytes) => { parts.push(bytes); offset += bytes.length; };
  // Open an object, emit its body chunks (strings or raw byte arrays), close it.
  const pushObj = (num, ...chunks) => {
    offsets[num] = offset;
    push(strBytes(`${num} 0 obj\n`));
    for (const c of chunks) push(typeof c === "string" ? strBytes(c) : c);
    push(strBytes(`\nendobj\n`));
  };

  // Header — the binary comment marks the file as containing binary (keeps tools honest).
  push(strBytes("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n"));
  pushObj(1, dicts[1]);
  pushObj(2, dicts[2]);
  pushObj(3, dicts[3]);
  pushObj(4, dicts[4] + "\nstream\n", jpeg, "\nendstream");      // image stream = raw JPEG bytes
  pushObj(5, dicts[5] + "\nstream\n", content, "\nendstream");   // page content stream
  pushObj(6, dicts[6]);

  // Cross-reference table — byte offset of every object, in order.
  const N = 6;
  const xrefStart = offset;
  let xref = `xref\n0 ${N + 1}\n0000000000 65535 f\r\n`;
  for (let i = 1; i <= N; i++) xref += `${pad10(offsets[i])} 00000 n\r\n`;
  push(strBytes(xref));
  push(strBytes(`trailer\n<< /Size ${N + 1} /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`));

  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
