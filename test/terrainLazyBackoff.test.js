import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { retryDelayMs, loadTerrain, terrainNow, __resetTerrainLazy } from "../src/workspaces/site-planner/lib/terrainLazy.js";

const here = dirname(fileURLToPath(import.meta.url));

/* B287060 — THE UNBOUNDED RETRY THAT TURNED ONE DEAD CHUNK INTO TWO HOURS OF TELEMETRY.
 *
 * ⛔ THE MEASUREMENT, so this is never re-litigated as a style preference. `loadTerrain`'s failure
 * path cleared its own cache — correct, so a network blip does not wedge every later call — and
 * its caller is `useGroundElevation`'s per-POINTER-MOVE cursor sample. A chunk that is genuinely
 * gone therefore got a fresh `import()` per mouse movement. Production, build `53d1bac`, chunk
 * `terrainLayers-aE2wQGtV.js`, 2026-08-06: ONE tab, ONE dead import, **2 h 20 m**, arriving as 81
 * `vite:preloadError` rows spaced exactly 10 s apart — 10 s being `DUP_MS`, the telemetry dedupe
 * window, so the row COUNT was a property of the instrument, not of the failure. That single tab is
 * 22% of every preloadError row this app has ever written, and reading those 81 rows as 81
 * incidents is exactly the misreading B287056 exists to prevent.
 */

describe("retryDelayMs — the backoff ladder", () => {
  it("⛔ costs a healthy page NOTHING — the first attempt waits zero", () => {
    expect(retryDelayMs(0)).toBe(0);
    expect(retryDelayMs(-1)).toBe(0);
    expect(retryDelayMs(null)).toBe(0);
  });
  it("doubles from the base", () => {
    expect(retryDelayMs(1)).toBe(2_000);
    expect(retryDelayMs(2)).toBe(4_000);
    expect(retryDelayMs(3)).toBe(8_000);
    expect(retryDelayMs(6)).toBe(60_000);
  });
  it("is BOUNDED, so a long-dead chunk settles at one attempt a minute instead of one per mouse move", () => {
    for (const n of [7, 20, 1000]) expect(retryDelayMs(n)).toBe(60_000);
  });
  it("⛔ is a DELAY and never a CAP — every attempt number still yields a finite wait, so terrain always comes back after a blip", () => {
    for (const n of [1, 5, 50, 5000]) expect(Number.isFinite(retryDelayMs(n))).toBe(true);
  });
  it("bounds the real storm: what was ~840 attempts over 2h20m becomes about 140", () => {
    /* One attempt per pointer move (measured at roughly one row per 10 s through a dedupe window
     * that can only under-report) against the ladder's own schedule over the same 8,431 seconds. */
    let t = 0, n = 0;
    while (t < 8_431_000) { n += 1; t += retryDelayMs(n); }
    expect(n).toBeLessThan(150);
  });
});

describe("loadTerrain — the network is not touched inside the backoff window", () => {
  beforeEach(() => __resetTerrainLazy());

  it("refuses inside the window WITHOUT attempting an import, and allows one once it elapses", async () => {
    /* The import itself cannot resolve under vitest (no bundler graph for `./terrainLayers.js`
     * here), which is exactly the failing-chunk condition this guards — so the first call fails
     * for real and arms the ladder. */
    await expect(loadTerrain(1_000)).rejects.toBeTruthy();
    const t0 = performance.now();
    await expect(loadTerrain(1_500)).rejects.toThrow(/backing off/);
    expect(performance.now() - t0).toBeLessThan(50);   // it returned without going near the network
    await expect(loadTerrain(1_000 + 2_000 + 1)).rejects.not.toThrow(/backing off/);
  });

  it("keeps `terrainNow()` null throughout, so no caller sees a new state", () => {
    /* Every caller already treats null as "not yet" — that is what makes this backoff free of
     * downstream handling. */
    expect(terrainNow()).toBe(null);
  });

  it("lengthens the window on each consecutive failure", async () => {
    await expect(loadTerrain(0)).rejects.toBeTruthy();          // fail 1 → wait 2 s
    await expect(loadTerrain(2_001)).rejects.toBeTruthy();      // fail 2 → wait 4 s
    await expect(loadTerrain(4_000)).rejects.toThrow(/backing off/);  // still inside the 4 s window
    await expect(loadTerrain(6_002)).rejects.not.toThrow(/backing off/);
  });
});

describe("the call sites still handle a rejection (LOUD-FAILURE, not a new silent path)", () => {
  const read = (p) => readFileSync(join(here, "..", p), "utf8");
  it("⛔ every loadTerrain() caller has a rejection handler — an unhandled one would feed the very telemetry channel this item is cleaning up", () => {
    /* `main.jsx` wires `unhandledrejection` straight into `client_errors`, so a backoff rejection
     * with no handler would trade one noisy source for another. */
    expect(read("src/workspaces/site-planner/components/useGroundElevation.js"))
      .toMatch(/loadTerrain\(\)[\s\S]{0,900}the debounced point sample below owns the LOUD failure state/);
    expect(read("src/workspaces/site-planner/lib/layers.js"))
      .toMatch(/loadTerrain\(\)[\s\S]{0,900}terrain module failed to load/);
    const SP = read("src/workspaces/site-planner/SitePlanner.jsx");
    expect(SP).toMatch(/loadTerrain\(\)[\s\S]{0,400}\.catch\(/);
    expect(SP).toMatch(/Promise\.allSettled\(\[\s*\n\s*loadTerrain\(\)/);
  });
});
