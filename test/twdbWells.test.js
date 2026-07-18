// NEW-B6 — TWDB observation wells interface: field-map parser + pending-endpoint honesty. Pure.
import { describe, it, expect } from "vitest";
import { parseNearestWell, resolveNearestWell, TWDB_WELLS_SOURCE } from "../src/workspaces/site-planner/lib/twdbWells.js";

describe("parseNearestWell — field-map driven, nearest with a reading", () => {
  const feats = [
    { attributes: { StateWellNumber: "AB-01", DepthFromLSD: 12 } },  // farther
    { attributes: { StateWellNumber: "AB-02", WaterLevel: 4 } },     // nearer
    { attributes: { StateWellNumber: "AB-03" } },                    // no reading → ignored
  ];
  // distance by index: AB-02 nearest
  const distMetersOf = (f) => ({ "AB-01": 900, "AB-02": 300, "AB-03": 100 }[f.attributes.StateWellNumber]);
  it("picks the nearest well that HAS a water level", () => {
    const n = parseNearestWell(feats, distMetersOf);
    expect(n.wellId).toBe("AB-02");
    expect(n.depthToWaterFt).toBe(4);
    expect(n.distFt).toBeGreaterThan(0);
  });
  it("no wells with a reading → null", () => {
    expect(parseNearestWell([{ attributes: { StateWellNumber: "X" } }], () => 100)).toBeNull();
    expect(parseNearestWell([], () => 100)).toBeNull();
  });
});

describe("resolveNearestWell — endpoint pending is honest, never fabricated", () => {
  it("with no confirmed serviceUrl → pending failure", async () => {
    expect(TWDB_WELLS_SOURCE.serviceUrl).toBeNull(); // documented as live-verify pending
    const r = await resolveNearestWell({ lng: -95.83, lat: 29.78 }, {});
    expect(r.ok).toBe(false);
    expect(r.pending).toBe(true);
  });
  it("once wired, a good response yields the nearest well (injected fetch)", async () => {
    const source = { ...TWDB_WELLS_SOURCE, serviceUrl: "https://example.test/wells/FeatureServer/0" };
    const fetchImpl = async () => ({ ok: true, json: async () => ({ features: [{ attributes: { StateWellNumber: "AB-02", WaterLevel: 4 }, geometry: {} }] }) });
    const r = await resolveNearestWell({ lng: -95.83, lat: 29.78 }, { source, fetchImpl, distMetersOf: () => 300 });
    expect(r.ok).toBe(true);
    expect(r.well.depthToWaterFt).toBe(4);
  });
});
