import { describe, it, expect } from "vitest";
import {
  pageSize,
  printSheetLayout,
  buildBuildingTableSvg,
  buildPrintSheetSvg,
  formatDateStamp,
  sanitizeFilename,
  sheetFileName,
} from "../src/workspaces/site-planner/lib/printSheet.js";

const PAL = { ink: "#26231e", muted: "#8a8473", panelLine: "#cfc6af", paper: "#fff" };
const ROWS = [
  { name: "Building 1", sf: 250000, clearHeight: 36, slab: 7 },
  { name: "Cross Dock", sf: 620000, clearHeight: 40, slab: 7 },
];

describe("printSheetLayout — metrics band grows with pair count (B712)", () => {
  it("REAL pair widths size the band: wide detention/mitigation pairs get their row", () => {
    const base = [
      ["Site area", "24.79 ac (1,080,000 sf)"], ["Building", "72,000 sf"], ["Lot coverage", "7%"],
      ["FAR (1-story)", "0.07"], ["Car stalls", "0"], ["Trailer stalls", "0"],
      ["Impervious", "7%"], ["Detention", "66,000 sf"], ["Open / green", "21.63 ac"],
    ];
    const wide = [...base,
      ["Det. req / prov (usable)", "12.34 / 8.49 ac-ft ⚠ unanchored pond"],
      ["Floodplain mitigation", "3.21 ac-ft (straddle — a candidate is unknown)"],
      ["Combined basin", "15.55 ac-ft"],
    ];
    const a = printSheetLayout({ metricsPairs: base });
    const b = printSheetLayout({ metricsPairs: wide });
    expect(a.metrics.h).toBe(64); // the historical two-row band
    expect(b.metrics.h).toBeGreaterThan(a.metrics.h); // wide pairs get a real third row
    expect(b.plan.h).toBeLessThan(a.plan.h);
  });
  it("the historical default (9 pairs, letter-landscape) keeps the original 64 c-in band", () => {
    expect(printSheetLayout({}).metrics.h).toBe(64);
    expect(printSheetLayout({ metricsCount: 9 }).metrics.h).toBe(64);
  });
  it("extra detention/mitigation pairs deepen the band instead of clipping the note", () => {
    const base = printSheetLayout({ metricsCount: 9 });
    const more = printSheetLayout({ paper: "letter", orient: "portrait", metricsCount: 12 });
    const basePortrait = printSheetLayout({ paper: "letter", orient: "portrait", metricsCount: 9 });
    expect(more.metrics.h).toBeGreaterThan(basePortrait.metrics.h);
    // the plan area gives up exactly what the band gains
    expect(basePortrait.plan.h - more.plan.h).toBe(more.metrics.h - basePortrait.metrics.h);
    expect(base.metrics.h).toBe(64);
  });
});

describe("printSheetLayout — regions for the single-SVG sheet (B200)", () => {
  it("page sizes match paper/orientation aspect", () => {
    expect(pageSize("letter", "landscape")).toMatchObject({ w: 1100, h: 850 });
    expect(pageSize("letter", "portrait")).toMatchObject({ w: 850, h: 1100 });
    expect(pageSize("tabloid", "landscape")).toMatchObject({ w: 1700, h: 1100 });
  });
  it("reserves a right-hand table column only when buildings exist", () => {
    const withT = printSheetLayout({ buildingCount: 3 });
    const without = printSheetLayout({ buildingCount: 0 });
    expect(withT.table).toBeTruthy();
    expect(without.table).toBe(null);
    // the table column steals width from the plan
    expect(withT.plan.w).toBeLessThan(without.plan.w);
  });
  it("every region sits inside the page bounds", () => {
    const L = printSheetLayout({ paper: "letter", orient: "landscape", buildingCount: 2 });
    for (const box of [L.title, L.plan, L.table, L.metrics]) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(L.page.w + 1e-6);
      expect(box.y + box.h).toBeLessThanOrEqual(L.page.h + 1e-6);
    }
  });
  it("plan and table don't overlap (plan left, table right)", () => {
    const L = printSheetLayout({ buildingCount: 2 });
    expect(L.plan.x + L.plan.w).toBeLessThanOrEqual(L.table.x + 1e-6);
  });
});

