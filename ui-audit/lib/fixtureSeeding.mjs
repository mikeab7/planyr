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
import { join } from "node:path";
import { synthRasterPng, pngDataUrl } from "./synthRaster.mjs";
import { fixtureSeed, rasterIdbPlan, idbPutInPage, fixtureCensus } from "./planFixture.mjs";

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
