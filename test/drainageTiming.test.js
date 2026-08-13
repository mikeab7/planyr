/* NEW-4 — the flood/drainage check records its own per-leg cost.
 *
 * Four properties, and the reason each is a test rather than a comment:
 *   1. THE LEG NAMES ARE AN ALLOWLIST. A leg name can come from a GIS service key; anything not
 *      on the fixed list or the sanitised `wse:` shape must be DROPPED, not shipped.
 *   2. NO SILENT SINK (B265536). "we called send" is not "the server took it" — a refused row is
 *      recorded as a failure, and that is readable without a database round trip.
 *   3. IT NEVER THROWS INTO THE CHECK. A timing instrument that can break the thing it measures
 *      is worse than no instrument, so every hostile input is exercised here.
 *   4. THE SAVE LEG IS ATTRIBUTED, NOT ASSUMED. A cloud write outside the window belongs to
 *      whatever else the plan was doing, and charging it to a check would invent a slow leg.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createDrainageTimer, buildDrainageTimingRow, reportDrainageTiming, wseLegName,
  armDrainageSaveLeg, noteDrainageSave, drainageTimingRecent, drainageTimingDelivery,
  __resetDrainageTiming, DRAIN_LEG_KEYS, MAX_LEGS, SAVE_ATTRIBUTION_MS,
} from "../src/workspaces/site-planner/lib/drainageTiming.js";

/* A clock we drive by hand, so every duration below is exact rather than flaky. */
function clock(start = 0) {
  let t = start;
  const now = () => t;
  now.advance = (ms) => { t += ms; };
  return now;
}

beforeEach(() => __resetDrainageTiming());

// ---------------------------------------------------------------------------------------------
describe("the timer", () => {
  it("brackets a leg and reports its wall clock", () => {
    const now = clock();
    const t = createDrainageTimer(now);
    t.start("elev"); now.advance(5761); t.end("elev");
    expect(t.legs().get("elev")).toBe(5761);
  });

  it("keeps the FIRST duration when a leg settles twice — a double-settle is a caller bug, not a reason to overwrite an honest number", () => {
    const now = clock();
    const t = createDrainageTimer(now);
    t.start("flood"); now.advance(146); t.end("flood");
    t.start("flood"); now.advance(9000); t.end("flood");
    expect(t.legs().get("flood")).toBe(146);
  });

  it("`calc` is the gap since the last NETWORK leg settled, not since the check began", () => {
    const now = clock();
    const t = createDrainageTimer(now);
    now.advance(1000);              // …spent waiting on the network
    t.start("gis"); now.advance(146); t.end("gis");
    now.advance(1029);              // …the app's own work (the owner's measured figure)
    expect(t.sinceNetwork()).toBe(1029);
    expect(t.elapsed()).toBe(2175);
  });

  it("a marked county-raster leg counts as network, so it moves the calc origin", () => {
    const now = clock();
    const t = createDrainageTimer(now);
    now.advance(500);
    t.mark("wse:Willow_500YR_Existing_WSE", 46);
    now.advance(200);
    expect(t.sinceNetwork()).toBe(200);
  });

  it("`save` and `total` are DERIVED and must not move the calc origin", () => {
    const now = clock();
    const t = createDrainageTimer(now);
    t.start("flood"); now.advance(100); t.end("flood");
    now.advance(300);
    t.mark("save", 832);
    t.mark("total", 3635);
    expect(t.sinceNetwork()).toBe(300);
  });

  it("ending a leg that never started, or marking rubbish, is a no-op rather than a throw", () => {
    const t = createDrainageTimer(clock());
    expect(() => t.end("nope")).not.toThrow();
    expect(t.end("elev")).toBe(null);
    t.mark("elev", NaN); t.mark("elev", undefined); t.mark(null, 5);
    expect(t.legs().size).toBe(0);
  });

  it("refuses a leg name that is not on the allowlist", () => {
    const now = clock();
    const t = createDrainageTimer(now);
    t.start("secret"); now.advance(10); t.end("secret");
    t.mark("https://example.com/private", 10);
    expect(t.legs().size).toBe(0);
  });
});

describe("the county-raster leg name is sanitised and bounded", () => {
  it("keeps a real service name", () => {
    expect(wseLegName("Willow_500YR_Existing_WSE")).toBe("wse:Willow_500YR_Existing_WSE");
  });
  it("strips anything that is not a plain identifier — a URL can never become a leg name", () => {
    expect(wseLegName("https://host/arcgis/rest/Willow?f=json")).toBe("wse:https___host_arcgis_rest_Willow_f_json");
  });
  it("is bounded, so a pathological name cannot grow the row", () => {
    expect(wseLegName("A".repeat(500)).length).toBeLessThanOrEqual("wse:".length + 40);
  });
  it("an empty name is no name", () => {
    expect(wseLegName("")).toBe(null);
    expect(wseLegName(null)).toBe(null);
  });
});

