/* COLORADO AUDIT (NEW-1 … NEW-4) — the four defects this pass shipped, each pinned by the
 * property that was wrong, not by the line that was changed.
 *
 * The family every one of them belongs to: absence of data wearing the costume of an answer. A
 * Texas statement of law asserted on Colorado ground · a Texas projection asked for a Colorado
 * bearing · a statutory gate answering with no input · a capability record claiming a floor it
 * never applies.
 *
 * MUTATION-PROVEN. Each block names the mutation that turns it red; every one was run.
 */
import { describe, it, expect } from "vitest";
import { deriveZoning } from "../src/workspaces/site-planner/lib/siteAnalysis.js";
import { gridConvergenceDeg } from "../src/workspaces/site-planner/lib/deedAlign.js";
import { assessStatutoryDrawdown } from "../src/workspaces/site-planner/lib/drawdownStatute.js";
import { assessDrawdown, allowableReleaseCfs } from "../src/workspaces/site-planner/lib/drawdownTime.js";
import { capabilityFor } from "../src/workspaces/site-planner/lib/coloradoRegions.js";
import { projectToGrid, gridToProject } from "../src/shared/coordinates/index.js";
import { resolveZone } from "../src/shared/coordinates/statePlane.js";

// The owner's own ground: Johnstown, on the Weld / Larimer county line.
const JOHNSTOWN = { lat: 40.337, lon: -104.912 };
const KATY = { lat: 29.78, lon: -95.80 };

/* ── NEW-1 — the unincorporated zoning answer is a statement of STATE law ──────────────────── */
describe("NEW-1 · unincorporated zoning is answered per state, never Texas everywhere", () => {
  // Mutation: restore `if (j.unincorporated) summary = "Unincorporated — Texas counties have no
  // zoning; ..."` → the Colorado and unknown cases go red (3 assertions).
  const uninc = { unincorporated: true, city: [], etj: [] };

  it("TEXAS is unchanged, verbatim", () => {
    expect(deriveZoning(uninc, "TX").summary)
      .toBe("Unincorporated — Texas counties have no zoning; subdivision platting still applies.");
  });

  it("COLORADO says the opposite, because the law is the opposite (C.R.S. 30-28-111)", () => {
    const s = deriveZoning(uninc, "CO").summary;
    expect(s).toMatch(/Colorado counties DO zone/);
    expect(s).toMatch(/C\.R\.S\. 30-28-111/);
    // The load-bearing negative: a Colorado card may never carry Texas's doctrine.
    expect(s).not.toMatch(/Texas/);
    expect(s).not.toMatch(/have no zoning/);
  });

  it("an UNIDENTIFIED state asserts no state's doctrine at all", () => {
    const s = deriveZoning(uninc, null).summary;
    expect(s).not.toMatch(/Texas|Colorado/);
    expect(s).toMatch(/varies by state/);
  });

  it("the Houston branches and the city branch are untouched", () => {
    expect(deriveZoning({ unincorporated: false, city: ["Houston"], etj: [] }, "TX").summary)
      .toMatch(/^City of Houston — NO zoning/);
    expect(deriveZoning({ unincorporated: false, city: ["Katy"], etj: [] }, "TX").summary)
      .toMatch(/^Within Katy — city zoning likely applies/);
    expect(deriveZoning({ unincorporated: false, city: [], etj: ["Houston"] }, "TX").summary)
      .toMatch(/^Houston ETJ/);
  });

  it("the CAVEAT stops naming City of Houston to a Colorado reader", () => {
    expect(deriveZoning(uninc, "CO").caveat).not.toMatch(/Houston/);
    expect(deriveZoning(uninc, "TX").caveat).toMatch(/Houston/);
  });
});

