/* Verify B266 + B343 — the single-sheet "Markup" sidebar now shows REAL sheet labels (sheet # +
 * title, not "Sheet N") and collapses the set into the SAME logical sheets the Stitcher uses
 * (reusing #242's shared sheetMeta/sheetGroups engines). #242 (PR #242) delivered grouping/
 * auto-stitch in the STITCHER but left the Markup single-sheet sidebar as a flat "Sheet N" list —
 * B266 (open) was never delivered there. This drives the REAL built app (logged-out; browser-only)
 * with a generated 4-sheet titled set and asserts the Markup sidebar:
 *   B266 — the cover shows its real title ("COVER SHEET"), not "Sheet 1"; no generic "Sheet N".
 *   B343 — 4 pages collapse to 2 logical entries; a "Grading Plan · C-5–C-7 · 3 sheets" group that
 *          expands to its member sheets (C-5/C-6/C-7); auto-calibrate dot (·≈) on the grading sheets.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-markup-sheet-labels.mjs           (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const W = 1224, H = 792; // 17×11 in @72 → ANSI B (a standard plot size → stated scale trusted)
function pageStream({ title, number, leftRef, rightRef }) {
  const L = [];
  const T = (size, x, y, s) => L.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
  const TBX = 990; // right-edge title-block band (x ≥ 0.78·W)
  T(20, TBX, H - 130, title);
  if (number) { T(11, TBX, H - 162, `SHEET NO. ${number}`); T(11, TBX, H - 186, `SCALE: 1"=40'`); }
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
    const pnum = 3 + 2 * i, cnum = 4 + 2 * i, stream = pageStream(sp);
    o[pnum] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${fontNum} 0 R >> /ProcSet [/PDF /Text] >> /Contents ${cnum} 0 R >>`;
    o[cnum] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });
  o[fontNum] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n"; const off = [];
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
const groupTexts = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="sheet-group"]')].map((b) => b.textContent.trim()));
const entryTexts = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="sheet-entry"]')].map((b) => b.textContent.trim()));

await page.goto(BASE, { waitUntil: "load" });
await sleep(1200);
// Enter Document Review (Markup) — and STAY in the single-sheet viewer (don't go to Stitch).
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, {}, { timeout: 15000 });
// the background read collapses the flat list into groups
await page.waitForFunction(() => document.querySelectorAll('[data-testid="sheet-group"]').length >= 1, {}, { timeout: 15000 })
  .catch(() => console.log("  [diag] grouped sidebar never appeared"));
await sleep(400);

console.log("\nB343 — the Markup sidebar collapses the set into logical sheets:");
const countTxt = await page.locator('[data-testid="sheet-count"]').first().textContent();
check(/2\s*sheets\s*·\s*4\s*pages/i.test(countTxt), `sidebar header reads "${(countTxt || "").trim()}" (2 logical · 4 pages)`);
const groups = await groupTexts();
check(groups.some((t) => /Grading Plan\s*·\s*C-5–C-7\s*·\s*3 sheets/.test(t)), `grading group labelled: "${groups.find((t) => /Grading/.test(t)) || "(none)"}"`);

console.log("\nB266 — real sheet labels, not 'Sheet N':");
const singles = await entryTexts();
check(singles.some((t) => /COVER SHEET/i.test(t)), `cover shows its real title: ${JSON.stringify(singles)}`);
check(!singles.some((t) => /^Sheet \d/.test(t)) && !groups.some((t) => /Sheet \d/.test(t)), "no generic 'Sheet N' labels remain");

console.log("\nB343 — the group expands to its member sheets + auto-calibrate dot:");
await page.locator('[data-testid="sheet-group"]', { hasText: "Grading Plan" }).first().click();
await sleep(400);
const expanded = await entryTexts();
const members = ["C-5", "C-6", "C-7"].filter((n) => expanded.some((t) => t.startsWith(n)));
check(members.length === 3, `group expands to its 3 member sheets: ${members.join(", ")}`);
check(expanded.some((t) => /^C-5.*≈/.test(t)), `grading sheets auto-calibrated (·≈): "${expanded.find((t) => t.startsWith("C-5")) || "(none)"}"`);

await page.screenshot({ path: new URL("./screens/markup-sheet-labels.png", import.meta.url).pathname }).catch(() => {});
check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
