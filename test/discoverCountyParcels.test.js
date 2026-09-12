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
  REJECT_TITLE_RE, STALE_YEAR_THRESHOLD, TIER1_COUNTIES, candidateHostnames, discoverCounty,
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

  it("REGRESSION FIXTURE — a title with NO year is still caught by its own editingInfo date (Wayne County MI)", () => {
    // "Parcels - MI - Wayne County", dataLastEditDate 2018 — 8 years stale, no year anywhere in the
    // title, so this candidate was WIRED before this check existed. A title year still wins when
    // both are present (an explicit publisher claim outranks a service's own bookkeeping date).
    expect(rejectCandidate({ title: "Parcels - MI - Wayne County", editDate: "2018-05-08T00:00:00.000Z" }, { now })).toMatch(/stale vintage.*2018/);
    expect(rejectCandidate({ title: "Parcels 2025", editDate: "2018-01-01T00:00:00.000Z" }, { now })).toBeNull();
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

describe("candidateHostnames — item 2's bare-name pattern (B1339921)", () => {
  it("guesses the county's own bare-name host, not only a county-infixed one", () => {
    const hosts = candidateHostnames("Maricopa", "AZ", "Arizona", []);
    expect(hosts).toContain("gis.maricopa.gov");
    // The old county-infixed guesses still fire too — this is additive, never a replacement.
    expect(hosts).toContain("gis.maricopacounty.gov");
  });

  it("dedupes a bare-name guess against an identical harvested hostname", () => {
    const hosts = candidateHostnames("Maricopa", "AZ", "Arizona", ["gis.maricopa.gov"]);
    expect(hosts.filter((h) => h === "gis.maricopa.gov")).toHaveLength(1);
  });
});

describe("discoverCounty — Maricopa resolves via route 3, never the stale route 1/2 candidate (B1339921, item 2)", () => {
  afterEach(() => { vi.unstubAllGlobals(); resetHostHealth(); resetHostThrottle(); });

  it("rejects parcels_maricnty_2019 (stale) and route 3 walks gis.maricopa.gov's IndividualService folder to the real Parcel layer", async () => {
    const REAL_HOST = "https://gis.maricopa.gov/arcgis/rest/services";
    const REAL_SERVICE = `${REAL_HOST}/IndividualService/Parcel/MapServer`;
    const REAL_LAYER = `${REAL_SERVICE}/1`;

    const fetchMock = vi.fn(async (url) => {
      const u = String(url);
      // Route 1 (ArcGIS Hub) — the only candidate it finds is the stale 2019 snapshot.
      if (u.startsWith("https://hub.arcgis.com/api/v3/datasets")) {
        return jsonResponse(200, {
          data: [{ attributes: {
            url: "https://services.arcgis.com/XXXX/arcgis/rest/services/parcels_maricnty_2019/FeatureServer/0",
            name: "parcels_maricnty_2019 parcels", owner: "somebody", source: "Maricopa County", orgId: null,
          } }],
        });
      }
      // Route 2 (AGOL search) — a second, unrelated hit that happens to live on the real host
      // under a DIFFERENT (wrong-guess) path, so it is what a real search would harvest, but it
      // does not itself answer — the actual answer is found by route 3 walking the host's own
      // REST directory from its root, not by trusting this specific guessed path.
      if (u.startsWith("https://www.arcgis.com/sharing/rest/search")) {
        return jsonResponse(200, {
          results: [{
            url: "https://gis.maricopa.gov/arcgis/rest/services/CadastralViewer/MapServer/0",
            title: "Maricopa County Parcel Viewer", owner: "maricopa_gis", orgId: null,
          }],
        });
      }
      if (u.startsWith("https://www.arcgis.com/sharing/rest/portals")) return jsonResponse(200, { name: null });
      // The AGOL item's own guessed layer — unreachable, exactly as a wrong specific-path guess
      // would be; route 3 never depends on this URL being right.
      if (u === "https://gis.maricopa.gov/arcgis/rest/services/CadastralViewer/MapServer/0?f=json") {
        return { ok: false, status: 404, text: async () => "" };
      }
      // Route 3 — the real host. Its ROOT lists no parcel service at all (the dispatch's own
      // finding); the parcel service lives one folder down, in IndividualService.
      if (u === `${REAL_HOST}?f=json`) return jsonResponse(200, { folders: ["IndividualService"], services: [] });
      if (u === `${REAL_HOST}/IndividualService?f=json`) return jsonResponse(200, { folders: [], services: [{ name: "Parcel", type: "MapServer" }] });
      if (u === `${REAL_SERVICE}?f=json`) {
        return jsonResponse(200, { layers: [
          { id: 0, name: "Subdivision", geometryType: "esriGeometryPolygon" },
          { id: 1, name: "Parcel", geometryType: "esriGeometryPolygon" },
        ] });
      }
      // The chosen layer's own acceptance test: metadata + 3 spread-point envelope queries.
      if (u === `${REAL_LAYER}?f=json`) {
        return jsonResponse(200, { fields: [{ name: "APN" }, { name: "PropertyFullStreetAddress" }], geometryType: "esriGeometryPolygon" });
      }
      if (u.startsWith(`${REAL_LAYER}/query?`)) {
        return jsonResponse(200, { features: [{ attributes: { APN: "11221001", PropertyFullStreetAddress: "50 N CENTRAL AVE" } }] });
      }
      // Every other guessed hostname (the ten "county"-infixed patterns that do not exist) — plain
      // not-found, exactly like a real DNS/host miss.
      return { ok: false, status: 404, text: async () => "" };
    });
    vi.stubGlobal("fetch", fetchMock);

    const out = await discoverCounty({ county: "Maricopa", state: "AZ" });

    expect(out.chosen).toBeTruthy();
    expect(out.chosen.url).toBe(REAL_LAYER);
    expect(out.chosen.route).toBe("county-hostname");
    // The stale candidate was seen and REJECTED, never accepted.
    const staleRejection = out.rejected.find((r) => /parcels_maricnty_2019/i.test(r.url || ""));
    expect(staleRejection).toBeTruthy();
    expect(staleRejection.reasons.join(" ")).toMatch(/stale vintage.*2019/);
  }, 15000);
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
