import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  parcelsOnTop, lineHostZ, CANVAS_Z, MAP_STACK,
  PANE_PARCEL_PICK, PANE_PARCEL_PICK_LABEL, PARCEL_TIER_ATTR, PARCEL_TIER_SLOT_ATTR, PARCEL_PICK_BAND_ATTR,
} from "../src/workspaces/site-planner/lib/mapStack.js";

const read = (rel) => readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/" + rel, import.meta.url)), "utf8");

/* NEW-1 — PARCELS IN FRONT while the Parcels tool is up (owner, 2026-10-20: "When I click the parcels tool, the parcels
 * should show above anything that I've got on the screen. Like if I click add county lots, that should show above anything
 * else."). The behaviour is proven in a real browser by e2e/parcels-in-front.spec.js; these are the cheap, CI-runnable teeth:
 * the ONE decision, and the wiring that keeps it the only decision. */
describe("NEW-1 — parcelsOnTop is the one decision", () => {
  it("is OFF for a plain plan: nothing open, Select tool, no mode armed", () => {
    expect(parcelsOnTop()).toBe(false);
    expect(parcelsOnTop({ leftPanel: null, floating: {}, identifyMode: false, tool: "select", mergePick: false, boundaryEdit: false })).toBe(false);
  });
  it("is OFF while any OTHER left panel is open — only the Land/Parcels panel counts", () => {
    for (const leftPanel of ["analysis", "drainage", "yield", "references", "standards", "properties", "grading"]) {
      expect(parcelsOnTop({ leftPanel }), leftPanel).toBe(false);
    }
    expect(parcelsOnTop({ floating: { yield: { x: 1, y: 1 } } })).toBe(false);
  });
  it("is ON while the Parcels panel is open — docked OR floating", () => {
    expect(parcelsOnTop({ leftPanel: "parcel" })).toBe(true);
    expect(parcelsOnTop({ floating: { parcel: { x: 10, y: 10 } } })).toBe(true);
  });
  it("is ON in every parcel mode, with the panel closed: Pick county lots · Draw · Split · Combine · Edit corners", () => {
    expect(parcelsOnTop({ identifyMode: true })).toBe(true);
    expect(parcelsOnTop({ tool: "parcel" })).toBe(true);
    expect(parcelsOnTop({ tool: "split" })).toBe(true);
    expect(parcelsOnTop({ mergePick: true })).toBe(true);
    expect(parcelsOnTop({ boundaryEdit: true })).toBe(true);
  });
  it("is OFF for the other drawing tools — a building / road / markup tool never lifts the parcels", () => {
    for (const tool of ["select", "building", "road", "paving", "pond", "easement", "measure", "callout", "polyline", "rect"]) {
      expect(parcelsOnTop({ tool }), tool).toBe(false);
    }
  });
  it("returns to the normal order the moment the tool closes (a pure function of state — nothing latches)", () => {
    const open = { leftPanel: "parcel", identifyMode: true };
    expect(parcelsOnTop(open)).toBe(true);
    expect(parcelsOnTop({ ...open, leftPanel: null, identifyMode: false })).toBe(false);
  });
});

describe("NEW-1 — the model keeps its order; only the line host moves, and only while the tool is up", () => {
  it("lineHostZ: over the plan normally, DOWN at the backdrop's level while parcels are in front", () => {
    expect(lineHostZ(false)).toBe(CANVAS_Z.gisLine);
    expect(lineHostZ()).toBe(CANVAS_Z.gisLine);
    expect(lineHostZ(true)).toBe(CANVAS_Z.basemap);
    expect(lineHostZ(true)).toBeLessThan(CANVAS_Z.plan);
    expect(lineHostZ(false)).toBeGreaterThan(CANVAS_Z.plan);
  });
  it("the fixed bottom→top stack is untouched — parcels in front is a mode-gated render move, not a new permanent tier", () => {
    expect(MAP_STACK.map((t) => t.id)).toEqual(["basemap", "gisArea", "reference", "parcel", "setback", "elements", "referenceFront", "gisAreaFront", "gisLine", "label", "handle"]);
  });
  it("names are the ones the planner, the export and the spec all agree on", () => {
    expect(PANE_PARCEL_PICK).toBe("parcelPickPane");
    expect(PANE_PARCEL_PICK_LABEL).toBe("parcelPickLabelPane");
    expect(PARCEL_TIER_ATTR).toBe("data-parcel-tier");
    expect(PARCEL_TIER_SLOT_ATTR).toBe("data-parcel-tier-slot");
    expect(PARCEL_PICK_BAND_ATTR).toBe("data-parcel-pick-band");
  });
});

