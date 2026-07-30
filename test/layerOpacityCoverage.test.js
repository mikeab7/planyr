import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { ALL_LAYERS, defaultOverlayState } from "../src/workspaces/site-planner/lib/layers.js";
import { buildGroupSlots } from "../src/workspaces/site-planner/lib/layerPanelInfo.js";

const read = (rel) => readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/" + rel, import.meta.url)), "utf8");

/* NEW-2 — per-layer OPACITY is the one escape hatch in the fixed stacking model, so it has to
 * be there on EVERY toggleable layer, in the same place, with one implementation. This audit is
 * the standing proof: a new layer, a new row shape, or a layer kind whose setOpacity is a no-op
 * turns the build red instead of quietly leaving one row without an answer. */
describe("NEW-2 — every toggleable GIS layer exposes opacity", () => {
  it("every registered layer starts with a real opacity value", () => {
    const st = defaultOverlayState();
    for (const id of Object.keys(ALL_LAYERS)) {
      expect(st[id], `${id} has no default state`).toBeTruthy();
      expect(typeof st[id].opacity, `${id} opacity`).toBe("number");
      expect(st[id].opacity).toBeGreaterThan(0);
      expect(st[id].opacity).toBeLessThanOrEqual(1);
    }
  });

  it("every layer reaches a panel row — solo, composite, or merge slot — and no row shape is opacity-less", () => {
    const panel = read("components/LayerPanel.jsx");
    // Exactly ONE opacity control implementation, used by all three row shapes.
    expect((panel.match(/const opacityControl = /g) || []).length).toBe(1);
    expect((panel.match(/opacityControl\(/g) || []).length).toBe(3); // solo · City-limits composite · merge group
    // …and no row shape may hand-roll a second slider.
    expect(panel).not.toMatch(/<input type="range"[\s\S]{0,200}opacity: \+e\.target\.value/);

    // Every layer is reachable through buildGroupSlots for its group (a merge member folds into
    // its group's single slot, which carries the one slider that drives every member).
    const groups = new Set(Object.values(ALL_LAYERS).map((c) => c.group).filter(Boolean));
    const reached = new Set();
    for (const g of groups) {
      const entries = Object.entries(ALL_LAYERS).filter(([, c]) => c.group === g);
      for (const slot of buildGroupSlots(entries)) {
        if (slot.kind === "merge") slot.members.forEach(([id]) => reached.add(id));
        else {
          reached.add(slot.entry[0]);
          if (slot.entry[1].mergeWith) reached.add(slot.entry[1].mergeWith);
        }
      }
    }
    // Only the county-scoped rows (folded into the Basemap group at render time) have no `group`.
    const ungrouped = Object.entries(ALL_LAYERS).filter(([, c]) => !c.group).map(([id]) => id);
    expect(ungrouped).toEqual(["fb_contours"]);
    for (const id of Object.keys(ALL_LAYERS)) {
      if (ungrouped.includes(id)) continue;
      expect(reached.has(id), `${id} never reaches a panel row, so it has no opacity control`).toBe(true);
    }
  });

  it("the control is DISCOVERABLE — named, labelled, and showing its value", () => {
    const panel = read("components/LayerPanel.jsx");
    const block = panel.slice(panel.indexOf("const opacityControl = "), panel.indexOf("const row = (k, cfg"));
    expect(block).toContain("See through this layer"); // hover explanation
    expect(block).toMatch(/aria-label=\{`\$\{label\} opacity`\}/); // screen-reader name
    expect(block).toContain("◐"); // a glyph that reads as see-through, not an anonymous slider
    expect(block).toMatch(/Math\.round\(value \* 100\)/); // live feedback that the drag did something
  });

  it("every layer KIND actually implements setOpacity — a slider that moves nothing is worse than none", () => {
    const kinds = new Set(Object.values(ALL_LAYERS).map((c) => c.kind || "dynamic"));
    expect([...kinds].sort()).toEqual(
      ["contours", "dynamic", "esriFeature", "esriImage", "flowdir", "mapillary", "overpass", "pipelineCorridor", "vector", "vectorLine"],
    );
    // dynamic / esriImage come from esri-leaflet with a native setOpacity; the rest are ours.
    const evidence = read("lib/evidenceLayers.js"); // overpass + mapillary
    expect((evidence.match(/group\.setOpacity = /g) || []).length).toBe(2);
    const terrain = read("lib/terrainLayers.js"); // contours + flowdir share one factory
    expect(terrain).toMatch(/group\.setOpacity = /);
    const vec = read("lib/vectorOverlay.js"); // vector + vectorLine + pipelineCorridor
    expect((vec.match(/group\.setOpacity = /g) || []).length).toBe(3);
    const layers = read("lib/layers.js"); // esriFeature has no native one — layers.js shims it
    expect(layers).toMatch(/lyr\.setOpacity = typeof cfg\.styleFn === "function"/);
    // …and the update pass pushes the slider's value at whatever the ref turned out to be,
    // including a role-split composite.
    expect(layers).toMatch(/if \(cur\.setOpacity\) cur\.setOpacity\(st\.opacity\)/);
    expect(layers).toMatch(/setOpacity\(o\) \{ slots\.forEach/);
  });
});
