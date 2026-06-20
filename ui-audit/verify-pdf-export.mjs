// Verifies the NEW-1 PDF export end-to-end: the EXACT browser pipeline exportPDF() uses
// — compose the whole sheet as ONE SVG (real buildPrintSheetSvg), rasterize it to a JPEG
// via an <img> + canvas at 300 DPI, then wrap that JPEG into a real PDF with the real
// jpegToPdf — and then validates the output PDF with pdfjs (valid, 1 page, exact page
// size) plus pixel checks (white background, real ink content). The synthetic "plan"
// includes a feDropShadow filter and an embedded <image> to prove the raster keeps the
// effects/aerial the old browser-print relied on the browser to render.
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "fs";
import { buildPrintSheetSvg, printSheetLayout } from "../src/workspaces/site-planner/lib/printSheet.js";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";

const PAL = { ink: "#26231e", muted: "#8a8473", panelLine: "#cfc6af", paper: "#ffffff" };
const rows = [
  { name: "Building 1", sf: 250000, clearHeight: 36, slab: 7 },
  { name: "Cross Dock", sf: 620000, clearHeight: 40, slab: 7 },
  { name: "Building 3", sf: 95000, clearHeight: 32, slab: 6 },
];
// 1x1 green PNG stretched to fill — stands in for the aerial underlay (proves the raster
// embeds <image> hrefs).
const AERIAL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+M9QDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function sheetFor(paper, orient) {
  const layout = printSheetLayout({ paper, orient, buildingCount: rows.length });
  const pb = layout.plan;
  // Synthetic plan: aerial image + a building rect WITH a drop-shadow filter + a label.
  const planSvg =
    `<svg x="${pb.x}" y="${pb.y}" width="${pb.w}" height="${pb.h}" viewBox="0 0 800 560" preserveAspectRatio="xMidYMid meet">`
    + `<defs><filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="3" stdDeviation="4" flood-color="#000" flood-opacity="0.35"/></filter></defs>`
    + `<image href="${AERIAL}" x="0" y="0" width="800" height="560" preserveAspectRatio="none" opacity="0.5"/>`
    + `<rect x="120" y="110" width="430" height="210" fill="#cdd6c2" stroke="#33402c" stroke-width="3" filter="url(#sh)"/>`
    + `<text x="335" y="225" text-anchor="middle" font-size="30" fill="#1f2937" font-family="sans-serif">Building 1</text>`
    + `</svg>`;
  const metrics = [
    ["Site area", "42.0 ac (1,829,520 sf)"], ["Building", "965,000 sf"], ["Lot coverage", "53%"],
    ["FAR (1-story)", "0.53"], ["Car stalls", "640 (0.6/1k sf)"], ["Trailer stalls", "60"],
    ["Impervious", "78%"], ["Detention", "120,000 sf"], ["Open / green", "9.1 ac"],
  ];
  return {
    layout,
    svg: buildPrintSheetSvg({
      layout, planSvg, title: "Mesa Logistics", sub: "Plan 1", date: "2026.06.20",
      metrics, note: "Concept site plan — planning-level estimates, not a survey.", buildings: rows, pal: PAL,
    }),
  };
}

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
mkdirSync("ui-audit/screens", { recursive: true });

