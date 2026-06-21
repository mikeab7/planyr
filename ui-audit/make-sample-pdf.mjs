/* Emit a minimal, valid multi-page PDF for headless Document-Review verification.
 * The owner's real sample sets live on branch mikeab7-patch-1 (B269) and aren't on
 * this branch, so we hand-author a 4-sheet vector PDF good enough to open, page,
 * draw on, calibrate, and undo. Writes /tmp/samples/sample.pdf. */
import { writeFileSync, mkdirSync } from "node:fs";

const W = 1224, H = 792, N = 4;
mkdirSync("/tmp/samples", { recursive: true });

const header = "%PDF-1.4\n";
let body = "";
const offsets = [];
const add = (num, s) => { offsets[num] = header.length + body.length; body += `${num} 0 obj\n${s}\nendobj\n`; };

const fontNum = 3 + 2 * N;
add(1, "<</Type/Catalog/Pages 2 0 R>>");
const kids = Array.from({ length: N }, (_, i) => `${3 + 2 * i} 0 R`);
add(2, `<</Type/Pages/Kids[${kids.join(" ")}]/Count ${N}>>`);
for (let i = 0; i < N; i++) {
  const pnum = 3 + 2 * i, cnum = 4 + 2 * i;
  const text =
    `BT /F1 64 Tf 90 ${H - 130} Td (SHEET ${i + 1}) Tj ET\n` +
    `BT /F1 22 Tf 90 ${H - 175} Td (Document Review sample - sheet ${i + 1} of ${N}) Tj ET\n` +
    `3 w 50 50 ${W - 100} ${H - 100} re S`;
  add(pnum, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Resources<</Font<</F1 ${fontNum} 0 R>>>>/Contents ${cnum} 0 R>>`);
  add(cnum, `<</Length ${Buffer.byteLength(text, "latin1")}>>\nstream\n${text}\nendstream`);
}
add(fontNum, "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>");

let xref = `xref\n0 ${fontNum + 1}\n0000000000 65535 f \n`;
for (let n = 1; n <= fontNum; n++) xref += String(offsets[n]).padStart(10, "0") + " 00000 n \n";
const startxref = header.length + body.length;
const pdf = header + body + xref + `trailer\n<</Size ${fontNum + 1}/Root 1 0 R>>\nstartxref\n${startxref}\n%%EOF\n`;

writeFileSync("/tmp/samples/sample.pdf", pdf, "latin1");
console.log(`wrote /tmp/samples/sample.pdf — ${N} pages, ${W}x${H}, ${pdf.length} bytes`);
