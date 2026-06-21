/* Verify B350 — Document Review stitcher: aggregated notes/legend + Bluebeam-style detail cloud.
 *
 * Drives the REAL built app (logged-out; the stitch core is browser-only) with a generated set
 * that carries: a 3-sheet Grading group (C-5..C-7) whose GENERAL NOTES vary by page (a C-5-only
 * note), a stacked DETAIL callout bubble "5 / A-3" on C-5, and a separate A-3 details sheet that
 * defines "DETAIL 5". Asserts:
 *   Notes — the pinned composite key shows "Notes & legend · 3" (3 distinct notes, deduped), and
 *           expanding it surfaces the C-5-only note flagged with its sheet.
 *   Detail — clicking the "5" callout hotspot pulls up a "☁ Detail 5 · Sheet A-3" cloud popup that
 *           renders the referenced A-3 sheet — without leaving the current drawing.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b350.mjs                    (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const W = 1224, H = 792; // 17×11 in @72 → ANSI B (a standard plot size → stated scale trusted)

function pageStream({ title, number, leftRef, rightRef, notes, bubble, anchorDetail }) {
  const L = [];
  const T = (size, x, y, s) => L.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
  const TBX = 990; // right-edge title-block band (x ≥ 0.78·W = 955)
  T(20, TBX, H - 120, title);
  if (number) { T(11, TBX, H - 150, `SHEET NO. ${number}`); T(11, TBX, H - 172, `SCALE: 1"=40'`); }
  T(11, TBX, H - 194, "PROJECT KATY GRAND");
  T(11, TBX, H - 216, "DATE 06/30/2025");
  // GENERAL NOTES heading + a numbered body column (this is what aggregateNotes collects).
  if (notes && notes.length) {
    T(11, TBX, H - 250, "GENERAL NOTES");
    notes.forEach((n, i) => T(10, TBX, H - 272 - i * 18, n));
  }
  // drawing-area furniture
  if (number) T(12, 150, H - 220, "PROPOSED GRADING");
  if (leftRef) T(13, 110, H / 2, `MATCH LINE - SEE SHEET ${leftRef}`);
  if (rightRef) T(13, 720, H / 2, `MATCH LINE - SEE SHEET ${rightRef}`);
  // a STACKED detail callout bubble ("5" over "A-3") in the drawing area
  if (bubble) { T(13, 306, H / 2 - 120, bubble.detail); T(13, 296, H / 2 - 138, bubble.sheet); }
  // a detail DEFINITION ("DETAIL 5") on the referenced sheet, so the cloud can center on it
  if (anchorDetail) { T(14, 200, H / 2, `DETAIL ${anchorDetail}`); T(10, 200, H / 2 - 22, 'SCALE: 1"=1\'-0"'); }
  return L.join("\n");
}

const NOTES_COMMON = ["1. ALL WORK PER CITY STD", "2. VERIFY ALL UTILITIES"];
const SHEETS = [
  { title: "GRADING PLAN", number: "C-5", rightRef: "C-6", notes: [...NOTES_COMMON, "3. SEE STRUCTURAL FOR LOADS"], bubble: { detail: "5", sheet: "A-3" } },
  { title: "GRADING PLAN", number: "C-6", leftRef: "C-5", rightRef: "C-7", notes: NOTES_COMMON },
  { title: "GRADING PLAN", number: "C-7", leftRef: "C-6", notes: NOTES_COMMON },
  { title: "DETAILS", number: "A-3", anchorDetail: "5" },
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

// Enter Document Review (Markup) → Stitch
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
await sleep(700);

console.log("\nSetup — drop the set and auto-stitch the Grading group:");
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 }).catch(() => {});
await sleep(400);
await page.locator('button:has-text("Grading Plan")').first().click({ timeout: 8000 });
await page.waitForFunction(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")); return s && s.querySelectorAll("image").length >= 3; }, {}, { timeout: 20000 }).catch(() => {});
await sleep(800);

console.log("\nNotes — every sheet's notes aggregated in the composite key, variations flagged:");
let txt = await bodyTxt();
check(/Notes & legend · 3/i.test(txt), "the key shows 3 distinct notes (the two common + the C-5-only one, deduped)");
// expand the notes
await page.locator('button:has-text("Notes & legend")').first().click({ timeout: 8000 }).catch(() => {});
await sleep(300);
txt = await bodyTxt();
check(/ALL WORK PER CITY STD/.test(txt), "a common note is shown");
check(/SEE STRUCTURAL FOR LOADS/.test(txt), "the C-5-only note is shown (not lost behind the crop)");
// the C-5-only note carries a sheet tag (it didn't appear on every sheet)
const flagged = await page.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => /SEE STRUCTURAL FOR LOADS/.test(d.textContent) && d.textContent.length < 80);
  return el ? /C-5/.test(el.textContent) : false;
});
check(flagged, "the C-5-only note is flagged with its sheet (·C-5) so a per-page change is obvious");

console.log("\nDetail cloud — click the '5 / A-3' callout → that detail pops up:");
const hotspots = await page.evaluate(() => [...document.querySelectorAll("svg circle")].filter((c) => c.getAttribute("stroke") === "#1d4ed8").length);
check(hotspots >= 1, `a clickable detail hotspot renders on the sheet (found ${hotspots})`);
// collapse the key so it can't sit over the hotspot, then click the bubble
await page.locator('button[title="Hide"]').first().click({ timeout: 5000 }).catch(() => {});
await sleep(300);
const box = await page.evaluate(() => {
  const c = [...document.querySelectorAll("svg circle")].find((c) => c.getAttribute("stroke") === "#1d4ed8");
  if (!c) return null; const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
check(!!box, "the hotspot has an on-screen position to click");
if (box) { await page.mouse.click(box.x, box.y); await sleep(1200); }
txt = await bodyTxt();
check(/Detail 5 · Sheet A-3/.test(txt), "the detail cloud opens titled 'Detail 5 · Sheet A-3'");
const popImg = await page.evaluate(() => {
  const pop = [...document.querySelectorAll("div")].find((d) => /Detail 5 · Sheet A-3/.test(d.textContent));
  return pop ? pop.querySelectorAll("img").length : 0;
});
check(popImg >= 1, `the cloud renders the referenced A-3 sheet image (imgs in popup = ${popImg})`);

await page.screenshot({ path: new URL("./screens/b350.png", import.meta.url).pathname }).catch(() => {});
check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
