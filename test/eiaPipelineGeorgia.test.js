/* NEW-1 (follow-up to B1994512 / PR 1902) — the FL/GA pipeline screen on the owner's real "Georgia" project.
 *
 * REPORT: the screen read "Not confirmed — no major transmission line within 1 mi" on a Georgia site that a
 * Southern Natural Gas line (EIA FID 23971) was said to cross.
 * FINDING (measured 2026-10-05, never a null on the instrument — the stored geometry was read from the database):
 *   · the plan's STORED parcels (`sites` smun2bc1cvzu "Concept A", four parcels, origin 34.3876 / -84.9096,
 *     Adairsville, Bartow Co.; parcel rows last written 2026-09-29) span lat 34.378–34.397, lng -84.919…-84.900.
 *     FID 23971 is a straight two-vertex segment (-85.0310,34.3556)→(-84.9843,34.5034); at the site's latitude it
 *     runs at lng ≈ -85.021, ~6 mi WEST of the parcels. Live service, parcel bbox + N mi: 0 mi → 0, 1 → 0, 3 → 0,
 *     5 → 1. So "nothing within 1 mi" was the CORRECT answer for the stored geometry.
 *   · the envelope quoted in the report (lat 34.409–34.451, lng -85.020…-84.979) is a DIFFERENT piece of ground —
 *     ~0.07–0.1° of longitude away from the stored one. For THAT geometry the line does cross.
 * So there is no false miss in the screen: it is asked to answer both geometries here, with a service double that
 * HONOURS GEOMETRY, and gives the right answer for each.
 *
 * WHY THE FLORIDA CASE PASSED AND THIS ONE COULD NOT HAVE FAILED (the part of the report worth keeping): every
 * earlier test here fed the screen a fetch double that returns N hits REGARDLESS of the geometry it is sent, and
 * the harness's Florida arm puts the parcel ON the line. Neither can tell "the line is near the site" from "the
 * line is anywhere". A screen that dropped every ring but the first, or sent the wrong polygon, passes both. The
 * double below answers only with lines within the requested buffer of the rings it was actually sent, and a
 * KNOWN-GOOD arm proves it can say yes.
 *
 * Live version of the same two cases against the real EIA service:  PLANYR_LIVE_EIA=1 npx vitest run test/eiaPipelineGeorgia.test.js
 */
import { describe, it, expect, vi } from "vitest";
import { execFileSync } from "node:child_process";

