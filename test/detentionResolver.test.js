// B629 — the drainage-authority resolver: jurisdiction + queried MUD layer +
// (for Harris) channels/watersheds/flood context. Injected fetch/cache — no network.
import { describe, it, expect } from "vitest";
import {
  authorityForJurisdiction,
  resolveDrainageAuthority,
  resolveDrainageContext,
  DETENTION_SOURCES,
  PARCEL_DISTRICT_TYPES,
} from "../src/workspaces/site-planner/lib/detentionRules.js";
import { buildIdentifyParams } from "../src/workspaces/site-planner/lib/jurisdiction.js";
import { createGisCache } from "../src/workspaces/site-planner/lib/gisCache.js";

// Same deterministic harness as jurisdiction.test.js.
function makeStore() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.delete(k); map.set(k, v); },
    removeItem: (k) => map.delete(k),
    get length() { return map.size; },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}
function makeClock(start = 1_000_000) { let t = start; const now = () => t; now.advance = (ms) => { t += ms; }; return now; }
const freshCache = () => createGisCache({ store: makeStore(), now: makeClock() });
function fakeFetch(routes) {
  const fn = async (url) => {
    for (const [needle, respond] of Object.entries(routes)) {
      if (url.includes(needle)) { fn.calls++; return { features: respond(url) }; }
    }
    throw new Error("no route for " + url);
  };
  fn.calls = 0;
  return fn;
}
const COUNTY = "Texas_County_Boundaries", CITY = "Texas_City_Boundaries", ETJ = "HGAC_City_ETJ";
const MUD = "TCEQ_Water_Districts", CHAN = "HCFCD/Channels", WS = "HCFCD/Watershed", FLOOD = "NFHL";

// A Houston-area point (keeps the H-GAC ETJ source in etjSourcesForPoint's region).
const LNG = -95.37, LAT = 29.76;
const baseRoutes = ({ county = "Harris", city = null, etj = null, mud = [], extra = {} } = {}) => ({
  [COUNTY]: () => (Array.isArray(county) ? county : [county]).map((n) => ({ attributes: { CNTY_NM: n } })),
  [CITY]: () => (city ? (Array.isArray(city) ? city : [city]).map((n) => ({ attributes: { city_name: n } })) : []),
  [ETJ]: () => (etj ? [{ attributes: { CITY: etj } }] : []),
  [MUD]: () => mud,
  ...extra,
});
const optsFor = (routes) => ({ cache: freshCache(), fetchJson: fakeFetch(routes) });

describe("authorityForJurisdiction — the pure mapping", () => {
  const j = (o) => authorityForJurisdiction(o);
  it("Houston city → coh; Houston ETJ → coh (IDM applies in the ETJ); Harris channel authority", () => {
    expect(j({ city: ["Houston"], county: ["Harris"] }).primary).toBe("coh");
    expect(j({ city: ["Houston"], county: ["Harris"] }).channelAuthority).toBe("hcfcd");
    expect(j({ city: [], etj: ["Houston"], county: ["Harris"] }).primary).toBe("coh");
  });
  it("Harris unincorporated, outside the COH ETJ → hcfcd", () => {
    const a = j({ city: [], etj: [], county: ["Harris"], unincorporated: true });
    expect(a.primary).toBe("hcfcd");
    expect(a.channelAuthority).toBe("hcfcd");
  });
  it("the county map: Fort Bend / Montgomery / Chambers / Waller", () => {
    expect(j({ county: ["Fort Bend"] }).primary).toBe("fortbend");
    expect(j({ county: ["Montgomery"] }).primary).toBe("montgomery");
    expect(j({ county: ["Chambers"] }).primary).toBe("chambers");
    expect(j({ county: ["Waller"] }).primary).toBe("waller");
  });
  it("an unmodeled county → primary null + no-criteria-modeled (honest, not a guess)", () => {
    const a = j({ county: ["Galveston"] });
    expect(a.primary).toBeNull();
    expect(a.flags).toContain("no-criteria-modeled");
  });
  it("an unmodeled CITY keeps the county screening floor, flagged city-criteria-unverified", () => {
    const a = j({ city: ["Katy"], county: ["Harris"] });
    expect(a.primary).toBe("hcfcd");
    expect(a.flags).toContain("city-criteria-unverified");
  });
  it("municipal overlay cities resolve to their overlay record", () => {
    expect(j({ city: ["Missouri City"], county: ["Fort Bend"] }).primary).toBe("missouricity");
    const m = j({ city: ["Magnolia"], county: ["Montgomery"] });
    expect(m.primary).toBe("magnolia");
    expect(m.overlays[0]).toMatchObject({ kind: "municipal", id: "magnolia" });
  });
  it("a county straddle → primary null + ambiguous populated — NEVER silently defaulted", () => {
    const a = j({ county: ["Harris", "Fort Bend"] });
    expect(a.primary).toBeNull();
    expect(a.ambiguous[0].kind).toBe("straddle");
    expect(a.ambiguous[0].candidates).toEqual(["hcfcd", "fortbend"]);
    expect(a.ambiguous[0].detail).toMatch(/Harris \+ Fort Bend/);
  });
  it("a city straddle is ambiguous too", () => {
    const a = j({ city: ["Houston", "Bellaire"], county: ["Harris"] });
    expect(a.primary).toBeNull();
    expect(a.ambiguous[0].kind).toBe("straddle");
  });
});

