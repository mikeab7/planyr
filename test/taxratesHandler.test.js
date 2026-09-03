import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The workbook BYTES → ROWS step is SheetJS's job, not this module's — stub it with the same
// row shapes comptrollerRates.test.js already proves the pure extractor handles correctly, so
// this test is about the Function's own control flow (year probing, per-type fetch, caching,
// error propagation), not a second XLSX-parsing test.
const SHEETS = {
  county: [
    ["COUNTY RATES AND LEVIES"], ["2025 COUNTY REPORT OF PROPERTY VALUE"],
    ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "VERSION NAME", "VERSION DATE",
      "MARKET VALUE", "TAXABLE VALUE FOR GENERAL/ROAD AND BRIDGE FUNDS", "TAXABLE VALUE FOR FMFC FUND",
      "NO-NEW-REVENUE RATE", "VOTER-APPROVAL RATE", "GF M&O TAX RATE", "GF I&S TAX RATE", "GF TOTAL RATE",
      "R&B M&O TAX RATE", "R&B I&S TAX RATE", "R&B TOTAL RATE", "FMFC M&O RATE", "FMFC I&S RATE",
      "FMFC TOTAL  RATE", "TOTAL COUNTY TAX RATE", "CALCULATED LEVY"],
    [101, "Harris", "101", "Harris", "id", "Working", "01/28/2026", 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.38096, 1],
  ],
  city: [
    ["CITY RATES AND LEVIES"], ["2025 CITY REPORT OF PROPERTY VALUE"],
    ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "TAXING UNIT NAME", "SPLIT",
      "VERSION NAME", "VERSION DATE", "MARKET VALUE", "TAXABLE VALUE", "NO-NEW-REVENUE RATE",
      "VOTER-APPROVAL RATE", "M&O RATE", "I&S RATE", "TOTAL TAX RATE", "CALCULATED LEVY"],
    [101, "Harris", "101", "Harris", "id", "Houston", "X", "Working", "01/28/2026", 1, 1, 0, 0, 0, 0, 0.1667, 1],
  ],
  "school-district": [
    ["ISD RATES AND LEVIES"], ["2025 ISD REPORT OF PROPERTY VALUE"],
    ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "TAXING UNIT NAME", "SPLIT",
      "VERSION NAME", "VERSION DATE", "MARKET VALUE", "TAXABLE VALUE M&O", "TAXABLE VALUE I&S",
      "NO-NEW-REVENUE RATE", "VOTER-APPROVAL RATE", "M&O RATE", "I&S RATE", "TOTAL TAX RATE", "CALCULATED LEVY"],
    [101, "Harris", "101", "Harris", "id", "Waller ISD", "X", "Working", "01/28/2026", 1, 1, 1, 0, 0, 0, 0, 0.44, 1],
  ],
  "special-district": [
    ["SPECIAL DISTRICT RATES AND LEVIES"], ["2025 SPECIAL DISTRICT REPORT OF PROPERTY VALUE"],
    ["CAD ID", "CAD NAME", "COUNTY ID", "COUNTY NAME", "TAXING UNIT ID", "TAXING UNIT NAME", "SPLIT",
      "VERSION NAME", "VERSION DATE", "MARKET VALUE", "TAXABLE VALUE", "NO-NEW-REVENUE RATE",
      "VOTER-APPROVAL RATE", "M&O RATE", "I&S RATE", "TOTAL TAX RATE", "CALCULATED LEVY"],
    [101, "Harris", "101", "Harris", "id", "Harris County Hospital District", "", "Working", "01/28/2026", 1, 1, 0, 0, 0, 0, 0.18761, 1],
  ],
};

vi.mock("xlsx", () => ({
  read: vi.fn((buf) => ({ SheetNames: ["Detail"], Sheets: { Detail: buf._sheetKey } })),
  utils: { sheet_to_json: vi.fn((sheetKey) => SHEETS[sheetKey]) },
}));

