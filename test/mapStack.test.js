import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// layers.js pulls in Leaflet-facing modules that need a DOM — stub them so the module
// loads in the node test environment (the test/layerConsolidation.test.js pattern).
vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn(), TERRAIN_MIN_ZOOM: 13 }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({ cachedVectorLayer: vi.fn(), cachedPipelineLayer: vi.fn(), cachedCorridorLayer: vi.fn(), isPointFeature: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import {
  MAP_STACK, STACK_Z, CANVAS_Z, SVG_TIERS, GIS_ROLES, ROLES_OVER_ELEMENTS,
  roleOverElements, tierForRole, panesForRole, rolesOf, isRoleSplit, auditLayerRoles,
  exportsOverPlan, PANE_AREA, PANE_LINE, PANE_AREA_LABEL, PANE_LINE_LABEL,
  PANE_AREA_FRONT, PANE_AREA_FRONT_LABEL, FRONT_BAND_ATTR,
  canLiftRole, configCanLift, tierForLayer, layerOverPlan, panesForLayer, bandKey, exportBandFor,
} from "../src/workspaces/site-planner/lib/mapStack.js";
import { ALL_LAYERS } from "../src/workspaces/site-planner/lib/layers.js";

const read = (rel) => readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/" + rel, import.meta.url)), "utf8");

/* NEW-1 — ONE fixed semantic stacking order for the whole map.
 *
 * Owner case: buildings placed over the site contours hid the contours. He ruled out a
 * hold-to-peek key — "whatever an apple or a google would do, lets do" — and neither of those
 * apps lets a user reorder layers. So the answer is a principled system default with NO new
 * mode, NO shortcut and NO per-layer z-order picker, and these are its teeth. */
describe("NEW-1 — the stacking model is fixed, ordered, and complete", () => {
  it("the order is bottom→top exactly as the model declares, with no ties", () => {
    expect(MAP_STACK.map((t) => t.id)).toEqual([
      "basemap", "gisArea", "reference", "parcel", "setback", "elements", "referenceFront", "gisAreaFront", "gisLine", "label", "handle",
    ]);
    const zs = MAP_STACK.map((t) => t.z);
    expect(zs).toEqual([...zs].sort((a, b) => a - b));
    expect(new Set(zs).size).toBe(zs.length);
  });

  it("THE load-bearing rule: area fills sit under the site elements, line/point strokes over them", () => {
    expect(STACK_Z.gisArea).toBeLessThan(STACK_Z.elements);
    expect(STACK_Z.gisLine).toBeGreaterThan(STACK_Z.elements);
    expect(roleOverElements("area")).toBe(false);
    expect(roleOverElements("line")).toBe(true);
    expect(roleOverElements("point")).toBe(true);
    expect(tierForRole("area")).toBe("gisArea");
    expect(tierForRole("line")).toBe("gisLine");
    expect(ROLES_OVER_ELEMENTS).toEqual(["line", "point"]);
  });

  it("manipulation handles are the top tier and labels sit above the line band", () => {
    expect(STACK_Z.handle).toBe(Math.max(...MAP_STACK.map((t) => t.z)));
    expect(STACK_Z.label).toBeGreaterThan(STACK_Z.gisLine);
  });

  it("references sit between the GIS area fills and the parcel, with B1198's promoted band above the plan", () => {
    // A scanned exhibit the user is aligning is USER CONTENT, so Figma-style ordering is correct
    // for it — front/back reorders references AMONG THEMSELVES (lib/overlayOrder.js), and the
    // explicit "Draw above the plan" opt-in is its own declared tier, not a second scheme.
    expect(STACK_Z.reference).toBeGreaterThan(STACK_Z.gisArea);
    expect(STACK_Z.reference).toBeLessThan(STACK_Z.parcel);
    expect(STACK_Z.referenceFront).toBeGreaterThan(STACK_Z.elements);
    expect(STACK_Z.referenceFront).toBeLessThan(STACK_Z.gisLine);
    expect(SVG_TIERS[0]).toBe("reference");
    // Every tier that lives inside the one plan SVG is declared as such — including the handle
    // layer B1197 made the SVG's last child.
    expect(SVG_TIERS).toContain("handle");
  });

  it("the canvas's real CSS z-indexes carry the same order the model declares", () => {
    expect(CANVAS_Z.basemap).toBeLessThan(CANVAS_Z.plan);
    expect(CANVAS_Z.plan).toBeLessThan(CANVAS_Z.gisLine);
  });

  it("a role resolves to its band's panes; area and line never share one", () => {
    expect(panesForRole("area").pane).toBe(PANE_AREA);
    expect(panesForRole("line").pane).toBe(PANE_LINE);
    expect(panesForRole("point").pane).toBe(PANE_LINE);
    expect(panesForRole("area").labelPane).toBe(PANE_AREA_LABEL);
    expect(panesForRole("line").labelPane).toBe(PANE_LINE_LABEL);
    // A surface may HOST the bands where it likes; it may not reorder them.
    const custom = panesForRole("line", { area: "a", line: "b", areaLabel: "al", lineLabel: "bl" });
    expect(custom).toEqual({ pane: "b", labelPane: "bl" });
  });

  it("a layer's name labels ride in its OWN band", () => {
    expect(exportsOverPlan(rolesOf({ role: "line" })[0].role)).toBe(true);
    expect(panesForRole("line").labelPane).not.toBe(panesForRole("area").labelPane);
  });
});

describe("NEW-1 — every registered GIS source declares its role", () => {
  it("the audit passes over the whole live registry", () => {
    const problems = auditLayerRoles(ALL_LAYERS);
    expect(problems.map((p) => `${p.id}: ${p.problem}`).join("\n")).toBe("");
  });

  it("every declared role is one of the three, and no layer is left unclassified", () => {
    for (const [id, cfg] of Object.entries(ALL_LAYERS)) {
      const roles = rolesOf(cfg);
      expect(roles.length, `${id} declares no role`).toBeGreaterThan(0);
      for (const { role } of roles) expect(GIS_ROLES, `${id} → ${role}`).toContain(role);
    }
  });

  it("the audit has TEETH — an unclassified or mis-declared source fails it", () => {
    expect(auditLayerRoles({ mystery: { label: "x" } })).toHaveLength(1);
    expect(auditLayerRoles({ bad: { role: "polygonish" } })).toHaveLength(1);
    expect(auditLayerRoles({ both: { role: "line", roleLayers: { area: [1], line: [2] } } })).toHaveLength(1);
    expect(auditLayerRoles({ thin: { roleLayers: { area: [1] } } })).toHaveLength(1);
  });

  it("the owner's own case is classified the way he asked for it", () => {
    // Contours over his buildings; the floodplain fill under them.
    expect(rolesOf(ALL_LAYERS.contours)[0].role).toBe("line");
    expect(rolesOf(ALL_LAYERS.fb_contours)[0].role).toBe("line");
    expect(rolesOf(ALL_LAYERS.nhd_flowlines)[0].role).toBe("line");
    expect(rolesOf(ALL_LAYERS.wetlands)[0].role).toBe("area");
    expect(rolesOf(ALL_LAYERS.elevation)[0].role).toBe("area");
  });

  it("a source that publishes BOTH splits into its two roles, area band first", () => {
    // FEMA: sublayer 28 is the zone POLYGONS (fill, under the plan); 27 is the hazard
    // BOUNDARIES (strokes, over it). One panel row, two export requests.
    expect(isRoleSplit(ALL_LAYERS.fema)).toBe(true);
    const parts = rolesOf(ALL_LAYERS.fema);
    expect(parts.map((p) => p.role)).toEqual(["area", "line"]);
    expect(parts[0].layers).toEqual([28]);
    expect(parts[1].layers).toEqual([27]);
    // A split's sublayers must PARTITION the config's own list — never invent or drop one.
    const declared = [...(ALL_LAYERS.fema.layers || [])].sort();
    const split = parts.flatMap((p) => p.layers).sort();
    expect(split).toEqual(declared);
    for (const id of ["bkdd_drainage", "bkdd_dmp"]) {
      const ps = rolesOf(ALL_LAYERS[id]);
      expect(ps.length, id).toBe(2);
      expect(ps.flatMap((p) => p.layers).sort(), id).toEqual([...ALL_LAYERS[id].layers].sort());
    }
  });
});

describe("NEW-1 — no FREE-FORM z-order UI, and no second stacking scheme", () => {
  /* AMENDED 2026-07-30 (the "Show above plan" item): the ban was, and stays, on FREE-FORM
   * ordering — front/back, up/down, a per-layer z-index. What is now sanctioned is exactly ONE
   * named two-state control, because the original reasoning had a hole: it called opacity the
   * escape hatch, and opacity cannot move a layer out from under a building. The DEFAULT order
   * is untouched, which is what keeps the owner's contours case a zero-click case. */
  it("the layers panel exposes no free-form z-order control", () => {
    // Comments stripped first: this asserts on what the panel RENDERS, and the file's own
    // header comment explains the rule by naming the thing it forbids.
    const panel = read("components/LayerPanel.jsx")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/[^\n]*/g, "$1");
    for (const banned of ["Bring to front", "Send to back", "zIndex", "z-order", "Move up", "Move down"]) {
      expect(panel, `LayerPanel must not offer "${banned}" — the model is fixed`).not.toContain(banned);
    }
    // …and the ONE sanctioned ordering affordance is the named two-state lift.
    expect(panel).toContain("Show above plan");
  });

  it("the planner names panes from the model instead of picking its own z-index", () => {
    const planner = read("SitePlanner.jsx");
    expect(planner).toContain("PANE_LINE");
    expect(planner).toContain("CANVAS_Z.gisLine");
    // The map-top host must never take pointer events — it sits over the plan, so if it did it
    // would swallow the click that selects a building and the drag that moves a handle.
    const host = planner.slice(planner.indexOf("the MAP-TOP HOST"), planner.indexOf("geoTopPaneRef} style") + 200);
    expect(host).toContain("pointerEvents: \"none\"");
  });

  it("the export composites the same THREE bands as the screen (PDF-PARITY)", () => {
    const ex = read("lib/exportSheet.js");
    expect(ex).toContain("exportBandFor");
    expect(ex).toContain("overRaster");
    expect(ex).toContain("overVector");
    expect(ex).toContain("frontAnchor"); // the lifted band prints INTO the plan's own front-band group
  });
});
