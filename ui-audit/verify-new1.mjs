/* NEW-1 verification — opening a file from the global Project Files panel must reach
 * Document Review across the lazy mount (dev tool, not part of the build).
 *
 * The signed-in click-through (global Files → click file → DR opens it on the FIRST click,
 * breadcrumb carries the project) is checked live on planyr.io — the sandbox proxy blocks
 * sign-in and this build has no Supabase creds, so the panel can't list real files here.
 *
 * What this logged-out smoke DOES gate (the runtime risk in the patch): DocReview mounts
 * cleanly with the new `docIntent` prop + bootDocIntentRef capture + intent-consuming
 * effect, across a fresh mount AND an unmount/remount (the module-scoped token guard), with
 * ZERO JS errors. A crash in any of that new mount-path code would fail here.
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       PW_CHROME=/opt/pw-browsers/chromium-1194/chrome-linux/chrome node ui-audit/verify-new1.mjs
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

// 1) First mount of Document Review (docIntent = null path): the bootDocIntentRef capture,
//    the null-intent markupProject seed, the intent effect's early-return, and the
//    resume-last boot all run here.
await page.locator('button:has-text("Library")').first().click();
await page.waitForTimeout(1500);
r.docReviewMounted = await page.getByText("Document Review", { exact: true }).count();
r.placeholder = await page.getByText("Open or drop a construction PDF to review.").count();
r.filesBtn = await page.locator('[title^="Project Files"]').count();
await page.screenshot({ path: OUT + "new1-docreview-mount.png" });

// 2) Open the global Files panel from the Site side — confirms SitePlanner still wires the
//    drawer (now via onOpenReviewInDocReview) and renders with no errors. Logged-out it
//    shows the "Sign in…" state; we only assert it opens cleanly.
await page.locator('button:has-text("Site")').first().click();
await page.waitForTimeout(1200);
r.siteFilesBtn = await page.locator('[title^="Project Files"]').count();
if (r.siteFilesBtn) { await page.locator('[title^="Project Files"]').first().click(); await page.waitForTimeout(600); }
r.siteDrawerHeader = await page.getByText("Project Files", { exact: true }).count();
await page.screenshot({ path: OUT + "new1-site-files.png" });
await page.keyboard.press("Escape").catch(() => {});

// 3) Switch back into Markup (unmount → remount). The module-scoped lastConsumedDocToken
//    must not re-fire anything; DR must mount cleanly again.
await page.locator('button:has-text("Library")').first().click();
await page.waitForTimeout(1200);
r.docReviewRemounted = await page.getByText("Document Review", { exact: true }).count();

r.pageErrors = errors;
console.log(JSON.stringify(r, null, 2));
await browser.close();

const ok = r.docReviewMounted >= 1 && r.placeholder >= 1 && r.docReviewRemounted >= 1 && errors.length === 0;
console.log(ok ? "\nPASS — DR mounts/remounts cleanly with the new intent plumbing, no JS errors." : "\nFAIL — see results.");
process.exit(ok ? 0 : 1);
