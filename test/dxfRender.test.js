import { describe, it, expect } from "vitest";
import DxfParser from "dxf-parser";
import { renderDxfToSvg, unsupportedSummary } from "../src/workspaces/site-planner/lib/dxf/dxfRender.js";

const L = (...a) => a.join("\n");
const parse = (dxf) => new DxfParser().parseSync(dxf);

// A 100×50 drawing: an L of two LINEs, a block (a 10-unit line) INSERTed at (30,30), a TEXT,
// and a SPLINE (unsupported). $INSUNITS is a parameter so we can flip feet/meters/unitless.
const fixture = (insunits) => L(
  "0", "SECTION", "2", "HEADER",
  "9", "$INSUNITS", "70", String(insunits),
  "0", "ENDSEC",
  "0", "SECTION", "2", "BLOCKS",
  "0", "BLOCK", "2", "BOX", "10", "0.0", "20", "0.0",
  "0", "LINE", "8", "0", "10", "0.0", "20", "0.0", "11", "10.0", "21", "0.0",
  "0", "ENDBLK",
  "0", "ENDSEC",
  "0", "SECTION", "2", "ENTITIES",
  "0", "LINE", "8", "L", "10", "0.0", "20", "0.0", "11", "100.0", "21", "0.0",
  "0", "LINE", "8", "L", "10", "0.0", "20", "0.0", "11", "0.0", "21", "50.0",
  "0", "INSERT", "8", "L", "2", "BOX", "10", "30.0", "20", "30.0",
  "0", "TEXT", "8", "L", "10", "10.0", "20", "40.0", "40", "2.5", "1", "HELLO",
  "0", "SPLINE", "8", "L", "70", "8",
  "0", "ENDSEC", "0", "EOF");

describe("renderDxfToSvg — true-units, INSERT expansion, unsupported tally (B747)", () => {
  it("computes ftPerPx exactly from model extents × $INSUNITS (feet)", () => {
    const r = renderDxfToSvg(parse(fixture(2)));
    expect(r.ok).toBe(true);
    expect(r.unitsKnown).toBe(true);
    expect(r.modelW).toBeCloseTo(100, 6);
    expect(r.modelH).toBeCloseTo(50, 6);
    // longest edge fills the 4500px raster; on-map width = imgW·ftPerPx = real feet
    expect(r.imgW).toBe(4500);
    expect(r.imgH).toBe(2250);
    expect(r.imgW * r.ftPerPx).toBeCloseTo(100, 3); // 100 units × 1 ft/unit
  });

  it("scales metres to feet (30 m ≈ 98.4 ft across)", () => {
    // shrink the drawing to 30×15 by reusing extents via a metres header on the same 100×50 model
    const r = renderDxfToSvg(parse(fixture(6)));
    expect(r.unitsKnown).toBe(true);
    expect(r.imgW * r.ftPerPx).toBeCloseTo(100 * 3.280839895, 2); // 100 m across → ft
  });

  it("flags a unitless drawing (assume feet, but unitsKnown=false)", () => {
    const r = renderDxfToSvg(parse(fixture(0)));
    expect(r.ok).toBe(true);
    expect(r.unitsKnown).toBe(false);
    expect(r.unitsLabel).toBe("unitless");
    expect(r.imgW * r.ftPerPx).toBeCloseTo(100, 3); // assumed feet
  });

  it("expands INSERT block references (the block's geometry lands inside the drawing bounds)", () => {
    const r = renderDxfToSvg(parse(fixture(2)));
    // 4 drawable primitives: 2 top-level LINEs + 1 block LINE (via INSERT) + 1 TEXT
    expect(r.entityCount).toBe(4);
    // the block line at (30,30)-(40,30) sits well inside [0,100]×[0,50], so bounds stay 100×50
    expect(r.modelW).toBeCloseTo(100, 6);
    expect(r.svg).toContain("<path");
    expect(r.svg).toContain("<text");
    expect(r.svg).toContain("HELLO");
  });

  it("counts unsupported entity types, never silently drops them", () => {
    const r = renderDxfToSvg(parse(fixture(2)));
    expect(r.unsupported.count).toBe(1);
    expect(r.unsupported.types).toContain("SPLINE");
    expect(unsupportedSummary(r.unsupported)).toMatch(/1 entity of unsupported types skipped \(1 SPLINE\)/);
  });

  it("reports no-geometry rather than emitting a blank overlay", () => {
    const empty = L("0", "SECTION", "2", "ENTITIES", "0", "SPLINE", "8", "L", "70", "8", "0", "ENDSEC", "0", "EOF");
    const r = renderDxfToSvg(parse(empty));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("no-geometry");
    expect(r.unsupported.count).toBe(1); // the SPLINE is still tallied
  });

  it("strips MTEXT no-arg toggle codes (underline/overline/strike) — words stay legible", () => {
    const withText = (t) => ({ header: { $INSUNITS: 2 }, blocks: {},
      entities: [{ type: "LINE", vertices: [{ x: 0, y: 0 }, { x: 100, y: 50 }] }, { type: "MTEXT", position: { x: 10, y: 10 }, height: 10, text: t }] });
    const textOf = (t) => (renderDxfToSvg(withText(t)).svg.match(/<text[^>]*>([^<]*)<\/text>/) || [])[1];
    expect(textOf("\\LFIRE LANE\\l")).toBe("FIRE LANE");
    expect(textOf("\\ONORTH\\o")).toBe("NORTH");
    expect(textOf("\\KVOID\\k")).toBe("VOID");
    expect(textOf("\\fArial|b1;\\C1;GOOD")).toBe("GOOD"); // arg codes with ';' still stripped
  });

  it("expands a MINSERT rectangular array (columnCount×rowCount), not just one copy", () => {
    const r = renderDxfToSvg({ header: { $INSUNITS: 2 },
      blocks: { B: { position: { x: 0, y: 0 }, entities: [{ type: "CIRCLE", center: { x: 0, y: 0 }, radius: 5 }] } },
      entities: [{ type: "INSERT", name: "B", position: { x: 0, y: 0 }, columnCount: 3, rowCount: 1, columnSpacing: 50, rowSpacing: 0 }] });
    expect(r.ok).toBe(true);
    // 3 circles at x=0,50,100 (radius 5) → bounds -5..105 = 110 wide (a single copy would be 10)
    expect(r.modelW).toBeCloseTo(110, 3);
  });

  it("a purely 1-D drawing still yields a valid non-zero viewBox (no degenerate raster)", () => {
    const horiz = renderDxfToSvg({ header: { $INSUNITS: 2 }, blocks: {},
      entities: [{ type: "LINE", vertices: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }] });
    expect(horiz.ok).toBe(true);
    expect(horiz.imgH).toBeGreaterThan(1);
    expect(horiz.svg).not.toMatch(/viewBox="0 0 \d+(\.\d+)? 0"/); // height must not be 0
    expect(horiz.imgW * horiz.ftPerPx).toBeCloseTo(100, 1); // real width still 100 ft
  });

  it("emits a valid, self-contained SVG (no external refs)", () => {
    const r = renderDxfToSvg(parse(fixture(2)));
    expect(r.svg.startsWith("<svg")).toBe(true);
    expect(r.svg).toContain(`viewBox="0 0 100 50"`);
    expect(r.svg).not.toMatch(/href=|url\(|<image/); // nothing that could taint the canvas
  });
});
