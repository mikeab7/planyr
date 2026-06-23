/* B189 verification — the Project Files drawer still opens cleanly after adding the
 * one-click re-file confirm (dev tool, not part of the build). Logged-out smoke (the
 * sandbox proxy blocks sign-in, so the signed-in re-file round-trip is checked live):
 * open the drawer from the Markup workspace's Row-1 "Files" button and confirm it renders
 * with zero JS errors — i.e. the new RefileRow + refileReview import load fine.
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node ui-audit/verify-files-refile.mjs
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

const r = {};
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator('button:has-text("Library")').first().click();
await page.waitForTimeout(1500);
r.filesBtn = await page.locator('[title^="Project Files"]').count();
await page.locator('[title^="Project Files"]').first().click();
await page.waitForTimeout(700);
r.drawerHeader = await page.getByText("Project Files", { exact: true }).count();
await page.screenshot({ path: OUT + "files-refile.png" });
r.pageErrors = errors;
console.log(JSON.stringify(r, null, 2));
await browser.close();

const ok = r.filesBtn >= 1 && r.drawerHeader >= 1 && errors.length === 0;
console.log(ok ? "\nPASS — drawer opens, no errors (re-file control loads)." : "\nFAIL — see results.");
process.exit(ok ? 0 : 1);
