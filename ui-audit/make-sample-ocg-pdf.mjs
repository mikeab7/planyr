/* Emit a minimal, VALID single-page PDF with two optional-content groups (OCG "layers") for
 * headless verification of the Document Review Layers panel (B490). pdf-lib 1.17 cannot emit OCGs
 * (no /OCProperties support), so we hand-author the bytes — same offset/xref technique as
 * make-sample-pdf.mjs. The page draws an always-on black border + label, a RED square gated by the
 * "Electrical" layer, and a BLUE square gated by "Plumbing", so a headless test can count red/blue
 * pixels and prove that toggling a layer actually re-rasters the drawing. Writes e2e/fixtures/sample-ocg.pdf. */
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = new URL("../e2e/fixtures/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const W = 612, H = 792;
const header = "%PDF-1.5\n"; // OCGs require PDF 1.5+
let body = "";
const offsets = [];
const add = (num, s) => { offsets[num] = header.length + body.length; body += `${num} 0 obj\n${s}\nendobj\n`; };

// Optional-content marked content uses the tag /OC + a name mapped by the page's /Resources/Properties
// to the OCG ref. Everything outside a BDC…EMC pair (the border + label) is always on.
const content =
  "q 3 w 40 40 532 712 re S Q\n" +
  "BT /F1 18 Tf 70 720 Td (OCG layer test) Tj ET\n" +
  "/OC /oc5 BDC q 1 0 0 rg 80 440 200 200 re f Q EMC\n" +   // RED square — Electrical layer
  "/OC /oc6 BDC q 0 0 1 rg 332 440 200 200 re f Q EMC";      // BLUE square — Plumbing layer

add(1, "<</Type/Catalog/Pages 2 0 R/OCProperties<</OCGs[5 0 R 6 0 R]/D<</ON[5 0 R 6 0 R]/Order[5 0 R 6 0 R]>>>>>>");
add(2, "<</Type/Pages/Kids[3 0 R]/Count 1>>");
add(3, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</Font<</F1 7 0 R>>/Properties<</oc5 5 0 R/oc6 6 0 R>>>>/Contents 4 0 R>>`);
add(4, `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`);
add(5, "<</Type/OCG/Name(Electrical)>>");
add(6, "<</Type/OCG/Name(Plumbing)>>");
add(7, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");

const N = 7;
let xref = `xref\n0 ${N + 1}\n0000000000 65535 f \n`;
for (let n = 1; n <= N; n++) xref += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
const startxref = header.length + body.length;
const pdf = header + body + xref + `trailer\n<</Size ${N + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;

writeFileSync(OUT + "sample-ocg.pdf", pdf, "latin1");
console.log(`wrote ${OUT}sample-ocg.pdf — 2 OCG layers (Electrical/Plumbing), ${pdf.length} bytes`);
