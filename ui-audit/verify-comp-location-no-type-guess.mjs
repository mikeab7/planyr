#!/usr/bin/env node
/* verify-comp-location-no-type-guess — B1149586 (owner report, 2026-09-04): "I typed in an
 * address and it might have assumed a land comp from that, which it shouldn't."
 *
 * ROOT CAUSE, found by reading rather than by reproducing the owner's own path (he explicitly
 * said he had not reproduced it himself and ruled out the paste sheet — pasting a bare address
 * there already produces Type BLANK). `comps.js`'s `emptyDraft(anchor)` hardcoded
 * `compType: "land"` unconditionally. `CompsPanel.jsx`'s `pendingAnchor` effect calls exactly
 * that — `emptyDraft(pendingAnchor)` — the moment a location is picked with NOTHING already
 * armed and NOTHING already open waiting for one: a fresh map pin drop (the toolbar's
 * "Place comp" button), a parcel select, or a site-plan pin, with the Comps sheet closed or
 * every existing row already located. That is the one path in this codebase where a location
 * alone, with zero deal terms typed anywhere, silently became a Land comp.
 *
 * This is the ONE scenario none of this module's existing ui-audit coverage exercises:
 * `verify-comp-entry-p0.mjs` and `verify-place-comp-split-button.mjs` both always seed a row via
 * the paste textarea FIRST (their own comments say why — "the append bug never shows on the
 * first row"), so every map-click check they run goes through the FILL-EXISTING-ROW branch, never
 * the APPEND-A-NEW-ROW branch this bug lives in. This script drives that branch specifically:
 * grid closed, nothing armed, a bare map click, then reads the freshly appended row's own Type
 * cell.
 *
 * No fixture needed — MapFinder is the default landing screen for a session with no open plan
 * (same as verify-place-comp-split-button.mjs), and the anchor/county lookup already races its
 * own offline timeout with no live GIS required to observe the DRAFT's Type value.
 *
 *   npm run dev -- --port 4319   (in another terminal)
 *   node ui-audit/verify-comp-location-no-type-guess.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };
const report = (label, text) => console.log(`  ▸ ${label}: ${JSON.stringify(text)}`);

async function rowCount(page) {
  return page.evaluate(() => {
    const cells = [...document.querySelectorAll("td[data-cell]")];
    return new Set(cells.map((c) => c.dataset.cell.split("-")[0])).size;
  });
}

const browser = await chromium.launch({ executablePath: EXEC, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-comp-location-no-type-guess");
await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
await page.waitForSelector(".leaflet-container", { timeout: 20000 });
await pacedWait(page, 800);

console.log("\n=== Arm Comp mode, but leave the paste sheet CLOSED — nothing armed, nothing open ===");
await page.locator('div[role="tablist"][aria-label="What an address search creates"] button', { hasText: "Comp" }).click();
await pacedWait(page, 150);
await page.getByRole("tab", { name: /^Comps/ }).first().click();
await pacedWait(page, 200);
check("the paste sheet is genuinely NOT open (no textarea on screen)", (await page.locator("textarea").count()) === 0);
check("no rows exist yet", (await rowCount(page)) === 0);

console.log("\n=== Click Place comp, click the map — the FIRST comp, nothing typed anywhere ===");
{
  const btn = page.getByRole("button", { name: "Place comp", exact: true });
  await btn.waitFor({ state: "visible", timeout: 8000 });
  await btn.click();
  await pacedWait(page, 150);
  check('toolbar shows "Click the map to place a comp…" once armed',
    (await page.getByText("Click the map to place a comp", { exact: false }).count()) > 0);

  const mapBox = await page.locator(".leaflet-container").first().boundingBox();
  check("found the Leaflet map container", !!mapBox);
  if (mapBox) {
    await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + 150);
    await pacedWait(page, 3500); // resolveCompCounty races its own 3s offline timeout — no live GIS needed
  }

  check("a bare map click appended exactly ONE new row (the append branch, not the fill branch)", (await rowCount(page)) === 1);

  const typeCell = page.locator('td[data-cell="0-0"]');
  // The resting select-kind cell renders its VALUE in an inner <span>, plus a decorative,
  // aria-hidden "▾" caret span alongside it (CompEntryGrid.jsx) — read the value span alone so a
  // cosmetic caret glyph (present at rest regardless of whether a value was chosen) can't be
  // mistaken for real cell content.
  const typeText = (await typeCell.locator("span span").first().innerText()).trim();
  report("row 0's Type cell VALUE text, resting (no edit open, caret excluded)", typeText);
  check("⛔ THE REGRESSION THIS SCRIPT GUARDS — Type is NOT pre-guessed as \"Land\" from a bare location pick",
    typeText !== "Land", `got ${JSON.stringify(typeText)}`);
  check("Type reads genuinely blank — a location alone implies nothing", typeText === "", `got ${JSON.stringify(typeText)}`);

  const saveBtn = page.getByRole("button", { name: /^Save/ });
  const saveDisabled = await saveBtn.isDisabled().catch(() => null);
  check("Save stays disabled until a real Type is chosen (validateComp still requires one)", saveDisabled === true);
}

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exitCode = failed.length ? 1 : 0;
