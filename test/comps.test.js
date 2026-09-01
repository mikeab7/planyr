import { describe, it, expect } from "vitest";
import {
  landSizeSf, landPricePerSf, buildingPricePerSf, annualLeaseRate, leaseTotalAnnualRent,
  summarizeLeaseComps, summarizeSaleComps, compsSummaryBits, compFieldRows, compHeadline, partyLabels,
  validAnchor, validateComp, rowToComp, compToRow,
  landPricePerAreaUnit, parseLeaseTermYears, netEffectiveLeaseRate,
  anchorCountyFlag, resolveCapTriangle, emptyDraft, draftToComp, compToDraft,
} from "../src/shared/comps/lib/comps.js";
import { collectPartyNames, matchPartyNames } from "../src/shared/comps/lib/partySuggest.js";

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

  it("without any leaseSizeSf, groups stay unweighted and say so (unchanged from before B647824)", () => {
    const s = summarizeLeaseComps(comps);
    expect(s.nnn.weighted).toBe(false);
    expect(s.nnn.sizeMissingCount).toBe(3);
    expect(s.headline.weighted).toBe(false);
  });

  it("weights the average by leased SF when EVERY comp in the group has it — a big cheap deal and a small expensive one average toward the big one's rate", () => {
    const sized = [
      { compType: "lease", leaseRate: 6, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 90000 },
      { compType: "lease", leaseRate: 10, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 10000 },
    ];
    const s = summarizeLeaseComps(sized);
    // unweighted mean would be 8; SF-weighted should pull toward the 90k-SF deal's rate of 6.
    const expected = (6 * 90000 + 10 * 10000) / 100000;
    expect(expected).toBeCloseTo(6.4, 5);
    expect(s.nnn.weighted).toBe(true);
    expect(s.nnn.sizeMissingCount).toBe(0);
    expect(s.nnn.avg).toBeCloseTo(expected, 10);
  });

  it("normalizes a monthly rate to annual BEFORE weighting by size", () => {
    const sized = [
      { compType: "lease", leaseRate: 1, leaseRatePeriod: "monthly", leaseRateExpense: "nnn", leaseSizeSf: 10000 }, // -> 12/yr
      { compType: "lease", leaseRate: 12, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 10000 },
    ];
    const s = summarizeLeaseComps(sized);
    expect(s.nnn.weighted).toBe(true);
    expect(s.nnn.avg).toBeCloseTo(12, 10);
  });

  it("falls back to an unweighted average, explicitly flagged, when ONLY SOME comps in the group have size — never silently mixes weighted and unweighted", () => {
    const mixed = [
      { compType: "lease", leaseRate: 6, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 90000 },
      { compType: "lease", leaseRate: 10, leaseRatePeriod: "annual", leaseRateExpense: "nnn" }, // no size
    ];
    const s = summarizeLeaseComps(mixed);
    expect(s.nnn.weighted).toBe(false);
    expect(s.nnn.sizeMissingCount).toBe(1);
    expect(s.nnn.avg).toBeCloseTo((6 + 10) / 2, 10); // plain mean, not SF-weighted
  });

  it("a non-positive or zero leaseSizeSf counts as missing, never as a zero weight", () => {
    const zeroSize = [
      { compType: "lease", leaseRate: 6, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 0 },
      { compType: "lease", leaseRate: 10, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 10000 },
    ];
    const s = summarizeLeaseComps(zeroSize);
    expect(s.nnn.weighted).toBe(false);
    expect(s.nnn.sizeMissingCount).toBe(1);
  });

  it("NNN and gross groups are weighted independently", () => {
    const comps2 = [
      { compType: "lease", leaseRate: 6, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 90000 },
      { compType: "lease", leaseRate: 10, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 10000 },
      { compType: "lease", leaseRate: 20, leaseRatePeriod: "annual", leaseRateExpense: "gross" }, // no size
    ];
    const s = summarizeLeaseComps(comps2);
    expect(s.nnn.weighted).toBe(true);
    expect(s.gross.weighted).toBe(false);
    expect(s.gross.sizeMissingCount).toBe(1);
  });
});

