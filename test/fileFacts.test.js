import { describe, it, expect } from "vitest";
import {
  DOC_CLASS, classifyDocClass, makeFileFacts, mergeFacts, captureBrowserFacts,
  placementReadiness, PLACEMENT_FLAG_KEYS,
} from "../src/shared/files/fileFacts.js";

describe("fileFacts — document-class classification (B181/NEW-1)", () => {
  it("treats survey/civil/architectural drawings as spatial", () => {
    expect(classifyDocClass({ discipline: "Survey" })).toBe(DOC_CLASS.SPATIAL);
    expect(classifyDocClass({ discipline: "Civil" })).toBe(DOC_CLASS.SPATIAL);
    expect(classifyDocClass({ discipline: "Architectural" })).toBe(DOC_CLASS.SPATIAL);
  });
  it("treats geotech/environmental/contracts as reference", () => {
    expect(classifyDocClass({ discipline: "Geotech" })).toBe(DOC_CLASS.REFERENCE);
    expect(classifyDocClass({ discipline: "Environmental" })).toBe(DOC_CLASS.REFERENCE);
    expect(classifyDocClass({ discipline: "Other", item: "Purchase agreement" })).toBe(DOC_CLASS.REFERENCE);
  });
  it("treats a title commitment as BOTH (reference doc + boundary/easement source)", () => {
    expect(classifyDocClass({ discipline: "Other", item: "Title Commitment" })).toBe(DOC_CLASS.BOTH);
    expect(classifyDocClass({ title: "Schedule B exceptions" })).toBe(DOC_CLASS.BOTH);
  });
  it("a legal description / plat anywhere is spatial", () => {
    expect(classifyDocClass({ discipline: "Other", item: "Metes and bounds legal description" })).toBe(DOC_CLASS.SPATIAL);
    expect(classifyDocClass({ discipline: "Other", item: "Recorded plat" })).toBe(DOC_CLASS.SPATIAL);
  });
});

describe("fileFacts — schema + merge", () => {
  it("defaults every placement flag to absent/unknown", () => {
    const f = makeFileFacts();
    for (const k of PLACEMENT_FLAG_KEYS) expect(f).toHaveProperty(k);
    expect(f.embeddedCoords.present).toBe(false);
    expect(f.dimensions).toEqual([]);
  });
  it("merges a backend pass over a browser pass per-flag (backend wins, cheap flags kept)", () => {
    const browser = captureBrowserFacts({ discipline: "Civil", feetPerInch: 100, scaleText: "1\"=100'", sheet: { std: true, label: "ARCH D (24×36)" }, pageWpt: 1728, pageHpt: 2592 });
    const backend = mergeFacts(browser, {
      embeddedCoords: { present: true, crs: "EPSG:2278" },
      scaleBar: { present: true, lengthPx: 200, realFt: 100 },
      dimensions: [{ valueFt: 240, label: "240'", p1: { ix: 0, iy: 0 }, p2: { ix: 480, iy: 0 } }],
      source: "backend",
    });
    expect(backend.embeddedCoords).toEqual({ present: true, crs: "EPSG:2278" });
    expect(backend.statedScale.feetPerInch).toBe(100);     // cheap browser flag preserved
    expect(backend.pageSize.std).toBe(true);
    expect(backend.dimensions).toHaveLength(1);
    expect(backend.source).toBe("backend");
  });
});

describe("fileFacts — captureBrowserFacts", () => {
  it("fills the cheap flags and marks the source browser", () => {
    const f = captureBrowserFacts({ discipline: "Survey", item: "ALTA survey", feetPerInch: 50, scaleText: "1\"=50'", sheet: { std: true, label: "ANSI D (22×34)" }, pageWpt: 1584, pageHpt: 2448 });
    expect(f.docClass).toBe(DOC_CLASS.SPATIAL);
    expect(f.statedScale).toEqual({ text: "1\"=50'", feetPerInch: 50 });
    expect(f.pageSize.std).toBe(true);
    expect(f.source).toBe("browser");
    expect(typeof f.capturedAt).toBe("number");
  });
});

describe("fileFacts — placementReadiness (drives the NEW-3 cascade)", () => {
  it("embedded coords are the top ready rung", () => {
    const r = placementReadiness(makeFileFacts({ embeddedCoords: { present: true, crs: "EPSG:2278" } }));
    expect(r.embedded.ready).toBe(true);
    expect(r.embedded.why).toMatch(/EPSG:2278/);
  });
  it("a labeled dimension OR scale bar makes the graphic rung ready", () => {
    expect(placementReadiness(makeFileFacts({ dimensions: [{ valueFt: 240 }] })).graphic.ready).toBe(true);
    expect(placementReadiness(makeFileFacts({ scaleBar: { present: true, lengthPx: 200, realFt: 100 } })).graphic.ready).toBe(true);
    expect(placementReadiness(makeFileFacts()).graphic.ready).toBe(false);
  });
  it("manual is always available, with a reason on every rung", () => {
    const r = placementReadiness(makeFileFacts());
    expect(r.manual.ready).toBe(true);
    for (const k of ["embedded", "boundary", "graphic", "manual"]) expect(typeof r[k].why).toBe("string");
  });
});
