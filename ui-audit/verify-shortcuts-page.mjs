#!/usr/bin/env node
/* verify-shortcuts-page — the Keyboard Shortcuts page (NEW-1, owner ask 2026-09-12: "there
 * should be a page for keyboard shortcuts so that this knowledge isn't hidden").
 *
 * Logged-out, no external GIS — Claude-doable per ATTEMPT-BEFORE-YOU-PARK, so this is a
 * `Verify: sandbox` item, not a live-verify one.
 *
 * Covered:
 *   1. "?" opens the page from the Dashboard route (the app's default landing surface).
 *   2. It lists real shortcuts spanning every section the owner asked for (Global/Site/
 *      Schedule/Review/Library/Notes/Spreadsheet) — a spot check across sections, not just one.
 *   3. "?" typed into a real text field does nothing (the typing guard).
 *   4. The Help menu's "Keyboard shortcuts" row is the second entry point.
 *   5. Usable at the owner's own window size (~1191×465, SHORT): the search box and close
 *      button stay on screen, and the list scrolls to reach a section near the bottom.
 *   6. The search box actually filters.
 *   7. Platform-aware rendering: the SAME combo renders "⌘" on a Mac UA and "Ctrl" elsewhere.
 *
 *   node ui-audit/verify-shortcuts-page.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function newPage(browser, { mac = false, viewport = { width: 1400, height: 900 } } = {}) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1,
    userAgent: mac
      ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
      : undefined,
  });
  if (mac) {
    // navigator.platform is what isApplePlatform() reads first; addInitScript runs before any
    // page script (including React's own boot), so this is a reliable override.
    await ctx.addInitScript(() => { Object.defineProperty(navigator, "platform", { get: () => "MacIntel" }); });
  }
  await ctx.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-shortcuts-page");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="help-report-fab"]', { timeout: 60_000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

console.log("Keyboard Shortcuts page — NEW-1\n");

// ---- 1/2/3: "?" opens it, from the Dashboard route; it names shortcuts from every section ----
{
  const { ctx, page } = await newPage(browser);
  await page.keyboard.press("?");
  await page.waitForSelector('[data-testid="shortcuts-page"]', { timeout: 5000 }).catch(() => {});
  const openedViaKey = await page.locator('[data-testid="shortcuts-page"]').count();
  check("'?' opens the page from the Dashboard route", openedViaKey > 0);

  const wantIds = [
    "global.fullscreen", "site.undo", "sched.insert", "review.undo", "library.search-clear",
    "notes.quickopen", "sheet.find", "comps.undo",
  ];
  const foundIds = await page.evaluate((ids) => ids.map((id) => !!document.querySelector(`[data-shortcut-id="${id}"]`)), wantIds);
  wantIds.forEach((id, i) => check(`lists ${id}`, foundIds[i]));

  // ---- 3: a real text field swallows "?" — the typing guard ----
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const inp = document.createElement("input");
    inp.type = "text";
    inp.id = "__probe_text_field__";
    document.body.appendChild(inp);
    inp.focus();
  });
  await page.keyboard.press("?"); // types "?" into the focused field
  await page.waitForTimeout(200);
  const openedWhileTyping = await page.locator('[data-testid="shortcuts-page"]').count();
  const probeValue = await page.locator("#__probe_text_field__").inputValue();
  check("'?' typed into a real text field does NOT open the page", openedWhileTyping === 0, `probe field now reads "${probeValue}"`);
  await page.evaluate(() => document.getElementById("__probe_text_field__")?.remove());

  await ctx.close();
}

// ---- 4: the Help menu's "Keyboard shortcuts" row ----
{
  const { ctx, page } = await newPage(browser);
  await page.click('[data-testid="help-report-fab"]');
  await page.waitForSelector('[data-testid="help-menu-shortcuts"]', { timeout: 5000 });
  await page.click('[data-testid="help-menu-shortcuts"]');
  await page.waitForSelector('[data-testid="shortcuts-page"]', { timeout: 5000 }).catch(() => {});
  const openedViaMenu = await page.locator('[data-testid="shortcuts-page"]').count();
  check("Help menu → 'Keyboard shortcuts' opens the page (entry point #2)", openedViaMenu > 0);
  await ctx.close();
}

// ---- 5: usable at the owner's own ~1191×465 window ----
{
  const { ctx, page } = await newPage(browser, { viewport: { width: 1191, height: 465 } });
  await page.keyboard.press("?");
  await page.waitForSelector('[data-testid="shortcuts-page"]', { timeout: 5000 });
  const layout = await page.evaluate(() => {
    const dlg = document.querySelector('[data-testid="shortcuts-page"]');
    const search = document.querySelector('[data-testid="shortcuts-search"]');
    const close = document.querySelector('[data-testid="shortcuts-close"]');
    const dlgRect = dlg.getBoundingClientRect();
    const fitsViewport = dlgRect.bottom <= window.innerHeight + 1 && dlgRect.top >= -1;
    const body = dlg.querySelector('[data-testid="shortcuts-item"]')?.closest("div[style]")?.parentElement;
    return {
      searchVisible: !!search && search.getBoundingClientRect().height > 0,
      closeVisible: !!close && close.getBoundingClientRect().height > 0,
      fitsViewport,
      dialogHeight: dlgRect.height, windowHeight: window.innerHeight,
    };
  });
  check("search box is visible at 1191×465", layout.searchVisible);
  check("close button is visible at 1191×465", layout.closeVisible);
  check("dialog fits inside the 465px-tall viewport (no clipped header/search)", layout.fitsViewport, `dialog ${layout.dialogHeight}px vs window ${layout.windowHeight}px`);

  // The body region (the one wrapped in overflowY:auto) must actually be scrollable — the last
  // section should be unreachable without scrolling, and reachable after.
  const scroll = await page.evaluate(() => {
    const items = [...document.querySelectorAll('[data-shortcut-id]')];
    const last = items[items.length - 1];
    const scroller = last.closest("[data-section]").parentElement; // the flex:1;overflowY:auto body
    const before = last.getBoundingClientRect();
    const offscreenBefore = before.top > window.innerHeight;
    last.scrollIntoView({ block: "end" });
    const after = last.getBoundingClientRect();
    const onscreenAfter = after.top >= 0 && after.bottom <= window.innerHeight + 1;
    return { offscreenBefore, onscreenAfter, scrollHeight: scroller.scrollHeight, clientHeight: scroller.clientHeight };
  });
  check("the list overflows the short window (scrollHeight > clientHeight)", scroll.scrollHeight > scroll.clientHeight, `${scroll.scrollHeight} vs ${scroll.clientHeight}`);
  check("the last shortcut is reachable by scrolling", scroll.onscreenAfter);
  await ctx.close();
}

// ---- 6: the search box filters ----
{
  const { ctx, page } = await newPage(browser);
  await page.keyboard.press("?");
  await page.waitForSelector('[data-testid="shortcuts-page"]', { timeout: 5000 });
  const before = await page.locator('[data-testid="shortcuts-item"]').count();
  await page.fill('[data-testid="shortcuts-search"]', "full screen");
  await page.waitForTimeout(150);
  const after = await page.locator('[data-testid="shortcuts-item"]').count();
  const stillHasFullscreen = await page.locator('[data-shortcut-id="global.fullscreen"]').count();
  check("typing a query narrows the list", after > 0 && after < before, `${before} -> ${after}`);
  check("the matching row survives the filter", stillHasFullscreen > 0);
  await ctx.close();
}

// ---- 7: platform-aware rendering ----
{
  const { ctx: ctxWin, page: pageWin } = await newPage(browser, { mac: false });
  await pageWin.keyboard.press("?");
  await pageWin.waitForSelector('[data-testid="shortcuts-page"]', { timeout: 5000 });
  const winText = await pageWin.locator('[data-shortcut-id="site.undo"] kbd').innerText();
  await ctxWin.close();

  const { ctx: ctxMac, page: pageMac } = await newPage(browser, { mac: true });
  await pageMac.keyboard.press("?");
  await pageMac.waitForSelector('[data-testid="shortcuts-page"]', { timeout: 5000 });
  const macText = await pageMac.locator('[data-shortcut-id="site.undo"] kbd').innerText();
  await ctxMac.close();

  check("non-Mac renders words (\"Ctrl\")", winText.includes("Ctrl"), winText);
  check("Mac renders the real glyph (\"⌘\")", macText.includes("⌘") && !macText.includes("Ctrl"), macText);
  check("the two differ — this is a real platform switch, not a static string", winText !== macText);
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) { console.log("FAILED:"); failed.forEach((r) => console.log(`  - ${r.name}${r.detail ? ` (${r.detail})` : ""}`)); process.exit(1); }
