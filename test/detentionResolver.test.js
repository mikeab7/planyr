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
const BKDD = "Brookshire_Katy"; // B861 — the drainage-district boundary source (added to every route set)
// B1075/B1078/B1080 — the district-aware tier: the district's OWN GIS (Quiddity) + the
// national NHD fallback that answers "is there a channel here at all?" everywhere else.
const BKDD_BOUND = "Boundaries/MapServer/129", BKDD_CHAN = "Drainage_Information/MapServer/108";
const BKDD_WS = "Drainage_Information/MapServer/116";
const BKDD_ESMT = "Drainage_Information/MapServer/109", BKDD_ESMT107 = "Drainage_Information/MapServer/107";
const NHD = "services/nhd/MapServer/6";

// A Houston-area point (keeps the H-GAC ETJ source in etjSourcesForPoint's region).
const LNG = -95.37, LAT = 29.76;
// `bkdd`: pass an array of features to place the site inside the district, or `"error"`
// to simulate a boundary-source outage; the default [] is a clean "not in a district".
const baseRoutes = ({ county = "Harris", city = null, etj = null, mud = [], bkdd = [], extra = {} } = {}) => ({
  [COUNTY]: () => (Array.isArray(county) ? county : [county]).map((n) => ({ attributes: { CNTY_NM: n } })),
  [CITY]: () => (city ? (Array.isArray(city) ? city : [city]).map((n) => ({ attributes: { city_name: n } })) : []),
  [ETJ]: () => (etj ? [{ attributes: { CITY: etj } }] : []),
  [MUD]: () => mud,
  [BKDD]: () => { if (bkdd === "error") throw new Error("bkdd source down"); return bkdd; },
  // B1080 — the NHD fallback is queried wherever no drainage district governs, so it
  // belongs in the BASE route set (a site outside Harris/BKDD hits it, not "no route").
  [NHD]: () => [],
  ...extra,
});
const optsFor = (routes) => ({ cache: freshCache(), fetchJson: fakeFetch(routes) });

