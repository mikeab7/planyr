/* verify-univer-switch-off-identical — REWRITTEN for the default-on cutover (NEW-2, 2026-10-31). The FILE NAME is kept on purpose (the spike
 * doc and old PR notes link to it); what it proves changed.
 *
 * WAS: with the Univer switch OFF (every non-admin account) the Spreadsheet had to be pixel-identical to the build before the spike —
 * it screenshotted the old DOM grid on a baseline build and on the branch and byte-compared them. RETIRED, and that comparison cannot
 * come back: there is no "switch off" for a visitor any more, the old SheetView grid is an owner-only hatch tests cannot reach (it needs a
 * confirmed is_admin()), and a baseline build that still shows the old grid for everyone no longer exists to compare against.
 *
 * NOW (the rule that replaced it — docs/SPREADSHEET-UNIVER-SPIKE.md "default-on", src/workspaces/model/CLAUDE.md top banner): a SIGNED-OUT
 * visitor — by definition not the owner — gets the UNIVER grid, with no switch anywhere:
 *   1 the Univer canvas mounts and the old grid's DOM (`model-sheet`, [data-row][data-col], model-col-header-*) is not in the page
 *   2 the File menu is the real menu (it opens, it offers "Download as Excel") but carries no "Try the new grid" / "Use the regular grid" row
 *   3 a device that carried the OLD switch ("1" = on, "0" = off, planyr:model:univerGrid) lands on Univer too, and the retired key is removed
 *   4 a stored regular-grid flag (planyr:model:regularGrid = "1") never reaches a visitor who is not a confirmed admin
 *   5 a value typed into it is saved and survives a reload (the one persistence path)
 * KNOWN-GOOD ARMS (a pass proves nothing if the instrument cannot see the thing):
 *   · the facade handle answers (window.__planyrUniverRead.api() returns a workbook) — so "no old DOM" is not just "nothing rendered"
 *   · a control element IS found by the very selectors used for the absence checks: `[data-testid="univer-grid"]` (1) and
 *     `[data-testid="model-file-menu-btn"]` (1) — and the old-grid selector is run against a planted node to show it matches one
 * The same assertions run as a Playwright spec in CI (e2e/model-univer-default.spec.js, against the local preview); THIS file exists so the
 * same rule can be checked against any served build — notably the deployed site, signed out — without a test runner.
 * Run: node ui-audit/verify-univer-switch-off-identical.mjs [base=http://localhost:4173]     e.g. https://planyr.io (signed out) after the deploy */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.argv.slice(2).find((a) => /^https?:/.test(a)) || "http://localhost:4173").replace(/\/+$/, "");
const CANVAS = 'canvas[id^="univer-sheet-main-canvas"]';
const LEGACY = "planyr:model:univerGrid", REGULAR = "planyr:model:regularGrid";

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };

