import { describe, it, expect } from "vitest";
import {
  landSizeSf, landPricePerSf, buildingPricePerSf, annualLeaseRate,
  summarizeLeaseComps, summarizeSaleComps, compFieldRows, compHeadline,
  validAnchor, validateComp, rowToComp, compToRow,
} from "../src/shared/comps/lib/comps.js";

describe("comps: land $/SF derivation", () => {
  it("derives $/SF from price + acres", () => {
    expect(landSizeSf(1, "ac")).toBe(43560);
    expect(landPricePerSf({ landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac" })).toBeCloseTo(10, 5);
  });
  it("derives $/SF from price + SF directly", () => {
    expect(landPricePerSf({ landPrice: 100000, landSizeValue: 10000, landSizeUnit: "sf" })).toBeCloseTo(10, 5);
  });
  it("is null when price is missing", () => {
    expect(landPricePerSf({ landSizeValue: 1, landSizeUnit: "ac" })).toBeNull();
  });
  it("is null when size is missing", () => {
    expect(landPricePerSf({ landPrice: 100000 })).toBeNull();
  });
  it("is null when the size unit is unknown — never guessed", () => {
    expect(landPricePerSf({ landPrice: 100000, landSizeValue: 1 })).toBeNull();
    expect(landSizeSf(1, "acres")).toBeNull();
  });
  it("rejects non-positive values", () => {
    expect(landPricePerSf({ landPrice: -1, landSizeValue: 1, landSizeUnit: "ac" })).toBeNull();
    expect(landPricePerSf({ landPrice: 100, landSizeValue: 0, landSizeUnit: "sf" })).toBeNull();
  });
});

describe("comps: building sale $/SF derivation", () => {
  it("derives $/SF on BUILDING sf, not land", () => {
    expect(buildingPricePerSf({ bldgPrice: 500000, bldgSizeSf: 25000 })).toBeCloseTo(20, 5);
  });
  it("is null unless both fields are present and positive", () => {
    expect(buildingPricePerSf({ bldgPrice: 500000 })).toBeNull();
    expect(buildingPricePerSf({ bldgSizeSf: 25000 })).toBeNull();
    expect(buildingPricePerSf({})).toBeNull();
  });
});

describe("comps: lease annual normalization", () => {
  it("passes an annual rate through unchanged", () => {
    expect(annualLeaseRate({ leaseRate: 7, leaseRatePeriod: "annual" })).toBe(7);
  });
  it("multiplies a monthly rate by 12 — exact math, never approximated", () => {
    expect(annualLeaseRate({ leaseRate: 0.6, leaseRatePeriod: "monthly" })).toBeCloseTo(7.2, 10);
  });
  it("refuses to guess a period — null, never assumed annual", () => {
    expect(annualLeaseRate({ leaseRate: 7 })).toBeNull();
    expect(annualLeaseRate({ leaseRate: 7, leaseRatePeriod: "weekly" })).toBeNull();
  });
  it("is null with no rate at all", () => {
    expect(annualLeaseRate({})).toBeNull();
  });
});

describe("comps: basis normalization never blends NNN and gross", () => {
  const comps = [
    { compType: "lease", leaseRate: 7, leaseRatePeriod: "annual", leaseRateExpense: "nnn" },
    { compType: "lease", leaseRate: 9, leaseRatePeriod: "annual", leaseRateExpense: "nnn" },
    { compType: "lease", leaseRate: 15, leaseRatePeriod: "annual", leaseRateExpense: "gross" },
    { compType: "lease", leaseRate: 1, leaseRatePeriod: "monthly", leaseRateExpense: "nnn" }, // -> 12 annual
    { compType: "lease", leaseRate: 5 }, // no period/basis -> unknown
    { compType: "land" }, // non-lease, ignored entirely
  ];

  it("computes separate NNN and gross averages, never one blended number", () => {
    const s = summarizeLeaseComps(comps);
    expect(s.nnn.count).toBe(3);
    expect(s.nnn.avg).toBeCloseTo((7 + 9 + 12) / 3, 10);
    expect(s.gross.count).toBe(1);
    expect(s.gross.avg).toBe(15);
    expect(s.unknownCount).toBe(1);
  });

  it("defaults the headline to annual NNN, and names the basis", () => {
    const s = summarizeLeaseComps(comps);
    expect(s.headlineBasis).toBe("nnn");
    expect(s.headline.avg).toBeCloseTo((7 + 9 + 12) / 3, 10);
  });

  it("falls back to gross as the headline only when no NNN comps exist", () => {
    const grossOnly = [{ compType: "lease", leaseRate: 15, leaseRatePeriod: "annual", leaseRateExpense: "gross" }];
    const s = summarizeLeaseComps(grossOnly);
    expect(s.headlineBasis).toBe("gross");
    expect(s.nnn).toBeNull();
  });

  it("reports no headline when nothing is known", () => {
    const s = summarizeLeaseComps([{ compType: "lease", leaseRate: 5 }]);
    expect(s.headlineBasis).toBeNull();
    expect(s.headline).toBeNull();
    expect(s.unknownCount).toBe(1);
  });

  it("handles an empty or missing list", () => {
    expect(summarizeLeaseComps([])).toEqual({ headlineBasis: null, headline: null, nnn: null, gross: null, unknownCount: 0 });
    expect(summarizeLeaseComps(undefined).headlineBasis).toBeNull();
  });
});

describe("comps: sale $/SF summary (land / building_sale)", () => {
  it("averages only comps with a computable $/SF, by type", () => {
    const comps = [
      { compType: "land", landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac" }, // 10
      { compType: "land", landPrice: 87120, landSizeValue: 1, landSizeUnit: "ac" }, // 2
      { compType: "land" }, // no price/size -> excluded
      { compType: "building_sale", bldgPrice: 1000000, bldgSizeSf: 50000 }, // 20
    ];
    const land = summarizeSaleComps(comps, "land");
    expect(land.count).toBe(2);
    expect(land.avg).toBeCloseTo(6, 5);
    const bldg = summarizeSaleComps(comps, "building_sale");
    expect(bldg.count).toBe(1);
    expect(bldg.avg).toBeCloseTo(20, 5);
  });
});

describe("comps: empty fields never render", () => {
  it("land: shows only $/SF + size when price is present but size isn't recorded as sf/ac split", () => {
    const rows = compFieldRows({ compType: "land", compDate: "2026-08-01" });
    const keys = rows.map((r) => r.key);
    expect(keys).not.toContain("psf");
    expect(keys).not.toContain("price");
    expect(keys).not.toContain("size");
    expect(keys).toEqual(["date"]); // notes empty too -> not present
  });

  it("land: a fully-populated comp shows every row, none blank", () => {
    const rows = compFieldRows({
      compType: "land", compDate: "2026-08-01", landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac", notes: "corner lot",
    });
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(["psf", "price", "size", "date", "notes"]);
    for (const r of rows) expect(r.value).not.toBe("");
  });

  it("lease: TI and term are independently optional", () => {
    const rateOnly = compFieldRows({ compType: "lease", compDate: "2026-08-01", leaseRate: 7, leaseRatePeriod: "annual", leaseRateExpense: "nnn" });
    expect(rateOnly.map((r) => r.key)).toEqual(["rate", "date"]);

    const withTi = compFieldRows({ compType: "lease", compDate: "2026-08-01", leaseRate: 7, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseTi: 5 });
    expect(withTi.map((r) => r.key)).toEqual(["rate", "ti", "date"]);
  });

  it("no comp type at all still only shows the required date, not blank rows for anything else", () => {
    const rows = compFieldRows({ compDate: "2026-08-01" });
    expect(rows).toEqual([{ key: "date", label: "Date", value: "2026-08-01" }]);
  });
});

describe("comps: headline label", () => {
  it("land / building_sale / lease each produce a compact label, with an honest fallback", () => {
    expect(compHeadline({ compType: "land", landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac" })).toBe("$10.00/SF land");
    expect(compHeadline({ compType: "land" })).toBe("Land comp");
    expect(compHeadline({ compType: "building_sale", bldgPrice: 1000000, bldgSizeSf: 50000 })).toBe("$20.00/SF sale");
    expect(compHeadline({ compType: "lease", leaseRate: 7.5, leaseRatePeriod: "annual", leaseRateExpense: "nnn" })).toBe("$7.50/SF/yr NNN");
    expect(compHeadline({ compType: "lease" })).toBe("Lease comp");
    expect(compHeadline({})).toBe("Comp");
  });
});

describe("comps: anchor validation — pin OR real parcel, never a drawn rectangle", () => {
  it("accepts a pin with coordinates", () => {
    expect(validAnchor({ kind: "pin", lat: 29.7, lon: -95.4 })).toBe(true);
  });
  it("accepts a parcel with an APN or a geometry snapshot", () => {
    expect(validAnchor({ kind: "parcel", lat: 29.7, lon: -95.4, parcelApn: "123" })).toBe(true);
    expect(validAnchor({ kind: "parcel", lat: 29.7, lon: -95.4, parcelGeom: { type: "Polygon" } })).toBe(true);
  });
  it("rejects a parcel anchor with no parcel identity at all", () => {
    expect(validAnchor({ kind: "parcel", lat: 29.7, lon: -95.4 })).toBe(false);
  });
  it("rejects missing/invalid coordinates or an unknown kind", () => {
    expect(validAnchor(null)).toBe(false);
    expect(validAnchor({ kind: "pin", lat: NaN, lon: -95.4 })).toBe(false);
    expect(validAnchor({ kind: "rectangle", lat: 29.7, lon: -95.4 })).toBe(false);
  });
});

describe("comps: create/edit validation", () => {
  it("requires a type, a date, and a valid anchor", () => {
    expect(validateComp({})).toEqual(["Pick a comp type.", "Date is required.", "Drop a pin or select a parcel."]);
    expect(validateComp({ compType: "land", compDate: "2026-08-01", anchor: { kind: "pin", lat: 1, lon: 1 } })).toEqual([]);
  });
});

describe("comps: row <-> model round-trip", () => {
  it("compToRow never includes user_id (server-stamped)", () => {
    const row = compToRow({ compType: "land", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 } });
    expect(row).not.toHaveProperty("user_id");
    expect(row.comp_type).toBe("land");
    expect(row.anchor_kind).toBe("pin");
    expect(row.lat).toBe(29.7);
  });

  it("rowToComp coerces numeric-as-string PostgREST fields back to numbers", () => {
    const comp = rowToComp({
      id: "c1", user_id: "u1", team_id: null, project_id: null,
      comp_type: "land", comp_date: "2026-08-01", title: "", notes: "",
      anchor_kind: "pin", lat: "29.7", lon: "-95.4", county: null, parcel_apn: null, parcel_geom: null,
      land_price: "435600", land_size_value: "1", land_size_unit: "ac",
      bldg_price: null, bldg_size_sf: null,
      lease_rate: null, lease_rate_period: null, lease_rate_expense: null, lease_ti: null, lease_term: null,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    });
    expect(comp.anchor.lat).toBe(29.7);
    expect(comp.landPrice).toBe(435600);
    expect(landPricePerSf(comp)).toBeCloseTo(10, 5);
  });
});
