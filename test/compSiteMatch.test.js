import { describe, it, expect } from "vitest";
import { findMatchingSite, haversineMiles, MATCH_RADIUS_MILES } from "../src/shared/comps/lib/compSiteMatch.js";

// Real coordinates from the review's own writeup, so this suite is grounded in the actual
// production case rather than synthetic geometry.
const AIRTEX_COMP = { lat: 29.8563, lon: -95.4763 }; // "Core 5 - West Hardy" (approximate)
const TESLA_800K = { lat: 29.7228594655189, lon: -94.8855991154857 };
const TESLA_DC4 = { lat: 29.7323267265652, lon: -94.869229076615 };

describe("haversineMiles", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMiles(29.8, -95.4, 29.8, -95.4)).toBe(0);
  });
  it("returns Infinity for any non-finite input, never NaN or a wrong number", () => {
    expect(haversineMiles(NaN, -95.4, 29.8, -95.4)).toBe(Infinity);
    expect(haversineMiles(29.8, undefined, 29.8, -95.4)).toBe(Infinity);
    expect(haversineMiles(29.8, -95.4, null, -95.4)).toBe(Infinity);
  });
  it("the two real Tesla comps are ~1.2 mi apart — outside MATCH_RADIUS_MILES (0.5)", () => {
    const d = haversineMiles(TESLA_800K.lat, TESLA_800K.lon, TESLA_DC4.lat, TESLA_DC4.lon);
    expect(d).toBeGreaterThan(1.0);
    expect(d).toBeLessThan(1.4);
    expect(d).toBeGreaterThan(MATCH_RADIUS_MILES);
  });
});

describe("findMatchingSite — NEW-3 (adversarial review of B1156864)", () => {
  it("returns null when nothing plausibly matches — the caller should create a new tracked site", () => {
    const sites = [{ groupId: "g1", site: "Somewhere Else", origin: { lat: 40, lon: -100 }, updatedAt: 1 }];
    expect(findMatchingSite({ title: "New Deal", lat: 29.8, lon: -95.4 }, sites)).toBeNull();
  });

  it("matches an EXACT title regardless of distance", () => {
    const sites = [
      { groupId: "far", site: "Core 5 - West Hardy", origin: { lat: 10, lon: 10 }, updatedAt: 1 },
    ];
    const m = findMatchingSite({ title: "Core 5 - West Hardy", lat: AIRTEX_COMP.lat, lon: AIRTEX_COMP.lon }, sites);
    expect(m).toEqual({ groupId: "far", confidence: "exact-title" });
  });

  it("title match is case/whitespace-insensitive", () => {
    const sites = [{ groupId: "g1", site: "  core 5 - west hardy  ", origin: null, updatedAt: 1 }];
    expect(findMatchingSite({ title: "Core 5 - West Hardy", lat: null, lon: null }, sites).groupId).toBe("g1");
  });

  it("falls back to the NEAREST site within MATCH_RADIUS_MILES when no title matches", () => {
    const sites = [
      { groupId: "near", site: "Some Site", origin: { lat: AIRTEX_COMP.lat + 0.001, lon: AIRTEX_COMP.lon }, updatedAt: 1 },
      { groupId: "farther", site: "Other Site", origin: { lat: AIRTEX_COMP.lat + 0.01, lon: AIRTEX_COMP.lon }, updatedAt: 1 },
    ];
    const m = findMatchingSite({ title: "Building B", lat: AIRTEX_COMP.lat, lon: AIRTEX_COMP.lon }, sites);
    expect(m.groupId).toBe("near");
    expect(m.confidence).toBe("near");
    expect(m.distanceMiles).toBeLessThan(MATCH_RADIUS_MILES);
  });

  it("never matches beyond MATCH_RADIUS_MILES — the two real Tesla sites stay separate", () => {
    const sites = [{ groupId: "tesla-dc4", site: "Tesla - TGS DC4", origin: TESLA_DC4, updatedAt: 1 }];
    const m = findMatchingSite({ title: "Tesla - TGS 800K SF", lat: TESLA_800K.lat, lon: TESLA_800K.lon }, sites);
    expect(m).toBeNull(); // no title match (different titles) and 1.2mi > 0.5mi radius
  });

  it("matches ANY role — a comp may attach to a real pursuit project, not only a tracked one", () => {
    const sites = [{ groupId: "g1", site: "Real Project", role: "pursuit", origin: { lat: 29.8, lon: -95.4 }, updatedAt: 1 }];
    const m = findMatchingSite({ title: "", lat: 29.8001, lon: -95.4 }, sites);
    expect(m.groupId).toBe("g1");
  });

  it("a comp with no location and no title match returns null (nothing legible to match on)", () => {
    const sites = [{ groupId: "g1", site: "Something", origin: { lat: 29.8, lon: -95.4 }, updatedAt: 1 }];
    expect(findMatchingSite({ title: "", lat: null, lon: null }, sites)).toBeNull();
  });

  it("skips candidates with no origin when matching by distance", () => {
    const sites = [
      { groupId: "no-origin", site: "No Origin", origin: null, updatedAt: 1 },
      { groupId: "has-origin", site: "Has Origin", origin: { lat: 29.8, lon: -95.4 }, updatedAt: 1 },
    ];
    expect(findMatchingSite({ title: "", lat: 29.8, lon: -95.4 }, sites).groupId).toBe("has-origin");
  });
});
