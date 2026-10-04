#!/usr/bin/env node
/* shoot-siteplan-basemap — NEW-1 (B2018608). Before/after evidence on the SITE PLAN surfaces: the
 * planner canvas with a plan loaded, the Map view (map finder), and the real PDF export sheet.
 * Same script against the old build and the new one:
 *   node ui-audit/shoot-siteplan-basemap.mjs http://localhost:4174 --shots dir --tag before
 *   node ui-audit/shoot-siteplan-basemap.mjs http://localhost:4173 --shots dir --tag after
 * Vector tiles come from the synthetic source (lib/fakeVectorTiles.mjs) unless `--live`.
 * Esri imagery is real. The export SVG is captured exactly as verify-export-quality.mjs does. */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installFakeVectorSource, HOUSTON } from "./lib/fakeVectorTiles.mjs";

const a = process.argv.slice(2);
const val = (n, d) => (a.indexOf(n) >= 0 ? a[a.indexOf(n) + 1] : d);
const BASE = a.find((x) => /^https?:/.test(x)) || "http://localhost:4173";
const DIR = val("--shots", "/tmp/shots"); const TAG = val("--tag", "after"); const LIVE = a.includes("--live");
mkdirSync(DIR, { recursive: true });

const site = {
  id: "bm-demo", groupId: "bm-demo", site: "Basemap Demo", name: "Concept A",
  origin: { lat: HOUSTON.lat, lon: HOUSTON.lng }, county: "harris",
  parcels: [{ id: "pc1", locked: false, active: true, points: [{ x: -300, y: -200 }, { x: 300, y: -200 }, { x: 300, y: 250 }, { x: -300, y: 250 }] }],
  els: [{ id: "b1", type: "building", cx: 0, cy: 20, w: 360, h: 220, rot: 0, dock: "single" }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try { localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} })); localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)}); } catch (e) {} })();`;
const hook = `(() => { window.__svgs = []; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (obj) => { try { if (obj && obj.type === 'image/svg+xml') obj.text().then((t) => window.__svgs.push(t)); } catch (e) {} return o(obj); }; })();`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--ignore-certificate-errors", "--use-gl=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
if (!LIVE) await installFakeVectorSource(ctx);
await ctx.addInitScript("window.__PLANYR_E2E = true;"); await ctx.addInitScript(seed); await ctx.addInitScript(hook);
const page = await ctx.newPage();
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
await page.goto(BASE + "/#/site", { waitUntil: "load" });
await assertMeasurable(page, "shoot-siteplan-basemap");
await page.waitForTimeout(4000);
// Map view first (this is where a seeded plan opens), then open the plan into the planner canvas.
await page.evaluate(({ lat, lng }) => { const m = window.__mapFinderMap; if (m) m.setView([lat, lng], 16, { animate: false }); }, HOUSTON);
await page.waitForTimeout(7000);
await page.screenshot({ path: `${DIR}/siteplan-map-${TAG}.jpg`, type: "jpeg", quality: 82 });
console.log("map shot");
await page.getByText("Basemap Demo", { exact: true }).first().click({ force: true });
await page.waitForSelector('button:has-text("File ▾")', { timeout: 30000 });
await page.waitForTimeout(3000);
try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch {}
await page.waitForTimeout(7000);
await page.screenshot({ path: `${DIR}/siteplan-planner-${TAG}.jpg`, type: "jpeg", quality: 82 });
console.log("planner shot");

await page.locator('button:has-text("File ▾")').first().click();
await page.locator('button:has-text("Download PDF / pick frame")').first().click();
await page.waitForTimeout(600);
await page.locator('button:has-text("Continue ➜")').first().click();
await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 });
await page.waitForTimeout(6000);
await page.locator('button:has-text("Download PDF")').last().click();
await page.waitForTimeout(8000);
const sheet = await page.evaluate(() => (window.__svgs || []).find((s) => s.includes("data-furniture")) || null);
if (!sheet) { console.log("FAIL — no export sheet captured", errors); process.exit(1); }
writeFileSync(`${DIR}/siteplan-export-${TAG}.svg`, sheet);
const hasAerial = /<image[^>]+href="data:image/.test(sheet);
console.log(`export sheet captured: ${sheet.length} bytes, inlined aerial image: ${hasAerial}`);
const p2 = await ctx.newPage();
await p2.setViewportSize({ width: 1100, height: 850 });
await p2.setContent(`<body style="margin:0;background:#888">${sheet.replace(/<\?xml[^>]*>/, "")}</body>`);
await p2.waitForTimeout(1500);
await p2.screenshot({ path: `${DIR}/siteplan-export-${TAG}.jpg`, type: "jpeg", quality: 82 });
console.log("errors:", errors.length ? errors : "none");
await browser.close();
