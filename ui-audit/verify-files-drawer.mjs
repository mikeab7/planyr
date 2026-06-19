/* B180 verification — the app-wide Project Files drawer (dev tool, not part of the build).
 * Logged-out smoke test (the sandbox proxy blocks sign-in): confirm the Row-1 "Files"
 * button is present in BOTH the Site Planner and the Markup workspace, that clicking it
 * opens the "Project Files" drawer (signed-out prompt), and that nothing throws.
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       node ui-audit/verify-files-drawer.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

const results = {};
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);

// 1) Site Planner (map mode): Files button in Row 1
results.sitePlannerFilesBtn = await page.locator('[title^="Project Files"]').count();
await page.locator('[title^="Project Files"]').first().click();
await page.waitForTimeout(700);
results.drawerHeader = await page.getByText("Project Files", { exact: true }).count();
results.signInPrompt = await page.getByText(/Sign in .* to browse your project files/i).count();
await page.screenshot({ path: OUT + "files-drawer-siteplanner.png" });
await page.locator('button[title="Close"]').first().click().catch(() => {});
await page.waitForTimeout(400);

// 2) Markup (doc-review) workspace: Files button in Row 1 too
await page.locator('button:has-text("Markup")').first().click();
await page.waitForTimeout(1500);
results.docReviewFilesBtn = await page.locator('[title^="Project Files"]').count();
await page.locator('[title^="Project Files"]').first().click();
await page.waitForTimeout(700);
results.drawerHeaderDR = await page.getByText("Project Files", { exact: true }).count();
await page.screenshot({ path: OUT + "files-drawer-docreview.png" });

results.pageErrors = errors;
console.log(JSON.stringify(results, null, 2));
await browser.close();

const ok = results.sitePlannerFilesBtn >= 1 && results.drawerHeader >= 1 && results.signInPrompt >= 1
  && results.docReviewFilesBtn >= 1 && results.drawerHeaderDR >= 1 && errors.length === 0;
console.log(ok ? "\nPASS — Files drawer opens app-wide, no errors." : "\nFAIL — see results above.");
process.exit(ok ? 0 : 1);
