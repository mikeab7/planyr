#!/usr/bin/env node
/* B1074768/B1074769/B1074770 (map-finder split-button audit, 2026-09-02) — verifies the three
 * fixes against the real, built app in a real Chromium tab, logged out:
 *   NEW-1 — the "Select parcels" and "Place comp" split-button caret menus right-align to the
 *     split CONTROL's right edge (not the caret's left edge) — no overhang past the control.
 *   NEW-2 — the "Select parcels" caret menu is a tighter, content-proportioned width (148, not
 *     200) while keeping its caret+menu structure (never re-split into two co-equal buttons).
 *   NEW-3 — both split-button carets render the same aria-hidden, opacity-0.6, decorative-glyph
 *     caret structure controls.jsx's MenuTrigger uses elsewhere in the app.
 *
 *   node ui-audit/verify-map-toolbar-caret-anchor.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/map-toolbar-caret-anchor";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome" });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 465 } }); // the exact repro viewport
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-map-toolbar-caret-anchor");
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await pacedWait(page, 800);

  // ── Select parcels ▾ Start blank (Site mode, the default) ──────────────────────────
  const primaryBtn = page.locator('button', { hasText: "Select parcels" }).first();
  const caretBtn = page.locator('[data-testid="map-start-blank-menu-btn"]');
  check("Select parcels primary button renders", await primaryBtn.count() === 1);
  check("Select parcels caret button renders", await caretBtn.count() === 1);

  const caretGlyph = await caretBtn.locator("span[aria-hidden='true']").first();
  const caretText = await caretGlyph.textContent();
  const caretStyle = await caretGlyph.evaluate((el) => { const cs = getComputedStyle(el); return { opacity: cs.opacity, fontSize: cs.fontSize }; });
  check("Select parcels caret glyph is ▾ in an aria-hidden span", caretText === "▾");
  check("Select parcels caret glyph is opacity 0.6", Math.abs(parseFloat(caretStyle.opacity) - 0.6) < 0.01, caretStyle.opacity);

  await caretBtn.click();
  await pacedWait(page, 200);
  const startBlankItem = page.locator('[data-testid="map-start-blank-menu-item"]');
  check("'Start blank' menu item appears", await startBlankItem.count() === 1);

  const siteRects = await page.evaluate(() => {
    const primary = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Select parcels");
    const caret = document.querySelector('[data-testid="map-start-blank-menu-btn"]');
    const item = document.querySelector('[data-testid="map-start-blank-menu-item"]');
    const panel = item ? item.closest(".menu") : null;
    return {
      controlRight: caret.getBoundingClientRect().right, // caret is the trailing flex segment == control's own right edge
      controlLeft: primary.getBoundingClientRect().left,
      panelRight: panel ? panel.getBoundingClientRect().right : null,
      panelWidth: panel ? panel.getBoundingClientRect().width : null,
    };
  });
  check("Select parcels: menu.right is within 1px of the split control's right edge",
    siteRects.panelRight != null && Math.abs(siteRects.panelRight - siteRects.controlRight) <= 1,
    `panelRight=${siteRects.panelRight} controlRight=${siteRects.controlRight}`);
  check("Select parcels: menu panel is the tightened 148px width (NEW-2)",
    siteRects.panelWidth != null && Math.abs(siteRects.panelWidth - 148) <= 1, `panelWidth=${siteRects.panelWidth}`);
  if (SHOTS) await page.screenshot({ path: `${OUT}/select-parcels-menu.png` });
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);

  // ── Place comp ▾ On the map / On a parcel / On a site plan (Comp mode) ─────────────
  await page.locator('div[role="tablist"] button', { hasText: "Comp" }).first().click();
  await pacedWait(page, 300);
  const placeCompCaret = page.locator('[data-testid="map-place-comp-menu-btn"]');
  check("Place comp caret button renders", await placeCompCaret.count() === 1);
  const compGlyph = placeCompCaret.locator("span[aria-hidden='true']").first();
  check("Place comp caret glyph is ▾ in an aria-hidden span", (await compGlyph.textContent()) === "▾");
  const compGlyphStyle = await compGlyph.evaluate((el) => getComputedStyle(el).opacity);
  check("Place comp caret glyph is opacity 0.6", Math.abs(parseFloat(compGlyphStyle) - 0.6) < 0.01, compGlyphStyle);

  await placeCompCaret.click();
  await pacedWait(page, 200);
  const compRects = await page.evaluate(() => {
    const caret = document.querySelector('[data-testid="map-place-comp-menu-btn"]');
    const item = document.querySelector('[data-testid="map-place-comp-menu-item-map"]');
    const panel = item ? item.closest(".menu") : null;
    return {
      controlRight: caret.getBoundingClientRect().right,
      panelRight: panel ? panel.getBoundingClientRect().right : null,
      panelWidth: panel ? panel.getBoundingClientRect().width : null,
      itemCount: document.querySelectorAll('[data-testid^="map-place-comp-menu-item-"]').length,
    };
  });
  check("Place comp: menu.right is within 1px of the split control's right edge",
    compRects.panelRight != null && Math.abs(compRects.panelRight - compRects.controlRight) <= 1,
    `panelRight=${compRects.panelRight} controlRight=${compRects.controlRight}`);
  check("Place comp: menu still holds all 3 items (width unchanged, NEW-2 doesn't apply)",
    compRects.itemCount === 3, `itemCount=${compRects.itemCount}`);
  check("Place comp: menu panel width unchanged at 200px", compRects.panelWidth != null && Math.abs(compRects.panelWidth - 200) <= 1, `panelWidth=${compRects.panelWidth}`);
  if (SHOTS) await page.screenshot({ path: `${OUT}/place-comp-menu.png` });

  if (SHOTS) writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}

const fails = results.filter((r) => !r.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) process.exit(1);
