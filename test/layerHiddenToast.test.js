/* NEW-1 — "layer hidden at this zoom" toast: the crossing logic. */
import { describe, it, expect } from "vitest";
import {
  hiddenAtZoom, hiddenNow, hiddenMessage, nextHiddenToast, layerMaxZoom,
} from "../src/workspaces/site-planner/lib/layerHiddenToast.js";
import { TERRAIN_MIN_ZOOM, GATE_CLEARANCE } from "../src/workspaces/site-planner/lib/layerZoomGate.js";

const topo = { id: "contours", cfg: { kind: "contours", label: "Topo contours" }, on: true };
const osm = { id: "osm", cfg: { kind: "overpass", label: "Power lines" }, on: true };
const fema = { id: "fema", cfg: { kind: "esriDynamic", label: "FEMA flood" }, on: true };
const far = { id: "far", cfg: { kind: "vector", label: "Wide thing", minZoom: 8, maxZoom: 12 }, on: true };
const OUT = TERRAIN_MIN_ZOOM - 3;
const IN = TERRAIN_MIN_ZOOM + 1;

describe("hiddenAtZoom — generic from the config", () => {
  it("below the gate → zoom-in target just past it", () => {
    expect(hiddenAtZoom(topo.cfg, OUT)).toEqual({ side: "below", target: TERRAIN_MIN_ZOOM + GATE_CLEARANCE });
  });
  it("inside the range, and ungated layers, never hide", () => {
    expect(hiddenAtZoom(topo.cfg, IN)).toBeNull();
    expect(hiddenAtZoom(fema.cfg, 1)).toBeNull();
  });
  it("a max zoom hides when zoomed IN too far, targeting a hair inside", () => {
    expect(layerMaxZoom(far.cfg)).toBe(12);
    expect(hiddenAtZoom(far.cfg, 14)).toEqual({ side: "above", target: 12 - GATE_CLEARANCE });
    expect(hiddenAtZoom(far.cfg, 10)).toBeNull();
  });
  it("bad zoom never hides", () => {
    expect(hiddenAtZoom(topo.cfg, null)).toBeNull();
    expect(hiddenAtZoom(topo.cfg, NaN)).toBeNull();
  });
  it("off layers are ignored", () => {
    expect(hiddenNow([{ ...topo, on: false }], OUT)).toEqual([]);
  });
});

describe("nextHiddenToast — once per crossing", () => {
  it("fires on turn-on while out of range", () => {
    const r = nextHiddenToast(new Set(), [topo], OUT);
    expect(r.toast.text).toBe("Topo contours is hidden at this zoom");
    expect(r.toast.action.label).toBe("Zoom in");
    expect(r.toast.action.target).toBeCloseTo(TERRAIN_MIN_ZOOM + GATE_CLEARANCE);
  });
  it("fires on initial load out of range (null = nothing announced yet)", () => {
    expect(nextHiddenToast(null, [topo], OUT).toast).not.toBeNull();
  });
  it("does not fire on initial load when in range", () => {
    expect(nextHiddenToast(null, [topo], IN).toast).toBeNull();
  });
  it("does not fire again while staying out of range (pan/zoom ticks)", () => {
    let s = nextHiddenToast(null, [topo], OUT);
    for (const z of [OUT, OUT - 1, OUT + 0.5]) {
      s = nextHiddenToast(s.announced, [topo], z);
      expect(s.toast).toBeNull();
    }
  });
  it("re-arms after coming back in range, then fires once on the next crossing out", () => {
    let s = nextHiddenToast(null, [topo], OUT);
    s = nextHiddenToast(s.announced, [topo], IN);
    expect(s.toast).toBeNull();
    s = nextHiddenToast(s.announced, [topo], OUT);
    expect(s.toast).not.toBeNull();
    s = nextHiddenToast(s.announced, [topo], OUT);
    expect(s.toast).toBeNull();
  });
  it("re-arms when the layer is turned off and on again while out of range", () => {
    let s = nextHiddenToast(null, [topo], OUT);
    s = nextHiddenToast(s.announced, [{ ...topo, on: false }], OUT);
    s = nextHiddenToast(s.announced, [topo], OUT);
    expect(s.toast).not.toBeNull();
  });
  it("never fires for a layer that draws at every zoom", () => {
    expect(nextHiddenToast(null, [fema], 2).toast).toBeNull();
  });
  it("two layers crossing together → ONE combined toast", () => {
    const r = nextHiddenToast(null, [topo, osm, fema], 5);
    expect(r.toast.text).toBe("Topo contours and Power lines are hidden at this zoom");
    expect(r.toast.ids).toEqual(["contours", "osm"]);
    // zoom in to the level where BOTH draw
    expect(r.toast.action.target).toBeCloseTo(Math.max(TERRAIN_MIN_ZOOM, 14) + GATE_CLEARANCE);
  });
  it("a second layer crossing later fires again, naming everything hidden now", () => {
    // OSM gate (14) < terrain gate: at 15 only... pick a zoom hiding only the higher gate first.
    const z = 14.5; // osm draws (>=14), terrain hidden (<16)
    let s = nextHiddenToast(null, [topo, osm], z);
    expect(s.toast.text).toBe("Topo contours is hidden at this zoom");
    s = nextHiddenToast(s.announced, [topo, osm], 13);
    expect(s.toast.text).toBe("Topo contours and Power lines are hidden at this zoom");
  });
  it("above-range layer offers Zoom out; a mix offers no single action", () => {
    expect(nextHiddenToast(null, [far], 14).toast.action.label).toBe("Zoom out");
    expect(nextHiddenToast(null, [far, topo], 14).toast.action).toBeNull();
  });
});

describe("hiddenMessage", () => {
  it("joins 1 / 2 / 3 labels and dedupes", () => {
    expect(hiddenMessage(["A"])).toBe("A is hidden at this zoom");
    expect(hiddenMessage(["A", "B", "C"])).toBe("A, B and C are hidden at this zoom");
    expect(hiddenMessage(["A", "A"])).toBe("A is hidden at this zoom");
  });
});
