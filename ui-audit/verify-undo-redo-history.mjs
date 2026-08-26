/* B648352/B648353 — Undo/Redo toolbar icons + the history dropdown, driven in a real browser.
 *
 * Michael: "can we get the undo and redo buttons to look more professional", then "just like
 * Excel" (a screenshot of Excel's Quick Access Toolbar: curved arrow, dropdown caret beside each,
 * redo greyed out). Two things measured on the deployed build and fixed:
 *   B648352 — Undo/Redo were the only FILLED Material-style glyphs in an otherwise all-stroked
 *     icon language (ToolIcon/RailIcon/icons.jsx), oversized (20px in a 24px box vs 15px for every
 *     stroked neighbour), and on the Material .38 disabled alpha instead of the app's own .45 fade.
 *   B648353 — a caret beside each button opens a dropdown of recent actions (newest first), named
 *     via lib/historyLabel.js's snapshot diff (not 190 hand-labeled call sites — see that module's
 *     header). Hovering highlights a contiguous run from the top; the footer reads "Undo N
 *     Actions"; clicking undoes/redoes that whole run as one gesture.
 *
 * Logged out, no external GIS, geometry seeded from localStorage — Claude-verifiable HERE
 * (ATTEMPT-BEFORE-YOU-PARK). Zoom-to-fit is asserted UNCHANGED (still filled MDI, 20px) — a
 * deliberate scope check: B648352 fixed Undo/Redo only and reported the same mismatch on
 * Zoom-to-fit/Layers rather than silently widening the fix.
 *
 * Run:  npm run dev -- --port 5183   (separate shell)
 *       BASE_URL=http://localhost:5183/ node ui-audit/verify-undo-redo-history.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5183/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const sites = {
  hx1: {
    id: "hx1", groupId: "hx1", site: "hx1", name: "HistoryTest",
    origin: { lat: 29.7604, lon: -95.3698 }, county: "harris",
    parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 600 }, { x: 0, y: 600 }] }],
    els: [], measures: [], callouts: [], markups: [], sheetOverlays: [],
    settings: {}, underlay: null, status: "active", updatedAt: now,
  },
};
const seedFor = (theme) => `(()=>{try{localStorage.setItem('planyr.theme',${JSON.stringify(theme)});`
  + `localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));`
  + `localStorage.removeItem('planarfit:currentSite:v1');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };
const menuRows = (page) => page.evaluate(() => {
  const panels = [...document.querySelectorAll(".menu")];
  const panel = panels[panels.length - 1];
  return panel ? [...panel.querySelectorAll("button")].map((b) => b.textContent.trim()) : [];
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

for (const theme of ["light", "dark"]) {
  console.log(`\n── ${theme} theme ─────────────────────────────`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(seedFor(theme));
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-undo-redo-history");
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await page.locator("text=hx1").first().click();
  await page.waitForTimeout(1500);

  const undoBtn = page.locator('button[aria-label="Undo"]');
  const undoCaret = page.locator('button[aria-label="Recent actions to undo"]');
  const redoBtn = page.locator('button[aria-label="Redo"]');
  const redoCaret = page.locator('button[aria-label="Recent actions to redo"]');

  // ---- B648352: icons + disabled treatment -------------------------------------------------
  ok(`[${theme}] Undo/Redo + their carets start disabled together`,
    (await undoBtn.isDisabled()) && (await undoCaret.isDisabled()) && (await redoBtn.isDisabled()) && (await redoCaret.isDisabled()));

  const svgAttrs = (loc) => loc.evaluate((btn) => {
    const svg = btn.querySelector("svg");
    return { fill: svg.getAttribute("fill"), stroke: svg.getAttribute("stroke"), w: svg.getAttribute("width"),
      linecap: svg.getAttribute("stroke-linecap"), linejoin: svg.getAttribute("stroke-linejoin") };
  });
  const u = await svgAttrs(undoBtn), r = await svgAttrs(redoBtn);
  ok(`[${theme}] Undo/Redo icons are stroked (fill:none, stroke:currentColor), not filled Material glyphs`,
    u.fill === "none" && u.stroke === "currentColor" && r.fill === "none" && r.stroke === "currentColor", JSON.stringify({ u, r }));
  ok(`[${theme}] rendered at the ~15px neighbour size (was 20px)`, u.w === "15" && r.w === "15", `undo=${u.w} redo=${r.w}`);
  ok(`[${theme}] round cap/join, matching the app's line-icon idiom`, u.linecap === "round" && u.linejoin === "round");
  ok(`[${theme}] Undo's disabled opacity is the app's own .45 fade, not Material's .38`,
    (await undoBtn.evaluate((b) => getComputedStyle(b).opacity)) === "0.45");
  ok(`[${theme}] Undo/Redo no longer carry the tb-icon-btn (Material) class`,
    !/tb-icon-btn/.test((await undoBtn.getAttribute("class")) || "") && !/tb-icon-btn/.test((await redoBtn.getAttribute("class")) || ""));

  const zf = await page.locator('button[aria-label="Zoom to fit"]').first().evaluate((btn) => {
    const svg = btn.querySelector("svg");
    return { fill: svg.getAttribute("fill"), w: svg.getAttribute("width") };
  });
  ok(`[${theme}] Zoom-to-fit is deliberately UNCHANGED (still filled MDI, 20px) — scope stayed to Undo/Redo`,
    zf.fill === "currentColor" && zf.w === "20", JSON.stringify(zf));

  const toolbarBox = await undoBtn.boundingBox();
  await page.screenshot({ path: `${OUT}toolbar-${theme}.png`, clip: { x: Math.max(0, toolbarBox.x - 60), y: Math.max(0, toolbarBox.y - 10), width: 320, height: 50 } });

  // ---- B648353: draw/delete a few things, then verify the dropdown ------------------------
  const canvas = page.getByTestId("planner-canvas");
  const cb = await canvas.boundingBox();
  await page.locator('button:has-text("Building")').first().click();
  await page.mouse.move(cb.x + 200, cb.y + 200);
  await page.mouse.down(); await page.mouse.move(cb.x + 400, cb.y + 300, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(250);
  await page.locator('button:has-text("Building")').first().click();
  await page.mouse.move(cb.x + 500, cb.y + 200);
  await page.mouse.down(); await page.mouse.move(cb.x + 650, cb.y + 300, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(250);
  await page.keyboard.press("Delete"); // the just-drawn 2nd building is still selected
  await page.waitForTimeout(250);

  // el-tier: this scene only ever draws/deletes buildings (the [data-el-id] "els" collection) —
  // no parcel/measure/callout/markup is ever added, so a per-element count is the right axis here,
  // not a COUNT-EVERY-KIND feature census.
  const countEls = () => page.evaluate(() => document.querySelectorAll("[data-el-id]").length);
  ok(`[${theme}] two buildings drawn, one deleted → 1 remains`, (await countEls()) === 1, `count=${await countEls()}`);

  await undoCaret.click();
  await page.waitForTimeout(250);
  const rows = await menuRows(page);
  ok(`[${theme}] dropdown lists 3 real, readable rows — newest first`,
    rows.length === 3 && rows[0] === "Deleted building" && rows[1] === "Added building" && rows[2] === "Added building",
    JSON.stringify(rows));
  await page.screenshot({ path: `${OUT}undo-menu-${theme}.png` });

  const rowBtns = page.locator(".menu").last().locator("button");
  await rowBtns.nth(2).hover();
  await page.waitForTimeout(150);
  const footer = await page.locator(".menu").last().locator("div").last().textContent();
  ok(`[${theme}] hovering the 3rd row reads "Undo 3 Actions"`, /undo 3 actions/i.test(footer || ""), footer);
  const bgs = await rowBtns.evaluateAll((els) => els.map((e) => getComputedStyle(e).backgroundColor));
  ok(`[${theme}] all 3 rows share one highlight (contiguous run, including the row under the pointer)`,
    bgs[0] === bgs[1] && bgs[1] === bgs[2], JSON.stringify(bgs));
  await page.screenshot({ path: `${OUT}undo-menu-hover-${theme}.png` });

  await rowBtns.nth(2).click();
  await page.waitForTimeout(400);
  ok(`[${theme}] clicking the 3rd row undoes all 3 as ONE gesture → 0 elements`, (await countEls()) === 0, `count=${await countEls()}`);
  ok(`[${theme}] Undo now disabled, Redo now enabled`, (await undoBtn.isDisabled()) && (await redoBtn.isEnabled()));

  await redoCaret.click();
  await page.waitForTimeout(250);
  const redoRowsText = await menuRows(page);
  ok(`[${theme}] redo dropdown mirrors the undone run, newest first`,
    redoRowsText.length === 3 && redoRowsText[0] === "Added building", JSON.stringify(redoRowsText));
  await page.locator(".menu").last().locator("button").nth(2).click();
  await page.waitForTimeout(400);
  ok(`[${theme}] redoing all 3 restores the pre-undo state (1 element)`, (await countEls()) === 1, `count=${await countEls()}`);

  ok(`[${theme}] no console/page errors during the whole run`, jsErrors.length === 0, jsErrors.join(" | "));

  await ctx.close();
}

await browser.close();
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
if (fails.length) { console.log("FAILED:", fails.map((f) => f.n)); process.exit(1); }
