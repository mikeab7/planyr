// source-scan: reads the shipped source text because the guarded wiring cannot run in node (added by Batch A to unblock the guard from audit batch D).
/* B2671297 — MapLibre 6 resolves its worker relative to its own bundled chunk, a file the build never emits, so every
 * vector road-name layer failed ("Worker failed to load") and fell back to the raster road names. The loader must name
 * the worker file itself. (Browser proof: a harness with the fix reports a network error only; without it, "Worker failed".) */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/shared/basemaps/vectorLabelLayer.js", import.meta.url), "utf8");

describe("vector labels name MapLibre's worker file (B2671297)", () => {
  it("imports the worker as a url and hands it to setWorkerUrl before the map is built", () => {
    expect(src).toMatch(/import\("maplibre-gl\/dist\/maplibre-gl-worker\.mjs\?url"\)/);
    const setAt = src.indexOf("setWorkerUrl(workerUrl)");
    const buildAt = src.indexOf("maplibreGL(vectorLayerOptions");
    expect(setAt).toBeGreaterThan(-1);
    expect(setAt).toBeLessThan(buildAt);
  });
});
