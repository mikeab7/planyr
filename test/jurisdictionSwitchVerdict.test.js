import { describe, it, expect } from "vitest";
import { attribute, verdict, isJurisdictionScript } from "../ui-audit/lib/jurisdictionSwitch.mjs";

/* The pure half of ui-audit/perf-jurisdiction-switch (slow report 55807aa9). The label the owner's recorder printed is
 * `Response.json.then:jurisdiction-CuR1TIW8.js:5638` — the invoker + chunk, cut to 48 characters. These tests pin how that
 * label (and the LoAF record behind it) is attributed, and that an unexercised scenario is VOID rather than green. */
const owner = { i: "Response.json.then", u: "jurisdiction-CuR1TIW8.js", d: 130 };

describe("isJurisdictionScript", () => {
  it("matches work of the jurisdiction chunk whatever resumed it — the response, and each sliced continuation", () => {
    expect(isJurisdictionScript(owner)).toBe(true);
    expect(isJurisdictionScript({ i: "Scheduler.yield.then", u: "jurisdiction-hN4Y4W-U.js" })).toBe(true);
    expect(isJurisdictionScript({ i: "TimerHandler:setTimeout", u: "jurisdiction-hN4Y4W-U.js" })).toBe(true);
    expect(isJurisdictionScript({ invoker: "Response.json.then", sourceURL: "https://x/assets/jurisdiction-CuR1TIW8.js" })).toBe(true);
  });
  it("does not match the other recurring task in his capture, nor another chunk's response handler", () => {
    expect(isJurisdictionScript({ i: "Response.text.then", u: "index-Bt1Uve_n.js" })).toBe(false);   // `Response.text.then:index-…:154188`
    expect(isJurisdictionScript({ i: "Response.json.then", u: "adminBoundaryLayer-AjAJwa8o.js" })).toBe(false);
    expect(isJurisdictionScript({ i: "Response.json.then", u: "countyPolygons-CiEOscnM.js" })).toBe(false);
    expect(isJurisdictionScript(null)).toBe(false);
  });
});

describe("attribute", () => {
  const loaf = [
    { t: 100, d: 700, scripts: [{ ...owner, d: 620 }, { i: "B", u: "index-1.js", d: 30 }] },
    { t: 5000, d: 140, scripts: [{ ...owner, d: 130 }] },
    { t: 99999, d: 900, scripts: [{ ...owner, d: 900 }] },                       // outside the window
  ];
  const lt = [[100, 700], [5000, 140], [99999, 900], [200, 20]];
  it("sums only the jurisdiction scripts that START inside the window", () => {
    const a = attribute({ lt, loaf }, [0, 6000]);
    expect(a.jurisdictionMs).toBe(750);
    expect(a.jurisdictionMaxMs).toBe(620);
    expect(a.jurisdictionScripts).toBe(2);
    expect(a.tasks).toBe(3);
    expect(a.over50).toBe(2);
    expect(a.maxTaskMs).toBe(700);
    expect(a.jurisdictionFrames).toBe(2);
    expect(a.jurisdictionFrameMaxMs).toBe(700);
  });
  it("a SLICED run is counted — the work moved into Scheduler.yield slices is still jurisdiction work, not 0 ms", () => {
    const sliced = [{ t: 10, d: 102, scripts: [
      { i: "Response.json.then", u: "jurisdiction-hN4Y4W-U.js", d: 17 }, { i: "Scheduler.yield.then", u: "jurisdiction-hN4Y4W-U.js", d: 15 },
      { i: "Scheduler.yield.then", u: "jurisdiction-hN4Y4W-U.js", d: 7 }, { i: "Response.json.then", u: "jurisdiction-hN4Y4W-U.js", d: 31 } ] }];
    const a = attribute({ lt: [], loaf: sliced }, [0, 100]);
    expect(a.jurisdictionMs).toBe(70);
    expect(a.jurisdictionMaxMs).toBe(31);
    expect(a.jurisdictionFrameMaxMs).toBe(102);          // the frame the slices shared
  });
  it("an empty record attributes nothing (and is not an error)", () => {
    expect(attribute({}, [0, 1])).toMatchObject({ tasks: 0, jurisdictionMs: 0, jurisdictionMaxMs: 0 });
  });
});

describe("verdict", () => {
  const budget = { maxSingleJurisdictionScriptMs: 50, maxJurisdictionMsPerScenario: 150, minGisRequests: 4 };
  const sc = (name, jm, jmax, req = 20, res = 20, over50 = 3) => ({ name, gisRequests: req, responses: res, attr: { jurisdictionMs: jm, jurisdictionMaxMs: jmax, over50, maxTaskMs: 200 } });
  it("passes a fixed run and fails the stalled one (the owner's numbers)", () => {
    expect(verdict([sc("a", 43, 26)], budget).pass).toBe(true);
    expect(verdict([sc("a", 1017, 587)], budget).pass).toBe(false);
  });
  it("a single long script fails even when the total is small", () => {
    expect(verdict([sc("a", 90, 60)], budget).pass).toBe(false);
  });
  it("a frame ceiling gates the stall the user sees even when every slice is short", () => {
    const a = { ...sc("a", 40, 20) }; a.attr.jurisdictionFrameMaxMs = 140;
    expect(verdict([a], budget).pass).toBe(true);                                   // no ceiling named → reported, not gated
    expect(verdict([a], { ...budget, maxJurisdictionFrameMs: 100 }).pass).toBe(false);
  });
  it("a scenario that never reached the GIS path is VOID, never green", () => {
    const v = verdict([sc("a", 0, 0, 0, 0)], budget);
    expect(v.pass).toBe(false);
    expect(v.lines[0]).toMatch(/^VOID/);
  });
  it("no scenarios at all is VOID", () => { expect(verdict([], budget).pass).toBe(false); });
  it("unrelated long tasks are reported but only gated when the budget names a ceiling", () => {
    expect(verdict([sc("a", 10, 10, 20, 20, 5)], budget).pass).toBe(true);
    expect(verdict([sc("a", 10, 10, 20, 20, 5)], { ...budget, maxTasksOver50ms: 0 }).pass).toBe(false);
  });
});