/* ── NEW-2 — the deed's basis-of-bearings correction comes from the SITE'S zone ────────────── */
describe("NEW-2 · grid convergence is computed in the site's own state-plane zone", () => {
  /* Mutation: restore the body to `projectToGrid`/`gridToProject` (the hardcoded EPSG:2278) →
   * the Colorado sign test, the magnitude test and the drift test all go red (Johnstown reads
   * −2.885° instead of +0.378°). Restoring `return 0` for the unresolvable case turns the
   * honest-null test red. Both mutations were run. */

  /* The independent derivation this asserts against — a Lambert zone's convergence in closed form,
   * γ = n·(λ − λ₀), with n computed here from the zone's PUBLISHED standard parallels
   * (C.R.S. 38-52-101 / EPSG) by the standard LCC formula, written out rather than imported.
   * Deliberately not the module's own numerical differencing: an assertion that re-runs the code
   * under test proves only that it is self-consistent. */
  const D2R = Math.PI / 180;
  const E2 = (1 / 298.257222101) * (2 - 1 / 298.257222101), ECC = Math.sqrt(E2);
  const m = (φ) => Math.cos(φ) / Math.sqrt(1 - E2 * Math.sin(φ) ** 2);
  const t = (φ) => Math.tan(Math.PI / 4 - φ / 2) / ((1 - ECC * Math.sin(φ)) / (1 + ECC * Math.sin(φ))) ** (ECC / 2);
  const coneN = (p1, p2) => (Math.log(m(p1 * D2R)) - Math.log(m(p2 * D2R))) / (Math.log(t(p1 * D2R)) - Math.log(t(p2 * D2R)));
  const ZONE = {                                  // standard parallels · central meridian
    co_north: { n: coneN(39 + 43 / 60, 40 + 47 / 60), lon0: -105.5 },
    co_central: { n: coneN(38 + 27 / 60, 39 + 45 / 60), lon0: -105.5 },
    tx_sc: { n: coneN(28 + 23 / 60, 30 + 17 / 60), lon0: -99.0 },
  };
  const closedForm = (zoneId, lon) => ZONE[zoneId].n * (lon - ZONE[zoneId].lon0);
  /* The module measures convergence by stepping 1,000 ft due grid-north and reading the graticule,
   * so it carries a second-order finite-difference error against the exact γ = n·(λ − λ₀). MEASURED
   * across all nine Colorado counties plus Katy, it is a constant ~0.5% OF γ — a relative effect,
   * not an absolute one, which is why the bar below is relative (an absolute bar that fits Boulder,
   * γ = 0.08°, rejects Katy, γ = 1.56°). At Johnstown 0.5% of γ is 0.0015°, or 0.03 ft across a
   * 1,320 ft run. The bar is 1%, stated before the run and never nudged to make one pass. */
  const FD_REL = 0.01, FD_FLOOR_DEG = 1e-4;
  const fdBar = (zoneId, lon) => FD_REL * Math.abs(closedForm(zoneId, lon)) + FD_FLOOR_DEG;
  const nearClosedForm = (g, zoneId, lon) => Math.abs(g - closedForm(zoneId, lon));

  it("KATY, TEXAS is unchanged — and bit-identical to the old hardcoded path", () => {
    const now = gridConvergenceDeg(KATY.lat, KATY.lon);
    // The pre-NEW-2 implementation, inlined verbatim, over the untouched EPSG:2278 spine.
    const p = projectToGrid(KATY.lat, KATY.lon);
    const up = gridToProject({ x: p.x, y: p.y + 1000 });
    const dLat = up.lat - KATY.lat;
    const dLon = (up.lon - KATY.lon) * Math.cos((KATY.lat * Math.PI) / 180);
    const before = (Math.atan2(dLon, dLat) * 180) / Math.PI;
    expect(now).toBeCloseTo(before, 10);
    expect(now).toBeCloseTo(1.56, 2);          // grid north ~1.5° EAST of true north near Houston
  });

  it("JOHNSTOWN, COLORADO gets Colorado North — and the SIGN flips", () => {
    const g = gridConvergenceDeg(JOHNSTOWN.lat, JOHNSTOWN.lon);
    // Johnstown sits EAST of Colorado North's −105.5° central meridian, so grid north is east of
    // true north: a small POSITIVE angle. The Texas cone answered −2.885°, the wrong way round.
    expect(g).toBeGreaterThan(0);
    expect(nearClosedForm(g, "co_north", JOHNSTOWN.lon)).toBeLessThan(fdBar("co_north", JOHNSTOWN.lon));
    expect(g).toBeCloseTo(0.378, 2);
  });

  it("the whole Front Range agrees with the closed form, and none of it is the Texas answer", () => {
    // Named counties, so each resolves through the AUTHORITATIVE county assignment rather than
    // the coarse envelope (which cannot separate the interleaved Front Range counties).
    const rows = [
      ["denver", 39.74, -104.99, "co_denver", "co_central"],
      ["fort collins", 40.63, -105.08, "co_larimer", "co_north"],
      ["colorado springs", 38.83, -104.56, "co_elpaso", "co_central"],
      ["boulder", 40.08, -105.37, "co_boulder", "co_north"],
    ];
    for (const [name, lat, lon, county, zoneId] of rows) {
      const g = gridConvergenceDeg(lat, lon, { state: "CO", county });
      expect(nearClosedForm(g, zoneId, lon), name).toBeLessThan(fdBar(zoneId, lon));
      expect(Math.abs(g), name).toBeLessThan(1);   // the Texas cone answered ~−2.9° at all four
    }
  });

  it("the error it removes is 75 ft of drift across a 1,320 ft boundary run", () => {
    // What the Texas cone used to answer at Johnstown, reconstructed from the untouched spine.
    const p = projectToGrid(JOHNSTOWN.lat, JOHNSTOWN.lon);
    const up = gridToProject({ x: p.x, y: p.y + 1000 });
    const old = (Math.atan2((up.lon - JOHNSTOWN.lon) * Math.cos((JOHNSTOWN.lat * Math.PI) / 180),
      up.lat - JOHNSTOWN.lat) * 180) / Math.PI;
    const errDeg = old - gridConvergenceDeg(JOHNSTOWN.lat, JOHNSTOWN.lon);
    expect(Math.abs(errDeg)).toBeGreaterThan(3);
    expect(1320 * Math.abs(Math.sin((errDeg * Math.PI) / 180))).toBeGreaterThan(70);
  });

  /* NEW-2(b) — the plan's SAVED county key must actually RESOLVE. `statePlane.slugCounty` did not
   * strip the `co_` routing prefix the app persists (`counties.js` prefixes Colorado because both
   * states have an El Paso and a Jefferson), so `zoneForCounty("CO","co_denver")` slugged to
   * `codenver`, matched nothing, and `resolveZone` fell through to the COARSE point envelope —
   * which this module's own comment says cannot separate the interleaved Front Range counties.
   * Measured before the fix: Denver resolved to Colorado NORTH (2231) instead of Central (2232).
   * Mutation: drop the `^co_` strip → both assertions here go red. Run. */
  it("the plan's SAVED co_-prefixed county key resolves to the right zone, not the coarse envelope", () => {
    // Denver is CENTRAL, but its latitude (39.74) sits exactly on the coarse envelope's seam and
    // the envelope answers NORTH there — so this passes only if the county key matched.
    // The crisp form of the property: the ZONE the resolver picks for the persisted key.
    expect(resolveZone({ state: "CO", county: "co_denver", lat: 39.74, lon: -104.99 }).epsg).toBe(2232);
    expect(resolveZone({ state: "CO", county: "co_denver", lat: 39.74, lon: -104.99 }).via).toBe("county");
    expect(resolveZone({ state: "CO", county: "co_weld", lat: 40.337, lon: -104.912 }).epsg).toBe(2231);
    expect(resolveZone({ state: "CO", county: "co_elpaso", lat: 38.83, lon: -104.56 }).epsg).toBe(2232);
    expect(resolveZone({ state: "CO", county: "co_broomfield", lat: 39.95, lon: -105.06 }).decided).toBe(true);
    // And the same fact through the consumer. Denver's latitude sits exactly on the coarse
    // envelope's seam, where the envelope answers NORTH — so this discriminates.
    const byCounty = gridConvergenceDeg(39.74, -104.99, { state: "CO", county: "co_denver" });
    expect(nearClosedForm(byCounty, "co_central", -104.99)).toBeLessThan(fdBar("co_central", -104.99));
    // 0.009° apart at Denver against a 0.0013° measurement error — a 7× margin, so this really does
    // separate the two zones rather than passing on slop.
    expect(nearClosedForm(byCounty, "co_north", -104.99)).toBeGreaterThan(0.008);
    // Every spelling the app can hand it lands on the same answer.
    for (const key of ["co_weld", "weld", "Weld", "WELD COUNTY"]) {
      expect(nearClosedForm(gridConvergenceDeg(40.337, -104.912, { state: "CO", county: key }), "co_north", -104.912), key)
        .toBeLessThan(fdBar("co_north", -104.912));
    }
  });

  it("ground outside every modelled zone returns an HONEST NULL, never 0 and never a guess", () => {
    expect(gridConvergenceDeg(41.88, -87.63)).toBeNull();          // Chicago
    expect(gridConvergenceDeg(34.05, -118.24)).toBeNull();         // Los Angeles
    expect(gridConvergenceDeg(NaN, -95.8)).toBeNull();
    expect(gridConvergenceDeg(29.8, undefined)).toBeNull();
    // 0 is a REAL answer (on the central meridian) and must stay distinguishable from "unknown".
    expect(gridConvergenceDeg(29.80, -99.0)).not.toBeNull();
    expect(Math.abs(gridConvergenceDeg(29.80, -99.0))).toBeLessThan(0.02);
  });
});

