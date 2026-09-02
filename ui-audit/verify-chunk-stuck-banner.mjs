/* Runtime verification for NEW-2 (B######) — the chunk-recovery "stuck" state now surfaces a
 * banner instead of ending in silent telemetry. Drives the BUILT app in headless Chromium:
 *   1. Load the page AS IF it just arrived via the cache-busting reload (`?_r=`), which is what
 *      `_arrivedViaFreshReload` is keyed on at guard-install time.
 *   2. Fire a `vite:preloadError` — recoveryStage() must read "stuck" (fresh build, still
 *      missing the chunk), which should call markChunkRecoveryStuck() and make Shell's
 *      UpdateBanner appear with reason "chunk-stuck".
 *   3. Confirm the banner's Reload button is present and clickable (does not assert the
 *      resulting navigation — that's covered by B221's own verify-chunk-reload.mjs).
 * This is the one part of NEW-1/NEW-2 that needs no sign-in and is fully self-verifiable here;
 * the cloud-write-failure banner/badge/retry path needs a signed-in rename, which this sandbox
 * cannot do (CORS-blocked Supabase auth handshake) — see the item's Blocker: auth note.
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       node ui-audit/verify-chunk-stuck-banner.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();
await assertMeasurable(page, "verify-chunk-stuck-banner");

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

// Arrive "as if" via a fresh cache-busting reload, so the guard's _arrivedViaFreshReload latch
// reads true at install time — the precondition for "stuck" rather than "reload".
await page.goto(`${BASE}?_r=${Date.now()}`, { waitUntil: "load" });

const bannerVisible = () => page.locator('[data-testid="app-update-banner"]').isVisible().catch(() => false);

if (await bannerVisible()) { fail("update banner already visible before any preloadError fired"); }
else console.log("PASS 1/3 — no banner before any chunk failure");

await page.evaluate(() => window.dispatchEvent(new Event("vite:preloadError")));
await page.waitForTimeout(300);

const visible = await bannerVisible();
const reason = visible ? await page.locator('[data-testid="app-update-banner"]').getAttribute("data-reason") : null;
if (visible && reason === "chunk-stuck") console.log('PASS 2/3 — banner appeared with data-reason="chunk-stuck" after a preloadError on a freshly-reloaded page');
else fail(`banner did not appear as "chunk-stuck" (visible=${visible}, reason=${reason})`);

const reloadBtn = page.locator('[data-testid="app-update-reload"]');
if (await reloadBtn.isVisible().catch(() => false)) console.log("PASS 3/3 — Reload button present on the chunk-stuck banner");
else fail("Reload button not found on the chunk-stuck banner");

await browser.close();
console.log(process.exitCode ? "\n❌ verification failed" : "\n✅ all checks passed");
