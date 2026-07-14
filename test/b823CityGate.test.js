// B823 — the materially-inside-city gate on `city-criteria-unverified`, the ETJ
// overlay's short/detail split, and the slim round-trip of the centroid fact.
// Repro class: a Katy frontage sliver on a Houston-ETJ Fort Bend parcel fired
// "verify with the city" while the app itself said county criteria govern.
import { describe, it, expect } from "vitest";
import {
  authorityForJurisdiction,
  AUTHORITY_SHORT,
  slimDrainageContext,
  hydrateDrainageContext,
} from "../src/workspaces/site-planner/lib/detentionRules.js";

const FB = { county: ["Fort Bend"], unincorporated: true };

describe("authorityForJurisdiction — the B823 materially-inside gate", () => {
  it("Katy sliver: ring hit but centroid in NO city → county floor, NO flag", () => {
    const r = authorityForJurisdiction({ ...FB, city: ["Katy"], etj: ["Houston"], cityCentroid: [] });
    expect(r.primary).toBe("fortbend");
    expect(r.flags).not.toContain("city-criteria-unverified");
  });
  it("materially inside the unmodeled city (centroid names it) → flag present", () => {
    const r = authorityForJurisdiction({ ...FB, city: ["Katy"], cityCentroid: ["Katy"] });
    expect(r.primary).toBe("fortbend");
    expect(r.flags).toContain("city-criteria-unverified");
  });
  it("centroid tested but in a DIFFERENT (non-matching) city → no flag for the sliver city", () => {
    const r = authorityForJurisdiction({ ...FB, city: ["Katy"], cityCentroid: ["Fulshear"] });
    expect(r.flags).not.toContain("city-criteria-unverified");
  });
  it("outage (cityCentroid null) → FAILS OPEN, flag kept (a caveat never silently drops)", () => {
    const r = authorityForJurisdiction({ ...FB, city: ["Katy"], cityCentroid: null });
    expect(r.flags).toContain("city-criteria-unverified");
  });
  it("legacy stored check (cityCentroid undefined) → fails open, flag kept", () => {
    const r = authorityForJurisdiction({ ...FB, city: ["Katy"] });
    expect(r.flags).toContain("city-criteria-unverified");
  });
  it("scope discipline: Houston city-limits + overlay-city primaries stay NAME-based (B801's scope)", () => {
    expect(authorityForJurisdiction({ county: ["Harris"], city: ["Houston"], cityCentroid: [] }).primary).toBe("coh");
    expect(authorityForJurisdiction({ ...FB, city: ["Missouri City"], cityCentroid: [] }).primary).toBe("missouricity");
  });
});

describe("the ETJ overlay — short/detail split (B823)", () => {
  const etjOverlay = (jur) => authorityForJurisdiction(jur).overlays.find((o) => o.kind === "etj");
  it("carries short + detail; short names the county authority (FBCDD) and stays ≤110 chars", () => {
    const o = etjOverlay({ ...FB, etj: ["Houston"] });
    expect(o.short).toBe("Houston ETJ — county (FBCDD) criteria govern detention");
    expect(o.short.length).toBeLessThanOrEqual(110);
    expect(o.detail).toContain(o.note);
    expect(o.detail).toMatch(/plat review/);
  });
  it("note is unchanged copy (print + older consumers)", () => {
    const o = etjOverlay({ ...FB, etj: ["Houston"] });
    expect(o.note).toMatch(/^This parcel is in the City of Houston ETJ/);
    expect(o.note).toMatch(/Verify with both the City and the county\.$/);
  });
  it("a county straddle degrades the parenthetical to plain 'county'", () => {
    const o = etjOverlay({ county: ["Fort Bend", "Harris"], etj: ["Houston"] });
    expect(o.short).toBe("Houston ETJ — county criteria govern detention");
  });
  it("every AUTHORITY_SHORT label keeps the one-liner under the cap", () => {
    for (const [, lbl] of Object.entries(AUTHORITY_SHORT)) {
      expect((`Houston ETJ — county (${lbl}) criteria govern detention`).length).toBeLessThanOrEqual(110);
    }
  });
});

describe("slim round-trip of cityCentroid (B823 + the B788 re-derivation)", () => {
  const ctxFor = (jur) => ({
    authority: {
      primaryReviewer: { authorityId: "fortbend" },
      channelAuthority: null,
      overlays: [],
      ambiguous: [],
      flags: authorityForJurisdiction(jur).flags,
      mud: { state: "loaded" },
      jurisdiction: jur,
    },
    flood: null,
    channel: null,
    watershed: null,
    groundElevFt: 96,
  });
  it("a sliver check stays flag-free after JSON round-trip + rehydrate", () => {
    const jur = { city: ["Katy"], county: ["Fort Bend"], etj: ["Houston"], cityCentroid: [] };
    const slim = JSON.parse(JSON.stringify(slimDrainageContext(ctxFor(jur))));
    expect(slim.authority.jurisdiction.cityCentroid).toEqual([]);
    const h = hydrateDrainageContext(slim);
    expect(h.authority.flags).not.toContain("city-criteria-unverified");
  });
  it("a known-inside check keeps the flag after rehydrate", () => {
    const jur = { city: ["Katy"], county: ["Fort Bend"], etj: [], cityCentroid: ["Katy"] };
    const h = hydrateDrainageContext(JSON.parse(JSON.stringify(slimDrainageContext(ctxFor(jur)))));
    expect(h.authority.flags).toContain("city-criteria-unverified");
  });
  it("an outage check stores null and rehydrates fail-open (flag kept)", () => {
    const jur = { city: ["Katy"], county: ["Fort Bend"], etj: [], cityCentroid: null };
    const slim = JSON.parse(JSON.stringify(slimDrainageContext(ctxFor(jur))));
    expect(slim.authority.jurisdiction.cityCentroid).toBeNull();
    const h = hydrateDrainageContext(slim);
    expect(h.authority.flags).toContain("city-criteria-unverified");
  });
  it("a LEGACY slim (no cityCentroid key) rehydrates fail-open", () => {
    const jur = { city: ["Katy"], county: ["Fort Bend"], etj: [] };
    const slim = JSON.parse(JSON.stringify(slimDrainageContext(ctxFor(jur))));
    expect("cityCentroid" in slim.authority.jurisdiction).toBe(false);
    const h = hydrateDrainageContext(slim);
    expect(h.authority.flags).toContain("city-criteria-unverified");
  });
});
