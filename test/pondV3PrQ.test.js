// v3 PR-Q (O3 + O4) — the map and the panel must agree, and every acreage must say what it measures.
//   O3: the map pond label "Holds" reports the SAME USABLE/achievable storage the panel + verdict
//       report (pondSplitFor.usableCf), not the gross geometric tub volume; depth is the rim-to-floor
//       the SECTION shows (det.depth). One source of truth. Any gross figure kept is labeled "gross".
//   O4: no bare acreage on pond map labels / panel headers — footprint, water surface, and the parcel
//       badge each say what they measure.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");

describe("O3 — map storage/depth == panel/section, from one source of truth", () => {
  it("the map 'Holds' uses the pond's USABLE storage (pondSplit.usableCf), NOT the gross tub volume", () => {
    expect(src).toContain("const usableAcFt = Number.isFinite(pondSplit.usableCf) ? pondSplit.usableCf / 43560 : null;");
    // the old gross-volume map label is gone
    expect(src.includes("`Holds ${f2(r.vol / SQFT_PER_ACRE)} ac-ft")).toBe(false);
  });
  it("the map depth is the rim-to-floor the section shows (det.depth), labeled 'rim to floor'", () => {
    expect(src).toContain("const rimToFloorFt = Number.isFinite(dw.depth) ? dw.depth : null;");
    expect(src).toContain("ac-ft usable · ${f1(rimToFloorFt)}′ rim to floor`");
    expect(src.includes("′ deep${r.feasible")).toBe(false); // the old "X' deep" is gone
  });
  it("the panel keeps a gross figure but LABELS it 'gross' (O3: gross never unlabeled)", () => {
    expect(src).toContain('g_glanceRow("Holds (gross)"');
    expect(src.includes('g_glanceRow("Holds", g_glanceNum')).toBe(false);
  });
});

describe("O4 — every acreage says what it measures (no bare numbers on pond map labels / headers)", () => {
  it("the map pond-area line is labeled 'footprint'", () => {
    expect(src).toContain("lines.push(`footprint ${f2(area / SQFT_PER_ACRE)} ac · ${f0(area)} sf`);");
    expect(src).toContain("lines.push(`footprint ${f2(exA / SQFT_PER_ACRE)} ac · ${f0(exA)} sf`);");
  });
  it("the panel header says 'water surface' (not the ambiguous bare 'water area')", () => {
    expect(src).toContain("ac water surface</span>");
    expect(src.includes("ac water area</span>")).toBe(false);
  });
  it("the parcel badge is labeled 'Parcel' so a big parcel acreage can't read as a pond area", () => {
    expect(src).toContain("const txt = `Parcel ${f2(polyArea(pc.points) / SQFT_PER_ACRE)} ac`;");
  });
});
