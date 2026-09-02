/* Runtime verification for B1048400 (NEW-2) — the cloud-write-failure banner must not claim the
 * cloud side is untouched when a GROUP-scoped write (a rename, a status change) can have landed
 * on SOME of the group's rows before it failed. Drives the BUILT app in headless Chromium, LOGGED
 * OUT — the boot-time drain effect (`SitePlannerApp.jsx`) reads the durable failure log purely
 * from localStorage and shows the banner regardless of auth state, so this whole check needs no
 * sign-in (ATTEMPT-BEFORE-YOU-PARK: a logged-out, no-external-GIS check is Claude-doable here).
 *
 * 1. Load the app fresh with an empty failure log — the banner must be absent.
 * 2. Seed `localStorage['planyr:cloudWriteFailures']` with one queued group-scoped failure
 *    (mirrors `recordCloudWriteFailure({ what: "The project rename", groupId, error })`) via
 *    `addInitScript`, so it's in place before the app's own boot-drain effect runs, then reload.
 * 3. Confirm the banner appears (`[data-testid="cloud-write-failure-banner"]`) with the honest
 *    wording — it must NOT claim the write "didn't reach the cloud" / say to "redo it" as if
 *    nothing landed, and it MUST say the sync may be partial — and that the Retry button
 *    (`[data-testid="cloud-write-failure-retry"]`) is present.
 *
 * What this does NOT prove: whether clicking Retry actually reaches Supabase and updates every
 * row (that needs a real sign-in and is `Blocker: auth` — see VERIFICATION.md V584992). The pure
 * group-scope logic itself is proven without a browser at all in test/writeFailureLog.test.js.
 *
 * Run:  npm run build && npx vite preview --host   (then, in another shell)
 *       node ui-audit/verify-write-failure-banner-copy.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();
await assertMeasurable(page, "verify-write-failure-banner-copy");

const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

const bannerLocator = () => page.locator('[data-testid="cloud-write-failure-banner"]');
const bannerVisible = () => bannerLocator().isVisible().catch(() => false);

// 1. Fresh load, no queued failure — the banner must not appear on its own.
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(300);
if (await bannerVisible()) fail("write-failure banner visible with an empty failure log");
else console.log("PASS 1/3 — no banner on a clean boot");

// 2. Seed one queued GROUP-scoped failure (the production repro's exact shape: a rename that
// touched a multi-plan group) before the app's own scripts run, then load fresh.
const seeded = { id: "seed1", what: "The project rename", groupId: "g1", siteId: null, error: "chunk load failed", at: Date.now() };
await page.addInitScript((entry) => {
  window.localStorage.setItem("planyr:cloudWriteFailures", JSON.stringify([entry]));
}, seeded);
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(300);

const visible = await bannerVisible();
if (!visible) { fail("write-failure banner did not appear for a seeded queued failure"); }
else {
  const text = (await bannerLocator().innerText().catch(() => "")).toLowerCase();
  const overclaims = text.includes("didn't reach the cloud") || text.includes("redo it if needed") || text.includes("redo them if needed");
  const honest = text.includes("may not have fully synced");
  if (overclaims) fail(`banner still implies the cloud is untouched: "${text}"`);
  else if (!honest) fail(`banner does not say the sync may be partial: "${text}"`);
  else console.log('PASS 2/3 — banner text is honest about a possibly-partial sync ("may not have fully synced", no "didn\'t reach the cloud"/"redo it")');
}

// 3. Retry is offered.
const retryBtn = page.locator('[data-testid="cloud-write-failure-retry"]');
if (await retryBtn.isVisible().catch(() => false)) console.log("PASS 3/3 — Retry now button present on the write-failure banner");
else fail("Retry now button not found on the write-failure banner");

await browser.close();
console.log(process.exitCode ? "\n❌ verification failed" : "\n✅ all checks passed");
