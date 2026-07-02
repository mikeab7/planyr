/* Verify the PDF.js support-asset wiring (standard_fonts / cmaps / iccs / wasm) against the
 * REAL built viewer served by `vite preview` on :4173. PDF.js v6 only renders non-embedded
 * fonts, CID/CJK text, CMYK colour, and JBIG2/JPX scanned images when getDocument is told where
 * to fetch its on-disk support folders; this branch wires them to `<base>pdfjs/…` (served in dev
 * by the vite `pdfjs-assets` plugin, emitted into the build for prod).
 *
 * What this proves, decisively and without an A/B:
 *   1) PROD SERVING — under `vite preview` (which serves dist/ statically), the four asset folders
 *      are reachable at /pdfjs/<folder>/<file> (200 + bytes). This is the path real users hit.
 *   2) WORKER END-TO-END — opening a PDF that uses a non-embedded /ZapfDingbats and /Symbol font
 *      makes the pdf.js WORKER fetch FoxitDingbats.pfb / FoxitSymbol.pfb from /pdfjs/standard_fonts/.
 *      That request only happens if (a) getDocument received standardFontDataUrl, (b) the worker
 *      resolved the ROOT-ABSOLUTE url correctly in worker scope, and (c) our server served it 200.
 *      Before this fix the url is null and the glyph data never loads (dingbat/symbol glyphs drop).
 *   3) NO DEGRADATION WARNINGS — pdf.js does NOT log its "missing `wasmUrl`" / "standard font data
 *      is not available" degradation warnings.
 *   4) NO REGRESSION — the sheet still rasterises (canvas has non-blank pixels).
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-pdfjs-assets.mjs                  (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/pdfjs-assets-test.pdf";

/* A structurally-valid 1-page PDF (612×792 Letter) that uses three non-embedded base-14 fonts:
 * Helvetica (system-substituted), plus ZapfDingbats and Symbol — the two fonts pdf.js loads its
 * shipped substitute glyph data for even when useSystemFonts is on, so rendering them forces a
 * fetch of /pdfjs/standard_fonts/Foxit{Dingbats,Symbol}.pfb. Exact xref offsets so pdf.js parses
 * it without a rebuild. */
function buildPdf() {
  const content =
    "BT /F1 20 Tf 60 720 Td (PDF.js support-asset wiring test) Tj ET\n" +
    "BT /F2 40 Tf 60 640 Td (abcdefghijklmnop) Tj ET\n" + // ZapfDingbats glyphs
    "BT /F3 40 Tf 60 560 Td (abcdefghijklmnop) Tj ET";    // Symbol glyphs
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Symbol >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();

// Capture pdf.js degradation warnings + every /pdfjs/ asset request's status.
const warns = [];
page.on("console", (m) => { const t = m.text(); if (/missing\s+`?wasmUrl`?|standard font data|ICC color space|Cannot load|fetchStandardFontData/i.test(t)) warns.push(t); });
const assetReqs = [];
page.on("response", (r) => { const u = r.url(); if (u.includes("/pdfjs/")) assetReqs.push({ url: u, status: r.status() }); });

try {
  // 1) PROD SERVING — fetch one file of each asset type from the preview server.
  await page.goto(BASE, { waitUntil: "load" });
  const probe = await page.evaluate(async (base) => {
    const files = {
      font: "pdfjs/standard_fonts/FoxitDingbats.pfb",
      cmap: "pdfjs/cmaps/Adobe-Japan1-0.bcmap",
      icc: "pdfjs/iccs/CGATS001Compat-v2-micro.icc",
      wasm: "pdfjs/wasm/openjpeg.wasm",
    };
    const out = {};
    for (const [k, f] of Object.entries(files)) {
      try { const r = await fetch(base + f); const b = await r.arrayBuffer(); out[k] = { status: r.status, bytes: b.byteLength, type: r.headers.get("content-type") || "" }; }
      catch (e) { out[k] = { status: 0, bytes: 0, type: String(e) }; }
    }
    return out;
  }, BASE);
  for (const [k, v] of Object.entries(probe)) {
    ok(`serves /pdfjs/${k}`, v.status === 200 && v.bytes > 64, `HTTP ${v.status}, ${v.bytes} bytes, type "${v.type}"`);
  }
  ok("wasm served as application/wasm", (probe.wasm.type || "").includes("wasm"), `content-type "${probe.wasm.type}"`);

  // 2/3/4) Open the PDF in the Review viewer and let it rasterise.
  await page.goto(BASE + "#markup", { waitUntil: "load" });
  await page.waitForTimeout(900);
  assetReqs.length = 0; // drop the step-1 probe fetches: from here on, /pdfjs/ requests are the worker's own
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 10000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 15000 });
  await page.waitForTimeout(1200); // let the worker resolve fonts + paint detail

  // 2) WORKER END-TO-END: the worker fetched a standard substitute font from our served path.
  const fontHits = assetReqs.filter((r) => r.url.includes("/pdfjs/standard_fonts/"));
  const fontOk = fontHits.filter((r) => r.status === 200);
  ok("worker fetches a standard font from /pdfjs/standard_fonts/", fontOk.length > 0,
    fontHits.length ? fontHits.map((r) => `${r.url.split("/").pop()}=${r.status}`).join(", ") : "no /pdfjs/standard_fonts/ request was made");

  // 3) No pdf.js degradation warnings.
  ok("no pdf.js asset-degradation warnings", warns.length === 0, warns.length ? warns.join(" | ") : "0 warnings");

  // 4) No regression — the sheet rasterised with non-blank content.
  const opaque = await page.evaluate(() => {
    const c = document.querySelector("canvas"); if (!c) return -1;
    const t = document.createElement("canvas"); t.width = c.width; t.height = c.height;
    t.getContext("2d").drawImage(c, 0, 0);
    const d = t.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let nonWhite = 0; for (let i = 0; i < d.length; i += 4) { if (d[i] < 250 || d[i + 1] < 250 || d[i + 2] < 250) nonWhite++; }
    return nonWhite;
  });
  ok("sheet still rasterises (non-blank)", opaque > 200, `${opaque} non-white px`);

  // 5) DETAIL SUPERSAMPLING: on this 1× (deviceScaleFactor:1) context the detail layer should now
  // render its backing store at ~2× its CSS size (supersampled for cleaner AA). Pre-change it was 1×.
  // Zoom in first so the visible window is small → the budget grants the full 2× target.
  {
    const wrap = await page.evaluate(() => { const c = document.querySelector("canvas"); const r = c.parentElement.parentElement.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    await page.mouse.move(wrap.x, wrap.y);
    for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(120); }
    await page.waitForTimeout(400); // let the detail layer settle + re-raster the zoomed window
    const ratio = await page.evaluate(() => {
      // the detail canvas is the one given an explicit pixel CSS width (the backdrop is width:100%)
      const cs = [...document.querySelectorAll("canvas")];
      const detail = cs.find((c) => /px$/.test(c.style.width || "")) || cs[cs.length - 1];
      const css = detail.getBoundingClientRect().width;
      return css > 0 ? detail.width / css : 0; // backing device-px ÷ CSS-px = render density
    });
    ok("detail layer supersamples to ~2× on a 1× display", ratio >= 1.7, `detail backing density = ${ratio.toFixed(2)}× (pre-change ≈ 1.0×)`);
  }

  await page.screenshot({ path: new URL("./screens/pdfjs-assets.png", import.meta.url).pathname }).catch(() => {});
} catch (e) {
  ok("harness", false, "threw: " + e.message);
}

await ctx.close();
await browser.close();

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
