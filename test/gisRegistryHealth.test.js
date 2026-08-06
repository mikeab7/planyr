/* NEW-1 — the guards that close the hole two dead flood layers fell through.
 *
 * The failure this suite exists to prevent, stated plainly: `hcfcdMaapnext` and `femaEbfe` both
 * sat at tier "production" with a recent `lastVerified` while failing at EVERY probe point,
 * including Harris County — the owner's core market and the county the whole drainage/detention
 * product is built around — and the weekly drift job stayed green the entire time. It stayed
 * green because NEITHER ROW HAD A COVERAGE FIXTURE, and a fixture-less row gives the verifier
 * nothing to assert. Twelve rows were in that state.
 *
 * Three separate invariants are needed, and all three are here:
 *   1. every row carries at least one fixture, so nothing is invisible again;
 *   2. "is this the authoritative endpoint" (tier) and "does it answer" (availability) are
 *      SEPARATE facts, and a row that does not answer must say so with a complete record;
 *   3. every row declares which states it can answer in, so an empty map in Colorado can be
 *      told apart from a source that has no Colorado meaning.
 */
import { describe, it, expect } from "vitest";
import {
  GIS_SOURCES, auditRegistry, availabilityProblems, availabilityOf, fixtureCount,
  statesFor, sourceCoversState, VALID_AVAILABILITY, SOURCE_STATE_SCOPE,
  // B209505 — the fixture-REACH tier: one point is not coverage.
  fixtureReachProblems, fixturePoints, haversineKm, SOURCE_FIXTURE_REACH, SOURCE_FIXTURE_REACH_PENDING,
} from "../src/shared/gis/sources.js";
// NEW-4 — the fixtures live off the app bundle now (sourceFixtures.js header explains why).
import { SOURCE_FIXTURES, SOURCE_DOCS, fixturesFor } from "../src/shared/gis/sourceFixtures.js";

const rows = Object.entries(GIS_SOURCES);

describe("the registry as shipped", () => {
  it("passes its own audit with zero problems", () => {
    expect(auditRegistry(GIS_SOURCES, SOURCE_FIXTURES, SOURCE_DOCS).problems).toEqual([]);
  });

  it("EVERY row carries at least one coverage fixture — no exceptions", () => {
    const naked = rows.filter(([k]) => fixtureCount(null, fixturesFor(k)) === 0).map(([k]) => k);
    expect(naked).toEqual([]);
  });

  it("every row declares a state scope", () => {
    const undeclared = rows.filter(([, s]) => statesFor(s) === undefined).map(([k]) => k);
    expect(undeclared).toEqual([]);
  });
});

/* B209505 — THE OWNER'S SIX HOUSTON SITES, PINNED AS A PERMANENT REGRESSION SUITE.
 *
 * These are the six new industrial locations the 2026-08-06 audit ran 27 layers against, one per
 * Houston-metro county. Every one of them is now a fixture on the rows that cover Houston, so the
 * weekly drift job asks about them forever. The owner's ask: "if this suite had existed, every
 * finding in this block would have been caught by the weekly job instead of by the owner."
 *
 * This test asserts the POINTS are still in the fixture set. It cannot assert what the services
 * return — that is the weekly live verifier's job — but it makes silently dropping one of these
 * six a red build, which is the part a unit test can hold. */
const OWNER_SITES_2026_08_06 = [
  { label: "Cedar Port / Mont Belvieu (Chambers)", point: [-94.852, 29.793] },
  { label: "NW Harris, Beltway 8 at US-290", point: [-95.552, 29.87] },
  { label: "Sugar Land (Fort Bend)", point: [-95.6, 29.58] },
  { label: "Conroe / I-45 North (Montgomery)", point: [-95.45, 30.28] },
  { label: "Pearland / SH-288 (Brazoria)", point: [-95.29, 29.55] },
  { label: "Texas City (Galveston)", point: [-94.935, 29.4] },
];

