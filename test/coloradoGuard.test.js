/* NEW-7 / NEW-8 — the Colorado guard and the drawdown statute.
 *
 * The owner's second hard constraint: Colorado ships LIVE, so nothing may render a Texas-derived
 * number for a Colorado site. A wrong-but-plausible detention volume on a Colorado plan is the
 * single worst outcome of this work, so the guard gets adversarial tests, not happy-path ones —
 * including the case where a user has manually forced a Texas authority onto a Colorado site.
 */
import { describe, it, expect } from "vitest";
import { computeRequiredDetention, DETENTION_RULES } from "../src/workspaces/site-planner/lib/detentionRules.js";
import {
  capabilityFor, coloradoRegimeFor,
  coloradoGaps, CO_DRAINAGE_REGIMES, CO_COUNTY_REGIME, CO_STATE_FLOOD_STANDARD,
  COLORADO_DETENTION_DETAIL,
} from "../src/workspaces/site-planner/lib/coloradoRegions.js";
// The guard's state resolution lives in its own tiny module — the synchronous half that stays on
// the boot path while the Colorado prose loads on demand. Deliberately not re-exported.
import { siteState, isColorado } from "../src/workspaces/site-planner/lib/siteRegion.js";
import { assessStatutoryDrawdown, statuteForState, DRAWDOWN_STATUTES } from "../src/workspaces/site-planner/lib/drawdownStatute.js";
import { assessDrawdown, allowableReleaseCfs } from "../src/workspaces/site-planner/lib/drawdownTime.js";

const DENVER = { lat: 39.7392, lng: -104.9903 };
const HOUSTON = { lat: 29.7604, lng: -95.3698 };

describe("NEW-8 · the site's state is resolved without a network call", () => {
  it("places the nine target counties in Colorado and the Houston MSA in Texas", () => {
    for (const p of [DENVER, { lat: 40.5853, lng: -105.0844 }, { lat: 38.8339, lng: -104.8214 }, { lat: 40.4233, lng: -104.7091 }]) {
      expect(siteState(p)).toBe("CO");
    }
    for (const p of [HOUSTON, { lat: 29.5994, lng: -95.6142 }, { lat: 30.0, lng: -95.86 }]) {
      expect(siteState(p)).toBe("TX");
    }
  });

  it("returns null rather than guessing outside both states", () => {
    expect(siteState({ lat: 45.5, lng: -122.6 })).toBeNull();   // Portland
    expect(siteState({})).toBeNull();
    expect(siteState({ lat: NaN, lng: NaN })).toBeNull();
    expect(isColorado(DENVER)).toBe(true);
    expect(isColorado(HOUSTON)).toBe(false);
  });
});

