/* Verify the B471 Phase-1 Revision-Compare view against the REAL built app (vite preview on :4173).
 *
 * Builds TWO single-page PDFs that share most of their ink (border + title-block + text) but differ
 * by ONE filled box each — box removed in the newer, a different box added — so the pure compare
 * engine must surface exactly one REMOVED region and one ADDED region. Then, in the Review workspace,
 * picks both files through the "⇄ Compare…" input and asserts the color-wash + change-list:
 *   - the compare view opens and finishes (status "ready"),
 *   - the change-list finds ≥1 removed AND ≥1 added change (the two boxes),
 *   - the wash canvas actually rendered (non-zero size),
 *   - clicking a change in the list jumps to it (active-region index goes from -1 to ≥0).
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-compare.mjs                (another)
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// pdf.js needs the newer bundled Chromium (Map.prototype.getOrInsertComputed) — same note as
// verify-docreview-viewer.mjs. Override with PW_CHROME if your environment differs.
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

// A structurally-valid single-page Letter PDF (612×792) with exact xref offsets so PDF.js parses
// it without a rebuild. `diffOps` is the page-unique content (the added/removed box); the rest is
// shared between both revisions so registration has ample matching ink (high confidence).
function buildPdf(diffOps) {
  const shared =
    "2 w 40 40 532 712 re S\n" +                                  // border
    "BT /F1 40 Tf 70 700 Td (REVISION COMPARE) Tj ET\n" +          // title
    "1 w 40 660 m 572 660 l S\n" +                                 // rule under title
    "1 w 40 120 m 572 120 l S\n1 w 40 60 m 572 60 l S\n" +         // title block
    "1 w 300 120 m 300 40 l S\n" +                                 // title block divider
    "BT /F1 14 Tf 320 90 Td (SHEET A-101) Tj ET\n" +
    "BT /F1 14 Tf 320 68 Td (SCALE 1 inch = 20 ft) Tj ET\n";
  const content = shared + diffOps;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
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

mkdirSync("/tmp/compare", { recursive: true });
const A = "/tmp/compare/revA.pdf", B = "/tmp/compare/revB.pdf";
writeFileSync(A, buildPdf("120 480 90 90 re f\n"));   // older: a box that is REMOVED in the newer
writeFileSync(B, buildPdf("400 190 90 90 re f\n"));   // newer: a different box, ADDED

const results = [];
const ok = (name, pass, detail) => { results.push({ pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };
const numOf = (s) => { const m = String(s || "").match(/(\d+)/); return m ? +m[1] : NaN; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE + "#markup", { waitUntil: "load" });
  await page.waitForTimeout(1200);

  // Pick the two revisions through the always-mounted compare input.
  await page.setInputFiles('[data-testid="compare-input"]', [A, B], { timeout: 8000 });

  // The compare view opens and runs the (main-thread) compare; wait for it to reach "ready".
  await page.waitForSelector('[data-cmp="compare-view"]', { timeout: 8000 });
  await page.waitForFunction(() => {
    const v = document.querySelector('[data-cmp="compare-view"]');
    return v && (v.getAttribute("data-status") === "ready" || v.getAttribute("data-status") === "error");
  }, { timeout: 20000 });

  const status = await page.getAttribute('[data-cmp="compare-view"]', "data-status");
  ok("compare view reaches ready (not error)", status === "ready", `status = ${status}`);

  // Change-list: the two boxes → ≥1 removed and ≥1 added.
  const items = await page.locator('[data-cmp="change-item"]').count();
  const removed = numOf(await page.locator('[data-cmp="count-removed"]').textContent().catch(() => ""));
  const added = numOf(await page.locator('[data-cmp="count-added"]').textContent().catch(() => ""));
  ok("change-list finds ≥2 changes", items >= 2, `${items} change item(s)`);
  ok("finds the REMOVED box", removed >= 1, `removed count = ${removed}`);
  ok("finds the ADDED box", added >= 1, `added count = ${added}`);

  // The color-wash canvas rendered at a real size.
  const canvas = await page.evaluate(() => {
    const c = document.querySelector('[data-cmp="compare-view"] canvas');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { w: c.width, h: c.height, cssW: r.width, cssH: r.height };
  });
  ok("wash canvas rendered", !!canvas && canvas.w > 0 && canvas.cssW > 50, canvas ? `${canvas.w}×${canvas.h} (css ${Math.round(canvas.cssW)}×${Math.round(canvas.cssH)})` : "no canvas");

  // Click the first change → the view jumps to it (active-region index goes from -1 to ≥0).
  const before = await page.getAttribute('[data-cmp="compare-view"]', "data-active-region");
  await page.locator('[data-cmp="change-item"]').first().click();
  await page.waitForTimeout(200);
  const after = await page.getAttribute('[data-cmp="compare-view"]', "data-active-region");
  ok("clicking a change jumps to it", before === "-1" && Number(after) >= 0, `active-region ${before} → ${after}`);

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | ") || "clean");
} catch (e) {
  ok("harness ran without throwing", false, String(e).split("\n")[0]);
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
