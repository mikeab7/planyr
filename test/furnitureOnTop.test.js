/* NEW-1 (2026-10-27) — the BUILDINGS table (and the scale bar and north arrow) print ABOVE every drawn site element, and in the
 * editable PDF each is its OWN annotation.
 *
 * Owner, on his real export (Goose Creek "Phase II - Base Case"): "the issue is that it's printing under." In the editable PDF every
 * site element is a PDF annotation and annotations always paint above the page picture; the table was page picture, so the detention
 * pond / Building 3's trailer strip painted over its rows ("ng 3"). The table stays where it was (top-right of the frame, as on
 * screen); the fix is the STACKING: each plate becomes a Stamp written after every site annotation, out of the page picture, with no
 * hover note box — selectable, movable and deletable in Bluebeam. (An earlier cut of this fix moved the table to a band off the
 * drawing; that premise was retracted — the placement is NOT the defect.)
 *
 * RED on the pre-fix writer: it emitted no furniture annotation at all (the plates stayed in the page, under the site).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSheetFurnitureSvg } from "../src/workspaces/site-planner/lib/sheetFurnitureLayout.js";
import { buildAnnotations, annotationDict } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { extractMarkupAnnotations, domToTree } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import { buildingSfRows } from "../src/workspaces/site-planner/lib/buildingSfTable.js";
import { svgToFake } from "./fixtures/svgToFake.js";

const FX = JSON.parse(readFileSync(new URL("./fixtures/realisticSiteClone.json", import.meta.url), "utf8"));
const [o, ux, uy] = FX.f2p;
const f2p = (p) => ({ x: o.x + p.x * (ux.x - o.x) + p.y * (uy.x - o.x), y: o.y + p.x * (ux.y - o.y) + p.y * (uy.y - o.y) });
const M0 = [1, 0, 0, -1, 0, 5000], frame = [-1e6, -1e6, 1e6, 1e6];
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };

const { rows, total } = buildingSfRows(FX.model.els);
// the sheet's furniture group exactly as buildExportSvgRaw builds it (plates tagged by kind), parsed into the same tree the browser path builds
const furnSvg = `<svg><g data-furniture="1" font-family="Inter, system-ui, sans-serif">${buildSheetFurnitureSvg({
  x: 0, y: 0, w: 1200, h: 800, ftPerUnit: 1, fmtFeet: (n) => String(Math.round(n)), pal: {},
  obstacles: [{ x: 700, y: 20, w: 300, h: 200 }], buildingRows: rows, buildingTotal: total, fmtSf: (n) => Math.round(n).toLocaleString(),
})}</g></svg>`;
const plates = svgToFake(furnSvg).querySelectorAll("[data-furniture-kind]");
const furnDescriptors = plates.map((el) => {
  const kind = el.getAttribute("data-furniture-kind");
  return { family: "sheet-furniture", id: kind, kind, tree: domToTree(el, { root: el }), meta: { subject: kind } };
});
const site = extractMarkupAnnotations(svgToFake(FX.svg), { ...FX.model, f2p });
const built = buildAnnotations([...site.descriptors, ...furnDescriptors], { M0, frame, patterns: site.patterns });

describe("the three plates are tagged and lifted as their own annotations", () => {
  it("the furniture group tags every plate by kind (the Buildings table included)", () => {
    expect(plates.map((p) => p.getAttribute("data-furniture-kind")).sort()).toEqual(["buildings-table", "north-arrow", "scale-bar"]);
  });
  it("each becomes ONE Stamp named planyr-sheet-furniture-<kind>, with a Subject", () => {
    const f = built.annots.filter((a) => a.family === "sheet-furniture");
    expect(f.map((a) => a.nm).sort()).toEqual(["planyr-sheet-furniture-buildings-table", "planyr-sheet-furniture-north-arrow", "planyr-sheet-furniture-scale-bar"]);
    for (const a of f) { expect(a.subtype).toBe("Stamp"); expect(annotationDict(a, "9 0 R")).toMatch(/\/Subj \(/); }
  });
  it("the table's appearance draws every building row and the total, from the building records", () => {
    const t = built.annots.find((a) => a.id === "buildings-table");
    expect(t.ap.stream).toContain("(BUILDINGS) Tj");
    for (const r of rows) expect(t.ap.stream, r.name).toContain(`(${r.name}) Tj`);
    expect(t.ap.stream).toContain("(Total) Tj");
    expect(t.ap.stream).toContain(`(${Math.round(total).toLocaleString()}) Tj`);
  });
});

describe("RED-PROOF shape — the plates paint ABOVE every site annotation", () => {
  const idx = built.annots.map((a, i) => (a.family === "sheet-furniture" ? i : -1)).filter((i) => i >= 0);
  const siteIdx = built.annots.map((a, i) => (a.family === "sheet-furniture" ? -1 : i)).filter((i) => i >= 0);
  it("there is real site geometry to be above (not vacuous)", () => {
    expect(siteIdx.length).toBeGreaterThan(40);
    expect(built.annots.some((a) => a.family === "building")).toBe(true);
  });
  it("/Annots order is paint order: every furniture Stamp comes after EVERY site annotation", () => {
    expect(idx).toHaveLength(3);
    expect(Math.min(...idx)).toBeGreaterThan(Math.max(...siteIdx));
  });
  it("in the file itself the order survives to the /Annots array", () => {
    const pdf = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 100, pixelH: 77, widthIn: 11, heightIn: 8.5, annotations: built.annots }));
    const nms = [...pdf.matchAll(/\/Type \/Annot [^\n]*?\/NM \(([^)]*)\)/g)].map((m) => m[1]);
    const first = nms.findIndex((n) => /sheet-furniture/.test(n));
    expect(first).toBeGreaterThan(40);
    expect(nms.slice(first).every((n) => /sheet-furniture/.test(n))).toBe(true);
  });
});

describe("no hover note box, and removable", () => {
  it("no /Contents, no /T, no /Popup; /F 4 (Print only — not Locked or ReadOnly)", () => {
    for (const a of built.annots.filter((x) => x.family === "sheet-furniture")) {
      const d = annotationDict(a, "9 0 R");
      expect(d).not.toMatch(/\/Contents /);
      expect(d).not.toMatch(/\/T /);
      expect(d).not.toMatch(/Popup/);
      expect(d).toMatch(/\/F 4 /);
    }
  });
});

describe("source guards — the sheet path", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const exportSheet = read("../src/workspaces/site-planner/lib/exportSheet.js");
  it("the editable PDF lifts every [data-furniture-kind] plate into an annotation after the site's, and only removes a plate once its annotation exists", () => {
    expect(exportSheet).toMatch(/querySelectorAll\("\[data-furniture-kind\]"\)/);
    expect(exportSheet).toMatch(/family: "sheet-furniture", id: kind/);
    expect(exportSheet).toMatch(/if \(haveAnnot\(kind\)\) el\.remove\(\)/);
    expect(exportSheet.indexOf("extractMarkupAnnotations(built.clone")).toBeLessThan(exportSheet.indexOf('querySelectorAll("[data-furniture-kind]")'));
  });
  it("the table is still placed with the other plates (no separate band): printSheet reserves nothing for it", () => {
    expect(read("../src/workspaces/site-planner/lib/printSheet.js")).not.toMatch(/buildingsBand|bandSvg/);
    expect(exportSheet).toMatch(/buildingRows: bldgTable\.rows/);
  });
  it("on the flattened sheet and the PNG the furniture group is appended after every drawn element", () => {
    const a = exportSheet.indexOf("root.appendChild(furn)");
    expect(a).toBeGreaterThan(exportSheet.indexOf("placeVector(overVector, true)"));
  });
});
