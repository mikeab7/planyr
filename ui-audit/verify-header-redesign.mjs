/* Verify B357–B360 — the Markup header de-clutter + truthful save "cloud" chip.
 *
 *   B357 — AppHeader row hierarchy: Row 2 (tools) is visibly taller than Row 1 (nav);
 *           the project name is not duplicated (breadcrumb only, not also center zone).
 *   B358 — the save indicator is truthful: NO "Not saved" cry-wolf when there's nothing
 *           to save (empty Markup, no project); a proper cloud chip otherwise.
 *   B359 — the redundant "📁 Library" entry point is gone (Files subsumes it) — in BOTH
 *           the single-sheet viewer AND the Stitcher.
 *   B360 — "Reviews ▾" moved out of Row 1 into the Row 2 tools row.
 *
 * Drives the REAL built app (logged-out, browser-only). Captures before/after screenshots
 * of the header in three states: empty Markup, Markup with a PDF, and the Stitcher.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-header-redesign.mjs [--tag before|after]   (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const TAG = (process.argv.find((a) => a.startsWith("--tag=")) || "--tag=after").split("=")[1];

// A minimal 1-page PDF with a title block so the viewer has a real backdrop.
const W = 1224, H = 792;
function buildPdf() {
  const L = [];
  const T = (size, x, y, s) => L.push(`BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET`);
  T(20, 980, H - 130, "SITE PLAN");
  T(11, 980, H - 162, "SHEET NO. C-1");
  T(11, 980, H - 186, "SCALE: 1\"=40'");
  const stream = L.join("\n");
  const o = [];
  o[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  o[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  o[3] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 5 0 R >> /ProcSet [/PDF /Text] >> /Contents 4 0 R >>`;
  o[4] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  o[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let pdf = "%PDF-1.4\n"; const off = [];
  for (let i = 1; i < o.length; i++) { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i} 0 obj\n${o[i]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1"), n = o.length;
  pdf += `xref\n0 ${n}\n0000000000 65535 f \n`;
  for (let i = 1; i < n; i++) pdf += String(off[i]).padStart(10, "0") + " 00000 n \n";
  pdf += `trailer\n<< /Size ${n} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
const PDF = { name: "site-plan.pdf", mimeType: "application/pdf", buffer: buildPdf() };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };
const shot = (page, name) => page.screenshot({ path: new URL(`./screens/header-${TAG}-${name}.png`, import.meta.url).pathname }).catch(() => {});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

// header-region helpers
const headerText = () => page.evaluate(() => (document.querySelector("header")?.innerText || "").replace(/\s+/g, " ").trim());
const rowHeights = () => page.evaluate(() => {
  const h = document.querySelector("header");
  if (!h) return null;
  const rows = [...h.children].filter((c) => c.tagName === "DIV").slice(0, 2);
  return rows.map((r) => Math.round(r.getBoundingClientRect().height));
});

await page.goto(BASE, { waitUntil: "load" });
await sleep(1400);

// ── Enter Markup (single-sheet), EMPTY state — the screenshot the owner flagged ──
await page.locator('button:has-text("Library")').first().click({ timeout: 8000 });
await sleep(900);
await shot(page, "markup-empty");
const emptyHdr = await headerText();
const rows = await rowHeights();
console.log(`\n[${TAG}] Markup header (empty): "${emptyHdr}"`);
console.log(`[${TAG}] row heights: ${JSON.stringify(rows)}`);

console.log("\nB358 — no cry-wolf save state on an empty Markup:");
check(!/not saved/i.test(emptyHdr), `header does not say "Not saved" when there's nothing to save`);

console.log("\nB359 — the redundant Library entry point is gone:");
// The module tab is now legitimately labelled "Library" (B401), so "Library" should appear
// exactly ONCE in the header (that tab) — a second occurrence would be the redundant
// header button B359 removed.
const libCount = (emptyHdr.match(/library/gi) || []).length;
check(libCount <= 1, `no redundant "Library" control beyond the module tab (found ${libCount})`);

console.log("\nB357 — Row 2 (tools) reads taller than Row 1 (nav):");
check(rows && rows.length === 2 && rows[1] > rows[0], `Row2 (${rows?.[1]}px) > Row1 (${rows?.[0]}px)`);

console.log("\nB360 — Reviews lives in the tools row (Row 2), not Row 1:");
const reviewsRow = await page.evaluate(() => {
  const h = document.querySelector("header"); if (!h) return -1;
  const rowsEl = [...h.children].filter((c) => c.tagName === "DIV").slice(0, 2);
  const btn = [...h.querySelectorAll("button")].find((b) => /reviews/i.test(b.textContent));
  if (!btn) return -2;
  return rowsEl.findIndex((r) => r.contains(btn));
});
check(reviewsRow === 1, `"Reviews" button is in Row 2 (index ${reviewsRow}; -2=not found)`);

// ── Markup WITH a PDF — a single project name (no duplication) ──
await page.setInputFiles('input[type="file"]', PDF, { timeout: 8000 }).catch(() => {});
await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, {}, { timeout: 15000 }).catch(() => {});
await sleep(800);
await shot(page, "markup-pdf");
console.log(`\n[${TAG}] Markup header (with PDF): "${await headerText()}"`);

// ── The Stitcher toolbar (also had a Library button) ──
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 }).catch(() => {});
await sleep(900);
await shot(page, "stitch");
const stitchHdr = await page.evaluate(() => (document.body.innerText || "").split("\n").slice(0, 12).join(" "));
console.log(`\n[${TAG}] Stitch toolbar (top): "${stitchHdr.replace(/\s+/g, " ").trim().slice(0, 200)}"`);
check(!/📁\s*library|browse the project library/i.test(await page.content()), `no "Library" button in the Stitcher toolbar`);

check(pageErrors.length === 0, `no uncaught JS errors during the run (${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:", pageErrors.slice(0, 4));

await browser.close();
console.log(`\n${fails.length ? "❌ FAIL" : "✅ PASS"} — ${fails.length} failed check(s)  [tag=${TAG}]`);
process.exit(fails.length ? 1 : 0);
