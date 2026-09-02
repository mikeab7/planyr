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
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill("West Hardy tract, 3.2 AC, $850,000, closed 3/14/2026");
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}

async function findExecCell(page) {
  const headerCells = await page.locator("th").allTextContents();
  const execColIdx = headerCells.findIndex((t) => t.trim() === "Executed");
  const hb = await page.locator("th").nth(execColIdx).boundingBox();
  const rowTds = page.locator('td[data-cell^="0-"]');
  const n = await rowTds.count();
  for (let i = 0; i < n; i++) {
    const b = await rowTds.nth(i).boundingBox();
    if (b && hb && Math.abs(b.x - hb.x) < 3) return rowTds.nth(i);
  }
  return null;
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
        // B986096-HARDENING-23 — on a single-row grid, Enter's destination clamps back to the SAME
        // cell (nowhere else to move). HARDENING-19 made that reopen the same cell (matching
        // HARDENING-10 NEW-3's "land the next cell in edit mode" for a genuinely different
        // destination); HARDENING-23 found that reopening the SAME cell with the value just typed
        // into it reads as "nothing happened" and closes normally instead, like Tab/Escape do.
        check("Enter commits the value and closes normally (single-row grid, same-cell clamp)",
          (await target.locator("input").count()) === 0 && (await target.innerText()).trim() === "03/14/26",
          `got ${JSON.stringify((await target.innerText()).trim())}, input mounted: ${await target.locator("input").count() > 0}`);
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

  // B848304 — the resting-state "Drop a pin"/"Comp from parcel" pair collapsed into ONE
  // "Place comp" split button; the primary click uses the last-used anchor, defaulting to
  // "On the map" on a fresh session (which every context in this file is), so this is the exact
  // functional equivalent of the old "Drop a pin" click.
  const placeCompBtn = page.getByRole("button", { name: "Place comp", exact: true });
  await placeCompBtn.waitFor({ state: "visible", timeout: 8000 });
  await placeCompBtn.click();
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
    const header = [...document.querySelectorAll("span")].find((s) => s.textContent === "Paste comps");
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
    // B986096-HARDENING-27 (NEW-4) moved Location to be the column right after Type (both frozen,
    // so the row's identity survives a horizontal scroll) — searching for it rather than hardcoding
    // a step count keeps this test correct regardless of exactly how many columns sit between them.
    let selCell = null;
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
      await pacedWait(page, 50);
      selCell = await page.evaluate(() => {
        const td = [...document.querySelectorAll("td[data-cell]")].find((t) => t.style.outline?.includes("2px"));
        return td ? { cell: td.dataset.cell, text: td.textContent } : null;
      });
      if (selCell?.text === "Set") break;
    }
    check("ArrowRight from Type reaches the Location cell", selCell?.text === "Set", `got ${JSON.stringify(selCell)}`);
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

  // Open cell 0-2 (Title/Address — a plain text cell; B986096-HARDENING-27/NEW-4 moved Location,
  // an action cell, into column 1, right after Type, so the plain-text stand-in this check needs
  // is now one column further right), then Escape back to "selected, not editing" — the state
  // roving tabindex actually governs (a single click on an editable cell enters edit mode
  // straight away, per HARDENING-10, and focus correctly lands on the real <input> there; roving
  // tabindex is what makes focus follow a NON-editing selection, e.g. after Escape or on a
  // read-only/na cell, and what makes plain Tab/arrow-key traversal reach a real DOM node).
  await page.locator('td[data-cell="0-2"]').click();
  await pacedWait(page, 200);
  await page.keyboard.press("Escape");
  await pacedWait(page, 200);
  const afterEscape = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, dataCell: el.dataset?.cell, tabIndex: el.tabIndex };
  });
  check("selecting a cell (not editing) gives it real DOM focus, not just the grid container",
    afterEscape.tag === "TD" && afterEscape.dataCell === "0-2" && afterEscape.tabIndex === 0, JSON.stringify(afterEscape));

  await page.keyboard.press("ArrowRight");
  await pacedWait(page, 150);
  const afterArrow = await page.evaluate(() => {
    const el = document.activeElement;
    return { tag: el.tagName, dataCell: el.dataset?.cell };
  });
  check("ArrowRight moves DOM focus to the newly-selected cell", afterArrow.dataCell === "0-3", JSON.stringify(afterArrow));

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
  // Current position is column 3 (Size) — B986096-HARDENING-27/NEW-4 put Location at column 1,
  // to its LEFT now (frozen right after Type), so this searches leftward.
  let onLocation = false;
  for (let i = 0; i < 6 && !onLocation; i++) {
    const el = await page.evaluate(() => {
      const active = document.activeElement;
      return { tag: active.tagName, text: active.textContent };
    });
    if (el.text === "Set") { onLocation = true; break; }
    await page.keyboard.press("ArrowLeft");
    await pacedWait(page, 80);
  }
  const locFocus = await page.evaluate(() => ({ tag: document.activeElement.tagName, text: document.activeElement.textContent }));
  check("arrow-navigating onto the Location cell focuses its real <button>", locFocus.tag === "BUTTON" && locFocus.text === "Set", JSON.stringify(locFocus));
  await ctx.close();
}