describe("resolveDrainageAuthority — jurisdiction + the QUERIED MUD layer", () => {
  it("Houston point: coh primary, hcfcd channel authority, jurisdiction carried", async () => {
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(baseRoutes({ city: "Houston" })));
    expect(out.primaryReviewer.authorityId).toBe("coh");
    expect(out.primaryReviewer.rule.id).toBe("coh-idm9-2026"); // the resolver hands back today's rule
    expect(out.channelAuthority).toBe("hcfcd");
    expect(out.jurisdiction.city).toEqual(["Houston"]);
  });
  it("a real district (MUD) → overlay + mud-district-present flag", async () => {
    const routes = baseRoutes({
      mud: [{ attributes: { NAME: "Harris County MUD 61", TYPE: "MUD", TYPE_DESCRIPTION: "Municipal Utility District", COUNTY: "Harris" } }],
    });
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(routes));
    expect(out.flags).toContain("mud-district-present");
    expect(out.overlays).toContainEqual({ kind: "mud", name: "Harris County MUD 61", type: "Municipal Utility District" });
    expect(out.mud.state).toBe("loaded");
  });
  it("county-blanket authorities are FILTERED OUT — no false 'in a district' flag", async () => {
    // The TCEQ layer blankets Harris with Coastal Water Authority / Port of Houston
    // rows; without the TYPE filter every Harris parcel would read as in-a-MUD.
    const routes = baseRoutes({
      mud: [
        { attributes: { NAME: "Coastal Water Authority", TYPE: "OTH", TYPE_DESCRIPTION: "Other" } },
        { attributes: { NAME: "Port of Houston Authority", TYPE: "ND", TYPE_DESCRIPTION: "Navigation District" } },
      ],
    });
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(routes));
    expect(out.flags).not.toContain("mud-district-present");
    expect(out.overlays.filter((o) => o.kind === "mud")).toHaveLength(0);
    expect(PARCEL_DISTRICT_TYPES.has("OTH")).toBe(false);
    expect(PARCEL_DISTRICT_TYPES.has("MUD")).toBe(true);
  });
  it("a FAILED MUD query reads 'failed' — never fabricated as 'no district'", async () => {
    const routes = baseRoutes({});
    routes[MUD] = () => { throw new Error("service down"); };
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(routes));
    expect(out.mud.state).toBe("failed");
    expect(out.flags).not.toContain("mud-district-present");
  });
  it("a parcel ring straddling two counties surfaces in ambiguous", async () => {
    const ring = [[-95.4, 29.7], [-95.4, 29.8], [-95.3, 29.8], [-95.3, 29.7]];
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT, ring }, optsFor(baseRoutes({ county: ["Harris", "Fort Bend"] })));
    expect(out.primaryReviewer).toBeNull();
    expect(out.ambiguous[0].kind).toBe("straddle");
  });
});