describe("B209505 · the owner's six Houston audit sites are permanent fixtures", () => {
  const near = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
  const allPoints = Object.keys(GIS_SOURCES).flatMap((k) => fixturePoints(fixturesFor(k)));

  for (const site of OWNER_SITES_2026_08_06) {
    it(`${site.label} is asserted by at least one registry row`, () => {
      expect(allPoints.some((p) => near(p, site.point)), `no fixture at ${site.point}`).toBe(true);
    });
  }

  it("the six are spread across six DIFFERENT counties, not six points in one", () => {
    // Guards against someone "fixing" a failure above by nudging all six onto one convenient spot.
    let maxSpan = 0;
    for (let i = 0; i < OWNER_SITES_2026_08_06.length; i++) {
      for (let j = i + 1; j < OWNER_SITES_2026_08_06.length; j++) {
        maxSpan = Math.max(maxSpan, haversineKm(OWNER_SITES_2026_08_06[i].point, OWNER_SITES_2026_08_06[j].point));
      }
    }
    expect(maxSpan).toBeGreaterThan(90);
  });
});

describe("the fixture-completeness guard actually fails", () => {
  // A guard that has never been shown to go red is a hope, not a guard.
  it("rejects a row with no fixtures at all", () => {
    const bad = { key: "x", provider: "P", serviceUrl: "https://example.com/x/MapServer", tier: "production", lastVerified: "2026-08-05", states: null, fixtures: [] };
    const problems = auditRegistry({ x: bad }, { x: {} }).problems;
    expect(problems.some((p) => /NO coverage fixture/.test(p))).toBe(true);
  });

  it("accepts a raster row whose only fixtures are sampleFixtures", () => {
    // B209505 — sampleFixtures count toward REACH as well as toward completeness, so a national
    // raster row needs three separated probe points just like a /query row. That is deliberate:
    // a raster sampled in one place is exactly as unfalsifiable as a vector layer queried in one.
    const sample = [
      { label: "tx", point: [-95, 29], expectValueRange: [0, 1] },
      { label: "co", point: [-105, 39.7], expectValueRange: [0, 1] },
      { label: "nj", point: [-74.17, 40.74], expectValueRange: [0, 1] },
    ];
    const ok = { key: "x", provider: "P", serviceUrl: "https://example.com/x/ImageServer", tier: "production", lastVerified: "2026-08-05", states: null, kind: "raster", sampleFixtures: sample };
    expect(auditRegistry({ x: ok }, { x: { sampleFixtures: sample } }).problems).toEqual([]);
  });

  /* B209505 — the owner's ask, verbatim: "deliberately break a row and prove the suite catches it."
   * The whole point of this item is that the OLD fixture set could not fail: 45 of 57 rows carried
   * one point, so every row's claim to work anywhere rested on one place. These cases break a row
   * in each of the ways that used to pass silently and assert the audit goes red. */
  it("rejects a NATIONAL row proven at only one point (the epaCleanups-in-Pasadena shape)", () => {
    const oneSpot = {
      key: "x", provider: "P", serviceUrl: "https://example.com/x/MapServer", tier: "production",
      lastVerified: "2026-08-06", states: null,
    };
    const fx = { fixtures: [{ label: "Pasadena", point: [-95.21, 29.72], expectMinCount: 1 }] };
    const problems = auditRegistry({ x: oneSpot }, { x: fx }).problems;
    expect(problems.some((p) => /only 1 fixture point/.test(p))).toBe(true);
  });

  it("rejects a national row whose several fixtures are all CLUSTERED in one metro", () => {
    // Three points is enough to satisfy a naive count rule and still prove nothing: these sit
    // within ~20 km of each other, so they re-test one place three times.
    const clustered = {
      key: "x", provider: "P", serviceUrl: "https://example.com/x/MapServer", tier: "production",
      lastVerified: "2026-08-06", states: null,
    };
    const fx = { fixtures: [
      { label: "downtown Houston", point: [-95.37, 29.76], expectMinCount: 1 },
      { label: "Pasadena", point: [-95.21, 29.72], expectMinCount: 1 },
      { label: "NW Harris", point: [-95.55, 29.87], expectMinCount: 1 },
    ] };
    const problems = auditRegistry({ x: clustered }, { x: fx }).problems;
    expect(problems.some((p) => /span only \d+ km/.test(p))).toBe(true);
  });

  it("a reach DEFERRAL must name the blocking host and its V# — an empty excuse is a problem", () => {
    // The deferral list exists because twelve rows sit on hosts this build environment blocks.
    // It must never become a silent opt-out, so a blank reason is itself audited.
    const row = { key: "bkddOutfalls", provider: "P", serviceUrl: "https://gisclient.quiddity.com/x/MapServer", tier: "production", lastVerified: "2026-08-06", states: ["TX"] };
    const fx = { fixtures: [{ label: "one", point: [-95.9, 29.82], expectMinCount: 1 }] };
    // As shipped (a real reason) the row passes its reach check…
    expect(fixtureReachProblems(row, fx)).toEqual([]);
    // …and every shipped deferral actually carries one.
    for (const [k, reason] of Object.entries(SOURCE_FIXTURE_REACH_PENDING)) {
      expect(String(reason || "").trim(), `${k} deferral reason`).not.toBe("");
      expect(reason, `${k} deferral must name its V#`).toMatch(/V\d+/);
    }
  });

  it("every reach-class OVERRIDE carries a justification", () => {
    // Narrowing a row's requirement is allowed (a single drainage district genuinely cannot be
    // probed 200 km apart) but never silently — that is how a row goes back to unfalsifiable.
    for (const [k, v] of Object.entries(SOURCE_FIXTURE_REACH)) {
      expect(Array.isArray(v), `${k} override shape`).toBe(true);
      expect(String(v[1] || "").trim(), `${k} override reason`).not.toBe("");
    }
  });

  it("rejects a row with no state scope", () => {
    const bad = { key: "zz_unknown", provider: "P", serviceUrl: "https://example.com/x/MapServer", tier: "production", lastVerified: "2026-08-05", fixtures: [{ label: "l", point: [-95, 29], expectMinCount: 1 }] };
    expect(auditRegistry({ zz_unknown: bad }, { zz_unknown: { fixtures: [{ label: "l", point: [-95, 29], expectMinCount: 1 }] } }).problems.some((p) => /no state scope/.test(p))).toBe(true);
  });
});

