/* NEW-1 (B2496304, 2026-10-29) — the second, deeper search of Illinois' 22 "none" parcel counties.
 *
 * RED-PROOF: on main c79bc2e / 90778ce all 22 were `none` gaps, so the nine below resolved to "no-source" and the per-county source
 * assertions fail; the five re-filed counties read the generic "Planyr hasn't found a public parcel map" sentence instead of a named reason.
 *
 * What this pins, county by county, is the OUTCOME of the second pass — wired (own), copy wired (labelled, dated), re-filed with a sharper
 * reason, or still none — so a later session cannot quietly reverse one. The measurements themselves are in test/illinoisCounties.test.js
 * (fixture ilSamples.json) and docs/STATEWIDE-PARCELS.md "Illinois second pass (2026-10-29)". */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { COUNTIES, countyIdentity } from "../src/workspaces/site-planner/lib/counties.js";
import { setCountyPolygons } from "../src/workspaces/site-planner/lib/countyPolygons.js";
import { PARCEL_GAPS, gapReasonFor, parcelGapNotice } from "../src/workspaces/site-planner/lib/parcelGaps.js";
import { parcelCopyNotice, parcelCopyOf } from "../src/workspaces/site-planner/lib/parcelCopies.js";
import { ALLOWED_HOSTS } from "../functions/gis-proxy/[[path]].js";

beforeAll(async () => {
  await setCountyPolygons(JSON.parse(readFileSync(new URL("../public/geo/county-polygons.json", import.meta.url), "utf8")));
});

const WIRED_OWN = { il_jersey: "PIN", il_warren: "PARCELID", il_wabash: "PIN" };
const WIRED_COPY = {
  il_alexander: ["APN", "U.S. Army Corps of Engineers", "2016"],
  il_cass: ["PARCEL_ID", "Menard Electric Cooperative", "2026-02"],
  il_champaign: ["PIN", "City of Champaign", "2025-01"],
  il_clark: ["PIN", "a county appraisal contractor", "2024-04"],
  il_mason: ["PARCEL_ID", "Menard Electric Cooperative", "2026-02"],
};

describe("the nine counties the second pass wired", () => {
  const all = { ...WIRED_OWN, il_jasper: "CountyPin", ...Object.fromEntries(Object.entries(WIRED_COPY).map(([k, v]) => [k, v[0]])) };
  it.each(Object.entries(all))("%s is a connected source pinned to its measured id column and is no longer a gap", (key, idField) => {
    expect(COUNTIES[key], key).toBeTruthy();
    expect(COUNTIES[key].state).toBe("IL");
    expect(COUNTIES[key].idField).toBe(idField);
    expect(PARCEL_GAPS[key], `${key} must not also be a gap row`).toBeUndefined();
  });
  it("every one rides an ArcGIS Online host, so the relay allow-list gained nothing for them", () => {
    for (const key of Object.keys(all)) expect(COUNTIES[key].layerUrl, key).toMatch(/^https:\/\/services\d*\.arcgis\.com\//);
    // the probe hosts the research named were measured on a preview relay and none was needed (PR #2617 closed unmerged)
    for (const h of ["maps.wingis.org", "pikeil.wthgis.com", "gis.prairie.illinois.edu", "gisportal.champaignil.gov", "www.efsedge.com"]) expect(ALLOWED_HOSTS.has(h), h).toBe(false);
  });
  it("the county's real centre resolves to the new source", () => {
    expect(countyIdentity(39.12, -90.33).key).toBe("il_jersey"); // Jerseyville
    expect(countyIdentity(40.91, -90.65).key).toBe("il_warren"); // Monmouth
    expect(countyIdentity(38.41, -87.76).key).toBe("il_wabash"); // Mount Carmel
    expect(countyIdentity(38.98, -88.16).key).toBe("il_jasper"); // Newton
    expect(countyIdentity(37.0, -89.18).key).toBe("il_alexander"); // Cairo
    expect(countyIdentity(40.02, -90.43).key).toBe("il_cass"); // Beardstown
    expect(countyIdentity(40.12, -88.24).key).toBe("il_champaign");
    expect(countyIdentity(39.39, -87.69).key).toBe("il_clark"); // Marshall
    expect(countyIdentity(40.3, -90.06).key).toBe("il_mason"); // Havana
  });
});

describe("copies are labelled with who published them and the date of the data (constraint #40)", () => {
  it.each(Object.entries(WIRED_COPY))("%s", (key, [, publisher, asOf]) => {
    expect(parcelCopyOf(key)).toEqual({ publisher, asOf });
    const n = parcelCopyNotice(key, { lat: 39.5, lng: -89.5 });
    expect(n.line).toContain(publisher);
    expect(n.line).toContain("not the county’s own");
    expect(n.href).toMatch(/^mailto:michael@planyr\.io/);
  });
  it("the county's own layers show no copy line", () => {
    for (const k of Object.keys(WIRED_OWN)) expect(parcelCopyOf(k), k).toBeNull();
  });
  it("Jasper's layer is not tied to a named county account, so it says so rather than claiming the county", () => {
    expect(parcelCopyNotice("il_jasper").line).toContain("couldn’t tie to the county");
  });
});

describe("the thirteen that stay gaps carry their sharper reason", () => {
  const WANT = {
    il_stephenson: "locked", il_pike: "locked", il_gallatin: "locked", il_richland: "locked", il_piatt: "paywall",
    il_calhoun: "none", il_crawford: "none", il_hardin: "none", il_montgomery: "none", il_pope: "none", il_pulaski: "none", il_saline: "none", il_scott: "none",
  };
  it.each(Object.entries(WANT))("%s → %s", (key, reason) => {
    expect(PARCEL_GAPS[key], key).toBeTruthy();
    expect(PARCEL_GAPS[key][0]).toBe(reason);
    expect(COUNTIES[key], `${key} is a gap, not a source`).toBeUndefined();
  });
  it("a re-filed county's notice names its reason and keeps the request link", () => {
    // the real identify answer for a point in each county (Freeport, Pittsfield, Monticello), not a hand-built identity
    for (const [name, la, ln, reason] of [["Stephenson", 42.296, -89.62, "locked"], ["Pike", 39.607, -90.8, "locked"], ["Piatt", 40.0, -88.57, "paywall"]]) {
      const id = countyIdentity(la, ln);
      expect(id.status, name).toBe("no-source");
      const n = parcelGapNotice(id, { lat: la, lng: ln });
      expect(n.reason, name).toBe(reason);
      expect(n.county, name).toBe(`${name} County`);
      expect(n.href).toMatch(/^mailto:michael@planyr\.io/);
    }
    expect(gapReasonFor("Scott County", "IL")).toBe("none");
  });
  it("no Illinois county is left unaccounted for: 75 wired + 27 gap rows = 102", () => {
    const wired = Object.keys(COUNTIES).filter((k) => k.startsWith("il_")).length;
    const gaps = Object.keys(PARCEL_GAPS).filter((k) => k.startsWith("il_")).length;
    expect(wired).toBe(75);
    expect(gaps).toBe(27);
    expect(wired + gaps).toBe(102);
  });
});