describe("resolveDrainageContext — the full stormwater context", () => {
  const ring = [[-95.372, 29.758], [-95.372, 29.762], [-95.368, 29.762], [-95.368, 29.758]];
  const harrisRoutes = (over = {}) =>
    baseRoutes({
      extra: {
        [FLOOD]: () => [{ attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "FLOODWAY", STATIC_BFE: 95, V_DATUM: "NAVD88" } }],
        [CHAN]: () => [{
          attributes: { UNIT_NO: "W100-00-00", CHAN_NAME: "BUFFALO BAYOU", TYPE: "OPEN", DIT_TYPE: null },
          geometry: { paths: [[[-95.371, 29.7601], [-95.369, 29.7602]]] },
        }],
        [WS]: () => [{ attributes: { WTSHNAME: "CYPRESS CREEK", WTSHUNIT: "K" } }],
        ...over,
      },
    });

  it("Harris site: flood zones (datum-tagged), nearest channel unit + distance, watershed overlay, ground", async () => {
    const ctx = await resolveDrainageContext(
      { lng: LNG, lat: LAT, ring },
      { ...optsFor(harrisRoutes()), sampleGround: async () => 100 }
    );
    expect(ctx.authority.channelAuthority).toBe("hcfcd");
    expect(ctx.flood.state).toBe("loaded");
    expect(ctx.flood.zones[0]).toMatchObject({ zone: "AE", subtype: "FLOODWAY", staticBfeFt: 95, vdatum: "NAVD88" });
    expect(ctx.channel.near).toBe(true);
    expect(ctx.channel.unitNo).toBe("W100-00-00");
    expect(ctx.channel.distFt).toBeLessThan(1500); // the fake channel runs ~inside the parcel
    expect(ctx.watershed.names).toEqual(["CYPRESS CREEK"]);
    expect(ctx.watershedOverlays.map((o) => o.id)).toContain("hcfcd-upper-cypress-retention");
    expect(ctx.groundElevFt).toBe(100);
    expect(ctx.groundDatum).toBe("NAVD88");
  });

  it("the NFHL -9999 'no static BFE' sentinel maps to null, never a real elevation", async () => {
    const routes = harrisRoutes({ [FLOOD]: () => [{ attributes: { FLD_ZONE: "A", ZONE_SUBTY: null, STATIC_BFE: -9999, V_DATUM: null } }] });
    const ctx = await resolveDrainageContext({ lng: LNG, lat: LAT, ring }, optsFor(routes));
    expect(ctx.flood.zones[0].zone).toBe("A");
    expect(ctx.flood.zones[0].staticBfeFt).toBeNull();
  });

  it("a failed channel query → near:null 'failed' — an outage is NEVER 'no channel'", async () => {
    const routes = harrisRoutes({ [CHAN]: () => { throw new Error("down"); } });
    const ctx = await resolveDrainageContext({ lng: LNG, lat: LAT, ring }, optsFor(routes));
    expect(ctx.channel.near).toBeNull();
    expect(ctx.channel.state).toBe("failed");
  });

  it("no channel features in reach → near:false (a real empty, distinct from failure)", async () => {
    const routes = harrisRoutes({ [CHAN]: () => [] });
    const ctx = await resolveDrainageContext({ lng: LNG, lat: LAT, ring }, optsFor(routes));
    expect(ctx.channel.near).toBe(false);
    expect(ctx.channel.state).toBe("empty");
  });

  it("outside Harris: channel not-applicable, watershed null — no wasted queries", async () => {
    const routes = baseRoutes({ county: "Fort Bend", extra: { [FLOOD]: () => [] } });
    const ctx = await resolveDrainageContext({ lng: -95.8, lat: 29.6, ring }, optsFor(routes));
    expect(ctx.authority.primaryReviewer.authorityId).toBe("fortbend");
    expect(ctx.channel.state).toBe("not-applicable");
    expect(ctx.watershed).toBeNull();
    expect(ctx.watershedOverlays).toEqual([]);
  });

  it("no ground sampler injected → groundElevFt null (regime stays honest downstream)", async () => {
    const ctx = await resolveDrainageContext({ lng: LNG, lat: LAT, ring }, optsFor(harrisRoutes()));
    expect(ctx.groundElevFt).toBeNull();
  });
});

describe("DETENTION_SOURCES — registry-fed identify rows", () => {
  it("the channel source rides the buffered line path (frontage semantics)", () => {
    const p = buildIdentifyParams(DETENTION_SOURCES.hcfcdChannel, { lng: LNG, lat: LAT });
    expect(p.distance).toBe(90);
    expect(p.units).toBe("esriSRUnit_Meter");
    expect(p.returnGeometry).toBe("true"); // geometry needed for nearest-unit distance
  });
  it("polygon sources intersect without a buffer; URLs are composed from the registry", () => {
    const p = buildIdentifyParams(DETENTION_SOURCES.mud, { lng: LNG, lat: LAT });
    expect(p.distance).toBeUndefined();
    for (const s of Object.values(DETENTION_SOURCES)) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.fields).toBeTruthy();
    }
  });
});
