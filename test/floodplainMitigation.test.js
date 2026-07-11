// B707 — the floodplain mitigation engine: NFHL classifier (incl. AO/AH/floodway/
// unstudied-A), grid intersection, WSE capping, honest UNKNOWN states, provider
// precedence, ratio math, expert bypass, straddle worst-case. Pure — no fetch.
import { describe, it, expect } from "vitest";
import {
  classifyNfhlFeature,
  combineMitigation,
  effectivePadElev,
  zonesFromFeatureCollection,
  pointInZone,
  gridIntersect,
  computeMitigation,
  wse1pctForRing,
  ringInTrigger,
  pickWorstCase,
  floodGeoBbox,
  EXPERT_BYPASS_LABEL,
  distToPolyline,
  deriveBfeFromLines,
  bfeLinesFromFeatureCollection,
  crossSectionWselFromFeatureCollection,
  governingCrossSectionWsel,
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
  it("a 0.2% zone under a 1%-only rule is simply not in the ledger", () => {
    // (Harris/Fort Bend now extend to the 0.2% band per B758/B760, so use an explicit
    // 1%-only rule to exercise the "class outside the trigger" path.)
    const oneOnly = { ...harris, trigger: "1pct" };
    const zone = mkZone("02pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: oneOnly,
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
    // harris now ships verified:true (B760), so use an explicitly-unverified rule to
    // exercise the rule_unverified stamp.
    const r = computeMitigation({ footprints: [fp100], zones: [zone], rule: { ...DEFAULT_FLOODPLAIN_RULES.harris, verified: false },
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

describe("effectivePadElev — dock-high industrial pads (B713)", () => {
  it("a dock-stack truck court / trailer strip prices at slab FF − the dock drop", () => {
    expect(effectivePadElev({ truckCourt: { side: "left" } }, { padFfeFt: 100 })).toBe(96); // default 4′
    expect(effectivePadElev({ forCourt: "c1" }, { padFfeFt: 100, dockDropFt: 4 })).toBe(96);
    expect(effectivePadElev({ truckCourt: { side: "top" } }, { padFfeFt: 100, dockDropFt: 3.5 })).toBe(96.5);
  });
  it("ordinary fill prices at the slab FF; an explicit override beats everything", () => {
    expect(effectivePadElev({}, { padFfeFt: 100 })).toBe(100);
    expect(effectivePadElev({ truckCourt: {}, padElevFt: 97.2 }, { padFfeFt: 100 })).toBe(97.2);
  });
  it("no plan FFE → null (UNKNOWN downstream), never a fabricated elevation", () => {
    expect(effectivePadElev({ truckCourt: {} }, {})).toBeNull();
    expect(effectivePadElev({}, { padFfeFt: null })).toBeNull();
  });
  it("integration: slab + dock court in one zone — the court bills 4 ft LESS of fill", () => {
    const zone = mkZone("1pct", [rect(0, 0, 200, 100)], { staticBfeFt: 100 });
    const grade = 90, ffe = 100;
    const slab = { id: "b", ring: rect(0, 0, 100, 100), padElevFt: effectivePadElev({}, { padFfeFt: ffe }) };
    const court = { id: "c", ring: rect(100, 0, 100, 100), padElevFt: effectivePadElev({ truckCourt: {} }, { padFfeFt: ffe }) };
    const r = computeMitigation({ footprints: [slab, court], zones: [zone], rule: harris, elev: { existGradeFt: grade } });
    expect(r.volumeCf).toBeCloseTo(10000 * 10 + 10000 * 6, -2); // 10 ft under the slab, 6 under the court
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
    const oneOnly = { ...harris, trigger: "1pct" }; // harris now extends to 0.2% (B760) — use a 1%-only rule
    expect(ringInTrigger(rect(0, 0, 50, 50), [z02], oneOnly)).toBe(false); // 0.2% isn't a 1%-only rule's trigger
    expect(ringInTrigger(rect(0, 0, 50, 50), [z02], coh)).toBe(true);
    expect(ringInTrigger(rect(0, 0, 50, 50), [zfw], oneOnly)).toBe(true);
    expect(triggerClasses(coh)).toEqual(["1pct", "02pct"]);
  });
  it("floodGeoBbox pads the site envelope and rejects empties", () => {
    const bb = floodGeoBbox([[[-95.6, 29.8], [-95.59, 29.81]]], 0.001);
    expect(bb.w).toBeCloseTo(-95.601, 6);
    expect(bb.n).toBeCloseTo(29.811, 6);
    expect(floodGeoBbox([])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// B755 — derived BFE from FEMA Base Flood Elevation lines (S_BFE)
// ---------------------------------------------------------------------------
describe("distToPolyline — perpendicular point→polyline distance (feet)", () => {
  it("clamps to the nearest segment; a 1-point line → point-to-point (no NaN); empty → Infinity", () => {
    expect(distToPolyline({ x: 0, y: 0 }, [{ x: 3, y: -1 }, { x: 3, y: 1 }])).toBeCloseTo(3, 6);
    expect(distToPolyline({ x: 3, y: 4 }, [{ x: 0, y: 0 }])).toBeCloseTo(5, 6);
    expect(distToPolyline({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
});

describe("deriveBfeFromLines — interpolate a BFE between S_BFE contours (B755)", () => {
  const vline = (x, elevFt) => ({ elevFt, pts: [{ x, y: -1000 }, { x, y: 1000 }] });

  it("midway between two contours → the mean; method two-line-interp; bracket recorded", () => {
    const r = deriveBfeFromLines({ point: { x: 50, y: 0 }, lines: [vline(0, 96), vline(100, 97)] });
    expect(r.bfeFt).toBeCloseTo(96.5, 6);
    expect(r.method).toBe("two-line-interp");
    expect(r.provider).toBe("bfe-line-interp");
    expect(r.detail.loElev).toBe(96);
    expect(r.detail.hiElev).toBe(97);
  });
  it("biases toward the nearer contour", () => {
    const r = deriveBfeFromLines({ point: { x: 30, y: 0 }, lines: [vline(0, 96), vline(100, 97)] });
    expect(r.bfeFt).toBeCloseTo(96.3, 6);
  });
  it("exactly on a contour returns that elevation (distance ≈ 0)", () => {
    const r = deriveBfeFromLines({ point: { x: 0, y: 0 }, lines: [vline(0, 96), vline(100, 97)] });
    expect(r.bfeFt).toBeCloseTo(96, 6);
    expect(r.detail.dNearFt).toBeCloseTo(0, 6);
  });
  it("a single nearby contour snaps to it (method nearest-line)", () => {
    const r = deriveBfeFromLines({ point: { x: 20, y: 0 }, lines: [vline(0, 96)] });
    expect(r.bfeFt).toBe(96);
    expect(r.method).toBe("nearest-line");
  });
  it("skips a duplicate-elevation line on the far bank, interpolating to the next elevation (not stuck)", () => {
    const r = deriveBfeFromLines({ point: { x: 50, y: 0 }, lines: [vline(0, 96), vline(200, 96), vline(100, 97)] });
    expect(r.method).toBe("two-line-interp");
    expect(r.bfeFt).toBeGreaterThan(96);
    expect(r.bfeFt).toBeCloseTo(96.5, 6);
  });
  it("returns null when the nearest line is beyond maxLineDistFt (honest UNKNOWN)", () => {
    expect(deriveBfeFromLines({ point: { x: 0, y: 0 }, lines: [vline(3000, 96)], maxLineDistFt: 2500 })).toBeNull();
  });
  it("falls back to nearest-line when the bracketing pair spans more than maxGapFt", () => {
    const r = deriveBfeFromLines({ point: { x: 0, y: 0 }, lines: [vline(0, 96), vline(7000, 97)], maxGapFt: 6000 });
    expect(r.method).toBe("nearest-line");
    expect(r.bfeFt).toBe(96);
  });
  it("empty / null lines → null", () => {
    expect(deriveBfeFromLines({ point: { x: 0, y: 0 }, lines: [] })).toBeNull();
    expect(deriveBfeFromLines({ point: { x: 0, y: 0 }, lines: null })).toBeNull();
  });
  it("interpolates across a 2-ft gap when the intermediate contour is missing", () => {
    const r = deriveBfeFromLines({ point: { x: 50, y: 0 }, lines: [vline(0, 96), vline(100, 98)] });
    expect(r.bfeFt).toBeCloseTo(97, 6);
  });
  it("is orientation-independent (descending line order gives the same value)", () => {
    const asc = deriveBfeFromLines({ point: { x: 50, y: 0 }, lines: [vline(0, 97), vline(100, 98)] });
    const desc = deriveBfeFromLines({ point: { x: 50, y: 0 }, lines: [vline(100, 98), vline(0, 97)] });
    expect(asc.bfeFt).toBeCloseTo(desc.bfeFt, 6);
    expect(asc.bfeFt).toBeCloseTo(97.5, 6);
  });
  it("the result always lands within the bracket [loElev, hiElev] (invariant)", () => {
    for (const x of [5, 17, 42, 63, 88, 95]) {
      const r = deriveBfeFromLines({ point: { x, y: 0 }, lines: [vline(0, 96), vline(100, 99)] });
      expect(r.bfeFt).toBeGreaterThanOrEqual(96);
      expect(r.bfeFt).toBeLessThanOrEqual(99);
    }
  });
});

describe("bfeLinesFromFeatureCollection — parse S_BFE lines with datum/unit guards (B755)", () => {
  const origin = { lat: 29.77, lon: -95.85 };
  const lineFeat = (props, coords = [[-95.85, 29.77], [-95.849, 29.771]]) => ({
    type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords },
  });
  const fc = (features) => ({ type: "FeatureCollection", features });

  it("keeps a NAVD88 / feet line and converts it to finite site-feet points", () => {
    const out = bfeLinesFromFeatureCollection(fc([lineFeat({ ELEV: 96, V_DATUM: "NAVD88", LEN_UNIT: "Feet" })]), origin);
    expect(out.lines).toHaveLength(1);
    expect(out.lines[0].elevFt).toBe(96);
    expect(out.lines[0].pts.length).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(out.lines[0].pts[0].x)).toBe(true);
    expect(out.total).toBe(1);
  });
  it("excludes the -9999 sentinel entirely (not even a candidate)", () => {
    const out = bfeLinesFromFeatureCollection(fc([lineFeat({ ELEV: -9999, V_DATUM: "NAVD88", LEN_UNIT: "Feet" })]), origin);
    expect(out.lines).toHaveLength(0);
    expect(out.total).toBe(0);
  });
  it("excludes a non-NAVD88 datum and counts it", () => {
    const out = bfeLinesFromFeatureCollection(fc([lineFeat({ ELEV: 96, V_DATUM: "NGVD29", LEN_UNIT: "Feet" })]), origin);
    expect(out.lines).toHaveLength(0);
    expect(out.excludedDatum).toBe(1);
    expect(out.total).toBe(1);
  });
  it("excludes a meters unit and counts it", () => {
    const out = bfeLinesFromFeatureCollection(fc([lineFeat({ ELEV: 30, V_DATUM: "NAVD88", LEN_UNIT: "Meters" })]), origin);
    expect(out.lines).toHaveLength(0);
    expect(out.excludedUnit).toBe(1);
  });
  it("uses only the NAVD88 subset when datums are mixed", () => {
    const out = bfeLinesFromFeatureCollection(fc([
      lineFeat({ ELEV: 96, V_DATUM: "NAVD88", LEN_UNIT: "Feet" }),
      lineFeat({ ELEV: 96, V_DATUM: "NGVD29", LEN_UNIT: "Feet" }),
    ]), origin);
    expect(out.lines).toHaveLength(1);
    expect(out.excludedDatum).toBe(1);
    expect(out.total).toBe(2);
  });
  it("a MultiLineString yields one usable line entry per path", () => {
    const feat = { type: "Feature", properties: { ELEV: 97, V_DATUM: "NAVD88", LEN_UNIT: "Feet" }, geometry: { type: "MultiLineString", coordinates: [[[-95.85, 29.77], [-95.849, 29.771]], [[-95.848, 29.772], [-95.847, 29.773]]] } };
    const out = bfeLinesFromFeatureCollection(fc([feat]), origin);
    expect(out.lines).toHaveLength(2);
    expect(out.lines.every((l) => l.elevFt === 97)).toBe(true);
  });
});

describe("computeMitigation / wse1pctForRing — derived-BFE provider precedence (B755)", () => {
  const fp = { id: "b1", ring: rect(0, 0, 100, 100) };
  it("a derived BFE prices the volume and tags provider bfe-line-interp when nothing else exists", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]); // AE, no static BFE
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, derivedBfeFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 6, -2); // min(96,100) - 90 = 6
    expect(r.providers.wse1pct).toBe("bfe-line-interp");
  });
  it("a manual BFE outranks the derived BFE", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 95, derivedBfeFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 5, -2); // 95 governs
    expect(r.providers.wse1pct).toBe("manual");
  });
  it("a published static BFE outranks the derived BFE", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 94 });
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, derivedBfeFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 4, -2); // 94 governs
    expect(r.providers.wse1pct).toBe("static-bfe");
  });
  it("an AO zone's own grade+DEPTH outranks the derived BFE (never mis-priced off a nearby AE reach)", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { zone: "AO", aoDepthFt: 2 });
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, derivedBfeFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 2, -2); // WSE = 90 + 2, not 96
    expect(r.providers.wse1pct).toBe("ao-depth");
  });
  it("with NO derived and NO other BFE the honest UNKNOWN message is unchanged", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90 } });
    expect(r.volumeCf).toBeNull();
    expect(r.unknownReason).toMatch(/no published BFE/);
  });
  it("wse1pctForRing falls back to the derived BFE (manual still wins) on a touching ring", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const ring = rect(10, 10, 30, 30);
    expect(wse1pctForRing(ring, [zone], { derivedBfeFt: 96 })).toEqual({ wseFt: 96, provider: "bfe-line-interp" });
    expect(wse1pctForRing(ring, [zone], { bfeFt: 95, derivedBfeFt: 96 })).toEqual({ wseFt: 95, provider: "manual" });
  });
});

