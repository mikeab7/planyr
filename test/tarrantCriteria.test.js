// NEW-1 / NEW-2 (Tarrant County) — detention + easement criteria for Tarrant County and the City of Fort Worth, and the
// admin "County requests" status derived from them.
//
// WHAT THESE RECORDS ARE: METHOD-ONLY, with NO volume number. Their documents (tarrantcountytx.gov, fortworthtexas.gov,
// nctcog.org) are unreachable from the build sandbox, so the records hold only short verbatim fragments returned by search
// excerpts and say so (`sourceRead: "search-excerpt"`). Every assertion below is about the cascade, the honesty invariants
// and the plumbing — never about a Tarrant detention rate, because none exists on file and none may be invented.
import { describe, it, expect } from "vitest";
import {
  DETENTION_RULES, COUNTY_AUTHORITY, authorityForJurisdiction, computeRequiredDetention,
  DETENTION_AUTHORITY_CHOICES, slimDrainageContext, hydrateDrainageContext,
} from "../src/workspaces/site-planner/lib/detentionRules.js";
import { DEFAULT_EASEMENT_RULES, MODELED_COUNTIES, defaultJurForCounty, resolveEasementJur } from "../src/workspaces/site-planner/lib/easementRules.js";
import { DEFAULT_POND_CRITERIA } from "../src/workspaces/site-planner/lib/pondCriteriaRules.js";
import { DEFAULT_FLOODPLAIN_RULES } from "../src/workspaces/site-planner/lib/floodplainRules.js";
import { yieldVerdictStrip } from "../src/workspaces/site-planner/lib/yieldVerdicts.js";
import { isWired, isUnverified, prepareCriteriaRequestRows, MODELED_BY_FAMILY, UNVERIFIED_BY_FAMILY } from "../src/workspaces/admin/lib/criteriaRequestsAdmin.js";

const jur = (o) => authorityForJurisdiction({ unincorporated: true, ...o });

