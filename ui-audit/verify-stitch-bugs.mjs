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
  return [...svg.querySelectorAll("image")].map((im) => { const r = im.getBoundingClientRect(); return { x: r.x, w: r.width, cx: r.x + r.width / 2 }; }).sort((a, b) => a.x - b.x);
});
const svgRect = () => page.evaluate(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")) || document.querySelector("svg"); const r = s.getBoundingClientRect(); return { x: r.x, w: r.width }; });

await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
await sleep(700);
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 }).catch(() => {});
await sleep(400);

console.log("\nFIX-1 — removing the world-frame sheet doesn't strand an unaligned sheet:");
// Use the raw per-page tray so the 2nd added sheet is aligned:false (manual-add path).
await page.locator('button:has-text("all pages")').first().click({ timeout: 8000 });
await sleep(300);
// Add page 1 (frame, aligned) then page 2 (aligned:false, needs Align).
await page.locator('button:has-text("· p1")').first().click({ timeout: 8000 });
await sleep(500);
await page.locator('button:has-text("· p2")').first().click({ timeout: 8000 });
await sleep(700);
let txt = await bodyTxt();
check(/Not aligned/.test(txt), "the manually-added 2nd sheet is flagged 'Not aligned' (precondition)");
check((await imageRects()).length === 2, "two sheets are placed (precondition)");
// Remove the FIRST placed sheet (the frame). Its card is the first "Remove" button.
await page.locator('button:has-text("Remove")').first().click({ timeout: 8000 });
await sleep(600);
txt = await bodyTxt();
const imgs1 = await imageRects();
check(imgs1.length === 1, `one sheet remains after removing the frame (images = ${imgs1.length})`);
check(!/Not aligned/.test(txt), "the surviving sheet is promoted to the frame — no stranded 'Not aligned' state");
check(/placed sheets · 1/i.test(txt), "the placed-sheets count reads 1");

console.log("\nFIX-2 — the ± zoom buttons anchor on the viewport centre:");
const sr = await svgRect();
const C = sr.x + sr.w / 2;            // viewport centre, page coords
const before = (await imageRects())[0];
await page.locator("button", { hasText: /^\+$/ }).first().click({ timeout: 8000 });
await sleep(400);
const after = (await imageRects())[0];
if (before && after) {
  const ratio = (after.x - C) / ((before.x - C) || 1e-6);
  // Centre-anchored zoom by 1.2 ⇒ (x − C) scales by ~1.2; origin-anchored would not.
  check(after.w > before.w * 1.1, `the sheet grew on +zoom (w ${Math.round(before.w)}→${Math.round(after.w)})`);
  check(Math.abs(ratio - 1.2) < 0.18, `a fixed point's offset from centre scaled ~1.2× (got ${ratio.toFixed(2)}) — centre-anchored`);
}

console.log("\nFIX-3 — distance read-out shows one decimal foot:");
// The set is auto-calibrated (scale set). Draw a Distance across the placed sheet.
await page.locator('button:has-text("Distance")').first().click({ timeout: 8000 });
await sleep(200);
const d = await imageRects();
if (d[0]) {
  const y = 470;
  await page.mouse.click(d[0].x + 30, y);
  await page.mouse.click(d[0].x + d[0].w * 0.6, y);
  await sleep(400);
}
txt = await bodyTxt();
check(/\d\.\d\s*ft/.test(txt), `a distance label/total shows a decimal foot (one-decimal, not whole-foot)`);

check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await page.screenshot({ path: new URL("./screens/stitch-bugs.png", import.meta.url).pathname }).catch(() => {});
await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