describe("NEW-8 · detention refuses to price a Colorado site", () => {
  const inputs = { acres: 80, impPct: 72, onDate: "2026-07-20" };

  it("returns an explicit unavailable carrier, never a number and never a band", () => {
    const r = computeRequiredDetention({ ...inputs, authorityId: null, siteState: "CO" });
    expect(r.kind).toBe("unavailable");
    expect(r.requiredAcFt).toBeNull();
    expect(r.bandAcFt).toBeNull();
    expect(r.rateAcFtPerAc).toBeNull();
    expect(r.rule).toBeNull();
    expect(r.flags).toContain("colorado-not-wired");
    // The copy is the deliverable here — a bare null would be the blank that reads as zero.
    expect(r.headline).toMatch(/not yet available in Colorado/i);
    // The long explanation moved to the lazily-loaded Colorado tier (bundle budget) — the carrier
    // still NAMES where it lives, so the link is explicit rather than implied, and the short
    // headline that makes the state unmistakable stays on the carrier itself.
    expect(r.detailFrom).toBe("coloradoRegions.COLORADO_DETENTION_DETAIL");
    expect(COLORADO_DETENTION_DETAIL).toMatch(/WQCV/);
    expect(COLORADO_DETENTION_DETAIL).toMatch(/Full Spectrum/);
  });

  it("STILL refuses when a Texas authority is forced onto a Colorado site", () => {
    // The adversarial case: a user overrides the reviewing agency, or a stale stored authority
    // rides along on a plan whose origin is in Colorado. The guard runs before the rule lookup,
    // so no Texas rate can leak through any of these.
    for (const aid of Object.keys(DETENTION_RULES)) {
      const r = computeRequiredDetention({ ...inputs, authorityId: aid, siteState: "CO" });
      expect(r.kind, `${aid} priced a Colorado site`).toBe("unavailable");
      expect(r.requiredAcFt, aid).toBeNull();
      expect(r.bandAcFt, aid).toBeNull();
    }
  });

  it("refuses even with zero acreage, rather than answering 'no site area'", () => {
    // "no site area" is a Texas-shaped answer. A Colorado site should be told what is true of it.
    const r = computeRequiredDetention({ acres: 0, authorityId: "hcfcd", siteState: "CO" });
    expect(r.kind).toBe("unavailable");
  });

  it("is case-insensitive on the state, so a stored 'co' cannot dodge it", () => {
    expect(computeRequiredDetention({ ...inputs, authorityId: "hcfcd", siteState: "co" }).kind).toBe("unavailable");
  });

  it("leaves Texas and unknown-state sites exactly as they were", () => {
    const tx = computeRequiredDetention({ ...inputs, authorityId: "fortbend", siteState: "TX" });
    const legacy = computeRequiredDetention({ ...inputs, authorityId: "fortbend" });        // no siteState at all
    const nullish = computeRequiredDetention({ ...inputs, authorityId: "fortbend", siteState: null });
    expect(tx.kind).toBe("point");
    expect(JSON.stringify(legacy)).toBe(JSON.stringify(tx));
    expect(JSON.stringify(nullish)).toBe(JSON.stringify(tx));
  });
});

describe("NEW-8 · the capability matrix enumerates the gaps honestly", () => {
  it("marks detention unavailable in Colorado and available in Texas", () => {
    expect(capabilityFor("detentionVolume", "CO").available).toBe(false);
    expect(capabilityFor("detentionVolume", "TX").available).toBe(true);
    expect(capabilityFor("detentionVolume", siteState(DENVER)).available).toBe(false);
    expect(capabilityFor("detentionVolume", siteState(HOUSTON)).available).toBe(true);
  });

  it("treats an unknown state as available — the pre-Colorado world", () => {
    // Every legacy saved plan without coordinates must behave exactly as it did before.
    expect(capabilityFor("detentionVolume", null).available).toBe(true);
    expect(capabilityFor("detentionVolume", siteState({})).available).toBe(true);
  });

  it("carries copy for every gap — a gap with no words is a blank", () => {
    const gaps = coloradoGaps();
    expect(gaps.length).toBeGreaterThan(0);
    for (const g of gaps) {
      expect(g.headline, g.id).toBeTruthy();
      expect(g.detail, g.id).toBeTruthy();
      expect(g.headline.length, g.id).toBeGreaterThan(10);
    }
    expect(gaps.map((g) => g.id)).toContain("detentionVolume");
    expect(gaps.map((g) => g.id)).toContain("floodplainMitigation");
  });

  it("distinguishes NOT-APPLICABLE from NOT-BUILT", () => {
    // Subsidence districts are Texas entities with no Colorado counterpart — saying "not built
    // yet" there would imply work that will never happen.
    expect(capabilityFor("subsidence", "CO").notApplicable).toBe(true);
    expect(capabilityFor("detentionVolume", "CO").notApplicable).toBe(false);
  });

  it("keeps drawdown wired in BOTH states — it is the one capability Colorado gains", () => {
    expect(capabilityFor("detentionDrawdown", "CO").available).toBe(true);
    expect(capabilityFor("detentionDrawdown", "TX").available).toBe(true);
  });
});

