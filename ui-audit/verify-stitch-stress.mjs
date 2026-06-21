/* Interactive STRESS test for the Document-Review Stitcher (B350, round 3).
 *
 * Rounds 1–2 fuzzed the PURE engines (geometry, grouping, reader, takeoff). This harness attacks
 * the one surface those can't reach: the LIVE React interaction layer — the manual-Align state
 * machine, the measure-block guard, pan/zoom under interrupted gestures, and a random click fuzz —
 * driving the real app in a headless browser. The bar is simply: no sequence may crash the Stitcher
 * (no uncaught error, the toolbar survives) and each guard must behave (refuse + message, never a
 * silent wrong result or a flung sheet).
 *
 * Run:  npm run build && npx vite preview --port 4173    (one shell)
 *       node ui-audit/verify-stitch-stress.mjs           (another)
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
  return [...svg.querySelectorAll("image")].map((im) => { const r = im.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 }; }).sort((a, b) => a.x - b.x);
});
const svgRect = () => page.evaluate(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")) || document.querySelector("svg"); const r = s.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const toolAlive = () => page.evaluate(() => !!([...document.querySelectorAll("button")].find((b) => /^Calibrate$/.test(b.textContent.trim()))));
const zoomPct = () => page.evaluate(() => { const m = document.body.innerText.match(/(\d+)%/); return m ? +m[1] : null; });

await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
await sleep(700);
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 }).catch(() => {});
await sleep(400);

// Use the raw per-page tray so the 2nd added sheet is aligned:false (manual-add path → an
// unaligned sheet to abuse with Align + measure-block).
await page.locator('button:has-text("all pages")').first().click({ timeout: 8000 });
await sleep(300);
await page.locator('button:has-text("· p1")').first().click({ timeout: 8000 });
await sleep(450);
await page.locator('button:has-text("· p2")').first().click({ timeout: 8000 });
await sleep(600);
check((await imageRects()).length === 2, "precondition: two sheets placed (1 frame + 1 unaligned)");
check(/Not aligned/.test(await bodyTxt()), "precondition: 2nd sheet flagged 'Not aligned'");

console.log("\nS1 — a DEGENERATE manual Align (the two reference points coincide) is refused, sheet not flung:");
const before1 = (await imageRects())[1];
await page.locator('button:has-text("Align")').first().click({ timeout: 8000 });
await sleep(250);
{
  const sr = await svgRect();
  const P1 = { x: sr.x + sr.w * 0.45, y: sr.y + sr.h * 0.5 };  // ref #1
  const onMoving = { x: (await imageRects())[1].cx, y: (await imageRects())[1].cy };
  // step0: ref#1 ; step1: same pt on moving sheet ; step2: ref#2 == ref#1 (degenerate) ; step3: moving pt
  await page.mouse.click(P1.x, P1.y); await sleep(120);
  await page.mouse.click(onMoving.x, onMoving.y); await sleep(120);
  await page.mouse.click(P1.x, P1.y); await sleep(120);                 // ref#2 coincident with ref#1
  await page.mouse.click(onMoving.x + 80, onMoving.y); await sleep(250);
}
check(/too close together/i.test(await bodyTxt()), "S1: shows the 'too close together' guard message");
const after1 = (await imageRects())[1];
check(after1 && Number.isFinite(after1.w) && after1.w > 1 && after1.w < 100000, `S1: the moving sheet was NOT flung to a runaway size (w=${after1 ? Math.round(after1.w) : "?"})`);
check((await imageRects()).length === 2, "S1: both sheets still on canvas");
await page.keyboard.press("Escape"); await sleep(150);

console.log("\nS2 — measuring over the un-aligned sheet is BLOCKED (no silent wrong reading):");
await page.locator('button:has-text("Distance")').first().click({ timeout: 8000 });
await sleep(150);
{
  const s2 = (await imageRects())[1]; // the unaligned sheet
  await page.mouse.click(s2.cx, s2.cy); await sleep(250);
}
check(/Align that sheet before measuring/i.test(await bodyTxt()), "S2: the measure-over-unaligned block fires with its message");
check(/Measures\s*0/i.test((await bodyTxt()).replace(/\s+/g, " ")), "S2: no measurement was committed (Measures 0)");

console.log("\nS3 — an INTERRUPTED pan (window blur mid-drag) doesn't crash or stick:");
await page.locator('button:has-text("Pan")').first().click({ timeout: 8000 });
await sleep(120);
{
  const sr = await svgRect();
  const start = { x: sr.x + sr.w * 0.5, y: sr.y + sr.h * 0.5 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 60, start.y + 40, { steps: 4 });
  await page.evaluate(() => window.dispatchEvent(new Event("blur"))); // abort mid-gesture (B325/NEW-1)
  await sleep(120);
  await page.mouse.up();
  await sleep(150);
  // a follow-up pan must still work (not stuck with capture held)
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(start.x - 40, start.y, { steps: 3 }); await page.mouse.up();
  await sleep(150);
}
check(await toolAlive(), "S3: the Stitcher survived the interrupted pan (toolbar intact)");

console.log("\nS4 — spamming the ± zoom buttons clamps instead of exploding:");
for (let i = 0; i < 22; i++) { await page.locator("button", { hasText: /^\+$/ }).first().click({ timeout: 5000 }).catch(() => {}); }
await sleep(150);
let z = await zoomPct();
check(z != null && z <= 800, `S4: + zoom clamped at ≤800% (got ${z}%)`);
for (let i = 0; i < 30; i++) { await page.locator("button", { hasText: /^−$/ }).first().click({ timeout: 5000 }).catch(() => {}); }
await sleep(150);
z = await zoomPct();
check(z != null && z >= 5, `S4: − zoom clamped at ≥5% (got ${z}%)`);
check((await imageRects()).length >= 1, "S4: sheets still rendered after zoom spam");

console.log("\nS5 — a RANDOM click fuzz across all tools never crashes the Stitcher:");
// Reset zoom to something workable first.
for (let i = 0; i < 6; i++) { await page.locator("button", { hasText: /^\+$/ }).first().click({ timeout: 5000 }).catch(() => {}); }
const tools = ["Pan", "Distance", "Area", "Calibrate"];
let rnd = 1234567;
const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
const sr = await svgRect();
for (let i = 0; i < 45; i++) {
  if (rand() < 0.25) await page.locator(`button:has-text("${tools[Math.floor(rand() * tools.length)]}")`).first().click({ timeout: 5000 }).catch(() => {});
  const x = sr.x + 20 + rand() * (sr.w - 40), y = sr.y + 20 + rand() * (sr.h - 40);
  await page.mouse.click(x, y).catch(() => {});
  if (rand() < 0.18) await page.keyboard.press("Escape").catch(() => {});
  if (rand() < 0.10) await page.keyboard.press("Enter").catch(() => {}); // close area
  if (i % 12 === 0) await sleep(40);
}
await sleep(250);
await page.keyboard.press("Escape").catch(() => {});
check(await toolAlive(), "S5: toolbar still present after 45 random interactions");
check((await imageRects()).length >= 1, "S5: at least one sheet still rendered after the fuzz");

check(pageErrors.length === 0, `no uncaught JS errors across the whole stress run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 5));

await page.screenshot({ path: new URL("./screens/stitch-stress.png", import.meta.url).pathname }).catch(() => {});
await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
