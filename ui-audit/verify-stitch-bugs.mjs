/* Verify the drawing-stitch bug fixes (branch claude/drawing-stitch-bugs):
 *   FIX-1  Removing the world-frame (index-0) sheet no longer strands a leftover
 *          aligned:false sheet (it loses its Align button + stays measure-blocked).
 *   FIX-2  The ± zoom buttons anchor on the viewport CENTRE (like the wheel), not the
 *          world origin — a fixed point near centre stays put across a zoom click.
 *   FIX-3  Distance read-outs show one decimal foot (matching the single-sheet tool, B296),
 *          not whole-foot rounding.
 *
 * Run:  npm run build && npx vite preview --port 4173    (one shell)
 *       node ui-audit/verify-stitch-bugs.mjs             (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const W = 1224, H = 792; // 17×11 @72 → ANSI B (standard plot → stated scale trusted)
function pageStream({ title, number, leftRef, rightRef }) {
  const L = [];
  const T = (size, x, y, s) => L.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
  const TBX = 990;
  T(20, TBX, H - 130, title);
  if (number) T(11, TBX, H - 162, `SHEET NO. ${number}`);
  if (number) T(11, TBX, H - 186, `SCALE: 1"=40'`);
  T(11, TBX, H - 210, "PROJECT KATY GRAND");
  for (let i = 0; i < 16; i++) T(10, TBX, H - 262 - i * 22, `GENERAL NOTE ${i + 1}`);
  if (leftRef) T(13, 110, H / 2, `MATCH LINE - SEE SHEET ${leftRef}`);
  if (rightRef) T(13, 720, H / 2, `MATCH LINE - SEE SHEET ${rightRef}`);
  if (number) T(12, 150, H - 220, "PROPOSED GRADING");
  return L.join("\n");
}
const SHEETS = [
  { title: "COVER SHEET" },
  { title: "GRADING PLAN", number: "C-5", rightRef: "C-6" },
  { title: "GRADING PLAN", number: "C-6", leftRef: "C-5", rightRef: "C-7" },
  { title: "GRADING PLAN", number: "C-7", leftRef: "C-6" },
];
function buildPdf() {
  const N = SHEETS.length, fontNum = 3 + 2 * N;
  const o = [];
  o[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  o[2] = `<< /Type /Pages /Kids [${SHEETS.map((_, i) => `${3 + 2 * i} 0 R`).join(" ")}] /Count ${N} >>`;
  SHEETS.forEach((sp, i) => {
    const pnum = 3 + 2 * i, cnum = 4 + 2 * i;
    const stream = pageStream(sp);
    o[pnum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontNum} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${cnum} 0 R >>`;
    o[cnum] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  o[fontNum] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n";
  const off = [];
  for (let i = 1; i < o.length; i++) { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1"), n = o.length;
  pdf += `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const PDF = { name: "katy-grand-civil.pdf", mimeType: "application/pdf", buffer: buildPdf() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await sleep(1200);

const bodyTxt = () => page.evaluate(() => document.body.innerText);
const imageRects = () => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].find((s) => s.querySelector("image"));
  if (!svg) return [];
  return [...svg.querySelectorAll("image")].map((im) => { const r = im.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2 }; }).sort((a, b) => a.x - b.x);
});
const svgRect = () => page.evaluate(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")) || document.querySelector("svg"); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });

await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
await sleep(700);
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
await sleep(700);
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 }).catch(() => {});
await sleep(400);

// Add the auto-stitched, auto-CALIBRATED grouped plan first (clean default view) for the
// composite/scale/measure checks; the raw-page FIX-1 runs last after a reset.
await page.locator('button:has-text("Grading Plan")').first().click({ timeout: 8000 });
await page.waitForFunction(() => /Scale set/.test(document.body.innerText), {}, { timeout: 20000 }).catch(() => {});
await sleep(700);
let txt = await bodyTxt();
const groupImgs = await imageRects();
const onSheet = (img, fx, fy) => ({ x: img.x + img.w * fx, y: img.y + img.h * fy });

console.log("\nFIX-4 — composite key shows the real engineer's scale, not 'units/ft':");
check(/1"\s*≈\s*40'/.test(txt), `the composite key reads the drawing scale (1" ≈ 40'), not a meaningless 'units/ft'`);
check(!/units\/ft/.test(txt), "the meaningless 'units/ft' readout is gone");

console.log("\nFIX-3 — distance read-out shows one decimal foot:");
// Calibrated now → a real measurement must show a NON-zero one-decimal foot (not whole-foot,
// and not the trivial "0.0 ft" takeoff placeholder).
const dimg = groupImgs[0]; // the anchor sheet, near the default viewport
await page.locator('button:has-text("Distance")').first().click({ timeout: 8000 });
await sleep(200);
if (dimg) {
  const a = onSheet(dimg, 0.2, 0.5), b = onSheet(dimg, 0.7, 0.5);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await sleep(400);
}
txt = await bodyTxt();
check(/[1-9][\d,]*\.\d\s*ft/.test(txt), `a real distance shows a non-zero one-decimal foot (not whole-foot)`);

console.log("\nFIX-5 — the inline Calibrate box follows the line under wheel-zoom:");
await page.locator('button:has-text("Calibrate")').first().click({ timeout: 8000 });
await sleep(200);
if (dimg) {
  const a = onSheet(dimg, 0.25, 0.35), b = onSheet(dimg, 0.6, 0.35);
  await page.mouse.click(a.x, a.y);
  await page.mouse.click(b.x, b.y);
  await sleep(300);
}
// Select the calibrate box by its unique input placeholder (avoids matching a full-width parent).
const boxLeft = () => page.evaluate(() => { const i = document.querySelector('input[placeholder*="38"]'); return i ? i.getBoundingClientRect().left : null; });
const before2 = await boxLeft();
check(before2 != null, "the inline Calibrate box opened");
if (before2 != null) {
  const cc = await svgRect();
  await page.mouse.move(cc.x + cc.w / 2, cc.y + 60);
  await page.mouse.wheel(0, -400);
  await sleep(300);
  const after2 = await boxLeft();
  check(after2 != null && Math.abs(after2 - before2) > 8, `the box tracked the zoom (left ${before2 == null ? "?" : Math.round(before2)}→${after2 == null ? "?" : Math.round(after2)}), not stranded`);
}
await page.keyboard.press("Escape");
await sleep(150);

console.log("\nFIX-2 — the ± zoom buttons anchor on the viewport centre:");
const sr = await svgRect();
const C = sr.x + sr.w / 2;            // viewport centre, screen px
const before = (await imageRects())[0];
await page.locator("button", { hasText: /^\+$/ }).first().click({ timeout: 8000 });
await sleep(400);
const after = (await imageRects())[0];
if (before && after) {
  const ratio = (after.x - C) / ((before.x - C) || 1e-6);
  check(after.w > before.w * 1.1, `the sheet grew on +zoom (w ${Math.round(before.w)}→${Math.round(after.w)})`);
  check(Math.abs(ratio - 1.2) < 0.18, `a fixed point's offset from centre scaled ~1.2× (got ${ratio.toFixed(2)}) — centre-anchored`);
}

console.log("\nFIX-1 — removing the world-frame sheet doesn't strand an unaligned sheet:");
// Run in a FRESH context (clean localStorage) so the raw-page manual-add path starts empty —
// the earlier grouped composite would otherwise still be on this canvas.
const ctx2 = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const p2 = await ctx2.newPage();
p2.on("pageerror", (e) => pageErrors.push(String(e)));
await p2.goto(BASE, { waitUntil: "load" });
await sleep(1200);
await p2.locator('button:has-text("Library")').first().click({ timeout: 8000 });
await sleep(700);
await p2.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
await sleep(700);
await p2.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await p2.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 }).catch(() => {});
await sleep(400);
await p2.locator('button:has-text("all pages")').first().click({ timeout: 8000 });
await sleep(300);
await p2.locator('button:has-text("· p1")').first().click({ timeout: 8000 }); // frame (aligned)
await sleep(500);
await p2.locator('button:has-text("· p2")').first().click({ timeout: 8000 }); // aligned:false, needs Align
await sleep(700);
const p2txt = () => p2.evaluate(() => document.body.innerText);
const p2imgs = () => p2.evaluate(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")); return s ? s.querySelectorAll("image").length : 0; });
txt = await p2txt();
check(/Not aligned/.test(txt), "the manually-added 2nd sheet is flagged 'Not aligned' (precondition)");
check((await p2imgs()) === 2, `two sheets are placed (precondition, images = ${await p2imgs()})`);
await p2.locator('button:has-text("Remove")').first().click({ timeout: 8000 }); // remove the frame
await sleep(600);
txt = await p2txt();
const n1 = await p2imgs();
check(n1 === 1, `one sheet remains after removing the frame (images = ${n1})`);
check(!/Not aligned/.test(txt), "the surviving sheet is promoted to the frame — no stranded 'Not aligned' state");
check(/placed sheets · 1/i.test(txt), "the placed-sheets count reads 1");
await ctx2.close();

check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await page.screenshot({ path: new URL("./screens/stitch-bugs.png", import.meta.url).pathname }).catch(() => {});
await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
