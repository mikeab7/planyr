import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("../src/workspaces/site-planner/lib/jurisdiction.js", () => ({
  identifyJurisdiction: vi.fn(),
  identifySource: vi.fn(),
}));

// The exact payload shape functions/api/taxrates.js returns (see comptrollerRates.test.js for
// the workbook-row extraction this is built from) — Harris's own consolidated rate plus the
// three countywide special entities the module folds in by name, plus a city and two ISDs.
const RATES_PAYLOAD = {
  year: 2025, versionDate: "01/28/2026",
  source: "Texas Comptroller of Public Accounts — Rates and Levies",
  county: { name: "Harris", rate: 0.38096 },
  cities: [{ name: "Houston", rate: 0.1667, split: true }],
  isds: [{ name: "Waller ISD", rate: 0.44, split: true }, { name: "Katy ISD", rate: 0.39, split: true }],
  special: [
    { name: "Harris County Hospital District", rate: 0.18761, split: false },
    { name: "Harris Co Department of Education Dist", rate: 0.004798, split: false },
    { name: "Port of Houston Authority", rate: 0.0059, split: false },
  ],
};

function stubFetchOk(payload) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => payload })));
}

// Each test gets a FRESH module instance (a fresh `ratesPromise` memo inside harrisTaxRates.js) —
// the module deliberately caches a successful fetch for the session, so re-importing statically
// across tests would let one test's stub silently answer another's.
async function freshModule({ mudFeatures = [] } = {}) {
  vi.resetModules();
  const jur = await import("../src/workspaces/site-planner/lib/jurisdiction.js");
  jur.identifySource.mockReturnValue({ fresh: Promise.resolve({ items: mudFeatures, error: null }) });
  const mod = await import("../src/workspaces/site-planner/lib/harrisTaxRates.js");
  return { identifyJurisdiction: jur.identifyJurisdiction, resolveHarrisTaxRates: mod.resolveHarrisTaxRates };
}
// A raw HCAD_MUD/TCEQ-water-district identify feature, shaped like `identifySource`'s `.items`
// entries ({attrs, geometry}) — GIS_SOURCES.mud's real field names (NAME/TYPE).
const mudFeature = (name, type) => ({ attrs: { NAME: name, TYPE: type }, geometry: null });