describe("detention cascade — Tarrant County / Fort Worth", () => {
  it("(a) a point in UNINCORPORATED Tarrant County resolves to the Tarrant record, not 'no criteria on file'", () => {
    const a = jur({ county: ["Tarrant"], city: [], etj: [] });
    expect(a.primary).toBe("tarrant");
    expect(a.flags).not.toContain("no-criteria-modeled");
    expect(a.unmodeledCounty).toBeUndefined();
  });
  it("(b) a point INSIDE Fort Worth city limits gets the City's record, not the county's", () => {
    const a = jur({ county: ["Tarrant"], city: ["Fort Worth"], cityCentroid: ["Fort Worth"], unincorporated: false });
    expect(a.primary).toBe("fortworth");
  });
  it("(b2) Fort Worth limits that run into an UNMODELED county (Denton/Parker/Wise) still resolve to Fort Worth, with no stale 'no criteria' flag", () => {
    for (const county of ["Denton", "Parker", "Wise", "Johnson"]) {
      const a = jur({ county: [county], city: ["Fort Worth"], cityCentroid: ["Fort Worth"], unincorporated: false });
      expect(a.primary, county).toBe("fortworth");
      expect(a.flags, county).not.toContain("no-criteria-modeled");
    }
  });
  it("(b3) a parcel that only TOUCHES Fort Worth (centroid tested, outside the city) keeps the county rule", () => {
    const a = jur({ county: ["Tarrant"], city: ["Fort Worth"], cityCentroid: [] });
    expect(a.primary).toBe("tarrant");
  });
  it("(b4) an UNTESTED centroid (outage / point query) fails open to the City, never silently to the county", () => {
    expect(jur({ county: ["Tarrant"], city: ["Fort Worth"] }).primary).toBe("fortworth");
  });
  it("(c) the Fort Worth ETJ is the CITY's — the opposite of the Houston-ETJ rule — and says it is unverified", () => {
    const a = jur({ county: ["Tarrant"], city: [], etj: ["Fort Worth"] });
    expect(a.primary).toBe("fortworth");
    expect(a.flags).toContain("fort-worth-etj");
    expect(a.overlays.find((o) => o.kind === "etj").short).toMatch(/Fort Worth ETJ/);
    expect(a.overlays.find((o) => o.kind === "etj").short).toMatch(/unverified/i);
    // …including where the ETJ reaches into a county with no record of its own
    expect(jur({ county: ["Parker"], city: [], etj: ["Fort Worth"] }).primary).toBe("fortworth");
  });
  it("(c2) another Tarrant city's ETJ does NOT take the Fort Worth rule; its city limits keep the county floor + the 'verify with the city' flag", () => {
    expect(jur({ county: ["Tarrant"], city: [], etj: ["Arlington"] }).primary).toBe("tarrant");
    const a = jur({ county: ["Tarrant"], city: ["Arlington"], cityCentroid: ["Arlington"], unincorporated: false });
    expect(a.primary).toBe("tarrant");
    expect(a.flags).toContain("city-criteria-unverified");
  });
  it("(c3) a straddle of Fort Worth and another city prices each candidate by its own authority (never defaults)", () => {
    const a = jur({ county: ["Tarrant"], city: ["Fort Worth", "Arlington"] });
    expect(a.primary).toBeNull();
    expect(a.ambiguous[0].candidates).toEqual(["fortworth", "tarrant"]);
  });
  it("(d) HOUSTON-AREA regression — nothing moved: Harris, Houston limits, Houston ETJ over Fort Bend, Fort Bend, and an unmodeled county", () => {
    expect(jur({ county: ["Harris"], city: [], etj: [] }).primary).toBe("hcfcd");
    expect(jur({ county: ["Harris"], city: ["Houston"], cityCentroid: ["Houston"] }).primary).toBe("coh");
    const e = jur({ county: ["Fort Bend"], city: [], etj: ["Houston"] });
    expect(e.primary).toBe("fortbend");
    expect(e.flags).toContain("houston-etj");
    expect(jur({ county: ["Dallas"], city: [], etj: [] }).flags).toContain("no-criteria-modeled"); // still a dead-end-with-a-request: not wired
    // the HCFCD PCPM 0.65 rate, pinned by the Goose Creek 276 ac × 0.65 = 179.4 test, is untouched
    expect(DETENTION_RULES.hcfcd[0].params.rateAcFtPerAc).toBe(0.65);
    const gc = computeRequiredDetention({ acres: 276, authorityId: "hcfcd", hcfcdMethod: "pcpm" });
    expect(gc.requiredAcFt).toBeCloseTo(179.4, 6);
  });
  it("the slimmed drainage context rehydrates to the same Fort Worth / Tarrant answer (no stale persisted verdict)", () => {
    const mk = (jurisdiction) => ({ authority: { jurisdiction, primaryReviewer: null, overlays: [], ambiguous: [], flags: [] } });
    for (const [j, want] of [[{ city: ["Fort Worth"], county: ["Tarrant"], etj: [], cityCentroid: ["Fort Worth"] }, "fortworth"], [{ city: [], county: ["Tarrant"], etj: ["Fort Worth"] }, "fortworth"], [{ city: [], county: ["Tarrant"], etj: [] }, "tarrant"]]) {
      const slim = slimDrainageContext({ ...mk(j), authority: { ...mk(j).authority, jurisdiction: j, primaryReviewer: { authorityId: "STALE" } } });
      expect(hydrateDrainageContext(slim).authority.primaryReviewer.authorityId, JSON.stringify(j)).toBe(want);
    }
  });
});

