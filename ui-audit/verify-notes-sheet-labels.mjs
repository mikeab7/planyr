/* Verify B374 + B375 — sheet labelling on TEXT-DENSE (general-notes / specs) sheets.
 *
 * The "atrocious labels" report: a structural general-notes set showed body boilerplate AS the
 * label ("…reproduced or used without…", "CJ DENOTES…"), the same cross-referenced sheet number on
 * several rows ("Structural · S202" ×4), and a false auto-calibrate dot ("·≈") on pure-text sheets.
 *
 * This drives the REAL built app (logged-out, browser-only) with a set that reproduces the failure:
 *   • a COVER (single)
 *   • a GENERAL NOTES sheet (S-001): dense prose body, a body cross-reference to DWG S202, a
 *     copyright boilerplate line, and a STRAY "1\"=20'" scale string — but NO plan scale.
 *   • a GRADING PLAN run (C-5/C-6) with a real stated scale.
 * and asserts the Markup sidebar:
 *   B374 — the notes sheet reads its OWN number (S-001) + real title ("GENERAL NOTES"), never the
 *          body cross-reference S202 and never a boilerplate/legend line; no generic "Sheet N".
 *   B375 — the notes sheet does NOT auto-calibrate (no "·≈"); a real plan sheet still DOES.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-notes-sheet-labels.mjs            (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const W = 1224, H = 792; // 17×11 in @72 → ANSI B (a standard plot size → a stated scale is trusted)
function pageStream(sp) {
  const L = [];
  const T = (size, x, y, s) => L.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
  const TBX = 990; // right-edge title-block strip (x ≥ 0.78·W = 955)
  T(20, TBX, H - 130, sp.title);
  if (sp.number) T(11, TBX, H - 162, `SHEET NO. ${sp.number}`);
  if (sp.scale) T(11, TBX, H - 186, `SCALE: ${sp.scale}`);
  T(10, TBX, H - 210, "PROJECT KATY GRAND");
  if (sp.notes) {
    // copyright boilerplate in the strip — the line the OLD scorer picked AS the title
    T(7, TBX, 60, "THIS DRAWING IS THE PROPERTY OF ACME ENGINEERS AND MAY NOT BE REPRODUCED WITHOUT WRITTEN PERMISSION");
    // dense prose notes fill the drawing body (left of the strip): no plan, just text
    for (let i = 0; i < 16; i++) T(10, 90, H - 120 - i * 30, `${i + 1}. ALL WORK SHALL CONFORM TO THE GOVERNING SPECIFICATIONS AND APPLICABLE CODES`);
    // a body CROSS-REFERENCE (the wrong number the whole-page read used to grab) + a STRAY scale
    T(10, 90, H - 120 - 16 * 30, "SEE DRAWING S202 FOR TYPICAL FOUNDATION DETAILS");
    T(10, 90, H - 120 - 17 * 30, "GRADE ALL AREAS TO DRAIN AT SCALE 1\"=20' UNLESS OTHERWISE NOTED");
  } else {
    for (let i = 0; i < 8; i++) T(10, TBX, H - 262 - i * 22, `GENERAL NOTE ${i + 1}`);
  }
  if (sp.leftRef) T(13, 110, H / 2, `MATCH LINE - SEE SHEET ${sp.leftRef}`);
  if (sp.rightRef) T(13, 720, H / 2, `MATCH LINE - SEE SHEET ${sp.rightRef}`);
  if (sp.number && !sp.notes) T(12, 150, H - 220, "PROPOSED GRADING");
  return L.join("\n");
}
const SHEETS = [
  { title: "COVER SHEET" },
  { title: "GENERAL NOTES", number: "S-001", notes: true },
  { title: "GRADING PLAN", number: "C-5", scale: "1\"=40'", rightRef: "C-6" },
  { title: "GRADING PLAN", number: "C-6", scale: "1\"=40'", leftRef: "C-5" },
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
const PDF = { name: "structural-notes.pdf", mimeType: "application/pdf", buffer: buildPdf() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const allRows = () => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="sheet-entry"], [data-testid="sheet-group"]')].map((b) => b.textContent.trim()));

await page.goto(BASE, { waitUntil: "load" });
await sleep(1200);
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 });
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, {}, { timeout: 15000 });
await page.waitForFunction(() => document.querySelectorAll('[data-testid="sheet-group"]').length >= 1, {}, { timeout: 15000 })
  .catch(() => console.log("  [diag] grouped sidebar never appeared"));
// expand any groups so every member row is in the DOM
for (const g of await page.locator('[data-testid="sheet-group"]').all()) await g.click().catch(() => {});
await sleep(500);

const rows = await allRows();
console.log("\nsidebar rows:", JSON.stringify(rows));

console.log("\nB374 — the notes sheet reads its OWN number + real title (not a cross-ref / body line):");
check(rows.some((t) => /GENERAL NOTES/i.test(t) && /S-?001/i.test(t)), "notes sheet labelled 'GENERAL NOTES · S-001'");
check(!rows.some((t) => /S202/i.test(t)), "no row shows the body cross-reference S202");
check(!rows.some((t) => /property of|reproduced|denotes/i.test(t)), "no row shows a copyright/legend body line");
check(!rows.some((t) => /^Sheet \d/.test(t)), "no generic 'Sheet N' labels");

console.log("\nB375 — auto-calibration fires on a plan sheet but NOT on the notes sheet:");
const notesRow = rows.find((t) => /GENERAL NOTES/i.test(t)) || "";
check(!/≈/.test(notesRow), `notes sheet is NOT auto-calibrated (no '·≈'): "${notesRow}"`);
check(rows.some((t) => /Grading Plan\s*·\s*C-5–C-6/.test(t)), `grading run grouped: "${rows.find((t) => /Grading/.test(t)) || "(none)"}"`);
check(rows.some((t) => /^C-5.*≈/.test(t)), `a real plan sheet still auto-calibrates (·≈): "${rows.find((t) => t.startsWith("C-5")) || "(none)"}"`);

await page.screenshot({ path: new URL("./screens/notes-sheet-labels.png", import.meta.url).pathname }).catch(() => {});
check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)`);
process.exit(fails.length ? 1 : 0);
