// v3 PR-K — the floodway gate was OVER-classified and OVER-strict. The owner checked FEMA and found
// NO mapped regulatory floodway under the Tsakiris pond: it sits in approximate Zone A, where fill IS
// allowed (with compensating storage). PR-K:
//   K1 — "in the floodway" is TRUE only when the footprint intersects a mapped ZONE_SUBTY = "FLOODWAY"
//        polygon. SFHA / Zone A / AE and drainage channels are NOT floodways.
//   K2 — the three-tier 44 CFR 60.3 ladder: (a) floodway → berm allowed WITH a no-rise certification
//        (a REQUIREMENT that keeps the verdict amber, never a hard cap); (b) 1% fringe (AE outside a
//        floodway) → fill allowed with compensating storage; (c) approximate Zone A → same as (b) plus
//        every flood number an ESTIMATE and a BFE study required.
//   K3 — berm fill below the flood level folds into the mitigation requirement at the Standards ratio.
//   K5 — the old absolute copy ("fill is prohibited", "no fill is allowed in the regulatory floodway")
//        is gone from the pond path.
// Pure, fixture-driven (never pins live-project values).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  classifyNfhlFeature, pondFloodplainTier,
} from "../src/workspaces/site-planner/lib/floodplainMitigation.js";
import { assessBuildability, NO_RISE_CERT_DEF } from "../src/workspaces/site-planner/lib/buildableEnvelope.js";
import { sizePondForTargets } from "../src/workspaces/site-planner/lib/pondSizing.js";

const AC = 43560;
const SQ = (s = 200) => [{ x: 0, y: 0 }, { x: s, y: 0 }, { x: s, y: s }, { x: 0, y: s }];
// A zone polygon that fully covers SQ(200), built from real NFHL-style attrs so the classifier runs.
const COVER = [{ x: -50, y: -50 }, { x: 450, y: -50 }, { x: 450, y: 450 }, { x: -50, y: 450 }];
const zoneFrom = (attrs, ring = COVER) => {
  const c = classifyNfhlFeature(attrs);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of ring) { if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x; if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y; }
  return { ...c, rings: [ring], bbox: [minX, minY, maxX, maxY] };
};

describe("K1 — classifyNfhlFeature: only ZONE_SUBTY = FLOODWAY is a floodway", () => {
  it("a mapped regulatory floodway classifies as 'floodway'", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", STATIC_BFE: 95 });
    expect(c.cls).toBe("floodway");
  });
  it("approximate Zone A (no BFE) is the SFHA (1pct) and flagged unstudied — NOT a floodway", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "A" });
    expect(c.cls).toBe("1pct");
    expect(c.unstudiedA).toBe(true);
  });
  it("Zone AE with a published BFE is the 1% fringe (1pct, studied) — NOT a floodway", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "AE", STATIC_BFE: 95 });
    expect(c.cls).toBe("1pct");
    expect(c.unstudiedA).toBe(false);
  });
});

