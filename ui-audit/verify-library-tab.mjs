/**
 * Verify the new Library workspace tab + the slimmed-down Review empty state.
 *
 * Logged-out checks (sign-in is blocked in the sandbox):
 *   1. The Library tab renders in the header and switching to it mounts the Library
 *      workspace at hash #/library.
 *   2. Review, opened with nothing loaded, shows the new empty state ("No drawing open"
 *      + a "Browse the Library" button) — NOT a file list.
 *   3. The empty-state "Browse the Library" button switches to the Library tab.
 *
 * Run: node ui-audit/verify-library-tab.mjs   (preview server must be running on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const OUT = new URL("./screens/library/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, label) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) failures++; };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 820 } });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  // 1. Library tab present in the header
  const libTab = page.locator('[data-testid="module-tab-library"]');
  check(await libTab.count() === 1, "Library tab renders in the header");

  // 1b. Clicking it mounts the Library workspace at #/library
  await libTab.click();
  await page.waitForTimeout(900);
  check(await page.locator('[data-testid="library-root"]').count() === 1, "Library tab mounts the Library workspace");
  check(/#\/library$/.test(await page.evaluate(() => location.hash)), `hash is #/library (got ${await page.evaluate(() => location.hash)})`);
  await page.screenshot({ path: OUT + "library.png" });

  // 2. Review shows the empty state (not a file list)
  await page.locator('[data-testid="module-tab-doc-review"]').click();
  await page.waitForTimeout(1200);
  check(await page.locator('[data-testid="doc-review-root"]').count() === 1, "Review workspace mounts");
  const emptyBtn = page.locator('[data-testid="empty-open-library"]');
  check(await emptyBtn.count() === 1, 'Review shows the empty-state "Browse the Library" button');
  const bodyText = await page.locator('[data-testid="doc-review-root"]').innerText();
  check(/No drawing open/i.test(bodyText), 'Review empty state reads "No drawing open"');
  await page.screenshot({ path: OUT + "review-empty.png" });

  // 3. The empty-state button switches to the Library tab
  await emptyBtn.click();
  await page.waitForTimeout(900);
  check(await page.locator('[data-testid="library-root"]').count() === 1, '"Browse the Library" button switches to the Library workspace');
  check(/#\/library$/.test(await page.evaluate(() => location.hash)), "hash is #/library after the empty-state jump");

  await browser.close();
  console.log(failures === 0 ? "\n✓ All Library-tab checks passed." : `\n✗ ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
