import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// The DXF worker (B747) parses + renders off the main thread. Like terrainWorker, its import
// list is a runtime contract: anything that transitively touches the DOM / React / Leaflet
// crashes INSIDE the worker (build stays green, the drop just dies). Vitest can't execute a
// `?worker` module, so pin the source text.
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("dxfWorker — worker-safe import discipline", () => {
  const src = read("../src/workspaces/site-planner/lib/dxf/dxfWorker.js");
  it("imports ONLY dxf-parser + the pure render module", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).sort();
    expect(imports).toEqual(["./dxfRender.js", "dxf-parser"]);
  });
  it("never touches Leaflet / React / the DOM", () => {
    expect(src).not.toMatch(/from\s+"leaflet"/);
    expect(src).not.toMatch(/from\s+"react"/);
    expect(src).not.toMatch(/\bdocument\.|\bwindow\.|localStorage/);
  });
  it("answers every job — the ok:false error path exists (LOUD-FAILURE)", () => {
    expect(src).toMatch(/ok: false/);
    expect(src).toMatch(/self\.onmessage/);
  });
});

describe("the pure DXF modules stay worker-safe (no DOM)", () => {
  for (const f of ["dxfGeom.js", "dxfRender.js"]) {
    it(`${f} has no Leaflet/React/DOM references`, () => {
      const src = read(`../src/workspaces/site-planner/lib/dxf/${f}`);
      expect(src).not.toMatch(/from\s+"leaflet"|from\s+"react"/);
      expect(src).not.toMatch(/\bdocument\.|\bwindow\.|localStorage|createElement/);
    });
  }
  it("dxfOverlay (main-thread half) spawns the worker via the Vite ?worker specifier", () => {
    const src = read("../src/workspaces/site-planner/lib/dxf/dxfOverlay.js");
    expect(src).toMatch(/from\s+"\.\/dxfWorker\.js\?worker"/);
  });
});