function makeCaches() {
  const store = new Map();
  return { default: {
    match: vi.fn(async (req) => store.get(req.url)),
    put: vi.fn(async (req, res) => { store.set(req.url, res); }),
  } };
}

function urlToType(url) {
  const m = url.match(/\d{4}-(county|city|school-district|special-district)-rates-levies\.xlsx$/);
  return m ? m[1] : null;
}

describe("functions/api/taxrates — onRequestGet", () => {
  let context;
  beforeEach(() => {
    globalThis.caches = makeCaches();
    context = { waitUntil: (p) => p, request: new Request("https://planyr.io/api/taxrates?county=Harris") };
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); delete globalThis.caches; });

  it("probes backward to find the latest published year, fetches all four workbook types, and combines them", async () => {
    const now = new Date().getUTCFullYear();
    vi.stubGlobal("fetch", vi.fn(async (url, opts) => {
      const type = urlToType(url);
      if (opts?.method === "HEAD") {
        // only the (now - 1) county file "exists" — simulates the current calendar year's
        // workbook not being published yet, which is the normal state most of the year.
        return { ok: url.includes(`${now - 1}-county-rates-levies.xlsx`) };
      }
      const yearInUrl = url.match(/^https:\/\/comptroller\.texas\.gov\/taxes\/property-tax\/docs\/(\d{4})-/)[1];
      if (Number(yearInUrl) !== now - 1) return { ok: false, status: 404 };
      return { ok: true, arrayBuffer: async () => ({ _sheetKey: type }) };
    }));

    const { onRequestGet } = await import("../functions/api/taxrates.js");
    const res = await onRequestGet(context);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.year).toBe(now - 1);
    expect(body.versionDate).toBe("01/28/2026");
    expect(body.county).toEqual({ name: "Harris", rate: 0.38096 });
    expect(body.cities).toEqual([{ name: "Houston", rate: 0.1667, split: true }]);
    expect(body.isds).toEqual([{ name: "Waller ISD", rate: 0.44, split: true }]);
    expect(body.special).toEqual([{ name: "Harris County Hospital District", rate: 0.18761, split: false }]);
    expect(res.headers.get("cache-control")).toMatch(/max-age/);
  });

  it("serves the second request for the same county from the edge cache without re-fetching", async () => {
    const now = new Date().getUTCFullYear();
    const fetchMock = vi.fn(async (url, opts) => {
      if (opts?.method === "HEAD") return { ok: url.includes(`${now - 1}-county-rates-levies.xlsx`) };
      const type = urlToType(url);
      return { ok: true, arrayBuffer: async () => ({ _sheetKey: type }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    const { onRequestGet } = await import("../functions/api/taxrates.js");
    await onRequestGet(context);
    const callsAfterFirst = fetchMock.mock.calls.length;
    const res2 = await onRequestGet({ ...context, request: new Request("https://planyr.io/api/taxrates?county=Harris") });
    expect(res2.status).toBe(200);
    expect(fetchMock.mock.calls.length).toBe(callsAfterFirst); // no new upstream calls
  });

  it("502s with a stated reason when no year within the probe window is published (LOUD-FAILURE)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));
    const { onRequestGet } = await import("../functions/api/taxrates.js");
    const res = await onRequestGet(context);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/no comptroller/i);
  });

  it("400s when no county is given, never guesses one", async () => {
    const { onRequestGet } = await import("../functions/api/taxrates.js");
    const res = await onRequestGet({ ...context, request: new Request("https://planyr.io/api/taxrates") });
    expect(res.status).toBe(400);
  });

  it("403s a cross-origin request", async () => {
    const { onRequestGet } = await import("../functions/api/taxrates.js");
    const req = new Request("https://planyr.io/api/taxrates?county=Harris", { headers: { Origin: "https://evil.example" } });
    const res = await onRequestGet({ ...context, request: req });
    expect(res.status).toBe(403);
  });
});