describe("resolveHarrisTaxRates — the un-split raw ranch tract case (the reported Richfield defect)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("unincorporated + one ISD: sums county + hospital + education + port + ISD, never the city", async () => {
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule();
    stubFetchOk(RATES_PAYLOAD);
    identifyJurisdiction.mockResolvedValue({ city: [], isd: ["Waller ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 });

    expect(r.connected).toBe(true);
    expect(r.taxYear).toBe(2025);
    expect(r.versionDate).toBe("01/28/2026");
    // Harris + Hospital + Dept of Education + Port of Houston + Waller ISD — NOT Houston (the
    // point isn't in it), and never a MUD/management-district rate (out of scope this pass).
    const expected = 0.38096 + 0.18761 + 0.004798 + 0.0059 + 0.44;
    expect(r.total).toBeCloseTo(expected, 5);
    expect(r.units.find((u) => u.name === "City")).toEqual({ name: "City", value: "unincorporated" });
    expect(r.units.some((u) => u.name === "Waller ISD")).toBe(true);
    expect(r.note).toMatch(/2025/);
    expect(r.note).toMatch(/not checked yet/i); // the MUD/community-college coverage caveat, always present
  });

  it("a city that resolves: its own rate joins the total", async () => {
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule();
    stubFetchOk(RATES_PAYLOAD);
    identifyJurisdiction.mockResolvedValue({ city: ["Houston"], isd: ["Waller ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.37, lat: 29.76 });
    const expected = 0.38096 + 0.1667 + 0.18761 + 0.004798 + 0.0059 + 0.44;
    expect(r.total).toBeCloseTo(expected, 5);
  });

  it("a resolved unit with no matching Comptroller row is listed but excluded from the total, never guessed at", async () => {
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule();
    stubFetchOk(RATES_PAYLOAD);
    // A district the county's GIS knows about but the Comptroller has no rate for yet — this is
    // the exact live case measured on 2026-09-02 (HARRIS COUNTY MUD 377).
    identifyJurisdiction.mockResolvedValue({ city: ["A City The Workbook Doesn't Have"], isd: ["Waller ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 });
    const cityRow = r.units.find((u) => u.name === "A City The Workbook Doesn't Have");
    expect(cityRow.value).toBe("—"); // never a fabricated number
    const withoutCity = 0.38096 + 0.18761 + 0.004798 + 0.0059 + 0.44;
    expect(r.total).toBeCloseTo(withoutCity, 5); // the unmatched city never joins the sum
    expect(r.note).toMatch(/Not included:.*A City The Workbook Doesn't Have/);
  });

  it("a straddling site (two ISDs) sums both — never arbitrarily picks one", async () => {
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule();
    stubFetchOk(RATES_PAYLOAD);
    identifyJurisdiction.mockResolvedValue({ city: [], isd: ["Waller ISD", "Katy ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 });
    const expected = 0.38096 + 0.18761 + 0.004798 + 0.0059 + 0.44 + 0.39;
    expect(r.total).toBeCloseTo(expected, 5);
  });

  it("upstream failure degrades to a rejection with a stated reason, never a fabricated total", async () => {
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 502, json: async () => ({ error: "Comptroller upstream unreachable" }) })));
    identifyJurisdiction.mockResolvedValue({ city: [], isd: ["Waller ISD"] });

    await expect(resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 })).rejects.toThrow(/Comptroller upstream unreachable/);
  });

  it("a MUD with no adopted rate on record is listed, highlighted, and excluded from the total — the exact live Richfield case", async () => {
    // Measured live 2026-09-02: HARRIS COUNTY MUD 377 covers the reported parcel's point but has
    // no matching row in the Comptroller's special-district workbook.
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule({ mudFeatures: [mudFeature("HARRIS COUNTY MUD 377", "MUD")] });
    stubFetchOk(RATES_PAYLOAD);
    identifyJurisdiction.mockResolvedValue({ city: [], isd: ["Waller ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 });
    const mudRow = r.units.find((u) => u.name === "HARRIS COUNTY MUD 377");
    expect(mudRow.value).toBe("—");
    const withoutMud = 0.38096 + 0.18761 + 0.004798 + 0.0059 + 0.44;
    expect(r.total).toBeCloseTo(withoutMud, 5);
    expect(r.note).toMatch(/Not included:.*HARRIS COUNTY MUD 377/);
  });

  it("a MUD with a real adopted rate joins the total, and two overlapping districts both count", async () => {
    const payload = { ...RATES_PAYLOAD, special: [...RATES_PAYLOAD.special, { name: "Harris County MUD 55", rate: 0.5, split: true }] };
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule({
      mudFeatures: [mudFeature("Harris County MUD 55", "MUD"), mudFeature("Richfield Ranch WCID", "WCID")],
    });
    stubFetchOk(payload);
    identifyJurisdiction.mockResolvedValue({ city: [], isd: ["Waller ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 });
    const expected = 0.38096 + 0.18761 + 0.004798 + 0.0059 + 0.44 + 0.5; // MUD 55 matched, WCID not
    expect(r.total).toBeCloseTo(expected, 5);
    expect(r.units.some((u) => u.name === "Richfield Ranch WCID" && u.value === "—")).toBe(true);
  });

  it("a county-blanket authority on the same layer (Port of Houston, Coastal Water Authority) is never mistaken for a MUD line", async () => {
    const { identifyJurisdiction, resolveHarrisTaxRates } = await freshModule({
      mudFeatures: [mudFeature("Coastal Water Authority", "OTH"), mudFeature("Port of Houston Authority", "ND"), mudFeature("Harris County FCD", "OTH")],
    });
    stubFetchOk(RATES_PAYLOAD);
    identifyJurisdiction.mockResolvedValue({ city: [], isd: ["Waller ISD"] });

    const r = await resolveHarrisTaxRates({ lng: -95.78, lat: 29.99 });
    // Port of Houston still appears exactly once (via COUNTYWIDE_SPECIAL, matched with a real
    // rate) — never duplicated by the MUD-layer pass, which must have filtered out all three
    // (type OTH/ND, none of PARCEL_DISTRICT_TYPES).
    expect(r.units.filter((u) => u.name === "Port of Houston Authority")).toHaveLength(1);
    expect(r.units.some((u) => u.name === "Coastal Water Authority")).toBe(false);
    expect(r.units.some((u) => u.name === "Harris County FCD")).toBe(false);
  });
});
