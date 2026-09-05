import { describe, it, expect } from "vitest";
import { findMatchingSite, milesBetween, SITE_MATCH_MILES } from "../src/shared/comps/lib/compSiteMatch.js";

// Real production coordinates (site_role_unify_backfill_20260905.sql / B1156864's own record),
// so this suite proves the rule against the exact case the review measured, not a synthetic one.
const CORE5 = { id: "trk8eef7db4d0", groupId: "trk8eef7db4d0", site: "Core 5 - West Hardy", origin: { lat: 29.9862907597668, lon: -95.3968627418879 } };
const TESLA_DC4 = { id: "trk0892cf7b73", groupId: "trk0892cf7b73", site: "Tesla - TGS DC4", origin: { lat: 29.7323267265652, lon: -94.869229076615 } };
const TESLA_800K = { id: "trk4c75bf98dd", groupId: "trk4c75bf98dd", site: "Tesla - TGS 800K SF", origin: { lat: 29.7228594655189, lon: -94.8855991154857 } };
const PURSUIT_SITE = { id: "p1", groupId: "p1", site: "Airtex", role: "pursuit", origin: { lat: 29.9865, lon: -95.3970 } };

describe("compSiteMatch", () => {
  it("computes the same haversine distance the backfill's own SQL formula would (adjacent-case sanity)", () => {
    const d = milesBetween(TESLA_800K.origin.lat, TESLA_800K.origin.lon, TESLA_DC4.origin.lat, TESLA_DC4.origin.lon);
    // ~1.2 mi — the review's own "about 2 km apart" — well outside SITE_MATCH_MILES.
    expect(d).toBeGreaterThan(1);
    expect(d).toBeLessThan(1.5);
  });

  it("matches a comp to an existing site within SITE_MATCH_MILES, nearest first", () => {
    const nearCore5 = { lat: 29.9864, lon: -95.3969, title: "A second building at the same property" };
    const match = findMatchingSite(nearCore5, [CORE5, TESLA_DC4, TESLA_800K, PURSUIT_SITE]);
    expect(match).toBeTruthy();
    expect(match.matchedBy).toBe("location");
    // Nearer to PURSUIT_SITE (~0.03mi) than to CORE5 (~0.02mi) — either is plausible; assert it
    // picked the genuinely closest one rather than the first in the array.
    const d1 = milesBetween(nearCore5.lat, nearCore5.lon, CORE5.origin.lat, CORE5.origin.lon);
    const d2 = milesBetween(nearCore5.lat, nearCore5.lon, PURSUIT_SITE.origin.lat, PURSUIT_SITE.origin.lon);
    expect(match.groupId).toBe(d1 <= d2 ? CORE5.groupId : PURSUIT_SITE.groupId);
  });

  it("attaches a second deal on an already-tracked property (the owner's Airtex Building A/B case)", () => {
    // Building B: no comp yet today: adding one right next to the existing tracked "Core 5" site
    // (itself created from Building A's comp) must attach to it, not mint a second "Core 5" site.
    const buildingB = { lat: 29.9863, lon: -95.3969, title: "Core 5 - West Hardy Building B" };
    const match = findMatchingSite(buildingB, [CORE5]);
    expect(match).toEqual({ groupId: "trk8eef7db4d0", name: "Core 5 - West Hardy", matchedBy: "location" });
  });

  it("keeps two real properties separate even though they're both named similarly (adjacent-case guard)", () => {
    // A brand-new "Tesla" comp near TESLA_800K must not accidentally match TESLA_DC4 (2mi away) —
    // and must match TESLA_800K itself only by proximity, not by the shared "Tesla" word.
    const nearTesla800k = { lat: 29.7229, lon: -94.8856, title: "Tesla - a different building" };
    const match = findMatchingSite(nearTesla800k, [TESLA_DC4, TESLA_800K]);
    expect(match.groupId).toBe(TESLA_800K.groupId);
  });

  it("never merges two genuinely distant sites on a location basis", () => {
    // A comp sitting exactly at TESLA_DC4 must not match TESLA_800K (>1mi away, no name given).
    const match = findMatchingSite({ lat: TESLA_DC4.origin.lat, lon: TESLA_DC4.origin.lon, title: "" }, [TESLA_800K]);
    expect(match).toBeNull();
  });

  it("falls back to an exact (normalized) title match when no site is within range", () => {
    const match = findMatchingSite({ lat: 40, lon: -100, title: "  core 5 - west hardy  " }, [CORE5]);
    expect(match).toEqual({ groupId: "trk8eef7db4d0", name: "Core 5 - West Hardy", matchedBy: "name" });
  });

  it("returns null when nothing plausibly matches — the caller mints a new tracked site", () => {
    expect(findMatchingSite({ lat: 40, lon: -100, title: "Somewhere else entirely" }, [CORE5, TESLA_DC4])).toBeNull();
    expect(findMatchingSite({ lat: 40, lon: -100, title: "" }, [CORE5])).toBeNull();
  });

  it("SITE_MATCH_MILES is the documented 0.5mi radius (kept in step with the one-time backfill)", () => {
    expect(SITE_MATCH_MILES).toBe(0.5);
  });

  it("ignores a candidate site with no resolved origin and no matching title", () => {
    const noOrigin = { id: "s2", groupId: "s2", site: "Blank planner site", origin: null };
    expect(findMatchingSite({ lat: 29.88, lon: -95.44, title: "Blank planner site" }, [noOrigin]).groupId).toBe("s2");
    expect(findMatchingSite({ lat: 29.88, lon: -95.44, title: "Unrelated" }, [noOrigin])).toBeNull();
  });
});
