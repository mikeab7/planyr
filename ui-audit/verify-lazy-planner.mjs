#!/usr/bin/env node
/* B329408 — the plan editor (SitePlanner.jsx) is its own lazy chunk. Proves, in a real browser, the three things the bundle audit cannot:
 *   A. a page that OPENS ON A PLAN preloads the editor chunk from index.html at t=0 (modulepreload in <head>) and the planner renders;
 *   B. a page that lands on the MAP does not load it as a dependency of the Site route — it is fetched afterwards (idle prefetch), never
 *      before SitePlannerApp has finished loading (the t=0 preload's route rule is unit-tested in test/plannerPreload.test.js);
 *   C. opening a plan from the map afterwards works (the editor mounts, the canvas answers) with no uncaught page errors.
 * Runs logged out against a built app (`npm run build && npx vite preview --port 4173`), cross-origin requests blocked.
 *   node ui-audit/verify-lazy-planner.mjs */
import { chromium } from "playwright";
import { perfScenarioSeed, SCENARIO_ID } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || undefined;
const stem = (f) => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");
const ok = [], fail = [];

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
async function open({ seed }) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  if (seed) await ctx.addInitScript(perfScenarioSeed());
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).split("\n")[0]));
  await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await assertMeasurable(page, "verify-lazy-planner");
  return { ctx, page, errors };
}
const resources = (page) => page.evaluate(() => performance.getEntriesByType("resource").filter((e) => /\/assets\/.*\.js/.test(e.name))
  .map((e) => ({ file: e.name.split("/").pop(), start: e.startTime, end: e.responseEnd })));

/* A — opening ON a plan */
{
  const { ctx, page, errors } = await open({ seed: true });
  await page.goto(`${BASE}#/project/${SCENARIO_ID}/site`, { waitUntil: "load" });
  const preloads = await page.evaluate(() => [...document.querySelectorAll('link[rel="modulepreload"]')].map((l) => l.href.split("/").pop()));
  if (preloads.some((f) => stem(f) === "SitePlanner")) ok.push("A: index.html preloads the SitePlanner chunk for a page opening on a plan");
  else fail.push(`A: no modulepreload for the plan editor chunk (saw: ${preloads.map(stem).join(", ") || "none"})`);
  try {
    await page.locator('[data-testid="planner-canvas"], svg[data-planner-canvas], [data-mode="plan"][data-mode-active="true"] svg').first().waitFor({ state: "visible", timeout: 60_000 });
    ok.push("A: the plan editor mounted and its canvas is visible");
  } catch (e) { fail.push(`A: the editor never rendered: ${String(e).split("\n")[0]}`); }
  if (errors.length) fail.push(`A: page errors: ${errors.slice(0, 3).join(" | ")}`); else ok.push("A: no uncaught page errors");
  await ctx.close();
}

/* B + C — landing on the MAP, then opening a plan */
{
  const { ctx, page, errors } = await open({ seed: true });
  await page.goto(`${BASE}#/site`, { waitUntil: "load" });
  await page.waitForTimeout(500);
  // let the idle prefetch run, then check ORDER: the editor chunk must start after SitePlannerApp finished (never a blocking dependency of it)
  await page.waitForTimeout(4000);
  const res = await resources(page);
  const app = res.find((r) => stem(r.file) === "SitePlannerApp"), ed = res.find((r) => stem(r.file) === "SitePlanner");
  if (!app) fail.push("B: SitePlannerApp chunk not in the resource log — the check is void");
  else if (!ed) fail.push("B: the editor chunk was never prefetched after the map landed");
  else if (ed.start < app.end) fail.push(`B: the editor chunk started (${ed.start.toFixed(0)} ms) before SitePlannerApp finished (${app.end.toFixed(0)} ms) — it is a blocking dependency`);
  else ok.push(`B: the editor chunk is fetched after SitePlannerApp has loaded (idle prefetch; +${(ed.start - app.end).toFixed(0)} ms)`);
  // C — open the plan
  await page.goto(`${BASE}#/project/${SCENARIO_ID}/site`);
  try {
    await page.locator('[data-mode="plan"][data-mode-active="true"] svg').first().waitFor({ state: "visible", timeout: 60_000 });
    ok.push("C: opening a plan from the map mounts the editor (canvas visible)");
  } catch (e) { fail.push(`C: opening a plan from the map never showed the editor: ${String(e).split("\n")[0]}`); }
  if (errors.length) fail.push(`B/C: page errors: ${errors.slice(0, 3).join(" | ")}`); else ok.push("B/C: no uncaught page errors");
  await ctx.close();
}
await browser.close();
console.log("B329408 — lazy plan editor verification\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log(fail.length ? `\n✗ ${fail.length} failure(s)` : "\n✓ all checked assertions hold");
process.exit(fail.length ? 1 : 0);
