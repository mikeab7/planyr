/* Verify B288 / B289 / B290 — Document Review stitch + markup safety guards.
 *
 * Drives the REAL built app (logged-out; the stitch/markup core is browser-only) with a
 * generated minimal 2-page PDF — no owner sample needed. Asserts:
 *   B290 (single Markup): a 2-point Area can't be committed; a 3-point Area can.
 *   B289 (Stitch): a freshly-added 2nd sheet is flagged "Not aligned"; measuring over it
 *                  warns; a valid Align clears the flag.
 *   B288 (Stitch): a degenerate Align (two coincident points on the moving sheet) is
 *                  rejected with the "too close together" banner and leaves the sheet
 *                  un-aligned (not flung) — then a real Align still succeeds.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b288-b290.mjs               (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// PDF.js 6.x uses Map.prototype.getOrInsertComputed; chromium-1194 is too old for it, so
// default to the newer 1228 build (override with PW_CHROME).
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

// --- a canonical, byte-accurate 2-page text PDF (standard-14 Helvetica; renders everywhere) ---
function buildPdf() {
  const o = [];
  o[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  o[2] = "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>";
  o[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> /ProcSet [/PDF /Text] >> /Contents 4 0 R >>";
  const c1 = "BT /F1 48 Tf 80 650 Td (Page One) Tj ET";
  o[4] = `<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`;
  o[5] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> /ProcSet [/PDF /Text] >> /Contents 6 0 R >>";
  const c2 = "BT /F1 48 Tf 80 650 Td (Page Two) Tj ET";
  o[6] = `<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`;
  o[7] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const off = [];
  for (let i = 1; i < o.length; i++) { off[i] = pdf.length; pdf += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const xref = pdf.length, n = o.length;
  pdf += `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const PDF = { name: "test-2pg.pdf", mimeType: "application/pdf", buffer: buildPdf() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await sleep(1200);

// Enter Document Review (Markup)
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);

// rects of the placed-sheet <image> elements in the stitcher canvas (DOM order = placed order)
const imageRects = () => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("image"));
  if (!svg) return [];
  return [...svg.querySelectorAll("image")].map((im) => { const r = im.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; });
});
// the markup overlay svg = the largest-area <svg> on screen (the page-sized drawing
// surface; far bigger than any header icon). Robust to DOM nesting.
const overlayRect = () => page.evaluate(() => {
  const svgs = [...document.querySelectorAll("svg")].map((s) => { const r = s.getBoundingClientRect(); return { r, a: r.width * r.height }; }).sort((a, b) => b.a - a.a);
  const r = svgs[0] && svgs[0].r; if (!r || r.width < 50) return null;
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const waitOverlay = () => page.waitForFunction(() => {
  const big = [...document.querySelectorAll("svg")].some((s) => s.getBoundingClientRect().width > 300);
  return big;
}, {}, { timeout: 15000 }).catch(async () => {
  const diag = await page.evaluate(() => [...document.querySelectorAll("svg")].map((s) => { const r = s.getBoundingClientRect(); return Math.round(r.width) + "x" + Math.round(r.height); }));
  console.log("  [diag] svg sizes:", JSON.stringify(diag));
  throw new Error("overlay not found");
});
const clickAt = async (x, y) => { await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.up(); await sleep(140); };
// count committed-area <polygon>s INSIDE the markup overlay (largest svg) only — header/
// toolbar icons are <polygon>s too, so a document-wide count is meaningless.
const polygonCount = () => page.evaluate(() => {
  const overlay = [...document.querySelectorAll("svg")].map((s) => { const r = s.getBoundingClientRect(); return { s, a: r.width * r.height }; }).sort((a, b) => b.a - a.a)[0];
  return overlay && overlay.a > 10000 ? overlay.s.querySelectorAll("polygon").length : -1;
});

/* ---------------- B290 — single-sheet Area needs ≥3 points ---------------- */
console.log("\nB290 — degenerate Area can't be committed (single Markup):");
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 20000 });
await waitOverlay();
await sleep(600);
await page.locator('button:has-text("Area")').first().click({ timeout: 8000 });
let ov = await overlayRect();
// 2-point area + Enter → must NOT commit (no <polygon>)
await clickAt(ov.x + 120, ov.y + 120);
await clickAt(ov.x + 240, ov.y + 140);
await page.keyboard.press("Enter");
await sleep(300);
const polyAfter2 = await polygonCount();
check(polyAfter2 === 0, `2-point Area is rejected (committed polygons = ${polyAfter2}, want 0)`);
check(/No measurements yet/.test(await page.evaluate(() => document.body.innerText)), "takeoff still reads 'No measurements yet' after the 2-point attempt");
// 3-point area + Enter → commits (one <polygon>)
await clickAt(ov.x + 120, ov.y + 200);
await clickAt(ov.x + 260, ov.y + 210);
await clickAt(ov.x + 230, ov.y + 320);
await page.keyboard.press("Enter");
await sleep(300);
const polyAfter3 = await polygonCount();
check(polyAfter3 === 1, `3-point Area commits (committed polygons = ${polyAfter3}, want 1)`);