console.log("\n=== CYCLE 5 (B986096-HARDENING-15) — Enter commits via a non-bubbling synthetic dispatch; a raw-set value still commits on blur ===");
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h15a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  // Reproduces the owner's own cycle-5 isolation exactly: type via execCommand, then dispatch a
  // NON-bubbling KeyboardEvent (the constructor's own default) directly on the input — the same
  // dispatch that reached React's bubble-phase onKeyDown 0% of the time before HARDENING-15's
  // native, target-attached listener (which fires at AT_TARGET regardless of `bubbles`).
  const target = await findExecCell(page);
  await target.click();
  await pacedWait(page, 250);
  const input = target.locator("input");
  await input.evaluate((el) => { el.focus(); document.execCommand("insertText", false, "1/11/26"); });
  const result = await input.evaluate((el) => {
    let observedByCapture = false;
    const cap = () => { observedByCapture = true; };
    document.addEventListener("keydown", cap, true);
    el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter" })); // bubbles: false, the constructor default
    el.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter" }));
    document.removeEventListener("keydown", cap, true);
    return { observedByCapture, activeIsInput: document.activeElement === el };
  });
  check("a capture-phase listener still observes the non-bubbling dispatch (as it always did)", result.observedByCapture);
  await pacedWait(page, 300);
  // B986096-HARDENING-23 — this fixture is a single-row grid, so Enter's destination clamps back
  // to the SAME cell; HARDENING-23 made that case close normally (not reopen) since there is
  // nothing left to type into the cell that was just committed. The real "was it handled" signal
  // is still the committed VALUE: an unhandled Enter never reformats "1/11/26" into "01/11/26".
  const reopenedCount = await target.locator("input").count();
  check("Enter was actually handled, not just observed upstream — value reformatted to 01/11/26",
    reopenedCount === 0 && (await target.innerText()).trim() === "01/11/26",
    `got ${JSON.stringify((await target.innerText()).trim())}, input still mounted: ${reopenedCount > 0}`);
  check("Enter commits via a non-bubbling synthetic dispatch, then closes normally (same-cell clamp, the exact owner reproduction)",
    reopenedCount === 0, `input still mounted after Enter: ${reopenedCount > 0}`);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h15b" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  // A real click on another cell must still commit an in-progress edit (the reported "click to
  // keep going" data-loss path) — genuine mouse interaction, no synthetic events at all.
  const target = await findExecCell(page);
  await target.click();
  await pacedWait(page, 250);
  const input = target.locator("input");
  await input.selectText().catch(() => {});
  await page.keyboard.type("2/22/26");
  await page.locator('td[data-cell="0-1"]').click();
  await pacedWait(page, 300);
  check("a real click on another cell commits the just-typed value (no silent discard)",
    (await target.innerText()).trim() === "02/22/26", `got ${JSON.stringify((await target.innerText()).trim())}`);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h15c" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  const target = await findExecCell(page);
  await target.click();
  await pacedWait(page, 250);
  const input = target.locator("input");
  await input.evaluate((el) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "4/09/26"); // raw value set, no `input` event dispatched — bypasses React's onChange
  });
  await input.evaluate((el) => el.blur());
  await pacedWait(page, 300);
  check("a raw-set value (no React onChange) still commits correctly on blur",
    (await target.innerText()).trim() === "04/09/26", `got ${JSON.stringify((await target.innerText()).trim())}`);
  await ctx.close();
}