describe("comps: leaseTotalAnnualRent — the reason a lease comp needs a size at all", () => {
  it("is null unless both an annual-normalizable rate AND a size are present", () => {
    expect(leaseTotalAnnualRent({ leaseRate: 7, leaseRatePeriod: "annual", leaseSizeSf: 10000 })).toBeCloseTo(70000, 5);
    expect(leaseTotalAnnualRent({ leaseRate: 7, leaseRatePeriod: "annual" })).toBeNull();
    expect(leaseTotalAnnualRent({ leaseSizeSf: 10000 })).toBeNull();
    expect(leaseTotalAnnualRent({})).toBeNull();
  });
  it("normalizes a monthly rate to annual first", () => {
    expect(leaseTotalAnnualRent({ leaseRate: 1, leaseRatePeriod: "monthly", leaseSizeSf: 10000 })).toBeCloseTo(120000, 5);
  });
});

describe("comps: landPricePerAreaUnit — $/AC or $/SF, in the size's OWN recorded unit", () => {
  it("an acre-recorded land comp reads as a genuine $/ACRE figure — NOT converted to SF first", () => {
    // 100 acres at $850,000 -> $8,500/AC. landPricePerSf would instead report a tiny $/SF number
    // by converting through 43,560 SF/acre — a real, different figure, not this one.
    expect(landPricePerAreaUnit({ compType: "land", landPrice: 850000, landSizeValue: 100, landSizeUnit: "ac" }))
      .toEqual({ value: 8500, unit: "ac" });
  });
  it("an SF-recorded land comp reads as $/SF", () => {
    expect(landPricePerAreaUnit({ compType: "land", landPrice: 100000, landSizeValue: 10000, landSizeUnit: "sf" }))
      .toEqual({ value: 10, unit: "sf" });
  });
  it("null when price or size is missing", () => {
    expect(landPricePerAreaUnit({ compType: "land", landPrice: 100000 })).toBeNull();
    expect(landPricePerAreaUnit({ compType: "land", landSizeValue: 10 })).toBeNull();
  });
});

describe("comps: parseLeaseTermYears", () => {
  it("reads this app's own normalized term strings", () => {
    expect(parseLeaseTermYears("126 mo")).toBeCloseTo(10.5, 10);
    expect(parseLeaseTermYears("5 yrs")).toBe(5);
  });
  it("loosely accepts a hand-typed variant", () => {
    expect(parseLeaseTermYears("10 years")).toBe(10);
    expect(parseLeaseTermYears("18 months")).toBeCloseTo(1.5, 10);
  });
  it("is null with no recognizable duration", () => {
    expect(parseLeaseTermYears("")).toBeNull();
    expect(parseLeaseTermYears("TBD")).toBeNull();
  });
});

