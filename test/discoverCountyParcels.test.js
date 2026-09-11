/* B1551616/B1551617 — unit tests for the pure decision logic in
 * ui-audit/discover-county-parcels.mjs (rejection, ranking, vintage, spread-point geometry) and the
 * acceptance test's network-touching half, mocked the same way probeStatewideParcels.test.js already
 * mocks probe-statewide-parcels.mjs's own `fetchJson` — stub the global `fetch`, no DI needed, since
 * `fetchJson` reads the ambient `fetch` rather than taking an injected one (matching house convention
 * for this exact subsystem — see probeStatewideParcels.test.js's own header).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  rejectCandidate, rankScore, vintageOf, spreadProbePoints, acceptCandidate,
  REJECT_TITLE_RE, STALE_YEAR_THRESHOLD, TIER1_COUNTIES,
} from "../ui-audit/discover-county-parcels.mjs";
import { resetHostHealth, resetHostThrottle } from "../ui-audit/lib/hostThrottle.mjs";

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) };
}

describe("rejectCandidate — item 2's hard rejects", () => {
  const now = new Date("2026-09-11");

  it("rejects a test/demo/sandbox/draft/archive/historical title", () => {
    for (const title of ["ATestParcel", "Parcels_DEMO", "Sandbox Parcels", "Draft Parcels 2026", "Archive_Parcels", "Historical Parcels"]) {
      expect(REJECT_TITLE_RE.test(title), title).toBe(true);
      expect(rejectCandidate({ title }, { now }), title).toBeTruthy();
    }
  });

  it("does not reject an ordinary title with none of those words", () => {
    expect(rejectCandidate({ title: "Cook County Parcels 2025" }, { now })).toBeNull();
  });

  it("rejects a commercial vendor publisher", () => {
    expect(rejectCandidate({ title: "USA Nationwide Parcels", owner: "data_regrid", orgName: "Regrid" }, { now })).toMatch(/commercial/);
  });

  it(`rejects a year-stamped title older than the ${STALE_YEAR_THRESHOLD}-year threshold`, () => {
    expect(rejectCandidate({ title: "Tax_Parcels2018" }, { now })).toMatch(/stale vintage.*2018/);
    expect(rejectCandidate({ title: "parcels_maricnty_2007" }, { now })).toMatch(/stale vintage.*2007/);
  });

  it("keeps a recent year-stamped title", () => {
    expect(rejectCandidate({ title: "Wyoming Parcels for 2026" }, { now })).toBeNull();
    expect(rejectCandidate({ title: "Parcels 2021" }, { now })).toBeNull(); // exactly at the threshold, not over it
  });

  it("REGRESSION FIXTURE — the three named ruled-out cases from the dispatch brief", () => {
    expect(rejectCandidate({ title: "Tax_Parcels2018", serviceName: "Tax_Parcels2018" }, { now })).toBeTruthy(); // Fulton GA
    expect(rejectCandidate({ title: "Parcel_Sizes_2018_WFL1" }, { now })).toBeTruthy(); // Greenville SC
    expect(rejectCandidate({ title: "ATestParcel" }, { now })).toBeTruthy(); // Lehigh PA
  });
});

describe("rankScore — item 2's preference ordering", () => {
  const now = new Date("2026-09-11");

  it("prefers the more recent vintage", () => {
    const older = rankScore({ title: "County Parcels 2020" }, { now });
    const newer = rankScore({ title: "County Parcels 2025" }, { now });
    expect(newer).toBeGreaterThan(older);
  });

  it("prefers an organizational publisher over a personal account", () => {
    const org = rankScore({ title: "Parcels", owner: "cook_county_gis", orgName: "Cook County Assessor's Office" }, { now });
    const personal = rankScore({ title: "Parcels", owner: "jsmith_hobby" }, { now });
    expect(org).toBeGreaterThan(personal);
  });

  it("prefers a polygon parcel layer over a derived one (points/summary/roll)", () => {
    const parcel = rankScore({ title: "County Parcels", geometryType: "esriGeometryPolygon" }, { now });
    const derived = rankScore({ title: "County Parcel Address Points", geometryType: "esriGeometryPolygon" }, { now });
    expect(parcel).toBeGreaterThan(derived);
  });
});

describe("vintageOf — recorded so a stale wire is visible, never silent", () => {
  it("reads a year from the title when present", () => {
    expect(vintageOf({ title: "Wyoming Parcels for 2026" })).toEqual({ year: 2026, basis: "name" });
  });
  it("falls back to the service's own editingInfo date", () => {
    expect(vintageOf({ title: "Parcels", editDate: "2024-03-01T00:00:00.000Z" })).toEqual({ year: 2024, basis: "editingInfo" });
  });
  it("is honestly unknown when neither is available", () => {
    expect(vintageOf({ title: "Parcels" })).toEqual({ year: null, basis: "unknown" });
  });
});

describe("spreadProbePoints — three geometry-VERIFIED points, never just the seat", () => {
  // A simple square ring, 0..100 on each axis, scale=1 so lat/lng == the raw units.
  const squareRecord = { bbox: [0, 0, 100, 100], rings: [[[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]]] };

  it("returns up to three points, every one verified inside the ring", () => {
    const pts = spreadProbePoints(squareRecord, 1);
    expect(pts.length).toBeGreaterThan(0);
    expect(pts.length).toBeLessThanOrEqual(3);
    for (const p of pts) {
      expect(p.lng).toBeGreaterThanOrEqual(0);
      expect(p.lng).toBeLessThanOrEqual(100);
      expect(p.lat).toBeGreaterThanOrEqual(0);
      expect(p.lat).toBeLessThanOrEqual(100);
    }
  });

  it("the points are spread, not clustered at one corner", () => {
    const pts = spreadProbePoints(squareRecord, 1);
    expect(pts.length).toBe(3);
    const d01 = Math.hypot(pts[0].lat - pts[1].lat, pts[0].lng - pts[1].lng);
    const d02 = Math.hypot(pts[0].lat - pts[2].lat, pts[0].lng - pts[2].lng);
    // Farthest-point sampling on a 100x100 square should easily clear a modest spread floor.
    expect(d01).toBeGreaterThan(20);
    expect(d02).toBeGreaterThan(20);
  });

  it("an empty/missing record returns no points, never a guess", () => {
    expect(spreadProbePoints(null, 1)).toEqual([]);
  });
});

describe("acceptCandidate — the four-bullet acceptance test, network mocked", () => {
  const SPREAD = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }];
  afterEach(() => { vi.unstubAllGlobals(); resetHostHealth(); resetHostThrottle(); });

  it("rejects on title before ever touching the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "ATestParcel", url: "https://example.test/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/test.*title/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-polygon layer", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "APN" }], geometryType: "esriGeometryPoint" }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "County Parcel Points", url: "https://example.test/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/not a polygon/);
  });

  it("rejects a layer with no ownership-shaped field in its schema (the PLSS/survey-grid class)", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      jsonResponse(200, { fields: [{ name: "OBJECTID" }, { name: "TOWNSHIP" }, { name: "RANGE" }, { name: "SECTION" }], geometryType: "esriGeometryPolygon" })
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "PLSS Cadastral Reference" }, SPREAD);
    // no url at all is also a valid rejection path — use a url this time to exercise the field check
    const r2 = await acceptCandidate({ title: "PLSS Cadastral Reference", url: "https://example.test/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(false);
    expect(r2.accepted).toBe(false);
    expect(r2.reasons[0]).toMatch(/no ownership-shaped field/);
  });

  it("rejects when an ownership-shaped field exists in schema but every sampled feature returns it empty", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "OWNER" }, { name: "APN" }], geometryType: "esriGeometryPolygon" })) // metadata
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: null, APN: "" } }] })) // spread point 1
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: "", APN: null } }] })) // spread point 2
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: null, APN: "" } }] })); // spread point 3
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "County Parcels", url: "https://example.test/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/every sampled feature returned them empty/);
  });

  it("rejects when a spread point returns zero features (the Detroit-city-for-Wayne-county class)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "OWNER" }], geometryType: "esriGeometryPolygon" })) // metadata
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: "Jane Doe" } }] })) // point 1 — downtown, answers
      .mockResolvedValueOnce(jsonResponse(200, { features: [] })); // point 2 — elsewhere in the county, empty
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "City Parcels", url: "https://example.test/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(false);
    expect(r.reasons[0]).toMatch(/zero features/);
  });

  it("accepts a candidate that clears all four bullets", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { fields: [{ name: "OWNER" }, { name: "APN" }], geometryType: "esriGeometryPolygon" }))
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: "Jane Doe", APN: "123" } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: "John Roe", APN: "456" } }] }))
      .mockResolvedValueOnce(jsonResponse(200, { features: [{ attributes: { OWNER: "", APN: "789" } }] }));
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "County Parcels 2025", url: "https://example.test/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(true);
    expect(r.vintage).toEqual({ year: 2025, basis: "name" });
    expect(r.probes).toHaveLength(3);
  });

  it("reports a blocked host distinctly from an unreachable/nonexistent one (item 4's three-way split)", async () => {
    // fetchJson's own `blocked` detection (probe-statewide-parcels.mjs) fires on a bare 403 with a
    // non-JSON body — reused verbatim here, not re-derived.
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 403, text: async () => "blocked by policy" });
    vi.stubGlobal("fetch", fetchMock);
    const r = await acceptCandidate({ title: "County Parcels", url: "https://gis.example-county.us/x/FeatureServer/0" }, SPREAD);
    expect(r.accepted).toBe(false);
    expect(r.blocked).toBe(true);
    expect(r.reasons[0]).toMatch(/blocked by this sandbox/);
  });
});

describe("TIER1_COUNTIES — the roster from the dispatch brief", () => {
  it("names all 22 counties from item 3, each with a county and a state", () => {
    expect(TIER1_COUNTIES.length).toBe(22);
    for (const c of TIER1_COUNTIES) {
      expect(c.county).toBeTruthy();
      expect(c.state).toMatch(/^[A-Z]{2}$/);
    }
  });

  it("carries a `replace` reason for the three named already-wired-wrong candidates", () => {
    const fulton = TIER1_COUNTIES.find((c) => c.county === "Fulton");
    const maricopa = TIER1_COUNTIES.find((c) => c.county === "Maricopa");
    const wayne = TIER1_COUNTIES.find((c) => c.county === "Wayne");
    const lehigh = TIER1_COUNTIES.find((c) => c.county === "Lehigh");
    expect(fulton.replace).toMatch(/2018/);
    expect(maricopa.replace).toMatch(/2007/);
    expect(wayne.replace).toMatch(/CITY/);
    expect(lehigh.replace).toMatch(/test/);
  });
});
