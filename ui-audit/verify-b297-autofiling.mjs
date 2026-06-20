/* B297 verification — the Project Files drawer still opens cleanly after wiring the
 * auto-filing index provider (autofilingProvider) + the file-facts merge into the drawer.
 * Dev tool, not part of the build. Logged-out smoke (the sandbox proxy blocks sign-in, so the
 * signed-in drop→read→file round-trip is a separate live/CI-secret check):
 *   - the Markup workspace's Row-1 "Files" button still opens the drawer (the new
 *     autofiling.js + fileIndex.js imports evaluate in a real browser → lazy chunk OK);
 *   - ZERO JS errors;
 *   - auto-filing is OFF by default (VITE_AUTOFILE_ENABLED unset), so the drop zone shows the
 *     "arrives with the filing backend" caption — i.e. NO behavior change vs. before (the new
 *     path is dormant until the backend is provisioned, exactly like APS/Drive).
 *
 * Run:  npm run build && npx vite preview --host --port 4173   (then, in another shell)
 *       node ui-audit/verify-b297-autofiling.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { mkdirSync } from "node:fs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

const r = {};
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.locator('button:has-text("Markup")').first().click();
await page.waitForTimeout(1800);
r.filesBtn = await page.locator('[title^="Project Files"]').count();
await page.locator('[title^="Project Files"]').first().click();
await page.waitForTimeout(900);
r.drawerHeader = await page.getByText("Project Files", { exact: true }).count();
// Default (backend dormant): the drop-zone caption mentions the backend arriving; it must NOT
// claim the live "reads the title block and files itself" behavior.
r.backendOffCaption = await page.getByText(/arrives with the filing backend/i).count();
r.backendOnCaption = await page.getByText(/reads the title block and files itself/i).count();
await page.screenshot({ path: OUT + "b270-autofiling.png" });
r.pageErrors = errors;
console.log(JSON.stringify(r, null, 2));
await browser.close();

const ok = r.filesBtn >= 1 && r.drawerHeader >= 1 && r.backendOnCaption === 0 && errors.length === 0;
console.log(ok ? "\nPASS — drawer opens, no errors, auto-filing dormant by default (no regression)." : "\nFAIL — see results.");
process.exit(ok ? 0 : 1);
