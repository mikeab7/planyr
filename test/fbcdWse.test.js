// B770/V279 wiring — the FBCDD Atlas-14 DRAFT 0.2% WSE sampler + its registry row.
// B807 — the per-watershed 1% (100-yr) multiplex sampler + its registry row.
// The services publish FEET (unlike 3DEP's metres) and an EMPTY value out of coverage;
// the samplers must pass feet through untouched, read empty as an honest null, and THROW
// on HTTP/service errors (LOUD-FAILURE — an outage is never a value or a silent clear).
import { describe, it, expect } from "vitest";
import { sampleWse02Point, sampleWse100Point, wse100CandidatesForPoint, FBCDD_WSE02_URL } from "../src/workspaces/site-planner/lib/fbcdWse.js";
import { gisSource } from "../src/shared/gis/sources.js";
import { projectToGrid } from "../src/shared/coordinates/index.js";

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

// ---------------------------------------------------------------------------
// B807 — the per-watershed 1% (100-yr) multiplex.
// ---------------------------------------------------------------------------

// Synthetic watershed extents built AROUND a real point via the same projection the
// router uses, so the test asserts routing geometry, not projection constants.
const P = { lat: 29.648, lng: -95.6895 }; // the Oyster fixture point
const g = projectToGrid(P.lat, P.lng);
const around = (padFt) => [g.x - padFt, g.y - padFt, g.x + padFt, g.y + padFt];
const SVC_HOME = { name: "Home_Creek/Home_100YR_Existing_WSE", extent2278: around(5000) };
const SVC_NEIGHBOR = { name: "Neighbor_Bayou/Neighbor_100YR_Existing_WSE", extent2278: [g.x + 5500, g.y - 5000, g.x + 20000, g.y + 5000] }; // 5,500 ft east — inside the 1,000 ft seam pad? no: gap 5,500 > 1,000
const SVC_SEAM = { name: "Seam_Ditch/Seam_100YR_Existing_WSE", extent2278: [g.x + 500, g.y - 5000, g.x + 20000, g.y + 5000] }; // starts 500 ft east — within the seam pad
const SVC_FAR = { name: "Far_River/Far_100YR_WSE", extent2278: [g.x + 100000, g.y + 100000, g.x + 200000, g.y + 200000] };

describe("wse100CandidatesForPoint — pure bbox routing (B807)", () => {
  it("routes a point to the watershed whose extent contains it, and pads ~1,000 ft for seams", () => {
    const c = wse100CandidatesForPoint(P.lat, P.lng, [SVC_HOME, SVC_NEIGHBOR, SVC_SEAM, SVC_FAR]);
    expect(c.map((s) => s.name)).toEqual([SVC_HOME.name, SVC_SEAM.name]); // in-extent + seam-pad; not the 5,500 ft neighbor, not the far one
  });
  it("no covering extent → empty (the out-of-county case)", () => {
    expect(wse100CandidatesForPoint(30.2, -95.0, [SVC_HOME, SVC_FAR])).toEqual([]);
  });
});

describe("sampleWse100Point — the multiplexed getSamples probe (B807)", () => {
  const valueFor = (vals) => async (u) => {
    const hit = Object.entries(vals).find(([name]) => u.includes(name));
    if (!hit) throw new Error(`unexpected URL ${u}`);
    const v = hit[1];
    if (v === "HTTP503") return { ok: false, status: 503 };
    return okJson({ samples: [{ value: v, resolution: 12 }] });
  };
  it("returns FEET untouched + the watershed name, and hits the per-watershed URL under restBase", async () => {
    const urls = [];
    const fetchImpl = async (u) => { urls.push(u); return okJson({ samples: [{ value: "96.25", resolution: 12 }] }); };
    const r = await sampleWse100Point(P.lat, P.lng, { fetchImpl, services: [SVC_HOME] });
    expect(r).toEqual({ wseFt: 96.25, watershed: "Home_Creek" });
    expect(urls[0]).toContain(gisSource("fbcddWse100").multiplex.restBase + "/" + SVC_HOME.name + "/ImageServer/getSamples");
  });
  it("overlapping extents: an empty candidate defers to the finite one; two finite → the MAX (governing WSE)", async () => {
    const services = [SVC_HOME, SVC_SEAM];
    const emptyThenValue = valueFor({ Home_Creek: "", Seam_Ditch: "97.5" });
    expect(await sampleWse100Point(P.lat, P.lng, { fetchImpl: emptyThenValue, services })).toEqual({ wseFt: 97.5, watershed: "Seam_Ditch" });
    const bothFinite = valueFor({ Home_Creek: "98.2", Seam_Ditch: "97.5" });
    expect(await sampleWse100Point(P.lat, P.lng, { fetchImpl: bothFinite, services })).toEqual({ wseFt: 98.2, watershed: "Home_Creek" });
  });
  it("all candidates empty → honest null; zero candidates → null with ZERO fetches", async () => {
    const allEmpty = valueFor({ Home_Creek: "", Seam_Ditch: "" });
    expect(await sampleWse100Point(P.lat, P.lng, { fetchImpl: allEmpty, services: [SVC_HOME, SVC_SEAM] })).toBeNull();
    let calls = 0;
    const counting = async () => { calls++; return okJson({ samples: [] }); };
    expect(await sampleWse100Point(30.2, -95.0, { fetchImpl: counting, services: [SVC_HOME] })).toBeNull();
    expect(calls).toBe(0); // out of every extent — never fetched
  });
  it("ANY candidate failure rejects the whole call, even when a sibling answered (LOUD-FAILURE)", async () => {
    const oneDown = valueFor({ Home_Creek: "96.0", Seam_Ditch: "HTTP503" });
    await expect(sampleWse100Point(P.lat, P.lng, { fetchImpl: oneDown, services: [SVC_HOME, SVC_SEAM] })).rejects.toThrow(/503/);
  });
});

describe("the fbcddWse100 registry row — multiplex table shape (B807)", () => {
  it("is a production RASTER row with both fixture kinds and a cross-watershed fixture override", () => {
    const s = gisSource("fbcddWse100");
    expect(s.kind).toBe("raster");
    expect(s.tier).toBe("production");
    expect(s.label).toMatch(/DRAFT/);
    expect(s.sampleFixtures.some((f) => f.expectValueRange)).toBe(true);
    expect(s.sampleFixtures.some((f) => f.expectNoData)).toBe(true);
    // per-fixture serviceUrl overrides stay on the same portal as the routing table
    for (const f of s.sampleFixtures) if (f.serviceUrl) expect(f.serviceUrl.startsWith(s.multiplex.restBase)).toBe(true);
    expect(s.serviceUrl.startsWith(s.multiplex.restBase)).toBe(true);
  });
  it("every routed service is a 100-yr WSE/WSEL product — never LOS / Depth / DxV — with a finite extent", () => {
    const { include, exclude, services } = gisSource("fbcddWse100").multiplex;
    expect(services.length).toBeGreaterThan(0);
    for (const svc of services) {
      const leaf = svc.name.split("/").pop();
      expect(include.test(leaf)).toBe(true);
      expect(exclude.test(leaf)).toBe(false);
      expect(leaf).not.toMatch(/_LOS_|_Depth$|_DxV/i);
      expect(svc.extent2278).toHaveLength(4);
      for (const v of svc.extent2278) expect(Number.isFinite(v)).toBe(true);
      const [xmin, ymin, xmax, ymax] = svc.extent2278;
      expect(xmax).toBeGreaterThan(xmin);
      expect(ymax).toBeGreaterThan(ymin);
    }
  });
});
