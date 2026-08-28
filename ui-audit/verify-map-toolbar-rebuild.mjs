#!/usr/bin/env node
/* B831776–B831781 — the Site/Comp toolbar + rail rebuild, verified against the real app.
 *
 * Covers, at 900/1400/2400 CSS px (the widths the brief named, spanning B814913's narrow-width
 * fix zone):
 *   NEW-1/NEW-2 — the toolbar switch and the rail tab are driven by ONE state: flipping either
 *     flips the other.
 *   NEW-3 — the load-bearing decoupling: the Sites/Comps map-visibility checkboxes exist, default
 *     ON, and switching the rail tab never touches them. (The deeper proof — that the map-layer
 *     effects' CODE never reads `mode` at all — is test/mapModeDecoupling.test.js, a source-level
 *     guard; this is the DOM-level companion, checkable with zero seeded sites/comps data.)
 *   NEW-4a/NEW-4d — the suggestion combobox: Enter commits before any suggestion has arrived
 *     (network mocked SLOW so the race is real, not assumed), and a genuine no-match (both
 *     providers mocked to answer with zero results) offers "Search anyway" / a drop-pin action
 *     rather than going quiet.
 *   NEW-5 — the toolbar bar is RADIUS.lg (12px) and its buttons are RADIUS.sm (6px) — the
 *     concentric-nesting rule from radius.js, read off getComputedStyle rather than asserted.
 *   NEW-6 — the Comp-mode armed ring exists exactly when it should (armed) and never otherwise.
 *
 *   node ui-audit/verify-map-toolbar-rebuild.mjs [--url http://localhost:4173/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4173/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/map-toolbar-rebuild";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function mockGeocoders(page, { esriCandidates = [], nomResults = [], delayMs = 0 } = {}) {
  await page.route("**://geocode.arcgis.com/**", async (route) => {
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: esriCandidates }) });
  });
  await page.route("**://nominatim.openstreetmap.org/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(nomResults) });
  });
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome" });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });
  const WIDTHS = [2400, 1400, 900];

  for (const width of WIDTHS) {
    console.log(`\n${width}×1000`);
    const ctx = await browser.newContext({ viewport: { width, height: 1000 } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-map-toolbar-rebuild");
    await mockGeocoders(page, { esriCandidates: [] , nomResults: [] });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await pacedWait(page, 800);

    // ── shape presence ──────────────────────────────────────────────────────────
    const switchSel = 'div[role="tablist"][aria-label="Site or comp"]';
    const hasSwitch = await page.locator(switchSel).count();
    check(`${width}px · Site/Comp switch renders`, hasSwitch === 1);
    const hasCombobox = await page.locator('input[role="combobox"]').count();
    check(`${width}px · address field is a combobox (no Go button)`, hasCombobox === 1);
    const hasGoButton = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.textContent.trim() === "Go"));
    check(`${width}px · the red "Go" button is gone`, !hasGoButton);
    const showSites = await page.locator('[data-testid="map-show-sites"]').count();
    const showComps = await page.locator('[data-testid="map-show-comps"]').count();
    check(`${width}px · Sites/Comps visibility checkboxes exist in Imagery & layers`, showSites === 1 && showComps === 1);

    // ── NEW-1/NEW-2 — one piece of state ────────────────────────────────────────
    const railTab = (label) => page.locator(`button[role="tab"]`, { hasText: label }).first();
    const switchSeg = (label) => page.locator(`${switchSel} button`, { hasText: label });
    let siteSel = await switchSeg("Site").getAttribute("aria-selected");
    check(`${width}px · Site mode selected by default`, siteSel === "true");
    await switchSeg("Comp").click();
    await pacedWait(page, 200);
    const compsTabSel = await railTab("Comps").getAttribute("aria-selected");
    check(`${width}px · clicking the toolbar's Comp segment selects the Comps rail tab (same state)`, compsTabSel === "true");
    // Flip it back via the RAIL this time, and confirm the SWITCH follows.
    await railTab("Sites").click();
    await pacedWait(page, 200);
    const siteSegSel = await switchSeg("Site").getAttribute("aria-selected");
    check(`${width}px · clicking the Sites rail tab selects the toolbar's Site segment (same state, both directions)`, siteSegSel === "true");

    // ── NEW-3 — decoupling, DOM level ───────────────────────────────────────────
    const checkedBefore = await page.evaluate(() => ({
      sites: document.querySelector('[data-testid="map-show-sites"]').checked,
      comps: document.querySelector('[data-testid="map-show-comps"]').checked,
    }));
    check(`${width}px · Sites/Comps checkboxes default ON`, checkedBefore.sites === true && checkedBefore.comps === true);
    await switchSeg("Comp").click();
    await pacedWait(page, 200);
    const checkedAfterTabSwitch = await page.evaluate(() => ({
      sites: document.querySelector('[data-testid="map-show-sites"]').checked,
      comps: document.querySelector('[data-testid="map-show-comps"]').checked,
    }));
    check(`${width}px · switching to Comp mode leaves both visibility checkboxes untouched`,
      checkedAfterTabSwitch.sites === checkedBefore.sites && checkedAfterTabSwitch.comps === checkedBefore.comps,
      JSON.stringify(checkedAfterTabSwitch));
    await switchSeg("Site").click();
    await pacedWait(page, 150);

    // ── NEW-6 — armed state ─────────────────────────────────────────────────────
    const armedBeforeAnyMode = await page.locator('[data-testid="map-comp-armed"]').count();
    check(`${width}px · no armed ring in Site mode`, armedBeforeAnyMode === 0);
    await switchSeg("Comp").click();
    await pacedWait(page, 150);
    const armedIdleComp = await page.locator('[data-testid="map-comp-armed"]').count();
    check(`${width}px · no armed ring in Comp mode until an action is armed`, armedIdleComp === 0);
    await page.locator("button", { hasText: "Drop a pin" }).click();
    await pacedWait(page, 150);
    const armedAfterDropPin = await page.locator('[data-testid="map-comp-armed"]').count();
    check(`${width}px · armed ring appears once "Drop a pin" is pressed`, armedAfterDropPin === 1);
    await page.locator("button", { hasText: "Cancel" }).click();
    await pacedWait(page, 150);
    const armedAfterCancel = await page.locator('[data-testid="map-comp-armed"]').count();
    check(`${width}px · armed ring disappears on Cancel`, armedAfterCancel === 0);
    await switchSeg("Site").click();
    await pacedWait(page, 150);

    // ── NEW-5 — shape convergence ───────────────────────────────────────────────
    const shape = await page.evaluate((sw) => {
      const bar = document.querySelector(sw)?.parentElement; // the switch's parent IS the toolbar bar
      const selectParcelsBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Select parcels");
      return {
        barRadius: bar ? getComputedStyle(bar).borderRadius : null,
        btnRadius: selectParcelsBtn ? getComputedStyle(selectParcelsBtn).borderRadius : null,
      };
    }, switchSel);
    check(`${width}px · toolbar bar radius is 12px (RADIUS.lg)`, shape.barRadius === "12px", shape.barRadius);
    check(`${width}px · toolbar buttons are 6px (nestedIn(RADIUS.lg,6) = RADIUS.sm)`, shape.btnRadius === "6px", shape.btnRadius);

    if (SHOTS) await page.screenshot({ path: `${OUT}/w${width}.png` });
    await ctx.close();
  }

  // ── NEW-4a — Enter always works, including before any suggestion arrives ─────
  {
    console.log(`\nNEW-4a — Enter before suggestions arrive`);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-map-toolbar-rebuild:4a");
    let esriCalls = 0;
    await page.route("**://geocode.arcgis.com/**", async (route) => {
      esriCalls++;
      await new Promise((r) => setTimeout(r, 600)); // well past the 250ms debounce
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ location: { x: -95.7, y: 29.8 }, address: "123 Main St" }] }) });
    });
    await page.route("**://nominatim.openstreetmap.org/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await pacedWait(page, 500);
    const input = page.locator('input[role="combobox"]');
    await input.click();
    await input.type("123 Main", { delay: 15 });
    await pacedWait(page, 50);
    await input.press("Enter"); // fired well before the mocked 600ms Esri response, and before the 250ms debounce's OWN fetch could matter
    await pacedWait(page, 150);
    check("Enter fires its own geocode request immediately (doesn't wait on the suggestion fetch)", esriCalls >= 1, `esriCalls=${esriCalls}`);
    await ctx.close();
  }

  // ── NEW-4d — LOUD-FAILURE no-match ────────────────────────────────────────────
  {
    console.log(`\nNEW-4d — a genuine no-match says so`);
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-map-toolbar-rebuild:4d");
    await mockGeocoders(page, { esriCandidates: [], nomResults: [] });
    await page.goto(URL, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".leaflet-container", { timeout: 20000 });
    await pacedWait(page, 500);
    const input = page.locator('input[role="combobox"]');
    await input.click();
    await input.type("zzzznotarealplace", { delay: 12 });
    await pacedWait(page, 700); // 250ms debounce + the mocked round trip
    const listText = await page.evaluate(() => document.querySelector('ul[role="listbox"]')?.innerText || null);
    check("a reached-but-empty result renders \"No matches for …\"", !!listText && listText.includes("No matches for"), listText);
    check("… with a \"Search anyway\" action", !!listText && listText.includes("Search anyway"));
    check("… and a drop-a-pin action", !!listText && /Start blank here|Drop a comp pin here/.test(listText));
    await input.press("ArrowDown"); await input.press("ArrowDown");
    const activeText = await page.evaluate(() => {
      const inp = document.querySelector('input[role="combobox"]');
      const id = inp.getAttribute("aria-activedescendant");
      return id ? document.getElementById(id)?.textContent : null;
    });
    check("keyboard nav (2x ArrowDown) reaches the drop-pin row", /Start blank here|Drop a comp pin here/.test(activeText || ""), activeText);
    if (SHOTS) await page.screenshot({ path: `${OUT}/nomatch.png` });
    await ctx.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  if (SHOTS) { writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2)); console.log(`  screenshots + results → ${OUT}/`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