describe("the row is BUILT from the allowlist, never filtered into it", () => {
  it("carries the fixed legs and the sanitised county rasters, rounded", () => {
    const row = buildDrainageTimingRow({
      legs: new Map([["elev", 5761.4], ["flood", 146.6], ["wse:Willow_100YR_Existing_WSE", 142]]),
      auto: false,
    });
    expect(row.kind).toBe("draincheck");
    expect(row.mode).toBe("manual");
    expect(row.legs).toEqual({ elev: 5761, flood: 147, "wse:Willow_100YR_Existing_WSE": 142 });
  });

  it("DROPS anything off the allowlist — a site name reaching a leg key must not travel", () => {
    const row = buildDrainageTimingRow({ legs: { elev: 10, "8 South, Pearland": 20, "wse:ok": 30 } });
    expect(Object.keys(row.legs).sort()).toEqual(["elev", "wse:ok"]);
    expect(JSON.stringify(row)).not.toContain("Pearland");
  });

  it("keeps the SLOWEST legs when it truncates, and says how many it dropped", () => {
    const legs = {};
    for (let i = 0; i < MAX_LEGS + 5; i++) legs[`wse:r${i}`] = i;
    const row = buildDrainageTimingRow({ legs });
    expect(Object.keys(row.legs).length).toBe(MAX_LEGS);
    expect(row.legs[`wse:r${MAX_LEGS + 4}`]).toBe(MAX_LEGS + 4); // the slowest survived
    expect(row.legsDropped).toBe(5);
  });

  it("carries the ground-elevation state — the fact the whole strand turns on", () => {
    const row = buildDrainageTimingRow({ legs: {}, ground: { status: "value", fromCache: true } });
    expect(row.ground).toBe("value");
    expect(row.groundCached).toBe(true);
    const row2 = buildDrainageTimingRow({ legs: {}, ground: { status: "unavailable", fromCache: false, timedOut: true } });
    expect(row2.ground).toBe("unavailable");
    expect(row2.groundCached).toBe(false);
    expect(row2.groundTimedOut).toBe(true);
  });

  it("an auto run is labelled as one, so a manual press and a background pass are never averaged together", () => {
    expect(buildDrainageTimingRow({ legs: {}, auto: true }).mode).toBe("auto");
  });

  it("every fixed leg name is accepted (a name added to the list with no home is a dead column)", () => {
    const legs = {};
    for (const k of DRAIN_LEG_KEYS) legs[k] = 1;
    expect(Object.keys(buildDrainageTimingRow({ legs }).legs).length).toBe(DRAIN_LEG_KEYS.length);
  });
});

describe("⛔ no silent sink (B265536) — 'we called send' is not 'the server took it'", () => {
  it("records a DELIVERED row as delivered", async () => {
    const report = async () => ({ ok: true });
    const r = await reportDrainageTiming(buildDrainageTimingRow({ legs: { elev: 1 } }), report);
    expect(r.ok).toBe(true);
    expect(drainageTimingDelivery()).toMatchObject({ attempted: 1, ok: 1, failed: 0 });
  });

  it("records a REFUSED row as a failure, with the reason, rather than swallowing it", async () => {
    const report = async () => ({ ok: false, reason: "rls-rejected" });
    const r = await reportDrainageTiming(buildDrainageTimingRow({ legs: { elev: 1 } }), report);
    expect(r.ok).toBe(false);
    const d = drainageTimingDelivery();
    expect(d.failed).toBe(1);
    expect(d.lastReason).toBe("rls-rejected");
  });

  it("a sink that THROWS is a failure, not an exception in the check", async () => {
    const report = () => { throw new Error("pipe broken"); };
    const r = await reportDrainageTiming(buildDrainageTimingRow({ legs: {} }), report);
    expect(r.ok).toBe(false);
    expect(drainageTimingDelivery().failed).toBe(1);
  });

  it("keeps the rows readable locally, bounded", async () => {
    const report = async () => ({ ok: true });
    for (let i = 0; i < 20; i++) await reportDrainageTiming(buildDrainageTimingRow({ legs: { elev: i } }), report);
    const recent = drainageTimingRecent();
    expect(recent.length).toBeLessThanOrEqual(8);
    expect(recent[recent.length - 1].legs.elev).toBe(19);
  });
});

describe("the SAVE leg is attributed, never assumed", () => {
  it("charges a push inside the window to the check that armed it", () => {
    const now = clock(1000);
    let got = null;
    armDrainageSaveLeg((ms) => { got = ms; }, now);
    now.advance(500);
    expect(noteDrainageSave(832, now)).toBe(true);
    expect(got).toBe(832);
  });

  it("REFUSES a push that arrives after the window — a late save belongs to something else", () => {
    const now = clock(1000);
    let got = null;
    armDrainageSaveLeg((ms) => { got = ms; }, now);
    now.advance(SAVE_ATTRIBUTION_MS + 1);
    expect(noteDrainageSave(832, now)).toBe(false);
    expect(got).toBe(null);
  });

  it("charges a push only ONCE — a second write is not a second save leg", () => {
    const now = clock();
    let calls = 0;
    armDrainageSaveLeg(() => { calls++; }, now);
    noteDrainageSave(10, now);
    noteDrainageSave(10, now);
    expect(calls).toBe(1);
  });

  it("a push with no armed check is a plain no-op", () => {
    expect(noteDrainageSave(500)).toBe(false);
  });

  it("an apply that throws cannot reach the cloud-push path", () => {
    armDrainageSaveLeg(() => { throw new Error("boom"); });
    expect(() => noteDrainageSave(10)).not.toThrow();
  });
});