describe("buildBuildingTableSvg — one row per building (B197)", () => {
  const box = printSheetLayout({ buildingCount: 2 }).table;
  const svg = buildBuildingTableSvg({ ...box, rows: ROWS, pal: PAL });
  it("titled BUILDINGS with the four column headers", () => {
    expect(svg).toContain(">BUILDINGS<");
    expect(svg).toContain(">BUILDING<");
    expect(svg).toContain(">SF<");
    expect(svg).toContain(">CLEAR<");
    expect(svg).toContain(">SLAB<");
  });
  it("renders each building's name, comma-formatted sf, clear height (ft) and slab (in)", () => {
    expect(svg).toContain(">Building 1<");
    expect(svg).toContain(">Cross Dock<");
    expect(svg).toContain(">250,000<");
    expect(svg).toContain(">620,000<");
    expect(svg).toContain(">36'<");
    expect(svg).toContain(">40'<");
    expect(svg).toContain(">7&quot;<"); // inch mark is XML-escaped in SVG text
  });
  it("handles an empty building set without throwing", () => {
    expect(() => buildBuildingTableSvg({ ...box, rows: [], pal: PAL })).not.toThrow();
  });
});

describe("buildPrintSheetSvg — ONE svg, ONE viewBox, all layers share it (B200)", () => {
  const L = printSheetLayout({ paper: "letter", orient: "landscape", buildingCount: 2 });
  const svg = buildPrintSheetSvg({
    layout: L,
    planSvg: '<svg id="PLAN" viewBox="0 0 10 10"></svg>',
    title: "Cypress Logistics",
    sub: "Plan 1",
    date: "2026.06.19",
    metrics: [["Site area", "42.0 ac"], ["Building", "870,000 sf"]],
    note: "Concept site plan — planning-level estimates, not a survey.",
    buildings: ROWS,
    pal: PAL,
  });
  it("has exactly one root <svg> with one viewBox and a physical inch size (fills one page)", () => {
    expect((svg.match(/<svg /g) || []).length).toBe(2); // sheet root + the nested plan svg
    expect(svg).toMatch(/^<svg [^>]*viewBox="0 0 1100 850"/);
    expect(svg).toContain('width="11in"');
    expect(svg).toContain('height="8.5in"');
  });
  it("embeds the (caller-positioned) plan svg and the title/date/table/metrics in the SAME document", () => {
    expect(svg).toContain('id="PLAN"');
    expect(svg).toContain(">Cypress Logistics<");
    expect(svg).toContain(">2026.06.19<");
    expect(svg).toContain(">BUILDINGS<");
    expect(svg).toContain(">Building 1<");
    expect(svg).toContain("Site area:");
    expect(svg).toContain("not a survey");
    expect(svg.trim().endsWith("</svg>")).toBe(true);
  });
  it("omits the table region when there are no buildings", () => {
    const noB = buildPrintSheetSvg({ layout: printSheetLayout({ buildingCount: 0 }), planSvg: "", buildings: [], pal: PAL });
    expect(noB).not.toContain(">BUILDINGS<");
  });
});

describe("export filename (B201) — date · project · plan name", () => {
  it("formats as YYYY.MM.DD {Project} - {Plan Name}", () => {
    const d = new Date(2026, 5, 19); // June (month index 5) 19, 2026
    expect(formatDateStamp(d)).toBe("2026.06.19");
    expect(sheetFileName({ project: "Cypress Logistics", plan: "Plan 1", date: d })).toBe("2026.06.19 Cypress Logistics - Plan 1");
  });
  it("tracks whatever the plan is renamed to (e.g. a scheme letter)", () => {
    const d = new Date(2026, 5, 19);
    expect(sheetFileName({ project: "Cypress Logistics", plan: "Scheme A", date: d })).toBe("2026.06.19 Cypress Logistics - Scheme A");
  });
  it("keeps the ' - ' separator and date dots; strips illegal characters from project + plan", () => {
    const d = new Date(2026, 0, 3);
    const out = sheetFileName({ project: 'A/B: "North" <lot>', plan: "Scheme: 2", date: d });
    expect(out).toBe("2026.01.03 A B North lot - Scheme 2");
    expect(out).toContain(" - "); // separator survives
  });
  it("zero-pads month and day", () => {
    expect(formatDateStamp(new Date(2026, 8, 7))).toBe("2026.09.07");
  });
  it("falls back to a default project name when blank, and omits the tail when the plan is blank", () => {
    expect(sheetFileName({ project: "   ", plan: "Plan 1", date: new Date(2026, 5, 19) })).toBe("2026.06.19 Site Plan - Plan 1");
    expect(sheetFileName({ project: "Cypress Logistics", plan: "", date: new Date(2026, 5, 19) })).toBe("2026.06.19 Cypress Logistics");
  });
  it("sanitizeFilename keeps spaces, dots and hyphens", () => {
    expect(sanitizeFilename("Cross-Dock 2.0")).toBe("Cross-Dock 2.0");
  });
});