describe("comps: netEffectiveLeaseRate — the number brokers actually compare", () => {
  it("equals the face rate with no concessions at all (flat, no escalation)", () => {
    expect(netEffectiveLeaseRate({ compType: "lease", leaseRate: 10, leaseRatePeriod: "annual", leaseTerm: "5 yrs" })).toBeCloseTo(10, 10);
  });
  it("free rent alone drags it below face — 6mo free out of a 5yr term", () => {
    expect(netEffectiveLeaseRate({ compType: "lease", leaseRate: 10, leaseRatePeriod: "annual", leaseTerm: "5 yrs", leaseFreeRentMonths: 6 })).toBeCloseTo(9, 10);
  });
  it("Michael's exact deal — rate, term, escalation, free rent AND TI all combined", () => {
    // Hand-verified independently: face $7.80/SF/yr (monthly $0.65 x12), 126mo=10.5yr term,
    // 3.5% annual escalation compounding once per full year (partial final year weighted),
    // 6mo free rent valued at face, $13/SF TI — net effective ≈ $7.63/SF/yr, BELOW face because
    // the free-rent+TI drag outweighs the modest escalation benefit over the term.
    const net = netEffectiveLeaseRate({
      compType: "lease", leaseRate: 0.65, leaseRatePeriod: "monthly", leaseRateExpense: "nnn",
      leaseTerm: "126 mo", leaseEscalationPct: 3.5, leaseFreeRentMonths: 6, leaseTi: 13,
    });
    expect(net).toBeCloseTo(7.629, 3);
    expect(net).toBeLessThan(7.8); // below face
  });
  it("null for a non-lease comp, or a lease missing rate/period/term", () => {
    expect(netEffectiveLeaseRate({ compType: "land" })).toBeNull();
    expect(netEffectiveLeaseRate({ compType: "lease", leaseRate: 10, leaseTerm: "5 yrs" })).toBeNull(); // no period
    expect(netEffectiveLeaseRate({ compType: "lease", leaseRate: 10, leaseRatePeriod: "annual" })).toBeNull(); // no term
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

describe("comps: NEW-1 rail summary strip — lease dropped, sale averages kept", () => {
  it("includes a land avg bit when land comps have a computable $/SF", () => {
    const comps = [{ compType: "land", landPrice: 435600, landSizeValue: 1, landSizeUnit: "ac" }];
    expect(compsSummaryBits(comps)).toEqual(["Land avg $10.00/SF (1)"]);
  });

  it("includes a building-sale avg bit when building-sale comps have a computable $/SF", () => {
    const comps = [{ compType: "building_sale", bldgPrice: 1000000, bldgSizeSf: 50000 }];
    expect(compsSummaryBits(comps)).toEqual(["Bldg sale avg $20.00/SF (1)"]);
  });

  it("never emits a lease-derived bit, even with lease comps present — the rail lists comps, it is not a summary surface", () => {
    const comps = [
      { compType: "lease", leaseRate: 0.65, leaseRatePeriod: "monthly", leaseRateExpense: "nnn", leaseSizeSf: 10000 },
    ];
    expect(compsSummaryBits(comps)).toEqual([]);
  });

  it("returns an empty array when there is nothing to summarize", () => {
    expect(compsSummaryBits([])).toEqual([]);
    expect(compsSummaryBits(undefined)).toEqual([]);
  });
});

describe("comps: NEW-2 free rent + NEW-3 face label + NEW-5 currency formatting", () => {
  it("free rent is independently optional and renders next to term", () => {
    const withTerm = compFieldRows({
      compType: "lease", compDate: "2026-08-01", leaseRate: 7, leaseRatePeriod: "annual",
      leaseRateExpense: "nnn", leaseTerm: "126 mo",
    });
    expect(withTerm.map((r) => r.key)).not.toContain("freeRent");

    const withFreeRent = compFieldRows({
      compType: "lease", compDate: "2026-08-01", leaseRate: 7, leaseRatePeriod: "annual",
      leaseRateExpense: "nnn", leaseTerm: "126 mo", leaseFreeRentMonths: 6,
    });
    const keys = withFreeRent.map((r) => r.key);
    const termIdx = keys.indexOf("term");
    const freeRentIdx = keys.indexOf("freeRent");
    expect(freeRentIdx).toBeGreaterThan(-1);
    expect(freeRentIdx).toBe(termIdx + 1); // immediately after term
    expect(withFreeRent.find((r) => r.key === "freeRent").value).toBe("6 mo");
  });

  it("zero free rent still renders (a real value, not treated as empty)", () => {
    const rows = compFieldRows({ compType: "lease", compDate: "2026-08-01", leaseFreeRentMonths: 0 });
    expect(rows.map((r) => r.key)).toContain("freeRent");
  });

  it("total annual rent is labeled FACE and formatted as whole-dollar currency, never a raw float", () => {
    const rows = compFieldRows({
      compType: "lease", compDate: "2026-08-01", leaseRate: 0.65, leaseRatePeriod: "monthly",
      leaseRateExpense: "nnn", leaseSizeSf: 613208,
    });
    const totalRow = rows.find((r) => r.key === "totalRent");
    expect(totalRow.label).toMatch(/face/i);
    expect(totalRow.value).toBe("$4,783,022"); // .65 * 613208 * 12 = 4,783,022.4 -> whole dollars, no trailing float
    expect(totalRow.value).not.toMatch(/\.\d/);
  });
});

describe("comps: NEW-7(amended) party fields — one shared axis, three label sets", () => {
  it("partyLabels names the axis per type: lease=Owner/Developer+Tenant, land=Seller+Buyer, building_sale=Seller+Buyer/User", () => {
    expect(partyLabels("lease")).toEqual({ provider: "Owner/Developer", acquirer: "Tenant" });
    expect(partyLabels("land")).toEqual({ provider: "Seller", acquirer: "Buyer" });
    expect(partyLabels("building_sale")).toEqual({ provider: "Seller", acquirer: "Buyer/User" });
  });

  it("render near the top (before the type-specific money block) on all three comp types, independently optional", () => {
    for (const compType of ["lease", "land", "building_sale"]) {
      const none = compFieldRows({ compType, compDate: "2026-08-01" });
      expect(none.map((r) => r.key)).not.toContain("partyProvider");
      expect(none.map((r) => r.key)).not.toContain("partyAcquirer");

      const withParties = compFieldRows({ compType, compDate: "2026-08-01", partyProvider: "Core5", partyAcquirer: "Acme Logistics" });
      const keys = withParties.map((r) => r.key);
      expect(keys[0]).toBe("partyProvider");
      expect(keys[1]).toBe("partyAcquirer");
      expect(withParties.find((r) => r.key === "partyProvider").value).toBe("Core5");
      expect(withParties.find((r) => r.key === "partyAcquirer").value).toBe("Acme Logistics");
    }
  });

  it("the row label follows the comp's own type", () => {
    const lease = compFieldRows({ compType: "lease", compDate: "2026-08-01", partyProvider: "Core5", partyAcquirer: "Acme" });
    expect(lease.find((r) => r.key === "partyProvider").label).toBe("Owner/Developer");
    expect(lease.find((r) => r.key === "partyAcquirer").label).toBe("Tenant");

    const land = compFieldRows({ compType: "land", compDate: "2026-08-01", partyProvider: "Jane Doe", partyAcquirer: "Core5" });
    expect(land.find((r) => r.key === "partyProvider").label).toBe("Seller");
    expect(land.find((r) => r.key === "partyAcquirer").label).toBe("Buyer");

    const bldg = compFieldRows({ compType: "building_sale", compDate: "2026-08-01", partyProvider: "Jane Doe", partyAcquirer: "Core5" });
    expect(bldg.find((r) => r.key === "partyAcquirer").label).toBe("Buyer/User");
  });

  it("one party present without the other still renders — independently optional", () => {
    const providerOnly = compFieldRows({ compType: "lease", compDate: "2026-08-01", partyProvider: "Core5" });
    expect(providerOnly.map((r) => r.key)).toContain("partyProvider");
    expect(providerOnly.map((r) => r.key)).not.toContain("partyAcquirer");
  });
});

describe("comps: NEW-8 party name suggestions — loose match, never a forced/normalized value", () => {
  it("collectPartyNames pools BOTH sides across every comp type, exact strings, first-seen order, no dupes", () => {
    const comps = [
      { compType: "lease", partyProvider: "Core5", partyAcquirer: "Acme Logistics" },
      { compType: "building_sale", partyProvider: "Jane Doe", partyAcquirer: "Core5" }, // Core5 repeats -> not duplicated
      { compType: "land", partyProvider: "Core5 Industrial Partners", partyAcquirer: null }, // distinct spelling, kept separate
      { compType: "land", partyProvider: "", partyAcquirer: "  " }, // blank/whitespace-only -> excluded
    ];
    expect(collectPartyNames(comps)).toEqual(["Core5", "Acme Logistics", "Jane Doe", "Core5 Industrial Partners"]);
  });

  it("matchPartyNames is case- and whitespace-insensitive substring matching, never a forced/exact match", () => {
    const candidates = ["Core5", "Core 5", "Core5 Industrial Partners", "Acme Logistics"];
    expect(matchPartyNames("core5", candidates)).toEqual(["Core5", "Core5 Industrial Partners"]);
    expect(matchPartyNames("  CORE 5  ", candidates)).toEqual(["Core 5"]);
    expect(matchPartyNames("acme", candidates)).toEqual(["Acme Logistics"]);
  });

  it("never merges or rewrites — near-duplicate spellings stay distinct entries", () => {
    const candidates = ["Core5", "Core 5", "Core5 Industrial Partners"];
    const matches = matchPartyNames("core", candidates);
    expect(matches).toHaveLength(3); // all three surface each other; none collapsed into one
  });

  it("an empty query suggests nothing (there is nothing to narrow yet)", () => {
    expect(matchPartyNames("", ["Core5"])).toEqual([]);
    expect(matchPartyNames("   ", ["Core5"])).toEqual([]);
  });

  it("a brand-new name that matches nothing returns no suggestions — never blocks free text", () => {
    expect(matchPartyNames("Brand New Co", ["Core5", "Acme Logistics"])).toEqual([]);
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => `Party ${i}`);
    expect(matchPartyNames("Party", many, 5)).toHaveLength(5);
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

  it("lease: leased SF and its derived total annual rent are independently optional, and never render blank", () => {
    const noSize = compFieldRows({ compType: "lease", compDate: "2026-08-01", leaseRate: 7, leaseRatePeriod: "annual", leaseRateExpense: "nnn" });
    expect(noSize.map((r) => r.key)).not.toContain("size");
    expect(noSize.map((r) => r.key)).not.toContain("totalRent");

    const withSize = compFieldRows({ compType: "lease", compDate: "2026-08-01", leaseRate: 7, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 10000 });
    const keys = withSize.map((r) => r.key);
    expect(keys).toContain("size");
    expect(keys).toContain("totalRent");
    const sizeRow = withSize.find((r) => r.key === "size");
    expect(sizeRow.value).toBe("10,000 SF");
    const rentRow = withSize.find((r) => r.key === "totalRent");
    expect(rentRow.value).toBe("$70,000");

    // size with no usable rate: still shows the size, never a total rent it can't compute.
    const sizeNoRate = compFieldRows({ compType: "lease", compDate: "2026-08-01", leaseSizeSf: 10000 });
    const keys2 = sizeNoRate.map((r) => r.key);
    expect(keys2).toContain("size");
    expect(keys2).not.toContain("totalRent");
  });

  it("no comp type at all still only shows the required date, not blank rows for anything else", () => {
    const rows = compFieldRows({ compDate: "2026-08-01" });
    expect(rows).toEqual([{ key: "date", label: "Date", value: "08/01/26" }]);
  });
});

// B986096-HARDENING-8 (owner rule, "change the date formatting to something people would
// normally see") — mm/dd/yy, matching the Schedule task report (08/20/26), never the raw ISO
// string. Supersedes the earlier NEW-6 convention (a longer "Aug 28, 2026" form, still used by
// FileBrowser/SiteReviewModal/MapFinder — this app has two date conventions now, not one; comps
// follows the owner's explicit instruction for this feature specifically.
describe("comps: date rendering — mm/dd/yy, never raw ISO", () => {
  it("compFieldRows formats the date as mm/dd/yy, not a raw ISO string", () => {
    const rows = compFieldRows({ compType: "land", compDate: "2026-08-28" });
    expect(rows.find((r) => r.key === "date").value).toBe("08/28/26");
  });

  it("parses the date-only string by its Y/M/D parts, never via a UTC Date() that could shift the day", () => {
    // A date near a US-timezone UTC boundary is the case that breaks a naive `new Date(iso)`.
    const rows = compFieldRows({ compType: "land", compDate: "2026-01-01" });
    expect(rows.find((r) => r.key === "date").value).toBe("01/01/26");
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
  it("accepts a site_plan anchor with an overlay id and an image-pixel point (B848848)", () => {
    expect(validAnchor({
      kind: "site_plan", lat: 29.7, lon: -95.4,
      sitePlanOverlayId: "ov-1", sitePlanPoint: { x: 120, y: 340 },
    })).toBe(true);
  });
  it("rejects a site_plan anchor missing the overlay id or the point", () => {
    expect(validAnchor({ kind: "site_plan", lat: 29.7, lon: -95.4, sitePlanPoint: { x: 1, y: 1 } })).toBe(false);
    expect(validAnchor({ kind: "site_plan", lat: 29.7, lon: -95.4, sitePlanOverlayId: "ov-1" })).toBe(false);
    expect(validAnchor({ kind: "site_plan", lat: 29.7, lon: -95.4, sitePlanOverlayId: "ov-1", sitePlanPoint: {} })).toBe(false);
  });
  it("compToRow/rowToComp round-trip a site_plan anchor", () => {
    const row = compToRow({
      compType: "lease", compDate: "2026-08-01",
      anchor: { kind: "site_plan", lat: 29.7, lon: -95.4, sitePlanOverlayId: "ov-1", sitePlanPoint: { x: 120, y: 340 } },
    });
    expect(row.anchor_kind).toBe("site_plan");
    expect(row.site_plan_overlay_id).toBe("ov-1");
    expect(row.site_plan_point).toEqual({ x: 120, y: 340 });
    const comp = rowToComp({
      id: "c1", user_id: "u1", comp_type: "lease", comp_date: "2026-08-01",
      anchor_kind: "site_plan", lat: "29.7", lon: "-95.4", county: null, parcel_apn: null, parcel_geom: null,
      site_plan_overlay_id: "ov-1", site_plan_point: { x: 120, y: 340 },
    });
    expect(comp.anchor).toEqual({
      kind: "site_plan", lat: 29.7, lon: -95.4, county: null, parcelApn: null, parcelGeom: null,
      sitePlanOverlayId: "ov-1", sitePlanPoint: { x: 120, y: 340 },
    });
  });
});

describe("comps: create/edit validation", () => {
  it("requires a type, a date, and a valid anchor", () => {
    expect(validateComp({})).toEqual(["Pick a comp type.", "Executed date is required.", "Drop a pin or select a parcel."]);
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
      lease_size_sf: null,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    });
    expect(comp.anchor.lat).toBe(29.7);
    expect(comp.landPrice).toBe(435600);
    expect(landPricePerSf(comp)).toBeCloseTo(10, 5);
  });

  it("lease_size_sf round-trips like every other numeric-as-string PostgREST field", () => {
    const row = compToRow({
      compType: "lease", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 },
      leaseRate: 7, leaseRatePeriod: "annual", leaseRateExpense: "nnn", leaseSizeSf: 10000,
    });
    expect(row.lease_size_sf).toBe(10000);

    const comp = rowToComp({
      id: "c1", user_id: "u1", team_id: null, project_id: null,
      comp_type: "lease", comp_date: "2026-08-01", title: "", notes: "",
      anchor_kind: "pin", lat: "29.7", lon: "-95.4", county: null, parcel_apn: null, parcel_geom: null,
      land_price: null, land_size_value: null, land_size_unit: null,
      bldg_price: null, bldg_size_sf: null,
      lease_rate: "7", lease_rate_period: "annual", lease_rate_expense: "nnn", lease_ti: null, lease_term: null,
      lease_size_sf: "10000",
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    });
    expect(comp.leaseSizeSf).toBe(10000);
  });

  it("compToRow omits lease_size_sf as null when absent, never coerced to 0", () => {
    const row = compToRow({ compType: "lease", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 } });
    expect(row.lease_size_sf).toBeNull();
  });

  it("lease_free_rent_months round-trips like every other lease column", () => {
    const row = compToRow({
      compType: "lease", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 },
      leaseFreeRentMonths: 6,
    });
    expect(row.lease_free_rent_months).toBe(6);

    const comp = rowToComp({
      id: "c1", user_id: "u1", team_id: null, project_id: null,
      comp_type: "lease", comp_date: "2026-08-01", title: "", notes: "",
      anchor_kind: "pin", lat: "29.7", lon: "-95.4", county: null, parcel_apn: null, parcel_geom: null,
      land_price: null, land_size_value: null, land_size_unit: null,
      bldg_price: null, bldg_size_sf: null,
      lease_rate: "7", lease_rate_period: "annual", lease_rate_expense: "nnn", lease_ti: null, lease_term: null,
      lease_size_sf: null, lease_free_rent_months: "6", comp_party_provider: null, comp_party_acquirer: null,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    });
    expect(comp.leaseFreeRentMonths).toBe(6);
  });

  it("comp_party_provider / comp_party_acquirer round-trip on any comp type — a shared axis, not a lease-only pair", () => {
    const row = compToRow({
      compType: "building_sale", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 },
      partyProvider: "Jane Doe", partyAcquirer: "Core5",
    });
    expect(row.comp_party_provider).toBe("Jane Doe");
    expect(row.comp_party_acquirer).toBe("Core5");

    const comp = rowToComp({
      id: "c1", user_id: "u1", team_id: null, project_id: null,
      comp_type: "building_sale", comp_date: "2026-08-01", title: "", notes: "",
      anchor_kind: "pin", lat: "29.7", lon: "-95.4", county: null, parcel_apn: null, parcel_geom: null,
      land_price: null, land_size_value: null, land_size_unit: null,
      bldg_price: null, bldg_size_sf: null,
      lease_rate: null, lease_rate_period: null, lease_rate_expense: null, lease_ti: null, lease_term: null,
      lease_size_sf: null, lease_free_rent_months: null, comp_party_provider: "Jane Doe", comp_party_acquirer: "Core5",
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    });
    expect(comp.partyProvider).toBe("Jane Doe");
    expect(comp.partyAcquirer).toBe("Core5");
  });

  it("compToRow sends null (never omits) for the new columns when absent, matching every other optional field", () => {
    const row = compToRow({ compType: "lease", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 } });
    expect(row.lease_free_rent_months).toBeNull();
    expect(row.comp_party_provider).toBeNull();
    expect(row.comp_party_acquirer).toBeNull();
  });
});

