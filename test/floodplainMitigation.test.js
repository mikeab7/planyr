// B707 — the floodplain mitigation engine: NFHL classifier (incl. AO/AH/floodway/
// unstudied-A), grid intersection, WSE capping, honest UNKNOWN states, provider
// precedence, ratio math, expert bypass, straddle worst-case. Pure — no fetch.
import { describe, it, expect } from "vitest";
import {
  classifyNfhlFeature,
  combineMitigation,
  zonesFromFeatureCollection,
  pointInZone,
  gridIntersect,
  computeMitigation,
  wse1pctForRing,
  ringInTrigger,
  pickWorstCase,
  floodGeoBbox,
  EXPERT_BYPASS_LABEL,
} from "../src/workspaces/site-planner/lib/floodplainMitigation.js";
import { DEFAULT_FLOODPLAIN_RULES, triggerClasses } from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { feetToLatLng } from "../src/workspaces/site-planner/lib/arcgis.js";

const rect = (x, y, w, h) => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const bboxOf = (rings) => {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const r of rings) for (const p of r) {
    if (p.x < a) a = p.x; if (p.x > c) c = p.x;
    if (p.y < b) b = p.y; if (p.y > d) d = p.y;
  }
  return [a, b, c, d];
};
const mkZone = (cls, rings, extra = {}) => ({
  cls, zone: "AE", subtype: "", staticBfeFt: null, aoDepthFt: null, vdatum: null,
  unstudiedA: false, rings, bbox: bboxOf(rings), ...extra,
});
const harris = { ...DEFAULT_FLOODPLAIN_RULES.harris, verified: true };  // 1pct @ 1:1
const coh = { ...DEFAULT_FLOODPLAIN_RULES.coh, verified: true };        // 1pct+02pct @ 1:1

describe("classifyNfhlFeature — zone taxonomy", () => {
  it("AE inside the SFHA → 1pct with its static BFE + datum", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 96.4, V_DATUM: "NAVD88" });
    expect(c.cls).toBe("1pct");
    expect(c.staticBfeFt).toBe(96.4);
    expect(c.vdatum).toBe("NAVD88");
    expect(c.unstudiedA).toBe(false);
  });
  it("the -9999 BFE sentinel reads as NO published BFE, never an elevation", () => {
    expect(classifyNfhlFeature({ FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: -9999 }).staticBfeFt).toBeNull();
  });
  it("Zone AH is treated as AE (a 1% ponding zone with a BFE)", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "AH", SFHA_TF: "T", STATIC_BFE: 101 });
    expect(c.cls).toBe("1pct");
    expect(c.staticBfeFt).toBe(101);
  });
  it("Zone AO carries a sheet-flow DEPTH instead of a BFE", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "AO", SFHA_TF: "T", DEPTH: 2 });
    expect(c.cls).toBe("1pct");
    expect(c.aoDepthFt).toBe(2);
    expect(c.unstudiedA).toBe(false);
  });
  it("Zone AO with the DEPTH sentinel is unstudied", () => {
    expect(classifyNfhlFeature({ FLD_ZONE: "AO", SFHA_TF: "T", DEPTH: -9999 }).unstudiedA).toBe(true);
  });
  it("bare Zone A with no BFE flags unstudied — BFE undetermined", () => {
    const c = classifyNfhlFeature({ FLD_ZONE: "A", SFHA_TF: "T" });
    expect(c.cls).toBe("1pct");
    expect(c.unstudiedA).toBe(true);
  });
  it("the FLOODWAY subtype wins over the zone letter", () => {
    expect(classifyNfhlFeature({ FLD_ZONE: "AE", SFHA_TF: "T", ZONE_SUBTY: "FLOODWAY" }).cls).toBe("floodway");
  });
  it("shaded X (0.2 PCT) → the 0.2% band; unshaded X and D → none", () => {
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" }).cls).toBe("02pct");
    expect(classifyNfhlFeature({ FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }).cls).toBe("none");
    expect(classifyNfhlFeature({ FLD_ZONE: "D" }).cls).toBe("none");
  });
  it("legacy SFHA zones classify without SFHA_TF (isSFHA fallback)", () => {
    expect(classifyNfhlFeature({ FLD_ZONE: "A5" }).cls).toBe("1pct");
  });
});

