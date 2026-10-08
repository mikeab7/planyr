import { describe, it, expect } from "vitest";
import {
  termToMonths, termForDisplay, termOtherReading, priceReadback, footerReadback, saveState,
  moreDetailFields, mobilePartyLabels, compDateLabel, mobileCol,
} from "../src/shared/comps/lib/compMobileSheetModel.js";
import { applyCellEdit } from "../src/shared/comps/lib/compSheetColumns.js";
import { emptyDraft } from "../src/shared/comps/lib/comps.js";

const d = (compType, o = {}) => ({ ...emptyDraft(null), compType, ...o });
const PIN = { kind: "pin", lat: 1, lon: 2 };

describe("NEW-2 phone sheet — Term entry unit", () => {
  it("5 with `years` selected commits leaseTerm as 60 months (red-proof of the ×12)", () => {
    const col = mobileCol("leaseTerm");
    const committed = termToMonths("5", "years");
    expect(committed).toBe("60");
    expect(col.getValue(applyCellEdit(col, d("lease"), committed))).toBe("60");
    // …and the SAME keystrokes in `months` stay 5 — the toggle is what changes the answer
    expect(termToMonths("5", "months")).toBe("5");
  });
  it("fractional years round to 2 decimals, junk and empty commit nothing", () => {
    expect(termToMonths("5.3", "years")).toBe("63.6");
    expect(termToMonths("", "years")).toBe("");
    expect(termToMonths("abc", "years")).toBe("");
  });
  it("display: months by default, years divides; the other reading is quiet", () => {
    expect(termForDisplay("64", "months")).toBe("64");
    expect(termForDisplay("60", "years")).toBe("5");
    expect(termForDisplay("", "years")).toBe("");
    expect(termOtherReading("64", "months")).toBe("64 mo = 5.3 yr");
    expect(termOtherReading("60", "years")).toBe("5 yr = 60 mo");
    expect(termOtherReading("", "months")).toBe(null);
  });
});

describe("NEW-2 — land size unit toggle round-trips landSizeUnit", () => {
  it("AC <-> SF through the real column setter", () => {
    const col = mobileCol("landSizeUnit");
    const base = d("land", { landSizeUnit: "ac" });
    const sf = applyCellEdit(col, base, "sf");
    expect(sf.landSizeUnit).toBe("sf");
    expect(applyCellEdit(col, sf, "ac").landSizeUnit).toBe("ac");
  });
});

describe("NEW-2 — price read-back", () => {
  it("land entered in AC: $/AC first, then $/SF", () => {
    expect(priceReadback(d("land", { landSizeValue: "42.5", landSizeUnit: "ac", landPrice: "9250000" })))
      .toBe("= $217,647 /AC · $5.00 /SF");
  });
  it("land entered in SF: $/SF first, then $/AC", () => {
    expect(priceReadback(d("land", { landSizeValue: "1851300", landSizeUnit: "sf", landPrice: "9256500" })))
      .toBe("= $5.00 /SF · $217,800 /AC");
  });
  it("building sale", () => {
    expect(priceReadback(d("building_sale", { bldgSizeSf: "120000", bldgPrice: "9250000" }))).toBe("= $77.08 /SF");
  });
  it("null until BOTH price and size are present, and never on a lease", () => {
    expect(priceReadback(d("land", { landPrice: "9250000" }))).toBe(null);
    expect(priceReadback(d("building_sale", { bldgSizeSf: "120000" }))).toBe(null);
    expect(priceReadback(d("lease", { leaseRate: "6" }))).toBe(null);
  });
});

describe("NEW-2 — footer read-back", () => {
  const lease = { leaseRate: "6.25", leaseSizeSf: "120000", leaseTerm: "64 mo", leaseRateExpense: "nnn" };
  it("lease, annual", () => {
    expect(footerReadback(d("lease", { ...lease, leaseRatePeriod: "annual" }))).toBe("$6.25/SF/yr NNN · 120,000 SF · 64 mo");
  });
  it("lease, monthly appends the yearly figure", () => {
    expect(footerReadback(d("lease", { ...lease, leaseRate: "0.50", leaseRatePeriod: "monthly" })))
      .toBe("$0.50/SF/mo NNN · $6.00/yr · 120,000 SF · 64 mo");
  });
  it("lease, period unset says mo or yr?", () => {
    expect(footerReadback(d("lease", { ...lease, leaseRatePeriod: "" }))).toBe("$6.25/SF mo or yr? NNN · 120,000 SF · 64 mo");
  });
  it("land and building sale", () => {
    expect(footerReadback(d("land", { landSizeValue: "42.5", landSizeUnit: "ac", landPrice: "9250000" }))).toBe("42.5 AC · $9,250,000 · $5.00/SF");
    expect(footerReadback(d("building_sale", { bldgSizeSf: "120000", bldgPrice: "9250000" }))).toBe("120,000 SF · $9,250,000 · $77.08/SF");
  });
  it("empty", () => {
    expect(footerReadback(d("lease"))).toBe("Nothing entered yet");
    expect(footerReadback(d("land"))).toBe("Nothing entered yet");
  });
});

describe("NEW-2 — Save copy, three blocker states", () => {
  const row = (o) => ({ _id: "r", draft: d("land", o), cellFlags: {} });
  it("no rows", () => expect(saveState({ rows: [], readyCount: 0 })).toEqual({ label: "Nothing to save yet", disabled: true }));
  it("only the location missing", () => expect(saveState({ rows: [row({})], readyCount: 0 })).toEqual({ label: "Place it on the map to save", disabled: true }));
  it("ready", () => {
    expect(saveState({ rows: [row({ anchor: PIN })], readyCount: 1 })).toEqual({ label: "Save 1 comp", disabled: false });
    expect(saveState({ rows: [row({ anchor: PIN }), row({ anchor: PIN })], readyCount: 2 }).label).toBe("Save 2 comps");
  });
  it("placed lease with no period is blocked on the period, not the map", () => {
    const r = { _id: "r", draft: d("lease", { anchor: PIN }), cellFlags: {} };
    expect(saveState({ rows: [r], readyCount: 0 }).label).toBe("Pick monthly or yearly to save");
  });
});

describe("NEW-2 — More details + labels", () => {
  it("lease carries lease fields, land carries none of the building ones", () => {
    const keys = (t) => moreDetailFields(t).map((m) => m.col.key);
    expect(keys("lease")).toEqual(["clearHeightFt", "yearBuilt", "leaseOpex", "leaseEscalationPct", "leaseCommencementDate", "leaseFreeRentMonths", "leaseTi", "compDate", "notes"]);
    expect(keys("building_sale")).toEqual(["clearHeightFt", "yearBuilt", "bldgNoi", "bldgCapRate", "compDate", "notes"]);
    expect(keys("land")).toEqual(["compDate", "notes"]);
  });
  it("labels read per type", () => {
    expect(moreDetailFields("lease").find((m) => m.col.key === "compDate").label).toBe("Lease signed");
    expect(moreDetailFields("land").find((m) => m.col.key === "compDate").label).toBe("Closed");
    expect(moreDetailFields("lease").find((m) => m.col.key === "clearHeightFt").label).toBe("Clear height");
    expect(mobilePartyLabels("lease")).toEqual({ provider: "Landlord", acquirer: "Tenant" });
    expect(mobilePartyLabels("land")).toEqual({ provider: "Seller", acquirer: "Buyer" });
    expect(compDateLabel("building_sale")).toBe("Closed");
  });
});
