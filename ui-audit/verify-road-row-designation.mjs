/* B783280 (NEW-1, designated ROW) + B773730 (NEW-2, outside-curb band painting) — live verification.
 *
 * NEW-1: a road can carry an explicit, designated right-of-way width — wider than the modeled
 * pavement section — with the field in both the cross-section dialog and the road Properties panel,
 * a ROW boundary drawn on the canvas (dashed lines + "N′ R.O.W." label, following the same trimmed
 * centerline as the pavement ribbon), a Layers/View toggle, and PDF export parity.
 *
 * NEW-2: a band typed OUTSIDE the curb (sidewalk / parkway / ditch) used to be accepted by the dialog,
 * counted in the ROW total, and painted as NOTHING on the canvas. It now paints as an unclipped fill
 * outside the pavement ring.
 *
 * Repro case (from the owner's own dispatch): a 68′ boulevard (12/12/20-median/12/12) plus a 16′
 * parkway on each side (= 100′ modeled band total), with the ROW explicitly designated at 100′ — the
 * exact-equality edge case that turned up a real bug: the dialog's ROW field and the Properties
 * panel's ROW field BOTH default their display to the current band total, so typing the very digits
 * already shown silently failed to commit (fixed here, `forceCommit` on both `BandWidthInput` and
 * `NumInput`).
 *
 * Logged-out, no external GIS, blank site — the ATTEMPT-BEFORE-YOU-PARK class, so it runs here.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-road-row-designation.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-row-designation/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-road-row-designation");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

const fails = [], notes = [];
const check = (ok, label, detail = "") => { (ok ? notes : fails).push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try { await page.getByRole("button", { name: /Start blank/i }).click({ timeout: 8000 }); } catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(600);
const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();

const readSite = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return s;
});

// ---- 0. B786112 — the two-ROW-numbers wording bug, Michael's OWN literal repro: the base
// boulevard preset ALONE (68′ band total, no parkways), Right-of-way width set to 100. Before the
// fix this rendered "Total ROW width 68′" directly above "Designated ROW 100′" — the word ROW
// against two different numbers six inches apart. Checked in its own dialog session (opened, then
// cancelled) so it doesn't disturb the exact-equality forceCommit repro that follows. ------------
await page.locator('[aria-label="Road presets"]').click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /Design cross-section…/ }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^4-lane divided boulevard$/ }).click();
await page.waitForTimeout(300);
{
  const preText = await page.locator("body").innerText();
  check(/Modeled band total\s*68′/.test(preText), "before any ROW is designated, the band-total line reads \"Modeled band total 68′\" (not \"Total ROW width\")", preText.match(/Modeled band total[^\n]*/)?.[0] || "line not found");
  check(!/Total ROW width/.test(preText), "the old contradictory \"Total ROW width\" label is gone from the dialog entirely");

  const wordingRowInput = page.locator('[data-testid="road-xsection-row"]');
  await wordingRowInput.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("100");
  await wordingRowInput.blur();
  await page.waitForTimeout(300);
  const postText = await page.locator("body").innerText();
  check(/Modeled band total\s*68′/.test(postText), "B786112 fix: with a 100′ ROW designated, the band-total line still correctly reads 68′ and is no longer labelled ROW", postText.match(/Modeled band total[^\n]*/)?.[0] || "line not found");
  check(/Designated ROW\s*100′/.test(postText), "the designated figure reads 100′", postText.match(/Designated ROW[^\n]*/)?.[0]);
  check(!/Total ROW width/.test(postText), "B786112 fix: \"Total ROW width\" never reappears once a ROW is designated — the exact reported contradiction (\"Total ROW width 68′\" beside \"Designated ROW 100′\") cannot occur, because the first label no longer exists");
  // The word "ROW" must label exactly one NUMBER at a time. "ROW margin" is a distinct, clearly
  // subordinate concept (the leftover strip), not a second competing total — so this asserts there
  // is no OTHER line claiming to be a road/total figure under the bare word "ROW".
  const rowLines = postText.split("\n").filter((l) => /\bROW\b/.test(l) && !/R\.O\.W\./.test(l));
  const distinctRowNumbers = new Set(rowLines.map((l) => (l.match(/(\d+(?:\.\d+)?)′/) || [])[1]).filter(Boolean));
  check(rowLines.every((l) => /Designated ROW|ROW margin/.test(l)), "every remaining line containing the word \"ROW\" is either \"Designated ROW\" or \"ROW margin\" — nothing else claims the word", JSON.stringify(rowLines));
  console.log("  (ROW-labelled lines: " + JSON.stringify(rowLines) + ", numbers: " + JSON.stringify([...distinctRowNumbers]) + ")");

  await page.screenshot({ path: OUT + "06-wording-fix-asymmetric.png" });
  await page.getByRole("button", { name: /^Cancel$/ }).click();
  await page.waitForTimeout(300);
}