describe("zonesFromFeatureCollection — lon/lat → site feet", () => {
  const origin = { lat: 29.8, lon: -95.6 };
  const feetRingToLL = (ring) => ring.map((p) => { const [la, ln] = feetToLatLng(p, origin.lat, origin.lon); return [ln, la]; });
  it("round-trips a rectangle through the shared projection within screening tolerance", () => {
    const ringFt = rect(0, 0, 500, 200);
    const fc = { type: "FeatureCollection", features: [
      { type: "Feature", properties: { FLD_ZONE: "AE", SFHA_TF: "T", STATIC_BFE: 95 }, geometry: { type: "Polygon", coordinates: [feetRingToLL(ringFt)] } },
      { type: "Feature", properties: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" }, geometry: { type: "Polygon", coordinates: [feetRingToLL(rect(1000, 1000, 50, 50))] } },
    ] };
    const zones = zonesFromFeatureCollection(fc, origin);
    expect(zones.length).toBe(1); // the all-clear X polygon is dropped
    const { areaSf } = gridIntersect(rect(0, 0, 500, 200), zones[0], null);
    expect(areaSf).toBeGreaterThan(500 * 200 * 0.97);
    expect(areaSf).toBeLessThan(500 * 200 * 1.03);
    expect(zones[0].staticBfeFt).toBe(95);
  });
  it("keeps holes as additional rings (even-odd containment)", () => {
    const outer = rect(0, 0, 200, 200), hole = rect(50, 50, 100, 100);
    const fc = { type: "FeatureCollection", features: [
      { type: "Feature", properties: { FLD_ZONE: "AE", SFHA_TF: "T" }, geometry: { type: "Polygon", coordinates: [feetRingToLL(outer), feetRingToLL(hole)] } },
    ] };
    const z = zonesFromFeatureCollection(fc, origin)[0];
    expect(z.rings.length).toBe(2);
    expect(pointInZone({ x: 25, y: 25 }, z)).toBe(true);   // in the outer, not the hole
    expect(pointInZone({ x: 100, y: 100 }, z)).toBe(false); // island inside the hole
  });
});

describe("gridIntersect — area math", () => {
  it("half-covered footprint reads half the area", () => {
    const fp = rect(0, 0, 100, 100);
    const zone = mkZone("1pct", [rect(0, 0, 50, 100)]);
    const { areaSf } = gridIntersect(fp, zone, null);
    expect(areaSf).toBeCloseTo(5000, -1);
  });
  it("a floodplain island (hole) is never billed", () => {
    const zone = mkZone("1pct", [rect(0, 0, 200, 200), rect(50, 50, 100, 100)]);
    const fp = rect(60, 60, 80, 80); // entirely inside the hole
    expect(gridIntersect(fp, zone, null).areaSf).toBe(0);
  });
  it("disjoint bboxes fast-reject to zero", () => {
    expect(gridIntersect(rect(0, 0, 10, 10), mkZone("1pct", [rect(1000, 1000, 10, 10)]), null).areaSf).toBe(0);
  });
});

describe("computeMitigation — the volume core", () => {
  const fp100 = { id: "b1", label: "Pad", ring: rect(0, 0, 100, 100) };

  it("V = ratio × area × (min(WSE, pad) − grade): pad above the WSE caps at the WSE", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 95 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90 } }); // min(95,100)-90 = 5 ft — not 10
    expect(r.volumeCf).toBeCloseTo(10000 * 5, -2);
    expect(r.perClass["1pct"].acres).toBeCloseTo(10000 / 43560, 3);
    expect(r.unknownReason).toBeNull();
  });
  it("pad below the WSE prices only the fill actually placed (pad − grade)", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 95 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 92, existGradeFt: 90 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 2, -2);
  });
  it("the ratio multiplies the volume", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 95 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: { ...harris, ratio: 1.5 },
      elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 5 * 1.5, -2);
  });

  it("every missing-elevation path reads UNKNOWN — never zero — while acres still render", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 95 });
    const noGrade = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris, elev: { padElevFt: 100 } });
    expect(noGrade.volumeCf).toBeNull();
    expect(noGrade.intersectAcres).toBeGreaterThan(0);
    expect(noGrade.unknownReason).toMatch(/existing-grade/);

    const noPad = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris, elev: { existGradeFt: 90 } });
    expect(noPad.volumeCf).toBeNull();
    expect(noPad.unknownReason).toMatch(/pad/);

    const noBfeZone = mkZone("1pct", [rect(0, 0, 100, 100)]); // AE with no published BFE, no manual entered
    const noWse = computeMitigation({ footprints: [fp100], zones: [noBfeZone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(noWse.volumeCf).toBeNull();
    expect(noWse.unknownReason).toMatch(/BFE/);
  });
  it("COH's 0.2% band without a manual 0.2% WSE is UNKNOWN with the named-source hint", () => {
    const zone = mkZone("02pct", [rect(0, 0, 100, 100)], { zone: "X", subtype: "0.2 PCT ANNUAL CHANCE" });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: coh,
      elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(r.volumeCf).toBeNull();
    expect(r.unknownReason).toMatch(/0\.2%/);
    expect(r.perClass["02pct"].acres).toBeGreaterThan(0);
  });
  it("a 0.2% zone under a 1%-only rule (Harris) is simply not in the ledger", () => {
    const zone = mkZone("02pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(r.volumeCf).toBe(0);
    expect(r.intersectAcres).toBe(0);
  });

  it("provider precedence: a published static BFE beats the manual BFE", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 95 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 99 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 5, -2); // 95 governs, not 99
    expect(r.providers.wse1pct).toBe("static-bfe");
  });
  it("manual BFE is the fallback on a no-BFE AE reach", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 93 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 3, -2);
    expect(r.providers.wse1pct).toBe("manual");
  });
  it("Zone AO prices from existing grade + DEPTH (sheet flow — no BFE exists)", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { zone: "AO", aoDepthFt: 2 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 2, -2); // WSE = 90 + 2
    expect(r.providers.wse1pct).toBe("ao-depth");
  });
  it("an AO zone's own DEPTH beats a manual BFE (sheet flow isn't riverine backwater)", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { zone: "AO", aoDepthFt: 2 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 99 } }); // a nearby AE reach's BFE
    expect(r.volumeCf).toBeCloseTo(10000 * 2, -2); // 90+2 governs, never 99
    expect(r.providers.wse1pct).toBe("ao-depth");
  });

  it("the floodway is a hard flag + acres, never a mitigation price", () => {
    const zone = mkZone("floodway", [rect(0, 0, 50, 100)], { subtype: "FLOODWAY" });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 95 } });
    expect(r.flags).toContain("floodway_intersect");
    expect(r.floodwayAcres).toBeGreaterThan(0);
    expect(r.volumeCf).toBe(0); // no TRIGGER-class fill — prohibited ≠ priced
  });
  it("zero intersect is a real 0, not an UNKNOWN", () => {
    const zone = mkZone("1pct", [rect(5000, 5000, 100, 100)], { staticBfeFt: 95 });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(r.volumeCf).toBe(0);
    expect(r.intersectAcres).toBe(0);
    expect(r.unknownReason).toBeNull();
  });

  it("expert bypass ≡ the grid with a constant depth surface", () => {
    const zone = mkZone("1pct", [rect(0, 0, 60, 100)], { staticBfeFt: 100 });
    const graded = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { padElevFt: 95, existGradeFt: 90 } }); // constant 5 ft everywhere
    const expert = computeMitigation({ footprints: [fp100], zones: [zone], rule: harris,
      elev: { avgFillDepthFt: 5 } });
    expect(expert.expertBypass).toBe(true);
    expect(expert.volumeCf).toBeCloseTo(graded.volumeCf, 6);
    expect(EXPERT_BYPASS_LABEL).toBe("average depth of fill below the flood elevation (ft)");
  });

  it("flags: unverified rule stamps; unstudied A; NGVD29 datum mismatch", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { zone: "A", unstudiedA: true, vdatum: "NGVD29" });
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: DEFAULT_FLOODPLAIN_RULES.harris,
      elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 95 } });
    expect(r.flags).toContain("rule_unverified");
    expect(r.flags).toContain("unstudied_a");
    expect(r.flags).toContain("datum_mismatch");
  });

  it("per-element pad elevation overrides the plan default", () => {
    const zone = mkZone("1pct", [rect(0, 0, 200, 100)], { staticBfeFt: 100 });
    const a = { id: "a", ring: rect(0, 0, 100, 100), padElevFt: 92 };  // 2 ft of fill
    const b = { id: "b", ring: rect(100, 0, 100, 100) };               // plan default 94 → 4 ft
    const r = computeMitigation({ footprints: [a, b], zones: [zone], rule: harris,
      elev: { padElevFt: 94, existGradeFt: 90 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 2 + 10000 * 4, -2);
  });
});

