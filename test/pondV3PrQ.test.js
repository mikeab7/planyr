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
    expect(src.includes("`Holds ${f2(r.vol / SQFT_PER_ACRE)} AC-FT")).toBe(false);
  });
  it("the map depth is the rim-to-floor the section shows (det.depth), labeled 'rim to floor'", () => {
    expect(src).toContain("const rimToFloorFt = Number.isFinite(dw.depth) ? dw.depth : null;");
    // NEW-1 — the line is now authored as a REFLOWABLE spec (two atoms joined by a middot on the
    // widest rung) so the shared fit ladder can stack it inside a narrow pond. Same two facts,
    // same wording; it is simply no longer pre-joined into one unbreakable string.
    expect(src).toContain('`Holds ${f1(usableAcFt)} AC-FT usable`, `${f1(rimToFloorFt)}′ rim to floor`');
    expect(src.includes("′ deep${r.feasible")).toBe(false); // the old "X' deep" is gone
  });
  it("the panel keeps a gross figure but LABELS it 'gross' (O3: gross never unlabeled)", () => {
    expect(src).toContain('g_glanceRow("Holds (gross)"');
    expect(src.includes('g_glanceRow("Holds", g_glanceNum')).toBe(false);
  });
});

describe("O4 — every acreage says what it measures (no bare numbers on pond map labels / headers)", () => {
  // ⚠ SUPERSEDED FOR THE MAP LABEL — NEW-1, owner, 2026-08-06. O4 asked every pond acreage to say
  // what it measured, and on the MAP that meant "footprint 6.58 AC · 286,648 SF". The owner has
  // overruled that for the map label alone: "get rid of footprint and get rid of square feet,
  // leave the acreage." The disambiguation moved rather than vanished — the pond's noun sits on
  // the line directly above, and the two assertions below (panel header, parcel badge) are where
  // O4 was actually load-bearing, so they stay. The map label's own guard is
  // test/pondLabelText.test.js; the rendered proof is ui-audit/verify-pond-label-fit.mjs.
  it("the map pond-area line is the bare acreage — no 'footprint', no square feet", () => {
    expect(src).toContain("lines.push(pondAreaLabelLine(area));");
    expect(src).toContain("lines.push(pondAreaLabelLine(exA));");
    expect(src.includes("footprintLabelLine")).toBe(false);
    expect(src.includes("`footprint ${f2(sf / SQFT_PER_ACRE)} AC`")).toBe(false);
  });
  it("the panel header says 'water surface' (not the ambiguous bare 'water area')", () => {
    expect(src).toContain("AC water surface</span>");
    expect(src.includes("ac water area</span>")).toBe(false);
  });
  it("the parcel badge is labeled 'Parcel' so a big parcel acreage can't read as a pond area", () => {
    // The subject is the LABEL ("Parcel"), not which area function feeds it: NEW-2 repointed the
    // badge at `parcelNetSqft` so a promoted deed's save-and-except holes come off the number.
    // B520560: the label is now the parcel's own name — "Parcel 1A 63.46 AC" — which is
    // strictly MORE specific than the bare word, so O4's rule (never a bare acreage) holds
    // a fortiori. The fallback to "Parcel" is what keeps it true when no name resolves.
    expect(src).toContain('const txt = `${(parcelInfo.get(pc.id) || {}).name || "Parcel"} ${f2(parcelNetSqft(pc) / SQFT_PER_ACRE)} AC`;');
    expect(src).toContain('|| "Parcel"');   // an unnamed lot still says what the number measures
  });
});
