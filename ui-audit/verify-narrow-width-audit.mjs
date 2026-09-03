/* verify-narrow-width-audit.mjs — the RED-PROOF for NEW-2's phone-width structural gate
 * (`ui-audit/lib/narrowWidthAudit.mjs`), driven against the actual reported defect.
 *
 * WHY THIS EXISTS. `visual-regression.mjs`'s own new phone-viewport pass runs this gate against
 * the 4 committed SURFACES — none of which render the update banner (it only appears on a
 * build-skew/route-miss/chunk-stuck event). This script is the targeted proof that the GATE
 * ITSELF catches the exact defect it was built for: the owner's reported update banner
 * ("A newer version of Planyr is available…"), squeezed to a one-or-two-word-per-line column on
 * his iPhone at planyr.io, 2026-09-03. Per this repo's own MANDATORY RED-PROOF convention
 * (`notification-position-audit.mjs`'s header), a guard is only real once it has been SEEN to
 * fail on the exact defect it exists to catch.
 *
 * MUTATION PROOF (run 2026-09-03, both outputs recorded on the item this shipped under):
 *   1. `git show HEAD~1:src/app/Shell.jsx > src/app/Shell.jsx` (the pre-fix UpdateBanner —
 *      single unshrinking flex row) → rebuild → run this script → **FAILS**, naming the squeezed
 *      `<span>` and its ~57px measured width (well under the 120px floor).
 *   2. Restore the fixed `src/app/Shell.jsx` → rebuild → run this script → **PASSES**.
 * See narrowWidthAudit.mjs's own header for the measurement that produced the 120px/20-char
 * thresholds.
 *
 * Run:  npm run build && npx vite preview --port 4173   (then)
 *       node ui-audit/verify-narrow-width-audit.mjs
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { auditNarrowWidth } from "./lib/narrowWidthAudit.mjs";
import { findViewport } from "./lib/visualBaseline.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync)
  || chromium.executablePath();

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

const phone = findViewport("phone");
const ctx = await browser.newContext({
  viewport: { width: phone.width, height: phone.height }, deviceScaleFactor: phone.deviceScaleFactor,
  isMobile: phone.isMobile, hasTouch: phone.hasTouch,
});
const page = await ctx.newPage();
await assertMeasurable(page, "verify-narrow-width-audit");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(600);

// Trigger the "newer version available" banner the same way verify-notes.mjs's own B1373 case
// does — a served /version.json that disagrees with the loaded build, then a focus event (the
// live app's own recheck trigger).
await ctx.route("**/version.json", (route) => route.fulfill({
  status: 200, contentType: "application/json", body: JSON.stringify({ build: "a-newer-deploy" }),
}));
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
await page.waitForTimeout(900);

const bannerVisible = await page.locator('[data-testid="app-update-banner"]').isVisible().catch(() => false);
if (!bannerVisible) {
  console.error("FAIL: the update banner never appeared — this script's own trigger is broken, not the gate under test.");
  process.exitCode = 1;
} else {
  const result = await auditNarrowWidth(page, { viewport: { width: phone.width, height: phone.height }, label: "update-banner (phone)" });
  if (result.pass) {
    console.log("✅ PASS — the update banner renders with no squeezed text and no horizontal overflow at phone width.");
  } else {
    console.error(`❌ FAIL — ${result.detail}`);
    process.exitCode = 1;
  }
}

await browser.close();
console.log(process.exitCode ? "\n❌ verification failed" : "\n✅ all checks passed");
