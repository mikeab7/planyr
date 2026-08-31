/* B900416 — Site Planner tool-rail redesign (NEW-1 in the owner's brief), live headless verify.
 * ATTEMPT-BEFORE-YOU-PARK: every one of these is checkable logged-out on a blank site, so this
 * drives the real app instead of filing a V###.
 *
 * Checks, one per line item in the brief:
 *   1. rail WIDTH unchanged (168px) — VIEWPORT-STABLE, no canvas shift
 *   2. every row is SHORTER than the pre-fix padding would have produced
 *   3. exactly one hairline divider between each pair of GROUPS, none inside a group/dropdown
 *   4. "Select multiple" label, M still selects it
 *   5. no Pan row; both Space-drag and empty-canvas panning still pan
 *   6. one Parking row whose caret offers Car and Trailer, both behaviours unchanged
 *   7. hover warms the icon (accent) and darkens the shortcut letter (chrome-text), no geometry move
 *   8. "Markup" group heading (was "Draw")
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let failed = false;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failed = true; };

const site = {
  id: "rail-redesign-demo", groupId: "rail-redesign-demo", site: "Rail Redesign Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els: [{ id: "e1", type: "building", cx: -200, cy: -40, w: 160, h: 100, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-rail-redesign");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2500);

const svg = await page.$("svg[aria-label='Site plan canvas']");
check("planner canvas rendered", !!svg);
if (!svg) { await browser.close(); process.exit(1); }

/* ── 1/2. Rail width unchanged; rows shorter; VIEWPORT-STABLE (no canvas shift) ───────────────── */
// The rail is the .dark-scroll column hosting the "Select" row — locate it via the row itself.
// (The row's accessible name is "Select V" — the trailing shortcut-letter span is real text.)
const selectBtn = page.getByRole("button", { name: /^Select\b/ }).first();
const railEl = selectBtn.locator("xpath=ancestor::div[contains(@class,'dark-scroll')]");
const railWidth = await railEl.evaluate((el) => Math.round(el.getBoundingClientRect().width));
check("rail width unchanged (168px)", railWidth === 168, `measured ${railWidth}px`);

const selectRowH = await selectBtn.evaluate((el) => Math.round(el.getBoundingClientRect().height));
check("row height shorter than the old 8px-vertical-padding row (< 30px)", selectRowH < 30, `measured ${selectRowH}px`);

const canvasBoxBefore = await svg.boundingBox();
// Reflow the rail (open then close a dropdown) and re-measure the canvas/svg screen box — a rail
// whose WIDTH never changes should never move the drawing under it.
// Dismiss via the AnchoredMenu's own click-away backdrop (a fixed viewport corner, never Escape —
// SitePlanner's own window keydown handler and AnchoredMenu's each own an Escape listener, and
// racing them is a false lead; the backdrop click is the one unambiguous close affordance).
const dismissMenu = () => page.mouse.click(5, 5);
await page.getByRole("button", { name: "Parking type" }).click();
await page.waitForTimeout(150);
await dismissMenu();
await page.waitForTimeout(150);
const canvasBoxAfter = await svg.boundingBox();
check("VIEWPORT-STABLE — canvas box unchanged across a rail interaction", canvasBoxBefore.x === canvasBoxAfter.x && canvasBoxBefore.width === canvasBoxAfter.width,
  `${JSON.stringify(canvasBoxBefore)} → ${JSON.stringify(canvasBoxAfter)}`);

/* ── 3. Dividers between groups only ───────────────────────────────────────────────────────────── */
const dividerCount = await page.locator("[data-rail-divider]").count();
check("exactly 3 group dividers (between 4 groups)", dividerCount === 3, `found ${dividerCount}`);
// None inside the Parcel Tools dropdown menu.
const parcelToolsBtn = page.locator('[data-testid="rail-parcel-tools"]');
await parcelToolsBtn.click();
await page.waitForTimeout(150);
const dividersInParcelMenu = await page.locator('.menu [data-rail-divider]').count();
await dismissMenu();
await page.waitForTimeout(150);
check("no divider line inside the Parcel Tools dropdown", dividersInParcelMenu === 0, `found ${dividersInParcelMenu}`);

/* ── 4. "Select multiple" label, M still selects it ────────────────────────────────────────────── */
const marqueeBtn = page.locator('[data-testid="tool-marquee"]');
const marqueeText = (await marqueeBtn.textContent()).trim();
check('marquee row reads "Select multiple"', marqueeText.includes("Select multiple") && !marqueeText.includes("Marquee"), marqueeText);
await page.keyboard.press("m");
await page.waitForTimeout(100);
const marqueeOn = await marqueeBtn.evaluate((el) => el.className.includes(" on") || el.getAttribute("aria-pressed") === "true");
check("M still selects Select-multiple (marquee)", marqueeOn);
await page.keyboard.press("v"); // back to Select for the rest of the checks
await page.waitForTimeout(100);

/* ── 5. No Pan row; Space-drag and empty-canvas panning both still work ────────────────────────── */
const panRowCount = await page.getByRole("button", { name: /^Pan$/ }).count();
check("no Pan row on the rail", panRowCount === 0);

const box = await svg.boundingBox();
const emptyX = box.x + box.width * 0.5, emptyY = box.y + box.height * 0.85; // away from the seeded building
// Simplest robust "did the view pan" signal: the rendered building's screen position moves.
const buildingScreenX = async () => { const b = await page.locator('[data-el-id="e1"]').first().boundingBox().catch(() => null); return b ? b.x : null; };

