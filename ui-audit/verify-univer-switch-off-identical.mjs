/* verify-univer-switch-off-identical — with the Univer switch OFF (every non-admin account, and the owner by default) the
 * Spreadsheet must be pixel-identical to the build before the spike (B2557488). Seeds the SAME local project + workbook into
 * two served builds — the baseline (origin/main) and this branch — opens the Spreadsheet in each, and byte-compares full-page
 * screenshots: the grid, the grid with a range selected, and the File menu open.
 * KNOWN-GOOD ARM: a deliberately different render (the branch with one cell edited) must NOT compare equal, otherwise the
 * comparison cannot see anything and a pass would prove nothing.
 * Run: node ui-audit/verify-univer-switch-off-identical.mjs <baselineUrl> <branchUrl>   e.g. http://localhost:4170 http://localhost:4173 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { createWorkbook, setRaw, setCellStyle, setNumberFormat } from "../src/workspaces/model/lib/sheetModel.js";

const [A, B] = process.argv.slice(2);
if (!/^https?:/.test(A || "") || !/^https?:/.test(B || "")) { console.error("usage: <baselineUrl> <branchUrl>"); process.exit(1); }

let wb = createWorkbook(); let sh = wb.sheets[0].sheet;
for (let r = 0; r < 30; r++) for (let c = 0; c < 6; c++) sh = setRaw(sh, r, c, c === 5 ? `=SUM(A${r + 1}:E${r + 1})` : r === 0 ? `Col ${c}` : String(((r * 31 + c * 7) % 900) + 0.25));
sh = setCellStyle(sh, 0, 0, 0, 5, { bold: true, fill: "#e8eef9", align: "center" });
sh = setNumberFormat(sh, 1, 29, 5, 5, "$#,##0.00");
sh = setRaw(sh, 3, 7, "left aligned note that is long enough to spill across empty neighbours");
wb = { ...wb, sheets: [{ ...wb.sheets[0], sheet: sh }] };

const pid = "zz-switch-off-identical";
const site = { id: pid, groupId: pid, site: "ZZ switch off", name: "ZZ switch off", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [] };
const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
async function shots(base, workbook) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(([sid, rec, key, w]) => { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); localStorage.setItem(key, JSON.stringify(w)); }, [pid, site, `planyr:model:sheet:v1:local:${pid}`, workbook]);
  await page.goto(`${base}/#/project/${pid}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="model-sheet"]', { timeout: 90000 });
  await page.waitForTimeout(2500);
  await assertMeasurable(page, "verify-univer-switch-off-identical");
  const out = {};
  out.grid = await page.screenshot();
  const c = await page.locator('[data-row="3"][data-col="2"]').first().boundingBox();
  await page.mouse.click(c.x + c.width / 2, c.y + c.height / 2); await page.keyboard.down("Shift");
  const d = await page.locator('[data-row="6"][data-col="4"]').first().boundingBox(); await page.mouse.click(d.x + d.width / 2, d.y + d.height / 2); await page.keyboard.up("Shift");
  await page.waitForTimeout(300); out.selected = await page.screenshot();
  await page.click('[data-testid="model-file-menu-btn"]'); await page.waitForTimeout(400); out.menu = await page.screenshot();
  const univerRows = await page.locator('[data-testid="model-univer-switch"]').count();
  await ctx.close(); return { out, univerRows };
}
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const base = await shots(A, wb), head = await shots(B, wb);
// known-good arm: the same branch with ONE cell different must differ
const edited = JSON.parse(JSON.stringify(wb)); edited.sheets[0].sheet.cells["c1:1"] = "999999";
const arm = await shots(B, edited);
ok("KNOWN-GOOD ARM: a one-cell change is visible to the comparison", !head.out.grid.equals(arm.out.grid));
for (const k of ["grid", "selected", "menu"]) ok(`switch off: the ${k} screenshot is byte-identical to the baseline build`, base.out[k].equals(head.out[k]), `${base.out[k].length} vs ${head.out[k].length} bytes`);
ok("the File menu has no 'Try the new grid' row for a signed-out / non-admin user", head.univerRows === 0 && base.univerRows === 0);
await browser.close();
console.log(failures ? `FAILED — ${failures}` : "PASSED");
process.exit(failures ? 1 : 0);