console.log("\n=== CYCLE 6 (B986096-HARDENING-16) — NEW-1 re-investigation: every click-away target + rapid typing, none discard ===");
{
  // The owner's three named click-away targets ("another cell, the map, the panel background")
  // — "another cell" and "the map" were already covered above; the panel HEADER and FOOTER
  // (genuinely non-interactive chrome, no cell, no button, no map underneath) had never been
  // isolated separately. Both commit correctly.
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h16a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  const target = await findExecCell(page);
  await target.click();
  await pacedWait(page, 250);
  const input = target.locator("input");
  await input.selectText().catch(() => {});
  await page.keyboard.type("2/22/26");
  await page.getByText("Paste comps", { exact: true }).click(); // the panel's own header chrome
  await pacedWait(page, 300);
  check("clicking the panel HEADER (non-interactive chrome) commits the just-typed value",
    (await target.innerText()).trim() === "02/22/26", `got ${JSON.stringify((await target.innerText()).trim())}`);
  await ctx.close();
}
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h16b" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);
  const target = await findExecCell(page);
  await target.click();
  await pacedWait(page, 250);
  const input = target.locator("input");
  await input.selectText().catch(() => {});
  await page.keyboard.type("5/17/26");
  const footerMsg = page.locator("text=/comps? ready|missing|need/").first();
  const box = await footerMsg.boundingBox().catch(() => null);
  check("found the footer status text to click near", !!box);
  if (box) await page.mouse.click(box.x > 5 ? box.x - 5 : box.x, box.y);
  await pacedWait(page, 300);
  check("clicking the panel FOOTER background commits the just-typed value",
    (await target.innerText()).trim() === "05/17/26", `got ${JSON.stringify((await target.innerText()).trim())}`);
  await ctx.close();
}
{
  // A fast real typist, zero artificial delay between the last keystroke and the click-away —
  // the one dimension no prior round isolated. 3 trials, each a fresh context.
  let allPassed = true;
  for (let trial = 1; trial <= 3; trial++) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(fixtureSeed(fixture, { id: `p0h16c${trial}` }));
    await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await openEntrySheet(page);
    const target = await findExecCell(page);
    await target.click();
    const input = target.locator("input");
    await input.selectText().catch(() => {});
    await page.keyboard.type(`6/0${trial}/26`, { delay: 0 });
    await page.locator('td[data-cell="0-1"]').click(); // immediately, no wait
    await pacedWait(page, 300);
    const text = (await target.innerText()).trim();
    if (text !== `06/0${trial}/26`) allPassed = false;
    await ctx.close();
  }
  check("rapid type-then-click-away (zero delay), 3 trials, none discard", allPassed);
}

console.log("\n=== CYCLE 7 (B986096-HARDENING-17) — Tab-to-an-editable-destination never misattributes the just-typed value to the wrong cell ===");
{
  // Root-caused via a ground-truth instrumented trace (console logs on beginEdit/finishEdit/
  // onEditKeyDown), not guessed: Tab commits Executed, then (HARDENING-10's "land the next cell
  // in edit mode" feature) immediately calls beginEdit on the destination — which resets the
  // SHARED editingRef/editHandledRef/editValueRef refs for that new session. React then unmounts
  // the old Executed <input>, and the browser fires a native blur on it — but AFTER those refs
  // already point at the new cell. The blur handler's own stale-value safety net (HARDENING-15)
  // then read the OLD input's leftover DOM text and committed it into whatever session the refs
  // NOW pointed at: Price, not Executed. Measured live: typing "7/4/26" into Executed then
  // pressing Tab landed "7,426" on Price while Executed itself reverted to empty. Never
  // reproducible testing a single commit in isolation — it needs the moveDir auto-reopen to land
  // on a DIFFERENT, EDITABLE cell to manifest at all.
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h17a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  const target = await findExecCell(page);
  await target.click();
  await pacedWait(page, 250);
  const input = target.locator("input");
  await input.selectText().catch(() => {});
  await page.keyboard.type("7/4/26");
  await page.keyboard.press("Tab"); // Executed's next visible column for a Land row is Price — editable, so it auto-reopens
  await pacedWait(page, 300);

  const execText = (await target.innerText()).trim();
  check("Tab commits the typed date into the cell that was actually being edited (Executed)",
    execText === "07/04/26", `got ${JSON.stringify(execText)}`);

  const priceCellText = await page.evaluate(() => {
    const headers = [...document.querySelectorAll("thead tr")[1].querySelectorAll("th")];
    const priceIdx = headers.findIndex((h) => h.textContent.trim() === "Price");
    if (priceIdx < 0) return "(Price column not found)";
    const priceHb = headers[priceIdx].getBoundingClientRect();
    const rowTds = [...document.querySelectorAll('td[data-cell^="0-"]')];
    const match = rowTds.find((td) => Math.abs(td.getBoundingClientRect().x - priceHb.x) < 3);
    return match ? match.innerText.trim() : "(cell not found)";
  });
  check("Price (the auto-opened destination cell) stays empty — the typed value did not leak into it",
    priceCellText === "", `got ${JSON.stringify(priceCellText)}`);
  await ctx.close();
}

