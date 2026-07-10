import { describe, it, expect } from "vitest";
import {
  COMMODITY_BUCKETS, commodityBucket, commodityBucketRecord, isHazardOutlier,
  pipelineStyleFor, PIPELINE_LEGEND,
} from "../src/workspaces/site-planner/lib/pipelineCommodity.js";

describe("COMMODITY_BUCKETS — the six fixed classes", () => {
  it("carries exactly the six owner-approved buckets, salience-ordered (HVL loudest → unknown)", () => {
    expect(COMMODITY_BUCKETS.map((b) => b.key)).toEqual(["hvl", "gas", "crude", "refined", "co2", "unknown"]);
  });
  it("uses the FINAL owner-approved hex + dash + weight per class", () => {
    const by = Object.fromEntries(COMMODITY_BUCKETS.map((b) => [b.key, b]));
    expect(by.hvl).toMatchObject({ color: "#E24B4A", dash: null, weight: 4 });
    expect(by.gas).toMatchObject({ color: "#EF9F27", dash: null, weight: 3 });
    expect(by.crude).toMatchObject({ color: "#7F77DD", dash: null, weight: 3 });
    expect(by.refined).toMatchObject({ color: "#1D9E75", dash: "10 6", weight: 3 });
    expect(by.co2).toMatchObject({ color: "#378ADD", dash: "9 5 2 5", weight: 2.5 });
    expect(by.unknown).toMatchObject({ color: "#9a9992", dash: "5 5", weight: 2 });
  });
  it("salience (weight) is monotonic non-increasing — never inverts hazard order", () => {
    const w = COMMODITY_BUCKETS.map((b) => b.weight);
    for (let i = 1; i < w.length; i++) expect(w[i]).toBeLessThanOrEqual(w[i - 1]);
  });
});

describe("commodityBucket — keyword crosswalk from COMMODITY_DESCRIPTION", () => {
  it("maps highly volatile liquids", () => {
    for (const s of ["NGL", "NGLS", "NATURAL GAS LIQUIDS", "Y-GRADE", "Y GRADE", "PROPANE", "ETHANE", "BUTANE", "ISOBUTANE", "PROPYLENE", "ETHYLENE", "LPG", "LIQUIFIED PETROLEUM GAS", "HIGHLY VOLATILE LIQUIDS", "HVL"])
      expect(commodityBucket(s)).toBe("hvl");
  });
  it("maps natural gas (but NOT natural gas LIQUIDS, which are HVL)", () => {
    for (const s of ["NATURAL GAS", "GAS", "METHANE", "CASINGHEAD GAS", "SOUR GAS", "SWEET GAS", "FUEL GAS"])
      expect(commodityBucket(s)).toBe("gas");
    expect(commodityBucket("NATURAL GAS LIQUIDS")).toBe("hvl"); // HVL wins over gas
  });
  it("maps crude oil (requires the word CRUDE — a bare OIL is ambiguous)", () => {
    expect(commodityBucket("CRUDE")).toBe("crude");
    expect(commodityBucket("CRUDE OIL")).toBe("crude");
    expect(commodityBucket("CRUDE PETROLEUM")).toBe("crude");
  });
  it("maps refined products, and refined wins over a bare GAS substring (GAS OIL / GASOLINE)", () => {
    for (const s of ["GASOLINE", "DIESEL", "JET FUEL", "JET-A", "KEROSENE", "REFINED PRODUCTS", "TRANSMIX", "NAPHTHA", "AVIATION FUEL", "GAS OIL", "DISTILLATE", "FUEL OIL"])
      expect(commodityBucket(s)).toBe("refined");
  });
  it("maps carbon dioxide", () => {
    for (const s of ["CARBON DIOXIDE", "CO2", "CO2 (SUPERCRITICAL)"]) expect(commodityBucket(s)).toBe("co2");
  });
  it("blank / unmatched → the gray unknown bucket (honest, never a fake class)", () => {
    for (const s of ["", "   ", null, undefined, "MISCELLANEOUS", "SALT WATER", "OTHER"]) expect(commodityBucket(s)).toBe("unknown");
  });
  it("high-hazard OUTLIERS ride the red HVL style (salience tracks hazard — never buried in gray)", () => {
    for (const s of ["HYDROGEN", "ANHYDROUS AMMONIA", "AMMONIA", "HYDROGEN SULFIDE"]) {
      expect(commodityBucket(s)).toBe("hvl");
      expect(isHazardOutlier(s)).toBe(true); // flagged for the live-reconcile report
    }
    // a genuine HVL (propane) is NOT flagged as an outlier
    expect(isHazardOutlier("PROPANE")).toBe(false);
  });
  it("is case-insensitive", () => {
    expect(commodityBucket("crude oil")).toBe("crude");
    expect(commodityBucket("Natural Gas")).toBe("gas");
  });

  // Review-hardening (B751 adversarial pass) — real Texas commodities that must NOT fall to gray.
  it("condensate (light crude-like liquid) → crude, never gray or natural-gas", () => {
    for (const s of ["CONDENSATE", "LEASE CONDENSATE", "GAS CONDENSATE", "NATURAL GAS CONDENSATE", "CRUDE OIL AND CONDENSATE"])
      expect(commodityBucket(s)).toBe("crude");
  });
  it("olefins / diolefins (butadiene, butylene, isobutylene, isoprene, olefins) → HVL, never gray", () => {
    for (const s of ["BUTADIENE", "1,3-BUTADIENE", "BUTYLENE", "BUTYLENES", "ISOBUTYLENE", "ISOPRENE", "OLEFINS"])
      expect(commodityBucket(s)).toBe("hvl");
  });
  it("plural / 'plus' NGL alkane forms → HVL (the RRC uses PENTANES PLUS, BUTANES)", () => {
    for (const s of ["PENTANES", "PENTANES PLUS", "BUTANES", "NORMAL BUTANE", "PROPANES"])
      expect(commodityBucket(s)).toBe("hvl");
  });
  it("natural gasoline (a pentanes-plus NGL) → HVL, not refined", () => {
    expect(commodityBucket("NATURAL GASOLINE")).toBe("hvl");
    expect(commodityBucket("GASOLINE")).toBe("refined"); // plain motor gasoline stays refined
  });
  it("bare 'PRODUCTS' / 'PETROLEUM PRODUCTS' refined-group labels → refined, not gray", () => {
    for (const s of ["PRODUCTS", "PETROLEUM PRODUCTS", "REFINED PRODUCTS"]) expect(commodityBucket(s)).toBe("refined");
    expect(commodityBucket("CRUDE PETROLEUM")).toBe("crude"); // 'PETROLEUM' alone must not become refined
  });
  it("METHANE stays natural gas (the \\b guard survives the olefin additions)", () => {
    expect(commodityBucket("METHANE")).toBe("gas");
  });
});

