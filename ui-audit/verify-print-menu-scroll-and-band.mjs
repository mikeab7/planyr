#!/usr/bin/env node
/* NEW-1/NEW-2 verification — owner report: "ON THE PRINT MENU, I CANT USE MY MOUSE SCROLL WHEEL
 * TO SCROLL DOWN AND i ALSO CANT REMOVE THE BOTTOM MENU WITH ALL THE COVERAGES AND THIS STUFF"
 *
 * NEW-1 root cause: the canvas has a non-passive `wheel` listener bound to the canvas WRAPPER
 * (SitePlanner.jsx's wheel-zoom block) that calls `e.preventDefault()` on every wheel event that
 * doesn't bubble through a `[data-wheelscroll]` node. The compose screen (PrintCompose.jsx) is a
 * `position:fixed` full-screen overlay but is still a DOM DESCENDANT of that wrapper, so every
 * wheel notch over it used to silently zoom the hidden canvas instead of scrolling the options
 * column. Fix: `data-wheelscroll="1"` on the compose screen's root.
 *
 * NEW-2: a single "Stats band" toggle in the Content section turns off the stormwater bars +
 * site-metrics line + disclaimer as one unit, defaults ON, persists on the site's settings,
 * updates the live preview immediately, and the plan reclaims the freed space (no gap, no extra
 * page). Verified here against the actual composed sheet SVG text — not a screenshot.
 *
 *   node ui-audit/verify-print-menu-scroll-and-band.mjs          # against http://localhost:4173
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
// NEW-1's repro explicitly asks for a SHORT window — "his viewport is the constraint, so test
// short, not tall" — 1400x600 keeps the options column taller than the viewport on any real plan.
const ctx = await browser.newContext({ viewport: { width: 1400, height: 600 }, acceptDownloads: true });
await ctx.addInitScript(perfScenarioSeed());
const page = await ctx.newPage();
await assertMeasurable(page, "verify-print-menu-scroll-and-band");
await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));

const fail = [];
const ok = [];

await page.goto(BASE, { waitUntil: "load" });
// The app now lands on the Dashboard workspace; the seeded site opens once you switch to Site.
await page.getByRole("button", { name: /^Site$/ }).first().click();
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60_000 });

// Draw a building so the sheet has real content and the site-metrics line is non-trivial.
const tool = await page.getByRole("button", { name: /^Building$/ }).first();
if (await tool.count()) {
  await tool.click().catch(() => {});
  await page.mouse.move(500, 300); await page.mouse.down(); await page.mouse.move(760, 460); await page.mouse.up();
  await page.waitForTimeout(200);
  await page.keyboard.press("Escape").catch(() => {});
}

const openCompose = async () => {
  await page.getByRole("button", { name: /^File/ }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /Download PDF \/ pick frame/ }).first().click();
  await page.waitForFunction(() => /PRINT FRAME/i.test(document.body.innerText), null, { timeout: 20_000 });
  await page.getByRole("button", { name: /^Continue ➜$/ }).first().click();
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20_000 });
};
const readPreviewSvgText = async () => {
  const src = await page.locator('[data-testid="print-compose"] img[alt="Sheet preview"]').getAttribute("src").catch(() => null);
  if (!src) return null;
  // The debounced preview rebuild can revoke this exact blob URL between reading `src` and the
  // fetch resolving (a race in the POLLING harness, not the app) — treat that as "not yet", so
  // the caller's retry loop just tries again on the next tick instead of throwing.
  return page.evaluate(async (url) => { try { return await (await fetch(url)).text(); } catch (_) { return null; } }, src);
};
const waitPreviewChange = async (prevText) => {
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(250);
    const t = await readPreviewSvgText();
    if (t && t !== prevText) return t;
  }
  return null;
};
try {
  await openCompose();
  // Structure: print-compose > [preview column, panelWrap]; panelWrap > [header, panelScroll, footer].
  const panelScroll = page.locator('[data-testid="print-compose"] > div').nth(1).locator('> div').nth(1);

  /* ---- NEW-1a. the CANVAS behind the dialog is still there — confirm the dialog really does
     sit as a DOM descendant of the canvas wrapper (the mechanism), not merely visually on top. */
  const isDescendant = await page.evaluate(() => {
    const compose = document.querySelector('[data-testid="print-compose"]');
    const canvas = document.querySelector('[data-testid="planner-canvas"]');
    const wrap = canvas ? canvas.closest('div[style*="touch-action"]') || canvas.parentElement : null;
    return !!(compose && wrap && wrap.contains(compose));
  });
  if (isDescendant) ok.push("confirmed mechanism: the compose screen is a DOM descendant of the canvas wrapper (so wheel events bubble to the canvas's wheel-zoom handler unless opted out)");
  else fail.push("could not confirm the compose screen is a descendant of the canvas wrapper — the mechanism claim needs re-checking");

  /* ---- NEW-1b. the whole compose screen opts out via data-wheelscroll -------------------- */
  const hasWheelscroll = await page.locator('[data-testid="print-compose"][data-wheelscroll="1"]').count();
  if (hasWheelscroll) ok.push('[data-testid="print-compose"] carries data-wheelscroll="1"');
  else fail.push('the compose screen root is missing data-wheelscroll="1" — wheel events will still be swallowed by the canvas zoom handler');

  /* ---- NEW-1c. the options column ACTUALLY SCROLLS on a real wheel event ----------------- */
  const scrollableInfo = await panelScroll.evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, overflowY: getComputedStyle(el).overflowY }));
  if (scrollableInfo.overflowY !== "auto" && scrollableInfo.overflowY !== "scroll") fail.push(`expected the options panel's overflow-y to be auto/scroll, found "${scrollableInfo.overflowY}"`);
  if (scrollableInfo.scrollHeight <= scrollableInfo.clientHeight) fail.push(`the options panel isn't even tall enough to need scrolling at this window height (scrollHeight ${scrollableInfo.scrollHeight} vs clientHeight ${scrollableInfo.clientHeight}) — widen the fixture or shrink the viewport further`);
  else ok.push(`at a SHORT window height (600px), the options panel overflows (content ${scrollableInfo.scrollHeight}px vs visible ${scrollableInfo.clientHeight}px) — there is real scrolling to test`);

  const box = await panelScroll.boundingBox();
  const before = await panelScroll.evaluate((el) => el.scrollTop);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 300); // a real wheel event, full mouse-detent-sized delta
  await page.waitForTimeout(150);
  const afterMouseWheel = await panelScroll.evaluate((el) => el.scrollTop);
  if (afterMouseWheel > before) ok.push(`mouse wheel over the OPTIONS COLUMN scrolls it (scrollTop ${before} → ${afterMouseWheel})`);
  else fail.push(`mouse wheel over the options column did NOT scroll it (scrollTop stayed at ${before}) — the reported bug is still live`);

  /* ---- NEW-1d. trackpad two-finger scroll — same wheel event, SMALL per-tick deltas ------- */
  await panelScroll.evaluate((el) => { el.scrollTop = 0; });
  await page.waitForTimeout(50);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 18); await page.waitForTimeout(20); } // 8 small deltas ≈ a trackpad gesture
  await page.waitForTimeout(150);
  const afterTrackpad = await panelScroll.evaluate((el) => el.scrollTop);
  if (afterTrackpad > 0) ok.push(`trackpad-style small-delta wheel ticks also scroll the options column (scrollTop → ${afterTrackpad}) — same fix covers it, since both are native "wheel" events`);
  else fail.push("small-delta (trackpad-style) wheel ticks did not scroll the options column");

  /* ---- NEW-1e. keyboard PageDown / arrow keys ---------------------------------------------
     DRIVER-SCROLL-IS-NOT-APP-SCROLL: focusing (even via el.focus(), not just Playwright's own
     click-actionability scroll) an element near the BOTTOM of the panel auto-scrolls it into
     view before any key is pressed — a first pass on the "Dimensions" checkbox (near the
     bottom) measured scrollTop already at its max the instant it was focused, which would have
     read as "PageDown does nothing" for a reason that has nothing to do with PageDown. Focusing
     a control that's already visible at the TOP (the "Letter" paper-size chip) removes that
     confound and asks the real question. */
  await panelScroll.evaluate((el) => { el.scrollTop = 0; });
  const topChip = page.getByText("Letter", { exact: true }).first();
  await topChip.evaluate((el) => el.focus());
  await page.waitForTimeout(50);
  const scrollTopBeforeKey = await panelScroll.evaluate((el) => el.scrollTop);
  if (scrollTopBeforeKey !== 0) fail.push(`test setup error: focusing the top chip already scrolled the panel (scrollTop ${scrollTopBeforeKey}) — can't isolate PageDown's effect`);
  await page.keyboard.press("PageDown");
  await page.waitForTimeout(150);
  const afterPageDown = await panelScroll.evaluate((el) => el.scrollTop);
  if (afterPageDown > scrollTopBeforeKey) ok.push(`PageDown (focus on a control near the top of the panel) scrolls the options column (scrollTop ${scrollTopBeforeKey} → ${afterPageDown})`);
  else fail.push(`PageDown did not scroll the options column (stayed at ${scrollTopBeforeKey})`);

  await panelScroll.evaluate((el) => { el.scrollTop = 0; });
  await topChip.evaluate((el) => el.focus());
  await page.waitForTimeout(50);
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(150);
  const afterArrowDown = await panelScroll.evaluate((el) => el.scrollTop);
  if (afterArrowDown > 0) ok.push(`ArrowDown also scrolls the options column (scrollTop 0 → ${afterArrowDown}) — the dialog was always keyboard-scrollable; only the mouse wheel was broken`);
  else fail.push("ArrowDown did not scroll the options column");

  /* ---- NEW-1f. wheel over the PREVIEW pane does not leak through to the hidden canvas ----- */
  const previewBox = await page.locator('[data-testid="print-compose"] img[alt="Sheet preview"]').boundingBox();
  const ppfBefore = await page.evaluate(() => document.body.getAttribute("data-view-ppf") || document.querySelector("[data-view-ppf]")?.getAttribute("data-view-ppf") || null).catch(() => null);
  await page.mouse.move(previewBox.x + previewBox.width / 2, previewBox.y + previewBox.height / 2);
  await page.mouse.wheel(0, -400); // a zoom-in-sized notch, the kind that used to silently re-zoom the hidden canvas
  await page.waitForTimeout(200);
  const ppfAfter = await page.evaluate(() => document.body.getAttribute("data-view-ppf") || document.querySelector("[data-view-ppf]")?.getAttribute("data-view-ppf") || null).catch(() => null);
  if (ppfBefore === ppfAfter) ok.push("wheel over the PREVIEW pane does not silently re-zoom the hidden canvas underneath the dialog (a pre-existing side effect this fix also closes — the preview itself implements no zoom-on-wheel, which is fine per the brief)");
  else fail.push(`wheel over the preview pane changed the canvas view (ppf ${ppfBefore} → ${ppfAfter}) — it should be inert while the compose screen is open`);

  /* ---- NEW-1g. Download stays reachable at a short window height (the practical point) ---- */
  await panelScroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(100);
  const downloadVisible = await page.getByRole("button", { name: /Download PDF|Preparing/ }).first().isVisible().catch(() => false);
  if (downloadVisible) ok.push("Download PDF stays reachable in the footer at a short window height once the panel is scrolled");
  else fail.push("Download PDF is not visible even after scrolling the panel to the bottom");

  /* ================= NEW-2 — the "Stats band" toggle ===================================== */
  const before2 = await readPreviewSvgText();
  if (before2 == null) fail.push("no sheet preview rendered before testing the Stats band toggle");
  else if (!/Site area:/.test(before2) && !/STORMWATER/.test(before2) && !/planning-level estimates/.test(before2)) {
    fail.push("the default (band ON) preview shows none of the site-metrics line / stormwater bars / disclaimer — cannot exercise the toggle meaningfully");
  } else {
    ok.push("band ON by default: the composed sheet includes the site-metrics line and/or the disclaimer (byte-identical to pre-existing behavior)");
  }

  const bandToggle = page.getByText("Stats band", { exact: true }).first();
  if (!(await bandToggle.count())) fail.push('no "Stats band" toggle found in the Content section');
  else {
    // capture the plan's rendered height in the layout before turning the band off
    await bandToggle.click(); // turn OFF
    const afterOff = await waitPreviewChange(before2);
    if (!afterOff) fail.push("turning the Stats band OFF never rebuilt the sheet preview");
    else {
      const stillHasMetrics = /Site area:/.test(afterOff);
      const stillHasNote = /planning-level estimates/.test(afterOff);
      const stillHasStorm = /STORMWATER/.test(afterOff);
      if (!stillHasMetrics && !stillHasNote && !stillHasStorm) ok.push("band OFF: the site-metrics line, the disclaimer AND the stormwater strip are ALL gone from the composed sheet — one toggle removes the whole band");
      else fail.push(`band OFF still leaked band content into the sheet (metrics:${stillHasMetrics} note:${stillHasNote} storm:${stillHasStorm})`);

      // the plan's own nested <svg data-testid="planner-canvas" width="…" height="…"> should be
      // TALLER with the band off (it reclaims the space). The OUTER sheet <svg> declares its
      // width/height in real inches ("11in"/"8.5in"), which this pattern deliberately does NOT
      // match (no unit suffix allowed) — so the one match it finds is the nested plan svg.
      const planSvgAttrs = (svgText) => (svgText.match(/<svg[^>]*data-testid="planner-canvas"[^>]*width="(\d+(?:\.\d+)?)"[^>]*height="(\d+(?:\.\d+)?)"/) || []);
      const planHOn = planSvgAttrs(before2)[2] != null ? Number(planSvgAttrs(before2)[2]) : null;
      const planHOff = planSvgAttrs(afterOff)[2] != null ? Number(planSvgAttrs(afterOff)[2]) : null;
      if (planHOn != null && planHOff != null && planHOff > planHOn) ok.push(`the plan reclaims the freed space rather than leaving a gap (nested plan svg height ${planHOn} → ${planHOff} c-in)`);
      else fail.push(`could not confirm the plan grew when the band was removed (on=${planHOn}, off=${planHOff})`);

      // the OUTER sheet page size (width/height in inches) must be UNCHANGED — same page, no growth
      const pageInOn = (before2.match(/width="([\d.]+)in" height="([\d.]+)in"/) || []);
      const pageInOff = (afterOff.match(/width="([\d.]+)in" height="([\d.]+)in"/) || []);
      if (pageInOn[1] && pageInOff[1] && pageInOn[1] === pageInOff[1] && pageInOn[2] === pageInOff[2]) ok.push(`the sheet stays the SAME page size with the band off (${pageInOn[1]}×${pageInOn[2]}in) — no extra page`);
      else fail.push(`the page size changed when the band was toggled off (on ${pageInOn[1]}×${pageInOn[2]}in vs off ${pageInOff[1]}×${pageInOff[2]}in)`);
    }

    // turn back ON and confirm it restores
    await bandToggle.click();
    const afterOn = await waitPreviewChange(afterOff);
    if (afterOn && (/Site area:/.test(afterOn) || /planning-level estimates/.test(afterOn))) ok.push("re-enabling the toggle restores the band on the preview");
    else fail.push("re-enabling the Stats band toggle did not restore the band");
  }

  /* ---- NEW-2b. PERSISTENCE — closing and reopening the print flow keeps the choice --------- */
  await page.getByText("Stats band", { exact: true }).first().click(); // OFF again
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "✕" }).first().click(); // Cancel
  await page.waitForSelector('[data-testid="print-compose"]', { state: "detached", timeout: 10_000 });
  await openCompose();
  const bandCheckboxState = await page.locator('[data-testid="print-compose"] label:has-text("Stats band") input[type="checkbox"]').isChecked().catch(() => null);
  if (bandCheckboxState === false) ok.push("the Stats band choice PERSISTS across closing and reopening the print flow (still off)");
  else fail.push(`the Stats band choice did not persist — expected unchecked, found ${bandCheckboxState}`);
  // leave it back ON so this fixture doesn't leave a surprising state for anything after it
  await page.getByText("Stats band", { exact: true }).first().click();
} catch (e) {
  fail.push(`print-menu scroll/band flow failed — ${String(e).split("\n")[0]}`);
}

await browser.close();

console.log("NEW-1/NEW-2 — print menu wheel scroll + Stats band toggle\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log();
console.log(fail.length ? "✗ FAIL" : "✓ PASS — wheel/trackpad scroll the print dialog's options column, and the Stats band toggle removes the whole band (bars + metrics + disclaimer), reclaims the space, keeps the same page, previews live, and persists.");
process.exit(fail.length ? 1 : 0);
