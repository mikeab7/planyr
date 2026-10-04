/**
 * Verify the new Library workspace tab + the slimmed-down Review empty state.
 *
 * Logged-out checks (sign-in is blocked in the sandbox):
 *   1. The Library tab renders in the header and switching to it mounts the Library
 *      workspace at hash #/library.
 *   2. Review, opened with nothing loaded, shows the project-aware empty state ("Pick a project" /
 *      "Current set") — NOT a file list, and no Browse-the-Library button.
 *
 * Run: node ui-audit/verify-library-tab.mjs   (preview server must be running on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

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
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-library-tab");
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
  // NEW-1: the empty state is now a project-aware sheet index — no "Browse the Library" button here.
  check(await page.locator('[data-testid="empty-open-library"]').count() === 0, "Review empty state no longer carries a Browse-the-Library button");
  const bodyText = await page.locator('[data-testid="doc-review-root"]').innerText();
  check(/Pick a project|Current set/i.test(bodyText), 'Review empty state reads "Pick a project" / "Current set"');
  await page.screenshot({ path: OUT + "review-empty.png" });

  await browser.close();
  console.log(failures === 0 ? "\n✓ All Library-tab checks passed." : `\n✗ ${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