describe("detention records — method-only, honest, no invented number", () => {
  for (const id of ["tarrant", "fortworth"]) {
    const rule = (DETENTION_RULES[id] || [])[0] || { params: {}, source: {} }; // collects (and fails per-test) on a tree with no record
    it(`${id}: ruleType 'method', carries NO rate, band or volume anywhere in its params`, () => {
      expect(rule.ruleType).toBe("method");
      const bad = (o, path = "") => Object.entries(o || {}).flatMap(([k, v]) =>
        /rateAcFtPerAc|bandAcFtPerAc|screeningBand|minRate|largeSiteMinRate|coefficient/i.test(k) && v ? [path + k]
        : v && typeof v === "object" && !Array.isArray(v) ? bad(v, path + k + ".") : []);
      expect(bad(rule.params)).toEqual([]);
      expect(rule.params.noPublishedVolumetricRate).toBe(true);
    });
    it(`${id}: result is kind 'unknown' — requiredAcFt / bandAcFt / rate all null — at any acreage, tagged method-based + source-unverified`, () => {
      for (const acres of [0.5, 12, 276]) {
        const r = computeRequiredDetention({ acres, impPct: 80, authorityId: id });
        expect(r.kind).toBe("unknown");
        expect(r.requiredAcFt).toBeNull();
        expect(r.bandAcFt).toBeNull();
        expect(r.rateAcFtPerAc).toBeNull();
        expect(r.flags).toEqual(expect.arrayContaining(["method-based", "source-unverified"]));
        expect(r.flags).not.toContain("no-criteria-modeled");
        expect(r.rule).toBe(rule);
        expect(r.basis).not.toMatch(/\d+(\.\d+)?\s*ac-?ft/i);
      }
    });
    it(`${id}: HONESTY INVARIANT — a record read only through search excerpts says so, cites each fragment with a document + URL, and lists what to read`, () => {
      expect(rule.sourceRead).toBe("search-excerpt");
      expect(rule.secondarySource).toBe(true);
      expect(rule.source.section).toMatch(/NOT READ/);
      expect(rule.params.evidence.length).toBeGreaterThan(0);
      for (const e of rule.params.evidence) { expect(e.quote.length).toBeGreaterThan(20); expect(e.url).toMatch(/^https:\/\//); expect(e.doc).toBeTruthy(); }
      expect(rule.params.documentsToRead.length).toBeGreaterThan(0);
      const r = computeRequiredDetention({ acres: 10, authorityId: id });
      expect(r.detail).toMatch(/NOT verified/);
      for (const e of rule.params.evidence) expect(r.detail).toContain(e.quote);
    });
  }
  it("both appear in the reviewer picker (they are authorities, not additive districts)", () => {
    const ids = DETENTION_AUTHORITY_CHOICES.map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["tarrant", "fortworth"]));
  });
  it("the verdict strip reads a NAMED state — never the 'checking flood data' spinner and never the bare no-criteria request", () => {
    const req = computeRequiredDetention({ acres: 20, authorityId: "tarrant" });
    const [det] = yieldVerdictStrip({ req, providedUsableCf: null, floodChecked: true });
    expect(det.loading).toBeFalsy();
    expect(det.unavailable).toBe(true);
    expect(det.pill).toBe("N/A");
    expect(det.sentence).toBe("Tarrant County: no volume rate on file (source unverified)");
    expect(det.requestCriteria).toBeFalsy();
    const [fw] = yieldVerdictStrip({ req: computeRequiredDetention({ acres: 20, authorityId: "fortworth" }), providedUsableCf: null, floodChecked: true });
    expect(fw.sentence).toBe("City of Fort Worth: no volume rate on file (source unverified)");
  });
  it("controls: an unmodeled county STILL gets the request action; Houston-area authorities still price a number", () => {
    const dallas = { ...computeRequiredDetention({ acres: 20, authorityId: null }), governingCounty: "dallas" };
    const [det] = yieldVerdictStrip({ req: dallas, providedUsableCf: null, floodChecked: true });
    expect(det.requestCriteria).toEqual({ countyKey: "dallas", countyLabel: "Dallas County", family: "detention" });
    expect(computeRequiredDetention({ acres: 10, authorityId: "waller" }).kind).toBe("band");
    expect(computeRequiredDetention({ acres: 10, impPct: 60, authorityId: "montgomery" }).kind).toBe("point");
  });
});

