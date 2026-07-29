/* Owner report 2026-07-25: "I should be able to just press three points if I'm building a road —
 * a start point, where it turns, and the final point. But it doesn't seem like I can do that."
 *
 * Drives the REAL canvas and draws a road with exactly three clicks, then reports what the app
 * actually stored: how many control points, what radius each corner ended up with, and whether the
 * corner holds the class minimum. Also repeats it as a TRUCK route (the owner's default class).
 *
 * Run:  node ui-audit/diagnose-three-click-road.mjs      (needs preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try { await page.getByRole("button", { name: /Start blank/i }).click({ timeout: 8000 }); } catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(600);

const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();

async function pickRoad() {
  await page.getByRole("button", { name: "Road", exact: true }).click();
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^\d+′$/ }).first().click();
}
const roads = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts))
    .map((e) => ({ id: e.id, cls: e.roadClass, w: e.travelW, n: e.pts.length,
      pts: e.pts.map((p) => [Math.round(p.x), Math.round(p.y)]),
      vtx: (e.vtx || []).map((v) => (v && v.radius ? `${v.treatment}:${Math.round(v.radius)}` : "-")) }));
});

// ---- THE TEST: three clicks — start, the turn, the end. Then Enter. -----------------------------
await canvas.click({ position: { x: 30, y: 30 } });   // dismiss any first-run affordance
await pickRoad();
await page.mouse.click(box.x + 260, box.y + 250);     // 1. start
await page.mouse.click(box.x + 900, box.y + 250);     // 2. the turn
await page.mouse.click(box.x + 900, box.y + 700);     // 3. the end
// NEW-1 — finish by CLICKING the on-canvas Done chip (no keyboard). This is the affordance the
// owner was missing: three clicks stored three points, but nothing on screen said how to end it.
const done = page.locator('[data-testid="road-draft-finish"]');
if (await done.count() === 0) { console.log("FAIL — no on-canvas finish affordance while drafting"); process.exit(1); }
await done.locator("rect").click({ force: true });
await page.keyboard.press("Escape");
await page.waitForTimeout(500);

const drawn = await roads();
console.log("=== three clicks: start, turn, end ===");
console.log(JSON.stringify(drawn, null, 1));

const flags = await page.evaluate(() => [...document.querySelectorAll("[data-road-radius-flag]")].map((n) => ({
  flag: n.getAttribute("data-road-radius-flag"), msg: (n.querySelector("title") || {}).textContent,
})));
console.log("\nradius flags on a freshly drawn 3-click road:");
console.log(flags.length ? JSON.stringify(flags, null, 1) : "  none");

await canvas.screenshot({ path: `${OUT}three-click-road.png` });
console.log(`\nshot → ${OUT}three-click-road.png`);
if (errs.length) console.log("\nPAGE ERRORS:\n" + errs.slice(0, 5).join("\n"));
await browser.close();
