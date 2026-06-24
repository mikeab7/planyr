import { chromium } from "playwright";
const EXEC = "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const BASE = "http://localhost:4173";
let pass = 0, fail = 0;
const ok = (m) => { console.log(`  ✓ ${m}`); pass++; };
const bad = (m) => { console.error(`  ✗ ${m}`); fail++; };
async function run() {
  const br = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await br.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Switch to Review tab
  const tab = page.locator('[data-testid="module-tab-doc-review"]');
  if (await tab.count()) { await tab.click(); await page.waitForTimeout(1200); ok("Review tab clicked"); }
  else bad("Review tab not found");

  if (errors.length === 0) ok("No JS crash on load");
  else bad(`JS crash: ${errors.join("; ")}`);

  // Check all 6 new tool buttons are in the rail
  for (const label of ["Arc", "Dimension", "Pen", "Highlight", "Eraser", "Snapshot"]) {
    const btn = page.locator(`button`).filter({ hasText: new RegExp(`^${label}$`) }).first();
    if (await btn.count()) ok(`Tool button "${label}" in rail`);
    else bad(`Tool button "${label}" missing from rail`);
  }

  // Also check previously-existing tools still there
  for (const label of ["Line", "Polygon", "Cloud", "Text"]) {
    const btn = page.locator(`button`).filter({ hasText: new RegExp(`^${label}$`) }).first();
    if (await btn.count()) ok(`Existing tool "${label}" still present`);
    else bad(`Existing tool "${label}" regressed`);
  }

  await page.screenshot({ path: "ui-audit/screenshots/b429-tools.png" });
  console.log("  screenshot: ui-audit/screenshots/b429-tools.png");

  await br.close();
  console.log(`\n${pass + fail} checks — ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
run().catch((e) => { console.error(e); process.exit(1); });
