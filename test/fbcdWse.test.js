// B770/V279 wiring — the FBCDD Atlas-14 DRAFT 0.2% WSE sampler + its registry row.
// B807 — the per-watershed 1% (100-yr) multiplex sampler + its registry row.
// The services publish FEET (unlike 3DEP's metres) and an EMPTY value out of coverage;
// the samplers must pass feet through untouched, read empty as an honest null, and THROW
// on HTTP/service errors (LOUD-FAILURE — an outage is never a value or a silent clear).
import { describe, it, expect } from "vitest";
import { sampleWse02Point, sampleWse100Point, wse100CandidatesForPoint, wse02CandidatesForPoint, FBCDD_WSE02_URL } from "../src/workspaces/site-planner/lib/fbcdWse.js";
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

// ---------------------------------------------------------------------------
// B827 — the 0.2% mosaic-first + per-watershed 500YR fallback (mosaic holes).
// ---------------------------------------------------------------------------

const BAIN = { lat: 29.769820, lng: -95.850035 }; // live-proven mosaic hole (Willow Fork)
const gB = projectToGrid(BAIN.lat, BAIN.lng);
const around02 = (padFt) => [gB.x - padFt, gB.y - padFt, gB.x + padFt, gB.y + padFt];
const SVC02_HOME = { name: "Home_Creek/Home_500YR_Existing_WSE", extent2278: around02(5000) };
const SVC02_SEAM = { name: "Seam_Ditch/Seam_500YR_WSEL", extent2278: [gB.x + 500, gB.y - 5000, gB.x + 20000, gB.y + 5000] };
const SVC02_FAR = { name: "Far_River/Far_500YR_Existing_WSE", extent2278: [gB.x + 100000, gB.y + 100000, gB.x + 200000, gB.y + 200000] };

describe("wse02CandidatesForPoint — pure bbox routing (B827)", () => {
  it("routes with the same in-extent + seam-pad geometry as the 100YR router", () => {
    const c = wse02CandidatesForPoint(BAIN.lat, BAIN.lng, [SVC02_HOME, SVC02_SEAM, SVC02_FAR]);
    expect(c.map((s2) => s2.name)).toEqual([SVC02_HOME.name, SVC02_SEAM.name]);
  });
  it("the REAL registry table routes the Bain point to the Willow 500YR raster", () => {
    const c = wse02CandidatesForPoint(BAIN.lat, BAIN.lng);
    expect(c.map((s2) => s2.name)).toContain("Willow_Creek/Willow_500YR_Existing_WSE");
  });
});