console.log("\n=== CYCLE 8 (B986096-HARDENING-18, NEW-2) — arming a row for a pin must not hide the parcel alternative ===");
{
  // The owner reported PARCEL anchoring never once completed across 11 live cycles. Root cause:
  // a row's Location button only ever arms PIN mode (CompsPanel's armRow -> onArmMapPin), and the
  // map toolbar's "Comp from parcel" button rendered ONLY when `!placingCompPin` — so the instant
  // a row was armed the way the owner already knew worked for pins, the parcel entry point the
  // panel's own banner promises ("...or click Comp from parcel on the map toolbar...") vanished
  // from the toolbar entirely. This cycle proves it no longer does, and that the armed row survives
  // switching between the two modes (the pendingAnchor effect keys off armedRowId, not off which
  // mode produced the anchor, so whichever pick lands still fills THIS row and never appends).
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: "p0h18a" }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await openEntrySheet(page);

  const locCell = page.locator('td[data-cell^="0-"]').filter({ hasText: "Set" }).first();
  const btn = locCell.locator("button");
  await btn.click();
  await pacedWait(page, 300);
  check("arming the row's Location cell shows the amber banner",
    await page.getByText("Click the map above", { exact: false }).count() > 0);
  check("arming the row shows the pin-armed toolbar hint (\"Click the map to place a comp…\")",
    await page.getByText("Click the map to place a comp", { exact: false }).count() > 0);

  // The panel's own amber banner ALSO contains the words "Comp from parcel" (inside a <strong>,
  // as part of its promise text) — scope to the toolbar's real <button>, not the banner's prose.
  const parcelSwitch = page.getByRole("button", { name: "Comp from parcel" });
  check("⛔ REGRESSION GUARD — \"Comp from parcel\" is REACHABLE on the toolbar while the row is pin-armed (used to vanish entirely)",
    await parcelSwitch.count() > 0);

  await parcelSwitch.click();
  await pacedWait(page, 300);
  check("clicking it switches the toolbar into parcel-select mode",
    await page.getByText("Selecting a parcel for a comp", { exact: false }).count() > 0);
  check("the pin-armed hint is gone now that we're in parcel mode",
    await page.getByText("Click the map to place a comp", { exact: false }).count() === 0);
  check("the row is STILL armed after switching modes (banner still visible)",
    await page.getByText("Click the map above", { exact: false }).count() > 0);

  const pinSwitch = page.getByRole("button", { name: "Drop a pin" });
  check("the symmetric switch back to \"Drop a pin\" is offered from parcel-select mode",
    await pinSwitch.count() > 0);
  await pinSwitch.click();
  await pacedWait(page, 300);
  check("switching back to pin mode restores the pin-armed hint",
    await page.getByText("Click the map to place a comp", { exact: false }).count() > 0);
  check("the row is STILL armed after switching back (banner still visible)",
    await page.getByText("Click the map above", { exact: false }).count() > 0);
  check("row count never changed across either mode switch (no orphan rows)", (await rowCount(page)) === 1);

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