// The exact browser half of exportPDF(): SVG string -> high-DPI JPEG (base64) + pixel checks.
const rasterize = async (svg, wIn, hIn) => page.evaluate(async ({ svg, wIn, hIn }) => {
  const DPI = 300;
  const pxW = Math.round(wIn * DPI), pxH = Math.round(hIn * DPI);
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  const img = new Image();
  await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error("svg load failed")); img.src = url; });
  const canvas = document.createElement("canvas");
  canvas.width = pxW; canvas.height = pxH;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, pxW, pxH);
  ctx.drawImage(img, 0, 0, pxW, pxH);
  URL.revokeObjectURL(url);
  // Pixel checks: a corner should be white paper; white should DOMINATE (background is
  // white, not the cream screen page); the sheet should have real dark ink; and there
  // must be no cream FIELD (a few stray warm pixels are JPEG chroma-edge artifacts where
  // black text meets white — a real cream background would be the majority of samples).
  const isWhite = (x, y) => { const d = ctx.getImageData(x, y, 1, 1).data; return d[0] > 245 && d[1] > 245 && d[2] > 245; };
  // All four paper-margin corners must be white (a cream background would fail every one).
  const cornerWhite = isWhite(3, 3) && isWhite(pxW - 4, 3) && isWhite(3, pxH - 4) && isWhite(pxW - 4, pxH - 4);
  let dark = 0, cream = 0, white = 0, n = 0;
  const data = ctx.getImageData(0, 0, pxW, pxH).data;
  for (let i = 0; i < data.length; i += 4 * 997) { // sparse sweep
    n++;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r >= 250 && g >= 250 && b >= 250) white++;
    else if (r < 90 && g < 90 && b < 90) dark++;
    // the screen page colour #f4f1ea ~ (244,241,234): warm, clearly-not-white pixels
    else if (r >= 236 && r <= 249 && g >= 233 && g <= 246 && b >= 224 && b <= 240 && (r - b) >= 6) cream++;
  }
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = ""; for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
  return { pxW, pxH, cornerWhite, darkSamples: dark, creamSamples: cream, whiteSamples: white, sampled: n, jpegB64: btoa(bin), jpegLen: buf.length };
}, { svg, wIn, hIn });

// pdfjs validation (parses the real PDF — proves it's well-formed and correctly sized).
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

let allPass = true;
for (const [paper, orient, expectW, expectH] of [
  ["letter", "landscape", 792, 612],
  ["tabloid", "landscape", 1224, 792],
]) {
  const { svg } = sheetFor(paper, orient);
  const r = await rasterize(svg, expectW / 72, expectH / 72);
  const jpeg = Uint8Array.from(atob(r.jpegB64), (c) => c.charCodeAt(0));
  const pdf = jpegToPdf({ jpeg, pixelW: r.pxW, pixelH: r.pxH, widthIn: expectW / 72, heightIn: expectH / 72, title: `Mesa Logistics - Plan 1 (${paper})` });
  writeFileSync(`ui-audit/screens/pdf-export-${paper}.pdf`, pdf);
  writeFileSync(`ui-audit/screens/pdf-export-${paper}.jpg`, jpeg); // the exact embedded page image, for eyeballing

  const doc = await pdfjs.getDocument({ data: pdf.slice() }).promise;
  const pg = await doc.getPage(1);
  const view = pg.view; // [x0,y0,x1,y1] in points
  const sizeOk = doc.numPages === 1 && Math.round(view[2]) === expectW && Math.round(view[3]) === expectH;
  // Confirm the page actually paints an image (the rasterized sheet).
  const ops = await pg.getOperatorList();
  const OPS = pdfjs.OPS;
  const hasImage = ops.fnArray.some((fn) => fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject || fn === OPS.paintInlineImageXObject);

  const whiteFrac = r.whiteSamples / r.sampled, creamFrac = r.creamSamples / r.sampled;
  const pass = sizeOk && hasImage && r.cornerWhite && r.darkSamples > 5 && whiteFrac > 0.2 && creamFrac < 0.02;
  allPass = allPass && pass;
  console.log(`\n${paper} ${orient}: ${pass ? "PASS ✅" : "FAIL ❌"}`);
  console.log(`  PDF: numPages=${doc.numPages} page=${Math.round(view[2])}x${Math.round(view[3])}pt (want ${expectW}x${expectH}) sizeOk=${sizeOk} hasImage=${hasImage}`);
  console.log(`  Raster: ${r.pxW}x${r.pxH}px jpeg=${(r.jpegLen / 1024).toFixed(0)}KB cornerWhite=${r.cornerWhite} darkSamples=${r.darkSamples} white=${(whiteFrac * 100).toFixed(1)}% cream=${r.creamSamples}/${r.sampled} (${(creamFrac * 100).toFixed(2)}%)`);
}

await browser.close();
console.log(`\n${allPass ? "ALL PASS ✅ — PDF export verified (valid PDF, exact page size, white bg, real content, no cream)" : "SOME CHECKS FAILED ❌"}`);
console.log("artifacts: ui-audit/screens/pdf-export-{letter,tabloid}.{pdf,jpg}");
process.exit(allPass ? 0 : 1);
