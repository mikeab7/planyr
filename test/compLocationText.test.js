import { describe, it, expect } from "vitest";
import { parcelLocationText, siteplanLocationText, pinFallbackText } from "../src/shared/comps/lib/compLocationText.js";

describe("compLocationText: parcelLocationText — an APN is an identity, never an address", () => {
  it("a single parcel shows its own APN", () => {
    expect(parcelLocationText({ kind: "parcel", parcelApn: "123-456-789" })).toBe("123-456-789");
  });
  it("several parcels show a count + county, never a bare confirmation", () => {
    const countyName = (key) => (key === "harris" ? "Harris County" : null);
    expect(parcelLocationText({ kind: "parcel", parcelApn: "111, 222, 333", county: "harris" }, countyName)).toBe("3 parcels · Harris County");
  });
  it("several parcels with no resolvable county name still shows the count", () => {
    expect(parcelLocationText({ kind: "parcel", parcelApn: "111, 222" }, () => null)).toBe("2 parcels");
  });
  it("no APN at all is null — nothing to show", () => {
    expect(parcelLocationText({ kind: "parcel" })).toBeNull();
  });
});

describe("compLocationText: siteplanLocationText — the plan's own title, no invented building label", () => {
  it("uses the overlay's docTitle when known", () => {
    const overlaysById = { ov1: { docTitle: "Hardy A", sourceFileName: "hardy-a.pdf" } };
    expect(siteplanLocationText({ kind: "site_plan", sitePlanOverlayId: "ov1" }, overlaysById)).toBe("Hardy A");
  });
  it("falls back to the source filename when there is no title", () => {
    const overlaysById = { ov1: { sourceFileName: "hardy-a.pdf" } };
    expect(siteplanLocationText({ kind: "site_plan", sitePlanOverlayId: "ov1" }, overlaysById)).toBe("hardy-a.pdf");
  });
  it("null when the overlay hasn't loaded yet or no longer exists", () => {
    expect(siteplanLocationText({ kind: "site_plan", sitePlanOverlayId: "ov1" }, {})).toBeNull();
    expect(siteplanLocationText({ kind: "site_plan", sitePlanOverlayId: "ov1" }, null)).toBeNull();
  });
});

describe("compLocationText: pinFallbackText — never blank once a pin exists", () => {
  it("prefers County, ST when the anchor's county is already known", () => {
    const entry = (key) => (key === "harris" ? { name: "Harris County", state: "TX" } : null);
    expect(pinFallbackText({ kind: "pin", lat: 29.7, lon: -95.4, county: "harris" }, entry)).toBe("Harris County, TX");
  });
  it("falls back to coordinates at 4dp when there is no county yet", () => {
    expect(pinFallbackText({ kind: "pin", lat: 29.76543, lon: -95.36789 }, () => null)).toBe("29.7654, -95.3679");
  });
  it("falls back to coordinates when the county key doesn't resolve to a registry entry", () => {
    expect(pinFallbackText({ kind: "pin", lat: 29.76543, lon: -95.36789, county: "co_denver" }, () => null)).toBe("29.7654, -95.3679");
  });
  it("null only when there is genuinely no position at all", () => {
    expect(pinFallbackText({ kind: "pin" }, () => null)).toBeNull();
    expect(pinFallbackText(null, () => null)).toBeNull();
  });
});
