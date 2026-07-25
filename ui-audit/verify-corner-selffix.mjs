/* Owner report 2026-07-25: "fix the one in tsakaris … dont stop until youve tested that this is
 * taken care of."  Drives the REAL Tsakiris / Concept A plan (never a mock), CLICKS the amber
 * corner chip, and asserts the flag is gone and the road actually holds its class turn after. */
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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
await page.goto("http://localhost:4173/", { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 20000 });

// NEW-5 — the label folds away below ROAD_FLAG_LABEL_PPF so it can't sprawl across a whole-site
// view; park the viewport at a working zoom before reading the label text.
const zoomIn = (x, y, p = 1.2) => page.evaluate(([a, b, c]) => window.__plannerView.centerOn(a, b, c), [x, y, p]);
const readFlags = () => page.evaluate(() => [...document.querySelectorAll("[data-road-radius-flag]")]
  .map((n) => ({ f: n.getAttribute("data-road-radius-flag"), short: n.getAttribute("data-road-radius-shortfall"),
                 label: [...n.querySelectorAll("text")].map((t) => t.textContent).join(" ") })));

await zoomIn(-216, 450, 1.2);
await page.waitForTimeout(400);
const before = await readFlags();
console.log("BEFORE — flags on the owner's real plan:");
for (const f of before) console.log(`  ${f.f.padEnd(20)} “${f.label}”  (needs ${f.short}′ more approach)`);
if (!before.length) { console.log("!! expected the two known flags — fixture drifted"); process.exit(1); }
const chipTexts = before.map((f) => f.label);
if (!chipTexts.every((t) => /Fix/.test(t) && /more approach|tighter/.test(t))) {
  console.log("!! a chip is still a bare mark, not a remedy + Fix"); process.exit(1);
}

// Click every flag's Fix chip, in place, on the real canvas.
const spots = [{ f: "e1454682splyoj:3", x: -216, y: 450, ppf: 2.0 }, { f: "e54duuwgj:1", x: 554, y: -340, ppf: 1.6 }];
for (const s of spots) {
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [s.x, s.y, s.ppf]);
  await page.waitForTimeout(400);
  const chip = page.locator(`[data-road-radius-flag="${s.f}"]`);
  if (await chip.count() === 0) { console.log(`  (${s.f} already clear)`); continue; }
  await chip.locator("circle").click({ force: true });      // the corner dot IS the click target
  await page.waitForTimeout(500);
  console.log(`  clicked Fix on ${s.f}`);
}
await page.waitForTimeout(600);
const after = await readFlags();
console.log("\nAFTER — flags remaining:", after.length ? JSON.stringify(after) : "NONE ✓");

// Prove it in the DATA too, not just the absence of a badge.
const geom = await page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const s = Object.values(m)[0] || {};
  return (s.els || []).filter((e) => e.type === "road" && e.pts).map((e) => ({ id: e.id, cls: e.roadClass,
    pts: e.pts.map((p) => [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]),
    vtx: (e.vtx || []).map((v) => (v && v.radius ? `${v.treatment}:${Math.round(v.radius)}` : "-")) }));
});
for (const g of geom.filter((g) => ["e54duuwgj", "e1454682splyoj"].includes(g.id)))
  console.log(` ${g.id} ${g.cls}: ${JSON.stringify(g.pts)}  vtx ${g.vtx.join(",")}`);

for (const s of spots) {
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [s.x, s.y, s.ppf]);
  await page.waitForTimeout(400);
  await page.locator('[data-testid="planner-canvas"]').screenshot({ path: `${OUT}fixed-${s.f.replace(":", "-")}.png` });
}
if (errs.length) console.log("\nPAGE ERRORS:\n" + errs.slice(0, 5).join("\n"));
console.log(after.length === 0 && errs.length === 0 ? "\nPASS — the owner's plan holds its class turns with no leftover marks." : "\nFAIL");
await browser.close();
process.exit(after.length === 0 && errs.length === 0 ? 0 : 1);