describe("comps: anchorCountyFlag — 'log it and say so' for a county that couldn't be resolved", () => {
  it("is null with no anchor position at all — nothing to flag, the row is simply unlocated", () => {
    expect(anchorCountyFlag(null)).toBeNull();
    expect(anchorCountyFlag({ kind: "pin" })).toBeNull();
  });
  it("is null once a county IS present, whatever the anchor kind", () => {
    expect(anchorCountyFlag({ kind: "pin", lat: 29.7, lon: -95.4, county: "harris" })).toBeNull();
    expect(anchorCountyFlag({ kind: "parcel", lat: 29.7, lon: -95.4, county: "txgio_statewide" })).toBeNull();
  });
  it("flags a positioned anchor whose county lookup failed — soft, non-blocking, names why it matters", () => {
    const flag = anchorCountyFlag({ kind: "pin", lat: 29.7, lon: -95.4, county: null });
    expect(flag.level).toBe("soft");
    expect(flag.reason).toMatch(/county/i);
    expect(flag.reason).toMatch(/grouped and filtered/i);
  });
});

describe("comps: resolveCapTriangle — enter any two of Price/NOI/Cap, derive the third", () => {
  it("derives cap from price + NOI, as a decimal fraction (never a percentage number)", () => {
    const tri = resolveCapTriangle({ bldgPrice: 38000000, bldgNoi: 2185000 });
    expect(tri.price).toEqual({ value: 38000000, derived: false });
    expect(tri.noi).toEqual({ value: 2185000, derived: false });
    expect(tri.capRate.derived).toBe(true);
    expect(tri.capRate.value).toBeCloseTo(0.0575, 6);
    expect(tri.disagreement).toBeNull();
  });
  it("derives NOI from price + cap", () => {
    const tri = resolveCapTriangle({ bldgPrice: 10000000, bldgCapRate: 0.06 });
    expect(tri.noi.derived).toBe(true);
    expect(tri.noi.value).toBeCloseTo(600000, 5);
    expect(tri.price).toEqual({ value: 10000000, derived: false });
  });
  it("derives price from NOI + cap", () => {
    const tri = resolveCapTriangle({ bldgNoi: 600000, bldgCapRate: 0.06 });
    expect(tri.price.derived).toBe(true);
    expect(tri.price.value).toBeCloseTo(10000000, 2);
  });
  it("derives nothing with fewer than two given — never guesses from one figure", () => {
    const tri = resolveCapTriangle({ bldgPrice: 10000000 });
    expect(tri.price).toEqual({ value: 10000000, derived: false });
    expect(tri.noi).toEqual({ value: null, derived: false });
    expect(tri.capRate).toEqual({ value: null, derived: false });
    expect(resolveCapTriangle({})).toEqual({
      price: { value: null, derived: false }, noi: { value: null, derived: false },
      capRate: { value: null, derived: false }, disagreement: null,
    });
  });
  it("with all three given and reconciling, nothing is derived and there is no disagreement", () => {
    const tri = resolveCapTriangle({ bldgPrice: 38000000, bldgNoi: 2185000, bldgCapRate: 0.0575 });
    expect(tri.price.derived).toBe(false);
    expect(tri.noi.derived).toBe(false);
    expect(tri.capRate.derived).toBe(false);
    expect(tri.disagreement).toBeNull();
  });
  it("with all three given and a GENUINE mismatch, flags it rather than silently recomputing", () => {
    // Stated cap 5.75%; NOI/price actually implies 6.5% — past ordinary rounding noise.
    const tri = resolveCapTriangle({ bldgPrice: 10000000, bldgNoi: 650000, bldgCapRate: 0.0575 });
    expect(tri.capRate.value).toBeCloseTo(0.0575, 6); // the TYPED value is never overwritten
    expect(tri.disagreement).not.toBeNull();
    expect(tri.disagreement.statedCapRate).toBeCloseTo(0.0575, 6);
    expect(tri.disagreement.impliedCapRate).toBeCloseTo(0.065, 6);
  });
  it("tolerates ordinary broker-rounding noise without flagging a disagreement", () => {
    // A cap stated to 2 decimals (5.75%) beside a price/NOI whose exact ratio is 5.7538...% —
    // well inside the 5bp tolerance, not a real mismatch.
    const tri = resolveCapTriangle({ bldgPrice: 10000000, bldgNoi: 575380, bldgCapRate: 0.0575 });
    expect(tri.disagreement).toBeNull();
  });
  it("ignores non-positive/garbage inputs the same way every other comps derivation does", () => {
    expect(resolveCapTriangle({ bldgPrice: -1, bldgNoi: 500000 }).price).toEqual({ value: null, derived: false });
    expect(resolveCapTriangle({ bldgPrice: 0, bldgCapRate: 0.06 }).price).toEqual({ value: null, derived: false });
  });
});

