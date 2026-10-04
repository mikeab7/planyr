/* tinyPdf — a hand-built multi-page PDF (no dependency), for harnesses that need pages they can tell apart.
 * Every page is a distinct size so "which page am I on" is readable from the geometry too. */
export function buildPdf(pages = 3, label = "SHEET") {
  const objs = [];
  const add = (b) => { objs.push(b); return objs.length; };
  add("<< /Type /Catalog /Pages 2 0 R >>");
  add(""); // pages — filled below
  const fontId = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const kids = [];
  for (let i = 1; i <= pages; i++) {
    const w = 612 + (i - 1) * 40, h = 792;
    const stream = `BT /F1 28 Tf 60 ${h - 80} Td (${label} ${i}) Tj ET`;
    const cId = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const pId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents ${cId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    kids.push(`${pId} 0 R`);
  }
  objs[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages} >>`;
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
