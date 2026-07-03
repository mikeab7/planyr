import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSourceResult, isSourceOpen, sourceCooldownMs, filterHealthyCandidates,
  resetSourceHealth, isStatewideBackup, SOURCE_FAIL_THRESHOLD, SOURCE_COOLDOWN_MS,
} from "../src/workspaces/site-planner/lib/sourceHealth.js";

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
    const cands = [{ county: "fortbend", url: "u1" }, { county: "chambers", url: "u2" }];
    const out = filterHealthyCandidates(cands, ["chambers"], t);
    expect(out.map((c) => c.county)).toEqual(["chambers"]); // dead primary dropped, fallback kept
  });

  it("keeps a healthy primary alongside the statewide fallback", () => {
    const cands = [{ county: "harris", url: "u1" }, { county: "chambers", url: "u2" }];
    const out = filterHealthyCandidates(cands, ["chambers"], 1000);
    expect(out.map((c) => c.county)).toEqual(["harris", "chambers"]);
  });

  it("never returns empty even if every candidate's breaker is open (coverage must survive)", () => {
    const t = 1000;
    for (let i = 0; i < SOURCE_FAIL_THRESHOLD; i++) { recordSourceResult("harris", false, t); recordSourceResult("fortbend", false, t); }
    const cands = [{ county: "harris", url: "u1" }, { county: "fortbend", url: "u2" }];
    const out = filterHealthyCandidates(cands, [], t); // no always-keep, both open
    expect(out.length).toBeGreaterThan(0);
  });
});

// isStatewideBackup — the honest "statewide backup" badge fires ONLY when the county's
// own CAD was genuinely unavailable, never when a healthy CAD merely lost the parallel
// identify race to a faster TxGIO (B630 — the false "Fort Bend server unavailable" notice
// on every healthy Fort Bend click).
describe("isStatewideBackup — honest 'statewide backup' labeling (B630)", () => {
  const SW = ["chambers"]; // the statewide TxGIO source is configured under the `chambers` key

  it("is NOT a backup when a real county CAD answered directly", () => {
    // FBCAD answered → hit.county is a real primary, not the statewide key.
    expect(isStatewideBackup("fortbend", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "fortbend" }, { county: "chambers" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("is NOT a backup when statewide won the race but a healthy CAD WAS queried (the B630 bug)", () => {
    // The reported case: FBCAD is healthy (a queried candidate) and returns 200, but the
    // statewide TxGIO layer answered a hair faster and won the eager race. That is a race
    // outcome, not an outage — the notice must NOT fire.
    expect(isStatewideBackup("chambers", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "fortbend" }, { county: "chambers" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("IS a backup when the real CAD's breaker was open, so only statewide was queried", () => {
    // A genuine outage: FBCAD's breaker opened, so filterHealthyCandidates dropped it and
    // only the statewide layer remained to answer — TxGIO truly stood in.
    expect(isStatewideBackup("chambers", {
      realPrimaries: [{ county: "fortbend" }],
      queried: [{ county: "chambers" }],
      statewideKeys: SW,
    })).toBe(true);
  });

  it("is NOT a backup in a statewide-only area (no real CAD covers the point)", () => {
    // A county with no configured CAD is served straight from TxGIO — that is its normal
    // source, not a stand-in, so no "backup" badge.
    expect(isStatewideBackup("chambers", {
      realPrimaries: [],
      queried: [{ county: "chambers" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("is NOT a backup at a border straddle when at least one real CAD was still queryable", () => {
    // Point near a county line: fortbend's breaker is open (dropped) but harris is healthy
    // and WAS queried. Even if statewide won the race, a real CAD was available — don't
    // cry "county server unavailable".
    expect(isStatewideBackup("chambers", {
      realPrimaries: [{ county: "fortbend" }, { county: "harris" }],
      queried: [{ county: "harris" }, { county: "chambers" }],
      statewideKeys: SW,
    })).toBe(false);
  });

  it("defends against missing/empty inputs", () => {
    expect(isStatewideBackup("chambers")).toBe(false);
    expect(isStatewideBackup(undefined, { statewideKeys: SW })).toBe(false);
  });
});
