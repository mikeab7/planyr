// NEW-A3 — stage-storage-discharge curve: storage from pondGeom, discharge from the outlet,
// paired over the basin's stage range. Pure — no browser.
import { describe, it, expect } from "vitest";
import {
  buildStageStorageDischarge,
  storageAtElev,
  dischargeAtElev,
  elevAtStorage,
  dischargeAtStorage,
} from "../src/workspaces/site-planner/lib/stageStorageDischarge.js";
import { volumeBetween } from "../src/workspaces/site-planner/lib/pondGeom.js";

// 200×200 ft square, slope 3, tobElev 100, depth 10, freeboard 1 → floor 90, design WS 99.
const SQ = [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }];
const DET = { depth: 10, freeboard: 1, slope: 3, tobElev: 100 };
// Floor orifice + emergency weir at design WS.
const OUTLET = { stages: [
  { kind: "orifice", invertElevFt: 90, diameterIn: 12, count: 1, coeff: 0.6 },
  { kind: "weir", crestElevFt: 99, lengthFt: 20, coeff: 3.33 },
] };

describe("buildStageStorageDischarge", () => {
  const b = buildStageStorageDischarge({ ring: SQ, det: DET, outlet: OUTLET, steps: 20 });
  it("builds an anchored curve from floor to top of bank", () => {
    expect(b.ok).toBe(true);
    expect(b.floorElevFt).toBe(90);
    expect(b.tobElevFt).toBe(100);
    expect(b.designWsElevFt).toBe(99);
    expect(b.curve[0].elevFt).toBe(90);
    expect(b.curve[b.curve.length - 1].elevFt).toBe(100);
  });
  it("storage is zero at the floor and matches volumeBetween at the top", () => {
    expect(b.curve[0].storageCf).toBeCloseTo(0, 6);
    const top = b.curve[b.curve.length - 1];
    expect(top.storageCf).toBeCloseTo(volumeBetween(SQ, DET, 90, 100), 0);
  });
  it("storage and discharge are both monotonic non-decreasing with elevation", () => {
    for (let i = 1; i < b.curve.length; i++) {
      expect(b.curve[i].storageCf).toBeGreaterThanOrEqual(b.curve[i - 1].storageCf - 1e-6);
      expect(b.curve[i].dischargeCfs).toBeGreaterThanOrEqual(b.curve[i - 1].dischargeCfs - 1e-6);
    }
  });
  it("discharge jumps once the emergency weir engages above 99", () => {
    const below = dischargeAtElev(b.curve, 98.5);
    const above = dischargeAtElev(b.curve, 99.9);
    expect(above).toBeGreaterThan(below * 2); // the weir dominates
  });
  it("unanchored pond → ok:false with a reason, never a fabricated datum", () => {
    const u = buildStageStorageDischarge({ ring: SQ, det: { depth: 10, freeboard: 1, slope: 3 }, outlet: OUTLET });
    expect(u.ok).toBe(false);
    expect(u.reason).toMatch(/anchored/);
  });
  it("no footprint → ok:false", () => {
    expect(buildStageStorageDischarge({ ring: null, det: DET, outlet: OUTLET }).ok).toBe(false);
  });
});

describe("curve interpolation helpers round-trip", () => {
  const b = buildStageStorageDischarge({ ring: SQ, det: DET, outlet: OUTLET, steps: 40 });
  it("storageAtElev ↔ elevAtStorage are inverse (within interpolation error)", () => {
    const s = storageAtElev(b.curve, 95);
    expect(elevAtStorage(b.curve, s)).toBeCloseTo(95, 1);
  });
  it("dischargeAtStorage(storage@elev) equals dischargeAtElev(elev)", () => {
    const s = storageAtElev(b.curve, 97);
    expect(dischargeAtStorage(b.curve, s)).toBeCloseTo(dischargeAtElev(b.curve, 97), 1);
  });
  it("clamps outside the curve range", () => {
    expect(storageAtElev(b.curve, 80)).toBe(b.curve[0].storageCf);
    expect(storageAtElev(b.curve, 120)).toBe(b.curve[b.curve.length - 1].storageCf);
  });
});
