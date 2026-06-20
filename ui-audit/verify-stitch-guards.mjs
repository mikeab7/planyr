/* Verify the 2026-06-20 Doc Review STITCHER takeoff-correctness guards (B300/B301) against
 * the REAL built stitcher (vite preview on :4173). Loads a 2-page PDF into the Stitch
 * workspace, places both sheets (sheet 2 lands un-aligned), then drives:
 *
 *   B301 — an un-aligned later sheet is flagged "NEEDS ALIGN", and a Distance measurement
 *          whose points land on it is BLOCKED (error banner, nothing committed) — so its
 *          (possibly different) scale can't silently corrupt the shared takeoff.
 *   B300 — a degenerate Align (two coincident clicks on the moving sheet) is REJECTED with
 *          the "too close together" banner, and the sheet's transform is left UNTOUCHED
 *          (scale stays ~1, not flung to a runaway ×N) — the bug had no undo.
 *
 * Run:  npm run build && npx vite preview --port 4173    (one shell)
 *       node ui-audit/verify-stitch-guards.mjs                  (another)
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome"; // 1228 rasterizes pdf.js
const PDF_PATH = "/tmp/b297-stitch-test.pdf";

/* Structurally-valid TWO-page Letter PDF (exact xref offsets so PDF.js parses without a rebuild). */
function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (SHEET ONE - stitch guard test) Tj ET";
  const s2 = "BT /F1 20 Tf 60 700 Td (SHEET TWO - unaligned sheet) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`,
    `<< /Length ${s2.length} >>\nstream\n${s2}\nendstream`,
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

// centre of the i-th placed sheet image, in screen px
const imgCentre = (page, i) => page.evaluate((idx) => {
  const im = document.querySelectorAll("svg image")[idx];
  if (!im) return null;
  const r = im.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}, i);
// scale of the i-th placed sheet's matrix(A B -B A e f) transform
const sheetScale = (page, i) => page.evaluate((idx) => {
  const g = document.querySelectorAll('g[transform^="matrix"]')[idx];
  if (!g) return null;
  const m = /matrix\(([-\d.eE]+)/.exec(g.getAttribute("transform"));
  return m ? Math.abs(parseFloat(m[1])) : null;
}, i);
const bannerText = (page) => page.evaluate(() => document.body.innerText);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1000);
  await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
  await page.waitForTimeout(500);
  // into the Stitch workspace
  await page.locator('button:has-text("Stitch sheets")').first().click({ timeout: 8000 });
  await page.waitForTimeout(500);
  // load the PDF, then place both pages onto the world canvas
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.locator('button:has-text("· p1")').first().waitFor({ timeout: 12000 });
  await page.locator('button:has-text("· p1")').first().click(); // place sheet 1 (anchor)
  await page.waitForTimeout(400);
  await page.locator('button:has-text("· p2")').first().click(); // place sheet 2 (needs align)
  await page.waitForFunction(() => document.querySelectorAll("svg image").length >= 2 &&
    [...document.querySelectorAll("svg image")].every((im) => im.getBoundingClientRect().width > 0), { timeout: 12000 });
  await page.waitForTimeout(400);

  // ---- B301 visual: sheet 2 is flagged "NEEDS ALIGN" ----
  {
    const badge = await page.locator('text=NEEDS ALIGN').count();
    ok("B301 unaligned sheet is flagged", badge >= 1, `NEEDS ALIGN badge present (count ${badge})`);
  }

  // ---- B301 block: measuring over the un-aligned sheet is refused ----
  {
    await page.getByRole("button", { name: "Distance", exact: true }).click();
    const c = await imgCentre(page, 1); // sheet 2
    await page.mouse.click(c.x - 20, c.y);
    await page.mouse.click(c.x + 20, c.y);
    await page.waitForTimeout(250);
    const lines = await page.evaluate(() => document.querySelectorAll('svg line[stroke="#0e7490"]').length);
    const blocked = /isn.?t aligned|align it before measuring/i.test(await bannerText(page));
    ok("B301 measuring on an un-aligned sheet is blocked", lines === 0 && blocked,
      `committed distance lines=${lines} (want 0); banner warns=${blocked}`);
  }

  // ---- B300: a degenerate Align (coincident moving-sheet clicks) is rejected, sheet untouched ----
  {
    const scaleBefore = await sheetScale(page, 1);
    await page.getByRole("button", { name: "Align", exact: true }).click(); // align sheet 2
    await page.waitForTimeout(150);
    const a = await imgCentre(page, 0); // a reference point over sheet 1 (the anchor)
    const b = await imgCentre(page, 1); // the moving sheet (sheet 2)
    await page.mouse.click(a.x, a.y);            // step0: reference #1
    await page.mouse.click(b.x, b.y);            // step1: matching #1 on the moving sheet
    await page.mouse.click(a.x + 200, a.y);      // step2: reference #2 (far → big reference baseline)
    await page.mouse.click(b.x, b.y);            // step3: matching #2 == #1  → moving baseline ≈ 0 (degenerate)
    await page.waitForTimeout(300);
    const scaleAfter = await sheetScale(page, 1);
    const rejected = /too close together|farther apart/i.test(await bannerText(page));
    const untouched = scaleBefore != null && scaleAfter != null && Math.abs(scaleAfter - scaleBefore) < 0.05 && Math.abs(scaleAfter - 1) < 0.1;
    ok("B300 degenerate align is rejected with a banner", rejected, `banner shows "too close" = ${rejected}`);
    ok("B300 sheet transform left untouched (not flung)", untouched,
      `scale ${scaleBefore?.toFixed(3)} → ${scaleAfter?.toFixed(3)} (want ≈1, |Δ|<0.05)`);
  }

  ok("no uncaught page errors", pageErrors.length === 0, `${pageErrors.length} page errors${pageErrors[0] ? " — " + pageErrors[0] : ""}`);
} catch (e) {
  ok("harness ran to completion", false, String(e));
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length && results.length > 0 ? 0 : 1);
}
