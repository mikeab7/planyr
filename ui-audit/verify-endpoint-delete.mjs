#!/usr/bin/env node
/* verify-endpoint-delete — NEW-1/B649504.
 *
 * Owner report, verbatim: "i should be able to delete end points for roads, easements, anything
 * similar that makes sense." Measured live on plan smsz866fuql0: a 3-point road's MIDDLE vertex
 * offered an enabled "Delete control point"; either ENDPOINT offered the same row DISABLED, labeled
 * "(min reached)" — false, since a 3-point road is above the true 2-point minimum. The bug was a
 * road-only "no endpoint delete" exclusion (`canRemoveRoadVertex`/`removeRoadVertex` in
 * roadGeometry.js), which every other vertex-edited element type (parcels, buildings/paving/
 * sidewalk/parking/pond, measurements, markups, easements) never had.
 *
 * This drives the REAL built app and reproduces the owner's exact repro shape, then the fix:
 *   1. Draw a 3-point road. Right-click the START endpoint. Expect ENABLED "Delete control point"
 *      (not "min reached"). Click it. Expect the road shortens to 2 points (start removed, the old
 *      middle vertex is the new start) — the CAD/GIS "shorten the line" behavior the owner asked for.
 *   2. On the now-2-point road, right-click its remaining endpoint. Expect the dead disabled row is
 *      GONE, replaced by an actionable "Delete road". Click it. Expect the road is gone entirely.
 *   3. Same shape for an EASEMENT (centerline/strip mode, 2-point minimum): right-click its endpoint
 *      at the 2-point floor. Expect "Delete easement", not a disabled row. Click it, expect it's gone.
 *
 * Run:  node ui-audit/verify-endpoint-delete.mjs      (needs preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/endpoint-delete/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-endpoint-delete");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try {
  await page.getByTestId("map-start-blank-menu-btn").click({ timeout: 8000 });
  await page.getByTestId("map-start-blank-menu-item").click({ timeout: 8000 });
} catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(600);

const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();
await canvas.click({ position: { x: 30, y: 30 } }); // dismiss any first-run affordance

const roads = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts))
    .map((e) => ({ id: e.id, n: e.pts.length, pts: e.pts.map((p) => [Math.round(p.x), Math.round(p.y)]) }));
});
const easements = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.markups || []).filter((mk) => mk.kind === "easement");
});

/* The menu is the shared shared/ui/ContextMenu.jsx portal — role="menu" at document.body. */
const menuButtonText = async () => {
  const menu = page.locator('[role="menu"]');
  await menu.waitFor({ state: "visible", timeout: 3000 });
  return (await menu.locator("button").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
};
const menuButtonIsDisabled = async (matchRe) => {
  const menu = page.locator('[role="menu"]');
  const btns = menu.locator("button");
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    const t = (await b.innerText()).replace(/\s+/g, " ").trim();
    if (matchRe.test(t)) return { text: t, disabled: await b.isDisabled() };
  }
  return null;
};

// ============================================================ ROAD ============================================================
console.log("\n=== ROAD — 3-point draw, endpoint delete, then whole-road delete at the 2-pt floor ===");
async function pickRoad() {
  await page.getByRole("button", { name: "Road", exact: true }).click();
}
await pickRoad();
const START = { x: box.x + 260, y: box.y + 250 };
const TURN = { x: box.x + 900, y: box.y + 250 };
const END = { x: box.x + 900, y: box.y + 700 };
await page.mouse.click(START.x, START.y);
await page.mouse.click(TURN.x, TURN.y);
await page.mouse.click(END.x, END.y);
const done = page.locator('[data-testid="road-draft-finish"]');
if (await done.count() === 0) { console.log("FAIL — no on-canvas finish affordance while drafting a road"); process.exit(1); }
await done.click({ force: true });
await pacedWait(page, 400);

let r0 = await roads();
check("road drawn with 3 points", r0.length === 1 && r0[0].n === 3, JSON.stringify(r0));
const turnFeet = r0[0]?.pts?.[1];

// Right-click the START endpoint (index 0).
await page.mouse.click(START.x, START.y, { button: "right" });
await pacedWait(page, 250);
let row = await menuButtonIsDisabled(/Delete control point/);
check('3-pt road START endpoint: "Delete control point" is ENABLED (not "min reached")', !!row && !row.disabled && !/min reached/.test(row.text), row ? row.text : "row not found");
await page.locator('[role="menu"] button', { hasText: "Delete control point" }).click();
await pacedWait(page, 300);

let r = await roads();
check("deleting the START endpoint SHORTENS the road to 2 points", r.length === 1 && r[0].n === 2, JSON.stringify(r));
check("the shortened road's new start is the OLD middle vertex (the turn), in feet", r.length === 1 && turnFeet && r[0].pts[0][0] === turnFeet[0] && r[0].pts[0][1] === turnFeet[1], JSON.stringify({ turnFeet, newStart: r[0]?.pts?.[0] }));

