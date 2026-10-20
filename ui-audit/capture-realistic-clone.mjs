/* capture-realistic-clone — regenerates test/fixtures/realisticSiteClone.json (the export clone of
 * ui-audit/lib/realisticSitePlan.mjs) from a local preview build:  node ui-audit/capture-realistic-clone.mjs test/fixtures/realisticSiteClone.json */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { writeFileSync } from "node:fs";
import { realisticSitePlan } from "./lib/realisticSitePlan.mjs";
const BASE = "http://127.0.0.1:4173";
const rec = realisticSitePlan("zzcap" + Math.random().toString(36).slice(2, 7));
const browser = await chromium.launch({ headless: true, executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome", args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("PAGEERR", e.message));
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await assertMeasurable(page, "capture-realistic-clone");
await page.evaluate((x) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[x.id] = x; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, rec);
await page.goto(`${BASE}/#/project/${rec.id}/site`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 60000 });
await page.waitForTimeout(4000);
const out = await page.evaluate(async () => ({ svg: await window.__plannerExportSvg(), f2p: window.__plannerExportF2p(), comp: await window.__plannerExportComposed() }));
console.log("pins", JSON.stringify(out.comp.pins), "annots", out.comp.annots.length, JSON.stringify(out.comp.degraded));
const cnt = {}; out.comp.annots.forEach((a) => { const k = a.family + ":" + a.subj; cnt[k] = (cnt[k] || 0) + 1; }); console.log(cnt);
// shrink: 2-decimal numbers
const svg = out.svg.replace(/-?\d+\.\d{3,}/g, (m) => String(Math.round(parseFloat(m) * 100) / 100));
writeFileSync(process.argv[2], JSON.stringify({ _note: "Export clone of ui-audit/lib/realisticSitePlan.mjs (the owner's Bain plan + a promoted reference, a behind-the-plan markup, a callout and every measurement kind), captured from window.__plannerExportSvg on the B-NEW-1 build. Numbers rounded to 0.01 units.", f2p: out.f2p, model: { els: rec.els, markups: rec.markups, measures: rec.measures, callouts: rec.callouts }, svg }));
await browser.close();
