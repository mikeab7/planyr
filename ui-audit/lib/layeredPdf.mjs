/* layeredPdf — a minimal PDF carrying TWO optional-content groups, built by hand (NEW-1).
 *
 * ⛔ WHY THIS IS SYNTHESISED RATHER THAN TAKEN FROM THE OWNER'S DRIVE.
 *
 * Doc Review's ONE hide mechanism is the PDF optional-content ("layer") toggle (B490), and the only
 * way our code can get it wrong is to render a page WITHOUT passing the mutated
 * `OptionalContentConfig`. That is a property of OUR render path, not of his drawings — so the
 * fixture only has to carry two layers that are trivially distinguishable in the rasterised pixels.
 *
 * ⚠ AND THE HONEST LIMIT THIS DOES NOT CLOSE: whether the owner's OWN documents carry optional
 * content at all is unknown from this sandbox. His 30 source PDFs live in Supabase Storage /
 * Drive and the bytes are not reachable here (SQL reaches the metadata rows, never the objects).
 * If none of his drawings carries layers, the Layers panel never appears for him and this whole
 * surface is empty in practice. That question is the first step of the hand-check, not something
 * this fixture can answer.
 *
 * The file is deliberately tiny and uncompressed so the byte offsets in the xref table can be
 * computed exactly, and so a failure is a failure of our code rather than of a PDF generator.
 *
 * Layer A paints a RED square bottom-left; Layer B paints a BLUE square top-right. Both start ON.
 */

/** A minimal two-OCG PDF as a Uint8Array. */
export function layeredPdfBytes() {
  const objs = [
    // 1 — Catalog, declaring both groups ON in the default configuration.
    "<< /Type /Catalog /Pages 2 0 R /OCProperties << /OCGs [5 0 R 6 0 R] "
      + "/D << /Order [5 0 R 6 0 R] /ON [5 0 R 6 0 R] /OFF [] >> >> >>",
    // 2 — Pages
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    // 3 — the one page; the OCGs are reachable from the content stream via /Properties
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 400] "
      + "/Resources << /Properties << /OC1 5 0 R /OC2 6 0 R >> >> /Contents 4 0 R >>",
    null, // 4 — content stream, filled in below (needs its own length)
    "<< /Type /OCG /Name (Layer A) >>",
    "<< /Type /OCG /Name (Layer B) >>",
  ];

  const content = [
    "/OC /OC1 BDC",
    "1 0 0 rg 40 40 140 140 re f",     // Layer A — red, bottom-left
    "EMC",
    "/OC /OC2 BDC",
    "0 0 1 rg 220 220 140 140 re f",   // Layer B — blue, top-right
    "EMC",
    "0 0 0 rg 190 10 20 20 re f",      // UNLAYERED control — black, always painted
  ].join("\n");
  objs[3] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;

  let out = "%PDF-1.5\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

  return new Uint8Array([...out].map((c) => c.charCodeAt(0) & 0xff));
}

/** The three probe points, in PAGE units (the MediaBox is 400×400, origin bottom-left). */
export const PROBES = Object.freeze({
  layerA: { x: 110, y: 400 - 110, expect: "red" },     // → canvas coords (y flips)
  layerB: { x: 290, y: 400 - 290, expect: "blue" },
  control: { x: 200, y: 400 - 20, expect: "black" },
});
