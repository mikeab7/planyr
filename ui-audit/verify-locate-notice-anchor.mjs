#!/usr/bin/env node
/* NEW-4 (B809907, 2026-08-27, owner: "this banner should pop up next to the location button" +
 * "the banner doesnt need to stay for so long") — the "Location is blocked…" message used to
 * render through the map's generic page-corner `err` banner (top-left in narrow layouts, with no
 * visual tie to the control that produced it) and never auto-dismissed (no timer anywhere clears
 * `err`; only an unrelated later action — a new search, a parcel pick — happens to reset it, so it
 * could sit on screen indefinitely). Fixed via a dedicated AnchoredMenu popover, anchored to the
 * locate button itself (`locateBtnRef`), with a LOCATE_NOTICE_MS auto-dismiss timer plus a manual
 * ✕ and click-away.
 *
 * Confirms, driven through the real UI at the widths NEW-2 was asked to hold across (900-2000):
 *   1. The popover appears anchored to (left-aligned above, small gap from) the locate button.
 *   2. It never overflows the viewport and never covers the button it explains.
 *   3. It is announced (role="status") and carries the exact, unmodified wording.
 *   4. It is dismissible by hand (✕) before the timer fires.
 *   5. It auto-dismisses on its own after LOCATE_NOTICE_MS, without requiring an unrelated action.
 *
 *   node ui-audit/verify-locate-notice-anchor.mjs [--url http://localhost:4173/]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({}));
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;
// Mock a genuinely-denied geolocation permission (the one 'blocked' state the app's own precheck
// can see, per B734529's correction) so the button starts in the blocked state deterministically.
const blockPerm = `(() => {
  const orig = navigator.permissions.query.bind(navigator.permissions);
  navigator.permissions.query = (opts) => {
    if (opts && opts.name === 'geolocation') {
      const target = new EventTarget();
      return Promise.resolve(Object.assign(target, { state: 'denied', addEventListener: target.addEventListener.bind(target) }));
    }
    return orig(opts);
  };
})();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const WIDTHS = [900, 2000];
  for (const width of WIDTHS) {
    console.log(`\n${width}×900`);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.addInitScript(seed);
    await ctx.addInitScript(blockPerm);
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-locate-notice-anchor");
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="locate-me-btn"]', { timeout: 20000 });
    await pacedWait(page, 1500);

    await page.locator('[data-testid="locate-me-btn"]').click({ timeout: 3000 });
    await pacedWait(page, 400);

    const geo = await page.evaluate(() => {
      const rect = (el) => el ? (({ x, y, width, height, right, bottom }) => ({ x, y, width, height, right, bottom }))(el.getBoundingClientRect()) : null;
      const btn = document.querySelector('[data-testid="locate-me-btn"]');
      const notice = [...document.querySelectorAll('[role="status"]')].find((e) => /blocked/i.test(e.textContent || ""));
      return {
        btn: rect(btn), notice: rect(notice), text: notice ? notice.textContent : null,
        hasDismiss: notice ? !!notice.querySelector('button[aria-label="Dismiss"]') : false,
        vpW: window.innerWidth, vpH: window.innerHeight,
      };
    });

    check(`${width}px · the notice appears, announced via role="status"`, !!geo.notice);
    check(`${width}px · wording is exact and unmodified`, geo.text === "Location is blocked by your browser or a company network policy.✕", geo.text || "");
    check(`${width}px · carries a manual Dismiss control`, geo.hasDismiss);

    if (geo.notice && geo.btn) {
      const EPS = 4;
      check(`${width}px · left-aligned with the locate button (anchored, not floating free)`, Math.abs(geo.notice.x - geo.btn.x) <= EPS, `notice.x=${geo.notice.x} btn.x=${geo.btn.x}`);
      check(`${width}px · sits ABOVE the button with a small gap (never covering it)`, geo.notice.bottom < geo.btn.y && (geo.btn.y - geo.notice.bottom) < 20, `gap=${geo.btn.y - geo.notice.bottom}px`);
      check(`${width}px · does not overflow the left/top viewport edge`, geo.notice.x >= 0 && geo.notice.y >= 0);
      check(`${width}px · does not overflow the right viewport edge`, geo.notice.right <= geo.vpW);
    }

    // Manual dismiss works before the timer fires.
    await page.locator('button[aria-label="Dismiss"]').first().click({ timeout: 2000 }).catch(() => {});
    await pacedWait(page, 300);
    const goneAfterManual = await page.locator('[role="status"]', { hasText: "blocked" }).count();
    check(`${width}px · manual Dismiss removes it immediately`, goneAfterManual === 0);

    // Re-trigger and confirm it auto-dismisses on its own (no unrelated action needed) — this is
    // the "doesn't stay so long" half; LOCATE_NOTICE_MS is 6000ms in MapFinder.jsx.
    await page.locator('[data-testid="locate-me-btn"]').click({ timeout: 3000 });
    await pacedWait(page, 400);
    const upBeforeWait = await page.locator('[role="status"]', { hasText: "blocked" }).count();
    check(`${width}px · re-appears on a fresh click`, upBeforeWait === 1);
    await pacedWait(page, 6300); // past LOCATE_NOTICE_MS with margin
    const goneAfterAutoDismiss = await page.locator('[role="status"]', { hasText: "blocked" }).count();
    check(`${width}px · auto-dismisses on its own after ~6s, no unrelated action needed`, goneAfterAutoDismiss === 0);

    await ctx.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