describe("comps: the cap triangle threaded through draft <-> comp <-> row", () => {
  it("draftToComp back-fills the third field so a save never leaves two of three populated", () => {
    const draft = { ...emptyDraft(null), compType: "building_sale", compDate: "2026-08-01", bldgPrice: "38000000", bldgNoi: "2185000" };
    const comp = draftToComp(draft);
    expect(comp.bldgPrice).toBe(38000000);
    expect(comp.bldgNoi).toBe(2185000);
    expect(comp.bldgCapRate).toBeCloseTo(0.0575, 6);
  });
  it("draftToComp leaves a GENUINE three-way disagreement exactly as typed — never overwrites it", () => {
    const draft = { ...emptyDraft(null), compType: "building_sale", compDate: "2026-08-01", bldgPrice: "10000000", bldgNoi: "650000", bldgCapRate: "5.75" };
    // (the sheet column stores the fraction directly; simulate that here)
    draft.bldgCapRate = "0.0575";
    const comp = draftToComp(draft);
    expect(comp.bldgCapRate).toBeCloseTo(0.0575, 6); // untouched
    expect(comp.bldgNoi).toBe(650000); // untouched
  });
  it("draftToComp does not touch bldgPrice/bldgNoi/bldgCapRate for a land or lease draft", () => {
    const land = { ...emptyDraft(null), compType: "land", compDate: "2026-08-01" };
    expect(draftToComp(land).bldgPrice).toBeNull();
    expect(draftToComp(land).bldgNoi).toBeNull();
    expect(draftToComp(land).bldgCapRate).toBeNull();
  });
  it("bldg_noi / bldg_cap_rate round-trip through compToRow / rowToComp like every other numeric column", () => {
    const row = compToRow({
      compType: "building_sale", compDate: "2026-08-01", anchor: { kind: "pin", lat: 29.7, lon: -95.4 },
      bldgNoi: 2185000, bldgCapRate: 0.0575,
    });
    expect(row.bldg_noi).toBe(2185000);
    expect(row.bldg_cap_rate).toBeCloseTo(0.0575, 6);

    const comp = rowToComp({
      id: "c1", user_id: "u1", team_id: null, project_id: null,
      comp_type: "building_sale", comp_date: "2026-08-01", title: "", notes: "",
      anchor_kind: "pin", lat: "29.7", lon: "-95.4", county: null, parcel_apn: null, parcel_geom: null,
      land_price: null, land_size_value: null, land_size_unit: null,
      bldg_price: "38000000", bldg_size_sf: null, bldg_noi: "2185000", bldg_cap_rate: "0.0575",
      lease_rate: null, lease_rate_period: null, lease_rate_expense: null, lease_ti: null, lease_term: null,
      lease_size_sf: null, lease_free_rent_months: null, comp_party_provider: null, comp_party_acquirer: null,
      created_at: "2026-08-01T00:00:00Z", updated_at: "2026-08-01T00:00:00Z",
    });
    expect(comp.bldgNoi).toBe(2185000);
    expect(comp.bldgCapRate).toBeCloseTo(0.0575, 6);
  });
  it("compToDraft round-trips bldgNoi/bldgCapRate as strings, same shape as every other numeric field", () => {
    const draft = compToDraft({ id: "c1", compType: "building_sale", bldgNoi: 2185000, bldgCapRate: 0.0575 });
    expect(draft.bldgNoi).toBe("2185000");
    expect(draft.bldgCapRate).toBe("0.0575");
  });
  it("compFieldRows shows NOI and Cap on a building sale, cap rendered as a percentage", () => {
    const rows = compFieldRows({ compType: "building_sale", compDate: "2026-08-01", bldgPrice: 38000000, bldgNoi: 2185000, bldgCapRate: 0.0575 });
    const noi = rows.find((r) => r.key === "noi");
    const cap = rows.find((r) => r.key === "capRate");
    expect(noi.value).toMatch(/2,185,000/);
    expect(cap.value).toBe("5.75%");
  });
});
