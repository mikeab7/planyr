#!/usr/bin/env node
/* verify-comp-entry-placement-clip — B850016 (NEW-9) / B850017 (NEW-10), owner chat block
 * 2026-09-03, reproduced live on deployed build `80c78cc` at viewport 1191x521:
 *
 *   NEW-9  — clicking a pasted row's Location "Set" armed placement mode, but the "Paste comps"
 *     panel stayed at full size and covered ~71% of the map at that viewport — the user was told
 *     to click a map the panel itself was sitting on top of, and a comp could never be saved.
 *     Fixed by collapsing the panel to a slim bottom banner (mirroring
 *     CompEntryMobileSheet's own `minimized`) for the duration of placement, restoring it with
 *     every row and edit intact once a pick lands or the user cancels/presses Escape.
 *   NEW-10 — the fixed-vocabulary select cells (Type/Unit/Per/Basis) had ZERO slack against their
 *     own longest option ("Bldg sale", "GROSS") and clipped outright; the derived `$/SF/yr`
 *     column clipped even in the ordinary case; the free-text Landlord/Tenant columns got
 *     squeezed to their floor with no room for a real name. Fixed by widening the select/derived
 *     columns to their measured worst-case need (`lib/compSheetColumns.js`) and raising the
 *     flex-column floor, plus a hover-title fallback on the columns still allowed to clip under
 *     genuine space pressure.
 *
 * Run against a local dev server (signed out, fixture-seeded, no network egress — same shape as
 * verify-comp-entry-b844400.mjs / verify-comp-entry-defects-0902.mjs):
 *   node ui-audit/verify-comp-entry-placement-clip.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const SHOT_DIR = "ui-audit/.artifacts/comp-entry-placement-clip";
if (SHOTS) mkdirSync(SHOT_DIR, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function newCtx(browser, viewport, id) {
  const fixture = readFixture("bain");
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id }));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  return ctx;
}
async function openEntrySheet(page) {
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-entry-placement-clip");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
}
async function pasteViaTextarea(page, text) {
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}
async function panelGeom(page) {
  return page.evaluate(() => {
    const panel = document.querySelector("[data-comp-entry-panel]");
    if (!panel) return null;
    const r = panel.getBoundingClientRect();
    return {
      minimized: panel.getAttribute("data-comp-entry-minimized") === "1",
      top: r.top, height: r.height, coveredFraction: r.height / window.innerHeight,
    };
  });
}
async function setSelectCell(page, colIdx, value) {
  const cell = page.locator(`td[data-cell="0-${colIdx}"]`);
  await cell.click();
  await pacedWait(page, 150);
  await cell.locator("select").selectOption(value);
  await pacedWait(page, 150);
  await page.keyboard.press("Escape");
  await pacedWait(page, 150);
}
async function cellClipInfo(page, colIdx) {
  return page.evaluate((ci) => {
    const td = document.querySelector(`[data-comp-entry-panel] td[data-cell="0-${ci}"]`);
    if (!td) return null;
    const outer = td.querySelector("span");
    const nested = outer ? outer.querySelector("span") : null;
    const target = nested || outer;
    if (!target) return null;
    return { scrollW: target.scrollWidth, clientW: target.clientWidth, text: td.textContent.trim() };
  }, colIdx);
}
function notClipped(info) { return info && info.scrollW <= info.clientW + 0.5; }

const browser = await chromium.launch({ executablePath: EXEC, headless: true });

console.log("=== NEW-9 — arming Location 'Set' minimizes the panel instead of covering the map ===");
{
  const ctx = await newCtx(browser, { width: 1191, height: 521 }, "new9-minimize");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "Sugarbun Way industrial, 25,000 SF lease, $8.04/SF/mo NNN, 5 yr term, executed 1/15/2026");

  const before = await panelGeom(page);
  check("before arming, the panel is at its normal (large) size", before.height > 100, `height=${before.height}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/before-arm.png` });

  await page.locator('td[data-cell="0-1"] button').click(); // the Location cell's "Set" button
  await pacedWait(page, 300);
  const armed = await panelGeom(page);
  check("arming Location minimizes the panel", armed.minimized === true, JSON.stringify(armed));
  check("minimized, the panel covers well under half the viewport (was 71% pre-fix)", armed.coveredFraction < 0.25, `coveredFraction=${armed.coveredFraction}`);
  const bannerVisible = await page.getByText("Click the map to place a comp").isVisible().catch(() => false);
  check("the map's own 'Click the map to place a comp…' banner is now visible (was hidden behind the panel)", bannerVisible);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/armed-minimized.png` });

  // "Comp from parcel" must be reachable from the minimized state too, and clicking it must not
  // re-expand the panel over the map (the same trap, from a second entry point).
  const parcelBtnVisible = await page.getByText("Comp from parcel", { exact: true }).isVisible().catch(() => false);
  check("'Comp from parcel' is reachable while armed and minimized", parcelBtnVisible);
  await page.getByText("Comp from parcel", { exact: true }).click();
  await pacedWait(page, 300);
  const afterParcelClick = await panelGeom(page);
  check("clicking 'Comp from parcel' keeps the panel minimized (does not re-cover the map)", afterParcelClick.minimized === true, JSON.stringify(afterParcelClick));

  // Cancel must restore the full panel with the row intact — never the discard path.
  await page.locator('[data-comp-entry-minimized] button:has-text("Cancel")').click();
  await pacedWait(page, 300);
  const afterCancel = await panelGeom(page);
  check("Cancel restores the full panel", afterCancel.minimized === false, JSON.stringify(afterCancel));
  const rowCountAfterCancel = await page.locator('[data-comp-entry-panel] tbody tr').count();
  check("the pasted row survives Cancel (never the discard path)", rowCountAfterCancel === 1, `rows=${rowCountAfterCancel}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/after-cancel-restored.png` });

  // Escape must disarm and restore too.
  await page.locator('td[data-cell="0-1"] button').click();
  await pacedWait(page, 300);
  check("re-armed for the Escape check", (await panelGeom(page)).minimized === true);
  await page.keyboard.press("Escape");
  await pacedWait(page, 300);
  const afterEscape = await panelGeom(page);
  check("Escape disarms and restores the full panel", afterEscape.minimized === false, JSON.stringify(afterEscape));

  // Re-arm and actually place a pin by clicking the now-reachable map — the full round trip.
  await page.locator('td[data-cell="0-1"] button').click();
  await pacedWait(page, 300);
  await page.mouse.click(400, 150); // inside the map's real visible area (map spans roughly y=103..~420 at this viewport)
  let placed = null;
  for (let i = 0; i < 10 && !placed?.settled; i++) {
    await pacedWait(page, 150);
    const g = await panelGeom(page);
    if (g.minimized === false) { placed = { settled: true, geom: g }; break; }
  }
  check("placing a pin on the map disarms and restores the panel", !!placed, JSON.stringify(placed));
  const locationText = await page.locator('td[data-cell="0-1"]').innerText().catch(() => "");
  check("the row's Location cell fills in after placement", locationText.trim().length > 0 && locationText.trim() !== "Set", `text=${JSON.stringify(locationText)}`);
  const footerText = await page.locator('[data-comp-entry-panel]').getByText(/comp.*ready/).first().innerText().catch(() => "");
  check("the footer reports the row ready (was '1 comp · 0 ready — missing a Location')", /1 comp ready/.test(footerText), `footer=${JSON.stringify(footerText)}`);
  const saveDisabled = await page.locator('[data-comp-entry-panel] button:has-text("Save")').isDisabled().catch(() => true);
  check("Save comps is enabled once the row is ready", saveDisabled === false);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/placed-ready.png` });

  await ctx.close();
}

console.log("\n=== NEW-10 — Type/Unit/Per/Basis never clip their own longest option; $/SF/yr and party columns get real room ===");
{
  const ctx = await newCtx(browser, { width: 1191, height: 521 }, "new10-narrow");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "Sugarbun Way industrial, 25,000 SF lease, $8.04/SF/mo NNN, 5 yr term, executed 1/15/2026, TT: Modular Power Solutions, LL: Core5 Industrial Partners");

  check("Type never clips at its baseline value", notClipped(await cellClipInfo(page, 0)), JSON.stringify(await cellClipInfo(page, 0)));
  await setSelectCell(page, 0, "building_sale");
  check("Type never clips its LONGEST option ('Bldg sale')", notClipped(await cellClipInfo(page, 0)), JSON.stringify(await cellClipInfo(page, 0)));
  await setSelectCell(page, 0, "lease");
  await pacedWait(page, 200);

  check("Unit never clips ('SF')", notClipped(await cellClipInfo(page, 4)), JSON.stringify(await cellClipInfo(page, 4)));
  check("Per never clips ('MO')", notClipped(await cellClipInfo(page, 12)), JSON.stringify(await cellClipInfo(page, 12)));
  check("Basis never clips at its baseline ('NNN')", notClipped(await cellClipInfo(page, 13)), JSON.stringify(await cellClipInfo(page, 13)));
  await setSelectCell(page, 13, "gross");
  check("Basis never clips its LONGEST option ('GROSS')", notClipped(await cellClipInfo(page, 13)), JSON.stringify(await cellClipInfo(page, 13)));

  // $/SF/yr and Notes are allowed to clip under genuine space pressure, but must carry a full-value
  // hover title so nothing is unreadable — the owner's own "make sure the full value is available
  // on hover" instruction.
  const rateTitle = await page.locator('td[data-cell="0-18"]').getAttribute("title");
  check("$/SF/yr carries a hover title with the full value", !!rateTitle && rateTitle.length > 0, `title=${JSON.stringify(rateTitle)}`);
  const notesTitle = await page.locator('td[data-cell="0-21"]').getAttribute("title");
  check("Notes carries a hover title with the full value", notesTitle !== null, `title=${JSON.stringify(notesTitle)}`);
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/new10-narrow-1191.png` });
  await ctx.close();
}
{
  // On a wide monitor there is room to spend — the free-text columns should visibly grow rather
  // than stay pinned to their squeezed floor (the owner's own "let them take the slack").
  const ctx = await newCtx(browser, { width: 1900, height: 1000 }, "new10-wide");
  const page = await ctx.newPage();
  await openEntrySheet(page);
  await pasteViaTextarea(page, "Sugarbun Way industrial, 25,000 SF lease, $8.04/SF/mo NNN, 5 yr term, executed 1/15/2026");
  const titleW = await page.locator('td[data-cell="0-2"]').evaluate((td) => td.clientWidth);
  check("on a wide viewport, Title/Address grows well past its squeezed floor (~58px)", titleW > 150, `titleW=${titleW}`);
  await setSelectCell(page, 0, "building_sale");
  check("Type still never clips on a wide viewport ('Bldg sale')", notClipped(await cellClipInfo(page, 0)), JSON.stringify(await cellClipInfo(page, 0)));
  if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/new10-wide-1900.png` });
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.name).join("; ")); process.exit(1); }
