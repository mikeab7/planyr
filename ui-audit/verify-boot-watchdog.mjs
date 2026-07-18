/**
 * B758 / V272 — the boot watchdog (the inline <script> in index.html) turns a
 * "main bundle 404'd mid-deploy" white screen into an auto-recovering "Updating Planyr…"
 * state, with a BOUNDED number of cache-busting reloads before it gives up to an honest
 * "finishing an update / Try again" screen. The watchdog lives in index.html (the one file
 * that is never content-hashed, so it survives the very failure it recovers from) and can't
 * be exercised by a unit test — it needs a real document load whose entry <script
 * src="/assets/index-*.js"> actually fails. This drives that headless.
 *
 * The watchdog deliberately no-ops for automated browsers (`if (navigator.webdriver) return`),
 * so the harness overrides navigator.webdriver → false via addInitScript (runs before the
 * inline scripts) and deep-links with a `#/` hash so the /landing/ redirect returns early and
 * the app takes the normal boot path. The entry bundle is 404'd per-scenario with page.route.
 *
 * Three scenarios (fresh context each, so sessionStorage's reload counter is clean):
 *   1. NORMAL boot        — nothing intercepted → #root mounts, the overlay never appears,
 *                            no leftover planyr:bootReloadCount.
 *   2. TRANSIENT race     — entry 404s twice then heals → "Updating Planyr…" overlay + two
 *                            cache-busting reloads → the app mounts, overlay gone, counter cleared.
 *   3. PERSISTENT break   — entry 404s forever → exactly 3 auto-reloads (4 loads) then the
 *                            "Planyr is finishing an update / Try again" overlay with a manual
 *                            button — and NO further reload (no infinite loop).
 *
 * Run:  npm run build && npx vite preview --port 4193  (background), then
 *       BASE_URL=http://localhost:4193/ node ui-audit/verify-boot-watchdog.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4193/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };

// The watchdog fires only for a "real" (non-automated) browser; override the flag before any
// page script runs. Object.defineProperty overrides Playwright's CDP-set navigator.webdriver.
const UNMASK_WEBDRIVER = () => {
  Object.defineProperty(navigator, "webdriver", { get: () => false, configurable: true });
};

// The sandbox egress blocks Google Fonts; left alone, the stylesheet/font requests hang until
// their ~12 s timeout and stall the document `load` event (and with it the entry-script error
// dispatch), making the whole watchdog cycle look ~13 s slower than it is on a real network.
// Aborting them up front keeps the harness fast + deterministic; the app renders fine unstyled.
async function prep(ctx) {
  await ctx.addInitScript(UNMASK_WEBDRIVER);
  await ctx.route("**/fonts.googleapis.com/**", (r) => r.abort());
  await ctx.route("**/fonts.gstatic.com/**", (r) => r.abort());
}

// Discover the real entry bundle from the SERVED index.html (the <script type="module"> src),
// so the harness tracks whatever hash this build produced.
async function entryBundlePath() {
  const html = await (await fetch(BASE)).text();
  const m = html.match(/<script[^>]*type="module"[^>]*src="([^"]+\.js)"/);
  if (!m) throw new Error("could not find the entry <script type=module> in index.html");
  return m[1]; // e.g. /assets/index-BL-uMfLL.js
}

const isMounted = (page) => page.evaluate(() => {
  const r = document.getElementById("root");
  return !!(r && r.childElementCount > 0);
});
const overlayText = (page) => page.evaluate(() => {
  const el = document.getElementById("planyr-boot-overlay");
  return el ? el.textContent || "" : null;
});
const counter = (page) => page.evaluate(() => { try { return sessionStorage.getItem("planyr:bootReloadCount"); } catch { return "err"; } });

async function run() {
  const entry = await entryBundlePath();
  console.log(`entry bundle: ${entry}`);
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const url = `${BASE}#/`; // hash → the /landing/ redirect returns early → normal app boot

  // ── Scenario 1: NORMAL boot — nothing intercepted ────────────────────────────
  console.log("\nScenario 1 — normal boot (no interception):");
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 } });
    await prep(ctx);
    let loads = 0;
    const page = await ctx.newPage();
    page.on("load", () => { loads++; });
    await page.goto(url, { waitUntil: "commit" });
    // confirm the override actually took (the linchpin of the whole harness)
    const wd = await page.evaluate(() => navigator.webdriver);
    expect("navigator.webdriver override took (false → watchdog is armed)", wd === false, `webdriver=${wd}`);
    await page.locator("#root > *").first().waitFor({ timeout: 12000 }).catch(() => {});
    await page.waitForTimeout(1500);
    expect("app mounted (#root has children)", await isMounted(page));
    expect("the boot overlay never appeared", (await overlayText(page)) === null);
    expect("no leftover bootReloadCount", (await counter(page)) === null, `counter=${await counter(page)}`);
    expect("exactly one document load (no reload)", loads === 1, `loads=${loads}`);
    await ctx.close();
  }

  // ── Scenario 2: TRANSIENT race — entry 404s twice, then heals ────────────────
  console.log("\nScenario 2 — transient deploy race (entry 404s twice, then heals):");
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 } });
    await prep(ctx);
    let entryHits = 0, sawUpdatingOverlay = false;
    // A failed entry load — the transient deploy-window 404 — is a network failure to the
    // module loader either way; abort() reproduces it cleanly and fires the script `error`
    // immediately. Heal on the 3rd request (the deploy has now propagated).
    await ctx.route(`**${entry}*`, (route) => {
      entryHits++;
      if (entryHits <= 2) route.abort("failed");
      else route.continue();
    });
    let loads = 0;
    const page = await ctx.newPage();
    page.on("load", () => { loads++; });
    await page.goto(url, { waitUntil: "commit" });
    // Poll for the "Updating Planyr…" overlay during the recovery window.
    for (let i = 0; i < 40; i++) {
      const ov = await overlayText(page).catch(() => null);
      if (ov && /Updating Planyr/.test(ov)) { sawUpdatingOverlay = true; break; }
      if (await isMounted(page).catch(() => false)) break;
      await page.waitForTimeout(300);
    }
    await page.locator("#root > *").first().waitFor({ timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);
    expect("the 'Updating Planyr…' overlay showed during recovery", sawUpdatingOverlay);
    expect("the app eventually mounted after the entry healed", await isMounted(page));
    expect("the overlay was cleared once mounted", (await overlayText(page)) === null);
    expect("the reload counter was cleared on success", (await counter(page)) === null, `counter=${await counter(page)}`);
    expect("entry requested 3× (initial 404 + 404 + healed serve)", entryHits >= 3, `entryHits=${entryHits}`);
    expect("recovered in a bounded number of loads (≤3)", loads <= 3 && loads >= 2, `loads=${loads}`);
    await ctx.close();
  }

  // ── Scenario 3: PERSISTENT break — entry 404s forever ────────────────────────
  console.log("\nScenario 3 — persistent break (entry 404s forever):");
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 820 } });
    await prep(ctx);
    let entryHits = 0;
    await ctx.route(`**${entry}*`, (route) => { entryHits++; route.abort("failed"); });
    let loads = 0;
    const page = await ctx.newPage();
    page.on("load", () => { loads++; });
    await page.goto(url, { waitUntil: "commit" });
    // Wait out the bounded auto-reloads (MAX=3 × DELAY 2500ms + slack), then the stuck screen.
    let stuckText = null;
    for (let i = 0; i < 30; i++) {
      const ov = await overlayText(page).catch(() => null);
      if (ov && /finishing an update/.test(ov)) { stuckText = ov; break; }
      await page.waitForTimeout(500);
    }
    expect("reached the terminal 'Planyr is finishing an update' screen", !!stuckText);
    const retry = await page.locator("#planyr-boot-retry").count();
    expect("a manual 'Try again' button is present on the stuck screen", retry === 1);
    expect("bootReloadCount capped at 3 (bounded retries)", (await counter(page)) === "3", `counter=${await counter(page)}`);
    expect("exactly 4 document loads (initial + 3 auto-reloads)", loads === 4, `loads=${loads}`);
    // No infinite loop: give it more than another DELAY window and confirm it did NOT reload again.
    const loadsAtStuck = loads;
    await page.waitForTimeout(4000);
    expect("no further reload after the cap (no infinite loop)", loads === loadsAtStuck, `loads ${loadsAtStuck} → ${loads}`);
    await ctx.close();
  }

  await browser.close();
  console.log(failures ? `\nBOOT-WATCHDOG VERIFY: ${failures} FAILURE(S)` : "\nBOOT-WATCHDOG VERIFY: ALL PASS");
  process.exit(failures ? 1 : 0);
}
run().catch((e) => { console.error("harness error:", e); process.exit(1); });
