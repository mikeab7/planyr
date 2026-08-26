#!/usr/bin/env node
/* B1064 tranche (c) verification — LayerPanel is now React.lazy on BOTH hosts (the planner's
 * Layers card and the map finder's Imagery & layers card), and this proves the two things the
 * bundle audit cannot: that the chunk is genuinely absent from a plain boot, and that it still
 * renders correctly once needed — on the FINDER especially, where the card defaults OPEN on a
 * desktop viewport and so is on first paint rather than behind a click.
 *
 * Runs LOGGED OUT with every cross-origin request blocked (no Supabase, no GIS hosts, no tiles),
 * the same honest sandbox verify-lazy-panels.mjs uses. LayerPanel's rows render from local
 * state/props regardless, so this is enough to prove the split renders — not to prove every
 * live-data row inside it (those need a signed-in, GIS-reachable pass and are not claimed here).
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-lazy-layerpanel.mjs
 */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const stem = (f) => f.replace(/-[A-Za-z0-9_-]{8}\.js$/, "").replace(/\.js$/, "");

const ok = [];
const fail = [];

async function newTrackedPage(browser, { viewport = { width: 1600, height: 900 }, seed = false } = {}) {
  const ctx = await browser.newContext({ viewport });
  if (seed) await ctx.addInitScript(perfScenarioSeed());
  const page = await ctx.newPage();
  const fetched = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.startsWith(BASE) && /\/assets\/.*\.js(\?|$)/.test(u)) fetched.push(stem(u.split("/").pop()));
  });
  await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e).split("\n")[0]));
  return { ctx, page, fetched, pageErrors };
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* ---- Host 1: the PLANNER — Layers starts CLOSED, so it must be absent from the boot set and
 * arrive only once the "Layers" card is opened. -------------------------------------------- */
{
  const { ctx, page, fetched, pageErrors } = await newTrackedPage(browser, { seed: true });
  await assertMeasurable(page, "verify-lazy-layerpanel");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"], canvas, #root', { timeout: 60_000 });
  await page.waitForTimeout(3000); // let any boot-time warm fire, so its absence is meaningful

  const bootSet = [...new Set(fetched)];
  if (bootSet.includes("LayerPanel")) fail.push("planner: LayerPanel was fetched on a plain boot — it is NOT deferred");
  else ok.push("planner: LayerPanel is absent from the boot fetch set");

  try {
    const layersBtn = page.locator('[aria-label^="Layers — map data layers"]').first();
    await layersBtn.waitFor({ state: "visible", timeout: 20_000 });
    await layersBtn.click();
    await page.locator('[data-testid="layer-panel"]').waitFor({ state: "visible", timeout: 20_000 });
    const after = [...new Set(fetched)];
    if (!after.includes("LayerPanel")) fail.push("planner: the Layers card rendered but its chunk was never fetched — the split did not take");
    else ok.push("planner: opening Layers fetched the LayerPanel chunk and rendered its content");
  } catch (e) {
    fail.push(`planner: could not open the Layers card / its lazy content never resolved: ${String(e).split("\n")[0]}`);
  }
  if (pageErrors.length) fail.push(`planner: page errors during the run: ${pageErrors.slice(0, 3).join(" | ")}`);
  else ok.push("planner: no uncaught page errors");
  await ctx.close();
}

/* ---- Host 2: the MAP FINDER — no site to resume, so the app lands here; on a desktop viewport
 * `layersPanelOpen` defaults OPEN, so LayerPanel is on first paint (the case tranche (c)'s
 * idle-prefetch is for). This proves the Suspense boundary resolves into real content with no
 * click at all, which is the case a fallback-only test would never exercise. --------------- */
{
  const { ctx, page, fetched, pageErrors } = await newTrackedPage(browser, { seed: false });
  await assertMeasurable(page, "verify-lazy-layerpanel");
  await page.goto(BASE, { waitUntil: "load" });
  try {
    await page.locator('[data-testid="layer-panel"]').waitFor({ state: "visible", timeout: 20_000 });
    ok.push("finder: LayerPanel rendered on first paint with no click (desktop default-open path)");
    if (!fetched.includes("LayerPanel")) fail.push("finder: LayerPanel rendered but its chunk name never appeared in the fetch log");
  } catch (e) {
    fail.push(`finder: the default-open Layers card never rendered LayerPanel's content: ${String(e).split("\n")[0]}`);
  }
  if (pageErrors.length) fail.push(`finder: page errors during the run: ${pageErrors.slice(0, 3).join(" | ")}`);
  else ok.push("finder: no uncaught page errors");
  await ctx.close();
}

await browser.close();

console.log("B1064(c) — LayerPanel lazy-load verification\n");
for (const o of ok) console.log(`  ✓ ${o}`);
for (const f of fail) console.log(`  ✗ ${f}`);
console.log("\n  NOT covered by this run: any GIS-dependent row's live data (identify, coverage,");
console.log("  flood group) — this sandbox blocks every cross-origin GIS host. What's checked here");
console.log("  is that the split is real (absent from boot) and that it renders (Suspense resolves).");
console.log(fail.length ? `\n✗ ${fail.length} failure(s)` : "\n✓ all checked assertions hold");
process.exit(fail.length ? 1 : 0);
