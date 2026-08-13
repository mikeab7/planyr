/* fixtureSeeding — put a real plan, WITH its rasters, in front of any harness in this repo (NEW-2).
 *
 * ⛔ THE PROBLEM THIS SOLVES, and it is why the existing instruments could only ever open Goose
 * Creek. A plan's rasters do not live in localStorage — they live in IndexedDB, as base64 strings,
 * under `raster:<siteId>:…`, and the saved record holds `src: null` + an `idbKey`. localStorage can
 * be seeded before navigation with `addInitScript`; IndexedDB cannot, because it is origin-scoped
 * and there is no origin until a document from it exists. So every harness here seeds localStorage
 * only, and any plan with rasters opens with its rasters MISSING.
 *
 * TWO WAYS TO CLOSE THAT, AND THEY ARE NOT INTERCHANGEABLE:
 *
 *  1. **Navigate, write, reload.** Simple and obvious. Fine for an instrument that measures a
 *     SETTLED page (ui-audit/raster-arms.mjs uses it) — the throwaway first load costs wall time and
 *     nothing else. **Wrong for anything that measures BOOT**: the discarded navigation leaves a warm
 *     HTTP cache, a warm V8 code cache and a populated module graph, so the measured load is a
 *     second load wearing a first load's name.
 *
 *  2. **Seed once, then hand every measured context a `storageState`.** Playwright's
 *     `storageState({ indexedDB: true })` captures IndexedDB alongside localStorage, and
 *     `newContext({ storageState })` restores both BEFORE the first navigation. The measured context
 *     never visits the origin twice, so a boot measured this way is a real cold boot with the plan's
 *     rasters already present. That is what this module produces.
 *
 * The seeding context is created, used and closed here, and it is not the context anything is
 * measured in.
 */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { synthRasterPng, pngDataUrl } from "./synthRaster.mjs";
import { fixtureSeed, fixtureSeedMulti, rasterIdbPlan, idbPutInPage, fixtureCensus } from "./planFixture.mjs";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/* ⛔ ONE MAP, NOT ONE PER HARNESS. Each harness that wanted a real plan grew its own private
 * short-name → filename table, so "bain" already meant `bain-concept-original.json` in one file and
 * nothing at all in three others — which is how the two GROWTH harnesses ended up measuring the one
 * synthetic scene the owner has never opened while he reported on two real plans they could not
 * name. Adding a fixture in one place is the fix; the doc-pointer audit already enforces the same
 * discipline on prose. */
export const FIXTURE_FILES = {
  bain: "bain-concept-original.json",
  quiddity: "bain-quiddity.json",
  sylvestri: "sylvestri-concept-d-full.json",
  "sylvestri-lite": "sylvestri-concept-d.json",
  tsakiris: "tsakiris-concept-a-live.json",
  weld: "weld-concept-a.json",
  /* The owner's FM 359 / Woods Road plan, the one NEW-1 and NEW-2 were reported on. It is the only
   * fixture carrying CENTRELINE ROADS beside ponds and side-parking assemblies, which is what makes
   * it the plan that can see the dissolved-road defect. */
  woods: "woods-road-1m-sf.json",
};

/** Resolve a short name (or a bare filename) to a parsed fixture. Throws NAMING the options,
 *  because a typo that silently falls back to the default scene is how a run measures the wrong
 *  plan and says nothing about it. */
