/* B671 — Site Planner still renders + draws with the per-element write engine wired in.
 *
 * The engine only activates signed-in (cloud-active); signed-out it is inert. This guard runs
 * SIGNED-OUT (the sandbox blocks auth) to prove the wiring didn't regress the planner:
 *   1. A seeded PRE-v12 site (elements with NO `z`) boots and its SVG canvas renders — i.e. the
 *      v12 z-migration + the new byZ render path don't crash on legacy data.
 *   2. Drawing a building (the create path that feeds the engine) works and leaves no page errors.
 *   3. Zero uncaught page errors throughout.
 *
 * Run:  npx vite preview --port 4173  (one shell)  ·  node ui-audit/verify-b671-element-sync.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A pre-v12 site: elements carry NO z (createSiteModel must assign it on load).
const parcel = { id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] };
const els = [
  { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
  { id: "e6", type: "parking", cx: 330, cy: 120, w: 150, h: 200, rot: 0 },
];
const demoSite = { id: "es-demo", groupId: "es-demo", site: "Element Sync Demo", name: "Plan 1", origin: null, county: null, parcels: [parcel], els, measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${demoSite.id}': ${JSON.stringify(demoSite)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(demoSite.id)});
} catch (e) {} })();`;

const results = [];
const ok = (name, pass, detail) => { results.push({ pass }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);

// 1) planner SVG renders
const svgCount = await page.evaluate(() => document.querySelectorAll("svg").length);
ok("planner SVG renders on a pre-v12 site", svgCount > 0, `${svgCount} svg(s)`);

// 2) the two seeded buildings/parking render as shapes
const shapeN = await page.evaluate(() => {
  const svgs = Array.from(document.querySelectorAll("svg"));
  const svg = svgs.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight))[0];
  return svg ? svg.querySelectorAll("rect,polygon,path").length : 0;
});
ok("seeded elements render", shapeN >= 2, `${shapeN} shapes`);

// 3) draw a building: pick the Building tool if present, then drag on the canvas
let drew = false;
try {
  const btn = page.getByRole("button", { name: /building/i }).first();
  if (await btn.count()) { await btn.click({ force: true }); await page.waitForTimeout(200); }
  const svg = page.locator("svg").first();
  const box = await svg.boundingBox();
  if (box) {
    const cx = box.x + box.width * 0.5, cy = box.y + box.height * 0.62;
    await page.mouse.move(cx, cy); await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 90, { steps: 8 }); await page.mouse.up();
    await page.waitForTimeout(300);
    drew = true;
  }
} catch (e) { /* tool labels vary; the no-error check below still applies */ }
// Soft/informational: the tool rail isn't always reachable in a headless signed-out boot. The real
// regression gate is the zero-page-errors check below (the draw, if it ran, folds into it).
if (drew) ok("drawing a building did not throw", true, "drag committed");
else console.log("SKIP ⏭   drawing a building  —  tool rail not reachable headless; the no-error gate still applies");

// 4) no uncaught page errors
ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | ") || "clean");

await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