/* ── NEW-3 — the statutory gate refuses to evaluate with nothing stored ────────────────────── */
describe("NEW-3 · C.R.S. 37-92-602(8) does not answer on a plan with no stored volume", () => {
  /* Mutation: delete the `siteVolumeCf > 0` block → the zero-volume and no-pond cases both go red
   * (they return verdict "not-ruled-out" with the headline "Colorado drawdown statute not ruled
   * out"). Run. */
  const release = allowableReleaseCfs({ rateCfsPerAc: 0.125, acres: 80 });

  const at = (siteVolumeCf, ponds = []) =>
    assessStatutoryDrawdown({ state: "CO", drawdown: assessDrawdown({ ponds, siteVolumeCf, release }) });

  it("ZERO stored volume is UNKNOWN, not a soft pass", () => {
    const a = at(0);
    expect(a.verdict).toBe("unknown");
    expect(a.headline).toMatch(/not yet checkable/);
    expect(a.reason).toMatch(/no detention volume/);
    // The exact sentence the defect used to produce.
    expect(a.headline).not.toMatch(/not ruled out/);
    expect(a.tests.every((t) => t.verdict === "unknown")).toBe(true);
  });

  it("no ponds at all is the same answer", () => {
    expect(at(null).verdict).toBe("unknown");
  });

  it("a REAL volume inside the limits still reports not-ruled-out — the gate did not become inert", () => {
    const a = at(20 * 43560, [{ id: "p", name: "Pond", volumeCf: 20 * 43560 }]);
    expect(a.verdict).toBe("not-ruled-out");
    expect(a.headline).toMatch(/not ruled out/);
    expect(a.siteHours).toBeGreaterThan(0);
  });

  it("a REAL volume outside the limits still FAILS", () => {
    const a = at(400 * 43560, [{ id: "p", name: "Pond", volumeCf: 400 * 43560 }]);
    expect(a.verdict).toBe("fail");
    expect(a.headline).toMatch(/Fails the Colorado 72-hour drawdown statute/);
  });

  it("no release rate is still its own unknown, with its own reason", () => {
    const a = assessStatutoryDrawdown({ state: "CO", drawdown: assessDrawdown({ ponds: [], siteVolumeCf: 100 * 43560, release: null }) });
    expect(a.verdict).toBe("unknown");
    expect(a.reason).toMatch(/release rate/);
  });

  it("TEXAS is untouched — the statute does not apply at all", () => {
    const a = assessStatutoryDrawdown({ state: "TX", drawdown: assessDrawdown({ ponds: [], siteVolumeCf: 0, release }) });
    expect(a.applies).toBe(false);
    expect(a.verdict).toBeNull();
  });
});

/* ── NEW-4 — a capability record may not claim a floor it never applies ────────────────────── */
describe("NEW-4 · the requiredFfe record states the truth about the CWCB floor", () => {
  // Mutation: restore `wired: "partial"` + "Planyr applies that floor." → both go red.
  it("Colorado FFE reports as NOT wired", () => {
    const c = capabilityFor("requiredFfe", "CO");
    expect(c.wired).toBe(false);
    expect(c.available).toBe(false);
  });

  it("the detail says the floor is NOT applied, and never that it is", () => {
    const c = capabilityFor("requiredFfe", "CO");
    expect(c.detail).toMatch(/does NOT yet apply it/);
    expect(c.detail).not.toMatch(/Planyr applies that floor/);
    expect(c.headline).toMatch(/NOT applied/);
  });

  it("Texas FFE is untouched", () => {
    expect(capabilityFor("requiredFfe", "TX").available).toBe(true);
  });
});