describe("combineMitigation — per-element results merge into one ledger", () => {
  const zone95 = () => mkZone("1pct", [rect(0, 0, 300, 100)], { staticBfeFt: 95 });
  it("sums acres + volumes across footprints exactly like one whole-set compute", () => {
    const a = { id: "a", ring: rect(0, 0, 100, 100) };
    const b = { id: "b", ring: rect(100, 0, 100, 100) };
    const whole = computeMitigation({ footprints: [a, b], zones: [zone95()], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } });
    const combined = combineMitigation([
      computeMitigation({ footprints: [a], zones: [zone95()], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } }),
      computeMitigation({ footprints: [b], zones: [zone95()], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } }),
    ]);
    expect(combined.volumeCf).toBeCloseTo(whole.volumeCf, 4);
    expect(combined.intersectAcres).toBeCloseTo(whole.intersectAcres, 6);
    expect(combined.cutCy).toBeCloseTo(whole.cutCy, 4);
  });
  it("one UNKNOWN part keeps the combined volume UNKNOWN (never a partial sum)", () => {
    const priced = computeMitigation({ footprints: [{ id: "a", ring: rect(0, 0, 100, 100) }], zones: [zone95()], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } });
    const unknown = computeMitigation({ footprints: [{ id: "b", ring: rect(100, 0, 100, 100) }], zones: [mkZone("1pct", [rect(0, 0, 300, 100)])], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } });
    const combined = combineMitigation([priced, unknown]);
    expect(combined.volumeCf).toBeNull();
    expect(combined.unknownReason).toMatch(/BFE/);
    expect(combined.intersectAcres).toBeGreaterThan(priced.intersectAcres);
  });
  it("empty / null inputs → null", () => {
    expect(combineMitigation([])).toBeNull();
    expect(combineMitigation([null])).toBeNull();
  });
});