// ---- 1. Design a boulevard + two 16′ parkway bands (one each side) in the Road tool flyout -------
await page.locator('[aria-label="Road presets"]').click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /Design cross-section…/ }).click();
await page.waitForTimeout(400);
await page.getByRole("button", { name: /^4-lane divided boulevard$/ }).click();
await page.waitForTimeout(300);

async function addParkwayBand(atStart) {
  await page.getByRole("button", { name: "＋ Add band" }).click();
  await page.waitForTimeout(150);
  const rows = page.locator('[data-testid="road-xsection-band-row"]');
  let idx = (await rows.count()) - 1;
  const lastRow = rows.nth(idx);
  await lastRow.locator("select").selectOption("parkway");
  const widthInput = lastRow.locator('input[type="text"]').first();
  await widthInput.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("16");
  await widthInput.blur();
  await page.waitForTimeout(150);
  if (atStart) {
    while (idx > 0) {
      await rows.nth(idx).getByRole("button", { name: "Move up" }).click();
      await page.waitForTimeout(50);
      idx -= 1;
    }
  }
}
await addParkwayBand(true);
await addParkwayBand(false);
await page.waitForTimeout(200);
const bandRowCount = await page.locator('[data-testid="road-xsection-band-row"]').count();
check(bandRowCount === 7, "the boulevard + two 16′ parkway bands (one each side) are all present in the dialog", `rows=${bandRowCount}`);

// ---- 2. Designate the ROW at exactly the band total (68 + 16 + 16 = 100) — the exact-equality
//         edge case that exposed the forceCommit bug in BOTH the dialog and Properties fields -------
const preTotal = await page.locator("body").innerText();
check(/Modeled band total\s*100/.test(preTotal), "the modeled band total is exactly 100′ before anything is designated", preTotal.match(/Modeled band total[^\n]*/)?.[0]);
check(!/Designated ROW/.test(preTotal), "nothing is designated yet (no \"Designated ROW\" line)");

const rowInput = page.locator('[data-testid="road-xsection-row"]');
await rowInput.click();
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await page.keyboard.type("100"); // the SAME digits the field already shows as its default — the edge case
await rowInput.blur();
await page.waitForTimeout(300);
const postDesignate = await page.locator("body").innerText();
const designatedMatch = postDesignate.match(/Designated ROW\s*([\d.]+)′/);
const marginMatch = postDesignate.match(/ROW margin\s*([\d.]+)′/);
check(designatedMatch && designatedMatch[1] === "100", "B783280 fix: typing the ROW field's own displayed default (100) DOES commit a real designation (forceCommit) — this used to silently no-op", postDesignate.match(/Designated ROW[^\n]*/)?.[0] || "no \"Designated ROW\" line rendered");
check(marginMatch && marginMatch[1] === "0", "ROW margin reads 0′ each side (the modeled bands exactly fill the designated ROW)", marginMatch && marginMatch[0]);
check(!/⚠ The modeled bands total/.test(postDesignate), "no over-designation warning (bands exactly match the ROW, not over it)");
await page.screenshot({ path: OUT + "01-dialog-100ft-row.png" });

// ---- 3. Apply and draw the road -------------------------------------------------------------------
await page.getByRole("button", { name: /^Use this section$/ }).click();
await page.waitForTimeout(300);
for (const [dx, dy] of [[220, 420], [900, 420]]) await page.mouse.click(box.x + dx, box.y + dy);
await page.keyboard.press("Enter");
await page.waitForTimeout(500);
let site = await readSite();
const road = (site.els || []).find((e) => e.type === "road" && e.xsection && e.xsection.rowDesignFt);
check(!!road, "the drawn road persists rowDesignFt on its xsection", JSON.stringify(road && road.xsection && road.xsection.rowDesignFt));
check(road && road.xsection.rowDesignFt === 100, "the persisted rowDesignFt is exactly 100", `rowDesignFt=${road && road.xsection.rowDesignFt}`);
check(road && Math.round(road.travelW) === 68, "travelW (curb-to-curb) stays 68 — unaffected by the wider designated ROW", `travelW=${road && road.travelW}`);
await page.screenshot({ path: OUT + "02-canvas-row-lines-zoom1.png" });

