import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSourceResult, isSourceOpen, sourceCooldownMs, filterHealthyCandidates,
  resetSourceHealth, isStatewideBackup, suppressRedundantStatewide,
  SOURCE_FAIL_THRESHOLD, SOURCE_COOLDOWN_MS, SOURCE_SLOW_MS,
} from "../src/workspaces/site-planner/lib/sourceHealth.js";
import { STATEWIDE_KEYS } from "../src/workspaces/site-planner/lib/counties.js";

// The per-source circuit breaker (B244): after N consecutive failures a county's
// parcel server is skipped for a cooldown so clicks stop re-hammering a dead host,
// then auto-resumes. `now` is injected so this is deterministic without real timers.
describe("sourceHealth — parcel-server circuit breaker (B244)", () => {
  beforeEach(resetSourceHealth);

  it("stays closed below the failure threshold", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD - 1; i++) recordSourceResult("fbcad", false, t);
    expect(isSourceOpen("fbcad", t)).toBe(false);
  });

  it("opens after N consecutive failures", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("fbcad", false, t);
    expect(isSourceOpen("fbcad", t)).toBe(true);
    expect(sourceCooldownMs("fbcad", t)).toBe(SOURCE_COOLDOWN_MS);
  });

  it("a success resets the streak (a blip never trips the breaker)", () => {
    const t = 1000;
    recordSourceResult("fbcad", false, t);
    recordSourceResult("fbcad", false, t);
    recordSourceResult("fbcad", true, t); // recovered
    recordSourceResult("fbcad", false, t); // a fresh streak of 1
    expect(isSourceOpen("fbcad", t)).toBe(false);
  });

  it("auto-resumes (closes) once the cooldown elapses", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("fbcad", false, t);
    expect(isSourceOpen("fbcad", t + 1)).toBe(true); // still inside cooldown
    expect(isSourceOpen("fbcad", t + SOURCE_COOLDOWN_MS + 1)).toBe(false); // cooled down → retry
    expect(sourceCooldownMs("fbcad", t + SOURCE_COOLDOWN_MS + 1)).toBe(0);
  });

  it("filterHealthyCandidates drops an open primary but ALWAYS keeps the statewide key", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("fortbend", false, t);
    const cands = [{ county: "fortbend", url: "u1" }, { county: "txgio_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, ["txgio_statewide"], t);
    expect(out.map((c) => c.county)).toEqual(["txgio_statewide"]); // dead primary dropped, fallback kept
  });

  it("keeps a healthy primary alongside the statewide fallback", () => {
    const cands = [{ county: "harris", url: "u1" }, { county: "txgio_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, ["txgio_statewide"], 1000);
    expect(out.map((c) => c.county)).toEqual(["harris", "txgio_statewide"]);
  });

  it("NEW-1 (2026-09-08) — a brand-new state's statewide source survives its own outage exactly like txgio_statewide does, via the real STATEWIDE_KEYS list, never a hand-typed one", () => {
    // Mutation-prove one of the 19 states NEW-1 wired (docs/STATEWIDE-PARCELS.md): the outage
    // path is REUSED, not reimplemented, so this must hold with zero per-state code. Arkansas is
    // picked because its host (gis.arkansas.gov) is a REAL, confirmed outage from this build
    // environment's own egress policy — the same "genuine outage, not simulated" standing
    // e2e/parcel-outage-fallback.spec.js already established for county-level sources.
    expect(STATEWIDE_KEYS).toContain("ar_statewide");
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("ar_statewide", false, t);
    expect(isSourceOpen("ar_statewide", t)).toBe(true); // the breaker really did open — not a no-op
    const cands = [{ county: "harris", url: "u1" }, { county: "ar_statewide", url: "u2" }];
    // Passing the REAL production list (not ["ar_statewide"] by hand) is the point: this is
    // exactly what MapFinder.jsx / SitePlanner.jsx call with, so a future change that stops
    // deriving `alwaysKeep` from STATEWIDE_KEYS (e.g. reverting to a literal two-state array)
    // fails HERE, not silently in production for the 19 states added after that array was written.
    const out = filterHealthyCandidates(cands, STATEWIDE_KEYS, t);
    expect(out.map((c) => c.county)).toEqual(["harris", "ar_statewide"]); // open breaker, still never dropped
  });

  it("B1332016 continuation (2026-09-08) — a state wired from the owner's OWN BROWSER survives its own outage exactly like every other statewide composite, via the real STATEWIDE_KEYS list", () => {
    // Same mutation proof as the AR case above, for the second batch (HI/MD/NE/NH) — these four
    // were measured live from the owner's own browser rather than probed from this sandbox
    // (docs/STATEWIDE-PARCELS.md), but they are wired through the identical `<state>_statewide`
    // shape and reuse this exact outage path, zero per-state code. Nebraska is picked because
    // gis.ne.gov is a REAL, confirmed 403 from this build environment's own egress policy.
    expect(STATEWIDE_KEYS).toContain("ne_statewide");
    expect(STATEWIDE_KEYS).toEqual(expect.arrayContaining(["hi_statewide", "md_statewide", "nh_statewide"]));
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("ne_statewide", false, t);
    expect(isSourceOpen("ne_statewide", t)).toBe(true); // the breaker really did open — not a no-op
    const cands = [{ county: "harris", url: "u1" }, { county: "ne_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, STATEWIDE_KEYS, t);
    expect(out.map((c) => c.county)).toEqual(["harris", "ne_statewide"]); // open breaker, still never dropped
  });

  it("NEW-1 (2026-09-08, continuing B1332016/B1345824) — Virginia and West Virginia survive their own outage exactly like every other statewide composite, via the real STATEWIDE_KEYS list", () => {
    // Same mutation proof as the AR/NE cases above, for VA/WV — both measured live from the
    // owner's own browser (their official hosts, corrected from B1345824 round 1's mistaken
    // third-party-rehost decline), wired through the identical `<state>_statewide` shape and
    // reusing this exact outage path, zero per-state code. West Virginia is picked because
    // services.wvgis.wvu.edu is a REAL, confirmed 403 from this build environment's own egress
    // policy — the same "genuine outage, not simulated" standing e2e/parcel-outage-fallback.spec.js
    // already established for county-level sources.
    expect(STATEWIDE_KEYS).toContain("wv_statewide");
    expect(STATEWIDE_KEYS).toEqual(expect.arrayContaining(["va_statewide", "wv_statewide"]));
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("wv_statewide", false, t);
    expect(isSourceOpen("wv_statewide", t)).toBe(true); // the breaker really did open — not a no-op
    const cands = [{ county: "harris", url: "u1" }, { county: "wv_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, STATEWIDE_KEYS, t);
    expect(out.map((c) => c.county)).toEqual(["harris", "wv_statewide"]); // open breaker, still never dropped
  });

  it("NEW-1 (2026-09-08) — California and Rhode Island survive their own outage exactly like every other statewide composite, via the real STATEWIDE_KEYS list", () => {
    // Same mutation proof as the AR/NE/WV cases above, for the two states NEW-1 rescued from a
    // `no-free-source` row that was simply WRONG (docs/STATEWIDE-PARCELS.md; both found via the
    // official-ArcGIS-Online-organization pass NEW-2 makes systematic). Neither needs one line of
    // per-state outage code — that is the property under test.
    //
    // RHODE ISLAND is the one driven here, deliberately: risegis.ri.gov is a REAL, confirmed
    // egress-policy block from this build environment (the CONNECT tunnel never opens), so this is
    // a genuine outage rather than a simulated one — the same standing
    // e2e/parcel-outage-fallback.spec.js already established for county-level sources, and the
    // same reason Arkansas and Nebraska were picked for the two cases above. California is
    // asserted present but not driven: its host answers HTTP 200 from here, so an outage for it
    // would be the simulated kind.
    expect(STATEWIDE_KEYS).toContain("ri_statewide");
    expect(STATEWIDE_KEYS).toContain("ca_statewide");
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("ri_statewide", false, t);
    expect(isSourceOpen("ri_statewide", t)).toBe(true); // the breaker really did open — not a no-op
    const cands = [{ county: "harris", url: "u1" }, { county: "ri_statewide", url: "u2" }];
    const out = filterHealthyCandidates(cands, STATEWIDE_KEYS, t);
    expect(out.map((c) => c.county)).toEqual(["harris", "ri_statewide"]); // open breaker, still never dropped
  });

  it("never returns empty even if every candidate's breaker is open (coverage must survive)", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) { recordSourceResult("harris", false, t); recordSourceResult("fortbend", false, t); }
    const cands = [{ county: "harris", url: "u1" }, { county: "fortbend", url: "u2" }];
    const out = filterHealthyCandidates(cands, [], t); // no always-keep, both open
    expect(out.length).toBeGreaterThan(0);
  });

  // B1461731 — the breaker keys on SLOWNESS as well as outright errors, per the Nevada window
  // where one query took 18s to return an error before the host stopped answering entirely: a
  // source trending toward its own timeout is backed off before it starts hard-failing.
  describe("slowness (B1461731)", () => {
    it("a single slow-but-successful response does not trip the breaker", () => {
      const t = 1000;
      recordSourceResult("nv_statewide", true, t, { ms: SOURCE_SLOW_MS + 500 });
      expect(isSourceOpen("nv_statewide", t)).toBe(false);
    });

    it("N consecutive slow-but-ok=true responses open the breaker exactly like N failures would", () => {
      const t = 1000;
      for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("nv_statewide", true, t, { ms: SOURCE_SLOW_MS + 1 });
      expect(isSourceOpen("nv_statewide", t)).toBe(true);
    });

    it("a response under the slow threshold, even if just barely, resets the streak like any healthy success", () => {
      const t = 1000;
      recordSourceResult("nv_statewide", true, t, { ms: SOURCE_SLOW_MS + 1 });
      recordSourceResult("nv_statewide", true, t, { ms: SOURCE_SLOW_MS - 1 });
      expect(isSourceOpen("nv_statewide", t)).toBe(false);
    });

    it("omitting ms is the old ok/fail-only behavior — a fast/untimed success still resets immediately", () => {
      const t = 1000;
      recordSourceResult("nv_statewide", false, t);
      recordSourceResult("nv_statewide", true, t); // no ms passed — same as before this change
      expect(isSourceOpen("nv_statewide", t)).toBe(false);
    });

    it("a genuine failure still counts even when ms is also slow (doesn't double-count or under-count)", () => {
      const t = 1000;
      for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) recordSourceResult("nv_statewide", false, t, { ms: 18000 }); // the measured 18s Nevada error
      expect(isSourceOpen("nv_statewide", t)).toBe(true);
    });
  });
});

// isStatewideBackup — the honest "statewide backup" badge fires ONLY when the county's
// own CAD was genuinely unavailable, never when a healthy CAD merely lost the parallel
// identify race to a faster TxGIO (B630 — the false "Fort Bend server unavailable" notice
// on every healthy Fort Bend click).
describe("isStatewideBackup — honest 'statewide backup' labeling (B630)", () => {
  const SW = ["txgio_statewide"]; // the statewide TxGIO source has its own key since B787 (was `chambers`)

  it("is NOT a backup when a real county CAD answered directly", () => {
    // FBCAD answered → hit.county is a real primary, not the statewide key.
    expect(isStatewideBackup("fortbend", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "fortbend" }, { county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("is NOT a backup when statewide won the race but a healthy CAD WAS queried (the B630 bug)", () => {
    // The reported case: FBCAD is healthy (a queried candidate) and returns 200, but the
    // statewide TxGIO layer answered a hair faster and won the eager race. That is a race
    // outcome, not an outage — the notice must NOT fire.
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "fortbend" }, { county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("IS a backup when the real CAD's breaker was open, so only statewide was queried", () => {
    // A genuine outage: FBCAD's breaker opened, so filterHealthyCandidates dropped it and
    // only the statewide layer remained to answer — TxGIO truly stood in.
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(true);
  });

  it("is NOT a backup in a statewide-only area (no real CAD covers the point)", () => {
    // A county with no configured CAD is served straight from TxGIO — that is its normal
    // source, not a stand-in, so no "backup" badge.
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [],
      queried: [{ county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("is NOT a backup at a border straddle when at least one real CAD was still queryable", () => {
    // Point near a county line: fortbend's breaker is open (dropped) but harris is healthy
    // and WAS queried. Even if statewide won the race, a real CAD was available — don't
    // cry "county server unavailable".
    expect(isStatewideBackup("txgio_statewide", {
      realPrimaries: [{ county: "fortbend" }, { county: "harris" }],
      queried: [{ county: "harris" }, { county: "txgio_statewide" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("defends against missing/empty inputs", () => {
    expect(isStatewideBackup("txgio_statewide")).toBe(false);
    expect(isStatewideBackup(undefined, { statewideKeys: SW })).toBe(false);
  });

  it("NEW-1 — the honest backup badge fires for a newly-wired state's composite exactly like txgio_statewide, using the real STATEWIDE_KEYS list", () => {
    // A New York click where a real county-level source doesn't exist at all — ny_statewide is
    // the ONLY source (no per-county entry backs it, unlike Texas/Colorado), so this is the
    // "statewide-only area" case, not a "backup", by the same rule as a Texas county with no CAD.
    expect(isStatewideBackup("ny_statewide", {
      realPrimaries: [],
      queried: [{ county: "ny_statewide" }],
      statewideKeys: STATEWIDE_KEYS,
    })).toBe(false);
  });

  it("B1332016 continuation (2026-09-08) — the same holds for a state wired from the owner's own browser (Maryland has no per-county entry either)", () => {
    expect(isStatewideBackup("md_statewide", {
      realPrimaries: [],
      queried: [{ county: "md_statewide" }],
      statewideKeys: STATEWIDE_KEYS,
    })).toBe(false);
  });
});

// NEW-2 (2026-09-15, B1639697) — a single healthy real CAD needs no statewide co-query.
// Regression test for the reported "1200 McKinney St, Houston, TX fires HCAD AND the statewide
// layer" fan-out: query COUNT is what's under test here, not just the eventual winning hit
// (isStatewideBackup above already proves the WINNER is honest either way).
describe("suppressRedundantStatewide — a healthy single real CAD queries alone (NEW-2)", () => {
  const SW = ["txgio_statewide"];

  it("drops the statewide candidate when exactly one real primary is present and healthy", () => {
    const candidates = [{ county: "harris", url: "u1" }, { county: "txgio_statewide", url: "u2" }];
    const realPrimaries = [{ county: "harris" }];
    const out = suppressRedundantStatewide(candidates, realPrimaries, SW);
    expect(out.map((c) => c.county)).toEqual(["harris"]); // exactly one query — the county's own CAD
  });

  it("keeps the statewide candidate when the sole real primary's breaker is open (genuine outage)", () => {
    // filterHealthyCandidates would already have dropped "harris" from `candidates` here — the
    // statewide entry is the only one left, and must stay so the outage backstop still answers.
    const candidates = [{ county: "txgio_statewide", url: "u2" }]; // harris already filtered out
    const realPrimaries = [{ county: "harris" }]; // still a real primary for this point
    const out = suppressRedundantStatewide(candidates, realPrimaries, SW);
    expect(out.map((c) => c.county)).toEqual(["txgio_statewide"]);
  });

  it("keeps every candidate at a straddle (2+ real primaries) — unchanged", () => {
    const candidates = [{ county: "harris", url: "u1" }, { county: "fortbend", url: "u2" }, { county: "txgio_statewide", url: "u3" }];
    const realPrimaries = [{ county: "harris" }, { county: "fortbend" }];
    const out = suppressRedundantStatewide(candidates, realPrimaries, SW);
    expect(out.map((c) => c.county)).toEqual(["harris", "fortbend", "txgio_statewide"]);
  });

  it("keeps the sole statewide candidate when there is no real primary at all (a derived TX county)", () => {
    const candidates = [{ county: "txgio_statewide", url: "u1" }];
    const out = suppressRedundantStatewide(candidates, [], SW);
    expect(out.map((c) => c.county)).toEqual(["txgio_statewide"]);
  });

  it("KNOWN-GOOD ARM — the exact reported repro: Harris (healthy) + statewide collapses to one query", () => {
    const t = 1000;
    resetSourceHealth();
    const healthy = filterHealthyCandidates(
      [{ county: "harris", url: "u1" }, { county: "txgio_statewide", url: "u2" }],
      STATEWIDE_KEYS,
      t,
    );
    const out = suppressRedundantStatewide(healthy, [{ county: "harris" }], STATEWIDE_KEYS);
    expect(out).toHaveLength(1);
    expect(out[0].county).toBe("harris");
  });
});
