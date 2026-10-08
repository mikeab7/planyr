/* verify-overlays-panel-behaviour — the redesigned OVERLAYS panel's actions, driven in a real browser.
 *
 * Every action must (a) do the thing, (b) be ONE undo step, and (c) survive a reload where it is saved:
 *   rename (+undo) · Move up / Move down from the ⋯ menu (keyboard-only) · drag-reorder with a mouse ·
 *   Draws Behind/In front · rotation ±1°, 90° each way (+undo each) · Set scale preset (+reload keeps it) ·
 *   Trace a length clears "not scaled" · Add overlay (image) is born "not scaled" · opacity ·
 *   ⋯ → Remove overlay (+undo) · a row drag never pans the canvas or changes the canvas selection ·
 *   touch layout turns row dragging OFF.
 *
 * Run (preview on :4173):  node ui-audit/verify-overlays-panel-behaviour.mjs
 *      LIVE=https://planyr.io … see ui-audit/verify-overlays-panel-live.mjs for the signed-in version.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync, writeFileSync } from "node:fs";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PT = 72, imgW = 36 * PT, imgH = 24 * PT;
const svg = (c) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='${c}'/></svg>`);
const base = { rotation: 0, opacity: 0.85, locked: false, imgW, imgH, ftPerPx: 30 / PT, x: -400, y: -250, page: 1, pageCount: 1 };
const overlays = [
  { ...base, id: "a1", name: "Alpha.pdf", sheet: { std: true, label: "ARCH D" }, storageKey: "k/a1.pdf", src: svg("#c8a06e") },
  { ...base, id: "b2", name: "Bravo.png", unscaled: true, src: svg("#69c"), imgW: 800, imgH: 600, ftPerPx: 1 },
  { ...base, id: "c3", name: "Charlie.png", src: svg("#9c6"), imgW: 800, imgH: 600, ftPerPx: 1, x: 100, y: 100 },
];
const site = { id: "S", groupId: "S", site: "Scaleyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: overlays, parcelDrawings: [], updatedAt: Date.now() };
const seed = `(()=>{try{ if(!localStorage.getItem('__seeded')){localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');localStorage.setItem('planarfit:leftWidth','320');localStorage.setItem('__seeded','1');} }catch(e){}})();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
let fail = 0;
const ok = (c, m) => { console.log((c ? "✓ " : "✗ ") + m); if (!c) fail++; };

async function boot(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...opts });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  page.on("dialog", async (d) => { ok(false, "a dialog appeared (inline editors only): " + d.message().slice(0, 60)); await d.accept().catch(() => {}); });
  await assertMeasurable(page, "verify-overlays-panel-behaviour");
  await page.goto(`${BASE}#/project/S/site`, { waitUntil: "load" });
  await page.waitForTimeout(3200);
  await page.evaluate(() => document.querySelector('[data-rail-tab="references"]')?.click());
  await page.waitForTimeout(800);
  return { ctx, page, errs };
}
const order = (page) => page.evaluate(() => Array.from(document.querySelectorAll("[data-overlay-row]")).map((n) => n.getAttribute("data-overlay-row")));
const stored = (page) => page.evaluate(() => { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return (m.S && m.S.sheetOverlays) || []; });
const undo = async (page) => { await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await page.locator('button[aria-label="Undo"]').click(); await page.waitForTimeout(350); };
const sub = (page, id) => page.locator(`[data-overlay-row="${id}"] [data-testid="overlay-row-sub"]`).first().innerText();
const open = async (page, id) => { const row = page.locator(`[data-overlay-row="${id}"]`); if ((await page.locator(`[data-testid="overlay-open-${id}"]`).count()) === 0) await page.locator(`[data-testid="reference-open-${id}"]`).click(); await page.waitForTimeout(300); return row; };
async function menuPick(page, id, label) {
  await page.locator(`[data-testid="reference-more-${id}"]`).click();
  await page.waitForTimeout(250);
  await page.locator(`[role=menuitem]`, { hasText: new RegExp(`^${label}$`) }).click();
  await page.waitForTimeout(350);
}

{
  const { ctx, page, errs } = await boot();
  // known-good arm: the seeded rows are all present, front-most first (array is back→front: a1,b2,c3 ⇒ c3,b2,a1)
  ok(JSON.stringify(await order(page)) === JSON.stringify(["c3", "b2", "a1"]), "known-good: rows render front-most first (c3, b2, a1)");
  ok((await sub(page, "b2")) === "not scaled", "the unscaled image row reads 'not scaled'");
  ok((await sub(page, "a1")) === `1" = 30'`, "the PDF row reads its ratio");
  ok(!/not scaled/.test(await sub(page, "c3")), "a legacy overlay (no flag) shows no amber");

  // ---- rename from a row that is NOT open (review defect 1: the selection effect used to eat it) -----
  await menuPick(page, "b2", "Rename…");
  ok((await page.locator('[data-testid="overlay-rename-input"]').count()) === 1, "Rename… on a row that is not open still opens the inline editor");
  await page.locator('[data-testid="overlay-rename-input"]').press("Escape"); await page.waitForTimeout(250);
  ok((await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-testid"))) === "reference-more-b2", "after Esc focus returns to the row's ⋯ button");
  // ---- rename + undo -------------------------------------------------------------------------
  await open(page, "c3");
  await menuPick(page, "c3", "Rename…");
  const inp = page.locator('[data-testid="overlay-rename-input"]');
  ok((await inp.count()) === 1, "Rename… opens an INLINE editor (no dialog)");
  await inp.fill("Charlie renamed"); await inp.press("Enter"); await page.waitForTimeout(300);
  ok((await page.locator('[data-overlay-row="c3"] [data-testid="overlay-row-name"]').innerText()) === "Charlie renamed", "rename commits on Enter");
  ok((await stored(page)).find((o) => o.id === "c3")?.name === "Charlie renamed", "rename is saved");
  await undo(page);
  ok((await page.locator('[data-overlay-row="c3"] [data-testid="overlay-row-name"]').innerText()) === "Charlie.png", "UNDO restores the old name (name is in the history signature)");
  await menuPick(page, "c3", "Rename…");
  await page.locator('[data-testid="overlay-rename-input"]').fill("Nope"); await page.locator('[data-testid="overlay-rename-input"]').press("Escape"); await page.waitForTimeout(250);
  ok((await page.locator('[data-overlay-row="c3"] [data-testid="overlay-row-name"]').innerText()) === "Charlie.png", "Esc cancels a rename");

  // ---- keyboard-only ⋯ menu → Move down; undo ------------------------------------------------
  await page.locator('[data-testid="reference-more-c3"]').focus();
  await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  const firstFocused = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  ok(firstFocused === "Rename…", `opening the menu with the keyboard focuses its first item (${firstFocused})`);
  for (let i = 0; i < 15; i++) { if ((await page.evaluate(() => document.activeElement && document.activeElement.textContent)) === "Move down") break; await page.keyboard.press("ArrowDown"); }   // …to "Move down" (the disabled "Move up" is skipped)
  const nowOn = await page.evaluate(() => document.activeElement && document.activeElement.textContent);
  ok(nowOn === "Move down", `ArrowDown walks the menu (landed on "${nowOn}")`);
  await page.keyboard.press("Enter"); await page.waitForTimeout(350);
  ok(JSON.stringify(await order(page)) === JSON.stringify(["b2", "c3", "a1"]), "keyboard-only Move down reorders (b2, c3, a1)");
  await undo(page);
  ok(JSON.stringify(await order(page)) === JSON.stringify(["c3", "b2", "a1"]), "UNDO puts the order back");
  await page.locator('[data-testid="reference-more-c3"]').click(); await page.waitForTimeout(250);
  ok((await page.locator("[role=menuitem]", { hasText: /^Move up$/ }).isDisabled()), "Move up is disabled at the front");
  await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  ok((await page.locator('[data-testid="overlay-row-menu"]').count()) === 0, "Escape closes the menu");

  // ---- Move up from the menu, reload keeps the order ------------------------------------------
  await menuPick(page, "a1", "Move up");
  ok(JSON.stringify(await order(page)) === JSON.stringify(["c3", "a1", "b2"]), "Move up (menu) reorders (c3, a1, b2)");
  ok(JSON.stringify((await stored(page)).map((o) => o.id)) === JSON.stringify(["b2", "a1", "c3"]), "the new order is what is SAVED (array = draw order)");
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('[data-rail-tab="references"]')?.click()); await page.waitForTimeout(700);
  ok(JSON.stringify(await order(page)) === JSON.stringify(["c3", "a1", "b2"]), "RELOAD keeps the reordered list");

  // ---- drag reorder with a mouse; canvas is untouched ----------------------------------------
  const selBefore = await page.evaluate(() => document.querySelectorAll('[data-testid="planner-canvas"] [data-handle-layer] *').length);
  const viewBefore = await page.evaluate(() => { const c = document.querySelector('[data-testid="planner-canvas"]'); return [c.getAttribute("data-view-ppf"), c.getAttribute("data-view-offx"), c.getAttribute("data-view-offy")].join(","); });
  await page.locator('[data-overlay-row="b2"] [data-overlay-drag-handle]').dragTo(page.locator('[data-overlay-row="c3"] [data-overlay-drag-handle]'), { targetPosition: { x: 40, y: 4 } });
  await page.waitForTimeout(500);
  ok(JSON.stringify(await order(page)) === JSON.stringify(["b2", "c3", "a1"]), `mouse drag reorders (b2 dropped in front of c3): ${JSON.stringify(await order(page))}`);
  const viewAfter = await page.evaluate(() => { const c = document.querySelector('[data-testid="planner-canvas"]'); return [c.getAttribute("data-view-ppf"), c.getAttribute("data-view-offx"), c.getAttribute("data-view-offy")].join(","); });
  ok(viewBefore === viewAfter, `a row drag never pans or zooms the canvas (${viewBefore} → ${viewAfter})`);
  ok(JSON.stringify((await stored(page)).map((o) => o.id)) === JSON.stringify(["a1", "c3", "b2"]), "the dragged order is SAVED");
  await undo(page);
  ok(JSON.stringify(await order(page)) === JSON.stringify(["c3", "a1", "b2"]), "UNDO reverts a drag reorder");

  // ---- Draws -----------------------------------------------------------------------------------
  await open(page, "a1");
  await page.locator('[data-testid="reference-above-a1"]').click(); await page.waitForTimeout(300);
  ok((await page.locator('[data-overlay-row="a1"]').getAttribute("data-reference-band")) === "above", "Draws → In front sets the band");
  ok((await order(page))[0] === "a1", "an in-front overlay lists first (front of everything)");
  await undo(page);
  ok((await page.locator('[data-overlay-row="a1"]').getAttribute("data-reference-band")) === "below", "UNDO returns it to Behind the plan");

  // ---- rotation ---------------------------------------------------------------------------------
  const rot = () => page.locator('[data-testid="overlay-rotation"]').inputValue();
  await page.locator('[data-testid="overlay-rot-plus"]').click(); await page.waitForTimeout(250);
  ok((await rot()) === "1", "+ rotates exactly 1°");
  await page.locator('[data-testid="overlay-rot-cw90"]').click(); await page.waitForTimeout(250);
  ok((await rot()) === "91", "90° clockwise adds 90 (91)");
  await page.locator('[data-testid="overlay-rot-ccw90"]').click(); await page.waitForTimeout(250);
  ok((await rot()) === "1", "90° anticlockwise subtracts 90 (back to 1)");
  await page.locator('[data-testid="overlay-rot-minus"]').click(); await page.locator('[data-testid="overlay-rot-minus"]').click(); await page.waitForTimeout(250);
  ok((await rot()) === "359", "− wraps below 0 (359)");
  const typed = page.locator('[data-testid="overlay-rotation"]'); await typed.fill("45.5"); await typed.press("Enter"); await page.waitForTimeout(250);
  ok((await rot()) === "45.5", "the value is typeable (45.5)");
  for (let i = 0; i < 6; i++) await undo(page);
  ok((await rot()) === "0", `undo steps back through each rotation (6 undos → ${await rot()})`);

  // ---- opacity ----------------------------------------------------------------------------------
  const pct = page.locator('[data-testid="overlay-opacity-pct"]'); await pct.click(); await pct.fill("40"); await pct.blur(); await page.waitForTimeout(250);
  ok((await stored(page)).find((o) => o.id === "a1").opacity === 0.4, "opacity % writes the overlay");

  // ---- Set scale preset: ratio changes; reload keeps it ------------------------------------------
  await page.locator('[data-testid="overlay-scale-set"]').click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="overlay-scale-preset"]').selectOption("eng-60"); await page.waitForTimeout(400);
  ok((await sub(page, "a1")) === `1" = 60'`, "Set scale → a preset changes the ratio on the row");
  ok((await page.locator('[data-testid="overlay-scale-ratio"]').innerText()) === `1" = 60'`, "…and in Placement");
  await page.reload({ waitUntil: "load" }); await page.waitForTimeout(3000);
  await page.evaluate(() => document.querySelector('[data-rail-tab="references"]')?.click()); await page.waitForTimeout(700);
  ok((await sub(page, "a1")) === `1" = 60'`, "RELOAD keeps the scale");

  // ---- Trace a length clears 'not scaled' ---------------------------------------------------------
  await open(page, "b2");
  ok((await page.locator('[data-testid="overlay-not-scaled"]').count()) === 1, "the unscaled image shows the amber box");
  await page.locator('[data-testid="overlay-scale-trace"]').click(); await page.waitForTimeout(400);
  ok((await page.locator('[data-testid="overlay-calib-status"]').count()) === 1, "Trace a length opens its guidance INLINE under the buttons");
  const cv = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  await page.mouse.click(cv.x + cv.width * 0.5, cv.y + cv.height * 0.5); await page.waitForTimeout(250);
  await page.mouse.click(cv.x + cv.width * 0.5 + 120, cv.y + cv.height * 0.5); await page.waitForTimeout(400);
  const ne = page.locator("input.num-edit-field"); ok((await ne.count()) === 1, "after two clicks the length is typed IN PLACE");
  await ne.fill("100"); await ne.press("Enter"); await page.waitForTimeout(500);
  ok((await page.locator('[data-testid="overlay-not-scaled"]').count()) === 0, "a traced length clears the amber box");
  ok((await sub(page, "b2")) !== "not scaled", `…and the row no longer says "not scaled" (${await sub(page, "b2")})`);
  ok((await stored(page)).find((o) => o.id === "b2").unscaled === false, "the flag is saved as unscaled:false");
  await undo(page);
  ok((await sub(page, "b2")) === "not scaled", "UNDO of the trace brings the amber back");

  // ---- Remove overlay + undo -----------------------------------------------------------------------
  await menuPick(page, "c3", "Remove overlay");
  ok(!(await order(page)).includes("c3"), "⋯ → Remove overlay removes it");
  await undo(page);
  ok((await order(page)).includes("c3"), "UNDO brings it back");

  ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs[0] : ""));
  await page.screenshot({ path: OUT + "overlays-panel-behaviour.png" });
  await ctx.close();
}

{ // ---- Add overlay: an image is born "not scaled" ------------------------------------------------------
  const { ctx, page } = await boot();
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC", "base64");
  writeFileSync("/tmp/ovl-new.png", png);
  await page.locator('[data-testid="overlay-file-input"]').setInputFiles("/tmp/ovl-new.png");
  await page.waitForTimeout(2500);
  const ids = await order(page);
  ok(ids.length === 4, `Add overlay adds a row (${ids.length} rows)`);
  const nid = ids[0];
  ok((await sub(page, nid)) === "not scaled", "a newly added image is born 'not scaled'");
  ok(!/=/.test(await sub(page, nid)), "…and shows no ratio");
  await ctx.close();
}

{ // ---- touch: row dragging OFF, ⋯ → Move is the path ------------------------------------------------------
  const { ctx, page } = await boot({ hasTouch: true, isMobile: false, viewport: { width: 1440, height: 1000 } });
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  if (coarse) {
    ok((await page.locator('[data-overlay-drag-handle="1"]').count()) === 0, "coarse pointer: no draggable rows");
    await menuPick(page, "a1", "Move up");
    ok((await order(page))[1] === "a1" || (await order(page))[0] === "a1", "…Move up still reorders on touch");
  } else {
    console.log("• (this Chromium build reports a fine pointer under hasTouch — the coarse-pointer arm is asserted by phone layout in verify-overlays-panel-layout)");
  }
  await ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