// ---- 4. NEW-2 — outside-curb bands (the two parkways) actually paint, unclipped ---------------
const decoration = await page.evaluate((id) => {
  const g = document.querySelector(`[data-el-id="${id}"]`);
  if (!g) return null;
  const allPolys = [...g.querySelectorAll("polygon")];
  const clippedG = g.querySelector("g[clip-path]");
  const clippedPolys = clippedG ? [...clippedG.querySelectorAll("polygon")] : [];
  const unclippedPolys = allPolys.filter((p) => !clippedG || !clippedG.contains(p));
  return { total: allPolys.length, clipped: clippedPolys.length, unclipped: unclippedPolys.length, clipPaths: g.querySelectorAll("clipPath").length };
}, road.id);
check(!!decoration, "the drawn road's rendered group is found");
check(decoration && decoration.total === 3, "3 band-fill polygons paint total: 1 median (within-curb) + 2 parkways (outside-curb) — a plain boulevard alone paints exactly 1", JSON.stringify(decoration));
check(decoration && decoration.clipped === 1, "exactly 1 fill (the median) is clipped to the pavement ring", JSON.stringify(decoration));
check(decoration && decoration.unclipped === 2, "B773730 fix: both parkway bands paint OUTSIDE the pavement clip — this used to be 0 (silently invisible)", JSON.stringify(decoration));

// ---- 5. NEW-1 — the ROW boundary lines + label render on the canvas ---------------------------
const rowGeom = await page.evaluate((id) => {
  const g = document.querySelector(`[data-el-id="${id}"]`);
  if (!g) return null;
  const dashedTertiary = [...g.querySelectorAll('polyline[stroke="var(--text-tertiary)"]')].filter((p) => p.getAttribute("stroke-dasharray"));
  const texts = [...g.querySelectorAll("text")].map((t) => t.textContent);
  return { dashedTertiaryCount: dashedTertiary.length, rowLabel: texts.find((t) => /R\.O\.W\./.test(t)) || null };
}, road.id);
check(!!rowGeom, "ROW geometry is queryable on the drawn road's group");
check(rowGeom && rowGeom.dashedTertiaryCount === 2, "exactly 2 dashed ROW boundary polylines render (one each side)", JSON.stringify(rowGeom));
check(rowGeom && rowGeom.rowLabel === "100′ R.O.W.", "the inline \"100′ R.O.W.\" label renders on the canvas", JSON.stringify(rowGeom && rowGeom.rowLabel));

// zoom in for a second look, per the dispatch's own instruction ("screenshotting the plan at two zoom levels")
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "03-canvas-row-lines-zoom2.png" });

// ---- 6. Layers/View toggle — "ROW lines" hides and restores the boundary + label --------------
await page.locator('[data-testid="view-menu-btn"]').click();
await page.waitForTimeout(200);
const rowToggle = page.locator('label:has-text("ROW lines") input[type="checkbox"]');
check(await rowToggle.count() === 1, "the View ▾ menu carries a \"ROW lines\" checkbox");
await rowToggle.uncheck();
await page.waitForTimeout(300);
const afterHide = await page.evaluate((id) => {
  const g = document.querySelector(`[data-el-id="${id}"]`);
  const dashedTertiary = [...g.querySelectorAll('polyline[stroke="var(--text-tertiary)"]')].filter((p) => p.getAttribute("stroke-dasharray"));
  const hasLabel = [...g.querySelectorAll("text")].some((t) => /R\.O\.W\./.test(t.textContent));
  return { dashedTertiaryCount: dashedTertiary.length, hasLabel };
}, road.id);
check(afterHide.dashedTertiaryCount === 0 && !afterHide.hasLabel, "unchecking \"ROW lines\" removes both the boundary lines and the label from the canvas", JSON.stringify(afterHide));
await page.screenshot({ path: OUT + "04-canvas-row-lines-hidden.png" });
await rowToggle.check();
await page.waitForTimeout(300);
const afterRestore = await page.evaluate((id) => {
  const g = document.querySelector(`[data-el-id="${id}"]`);
  const dashedTertiary = [...g.querySelectorAll('polyline[stroke="var(--text-tertiary)"]')].filter((p) => p.getAttribute("stroke-dasharray"));
  return dashedTertiary.length;
}, road.id);
check(afterRestore === 2, "re-checking \"ROW lines\" restores both boundary lines", `count=${afterRestore}`);
await page.locator('[data-testid="view-menu-btn"]').click(); // close the menu
await page.waitForTimeout(200);