describe("NEW-1 — the wiring (source guards; the browser spec proves it behaves)", () => {
  const planner = read("SitePlanner.jsx");

  it("the planner asks the ONE function, once, and every consumer reads that boolean", () => {
    expect(planner.match(/parcelsOnTop\(/g)).toHaveLength(1);
    expect(planner).toContain("const parcelsFront = parcelsOnTop({ leftPanel, floating, identifyMode, tool, mergePick, boundaryEdit });");
    expect(planner).toContain("lineHostZ(parcelsFront)");
    expect(planner).not.toMatch(/zIndex:\s*CANVAS_Z\.gisLine\b/); // the line host's z comes from the model, never a literal
  });

  it("the plan's parcel + setback tree is built ONCE and rendered in exactly one of two places", () => {
    expect(planner.match(/const parcelTierNodes = /g)).toHaveLength(1);
    expect(planner).toContain("{parcelsFront ? <g {...{ [PARCEL_TIER_SLOT_ATTR]: \"1\" }} /> : parcelTierNodes}");
    expect(planner).toContain("{parcelsFront && <g {...{ [PARCEL_TIER_ATTR]: \"top\" }}>{parcelTierNodes}</g>}");
    // …and the top slot is AFTER the annotations and BEFORE the chips + the handle layer (document order IS paint order)
    const iTop = planner.indexOf("PARCEL_TIER_ATTR]: \"top\"");
    expect(iTop).toBeGreaterThan(planner.indexOf("{measureBands.above.map("));
    expect(iTop).toBeLessThan(planner.indexOf("{parcelLabels}"));
    expect(iTop).toBeLessThan(planner.indexOf("data-handle-layer=\"1\""));
  });

  it("the county lots on offer mount in the in-SVG host's panes, loudly falling back if the host is missing", () => {
    expect(planner).toContain("mountBand(geoPickPaneRef.current, PANE_PARCEL_PICK, PANE_PARCEL_PICK_LABEL, 380)");
    expect(planner).toContain("pane: PANE_PARCEL_PICK, labelPane: PANE_PARCEL_PICK_LABEL");
    expect(planner).toContain("the Parcels-in-front panes are missing"); // LOUD-FAILURE
    // the host carries the same two mirrored transforms as the other bands
    expect(planner).toContain("[geoFrontPaneRef.current, geoTopPaneRef.current, geoPickPaneRef.current]");
    expect(planner).toContain("[geoTopWrapRef.current, geoFrontWrapRef.current, geoPickWrapRef.current]");
  });

  it("Pick county lots routes EVERY primary press to the lot, in the capture phase, ahead of any feature", () => {
    const i = planner.indexOf("onPointerDownCapture={(e) => { notePress(e);");
    const line = planner.slice(i, planner.indexOf("\n", i));
    expect(line.indexOf("handleStackPick(e)")).toBeGreaterThan(-1);
    expect(line.indexOf("handleIdentifyCapture(e)")).toBeGreaterThan(line.indexOf("handleStackPick(e)")); // Alt+press (click what is behind) still wins
    expect(line.indexOf("handleIdentifyCapture(e)")).toBeLessThan(line.indexOf("onCanvasVtxDownCapture(e)"));
    const fn = planner.slice(planner.indexOf("const handleIdentifyCapture"), planner.indexOf("const handleIdentifyCapture") + 900);
    expect(fn).toContain("onBgDown(e)"); // the press goes where a press on bare ground goes — no second implementation
    expect(fn).toContain("e.stopPropagation()");
    expect(fn).toContain("[data-handle-layer]"); // a grip you are holding keeps its press
  });

  it("the parcel layers accept a pane, and the lot numbers ride it (the default is unchanged for every other surface)", () => {
    const disp = read("lib/parcelDisplay.js");
    expect(disp).toContain('pane: pane || "overlayPane"');
    expect(disp).toContain("pane: labelPane");
    expect(disp).toContain("makeParcelImageLayer(url, opts && opts.pane ? { pane: opts.pane } : undefined)");
    const labels = read("lib/parcelLotLabelLayer.js");
    expect(labels).toContain("...(pane ? { pane } : null)");
    // MapFinder (the Map tab) passes none of it
    expect(read("MapFinder.jsx")).not.toContain("PANE_PARCEL_PICK");
  });

  it("PDF-PARITY: the export clone puts the moved group back in its slot, and strips the screen-only markers", () => {
    const ex = read("lib/exportSheet.js");
    expect(ex).toContain("tierSlot.replaceWith(topTier)");
    expect(ex).toContain("topTier.removeAttribute(PARCEL_TIER_ATTR)");
    // the pick band itself is screen chrome and never prints
    expect(planner).toMatch(/PARCEL_PICK_BAND_ATTR\]: "1" \}\}>\s*<foreignObject data-export="skip"/);
  });
});