describe("availability is orthogonal to tier", () => {
  it("hcfcdMaapnext is BOTH production and down — and that is not a contradiction", () => {
    const s = GIS_SOURCES.hcfcdMaapnext;
    expect(s.tier).toBe("production");     // it is the authoritative publisher
    expect(availabilityOf(s)).toBe("down"); // it is not answering
  });

  it("a non-live row REQUIRES a complete outage record", () => {
    const base = { key: "x", provider: "P", serviceUrl: "https://e.com/x", tier: "production", lastVerified: "2026-08-05" };
    expect(availabilityProblems({ ...base, availability: "down" }).some((p) => /REQUIRES an outage record/.test(p))).toBe(true);
    const partial = { ...base, availability: "down", outage: { since: "2026-08-04", symptom: "s" } };
    const missing = availabilityProblems(partial);
    for (const f of ["evidence", "impact", "replacement"]) {
      expect(missing.some((p) => p.includes(`outage.${f}`))).toBe(true);
    }
  });

  it("a LIVE row may not carry a stale outage record", () => {
    const s = { key: "x", availability: "live", outage: { since: "2026-01-01" } };
    expect(availabilityProblems(s).some((p) => /must not carry an outage record/.test(p))).toBe(true);
  });

  it("rejects an availability value outside the vocabulary", () => {
    expect(availabilityProblems({ key: "x", availability: "maybe" }).some((p) => /invalid availability/.test(p))).toBe(true);
    expect(VALID_AVAILABILITY).toEqual(["live", "degraded", "down"]);
  });

  it("every declared outage names its replacement — the fall-through must be SAID, not silent", () => {
    for (const [k, s] of rows) {
      if (availabilityOf(s) === "live") continue;
      expect(s.outage.replacement, `${k} outage.replacement`).toBeTruthy();
      expect(s.outage.impact, `${k} outage.impact`).toBeTruthy();
    }
  });
});

