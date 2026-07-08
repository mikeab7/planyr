import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The terrain worker is the repo's FIRST dedicated Web Worker. Its import list is a
// runtime contract, not a style choice: anything that transitively touches Leaflet,
// React, or the DOM crashes INSIDE the worker at runtime — the build stays green and
// the layer just dies. Vitest can't execute a `?worker` module, so this guard pins
// the source text instead (the bugHuntGuards pattern).
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("terrainWorker — worker-safe import discipline", () => {
  const src = read("../src/workspaces/site-planner/lib/terrainWorker.js");
  it("imports ONLY the pure terrain modules", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./contours.js", "./demGrid.js", "./flowField.js"]);
  });
  it("never touches Leaflet / React / the DOM", () => {
    expect(src).not.toMatch(/from\s+"leaflet"/);
    expect(src).not.toMatch(/from\s+"react"/);
    expect(src).not.toMatch(/\bdocument\./);
    expect(src).not.toMatch(/\bwindow\./);
    expect(src).not.toMatch(/localStorage/);
  });
  it("answers every job — the ok:false error path exists (LOUD-FAILURE)", () => {
    expect(src).toMatch(/ok: false, error/);
    expect(src).toMatch(/self\.onmessage/);
  });
  it("stays iife-safe: no dynamic import() inside the worker", () => {
    expect(src).not.toMatch(/import\(/);
  });
});

describe("the pure terrain modules stay worker-safe too", () => {
  for (const f of ["demGrid.js", "contours.js", "flowField.js"]) {
    it(`${f} has no Leaflet/React/DOM imports`, () => {
      const src = read(`../src/workspaces/site-planner/lib/${f}`);
      expect(src).not.toMatch(/from\s+"leaflet"/);
      expect(src).not.toMatch(/from\s+"react"/);
      expect(src).not.toMatch(/\bdocument\.|\bwindow\.|localStorage/);
    });
  }
});

describe("terrainLayers — the main-thread half honors the split", () => {
  const src = read("../src/workspaces/site-planner/lib/terrainLayers.js");
  it("spawns the worker via the Vite ?worker specifier", () => {
    expect(src).toMatch(/from\s+"\.\/terrainWorker\.js\?worker"/);
  });
  it("never JSON-stringifies a grid into gisCache (Float32Array stall trap)", () => {
    // the swr artifact is the contour/arrow JSON only; grids live in the plain Map
    expect(src).toMatch(/gridLru/);
    expect(src).not.toMatch(/swr\([^)]*grid/i);
  });
});
