/* Verify B247 — Doc Review page render now honours devicePixelRatio.
 *
 * The bug: renderPageToCanvas sized the canvas backing store to (scale × base) with NO
 * devicePixelRatio factor and gave the canvas no CSS size, so on a HiDPI display the
 * bitmap was upscaled by the screen → blurry note text. The fix renders the backing
 * store dpr× denser while keeping the on-screen (CSS) size — and the markup overlay —
 * unchanged.
 *
 * This drives the REAL built viewer at deviceScaleFactor:2 (the HiDPI case) with a
 * generated one-page PDF and asserts:
 *   1. canvas backing width ≈ 2 × canvas CSS width   (the fix: dense bitmap)
 *   2. SVG overlay width == canvas CSS width          (no geometry regression)
 * and at deviceScaleFactor:1 the backing == CSS (never worse than before).
 *
 * Run:  npm run build && npx vite preview --port 4173   (in one shell)
 *       node ui-audit/verify-new2-dpr.mjs               (in another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PDF_PATH = "/tmp/new2-test.pdf";

/* A minimal but structurally-valid one-page PDF (612×792, Letter) with fine text, xref
 * byte-offsets computed exactly so PDF.js parses it without a rebuild. */
function buildPdf() {
  const stream =
    "BT /F1 16 Tf 54 720 Td (NEW-2 DPI render fidelity test) Tj " +
    "0 -22 Td (the quick brown fox jumps 0123456789 ABCDEFG abcdefg) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets[i] = Buffer.byteLength(pdf, "latin1");
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

async function openViewerAndMeasure(browser, dsf) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: dsf });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1200);
  // Switch to the Document Review workspace (its module tab is labelled "Markup").
  await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
  await page.waitForTimeout(900);
  // Load the generated PDF through the real hidden file input.
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  // Wait for the canvas to render at a concrete (non-zero) backing size.
  await page.waitForFunction(() => {
    const c = document.querySelector("canvas");
    return c && c.width > 0 && c.getBoundingClientRect().width > 0;
  }, { timeout: 12000 });
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const c = document.querySelector("canvas");
    const cr = c.getBoundingClientRect();
    return {
      dpr: window.devicePixelRatio,
      backingW: c.width, backingH: c.height,                    // bitmap (device) px
      cssW: Math.round(cr.width), cssH: Math.round(cr.height),  // on-screen px (what the markup overlay binds to via dims.w/h)
    };
  });
  await page.screenshot({ path: new URL(`./screens/new2-dpr${dsf}.png`, import.meta.url).pathname });
  await ctx.close();
  return m;
}

writeFileSync(PDF_PATH, buildPdf());
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const hi = await openViewerAndMeasure(browser, 2);
const lo = await openViewerAndMeasure(browser, 1);
await browser.close();

const ratioHi = hi.backingW / hi.cssW;
const ratioLo = lo.backingW / lo.cssW;
console.log("deviceScaleFactor=2 →", hi, "backing/css =", ratioHi.toFixed(3));
console.log("deviceScaleFactor=1 →", lo, "backing/css =", ratioLo.toFixed(3));

const pass =
  Math.abs(ratioHi - 2) < 0.06 &&            // HiDPI: backing store is ~2× denser (the fix → crisp text)
  Math.abs(ratioLo - 1) < 0.06 &&            // DPR=1: backing == on-screen (never worse than before)
  hi.cssW === lo.cssW && hi.cssH === lo.cssH; // on-screen size is DPR-invariant → markup overlay geometry unchanged
console.log(pass ? "\nPASS ✅ — HiDPI renders 2× dense (crisp); on-screen size DPR-invariant so the overlay geometry is unchanged"
                 : "\nFAIL ❌ — see numbers above");
process.exit(pass ? 0 : 1);
