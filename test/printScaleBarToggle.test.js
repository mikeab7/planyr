/* NEW-1 (2026-11-13, owner: "when printing a site plan to PDF, let him remove the scale from the image") — the Print panel's
 * "Scale bar" checkbox.
 *
 * What the owner gets: unticking it prints NO graphic scale bar and NO stated scale in the title block, leaves no empty gap where
 * either was, keeps the north arrow and Buildings table where they were, and keeps the PDF's embedded measurement scale (the page
 * calibration Bluebeam / Acrobat read) exactly as it is. Default ON: an old plan with no saved value prints exactly as before.
 *
 * No jsdom here: the sheet's pure tiers (furniture layout, annotation writer, title block) are driven directly; the panel is rendered
 * to static markup; the wiring is checked as source; the real built sheet is in e2e/print-scale-bar-toggle.spec.js. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import PrintCompose from "../src/workspaces/site-planner/components/PrintCompose.jsx";
import { furnitureLayout, buildSheetFurnitureSvg } from "../src/workspaces/site-planner/lib/sheetFurnitureLayout.js";
import { PAPER_SIZES, pageSize, printSheetLayout, buildPrintSheetSvg } from "../src/workspaces/site-planner/lib/printSheet.js";
import { buildAnnotations } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { extractMarkupAnnotations, domToTree } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { buildingSfRows } from "../src/workspaces/site-planner/lib/buildingSfTable.js";
import { svgToFake } from "./fixtures/svgToFake.js";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const FX = JSON.parse(read("./fixtures/realisticSiteClone.json"));
const [o, ux, uy] = FX.f2p;
const f2p = (p) => ({ x: o.x + p.x * (ux.x - o.x) + p.y * (uy.x - o.x), y: o.y + p.x * (ux.y - o.y) + p.y * (uy.y - o.y) });
const { rows, total } = buildingSfRows(FX.model.els);
const fmt = (n) => String(Math.round(n));

const base = { x: 0, y: 0, w: 1200, h: 800, ftPerUnit: 1, fmtFeet: fmt, pal: {}, fmtSf: fmt, buildingRows: rows, buildingTotal: total };
const kinds = (svg) => [...svg.matchAll(/data-furniture-kind="([a-z-]+)"/g)].map((m) => m[1]).sort();
const boxOf = (p) => ({ x: p.tx, y: p.ty, w: p.plateW, h: p.plateH });
const disjoint = (a, b) => a.x + a.w <= b.x + 1e-6 || b.x + b.w <= a.x + 1e-6 || a.y + a.h <= b.y + 1e-6 || b.y + b.h <= a.y + 1e-6;

describe("(a) the furniture layout with the scale bar off", () => {
  it("default ON is untouched: omitted === true, byte for byte, three plates", () => {
    const omitted = buildSheetFurnitureSvg(base);
    const explicit = buildSheetFurnitureSvg({ ...base, showScaleBar: true });
    expect(explicit).toBe(omitted);
    expect(kinds(omitted)).toEqual(["buildings-table", "north-arrow", "scale-bar"]);
    expect(omitted).toContain("FEET");
  });

  it("OFF emits no scale-bar plate and no FEET label — and nothing else is dropped", () => {
    const off = buildSheetFurnitureSvg({ ...base, showScaleBar: false });
    expect(kinds(off)).toEqual(["buildings-table", "north-arrow"]);
    expect(off).not.toContain("FEET");
    expect(off).toContain("BUILDINGS");
    expect(furnitureLayout({ ...base, showScaleBar: false }).scaleBar).toBeUndefined();
  });

  it("OFF with no plan content: the north arrow keeps its historical top-left, the table a different corner (no hole, no stack)", () => {
    const L = furnitureLayout({ ...base, showScaleBar: false });
    expect(L.north.corner).toBe("tl");
    expect(L.buildings.corner).not.toBe("tl");
    expect(disjoint(boxOf(L.north), boxOf(L.buildings))).toBe(true);
  });

  it("OFF with an obstacle in the north arrow's corner: it moves out of it, still disjoint from the table, still inside the frame", () => {
    const obstacles = [{ x: 0, y: 0, w: 400, h: 300 }];
    const L = furnitureLayout({ ...base, obstacles, showScaleBar: false });
    expect(L.north.corner).not.toBe("tl");
    expect(L.buildings.corner).not.toBe(L.north.corner);
    for (const p of [L.north, L.buildings]) {
      expect(p.tx).toBeGreaterThanOrEqual(0); expect(p.ty).toBeGreaterThanOrEqual(0);
      expect(p.tx + p.plateW).toBeLessThanOrEqual(base.w); expect(p.ty + p.plateH).toBeLessThanOrEqual(base.h);
    }
    expect(disjoint(boxOf(L.north), boxOf(L.buildings))).toBe(true);
  });

  it("every paper size, both orientations: no bar, north arrow and table inside the safe area and disjoint", () => {
    let n = 0;
    for (const { key } of PAPER_SIZES) for (const orient of ["landscape", "portrait"]) {
      const { wIn, hIn } = pageSize(key, orient);
      const w = 1000, h = Math.round((1000 * hIn) / wIn);
      const frame = { ...base, w, h };
      const L = furnitureLayout({ ...frame, showScaleBar: false });
      expect(L.scaleBar, `${key} ${orient}`).toBeUndefined();
      expect(kinds(buildSheetFurnitureSvg({ ...frame, showScaleBar: false })), `${key} ${orient}`).toEqual(["buildings-table", "north-arrow"]);
      for (const p of [L.north, L.buildings]) {
        expect(p.tx, `${key} ${orient}`).toBeGreaterThanOrEqual(0); expect(p.ty).toBeGreaterThanOrEqual(0);
        expect(p.tx + p.plateW).toBeLessThanOrEqual(w); expect(p.ty + p.plateH).toBeLessThanOrEqual(h);
      }
      expect(disjoint(boxOf(L.north), boxOf(L.buildings)), `${key} ${orient}`).toBe(true);
      n++;
    }
    expect(n).toBe(PAPER_SIZES.length * 2); // vacuity guard: the loop really ran for every size
  });
});

describe("(b) the title block: no stated scale, and no empty row left behind", () => {
  const sheetArgs = (scale) => ({
    layout: printSheetLayout({ paper: "letter", orient: "landscape", titleBlockExtra: !!scale }),
    planSvg: "<svg/>", title: "Goose Creek", sub: "Concept A", date: "2026.11.13", scale, preparedBy: "", metrics: [], stormwater: [], note: "", pal: {},
  });
  it("a stated scale prints in the title block; with none the row is not reserved (the plan box is taller)", () => {
    const withScale = sheetArgs('1" = 100\'');
    const without = sheetArgs("");
    expect(buildPrintSheetSvg(withScale)).toContain("1&quot; = 100'");
    expect(buildPrintSheetSvg(without)).not.toMatch(/1&quot; = 100/);
    expect(without.layout.plan.h).toBeGreaterThan(withScale.layout.plan.h);
  });
  it("buildComposedSheet blanks the stated scale when the bar is off, in BOTH places that read it (the reserved row and the drawn text)", () => {
    const src = read("../src/workspaces/site-planner/lib/exportSheet.js");
    expect(src).toMatch(/const titleScale = includeScaleBar === false \? "" : scaleLabelText;/);
    expect(src).toMatch(/titleBlockExtra: !!\(titleScale \|\| preparedBy\)/);
    expect(src).toMatch(/scale: titleScale, preparedBy,/);
    expect(src).not.toMatch(/scale: scaleLabelText/);
    expect(src).not.toMatch(/titleBlockExtra: !!\(scaleLabelText/);
  });
});

describe("(c) the PDF's embedded measurement scale is the same with the bar on or off", () => {
  const M0 = [1, 0, 0, -1, 0, 5000], frame = [-1e6, -1e6, 1e6, 1e6];
  const site = extractMarkupAnnotations(svgToFake(FX.svg), { ...FX.model, f2p });
  const withPlates = (showScaleBar) => {
    const svg = `<svg><g data-furniture="1">${buildSheetFurnitureSvg({ ...base, obstacles: [{ x: 700, y: 20, w: 300, h: 200 }], showScaleBar })}</g></svg>`;
    const descriptors = svgToFake(svg).querySelectorAll("[data-furniture-kind]").map((el) => {
      const kind = el.getAttribute("data-furniture-kind");
      return { family: "sheet-furniture", id: kind, kind, tree: domToTree(el, { root: el }), meta: { subject: kind } };
    });
    return buildAnnotations([...site.descriptors, ...descriptors], { M0, frame, patterns: site.patterns, ftPerPt: 0.5 });
  };
  const on = withPlates(true), off = withPlates(false);

  it("not vacuous: the sheet carries real measurements, so the page has a viewport to lose", () => {
    expect(on.annots.some((a) => a.measure)).toBe(true);
    expect(on.viewport).toBeTruthy();
  });
  it("OFF writes the identical page viewport (bbox + /Measure) and the identical site annotations", () => {
    expect(off.viewport).toEqual(on.viewport);
    const siteOnly = (r) => r.annots.filter((a) => a.family !== "sheet-furniture").map((a) => a.nm);
    expect(siteOnly(off)).toEqual(siteOnly(on));
  });
  it("OFF writes no scale-bar Stamp; the north arrow and Buildings table Stamps remain", () => {
    const ids = (r) => r.annots.filter((a) => a.family === "sheet-furniture").map((a) => a.id).sort();
    expect(ids(on)).toEqual(["buildings-table", "north-arrow", "scale-bar"]);
    expect(ids(off)).toEqual(["buildings-table", "north-arrow"]);
  });
});

describe("(d) the panel row and its wiring", () => {
  const noop = () => {};
  const props = (o = {}) => ({
    paper: "letter", onPaper: noop, orient: "landscape", onOrient: noop, fitToFramePage: false, onToggleFitToFramePage: noop,
    scaleFtPerIn: null, onScale: noop, fitWarning: null, previewSrc: null, previewLoading: false, pageAspect: 11 / 8.5,
    siteLabel: "Goose Creek", planLabel: "Concept A", dateStr: "Nov 13, 2026", preparedBy: "", onPreparedBy: noop,
    showDims: true, onToggleDims: noop, showAreas: true, onToggleAreas: noop,
    overlayPrintable: true, printOverlay: true, onTogglePrintOverlay: noop,
    mapLayersPrintable: true, printMapLayers: true, onToggleMapLayers: noop, showMetricsBand: true, onToggleMetricsBand: noop,
    buildingsTablePrintable: true, showBuildingsTable: true, onToggleBuildingsTable: noop, flattenMarkups: false, onToggleFlattenMarkups: noop,
    onReposition: noop, onCancel: noop, onDownload: noop, downloading: false, ...o,
  });
  const render = (o) => renderToStaticMarkup(createElement(PrintCompose, props(o)));
  const onThePlan = (h) => h.slice(h.indexOf("On the plan"), h.indexOf("Title block"));
  const row = (h) => (h.match(/<label[^>]*><input type="checkbox"([^>]*)\/>Scale bar<\/label>/) || [])[1];

  it("a 'Scale bar' checkbox row renders inside the 'On the plan' section, after Dimensions and Square feet labels", () => {
    const sec = onThePlan(render());
    expect(row(sec)).toBeDefined();
    expect(sec.indexOf("Dimensions")).toBeLessThan(sec.indexOf("Square feet labels"));
    expect(sec.indexOf("Square feet labels")).toBeLessThan(sec.indexOf("Scale bar"));
    expect(render().match(/Scale bar/g)).toHaveLength(1);
  });
  it("it is checked when the prop is omitted (an old plan) or true, and unchecked only when false", () => {
    expect(row(render())).toMatch(/checked/);
    expect(row(render({ showScaleBar: true }))).toMatch(/checked/);
    expect(row(render({ showScaleBar: false }))).not.toMatch(/checked/);
  });
  it("it uses the shared plain checkbox row (same label style as its siblings, no tooltip), and the panel keeps one text size", () => {
    const h = render();
    const labelStyle = (name) => (h.match(new RegExp(`<label style="([^"]*)"><input type="checkbox"[^>]*/>${name}</label>`)) || [])[1];
    expect(labelStyle("Scale bar")).toBeTruthy();
    expect(labelStyle("Scale bar")).toBe(labelStyle("Dimensions"));
    expect(h).not.toMatch(/<label[^>]*title="[^"]*"[^>]*><input type="checkbox"[^>]*\/>Scale bar/);
    const scroll = h.slice(h.indexOf("Paper"), h.indexOf("Download PDF"));
    const sizes = new Set([...scroll.matchAll(/font-size:([\d.]+)px/g)].map((m) => m[1]));
    expect([...sizes].filter((s) => s !== "12" && s !== "10.5")).toEqual([]);
  });
  it("the 'printed scale bar will agree' note only shows while a scale bar prints", () => {
    expect(render({ scaleFtPerIn: 100 })).toContain("The printed scale bar will agree with this ratio.");
    expect(render({ scaleFtPerIn: 100, showScaleBar: false })).not.toContain("scale bar will agree");
  });
  it("SitePlanner reads the saved setting as ON unless it is exactly false (a plan saved before this existed prints as before), in every consumer", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    // preview key, preview build, download, panel prop — one consumer each
    expect(src.match(/settings\.printScaleBar !== false/g)).toHaveLength(4);
    expect(src.match(/printScaleBar/g)).toHaveLength(5); // + the single writer
    expect(src).toMatch(/onToggleScaleBar=\{\(v\) => setSettings\(\(s\) => \(\{ \.\.\.s, printScaleBar: v \}\)\)\}/);
    expect(({}).printScaleBar !== false).toBe(true);
  });
  it("the download and the preview pass the flag to the SAME builder (PDF-PARITY by construction)", () => {
    const src = read("../src/workspaces/site-planner/SitePlanner.jsx");
    expect(src).toMatch(/composePageOverride, settings\.printBuildingsTable !== false, false, settings\.printScaleBar !== false\)\)/);
    expect(src).toMatch(/flattenMarkupsPref\(\), settings\.printScaleBar !== false\)/);
    const sheet = read("../src/workspaces/site-planner/lib/exportSheet.js");
    expect(sheet).toMatch(/showScaleBar: includeScaleBar !== false/);
  });
});