describe("sampleWse02Point — mosaic-first with the per-watershed fallback (B827)", () => {
  const MOSAIC = FBCDD_WSE02_URL;
  const routed = (mosaicVal, perWatershed) => async (u) => {
    if (u.startsWith(MOSAIC)) {
      if (mosaicVal === "HTTP503") return { ok: false, status: 503 };
      return okJson({ samples: [{ value: mosaicVal, resolution: 12 }] });
    }
    const hit = Object.entries(perWatershed || {}).find(([name]) => u.includes(name));
    if (!hit) throw new Error(`unexpected URL ${u}`);
    if (hit[1] === "HTTP503") return { ok: false, status: 503 };
    return okJson({ samples: [{ value: hit[1], resolution: 12 }] });
  };
  it("a finite mosaic value wins outright — ZERO candidate fetches", async () => {
    const urls = [];
    const fetchImpl = async (u) => { urls.push(u); return okJson({ samples: [{ value: "72.7", resolution: 12 }] }); };
    const v = await sampleWse02Point(BAIN.lat, BAIN.lng, { fetchImpl, services: [SVC02_HOME] });
    expect(v).toBeCloseTo(72.7, 6);
    expect(urls).toHaveLength(1);
    expect(urls[0].startsWith(MOSAIC)).toBe(true);
  });
  it("mosaic EMPTY (the hole) → candidates fetched under restBase, MAX finite returned as a PLAIN NUMBER", async () => {
    const urls = [];
    const inner = routed("", { Home_Creek: "139.514", Seam_Ditch: "138.2" });
    const fetchImpl = async (u) => { urls.push(u); return inner(u); };
    const v = await sampleWse02Point(BAIN.lat, BAIN.lng, { fetchImpl, services: [SVC02_HOME, SVC02_SEAM] });
    expect(v).toBeCloseTo(139.514, 6); // number, not {wseFt} — the SitePlanner caller contract
    const restBase = gisSource("fbcddWse02").multiplex.restBase;
    expect(urls.some((u) => u.startsWith(`${restBase}/${SVC02_HOME.name}/ImageServer`))).toBe(true);
  });
  it("mosaic empty + all candidates empty → honest null; zero covering candidates → null after exactly ONE fetch", async () => {
    expect(await sampleWse02Point(BAIN.lat, BAIN.lng, { fetchImpl: routed("", { Home_Creek: "", Seam_Ditch: "" }), services: [SVC02_HOME, SVC02_SEAM] })).toBeNull();
    let calls = 0;
    const counting = async (u) => { calls++; return routed("", {})(u); };
    expect(await sampleWse02Point(BAIN.lat, BAIN.lng, { fetchImpl: counting, services: [SVC02_FAR] })).toBeNull();
    expect(calls).toBe(1); // the mosaic — never a fallback fetch with no covering extent
  });
  it("a mosaic ERROR throws — never silently masked by a narrower per-watershed answer", async () => {
    await expect(sampleWse02Point(BAIN.lat, BAIN.lng, { fetchImpl: routed("HTTP503", { Home_Creek: "139.5" }), services: [SVC02_HOME] })).rejects.toThrow(/503/);
  });
  it("mosaic empty + ANY candidate failure rejects the whole call, even when a sibling answered (LOUD-FAILURE)", async () => {
    await expect(sampleWse02Point(BAIN.lat, BAIN.lng, { fetchImpl: routed("", { Home_Creek: "139.5", Seam_Ditch: "HTTP503" }), services: [SVC02_HOME, SVC02_SEAM] })).rejects.toThrow(/503/);
  });
});

describe("the fbcddWse02 registry row — provisional multiplex table (B827)", () => {
  const s2 = gisSource("fbcddWse02");
  it("is provisional (knowingly-incomplete seed — the live directory is sandbox-blocked)", () => {
    expect(s2.multiplex.provisional).toBe(true);
    expect(s2.multiplex.restBase).toBe(gisSource("fbcddWse100").multiplex.restBase);
  });
  it("the Willow seed passes include, fails exclude, and reuses the 100YR twin's extent", () => {
    const { include, exclude, services } = s2.multiplex;
    expect(services.length).toBeGreaterThan(0);
    for (const svc of services) {
      const leaf = svc.name.split("/").pop();
      expect(include.test(leaf)).toBe(true);
      expect(exclude.test(leaf)).toBe(false);
      expect(leaf).not.toMatch(/_LOS_|_Depth$|_DxV|100YR/i);
      expect(svc.extent2278).toHaveLength(4);
      for (const v of svc.extent2278) expect(Number.isFinite(v)).toBe(true);
    }
    const willow100 = gisSource("fbcddWse100").multiplex.services.find((x) => x.name === "Willow_Creek/Willow_100YR_Existing_WSE");
    const willow500 = services.find((x) => x.name === "Willow_Creek/Willow_500YR_Existing_WSE");
    expect(willow500.extent2278).toEqual(willow100.extent2278);
  });
  it("carries the Bain hole fixtures: in-coverage via the Willow serviceUrl + the mosaic expectNoData pin", () => {
    const inCov = s2.sampleFixtures.find((f) => f.serviceUrl && /Willow_500YR/.test(f.serviceUrl));
    expect(inCov).toBeTruthy();
    expect(inCov.serviceUrl.startsWith(s2.multiplex.restBase)).toBe(true);
    expect(inCov.expectValueRange[0]).toBeLessThan(139.514);
    expect(inCov.expectValueRange[1]).toBeGreaterThan(139.514);
    const holePin = s2.sampleFixtures.find((f) => f.expectNoData && !f.serviceUrl && f.point[0] === inCov.point[0] && f.point[1] === inCov.point[1]);
    expect(holePin).toBeTruthy();
  });
});