const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let n = 0;
/** a brand-new browser context (= a brand-new device) on a throwaway local project; `seedKey` pre-sets one localStorage flag on that device */
async function visit(seedKey, seedVal) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const id = `zz-default-on-${Date.now().toString(36)}-${++n}`;
  const site = { id, groupId: id, site: "ZZ default-on (throwaway)", name: "ZZ default-on (throwaway)", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([sid, rec, k, v]) => {
    window.__PLANYR_E2E = true;
    if (!sessionStorage.getItem("seeded-once")) { sessionStorage.setItem("seeded-once", "1"); localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); if (k) localStorage.setItem(k, v); }
  }, [id, site, seedKey || null, seedVal || null]);
  await page.goto(`${BASE}/#/project/${id}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector(CANVAS, { timeout: 90000 });
  await page.waitForFunction(() => { const h = window.__planyrUniverRead; const a = h && h.api && h.api(); return !!(a && a.getActiveWorkbook && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 60000 });
  await page.waitForTimeout(800);
  await assertMeasurable(page, "verify-univer-switch-off-identical");
  return { ctx, page, id };
}
const OLD_GRID = '[data-testid="model-sheet"], [data-testid^="model-col-header-"], [data-testid^="model-row-header-"], [data-row][data-col]';

try {
  // 1 + 2 + known-good arms: a plain visitor
  const a = await visit();
  ok("KNOWN-GOOD ARM: the facade answers with a workbook (the page really is the Univer grid, not an empty shell)", await a.page.evaluate(() => !!window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet()));
  ok("KNOWN-GOOD ARM: the selectors used below find their targets — `univer-grid` ×1, File button ×1", (await a.page.locator('[data-testid="univer-grid"]').count()) === 1 && (await a.page.locator('[data-testid="model-file-menu-btn"]').count()) === 1);
  await a.page.evaluate(() => { const d = document.createElement("div"); d.setAttribute("data-testid", "model-sheet"); d.id = "planted-old-grid"; document.body.appendChild(d); });
  const planted = await a.page.locator(OLD_GRID).count();
  await a.page.evaluate(() => document.getElementById("planted-old-grid").remove());
  ok("KNOWN-GOOD ARM: the old-grid selector DOES match an old-grid node when one exists (planted, then removed)", planted === 1);
  ok("1 a signed-out visitor gets the Univer canvas and none of the old grid's DOM", (await a.page.locator(CANVAS).count()) === 1 && (await a.page.locator(OLD_GRID).count()) === 0);
  await a.page.getByTestId("model-file-menu-btn").click();
  await a.page.waitForTimeout(400);
  const menuOpen = (await a.page.getByTestId("model-export-xlsx").count()) === 1;
  const text = await a.page.evaluate(() => document.body.innerText);
  ok("2 the File menu opens and offers Download as Excel, with no grid-switch row", menuOpen && (await a.page.getByTestId("model-univer-switch").count()) === 0 && !/Try the new grid|Use the regular grid|Use the new grid/.test(text), `menuOpen=${menuOpen}`);
  await a.ctx.close();

  // 3 a device with the OLD switch set either way
  for (const v of ["1", "0"]) {
    const b = await visit(LEGACY, v);
    const gone = await (async () => { for (let i = 0; i < 20; i++) { if ((await b.page.evaluate((k) => localStorage.getItem(k), LEGACY)) === null) return true; await b.page.waitForTimeout(250); } return false; })();
    ok(`3 a device that had the OLD switch at "${v}" lands on Univer, and the retired key is removed`, (await b.page.locator(CANVAS).count()) === 1 && (await b.page.locator(OLD_GRID).count()) === 0 && gone);
    await b.ctx.close();
  }

  // 4 a stored regular-grid flag
  const c = await visit(REGULAR, "1");
  ok("4 a stored 'use the regular grid' flag never reaches a visitor who is not a confirmed admin", (await c.page.locator(CANVAS).count()) === 1 && (await c.page.locator(OLD_GRID).count()) === 0);
  await c.ctx.close();

  // 5 an edit survives a reload
  const d = await visit();
  const at = await d.page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const r = ws.getRange(0, 0).getCellRect(); const o = typeof r === "string" ? JSON.parse(r) : r; const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); return { x: cv.left + o.x + o.width / 2, y: cv.top + o.y + o.height / 2 }; });
  await d.page.mouse.click(at.x, at.y); await d.page.waitForTimeout(250);
  await d.page.keyboard.type("500", { delay: 10 }); await d.page.keyboard.press("Enter"); await d.page.waitForTimeout(300);
  await d.page.evaluate(() => window.__planyrUniverRead.flush()); await d.page.waitForTimeout(500);
  const before = await d.page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(0, 0).getValue());
  await d.page.reload({ waitUntil: "load" });
  await d.page.waitForSelector(CANVAS, { timeout: 90000 });
  await d.page.waitForFunction(() => { const h = window.__planyrUniverRead; const a = h && h.api && h.api(); return !!(a && a.getActiveWorkbook && a.getActiveWorkbook() && a.getActiveWorkbook().getActiveSheet()); }, null, { timeout: 60000 });
  await d.page.waitForTimeout(800);
  const after = await d.page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange(0, 0).getValue());
  ok("5 a value typed into A1 is saved and is still there after a reload", before === 500 && after === 500, `typed=${before} afterReload=${after}`);
  await d.ctx.close();
} catch (e) {
  console.log("FAIL — harness error: " + (e?.stack || e));
  failures++;
} finally {
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