// ---- 7. Properties panel — the ROW field (read/write), including the SAME exact-equality edge case
const clickElement = async (id) => {
  const b = await page.evaluate((elId) => {
    const n = document.querySelector(`[data-el-id="${elId}"]`);
    if (!n) return null;
    const r = n.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, id);
  if (!b) return false;
  await page.mouse.click(b.x, b.y);
  return true;
};
check(await clickElement(road.id), "the drawn road's own rendered node is found to reselect it");
await page.waitForTimeout(300);
await page.getByText("Properties", { exact: true }).click();
await page.waitForTimeout(400);
const panelText = await page.locator("body").innerText();
check(/Road width \(ft\)[^\n]*\n?[^\n]*68′\s*curb to curb/.test(panelText.replace(/\s+/g, " ")), "Properties shows the read-only curb-to-curb width (68′), unaffected by the ROW", panelText.match(/Road width[^\n]*\n?[^\n]*/)?.[0]);
check(/Right-of-way \(ft\)/.test(panelText), "Properties carries a \"Right-of-way (ft)\" field for a road that has been through the cross-section dialog");
await page.screenshot({ path: OUT + "05-properties-panel.png" });

// Clear it from the Properties field, confirm the ROW line disappears; then re-designate via
// Properties using the SAME exact-equality digits as a second, independent proof of the forceCommit fix.
const rowFieldLoc = page.locator('[data-field-group="1"]', { hasText: "Right-of-way (ft)" }).locator("input");
const rowFieldCount = await rowFieldLoc.count();
check(rowFieldCount >= 1, "the Right-of-way Properties field is locatable as an input", `matches=${rowFieldCount}`);
if (rowFieldCount >= 1) {
  const f = rowFieldLoc.first();
  const shownVal = await f.inputValue();
  check(shownVal === "100", "the Properties ROW field shows the persisted designation (100)", `shown=${shownVal}`);
  await f.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("100"); // exact-equality edge case again, this time via Properties
  await f.blur();
  await page.waitForTimeout(300);
  site = await readSite();
  const afterPropsRetype = (site.els || []).find((e) => e.id === road.id);
  check(afterPropsRetype && afterPropsRetype.xsection.rowDesignFt === 100, "B783280 fix (2nd site): retyping the same 100 into the Properties field keeps it committed (forceCommit on NumInput too)", `rowDesignFt=${afterPropsRetype && afterPropsRetype.xsection.rowDesignFt}`);
}

// ---- 8. PDF-PARITY — the export sheet is a CLONE of the live SVG (exportSheet.js); confirm the
// ROW lines/label and the outside-curb band fills all survive into the exported sheet with no
// separate export-path code ------------------------------------------------------------------------
const exportHtml = await page.evaluate(async () => (window.__plannerExportSvg ? await window.__plannerExportSvg() : null));
check(!!exportHtml, "the export-sheet self-audit hook is reachable (window.__plannerExportSvg)");
if (exportHtml) {
  const groupMatch = new RegExp(`data-el-id="${road.id}"[\\s\\S]*?</g>\\s*</g>`).exec(exportHtml);
  const exportedGroup = groupMatch ? groupMatch[0] : exportHtml;
  check(exportHtml.includes(`data-el-id="${road.id}"`), "the road appears in the exported sheet");
  check(/R\.O\.W\./.test(exportedGroup), "PDF-PARITY: the \"R.O.W.\" label is present in the exported SVG", /R\.O\.W\./.test(exportedGroup) ? "found" : "not found");
  const exportedDashedTertiary = (exportedGroup.match(/stroke="var\(--text-tertiary\)"[^>]*stroke-dasharray/g) || []).length;
  check(exportedDashedTertiary >= 2, "PDF-PARITY: both dashed ROW boundary lines are present in the exported SVG", `count=${exportedDashedTertiary}`);
  const exportedSuccessFills = (exportedGroup.match(/fill="var\(--success-text\)"/g) || []).length;
  check(exportedSuccessFills === 3, "PDF-PARITY: all 3 band fills (median + 2 parkways) are present in the exported SVG", `count=${exportedSuccessFills}`);
}

check(errs.length === 0, "no page errors", errs.join(" | "));

console.log("\n" + notes.join("\n"));
if (fails.length) { console.log("\n" + fails.join("\n")); }
console.log(`\n${fails.length ? "FAIL" : "PASS"} — ${notes.length} checks passed, ${fails.length} failed. Screens → ${OUT}`);
await browser.close();
process.exit(fails.length ? 1 : 0);
