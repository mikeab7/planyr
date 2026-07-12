// B770/V279 wiring — the FBCDD Atlas-14 DRAFT 0.2% WSE sampler + its registry row.
// The service publishes FEET (unlike 3DEP's metres) and an EMPTY value out of coverage;
// the sampler must pass feet through untouched, read empty as an honest null, and THROW
// on HTTP/service errors (LOUD-FAILURE — an outage is never a value or a silent clear).
import { describe, it, expect } from "vitest";
import { sampleWse02Point, FBCDD_WSE02_URL } from "../src/workspaces/site-planner/lib/fbcdWse.js";
import { gisSource } from "../src/shared/gis/sources.js";

const okJson = (body) => ({ ok: true, json: async () => body });

describe("sampleWse02Point — the getSamples point probe", () => {
  it("returns the sampled value in FEET, untouched (live-verified shape: value '72.696846008')", async () => {
    let calledUrl = null;
    const fetchImpl = async (u) => { calledUrl = u; return okJson({ samples: [{ value: "72.696846008", resolution: 12 }] }); };
    const v = await sampleWse02Point(29.55, -95.62, { fetchImpl });
    expect(v).toBeCloseTo(72.696846008, 6); // feet — NO metres conversion (that's 3DEP's quirk)
    expect(calledUrl).toContain(FBCDD_WSE02_URL);
    expect(calledUrl).toContain("getSamples");
    expect(calledUrl).toContain("esriGeometryPoint");
    // the WGS84 point rides the geometry param
    expect(decodeURIComponent(calledUrl)).toContain('"x":-95.62');
  });
  it("out-of-coverage (empty value) → honest null, never a fabricated 0", async () => {
    const fetchImpl = async () => okJson({ samples: [{ value: "", resolution: 12 }] });
    expect(await sampleWse02Point(30.2, -95.0, { fetchImpl })).toBeNull();
    const noSamples = async () => okJson({ samples: [] });
    expect(await sampleWse02Point(30.2, -95.0, { fetchImpl: noSamples })).toBeNull();
  });
  it("HTTP / service errors THROW (an outage reads failed, never a value)", async () => {
    await expect(sampleWse02Point(29.55, -95.62, { fetchImpl: async () => ({ ok: false, status: 503 }) })).rejects.toThrow(/503/);
    await expect(sampleWse02Point(29.55, -95.62, { fetchImpl: async () => okJson({ error: { message: "boom" } }) })).rejects.toThrow(/boom/);
  });
});

describe("the fbcddWse02 registry row (GIS Source Registry)", () => {
  it("is a production RASTER row with in- and out-of-coverage sample fixtures", () => {
    const s = gisSource("fbcddWse02");
    expect(s.kind).toBe("raster");
    expect(s.tier).toBe("production");
    expect(s.serviceUrl).toBe("https://gisportal.fortbendcountytx.gov/image/rest/services/500YR_WSE/ImageServer");
    expect(s.label).toMatch(/DRAFT/); // the draft-study caveat is part of the row's identity
    expect(s.sampleFixtures.some((f) => f.expectValueRange)).toBe(true);
    expect(s.sampleFixtures.some((f) => f.expectNoData)).toBe(true);
    expect(FBCDD_WSE02_URL).toBe(s.serviceUrl); // the sampler reads the registry, no inline URL
  });
});