// ---------------------------------------------------------------------------
// B763 — derived WSE from FEMA S_XS cross-sections (WSEL_REG) + the 0.2% engine seam
// ---------------------------------------------------------------------------
describe("crossSectionWselFromFeatureCollection — parse S_XS WSEL_REG with datum guard (B763)", () => {
  const origin = { lat: 29.77, lon: -95.85 };
  const xsFeat = (props, coords = [[-95.85, 29.77], [-95.849, 29.771]]) => ({
    type: "Feature", properties: props, geometry: { type: "LineString", coordinates: coords },
  });
  const fc = (features) => ({ type: "FeatureCollection", features });

  it("keeps a NAVD88 cross-section, carrying reach identity + station/letter/streambed", () => {
    const out = crossSectionWselFromFeatureCollection(fc([
      xsFeat({ WSEL_REG: 96.4, V_DATUM: "NAVD88", WTR_NM: "Buffalo Bayou", STREAM_STN: 1200, XS_LTR: "K", STRMBED_EL: 80 }),
    ]), origin);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0].wselFt).toBe(96.4);
    expect(out.sections[0].wtrNm).toBe("Buffalo Bayou");
    expect(out.sections[0].streamStn).toBe(1200);
    expect(out.sections[0].xsLtr).toBe("K");
    expect(out.sections[0].strmbedElFt).toBe(80);
    expect(out.sections[0].pts.length).toBeGreaterThanOrEqual(2);
    expect(Number.isFinite(out.sections[0].pts[0].x)).toBe(true);
    expect(out.total).toBe(1);
  });
  it("drops the -9999 WSEL_REG sentinel entirely (not even a candidate)", () => {
    const out = crossSectionWselFromFeatureCollection(fc([xsFeat({ WSEL_REG: -9999, V_DATUM: "NAVD88", WTR_NM: "Creek" })]), origin);
    expect(out.sections).toHaveLength(0);
    expect(out.total).toBe(0);
  });
  it("excludes a non-NAVD88 datum and counts it (never silently mixed)", () => {
    const out = crossSectionWselFromFeatureCollection(fc([xsFeat({ WSEL_REG: 96, V_DATUM: "NGVD29", WTR_NM: "Creek" })]), origin);
    expect(out.sections).toHaveLength(0);
    expect(out.excludedDatum).toBe(1);
    expect(out.total).toBe(1);
  });
  it("uses only the NAVD88 subset when datums are mixed", () => {
    const out = crossSectionWselFromFeatureCollection(fc([
      xsFeat({ WSEL_REG: 96, V_DATUM: "NAVD88", WTR_NM: "Creek" }),
      xsFeat({ WSEL_REG: 96, V_DATUM: "NGVD29", WTR_NM: "Creek" }),
    ]), origin);
    expect(out.sections).toHaveLength(1);
    expect(out.excludedDatum).toBe(1);
    expect(out.total).toBe(2);
  });
  it("streambed sentinel + missing station/letter read as honest null (never fabricated)", () => {
    const out = crossSectionWselFromFeatureCollection(fc([xsFeat({ WSEL_REG: 96, V_DATUM: "NAVD88", WTR_NM: "Creek", STRMBED_EL: -9999 })]), origin);
    expect(out.sections[0].strmbedElFt).toBeNull();
    expect(out.sections[0].streamStn).toBeNull();
    expect(out.sections[0].xsLtr).toBeNull();
  });
  it("a MultiLineString yields one section entry per path, same WSEL/reach", () => {
    const feat = { type: "Feature", properties: { WSEL_REG: 97, V_DATUM: "NAVD88", WTR_NM: "Creek" }, geometry: { type: "MultiLineString", coordinates: [[[-95.85, 29.77], [-95.849, 29.771]], [[-95.848, 29.772], [-95.847, 29.773]]] } };
    const out = crossSectionWselFromFeatureCollection(fc([feat]), origin);
    expect(out.sections).toHaveLength(2);
    expect(out.sections.every((s) => s.wselFt === 97 && s.wtrNm === "Creek")).toBe(true);
  });
  it("null / malformed input → empty result (no throw)", () => {
    expect(crossSectionWselFromFeatureCollection(null, origin)).toEqual({ sections: [], excludedDatum: 0, total: 0 });
    expect(crossSectionWselFromFeatureCollection(fc([]), null)).toEqual({ sections: [], excludedDatum: 0, total: 0 });
  });
});