describe("easement — Tarrant County / Fort Worth", () => {
  it("(a) unincorporated Tarrant resolves to its own record; no county → still null (the request path)", () => {
    expect(defaultJurForCounty("Tarrant")).toBe("tarrant");
    expect(defaultJurForCounty("tarrant county".replace(" county", ""))).toBe("tarrant");
    expect(defaultJurForCounty("dallas")).toBeNull();
    expect(defaultJurForCounty(null)).toBeNull();
  });
  it("(b)/(c) the drainage cascade's Fort Worth answer (city limits or ETJ) outranks the county; an explicit pick outranks both", () => {
    expect(defaultJurForCounty("tarrant", "fortworth")).toBe("fortworth");
    expect(defaultJurForCounty("denton", "fortworth")).toBe("fortworth");
    expect(defaultJurForCounty("tarrant", "tarrant")).toBe("tarrant");
    expect(resolveEasementJur("generic", "tarrant", DEFAULT_EASEMENT_RULES, "fortworth")).toBe("generic");
    expect(resolveEasementJur(null, "tarrant", DEFAULT_EASEMENT_RULES, "fortworth")).toBe("fortworth");
  });
  it("(d) HOUSTON-AREA regression: Harris → coh, Fort Bend → fortbend, widths unchanged", () => {
    expect(defaultJurForCounty("Harris")).toBe("coh");
    expect(defaultJurForCounty("fort bend")).toBe("fortbend");
    expect(defaultJurForCounty("harris", "hcfcd")).toBe("coh");
    expect(DEFAULT_EASEMENT_RULES.coh.waterWidth).toBe(20);
    expect(DEFAULT_EASEMENT_RULES.fortbend.waterWidth).toBe(20);
  });
  it("NO INVENTED WIDTH — Tarrant and Fort Worth carry waterWidth null, unverified, source-labelled, with the documents to read", () => {
    for (const k of ["tarrant", "fortworth"]) {
      const r = DEFAULT_EASEMENT_RULES[k];
      expect(r.waterWidth).toBeNull();
      expect(r.verified).toBe(false);
      expect(r.sourceRead).toBe("search-excerpt");
      expect(r.documentsToRead.length).toBeGreaterThan(0);
      expect(r.note).toMatch(/To confirm/);
    }
    // the one number Tarrant does carry is a DRAINAGE easement minimum, named as such — not a water width
    expect(DEFAULT_EASEMENT_RULES.tarrant.drainageEasementMinFt).toBe(15);
    expect(DEFAULT_EASEMENT_RULES.tarrant.note).toMatch(/drainage easement, not a water main/);
  });
  it("MODELED_COUNTIES includes tarrant (the admin cross-reference reads it)", () => {
    expect(MODELED_COUNTIES).toContain("tarrant");
  });
});

describe("admin 'County requests' status is DERIVED from the registries (one source of truth)", () => {
  const norm = (k) => k.replace(/\s+/g, "");
  it("PARITY — each family's admin list equals the keys of the registry the app routes against (a county added there and not here fails)", () => {
    expect([...MODELED_BY_FAMILY.detention].sort()).toEqual(Object.keys(COUNTY_AUTHORITY).map(norm).sort());
    expect([...MODELED_BY_FAMILY.easement].sort()).toEqual([...MODELED_COUNTIES].sort());
    expect([...MODELED_BY_FAMILY.pond].sort()).toEqual(Object.keys(DEFAULT_POND_CRITERIA).filter((k) => !["coh", "generic"].includes(k)).sort());
    expect([...MODELED_BY_FAMILY.floodplain].sort()).toEqual(Object.keys(DEFAULT_FLOODPLAIN_RULES).filter((k) => !["coh", "baytown", "generic"].includes(k)).sort());
  });
  it("PARITY — 'source unread' is exactly the set of on-file records flagged sourceRead:'search-excerpt'", () => {
    const det = Object.entries(COUNTY_AUTHORITY).filter(([, a]) => DETENTION_RULES[a][0].sourceRead === "search-excerpt").map(([c]) => norm(c)).sort();
    expect([...UNVERIFIED_BY_FAMILY.detention].sort()).toEqual(det);
    const ease = Object.entries(DEFAULT_EASEMENT_RULES).filter(([k, r]) => r.sourceRead === "search-excerpt" && MODELED_COUNTIES.includes(k)).map(([k]) => k).sort();
    expect([...UNVERIFIED_BY_FAMILY.easement].sort()).toEqual(ease);
  });
  it("the two production rows (Tarrant · Detention, Tarrant · Easement) stop being OUTSTANDING; they read 'on file, source unread'", () => {
    const rows = prepareCriteriaRequestRows([
      { county_key: "tarrant", county_label: "Tarrant County", state: "TX", family: "detention", request_count: 1 },
      { county_key: "tarrant", county_label: "Tarrant County", state: "TX", family: "easement", request_count: 1 },
    ]);
    expect(rows.filter((r) => !r.wired).length).toBe(0);
    expect(rows.every((r) => r.unverified)).toBe(true);
  });
  it("CONTROLS: Tarrant pond/floodplain are NOT claimed; an unmodeled county stays outstanding; a Houston-area county is wired and NOT unverified", () => {
    expect(isWired("tarrant", "pond")).toBe(false);
    expect(isWired("tarrant", "floodplain")).toBe(false);
    expect(isWired("dallas", "detention")).toBe(false);
    expect(isWired("harris", "detention")).toBe(true);
    expect(isUnverified("harris", "detention")).toBe(false);
    expect(isUnverified("dallas", "detention")).toBe(false);
  });
});
