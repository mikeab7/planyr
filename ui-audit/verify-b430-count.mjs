/**
 * Headless verification for B430 — Count measure in Site Planner.
 *
 * What we can test logged-out (no PDF needed for Site Planner):
 *  1. App loads without JS crash
 *  2. Site Planner loads (not the doc-review tab)
 *  3. "Measure" tool rail button is present
 *  4. Clicking the Measure ▾ dropdown reveals all 4 modes incl. "Count"
 *  5. Selecting Count updates the sub-label under the Measure button
 *  6. With Count armed, clicking the canvas 3x produces 3 draft circles
 *     (we check for circle SVG elements with the numbered text 1/2/3)
 *  7. Enter commits the count (draft circles replaced by committed markers)
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";
import path from "path";

const EXEC = "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const BASE = "http://localhost:4173";

let passed = 0, failed = 0;
const ok  = (msg) => { console.log(`  ✓ ${msg}`); passed++; };
const fail = (msg) => { console.error(`  ✗ ${msg}`); failed++; };

async function run() {
  const browser = await chromium.launch({
    executablePath: EXEC,
    args: ["--no-sandbox", "--ignore-certificate-errors"],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  // 1. Load app
  console.log("→ Loading Site Planner...");
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Click Site Planner tab to make sure we're there
  const spTab = page.locator('[data-testid="module-tab-site-planner"]');
  if (await spTab.count()) { await spTab.click(); await page.waitForTimeout(800); ok("Site Planner tab clicked"); }
  else fail("Site Planner tab not found");

  // Open a blank site so the tool rail appears
  const startBlank = page.locator('button:has-text("Start blank")');
  if (await startBlank.count()) { await startBlank.click(); await page.waitForTimeout(1200); ok("Opened blank site"); }
  else fail("Start blank button not found");

  // 2. No JS crashes so far
  if (errors.length === 0) ok("No JS crashes on load");
  else fail(`JS crashes: ${errors.join("; ")}`);

  // 3. Measure button — innerText is "Measure\nLength" (label + sublabel, newline between)
  const measureBtn = page.locator('button').filter({ hasText: /Measure/ }).first();
  if (await measureBtn.count()) ok("Measure button in tool rail");
  else { fail("Measure button not found"); await browser.close(); return summarize(); }

  // 4. Open Measure dropdown via the ▾ arrow button next to Measure
  const chevron = page.locator('button[aria-label="Measure modes"]');
  if (await chevron.count()) {
    await chevron.click();
    await page.waitForTimeout(300);
    ok("Opened Measure ▾ dropdown");

    // 5. Check all 4 modes present
    for (const label of ["Length", "Polylength", "Area", "Count"]) {
      const item = page.locator(`button:has-text("${label}")`).first();
      if (await item.count()) ok(`Mode "${label}" in dropdown`);
      else fail(`Mode "${label}" missing from dropdown`);
    }

    // 6. Click Count — use visible:true to skip hidden AnchoredMenu buttons
    await page.locator('button').filter({ hasText: /^Count$/, visible: true }).first().click();
    await page.waitForTimeout(300);
    ok("Count selected from dropdown");

    // 7. Verify sub-label under Measure button now shows "Count"
    const subLabel = page.locator('span:has-text("Count")');
    if (await subLabel.count()) ok("Measure button sub-label shows 'Count'");
    else fail("Measure button sub-label did not update to 'Count'");
  } else {
    fail("Measure ▾ button not found");
  }

  // 8. Click Measure button to arm the tool
  await measureBtn.click();
  await page.waitForTimeout(300);

  // 9. Click the canvas 3 times to place count markers (largest SVG = the planner canvas)
  const svgs = await page.locator("svg").all();
  let canvasSvg = null;
  for (const s of svgs) { const b = await s.boundingBox(); if (b && b.width > 200) { canvasSvg = s; break; } }
  const svg = canvasSvg || page.locator("svg").first();
  if (await svg.count()) {
    const box = await svg.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx - 60, cy - 40);
      await page.waitForTimeout(150);
      await page.mouse.click(cx + 30, cy - 10);
      await page.waitForTimeout(150);
      await page.mouse.click(cx - 20, cy + 50);
      await page.waitForTimeout(150);
      ok("Clicked canvas 3x for count markers");

      // 10. Check draft: numbered text "1", "2", "3" should appear in SVG
      const draftText = await page.locator("svg text").allTextContents();
      const nums = ["1", "2", "3"].filter((n) => draftText.some((t) => t.trim() === n));
      if (nums.length === 3) ok("Draft markers 1/2/3 visible in SVG");
      else fail(`Only found numbered draft markers: ${nums.join(",") || "(none)"} (got texts: ${draftText.slice(0,15).join("|")})`);

      // 11. Press Enter to commit
      await page.keyboard.press("Enter");
      await page.waitForTimeout(300);
      ok("Enter pressed to commit count");

      // 12. After commit, "3 items" label should appear
      const allText = await page.locator("svg text").allTextContents();
      const hasItemsLabel = allText.some((t) => t.includes("item"));
      if (hasItemsLabel) ok('"N items" label visible after commit');
      else fail(`"N items" label not found after commit (texts: ${allText.slice(0,20).join("|")})`);
    } else {
      fail("Could not get SVG bounding box");
    }
  } else {
    fail("SVG canvas not found");
  }

  // Final crash check
  if (errors.length > 0) fail(`Late JS crash: ${errors.join("; ")}`);

  await page.screenshot({ path: "ui-audit/screenshots/b430-count-verify.png", fullPage: false });
  console.log("  screenshot: ui-audit/screenshots/b430-count-verify.png");

  await browser.close();
  summarize();
}

function summarize() {
  console.log(`\n${passed + failed} checks — ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((e) => { console.error(e); process.exit(1); });