vi.mock("esri-leaflet", () => ({ dynamicMapLayer: vi.fn(), imageMapLayer: vi.fn(), featureLayer: vi.fn(), tiledMapLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/evidenceLayers.js", () => ({ overpassLayer: vi.fn(), mapillaryLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/terrainLayers.js", () => ({ contourLayer: vi.fn(), flowLayer: vi.fn() }));
vi.mock("../src/workspaces/site-planner/lib/vectorOverlay.js", () => ({
  cachedVectorLayer: vi.fn(() => null), cachedPipelineLayer: vi.fn(() => null), cachedCorridorLayer: vi.fn(() => null), isPointFeature: vi.fn(),
}));
vi.mock("../src/workspaces/site-planner/lib/mapSymbols.js", () => ({ installDefaultMarkerIcon: vi.fn(), pointToLayerFor: vi.fn() }));

import { runSiteAnalysis } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { feetToLatLng } from "../src/workspaces/site-planner/lib/arcgis.js";
import { distPathToRingsFt, ringToGridFt } from "../src/workspaces/site-planner/lib/proximityScreen.js";
import { GIS_SOURCES } from "../src/shared/gis/sources.js";

/* EIA FID 23971 — Southern Natural Gas Co, Interstate, Operating (read from the live service 2026-10-05). */
const FID_23971 = { attributes: { FID: 23971, TYPEPIPE: "Interstate", Operator: "Southern Natural Gas Co", Status: "Operating" },
  geometry: { paths: [[[-85.0309799999999, 34.35562], [-84.9842599999999, 34.5033500000001]]] } };

/* The stored Georgia parcels, one bounding rectangle each, in the plan's feet frame (from `site_elements`). */
const ORIGIN = { lat: 34.38764946718336, lon: -84.90962531951573 };
const GEORGIA_PARCEL_BBOX_FT = [
  [-281.28, -1385.68, 2795.16, 478.27], [2534.3, -1224.35, 2796.67, -1009.62],
  [-2704.49, -1399.9, 1157.46, 3435.18], [-2796.67, -3435.57, -270.43, -837.79],
];
const rect = ([x0, y0, x1, y1]) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const toRing = (pts) => { const r = pts.map((p) => { const [lat, lng] = feetToLatLng(p, ORIGIN.lat, ORIGIN.lon); return [lng, lat]; }); return r; };
const STORED_RINGS = GEORGIA_PARCEL_BBOX_FT.map((b) => toRing(rect(b)));
/* The envelope quoted in the report, as one ring. */
const QUOTED_RINGS = [[[-85.020, 34.409], [-84.979, 34.409], [-84.979, 34.451], [-85.020, 34.451], [-85.020, 34.409]]];
const FLORIDA_ON_FGT = [[[-82.4075, 29.3566], [-82.4021, 29.3566], [-82.4021, 29.3621], [-82.4075, 29.3621], [-82.4075, 29.3566]]];
const FGT_FEATURE = { attributes: { Operator: "Florida Gas Transmission Co", TYPEPIPE: "Interstate", Status: "Operating" },
  geometry: { paths: [[[-82.42, 29.34], [-82.39, 29.38]]] } };

const params = (url, o) => { const q = new URL(url).searchParams; const b = (o && o.body) || {}; return (k) => (b[k] != null ? String(b[k]) : q.get(k)); };

/* A service double that answers like ArcGIS does: lines within `distance` feet of the polygon it was SENT. */
function geometryHonouringService(lines) {
  const calls = [];
  const fetchJson = async (url, o) => {
    const get = params(url, o);
    calls.push(url);
    const isEia = /FiaPA4ga0iQKduv3/.test(url) && /Natural_Gas/.test(url);
    const sent = JSON.parse(get("geometry")).rings;
    const buf = Number(get("distance") || 0);
    const ringsFt = sent.map(ringToGridFt);
    const hit = isEia ? lines.filter((l) => distPathToRingsFt(l.geometry.paths[0].map(([x, y]) => ringToGridFt([[x, y]])[0]), ringsFt) <= buf) : [];
    return get("returnCountOnly") === "true" ? { count: hit.length } : { features: hit };
  };
  return { fetchJson, calls };
}
const freshCache = () => { const m = new Map(); return { swr(k, f) { if (!m.has(k)) m.set(k, f().then((data) => ({ data, error: null, ts: 1, ageMs: 0 }), (error) => ({ data: null, error, ts: null, ageMs: null }))); return { fresh: m.get(k) }; } }; };
const run = async (rings, lines) => {
  const svc = geometryHonouringService(lines);
  const r = await runSiteAnalysis(rings, { cache: freshCache(), fetchJson: svc.fetchJson,
    identifyJurisdiction: async () => ({ county: [], city: [], etj: [], unincorporated: true, ages: {}, sources: [] }), identifyRoadAuthority: async () => ({ roads: [] }) });
  return { r, p: r.findings.find((f) => f.id === "pipelines"), svc };
};

describe("FL/GA pipeline screen — the Georgia project, both geometries (service double honours geometry)", () => {
  it("KNOWN-GOOD ARM: a Florida parcel on an FGT line reads Present (the double CAN say yes)", async () => {
    const { p } = await run(FLORIDA_ON_FGT, [FGT_FEATURE]);
    expect(p.status).toBe("present");
  });

  it("the report's quoted envelope (FID 23971 crosses it) reads Present · Approximate", async () => {
    const { p } = await run(QUOTED_RINGS, [FID_23971]);
    expect(p.status).toBe("present");
    expect(p.summary).toMatch(/^Approximate/);
    expect(p.detail.join(" ")).toMatch(/Southern Natural Gas/);
  });

  it("the plan's STORED Georgia parcels sit ~6 mi from the line → 'Not confirmed', which is the correct answer", async () => {
    const { p, r } = await run(STORED_RINGS, [FID_23971]);
    expect(r.site.state).toBe("GA");
    expect(p.status).toBe("unconfirmed");
    expect(p.summary).toMatch(/Not confirmed/);
    // …and the geometry really is out of the buffer: the line is further than the 1-mi screen in the grid frame.
    const ringsFt = STORED_RINGS.map(ringToGridFt);
    const d = distPathToRingsFt(FID_23971.geometry.paths[0].map(([x, y]) => ringToGridFt([[x, y]])[0]), ringsFt);
    expect(d).toBeGreaterThan(5280 * 3);
  });

  it("every one of the four parcels is SENT to the service (not just the first / largest)", async () => {
    const { svc } = await run(STORED_RINGS, [FID_23971]);
    const eia = svc.calls.filter((u) => /Natural_Gas/.test(u));
    expect(eia.length).toBeGreaterThan(0);
    for (const u of eia) expect(JSON.parse(new URL(u).searchParams.get("geometry")).rings).toHaveLength(4);
  });

  it("a layer that cannot answer never turns a miss into 'clear': unavailable, not unconfirmed-by-silence", async () => {
    const r = await runSiteAnalysis(STORED_RINGS, { cache: freshCache(), fetchJson: async () => { throw new Error("HTTP 503"); },
      identifyJurisdiction: async () => ({ county: [], city: [], etj: [], unincorporated: true, ages: {}, sources: [] }), identifyRoadAuthority: async () => ({ roads: [] }) });
    expect(r.findings.find((f) => f.id === "pipelines").status).toBe("unavailable");
  });
});

/* LIVE arm — real EIA service (through curl, because this sandbox's Node cannot reach it directly). */
const LIVE = !!process.env.PLANYR_LIVE_EIA;
describe.skipIf(!LIVE)("LIVE — real EIA gas service, same two geometries", () => {
  const curlFetch = async (url, o) => {
    const args = ["-sS", "-m", "60"];
    if (o && o.body) args.push("--data-binary", new URLSearchParams(Object.entries(o.body).filter(([, v]) => v != null).map(([k, v]) => [k, String(v)])).toString(), "-H", "Content-Type: application/x-www-form-urlencoded");
    args.push(url);
    const j = JSON.parse(execFileSync("curl", args, { maxBuffer: 1e8 }).toString());
    if (j.error) throw new Error(JSON.stringify(j.error));
    return j;
  };
  const live = async (rings) => (await runSiteAnalysis(rings, { cache: freshCache(), fetchJson: curlFetch,
    identifyJurisdiction: async () => ({ county: [], city: [], etj: [], unincorporated: true, ages: {}, sources: [] }), identifyRoadAuthority: async () => ({ roads: [] }) })).findings.find((f) => f.id === "pipelines");
  it("quoted envelope → present; stored parcels → unconfirmed", async () => {
    expect(GIS_SOURCES.eiaGas.serviceUrl).toMatch(/Natural_Gas/);
    const a = await live(QUOTED_RINGS); const b = await live(STORED_RINGS);
    console.log("LIVE quoted:", a.status, "|", a.summary, "\nLIVE stored:", b.status, "|", b.summary);
    expect(a.status).toBe("present");
    expect(b.status).toBe("unconfirmed");
  }, 180000);
});
