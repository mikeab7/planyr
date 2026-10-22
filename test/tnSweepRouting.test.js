/* NEW-1 (Tennessee, all 95 counties, 2026-10-22) — a county can never silently drop out of routing.
 * The fixture (test/fixtures/tnSweepPoints.json) holds two real lots per county — one near the middle, one in the densest named place — each picked INSIDE the county by the bundled polygons
 * (ui-audit/sweep-tn-counties.mjs --repick). This suite replays the ROUTING half of that sweep offline: the polygon asset holds exactly the state's 95 counties; every one resolves, at both of its
 * points, to the one source it should (86 statewide + 8 own + Knox the named gap), with the honest message for Knox. The network half (click / outlines / id search) is the sweep itself. */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES_MAP, countyIdentity, candidateCountiesForPoint, noParcelSourceNote, statewideExcludesCounty } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons, countyRoster } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { TN_COUNTY_BY_ID } from "../src/workspaces/site-planner/lib/tnParcelId.js";

const json = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const FX = json("./fixtures/tnSweepPoints.json");
const CT = json("./fixtures/tnComptrollerCounties.json");
const slug = (n) => String(n).toLowerCase().replace(/[^a-z]/g, "");
beforeAll(async () => { await setCountyPolygons(json("../public/geo/county-polygons.json")); });

const OWN = { Chester: "tn_chester", Davidson: "tn_davidson", Hamilton: "tn_hamilton", Hickman: "tn_hickman", Montgomery: "tn_montgomery", Rutherford: "tn_rutherford", Shelby: "tn_shelby", Williamson: "tn_williamson" };
const expected = (name) => (OWN[name] ? [OWN[name]] : name === "Knox" ? [] : ["tn_statewide"]);

describe("the 95 Tennessee counties", () => {
  it("the bundled polygons hold exactly the state's 95 counties, in the state's own id order set", () => {
    const names = countyRoster().filter((c) => c.state === "TN").map((c) => c.name.replace(/\s+County$/i, ""));
    expect(names).toHaveLength(95);
    expect(new Set(names.map(slug))).toEqual(new Set(TN_COUNTY_BY_ID.map(slug)));
  });
  it("the sweep fixture covers all 95, once each", () => {
    expect(FX.counties).toHaveLength(95);
    expect(new Set(FX.counties.map((c) => slug(c.name)))).toEqual(new Set(TN_COUNTY_BY_ID.map(slug)));
  });
  it("86 counties are the Comptroller's, 8 have their own source, Knox is the one named gap", () => {
    const stateIds = new Set(CT.counties.map((c) => c.id));
    const fromState = TN_COUNTY_BY_ID.filter((_, i) => stateIds.has(i + 1));
    expect(fromState).toHaveLength(86);
    expect(Object.keys(OWN)).toHaveLength(8);
    for (const n of TN_COUNTY_BY_ID) {
      const isState = fromState.includes(n);
      expect(statewideExcludesCounty("tn_statewide", n), n).toBe(!isState);
    }
    for (const [name, key] of Object.entries(OWN)) expect(COUNTIES_MAP[key].layerUrl, name).toBeTruthy();
  });
});

describe("every county routes to its one source at both recorded lots", () => {
  it.each(FX.counties.map((c) => [c.name, c]))("%s", (_name, c) => {
    const pts = [{ lat: c.lat, lng: c.lng, where: "middle" }, ...(c.dense ? [{ lat: c.dense.lat, lng: c.dense.lng, where: c.dense.town }] : [])];
    expect(pts.length, "a county with no named place is the only one that may have a single point").toBeGreaterThanOrEqual(c.name === "Knox" ? 1 : 2);
    for (const p of pts) {
      const id = countyIdentity(p.lat, p.lng);
      expect(id.name, `${c.name} @ ${p.where}`).toMatch(new RegExp(`^${c.name}`, "i"));
      expect(id.nearEdge, `${c.name} @ ${p.where} must sit well inside the county`).toBe(false);
      expect(candidateCountiesForPoint(p.lat, p.lng), `${c.name} @ ${p.where}`).toEqual(expected(c.name));
    }
  });
  it("Knox says so honestly (not the road card, not a silent empty)", () => {
    const k = FX.counties.find((c) => c.name === "Knox");
    expect(noParcelSourceNote(countyIdentity(k.lat, k.lng))).toBe("Knox County — no parcel data wired here yet.");
  });
  it("the fixture's own source labels agree with the routing it replays", () => {
    for (const c of FX.counties) expect(c.source, c.name).toBe(expected(c.name)[0] || "(none)");
  });
});
