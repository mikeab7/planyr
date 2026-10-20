/* NEW-1 — the dock-layer Properties panel (truck court · trailer parking · buffer): the pure rules in lib/dockLayerPanel.js
 * and a source guard that the old copy / second remove path / read-only court length have not come back. The panel is
 * driven for real by ui-audit/verify-dock-layer-panel.mjs (V-entry in ledger/verification). */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  dockLayerTitleWord, dockLayerPosition, dockLayerName, dockRemovalPlan, autoField, slopeBandNotice, lengthIsFull, DOCK_STEPS, REMOVED_COPY,
} from "../src/workspaces/site-planner/lib/dockLayerPanel.js";

const chain3 = [{ truckCourt: { side: "left" }, type: "paving" }, { type: "trailer", forCourt: "c" }, { type: "landscape", buffer: true, forTrailer: "t" }];

describe("dock layer words", () => {
  it("titles and position follow the default sequence", () => {
    expect([0, 1, 2].map(dockLayerTitleWord)).toEqual(["Truck court", "Trailer parking", "Buffer"]);
    expect(dockLayerPosition(0)).toBe("Dock layer 1 of 3");
    expect(dockLayerPosition(2)).toBe("Dock layer 3 of 3");
  });
  it("names come from the element itself", () => {
    expect(chain3.map((z) => dockLayerName(z))).toEqual(["truck court", "trailer parking", "buffer"]);
    expect(dockLayerName({ type: "road" }, "Road / Drive")).toBe("road");
  });
});

describe("removal plan — generated from the real chain", () => {
  it("truck court of three takes all three and says so", () => {
    const p = dockRemovalPlan({ chain: chain3, idx: 0, wallLabel: "W" });
    expect(p.count).toBe(3);
    expect(p.confirmLabel).toBe("Remove all three");
    expect(p.now).toBe("W wall · truck court → trailer parking → buffer");
    expect(p.after).toBe("W wall · no dock layers");
    expect(p.copy).toMatch(/Trailer parking and buffer sit outside this truck court, so they go with it\./);
    expect(p.note).toBe("Removed. W wall has no dock layers.");
  });
  it("the middle layer takes itself and the one outside it, and keeps what is inboard", () => {
    const p = dockRemovalPlan({ chain: chain3, idx: 1, wallLabel: "E" });
    expect(p.count).toBe(2);
    expect(p.confirmLabel).toBe("Remove both");
    expect(p.after).toBe("E wall · truck court");
  });
  it("the outermost layer alone: plain Remove, no explanatory copy, one-layer card", () => {
    const p = dockRemovalPlan({ chain: chain3, idx: 2, wallLabel: "W" });
    expect(p.count).toBe(1);
    expect(p.outerOnly).toBe(true);
    expect(p.copy).toBeNull();
    expect(p.confirmLabel).toBe("Remove");
    expect(p.after).toBe("W wall · truck court → trailer parking");
  });
  it("an appended layer is counted, not assumed to be three", () => {
    const four = [...chain3, { type: "road" }];
    const p = dockRemovalPlan({ chain: four, idx: 0, wallLabel: "N", nameOf: (z) => dockLayerName(z, "Road") });
    expect(p.count).toBe(4);
    expect(p.confirmLabel).toBe("Remove all 4");
  });
});

describe("Auto vs typed", () => {
  it("null/absent = Auto and shows the computed number; a value = typed", () => {
    expect(autoField(null, 14.5)).toEqual({ isAuto: true, shown: 14.5 });
    expect(autoField(undefined, null)).toEqual({ isAuto: true, shown: null });
    expect(autoField(3.5, 1)).toEqual({ isAuto: false, shown: 3.5 });
    expect(autoField(0, 1)).toEqual({ isAuto: false, shown: 0 });
  });
});

describe("slope band notice — kept as typed, said once", () => {
  const band = { min: 1, max: 2 };
  it("only a typed slope outside the band", () => {
    expect(slopeBandNotice({ slopePct: null, band, label: "truck court" })).toBeNull();
    expect(slopeBandNotice({ slopePct: 1, band, label: "truck court" })).toBeNull();
    expect(slopeBandNotice({ slopePct: 2, band, label: "truck court" })).toBeNull();
    expect(slopeBandNotice({ slopePct: 3.5, band, label: "truck court" })).toBe("Outside the 1.0–2.0% truck court band. Kept as typed.");
    expect(slopeBandNotice({ slopePct: 0.4, band, label: "trailer parking" })).toBe("Outside the 1.0–2.0% trailer parking band. Kept as typed.");
  });
});

describe("length + steps", () => {
  it("full wall within half a foot", () => {
    expect(lengthIsFull(1489, 1489)).toBe(true);
    expect(lengthIsFull(1479, 1489)).toBe(false);
  });
  it("owner-specified steps", () => {
    expect(DOCK_STEPS).toEqual({ depth: 5, length: 10, elevation: 0.5, slope: 0.1, weight: 1, opacity: 10 });
  });
});

describe("source guard — the redesigned panel stays redesigned", () => {
  const src = readFileSync(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url), "utf8");
  const branch = src.slice(src.indexOf(") : isDockLayerEl(selEl) ? (() => {"), src.indexOf(') : (selEl.type === "sidewalk" || selEl.type === "landscape") && selEl.attachedTo ? ('));
  const panel = src.slice(src.indexOf("function DockLayerPanel("), src.indexOf("// PercentField — compact"));
  it("the dock branch hands everything to DockLayerPanel", () => { expect(branch).toContain("<DockLayerPanel"); });
  it("none of the removed copy survives in the panel or its branch", () => {
    for (const s of REMOVED_COPY) { expect(branch).not.toContain(s); expect(panel).not.toContain(s); }
  });
  it("exactly one remove control, and no browser confirm", () => {
    expect((panel.match(/data-testid="dock-remove"/g) || []).length).toBe(1);
    expect(panel).not.toMatch(/window\.confirm|\bconfirm\(/);
    expect(branch).not.toMatch(/window\.confirm|\bconfirm\(/);
  });
  it("the generic Delete / Pin / Properties / Footprint / Pad / Grading blocks skip a dock layer", () => {
    expect((src.match(/!isDockLayerEl\(selEl\)/g) || []).length).toBeGreaterThanOrEqual(6);
  });
  it("length is an editable stepper again (it was read-only text)", () => { expect(panel).toContain('testid="dock-length"'); });
  it("no px / hex in the panel", () => { expect(panel).not.toMatch(/#[0-9a-fA-F]{6}\b/); expect(panel).not.toMatch(/>\s*px\s*</); });
});