describe("straddle + pond-side helpers", () => {
  it("pickWorstCase keeps the highest known volume and flags an unknown candidate", () => {
    const results = [
      { jurKey: "harris", result: { volumeCf: 5000, intersectAcres: 1 } },
      { jurKey: "coh", result: { volumeCf: 9000, intersectAcres: 1 } },
      { jurKey: "generic", result: { volumeCf: null, intersectAcres: 1 } },
    ];
    const w = pickWorstCase(results);
    expect(w.jurKey).toBe("coh");
    expect(w.straddle).toBe(true);
    expect(w.anyUnknown).toBe(true);
  });
  it("wse1pctForRing: the governing (highest) static BFE wins; manual only as fallback", () => {
    const zones = [
      mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 94 }),
      mkZone("1pct", [rect(50, 0, 100, 100)], { staticBfeFt: 96 }),
    ];
    expect(wse1pctForRing(rect(0, 0, 150, 100), zones, { bfeFt: 99 })).toEqual({ wseFt: 96, provider: "static-bfe" });
    const noBfe = [mkZone("1pct", [rect(0, 0, 100, 100)])];
    expect(wse1pctForRing(rect(0, 0, 100, 100), noBfe, { bfeFt: 93 })).toEqual({ wseFt: 93, provider: "manual" });
    // a pond in a sheet-flow (AO) zone gets a WSE from grade + DEPTH — no riverine BFE exists there
    const ao = [mkZone("1pct", [rect(0, 0, 100, 100)], { zone: "AO", aoDepthFt: 2 })];
    expect(wse1pctForRing(rect(0, 0, 100, 100), ao, { existGradeFt: 90 })).toEqual({ wseFt: 92, provider: "ao-depth" });
    expect(wse1pctForRing(rect(5000, 0, 10, 10), noBfe, { bfeFt: 93 }).wseFt).toBeNull(); // not touching → no WSE
  });
  it("ringInTrigger respects the rule's trigger classes (floodway always counts)", () => {
    const z02 = mkZone("02pct", [rect(0, 0, 100, 100)]);
    const zfw = mkZone("floodway", [rect(0, 0, 100, 100)]);
    expect(ringInTrigger(rect(0, 0, 50, 50), [z02], harris)).toBe(false); // 0.2% isn't Harris' trigger
    expect(ringInTrigger(rect(0, 0, 50, 50), [z02], coh)).toBe(true);
    expect(ringInTrigger(rect(0, 0, 50, 50), [zfw], harris)).toBe(true);
    expect(triggerClasses(coh)).toEqual(["1pct", "02pct"]);
  });
  it("floodGeoBbox pads the site envelope and rejects empties", () => {
    const bb = floodGeoBbox([[[-95.6, 29.8], [-95.59, 29.81]]], 0.001);
    expect(bb.w).toBeCloseTo(-95.601, 6);
    expect(bb.n).toBeCloseTo(29.811, 6);
    expect(floodGeoBbox([])).toBeNull();
  });
});