describe("K1/K2 — pondFloodplainTier maps a footprint into the three-tier ladder", () => {
  it("fixture (1): a pond in approximate Zone A → tier 'zoneA', inFloodway FALSE, in the 1%", () => {
    const t = pondFloodplainTier(SQ(200), [zoneFrom({ FLD_ZONE: "A" })]);
    expect(t.tier).toBe("zoneA");
    expect(t.inFloodway).toBe(false);
    expect(t.zoneA).toBe(true);
    expect(t.in1pct).toBe(true);
  });
  it("fixture (2): a pond in a mapped ZONE_SUBTY=FLOODWAY polygon → tier 'floodway', inFloodway TRUE", () => {
    const t = pondFloodplainTier(SQ(200), [zoneFrom({ FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", STATIC_BFE: 95 })]);
    expect(t.tier).toBe("floodway");
    expect(t.inFloodway).toBe(true);
  });
  it("fixture (3): a pond in Zone AE fringe (BFE, no floodway) → tier 'fringe', inFloodway/zoneA FALSE", () => {
    const t = pondFloodplainTier(SQ(200), [zoneFrom({ FLD_ZONE: "AE", STATIC_BFE: 95 })]);
    expect(t.tier).toBe("fringe");
    expect(t.inFloodway).toBe(false);
    expect(t.zoneA).toBe(false);
    expect(t.in1pct).toBe(true);
  });
  it("a floodway that overlaps a fringe wins (a floodway is inside the 1%)", () => {
    const t = pondFloodplainTier(SQ(200), [
      zoneFrom({ FLD_ZONE: "AE", STATIC_BFE: 95 }),
      zoneFrom({ FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", STATIC_BFE: 95 }),
    ]);
    expect(t.tier).toBe("floodway");
    expect(t.inFloodway).toBe(true);
  });
  it("a pond OUTSIDE every zone → tier 'none' (a drainage channel far away never triggers)", () => {
    const far = [{ x: 5000, y: 5000 }, { x: 5200, y: 5000 }, { x: 5200, y: 5200 }, { x: 5000, y: 5200 }];
    expect(pondFloodplainTier(SQ(200), [zoneFrom({ FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY" }, far)]).tier).toBe("none");
    expect(pondFloodplainTier(SQ(200), []).tier).toBe("none");
  });
});

describe("K2(a) — a floodway berm is BUILDABLE but raises a no-rise REQUIREMENT (never a hard cap)", () => {
  it("a floodway berm above grade is buildable, with a no-rise requirement naming the study", () => {
    const r = assessBuildability({ tobElev: 108, gradeFt: 100, inFloodway: true });
    expect(r.buildable).toBe(true);
    expect(r.hard.some((h) => h.code === "floodway-fill")).toBe(false);
    expect(r.requirements.map((q) => q.code)).toContain("floodway-no-rise");
    expect(r.requirements[0].label).toContain(NO_RISE_CERT_DEF);
    expect(r.requirements[0].label).not.toMatch(/prohibited|no fill/i);
  });
  it("K4-shape: a NON-floodway pond whose outlet sits below the receiving water is amber for the OUTFALL, not the floodway", () => {
    // The Tsakiris outcome: Zone A (not a floodway) but the outlet (145.1) is below the receiving
    // water (153.1 EST) → the outfall/tailwater HARD gate binds; the verdict is amber for THAT reason.
    const r = assessBuildability({ tobElev: 150, gradeFt: 148, inFloodway: false, floorElev: 143, outletInvertFt: 145.1, tailwaterFt: 153.1 });
    expect(r.buildable).toBe(false);
    expect(r.hard.map((h) => h.code)).toContain("outfall-tailwater");
    expect(r.requirements.length).toBe(0); // no floodway requirement — it's not a floodway
  });
});

describe("K3 — berm fill below the flood level folds into the mitigation requirement at the Standards ratio", () => {
  const det0 = { depth: 8, freeboard: 1, slope: 3, tobElev: 94 };
  // R1 — coincidentStorm:true: this case is a rim BELOW the flood WSE that must be bermed UP through
  // the flood level (the berm-fill-below-WSE debt). By default the pond recovers to normal tailwater
  // (usable is the whole column, no raise needed); the coincident-storm policy is what forces the raise.
  const base = { ring: SQ(200), det: det0, wseFt: 96, detTargetCf: 2 * AC, mitTargetCf: 0, gradeFt: 93, inTrigger: true, coincidentStorm: true };
  it("an in-trigger (fringe) berm below the WSE adds compensating-storage debt scaled by the ratio", () => {
    const r1 = sizePondForTargets({ ...base, mitRatio: 1 });
    const r2 = sizePondForTargets({ ...base, mitRatio: 2 });
    const t1 = r1.actions.find((a) => a.kind === "raise-tob");
    const t2 = r2.actions.find((a) => a.kind === "raise-tob");
    expect(t1.bermFillBelowWseCf).toBeGreaterThan(0);
    // the mitigation target is exactly the prism × ratio (base mitTarget was 0)
    expect(r1.mitigation.targetCf).toBeCloseTo(t1.bermFillBelowWseCf * 1, 2);
    expect(r2.mitigation.targetCf).toBeCloseTo(t2.bermFillBelowWseCf * 2, 2);
  });
  it("an UPLAND (not in-trigger) berm owes no compensating-storage debt", () => {
    const up = sizePondForTargets({ ...base, inTrigger: false, mitRatio: 1 });
    const t = up.actions.find((a) => a.kind === "raise-tob");
    expect(t.bermFillBelowWseCf).toBeNull();
    expect(up.mitigation.targetCf).toBe(0);
  });
});

describe("K5 — the absolute floodway 'no fill' copy is gone from the pond path", () => {
  const sp = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/SitePlanner.jsx", import.meta.url)), "utf8");
  const copy = readFileSync(fileURLToPath(new URL("../src/workspaces/site-planner/lib/pondInspectorCopy.js", import.meta.url)), "utf8");
  it("SitePlanner no longer carries the removed pond-floodway sentences", () => {
    expect(sp.includes("no fill is allowed in the regulatory floodway")).toBe(false);
    expect(sp.includes("In floodway: no fill")).toBe(false);
    expect(sp.includes("can't be bermed to add detention in the floodway")).toBe(false);
  });
  it("the pond floodway chip names the no-rise cert, never 'prohibited' / 'no fill'", () => {
    // the floodway chip def block only (text + popover), stopping at its `when` gate
    const fwStart = copy.indexOf('id: "floodway"');
    const fwBlock = copy.slice(fwStart, copy.indexOf("when: (f) => !!f.inFloodway,", fwStart));
    expect(fwBlock).toMatch(/no-rise certification/);
    expect(fwBlock).not.toMatch(/prohibited/i);
    expect(fwBlock).not.toMatch(/no fill/i);
  });
});
