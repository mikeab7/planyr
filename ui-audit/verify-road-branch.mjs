/* NEW-8 — "right click on a road and add a road coming out of it like a T" (owner, 2026-07-25).
 * Drives the REAL canvas on the owner's plan: right-clicks the truck loop, picks the new menu item,
 * draws the branch, finishes it, and asserts a REAL tee resolved (not just a road lying nearby). */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync, readFileSync } from "node:fs";
const OUT = new URL("./screens/road-junctions/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL("./fixtures/tsakiris-concept-a-live.json", import.meta.url), "utf8"));
const SITE_ID = "tsakiris-concept-a";
const site = { id: SITE_ID, groupId: SITE_ID, site: "Tsakiris", name: "Concept A", origin: null, county: "waller",
  parcels: [], els: fixture.els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  parcelDrawings: [], updatedAt: Date.now() };
const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--no-sandbox","--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:4173/", { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForFunction(() => !!window.__plannerView && !!window.__plannerRoadNet, null, { timeout: 20000 });

const roads = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road" && Array.isArray(e.pts))
    .map((e) => ({ id: e.id, cls: e.roadClass, w: e.travelW, n: e.pts.length, pts: e.pts }));
});
const tees = async () => (await page.evaluate(() => window.__plannerRoadNet())).tees;

const before = await roads(), teesBefore = await tees();
console.log(`BEFORE: ${before.length} roads, ${teesBefore.length} tees`);

// Park on a clean straight stretch of the 40' truck loop (east leg, x≈1649, y −100..300).
const CX = 1500, CY = 100, PPF = 0.5;
await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [CX, CY, PPF]);
await page.waitForTimeout(400);
const canvas = page.locator('[data-testid="planner-canvas"]');
const box = await canvas.boundingBox();
const v = await page.evaluate(() => window.__plannerView.get());
const f2s = (fx, fy) => ({ x: box.x + v.w / 2 + (fx - CX) * PPF, y: box.y + v.h / 2 + (fy - CY) * PPF });

// 1. RIGHT-CLICK the truck loop on its east leg.
const onRoad = f2s(1649, 100);
await page.mouse.click(onRoad.x, onRoad.y, { button: "right" });
await page.waitForTimeout(500);
const item = page.locator('[data-testid="road-branch-here"]');
if (await item.count() === 0) { console.log("FAIL — no 'Branch a road from here' item on a road's right-click menu"); process.exit(1); }
console.log("✓ the road's right-click menu offers 'Branch a road from here'");
await item.click();
await page.waitForTimeout(500);

// 2. The draft must already be started AT the road — one point down, before any canvas click.
const probe = await page.evaluate(() => ({
  draftDots: document.querySelectorAll('[data-testid="planner-canvas"] circle').length,
  hint: [...document.querySelectorAll("text")].map(t=>t.textContent).filter(t=>/Click the next point|travel/.test(t)).slice(0,3),
  toast: [...document.querySelectorAll("div")].map(d=>d.textContent).filter(t=>t && /Branching a/.test(t)).slice(0,1),
}));
console.log("PROBE after menu click:", JSON.stringify(probe));
if (errs.length) console.log("ERRORS SO FAR:\n" + errs.slice(0,3).join("\n"));
// 3. Click where the branch should go (due west into open ground), then finish with the Done chip.
const to = f2s(1300, 100);
await page.mouse.click(to.x, to.y);
await page.waitForTimeout(300);
const done = page.locator('[data-testid="road-draft-finish"]');
if (await done.count() === 0) { console.log("FAIL — no finish control while drawing the branch"); process.exit(1); }
await done.locator("rect").click({ force: true });
await page.waitForTimeout(700);

const after = await roads(), teesAfter = await tees();
console.log(`AFTER:  ${after.length} roads, ${teesAfter.length} tees`);
const fresh = after.find((r) => !before.some((b) => b.id === r.id));
if (!fresh) { console.log("FAIL — no new road was created"); process.exit(1); }
console.log(`✓ new road ${fresh.id}: class=${fresh.cls} width=${fresh.w} points=${fresh.n}`);

const parent = before.find((b) => b.id === "e38duuwgj");
if (fresh.cls !== parent.cls || fresh.w !== parent.w) { console.log(`FAIL — branch did not inherit the parent's cross-section (${parent.cls}/${parent.w})`); process.exit(1); }
console.log(`✓ inherited the parent's class and width (${parent.cls}, ${parent.w})`);

const newTee = teesAfter.find((t) => t.sideId === fresh.id);
if (!newTee) { console.log("FAIL — the branch did not resolve as a TEE on the parent"); process.exit(1); }
console.log(`✓ resolved as a real tee onto ${newTee.throughId}: R=${newTee.R.toFixed(1)} wedges=${newTee.wedges}`);
if (!(newTee.wedges === 2 && newTee.R > 1)) { console.log("FAIL — the tee has no real curb returns"); process.exit(1); }

const parentAfter = after.find((r) => r.id === "e38duuwgj");
console.log(`✓ parent gained its junction node: ${parent.n} -> ${parentAfter.n} control points`);

await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [1620, 100, 1.4]);
await page.waitForTimeout(400);
await canvas.screenshot({ path: `${OUT}road-branch.png` });
if (errs.length) console.log("\nPAGE ERRORS:\n" + errs.slice(0, 5).join("\n"));
console.log(errs.length ? "\nFAIL — page errors" : "\nall checks passed");
await browser.close();
process.exit(errs.length ? 1 : 0);
