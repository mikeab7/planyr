// NEW-B2 — SSURGO Soil Data Access: query builder, response parser, bounded-fetch client. Pure.
import { describe, it, expect } from "vitest";
import { buildSoilQuery, buildSdaRequest, parseSoilResponse, resolveSoils, SDA_PROXY_PATH } from "../src/workspaces/site-planner/lib/soils.js";

describe("buildSoilQuery / buildSdaRequest", () => {
  it("embeds the WGS84 point and reads muaggatt HSG + water table", () => {
    const q = buildSoilQuery(-95.83, 29.78);
    expect(q).toMatch(/point\(-95\.83 29\.78\)/);
    expect(q).toMatch(/hydgrpdcd/);
    expect(q).toMatch(/wtdepannmin/);
    expect(q).toMatch(/muaggatt/);
  });
  it("proxy request uses the same-origin path", () => {
    expect(buildSdaRequest(-95.83, 29.78, { proxy: true }).url).toBe(SDA_PROXY_PATH);
    expect(buildSdaRequest(-95.83, 29.78, { proxy: false }).url).toMatch(/sdmdataaccess/);
    expect(buildSdaRequest(-95.83, 29.78).body.format).toBe("JSON+COLUMNNAME");
  });
});

describe("parseSoilResponse (JSON+COLUMNNAME)", () => {
  const table = {
    Table: [
      ["mukey", "muname", "hydgrpdcd", "wtdepannmin", "wtdepaprjunmin", "drclassdcd"],
      ["111", "Clay loam", "D", "30", "15", "Poorly drained"],   // water table 30cm ≈ 0.98 ft (shallow)
      ["222", "Sandy loam", "B", "152", "120", "Well drained"],  // 152cm ≈ 4.99 ft
    ],
  };
  it("converts cm → ft and picks the shallowest water table + most-restrictive HSG", () => {
    const s = parseSoilResponse(table);
    expect(s.hsg).toBe("D");                       // most restrictive present
    expect(s.waterTableFt).toBeCloseTo(0.98, 1);   // shallowest (30 cm)
    expect(s.units).toHaveLength(2);
  });
  it("out of coverage (header only / empty) → null", () => {
    expect(parseSoilResponse({ Table: [["mukey"]] })).toBeNull();
    expect(parseSoilResponse({})).toBeNull();
    expect(parseSoilResponse(null)).toBeNull();
  });
});

describe("resolveSoils — bounded fetch, honest failure", () => {
  const geom = { lng: -95.83, lat: 29.78 };
  const ok = { Table: [["mukey", "hydgrpdcd", "wtdepannmin"], ["1", "C", "61"]] };
  it("returns soils on success (injected fetch)", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ok });
    const r = await resolveSoils(geom, { fetchImpl });
    expect(r.ok).toBe(true);
    expect(r.soils.hsg).toBe("C");
  });
  it("HTTP error → honest failure, no fabricated soil", async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, json: async () => ({}) });
    const r = await resolveSoils(geom, { fetchImpl });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/403/);
  });
  it("no coverage → honest failure", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => ({ Table: [["mukey"]] }) });
    expect((await resolveSoils(geom, { fetchImpl })).ok).toBe(false);
  });
  it("no point → failure", async () => {
    expect((await resolveSoils({}, {})).ok).toBe(false);
  });
});
