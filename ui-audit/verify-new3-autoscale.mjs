/* Verify B267 — Document Review auto-calibrates each sheet from its stated scale.
 *
 * Drives the REAL built viewer: opens the owner's actual sample sets, waits for the
 * background stated-scale scan, and asserts:
 *   • KG B1 ARCH (architectural) — most sheets auto-calibrate (sidebar "·≈"), an
 *     auto page's badge reads "scale from sheet … · verify", and a no-scale cover
 *     sheet stays "not calibrated".
 *   • Jacintoport FS — sheets are flagged "NOT TO SCALE" (stay uncalibrated).
 *
 * Sample PDFs come from branch mikeab7-patch-1 (extracted to /tmp/samples).
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-new3-autoscale.mjs          (another)
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const KG = "/tmp/samples/KG-B1-ARCH.pdf";
const JAC = "/tmp/samples/Jacintoport-FireSprinkler.pdf";
for (const f of [KG, JAC]) if (!existsSync(f)) { console.error("missing sample:", f); process.exit(2); }

async function openInMarkup(page, file) {
  await page.setInputFiles('input[type="file"]', file, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0; }, { timeout: 20000 });
}
const sheetBtns = (page) => page.locator('button:has-text("Sheet ")');
const badgeText = (page) => page.locator("text=/Sheet \\d+ (—|not calibrated|calibrated)/").first().innerText();

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await page.waitForTimeout(700);

// --- KG B1 (architectural) ---
await openInMarkup(page, KG);
// wait for the background scan to mark auto-calibrated sheets ("·≈")
await page.waitForFunction(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("≈")).length >= 5, { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(800);
const autoCount = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /Sheet \d+ ·≈/.test(b.textContent)).length);
const page1Badge = await badgeText(page);                          // page 1 = no-scale cover sheet
// click an auto-calibrated sheet (sheet 5 = 1/16"=1'-0") and read its badge
await page.locator('button:has-text("Sheet 5")').first().click({ timeout: 8000 });
await page.waitForTimeout(500);
const autoBadge = await badgeText(page);

// --- Jacintoport (NOT TO SCALE set) ---
await page.locator('button:has-text("Open another")').first().click({ timeout: 8000 }).catch(() => {});
await openInMarkup(page, JAC);
await page.waitForFunction(() => /NOT TO SCALE/.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(800);
const jacBadge = await badgeText(page);
const jacAuto = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => /Sheet \d+ ·≈/.test(b.textContent)).length);
await page.screenshot({ path: new URL("./screens/new3-autoscale.png", import.meta.url).pathname });
await browser.close();

console.log("KG B1: auto-calibrated sheets (·≈) =", autoCount);
console.log("KG B1 page-1 badge :", JSON.stringify(page1Badge));
console.log("KG B1 page-5 badge :", JSON.stringify(autoBadge));
console.log("Jacintoport badge  :", JSON.stringify(jacBadge), "· stale ·≈ markers =", jacAuto);

const pass =
  autoCount >= 12 &&                               // most of KG B1's 19 sheets auto-calibrate
  /not calibrated/i.test(page1Badge) &&            // the no-scale cover sheet stays uncalibrated
  /scale from sheet/i.test(autoBadge) &&           // an auto sheet is labelled "from sheet … verify"
  /verify/i.test(autoBadge) &&
  /NOT TO SCALE/i.test(jacBadge) &&                // the NTS set is flagged, not calibrated
  jacAuto === 0;                                   // and NO calibrations bled across from the prior file
console.log(pass ? "\nPASS ✅ — stated-scale auto-calibration works on the real sets"
                 : "\nFAIL ❌ — see values above");
process.exit(pass ? 0 : 1);
