import { describe, it, expect, beforeEach } from "vitest";
import {
  recordSourceResult, isSourceOpen, sourceCooldownMs, filterHealthyCandidates,
  resetSourceHealth, SOURCE_FAIL_THRESHOLD, SOURCE_COOLDOWN_MS,
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
