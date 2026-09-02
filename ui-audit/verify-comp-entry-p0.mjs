#!/usr/bin/env node
/* verify-comp-entry-p0 — B986096-HARDENING-12: the owner drove the just-shipped comp entry sheet
 * end to end for the FIRST time (bundle index-Bj2Z52Ae.js) and found a comp could not be saved at
 * all, despite every prior round passing its own sandbox checks. Four findings, all fixed in this
 * pass; this harness re-proves all four against a real Chromium session so a future regression on
 * ANY of them goes red here instead of waiting for the next live pass.
 *
 * ⛔ BLOCKER 1 — the Location cell was a bare `<span>` in a `<td>`, with no button, no role, no
 * tabindex, and arming the map-pick flow required a DOUBLE click with no visible affordance saying
 * so — the owner clicked it four times across two page loads and nothing happened. It is now a
 * real `<button>` (CompEntryGrid.jsx's SheetCell) that arms on the FIRST click.
 *
 * ⛔ BLOCKER 2 — the map toolbar's "Drop a pin"/"Comp from parcel" buttons are a SEPARATE arm
 * mechanism from a row's own Location cell (`armedRowId`), so picking a location via the toolbar
 * while a pasted row still needed one always APPENDED A NEW ORPHAN ROW instead of answering the
 * one already waiting — three toolbar picks left three unsaveable rows. `CompsPanel.jsx`'s
 * `pendingAnchor` effect now fills the topmost row missing a location before ever appending.
 *
 * ⛔ BLOCKER 3 — the real defect underneath "Enter does not commit an edit, Tab does." A `<td>`'s
 * content is not natively focusable, so an un-prevented mousedown let the BROWSER'S OWN default
 * focus-clearing action run immediately after `beginEdit` moved focus to the freshly-mounted
 * `<input>` — the input's own `onBlur` fired `finishEdit` and closed the edit inside the same
 * click, before any typed character could land. This is invisible to `document.activeElement`
 * read after a `waitForTimeout` long enough for the blur to settle, which is exactly why it read
 * as "Enter discards, Tab commits" rather than "the input never really stuck around at all" — Tab
 * moved focus natively regardless, so its OWN blur-commit looked like success. Fixed with a plain
 * `e.preventDefault()` on the cell's mousedown (CompEntryGrid.jsx) — the standard fix for exactly
 * this class of click-to-edit grid bug.
 *
 * DOCKING — the entry panel floated near the TOP of the viewport at up to 88% of its height,
 * covering 72% of the map on the owner's own 1191×521 measurement, all of it the TOP — the exact
 * area "arm a row, then click the map" needs. It now DOCKS to the bottom edge with a resizable,
 * remembered height, so the map above it stays clickable regardless of panel height.
 *
 * Drives a real, unmocked Chromium session against a fixture-seeded local plan — signed out, no
 * network needed for any of the four checks (resolveCompCounty's GIS lookup races an internal 3s
 * timeout and degrades to a null county with no network at all, which is fine for this check).
 *
 *   node ui-audit/verify-comp-entry-p0.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function rowCount(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll("td[data-cell]")];
    return new Set(cells.map((c) => c.dataset.cell.split("-")[0])).size;
  });
}

async function openEntrySheet(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-p0");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ New comps", { exact: true }).click();
  await pacedWait(page, 300);
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill("West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const fixture = readFixture("bain");

console.log("=== BLOCKER 1 + Escape — Location is a real button, arms on ONE click ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h12a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  const locCell = page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).first();
  check("Location cell reads 'Set' before any pick", await locCell.count() > 0);
  const hasButton = await locCell.evaluate((td) => !!td.querySelector("button"));
  check("Location cell contains a real <button>", hasButton);

  const btn = locCell.locator("button");
  await btn.click();
  await pacedWait(page, 300);
  check("single click arms the row (the amber banner appears)", await page.getByText("Click the map above", { exact: false }).count() > 0);
  const focused = await btn.evaluate((el) => document.activeElement === el);
  check("clicking Location gives the button real DOM focus", focused);

  await page.keyboard.press("Escape");
  await pacedWait(page, 300);
  check("Escape disarms the row (the banner disappears)", await page.getByText("Click the map above", { exact: false }).count() === 0);
  await ctx.close();
}

console.log("\n=== BLOCKER 3 — Enter commits a date-cell edit ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h12b" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  const headerCells = await page.locator("th").allTextContents();
  const execColIdx = headerCells.findIndex((t) => t.trim() === "Executed");
  check("found the 'Executed' column header", execColIdx >= 0);
  if (execColIdx >= 0) {
    const hb = await page.locator("th").nth(execColIdx).boundingBox();
    const rowTds = page.locator('td[data-cell^="0-"]');
    const n = await rowTds.count();
    let target = null;
    for (let i = 0; i < n; i++) {
      const b = await rowTds.nth(i).boundingBox();
      if (b && hb && Math.abs(b.x - hb.x) < 3) { target = rowTds.nth(i); break; }
    }
    check("located the Executed cell in row 0", !!target);
    if (target) {
      await target.click();
      await pacedWait(page, 250);
      const input = target.locator("input");
      check("a click on the Executed cell opens a real, PERSISTING <input>", await input.count() > 0);
      if (await input.count()) {
        await input.selectText().catch(() => {});
        await page.keyboard.type("3/14/26"); // real trusted keystrokes — never a synthetic dispatched event
        check("typed text lands in the input before Enter", (await input.inputValue()) === "3/14/26");
        await page.keyboard.press("Enter");
        await pacedWait(page, 300);
        check("Enter commits the value (cell shows 03/14/26, not empty)", (await target.innerText()).trim() === "03/14/26");
      }
    }
  }
  await ctx.close();
}

console.log("\n=== BLOCKER 2 — the toolbar pin fills the open row, never appends a duplicate ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h12c" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  check("exactly 1 row before the toolbar pick", (await rowCount(page)) === 1);
  check("Location still 'Set' (genuinely unarmed) before the pick",
    await page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).count() > 0);

  const dropPinBtn = page.getByText("Drop a pin", { exact: true });
  await dropPinBtn.waitFor({ state: "visible", timeout: 8000 });
  await dropPinBtn.click();
  await pacedWait(page, 300);

  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  check("found the Leaflet map container", !!mapBox);
  if (mapBox) {
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + 150);
    // resolveCompCounty races a 3s timeout when GIS is unreachable (this fixture is offline).
    await pacedWait(page, 3500);
  }
  check("row count is STILL 1 after the pick — no orphan row appended", (await rowCount(page)) === 1);
  check("the EXISTING row's Location was filled (no longer 'Set')",
    await page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).count() === 0);
  await ctx.close();
}

console.log("\n=== DOCKING — the panel sits at the bottom; the map above it stays clickable ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h12d" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  const rects = await page.evaluate(() => {
    const header = [...document.querySelectorAll("span")].find((s) => s.textContent === "New comps");
    let node = header, fixedWrap = null;
    while (node) { if (getComputedStyle(node).position === "fixed") { fixedWrap = node; break; } node = node.parentElement; }
    const leaflet = document.querySelector(".leaflet-container");
    const pr = fixedWrap ? fixedWrap.getBoundingClientRect() : null;
    const mr = leaflet ? leaflet.getBoundingClientRect() : null;
    return {
      panel: pr ? { y: pr.y, bottom: pr.bottom } : null,
      map: mr ? { y: mr.y } : null,
      winH: window.innerHeight,
    };
  });
  check("found the panel's fixed-position wrapper and the map", !!(rects.panel && rects.map));
  if (rects.panel && rects.map) {
    check("panel sits at the BOTTOM of the viewport (not the top)",
      Math.abs(rects.panel.bottom - rects.winH) < 20 && rects.panel.y > rects.map.y + 100,
      `panel.y=${rects.panel.y} panel.bottom=${rects.panel.bottom} winH=${rects.winH}`);
    check("a real strip of map (>300px) is clickable above the panel", rects.panel.y > 300, `clickable=${rects.panel.y}px`);
  }
  await ctx.close();
}

console.log("\n=== CYCLE 2 (B986096-HARDENING-13) — Type reactivity + one-click map arming ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h13a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  // FINDING 1 — a select cell commits the instant its value changes (never waits for a
  // subsequent blur/Tab, which can itself get swallowed by the still-open native picker) so the
  // reactive column set (already correct — this was never a memo bug) actually sees the new Type.
  const typeCell = page.locator('td[data-cell="0-0"]');
  await typeCell.click();
  await pacedWait(page, 200);
  await typeCell.locator("select").selectOption("lease");
  await pacedWait(page, 300); // deliberately NO Tab / click-away — onSelectEditChange must commit alone
  const stillEditing = await typeCell.locator("select").count();
  check("Type cell exits edit mode on its own (select commits on change, no blur needed)", stillEditing === 0);
  const headers = await page.locator("th").allTextContents();
  const wantLease = ["Term (mo)", "Rate", "Per", "Basis", "TI ($/SF)"];
  check("switching to Lease immediately rebuilds the column set (Rate/Per/Basis/Term/TI appear)",
    wantLease.every((w) => headers.some((h) => h.trim() === w)), `headers=${JSON.stringify(headers.filter((h) => h.trim()))}`);

  // The SYMMETRIC direction — Lease back to Land — since the owner's own report found it broken
  // both ways ("typeBefore lease -> typeAfter land, headers unchanged"). onSelectEditChange fixes
  // both by construction (it commits on ANY change, direction-agnostic), but that's a claim worth
  // proving rather than assuming.
  await typeCell.click();
  await pacedWait(page, 200);
  await typeCell.locator("select").selectOption("land");
  await pacedWait(page, 300);
  const headersBackToLand = (await page.locator("th").allTextContents()).filter((h) => h.trim());
  check("switching BACK to Land immediately drops the lease columns (Rate gone, Price back)",
    !headersBackToLand.includes("Rate") && headersBackToLand.includes("Price"), `headers=${JSON.stringify(headersBackToLand)}`);
  // Re-arm Lease for the rest of this block, which expects a lease row.
  await typeCell.click();
  await pacedWait(page, 200);
  await typeCell.locator("select").selectOption("lease");
  await pacedWait(page, 300);

  // FINDING 2's fix — clicking Location alone (no separate "Drop a pin" toolbar click) is enough;
  // it arms the map's own pin-drop mode too.
  const locCell = page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).first();
  check("Location cell still reads 'Set' before the click", await locCell.count() > 0);
  await locCell.locator("button").click();
  await pacedWait(page, 300);
  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  check("found the Leaflet map container", !!mapBox);
  if (mapBox) {
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + 150);
    await pacedWait(page, 3500); // resolveCompCounty's 3s offline-timeout race
  }
  check("Location filled from Location-click + map-click alone — no separate toolbar arm needed",
    await page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).count() === 0);
  const rowCountFinal = await rowCount(page);
  check("row count still 1 after the full lease-comp flow", rowCountFinal === 1, `got ${rowCountFinal}`);
  const saveBtn = page.getByRole("button", { name: /^Save/ });
  const saveDisabled = await saveBtn.isDisabled().catch(() => null);
  check("Save button is enabled once the row is genuinely ready", saveDisabled === false);
  await ctx.close();
}

console.log("\n=== KEYBOARD-ONLY PATH — Tab into the grid, arrow to Location, Enter arms it ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h13b" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  // From the paste textarea: Tab past "Show pasted text" and one more stop to reach the grid
  // itself (a real `role="grid"` div, tabIndex 0) — no mouse click anywhere in this block.
  let reachedGrid = false;
  for (let i = 0; i < 6 && !reachedGrid; i++) {
    await page.keyboard.press("Tab");
    await pacedWait(page, 80);
    const role = await page.evaluate(() => document.activeElement.getAttribute("role"));
    if (role === "grid") reachedGrid = true;
  }
  check("the grid itself is reachable via plain Tab (no click needed to start)", reachedGrid);
  if (reachedGrid) {
    for (let i = 0; i < 4; i++) { await page.keyboard.press("ArrowRight"); await pacedWait(page, 50); }
    const selCell = await page.evaluate(() => {
      const td = [...document.querySelectorAll("td[data-cell]")].find((t) => t.style.outline?.includes("2px"));
      return td ? { cell: td.dataset.cell, text: td.textContent } : null;
    });
    check("4 ArrowRight from Type lands on the Location cell", selCell?.text === "Set", `got ${JSON.stringify(selCell)}`);
    await page.keyboard.press("Enter");
    await pacedWait(page, 300);
    check("Enter on the selected Location cell arms it (keyboard-only, no mouse)",
      await page.getByText("Click the map above", { exact: false }).count() > 0);
  }
  await ctx.close();
}

console.log("\n=== CYCLE 4 (B986096-HARDENING-14) — roving tabindex: every cell is a real focus stop ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h14a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  // Open cell 0-1 (a plain text cell), then Escape back to "selected, not editing" — the state
  // roving tabindex actually governs (a single click on an editable cell enters edit mode
  // straight away, per HARDENING-10, and focus correctly lands on the real <input> there; roving
  // tabindex is what makes focus follow a NON-editing selection, e.g. after Escape or on a
  // read-only/na cell, and what makes plain Tab/arrow-key traversal reach a real DOM node).
  await page.locator('td[data-cell="0-1"]').click();
  await pacedWait(page, 200);
  await page.keyboard.press("Escape");
  await pacedWait(page, 200);
  const afterEscape = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, dataCell: el.dataset?.cell, tabIndex: el.tabIndex };
  });
  check("selecting a cell (not editing) gives it real DOM focus, not just the grid container",
    afterEscape.tag === "TD" && afterEscape.dataCell === "0-1" && afterEscape.tabIndex === 0, JSON.stringify(afterEscape));

  await page.keyboard.press("ArrowRight");
  await pacedWait(page, 150);
  const afterArrow = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, dataCell: el.dataset?.cell };
  });
  check("ArrowRight moves DOM focus to the newly-selected cell", afterArrow.dataCell === "0-2", JSON.stringify(afterArrow));

  const rovingCount = await page.evaluate(() => {
    const focusable = document.querySelectorAll('[role="grid"] [tabindex], [role="grid"] button, [role="grid"] input, [role="grid"] select');
    const tabIndex0 = [...document.querySelectorAll('[role="grid"] [tabindex]')].filter((el) => el.tabIndex === 0);
    return { totalFocusable: focusable.length, tabIndex0Count: tabIndex0.length };
  });
  check("the grid carries many real focusable/tabindexed elements, not 1-2",
    rovingCount.totalFocusable > 10, `totalFocusable=${rovingCount.totalFocusable}`);
  check("exactly ONE cell is a real Tab stop at a time (roving tabindex, not every cell a stop)",
    rovingCount.tabIndex0Count === 1, `tabIndex0Count=${rovingCount.tabIndex0Count}`);

  // Arrow-navigate to the Location action cell and confirm DOM focus lands on the real <button>.
  let onLocation = false;
  for (let i = 0; i < 6 && !onLocation; i++) {
    const el = await page.evaluate(() => {
      const active = document.activeElement;
      return { tag: active.tagName, text: active.textContent };
    });
    if (el.text === "Set") { onLocation = true; break; }
    await page.keyboard.press("ArrowRight");
    await pacedWait(page, 80);
  }
  const locFocus = await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent }));
  check("arrow-navigating onto the Location cell focuses its real <button>", locFocus.tag === "BUTTON" && locFocus.text === "Set", JSON.stringify(locFocus));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