describe("governingCrossSectionWsel — nearest reach, highest WSEL_REG (B763)", () => {
  // A vertical cross-section polyline at x = `x`, on reach `wtrNm`, carrying WSEL_REG.
  const vsec = (x, wselFt, wtrNm) => ({ wselFt, wtrNm, streamStn: null, xsLtr: null, strmbedElFt: null, pts: [{ x, y: -1000 }, { x, y: 1000 }] });

  it("takes the HIGHEST WSEL_REG among the nearest reach's in-range sections", () => {
    const sections = [vsec(100, 95, "Bayou"), vsec(200, 97, "Bayou"), vsec(400, 99, "Bayou")];
    const r = governingCrossSectionWsel({ point: { x: 0, y: 0 }, sections, maxDistFt: 2500 });
    expect(r.provider).toBe("xs-wsel");
    expect(r.method).toBe("nearest-reach");
    expect(r.wselFt).toBe(99); // highest of the in-range sections on this reach
    expect(r.detail.wtrNm).toBe("Bayou");
    expect(r.detail.dNearFt).toBeCloseTo(100, 6);
    expect(r.detail.usedSections).toBe(3);
  });
  it("returns null when nothing is within maxDistFt (honest UNKNOWN, never zeros)", () => {
    const sections = [vsec(3000, 96, "Bayou")];
    expect(governingCrossSectionWsel({ point: { x: 0, y: 0 }, sections, maxDistFt: 2500 })).toBeNull();
  });
  it("does NOT cross WTR_NM groups: snaps to the nearest reach even when a farther creek is higher", () => {
    const sections = [
      vsec(100, 95, "Nearby Creek"),   // the nearest reach
      vsec(300, 120, "Other Creek"),   // higher WSE but an unrelated, farther reach
    ];
    const r = governingCrossSectionWsel({ point: { x: 0, y: 0 }, sections, maxDistFt: 2500 });
    expect(r.detail.wtrNm).toBe("Nearby Creek");
    expect(r.wselFt).toBe(95);          // never the 120 from the unrelated creek
    expect(r.detail.usedSections).toBe(1);
  });
  it("only in-range sections of the nearest reach count toward the highest WSE + usedSections", () => {
    const sections = [vsec(100, 95, "Bayou"), vsec(3000, 130, "Bayou")]; // the 130 section is out of range
    const r = governingCrossSectionWsel({ point: { x: 0, y: 0 }, sections, maxDistFt: 2500 });
    expect(r.wselFt).toBe(95);
    expect(r.detail.usedSections).toBe(1);
  });
  it("empty / null sections → null", () => {
    expect(governingCrossSectionWsel({ point: { x: 0, y: 0 }, sections: [] })).toBeNull();
    expect(governingCrossSectionWsel({ point: { x: 0, y: 0 }, sections: null })).toBeNull();
  });
});

