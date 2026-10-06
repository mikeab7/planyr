// liveFixtures + signedInSession (NEW-1, 2026-10-06): the pure parts of the live signed-in check kit.
import { describe, it, expect } from "vitest";
import { LIVE_PREFIX, throwawayPlan } from "../ui-audit/lib/liveFixtures.mjs";
import { routeFailure } from "../ui-audit/lib/signedInSession.mjs";

describe("throwawayPlan", () => {
  const plan = throwawayPlan(LIVE_PREFIX + "typing", 1);
  it("is a one-parcel, one-building plan the Site Planner panels have something to show for", () => {
    expect(plan.parcels).toHaveLength(1);
    expect(plan.els.map((e) => e.type)).toEqual(["building"]);
    expect(plan.parcels[0].points).toHaveLength(4);
  });
  it("carries the throwaway prefix on its id AND its group id, so cleanup can only ever match its own rows", () => {
    expect(plan.id.startsWith(LIVE_PREFIX)).toBe(true);
    expect(plan.groupId).toBe(plan.id);
    expect(LIVE_PREFIX).toMatch(/^zz-/);
  });
  it("holds its elements inline (not slim-header rows), so the row is complete the moment it is inserted", () => {
    expect(plan.elementsInRows).toBe(false);
  });
});

describe("routeFailure", () => {
  it("passes a usable session", () => { expect(routeFailure(200, { access_token: "a", refresh_token: "b" })).toBeNull(); });
  it("names a missing key", () => { expect(routeFailure(404, null)).toMatch(/E2E_LOGIN_KEY/); });
  it("reports an upstream 5xx with its status (the route answers 502 for ~3 min during every Pages deploy)", () => { expect(routeFailure(502, null)).toMatch(/502/); });
});
