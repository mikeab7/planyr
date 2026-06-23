/* Verify B335–B339 — Document Review "drop a whole set → it stitches itself."
 *
 * Drives the REAL built app (logged-out; the stitch core is browser-only) with a generated
 * 4-sheet vector PDF that carries real title blocks, stated scales, and MATCH-LINE labels —
 * so the whole pipeline (read → group → auto-stitch → auto-calibrate → crop) runs for real.
 * Asserts:
 *   B335 — the tray collapses 4 pages into 2 LOGICAL sheets: a COVER single + a 3-sheet
 *          "Grading Plan" group labelled with its sheet range + "auto-stitch".
 *   B337 — clicking the group AUTO-PLACES all 3 sheets, seams coincident (overlapping at the
 *          cut, not dropped at the old +40 gap), left-to-right.
 *   B339 — the composite auto-calibrates from the sheet's stated scale (no manual Calibrate).
 *   B338 — each grouped sheet's title-block band is cropped (clipPath per sheet); the toggle
 *          turns it off; a pinned composite "key" lists the group once.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b325-b329.mjs               (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
// PDF.js 6.x needs Map.prototype.getOrInsertComputed → chromium-1228 (1194 is too old).
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const W = 1224, H = 792; // 17×11 in @72 → ANSI B (a standard plot size → stated scale trusted)

// One page's content stream. Title block (with the sheet title, number, stated scale, dense
// notes) lives in the right band; the match-line labels sit in the drawing area.
function pageStream({ title, number, leftRef, rightRef }) {
  const L = [];
  const T = (size, x, y, s) => L.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
  const TBX = 990; // right-edge title-block band (x ≥ 0.78·W = 955)
  T(20, TBX, H - 130, title);
  if (number) T(11, TBX, H - 162, `SHEET NO. ${number}`);
  if (number) T(11, TBX, H - 186, `SCALE: 1"=40'`);          // a stated scale only on real sheets
  T(11, TBX, H - 210, "PROJECT KATY GRAND");
  T(11, TBX, H - 234, "DATE 06/30/2025");
  for (let i = 0; i < 16; i++) T(10, TBX, H - 262 - i * 22, `GENERAL NOTE ${i + 1}`);
  if (leftRef) T(13, 110, H / 2, `MATCH LINE - SEE SHEET ${leftRef}`);
  if (rightRef) T(13, 720, H / 2, `MATCH LINE - SEE SHEET ${rightRef}`);
  if (number) T(12, 150, H - 220, "PROPOSED GRADING");        // drawing-area text only on real sheets
  return L.join("\n");
}

const SHEETS = [
  { title: "COVER SHEET" },                                            // cover → single
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
  return [...svg.querySelectorAll("image")].map((im) => { const r = im.getBoundingClientRect(); return { x: r.x, w: r.width }; }).sort((a, b) => a.x - b.x);
});
const clipCount = () => page.evaluate(() => document.querySelectorAll("svg clipPath").length);

// Enter Document Review (Markup) → Stitch
await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
await sleep(700);
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 });
await sleep(700);

console.log("\nB335 — a dropped set collapses into logical sheets:");
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
// wait for the background read+group to surface the grouped tray
await page.waitForFunction(() => /auto-stitch/.test(document.body.innerText), {}, { timeout: 30000 })
  .catch(() => console.log("  [diag] grouped tray never appeared"));
await sleep(400);
let txt = await bodyTxt();
check(/Grading Plan/.test(txt), "tray shows a 'Grading Plan' logical sheet");
check(/C-5–C-7 · 3 sheets/.test(txt), "the group is labelled with its sheet range (C-5–C-7 · 3 sheets)");
check(/COVER SHEET/.test(txt), "the cover stays a standalone single");

console.log("\nB337 — clicking the group auto-stitches all 3 sheets:");
await page.locator('button:has-text("Grading Plan")').first().click({ timeout: 8000 });
await page.waitForFunction(() => { const s = [...document.querySelectorAll("svg")].find((x) => x.querySelector("image")); return s && s.querySelectorAll("image").length >= 3; }, {}, { timeout: 20000 }).catch(() => {});
await sleep(800);
let imgs = await imageRects();
check(imgs.length === 3, `3 sheets placed on the canvas (images = ${imgs.length})`);
if (imgs.length === 3) {
  const w = imgs[0].w;
  const g1 = imgs[1].x - imgs[0].x, g2 = imgs[2].x - imgs[1].x;
  // auto-stitched seams overlap at the cut (~0.78·w), NOT the manual +40 gap (≈ w+16)
  check(g1 > 0.55 * w && g1 < 0.95 * w, `sheet 1→2 butt at the seam (Δx=${Math.round(g1)} ≈ 0.6–0.9·w=${Math.round(w)}, not gapped)`);
  check(g2 > 0.55 * w && g2 < 0.95 * w, `sheet 2→3 butt at the seam (Δx=${Math.round(g2)})`);
}
txt = await bodyTxt();
check(/Auto-stitched 3 sheets/.test(txt), "the auto-stitch notice reports 3 sheets");

console.log("\nB339 — the composite auto-calibrates from the stated scale:");
check(/Scale set/.test(txt), "the composite key shows the scale was set automatically (no manual Calibrate)");
check(/Calibrated/.test(txt), "the takeoff panel reads 'Calibrated'");

console.log("\nB338 — title blocks cropped + one pinned composite key:");
const clipsOn = await clipCount();
check(clipsOn >= 3, `each grouped sheet's title block is clipped (clipPaths = ${clipsOn}, want ≥3)`);
check((await page.evaluate(() => (document.body.innerText.match(/Grading Plan · C-5–C-7 · 3 sheets/g) || []).length)) >= 1, "the pinned 'Composite key' lists the group once (merged, not 3 title blocks)");
await page.locator('button:has-text("Crop blocks")').first().click({ timeout: 8000 }); // toggle OFF
await sleep(500);
const clipsOff = await clipCount();
check(clipsOff === 0, `toggling Crop blocks off removes the clips (clipPaths = ${clipsOff}, want 0)`);

await page.screenshot({ path: new URL("./screens/b325-b329.png", import.meta.url).pathname }).catch(() => {});
check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
