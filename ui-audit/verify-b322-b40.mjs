/* Verify B322 (canvas memory budget) + B40 amendment (render race) against the REAL built
 * single-sheet viewer (vite preview on :4173), logged-out (these are browser-only).
 *
 *   B322 — open a big E-size sheet (2448×1584 pt), zoom to the 600% max, then read the actual
 *          canvas BACKING STORE (canvas.width × canvas.height). The fix must keep it ≤ ~24 MP;
 *          the pre-fix code floored density at 1× and allocated ~140 MP (~533 MB RGBA) here.
 *   B40  — rapidly switch sheets + zoom on a multi-sheet set and assert NO "Cannot use the same
 *          canvas during multiple render operations" error fires and the canvas stays healthy.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b322-b40.mjs                      (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// pdf.js v6 render needs Map.prototype.getOrInsertComputed — use chromium-1228 (see V72/V76).
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/b322-esize.pdf";
const BUDGET = 24e6;

/* A structurally-valid THREE-page PDF, each an E-size sheet (2448×1584 pt), with exact xref
 * byte-offsets so PDF.js parses it without a rebuild. Three pages so B40's sheet-switch race
 * has something to switch between. */
function buildPdf() {
  const content = (n) => `BT /F1 40 Tf 80 1480 Td (E-SIZE SHEET ${n} - 2448x1584) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2448 1584] /Resources << /Font << /F1 9 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2448 1584] /Resources << /Font << /F1 9 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 2448 1584] /Resources << /Font << /F1 9 0 R >> >> /Contents 8 0 R >>",
    `<< /Length ${content(1).length} >>\nstream\n${content(1)}\nendstream`,
    `<< /Length ${content(2).length} >>\nstream\n${content(2)}\nendstream`,
    `<< /Length ${content(3).length} >>\nstream\n${content(3)}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }); // 2× DPR — the budget must still hold
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") pageErrors.push(m.text()); });

const canvasPx = () => page.evaluate(() => { const c = document.querySelector("canvas"); return c ? { w: c.width, h: c.height, cssW: c.getBoundingClientRect().width } : null; });

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
  await page.waitForTimeout(700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 15000 });
  await page.waitForTimeout(500);

  // ---- B322: zoom to the 600% max and read the backing store ----
  for (let i = 0; i < 30; i++) { // clampScale caps at 6 (600%); extra clicks just saturate
    await page.getByRole("button", { name: "+", exact: true }).click().catch(() => {});
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(600);
  const px = await canvasPx();
  const mp = (px.w * px.h) / 1e6;
  ok("B322 backing store ≤ ~24 MP at 600%", px.w * px.h <= BUDGET * 1.05,
    `canvas ${px.w}×${px.h} = ${mp.toFixed(1)} MP backing store (pre-fix ≈ 140 MP / ~533 MB); CSS width ${Math.round(px.cssW)}px`);
  ok("B322 still allocates a real (non-degenerate) canvas", px.w > 1000 && px.h > 1000,
    `${px.w}×${px.h} (the CSS box stays base×scale; only the device-pixel density dropped)`);

  // ---- B40: rapid sheet-switch + zoom must not hit the same-canvas render error ----
  await page.getByRole("button", { name: "Fit", exact: true }).click().catch(() => {});
  await page.waitForTimeout(300);
  for (let round = 0; round < 4; round++) {
    for (const n of [2, 3, 1]) {
      await page.locator(`button:has-text("Sheet ${n}")`).first().click().catch(() => {});
      await page.waitForTimeout(35); // switch again before the prior render's getPage resolves
    }
    await page.getByRole("button", { name: "+", exact: true }).click().catch(() => {});
  }
  await page.waitForTimeout(800);
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 8000 }).catch(() => {});
  const sameCanvas = pageErrors.filter((e) => /same canvas during multiple render/i.test(e));
  ok("B40 no same-canvas render error during rapid switching", sameCanvas.length === 0,
    sameCanvas.length ? sameCanvas[0] : "0 same-canvas errors across 12 rapid switches + zooms");
  const healthy = await canvasPx();
  ok("B40 canvas still renders after the churn", !!healthy && healthy.w > 0, healthy ? `canvas ${healthy.w}×${healthy.h}` : "no canvas");

  const otherErrors = pageErrors.filter((e) => !/same canvas during multiple render/i.test(e) && !/ERR_CERT|favicon|net::ERR|geogimstest|arcgis/i.test(e));
  ok("no unexpected page errors", otherErrors.length === 0, otherErrors.length ? otherErrors.slice(0, 3).join(" | ") : "clean");
} catch (e) {
  ok("harness ran", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