describe("authorityForJurisdiction — the pure mapping", () => {
  const j = (o) => authorityForJurisdiction(o);
  it("Houston CITY LIMITS → coh; Harris channel authority", () => {
    expect(j({ city: ["Houston"], county: ["Harris"] }).primary).toBe("coh");
    expect(j({ city: ["Houston"], county: ["Harris"] }).channelAuthority).toBe("hcfcd");
  });
  it("Houston ETJ (not city limits) → the COUNTY authority governs detention, NOT coh (owner rule 2026-07-10)", () => {
    // Being in Houston's ETJ means the City reviews platting, but the county drainage
    // district's criteria govern detention — it must NEVER auto-set the reviewer to COH.
    const harrisEtj = j({ city: [], etj: ["Houston"], county: ["Harris"] });
    expect(harrisEtj.primary).toBe("hcfcd");
    expect(harrisEtj.flags).toContain("houston-etj");
    expect(harrisEtj.overlays.find((o) => o.kind === "etj")).toMatchObject({ kind: "etj", city: "Houston" });
    // Fort Bend ETJ of Houston (this session's real repro: 27211 Hoyt Ln, Katy) → FBCDD, not COH.
    const fbEtj = j({ city: [], etj: ["Houston"], county: ["Fort Bend"] });
    expect(fbEtj.primary).toBe("fortbend");
    expect(fbEtj.flags).toContain("houston-etj");
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
  it("a city straddle is ambiguous, and candidates are AUTHORITY ids (not raw city names)", () => {
    const a = j({ city: ["Houston", "Bellaire"], county: ["Harris"] });
    expect(a.primary).toBeNull();
    expect(a.ambiguous[0].kind).toBe("straddle");
    // Houston → coh; an unmodeled city (Bellaire) → the containing county's authority.
    expect(a.ambiguous[0].candidates).toEqual(["coh", "hcfcd"]);
    // An overlay city straddling maps to its overlay id, so its candidate can be priced.
    const b = j({ city: ["Missouri City", "Sugar Land"], county: ["Fort Bend"] });
    expect(b.ambiguous[0].candidates).toEqual(["missouricity", "fortbend"]);
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
  // B861 (chat NEW-2) — the Brookshire–Katy DD tier: additive, per-source isolated, loud on outage.
  it("inside BKDD → an ADDITIVE drainage-district overlay + flag (never a reviewer replacement)", async () => {
    const routes = baseRoutes({ county: "Waller", bkdd: [{ attributes: { Name: "BROOKSHIRE-KATY DRAINAGE DISTRICT" } }] });
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(routes));
    expect(out.flags).toContain("bkdd-district-present");
    const dd = out.overlays.find((o) => o.kind === "drainage-district");
    expect(dd).toBeTruthy();
    expect(dd.id).toBe("bkdd");
    expect(dd.short.length).toBeLessThanOrEqual(110);
    // Additive — the county still governs; the district never becomes the primary reviewer.
    expect(out.primaryReviewer?.authorityId).toBe("waller");
    expect(out.district.state).toBe("loaded");
  });
  it("outside BKDD → no district overlay, no flag (a clean 'not in a district')", async () => {
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(baseRoutes({ county: "Harris" })));
    expect(out.flags).not.toContain("bkdd-district-present");
    expect(out.flags).not.toContain("bkdd-unverified");
    expect(out.overlays.filter((o) => o.kind === "drainage-district")).toHaveLength(0);
    expect(out.district.state).toBe("empty");
  });
  it("a FAILED BKDD boundary query flags 'bkdd-unverified' — an outage is never 'not in a district'", async () => {
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(baseRoutes({ county: "Waller", bkdd: "error" })));
    expect(out.district.state).toBe("failed");
    expect(out.flags).toContain("bkdd-unverified");
    expect(out.flags).not.toContain("bkdd-district-present");
    expect(out.overlays.filter((o) => o.kind === "drainage-district")).toHaveLength(0);
  });
  it("a FAILED county lookup flags jurisdiction-unavailable — an outage is never 'no requirement'", async () => {
    const routes = baseRoutes({});
    routes[COUNTY] = () => { throw new Error("service down"); };
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(routes));
    expect(out.primaryReviewer).toBeNull();
    expect(out.flags).toContain("jurisdiction-unavailable");
    // …but a REAL unmapped county (query succeeded) is a different, honest case:
    const out2 = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(baseRoutes({ county: "Galveston" })));
    expect(out2.flags).toContain("no-criteria-modeled");
    expect(out2.flags).not.toContain("jurisdiction-unavailable");
  });
  it("a parcel ring straddling two counties surfaces in ambiguous", async () => {
    const ring = [[-95.4, 29.7], [-95.4, 29.8], [-95.3, 29.8], [-95.3, 29.7]];
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT, ring }, optsFor(baseRoutes({ county: ["Harris", "Fort Bend"] })));
    expect(out.primaryReviewer).toBeNull();
    expect(out.ambiguous[0].kind).toBe("straddle");
  });

  it("the ring is threaded into the jurisdiction identify (a POINT query can't ever straddle)", async () => {
    // GEOMETRY-AWARE fake: a polygon query returns BOTH counties (the straddle), a point
    // query returns only the centroid county — real ArcGIS behavior. If the resolver
    // failed to pass the ring, the county query would be a point and the straddle would
    // be invisible. This is the exact bug the review caught.
    const ring = [[-95.75, 29.94], [-95.75, 29.98], [-95.63, 29.98], [-95.63, 29.94]];
    const routes = {
      [COUNTY]: (url) => /esriGeometryPolygon/.test(url) ? [{ attributes: { CNTY_NM: "Harris" } }, { attributes: { CNTY_NM: "Fort Bend" } }] : [{ attributes: { CNTY_NM: "Harris" } }],
      [CITY]: () => [], [ETJ]: () => [], [MUD]: () => [],
    };
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT, ring }, optsFor(routes));
    expect(out.jurisdiction.county.sort()).toEqual(["Fort Bend", "Harris"]);
    expect(out.primaryReviewer).toBeNull();
    expect(out.ambiguous[0].kind).toBe("straddle");
    expect(out.ambiguous[0].candidates.sort()).toEqual(["fortbend", "hcfcd"]);
  });

  it("a CITY-LIMITS outage that leaves a county authority is flagged jurisdiction-partial (could've been in-city)", async () => {
    const routes = baseRoutes({});
    routes[CITY] = () => { throw new Error("city down"); };
    const out = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(routes));
    expect(out.primaryReviewer.authorityId).toBe("hcfcd"); // county default…
    expect(out.flags).toContain("jurisdiction-partial"); // …but honestly flagged as possibly-incomplete
    // A Houston CITY hit is NOT flagged (coh is the resolved reviewer, nothing hidden):
    const out2 = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(baseRoutes({ city: "Houston" })));
    expect(out2.flags).not.toContain("jurisdiction-partial");
    // An ETJ-only outage (city query OK) is NOT flagged — ETJ never changes the detention
    // authority, so a failed ETJ query can't have hidden a different answer (owner rule 2026-07-10):
    const etjDown = baseRoutes({});
    etjDown[ETJ] = () => { throw new Error("etj down"); };
    const out3 = await resolveDrainageAuthority({ lng: LNG, lat: LAT }, optsFor(etjDown));
    expect(out3.flags).not.toContain("jurisdiction-partial");
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

  /* B1080 CONTRACT CHANGE (was: "outside Harris → channel not-applicable"). Reporting
   * "not-applicable" was the whole bug: on a Waller/BKDD site beside an obvious channel the
   * readout could only say "unknown". Outside Harris we now query the governing district —
   * or, where none publishes GIS, the national NHD inventory. HCFCD's watershed layer is
   * still skipped (it is Harris-only), so the "no wasted queries" half of this test stands. */
  it("outside Harris and outside any district: NHD answers instead of 'not-applicable'", async () => {
    const routes = baseRoutes({ county: "Fort Bend", extra: { [FLOOD]: () => [] } });
    const ctx = await resolveDrainageContext({ lng: -95.8, lat: 29.6, ring }, optsFor(routes));
    expect(ctx.authority.primaryReviewer.authorityId).toBe("fortbend");
    expect(ctx.drainageDistrict.id).toBeNull();
    expect(ctx.channel.sourceId).toBe("nhdChannel");
    expect(ctx.channel.state).toBe("empty"); // the NHD route returns [] — a real empty
    expect(ctx.watershed).toBeNull();        // HCFCD's watershed layer is still not queried
    expect(ctx.watershedOverlays).toEqual([]);
  });

  it("NHD names the watercourse and decodes its type — the Tsakiris case, and it is INVENTORY-flagged", async () => {
    const routes = baseRoutes({
      county: "Waller",
      extra: {
        [FLOOD]: () => [],
        // Live-verified 2026-07-29 at the Tsakiris tract: gnis_name "Willow Fork", ftype 336.
        [NHD]: () => [{ attributes: { gnis_name: "Willow Fork", ftype: 336, fcode: 33600 }, geometry: { paths: [[[-95.8, 29.6], [-95.8, 29.61]]] } }],
      },
    });
    const ctx = await resolveDrainageContext({ lng: -95.8, lat: 29.6, ring }, optsFor(routes));
    expect(ctx.channel.near).toBe(true);
    expect(ctx.channel.name).toBe("Willow Fork");
    expect(ctx.channel.kindLabel).toBe("canal / ditch"); // never the bare code 336
    // An NHD hit proves the channel EXISTS; it must never be promoted to a district channel.
    expect(ctx.channel.inventoryOnly).toBe(true);
  });

  it("inside BKDD: the DISTRICT's own channel / watershed / easement layers are queried, not HCFCD's", async () => {
    const routes = baseRoutes({
      county: "Waller",
      bkdd: [{ attributes: { Name: "Brookshire-Katy Drainage District" } }],
      extra: {
        [FLOOD]: () => [],
        [BKDD_CHAN]: () => [{ attributes: { streamname: "Willow Fork" }, geometry: { paths: [[[-95.895, 29.779], [-95.895, 29.78]]] } }],
        [BKDD_WS]: () => [{ attributes: { subwatersh: "Willow Fork", sq_miles: 23 } }],
        [BKDD_ESMT]: () => [{ attributes: { width: 70, file: "WF-10.pdf" } }],
        [BKDD_ESMT107]: () => [],
        // If the resolver wrongly reached for HCFCD or NHD here, these would answer instead.
        [CHAN]: () => { throw new Error("HCFCD must NOT be queried inside BKDD"); },
        [NHD]: () => { throw new Error("NHD must NOT be queried when a district governs"); },
      },
    });
    const ctx = await resolveDrainageContext({ lng: -95.89503, lat: 29.77938, ring }, optsFor(routes));
    // B1091(×2) — `tested` records which district boundary queries answered cleanly; only a
    // clean negative may ever exclude a rival district (governingDistrict's `exclusive`).
    expect(ctx.drainageDistrict).toEqual({ id: "bkdd", source: "boundary", tested: ["bkdd"] });
    expect(ctx.channel.sourceId).toBe("bkddChannel");
    expect(ctx.channel.name).toBe("Willow Fork");
    expect(ctx.channel.inventoryOnly).toBe(false);
    expect(ctx.watershed.names).toEqual(["Willow Fork"]);
    expect(ctx.watershed.sqMiles).toBe(23);
    // The 70-ft easement + its recorded exhibit — a hard buildable-area constraint.
    expect(ctx.easements.present).toBe(true);
    expect(ctx.easements.maxWidthFt).toBe(70);
    expect(ctx.easements.items[0].exhibit).toBe("WF-10.pdf");
  });

  it("a BKDD easement-layer OUTAGE is an honest unknown, never 'no easement'", async () => {
    const routes = baseRoutes({
      county: "Waller",
      bkdd: [{ attributes: { Name: "BKDD" } }],
      extra: {
        [FLOOD]: () => [],
        [BKDD_CHAN]: () => [],
        [BKDD_WS]: () => [],
        [BKDD_ESMT]: () => { throw new Error("district GIS down"); },
        [BKDD_ESMT107]: () => { throw new Error("district GIS down"); },
      },
    });
    const ctx = await resolveDrainageContext({ lng: -95.89503, lat: 29.77938, ring }, optsFor(routes));
    expect(ctx.easements.state).toBe("failed");
    expect(ctx.easements.present).toBeNull(); // NOT false — an outage is never a clean "no"
  });

  it("a district's OWN sub-watershed name can never inherit an HCFCD watershed overlay", async () => {
    // WATERSHED_OVERLAYS are HCFCD-keyed (Addicks/Barker, Upper Cypress). A BKDD basin that
    // happened to match one of those regexes must NOT pick up a Harris reservoir caveat.
    const routes = baseRoutes({
      county: "Waller",
      bkdd: [{ attributes: { Name: "BKDD" } }],
      extra: {
        [FLOOD]: () => [],
        [BKDD_CHAN]: () => [],
        [BKDD_WS]: () => [{ attributes: { subwatersh: "ADDICKS RESERVOIR", sq_miles: 9 } }],
        [BKDD_ESMT]: () => [], [BKDD_ESMT107]: () => [],
      },
    });
    const ctx = await resolveDrainageContext({ lng: -95.89503, lat: 29.77938, ring }, optsFor(routes));
    expect(ctx.watershed.names).toEqual(["ADDICKS RESERVOIR"]);
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