/* ---------------- switch to Stitch, place two sheets ---------------- */
console.log("\nB289 — a freshly added 2nd sheet is flagged 'Not aligned':");
await page.locator('button:has-text("Stitch sheets")').first().click({ timeout: 8000 });
await sleep(700);
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await sleep(1500); // render both tray pages
const trayBtns = page.locator('button:has-text("· p")');
await trayBtns.nth(0).click({ timeout: 8000 }); // base sheet (auto-aligned)
await sleep(900);
await trayBtns.nth(1).click({ timeout: 8000 }); // 2nd sheet (needs align)
await sleep(1200);
let imgs = await imageRects();
check(imgs.length === 2, `two sheets placed on the canvas (images = ${imgs.length})`);
const bodyTxt = () => page.evaluate(() => document.body.innerText);
let txt = await bodyTxt();
check(/Not aligned — click/.test(txt), "canvas shows the 'Not aligned — click \"Align\"' overlay");
check(/Not aligned — measurements may be off/.test(txt), "right-panel chip warns the 2nd sheet isn't aligned");

/* ---------------- B289 — measuring over the unaligned sheet warns ---------------- */
console.log("\nB289 — measuring over the unaligned sheet warns:");
await page.locator('div[style] button:has-text("Distance"), button:has-text("Distance")').first().click({ timeout: 8000 });
await sleep(200);
const moving = imgs[1];
await clickAt(moving.cx - 40, moving.cy - 30);
await clickAt(moving.cx + 40, moving.cy + 30);
await sleep(300);
txt = await bodyTxt();
check(/isn’t aligned yet|isn't aligned yet|aligned yet/.test(txt), "a measurement over the unaligned sheet shows the warning banner");

/* ---------------- B288 — a degenerate Align is rejected, sheet untouched ---------------- */
console.log("\nB288 — degenerate Align (coincident points) is rejected, sheet not flung:");
const matrices = () => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("image"));
  return [...svg.querySelectorAll("image")].map((im) => im.parentElement.getAttribute("transform"));
});
const before = await matrices();
// Align the 2nd sheet
await page.locator('button:has-text("Align")').first().click({ timeout: 8000 });
await sleep(300);
imgs = await imageRects();
const base = imgs[0], mov = imgs[1];
// 4 clicks: ref#1 on base, same pt on moving, ref#2 on base (distinct), matching pt on moving = SAME as step1 → degenerate
await clickAt(base.cx, base.cy);
await clickAt(mov.cx, mov.cy);
await clickAt(base.cx + 80, base.cy + 50);
await clickAt(mov.cx, mov.cy);            // coincident with step1 → collapsed moving baseline
await sleep(400);
txt = await bodyTxt();
check(/too close together/.test(txt), "degenerate Align shows the 'too close together' banner");
const afterDegen = await matrices();
check(JSON.stringify(before[1]) === JSON.stringify(afterDegen[1]), "the 2nd sheet's transform is UNCHANGED (not flung off-canvas)");
check(/Not aligned — measurements may be off/.test(txt), "the 2nd sheet is still flagged not-aligned after rejection");

/* ---------------- B288/B289 — a real Align then succeeds and clears the flag ---------------- */
console.log("\nB288/B289 — a valid Align then succeeds and clears the flag:");
// the guard left us in align step-0; drive 4 clicks with DISTINCT baselines on both sheets
imgs = await imageRects();
const b2 = imgs[0], m2 = imgs[1];
await clickAt(b2.cx - 60, b2.cy - 40);
await clickAt(m2.cx - 50, m2.cy - 30);
await clickAt(b2.cx + 70, b2.cy + 50);
await clickAt(m2.cx + 55, m2.cy + 40);
await sleep(500);
txt = await bodyTxt();
check(!/too close together/.test(txt), "no 'too close' error after the valid Align");
check(!/Not aligned/.test(txt), "the 'Not aligned' flag/chip is gone after a successful Align");

await page.screenshot({ path: new URL("./screens/b288-b290.png", import.meta.url).pathname }).catch(() => {});
check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