describe("NEW-5/NEW-8 · four regulatory regimes across nine counties, not one", () => {
  it("routes six of the nine target counties to MHFD and three to their own regimes", () => {
    const mhfd = ["Adams", "Arapahoe", "Boulder", "Broomfield", "Denver", "Jefferson"];
    for (const c of mhfd) expect(coloradoRegimeFor(c).id, c).toBe("mhfd");
    expect(coloradoRegimeFor("Larimer").id).toBe("larimer");
    expect(coloradoRegimeFor("Weld").id).toBe("weld");
    expect(coloradoRegimeFor("El Paso").id).toBe("elpaso");
    expect(Object.keys(CO_COUNTY_REGIME)).toHaveLength(9);
  });

  it("says out loud that Larimer, Weld and El Paso are NOT in MHFD", () => {
    for (const id of ["larimer", "weld", "elpaso"]) {
      expect(CO_DRAINAGE_REGIMES[id].note).toMatch(/NOT in the Mile High Flood District/i);
    }
    expect(CO_DRAINAGE_REGIMES.mhfd.counties).toContain("douglas"); // a member county, not a Planyr target
  });

  it("accepts app routing keys and messy county spellings", () => {
    expect(coloradoRegimeFor("co_elpaso").id).toBe("elpaso");
    expect(coloradoRegimeFor("El Paso County").id).toBe("elpaso");
    expect(coloradoRegimeFor("City and County of Denver").id).toBe("mhfd");
    expect(coloradoRegimeFor("Mesa")).toBeNull();
    expect(coloradoRegimeFor(null)).toBeNull();
  });

  it("models NO detention criteria for any regime, and names what would be needed", () => {
    for (const r of Object.values(CO_DRAINAGE_REGIMES)) {
      expect(r.detentionModeled, r.id).toBe(false);
      expect(r.detentionMethod, r.id).toBeTruthy();
    }
    expect(CO_DRAINAGE_REGIMES.mhfd.detentionMethod).toMatch(/WQCV/);
    expect(CO_DRAINAGE_REGIMES.mhfd.detentionMethod).toMatch(/EURV/);
  });
});

describe("NEW-7 · CWCB is Colorado's statewide floodplain floor, and it beats FEMA", () => {
  it("carries the three standards that exceed the NFIP minimum", () => {
    const byId = Object.fromEntries(CO_STATE_FLOOD_STANDARD.standards.map((s) => [s.id, s]));
    expect(byId.freeboard.value).toBe(1);
    expect(byId["critical-facilities"].value).toBe(2);
    expect(byId["floodway-rise"].value).toBe(0.5);
    for (const s of CO_STATE_FLOOD_STANDARD.standards) {
      expect(s.stricterThanFema, s.id).toBe(true);
      expect(s.femaBaseline, s.id).toBeTruthy();   // the comparison is the point
    }
    expect(CO_STATE_FLOOD_STANDARD.citation).toMatch(/2 CCR 408-1/);
  });

  it("records that the substance is verified but from a secondary reading", () => {
    expect(CO_STATE_FLOOD_STANDARD.verified).toBe(true);
    expect(CO_STATE_FLOOD_STANDARD.secondarySource).toBe(true);
    expect(CO_STATE_FLOOD_STANDARD.verifiedOn).toBeTruthy();
  });

  it("is a floor, not a substitute for the local ordinance", () => {
    expect(CO_STATE_FLOOD_STANDARD.appliesTo).toMatch(/floor/i);
    expect(CO_STATE_FLOOD_STANDARD.note).toMatch(/Critical Facility/i);
  });
});

