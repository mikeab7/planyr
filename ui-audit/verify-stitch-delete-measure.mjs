/* Verify B376 (Stitcher half): a committed measurement on the stitched canvas can now be
 * DELETED. Before this, the stitcher had no select-or-delete for a placed measure at all —
 * a stray "set scale" area could never be removed. Drives the REAL built app: enter Markup →
 * Stitch, place the auto-aligned base sheet, draw a 3-point Area over it, then delete it via
 * the Takeoff list's × and confirm it's gone.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-stitch-delete-measure.mjs   (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

function buildPdf() {
  const o = [];
  o[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  o[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  o[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /ProcSet [/PDF /Text] >> /Contents 4 0 R >>";
  const c1 = "BT /F1 48 Tf 80 650 Td (Stitch Sheet) Tj ET";
  o[4] = `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`;
  o[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const off = [];
  for (let i = 1; i < o.length; i++) { off[i] = pdf.length; pdf += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const xref = pdf.length, n = o.length;
  pdf += `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const PDF = { name: "stitch-1pg.pdf", mimeType: "application/pdf", buffer: buildPdf() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const imageRects = (page) => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("image"));
  if (!svg) return [];
  return [...svg.querySelectorAll("image")].map((im) => { const r = im.getBoundingClientRect(); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
});
const polygonCount = (page) => page.evaluate(() => {
  const overlay = [...document.querySelectorAll("svg")].map((s) => { const r = s.getBoundingClientRect(); return { s, a: r.width * r.height }; }).sort((a, b) => b.a - a.a)[0];
  return overlay && overlay.a > 10000 ? overlay.s.querySelectorAll("polygon").length : -1;
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await sleep(1200);
  await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
  await sleep(700);
  // Enter Stitch and place the auto-aligned base sheet
  await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
  await sleep(700);
  await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
  await sleep(1500);
  await page.locator('button:has-text("· p")').nth(0).click({ timeout: 8000 }); // base sheet (auto-aligned)
  await sleep(1200);
  const imgs = await imageRects(page);
  check(imgs.length === 1, `base sheet placed on the stitch canvas (images = ${imgs.length})`);

  // Draw a 3-point Area over the (auto-aligned) base sheet → commits one polygon
  await page.locator('button:has-text("Area")').first().click({ timeout: 8000 });
  await sleep(150);
  const b = imgs[0];
  const tri = [[b.cx - 50, b.cy - 40], [b.cx + 50, b.cy - 40], [b.cx, b.cy + 50]];
  for (const [x, y] of tri) { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await sleep(140); }
  await page.keyboard.press("Enter");
  await sleep(300);
  check((await polygonCount(page)) === 1, `Area committed on the stitch canvas (polygons = ${await polygonCount(page)})`);

  // The Takeoff list now shows the measure with its own × (the ONLY way to delete it here)
  const del = page.getByTitle("Delete this measurement");
  check((await del.count()) === 1, `committed measure is listed with a delete × (buttons = ${await del.count()})`);
  check(/set scale/.test(await page.evaluate(() => document.body.innerText)), "the uncalibrated measure shows 'set scale' (Michael's case)");

  // Delete it → polygon gone, count back to zero
  await del.first().click();
  await sleep(300);
  check((await polygonCount(page)) === 0, `the × removed the measurement (polygons = ${await polygonCount(page)})`);
  check((await page.getByTitle("Delete this measurement").count()) === 0, "the list row is gone after deletion");

  check(pageErrors.length === 0, pageErrors.length ? pageErrors.join(" | ") : "no page errors");
} catch (e) {
  check(false, "harness ran: " + String(e));
} finally {
  await browser.close();
}

console.log(`\n${fails.length === 0 ? "ALL PASS ✅" : fails.length + " FAILED ❌"}`);
process.exit(fails.length === 0 ? 0 : 1);