const beforeEmpty = await buildingScreenX();
await page.mouse.move(emptyX, emptyY);
await page.mouse.down();
await page.mouse.move(emptyX - 80, emptyY - 40, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
const afterEmpty = await buildingScreenX();
check("empty-canvas drag under Select still pans (building moved on screen)", beforeEmpty != null && afterEmpty != null && Math.abs(afterEmpty - beforeEmpty) > 20,
  `${beforeEmpty} → ${afterEmpty}`);

const buildingBoxNow = await page.locator('[data-el-id="e1"]').first().boundingBox();
const onBuildingX = buildingBoxNow.x + buildingBoxNow.width / 2, onBuildingY = buildingBoxNow.y + buildingBoxNow.height / 2;
const beforeSpace = await buildingScreenX();
await page.keyboard.down("Space");
await page.mouse.move(onBuildingX, onBuildingY);
await page.mouse.down();
await page.mouse.move(onBuildingX + 80, onBuildingY + 40, { steps: 6 });
await page.mouse.up();
await page.keyboard.up("Space");
await page.waitForTimeout(150);
const afterSpace = await buildingScreenX();
check("Space-drag pans even starting ON the building (no selection, no move)", beforeSpace != null && afterSpace != null && Math.abs(afterSpace - beforeSpace) > 20,
  `${beforeSpace} → ${afterSpace}`);
const selAfterSpacePan = await page.evaluate(() => document.querySelectorAll('[data-el-id="e1"].sel, [data-el-id="e1"][data-selected="1"]').length);
check("Space-drag over the building did not select it", selAfterSpacePan === 0);

/* ── 6. Merged Parking row: caret offers Car + Trailer, both draw correctly ────────────────────── */
const parkingBtn = page.getByRole("button", { name: /^Parking$/ });
check("one merged Parking row exists", (await parkingBtn.count()) === 1);
check("no separate Car Parking / Trailer Parking rows", (await page.getByRole("button", { name: "Car Parking" }).count()) === 0
  && (await page.getByRole("button", { name: "Trailer Parking" }).count()) === 0);

await page.getByRole("button", { name: "Parking type" }).click();
await page.waitForTimeout(150);
const menuText = await page.locator('[role="menu"], .menu').last().textContent().catch(() => "");
check('caret dropdown offers "Car parking" and "Trailer parking"', /Car parking/i.test(menuText) && /Trailer parking/i.test(menuText), menuText);
// Draw a trailer via the dropdown sub-option.
await page.getByRole("button", { name: "Trailer parking", exact: true }).click();
const trailerBox = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.15 };
await page.mouse.move(trailerBox.x, trailerBox.y);
await page.mouse.down();
await page.mouse.move(trailerBox.x + 120, trailerBox.y + 80, { steps: 6 });
await page.mouse.up();
const trailerCount = await page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = map[Object.keys(map)[0]] || {};
  return (s.els || []).filter((e) => e.type === "trailer").length;
});
check("Trailer parking sub-option still draws a trailer element", trailerCount >= 1, `count=${trailerCount}`);
await page.keyboard.press("v");
await page.waitForTimeout(100);

// Row body now arms the last choice (trailer) directly.
await page.getByRole("button", { name: /^Parking$/ }).click();
const armedTool = await page.evaluate(() => window.__plannerTool || null).catch(() => null);
// Fall back to reading aria-pressed if no debug hook exists.
const trailerArmedViaAria = await page.locator('[title="Trailer Parking"]').first().getAttribute("aria-pressed").catch(() => null);
check("row body remembers last choice (armed Trailer directly)", trailerArmedViaAria === "true" || armedTool === "trailer", `aria-pressed=${trailerArmedViaAria} tool=${armedTool}`);
await page.keyboard.press("v");
await page.waitForTimeout(100);

/* ── 8. "Markup" group heading ──────────────────────────────────────────────────────────────────── */
const headings = await page.evaluate(() => [...document.querySelectorAll(".dark-scroll > div")].map((d) => d.textContent.trim()).filter((t) => t && t.length < 20));
check('group heading reads "Markup" (was "Draw")', headings.some((h) => /^Markup$/i.test(h)), JSON.stringify(headings));
check('no leftover "Draw" heading', !headings.some((h) => /^Draw$/i.test(h)));

/* ── 7. Hover: icon → accent, hint → chrome-text; no geometry change ──────────────────────────── */
const textBtn = page.getByRole("button", { name: /^Text/ });
const boxBefore = await textBtn.boundingBox();
const iconColorBefore = await textBtn.locator(".rbtn-icon").evaluate((el) => getComputedStyle(el).color);
const hintColorBefore = await textBtn.locator(".rbtn-hint").evaluate((el) => getComputedStyle(el).color);
await textBtn.hover();
await page.waitForTimeout(120);
const boxAfter = await textBtn.boundingBox();
const iconColorAfter = await textBtn.locator(".rbtn-icon").evaluate((el) => getComputedStyle(el).color);
const hintColorAfter = await textBtn.locator(".rbtn-hint").evaluate((el) => getComputedStyle(el).color);
check("hover: icon colour changes (warms to accent)", iconColorBefore !== iconColorAfter, `${iconColorBefore} → ${iconColorAfter}`);
check("hover: shortcut-letter colour changes (lifts to ink)", hintColorBefore !== hintColorAfter, `${hintColorBefore} → ${hintColorAfter}`);
check("hover: no geometry change (position/size identical)", boxBefore.x === boxAfter.x && boxBefore.y === boxAfter.y && boxBefore.width === boxAfter.width && boxBefore.height === boxAfter.height,
  `${JSON.stringify(boxBefore)} → ${JSON.stringify(boxAfter)}`);

await browser.close();
console.log(failed ? "\n✗ FAIL — see above" : "\n✓ ALL PASS");
process.exit(failed ? 1 : 0);
