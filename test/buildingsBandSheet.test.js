/* NEW-1 (2026-10-27) — the BUILDINGS / SF table prints OFF the drawing, and in the editable PDF it is its own object.
 *
 * The report (owner's real export, Goose Creek "Phase II - Base Case"): the table was a corner plate drawn INSIDE the plan
 * frame. In the editable PDF every site element is a PDF annotation and annotations always paint above the page picture, so
 * Building 3's trailer strip painted over the table's third row ("ng 3") and the table hid part of the site. A corner picker
 * that weighs bounding boxes can never fix that — a site that fills the frame has no free corner.
 *
 * The properties pinned here:
 *  1. the sheet reserves the table its OWN band (between the title block and the plan) — disjoint from the plan box on every
 *     paper × orientation × building count, so it cannot overlap a site of any shape or aspect;
 *  2. every caller that sizes the plan from the layout passes the same band (else the printed scale would be wrong);
 *  3. in the editable PDF the table is a separate Stamp annotation outside the plan window (movable / deletable in Bluebeam),
 *     with no /Contents (no hover note box), drawn from the same primitives as the page version (one builder);
 *  4. the scale bar and north arrow are lifted out of the page the same way (they sat under element annotations too);
 *  5. the values are the building records' (buildingSfRows), never a copy.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildingsBandModel, buildingEntries, bandSvg, bandTree, bandTextW } from "../src/workspaces/site-planner/lib/buildingsBand.js";
import { printSheetLayout, buildPrintSheetSvg, PAPER_SIZES, pageSizeForFit } from "../src/workspaces/site-planner/lib/printSheet.js";
import { buildAnnotations, annotationDict } from "../src/workspaces/site-planner/lib/pdfAnnotations.js";
import { extractMarkupAnnotations } from "../src/workspaces/site-planner/lib/annotationExtract.js";
import { jpegToPdf } from "../src/workspaces/site-planner/lib/imagePdf.js";
import { buildingSfRows } from "../src/workspaces/site-planner/lib/buildingSfTable.js";
import { svgToFake } from "./fixtures/svgToFake.js";

const mkRows = (n) => Array.from({ length: n }, (_, i) => ({ name: `Building ${i + 1}`, sf: 274200 + i * 138420 }));
const entriesOf = (n) => buildingEntries(mkRows(n), mkRows(n).reduce((a, r) => a + r.sf, 0));
const fakeJpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0xff, 0xd9]);
const latin1 = (u8) => { let s = ""; for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]); return s; };
const overlaps = (a, b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6;
const COUNTS = [1, 3, 9, 40];

describe("buildingsBandModel — the card", () => {
  const model = buildingsBandModel({ entries: entriesOf(3), width: 1000 });
  const texts = model.prims.filter((p) => p.tag === "text");

  it("carries every building's name and SF, then Total, from the entries it is given", () => {
    const strs = texts.map((t) => t.str);
    const rows = mkRows(3), total = rows.reduce((x, r) => x + r.sf, 0);
    for (const r of rows) { expect(strs).toContain(r.name); expect(strs).toContain(r.sf.toLocaleString()); }
    for (const s of ["BUILDINGS", "SF", "Total", total.toLocaleString()]) expect(strs).toContain(s);
  });
  it("no dash of any kind separates a name from its number (B2118784, kept)", () => {
    expect(texts.some((t) => /[—–]|\s-\s/.test(t.str))).toBe(false);
  });
  it("names are regular weight and left-aligned, numbers are bold and right-aligned, Total is bold", () => {
    const name = texts.find((t) => t.str === "Building 1"), num = texts.find((t) => t.str === "274,200"), total = texts.find((t) => t.str === "Total");
    expect(name.a["font-weight"]).toBe("400");
    expect(name.a["text-anchor"]).toBeUndefined();
    expect(num.a["font-weight"]).toBe("700");
    expect(num.a["text-anchor"]).toBe("end");
    expect(total.a["font-weight"]).toBe("700");
  });
  it("tabular: every number in a column shares ONE right edge", () => {
    const m = buildingsBandModel({ entries: entriesOf(9), width: 520 }); // forces several rows
    expect(m.rows).toBeGreaterThan(1);
    const nums = m.prims.filter((p) => p.tag === "text" && p.a["text-anchor"] === "end");
    const byEdge = new Map();
    nums.forEach((t) => byEdge.set(t.a.x, (byEdge.get(t.a.x) || 0) + 1));
    expect(byEdge.size).toBe(m.cols); // one edge per column, however many rows
  });
  it("no building → no card", () => {
    expect(buildingEntries([], 0)).toBeNull();
    expect(buildingsBandModel({ entries: null, width: 900 })).toBeNull();
  });
  it("fits the width it is given and never lets text cross its own cell, for 1 → 40 buildings", () => {
    for (const n of COUNTS) for (const width of [560, 794, 1020, 1700]) {
      const entries = entriesOf(n), m = buildingsBandModel({ entries, width });
      expect(m.w, `${n} bldgs @${width}`).toBeLessThanOrEqual(Math.max(width, m.w - 1) + 1e-6);
      if (width >= 560) expect(m.w).toBeLessThanOrEqual(width + 1e-6);
      const cellW = (m.w - m.prims.find((p) => p.tag === "line").a.x1) / m.cols;
      for (const t of m.prims.filter((p) => p.tag === "text" && p.a["text-anchor"] !== "end" && p.str !== "BUILDINGS" && p.str !== "SF")) {
        const e = entries.find((x) => x.name === t.str);
        const next = Math.ceil((t.a.x - m.prims.find((p) => p.tag === "line").a.x1) / cellW) * cellW + m.prims.find((p) => p.tag === "line").a.x1;
        expect(t.a.x + bandTextW(e.name, m.fs, !!e.total), `${e.name} stays in its cell`).toBeLessThan(next);
      }
    }
  });
  it("height grows by whole rows, so a long table is a short grid, not a tall column", () => {
    const one = buildingsBandModel({ entries: entriesOf(3), width: 1000 }), forty = buildingsBandModel({ entries: entriesOf(40), width: 1000 });
    expect(one.rows).toBe(1);
    expect(forty.rows).toBeGreaterThan(1);
    expect(forty.h).toBeLessThan(forty.rows * one.h); // shared padding, not stacked cards
    expect(forty.h).toBeLessThan(200);
  });
  it("SVG and PDF-annotation tree are drawn from the SAME primitives (one builder)", () => {
    const svg = bandSvg(model, 10, 20), tree = bandTree(model, 10, 20);
    expect(tree.kids).toHaveLength(model.prims.length);
    for (const t of tree.kids.filter((k) => k.tag === "text")) expect(svg).toContain(`>${t.str}</text>`);
    expect(svg).toContain('transform="translate(10,20)"');
  });
});

describe("printSheetLayout — the table has its own band, disjoint from the plan, on every sheet", () => {
  const inside = (b, r) => b.x >= r.x - 1e-6 && b.y >= r.y - 1e-6 && b.x + b.w <= r.x + r.w + 1e-6 && b.y + b.h <= r.y + r.h + 1e-6;
  it("RED-PROOF shape: for every paper × orientation × building count the band is inside the sheet, below the title block, ABOVE and disjoint from the plan box", () => {
    let checked = 0;
    for (const { key } of PAPER_SIZES) for (const orient of ["landscape", "portrait"]) for (const n of COUNTS) {
      const L = printSheetLayout({ paper: key, orient, buildings: { entries: entriesOf(n) } });
      const b = L.buildings;
      expect(b, `${key}/${orient}/${n}`).toBeTruthy();
      expect(inside(b, L.inner)).toBe(true);
      expect(b.y).toBeGreaterThanOrEqual(L.title.y + L.title.h);
      expect(overlaps(b, L.plan), `${key}/${orient}/${n} band vs plan`).toBe(false);
      expect(b.y + b.h).toBeLessThanOrEqual(L.plan.y + 1e-6);
      if (L.metrics) expect(overlaps(b, L.metrics)).toBe(false);
      expect(L.plan.h).toBeGreaterThan(L.inner.h * 0.4); // a long table never crushes the plan
      checked++;
    }
    expect(checked).toBe(PAPER_SIZES.length * 2 * COUNTS.length);
  });
  it("also holds on a Fit-to-frame page of any shape (wide, tall, extreme)", () => {
    for (const aspect of [0.3, 0.6, 1, 1.6, 4]) for (const { key } of PAPER_SIZES) {
      const page = pageSizeForFit(key, aspect);
      const L = printSheetLayout({ page, buildings: { entries: entriesOf(3) } });
      expect(overlaps(L.buildings, L.plan), `${key} aspect ${aspect}`).toBe(false);
      expect(inside(L.buildings, L.inner)).toBe(true);
    }
  });
  it("the Stats band toggle off still keeps the table clear of the plan", () => {
    const L = printSheetLayout({ includeMetrics: false, buildings: { entries: entriesOf(3) } });
    expect(overlaps(L.buildings, L.plan)).toBe(false);
  });
  it("no buildings (or the toggle off) → no band and the geometry is byte-identical to before", () => {
    const base = printSheetLayout({}), none = printSheetLayout({ buildings: null });
    expect(none).toEqual(base);
    expect(none.buildings).toBeNull();
  });
  it("the band takes its height from the plan box and nothing else moves (so callers must all pass it)", () => {
    const a = printSheetLayout({}), b = printSheetLayout({ buildings: { entries: entriesOf(3) } });
    expect(b.plan.h).toBeLessThan(a.plan.h);
    expect(b.plan.y).toBeGreaterThan(a.plan.y);
    expect(b.plan.y + b.plan.h).toBe(a.plan.y + a.plan.h); // the bottom edge (and the metrics band) is untouched
    expect(b.plan.w).toBe(a.plan.w);
    expect(b.metrics).toEqual(a.metrics);
  });
});

describe("buildPrintSheetSvg — the table is page content, or (editable PDF) deliberately not", () => {
  const L = printSheetLayout({ buildings: { entries: entriesOf(3) } });
  it("flattened / preview: the band is drawn once, inside its box", () => {
    const svg = buildPrintSheetSvg({ layout: L, planSvg: "<svg/>", title: "Goose Creek", pal: {} });
    expect((svg.match(/data-sheet-table="buildings"/g) || []).length).toBe(1);
    expect(svg).toContain(">Building 3<");
    expect(svg).toContain(`translate(${L.buildings.x},${L.buildings.y})`);
  });
  it("editable PDF: the page picture leaves it out (it is its own annotation), the band is still reserved", () => {
    const svg = buildPrintSheetSvg({ layout: L, planSvg: "<svg/>", title: "Goose Creek", pal: {}, buildingsAsAnnotation: true });
    expect(svg).not.toContain("BUILDINGS");
    expect(svg).not.toContain("data-sheet-table");
  });
});

describe("the editable PDF — the table is a separate Stamp annotation OUTSIDE the plan window", () => {
  const PAGE = { wIn: 11, hIn: 8.5 };
  const L = printSheetLayout({ buildings: { entries: entriesOf(3) } });
  const pu = (L.page.wIn * 72) / L.page.w, pageHpt = L.page.hIn * 72;
  const Mpage = [pu, 0, 0, -pu, 0, pageHpt];
  const pageFrame = [0, 0, PAGE.wIn * 72, pageHpt];
  // the plan window in PDF points
  const planPt = [L.plan.x * pu, pageHpt - (L.plan.y + L.plan.h) * pu, (L.plan.x + L.plan.w) * pu, pageHpt - L.plan.y * pu];
  const built = buildAnnotations(
    [{ family: "sheet-furniture", id: "buildings-table", kind: "buildings-table", tree: bandTree(L.buildings.model, L.buildings.x, L.buildings.y), M0: Mpage, frame: pageFrame, meta: { subject: "Buildings table" } }],
    { M0: [1, 0, 0, -1, 0, 100], frame: planPt, ftPerPt: null },
  );
  const a = built.annots[0];

  it("is written as one Stamp (select / move / delete in Bluebeam), named, with a Subject", () => {
    expect(built.annots).toHaveLength(1);
    expect(built.skipped).toEqual([]); // not dropped as "outside the plan window"
    expect(a.subtype).toBe("Stamp");
    expect(a.nm).toBe("planyr-sheet-furniture-buildings-table");
    expect(annotationDict(a, "9 0 R")).toContain("/Subj (Buildings table)");
  });
  it("sits clear of the plan window (and inside the page)", () => {
    const r = { x: a.rect[0], y: a.rect[1], w: a.rect[2] - a.rect[0], h: a.rect[3] - a.rect[1] };
    const plan = { x: planPt[0], y: planPt[1], w: planPt[2] - planPt[0], h: planPt[3] - planPt[1] };
    expect(overlaps(r, plan)).toBe(false);
    expect(r.x).toBeGreaterThanOrEqual(0); expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(pageFrame[2]); expect(r.y + r.h).toBeLessThanOrEqual(pageFrame[3]);
  });
  it("raises no hover note box: no /Contents, no /T, no /Popup", () => {
    const d = annotationDict(a, "9 0 R");
    expect(d).not.toMatch(/\/Contents /);
    expect(d).not.toMatch(/\/T /);
    expect(d).not.toMatch(/Popup/);
  });
  it("the file carries it: a /Stamp object whose appearance draws every row", () => {
    const pdf = latin1(jpegToPdf({ jpeg: fakeJpeg, pixelW: 100, pixelH: 77, widthIn: 11, heightIn: 8.5, annotations: built.annots }));
    expect(pdf).toMatch(/\/Subtype \/Stamp[^>]*\/NM \(planyr-sheet-furniture-buildings-table\)/);
    for (const s of ["(Building 1) Tj", "(Building 3) Tj", "(Total) Tj", "(BUILDINGS) Tj"]) expect(pdf, s).toContain(s);
    expect((pdf.match(/\/Subtype \/Stamp/g) || []).length).toBe(1);
  });
});

describe("on the owner's real export shape — nothing the site draws is anywhere near the table", () => {
  const FX = JSON.parse(readFileSync(new URL("./fixtures/realisticSiteClone.json", import.meta.url), "utf8"));
  const [o, ux, uy] = FX.f2p;
  const f2p = (p) => ({ x: o.x + p.x * (ux.x - o.x) + p.y * (uy.x - o.x), y: o.y + p.x * (ux.y - o.y) + p.y * (uy.y - o.y) });
  const r = extractMarkupAnnotations(svgToFake(FX.svg), { ...FX.model, f2p });
  const rows = buildingSfRows(FX.model.els).rows;

  it("the building rows come from the building records (buildingSfRows), and the table lists exactly those", () => {
    expect(rows.length).toBeGreaterThan(0);
    const entries = buildingEntries(rows, buildingSfRows(FX.model.els).total);
    expect(entries.slice(0, -1).map((e) => e.name)).toEqual(rows.map((x) => x.name));
    expect(entries[entries.length - 1].name).toBe("Total");
  });
  it("RED-PROOF shape: every lifted site annotation's rect lies inside the plan window, and the table's rect shares no point with it", () => {
    const Lr = printSheetLayout({ buildings: { entries: buildingEntries(rows, buildingSfRows(FX.model.els).total) } });
    const pu = (Lr.page.wIn * 72) / Lr.page.w, pageHpt = Lr.page.hIn * 72;
    const planPt = [Lr.plan.x * pu, pageHpt - (Lr.plan.y + Lr.plan.h) * pu, (Lr.plan.x + Lr.plan.w) * pu, pageHpt - Lr.plan.y * pu];
    const site = buildAnnotations(r.descriptors, { M0: [1, 0, 0, -1, 0, pageHpt], frame: planPt, patterns: r.patterns });
    const table = buildAnnotations(
      [{ family: "sheet-furniture", id: "buildings-table", kind: "buildings-table", tree: bandTree(Lr.buildings.model, Lr.buildings.x, Lr.buildings.y), M0: [pu, 0, 0, -pu, 0, pageHpt], frame: [0, 0, Lr.page.wIn * 72, pageHpt] }],
      { M0: [1, 0, 0, -1, 0, pageHpt], frame: planPt },
    ).annots[0];
    const tb = { x: table.rect[0], y: table.rect[1], w: table.rect[2] - table.rect[0], h: table.rect[3] - table.rect[1] };
    const buildings = site.annots.filter((x) => x.family === "building");
    expect(buildings.length).toBeGreaterThan(0);
    for (const s of site.annots) {
      const sb = { x: s.rect[0], y: s.rect[1], w: s.rect[2] - s.rect[0], h: s.rect[3] - s.rect[1] };
      expect(overlaps(tb, sb), `${s.nm} vs table`).toBe(false);
    }
  });
});

describe("source guards — the callers that size the plan all know about the band", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  const exportSheet = read("../src/workspaces/site-planner/lib/exportSheet.js");
  const planner = read("../src/workspaces/site-planner/SitePlanner.jsx");
  it("the table is no longer drawn into the plan frame as sheet furniture", () => {
    expect(exportSheet).not.toMatch(/buildingRows\s*:/);
    expect(read("../src/workspaces/site-planner/lib/sheetFurniture.js")).not.toMatch(/export function buildingsPlate/);
    expect(read("../src/workspaces/site-planner/lib/sheetFurnitureLayout.js")).not.toMatch(/buildingRows/);
  });
  it("every printSheetLayout that shapes a SHEET passes `buildings` (the PNG's notional box is the one exception)", () => {
    const calls = exportSheet.match(/printSheetLayout\(\{[^}]*\}\)/gs) || [];
    const sheetCalls = calls.filter((c) => !/paper: "letter", orient: "landscape", metricsPairs: printMetricPairs\(\), stormwaterBars: printStormwaterBars\(\)\.length \}/.test(c));
    expect(sheetCalls.length).toBeGreaterThanOrEqual(4);
    for (const c of sheetCalls) expect(c, c).toMatch(/buildings/);
  });
  it("the compose screen's frame aspect and explicit-scale box are computed WITH the band, and recompute when the toggle flips", () => {
    expect(planner).toMatch(/sheetPlanAspect\(\{[^}]*buildings: buildingsBandInput\(els, settings\.printBuildingsTable !== false\)/s);
    expect(planner).toMatch(/sheetLayoutBoxesIn\(\{[^}]*buildings: buildingsBandInput\(els, settings\.printBuildingsTable !== false\)/s);
    expect(planner).toMatch(/settings\.printMetricsBand, settings\.printBuildingsTable\]\);/);
  });
  it("the editable PDF lifts the table AND the scale bar / north arrow into their own annotations, last in the stack", () => {
    expect(exportSheet).toMatch(/family: "sheet-furniture", id: kind/);
    expect(exportSheet).toMatch(/family: "sheet-furniture", id: "buildings-table"/);
    expect(exportSheet).toMatch(/buildingsAsAnnotation: tableAsAnnotation/);
    expect(exportSheet).toMatch(/stays in the page \(it could not be written as its own annotation\)/); // LOUD-FAILURE fallback
  });
});