describe("state scope — 'nothing here' vs 'we don't have this here'", () => {
  it("a national row answers anywhere", () => {
    expect(sourceCoversState(GIS_SOURCES.flood, "CO")).toBe(true);
    expect(sourceCoversState(GIS_SOURCES.rail, "TX")).toBe(true);
    expect(statesFor(GIS_SOURCES.epaCleanups)).toBeNull();
  });

  it("the Texas-institution rows do NOT claim Colorado", () => {
    // These are the ones that produced the owner's empty Colorado screen: RRC wells, the PUC's
    // CCN construct, TCEQ's LPST list, TxDOT's counts. None has a Colorado meaning at all.
    for (const k of ["oilgas", "pipelines", "ccnWater", "ccnSewer", "lpst", "aadt", "road", "isd", "city", "county", "mud"]) {
      expect(sourceCoversState(GIS_SOURCES[k], "CO"), k).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "TX"), k).toBe(true);
    }
  });

  it("the Colorado rows do NOT claim Texas", () => {
    for (const k of ["cityCo", "isdCo", "waterDistrictCo", "metroDistrictCo", "roadCo", "aadtCo", "cdpheCleanups", "mhfdBoundary"]) {
      expect(sourceCoversState(GIS_SOURCES[k], "TX"), k).toBe(false);
      expect(sourceCoversState(GIS_SOURCES[k], "CO"), k).toBe(true);
    }
  });

  it("FEMA InFRM BLE is Region 6 — neither national nor Texas-only", () => {
    expect(sourceCoversState(GIS_SOURCES.femaEbfe, "TX")).toBe(true);
    expect(sourceCoversState(GIS_SOURCES.femaEbfe, "LA")).toBe(true);
    expect(sourceCoversState(GIS_SOURCES.femaEbfe, "CO")).toBe(false);
  });

  it("an UNKNOWN state never hides anything (the gate fires on a positive mismatch only)", () => {
    // A site with no resolved location must behave exactly as it did before Colorado existed.
    expect(sourceCoversState(GIS_SOURCES.oilgas, null)).toBe(true);
    expect(sourceCoversState(GIS_SOURCES.cityCo, undefined)).toBe(true);
  });

  it("the scope table has no entry for a key that no longer exists", () => {
    const orphans = Object.keys(SOURCE_STATE_SCOPE).filter((k) => !GIS_SOURCES[k]);
    expect(orphans).toEqual([]);
  });
});

describe("the Colorado family (NEW-2)", () => {
  const CO = rows.filter(([, s]) => (statesFor(s) || []).includes("CO"));

  it("is no longer one lonely county row", () => {
    // Before this task Colorado had exactly ONE fixture in the entire registry (Denver county),
    // which is why the weekly drift harness structurally could not see Colorado rot.
    expect(CO.length).toBeGreaterThanOrEqual(15);
  });

  it("every Colorado row has fixtures at real Colorado points", () => {
    for (const [k] of CO) {
      const f = fixturesFor(k);
      const fx = [...(f.fixtures || []), ...(f.sampleFixtures || [])];
      expect(fx.length, `${k} fixtures`).toBeGreaterThan(0);
      for (const f of fx) {
        const [lng, lat] = f.point || [(f.bbox[0] + f.bbox[2]) / 2, (f.bbox[1] + f.bbox[3]) / 2];
        // Colorado's envelope: 37–41 N, 102–109 W.
        expect(lat, `${k}/${f.label} lat`).toBeGreaterThan(36.9);
        expect(lat, `${k}/${f.label} lat`).toBeLessThan(41.1);
        expect(lng, `${k}/${f.label} lng`).toBeLessThan(-101.9);
        expect(lng, `${k}/${f.label} lng`).toBeGreaterThan(-109.1);
      }
    }
  });

  it("covers the categories the owner's Colorado sites were missing", () => {
    for (const k of [
      "cityCo",            // municipal boundaries
      "roadCo",            // road authority
      "isdCo",             // school districts
      "waterDistrictCo",   // water / sanitation districts
      "metroDistrictCo",   // special districts
      "aadtCo",            // traffic counts
      "cdpheCleanups",     // environmental screening
      "mhfdBoundary",      // local drainage authority
    ]) expect(GIS_SOURCES[k], k).toBeTruthy();
  });

  it("MHFD fixtures sit in counties MHFD actually covers", () => {
    // Commerce City (Adams), Denver and Broomfield are member counties; the district boundary
    // fixture is the point-in-district test that selects the Colorado drainage regime.
    const labels = fixturesFor("mhfdBoundary").fixtures.map((f) => f.label.toLowerCase());
    expect(labels.some((l) => l.includes("commerce city"))).toBe(true);
    expect(labels.some((l) => l.includes("denver"))).toBe(true);
  });

  it("⛔ does NOT wire a Colorado oil & gas row — all three candidates were county clips", () => {
    // Live 2026-08-05: Adams County's COGCC copy reports 6,319 wells statewide (711 in Weld) and
    // Broomfield's 8,035 (3,668 in Weld), against a state with ~110k wells and tens of thousands
    // in Weld alone. That is the Chambers-County-14-vs-8,014 trap. Wiring one would be worse than
    // wiring none: a false all-clear on a Weld industrial site.
    const co = rows.filter(([, s]) => (statesFor(s) || []).includes("CO"));
    expect(co.some(([k]) => /oilgas|wells|cogcc|ecmc/i.test(k))).toBe(false);
  });
});