describe("pipelineStyleFor — Leaflet path style per commodity", () => {
  it("returns the bucket's color/weight/dash as Leaflet keys, folding in opacity, no fill", () => {
    const s = pipelineStyleFor({ COMMODITY_DESCRIPTION: "CRUDE OIL" }, 0.9);
    expect(s).toMatchObject({ color: "#7F77DD", weight: 3, dashArray: null, opacity: 0.9, fill: false });
  });
  it("dashed classes carry their dash-array", () => {
    expect(pipelineStyleFor({ COMMODITY_DESCRIPTION: "REFINED PRODUCTS" }).dashArray).toBe("10 6");
    expect(pipelineStyleFor({ COMMODITY_DESCRIPTION: "CO2" }).dashArray).toBe("9 5 2 5");
  });
  it("honors a custom commodity field name", () => {
    expect(pipelineStyleFor({ COMMODITY: "NATURAL GAS" }, 1, "COMMODITY").color).toBe("#EF9F27");
  });
  it("missing commodity → the unknown style", () => {
    expect(pipelineStyleFor({}).color).toBe("#9a9992");
  });
});

describe("PIPELINE_LEGEND — six-class panel legend", () => {
  it("has one row per bucket, dash flagged as a boolean for the panel chip", () => {
    expect(PIPELINE_LEGEND).toHaveLength(6);
    const refined = PIPELINE_LEGEND.find((l) => /refined/i.test(l.label));
    expect(refined.dash).toBe(true);
    const gas = PIPELINE_LEGEND.find((l) => /natural gas/i.test(l.label));
    expect(gas.dash).toBe(false);
    for (const l of PIPELINE_LEGEND) expect(l.color).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("commodityBucketRecord — safe lookup", () => {
  it("falls back to unknown on a bad key, never throws", () => {
    expect(commodityBucketRecord("nope").key).toBe("unknown");
    expect(commodityBucketRecord("hvl").color).toBe("#E24B4A");
  });
});
