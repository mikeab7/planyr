/* sheetPdf — a REAL, VALID PDF of a stated page size, generated deterministically (NEW-1).
 *
 * ⛔ WHY THIS EXISTS AT ALL, and why a stub PDF would have made the whole battery worthless.
 *
 * B749's Tier-2 re-raster is gated on the overlay being PDF-BACKED: `SitePlanner.jsx` only enters
 * that path when `overlayDocs.has(id) || storageKey.endsWith(".pdf")`, and it then hands the bytes
 * to PDF.js and re-renders the page at up to 8192 px. So an arm that wants to MEASURE that path
 * needs bytes PDF.js will actually open, at the owner's real page size, with enough content on the
 * page that rendering it is real work rather than a memset.
 *
 * The owner's Bain overlay is 1728 × 2592 PDF points — ARCH D, 24 × 36 in at 72 pt/in — and the
 * fixture records it as `pdfBacked: true` with `pageCount: 1`. Those are the numbers this
 * generator is pointed at; nothing here invents a page size.
 *
 * ⚠ WHAT THIS IS NOT. It is not his drawing. The page GEOMETRY is his (size, page count); the
 * CONTENT is synthetic linework, and every report that uses it says so. That distinction is the
 * same one lib/planFixture.mjs draws for rasters: reproduce the property whose cost is being
 * measured, never claim to reproduce the picture. The re-raster's cost has two halves — PDF.js's
 * render of the page content, and the PNG encode of the resulting canvas — and only the first is
 * content-dependent, so a synthetic sheet understates the render half and reproduces the encode
 * half exactly. `--strokes` exists so that understatement can be swept rather than assumed.
 *
 * No dependencies: hand-authored PDF 1.4, byte offsets computed the same way
 * ui-audit/make-sample-pdf.mjs computes them. Pure — returns a Buffer, writes nothing.
 */

/** A deterministic 32-bit hash, so a sheet's linework is identical run to run. */
export function hash32(a, b) {
  let h = (a * 0x9e3779b1) ^ (b * 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2545f491);
  return (h ^ (h >>> 13)) >>> 0;
}

/* The page's content stream: a border, a drafting grid, and `strokes` deterministic segments with
 * a few filled rectangles standing in for buildings. Kept as its own pure function so a unit test
 * can assert the operator count without generating a whole PDF. */
export function sheetContentStream(wPt, hPt, strokes = 2000, seed = 1) {
  const out = [];
  out.push("0.6 w 0 0 0 RG"); // hairline, black
  out.push(`3 w 36 36 ${(wPt - 72).toFixed(1)} ${(hPt - 72).toFixed(1)} re S`); // sheet border
  // Drafting grid — the kind of dense, full-page linework a civil sheet actually carries.
  out.push("0.25 w 0.6 0.6 0.6 RG");
  for (let x = 72; x < wPt - 72; x += 72) out.push(`${x} 72 m ${x} ${(hPt - 72).toFixed(1)} l S`);
  for (let y = 72; y < hPt - 72; y += 72) out.push(`72 ${y} m ${(wPt - 72).toFixed(1)} ${y} l S`);
  // Linework. Short segments in a bounded neighbourhood, so the page reads like a drawing rather
  // than like noise — a rasteriser's cost follows edge length and edge count, both of which this
  // controls directly and reproducibly.
  out.push("0.5 w 0 0 0 RG");
  for (let i = 0; i < strokes; i++) {
    const h = hash32(i + seed, 0x5bf03635);
    const x = 72 + ((h >>> 4) % Math.max(1, Math.floor(wPt - 144)));
    const y = 72 + ((h >>> 14) % Math.max(1, Math.floor(hPt - 144)));
    const dx = ((h >>> 24) % 120) - 60;
    const dy = ((h >>> 8) % 120) - 60;
    out.push(`${x} ${y} m ${(x + dx).toFixed(1)} ${(y + dy).toFixed(1)} l S`);
  }
  // A handful of filled shapes — the re-raster's white-knockout pass (knockoutNearWhite) walks
  // every pixel, so a page that is pure white outside the linework would flatter it.
  out.push("0.85 0.85 0.85 rg");
  for (let i = 0; i < 12; i++) {
    const h = hash32(i + seed, 0x27d4eb2f);
    const x = 100 + ((h >>> 3) % Math.max(1, Math.floor(wPt - 500)));
    const y = 100 + ((h >>> 13) % Math.max(1, Math.floor(hPt - 500)));
    out.push(`${x} ${y} 320 240 re f`);
  }
  return out.join("\n");
}

/**
 * A one-page PDF of `wPt` × `hPt` points. Returns a Buffer.
 *
 * `pages` > 1 repeats the same content, so a multi-page arm can exist without a second generator;
 * the Bain overlay is `pageCount: 1` and that is the default.
 */
export function sheetPdfBytes({ wPt = 1728, hPt = 2592, strokes = 2000, seed = 1, pages = 1 } = {}) {
  const header = "%PDF-1.4\n";
  let body = "";
  const offsets = [];
  const add = (num, s) => { offsets[num] = header.length + Buffer.byteLength(body, "latin1"); body += `${num} 0 obj\n${s}\nendobj\n`; };

  const n = Math.max(1, pages | 0);
  add(1, "<</Type/Catalog/Pages 2 0 R>>");
  const kids = Array.from({ length: n }, (_, i) => `${3 + 2 * i} 0 R`);
  add(2, `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${n}>>`);
  for (let i = 0; i < n; i++) {
    const pnum = 3 + 2 * i, cnum = 4 + 2 * i;
    const stream = sheetContentStream(wPt, hPt, strokes, seed + i);
    add(pnum, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${wPt} ${hPt}]/Contents ${cnum} 0 R/Resources<<>>>>`);
    add(cnum, `<</Length ${Buffer.byteLength(stream, "latin1")}>>\nstream\n${stream}\nendstream`);
  }
  const maxNum = 2 + 2 * n;
  let xref = `xref\n0 ${maxNum + 1}\n0000000000 65535 f \n`;
  for (let k = 1; k <= maxNum; k++) xref += String(offsets[k] ?? 0).padStart(10, "0") + " 00000 n \n";
  const startxref = header.length + Buffer.byteLength(body, "latin1");
  const pdf = header + body + xref + `trailer\n<</Size ${maxNum + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