describe("NEW-7 · the drawdown statute", () => {
  const ponds = (acFt) => [{ id: "p1", name: "Pond A", volumeCf: acFt * 43560 }];
  const fast = assessDrawdown({ ponds: ponds(5), siteVolumeCf: 5 * 43560, release: allowableReleaseCfs({ rateCfsPerAc: 0.5, acres: 80 }) });
  const slow = assessDrawdown({ ponds: ponds(150.9), siteVolumeCf: 206.3 * 43560, release: allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80.34 }) });

  it("does not apply in Texas — the informational readout is untouched", () => {
    for (const st of ["TX", null, "NM"]) {
      const r = assessStatutoryDrawdown({ state: st, drawdown: slow });
      expect(r.applies, String(st)).toBe(false);
      expect(r.verdict, String(st)).toBeNull();
      expect(r.tests, String(st)).toEqual([]);
    }
    expect(statuteForState("TX")).toBeNull();
    expect(statuteForState("CO")).toBe(DRAWDOWN_STATUTES.CO);
  });

  it("fails a multi-day drawdown in Colorado, with the water-rights reason", () => {
    const r = assessStatutoryDrawdown({ state: "CO", drawdown: slow });
    expect(r.applies).toBe(true);
    expect(r.verdict).toBe("fail");
    expect(r.headline).toMatch(/Fails/);
    expect(r.reason).toMatch(/out-of-priority diversion/);
    expect(r.tests.map((t) => t.verdict)).toEqual(["fail", "fail"]);
    expect(r.statute.citation).toBe("C.R.S. 37-92-602(8)");
  });

  it("never claims compliance on a pass — 'not ruled out' is the strongest honest verdict", () => {
    const r = assessStatutoryDrawdown({ state: "CO", drawdown: fast });
    expect(r.verdict).toBe("not-ruled-out");
    expect(r.verdict).not.toBe("pass");
    expect(r.proxy).toBe(true);
    expect(r.proxyNote).toMatch(/not ruled out/i);
    expect(r.reason).toMatch(/not a compliance finding/i);
  });

  it("carries both statutory tests with their real thresholds", () => {
    const [five, bigger] = DRAWDOWN_STATUTES.CO.tests;
    expect(five.releaseFraction).toBe(0.97);
    expect(five.withinHr).toBe(72);
    expect(bigger.releaseFraction).toBe(0.99);
    expect(bigger.withinHr).toBe(120);
  });

  it("fails the facility, not the average — one slow pond is enough", () => {
    // Site-wide can sit inside the limit while a single pond blows past it. The statute applies
    // per facility, so the verdict must follow the worst pond.
    const mixed = assessDrawdown({
      ponds: [{ id: "a", name: "A", volumeCf: 1 * 43560 }, { id: "b", name: "B", volumeCf: 400 * 43560 }],
      siteVolumeCf: 2 * 43560,   // deliberately understated site figure
      release: allowableReleaseCfs({ rateCfsPerAc: 0.05, acres: 40 }),
    });
    const r = assessStatutoryDrawdown({ state: "CO", drawdown: mixed });
    expect(r.ponds.some((p) => p.tests.some((t) => t.verdict === "fail"))).toBe(true);
    expect(r.verdict).toBe("fail");
  });

  it("says it cannot answer without a release rate, rather than passing by default", () => {
    const none = assessDrawdown({ ponds: [], siteVolumeCf: 100, release: null });
    const r = assessStatutoryDrawdown({ state: "CO", drawdown: none });
    expect(r.applies).toBe(true);
    expect(r.verdict).toBe("unknown");
    expect(r.reason).toMatch(/release rate/i);
  });

  it("surfaces the State Engineer notification, and assumes it applies when the date is unknown", () => {
    const unknown = assessStatutoryDrawdown({ state: "CO", drawdown: fast });
    expect(unknown.notification.required).toBe(true);
    expect(unknown.notification.assumed).toBe(true);
    expect(unknown.notification.text).toMatch(/State Engineer/);
    expect(unknown.notification.text).toMatch(/5 August 2015/);

    const after = assessStatutoryDrawdown({ state: "CO", drawdown: fast, constructedAfter2015: true });
    expect(after.notification.required).toBe(true);
    expect(after.notification.assumed).toBe(false);

    const before = assessStatutoryDrawdown({ state: "CO", drawdown: fast, constructedAfter2015: false });
    expect(before.notification.required).toBe(false);
  });
});