export function readFixture(name, dir = FIXTURE_DIR) {
  const file = FIXTURE_FILES[String(name).toLowerCase()] || (String(name).endsWith(".json") ? String(name) : `${name}.json`);
  const path = join(dir, file);
  if (!existsSync(path)) {
    throw new Error(`no fixture "${name}" (looked for ${path}) — known names: ${Object.keys(FIXTURE_FILES).join(", ")}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

/* ⛔ EVERY RASTER IN A RUN GETS A DISTINCT SEED. Chromium caches decoded images by CONTENT: hand two
 * rasters the same bytes and it allocates ONE bitmap and shares it, so a scene that should cost two
 * textures quietly costs one. Same rule, and the same failure mode, as lib/fakeTile.mjs. */
export const seedOf = (spec) => (spec.role === "underlay" ? 7 : 13) + (spec.imgW % 97);

/* Synthesised raster bytes, cached on disk. A 4.5-megapixel PNG whose deflated size has to land near
 * a 10 MB target takes several full-image deflates; doing that per arm per rep would dominate a run.
 * The input is deterministic, so the cache can never serve the wrong picture. */
export function cachedRaster(spec, cacheDir) {
  if (!existsSync(cacheDir)) mkdirSync(cacheDir, { recursive: true });
  const target = spec.encodedBytes ? Math.round((spec.encodedBytes * 3) / 4) : null; // base64 → raw bytes
  const file = join(cacheDir, `r-${spec.imgW}x${spec.imgH}-s${seedOf(spec)}-t${target || 0}.png`);
  if (existsSync(file)) { const png = readFileSync(file); return { png, bytes: png.length, cached: true }; }
  const out = synthRasterPng(spec.imgW, spec.imgH, { seed: seedOf(spec), targetBytes: target });
  writeFileSync(file, out.png);
  return { ...out, cached: false };
}

/**
 * Build a Playwright `storageState` holding a fixture's plan record AND its rasters.
 *
 * @returns { state, facts } — `facts` is what was actually written, so a harness can PRINT the
 *          scene it measured rather than restating the fixture's claim about itself.
 */
export async function buildFixtureState(browser, { base, fixture, siteId, cacheDir, viewport = { width: 1600, height: 900 } }) {
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: siteId }));
  /* Nothing external is needed to establish an origin, and letting real requests out would make the
   * seeding step depend on the network. */
  await ctx.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });

  const facts = [];
  for (const { key, spec } of rasterIdbPlan(fixture, siteId)) {
    const r = cachedRaster(spec, cacheDir);
    const dataUrl = pngDataUrl(r.png);
    const wrote = await page.evaluate(idbPutInPage, { key, value: dataUrl });
    /* ⛔ CONFIRM THE WRITE. An unconfirmed seed produces a page with no rasters that measures
     * beautifully and means nothing — see `decodeFault` in lib/rasterCost.mjs. */
    if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm — the fixture cannot be established`);
    facts.push({
      key, role: spec.role, imgW: spec.imgW, imgH: spec.imgH, opacity: spec.opacity,
      encodedTargetBytes: spec.encodedBytes, encodedActualBytes: dataUrl.length,
      decodedBytes: spec.imgW * spec.imgH * 4,
    });
  }

  const state = await ctx.storageState({ indexedDB: true });
  await ctx.close();
  return { state, facts, census: fixtureCensus(fixture) };
}

/**
 * The same thing with SEVERAL real plans in the store, so a harness can switch between them.
 *
 * `plans` is `[{ name, fixture, siteId }]`; the first is the one the app opens on. Every plan's
 * rasters are written under ITS OWN site id, which is the only reason this cannot be done by
 * calling `buildFixtureState` twice — the two contexts would each capture their own storageState
 * and the second would replace the first.
 */
export async function buildMultiFixtureState(browser, { base, plans = [], cacheDir, viewport = { width: 1600, height: 900 } }) {
  if (!plans.length) throw new Error("buildMultiFixtureState needs at least one plan");
  const ctx = await browser.newContext({ viewport, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeedMulti(plans.map((p) => ({ fixture: p.fixture, id: p.siteId, name: p.name || p.siteId }))));
  await ctx.route("**/*", (route) => (route.request().url().startsWith(base) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(base, { waitUntil: "domcontentloaded" });

  const facts = [];
  for (const p of plans) {
    for (const { key, spec } of rasterIdbPlan(p.fixture, p.siteId)) {
      const r = cachedRaster(spec, cacheDir);
      const wrote = await page.evaluate(idbPutInPage, { key, value: pngDataUrl(r.png) });
      if (wrote !== true) throw new Error(`IndexedDB write for ${key} did not confirm — the fixture cannot be established`);
      facts.push({ plan: p.name || p.siteId, key, role: spec.role, imgW: spec.imgW, imgH: spec.imgH, opacity: spec.opacity, decodedBytes: spec.imgW * spec.imgH * 4 });
    }
  }

  const state = await ctx.storageState({ indexedDB: true });
  await ctx.close();
  return { state, facts, census: Object.fromEntries(plans.map((p) => [p.name || p.siteId, fixtureCensus(p.fixture)])) };
}