describe("computeMitigation / wse1pctForRing — S_XS derived 1% WSE precedence (B763)", () => {
  const fp = { id: "b1", ring: rect(0, 0, 100, 100) };
  it("a derived xs-wsel prices the 1% volume when no static/AO/manual exists", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, derivedXsWselFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 6, -2); // min(96,100) - 90 = 6
    expect(r.providers.wse1pct).toBe("xs-wsel");
  });
  it("manual BFE outranks the derived xs-wsel", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, bfeFt: 95, derivedXsWselFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 5, -2); // 95 governs
    expect(r.providers.wse1pct).toBe("manual");
  });
  it("the xs-wsel derived WSE outranks the bfe-line-interp derived BFE", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, derivedXsWselFt: 96, derivedBfeFt: 94 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 6, -2); // 96 (xs-wsel) governs, not 94
    expect(r.providers.wse1pct).toBe("xs-wsel");
  });
  it("a published static BFE still outranks the derived xs-wsel", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 94 });
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: harris, elev: { padElevFt: 100, existGradeFt: 90, derivedXsWselFt: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 4, -2); // 94 governs
    expect(r.providers.wse1pct).toBe("static-bfe");
  });
  it("wse1pctForRing fallback chain: manual > xs-wsel > bfe-line-interp on a touching ring", () => {
    const zone = mkZone("1pct", [rect(0, 0, 100, 100)]);
    const ring = rect(10, 10, 30, 30);
    expect(wse1pctForRing(ring, [zone], { derivedXsWselFt: 96 })).toEqual({ wseFt: 96, provider: "xs-wsel" });
    expect(wse1pctForRing(ring, [zone], { derivedXsWselFt: 96, derivedBfeFt: 94 })).toEqual({ wseFt: 96, provider: "xs-wsel" });
    expect(wse1pctForRing(ring, [zone], { bfeFt: 93, derivedXsWselFt: 96 })).toEqual({ wseFt: 93, provider: "manual" });
  });
});

