/* verify-layer-click-only-live — B2507060 / B2507061 / B2507062 (owner constraints #42, #43, #45), LIVE, signed in as the test account.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-layer-click-only-live.mjs [https://planyr.io | a branch preview] [--expect-sha <sha>] [--shots <dir>] [--view 34.9615,-89.8299,15]
 *
 * On the MAP view (the Leaflet surface), over Olive Branch with Zoning + Counties & Cities on:
 *   1. every layer starts at 100% opacity (the Zoning row's ▾ reads 100%);
 *   2. HOVER does nothing at all — the pointer is swept across the map in a grid; after every stop there is no tooltip, no popup, and the set of drawn stroke colours is
 *      identical to the set before the first hover (no red outline, ever; the owner's report: "each hovered polygon gets a red outline that never clears");
 *   3. a CLICK on a zoning polygon opens a card with plain labels (no ZONE / CASE_NO / OBJECTID / Shape.* / CONVERSION_STATUS, no empty row, no raw URL) and EXACTLY ONE
 *      outlined feature; a click on a different polygon moves the outline (still one); closing the card leaves zero; a click on empty map leaves zero.
 * KNOWN-GOOD arm: the click highlight colour IS found after a click (so "zero outlined" after a hover is a reading of a working instrument, not a blind one).
 * FOREGROUND-OR-VOID first. Nothing is written to the account. */
import { mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const flag = (n, d = null) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha"), SHOTS = flag("--shots");
const [VLAT, VLNG, VZ] = flag("--view", "34.9615,-89.8299,15").split(",").map(Number);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const HILITE = "#f97316"; // boundaryStyle.CLICK_HIGHLIGHT_COLOR
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
await assertMeasurable(page, "verify-layer-click-only-live");
await page.setViewportSize({ width: 1400, height: 900 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);

await page.goto(BASE + "/?planyrDiag=1#/site", { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !!window.__mapFinderMap && !!document.querySelector('[data-testid="layer-panel"][data-surface="finder"]'), null, { timeout: 60000 });
await sleep(1500);
await page.evaluate(([a, b, z]) => window.__mapFinderMap.setView([a, b], z, { animate: false }), [VLAT, VLNG, VZ]);
await sleep(1500);

const panel = page.locator('[data-testid="layer-panel"][data-surface="finder"]').first();
async function openGroupWith(id) {
  for (const g of ["jur", "util", "env", "flood", "access", "topo", "base"]) {
    const btn = panel.getByTestId(`layer-group-${g}`);
    if (await btn.count()) { await btn.click().catch(() => {}); await sleep(250); }
    else { const sel = panel.getByTestId("layer-group-select"); if (await sel.count()) { await sel.selectOption(g).catch(() => {}); await sleep(250); } }
    if (await panel.locator(`[data-testid="layer-row-${id}"]`).count()) return true;
  }
  return false;
}
async function turnOn(id) {
  if (!(await openGroupWith(id))) { check(`row "${id}" is offered at Olive Branch`, false); return false; }
  const cb = panel.locator(`[data-testid="layer-row-${id}"] input[type="checkbox"]`).first();
  if (!(await cb.isChecked())) await cb.check();
  return true;
}
await turnOn("counties_cities");
const zoningOn = await turnOn("ms_desoto_zoning");
await sleep(9000);

/* 1. opacity reads 100% on a row that was never touched */
if (zoningOn) {
  await openGroupWith("ms_desoto_zoning");
  await panel.getByTestId("layer-caret-ms_desoto_zoning").click().catch(() => {});
  await sleep(400);
  const pct = await panel.locator('[data-testid="layer-row-ms_desoto_zoning-menu"] input[type="text"]').first().inputValue().catch(() => null);
  check("1 · Zoning starts at 100% opacity", pct === "100", `reads ${pct}`);
  await panel.getByTestId("layer-caret-ms_desoto_zoning").click().catch(() => {});
}

/* helpers that read the Leaflet map's own DOM */
const mapBox = await page.evaluate(() => { const r = window.__mapFinderMap.getContainer().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const strokes = () => page.evaluate(() => {
  const set = {};
  window.__mapFinderMap.getContainer().querySelectorAll("path.leaflet-interactive, svg path[stroke]").forEach((p) => { const c = (p.getAttribute("stroke") || "").toLowerCase(); if (c) set[c] = (set[c] || 0) + 1; });
  return set;
});
const overlayState = () => page.evaluate(() => {
  const c = window.__mapFinderMap.getContainer();
  // permanent LABELS (pipe sizes, zone codes, county names) are tooltips too and stay — only a tooltip whose text was not there before the first hover counts
  return { tips: [...c.querySelectorAll(".leaflet-tooltip")].map((t) => t.textContent.trim()), popups: c.querySelectorAll(".leaflet-popup").length };
});
const hiliteCount = async () => (await strokes())[HILITE] || 0;

const baseTips = new Set((await overlayState()).tips);
const before = await strokes();
console.log("stroke colours before any hover:", JSON.stringify(before));
if (!Object.keys(before).length) { console.log("VOID: no vector strokes are in the map DOM — the instrument cannot see outlines (zoning not drawn, or drawn on canvas)"); voided++; }

/* 2. sweep the pointer: a 9 x 7 grid, with a pause at each stop */
let maxTip = 0, maxPop = 0, maxHi = 0;
for (let gy = 1; gy <= 7; gy++) for (let gx = 1; gx <= 9; gx++) {
  await page.mouse.move(mapBox.x + (mapBox.w * gx) / 10, mapBox.y + (mapBox.h * gy) / 8, { steps: 3 });
  await sleep(120);
  const o = await overlayState(); const fresh = o.tips.filter((t) => !baseTips.has(t)); if (fresh.length && process.env.DEBUG_CLICK) console.log("new tooltip text:", JSON.stringify(fresh)); maxTip = Math.max(maxTip, fresh.length); maxPop = Math.max(maxPop, o.popups); maxHi = Math.max(maxHi, await hiliteCount());
}
await sleep(1200);
const after = await strokes();
check("2 · hovering 63 points shows no tooltip", maxTip === 0, `${maxTip}`);
check("2 · hovering shows no popup/card", maxPop === 0, `${maxPop}`);
check("2 · hovering outlines nothing (no highlight colour ever drawn)", maxHi === 0, `${maxHi}`);
check("2 · after the sweep every stroke colour is exactly what it was before the first hover", JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/hover-nothing.png` });

/* 3. click: find points that open a zoning card (a point can land in a road gap — try a spread) */
async function clickUntilCard(points, skipText = null) {
  for (const [fx, fy] of points) {
    await page.mouse.click(mapBox.x + mapBox.w * fx, mapBox.y + mapBox.h * fy);
    await sleep(2200);
    const txt = await page.evaluate(() => (document.querySelector(".leaflet-popup-content") || {}).innerText || "");
    if (process.env.DEBUG_CLICK) console.log(`click ${fx},${fy} → popup: ${JSON.stringify(txt.slice(0, 120))}`);
    if (/Zoning|Zone/i.test(txt) && txt !== skipText) return { txt, fx, fy };
  }
  return null;
}
const spread = [[0.5, 0.5], [0.35, 0.4], [0.65, 0.4], [0.4, 0.65], [0.6, 0.65], [0.25, 0.5], [0.75, 0.5], [0.5, 0.3], [0.5, 0.75], [0.2, 0.3], [0.8, 0.7]];
const first = await clickUntilCard(spread);
if (!first) { console.log("VOID: no click opened a zoning card — nothing to judge"); voided++; }
else {
  console.log("card 1:\n" + first.txt.split("\n").map((l) => "   " + l).join("\n"));
  const bad = [/\bZONE\b/, /CASE_NO/, /OBJECTID/, /Shape[._]/i, /CONVERSION_STATUS/, /\bnull\b/i, /https?:\/\//];
  check("3 · the card shows no raw field name, no null row and no raw URL", !bad.some((re) => re.test(first.txt)), bad.filter((re) => re.test(first.txt)).map(String).join(" "));
  check("3 · the card is titled and has labelled rows (Zone / Jurisdiction)", /Zoning/.test(first.txt) && /Zone:/.test(first.txt) && /Jurisdiction:/.test(first.txt), "");
  const h1 = await hiliteCount();
  check("3 · KNOWN-GOOD: the click outlines exactly ONE feature", h1 === 1, `${h1}`);
  if (h1 === 0) { console.log("VOID: the instrument cannot see the click highlight — the zero readings above prove nothing"); voided++; }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/click-one-outline.png` });

  const second = await clickUntilCard(spread.filter(([x, y]) => Math.hypot(x - first.fx, y - first.fy) > 0.12), first.txt);
  if (second) {
    const h2 = await hiliteCount();
    check("3 · a click on a different polygon moves the outline — still exactly one", h2 === 1, `${h2}`);
  } else console.log("(no second distinct zoning card found — move check skipped)");

  await page.locator(".leaflet-popup-close-button").first().click().catch(() => {});
  await sleep(600);
  check("3 · closing the card leaves zero outlined", (await hiliteCount()) === 0, `${await hiliteCount()}`);

  await clickUntilCard([[first.fx, first.fy]]);
  await sleep(300);
  // empty map: the far top-left corner is outside the DeSoto zoning data at this zoom only if panned away — pan the map off the data and click
  await page.evaluate(() => window.__mapFinderMap.panBy([2400, 0], { animate: false }));
  await sleep(1500);
  await page.mouse.click(mapBox.x + mapBox.w * 0.5, mapBox.y + mapBox.h * 0.5);
  await sleep(1200);
  check("3 · clicking empty map leaves zero outlined and no card", (await hiliteCount()) === 0 && (await overlayState()).popups === 0, `${await hiliteCount()} / ${(await overlayState()).popups}`);
}
await s.browser.close().catch(() => {});
console.log(voided ? `VOID (${voided})` : failed ? `FAIL (${failed})` : "PASS");
process.exit(voided ? 2 : failed ? 1 : 0);
