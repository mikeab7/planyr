// B2095122: a pasted/parsed comp draft carries "" for unset enum fields; the comps table CHECKs
// (land_size_unit, lease_rate_period, lease_rate_expense) reject "" — compToRow must send NULL.
import { describe, it, expect } from "vitest";
import { compToRow } from "../src/shared/comps/lib/comps.js";
describe("compToRow nulls blank CHECK-constrained enums", () => {
  const base = { compType: "land", anchorKind: "pin", compDate: "2026-10-01" };
  it("blank → null", () => {
    const r = compToRow({ ...base, landSizeUnit: "", leaseRatePeriod: "", leaseRateExpense: "" });
    expect(r.land_size_unit).toBeNull(); expect(r.lease_rate_period).toBeNull(); expect(r.lease_rate_expense).toBeNull();
  });
  it("real values survive", () => {
    const r = compToRow({ ...base, landSizeUnit: "ac", leaseRatePeriod: "annual", leaseRateExpense: "nnn" });
    expect([r.land_size_unit, r.lease_rate_period, r.lease_rate_expense]).toEqual(["ac", "annual", "nnn"]);
  });
});