// Now at the true 2-point floor — right-click the remaining endpoint. Nothing panned/zoomed since
// it was placed, so it's still exactly at the screen point where the "turn" click landed (TURN).
await page.mouse.click(TURN.x, TURN.y, { button: "right" });
await pacedWait(page, 250);
const menuTexts = await menuButtonText();
check('2-pt road at the floor: menu offers "Delete road" (no dead "min reached" row)', menuTexts.some((t) => /Delete road/i.test(t)) && !menuTexts.some((t) => /min reached/i.test(t)), JSON.stringify(menuTexts));
await page.locator('[role="menu"] button', { hasText: "Delete road" }).click();
await pacedWait(page, 300);
r = await roads();
check("clicking Delete road removes the whole road", r.length === 0, JSON.stringify(r));

await canvas.screenshot({ path: `${OUT}road-after.png` });

// ============================================================ EASEMENT ============================================================
console.log("\n=== EASEMENT — 2-point centerline strip, endpoint at the true floor ===");
await page.getByRole("button", { name: "Easement", exact: true }).click();
await pacedWait(page, 200);
const E0 = { x: box.x + 300, y: box.y + 500 };
const E1 = { x: box.x + 700, y: box.y + 500 };
await page.mouse.click(E0.x, E0.y);
await page.mouse.click(E1.x, E1.y);
await page.keyboard.press("Enter");
await pacedWait(page, 400);

let ez = await easements();
check("easement drawn with 2 points", ez.length === 1, JSON.stringify(ez.map((m) => m.centerline?.length)));

if (ez.length === 1) {
  // Right-click near its first control point (the centerline strip's start).
  await page.mouse.click(E0.x, E0.y, { button: "right" });
  await pacedWait(page, 250);
  const eTexts = await menuButtonText();
  check('2-pt easement at the floor: menu offers "Delete easement" (no dead "min reached" row)', eTexts.some((t) => /Delete easement/i.test(t)) && !eTexts.some((t) => /min reached/i.test(t)), JSON.stringify(eTexts));
  if (eTexts.some((t) => /Delete easement/i.test(t))) {
    await page.locator('[role="menu"] button', { hasText: "Delete easement" }).click();
    await pacedWait(page, 300);
    ez = await easements();
    check("clicking Delete easement removes it", ez.length === 0, JSON.stringify(ez));
  }
}

await canvas.screenshot({ path: `${OUT}easement-after.png` });

// ============================================================ MEASUREMENT ============================================================
console.log("\n=== MEASUREMENT — 2-point Length measurement, always at its own 2-point floor ===");
const measures = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.measures || []).filter((mm) => mm && (mm.mode === "line" || (mm.a && mm.b)));
});
await page.getByRole("button", { name: "Measure", exact: true }).click();
await pacedWait(page, 200);
const M0 = { x: box.x + 300, y: box.y + 650 };
const M1 = { x: box.x + 700, y: box.y + 650 };
await page.mouse.click(M0.x, M0.y);
await page.mouse.click(M1.x, M1.y);
await pacedWait(page, 300);
let ms = await measures();
check("length measurement drawn with 2 points (its own mode floor)", ms.length === 1, JSON.stringify(ms));

if (ms.length === 1) {
  // Length mode auto-commits (no explicit finish) and doesn't auto-select — switch to Select and
  // click the drawn line to select it before right-clicking its endpoint.
  await page.getByRole("button", { name: /^Select /i }).click();
  await pacedWait(page, 150);
  await page.mouse.click(Math.round((M0.x + M1.x) / 2), M0.y);
  await pacedWait(page, 200);
  await page.mouse.click(M0.x, M0.y, { button: "right" });
  await pacedWait(page, 250);
  const mTexts = await menuButtonText().catch(() => null);
  if (mTexts) {
    check('2-pt measurement at the floor: menu offers "Delete measurement" (no dead "min reached" row)', mTexts.some((t) => /Delete measurement/i.test(t)) && !mTexts.some((t) => /min reached/i.test(t)), JSON.stringify(mTexts));
    if (mTexts.some((t) => /Delete measurement/i.test(t))) {
      await page.locator('[role="menu"] button', { hasText: "Delete measurement" }).click();
      await pacedWait(page, 300);
      ms = await measures();
      check("clicking Delete measurement removes it", ms.length === 0, JSON.stringify(ms));
    }
  } else {
    check('2-pt measurement at the floor: menu offers "Delete measurement"', false, "context menu never opened — could not select/right-click the measurement endpoint");
  }
}

await canvas.screenshot({ path: `${OUT}measure-after.png` });

console.log(`\nshots → ${OUT}`);
if (errs.length) console.log("\nPAGE ERRORS:\n" + errs.slice(0, 5).join("\n"));

const pass = results.filter((r) => r.ok).length;
console.log(`\n${pass}/${results.length} checks passed`);
await browser.close();
process.exit(results.every((r) => r.ok) ? 0 : 1);