describe("computeMitigation — the 0.2% derived-WSE engine seam (B763)", () => {
  const fp = { id: "b1", ring: rect(0, 0, 100, 100) };
  it("a 0.2% zone prices from the derived 0.2% WSE and tags xs-wsel-02", () => {
    const zone = mkZone("02pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: coh, elev: { padElevFt: 100, existGradeFt: 90, derivedWse02Ft: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 6, -2);
    expect(r.providers.wse02pct).toBe("xs-wsel-02");
  });
  it("a manual 0.2% WSE outranks the derived 0.2% WSE", () => {
    const zone = mkZone("02pct", [rect(0, 0, 100, 100)]);
    const r = computeMitigation({ footprints: [fp], zones: [zone], rule: coh, elev: { padElevFt: 100, existGradeFt: 90, wse02Ft: 94, derivedWse02Ft: 96 } });
    expect(r.volumeCf).toBeCloseTo(10000 * 4, -2); // 94 governs
    expect(r.providers.wse02pct).toBe("manual");
  });
  it("the 0.2% provider is tracked apart: a priced 0.2% manual never pollutes the 1% wse1pct tag", () => {
    const zones = [
      mkZone("1pct", [rect(0, 0, 100, 100)], { staticBfeFt: 95 }),
      mkZone("02pct", [rect(200, 0, 100, 100)]),
    ];
    const fps = [{ id: "a", ring: rect(0, 0, 100, 100) }, { id: "b", ring: rect(200, 0, 100, 100) }];
    const r = computeMitigation({ footprints: fps, zones, rule: coh, elev: { padElevFt: 100, existGradeFt: 90, wse02Ft: 93 } });
    expect(r.providers.wse1pct).toBe("static-bfe"); // NOT "mixed" — the 0.2% manual stays out of the 1% set
    expect(r.providers.wse02pct).toBe("manual");
  });
});
